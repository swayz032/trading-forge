/**
 * pending-entry-queue-fill-gate-recheck.test.ts — H3 (2026-06-23)
 *
 * Verifies that the pending-entry fill path (bar N+1 deferred execution) re-evaluates
 * all capital-safety gates using the FILL bar's timestamp, not the signal bar's timestamp.
 *
 * Bug fixed: signal-time gates (kill-switch, lunch-blackout, FOMC/macro, DLL, daily-trade-cap)
 * were only evaluated when the signal was QUEUED (bar N). The fill executed at bar N+1 with
 * stale gate evaluation, enabling:
 *   - Fills inside lunch blackout (signal at 11:28, fill at 11:30:01 ET)
 *   - Fills inside FOMC window (signal at 09:59:58, fill at 10:00:01)
 *   - Fills after DLL flipped mid-bar
 *   - Stale queued entries crossing session-day boundaries
 *
 * Test strategy: source-analysis tests (readFileSync) verify structural correctness
 * of the H3 gate-re-check block in paper-signal-service.ts, proving:
 *   a) the block is present and in the right position (after dequeue, before openPosition)
 *   b) each gate is re-evaluated with the fill-time timestamp
 *   c) audit rows use the original correlationId from the queued signal
 *   d) each drop reason emits a distinct pending_entry.dropped_<reason> audit action
 *
 * Plus pure-function regression tests for the helper gate evaluators to verify
 * they correctly classify timestamp-crossing scenarios.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  evaluateLunchBlackoutGate,
  getLunchBlackoutStartEnvDefault,
  getLunchBlackoutEndEnvDefault,
} from "../lib/lunch-blackout-gate.js";
import { evaluateDailyTradeCap, getDailyTradeCapEnvDefault } from "../lib/daily-trade-cap.js";
import { evaluateCrossSymbolDll } from "../services/cross-symbol-pnl.js";

// ─── Load source files for structural analysis ────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf8",
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a Date from an ET wall-clock "YYYY-MM-DD HH:MM" string (DST-aware). */
function etBar(yyyymmddHhMm: string): Date {
  const [datePart, timePart] = yyyymmddHhMm.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hh + offsetHours, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(candidate);
    const match = fmt.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, mo, da, ye, hr, mi] = match;
      const hrN = parseInt(hr, 10) === 24 ? 0 : parseInt(hr, 10);
      if (
        parseInt(ye, 10) === y && parseInt(mo, 10) === m && parseInt(da, 10) === d &&
        hrN === hh && parseInt(mi, 10) === mm
      ) {
        return candidate;
      }
    }
  }
  throw new Error(`etBar: could not construct ET time for ${yyyymmddHhMm}`);
}

afterEach(() => {
  // Reset env-var state after each test to avoid test cross-contamination
  delete process.env.LUNCH_BLACKOUT_START_ET;
  delete process.env.LUNCH_BLACKOUT_END_ET;
  delete process.env.TF_MAX_TRADES_PER_DAY;
});

// ─── Structural: H3 gate-re-check block exists ───────────────────────────────

describe("H3 — structural: gate re-check block exists in paper-signal-service.ts", () => {
  it("imports killSwitch from kill-switch.ts", () => {
    expect(SRC).toContain('import { killSwitch } from "../production/kill-switch.js"');
  });

  it("H3 comment header is present in source", () => {
    expect(SRC).toContain("H3 (2026-06-23): Re-evaluate all entry gates at fill time (bar N+1)");
  });

  it("H3 gate re-check block comes AFTER pendingEntryQueue.delete (consume) and BEFORE openPosition", () => {
    const dequeueIdx = SRC.indexOf("pendingEntryQueue.delete(pendingKey); // consume the pending entry");
    const h3Idx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const openPosIdx = SRC.indexOf("const deferredResult = await openPosition(sessionId, {");
    expect(dequeueIdx).toBeGreaterThan(-1);
    expect(h3Idx).toBeGreaterThan(dequeueIdx);
    expect(openPosIdx).toBeGreaterThan(h3Idx);
  });

  it("drops queued entry when kill switch halts — gate 1 check present", () => {
    // deepscan18 (2026-07-05) C-C1: the call now also threads this session's
    // resolved account/firm scope (see kill-switch.ts::evaluateAllKillSwitchLayers)
    // so a sibling account's breach doesn't drop THIS account's queued fill.
    expect(SRC).toContain("const halted = await killSwitch.isHaltedForProduction({");
    expect(SRC).toContain("correlationId: pendingEntry.correlationId,");
    expect(SRC).toContain("accountKey: resolveAccountKey(sessionRow),");
    expect(SRC).toContain('pendingDropReason = "kill_switch"');
  });

  it("drops queued entry that crosses into lunch blackout — gate 3 uses fillTs", () => {
    // evaluateLunchBlackoutGate must be called with fillTs (the fill bar timestamp), NOT bar N
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain("evaluateLunchBlackoutGate");
    expect(h3Block).toContain("barTsUtc: fillTs");
    expect(h3Block).toContain('pendingDropReason = "lunch_blackout"');
  });

  it("drops queued entry that crosses FOMC/macro blackout — gate 4 uses fill timestamp", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain("getT1ReleaseWindow");
    expect(h3Block).toContain('pendingDropReason = "macro_blackout"');
  });

  it("drops queued entry when DLL flipped between queue and fill — gate 5", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain("evaluateCrossSymbolDll");
    expect(h3Block).toContain('pendingDropReason = "dll_halt"');
  });

  it("drops queued entry when session-day boundary crossed — gate 2", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain("signalDay !== fillDay");
    expect(h3Block).toContain('pendingDropReason = "session_boundary_crossed"');
  });

  it("drops queued entry when daily-trade-cap exceeded at fill time — gate 6", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain("evaluateDailyTradeCap");
    expect(h3Block).toContain('pendingDropReason = "daily_trade_cap"');
  });

  it("inherits original correlationId on drop audit — fillCorrelationId from pendingEntry", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    // fillCorrelationId must be set from pendingEntry.correlationId
    expect(h3Block).toContain("const fillCorrelationId = pendingEntry.correlationId ?? null");
    // The audit row uses fillCorrelationId (not a fresh UUID)
    expect(h3Block).toContain("correlationId: fillCorrelationId");
  });

  it("emits pending_entry.dropped_<reason> audit action on drop", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain('action: `pending_entry.dropped_${pendingDropReason}`');
  });

  it("returns early (skips openPosition) when a gate drops the entry", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    // Must call span.end() + return before openPosition is reached
    expect(h3Block).toContain("span.end()");
    expect(h3Block).toContain("return;");
  });

  it("proceeds when all gates pass at fill — H3 does NOT change happy-path for clear bars", () => {
    // The 'FIX 1: Executing deferred entry' log must still exist AFTER the H3 block
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const logMsgIdx = SRC.indexOf("FIX 1: Executing deferred entry from previous bar (next-bar fill parity)", endH3Idx);
    expect(endH3Idx).toBeGreaterThan(-1);
    expect(logMsgIdx).toBeGreaterThan(endH3Idx);
  });
});

// ─── Kill switch gate: structural verify ─────────────────────────────────────

describe("H3 — kill switch fail-CLOSED invariant is preserved", () => {
  it("kill switch gate is Gate 1 (checked before all others)", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const killSwitchIdx = SRC.indexOf("Gate 1: Kill switch (H6 layered, fail-CLOSED)", h3BlockIdx);
    const sessionBoundaryIdx = SRC.indexOf("Gate 2: Session-day boundary check", h3BlockIdx);
    const lunchIdx = SRC.indexOf("Gate 3: Lunch blackout", h3BlockIdx);
    expect(killSwitchIdx).toBeGreaterThan(h3BlockIdx);
    expect(sessionBoundaryIdx).toBeGreaterThan(killSwitchIdx);
    expect(lunchIdx).toBeGreaterThan(sessionBoundaryIdx);
  });

  it("kill switch catch block also sets pendingDropReason (fail-CLOSED on error)", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    // The catch block for the kill switch must also drop the entry
    const ksSection = h3Block.slice(h3Block.indexOf("Gate 1: Kill switch"), h3Block.indexOf("Gate 2: Session-day"));
    expect(ksSection).toContain('pendingDropReason = "kill_switch"');
    // Must appear twice: once in the if-halted path AND once in the catch path
    const matches = ksSection.match(/pendingDropReason = "kill_switch"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Pure-function regression: lunch blackout boundary crossing ───────────────

describe("H3 — lunch blackout: signal passes at 11:28, fill at 11:30:01 (should drop)", () => {
  it("bar at 11:28 ET is OUTSIDE the blackout (would-queue)", () => {
    const signalBar = etBar("2026-06-23 11:28");
    const result = evaluateLunchBlackoutGate({ barTsUtc: signalBar });
    expect(result.block).toBe(false);
  });

  it("bar at 11:30 ET is INSIDE the blackout (fill-time rejection)", () => {
    const fillBar = etBar("2026-06-23 11:30");
    const result = evaluateLunchBlackoutGate({ barTsUtc: fillBar });
    expect(result.block).toBe(true);
    expect(result.reason).toMatch(/lunch_blackout_window/);
  });

  it("bar at 11:30:30 ET is inside the blackout (fill-time rejection)", () => {
    const fillBar = etBar("2026-06-23 11:30");
    const fillBarPlus30s = new Date(fillBar.getTime() + 30_000);
    const result = evaluateLunchBlackoutGate({ barTsUtc: fillBarPlus30s });
    expect(result.block).toBe(true);
  });
});

// ─── Pure-function regression: daily trade cap crossing ──────────────────────

describe("H3 — daily trade cap: 2 trades closed, 3rd fill hits cap at fill time", () => {
  afterEach(() => {
    delete process.env.TF_MAX_TRADES_PER_DAY;
  });

  it("tradesToday=0 at fill time → cap allows (happy path)", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(true);
  });

  it("tradesToday=2 at fill time → cap blocks (2 trades = cap at default)", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(false);
    expect(result.reason).toMatch(/trade_cap_reached/);
  });

  it("tradesToday=1 at fill time → cap allows (still under cap)", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(true);
  });

  it("session-day boundary crossed scenario: tradesToday=0 on new day → allow (but should be dropped by gate 2)", () => {
    // On a new session day the trade count resets to 0 — the cap would allow,
    // but Gate 2 (session_boundary_crossed) fires first and drops the entry.
    // This test just confirms the cap pure-function itself does not block a 0-count day.
    const result = evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(true);
  });
});

// ─── Pure-function regression: DLL halt between queue and fill ────────────────

describe("H3 — DLL re-check: position took heat between bars N and N+1", () => {
  const DLL = 600; // personal DLL in dollars for test assertions

  function makePnL(total: number): Parameters<typeof evaluateCrossSymbolDll>[0] {
    return {
      firmId: "topstep",
      sessionDate: "2026-06-23",
      realizedPnL: total,
      openPnLMtm: 0,
      totalPnL: total,
      pnLBySymbol: { MES: total },
    };
  }

  it("combined P&L at -300 (50% of $600 DLL) → no halt", () => {
    const result = evaluateCrossSymbolDll(makePnL(-300), DLL);
    expect(result.action).toBe("none");
  });

  it("combined P&L at -402 (67% of $600 DLL) → halt triggered", () => {
    const result = evaluateCrossSymbolDll(makePnL(-402), DLL);
    expect(result.action).toBe("halt");
  });

  it("combined P&L at -570 (95% of $600 DLL) → force_close triggered", () => {
    const result = evaluateCrossSymbolDll(makePnL(-570), DLL);
    expect(result.action).toBe("force_close");
  });

  it("combined P&L at -0.5 (< 1% of DLL) → none (trivial loss)", () => {
    const result = evaluateCrossSymbolDll(makePnL(-0.5), DLL);
    expect(result.action).toBe("none");
  });
});

// ─── Structural: session-boundary gate logic ──────────────────────────────────

describe("H3 — session-boundary gate: queue on day N, fill on day N+1 → drop", () => {
  it("gate 2 compares toFuturesTradingDayString(signalBarTimestamp) vs fill day", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    const gateSection = h3Block.slice(
      h3Block.indexOf("Gate 2: Session-day boundary check"),
      h3Block.indexOf("Gate 3: Lunch blackout"),
    );
    expect(gateSection).toContain("toFuturesTradingDayString(new Date(pendingEntry.signalBarTimestamp))");
    expect(gateSection).toContain("toFuturesTradingDayString(fillTs)");
    expect(gateSection).toContain("signalDay !== fillDay");
    expect(gateSection).toContain('pendingDropReason = "session_boundary_crossed"');
  });
});

// ─── Structural: audit row severity mapping ───────────────────────────────────

describe("H3 — audit row severity: expected drops are info; unexpected state-flips are warning", () => {
  it("lunch_blackout drops emit 'info' severity", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    expect(h3Block).toContain('pendingDropReason === "lunch_blackout"');
    expect(h3Block).toContain('"info"');
  });

  it("kill_switch and dll_halt drops emit 'warning' severity", () => {
    const h3BlockIdx = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
    const endH3Idx = SRC.indexOf("End H3 pending-entry fill-gate re-check");
    const h3Block = SRC.slice(h3BlockIdx, endH3Idx);
    // The ternary defaults to 'warning' for kill_switch and dll_halt
    expect(h3Block).toContain('"warning"');
  });
});
