import { expect, test, type Page, type Worker as PlaywrightWorker } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { LogWorkerClient } from "../src/lib/worker/log-client";
import { EMPTY_FILTERS } from "../src/lib/filters";

type Outcome = { ok: true; result: unknown } | { ok: false; name: string; error: string };
type Harness = {
  client: LogWorkerClient;
  revision: number;
  jobs: Record<string, Promise<Outcome>>;
  requests: { id: number; type: string; target?: number; sql?: string }[];
  workers: Worker[];
  terminations: number;
  errors: string[];
  track: (name: string, task: Promise<unknown>) => void;
};
type EngineProbe = {
  messages: { type: string; sql?: string }[];
  hold?: { type: string; sql?: string; response?: boolean };
  held: boolean;
  release?: () => void;
  cancellations: unknown[];
  workers: number;
  terminations: number;
  errors: string[];
};
declare global {
  interface Window { cancellation: Harness }
}

// Use the real source client and module Worker, including the pinned local WASM.
// The normal Playwright webServer still builds production. A Vite dev server
// permits importing this API directly without changing the application/UI.
let server: ViteDevServer;
const origin = "http://127.0.0.1:4174";
test.beforeAll(async () => {
  server = await createServer({ logLevel: "error", server: { host: "127.0.0.1", port: 4174, strictPort: true } });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

async function setup(page: Page) {
  await page.goto(origin);
  const workerCreated = page.waitForEvent("worker");
  await page.evaluate(async () => {
    const url = "/src/lib/worker/log-client.ts";
    const { LogWorkerClient } = await import(/* @vite-ignore */ url);
    const p = window.cancellation = {
      client: new LogWorkerClient(), revision: 0, jobs: {}, requests: [],
      workers: [], terminations: 0, errors: [],
      track(name, task) {
        this.jobs[name] = task.then(
          (result) => ({ ok: true, result }),
          (error) => ({ ok: false, name: error.name, error: error.message }),
        );
      },
    } as Harness;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        p.workers.push(this);
      }
      postMessage(message: Harness["requests"][number]) {
        p.requests.push(message);
        super.postMessage(message);
      }
      terminate() { p.terminations++; super.terminate(); }
    };
    p.client.onError = (error: Error) => p.errors.push(error.message);
    await p.client.cancelQuery(); // A no-op must not even spawn a Worker.
    if (p.workers.length) throw new Error("Idle cancellation spawned a Worker");
    const summary = await p.client.loadFile(new File([
      '{"level":"INFO","message":"ok","duration_ms":10}\n',
      '{"level":"ERROR","message":"timeout","status":503,"duration_ms":20}\n',
      '{"level":"ERROR","message":"failed","status":500,"duration_ms":30}\n',
    ], "cancel.jsonl"), "jsonl", () => {});
    p.revision = summary.revision;
  });
  const worker = await workerCreated;
  // Observe/gate native engine messages, never simulate query results. Holding a
  // message or acknowledgement makes init/load/queue races deterministic.
  await worker.evaluate(() => {
    const p: EngineProbe = {
      messages: [], held: false, cancellations: [], workers: 0, terminations: 0, errors: [],
    };
    Object.assign(globalThis, { engineProbe: p });
    globalThis.addEventListener("unhandledrejection", (event) => p.errors.push(String(event.reason)));
    const NativeWorker = globalThis.Worker;
    globalThis.Worker = class extends NativeWorker {
      private types = new Map<number, string>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        p.workers++;
        this.addEventListener("message", (event) => {
          const type = this.types.get(event.data.requestId);
          if (type === "CANCEL_PENDING_QUERY") {
            p.cancellations.push(event.data.data);
            this.types.delete(event.data.requestId);
          }
          if (p.hold?.response && p.hold.type === type) {
            p.hold = undefined;
            p.held = true;
            event.stopImmediatePropagation();
            p.release = () => {
              p.held = false;
              p.release = undefined;
              this.dispatchEvent(new MessageEvent("message", { data: event.data }));
            };
          }
        });
      }
      postMessage(message: { type: string; messageId: number; data: unknown }, transfer: Transferable[] = []) {
        const sql = ["RUN_QUERY", "START_PENDING_QUERY"].includes(message.type)
          ? (message.data as [number, string])[1] : undefined;
        p.messages.push({ type: message.type, sql });
        this.types.set(message.messageId, message.type);
        const send = () => super.postMessage(message, transfer);
        if (p.hold && !p.hold.response && p.hold.type === message.type && (!p.hold.sql || sql?.startsWith(p.hold.sql))) {
          p.hold = undefined;
          p.held = true;
          p.release = () => { p.held = false; p.release = undefined; send(); };
        } else send();
      }
      terminate() { p.terminations++; super.terminate(); }
    };
  });
  return worker;
}

const probe = (worker: PlaywrightWorker) => worker.evaluate(() =>
  (globalThis as unknown as { engineProbe: EngineProbe }).engineProbe,
);
async function hold(worker: PlaywrightWorker, value: EngineProbe["hold"]) {
  await worker.evaluate((value) => {
    (globalThis as unknown as { engineProbe: EngineProbe }).engineProbe.hold = value;
  }, value);
}
async function release(worker: PlaywrightWorker) {
  await worker.evaluate(() => {
    (globalThis as unknown as { engineProbe: EngineProbe }).engineProbe.release?.();
  });
}
async function start(page: Page, name: string, sql: string) {
  await page.evaluate(({ name, sql }) => {
    const p = window.cancellation;
    p.track(name, p.client.query(p.revision, sql));
  }, { name, sql });
}
const outcome = (page: Page, name: string) => page.evaluate((name) => window.cancellation.jobs[name], name);
async function healthy(page: Page, worker: PlaywrightWorker) {
  expect(await page.evaluate(() => ({
    workers: window.cancellation.workers.length,
    terminations: window.cancellation.terminations,
    errors: window.cancellation.errors,
  }))).toEqual({ workers: 1, terminations: 0, errors: [] });
  expect(await probe(worker)).toMatchObject({ workers: 1, terminations: 0, errors: [] });
}

test("query cancellation during initialization rejects promptly and retains the dataset", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await hold(worker, { type: "INSTANTIATE" });
  await start(page, "run", "SELECT count(*) AS total FROM logs");
  await expect.poll(async () => (await probe(worker)).held).toBe(true);
  await page.evaluate(() => window.cancellation.client.cancelQuery());
  expect(await outcome(page, "run")).toMatchObject({ ok: false, name: "AbortError" });
  expect((await probe(worker)).cancellations).toEqual([]);
  await page.evaluate(() => window.cancellation.client.cancelQuery());
  await start(page, "fresh", "SELECT count(*) AS total FROM logs");
  await release(worker);
  expect(await outcome(page, "fresh")).toMatchObject({ ok: true, result: { rows: [["3"]] } });
  expect(await page.evaluate(async () => {
    const p = window.cancellation;
    return (await p.client.detail(p.revision, 1, true)).raw;
  })).toContain('"message":"timeout"');
  await healthy(page, worker);
});

test("SQL previews preserve positional duplicate columns and typed values", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await start(page, "typed", `SELECT 1 AS value, 2 AS value,
    NULL AS missing, false AS flag, 9007199254740993::BIGINT AS large,
    '{"nested":true}'::JSON AS detail FROM logs LIMIT 1`);
  expect(await outcome(page, "typed")).toMatchObject({ ok: true, result: {
    columns: ["value", "value", "missing", "flag", "large", "detail"],
    rows: [["1", "2", "NULL", "false", "9007199254740993", '{"nested":true}']],
    truncated: 0,
  } });
  await healthy(page, worker);
});

test("query cancellation rolls back a partial table load before queued analytics/export/filter work", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await start(page, "warm", "SELECT count(*) FROM logs");
  expect(await outcome(page, "warm")).toMatchObject({ ok: true });
  await page.evaluate(async () => {
    const p = window.cancellation;
    const summary = await p.client.loadFile(new File([
      '{"level":"ERROR","message":"replacement","duration_ms":5}\n'.repeat(2500),
    ], "replacement.jsonl"), "jsonl", () => {});
    p.revision = summary.revision;
  });
  await hold(worker, { type: "RUN_QUERY", sql: "INSERT INTO logs" });
  await start(page, "run", "SELECT count(*) AS cancelled_loading FROM logs");
  await expect.poll(async () => (await probe(worker)).held).toBe(true);
  await page.evaluate((filters) => {
    const p = window.cancellation;
    p.track("analytics", p.client.analytics(p.revision, filters));
    p.track("export", p.client.exportLogs(p.revision, filters, "json").then(async (value) => ({
      rows: value.rowCount, data: JSON.parse(await value.blob.text()).length,
    })));
    p.track("filter", p.client.filter(p.revision, filters));
  }, EMPTY_FILTERS);
  await page.evaluate(() => window.cancellation.client.cancelQuery());
  expect(await outcome(page, "run")).toMatchObject({ ok: false, name: "AbortError" });
  await release(worker);
  expect(await outcome(page, "analytics")).toMatchObject({ ok: true, result: { scope: { totalLogs: 2500, errorLogs: 2500 } } });
  expect(await outcome(page, "export")).toEqual({ ok: true, result: { rows: 2500, data: 2500 } });
  expect(await outcome(page, "filter")).toMatchObject({ ok: true, result: { total: 2500 } });
  const engine = await probe(worker);
  expect(engine.messages.some((message) => message.sql === "ROLLBACK")).toBe(true);
  expect(engine.messages.some((message) => message.sql?.includes("cancelled_loading"))).toBe(false);
  expect(engine.cancellations).toEqual([]);
  await start(page, "fresh", "SELECT count(*) AS total FROM logs");
  expect(await outcome(page, "fresh")).toMatchObject({ ok: true, result: { rows: [["2500"]] } });
  await healthy(page, worker);
});

test("active engine cancellation drains its acknowledgement before queued work and fresh query/export recover", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await start(page, "warm", "SELECT count(*) FROM logs");
  await outcome(page, "warm");
  await hold(worker, { type: "CANCEL_PENDING_QUERY", response: true });
  const sql = "SELECT sum(sqrt(i::DOUBLE)) FROM range(10000000000) AS t(i)";
  await start(page, "run", sql);
  await expect.poll(async () => (await probe(worker)).messages.filter((m) => m.type === "POLL_PENDING_QUERY").length).toBeGreaterThan(0);
  await page.evaluate((filters) => {
    const p = window.cancellation;
    p.track("filter", p.client.filter(p.revision, { ...filters, level: "ERROR" }));
    p.track("analytics", p.client.analytics(p.revision, filters));
    p.track("export", p.client.exportLogs(p.revision, filters, "json").then(async (value) => JSON.parse(await value.blob.text())));
  }, EMPTY_FILTERS);
  const before = (await probe(worker)).messages.filter((m) => m.type === "CREATE_PREPARED").length;
  await page.evaluate(async () => {
    await window.cancellation.client.cancelQuery();
    await window.cancellation.client.cancelQuery();
  });
  expect(await outcome(page, "run")).toMatchObject({ ok: false, name: "AbortError" });
  await expect.poll(async () => (await probe(worker)).held).toBe(true);
  expect((await probe(worker)).cancellations).toEqual([true]);
  expect((await probe(worker)).messages.filter((m) => m.type === "CREATE_PREPARED")).toHaveLength(before);
  await release(worker);
  expect(await outcome(page, "filter")).toMatchObject({ ok: true, result: { total: 2 } });
  expect(await outcome(page, "analytics")).toMatchObject({ ok: true, result: { scope: { totalLogs: 3, errorLogs: 2 } } });
  expect(await outcome(page, "export")).toMatchObject({ ok: true, result: [
    { message: "ok" }, { message: "timeout" }, { message: "failed" },
  ] });
  await page.evaluate(() => {
    const p = window.cancellation;
    p.track("invalidExport", p.client.exportQuery(p.revision, "json"));
  });
  expect(await outcome(page, "invalidExport")).toMatchObject({ ok: false, name: "Error" });
  await start(page, "fresh", "SELECT source_line, message FROM logs ORDER BY source_line");
  expect(await outcome(page, "fresh")).toMatchObject({ ok: true, result: { rows: [["1", "ok"], ["2", "timeout"], ["3", "failed"]] } });
  // Completed/unknown targets are harmless and cannot invalidate successful SQL.
  await page.evaluate(async () => {
    const p = window.cancellation;
    await p.client.cancelQuery();
    const cancelled = p.requests.find((r) => r.type === "CANCEL_QUERY")!;
    p.workers[0].postMessage({ id: 10000, type: "CANCEL_QUERY", target: cancelled.target });
    p.track("queryExport", p.client.exportQuery(p.revision, "json").then(async (value) => JSON.parse(await value.blob.text())));
  });
  expect(await outcome(page, "queryExport")).toEqual({ ok: true, result: {
    columns: ["source_line", "message"], rows: [[1, "ok"], [2, "timeout"], [3, "failed"]],
  } });
  expect((await probe(worker)).messages.find((m) => m.sql === sql)).toEqual({ type: "START_PENDING_QUERY", sql });
  await healthy(page, worker);
});

test("queued cancellation targets only the latest run and preserves query/export generations", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await start(page, "warm", "SELECT count(*) AS total FROM logs");
  await outcome(page, "warm");
  await hold(worker, { type: "START_PENDING_QUERY" });
  await page.evaluate(() => {
    const p = window.cancellation;
    p.track("queryExport", p.client.exportQuery(p.revision, "json").then(async (value) => JSON.parse(await value.blob.text())));
  });
  await expect.poll(async () => (await probe(worker)).held).toBe(true);
  // Starting any run invalidates that queued export's old query generation.
  await start(page, "older", "SELECT count(*) AS older FROM logs");
  await start(page, "newest", "SELECT count(*) AS never_execute FROM logs");
  await page.evaluate(() => window.cancellation.client.cancelQuery());
  expect(await outcome(page, "newest")).toMatchObject({ ok: false, name: "AbortError" });
  expect((await probe(worker)).cancellations).toEqual([]);
  const requests = await page.evaluate(() => window.cancellation.requests);
  expect(requests.findLast((r) => r.type === "CANCEL_QUERY")?.target).toBe(requests.findLast((r) => r.type === "RUN_QUERY")?.id);
  await release(worker);
  expect(await outcome(page, "queryExport")).toMatchObject({ ok: false, name: "Error" });
  expect(await outcome(page, "older")).toMatchObject({ ok: false, error: "Query superseded." });
  expect((await probe(worker)).messages.some((m) => m.sql?.includes("never_execute"))).toBe(false);
  await start(page, "fresh", "SELECT count(*) AS total FROM logs");
  expect(await outcome(page, "fresh")).toMatchObject({ ok: true, result: { rows: [["3"]] } });
  await healthy(page, worker);
});

test("cancellation during result fetching releases the reader; fresh empty and capped previews still work", async ({ page }) => {
  test.setTimeout(90_000);
  const worker = await setup(page);
  await start(page, "warm", "SELECT count(*) FROM logs");
  await outcome(page, "warm");
  await hold(worker, { type: "FETCH_QUERY_RESULTS" });
  await start(page, "run", "SELECT i FROM range(6000) AS t(i)");
  await expect.poll(async () => (await probe(worker)).held).toBe(true);
  await page.evaluate(() => window.cancellation.client.cancelQuery());
  expect(await outcome(page, "run")).toMatchObject({ ok: false, name: "AbortError" });
  await release(worker);
  await start(page, "empty", "SELECT message FROM logs WHERE FALSE");
  expect(await outcome(page, "empty")).toMatchObject({ ok: true, result: { columns: ["message"], rows: [], truncated: 0 } });
  expect((await probe(worker)).cancellations).toEqual([false]);
  await page.evaluate(() => {
    const p = window.cancellation;
    p.track("capped", p.client.query(p.revision, "SELECT i FROM range(6000) AS t(i)").then((result) => ({
      columns: result.columns, count: result.rows.length, first: result.rows[0],
      last: result.rows.at(-1), truncated: result.truncated,
    })));
  });
  expect(await outcome(page, "capped")).toEqual({ ok: true, result: {
    columns: ["i"], count: 5000, first: ["0"], last: ["4999"], truncated: 1000,
  } });
  await healthy(page, worker);
});
