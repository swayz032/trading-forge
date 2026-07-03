/**
 * deepscan7-c3-dll-session-status.test.ts — Deep-scan #7 Track C (2026-07-02)
 *
 * C3 (MED paper-MED-1): getAccountSessionCumulativePnL filtered
 * `paper_sessions.status = 'active'`, so a session stopped/paused mid-day AFTER
 * taking losses was EXCLUDED from the firm-level DLL aggregate — a sibling
 * session on the same firmId under-counted firm losses and could keep opening
 * entries past the real 60/67/95% bands.
 *
 * Fix: status IN ('active','stopped','paused') on BOTH the realized-P&L
 * (dailyPnlBreakdown) query and the open-MTM positions join. Day-scoping is
 * unchanged — the per-session dailyPnlBreakdown[sessionDate] read means a
 * stopped session with only prior-day losses still contributes 0.
 *
 * Behavioral tests with a mocked db + real drizzle-orm (inArray spied) + the
 * real schema, following the lazy-import mock pattern of the service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  positions: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        // Realized-P&L sessions query: .select().from(paperSessions).where(...)
        where: vi.fn(() => Promise.resolve(state.sessions)),
        // Open-MTM query: .select().from(paperPositions).innerJoin(...).where(...)
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(state.positions)),
        })),
      })),
    })),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Spy inArray while keeping real drizzle-orm behavior (real eq/and/isNull/sql
// operate on the real schema columns imported below).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, inArray: vi.fn(actual.inArray) };
});

import {
  getAccountSessionCumulativePnL,
  DLL_AGGREGATE_SESSION_STATUSES,
} from "../services/cross-symbol-pnl.js";
import { inArray } from "drizzle-orm";
import { paperSessions } from "../db/schema.js";
import { db } from "../db/index.js";

const TODAY = "2026-07-01";
const YESTERDAY = "2026-06-30";

describe("C3 — firm DLL aggregate includes stopped/paused sessions with today's P&L", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.sessions = [];
    state.positions = [];
  });

  it("exports the canonical status set: active + stopped + paused", () => {
    expect([...DLL_AGGREGATE_SESSION_STATUSES]).toEqual(["active", "stopped", "paused"]);
  });

  it("session-status filter uses inArray(paperSessions.status, [active, stopped, paused]) on BOTH queries", async () => {
    state.sessions = [];
    state.positions = [];
    await getAccountSessionCumulativePnL("topstep", TODAY);

    const inArrayCalls = vi.mocked(inArray).mock.calls;
    // One call for the realized-P&L sessions query + one for the open-MTM join
    expect(inArrayCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of inArrayCalls) {
      expect(call[0]).toBe(paperSessions.status);
      expect(call[1]).toEqual([...DLL_AGGREGATE_SESSION_STATUSES]);
    }
  });

  it("a stopped session's TODAY losses are included in the firm aggregate", async () => {
    // Row is returned by the (mocked) SQL layer because the status filter now
    // admits stopped sessions — the inArray assertion above proves the filter;
    // this proves the aggregation counts its today-key losses.
    state.sessions = [
      { id: "s-stopped", symbol: "MES", dailyPnlBreakdown: { [TODAY]: -300 } },
      { id: "s-active", symbol: "MNQ", dailyPnlBreakdown: { [TODAY]: -100 } },
    ];
    state.positions = [];

    const result = await getAccountSessionCumulativePnL("topstep", TODAY);

    expect(result.realizedPnL).toBe(-400);
    expect(result.totalPnL).toBe(-400);
    expect(result.pnLBySymbol.MES).toBe(-300);
    expect(result.pnLBySymbol.MNQ).toBe(-100);
  });

  it("a stopped session with ONLY yesterday's losses contributes 0 (day-key scoping preserved)", async () => {
    state.sessions = [
      { id: "s-stopped-old", symbol: "MES", dailyPnlBreakdown: { [YESTERDAY]: -500 } },
    ];
    state.positions = [];

    const result = await getAccountSessionCumulativePnL("topstep", TODAY);

    expect(result.realizedPnL).toBe(0);
    expect(result.totalPnL).toBe(0);
    // Symbol bucket exists but carries 0 — not yesterday's -500
    expect(result.pnLBySymbol.MES ?? 0).toBe(0);
  });

  it("open MTM on a paused session's positions counts toward the firm aggregate", async () => {
    state.sessions = [];
    state.positions = [{ symbol: "MNQ", unrealizedPnl: "-150" }];

    const result = await getAccountSessionCumulativePnL("topstep", TODAY);

    expect(result.openPnLMtm).toBe(-150);
    expect(result.totalPnL).toBe(-150);
    expect(result.pnLBySymbol.MNQ).toBe(-150);
  });

  it("fail-open contract preserved: DB error returns the zero-valued result", async () => {
    vi.mocked(db.select).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const result = await getAccountSessionCumulativePnL("topstep", TODAY);

    expect(result.totalPnL).toBe(0);
    expect(result.realizedPnL).toBe(0);
    expect(result.openPnLMtm).toBe(0);
    expect(result.pnLBySymbol).toEqual({});
  });
});
