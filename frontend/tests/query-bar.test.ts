import { describe, expect, test } from "bun:test";
import { EMPTY_FILTERS } from "../src/lib/filters";
import { parseQueryBar, queryBarSql } from "../src/lib/query-bar";

describe("parseQueryBar", () => {
  test("empty input keeps the filter panel's defaults", () => {
    expect(parseQueryBar("")).toEqual(EMPTY_FILTERS);
    expect(parseQueryBar("   ")).toEqual(EMPTY_FILTERS);
  });

  test("bare words join into one search text", () => {
    expect(parseQueryBar("database timeout")).toEqual({
      ...EMPTY_FILTERS,
      text: "database timeout",
    });
  });

  test("level, service and host map onto the same keys the panel uses", () => {
    expect(parseQueryBar("level:error service:auth host:web-01")).toEqual({
      ...EMPTY_FILTERS,
      level: "ERROR",
      service: "auth",
      host: "web-01",
    });
  });

  test("status and duration accept exact, range, + and comparator forms", () => {
    const cases = [
      ["status:500", "500", "500"],
      ["status:500+", "500", ""],
      ["status:400-499", "400", "499"],
      ["status:>=500", "500", ""],
      ["status:<=499", "", "499"],
      ["status:>500", "501", ""],
      ["status:<500", "", "499"],
    ] as const;
    for (const [input, min, max] of cases)
      expect([input, parseQueryBar(input).statusMin, parseQueryBar(input).statusMax])
        .toEqual([input, min, max]);
    const duration = parseQueryBar("duration:100-250");
    expect([duration.durationMin, duration.durationMax]).toEqual(["100", "250"]);
  });

  test("time presets and custom timestamps select the time window", () => {
    expect(parseQueryBar("time:24h").time).toBe("24h");
    expect(parseQueryBar("time:all").time).toBe("all");
    const custom = parseQueryBar(
      "from:2026-01-01T00:00:00Z to:2026-01-02T00:00:00Z",
    );
    expect([custom.time, custom.from, custom.to]).toEqual([
      "custom",
      "2026-01-01T00:00:00Z",
      "2026-01-02T00:00:00Z",
    ]);
  });

  test("quotes keep spaces and colons in one value, and quoted tokens are text", () => {
    const filters = parseQueryBar('service:"payment api" "http://x"');
    expect(filters.service).toBe("payment api");
    expect(filters.text).toBe("http://x");
  });

  test("unquoted URLs stay search text instead of becoming a filter", () => {
    expect(parseQueryBar("http://example.test/path").text).toBe(
      "http://example.test/path",
    );
  });

  test("typos and malformed values are reported, never silently dropped", () => {
    expect(() => parseQueryBar("levl:ERROR")).toThrow(/Unknown filter "levl"/);
    expect(() => parseQueryBar("level:")).toThrow(/needs a value/);
    expect(() => parseQueryBar("status:abc")).toThrow(/Use status:500/);
    expect(() => parseQueryBar("time:2h")).toThrow(/Use time:all/);
    expect(() => parseQueryBar('service:"open')).toThrow(/Close the quoted/);
  });

  test("filterWhere still owns range validation", () => {
    expect(() => queryBarSql("status:99")).toThrow(/Invalid status range/);
    expect(() => queryBarSql("status:600")).toThrow(/Invalid status range/);
  });
});

describe("queryBarSql", () => {
  test("empty filters are refused rather than selecting every row", () => {
    expect(() => queryBarSql("")).toThrow(/Enter a filter/);
  });

  test("filters compile into a complete, ordered statement", () => {
    expect(queryBarSql("level:ERROR")).toBe(
      "SELECT source_line, CAST(timestamp AS VARCHAR) AS timestamp, level, " +
        "service, host, status, duration_ms, message FROM logs WHERE " +
        "level = 'ERROR' " +
        "ORDER BY logs.timestamp DESC NULLS LAST, source_line ASC LIMIT 5000;",
    );
  });

  test("several filters join with AND and numbers are unquoted", () => {
    const sql = queryBarSql("level:ERROR service:auth status:500+ timeout");
    expect(sql).toContain("level = 'ERROR' AND service = 'auth'");
    expect(sql).toContain("status >= 500");
    expect(sql).toContain("regexp_matches(message, 'timeout', 'il')");
    expect(sql).not.toContain("?");
  });

  test("values are quoted exactly once, so quotes cannot escape", () => {
    const sql = queryBarSql("service:\"a'b\"");
    expect(sql).toContain("service = 'a''b'");
    expect(sql.match(/FROM logs WHERE/gu)?.length).toBe(1);
  });

  test("time windows reuse the filter panel's max-timestamp subquery", () => {
    expect(queryBarSql("time:1h")).toContain(
      "timestamp >= (SELECT MAX(timestamp) FROM logs) - (1 * INTERVAL 1 HOUR)",
    );
  });
});
