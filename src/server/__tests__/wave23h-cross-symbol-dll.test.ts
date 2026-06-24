/**
 * wave23h-cross-symbol-dll.test.ts — W23H.F
 *
 * Tests for the cross-symbol DLL coordinator and pre-market blackout gate.
 *
 * Coverage:
 *  1. MES -$300 + MNQ -$400 = -$700 ≈ 70% of $1000 DLL → halt audit + block
 *  2. MES -$500 + MNQ -$500 = -$1000 = 100% → force-close audit + block
 *  3. Combined positive P&L → no halt (only drawdown counts)
 *  4. Cross-account isolation: account A halted does not affect account B
 *  5. Blackout: bar.ts in blackout_window → signal.skipped_pre_market_blackout + block
 *  6. Blackout: bar.ts outside blackout_window → no block
 *  7. No pre_market_sessions row → fail-open (no block)
 *  8. DLL query error → fail-open (no block)
 *
 * Pure simulation harnesses — no DB, no Express.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCrossSymbolDll,
  DEFAULT_PERSONAL_DLL_DOLLARS,
  DLL_HALT_PCT,
  DLL_FORCE_CLOSE_PCT,
  type AccountSessionPnL,
} from "../services/cross-symbol-pnl.js";

// ─── Blackout window gate simulation ─────────────────────────────────────────
interface BlackoutWindow {
  event_type: string;
  start_utc: string;
  end_utc: string;
  severity: string;
}

interface BlackoutGateResult {
  blocked: boolean;
  matchedWindow: BlackoutWindow | null;
  signalType: string | null;
}

/**
 * Simulates W23H.F Stage 0.5a: pre-market blackout gate logic
 * from paper-signal-service.ts.
 * [start_utc, end_utc) boundary semantics.
 */
function simulateBlackoutGate(
  barTimestampMs: number,
  blackoutWindows: BlackoutWindow[] | null | undefined,
  queryError: boolean = false,
): BlackoutGateResult {
  if (queryError) {
    // Fail-open on error
    return { blocked: false, matchedWindow: null, signalType: null };
  }

  if (!blackoutWindows || !Array.isArray(blackoutWindows) || blackoutWindows.length === 0) {
    return { blocked: false, matchedWindow: null, signalType: null };
  }

  const matched = blackoutWindows.find(
    (w) => w.start_utc && w.end_utc &&
      barTimestampMs >= new Date(w.start_utc).getTime() &&
      barTimestampMs < new Date(w.end_utc).getTime(),
  );

  if (matched) {
    return {
      blocked: true,
      matchedWindow: matched,
      signalType: "skipped_pre_market_blackout",
    };
  }

  return { blocked: false, matchedWindow: null, signalType: null };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.F — cross-symbol DLL coordinator", () => {

  it("1. MES -$300 + MNQ -$400 = -$700 ≈ 70% of $1000 DLL → halt action", () => {
    const pnl: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: -700,
      openPnLMtm: 0,
      totalPnL: -700,
      pnLBySymbol: { MES: -300, MNQ: -400 },
    };

    const result = evaluateCrossSymbolDll(pnl, 1000);

    expect(result.action).toBe("halt");
    // 700 / 1000 = 70% > 67% HALT threshold
    expect(result.dllPct).toBeCloseTo(0.70, 2);
    expect(result.combinedPnL).toBe(-700);
    expect(result.pnLBySymbol.MES).toBe(-300);
    expect(result.pnLBySymbol.MNQ).toBe(-400);
  });

  it("2. MES -$500 + MNQ -$500 = -$1000 = 100% → force_close action", () => {
    const pnl: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: -1000,
      openPnLMtm: 0,
      totalPnL: -1000,
      pnLBySymbol: { MES: -500, MNQ: -500 },
    };

    const result = evaluateCrossSymbolDll(pnl, 1000);

    expect(result.action).toBe("force_close");
    expect(result.dllPct).toBeCloseTo(1.00, 2);
  });

  it("3. Combined positive P&L → action=none (only drawdown triggers halt)", () => {
    const pnl: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: 500,
      openPnLMtm: 200,
      totalPnL: 700,  // positive — no drawdown
      pnLBySymbol: { MES: 300, MNQ: 400 },
    };

    const result = evaluateCrossSymbolDll(pnl, 1000);
    expect(result.action).toBe("none");
    expect(result.dllPct).toBe(0);  // no drawdown
  });

  it("4. Cross-firmId isolation: firmId=topstep result is independent of firmId=mffu", () => {
    // If account A (mffu) is at 70% DLL, account B (topstep) at 0% is unaffected
    const pnlA: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: -700,
      openPnLMtm: 0,
      totalPnL: -700,
      pnLBySymbol: { MES: -700 },
    };

    const pnlB: AccountSessionPnL = {
      firmId: "topstep",
      sessionDate: "2026-05-20",
      realizedPnL: 0,
      openPnLMtm: 0,
      totalPnL: 0,
      pnLBySymbol: {},
    };

    const resultA = evaluateCrossSymbolDll(pnlA, 1000);
    const resultB = evaluateCrossSymbolDll(pnlB, 1000);

    expect(resultA.action).toBe("halt");
    expect(resultB.action).toBe("none");
  });

  it("5. DLL exactly at halt threshold → halt (boundary: >= halt)", () => {
    const dllDollars = 1000;
    const haltAmount = dllDollars * DLL_HALT_PCT;  // $670

    const pnl: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: -haltAmount,
      openPnLMtm: 0,
      totalPnL: -haltAmount,
      pnLBySymbol: { MES: -haltAmount },
    };

    const result = evaluateCrossSymbolDll(pnl, dllDollars);
    expect(result.action).toBe("halt");
  });

  it("6. DLL below halt threshold → action=none", () => {
    const pnl: AccountSessionPnL = {
      firmId: "mffu",
      sessionDate: "2026-05-20",
      realizedPnL: -500,
      openPnLMtm: 0,
      totalPnL: -500,  // 50% of $1000 → below 60% reduce + below 67% halt
      pnLBySymbol: { MES: -500 },
    };

    const result = evaluateCrossSymbolDll(pnl, 1000);
    expect(result.action).toBe("none");
  });

  // ── 60%-DLL reduce-size band (soft throttle below the 67% halt) ──
  it("7. DLL at 63% (between 60% and 67%) → reduce_size, NOT halt", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep", sessionDate: "2026-06-23",
      realizedPnL: -630, openPnLMtm: 0, totalPnL: -630,  // 63% of $1000
      pnLBySymbol: { MES: -630 },
    };
    const result = evaluateCrossSymbolDll(pnl, 1000);
    expect(result.action).toBe("reduce_size");
    expect(result.reduceSizeFactor).toBe(0.50);      // default half
    expect(result.reduceThreshold).toBeCloseTo(600, 2);  // 60% × $1000
    expect(result.dllPct).toBeCloseTo(0.63, 2);
  });

  it("8. DLL exactly at 60% reduce threshold → reduce_size (boundary: >= reduce)", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep", sessionDate: "2026-06-23",
      realizedPnL: -600, openPnLMtm: 0, totalPnL: -600,  // exactly 60%
      pnLBySymbol: { MES: -600 },
    };
    expect(evaluateCrossSymbolDll(pnl, 1000).action).toBe("reduce_size");
  });

  it("9. DLL at 59% (just below reduce band) → none", () => {
    const pnl: AccountSessionPnL = {
      firmId: "topstep", sessionDate: "2026-06-23",
      realizedPnL: -590, openPnLMtm: 0, totalPnL: -590,  // 59% < 60%
      pnLBySymbol: { MES: -590 },
    };
    expect(evaluateCrossSymbolDll(pnl, 1000).action).toBe("none");
  });

  it("10. Escalation ladder ordering: 60%→reduce_size, 67%→halt, 95%→force_close", () => {
    const mk = (loss: number): AccountSessionPnL => ({
      firmId: "topstep", sessionDate: "2026-06-23",
      realizedPnL: -loss, openPnLMtm: 0, totalPnL: -loss, pnLBySymbol: { MES: -loss },
    });
    expect(evaluateCrossSymbolDll(mk(600), 1000).action).toBe("reduce_size");
    expect(evaluateCrossSymbolDll(mk(670), 1000).action).toBe("halt");
    expect(evaluateCrossSymbolDll(mk(950), 1000).action).toBe("force_close");
  });
});

describe("W23H.F — pre-market blackout window gate", () => {

  it("5. bar.ts within blackout_window → blocked + skipped_pre_market_blackout", () => {
    const windows: BlackoutWindow[] = [
      {
        event_type: "FOMC",
        start_utc: "2026-05-20T18:00:00.000Z",
        end_utc: "2026-05-20T18:30:00.000Z",
        severity: "high",
      },
    ];

    // Bar timestamp 18:15 UTC → inside window
    const barTs = new Date("2026-05-20T18:15:00.000Z").getTime();
    const result = simulateBlackoutGate(barTs, windows);

    expect(result.blocked).toBe(true);
    expect(result.signalType).toBe("skipped_pre_market_blackout");
    expect(result.matchedWindow?.event_type).toBe("FOMC");
  });

  it("6. bar.ts outside blackout_window → no block", () => {
    const windows: BlackoutWindow[] = [
      {
        event_type: "CPI",
        start_utc: "2026-05-20T12:30:00.000Z",
        end_utc: "2026-05-20T13:00:00.000Z",
        severity: "high",
      },
    ];

    // Bar timestamp 13:30 UTC → after window end
    const barTs = new Date("2026-05-20T13:30:00.000Z").getTime();
    const result = simulateBlackoutGate(barTs, windows);

    expect(result.blocked).toBe(false);
  });

  it("7. No pre_market_sessions row → fail-open (null/undefined windows → no block)", () => {
    // Simulates pmSession = undefined (no row found)
    const result = simulateBlackoutGate(Date.now(), null);
    expect(result.blocked).toBe(false);
    expect(result.signalType).toBeNull();
  });

  it("8. Pre-market blackout gate query error → fail-open (no block)", () => {
    const result = simulateBlackoutGate(
      Date.now(),
      [{ event_type: "NFP", start_utc: "2026-05-20T12:30:00.000Z", end_utc: "2026-05-20T13:00:00.000Z", severity: "high" }],
      true,   // queryError = true
    );
    expect(result.blocked).toBe(false);
  });

  it("[start, end) boundary: bar at exact start_utc → blocked (left-inclusive)", () => {
    const windows: BlackoutWindow[] = [
      {
        event_type: "FOMC",
        start_utc: "2026-05-20T18:00:00.000Z",
        end_utc: "2026-05-20T18:30:00.000Z",
        severity: "high",
      },
    ];

    // Bar at exact start → blocked
    const barAtStart = new Date("2026-05-20T18:00:00.000Z").getTime();
    expect(simulateBlackoutGate(barAtStart, windows).blocked).toBe(true);

    // Bar at exact end → NOT blocked (right-exclusive)
    const barAtEnd = new Date("2026-05-20T18:30:00.000Z").getTime();
    expect(simulateBlackoutGate(barAtEnd, windows).blocked).toBe(false);
  });

  it("empty blackout_windows array → no block", () => {
    const result = simulateBlackoutGate(Date.now(), []);
    expect(result.blocked).toBe(false);
  });
});
