import { expect, test, type Locator, type Page } from "@playwright/test";
import { MAX_BYTES, MAX_LINES } from "../src/lib/read-log-file";

const rawAt = (index: number) => JSON.stringify({
  level: index % 10 === 9 ? "ERROR" : "INFO",
  message: `r${index}`,
});

// Genuine, distinct JSONL records: nine INFO followed by one ERROR, repeatedly.
// Build directly into a buffer rather than retaining 1.1M temporary JS strings.
function fixture(total: number) {
  const data = Buffer.allocUnsafe(total * (Buffer.byteLength(rawAt(total - 1)) + 1));
  let offset = 0;
  for (let index = 0; index < total; index++) offset += data.write(rawAt(index) + "\n", offset);
  return data.subarray(0, offset);
}

type ScaleProbe = {
  requests: { type: string; start: number; count: number }[];
  maxResponseRows: number;
};

test.beforeEach(async ({ page }) => {
  // Observe the real Worker boundary without modifying production Worker code.
  await page.addInitScript(() => {
    const state: ScaleProbe = { requests: [], maxResponseRows: 0 };
    Object.assign(window, { scaleProbe: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      pending = new Set<number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", ({ data }) => {
          if (this.pending.delete(data.id) && data.ok && Array.isArray(data.result))
            state.maxResponseRows = Math.max(state.maxResponseRows, data.result.length);
        });
      }
      postMessage(message: unknown) {
        const request = message as { id: number; type: string; start: number; count: number };
        if (request.type === "GET_RECORDS" || request.type === "GET_RAW_ROWS") {
          state.requests.push({ type: request.type, start: request.start, count: request.count });
          this.pending.add(request.id);
        }
        super.postMessage(message);
      }
    };
  });
});

async function details(page: Page, index: number) {
  await expect(page.getByLabel("Raw log content")).toHaveText(rawAt(index), { timeout: 30_000 });
}

async function sample(table: Locator, structured: boolean) {
  const domRows = await table.getByRole(structured ? "row" : "option").count();
  const spacerPx = await table.locator("[data-row-spacer]").evaluate((element) => element.getBoundingClientRect().height);
  expect(domRows).toBeLessThan(80);
  // A segmented page is at most 8.5M px, below both Firefox and Chromium caps.
  expect(spacerPx).toBeLessThanOrEqual(8_500_000);
  return { domRows, spacerPx };
}

async function inspectRows(page: Page, total: number, structured: boolean) {
  const table = page.getByRole(structured ? "grid" : "listbox", {
    name: structured ? "Structured logs" : "Raw log lines",
  });
  const row = (index: number) => table.locator(`#${structured ? "record" : "log-line"}-${index}`);
  const samples: Awaited<ReturnType<typeof sample>>[] = [];
  const check = async (index: number) => {
    await details(page, index);
    await expect(row(index)).toBeVisible();
    await expect(row(index)).toHaveAttribute("aria-selected", "true");
    await expect(table).toHaveAttribute("aria-activedescendant", `${structured ? "record" : "log-line"}-${index}`);
    if (structured) await expect(row(index)).toHaveAttribute("aria-rowindex", String(index + 2));
    else {
      await expect(row(index)).toHaveAttribute("aria-posinset", String(index + 1));
      await expect(row(index)).toHaveAttribute("aria-setsize", String(total));
    }
    samples.push(await sample(table, structured));
  };
  await table.focus();
  await table.press("Home");
  await check(0);
  const middle = Math.floor(total / 2);
  if (total > 500_000) {
    const pages = page.getByRole("navigation", { name: "Row pages" });
    await expect(pages).toBeVisible();
    await expect(pages.getByRole("button", { name: "Previous row page" })).toBeDisabled();
    await pages.getByRole("button", { name: "Next row page" }).click();
    await check(250_000);
    await table.focus();
    await table.press("ArrowUp"); // Cross a page boundary in both directions.
    await check(249_999);
    await table.press("ArrowDown");
    await check(250_000);
    await pages.getByRole("button", { name: "Previous row page" }).click();
    await check(0);
    await pages.getByRole("spinbutton", { name: "Jump to row" }).fill(String(middle + 1));
    await pages.getByRole("button", { name: "Go to row" }).click();
  } else {
    await expect(page.getByRole("navigation", { name: "Row pages" })).toHaveCount(0);
    await table.evaluate((element, top) => { element.scrollTop = top; }, middle * (structured ? 34 : 32));
    await expect(row(middle)).toBeVisible();
    await row(middle).click();
  }
  await check(middle);
  await table.focus();
  await table.press("End");
  await check(total - 1);
  if (total > 500_000)
    await expect(page.getByRole("button", { name: "Next row page" })).toBeDisabled();
  await table.press("ArrowUp");
  await check(total - 2);
  await table.press("ArrowDown");
  await check(total - 1);
  await table.press("Home");
  await check(0);
  return samples;
}

for (const total of [10_000, 100_000, 1_100_000]) {
  test(`Phase 10: ${total.toLocaleString("en-US")} successful JSONL records, global navigation and exact SQL`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = fixture(total);
    expect(data.byteLength).toBeLessThan(MAX_BYTES);
    await page.goto("/");
    await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
    const started = Date.now();
    await page.getByLabel("Replace or import log file").setInputFiles({
      name: `scale-${total}.jsonl`, mimeType: "text/plain", buffer: data,
    });
    const formattedTotal = await page.evaluate((count) => count.toLocaleString(), total);
    await expect(page.getByText(`${formattedTotal} records · 0 failed · 0 skipped`, { exact: true }))
      .toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("button", { name: "Cancel import", exact: true })).toHaveCount(0);
    const importMs = Date.now() - started;
    const grid = page.getByRole("grid", { name: "Structured logs" });
    await expect(grid).toHaveAttribute("aria-rowcount", String(total + 1));
    const structured = await inspectRows(page, total, true);
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    const raw = await inspectRows(page, total, false);

    await page.getByRole("button", { name: "Query", exact: true }).click();
    const results = page.getByRole("table", { name: "SQL results" });
    const countStarted = Date.now();
    await page.getByRole("button", { name: "Count logs", exact: true }).click();
    await expect(results.getByRole("row")).toHaveCount(2, { timeout: 120_000 });
    await expect(results.getByRole("cell")).toHaveText([String(total)]);
    const countIncludingIndexMs = Date.now() - countStarted;
    const groupStarted = Date.now();
    await page.getByRole("button", { name: "Counts by level", exact: true }).click();
    await expect(results.getByRole("row")).toHaveCount(3, { timeout: 120_000 });
    await expect(results.getByRole("row").nth(1).getByRole("cell")).toHaveText(["INFO", String(total * 9 / 10)]);
    await expect(results.getByRole("row").nth(2).getByRole("cell")).toHaveText(["ERROR", String(total / 10)]);
    const groupingMs = Date.now() - groupStarted;

    // The raw filtered table must select DISPLAY positions, even when source
    // lines are sparse (10, 20, ...), and its details must map through the filter.
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    await page.getByLabel("Search logs", { exact: true }).fill('"ERROR"');
    const formattedMatches = await page.evaluate((count) => count.toLocaleString(), total / 10);
    await expect(page.getByLabel("Filter results")).toHaveText(
      `${formattedMatches} matching records · ${formattedMatches} source lines`,
      { timeout: 120_000 },
    );
    const filtered = page.getByRole("listbox", { name: "Raw log lines" });
    await filtered.locator("#log-line-0").click();
    await details(page, 9);
    await expect(filtered.locator("#log-line-0")).toHaveAttribute("aria-selected", "true");
    await filtered.focus();
    await filtered.press("ArrowDown");
    await details(page, 19);
    await expect(filtered.locator("#log-line-1")).toHaveAttribute("aria-selected", "true");
    await filtered.press("End");
    await details(page, total - 1);
    await expect(filtered.locator(`#log-line-${total / 10 - 1}`)).toBeVisible();
    await filtered.press("Home");
    await details(page, 9);

    const probe = await page.evaluate(() => (window as unknown as { scaleProbe: ScaleProbe }).scaleProbe);
    for (const type of ["GET_RECORDS", "GET_RAW_ROWS"]) {
      const requests = probe.requests.filter((request) => request.type === type);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((request) => Number.isInteger(request.start) && request.start >= 0 && request.count > 0 && request.count <= 256)).toBe(true);
      expect(requests.some((request) => request.start <= total - 1 && request.start + request.count >= total)).toBe(true);
    }
    expect(probe.maxResponseRows).toBeGreaterThan(0);
    expect(probe.maxResponseRows).toBeLessThanOrEqual(256);
    expect(errors).toEqual([]);
    const measurements = {
      records: total, bytes: data.byteLength, importMs, countIncludingIndexMs, groupingMs,
      maxDomRows: Math.max(...[...structured, ...raw].map((value) => value.domRows)),
      maxSpacerPx: Math.max(...[...structured, ...raw].map((value) => value.spacerPx)),
      rowWindowRequests: probe.requests.length,
      maxRequestedRows: Math.max(...probe.requests.map((request) => request.count)),
      maxResponseRows: probe.maxResponseRows,
    };
    console.log("Phase 10 scale measurements:", measurements);
    await testInfo.attach("scale-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
  });
}

test("Phase 10: under-50MiB overcap JSONL and CSV reject atomically, including the CSV header", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const picker = page.getByLabel("Replace or import log file");
  await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
  await picker.setInputFiles({ name: "kept.jsonl", mimeType: "text/plain", buffer: fixture(10) });
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await expect(grid).toHaveAttribute("aria-rowcount", "11");
  for (const [name, data] of [
    ["overcap.jsonl", "{}\n".repeat(MAX_LINES + 1)],
    ["overcap.csv", "level,message\n" + "INFO,x\n".repeat(MAX_LINES)],
  ]) {
    const buffer = Buffer.from(data);
    expect(buffer.byteLength).toBeLessThan(MAX_BYTES);
    await picker.setInputFiles({ name, mimeType: "text/plain", buffer });
    await expect(page.getByRole("alert")).toContainText("1,250,000 source lines", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Cancel import", exact: true })).toHaveCount(0);
    await expect(grid).toHaveAttribute("aria-rowcount", "11");
    // A fresh Worker detail request proves preservation beyond cached row DOM.
    await page.getByRole("button", { name: "Raw", exact: true }).click();
    const raw = page.getByRole("listbox", { name: "Raw log lines" });
    await raw.focus();
    await raw.press("End");
    await details(page, 9);
    await raw.press("Home");
    await details(page, 0);
    await page.getByRole("button", { name: "Structured", exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove ${name}`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Dismiss error", exact: true }).click();
  }
});
