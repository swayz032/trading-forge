/**
 * W23F live-fix 2026-05-19 — DSL critic look-ahead rule must be engine-aware.
 *
 * The backtest engine (`src/engine/backtester.py:70-83`) shifts entries +1 bar
 * via np.roll() before passing to vectorbt. This makes bare `close > X`,
 * `high > Y`, `low < Z` references in DSL entry conditions SAFE.
 *
 * If the DSL critic rejects bare close/high/low references, the entire scout
 * pipeline produces zero graduations even when extractions are clean. We saw
 * this happen live during W23F testing (cycle 1, 09:22 UTC) — fixed by
 * narrowing `anti-pattern-catalog.md` §3.
 *
 * These tests pin the contract so future agents cannot reintroduce the false
 * positive without an explicit, deliberate change to the catalog rule.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CATALOG_PATH = resolve(__dirname, "../../agents/kb/anti-pattern-catalog.md");
const BACKTESTER_PATH = resolve(__dirname, "../../engine/backtester.py");
const CLAUDE_MD_PATH = resolve(__dirname, "../../../CLAUDE.md");

const catalogSrc = readFileSync(CATALOG_PATH, "utf8");
const backtesterSrc = readFileSync(BACKTESTER_PATH, "utf8");
const claudeMdSrc = readFileSync(CLAUDE_MD_PATH, "utf8");

describe("W23F look-ahead critic — engine-aware contract", () => {
  it("anti-pattern-catalog §3 documents the engine's auto-shift", () => {
    expect(catalogSrc).toMatch(/np\.roll\(\)/);
    expect(catalogSrc).toMatch(/bare `close > /i);
    expect(catalogSrc).toMatch(/SAFE/);
  });

  it("anti-pattern-catalog §3 detection rule is NARROW (engine-aware)", () => {
    // The detection regex must look for impossible references, not bare close/high/low
    expect(catalogSrc).toMatch(/tomorrow\|future_/);
    expect(catalogSrc).toMatch(/centered_window/);
    // Must NOT contain the old broad rule (any close|high|low → reject)
    const oldBroadRule = /const hasCloseRef = \/close\|high\|low\/\.test\(cond\);[\s\S]{0,200}return hasCloseRef && !hasNextBarQualifier;/;
    expect(catalogSrc).not.toMatch(oldBroadRule);
  });

  it("backtester.py pins the DSL critic contract comment", () => {
    expect(backtesterSrc).toMatch(/DSL Critic Contract/);
    expect(backtesterSrc).toMatch(/anti-pattern-catalog\.md/);
    expect(backtesterSrc).toMatch(/MUST NOT reject strategies for bare close\/high\/low/i);
  });

  it("CLAUDE.md pinned-facts section documents the auto-shift contract", () => {
    expect(claudeMdSrc).toMatch(/Backtest engine auto-shifts entries \+1 bar/);
    expect(claudeMdSrc).toMatch(/anti-pattern-catalog\.md/);
  });

  // Smoke-test the new narrow detection function against real DSL shapes
  function detectLookAheadBias(dsl: Record<string, unknown>): boolean {
    const cond = JSON.stringify(dsl).toLowerCase();
    const impossibleRefs = /tomorrow|future_|next_close|next_high|bar_\+\d+|centered_window|lookahead/.test(cond);
    const sameBarOptOut =
      (dsl as { signal_lag?: number; same_bar_fill?: boolean; fill_on?: string }).signal_lag === 0 ||
      (dsl as { same_bar_fill?: boolean }).same_bar_fill === true ||
      (dsl as { fill_on?: string }).fill_on === "close";
    return impossibleRefs || sameBarOptOut;
  }

  it("the narrow rule does NOT flag bare `close > orh_15m` (the W23F live test failure case)", () => {
    const cleanORB = {
      entry_long: "close > orh_15m",
      entry_condition: "Enter long after first 15m close above opening range high",
      entry_indicator: "opening_range_breakout",
      preferred_regime: "TRENDING_UP",
    };
    expect(detectLookAheadBias(cleanORB)).toBe(false);
  });

  it("the narrow rule does NOT flag bare `high > prev_swing_high`", () => {
    const cleanBreakout = {
      entry_long: "high > prev_swing_high",
      entry_condition: "Enter on break of prior swing high",
    };
    expect(detectLookAheadBias(cleanBreakout)).toBe(false);
  });

  it("the narrow rule DOES flag references to future bars (`tomorrow.high`)", () => {
    const impossible = { entry_long: "tomorrow.high > today.high" };
    expect(detectLookAheadBias(impossible)).toBe(true);
  });

  it("the narrow rule DOES flag `centered_window` indicators", () => {
    const future = { indicator: "rsi_centered_window_5", entry_long: "rsi > 70" };
    expect(detectLookAheadBias(future)).toBe(true);
  });

  it("the narrow rule DOES flag `bar_+N` references", () => {
    const future = { entry_long: "close > bar_+2.high" };
    expect(detectLookAheadBias(future)).toBe(true);
  });

  it("the narrow rule DOES flag explicit `same_bar_fill: true` opt-out", () => {
    const optOut = { entry_long: "close > orh_15m", same_bar_fill: true };
    expect(detectLookAheadBias(optOut)).toBe(true);
  });

  it("the narrow rule DOES flag explicit `signal_lag: 0` opt-out", () => {
    const optOut = { entry_long: "close > orh_15m", signal_lag: 0 };
    expect(detectLookAheadBias(optOut)).toBe(true);
  });

  it("the narrow rule DOES flag explicit `fill_on: 'close'` opt-out", () => {
    const optOut = { entry_long: "close > orh_15m", fill_on: "close" };
    expect(detectLookAheadBias(optOut)).toBe(true);
  });

  it("regression guard — the previously-rejected cycle 1 DSL now passes the narrow rule", () => {
    // This is the actual DSL shape from the W23F.D live test on 2026-05-19 09:22 UTC
    // that got rejected by the critic. With the engine-aware narrow rule, it passes.
    const cycle1DSL = {
      strategy_name: "orb_mnq_5m",
      market: "MNQ",
      timeframe: "5m",
      entry_indicator: "opening_range_breakout",
      entry_long: "close > orh_15m",
      entry_condition: "first 15m close above opening range high",
      preferred_regime: "TRENDING_UP",
      direction: "both",
    };
    expect(detectLookAheadBias(cycle1DSL)).toBe(false);
  });
});
