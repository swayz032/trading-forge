import { describe, it, expect } from "vitest";
import { buildOhlcvQuery } from "./duckdb-service.js";

describe("buildOhlcvQuery", () => {
  it("builds query for single month range", () => {
    const sql = buildOhlcvQuery({
      symbol: "ES",
      timeframe: "1min",
      from: "2024-01-01",
      to: "2024-01-31",
      adjusted: true,
    });
    expect(sql).toContain("futures/ES/ratio_adj/1min/2024/01/*.parquet");
    expect(sql).toContain("ts_event >= '2024-01-01'");
    expect(sql).toContain("ts_event <= '2024-01-31'");
  });

  it("builds query for multi-month range in same year", () => {
    const sql = buildOhlcvQuery({
      symbol: "NQ",
      timeframe: "5min",
      from: "2024-03-01",
      to: "2024-06-30",
      adjusted: true,
    });
    expect(sql).toContain("futures/NQ/ratio_adj/5min/2024/*/*.parquet");
  });

  it("builds query for multi-year range", () => {
    const sql = buildOhlcvQuery({
      symbol: "CL",
      timeframe: "daily",
      from: "2022-01-01",
      to: "2024-12-31",
      adjusted: true,
    });
    expect(sql).toContain("futures/CL/ratio_adj/daily/*/*/*.parquet");
  });

  it("uses raw path when adjusted=false", () => {
    const sql = buildOhlcvQuery({
      symbol: "ES",
      timeframe: "1min",
      from: "2024-01-01",
      to: "2024-01-31",
      adjusted: false,
    });
    expect(sql).toContain("futures/ES/raw/1min/");
    expect(sql).not.toContain("ratio_adj");
  });

  it("includes ORDER BY and LIMIT", () => {
    const sql = buildOhlcvQuery({
      symbol: "ES",
      timeframe: "1min",
      from: "2024-01-01",
      to: "2024-01-31",
      adjusted: true,
      limit: 1000,
    });
    expect(sql).toContain("ORDER BY ts_event");
    expect(sql).toContain("LIMIT 1000");
  });

  it("omits LIMIT when not specified", () => {
    const sql = buildOhlcvQuery({
      symbol: "ES",
      timeframe: "daily",
      from: "2024-01-01",
      to: "2024-12-31",
      adjusted: true,
    });
    expect(sql).toContain("ORDER BY ts_event");
    expect(sql).not.toContain("LIMIT");
  });
});
