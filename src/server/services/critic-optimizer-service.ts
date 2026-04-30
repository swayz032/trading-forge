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
 *
 * G3.1 — Replay lineage:
 * The full lineage chain is FK-enforced and traceable today:
 *   originating backtest (criticOptimizationRuns.backtestId)
 *     → critic run        (criticOptimizationRuns.id)
 *       → candidates       (criticCandidates.runId)
 *         → replay backtest (criticCandidates.replayBacktestId)
 * No separate `replay_queue` table is needed — that audit finding was based on a
 * stale snapshot. Provenance, replay status, replay tier, and replay forge score
 * all persist on criticCandidates. Survivor selection writes
 * criticOptimizationRuns.survivorBacktestId / survivorCandidateId.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
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
  alerts,
  walkForwardWindows,
} from "../db/schema.js";
import { db } from "../db/index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { callOpenAI } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { tracer } from "../lib/tracing.js";
import { getDeepARWeight } from "./deepar-service.js";
import { LifecycleService } from "./lifecycle-service.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "../../..");

// ─── Critic Evaluator System Prompt Cache (Fix 2) ────────────────────
// Loaded once at module initialisation, reused for every Ollama fallback call.
let _criticSystemPromptCache: string | null = null;
function loadCriticSystemPrompt(): string {
  if (_criticSystemPromptCache !== null) return _criticSystemPromptCache;
  try {
    _criticSystemPromptCache = readFileSync(
      resolve(PROJECT_ROOT, "src/agents/critic-evaluator.md"),
      "utf-8",
    );
  } catch {
    logger.warn("critic-optimizer: could not load critic-evaluator.md — Ollama fallback will run without system prompt");
    _criticSystemPromptCache = "";
  }
  return _criticSystemPromptCache;
}

// P2-2: critic model version stored on each candidate for audit provenance.
const CRITIC_MODEL_VERSION = process.env.CRITIC_MODEL_VERSION ?? "deepseek-r1:14b";

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
  /** Fix 3a: Decay sub-signals from backtests.decayAnalysis JSONB. */
  decay_analysis: Record<string, unknown> | null;
  /** Fix 3b: Recent drift alerts for this strategy in the last 30 days. */
  drift_alerts: Array<{ id: string; type: string; severity: string; title: string; message: string; createdAt: string }>;
  /** Fix 3c: Live rolling 30-day Sharpe from strategies table. */
  live_rolling_sharpe: number | null;
  /** P2-2: Evidence run IDs for candidate provenance — keyed by subsystem. */
  _evidence_run_ids?: {
    mc?: string[];
    sqa?: string[];
    wf?: string[];
    qmc?: string[];
    tensor?: string[];
    rl?: string[];
  };
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

// ─── Generic param application (Fix 1) ──────────────────────────────

/**
 * Apply a single changed parameter to a cloned strategy config.
 *
 * Resolution order:
 *   1. *_period suffix → indicator array match by type name (existing convention, preserved)
 *   2. "stop_loss_multiplier" → replayConfig.stop_loss.multiplier (existing convention, preserved)
 *   3. Direct top-level key match
 *   4. Dotted path: "a.b.c" → config.a.b.c
 *   5. Not found → returns false (caller must skip the entire candidate)
 *
 * Returns true if the param was applied, false if no match was found.
 */
function applyParamChange(config: Record<string, any>, paramName: string, newValue: any): boolean {
  // Convention 1: *_period → indicators array match
  if (paramName.endsWith("_period") && Array.isArray(config.indicators)) {
    const indType = paramName.replace("_period", "");
    const ind = config.indicators.find((i: any) => i.type === indType);
    if (ind) {
      ind.period = Math.round(Number(newValue));
      return true;
    }
    // Fall through to other paths — the config might have the period at top-level too
  }

  // Convention 2: stop_loss_multiplier
  if (paramName === "stop_loss_multiplier" && config.stop_loss) {
    (config.stop_loss as any).multiplier = Number(newValue);
    return true;
  }

  // Direct top-level key
  if (paramName in config) {
    config[paramName] = newValue;
    return true;
  }

  // Dotted path: "stop_loss.multiplier" → config.stop_loss.multiplier
  if (paramName.includes(".")) {
    const parts = paramName.split(".");
    let cursor: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cursor[parts[i]] === undefined || cursor[parts[i]] === null || typeof cursor[parts[i]] !== "object") {
        return false;
      }
      cursor = cursor[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (lastKey in cursor) {
      cursor[lastKey] = newValue;
      return true;
    }
  }

  return false;
}

/**
 * Apply all changedParams to a cloned config. Returns the set of keys that
 * could NOT be applied. If any key fails, the caller must skip the candidate.
 */
function applyAllParamChanges(
  replayConfig: Record<string, any>,
  changedParams: Record<string, number>,
): Set<string> {
  const unapplied = new Set<string>();
  for (const [paramName, newValue] of Object.entries(changedParams)) {
    const applied = applyParamChange(replayConfig, paramName, newValue);
    if (!applied) unapplied.add(paramName);
  }
  return unapplied;
}

// ─── Evidence Collector (Async, Event-Driven) ──────────────────────

type EvidenceSource = "sqa" | "mc" | "quantum_mc" | "qubo" | "tensor" | "rl" | "deepar";

const ALL_EVIDENCE_SOURCES: EvidenceSource[] = ["sqa", "mc", "quantum_mc", "qubo", "tensor", "rl", "deepar"];
// P2-1: MC is the only required source. SQA, QUBO, tensor, RL, quantum_mc are
// optional — the critic can proceed without them and will pass null for any
// optional source that hasn't arrived when MC completes.
const REQUIRED_SOURCES: EvidenceSource[] = ["mc"];
const OPTIONAL_SOURCES: EvidenceSource[] = ["sqa", "qubo", "tensor", "rl", "quantum_mc"];

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
  config: Record<string, unknown>,
  context?: { correlationId?: string },
): Promise<{ runId: string; status: string }> {
  const correlationId = context?.correlationId;
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

  // Background: wait for evidence then run the full optimizer pipeline.
  // NOTE: stale-pending sweeper for critic tables is owned by scheduler.ts.
  // The finally guard in replayCandidatesAsync covers runs stuck in "replaying".
  // Runs stuck in "collecting_evidence" or "analyzing" after a crash are swept
  // by the scheduler sweeper in addition to "replaying" (all three are covered).
  (async () => {
    try {
      const evidenceMap = await collector.waitForCompletion();

      broadcastSSE("critic:evidence_collected_async", {
        runId: run.id,
        sources: [...evidenceMap.keys()],
      });

      logger.info(
        { runId: run.id, sources: [...evidenceMap.keys()] },
        "Async critic optimizer: evidence collected, proceeding to analysis",
      );

      // Build full EvidencePacket from DB (same path as sync flow).
      // collectEvidence re-reads backtest + strategy rows and polls for SQA/MC.
      // Evidence already in the DB from the subsystems that called addEvidence(),
      // so the poll loop will resolve quickly.
      const evidence = await collectEvidence(backtestId, strategyId, config);

      await db
        .update(criticOptimizationRuns)
        .set({ status: "analyzing", evidencePacket: evidence as any })
        .where(eq(criticOptimizationRuns.id, run.id));

      broadcastSSE("critic:evidence_collected", { runId: run.id });

      // GPT-5-mini critic evaluator pre-screening
      const criticEvaluation = await callCriticEvaluator(evidence, correlationId);
      broadcastSSE("critic:evaluation_complete", {
        runId: run.id,
        evaluation: criticEvaluation.evaluation,
        confidence: criticEvaluation.confidence,
        riskFlags: criticEvaluation.risk_flags,
      });

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
        broadcastSSE("critic:completed", { runId: run.id, killSignal: killReason });
        await logAudit("critic-optimizer.run", "critic_optimization", run.id, evidence, {
          kill_signal: killReason,
          critic_evaluation: criticEvaluation,
        }, correlationId);
        return;
      }

      const enrichedEvidence = {
        ...evidence,
        critic_evaluation: criticEvaluation,
      } as unknown as Record<string, unknown>;

      // Call Python critic optimizer
      const criticResult = await runPythonModule<CriticResult>({
        module: "src.engine.critic_optimizer",
        config: enrichedEvidence,
        timeoutMs: CRITIC_TIMEOUT_MS,
        componentName: "critic-optimizer",
        correlationId,
      });

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
        broadcastSSE("critic:completed", { runId: run.id, killSignal: criticResult.kill_signal });
        await logAudit("critic-optimizer.run", "critic_optimization", run.id, evidence, {
          kill_signal: criticResult.kill_signal,
          parent_score: criticResult.parent_composite_score,
          critic_evaluation: criticEvaluation,
        }, correlationId);
        return;
      }

      // Persist candidates
      // P1-drift-2 defense-in-depth: even after slicing paramRanges to 5
      // (above), reject any candidate that returns >5 changed params. Belt-
      // and-suspenders so a stray combinatoric explosion or cross-source
      // merge in the Python optimizer can never persist a strategy proposal
      // that violates CLAUDE.md.
      for (const candidate of criticResult.candidates) {
        const changedKeys = Object.keys(candidate.changed_params ?? {});
        if (changedKeys.length > 5) {
          logger.warn(
            { runId: run.id, strategyId, rank: candidate.rank, changedParamCount: changedKeys.length, keys: changedKeys },
            "critic-optimizer (async): rejecting candidate — changed_params exceeds 5 (CLAUDE.md max-5-params rule)",
          );
          continue;
        }
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
          // P2-2: audit provenance
          criticModelVersion: CRITIC_MODEL_VERSION,
          evidenceRunIds: evidence._evidence_run_ids as any,
        });
      }

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
          // P1-9: persist executionTimeMs on success path. Previously only
          // recorded on the kill-signal branch — leaving normal completions
          // missing latency data and breaking duration-based observability.
          executionTimeMs: criticResult.execution_time_ms,
        })
        .where(eq(criticOptimizationRuns.id, run.id));

      broadcastSSE("critic:candidates_ready", { runId: run.id, count: criticResult.candidates.length });

      // Replay candidates — outer catch covers pre-try throws in replayCandidatesAsync
      replayCandidatesAsync(run.id, strategyId, config, correlationId).catch(async (err) => {
        logger.error({ runId: run.id, err }, "Async critic replay failed (outer catch)");
        try {
          await db
            .update(criticOptimizationRuns)
            .set({ status: "failed", completedAt: new Date() })
            .where(eq(criticOptimizationRuns.id, run.id));
          broadcastSSE("critic:completed", { runId: run.id, status: "failed", error: String(err) });
        } catch (updateErr) {
          logger.error({ runId: run.id, err: updateErr }, "Async critic replay: failed to update run status after outer catch");
        }
      });
    } catch (err) {
      logger.error({ runId: run.id, err }, "Async critic optimizer: pipeline failed");
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
 * Parse a raw LLM string response into a CriticEvaluation, normalising any
 * fields that don't conform to the expected schema.
 */
function parseCriticEvaluationResponse(raw: string): CriticEvaluation {
  const parsed = JSON.parse(raw) as CriticEvaluation;
  if (!parsed.evaluation || !["pass", "warn", "fail"].includes(parsed.evaluation)) {
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
  return parsed;
}

/**
 * Call Ollama (deepseek-r1:14b) as fallback critic evaluator.
 * Returns null on any error so the caller can fall through to DEFAULT_CRITIC_EVALUATION.
 */
async function callOllamaCriticFallback(userMessage: string): Promise<CriticEvaluation | null> {
  try {
    const systemPrompt = loadCriticSystemPrompt();
    const ollama = new OllamaClient();
    const chatResponse = await ollama.chat(
      "deepseek-r1:14b",
      [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        { role: "user" as const, content: userMessage },
      ],
      { temperature: 0.2 },
      true, // request JSON format
    );

    const raw = chatResponse.message?.content ?? "";
    if (!raw) {
      logger.warn("Critic evaluator Ollama fallback: empty response");
      return null;
    }

    // Ollama responses are more variable — extract JSON substring defensively.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ rawExcerpt: raw.slice(0, 200) }, "Critic evaluator Ollama fallback: no JSON object found in response");
      return null;
    }

    const evaluation = parseCriticEvaluationResponse(jsonMatch[0]);
    logger.info(
      { evaluation: evaluation.evaluation, confidence: evaluation.confidence, source: "ollama" },
      "Critic evaluator: Ollama fallback completed",
    );
    return evaluation;
  } catch (err) {
    logger.warn({ err }, "Critic evaluator Ollama fallback failed");
    return null;
  }
}

/**
 * Call GPT-5-mini critic evaluator to pre-screen evidence before candidate generation.
 * Fix 2: On OpenAI null/failure, tries Ollama (deepseek-r1:14b) before falling back to
 * DEFAULT_CRITIC_EVALUATION. Cloud failure no longer silently disables the gate.
 */
async function callCriticEvaluator(evidence: EvidencePacket, correlationId?: string): Promise<CriticEvaluation> {
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

  // ── Path 1: OpenAI (primary) ─────────────────────────────────────────
  try {
    const response = await callOpenAI("critic_evaluator", [
      { role: "user", content: userMessage },
    ]);

    if (response) {
      const parsed = parseCriticEvaluationResponse(response);

      logger.info({
        evaluation: parsed.evaluation,
        confidence: parsed.confidence,
        riskFlagCount: parsed.risk_flags.length,
        adjustmentCount: parsed.recommended_adjustments.length,
        source: "openai",
      }, "Critic evaluator completed");

      // F5: token spend tracking via audit_log (no new table needed)
      try {
        await db.insert(auditLog).values({
          action: "critic.llm_call",
          entityType: "critic_evaluation",
          entityId: null,
          input: { provider: "openai", model: "gpt-5-mini", tokens_input_approx: Math.ceil(userMessage.length / 4) },
          result: { tokens_output_approx: Math.ceil(response.length / 4) },
          status: "success",
          decisionAuthority: "agent",
          correlationId: correlationId ?? null,
        });
      } catch (auditErr) {
        logger.warn({ auditErr }, "Failed to write LLM token spend audit entry");
      }

      return parsed;
    }

    // callOpenAI returned null (missing API key, circuit open, empty response)
    logger.warn("Critic evaluator: OpenAI returned null — trying Ollama fallback");
  } catch (err) {
    logger.warn({ err }, "Critic evaluator: OpenAI call threw — trying Ollama fallback");
  }

  // ── Path 2: Ollama fallback (deepseek-r1:14b) ───────────────────────
  const ollamaResult = await callOllamaCriticFallback(userMessage);
  if (ollamaResult) {
    try {
      await db.insert(auditLog).values({
        action: "critic.llm_call",
        entityType: "critic_evaluation",
        entityId: null,
        input: { provider: "ollama", model: "deepseek-r1:14b", tokens_input_approx: Math.ceil(userMessage.length / 4) },
        result: { evaluation: ollamaResult.evaluation, confidence: ollamaResult.confidence },
        status: "success",
        decisionAuthority: "agent",
        correlationId: correlationId ?? null,
      });
    } catch (auditErr) {
      logger.warn({ auditErr }, "Failed to write Ollama fallback token spend audit entry");
    }
    return ollamaResult;
  }

  // ── Path 3: Both failed — return DEFAULT ────────────────────────────
  logger.error("Critic evaluator: both OpenAI and Ollama failed — pre-screening gate disabled for this run");
  return DEFAULT_CRITIC_EVALUATION;
}

/**
 * Trigger critic optimization for a strategy.
 * Fire-and-forget from backtest-service.ts.
 */
export async function triggerCriticOptimizer(
  backtestId: string,
  strategyId: string,
  config: Record<string, unknown>,
  context?: { correlationId?: string },
): Promise<{ runId: string; status: string }> {
  const correlationId = context?.correlationId;

  // P1-2: Pipeline pause gate — do not deduct rate-limit tokens when paused.
  if (!(await isPipelineActive())) {
    logger.info({ strategyId, backtestId }, "Critic optimizer skipped — pipeline paused");
    return { runId: "", status: "skipped:pipeline_paused" };
  }

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
    const criticEvaluation = await callCriticEvaluator(evidence, correlationId);
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
      }, correlationId);

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
      correlationId,
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
      }, correlationId);

      return { runId: run.id, status: `killed:${criticResult.kill_signal}` };
    }

    // 6. Persist candidates
    // P1-drift-2 defense-in-depth: reject any candidate with >5 changed params.
    // See async path above for full rationale (CLAUDE.md max-5-params rule).
    for (const candidate of criticResult.candidates) {
      const changedKeys = Object.keys(candidate.changed_params ?? {});
      if (changedKeys.length > 5) {
        logger.warn(
          { runId: run.id, strategyId, rank: candidate.rank, changedParamCount: changedKeys.length, keys: changedKeys },
          "critic-optimizer (sync): rejecting candidate — changed_params exceeds 5 (CLAUDE.md max-5-params rule)",
        );
        continue;
      }
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
        // P2-2: audit provenance
        criticModelVersion: CRITIC_MODEL_VERSION,
        evidenceRunIds: evidence._evidence_run_ids as any,
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
        // P1-9: persist executionTimeMs on sync success path (mirrors async
        // path above). Previously only the kill-signal branch recorded duration,
        // leaving normal completions invisible to latency dashboards.
        executionTimeMs: criticResult.execution_time_ms,
      })
      .where(eq(criticOptimizationRuns.id, run.id));

    broadcastSSE("critic:candidates_ready", { runId: run.id, count: criticResult.candidates.length });

    // 7. Replay candidates (handled async — don't block)
    // NOTE: replayCandidatesAsync has its own try/finally that handles most error
    // paths. This .catch() covers the narrow case where the function throws
    // before its internal try block runs (e.g. dynamic import failure, pre-try
    // DB fetch throws). In that scenario the finally guard never executes and
    // the run would be permanently stuck in "replaying" without this handler.
    replayCandidatesAsync(run.id, strategyId, config, correlationId).catch(async (err) => {
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

    // DLQ capture (C4): persist failure for inspection and optional retry
    try {
      await captureToDLQ({
        operationType: "critic:failure",
        entityType: "critic_optimization_run",
        entityId: run.id,
        errorMessage: String(err),
        metadata: { strategyId, backtestId },
      });
    } catch (dlqErr) {
      logger.error({ dlqErr }, "Failed to capture critic failure to DLQ");
    }

    broadcastSSE("critic:run-failed", {
      runId: run.id,
      strategyId,
      errorCode: "pipeline_failed",
      message: String(err),
      durationMs: Date.now() - run.createdAt.getTime(),
    });

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

  // P2-1: Poll only for MC (required). SQA is optional — collected after MC
  // arrives or when the deadline is hit, whichever comes first.
  const deadline = Date.now() + EVIDENCE_WAIT_MS;
  let sqaResult: Record<string, unknown> | null = null;
  let mcResult: Record<string, unknown> | null = null;
  // P2-2: capture run IDs for evidence provenance
  let mcRunId: string | null = null;
  let sqaRunId: string | null = null;

  while (Date.now() < deadline) {
    if (!mcResult) {
      const [mc] = await db
        .select()
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, backtestId))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);
      if (mc) {
        mcRunId = mc.id;
        // FIX 3 (B2/S4): extract breach_probability from riskMetrics JSONB if present.
        // Provides classical evidence for the Python breach_probability scoring path,
        // decoupling it from quantum MC which may not always be available.
        const mcRiskMetrics = (mc.riskMetrics as Record<string, unknown> | null) ?? null;
        const classicalBreachProb: number | null =
          mcRiskMetrics != null && typeof mcRiskMetrics.breach_probability === "number"
            ? (mcRiskMetrics.breach_probability as number)
            : null;
        mcResult = {
          survival_rate: mc.probabilityOfRuin ? 1 - Number(mc.probabilityOfRuin) : null,
          maxDrawdownP5: mc.maxDrawdownP5,
          maxDrawdownP50: mc.maxDrawdownP50,
          probabilityOfRuin: mc.probabilityOfRuin,
          breach_probability: classicalBreachProb,
        };
      }
    }

    // MC is the only required source — break as soon as it's present.
    if (mcResult) break;
    await new Promise((r) => setTimeout(r, EVIDENCE_POLL_INTERVAL_MS));
  }

  // SQA is optional — do a single best-effort read after the MC wait completes.
  // Pass null if not yet available; critic proceeds without it.
  if (!sqaResult) {
    const [sqa] = await db
      .select()
      .from(sqaOptimizationRuns)
      .where(eq(sqaOptimizationRuns.backtestId, backtestId))
      .orderBy(desc(sqaOptimizationRuns.createdAt))
      .limit(1)
      .catch(() => [null as any]);
    if (sqa) {
      sqaRunId = sqa.id;
      sqaResult = {
        best_params: sqa.bestParams,
        best_energy: sqa.bestEnergy,
        robust_plateau: sqa.robustPlateau,
        all_solutions: sqa.allSolutions,
      };
    }
  }

  // Optional evidence (don't wait) — capture row IDs for P2-2 provenance
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
        current_weight: getDeepARWeight(),
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

  // FIX 4 (B3/R1): iterate all top-level numeric keys in stratConfig.
  // Handles strategies that don't use indicators[].period or stop_loss.multiplier
  // (e.g., strategies with threshold, lookback, profit_target at the root).
  // Uses symmetric ±50% bounds as a safe default floor — Python can tighten
  // these once walk-forward or SQA data is available.
  // Skips keys already covered above (indicators is an array, stop_loss is an object).
  const ALREADY_COVERED = new Set(["indicators", "stop_loss"]);
  for (const [key, val] of Object.entries(stratConfig)) {
    if (ALREADY_COVERED.has(key)) continue;
    if (typeof val === "number" && isFinite(val) && val !== 0) {
      // Only add if not already present from indicators loop
      const alreadyPresent = paramRanges.some((p) => p.name === key);
      if (!alreadyPresent) {
        paramRanges.push({
          name: key,
          min_val: val * 0.5,
          max_val: val * 1.5,
          n_bits: 4,
        });
      }
    }
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

  // ─── Fix 3a: Decay sub-signals from backtests.decayAnalysis ──────────
  const decayAnalysis = (bt.decayAnalysis as Record<string, unknown> | null) ?? null;

  // ─── Fix 3b: Drift alerts for this strategy in last 30 days ──────────
  // The alerts table has no FK to strategies — correlate via metadata.strategyId.
  // Fail-safe: empty array on any DB error.
  type DriftAlertRow = {
    id: string;
    type: string;
    severity: string;
    title: string;
    message: string;
    createdAt: string;
  };
  let driftAlerts: DriftAlertRow[] = [];
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rawAlerts = await db
      .select({
        id: alerts.id,
        type: alerts.type,
        severity: alerts.severity,
        title: alerts.title,
        message: alerts.message,
        metadata: alerts.metadata,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(
        and(
          // FIX 2 (B1): canonical types written by alert-service.ts AlertFactory.
          // drift = live metric deviation; decay = alpha decay level change.
          // regime_change/degradation are also written by lifecycle/drift services.
          // drawdown excluded: different metadata shape, not performance-decay evidence.
          sql`${alerts.type} IN ('drift', 'decay', 'regime_change', 'degradation')`,
          gt(alerts.createdAt, cutoff),
        ),
      )
      .orderBy(desc(alerts.createdAt))
      .limit(30);

    driftAlerts = rawAlerts
      .filter((a) => {
        const meta = a.metadata as Record<string, unknown> | null;
        if (!meta) return true;
        if (meta.strategyId === strategyId) return true;
        if (meta.strategyId && meta.strategyId !== strategyId) return false;
        return true;
      })
      .map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
      }));
  } catch (err) {
    logger.warn({ err, strategyId }, "collectEvidence: failed to load drift alerts — continuing with empty array");
  }

  // ─── Fix 3c: Live rolling 30-day Sharpe from strategies table ────────
  const liveRollingSharpe: number | null = strat?.rollingSharpe30d != null
    ? Number(strat.rollingSharpe30d)
    : null;

  // ─── Fix 4: Walk-forward blob / windows-table fallback ───────────────
  // Primary: blob on backtests.walkForwardResults.
  // Fallback: reconstruct param_stability from walkForwardWindows rows.
  let walkForwardEvidence: Record<string, unknown> | null =
    (bt.walkForwardResults as Record<string, unknown> | null) ?? null;

  const blobMissingParamStability =
    !walkForwardEvidence || !("param_stability" in walkForwardEvidence);

  if (blobMissingParamStability) {
    try {
      const wfWindows = await db
        .select({
          windowIndex: walkForwardWindows.windowIndex,
          bestParams: walkForwardWindows.bestParams,
          oosMetrics: walkForwardWindows.oosMetrics,
          paramStability: walkForwardWindows.paramStability,
          confidence: walkForwardWindows.confidence,
        })
        .from(walkForwardWindows)
        .where(eq(walkForwardWindows.backtestId, backtestId))
        .orderBy(walkForwardWindows.windowIndex);

      if (wfWindows.length > 0) {
        // Reconstruct param_stability: for each parameter seen across windows,
        // compute mean, std, and range from the values in bestParams.
        const paramValues: Record<string, number[]> = {};
        for (const w of wfWindows) {
          const params = (w.bestParams as Record<string, number> | null) ?? {};
          for (const [k, v] of Object.entries(params)) {
            if (typeof v === "number") {
              if (!paramValues[k]) paramValues[k] = [];
              paramValues[k].push(v);
            }
          }
        }

        const reconstructedStability: Record<string, {
          mean: number;
          std: number;
          range: number;
          n_windows: number;
          robust_min: number;
          robust_max: number;
        }> = {};
        for (const [paramName, values] of Object.entries(paramValues)) {
          if (values.length === 0) continue;
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
          const std = Math.sqrt(variance);
          const range = Math.max(...values) - Math.min(...values);
          // FIX 5 (B5): add robust_min/robust_max so Python EvidenceAggregator.add_classical()
          // can build optuna_ranges. Without these, optuna_ranges stays empty and candidate
          // generation collapses. Use mean±std as a conservative robust interval when
          // actual per-window min/max aren't individually tracked.
          reconstructedStability[paramName] = {
            mean,
            std,
            range,
            n_windows: values.length,
            robust_min: mean - std,
            robust_max: mean + std,
          };
        }

        const windowSummary = wfWindows.map((w) => {
          const oos = (w.oosMetrics as Record<string, unknown> | null) ?? {};
          return {
            window_index: w.windowIndex,
            oos_sharpe: (oos.sharpe_ratio as number | undefined) ?? null,
            oos_win_rate: (oos.win_rate as number | undefined) ?? null,
            confidence: w.confidence ?? null,
          };
        });

        walkForwardEvidence = {
          ...(walkForwardEvidence ?? {}),
          param_stability: reconstructedStability,
          windows: windowSummary,
          _source: "reconstructed_from_wf_windows",
        };

        logger.info(
          { backtestId, windowCount: wfWindows.length, paramCount: Object.keys(reconstructedStability).length },
          "collectEvidence: walk-forward param_stability reconstructed from wf_windows table",
        );
      } else {
        logger.warn({ backtestId }, "collectEvidence: walkForwardWindows has no rows — walk_forward evidence is incomplete");
      }
    } catch (err) {
      logger.warn({ err, backtestId }, "collectEvidence: failed to query walkForwardWindows — walk_forward evidence may be incomplete");
    }
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
    walk_forward: walkForwardEvidence, // Fix 4: blob or reconstructed from wf_windows
    sqa_result: sqaResult,
    mc_result: mcResult,
    quantum_mc_result: qmc
      ? { breach_probability: qmc.estimatedValue, within_tolerance: qmc.withinTolerance }
      : null,
    qubo_timing: qubo
      ? { schedule: qubo.schedule, backtest_improvement: qubo.backtestImprovement }
      : null,
    // Omit tensor evidence when the model was never trained (status=skipped_no_model or
    // probability is null/undefined).  A missing tensor row is preferable to a synthetic
    // 0.5 "neutral" that the LLM critic would misread as genuine uncertainty evidence.
    tensor_prediction: (tensor && tensor.status !== "skipped_no_model" && tensor.probability != null)
      ? {
          probability: tensor.probability,
          fragility_score: tensor.fragilityScore,
          regime_breakdown: tensor.regimeBreakdown,
        }
      : null,
    rl_result: rl
      ? { total_return: rl.totalReturn, sharpe_ratio: rl.sharpeRatio }
      : null,
    // P1-drift-2 (max-5-params enforcement at output time):
    // CLAUDE.md "Strategy Philosophy" mandates max 3-5 parameters per strategy.
    // The strategy schema enforces this at creation, but the critic optimizer
    // can synthesize candidates that change >5 params (e.g. when the strategy
    // already has 5 and the critic tweaks several at once). Slice the param
    // ranges to 5 BEFORE handing to Python so the optimizer can never propose
    // a candidate that violates the rule. Logged when truncation occurs so
    // we can spot strategies that systematically push past the cap.
    param_ranges: (() => {
      if (paramRanges.length > 5) {
        logger.warn(
          { strategyId, paramRangeCount: paramRanges.length, kept: 5, dropped: paramRanges.length - 5 },
          "critic-optimizer: param_ranges truncated to 5 (CLAUDE.md max-5-params rule)",
        );
        return paramRanges.slice(0, 5);
      }
      return paramRanges;
    })(),
    max_candidates: MAX_REPLAY_CANDIDATES,
    pennylane_enabled: true,
    historical_runs: historicalRuns,
    deepar_evidence: deeparEvidence,
    decay_analysis: decayAnalysis,          // Fix 3a
    drift_alerts: driftAlerts,              // Fix 3b
    live_rolling_sharpe: liveRollingSharpe, // Fix 3c
    // P2-2: evidence run IDs for candidate provenance
    _evidence_run_ids: {
      mc: mcRunId ? [mcRunId] : undefined,
      sqa: sqaRunId ? [sqaRunId] : undefined,
      qmc: qmc?.id ? [qmc.id] : undefined,
      tensor: tensor?.id ? [tensor.id] : undefined,
      rl: rl?.id ? [rl.id] : undefined,
      wf: undefined, // walk-forward windows are identified by backtestId
    },
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

  // P0-1 fix: Use applyAllParamChanges so changed params are applied into the
  // correct nested locations (indicators[].period, stop_loss.multiplier, etc.)
  // rather than being flat-spread as top-level orphan keys.
  const mergedConfig = structuredClone(parentStrategy.config ?? {}) as Record<string, any>;
  const unapplied = applyAllParamChanges(mergedConfig, survivorCandidate.changedParams as Record<string, number>);
  if (unapplied.size > 0) {
    logger.warn(
      { runId, parentStrategyId: parentStrategy.id, unapplied: [...unapplied] },
      "createChildStrategy: some changed params could not be applied to child config — child may be incomplete",
    );
  }

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
      lifecycleState: "CANDIDATE", // Will be promoted to TESTING via lifecycle service below
      parentStrategyId: parentStrategy.id,
      generation: parentGen + 1,
      forgeScore: replayResult.forgeScore ?? undefined,
      preferredRegime: parentStrategy.preferredRegime ?? undefined,
      tags: parentStrategy.tags ?? undefined,
    })
    .returning({ id: strategies.id });

  // Route through canonical lifecycle path to get audit + SSE broadcast.
  // CANDIDATE → TESTING is a valid transition (lifecycle-service.ts VALID_TRANSITIONS line 44).
  const lifecycle = new LifecycleService();
  const promoteResult = await lifecycle.promoteStrategy(
    child.id,
    "CANDIDATE",
    "TESTING",
    { actor: "system", reason: "critic-replay-survivor" },
  );
  if (!promoteResult.success) {
    logger.warn(
      { runId, childId: child.id, error: promoteResult.error },
      "Critic optimizer: lifecycle promotion CANDIDATE→TESTING failed (child remains CANDIDATE)",
    );
  }

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
  correlationId?: string,
): Promise<void> {
  const { runBacktest } = await import("./backtest-service.js");
  const replayStartedAt = Date.now();

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
    broadcastSSE("critic:run-failed", {
      runId,
      strategyId,
      errorCode: "strategy_not_found",
      message: "Strategy not found for replay — run marked failed",
      durationMs: Date.now() - replayStartedAt,
    });
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

        // Clone strategy config and apply changed params using generic deep-merge (Fix 1).
        const replayConfig = JSON.parse(JSON.stringify(baseConfig));
        const changedParams = candidate.changedParams as Record<string, number>;

        const unappliedParamKeys = applyAllParamChanges(replayConfig, changedParams);

        if (unappliedParamKeys.size > 0) {
          // Fix 1: Hard-block — cannot replay a candidate whose params could not be applied.
          // Running with original values would produce results attributed to wrong params,
          // corrupting the replay evidence and the lineage record.
          const unappliedArray = [...unappliedParamKeys];
          logger.warn(
            { runId, candidateId: candidate.id, unappliedParamKeys: unappliedArray },
            "Critic replay: changedParams keys not applied — skipping candidate (param_application_failed)",
          );
          await db
            .update(criticCandidates)
            .set({
              replayStatus: "skipped_param_application_failed",
              governanceLabels: {
                ...(candidate.governanceLabels as Record<string, unknown> ?? {}),
                unapplied_param_keys: unappliedArray,
                skip_reason: "param_application_failed",
              } as any,
            })
            .where(eq(criticCandidates.id, candidate.id));
          broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, status: "skipped_param_application_failed" });
          continue;
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
        } as any, undefined, undefined, correlationId);

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
    let mcSurvivalRate: number | null = null;

    if (bestCandidate) {
      mcSurvivalRate = await waitForMcSurvivalRate(bestCandidate.backtestId);

      if (mcSurvivalRate === null) {
        // Fix 4.7b: MC data unavailable after full wait — veto the candidate.
        // We must NOT promote a candidate without any MC evidence.
        // mc_gate_passed=false and mc_survival_rate=null are persisted in the audit log below.
        logger.warn(
          { runId, candidateId: bestCandidate.id },
          "MC survival data unavailable — no candidate promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else if (mcSurvivalRate < MC_SURVIVAL_THRESHOLD) {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate: mcSurvivalRate, threshold: MC_SURVIVAL_THRESHOLD },
          "Critic optimizer: best candidate failed MC survival gate — no survivor promoted",
        );
        mcGatePassed = false;
        bestCandidate = null;
      } else {
        logger.info(
          { runId, candidateId: bestCandidate.id, survivalRate: mcSurvivalRate },
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
      broadcastSSE("critic:run-completed", {
        runId,
        strategyId,
        candidatesGenerated: candidates.length,
        survivorCandidateId: bestCandidate.id,
        durationMs: Date.now() - replayStartedAt,
      });
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
            correlationId,
          );

          // C1: auto-trigger walk-forward backtest for child to restart the loop.
          // suppressAutoPromote: true — child must earn promotion through full critic cycle,
          // not from a single replay result.
          // Fire-and-forget — does not block critic completion.
          // P0-1 fix: apply changed params into nested config structure via applyAllParamChanges
          // rather than flat spread which would write orphan top-level keys.
          const childMergedConfig = structuredClone(strat.config ?? {}) as Record<string, any>;
          applyAllParamChanges(childMergedConfig, survivorRow.changedParams as Record<string, number>);
          runBacktest(childId, {
            ...originalConfig,
            strategy: childMergedConfig,
            mode: "walkforward",
            optimizer: undefined,
            suppressAutoPromote: true,
          } as any, undefined, undefined, correlationId).catch((err: unknown) =>
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
      broadcastSSE("critic:run-completed", {
        runId,
        strategyId,
        candidatesGenerated: candidates.length,
        survivorCandidateId: null,
        durationMs: Date.now() - replayStartedAt,
      });
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
      mc_survival_rate: mcSurvivalRate,
      stuck_candidates_recovered: stuckCandidates.length,
    }, correlationId);

    // Broadcast replay-level completion summary for frontend observability.
    // survivorCount is 0 or 1 — critic loop produces at most one survivor per cycle.
    broadcastSSE("critic:replay-completed", {
      runId,
      replayedCount: candidates.length,
      survivorCount: bestCandidate ? 1 : 0,
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
      broadcastSSE("critic:run-failed", {
        runId,
        strategyId,
        errorCode: "replaying_stuck",
        message: "Run left in 'replaying' state after try block — marked failed by finally guard",
        durationMs: Date.now() - replayStartedAt,
      });
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
  correlationId?: string | null,
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
      correlationId: correlationId ?? null,
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
  context?: { correlationId?: string },
): Promise<void> {
  const correlationId = context?.correlationId;
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

        // Clone config and apply changed params using generic deep-merge (Fix 1).
        const replayConfig = JSON.parse(JSON.stringify(baseConfig));
        const changedParams = candidate.changedParams as Record<string, number>;

        const unappliedParamKeys = applyAllParamChanges(replayConfig, changedParams);

        if (unappliedParamKeys.size > 0) {
          // Fix 1: Hard-block — cannot replay a candidate whose params could not be applied.
          const unappliedArray = [...unappliedParamKeys];
          logger.warn(
            { runId, candidateId: candidate.id, unappliedParamKeys: unappliedArray },
            "Manual replay: changedParams keys not applied — skipping candidate (param_application_failed)",
          );
          await db
            .update(criticCandidates)
            .set({
              replayStatus: "skipped_param_application_failed",
              governanceLabels: {
                ...(candidate.governanceLabels as Record<string, unknown> ?? {}),
                unapplied_param_keys: unappliedArray,
                skip_reason: "param_application_failed",
              } as any,
            })
            .where(eq(criticCandidates.id, candidate.id));
          broadcastSSE("critic:replay_complete", { runId, candidateId: candidate.id, status: "skipped_param_application_failed" });
          continue;
        }

        // Run walk-forward backtest.
        // suppressAutoPromote: true — replay backtests must not auto-promote the parent
        // strategy to PAPER before the critic loop finishes selecting a survivor.
        const replayResult = await runBacktest(strategyId, {
          strategy: replayConfig,
          mode: "walkforward",
          optimizer: undefined,
          suppressAutoPromote: true,
        } as any, undefined, undefined, correlationId);

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

      // Create child strategy version (Fix 5: idempotency guard)
      if (survivorRow) {
        // Fix 5: Check if a child was already created from this exact candidate via audit_log.
        // Idempotency key: audit rows with action="critic-optimizer.child_created" and
        // input.survivorCandidateId = bestCandidate.id. If one exists, re-use it rather
        // than creating a duplicate child.
        // Rationale: manualReplayCandidates can be triggered multiple times for the same run
        // (e.g. user retries, network timeout before response). Without this guard every retry
        // would insert a new child strategy, creating duplicates that inflate generation count
        // and corrupt the parent/child lineage chain.
        const existingChildAudit = await db
          .select({ entityId: auditLog.entityId, result: auditLog.result })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.action, "critic-optimizer.child_created"),
              sql`${auditLog.input}->>'survivorCandidateId' = ${bestCandidate.id}`,
            ),
          )
          .limit(1)
          .catch(() => [] as { entityId: string | null; result: unknown }[]);

        if (existingChildAudit.length > 0) {
          const existingChildId = existingChildAudit[0].entityId;
          logger.info(
            { runId, existingChildId, candidateId: bestCandidate.id },
            "Manual replay: child already created for this candidate (idempotency guard) — skipping duplicate creation",
          );
          broadcastSSE("critic:child_created", {
            runId,
            parentStrategyId: strategyId,
            childStrategyId: existingChildId,
            generation: (strat.generation ?? 0) + 1,
            manual: true,
            idempotent: true,
          });
        } else {
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
              correlationId,
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
            } as any, undefined, undefined, correlationId).catch((err: unknown) =>
              logger.error({ err, childId }, "Auto-backtest for critic child (manual replay) failed"),
            );
          }
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
    }, correlationId);
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
