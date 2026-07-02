/**
 * Deep-scan #11 Fix Track Q — Overlay / DSL regression tests
 *
 * FIX 1: exit_type allowlist (framework-overlay.ts)
 * FIX 2: rsi_reversal level→cross (dsl-compiler.ts)
 * FIX 3: N-of-M confluence disclosure (dsl-compiler.ts)
 *
 * NOTE: FIX 6 (critic fail-open) tests are in deepscan11-fixq-critic-failopen.test.ts
 *       because agent-service.ts requires DB mocking.
 */

import { describe, it, expect } from "vitest";
import { applyFrameworkOverlay } from "../services/framework-overlay.js";
import { compileDslToEngine, applyConfluenceToCompiled } from "../../server/lib/dsl-compiler.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function minimalConfig(exitType: string): Parameters<typeof applyFrameworkOverlay>[0]["compiled"] {
  return {
    strategy: {
      name: "test_strategy",
      stop_loss: { type: "atr", multiplier: 1.5 },
    },
    exit_type: exitType,
    direction: "long",
    entry_type: "limit",
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — exit_type allowlist
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 1: exit_type allowlist (framework-overlay)", () => {
  it("keeps valid 'trailing_stop' exit_type unchanged", () => {
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("trailing_stop"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("trailing_stop");
    expect(result.overlayAuditRows ?? []).toHaveLength(0);
  });

  it("keeps valid 'time_exit' exit_type unchanged", () => {
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("time_exit"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("time_exit");
    expect(result.overlayAuditRows ?? []).toHaveLength(0);
  });

  it("keeps valid 'indicator_signal' exit_type unchanged", () => {
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("indicator_signal"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("indicator_signal");
    expect(result.overlayAuditRows ?? []).toHaveLength(0);
  });

  it("normalizes hallucinated 'momentum_exit' → trailing_stop + audit event", () => {
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("momentum_exit"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("trailing_stop");
    expect(result.warnings.some((w) => w.includes("momentum_exit"))).toBe(true);
    const auditRow = (result.overlayAuditRows ?? []).find(
      (r) => r.action === "graduation.exit_type_normalized",
    );
    expect(auditRow).toBeDefined();
    expect(auditRow?.status).toBe("warning");
    expect((auditRow?.data as any).original_exit_type).toBe("momentum_exit");
    expect((auditRow?.data as any).normalized_to).toBe("trailing_stop");
  });

  it("normalizes hallucinated 'atr_trailing' → trailing_stop + audit event", () => {
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("atr_trailing"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("trailing_stop");
    const auditRow = (result.overlayAuditRows ?? []).find(
      (r) => r.action === "graduation.exit_type_normalized",
    );
    expect(auditRow).toBeDefined();
    expect((auditRow?.data as any).original_exit_type).toBe("atr_trailing");
  });

  it("normalizes 'fixed_target' → trailing_stop WITHOUT exit_type_normalized audit row", () => {
    // fixed_target is a KNOWN canonical type — it has its own normalization path above the allowlist.
    // No extra audit event; it's already disclosed in appliedRules.
    const result = applyFrameworkOverlay({
      compiled: minimalConfig("fixed_target"),
      source: "graduated_bucket",
      symbol: "MES",
    });
    expect(result.config.exit_type).toBe("trailing_stop");
    const auditRows = result.overlayAuditRows ?? [];
    const normRow = auditRows.find((r) => r.action === "graduation.exit_type_normalized");
    expect(normRow).toBeUndefined();
    // But the normalization IS logged in appliedRules
    expect(result.appliedRules.some((r) => r.includes("fixed_target"))).toBe(true);
  });

  it("archetype sentinel strategies (exit_type undefined) produce no audit row", () => {
    // Archetype strategies may omit exit_type entirely
    const result = applyFrameworkOverlay({
      compiled: {
        strategy: { name: "test", stop_loss: { type: "atr", multiplier: 1.5 } },
        entry_type: "archetype",
        direction: "both",
      } as any,
      source: "graduated_bucket",
      symbol: "MES",
    });
    const auditRows = result.overlayAuditRows ?? [];
    expect(auditRows.find((r) => r.action === "graduation.exit_type_normalized")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — rsi_reversal level→cross
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 2: rsi_reversal compiles to CROSS not LEVEL", () => {
  it("rsi_reversal(long) → rsi_14 crosses_above 30", () => {
    const result = compileDslToEngine({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "long",
    });
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("rsi_14 crosses_above 30");
    expect(result!.entry_short).toBe("high < low");
  });

  it("rsi_reversal(short) → rsi_14 crosses_below 70", () => {
    const result = compileDslToEngine({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "short",
    });
    expect(result).not.toBeNull();
    expect(result!.entry_short).toBe("rsi_14 crosses_below 70");
    expect(result!.entry_long).toBe("high < low");
  });

  it("rsi_reversal(both) → crosses_above oversold AND crosses_below overbought", () => {
    const result = compileDslToEngine({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "both",
    });
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("rsi_14 crosses_above 30");
    expect(result!.entry_short).toBe("rsi_14 crosses_below 70");
  });

  it("rsi_divergence(both) → same cross semantics", () => {
    const result = compileDslToEngine({
      entry_indicator: "rsi_divergence",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "both",
    });
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("rsi_14 crosses_above 30");
    expect(result!.entry_short).toBe("rsi_14 crosses_below 70");
  });

  it("connors_rsi2 uses canonical defaults (period=2, over=5/95) with crosses", () => {
    const result = compileDslToEngine({
      entry_indicator: "connors_rsi2",
      entry_params: {},
      direction: "both",
    });
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("rsi_2 crosses_above 5");
    expect(result!.entry_short).toBe("rsi_2 crosses_below 95");
  });

  it("does NOT contain bare level comparisons (< or >) in rsi grammar", () => {
    const result = compileDslToEngine({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "both",
    });
    // Must not have bare level comparisons (was `rsi_14 < 30`)
    expect(result!.entry_long).not.toMatch(/rsi_\d+ < \d+/);
    expect(result!.entry_short).not.toMatch(/rsi_\d+ > \d+/);
  });

  it("sentinel 'high < low' preserved for disabled direction in rsi_reversal", () => {
    // Long-only strategy: entry_short must remain sentinel
    const result = compileDslToEngine({
      entry_indicator: "rsi_reversal",
      entry_params: {},
      direction: "long",
    });
    expect(result!.entry_short).toBe("high < low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 — N-of-M confluence disclosure
// ─────────────────────────────────────────────────────────────────────────────

describe("FIX 3: N-of-M confluence downgrade disclosure", () => {
  const baseResult = compileDslToEngine({
    entry_indicator: "ema_crossover",
    entry_params: { fast_period: 9, slow_period: 21 },
    direction: "both",
  })!;

  it("full satisfaction (min=total) → no compiler_warnings", () => {
    const result = applyConfluenceToCompiled(baseResult, {
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 3, // 1 primary + 2 confirmings = 3 total — exact match
    });
    expect(result.compiler_warnings ?? []).toHaveLength(0);
  });

  it("N-of-M downgrade → compiler_warnings includes n_of_m_downgraded_to_and_all", () => {
    const result = applyConfluenceToCompiled(baseResult, {
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
        { indicator: "adx", params: { period: 14 }, direction: "agree" },
      ],
      min_factors_satisfied: 2, // requested 2 of 4 — compiler AND-chains all
    });
    expect(result.compiler_warnings).toBeDefined();
    expect(result.compiler_warnings!.length).toBeGreaterThan(0);
    expect(result.compiler_warnings![0]).toContain("n_of_m_downgraded_to_and_all");
    expect(result.compiler_warnings![0]).toContain("2/4");
  });

  it("N-of-M downgrade also appears in compileNotes for graduator audit row", () => {
    const result = applyConfluenceToCompiled(baseResult, {
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14 }, direction: "agree" },
        { indicator: "sma", params: { period: 200 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2,
    });
    const noteAboutNofM = result.compileNotes.some((n) => n.includes("n_of_m_downgraded_to_and_all"));
    expect(noteAboutNofM).toBe(true);
  });

  it("grammar still AND-chains all even when N-of-M (conservative fallback)", () => {
    const result = applyConfluenceToCompiled(baseResult, {
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 1, // only 1 of 3 required — but grammar will require all
    });
    // Grammar should still AND-chain (conservative)
    expect(result.entry_long).toContain(" AND ");
  });

  it("compiler_warnings message includes both requested and total count", () => {
    const result = applyConfluenceToCompiled(baseResult, {
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14 }, direction: "agree" },
      ],
      min_factors_satisfied: 1, // 1 of 2 total
    });
    expect(result.compiler_warnings).toBeDefined();
    expect(result.compiler_warnings![0]).toContain("1/2");
  });
});
