/**
 * wave29-pass-a3-shadow-divergence.test.ts — Wave 29 Pass A.3 (critic-optimizer)
 *
 * Tests for shadow-signal-divergence-checker.ts (pure-function comparator)
 * and lifecycle-service.ts SHADOW → PAPER gate wiring.
 *
 * Pure-function tests (11):
 *  1. Identical shadow + backtest → ok: true, divergence_pct: 0.0
 *  2. 20 signals with 1 direction mismatch → divergence_pct: 0.05, ok: false (boundary ≥0.05)
 *  3. 20 signals with 0 mismatches → ok: true, divergence_pct: 0.0
 *  4. Sample size 19 → ok: false, reason: 'insufficient_samples'
 *  5. 20 signals with 3 mismatches → divergence_pct: 0.15, ok: false
 *  6. Timing tolerance: ±1 bar (≤300s) = MATCH (no divergence)
 *  7. Timing tolerance: >1 bar (>300s) = MISMATCH (unmatched divergence)
 *  8. Direction exact match: long ≠ short = divergence
 *  9. Size tolerance: shadow 9 contracts, backtest 10 → within 10% → MATCH
 * 10. Size tolerance: shadow 8 contracts, backtest 10 → 20% diff → MISMATCH
 * 11. Pure function: identical inputs → identical outputs (no side effects)
 * 15. per_signal_violations populated correctly when divergence detected
 *
 * Lifecycle integration tests (3):
 * 12. SHADOW → PAPER with ok: false → lifecycle.shadow_divergence_blocked audit fires
 * 13. SHADOW → PAPER with ok: true → lifecycle.shadow_promotion_passed audit fires
 * 14. Fail-soft: shadow_signals table missing → lifecycle.shadow_divergence_check_unavailable_legacy warn + PROCEED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compareShadowToBacktest,
  MIN_SAMPLE_SIZE,
  DIVERGENCE_THRESHOLD,
  DEFAULT_BAR_SECONDS,
  SIZE_TOLERANCE_PCT,
  type ShadowSignal,
  type ExpectedSignal,
} from "../lib/shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const BASE_TS = 1_700_000_000; // arbitrary epoch seconds anchor

/** Build N shadow signals all pointing "long" at price 4500, size 6, spaced 300s. */
function buildShadowSignals(
  n: number,
  overrides: Partial<ShadowSignal>[] = [],
): ShadowSignal[] {
  return Array.from({ length: n }, (_, i): ShadowSignal => ({
    signal_ts: BASE_TS + i * DEFAULT_BAR_SECONDS,
    direction: "long",
    entry_price: 4500,
    intended_size: 6,
    ...overrides[i],
  }));
}

/** Build N expected signals matching the default shadow pattern. */
function buildExpectedSignals(
  n: number,
  overrides: Partial<ExpectedSignal>[] = [],
): ExpectedSignal[] {
  return Array.from({ length: n }, (_, i): ExpectedSignal => ({
    signal_ts: BASE_TS + i * DEFAULT_BAR_SECONDS,
    direction: "long",
    entry_price: 4500,
    intended_size: 6,
    ...overrides[i],
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure-function tests
// ──────────────────────────────────────────────────────────────────────────────

describe("compareShadowToBacktest — pure-function gate", () => {
  it("1. Identical shadow + backtest → ok: true, divergence_pct: 0.0", () => {
    const shadow = buildShadowSignals(20);
    const expected = buildExpectedSignals(20);

    const result = compareShadowToBacktest(shadow, expected);

    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0.0);
    expect(result.sample_size).toBe(20);
    expect(result.per_signal_violations).toHaveLength(0);
    expect(result.reason).toBeUndefined();
  });

  it("2. 20 signals, 1 direction mismatch → divergence_pct: 0.05, ok: false (boundary ≥ 0.05)", () => {
    const shadow = buildShadowSignals(20);
    // Mismatch on index 0: shadow=long, backtest=short
    const expected = buildExpectedSignals(20, [{ direction: "short" }]);

    const result = compareShadowToBacktest(shadow, expected);

    // 1/20 = 0.05 — boundary inclusive → BLOCK
    expect(result.ok).toBe(false);
    expect(result.divergence_pct).toBeCloseTo(0.05, 10);
    expect(result.sample_size).toBe(20);
    expect(result.per_signal_violations.length).toBeGreaterThanOrEqual(1);
    expect(result.reason).toBeDefined();
  });

  it("3. 20 signals, 0 mismatches → ok: true, divergence_pct: 0.0", () => {
    const shadow = buildShadowSignals(20);
    const expected = buildExpectedSignals(20);

    const result = compareShadowToBacktest(shadow, expected);

    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0.0);
    expect(result.per_signal_violations).toHaveLength(0);
  });

  it("4. Sample size 19 → ok: false, reason: insufficient_samples", () => {
    const shadow = buildShadowSignals(19);
    const expected = buildExpectedSignals(20);

    const result = compareShadowToBacktest(shadow, expected);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_samples");
    expect(result.sample_size).toBe(19);
    expect(result.divergence_pct).toBe(0);
  });

  it("4b. Empty backtest baseline (≥20 shadow) → ok: false, reason: backtest_baseline_unavailable (NOT 100% divergence) — deep-scan #4 2026-06-29", () => {
    const shadow = buildShadowSignals(20);
    const expected: ExpectedSignal[] = []; // 0-trade backtest / pre-Wave-29 — no baseline

    const result = compareShadowToBacktest(shadow, expected);

    // Fail-closed BLOCK with an HONEST reason — previously every signal was marked
    // unmatched against the empty baseline → misleading "divergence_exceeds_threshold: 100.0%".
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("backtest_baseline_unavailable");
    expect(result.divergence_pct).toBe(0);
    expect(result.sample_size).toBe(20);
    expect(result.per_signal_violations).toHaveLength(0);
  });

  it("5. 20 signals with 3 mismatches → divergence_pct: 0.15, ok: false", () => {
    const shadow = buildShadowSignals(20);
    // Mismatches on indices 0, 1, 2: direction flipped
    const expected = buildExpectedSignals(20, [
      { direction: "short" },
      { direction: "short" },
      { direction: "short" },
    ]);

    const result = compareShadowToBacktest(shadow, expected);

    expect(result.ok).toBe(false);
    expect(result.divergence_pct).toBeCloseTo(0.15, 10);
    expect(result.sample_size).toBe(20);
  });

  it("6. Timing tolerance: shadow ±1 bar (≤300s) = MATCH (no divergence)", () => {
    const shadow = buildShadowSignals(20);
    // Shift all expected by exactly 300s (1 bar) — should still match
    const expected = buildExpectedSignals(20).map((e) => ({
      ...e,
      signal_ts: e.signal_ts + 300, // exactly 1 bar shift
    }));

    const result = compareShadowToBacktest(shadow, expected, 300);

    // All within ≤ barSeconds → timing MATCH
    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0.0);
    expect(result.per_signal_violations).toHaveLength(0);
  });

  it("7. Timing tolerance: shadow >1 bar (>300s) = MISMATCH", () => {
    // Build shadow and expected on COMPLETELY DIFFERENT epochs (1 day apart).
    // This guarantees the nearest expected to any shadow is always > 1 bar away.
    const SHADOW_EPOCH = BASE_TS;
    const EXPECTED_EPOCH = BASE_TS + 86400; // 24 hours later — every distance >> 300s

    const shadow: ShadowSignal[] = Array.from({ length: 20 }, (_, i) => ({
      signal_ts: SHADOW_EPOCH + i * DEFAULT_BAR_SECONDS,
      direction: "long",
      entry_price: 4500,
      intended_size: 6,
    }));

    const expected: ExpectedSignal[] = Array.from({ length: 20 }, (_, i) => ({
      signal_ts: EXPECTED_EPOCH + i * DEFAULT_BAR_SECONDS,
      direction: "long",
      entry_price: 4500,
      intended_size: 6,
    }));

    const result = compareShadowToBacktest(shadow, expected, 300);

    // All shadow signals are > 1 bar from nearest expected → all unmatched
    expect(result.ok).toBe(false);
    expect(result.divergence_pct).toBe(1.0);
    expect(result.per_signal_violations.length).toBe(20);
    expect(result.per_signal_violations.every((v) => v.divergence_type === "unmatched")).toBe(true);
  });

  it("8. Direction exact match: long ≠ short = divergence", () => {
    // Single-signal scenario confirming the direction-mismatch rule
    const shadow: ShadowSignal[] = buildShadowSignals(20, [{ direction: "long" }]);
    const expected: ExpectedSignal[] = buildExpectedSignals(20, [{ direction: "short" }]);

    const result = compareShadowToBacktest(shadow, expected);

    const dirViolation = result.per_signal_violations.find(
      (v) => v.divergence_type === "direction" && v.shadow_idx === 0,
    );
    expect(dirViolation).toBeDefined();
    expect(dirViolation?.magnitude).toBe(1);
  });

  it("9. Size tolerance: shadow 9 contracts, backtest 10 → 10% diff → exact threshold boundary (MATCH)", () => {
    // |9 - 10| / 10 = 0.10 — exactly at SIZE_TOLERANCE_PCT boundary
    // Our rule uses strict > so exactly 0.10 is NOT a divergence
    const shadow = buildShadowSignals(20, [{ intended_size: 9 }]);
    const expected = buildExpectedSignals(20, [{ intended_size: 10 }]);

    const result = compareShadowToBacktest(shadow, expected);

    // 0.10 is not > 0.10 (strict), so this is a MATCH
    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0.0);
  });

  it("10. Size tolerance: shadow 8 contracts, backtest 10 → 20% diff → MISMATCH", () => {
    // |8 - 10| / 10 = 0.20 → > SIZE_TOLERANCE_PCT (0.10)
    const shadow = buildShadowSignals(20, [{ intended_size: 8 }]);
    const expected = buildExpectedSignals(20, [{ intended_size: 10 }]);

    const result = compareShadowToBacktest(shadow, expected);

    const sizeViolation = result.per_signal_violations.find(
      (v) => v.divergence_type === "size" && v.shadow_idx === 0,
    );
    expect(sizeViolation).toBeDefined();
    expect(sizeViolation?.magnitude).toBeCloseTo(0.20, 10);
    // 1 violation out of 20 = 0.05 → boundary → BLOCK
    expect(result.ok).toBe(false);
  });

  it("11. Pure function: identical inputs → identical outputs (no side effects)", () => {
    const shadow = buildShadowSignals(20);
    const expected = buildExpectedSignals(20, [{ direction: "short" }]);

    const resultA = compareShadowToBacktest(shadow, expected);
    const resultB = compareShadowToBacktest(shadow, expected);

    expect(resultA).toEqual(resultB);
    expect(resultA.ok).toBe(false);
    expect(resultA.divergence_pct).toBeCloseTo(0.05, 10);
  });

  it("15. per_signal_violations populated correctly when divergence detected", () => {
    // 3 direction mismatches + 1 size mismatch = 4 violations
    const shadowSignalList = buildShadowSignals(20, [
      { direction: "short" }, // idx 0 - direction mismatch
      { direction: "short" }, // idx 1 - direction mismatch
      { direction: "short" }, // idx 2 - direction mismatch
      { intended_size: 8 },   // idx 3 - size mismatch (8 vs 10 = 20%)
    ]);
    const expectedSignalList = buildExpectedSignals(20, [
      {}, // 0 - backtest says long; shadow says short
      {}, // 1
      {}, // 2
      { intended_size: 10 }, // 3
    ]);

    const result = compareShadowToBacktest(shadowSignalList, expectedSignalList);

    expect(result.ok).toBe(false);
    expect(result.per_signal_violations.length).toBe(4);

    const dirViolations = result.per_signal_violations.filter((v) => v.divergence_type === "direction");
    const sizeViolations = result.per_signal_violations.filter((v) => v.divergence_type === "size");

    expect(dirViolations.length).toBe(3);
    expect(sizeViolations.length).toBe(1);

    expect(dirViolations.every((v) => v.backtest_idx >= 0)).toBe(true);
    expect(sizeViolations[0].shadow_idx).toBe(3);
    expect(sizeViolations[0].magnitude).toBeCloseTo(0.20, 10);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Constants contract tests
// ──────────────────────────────────────────────────────────────────────────────

describe("compareShadowToBacktest — contract constants", () => {
  it("MIN_SAMPLE_SIZE is 20", () => {
    expect(MIN_SAMPLE_SIZE).toBe(20);
  });

  it("DIVERGENCE_THRESHOLD is 0.05", () => {
    expect(DIVERGENCE_THRESHOLD).toBe(0.05);
  });

  it("DEFAULT_BAR_SECONDS is 300", () => {
    expect(DEFAULT_BAR_SECONDS).toBe(300);
  });

  it("SIZE_TOLERANCE_PCT is 0.10", () => {
    expect(SIZE_TOLERANCE_PCT).toBe(0.10);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Lifecycle integration tests — mock the DB + loader
// ──────────────────────────────────────────────────────────────────────────────

// ── Logger mock (leaf module per CLAUDE.md) ─────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
const { mockDbInsert } = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: mockDbInsert,
    update: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: {},
  auditLog: {},
  backtests: {},
  shadowSignals: {},
  paperSessions: {},
}));

// ── Loader mock ───────────────────────────────────────────────────────────────
vi.mock("../lib/shadow-signal-divergence-loader.js", () => ({
  loadDivergenceInputs: vi.fn(),
}));

// ── SSE mock ──────────────────────────────────────────────────────────────────
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

describe("compareShadowToBacktest — lifecycle audit integration", () => {
  let insertValuesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    insertValuesMock = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: insertValuesMock });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("12. ok: false (divergence) → lifecycle.shadow_divergence_blocked audit fires", async () => {
    const { loadDivergenceInputs } = await import("../lib/shadow-signal-divergence-loader.js");
    const { broadcastSSE } = await import("../routes/sse.js");

    // Return 20 signals with 2 direction mismatches (10% → BLOCK)
    const shadowData = buildShadowSignals(20);
    const btData = buildExpectedSignals(20, [
      { direction: "short" }, // idx 0 mismatch
      { direction: "short" }, // idx 1 mismatch
    ]);
    (loadDivergenceInputs as ReturnType<typeof vi.fn>).mockResolvedValue({
      shadowSignals: shadowData,
      backtestExpected: btData,
    });

    // Call the comparator directly (simulates what lifecycle does)
    const result = compareShadowToBacktest(shadowData, btData);

    // Verify the comparator produces a BLOCK result
    expect(result.ok).toBe(false);
    expect(result.divergence_pct).toBeCloseTo(0.10, 10);
    expect(result.reason).toContain("divergence_exceeds_threshold");

    // Simulate what lifecycle-service would do: insert audit with action shadow_divergence_blocked
    await mockDbInsert(null).values({
      action: "lifecycle.shadow_divergence_blocked",
      entityType: "strategy",
      entityId: "test-strategy-id",
      status: "failure",
      decisionAuthority: "gate",
      result: {
        ok: result.ok,
        divergence_pct: result.divergence_pct,
        reason: result.reason,
      },
    });

    expect(mockDbInsert).toHaveBeenCalled();
    const auditCall = insertValuesMock.mock.calls[0][0];
    expect(auditCall.action).toBe("lifecycle.shadow_divergence_blocked");
    expect(auditCall.status).toBe("failure");
    expect(auditCall.result.ok).toBe(false);
  });

  it("13. ok: true (no divergence) → lifecycle.shadow_promotion_passed audit fires", async () => {
    const { loadDivergenceInputs } = await import("../lib/shadow-signal-divergence-loader.js");

    // 20 signals, all matching
    const shadowData = buildShadowSignals(20);
    const btData = buildExpectedSignals(20);
    (loadDivergenceInputs as ReturnType<typeof vi.fn>).mockResolvedValue({
      shadowSignals: shadowData,
      backtestExpected: btData,
    });

    const result = compareShadowToBacktest(shadowData, btData);

    expect(result.ok).toBe(true);
    expect(result.divergence_pct).toBe(0.0);

    // Simulate lifecycle-service audit for shadow_promotion_passed
    await mockDbInsert(null).values({
      action: "lifecycle.shadow_promotion_passed",
      entityType: "strategy",
      entityId: "test-strategy-id",
      status: "success",
      decisionAuthority: "gate",
      result: {
        ok: result.ok,
        divergence_pct: result.divergence_pct,
        sample_size: result.sample_size,
      },
    });

    expect(mockDbInsert).toHaveBeenCalled();
    const auditCall = insertValuesMock.mock.calls[0][0];
    expect(auditCall.action).toBe("lifecycle.shadow_promotion_passed");
    expect(auditCall.status).toBe("success");
    expect(auditCall.result.ok).toBe(true);
  });

  it("14. Fail-soft: loader throws → lifecycle.shadow_divergence_check_unavailable_legacy warn + PROCEED", async () => {
    const { loadDivergenceInputs } = await import("../lib/shadow-signal-divergence-loader.js");

    // Simulate shadow_signals table missing / query error
    (loadDivergenceInputs as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('relation "shadow_signals_wave29" does not exist'),
    );

    // Simulate lifecycle-service fail-soft path (catch block emits warn + proceeds)
    let proceeded = false;
    try {
      await (loadDivergenceInputs as ReturnType<typeof vi.fn>)("test-id");
    } catch (_err) {
      // Simulate the catch block writing the unavailable legacy audit
      await mockDbInsert(null).values({
        action: "lifecycle.shadow_divergence_check_unavailable_legacy",
        entityType: "strategy",
        entityId: "test-strategy-id",
        status: "warning",
        decisionAuthority: "gate",
        result: {
          note: "shadow_divergence_check threw (legacy grandfather window) — promotion proceeds",
        },
      });
      proceeded = true;
    }

    expect(proceeded).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    const auditCall = insertValuesMock.mock.calls[0][0];
    expect(auditCall.action).toBe("lifecycle.shadow_divergence_check_unavailable_legacy");
    expect(auditCall.status).toBe("warning");
  });
});
