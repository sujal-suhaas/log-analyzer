import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { once } from "node:events";
import { dirname, resolve } from "node:path";

const root = resolve("test-fixtures", "logs");
mkdirSync(root, { recursive: true });

function scaleRecord(index) {
  return JSON.stringify({
    level: index % 10 === 9 ? "ERROR" : "INFO",
    message: `r${index}`,
  });
}

function richRecord(index) {
  const level = index % 10 === 9 ? "ERROR" : index % 7 === 0 ? "WARN" : "INFO";
  return JSON.stringify({
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
    level,
    service: ["api", "worker", "search"][index % 3],
    host: `web-${(index % 3) + 1}`,
    status: level === "ERROR" ? 500 + (index % 4) : 200 + (index % 5),
    duration_ms: 10 + (index * 37) % 490,
    message: level === "ERROR" ? "request failed" : "request completed",
    request_id: `req-${String(index).padStart(6, "0")}`,
    metadata: { attempt: index % 3, region: index % 2 ? "eu-west" : "us-east" },
  });
}

async function writeJsonl(name, count, record) {
  const path = resolve(root, name);
  const stream = createWriteStream(path, { encoding: "utf8" });
  for (let index = 0; index < count; index++) {
    if (!stream.write(`${record(index)}\n`)) await once(stream, "drain");
  }
  stream.end();
  await once(stream, "close");
  const size = statSync(path).size;
  console.log(`${path}: ${count.toLocaleString()} records, ${size.toLocaleString()} bytes`);
}

await writeJsonl("small-rich-100.jsonl", 100, richRecord);
await writeJsonl("scale-10000.jsonl", 10_000, scaleRecord);
await writeJsonl("scale-100000.jsonl", 100_000, scaleRecord);
await writeJsonl("scale-1100000.jsonl", 1_100_000, scaleRecord);
