/**
 * D-10 N-4 — the auto-backtest enqueue must NAME a refusal, never record it as success.
 *
 * RULING: R-766 §4 lane 2 (Option B).
 *
 * WHY THIS FILE EXISTS AT ALL
 * ───────────────────────────
 * The FIX-3 enqueue block's only previous coverage was `runFix3Logic()` in
 * `auto-recovery-debt1-4.test.ts` — a RE-IMPLEMENTATION of the logic, in a file whose
 * only `import` is vitest and which `vi.mock`s `lifecycle-service.js` outright.
 *
 *   `THE ONE-GREP TEST FOR A REAL HARNESS: IS THE SUBJECT IN ITS OWN MOCK LIST?`
 *   `A REPLICA THAT MOCKS THE MODULE IT IS NAMED AFTER HAS DECLARED, IN EXECUTABLE
 *    CODE, THAT IT IS NOT TESTING IT.`                                   (R-766 §1)
 *
 * Deleting production would not have reddened a single one of those five tests.
 *
 * This file has TWO halves, and they prove different things:
 *   §A WIRING (structural, over the source) — the helper is declared once and invoked
 *      once, fire-and-forget, from executable code.
 *   §B BEHAVIOUR (executes the REAL `LifecycleService.runEvidenceAutoBacktestEnqueue`)
 *      — what the audit trail actually records.
 * Neither is sufficient alone: §A cannot see a decision, §B cannot see the call site.
 *
 * The mock scaffold in §B is ADAPTED from `deepscan18-graveyard-burial-sse.test.ts`
 * (one of six suites that already execute the real service) — R-648: adapt, do not
 * author.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { computeResultHash } from "../lib/result-hasher.js";

// ── Mock state ───────────────────────────────────────────────────────────────

const mockSelectFn = vi.fn();
const mockInsertFn = vi.fn();
const mockBroadcastSSE = vi.fn();
const mockDecayAlert = vi.fn(() => Promise.resolve());
const mockRunBacktest = vi.fn();

// ── Module mocks — must be declared before any `import` of the subject ───────

vi.mock("../db/index.js", () => ({
  db: {
    get select() { return mockSelectFn; },
    get insert() { return mockInsertFn; },
  },
}));

vi.mock("../db/schema.js", () => ({
  // D-10: the shared classifier (`lib/backtest-refusal.ts`) imports this constant
  // from schema. Omit it and `isExecutionRefused()` compares against `undefined`,
  // returns false for EVERY result, and the refusal branch becomes unreachable —
  // the control could never go green no matter how correct the fix. (AR-878 §1 hit
  // this exact trap in the F-10 lane.)
  BACKTEST_STATUS_REFUSED: "refused",
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
  or:    vi.fn(() => "__or__"),
  desc:  vi.fn(() => "__desc__"),
  gte:   vi.fn(() => "__gte__"),
  sql:   new Proxy(() => "__sql__", { get: () => () => "__sql__" }),
  count: vi.fn(() => "__count__"),
  inArray: vi.fn(() => "__inArray__"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("../services/backtest-service.js", () => ({
  get runBacktest() { return mockRunBacktest; },
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

// ── Subject under test — the REAL service, NOT in its own mock list ──────────

import { LifecycleService } from "../services/lifecycle-service.js";
import {
  EVIDENCE_AUTO_BACKTEST_ENQUEUED_ACTION as ENQUEUED_ACTION,
  EVIDENCE_AUTO_BACKTEST_REFUSED_ACTION as REFUSED_ACTION,
} from "../services/lifecycle-service.js";

// ═════════════════════════════════════════════════════════════════════════════
// §A — WIRING GUARD (structural, over production source)
// ═════════════════════════════════════════════════════════════════════════════

const HERE = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_SRC = resolve(HERE, "../services/lifecycle-service.ts");

function sourceLines(): string[] {
  return readFileSync(LIFECYCLE_SRC, "utf8").split("\n");
}

/** Executable lines only — strips `//` line comments and `*` block-comment bodies. */
function executableLines(): string[] {
  return sourceLines().filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  });
}

describe("§A D-10 N-4 wiring guard: the extracted FIX-3 helper is invoked exactly once", () => {
  it("POSITIVE CONTROL: the production source is readable and non-trivial", () => {
    // Without this, every "exactly N" assertion below would also pass on an empty
    // read — an absence claim needs a positive witness that the path ran.
    expect(sourceLines().length).toBeGreaterThan(5000);
    expect(executableLines().length).toBeGreaterThan(3000);
  });

  it("declares the helper exactly once", () => {
    const decls = executableLines().filter((l) => /async runEvidenceAutoBacktestEnqueue\(/.test(l));
    expect(decls).toHaveLength(1);
  });

  it("invokes it exactly once, from executable code, fire-and-forget", () => {
    const calls = executableLines().filter((l) => /this\.runEvidenceAutoBacktestEnqueue\(/.test(l));
    expect(calls).toHaveLength(1);
    expect(calls[0].trim().startsWith("void this.runEvidenceAutoBacktestEnqueue(")).toBe(true);
    expect(calls[0]).not.toMatch(/await\s+this\.runEvidenceAutoBacktestEnqueue/);
  });

  it("NEGATIVE CONTROL: the comment-stripper does not simply erase everything", () => {
    const exec = executableLines().join("\n");
    expect(exec).toContain("async checkAutoPromotions(");
    // this phrase exists only inside the helper's doc comment
    expect(exec).not.toContain("BEHAVIOUR-PRESERVING");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// §B — BEHAVIOUR (executes the REAL helper)
// ═════════════════════════════════════════════════════════════════════════════

const REFUSED_RESULT = {
  id: "bt-refused",
  status: "refused",
  execution_status: "refused",
  condition_id: "C-7",
  disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
  reason: "entry condition not deterministically compilable",
  metrics_omitted: true,
};

/** Rows captured from `db.insert(auditLog).values({...})`. */
let auditRows: Array<Record<string, unknown>>;

/** Drive the 24h-cap lookup: `db.select({...}).from(auditLog).where(...)` → rows. */
function seedPriorAuditRows(rows: unknown[]) {
  mockSelectFn.mockReturnValue({
    from: () => ({ where: () => Promise.resolve(rows) }),
  });
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    strategyId: "strat-abc",
    strategyName: "VWAPGang",
    symbol: "MES",
    incompleteCount: 3,
    totalGates: 8,
    correlationId: "corr-1",
    ...overrides,
  } as Parameters<LifecycleService["runEvidenceAutoBacktestEnqueue"]>[0];
}

describe("§B D-10 N-4: what the audit trail records for the auto-backtest enqueue", () => {
  let service: LifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditRows = [];
    seedPriorAuditRows([]); // no prior enqueue today → cap not reached
    mockInsertFn.mockReturnValue({
      values: (row: Record<string, unknown>) => {
        auditRows.push(row);
        return Promise.resolve(undefined);
      },
    });
    service = new LifecycleService();
  });

  // ── POSITIVE CONTROLS ──────────────────────────────────────────────────────
  // These three are the CONVERTED replica tests: the same three behaviours
  // `runFix3Logic()` asserted, now driven through PRODUCTION code. They are the
  // reason the replica can be deleted without losing coverage.

  it("POSITIVE: a completed run still records status=success", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(mockRunBacktest).toHaveBeenCalledOnce();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe("lifecycle.evidence_auto_backtest_enqueued");
    expect(auditRows[0].status).toBe("success");
  });

  it("POSITIVE: a pipeline-paused run still records status=skipped", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-skip", status: "skipped" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(auditRows[0].status).toBe("skipped");
  });

  it("POSITIVE: actor=automated and mode=walkforward are still passed", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(mockRunBacktest.mock.calls[0][5]).toBe("automated");
    expect(mockRunBacktest.mock.calls[0][1]).toMatchObject({ mode: "walkforward" });
  });

  it("POSITIVE: the 24h cap still blocks a second enqueue", async () => {
    // The row carries its `action` because the query now returns BOTH kinds (enqueued
    // within 24h, refused at any age) and production separates them in JS. A prior row
    // without an action is not a shape the real query can produce.
    seedPriorAuditRows([
      { id: "prior-row", action: ENQUEUED_ACTION, input: null },
    ]);
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(mockRunBacktest).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
  });

  // ── THE DEFECT ─────────────────────────────────────────────────────────────

  it("a REFUSAL is never recorded as success/skipped/failure", async () => {
    mockRunBacktest.mockResolvedValue(REFUSED_RESULT);
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).not.toBe("success");
    expect(auditRows[0].status).not.toBe("skipped");
    expect(auditRows[0].status).not.toBe("failure");
  });

  it("a REFUSAL gets a DISTINCT named audit action, not the enqueued action", async () => {
    mockRunBacktest.mockResolvedValue(REFUSED_RESULT);
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(auditRows[0].action).toBe("lifecycle.evidence_auto_backtest_refused");
    expect(auditRows[0].action).not.toBe("lifecycle.evidence_auto_backtest_enqueued");
  });

  it("a REFUSAL carries the engine's evidence, and fabricates no absent key", async () => {
    mockRunBacktest.mockResolvedValue(REFUSED_RESULT);
    await service.runEvidenceAutoBacktestEnqueue(params());
    const result = auditRows[0].result as Record<string, unknown>;
    expect(result.refusal_evidence).toMatchObject({
      execution_status: "refused",
      condition_id: "C-7",
      disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
      metrics_omitted: true,
    });
    expect(result.refusal_evidence).not.toHaveProperty("ambiguity");
  });

  // ── THE CAP: a deterministic refusal must not be re-asked forever ──────────
  //
  // `A TIME WINDOW THROTTLES A REPEATED REQUEST; IT CANNOT STOP A REQUEST WHOSE
  //  ANSWER IS ALREADY KNOWN AND WILL NEVER CHANGE.`
  //
  // The 24h cap counts only *enqueued* rows, so before this guard a deterministically
  // refused strategy was re-asked every day forever and refused every time.

  /**
   * The identity production ACTUALLY STORED for a request — obtained by running the real
   * helper once and reading the value back, NOT by restating its hashing rule here.
   *
   * ★ A test that re-implements production's identity formula is the SAME defect this
   *   lane exists to remove, one layer out: it would keep passing while production and
   *   the test drifted together into agreement about the wrong thing.
   *   `THE REPAIR FOR A REPLICA IS AN IMPORT.`
   */
  async function identityProductionStoredFor(p = params()): Promise<string> {
    seedPriorAuditRows([]);
    mockRunBacktest.mockResolvedValue({ id: "bt-probe", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(p);
    const id = (auditRows[auditRows.length - 1].input as Record<string, unknown>).request_identity;
    // reset so the caller's own run starts from a clean slate
    auditRows = [];
    vi.clearAllMocks();
    mockInsertFn.mockReturnValue({
      values: (row: Record<string, unknown>) => { auditRows.push(row); return Promise.resolve(undefined); },
    });
    return id as string;
  }

  it("does NOT re-enqueue when the SAME request was already refused", async () => {
    // Round-trip: production STORES the identity, then production READS IT BACK and
    // suppresses on it. Neither side is a restatement.
    const identity = await identityProductionStoredFor();
    seedPriorAuditRows([
      { id: "prior-refusal", action: REFUSED_ACTION, input: { request_identity: identity } },
    ]);
    mockRunBacktest.mockResolvedValue(REFUSED_RESULT);
    await service.runEvidenceAutoBacktestEnqueue(params());
    expect(mockRunBacktest).not.toHaveBeenCalled();
    expect(auditRows).toHaveLength(0);
  });

  it("DISCRIMINATOR: a MATERIALLY CHANGED request is retried despite the prior refusal", async () => {
    // Same strategy, different symbol ⇒ different question ⇒ different identity.
    // Without this, a suppression that simply blocked everything would pass above.
    const identity = await identityProductionStoredFor();
    seedPriorAuditRows([
      { id: "prior-refusal", action: REFUSED_ACTION, input: { request_identity: identity } },
    ]);
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params({ symbol: "MNQ" }));
    expect(mockRunBacktest).toHaveBeenCalledOnce();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].status).toBe("success");
  });

  // ── §C IDENTITY COMPLETENESS (R-767 §4) ────────────────────────────────────
  //
  // `AN IDENTITY BUILT FROM A HAND-WRITTEN SUMMARY OF A REQUEST IS NOT AN IDENTITY OF
  //  THE REQUEST — IT IS AN IDENTITY OF THE SUMMARY, AND THE TWO DRIFT SILENTLY.`
  //
  // The first identity hashed five hand-listed fields while SIX config fields reached
  // the engine unhashed. Latent, not live — they are literals at the single call site —
  // but the first edit that makes one caller-varying converts a correct suppression
  // guard into a wrong one, with nothing to catch it.
  //
  // These controls join the STORED identity to the config the engine ACTUALLY received,
  // captured off the mocked `runBacktest`. That join is the whole point: it is what
  // makes the identity an identity OF THE REQUEST rather than of a restatement.

  /** The logical call descriptor R-767 §4 specifies. Hashed with the SHARED canonicaliser. */
  function descriptorFor(config: unknown, engineRevision = process.env.FORGE_GIT_SHA ?? "unknown") {
    return {
      strategyId: "strat-abc",
      config,
      strategyClass: null,
      externalId: null,
      actor: "automated",
      engineRevision,
    };
  }

  /** The config the engine actually received on the most recent call. */
  function configSentToEngine(): Record<string, unknown> {
    return mockRunBacktest.mock.calls[0][1] as Record<string, unknown>;
  }

  it("the stored identity is the identity OF THE CONFIG THE ENGINE RECEIVED", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    const stored = (auditRows[0].input as Record<string, unknown>).request_identity;
    // THE JOIN. Recomputed from the captured config, not from a restated field list.
    expect(stored).toBe(computeResultHash(descriptorFor(configSentToEngine())));
  });

  it("a NESTED config field changing (target_risk_dollars 500→501) changes the identity", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    const stored = (auditRows[0].input as Record<string, unknown>).request_identity;

    const sent = configSentToEngine();
    const mutated = JSON.parse(JSON.stringify(sent)) as any;
    expect(mutated.strategy.position_size.target_risk_dollars).toBe(500); // fixture witness
    mutated.strategy.position_size.target_risk_dollars = 501;

    // materially different question ⇒ different identity ⇒ retry permitted
    expect(stored).not.toBe(computeResultHash(descriptorFor(mutated)));
    // and the unmutated join still holds, so the inequality above means something
    expect(stored).toBe(computeResultHash(descriptorFor(sent)));
  });

  it("a different engine revision changes the identity — a new engine is a new question", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    const stored = (auditRows[0].input as Record<string, unknown>).request_identity;
    // Anchor the inequality to the join, or it passes trivially whenever the identity is
    // wrong in ANY way — an assertion that a broken implementation also satisfies is not
    // a control.
    expect(stored).toBe(computeResultHash(descriptorFor(configSentToEngine())));
    expect(stored).not.toBe(computeResultHash(descriptorFor(configSentToEngine(), "some-other-sha")));
  });

  it("NEGATIVE CONTROL: tracing context is EXCLUDED — correlationId does not change the identity", async () => {
    // R-767 §4 excludes correlationId / incompleteCount / totalGates: they are audit
    // context and cannot change the engine's answer. Without this, an identity that
    // hashed everything would pass the three controls above and suppress nothing.
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params({ correlationId: "corr-A", incompleteCount: 3 }));
    const a = (auditRows[0].input as Record<string, unknown>).request_identity;

    auditRows = [];
    vi.clearAllMocks();
    seedPriorAuditRows([]);
    mockInsertFn.mockReturnValue({
      values: (row: Record<string, unknown>) => { auditRows.push(row); return Promise.resolve(undefined); },
    });
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params({ correlationId: "corr-B", incompleteCount: 7 }));
    const b = (auditRows[0].input as Record<string, unknown>).request_identity;

    expect(a).toBe(b);
  });

  it("the identity is DETERMINISTIC — no wall-clock, no randomness", async () => {
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    const first = (auditRows[0].input as Record<string, unknown>).request_identity;

    auditRows = [];
    vi.clearAllMocks();
    seedPriorAuditRows([]);
    mockInsertFn.mockReturnValue({
      values: (row: Record<string, unknown>) => { auditRows.push(row); return Promise.resolve(undefined); },
    });
    mockRunBacktest.mockResolvedValue({ id: "bt-ok", status: "completed" });
    await service.runEvidenceAutoBacktestEnqueue(params());
    const second = (auditRows[0].input as Record<string, unknown>).request_identity;

    expect(first).toBe(second);
    // Stability alone is satisfied by a constant. Join it to the actual request so the
    // assertion means "deterministic AND correct", not merely "unchanging".
    expect(first).toBe(computeResultHash(descriptorFor(configSentToEngine())));
  });
});
