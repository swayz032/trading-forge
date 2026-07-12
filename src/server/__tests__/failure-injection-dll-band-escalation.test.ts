/**
 * failure-injection-dll-band-escalation.test.ts
 *
 * FAILURE-INJECTION coverage for incident class #3 of the autonomous-readiness
 * fault-injection campaign (2026-07-12): the 4-band DLL escalation ladder
 * documented in CLAUDE.md §4 —
 *
 *   REDUCE new-entry size x0.50 at 60%  (env: DLL_REDUCE_SIZE_PCT)
 *   HALT new entries               at 67%  (env: DLL_HALT_PCT)
 *   FORCE-CLOSE all positions      at 95%  (env: DLL_FORCE_CLOSE_PCT)
 *   Ordering: force_close > halt > reduce_size > none
 *
 * This file injects equity/loss readings AT and AROUND each band boundary
 * directly into the REAL production decision function
 * `evaluateCrossSymbolDll()` (src/server/services/cross-symbol-pnl.ts) — no
 * mocking of the decision itself, only the account-P&L INPUT is constructed
 * per case. This is the actual function every DLL-consuming call site shares
 * (kill-switch.ts Layer 2 AND the paper-signal-service.ts sizing site), so a
 * bug found here is a bug in every consumer simultaneously.
 *
 * Scope note (documented, not fabricated): the REDUCE band's *application*
 * (halving the next entry's contract count) happens at the sizing call site
 * inside paper-signal-service.ts, a multi-thousand-line file this campaign
 * did not attempt to harness end-to-end (see the accompanying report's
 * COULDNT-TEST entry). What IS verified here, with full rigor, is the DECISION
 * every consumer of that sizing site reads: `evaluateCrossSymbolDll(...).action`
 * and `.reduceSizeFactor`. If this decision function is wrong, every consumer
 * is wrong — this is the highest-leverage point to failure-inject.
 *
 * DO NOT EDIT SOURCE FROM THIS FILE.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCrossSymbolDll,
  DLL_REDUCE_SIZE_PCT,
  DLL_HALT_PCT,
  DLL_FORCE_CLOSE_PCT,
  DLL_REDUCE_SIZE_FACTOR,
  type AccountSessionPnL,
} from "../services/cross-symbol-pnl.js";

const PERSONAL_DLL_DOLLARS = 2_000; // Topstep 50K combine default, matches kill-switch.ts constant

function pnlOf(totalPnL: number): AccountSessionPnL {
  return {
    firmId: "test-account",
    sessionDate: "2026-07-12",
    realizedPnL: totalPnL,
    openPnLMtm: 0,
    totalPnL,
    pnLBySymbol: { MES: totalPnL },
  };
}

describe("FAILURE-INJECTION: DLL 4-band escalation ladder (incident class #3)", () => {
  it("documents the real threshold percentages this suite injects against (guards against env drift silently changing band math)", () => {
    expect(DLL_REDUCE_SIZE_PCT).toBe(0.60);
    expect(DLL_HALT_PCT).toBe(0.67);
    expect(DLL_FORCE_CLOSE_PCT).toBe(0.95);
  });

  it("INJECTED: equity loss just BELOW the 60% band -> action='none' (no escalation)", () => {
    // 60% of $2,000 = $1,200. Inject $1,199 loss — just under.
    const result = evaluateCrossSymbolDll(pnlOf(-1199), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("none");
  });

  it("INJECTED: equity loss AT the 60% reduce-size band -> action='reduce_size', factor=0.50", () => {
    // 60% of $2,000 = $1,200 exactly.
    const result = evaluateCrossSymbolDll(pnlOf(-1200), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("reduce_size");
    expect(result.reduceSizeFactor).toBe(DLL_REDUCE_SIZE_FACTOR);
    expect(result.reduceSizeFactor).toBe(0.5);
  });

  it("INJECTED: equity loss just BELOW the 67% halt band (still in reduce_size) -> action='reduce_size'", () => {
    // 67% of $2,000 = $1,340. Inject $1,339 — still reduce_size, not yet halt.
    const result = evaluateCrossSymbolDll(pnlOf(-1339), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("reduce_size");
  });

  it("INJECTED: equity loss AT the 67% halt band -> action='halt'", () => {
    // 67% of $2,000 = $1,340 exactly.
    const result = evaluateCrossSymbolDll(pnlOf(-1340), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("halt");
  });

  it("INJECTED: equity loss just BELOW the 95% force-close band (still halt) -> action='halt'", () => {
    // 95% of $2,000 = $1,900. Inject $1,899 — still halt, not yet force-close.
    const result = evaluateCrossSymbolDll(pnlOf(-1899), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("halt");
  });

  it("INJECTED: equity loss AT the 95% force-close band -> action='force_close'", () => {
    // 95% of $2,000 = $1,900 exactly.
    const result = evaluateCrossSymbolDll(pnlOf(-1900), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("force_close");
  });

  it("INJECTED: catastrophic loss WELL PAST 95% -> still force_close (no fifth 'beyond' band, ladder saturates correctly)", () => {
    const result = evaluateCrossSymbolDll(pnlOf(-5000), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("force_close");
  });

  it("INJECTED: a POSITIVE P&L (winning day) never triggers any band regardless of magnitude", () => {
    const result = evaluateCrossSymbolDll(pnlOf(10000), PERSONAL_DLL_DOLLARS);
    expect(result.action).toBe("none");
    expect(result.dllPct).toBe(0);
  });

  it("ORDERING INVARIANT: sweeping the full loss range from $0 to $5,000 in $1 steps never returns a band OUT of the documented priority order (force_close > halt > reduce_size > none)", () => {
    const priority: Record<string, number> = { none: 0, reduce_size: 1, halt: 2, force_close: 3 };
    let lastPriority = -1;
    let sawEveryBand = new Set<string>();
    for (let loss = 0; loss <= 5000; loss += 1) {
      const result = evaluateCrossSymbolDll(pnlOf(-loss), PERSONAL_DLL_DOLLARS);
      sawEveryBand.add(result.action);
      const currentPriority = priority[result.action];
      // As loss strictly increases, the escalation band must be monotonically
      // non-decreasing in severity — a genuine capital-safety regression would
      // show up as a "de-escalation" (e.g. force_close then dropping back to
      // halt on a slightly bigger loss), which this sweep would catch.
      expect(currentPriority).toBeGreaterThanOrEqual(lastPriority);
      lastPriority = currentPriority;
    }
    // Confirm the sweep actually exercised all 4 bands (a vacuous monotonic
    // check over a sweep that never left "none" would be a false pass).
    expect(sawEveryBand).toEqual(new Set(["none", "reduce_size", "halt", "force_close"]));
  });

  it("INJECTED: a DEGRADED P&L reading (DB fault mid-read) propagates degraded=true so fail-CLOSED callers (kill-switch L2) can honor their contract", () => {
    const degradedPnl: AccountSessionPnL = {
      firmId: "test-account",
      sessionDate: "2026-07-12",
      realizedPnL: -1950,
      openPnLMtm: 0,
      totalPnL: -1950,
      pnLBySymbol: { MES: -1950 },
      degraded: true,
    };
    const result = evaluateCrossSymbolDll(degradedPnl, PERSONAL_DLL_DOLLARS);
    // The realized-alone loss ($1,950) already breaches 95% — the KNOWN breach
    // must still force-close per the deep-scan 2026-07-12 #10 fix (kill-switch.ts
    // L2 "fall through to force-close the bleeding position" branch), and the
    // degraded flag must still propagate so the caller knows the reading was
    // built on a partial fault (not a fully-trustworthy figure).
    expect(result.action).toBe("force_close");
    expect(result.degraded).toBe(true);
  });
});
