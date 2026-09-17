import type { ParsedRecord, ParserId } from "../parsers/types";
import type { QueryPreset, QueryResult } from "../queries";

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
};
export type RecordEntry = ParsedRecord;
export type LogDetail = { raw: string; entry: RecordEntry | null };
export type LogRequest =
  | { id: number; type: "LOAD_FILE"; file: File; parser: ParserId }
  | { id: number; type: "PARSE_FILE"; parser: ParserId }
  | {
      id: number;
      type: "GET_RAW_ROWS" | "GET_RECORDS";
      revision: number;
      start: number;
      count: number;
    }
  // Structured uses record indexes; raw uses source line indexes.
  | {
      id: number;
      type: "GET_DETAIL";
      revision: number;
      index: number;
      structured: boolean;
    }
  | { id: number; type: "RUN_QUERY"; revision: number; preset: QueryPreset }
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
        | string[]
        | RecordEntry[]
        | LogDetail
        | QueryResult
        | null;
    }
  | { id: number; ok: false; error: string; name: string };
export type LogEvent =
  | { id: number; type: "READ_PROGRESS"; bytes: number; lines: number }
  | { id: number; type: "PARSE_PROGRESS"; rows: number; total: number };
