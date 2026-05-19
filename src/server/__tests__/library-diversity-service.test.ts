/**
 * Library Diversity Service Tests — Track 5 Phase D Readiness
 *
 * 8 tests covering:
 *   1. School mapping — ICT indicators
 *   2. School mapping — TREND indicators
 *   3. School mapping — MEAN_REVERSION indicators
 *   4. School mapping — UNKNOWN fallback
 *   5. Distribution computation — byStage accumulation
 *   6. Distribution computation — total accumulation
 *   7. ICT pct computation — correct share of DEPLOYED
 *   8. Edge case — empty strategies table returns empty distribution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  rows: [] as Array<{ lifecycleState: string; config: Record<string, unknown> }>,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation(() => Promise.resolve(mockState.rows)),
    }),
  },
}));

vi.mock("../index.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { classifySchool, computeLibraryDiversity } from "../services/library-diversity-service.js";

describe("classifySchool", () => {
  it("classifies order_block as ICT_HANDCODED", () => {
    expect(classifySchool("order_block")).toBe("ICT_HANDCODED");
  });

  it("classifies fvg as ICT_HANDCODED", () => {
    expect(classifySchool("fvg")).toBe("ICT_HANDCODED");
  });

  it("classifies ema_crossover as TREND", () => {
    expect(classifySchool("ema_crossover")).toBe("TREND");
  });

  it("classifies vwap_reversion as MEAN_REVERSION", () => {
    expect(classifySchool("vwap_reversion")).toBe("MEAN_REVERSION");
  });

  it("classifies opening_range_breakout as SESSION_TIME", () => {
    expect(classifySchool("opening_range_breakout")).toBe("SESSION_TIME");
  });

  it("classifies event_driven as EVENT_DRIVEN", () => {
    expect(classifySchool("event_driven")).toBe("EVENT_DRIVEN");
  });

  it("classifies null as UNKNOWN", () => {
    expect(classifySchool(null)).toBe("UNKNOWN");
  });

  it("classifies unknown string as UNKNOWN", () => {
    expect(classifySchool("some_exotic_signal_xyz")).toBe("UNKNOWN");
  });
});

describe("computeLibraryDiversity", () => {
  beforeEach(async () => {
    mockState.rows = [];
    const { db } = await import("../db/index.js");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockImplementation(() => Promise.resolve(mockState.rows)),
    });
  });

  it("returns empty distribution when no strategies exist", async () => {
    const result = await computeLibraryDiversity();
    expect(result.byStage).toEqual({});
    expect(result.total).toEqual({});
    expect(result.ictPct).toBe(0);
  });

  it("accumulates byStage correctly", async () => {
    mockState.rows = [
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "order_block" } },
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "ema_crossover" } },
      { lifecycleState: "PAPER", config: { entry_indicator: "fvg" } },
    ];

    const result = await computeLibraryDiversity();
    expect(result.byStage["DEPLOYED"]?.ICT_HANDCODED).toBe(1);
    expect(result.byStage["DEPLOYED"]?.TREND).toBe(1);
    expect(result.byStage["PAPER"]?.ICT_HANDCODED).toBe(1);
  });

  it("computes total correctly", async () => {
    mockState.rows = [
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "order_block" } },
      { lifecycleState: "PAPER", config: { entry_indicator: "order_block" } },
      { lifecycleState: "TESTING", config: { entry_indicator: "ema_crossover" } },
    ];

    const result = await computeLibraryDiversity();
    expect(result.total.ICT_HANDCODED).toBe(2);
    expect(result.total.TREND).toBe(1);
  });

  it("computes ictPct as share of DEPLOYED strategies", async () => {
    mockState.rows = [
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "order_block" } },
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "fvg" } },
      { lifecycleState: "DEPLOYED", config: { entry_indicator: "ema_crossover" } },
      { lifecycleState: "PAPER", config: { entry_indicator: "order_block" } },
    ];

    const result = await computeLibraryDiversity();
    // 2 ICT of 3 DEPLOYED = 0.667
    expect(result.ictPct).toBeCloseTo(2 / 3, 5);
  });

  it("returns ictPct=0 when no DEPLOYED strategies exist", async () => {
    mockState.rows = [
      { lifecycleState: "PAPER", config: { entry_indicator: "order_block" } },
    ];

    const result = await computeLibraryDiversity();
    expect(result.ictPct).toBe(0);
  });

  it("reads entryIndicator from camelCase config field too", async () => {
    mockState.rows = [
      { lifecycleState: "DEPLOYED", config: { entryIndicator: "vwap_reversion" } },
    ];

    const result = await computeLibraryDiversity();
    expect(result.byStage["DEPLOYED"]?.MEAN_REVERSION).toBe(1);
  });

  it("returns empty distribution and ictPct=0 on DB error", async () => {
    const { db } = await import("../db/index.js");
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockRejectedValue(new Error("DB connection refused")),
    });

    const result = await computeLibraryDiversity();
    expect(result.byStage).toEqual({});
    expect(result.total).toEqual({});
    expect(result.ictPct).toBe(0);
  });

  it("handles null config gracefully", async () => {
    mockState.rows = [
      { lifecycleState: "CANDIDATE", config: null as unknown as Record<string, unknown> },
    ];

    const result = await computeLibraryDiversity();
    expect(result.byStage["CANDIDATE"]?.UNKNOWN).toBe(1);
  });
});
