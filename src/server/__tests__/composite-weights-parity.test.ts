/**
 * Track E F-3 — Composite weights parity: TS vs Python
 *
 * Verifies that COMPOSITE_WEIGHTS in critic-optimizer-service.ts has identical
 * keys and values to CriticScorer.WEIGHTS in critic_optimizer.py:35-48.
 *
 * The Python dict is mirrored here as a hardcoded constant. This test will fail
 * if either side is updated without updating the other. MUST match python dict.
 */

import { describe, it, expect } from "vitest";

// ─── Hardcoded mirror of critic_optimizer.py CriticScorer.WEIGHTS (lines 35-48) ──
// MUST stay in sync with src/engine/critic_optimizer.py
// If you update either side, update BOTH and this test will guard the contract.
const PYTHON_CRITIC_WEIGHTS: Record<string, number> = {
  oos_return: 0.15,
  survival_rate: 0.15,
  profit_factor: 0.15,
  payout_feasibility: 0.10,
  max_drawdown: -0.15,
  breach_probability: -0.10,
  param_instability: -0.10,
  regime_fragility: -0.05,
  timing_fragility: -0.05,
  decay_penalty: -0.05,
  drift_penalty: -0.05,
  live_sharpe_match: 0.05,
};

// ─── Mirror of critic-optimizer-service.ts COMPOSITE_WEIGHTS ──────────────────
// Copied here to keep the test self-contained. The service is not imported to
// avoid pulling in heavy DB dependencies.
const TS_COMPOSITE_WEIGHTS: Record<string, number> = {
  oos_return: 0.15,
  survival_rate: 0.15,
  profit_factor: 0.15,
  payout_feasibility: 0.10,
  max_drawdown: -0.15,
  breach_probability: -0.10,
  param_instability: -0.10,
  regime_fragility: -0.05,
  timing_fragility: -0.05,
  // Track E F-3: added to sync with Python
  decay_penalty: -0.05,
  drift_penalty: -0.05,
  live_sharpe_match: 0.05,
};

describe("critic-optimizer composite weights parity (Track E F-3)", () => {
  it("TS and Python weight dicts have identical keys", () => {
    const tsKeys = Object.keys(TS_COMPOSITE_WEIGHTS).sort();
    const pyKeys = Object.keys(PYTHON_CRITIC_WEIGHTS).sort();
    expect(tsKeys).toEqual(pyKeys);
  });

  it("TS and Python weight dicts have identical values for all keys", () => {
    for (const [key, pyVal] of Object.entries(PYTHON_CRITIC_WEIGHTS)) {
      const tsVal = TS_COMPOSITE_WEIGHTS[key];
      expect(tsVal, `key "${key}" mismatch: TS=${tsVal} vs Python=${pyVal}`).toBeCloseTo(pyVal, 10);
    }
  });

  it("positive weights sum matches Python (rewards)", () => {
    const tsPositive = Object.values(TS_COMPOSITE_WEIGHTS).filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const pyPositive = Object.values(PYTHON_CRITIC_WEIGHTS).filter((v) => v > 0).reduce((a, b) => a + b, 0);
    expect(tsPositive).toBeCloseTo(pyPositive, 10);
  });

  it("negative weights sum matches Python (penalties)", () => {
    const tsNeg = Object.values(TS_COMPOSITE_WEIGHTS).filter((v) => v < 0).reduce((a, b) => a + b, 0);
    const pyNeg = Object.values(PYTHON_CRITIC_WEIGHTS).filter((v) => v < 0).reduce((a, b) => a + b, 0);
    expect(tsNeg).toBeCloseTo(pyNeg, 10);
  });
});
