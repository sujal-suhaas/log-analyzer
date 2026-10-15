import { expect, test, type Download, type Page } from "@playwright/test";
import { createCsvReader } from "../src/lib/parsers/csv";

async function contents(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing download stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(await download.failure()).toBeNull();
  return Buffer.concat(chunks);
}

async function exportDownload(page: Page, kind: "logs" | "query", format: string) {
  await page.getByLabel(kind === "logs" ? "Filtered export format" : "Query export format").selectOption(format);
  const download = page.waitForEvent("download");
  await page.getByRole("button", {
    name: kind === "logs" ? "Export filtered logs" : "Export query results", exact: true,
  }).click();
  const result = await download;
  return { filename: result.suggestedFilename(), buffer: await contents(result) };
}

function parseCsv(text: string) {
  const read = createCsvReader();
  const records: string[][] = [];
  for (const line of text.replace(/\r\n$/, "").split(/\r\n|\n/)) {
    const record = read(line);
    if (record) records.push(record);
  }
  return records;
}

async function setSql(page: Page, sql: string) {
  await page.getByLabel("SQL query").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("Escape");
}

test("Phase 9: filtered exports retain full records and originals retain exact bytes after reload", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173/") && !request.url().startsWith("blob:"))
      external.push(request.url());
  });
  const message = 'timeout, "café"\n' + "x".repeat(3000);
  const lines = [
    JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", level: "INFO", message: "ok" }),
    JSON.stringify({ level: "ERROR", service: "api", status: 503, duration_ms: 500, message, nested: { list: [1, null, "a"] } }),
    JSON.stringify({ level: "ERROR", duration_ms: 50, message: "timeout short" }),
    "{broken}",
  ];
  const original = Buffer.from("\uFEFF" + lines.join("\r\n") + "\r\n");
  await page.goto("/");
  await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "exports.jsonl", mimeType: "text/plain", buffer: original,
  });
  await expect(page.getByText("4 records · 1 failed · 0 skipped")).toBeVisible();
  await page.getByLabel("Search logs", { exact: true }).fill("timeout");
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Filter level", { exact: true }).fill("ERROR");
  await page.getByLabel("Minimum duration (ms)").fill("100");
  await expect(page.getByLabel("Filter results")).toHaveText("1 matching records · 1 source lines");

  const csv = await exportDownload(page, "logs", "csv");
  expect(csv.filename).toBe("exports-logs.csv");
  const [headers, record, ...other] = parseCsv(csv.buffer.toString());
  expect(other).toEqual([]);
  const values = Object.fromEntries(headers.map((name, index) => [name, record[index]]));
  expect(values.source_line).toBe("2");
  expect(values.message).toBe(message);
  expect(values.raw).toBe(lines[1]);
  expect(JSON.parse(values.extras)).toEqual({ nested: { list: [1, null, "a"] } });

  const json = await exportDownload(page, "logs", "json");
  expect(JSON.parse(json.buffer.toString())).toEqual([
    expect.objectContaining({ source_line: 2, message, raw: lines[1], status: 503, timestamp: null, parse_error: null }),
  ]);
  const jsonl = await exportDownload(page, "logs", "jsonl");
  expect(jsonl.buffer.toString().trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual(JSON.parse(json.buffer.toString()));

  // Invalid drafts must not silently export a broader or previous scope.
  await page.getByLabel("Regex search").check();
  await page.getByLabel("Search logs", { exact: true }).fill("[");
  await expect(page.getByRole("alert")).toContainText("Previous results kept");
  await expect(page.getByRole("button", { name: "Export filtered logs", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByLabel("Filter results")).toHaveCount(0);
  const all = JSON.parse((await exportDownload(page, "logs", "json")).buffer.toString());
  expect(all).toHaveLength(4);
  expect(all[3]).toMatchObject({ source_line: 4, raw: "{broken}", parse_error: expect.any(String) });

  for (const afterReload of [false, true]) {
    if (afterReload) {
      await page.reload();
      await expect(page.getByText("4 records · 1 failed · 0 skipped")).toBeVisible();
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download original", exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename()).toBe("exports.jsonl");
    expect(await contents(result)).toEqual(original);
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("Phase 9: query downloads include every row beyond the preview and preserve the last-run scope", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "many.jsonl", mimeType: "text/plain",
    buffer: Buffer.from(Array.from({ length: 6000 }, (_, index) => JSON.stringify({ message: `row ${index}` })).join("\n")),
  });
  await expect(page.getByText("6,000 records · 0 failed · 0 skipped")).toBeVisible();
  await page.getByRole("button", { name: "Query", exact: true }).click();
  await setSql(page, "SELECT source_line, message, status FROM logs ORDER BY source_line");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.getByText(/Showing 5,000 of 6,000 rows/)).toBeVisible();
  const results = page.getByRole("table", { name: "SQL results" });
  await expect.poll(async () => (await results.locator("..").boundingBox())?.height ?? 0).toBeGreaterThan(90);

  const json = await exportDownload(page, "query", "json");
  expect(json.filename).toBe("many-query.json");
  const data = JSON.parse(json.buffer.toString());
  expect(data.columns).toEqual(["source_line", "message", "status"]);
  expect(data.rows).toHaveLength(6000);
  expect(data.rows[0]).toEqual([1, "row 0", null]);
  expect(data.rows[5999]).toEqual([6000, "row 5999", null]);

  const csv = parseCsv((await exportDownload(page, "query", "csv")).buffer.toString());
  expect(csv).toHaveLength(6001);
  expect(csv[0]).toEqual(data.columns);
  expect(csv[6000]).toEqual(["6000", "row 5999", ""]);
  const jsonl = (await exportDownload(page, "query", "jsonl")).buffer.toString().trimEnd().split("\n").map((line) => JSON.parse(line));
  expect(jsonl).toHaveLength(6001);
  expect(jsonl[0]).toEqual({ columns: data.columns });
  expect(jsonl[6000]).toEqual({ row: data.rows[5999] });

  await setSql(page, "SELECT message FROM logs WHERE FALSE");
  await expect(page.getByRole("button", { name: "Export query results", exact: true })).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(/0 rows · .* ms SQL execution/)).toBeVisible();
  const empty = await exportDownload(page, "query", "json");
  expect(JSON.parse(empty.buffer.toString())).toEqual({ columns: ["message"], rows: [] });
  expect(parseCsv((await exportDownload(page, "query", "csv")).buffer.toString())).toEqual([["message"]]);

  await setSql(page, "SELECT missing_column FROM logs");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("missing_column");
  await expect(page.getByRole("button", { name: "Export query results", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(results.getByRole("cell", { name: "6000", exact: true })).toBeVisible();
  expect(JSON.parse((await exportDownload(page, "query", "json")).buffer.toString())).toEqual({ columns: ["total"], rows: [[6000]] });
  await setSql(page, "SELECT 1 AS same, 2 AS same, 9007199254740993::BIGINT AS precise, NULL AS absent");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await expect(results.getByRole("columnheader", { name: "same", exact: true })).toHaveCount(2);
  expect(JSON.parse((await exportDownload(page, "query", "json")).buffer.toString())).toEqual({
    columns: ["same", "same", "precise", "absent"],
    rows: [[1, 2, "9007199254740993", null]],
  });
});

test("Phase 9: empty filtered exports retain schema without phantom records", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "empty.log", mimeType: "text/plain", buffer: Buffer.from(""),
  });
  await expect(page.getByText("0 records · 0 failed · 0 skipped")).toBeVisible();
  await page.getByLabel("Regex search").check();
  await expect(page.getByRole("button", { name: "Export filtered logs", exact: true })).toBeEnabled();
  const csv = parseCsv((await exportDownload(page, "logs", "csv")).buffer.toString());
  expect(csv).toHaveLength(1);
  expect(csv[0]).toContain("source_line");
  expect(csv[0]).toContain("raw");
  expect(JSON.parse((await exportDownload(page, "logs", "json")).buffer.toString())).toEqual([]);
  expect((await exportDownload(page, "logs", "jsonl")).buffer.length).toBe(0);
});

type ExportProbe = {
  failNext: boolean;
  hold: boolean;
  heldReady: boolean;
  release: (() => void) | null;
};

test("Phase 9: export errors recover and Clear suppresses a late download", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const state: ExportProbe = { failNext: false, hold: false, heldReady: false, release: null };
    Object.assign(window, { exportProbe: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private exportIds = new Set<number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event: MessageEvent) => {
          if (!state.hold || !this.exportIds.has(event.data.id)) return;
          event.stopImmediatePropagation();
          state.heldReady = true;
          state.release = () => {
            state.hold = false;
            this.dispatchEvent(new MessageEvent("message", { data: event.data }));
          };
        });
      }
      postMessage(message: unknown) {
        const request = message as { type: string; id: number };
        if (request.type === "EXPORT_QUERY") {
          this.exportIds.add(request.id);
          if (state.failNext) {
            state.failNext = false;
            queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
              data: { id: request.id, ok: false, name: "Error", error: "Simulated export failure" },
            })));
            return;
          }
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("/");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "recovery.log", mimeType: "text/plain", buffer: Buffer.from("hello\n"),
  });
  await expect(page.getByText("1 records · 0 failed · 0 skipped")).toBeVisible();
  await page.getByRole("button", { name: "Query", exact: true }).click();
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(page.getByRole("table", { name: "SQL results" })).toBeVisible();
  const group = page.getByRole("group", { name: "Query result export", exact: true });
  await page.evaluate(() => {
    (window as unknown as { exportProbe: ExportProbe }).exportProbe.failNext = true;
  });
  await group.getByRole("button", { name: "Export query results", exact: true }).click();
  await expect(group.getByRole("alert")).toHaveText("Simulated export failure");
  const successful = await exportDownload(page, "query", "json");
  expect(JSON.parse(successful.buffer.toString())).toEqual({ columns: ["total"], rows: [[1]] });

  const lateDownloads: string[] = [];
  page.on("download", (download) => lateDownloads.push(download.suggestedFilename()));
  await page.evaluate(() => {
    (window as unknown as { exportProbe: ExportProbe }).exportProbe.hold = true;
  });
  await group.getByRole("button", { name: "Export query results", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { exportProbe: ExportProbe }).exportProbe.heldReady,
  )).toBe(true);
  await page.getByRole("button", { name: "Clear editor", exact: true }).click();
  await page.evaluate(async () => {
    (window as unknown as { exportProbe: ExportProbe }).exportProbe.release?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  await expect(page.getByRole("table", { name: "SQL results" })).toHaveCount(0);
  expect(lateDownloads).toEqual([]);
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(page.getByRole("table", { name: "SQL results" }).getByRole("cell", { name: "1", exact: true })).toBeVisible();
});
