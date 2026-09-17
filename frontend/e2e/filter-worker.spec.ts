import { expect, test } from "@playwright/test";
import { EMPTY_FILTERS } from "../src/lib/filters";

test("Worker SQL filter fixture: exact lines and regex ranges", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        (window as unknown as { logWorker: Worker }).logWorker = this;
      }
    };
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Parser", exact: true })
    .selectOption("jsonl");
  await page.getByLabel("Replace or import log file").setInputFiles({
    name: "fixture.jsonl",
    mimeType: "text/plain",
    buffer: Buffer.from(
      '{"level":"INFO","message":"ok"}\n{"level":"ERROR","message":"TIMEOUT gamma"}\n{"level":"WARN","message":"timeout alpha"}',
    ),
  });
  await expect(
    page.getByText("3 records · 0 failed · 0 skipped"),
  ).toBeVisible();
  const result = await page.evaluate(
    async (filters) => {
      const worker = (window as unknown as { logWorker: Worker }).logWorker;
      let id = 10000;
      const request = (payload: object): Promise<any> =>
        new Promise((resolve, reject) => {
          const requestId = ++id;
          const listener = ({ data }: MessageEvent) => {
            if (data.id !== requestId) return;
            worker.removeEventListener("message", listener);
            if (data.ok) resolve(data.result);
            else reject(new Error(JSON.stringify(payload) + ": " + data.error));
          };
          worker.addEventListener("message", listener);
          worker.postMessage({ ...payload, id: requestId, revision: 1 });
        });
      const summary = await request({ type: "FILTER", filters });
      const records = await request({
        type: "GET_RECORDS",
        filterId: summary.id,
        start: 0,
        count: 10,
      });
      const raw = await request({
        type: "GET_RAW_ROWS",
        filterId: summary.id,
        start: 0,
        count: 10,
      });
      return { total: summary.total, records, raw };
    },
    {
      ...EMPTY_FILTERS,
      text: "timeout (alpha|gamma)",
      regex: true,
      level: "ERROR",
    },
  );
  expect(result.total).toBe(1);
  expect(
    result.records.map((r: any) => [r.row, r.record.message, r.highlights]),
  ).toEqual([[1, "TIMEOUT gamma", [[0, 13]]]]);
  expect(result.raw.map((r: any) => r.row)).toEqual([1]);
});
