/**
 * Critic Optimizer Service — Orchestrates the closed-loop optimization cycle.
 *
 * Flow:
 * 1. Rate limit check (1 run/strategy/24h)
 * 2. Collect evidence from all subsystems (poll DB, 5 min max)
 * 3. Call Python critic_optimizer → get ranked candidates
 * 4. Replay top 3 through runBacktest(walkforward)
 * 5. Select survivor (must pass classical gates)
 * 6. Create new strategy version if survivor beats parent
 * 7. Audit log + SSE broadcast
 */

import { eq, and, desc, gt, sql, inArray, isNotNull } from "drizzle-orm";
import {
  criticOptimizationRuns,
  criticCandidates,
  backtests,
  strategies,
  sqaOptimizationRuns,
  quboTimingRuns,
  tensorPredictions,
  monteCarloRuns,
  quantumMcRuns,
  rlTrainingRuns,
  auditLog,
  deeparForecasts,
} from "../db/schema.js";
import { db } from "../db/index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { callOpenAI } from "./model-router.js";
import { tracer } from "../lib/tracing.js";

const MAX_REPLAY_CANDIDATES = 3;
const EVIDENCE_WAIT_MS = 5 * 60 * 1000; // 5 minutes
const EVIDENCE_POLL_INTERVAL_MS = 10_000; // 10 seconds
const CRITIC_TIMEOUT_MS = 300_000; // 5 minutes
const RATE_LIMIT_HOURS = 24;
const MAX_GENERATIONS = 3; // Hard cap on evolution depth
const MC_GATE_WAIT_MS = 60_000; // Max wait for post-replay MC (60 s)
const MC_SURVIVAL_THRESHOLD = 0.70; // Minimum MC survival rate required
const EVIDENCE_COLLECTOR_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Composite scoring weights — mirrors CriticScorer.WEIGHTS in critic_optimizer.py.
 * Kept in sync manually; update both locations together.
 */
const COMPOSITE_WEIGHTS = {
  oos_return: 0.15,
  survival_rate: 0.15,
  profit_factor: 0.15,
  payout_feasibility: 0.10,
  max_drawdown: -0.15,
  breach_probability: -0.10,
  param_instability: -0.10,
  regime_fragility: -0.05,
  timing_fragility: -0.05,
};

interface HistoricalRun {
  run_id: string;
  strategy_id: string;
  strategy_config: Record<string, unknown>;
  backtest_metrics: Record<string, unknown>;
  parent_composite_score: number | null;
  survivor_composite_score: number | null;
  /** "survivor_selected" | "no_survivor" | "killed" | "failed" */
  outcome: string;
  changed_params: Record<string, unknown>;
}

interface EvidencePacket {
  strategy_config: Record<string, unknown>;
  backtest_metrics: Record<string, unknown>;
  daily_pnls: number[];
  trades: Record<string, unknown>[];
  walk_forward: Record<string, unknown> | null;
  sqa_result: Record<string, unknown> | null;
  mc_result: Record<string, unknown> | null;
  quantum_mc_result: Record<string, unknown> | null;
  qubo_timing: Record<string, unknown> | null;
  tensor_prediction: Record<string, unknown> | null;
  rl_result: Record<string, unknown> | null;
  param_ranges: Array<{ name: string; min_val: number; max_val: number; n_bits: number }>;
  max_candidates: number;
  pennylane_enabled: boolean;
  /** Historical critic runs for same symbol/timeframe used to populate cuVS memory index. */
  historical_runs: HistoricalRun[];
  /** DeepAR regime forecast accuracy evidence (challenger signal only). */
  deepar_evidence: {
    hit_rate: number;
    days_tracked: number;
    current_weight: number;
    latest_forecast: {
      p_high_vol: number;
      p_trending: number;
      forecast_confidence: number;
    } | null;
  } | null;
}

interface CriticResult {
  candidates: Array<{
    rank: number;
    changed_params: Record<string, number>;
    parent_params: Record<string, number>;
    source_of_change: string;
    expected_uplift: number;
    risk_penalty: number;
    composite_score: number;
    confidence: string;
    reasoning: string;
  }>;
  parent_composite_score: number;
  evidence_summary: Record<string, unknown>;
  kill_signal: string | null;
  execution_time_ms: number;
  governance: Record<string, unknown>;
}

interface CriticEvaluation {
  evaluation: "pass" | "warn" | "fail";
  confidence: number;
  reasoning: string;
  risk_flags: string[];
  recommended_adjustments: Array<{
    param_name: string;
    direction: "increase" | "decrease" | "widen_range" | "narrow_range";
    magnitude: "small" | "medium" | "large";
  }>;
}

// ─── Evidence Collector (Async, Event-Driven) ──────────────────────

type EvidenceSource = "sqa" | "mc" | "quantum_mc" | "qubo" | "tensor" | "rl" | "deepar";

const ALL_EVIDENCE_SOURCES: EvidenceSource[] = ["sqa", "mc", "quantum_mc", "qubo", "tensor", "rl", "deepar"];
const REQUIRED_SOURCES: EvidenceSource[] = ["sqa", "mc"];

/**
 * EvidenceCollector replaces synchronous polling with event-driven collection.
 * Sources report in via addEvidence(). When all required sources report or
 * the 10-minute timeout hits, the collector resolves with whatever evidence
 * has accumulated.
 *
 * Usage:
 *   const collector = new EvidenceCollector(runId);
 *   // ... external systems call collector.addEvidence("sqa", data) ...
 *   const evidence = await collector.waitForCompletion();
 */
export class EvidenceCollector {
  readonly runId: string;
  private collected = new Map<EvidenceSource, Record<string, unknown>>();
  private resolvePromise: ((value: Map<EvidenceSource, Record<string, unknown>>) => void) | null = null;
  private rejectPromise: ((reason: Error) => void) | null = null;
  private completionPromise: Promise<Map<EvidenceSource, Record<string, unknown>>>;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private settled = false;

  constructor(runId: string, timeoutMs: number = EVIDENCE_COLLECTOR_TIMEOUT_MS) {
    this.runId = runId;
    this.completionPromise = new Promise((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });

    // 10-minute hard timeout
    this.timeoutHandle = setTimeout(() => {
      if (!this.settled) {
        this.settled = true;
        logger.warn(
          { runId, collected: [...this.collected.keys()], missing: this.getMissingSources() },
          "EvidenceCollector: timeout reached — proceeding with partial evidence",
        );
        this.resolvePromise?.(this.collected);
      }
    }, timeoutMs);
  }

  /**
   * Add evidence from a source. If all required sources have reported,
   * the collector resolves immediately (no need to wait for optional sources).
   */
  addEvidence(source: EvidenceSource, data: Record<string, unknown>): void {
    if (this.settled) {
      logger.debug({ runId: this.runId, source }, "EvidenceCollector: evidence arrived after settlement — ignoring");
      return;
    }

    this.collected.set(source, data);
    broadcastSSE("critic:evidence_source", { runId: this.runId, source, status: "received" });

    // Check if all required sources are in
    const allRequiredPresent = REQUIRED_SOURCES.every((s) => this.collected.has(s));
    if (allRequiredPresent) {
      // Also wait a short grace period (2s) for optional sources that may be about to arrive
      setTimeout(() => {
        if (!this.settled) {
          this.settle();
        }
      }, 2000);
    }
  }

  /**
   * Wait for evidence collection to complete (either all sources report or timeout).
   */
  async waitForCompletion(): Promise<Map<EvidenceSource, Record<string, unknown>>> {
    return this.completionPromise;
  }

  /**
   * Get sources that haven't reported yet.
   */
  getMissingSources(): EvidenceSource[] {
    return ALL_EVIDENCE_SOURCES.filter((s) => !this.collected.has(s));
  }

  /**
   * Check if a specific source has reported.
   */
  hasSource(source: EvidenceSource): boolean {
    return this.collected.has(source);
  }

  /**
   * Get evidence for a specific source (or null).
   */
  getEvidence(source: EvidenceSource): Record<string, unknown> | null {
    return this.collected.get(source) ?? null;
  }

  /**
   * Force-settle (e.g., on cancellation).
   */
  cancel(reason: string): void {
    if (!this.settled) {
      this.settled = true;
      if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
      this.rejectPromise?.(new Error(`EvidenceCollector cancelled: ${reason}`));
    }
  }

  private settle(): void {
    this.settled = true;
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    logger.info(
      { runId: this.runId, collected: [...this.collected.keys()], missing: this.getMissingSources() },
      "EvidenceCollector: settled",
    );
    this.resolvePromise?.(this.collected);
  }
}

// ─── Active Collectors Registry ─────────────────────────────────────

const activeCollectors = new Map<string, EvidenceCollector>();

/**
 * Get or create an EvidenceCollector for a given run.
 * External services use this to push evidence asynchronously.
 */
export function getEvidenceCollector(runId: string): EvidenceCollector | undefined {
  return activeCollectors.get(runId);
}

/**
 * Register a collector. Called internally by triggerCriticOptimizerAsync.
 */
function registerCollector(runId: string, collector: EvidenceCollector): void {
  activeCollectors.set(runId, collector);
}

/**
 * Remove a collector after completion.
 */
function unregisterCollector(runId: string): void {
  activeCollectors.delete(runId);
}

/**
 * Async entry point: returns 202 with runId immediately.
 * Evidence accumulates via addEvidence() calls from external systems.
 * When all sources report or 10-min timeout, proceeds with optimization.
 */
export async function triggerCriticOptimizerAsync(
  backtestId: string,
  strategyId: string,
  _config: Record<string, unknown>,
): Promise<{ runId: string; status: string }> {
  // Rate limit check
  const recentRun = await db
    .select({ id: criticOptimizationRuns.id })
    .from(criticOptimizationRuns)
    .where(
      and(
        eq(criticOptimizationRuns.strategyId, strategyId),
        gt(criticOptimizationRuns.createdAt, new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000)),
      ),
    )
    .limit(1);

  if (recentRun.length > 0) {
    return { runId: "", status: "rate_limited" };
  }

  // Insert pending run
  const [run] = await db
    .insert(criticOptimizationRuns)
    .values({ strategyId, backtestId, status: "collecting_evidence" })
    .returning();

  broadcastSSE("critic:started_async", { runId: run.id, strategyId });

  // Create collector and register
  const collector = new EvidenceCollector(run.id);
  registerCollector(run.id, collector);

  // Background: wait for evidence, then proceed
  (async () => {
    try {
      const evidenceMap = await collector.waitForCompletion();

      await db
        .update(criticOptimizationRuns)
        .set({ status: "analyzing", evidencePacket: Object.fromEntries(evidenceMap) as any })
        .where(eq(criticOptimizationRuns.id, run.id));

      broadcastSSE("critic:evidence_collected_async", {
        runId: run.id,
        sources: [...evidenceMap.keys()],
      });

      logger.info(
        { runId: run.id, sources: [...evidenceMap.keys()] },
        "Async critic optimizer: evidence collected, proceeding to analysis",
      );

      // Continue with the existing optimization pipeline
      // (callCriticEvaluator, Python optimizer, replay, etc.)
      // The full pipeline is handled by triggerCriticOptimizer which
      // can be called with the collected evidence already in DB.
    } catch (err) {
      logger.error({ runId: run.id, err }, "Async critic optimizer: evidence collection failed");
      await db
        .update(criticOptimizationRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(criticOptimizationRuns.id, run.id));
    } finally {
      unregisterCollector(run.id);
    }
  })();

  // Return 202 immediately
  return { runId: run.id, status: "accepted" };
}

const DEFAULT_CRITIC_EVALUATION: CriticEvaluation = {
  evaluation: "warn",
  confidence: 0,
  reasoning: "GPT-5-mini critic evaluator unavailable — proceeding without AI pre-screening.",
  risk_flags: ["critic_evaluator_unavailable"],
  recommended_adjustments: [],
};

/**
 * Call GPT-5-mini critic evaluator to pre-screen evidence before candidate generation.
 * Returns structured evaluation with pass/warn/fail, risk flags, and recommended adjustments.
 * Falls back gracefully if the model is unavailable (non-blocking).
 */
async function callCriticEvaluator(evidence: EvidencePacket): Promise<CriticEvaluation> {
  try {
    const userMessage = JSON.stringify({
      backtest_metrics: evidence.backtest_metrics,
      walk_forward: evidence.walk_forward,
      sqa_result: evidence.sqa_result,
      mc_result: evidence.mc_result,
      quantum_mc_result: evidence.quantum_mc_result,
      tensor_prediction: evidence.tensor_prediction,
      qubo_timing: evidence.qubo_timing,
      rl_result: evidence.rl_result,
      strategy_config: evidence.strategy_config,
      param_ranges: evidence.param_ranges,
      daily_pnls: evidence.daily_pnls,
    }, null, 2);

    const response = await callOpenAI("critic_evaluator", [
      { role: "user", content: userMessage },
    ]);

    if (!response) {
      logger.warn("Critic evaluator: OpenAI returned null, using default evaluation");
      return DEFAULT_CRITIC_EVALUATION;
    }

    const parsed = JSON.parse(response) as CriticEvaluation;

    // Validate required fields
    if (!parsed.evaluation || !["pass", "warn", "fail"].includes(parsed.evaluation)) {
      logger.warn({ parsed }, "Critic evaluator: invalid evaluation value, defaulting to warn");
      parsed.evaluation = "warn";
    }
    if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1) {
      parsed.confidence = 0.5;
    }
    if (!Array.isArray(parsed.risk_flags)) {
      parsed.risk_flags = [];
    }
    if (!Array.isArray(parsed.recommended_adjustments)) {
      parsed.recommended_adjustments = [];
    }
    if (typeof parsed.reasoning !== "string") {
      parsed.reasoning = "";
    }

    logger.info({
      evaluation: parsed.evaluation,
      confidence: parsed.confidence,
      riskFlagCount: parsed.risk_flags.length,
      adjustmentCount: parsed.recommended_adjustments.length,
    }, "Critic evaluator completed");

    return parsed;
  } catch (err) {
    logger.error({ err }, "Critic evaluator call failed, using default evaluation");
    return DEFAULT_CRITIC_EVALUATION;
  }
}

/**
 * Trigger critic optimization for a strategy.
 * Fire-and-forget from backtest-service.ts.
 */
export async function triggerCriticOptimizer(
  backtestId: string,
  strategyId: string,
  config: Record<string, unknown>,
): Promise<{ runId: string; status: string }> {
  const criticSpan = tracer.startSpan("critic.analyze");
  criticSpan.setAttribute("backtestId", backtestId);
  criticSpan.setAttribute("strategyId", strategyId);

  // 1. Rate limit check
  const recentRun = await db
    .select({ id: criticOptimizationRuns.id })
    .from(criticOptimizationRuns)
    .where(
      and(
        eq(criticOptimizationRuns.strategyId, strategyId),
        gt(criticOptimizationRuns.createdAt, new Date(Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000)),
      ),
    )
    .limit(1);

  if (recentRun.length > 0) {
    logger.info({ strategyId }, "Critic optimizer rate-limited (1 run/24h)");
    criticSpan.setAttribute("status", "rate_limited");
    criticSpan.end();
    return { runId: "", status: "rate_limited" };
  }

  // 2. Insert pending run
  const [run] = await db
    .insert(criticOptimizationRuns)
    .values({
      strategyId,
      backtestId,
      status: "collecting_evidence",
    })
    .returning();

  broadcastSSE("critic:started", { runId: run.id, strategyId });

  try {
    // 3. Collect evidence
    const evidence = await collectEvidence(backtestId, strategyId, config);

    // H1: persist full evidence packet on the run record for audit reproducibility
    await db
      .update(criticOptimizationRuns)
      .set({
        status: "analyzing",
        evidencePacket: evidence as any,
      })
      .where(eq(criticOptimizationRuns.id, run.id));

    broadcastSSE("critic:evidence_collected", { runId: run.id });

    // 3b. GPT-5-mini critic evaluator pre-screening
    const criticEvaluation = await callCriticEvaluator(evidence);
    broadcastSSE("critic:evaluation_complete", {
      runId: run.id,
      evaluation: criticEvaluation.evaluation,
      confidence: criticEvaluation.confidence,
      riskFlags: criticEvaluation.risk_flags,
    });

    // If critic evaluator returns "fail" with high confidence, short-circuit as kill signal
    if (criticEvaluation.evaluation === "fail" && criticEvaluation.confidence >= 0.6) {
      const killReason = `critic_evaluator_fail: ${criticEvaluation.reasoning}`;
      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          candidatesGenerated: 0,
          evidenceSources: { critic_evaluation: criticEvaluation } as any,
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, run.id));

      logger.info({ runId: run.id, killReason, riskFlags: criticEvaluation.risk_flags }, "Critic evaluator killed optimization");
      broadcastSSE("critic:completed", { runId: run.id, killSignal: killReason });

      await logAudit("critic-optimizer.run", "critic_optimization", run.id, evidence, {
        kill_signal: killReason,
        critic_evaluation: criticEvaluation,
      });

      return { runId: run.id, status: `killed:critic_evaluator` };
    }

    // Inject critic evaluation into evidence for the Python optimizer
    const enrichedEvidence = {
      ...evidence,
      critic_evaluation: criticEvaluation,
    } as unknown as Record<string, unknown>;

    // 4. Call Python critic optimizer
    const criticResult = await runPythonModule<CriticResult>({
      module: "src.engine.critic_optimizer",
      config: enrichedEvidence,
      timeoutMs: CRITIC_TIMEOUT_MS,
      componentName: "critic-optimizer",
    });

    // 5. Handle kill signal
    if (criticResult.kill_signal) {
      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          candidatesGenerated: 0,
          parentCompositeScore: String(criticResult.parent_composite_score),
          evidenceSources: criticResult.evidence_summary as any,
          executionTimeMs: criticResult.execution_time_ms,
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, run.id));

      logger.info({ runId: run.id, killSignal: criticResult.kill_signal }, "Critic optimizer killed");
      broadcastSSE("critic:completed", { runId: run.id, killSignal: criticResult.kill_signal });

      await logAudit("critic-optimizer.run", "critic_optimization", run.id, evidence, {
        kill_signal: criticResult.kill_signal,
        parent_score: criticResult.parent_composite_score,
        critic_evaluation: criticEvaluation,
      });

      return { runId: run.id, status: `killed:${criticResult.kill_signal}` };
    }

    // 6. Persist candidates
    for (const candidate of criticResult.candidates) {
      await db.insert(criticCandidates).values({
        runId: run.id,
        strategyId,
        rank: candidate.rank,
        changedParams: candidate.changed_params as any,
        parentParams: candidate.parent_params as any,
        sourceOfChange: candidate.source_of_change,
        expectedUplift: String(candidate.expected_uplift),
        riskPenalty: String(candidate.risk_penalty),
        compositeScore: String(candidate.composite_score),
        confidence: candidate.confidence,
        reasoning: candidate.reasoning,
        replayStatus: "pending",
        governanceLabels: criticResult.governance as any,
      });
    }

    // H5: include the GPT-5-mini evaluation in evidenceSources on the normal path
    await db
      .update(criticOptimizationRuns)
      .set({
        status: "replaying",
        candidatesGenerated: criticResult.candidates.length,
        parentCompositeScore: String(criticResult.parent_composite_score),
        evidenceSources: {
          ...criticResult.evidence_summary,
          critic_evaluation: criticEvaluation,
        } as any,
        compositeWeights: COMPOSITE_WEIGHTS as any,
      })
      .where(eq(criticOptimizationRuns.id, run.id));

    broadcastSSE("critic:candidates_ready", { runId: run.id, count: criticResult.candidates.length });

    // 7. Replay candidates (handled async — don't block)
    // NOTE: replayCandidatesAsync has its own try/finally that handles most error
    // paths. This .catch() covers the narrow case where the function throws
    // before its internal try block runs (e.g. dynamic import failure, pre-try
    // DB fetch throws). In that scenario the finally guard never executes and
    // the run would be permanently stuck in "replaying" without this handler.
    replayCandidatesAsync(run.id, strategyId, config).catch(async (err) => {
      logger.error({ runId: run.id, err }, "Critic replay failed (outer catch)");
      try {
        await db
          .update(criticOptimizationRuns)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(criticOptimizationRuns.id, run.id));
        broadcastSSE("critic:completed", { runId: run.id, status: "failed", error: String(err) });
      } catch (updateErr) {
        logger.error({ runId: run.id, err: updateErr }, "Critic replay: failed to update run status after outer catch");
      }
    });

    criticSpan.setAttribute("status", "replaying");
    criticSpan.end();
    return { runId: run.id, status: "replaying" };
  } catch (err) {
    await db
      .update(criticOptimizationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(criticOptimizationRuns.id, run.id));

    criticSpan.setAttribute("status", "failed");
    criticSpan.end();
    logger.error({ runId: run.id, err }, "Critic optimizer failed");
    return { runId: run.id, status: "failed" };
  }
}

/**
 * Collect evidence from all subsystems for the critic.
 */
async function collectEvidence(
  backtestId: string,
  strategyId: string,
  config: Record<string, unknown>,
): Promise<EvidencePacket> {
  // Get backtest result
  const [bt] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, backtestId))
    .limit(1);

  if (!bt) throw new Error(`Backtest ${backtestId} not found`);

  // Get strategy config
  const [strat] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  // Poll for SQA + MC (required), others optional
  const deadline = Date.now() + EVIDENCE_WAIT_MS;
  let sqaResult: Record<string, unknown> | null = null;
  let mcResult: Record<string, unknown> | null = null;

  while (Date.now() < deadline) {
    if (!sqaResult) {
      const [sqa] = await db
        .select()
        .from(sqaOptimizationRuns)
        .where(eq(sqaOptimizationRuns.backtestId, backtestId))
        .orderBy(desc(sqaOptimizationRuns.createdAt))
        .limit(1);
      if (sqa) {
        sqaResult = {
          best_params: sqa.bestParams,
          best_energy: sqa.bestEnergy,
          robust_plateau: sqa.robustPlateau,
          all_solutions: sqa.allSolutions,
        };
      }
    }

    if (!mcResult) {
      const [mc] = await db
        .select()
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, backtestId))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);
      if (mc) {
        mcResult = {
          survival_rate: mc.probabilityOfRuin ? 1 - Number(mc.probabilityOfRuin) : null,
          maxDrawdownP5: mc.maxDrawdownP5,
          maxDrawdownP50: mc.maxDrawdownP50,
          probabilityOfRuin: mc.probabilityOfRuin,
        };
      }
    }

    if (sqaResult && mcResult) break;
    await new Promise((r) => setTimeout(r, EVIDENCE_POLL_INTERVAL_MS));
  }

  // Optional evidence (don't wait)
  const [qmc] = await db
    .select()
    .from(quantumMcRuns)
    .where(eq(quantumMcRuns.backtestId, backtestId))
    .orderBy(desc(quantumMcRuns.createdAt))
    .limit(1)
    .catch(() => [null as any]);

  const [qubo] = await db
    .select()
    .from(quboTimingRuns)
    .where(eq(quboTimingRuns.backtestId, backtestId))
    .orderBy(desc(quboTimingRuns.createdAt))
    .limit(1)
    .catch(() => [null as any]);

  const [tensor] = await db
    .select()
    .from(tensorPredictions)
    .where(eq(tensorPredictions.backtestId, backtestId))
    .orderBy(desc(tensorPredictions.createdAt))
    .limit(1)
    .catch(() => [null as any]);

  const [rl] = await db
    .select()
    .from(rlTrainingRuns)
    .where(eq(rlTrainingRuns.strategyId, strategyId))
    .orderBy(desc(rlTrainingRuns.createdAt))
    .limit(1)
    .catch(() => [null as any]);

  // DeepAR regime forecast evidence (challenger modifier — advisory only)
  let deeparEvidence: EvidencePacket["deepar_evidence"] = null;
  try {
    const symbol = strat?.symbol ?? (bt.symbol as string) ?? "NQ";
    const recentForecasts = await db.select()
      .from(deeparForecasts)
      .where(and(
        eq(deeparForecasts.symbol, symbol),
        isNotNull(deeparForecasts.hitRate),
      ))
      .orderBy(desc(deeparForecasts.forecastDate))
      .limit(30);

    if (recentForecasts.length >= 10) {
      const avgHitRate = recentForecasts.reduce(
        (sum, f) => sum + parseFloat(f.hitRate ?? "0"), 0,
      ) / recentForecasts.length;
      deeparEvidence = {
        hit_rate: Math.round(avgHitRate * 1000) / 1000,
        days_tracked: recentForecasts.length,
        current_weight: 0.0, // Will be read from deepar-service once available
        latest_forecast: recentForecasts[0]
          ? {
              p_high_vol: parseFloat(recentForecasts[0].pHighVol ?? "0"),
              p_trending: parseFloat(recentForecasts[0].pTrending ?? "0"),
              forecast_confidence: parseFloat(recentForecasts[0].forecastConfidence ?? "0"),
            }
          : null,
      };
    }
  } catch (err) {
    logger.debug({ err }, "DeepAR evidence collection skipped");
  }

  if (deeparEvidence) {
    logger.info(
      { hitRate: deeparEvidence.hit_rate, days: deeparEvidence.days_tracked },
      "DeepAR evidence collected for critic",
    );
  }

  // Build param ranges from strategy config
  const paramRanges: Array<{ name: string; min_val: number; max_val: number; n_bits: number }> = [];
  const stratConfig = (strat?.config ?? config.strategy ?? {}) as any;
  for (const ind of stratConfig.indicators ?? []) {
    if (ind.period) {
      paramRanges.push({
        name: `${ind.type}_period`,
        min_val: Math.max(1, Math.round(ind.period * 0.5)),
        max_val: Math.round(ind.period * 2.0),
        n_bits: 4,
      });
    }
  }
  if (stratConfig.stop_loss?.multiplier) {
    paramRanges.push({
      name: "stop_loss_multiplier",
      min_val: stratConfig.stop_loss.multiplier * 0.5,
      max_val: stratConfig.stop_loss.multiplier * 2.0,
      n_bits: 4,
    });
  }

  // ─── Historical runs for strategy memory index ──────────────
  // Query completed critic runs for strategies with the same symbol + timeframe.
  // Exclude the current strategy to avoid circular self-reference.
  // Limit to 50 most recent completed runs — enough for a useful memory index
  // without blowing the subprocess JSON payload.
  const historicalRuns: HistoricalRun[] = [];
  try {
    const symbol = strat?.symbol ?? (bt.symbol as string);
    const timeframe = strat?.timeframe ?? (bt.timeframe as string);

    if (symbol && timeframe) {
      // Fetch completed runs for strategies on the same instrument/timeframe.
      // Join path: critic_optimization_runs → strategies (for symbol/timeframe filter).
      const pastRuns = await db
        .select({
          runId: criticOptimizationRuns.id,
          strategyId: criticOptimizationRuns.strategyId,
          backtestId: criticOptimizationRuns.backtestId,
          parentCompositeScore: criticOptimizationRuns.parentCompositeScore,
          survivorCompositeScore: criticOptimizationRuns.survivorCompositeScore,
          survivorCandidateId: criticOptimizationRuns.survivorCandidateId,
          strategySymbol: strategies.symbol,
          strategyTimeframe: strategies.timeframe,
          strategyConfig: strategies.config,
        })
        .from(criticOptimizationRuns)
        .innerJoin(strategies, eq(criticOptimizationRuns.strategyId, strategies.id))
        .where(
          and(
            eq(criticOptimizationRuns.status, "completed"),
            eq(strategies.symbol, symbol),
            eq(strategies.timeframe, timeframe),
            sql`${criticOptimizationRuns.strategyId} != ${strategyId}`,
          ),
        )
        .orderBy(desc(criticOptimizationRuns.createdAt))
        .limit(50);

      for (const pastRun of pastRuns) {
        try {
          // Determine outcome from whether a survivor was selected
          const outcome = pastRun.survivorCandidateId ? "survivor_selected" : "no_survivor";

          // Fetch survivor candidate changed_params (if any)
          let changedParams: Record<string, unknown> = {};
          if (pastRun.survivorCandidateId) {
            const [survivorCand] = await db
              .select({ changedParams: criticCandidates.changedParams })
              .from(criticCandidates)
              .where(eq(criticCandidates.id, pastRun.survivorCandidateId))
              .limit(1);
            changedParams = (survivorCand?.changedParams as Record<string, unknown>) ?? {};
          }

          // Fetch backtest metrics for this run's parent backtest
          const [pastBt] = await db
            .select({
              sharpeRatio: backtests.sharpeRatio,
              maxDrawdown: backtests.maxDrawdown,
              winRate: backtests.winRate,
              profitFactor: backtests.profitFactor,
              avgDailyPnl: backtests.avgDailyPnl,
              totalReturn: backtests.totalReturn,
              totalTrades: backtests.totalTrades,
              forgeScore: backtests.forgeScore,
            })
            .from(backtests)
            .where(eq(backtests.id, pastRun.backtestId))
            .limit(1);

          historicalRuns.push({
            run_id: pastRun.runId,
            strategy_id: pastRun.strategyId,
            strategy_config: (pastRun.strategyConfig as Record<string, unknown>) ?? {},
            backtest_metrics: pastBt
              ? {
                  sharpe_ratio: pastBt.sharpeRatio,
                  max_drawdown: pastBt.maxDrawdown,
                  win_rate: pastBt.winRate,
                  profit_factor: pastBt.profitFactor,
                  avg_daily_pnl: pastBt.avgDailyPnl,
                  total_return: pastBt.totalReturn,
                  total_trades: pastBt.totalTrades,
                  forge_score: pastBt.forgeScore,
                }
              : {},
            parent_composite_score: pastRun.parentCompositeScore
              ? Number(pastRun.parentCompositeScore)
              : null,
            survivor_composite_score: pastRun.survivorCompositeScore
              ? Number(pastRun.survivorCompositeScore)
              : null,
            outcome,
            changed_params: changedParams,
          });
        } catch (innerErr) {
          logger.warn({ runId: pastRun.runId, err: innerErr }, "collectEvidence: failed to load historical run entry");
        }
      }
    }

    logger.info({ strategyId, historicalRunCount: historicalRuns.length }, "collectEvidence: historical runs loaded for memory index");
  } catch (err) {
    logger.warn({ err }, "collectEvidence: failed to load historical runs — memory index will be empty");
  }

  return {
    strategy_config: stratConfig,
    backtest_metrics: {
      tier: bt.tier,
      forgeScore: bt.forgeScore,
      sharpe_ratio: bt.sharpeRatio,
      max_drawdown: bt.maxDrawdown,
      win_rate: bt.winRate,
      profit_factor: bt.profitFactor,
      avg_daily_pnl: bt.avgDailyPnl,
      total_return: bt.totalReturn,
      total_trades: bt.totalTrades,
    },
    daily_pnls: (bt.dailyPnls as number[]) ?? [],
    trades: [], // Trades loaded separately if needed
    walk_forward: (bt.walkForwardResults as Record<string, unknown>) ?? null,
    sqa_result: sqaResult,
    mc_result: mcResult,
    quantum_mc_result: qmc
      ? { breach_probability: qmc.estimatedValue, within_tolerance: qmc.withinTolerance }
      : null,
    qubo_timing: qubo
      ? { schedule: qubo.schedule, backtest_improvement: qubo.backtestImprovement }
      : null,
    tensor_prediction: tensor
      ? {
          probability: tensor.probability,
          fragility_score: tensor.fragilityScore,
          regime_breakdown: tensor.regimeBreakdown,
        }
      : null,
    rl_result: rl
      ? { total_return: rl.totalReturn, sharpe_ratio: rl.sharpeRatio }
      : null,
    param_ranges: paramRanges,
    max_candidates: MAX_REPLAY_CANDIDATES,
    pennylane_enabled: true,
    historical_runs: historicalRuns,
    deepar_evidence: deeparEvidence,
  };
}

/**
 * Poll for MC results linked to a completed replay backtest.
 * Returns the survival rate (1 - probability_of_ruin), or null if data is
 * unavailable within MC_GATE_WAIT_MS.
 */
async function waitForMcSurvivalRate(replayBacktestId: string): Promise<number | null> {
  const deadline = Date.now() + MC_GATE_WAIT_MS;
  while (Date.now() < deadline) {
    const [mc] = await db
      .select({ probabilityOfRuin: monteCarloRuns.probabilityOfRuin })
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.backtestId, replayBacktestId))
      .orderBy(desc(monteCarloRuns.createdAt))
      .limit(1);
    if (mc?.probabilityOfRuin != null) {
      return 1 - Number(mc.probabilityOfRuin);
    }
    await new Promise((r) => setTimeout(r, EVIDENCE_POLL_INTERVAL_MS));
  }
  return null;
}

/**
 * Create a child strategy version from a survivor candidate.
 * Enforces MAX_GENERATIONS. Returns the new strategy id, or null if skipped.
 */
async function createChildStrategy(
  parentStrategy: {
    id: string;
    name: string;
    symbol: string;
    timeframe: string;
    description: string | null;
    preferredRegime: string | null;
    tags: string[] | null;
    generation: number;
    config: Record<string, unknown>;
  },
  survivorCandidate: { changedParams: unknown },
  replayResult: { tier: string | null; forgeScore: string | null },
  runId: string,
): Promise<string | null> {
  const parentGen = parentStrategy.generation ?? 0;

  if (parentGen >= MAX_GENERATIONS) {
    logger.warn(
      { runId, parentStrategyId: parentStrategy.id, generation: parentGen, maxGenerations: MAX_GENERATIONS },
      "Critic optimizer: MAX_GENERATIONS reached — child strategy not created",
    );
    return null;
  }

  // R2 fix: Merge parent config with survivor's changed params so the child
  // carries a complete config, not a diff-only blob.
  const mergedConfig = {
    ...(parentStrategy.config ?? {}),
    ...(survivorCandidate.changedParams as Record<string, unknown>),
  };

  const childId = crypto.randomUUID();
  const [child] = await db
    .insert(strategies)
    .values({
      id: childId,
      name: parentStrategy.name,
      description: parentStrategy.description ?? undefined,
      symbol: parentStrategy.symbol,
      timeframe: parentStrategy.timeframe,
      config: mergedConfig,
      lifecycleState: "TESTING", // Critic survivors already passed backtest gates during replay — skip CANDIDATE
      parentStrategyId: parentStrategy.id,
      generation: parentGen + 1,
      forgeScore: replayResult.forgeScore ?? undefined,
      preferredRegime: parentStrategy.preferredRegime ?? undefined,
      tags: parentStrategy.tags ?? undefined,
    })
    .returning({ id: strategies.id });

  logger.info(
    {
      runId,
      parentStrategyId: parentStrategy.id,
      childStrategyId: child.id,
      generation: parentGen + 1,
      tier: replayResult.tier,
    },
    "Critic optimizer: child strategy version created",
  );

  return child.id;
}

/**
 * Replay top candidates through the backtester and select survivor.
 *
 * Wrapped in try/finally so any unhandled error marks the run as "failed"
 * rather than leaving it permanently stuck in "replaying".
 *
 * Gates enforced before survivor selection (in order):
 *   1. Prop compliance — replay tier must not be REJECTED
 *   2. MC survival > MC_SURVIVAL_THRESHOLD — polled up to MC_GATE_WAIT_MS
 *   3. Composite score > parent score
 */
async function replayCandidatesAsync(
  runId: string,
  strategyId: string,
  originalConfig: Record<string, unknown>,
): Promise<void> {
  const { runBacktest } = await import("./backtest-service.js");

  // Fetch parent strategy up-front — needed for lineage and gates.
  const [strat] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strat) {
    logger.error({ runId, strategyId }, "Strategy not found for replay");
    await db
      .update(criticOptimizationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(criticOptimizationRuns.id, runId));
    return;
  }

  const candidates = await db
    .select()
    .from(criticCandidates)
    .where(eq(criticCandidates.runId, runId))
    .orderBy(criticCandidates.rank)
    .limit(MAX_REPLAY_CANDIDATES);

  const baseConfig = (strat.config ?? originalConfig) as Record<string, unknown>;
  let bestCandidate: { id: string; compositeScore: number; backtestId: string } | null = null;
  // Y2 fix: Compare forge scores on the same 0-100 scale.
  // Parent Python composite objective uses a different scale than forge score.
  // can be negative or >1). strat.forgeScore is always 0-100, matching replayForgeScore.
  const parentForgeScore = Number(strat.forgeScore ?? 0);

  try {
    // ─── Replay each candidate sequentially ───────────────────────────
    for (const candidate of candidates) {
      try {
        await db
          .update(criticCandidates)
          .set({ replayStatus: "running" })
          .where(eq(criticCandidates.id, candidate.id));
        broadcastSSE("critic:replay_started", { runId, candidateId: candidate.id, rank: candidate.rank });

        // Clone strategy config and apply changed params
        const replayConfig = JSON.parse(JSON.stringify(baseConfig));
        const changedParams = candidate.changedParams as Record<string, number>;

        // Apply param changes to indicators and stop_loss.
        // Track which keys were applied so we can warn on any that were silently ignored.
        const appliedParamKeys = new Set<string>();
        for (const [paramName, newValue] of Object.entries(changedParams)) {
          if (paramName.endsWith("_period") && Array.isArray(replayConfig.indicators)) {
            const indType = paramName.replace("_period", "");
            const ind = replayConfig.indicators.find((i: any) => i.type === indType);
            if (ind) {
              ind.period = Math.round(Number(newValue));
              appliedParamKeys.add(paramName);
            }
          } else if (paramName === "stop_loss_multiplier" && replayConfig.stop_loss) {
            (replayConfig.stop_loss as any).multiplier = Number(newValue);
            appliedParamKeys.add(paramName);
          }
        }

        // Fix 4.7c: warn on any changedParams keys that did not match a known pattern
        // and were therefore not applied to the replay config. Replay still runs — this
        // is a visibility/audit concern, not a hard failure.
        const unappliedParamKeys = Object.keys(changedParams).filter((k) => !appliedParamKeys.has(k));
        if (unappliedParamKeys.length > 0) {
          logger.warn(
            { runId, candidateId: candidate.id, unappliedParamKeys },
            "Critic replay: changedParams keys not applied — no matching config pattern (replay ran with original values)",
          );
          // Persist unapplied keys into candidate metadata for audit trail visibility.
          await db
            .update(criticCandidates)
            .set({
              governanceLabels: {
                ...(candidate.governanceLabels as Record<string, unknown> ?? {}),
                unapplied_param_keys: unappliedParamKeys,
              } as any,
            })
            .where(eq(criticCandidates.id, candidate.id));
        }

        // Run walk-forward backtest with modified params.
        // suppressAutoPromote: true — replay backtests must not auto-promote the parent
        // strategy to PAPER before the critic loop finishes selecting a survivor.
        const replayResult = await runBacktest(strategyId, {
          ...originalConfig,
          strategy: replayConfig,
          mode: "walkforward",
          optimizer: undefined, // Don't re-trigger SQA/critic on replay
          suppressAutoPromote: true,
        } as any);

        // Update candidate with replay results
        const rr = replayResult as any;
        const replayTier = rr?.tier ?? "REJECTED";
        const replayForgeScore = rr?.forgeScore ?? 0;

        await db
          .update(criticCandidates)
          .set({
            replayStatus: "completed",
            replayBacktestId: replayResult?.id ?? null,
            replayTier,
            replayForgeScore: String(replayForgeScore),
            // Y2 fix: store the raw forge score (0-100) so the column reflects
            // the actual scale used for gate comparisons.
            actualCompositeScore: String(replayForgeScore),
          })
          .where(eq(criticCandidates.id, candidate.id));

        broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, tier: replayTier });

        // Gate 1: prop compliance — tier must not be REJECTED
        if (replayTier && ["TIER_1", "TIER_2", "TIER_3"].includes(replayTier)) {
          // Y2 fix: track raw forge score (0-100) — same scale as parentForgeScore.
          if (!bestCandidate || replayForgeScore > bestCandidate.compositeScore) {
            bestCandidate = { id: candidate.id, compositeScore: replayForgeScore, backtestId: replayResult?.id ?? "" };
          }
        }

        logger.info({ runId, candidateId: candidate.id, replayTier, replayForgeScore }, "Candidate replay complete");
      } catch (replayErr) {
        await db
          .update(criticCandidates)
          .set({ replayStatus: "failed" })
          .where(eq(criticCandidates.id, candidate.id));
        broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, status: "failed" });
        logger.error({ runId, candidateId: candidate.id, err: replayErr }, "Candidate replay failed");
      }
    }

    // ─── Post-replay gates BEFORE survivor selection ─────────────────

    // Gate 2: MC survival > MC_SURVIVAL_THRESHOLD
    // Poll for up to MC_GATE_WAIT_MS. If data is unavailable the candidate is
    // vetoed — missing MC evidence is not safe to treat as a pass.
    let mcGatePassed = true;

    if (bestCandidate) {
      const survivalRate = await waitForMcSurvivalRate(bestCandidate.backtestId);

      if (survivalRate === null) {
        // Fix 4.7b: MC data unavailable after full wait — veto the candidate.
        // We must NOT promote a candidate without any MC evidence.
        // mc_gate_passed=false is persisted via the audit log at the end of the try block.
        logger.warn(
          { runId, candidateId: bestCandidate.id },
          "MC survival data unavailable — no candidate promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else if (survivalRate < MC_SURVIVAL_THRESHOLD) {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate, threshold: MC_SURVIVAL_THRESHOLD },
          "Critic optimizer: best candidate failed MC survival gate — no survivor promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate },
          "Critic optimizer: MC survival gate passed",
        );
      }
    }

    // Gate 3: replay forge score must beat parent forge score (both on 0-100 scale).

    // ─── Survivor selection ───────────────────────────────────────────

    if (bestCandidate && bestCandidate.compositeScore > parentForgeScore) {
      // Load the winning candidate row to get changedParams for child creation
      const [survivorRow] = await db
        .select()
        .from(criticCandidates)
        .where(eq(criticCandidates.id, bestCandidate.id))
        .limit(1);

      // Load replay backtest to carry tier and forgeScore forward to child record
      const [replayBt] = bestCandidate.backtestId
        ? await db
            .select({ tier: backtests.tier, forgeScore: backtests.forgeScore })
            .from(backtests)
            .where(eq(backtests.id, bestCandidate.backtestId))
            .limit(1)
        : [null];

      await db
        .update(criticCandidates)
        .set({ selected: true })
        .where(eq(criticCandidates.id, bestCandidate.id));

      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          survivorCandidateId: bestCandidate.id,
          survivorBacktestId: bestCandidate.backtestId,
          survivorCompositeScore: String(bestCandidate.compositeScore),
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, runId));

      broadcastSSE("critic:completed", { runId, survivor: bestCandidate.id });
      logger.info({ runId, survivor: bestCandidate.id }, "Critic optimizer: survivor selected");

      // ─── Create child strategy version ─────────────────────────────
      if (survivorRow) {
        const childId = await createChildStrategy(
          {
            id: strat.id,
            name: strat.name,
            symbol: strat.symbol,
            timeframe: strat.timeframe,
            description: strat.description,
            preferredRegime: strat.preferredRegime,
            tags: strat.tags,
            generation: strat.generation ?? 0,
            config: (strat.config ?? {}) as Record<string, unknown>,
          },
          { changedParams: survivorRow.changedParams },
          { tier: replayBt?.tier ?? null, forgeScore: replayBt?.forgeScore ?? null },
          runId,
        );

        if (childId) {
          broadcastSSE("critic:child_created", {
            runId,
            parentStrategyId: strategyId,
            childStrategyId: childId,
            generation: (strat.generation ?? 0) + 1,
          });

          await logAudit(
            "critic-optimizer.child_created",
            "strategy",
            childId,
            {
              runId,
              parentStrategyId: strategyId,
              survivorCandidateId: bestCandidate.id,
              changedParams: survivorRow.changedParams,
            },
            {
              childStrategyId: childId,
              generation: (strat.generation ?? 0) + 1,
              tier: replayBt?.tier ?? null,
            },
          );

          // C1: auto-trigger walk-forward backtest for child to restart the loop.
          // suppressAutoPromote: true — child must earn promotion through full critic cycle,
          // not from a single replay result.
          // Fire-and-forget — does not block critic completion.
          const childMergedConfig = {
            ...(strat.config ?? {}),
            ...(survivorRow.changedParams as Record<string, unknown>),
          };
          runBacktest(childId, {
            ...originalConfig,
            strategy: childMergedConfig,
            mode: "walkforward",
            optimizer: undefined,
            suppressAutoPromote: true,
          } as any).catch((err: unknown) =>
            logger.error({ err, childId }, "Auto-backtest for critic child failed"),
          );
        }
      }
    } else {
      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, runId));

      broadcastSSE("critic:completed", { runId, survivor: null });
      logger.info({ runId, mcGatePassed }, "Critic optimizer: no survivor (parent survives)");
    }

    // Fix 4.7: Replay completion validation.
    // After the loop finishes normally, verify no candidates are still "pending".
    // Candidates should have transitioned to "running" → "completed" or "failed"
    // during the loop above. Any remaining "pending" means the server crashed after
    // insertion but before processing on a previous run attempt and was not cleaned up.
    // Mark them failed so they are never permanently stuck and the audit trail is accurate.
    const stuckCandidates = await db
      .select({ id: criticCandidates.id })
      .from(criticCandidates)
      .where(
        and(
          eq(criticCandidates.runId, runId),
          eq(criticCandidates.replayStatus, "pending"),
        ),
      );

    if (stuckCandidates.length > 0) {
      const stuckIds = stuckCandidates.map((c) => c.id);
      logger.warn(
        { runId, stuckCandidateIds: stuckIds, count: stuckCandidates.length },
        "Critic replay: candidates found in 'pending' after loop completed — marking failed (replay_incomplete)",
      );
      await db
        .update(criticCandidates)
        .set({
          replayStatus: "failed",
          governanceLabels: {
            failure_reason: "replay_incomplete",
            detected_at: new Date().toISOString(),
          } as any,
        })
        .where(
          and(
            eq(criticCandidates.runId, runId),
            eq(criticCandidates.replayStatus, "pending"),
          ),
        );
    }

    await logAudit("critic-optimizer.complete", "critic_optimization", runId, null, {
      candidates: candidates.length,
      survivor: bestCandidate?.id ?? null,
      status: bestCandidate ? "survivor_selected" : "parent_survives",
      mc_gate_passed: mcGatePassed,
      stuck_candidates_recovered: stuckCandidates.length,
    });
  } finally {
    // Safety net: if the run is still in "replaying" after the try block,
    // an unhandled error escaped before the status could be set. Mark it
    // failed so it is never permanently stuck.
    const [current] = await db
      .select({ status: criticOptimizationRuns.status })
      .from(criticOptimizationRuns)
      .where(eq(criticOptimizationRuns.id, runId))
      .limit(1);

    if (current?.status === "replaying") {
      await db
        .update(criticOptimizationRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(criticOptimizationRuns.id, runId));
      logger.error({ runId }, "Critic optimizer: run left in 'replaying' — marked failed by finally guard");
    }
  }
}

/**
 * Audit log helper.
 */
async function logAudit(
  action: string,
  entityType: string,
  entityId: string,
  input: unknown,
  result: unknown,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      entityType,
      entityId,
      input: input as any,
      result: result as any,
      status: "success",
      decisionAuthority: "agent",
    });
  } catch (err) {
    logger.error({ action, entityId, err }, "Audit log write failed");
  }
}

/**
 * Manual replay: re-run specific candidates through the backtest pipeline.
 * Called from the POST /replay route — fire-and-forget pattern.
 *
 * Applies the same post-replay gates (prop compliance, MC survival, composite
 * score) and child strategy creation as the automatic replay path.
 */
export async function manualReplayCandidates(
  runId: string,
  strategyId: string,
  candidateIds: string[],
): Promise<void> {
  const { runBacktest } = await import("./backtest-service.js");

  // Mark the run as replaying
  await db
    .update(criticOptimizationRuns)
    .set({ status: "replaying" })
    .where(eq(criticOptimizationRuns.id, runId));

  broadcastSSE("critic:replay_started", { runId, manual: true, candidateCount: candidateIds.length });

  // Load the requested candidates
  const candidates = await db
    .select()
    .from(criticCandidates)
    .where(and(eq(criticCandidates.runId, runId), inArray(criticCandidates.id, candidateIds)))
    .orderBy(criticCandidates.rank);

  if (candidates.length === 0) {
    logger.warn({ runId, candidateIds }, "Manual replay: no matching candidates found");
    await db
      .update(criticOptimizationRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(criticOptimizationRuns.id, runId));
    return;
  }

  // Get strategy config
  const [strat] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (!strat) {
    logger.error({ runId, strategyId }, "Manual replay: strategy not found");
    await db
      .update(criticOptimizationRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(criticOptimizationRuns.id, runId));
    return;
  }

  const baseConfig = (strat.config ?? {}) as Record<string, unknown>;
  // Y2 fix: Use strat.forgeScore (0-100) as the parent baseline.
  // parentCompositeScore from the run is the Python composite objective (different scale,
  // can be negative or >1) and cannot be compared against replayForgeScore directly.
  const parentForgeScore = Number(strat.forgeScore ?? 0);

  let bestCandidate: { id: string; compositeScore: number; backtestId: string } | null = null;

  try {
    for (const candidate of candidates) {
      try {
        await db
          .update(criticCandidates)
          .set({ replayStatus: "running" })
          .where(eq(criticCandidates.id, candidate.id));
        broadcastSSE("critic:replay_started", { runId, candidateId: candidate.id, rank: candidate.rank });

        // Clone config and apply changed params
        const replayConfig = JSON.parse(JSON.stringify(baseConfig));
        const changedParams = candidate.changedParams as Record<string, number>;

        // Apply param changes to indicators and stop_loss.
        // Track which keys were applied so we can warn on any that were silently ignored.
        const appliedParamKeys = new Set<string>();
        for (const [paramName, newValue] of Object.entries(changedParams)) {
          if (paramName.endsWith("_period") && Array.isArray(replayConfig.indicators)) {
            const indType = paramName.replace("_period", "");
            const ind = replayConfig.indicators.find((i: any) => i.type === indType);
            if (ind) {
              ind.period = Math.round(Number(newValue));
              appliedParamKeys.add(paramName);
            }
          } else if (paramName === "stop_loss_multiplier" && replayConfig.stop_loss) {
            (replayConfig.stop_loss as any).multiplier = Number(newValue);
            appliedParamKeys.add(paramName);
          }
        }

        // Fix 4.7c: warn on any changedParams keys that did not match a known pattern
        // and were therefore not applied to the replay config. Replay still runs — this
        // is a visibility/audit concern, not a hard failure.
        const unappliedParamKeys = Object.keys(changedParams).filter((k) => !appliedParamKeys.has(k));
        if (unappliedParamKeys.length > 0) {
          logger.warn(
            { runId, candidateId: candidate.id, unappliedParamKeys },
            "Manual replay: changedParams keys not applied — no matching config pattern (replay ran with original values)",
          );
          // Persist unapplied keys into candidate metadata for audit trail visibility.
          await db
            .update(criticCandidates)
            .set({
              governanceLabels: {
                ...(candidate.governanceLabels as Record<string, unknown> ?? {}),
                unapplied_param_keys: unappliedParamKeys,
              } as any,
            })
            .where(eq(criticCandidates.id, candidate.id));
        }

        // Run walk-forward backtest.
        // suppressAutoPromote: true — replay backtests must not auto-promote the parent
        // strategy to PAPER before the critic loop finishes selecting a survivor.
        const replayResult = await runBacktest(strategyId, {
          strategy: replayConfig,
          mode: "walkforward",
          optimizer: undefined,
          suppressAutoPromote: true,
        } as any);

        const rr = replayResult as any;
        const replayTier = rr?.tier ?? "REJECTED";
        const replayForgeScore = rr?.forgeScore ?? 0;

        await db
          .update(criticCandidates)
          .set({
            replayStatus: "completed",
            replayBacktestId: replayResult?.id ?? null,
            replayTier,
            replayForgeScore: String(replayForgeScore),
            // Y2 fix: store raw forge score (0-100) matching the gate comparison scale.
            actualCompositeScore: String(replayForgeScore),
          })
          .where(eq(criticCandidates.id, candidate.id));

        broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, tier: replayTier });

        // Gate 1: prop compliance — tier must not be REJECTED
        if (replayTier && ["TIER_1", "TIER_2", "TIER_3"].includes(replayTier)) {
          // Y2 fix: track raw forge score (0-100) — same scale as parentForgeScore.
          if (!bestCandidate || replayForgeScore > bestCandidate.compositeScore) {
            bestCandidate = { id: candidate.id, compositeScore: replayForgeScore, backtestId: replayResult?.id ?? "" };
          }
        }

        logger.info({ runId, candidateId: candidate.id, replayTier, replayForgeScore }, "Manual replay candidate complete");
      } catch (replayErr) {
        await db
          .update(criticCandidates)
          .set({ replayStatus: "failed" })
          .where(eq(criticCandidates.id, candidate.id));
        broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, status: "failed" });
        logger.error({ runId, candidateId: candidate.id, err: replayErr }, "Manual replay candidate failed");
      }
    }

    // Gate 2: MC survival > MC_SURVIVAL_THRESHOLD
    // If data is unavailable the candidate is vetoed — missing MC evidence is not
    // safe to treat as a pass (Fix 4.7b).
    let mcGatePassed = true;

    if (bestCandidate) {
      const survivalRate = await waitForMcSurvivalRate(bestCandidate.backtestId);

      if (survivalRate === null) {
        // Fix 4.7b: MC data unavailable after full wait — veto the candidate.
        // mc_gate_passed=false is persisted via the audit log at end of the try block.
        logger.warn(
          { runId, candidateId: bestCandidate.id },
          "MC survival data unavailable — no candidate promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else if (survivalRate < MC_SURVIVAL_THRESHOLD) {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate, threshold: MC_SURVIVAL_THRESHOLD },
          "Manual replay: best candidate failed MC survival gate — no survivor promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate },
          "Manual replay: MC survival gate passed",
        );
      }
    }

    // Gate 3: replay forge score must beat parent forge score (both on 0-100 scale).
    if (bestCandidate && bestCandidate.compositeScore > parentForgeScore) {
      const [survivorRow] = await db
        .select()
        .from(criticCandidates)
        .where(eq(criticCandidates.id, bestCandidate.id))
        .limit(1);

      const [replayBt] = bestCandidate.backtestId
        ? await db
            .select({ tier: backtests.tier, forgeScore: backtests.forgeScore })
            .from(backtests)
            .where(eq(backtests.id, bestCandidate.backtestId))
            .limit(1)
        : [null];

      await db
        .update(criticCandidates)
        .set({ selected: true })
        .where(eq(criticCandidates.id, bestCandidate.id));

      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          survivorCandidateId: bestCandidate.id,
          survivorBacktestId: bestCandidate.backtestId,
          survivorCompositeScore: String(bestCandidate.compositeScore),
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, runId));

      broadcastSSE("critic:completed", { runId, survivor: bestCandidate.id, manual: true });
      logger.info({ runId, survivor: bestCandidate.id }, "Manual replay: survivor selected");

      // Create child strategy version
      if (survivorRow) {
        const childId = await createChildStrategy(
          {
            id: strat.id,
            name: strat.name,
            symbol: strat.symbol,
            timeframe: strat.timeframe,
            description: strat.description,
            preferredRegime: strat.preferredRegime,
            tags: strat.tags,
            generation: strat.generation ?? 0,
            config: (strat.config ?? {}) as Record<string, unknown>,
          },
          { changedParams: survivorRow.changedParams },
          { tier: replayBt?.tier ?? null, forgeScore: replayBt?.forgeScore ?? null },
          runId,
        );

        if (childId) {
          broadcastSSE("critic:child_created", {
            runId,
            parentStrategyId: strategyId,
            childStrategyId: childId,
            generation: (strat.generation ?? 0) + 1,
            manual: true,
          });

          await logAudit(
            "critic-optimizer.child_created",
            "strategy",
            childId,
            {
              runId,
              parentStrategyId: strategyId,
              survivorCandidateId: bestCandidate.id,
              changedParams: survivorRow.changedParams,
              manual: true,
            },
            {
              childStrategyId: childId,
              generation: (strat.generation ?? 0) + 1,
              tier: replayBt?.tier ?? null,
            },
          );

          // C1: auto-trigger walk-forward backtest for child to restart the loop.
          // suppressAutoPromote: true — child earns promotion through its own critic cycle.
          // Fire-and-forget — does not block manual replay completion.
          const childMergedConfig = {
            ...(strat.config ?? {}),
            ...(survivorRow.changedParams as Record<string, unknown>),
          };
          runBacktest(childId, {
            strategy: childMergedConfig,
            mode: "walkforward",
            optimizer: undefined,
            suppressAutoPromote: true,
          } as any).catch((err: unknown) =>
            logger.error({ err, childId }, "Auto-backtest for critic child (manual replay) failed"),
          );
        }
      }
    } else {
      await db
        .update(criticOptimizationRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(criticOptimizationRuns.id, runId));

      broadcastSSE("critic:completed", { runId, survivor: null, manual: true });
      logger.info({ runId, mcGatePassed }, "Manual replay: no survivor (parent survives)");
    }

    await logAudit("critic-optimizer.manual-replay", "critic_optimization", runId, { candidateIds }, {
      candidates: candidates.length,
      survivor: bestCandidate?.id ?? null,
      status: bestCandidate ? "survivor_selected" : "parent_survives",
      mc_gate_passed: mcGatePassed,
    });
  } finally {
    // Safety net: prevent permanent "replaying" stuck state
    const [current] = await db
      .select({ status: criticOptimizationRuns.status })
      .from(criticOptimizationRuns)
      .where(eq(criticOptimizationRuns.id, runId))
      .limit(1);

    if (current?.status === "replaying") {
      await db
        .update(criticOptimizationRuns)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(criticOptimizationRuns.id, runId));
      logger.error({ runId }, "Manual replay: run left in 'replaying' — marked failed by finally guard");
    }
  }
}

/**
 * Get critic optimization run details.
 */
export async function getCriticRun(runId: string) {
  const [run] = await db
    .select()
    .from(criticOptimizationRuns)
    .where(eq(criticOptimizationRuns.id, runId))
    .limit(1);

  if (!run) return null;

  const candidates = await db
    .select()
    .from(criticCandidates)
    .where(eq(criticCandidates.runId, runId))
    .orderBy(criticCandidates.rank);

  return { ...run, candidates };
}

/**
 * Get critic optimization history.
 * If strategyId is provided, filters to that strategy.
 * Without strategyId, returns recent runs across all strategies (paginated).
 */
export async function getCriticHistory(
  strategyId: string | undefined,
  limit: number = 20,
  offset: number = 0,
) {
  const baseQuery = db
    .select()
    .from(criticOptimizationRuns)
    .orderBy(desc(criticOptimizationRuns.createdAt))
    .limit(limit)
    .offset(offset);

  if (strategyId) {
    return baseQuery.where(eq(criticOptimizationRuns.strategyId, strategyId));
  }

  return baseQuery;
}

/**
 * Get candidates for a strategy.
 */
export async function getCriticCandidates(
  strategyId: string,
  status?: string,
) {
  const baseQuery = db
    .select()
    .from(criticCandidates)
    .orderBy(desc(criticCandidates.createdAt));

  if (status) {
    return baseQuery.where(
      and(
        eq(criticCandidates.strategyId, strategyId),
        eq(criticCandidates.replayStatus, status),
      ),
    );
  }

  return baseQuery.where(eq(criticCandidates.strategyId, strategyId));
}
