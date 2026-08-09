/**
 * D-10 `F-9` (R-754 §3) — a REFUSED backtest is not critic evidence.
 *
 * `POST /api/critic-optimizer/analyze` resolves the backtest it will analyse by
 * TWO paths, and before this wave NEITHER required `completed`:
 *
 *   implicit — `orderBy(desc(createdAt)).limit(1)` with no status predicate, so
 *              the most recent row wins even when the engine REFUSED to execute it;
 *   explicit — `body.backtest_id` was passed straight through with no lookup at all.
 *
 * A refusal carries NO metrics — every metric column is NULL by construction
 * (R-751 §8-5). Handing that row to the critic presents absent measurements as a
 * measured flat result, which is the "manufactures evidence" class R-754 §3 names
 * as the reason this wave is admitted at all.
 *
 * `A KEY PRESENT AS 0.0 IS A MEASUREMENT; A KEY ABSENT WITH A STATED REASON IS A REFUSAL.`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

const selectMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../db/index.js", () => ({
  db: {
    get select() {
      return selectMock.fn;
    },
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
}));

// NEITHER `../db/schema.js` NOR `drizzle-orm` is mocked here, deliberately.
//
// A first attempt mocked both and died: the real `schema.ts` needs drizzle's `sql`
// at import time, and a hand-written drizzle mock omitting it takes the whole
// module graph down. That failure was worth keeping rather than papering over —
// loading the REAL schema means `BACKTEST_STATUS_REFUSED` is the production
// constant itself, not a restatement of it, so a rename turns this file RED.
// `A MOCK THAT RESTATES THE VALUE IT IS CHECKING IS A COPY, NOT A CONTROL` (R-753 §2).
//
// Only `db` is mocked, so no connection is opened; the query objects the route
// builds are real and simply ignored by the stub chain.

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
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
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

/** A `.select()` chain that tolerates any of from/where/orderBy/limit and resolves to `rows`. */
function chain(rows: unknown[]) {
  const thenable = {
    where: () => thenable,
    orderBy: () => thenable,
    limit: () => Promise.resolve(rows),
    then: (r: (v: unknown[]) => void) => Promise.resolve(rows).then(r),
  };
  return { from: () => thenable };
}

const STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const REFUSED_BT = "22222222-2222-2222-2222-222222222222";
const COMPLETED_BT = "33333333-3333-3333-3333-333333333333";

describe("D-10 F-9 — a refused backtest is not critic evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerMock.fn.mockResolvedValue({ runId: "run-1", status: "started" });
  });

  it("F-9.3 POSITIVE CONTROL — a completed backtest is still analysed normally", async () => {
    // Four of the ten R-754 §3 controls are POSITIVE. A route that refuses
    // everything would satisfy F-9.1/F-9.2 perfectly and is not a repair.
    selectMock.fn.mockReturnValue(chain([{ id: COMPLETED_BT, status: "completed" }]));

    const { status } = await post(await buildApp(), "/api/critic-optimizer/analyze", {
      strategy_id: STRATEGY_ID,
    });

    expect(status).toBe(202);
    expect(triggerMock.fn).toHaveBeenCalledTimes(1);
    expect(triggerMock.fn.mock.calls[0]?.[0]).toBe(COMPLETED_BT);
  });

  it("F-9.1 — implicit 'latest backtest' resolution never selects a REFUSED row", async () => {
    // The DB returns whatever the query asked for. A query with no status
    // predicate gets the refused row; a correct query gets the completed one.
    // Simulating the *filtered* result is not enough — that would assume the fix.
    // So: the mock returns the refused row for an UNFILTERED query, and the
    // control asserts the route never hands that id to the critic.
    selectMock.fn.mockReturnValue(chain([{ id: REFUSED_BT, status: "refused" }]));

    const { status, body } = await post(await buildApp(), "/api/critic-optimizer/analyze", {
      strategy_id: STRATEGY_ID,
    });

    // A refusal must produce a NAMED no-evidence outcome — never a silent analysis.
    expect(triggerMock.fn).not.toHaveBeenCalled();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).toMatch(/refus|no_completed_backtest_evidence/i);
  });

  it("F-9.2 — an explicit REFUSED backtest_id is rejected with a named outcome", async () => {
    selectMock.fn.mockReturnValue(chain([{ id: REFUSED_BT, status: "refused" }]));

    const { status, body } = await post(await buildApp(), "/api/critic-optimizer/analyze", {
      strategy_id: STRATEGY_ID,
      backtest_id: REFUSED_BT,
    });

    expect(triggerMock.fn).not.toHaveBeenCalled();
    expect(status).toBe(422);
    expect(body["error"]).toBe("refused_backtest_no_evidence");
    // The refusal must be named as such — NOT laundered into a generic failure,
    // and NOT reported with zeroed metrics (R-754 §3, F-9 required behaviour).
    expect(JSON.stringify(body)).not.toMatch(/"(sharpe|forge_score|total_return)"\s*:\s*0/);
  });
});
