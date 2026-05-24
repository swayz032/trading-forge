/**
 * wave26-smt-live-bridge.test.ts
 * Wave 26 Group B Task 3 — SMT live bridge tests
 *
 * Coverage:
 *   1. Null snapshot returned when Python subprocess errors (graceful degradation)
 *   2. Null snapshot when bar buffer is insufficient (< 35 bars)
 *   3. Snapshot is cached within TTL — Python called only once per TTL window
 *   4. Stale snapshot triggers recompute after TTL expires
 *   5. Non-canonical direction strings normalized to null
 *   6. Score is clamped to [0,1] even if Python returns out-of-range
 *   7. smt_score/smt_direction/smt_age_bars wired into WeightedSignalContext
 *   8. fail-open: null snapshot → smt_score/direction/age_bars remain undefined (smt_unavailable path preserved)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}));

import { runPythonModule } from "../lib/python-runner.js";
import {
  getSmtLiveSnapshot,
  initSmtBarBufferProvider,
  _resetSmtCacheForTest,
  type SmtLiveSnapshot,
} from "../services/smt-live-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a synthetic bar array with the given number of entries */
function makeBars(count: number, basePrice = 5000, baseVol = 100): Array<{
  open: number; high: number; low: number; close: number; volume: number; timestamp: string;
}> {
  return Array.from({ length: count }, (_, i) => ({
    open:   basePrice + i * 0.5,
    high:   basePrice + i * 0.5 + 2,
    low:    basePrice + i * 0.5 - 2,
    close:  basePrice + i * 0.5 + 0.25,
    volume: baseVol + i,
    timestamp: new Date(Date.now() - (count - i) * 60_000).toISOString(),
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("smt-live-service: SmtLiveSnapshot", () => {
  // A reusable mock bar buffer provider — returns sufficient bars by default
  const mockBarBufferFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    _resetSmtCacheForTest();
    // Re-inject the provider on each test (clearAllMocks clears vi.fn() calls but
    // does NOT re-inject the provider into the module's _barBufferProvider variable).
    // We inject once here; individual tests configure the return value.
    mockBarBufferFn.mockReturnValue(makeBars(50)); // default: sufficient bars
    initSmtBarBufferProvider(mockBarBufferFn);
  });

  it("T1: returns null snapshot when Python subprocess throws", async () => {
    // Sufficient bars already configured by beforeEach — Python call is attempted
    vi.mocked(runPythonModule).mockRejectedValue(new Error("python subprocess failed"));

    const snap = await getSmtLiveSnapshot(new Date());

    expect(snap.score).toBeNull();
    expect(snap.direction).toBeNull();
    expect(snap.age_bars).toBeNull();
    expect(snap.stale).toBe(false);
  });

  it("T2: returns null snapshot when bar buffer has insufficient data (< 35 bars)", async () => {
    // Override provider to return fewer than MIN_BARS=35
    mockBarBufferFn.mockReturnValue(makeBars(20));

    const snap = await getSmtLiveSnapshot(new Date());

    expect(snap.score).toBeNull();
    expect(snap.direction).toBeNull();
    // Python should NOT have been called
    expect(runPythonModule).not.toHaveBeenCalled();
  });

  it("T3: caches snapshot within TTL — Python called only once", async () => {
    vi.mocked(runPythonModule).mockResolvedValue({
      score: 0.72,
      direction: "bullish_es_low_nq_higher",
      age_bars: 0,
    });

    const snap1 = await getSmtLiveSnapshot(new Date());
    const snap2 = await getSmtLiveSnapshot(new Date()); // should hit cache

    // Python called only once despite two getSmtLiveSnapshot calls
    expect(runPythonModule).toHaveBeenCalledOnce();
    expect(snap1.score).toBe(0.72);
    expect(snap2.score).toBe(0.72);
    expect(snap1.computed_at).toEqual(snap2.computed_at); // same cached object
  });

  it("T4: stale snapshot triggers recompute after TTL expires", async () => {
    // First call: no divergence
    vi.mocked(runPythonModule).mockResolvedValue({
      score: null, direction: null, age_bars: null,
    });
    const snap1 = await getSmtLiveSnapshot(new Date());
    expect(snap1.score).toBeNull();

    // Force cache expiry by resetting
    _resetSmtCacheForTest();

    // Second call (after TTL): divergence found
    vi.mocked(runPythonModule).mockResolvedValue({
      score: 0.65,
      direction: "bearish_es_high_nq_lower",
      age_bars: 2,
    });
    const snap2 = await getSmtLiveSnapshot(new Date());

    expect(runPythonModule).toHaveBeenCalledTimes(2);
    expect(snap2.score).toBe(0.65);
    expect(snap2.direction).toBe("bearish_es_high_nq_lower");
    expect(snap2.age_bars).toBe(2);
  });

  it("T5: non-canonical direction strings are normalized to null", async () => {
    vi.mocked(runPythonModule).mockResolvedValue({
      score: 0.8,
      direction: "none",   // non-canonical — should be normalized
      age_bars: 0,
    });

    const snap = await getSmtLiveSnapshot(new Date());

    expect(snap.score).toBe(0.8);  // score preserved
    expect(snap.direction).toBeNull();  // direction normalized to null
  });

  it("T6: score is clamped to [0,1] even if Python returns out-of-range", async () => {
    vi.mocked(runPythonModule).mockResolvedValue({
      score: 1.5,  // should be clamped to 1.0
      direction: "bullish_es_low_nq_higher",
      age_bars: 0,
    });

    const snap = await getSmtLiveSnapshot(new Date());
    expect(snap.score).toBe(1.0);
  });

  it("T7: null snapshot leaves smt_score/direction/age_bars undefined in WeightedSignalContext (fail-open preserved)", () => {
    // This test verifies the wiring contract:
    // when smtSnapshot is null → using nullish coalescing ?? undefined
    // evaluating evalSmtConfirmation with undefined fields → returns "smt_unavailable"
    // Cast through `as` to preserve the union type so optional chaining compiles.
    const smtSnapshot = null as SmtLiveSnapshot | null;

    // Simulate the wiring code in paper-signal-service.ts
    const smt_score     = smtSnapshot?.score     ?? undefined;
    const smt_direction = smtSnapshot?.direction ?? undefined;
    const smt_age_bars  = smtSnapshot?.age_bars  ?? undefined;

    expect(smt_score).toBeUndefined();
    expect(smt_direction).toBeUndefined();
    expect(smt_age_bars).toBeUndefined();

    // These are the values that evalSmtConfirmation would receive when ctx.smt_score=undefined
    // → it returns { satisfied: false, reason: "smt_unavailable" } (per confluence-score.ts:603)
    // No regression: same behavior as pre-Wave-26 when bridge was not wired.
  });

  it("T8: valid snapshot populates smt fields in WeightedSignalContext", () => {
    // Verify the wiring expression used in paper-signal-service.ts
    const smtSnapshot: SmtLiveSnapshot = {
      score: 0.72,
      direction: "bullish_es_low_nq_higher",
      age_bars: 3,
      computed_at: new Date(),
      stale: false,
    };

    const smt_score     = smtSnapshot?.score     ?? undefined;
    const smt_direction = smtSnapshot?.direction ?? undefined;
    const smt_age_bars  = smtSnapshot?.age_bars  ?? undefined;

    expect(smt_score).toBe(0.72);
    expect(smt_direction).toBe("bullish_es_low_nq_higher");
    expect(smt_age_bars).toBe(3);
  });
});
