import type { Filters } from "./filters";
import type { ParserId } from "./parsers/types";
import type { ThemePreference } from "./theme";

const DATABASE_NAME = "logline-local";
const DATABASE_VERSION = 2;
const DATASETS = "datasets";
const QUERY_STATE = "query-state";
const FILTER_STATE = "filter-state";
const FILTER_PRESETS = "filter-presets";
const SETTINGS = "settings";
const DEFAULT_KEY = "default";

export type PersistedDataset = {
  id: string;
  name: string;
  blob: Blob;
  size: number;
  type: string;
  lastModified: number;
  parser: ParserId;
  lineCount: number | null;
  order: number;
  lastOpenedAt: number;
};

export type PersistedQueryState = {
  key: string;
  history: string[];
  saved: { name: string; sql: string }[];
};

export type PersistedSettings = {
  key: string;
  activeDatasetId: string | null;
  view: "raw" | "structured" | "query" | "analytics";
  sql: string;
  theme?: ThemePreference;
};

export type PersistedFilterPreset = {
  name: string;
  filters: Filters;
  updatedAt: number;
};

export type WorkspaceSnapshot = {
  datasets: PersistedDataset[];
  queryState: PersistedQueryState | null;
  filters: Record<string, Filters>;
  filterPresets: PersistedFilterPreset[];
  settings: PersistedSettings | null;
};

let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (typeof indexedDB === "undefined")
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATASETS))
        db.createObjectStore(DATASETS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(QUERY_STATE))
        db.createObjectStore(QUERY_STATE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(FILTER_STATE))
        db.createObjectStore(FILTER_STATE, { keyPath: "datasetId" });
      if (!db.objectStoreNames.contains(FILTER_PRESETS))
        db.createObjectStore(FILTER_PRESETS, { keyPath: "name" });
      if (!db.objectStoreNames.contains(SETTINGS))
        db.createObjectStore(SETTINGS, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error("Could not open local persistence."));
    };
    request.onblocked = () => {
      database = null;
      reject(new Error("Local persistence is blocked by another browser tab."));
    };
  });
  return database;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local persistence failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local persistence failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Local persistence was aborted."));
  });
}

export function createDatasetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `dataset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fileFromDataset(dataset: PersistedDataset) {
  return new File([dataset.blob], dataset.name, {
    type: dataset.type,
    lastModified: dataset.lastModified,
  });
}

export function datasetRecord(
  dataset: Omit<PersistedDataset, "blob" | "size" | "type" | "lastModified"> & {
    file: File;
  },
): PersistedDataset {
  return {
    id: dataset.id,
    name: dataset.name,
    blob: dataset.file.slice(0, dataset.file.size, dataset.file.type),
    size: dataset.file.size,
    type: dataset.file.type,
    lastModified: dataset.file.lastModified,
    parser: dataset.parser,
    lineCount: dataset.lineCount,
    order: dataset.order,
    lastOpenedAt: dataset.lastOpenedAt,
  };
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [DATASETS, QUERY_STATE, FILTER_STATE, FILTER_PRESETS, SETTINGS],
    "readonly",
  );
  const done = transactionDone(transaction);
  const datasetRequest = transaction.objectStore(DATASETS).getAll();
  const queryRequest = transaction.objectStore(QUERY_STATE).get(DEFAULT_KEY);
  const filterRequest = transaction.objectStore(FILTER_STATE).getAll();
  const presetRequest = transaction.objectStore(FILTER_PRESETS).getAll();
  const settingsRequest = transaction.objectStore(SETTINGS).get(DEFAULT_KEY);
  const [datasets, queryState, filterRecords, filterPresets, settings] =
    await Promise.all([
      requestResult(datasetRequest),
      requestResult(queryRequest),
      requestResult(filterRequest),
      requestResult(presetRequest),
      requestResult(settingsRequest),
    ]);
  await done;
  return {
    datasets: (datasets as PersistedDataset[]).filter(
      (dataset) =>
        typeof dataset.id === "string" &&
        typeof dataset.name === "string" &&
        dataset.blob instanceof Blob &&
        Number.isFinite(dataset.size) &&
        typeof dataset.parser === "string",
    ),
    queryState: (queryState as PersistedQueryState | undefined) ?? null,
    filters: Object.fromEntries(
      (filterRecords as { datasetId: string; filters: Filters }[])
        .filter((record) => typeof record.datasetId === "string")
        .map((record) => [record.datasetId, record.filters]),
    ),
    filterPresets: (filterPresets as PersistedFilterPreset[]).filter(
      (preset) =>
        typeof preset.name === "string" &&
        preset.name.length > 0 &&
        preset.filters !== null &&
        typeof preset.filters === "object",
    ),
    settings: (settings as PersistedSettings | undefined) ?? null,
  };
}

export async function saveDataset(dataset: PersistedDataset) {
  const db = await openDatabase();
  const transaction = db.transaction(DATASETS, "readwrite");
  transaction.objectStore(DATASETS).put(dataset);
  await transactionDone(transaction);
}

export async function deleteDataset(id: string) {
  const db = await openDatabase();
  const transaction = db.transaction([DATASETS, FILTER_STATE], "readwrite");
  transaction.objectStore(DATASETS).delete(id);
  transaction.objectStore(FILTER_STATE).delete(id);
  await transactionDone(transaction);
}

export async function clearDatasets() {
  const db = await openDatabase();
  const transaction = db.transaction([DATASETS, FILTER_STATE], "readwrite");
  transaction.objectStore(DATASETS).clear();
  transaction.objectStore(FILTER_STATE).clear();
  await transactionDone(transaction);
}

export async function saveQueryState(
  history: string[],
  saved: { name: string; sql: string }[],
) {
  const db = await openDatabase();
  const transaction = db.transaction(QUERY_STATE, "readwrite");
  transaction.objectStore(QUERY_STATE).put({
    key: DEFAULT_KEY,
    history: history.slice(0, 20),
    saved,
  } satisfies PersistedQueryState);
  await transactionDone(transaction);
}

export async function saveFilters(datasetId: string, filters: Filters) {
  const db = await openDatabase();
  const transaction = db.transaction(FILTER_STATE, "readwrite");
  transaction.objectStore(FILTER_STATE).put({
    datasetId,
    filters,
    updatedAt: Date.now(),
  });
  await transactionDone(transaction);
}

export async function saveSettings(
  settings: Omit<PersistedSettings, "key">,
) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS, "readwrite");
  transaction.objectStore(SETTINGS).put({ key: DEFAULT_KEY, ...settings });
  await transactionDone(transaction);
}

export async function saveFilterPreset(
  name: string,
  filters: Filters,
) {
  const db = await openDatabase();
  const transaction = db.transaction(FILTER_PRESETS, "readwrite");
  transaction.objectStore(FILTER_PRESETS).put({
    name,
    filters,
    updatedAt: Date.now(),
  } satisfies PersistedFilterPreset);
  await transactionDone(transaction);
}

export async function deleteFilterPreset(name: string) {
  const db = await openDatabase();
  const transaction = db.transaction(FILTER_PRESETS, "readwrite");
  transaction.objectStore(FILTER_PRESETS).delete(name);
  await transactionDone(transaction);
}
