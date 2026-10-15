import { describe, expect, test } from "bun:test";
import {
  Binary, Decimal, Field, Float64, Int32, Int64, List, Schema, Struct, TimestampMillisecond,
  Utf8, vectorFromArray, type DataType, type Vector,
} from "apache-arrow";
import { exportFilename, serializeExport, type ExportFormat, type ExportSource } from "../src/lib/export";

function source(columns: { name: string; vector: Vector }[], batchSizes?: number[]): ExportSource {
  const schema = new Schema(columns.map(({ name, vector }) => new Field(name, vector.type, true)));
  return {
    schema,
    async *[Symbol.asyncIterator]() {
      let offset = 0;
      for (const numRows of batchSizes ?? [columns[0]?.vector.length ?? 0]) {
        const start = offset;
        yield { numRows, getChildAt: (index: number) => columns[index].vector.slice(start, start + numRows) };
        offset += numRows;
      }
    },
  };
}

const options = (format: ExportFormat, kind: "logs" | "query" = "query") => ({
  revision: 42, name: "fixture.jsonl", kind, format,
});
const column = (name: string, values: unknown[], type: DataType = new Utf8()) => ({
  name, vector: vectorFromArray(values, type),
});

describe("Worker export serialization", () => {
  test("CSV preserves commas, quotes, CR/LF, Unicode, empty text and null without changing cells", async () => {
    const result = await serializeExport(source([
      column('message,"text', ['a,"b"\r\ncafé', "", null, "=1+1"]),
      column("number", [7, null, 0, -2], new Int32()),
    ]), options("csv"));
    expect(await result.blob.text()).toBe(
      '"message,""text","number"\r\n"a,""b""\r\ncafé",7\r\n"",\r\n,0\r\n"=1+1",-2\r\n',
    );
    expect(result).toMatchObject({ revision: 42, rowCount: 4, filename: "fixture-query.csv", format: "csv" });
    expect(result.blob.type).toBe("text/csv;charset=utf-8");
  });

  test("JSON query rows preserve duplicate names, nulls and exact signed 64-bit integers", async () => {
    const result = await serializeExport(source([
      column("x", [9007199254740993n, -9223372036854775808n], new Int64()),
      column("x", [null, 2], new Int32()),
      column("__proto__", ['"\n\\', "NULL"]),
    ], [1, 1]), options("json"));
    expect(JSON.parse(await result.blob.text())).toEqual({
      columns: ["x", "x", "__proto__"],
      rows: [["9007199254740993", null, '"\n\\'], ["-9223372036854775808", 2, "NULL"]],
    });
    expect(result.columns).toEqual(["x", "x", "__proto__"]);
    expect(result.rowCount).toBe(2);
  });

  test("CSV retains large integers exactly and duplicate headers positionally", async () => {
    const result = await serializeExport(source([
      column("x", [9223372036854775807n], new Int64()),
      column("x", [-9223372036854775808n], new Int64()),
    ]), options("csv"));
    expect(await result.blob.text()).toBe('"x","x"\r\n"9223372036854775807","-9223372036854775808"\r\n');
  });

  test("JSONL queries are self-describing with a schema line and positional row records", async () => {
    const result = await serializeExport(source([
      column("same", ["first\nline", null]), column("same", [2, 3], new Int32()),
    ]), options("jsonl"));
    expect((await result.blob.text()).trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual([
      { columns: ["same", "same"] }, { row: ["first\nline", 2] }, { row: [null, 3] },
    ]);
    expect(result.rowCount).toBe(2);
    expect(result.blob.type).toBe("application/x-ndjson;charset=utf-8");
  });

  for (const format of ["json", "jsonl"] as const) {
    test(`${format} logs retain nested extras, full raw text, parse errors, nulls and timestamps`, async () => {
      const long = "x".repeat(8000) + '\n"raw"';
      const result = await serializeExport(source([
        column("source_line", [1, 3], new Int32()),
        column("timestamp", [new Date("2026-01-02T03:04:05.123Z"), null], new TimestampMillisecond()),
        column("message", [long, "bad input"]),
        column("raw", [long, "not JSON"]),
        column("extras", ['{"nested":{"list":[1,null,"q"]},"__proto__":{"kept":true}}', "{}"]),
        column("parse_error", [null, "Invalid JSON"]),
      ]), options(format, "logs"));
      const text = await result.blob.text();
      const records = format === "json" ? JSON.parse(text) : text.trimEnd().split("\n").map((line) => JSON.parse(line));
      expect(records).toEqual([
        { source_line: 1, timestamp: "2026-01-02T03:04:05.123Z", message: long, raw: long,
          extras: JSON.parse('{"nested":{"list":[1,null,"q"]},"__proto__":{"kept":true}}'), parse_error: null },
        { source_line: 3, timestamp: null, message: "bad input", raw: "not JSON", extras: {}, parse_error: "Invalid JSON" },
      ]);
      expect(result.filename).toBe(`fixture-logs.${format}`);
    });
  }

  test("nested Arrow lists/structs and decimals serialize as values rather than Arrow internals", async () => {
    const child = new Field("value", new Int64(), true);
    const result = await serializeExport(source([
      column("list", [[1n, 9007199254740993n, null]], new List(child)),
      column("struct", [{ field: 9007199254740993n }], new Struct([new Field("field", new Int64(), true)])),
      column("decimal", [new Uint32Array([12345, 0, 0, 0])], new Decimal(2, 38)),
      column("negative", [new Uint32Array([0xffffcfc7, 0xffffffff, 0xffffffff, 0xffffffff])], new Decimal(2, 38)),
    ]), options("json"));
    expect(JSON.parse(await result.blob.text()).rows).toEqual([
      [[1, "9007199254740993", null], { field: "9007199254740993" }, "123.45", "-123.45"],
    ]);
  });

  test("non-finite floats remain valid JSON and binary values retain every byte", async () => {
    const result = await serializeExport(source([
      column("float", [NaN, Infinity, -Infinity], new Float64()),
      column("binary", [new Uint8Array([0, 15, 255]), null, new Uint8Array([])], new Binary()),
    ]), options("json"));
    expect(JSON.parse(await result.blob.text()).rows).toEqual([
      ["NaN", "\\x000fff"], ["Infinity", null], ["-Infinity", "\\x"],
    ]);
  });

  test("empty exports remain valid and carry column names where the format has a header", async () => {
    for (const kind of ["logs", "query"] as const) {
      for (const format of ["csv", "json", "jsonl"] as const) {
        const result = await serializeExport(source([column("message", [])], []), options(format, kind));
        const expected = format === "csv" ? '"message"\r\n'
          : format === "json" ? kind === "logs" ? "[]\n" : '{"columns":["message"],"rows":[]}\n'
          : kind === "logs" ? "" : '{"columns":["message"]}\n';
        expect(await result.blob.text()).toBe(expected);
        expect(result.rowCount).toBe(0);
        expect(result.columns).toEqual(["message"]);
      }
    }
  });

  test("multiple vector batches export beyond the preview cap without materializing row objects", async () => {
    const count = 12_345;
    const result = await serializeExport(source([
      column("n", Array.from({ length: count }, (_, index) => index), new Int32()),
    ], [4096, 4096, 4153]), options("json"));
    const data = JSON.parse(await result.blob.text());
    expect(result.rowCount).toBe(count);
    expect(data.rows.length).toBe(count);
    expect(data.rows[0]).toEqual([0]);
    expect(data.rows[count - 1]).toEqual([count - 1]);
  });

  test("staleness during a large batch rejects, closes the iterator and returns no partial result", async () => {
    let closed = false;
    const input = source([column("n", Array.from({ length: 5000 }, (_, index) => index), new Int32())]);
    const guarded: ExportSource = {
      schema: input.schema,
      async *[Symbol.asyncIterator]() {
        try { yield* input; } finally { closed = true; }
      },
    };
    let checks = 0;
    await expect(serializeExport(guarded, options("json"), () => {
      if (++checks === 3) throw new Error("Dataset changed");
    })).rejects.toThrow("Dataset changed");
    expect(closed).toBe(true);
  });

  test("stream and format errors reject rather than producing a partial file", async () => {
    const input = source([column("message", ["first"])]);
    const broken: ExportSource = {
      schema: input.schema,
      async *[Symbol.asyncIterator]() { yield* input; throw new Error("engine failed"); },
    };
    await expect(serializeExport(broken, options("json"))).rejects.toThrow("engine failed");
    await expect(serializeExport(input, options("xml" as ExportFormat))).rejects.toThrow("Unsupported export format");
  });
});

test("export filenames are deterministic and cannot introduce a path", () => {
  expect(exportFilename("C:\\logs\\production.jsonl", "logs", "csv")).toBe("production-logs.csv");
  expect(exportFilename('bad:name?.log', "query", "json")).toBe("bad_name_-query.json");
  expect(exportFilename(".log", "logs", "jsonl")).toBe("logs-logs.jsonl");
});
