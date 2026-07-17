/**
 * deterministic-rng-replay.test.ts — M2 determinism + durability (2026-07-17), Item 2
 *
 * Proves the deterministic hash-seeded uniform draw that replaced BOTH
 * `Math.random()` sites in paper-execution-service.ts (latency drift :569,
 * fill-probability miss :1929 pre-M2 line numbers):
 *   1. seededUniformDraw() is a pure deterministic function: same inputs ->
 *      same draw, every time.
 *   2. Distinct siteTag/identity -> independent-looking draws (latency-drift
 *      and fill-prob-miss for the SAME order never correlate).
 *   3. The draw is uniform on [0,1) — range bound + distribution sanity
 *      (mean, stddev, bucket coverage) over many seeds.
 *   4. applyLatency() — the real production function, now exported for this
 *      test — replays the SAME tape (identical inputs) twice and produces a
 *      BYTE-IDENTICAL result (replay-determinism), and a DIFFERENT tape
 *      (any one seed part changed) produces a different drift.
 *   5. Structural regression guard: no Math.random() anywhere in
 *      paper-execution-service.ts (the exact class of bug this wave closes —
 *      if a future edit reintroduces it, this test goes RED).
 *
 * SCOPE: this test does NOT touch or assert on the fill-model MATH
 * (latencyFactor formula, fillProb threshold) — those are byte-identical
 * pre/post M2. It asserts ONLY on the randomness source's determinism +
 * uniformity, per the ratify packet's scope lock.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { seededUniformDraw } from "../lib/deterministic-rng.js";

// paper-execution-service.ts imports `db` from "../db/index.js", which throws
// at module-load time when DATABASE_URL is unset (real DB connection guard).
// applyLatency() itself is pure (no DB access) — mock only the DB boundary so
// the module can be imported for this unit test, same minimal pattern proven
// by paper-execution-service-deepscan-findings.test.ts (20/21 passing there).
vi.mock("../db/index.js", () => ({ db: {} }));
// Short-circuits the scheduler -> index.js -> full Express bootstrap chain
// (LifecycleService, routes, boot-migration-runner, etc.) that paper-execution-
// service.ts pulls in transitively via a few of its ~40 imports.
vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));
vi.mock("../index.js", () => ({}));
vi.mock("../services/paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn(() => "2026-07-17"),
  toFuturesTradingDayString: vi.fn(() => "2026-07-17"),
  invalidateDailyLossCache: vi.fn(),
}));

const { applyLatency } = await import("../services/paper-execution-service.js");
type FillModelSeedIdentity = { sessionId: string; orderIntentId: string; barTimestamp: string; fillModelVersion: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAPER_EXECUTION_SRC = readFileSync(
  resolve(__dirname, "../services/paper-execution-service.ts"),
  "utf8",
);

describe("seededUniformDraw — determinism", () => {
  it("same inputs -> same draw, called twice", () => {
    const parts = ["session-abc", "order-123", "2026-07-17T14:00:00.000Z", "v1", "latency_drift", "MES"];
    const a = seededUniformDraw(parts);
    const b = seededUniformDraw(parts);
    expect(a).toBe(b);
  });

  it("same inputs -> same draw across MANY repeated calls (not a fluke of two)", () => {
    const parts = ["session-xyz", "order-789", "2026-07-17T09:30:00.000Z", "v1", "fill_prob_miss", "MNQ"];
    const draws = Array.from({ length: 50 }, () => seededUniformDraw(parts));
    expect(new Set(draws).size).toBe(1);
  });

  it("a different siteTag for the SAME order produces an independent-looking draw (no cross-site correlation)", () => {
    const base = ["session-1", "order-1", "2026-07-17T10:00:00.000Z", "v1"];
    const latencyDraw = seededUniformDraw([...base, "latency_drift", "MES"]);
    const fillMissDraw = seededUniformDraw([...base, "fill_prob_miss", "MES"]);
    expect(latencyDraw).not.toBe(fillMissDraw);
  });

  it("a different sessionId produces a different draw", () => {
    const a = seededUniformDraw(["session-A", "order-1", "2026-07-17T10:00:00.000Z", "v1", "latency_drift", "MES"]);
    const b = seededUniformDraw(["session-B", "order-1", "2026-07-17T10:00:00.000Z", "v1", "latency_drift", "MES"]);
    expect(a).not.toBe(b);
  });

  it("a different barTimestamp produces a different draw", () => {
    const a = seededUniformDraw(["session-1", "order-1", "2026-07-17T10:00:00.000Z", "v1", "latency_drift", "MES"]);
    const b = seededUniformDraw(["session-1", "order-1", "2026-07-17T10:00:01.000Z", "v1", "latency_drift", "MES"]);
    expect(a).not.toBe(b);
  });

  it("handles null/undefined parts without throwing", () => {
    expect(() => seededUniformDraw(["a", null, undefined, 5, "b"])).not.toThrow();
  });
});

describe("seededUniformDraw — uniform on [0,1) (distribution sanity)", () => {
  const N = 5000;
  const draws = Array.from({ length: N }, (_, i) =>
    seededUniformDraw(["session-dist", `order-${i}`, "2026-07-17T00:00:00.000Z", "v1", "latency_drift", "MES"]),
  );

  it("every draw is within [0, 1)", () => {
    for (const d of draws) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1);
    }
  });

  it("mean is close to 0.5 (uniform expectation)", () => {
    const mean = draws.reduce((a, b) => a + b, 0) / N;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
  });

  it("stddev is close to the uniform-distribution theoretical value (1/sqrt(12) ~= 0.2887)", () => {
    const mean = draws.reduce((a, b) => a + b, 0) / N;
    const variance = draws.reduce((acc, d) => acc + (d - mean) ** 2, 0) / N;
    const stddev = Math.sqrt(variance);
    expect(stddev).toBeGreaterThan(0.26);
    expect(stddev).toBeLessThan(0.31);
  });

  it("covers all 10 deciles roughly evenly (no bucket empty, none wildly overrepresented)", () => {
    const buckets = new Array(10).fill(0);
    for (const d of draws) {
      const idx = Math.min(9, Math.floor(d * 10));
      buckets[idx]++;
    }
    const expected = N / 10;
    for (const count of buckets) {
      // Loose tolerance — this is a sanity check, not a rigorous chi-square test.
      expect(count).toBeGreaterThan(expected * 0.5);
      expect(count).toBeLessThan(expected * 1.5);
    }
  });
});

describe("applyLatency — replay-determinism (same tape twice -> byte-identical)", () => {
  const seedIdentity: FillModelSeedIdentity = {
    sessionId: "replay-session-1",
    orderIntentId: "replay-order-1",
    barTimestamp: "2026-07-17T13:45:00.000Z",
    fillModelVersion: "v1-deterministic-rng",
  };

  it("processing the SAME tape twice produces a BYTE-IDENTICAL result", () => {
    const run1 = applyLatency(5800, "MES", 150, 4.2, seedIdentity);
    const run2 = applyLatency(5800, "MES", 150, 4.2, seedIdentity);
    expect(run1).toBe(run2);
  });

  it("many replays of the same tape all agree (not lucky-twice)", () => {
    const results = Array.from({ length: 20 }, () => applyLatency(5800, "MES", 150, 4.2, seedIdentity));
    expect(new Set(results).size).toBe(1);
  });

  it("a DIFFERENT tape (different barTimestamp) produces a different drift", () => {
    const run1 = applyLatency(5800, "MES", 150, 4.2, seedIdentity);
    const run2 = applyLatency(5800, "MES", 150, 4.2, { ...seedIdentity, barTimestamp: "2026-07-17T13:46:00.000Z" });
    expect(run1).not.toBe(run2);
  });

  it("a DIFFERENT order on the same session+bar produces a different drift (no cross-order correlation)", () => {
    const run1 = applyLatency(5800, "MES", 150, 4.2, seedIdentity);
    const run2 = applyLatency(5800, "MES", 150, 4.2, { ...seedIdentity, orderIntentId: "replay-order-2" });
    expect(run1).not.toBe(run2);
  });

  it("drift stays bounded by atr * latencyFactor (math UNCHANGED — only randomness source changed)", () => {
    const atr = 4.2;
    const latencyMs = 150;
    const latencyFactor = (latencyMs / 1000) * 0.1;
    const maxDrift = atr * latencyFactor;
    const result = applyLatency(5800, "MES", latencyMs, atr, seedIdentity);
    const drift = result - 5800;
    expect(Math.abs(drift)).toBeLessThanOrEqual(maxDrift + 1e-9);
  });

  it("zero latency short-circuits to signalPrice unchanged (unchanged early-return math)", () => {
    expect(applyLatency(5800, "MES", 0, 4.2, seedIdentity)).toBe(5800);
  });

  it("missing/zero atr short-circuits to signalPrice unchanged (unchanged early-return math)", () => {
    expect(applyLatency(5800, "MES", 150, undefined, seedIdentity)).toBe(5800);
    expect(applyLatency(5800, "MES", 150, 0, seedIdentity)).toBe(5800);
  });
});

describe("structural regression guard — no Math.random() in the paper fill model", () => {
  it("paper-execution-service.ts contains zero live Math.random() call sites", () => {
    // Strip comment lines first so historical comments mentioning "Math.random()"
    // (e.g. this wave's own M2 migration notes) don't produce a false positive.
    const codeOnly = PAPER_EXECUTION_SRC
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(codeOnly).not.toMatch(/Math\.random\(\)/);
  });

  it("both former Math.random() sites now route through seededUniformDraw", () => {
    expect(PAPER_EXECUTION_SRC).toContain("seededUniformDraw([");
    expect(PAPER_EXECUTION_SRC).toContain('"latency_drift"');
    expect(PAPER_EXECUTION_SRC).toContain('"fill_prob_miss"');
  });

  it("the fill-model MATH (latencyFactor formula, fillProb miss threshold) is unchanged", () => {
    expect(PAPER_EXECUTION_SRC).toContain("(latencyMs / 1000) * 0.1");
    expect(PAPER_EXECUTION_SRC).toContain("fillMissDraw > fillProb");
  });
});
