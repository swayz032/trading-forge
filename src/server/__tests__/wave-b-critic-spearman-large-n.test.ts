/**
 * Wave B LOW-1 — Spearman large-n stack-overflow regression tests
 *
 * Verifies that computeSpearman() does NOT throw RangeError on arrays
 * > ~10k elements. The pre-fix implementation used Math.min(...x) /
 * Math.max(...x) spread syntax, which exhausts the V8 call-stack for
 * n >= ~10,000. The fix replaces these with explicit for-loops.
 *
 * Correctness cross-check: a small (n=200) subset is compared against a
 * naive O(n²) rank-sort implementation to verify the fix did not alter
 * the numerical result.
 */

import { describe, it, expect } from "vitest";
import { computeSpearman } from "../lib/replay/quantum-disagreement.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seeded pseudo-random generator (LCG) — deterministic, no external deps. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffff_ffff;
  };
}

/** Build two correlated float arrays of length n. */
function makeCorrelatedArrays(
  n: number,
  rng: () => number,
  noiseScale = 0.3,
): [number[], number[]] {
  const base = Array.from({ length: n }, () => rng());
  const x = base.map((v) => v + noiseScale * (rng() - 0.5));
  const y = base.map((v) => v + noiseScale * (rng() - 0.5));
  return [x, y];
}

/**
 * Naive O(n²) Spearman via explicit sorted-rank + d² formula.
 * Used only on small slices as a correctness oracle.
 */
function naiveSpearman(x: number[], y: number[]): number {
  const n = x.length;

  function rank(arr: number[]): number[] {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array<number>(n);
    for (let i = 0; i < n; i++) r[sorted[i].i] = i + 1;
    return r;
  }

  const rx = rank(x);
  const ry = rank(y);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeSpearman — large-n stack-overflow regression (Wave B LOW-1)", () => {
  it("does NOT throw on n=10_000", () => {
    const rng = makeRng(42);
    const [x, y] = makeCorrelatedArrays(10_000, rng);
    expect(() => computeSpearman(x, y)).not.toThrow();
  });

  it("does NOT throw on n=50_000", () => {
    const rng = makeRng(77);
    const [x, y] = makeCorrelatedArrays(50_000, rng);
    expect(() => computeSpearman(x, y)).not.toThrow();
  });

  it("does NOT throw on n=100_000", () => {
    const rng = makeRng(99);
    const [x, y] = makeCorrelatedArrays(100_000, rng);
    expect(() => computeSpearman(x, y)).not.toThrow();
  });

  it("returns a valid rho in [-1, 1] for n=10_000", () => {
    const rng = makeRng(123);
    const [x, y] = makeCorrelatedArrays(10_000, rng);
    const { rho, pValue } = computeSpearman(x, y);
    expect(rho).toBeGreaterThanOrEqual(-1);
    expect(rho).toBeLessThanOrEqual(1);
    expect(pValue).toBeGreaterThanOrEqual(0);
    expect(pValue).toBeLessThanOrEqual(1);
  });

  it("large-n rho matches naive implementation on a small overlapping subset", () => {
    // Build n=200 arrays with a known correlation structure and compare
    // computeSpearman() against naiveSpearman(). This cross-check verifies
    // the for-loop min/max replacement did not alter the ranking logic.
    const rng = makeRng(555);
    const [x, y] = makeCorrelatedArrays(200, rng, 0.1);

    const { rho: libRho } = computeSpearman(x, y);
    const naiveRho = naiveSpearman(x, y);

    // Both implementations should agree within floating-point rounding.
    expect(libRho).toBeCloseTo(naiveRho, 8);
  });

  it("returns rho=0 / pValue=1 for a constant array (zero-variance guard)", () => {
    // Zero-variance guard: if x is constant, no monotonic relationship exists.
    const n = 500;
    const x = new Array<number>(n).fill(3.14);
    const y = Array.from({ length: n }, (_, i) => i);
    const { rho, pValue } = computeSpearman(x, y);
    expect(rho).toBe(0);
    expect(pValue).toBe(1.0);
  });

  it("perfectly monotone increasing arrays → rho ≈ 1 (correctness smoke test)", () => {
    const n = 1_000;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = Array.from({ length: n }, (_, i) => i * 2 + 1);
    const { rho } = computeSpearman(x, y);
    expect(rho).toBeCloseTo(1, 5);
  });
});
