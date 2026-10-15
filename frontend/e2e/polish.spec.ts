import { expect, test, type Page } from "@playwright/test";

async function importJsonl(page: Page, lines: string[], name = "polish.jsonl") {
  await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(lines.join("\n")) });
  await expect(page.getByText(`${lines.length} records · 0 failed · 0 skipped`)).toBeVisible();
}

test("Phase 10: theme follows saved preference and system changes without replacing SQL", async ({ page }) => {
  await page.goto("/");
  await importJsonl(page, ['{"message":"hello"}']);
  await page.getByRole("button", { name: "Query", exact: true }).click();
  const editor = page.getByLabel("SQL query");
  await expect(editor).toBeVisible();
  const original = await editor.textContent();
  await page.getByLabel("Color theme").selectOption("light");
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const lightColor = await editor.evaluate((element) => getComputedStyle(element).color);
  await page.getByLabel("Color theme").selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect.poll(() => editor.evaluate((element) => getComputedStyle(element).color)).not.toBe(lightColor);
  await page.getByLabel("Color theme").selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(editor).toHaveText(original ?? "");
  await expect.poll(() => page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const open = indexedDB.open("logline-local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("settings").objectStore("settings").get("default");
      request.onsuccess = () => { resolve(request.result?.theme); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }))).toBe("system");
  await page.reload();
  await expect(page.getByLabel("Color theme")).toHaveValue("system");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByLabel("SQL query")).toHaveText(original ?? "");
});

test("Phase 10: shortcuts and full field/value/JSON copying work without stale feedback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { copiedValues: [] as string[] });
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => {
      (window as unknown as { copiedValues: string[] }).copiedValues.push(text);
    } });
  });
  await page.goto("/");
  const record = { message: "hello", zero: 0, flag: false, absent: null, nested: { foo: "bar" } };
  await importJsonl(page, [JSON.stringify(record), '{"message":"other"}']);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search logs", { exact: true })).toBeFocused();
  await page.keyboard.type("/");
  await expect(page.getByLabel("Search logs", { exact: true })).toHaveValue("/");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await grid.focus();
  await grid.press("Home");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(record));
  for (const key of ["zero", "flag", "absent", "nested"]) {
    await page.getByRole("button", { name: `Copy field ${key}`, exact: true }).click();
    await page.getByRole("button", { name: `Copy value ${key}`, exact: true }).click();
  }
  const copied = await page.evaluate(() => (window as unknown as { copiedValues: string[] }).copiedValues);
  expect(copied).toEqual(["zero", "0", "flag", "false", "absent", "null", "nested", JSON.stringify(record.nested)]);
  await page.getByRole("button", { name: "Parsed JSON", exact: true }).click();
  await expect(page.getByLabel("Parsed JSON", { exact: true })).toContainText('"flag": false');
  await page.getByRole("button", { name: "Copy parsed JSON", exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => (window as unknown as { copiedValues: string[] }).copiedValues.at(-1)!))).toEqual(record);
  await grid.focus();
  await grid.press("Escape");
  await expect(page.getByLabel("Raw log content")).toHaveCount(0);
  await expect(grid).toBeFocused();
  await grid.press("End");
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"other"}');
  await expect(page.getByText("Parsed JSON copied.", { exact: true })).toHaveCount(0);
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { value: async () => { throw new Error("Denied"); } }));
  await page.getByRole("button", { name: "Copy value message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Clipboard unavailable");
});

test("Phase 10: sparse raw filters inspect the correct original source lines", async ({ page }) => {
  await page.goto("/");
  await importJsonl(page, Array.from({ length: 100 }, (_, index) => JSON.stringify({ message: index === 1 || index === 99 ? `match ${index + 1}` : `other ${index + 1}` })));
  await page.getByLabel("Search logs", { exact: true }).fill("match");
  await expect(page.getByLabel("Filter results")).toHaveText("2 matching records · 2 source lines");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const list = page.getByRole("listbox", { name: "Raw log lines" });
  await list.getByRole("option").last().click();
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"match 100"}');
  await list.focus();
  await list.press("Home");
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"match 2"}');
  await list.press("ArrowDown");
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"match 100"}');
  await list.press("ArrowUp");
  await list.press("Enter");
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"match 2"}');
  await page.getByLabel("Search logs", { exact: true }).fill("no such line");
  await expect(page.getByLabel("Filter results")).toHaveText("0 matching records · 0 source lines");
  await expect(list).toContainText("No matching lines.");
});

test("Phase 10: large-record inspection is bounded and preflight validates every incoming file", async ({ page }) => {
  await page.goto("/");
  const message = "z".repeat(20_000) + "FULL END";
  const record = JSON.stringify({ message, nested: { complete: true } });
  await importJsonl(page, [record]);
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await grid.focus();
  await grid.press("Home");
  await expect(page.getByRole("note", { name: "Large record warning" })).toBeVisible();
  await expect(page.getByLabel("Raw log content")).not.toContainText("FULL END");
  await page.getByRole("button", { name: "Show full record", exact: true }).click();
  await expect(page.getByLabel("Raw log content")).toHaveText(record);
  await page.getByLabel("Replace or import log file").setInputFiles([
    { name: "not-supported.exe", mimeType: "text/plain", buffer: Buffer.from("not a log") },
    { name: "valid.log", mimeType: "text/plain", buffer: Buffer.from("new") },
  ]);
  await expect(page.getByRole("alert")).toContainText("Choose a .log");
  const sidebar = page.getByRole("complementary").first();
  await expect(sidebar.getByRole("button", { name: /^valid.log/ })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /^not-supported/ })).toHaveCount(0);
  await expect(page.getByLabel("Raw log content")).toHaveText(record);
});

test("Phase 10: Cancel query keeps the dataset usable and SQL columns are adjustable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await importJsonl(page, ['{"message":"hello"}', '{"message":"world"}']);
  await page.getByRole("button", { name: "Query", exact: true }).click();
  await page.getByLabel("SQL query").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("SELECT SUM(sin(i)) AS total FROM range(1000000000) AS t(i)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Run query", exact: true }).click();
  await page.getByRole("button", { name: "Cancel query", exact: true }).click();
  await expect(page.getByText("Query cancelled. Dataset kept; you can run another query.")).toBeVisible();
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  const table = page.getByRole("table", { name: "SQL results" });
  await expect(table.getByRole("cell", { name: "2", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByText("Columns (1/1)", { exact: true }).click();
  const width = page.getByLabel("Width of total (px)");
  await width.fill("420");
  await width.press("Enter");
  await expect(table.getByRole("separator", { name: "Resize total column" })).toHaveAttribute("aria-valuenow", "420");
  await page.getByLabel("Show total column").uncheck();
  await expect(table.getByRole("columnheader")).toHaveCount(0);
  await expect(page.getByText(/All result columns are hidden/)).toBeVisible();
  await page.getByRole("button", { name: "Reset columns", exact: true }).click();
  await expect(table.getByRole("columnheader", { name: "total", exact: true })).toBeVisible();
});

type DetailProbe = {
  failRows: boolean;
  failDetail: boolean;
  holdDetail: boolean;
  ready: boolean;
  release: (() => void) | null;
};

test("Phase 10: row/detail failures retry and a new filter never displays cached old details", async ({ page }) => {
  await page.addInitScript(() => {
    const state: DetailProbe = { failRows: true, failDetail: false, holdDetail: false, ready: false, release: null };
    Object.assign(window, { detailProbe: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private details = new Set<number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (!state.holdDetail || !this.details.has(event.data.id)) return;
          state.holdDetail = false;
          state.ready = true;
          event.stopImmediatePropagation();
          state.release = () => this.dispatchEvent(new MessageEvent("message", { data: event.data }));
        });
      }
      postMessage(message: unknown) {
        const request = message as { type: string; id: number };
        if (request.type === "GET_DETAIL") this.details.add(request.id);
        const fail = (request.type === "GET_RECORDS" && state.failRows) || (request.type === "GET_DETAIL" && state.failDetail);
        if (fail) {
          if (request.type === "GET_RECORDS") state.failRows = false;
          else state.failDetail = false;
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
            data: { id: request.id, ok: false, name: "Error", error: "Temporary read failure" },
          })));
          return;
        }
        super.postMessage(message);
      }
    };
  });
  await page.goto("/");
  await importJsonl(page, ['{"message":"alpha"}', '{"message":"beta"}']);
  await page.getByRole("button", { name: "Retry loading rows", exact: true }).click();
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await expect(grid.getByRole("gridcell", { name: "alpha", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { detailProbe: DetailProbe }).detailProbe.failDetail = true; });
  await grid.getByRole("gridcell", { name: "alpha", exact: true }).click();
  await expect(page.getByLabel("Raw log content")).toHaveText("Details unavailable.");
  await page.getByRole("button", { name: "Retry details", exact: true }).click();
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"alpha"}');
  await page.evaluate(() => { (window as unknown as { detailProbe: DetailProbe }).detailProbe.holdDetail = true; });
  await page.getByLabel("Search logs", { exact: true }).fill("beta");
  await expect(page.getByLabel("Filter results")).toHaveText("1 matching records · 1 source lines");
  await grid.getByRole("gridcell", { name: "beta", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { detailProbe: DetailProbe }).detailProbe.ready)).toBe(true);
  await expect(page.getByLabel("Raw log content")).toHaveText("Loading…");
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as unknown as { detailProbe: DetailProbe }).detailProbe.release?.(); });
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"beta"}');
});
