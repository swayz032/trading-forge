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
import { isActive as isPipelineActive, setMode } from "../../services/pipeline-control-service.js";
import { getBacktestConcurrencyStats } from "../../routes/backtests.js";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";
import { createHmac } from "node:crypto";
import { issueConfirmation, verifyConfirmation } from "./carter-confirm.js";
// Wave 7 — RESEARCH lane (NON-strategy). Leaf imports only; carter-research pulls
// the logger leaf + the pure reddit-cross-extract helper (no heavy graph).
import { institutionalResearch, researchReddit } from "./carter-research.js";

// In-process base URL for reusing the EXISTING extraction pipeline endpoints
// (/api/agent/scout-extract + /api/agent/scout-ideas/pending) — same pattern as
// autonomous-scout-runner.ts. Localhost in-process calls need no auth.
const BACKEND_URL = `http://localhost:${process.env.PORT ?? 4000}`;

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

// ════════════════════════════════════════════════════════════════════════════
// Wave 7 — STRATEGY lane: extract_youtube_strategy
// ════════════════════════════════════════════════════════════════════════════
// THE governance boundary: a strategy may enter Trading Forge through EXACTLY
// ONE door — YouTube → the existing extraction pipeline → the PENDING scout
// bucket. This handler plugs into that pipeline; it does NOT reimplement it and
// it NEVER posts to the strict path. Web/Reddit are never strategy sources.
//
// Flow (mirrors autonomous-scout-runner.ts):
//   1. fetchTranscriptWithRetry(videoId)         — existing transcript fetcher
//   2. POST /api/agent/scout-extract             — existing extraction pipeline
//   3. POST /api/agent/scout-ideas/pending       — existing pending-bucket deposit
//                                                  (NEVER /scout-ideas/strict)

/** Parse a YouTube video ID from a watch / youtu.be / shorts / embed URL. */
function parseYoutubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      return seg && /^[\w-]{6,}$/.test(seg) ? seg : null;
    }
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{6,}$/.test(v)) return v;
      // /shorts/<id> or /embed/<id>
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "shorts" || p === "embed");
      if (idx >= 0 && parts[idx + 1] && /^[\w-]{6,}$/.test(parts[idx + 1])) return parts[idx + 1];
    }
    return null;
  } catch {
    return null;
  }
}

async function extractYoutubeStrategyHandler(params: unknown): Promise<unknown> {
  const p = params as { url?: string; title?: string };
  const url = p.url;
  if (!url || typeof url !== "string") {
    return { error: "url is required" };
  }
  const videoId = parseYoutubeVideoId(url);
  if (!videoId) {
    return { error: "invalid_youtube_url", url };
  }

  // 1. Fetch transcript via the EXISTING retry queue (dynamic import — keeps the
  //    heavy services/index.js graph out of module load for the contract tests).
  let transcript = "";
  try {
    const { fetchTranscriptWithRetry } = await import("../../services/transcript-fetch-queue.js");
    const r = await fetchTranscriptWithRetry(videoId);
    transcript = r.transcript ?? "";
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), videoId }, "carter: extract_youtube_strategy — transcript fetch failed");
    return { error: "transcript_fetch_failed", url, message: err instanceof Error ? err.message : String(err) };
  }
  if (transcript.length < 200) {
    return { extracted: false, reason: "transcript_too_short", url, transcript_len: transcript.length, deposited: false };
  }

  // 2. Run the EXISTING extraction pipeline (scout-extract). sourceProvider must
  //    be one of the route's enum values; "exa" is the runner's YouTube choice
  //    (framework-overlay rewrites metadata.source downstream).
  let ideas: Array<Record<string, unknown>> = [];
  let extractionMeta: Record<string, unknown> = {};
  try {
    const res = await fetch(`${BACKEND_URL}/api/agent/scout-extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: url,
        markdown: transcript,
        sourceProvider: "exa",
        title: typeof p.title === "string" ? p.title.slice(0, 500) : "",
      }),
      signal: AbortSignal.timeout(300_000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    ideas = Array.isArray(j.ideas) ? (j.ideas as Array<Record<string, unknown>>) : [];
    extractionMeta = {
      extraction_mode: j.extraction_mode ?? null,
      instrument_classification: j.instrument_classification ?? null,
      reason: j.reason ?? null,
    };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), url }, "carter: extract_youtube_strategy — scout-extract failed");
    return { error: "scout_extract_failed", url, message: err instanceof Error ? err.message : String(err) };
  }

  if (ideas.length === 0) {
    return { extracted: false, reason: "no_strategy_extracted", url, ...extractionMeta, deposited: false };
  }

  // 3. Deposit the best idea into the PENDING bucket — NEVER the strict path.
  const idea = ideas[0];
  const market = (["MES", "MNQ", "MCL"].includes(String(idea.market))) ? String(idea.market) : "MES";
  const depositBody: Record<string, unknown> = {
    thesis: String(idea.thesis ?? `YouTube-extracted strategy from ${url}`).slice(0, 2000),
    market,
    timeframe: String(idea.timeframe ?? "5m"),
    entry_rules: String(idea.entry_rules ?? "").slice(0, 2000) || "YouTube extraction; framework overlay applies risk rules.",
    exit_rules: String(idea.exit_rules ?? "").slice(0, 2000) || "Style C framework overlay applies.",
    risk_rules: String(idea.risk_rules ?? "").slice(0, 1000) || "CLAUDE.md §4 framework risk rules apply post-overlay.",
    source_url: url,
    regime: String(idea.preferred_regime ?? idea.regime ?? "TRENDING"),
    concept_name: String(idea.concept_name ?? idea.name ?? `youtube_${videoId}`),
    source_provider: "youtube_transcript_npm",
    layer: "youtube",
    is_cross_validation_result: false,
  };
  // Forward rich DSL fields when present (same set as runner postLayerMention).
  for (const k of [
    "name", "entry_indicator", "entry_archetype", "entry_params", "entry_condition",
    "entry_type", "direction", "exit_type", "exit_params", "stop_loss_atr_multiple",
    "take_profit_atr_multiple", "preferred_regime", "session_filter", "extraction_confidence",
    "confluence_factors", "min_factors_satisfied", "source_claim_win_rate", "source_claim_avg_r",
    "symbols", "max_contracts", "base_contracts", "tier_increment",
  ]) {
    if (idea[k] !== undefined && idea[k] !== null) depositBody[k] = idea[k];
  }

  let deposit: Record<string, unknown> = {};
  try {
    const depRes = await fetch(`${BACKEND_URL}/api/agent/scout-ideas/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(depositBody),
      signal: AbortSignal.timeout(45_000),
    });
    deposit = (await depRes.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), url }, "carter: extract_youtube_strategy — pending deposit failed");
    return { extracted: true, strategy: idea, ...extractionMeta, deposited: false, deposit_error: err instanceof Error ? err.message : String(err), deposit_path: "pending" };
  }

  logger.info({ url, videoId, conceptName: depositBody.concept_name, market }, "carter: extract_youtube_strategy — extracted + deposited to pending");
  return {
    extracted: true,
    url,
    videoId,
    strategy: idea,
    ...extractionMeta,
    deposited: true,
    deposit,
    deposit_path: "pending", // GUARDRAIL: always pending, never strict
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Wave 7 — RESEARCH lane: research_reddit + institutional_research (NON-strategy)
// ════════════════════════════════════════════════════════════════════════════

// research_reddit ─────────────────────────────────────────────────────────────
async function researchRedditHandler(params: unknown): Promise<unknown> {
  const p = params as { topic?: string };
  if (!p.topic || typeof p.topic !== "string") {
    return { error: "topic is required" };
  }
  return researchReddit({ topic: p.topic });
}

// institutional_research ──────────────────────────────────────────────────────
async function institutionalResearchHandler(params: unknown): Promise<unknown> {
  const p = params as { question?: string; includeParallel?: boolean };
  if (!p.question || typeof p.question !== "string") {
    return { error: "question is required" };
  }
  return institutionalResearch({ question: p.question, includeParallel: p.includeParallel === true });
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
  competitive_intel:        competitiveIntelHandler,
  scan_youtube_for_setups:  scanYouTubeForSetupsHandler,
  extract_youtube_strategy: extractYoutubeStrategyHandler,
  research_reddit:          researchRedditHandler,
  institutional_research:   institutionalResearchHandler,
  deposit_pending_mention:  depositPendingMentionHandler,
  evaluate_kill_signal:     evaluateKillSignalHandler,
};

// ════════════════════════════════════════════════════════════════════════════
// YELLOW confirm-action handlers (Wave 5 — propose/confirm two-call protocol)
// ════════════════════════════════════════════════════════════════════════════
//
// Each YELLOW capability is a PAIR registered tier="yellow" in the registry:
//   propose_<x>(params)          → { summary, token }  (token via issueConfirmation)
//   confirm_<x>(params, token)   → verifyConfirmation first; then call the
//                                  underlying SERVICE function DIRECTLY (never the
//                                  cookie-gated HTTP route); then audit
//                                  `carter.action_executed` decisionAuthority='voice_agent'.
//
// GUARDRAILS (do not remove):
//   - confirm_* without a valid token → { error: 'confirmation_required' } and NO mutation.
//   - request_promotion: gates run INSIDE promoteStrategy — a gate block is RETURNED,
//     never bypassed or forced.
//   - run_quantum: cloud stays OFF (never sets optInCloud / QUANTUM_CLOUD_ENABLED).
//   - trigger_n8n_workflow: webhook trigger paths only — workflow create/update/delete is RED.
//   - set_learning_loop_mode: lowering to OFF(0)/OBSERVE(1) is GREEN (no token);
//     raising to AUTOPILOT(2) is YELLOW (token required).

/** Split a params object into the token field and the clean params it was minted over. */
function stripToken(params: unknown): { clean: Record<string, unknown>; token: string | undefined } {
  const p = (params ?? {}) as Record<string, unknown>;
  const { token, ...clean } = p;
  return { clean, token: typeof token === "string" ? token : undefined };
}

/** Reject when no valid confirmation token accompanies the action. */
function tokenGate(
  action: string,
  clean: Record<string, unknown>,
  token: string | undefined,
): { error: "confirmation_required"; reason?: string } | null {
  const v = verifyConfirmation(token ?? "", action, clean);
  if (!v.ok) return { error: "confirmation_required", reason: v.reason };
  return null;
}

/** Write the canonical voice-agent action-executed audit row. */
async function auditActionExecuted(
  action: string,
  params: unknown,
  result: unknown,
  status: "success" | "failure" = "success",
  errorMessage?: string,
): Promise<void> {
  await insertAuditRowSafe({
    action: "carter.action_executed",
    entityType: "voice_agent_action",
    status,
    decisionAuthority: "voice_agent",
    correlationId: null,
    input: { action, params } as Record<string, unknown>,
    result: (result ?? {}) as Record<string, unknown>,
    ...(errorMessage ? { errorMessage } : {}),
  });
}

// ── toggle_bot_power (setMode ACTIVE|PAUSED) ─────────────────────────────────

async function proposeToggleBotPower(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const mode = clean.mode === "PAUSED" ? "PAUSED" : "ACTIVE";
  const summary = mode === "PAUSED"
    ? "This PAUSES all Trading Forge engine authority — lifecycle promotion, scheduler automation, and paper execution stop. Open positions stay as-is; n8n keeps feeding the queue. Confirm to pause."
    : "This sets Trading Forge to ACTIVE — engine authority, lifecycle automation, and paper execution resume. Confirm to resume.";
  const { token } = issueConfirmation("toggle_bot_power", clean);
  return { summary, token };
}

async function confirmToggleBotPower(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("toggle_bot_power", clean, tok);
  if (gate) return gate;

  const mode = clean.mode === "PAUSED" ? "PAUSED" : clean.mode === "ACTIVE" ? "ACTIVE" : null;
  if (!mode) return { error: "mode must be ACTIVE or PAUSED" };

  await setMode(mode, "carter_voice_agent: toggle_bot_power", null);
  const result = { executed: true, mode };
  await auditActionExecuted("toggle_bot_power", clean, result);
  logger.info({ mode }, "carter: toggle_bot_power executed");
  return result;
}

// ── set_learning_loop_mode (auto_patch_loop_enabled 0/1/2) ───────────────────
// Down to OFF(0)/OBSERVE(1) = GREEN (no token); up to AUTOPILOT(2) = YELLOW (token).

async function proposeSetLearningLoopMode(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const mode = Number(clean.mode);
  const label = mode === 2 ? "AUTOPILOT" : mode === 1 ? "OBSERVE" : "OFF";
  const summary = mode === 2
    ? "This raises the learning loop to AUTOPILOT — autonomous prompt mutation loops (pattern-aggregator, quantum-replay-weekly) will run unattended. This requires confirmation."
    : `This lowers the learning loop to ${label}. Lowering is safe and needs no confirmation; you can call confirm directly.`;
  const { token } = issueConfirmation("set_learning_loop_mode", clean);
  return { summary, token };
}

async function confirmSetLearningLoopMode(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;

  const mode = Number(clean.mode);
  if (![0, 1, 2].includes(mode)) return { error: "mode must be 0 (OFF), 1 (OBSERVE), or 2 (AUTOPILOT)" };

  // SPECIAL: only raising to AUTOPILOT(2) demands a token. OFF/OBSERVE are GREEN.
  if (mode === 2) {
    const gate = tokenGate("set_learning_loop_mode", clean, tok);
    if (gate) return gate;
  }

  const { LEARNING_LOOP_MODE_PARAM } = await import("../../lib/learning-loop-mode.js");
  const { systemParameters } = await import("../../db/schema.js");
  const existing = await db
    .select({ id: systemParameters.id })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM));
  if (existing[0]) {
    await db
      .update(systemParameters)
      .set({ currentValue: String(mode), updatedAt: new Date() })
      .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM));
  } else {
    await db.insert(systemParameters).values({
      paramName: LEARNING_LOOP_MODE_PARAM,
      currentValue: String(mode),
      domain: "scheduler",
      description: "Autonomous learning-loop mode: 0=OFF, 1=OBSERVE, 2=AUTOPILOT",
    });
  }

  const result = { executed: true, mode, tokenRequired: mode === 2 };
  await auditActionExecuted("set_learning_loop_mode", clean, result);
  logger.info({ mode }, "carter: set_learning_loop_mode executed");
  return result;
}

// ── toggle_vacation_mode (system_state.operator_absent_since) ─────────────────

async function proposeToggleVacationMode(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const on = clean.on === true || clean.on === "true" || clean.on === "on";
  const summary = on
    ? "This turns ON vacation mode — Tier-1 strategies may auto-promote DEPLOY_READY → PILOT while you are away. Confirm to engage."
    : "This turns OFF vacation mode — clears the operator-absent markers and returns to full operator supervision. Confirm to disengage.";
  const { token } = issueConfirmation("toggle_vacation_mode", clean);
  return { summary, token };
}

async function confirmToggleVacationMode(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("toggle_vacation_mode", clean, tok);
  if (gate) return gate;

  const on = clean.on === true || clean.on === "true" || clean.on === "on";
  const { systemState } = await import("../../db/schema.js");
  if (on) {
    await db.update(systemState).set({ operatorAbsentSince: new Date() }).where(eq(systemState.id, 1));
  } else {
    const { clearOperatorAbsenceMarkers } = await import("../../services/dead-mans-heartbeat-service.js");
    await clearOperatorAbsenceMarkers();
  }

  const result = { executed: true, vacation: on };
  await auditActionExecuted("toggle_vacation_mode", clean, result);
  logger.info({ on }, "carter: toggle_vacation_mode executed");
  return result;
}

// ── self_restart (HMAC-signed POST to /api/admin/self-restart) ───────────────

async function proposeSelfRestart(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const summary = "This triggers a graceful backend self-restart. NSSM respawns fresh code in a few seconds; in-flight requests drop. Confirm to restart.";
  const { token } = issueConfirmation("self_restart", clean);
  return { summary, token };
}

async function confirmSelfRestart(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("self_restart", clean, tok);
  if (gate) return gate;

  const secret = process.env.ADMIN_RESTART_HMAC_SECRET;
  if (!secret) return { error: "admin_restart_secret_not_configured" };

  const reason = typeof clean.reason === "string" && clean.reason.trim()
    ? clean.reason.trim()
    : "carter_voice_self_restart";
  // body.timestamp is Unix SECONDS (admin.ts multiplies by 1000); HMAC over `${ts}:${reason}`.
  const tsSeconds = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${tsSeconds}:${reason}`, "utf8").digest("hex");
  const port = process.env.PORT ?? "4000";

  // Audit BEFORE firing — the process may die before the fetch resolves.
  await auditActionExecuted("self_restart", clean, { triggered: true, reason });

  try {
    await fetch(`http://localhost:${port}/api/admin/self-restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Restart-Signature": sig },
      body: JSON.stringify({ timestamp: tsSeconds, reason }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // Connection reset is EXPECTED — the server closes mid-request on restart.
    logger.info({ err: err instanceof Error ? err.message : String(err) }, "carter: self_restart fetch ended (restart in progress)");
  }
  logger.info({ reason }, "carter: self_restart triggered");
  return { triggered: true, reason };
}

// ── trigger_n8n_workflow (fire an n8n webhook) ───────────────────────────────

async function proposeTriggerN8nWorkflow(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const path = String(clean.workflowWebhookPath ?? "").replace(/^\/+/, "");
  const summary = `This fires the n8n webhook workflow "/webhook/${path}". It cannot create, edit, or delete workflows (that is a RED action). Confirm to trigger.`;
  const { token } = issueConfirmation("trigger_n8n_workflow", clean);
  return { summary, token };
}

async function confirmTriggerN8nWorkflow(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("trigger_n8n_workflow", clean, tok);
  if (gate) return gate;

  const path = String(clean.workflowWebhookPath ?? "").replace(/^\/+/, "");
  if (!path) return { error: "workflowWebhookPath is required" };

  // GUARDRAIL: webhook trigger paths ONLY — never the management REST API.
  // The naive prefix check is insufficient: `../../api/v1/workflows` resolves
  // past `/webhook/` to the management API. Defense in depth, 3 layers:
  const lower = path.toLowerCase();

  // Layer 1 — reject path traversal / null-byte in any form (raw or %-encoded).
  if (
    lower.includes("../") || lower.includes("..\\") ||
    lower.includes("%2e%2e") || lower.includes("%2f") || lower.includes("%5c") ||
    path.includes("\0")
  ) {
    return { error: "invalid_webhook_path", message: "Path traversal is not allowed (workflow management is a RED action)." };
  }

  // Layer 2 — reject management-path tokens anywhere, not just as a prefix.
  if (/[?#]/.test(path) || lower.includes("api/") || lower.includes("rest/") || lower.includes("webhook/")) {
    return { error: "invalid_webhook_path", message: "Only the n8n webhook trigger path segment is allowed (workflow management is a RED action)." };
  }

  const base = process.env.N8N_BASE_URL;
  if (!base) return { error: "n8n_base_url_not_configured" };

  const finalUrl = `${base}/webhook/${path}`;

  // Layer 3 — strongest: verify the RESOLVED URL still lands under /webhook/ and
  // never reaches /api/ or /rest/. Catches resolution-based escapes regardless of
  // the input string form (the URL parser normalizes `..` dot-segments).
  let parsedPath: string;
  try {
    parsedPath = new URL(finalUrl).pathname;
  } catch {
    return { error: "invalid_webhook_path", message: "Resolved webhook URL is malformed." };
  }
  const parsedLower = parsedPath.toLowerCase();
  if (!parsedLower.startsWith("/webhook/") || parsedLower.includes("/api/") || parsedLower.includes("/rest/")) {
    return { error: "invalid_webhook_path", message: "Resolved URL escapes the webhook trigger path (workflow management is a RED action)." };
  }

  const resp = await fetch(finalUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify((clean.payload as Record<string, unknown>) ?? {}),
    signal: AbortSignal.timeout(10000),
  });

  const result = { triggered: true, workflowWebhookPath: path, status: resp.status };
  await auditActionExecuted("trigger_n8n_workflow", clean, result);
  logger.info({ path, status: resp.status }, "carter: trigger_n8n_workflow executed");
  return result;
}

// ── run_quantum (quantum Monte Carlo — cloud OFF) ────────────────────────────

async function proposeRunQuantum(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const backtestId = String(clean.backtestId ?? "");
  const summary = `This runs the LOCAL quantum Monte Carlo survival simulation for backtest ${backtestId}. Cloud QPU stays OFF (challenger-only, advisory). Confirm to run.`;
  const { token } = issueConfirmation("run_quantum", clean);
  return { summary, token };
}

async function confirmRunQuantum(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("run_quantum", clean, tok);
  if (gate) return gate;

  const backtestId = String(clean.backtestId ?? "");
  if (!backtestId) return { error: "backtestId is required" };

  const { runQuantumMC } = await import("../../services/quantum-mc-service.js");
  const eventType = typeof clean.eventType === "string" ? clean.eventType : "breach";
  const firmKey = typeof clean.firmKey === "string" ? clean.firmKey : "topstep_50k";
  // GUARDRAIL: never pass optInCloud — cloud QPU stays OFF for voice-triggered runs.
  const mc = await runQuantumMC(backtestId, eventType, firmKey, {});

  const result = { executed: true, backtestId, mcRunId: (mc as Record<string, unknown>)?.id ?? null };
  await auditActionExecuted("run_quantum", clean, result);
  logger.info({ backtestId }, "carter: run_quantum executed (cloud OFF)");
  return result;
}

// ── request_lifecycle_check (lifecycle sweep) ────────────────────────────────

async function proposeRequestLifecycleCheck(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const summary = "This runs the lifecycle sweep now — auto-promotion and auto-demotion checks across all strategies. Every gate still runs inside; nothing is bypassed. Confirm to run.";
  const { token } = issueConfirmation("request_lifecycle_check", clean);
  return { summary, token };
}

async function confirmRequestLifecycleCheck(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("request_lifecycle_check", clean, tok);
  if (gate) return gate;

  // GUARDRAIL: honor pause — the sweep writes lifecycle state, audit, and SSE.
  if (!(await isPipelineActive())) return pipelinePausedPayload("request_lifecycle_check");

  const { LifecycleService } = await import("../../services/lifecycle-service.js");
  const svc = new LifecycleService();
  const [promotions, demotions] = await Promise.all([
    svc.checkAutoPromotions({}),
    svc.checkAutoDemotions({}),
  ]);

  const result = {
    executed: true,
    promotions: promotions.length,
    demotions: demotions.length,
  };
  await auditActionExecuted("request_lifecycle_check", clean, result);
  logger.info(result, "carter: request_lifecycle_check executed");
  return result;
}

// ── request_promotion (gates authoritative — NEVER forced) ───────────────────

async function proposeRequestPromotion(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const strategyId = String(clean.strategyId ?? "");
  const toState = String(clean.toState ?? "");
  const summary = `This requests promotion of strategy ${strategyId} to ${toState}. The lifecycle gates run inside the service and remain authoritative — if a gate blocks, the promotion is refused and I will read you the reason. Confirm to attempt.`;
  const { token } = issueConfirmation("request_promotion", clean);
  return { summary, token };
}

async function confirmRequestPromotion(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("request_promotion", clean, tok);
  if (gate) return gate;

  const strategyId = String(clean.strategyId ?? "");
  const toState = String(clean.toState ?? "");
  if (!strategyId) return { error: "strategyId is required" };
  if (!toState) return { error: "toState is required" };

  const [strat] = await db
    .select({ lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(eq(strategies.id, strategyId));
  if (!strat) return { error: "strategy_not_found", strategyId };
  const fromState = String(strat.lifecycleState);

  const { LifecycleService } = await import("../../services/lifecycle-service.js");
  const svc = new LifecycleService();
  // GUARDRAIL: actor="system" (NOT human_release) — Carter is non-human authority,
  // so human-required promotions (DEPLOY_READY → DEPLOYED / PILOT) stay blocked inside
  // promoteStrategy. The voice-agent attribution lives on the audit row, not the gate actor.
  const result = await svc.promoteStrategy(
    strategyId,
    fromState as Parameters<InstanceType<typeof LifecycleService>["promoteStrategy"]>[1],
    toState as Parameters<InstanceType<typeof LifecycleService>["promoteStrategy"]>[2],
    { actor: "system" },
  );

  // GUARDRAIL: a gate block is RETURNED, never forced or bypassed.
  if (!result.success) {
    const blocked = { blocked: true, reason: result.error ?? "promotion_blocked", strategyId, fromState, toState };
    await auditActionExecuted("request_promotion", clean, blocked, "failure", result.error);
    logger.warn(blocked, "carter: request_promotion blocked by gate (not forced)");
    return blocked;
  }

  const ok = { executed: true, strategyId, fromState, toState };
  await auditActionExecuted("request_promotion", clean, ok);
  logger.info(ok, "carter: request_promotion executed");
  return ok;
}

// ── rearm_scheduler_job (re-enable a disabled scheduler job) ──────────────────

async function proposeRearmSchedulerJob(params: unknown): Promise<unknown> {
  const { clean } = stripToken(params);
  const jobName = String(clean.jobName ?? "");
  const summary = `This re-enables the disabled scheduler job "${jobName}" so it resumes on its next tick. Confirm to re-arm.`;
  const { token } = issueConfirmation("rearm_scheduler_job", clean);
  return { summary, token };
}

async function confirmRearmSchedulerJob(params: unknown, token?: string): Promise<unknown> {
  const { clean, token: stripped } = stripToken(params);
  const tok = token ?? stripped;
  const gate = tokenGate("rearm_scheduler_job", clean, tok);
  if (gate) return gate;

  const jobName = String(clean.jobName ?? "");
  if (!jobName) return { error: "jobName is required" };

  const { enableJob } = await import("../../scheduler.js");
  const enabled = enableJob(jobName);
  if (!enabled) return { enabled: false, jobName, error: "job_not_found_or_not_disabled" };

  const result = { executed: true, jobName, enabled: true };
  await auditActionExecuted("rearm_scheduler_job", clean, result);
  logger.info({ jobName }, "carter: rearm_scheduler_job executed");
  return result;
}

// ─── Confirm-handler export map ────────────────────────────────────────────────
// Keys MUST match CarterTool.handler fields (tier="yellow") in tool-registry.ts.
// Confirm handlers accept (params, token?) — the route extracts token from the body
// and passes it through; propose handlers ignore the second arg.

export const CARTER_CONFIRM_HANDLERS: Record<string, (params: unknown, token?: string) => Promise<unknown>> = {
  propose_toggle_bot_power:        proposeToggleBotPower,
  confirm_toggle_bot_power:        confirmToggleBotPower,
  propose_set_learning_loop_mode:  proposeSetLearningLoopMode,
  confirm_set_learning_loop_mode:  confirmSetLearningLoopMode,
  propose_toggle_vacation_mode:    proposeToggleVacationMode,
  confirm_toggle_vacation_mode:    confirmToggleVacationMode,
  propose_self_restart:            proposeSelfRestart,
  confirm_self_restart:            confirmSelfRestart,
  propose_trigger_n8n_workflow:    proposeTriggerN8nWorkflow,
  confirm_trigger_n8n_workflow:    confirmTriggerN8nWorkflow,
  propose_run_quantum:             proposeRunQuantum,
  confirm_run_quantum:             confirmRunQuantum,
  propose_request_lifecycle_check: proposeRequestLifecycleCheck,
  confirm_request_lifecycle_check: confirmRequestLifecycleCheck,
  propose_request_promotion:       proposeRequestPromotion,
  confirm_request_promotion:       confirmRequestPromotion,
  propose_rearm_scheduler_job:     proposeRearmSchedulerJob,
  confirm_rearm_scheduler_job:     confirmRearmSchedulerJob,
};
