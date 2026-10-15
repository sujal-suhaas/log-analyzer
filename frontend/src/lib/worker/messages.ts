import type { ParsedRecord, ParserId } from "../parsers/types";
import type { QueryResult } from "../queries";
import type { Filters, FilterSummary, Highlight } from "../filters";
import type { ExportFormat, ExportResult } from "../export";
export type { ExportFormat, ExportResult } from "../export";

// Worker owns text, offsets and records. UI receives summaries and bounded windows.
export type LogSummary = {
  revision: number;
  name: string;
  size: number;
  lineCount: number;
  parser: ParserId;
  total: number;
  failed: number;
  skipped: number;
  extras: string[];
  hasTime: boolean;
};
export type RecordEntry = ParsedRecord & { highlights?: Highlight[] };
export type RawEntry = { row: number; raw: string; highlights?: Highlight[] };
export type LogDetail = {
  sourceLine: number;
  raw: string;
  entry: RecordEntry | null;
  highlights?: Highlight[];
};
export type AnalyticsGranularity = "minute" | "hour" | "day" | "week";
export type AnalyticsTimePoint = {
  startMs: number;
  endMs: number;
  logs: number;
  errors: number;
};
export type AnalyticsCountPoint = { value: string | null; count: number };
export type AnalyticsStatusPoint = { status: number | null; count: number };
export type AnalyticsMessagePoint = {
  filterText: string;
  label: string;
  count: number;
  truncated: boolean;
};
export type AnalyticsSnapshot = {
  revision: number;
  scope: {
    totalLogs: number;
    errorLogs: number;
    timestampedLogs: number;
    minTimeMs: number | null;
    maxTimeMs: number | null;
  };
  time: {
    granularity: AnalyticsGranularity | null;
    points: AnalyticsTimePoint[];
  };
  levels: AnalyticsCountPoint[];
  services: { points: AnalyticsCountPoint[]; hasMore: boolean };
  errorMessages: { points: AnalyticsMessagePoint[]; hasMore: boolean };
  statusCodes: AnalyticsStatusPoint[];
  latency: {
    sampleCount: number;
    averageMs: number | null;
    p95Ms: number | null;
  };
};
export type LogRequest =
  | { id: number; type: "LOAD_FILE"; file: File; parser: ParserId }
  | { id: number; type: "PARSE_FILE"; parser: ParserId }
  | {
      id: number;
      type: "GET_RAW_ROWS" | "GET_RECORDS";
      revision: number;
      start: number;
      count: number;
      filterId?: number;
    }
  // Structured uses record indexes; raw uses source line indexes.
  | {
      id: number;
      type: "GET_DETAIL";
      revision: number;
      index: number;
      structured: boolean;
      filterId?: number;
    }
  | { id: number; type: "RUN_QUERY"; revision: number; sql: string }
  | {
      id: number;
      type: "EXPORT_LOGS";
      revision: number;
      filters: Filters;
      format: ExportFormat;
    }
  | {
      id: number;
      type: "EXPORT_QUERY";
      revision: number;
      format: ExportFormat;
    }
  | { id: number; type: "GET_ANALYTICS"; revision: number; filters: Filters }
  | { id: number; type: "FILTER"; revision: number; filters: Filters }
  // Request-scoped: only RUN_QUERY with this id; never import/export or the Worker.
  | { id: number; type: "CANCEL_QUERY"; target: number }
  | { id: number; type: "CANCEL"; target: number };
export type RequestPayload = LogRequest extends infer R
  ? R extends LogRequest
    ? Omit<R, "id">
    : never
  : never;
export type LogResponse =
  | {
      id: number;
      ok: true;
      result:
        | LogSummary
        | RawEntry[]
        | FilterSummary
        | RecordEntry[]
        | LogDetail
        | QueryResult
        | AnalyticsSnapshot
        | ExportResult
        | null;
    }
  | { id: number; ok: false; error: string; name: string };
export type LogEvent =
  | { id: number; type: "READ_PROGRESS"; bytes: number; lines: number }
  | { id: number; type: "PARSE_PROGRESS"; rows: number; total: number };
