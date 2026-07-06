/**
 * Deep-Scan #21 Wave 2 — Fix 1: SSE catalog drift regression test.
 *
 * Band D of deep-scan #21 found 6 SSE events broadcast in production code via
 * broadcastSSE("<literal>", ...) that were NOT registered in their nominal
 * *_EVENTS catalog constant in src/server/routes/sse.ts:
 *
 *   pine:export-completed              — pine-export-service.ts, missing from PINE_EVENTS
 *   pine:export-failed                 — pine-export-service.ts, missing from PINE_EVENTS
 *   lifecycle:dsl_guards_evaluated      — lifecycle-service.ts, missing from LIFECYCLE_GATE_EVENTS
 *   factory:candidate_backtest_enqueued — candidate-backtest-conveyor-service.ts, missing from FACTORY_EVENTS
 *   archetype:predicted                 — scheduler.ts, missing from ARCHETYPE_ROUTING_EVENTS
 *   lifecycle:auto-check                 — scheduler.ts, missing from LIFECYCLE_GATE_EVENTS
 *   lifecycle:gate_evaluated              — scheduler.ts, missing from LIFECYCLE_GATE_EVENTS
 *   lifecycle:operator_absent_autopromoted — operator-absent-mode-service.ts, missing from LIFECYCLE_GATE_EVENTS
 *
 * (That's 8 distinct literals across the 6 "emitters" named in the deep-scan
 * finding — pine has 2 event names from 1 emitter file, lifecycle has 4 event
 * names across 3 emitter files.)
 *
 * A catalog constant that silently omits an event name means any dashboard or
 * query built against the catalog (rather than grepping broadcastSSE call
 * sites directly) misses that event with zero warning. This test pins the
 * fix: every one of the 8 literals above must now resolve through its
 * catalog constant.
 *
 * This test does NOT change emit behavior — it only verifies the catalog
 * registration that Wave 2 added.
 */

import { describe, it, expect } from "vitest";

describe("Deep-Scan #21 Wave 2 Fix 1 — SSE catalog drift closed", () => {
  it("PINE_EVENTS registers both pine-export-service.ts broadcast literals", async () => {
    const { PINE_EVENTS } = await import("../routes/sse.js");
    expect(PINE_EVENTS.EXPORT_COMPLETED).toBe("pine:export-completed");
    expect(PINE_EVENTS.EXPORT_FAILED).toBe("pine:export-failed");
  });

  it("LIFECYCLE_GATE_EVENTS registers the 4 previously-uncataloged lifecycle broadcasts", async () => {
    const { LIFECYCLE_GATE_EVENTS } = await import("../routes/sse.js");
    expect(LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED).toBe("lifecycle:dsl_guards_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.AUTO_CHECK).toBe("lifecycle:auto-check");
    expect(LIFECYCLE_GATE_EVENTS.GATE_EVALUATED).toBe("lifecycle:gate_evaluated");
    expect(LIFECYCLE_GATE_EVENTS.OPERATOR_ABSENT_AUTOPROMOTED).toBe("lifecycle:operator_absent_autopromoted");
  });

  it("FACTORY_EVENTS registers the candidate-backtest-conveyor broadcast literal", async () => {
    const { FACTORY_EVENTS } = await import("../routes/sse.js");
    expect(FACTORY_EVENTS.CANDIDATE_BACKTEST_ENQUEUED).toBe("factory:candidate_backtest_enqueued");
  });

  it("ARCHETYPE_ROUTING_EVENTS registers the scheduler.ts day-archetype prediction broadcast literal", async () => {
    const { ARCHETYPE_ROUTING_EVENTS } = await import("../routes/sse.js");
    expect(ARCHETYPE_ROUTING_EVENTS.PREDICTED).toBe("archetype:predicted");
  });

  it("all 8 previously-uncataloged literal strings appear verbatim as broadcastSSE() call-site literals in source", async () => {
    // Belt-and-suspenders: re-derive the literal strings straight from the
    // emitter source files (independent of the catalog constants) so this
    // test cannot pass merely because the catalog and the test both typo the
    // same wrong string.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(thisDir, "..", "..", "..");

    const readSrc = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

    const pineExportSrc = readSrc("src/server/services/pine-export-service.ts");
    expect(pineExportSrc).toContain('broadcastSSE("pine:export-completed"');
    expect(pineExportSrc).toContain('broadcastSSE("pine:export-failed"');

    const lifecycleServiceSrc = readSrc("src/server/services/lifecycle-service.ts");
    expect(lifecycleServiceSrc).toContain('broadcastSSE("lifecycle:dsl_guards_evaluated"');

    const schedulerSrc = readSrc("src/server/scheduler.ts");
    expect(schedulerSrc).toContain('broadcastSSE("lifecycle:auto-check"');
    expect(schedulerSrc).toContain('broadcastSSE("lifecycle:gate_evaluated"');
    expect(schedulerSrc).toContain('broadcastSSE("archetype:predicted"');

    const candidateConveyorSrc = readSrc("src/server/services/candidate-backtest-conveyor-service.ts");
    expect(candidateConveyorSrc).toContain('broadcastSSE("factory:candidate_backtest_enqueued"');

    const operatorAbsentSrc = readSrc("src/server/services/operator-absent-mode-service.ts");
    expect(operatorAbsentSrc).toContain('broadcastSSE("lifecycle:operator_absent_autopromoted"');
  });

  it("catalog constants remain readonly (const assertion) after the additions", async () => {
    const { PINE_EVENTS, LIFECYCLE_GATE_EVENTS, FACTORY_EVENTS, ARCHETYPE_ROUTING_EVENTS } = await import("../routes/sse.js");
    // TS `as const` gives compile-time readonly; runtime object is still a
    // plain object unless frozen. This just pins that the new keys exist as
    // own-enumerable string properties (not inherited / not accidentally
    // functions), matching the shape of every pre-existing entry.
    for (const [cat, key] of [
      [PINE_EVENTS, "EXPORT_COMPLETED"],
      [PINE_EVENTS, "EXPORT_FAILED"],
      [LIFECYCLE_GATE_EVENTS, "DSL_GUARDS_EVALUATED"],
      [LIFECYCLE_GATE_EVENTS, "AUTO_CHECK"],
      [LIFECYCLE_GATE_EVENTS, "GATE_EVALUATED"],
      [LIFECYCLE_GATE_EVENTS, "OPERATOR_ABSENT_AUTOPROMOTED"],
      [FACTORY_EVENTS, "CANDIDATE_BACKTEST_ENQUEUED"],
      [ARCHETYPE_ROUTING_EVENTS, "PREDICTED"],
    ] as const) {
      expect(Object.prototype.hasOwnProperty.call(cat, key)).toBe(true);
      expect(typeof (cat as Record<string, unknown>)[key]).toBe("string");
    }
  });
});
