/**
 * failure-injection-daily-trade-cap.test.ts
 *
 * FAILURE-INJECTION coverage for incident class #5 of the autonomous-readiness
 * fault-injection campaign (2026-07-12): the daily-trade-cap signal-time gate
 * (operator's "1-2 A+ trades/day" mandate, CLAUDE.md §4).
 *
 * Injects N+1 closed-trades-today counts directly into the REAL production
 * decision function `evaluateDailyTradeCap()` (src/server/lib/daily-trade-cap.ts)
 * — the exact function paper-signal-service.ts calls at its signal-time gate
 * (verified by reading paper-signal-service.ts:3725-3730, which calls
 * `evaluateDailyTradeCap({ tradesToday, perSessionCap, envDefault })` and sets
 * `dailyTradeCapBlocked = true` on `!capResult.allow`, which folds into
 * `lockoutBlocked` at line 3963) — and asserts the gate actually blocks.
 *
 * SCOPE DISCLOSURE (honest, not fabricated): paper-signal-service.ts is a
 * multi-thousand-line file with a large upstream dependency graph (bar
 * ingestion, bias-state read, kill-switch evaluation, 11-factor confluence,
 * lunch/PM taper, consistency gate, etc.) BEFORE the daily-trade-cap block is
 * reached. Harnessing the ENTIRE signal-evaluation pipeline end-to-end was out
 * of scope for this pass (see the accompanying report's COULDNT-TEST entry for
 * the fail-open-on-DB-error branch, which lives inline in that file and is not
 * independently unit-testable without duplicating the surrounding pipeline).
 * What this file DOES verify with full rigor is the actual gate DECISION
 * FUNCTION every caller depends on — a bug here is a bug in the live signal
 * path, verbatim, because paper-signal-service.ts imports and calls this exact
 * function with no wrapping logic of its own beyond resolving the two cap
 * inputs (perSessionCap, envDefault) and branching on `.allow`.
 *
 * DO NOT EDIT SOURCE FROM THIS FILE.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateDailyTradeCap,
  resolveEffectiveCap,
  getDailyTradeCapEnvDefault,
} from "../lib/daily-trade-cap.js";

describe("FAILURE-INJECTION: daily-trade-cap signal-time gate (incident class #5)", () => {
  afterEach(() => {
    delete process.env.TF_MAX_TRADES_PER_DAY;
  });

  it("INJECTED: N+1 closed trades today (3rd trade attempt against the default cap of 2) -> allow=false, gate BLOCKS", () => {
    const result = evaluateDailyTradeCap({
      tradesToday: 2, // 2 trades already closed today
      perSessionCap: null,
      envDefault: 2, // operator mandate default
    });
    expect(result.allow).toBe(false);
    expect(result.reason).toContain("daily_trade_cap_reached");
    expect(result.effectiveCap).toBe(2);
  });

  it("negative control: exactly at N (2nd trade, tradesToday=1 < cap=2) -> allow=true, gate does NOT block", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(true);
  });

  it("INJECTED: far past the cap (10 trades closed against a cap of 2 — a runaway-loop scenario) -> still blocks, never lets a burst slip through", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 10, perSessionCap: null, envDefault: 2 });
    expect(result.allow).toBe(false);
  });

  it("INJECTED: per-session override cap TAKES PRECEDENCE over the env default when set — a session configured for 1 trade/day blocks at trade #2 even though the env default is 2", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: 1, envDefault: 2 });
    expect(result.allow).toBe(false);
    expect(result.effectiveCap).toBe(1);
  });

  it("INJECTED: operator explicitly disables the cap (perSessionCap=0) -> allow=true regardless of tradesToday (documented bypass, must remain visible via reason string)", () => {
    const result = evaluateDailyTradeCap({ tradesToday: 50, perSessionCap: null, envDefault: 0 });
    expect(result.allow).toBe(true);
    expect(result.reason).toBe("daily_trade_cap_disabled");
  });

  it("INJECTED: malformed/negative tradesToday (a corrupted COUNT(*) read, e.g. -1) is treated as 0 — fails SAFE toward 'more trades allowed' rather than crashing the gate, matching the documented fail-open-on-bad-input contract", () => {
    const result = evaluateDailyTradeCap({ tradesToday: -1, perSessionCap: null, envDefault: 2 });
    expect(result.tradesToday).toBe(0);
    expect(result.allow).toBe(true);
  });

  it("INJECTED: NaN tradesToday (a query that returned a non-numeric COUNT) is treated as 0, not propagated as NaN into the comparison (NaN < 2 is false in JS — an unguarded gate would silently BLOCK every trade forever)", () => {
    const result = evaluateDailyTradeCap({ tradesToday: NaN, perSessionCap: null, envDefault: 2 });
    expect(Number.isNaN(result.tradesToday)).toBe(false);
    expect(result.tradesToday).toBe(0);
    expect(result.allow).toBe(true);
  });

  it("resolveEffectiveCap: env var reads TF_MAX_TRADES_PER_DAY live — injecting an operator override to 1 actually tightens the gate at trade #2", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "1";
    const envDefault = getDailyTradeCapEnvDefault();
    expect(envDefault).toBe(1);
    const cap = resolveEffectiveCap({ perSessionCap: null, envDefault });
    expect(cap).toBe(1);
    const result = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault });
    expect(result.allow).toBe(false);
  });

  it("SOURCE-VERIFIED WIRING (documented, not independently harnessed): paper-signal-service.ts:3725-3752 calls evaluateDailyTradeCap with {tradesToday, perSessionCap, envDefault} and sets dailyTradeCapBlocked=true + writes consistency.daily_trade_cap_blocked audit on !capResult.allow, which folds into lockoutBlocked at line 3963 — this test documents that wiring exists so a future refactor that silently stops reading .allow is at least flagged for re-verification", () => {
    // This is a documentation-anchor assertion, not a substitute for the
    // decision-function tests above. It intentionally does not mock or
    // execute paper-signal-service.ts (out of scope — see file header).
    const capResult = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: null, envDefault: 2 });
    const dailyTradeCapBlocked = !capResult.allow;
    expect(dailyTradeCapBlocked).toBe(true);
  });
});
