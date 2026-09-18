import { expect, test } from "@playwright/test";

// Multi-file workspace: every imported file stays listed, the newest becomes
// active, and switching reloads that file into the Worker on demand.
test("Multi-file: imported files stay listed, switch, remember parser and remove", async ({
  page,
}) => {
  const rows = [
    {
      timestamp: "2026-01-02T00:00:00Z",
      level: "INFO",
      service: "api",
      status: 200,
      message: "alpha one",
    },
    {
      timestamp: "2026-01-02T00:01:00Z",
      level: "WARN",
      service: "api",
      status: 429,
      message: "alpha two",
    },
    {
      timestamp: "2026-01-02T00:02:00Z",
      level: "ERROR",
      service: "jobs",
      status: 503,
      message: "alpha three",
    },
  ];
  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
  const plain = "gamma plain line\nfourth plain line";

  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const alpha = sidebar.getByRole("button", { name: /^alpha\.jsonl/ });
  const beta = sidebar.getByRole("button", { name: /^beta\.log/ });
  const parserSelect = page.getByRole("combobox", {
    name: "Parser",
    exact: true,
  });

  // One picker action with two files: both must survive.
  await page.getByLabel("Replace or import log file").setInputFiles([
    { name: "alpha.jsonl", mimeType: "text/plain", buffer: Buffer.from(jsonl) },
    { name: "beta.log", mimeType: "text/plain", buffer: Buffer.from(plain) },
  ]);

  await expect(alpha).toBeVisible();
  await expect(beta).toBeVisible();
  await expect(page.getByText("2 datasets")).toBeVisible();
  // Last import wins the active slot.
  await expect(beta).toHaveAttribute("aria-current", "true");
  await expect(alpha).not.toHaveAttribute("aria-current", "true");

  // Parser is remembered per file: reparse alpha as JSONL, then round-trip.
  await alpha.click();
  await expect(alpha).toHaveAttribute("aria-current", "true");
  await parserSelect.selectOption("jsonl");
  await expect(
    page.getByText("3 records · 0 failed · 0 skipped"),
  ).toBeVisible();

  await beta.click();
  await expect(parserSelect).toHaveValue("plain");
  await expect(
    page.getByText("2 records · 0 failed · 0 skipped"),
  ).toBeVisible();

  // Filters do not leak across files.
  await page.getByLabel("Search logs", { exact: true }).fill("nothing-matches");
  await expect(page.getByLabel("Filter results")).toHaveText(
    "0 matching records · 0 source lines",
  );
  await alpha.click();
  await expect(parserSelect).toHaveValue("jsonl");
  await expect(
    page.getByText("3 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  await expect(page.getByLabel("Search logs", { exact: true })).toHaveValue("");

  // Removing the active file falls back to the remaining one.
  await beta.click();
  await sidebar.getByLabel("Remove beta.log").click();
  await expect(beta).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("1 dataset")).toBeVisible();

  await sidebar.getByLabel("Remove alpha.jsonl").click();
  await expect(page.getByText("No file imported yet")).toBeVisible();
  await expect(page.getByText("No dataset")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import log file" }),
  ).toBeVisible();
});

test("Multi-file: re-importing the same file replaces its entry instead of duplicating", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const picker = page.getByLabel("Replace or import log file");
  const file = {
    name: "same.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from('{"level":"INFO","message":"one"}\n'),
  };
  await picker.setInputFiles(file);
  await expect(
    sidebar.getByRole("button", { name: /^same\.jsonl/ }),
  ).toHaveCount(1);

  await picker.setInputFiles({
    ...file,
    buffer: Buffer.from(
      '{"level":"INFO","message":"one"}\n{"level":"ERROR","message":"two"}\n',
    ),
  });
  await expect(
    sidebar.getByRole("button", { name: /^same\.jsonl/ }),
  ).toHaveCount(1);
  await expect(
    page.getByText("2 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  await expect(page.getByText("1 dataset")).toBeVisible();
});
