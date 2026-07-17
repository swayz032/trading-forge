/**
 * goalscan-crit-manual-path-hard-gate-parity.test.ts — goalscan-crit deep-scan, 2026-07-16
 *
 * RED-PROOFS for three verified CRIT/HIGH promotion-gate defects in the MANUAL/API
 * promotion path (_promoteStrategyInner — backs `PATCH /:id/lifecycle`, an HMAC route
 * whose secret is shared with n8n/Carter automation, NOT a human-only route):
 *
 *   Defect 1 (CRIT) — the B-2 invariant/truthiness hard gate (`invariants.overall_passed
 *     === false`) was gated ONLY on `fromState === "TESTING"`, so it never fired on the
 *     canonical SHADOW → PAPER edge every strategy has used since Wave 29's
 *     shadowModeEnabled=true default. Fixed by adding `fromState === "SHADOW"`.
 *
 *   Defect 2 (CRIT/HIGH) — the CPCV-required-for-Style-C look-ahead gate (requires
 *     wf_metadata.mode === "cpcv") had the IDENTICAL scoping bug — same fix.
 *
 *   Defect 3 (CRIT) — the manual path ran ZERO of the B14 ci_high / WFE / parameter-drift
 *     / DSR-walk-forward hard gates (and the plain MC-survival>0.70 floor) that the cron
 *     (checkAutoPromotions) enforces on the identical TESTING→PAPER and SHADOW→PAPER
 *     edges. Fixed by adding one inline block that calls the SAME shared pure evaluators
 *     the cron calls.
 *
 * All three fixes are STRICTER (fail-closed) — they only ADD blocking, never loosen an
 * existing gate or relax a threshold. Every BLOCKED case below asserts pre-fix vs
 * post-fix divergence: on the pre-fix code the guarding `if` condition excluded the
 * transition entirely, so the gate's own select() was never issued and the block never
 * fired — the promotion would have proceeded past that gate. Revert the corresponding
 * `if` condition (or delete the Defect 3 block) in lifecycle-service.ts and these tests
 * go RED.
 *
 * Harness mirrors deepscan17-dsl-guards-manual-path.test.ts: imports the REAL
 * LifecycleService with its full dependency surface mocked, drives promoteStrategy()
 * through a FIFO selectQueue (a drained queue auto-returns `[]` for any further select,
 * per makeChain's `selectQueue.shift() ?? []` default), and asserts on captured audit
 * rows / SSE events / the returned error.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ────────────────────────────────────────────────────────────────

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockEvaluateGates = vi.fn();
const mockResolveSurvivalTwin = vi.fn();
const mockFreezePolicy = vi.fn();
const mockLoadDiv = vi.fn();
const mockShadowGate = vi.fn();
const mockGetLatestFrankensteinRun = vi.fn();
const mockGetLatestAdversarialStressRun = vi.fn();

/** Rows captured from db.insert(...).values(...) — audit assertions read this. */
const insertedRows: Record<string, unknown>[] = [];

/** SSE events captured from broadcastSSE(event, payload). */
const sseEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];

/** FIFO of db.select() results. An Error entry makes that select REJECT. A drained
 * queue auto-returns `[]` (see makeChain default in beforeEach) — this is what lets
 * "proceeds past gate X" tests avoid enumerating every downstream select. */
const selectQueue: unknown[] = [];

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "groupBy", "innerJoin", "leftJoin"]) {
    chain[m] = vi.fn(() => chain);
  }
  const promise = () =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  chain.then = (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => promise().then(onF, onR);
  chain.catch = (onR: (e: unknown) => unknown) => promise().catch(onR);
  chain.finally = (onFin: () => void) => promise().finally(onFin);
  return chain;
}

// ── Module mocks (must precede imports) ───────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
    transaction: vi.fn(async () => { throw new Error("TX_SENTINEL"); }),
    execute: vi.fn(async () => []),
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies: { id: "id", lifecycleState: "lifecycleState", config: "config", frozenPolicyHash: "frozenPolicyHash", regimeTrainedOn: "regimeTrainedOn" },
  strategyNames: {},
  strategyGraveyard: {},
  backtests: {
    id: "id", strategyId: "strategyId", status: "status", createdAt: "createdAt",
    walkForwardResults: "walkForwardResults", gateResult: "gateResult", b15Battery: "b15Battery",
    wrcResult: "wrcResult", spaResult: "spaResult", bif: "bif", kEff: "kEff",
    propCompliance: "propCompliance", tier: "tier", forgeScore: "forgeScore",
    resultExtras: "resultExtras", slippageSurvival: "slippageSurvival",
    mrpSharpe: "mrpSharpe", mrpRegimeBreakdown: "mrpRegimeBreakdown",
  },
  auditLog: {
    action: "action", entityId: "entityId", entityType: "entityType", createdAt: "createdAt",
    id: "id", status: "status", decisionAuthority: "decisionAuthority",
    input: "input", result: "result", correlationId: "correlationId",
  },
  lifecycleTransitions: {},
  monteCarloRuns: { backtestId: "backtestId", status: "status", createdAt: "createdAt", probabilityOfRuin: "probabilityOfRuin", riskMetrics: "riskMetrics" },
  quantumMcRuns: {},
  paperSessions: {},
  paperTrades: {},
  complianceRulesets: { firm: "firm", createdAt: "createdAt", driftDetected: "driftDetected", status: "status", parsedRules: "parsedRules", contentHash: "contentHash", version: "version" },
  pilotSessions: {},
  biasState: { regimeLabel: "regimeLabel" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "__eq__"),
  and: vi.fn(() => "__and__"),
  desc: vi.fn(() => "__desc__"),
  gte: vi.fn(() => "__gte__"),
  sql: new Proxy(() => "__sql__", { get: () => () => "__sql__" }),
  count: vi.fn(() => "__count__"),
  inArray: vi.fn(() => "__inArray__"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/metrics-registry.js", () => ({
  autoGraveyardTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  strategyPromotions: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  pboBlocksTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  lifecycleShadowPromotionsTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  bifGateEvaluationsTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  slippageSurvivalBlocksTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  auditWriteFailuresTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  b14GateTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  wfeGateTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  parameterDriftGateTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
  dslGuardsGateTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string, payload: Record<string, unknown>) => {
    sseEvents.push({ event, payload });
    return mockBroadcastSSE(event, payload);
  },
  LIFECYCLE_GATE_EVENTS: new Proxy({}, { get: (_t, p) => `lifecycle:${String(p).toLowerCase()}` }),
  WAVE29_EVENTS: new Proxy({}, { get: (_t, p) => `wave29:${String(p)}` }),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (op: string) => op,
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() })) },
}));

// insertAuditRow must push into insertedRows (mirroring the broadcastSSE mock's
// sseEvents.push pattern below) so assertions can see audit rows written via the
// insertAuditRow helper (as opposed to the raw db.insert(auditLog).values() path
// captured by mockInsertFn) — and must return a resolved Promise since every call
// site chains `.catch(...)` onto it.
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: (row: Record<string, unknown>) => {
    insertedRows.push(row);
    return Promise.resolve();
  },
  insertAuditRowSafe: (row: Record<string, unknown>) => {
    insertedRows.push(row);
    return Promise.resolve();
  },
}));
vi.mock("../lib/quantum-agreement.js", () => ({ computeAgreement: vi.fn(() => ({ score: null, delta: null, fallback: true, disagreementPct: null, withinTolerance: true })) }));
vi.mock("../services/adversarial-stress-service.js", () => ({
  getLatestAdversarialStressRun: (...args: unknown[]) => mockGetLatestAdversarialStressRun(...args),
}));
vi.mock("../services/frankenstein-service.js", () => ({
  getLatestFrankensteinRun: (...args: unknown[]) => mockGetLatestFrankensteinRun(...args),
}));
vi.mock("../services/evolution-service.js", () => ({ evolveStrategy: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { circuitOpen: vi.fn() } }));
vi.mock("../services/pine-export-service.js", () => ({ compileDualPineExport: vi.fn(), compilePineExport: vi.fn() }));
vi.mock("../services/agent-coordinator-service.js", () => ({ agentCoordinator: { emit: vi.fn(async () => undefined) } }));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn(async () => false), isHalted: vi.fn(() => false) },
}));
// Defect 3's evaluators run for REAL (not mocked) — the whole point of the fix is that
// the manual path now calls the IDENTICAL pure evaluator the cron calls, so exercising
// the real functions is the correct RED-proof (a mock would hide a wiring regression).
vi.mock("../lib/composite-shadow-gate.js", () => ({ evaluateCompositeShadow: vi.fn() }));
vi.mock("../lib/composite-shadow-discord-router.js", () => ({ routeShadowDisagreementAlert: vi.fn() }));
vi.mock("../lib/promotion-gate-orchestrator.js", () => ({
  evaluatePromotionGates: vi.fn(), getWfePromotionFloor: vi.fn(), getCpcvMinPaths: vi.fn(),
}));
vi.mock("../lib/pbo-gate.js", () => ({ evaluatePboGate: vi.fn(() => ({ ok: true, pbo: null, threshold: 0.15, legacyNull: true, reason: "lifecycle.pbo_unavailable_legacy", auditPayload: {} })) }));
vi.mock("../lib/shadow-signal-divergence-checker.js", () => ({ compareShadowToBacktest: vi.fn() }));
vi.mock("../lib/shadow-signal-divergence-loader.js", () => ({
  loadDivergenceInputs: (...args: unknown[]) => mockLoadDiv(...args),
}));
vi.mock("../lib/shadow-to-paper-gate.js", () => ({
  evaluateShadowToPaperGate: (...args: unknown[]) => mockShadowGate(...args),
  getMinSampleSize: vi.fn(() => 20),
}));
vi.mock("../lib/frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  get freezePolicyForStrategy() { return mockFreezePolicy; },
}));
vi.mock("../lib/bif-gate.js", () => ({
  evaluateBifGate: vi.fn(() => ({ passed: true, reason: "bif.clean", legacyNull: false, auditPayload: {} })),
}));
vi.mock("../services/multi-firm-promotion-service.js", () => ({ evaluateMultiFirmEligibility: vi.fn() }));
vi.mock("../services/signal-correlation-service.js", () => ({
  checkSignalCorrelationGate: vi.fn(async () => ({
    allowed: true, reason: "A7 pass (mocked)", maxSimilarity: 0.1, blockingStrategyId: null,
  })),
}));
vi.mock("../lib/paper-to-deploy-ready-gates.js", () => ({
  evaluatePaperToDeployReadyGates: (...args: unknown[]) => mockEvaluateGates(...args),
  resolveSurvivalTwinOnDemand: (...args: unknown[]) => mockResolveSurvivalTwin(...args),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { LifecycleService } from "../services/lifecycle-service.js";

// ── Fixtures / helpers ────────────────────────────────────────────────────────

const STRAT_ID = "ffff0002-0000-0000-0000-000000000002";
const BT_ID = "bt-goalscan-crit-0001";

const strategyRow = (overrides: Record<string, unknown> = {}) => ({
  id: STRAT_ID,
  name: "goalscan-crit-manual-strategy",
  symbol: "MES",
  lifecycleState: "SHADOW",
  config: {},
  frozenPolicyHash: null,
  regimeTrainedOn: "TRENDING",
  ...overrides,
});

/** DSL-guards select response — a clean (non-blocking) backtest by default. */
const dslGuardsCleanRow = () => ({ resultExtras: { dsl_guards: { guards_failed: false } } });

/** latestBtEvidence select response (id/forgeScore/resultExtras/createdAt). */
const latestBtEvidenceRow = (overrides: Record<string, unknown> = {}) => ({
  id: BT_ID,
  forgeScore: 75,
  resultExtras: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

function auditActions(): string[] {
  return insertedRows.map((r) => String(r.action));
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertedRows.length = 0;
  sseEvents.length = 0;
  mockSelectFn.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
  mockInsertFn.mockImplementation(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);
      return Promise.resolve();
    }),
  }));
  mockResolveSurvivalTwin.mockResolvedValue({ status: "advisory_not_evaluated", reason: "not_evaluated_in_test", perFirm: null, error: null });
  mockFreezePolicy.mockResolvedValue({ hash: "a".repeat(64), frozen_at: new Date() });
  mockLoadDiv.mockResolvedValue({ shadowSignals: [], backtestExpected: [] });
  mockShadowGate.mockResolvedValue({ passed: true, status: "pass", reason: "shadow_divergence_ok", auditAction: null, auditPayload: {} });
  mockGetLatestFrankensteinRun.mockResolvedValue(undefined);
  mockGetLatestAdversarialStressRun.mockResolvedValue(undefined);
  mockEvaluateGates.mockReturnValue({
    passed: true, status: "passed", auditAction: null, auditPayload: {}, reason: "ok",
    incompleteGateCount: 0, gateEvidenceStatuses: ["complete"],
  });
});

const svc = () => new LifecycleService();

// ─── Defect 1 (CRIT) — B-2 invariant gate on SHADOW → PAPER ───────────────────

describe("goalscan-crit Defect 1 — B-2 invariant/truthiness gate on SHADOW→PAPER", () => {
  it("BLOCKS a SHADOW→PAPER promotion when invariants.overall_passed===false", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);          // 1: strategy fetch
    // shadow-to-paper divergence gate: mocked, no select
    selectQueue.push([dslGuardsCleanRow()]);                                // 2: DSL guards
    selectQueue.push([latestBtEvidenceRow()]);                              // 3: promotionEvidence backtest
    selectQueue.push([]);                                                   // 4: mcEvidence (none)
    selectQueue.push([]);                                                   // 5: qmcRun (none)
    // adversarial stress read is TESTING-only — skipped for SHADOW
    selectQueue.push([{ createdAt: new Date().toISOString() }]);            // 6: staleness (fresh)
    selectQueue.push([{                                                    // 7: invariants (TARGET)
      resultExtras: { invariants: { overall_passed: false, critical_failures: ["look_ahead_detected"] } },
    }]);

    const res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^lifecycle\.invariant_blocked/);
    const row = insertedRows.find((r) => r.action === "lifecycle.invariant_blocked");
    expect(row).toBeDefined();
    expect(row!.status).toBe("failure");
    expect((row!.input as Record<string, unknown>).fromState).toBe("SHADOW");
    expect((row!.input as Record<string, unknown>).toState).toBe("PAPER");
    const result = row!.result as Record<string, unknown>;
    expect(result.reason).toBe("invariant_harness_failed");
    expect(result.critical_failures).toEqual(["look_ahead_detected"]);
  });

  it("PROCEEDS past the invariant gate on SHADOW→PAPER when invariants are legacy-null (grandfather)", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);          // 1: strategy fetch
    selectQueue.push([dslGuardsCleanRow()]);                                // 2: DSL guards
    selectQueue.push([latestBtEvidenceRow()]);                              // 3: promotionEvidence backtest
    selectQueue.push([]);                                                   // 4: mcEvidence (none)
    selectQueue.push([]);                                                   // 5: qmcRun (none)
    selectQueue.push([{ createdAt: new Date().toISOString() }]);            // 6: staleness (fresh)
    selectQueue.push([{ resultExtras: null }]);                             // 7: invariants — legacy-null
    // Queue drains from here — every further select() auto-returns [] (makeChain default).
    // The CPCV/WF-mode gate (Defect 2) sees resultExtras falsy and no-ops. Defect 3's own
    // new block will then fail-CLOSED on the missing MC/B14 data (a DIFFERENT, also-correct
    // gate) — this test only asserts the INVARIANT gate specifically did not block.

    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.invariant_blocked");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toMatch(/^lifecycle\.invariant_blocked/);
  });
});

// ─── Defect 2 (CRIT/HIGH) — CPCV/WF-mode gate on SHADOW → PAPER ───────────────

describe("goalscan-crit Defect 2 — CPCV-required-for-Style-C gate on SHADOW→PAPER", () => {
  it("BLOCKS a SHADOW→PAPER promotion when wf_metadata.mode !== \"cpcv\"", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);          // 1: strategy fetch
    selectQueue.push([dslGuardsCleanRow()]);                                // 2: DSL guards
    selectQueue.push([latestBtEvidenceRow()]);                              // 3: promotionEvidence backtest
    selectQueue.push([]);                                                   // 4: mcEvidence (none)
    selectQueue.push([]);                                                   // 5: qmcRun (none)
    selectQueue.push([{ createdAt: new Date().toISOString() }]);            // 6: staleness (fresh)
    selectQueue.push([{ resultExtras: { invariants: { overall_passed: true } } }]); // 7: invariants (pass)
    selectQueue.push([{                                                    // 8: WF-mode (TARGET)
      resultExtras: { wf_metadata: { mode: "plain" } },
    }]);
    selectQueue.push([{ dsl: { exit_params: { style: "c" } } }]);           // 9: stratDsl (isStyleC read)

    const res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^lifecycle\.wf_mode_insufficient/);
    const row = insertedRows.find((r) => r.action === "lifecycle.wf_mode_insufficient");
    expect(row).toBeDefined();
    expect(row!.status).toBe("failure");
    expect((row!.input as Record<string, unknown>).fromState).toBe("SHADOW");
    const result = row!.result as Record<string, unknown>;
    expect(result.reason).toBe("cpcv_required_for_promotion");
    expect(result.wf_mode).toBe("plain");
  });

  it("does NOT block a SHADOW→PAPER promotion when wf_metadata.mode === \"cpcv\"", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);
    selectQueue.push([dslGuardsCleanRow()]);
    selectQueue.push([latestBtEvidenceRow()]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([{ createdAt: new Date().toISOString() }]);
    selectQueue.push([{ resultExtras: { invariants: { overall_passed: true } } }]);
    selectQueue.push([{ resultExtras: { wf_metadata: { mode: "cpcv" } } }]);
    selectQueue.push([{ dsl: { exit_params: { style: "c" } } }]);
    // Queue drains from here.

    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.wf_mode_insufficient");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toMatch(/^lifecycle\.wf_mode_insufficient/);
  });
});

// ─── Defect 3 (CRIT) — manual-path B14/WFE/paramDrift/DSR parity block ────────

describe("goalscan-crit Defect 3 — manual-path hard-gate parity (B14/WFE/paramDrift/DSR)", () => {
  it("BLOCKS a SHADOW→PAPER promotion when no completed MC run exists (B14 fail-closed)", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);          // 1: strategy fetch
    selectQueue.push([dslGuardsCleanRow()]);                                // 2: DSL guards
    selectQueue.push([latestBtEvidenceRow()]);                              // 3: promotionEvidence backtest
    selectQueue.push([]);                                                   // 4: mcEvidence (none)
    selectQueue.push([]);                                                   // 5: qmcRun (none)
    selectQueue.push([{ createdAt: new Date().toISOString() }]);            // 6: staleness (fresh)
    selectQueue.push([{ resultExtras: null }]);                             // 7: invariants (legacy — no-op)
    selectQueue.push([{ resultExtras: null }]);                             // 8: WF-mode (legacy — no-op, skips stratDsl)
    selectQueue.push([{ walkForwardResults: { wfe_overall: 0.95, wfe_status: "cpcv_combined_fold" } }]); // 9: Defect-3 walkForwardResults fetch
    selectQueue.push([]);                                                   // 10: Defect-3 MC-survival (none — non-blocking)
    selectQueue.push([]);                                                   // 11: Defect-3 B14 MC (TARGET — no completed run)

    const res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^lifecycle\.b14_ci_high_blocked/);
    const row = insertedRows.find((r) => r.action === "b14.gate_evaluated" && r.status === "failure");
    expect(row).toBeDefined();
    expect((row!.input as Record<string, unknown>).fromState).toBe("SHADOW");
    expect((row!.input as Record<string, unknown>).toState).toBe("PAPER");
    const result = row!.result as Record<string, unknown>;
    expect(result.blocked).toBe(true);
    expect(String(result.note ?? "")).toMatch(/no completed MC run/);
    expect(sseEvents.some((e) => e.event === "lifecycle:b14_evaluated" && e.payload.passed === false)).toBe(true);
    // WFE/paramDrift/DSR must NOT have run — B14 blocked first (same ordering as the cron).
    expect(auditActions()).not.toContain("lifecycle.wfe_hard_floor_block");
    expect(auditActions()).not.toContain("lifecycle.parameter_overfit_drift_block");
  });

  it("BLOCKS a TESTING→PAPER (legacy fast-track) promotion when no completed MC run exists", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "TESTING" })]);         // 1: strategy fetch
    selectQueue.push([dslGuardsCleanRow()]);                                // 2: DSL guards
    selectQueue.push([latestBtEvidenceRow()]);                              // 3: promotionEvidence backtest
    selectQueue.push([]);                                                   // 4: mcEvidence (none)
    selectQueue.push([]);                                                   // 5: qmcRun (none)
    // adversarial stress read (TESTING-only) is mocked to resolve undefined — no select
    selectQueue.push([{ createdAt: new Date().toISOString() }]);            // 6: staleness (fresh)
    selectQueue.push([{ resultExtras: null }]);                             // 7: invariants (legacy — no-op)
    selectQueue.push([{ resultExtras: null }]);                             // 8: WF-mode (legacy — no-op)
    selectQueue.push([{ walkForwardResults: null }]);                       // 9: Defect-3 walkForwardResults fetch
    selectQueue.push([]);                                                   // 10: Defect-3 MC-survival (none)
    selectQueue.push([]);                                                   // 11: Defect-3 B14 MC (TARGET — no completed run)

    const res = await svc().promoteStrategy(STRAT_ID, "TESTING", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^lifecycle\.b14_ci_high_blocked/);
    const row = insertedRows.find((r) => r.action === "b14.gate_evaluated" && r.status === "failure");
    expect(row).toBeDefined();
    expect((row!.input as Record<string, unknown>).fromState).toBe("TESTING");
  });

  it("BLOCKS a SHADOW→PAPER promotion when MC survival rate <= 0.70 (coarse floor, separate from B14)", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);
    selectQueue.push([dslGuardsCleanRow()]);
    selectQueue.push([latestBtEvidenceRow()]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([{ createdAt: new Date().toISOString() }]);
    selectQueue.push([{ resultExtras: null }]);
    selectQueue.push([{ resultExtras: null }]);
    selectQueue.push([{ walkForwardResults: null }]);                       // 9: Defect-3 walkForwardResults fetch
    selectQueue.push([{ probabilityOfRuin: "0.45" }]);                      // 10: MC-survival (TARGET — survival 0.55 <= 0.70)

    const res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^lifecycle\.mc_survival_below_floor/);
    const row = insertedRows.find((r) => r.action === "lifecycle.mc_survival_below_floor");
    expect(row).toBeDefined();
    const result = row!.result as Record<string, unknown>;
    expect(result.floor).toBe(0.70);
    expect(result.survivalRate as number).toBeCloseTo(0.55, 5);
  });

  it("passes B14/WFE/paramDrift/DSR (all clean) and does not block on the Defect-3 parity block", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);
    selectQueue.push([dslGuardsCleanRow()]);
    selectQueue.push([latestBtEvidenceRow()]);
    selectQueue.push([]);
    selectQueue.push([]);
    selectQueue.push([{ createdAt: new Date().toISOString() }]);
    selectQueue.push([{ resultExtras: null }]);
    selectQueue.push([{ resultExtras: null }]);
    selectQueue.push([{                                                    // 9: walkForwardResults — clean WFE/paramDrift/DSR
      walkForwardResults: {
        wfe_overall: 0.95,
        wfe_status: "cpcv_combined_fold",
        param_stability: { drift_classification: "stable", drift_confidence: 0.9 },
        param_stability_status: "computed",
        wf_metadata: { dsr_pass: true, dsr_unavailable: false, dsr: 1.2 },
      },
    }]);
    selectQueue.push([{ probabilityOfRuin: "0.05" }]);                     // 10: MC-survival — 0.95 survival, clean
    selectQueue.push([{                                                    // 11: B14 MC — clean, low ci_high
      probabilityOfRuin: "0.05",
      riskMetrics: { probability_of_ruin_ci: { point_estimate: 0.05, ci_low: 0.02, ci_high: 0.08, ci_method: "bca", n_resamples: 1000 } },
    }]);
    // Queue drains from here — downstream gates (Frankenstein, exportability, compliance,
    // etc.) will consume [] and likely block for an UNRELATED reason; this test only
    // asserts the Defect-3 parity block itself passed cleanly.

    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("b14.gate_error_fail_closed");
    expect(auditActions()).not.toContain("lifecycle.mc_survival_below_floor");
    expect(auditActions()).not.toContain("lifecycle.wfe_hard_floor_block");
    expect(auditActions()).not.toContain("lifecycle.parameter_overfit_drift_block");
    expect(auditActions()).not.toContain("lifecycle.dsr_floor_block");
    expect(auditActions()).not.toContain("lifecycle.dsr_unavailable_block");
    const b14Row = insertedRows.find((r) => r.action === "b14.gate_evaluated");
    expect(b14Row).toBeDefined();
    expect(b14Row!.status).toBe("success");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toMatch(/^lifecycle\.b14_ci_high_blocked/);
    expect(errText).not.toMatch(/^lifecycle\.mc_survival_below_floor/);
  });
});
