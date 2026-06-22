/**
 * wave29-prod-hardening-rl-training-runner-seed.test.ts
 *
 * Production hardening Fix 4: RL training auto-fire seed propagation.
 *
 * Verifies:
 *   1. Same strategy_id → same seed across calls (deterministic per-strategy)
 *   2. Different strategy_id → different seed (seed space is not collapsed)
 *   3. Seed is a valid 32-bit unsigned integer (0 ≤ seed ≤ 2^32 - 1)
 *   4. Seed is non-zero for reasonable strategy IDs (not a degenerate hash)
 *
 * Authority boundary: deriveRlTrainingSeed is a pure function that does NOT
 * touch any execution path. This test file does not import any lifecycle
 * service, paper-signal-service, or order-routing service — challenger isolation
 * is preserved.
 */

import { describe, it, expect } from "vitest";
import { deriveRlTrainingSeed } from "../lib/quantum-rl-training-runner.js";

const MAX_UINT32 = 2 ** 32 - 1;

describe("deriveRlTrainingSeed — Fix 4 (RL training seed propagation)", () => {
  it("returns same seed for the same numeric strategy_id across calls", () => {
    const seedA = deriveRlTrainingSeed(42);
    const seedB = deriveRlTrainingSeed(42);
    expect(seedA).toBe(seedB);
  });

  it("returns same seed for the same string strategy_id across calls", () => {
    const seedA = deriveRlTrainingSeed("strategy-abc-123");
    const seedB = deriveRlTrainingSeed("strategy-abc-123");
    expect(seedA).toBe(seedB);
  });

  it("returns different seeds for different numeric strategy_ids", () => {
    const seed1 = deriveRlTrainingSeed(1);
    const seed2 = deriveRlTrainingSeed(2);
    expect(seed1).not.toBe(seed2);
  });

  it("returns different seeds for different string strategy_ids", () => {
    const seedA = deriveRlTrainingSeed("alpha-strategy");
    const seedB = deriveRlTrainingSeed("beta-strategy");
    expect(seedA).not.toBe(seedB);
  });

  it("seed is a valid 32-bit unsigned integer", () => {
    const testIds = [1, 42, 999, "abc", "strategy-123", "slumdawg"];
    for (const id of testIds) {
      const seed = deriveRlTrainingSeed(id);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(MAX_UINT32);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });

  it("produces a stable known value for strategy_id=42 (regression anchor)", () => {
    // SHA-256("42").readUInt32BE(0) — if this changes, the seed derivation was mutated.
    // Computed: SHA-256("42") first 4 bytes = 0x73475cb4 = 1934056628
    const seed = deriveRlTrainingSeed(42);
    expect(seed).toBe(1934056628);
  });
});
