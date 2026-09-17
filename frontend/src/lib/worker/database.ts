import * as duckdb from "@duckdb/duckdb-wasm";
import wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import workerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import { CORE_FIELDS, type ParsedDataset } from "../parsers/types";
import { recordRaw } from "../parsers";
import type { LogFile } from "../read-log-file";
import { QUERIES, type QueryPreset, type QueryResult } from "../queries";
import { filterWhere, type Filters, type Highlight } from "../filters";

let engine: Promise<{
  db: duckdb.AsyncDuckDB;
  connection: duckdb.AsyncDuckDBConnection;
}> | null = null;
let loadedRevision = -1;
let queue: Promise<unknown> = Promise.resolve();
async function open() {
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(wasm);
    const connection = await db.connect();
    const repository = new URL(
      `${import.meta.env.BASE_URL}duckdb-extensions`,
      self.location.origin,
    ).href;
    await connection.query(
      `SET custom_extension_repository = '${repository.replaceAll("'", "''")}'; LOAD json; SELECT 1 AS ready;`,
    );
    return { db, connection };
  } catch (error) {
    worker.terminate();
    engine = null;
    throw error;
  }
}

// Load on first preset run. Keep SQL work serialized and old table until commit.
function withDatabase<T>(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  action: (connection: duckdb.AsyncDuckDBConnection) => Promise<T>,
): Promise<T> {
  const task = queue.then(async () => {
    const { db, connection } = await (engine ??= open());
    if (loadedRevision !== revision) {
      await connection.query(
        "BEGIN TRANSACTION; CREATE OR REPLACE TABLE logs (source_line INTEGER, timestamp TIMESTAMPTZ, level VARCHAR, service VARCHAR, host VARCHAR, status INTEGER, duration_ms DOUBLE, message VARCHAR, raw VARCHAR, extras JSON, parse_error VARCHAR);",
      );
      try {
        const core = new Set<string>(CORE_FIELDS);
        for (let start = 0; start < dataset.records.length; start += 1000) {
          const rows = dataset.records
            .slice(start, start + 1000)
            .map((entry) => {
              const r = entry.record;
              return {
                source_line: entry.row + 1,
                timestamp: r.timestamp ?? null,
                level: r.level ?? null,
                service: r.service ?? null,
                host: r.host ?? null,
                status: r.status ?? null,
                duration_ms: r.duration_ms ?? null,
                message: r.message,
                raw: recordRaw(log, entry.row, entry.endRow),
                extras: JSON.stringify(
                  Object.fromEntries(
                    Object.entries(r).filter(([key]) => !core.has(key)),
                  ),
                ),
                parse_error: entry.failed ?? null,
              };
            });
          await db.registerFileText("batch.json", JSON.stringify(rows));
          try {
            await connection.query(
              "INSERT INTO logs SELECT source_line, TRY_CAST(timestamp AS TIMESTAMPTZ), level, service, host, status, duration_ms, message, raw, CAST(extras AS JSON), parse_error FROM read_json('batch.json', format='array', columns={source_line:'INTEGER', timestamp:'VARCHAR', level:'VARCHAR', service:'VARCHAR', host:'VARCHAR', status:'INTEGER', duration_ms:'DOUBLE', message:'VARCHAR', raw:'VARCHAR', extras:'VARCHAR', parse_error:'VARCHAR'});",
            );
          } finally {
            await db.dropFile("batch.json");
          }
        }
        await connection.query("COMMIT");
        loadedRevision = revision;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      }
    }
    return action(connection);
  });
  queue = task.catch(() => {});
  return task;
}

export function runPreset(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  preset: QueryPreset,
): Promise<QueryResult> {
  if (!Object.hasOwn(QUERIES, preset))
    return Promise.reject(new Error("Unknown query preset."));
  return withDatabase(revision, log, dataset, async (connection) => {
    const started = performance.now();
    const result = await connection.query(QUERIES[preset].sql);
    return {
      columns: result.schema.fields.map((field) => field.name),
      rows: result
        .toArray()
        .map((row) =>
          result.schema.fields.map((field) =>
            row[field.name] == null ? "NULL" : String(row[field.name]),
          ),
        ),
      elapsedMs: performance.now() - started,
    };
  });
}

export function filterLines(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  filters: Filters,
) {
  const where = filterWhere(filters);
  return withDatabase(revision, log, dataset, async (connection) => {
    // Validate even on empty tables: malformed RE2 patterns must surface consistently.
    const validation = await connection.prepare(
      `SELECT regexp_matches(?, ?, '${filters.regex ? "i" : "il"}')`,
    );
    try {
      await validation.query("", filters.text);
    } finally {
      await validation.close();
    }
    const statement = await connection.prepare(
      `SELECT source_line FROM logs WHERE ${where.sql} ORDER BY source_line`,
    );
    try {
      const result = await statement.query(...where.params);
      return Uint32Array.from(
        result.toArray(),
        (row) => Number(row.source_line) - 1,
      );
    } finally {
      await statement.close();
    }
  });
}

export function highlightTexts(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  filters: Filters,
  texts: string[],
): Promise<Highlight[][]> {
  if (!filters.text || !texts.length)
    return Promise.resolve(texts.map(() => []));
  return withDatabase(revision, log, dataset, async (connection) => {
    const statement = await connection.prepare(
      `SELECT string_split_regex(text, ?, '${filters.regex ? "i" : "il"}') AS parts, regexp_extract_all(text, ?, 0, '${filters.regex ? "i" : "il"}') AS matches FROM (VALUES ${texts.map(() => "(?)").join(",")}) AS input(text)`,
    );
    try {
      // ponytail: highlights cover first 2000 chars; full raw detail stays available without markup beyond this bound.
      const result = await statement.query(
        filters.text,
        filters.text,
        ...texts.map((text) => text.slice(0, 2000)),
      );
      return result.toArray().map((row) => {
        const parts = Array.from(row.parts) as string[];
        const matches = Array.from(row.matches) as string[];
        let offset = 0;
        const ranges: Highlight[] = [];
        matches.forEach((match, index) => {
          offset += (parts[index] ?? "").length;
          if (match.length) ranges.push([offset, offset + match.length]);
          offset += match.length;
        });
        return ranges;
      });
    } finally {
      await statement.close();
    }
  });
}
