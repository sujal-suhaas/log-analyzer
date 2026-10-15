import * as duckdb from "@duckdb/duckdb-wasm";
import wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import workerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import { CORE_FIELDS, type ParsedDataset } from "../parsers/types";
import { recordRaw } from "../parsers";
import type { LogFile } from "../read-log-file";
import { LOG_COLUMNS, SQL_LIMIT, type QueryResult } from "../queries";
import { filterWhere, type Filters, type Highlight } from "../filters";
import {
  serializeExport,
  validateExportFormat,
  type ExportFormat,
} from "../export";
import type {
  AnalyticsCountPoint,
  AnalyticsGranularity,
  AnalyticsMessagePoint,
  AnalyticsSnapshot,
  AnalyticsStatusPoint,
  AnalyticsTimePoint,
} from "./messages";

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

async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([task, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

// Load on first preset run. Keep SQL work serialized and old table until commit.
function withDatabase<T>(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  action: (connection: duckdb.AsyncDuckDBConnection) => Promise<T>,
  assertCurrent: () => void = () => {},
  signal?: AbortSignal,
): Promise<T> {
  const task = queue.then(async () => {
    assertCurrent();
    const { db, connection } = await (engine ??= open());
    assertCurrent();
    if (loadedRevision !== revision) {
      await connection.query(
        "BEGIN TRANSACTION; CREATE OR REPLACE TABLE logs (source_line INTEGER, timestamp TIMESTAMPTZ, level VARCHAR, service VARCHAR, host VARCHAR, status INTEGER, duration_ms DOUBLE, message VARCHAR, raw VARCHAR, extras JSON, parse_error VARCHAR);",
      );
      try {
        const core = new Set<string>(CORE_FIELDS);
        for (let start = 0; start < dataset.records.length; start += 1000) {
          assertCurrent();
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
            assertCurrent();
            await connection.query(
              "INSERT INTO logs SELECT source_line, TRY_CAST(timestamp AS TIMESTAMPTZ), level, service, host, status, duration_ms, message, raw, CAST(extras AS JSON), parse_error FROM read_json('batch.json', format='array', columns={source_line:'INTEGER', timestamp:'VARCHAR', level:'VARCHAR', service:'VARCHAR', host:'VARCHAR', status:'INTEGER', duration_ms:'DOUBLE', message:'VARCHAR', raw:'VARCHAR', extras:'VARCHAR', parse_error:'VARCHAR'});",
            );
          } finally {
            await db.dropFile("batch.json");
          }
        }
        assertCurrent();
        await connection.query("COMMIT");
        loadedRevision = revision;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      }
    }
    assertCurrent();
    return action(connection);
  });
  // The caller can stop waiting during initialization/loading or while queued,
  // but the underlying task must finish rollback/stream cleanup before reuse.
  queue = task.catch(() => {});
  return signal ? abortable(task, signal) : task;
}

// 100 KB is far past any hand-written query and keeps a paste bomb out of the engine.
const SQL_MAX = 100_000;

const MUTATING_KEYWORDS = new Set([
  "ALTER",
  "ATTACH",
  "CALL",
  "COPY",
  "CREATE",
  "DELETE",
  "DETACH",
  "DROP",
  "EXPORT",
  "GRANT",
  "IMPORT",
  "INSTALL",
  "INSERT",
  "LOAD",
  "MERGE",
  "PRAGMA",
  "REVOKE",
  "SET",
  "TRUNCATE",
  "UPDATE",
  "VACUUM",
]);
const READ_ONLY_KEYWORDS = new Set([
  "DESCRIBE",
  "DESC",
  "EXPLAIN",
  "FROM",
  "SELECT",
  "SHOW",
  "SUMMARIZE",
  "TABLE",
  "VALUES",
  "WITH",
]);

function validateReadOnlySql(sql: string) {
  const topLevelKeywords: string[] = [];
  let depth = 0;
  let semicolons = 0;
  let state: "normal" | "single" | "double" | "backtick" | "line" | "block" =
    "normal";

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];
    const next = sql[index + 1];

    if (state === "line") {
      if (character === "\n" || character === "\r") state = "normal";
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") {
        state = "normal";
        index++;
      }
      continue;
    }
    if (state === "single") {
      if (character === "'" && next === "'") index++;
      else if (character === "'") state = "normal";
      continue;
    }
    if (state === "double") {
      if (character === '"' && next === '"') index++;
      else if (character === '"') state = "normal";
      continue;
    }
    if (state === "backtick") {
      if (character === "`" && next === "`") index++;
      else if (character === "`") state = "normal";
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line";
      index++;
      continue;
    }
    if (character === "/" && next === "*") {
      state = "block";
      index++;
      continue;
    }
    if (character === "'") {
      state = "single";
      continue;
    }
    if (character === '"') {
      state = "double";
      continue;
    }
    if (character === "`") {
      state = "backtick";
      continue;
    }
    if (character === "(") {
      depth++;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === ";") {
      if (depth === 0) semicolons++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) end++;
      topLevelKeywords.push(sql.slice(index, end).toUpperCase());
      index = end - 1;
    }
  }

  const first = topLevelKeywords[0];
  if (!first || !READ_ONLY_KEYWORDS.has(first))
    throw new Error(
      "Only read-only SQL queries are allowed in the Query workspace.",
    );
  if (topLevelKeywords.some((keyword) => MUTATING_KEYWORDS.has(keyword)))
    throw new Error(
      "Only read-only SQL queries are allowed in the Query workspace.",
    );
  if (semicolons > 1)
    throw new Error("Run one read-only SQL statement at a time.");
}

// Shared by preview and export. Keep validation and user SQL exactly the same.
function validateSql(sql: string) {
  if (typeof sql !== "string" || !sql.trim())
    throw new Error("Enter a query first.");
  if (sql.length > SQL_MAX)
    throw new Error("Query is too long (100 KB maximum).");
  if (sql.includes("\0"))
    throw new Error("Query contains a null character.");
  validateReadOnlySql(sql);
}

export function runSql(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  sql: string,
  signal?: AbortSignal,
): Promise<QueryResult> {
  try {
    validateSql(sql);
  } catch (error) {
    return Promise.reject(error);
  }
  const assertCurrent = () => signal?.throwIfAborted();
  return withDatabase(
    revision,
    log,
    dataset,
    async (connection) => {
      const started = performance.now();
      let stream: Awaited<ReturnType<typeof connection.send>> | undefined;
      let cancellation: Promise<unknown> | undefined;
      const interrupt = () => {
        cancellation ??= connection.cancelSent().catch(() => {});
      };
      assertCurrent();
      // query() executes synchronously inside the engine Worker. send(false)
      // executes the identical SQL as a pending, materialized query, yielding
      // between engine tasks so cancelSent() can actually interrupt execution.
      signal?.addEventListener("abort", interrupt, { once: true });
      try {
        stream = await connection.send(sql, false);
        assertCurrent();
        await stream.open();
        const fields = stream.schema.fields;
        const rows: string[][] = [];
        let total = 0;
        for await (const batch of stream) {
          assertCurrent();
          // Convert and retain only the bounded preview. Count later batches
          // without retaining all Arrow data or allocating a full toArray().
          const shown = Math.min(batch.numRows, SQL_LIMIT - rows.length);
          const columns = fields.map((_, index) => batch.getChildAt(index)!);
          for (let index = 0; index < shown; index++) {
            rows.push(columns.map((column) => {
              const value = column.get(index);
              return value == null ? "NULL" : String(value);
            }));
          }
          total += batch.numRows;
        }
        assertCurrent();
        return {
          columns: fields.map((field) => field.name),
          rows,
          elapsedMs: performance.now() - started,
          truncated: Math.max(0, total - rows.length),
        };
      } catch (error) {
        // DuckDB reports its own cancellation error; expose a stable AbortError.
        assertCurrent();
        throw error;
      } finally {
        signal?.removeEventListener("abort", interrupt);
        // Never let a delayed cancellation hit the next queued operation.
        await cancellation;
        await stream?.cancel().catch(() => {});
      }
    },
    assertCurrent,
    signal,
  );
}

async function consumeExport(
  connection: duckdb.AsyncDuckDBConnection,
  stream: Awaited<ReturnType<duckdb.AsyncDuckDBConnection["send"]>>,
  revision: number,
  log: LogFile,
  kind: "logs" | "query",
  format: ExportFormat,
  assertCurrent: () => void,
) {
  let complete = false;
  try {
    // DuckDB send() returns a lazy Arrow reader; read its schema before writing
    // headers (including when the result contains no record batches).
    await stream.open();
    const result = await serializeExport(
      stream,
      { revision, name: log.name, kind, format },
      assertCurrent,
    );
    complete = true;
    return result;
  } finally {
    // A stale revision/serialization error must release the stream before the
    // next queued SQL action. No temporary tables/files or dataset mutation.
    if (!complete) await connection.cancelSent().catch(() => {});
    await stream.cancel().catch(() => {});
  }
}

export async function exportSql(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  sql: string,
  format: ExportFormat,
  assertCurrent: () => void,
) {
  validateSql(sql);
  validateExportFormat(format);
  return withDatabase(
    revision,
    log,
    dataset,
    async (connection) => {
      // Send the exact statement: no subquery wrapping, LIMIT removal or SQL_LIMIT.
      const stream = await connection.send(sql, true);
      return consumeExport(
        connection, stream, revision, log, "query", format, assertCurrent,
      );
    },
    assertCurrent,
  );
}

async function validateFilterPattern(
  connection: duckdb.AsyncDuckDBConnection,
  filters: Filters,
) {
  // Validate even on empty tables: malformed RE2 patterns must surface consistently.
  const validation = await connection.prepare(
    `SELECT regexp_matches(?, ?, '${filters.regex ? "i" : "il"}')`,
  );
  try {
    await validation.query("", filters.text);
  } finally {
    await validation.close();
  }
}

export async function exportFilteredLogs(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  filters: Filters,
  format: ExportFormat,
  assertCurrent: () => void,
) {
  validateExportFormat(format);
  const where = filterWhere(filters);
  return withDatabase(
    revision,
    log,
    dataset,
    async (connection) => {
      await validateFilterPattern(connection, filters);
      assertCurrent();
      const statement = await connection.prepare(
        `SELECT ${LOG_COLUMNS.join(", ")} FROM logs WHERE ${where.sql} ORDER BY source_line`,
      );
      try {
        const stream = await statement.send(...where.params);
        return await consumeExport(
          connection, stream, revision, log, "logs", format, assertCurrent,
        );
      } finally {
        await statement.close();
      }
    },
    assertCurrent,
  );
}

const ERROR_LEVELS_SQL =
  "level IN ('ERROR', 'FATAL', 'CRITICAL', 'CRIT', 'EMERG', 'ALERT')";
const MAX_CATEGORY_POINTS = 10;
const MESSAGE_LIMIT = 160;
type DatabaseRow = Record<string, unknown>;

async function rows(
  connection: duckdb.AsyncDuckDBConnection,
  sql: string,
  params: (string | number)[],
): Promise<DatabaseRow[]> {
  const statement = await connection.prepare(sql);
  try {
    const result = await statement.query(...params);
    return result.toArray() as DatabaseRow[];
  } finally {
    await statement.close();
  }
}

function numeric(value: unknown): number {
  return value == null ? 0 : Number(value);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function chooseGranularity(
  minTimeMs: number,
  maxTimeMs: number,
): AnalyticsGranularity {
  const range = maxTimeMs - minTimeMs;
  if (range <= 6 * 60 * 60 * 1000) return "minute";
  if (range <= 2 * 24 * 60 * 60 * 1000) return "hour";
  if (range <= 90 * 24 * 60 * 60 * 1000) return "day";
  return "week";
}

function bucketEnd(startMs: number, granularity: AnalyticsGranularity) {
  const duration = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }[granularity];
  return startMs + duration;
}

function bucketMilliseconds(granularity: AnalyticsGranularity) {
  return {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }[granularity];
}

async function analyticsSnapshot(
  connection: duckdb.AsyncDuckDBConnection,
  revision: number,
  filters: Filters,
): Promise<AnalyticsSnapshot> {
  const where = filterWhere(filters);
  const scope = (
    await rows(
      connection,
      `SELECT
         COUNT(*) AS total_logs,
         SUM(CASE WHEN ${ERROR_LEVELS_SQL} THEN 1 ELSE 0 END) AS error_logs,
         COUNT(timestamp) AS timestamped_logs,
         epoch_ms(MIN(timestamp)) AS min_time_ms,
         epoch_ms(MAX(timestamp)) AS max_time_ms,
         COUNT(duration_ms) AS latency_samples,
         AVG(duration_ms) AS average_ms,
         quantile_cont(duration_ms, 0.95) AS p95_ms
       FROM logs
       WHERE ${where.sql}`,
      where.params,
    )
  )[0];
  const minTimeMs = nullableNumber(scope.min_time_ms);
  const maxTimeMs = nullableNumber(scope.max_time_ms);
  const granularity =
    minTimeMs !== null && maxTimeMs !== null
      ? chooseGranularity(minTimeMs, maxTimeMs)
      : null;

  let timePoints: AnalyticsTimePoint[] = [];
  if (granularity) {
    const bucketMs = bucketMilliseconds(granularity);
    const timeRows = await rows(
      connection,
      `SELECT
         FLOOR(epoch_ms(timestamp) / ${bucketMs}) * ${bucketMs} AS start_ms,
         COUNT(*) AS logs,
         SUM(CASE WHEN ${ERROR_LEVELS_SQL} THEN 1 ELSE 0 END) AS errors
       FROM logs
       WHERE ${where.sql} AND timestamp IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
      where.params,
    );
    timePoints = timeRows.map((row) => {
      const startMs = numeric(row.start_ms);
      return {
        startMs,
        endMs: bucketEnd(startMs, granularity),
        logs: numeric(row.logs),
        errors: numeric(row.errors),
      };
    });
  }

  const levelRows = await rows(
    connection,
    `SELECT level AS value, COUNT(*) AS count
     FROM logs WHERE ${where.sql}
     GROUP BY level ORDER BY count DESC, value ASC NULLS LAST`,
    where.params,
  );
  const serviceRows = await rows(
    connection,
    `SELECT service AS value, COUNT(*) AS count
     FROM logs WHERE ${where.sql}
     GROUP BY service ORDER BY count DESC, value ASC NULLS LAST
     LIMIT ${MAX_CATEGORY_POINTS + 1}`,
    where.params,
  );
  const messageRows = await rows(
    connection,
    `SELECT message AS value, COUNT(*) AS count
     FROM logs WHERE ${where.sql} AND ${ERROR_LEVELS_SQL} AND message IS NOT NULL
     GROUP BY message ORDER BY count DESC, value ASC
     LIMIT ${MAX_CATEGORY_POINTS + 1}`,
    where.params,
  );
  const statusRows = await rows(
    connection,
    `SELECT status, COUNT(*) AS count
     FROM logs WHERE ${where.sql}
     GROUP BY status ORDER BY status ASC NULLS LAST`,
    where.params,
  );
  const messagePoints: AnalyticsMessagePoint[] = messageRows
    .slice(0, MAX_CATEGORY_POINTS)
    .map((row) => {
      const value = String(row.value);
      const filterText = value.slice(0, MESSAGE_LIMIT);
      return {
        filterText,
        label: value.slice(0, 80),
        count: numeric(row.count),
        truncated: filterText.length < value.length,
      };
    });

  const toCounts = (values: DatabaseRow[]): AnalyticsCountPoint[] =>
    values.map((row) => ({
      value: nullableString(row.value),
      count: numeric(row.count),
    }));
  const statusCodes: AnalyticsStatusPoint[] = statusRows.map((row) => ({
    status: nullableNumber(row.status),
    count: numeric(row.count),
  }));

  return {
    revision,
    scope: {
      totalLogs: numeric(scope.total_logs),
      errorLogs: numeric(scope.error_logs),
      timestampedLogs: numeric(scope.timestamped_logs),
      minTimeMs,
      maxTimeMs,
    },
    time: { granularity, points: timePoints },
    levels: toCounts(levelRows),
    services: {
      points: toCounts(serviceRows.slice(0, MAX_CATEGORY_POINTS)),
      hasMore: serviceRows.length > MAX_CATEGORY_POINTS,
    },
    errorMessages: {
      points: messagePoints,
      hasMore: messageRows.length > MAX_CATEGORY_POINTS,
    },
    statusCodes,
    latency: {
      sampleCount: numeric(scope.latency_samples),
      averageMs: nullableNumber(scope.average_ms),
      p95Ms: nullableNumber(scope.p95_ms),
    },
  };
}

export function getAnalytics(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  filters: Filters,
) {
  return withDatabase(revision, log, dataset, (connection) =>
    analyticsSnapshot(connection, revision, filters),
  );
}

export function filterLines(
  revision: number,
  log: LogFile,
  dataset: ParsedDataset,
  filters: Filters,
) {
  const where = filterWhere(filters);
  return withDatabase(revision, log, dataset, async (connection) => {
    await validateFilterPattern(connection, filters);
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
