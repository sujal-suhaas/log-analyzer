import { expect, test } from "@playwright/test";

test("Phase 5: SQL filters return exact fixture rows with highlights and raw mapping", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const rows = [
    {
      timestamp: "2026-01-01T00:00:00Z",
      level: "INFO",
      service: "api",
      host: "a",
      status: 200,
      duration_ms: 0,
      message: "request ok",
    },
    {
      timestamp: "2026-01-02T00:00:00Z",
      level: "ERROR",
      service: "api",
      host: "b",
      status: 503,
      duration_ms: 150,
      message: "timeout alpha",
    },
    {
      timestamp: "2026-01-02T00:30:00Z",
      level: "WARN",
      service: "jobs",
      host: "b",
      status: 429,
      duration_ms: 50,
      message: "timeout beta",
    },
    {
      timestamp: "2026-01-02T01:00:00Z",
      level: "ERROR",
      service: "api",
      host: "b",
      status: 500,
      duration_ms: 250,
      message: "TIMEOUT gamma",
    },
    {
      level: "ERROR",
      service: "api",
      host: "b",
      message: "quote ' % _ literal",
    },
  ];
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "filter.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n")),
  });
  await expect(
    page.getByText("5 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  const grid = page.getByRole("grid", { name: "Structured logs" });
  const rendered = async () =>
    grid
      .getByRole("row")
      .filter({ has: page.getByRole("gridcell") })
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          Array.from(node.querySelectorAll('[role="gridcell"]')).map(
            (cell) => cell.textContent,
          ),
        ),
      );
  const search = page.getByLabel("Search logs", { exact: true });
  await search.fill("timeout");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "3 matching records · 3 source lines",
    { timeout: 60_000 },
  );
  await expect
    .poll(async () =>
      (await rendered()).map((cells) => [
        cells[0].replace("●", ""),
        cells.at(-1),
      ]),
    )
    .toEqual([
      ["2", "timeout alpha"],
      ["3", "timeout beta"],
      ["4", "TIMEOUT gamma"],
    ]);
  await expect(grid.locator("mark")).toHaveCount(3);
  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Filter level", { exact: true }).fill("ERROR");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "2 matching records · 2 source lines",
  );
  await expect
    .poll(async () =>
      (await rendered()).map((cells) => cells[0].replace("●", "")),
    )
    .toEqual(["2", "4"]);
  await grid.getByRole("row").filter({ hasText: "TIMEOUT gamma" }).click();
  await expect(page.getByLabel("Raw log content")).toHaveText(
    JSON.stringify(rows[3]),
  );
  await expect(page.getByLabel("Raw log content").locator("mark")).toHaveText(
    "TIMEOUT",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect
    .poll(async () =>
      page
        .getByRole("listbox", { name: "Raw log lines" })
        .getByRole("option")
        .allTextContents(),
    )
    .toEqual([`2${JSON.stringify(rows[1])}`, `4${JSON.stringify(rows[3])}`]);
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await page.getByLabel("Minimum duration (ms)").fill("200");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "1 matching records · 1 source lines",
  );
  await expect
    .poll(async () =>
      (await rendered()).map((cells) => cells[0].replace("●", "")),
    )
    .toEqual(["4"]);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(grid).toHaveAttribute("aria-rowcount", "6");
  await search.fill("timeout (alpha|gamma)");
  await page.getByLabel("Regex search", { exact: true }).check();
  await expect(page.getByLabel("Filter results")).toHaveText(
    "2 matching records · 2 source lines",
  );
  await expect
    .poll(async () => grid.locator("mark").allTextContents())
    .toEqual(["timeout alpha", "TIMEOUT gamma"]);
  await search.fill("[");
  await expect(
    page.getByRole("alert").filter({ hasText: /invalid|error/i }),
  ).toBeVisible();
  await expect(grid).toHaveAttribute("aria-rowcount", "3");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await search.fill("' % _");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "1 matching records · 1 source lines",
  );
  await expect
    .poll(async () =>
      (await rendered()).map((cells) => cells[0].replace("●", "")),
    )
    .toEqual(["5"]);
  await search.fill("no-such-message");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "0 matching records · 0 source lines",
  );
  await expect(grid.getByRole("gridcell")).toHaveCount(0);
});
