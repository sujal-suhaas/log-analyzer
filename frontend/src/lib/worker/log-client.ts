import type { ParserId } from "../parsers/types";
import type {
  LogDetail,
  LogEvent,
  LogResponse,
  LogSummary,
  RecordEntry,
  RequestPayload,
} from "./messages";

export class LogWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private operation: number | null = null;
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

  dispose(error: Error = new DOMException("Aborted", "AbortError")) {
    this.worker?.terminate();
    this.worker = null;
    for (const handler of this.pending.values()) handler.reject(error);
    this.pending.clear();
    this.operation = null;
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

  rawRows(revision: number, start: number, count: number) {
    return this.request<string[]>({
      type: "GET_RAW_ROWS",
      revision,
      start,
      count,
    });
  }

  records(revision: number, start: number, count: number) {
    return this.request<RecordEntry[]>({
      type: "GET_RECORDS",
      revision,
      start,
      count,
    });
  }

  detail(revision: number, index: number, structured: boolean) {
    return this.request<LogDetail>({
      type: "GET_DETAIL",
      revision,
      index,
      structured,
    });
  }
}
