import { describe, expect, test } from "bun:test";
import { EMPTY_FILTERS, filterWhere } from "../src/lib/filters";

describe("filterWhere", () => {
  test("empty filters are inactive and parameterless", () => {
    expect(filterWhere(EMPTY_FILTERS)).toEqual({
      sql: "TRUE",
      params: [],
      active: false,
    });
  });

  test("text search binds parameters and escapes options in SQL", () => {
    const where = filterWhere({
      ...EMPTY_FILTERS,
      text: "abc'); --",
      regex: true,
    });
    expect(where.params).toEqual(["abc'); --", "abc'); --"]);
    expect(where.sql).toContain("'i'");
    expect(where.sql).not.toContain("abc");
  });

  test("status bounds validate inclusive integer range", () => {
    expect(() => filterWhere({ ...EMPTY_FILTERS, statusMin: "99" })).toThrow();
    expect(() => filterWhere({ ...EMPTY_FILTERS, statusMax: "600" })).toThrow();
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, statusMin: "500", statusMax: "200" }),
    ).toThrow();
    const where = filterWhere({
      ...EMPTY_FILTERS,
      statusMin: "500",
      statusMax: "599",
    });
    expect(where.sql).toContain("status >= ?");
    expect(where.sql).toContain("status <= ?");
    expect(where.params).toEqual([500, 599]);
  });

  test("duration bounds are numeric and ordered", () => {
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, durationMin: "-1" }),
    ).toThrow();
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, durationMax: "abc" }),
    ).toThrow();
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, durationMin: "5", durationMax: "1" }),
    ).toThrow();
    expect(filterWhere({ ...EMPTY_FILTERS, durationMin: "0" }).params).toEqual([
      0,
    ]);
  });

  test("relative presets bind hours; custom needs timezone and order", () => {
    const relative = filterWhere({ ...EMPTY_FILTERS, time: "24h" });
    expect(relative.sql).toContain("MAX(timestamp)");
    expect(relative.params).toEqual([24]);
    expect(() =>
      filterWhere({
        ...EMPTY_FILTERS,
        time: "custom",
        from: "2026-01-01T00:00:00",
      }),
    ).toThrow();
    expect(() =>
      filterWhere({
        ...EMPTY_FILTERS,
        time: "custom",
        from: "2026-01-02T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      }),
    ).toThrow();
    const custom = filterWhere({
      ...EMPTY_FILTERS,
      time: "custom",
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-02T00:00:00Z",
    });
    expect(custom.sql).toContain("timestamp >= CAST(? AS TIMESTAMPTZ)");
    expect(custom.sql).toContain("timestamp <= CAST(? AS TIMESTAMPTZ)");
  });

  test("level normalizes; unknown preset keys rejected", () => {
    expect(filterWhere({ ...EMPTY_FILTERS, level: "error" }).params).toEqual([
      "ERROR",
    ]);
    expect(filterWhere({ ...EMPTY_FILTERS, service: "api" }).sql).toContain(
      "service = ?",
    );
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, time: "bogus" as never }),
    ).toThrow();
    expect(() =>
      filterWhere({ ...EMPTY_FILTERS, text: "a".repeat(1001) }),
    ).toThrow();
  });
});
