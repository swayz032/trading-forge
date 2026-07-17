/**
 * Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — CRIT finding:
 * assembleRecipeData()'s backtests + monte_carlo_runs SELECTs referenced
 * columns/tables that DO NOT EXIST (`backtests.total_pnl`, `backtests.
 * trade_count`, `monte_carlo_runs.result_json`, `monte_carlo_runs.
 * strategy_id`) — verified against src/server/db/schema.ts. Every call threw
 * a real Postgres "column does not exist" error that was silently swallowed
 * by `.catch(() => [])`, so the Backtest panel and Monte Carlo panel (+ the
 * "Worst Day Test" otherTests entry) rendered zeros/defaults for EVERY
 * strategy, forever — a silent failure that the existing mock-based
 * recipe-data.test.ts could not catch, because that suite's `vi.mock` of
 * `db.execute` returns canned fixture data regardless of what SQL text is
 * sent (it never validates the query against a real schema — the exact
 * "fabricated mock masks a real bug" failure class documented in this repo's
 * memory).
 *
 * This suite closes that blind spot: it runs assembleRecipeData() against a
 * REAL Postgres-compatible schema (PGlite, mirroring schema.ts column-for-
 * column via src/server/__tests__/helpers/pglite-db.ts) with real seeded
 * rows, so a query that references a nonexistent column fails the SAME way
 * it would in production — with a thrown SQL error — rather than silently
 * returning fixture data that was never checked against reality.
 *
 * RED-PROOF: reverting recipe-data.ts's backtests/monte_carlo_runs SELECTs to
 * their pre-fix column names against this same PGlite fixture makes every
 * assertion below fail (the query throws "column total_pnl does not exist" /
 * "column result_json does not exist", caught by the source's own .catch(),
 * degrading every field to its zero/default value) — verified manually this
 * fix-wave session before restoring the fix (see session transcript).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "../helpers/pglite-db.js";

let ctx: TestDb;

// recipe-data.ts calls `db.execute(sql\`...\`)` and destructures the result as
// a plain array (`const [bt] = (await db.execute(...)) as any[]`) — matching
// the REAL production driver (drizzle-orm/postgres-js, whose execute() result
// IS array-like). drizzle-orm/pglite's execute() instead returns
// `{ rows: [...] }` (verified empirically) — unwrap .rows here so this mock
// matches the production contract exactly, not just "some DB responds".
vi.mock("../../db/index.js", () => ({
  db: {
    execute: async (query: unknown) => {
      const result = await (ctx.db.execute as (q: unknown) => Promise<{ rows: unknown[] }>)(query);
      return result.rows;
    },
  },
}));

describe("recipe-data (pglite real-schema regression — CRIT column/table fix)", () => {
  beforeAll(async () => {
    ctx = await createTestDb();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("assembles real backtest + Monte Carlo panels from actual schema.ts-shaped tables", async () => {
    const strategyId = randomUUID();
    const backtestId = randomUUID();
    const mcId = randomUUID();

    await ctx.pg.query(
      `INSERT INTO strategies (id, name, symbol, lifecycle_state, config) VALUES ($1, $2, $3, $4, $5)`,
      [strategyId, "vwap-band-mes", "MES", "DEPLOY_READY", JSON.stringify({})],
    );

    // total_trades (real column) — NOT trade_count (never existed).
    // No total_pnl column exists at all — totalPnl is derived from summing
    // daily_pnls, which recipe-data.ts already fetches for the Calendar panel.
    await ctx.pg.query(
      `INSERT INTO backtests (id, strategy_id, total_trades, daily_pnls, equity_curve, result_extras, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        backtestId,
        strategyId,
        1283,
        JSON.stringify([
          { date: "2026-05-01", pnl: 118 },
          { date: "2026-05-02", pnl: 340 },
          { date: "2026-05-03", pnl: -430 },
        ]),
        JSON.stringify([0, 500, 1200, 2300]),
        JSON.stringify({
          wfe_overall: 0.78,
          b15_passed: true,
          a14_severity: "warn",
          b10_pass: true,
          frankenstein_pass: true,
          compliance_pass_rate: 1.0,
        }),
      ],
    );

    // monte_carlo_runs is scoped to a strategy only via backtest_id -> backtests.strategy_id
    // (no strategy_id column on monte_carlo_runs itself). risk_metrics + paths are the
    // real columns; result_json never existed.
    // Paths mirror src/engine/monte_carlo.py::_sample_paths shape: [initial_capital, ...equity].
    // Terminal P&L = last - first: -2840, 42500, 94200.
    await ctx.pg.query(
      `INSERT INTO monte_carlo_runs (id, backtest_id, num_simulations, risk_metrics, paths, probability_of_ruin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        mcId,
        backtestId,
        1000,
        JSON.stringify({ probability_of_ruin_ci: { ci_high: 0.03 } }),
        JSON.stringify([
          [50000, 47160],
          [50000, 92500],
          [50000, 144200],
        ]),
        0.03,
      ],
    );

    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId });

    expect(r.identity.name).toBe("vwap-band-mes");

    // Backtest panel — RED-PROOFs the total_trades / derived-totalPnl fix.
    expect(r.backtest.tradesCount).toBe(1283);
    expect(r.backtest.totalMade).toBe("+$28"); // 118 + 340 - 430
    expect(r.backtest.worstDay).toBe("−$430");
    expect(r.backtest.winningDays).toBe(2);

    // Monte Carlo panel — RED-PROOFs the risk_metrics/paths/backtest_id-join fix.
    expect(r.monteCarlo.blowUpOdds).toBe("3 outta 100");
    expect(r.monteCarlo.verdictGreen).toBe(true); // 0.03 <= default 0.20 threshold
    expect(r.monteCarlo.worstYear).toBe("−$2,840");
    expect(r.monteCarlo.bestYear).toBe("+$94,200");
    expect(r.monteCarlo.medianYear).toBe("+$42,500");
    expect(r.monteCarlo.distribution).toEqual([-2840, 42500, 94200]);
    expect(r.monteCarlo.distributionIsSynthetic).toBe(false);

    // Otherwise-dead "Worst Day Test" now reflects the real a14_severity.
    expect(r.otherTests.find((t) => t.name === "Worst Day Test")?.status).toBe("warn");
  });

  it("fails soft to zero/empty panels when no backtest or MC row exists for the strategy (still honest, not a crash)", async () => {
    const strategyId = randomUUID();
    await ctx.pg.query(
      `INSERT INTO strategies (id, name, symbol, lifecycle_state, config) VALUES ($1, $2, $3, $4, $5)`,
      [strategyId, "brand-new-strat", "MNQ", "CANDIDATE", JSON.stringify({})],
    );

    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const r = await assembleRecipeData({ strategyId });

    expect(r.backtest.tradesCount).toBe(0);
    expect(r.backtest.totalMade).toBe("$0");
    expect(r.monteCarlo.blowUpOdds).toBe("0 outta 100");
    expect(r.monteCarlo.verdictGreen).toBe(false); // ciHighRaw=null, never misleadingly green
    expect(r.monteCarlo.distributionIsSynthetic).toBe(true);
  });

  it("scopes monte_carlo_runs by strategy via the backtest_id join — a different strategy's MC row never leaks in", async () => {
    const strategyA = randomUUID();
    const strategyB = randomUUID();
    const backtestA = randomUUID();
    const backtestB = randomUUID();

    await ctx.pg.query(
      `INSERT INTO strategies (id, name, symbol, lifecycle_state, config) VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)`,
      [
        strategyA, "strat-a", "MES", "PAPER", JSON.stringify({}),
        strategyB, "strat-b", "MNQ", "PAPER", JSON.stringify({}),
      ],
    );
    await ctx.pg.query(
      `INSERT INTO backtests (id, strategy_id, total_trades, daily_pnls, equity_curve, result_extras, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()), ($7,$8,$9,$10,$11,$12,NOW())`,
      [
        backtestA, strategyA, 10, "[]", "[]", "{}",
        backtestB, strategyB, 20, "[]", "[]", "{}",
      ],
    );
    // Only strategy B's backtest has an MC run.
    await ctx.pg.query(
      `INSERT INTO monte_carlo_runs (id, backtest_id, num_simulations, risk_metrics, paths, probability_of_ruin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [randomUUID(), backtestB, 1000, JSON.stringify({ probability_of_ruin_ci: { ci_high: 0.5 } }), "[]", 0.5],
    );

    const { assembleRecipeData } = await import("../../lib/slumhouse/recipe-data.js");
    const rA = await assembleRecipeData({ strategyId: strategyA });
    const rB = await assembleRecipeData({ strategyId: strategyB });

    // Strategy A must NOT see strategy B's MC row (no cross-strategy leak via a missing/wrong join).
    expect(rA.monteCarlo.verdictGreen).toBe(false); // no MC row for A -> ciHighRaw null
    expect(rB.monteCarlo.verdictGreen).toBe(false); // 0.5 > 0.20 threshold -> real block
    expect(rB.monteCarlo.blowUpOdds).toBe("50 outta 100");
  });
});
