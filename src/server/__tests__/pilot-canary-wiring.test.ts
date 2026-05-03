/**
 * B8b — PILOT canary wiring tests (W14 follow-up)
 *
 * Verifies that the two upstream wiring fixes are present and correct:
 *
 * Fix 1: paper-signal-service.ts — contract clamp during PILOT
 *   - CachedSession carries lifecycleState
 *   - getSessionConfig() populates lifecycleState from strategy
 *   - PILOT clamp fires AFTER all other sizing gates (governor is last)
 *   - Clamp is hard (always sets contextContracts = 1)
 *   - Log line names the DSL max ("PILOT canary: contracts clamped to 1")
 *   - Non-PILOT strategies are not affected
 *
 * Fix 2: paper.ts (stop route) — recordPilotSession after session close
 *   - Stop route checks strategy.lifecycleState before calling recordPilotSession
 *   - Call is fire-and-forget (no await in stop handler body)
 *   - Session stop is never blocked by pilot_sessions write failure
 *   - recordPilotSession is called only for PILOT strategies
 *   - Normal stop outcome is "passed"
 *   - Analytics snapshot sharpe key feeds rollingSharpeFinal
 *
 * Contract invariants:
 *   - PILOT always = 1 contract (hard, no exceptions)
 *   - recordPilotSession fires at most once per session (HTTP 409 guard)
 *   - checkPilotAutoPromotions sweep can now find pilot_sessions rows
 *
 * All tests use static source analysis — no live DB needed.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

// ─── Static source reads ──────────────────────────────────────────────────────

const paperSignalSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/paper-signal-service.ts"),
  "utf8",
);

const paperRoutesSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/routes/paper.ts"),
  "utf8",
);

const lifecycleSrc = readFileSync(
  resolve(import.meta.dirname ?? ".", "../../server/services/lifecycle-service.ts"),
  "utf8",
);

// ─── Fix 1: CachedSession carries lifecycleState ──────────────────────────────

describe("B8b Fix 1 — CachedSession carries lifecycleState", () => {
  it("CachedSession interface declares lifecycleState field", () => {
    expect(paperSignalSrc).toContain("lifecycleState: string");
  });

  it("getSessionConfig populates lifecycleState from strategy.lifecycleState", () => {
    // Must assign strategy.lifecycleState into the CachedSession entry
    expect(paperSignalSrc).toContain("lifecycleState: strategy.lifecycleState");
  });

  it("CachedSession field is documented as B8b", () => {
    // The comment must explain why the field exists (PILOT contract clamp)
    expect(paperSignalSrc).toContain("B8b");
  });
});

// ─── Fix 1: PILOT contract clamp is present in the signal path ───────────────

describe("B8b Fix 1 — PILOT contract clamp in paper-signal-service", () => {
  it("PILOT clamp uses lifecycleState === 'PILOT' condition", () => {
    expect(paperSignalSrc).toContain(`lifecycleState === "PILOT"`);
  });

  it("PILOT clamp sets contextContracts = 1", () => {
    expect(paperSignalSrc).toContain("contextContracts = 1");
  });

  it("PILOT clamp log line contains 'PILOT canary: contracts clamped to 1'", () => {
    expect(paperSignalSrc).toContain("PILOT canary: contracts clamped to 1");
  });

  it("PILOT clamp fires after the governor gate block (ordering check)", () => {
    // The governor gate is the last gate before the deferred-entry queue.
    // PILOT clamp must appear AFTER the governor block closes.
    // We verify ordering by checking index positions in the source.
    const governorBlockIdx = paperSignalSrc.indexOf("Governor (B4.3): position size reduced");
    const pilotClampIdx = paperSignalSrc.indexOf("PILOT canary: contracts clamped to 1");
    expect(governorBlockIdx).toBeGreaterThan(0);
    expect(pilotClampIdx).toBeGreaterThan(0);
    expect(pilotClampIdx).toBeGreaterThan(governorBlockIdx);
  });

  it("PILOT clamp fires before the pendingEntryQueue.set() call (must clamp before queuing)", () => {
    const pilotClampIdx = paperSignalSrc.indexOf("PILOT canary: contracts clamped to 1");
    const pendingQueueIdx = paperSignalSrc.indexOf("pendingEntryQueue.set(pendingKey,");
    expect(pilotClampIdx).toBeGreaterThan(0);
    expect(pendingQueueIdx).toBeGreaterThan(0);
    expect(pilotClampIdx).toBeLessThan(pendingQueueIdx);
  });

  it("PILOT clamp only fires when contextContracts !== 1 (no redundant log on already-1 size)", () => {
    // The guard condition prevents the log from firing when size is already 1.
    // Verify the condition includes the contextContracts !== 1 check.
    expect(paperSignalSrc).toContain("contextContracts !== 1");
  });

  it("PILOT clamp is guarded by riskGatePassed (rejected signals are not processed)", () => {
    // The PILOT block must include riskGatePassed in its condition so a risk-gate
    // rejection does not trigger the clamp log unnecessarily.
    // We use 900 chars to cover the full comment block + the if-condition.
    const pilotBlock = paperSignalSrc.slice(
      paperSignalSrc.indexOf("B8b: PILOT canary — hard 1-contract ceiling"),
    ).slice(0, 900);
    expect(pilotBlock).toContain("riskGatePassed");
  });

  it("PILOT clamp emits span attribute 'pilot_canary_clamp'", () => {
    expect(paperSignalSrc).toContain("pilot_canary_clamp");
  });
});

// ─── Fix 2: recordPilotSession is wired in the stop route ────────────────────

describe("B8b Fix 2 — recordPilotSession called in paper.ts stop route", () => {
  it("paper.ts imports or dynamically imports LifecycleService", () => {
    // Dynamic import pattern used to avoid circular deps + fire-and-forget pattern
    expect(paperRoutesSrc).toContain("LifecycleService");
  });

  it("paper.ts calls recordPilotSession", () => {
    expect(paperRoutesSrc).toContain("recordPilotSession");
  });

  it("recordPilotSession call is inside an async IIFE (fire-and-forget pattern)", () => {
    // Fire-and-forget: the IIFE is invoked and not awaited from the route handler body.
    // We verify that the async IIFE pattern surrounds the actual call.
    // The actual await call is "await lifecycleService.recordPilotSession" —
    // find that first, then look backward for the async IIFE opening.
    const actualCallIdx = paperRoutesSrc.indexOf("await lifecycleService.recordPilotSession");
    expect(actualCallIdx).toBeGreaterThan(0);
    const iifeIdx = paperRoutesSrc.lastIndexOf("(async () => {", actualCallIdx);
    expect(iifeIdx).toBeGreaterThan(0);
    expect(iifeIdx).toBeLessThan(actualCallIdx);
  });

  it("stop route checks lifecycleState === 'PILOT' before calling recordPilotSession", () => {
    expect(paperRoutesSrc).toContain(`lifecycleState === "PILOT"`);
  });

  it("PILOT session outcome is 'passed' for normal stop", () => {
    // Normal stop = canary session completed without kill-switch; outcome is "passed"
    expect(paperRoutesSrc).toContain(`outcome: "passed"`);
  });

  it("compliancePassed is true for normal stop", () => {
    // Compliance kill stops are handled by kill-switch path, not here.
    // Normal stop = no compliance violation = compliancePassed: true.
    expect(paperRoutesSrc).toContain("compliancePassed: true");
  });

  it("rollingSharpeFinal reads from analyticsSnapshot.sharpe", () => {
    expect(paperRoutesSrc).toContain("analyticsSnapshot");
    expect(paperRoutesSrc).toContain("analyticsSnapshot?.sharpe");
  });

  it("analyticsSnapshot is declared before the analytics try block (scoped correctly)", () => {
    const declarationIdx = paperRoutesSrc.indexOf("analyticsSnapshot: Record<string, unknown> | null = null");
    const tryBlockIdx = paperRoutesSrc.indexOf("module: \"src.engine.paper_analytics\"");
    expect(declarationIdx).toBeGreaterThan(0);
    expect(tryBlockIdx).toBeGreaterThan(0);
    expect(declarationIdx).toBeLessThan(tryBlockIdx);
  });

  it("recordPilotSession call is after res.json is not awaited (non-blocking close)", () => {
    // res.json(session) must appear AFTER the IIFE is kicked off (not before).
    // IIFE is invoked without await, then res.json is called.
    const iifeInvokeIdx = paperRoutesSrc.indexOf("recordPilotSession");
    const resJsonIdx = paperRoutesSrc.indexOf("res.json(session)");
    expect(iifeInvokeIdx).toBeGreaterThan(0);
    expect(resJsonIdx).toBeGreaterThan(0);
    // The IIFE must start before res.json
    expect(iifeInvokeIdx).toBeLessThan(resJsonIdx);
  });

  it("PILOT session recording failure is caught and logged as warn (not error)", () => {
    // Non-blocking path: warn-level log, not error propagation
    expect(paperRoutesSrc).toContain("recordPilotSession failed (non-blocking)");
  });

  it("PILOT canary log line identifies normal stop reason", () => {
    expect(paperRoutesSrc).toContain("PILOT canary: pilot session recorded (normal stop)");
  });
});

// ─── Fix 2: lifecycle-service.ts recordPilotSession contract ─────────────────

describe("B8b — recordPilotSession contract in lifecycle-service", () => {
  it("recordPilotSession is an async method on LifecycleService", () => {
    expect(lifecycleSrc).toContain("async recordPilotSession(");
  });

  it("recordPilotSession accepts strategyId, paperSessionId, rollingSharpeFinal, compliancePassed, outcome", () => {
    const fnBody = lifecycleSrc.slice(
      lifecycleSrc.indexOf("async recordPilotSession("),
    ).slice(0, 300);
    expect(fnBody).toContain("strategyId");
    expect(fnBody).toContain("paperSessionId");
    expect(fnBody).toContain("rollingSharpeFinal");
    expect(fnBody).toContain("compliancePassed");
    expect(fnBody).toContain("outcome");
  });

  it("recordPilotSession always writes contracts: 1 (hard invariant)", () => {
    // The insert must always use contracts: 1 regardless of caller input.
    // The function body is ~400 chars including the db.insert() call,
    // so use 1200 chars to be safe.
    const fnBody = lifecycleSrc.slice(
      lifecycleSrc.indexOf("async recordPilotSession("),
    ).slice(0, 1200);
    expect(fnBody).toContain("contracts: 1");
  });

  it("recordPilotSession derives sessionNumber from existing count (sequential 1-5)", () => {
    const fnBody = lifecycleSrc.slice(
      lifecycleSrc.indexOf("async recordPilotSession("),
    ).slice(0, 1200);
    expect(fnBody).toContain("sessionNumber");
  });

  it("checkPilotAutoPromotions is declared in lifecycle-service", () => {
    expect(lifecycleSrc).toContain("checkPilotAutoPromotions");
  });

  it("pilot_sessions table is referenced in lifecycle-service (sweep reads it)", () => {
    // The sweep (checkPilotAutoPromotions) queries the pilotSessions drizzle table,
    // which Drizzle maps to the pilot_sessions DB table.
    // The schema import uses pilotSessions (camelCase), the SQL table is pilot_sessions.
    // We verify by checking for the pilotSessions reference in the lifecycle source.
    expect(lifecycleSrc).toContain("pilotSessions");
  });
});

// ─── Contract invariant: 1-contract ceiling is hard ──────────────────────────

describe("B8b — PILOT 1-contract ceiling invariants", () => {
  it("PILOT clamp comment states the ceiling is HARD (no config, no env, no override)", () => {
    expect(paperSignalSrc).toContain("HARD");
    // More specific: the comment must be in the PILOT block
    const pilotBlock = paperSignalSrc.slice(
      paperSignalSrc.indexOf("B8b: PILOT canary — hard 1-contract ceiling"),
    ).slice(0, 800);
    expect(pilotBlock).toContain("no config");
    expect(pilotBlock).toContain("no override");
  });

  it("pilot_sessions schema always forces contracts=1 (independent of signal service)", () => {
    // recordPilotSession inserts contracts: 1 unconditionally — a defense-in-depth
    // check even if the clamp upstream ever regresses.
    // Use 1200 chars to cover the full function body including the insert() call.
    const fnBody = lifecycleSrc.slice(
      lifecycleSrc.indexOf("async recordPilotSession("),
    ).slice(0, 1200);
    // Verify the "Always 1 in PILOT" comment is present in the function body
    expect(fnBody).toContain("Always 1 in PILOT");
  });
});
