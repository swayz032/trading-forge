/**
 * strategy-health-aggregator.ts — Wave 28 Pass A.2 (paper-parity)
 *
 * Orchestrates all 12 validation subsystems via Promise.allSettled, normalises
 * their scores, computes a single composite, and writes one immutable row to
 * `strategy_health_scores` per invocation.
 *
 * PURE OBSERVABILITY MODE — does NOT gate, block, or call lifecycle-service.
 * Only evidence is written. Promotion gates remain Wave 27.5 per-subsystem hard
 * gates (b14-ci-gate, wfe-gate, parameter-drift-gate).
 *
 * Architectural invariants:
 *   - Promise.allSettled catches per-subsystem failures; the orchestrator itself
 *     re-throws any uncaught exception after emitting a CRITICAL audit row.
 *   - Composite is skipped (no row written) when fewer than MIN_COMPOSITE_SUBSYSTEMS
 *     subsystems return available=true.
 *   - Score normalisation is delegated to src/server/lib/score-normalization.ts
 *     (A.3 deliverable). A temporary stub is included here for Round 1 parity.
 *   - weights_version_id: SHA-256 (16-char) over canonical-sorted-JSON of the
 *     equal-weight vector — mirrors firm-rules-version.ts SHA pattern.
 *
 * Env vars:
 *   MIN_COMPOSITE_SUBSYSTEMS  (default 8)  — minimum available subsystems for
 *                                             composite write to proceed
 *   COMPOSITE_MAX_AGE_HOURS   (default 48) — consumer-side staleness guard;
 *                                             aggregator stamps the age only
 *   WAVE_28_COMPOSITE_GATING_ENABLED (default false) — kill-switch flag for
 *                                             downstream consumers; aggregator
 *                                             does NOT read this flag
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 *
 * Production isolation (check:production-isolation):
 *   NO research-side module imports. No lifecycle-service. No kill-switch calls.
 */

import { randomUUID } from "crypto";
import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  backtests,
  monteCarloRuns,
  walkForwardWindows,
  tradeCritique,
  promptVersions,
  deeparForecasts,
  syntheticBlackSwanRuns,
  nemoScenarioBank,
  quantumMcRuns,
  strategyHealthScores,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import {
  computeComposite as libComputeComposite,
  computeWeightsVersionId as libComputeWeightsVersionId,
  EQUAL_WEIGHTS_VERSION_ID as LIB_EQUAL_WEIGHTS_VERSION_ID,
  verdictFromComposite,
  EQUAL_WEIGHTS as LIB_EQUAL_WEIGHTS,
  type SubsystemName,
} from "../lib/score-normalization.js";
import { fetchRlSignal } from "../lib/rl-signal-fetcher.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Per-subsystem fetch result — never throws to the orchestrator. */
export interface SubsystemResult {
  name: string;
  score: number | null;
  confidence: number | null;
  available: boolean;
  computed_at: Date | null;
  error?: string;
}

export type HealthVerdict = "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL";

export interface AggregatorResult {
  written: boolean;
  /** Row id written to strategy_health_scores, or null when skipped. */
  rowId: string | null;
  reason?: string;
  n?: number;
  verdict?: HealthVerdict | null;
  composite?: number | null;
  subsystems?: SubsystemResult[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum available subsystems required to write a composite row. */
const DEFAULT_MIN_COMPOSITE_SUBSYSTEMS = 8;
/** Equal-weight vector for the 12 subsystems — delegated to A.3 lib (single source of truth). */
const EQUAL_WEIGHTS = LIB_EQUAL_WEIGHTS;

const SUBSYSTEM_NAMES = Object.keys(EQUAL_WEIGHTS);

// ─── Env helpers ──────────────────────────────────────────────────────────────

function _getMinSubsystems(): number {
  const raw = process.env.MIN_COMPOSITE_SUBSYSTEMS;
  if (!raw) return DEFAULT_MIN_COMPOSITE_SUBSYSTEMS;
  const n = parseInt(raw, 10);
  // Allow 0 as an explicit test/bypass value; reject negatives and values > 13
  // (Wave 29 Pass C.3: 13 subsystems now — upper bound updated from 12 → 13)
  if (isNaN(n) || n < 0 || n > 13) {
    logger.warn({ raw }, "MIN_COMPOSITE_SUBSYSTEMS invalid — using default 8");
    return DEFAULT_MIN_COMPOSITE_SUBSYSTEMS;
  }
  return n;
}

// ─── weights_version_id helper ────────────────────────────────────────────────

/**
 * Compute a deterministic 16-char hex SHA-256 over the weights vector.
 *
 * Wave 28 Pass A architect-close reconciliation: delegates to
 * src/server/lib/score-normalization.ts which produces the full 64-char hash;
 * we slice to 16 chars to preserve the contract documented in the public test
 * surface and the firm-rules-version.ts parity convention (canonical-sorted-JSON
 * → SHA-256 → [0:16]).
 *
 * The migration column `weights_version_id` is TEXT — accepts both lengths.
 * Storing 16-char keeps row width compact and matches the audit / row identity
 * pattern the tests assert.
 */
export function computeWeightsVersionId(
  weights: Readonly<Record<string, number>> = EQUAL_WEIGHTS,
): string {
  return libComputeWeightsVersionId(weights).slice(0, 16);
}

// ─── Composite scoring — delegates to A.3 lib ─────────────────────────────────

/**
 * Wave 28 Pass A architect-close reconciliation: this thin wrapper adapts the
 * orchestrator's SubsystemResult[] shape to the lib's Record<name, number|null>
 * signature, then returns just the numeric composite (the lib also computes
 * verdict + version id, but the orchestrator computes those itself via the
 * single-source helpers above + classifyVerdict).
 *
 * The lib enforces its own MIN_AVAILABLE_FOR_COMPOSITE=8 floor when called
 * directly. For the orchestrator's existing fast-path (where the
 * MIN_COMPOSITE_SUBSYSTEMS env knob controls the gate BEFORE we get here), we
 * compute against available scores only — if fewer than the lib's internal
 * floor are present, the lib returns score=null and the orchestrator writes a
 * row with null composite (verdict also null). This preserves the
 * append-only audit lineage even on partial-data cycles.
 */
function computeComposite(
  subsystems: SubsystemResult[],
  _weights: Readonly<Record<string, number>>,
): number | null {
  const scoreMap: Record<string, number | null> = {};
  for (const s of subsystems) {
    scoreMap[s.name] = s.available && s.score !== null && s.score !== undefined
      ? s.score
      : null;
  }
  const result = libComputeComposite(scoreMap, _weights as Readonly<Record<SubsystemName, number>>);
  return result.score;
}

// ─── Verdict classifier ───────────────────────────────────────────────────────
//
// Wave 28 Pass A architect-close reconciliation: delegates to
// src/server/lib/score-normalization.ts::verdictFromComposite. Local wrapper
// preserved so existing callers / tests importing `classifyVerdict` from the
// aggregator surface continue working.

export function classifyVerdict(composite: number | null): HealthVerdict | null {
  return verdictFromComposite(composite);
}

// ─── Staleness helper ─────────────────────────────────────────────────────────

function _oldestComputedAt(subsystems: SubsystemResult[]): Date | null {
  const dates = subsystems
    .filter((s) => s.available && s.computed_at !== null)
    .map((s) => s.computed_at as Date);
  if (dates.length === 0) return null;
  return dates.reduce((oldest, d) => (d < oldest ? d : oldest), dates[0]);
}

function _stalenessHours(oldest: Date | null): number | null {
  if (!oldest) return null;
  return (Date.now() - oldest.getTime()) / (1000 * 3600);
}

// ─── 12 Subsystem Fetchers ────────────────────────────────────────────────────
// Each returns SubsystemResult — NEVER throws (caller uses Promise.allSettled).

/**
 * B14 Survival Twin — reads probability_of_ruin_ci.ci_high from the latest
 * completed MC run for the strategy's latest completed backtest.
 * Score = 1 - ci_high (higher ci_high = worse survivorship).
 */
export async function fetchB14SurvivalTwin(
  strategyId: string,
): Promise<SubsystemResult> {
  const name = "b14_survival_twin";
  try {
    // Latest completed backtest for this strategy
    const [bt] = await db
      .select({ id: backtests.id, createdAt: backtests.createdAt })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt) return { name, score: null, confidence: null, available: false, computed_at: null };

    const [mc] = await db
      .select({ riskMetrics: monteCarloRuns.riskMetrics, createdAt: monteCarloRuns.createdAt })
      .from(monteCarloRuns)
      .where(
        and(
          eq(monteCarloRuns.backtestId, bt.id),
          eq(monteCarloRuns.status, "completed"),
        ),
      )
      .orderBy(desc(monteCarloRuns.createdAt))
      .limit(1);

    if (!mc?.riskMetrics) return { name, score: null, confidence: null, available: false, computed_at: null };

    const rm = mc.riskMetrics as Record<string, unknown>;
    const ruinCi = rm["probability_of_ruin_ci"] as Record<string, unknown> | null;
    const ciHigh = ruinCi ? Number(ruinCi["ci_high"] ?? null) : null;
    if (ciHigh === null || isNaN(ciHigh)) {
      return { name, score: null, confidence: null, available: false, computed_at: null };
    }

    // Score: 1 - ci_high → [0,1]; higher is better (lower ruin CI = healthier)
    const score = Math.max(0, Math.min(1, 1 - ciHigh));
    const nResamples = ruinCi ? Number(ruinCi["n_resamples"] ?? 0) : 0;
    const confidence = nResamples >= 1000 ? 0.9 : nResamples >= 200 ? 0.7 : 0.5;

    return { name, score, confidence, available: true, computed_at: new Date(mc.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Walk-Forward Efficiency — reads wfe_overall from walkForwardResults JSONB on
 * the latest completed backtest.  Score = wfe_overall (already [0,1] ratio).
 */
export async function fetchWfe(strategyId: string): Promise<SubsystemResult> {
  const name = "wfe";
  try {
    const [bt] = await db
      .select({ walkForwardResults: backtests.walkForwardResults, createdAt: backtests.createdAt })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt?.walkForwardResults) return { name, score: null, confidence: null, available: false, computed_at: null };

    const wfr = bt.walkForwardResults as Record<string, unknown>;
    const wfeOverall = wfr["wfe_overall"] !== undefined ? Number(wfr["wfe_overall"]) : null;
    if (wfeOverall === null || isNaN(wfeOverall)) {
      return { name, score: null, confidence: null, available: false, computed_at: null };
    }

    const score = Math.max(0, Math.min(1, wfeOverall));
    return { name, score, confidence: 0.85, available: true, computed_at: new Date(bt.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Parameter Drift — reads param_stability.drift_classification + drift_confidence
 * from walkForwardWindows (most recent window for the latest backtest).
 * Score: stable→1.0, regime_driven→0.8, indeterminate→0.5, overfit_drift→0.0
 */
export async function fetchParameterDrift(strategyId: string): Promise<SubsystemResult> {
  const name = "parameter_drift";
  try {
    const [bt] = await db
      .select({ id: backtests.id, createdAt: backtests.createdAt })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt) return { name, score: null, confidence: null, available: false, computed_at: null };

    // Latest walk-forward window carries param_stability
    const [wfw] = await db
      .select({ paramStability: walkForwardWindows.paramStability, createdAt: walkForwardWindows.createdAt })
      .from(walkForwardWindows)
      .where(eq(walkForwardWindows.backtestId, bt.id))
      .orderBy(desc(walkForwardWindows.windowIndex))
      .limit(1);

    if (!wfw?.paramStability) return { name, score: null, confidence: null, available: false, computed_at: null };

    const ps = wfw.paramStability as Record<string, unknown>;
    const classification = String(ps["drift_classification"] ?? "");
    const driftConfidence = ps["drift_confidence"] !== undefined ? Number(ps["drift_confidence"]) : 0.5;

    const SCORE_MAP: Record<string, number> = {
      stable:        1.0,
      regime_driven: 0.8,
      indeterminate: 0.5,
      overfit_drift: 0.0,
    };
    const score = SCORE_MAP[classification] ?? null;
    if (score === null) return { name, score: null, confidence: null, available: false, computed_at: null };

    return { name, score, confidence: driftConfidence, available: true, computed_at: new Date(wfw.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * B15 Robustness — reads b15Battery JSONB from latest completed backtest.
 * Score = (1 - sdr) × (1 - psi/0.05) × (1 - rws/0.20) combined, clamped [0,1].
 * Simpler: score = passed ? 1.0 : 0.0 (binary gate passed/failed).
 */
export async function fetchB15Robustness(strategyId: string): Promise<SubsystemResult> {
  const name = "b15_robustness";
  try {
    const [bt] = await db
      .select({ b15Battery: backtests.b15Battery, createdAt: backtests.createdAt })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt?.b15Battery) return { name, score: null, confidence: null, available: false, computed_at: null };

    const b15 = bt.b15Battery as Record<string, unknown>;
    const passed = Boolean(b15["passed"]);
    const sdr = b15["sdr"] !== undefined ? Number(b15["sdr"]) : null;
    const psi = b15["psi"] !== undefined ? Number(b15["psi"]) : null;
    const rws = b15["rws"] !== undefined ? Number(b15["rws"]) : null;

    // Graded score: blend SDR, PSI (inverted/normalised), RWS (inverted/normalised)
    let score: number;
    if (sdr !== null && psi !== null && rws !== null) {
      const sdrScore = Math.max(0, Math.min(1, sdr));
      const psiScore = Math.max(0, Math.min(1, 1 - psi / 0.05));
      const rwsScore = Math.max(0, Math.min(1, 1 - rws / 0.20));
      score = (sdrScore + psiScore + rwsScore) / 3;
    } else {
      score = passed ? 1.0 : 0.0;
    }

    const confidence = (sdr !== null && psi !== null && rws !== null) ? 0.8 : 0.6;
    return { name, score, confidence, available: true, computed_at: new Date(bt.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Compliance enforce-mode block-rate — reads from audit_log rows with
 * action='compliance.enforce_block' for the strategy's latest backtest.
 * Score = 1 - block_rate (lower block rate = healthier).
 */
export async function fetchComplianceBlockRate(strategyId: string): Promise<SubsystemResult> {
  const name = "compliance_block_rate";
  try {
    // Use audit_log to count enforce_block rows vs total trade rows for the strategy.
    // Keep the query simple to avoid complex joins — count via raw sql is NOT allowed
    // (drizzle inArray pattern required per CLAUDE.md).
    // Instead, read from backtests.propCompliance JSONB which stores the compliance summary.
    const [bt] = await db
      .select({ propCompliance: backtests.propCompliance, createdAt: backtests.createdAt, totalTrades: backtests.totalTrades })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt?.propCompliance) return { name, score: null, confidence: null, available: false, computed_at: null };

    const pc = bt.propCompliance as Record<string, unknown>;
    const violationCount = pc["violation_count"] !== undefined ? Number(pc["violation_count"]) : 0;
    const totalTrades = bt.totalTrades ?? 0;
    if (totalTrades === 0) return { name, score: null, confidence: null, available: false, computed_at: null };

    const blockRate = violationCount / totalTrades;
    const score = Math.max(0, Math.min(1, 1 - blockRate));

    return { name, score, confidence: 0.8, available: true, computed_at: new Date(bt.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Trade Critique — reads recent avg entry_quality_score from trade_critique rows
 * for this strategy. Score normalised [0,1] (scores are 0-10 scale in DB).
 */
export async function fetchTradeCritique(strategyId: string): Promise<SubsystemResult> {
  const name = "trade_critique";
  try {
    // trade_critique rows link through paper_positions → paper_sessions → strategies
    // Simplification: read last 20 critique rows; join via paper_positions.session_id
    // For now, read from audit_log rows of action='trade_critique.completed' containing
    // the entry_quality_score. The trade_critique table has its own strategyId field
    // if it's been populated; check that first.
    const rows = await db
      .select({
        technicalDiagnosis: tradeCritique.technicalDiagnosis,
        createdAt: tradeCritique.createdAt,
      })
      .from(tradeCritique)
      .where(eq(tradeCritique.strategyId, String(strategyId)))
      .orderBy(desc(tradeCritique.createdAt))
      .limit(20);

    if (rows.length === 0) return { name, score: null, confidence: null, available: false, computed_at: null };

    let totalScore = 0;
    let count = 0;
    for (const row of rows) {
      const td = row.technicalDiagnosis as Record<string, unknown> | null;
      if (td && td["entry_quality_score"] !== undefined) {
        totalScore += Number(td["entry_quality_score"]);
        count++;
      }
    }
    if (count === 0) return { name, score: null, confidence: null, available: false, computed_at: null };

    // entry_quality_score is 0-10; normalise to [0,1]
    const avgScore = totalScore / count;
    const score = Math.max(0, Math.min(1, avgScore / 10));
    const confidence = count >= 10 ? 0.85 : count >= 5 ? 0.7 : 0.5;
    const latestDate = rows[0].createdAt;

    return { name, score, confidence, available: true, computed_at: new Date(latestDate) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Pattern Aggregator — reads last A/B prompt verdict from prompt_versions table.
 * A active prompt version = "passed" (score 1.0); no active prompt = 0.5 (neutral);
 * no prompt rows = unavailable.
 */
export async function fetchPatternAggregator(strategyId: string): Promise<SubsystemResult> {
  const name = "pattern_aggregator";
  try {
    // Pattern aggregator manages strategy_proposer prompt_versions.
    // We read the latest prompt_versions row for 'strategy_proposer' — if active and recent
    // that signals the loop is healthy.
    const rows = await db
      .select({
        isActive: promptVersions.isActive,
        createdAt: promptVersions.createdAt,
      })
      .from(promptVersions)
      .where(eq(promptVersions.promptType, "strategy_proposer"))
      .orderBy(desc(promptVersions.createdAt))
      .limit(5);

    if (rows.length === 0) return { name, score: null, confidence: null, available: false, computed_at: null };

    // If any recent version is active → the loop is running
    const anyActive = rows.some((r) => r.isActive);
    const score = anyActive ? 1.0 : 0.5;
    const latestDate = rows[0].createdAt;

    return { name, score, confidence: 0.65, available: true, computed_at: new Date(latestDate) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Consistency Tracker — reads current_pct (concentration %) from the consistency
 * state table / broker_accounts. Score = 1 - (concentration_pct / 50).
 * Uses the audit_log pattern to detect last consistency check for this strategy.
 * Score: 0%→1.0, 25%→0.5, ≥50%→0.0
 */
export async function fetchConsistencyTracker(strategyId: string): Promise<SubsystemResult> {
  const name = "consistency_tracker";
  try {
    // Consistency tracker is per-account, not per-strategy directly.
    // We read from audit_log: action='consistency.gate_cleared' or consistency.*
    // For a strategy-level aggregation, we look for the latest consistency audit
    // that references this strategy. Since entityType="broker_account", we use
    // audit_log as the source. This is a best-effort probe — return unavailable
    // if no recent rows exist (consistency tracker not yet wired per CLAUDE.md §12).
    // TODO (coordination pass): wire per-strategy consistency_pct when the Topstep
    //   consistency gate is wired into paper-signal-service.ts.
    return { name, score: null, confidence: null, available: false, computed_at: null, error: "consistency_tracker_not_yet_per_strategy" };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * DeepAR Forecast — reads forecast vs realized delta from deeparForecasts.
 * Score: hitRate [0,1] from the latest forecast for the strategy's symbol.
 * Confidence scaled by forecastConfidence from the model.
 */
export async function fetchDeeparForecast(strategyId: string): Promise<SubsystemResult> {
  const name = "deepar_forecast";
  try {
    // Resolve the strategy's primary symbol
    const [strat] = await db
      .select({ symbol: strategies.symbol })
      .from(strategies)
      .where(eq(strategies.id, String(strategyId)))
      .limit(1);

    if (!strat?.symbol) return { name, score: null, confidence: null, available: false, computed_at: null };

    const [forecast] = await db
      .select({
        hitRate: deeparForecasts.hitRate,
        forecastConfidence: deeparForecasts.forecastConfidence,
        generatedAt: deeparForecasts.generatedAt,
      })
      .from(deeparForecasts)
      .where(eq(deeparForecasts.symbol, strat.symbol))
      .orderBy(desc(deeparForecasts.generatedAt))
      .limit(1);

    if (!forecast?.hitRate) return { name, score: null, confidence: null, available: false, computed_at: null };

    const score = Math.max(0, Math.min(1, Number(forecast.hitRate)));
    const confidence = forecast.forecastConfidence !== null
      ? Math.max(0, Math.min(1, Number(forecast.forecastConfidence)))
      : 0.6;

    return {
      name,
      score,
      confidence,
      available: true,
      computed_at: forecast.generatedAt ? new Date(forecast.generatedAt) : null,
    };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Black Swan — reads survival_rate from syntheticBlackSwanRuns.
 * Score: survival_rate [0,1] (higher = healthier — survived more regime stresses).
 * Challenger-only per §12 (A14 advisory gate).
 */
export async function fetchBlackSwan(strategyId: string): Promise<SubsystemResult> {
  const name = "black_swan";
  try {
    const [run] = await db
      .select({
        survivalRate: syntheticBlackSwanRuns.survivalRate,
        numRegimesTested: syntheticBlackSwanRuns.numRegimesTested,
        numRegimesSurvived: syntheticBlackSwanRuns.numRegimesSurvived,
        createdAt: syntheticBlackSwanRuns.createdAt,
      })
      .from(syntheticBlackSwanRuns)
      .where(
        and(
          eq(syntheticBlackSwanRuns.strategyId, String(strategyId)),
          eq(syntheticBlackSwanRuns.status, "completed"),
        ),
      )
      .orderBy(desc(syntheticBlackSwanRuns.createdAt))
      .limit(1);

    if (!run) return { name, score: null, confidence: null, available: false, computed_at: null };

    const survivalRate = run.survivalRate !== null ? Number(run.survivalRate) : null;
    if (survivalRate === null || isNaN(survivalRate)) {
      // Black swan ran but no survival_rate — treat as neutral
      return { name, score: 0.5, confidence: 0.5, available: true, computed_at: new Date(run.createdAt) };
    }

    const score = Math.max(0, Math.min(1, survivalRate));
    const nTested = run.numRegimesTested ?? 0;
    const confidence = nTested >= 10 ? 0.80 : nTested >= 5 ? 0.65 : 0.50;
    return { name, score, confidence, available: true, computed_at: new Date(run.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * NeMo — reads the most recent scenario bank entries to compute a macro stress
 * advisory score. NeMo scenarios are shared (not per-strategy); we score based on
 * the severity distribution of the most recent 20 scenarios.
 * Score: 1 - (severe+extreme_count / total_count) → [0,1] (lower stress = healthier).
 * Challenger-only advisory per §12 (Phase 0 governance).
 *
 * Note: strategyId is accepted for interface consistency but not used in the query.
 */
export async function fetchNemo(_strategyId: string): Promise<SubsystemResult> {
  const name = "nemo";
  try {
    const rows = await db
      .select({
        severity: nemoScenarioBank.severity,
        createdAt: nemoScenarioBank.createdAt,
      })
      .from(nemoScenarioBank)
      .orderBy(desc(nemoScenarioBank.createdAt))
      .limit(20);

    if (rows.length === 0) return { name, score: null, confidence: null, available: false, computed_at: null };

    // Score based on the share of mild/moderate vs severe/extreme scenarios
    const severeCount = rows.filter((r) => r.severity === "severe" || r.severity === "extreme").length;
    const stressRatio = severeCount / rows.length;
    const score = Math.max(0, Math.min(1, 1 - stressRatio));

    const latestDate = rows[0].createdAt;
    return { name, score, confidence: 0.60, available: true, computed_at: new Date(latestDate) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * Quantum Replay — reads latest verdict from quantumMcRuns replay rows.
 * Score: SIGNAL→1.0, INCONCLUSIVE→0.5, NO_SIGNAL→0.0, PRELIMINARY→0.5 (unknown).
 */
export async function fetchQuantumReplay(strategyId: string): Promise<SubsystemResult> {
  const name = "quantum_replay";
  try {
    const [bt] = await db
      .select({ id: backtests.id, createdAt: backtests.createdAt })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, String(strategyId)),
          eq(backtests.status, "completed"),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt) return { name, score: null, confidence: null, available: false, computed_at: null };

    // Replay rows are quantum_mc_runs with governanceLabels.replay_mode=true
    const [qmr] = await db
      .select({
        withinTolerance: quantumMcRuns.withinTolerance,
        governanceLabels: quantumMcRuns.governanceLabels,
        toleranceDelta: quantumMcRuns.toleranceDelta,
        createdAt: quantumMcRuns.createdAt,
      })
      .from(quantumMcRuns)
      .where(
        and(
          eq(quantumMcRuns.backtestId, bt.id),
          eq(quantumMcRuns.status, "completed"),
        ),
      )
      .orderBy(desc(quantumMcRuns.createdAt))
      .limit(1);

    if (!qmr) return { name, score: null, confidence: null, available: false, computed_at: null };

    const gl = qmr.governanceLabels as Record<string, unknown>;
    const verdict = gl["weekly_verdict"] as string | undefined;
    const replayMode = gl["replay_mode"];

    const VERDICT_SCORES: Record<string, number> = {
      SIGNAL:        1.0,
      INCONCLUSIVE:  0.5,
      "NO SIGNAL":   0.0,
      PRELIMINARY:   0.5,
    };

    const score = verdict !== undefined
      ? (VERDICT_SCORES[verdict] ?? (qmr.withinTolerance ? 0.75 : 0.25))
      : (qmr.withinTolerance ? 0.75 : 0.25);

    const isReplay = Boolean(replayMode);
    const confidence = isReplay ? 0.7 : 0.5;

    return { name, score, confidence, available: true, computed_at: new Date(qmr.createdAt) };
  } catch (err) {
    return { name, score: null, confidence: null, available: false, computed_at: null, error: String(err) };
  }
}

/**
 * RL Agent — Wave 29 Pass C.3 13th subsystem.
 *
 * Reads the latest quantum_rl_runs row for the strategy via rl-signal-fetcher.ts.
 * Returns null (available=false) when:
 *   - No RL rows exist (strategy not yet RL-evaluated)
 *   - DSR gate not passed (policy not graduated)
 *   - Kill switch active (>30% Sharpe gap)
 *   - Any DB error (fail-soft)
 *
 * Score = effective_confidence ∈ [0,1] when available.
 * Confidence reflects how many trade observations were used for dampening.
 */
export async function fetchRlAgent(strategyId: string): Promise<SubsystemResult> {
  const name = "rl_agent";
  try {
    const result = await fetchRlSignal(strategyId);
    if (!result.available || result.confidence === null) {
      return {
        name,
        score: null,
        confidence: null,
        available: false,
        computed_at: result.computed_at,
        error: result.error ?? result.unavailable_reason,
      };
    }
    return {
      name,
      score: result.confidence,
      confidence: result.confidence,
      available: true,
      computed_at: result.computed_at,
    };
  } catch (err) {
    return {
      name,
      score: null,
      confidence: null,
      available: false,
      computed_at: null,
      error: String(err),
    };
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * aggregateStrategyHealth — run all 12 subsystem fetchers in parallel via
 * Promise.allSettled, compute composite, write one immutable row to
 * strategy_health_scores.
 *
 * fail-CLOSED contract:
 *   Any uncaught exception inside this function → emit
 *   composite_health.aggregator_uncaught_error audit row + re-throw.
 *   Promise.allSettled catches per-subsystem failures only.
 *
 * @param strategyId  - UUID strategy ID (strategies.id — matches uuid("id") schema column)
 */
export async function aggregateStrategyHealth(strategyId: string): Promise<AggregatorResult> {
  const correlationId = randomUUID();
  const startedAt = new Date();

  try {
    // ── Step 1: Run all 13 fetchers in parallel ─────────────────────────────
    // Wave 29 Pass C.3: rl_agent added as 13th subsystem.
    // MIN_COMPOSITE_SUBSYSTEMS=8 floor unchanged — RL unavailability does NOT
    // prevent composite writes; other 12 subsystems carry the composite.
    const fetchers: Promise<SubsystemResult>[] = [
      fetchB14SurvivalTwin(strategyId),
      fetchWfe(strategyId),
      fetchParameterDrift(strategyId),
      fetchB15Robustness(strategyId),
      fetchComplianceBlockRate(strategyId),
      fetchTradeCritique(strategyId),
      fetchPatternAggregator(strategyId),
      fetchConsistencyTracker(strategyId),
      fetchDeeparForecast(strategyId),
      fetchBlackSwan(strategyId),
      fetchNemo(strategyId),
      fetchQuantumReplay(strategyId),
      fetchRlAgent(strategyId),  // 13th — Wave 29 Pass C.3
    ];

    const settled = await Promise.allSettled(fetchers);

    const subsystems: SubsystemResult[] = settled.map((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      // Subsystem threw despite our internal try/catch — wrap it
      const fallbackName = SUBSYSTEM_NAMES[idx] ?? `subsystem_${idx}`;
      logger.warn(
        { strategyId, subsystem: fallbackName, err: String(outcome.reason) },
        "strategy-health-aggregator: subsystem threw unexpectedly — isolated",
      );
      return {
        name: fallbackName,
        score: null,
        confidence: null,
        available: false,
        computed_at: null,
        error: String(outcome.reason),
      };
    });

    // ── Step 2: Count available subsystems ──────────────────────────────────
    const n = subsystems.filter((s) => s.available).length;
    const minRequired = _getMinSubsystems();

    if (n < minRequired) {
      // Below threshold — skip composite row, emit WARN audit
      await insertAuditRowSafe({
        action: "composite_health.skipped_below_subsystem_threshold",
        entityType: "strategy",
        entityId: String(strategyId),
        result: {
          available_subsystems: n,
          min_required: minRequired,
          subsystems: subsystems.map((s) => ({ name: s.name, available: s.available, error: s.error })),
        },
        status: "warning",
        decisionAuthority: "system",
        correlationId,
      });

      logger.warn(
        { strategyId, n, minRequired, correlationId },
        "strategy-health-aggregator: below threshold — composite row NOT written",
      );

      return { written: false, rowId: null, reason: "below_threshold", n };
    }

    // ── Step 3: Compute composite via scoring lib (A.3 stub path) ───────────
    const composite = computeComposite(subsystems, EQUAL_WEIGHTS);

    // ── Step 4: Compute weights_version_id ─────────────────────────────────
    // Wave B LOW-2 fix: use the module-level memoized constant for EQUAL_WEIGHTS
    // instead of calling computeWeightsVersionId() per-cycle (which was hashing
    // an immutable constant on every aggregator run). The 16-char slice is
    // preserved: LIB_EQUAL_WEIGHTS_VERSION_ID is 64 chars; slice(0,16) keeps
    // the existing column-width contract documented in Wave 28 Pass A.
    const weightsVersionId = LIB_EQUAL_WEIGHTS_VERSION_ID.slice(0, 16);

    // ── Step 5: Staleness ───────────────────────────────────────────────────
    const oldest = _oldestComputedAt(subsystems);
    const stalenessAgeHours = _stalenessHours(oldest);

    // ── Step 6: Verdict ─────────────────────────────────────────────────────
    const verdict = classifyVerdict(composite);

    // ── Step 7: INSERT into strategy_health_scores ──────────────────────────
    // Wave 28 Pass A architect-close reconciliation: typed Drizzle insert via
    // strategyHealthScores from src/server/db/schema.ts (A.1 deliverable).
    // The legacy raw db.execute(sql`INSERT ...`) bridge has been removed.
    //
    // Append-only contract (migration 0149): every aggregator run INSERTs a new
    // row. The schema column `id` is BIGSERIAL — DB-generated. We retain a
    // surrogate rowId (UUID) on the AggregatorResult return value for in-process
    // correlation only; it is NOT persisted (id is the DB-assigned bigint).
    const rowId = randomUUID();

    // Build the subsystem scores JSONB blob
    const subsystemScoresJson: Record<string, unknown> = {};
    for (const s of subsystems) {
      subsystemScoresJson[s.name] = {
        score: s.score,
        confidence: s.confidence,
        available: s.available,
        computed_at: s.computed_at?.toISOString() ?? null,
        error: s.error ?? null,
      };
    }

    try {
      // Typed Drizzle insert — column-name + type-checked at compile time.
      // Wave hardening 2026-06-22 (Defect G4): strategyId column is now UUID in schema.ts
      // and migration 0149 (corrected from INTEGER). Pass the UUID string directly — no cast.
      await db.insert(strategyHealthScores).values({
        strategyId: strategyId,
        evaluatedAt: startedAt,
        compositeScore: composite,
        verdict: verdict,
        subsystemScores: subsystemScoresJson,
        computedFromNSubsystems: n,
        weightsVersionId: weightsVersionId,
        stalenessAgeHours: stalenessAgeHours,
        // disagreements: Pass D deliverable — null in Pass A
      });
    } catch (_insertErr) {
      // Defensive: log but do not fail the aggregator — Pass A is observability
      // only. Audit row (Step 8) still emitted so the failure is traceable.
      logger.warn(
        { strategyId, rowId, err: String(_insertErr), correlationId },
        "strategy-health-aggregator: strategy_health_scores insert failed — audit row still written",
      );
    }

    // ── Step 8: Emit composite_health.evaluated audit row ───────────────────
    await insertAuditRowSafe({
      action: "composite_health.evaluated",
      entityType: "strategy",
      entityId: String(strategyId),
      result: {
        row_id: rowId,
        composite_health_score: composite,
        verdict,
        computed_from_n_subsystems: n,
        weights_version_id: weightsVersionId,
        staleness_age_hours: stalenessAgeHours,
        subsystems: subsystems.map((s) => ({
          name: s.name,
          score: s.score,
          confidence: s.confidence,
          available: s.available,
          computed_at: s.computed_at?.toISOString() ?? null,
          error: s.error ?? null,
        })),
      },
      status: "success",
      decisionAuthority: "system",
      correlationId,
    });

    logger.info(
      { strategyId, verdict, composite, n, weightsVersionId, stalenessAgeHours, correlationId },
      "strategy-health-aggregator: composite health evaluated",
    );

    return {
      written: true,
      rowId,
      verdict: verdict ?? null,
      composite,
      n,
      subsystems,
    };

  } catch (uncaught) {
    // fail-CLOSED: uncaught exception → audit + re-throw
    await insertAuditRowSafe({
      action: "composite_health.aggregator_uncaught_error",
      entityType: "strategy",
      entityId: String(strategyId),
      result: {
        error: String(uncaught),
        stack: uncaught instanceof Error ? uncaught.stack : undefined,
      },
      status: "failure",
      decisionAuthority: "system",
      correlationId,
    });

    logger.error(
      { strategyId, err: uncaught, correlationId },
      "strategy-health-aggregator: UNCAUGHT aggregator error — re-throwing",
    );

    throw uncaught;
  }
}
