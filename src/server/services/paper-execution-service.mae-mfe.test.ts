/**
 * Phase 1.5 — MAE/MFE Watermark Tracking: updatePositionPrices() tests.
 *
 * Verifies that MAE (Maximum Adverse Excursion) and MFE (Maximum Favorable
 * Excursion) are correctly computed and persisted to paper_positions on each
 * bar update.
 *
 * Design:
 *   - DB is mocked at the module boundary.
 *   - A capture list records every db.update().set() call so we can assert
 *     the computed mae/mfe values.
 *   - Position rows are built inline per test.
 *
 * MAE/MFE semantics:
 *   - Long positions:
 *       adverse price  = bar.low  (price moved against the long)
 *       favorable price = bar.high (price moved in favor of the long)
 *   - Short positions:
 *       adverse price  = bar.high (price moved against the short)
 *       favorable price = bar.low  (price moved in favor of the short)
 *
 *   MAE = min(current_mae, adverse_unrealizedPnl)   — always <= 0 after any adverse move
 *   MFE = max(current_mfe, favorable_unrealizedPnl) — always >= 0 after any favorable move
 *
 * Parity assumption:
 *   The backtester computes MAE/MFE per bar using OHLCV data.  The paper engine
 *   must use bar.high/bar.low (not just close) so that intrabar excursions are
 *   captured, matching the backtest calculation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Captured DB update set() calls ──────────────────────────────────────────
interface UpdateSetCapture {
  setValues: Record<string, unknown>;
  positionId: string;
}
let updateCaptures: UpdateSetCapture[] = [];

// ─── DB mock ──────────────────────────────────────────────────────────────────
vi.mock("../db/index.js", () => {
  return {
    db: {
      select: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
    },
  };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }) },
}));
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("./paper-risk-gate.js", () => ({ toEasternDateString: vi.fn().mockReturnValue("2026-01-15") }));
vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn().mockResolvedValue({ is_economic_event: false }),
}));

// Import after mocks
import { updatePositionPrices } from "./paper-execution-service.js";
import { db } from "../db/index.js";

// MES CONTRACT_SPECS: tickSize = 0.25, pointValue = 5
// For 1 MES contract: 1 point = $5

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-001",
    sessionId: "sess-001",
    symbol: "MES",
    side: "long",
    entryPrice: "5000",
    currentPrice: "5000",
    contracts: 1,
    unrealizedPnl: "0",
    entryTime: new Date("2026-01-15T15:00:00Z"),
    closedAt: null,
    trailHwm: null,
    barsHeld: 0,
    mae: null,
    mfe: null,
    ...overrides,
  };
}

function setupMocks(positions: ReturnType<typeof buildPosition>[]) {
  updateCaptures = [];

  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(positions),
    }),
  });

  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    set: vi.fn().mockImplementation((setValues: Record<string, unknown>) => ({
      where: vi.fn().mockImplementation((_whereClause: unknown) => {
        // Extract position ID from the drizzle eq() call structure
        // We store the setValues keyed by the order they were called
        updateCaptures.push({ setValues, positionId: String(updateCaptures.length) });
        return Promise.resolve(undefined);
      }),
    })),
  }));

  // Session re-read for equity update — return empty to skip equity branch
  // (second db.select call)
  let selectCallCount = 0;
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(positions),
        }),
      };
    }
    // Session select — return null to skip equity update
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  updateCaptures = [];
  vi.clearAllMocks();
});

describe("updatePositionPrices() — Phase 1.5 MAE/MFE watermark tracking", () => {

  it("initialises MAE and MFE from zero on first bar (no prior watermark)", async () => {
    const pos = buildPosition({ mae: null, mfe: null });
    setupMocks([pos]);

    // Bar: entry = 5000, high = 5010, low = 4998, close = 5005
    // Long: adverse = low 4998 → pnl = (4998 - 5000) * 5 * 1 = -10
    //        favorable = high 5010 → pnl = (5010 - 5000) * 5 * 1 = 50
    await updatePositionPrices("sess-001", {
      MES: { close: 5005, high: 5010, low: 4998 },
    });

    expect(updateCaptures.length).toBeGreaterThan(0);
    const setVals = updateCaptures[0].setValues;
    expect(Number(setVals.mae)).toBeCloseTo(-10, 4);
    expect(Number(setVals.mfe)).toBeCloseTo(50, 4);
  });

  it("MAE advances when a worse adverse excursion occurs", async () => {
    // Previous watermark: mae = -10 (price touched low of 4998 before)
    const pos = buildPosition({ mae: "-10", mfe: "50" });
    setupMocks([pos]);

    // New bar: entry = 5000, low = 4995 → adverse pnl = (4995 - 5000) * 5 = -25
    // Expected new mae = min(-10, -25) = -25
    await updatePositionPrices("sess-001", {
      MES: { close: 5002, high: 5010, low: 4995 },
    });

    const setVals = updateCaptures[0].setValues;
    expect(Number(setVals.mae)).toBeCloseTo(-25, 4);
    expect(Number(setVals.mfe)).toBeCloseTo(50, 4); // MFE unchanged — high 5010 same as before
  });

  it("MAE does not regress when price stays above prior adverse low", async () => {
    // Previous watermark: mae = -25 (price touched low of 4995 before)
    const pos = buildPosition({ mae: "-25", mfe: "50" });
    setupMocks([pos]);

    // New bar: low = 4998 → adverse pnl = (4998 - 5000) * 5 = -10  (less adverse than -25)
    // Expected new mae = min(-25, -10) = -25  (prior watermark preserved)
    await updatePositionPrices("sess-001", {
      MES: { close: 5002, high: 5008, low: 4998 },
    });

    const setVals = updateCaptures[0].setValues;
    expect(Number(setVals.mae)).toBeCloseTo(-25, 4); // preserved
    expect(Number(setVals.mfe)).toBeCloseTo(50, 4);  // unchanged
  });

  it("MFE advances when a better favorable excursion occurs", async () => {
    // Previous watermark: mfe = 50 (high of 5010 seen before)
    const pos = buildPosition({ mae: "-10", mfe: "50" });
    setupMocks([pos]);

    // New bar: high = 5025 → favorable pnl = (5025 - 5000) * 5 = 125
    // Expected new mfe = max(50, 125) = 125
    await updatePositionPrices("sess-001", {
      MES: { close: 5020, high: 5025, low: 4999 },
    });

    const setVals = updateCaptures[0].setValues;
    expect(Number(setVals.mfe)).toBeCloseTo(125, 4);
    expect(Number(setVals.mae)).toBeCloseTo(-10, 4); // MAE unchanged
  });

  it("short position: adverse is bar.high above entry, favorable is bar.low below entry", async () => {
    const pos = buildPosition({ side: "short", entryPrice: "5000", mae: null, mfe: null });
    setupMocks([pos]);

    // Bar: high = 5008 (adverse for short), low = 4990 (favorable for short)
    // Short direction = -1:
    //   adverse pnl   = -1 * (high - entry) * 5 * 1 = -1 * (5008 - 5000) * 5 = -40
    //   favorable pnl = -1 * (low  - entry) * 5 * 1 = -1 * (4990 - 5000) * 5 = 50
    await updatePositionPrices("sess-001", {
      MES: { close: 4995, high: 5008, low: 4990 },
    });

    const setVals = updateCaptures[0].setValues;
    expect(Number(setVals.mae)).toBeCloseTo(-40, 4);
    expect(Number(setVals.mfe)).toBeCloseTo(50, 4);
  });

  it("falls back to close price for high/low when only scalar close is provided", async () => {
    const pos = buildPosition({ mae: null, mfe: null });
    setupMocks([pos]);

    // Legacy scalar close-only call
    // high = low = close = 5005 → adverse pnl = (5005-5000)*5=25, favorable pnl = 25
    // Since both collapse to close: mae=0 (no adverse from close), mfe=25
    // Actually: barLow = barHigh = 5005 (fallback in code)
    // adverse = (5005 - 5000) * 5 = 25 (not adverse for a long! close > entry)
    // favorable = same 25
    // mae = min(0, 25) = 0  (no adverse move)
    // mfe = max(0, 25) = 25
    await updatePositionPrices("sess-001", { MES: 5005 });

    const setVals = updateCaptures[0].setValues;
    // With only close, high=low=close=5005 for a long at 5000: no adverse move
    expect(Number(setVals.mae)).toBeCloseTo(0, 4);  // min(0, 25) = 0 — no adverse
    expect(Number(setVals.mfe)).toBeCloseTo(25, 4); // max(0, 25) = 25
  });

  it("does not update position if symbol not in prices map", async () => {
    const pos = buildPosition({ symbol: "MNQ" });
    setupMocks([pos]);

    await updatePositionPrices("sess-001", { MES: { close: 5005, high: 5010, low: 4998 } });

    // No update should be written for MNQ since price map only has MES
    expect(updateCaptures.length).toBe(0);
  });

});
