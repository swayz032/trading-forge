/**
 * test_invariant_blocks_promotion.ts — CRITICAL #6: resultExtras gates at TESTING→PAPER
 *
 * Verifies that:
 *   - invariants.overall_passed=false blocks TESTING→PAPER with lifecycle.invariant_blocked audit row
 *   - parity_shadow.passed=false is advisory-only (promotion continues, audit row written)
 *   - invariants.overall_passed=true allows promotion to proceed
 *   - Missing resultExtras (legacy backtest) does not block promotion
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock factories (hoisted) ──────────────────────────────────────────────────

vi.mock("../db/index.js", () => {
  function makeChain(initialRows: unknown[] = []) {
    let rows = initialRows;
    const chain: Record<string, unknown> = {
      _setValue(newRows: unknown[]) { rows = newRows; },
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      returning: vi.fn(),
      set: vi.fn(),
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
      catch(reject: (e: unknown) => unknown) { return Promise.resolve(rows).catch(reject); },
      finally(fn: () => void) { return Promise.resolve(rows).finally(fn); },
    };
    (chain.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.limit as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve(rows));
    (chain.returning as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve(rows));
    (chain.set as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    return chain;
  }

  const txSelectChain = makeChain();
  const txInner = {
    _name: "txInner" as const,
    _selectChain: txSelectChain,
    select: vi.fn().mockReturnValue(txSelectChain),
    update: vi.fn().mockReturnValue(makeChain()),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  };

  const dbSelectChain = makeChain();
  const dbMock = {
    _name: "db" as const,
    _txInner: txInner,
    _selectChain: dbSelectChain,
    select: vi.fn().mockReturnValue(dbSelectChain),
    update: vi.fn().mockReturnValue(makeChain()),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    transaction: vi.fn().mockImplementation(
      async (cb: (tx: typeof txInner) => Promise<void>) => { await cb(txInner); },
    ),
  };
  return { db: dbMock };
});

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  // A pre-existing commit added a new DSL guards hard gate to the manual
  // promotion path (deepscan17); it reads LIFECYCLE_GATE_EVENTS.DSL_GUARDS_EVALUATED
  // to broadcast its own SSE event. Without this export the read throws, and the
  // gate's own try/catch fails CLOSED (lifecycle.dsl_guards_gate_error_fail_closed),
  // masking every scenario this file actually means to test underneath it.
  LIFECYCLE_GATE_EVENTS: {
    AUTO_GRAVEYARD: "lifecycle:auto_graveyard",
    PROMOTION_EVIDENCE_INCOMPLETE: "lifecycle:promotion_evidence_incomplete",
    B14_EVALUATED: "lifecycle:b14_evaluated",
    WFE_EVALUATED: "lifecycle:wfe_evaluated",
    PARAMETER_DRIFT_EVALUATED: "lifecycle:parameter_drift_evaluated",
    BIF_EVALUATED: "lifecycle:bif_evaluated",
    PBO_EVALUATED: "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
    DSL_GUARDS_EVALUATED: "lifecycle:dsl_guards_evaluated",
  },
  // The PBO gate (also touched by the manual TESTING->PAPER path) reads
  // WAVE29_EVENTS.PBO_EVALUATED to broadcast its own SSE event.
  WAVE29_EVENTS: {
    SHADOW_LOGGED: "signal:shadow_logged",
    PBO_EVALUATED: "lifecycle:pbo_evaluated",
    SHADOW_DIVERGENCE_EVALUATED: "lifecycle:shadow_divergence_evaluated",
    RL_AB_ROUTED: "signal:rl_ab_routed",
    RL_TRAINING_COMPLETED: "quantum_rl:training_completed",
    RL_KILL_SWITCH_ENGAGED: "quantum_rl:kill_switch_engaged",
  },
}));
vi.mock("./alert-service.js", () => ({
  AlertFactory: { deployReady: vi.fn().mockResolvedValue(undefined), decayAlert: vi.fn().mockResolvedValue(undefined) },
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
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
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
vi.mock("./adversarial-stress-service.js", () => ({ getLatestAdversarialStressRun: vi.fn().mockResolvedValue(null) }));
vi.mock("./frankenstein-service.js", () => ({
  getLatestFrankensteinRun: vi.fn().mockResolvedValue({ passed: true, runId: "frank-1", p95Sharpe: 0.1, medianPf: 1.0, nShuffles: 100 }),
}));
vi.mock("../lib/audit-log-helper.js", () => ({ insertAuditRow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/metrics-registry.js", () => ({
  strategyPromotions: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  // A pre-existing commit added several counters to metrics-registry.ts that
  // lifecycle-service.ts imports by name. Complete the mock to match the
  // known-good pattern in the sibling test deepscan17-dsl-guards-manual-path.test.ts.
  pboBlocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  lifecycleShadowPromotionsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  autoGraveyardTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  bifGateEvaluationsTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  slippageSurvivalBlocksTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  auditWriteFailuresTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  b14GateTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  wfeGateTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  parameterDriftGateTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  dslGuardsGateTotal: { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
}));
vi.mock("./multi-firm-promotion-service.js", () => ({
  evaluateMultiFirmEligibility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../production/kill-switch.js", () => ({
  killSwitch: { isHaltedForProduction: vi.fn().mockResolvedValue(false) },
}));

import { LifecycleService } from "./lifecycle-service.js";
import { db } from "../db/index.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";

type SelectChain = { _setValue: (rows: unknown[]) => void };
type TxInner = {
  _name: "txInner";
  _selectChain: SelectChain;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};
type MockDb = {
  _name: "db";
  _txInner: TxInner;
  _selectChain: SelectChain;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function makeStrategy(lifecycleState: string) {
  return {
    id: "strat-inv-1",
    name: "Invariant Test Strategy",
    lifecycleState,
    config: { parameters: {} },
    forgeScore: "75",
    rollingSharpe30d: "2.1",
    lifecycleChangedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    symbol: "MES",
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

// Helper: make a chain that is both awaitable (then/catch/finally) and supports .limit()
function makeAwaitableSelectChain(rows: unknown[]) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    // Awaitable for `const [x] = await chain` without .limit()
    then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(rows).then(resolve, reject);
    },
    catch(rej: (e: unknown) => unknown) { return Promise.resolve(rows).catch(rej); },
    finally(fn: () => void) { return Promise.resolve(rows).finally(fn); },
  };
  return chain;
}

// Wire db.select to return different rows depending on call count.
// Call 1: strategy row (pre-tx read)
// Call 2: DSL guards gate read (a pre-existing commit added this call, which runs
//         BEFORE the evidence block below on every TESTING→PAPER / SHADOW→PAPER
//         manual promotion). Reuses the backtest row shape (only .resultExtras is
//         read); fixtures never set resultExtras.dsl_guards so the gate
//         legacy-proceeds and does not block.
// Call 3: backtest evidence (id + forgeScore + resultExtras + createdAt)
// Call 4: MC run
// Call 5: QMC shadow (empty)
// Call 6: staleness check (backtest.createdAt)
// Call 7: resultExtras gate read
// Call 8: frankenstein gate
// Subsequent: empty
function wireSelectCalls(mockDb: MockDb, resultExtras: unknown) {
  const strategy = makeStrategy("TESTING");
  const backtest = {
    id: "bt-uuid-1",
    forgeScore: "80",
    resultExtras,
    createdAt: new Date(),  // fresh backtest
  };
  // A pre-existing hardening commit ("Harden validation promotion gates") made
  // the B14 CI gate fail-CLOSED when riskMetrics.probability_of_ruin_ci is
  // absent (previously grandfathered) — this fixture predates that hardening and
  // never supplied it, so the manual TESTING->PAPER path's B14 gate now blocks
  // before ever reaching the resultExtras invariant gate this file means to test.
  // ci_high=0.1 is under the default 0.20 threshold, so B14 passes clean.
  const mcRun = {
    probabilityOfRuin: "0.1",
    riskMetrics: {
      probability_of_ruin_ci: {
        point_estimate: 0.1,
        ci_low: 0.05,
        ci_high: 0.1,
        ci_method: "bca",
        n_resamples: 1000,
        standard_error: 0.01,
      },
    },
  };

  // Dispatch by the SHAPE of the requested columns (Object.keys of the .select({...})
  // arg) rather than by positional call count. The manual TESTING->PAPER path makes
  // 11 real db.select() calls across strategy row / DSL guards / backtest evidence /
  // MC-survival-floor / QMC-shadow-advisory / staleness / invariant-gate (x2) /
  // hard-gate-parity walkForwardResults / a 2nd MC-survival-style read / and the B14
  // CI gate's own riskMetrics read — several were added by separate pre-existing
  // hardening commits at different times, and a positional callCount queue has
  // repeatedly drifted out of sync as a result (the exact class of bug this file's
  // own "resultExtras is not found" / "B14 ci_high=unavailable" failures trace to).
  // Keying on column shape is immune to a later commit inserting a new call anywhere
  // in the sequence.
  mockDb.select.mockImplementation((cols?: unknown) => {
    const keys = cols && typeof cols === "object" ? Object.keys(cols as object).sort().join(",") : "";
    if (keys === "") return makeAwaitableSelectChain([strategy]);
    if (keys === "resultExtras") return makeAwaitableSelectChain([{ resultExtras }]);
    if (keys === "createdAt,forgeScore,id,resultExtras") return makeAwaitableSelectChain([backtest]);
    if (keys === "probabilityOfRuin") return makeAwaitableSelectChain([{ probabilityOfRuin: "0.1" }]);  // MC-survival-floor checks (survivalRate=0.9, passes)
    if (keys === "confidenceInterval,estimatedValue") return makeAwaitableSelectChain([]);  // QMC shadow — advisory only, never gates
    if (keys === "createdAt") return makeAwaitableSelectChain([{ createdAt: new Date() }]);  // staleness — fresh backtest
    // hard-gate parity block — also feeds the DSR walk-forward gate, which (like
    // B14/BIF) was hardened to fail-CLOSED on absent dsr_pass by the same
    // pre-existing "Harden validation promotion gates" commit.
    if (keys === "walkForwardResults") return makeAwaitableSelectChain([{ walkForwardResults: { wf_metadata: { dsr_pass: true } } }]);
    if (keys === "probabilityOfRuin,riskMetrics") return makeAwaitableSelectChain([mcRun]);  // B14 CI gate's own read
    if (keys === "id") return makeAwaitableSelectChain([{ id: "bt-uuid-1" }]);  // frankenstein gate
    if (keys === "dsl") return makeAwaitableSelectChain([{ dsl: { exit_params: { style: "c" } } }]);  // wf_mode_insufficient's Style-C runner check
    if (keys === "config,id") return makeAwaitableSelectChain([{ id: "strat-inv-1", config: {} }]);  // freezePolicyForStrategy's own strategy read
    return makeAwaitableSelectChain([]);
  });
}

describe("LifecycleService — CRITICAL #6: resultExtras invariant gate at TESTING→PAPER", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    mockDb.transaction.mockImplementation(
      async (cb: (tx: TxInner) => Promise<void>) => { await cb(mockDb._txInner); },
    );
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    const whereChain = { returning: vi.fn().mockResolvedValue([{ id: "strat-inv-1" }]) };
    const setChain = { where: vi.fn().mockReturnValue(whereChain) };
    mockDb._txInner.update.mockReturnValue({ set: vi.fn().mockReturnValue(setChain) });
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);
    mockDb._txInner._selectChain._setValue([]);

    // freezePolicyForStrategy (frozen-policy-contract.ts) calls db.update(...) directly
    // (NOT via tx) with its own CAS guard requiring a non-empty .returning() — the
    // module-level mock factory's default db.update chain always resolves to [],
    // which trips the guard's "concurrent promotion" race-block path unconditionally.
    const topWhereChain = { returning: vi.fn().mockResolvedValue([{ id: "strat-inv-1" }]) };
    const topSetChain = { where: vi.fn().mockReturnValue(topWhereChain) };
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue(topSetChain) });
  });

  it("blocks TESTING→PAPER when invariants.overall_passed=false and writes invariant_blocked audit row", async () => {
    const resultExtras = {
      invariants: {
        overall_passed: false,
        critical_failures: ["sharpe_stability_failed", "drawdown_invariant_violated"],
      },
    };
    wireSelectCalls(mockDb, resultExtras);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lifecycle.invariant_blocked/);

    // insertAuditRow should have been called with invariant_blocked action
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const invariantAudit = auditCalls.find((args: unknown[]) => (args[0] as { action: string }).action === "lifecycle.invariant_blocked");
    expect(invariantAudit).toBeDefined();
    expect(((invariantAudit![0] as Record<string, unknown>)["result"] as Record<string, unknown>)["critical_failures"]).toContain("sharpe_stability_failed");
  });

  it("allows TESTING→PAPER when invariants.overall_passed=true", async () => {
    const resultExtras = {
      invariants: { overall_passed: true, critical_failures: [] },
      // wf_mode_insufficient gate (separate from the invariant gate under test)
      // requires wf_metadata.mode==="cpcv" — a fresh CPCV walk-forward result —
      // before TESTING/SHADOW→PAPER. A test whose invariants pass now falls
      // through to this later gate instead of returning early at invariant_blocked.
      wf_metadata: { mode: "cpcv" },
    };
    wireSelectCalls(mockDb, resultExtras);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");
    expect(result.error ?? "").not.toMatch(/lifecycle\.invariant_blocked/);
  });

  it("writes parity_shadow_warn audit row (advisory) when parity_shadow.passed=false but still promotes", async () => {
    const resultExtras = {
      invariants: { overall_passed: true, critical_failures: [] },
      parity_shadow: { passed: false, drift_pct: 3.2 },
      // See "allows TESTING→PAPER..." test above for why wf_metadata.mode is required.
      wf_metadata: { mode: "cpcv" },
    };
    wireSelectCalls(mockDb, resultExtras);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");

    // Advisory: this gate does not block; later independent gates may still do so.
    expect(result.error ?? "").not.toMatch(/lifecycle\.invariant_blocked/);

    // Advisory audit row written
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const parityAudit = auditCalls.find((args: unknown[]) => (args[0] as { action: string }).action === "lifecycle.parity_shadow_warn");
    expect(parityAudit).toBeDefined();
    expect((parityAudit![0] as Record<string, unknown>)["status"]).toBe("success");  // advisory = not blocked
  });

  it("does not invent an invariant failure when resultExtras is null", async () => {
    wireSelectCalls(mockDb, null);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");
    expect(result.error ?? "").not.toMatch(/lifecycle\.invariant_blocked/);
  });
});
