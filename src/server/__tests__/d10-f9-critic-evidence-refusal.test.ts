/**
 * D-10 `F-9` (R-754 §3) + its two closeout gaps (R-756 §2, §3).
 *
 * `POST /api/critic-optimizer/analyze` resolves the backtest it will analyse by two
 * paths. Three separate defects lived here:
 *
 *   F-9   — neither path required `completed`, so a REFUSED row (whose metric
 *           columns are ALL NULL by construction, R-751 §8-5) was analysed as if it
 *           were a measured flat result.
 *   GAP 1 — the first fixture's `where()` took NO ARGUMENT, so it could not witness
 *           whether the query filtered at all. It proved the final status gate and
 *           nothing about the query predicate.
 *           `A MOCK THAT ACCEPTS NO ARGUMENT CANNOT WITNESS A PREDICATE.`
 *   GAP 2 — the explicit `backtest_id` was never joined to `strategy_id`, so strategy
 *           A's COMPLETED backtest could be analysed under strategy B's identity and
 *           config. NOT a refusal defect: it fires on the fully completed path.
 *
 * The fixture below OBSERVES predicates instead of discarding them: `eq()` is wrapped
 * so every column/value comparison the route builds is recorded, and the stub DB
 * answers each query according to the predicates it was actually given.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ─── Recorded predicates ─────────────────────────────────────────────────────
const rec = vi.hoisted(() => ({ eqs: [] as Array<{ col: string; val: unknown }> }));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// drizzle is kept REAL (the production `schema.ts` needs `sql` at import time, and a
// hand-written replacement takes the whole module graph down — measured). Only `eq`
// is wrapped, so the predicates stay genuine drizzle objects AND become observable.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      const name =
        (col as { name?: string } | null)?.name ??
        (col as { fieldAlias?: string } | null)?.fieldAlias ??
        String(col);
      rec.eqs.push({ col: name, val });
      return (actual.eq as (a: unknown, b: unknown) => unknown)(col, val);
    },
  };
});

const rowsFor = vi.hoisted(() => ({ fn: null as null | ((eqs: Array<{ col: string; val: unknown }>) => unknown[]) }));

vi.mock("../db/index.js", () => {
  const makeChain = () => {
    // Predicates recorded for THIS query only — reset when `.select()` is called.
    const chain: Record<string, unknown> = {};
    const start = rec.eqs.length;
    const resolve = () => {
      const mine = rec.eqs.slice(start);
      return Promise.resolve(rowsFor.fn ? rowsFor.fn(mine) : []);
    };
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["limit"] = () => resolve();
    chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
    return { from: () => chain };
  };
  return {
    db: {
      select: () => makeChain(),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    },
  };
});

const triggerMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../services/critic-optimizer-service.js", () => ({
  triggerCriticOptimizer: triggerMock.fn,
  getCriticRun: vi.fn().mockResolvedValue(null),
  getCriticHistory: vi.fn().mockResolvedValue([]),
  getCriticCandidates: vi.fn().mockResolvedValue([]),
  manualReplayCandidates: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Harness ─────────────────────────────────────────────────────────────────
async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  const mod = await import("../routes/critic-optimizer.js");
  app.use("/api/critic-optimizer", mod.criticOptimizerRoutes as express.Router);
  return app;
}

async function post(
  app: express.Express,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/critic-optimizer/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const status = res.status;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = (await res.json()) as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        server.close(() => resolve({ status, body: parsed }));
      } catch (e) {
        server.close(() => reject(e));
      }
    });
  });
}

const STRAT_A = "11111111-1111-1111-1111-111111111111";
const STRAT_B = "22222222-2222-2222-2222-222222222222";
const NEWER_REFUSED = "33333333-3333-3333-3333-333333333333";
const OLDER_COMPLETED = "44444444-4444-4444-4444-444444444444";

const hasEq = (eqs: Array<{ col: string; val: unknown }>, col: string, val?: unknown) =>
  eqs.some((e) => e.col === col && (val === undefined || e.val === val));

describe("D-10 F-9 — refusal, query filter and ownership join", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rec.eqs.length = 0;
    rowsFor.fn = null;
    triggerMock.fn.mockResolvedValue({ runId: "run-1", status: "started" });
  });

  // ── GAP 1 (R-756 §2): the QUERY FILTER, not the final gate ─────────────────
  it("F-9.4 — implicit resolution selects the OLDER COMPLETED row over a NEWER REFUSED one", async () => {
    // The stub answers as a real DB would: it applies the predicate it was GIVEN.
    // No `completed` predicate ⇒ newest-first ordering hands back the refused row.
    rowsFor.fn = (eqs) =>
      hasEq(eqs, "status", "completed")
        ? [{ id: OLDER_COMPLETED, status: "completed" }]
        : [{ id: NEWER_REFUSED, status: "refused" }];

    const { status } = await post(await buildApp(), { strategy_id: STRAT_A });

    // POSITIVE CONTROL ON THE INSTRUMENT ITSELF: prove the fixture saw a real
    // predicate at all, so a capture bug cannot masquerade as a production defect.
    expect(hasEq(rec.eqs, "strategy_id")).toBe(true);

    // THE ASSERTION UNDER TEST: the query must have filtered on completed, so the
    // OLDER completed row is what reaches the critic.
    expect(status).toBe(202);
    expect(triggerMock.fn).toHaveBeenCalledTimes(1);
    expect(triggerMock.fn.mock.calls[0]?.[0]).toBe(OLDER_COMPLETED);
  });

  // ── GAP 2 (R-756 §3): the OWNERSHIP JOIN — a completed-path defect ─────────
  it("F-9.5 — strategy A's COMPLETED backtest cannot be analysed under strategy B", async () => {
    // The row exists and is perfectly healthy — it simply belongs to someone else.
    rowsFor.fn = (eqs) =>
      hasEq(eqs, "strategy_id", STRAT_B)
        ? [] // joined query: no such backtest FOR THIS STRATEGY
        : [{ id: OLDER_COMPLETED, status: "completed" }]; // unjoined query: found

    const { status, body } = await post(await buildApp(), {
      strategy_id: STRAT_B,
      backtest_id: OLDER_COMPLETED,
    });

    expect(triggerMock.fn).not.toHaveBeenCalled();
    expect(status).toBe(404);
    expect(body["error"]).toBe("backtest_not_found_for_strategy");
  });

  it("F-9.6 POSITIVE CONTROL — a MATCHING-strategy completed backtest is still analysed", async () => {
    // Without this, F-9.5 is satisfied by a route that rejects every explicit id.
    rowsFor.fn = () => [{ id: OLDER_COMPLETED, status: "completed" }];

    const { status } = await post(await buildApp(), {
      strategy_id: STRAT_A,
      backtest_id: OLDER_COMPLETED,
    });

    expect(status).toBe(202);
    expect(triggerMock.fn).toHaveBeenCalledTimes(1);
    expect(triggerMock.fn.mock.calls[0]?.[0]).toBe(OLDER_COMPLETED);
    // The join must be BY OWNERSHIP, not merely by id.
    expect(hasEq(rec.eqs, "strategy_id", STRAT_A)).toBe(true);
  });

  // ── F-9 original: the refusal gate ─────────────────────────────────────────
  it("F-9.1 — implicit resolution never hands a REFUSED row to the critic", async () => {
    rowsFor.fn = () => [{ id: NEWER_REFUSED, status: "refused" }];

    const { status, body } = await post(await buildApp(), { strategy_id: STRAT_A });

    expect(triggerMock.fn).not.toHaveBeenCalled();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).toMatch(/refus|no_completed_backtest_evidence/i);
  });

  it("F-9.2 — an explicit REFUSED backtest_id is rejected with a named outcome", async () => {
    rowsFor.fn = () => [{ id: NEWER_REFUSED, status: "refused" }];

    const { status, body } = await post(await buildApp(), {
      strategy_id: STRAT_A,
      backtest_id: NEWER_REFUSED,
    });

    expect(triggerMock.fn).not.toHaveBeenCalled();
    expect(status).toBe(422);
    expect(body["error"]).toBe("refused_backtest_no_evidence");
    expect(JSON.stringify(body)).not.toMatch(/"(sharpe|forge_score|total_return)"\s*:\s*0/);
  });

  it("F-9.3 POSITIVE CONTROL — a completed backtest is still analysed normally", async () => {
    rowsFor.fn = () => [{ id: OLDER_COMPLETED, status: "completed" }];

    const { status } = await post(await buildApp(), { strategy_id: STRAT_A });

    expect(status).toBe(202);
    expect(triggerMock.fn).toHaveBeenCalledTimes(1);
  });
});
