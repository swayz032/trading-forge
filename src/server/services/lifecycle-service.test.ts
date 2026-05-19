/**
 * lifecycle-service.test.ts
 *
 * Wave B5 verification tests.
 * Covers:
 *   - B5.1: standalone (no-tx) path wraps writes in db.transaction()
 *   - B5.1: caller-tx path passes writes through the provided tx handle
 *   - B5.2: graveyard_burial_pending row inserted inside transaction for DECLINING/RETIRED
 *   - B5.2: graveyard_burial_pending NOT inserted for non-terminal transitions
 *   - B5.3: broadcastSSE is NOT called inside promoteStrategy (post-commit guarantee)
 *   - Guard: invalid transitions return { success: false } without writing
 *   - Guard: DEPLOY_READY→DEPLOYED blocked for non-human actors
 *   - Guard: strategy-not-found returns { success: false }
 *   - Guard: state mismatch returns { success: false }
 *   - Atomicity: transaction error propagates
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.mock factories are hoisted — MUST be fully self-contained ──────────────

vi.mock("../db/index.js", () => {
  /**
   * Build a fluent query chain that:
   *  - Resolves when awaited directly (no terminal .limit()) via Promise-like .then
   *  - Also supports .limit() for chains that use it
   *  - Also has .returning() for update chains
   *
   * The resolved value is set by calling chain._setValue(rows).
   */
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
      // Make the chain itself thenable so "await chain" works
      then(resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
      catch(reject: (e: unknown) => unknown) {
        return Promise.resolve(rows).catch(reject);
      },
      finally(fn: () => void) {
        return Promise.resolve(rows).finally(fn);
      },
    };
    // All chainable methods return the same chain
    (chain.from as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.where as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.orderBy as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    (chain.limit as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve(rows));
    (chain.returning as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve(rows));
    (chain.set as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    return chain;
  }

  // txInner is the handle passed INTO db.transaction(callback)
  const txInnerSelectChain = makeChain();
  const txInner = {
    _name: "txInner" as const,
    _selectChain: txInnerSelectChain,
    _insertRows: [] as string[],
    select: vi.fn().mockReturnValue(txInnerSelectChain),
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
      async (cb: (tx: typeof txInner) => Promise<void>) => { await cb(txInner); }
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
  compilePineExport: vi.fn().mockResolvedValue({ id: "pine-export-uuid" }),
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
  },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Mock ../index.js to provide logger without triggering route loading (avoids circular-import: index → routes/strategies → lifecycle-service → index).
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Mock tracing so tests don't require OTel packages and can assert span attributes.
// The factory must be self-contained (hoisted) — build the span object inside it.
vi.mock("../lib/tracing.js", () => {
  const span = { setAttribute: vi.fn(), end: vi.fn() };
  const tracerMock = { startSpan: vi.fn().mockReturnValue(span) };
  return { tracer: tracerMock, OTEL_AVAILABLE: false };
});

// ── Import SUT AFTER mocks ────────────────────────────────────────────────────
import { LifecycleService } from "./lifecycle-service.js";
import { broadcastSSE } from "../routes/sse.js";
import { db } from "../db/index.js";
import { tracer } from "../lib/tracing.js";

// ── Internal mock type ────────────────────────────────────────────────────────
type SelectChain = { _setValue: (rows: unknown[]) => void };
type TxInner = {
  _name: "txInner";
  _selectChain: SelectChain;
  _insertRows: string[];
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStrategy(lifecycleState: string) {
  return {
    id: "strat-uuid-1",
    name: "Test Strategy",
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

/**
 * Wire the db.select and txInner.select chains to resolve with `strategy` (or []).
 * Both chains need to resolve because the pre-tx read goes through db, and the
 * txInner chain may also be used if a caller-tx select is needed.
 */
function mockStrategyFetch(mockDb: MockDb, strategy: ReturnType<typeof makeStrategy> | null) {
  const rows = strategy ? [strategy] : [];

  // Each chain has a ._setValue() set in the mock factory
  mockDb._selectChain._setValue(rows);
  // Reset the select mock to always return the same chain (with updated value)
  mockDb.select.mockReturnValue(mockDb._selectChain);

  mockDb._txInner._selectChain._setValue(rows);
  mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);
}

/**
 * Wire txInner.insert to record the `action` field of every .values() call.
 * Returns the live array that gets populated as inserts happen.
 */
function captureInsertActions(txInner: TxInner): string[] {
  const captured: string[] = [];
  txInner.insert.mockImplementation(() => ({
    values: vi.fn().mockImplementation((row: { action?: string }) => {
      if (row.action) captured.push(row.action);
      return Promise.resolve([]);
    }),
  }));
  return captured;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LifecycleService.promoteStrategy — B5 transactional integrity", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    // Re-attach transaction mock after clearAllMocks wipes it
    mockDb.transaction.mockImplementation(
      async (cb: (tx: TxInner) => Promise<void>) => { await cb(mockDb._txInner); }
    );

    // Restore default select chain wiring (clearAllMocks removes mockReturnValue)
    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);

    // Restore default update chain wiring
    const updateChainDefault = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([{ codename: "FORGE-001" }]),
      }),
    };
    mockDb.update.mockReturnValue(updateChainDefault);
    mockDb._txInner.update.mockReturnValue(updateChainDefault);

    // Restore default insert wiring
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

    // Default: strategy not found (tests that need a strategy call mockStrategyFetch)
    mockDb._selectChain._setValue([]);
    mockDb._txInner._selectChain._setValue([]);
  });

  // ── B5.1: standalone path calls db.transaction() ─────────────────────────

  // Wave B5: transactional wrapper restored — promoteStrategy() opens db.transaction()
  // when no caller-tx is supplied so all writes commit/rollback as one unit.
  it("B5.1 standalone: calls db.transaction() when no tx is provided", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    const result = await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    expect(result.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it("B5.1 standalone: does NOT call db.transaction() for invalid transition", async () => {
    const result = await svc.promoteStrategy("strat-uuid-1", "GRAVEYARD", "CANDIDATE");
    expect(result.success).toBe(false);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("B5.1 standalone: does NOT call db.transaction() when strategy not found", async () => {
    // _selectChain resolves [] by default from beforeEach
    const result = await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    expect(result.success).toBe(false);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // ── B5.1: caller-tx path bypasses db.transaction() ───────────────────────

  it("B5.1 caller-tx: does NOT call db.transaction() when tx is provided", async () => {
    // Build a minimal caller-owned tx that returns the strategy
    function makeTxChain(rows: unknown[]) {
      const c = {
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn().mockResolvedValue(rows),
        returning: vi.fn().mockResolvedValue(rows),
        set: vi.fn(),
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(rows).then(resolve); },
        catch(rej: (e: unknown) => unknown) { return Promise.resolve(rows).catch(rej); },
        finally(fn: () => void) { return Promise.resolve(rows).finally(fn); },
      };
      c.from.mockReturnValue(c);
      c.where.mockReturnValue(c);
      c.orderBy.mockReturnValue(c);
      c.set.mockReturnValue(c);
      return c;
    }
    const callerTxSelectChain = makeTxChain([makeStrategy("CANDIDATE")]);
    const callerTx = {
      select: vi.fn().mockReturnValue(callerTxSelectChain),
      update: vi.fn().mockReturnValue(makeTxChain([])),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    };

    const result = await svc.promoteStrategy(
      "strat-uuid-1",
      "CANDIDATE",
      "TESTING",
      {},
      callerTx as unknown as typeof db,
    );

    expect(result.success).toBe(true);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(callerTx.insert).toHaveBeenCalled();
  });

  // ── B5.2: graveyard_burial_pending row ───────────────────────────────────

  // Wave B5: graveyard_burial_pending audit row restored — written INSIDE the transaction
  // so the burial intent is durable even if the post-commit fire-and-forget burial fails.
  it("B5.2: inserts graveyard_burial_pending when transitioning to DECLINING", async () => {
    mockStrategyFetch(mockDb, makeStrategy("DEPLOYED"));
    const actions = captureInsertActions(mockDb._txInner);

    await svc.promoteStrategy("strat-uuid-1", "DEPLOYED", "DECLINING");

    expect(actions).toContain("strategy.graveyard_burial_pending");
  });

  // Wave B5: pending row also written for RETIRED so the burial intent is captured
  // even when the strategy went straight from DECLINING → RETIRED without a prior burial.
  it("B5.2: inserts graveyard_burial_pending when transitioning to RETIRED", async () => {
    mockStrategyFetch(mockDb, makeStrategy("DECLINING"));
    const actions = captureInsertActions(mockDb._txInner);

    // RETIRED path also calls strategyNames.update — ensure it resolves
    mockDb._txInner.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ codename: "FORGE-001" }]),
        }),
      }),
    });

    await svc.promoteStrategy("strat-uuid-1", "DECLINING", "RETIRED");

    expect(actions).toContain("strategy.graveyard_burial_pending");
  });

  it("B5.2: does NOT insert graveyard_burial_pending for non-terminal transitions", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    const actions = captureInsertActions(mockDb._txInner);

    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");

    expect(actions).not.toContain("strategy.graveyard_burial_pending");
  });

  // Wave B5: every successful transition writes the strategy.lifecycle audit row
  // inside the transaction so audit + state always commit together.
  it("B5.2: always inserts strategy.lifecycle audit row inside the transaction", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    const actions = captureInsertActions(mockDb._txInner);

    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");

    expect(actions).toContain("strategy.lifecycle");
  });

  // ── B5.3: broadcastSSE not called inside promoteStrategy ─────────────────

  it("B5.3: broadcastSSE is never called inside promoteStrategy", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    expect(broadcastSSE).not.toHaveBeenCalled();
  });

  it("B5.3: broadcastSSE not called on DECLINING transition", async () => {
    mockStrategyFetch(mockDb, makeStrategy("DEPLOYED"));
    captureInsertActions(mockDb._txInner); // consume to avoid noise
    await svc.promoteStrategy("strat-uuid-1", "DEPLOYED", "DECLINING");
    expect(broadcastSSE).not.toHaveBeenCalled();
  });

  // ── Guards ────────────────────────────────────────────────────────────────

  it("Guard: returns error for invalid transition without touching DB", async () => {
    const result = await svc.promoteStrategy("strat-uuid-1", "GRAVEYARD", "CANDIDATE");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid transition/);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("Guard: blocks DEPLOY_READY→DEPLOYED for system actor", async () => {
    const result = await svc.promoteStrategy("strat-uuid-1", "DEPLOY_READY", "DEPLOYED", { actor: "system" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/manual release/);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("Guard: allows DEPLOY_READY→DEPLOYED for human_release actor", async () => {
    mockStrategyFetch(mockDb, makeStrategy("DEPLOY_READY"));
    const result = await svc.promoteStrategy("strat-uuid-1", "DEPLOY_READY", "DEPLOYED", { actor: "human_release" });
    expect(result.success).toBe(true);
    // Wave B5 atomicity: human-released DEPLOY_READY→DEPLOYED also runs through db.transaction()
    // so the lifecycle update + audit row commit/rollback as a unit.
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it("Guard: returns error when strategy is not found", async () => {
    // _selectChain resolves [] from beforeEach default
    const result = await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Strategy not found");
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("Guard: returns error when actual state does not match fromState", async () => {
    mockStrategyFetch(mockDb, makeStrategy("PAPER")); // actual=PAPER, claimed fromState=CANDIDATE
    const result = await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PAPER/);
    expect(result.error).toMatch(/CANDIDATE/);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  // ── Atomicity: transaction error propagates ───────────────────────────────

  // Wave B5: db.transaction wrapper restored — failures inside the wrapper propagate
  // to the caller (no swallowing) so backtest-service paper-session creation can roll back.
  it("Atomicity: propagates error when db.transaction throws", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    mockDb.transaction.mockRejectedValue(new Error("DB write failed — transaction rolled back"));

    await expect(
      svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING"),
    ).rejects.toThrow("DB write failed — transaction rolled back");
  });
});

// ── FIX 2: Evidence snapshot in audit row ────────────────────────────────────

describe("LifecycleService.promoteStrategy — FIX 2: evidence snapshot in audit row", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    mockDb.transaction.mockImplementation(
      async (cb: (tx: TxInner) => Promise<void>) => { await cb(mockDb._txInner); }
    );
    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);

    const updateChainDefault = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([{ codename: "FORGE-001" }]),
      }),
    };
    mockDb.update.mockReturnValue(updateChainDefault);
    mockDb._txInner.update.mockReturnValue(updateChainDefault);

    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

    mockDb._selectChain._setValue([]);
    mockDb._txInner._selectChain._setValue([]);
  });

  it("FIX 2: audit row contains backtestId, forgeScore, mcSurvivalRate for manual promotion", async () => {
    // select() call order:
    //   1st: strategy lookup (pre-tx read) → strategy in CANDIDATE
    //   2nd: backtests evidence lookup → latest backtest
    //   3rd: monteCarloRuns evidence lookup → mc run
    //   (4th+: inside tx for update/insert — not select)
    let selectCallCount = 0;
    const strategyRow = makeStrategy("CANDIDATE");
    const backtestRow = { id: "bt-uuid-1", forgeScore: "78.5" };
    const mcRow = { probabilityOfRuin: "0.15" }; // survival = 0.85

    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Strategy fetch
        mockDb._selectChain._setValue([strategyRow]);
      } else if (selectCallCount === 2) {
        // Backtest evidence
        mockDb._selectChain._setValue([backtestRow]);
      } else if (selectCallCount === 3) {
        // MC evidence
        mockDb._selectChain._setValue([mcRow]);
      } else {
        mockDb._selectChain._setValue([]);
      }
      return mockDb._selectChain;
    });

    // Capture insert values from txInner
    const capturedAuditResults: Record<string, unknown>[] = [];
    mockDb._txInner.insert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: { action?: string; result?: Record<string, unknown> }) => {
        if (row.action === "strategy.lifecycle" && row.result) {
          capturedAuditResults.push(row.result);
        }
        return Promise.resolve([]);
      }),
    }));

    const result = await svc.promoteStrategy(
      "strat-uuid-1",
      "CANDIDATE",
      "TESTING",
      { actor: "human_release", reason: "manual promotion test" },
    );

    expect(result.success).toBe(true);
    expect(capturedAuditResults).toHaveLength(1);
    const auditResult = capturedAuditResults[0];
    expect(auditResult.backtestId).toBe("bt-uuid-1");
    expect(auditResult.forgeScore).toBeCloseTo(78.5, 1);
    expect(auditResult.mcSurvivalRate).toBeCloseTo(0.85, 2);
  });

  it("FIX 2: audit row has null evidence fields when no backtest exists", async () => {
    let selectCallCount = 0;
    const strategyRow = makeStrategy("CANDIDATE");

    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        mockDb._selectChain._setValue([strategyRow]);
      } else {
        mockDb._selectChain._setValue([]); // no backtest
      }
      return mockDb._selectChain;
    });

    const capturedAuditResults: Record<string, unknown>[] = [];
    mockDb._txInner.insert.mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: { action?: string; result?: Record<string, unknown> }) => {
        if (row.action === "strategy.lifecycle" && row.result) {
          capturedAuditResults.push(row.result);
        }
        return Promise.resolve([]);
      }),
    }));

    const result = await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");

    expect(result.success).toBe(true);
    expect(capturedAuditResults).toHaveLength(1);
    expect(capturedAuditResults[0].backtestId).toBeNull();
    expect(capturedAuditResults[0].forgeScore).toBeNull();
    expect(capturedAuditResults[0].mcSurvivalRate).toBeNull();
  });
});

// ── FIX 3: Tracing span on promoteStrategy ───────────────────────────────────

describe("LifecycleService.promoteStrategy — FIX 3: OTel span", () => {
  let svc: LifecycleService;
  let mockDb: MockDb;

  beforeEach(() => {
    svc = new LifecycleService();
    mockDb = db as unknown as MockDb;
    vi.clearAllMocks();

    // Re-attach transaction mock
    mockDb.transaction.mockImplementation(
      async (cb: (tx: TxInner) => Promise<void>) => { await cb(mockDb._txInner); }
    );
    mockDb.select.mockReturnValue(mockDb._selectChain);
    mockDb._txInner.select.mockReturnValue(mockDb._txInner._selectChain);

    const updateChain = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([]),
      }),
    };
    mockDb.update.mockReturnValue(updateChain);
    mockDb._txInner.update.mockReturnValue(updateChain);
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mockDb._txInner.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

    mockDb._selectChain._setValue([]);
    mockDb._txInner._selectChain._setValue([]);
  });

  /** Get the span returned by the most recent tracer.startSpan() call. */
  function getLastSpan() {
    const mockStartSpan = tracer.startSpan as ReturnType<typeof vi.fn>;
    const lastResult = mockStartSpan.mock.results[mockStartSpan.mock.results.length - 1];
    return lastResult?.value as { setAttribute: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  }

  it("FIX 3: starts a span named 'lifecycle.promote'", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING", { correlationId: "corr-abc" });

    const mockStartSpan = tracer.startSpan as ReturnType<typeof vi.fn>;
    expect(mockStartSpan).toHaveBeenCalledWith("lifecycle.promote");
  });

  it("FIX 3: span attributes include strategy.id, lifecycle.from, lifecycle.to, actor, correlationId", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING", {
      actor: "human_release",
      correlationId: "corr-xyz",
    });

    const span = getLastSpan();
    const calls = span.setAttribute.mock.calls as [string, string | number | boolean][];
    const attrs = Object.fromEntries(calls);

    expect(attrs["strategy.id"]).toBe("strat-uuid-1");
    expect(attrs["lifecycle.from"]).toBe("CANDIDATE");
    expect(attrs["lifecycle.to"]).toBe("TESTING");
    expect(attrs["actor"]).toBe("human_release");
    expect(attrs["correlationId"]).toBe("corr-xyz");
  });

  it("FIX 3: span.end() is called even on guard failures (invalid transition)", async () => {
    await svc.promoteStrategy("strat-uuid-1", "GRAVEYARD", "CANDIDATE");
    const span = getLastSpan();
    expect(span.end).toHaveBeenCalled();
  });

  it("FIX 3: span.end() is called when promotion succeeds", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    await svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING");
    const span = getLastSpan();
    expect(span.end).toHaveBeenCalled();
  });

  it("FIX 3: span sets error=true and error.message when db.transaction throws", async () => {
    mockStrategyFetch(mockDb, makeStrategy("CANDIDATE"));
    mockDb.transaction.mockRejectedValue(new Error("DB exploded"));

    await expect(
      svc.promoteStrategy("strat-uuid-1", "CANDIDATE", "TESTING"),
    ).rejects.toThrow("DB exploded");

    const span = getLastSpan();
    const calls = span.setAttribute.mock.calls as [string, string | number | boolean][];
    const attrs = Object.fromEntries(calls);
    expect(attrs["error"]).toBe(true);
    expect(attrs["error.message"]).toBe("DB exploded");
    expect(span.end).toHaveBeenCalled();
  });
});
