/**
 * deterministic-rng.ts — M2 determinism + durability (2026-07-17)
 *
 * Hash-seeded deterministic uniform draw, replacing `Math.random()` in the
 * paper fill model (paper-execution-service.ts latency drift + fill-probability
 * miss gate). Pure, no deps, no I/O, no wall-clock — same inputs always produce
 * the same draw, uniform on [0,1).
 *
 * WHY: Math.random() made the SAME market tape produce DIFFERENT fills on every
 * run — paper evidence was not replayable, and two runs of the same strategy
 * disagreed on P&L. Under D6/D7 the paper engine is promotion-evidence
 * authority, so replay-determinism is a real requirement, not a nicety.
 *
 * SCOPE: this file changes ONLY the randomness source. It does NOT touch any
 * fill-model math (latencyFactor formula, fillProb threshold) — those stay
 * byte-identical; only where the uniform draw comes from changes.
 *
 * ALGORITHM: xmur3 string hash (Bryc / public domain) feeds a 32-bit seed into
 * mulberry32 (Tommy Ettinger, public domain) — a small, well-known, statistically
 * uniform PRNG pairing with no external dependency. A single draw is taken per
 * call, so "same inputs -> same draw" holds trivially: the function IS the
 * composition seed-derivation -> one mulberry32 step.
 */

/** xmur3 — hashes an arbitrary string into a 32-bit seed generator function. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 — a fast, small, statistically-uniform 32-bit PRNG. Returns [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic uniform draw in [0, 1) from an arbitrary list of
 * identity parts (session id, order/position id, bar timestamp, fill-model
 * version, a site tag distinguishing which call site the draw is for, ...).
 *
 * Same `parts` (in the same order) always yields the same draw. Different
 * `siteTag`/parts yield an independent-looking draw even for the same
 * underlying order — two draws for the same fill (e.g. latency-drift AND
 * fill-probability-miss) must not be correlated with each other, so callers
 * MUST include a distinct siteTag per draw.
 */
export function seededUniformDraw(parts: Array<string | number | null | undefined>): number {
  const seedStr = parts.map((p) => (p == null ? "" : String(p))).join("|");
  const hashSeed = xmur3(seedStr)();
  const rand = mulberry32(hashSeed);
  return rand();
}
