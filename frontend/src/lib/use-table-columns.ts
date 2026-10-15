import { useEffect, useState } from "react";

export type TableColumnDefinition = {
  // IDs must be unique and stable; labels may repeat (for example, SQL results).
  id: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  hideable?: boolean;
};

export type TableColumnLayout = TableColumnDefinition & {
  width: number;
  minWidth: number;
  maxWidth: number;
  visible: boolean;
};

type Preferences = Record<string, { width?: number; visible?: boolean }>;

function readPreferences(storageKey?: string): Preferences {
  if (!storageKey) return {};
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).flatMap(([id, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        return [[id, {
          width: typeof value.width === "number" && Number.isFinite(value.width)
            ? value.width : undefined,
          visible: typeof value.visible === "boolean" ? value.visible : undefined,
        }]];
      }),
    );
  } catch {
    // Restricted storage or a malformed saved value must not disable the table.
    return {};
  }
}

function clampWidth(width: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(width) ? width : min)));
}

/** Optional storageKey is stable for the hook's lifetime; storage is tab-local. */
export function useTableColumns<T extends TableColumnDefinition>(
  definitions: readonly T[],
  storageKey?: string,
) {
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Controls still work in memory when storage is unavailable or full.
    }
  }, [preferences, storageKey]);

  const columns = definitions.map((definition): T & TableColumnLayout => {
    const minWidth = clampWidth(definition.minWidth ?? 80, 48, 1200);
    const maxWidth = clampWidth(definition.maxWidth ?? 800, minWidth, 1200);
    const defaultWidth = clampWidth(definition.defaultWidth, minWidth, maxWidth);
    const saved = Object.hasOwn(preferences, definition.id)
      ? preferences[definition.id] : undefined;
    return {
      ...definition,
      minWidth,
      maxWidth,
      defaultWidth,
      width: clampWidth(saved?.width ?? defaultWidth, minWidth, maxWidth),
      visible: definition.hideable === false || saved?.visible !== false,
    };
  });
  const visibleColumns = columns.filter((column) => column.visible);

  return {
    columns,
    visibleColumns,
    template: visibleColumns.map((column) => `${column.width}px`).join(" "),
    totalWidth: visibleColumns.reduce((width, column) => width + column.width, 0),
    setVisible(id: string, visible: boolean) {
      const column = columns.find((column) => column.id === id);
      if (!column || column.hideable === false) return;
      setPreferences((previous) => ({
        ...previous,
        [id]: { ...previous[id], visible },
      }));
    },
    setWidth(id: string, width: number) {
      const column = columns.find((column) => column.id === id);
      if (!column || !Number.isFinite(width)) return;
      setPreferences((previous) => ({
        ...previous,
        [id]: { ...previous[id], width: clampWidth(width, column.minWidth, column.maxWidth) },
      }));
    },
    reset() {
      setPreferences({});
    },
  };
}
