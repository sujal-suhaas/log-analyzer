import { expect, test, type Page } from "@playwright/test";

const rows = [
  '{"timestamp":"2026-02-01T00:00:00Z","level":"INFO","service":"api","status":200,"duration_ms":10,"message":"phase8 boot"}',
  '{"timestamp":"2026-02-01T00:01:00Z","level":"ERROR","service":"api","status":503,"duration_ms":250,"message":"timeout alpha"}',
  '{"timestamp":"2026-02-01T00:02:00Z","level":"ERROR","service":"jobs","status":500,"duration_ms":500,"message":"timeout beta"}',
  '{"timestamp":"2026-02-01T00:03:00Z","level":"WARN","service":"web","status":404,"duration_ms":20,"message":"phase8 warning"}',
];

async function importFixture(page: Page) {
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "phase8-persistence.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(rows.join("\n")),
  });
  await expect(page.getByText("4 records · 0 failed · 0 skipped")).toBeVisible();
}

async function setSql(page: Page, text: string) {
  await page.getByLabel("SQL query").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
}

test("Phase 8: reload restores dataset, filters, query state and settings", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await importFixture(page);

  await page.getByText("More filters", { exact: true }).click();
  await page.getByLabel("Search logs", { exact: true }).fill("timeout");
  await page.getByLabel("Filter level", { exact: true }).fill("ERROR");
  await page.getByLabel("Minimum duration (ms)").fill("300");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "1 matching records · 1 source lines",
  );
  await page.getByLabel("Filter preset name").fill("timeouts");
  await page.getByRole("button", { name: "Save filter", exact: true }).click();
  await expect(page.getByRole("button", { name: "timeouts", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Query", exact: true }).click();
  const countQuery = "SELECT COUNT(*) AS total FROM logs";
  await setSql(page, countQuery);
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(
    page.getByRole("table", { name: "SQL results" }).getByRole("cell", { name: "4", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Saved query name").fill("persisted count");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.reload();
  const sidebar = page.getByRole("complementary");
  await expect(
    sidebar.getByRole("button", { name: /^phase8-persistence\.jsonl/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Query", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("SQL query")).toContainText(countQuery);
  await expect(
    page
      .getByRole("table", { name: "SQL results" })
      .getByRole("cell", { name: "4", exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  const history = page.getByRole("region", { name: "Query history" });
  await expect(history.getByRole("button", { name: "Use history 1" })).toHaveAttribute(
    "title",
    countQuery,
  );
  const saved = page.getByRole("region", { name: "Saved queries" });
  await expect(
    saved.getByRole("button", { name: "persisted count", exact: true }),
  ).toHaveAttribute("title", countQuery);

  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await page.getByText("More filters", { exact: true }).click();
  await expect(page.getByLabel("Search logs", { exact: true })).toHaveValue("timeout");
  await expect(page.getByLabel("Filter level", { exact: true })).toHaveValue("ERROR");
  await expect(page.getByLabel("Minimum duration (ms)")).toHaveValue("300");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "1 matching records · 1 source lines",
  );
  await expect(page.getByRole("button", { name: "timeouts", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("grid", { name: "Structured logs" })
      .getByRole("gridcell", { name: "timeout beta", exact: true }),
  ).toBeVisible();
});

test("Phase 8: clear removes the persisted dataset", async ({ page }) => {
  await page.goto("/");
  await importFixture(page);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Dataset cleared.")).toBeAttached();
  await page.reload();
  await expect(page.getByText("Restoring local workspace…")).toHaveCount(0);
  await expect(page.getByText("No file imported yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Query", exact: true })).toHaveCount(0);
});
