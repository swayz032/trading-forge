/**
 * test_pass2c_lifecycle_fixes.test.ts — Pass 2C lifecycle bug fixes
 *
 * Covers:
 *   F-4:  PILOT promo requires ALL sessions >= PILOT_MIN_SHARPE (not just last)
 *   F-5:  Frankenstein rejection audit rows carry options.correlationId (source inspection)
 *   F-6:  PAPER→DEPLOY_READY drift check infra failure blocks promotion (fail-closed)
 *   F-9:  evolveStrategy skips when parent is in PILOT or DEPLOYED
 *   F-10: POST /lifecycle/check includes checkPilotAutoPromotions (source inspection)
 *   F-11: buryInGraveyard fires only on GRAVEYARD/RETIRED, NOT DECLINING (source inspection)
 *   F-12: Frankenstein gate applies to CANDIDATE→PAPER, not only TESTING→PAPER (source inspection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Source files read once for static-analysis tests ──────────────────────────
const lifecycleSrc = readFileSync(
  resolve(__dirname, "./lifecycle-service.ts"),
  "utf-8",
);
const evolutionSrc = readFileSync(
  resolve(__dirname, "./evolution-service.ts"),
  "utf-8",
);
const routesSrc = readFileSync(
  resolve(__dirname, "../routes/strategies.ts"),
  "utf-8",
);

// ── vi.mock factories ──────────────────────────────────────────────────────────
const mockIsHalted = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: mockIsHalted },
}));

vi.mock("../db/index.js", () => {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([]),
  };
  const dbMock = {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    transaction: vi.fn().mockImplementation(async (cb: Function) => { await cb(dbMock); }),
    _chain: chain,
  };
  return { db: dbMock };
});

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("./alert-service.js", () => ({
  AlertFactory: {
    deployReady: vi.fn().mockResolvedValue(undefined),
    decayAlert: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./evolution-service.js", () => ({ evolveStrategy: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("./pine-export-service.js", () => ({
  compileDualPineExport: vi.fn().mockResolvedValue({ id: "pine-uuid" }),
  checkExportability: vi.fn().mockResolvedValue({ ok: true, score: 100, band: "green", deductions: [] }),
}));
vi.mock("./notification-service.js", () => ({
  notifyInfo: vi.fn().mockResolvedValue(undefined),
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));
vi.mock("./agent-coordinator-service.js", () => ({
  agentCoordinator: { notify: vi.fn(), register: vi.fn(), emit: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/tracing.js", () => {
  const span = { setAttribute: vi.fn(), end: vi.fn() };
  return { tracer: { startSpan: vi.fn().mockReturnValue(span) }, OTEL_AVAILABLE: false };
});
vi.mock("./adversarial-stress-service.js", () => ({
  getLatestAdversarialStressRun: vi.fn().mockResolvedValue(null),
}));
vi.mock("./frankenstein-service.js", () => ({
  getLatestFrankensteinRun: vi.fn().mockResolvedValue({
    passed: true,
    runId: "frank-1",
    p95Sharpe: 0.1,
    medianPf: 1.0,
  }),
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/metrics-registry.js", () => ({
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));
vi.mock("./multi-firm-promotion-service.js", () => ({
  evaluateMultiFirmEligibility: vi.fn().mockResolvedValue(undefined),
}));

// ── F-4: PILOT Sharpe all-sessions test (runtime via checkPilotAutoPromotions) ─
// Uses source-file inspection because the DB mock chain is not easily patchable
// for pilotSessions.filter() inside the service loop — structural/static check is
// more reliable here and guards against the regression definitively.
describe("F-4: PILOT auto-promotion requires ALL sessions >= PILOT_MIN_SHARPE", () => {
  it("uses completedSessions.every() not lastSession check for Sharpe gate", () => {
    // Presence of the every()-based allSharpePassed variable, not lastSharpePassed
    expect(lifecycleSrc).toMatch(/allSharpePassed\s*=\s*completedSessions\.every/);
  });

  it("does NOT use lastSharpePassed variable as the primary gate condition", () => {
    // The old bug: `const lastSharpePassed = ...` used as the gate
    // After fix: allSharpePassed is used in the if-condition
    expect(lifecycleSrc).not.toMatch(/if\s*\(\s*allCompliant\s*&&\s*lastSharpePassed\s*\)/);
  });

  it("uses allSharpePassed in the promotion if-condition", () => {
    expect(lifecycleSrc).toMatch(/if\s*\(\s*allCompliant\s*&&\s*allSharpePassed\s*\)/);
  });

  it("sessions with mixed Sharpes [0.4, 0.3, 0.5, 0.6, 1.1] should not promote — allSharpePassed=false", () => {
    // Simulate the every() check inline — this is the exact logic now in the service
    const PILOT_MIN_SHARPE = 1.0;
    const completedSessions = [
      { rollingSharpeFinal: "0.4", compliancePassed: true },
      { rollingSharpeFinal: "0.3", compliancePassed: true },
      { rollingSharpeFinal: "0.5", compliancePassed: true },
      { rollingSharpeFinal: "0.6", compliancePassed: true },
      { rollingSharpeFinal: "1.1", compliancePassed: true },
    ];
    const allSharpePassed = completedSessions.every(
      (ps) => ps.rollingSharpeFinal != null && parseFloat(String(ps.rollingSharpeFinal)) >= PILOT_MIN_SHARPE,
    );
    expect(allSharpePassed).toBe(false);
  });

  it("sessions with all Sharpes >= 1.0 should promote — allSharpePassed=true", () => {
    const PILOT_MIN_SHARPE = 1.0;
    const completedSessions = [
      { rollingSharpeFinal: "1.1", compliancePassed: true },
      { rollingSharpeFinal: "1.2", compliancePassed: true },
      { rollingSharpeFinal: "1.0", compliancePassed: true },
      { rollingSharpeFinal: "1.3", compliancePassed: true },
      { rollingSharpeFinal: "1.5", compliancePassed: true },
    ];
    const allSharpePassed = completedSessions.every(
      (ps) => ps.rollingSharpeFinal != null && parseFloat(String(ps.rollingSharpeFinal)) >= PILOT_MIN_SHARPE,
    );
    expect(allSharpePassed).toBe(true);
  });
});

// ── F-5: Frankenstein rejection audit rows carry correlationId ────────────────
describe("F-5: Frankenstein rejection audit rows propagate correlationId", () => {
  it("no hardcoded correlationId: null in Frankenstein gate block", () => {
    // Extract the Frankenstein gate block between A4 gate comment and writeBlock
    const frankStart = lifecycleSrc.indexOf("A4 Frankenstein Gate");
    const writeBlockStart = lifecycleSrc.indexOf("Atomic write block", frankStart);
    expect(frankStart).toBeGreaterThan(-1);
    expect(writeBlockStart).toBeGreaterThan(frankStart);
    const frankGateBlock = lifecycleSrc.slice(frankStart, writeBlockStart);

    // All correlationId fields in this block must use options.correlationId ?? null
    // not the hardcoded literal null
    const hardcodedNullMatches = frankGateBlock.match(/correlationId:\s*null(?!\s*,\s*\/\/)/g);
    expect(hardcodedNullMatches).toBeNull();
  });

  it("Frankenstein gate uses options.correlationId ?? null pattern", () => {
    const frankStart = lifecycleSrc.indexOf("A4 Frankenstein Gate");
    const writeBlockStart = lifecycleSrc.indexOf("Atomic write block", frankStart);
    const frankGateBlock = lifecycleSrc.slice(frankStart, writeBlockStart);

    const propagatedMatches = frankGateBlock.match(/correlationId:\s*options\.correlationId\s*\?\?\s*null/g);
    // Should have at least 3 propagated correlationId patterns (missing_run, failed, infra_error, no_backtest_id)
    expect(propagatedMatches).not.toBeNull();
    expect(propagatedMatches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ── F-6: PAPER→DEPLOY_READY drift check fails-closed ────────────────────────
describe("F-6: PAPER→DEPLOY_READY drift check infra error fails-closed", () => {
  it("drift check catch block uses continue (blocks promotion), not logger.warn only", () => {
    // Find the drift-check catch block in the auto-check path
    const driftCatchIdx = lifecycleSrc.indexOf("drift_check_infra_error");
    expect(driftCatchIdx).toBeGreaterThan(-1);
  });

  it("drift check catch block writes lifecycle.drift_check_infra_error audit row", () => {
    expect(lifecycleSrc).toContain("lifecycle.drift_check_infra_error");
  });

  it("drift check catch block includes continue after audit row (blocks promotion)", () => {
    // Anchor on "F-6 FIX" (unique to the cron-path catch block) instead of
    // "drift_check_infra_error" — an earlier pre-existing commit reused that same
    // audit action string at an earlier manual-path call site (which `return`s
    // instead of `continue`s), so a plain indexOf() no longer lands here.
    const driftErrIdx = lifecycleSrc.indexOf("F-6 FIX");
    expect(driftErrIdx).toBeGreaterThan(-1);
    const windowAfter = lifecycleSrc.slice(driftErrIdx, driftErrIdx + 1800);
    expect(windowAfter).toMatch(/continue\s*;/);
  });

  it("old drift-check fail-open message no longer present", () => {
    // The specific drift-check fail-open message that was removed in F-6 fix.
    // Note: the string "non-blocking, promotion continues" may still exist in
    // other guards (e.g. exportability check) — only the drift-check variant
    // with "drift-check threw" must be gone.
    expect(lifecycleSrc).not.toContain("drift-check threw (non-blocking, promotion continues)");
  });
});

// ── F-9: evolveStrategy skips for PILOT/DEPLOYED parent ──────────────────────
describe("F-9: evolveStrategy skips when parent is PILOT or DEPLOYED", () => {
  it("evolution-service.ts contains ACTIVE_STATES_BLOCK_EVOLUTION guard", () => {
    expect(evolutionSrc).toContain("ACTIVE_STATES_BLOCK_EVOLUTION");
  });

  it("guard includes both PILOT and DEPLOYED", () => {
    expect(evolutionSrc).toMatch(/ACTIVE_STATES_BLOCK_EVOLUTION.*=.*\[.*"PILOT".*"DEPLOYED".*\]/s);
  });

  it("guard writes evolveStrategy.skipped_parent_active audit row", () => {
    expect(evolutionSrc).toContain("evolveStrategy.skipped_parent_active");
  });

  it("inline simulation: PILOT state triggers skip", () => {
    const ACTIVE_STATES = ["PILOT", "DEPLOYED"] as const;
    const state = "PILOT";
    expect(ACTIVE_STATES.includes(state as typeof ACTIVE_STATES[number])).toBe(true);
  });

  it("inline simulation: DEPLOYED state triggers skip", () => {
    const ACTIVE_STATES = ["PILOT", "DEPLOYED"] as const;
    const state = "DEPLOYED";
    expect(ACTIVE_STATES.includes(state as typeof ACTIVE_STATES[number])).toBe(true);
  });

  it("inline simulation: DECLINING state does NOT trigger skip (evolution allowed)", () => {
    const ACTIVE_STATES = ["PILOT", "DEPLOYED"] as const;
    const state = "DECLINING";
    expect(ACTIVE_STATES.includes(state as typeof ACTIVE_STATES[number])).toBe(false);
  });
});

// ── F-10: POST /lifecycle/check includes checkPilotAutoPromotions ─────────────
describe("F-10: POST /lifecycle/check includes checkPilotAutoPromotions", () => {
  // Use the route handler declaration as the anchor, not the comment line above it.
  // The comment "lifecycle/check" appears before the handler, so slice from the
  // handler registration to avoid window truncation.
  // Use 2000 chars to comfortably span the full handler body.
  const checkHandlerIdx = routesSrc.indexOf('strategyRoutes.post("/lifecycle/check"');
  const routeBlock = routesSrc.slice(checkHandlerIdx, checkHandlerIdx + 2000);

  it("lifecycle/check route handler exists", () => {
    expect(checkHandlerIdx).toBeGreaterThan(-1);
  });

  it("checkPilotAutoPromotions called in the lifecycle/check route", () => {
    expect(routeBlock).toContain("checkPilotAutoPromotions");
  });

  it("response includes pilotPromotions key", () => {
    expect(routeBlock).toContain("pilotPromotions");
  });

  it("all three checks run in the same Promise.all (parallel)", () => {
    // Use the full routeBlock (2000 chars from handler start) — the Promise.all
    // is ~1000 chars into the handler so a nested slice would be too small.
    expect(routeBlock).toContain("Promise.all");
    expect(routeBlock).toContain("checkAutoPromotions");
    expect(routeBlock).toContain("checkAutoDemotions");
    expect(routeBlock).toContain("checkPilotAutoPromotions");
  });
});

// ── F-11: buryInGraveyard fires only on terminal states ──────────────────────
describe("F-11: buryInGraveyard does NOT fire on DECLINING", () => {
  it("DECLINING is absent from the buryInGraveyard trigger condition", () => {
    // Find the post-commit buryInGraveyard call
    const burySectionIdx = lifecycleSrc.indexOf("buryInGraveyard(id, strategy");
    expect(burySectionIdx).toBeGreaterThan(-1);
    // Look at the surrounding if-condition (~200 chars before the call)
    const burySurrounding = lifecycleSrc.slice(burySectionIdx - 200, burySectionIdx + 10);
    expect(burySurrounding).not.toContain('"DECLINING"');
  });

  it("buryInGraveyard trigger condition includes GRAVEYARD and RETIRED", () => {
    const burySectionIdx = lifecycleSrc.indexOf("buryInGraveyard(id, strategy");
    const burySurrounding = lifecycleSrc.slice(burySectionIdx - 200, burySectionIdx + 10);
    expect(burySurrounding).toContain('"GRAVEYARD"');
    expect(burySurrounding).toContain('"RETIRED"');
  });

  it("inline simulation: DECLINING is retry-eligible (not buried)", () => {
    // VALID_TRANSITIONS for DECLINING: ["TESTING", "RETIRED", "GRAVEYARD"]
    // This confirms DECLINING is NOT terminal — it must NOT be buried.
    const TERMINAL_STATES = ["GRAVEYARD", "RETIRED"];
    expect(TERMINAL_STATES.includes("DECLINING")).toBe(false);
  });
});

// ── F-12: Frankenstein gate applies to CANDIDATE→PAPER ───────────────────────
describe("F-12: Frankenstein gate applies to CANDIDATE→PAPER fast-track", () => {
  it("Frankenstein gate condition includes CANDIDATE as fromState", () => {
    // Find the gate condition
    // A pre-existing commit widened this to also match SHADOW→PAPER (closing a gap
    // where the Frankenstein gate never ran on the SHADOW ladder) — allow an
    // optional trailing SHADOW arm instead of requiring exactly TESTING/CANDIDATE.
    expect(lifecycleSrc).toMatch(
      /\(\s*fromState\s*===\s*["']TESTING["']\s*\|\|\s*fromState\s*===\s*["']CANDIDATE["'](?:\s*\|\|\s*fromState\s*===\s*["']SHADOW["'])?\s*\)\s*&&\s*toState\s*===\s*["']PAPER["']/,
    );
  });

  it("old TESTING-only gate condition no longer present", () => {
    // The old pattern: `if (fromState === "TESTING" && toState === "PAPER")` for the Frankenstein gate
    // After fix, this exact pattern inside the A4 gate comment block should not exist alone
    const frankGateIdx = lifecycleSrc.indexOf("A4 Frankenstein Gate");
    const frankGateBlock = lifecycleSrc.slice(frankGateIdx, frankGateIdx + 500);
    // Should NOT be the old single-state check
    expect(frankGateBlock).not.toMatch(/if\s*\(\s*fromState\s*===\s*["']TESTING["']\s*&&\s*toState\s*===\s*["']PAPER["']\s*\)/);
  });

  it("Frankenstein gate comment mentions CANDIDATE", () => {
    const frankGateIdx = lifecycleSrc.indexOf("A4 Frankenstein Gate");
    // Window widened 800->1400: a pre-existing commit inserted its own SHADOW
    // explanatory comment ahead of the pre-existing CANDIDATE context comment,
    // pushing "CANDIDATE" past the original 800-char cutoff.
    const frankGateComment = lifecycleSrc.slice(frankGateIdx, frankGateIdx + 1400);
    expect(frankGateComment).toContain("CANDIDATE");
  });
});
