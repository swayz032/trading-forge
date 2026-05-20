/**
 * test_backtest_staleness.ts — HIGH #14: Backtest age gate at promotion
 *
 * Verifies that:
 *   - promoteStrategy blocks when latest backtest is older than BACKTEST_STALENESS_DAYS
 *   - returns { success: false, error: "lifecycle.backtest_stale: ..." }
 *   - writes a lifecycle.backtest_stale audit row
 *   - allows promotion when backtest is within the staleness window
 *   - respects env var override (BACKTEST_STALENESS_DAYS)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getLatestFrankensteinRun: vi.fn().mockResolvedValue({ passed: true, runId: "frank-1", p95Sharpe: 0.1, medianPf: 1.0 }),
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
    id: "strat-stale-1",
    name: "Staleness Test Strategy",
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

// Wire the multi-call select sequence for CANDIDATE→TESTING with a backtest
// of given age.
function wireSelectsWithBacktestAge(mockDb: MockDb, backtestAgeDays: number) {
  const strategy = makeStrategy("CANDIDATE");
  const backtestCreatedAt = new Date(Date.now() - backtestAgeDays * 24 * 60 * 60 * 1000);
  const backtest = {
    id: "bt-stale-1",
    forgeScore: "80",
    resultExtras: null,
    createdAt: backtestCreatedAt,
    walkForwardResults: { ok: true },
    tier: "A",
    propCompliance: null,
    gateResult: null,
    sharpeRatio: "1.5",
    profitFactor: "1.8",
    winRate: "0.55",
    maxDrawdown: "1500",
    avgDailyPnl: "300",
    totalTrades: 120,
    mrpSharpe: null,
    mrpRegimeBreakdown: null,
  };

  // Helper: make an awaitable chain resolving to the given rows
  function makeChain(rows: unknown[]) {
    const chain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
      catch(rej: (e: unknown) => unknown) { return Promise.resolve(rows).catch(rej); },
      finally(fn: () => void) { return Promise.resolve(rows).finally(fn); },
    };
    return chain;
  }

  let callCount = 0;
  mockDb.select.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return makeChain([strategy]);                           // strategy
    if (callCount === 2) return makeChain([backtest]);                           // backtest evidence
    if (callCount === 3) return makeChain([]);                                   // MC run (none)
    if (callCount === 4) return makeChain([]);                                   // QMC shadow
    if (callCount === 5) return makeChain([{ createdAt: backtestCreatedAt }]);   // staleness check
    return makeChain([]);
  });
}

describe("LifecycleService — HIGH #14: backtest staleness gate", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;
  const originalEnv = process.env.BACKTEST_STALENESS_DAYS;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    mockDb.transaction.mockImplementation(
      async (cb: (tx: TxInner) => Promise<void>) => { await cb(mockDb._txInner); },
    );
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    const whereChain = { returning: vi.fn().mockResolvedValue([{ id: "strat-stale-1" }]) };
    const setChain = { where: vi.fn().mockReturnValue(whereChain) };
    mockDb._txInner.update.mockReturnValue({ set: vi.fn().mockReturnValue(setChain) });
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);
    mockDb._txInner._selectChain._setValue([]);

    delete process.env.BACKTEST_STALENESS_DAYS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BACKTEST_STALENESS_DAYS = originalEnv;
    } else {
      delete process.env.BACKTEST_STALENESS_DAYS;
    }
  });

  it("blocks promotion when backtest is 31 days old (default 30-day limit)", async () => {
    wireSelectsWithBacktestAge(mockDb, 31);

    const result = await svc.promoteStrategy("strat-stale-1", "CANDIDATE", "TESTING");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lifecycle.backtest_stale/);

    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const staleAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.backtest_stale");
    expect(staleAudit).toBeDefined();
    expect(staleAudit[0].result.reason).toBe("backtest_too_old");
    expect(staleAudit[0].result.limit_days).toBe(30);
  });

  it("allows promotion when backtest is 29 days old (within default limit)", async () => {
    wireSelectsWithBacktestAge(mockDb, 29);

    const result = await svc.promoteStrategy("strat-stale-1", "CANDIDATE", "TESTING");

    // May fail for other reasons (no MC run etc.) but NOT for staleness
    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const staleAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.backtest_stale");
    expect(staleAudit).toBeUndefined();
  });

  it("respects BACKTEST_STALENESS_DAYS=7 env override — blocks 8-day-old backtest", async () => {
    process.env.BACKTEST_STALENESS_DAYS = "7";
    wireSelectsWithBacktestAge(mockDb, 8);

    const result = await svc.promoteStrategy("strat-stale-1", "CANDIDATE", "TESTING");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lifecycle.backtest_stale/);

    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const staleAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.backtest_stale");
    expect(staleAudit).toBeDefined();
    expect(staleAudit[0].result.limit_days).toBe(7);
  });

  it("respects BACKTEST_STALENESS_DAYS=7 env override — allows 6-day-old backtest", async () => {
    process.env.BACKTEST_STALENESS_DAYS = "7";
    wireSelectsWithBacktestAge(mockDb, 6);

    const auditCalls = (insertAuditRow as ReturnType<typeof vi.fn>).mock.calls;
    const staleAudit = auditCalls.find(([row]: [{ action: string }]) => row.action === "lifecycle.backtest_stale");
    expect(staleAudit).toBeUndefined();
  });
});
