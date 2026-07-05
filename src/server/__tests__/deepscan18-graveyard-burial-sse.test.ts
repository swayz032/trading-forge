/**
 * deepscan18-graveyard-burial-sse.test.ts — Regression test for the E-E1 fix:
 * `buryInGraveyard()` (private, lifecycle-service.ts) is the ONLY production
 * call site of a strategy's terminal graveyard burial. The frontend has
 * carried a fully-typed `strategy:graveyard_burial` dashboard tile
 * (useSSE.ts + sse-events.ts StrategyGraveyardBurialData) since it was
 * catalogued, but the emit was never wired — the tile was silently dead.
 *
 * This test proves `broadcastSSE("strategy:graveyard_burial", {...})` now
 * fires with the exact payload shape the frontend contract expects, using
 * the same mock scaffold as auto-graveyard-behavior.test.ts (that file tests
 * the sibling `_maybeAutoGraveyard()` gate-failure path; this one tests the
 * terminal burial write path both functions eventually reach).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────────────────────────────────────────────────────

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockDecayAlert = vi.fn(() => Promise.resolve());

// ── Module mocks — must be declared before any `import` ─────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies:           { id: "id", lifecycleState: "lifecycleState" },
  strategyNames:        {},
  strategyGraveyard:    { id: "id", strategyId: "strategyId" },
  backtests:            { id: "id", strategyId: "strategyId", status: "status", createdAt: "createdAt" },
  auditLog: {
    action: "action", entityId: "entityId", entityType: "entityType", createdAt: "createdAt",
    id: "id", status: "status", decisionAuthority: "decisionAuthority", input: "input",
    result: "result", correlationId: "correlationId",
  },
  lifecycleTransitions: {},
  monteCarloRuns:       {},
  quantumMcRuns:        {},
  paperSessions:        {},
  paperTrades:          {},
  complianceRulesets:   { firm: "firm", createdAt: "createdAt", driftDetected: "driftDetected", status: "status" },
  pilotSessions:        {},
}));

vi.mock("drizzle-orm", () => ({
  eq:    vi.fn(() => "__eq__"),
  and:   vi.fn(() => "__and__"),
  desc:  vi.fn(() => "__desc__"),
  gte:   vi.fn(() => "__gte__"),
  sql:   new Proxy(() => "__sql__", { get: () => () => "__sql__" }),
  count: vi.fn(() => "__count__"),
  inArray: vi.fn(() => "__inArray__"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/metrics-registry.js", () => ({
  autoGraveyardTotal:              { labels: vi.fn(() => ({ inc: vi.fn() })) },
  strategyPromotions:              { labels: vi.fn(() => ({ inc: vi.fn() })) },
  pboBlocksTotal:                  { labels: vi.fn(() => ({ inc: vi.fn() })) },
  lifecycleShadowPromotionsTotal:  { labels: vi.fn(() => ({ inc: vi.fn() })) },
  httpRequestDurationMs:           { observe: vi.fn(), labels: vi.fn(() => ({ observe: vi.fn() })) },
  tfArchetypeSignalsTotal:         { labels: vi.fn(() => ({ inc: vi.fn() })) },
  candidateConveyorEnqueuedTotal:  { inc: vi.fn() },
  bifGateEvaluationsTotal:         { labels: vi.fn(() => ({ inc: vi.fn() })) },
  slippageSurvivalBlocksTotal:     { labels: vi.fn(() => ({ inc: vi.fn() })) },
  auditWriteFailuresTotal:         { labels: vi.fn(() => ({ inc: vi.fn() })) },
  b14GateTotal:                    { labels: vi.fn(() => ({ inc: vi.fn() })) },
  wfeGateTotal:                    { labels: vi.fn(() => ({ inc: vi.fn() })) },
  parameterDriftGateTotal:         { labels: vi.fn(() => ({ inc: vi.fn() })) },
  dslGuardsGateTotal:              { labels: vi.fn(() => ({ inc: vi.fn() })) },
}));

vi.mock("../routes/sse.js", () => ({
  get broadcastSSE() { return mockBroadcastSSE; },
  LIFECYCLE_GATE_EVENTS: {
    AUTO_GRAVEYARD:               "lifecycle:auto_graveyard",
    PROMOTION_EVIDENCE_INCOMPLETE: "lifecycle.promotion_evidence_incomplete",
    B14_EVALUATED:                "lifecycle:b14_evaluated",
    WFE_EVALUATED:                "lifecycle:wfe_evaluated",
    PARAMETER_DRIFT_EVALUATED:    "lifecycle:parameter_drift_evaluated",
    BIF_EVALUATED:                "lifecycle:bif_evaluated",
    PBO_EVALUATED:                "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED:  "lifecycle:shadow_divergence_evaluated",
    SLIPPAGE_SURVIVAL_EVALUATED:  "lifecycle:slippage_survival_evaluated",
  },
  WAVE29_EVENTS: {
    SHADOW_LOGGED: "signal:shadow_logged",
    PBO_EVALUATED: "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
    RL_AB_ROUTED: "signal:rl_ab_routed",
    RL_TRAINING_COMPLETED: "quantum_rl:training_completed",
    RL_KILL_SWITCH_ENGAGED: "quantum_rl:kill_switch_engaged",
  },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning:  vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (op: string) => op,
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({
      setAttribute: vi.fn(), end: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(),
    })),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow:     vi.fn(),
  insertAuditRowSafe: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../lib/quantum-agreement.js", () => ({ computeAgreement: vi.fn() }));
vi.mock("../services/adversarial-stress-service.js", () => ({ getLatestAdversarialStressRun: vi.fn() }));
vi.mock("../services/frankenstein-service.js", () => ({ getLatestFrankensteinRun: vi.fn() }));
vi.mock("../services/evolution-service.js", () => ({ evolveStrategy: vi.fn() }));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: {
    circuitOpen:              vi.fn(),
    notifyCookieRefreshFailed: vi.fn(),
    get decayAlert() { return mockDecayAlert; },
  },
}));

vi.mock("../services/pine-export-service.js", () => ({
  compileDualPineExport: vi.fn(),
  compilePineExport:     vi.fn(),
}));
vi.mock("../services/agent-coordinator-service.js", () => ({ agentCoordinator: { emit: vi.fn() } }));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn(() => false), isHalted: vi.fn(() => false) },
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
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(), freezePolicyForStrategy: vi.fn(),
}));
vi.mock("../lib/bif-gate.js", () => ({ evaluateBifGate: vi.fn() }));
vi.mock("../lib/slippage-survival-gate.js", () => ({ evaluateSlippageSurvivalGate: vi.fn() }));
vi.mock("../services/multi-firm-promotion-service.js", () => ({ evaluateMultiFirmEligibility: vi.fn() }));

// ── Subject under test ───────────────────────────────────────────────────────

import { LifecycleService } from "../services/lifecycle-service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * buryInGraveyard() issues exactly 2 selects (in order):
 *   Call 1 — existing-burial idempotency check: .from().where().limit(1)
 *   Call 2 — latest completed backtest lookup:  .from().where().orderBy().limit(1)
 * then 1 insert (strategy_graveyard row).
 */
function setupSelectMock(existingRows: unknown[], backtestRows: unknown[]) {
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(existingRows)),
      })),
    })),
  });
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(backtestRows)),
        })),
      })),
    })),
  });
}

function setupInsertMock() {
  mockInsertFn.mockReturnValue({
    values: vi.fn(() => Promise.resolve(undefined)),
  });
}

const STRATEGY_ID    = "strat-graveyard-abc";
const CORRELATION_ID = "corr-graveyard-xyz";

describe("buryInGraveyard — strategy:graveyard_burial SSE emission (deepscan18 E-E1)", () => {
  let service: LifecycleService;

  beforeEach(() => {
    vi.resetAllMocks();
    setupInsertMock();
    service = new LifecycleService();
  });

  it("broadcasts strategy:graveyard_burial with the exact StrategyGraveyardBurialData shape", async () => {
    // No prior burial row (idempotency check passes), no backtest on file
    // (failureModes falls back to the "alpha_decay" default).
    setupSelectMock([], []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).buryInGraveyard(
      STRATEGY_ID,
      { name: "Test Strategy", config: { some: "dsl" } },
      CORRELATION_ID,
    );

    expect(mockBroadcastSSE).toHaveBeenCalledWith(
      "strategy:graveyard_burial",
      expect.objectContaining({
        strategyId: STRATEGY_ID,
        name: "Test Strategy",
        failureModes: ["alpha_decay"],
        deathReason: "Auto-retired: alpha_decay",
        correlationId: CORRELATION_ID,
      }),
    );
  });

  it("does NOT broadcast when the strategy is already buried (idempotent no-op)", async () => {
    // Existing graveyard row found — function returns early.
    setupSelectMock([{ id: "already-buried-row" }], []);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).buryInGraveyard(
      STRATEGY_ID,
      { name: "Test Strategy", config: {} },
      CORRELATION_ID,
    );

    expect(mockBroadcastSSE).not.toHaveBeenCalled();
    // Idempotency check must short-circuit before any insert.
    expect(mockInsertFn).not.toHaveBeenCalled();
  });

  it("derives failureModes from the latest backtest and includes them in the SSE payload", async () => {
    setupSelectMock(
      [], // not previously buried
      [{
        id: "bt-1",
        sharpeRatio: "0.2",
        profitFactor: "0.8",
        winRate: "0.3",
        maxDrawdown: "5000",
        avgDailyPnl: "100",
        tier: "REJECTED",
        totalTrades: 42,
      }],
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).buryInGraveyard(
      STRATEGY_ID,
      { name: "Losing Strategy", config: {} },
      null,
    );

    expect(mockBroadcastSSE).toHaveBeenCalledWith(
      "strategy:graveyard_burial",
      expect.objectContaining({
        strategyId: STRATEGY_ID,
        name: "Losing Strategy",
        failureModes: expect.arrayContaining([
          "low_sharpe", "unprofitable", "low_win_rate",
          "excessive_drawdown", "below_minimum_daily_pnl", "rejected_by_gate",
        ]),
        correlationId: null,
      }),
    );
  });
});
