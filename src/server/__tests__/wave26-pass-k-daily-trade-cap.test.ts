/**
 * wave26-pass-k-daily-trade-cap.test.ts — Wave 26 Pass K Phase 1 (2026-05-26)
 *
 * Pure-function test suite for the 1-2 A+ trades/day hard gate.
 *
 * Verifies:
 *   - Precedence: per-session cap > env default
 *   - Quota math: tradesToday < cap = allow, >= cap = block
 *   - Fail-open on bad input (negative / NaN tradesToday)
 *   - Cap disable via 0 or negative effectiveCap
 *   - Env default of 2 when TF_MAX_TRADES_PER_DAY unset / malformed
 *   - Operator mandate alignment (3rd trade is the FIRST rejected at default)
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  evaluateDailyTradeCap,
  resolveEffectiveCap,
  getDailyTradeCapEnvDefault,
} from "../lib/daily-trade-cap.js";

describe("resolveEffectiveCap — precedence", () => {
  it("per-session cap takes precedence when set + positive", () => {
    expect(resolveEffectiveCap({ perSessionCap: 1, envDefault: 2 })).toBe(1);
    expect(resolveEffectiveCap({ perSessionCap: 5, envDefault: 2 })).toBe(5);
  });

  it("falls through to env when per-session is null", () => {
    expect(resolveEffectiveCap({ perSessionCap: null, envDefault: 2 })).toBe(2);
  });

  it("falls through to env when per-session is zero (treated as unset)", () => {
    // 0 is "cap disabled" sentinel in the per-session config; let env override
    expect(resolveEffectiveCap({ perSessionCap: 0, envDefault: 2 })).toBe(2);
  });

  it("falls through to env when per-session is negative", () => {
    expect(resolveEffectiveCap({ perSessionCap: -1, envDefault: 2 })).toBe(2);
  });

  it("floors fractional per-session cap", () => {
    expect(resolveEffectiveCap({ perSessionCap: 2.9, envDefault: 5 })).toBe(2);
  });
});

describe("evaluateDailyTradeCap — quota enforcement (operator mandate: 1-2 trades/day default)", () => {
  it("allows the 1st trade of the day (0 taken, cap 2)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.effectiveCap).toBe(2);
    expect(r.reason).toMatch(/within_quota/);
  });

  it("allows the 2nd trade of the day (1 taken, cap 2)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.reason).toMatch(/1\/2/);
  });

  it("BLOCKS the 3rd trade of the day (2 taken, cap 2) — operator mandate", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/daily_trade_cap_reached/);
    expect(r.reason).toMatch(/2\/2/);
    expect(r.reason).toMatch(/CLAUDE\.md §4/);
  });

  it("BLOCKS further trades after cap reached (5 taken, cap 2)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 5, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(false);
    expect(r.tradesToday).toBe(5);
  });

  it("per-session cap 1 enforces 1-trade-only (2nd blocked)", () => {
    expect(evaluateDailyTradeCap({ tradesToday: 0, perSessionCap: 1, envDefault: 2 }).allow).toBe(true);
    expect(evaluateDailyTradeCap({ tradesToday: 1, perSessionCap: 1, envDefault: 2 }).allow).toBe(false);
  });

  it("per-session cap 3 allows the 3rd trade when env default would block", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 2, perSessionCap: 3, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.effectiveCap).toBe(3);
  });
});

describe("evaluateDailyTradeCap — fail-open on bad input", () => {
  it("treats negative tradesToday as 0 (fail-open)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: -1, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.tradesToday).toBe(0);
  });

  it("treats NaN tradesToday as 0", () => {
    const r = evaluateDailyTradeCap({ tradesToday: NaN, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.tradesToday).toBe(0);
  });

  it("treats Infinity tradesToday as 0 (not finite)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: Infinity, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.tradesToday).toBe(0);
  });

  it("floors fractional tradesToday", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 1.9, perSessionCap: null, envDefault: 2 });
    expect(r.allow).toBe(true);
    expect(r.tradesToday).toBe(1);
  });
});

describe("evaluateDailyTradeCap — cap disable sentinel", () => {
  it("effectiveCap 0 disables the gate (always allow)", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 1000, perSessionCap: null, envDefault: 0 });
    expect(r.allow).toBe(true);
    expect(r.reason).toBe("daily_trade_cap_disabled");
  });

  it("effectiveCap negative also disables the gate", () => {
    const r = evaluateDailyTradeCap({ tradesToday: 1000, perSessionCap: null, envDefault: -1 });
    expect(r.allow).toBe(true);
    expect(r.reason).toBe("daily_trade_cap_disabled");
  });
});

describe("getDailyTradeCapEnvDefault", () => {
  const savedEnv = process.env.TF_MAX_TRADES_PER_DAY;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.TF_MAX_TRADES_PER_DAY;
    else process.env.TF_MAX_TRADES_PER_DAY = savedEnv;
  });

  it("returns 2 when env var unset (operator default)", () => {
    delete process.env.TF_MAX_TRADES_PER_DAY;
    expect(getDailyTradeCapEnvDefault()).toBe(2);
  });

  it("returns 2 when env var empty string", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "";
    expect(getDailyTradeCapEnvDefault()).toBe(2);
  });

  it("returns 2 when env var malformed", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "not-a-number";
    expect(getDailyTradeCapEnvDefault()).toBe(2);
  });

  it("respects env var override (1)", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "1";
    expect(getDailyTradeCapEnvDefault()).toBe(1);
  });

  it("respects env var override (5)", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "5";
    expect(getDailyTradeCapEnvDefault()).toBe(5);
  });

  it("floors fractional env var", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "2.7";
    expect(getDailyTradeCapEnvDefault()).toBe(2);
  });

  it("respects 0 (cap disabled)", () => {
    process.env.TF_MAX_TRADES_PER_DAY = "0";
    expect(getDailyTradeCapEnvDefault()).toBe(0);
  });
});
