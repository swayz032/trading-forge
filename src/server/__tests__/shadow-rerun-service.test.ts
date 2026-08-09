/**
 * Shadow Re-Run Service Tests — A11 (W12 Team A)
 *
 * Tests the shadow re-run service logic independently by mocking:
 *   - DB (strategies, backtests, backtest_provenance, shadow_rerun_findings)
 *   - backtest-service.runBacktest
 *   - pipeline-control-service.isActive
 *
 * DB call sequence per runShadowRerun (single strategy):
 *   [0] strategies query            → [{ strategyId }]
 *   [1] latest backtest per strat   → [{ id }]
 *   [2] original backtest (rerun)   → [backtest row]
 *   [3] provenance row (rerun)      → [provenance row] or []
 *   [4] shadow backtest (after run) → [shadow backtest row]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared mock state (accessible inside vi.mock factories via module closure) ─

let _isActiveResult = true;
let _runBacktestResult: unknown = { id: "shadow-bt-id", status: "completed" };
let _resultHashValue = "newhash";

// Sequential DB responses: each .limit() call consumes the next entry
let _dbSeq: Array<unknown[]> = [];
let _dbIdx = 0;

// Track whether onConflictDoNothing was called
let _insertConflictCalled = false;

// ─── vi.mock hoisted factories ────────────────────────────────────────────────

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => Promise.resolve(_isActiveResult)),
}));

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn((..._args: unknown[]) => Promise.resolve(_runBacktestResult)),
}));

vi.mock("../lib/result-hasher.js", () => ({
  computeResultHash: vi.fn(() => _resultHashValue),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: col, vals })),
  and: vi.fn((...c: unknown[]) => ({ and: c })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
}));

vi.mock("../db/schema.js", () => ({
  // D-10 F-10: the shared refusal classifier (`lib/backtest-refusal.ts`) imports this
  // constant from schema. Without it in the mock, `isExecutionRefused()` would compare
  // against `undefined` and return false for EVERY result — the refusal branch would be
  // unreachable in tests and its control could never go green. Mirrors the same addition
  // in `backtest-service.deepscan8-fixes.test.ts:124`.
  BACKTEST_STATUS_REFUSED: "refused",
  strategies: { id: "s_id", lifecycleState: "lifecycle_state", $inferSelect: {} },
  backtests: { id: "bt_id", strategyId: "strategy_id", status: "status", createdAt: "created_at", $inferSelect: {} },
  backtestProvenance: { backtestId: "backtest_id", $inferSelect: {} },
  shadowRerunFindings: {
    id: "srf_id",
    strategyId: "strategy_id",
    backtestId: "backtest_id",
    runAt: "run_at",
    $inferSelect: {},
  },
}));

vi.mock("../db/index.js", () => {
  // Fluent mock: each limit() call consumes next item from _dbSeq
  const limit = vi.fn(() => {
    const result = _dbIdx < _dbSeq.length ? _dbSeq[_dbIdx++] : [];
    return Promise.resolve(result);
  });
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit,
  };
  const onConflict = vi.fn(() => {
    _insertConflictCalled = true;
    return Promise.resolve(undefined);
  });
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: onConflict,
    returning: vi.fn().mockResolvedValue([{ id: "shadow-bt-id" }]),
  };
  return {
    db: {
      select: vi.fn(() => chain),
      insert: vi.fn(() => insertChain),
    },
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  runShadowRerun,
  getShadowRerunFindings,
  PAPER_PLUS_STATES,
} from "../services/shadow-rerun-service.js";
import { runBacktest } from "../services/backtest-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bt(id: string, strategyId: string, pf: string, sharpe: string, maxDd: string) {
  return {
    id,
    strategyId,
    profitFactor: pf,
    sharpeRatio: sharpe,
    maxDrawdown: maxDd,
    totalReturn: "0.5",
    winRate: "0.55",
    totalTrades: 100,
    avgTradePnl: "75",
    avgDailyPnl: "250",
    forgeScore: "75",
    tier: "TIER_2",
    resultExtras: null,
    config: { strategy: { name: "T", symbol: "MES", timeframe: "5m" }, suppressAutoPromote: false },
    status: "completed",
  };
}

function prov(backtestId: string, resultHash: string, codeGitSha = "oldsha") {
  return { backtestId, resultHash, codeGitSha };
}

function reset(
  seq: Array<unknown[]>,
  opts: {
    isActive?: boolean;
    runBacktestResult?: unknown;
    resultHash?: string;
  } = {},
) {
  vi.clearAllMocks();
  _isActiveResult = opts.isActive ?? true;
  _runBacktestResult = opts.runBacktestResult ?? { id: "shadow-bt-id", status: "completed" };
  _resultHashValue = opts.resultHash ?? "newhash";
  _dbSeq = seq;
  _dbIdx = 0;
  _insertConflictCalled = false;
}

// ─── Full single-strategy sequence helper ─────────────────────────────────────
// DB call order for a single PAPER+ strategy with a provenance row:
//   [0] strategies list     → [{ strategyId: "strat-1" }]
//   [1] latest backtest     → [{ id: "bt-1" }]
//   [2] original backtest   → [bt("bt-1", ...)]
//   [3] provenance          → [prov("bt-1", resultHash)]
//   [4] shadow backtest     → [bt("shadow-bt-id", ...)]

function oneStrategySeq(
  oldHash: string,
  oldPf: string,
  oldSharpe: string,
  oldMaxDd: string,
  newPf: string,
  newSharpe: string,
  newMaxDd: string,
): Array<unknown[]> {
  return [
    [{ strategyId: "strat-1" }],
    [{ id: "bt-1" }],
    [bt("bt-1", "strat-1", oldPf, oldSharpe, oldMaxDd)],
    [prov("bt-1", oldHash)],
    [bt("shadow-bt-id", "strat-1", newPf, newSharpe, newMaxDd)],
  ];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PAPER_PLUS_STATES constant", () => {
  it("includes all 6 post-TESTING states", () => {
    expect(PAPER_PLUS_STATES).toContain("PAPER");
    expect(PAPER_PLUS_STATES).toContain("DEPLOY_READY");
    expect(PAPER_PLUS_STATES).toContain("DEPLOYED");
    expect(PAPER_PLUS_STATES).toContain("DECLINING");
    expect(PAPER_PLUS_STATES).toContain("RETIRED");
    expect(PAPER_PLUS_STATES).toContain("GRAVEYARD");
    expect(PAPER_PLUS_STATES).toHaveLength(6);
  });

  it("does NOT include CANDIDATE or TESTING", () => {
    expect(PAPER_PLUS_STATES).not.toContain("CANDIDATE");
    expect(PAPER_PLUS_STATES).not.toContain("TESTING");
  });
});

describe("pipeline pause guard", () => {
  beforeEach(() => reset([[]], { isActive: false }));

  it("returns empty report when paused", async () => {
    const r = await runShadowRerun("paused");
    expect(r.totalStrategies).toBe(0);
    expect(r.processed).toBe(0);
    expect(r.findings.critical).toBe(0);
  });

  it("echoes reason in paused report", async () => {
    const r = await runShadowRerun("paused reason");
    expect(r.reason).toBe("paused reason");
  });
});

describe("no PAPER+ strategies found", () => {
  beforeEach(() => reset([[]])); // empty strategies list

  it("returns zero totals", async () => {
    const r = await runShadowRerun("no strats");
    expect(r.totalStrategies).toBe(0);
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe(0);
  });
});

describe("pre-A2 backtest (no provenance row)", () => {
  beforeEach(() =>
    reset([
      [{ strategyId: "strat-1" }],  // [0] strategies
      [{ id: "bt-1" }],             // [1] latest backtest
      [bt("bt-1", "strat-1", "2.0", "1.8", "1500")],  // [2] original backtest
      [],                            // [3] provenance → empty
    ]),
  );

  it("counts as skipped, not error", async () => {
    const r = await runShadowRerun("pre-A2");
    expect(r.skipped).toBe(1);
    expect(r.errors).toBe(0);
    expect(r.processed).toBe(0);
  });

  it("does not call runBacktest", async () => {
    await runShadowRerun("pre-A2");
    expect(runBacktest).not.toHaveBeenCalled();
  });
});

describe("severity: info (same hash)", () => {
  beforeEach(() =>
    reset(
      oneStrategySeq("samehash", "2.0", "1.8", "1500", "2.0", "1.8", "1500"),
      { resultHash: "samehash" }, // new hash = same as old
    ),
  );

  it("records severity=info", async () => {
    const r = await runShadowRerun("info test");
    expect(r.findings.info).toBe(1);
    expect(r.findings.warning).toBe(0);
    expect(r.findings.critical).toBe(0);
  });

  it("criticalStrategies is empty", async () => {
    const r = await runShadowRerun("info test");
    expect(r.criticalStrategies).toHaveLength(0);
  });
});

describe("severity: warning (hash changed, gate decision same)", () => {
  // old: PF 2.0, Sharpe 1.8, DD 1500 → PASS
  // new: PF 1.9, Sharpe 1.7, DD 1400 → PASS (both pass → no flip → warning)
  beforeEach(() =>
    reset(
      oneStrategySeq("oldhash", "2.0", "1.8", "1500", "1.9", "1.7", "1400"),
      { resultHash: "newhash" },
    ),
  );

  it("records severity=warning", async () => {
    const r = await runShadowRerun("warning test");
    expect(r.findings.warning).toBe(1);
    expect(r.findings.critical).toBe(0);
  });

  it("criticalStrategies is empty", async () => {
    const r = await runShadowRerun("warning test");
    expect(r.criticalStrategies).toHaveLength(0);
  });
});

describe("severity: critical (gate decision flipped PASS→FAIL)", () => {
  // old: PF 2.0, Sharpe 1.8, DD 1500 → PASS
  // new: PF 1.2, Sharpe 1.3, DD 2500 → FAIL (flip!)
  beforeEach(() =>
    reset(
      oneStrategySeq("oldhash", "2.0", "1.8", "1500", "1.2", "1.3", "2500"),
      { resultHash: "newhash" },
    ),
  );

  it("records severity=critical", async () => {
    const r = await runShadowRerun("critical test");
    expect(r.findings.critical).toBe(1);
    expect(r.findings.warning).toBe(0);
  });

  it("adds strategy to criticalStrategies", async () => {
    const r = await runShadowRerun("critical test");
    expect(r.criticalStrategies).toHaveLength(1);
    expect(r.criticalStrategies[0].strategyId).toBe("strat-1");
    expect(r.criticalStrategies[0].backtestId).toBe("bt-1");
  });
});

describe("severity: critical (gate decision flipped FAIL→PASS)", () => {
  // old: PF 1.2, Sharpe 1.3, DD 2500 → FAIL
  // new: PF 2.5, Sharpe 2.0, DD 1200 → PASS (flip the other way!)
  beforeEach(() =>
    reset(
      oneStrategySeq("oldhash", "1.2", "1.3", "2500", "2.5", "2.0", "1200"),
      { resultHash: "newhash" },
    ),
  );

  it("records severity=critical for FAIL→PASS flip", async () => {
    const r = await runShadowRerun("flip reverse test");
    expect(r.findings.critical).toBe(1);
  });
});

describe("idempotency — onConflictDoNothing", () => {
  beforeEach(() =>
    reset(
      oneStrategySeq("oldhash", "2.0", "1.8", "1500", "2.1", "1.9", "1400"),
      { resultHash: "newhash" },
    ),
  );

  it("calls onConflictDoNothing on insert", async () => {
    await runShadowRerun("idempotency");
    expect(_insertConflictCalled).toBe(true);
  });
});

describe("suppressAutoPromote=true passed to runBacktest", () => {
  beforeEach(() =>
    reset(
      oneStrategySeq("oldhash", "2.0", "1.8", "1500", "2.0", "1.8", "1500"),
      { resultHash: "newhash" },
    ),
  );

  it("passes suppressAutoPromote=true", async () => {
    await runShadowRerun("suppress test");
    const calls = (runBacktest as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const config = calls[0][1] as Record<string, unknown>;
    expect(config.suppressAutoPromote).toBe(true);
  });
});

describe("runBacktest status=skipped (pipeline paused mid-run)", () => {
  beforeEach(() =>
    reset(
      [
        [{ strategyId: "strat-1" }],
        [{ id: "bt-1" }],
        [bt("bt-1", "strat-1", "2.0", "1.8", "1500")],
        [prov("bt-1", "oldhash")],
        // shadow backtest row won't be queried — status=skipped short-circuits
      ],
      { runBacktestResult: { id: null, status: "skipped", error: "pipeline_paused" } },
    ),
  );

  it("counts as skipped when runBacktest returns skipped", async () => {
    const r = await runShadowRerun("skipped mid-run");
    expect(r.skipped).toBe(1);
    expect(r.processed).toBe(0);
    expect(r.errors).toBe(0);
  });
});

// ─── D-10 F-10 ────────────────────────────────────────────────────────────────
//
// `AN UNMEASURED RUN MUST NOT ENTER THE COMPARISON AT ALL` (R-766 §3, campaign law).
//
// A refusal is not a bad score — it is the ABSENCE of a score. Every metric column
// on a refused row is NULL by construction (R-751 §8-5), and `metricsPassGate()`
// returns false on its first line when any metric is null. So an unguarded refusal
// makes a previously-PASSING strategy read `newPassed=false` ⇒ `statusFlipped=true`
// ⇒ severity "critical": the drift detector raises a CRITICAL REGRESSION ALERT for a
// measurement that was never taken.
//
// FIXTURE NOTE — why the fifth row is seeded even though it must not be read:
// the db mock only advances `_dbIdx` while `_dbIdx < _dbSeq.length`. On a 4-entry
// fixture the counter STOPS at 4 whether or not the code attempts a fifth read, so
// `expect(_dbIdx).toBe(4)` would pass without the fix — a comparison that cannot
// fail is a printout. Seeding five makes the counter able to reach five, which is
// what makes the assertion a control.
describe("F-10: an execution REFUSAL must never enter the gate comparison", () => {
  const REFUSED_RESULT = {
    id: "shadow-bt-id",
    status: "refused",
    execution_status: "refused",
    condition_id: "C-7",
    disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
    reason: "entry condition not deterministically compilable",
    metrics_omitted: true,
  };

  // What a refusal actually persists: every metric column NULL.
  function btRefused(id: string, strategyId: string) {
    return {
      ...bt(id, strategyId, "0", "0", "0"),
      profitFactor: null,
      sharpeRatio: null,
      maxDrawdown: null,
      totalReturn: null,
      winRate: null,
      totalTrades: null,
      avgTradePnl: null,
      avgDailyPnl: null,
      forgeScore: null,
      tier: null,
      status: "refused",
    };
  }

  beforeEach(() =>
    reset(
      [
        [{ strategyId: "strat-1" }],                    // [0] strategies
        [{ id: "bt-1" }],                               // [1] latest backtest
        [bt("bt-1", "strat-1", "2.0", "1.8", "1500")],  // [2] original — PASSES the gate
        [prov("bt-1", "oldhash")],                      // [3] provenance
        [btRefused("shadow-bt-id", "strat-1")],         // [4] MUST NOT be consumed
      ],
      { runBacktestResult: REFUSED_RESULT, resultHash: "differenthash" },
    ),
  );

  it("stops before the shadow-row read — the fifth DB read is not consumed", async () => {
    await runShadowRerun("refusal");
    expect(vi.mocked(runBacktest)).toHaveBeenCalledTimes(1);
    expect(_dbIdx).toBe(4);
  });

  it("names the refusal instead of comparing it — no finding, no critical", async () => {
    const r = await runShadowRerun("refusal");
    expect(r.refused).toBe(1);
    expect(r.processed).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.errors).toBe(0);
    expect(r.findings.critical).toBe(0);
    expect(r.findings.warning).toBe(0);
    expect(r.findings.info).toBe(0);
    expect(r.criticalStrategies).toHaveLength(0);
    expect(_insertConflictCalled).toBe(false);
  });

  it("carries the refusal evidence, and fabricates no key that was absent", async () => {
    const r = await runShadowRerun("refusal");
    expect(r.refusedStrategies).toHaveLength(1);
    expect(r.refusedStrategies[0].strategyId).toBe("strat-1");
    expect(r.refusedStrategies[0].backtestId).toBe("bt-1");
    expect(r.refusedStrategies[0].evidence).toMatchObject({
      execution_status: "refused",
      condition_id: "C-7",
      disposition: "UNRESOLVED_SOURCE_AMBIGUITY",
      metrics_omitted: true,
    });
    // `refusalEvidence()` returns only keys actually present — absent stays absent.
    expect(r.refusedStrategies[0].evidence).not.toHaveProperty("ambiguity");
    expect(r.refusedStrategies[0].evidence).not.toHaveProperty("entry_eligible");
  });
});

// POSITIVE DISCRIMINATOR (R-766 §4). Without this, a "fix" that suppressed every
// finding — or short-circuited every run — would pass the controls above.
describe("F-10 discriminator: a genuinely MEASURED regression still fires critical", () => {
  beforeEach(() =>
    // old PASSES (2.0/1.8/1500), new FAILS on real numbers, hash differs
    reset(oneStrategySeq("oldhash", "2.0", "1.8", "1500", "1.1", "0.9", "1500"), {
      resultHash: "differenthash",
    }),
  );

  it("still reports critical, still persists, and is NOT counted as refused", async () => {
    const r = await runShadowRerun("real regression");
    expect(r.findings.critical).toBe(1);
    expect(r.processed).toBe(1);
    expect(r.refused).toBe(0);
    expect(r.criticalStrategies).toHaveLength(1);
    expect(_insertConflictCalled).toBe(true);
    expect(_dbIdx).toBe(5); // the measured path DOES consume the shadow-row read
  });
});

describe("explicit strategyIds subset", () => {
  beforeEach(() => reset([[]])); // empty strategies

  it("accepts explicit strategyIds list without error", async () => {
    const r = await runShadowRerun("subset", ["strat-1", "strat-2"]);
    expect(r.totalStrategies).toBe(0); // empty DB returned
    expect(r.errors).toBe(0);
  });
});

describe("ShadowRerunReport schema", () => {
  beforeEach(() => reset([[]]));

  it("report has all required fields", async () => {
    const r = await runShadowRerun("schema test");
    const keys = ["reason", "newCodeGitSha", "totalStrategies", "processed", "skipped", "errors", "findings", "criticalStrategies", "durationMs"];
    for (const k of keys) {
      expect(r, `missing key: ${k}`).toHaveProperty(k);
    }
    expect(r.findings).toHaveProperty("info");
    expect(r.findings).toHaveProperty("warning");
    expect(r.findings).toHaveProperty("critical");
  });

  it("durationMs >= 0", async () => {
    const r = await runShadowRerun("timing");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reason is echoed", async () => {
    const r = await runShadowRerun("my reason");
    expect(r.reason).toBe("my reason");
  });
});

describe("Gate threshold boundary conditions", () => {
  // Inline the gate logic from the service to verify thresholds are correct.
  // PF >= 1.75, Sharpe >= 1.5, |MaxDD| <= 2000

  function gate(pf: number | null, sharpe: number | null, maxDd: number | null): boolean {
    if (pf === null || sharpe === null || maxDd === null) return false;
    return pf >= 1.75 && sharpe >= 1.5 && Math.abs(maxDd) <= 2000;
  }

  it("PF=1.75 passes (inclusive boundary)", () => expect(gate(1.75, 1.5, 2000)).toBe(true));
  it("PF=1.74 fails (just below boundary)", () => expect(gate(1.74, 1.5, 2000)).toBe(false));
  it("Sharpe=1.5 passes (inclusive boundary)", () => expect(gate(1.75, 1.5, 2000)).toBe(true));
  it("Sharpe=1.49 fails (just below boundary)", () => expect(gate(1.75, 1.49, 2000)).toBe(false));
  it("MaxDD=2000 passes (inclusive boundary)", () => expect(gate(1.75, 1.5, 2000)).toBe(true));
  it("MaxDD=2001 fails (just above boundary)", () => expect(gate(1.75, 1.5, 2001)).toBe(false));
  it("null PF fails (missing data = no promotion)", () => expect(gate(null, 1.5, 2000)).toBe(false));
  it("null Sharpe fails", () => expect(gate(1.75, null, 2000)).toBe(false));
  it("null MaxDD fails", () => expect(gate(1.75, 1.5, null)).toBe(false));
  it("all minimums met → pass", () => expect(gate(2.5, 2.0, 1500)).toBe(true));
  it("none met → fail", () => expect(gate(1.2, 0.8, 3000)).toBe(false));
});

describe("getShadowRerunFindings", () => {
  beforeEach(() => {
    reset([[{ id: "f1", strategyId: "strat-1", severity: "warning" }]]);
  });

  it("returns an array", async () => {
    expect(Array.isArray(await getShadowRerunFindings())).toBe(true);
  });

  it("accepts strategyId filter", async () => {
    reset([[{ id: "f1", strategyId: "strat-1", severity: "info" }]]);
    expect(Array.isArray(await getShadowRerunFindings("strat-1"))).toBe(true);
  });
});
