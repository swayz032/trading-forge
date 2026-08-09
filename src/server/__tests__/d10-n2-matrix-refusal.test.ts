/**
 * D-10 `N-2` — a source-level refusal must TERMINATE the matrix, not fill it with zeros.
 * Contract: the `D-10` lane table (`R-758 §5`) — *"a source-level refusal TERMINATES the
 * matrix; remaining combinations do not run; status `refused` with evidence; no cell,
 * best-combo, correlation, ranking or completed SSE."*
 *
 * ─── THE DEFECT, MEASURED AT EVERY HOP ───────────────────────────────────────
 *
 *   :90   const result = await runBacktest(...)        <- may REFUSE
 *   :94   forgeScore: result.forge_score ?? 0          <- THE FABRICATION (7 of them)
 *   :101  tier: result.tier ?? "REJECTED"              <- an invented verdict
 *   :105  results.push(matrixResult)                   <- the lie becomes a CELL
 *   :408  bestCombo = allResults.reduce(by forgeScore) <- the lie enters RANKING
 *   :412  computeCorrelations(allResults)              <- and CORRELATION
 *   :424  db.update(... status: "completed" ...)       <- the run claims completion
 *   :433  broadcastSSE("backtest:matrix-completed")    <- and announces a winner
 *
 * A refusal carries NO metrics by construction (`R-751 §8-5`). Because a refusal is a
 * property of the STRATEGY SOURCE — not of a symbol or a timeframe — every remaining
 * combination would refuse identically, so the matrix has nothing left to learn.
 *
 * The harm is one step worse in KIND than `N-3`'s. `N-3` destroyed an asset silently;
 * this one PUBLISHES A RECOMMENDATION. A strategy that cannot compile at all still
 * yields a "best combo" — a specific symbol and timeframe, on a completed run — and
 * that recommendation is built entirely out of coerced zeroes.
 *
 *   `A RANKING OVER FABRICATED ZEROES STILL HAS A WINNER, AND THE WINNER IS THE
 *    COMBINATION THAT REFUSED FIRST.`
 *
 * ─── THE CONTROLS ────────────────────────────────────────────────────────────
 *
 *   N-2.1  refusal -> NO fabricated cell is persisted
 *   N-2.2  refusal -> remaining combinations DO NOT RUN
 *   N-2.3  refusal -> terminal status is `refused` and carries the engine's evidence
 *   N-2.4  refusal -> NO `matrix-completed` SSE is broadcast
 *   N-2.5  refusal -> NO best-combo and NO correlations are persisted
 *   N-2.6  POSITIVE: a fully measured matrix still completes, ranks, and announces
 *
 * N-2.6 is the discriminator. Without it, a "fix" that simply made the matrix never
 * complete would pass every refusal control while destroying the feature — the
 * `MUT-N3-4` shape that `AR-871 §4` already had to defend against once.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BACKTEST_STATUS_REFUSED } from "../db/schema.js";

// ─── Recorded production effects ─────────────────────────────────────────────
const rec = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  sse: [] as Array<{ event: string; data: any }>,
  btCalls: [] as Array<{ symbol: string; timeframe: string }>,
}));

/**
 * Drives what the engine returns. "refused" = the source cannot be compiled AT ALL.
 * `refuseFromCall` (1-based) refuses only from the Nth call onward, which is what
 * makes the SHARED termination flag observable — see N-2.7.
 */
const btMode = vi.hoisted(() => ({
  mode: "completed" as "completed" | "refused",
  /**
   * Refuse on EXACTLY this call (1-based); every other call measures normally.
   *
   * This is the only fixture shape that can witness the SHARED termination flag.
   * If the calls after the refusal also refused, each worker would stop on its own
   * refusal and the shared flag would be dead code — measured, MUT-N2-3.
   */
  refuseOnlyCall: null as number | null,
}));

vi.mock("../db/index.js", () => {
  // Permissive chain: every method returns the chain, and the chain is thenable.
  // Shape-agnostic on purpose — this lane is about refusal handling, not query shape.
  const makeChain = (): any => {
    const resolve = () => Promise.resolve([] as unknown[]);
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (onOk: (v: unknown[]) => void, onErr?: (e: unknown) => void) =>
              resolve().then(onOk, onErr);
          }
          return () => chain;
        },
      },
    );
    return chain;
  };
  const db: Record<string, unknown> = {
    // runMatrix's only select is the strategy row; correlation selects fall through to [].
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: "strat-1", config: { strategy: {} } }]),
          then: (r: (v: unknown[]) => void) => Promise.resolve([]).then(r),
          orderBy: () => makeChain(),
        }),
        then: (r: (v: unknown[]) => void) => Promise.resolve([]).then(r),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "matrix-1" }]) }),
    }),
    // THE WITNESS: every terminal/progress write the service performs is recorded.
    update: () => ({
      set: (values: Record<string, unknown>) => {
        rec.updates.push(values);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db };
});

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn(async (_id: string, config: any) => {
    const s = config?.strategy ?? {};
    rec.btCalls.push({ symbol: s.symbol, timeframe: s.timeframe });
    const refuseNow =
      btMode.mode === "refused" ||
      btMode.refuseOnlyCall === rec.btCalls.length;
    if (refuseNow) {
      // A REFUSAL: no metric keys at all. Omitted by construction.
      return {
        id: "bt-refused",
        status: BACKTEST_STATUS_REFUSED,
        execution_status: "refused",
        condition_id: "cond-ambiguous-entry",
        disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
        reason: "entry condition not deterministically compilable",
        metrics_omitted: true,
      };
    }
    return {
      id: "bt-done",
      status: "completed",
      forge_score: 72,
      sharpe_ratio: 1.4,
      total_trades: 40,
      win_rate: 0.55,
      profit_factor: 1.3,
      avg_daily_pnl: 120,
      max_drawdown: -0.08,
      tier: "TIER_2",
      execution_time_ms: 10,
    };
  }),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string, data: unknown) => { rec.sse.push({ event, data }); },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runMatrix } from "../services/matrix-backtest-service.js";

// ─── Helpers over the recorded effects ───────────────────────────────────────
const TIER1_COMBOS = 12;      // 3 symbols x 4 tier-1 timeframes
const TIER1_CONCURRENCY = 6;  // the service's own pool size

/** Every cell the service ever persisted, flattened across progress + finalize writes. */
const persistedCells = () =>
  rec.updates.flatMap((u) => (Array.isArray(u.results) ? (u.results as any[]) : []));
const terminalStatuses = () => rec.updates.map((u) => u.status).filter(Boolean);
const sseEvents = () => rec.sse.map((s) => s.event);

beforeEach(() => {
  rec.updates = [];
  rec.sse = [];
  rec.btCalls = [];
  btMode.mode = "completed";
  btMode.refuseOnlyCall = null;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D-10 N-2 — a source-level refusal must terminate the matrix", () => {
  describe("REFUSED ARM — the strategy source cannot be compiled at all", () => {
    beforeEach(() => { btMode.mode = "refused"; });

    it("N-2.1 persists NO fabricated cell for a combination that was never measured", async () => {
      await runMatrix("strat-1");
      // POSITIVE WITNESS that the path RAN: the engine was actually invoked. Without
      // this, a service that returned early on an unrelated error would pass trivially.
      expect(rec.btCalls.length, "the engine must have been called at least once").toBeGreaterThan(0);
      expect(persistedCells()).toHaveLength(0);
    });

    it("N-2.2 does NOT run the remaining combinations", async () => {
      await runMatrix("strat-1");
      expect(rec.btCalls.length).toBeGreaterThan(0);
      // A refusal is a property of the SOURCE, not of a symbol/timeframe, so every
      // remaining combo would refuse identically. At most one wave of already-inflight
      // workers may land; nothing may be pulled after the refusal is seen.
      expect(
        rec.btCalls.length,
        `expected termination, but ${rec.btCalls.length} of ${TIER1_COMBOS} tier-1 combos ran`,
      ).toBeLessThanOrEqual(TIER1_CONCURRENCY);
    });

    it("N-2.3 reaches a terminal status of 'refused' carrying the engine's own evidence", async () => {
      const result: any = await runMatrix("strat-1");
      expect(result.status).toBe("refused");
      expect(terminalStatuses()).toContain("refused");
      expect(terminalStatuses()).not.toContain("completed");
      // The evidence must be the engine's, not a label we invented.
      expect(JSON.stringify(rec.updates)).toContain("cond-ambiguous-entry");
    });

    it("N-2.4 broadcasts NO matrix-completed SSE", async () => {
      await runMatrix("strat-1");
      expect(rec.btCalls.length).toBeGreaterThan(0);
      expect(sseEvents()).not.toContain("backtest:matrix-completed");
    });

    it("N-2.5 persists NO best-combo and NO correlations", async () => {
      const result: any = await runMatrix("strat-1");
      expect(result.bestCombo).toBeUndefined();
      expect(rec.updates.some((u) => u.bestCombo !== undefined)).toBe(false);
      expect(rec.updates.some((u) => u.correlations !== undefined)).toBe(false);
    });
  });

  describe("MIXED ARM — the control that actually witnesses the SHARED flag", () => {
    /**
     * N-2.2 alone is satisfied by something weaker than the property it claims: when
     * EVERY combo refuses, each worker refuses on its own first call and returns, so
     * the run stops after one wave whether or not the workers share a flag at all.
     *
     * Here the first two calls succeed, so those two workers come back for MORE work.
     * They can only be stopped by the flag a DIFFERENT worker set.
     *
     *   `A CONTROL THAT PASSES FOR A WEAKER REASON THAN THE ONE IT CLAIMS IS A
     *    CONTROL YOU HAVE NOT TESTED.`
     *
     * ─── WHY THE BOUND IS "NOT ALL 12" AND NOT "ONE WAVE OF 6" ────────────────
     *
     * MEASURED, and it is an ordering property rather than a defect: the workers that
     * resolve first loop again BEFORE the refusing worker's promise has settled, so at
     * the instant they pull, the flag does not yet exist. Work already dispatched
     * cannot be retracted. The guard stops pulls from the moment the refusal is
     * OBSERVED — the strongest claim a worker pool can make.
     * With the guard the run stops at 8 of 12; without it all 12 run (MUT-N2-3).
     */
    it("N-2.7 a refusal seen by ONE worker stops the others from pulling more work", async () => {
      btMode.refuseOnlyCall = 3; // ONLY call 3 refuses; every other combo would measure
      const result: any = await runMatrix("strat-1");

      expect(rec.btCalls.length).toBeGreaterThanOrEqual(3); // the refusal was actually reached
      expect(
        rec.btCalls.length,
        `workers kept pulling after the refusal was observed: ${rec.btCalls.length} of ${TIER1_COMBOS}`,
      ).toBeLessThan(TIER1_COMBOS);

      expect(result.status).toBe("refused");
      expect(sseEvents()).not.toContain("backtest:matrix-completed");

      // The two REAL measurements are kept — they were genuinely measured. What must
      // never appear is a cell for the combination that refused.
      const cells = persistedCells();
      expect(cells.every((c: any) => c.backtestId !== "bt-refused")).toBe(true);
      expect(cells.every((c: any) => c.forgeScore > 0)).toBe(true);
    });
  });

  describe("COMPLETED ARM — the discriminator", () => {
    it("N-2.6 a fully measured matrix still completes, ranks a best combo, and announces it", async () => {
      const result: any = await runMatrix("strat-1");
      expect(result.status).toBe("completed");
      expect(result.bestCombo).toBeDefined();
      expect(result.bestCombo.forgeScore).toBe(72); // the REAL measured score
      expect(sseEvents()).toContain("backtest:matrix-completed");
      // Every tier-1 combination ran: the fix must not throttle a healthy matrix.
      expect(rec.btCalls.length).toBeGreaterThanOrEqual(TIER1_COMBOS);
    });
  });
});
