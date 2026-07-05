/**
 * deepscan7-lifecycle-manual-path-parity.test.ts — Track B (2026-07-02)
 *
 * Behavior tests for the deep-scan #7 manual-path gate-parity fixes in
 * _promoteStrategyInner (PAPER → DEPLOY_READY manual PATCH path):
 *
 *   B1 (F-2)  — needsFirstTimeFreeze is honored: freezePolicyForStrategy is called
 *               BEFORE the promotion DB write when frozenPolicyHash is null, NOT
 *               called when the evaluator does not request it, and a failed freeze
 *               write blocks fail-CLOSED with frozen_policy.hash_compute_failed.
 *   B2 (F-1)  — compliance-drift HARD block runs on the manual path with the same
 *               audit action (lifecycle.promotion_blocked_compliance_drift) and the
 *               cron's fail-CLOSED infra-error behavior (lifecycle.drift_check_infra_error).
 *   B3 (F-3)  — evidence-completeness governor: incompleteGateCount >= 3 blocks with
 *               lifecycle.promotion_evidence_incomplete; < 3 proceeds past the governor.
 *   B5 (M2)   — NEEDS_REVISION / NEEDS_ARCHETYPE are registered lifecycle states with
 *               rework-loop transitions only (→ CANDIDATE / GRAVEYARD; never → PAPER).
 *
 * Mock harness mirrors auto-graveyard-behavior.test.ts (the one existing test that
 * imports the real LifecycleService with its full dependency surface mocked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ────────────────────────────────────────────────────────────────

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockNotifyWarning = vi.fn();
const mockEvaluateGates = vi.fn();
const mockResolveSurvivalTwin = vi.fn();
const mockFreezePolicy = vi.fn();

/** Rows captured from db.insert(...).values(...) — audit assertions read this. */
const insertedRows: Record<string, unknown>[] = [];

/** FIFO of db.select() results. An Error entry makes that select REJECT. */
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
  strategies: { id: "id", lifecycleState: "lifecycleState", config: "config", frozenPolicyHash: "frozenPolicyHash" },
  strategyNames: {},
  strategyGraveyard: {},
  backtests: {
    id: "id", strategyId: "strategyId", status: "status", createdAt: "createdAt",
    walkForwardResults: "walkForwardResults", gateResult: "gateResult", b15Battery: "b15Battery",
    wrcResult: "wrcResult", spaResult: "spaResult", bif: "bif", kEff: "kEff",
    propCompliance: "propCompliance", tier: "tier", forgeScore: "forgeScore",
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
  auditWriteFailuresTotal: { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));

vi.mock("../routes/sse.js", () => ({
  get broadcastSSE() { return mockBroadcastSSE; },
  LIFECYCLE_GATE_EVENTS: new Proxy({}, { get: (_t, p) => `lifecycle:${String(p)}` }),
  WAVE29_EVENTS: new Proxy({}, { get: (_t, p) => `wave29:${String(p)}` }),
}));

vi.mock("../services/notification-service.js", () => ({
  get notifyWarning() { return mockNotifyWarning; },
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (op: string) => op,
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: { startSpan: vi.fn(() => ({ setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() })) },
}));

vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn(), insertAuditRowSafe: vi.fn() }));
vi.mock("../lib/quantum-agreement.js", () => ({ computeAgreement: vi.fn() }));
vi.mock("../services/adversarial-stress-service.js", () => ({ getLatestAdversarialStressRun: vi.fn() }));
vi.mock("../services/frankenstein-service.js", () => ({ getLatestFrankensteinRun: vi.fn() }));
vi.mock("../services/evolution-service.js", () => ({ evolveStrategy: vi.fn() }));
vi.mock("../services/alert-service.js", () => ({ AlertFactory: { circuitOpen: vi.fn() } }));
vi.mock("../services/pine-export-service.js", () => ({ compileDualPineExport: vi.fn(), compilePineExport: vi.fn() }));
vi.mock("../services/agent-coordinator-service.js", () => ({ agentCoordinator: { emit: vi.fn(async () => undefined) } }));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn(async () => false), isHalted: vi.fn(() => false) },
}));
vi.mock("../lib/b14-ci-gate.js", () => ({ evaluateB14CiGate: vi.fn(), evaluateDsrWalkForwardGate: vi.fn() }));
vi.mock("../lib/wfe-gate.js", () => ({ evaluateWfeGate: vi.fn() }));
vi.mock("../lib/parameter-drift-gate.js", () => ({ evaluateParameterDriftGate: vi.fn() }));
vi.mock("../lib/composite-shadow-gate.js", () => ({ evaluateCompositeShadow: vi.fn() }));
vi.mock("../lib/composite-shadow-discord-router.js", () => ({ routeShadowDisagreementAlert: vi.fn() }));
vi.mock("../lib/promotion-gate-orchestrator.js", () => ({
  evaluatePromotionGates: vi.fn(), getWfePromotionFloor: vi.fn(), getCpcvMinPaths: vi.fn(),
}));
vi.mock("../lib/pbo-gate.js", () => ({ evaluatePboGate: vi.fn() }));
vi.mock("../lib/shadow-signal-divergence-checker.js", () => ({ compareShadowToBacktest: vi.fn() }));
vi.mock("../lib/shadow-signal-divergence-loader.js", () => ({ loadDivergenceInputs: vi.fn() }));
vi.mock("../lib/frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  get freezePolicyForStrategy() { return mockFreezePolicy; },
}));
vi.mock("../lib/bif-gate.js", () => ({
  evaluateBifGate: vi.fn(() => ({ passed: true, reason: "bif.clean", legacyNull: false, auditPayload: {} })),
}));
vi.mock("../services/multi-firm-promotion-service.js", () => ({ evaluateMultiFirmEligibility: vi.fn() }));

// deepscan17-wave2 (2026-07-05): the manual PAPER→DEPLOY_READY path now runs the A7 signal
// correlation gate (checkSignalCorrelationGate) after DSL guards. These parity tests target
// the compliance-drift / freeze / evidence-governor gates, so mock A7 to PASS.
vi.mock("../services/signal-correlation-service.js", () => ({
  checkSignalCorrelationGate: vi.fn(async () => ({
    allowed: true, reason: "A7 pass (mocked)", maxSimilarity: 0.1, blockingStrategyId: null,
  })),
}));

// The PAPER→DEPLOY_READY branch dynamically imports the evaluator module.
vi.mock("../lib/paper-to-deploy-ready-gates.js", () => ({
  evaluatePaperToDeployReadyGates: (...args: unknown[]) => mockEvaluateGates(...args),
  resolveSurvivalTwinOnDemand: (...args: unknown[]) => mockResolveSurvivalTwin(...args),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { LifecycleService } from "../services/lifecycle-service.js";

// ── Fixtures / helpers ────────────────────────────────────────────────────────

const STRAT_ID = "dddd0001-0000-0000-0000-000000000001";

const strategyRow = (overrides: Record<string, unknown> = {}) => ({
  id: STRAT_ID,
  name: "manual-path-strategy",
  symbol: "MES",
  lifecycleState: "PAPER",
  config: {},
  frozenPolicyHash: null,
  ...overrides,
});

const backtestRow = (overrides: Record<string, unknown> = {}) => ({
  id: "bt-0001",
  walkForwardResults: null,
  gateResult: null,
  b15Battery: null,
  wrcResult: null,
  spaResult: null,
  bif: null,
  kEff: null,
  propCompliance: null,
  ...overrides,
});

const PASS_RESULT = {
  passed: true,
  status: "pass",
  auditAction: null,
  auditPayload: {},
  reason: "all_gates_passed",
  incompleteGateCount: 0,
  gateEvidenceStatuses: ["complete"],
};

function auditActions(): string[] {
  return insertedRows.map((r) => String(r.action));
}

/**
 * Queue the standard manual PAPER→DEPLOY_READY select sequence:
 *   1. strategy pre-read
 *   2. latest completed backtest
 *   3. (only when propCompliance passes a firm) complianceRulesets latest row
 *   4. latest MC run
 *   5. frozen-shadow strategy row
 *   6. biasState regime lookup (only consumed when the freeze path runs)
 */
function queueStandardSelects(opts: {
  strategy?: Record<string, unknown>;
  backtest?: Record<string, unknown>;
  rulesetRows?: unknown; // array result or Error for the complianceRulesets select
  regimeRows?: unknown[];
} = {}) {
  const strat = opts.strategy ?? strategyRow();
  selectQueue.push([strat]);                                  // 1 strategy pre-read
  selectQueue.push([opts.backtest ?? backtestRow()]);         // 2 latest backtest
  if (opts.rulesetRows !== undefined) selectQueue.push(opts.rulesetRows); // 3 drift lookup
  selectQueue.push([]);                                       // 4 latest MC (none)
  selectQueue.push([{ id: STRAT_ID, config: strat.config ?? {}, frozenPolicyHash: strat.frozenPolicyHash ?? null }]); // 5 frozen shadow
  selectQueue.push(opts.regimeRows ?? [{ regimeLabel: "TRENDING" }]); // 6 biasState (freeze path only)
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertedRows.length = 0;
  mockSelectFn.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
  mockInsertFn.mockImplementation(() => ({
    values: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);
      return Promise.resolve();
    }),
  }));
  mockResolveSurvivalTwin.mockResolvedValue({ status: "advisory", reason: "not_evaluated_in_test" });
  mockFreezePolicy.mockResolvedValue({ hash: "a".repeat(64), frozen_at: new Date() });
  mockEvaluateGates.mockReturnValue({ ...PASS_RESULT });
});

const svc = () => new LifecycleService();

// ─── B2 (F-1) — compliance-drift hard block on the manual path ────────────────

describe("B2 (F-1) — manual PAPER→DEPLOY_READY compliance-drift gate", () => {
  it("blocks with lifecycle.promotion_blocked_compliance_drift when a qualifying firm has drift", async () => {
    queueStandardSelects({
      backtest: backtestRow({ propCompliance: { topstep_50k: { passed: true } } }),
      rulesetRows: [{ firm: "Topstep", driftDetected: true, status: "drift_detected" }],
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toContain("drift_detected");
    expect(auditActions()).toContain("lifecycle.promotion_blocked_compliance_drift");
    const row = insertedRows.find((r) => r.action === "lifecycle.promotion_blocked_compliance_drift")!;
    expect((row.result as Record<string, unknown>).firms_with_drift).toEqual(["Topstep"]);
    expect(row.status).toBe("failure");
    // Drift block fires BEFORE the evaluator — no on-demand replay is spent.
    expect(mockEvaluateGates).not.toHaveBeenCalled();
    expect(mockResolveSurvivalTwin).not.toHaveBeenCalled();
  });

  it("fail-CLOSED on drift-check infra error with lifecycle.drift_check_infra_error (cron parity)", async () => {
    queueStandardSelects({
      backtest: backtestRow({ propCompliance: { topstep_50k: { passed: true } } }),
      rulesetRows: new Error("pg connection refused"),
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toContain("drift_check_infrastructure_error");
    expect(auditActions()).toContain("lifecycle.drift_check_infra_error");
    expect(mockEvaluateGates).not.toHaveBeenCalled();
  });

  it("proceeds to the evaluator when compliance drift is clear", async () => {
    queueStandardSelects({
      backtest: backtestRow({ propCompliance: { topstep_50k: { passed: true } } }),
      rulesetRows: [{ firm: "Topstep", driftDetected: false, status: "active" }],
    });
    mockEvaluateGates.mockReturnValue({
      passed: false, status: "blocked",
      auditAction: "lifecycle.b15_parameter_robustness_blocked",
      auditPayload: {}, reason: "b15_parameter_robustness_failed",
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(mockEvaluateGates).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(false);
    expect(res.error).toBe("b15_parameter_robustness_failed");
    expect(auditActions()).not.toContain("lifecycle.promotion_blocked_compliance_drift");
  });
});

// ─── B1 (F-2) — first-time frozen-policy freeze on the manual path ────────────

describe("B1 (F-2) — needsFirstTimeFreeze honored on the manual path", () => {
  it("calls freezePolicyForStrategy with the current regime when frozenPolicyHash is null", async () => {
    queueStandardSelects({ regimeRows: [{ regimeLabel: "COMPRESSION" }] });
    // needsFirstTimeFreeze + incomplete>=3 so the flow returns at the evidence governor
    // (freeze runs BEFORE the governor, mirroring the cron's gate ordering).
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      reason: "all_gates_passed_first_time_freeze",
      needsFirstTimeFreeze: true,
      incompleteGateCount: 3,
      gateEvidenceStatuses: ["legacy_null", "legacy_proceed", "legacy_unavailable"],
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(mockFreezePolicy).toHaveBeenCalledTimes(1);
    expect(mockFreezePolicy).toHaveBeenCalledWith(STRAT_ID, "COMPRESSION");
    expect(res.success).toBe(false); // blocked downstream by the evidence governor
  });

  it("falls back to regime UNKNOWN when biasState has no rows", async () => {
    queueStandardSelects({ regimeRows: [] });
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      needsFirstTimeFreeze: true,
      incompleteGateCount: 3,
      gateEvidenceStatuses: ["legacy_null", "legacy_null", "legacy_null"],
    });

    await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(mockFreezePolicy).toHaveBeenCalledWith(STRAT_ID, "UNKNOWN");
  });

  it("does NOT call freezePolicyForStrategy when the evaluator does not request a freeze (existing hash)", async () => {
    queueStandardSelects({ strategy: strategyRow({ frozenPolicyHash: "b".repeat(64) }) });
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      needsFirstTimeFreeze: undefined,
      incompleteGateCount: 3, // still stop at the governor so we never reach the tx
      gateEvidenceStatuses: ["legacy_null", "legacy_null", "legacy_null"],
    });

    await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(mockFreezePolicy).not.toHaveBeenCalled();
  });

  it("fail-CLOSED when the freeze write throws: blocks + frozen_policy.hash_compute_failed audit", async () => {
    queueStandardSelects();
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      needsFirstTimeFreeze: true,
      incompleteGateCount: 0,
      gateEvidenceStatuses: ["complete"],
    });
    mockFreezePolicy.mockRejectedValue(new Error("update deadlock"));

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toContain("frozen_policy.first_time_freeze_failed");
    const row = insertedRows.find((r) => r.action === "frozen_policy.hash_compute_failed");
    expect(row).toBeDefined();
    expect(row!.status).toBe("blocked");
  });
});

// ─── B3 (F-3) — evidence-completeness governor on the manual path ─────────────

describe("B3 (F-3) — evidence-completeness governor (>=3 incomplete blocks)", () => {
  it("blocks with lifecycle.promotion_evidence_incomplete when incompleteGateCount >= 3", async () => {
    queueStandardSelects();
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      incompleteGateCount: 4,
      gateEvidenceStatuses: ["legacy_unavailable", "legacy_null", "legacy_null", "legacy_proceed", "complete"],
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toContain("promotion_evidence_incomplete");
    const row = insertedRows.find((r) => r.action === "lifecycle.promotion_evidence_incomplete")!;
    expect(row).toBeDefined();
    expect((row.result as Record<string, unknown>).incomplete_count).toBe(4);
    expect(row.status).toBe("warn"); // exact cron parity
  });

  it("proceeds past the governor when incompleteGateCount < 3", async () => {
    queueStandardSelects();
    mockEvaluateGates.mockReturnValue({
      ...PASS_RESULT,
      incompleteGateCount: 2,
      gateEvidenceStatuses: ["legacy_null", "legacy_proceed", "complete"],
    });

    // Downstream promotion machinery is not mocked to completion (db.transaction
    // throws TX_SENTINEL) — the assertion is purely that the governor did NOT fire.
    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.promotion_evidence_incomplete");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toContain("promotion_evidence_incomplete");
  });
});

// ─── B5 (architect-M2) — orphan lifecycle states registered ───────────────────

describe("B5 (architect-M2) — NEEDS_REVISION / NEEDS_ARCHETYPE state machine edges", () => {
  it("accepts NEEDS_REVISION → CANDIDATE (transition valid; fails later only on missing row)", async () => {
    selectQueue.push([]); // strategy pre-read → not found
    const res = await svc().promoteStrategy(STRAT_ID, "NEEDS_REVISION" as never, "CANDIDATE", {});
    expect(res.success).toBe(false);
    expect(res.error).toBe("Strategy not found"); // proves the transition validation PASSED
  });

  it("accepts NEEDS_ARCHETYPE → CANDIDATE", async () => {
    selectQueue.push([]);
    const res = await svc().promoteStrategy(STRAT_ID, "NEEDS_ARCHETYPE" as never, "CANDIDATE", {});
    expect(res.error).toBe("Strategy not found");
  });

  it("accepts CANDIDATE → NEEDS_REVISION and CANDIDATE → NEEDS_ARCHETYPE", async () => {
    selectQueue.push([]);
    const r1 = await svc().promoteStrategy(STRAT_ID, "CANDIDATE", "NEEDS_REVISION" as never, {});
    expect(r1.error).toBe("Strategy not found");
    selectQueue.push([]);
    const r2 = await svc().promoteStrategy(STRAT_ID, "CANDIDATE", "NEEDS_ARCHETYPE" as never, {});
    expect(r2.error).toBe("Strategy not found");
  });

  it("accepts TESTING → NEEDS_REVISION and rework → GRAVEYARD", async () => {
    selectQueue.push([]);
    const r1 = await svc().promoteStrategy(STRAT_ID, "TESTING", "NEEDS_REVISION" as never, {});
    expect(r1.error).toBe("Strategy not found");
    selectQueue.push([]);
    const r2 = await svc().promoteStrategy(STRAT_ID, "NEEDS_REVISION" as never, "GRAVEYARD", {});
    expect(r2.error).toBe("Strategy not found");
    selectQueue.push([]);
    const r3 = await svc().promoteStrategy(STRAT_ID, "NEEDS_ARCHETYPE" as never, "GRAVEYARD", {});
    expect(r3.error).toBe("Strategy not found");
  });

  it("REJECTS NEEDS_REVISION → PAPER (rework states never shortcut to capital states)", async () => {
    const res = await svc().promoteStrategy(STRAT_ID, "NEEDS_REVISION" as never, "PAPER", {});
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid transition");
  });

  it("REJECTS NEEDS_ARCHETYPE → TESTING / DEPLOY_READY", async () => {
    const r1 = await svc().promoteStrategy(STRAT_ID, "NEEDS_ARCHETYPE" as never, "TESTING", {});
    expect(r1.error).toContain("Invalid transition");
    const r2 = await svc().promoteStrategy(STRAT_ID, "NEEDS_ARCHETYPE" as never, "DEPLOY_READY", {});
    expect(r2.error).toContain("Invalid transition");
  });
});
