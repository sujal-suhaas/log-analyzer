import { expect, test, type Page } from "@playwright/test";

// playwright.config.ts starts the FastAPI backend on 127.0.0.1:8000, so these
// exercise the real endpoints and the real parsers, not a mock. The sample
// picker lives in the empty state, so each test starts from a fresh page.
async function openSamples(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Load a sample dataset" }).click();
  const panel = page.getByRole("region", { name: "Sample datasets" });
  await expect(panel).toBeVisible();
  return panel;
}

test("Phase 11: a sample access log downloads, parses and switches the parser", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");

  // Nothing is fetched until the user asks for a sample.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await expect(
    page.getByText("Every investigation starts with a log."),
  ).toBeVisible();
  expect(requests.filter((url) => url.includes(":8000"))).toEqual([]);

  await page.getByRole("button", { name: "Load a sample dataset" }).click();
  const panel = page.getByRole("region", { name: "Sample datasets" });
  await expect(
    panel.getByRole("button", { name: "Load Nginx access logs" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Load API server logs" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "Load Nginx access logs" }).click();
  await expect(page.getByText("1,000 records · 0 failed · 0 skipped")).toBeVisible({
    timeout: 60_000,
  });
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Parser", exact: true }),
  ).toHaveValue("access");
  await expect(page.getByRole("grid", { name: "Structured logs" })).toContainText(
    "/api/",
  );
  expect(errors).toEqual([]);
});

test("Phase 11: a sample JSONL dataset brings its own parser", async ({ page }) => {
  test.setTimeout(120_000);
  const panel = await openSamples(page);
  await panel.getByRole("button", { name: "Load API server logs" }).click();
  await expect(page.getByText("1,000 records · 0 failed · 0 skipped")).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("combobox", { name: "Parser", exact: true }),
  ).toHaveValue("jsonl");
  await expect(page.getByRole("grid", { name: "Structured logs" })).toContainText(
    "api-gateway",
  );
});

test("Phase 11: a failed sample download reports itself", async ({ page }) => {
  test.setTimeout(120_000);
  const panel = await openSamples(page);
  await page.route("**/datasets/*/download*", (route) => route.abort());
  await panel.getByRole("button", { name: "Load Payment service logs" }).click();
  await expect(page.getByRole("alert")).toContainText(/Could not download/i);
  await expect(page.getByText("No file imported yet")).toBeVisible();
});
