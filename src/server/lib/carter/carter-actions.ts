/**
 * carter-actions.ts — Handler implementations for Carter voice-agent GREEN action tools.
 *
 * These tools trigger capital-SAFE work: validation, simulation, research, and
 * scout deposits. They NEVER bypass a gate, change prop-firm rules, or force
 * execution in paused/busy states.
 *
 * GLOBAL GUARDRAILS (enforced in code — do not remove):
 *   1. run_monte_carlo: ALWAYS injects firms=['topstep_50k','mffu_50k']. Omitting
 *      firms makes the B14 gate fail-closed — this is non-negotiable.
 *   2. run_backtest: STRIPS compliance_mode, actor, trial_n_total from caller params.
 *      These fields are set by the engine, not by a voice agent.
 *   3. Backpressure: 429 (cap saturated) → "system busy" payload, no loop.
 *              423 (pipeline paused) → "pipeline paused" payload, no force.
 *   4. deposit_pending_mention: ONLY writes to strategy_pending_buckets /
 *      strategy_pending_mentions. NEVER to the strict grading path.
 *
 * Naming: keys MUST match CarterTool.handler fields in tool-registry.ts.
 */

import { db } from "../../db/index.js";
import {
  strategies,
  strategyPendingBuckets,
  strategyPendingMentions,
  auditLog,
} from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

// ── Service imports (REUSE — do not re-implement) ─────────────────────────────
import { runBacktest } from "../../services/backtest-service.js";
import { runMonteCarlo } from "../../services/monte-carlo-service.js";
import { runMatrix } from "../../services/matrix-backtest-service.js";
import {
  runAutonomousScoutCycle,
  fetchYouTubeTopVideos,
} from "../../services/autonomous-scout-runner.js";
import { strategyHunt } from "../../services/search-router.js";
import {
  computeConceptFingerprintHash,
  extractEntryArchetype,
  normalizeExitType,
} from "../../services/strategy-fingerprint.js";
import { isActive as isPipelineActive } from "../../services/pipeline-control-service.js";
import { getBacktestConcurrencyStats } from "../../routes/backtests.js";

// ─── Shared payload factories ─────────────────────────────────────────────────

function pipelinePausedPayload(tool: string): Record<string, unknown> {
  return {
    status: "pipeline_paused",
    message: "The pipeline is paused. Resume it from the Slumhouse Office before running this tool.",
    tool,
  };
}

function systemBusyPayload(active: number, cap: number): Record<string, unknown> {
  return {
    status: "system_busy",
    message: `Server is running ${active}/${cap} concurrent backtests. Retry in 30 seconds.`,
    retry_after_seconds: 30,
    active,
    cap,
  };
}

// ─── Inline kill-signal computation (pure / stateless) ────────────────────────
// Duplicated from routes/backtests.ts:327-398 to avoid an HTTP self-call.
// These are pure math functions — no DB, no side effects.

function _ksGetStage(iterationCount: number): number {
  if (iterationCount <= 3) return 1;
  if (iterationCount <= 6) return 2;
  return 3;
}

function _ksGetStagePrompt(stage: number): string {
  const prompts: Record<number, string> = {
    1: "STAGE 1 — PARAMETER REFINEMENT: Same strategy logic, adjust parameters. Try different lookback periods, ATR multiples, or threshold values. Do NOT change the core entry/exit logic.",
    2: "STAGE 2 — LOGIC VARIANT: Same edge thesis, different execution. Try a different entry method (e.g., mean reversion instead of breakout) or different exit logic.",
    3: "STAGE 3 — CONCEPT PIVOT: Different edge entirely for this symbol/session. Abandon the previous approach. Try a completely different strategy concept.",
  };
  return prompts[stage] ?? "";
}

// ─── Action handlers ──────────────────────────────────────────────────────────

// run_backtest ────────────────────────────────────────────────────────────────

async function runBacktestHandler(params: unknown): Promise<unknown> {
  const p = params as {
    strategyId?: string;
    mode?: string;
    [key: string]: unknown;
  };

  const strategyId = p.strategyId;
  if (!strategyId || typeof strategyId !== "string") {
    return { error: "strategyId is required" };
  }

  // GUARDRAIL: check concurrent cap before loading from DB
  const concurrency = getBacktestConcurrencyStats();
  if (concurrency.saturated) {
    logger.warn({ strategyId, active: concurrency.active, cap: concurrency.cap }, "carter: run_backtest — cap saturated, returning busy");
    return systemBusyPayload(concurrency.active, concurrency.cap);
  }

  // Load strategy from DB (same pattern as routes/backtests.ts:165-204)
  let resolvedStrategy: Record<string, unknown> | undefined;
  let strategyClass: string | undefined;
  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    if (!strat) {
      return { error: "strategy_not_found", strategyId };
    }
    const stratConfig = strat.config as Record<string, unknown> | undefined;
    if (stratConfig?.strategy_class) {
      strategyClass = String(stratConfig.strategy_class);
    }
    if (stratConfig) {
      const nested = (stratConfig.strategy as Record<string, unknown> | undefined) ?? {};
      const pick = <T,>(key: string, fallback: T): T => {
        const v = (nested as Record<string, unknown>)[key] ?? (stratConfig as Record<string, unknown>)[key];
        return (v === undefined || v === null) ? fallback : v as T;
      };
      resolvedStrategy = {
        name: strat.name,
        symbol: strat.symbol,
        timeframe: strat.timeframe,
        indicators: pick<unknown[]>("indicators", []),
        entry_long: String(pick<string>("entry_long", "")),
        entry_short: String(pick<string>("entry_short", "")),
        exit: String(pick<string>("exit", "")),
        stop_loss: pick<unknown>("stop_loss", { type: "atr", multiplier: 2.0 }),
        position_size: pick<unknown>("position_size", { type: "fixed", fixed_contracts: 1 }),
      };
    }
  } catch (err) {
    logger.error({ err, strategyId }, "carter: run_backtest — DB load failed");
    return { error: "failed_to_load_strategy", strategyId };
  }

  if (!resolvedStrategy) {
    return { error: "no_strategy_config", strategyId };
  }

  // GUARDRAIL: strip forbidden caller-supplied fields
  // compliance_mode: determined by engine, not caller
  // actor: pinned to "automated" below — not passed in config
  // trial_n_total: set by critic loop, not voice agent
  const {
    compliance_mode: _cmDrop,       // eslint-disable-line @typescript-eslint/no-unused-vars
    actor: _actorDrop,               // eslint-disable-line @typescript-eslint/no-unused-vars
    trial_n_total: _tnDrop,          // eslint-disable-line @typescript-eslint/no-unused-vars
    strategyId: _sidDrop,            // eslint-disable-line @typescript-eslint/no-unused-vars
    ...safeCallerParams
  } = p;

  const config: Record<string, unknown> = {
    ...safeCallerParams,
    strategy: resolvedStrategy,
    mode: (p.mode === "single" || p.mode === "walkforward") ? p.mode : "walkforward",
  };

  // GUARDRAIL: actor is always "automated" — never bypass pipeline gate
  const result = await runBacktest(
    strategyId,
    config as unknown as Parameters<typeof runBacktest>[1],
    strategyClass,
    undefined,
    undefined,
    "automated",
  );

  if (result.status === "skipped" && result.error === "pipeline_paused") {
    return pipelinePausedPayload("run_backtest");
  }

  logger.info({ strategyId, backtestId: result.id, status: result.status }, "carter: run_backtest dispatched");
  return { backtestId: result.id, status: result.status };
}

// run_walk_forward ────────────────────────────────────────────────────────────
// Explicit alias: mode is always 'walkforward', ignoring any mode param from caller.

async function runWalkForwardHandler(params: unknown): Promise<unknown> {
  const p = params as Record<string, unknown>;
  return runBacktestHandler({ ...p, mode: "walkforward" });
}

// run_monte_carlo ─────────────────────────────────────────────────────────────

async function runMonteCarloHandler(params: unknown): Promise<unknown> {
  const p = params as { backtestId?: string; [key: string]: unknown };

  const backtestId = p.backtestId;
  if (!backtestId || typeof backtestId !== "string") {
    return { error: "backtestId is required" };
  }

  // GUARDRAIL: check pipeline before running MC
  const active = await isPipelineActive();
  if (!active) {
    return pipelinePausedPayload("run_monte_carlo");
  }

  // GUARDRAIL: strip anything the caller shouldn't supply, then ALWAYS force firms
  const {
    backtestId: _bidDrop,            // eslint-disable-line @typescript-eslint/no-unused-vars
    firms: _firmsDrop,               // GUARDRAIL: never accept caller-supplied firms — always force ours
    ...safeOptions
  } = p;

  // GUARDRAIL: firms MUST always be ['topstep_50k', 'mffu_50k'].
  // Omitting this makes the B14 gate fail-closed. Do not remove or make conditional.
  const REQUIRED_FIRMS = ["topstep_50k", "mffu_50k"] as const;

  const result = await runMonteCarlo(backtestId, {
    ...safeOptions,
    firms: [...REQUIRED_FIRMS],
  });

  logger.info({ backtestId, firms: REQUIRED_FIRMS }, "carter: run_monte_carlo dispatched");
  return { backtestId, mcRunId: (result as Record<string, unknown>)?.id ?? null, status: "dispatched" };
}

// run_matrix ──────────────────────────────────────────────────────────────────

async function runMatrixHandler(params: unknown): Promise<unknown> {
  const p = params as { strategyId?: string };

  const strategyId = p.strategyId;
  if (!strategyId || typeof strategyId !== "string") {
    return { error: "strategyId is required" };
  }

  const result = await runMatrix(strategyId);
  logger.info({ strategyId }, "carter: run_matrix dispatched");
  return { strategyId, matrixId: (result as Record<string, unknown>)?.id ?? null, status: "dispatched" };
}

// fire_scout_cycle ────────────────────────────────────────────────────────────

async function fireScoutCycleHandler(_params: unknown): Promise<unknown> {
  // GUARDRAIL: check pipeline BEFORE firing — do not force around a pause
  const active = await isPipelineActive();
  if (!active) {
    logger.warn({}, "carter: fire_scout_cycle — pipeline paused, not firing");
    return pipelinePausedPayload("fire_scout_cycle");
  }

  // Fire-and-forget: the cycle runs 3-10 min asynchronously
  runAutonomousScoutCycle()
    .then((result) => logger.info({ result }, "carter: scout cycle complete"))
    .catch((err) => logger.error({ err }, "carter: scout cycle failed"));

  return { status: "cycle_started", message: "Autonomous scout cycle started. It runs asynchronously for 3-10 minutes." };
}

// research_strategy_idea ──────────────────────────────────────────────────────

async function researchStrategyIdeaHandler(params: unknown): Promise<unknown> {
  const p = params as { query?: string; regime?: string; market?: string; depth?: string };

  if (!p.query || typeof p.query !== "string") {
    return { error: "query is required" };
  }

  const results = await strategyHunt({
    intent: "strategy research — institutional edge discovery",
    query: p.query,
    regime: p.regime,
    market: p.market,
    depth: (p.depth === "basic" || p.depth === "advanced") ? p.depth : "advanced",
    maxResults: 10,
  });

  const top = results.results.slice(0, 5).map((r) => ({
    title: (r as unknown as Record<string, unknown>).title ?? (r as unknown as Record<string, unknown>).snippet,
    url: (r as unknown as Record<string, unknown>).url,
    provider: (r as unknown as Record<string, unknown>).provider,
  }));

  return {
    query: results.query,
    totalFound: results.totalAfterGraveyard,
    perProvider: results.perProvider,
    topResults: top,
  };
}

// competitive_intel ───────────────────────────────────────────────────────────

async function competitiveIntelHandler(params: unknown): Promise<unknown> {
  const p = params as { topic?: string; regime?: string; market?: string };

  if (!p.topic || typeof p.topic !== "string") {
    return { error: "topic is required" };
  }

  const results = await strategyHunt({
    intent: "competitive intelligence — trader edge and methodology research",
    query: p.topic,
    regime: p.regime,
    market: p.market,
    depth: "advanced",
    maxResults: 10,
  });

  const top = results.results.slice(0, 5).map((r) => ({
    title: (r as unknown as Record<string, unknown>).title ?? (r as unknown as Record<string, unknown>).snippet,
    url: (r as unknown as Record<string, unknown>).url,
    provider: (r as unknown as Record<string, unknown>).provider,
  }));

  return {
    topic: p.topic,
    totalFound: results.totalAfterGraveyard,
    perProvider: results.perProvider,
    topResults: top,
  };
}

// scan_youtube_for_setups ─────────────────────────────────────────────────────
// Returns candidate video list (title+url) WITHOUT extracting transcripts.
// Transcript extraction is the autonomous-cycle's job — NEVER do it here.

async function scanYouTubeForSetupsHandler(params: unknown): Promise<unknown> {
  const p = params as { topic?: string };

  if (!p.topic || typeof p.topic !== "string") {
    return { error: "topic is required" };
  }

  const candidates = await fetchYouTubeTopVideos(p.topic);

  // Return lightweight list only — no transcript extraction
  const videoList = candidates.map((c) => ({
    title: c.title,
    url: c.url,
    titleScore: c.titleScore,
    sourcePass: c.source_pass,
  }));

  return {
    topic: p.topic,
    count: videoList.length,
    note: "Candidates only — no transcripts extracted. Feed URLs to the autonomous scout cycle to process.",
    videos: videoList,
  };
}

// deposit_pending_mention ─────────────────────────────────────────────────────
// GUARDRAIL: writes ONLY to strategy_pending_buckets + strategy_pending_mentions.
// NEVER writes to the strict grading path (/scout-ideas/strict or strategies table).
// The HTTP route is bypassed intentionally to avoid the auth layer round-trip —
// the SAME underlying DB ops are reproduced here with minimal validated fields.

async function depositPendingMentionHandler(params: unknown): Promise<unknown> {
  const p = params as {
    conceptName?: string;
    market?: string;
    sourceUrl?: string;
    layer?: string;
  };

  const conceptName = p.conceptName;
  const market = p.market;
  const sourceUrl = p.sourceUrl;
  const layer = (p.layer === "web" || p.layer === "youtube" || p.layer === "reddit")
    ? p.layer
    : "web";

  if (!conceptName || typeof conceptName !== "string") {
    return { error: "conceptName is required" };
  }
  if (!market || !["MES", "MNQ", "MCL"].includes(market)) {
    return { error: "market must be MES, MNQ, or MCL" };
  }
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return { error: "sourceUrl is required" };
  }

  // Compute fingerprint (same scheme as agent.ts — concept-first for named concepts)
  const fingerprintHash = computeConceptFingerprintHash({ market, concept_name: conceptName });

  // Archetype classification is best-effort from the concept name; will be 'unknown' if unrecognisable
  const entryArchetype = extractEntryArchetype(conceptName);
  const exitType = normalizeExitType(""); // no exit rules from Carter — "unknown"

  // Minimal extracted-idea JSON for the mention record
  const extractedIdeaJson: Record<string, unknown> = {
    concept_name:    conceptName,
    market,
    source_url:      sourceUrl,
    source_provider: "manual",
    layer,
    thesis:          `Voice agent deposit: ${conceptName} (${market})`,
    entry_rules:     `Pending extraction — concept: ${conceptName}`,
    exit_rules:      "Pending extraction — standard framework exit",
    risk_rules:      "Pending extraction — standard framework risk",
    timeframe:       "pending",
    regime:          "any",
    deposited_via:   "carter_voice_agent",
  };

  try {
    // GUARDRAIL: upsert into pending bucket ONLY — never into strategies or strict path
    const upserted = await db.insert(strategyPendingBuckets).values({
      fingerprintHash,
      market,
      entryArchetype,
      exitType,
      conceptName,
      layerCoverageJson: { web: false, youtube: false, reddit: false, [layer]: true },
      sourceCount:       0,
      distinctProviders: 0,
      status:            "pending",
    }).onConflictDoUpdate({
      target: strategyPendingBuckets.fingerprintHash,
      set: {
        lastSeenAt:  sql`NOW()`,
        conceptName: sql`COALESCE(strategy_pending_buckets.concept_name, EXCLUDED.concept_name)`,
      },
    }).returning();

    const bucket = upserted[0];
    if (!bucket) {
      return { error: "bucket_upsert_failed" };
    }

    // GUARDRAIL: insert into mentions only — idempotent on bucket_id + source_url
    const mentionInserted = await db.insert(strategyPendingMentions).values({
      bucketId:               bucket.id,
      sourceProvider:         "manual",
      sourceUrl,
      extractedIdea:          extractedIdeaJson,
      isCrossValidationResult: false,
      crossValidatorConfidence: null,
      scoutLayer:             layer,
    }).onConflictDoNothing().returning();

    const isBucketNew = bucket.sourceCount === 0 && bucket.distinctProviders === 0;
    if (isBucketNew) {
      db.insert(auditLog).values({
        action:            "pending_bucket.created",
        entityType:        "strategy_pending_bucket",
        entityId:          bucket.id,
        input: {
          fingerprint_hash: fingerprintHash,
          market,
          concept_name:     conceptName,
          source_url:       sourceUrl,
          source_provider:  "manual",
          deposited_via:    "carter_voice_agent",
        } as unknown as Record<string, unknown>,
        status:            "success",
        decisionAuthority: "agent",
      }).catch((err) => {
        logger.warn({ err, bucketId: bucket.id }, "carter: deposit_pending_mention — audit_log write failed");
      });
    }

    // Recompute counts from mention table (authoritative)
    const [counts] = await db.execute(sql`
      SELECT
        COUNT(*)::int AS source_count,
        COUNT(DISTINCT source_provider)::int AS distinct_providers,
        BOOL_OR(scout_layer = 'web')     AS has_web,
        BOOL_OR(scout_layer = 'youtube') AS has_youtube,
        BOOL_OR(scout_layer = 'reddit')  AS has_reddit
      FROM strategy_pending_mentions
      WHERE bucket_id = ${bucket.id}
    `);
    const sourceCount       = Number((counts as Record<string, unknown>)?.source_count       ?? 0);
    const distinctProviders = Number((counts as Record<string, unknown>)?.distinct_providers ?? 0);
    const hasWeb     = Boolean((counts as Record<string, unknown>)?.has_web);
    const hasYoutube = Boolean((counts as Record<string, unknown>)?.has_youtube);
    const hasReddit  = Boolean((counts as Record<string, unknown>)?.has_reddit);

    await db.update(strategyPendingBuckets).set({
      sourceCount,
      distinctProviders,
      layerCoverageJson: { web: hasWeb, youtube: hasYoutube, reddit: hasReddit },
      lastSeenAt: sql`NOW()`,
    }).where(eq(strategyPendingBuckets.id, bucket.id));

    logger.info({ bucketId: bucket.id, conceptName, market, layer }, "carter: deposit_pending_mention — accepted");
    return {
      accepted: true,
      bucketId: bucket.id,
      fingerprintHash,
      isNew: isBucketNew,
      mentionIsNew: mentionInserted.length > 0,
      sourceCount,
      path: "pending",  // GUARDRAIL: always 'pending', never 'strict'
    };
  } catch (err) {
    logger.error({ err, conceptName, market, sourceUrl }, "carter: deposit_pending_mention — DB error");
    return { error: "db_error", message: err instanceof Error ? err.message : String(err) };
  }
}

// evaluate_kill_signal ────────────────────────────────────────────────────────
// Pure stateless computation — no DB calls.
// Mirrors routes/backtests.ts:327-398 exactly. If route logic changes, update here too.

async function evaluateKillSignalHandler(params: unknown): Promise<unknown> {
  const p = params as {
    attempts?: Array<{
      sharpe_ratio: number;
      max_drawdown: number;
      win_rate: number;
      profit_factor: number;
      avg_daily_pnl: number;
    }>;
  };

  if (!Array.isArray(p.attempts) || p.attempts.length === 0) {
    return { error: "attempts array (min 1 item) is required" };
  }

  const attempts = p.attempts;
  const TIER3_MINS = { sharpe_ratio: 1.5, profit_factor: 1.75, avg_daily_pnl: 250, win_rate: 0.60 };

  // Catastrophic risk: immediate kill
  for (const a of attempts) {
    if (a.max_drawdown > 6000) {
      const stage = _ksGetStage(attempts.length);
      return { kill_signal: "catastrophic_risk", stage, stage_prompt: _ksGetStagePrompt(stage) };
    }
  }

  const bestSharpe = Math.max(...attempts.map((a) => a.sharpe_ratio));
  const bestPf     = Math.max(...attempts.map((a) => a.profit_factor));
  const bestWr     = Math.max(...attempts.map((a) => a.win_rate));
  const bestPnl    = Math.max(...attempts.map((a) => a.avg_daily_pnl));

  if (bestSharpe < 0.8) return { kill_signal: "no_edge",       stage: _ksGetStage(attempts.length) };
  if (bestWr < 0.40)    return { kill_signal: "wrong_direction", stage: _ksGetStage(attempts.length) };
  if (bestPf < 1.0)     return { kill_signal: "unprofitable",   stage: _ksGetStage(attempts.length) };

  if (attempts.length >= 2) {
    const prevSharpe = attempts[attempts.length - 2].sharpe_ratio;
    const currSharpe = attempts[attempts.length - 1].sharpe_ratio;
    if (Math.abs(currSharpe - prevSharpe) < 0.1 && currSharpe < TIER3_MINS.sharpe_ratio) {
      return { kill_signal: "flat_improvement", stage: _ksGetStage(attempts.length) };
    }
  }

  if (attempts.length >= 3) {
    const pctSharpe = bestSharpe / TIER3_MINS.sharpe_ratio;
    const pctPf     = bestPf     / TIER3_MINS.profit_factor;
    const pctPnl    = bestPnl    / TIER3_MINS.avg_daily_pnl;
    if ((pctSharpe + pctPf + pctPnl) / 3 < 0.70) {
      return { kill_signal: "below_tier3", stage: _ksGetStage(attempts.length) };
    }
  }

  const stage = _ksGetStage(attempts.length);
  return { kill_signal: null, stage, stage_prompt: _ksGetStagePrompt(stage) };
}

// ─── Export map ──────────────────────────────────────────────────────────────

export const CARTER_ACTION_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  run_backtest:             runBacktestHandler,
  run_walk_forward:         runWalkForwardHandler,
  run_monte_carlo:          runMonteCarloHandler,
  run_matrix:               runMatrixHandler,
  fire_scout_cycle:         fireScoutCycleHandler,
  research_strategy_idea:   researchStrategyIdeaHandler,
  competitive_intel:        competitiveIntelHandler,
  scan_youtube_for_setups:  scanYouTubeForSetupsHandler,
  deposit_pending_mention:  depositPendingMentionHandler,
  evaluate_kill_signal:     evaluateKillSignalHandler,
};
