import type { Filters, FilterSummary } from "../filters";
import type { ParserId } from "../parsers/types";
import type { QueryResult } from "../queries";
import type {
  LogDetail,
  LogEvent,
  LogResponse,
  LogSummary,
  AnalyticsSnapshot,
  RecordEntry,
  RawEntry,
  RequestPayload,
  ExportFormat,
  ExportResult,
} from "./messages";
export type { ExportFormat, ExportResult } from "./messages";

export class LogWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private operation: number | null = null;
  private queryRequest: number | null = null;
  private failure: Error | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      onProgress?: (event: LogEvent) => void;
    }
  >();
  onError: (error: Error) => void = () => {};

  private spawn(): Worker {
    const worker = new Worker(new URL("./log-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<LogResponse | LogEvent>) => {
      const handler = this.pending.get(data.id);
      if (!handler) return;
      if ("type" in data) {
        handler.onProgress?.(data);
        return;
      }
      this.pending.delete(data.id);
      if (this.operation === data.id) this.operation = null;
      if (this.queryRequest === data.id) this.queryRequest = null;
      if (data.ok) handler.resolve(data.result);
      else
        handler.reject(
          Object.assign(new Error(data.error), { name: data.name }),
        );
    };
    const crash = () => {
      const error = new Error(
        "Worker crashed. Clear dataset or reload to recover.",
      );
      this.dispose(error);
      this.failure = error;
      this.onError(error);
    };
    worker.onerror = crash;
    worker.onmessageerror = crash;
    return worker;
  }

  private request<T>(
    payload: RequestPayload,
    onProgress?: (event: LogEvent) => void,
  ): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    if (payload.type === "LOAD_FILE" || payload.type === "PARSE_FILE")
      this.operation = id;
    if (payload.type === "RUN_QUERY") this.queryRequest = id;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        onProgress,
      });
      try {
        this.worker ??= this.spawn();
        this.worker.postMessage({ ...payload, id });
      } catch (cause) {
        this.pending.delete(id);
        if (this.operation === id) this.operation = null;
        if (this.queryRequest === id) this.queryRequest = null;
        reject(cause);
      }
    });
  }

  cancel() {
    if (this.operation !== null)
      void this.request<null>({ type: "CANCEL", target: this.operation }).catch(
        () => {},
      );
  }

  /**
   * Cancel the most recently submitted, still-pending query() request by id.
   * Resolves when the Worker has marked that run cancelled (a completed run is
   * a no-op). The run rejects with name "AbortError". Engine cleanup remains in
   * the SQL queue, ahead of subsequent work; the dataset and Worker stay alive.
   * Earlier overlapping runs are not targeted, nor are imports or exports.
   */
  async cancelQuery(): Promise<void> {
    const target = this.queryRequest;
    if (target !== null)
      await this.request<null>({ type: "CANCEL_QUERY", target });
  }

  dispose(error: Error = new DOMException("Aborted", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const handler of this.pending.values()) handler.reject(error);
    this.pending.clear();
    this.operation = null;
    this.queryRequest = null;
    this.failure = null;
  }

  loadFile(
    file: File,
    parser: ParserId,
    onProgress: (event: LogEvent) => void,
  ) {
    this.cancel();
    return this.request<LogSummary>(
      { type: "LOAD_FILE", file, parser },
      onProgress,
    );
  }

  parseFile(parser: ParserId, onProgress: (event: LogEvent) => void) {
    this.cancel();
    return this.request<LogSummary>({ type: "PARSE_FILE", parser }, onProgress);
  }

  query(revision: number, sql: string) {
    return this.request<QueryResult>({ type: "RUN_QUERY", revision, sql });
  }

  /** Full structured logs matching this filter snapshot, in source-line order. */
  exportLogs(revision: number, filters: Filters, format: ExportFormat) {
    return this.request<ExportResult>({
      type: "EXPORT_LOGS",
      revision,
      filters,
      format,
    });
  }

  /**
   * Re-execute the Worker's last successful query, without the preview row cap.
   * A new run (including a failed run) or dataset revision invalidates that SQL.
   * JSON: {columns, rows}; JSONL: {columns} then {row} lines. Rows are positional.
   */
  exportQuery(revision: number, format: ExportFormat) {
    return this.request<ExportResult>({
      type: "EXPORT_QUERY",
      revision,
      format,
    });
  }

  analytics(revision: number, filters: Filters) {
    return this.request<AnalyticsSnapshot>({
      type: "GET_ANALYTICS",
      revision,
      filters,
    });
  }

  filter(revision: number, filters: Filters) {
    return this.request<FilterSummary>({ type: "FILTER", revision, filters });
  }

  rawRows(revision: number, start: number, count: number, filterId?: number) {
    return this.request<RawEntry[]>({
      type: "GET_RAW_ROWS",
      filterId,
      revision,
      start,
      count,
    });
  }

  records(revision: number, start: number, count: number, filterId?: number) {
    return this.request<RecordEntry[]>({
      type: "GET_RECORDS",
      filterId,
      revision,
      start,
      count,
    });
  }

  detail(
    revision: number,
    index: number,
    structured: boolean,
    filterId?: number,
  ) {
    return this.request<LogDetail>({
      type: "GET_DETAIL",
      filterId,
      revision,
      index,
      structured,
    });
  }
}
