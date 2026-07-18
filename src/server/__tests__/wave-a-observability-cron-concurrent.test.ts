/**
 * wave-a-observability-cron-concurrent.test.ts
 *
 * Fix 4 — cronJobsConcurrent Gauge wiring in scheduler.ts withRetry
 *
 * Verifies:
 *   1. metrics-registry.ts exports the cronJobsConcurrent symbol
 *   2. scheduler.ts imports cronJobsConcurrent from metrics-registry
 *   3. withRetry in scheduler.ts calls .inc() at entry and .dec() in a finally block
 *   4. A synthetic cron handler driven through an analogous inc/dec pattern
 *      correctly increments + decrements even on success and on error paths
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const BASE = resolve(import.meta.dirname ?? ".", "../../..");

describe("metrics-registry.ts — cronJobsConcurrent export", () => {
  it("exports cronJobsConcurrent as a named symbol", () => {
    const src = readFileSync(resolve(BASE, "src/server/lib/metrics-registry.ts"), "utf8");
    expect(src).toContain("export const cronJobsConcurrent");
    expect(src).toContain("tf_cron_jobs_concurrent");
  });

  it("cronJobsConcurrent is a Gauge (not Counter or Histogram)", () => {
    const src = readFileSync(resolve(BASE, "src/server/lib/metrics-registry.ts"), "utf8");
    // Should be 'new Gauge({' within a few lines of the cronJobsConcurrent declaration
    const idx = src.indexOf("export const cronJobsConcurrent");
    expect(idx).toBeGreaterThan(-1);
    const snippet = src.slice(idx, idx + 200);
    expect(snippet).toContain("new Gauge({");
  });
});

describe("scheduler.ts — cronJobsConcurrent wiring in withRetry", () => {
  it("imports cronJobsConcurrent from metrics-registry", () => {
    const src = readFileSync(resolve(BASE, "src/server/scheduler.ts"), "utf8");
    expect(src).toMatch(/import.*cronJobsConcurrent.*from.*metrics-registry/);
  });

  it("withRetry calls cronJobsConcurrent.inc() before the retry loop", () => {
    const src = readFileSync(resolve(BASE, "src/server/scheduler.ts"), "utf8");
    const fnStart = src.indexOf("async function withRetry(");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, fnStart + 2500);
    expect(fnBody).toContain("cronJobsConcurrent.inc()");
  });

  it("withRetry calls cronJobsConcurrent.dec() inside a finally block", () => {
    const src = readFileSync(resolve(BASE, "src/server/scheduler.ts"), "utf8");
    const fnStart = src.indexOf("async function withRetry(");
    // A pre-existing commit added a DLQ-capture + databento-specific alert block to
    // the try{} body, pushing finally{} past the original 2500-char window — widen the slice.
    const fnBody = src.slice(fnStart, fnStart + 4000);
    expect(fnBody).toMatch(/finally\s*\{[\s\S]{0,100}cronJobsConcurrent\.dec\(\)/);
  });
});

describe("cronJobsConcurrent gauge — symmetric inc/dec contract (unit simulation)", () => {
  /**
   * Simulates the withRetry gauge contract using a plain counter to verify
   * that inc() and dec() balance correctly across all exit paths:
   *   - success path (returns early)
   *   - all-retries-exhausted path (falls through)
   *   - thrown exception from fn
   */

  let gauge = 0;
  const inc = () => { gauge++; };
  const dec = () => { gauge--; };

  async function simulatedWithRetry(fn: () => Promise<void>): Promise<void> {
    inc();
    try {
      await fn();
    } finally {
      dec();
    }
  }

  beforeEach(() => { gauge = 0; });

  it("gauge returns to 0 after a successful handler", async () => {
    await simulatedWithRetry(async () => { /* no-op success */ });
    expect(gauge).toBe(0);
  });

  it("gauge returns to 0 even if handler throws", async () => {
    try {
      await simulatedWithRetry(async () => { throw new Error("boom"); });
    } catch {
      // withRetry suppresses in production — here we let it propagate for the test
    }
    expect(gauge).toBe(0);
  });

  it("sequential handlers each see gauge = 1 during execution and 0 after", async () => {
    let sawDuringFirst = 0;
    let sawDuringSecond = 0;

    await simulatedWithRetry(async () => { sawDuringFirst = gauge; });
    await simulatedWithRetry(async () => { sawDuringSecond = gauge; });

    expect(sawDuringFirst).toBe(1);
    expect(sawDuringSecond).toBe(1);
    expect(gauge).toBe(0);
  });

  it("peak gauge of two overlapping handlers is 2, then returns to 0", () => {
    let peak = 0;

    inc(); // handler 1 enters
    inc(); // handler 2 enters
    peak = gauge;
    dec(); // handler 1 exits
    dec(); // handler 2 exits

    expect(peak).toBe(2);
    expect(gauge).toBe(0);
  });
});
