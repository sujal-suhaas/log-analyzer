import { expect, test, type Locator, type Page } from "@playwright/test";

const fields = ["timestamp", "level", "service", "host", "status", "duration_ms", "message", "trace_id"];
const fixture = [
  { timestamp: "2026-01-01T00:00:00Z", level: "INFO", service: "api", host: "a", status: 200, duration_ms: 5, message: "first request", trace_id: "trace-one" },
  { timestamp: "2026-01-02T00:00:00Z", level: "ERROR", service: "api", host: "b", status: 503, duration_ms: 50, message: "timeout second", trace_id: "trace-two" },
  { timestamp: "2026-01-03T00:00:00Z", level: "WARN", service: "jobs", host: "c", status: 429, duration_ms: 20, message: "timeout third", trace_id: "trace-three" },
];

async function importRows(page: Page, rows: object[] = fixture) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Parser", exact: true }).selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "table-columns.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n")),
  });
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await expect(grid).toHaveAttribute("aria-rowcount", String(rows.length + 1));
  if (rows.length) await expect(grid.locator('[aria-rowindex="2"]')).toBeVisible();
  return grid;
}

function controlsToggle(page: Page) {
  return page.locator("summary").filter({ hasText: /^Columns \(/ });
}

function visibility(page: Page, field: string) {
  return page.getByRole("checkbox", { name: `Show ${field} column`, exact: true });
}

function header(grid: Locator, field: string) {
  return grid.getByRole("columnheader", { name: field, exact: true });
}

async function expectWidth(grid: Locator, field: string, width: number) {
  await expect(header(grid, field)).toHaveCSS("width", `${width}px`);
  await expect(grid.getByRole("separator", { name: `Resize ${field} column`, exact: true }))
    .toHaveAttribute("aria-valuenow", String(width));
  const index = await header(grid, field).evaluate((element) =>
    Array.from(element.parentElement!.children).indexOf(element));
  await expect(grid.locator('[aria-rowindex="2"]').getByRole("gridcell").nth(index))
    .toHaveCSS("width", `${width}px`);
}

test("column visibility keeps source lines, keyboard selection and complete details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const grid = await importRows(page);
  await controlsToggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(visibility(page, "LINE")).toBeChecked();
  await expect(visibility(page, "LINE")).toBeDisabled();

  await visibility(page, "message").focus();
  await page.keyboard.press("Space");
  await visibility(page, "trace_id").uncheck();
  await expect(header(grid, "message")).toHaveCount(0);
  await expect(header(grid, "trace_id")).toHaveCount(0);
  await expect(header(grid, "LINE")).toHaveCount(1);
  await expect(grid).toHaveAttribute("aria-colcount", "7");
  await expect(grid.locator('[aria-rowindex="2"]').getByRole("gridcell")).toHaveCount(7);

  await grid.focus();
  await grid.press("Enter");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(fixture[0]));
  await expect(page.getByLabel("Parsed fields")).toContainText("trace-one");
  await grid.press("ArrowDown");
  await expect(grid.locator('[aria-rowindex="3"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(fixture[1]));

  await visibility(page, "message").check();
  await visibility(page, "trace_id").check();
  await expect(header(grid, "message")).toHaveCount(1);
  await expect(header(grid, "trace_id")).toHaveCount(1);
  await expect(grid.locator('[aria-rowindex="3"]')).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator('[aria-rowindex="3"]')).toContainText("trace-two");

  await page.getByRole("spinbutton", { name: "Width of level (px)", exact: true }).fill("355");
  await page.keyboard.press("Escape"); // Discard an input draft first.
  await page.keyboard.press("Escape"); // Then close the disclosure and restore focus.
  await expect(controlsToggle(page)).toBeFocused();
  await expect(visibility(page, "level")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("pointer, keyboard and numeric resizing stay aligned, bounded and resettable", async ({ page }) => {
  const grid = await importRows(page);
  const handle = grid.getByRole("separator", { name: "Resize timestamp column", exact: true });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 + 50, { steps: 5 });
  await page.mouse.up(); // Pointer capture keeps resizing outside the header.
  await expectWidth(grid, "timestamp", 290);
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(0);
  await page.mouse.move(box!.x + 120, box!.y + 20);
  await expectWidth(grid, "timestamp", 290); // Releasing capture ends the drag.

  await handle.focus();
  await handle.press("ArrowRight");
  await expectWidth(grid, "timestamp", 300);
  await handle.press("Shift+ArrowLeft");
  await expectWidth(grid, "timestamp", 250);
  await handle.press("Home");
  await expectWidth(grid, "timestamp", 80);
  await handle.press("ArrowLeft");
  await expectWidth(grid, "timestamp", 80);
  await handle.press("End");
  await expectWidth(grid, "timestamp", 800);
  await handle.press("ArrowRight");
  await expectWidth(grid, "timestamp", 800);
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(0);

  await controlsToggle(page).click();
  const width = page.getByRole("spinbutton", { name: "Width of message (px)", exact: true });
  await width.fill("425");
  await width.press("Enter");
  await expectWidth(grid, "message", 425);
  await width.fill("9999");
  await width.press("Tab");
  await expectWidth(grid, "message", 800);
  await width.fill("-20");
  await width.press("Enter");
  await expectWidth(grid, "message", 80);
  await width.fill("");
  await width.press("Enter");
  await expect(width).toHaveValue("80");
  await visibility(page, "message").uncheck();
  await visibility(page, "message").check();
  await expectWidth(grid, "message", 80);

  await page.getByRole("button", { name: "Reset columns", exact: true }).click();
  await expectWidth(grid, "timestamp", 220);
  await expectWidth(grid, "message", 360);
  await expect(grid).toHaveAttribute("aria-colcount", "9");
  await grid.focus();
  await grid.press("End");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(fixture[2]));
});

test("all-hidden fields retain line-only selection and a clear recovery action", async ({ page }) => {
  const grid = await importRows(page);
  await controlsToggle(page).click();
  for (const field of fields) await visibility(page, field).uncheck();
  await expect(grid.getByRole("columnheader")).toHaveCount(1);
  await expect(grid).toHaveAttribute("aria-colcount", "1");
  await expect(grid.getByRole("gridcell")).toHaveCount(3);
  const status = page.getByRole("status").filter({ hasText: "All log fields are hidden" });
  await expect(status).toContainText("Source lines and row details are still available");
  await controlsToggle(page).click();
  await grid.locator('[aria-rowindex="3"]').getByRole("gridcell").click();
  await expect(page.getByLabel("Parsed fields")).toContainText("trace-two");
  await grid.focus();
  await grid.press("End");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(fixture[2]));
  await status.getByRole("button", { name: "Reset columns", exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(grid.getByRole("columnheader")).toHaveCount(9);
  await expect(grid.locator('[aria-rowindex="4"]')).toHaveAttribute("aria-selected", "true");
});

test("column preferences survive filtering and view changes without breaking source mapping", async ({ page }) => {
  test.setTimeout(90_000);
  const grid = await importRows(page);
  await controlsToggle(page).click();
  await visibility(page, "host").uncheck();
  const width = page.getByRole("spinbutton", { name: "Width of message (px)", exact: true });
  await width.fill("450");
  await width.press("Enter");
  await page.getByLabel("Search logs", { exact: true }).fill("timeout");
  await expect(page.getByLabel("Filter results")).toHaveText("2 matching records · 2 source lines", { timeout: 60_000 });
  await expect(header(grid, "host")).toHaveCount(0);
  await expectWidth(grid, "message", 450);
  await expect(grid.locator("mark")).toHaveCount(2);
  await grid.focus();
  await grid.press("End");
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(fixture[2]));
  await expect(grid.locator('[aria-selected="true"]').getByRole("gridcell").first()).toHaveText("3●");

  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await expect(header(grid, "host")).toHaveCount(0);
  await expectWidth(grid, "message", 450);
  await page.getByLabel("Search logs", { exact: true }).fill("no-such-record");
  await expect(page.getByLabel("Filter results")).toHaveText("0 matching records · 0 source lines");
  await expect(grid.getByText("No matching records.", { exact: true })).toBeVisible();
  await expect(grid.getByRole("gridcell")).toHaveCount(0);
  await grid.focus();
  await grid.press("End");
  await expect(grid.locator('[aria-selected="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(grid).toHaveAttribute("aria-rowcount", "4");
  await expect(header(grid, "host")).toHaveCount(0);
  await expectWidth(grid, "message", 450);
});

test("resized and hidden columns retain virtualization and distant keyboard selection", async ({ page }) => {
  test.setTimeout(90_000);
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    level: "INFO", message: `request ${index}`, trace_id: `trace-${index}`,
  }));
  const grid = await importRows(page, rows);
  await controlsToggle(page).click();
  await visibility(page, "trace_id").uncheck();
  const width = page.getByRole("spinbutton", { name: "Width of message (px)", exact: true });
  await width.fill("510");
  await width.press("Enter");
  await controlsToggle(page).click();
  await grid.focus();
  await grid.press("End");
  await expect(grid.locator('[aria-rowindex="10001"]')).toBeVisible();
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(rows[9999]));
  expect(await grid.getByRole("row").count()).toBeLessThan(60);
  await grid.press("Home");
  await expectWidth(grid, "message", 510);
  await expect(page.getByLabel("Raw log content")).toHaveText(JSON.stringify(rows[0]));
  expect(await grid.getByRole("row").count()).toBeLessThan(60);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await controlsToggle(page).click();
  await expect(width).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
