import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Activity,
  ArrowUpFromLine,
  BarChart3,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Layers,
  ListFilter,
  Menu,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FileImport } from "@/components/file-import";
import { LogTable } from "@/components/log-table";
import { StructuredTable } from "@/components/structured-table";
import { LogFilters } from "@/components/log-filters";
import { LogDetailContent } from "@/components/log-detail-content";
import { ViewBoundary } from "@/components/view-boundary";
import { ExportControls } from "@/components/export-controls";
import { downloadBlob } from "@/lib/download";
import { useColorTheme, type ThemePreference } from "@/lib/theme";
import { applyChartFilterPatch, EMPTY_FILTERS, filterWhere, type ChartFilterPatch, type FilterPreset, type FilterSummary, type Filters } from "@/lib/filters";
import {
  createDatasetId,
  datasetRecord,
  deleteDataset,
  fileFromDataset,
  loadWorkspace,
  saveDataset,
  saveFilters,
  saveQueryState,
  saveSettings,
  clearDatasets,
  saveFilterPreset,
  deleteFilterPreset,
} from "@/lib/persistence";
import { QUERIES } from "@/lib/queries";
import { PARSERS, type ParserId } from "@/lib/parsers";
import { ACCEPT, formatBytes, validateLogFile, type ImportProgress } from "@/lib/read-log-file";
import { LogWorkerClient } from "@/lib/worker/log-client";
import type { LogDetail, LogEvent, LogSummary } from "@/lib/worker/messages";

// The query workspace carries the editor, so it loads only when that view opens.
const QueryWorkspace = lazy(() => import("@/components/query-workspace"));
const AnalyticsDashboard = lazy(() => import("@/components/analytics-dashboard"));

// One entry per imported file. Only the active file is parsed inside the Worker;
// the rest stay as File handles so switching can reload them on demand.
type ImportedFile = {
  id: string;
  file: File;
  name: string;
  size: number;
  parser: ParserId;
  lines: number | null;
};

function App() {
  const compact = useSyncExternalStore(
    (on) => {
      const query = window.matchMedia("(max-width: 1279px)");
      query.addEventListener("change", on);
      return () => query.removeEventListener("change", on);
    },
    () => window.matchMedia("(max-width: 1279px)").matches,
    () => false,
  );
  const [client] = useState(() => new LogWorkerClient());
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const dark = useColorTheme(theme);
  const [log, setLog] = useState<LogSummary | null>(null);
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterResult, setFilterResult] = useState<FilterSummary | null>(null);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [parser, setParser] = useState<ParserId>("plain");
  const [view, setView] = useState<"raw" | "structured" | "query" | "analytics">(
    "structured",
  );
  const [sql, setSql] = useState<string>(QUERIES.count.sql);
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState<{ name: string; sql: string }[]>([]);
  const [restoreQueryOutput, setRestoreQueryOutput] = useState(false);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsedRows, setParsedRows] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<{ name: string; size: number } | null>(
    null,
  );
  const [progress, setProgress] = useState<ImportProgress>({
    bytes: 0,
    lines: 0,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loadedDetail, setLoadedDetail] = useState<{
    revision: number;
    index: number;
    view: string;
    filterId?: number;
    attempt: number;
    value: LogDetail | null;
    error: string;
  } | null>(null);
  const matchingDetail =
    loadedDetail?.revision === log?.revision &&
    loadedDetail?.index === selected &&
    loadedDetail?.view === view &&
    loadedDetail?.filterId === filterResult?.id &&
    loadedDetail?.attempt === detailAttempt
      ? loadedDetail
      : null;
  const detail = matchingDetail?.value ?? null;
  const appliedFilters = filterResult?.filters ?? EMPTY_FILTERS;
  let exportFiltersReady = false;
  try {
    exportFiltersReady =
      (!filterWhere(draftFilters).active && !filterWhere(appliedFilters).active) ||
      JSON.stringify(draftFilters) === JSON.stringify(appliedFilters);
  } catch {
    // Invalid drafts must be corrected before exporting, not silently ignored.
  }
  const operation = useRef(0);
  // File instance currently parsed in the Worker; re-importing a file hands over a
  // new instance, so identity (not entry id) decides whether a reload is needed.
  const loadedFile = useRef<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    client.onError = (cause) => setError(cause.message);
    return () => {
      operation.current++;
      client.onError = () => {};
      client.dispose();
    };
  }, [client]);
  useEffect(() => {
    let ignore = false;
    void loadWorkspace()
      .then(async (workspace) => {
        if (ignore) return;
        const validDatasets = workspace.datasets
          .filter((dataset) => PARSERS.some((option) => option.id === dataset.parser))
          .sort((left, right) => left.order - right.order)
          .map((dataset) => ({
            id: dataset.id,
            file: fileFromDataset(dataset),
            name: dataset.name,
            size: dataset.size,
            parser: dataset.parser,
            lines: dataset.lineCount,
          }));
        const queryState = workspace.queryState;
        setFiles(validDatasets);
        setHistory(
          Array.isArray(queryState?.history)
            ? queryState.history.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
            : [],
        );
        setSaved(
          Array.isArray(queryState?.saved)
            ? queryState.saved.filter(
                (entry): entry is { name: string; sql: string } =>
                  typeof entry?.name === "string" && typeof entry.sql === "string",
              )
            : [],
        );
        setFilterPresets(
          workspace.filterPresets.map((preset) => ({
            name: preset.name,
            filters: preset.filters,
          })),
        );
        if (workspace.settings) {
          if (["dark", "light", "system"].includes(workspace.settings.theme ?? ""))
            setTheme(workspace.settings.theme!);
          setSql(typeof workspace.settings.sql === "string" ? workspace.settings.sql : QUERIES.count.sql);
          if (["raw", "structured", "query", "analytics"].includes(workspace.settings.view))
            setView(workspace.settings.view);
          setRestoreQueryOutput(workspace.settings.view === "query");
        }
        setHydrated(true);
        const preferredId = workspace.settings?.activeDatasetId;
        const active =
          validDatasets.find((dataset) => dataset.id === preferredId) ??
          validDatasets[validDatasets.length - 1];
        if (active) {
          await activate(active, {
            restoredFilters: workspace.filters[active.id] ?? { ...EMPTY_FILTERS },
          });
        }
      })
      .catch((cause) => {
        if (!ignore) {
          setPersistenceError(
            cause instanceof Error ? cause.message : "Local persistence is unavailable.",
          );
          setHydrated(true);
        }
      });
    return () => {
      ignore = true;
    };
  }, [client]);
  useEffect(() => {
    if (!hydrated) return;
    void saveQueryState(history, saved).catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not save query state.",
      );
    });
  }, [hydrated, history, saved]);
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void saveSettings({
        activeDatasetId: activeId,
        view,
        sql,
        theme,
      }).catch((cause) => {
        setPersistenceError(
          cause instanceof Error ? cause.message : "Could not save settings.",
        );
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeId, hydrated, sql, view, theme]);
  useEffect(() => {
    if (!hydrated || !activeId) return;
    const timer = setTimeout(() => {
      void saveFilters(activeId, draftFilters).catch((cause) => {
        setPersistenceError(
          cause instanceof Error ? cause.message : "Could not save filters.",
        );
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [activeId, draftFilters, hydrated]);
  useEffect(() => {
    let ignore = false;
    if (log && selected !== null)
      void client
        .detail(log.revision, selected, view === "structured", filterResult?.id)
        .then((value) => {
          if (!ignore)
            setLoadedDetail({
              revision: log.revision,
              index: selected,
               view,
               filterId: filterResult?.id,
               attempt: detailAttempt,
               value,
               error: "",
            });
        })
        .catch((cause) => {
          if (!ignore)
            setLoadedDetail({
              revision: log.revision,
              index: selected,
              view,
              filterId: filterResult?.id,
              attempt: detailAttempt,
              value: null,
              error: cause instanceof Error ? cause.message : "Could not load details.",
            });
        });
    return () => {
      ignore = true;
    };
  }, [client, log, selected, view, filterResult, detailAttempt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const editing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (editing || target?.closest('[role="dialog"]')) return;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && log && !pending && !navOpen) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[aria-label="Search logs"]')?.focus();
      }
      if (event.key === "Escape" && selected !== null) {
        event.preventDefault();
        setSelected(null);
        setDetailsOpen(false);
        document.querySelector<HTMLElement>(view === "raw" ? '[aria-label="Raw log lines"]' : '[aria-label="Structured logs"]')?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [log, pending, navOpen, selected, view]);

  function reportProgress(event: LogEvent) {
    if (event.type === "READ_PROGRESS")
      setProgress({ bytes: event.bytes, lines: event.lines });
    else {
      setParsing(true);
      setParsedRows(event.rows);
    }
  }

  async function importFiles(incoming: File[]) {
    if (!incoming.length) return;
    try {
      for (const file of incoming) validateLogFile(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unsupported file.");
      return;
    }
    const next = [...files];
    let target: ImportedFile | null = null;
    let previousTarget: ImportedFile | undefined;
    for (const item of incoming) {
      const at = next.findIndex((entry) => entry.name === item.name);
      if (at >= 0) previousTarget = next[at];
      target =
        at >= 0
          ? { ...next[at], file: item, size: item.size, lines: null }
          : {
              id: createDatasetId(),
              file: item,
              name: item.name,
              size: item.size,
              parser,
              lines: null,
            };
      if (at >= 0) next[at] = target;
      else next.push(target);
    }
    setFiles(next);
    void Promise.all(
      next
        .filter((entry) => entry.id !== target?.id)
        .map((entry, order) =>
          saveDataset(
            datasetRecord({
              ...entry,
              file: entry.file,
              lineCount: entry.lines,
              order,
              lastOpenedAt: Date.now(),
            }),
          ),
        ),
    ).catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not save dataset.",
      );
    });
    // The file just handed over is the one the user asked for.
    await activate(target as ImportedFile, {
      order: next.findIndex((entry) => entry.id === target?.id),
      rollbackEntry: previousTarget,
    });
  }

  async function activate(
    entry: ImportedFile,
    options: {
      restoredFilters?: Filters;
      order?: number;
      rollbackEntry?: ImportedFile;
    } = {},
  ) {
    if (entry.id === activeId && loadedFile.current === entry.file) return;
    if (options.restoredFilters === undefined) setRestoreQueryOutput(false);
    const id = ++operation.current;
    setPending({ name: entry.name, size: entry.size });
    setProgress({ bytes: 0, lines: 0 });
    setError("");
    setNotice("");
    setParsing(false);
    setParsedRows(0);
    try {
      const summary = await client.loadFile(
        entry.file,
        entry.parser,
        (event) => {
          if (operation.current === id) reportProgress(event);
        },
      );
      if (operation.current !== id) return;
      setLoadedDetail(null);
      // Only a completed load may drop the previous dataset's view state.
      setFilterResult(null);
      setDraftFilters(options.restoredFilters ?? { ...EMPTY_FILTERS });
      setSelected(null);
      setDetailsOpen(false);
      setFiles((current) =>
        current.map((item) =>
          item.id === entry.id
            ? { ...item, parser: entry.parser, lines: summary.lineCount }
            : item,
        ),
      );
      setActiveId(entry.id);
      loadedFile.current = entry.file;
      setParser(entry.parser);
      setLog(summary);
      await saveDataset(
        datasetRecord({
          ...entry,
          file: entry.file,
          lineCount: summary.lineCount,
          order:
            options.order ?? Math.max(0, files.findIndex((item) => item.id === entry.id)),
          lastOpenedAt: Date.now(),
        }),
      ).catch((cause) => {
        setPersistenceError(
          cause instanceof Error ? cause.message : "Could not save dataset.",
        );
      });
      setNotice(
        `Imported ${summary.lineCount.toLocaleString()} lines. File stays in this browser tab.`,
      );
    } catch (cause) {
      if (operation.current !== id) return;
      // A file that never parsed is not a dataset; keep entries that already loaded.
      setFiles((current) =>
        options.rollbackEntry
          ? current.map((item) =>
              item.id === entry.id ? options.rollbackEntry! : item,
            )
          : current.filter((item) => item.id !== entry.id || item.lines !== null),
      );
      if (cause instanceof Error && cause.name === "AbortError") {
        setNotice("Import cancelled. Previous file kept.");
      } else {
        setError(
          cause instanceof Error && cause.name === "TypeError"
            ? "Could not decode this file. Use valid UTF-8 text."
            : cause instanceof Error
              ? cause.message
              : "Could not read file.",
        );
      }
    } finally {
      if (operation.current === id) {
        setPending(null);
        setParsing(false);
      }
    }
  }

  function removeFile(entry: ImportedFile) {
    const index = files.findIndex((item) => item.id === entry.id);
    const next = files.filter((item) => item.id !== entry.id);
    setFiles(next);
    void deleteDataset(entry.id).catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not remove dataset.",
      );
    });
    if (entry.id !== activeId) return;
    if (!next.length) {
      clearAll();
      return;
    }
    void activate(next[Math.min(index, next.length - 1)]);
  }

  function clearAll() {
    operation.current++;
    client.dispose();
    loadedFile.current = null;
    setLoadedDetail(null);
    setError("");
    setLog(null);
    setFiles([]);
    setActiveId(null);
    setFilterResult(null);
    setDraftFilters({ ...EMPTY_FILTERS });
    setSelected(null);
    setDetailsOpen(false);
    void clearDatasets().catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not clear datasets.",
      );
    });
    setNotice("Dataset cleared.");
  }

  async function reparse(nextParser: ParserId) {
    if (!log) {
      setParser(nextParser);
      return;
    }
    const id = ++operation.current;
    setProgress({ bytes: log.size, lines: log.lineCount });
    setPending({ name: log.name, size: log.size });
    setParsing(true);
    setParsedRows(0);
    setError("");
    setNotice("");
    try {
      const summary = await client.parseFile(nextParser, (event) => {
        if (operation.current === id) reportProgress(event);
      });
      if (operation.current !== id) return;
      setLoadedDetail(null);
      setParser(nextParser);
      setFiles((current) =>
        current.map((item) =>
          item.id === activeId
            ? { ...item, parser: nextParser, lines: summary.lineCount }
            : item,
        ),
      );
      setLog(summary);
      setFilterResult(null);
      setDraftFilters({ ...EMPTY_FILTERS });
      setSelected(null);
      setDetailsOpen(false);
      const current = files.find((item) => item.id === activeId);
      if (current)
        void saveDataset(
          datasetRecord({
            ...current,
            parser: nextParser,
            file: current.file,
            lineCount: summary.lineCount,
            order: Math.max(0, files.findIndex((item) => item.id === current.id)),
            lastOpenedAt: Date.now(),
          }),
        ).catch((cause) => {
          setPersistenceError(
            cause instanceof Error ? cause.message : "Could not save dataset.",
          );
        });
      if (activeId)
        void saveFilters(activeId, { ...EMPTY_FILTERS }).catch((cause) => {
          setPersistenceError(
            cause instanceof Error ? cause.message : "Could not save filters.",
          );
        });
      setNotice(
        `Parsed ${summary.total.toLocaleString()} records; ${summary.failed} failed.`,
      );
    } catch (cause) {
      if (operation.current !== id) return;
      if (cause instanceof Error && cause.name === "AbortError") {
        setNotice("Parsing cancelled. Previous dataset kept.");
      } else {
        setError(
          cause instanceof Error ? cause.message : "Could not parse file.",
        );
      }
    } finally {
      if (operation.current === id) {
        setPending(null);
        setParsing(false);
      }
    }
  }

  function selectLine(index: number) {
    setSelected(index);
    setDetailsOpen(true);
  }

  function applyChartPatch(patch: ChartFilterPatch) {
    setDraftFilters(applyChartFilterPatch(appliedFilters, patch));
    setView("structured");
    setSelected(null);
    setDetailsOpen(false);
  }

  function storeFilterPreset(name: string, filters: Filters) {
    const preset = { name: name.trim(), filters };
    if (!preset.name) return;
    setFilterPresets((current) => [
      ...current.filter((entry) => entry.name !== preset.name),
      preset,
    ]);
    void saveFilterPreset(preset.name, preset.filters).catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not save filter preset.",
      );
    });
  }

  function removeFilterPreset(name: string) {
    setFilterPresets((current) => current.filter((entry) => entry.name !== name));
    void deleteFilterPreset(name).catch((cause) => {
      setPersistenceError(
        cause instanceof Error ? cause.message : "Could not remove filter preset.",
      );
    });
  }
  const raw = detail?.raw ?? "";
  const navigation = (
    <>
      <div className="flex h-[76px] items-center gap-3 px-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Layers size={19} />
        </span>
        <span className="text-lg font-semibold tracking-tight">
          logline<span className="text-primary">.</span>
        </span>
        <Badge
          variant="outline"
          className="ml-auto text-[9px] text-muted-foreground"
        >
          LOCAL
        </Badge>
      </div>
      <div className="px-4">
        <div className="mb-7 flex items-center gap-3 rounded-lg border bg-white/[.025] p-3">
          <span className="flex size-8 items-center justify-center rounded bg-white/5">
            <Terminal size={16} />
          </span>
          <div>
            <p className="text-xs font-medium">Personal workspace</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Browser session
            </p>
          </div>
        </div>
        <p className="mb-3 px-2 text-[9px] font-medium tracking-[.15em] text-muted-foreground">
          WORKSPACE
        </p>
        <button
          onClick={() => setNavOpen(false)}
          aria-current="page"
          className="flex w-full items-center gap-3 rounded-md border border-primary/10 bg-primary/10 px-3 py-2.5 text-xs font-medium text-primary"
        >
          <ListFilter size={16} />
          Log explorer
          <span className="ml-auto size-1.5 rounded-full bg-primary" />
        </button>
        <div className="mt-8 flex items-center justify-between px-2 text-[9px] font-medium tracking-[.15em] text-muted-foreground">
          <span>DATASETS</span>
          <span>{String(files.length).padStart(2, "0")}</span>
        </div>
        {files.length ? (
          <ul className="mt-3 space-y-1">
            {files.map((entry) => (
              <li key={entry.id} className="group flex items-center gap-0.5">
                <button
                  onClick={() => {
                    setNavOpen(false);
                    void activate(entry);
                  }}
                  disabled={!!pending || !hydrated}
                  aria-current={entry.id === activeId ? "true" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-2 text-xs disabled:opacity-50 ${entry.id === activeId ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/5"}`}
                >
                  <FileText size={15} className="shrink-0" />
                  <span className="truncate" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.lines !== null && (
                    <span className="ml-auto shrink-0 font-mono text-[9px]">
                      {entry.lines.toLocaleString()}
                    </span>
                  )}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${entry.name}`}
                   disabled={!!pending || !hydrated}
                  onClick={() => removeFile(entry)}
                  className="size-7 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X size={13} />
                </Button>
              </li>
            ))}
           </ul>
         ) : (
          <p className="px-2 py-4 text-xs text-muted-foreground">
             {hydrated ? "No file imported yet" : "Restoring local workspace…"}
          </p>
        )}
      </div>
      <div className="mt-auto p-4">
        <div className="rounded-lg border border-primary/10 bg-primary/[.03] p-3">
          <ShieldCheck size={17} className="mb-2 text-primary" />
          <p className="text-xs font-medium">Your data. Your browser.</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            No uploads. No server processing. Nothing leaves your device.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-2 px-2 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          Local mode<span className="ml-auto">v0.2.0</span>
        </div>
      </div>
    </>
  );
  const details = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-xs font-medium">Line details</span>
        {selected !== null && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close line details"
            onClick={() => {
              setSelected(null);
              setDetailsOpen(false);
            }}
          >
            <X size={14} />
          </Button>
        )}
      </div>
      {selected === null || !log ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="rounded-xl border bg-white/[.02] p-4">
            <FileText size={23} className="text-muted-foreground" />
          </span>
          <p className="text-xs font-medium">A closer look</p>
          <p className="max-w-44 text-xs leading-relaxed text-muted-foreground">
            Select a log line to inspect its full raw content.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Badge variant="outline" className="font-mono text-primary">
            LINE{" "}
            {detail?.sourceLine ?? "…"}
          </Badge>
          <dl className="my-5 space-y-3 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Source</dt>
              <dd className="truncate" title={log.name}>
                {log.name}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Characters</dt>
              <dd>{raw.length.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">View</dt>
              <dd>{view === "raw" ? "Raw text" : "Structured"}</dd>
            </div>
          </dl>
          <LogDetailContent
            key={`${log.revision}-${view}-${selected}-${filterResult?.id}-${detailAttempt}`}
            detail={detail}
            error={matchingDetail?.error ?? ""}
            onRetry={() => setDetailAttempt((value) => value + 1)}
          />
        </div>
      )}
      <div className="border-t px-4 py-3 text-[10px] text-muted-foreground">
        Original content · No transformations
      </div>
    </div>
  );

  return (
    <div
      className="flex h-dvh min-h-[480px] bg-background text-foreground"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <aside className="hidden w-[232px] shrink-0 flex-col border-r bg-background md:flex">
        {navigation}
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="flex w-[270px] flex-col gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Local log workspace</SheetDescription>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[64px] shrink-0 items-center justify-between border-b px-4 sm:px-7">
          <div className="flex items-center gap-3 text-xs">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={18} />
            </Button>
            <span className="hidden text-muted-foreground sm:inline">
              Workspace
            </span>
            <ChevronRight
              size={12}
              className="hidden text-muted-foreground sm:block"
            />
            <span>Log explorer</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <label className="flex items-center gap-2 text-xs">
              <span className="hidden sm:inline">Theme</span>
              <select
                aria-label="Color theme"
                className="rounded border bg-background px-2 py-1"
                value={theme}
                disabled={!hydrated}
                onChange={(event) => setTheme(event.target.value as ThemePreference)}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </label>
            <details className="relative text-xs">
              <summary className="cursor-pointer">Shortcuts</summary>
              <p className="absolute right-0 z-50 mt-2 w-64 rounded border bg-popover p-3 text-popover-foreground shadow">
                / focuses search. ↑/↓, Home/End navigate rows. Enter inspects.
                Escape closes details. Ctrl/Cmd + Enter runs SQL in the editor.
                Resize columns with arrow keys on their handles.
              </p>
            </details>
            <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
              <ShieldCheck size={13} />
              On-device processing
            </span>
            <span className="hidden size-7 items-center justify-center rounded-full border bg-muted text-[10px] sm:flex">
              LW
            </span>
          </div>
        </header>
        <div className="px-4 pb-5 pt-6 sm:px-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight">
                  Log explorer
                </h1>
                <Badge
                  variant="outline"
                  className="text-[9px] text-muted-foreground"
                >
                   PHASE 10
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Less noise. More context. Explore your logs locally.
              </p>
            </div>
            <Button
               disabled={!!pending || !hydrated}
              onClick={() => picker.current?.click()}
              size="sm"
            >
              <ArrowUpFromLine size={14} />
              Import file
            </Button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "ACTIVE FILE",
                value: files.length
                  ? `${files.length} dataset${files.length === 1 ? "" : "s"}`
                  : "No dataset",
                sub: log?.name ?? "Import a file to get started",
                icon: FolderOpen,
              },
              {
                label: "FILE SIZE",
                value: log ? formatBytes(log.size) : "—",
                sub: "50 MB import limit",
                icon: HardDrive,
              },
              {
                label: "TOTAL LINES",
                value: log ? log.lineCount.toLocaleString() : "—",
                sub: "Unmodified raw content",
                icon: FileText,
              },
              {
                label: "PROCESSING",
                value: "Web Worker",
                sub: "Background thread, browser-only",
                icon: Activity,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="min-w-0 rounded-lg border bg-card px-4 py-3"
              >
                <div className="flex items-center justify-between text-[9px] tracking-wider text-muted-foreground">
                  <span>{stat.label}</span>
                  <stat.icon size={13} />
                </div>
                <p className="mt-3 text-lg font-medium tracking-tight">
                  {stat.value}
                </p>
                <p
                  className="mt-1 truncate text-[10px] text-muted-foreground"
                  title={stat.sub}
                >
                  {stat.sub}
                </p>
              </div>
            ))}
          </div>
        </div>
        <input
          ref={picker}
          aria-label="Replace or import log file"
          className="hidden"
          type="file"
          accept={ACCEPT}
          multiple
          onChange={(e) => {
            if (e.target.files) void importFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        {error && (
          <div
            role="alert"
            className="mx-4 mb-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive sm:mx-7"
          >
            {error}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={14} />
            </Button>
          </div>
        )}
        {persistenceError && (
          <p
            role="status"
            className="mx-4 mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 sm:mx-7"
          >
            Local persistence unavailable: {persistenceError}
          </p>
        )}
        <div aria-live="polite" className="sr-only">
          {notice}
        </div>
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 text-xs sm:mx-7">
          <label className="flex items-center gap-2">
            Parser
            <select
              aria-label="Parser"
              className="max-w-52 rounded border bg-background p-2"
              value={parser}
             disabled={!!pending || !hydrated}
              onChange={(event) => void reparse(event.target.value as ParserId)}
            >
              {PARSERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {log && (
            <div role="group" aria-label="Log view" className="flex gap-1">
              <Button
                size="sm"
                variant={view === "raw" ? "secondary" : "ghost"}
                aria-pressed={view === "raw"}
                onClick={() => {
                  setView("raw");
                  setRestoreQueryOutput(false);
                  setSelected(null);
                  setDetailsOpen(false);
                }}
              >
                Raw
              </Button>
              <Button
                size="sm"
                variant={view === "structured" ? "secondary" : "ghost"}
                aria-pressed={view === "structured"}
                onClick={() => {
                  setView("structured");
                  setRestoreQueryOutput(false);
                  setSelected(null);
                  setDetailsOpen(false);
                }}
              >
                Structured
              </Button>
              <Button
                size="sm"
                variant={view === "query" ? "secondary" : "ghost"}
                aria-pressed={view === "query"}
                onClick={() => {
                  setView("query");
                  setRestoreQueryOutput(false);
                  setSelected(null);
                  setDetailsOpen(false);
                }}
              >
                Query
              </Button>
              <Button
                size="sm"
                variant={view === "analytics" ? "secondary" : "ghost"}
                aria-pressed={view === "analytics"}
                onClick={() => {
                  setView("analytics");
                  setRestoreQueryOutput(false);
                  setSelected(null);
                  setDetailsOpen(false);
                }}
              >
                <BarChart3 size={13} />
                Analytics
              </Button>
            </div>
          )}
          {log && (
            <span
              className={log.failed ? "text-destructive" : "text-muted-foreground"}
            >
              {log.failed.toLocaleString()} failed
            </span>
          )}
          <span className="text-muted-foreground">
            {parser === "syslog"
              ? "Legacy timestamps retain unknown year/timezone."
              : parser === "access"
                ? "Custom timing values retain source units."
                : "Choose format explicitly. Blank lines skipped."}
          </span>
        </div>
        {pending && (
          <div className="mx-4 mb-4 rounded-lg border bg-card p-4 sm:mx-7">
            <div className="mb-3 flex items-center justify-between gap-3 text-xs">
              <span className="truncate">
                {parsing ? "Parsing" : "Reading"} {pending.name} ·{" "}
                {(parsing ? parsedRows : progress.lines).toLocaleString()} lines
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => client.cancel()}
              >
                Cancel import
              </Button>
            </div>
            <Progress
              aria-label="File import progress"
              value={
                parsing
                  ? progress.lines || log?.lineCount
                    ? (parsedRows / (progress.lines || log!.lineCount)) * 100
                    : 0
                  : pending.size
                    ? (progress.bytes / pending.size) * 100
                    : 0
              }
            />
            <p className="mt-2 text-[10px] text-muted-foreground">
              {parsing
                ? "Parsing locally · previous dataset kept until complete"
                : `${formatBytes(progress.bytes)} / ${formatBytes(pending.size)}`}
            </p>
          </div>
        )}
        {((pending?.size ?? 0) >= 10 * 1024 * 1024 || (log?.size ?? 0) >= 10 * 1024 * 1024 || (log?.total ?? 0) >= 100_000) && (
          <p role="note" aria-label="Memory warning" className="mx-4 mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 sm:mx-7">
            Large dataset: parsed records, DuckDB queries, and download Blobs can use much more memory than the input file.
            Prefer aggregates or SQL limits; export only what you need. Only the active file is parsed. Limits: 50 MiB and 1,250,000 source lines.
          </p>
        )}
        {log && (
          <LogFilters
            key={`filters-${log.revision}`}
            client={client}
            revision={log.revision}
                 disabled={!!pending || !hydrated}
            hasTime={log.hasTime}
            filters={draftFilters}
            onFiltersChange={setDraftFilters}
            presets={filterPresets}
            onSavePreset={storeFilterPreset}
            onLoadPreset={setDraftFilters}
            onDeletePreset={removeFilterPreset}
            onChange={(result) => {
              // The initial debounced no-filter notification is not a scope
              // change and must not erase a row selected just after import.
              if (result === filterResult) return;
              setFilterResult(result);
              setSelected(null);
              setDetailsOpen(false);
            }}
          />
        )}
        {log && filterResult && (
          <p
            aria-label="Filter results"
            className="mx-4 mb-3 text-xs text-muted-foreground sm:mx-7"
          >
            {filterResult.total.toLocaleString()} matching records ·{" "}
            {filterResult.lineCount.toLocaleString()} source lines
          </p>
        )}
        <section
          className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/30 sm:mx-7 sm:mb-6"
          aria-label="Log workspace"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Terminal size={15} className="text-primary" />
              <span className="truncate">{log?.name ?? "Raw log viewer"}</span>
              <Badge variant="secondary" className="text-[9px]">
                {log ? view.toUpperCase() : "READY"}
              </Badge>
            </div>
            {log && (
              <Button
                variant="ghost"
                size="sm"
                 disabled={!!pending || !hydrated}
                onClick={clearAll}
              >
                <Trash2 size={13} />
                Clear
              </Button>
            )}
          </div>
          {log && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={!!pending || !hydrated}
                onClick={() => {
                  const file = loadedFile.current;
                  if (file) downloadBlob(file, file.name);
                }}
              >
                <Download size={13} />
                Download original
              </Button>
              {view !== "query" && (
                <>
                  <ExportControls
                    key={`logs-export-${log.revision}-${JSON.stringify(appliedFilters)}-${JSON.stringify(draftFilters)}`}
                    kind="logs"
                    disabled={!!pending || !hydrated || !exportFiltersReady}
                    onExport={(format) => client.exportLogs(log.revision, appliedFilters, format)}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Exports all matching structured records, not just visible rows.
                  </span>
                </>
              )}
            </div>
          )}
          {!log ? (
            <div className="min-h-0 flex-1 overflow-auto px-5 py-8">
              <div className="mb-7 text-center">
                <h2 className="text-lg font-medium tracking-tight">
                  Every investigation starts with a log.
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  Open a file to explore every line, right here in your browser.
                </p>
              </div>
              <FileImport
                onFiles={(files) => void importFiles(files)}
                 disabled={!!pending || !hydrated}
              />
            </div>
          ) : view === "query" ? (
            <ViewBoundary key={`query-boundary-${log.revision}`}>
            <Suspense
              fallback={
                <p className="p-4 text-xs text-muted-foreground">
                  Loading query editor…
                </p>
              }
            >
              <QueryWorkspace
                key={`query-${log.revision}`}
                client={client}
                summary={log}
                sql={sql}
                onSql={setSql}
                history={history}
                onHistory={setHistory}
                 saved={saved}
                 onSaved={setSaved}
                 disabled={!!pending || !hydrated}
                 autoRun={restoreQueryOutput}
                 dark={dark}
              />
            </Suspense>
            </ViewBoundary>
            ) : view === "analytics" ? (
              <ViewBoundary key={`analytics-boundary-${log.revision}`}>
             <Suspense
               fallback={
                 <p className="p-4 text-xs text-muted-foreground">
                   Loading analytics…
                 </p>
               }
             >
               <AnalyticsDashboard
                 key={`analytics-${log.revision}-${JSON.stringify(appliedFilters)}`}
                 client={client}
                 summary={log}
                 filters={appliedFilters}
                 onApplyFilter={applyChartPatch}
               />
              </Suspense>
              </ViewBoundary>
           ) : (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                {view === "structured" ? (
                  <StructuredTable
                    key={`structured-${log.revision}-${filterResult?.id ?? "all"}`}
                    client={client}
                    summary={log}
                    filterId={filterResult?.id}
                    total={filterResult ? filterResult.total : null}
                    selected={selected}
                    onSelect={selectLine}
                  />
                ) : log.lineCount ? (
                  <LogTable
                    key={`raw-${log.revision}-${filterResult?.id ?? "all"}`}
                    client={client}
                    revision={log.revision}
                    lineCount={
                      filterResult ? filterResult.lineCount : log.lineCount
                    }
                    filterId={filterResult?.id}
                    selected={selected}
                    onSelect={selectLine}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    This file is empty. Import another file to begin.
                  </div>
                )}
              </div>
              <aside className="hidden w-[300px] shrink-0 flex-col border-l xl:flex">
                {details}
              </aside>
            </div>
          )}
        </section>
        <Sheet
          open={detailsOpen && selected !== null && compact}
          onOpenChange={setDetailsOpen}
        >
          <SheetContent className="flex flex-col gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Selected log line</SheetTitle>
              <SheetDescription>
                Inspect original raw log content
              </SheetDescription>
            </SheetHeader>
            {details}
          </SheetContent>
        </Sheet>
      </main>
    </div>
  );
}
export default App;
