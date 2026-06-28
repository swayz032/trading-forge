/**
 * auto-graveyard-behavior.test.ts — Behavior tests for _maybeAutoGraveyard()
 *
 * Tests assert REAL RUNTIME BEHAVIOR (promoteStrategy call presence, arguments,
 * early-return conditions) not source-code string matching.
 *
 * Real _maybeAutoGraveyard signature (private):
 *   private async _maybeAutoGraveyard(
 *     strategyId: string,
 *     gate: string,
 *     metrics: Record<string, unknown>,
 *     fromState: LifecycleState,
 *     correlationId: string | null,
 *   ): Promise<void>
 *
 * Core behavior sequence:
 *   Step 1 — Inserts `lifecycle.hard_gate_fail.<gate>` audit row (non-blocking .catch)
 *   Step 2 — SELECTs most-recent `lifecycle.hard_gate_reset.<gate>` row to bound the window
 *   Step 3 — SELECTs `lifecycle.hard_gate_fail.<gate>` rows since the last reset
 *   Step 4 — Returns early when consecutiveFailures < threshold
 *             (env LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD, default 3)
 *   Step 5 — Re-reads current lifecycleState; returns if already GRAVEYARD or strategy missing
 *   Step 6 — Calls this.promoteStrategy(id, fromState, "GRAVEYARD",
 *             {actor:"system", reason:"hard_gate_fail:<gate>", correlationId})
 *   Step 7 — On success: inserts audit row, increments Prometheus, broadcasts SSE, Discord warn
 *
 * DB SELECT call order (per invocation of _maybeAutoGraveyard):
 *   Call 1: last-reset row — .from().where().orderBy().limit(1)
 *   Call 2: consecutive-failure rows — .from().where()  (awaited directly, no .limit)
 *   Call 3: current strategy state — .from().where()    (awaited directly, no .limit)
 *           (only reached when consecutiveFailures >= threshold)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state — plain module-level vi.fn() references, accessed via getters
// so vi.mock factories resolve them at getter-call time (after init) ────────

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();

const mockAutoGraveyardLabels = vi.fn(() => ({ inc: vi.fn() }));
const mockAutoGraveyardTotal = { labels: mockAutoGraveyardLabels };

const mockBroadcastSSE = vi.fn();
const mockNotifyWarning = vi.fn();

// ── Module mocks — must be declared before any `import` ──────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
  },
}));

vi.mock("../db/schema.js", () => ({
  strategies:           { id: "id", lifecycleState: "lifecycleState" },
  strategyNames:        {},
  strategyGraveyard:    {},
  backtests:            {},
  auditLog: {
    action:            "action",
    entityId:          "entityId",
    entityType:        "entityType",
    createdAt:         "createdAt",
    id:                "id",
    status:            "status",
    decisionAuthority: "decisionAuthority",
    input:             "input",
    result:            "result",
    correlationId:     "correlationId",
  },
  lifecycleTransitions: {},
  monteCarloRuns:       {},
  quantumMcRuns:        {},
  paperSessions:        {},
  paperTrades:          {},
  complianceRulesets:   { firm: "firm", createdAt: "createdAt", driftDetected: "driftDetected", status: "status" },
  pilotSessions:        {},
}));

// drizzle-orm helpers return opaque sentinels; the mocked db chain ignores them
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
  get autoGraveyardTotal()              { return mockAutoGraveyardTotal; },
  strategyPromotions:                   { labels: vi.fn(() => ({ inc: vi.fn() })) },
  pboBlocksTotal:                       { labels: vi.fn(() => ({ inc: vi.fn() })) },
  lifecycleShadowPromotionsTotal:       { labels: vi.fn(() => ({ inc: vi.fn() })) },
  httpRequestDurationMs:                { observe: vi.fn(), labels: vi.fn(() => ({ observe: vi.fn() })) },
  tfArchetypeSignalsTotal:              { labels: vi.fn(() => ({ inc: vi.fn() })) },
  candidateConveyorEnqueuedTotal:       { inc: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({
  get broadcastSSE() { return mockBroadcastSSE; },
  LIFECYCLE_GATE_EVENTS: {
    AUTO_GRAVEYARD:              "lifecycle:auto_graveyard",
    PROMOTION_EVIDENCE_INCOMPLETE: "lifecycle.promotion_evidence_incomplete",
    B14_EVALUATED:               "lifecycle:b14_evaluated",
    WFE_EVALUATED:               "lifecycle:wfe_evaluated",
    PARAMETER_DRIFT_EVALUATED:   "lifecycle:parameter_drift_evaluated",
    BIF_EVALUATED:               "lifecycle:bif_evaluated",
    PBO_EVALUATED:               "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
  },
}));

vi.mock("../services/notification-service.js", () => ({
  get notifyWarning() { return mockNotifyWarning; },
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (op: string) => op,
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn(() => ({
      setAttribute:    vi.fn(),
      end:             vi.fn(),
      setStatus:       vi.fn(),
      recordException: vi.fn(),
    })),
  },
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow:     vi.fn(),
  insertAuditRowSafe: vi.fn(),
}));

vi.mock("../lib/quantum-agreement.js", () => ({
  computeAgreement: vi.fn(),
}));

vi.mock("../services/adversarial-stress-service.js", () => ({
  getLatestAdversarialStressRun: vi.fn(),
}));

vi.mock("../services/frankenstein-service.js", () => ({
  getLatestFrankensteinRun: vi.fn(),
}));

vi.mock("../services/evolution-service.js", () => ({
  evolveStrategy: vi.fn(),
}));

vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { circuitOpen: vi.fn(), notifyCookieRefreshFailed: vi.fn() },
}));

vi.mock("../services/pine-export-service.js", () => ({
  compileDualPineExport: vi.fn(),
  compilePineExport:     vi.fn(),
}));

vi.mock("../services/agent-coordinator-service.js", () => ({
  agentCoordinator: { emit: vi.fn() },
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: {
    isHaltedForProduction: vi.fn(() => false),
    isHalted:              vi.fn(() => false),
  },
}));

vi.mock("../lib/b14-ci-gate.js", () => ({
  evaluateB14CiGate:         vi.fn(),
  evaluateDsrWalkForwardGate: vi.fn(),
}));

vi.mock("../lib/wfe-gate.js", () => ({
  evaluateWfeGate: vi.fn(),
}));

vi.mock("../lib/parameter-drift-gate.js", () => ({
  evaluateParameterDriftGate: vi.fn(),
}));

vi.mock("../lib/composite-shadow-gate.js", () => ({
  evaluateCompositeShadow: vi.fn(),
}));

vi.mock("../lib/composite-shadow-discord-router.js", () => ({
  routeShadowDisagreementAlert: vi.fn(),
}));

vi.mock("../lib/promotion-gate-orchestrator.js", () => ({
  evaluatePromotionGates: vi.fn(),
  getWfePromotionFloor:   vi.fn(),
  getCpcvMinPaths:        vi.fn(),
}));

vi.mock("../lib/pbo-gate.js", () => ({
  evaluatePboGate: vi.fn(),
}));

vi.mock("../lib/shadow-signal-divergence-checker.js", () => ({
  compareShadowToBacktest: vi.fn(),
}));

vi.mock("../lib/shadow-signal-divergence-loader.js", () => ({
  loadDivergenceInputs: vi.fn(),
}));

vi.mock("../lib/frozen-policy-contract.js", () => ({
  evaluateFrozenPolicyDriftAtPromotion: vi.fn(),
  freezePolicyForStrategy:              vi.fn(),
}));

vi.mock("../lib/bif-gate.js", () => ({
  evaluateBifGate: vi.fn(),
}));

vi.mock("../services/multi-firm-promotion-service.js", () => ({
  evaluateMultiFirmEligibility: vi.fn(),
}));

// ── Subject under test ───────────────────────────────────────────────────────

import { LifecycleService } from "../services/lifecycle-service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wire up the three db.select() calls that _maybeAutoGraveyard makes in order:
 *
 *   Call 1 — last-reset query   → .from().where().orderBy().limit(1)
 *   Call 2 — fail-count query   → .from().where()  (awaited directly)
 *   Call 3 — current-state query → .from().where()  (awaited directly)
 *             (only issued when consecutiveFailures >= threshold)
 */
function setupSelectMock(
  lastResetRows: unknown[],
  failRows: unknown[],
  strategyRows: unknown[],
) {
  // Call 1: needs the .orderBy().limit() chain
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(lastResetRows)),
        })),
      })),
    })),
  });

  // Call 2: .where() is awaited directly (no .limit())
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(failRows)),
    })),
  });

  // Call 3: .where() is awaited directly (no .limit())
  mockSelectFn.mockReturnValueOnce({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(strategyRows)),
    })),
  });
}

/** Configure the insert mock to silently succeed (handles multiple calls). */
function setupInsertMock() {
  mockInsertFn.mockReturnValue({
    values: vi.fn(() => ({
      catch: vi.fn(),
    })),
  });
}

// ── Constants shared across tests ────────────────────────────────────────────

const STRATEGY_ID    = "strat-000-abc";
const GATE           = "b14_ci_high";
const METRICS        = { ciHigh: 0.55, threshold: 0.40 };
const FROM_STATE     = "TESTING" as const;
const CORRELATION_ID = "corr-test-xyz";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("_maybeAutoGraveyard — behavior", () => {
  let service: LifecycleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let promoteStrategySpy: any;

  beforeEach(() => {
    // vi.resetAllMocks() (not clearAllMocks) is required here.
    // clearAllMocks() only wipes call history — it does NOT drain the
    // mockReturnValueOnce() queue. Tests that early-return (e.g. below-threshold
    // guard) leave unconsumed entries in the queue that poison the next test's
    // select chain with a wrong shape (missing .orderBy on the last-reset call).
    // resetAllMocks() drains the queue AND resets implementations.
    vi.resetAllMocks();
    delete process.env.LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD;
    setupInsertMock();

    service = new LifecycleService();
    promoteStrategySpy = vi
      .spyOn(service, "promoteStrategy")
      .mockResolvedValue({ success: true });
  });

  // ── Test 1: Buries on Nth consecutive hard fail ───────────────────────────
  it("calls promoteStrategy to GRAVEYARD when consecutive failures reach the threshold (default=3)", async () => {
    // Scenario: no previous reset, exactly 3 failures in DB (= threshold)
    setupSelectMock(
      [],                                                // no reset row
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }],      // 3 fail rows = threshold
      [{ lifecycleState: "TESTING" }],                   // current state != GRAVEYARD
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    // promoteStrategy must be called exactly once with GRAVEYARD as destination
    expect(promoteStrategySpy).toHaveBeenCalledOnce();
    expect(promoteStrategySpy).toHaveBeenCalledWith(
      STRATEGY_ID,
      FROM_STATE,
      "GRAVEYARD",
      expect.objectContaining({
        actor:  "system",
        reason: `hard_gate_fail:${GATE}`,
      }),
    );
  });

  // ── Test 2: Does NOT bury before threshold ────────────────────────────────
  it("does NOT call promoteStrategy when consecutive failures are below the threshold", async () => {
    // Scenario: 2 failures in DB < threshold of 3 → early return at step 4
    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }],   // 2 fail rows < threshold
      [],                              // select call 3 never reached
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    // promoteStrategy must NOT have been called with GRAVEYARD at all
    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);
  });

  // ── Test 3: Zero-history gate — transient/legacy gates never accumulate ───
  it("does NOT bury when the gate has zero consecutive failure rows in the DB (transient gate)", async () => {
    // Scenario: calling with a "transient" gate name that has no recorded failures.
    // In production, lifecycle code never calls _maybeAutoGraveyard for transient
    // gates (e.g. wfe_unavailable_legacy), so their action key accumulates no rows.
    // Even if called directly, count=0 < threshold=3 → no burial.
    setupSelectMock(
      [],  // no reset row
      [],  // 0 fail rows for this gate action key
      [],  // never reached
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, "wfe_unavailable_legacy", {}, FROM_STATE, null,
    );

    // promoteStrategy must NOT have been called with GRAVEYARD
    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);
  });

  // ── Test 4: Already-GRAVEYARD → premature-burial guard ───────────────────
  it("does NOT re-bury when the strategy is already in GRAVEYARD state", async () => {
    // Scenario: count is at threshold, but current state IS GRAVEYARD.
    // Step 5 guard should prevent calling promoteStrategy.
    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }],   // at threshold
      [{ lifecycleState: "GRAVEYARD" }],              // already buried
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    // Double-bury guard must have fired — no GRAVEYARD promotion
    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);
  });

  // ── Test 4b: Missing strategy → premature-burial guard ────────────────────
  it("does NOT call promoteStrategy when the strategy row is missing from the DB", async () => {
    // Scenario: count at threshold, but the strategy SELECT returns empty.
    // Step 5 guard: !current → return early.
    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }],   // at threshold
      [],                                             // strategy not found
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);
  });

  // ── Test 5: Reset path — consecutive counter resets on gate pass ──────────
  it("does NOT bury when a recent reset row bounds the consecutive count below threshold", async () => {
    // Scenario: 3 total failures exist in the DB, BUT a reset row was written
    // after 2 of them (e.g., the gate PASSED once between failures).
    // The SELECT for failures is bounded to rows AFTER the reset → only 1 row
    // since the reset. 1 < threshold(3) → no burial.
    //
    // This verifies that _resetHardGateCounter() (called on gate-pass at call
    // sites) correctly prevents stale failures from accumulating across recoveries.
    const recentResetTime = new Date("2026-06-28T10:00:00Z");

    setupSelectMock(
      [{ createdAt: recentResetTime }],  // reset row exists
      [{ id: "f3" }],                    // only 1 failure SINCE the reset
      [],                                // never reached
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    // Must NOT bury — only 1 consecutive failure since the last successful pass
    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);
  });

  // ── Bonus: correct fromState is forwarded to promoteStrategy ─────────────
  it("passes the caller-supplied fromState (not a hard-coded value) to promoteStrategy", async () => {
    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }],
      [{ lifecycleState: "PAPER" }],
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, "signal_correlation", { maxSimilarity: 0.95 }, "PAPER", null,
    );

    expect(promoteStrategySpy).toHaveBeenCalledWith(
      STRATEGY_ID,
      "PAPER",              // fromState forwarded verbatim
      "GRAVEYARD",
      expect.objectContaining({ reason: "hard_gate_fail:signal_correlation" }),
    );
  });

  // ── Bonus: custom threshold via env ──────────────────────────────────────
  it("respects LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD env override", async () => {
    process.env.LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD = "5";

    // 4 failures < custom threshold of 5 → no burial
    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }, { id: "f4" }],
      [],
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    const graveyardCalls = promoteStrategySpy.mock.calls.filter(
      (args: unknown[]) => args[2] === "GRAVEYARD",
    );
    expect(graveyardCalls).toHaveLength(0);

    // Now 5 failures = custom threshold → burial
    vi.resetAllMocks();  // must drain mockReturnValueOnce queue from the first half
    setupInsertMock();
    promoteStrategySpy = vi
      .spyOn(service, "promoteStrategy")
      .mockResolvedValue({ success: true });

    setupSelectMock(
      [],
      [{ id: "f1" }, { id: "f2" }, { id: "f3" }, { id: "f4" }, { id: "f5" }],
      [{ lifecycleState: "TESTING" }],
    );

    await (service as any)._maybeAutoGraveyard(
      STRATEGY_ID, GATE, METRICS, FROM_STATE, CORRELATION_ID,
    );

    expect(promoteStrategySpy).toHaveBeenCalledWith(
      STRATEGY_ID, FROM_STATE, "GRAVEYARD", expect.any(Object),
    );
  });
});
