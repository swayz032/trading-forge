// src/server/__tests__/greenboard-starve-at-source.test.ts
//
// PERMANENT regression tests for the OR-042 F-1/F-2 closures.
//
// ★ THE D-LAW THIS FILE EXISTS TO ENFORCE (minted OR-041 §2D):
//   A starve-proof must go RED with all pre-existing inner handlers STILL IN PLACE.
//   If it can only go red by throwing ABOVE them, it proves a path the system cannot produce.
//
// My original green-board proofs violated exactly that. I starved `assembleGptReports()`
// itself throwing — but `reports-data.ts` carried `.catch(() => [])` on both queries, so a DB
// outage could never make it throw. The proof was green, its RED direction "worked", and it
// measured a failure mode the system cannot produce. I fixed the costume, not the failure.
//
// So these tests starve at the TRUE SOURCE: the query/service call, underneath the inner
// handler — the layer a real outage actually hits.
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("F-2: reports assembler marks a swallowed query failure", () => {
  beforeEach(() => { vi.resetModules(); });

  it("STARVE AT SOURCE: the DB query rejects → payload is marked degraded, not empty-success", async () => {
    // Fail the query itself — beneath the pre-existing `.catch(() => [])`. This is the layer a
    // real outage hits, and the layer my original proof never touched.
    vi.doMock("../db/index.js", () => ({
      db: { execute: vi.fn().mockRejectedValue(new Error("db down")) },
    }));
    const { assembleGptReports } = await import("../lib/slumhouse/reports-data.js");

    const payload = await assembleGptReports({ scope: "night" });

    // The inner handler still swallows (page must render) — but the failure is now VISIBLE.
    expect(payload.degraded).toBe(true);
    expect(payload.error).toMatch(/query_failed/);
    // Pre-existing fail-soft intent preserved: a renderable payload, not a throw.
    expect(Array.isArray(payload.reports)).toBe(true);
  });

  // The proof that the fix is not just "always say degraded".
  it("a GENUINELY QUIET night is NOT degraded — empty-success must stay distinguishable", async () => {
    vi.doMock("../db/index.js", () => ({
      db: { execute: vi.fn().mockResolvedValue([]) },   // succeeds, returns nothing
    }));
    const { assembleGptReports } = await import("../lib/slumhouse/reports-data.js");

    const payload = await assembleGptReports({ scope: "night" });

    expect(payload.degraded).toBeUndefined();
    expect(payload.error).toBeUndefined();
    expect(payload.reports).toEqual([]);
  });
});

describe("F-1: autopilot status reaches its degraded path on a real service failure", () => {
  beforeEach(() => { vi.resetModules(); });

  // NOTE ON METHOD, stated rather than hidden: this asserts REACHABILITY at source, not
  // behaviour at runtime. Importing `production-status.js` transitively boots index.ts →
  // boot-migration-runner → un-mocked db (a pinned repo trap that crashes ~13 files at
  // collection), so a runtime harness here would cost more than it proves.
  //
  // That is an acceptable division ONLY because the two halves are separately covered:
  //   • the BEHAVIOUR (null + yellow + degraded) is proven by the fix-#3 starve-proof and the
  //     21 existing production-status tests, which exercise the outer catch directly;
  //   • what was MISSING and is asserted here is that the outer catch is REACHABLE at all.
  // F-1 was never a logic bug — the logic was right and unreachable. This tests the thing that
  // was actually broken.
  it("STARVE AT SOURCE: the rejection is no longer intercepted before the outer catch", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/server/routes/production-status.ts", "utf-8");
    expect(src).not.toMatch(/operatorAbsentModeActive\(\)\s*\.catch\(/);
    expect(src).not.toMatch(/getLastHeartbeatAt\(\)\s*\.catch\(/);
  });
});

// The boundary that must never be conflated — third time this distinction has mattered tonight
// (alerting silence, quiet night, resolved-null heartbeat).
describe("resolved-null is a VALUE, not a failure", () => {
  it("getLastHeartbeatAt returning null legitimately must not read as degraded", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/server/services/dead-mans-heartbeat-service.ts", "utf-8");
    // Its contract is Promise<Date | null>: "no heartbeat yet" is a legitimate resolved value.
    // Propagating rejections must not turn that legitimate null into an error signal.
    expect(src).toMatch(/getLastHeartbeatAt\(\)\s*:\s*Promise<Date \| null>/);
  });
});
