import { EMPTY_FILTERS, filterWhere, type Filters } from "./filters";
import { SQL_LIMIT } from "./queries";

// CloudWatch/Datadog-style shorthand for the Query workspace:
//   level:ERROR service:auth status:500+ "database timeout"
// It compiles to the same WHERE clause the filter panel builds, so both paths
// always select the same rows.
const KEYS = [
  "level",
  "service",
  "host",
  "status",
  "duration",
  "time",
  "from",
  "to",
  "text",
] as const;
type Key = (typeof KEYS)[number];
const TIMES = ["all", "1h", "24h", "7d"] as const;

type Token = { value: string; quoted: boolean };

// Whitespace splits tokens; double quotes keep a value together, including
// spaces and colons. A token that starts with a quote is always search text.
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let value = "";
  let quoted = false;
  let open = false;
  for (const character of input) {
    if (character === '"') {
      if (!open && !value) quoted = true;
      open = !open;
      continue;
    }
    if (!open && /\s/.test(character)) {
      if (value) tokens.push({ value, quoted });
      value = "";
      quoted = false;
      continue;
    }
    value += character;
  }
  if (open) throw new Error('Close the quoted value with ".');
  if (value) tokens.push({ value, quoted });
  return tokens;
}

// Status codes and durations are integers, so ">500" is ">=501".
function bounds(value: string, column: "status" | "duration") {
  const text = value.trim();
  const exact = /^\d+$/.exec(text);
  const plus = /^(\d+)\+$/.exec(text);
  const span = /^(\d+)-(\d+)$/.exec(text);
  const compare = /^(>=|<=|>|<)(\d+)$/.exec(text);
  if (exact) return [exact[0], exact[0]] as const;
  if (plus) return [plus[1], ""] as const;
  if (span) return [span[1], span[2]] as const;
  if (compare) {
    const number = Number(compare[2]);
    if (compare[1] === ">=") return [String(number), ""] as const;
    if (compare[1] === "<=") return ["", String(number)] as const;
    if (compare[1] === ">") return [String(number + 1), ""] as const;
    return ["", String(number - 1)] as const;
  }
  throw new Error(
    `Use ${column}:500, ${column}:500+, ${column}:400-499, ${column}:>=500 or ${column}:<=499.`,
  );
}

export function parseQueryBar(input: string): Filters {
  const filters: Filters = { ...EMPTY_FILTERS };
  const text: string[] = [];
  for (const token of tokenize(input)) {
    const separator = token.value.indexOf(":");
    const key = token.quoted ? "" : token.value.slice(0, separator).toLowerCase();
    if (separator < 1 || !key) {
      text.push(token.value);
      continue;
    }
    const value = token.value.slice(separator + 1);
    if (!KEYS.includes(key as Key)) {
      // "http://x" is search text, "levl:ERROR" is a typo worth reporting.
      if (/^[a-z_]{2,12}$/.test(key) && !token.value.includes("://"))
        throw new Error(`Unknown filter "${key}". Use ${KEYS.join(", ")}.`);
      text.push(token.value);
      continue;
    }
    if (!value) throw new Error(`Filter "${key}" needs a value.`);
    if (key === "level") filters.level = value.toUpperCase();
    else if (key === "service" || key === "host") filters[key] = value;
    else if (key === "text") text.push(value);
    else if (key === "status") {
      const [min, max] = bounds(value, "status");
      filters.statusMin = min;
      filters.statusMax = max;
    } else if (key === "duration") {
      const [min, max] = bounds(value, "duration");
      filters.durationMin = min;
      filters.durationMax = max;
    } else if (key === "time") {
      const time = value.toLowerCase();
      if (!TIMES.includes(time as (typeof TIMES)[number]))
        throw new Error(`Use time:${TIMES.join(", time:")}.`);
      filters.time = time as Filters["time"];
    } else {
      // Remaining keys are the timestamp bounds.
      filters[key as "from" | "to"] = value;
      filters.time = "custom";
    }
  }
  filters.text = text.join(" ");
  return filters;
}

// The editor shows the SQL the bar produced, so the bar compiles to a complete
// statement: it can be edited, formatted, saved and exported like hand-written
// SQL. Values are literals here, not bound parameters, and are quoted exactly
// once, at this boundary.
function inline(sql: string, params: (string | number)[]) {
  let index = 0;
  let result = "";
  let quoted = false;
  for (const character of sql) {
    if (character === "'") {
      quoted = !quoted;
      result += character;
      continue;
    }
    if (character !== "?" || quoted) {
      result += character;
      continue;
    }
    const value = params[index++];
    result +=
      typeof value === "number"
        ? String(value)
        : `'${String(value).replace(/'/g, "''")}'`;
  }
  if (index !== params.length)
    throw new Error("Could not build SQL from these filters.");
  return result;
}

export function queryBarSql(input: string): string {
  const filters = parseQueryBar(input);
  const where = filterWhere(filters);
  if (!where.active)
    throw new Error("Enter a filter like level:ERROR, or text to search.");
  return [
    "SELECT source_line, CAST(timestamp AS VARCHAR) AS timestamp, level,",
    "service, host, status, duration_ms, message FROM logs WHERE",
    inline(where.sql, where.params),
    "ORDER BY logs.timestamp DESC NULLS LAST, source_line ASC",
    `LIMIT ${SQL_LIMIT};`,
  ].join(" ");
}
