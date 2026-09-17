import { expect, test } from "@playwright/test";

test("Phase 4: imported logs support count, timestamp order and level grouping", async ({
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
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page
    .getByLabel("Replace or import log file")
    .setInputFiles({
      name: "queries.jsonl",
      mimeType: "text/plain",
      buffer: Buffer.from(
        [
          '{"timestamp":"2026-01-01T01:00:00Z","level":"INFO","message":"older","nested":{"ok":true}}',
          '{"timestamp":"2026-01-01T03:00:00+01:00","level":"ERROR","message":"newer"}',
          "{broken}",
          "",
        ].join("\n"),
      ),
    });
  await expect(
    page.getByText("3 records · 1 failed · 0 skipped"),
  ).toBeVisible();
  await page.getByText("SQL presets · DuckDB", { exact: true }).click();
  const results = page.getByRole("table", { name: "SQL results" });
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(
    results.getByRole("cell", { name: "3", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Latest logs", exact: true }).click();
  await expect(results.getByRole("row").nth(1)).toContainText("newer");
  await expect(results.getByRole("row").nth(2)).toContainText("older");
  await expect(results.getByRole("row").nth(3)).toContainText("{broken}");
  await page
    .getByRole("button", { name: "Counts by level", exact: true })
    .click();
  await expect(results.getByRole("row")).toHaveCount(4);
  await expect(results).toContainText("ERROR");
  await expect(results).toContainText("INFO");
  await expect(results).toContainText("NULL");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("Phase 4: 100K SQL rows, reparse, replacement and empty dataset", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const picker = page.getByLabel("Replace or import log file");
  const parser = page.getByRole("combobox", { name: "Parser", exact: true });
  const results = page.getByRole("table", { name: "SQL results" });
  await parser.selectOption("jsonl");
  await picker.setInputFiles({
    name: "large.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from('{"level":"INFO","message":"ok"}\n'.repeat(100_000)),
  });
  await expect(
    page.getByText("100,000 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  await page.getByText("SQL presets · DuckDB", { exact: true }).click();
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(
    results.getByRole("cell", { name: "100000", exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Latest logs", exact: true }).click();
  await expect(results.getByRole("row")).toHaveCount(101);
  await picker.setInputFiles({
    name: "large.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from("level,message\nWARN,hello\n"),
  });
  await expect(
    page.getByText("2 records · 2 failed · 0 skipped"),
  ).toBeVisible();
  await parser.selectOption("csv");
  await expect(
    page.getByText("1 records · 0 failed · 1 skipped"),
  ).toBeVisible();
  await page.getByText("SQL presets · DuckDB", { exact: true }).click();
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(
    results.getByRole("cell", { name: "1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Counts by level", exact: true })
    .click();
  await expect(results).toContainText("WARN");
  await picker.setInputFiles({
    name: "empty.csv",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(
    page.getByText("0 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  await page.getByText("SQL presets · DuckDB", { exact: true }).click();
  await page.getByRole("button", { name: "Count logs", exact: true }).click();
  await expect(
    results.getByRole("cell", { name: "0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(results).toHaveCount(0);
});
