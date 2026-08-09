/**
 * D-10 `N-3` — evolution must not act on a refusal it never measured.
 * Contract: `R-760 §3` + `R-761 §4a`, amended by `R-762 §2` (ONE control set).
 *
 * ─── THE DEFECT, MEASURED AT EVERY HOP (`R-760 §2`) ──────────────────────────
 *
 *   :435  const result = await runBacktest(...)          <- may REFUSE
 *   :436  const mutSharpe = result.sharpe_ratio ?? 0;    <- THE FABRICATION
 *   :439  improvement = (mutSharpe - parentSharpe) / parentSharpe
 *                                                        <- exactly -1.0 for any P>0
 *   :481  db.insert(mutationOutcomes)                    <- the lie becomes evidence
 *   :512  .filter(r => r.improvement >= 0.10)            <- -1.0 can NEVER clear it
 *   :749  loser path -> lifecycle.promoteStrategy(.., "RETIRED")
 *
 * A refusal carries NO metrics by construction (`R-751 §8-5`), so `?? 0` converts
 * "I could not evaluate this" into "I evaluated it and it lost 100%". When every
 * mutation refuses, the HEALTHY PARENT IS RETIRED and the fabricated -1.0 is filed
 * into `mutationOutcomes` — the corpus the evolver learns from.
 *
 *   `THE INSTRUMENT DESTROYS AN ASSET AND THEN LEARNS THE WRONG LESSON FROM ITS
 *    OWN VANDALISM.`
 *
 * ─── WHY ONE CONTROL SET AND NOT TWO (`R-762 §2`) ────────────────────────────
 *
 * `N-1` needed a witness per caller because it had TWO INDEPENDENT TRANSCRIPTIONS
 * of one decision that had already drifted three rulings running. `N-3` has exactly
 * ONE `evolveStrategy()` implementation and ONE `runBacktest()` site, so the two
 * upstream triggers share a single decision boundary.
 *
 *   `A WITNESS IS OWED PER INDEPENDENT IMPLEMENTATION OF THE DECISION, NOT PER
 *    TRIGGER.`
 *
 * ─── THE OBSERVABLES ARE EXECUTED WRITES, NEVER A FIXTURE EXCEPTION ──────────
 *
 * `R-761` cost a lane a round-trip because a control asserted on a throw that only
 * existed because the stub could not satisfy a read. Every witness below is a real
 * production effect: a `promoteStrategy(.., "RETIRED")` CALL, a row handed to
 * `db.insert(mutationOutcomes)`, a row handed to `db.insert(auditLog)`. Tables are
 * joined BY IDENTITY against the real schema objects, not by name string.
 *
 * ─── THE CONTROLS ────────────────────────────────────────────────────────────
 *
 *   N-3.1  refusal -> NO mutationOutcomes measurement row
 *   N-3.2  refusal -> NO parent retirement                        <- the severe one
 *   N-3.3  refusal -> a NAMED, PERSISTED refusal outcome (not silence)
 *   N-3.4  refusal -> no fabricated -1.0 improvement persisted anywhere
 *   N-3.5  refusal -> no child strategy created
 *   N-3.6  POSITIVE: a measured winner still writes real evidence + creates a child
 *   N-3.7  POSITIVE: an all-measured loser still RETIRES        <- feature preserved
 *   N-3.8  POSITIVE: a real improvement is computed from real numbers
 *   N-3.9  MIXED: one refused + one measured loser -> no retirement on unmeasured
 *                 evidence, and the measured mutation is still recorded
 *
 * N-3.6/N-3.7/N-3.8 are the discriminators. A suite where every test reddens
 * together cannot tell "catches breakage" from "always red" — and N-3.7 is the one
 * that keeps the fix honest: a repair that made retirement unreachable would pass
 * every refusal control while destroying the feature.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { strategies, backtests, auditLog, mutationOutcomes, BACKTEST_STATUS_REFUSED } from "../db/schema.js";

// ─── Recorded production effects ─────────────────────────────────────────────
const rec = vi.hoisted(() => ({
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  promotions: [] as Array<{ id: string; from: unknown; to: string }>,
  sse: [] as Array<{ event: string; data: unknown }>,
}));

// Queues driven per test.
const selectQueue = vi.hoisted(() => ({ q: [] as unknown[][] }));
const btQueue = vi.hoisted(() => ({ q: [] as unknown[] }));
const evolverOut = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../db/index.js", () => {
  // `.values()` must be awaitable, `.catch()`-able AND expose `.returning()`.
  const insertResult = () => {
    const p: any = Promise.resolve([{ id: "child-strategy-1" }]);
    p.returning = () => Promise.resolve([{ id: "child-strategy-1" }]);
    return p;
  };
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(selectQueue.q.shift() ?? []);
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["limit"] = () => resolve();
    chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
    return { from: () => chain };
  };
  const db: Record<string, unknown> = {
    select: () => makeChain(),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        rec.inserts.push({ table, values });
        return insertResult();
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  db["transaction"] = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db };
});

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn(async () => {
    if (btQueue.q.length === 0) throw new Error("fixture: runBacktest called more times than queued");
    return btQueue.q.shift();
  }),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(async () => evolverOut.value),
}));

// Breakers pass straight through — this lane is not about breaker behaviour.
vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: { get: () => ({ call: (fn: () => unknown) => fn() }) },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string, data: unknown) => { rec.sse.push({ event, data }); },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// THE RETIREMENT WITNESS. Every lifecycle transition this service requests is
// recorded here, so "the parent was retired" is an observed CALL, not an inference.
vi.mock("../services/lifecycle-service.js", () => ({
  LifecycleService: class {
    async promoteStrategy(id: string, from: unknown, to: string) {
      rec.promotions.push({ id, from, to });
      return { success: true };
    }
  },
}));

vi.mock("../services/agent-service.js", () => ({
  assertCrossValidatedSource: vi.fn(),
}));

vi.mock("../services/graduated-strategy-auditor.js", () => ({
  auditGraduatedConfig: vi.fn(() => ({ passed: true, defects: [], warnings: [] })),
  formatAuditResult: vi.fn(() => "ok"),
}));

import { evolveStrategy } from "../services/evolution-service.js";

// ─── Fixture builders ────────────────────────────────────────────────────────

const PARENT_SHARPE = "1.0"; // parent measured at 1.0 -> a fabricated 0 yields exactly -1.0

/**
 * `tags: []` is deliberate: it makes `currentArchetype` null, which short-circuits
 * BOTH cross-archetype queries in the ternaries at :263 and :284. The select queue
 * below therefore has exactly four members, and `assertQueueDrained()` fails loudly
 * if the production path ever asks for a fifth.
 */
const strategyRow = () => ({
  id: "strat-1",
  name: "Test Strategy",
  symbol: "MES",
  timeframe: "5m",
  config: { strategy: { indicators: [{ type: "sma", period: 20 }] } },
  generation: 0,
  lifecycleState: "DECLINING",
  tags: [] as string[],
  preferredRegime: null,
  rollingSharpe30d: PARENT_SHARPE,
  lineageRootId: null,
  parentStrategyId: null,
  createdAt: new Date("2026-01-01"),
});

const parentBacktestRow = () => ({
  id: "bt-parent",
  strategyId: "strat-1",
  status: "completed",
  sharpeRatio: PARENT_SHARPE,
  profitFactor: "1.2",
  maxDrawdown: "-0.05",
  walkForwardResults: null,
  createdAt: new Date("2026-01-02"),
});

/** A REFUSAL: no `sharpe_ratio` key at all. Metrics omitted by construction. */
const refusedResult = () => ({
  id: "bt-refused",
  status: BACKTEST_STATUS_REFUSED,
  execution_status: "refused",
  condition_id: "cond-ambiguous-entry",
  disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
  reason: "entry condition not deterministically compilable",
  metrics_omitted: true,
});

const completedResult = (sharpe: number, id = "bt-done") => ({
  id,
  status: "completed",
  sharpe_ratio: sharpe,
  profit_factor: 1.4,
  max_drawdown: -0.08,
});

const mutations = (n: number) => ({
  model: "test-model",
  parent_params: { ind_0_period: 20 },
  mutations: Array.from({ length: n }, (_, i) => ({
    params: { ind_0_period: 30 + i },
    reason: `widen period ${i}`,
  })),
});

function seedSelects() {
  selectQueue.q = [
    [strategyRow()],       // 1. load strategy
    [],                    // 2. cooldown: no recent evolutions
    [parentBacktestRow()], // 3. parent baseline backtest
    [],                    // 4. prior mutation outcomes
  ];
}

/** Positive control on the FIXTURE itself: the production path consumed exactly
 *  the queries this queue models. A leftover member means the code took a
 *  different route and every assertion below is about the wrong run. */
function assertQueueDrained() {
  expect(selectQueue.q, "fixture drift: production asked for fewer queries than seeded").toHaveLength(0);
  expect(btQueue.q, "fixture drift: not every queued backtest was consumed").toHaveLength(0);
}

const rowsFor = (table: unknown) => rec.inserts.filter((i) => i.table === table).map((i) => i.values);
const retirements = () => rec.promotions.filter((p) => p.to === "RETIRED");

beforeEach(() => {
  rec.inserts = [];
  rec.promotions = [];
  rec.sse = [];
  btQueue.q = [];
  evolverOut.value = null;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D-10 N-3 — a compile refusal must not be scored, persisted, or acted on", () => {
  describe("REFUSED ARM — every mutation refuses", () => {
    beforeEach(() => {
      seedSelects();
      evolverOut.value = mutations(1);
      btQueue.q = [refusedResult()];
    });

    it("N-3.1 writes NO mutationOutcomes measurement row for a refusal", async () => {
      await evolveStrategy("strat-1");
      assertQueueDrained();
      expect(rowsFor(mutationOutcomes)).toHaveLength(0);
    });

    it("N-3.2 does NOT retire the parent when nothing was ever measured", async () => {
      await evolveStrategy("strat-1");
      assertQueueDrained();
      // POSITIVE WITNESS that the path RAN: the lifecycle service was reachable and
      // the run reached its terminal decision. A negative assertion alone would be
      // satisfied by a function that did nothing at all.
      expect(rec.inserts.length, "the run must have persisted SOMETHING").toBeGreaterThan(0);
      expect(retirements()).toHaveLength(0);
    });

    it("N-3.3 persists a NAMED refusal outcome rather than falling silent", async () => {
      await evolveStrategy("strat-1");
      assertQueueDrained();
      const audits = rowsFor(auditLog);
      const refusalRows = audits.filter((r) => /refus/i.test(String(r.action)));
      expect(refusalRows, `no named refusal row; actions seen: ${audits.map((a) => a.action).join(", ")}`).not.toHaveLength(0);
      // The row must carry the engine's own evidence, not merely a label.
      expect(JSON.stringify(refusalRows[0])).toContain("cond-ambiguous-entry");
    });

    it("N-3.4 persists no fabricated -1.0 improvement anywhere", async () => {
      await evolveStrategy("strat-1");
      assertQueueDrained();
      const blob = JSON.stringify(rec.inserts.map((i) => i.values));
      expect(blob).not.toContain("-1.0000");
      expect(blob).not.toContain("-100.0%");
    });

    it("N-3.5 creates no child strategy from an unmeasured mutation", async () => {
      await evolveStrategy("strat-1");
      assertQueueDrained();
      expect(rowsFor(strategies)).toHaveLength(0);
      expect(rec.promotions.filter((p) => p.to !== "RETIRED")).toHaveLength(0);
    });
  });

  describe("COMPLETED ARM — the discriminators", () => {
    it("N-3.6 a measured winner still writes real evidence and creates a child", async () => {
      seedSelects();
      evolverOut.value = mutations(1);
      btQueue.q = [completedResult(2.0)]; // +100% vs parent 1.0 -> clears the 10% bar
      await evolveStrategy("strat-1");
      assertQueueDrained();

      const outcomes = rowsFor(mutationOutcomes);
      expect(outcomes).toHaveLength(1);
      expect((outcomes[0].childMetrics as { sharpe: number }).sharpe).toBe(2.0);
      expect(outcomes[0].success).toBe(true);
      expect(rowsFor(strategies)).toHaveLength(1);
      expect(retirements()).toHaveLength(0);
    });

    it("N-3.7 an all-measured loser STILL retires the parent (feature preserved)", async () => {
      seedSelects();
      evolverOut.value = mutations(1);
      btQueue.q = [completedResult(1.02)]; // real, measured, only +2% -> below threshold
      await evolveStrategy("strat-1");
      assertQueueDrained();

      expect(rowsFor(mutationOutcomes)).toHaveLength(1);
      expect(retirements()).toHaveLength(1);
      expect(retirements()[0].id).toBe("strat-1");
    });

    it("N-3.8 computes improvement from real numbers, not a coerced zero", async () => {
      seedSelects();
      evolverOut.value = mutations(1);
      btQueue.q = [completedResult(1.5)];
      await evolveStrategy("strat-1");
      assertQueueDrained();

      const outcomes = rowsFor(mutationOutcomes);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].improvement).toBe("0.5000"); // (1.5 - 1.0), the real delta
    });
  });

  describe("MIXED ARM — a refusal contaminates the exhaustion claim", () => {
    it("N-3.9 does not retire on partially unmeasured evidence, and still records the measured mutation", async () => {
      seedSelects();
      evolverOut.value = mutations(2);
      btQueue.q = [refusedResult(), completedResult(1.02)]; // one unknown, one real loser
      await evolveStrategy("strat-1");
      assertQueueDrained();

      // The measured mutation is real evidence and is kept.
      expect(rowsFor(mutationOutcomes)).toHaveLength(1);
      // But the search was NOT exhausted — one mutation was never evaluated at all,
      // so "no mutation beat the parent" is not a claim this run is entitled to make.
      expect(retirements()).toHaveLength(0);
    });
  });
});
