/**
 * wave-a-critic-correlation-base.test.ts
 *
 * Wave A Critic Fix 4 — Replay-grade-critique correlation-base determinism suite.
 *
 * Finding MED: `scripts/replay-grade-critique.ts::runCritiqueGradeAnalysis` set
 * `correlationBase = \`replay-critique-\${new Date().toISOString()}\``, embedding
 * a wall-clock timestamp.  Two identical runs on the same dataset produced
 * different correlation IDs, making audit trail de-duplication impossible and
 * preventing replay comparison.
 *
 * Fix: `computeCorrelationBase(positionIds)` returns
 *   sha256(positionIds.sort().join(",")).slice(0, 16)
 * which is purely a function of the input set, not of wall-clock time.
 *
 * The function is exported for testing from the script module.
 * The caller can override via `--correlation-base` CLI flag / `opts.correlationBase`.
 *
 * Tests:
 *   1. Same input twice → identical output
 *   2. Different order → identical output (order-independent)
 *   3. Different input set → different output
 *   4. Empty input → deterministic (not crash)
 *   5. Single ID → deterministic
 *   6. Very large set → 16-char hex output (not longer)
 */

import { describe, it, expect } from "vitest";
// Import from the pure lib module (node:crypto only), NOT from the script,
// to avoid pulling in the Express bootstrap graph via trade-critique-service.ts.
import { computeCorrelationBase } from "../lib/replay/correlation-base.js";

describe("Fix 4 — correlationBase determinism (Finding MED)", () => {
  it("same input twice → identical output", () => {
    const ids = ["pos-a", "pos-b", "pos-c", "pos-d"];
    const base1 = computeCorrelationBase(ids);
    const base2 = computeCorrelationBase(ids);
    expect(base1).toBe(base2);
    expect(base1).toBeTruthy();
    expect(base1.length).toBe(16);
  });

  it("order-independent: shuffled input → same output", () => {
    const ids = ["pos-alpha", "pos-beta", "pos-gamma", "pos-delta", "pos-epsilon"];
    const shuffled = ["pos-epsilon", "pos-alpha", "pos-delta", "pos-beta", "pos-gamma"];
    const base1 = computeCorrelationBase(ids);
    const base2 = computeCorrelationBase(shuffled);
    expect(base1).toBe(base2);
  });

  it("different input set → different output", () => {
    const idsA = ["pos-1", "pos-2", "pos-3"];
    const idsB = ["pos-4", "pos-5", "pos-6"];
    const baseA = computeCorrelationBase(idsA);
    const baseB = computeCorrelationBase(idsB);
    expect(baseA).not.toBe(baseB);
  });

  it("empty input → deterministic non-empty string of length 16", () => {
    const base1 = computeCorrelationBase([]);
    const base2 = computeCorrelationBase([]);
    expect(base1).toBe(base2);
    expect(base1.length).toBe(16);
  });

  it("single ID → deterministic", () => {
    const base1 = computeCorrelationBase(["only-one-pos"]);
    const base2 = computeCorrelationBase(["only-one-pos"]);
    expect(base1).toBe(base2);
    expect(base1.length).toBe(16);
  });

  it("output is always exactly 16 hex chars regardless of input size", () => {
    for (const size of [0, 1, 5, 50, 500]) {
      const ids = Array.from({ length: size }, (_, i) => `pos-${i}`);
      const base = computeCorrelationBase(ids);
      expect(base.length).toBe(16);
      expect(/^[0-9a-f]{16}$/.test(base)).toBe(true);
    }
  });

  it("adding a single ID to the set changes the output", () => {
    const base = ["pos-a", "pos-b"];
    const extended = ["pos-a", "pos-b", "pos-c"];
    expect(computeCorrelationBase(base)).not.toBe(computeCorrelationBase(extended));
  });

  it("does NOT embed current time: two calls with same input have identical output even at different times", () => {
    // This is the core regression test for the Finding #4 bug.
    // We can't control clock time in tests, but we can verify the function
    // output is purely deterministic over multiple calls within this test run.
    const ids = ["trade-uuid-1", "trade-uuid-2", "trade-uuid-3"];
    const results = Array.from({ length: 10 }, () => computeCorrelationBase(ids));
    const allSame = results.every(r => r === results[0]);
    expect(allSame).toBe(true);
  });
});
