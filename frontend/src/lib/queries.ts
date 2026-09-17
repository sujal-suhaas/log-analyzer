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
export type QueryResult = {
  columns: string[];
  rows: string[][];
  elapsedMs: number;
};
