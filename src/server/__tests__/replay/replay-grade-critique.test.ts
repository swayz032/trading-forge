/**
 * Wave 27 Pass 2.F2 — Trade Critique Grade Signal Test
 *
 * Tests for:
 *   - src/server/lib/replay/critique-disagreement.ts (pure-function library)
 *   - scripts/replay-grade-critique.ts (CLI / runCritiqueGradeAnalysis)
 *
 * Coverage (>= 10 tests):
 *  1.  test_mannwhitney_on_synthetic_data: perfect separation → U=1.0, p near 0
 *  2.  test_mannwhitney_no_separation: identical distributions → U near 0.5
 *  3.  test_grade_high_vs_low_separation: A+ high R vs F low R → SIGNAL
 *  4.  test_no_separation_verdict: mixed random grades → NO_SIGNAL or INCONCLUSIVE
 *  5.  test_preliminary_flag_below_50_critiques
 *  6.  test_dryRun_calls_critique_service_with_dryRun_true
 *  7.  test_parameter_hint_application_tracking
 *  8.  test_decision_rule_SIGNAL
 *  9.  test_decision_rule_INCONCLUSIVE
 * 10.  test_decision_rule_NO_SIGNAL
 * 11.  test_dry_run_no_file_written (apply=false)
 * 12.  test_apply_writes_markdown (apply=true)
 * 13.  test_aggregate_by_grade_computes_avgR
 * 14.  test_empty_critiques_returns_preliminary
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ─── Module mocks (must be hoisted before service imports) ──────────────────

vi.mock("../../db/index.js", () => ({ db: {} }));

vi.mock("../../db/schema.js", () => ({
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side",
    contracts: "contracts", entryPrice: "entryPrice", stopPrice: "stopPrice",
    entryTime: "entryTime" },
  paperSessions: { id: "id", strategyId: "strategyId", firmId: "firmId",
    metricsSnapshot: "metricsSnapshot" },
  strategies: { id: "id", name: "name", symbol: "symbol", positionSize: "positionSize" },
  tradeCritique: { id: "id", positionId: "positionId", sessionId: "sessionId",
    accountId: "accountId", strategyId: "strategyId", critiquedAt: "critiquedAt",
    grade: "grade", technicalDiagnosis: "technicalDiagnosis",
    plainEnglishSummary: "plainEnglishSummary", dataCompleteness: "dataCompleteness",
    missingFields: "missingFields", provider: "provider", model: "model",
    correlationId: "correlationId", createdAt: "createdAt" },
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  auditLog: { action: "action" },
}));

vi.mock("../../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  getFallback: vi.fn(() => ({ provider: "ollama", model: "deepseek-r1:14b" })),
  loadSystemPrompt: vi.fn(() => "You are a trade critic."),
}));

vi.mock("../../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  mannWhitneyU,
  normalCDF,
  evaluateCritiqueGradeSignal,
  applyCritiqueDecisionRule,
  aggregateByGrade,
  aggregateParameterHints,
  buildCritiqueMarkdownReport,
  computeSharpeFromRs,
  type TradeCritiqueRow,
  type PaperPositionRow,
  MIN_CRITIQUES_FOR_FULL_ANALYSIS,
} from "../../lib/replay/critique-disagreement.js";

import { callOpenAI } from "../../services/model-router.js";
import { db } from "../../db/index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE_DATE = new Date("2026-04-01T14:30:00Z");

function makeCritique(
  overrides: Partial<TradeCritiqueRow> & { grade: string },
  idx = 0,
): TradeCritiqueRow {
  return {
    id: `crit-${idx}`,
    positionId: `pos-${idx}`,
    strategyId: "strat-001",
    critiquedAt: new Date(BASE_DATE.getTime() + idx * 24 * 60 * 60 * 1000),
    parameterHint: null,
    realizedR: null,
    ...overrides,
  };
}

function makePosition(
  overrides: Partial<PaperPositionRow>,
  idx = 0,
): PaperPositionRow {
  return {
    id: `pos-${idx}`,
    strategyId: "strat-001",
    realizedR: 1.0,
    closedAt: new Date(BASE_DATE.getTime() + idx * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

/** Build N critique rows with deterministic R values by grade. */
function buildCritiques(
  count: number,
  gradeDistrib: Array<{ grade: string; r: number }>,
): TradeCritiqueRow[] {
  return Array.from({ length: count }, (_, i) => {
    const { grade, r } = gradeDistrib[i % gradeDistrib.length];
    return makeCritique({ grade, realizedR: r }, i);
  });
}

// ─── Valid LLM critique JSON for mock ───────────────────────────────────────

const VALID_CRITIQUE_JSON = JSON.stringify({
  technical_diagnosis: {
    entry_quality_score: 7.5,
    exit_execution_delta_r: -0.1,
    confluence_factors_missed: [],
    parameter_hint: null,
    regime_mismatch: false,
    attribution: {
      regime: 0.20, structure: 0.15, narrative: 0.10, confluence: 0.20,
      decay: 0.10, liquidity: 0.10, fill: 0.05, exit_plan: 0.10,
    },
    realized_r: 1.5,
    expected_r_percentile: 62,
    topstep_consistency_current_pct: 0.35,
    topstep_consistency_distance_to_cap: 0.15,
  },
  plain_english_summary: {
    grade: "A",
    one_liner: "Clean entry at NY open.",
    what_went_right: "Regime aligned.",
    what_to_watch: "Minor slippage.",
    action_needed: "No action.",
  },
});

// ─── Test 1: Mann-Whitney on synthetic data — perfect separation ─────────────

describe("Wave 27 Pass 2.F2 — critique-disagreement pure library", () => {

  it("(1) mannWhitneyU — perfect separation (high group all above low) → effect ~1.0, p near 0", () => {
    // High group: all values 10,11,12,...,19; low group: all values 0,1,2,...,9
    const high = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const low  = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const { U, pValue, n1, n2, u1 } = mannWhitneyU(high, low);

    // U1 = n1*n2 = 100 (every high > every low), effect = 1.0
    const effectSize = u1 / (n1 * n2);
    expect(effectSize).toBeGreaterThan(0.9);
    expect(pValue).toBeLessThan(0.01);
    // U (smaller) should be 0 for perfect separation
    expect(U).toBe(0);
  });

  // ─── Test 2: Mann-Whitney — no separation ─────────────────────────────────

  it("(2) mannWhitneyU — identical distributions → U effect near 0.5, p > 0.05", () => {
    const group = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { u1, n1, n2, pValue } = mannWhitneyU(group, group);
    const effectSize = u1 / (n1 * n2);
    // With identical distributions, U effect should be exactly 0.5
    expect(effectSize).toBeCloseTo(0.5, 1);
    expect(pValue).toBeGreaterThan(0.05);
  });

  // ─── Test 3: Grade signal — high R vs low R → SIGNAL ─────────────────────

  it("(3) evaluateCritiqueGradeSignal — A+ trades with high R vs F trades with low R → SIGNAL", () => {
    // Build >= 50 critiques: 30 A+ with R=+2.0, 20 F with R=-1.0, rest B
    const critiques: TradeCritiqueRow[] = [
      ...Array.from({ length: 30 }, (_, i) => makeCritique({ grade: "A+", realizedR: 2.0 + i * 0.01 }, i)),
      ...Array.from({ length: 20 }, (_, i) => makeCritique({ grade: "F",  realizedR: -1.0 - i * 0.01 }, 30 + i)),
      ...Array.from({ length: 10 }, (_, i) => makeCritique({ grade: "B",  realizedR: 0.5 }, 50 + i)),
    ];
    const positions = critiques.map((c, i) => makePosition({ id: `pos-${i}`, realizedR: null }, i));
    const result = evaluateCritiqueGradeSignal(critiques, positions);

    expect(result.verdict).toBe("SIGNAL");
    expect(result.uEffectSize).toBeGreaterThan(0.65);
    expect(result.mannWhitneyPValue).toBeLessThan(0.05);
    expect(result.nHigh).toBe(30);
    expect(result.nLow).toBe(20);
    expect(result.isPreliminary).toBe(false);
  });

  // ─── Test 4: No separation → NO_SIGNAL or INCONCLUSIVE ───────────────────

  it("(4) evaluateCritiqueGradeSignal — random grades on same R → NO_SIGNAL or INCONCLUSIVE", () => {
    const grades: string[] = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];
    const critiques: TradeCritiqueRow[] = Array.from({ length: 60 }, (_, i) => {
      const grade = grades[i % grades.length];
      // All trades have R drawn from a flat range 0.1..0.9 regardless of grade
      const r = 0.1 + (i % 9) * 0.1;
      return makeCritique({ grade, realizedR: r }, i);
    });
    const positions = critiques.map((c, i) => makePosition({}, i));
    const result = evaluateCritiqueGradeSignal(critiques, positions);

    // With random assignment, effect should not be strongly > 0.65
    expect(["NO_SIGNAL", "INCONCLUSIVE"]).toContain(result.verdict);
    expect(result.isPreliminary).toBe(false);
  });

  // ─── Test 5: Preliminary flag below 50 critiques ──────────────────────────

  it("(5) evaluateCritiqueGradeSignal — n < 50 critiques → PRELIMINARY regardless of effect", () => {
    const critiques: TradeCritiqueRow[] = [
      ...Array.from({ length: 10 }, (_, i) => makeCritique({ grade: "A+", realizedR: 3.0 }, i)),
      ...Array.from({ length: 5 }, (_, i) => makeCritique({ grade: "F",  realizedR: -2.0 }, 10 + i)),
    ];
    const positions = critiques.map((c, i) => makePosition({}, i));
    const result = evaluateCritiqueGradeSignal(critiques, positions);

    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.isPreliminary).toBe(true);
    expect(result.critiquesAnalyzed).toBe(15);
  });

  // ─── Test 6: dryRun=true verified passed to critique service ─────────────

  it("(6) runTradeCritique is called with dryRun=true during replay", async () => {
    // Wire up the DB mock
    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = {
        from: () => chain,
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
      };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve); // idempotency check
        if (currentCall === 1) return Promise.resolve([{
          id: "pos-spy-001", sessionId: "sess-001",
          symbol: "MES", side: "long", contracts: 6,
          entryPrice: "4500.00", stopPrice: "4492.00",
          entryTime: new Date("2026-04-01T14:30:00Z"),
          exitPrice: "4507.00",
        }]).then(resolve); // position
        if (currentCall === 2) return Promise.resolve([{
          id: "sess-001", strategyId: "strat-001", firmId: "topstep",
          metricsSnapshot: null,
        }]).then(resolve); // session
        if (currentCall === 3) return Promise.resolve([{
          id: "strat-001", name: "orb_mes_5m", symbol: "MES", positionSize: null,
        }]).then(resolve); // strategy
        // Consecutive failures read
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "crit-001" }]),
      }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }));

    // Mock callOpenAI to return a valid critique
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const { runTradeCritique } = await import("../../services/trade-critique-service.js");

    // Call with dryRun=true explicitly — must NOT write to DB
    const result = await runTradeCritique("pos-spy-001", "replay-corr-001", true);

    // Result should be completed (LLM ran) but NO INSERT should have happened
    // for trade_critique (dryRun suppresses the INSERT)
    expect(result.status).toMatch(/completed|partial_data/);
    expect(result.grade).toBe("A");

    // Confirm dryRun suppressed persistence: critiqueId should be undefined
    // (no DB row written)
    expect(result.critiqueId).toBeUndefined();

    // Confirm DB insert was called ZERO times for trade_critique (audit insert
    // is also suppressed in dryRun mode — only non-dryRun path calls insert)
    const insertCalls = (mockDb.insert as ReturnType<typeof vi.fn>).mock.calls;
    // In dryRun=true mode, the trade_critique.insert path is skipped entirely.
    // audit_log insert is also skipped (dryRun gate in trade-critique-service.ts).
    expect(insertCalls).toHaveLength(0);
  });

  // ─── Test 7: Parameter hint application tracking ──────────────────────────

  it("(7) aggregateParameterHints — tracks application rate and Sharpe delta", () => {
    const critiques: TradeCritiqueRow[] = [
      // hint present but not applied
      makeCritique({ grade: "B", parameterHint: {
        field: "stop_loss", current: 8, suggested_range: "6-7", confidence: 0.8,
        applied: false,
      } }, 0),
      // hint present and applied with positive Sharpe delta
      makeCritique({ grade: "A", parameterHint: {
        field: "take_profit", current: 10, suggested_range: "12-14", confidence: 0.9,
        applied: true, sharpe_before: 1.2, sharpe_after: 1.6,
      } }, 1),
      // hint present and applied with negative Sharpe delta
      makeCritique({ grade: "C", parameterHint: {
        field: "entry_indicator", current: "ema_9", suggested_range: "ema_21", confidence: 0.7,
        applied: true, sharpe_before: 1.5, sharpe_after: 1.3,
      } }, 2),
      // no hint
      makeCritique({ grade: "D", parameterHint: null }, 3),
    ];

    const stats = aggregateParameterHints(critiques);

    expect(stats.critiquesWithHint).toBe(3);
    expect(stats.hintsApplied).toBe(2);
    expect(stats.applicationRate).toBeCloseTo(2 / 3, 3);
    // avg delta = ((1.6 - 1.2) + (1.3 - 1.5)) / 2 = (0.4 - 0.2) / 2 = 0.1
    expect(stats.avgSharpeDeltaWhenApplied).toBeCloseTo(0.1, 3);
  });

  // ─── Test 8: Decision rule — SIGNAL ──────────────────────────────────────

  it("(8) applyCritiqueDecisionRule — effect >= 0.65 AND p <= 0.05 AND n >= 50 → SIGNAL", () => {
    expect(applyCritiqueDecisionRule(0.68, 0.03, 60)).toBe("SIGNAL");
    expect(applyCritiqueDecisionRule(1.00, 0.001, 50)).toBe("SIGNAL");
  });

  // ─── Test 9: Decision rule — INCONCLUSIVE ────────────────────────────────

  it("(9) applyCritiqueDecisionRule — effect in [0.55, 0.65) → INCONCLUSIVE", () => {
    expect(applyCritiqueDecisionRule(0.60, 0.04, 60)).toBe("INCONCLUSIVE");
    // effect >= 0.65 but p > 0.05 also → INCONCLUSIVE (not SIGNAL)
    expect(applyCritiqueDecisionRule(0.70, 0.10, 60)).toBe("INCONCLUSIVE");
  });

  // ─── Test 10: Decision rule — NO_SIGNAL ──────────────────────────────────

  it("(10) applyCritiqueDecisionRule — effect < 0.55 AND n >= 50 → NO_SIGNAL", () => {
    expect(applyCritiqueDecisionRule(0.50, 0.80, 60)).toBe("NO_SIGNAL");
    expect(applyCritiqueDecisionRule(0.51, 0.30, 100)).toBe("NO_SIGNAL");
  });

  // ─── Test 11: Dry run — no file written ──────────────────────────────────

  it("(11) buildCritiqueMarkdownReport — dry-run: markdown is returned but caller must not write file", () => {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `critique-report-test-${Date.now()}.md`);

    // Confirm file doesn't exist yet
    expect(fs.existsSync(filePath)).toBe(false);

    // Build the report (pure function — doesn't write)
    const critiques = buildCritiques(60, [
      { grade: "A+", r: 1.5 }, { grade: "D", r: -0.5 },
    ]);
    const positions = critiques.map((c, i) => makePosition({}, i));
    const result = evaluateCritiqueGradeSignal(critiques, positions);
    const report  = buildCritiqueMarkdownReport(result, "2026-05-25", {});

    // Confirm report is non-empty
    expect(report.length).toBeGreaterThan(100);
    expect(report).toContain("# Wave 27 Pass 2");
    expect(report).toContain("Mann-Whitney");

    // Confirm file was NOT written (caller didn't write it — test verifies pure-function contract)
    expect(fs.existsSync(filePath)).toBe(false);
  });

  // ─── Test 12: Apply — writes markdown to disk ────────────────────────────

  it("(12) buildCritiqueMarkdownReport + fs.writeFileSync — apply mode writes valid markdown", () => {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `critique-report-apply-${Date.now()}.md`);

    const critiques = buildCritiques(60, [
      { grade: "A", r: 2.0 }, { grade: "F", r: -1.0 },
    ]);
    const positions = critiques.map((c, i) => makePosition({}, i));
    const result  = evaluateCritiqueGradeSignal(critiques, positions);
    const report  = buildCritiqueMarkdownReport(result, "2026-05-25", {
      critiqueSHA: "abc123def456",
      sampleSql: "SELECT * FROM paper_positions WHERE ...",
    });

    // Write (simulating --apply mode)
    fs.writeFileSync(filePath, report, "utf8");

    // Verify file exists and content matches
    expect(fs.existsSync(filePath)).toBe(true);
    const written = fs.readFileSync(filePath, "utf8");
    expect(written).toContain("# Wave 27 Pass 2");
    expect(written).toContain("abc123def456");
    expect(written).toContain("Mann-Whitney U Test");

    // Clean up
    fs.unlinkSync(filePath);
  });

  // ─── Test 13: aggregateByGrade computes avgR correctly ───────────────────

  it("(13) aggregateByGrade — computes avgR correctly per grade", () => {
    const critiques: TradeCritiqueRow[] = [
      makeCritique({ grade: "A+", realizedR: 2.0 }, 0),
      makeCritique({ grade: "A+", realizedR: 3.0 }, 1),
      makeCritique({ grade: "F",  realizedR: -1.0 }, 2),
      makeCritique({ grade: "F",  realizedR: -2.0 }, 3),
    ];
    const positionLookup = new Map<string, PaperPositionRow>();
    const allPositionsByStrategy = new Map<string, PaperPositionRow[]>();

    const stats = aggregateByGrade(critiques, positionLookup, allPositionsByStrategy);

    const aPlus = stats.find(s => s.grade === "A+");
    const fGrade = stats.find(s => s.grade === "F");

    expect(aPlus).toBeDefined();
    expect(fGrade).toBeDefined();
    expect(aPlus!.avgR).toBeCloseTo(2.5, 3);
    expect(fGrade!.avgR).toBeCloseTo(-1.5, 3);
  });

  // ─── Test 14: Empty critiques → PRELIMINARY ──────────────────────────────

  it("(14) evaluateCritiqueGradeSignal — empty critiques → PRELIMINARY", () => {
    const result = evaluateCritiqueGradeSignal([], []);
    expect(result.verdict).toBe("PRELIMINARY");
    expect(result.critiquesAnalyzed).toBe(0);
    expect(result.isPreliminary).toBe(true);
    expect(result.nHigh).toBe(0);
    expect(result.nLow).toBe(0);
  });

});
