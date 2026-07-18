/**
 * deepscan17-dsl-guards-manual-path.test.ts — Deep-scan #17 Fix Wave 1 (A-1)
 *
 * A-1 CRITICAL — the E-1 DSL guards_failed HARD gate was wired ONLY inside
 * checkAutoPromotions (the autonomous cron): all 3 cron call sites (TESTING→PAPER,
 * SHADOW→PAPER, PAPER→DEPLOY_READY) gate on backtests.result_extras.dsl_guards.guards_failed,
 * but the MANUAL promotion path (_promoteStrategyInner, backing the HMAC-authenticated
 * PATCH /api/strategies/:id/lifecycle route) had NO such gate. A correctly-signed
 * manual/n8n/Carter promotion of a strategy whose latest completed backtest had
 * guards_failed=true (an UNGUARDED backtest — E.3/E.4/E.5 stop-ceiling / time-stop /
 * DLL enforcement never ran) reached PAPER and, downstream, live capital.
 *
 * This file proves the manual path now BLOCKS a guards_failed=true strategy at all 3
 * transitions and PASSES a guards_failed=false / legacy-null one, via the SAME pure
 * evaluateDslGuardsGate the cron sites use.
 *
 * Harness mirrors deepscan7-lifecycle-manual-path-parity.test.ts: imports the REAL
 * LifecycleService with its full dependency surface mocked, drives promoteStrategy()
 * through a FIFO selectQueue, and asserts on captured audit rows.
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
  // deep-scan Obs re-verify #4: real catalog values are lowercase snake_case ("lifecycle:dsl_guards_evaluated"),
  // so the mock must lowercase the SCREAMING_SNAKE prop — else DSL_GUARDS_EVALUATED resolved to the wrong
  // (uppercase) event string once the broadcast site switched from the raw literal to the constant.
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
  // Production's manual SHADOW→PAPER path now imports getMinSampleSize() alongside
  // evaluateShadowToPaperGate — the mock factory must provide it or the dynamic
  // import destructure throws.
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

// deepscan17-wave2 (2026-07-05): the manual PAPER→DEPLOY_READY path now runs the A7 signal
// correlation gate (checkSignalCorrelationGate) AFTER the DSL guards gate. This DSL-focused
// test mocks A7 to PASS so its guards-clean/legacy cases still reach the shared evaluator.
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

const STRAT_ID = "eeee0001-0000-0000-0000-000000000001";

// Gate 3 manual/cron precondition parity (ratify-packet gate3-manual-cron-parity-2026-07-17):
// _promoteStrategyInner now checks tradingDays >= 30 && rollingSharpe >= 1.5 BEFORE reaching
// the DSL guards gate on the PAPER→DEPLOY_READY branch (not on TESTING→PAPER/SHADOW→PAPER —
// those transitions never run the new check). The fixture must satisfy that precondition so
// the 3 PAPER→DEPLOY_READY tests below still reach the DSL guards gate they target.
const QUALIFYING_LIFECYCLE_CHANGED_AT = new Date("2026-01-01T00:00:00.000Z");
const QUALIFYING_ROLLING_SHARPE = "2.0";
/** 30 distinct-day rows for the new trading-days precondition query (PAPER→DEPLOY_READY only). */
const THIRTY_TRADING_DAYS = Array.from({ length: 30 }, (_, i) => ({ day: `2026-01-${String(i + 2).padStart(2, "0")}` }));

const strategyRow = (overrides: Record<string, unknown> = {}) => ({
  id: STRAT_ID,
  name: "dsl-guards-manual-strategy",
  symbol: "MES",
  lifecycleState: "PAPER",
  config: {},
  frozenPolicyHash: null,
  lifecycleChangedAt: QUALIFYING_LIFECYCLE_CHANGED_AT,
  rollingSharpe30d: QUALIFYING_ROLLING_SHARPE,
  ...overrides,
});

/** Backtest row with a controllable dsl_guards blob under result_extras. */
const backtestRow = (dslGuards: unknown, overrides: Record<string, unknown> = {}) => ({
  id: "bt-ds17-0001",
  walkForwardResults: null,
  gateResult: null,
  b15Battery: null,
  wrcResult: null,
  spaResult: null,
  bif: null,
  kEff: null,
  propCompliance: null,
  slippageSurvival: null,
  resultExtras: dslGuards === undefined ? {} : { dsl_guards: dslGuards },
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
  // Evaluator returns a benign non-DSL block so a PASS-through of the DSL gate is
  // observable without modeling the entire downstream gate stack.
  mockEvaluateGates.mockReturnValue({
    passed: false, status: "blocked",
    auditAction: "lifecycle.b15_parameter_robustness_blocked",
    auditPayload: {}, reason: "b15_parameter_robustness_failed",
    incompleteGateCount: 0, gateEvidenceStatuses: ["complete"],
  });
});

const svc = () => new LifecycleService();
const GUARDS_FAILED = { guards_failed: true, guards_failed_reason: "stop_ceiling_exception" };
const GUARDS_CLEAN = { guards_failed: false };

// ─── PAPER → DEPLOY_READY (delegates to paper-to-deploy-ready-gates.ts) ────────

describe("A-1 — manual PAPER→DEPLOY_READY DSL guards gate", () => {
  it("BLOCKS a guards_failed=true strategy before the evaluator / survival replay", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);   // 1 strategy pre-read
    selectQueue.push(THIRTY_TRADING_DAYS);                          // 2 Gate 3 precondition trading-days query
    selectQueue.push([backtestRow(GUARDS_FAILED)]);                 // 3 latest completed backtest

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(res.success).toBe(false);
    expect(res.error).toBe("lifecycle.dsl_guards_failed_block");
    const row = insertedRows.find((r) => r.action === "lifecycle.dsl_guards_failed_block")!;
    expect(row).toBeDefined();
    expect(row.status).toBe("failure");
    expect((row.result as Record<string, unknown>).guards_failed).toBe(true);
    // Rejected BEFORE the shared evaluator and the on-demand survival-twin Python replay.
    expect(mockEvaluateGates).not.toHaveBeenCalled();
    expect(mockResolveSurvivalTwin).not.toHaveBeenCalled();
    // Dedicated SSE mirrors the cron site.
    expect(sseEvents.some((e) => e.event === "lifecycle:dsl_guards_evaluated" && e.payload.passed === false)).toBe(true);
  });

  it("PASSES a guards_failed=false strategy through to the shared evaluator", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);   // 1 strategy pre-read
    selectQueue.push(THIRTY_TRADING_DAYS);                          // 2 Gate 3 precondition trading-days query
    selectQueue.push([backtestRow(GUARDS_CLEAN)]);                  // 3 latest completed backtest
    selectQueue.push([]);                                          // 4 latest MC (none)
    selectQueue.push([{ id: STRAT_ID, config: {}, frozenPolicyHash: null }]); // 5 frozen shadow

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    // DSL gate did NOT block; flow reached the shared evaluator (which returns the b15 block).
    expect(auditActions()).not.toContain("lifecycle.dsl_guards_failed_block");
    expect(auditActions()).toContain("lifecycle.dsl_guards_pass");
    expect(mockEvaluateGates).toHaveBeenCalledTimes(1);
    expect(res.error).toBe("b15_parameter_robustness_failed");
  });

  it("PASSES (legacy grandfather) when dsl_guards is entirely absent", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "PAPER" })]);   // 1 strategy pre-read
    selectQueue.push(THIRTY_TRADING_DAYS);                          // 2 Gate 3 precondition trading-days query
    selectQueue.push([backtestRow(undefined)]);                    // 3 backtest with no dsl_guards
    selectQueue.push([]);                                          // 4 latest MC (none)
    selectQueue.push([{ id: STRAT_ID, config: {}, frozenPolicyHash: null }]); // 5 frozen shadow

    const res = await svc().promoteStrategy(STRAT_ID, "PAPER", "DEPLOY_READY", {});

    expect(auditActions()).not.toContain("lifecycle.dsl_guards_failed_block");
    expect(auditActions()).toContain("lifecycle.dsl_guards_unavailable_legacy");
    expect(mockEvaluateGates).toHaveBeenCalledTimes(1);
    expect(res.error).toBe("b15_parameter_robustness_failed");
  });
});

// ─── TESTING → PAPER (legacy fast-track edge into PAPER) ──────────────────────

describe("A-1 — manual TESTING→PAPER DSL guards gate", () => {
  it("BLOCKS a guards_failed=true strategy", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "TESTING" })]); // 1 strategy pre-read
    selectQueue.push([backtestRow(GUARDS_FAILED)]);                // 2 DSL guards fetch

    const res = await svc().promoteStrategy(STRAT_ID, "TESTING", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toBe("lifecycle.dsl_guards_failed_block");
    const row = insertedRows.find((r) => r.action === "lifecycle.dsl_guards_failed_block")!;
    expect(row).toBeDefined();
    expect(row.status).toBe("failure");
    expect((row.input as Record<string, unknown>).fromState).toBe("TESTING");
    expect(sseEvents.some((e) => e.event === "lifecycle:dsl_guards_evaluated" && e.payload.passed === false)).toBe(true);
  });

  it("does NOT block a guards_failed=false strategy (clean DSL pass audit written)", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "TESTING" })]);
    selectQueue.push([backtestRow(GUARDS_CLEAN)]);
    // Downstream reads return [] (queue drained) — the assertion is purely that the
    // DSL gate did not block; the rest of the TESTING→PAPER stack is out of scope here.
    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "TESTING", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.dsl_guards_failed_block");
    expect(auditActions()).toContain("lifecycle.dsl_guards_pass");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toBe("lifecycle.dsl_guards_failed_block");
  });

  it("does NOT block a legacy (absent dsl_guards) strategy", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "TESTING" })]);
    selectQueue.push([backtestRow(undefined)]);
    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "TESTING", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.dsl_guards_failed_block");
    expect(auditActions()).toContain("lifecycle.dsl_guards_unavailable_legacy");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toBe("lifecycle.dsl_guards_failed_block");
  });
});

// ─── SHADOW → PAPER (canonical edge into PAPER) ───────────────────────────────

describe("A-1 — manual SHADOW→PAPER DSL guards gate", () => {
  it("BLOCKS a guards_failed=true strategy (after the divergence gate clears)", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);  // 1 strategy pre-read
    selectQueue.push([backtestRow(GUARDS_FAILED)]);                // 2 DSL guards fetch

    const res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});

    expect(res.success).toBe(false);
    expect(res.error).toBe("lifecycle.dsl_guards_failed_block");
    const row = insertedRows.find((r) => r.action === "lifecycle.dsl_guards_failed_block")!;
    expect(row).toBeDefined();
    expect((row.input as Record<string, unknown>).fromState).toBe("SHADOW");
    // The SHADOW→PAPER divergence gate ran first and passed, then the DSL gate blocked.
    expect(mockShadowGate).toHaveBeenCalledTimes(1);
    expect(sseEvents.some((e) => e.event === "lifecycle:dsl_guards_evaluated" && e.payload.passed === false)).toBe(true);
  });

  it("does NOT block a guards_failed=false strategy", async () => {
    selectQueue.push([strategyRow({ lifecycleState: "SHADOW" })]);
    selectQueue.push([backtestRow(GUARDS_CLEAN)]);
    let res: { success: boolean; error?: string } | undefined;
    let thrown: unknown = null;
    try {
      res = await svc().promoteStrategy(STRAT_ID, "SHADOW", "PAPER", {});
    } catch (err) {
      thrown = err;
    }

    expect(auditActions()).not.toContain("lifecycle.dsl_guards_failed_block");
    expect(auditActions()).toContain("lifecycle.dsl_guards_pass");
    const errText = res?.error ?? String(thrown);
    expect(errText).not.toBe("lifecycle.dsl_guards_failed_block");
  });
});
