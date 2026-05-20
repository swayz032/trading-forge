/**
 * test_lifecycle_race.ts — CRITICAL #2: Concurrent promotion race guard
 *
 * Verifies that:
 *   - When the UPDATE returns no rows (race: another caller already transitioned),
 *     promoteStrategy returns { success: false } with "lifecycle.race_blocked" error.
 *   - A lifecycle.race_blocked audit row is written inside the transaction.
 *   - A normal update (rows returned) still succeeds as before.
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
    _insertRows: [] as { action: string }[],
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
  compileDualPineExport: vi.fn().mockResolvedValue({ id: "pine-export-dual-uuid" }),
  checkExportability: vi.fn().mockResolvedValue({ ok: true, score: 100, band: "green", deductions: [] }),
}));
vi.mock("./notification-service.js", () => ({
  notifyInfo: vi.fn().mockResolvedValue(undefined),
  notifyCritical: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./pipeline-control-service.js", () => ({ isActive: vi.fn().mockResolvedValue(true) }));
vi.mock("./agent-coordinator-service.js", () => ({
  agentCoordinator: {
    notify: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined),
  },
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

type MockDb = {
  _name: "db";
  _txInner: {
    _name: "txInner";
    _selectChain: { _setValue: (rows: unknown[]) => void };
    _insertRows: { action: string }[];
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  _selectChain: { _setValue: (rows: unknown[]) => void };
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};

function makeStrategy(lifecycleState: string) {
  return {
    id: "strat-race-1",
    name: "Race Test Strategy",
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

describe("LifecycleService — CRITICAL #2: concurrent promotion race guard", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    mockDb.transaction.mockImplementation(
      async (cb: (tx: MockDb["_txInner"]) => Promise<void>) => { await cb(mockDb._txInner); },
    );
    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb._selectChain._setValue([]);
    mockDb._txInner._selectChain._setValue([]);
  });

  it("race_blocked: returns success=false when UPDATE returns empty rows (strategy already transitioned)", async () => {
    // Pre-tx select returns the strategy in CANDIDATE state
    mockDb._selectChain._setValue([makeStrategy("CANDIDATE")]);
    mockDb.select.mockReturnValue(mockDb._selectChain);

    // txInner update → set → where → returning([]) — simulates race: no row matched
    const whereChain = {
      returning: vi.fn().mockResolvedValue([]),  // empty = race detected
    };
    const setChain = { where: vi.fn().mockReturnValue(whereChain) };
    mockDb._txInner.update.mockReturnValue({ set: vi.fn().mockReturnValue(setChain) });

    // txInner insert for audit row must not throw
    const insertedActions: string[] = [];
    mockDb._txInner.insert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: { action?: string }) => {
        if (row.action) insertedActions.push(row.action);
        return Promise.resolve([]);
      }),
    }));

    const result = await svc.promoteStrategy("strat-race-1", "CANDIDATE", "TESTING");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/lifecycle.race_blocked/);
    expect(insertedActions).toContain("lifecycle.race_blocked");
  });

  it("no race: returns success=true when UPDATE returns a row (normal path)", async () => {
    // Pre-tx select returns the strategy
    mockDb._selectChain._setValue([makeStrategy("CANDIDATE")]);
    mockDb.select.mockReturnValue(mockDb._selectChain);

    // txInner update → set → where → returning([{ id: "..." }]) — normal: 1 row matched
    const whereChain = {
      returning: vi.fn().mockResolvedValue([{ id: "strat-race-1" }]),
    };
    const setChain = { where: vi.fn().mockReturnValue(whereChain) };
    mockDb._txInner.update.mockReturnValue({ set: vi.fn().mockReturnValue(setChain) });
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

    const result = await svc.promoteStrategy("strat-race-1", "CANDIDATE", "TESTING");

    expect(result.success).toBe(true);
  });
});
