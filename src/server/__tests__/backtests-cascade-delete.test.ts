/**
 * backtests-cascade-delete.test.ts — deep-scan fix wave (2026-07-10)
 *
 * FIX 1 (FK RESTRICT gap + non-atomic cascade delete on DELETE /api/backtests/:id):
 *   - 6 backtest-scoped tables (adversarial_stress_runs, cloud_qmc_runs,
 *     backtest_provenance, frankenstein_test_runs, strategy_signal_vectors,
 *     shadow_rerun_findings) carry an implicit-RESTRICT FK on backtest_id with
 *     no ON DELETE clause in the live DDL. Before this fix, DELETE
 *     /api/backtests/:id had NO lifecycle-state guard at all, so ANY backtest
 *     with a row in one of these tables would 500 with a raw FK violation.
 *   - The whole cascade + parent delete is now wrapped in db.transaction() so a
 *     mid-cascade failure rolls back atomically instead of partially committing.
 *
 * Pattern: direct handler invocation via router.stack extraction + mocked
 * req/res objects (no supertest — matches existing repo convention).
 *
 * Ported (2026-07-10) onto the live hardening/phase-0 tip from a since-diverged
 * worktree where this fix was originally built and certified (11/11 tests pass).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock every import backtests.ts pulls in ──────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ __inArray: [a, b] }),
  desc: (a: unknown) => ({ __desc: a }),
  and: (...args: unknown[]) => ({ __and: args }),
}));

vi.mock("../db/schema.js", () => {
  const T = (name: string) => ({ __table: name });
  return {
    backtests: T("backtests"),
    backtestTrades: T("backtestTrades"),
    backtestMatrix: T("backtestMatrix"),
    monteCarloRuns: T("monteCarloRuns"),
    stressTestRuns: T("stressTestRuns"),
    strategies: T("strategies"),
    auditLog: T("auditLog"),
    // The 6 previously-uncovered backtest-scoped tables (FIX 1):
    adversarialStressRuns: T("adversarialStressRuns"),
    cloudQmcRuns: T("cloudQmcRuns"),
    backtestProvenance: T("backtestProvenance"),
    frankensteinTestRuns: T("frankensteinTestRuns"),
    strategySignalVectors: T("strategySignalVectors"),
    shadowRerunFindings: T("shadowRerunFindings"),
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

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/matrix-backtest-service.js", () => ({
  runMatrix: vi.fn().mockResolvedValue(undefined),
  getMatrixStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ─── Chain builders ───────────────────────────────────────────────────────────

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

function mockReq(params: Record<string, string> = {}, query: Record<string, string> = {}) {
  return { params, query, id: "test-corr-id" } as any;
}

async function getHandler(method: "post" | "delete" | "get", path: string) {
  const { backtestRoutes } = await import("../routes/backtests.js");
  const layer = (backtestRoutes as any).stack.find((l: any) => {
    const route = l.route;
    if (!route) return false;
    return route.path === path && route.methods[method];
  });
  if (!layer) throw new Error(`Handler not found for ${method.toUpperCase()} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const ALL_6_NEW_TABLE_NAMES = [
  "adversarialStressRuns",
  "cloudQmcRuns",
  "backtestProvenance",
  "frankensteinTestRuns",
  "strategySignalVectors",
  "shadowRerunFindings",
] as const;

describe("DELETE /api/backtests/:id — FK-RESTRICT cascade completeness + atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setupDelete(opts: { failTableName?: string; failErr?: Error } = {}) {
    const schema = (await import("../db/schema.js")) as any;
    const { db } = (await import("../db/index.js")) as any;

    const deleteCalls: unknown[] = [];
    const failTable = opts.failTableName ? schema[opts.failTableName] : undefined;
    const failErr = opts.failErr ?? new Error("simulated FK violation");

    db.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: vi.fn((table: unknown) => {
          deleteCalls.push(table);
          if (failTable && table === failTable) return { where: () => rejectingChain(failErr) };
          if (table === schema.backtests) return { where: () => resolvableChain([{ id: "bt-1" }]) };
          return { where: () => resolvableChain([]) };
        }),
      };
      return cb(tx);
    });

    db.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue(undefined) }));

    return { schema, db, deleteCalls };
  }

  it("deletes all 6 previously-uncovered RESTRICT-FK tables (via tx) and succeeds cleanly", async () => {
    const { schema, db, deleteCalls } = await setupDelete();
    const handler = await getHandler("delete", "/:id");
    const req = mockReq({ id: "bt-1" });
    const res = mockRes();

    await handler(req, res);

    for (const name of ALL_6_NEW_TABLE_NAMES) {
      expect(deleteCalls, `expected ${name} to be deleted in the cascade`).toContain(schema[name]);
    }
    // Pre-existing cascade members must still be present (no regression).
    expect(deleteCalls).toContain(schema.monteCarloRuns);
    expect(deleteCalls).toContain(schema.stressTestRuns);
    expect(deleteCalls).toContain(schema.backtestTrades);
    expect(deleteCalls).toContain(schema.backtests);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();

    expect(res.statusCode).toBe(200);
    expect((res.body as any)?.deleted).toBe(true);
  });

  it("rolls back the whole cascade atomically when a late cascade step rejects", async () => {
    // shadowRerunFindings is deleted near the end of the new-table block,
    // after adversarialStressRuns/cloudQmcRuns/backtestProvenance/
    // frankensteinTestRuns/strategySignalVectors have already been attempted
    // inside the SAME transaction. Forcing failure here proves the earlier
    // deletes ran inside the same open tx (so a real Postgres ROLLBACK would
    // undo them) rather than each being its own auto-committed statement.
    const err = new Error("simulated FK violation on shadow_rerun_findings");
    const { schema, db, deleteCalls } = await setupDelete({ failTableName: "shadowRerunFindings", failErr: err });
    const handler = await getHandler("delete", "/:id");
    const req = mockReq({ id: "bt-1" });
    const res = mockRes();

    await expect(handler(req, res)).rejects.toThrow("simulated FK violation on shadow_rerun_findings");

    expect(deleteCalls).toContain(schema.adversarialStressRuns);
    expect(deleteCalls).toContain(schema.cloudQmcRuns);
    expect(deleteCalls).toContain(schema.backtestProvenance);
    expect(deleteCalls).toContain(schema.frankensteinTestRuns);
    expect(deleteCalls).toContain(schema.strategySignalVectors);
    expect(deleteCalls).toContain(schema.shadowRerunFindings);
    // Never reached: monteCarloRuns/stressTestRuns/backtestTrades/backtests
    // are deleted AFTER the new-table block in source order.
    expect(deleteCalls).not.toContain(schema.backtests);

    expect(res.body).toBeNull();
    expect(db.delete).not.toHaveBeenCalled();
  });
});
