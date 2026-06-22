/**
 * Wave B LOW-2 — EQUAL_WEIGHTS_VERSION_ID memoization tests
 *
 * Verifies that:
 *   1. EQUAL_WEIGHTS_VERSION_ID is a 64-char hex string.
 *   2. It equals computeWeightsVersionId(EQUAL_WEIGHTS) exactly.
 *   3. Importing the const twice in the same module scope returns the same
 *      reference (module-level singleton — not re-computed on each import).
 *   4. The 16-char slice used by the aggregator matches what the aggregator
 *      previously computed via computeWeightsVersionId(EQUAL_WEIGHTS).slice(0,16).
 */

import { describe, it, expect } from "vitest";
import {
  EQUAL_WEIGHTS,
  EQUAL_WEIGHTS_VERSION_ID,
  computeWeightsVersionId,
} from "../lib/score-normalization.js";

// ─── Re-import to verify module-singleton behaviour ───────────────────────────

// ES module imports are cached by the runtime — importing a second named export
// from the same module path returns the same binding. We capture the value into
// a second local name to document the intent of the test clearly.
import {
  EQUAL_WEIGHTS_VERSION_ID as EQUAL_WEIGHTS_VERSION_ID_AGAIN,
} from "../lib/score-normalization.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EQUAL_WEIGHTS_VERSION_ID — memoized constant (Wave B LOW-2)", () => {
  it("is a string of exactly 64 characters (full SHA-256 hex)", () => {
    expect(typeof EQUAL_WEIGHTS_VERSION_ID).toBe("string");
    expect(EQUAL_WEIGHTS_VERSION_ID).toHaveLength(64);
  });

  it("contains only lowercase hex characters", () => {
    expect(EQUAL_WEIGHTS_VERSION_ID).toMatch(/^[0-9a-f]{64}$/);
  });

  it("equals computeWeightsVersionId(EQUAL_WEIGHTS) exactly", () => {
    const onDemand = computeWeightsVersionId(EQUAL_WEIGHTS);
    expect(EQUAL_WEIGHTS_VERSION_ID).toBe(onDemand);
  });

  it("re-importing from the same module returns the identical value (module-level singleton)", () => {
    // ES module specifier cache guarantees the module is only evaluated once.
    // Both imports resolve to the same binding; the computation happens once.
    expect(EQUAL_WEIGHTS_VERSION_ID_AGAIN).toBe(EQUAL_WEIGHTS_VERSION_ID);
  });

  it("16-char slice matches the aggregator's stored weights_version_id", () => {
    // The aggregator stores EQUAL_WEIGHTS_VERSION_ID.slice(0, 16) in
    // strategy_health_scores.weights_version_id (Wave 28 Pass A column contract).
    // Verify the slice is stable and non-empty.
    const slice16 = EQUAL_WEIGHTS_VERSION_ID.slice(0, 16);
    expect(slice16).toHaveLength(16);
    expect(slice16).toMatch(/^[0-9a-f]{16}$/);

    // Also confirm it matches what the old call-per-cycle pattern produced.
    const legacy = computeWeightsVersionId(EQUAL_WEIGHTS).slice(0, 16);
    expect(slice16).toBe(legacy);
  });

  it("changes when weights differ (model-change event detection)", () => {
    // If EQUAL_WEIGHTS were ever mutated, the hash should change.
    const altWeights: Record<string, number> = {
      ...EQUAL_WEIGHTS,
      b14_survival_twin: 0.5,   // deliberately different
    };
    const altHash = computeWeightsVersionId(altWeights);
    expect(altHash).not.toBe(EQUAL_WEIGHTS_VERSION_ID);
  });

  it("is deterministic: calling computeWeightsVersionId twice returns same result", () => {
    const h1 = computeWeightsVersionId(EQUAL_WEIGHTS);
    const h2 = computeWeightsVersionId(EQUAL_WEIGHTS);
    expect(h1).toBe(h2);
  });
});
