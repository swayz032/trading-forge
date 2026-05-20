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

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
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
// Call 2: backtest evidence (id + forgeScore + resultExtras + createdAt)
// Call 3: MC run
// Call 4: QMC shadow (empty)
// Call 5: staleness check (backtest.createdAt)
// Call 6: resultExtras gate read
// Call 7: frankenstein gate
// Subsequent: empty
function wireSelectCalls(mockDb: MockDb, resultExtras: unknown) {
  const strategy = makeStrategy("TESTING");
  const backtest = {
    id: "bt-uuid-1",
    forgeScore: "80",
    resultExtras,
    createdAt: new Date(),  // fresh backtest
  };
  const mcRun = { probabilityOfRuin: "0.1" };

  let callCount = 0;
  mockDb.select.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return makeAwaitableSelectChain([strategy]);
    if (callCount === 2) return makeAwaitableSelectChain([backtest]);
    if (callCount === 3) return makeAwaitableSelectChain([mcRun]);
    if (callCount === 4) return makeAwaitableSelectChain([]);  // QMC shadow
    if (callCount === 5) return makeAwaitableSelectChain([{ createdAt: new Date() }]);  // staleness
    if (callCount === 6) return makeAwaitableSelectChain([{ resultExtras }]);  // invariant gate
    if (callCount === 7) return makeAwaitableSelectChain([{ id: "bt-uuid-1" }]);  // frankenstein
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
    const invariantAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.invariant_blocked");
    expect(invariantAudit).toBeDefined();
    expect(invariantAudit[0].result.critical_failures).toContain("sharpe_stability_failed");
  });

  it("allows TESTING→PAPER when invariants.overall_passed=true", async () => {
    const resultExtras = {
      invariants: { overall_passed: true, critical_failures: [] },
    };
    wireSelectCalls(mockDb, resultExtras);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");
    expect(result.success).toBe(true);
  });

  it("writes parity_shadow_warn audit row (advisory) when parity_shadow.passed=false but still promotes", async () => {
    const resultExtras = {
      invariants: { overall_passed: true, critical_failures: [] },
      parity_shadow: { passed: false, drift_pct: 3.2 },
    };
    wireSelectCalls(mockDb, resultExtras);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");

    // Advisory: promotion succeeds
    expect(result.success).toBe(true);

    // Advisory audit row written
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const parityAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.parity_shadow_warn");
    expect(parityAudit).toBeDefined();
    expect(parityAudit[0].status).toBe("success");  // advisory = not blocked
  });

  it("allows promotion when resultExtras is null (legacy backtest without invariants)", async () => {
    wireSelectCalls(mockDb, null);

    const result = await svc.promoteStrategy("strat-inv-1", "TESTING", "PAPER");
    expect(result.success).toBe(true);
  });
});
