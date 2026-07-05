/**
 * deepscan17-wave2-a7-manual-path.test.ts — Deep-scan #17 Fix Wave 2 (A7)
 *
 * A7 HIGH (same class as the A-1 DSL-guards manual-path gap) — the A7 Signal
 * Correlation HARD gate (checkSignalCorrelationGate: cosine similarity > 0.85 vs any
 * DEPLOYED strategy, also blocks when no signal vector exists) was wired ONLY inside
 * checkAutoPromotions (the autonomous cron). The MANUAL promotion path
 * (_promoteStrategyInner, backing the HMAC-authenticated PATCH /api/strategies/:id/lifecycle
 * route) delegated PAPER→DEPLOY_READY to evaluatePaperToDeployReadyGates, which has ZERO A7
 * references — so a correctly-signed manual/n8n/Carter promotion of a signal-duplicate
 * strategy reached DEPLOY_READY and, downstream, live capital.
 *
 * This file proves the manual PAPER→DEPLOY_READY path now BLOCKS a signal-duplicate strategy
 * (before the shared evaluator + on-demand survival-twin replay), fails CLOSED on an A7
 * infrastructure error, and PASSES a non-duplicate strategy through to the shared evaluator.
 *
 * Harness mirrors deepscan17-dsl-guards-manual-path.test.ts. The backtest carries a CLEAN
 * dsl_guards blob so the A-1 DSL gate (which runs first) passes and A7 is reached.
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
const mockA7 = vi.fn();

/** Rows captured from db.insert(...).values(...) — audit assertions read this. */
const insertedRows: Record<string, unknown>[] = [];

/** SSE events captured from broadcastSSE(event, payload). */
const sseEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];

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
  LIFECYCLE_GATE_EVENTS: new Proxy({}, { get: (_t, p) => `lifecycle:${String(p)}` }),
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
vi.mock("../lib/shadow-signal-divergence-loader.js", () => ({
  loadDivergenceInputs: (...args: unknown[]) => mockLoadDiv(...args),
}));
vi.mock("../lib/shadow-to-paper-gate.js", () => ({
  evaluateShadowToPaperGate: (...args: unknown[]) => mockShadowGate(...args),
}));
vi.mock("../lib/frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  get freezePolicyForStrategy() { return mockFreezePolicy; },
}));
vi.mock("../lib/bif-gate.js", () => ({
  evaluateBifGate: vi.fn(() => ({ passed: true, reason: "bif.clean", legacyNull: false, auditPayload: {} })),
}));
vi.mock("../services/multi-firm-promotion-service.js", () => ({ evaluateMultiFirmEligibility: vi.fn() }));

// A7 gate — the manual PAPER→DEPLOY_READY block dynamically imports this module.
vi.mock("../services/signal-correlation-service.js", () => ({
  checkSignalCorrelationGate: (...args: unknown[]) => mockA7(...args),
}));

// The PAPER→DEPLOY_READY branch dynamically imports the evaluator module.
vi.mock("../lib/paper-to-deploy-ready-gates.js", () => ({
  evaluatePaperToDeployReadyGates: (...args: unknown[]) => mockEvaluateGates(...args),
  resolveSurvivalTwinOnDemand: (...args: unknown[]) => mockResolveSurvivalTwin(...args),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { LifecycleService } from "../services/lifecycle-service.js";

// ── Fixtures / helpers ────────────────────────────────────────────────────────

const STRAT_ID = "eeee0002-0000-0000-0000-000000000002";

const strategyRow = (overrides: Record<string, unknown> = {}) => ({
  id: STRAT_ID,
  name: "a7-manual-strategy",
  symbol: "MES",
  lifecycleState: "PAPER",
  config: {},
  frozenPolicyHash: null,
  ...overrides,
});

/** Backtest row with a CLEAN dsl_guards blob so the A-1 DSL gate passes and A7 is reached. */
const backtestRow = (overrides: Record<string, unknown> = {}) => ({
  id: "bt-ds17w2-a7",
  walkForwardResults: null,
  gateResult: null,
  b15Battery: null,
  wrcResult: null,
  spaResult: null,
  bif: null,
  kEff: null,
  propCompliance: null,
  slippageSurvival: null,
  resultExtras: { dsl_guards: { guards_failed: false } },
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
  mockShadowGate.mockResolvedValue({ passed: true, status: "pass", reason: "shadow_divergence_ok", auditPayload: {} });
  // Default A7: PASS (non-duplicate). Individual tests override.
  mockA7.mockResolvedValue({ allowed: true, reason: "A7 pass", maxSimilarity: 0.12, blockingStrategyId: null });
  // Evaluator returns a benign non-A7 block so a PASS-through of the A7 gate is
  // observable without modeling the entire downstream gate stack.
  mockEvaluateGates.mockReturnValue({
    passed: false, status: "blocked",
    auditAction: "lifecycle.b15_parameter_robustness_blocked",
    auditPayload: {}, reason: "b15_parameter_robustness_failed",
    incompleteGateCount: 0, gateEvidenceStatuses: ["complete"],
  });
});

const svc = () => new LifecycleService();

describe("A7 — manual PAPER→DEPLOY_READY signal correlation gate", () => {
  it("BLOCKS a signal-duplicate strategy before the evaluator / survival replay", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);   // 1 strategy pre-read
    selectQueue.push([backtestRow()]);                              // 2 latest completed backtest
    mockA7.mockResolvedValue({
      allowed: false,
      reason: "signal_correlation_too_high",
      maxSimilarity: 0.93,
      blockingStrategyId: "dep-0001",
    });

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toBe("lifecycle.promotion_blocked_signal_correlation");
    const row = insertedRows.find((r) => r.action === "lifecycle.promotion_blocked_signal_correlation")!;
    expect(row).toBeDefined();
    expect(row.status).toBe("failure");
    expect((row.result as Record<string, unknown>).max_similarity).toBe(0.93);
    expect((row.result as Record<string, unknown>).blocking_strategy_id).toBe("dep-0001");
    expect((row.result as Record<string, unknown>).threshold).toBe(0.85);
    // Rejected BEFORE the shared evaluator and the on-demand survival-twin Python replay.
    expect(mockEvaluateGates).not.toHaveBeenCalled();
    expect(mockResolveSurvivalTwin).not.toHaveBeenCalled();
    // A7 was evaluated on the correct strategy id.
    expect(mockA7).toHaveBeenCalledWith(STRAT_ID);
  });

  it("FAILS CLOSED (blocks) when the A7 gate throws an infrastructure error", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);
    selectQueue.push([backtestRow()]);
    mockA7.mockRejectedValue(new Error("signal-correlation DB unavailable"));

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toBe("lifecycle.promotion_blocked_signal_correlation");
    const row = insertedRows.find((r) => r.action === "lifecycle.promotion_blocked_signal_correlation")!;
    expect(row).toBeDefined();
    expect(String((row.result as Record<string, unknown>).reason)).toContain("infrastructure error");
    expect(mockEvaluateGates).not.toHaveBeenCalled();
  });

  it("PASSES a non-duplicate strategy through to the shared evaluator", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);   // 1 strategy pre-read
    selectQueue.push([backtestRow()]);                              // 2 latest completed backtest
    selectQueue.push([]);                                          // 3 latest MC (none)
    selectQueue.push([{ id: STRAT_ID, config: {}, frozenPolicyHash: null }]); // 4 frozen shadow
    // mockA7 default: allowed=true

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    // A7 did NOT block; flow reached the shared evaluator (which returns the b15 block).
    expect(auditActions()).not.toContain("lifecycle.promotion_blocked_signal_correlation");
    expect(mockA7).toHaveBeenCalledWith(STRAT_ID);
    expect(mockEvaluateGates).toHaveBeenCalledTimes(1);
    expect(res.error).toBe("b15_parameter_robustness_failed");
  });
});
