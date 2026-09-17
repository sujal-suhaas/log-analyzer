/// <reference lib="webworker" />
import { parseDataset, recordRaw } from "../parsers";
import { displayValue, type ParsedDataset } from "../parsers/types";
import { lineAt, readLogFile, type LogFile } from "../read-log-file";
import type {
  LogEvent,
  LogRequest,
  LogResponse,
  LogSummary,
  RecordEntry,
} from "./messages";

let current: { log: LogFile; dataset: ParsedDataset; revision: number } | null =
  null;
let revision = 0;
let active: { id: number; controller: AbortController } | null = null;
const respond = (response: LogResponse | LogEvent) =>
  self.postMessage(response);

self.onmessage = async ({ data: request }: MessageEvent<LogRequest>) => {
  try {
    if (request.type === "CANCEL") {
      if (active?.id === request.target) active.controller.abort();
      respond({ id: request.id, ok: true, result: null });
      return;
    }
    if (request.type === "LOAD_FILE" || request.type === "PARSE_FILE") {
      active?.controller.abort();
      const operation = { id: request.id, controller: new AbortController() };
      active = operation;
      const signal = operation.controller.signal;
      try {
        const log =
          request.type === "LOAD_FILE"
            ? await readLogFile(request.file, signal, (progress) =>
                respond({ id: request.id, type: "READ_PROGRESS", ...progress }),
              )
            : current?.log;
        if (!log) throw new Error("Import a file first.");
        const dataset = await parseDataset(
          log,
          request.parser,
          signal,
          (rows) =>
            respond({
              id: request.id,
              type: "PARSE_PROGRESS",
              rows,
              total: log.starts.length,
            }),
        );
        signal.throwIfAborted();
        // Commit once, only after reading AND parsing succeed. Cancel keeps old data.
        current = { log, dataset, revision: ++revision };
        const result: LogSummary = {
          revision,
          name: log.name,
          size: log.size,
          lineCount: log.starts.length,
          parser: dataset.parser,
          total: dataset.records.length,
          failed: dataset.failed,
          skipped: dataset.skipped,
          extras: dataset.extras,
        };
        respond({ id: request.id, ok: true, result });
      } finally {
        if (active === operation) active = null;
      }
      return;
    }
    if (!current || current.revision !== request.revision)
      throw new Error("Dataset changed. Retry with current dataset.");
    const { log, dataset } = current;
    if (request.type === "GET_DETAIL") {
      const total = request.structured
        ? dataset.records.length
        : log.starts.length;
      if (
        !Number.isInteger(request.index) ||
        request.index < 0 ||
        request.index >= total
      )
        throw new Error("Invalid row index.");
      const entry = request.structured ? dataset.records[request.index] : null;
      const raw = entry
        ? recordRaw(log, entry.row, entry.endRow)
        : lineAt(log, request.index);
      respond({ id: request.id, ok: true, result: { raw, entry } });
      return;
    }
    if (
      !Number.isInteger(request.start) ||
      request.start < 0 ||
      !Number.isInteger(request.count) ||
      request.count < 0 ||
      request.count > 256
    )
      throw new Error("Invalid row window.");
    if (request.type === "GET_RAW_ROWS") {
      const rows: string[] = [];
      for (
        let i = request.start;
        i < Math.min(request.start + request.count, log.starts.length);
        i++
      )
        rows.push(lineAt(log, i).slice(0, 2001));
      respond({ id: request.id, ok: true, result: rows });
    } else {
      // Preview values only; full nested fields/raw text fetched on selection.
      const rows: RecordEntry[] = dataset.records
        .slice(request.start, request.start + request.count)
        .map((entry) => ({
          ...entry,
          record: Object.fromEntries(
            Object.entries(entry.record).map(([key, value]) => [
              key,
              displayValue(value).slice(0, 2001),
            ]),
          ) as RecordEntry["record"],
        }));
      respond({ id: request.id, ok: true, result: rows });
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Worker error");
    respond({
      id: request.id,
      ok: false,
      error: error.message,
      name: error.name,
    });
  }
};
