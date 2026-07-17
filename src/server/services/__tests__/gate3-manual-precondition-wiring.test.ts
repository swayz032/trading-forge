/**
 * gate3-manual-precondition-wiring.test.ts — 2026-07-17
 * (ratify-packet: docs/ratify-packets/gate3-manual-cron-parity-2026-07-17.md)
 *
 * END-TO-END wiring proof for the Gate 3 manual/cron precondition-parity fix.
 * Calls the REAL LifecycleService.promoteStrategy() (→ _promoteStrategyInner)
 * for a PAPER → DEPLOY_READY transition — not a mirrored/pure-function
 * reconstruction of the gate logic.
 *
 * THE BUG THIS PROVES (RED, pre-fix):
 *   The manual PATCH path (_promoteStrategyInner, PAPER → DEPLOY_READY branch)
 *   called evaluatePaperToDeployReadyGates() directly with NO check that the
 *   strategy has actually accumulated >= 30 distinct trading days and
 *   rollingSharpe30d >= 1.5 — the exact precondition the cron sweep enforces
 *   before it will even attempt a promotion (lifecycle-service.ts:5601). A
 *   strategy with 0 trading days and Sharpe=0 could reach DEPLOY_READY purely
 *   because the (mocked-to-pass) 9-gate evaluator said yes.
 *
 * THE FIX (GREEN, post-fix):
 *   A new precondition check inside the same guard block, before the
 *   evaluator call, blocks with { success: false } and writes an audit row
 *   (lifecycle.paper_to_deploy_ready_precondition_blocked) when the
 *   precondition is not met.
 *
 * WHY NO BACKTEST ROW IS SEEDED:
 *   Every OTHER PAPER → DEPLOY_READY sub-gate (compliance-drift, DSL guards,
 *   BIF-cpcv-unmeasured, slippage-survival, frozen-policy first-time-freeze,
 *   evidence-completeness) reads from the strategy's latest COMPLETED
 *   backtest row and gracefully no-ops (`latestBtP2D?.field`) when none
 *   exists. Likewise the huge "promotionEvidence" span later in
 *   _promoteStrategyInner (quantum-agreement / adversarial-stress /
 *   backtest-staleness) is entirely gated behind `promotionEvidence.backtestId
 *   != null` / specific fromState/toState combinations that never match
 *   PAPER → DEPLOY_READY. Seeding zero backtests therefore isolates the ONE
 *   thing this test exists to prove — the new precondition — from the other
 *   8 gates, which are independently covered by their own dedicated tests
 *   elsewhere in this repo (gate-chain-integration.test.ts et al.) and are
 *   mocked to PASS here via evaluatePaperToDeployReadyGates.
 *
 * checkSignalCorrelationGate (A7) and evaluatePaperToDeployReadyGates are
 * mocked to PASS per the ratify packet's explicit allowance ("with the
 * 9-gate evaluator's dependencies set up to otherwise PASS (or mocked to
 * pass)") — this test's job is to prove the WIRING (does the new check run,
 * and does it run BEFORE the evaluator), not to re-prove the other 8 gates.
 *
 * killSwitch.isHaltedForProduction() is NOT on this path — it only gates
 * checkAutoPromotions/checkAutoDemotions/checkPilotAutoPromotions (the cron
 * entry points), confirmed by direct grep of lifecycle-service.ts before
 * writing this test — so the dependency that blocked an EARLIER attempt at
 * full-service testing (documented in lifecycle-archetype-promotion.test.ts)
 * does not apply to the manual path exercised here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── db mock: table-aware routing (NOT a single global chain) ────────────────
//
// `.select(...).from(TABLE)...` routes to whatever rows were registered for
// TABLE via __setRows(TABLE, rows) — this lets ONE mock serve the many
// different SELECTs `_promoteStrategyInner` issues (strategies, backtests,
// paperTrades/paperSessions join) without a fragile call-count sequence.
vi.mock("../../db/index.js", () => {
  const routes = new Map<unknown, Record<string, unknown>[]>();
  const insertedRows: { table: unknown; row: Record<string, unknown> }[] = [];
  const updateReturning: Record<string, unknown>[] = [{}]; // overwritten by __setUpdateReturning

  function makeSelectChain(table: unknown | undefined) {
    const resolveRows = () => (table !== undefined ? routes.get(table) ?? [] : []);
    const chain: Record<string, unknown> = {
      from: (t: unknown) => makeSelectChain(t),
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => Promise.resolve(resolveRows()),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(resolveRows()).catch(reject),
    };
    return chain;
  }

  const dbMock: Record<string, unknown> = {
    select: (_cols?: unknown) => makeSelectChain(undefined),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) insertedRows.push({ table, row: r });
        return Promise.resolve([]);
      },
    }),
    update: (_table: unknown) => ({
      set: (_vals: Record<string, unknown>) => ({
        where: (_cond: unknown) => ({
          returning: (_sel?: unknown) => Promise.resolve(updateReturning),
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      await cb(dbMock);
    },
    // ── test-only control surface ──
    __setRows: (table: unknown, rows: Record<string, unknown>[]) => routes.set(table, rows),
    __insertedRows: insertedRows,
    __setUpdateReturning: (rows: Record<string, unknown>[]) => {
      updateReturning.length = 0;
      updateReturning.push(...rows);
    },
    // The `routes` Map and `insertedRows` array live in this factory's closure
    // and are NOT reset by vi.clearAllMocks() (they aren't vi.fn() mocks) — the
    // factory itself only runs once per test file. Each test's beforeEach must
    // call this to start from a clean slate, or audit-row assertions leak state
    // across tests (an earlier test's inserted rows would still be present).
    __reset: () => {
      routes.clear();
      insertedRows.length = 0;
    },
  };

  return { db: dbMock };
});

vi.mock("../../routes/sse.js", () => {
  // LIFECYCLE_GATE_EVENTS / WAVE29_EVENTS are referenced as
  // LIFECYCLE_GATE_EVENTS.SOME_KEY throughout lifecycle-service.ts; a Proxy
  // that echoes back the property name as a string satisfies every call site
  // without hand-enumerating each key.
  const echoProxy = new Proxy(
    {},
    { get: (_t, prop: string) => prop },
  );
  return {
    broadcastSSE: vi.fn(),
    LIFECYCLE_GATE_EVENTS: echoProxy,
    WAVE29_EVENTS: echoProxy,
  };
});

vi.mock("../../lib/tracing.js", () => {
  const span = { setAttribute: vi.fn(), end: vi.fn() };
  return { tracer: { startSpan: vi.fn().mockReturnValue(span) }, OTEL_AVAILABLE: false };
});

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../evolution-service.js", () => ({ evolveStrategy: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock("../alert-service.js", () => ({
  AlertFactory: {
    deployReady: vi.fn().mockResolvedValue(undefined),
    decayAlert: vi.fn().mockResolvedValue(undefined),
    signalCorrelation: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../pine-export-service.js", () => ({
  compilePineExport: vi.fn().mockResolvedValue({ id: "pine-export-uuid" }),
  compileDualPineExport: vi.fn().mockResolvedValue({ id: "pine-export-dual-uuid" }),
  checkExportability: vi.fn().mockResolvedValue({ ok: true, score: 100, band: "green", deductions: [] }),
}));
vi.mock("../agent-coordinator-service.js", () => ({
  agentCoordinator: { notify: vi.fn().mockResolvedValue(undefined), register: vi.fn().mockResolvedValue(undefined), emit: vi.fn().mockResolvedValue(undefined) },
}));

// A7 signal correlation gate — mocked to PASS ("ramp-up" style result) so this
// test isolates the NEW precondition from A7's own DB-backed logic.
const checkSignalCorrelationGateMock = vi.fn();
vi.mock("../signal-correlation-service.js", () => ({
  checkSignalCorrelationGate: (...args: unknown[]) => checkSignalCorrelationGateMock(...args),
}));

// The 9-gate evaluator — mocked to a controllable PASS result per the ratify
// packet's explicit allowance ("9-gate evaluator's dependencies set up to
// otherwise PASS (or mocked to pass)"). This test's job is the NEW
// precondition's wiring, not a re-proof of the other 8 gates.
const evaluatePaperToDeployReadyGatesMock = vi.fn();
vi.mock("../../lib/paper-to-deploy-ready-gates.js", () => ({
  evaluatePaperToDeployReadyGates: (...args: unknown[]) => evaluatePaperToDeployReadyGatesMock(...args),
}));

// ── Import SUT + real schema table identities AFTER mocks ──────────────────
import { LifecycleService } from "../lifecycle-service.js";
import { db } from "../../db/index.js";
import { strategies, backtests, paperTrades, auditLog } from "../../db/schema.js";

type MockDb = {
  __setRows: (table: unknown, rows: Record<string, unknown>[]) => void;
  __insertedRows: { table: unknown; row: Record<string, unknown> }[];
  __setUpdateReturning: (rows: Record<string, unknown>[]) => void;
  __reset: () => void;
};

const STRATEGY_ID = "b3a10001-0000-0000-0000-000000000001";

function makeStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STRATEGY_ID,
    name: "gate3-wiring-fixture",
    symbol: "MES",
    symbols: ["MES"],
    timeframe: "5m",
    config: {},
    lifecycleState: "PAPER",
    lifecycleChangedAt: new Date("2026-01-01T00:00:00.000Z"),
    rollingSharpe30d: "0",
    forgeScore: "75",
    frozenPolicyHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const PASSING_EVALUATOR_RESULT = {
  passed: true,
  status: "passed",
  auditAction: null,
  auditPayload: {},
  reason: "mocked-pass (this test isolates the NEW precondition, not the 9-gate evaluator)",
  needsFirstTimeFreeze: false,
  incompleteGateCount: 0,
  gateEvidenceStatuses: [],
  survivalTwin: undefined,
};

describe("Gate 3 manual-path precondition — end-to-end wiring (_promoteStrategyInner)", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();
    mockDb.__reset();

    // Every PAPER→DEPLOY_READY sub-gate that reads `backtests` gets an empty
    // result — no completed backtest exists for this fixture strategy. This
    // is what makes every OTHER gate a no-op (see file header).
    mockDb.__setRows(backtests, []);
    // No paper_trades rows by default — RED-proof / negative tests override this.
    mockDb.__setRows(paperTrades, []);
    // Successful UPDATE ... RETURNING for the writeBlock commit (positive test only).
    mockDb.__setUpdateReturning([{ id: STRATEGY_ID }]);

    checkSignalCorrelationGateMock.mockResolvedValue({
      allowed: true,
      reason: "mocked A7 pass — no DEPLOYED strategies to compare against",
      maxSimilarity: null,
      blockingStrategyId: null,
    });
    evaluatePaperToDeployReadyGatesMock.mockResolvedValue(PASSING_EVALUATOR_RESULT);
  });

  // ─── RED-PROOF ────────────────────────────────────────────────────────────
  //
  // This test's name and assertions describe the FIXED (correct) behavior.
  // Run against the pre-fix code, it FAILS — the promotion incorrectly
  // succeeds with 0 trading days and Sharpe=0, proving the defect. That
  // failure is the RED evidence; it was captured (see the ratify packet's
  // implementation report) BEFORE lifecycle-service.ts was edited.
  it("BLOCKS promotion when tradingDays=0 and rollingSharpe=0, even though the 9-gate evaluator would PASS", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "0" })]);
    // paperTrades stays empty (set in beforeEach) → 0 distinct trading days.

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/precondition/i);

    // The 9-gate evaluator must NEVER have been reached — the precondition
    // fires before it, saving the on-demand survival-twin subprocess it would
    // otherwise spend.
    expect(evaluatePaperToDeployReadyGatesMock).not.toHaveBeenCalled();
  });

  it("writes the lifecycle.paper_to_deploy_ready_precondition_blocked audit row on block, with the full row shape (not just the action string)", async () => {
    // Hardened 2026-07-17 (independent-grader finding): the original version of
    // this test only asserted the action string was present among inserted
    // rows — it never checked entityId/entityType/status/decisionAuthority/
    // correlationId/result, so a row missing any of those fields (e.g. a
    // dangling entityId, or status left as "success" by a copy-paste mistake)
    // would have passed silently. Assert the complete shape.
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "0" })]);

    const correlationId = await svc
      .promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY", { correlationId: "gate3-audit-shape-test-corr-id" })
      .then(() => "gate3-audit-shape-test-corr-id");

    const row = mockDb.__insertedRows.find(
      (r) => r.table === auditLog && r.row.action === "lifecycle.paper_to_deploy_ready_precondition_blocked",
    )?.row;

    expect(row).toBeDefined();
    expect(row?.entityId).toBe(STRATEGY_ID);
    expect(row?.entityType).toBe("strategy");
    expect(row?.status).toBe("failure");
    expect(row?.decisionAuthority).toBe("gate");
    expect(row?.correlationId).toBe(correlationId);
    expect(row?.input).toMatchObject({ fromState: "PAPER", toState: "DEPLOY_READY" });
    expect(row?.result).toMatchObject({
      reason: "trading_days_or_sharpe_below_threshold",
      trading_days: 0,
      rolling_sharpe: 0,
      min_trading_days: 30,
      min_rolling_sharpe: 1.5,
    });
  });

  it("BLOCKS when rollingSharpe is sufficient but tradingDays is not (30 days required, only 10 seeded)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "2.0" })]);
    const tenDistinctDayRows = Array.from({ length: 10 }, (_, i) => ({ day: `2026-01-${String(i + 2).padStart(2, "0")}` }));
    mockDb.__setRows(paperTrades, tenDistinctDayRows);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(false);
    expect(evaluatePaperToDeployReadyGatesMock).not.toHaveBeenCalled();
  });

  it("BLOCKS when tradingDays is sufficient but rollingSharpe is not (30 days seeded, Sharpe=1.2)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "1.2" })]);
    const thirtyDistinctDayRows = Array.from({ length: 30 }, (_, i) => ({ day: `2026-${i < 22 ? "01" : "02"}-${String((i % 22) + 2).padStart(2, "0")}` }));
    mockDb.__setRows(paperTrades, thirtyDistinctDayRows);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(false);
    expect(evaluatePaperToDeployReadyGatesMock).not.toHaveBeenCalled();
  });

  // ─── POSITIVE (no regression on the happy path) ─────────────────────────
  it("PROMOTES normally when tradingDays >= 30 and rollingSharpe >= 1.5 (no regression)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "2.1" })]);
    const thirtyDistinctDayRows = Array.from({ length: 30 }, (_, i) => ({ day: `2026-${i < 22 ? "01" : "02"}-${String((i % 22) + 2).padStart(2, "0")}` }));
    mockDb.__setRows(paperTrades, thirtyDistinctDayRows);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(true);
    // The 9-gate evaluator DID run this time (precondition passed, so we spend it).
    expect(evaluatePaperToDeployReadyGatesMock).toHaveBeenCalledTimes(1);

    const auditActions = mockDb.__insertedRows
      .filter((r) => r.table === auditLog)
      .map((r) => r.row.action);
    expect(auditActions).not.toContain("lifecycle.paper_to_deploy_ready_precondition_blocked");
  });

  it("BLOCKS when strategy.lifecycleChangedAt is null (mirrors the cron's `if (!s.lifecycleChangedAt) continue`)", async () => {
    mockDb.__setRows(strategies, [makeStrategyRow({ rollingSharpe30d: "5.0", lifecycleChangedAt: null })]);

    const result = await svc.promoteStrategy(STRATEGY_ID, "PAPER", "DEPLOY_READY");

    expect(result.success).toBe(false);
    expect(evaluatePaperToDeployReadyGatesMock).not.toHaveBeenCalled();
  });
});
