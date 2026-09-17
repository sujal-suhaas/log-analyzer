import { expect, test } from "@playwright/test";

// Instrument native Worker boundary, not production code. No data leaves browser.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      workers: [] as Worker[],
      cancelParse: false,
      parsing: false,
      frames: 0,
      maxGap: 0,
      last: 0,
      windows: [] as number[],
    };
    Object.assign(window, { workerProbe: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.workers.push(this);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "PARSE_PROGRESS") {
            state.parsing = true;
            if (state.cancelParse) {
              state.cancelParse = false;
              this.postMessage({ id: -1, type: "CANCEL", target: data.id });
            }
          }
          if ("ok" in data) state.parsing = false;
        });
      }
      postMessage(message: unknown) {
        const request = message as { count?: number };
        if (request.count !== undefined) state.windows.push(request.count);
        super.postMessage(message);
      }
    };
    function frame(now: number) {
      if (state.parsing && state.last) {
        state.frames++;
        state.maxGap = Math.max(state.maxGap, now - state.last);
      }
      state.last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
});

test("Worker: atomic cancellation, responsive parsing, bounded windows and same-name replacement", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const picker = page.getByLabel("Replace or import log file");
  const parser = page.getByRole("combobox", { name: "Parser", exact: true });
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await parser.selectOption("jsonl");
  const old = {
    name: "same.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from('{"message":"old"}\n'),
  };
  await picker.setInputFiles(old);
  await expect(
    grid.getByRole("gridcell", { name: "old", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as { workerProbe: { cancelParse: boolean } }
    ).workerProbe.cancelParse = true;
  });
  const large = {
    name: "large.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '{"message":"new","nested":{"status":200},"level":"INFO"}\n'.repeat(
        300_000,
      ),
    ),
  };
  await picker.setInputFiles(large);
  await expect(
    page.getByText("Import cancelled. Previous file kept."),
  ).toHaveCount(1);
  // New requests must read old Worker dataset, not just old UI cache.
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByRole("listbox").getByRole("option").first().click();
  await expect(page.getByLabel("Raw log content")).toHaveText('{"message":"old"}');
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  await picker.setInputFiles({
    ...old,
    buffer: Buffer.from('{"message":"new"}\n'),
  });
  await expect(
    grid.getByRole("gridcell", { name: "new", exact: true }),
  ).toBeVisible();
  await expect(
    grid.getByRole("gridcell", { name: "old", exact: true }),
  ).toHaveCount(0);
  await picker.setInputFiles(large);
  await expect(
    page.getByText("300,000 records · 0 failed · 0 skipped"),
  ).toBeVisible({ timeout: 45_000 });
  await grid.focus();
  await grid.press("End");
  await expect(grid.locator('[aria-rowindex="300001"]')).toBeVisible();
  await expect(page.getByLabel("Raw log content")).toContainText('"nested":{"status":200}');
  const probe = await page.evaluate(() => {
    const p = (
      window as unknown as {
        workerProbe: {
          workers: Worker[];
          frames: number;
          maxGap: number;
          windows: number[];
        };
      }
    ).workerProbe;
    return {
      workers: p.workers.length,
      frames: p.frames,
      maxGap: p.maxGap,
      largestWindow: Math.max(...p.windows),
    };
  });
  console.log("Worker responsiveness:", probe);
  expect(probe.workers).toBe(1);
  expect(probe.frames).toBeGreaterThan(3);
  expect(probe.maxGap).toBeLessThan(500);
  expect(probe.largestWindow).toBeLessThanOrEqual(256);
  expect(errors).toEqual([]);
});

test("Worker: invalid UTF-8 preserves data; crash surfaced and Clear recovers", async ({
  page,
}) => {
  await page.goto("/");
  const picker = page.getByLabel("Replace or import log file");
  await picker.setInputFiles({
    name: "ok.log",
    mimeType: "text/plain",
    buffer: Buffer.from("hello\n"),
  });
  const grid = page.getByRole("grid", { name: "Structured logs" });
  await expect(
    grid.getByRole("gridcell", { name: "hello", exact: true }),
  ).toBeVisible();
  await picker.setInputFiles({
    name: "bad.log",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff]),
  });
  await expect(page.getByRole("alert")).toContainText("valid UTF-8");
  await grid.focus();
  await grid.press("Enter");
  await expect(page.getByLabel("Raw log content")).toHaveText("hello");
  await page.evaluate(() => {
    const p = (window as unknown as { workerProbe: { workers: Worker[] } })
      .workerProbe;
    p.workers[0].dispatchEvent(
      new ErrorEvent("error", { message: "Simulated Worker failure" }),
    );
  });
  await expect(page.getByRole("alert")).toContainText("Worker crashed");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await picker.setInputFiles({
    name: "recovered.log",
    mimeType: "text/plain",
    buffer: Buffer.from("recovered\n"),
  });
  await expect(
    grid.getByRole("gridcell", { name: "recovered", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
