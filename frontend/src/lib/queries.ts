export const QUERIES = {
  count: { label: "Count logs", sql: "SELECT COUNT(*) AS total FROM logs;" },
  latest: {
    label: "Latest logs",
    sql: "SELECT source_line, CAST(timestamp AS VARCHAR) AS timestamp, level, service, message, parse_error FROM logs ORDER BY logs.timestamp DESC NULLS LAST, source_line ASC LIMIT 100;",
  },
  levels: {
    label: "Counts by level",
    sql: "SELECT level, COUNT(*) AS total FROM logs GROUP BY level ORDER BY total DESC, level ASC NULLS LAST;",
  },
} as const;
export type QueryPreset = keyof typeof QUERIES;
// These are the physical columns in the worker-owned `logs` table. Discovered
// parser fields live inside the `extras` JSON column rather than becoming
// individual SQL columns.
export const LOG_COLUMNS = [
  "source_line",
  "timestamp",
  "level",
  "service",
  "host",
  "status",
  "duration_ms",
  "message",
  "raw",
  "extras",
  "parse_error",
] as const;
// ponytail: rows beyond this are fetched by DuckDB but not sent to React; streaming export is Phase 9.
export const SQL_LIMIT = 5000;
export type QueryResult = {
  columns: string[];
  rows: string[][];
  elapsedMs: number;
  /** Rows the engine returned that were not sent to the UI. */
  truncated: number;
};
