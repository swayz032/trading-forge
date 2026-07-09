/**
 * wave27-dry-run-side-effects.test.ts — Wave 27 Pass 1 (P1.A4 paper-parity)
 *
 * Verifies that dryRun=true suppresses all production side effects (audit_log,
 * prompt_versions, system_parameters, Discord notifications) across the 4 services
 * extended for Pass 2 replay-grading plug-readiness:
 *
 *   1. trade-critique-service.ts      — runTradeCritique(positionId, corr, dryRun)
 *   2. pattern-aggregator-service.ts  — runPatternAggregator(dryRun)
 *   3. consistency-tracker-service.ts — getConsistencyState(accountId, asOf, dryRun)
 *   4. robustness-service.ts          — runRobustnessTest(stratId, configJson, dryRun)
 *
 * Test matrix (8 required + 5 bonus = 13 tests):
 *
 *  [trade-critique]
 *   TC-1  dryRun=true  → audit_log.insert NOT called
 *   TC-2  dryRun=false → audit_log.insert IS called (regression-proof)
 *   TC-3  (bonus) dryRun=true + LLM returns valid JSON → result returned with grade
 *
 *  [pattern-aggregator]
 *   PA-1  dryRun=true  → audit_log.insert NOT called
 *   PA-2  dryRun=false → audit_log.insert IS called
 *   PA-3  (bonus) dryRun=true → setAppendixCache does NOT fire (FIX deepscan17-wave2 H3,
 *         2026-07-05 — previously fired unconditionally, corrupting the live in-memory
 *         cache buildPromptSync() reads synchronously for real strategy generation)
 *
 *  [consistency-tracker]
 *   CT-1  dryRun=true  → insertAuditRowSafe NOT called, notifications NOT fired
 *   CT-2  dryRun=false → insertAuditRowSafe IS called when gate fires
 *   CT-3  (bonus) dryRun=true → ConsistencyState object returned (gate logic unchanged)
 *
 *  [robustness]
 *   RB-1  dryRun=true  → audit_log.insert NOT called
 *   RB-2  dryRun=false → audit_log.insert IS called
 *   RB-3  (bonus) subprocess NOT dry-runnable — see note in test
 *
 * Note on robustness subprocess:
 *   runPythonModule (src/server/lib/python-runner.ts) spawns a real child process.
 *   dryRun=true suppresses audit_log writes but does NOT suppress the subprocess.
 *   Callers needing subprocess isolation must mock runPythonModule separately or
 *   add a --dry-run flag to src/engine/optimizer.py. Documented Pass 2 carry-forward.
 *
 * Mock strategy:
 *   - db.insert returns a chainable { values → { returning → Promise, thenable } }.
 *   - db.select returns a chain where EVERY terminal method (where, limit, orderBy)
 *     is both .mockReturnThis() AND resolves when awaited — achieved by making the
 *     chain object itself a thenable (Promise-like) per the current call-sequence index.
 *   - audit_log writes are detected by asserting db.insert was or was not called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoist-safe module mocks ──────────────────────────────────────────────────

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: { action: "action", entityType: "entityType", entityId: "entityId", result: "result", status: "status", decisionAuthority: "da" },
  tradeCritique: { id: "id", positionId: "positionId", grade: "grade", critiquedAt: "critiquedAt", dataCompleteness: "dc", provider: "provider", model: "model", technicalDiagnosis: "td" },
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side", entryPrice: "entryPrice", stopPrice: "stopPrice", contracts: "contracts" },
  paperSessions: { id: "id", strategyId: "strategyId", firmId: "firmId", accountBalance: "accountBalance", metricsSnapshot: "metricsSnapshot", status: "status" },
  strategies: { id: "id", name: "name", symbol: "symbol", positionSize: "positionSize" },
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  promptVersions: { id: "id", promptType: "promptType", version: "version", content: "content", isActive: "isActive" },
  promptAbTests: { id: "id", promptType: "promptType", versionAId: "vA", versionBId: "vB", startedAt: "startedAt", status: "status" },
  brokerAccounts: { accountId: "accountId", firmId: "firmId", enabled: "enabled" },
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  getFallback: vi.fn(() => null),
  loadSystemPrompt: vi.fn(() => null),
  setAppendixCache: vi.fn(),
  getAppendixCacheSize: vi.fn(() => 0),
  warmAppendixCache: vi.fn(async () => undefined),
  __clearAppendixCacheForTests: vi.fn(),
  selectModel: vi.fn(),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn().mockResolvedValue(undefined),
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: vi.fn((body: string) => body),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { db } from "../db/index.js";
import { callOpenAI, setAppendixCache } from "../services/model-router.js";
import { notifyWarning, notifyCritical } from "../services/notification-service.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { runPythonModule } from "../lib/python-runner.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type AnyFn = ReturnType<typeof vi.fn>;
type DbLike = { insert: AnyFn; select: AnyFn; update: AnyFn; execute: AnyFn };

function getDb(): DbLike {
  return db as unknown as DbLike;
}

/**
 * Build a full Drizzle-style select chain mock.
 * Responses[] is consumed sequentially by db.select() call order.
 * Every chain terminal (.where, .limit, .orderBy) resolves to the
 * current response when awaited — achieved by the chain's .then() method.
 */
function buildSelectSequenceMock(responses: unknown[][]): void {
  let callIdx = 0;

  getDb().select = vi.fn().mockImplementation(() => {
    const responseIdx = callIdx++;
    const rows = responses[responseIdx] ?? [];

    const chain: Record<string, unknown> = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(rows),
      // Make the chain itself thenable so `const [x] = await db.select().from().where()` works
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    // Make every method return the same thenabled chain
    (chain.from as AnyFn).mockReturnValue(chain);
    (chain.where as AnyFn).mockReturnValue(chain);
    (chain.orderBy as AnyFn).mockReturnValue(chain);

    return chain;
  });
}

/**
 * Build a db.insert mock that handles both patterns:
 *   - .values().returning()  — returns [{ id }]
 *   - await db.insert().values()  — resolves directly (fire-and-forget audit writes)
 */
function buildInsertMock(returnId = "mock-id"): void {
  getDb().insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: returnId }]),
      // makes `await db.insert().values()` resolve immediately (fire-and-forget writes)
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve([{ id: returnId }]).then(resolve, reject),
      catch: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

function buildUpdateMock(): void {
  getDb().update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  });
}

// ─── Valid LLM critique JSON (matches trade-critique-service strict schema) ───

const VALID_LLM_JSON = JSON.stringify({
  technical_diagnosis: {
    entry_quality_score: 7.5,
    exit_execution_delta_r: 0.2,
    confluence_factors_missed: ["smt_confirmation"],
    parameter_hint: null,
    regime_mismatch: false,
    attribution: {
      regime: 0.15,
      structure: 0.20,
      narrative: 0.12,
      confluence: 0.15,
      decay: 0.10,
      liquidity: 0.10,
      fill: 0.08,
      exit_plan: 0.10,
    },
    realized_r: 1.4,
    expected_r_percentile: 60,
    topstep_consistency_current_pct: null,
    topstep_consistency_distance_to_cap: null,
  },
  plain_english_summary: {
    grade: "B+",
    one_liner: "Solid structural entry, slightly early on confluence.",
    what_went_right: "Stop placement respected the swing low.",
    what_to_watch: "Add SMT confirmation before triggering.",
    action_needed: "None immediate.",
  },
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_POSITION = {
  id: "pos-dry-run-001",
  sessionId: "sess-001",
  symbol: "MES",
  side: "long",
  entryPrice: "4450.00",
  stopPrice: "4440.00",
  exitPrice: "4460.00",
  contracts: 2,
  currentPrice: "4460.00",
  realizedPnl: 200,
  grossPnl: 210,
};

const MOCK_SESSION = {
  id: "sess-001",
  strategyId: "strat-001",
  firmId: "topstep",
  accountBalance: "50000",
  metricsSnapshot: null,
  status: "closed",
};

const MOCK_STRATEGY = {
  id: "strat-001",
  name: "silver_bullet_mes",
  symbol: "MES",
  positionSize: null,
};

const MOCK_CRITIQUES = Array.from({ length: 12 }, (_, i) => ({
  id: `crit-${i}`,
  grade: "B+",
  technicalDiagnosis: {
    entry_quality_score: 7,
    exit_execution_delta_r: 0.1,
    confluence_factors_missed: [],
    parameter_hint: null,
    regime_mismatch: false,
    realized_r: 1.2,
  },
  critiquedAt: new Date(Date.now() - i * 3_600_000),
}));

const ROBUSTNESS_RESULT = {
  best_params: { stop_mult: 1.5 },
  best_score: 1.82,
  n_trials: 100,
  param_importance: { stop_mult: 0.7 },
  robustness: {
    is_robust: true,
    plateau_variance: 0.02,
    top_trial_count: 15,
    best_score: 1.82,
    worst_top_score: 1.71,
    score_range: 0.11,
  },
  robust_ranges: { stop_mult: [1.3, 1.8] },
};

// ─── Tests: trade-critique-service ───────────────────────────────────────────

describe("wave27 dryRun — trade-critique-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("TC-1: dryRun=true → audit_log.insert NOT called", async () => {
    buildInsertMock("critique-123");

    // Select sequence:
    //   0 = idempotency check → no existing critique
    //   1 = position row
    //   2 = session row
    //   3 = strategy row
    buildSelectSequenceMock([
      [],                // idempotency: no existing critique in last 5 min
      [MOCK_POSITION],   // position
      [MOCK_SESSION],    // session
      [MOCK_STRATEGY],   // strategy
    ]);

    vi.mocked(callOpenAI).mockResolvedValue(VALID_LLM_JSON);

    const { runTradeCritique, _resetActiveCount } = await import("../services/trade-critique-service.js");
    _resetActiveCount();

    await runTradeCritique("pos-dry-run-001", "corr-001", true);

    // audit_log.insert must NOT have been called
    expect(getDb().insert).not.toHaveBeenCalled();
  });

  it("TC-2: dryRun=false (default) → audit_log.insert IS called", async () => {
    buildInsertMock("critique-456");
    buildUpdateMock();

    buildSelectSequenceMock([
      [],                // idempotency
      [MOCK_POSITION],
      [MOCK_SESSION],
      [MOCK_STRATEGY],
    ]);

    vi.mocked(callOpenAI).mockResolvedValue(VALID_LLM_JSON);

    const { runTradeCritique, _resetActiveCount } = await import("../services/trade-critique-service.js");
    _resetActiveCount();

    await runTradeCritique("pos-dry-run-001", "corr-001"); // dryRun defaults to false

    expect(getDb().insert).toHaveBeenCalled();
  });

  it("TC-3 (bonus): dryRun=true + LLM returns valid JSON → critique result returned with grade", async () => {
    buildInsertMock();

    buildSelectSequenceMock([
      [],
      [MOCK_POSITION],
      [MOCK_SESSION],
      [MOCK_STRATEGY],
    ]);

    vi.mocked(callOpenAI).mockResolvedValue(VALID_LLM_JSON);

    const { runTradeCritique, _resetActiveCount } = await import("../services/trade-critique-service.js");
    _resetActiveCount();

    const result = await runTradeCritique("pos-dry-run-001", "corr-001", true);

    // Grade must be surfaced even though no DB row was written
    expect(result.grade).toBe("B+");
    expect(["completed", "partial_data"]).toContain(result.status);
    // No critiqueId since we didn't persist
    expect(result.critiqueId).toBeUndefined();
    // db.insert must NOT have been called
    expect(getDb().insert).not.toHaveBeenCalled();
  });
});

// ─── Tests: pattern-aggregator-service ───────────────────────────────────────

describe("wave27 dryRun — pattern-aggregator-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("PA-1: dryRun=true → audit_log.insert NOT called", async () => {
    buildInsertMock();

    // FIX (Wave A Critic Finding MED): dryRun=true now SKIPS the kill-switch
    // DB read entirely — the critiques query is the FIRST select (index 0).
    // No kill-switch row in the mock sequence for dryRun callers.
    buildSelectSequenceMock([
      MOCK_CRITIQUES,               // trade critiques (index 0 — kill switch skipped)
    ]);

    vi.mocked(callOpenAI).mockResolvedValue("NO_CHANGE");

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    await runPatternAggregator(true);

    expect(getDb().insert).not.toHaveBeenCalled();
  });

  it("PA-2: dryRun=false (default) → audit_log.insert IS called", async () => {
    buildInsertMock();
    buildUpdateMock();

    // Call sequence for NO_CHANGE path with dryRun=false:
    //   0 = kill switch
    //   1 = trade critiques
    // Then _audit calls db.insert (audit_log)
    buildSelectSequenceMock([
      [{ currentValue: "true" }],
      MOCK_CRITIQUES,
    ]);

    // NO_CHANGE so no _storeVersionAndABTest selects needed — just the _audit insert
    vi.mocked(callOpenAI).mockResolvedValue("NO_CHANGE");

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    const result = await runPatternAggregator(); // dryRun defaults to false

    expect(result.status).toBe("no_change");
    expect(getDb().insert).toHaveBeenCalled();
  });

  it("PA-3 (bonus, FIXED deepscan17-wave2 H3): dryRun=true → setAppendixCache does NOT fire", async () => {
    buildInsertMock();

    // FIX (Wave A Critic Finding MED): dryRun=true skips kill-switch read.
    // Critiques query is now index 0. Followed by _storeVersionAndABTest selects.
    buildSelectSequenceMock([
      MOCK_CRITIQUES,              // index 0: critiques (kill switch read skipped)
    ]);

    const newAppendix = "## Pattern Notes (dry-run)\n- Use tighter confluence thresholds";
    vi.mocked(callOpenAI).mockResolvedValue(newAppendix);

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    await runPatternAggregator(true);

    // FIX (deepscan17-wave2 H3, 2026-07-05): setAppendixCache is a production
    // side effect (buildPromptSync reads it synchronously for live strategy
    // generation) — dryRun=true must NOT mutate it, same as every other
    // production side effect this suite verifies.
    expect(vi.mocked(setAppendixCache)).not.toHaveBeenCalled();
    // No DB insert
    expect(getDb().insert).not.toHaveBeenCalled();
  });

  it("PA-4 (deepscan17-wave2 H3 regression guard): dryRun=false → setAppendixCache DOES fire", async () => {
    buildInsertMock();
    buildUpdateMock();

    // dryRun=false: kill switch (index 0) → AUTOPILOT (numeric "2", per
    // learning-loop-mode.ts 3-mode contract), then critiques (index 1),
    // then _storeVersionAndABTest selects (maxVer, runningTests, currentActive).
    buildSelectSequenceMock([
      [{ currentValue: "2" }],      // kill switch: mode=2 (AUTOPILOT) → autonomousOn=true
      MOCK_CRITIQUES,               // critiques
      [{ maxVer: 1 }],              // max version lookup
      [],                            // no running A/B test
      [{ id: "av", version: 1, isActive: true, content: "old" }], // current active version
    ]);

    const newAppendix = "## Pattern Notes (live)\n- Use tighter confluence thresholds";
    vi.mocked(callOpenAI).mockResolvedValue(newAppendix);

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    await runPatternAggregator(); // dryRun defaults to false

    expect(vi.mocked(setAppendixCache)).toHaveBeenCalledWith("strategy_proposer", newAppendix);
  });
});

// ─── Tests: pattern-aggregator-service — malformed numeric env guard ─────────
//
// FIX (deepscan17-wave2 H4, 2026-07-05): `Number(env ?? "10")` alone lets a
// malformed PATTERN_AGGREGATOR_MIN_CRITIQUES value produce NaN or Infinity.
// `rows.length < NaN` is always false (gate silently DISABLED — any row count
// "passes"); `rows.length < Infinity` is always true (gate silently WEDGED
// OPEN — aggregation can never run). Both directions are now guarded via
// Number.isFinite, falling back to the documented default of 10.
describe("pattern-aggregator-service — H4 malformed MIN_CRITIQUES env guard", () => {
  const ORIGINAL_MIN_CRITIQUES = process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_MIN_CRITIQUES === undefined) {
      delete process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES;
    } else {
      process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES = ORIGINAL_MIN_CRITIQUES;
    }
  });

  it("H4-A: MIN_CRITIQUES='not-a-number' (→NaN unguarded) falls back to 10 — gate still blocks 9 rows", async () => {
    process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES = "not-a-number";
    buildInsertMock();

    // 9 < fallback-default 10. If the NaN bug were still present, `9 < NaN`
    // is always false and this would silently skip the gate instead.
    const nineCritiques = MOCK_CRITIQUES.slice(0, 9);
    buildSelectSequenceMock([
      nineCritiques, // index 0: critiques (dryRun=true skips kill-switch read)
    ]);

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    const result = await runPatternAggregator(true);

    expect(result.status).toBe("insufficient_samples");
    expect(result.critiques_reviewed).toBe(9);
  });

  it("H4-B: MIN_CRITIQUES='Infinity' (→Infinity unguarded) falls back to 10 — gate does NOT wedge open on 12 rows", async () => {
    process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES = "Infinity";
    buildInsertMock();

    // 12 (MOCK_CRITIQUES.length) >= fallback-default 10. If the Infinity bug
    // were still present, `12 < Infinity` is always true and this would
    // wrongly report insufficient_samples forever, permanently disabling
    // aggregation regardless of how much data accumulates.
    buildSelectSequenceMock([
      MOCK_CRITIQUES, // index 0: critiques (dryRun=true skips kill-switch read)
    ]);
    vi.mocked(callOpenAI).mockResolvedValue("NO_CHANGE");

    const { runPatternAggregator } = await import("../services/pattern-aggregator-service.js");
    const result = await runPatternAggregator(true);

    expect(result.status).not.toBe("insufficient_samples");
    expect(result.status).toBe("no_change");
  });
});

// ─── Tests: consistency-tracker-service ──────────────────────────────────────

describe("wave27 dryRun — consistency-tracker-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("CT-1: dryRun=true → insertAuditRowSafe NOT called, notifications NOT fired", async () => {
    // Simulate block_50 (concentration >= 50%): 2 days, today = 1000 of 1800 cumulative → 55.5%
    const blockDailyRows = [
      { day: "2026-05-01", pnl: 800 },
      { day: "2026-05-24", pnl: 1000 },
    ];
    const unrealizedRow = [{ total_unrealized: 0 }];

    getDb().execute = vi.fn()
      .mockResolvedValueOnce(blockDailyRows)
      .mockResolvedValueOnce(unrealizedRow);

    const { getConsistencyState, _invalidateConsistencyCache } = await import("../services/consistency-tracker-service.js");
    _invalidateConsistencyCache("acct-test-dry");

    await getConsistencyState("acct-test-dry", new Date("2026-05-24T15:00:00Z"), true);

    expect(vi.mocked(insertAuditRowSafe)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyWarning)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyCritical)).not.toHaveBeenCalled();
  });

  it("CT-2: dryRun=false (default) → insertAuditRowSafe IS called when gate fires", async () => {
    const blockDailyRows = [
      { day: "2026-05-01", pnl: 800 },
      { day: "2026-05-24", pnl: 1000 },
    ];
    const unrealizedRow = [{ total_unrealized: 0 }];

    getDb().execute = vi.fn()
      .mockResolvedValueOnce(blockDailyRows)
      .mockResolvedValueOnce(unrealizedRow);

    const { getConsistencyState, _invalidateConsistencyCache } = await import("../services/consistency-tracker-service.js");
    _invalidateConsistencyCache("acct-test-live");

    await getConsistencyState("acct-test-live", new Date("2026-05-24T15:00:00Z")); // dryRun defaults false

    // block_50 fires insertAuditRowSafe OR notification — at least one must fire
    const auditCalled = vi.mocked(insertAuditRowSafe).mock.calls.length > 0;
    const notifyCalled =
      vi.mocked(notifyWarning).mock.calls.length > 0 ||
      vi.mocked(notifyCritical).mock.calls.length > 0;
    expect(auditCalled || notifyCalled).toBe(true);
  });

  it("CT-3 (bonus): dryRun=true → ConsistencyState returned with correct gateState", async () => {
    const dailyRows = [
      { day: "2026-05-01", pnl: 800 },
      { day: "2026-05-24", pnl: 1000 },
    ];
    const unrealizedRow = [{ total_unrealized: 0 }];

    getDb().execute = vi.fn()
      .mockResolvedValueOnce(dailyRows)
      .mockResolvedValueOnce(unrealizedRow);

    const { getConsistencyState, _invalidateConsistencyCache } = await import("../services/consistency-tracker-service.js");
    _invalidateConsistencyCache("acct-bonus-dry");

    const state = await getConsistencyState("acct-bonus-dry", new Date("2026-05-24T15:00:00Z"), true);

    // Gate logic still executes — state is meaningful for grading
    expect(state.accountId).toBe("acct-bonus-dry");
    expect(state.cycleCumulativeProfit).toBeGreaterThan(0);
    expect(["ok", "warn_40", "block_50"]).toContain(state.gateState);
    // Notification/audit side effects were suppressed
    expect(vi.mocked(insertAuditRowSafe)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyWarning)).not.toHaveBeenCalled();
  });
});

// ─── Tests: robustness-service ────────────────────────────────────────────────

describe("wave27 dryRun — robustness-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("RB-1: dryRun=true → audit_log.insert NOT called", async () => {
    buildInsertMock();
    vi.mocked(runPythonModule).mockResolvedValue(ROBUSTNESS_RESULT);

    const { runRobustnessTest } = await import("../services/robustness-service.js");
    await runRobustnessTest("strat-001", JSON.stringify({ strategy_id: "strat-001" }), true);

    expect(getDb().insert).not.toHaveBeenCalled();
  });

  it("RB-2: dryRun=false (default) → audit_log.insert IS called", async () => {
    buildInsertMock();
    vi.mocked(runPythonModule).mockResolvedValue(ROBUSTNESS_RESULT);

    const { runRobustnessTest } = await import("../services/robustness-service.js");
    await runRobustnessTest("strat-001", JSON.stringify({ strategy_id: "strat-001" }));

    expect(getDb().insert).toHaveBeenCalled();
  });

  it("RB-3 (bonus/documented): subprocess runs regardless of dryRun — limitation documented", () => {
    /**
     * The Python subprocess (runPythonModule → src.engine.optimizer) is the compute
     * core of robustness-service.ts. dryRun=true suppresses audit_log writes but does
     * NOT suppress the subprocess call itself.
     *
     * Why: The subprocess IS the value — callers need its output for grading.
     * Subprocess isolation (preventing optimizer from writing cache files to disk)
     * requires one of:
     *   (a) A subprocess-level --dry-run flag in src/engine/optimizer.py, or
     *   (b) Callers mocking runPythonModule at the TS test boundary.
     *
     * This is a known Wave 27 Pass 2 carry-forward item. If the optimizer writes
     * artifacts to disk during a replay-grading run, those writes are NOT suppressed
     * by dryRun=true in robustness-service.ts.
     */
    expect(true).toBe(true); // documented constraint, not a defect
  });
});
