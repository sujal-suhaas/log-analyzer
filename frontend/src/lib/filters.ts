export type Filters = {
  text: string;
  regex: boolean;
  level: string;
  service: string;
  host: string;
  statusMin: string;
  statusMax: string;
  durationMin: string;
  durationMax: string;
  time: "all" | "1h" | "24h" | "7d" | "custom";
  from: string;
  to: string;
};
export const EMPTY_FILTERS: Filters = {
  text: "",
  regex: false,
  level: "",
  service: "",
  host: "",
  statusMin: "",
  statusMax: "",
  durationMin: "",
  durationMax: "",
  time: "all",
  from: "",
  to: "",
};
export type FilterSummary = {
  id: number;
  revision: number;
  total: number;
  lineCount: number;
  filters: Filters;
};
export type Highlight = [number, number];

// Only fixed column names/operators enter SQL. All user values are bound parameters.
export function filterWhere(filters: Filters) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]) => {
    clauses.push(sql);
    params.push(...values);
  };
  if (
    typeof filters.regex !== "boolean" ||
    !["all", "1h", "24h", "7d", "custom"].includes(filters.time)
  )
    throw new Error("Invalid filter options.");
  for (const [key, value] of Object.entries(filters)) {
    if (key === "regex") continue;
    if (
      typeof value !== "string" ||
      value.length > 1000 ||
      value.includes("\0")
    )
      throw new Error(
        "Filter text must be at most 1000 characters, without NUL.",
      );
  }
  if (filters.text)
    add(
      `(regexp_matches(message, ?, '${filters.regex ? "i" : "il"}') OR regexp_matches(raw, ?, '${filters.regex ? "i" : "il"}'))`,
      filters.text,
      filters.text,
    );
  for (const key of ["level", "service", "host"] as const)
    if (filters[key])
      add(
        `${key} = ?`,
        key === "level" ? filters[key].toUpperCase() : filters[key],
      );
  for (const [column, minKey, maxKey] of [
    ["status", "statusMin", "statusMax"],
    ["duration_ms", "durationMin", "durationMax"],
  ] as const) {
    const min = filters[minKey] === "" ? null : Number(filters[minKey]);
    const max = filters[maxKey] === "" ? null : Number(filters[maxKey]);
    for (const value of [min, max])
      if (
        value !== null &&
        (!Number.isFinite(value) ||
          value < 0 ||
          (column === "status" &&
            (!Number.isInteger(value) || value < 100 || value > 599)))
      )
        throw new Error(`Invalid ${column} range.`);
    if (min !== null && max !== null && min > max)
      throw new Error(`${column} minimum exceeds maximum.`);
    if (min !== null) add(`${column} >= ?`, min);
    if (max !== null) add(`${column} <= ?`, max);
  }
  const hours = { "1h": 1, "24h": 24, "7d": 168 };
  if (filters.time in hours)
    add(
      "timestamp >= (SELECT MAX(timestamp) FROM logs) - (? * INTERVAL 1 HOUR)",
      hours[filters.time as keyof typeof hours],
    );
  if (filters.time === "custom") {
    for (const key of ["from", "to"] as const)
      if (
        filters[key] &&
        (!/Z$|[+-]\d\d:\d\d$/.test(filters[key]) ||
          !Number.isFinite(Date.parse(filters[key])))
      )
        throw new Error("Invalid time range. Include timezone.");
    if (
      filters.from &&
      filters.to &&
      Date.parse(filters.from) > Date.parse(filters.to)
    )
      throw new Error("Start time exceeds end time.");
    if (filters.from) add("timestamp >= CAST(? AS TIMESTAMPTZ)", filters.from);
    if (filters.to) add("timestamp <= CAST(? AS TIMESTAMPTZ)", filters.to);
  }
  return {
    sql: clauses.length ? clauses.join(" AND ") : "TRUE",
    params,
    active: clauses.length > 0,
  };
}
