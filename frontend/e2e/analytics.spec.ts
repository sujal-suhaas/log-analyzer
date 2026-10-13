import { expect, test, type Page } from "@playwright/test";

const fixture = [
  '{"timestamp":"2026-01-01T00:00:00Z","level":"INFO","service":"api","status":200,"duration_ms":100,"message":"request ok"}',
  '{"timestamp":"2026-01-01T00:10:00Z","level":"ERROR","service":"api","status":500,"duration_ms":500,"message":"db timeout"}',
  '{"timestamp":"2026-01-01T00:20:00Z","level":"ERROR","service":"jobs","status":503,"duration_ms":300,"message":"db timeout"}',
  '{"timestamp":"2026-01-01T01:00:00Z","level":"WARN","service":"api","status":404,"duration_ms":50,"message":"missing route"}',
  '{"timestamp":"2026-01-02T00:00:00Z","level":"INFO","service":"web","status":200,"duration_ms":20,"message":"request ok"}',
  '{"timestamp":"2026-01-02T00:30:00Z","level":"ERROR","service":"api","status":500,"duration_ms":700,"message":"db timeout"}',
  '{"timestamp":"2026-01-02T01:00:00Z","level":"DEBUG","service":"worker","status":200,"duration_ms":10,"message":"cache warm"}',
  '{"timestamp":"2026-01-03T00:00:00Z","level":"INFO","service":"jobs","status":201,"duration_ms":200,"message":"request ok"}',
];

async function importFixture(page: Page) {
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "analytics.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(fixture.join("\n")),
  });
  await expect(page.getByText("8 records · 0 failed · 0 skipped")).toBeVisible();
}

test("Phase 7: analytics aggregates and chart filters work locally", async ({
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
  await importFixture(page);
  await page.getByRole("button", { name: "Analytics", exact: true }).click();

  const dashboard = page.getByRole("region", { name: "Analytics dashboard" });
  await expect(dashboard).toBeVisible();
  await expect(
    dashboard.getByText("Records", { exact: true }).locator("..").locator(".."),
  ).toContainText("8");

  const levels = dashboard.getByRole("region", { name: "Logs by level" });
  await expect(levels).toContainText("ERROR");
  await expect(
    levels.getByRole("button", { name: "ERROR, 3 logs", exact: true }),
  ).toBeVisible();

  await expect(
    dashboard.getByRole("region", { name: "Top error messages" }),
  ).toContainText("db timeout");
  await expect(
    dashboard.getByRole("region", { name: "Latency" }),
  ).toContainText("235.0 ms");

  await levels
    .getByRole("button", { name: "ERROR, 3 logs", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Structured", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Filter level", { exact: true })).toHaveValue(
    "ERROR",
  );
  await expect(page.getByLabel("Filter results")).toHaveText(
    "3 matching records · 3 source lines",
  );
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("Phase 7: empty analytics scope is explicit", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "empty.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(page.getByText("0 records · 0 failed · 0 skipped")).toBeVisible();
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  const dashboard = page.getByRole("region", { name: "Analytics dashboard" });
  await expect(dashboard.getByText("No records match the current scope.")).toBeVisible();
  await expect(
    dashboard.getByRole("region", { name: "Logs over time" }),
  ).toContainText("No timestamped records");
  await expect(
    dashboard.getByRole("region", { name: "Latency" }),
  ).toContainText("No duration_ms values");
});
