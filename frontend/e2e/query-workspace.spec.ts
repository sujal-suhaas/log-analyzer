import { expect, test, type Page } from "@playwright/test";

async function importJsonl(page: Page, name: string, lines: string[]) {
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page
    .getByLabel("Replace or import log file")
    .setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(lines.join("\n")),
    });
}

async function openQueryView(page: Page) {
  await page.getByRole("button", { name: "Query", exact: true }).click();
  await expect(page.getByLabel("SQL query")).toBeVisible();
}

async function setSql(page: Page, text: string) {
  await page.getByLabel("SQL query").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
}

test("Phase 6: run arbitrary SQL, format, history, saved queries and errors", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173/") &&
      !request.url().startsWith("blob:")
    )
      external.push(request.url());
  });
  await page.goto("/");
  await importJsonl(page, "workspace.jsonl", [
    '{"timestamp":"2026-01-01T01:00:00Z","level":"INFO","message":"first"}',
    '{"timestamp":"2026-01-01T02:00:00Z","level":"ERROR","message":"second"}',
    '{"timestamp":"2026-01-01T03:00:00Z","level":"ERROR","message":"third"}',
  ]);
  await expect(page.getByText("3 records · 0 failed · 0 skipped")).toBeVisible();
  await openQueryView(page);

  // Run query on a hand-written statement, via the button.
  await setSql(
    page,
    "SELECT level, COUNT(*) AS total FROM logs GROUP BY level ORDER BY total DESC",
  );
  await page.getByRole("button", { name: "Run query" }).click();
  const results = page.getByRole("table", { name: "SQL results" });
  await expect.poll(async () => (await results.boundingBox())?.height ?? 0).toBeGreaterThan(30);
  await expect(
    results.getByRole("row").nth(1),
    "highest count first",
  ).toContainText("ERROR");
  await expect(results.getByRole("row").nth(1)).toContainText("2");
  await expect(results.getByRole("row").nth(2)).toContainText("INFO");
  await expect(page.getByText(/2 rows · .* ms SQL execution/)).toBeVisible();

  // Ctrl/Cmd + Enter reruns the current statement.
  await setSql(page, "SELECT COUNT(*) AS total FROM logs");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    results.getByRole("cell", { name: "3", exact: true }),
  ).toBeVisible();

  // Clear invalidates the current result as well as the editor contents.
  await page.getByRole("button", { name: "Clear editor" }).click();
  await expect(page.getByLabel("SQL query")).toHaveText("");
  await expect(results).toHaveCount(0);

  // Format rewrites the statement in place.
  await setSql(page, "select level,count(*) as total from logs group by level");
  await page.getByRole("button", { name: "Format" }).click();
  await expect(page.getByLabel("SQL query")).toContainText("SELECT");
  await expect(page.getByLabel("SQL query")).toContainText("GROUP BY");

  // History keeps the runs and reloads a statement into the editor.
  await page.getByRole("button", { name: "Use history 2" }).click();
  await expect(page.getByLabel("SQL query")).toContainText("GROUP BY");
  await page.getByRole("button", { name: "Use history 1" }).click();
  await expect(page.getByLabel("SQL query")).toContainText("COUNT(*)");
  await expect(page.getByRole("button", { name: "Use history 2" })).toBeVisible();

  // Saved queries round-trip through the session.
  await setSql(page, "SELECT message FROM logs ORDER BY source_line LIMIT 1");
  await page.getByLabel("Saved query name").fill("first message");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Clear editor" }).click();
  await expect(page.getByLabel("SQL query")).toHaveText("");
  await page.getByRole("button", { name: "first message", exact: true }).click();
  await expect(page.getByLabel("SQL query")).toContainText("SELECT message");
  await page.getByRole("button", { name: "Remove saved query first message" }).click();
  await expect(
    page.getByRole("button", { name: "first message", exact: true }),
  ).toHaveCount(0);

  // Engine errors surface verbatim instead of failing silently.
  await setSql(page, "SELECT nope FROM logs");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByRole("alert")).toContainText(/nope/i, {
    timeout: 30_000,
  });
  await expect(results).toHaveCount(0);

  // The workspace is analytical and read-only; mutating SQL cannot damage the
  // loaded logs table.
  await setSql(page, "DROP TABLE logs");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByRole("alert")).toContainText(/read-only/i);
  await setSql(page, "SELECT COUNT(*) AS total FROM logs");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(results.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("Phase 6: unbounded results are capped with a notice", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await importJsonl(page, "many.jsonl", [
    ...Array.from(
      { length: 6000 },
      (_, index) => `{"level":"INFO","message":"row ${index}"}`,
    ),
  ]);
  await expect(
    page.getByText("6,000 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  await openQueryView(page);
  await setSql(page, "SELECT * FROM logs");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText("6,000 rows returned · 5,000 shown")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Showing 5,000 of 6,000 rows.")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("table", { name: "SQL results" })).toContainText(
    "row 4999",
  );
});

test("Phase 6: query results reset when the dataset or view changes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await importJsonl(page, "first.jsonl", [
    '{"level":"INFO","message":"alpha"}',
    '{"level":"ERROR","message":"beta"}',
  ]);
  await expect(page.getByText("2 records · 0 failed · 0 skipped")).toBeVisible();
  await openQueryView(page);
  await setSql(page, "SELECT COUNT(*) AS total FROM logs");
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(
    page.getByRole("table", { name: "SQL results" }).getByRole("cell", { name: "2" }),
  ).toBeVisible({ timeout: 60_000 });

  // Switching view keeps the statement but drops the stale result table.
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await expect(page.getByRole("table", { name: "SQL results" })).toHaveCount(0);
  await openQueryView(page);
  await expect(page.getByLabel("SQL query")).toContainText("COUNT(*)");
  await expect(page.getByRole("table", { name: "SQL results" })).toHaveCount(0);

  // A new dataset rebuilds the table: same statement, new answer.
  await importJsonl(page, "second.jsonl", [
    '{"level":"INFO","message":"one"}',
    '{"level":"INFO","message":"two"}',
    '{"level":"INFO","message":"three"}',
  ]);
  await expect(page.getByRole("table", { name: "SQL results" })).toHaveCount(0);
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await expect(page.getByText("3 records · 0 failed · 0 skipped")).toBeVisible();
  await openQueryView(page);
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(
    page.getByRole("table", { name: "SQL results" }).getByRole("cell", { name: "3" }),
  ).toBeVisible({ timeout: 60_000 });
});
