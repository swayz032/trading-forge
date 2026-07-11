/**
 * strategies-cascade-delete-symbol-sync.test.ts — deep-scan fix wave (2026-07-10)
 *
 * FIX 1 (FK RESTRICT gap + non-atomic cascade delete on DELETE /api/strategies/:id):
 *   - 11 tables (adversarial_stress_runs, cloud_qmc_runs, backtest_provenance,
 *     frankenstein_test_runs, strategy_signal_vectors, shadow_rerun_findings,
 *     strategy_lockouts, strategy_firm_eligibility, strategy_dsl_features,
 *     tradingview_markers, strategy_pending_buckets.graduated_strategy_id) carry
 *     an implicit-RESTRICT FK to strategies(id)/backtests(id) with no ON DELETE
 *     clause in the live DDL. Before this fix, deleting a CANDIDATE/TESTING
 *     strategy with a row in any of these tables would 500 with a raw FK
 *     violation. After the fix, all 11 are covered.
 *   - The whole cascade + parent delete is now wrapped in db.transaction() so a
 *     mid-cascade failure rolls back atomically instead of partially committing.
 *
 * FIX 2 (strategies.symbol / symbols[] desync on POST /api/strategies and
 *   PATCH /api/strategies/:id): both handlers now derive whichever of
 *   symbol/symbols the caller omitted, keeping both in sync.
 *
 * Pattern: direct handler invocation via router.stack extraction + mocked
 * req/res objects (no supertest — matches existing repo convention, e.g.
 * wave26-trade-journal-route.test.ts, quantum-cost-route.test.ts). Every
 * dependency of src/server/routes/strategies.ts is mocked at the module
 * boundary so the REAL route handler code runs against fake data.
 *
 * Ported (2026-07-10) onto the live hardening/phase-0 tip after this route file
 * gained Zod body validation (commit f0faadec) concurrently with this fix's
 * original certification in a since-diverged worktree. `symbol` was made
 * `.optional()` in `strategyWriteSchema` (was required) to let the "only
 * `symbols` provided" POST case reach deriveSymbolSync instead of 400ing at
 * the validation layer — see strategies.ts comment at that schema field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock every import strategies.ts pulls in ─────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ __inArray: [a, b] }),
  and: (...args: unknown[]) => ({ __and: args }),
  or: (...args: unknown[]) => ({ __or: args }),
  desc: (a: unknown) => ({ __desc: a }),
  asc: (a: unknown) => ({ __asc: a }),
  ilike: (a: unknown, b: unknown) => ({ __ilike: [a, b] }),
  sql: Object.assign((strings: unknown, ...vals: unknown[]) => ({ __sql: true, strings, vals }), {
    raw: (s: string) => s,
  }),
}));

vi.mock("../db/schema.js", () => {
  const T = (name: string) => ({ __table: name });
  return {
    strategies: T("strategies"),
    backtests: T("backtests"),
    backtestTrades: T("backtestTrades"),
    monteCarloRuns: T("monteCarloRuns"),
    stressTestRuns: T("stressTestRuns"),
    backtestMatrix: T("backtestMatrix"),
    systemJournal: T("systemJournal"),
    complianceReviews: T("complianceReviews"),
    paperSessions: T("paperSessions"),
    skipDecisions: T("skipDecisions"),
    strategyGraveyard: T("strategyGraveyard"),
    auditLog: T("auditLog"),
    strategyExports: T("strategyExports"),
    strategyExportArtifacts: T("strategyExportArtifacts"),
    strategyPendingBuckets: T("strategyPendingBuckets"),
    strategyPendingMentions: T("strategyPendingMentions"),
    // The 11 previously-uncovered tables (FIX 1):
    adversarialStressRuns: T("adversarialStressRuns"),
    cloudQmcRuns: T("cloudQmcRuns"),
    backtestProvenance: T("backtestProvenance"),
    frankensteinTestRuns: T("frankensteinTestRuns"),
    strategySignalVectors: T("strategySignalVectors"),
    shadowRerunFindings: T("shadowRerunFindings"),
    strategyLockouts: T("strategyLockouts"),
    strategyFirmEligibility: T("strategyFirmEligibility"),
    strategyDslFeatures: T("strategyDslFeatures"),
    tradingviewMarkers: T("tradingviewMarkers"),
  };
});

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));

vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    async promoteStrategy() {
      return { success: true };
    }
    async checkAutoPromotions() {
      return [];
    }
    async checkAutoDemotions() {
      return [];
    }
    async checkPilotAutoPromotions() {
      return [];
    }
  },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/agent-service.js", () => ({
  assertCrossValidatedSource: vi.fn(),
}));

vi.mock("../lib/office-control-guard.js", () => ({
  requireOfficeControlAuthority: vi.fn().mockReturnValue(true),
}));

// strategies.ts imports this as "./slumhouse/deploy-approvals.js" relative to
// src/server/routes/ — from this test file (src/server/__tests__/) the same
// absolute file is "../routes/slumhouse/deploy-approvals.js". Not exercised
// by the POST/PATCH/DELETE handlers under test, but strategies.ts imports it
// unconditionally at module load, so it must resolve without touching a DB.
vi.mock("../routes/slumhouse/deploy-approvals.js", () => ({
  buildDeployEvidence: vi.fn().mockResolvedValue({ approvable: true, evidenceState: "ok", blockers: [] }),
}));

// ─── Chain builders (plain helpers — not part of any vi.mock factory) ────────

function resolvableChain(rows: unknown) {
  const p = Promise.resolve(rows);
  return Object.assign(Object.create(null), {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    returning: () => p,
  });
}

function rejectingChain(err: unknown) {
  const p = Promise.reject(err);
  return Object.assign(Object.create(null), {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    returning: () => p,
  });
}

/** db.select().from(strategies).where(eq(...)).limit(1) */
function makeSelectStrategyChain(rows: unknown[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) };
}

/** tx.select({id: backtests.id}).from(backtests).where(eq(...)) — no .limit() */
function makeSelectBtChain(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

/** tx.update(table).set(vals).where(cond) */
function makeUpdateChain(rows: unknown[] = [], setSpy?: (vals: unknown) => void) {
  return {
    set: (vals: unknown) => {
      setSpy?.(vals);
      return { where: () => resolvableChain(rows) };
    },
  };
}

/** db.insert(table).values(vals)[.returning()] */
function makeInsertChain(rows: unknown[] = [], valuesSpy?: (vals: unknown) => void) {
  return {
    values: (vals: unknown) => {
      valuesSpy?.(vals);
      return resolvableChain(rows);
    },
  };
}

// ─── Mock req / res helpers (matches wave26-trade-journal-route.test.ts) ─────

function mockRes() {
  const obj = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      obj.statusCode = code;
      return obj;
    },
    json(b: unknown) {
      obj.body = b;
      return obj;
    },
  };
  return obj;
}

function mockReq(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  return { body, params, query, id: "test-corr-id" } as any;
}

// ─── Handler extraction via router.stack (no supertest) ──────────────────────

async function getHandler(method: "post" | "patch" | "delete", path: string) {
  const { strategyRoutes } = await import("../routes/strategies.js");
  const layer = (strategyRoutes as any).stack.find((l: any) => {
    const route = l.route;
    if (!route) return false;
    return route.path === path && route.methods[method];
  });
  if (!layer) throw new Error(`Handler not found for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const ALL_11_NEW_TABLE_NAMES = [
  "adversarialStressRuns",
  "cloudQmcRuns",
  "backtestProvenance",
  "frankensteinTestRuns",
  "strategySignalVectors",
  "shadowRerunFindings",
  "strategyLockouts",
  "strategyFirmEligibility",
  "strategyDslFeatures",
  "tradingviewMarkers",
] as const; // strategyPendingBuckets handled separately (update, not delete)

describe("DELETE /api/strategies/:id — FK-RESTRICT cascade completeness + atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Wires up db.select/db.insert/db.transaction for the "happy path" through
   * the DELETE handler: strategy exists in a deletable, non-bury state
   * (CANDIDATE), has one backtest, and every cascade delete succeeds unless
   * `failTableName` names one of the mocked schema tables to reject on.
   */
  async function setupDelete(opts: { failTableName?: string; failErr?: Error } = {}) {
    const schema = (await import("../db/schema.js")) as any;
    const { db } = (await import("../db/index.js")) as any;

    const strategyRowFixture = {
      id: "strat-1",
      name: "test-strategy",
      symbol: "MES",
      timeframe: "5m",
      lifecycleState: "CANDIDATE",
      forgeScore: null,
      rollingSharpe30d: null,
      generation: 0,
      parentStrategyId: null,
      source: "manual",
      tags: [],
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    db.select.mockImplementation(() => makeSelectStrategyChain([strategyRowFixture]));
    db.insert.mockImplementation(() => makeInsertChain([]));

    const deleteCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const failTable = opts.failTableName ? schema[opts.failTableName] : undefined;
    const failErr = opts.failErr ?? new Error("simulated FK violation");

    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        select: vi.fn(() => makeSelectBtChain([{ id: "bt-1" }])),
        delete: vi.fn((table: unknown) => {
          deleteCalls.push(table);
          if (failTable && table === failTable) return { where: () => rejectingChain(failErr) };
          if (table === schema.strategies) return { where: () => resolvableChain([strategyRowFixture]) };
          return { where: () => resolvableChain([]) };
        }),
        update: vi.fn((table: unknown) => {
          updateCalls.push(table);
          return makeUpdateChain([]);
        }),
      };
      return cb(tx);
    });

    return { schema, db, deleteCalls, updateCalls, strategyRowFixture };
  }

  it("deletes all 11 previously-uncovered RESTRICT-FK tables (via tx) and succeeds cleanly", async () => {
    const { schema, db, deleteCalls, updateCalls } = await setupDelete();
    const handler = await getHandler("delete", "/:id");
    const req = mockReq({}, { id: "strat-1" }, { bury: "false" });
    const res = mockRes();

    await handler(req, res);

    // Completeness regression: every one of the 11 tables must appear in the
    // cascade. If a future edit drops one, this fails loudly.
    for (const name of ALL_11_NEW_TABLE_NAMES) {
      expect(deleteCalls, `expected ${name} to be deleted in the cascade`).toContain(schema[name]);
    }
    expect(updateCalls).toContain(schema.strategyPendingBuckets);

    // Pre-existing cascade members must still be present (no regression).
    expect(deleteCalls).toContain(schema.backtestTrades);
    expect(deleteCalls).toContain(schema.monteCarloRuns);
    expect(deleteCalls).toContain(schema.stressTestRuns);
    expect(deleteCalls).toContain(schema.backtests);
    expect(deleteCalls).toContain(schema.strategies);

    // The whole cascade ran through ONE db.transaction() call.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // No cascade delete/update ever bypassed the transaction via the
    // top-level (non-tx) db handle — this is what makes rollback real.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();

    expect(res.statusCode).toBe(200);
    expect((res.body as any)?.deleted).toBe(true);
  });

  it("rolls back the whole cascade atomically when a late cascade step rejects", async () => {
    // tradingviewMarkers is deleted near the END of the cascade (after most
    // other tables) — picking it proves most prior deletes were attempted
    // inside the SAME open transaction before the failure, i.e. a real
    // Postgres ROLLBACK would undo them all rather than leaving a partial
    // delete. This is the "if the harness supports it" forced-failure
    // injection: we can't observe a real Postgres ROLLBACK without a live
    // DB, so we verify the WIRING that guarantees it — every cascade
    // operation runs through the SAME `tx` handle inside ONE
    // db.transaction() callback, and the rejection propagates rather than
    // being swallowed (which is exactly what makes Drizzle/Postgres roll
    // back automatically).
    const err = new Error("simulated FK violation on tradingview_markers");
    const { schema, db, deleteCalls } = await setupDelete({ failTableName: "tradingviewMarkers", failErr: err });
    const handler = await getHandler("delete", "/:id");
    const req = mockReq({}, { id: "strat-1" }, { bury: "false" });
    const res = mockRes();

    await expect(handler(req, res)).rejects.toThrow("simulated FK violation on tradingview_markers");

    // Everything up to and including the poison table was attempted inside
    // the transaction (proves it wasn't skipped/short-circuited)...
    expect(deleteCalls).toContain(schema.strategyDslFeatures); // ordered just before tradingviewMarkers
    expect(deleteCalls).toContain(schema.tradingviewMarkers);
    // ...but the strategy row delete AFTER the poison table was never reached.
    expect(deleteCalls).not.toContain(schema.strategies);

    // No response was ever sent — the handler's own promise rejected before
    // reaching res.json/res.status, so a caller (Express's error middleware
    // in production) sees a clean failure, not a false-success 200.
    expect(res.body).toBeNull();

    // The cascade never fell back to the non-transactional top-level db
    // handle — atomicity is real, not just attempted.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/strategies — symbol/symbols sync (FIX 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupPost() {
    const { db } = (await import("../db/index.js")) as any;
    const valuesSpy = vi.fn();
    db.insert.mockImplementation(() => makeInsertChain([{ id: "new-strat-1", name: "x" }], valuesSpy));
    const handler = await getHandler("post", "/");
    return { db, valuesSpy, handler };
  }

  it("derives symbols=[symbol] when only `symbol` is provided", async () => {
    const { valuesSpy, handler } = await setupPost();
    const req = mockReq({ name: "s1", symbol: "MNQ", timeframe: "5m", config: {} });
    const res = mockRes();

    await handler(req, res);

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "MNQ", symbols: ["MNQ"] }),
    );
  });

  it("derives symbol=symbols[0] when only `symbols` is provided", async () => {
    const { valuesSpy, handler } = await setupPost();
    const req = mockReq({ name: "s1", symbols: ["MNQ", "MES"], timeframe: "5m", config: {} });
    const res = mockRes();

    await handler(req, res);

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "MNQ", symbols: ["MNQ", "MES"] }),
    );
  });

  it("trusts the caller's exact values when both `symbol` and `symbols` are provided", async () => {
    const { valuesSpy, handler } = await setupPost();
    const req = mockReq({ name: "s1", symbol: "MCL", symbols: ["MCL", "MES"], timeframe: "5m", config: {} });
    const res = mockRes();

    await handler(req, res);

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "MCL", symbols: ["MCL", "MES"] }),
    );
  });
});

describe("PATCH /api/strategies/:id — symbol/symbols sync (FIX 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupPatch() {
    const { db } = (await import("../db/index.js")) as any;
    const setSpy = vi.fn();
    db.update.mockImplementation(() => makeUpdateChain([{ id: "strat-1", symbol: "MES", symbols: ["MES"] }], setSpy));
    const handler = await getHandler("patch", "/:id");
    return { db, setSpy, handler };
  }

  it("derives symbols=[symbol] when only `symbol` is provided in the PATCH body", async () => {
    const { setSpy, handler } = await setupPatch();
    const req = mockReq({ symbol: "MNQ" }, { id: "strat-1" });
    const res = mockRes();

    await handler(req, res);

    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: "MNQ", symbols: ["MNQ"] }));
  });

  it("derives symbol=symbols[0] when only `symbols` is provided in the PATCH body (previously not even destructured)", async () => {
    const { setSpy, handler } = await setupPatch();
    const req = mockReq({ symbols: ["MNQ", "MCL"] }, { id: "strat-1" });
    const res = mockRes();

    await handler(req, res);

    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: "MNQ", symbols: ["MNQ", "MCL"] }));
  });

  it("trusts the caller's exact values when both are provided in the PATCH body", async () => {
    const { setSpy, handler } = await setupPatch();
    const req = mockReq({ symbol: "MCL", symbols: ["MCL", "MES"] }, { id: "strat-1" });
    const res = mockRes();

    await handler(req, res);

    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ symbol: "MCL", symbols: ["MCL", "MES"] }));
  });

  it("touches neither symbol nor symbols when the PATCH body has neither (no accidental reset)", async () => {
    const { setSpy, handler } = await setupPatch();
    const req = mockReq({ name: "renamed" }, { id: "strat-1" });
    const res = mockRes();

    await handler(req, res);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const setArg = setSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty("symbol");
    expect(setArg).not.toHaveProperty("symbols");
  });
});
