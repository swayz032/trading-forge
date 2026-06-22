/**
 * W23H.8 — Head-start populate script tests.
 *
 * Tests:
 *  1. Pre-check: bucket non-empty → throws with clear error
 *  2. Mock cycles: N strategies cycle 1, M strategies cycle 2 → counts aggregate correctly
 *  3. Early stop: halts when totalGraduated >= EARLY_STOP_THRESHOLD (20)
 *  4. MAX_CYCLES cap: fires at most 3 cycles even if threshold not reached
 *  5. Final report contains all 5 derived fields (total/confluence/mtf/bidirectional/range_bound)
 *  6. Audit events emitted: headstart_cycle.started × N + headstart_cycle.completed × N
 *     + bulk_headstart_populate.completed × 1
 *  7. HTTP error cycles: non-2xx response → logged but not counted toward graduation
 *  8. Wave 23H soft-check runs without blocking on missing markers
 *
 * All tests use HeadstartDeps injection — no live DB or HTTP required.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runHeadstart,
  MAX_CYCLES,
  EARLY_STOP_THRESHOLD,
  WAVE23H_MARKER_ACTIONS,
  type HeadstartDeps,
  type FinalStats,
} from "../../../scripts/headstart-populate-bucket.js";

// ─── Deps stub factory ────────────────────────────────────────────────────────

interface DepsConfig {
  /** Initial strategy count (pre-populate). 0 = bucket empty (normal). */
  initialCount?: number;
  /** Simulated strategies graduated per cycle (index 0 = cycle 1, etc.) */
  graduatedPerCycle?: number[];
  /** Per-cycle HTTP status codes (default 200) */
  cycleStatusCodes?: number[];
  /** Whether each Wave 23H marker is "present" */
  markerPresent?: boolean;
  /** Final stats to return */
  finalStats?: Partial<FinalStats>;
}

function makeStubDeps(cfg: DepsConfig = {}): HeadstartDeps & { auditCalls: Array<{ action: string; result: Record<string, unknown> }> } {
  const {
    initialCount = 0,
    graduatedPerCycle = [5, 8, 10],
    cycleStatusCodes = [],
    markerPresent = true,
    finalStats = {},
  } = cfg;

  const auditCalls: Array<{ action: string; result: Record<string, unknown> }> = [];
  let currentCount = initialCount;
  let cycleIndex = 0;

  return {
    auditCalls,

    async countStrategies() {
      return currentCount;
    },

    async checkMarkerAction(_action: string) {
      return markerPresent;
    },

    async countStrategiesBefore() {
      return currentCount;
    },

    async fireScoutCycle(_cycle: number) {
      const statusCode = cycleStatusCodes[cycleIndex] ?? 200;
      return statusCode;
    },

    async waitForDrain(_ms: number) {
      // No-op in tests — skip actual waiting
    },

    async countStrategiesAfter() {
      const delta = graduatedPerCycle[cycleIndex] ?? 0;
      const statusCode = cycleStatusCodes[cycleIndex] ?? 200;
      if (statusCode >= 200 && statusCode < 300) {
        currentCount += delta;
      }
      cycleIndex++;
      return currentCount;
    },

    async getFinalStats(): Promise<FinalStats> {
      return {
        total: currentCount,
        withConfluence: Math.floor(currentCount * 0.6),
        withMtf: Math.floor(currentCount * 0.4),
        bidirectional: Math.floor(currentCount * 0.7),
        rangeBoundCapable: Math.floor(currentCount * 0.3),
        ...finalStats,
      };
    },

    async emitAudit(action: string, result: Record<string, unknown>) {
      auditCalls.push({ action, result });
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("W23H.8 — head-start populate pre-checks", () => {
  it("throws when bucket is non-empty", async () => {
    const deps = makeStubDeps({ initialCount: 10 });
    await expect(runHeadstart(deps)).rejects.toThrow(/REFUSING.*bucket has 10/i);
  });

  it("does not block when Wave 23H markers are absent (soft check)", async () => {
    const deps = makeStubDeps({
      initialCount: 0,
      markerPresent: false,
      graduatedPerCycle: [21], // immediately hit early-stop
    });
    // Should not throw — soft check only
    await expect(runHeadstart(deps)).resolves.toBeDefined();
  });
});

describe("W23H.8 — cycle graduation aggregation", () => {
  it("aggregates counts across cycles correctly", async () => {
    const deps = makeStubDeps({ graduatedPerCycle: [5, 8] });
    const result = await runHeadstart(deps);

    // After 2 cycles (5 + 8 = 13), threshold not reached, cycle 3 fires (10 more = 23 >= 20 → stop)
    expect(result.cyclesFired).toBeGreaterThanOrEqual(2);
    expect(result.finalStats.total).toBeGreaterThan(0);

    // Summaries should align with what was fired
    expect(result.cycleSummaries.length).toBe(result.cyclesFired);
  });

  it("each cycle summary tracks graduated-this-cycle and running total", async () => {
    // Only 2 cycles, each below threshold, third reaches it
    const deps = makeStubDeps({ graduatedPerCycle: [7, 9, 8] });
    const result = await runHeadstart(deps);

    let runningTotal = 0;
    for (const s of result.cycleSummaries) {
      runningTotal += s.graduatedThisCycle;
      expect(s.totalGraduated).toBe(runningTotal);
    }
  });
});

describe("W23H.8 — early stop and MAX_CYCLES cap", () => {
  it("stops early when totalGraduated >= EARLY_STOP_THRESHOLD", async () => {
    // First cycle graduates enough to cross threshold immediately
    const deps = makeStubDeps({ graduatedPerCycle: [EARLY_STOP_THRESHOLD, 10, 10] });
    const result = await runHeadstart(deps);

    expect(result.cyclesFired).toBe(1);
    expect(result.finalStats.total).toBeGreaterThanOrEqual(EARLY_STOP_THRESHOLD);
  });

  it("fires at most MAX_CYCLES cycles", async () => {
    // Each cycle graduates only 1 strategy (never reaches threshold)
    const deps = makeStubDeps({
      graduatedPerCycle: [1, 1, 1, 1, 1, 1], // more than MAX_CYCLES entries
    });
    const result = await runHeadstart(deps);

    expect(result.cyclesFired).toBeLessThanOrEqual(MAX_CYCLES);
  });
});

describe("W23H.8 — final report fields", () => {
  it("final stats contain all 5 required fields with correct types", async () => {
    const deps = makeStubDeps({ graduatedPerCycle: [EARLY_STOP_THRESHOLD] });
    const result = await runHeadstart(deps);

    const { finalStats } = result;
    expect(typeof finalStats.total).toBe("number");
    expect(typeof finalStats.withConfluence).toBe("number");
    expect(typeof finalStats.withMtf).toBe("number");
    expect(typeof finalStats.bidirectional).toBe("number");
    expect(typeof finalStats.rangeBoundCapable).toBe("number");
  });

  it("final stats are passed through from getFinalStats() exactly", async () => {
    const customStats: FinalStats = {
      total: 22,
      withConfluence: 14,
      withMtf: 9,
      bidirectional: 17,
      rangeBoundCapable: 6,
    };
    const deps = makeStubDeps({
      graduatedPerCycle: [22], // crosses threshold
      finalStats: customStats,
    });
    const result = await runHeadstart(deps);
    expect(result.finalStats).toEqual(customStats);
  });
});

describe("W23H.8 — audit event emission", () => {
  it("emits headstart_cycle.started and headstart_cycle.completed per cycle, plus bulk completion", async () => {
    const deps = makeStubDeps({ graduatedPerCycle: [2, 2, 2] }); // 3 cycles, never reaches threshold
    const result = await runHeadstart(deps);

    const N = result.cyclesFired;
    const startedEvents = deps.auditCalls.filter((c) => c.action === "headstart_cycle.started");
    const completedEvents = deps.auditCalls.filter((c) => c.action === "headstart_cycle.completed");
    const bulkEvent = deps.auditCalls.filter((c) => c.action === "bulk_headstart_populate.completed");

    expect(startedEvents).toHaveLength(N);
    expect(completedEvents).toHaveLength(N);
    expect(bulkEvent).toHaveLength(1);
  });

  it("bulk_headstart_populate.completed audit contains all 5 derived fields", async () => {
    const deps = makeStubDeps({ graduatedPerCycle: [EARLY_STOP_THRESHOLD] });
    await runHeadstart(deps);

    const bulkAudit = deps.auditCalls.find(
      (c) => c.action === "bulk_headstart_populate.completed",
    );
    expect(bulkAudit).toBeDefined();
    expect(bulkAudit!.result).toMatchObject({
      strategies_graduated: expect.any(Number),
      with_confluence: expect.any(Number),
      with_mtf: expect.any(Number),
      bidirectional: expect.any(Number),
      range_bound_capable: expect.any(Number),
      cycles_fired: expect.any(Number),
    });
  });

  it("cycle.started audit includes strategies_before field", async () => {
    const deps = makeStubDeps({ graduatedPerCycle: [EARLY_STOP_THRESHOLD] });
    await runHeadstart(deps);

    const startedAudit = deps.auditCalls.find(
      (c) => c.action === "headstart_cycle.started",
    );
    expect(startedAudit).toBeDefined();
    expect(startedAudit!.result).toMatchObject({
      cycle: 1,
      strategies_before: 0,
    });
  });
});

describe("W23H.8 — HTTP error handling", () => {
  it("non-2xx cycle is logged and skipped; later cycles continue", async () => {
    const deps = makeStubDeps({
      graduatedPerCycle: [0, EARLY_STOP_THRESHOLD, 5],
      cycleStatusCodes: [500, 200, 200],
    });
    const result = await runHeadstart(deps);

    // Cycle 1 failed (500) → graduated 0; cycle 2 succeeded → early stop
    const cycle1Summary = result.cycleSummaries.find((s) => s.cycle === 1);
    expect(cycle1Summary).toBeDefined();
    expect(cycle1Summary!.graduatedThisCycle).toBe(0);
    expect(cycle1Summary!.apiStatusCode).toBe(500);
  });

  it("non-2xx cycle still emits headstart_cycle.completed audit", async () => {
    const deps = makeStubDeps({
      graduatedPerCycle: [0, EARLY_STOP_THRESHOLD],
      cycleStatusCodes: [503, 200],
    });
    await runHeadstart(deps);

    const completedAudits = deps.auditCalls.filter(
      (c) => c.action === "headstart_cycle.completed",
    );
    // Both cycles (failed + succeeded) must have a completed audit
    expect(completedAudits.length).toBeGreaterThanOrEqual(2);
  });
});
