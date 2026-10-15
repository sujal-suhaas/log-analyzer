import {
  DataType,
  type RecordBatch,
  type Schema,
  type Vector,
} from "apache-arrow";

export type ExportFormat = "csv" | "json" | "jsonl";
export type ExportResult = {
  revision: number;
  format: ExportFormat;
  blob: Blob;
  filename: string;
  rowCount: number;
  /** Original column names in order, including duplicates. */
  columns: string[];
};

export function validateExportFormat(format: ExportFormat) {
  if (format !== "csv" && format !== "json" && format !== "jsonl")
    throw new Error("Unsupported export format.");
}

export function exportFilename(
  name: string,
  kind: "logs" | "query",
  format: ExportFormat,
) {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 120) || "logs";
  return `${base}-${kind}.${format}`;
}

// Keep bigint/decimal precision in JSON without relying on a consumer's number
// parser. Non-finite floats have no JSON number representation, so retain text.
function scalar(value: unknown): unknown {
  if (typeof value === "bigint")
    return value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : String(value);
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function decimalText(words: Uint32Array, scale: number): string {
  let integer = 0n;
  for (let index = words.length - 1; index >= 0; index--)
    integer = (integer << 32n) | BigInt(words[index]);
  if (words[words.length - 1] & 0x80000000)
    integer -= 1n << BigInt(words.length * 32);
  const sign = integer < 0 ? "-" : "";
  const digits = String(integer < 0 ? -integer : integer);
  if (scale <= 0) return sign + digits + "0".repeat(-scale);
  const padded = digits.padStart(scale + 1, "0");
  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function arrowValue(value: unknown, type: DataType): unknown {
  if (value == null) return null;
  if (DataType.isDictionary(type)) return arrowValue(value, type.dictionary);
  if (DataType.isDecimal(type))
    return decimalText(value as Uint32Array, type.scale);
  // Arrow's JS timestamp accessor returns milliseconds; sub-ms precision is
  // not represented by this ISO serialization.
  if (DataType.isDate(type) || DataType.isTimestamp(type))
    return new Date(Number(value)).toISOString();
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    const vector = value as Vector;
    return Array.from({ length: vector.length }, (_, index) =>
      arrowValue(vector.get(index), type.valueType),
    );
  }
  if (DataType.isStruct(type)) {
    const entries = Array.from(value as Iterable<[string, unknown]>);
    return Object.fromEntries(
      entries.map(([name, entry], index) => [
        name,
        arrowValue(entry, type.children[index].type),
      ]),
    );
  }
  if (DataType.isMap(type))
    return Array.from(value as Iterable<[unknown, unknown]>, ([key, entry]) => [
      arrowValue(key, type.keyType),
      arrowValue(entry, type.valueType),
    ]);
  if (ArrayBuffer.isView(value)) {
    // Binary values use a lossless hex string; intervals retain their components.
    if (value instanceof Uint8Array)
      return "\\x" + Array.from(
        value,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    return Array.from(value as unknown as ArrayLike<unknown>, scalar);
  }
  if (typeof value === "object")
    throw new Error(`Export does not support Arrow type ${type.toString()}.`);
  return scalar(value);
}

// Quote every textual field, including empty strings; null is an unquoted empty
// field. CR/LF and embedded quotes are preserved, without changing cell content.
function csvCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export type ExportSource = AsyncIterable<
  Pick<RecordBatch, "numRows" | "getChildAt">
> & {
  schema: Pick<Schema, "fields">;
};

/**
 * Logs: JSON array / JSONL objects, with nested extras.
 * Queries: JSON {columns, rows}; JSONL starts with {columns}, then {row} records.
 * Positional query rows preserve duplicate column names in every format.
 * Arrow vectors are read by index, never via a full-result toArray().
 */
export async function serializeExport(
  source: ExportSource,
  options: {
    revision: number;
    name: string;
    kind: "logs" | "query";
    format: ExportFormat;
  },
  assertCurrent: () => void = () => {},
): Promise<ExportResult> {
  const { revision, name, kind, format } = options;
  validateExportFormat(format);
  assertCurrent();
  const fields = source.schema.fields;
  const columns = fields.map((field) => field.name);
  const extrasIndex = kind === "logs" ? columns.indexOf("extras") : -1;
  const parts: Blob[] = [];
  let chunk = "";
  let rowCount = 0;
  const append = (text: string) => {
    chunk += text;
    if (chunk.length >= 64 * 1024) flush();
  };
  const flush = () => {
    if (chunk) parts.push(new Blob([chunk]));
    chunk = "";
  };
  const checkpoint = async () => {
    // Allow dataset replacement/query messages through even for one large batch.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertCurrent();
  };

  if (format === "csv") append(columns.map(csvCell).join(",") + "\r\n");
  else if (format === "json")
    append(
      kind === "logs"
        ? "["
        : `{"columns":${JSON.stringify(columns)},"rows":[`,
    );
  else if (kind === "query") append(JSON.stringify({ columns }) + "\n");

  for await (const batch of source) {
    assertCurrent();
    const vectors = fields.map((_, index) => {
      const vector = batch.getChildAt(index);
      if (!vector) throw new Error("Missing export column.");
      return vector;
    });
    for (let row = 0; row < batch.numRows; row++) {
      const values = vectors.map((vector, index) =>
        arrowValue(vector.get(row), fields[index].type),
      );
      if (format === "csv") append(values.map(csvCell).join(",") + "\r\n");
      else {
        if (extrasIndex >= 0 && typeof values[extrasIndex] === "string")
          values[extrasIndex] = JSON.parse(values[extrasIndex] as string);
        const record = kind === "logs"
          ? Object.fromEntries(columns.map((key, index) => [key, values[index]]))
          : values;
        if (format === "json")
          append((rowCount ? "," : "") + JSON.stringify(record));
        else
          append(JSON.stringify(kind === "logs" ? record : { row: record }) + "\n");
      }
      rowCount++;
      if (rowCount % 1000 === 0) await checkpoint();
    }
    await checkpoint();
  }
  if (format === "json") append(kind === "logs" ? "]\n" : "]}\n");
  flush();
  assertCurrent();
  const mime = {
    csv: "text/csv",
    json: "application/json",
    jsonl: "application/x-ndjson",
  }[format];
  return {
    revision,
    format,
    blob: new Blob(parts, { type: `${mime};charset=utf-8` }),
    filename: exportFilename(name, kind, format),
    rowCount,
    columns,
  };
}
