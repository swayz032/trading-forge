import { describe, it, expect } from "vitest";
import { buildS3Key, parseS3Key } from "./s3-client.js";

describe("buildS3Key", () => {
  it("builds OHLCV key with date partitioning", () => {
    expect(
      buildS3Key({
        symbol: "ES",
        kind: "ratio_adj",
        timeframe: "1min",
        date: "2024-01-15",
      })
    ).toBe("futures/ES/ratio_adj/1min/2024/01/15.parquet");
  });

  it("builds key for different symbol and timeframe", () => {
    expect(
      buildS3Key({
        symbol: "NQ",
        kind: "raw",
        timeframe: "5min",
        date: "2023-06-01",
      })
    ).toBe("futures/NQ/raw/5min/2023/06/01.parquet");
  });

  it("builds roll calendar key (no timeframe or date partitioning)", () => {
    expect(
      buildS3Key({
        symbol: "CL",
        kind: "roll_calendar",
        year: "2024",
      })
    ).toBe("futures/CL/roll_calendar/2024.json");
  });

  it("builds daily timeframe key", () => {
    expect(
      buildS3Key({
        symbol: "ES",
        kind: "ratio_adj",
        timeframe: "daily",
        date: "2024-03-20",
      })
    ).toBe("futures/ES/ratio_adj/daily/2024/03/20.parquet");
  });
});

describe("parseS3Key", () => {
  it("parses OHLCV key", () => {
    const result = parseS3Key(
      "futures/ES/ratio_adj/5min/2024/01/15.parquet"
    );
    expect(result).toEqual({
      symbol: "ES",
      kind: "ratio_adj",
      timeframe: "5min",
      year: "2024",
      month: "01",
      day: "15",
    });
  });

  it("parses roll calendar key", () => {
    const result = parseS3Key("futures/CL/roll_calendar/2024.json");
    expect(result).toEqual({
      symbol: "CL",
      kind: "roll_calendar",
      year: "2024",
    });
  });

  it("parses daily key", () => {
    const result = parseS3Key(
      "futures/NQ/raw/daily/2023/12/31.parquet"
    );
    expect(result).toEqual({
      symbol: "NQ",
      kind: "raw",
      timeframe: "daily",
      year: "2023",
      month: "12",
      day: "31",
    });
  });
});
