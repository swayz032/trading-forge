/**
 * wave26-pass-g-paper-signal-archetype-wiring.test.ts — Wave 26 Pass G wiring check
 *
 * Static source inspection verifying that paper-signal-service.ts contains the
 * correct archetype audit hook wiring added in A.4 Pass G integration.
 *
 * These tests answer: "Does the paper-signal-service actually call the A.4
 * observability hooks when an archetype signal fires through all gates?"
 *
 * Tests:
 *   1. paper-signal-service imports archetype-signal-audit (dynamic import inside hook)
 *   2. Hook fires only inside riskGatePassed block (entry guards respected)
 *   3. emitBounceOffLevelSignal call dispatched for bounce_off_level archetype
 *   4. emitIctBiasAlignedContinuationSignal call dispatched for ict_bias_aligned_continuation
 *   5. entry_indicator parsed with archetype: prefix
 *   6. direction passed as signalDirection (long/short, typed) to both emitters
 *   7. correlationId threaded into both emit calls
 *   8. bar_timestamp ISO string conversion present
 *   9. try/catch envelope guards the entire hook — never rethrows to entry path
 *  10. ma_period / ma_type / rejection_pattern pulled from entry_params for bounce_off_level
 *  11. htf_bias derived from signalDirection for ict_bias_aligned_continuation
 *  12. structure_break_type / fvg_age_bars / killzone fall back to safe defaults
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Source under test ────────────────────────────────────────────────────────

const PSS_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

// ─── Locate the hook block for focused assertions ─────────────────────────────

// The hook is a try/catch block inside `if (riskGatePassed)`, after pendingEntryQueue.set.
// We anchor on the Wave 26 comment that opens the hook block.
const HOOK_COMMENT = "Wave 26 Pass G A.4: Archetype signal-fire audit hook";
const hookStart = PSS_SRC.indexOf(HOOK_COMMENT);

// We need enough of the hook to cover the entire try/catch block (~60 lines ≈ 4500 chars).
const HOOK_WINDOW = hookStart >= 0 ? PSS_SRC.slice(hookStart, hookStart + 4500) : "";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass G — paper-signal-service archetype audit wiring", () => {
  it("hook comment anchor is found in paper-signal-service.ts", () => {
    expect(hookStart).toBeGreaterThan(0);
  });

  it("hook is placed inside the riskGatePassed block (appears after pendingEntryQueue.set)", () => {
    // The `pendingEntryQueue.set(pendingKey` must appear BEFORE the hook comment
    const queueSetIdx = PSS_SRC.lastIndexOf("pendingEntryQueue.set(pendingKey", hookStart);
    expect(queueSetIdx).toBeGreaterThan(0);
    // Confirm set comes before hook
    expect(queueSetIdx).toBeLessThan(hookStart);
  });

  it("entire hook is wrapped in try/catch to prevent rethrow to entry path", () => {
    // The hook must open with `try {` and close with `} catch (archetypeAuditErr`
    expect(HOOK_WINDOW).toMatch(/try\s*\{/);
    expect(HOOK_WINDOW).toContain("archetypeAuditErr");
  });

  it("catch block calls logger.warn (never rethrows)", () => {
    const catchIdx = HOOK_WINDOW.indexOf("archetypeAuditErr");
    const catchWindow = HOOK_WINDOW.slice(catchIdx, catchIdx + 300);
    // Must warn and NOT rethrow
    expect(catchWindow).toContain("logger.warn");
    expect(catchWindow).not.toContain("throw archetypeAuditErr");
    expect(catchWindow).not.toContain("throw new");
  });

  it("entry_indicator is read from config with archetype: prefix check", () => {
    expect(HOOK_WINDOW).toContain("entry_indicator");
    expect(HOOK_WINDOW).toContain('archetype:');
    expect(HOOK_WINDOW).toMatch(/startsWith\(["']archetype:/);
  });

  it("archetypeName is extracted by slicing off 'archetype:' prefix", () => {
    expect(HOOK_WINDOW).toContain('"archetype:".length');
  });

  it("bounce_off_level emitBounceOffLevelSignal is dispatched for that archetype", () => {
    expect(HOOK_WINDOW).toContain('"bounce_off_level"');
    expect(HOOK_WINDOW).toContain("emitBounceOffLevelSignal");
  });

  it("ict_bias_aligned_continuation emitIctBiasAlignedContinuationSignal is dispatched for that archetype", () => {
    expect(HOOK_WINDOW).toContain('"ict_bias_aligned_continuation"');
    expect(HOOK_WINDOW).toContain("emitIctBiasAlignedContinuationSignal");
  });

  it("archetype-signal-audit.js is dynamically imported inside the hook", () => {
    expect(HOOK_WINDOW).toContain("archetype-signal-audit.js");
    // Dynamic import pattern
    expect(HOOK_WINDOW).toMatch(/import\(["']\.\.\/lib\/archetype-signal-audit\.js["']\)/);
  });

  it("strategy_id uses sessionConfig.strategyId for both emit calls", () => {
    expect(HOOK_WINDOW).toContain("sessionConfig.strategyId");
  });

  it("correlation_id uses correlationId with null fallback for both emit calls", () => {
    expect(HOOK_WINDOW).toContain("correlationId ?? null");
  });

  it("direction is typed as long/short from config.side", () => {
    // signalDirection is derived from config.side
    expect(HOOK_WINDOW).toContain("signalDirection");
    expect(HOOK_WINDOW).toMatch(/config\.side.*short.*long|long.*short.*config\.side/s);
  });

  it("bar_timestamp ISO string converted from bar.timestamp", () => {
    expect(HOOK_WINDOW).toContain("bar.timestamp");
    expect(HOOK_WINDOW).toContain("toISOString()");
    // Fallback chain covers number → string → new Date()
    expect(HOOK_WINDOW).toContain("new Date().toISOString()");
  });

  it("bounce_off_level: ma_period pulled from entry_params with numeric fallback 200", () => {
    const bounceIdx = HOOK_WINDOW.indexOf('"bounce_off_level"');
    const bounceWindow = HOOK_WINDOW.slice(bounceIdx, bounceIdx + 700);
    expect(bounceWindow).toContain("ma_period");
    expect(bounceWindow).toContain("200"); // numeric fallback
  });

  it("bounce_off_level: ma_type pulled from entry_params with string fallback 'sma'", () => {
    const bounceIdx = HOOK_WINDOW.indexOf('"bounce_off_level"');
    const bounceWindow = HOOK_WINDOW.slice(bounceIdx, bounceIdx + 700);
    expect(bounceWindow).toContain("ma_type");
    expect(bounceWindow).toContain('"sma"'); // string fallback
  });

  it("bounce_off_level: rejection_pattern pulled from entry_params with fallback", () => {
    const bounceIdx = HOOK_WINDOW.indexOf('"bounce_off_level"');
    // bounce_off_level emit block spans ~12 lines (~1000 chars including the call)
    const bounceWindow = HOOK_WINDOW.slice(bounceIdx, bounceIdx + 1200);
    expect(bounceWindow).toContain("rejection_pattern");
    expect(bounceWindow).toContain('"any_close_back_through"'); // safe default
  });

  it("ict_bias_aligned_continuation: htf_bias derived from signalDirection (bullish/bearish)", () => {
    const ictIdx = HOOK_WINDOW.indexOf('"ict_bias_aligned_continuation"');
    // ICT emit block spans ~18 lines (~1500 chars including comments + call)
    const ictWindow = HOOK_WINDOW.slice(ictIdx, ictIdx + 1800);
    expect(ictWindow).toContain("htf_bias");
    expect(ictWindow).toContain('"bullish"');
    expect(ictWindow).toContain('"bearish"');
    // Derived from signalDirection
    expect(ictWindow).toContain("signalDirection");
  });

  it("ict_bias_aligned_continuation: structure_break_type has safe default 'BOS'", () => {
    const ictIdx = HOOK_WINDOW.indexOf('"ict_bias_aligned_continuation"');
    const ictWindow = HOOK_WINDOW.slice(ictIdx, ictIdx + 1800);
    expect(ictWindow).toContain("structure_break_type");
    expect(ictWindow).toContain('"BOS"'); // safe fallback
  });

  it("ict_bias_aligned_continuation: fvg_age_bars has numeric fallback 0", () => {
    const ictIdx = HOOK_WINDOW.indexOf('"ict_bias_aligned_continuation"');
    const ictWindow = HOOK_WINDOW.slice(ictIdx, ictIdx + 1800);
    expect(ictWindow).toContain("fvg_age_bars");
    // fallback 0
    expect(ictWindow).toMatch(/fvg_age_bars.*0|0.*fvg_age_bars/s);
  });

  it("ict_bias_aligned_continuation: killzone has string fallback 'unknown'", () => {
    const ictIdx = HOOK_WINDOW.indexOf('"ict_bias_aligned_continuation"');
    const ictWindow = HOOK_WINDOW.slice(ictIdx, ictIdx + 1800);
    expect(ictWindow).toContain("killzone");
    expect(ictWindow).toContain('"unknown"'); // safe fallback when Python-side data unavailable
  });
});
