/// <reference lib="webworker" />
import { parseDataset, recordRaw } from "../parsers";
import { displayValue, type ParsedDataset } from "../parsers/types";
import { lineAt, readLogFile, type LogFile } from "../read-log-file";
import type { Filters, FilterSummary } from "../filters";
import type {
  RawEntry,
  LogEvent,
  LogRequest,
  LogResponse,
  LogSummary,
  RecordEntry,
} from "./messages";

let current: { log: LogFile; dataset: ParsedDataset; revision: number } | null =
  null;
let revision = 0;
let filterGeneration = 0;
let filtered: {
  summary: FilterSummary;
  records: Uint32Array;
  lines: Uint32Array;
} | null = null;
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
        filtered = null;
        filterGeneration++;
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
          hasTime: dataset.records.some((entry) => !!entry.record.timestamp),
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
    if (request.type === "FILTER") {
      const generation = ++filterGeneration;
      const { filterLines } = await import("./database");
      const lines = await filterLines(
        request.revision,
        log,
        dataset,
        request.filters,
      );
      if (
        current?.revision !== request.revision ||
        generation !== filterGeneration
      )
        throw new Error("Filter superseded.");
      const indexes: number[] = [];
      const rawLines: number[] = [];
      let match = 0;
      dataset.records.forEach((entry, index) => {
        if (match < lines.length && entry.row === lines[match]) {
          indexes.push(index);
          for (let row = entry.row; row <= (entry.endRow ?? entry.row); row++)
            rawLines.push(row);
          match++;
        }
      });
      const summary: FilterSummary = {
        id: request.id,
        revision: request.revision,
        total: indexes.length,
        lineCount: rawLines.length,
        filters: request.filters,
      };
      filtered = {
        summary,
        records: Uint32Array.from(indexes),
        lines: Uint32Array.from(rawLines),
      };
      respond({ id: request.id, ok: true, result: summary });
      return;
    }
    if (request.type === "RUN_QUERY") {
      const { runPreset } = await import("./database");
      const result = await runPreset(
        request.revision,
        log,
        dataset,
        request.preset,
      );
      if (current?.revision !== request.revision)
        throw new Error("Dataset changed. Run query again.");
      respond({ id: request.id, ok: true, result });
      return;
    }
    const selection = request.filterId === undefined ? null : filtered;
    if (
      request.filterId !== undefined &&
      selection?.summary.id !== request.filterId
    )
      throw new Error("Filter changed.");
    const highlights = async (texts: string[]) => {
      if (!selection) return texts.map(() => []);
      const { highlightTexts } = await import("./database");
      return highlightTexts(
        request.revision,
        log,
        dataset,
        selection.summary.filters as Filters,
        texts,
      );
    };
    if (request.type === "GET_DETAIL") {
      const total = request.structured
        ? (selection?.records.length ?? dataset.records.length)
        : (selection?.lines.length ?? log.starts.length);
      if (
        !Number.isInteger(request.index) ||
        request.index < 0 ||
        request.index >= total
      )
        throw new Error("Invalid row index.");
      const index = selection
        ? request.structured
          ? selection.records[request.index]
          : selection.lines[request.index]
        : request.index;
      const entry = request.structured ? dataset.records[index] : null;
      const raw = entry
        ? recordRaw(log, entry.row, entry.endRow)
        : lineAt(log, index);
      const [ranges] = await highlights([raw]);
      respond({
        id: request.id,
        ok: true,
        result: { raw, entry, highlights: ranges },
      });
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
      const rows: RawEntry[] = [];
      for (
        let i = request.start;
        i <
        Math.min(
          request.start + request.count,
          selection?.lines.length ?? log.starts.length,
        );
        i++
      ) {
        const row = selection ? selection.lines[i] : i;
        rows.push({ row, raw: lineAt(log, row).slice(0, 2001) });
      }
      const ranges = await highlights(rows.map((row) => row.raw));
      rows.forEach((row, i) => {
        row.highlights = ranges[i];
      });
      respond({ id: request.id, ok: true, result: rows });
    } else {
      // Preview values only; full nested fields/raw text fetched on selection.
      const entries = selection
        ? Array.from(
            selection.records.slice(
              request.start,
              request.start + request.count,
            ),
            (index) => dataset.records[index],
          )
        : dataset.records.slice(request.start, request.start + request.count);
      const rows: RecordEntry[] = entries.map((entry) => ({
        ...entry,
        record: Object.fromEntries(
          Object.entries(entry.record).map(([key, value]) => [
            key,
            displayValue(value).slice(0, 2001),
          ]),
        ) as RecordEntry["record"],
      }));
      const ranges = await highlights(
        rows.map((entry) => String(entry.record.message ?? "")),
      );
      rows.forEach((entry, i) => {
        entry.highlights = ranges[i];
      });
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
