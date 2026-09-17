import { expect, test } from "@playwright/test";

// Repro: filter must settle. Counting FILTER requests at the Worker boundary and
// watching the grid element identity proves whether the panel re-queries forever.
const FILTER_LOOP_SELECTOR = "Search logs";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = { filters: 0, sent: [] as string[] };
    Object.assign(window, { filterProbe: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown) {
        const request = message as { type?: string };
        if (request.type === "FILTER") {
          state.filters++;
          state.sent.push(new Date().toISOString());
        }
        super.postMessage(message);
      }
    };
  });
});

test("Phase 5: active filter settles instead of re-querying forever", async ({
  page,
}) => {
  const rows = Array.from({ length: 400 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, index % 60, 0)).toISOString(),
    level: index % 3 === 0 ? "ERROR" : "INFO",
    service: "api",
    host: `h${index % 7}`,
    status: 200 + (index % 5),
    duration_ms: index,
    message: `needle row ${index}`,
  }));
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "loop.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n")),
  });
  await expect(
    page.getByText("400 records · 0 failed · 0 skipped"),
  ).toBeVisible();

  const grid = page.getByRole("grid", { name: "Structured logs" });
  await page
    .getByLabel(FILTER_LOOP_SELECTOR, { exact: true })
    .fill("needle row 12");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "11 matching records · 11 source lines",
    { timeout: 30_000 },
  );

  // Settle: give the debounce and the query time to land.
  await page.waitForTimeout(600);
  const before = await page.evaluate(
    () =>
      (window as unknown as { filterProbe: { filters: number } }).filterProbe
        .filters,
  );
  const handle = await grid.elementHandle();
  const scrollTop = await grid.evaluate((node) => {
    node.scrollTop = 120;
    return node.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await page.waitForTimeout(1500);
  const after = await page.evaluate(
    () =>
      (window as unknown as { filterProbe: { filters: number } }).filterProbe
        .filters,
  );
  // One in-flight repeat is tolerable; a loop is not.
  expect(after - before).toBeLessThanOrEqual(1);

  // Grid must not be remounted (same DOM node) and scroll must survive.
  expect(await handle?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await grid.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await handle?.dispose();
});
