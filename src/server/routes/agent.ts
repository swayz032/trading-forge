import { Router } from "express";
import { z } from "zod";
import { randomUUID, createHash } from "crypto";
import { AgentService } from "../services/agent-service.js";
import { analyzeMarket } from "../services/regime-service.js";
import { synthesizeV11FromGemmaProse } from "../lib/gemma-prose-to-v11.js";
import { extractSpeakerConceptsFromTranscript } from "../lib/transcript-speaker-concepts.js";
import { classifyMechanicPortability, explainRejectClass } from "../lib/mechanic-portability.js";
import { runPass1VocabularyExtraction } from "../lib/two-pass-vocab-extractor.js";
import { runCoverageGate } from "../lib/extraction-coverage-gate.js";
import { recoverConfluences } from "../lib/confluence-recovery.js";
import { runRecallPass } from "../lib/transcript-extractor-recall.js";
import { runCoverageRepairLoop } from "../lib/extraction-coverage-repair.js";
import { checkCompilabilityGate } from "../lib/extraction-quality-gate.js";
import { deriveEntryIndicator } from "../services/direct-bucket-graduator.js";
import { extractSessionFromTranscript, sessionFilterLabel } from "../lib/session-filter.js";
import { classifyDirectionFromTranscript } from "../lib/direction-parity.js";
import { scanIndicatorParams } from "../lib/indicator-params.js";
import { runRobustnessTest } from "../services/robustness-service.js";
import { db } from "../db/index.js";
// Wave hardening 2026-06-22: agentJobs is the mutable job-state table.
// audit_log is append-only (migration 0058 trigger) — UPDATEs/DELETEs on
// audit_log rows throw "audit_log is append-only". Job lifecycle state now
// lives in agent_jobs; audit_log receives immutable event rows only.
import { auditLog, agentJobs, strategyPendingBuckets, strategyPendingMentions, systemJournal, strategies } from "../db/schema.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { eq, desc, and, sql, inArray, countDistinct } from "drizzle-orm";
import { OllamaClient } from "../services/ollama-client.js";
import { callOpenAI, callOpenAIOrFallback, callScoutExtractLlm } from "../services/model-router.js";
import {
  extractTranscriptChunked,
  shouldChunk as shouldChunkTranscript,
  CHUNKING_THRESHOLD_CHARS,
} from "../lib/transcript-chunker.js";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { requireLiveN8n } from "../middleware/require-live-n8n.js";
import { computeFingerprintHash, computeConceptFingerprintHash, computeQuarantineFingerprintHash, normalizeConceptName, extractEntryArchetype, normalizeExitType } from "../services/strategy-fingerprint.js";
import { quarantineExtraction } from "../lib/quarantine-extraction.js";
import { runParallelDiscovery } from "../services/parallel-broker.js";
import { runExaDiscovery } from "../services/exa-broker.js";
import { runBraveDiscovery } from "../services/brave-search-broker.js";
// Track O (deepscan11, 2026-07-02): grounding enforcement — verifies numeric params
// are present in the source transcript before accepting into the conveyor.
import { checkNumericGrounding } from "../lib/extraction-grounding.js";
import { broadcastSSE } from "./sse.js";
import { notifyInfo } from "../services/notification-service.js";
import {
  crossValidatorCallsTotal,
  crossValidatorLatencySeconds,
  pendingBucketsGraduatedTotal,
  pendingBucketsTotal,
} from "../lib/metrics-registry.js";

// ─── Correlation ID helper ───────────────────────────────────────
// Extracts or generates a correlation ID for the current request.
// Follows the standard pattern: x-correlation-id header → req.id → new UUID.
function getCorrelationId(req: import("express").Request): string {
  const header = req.headers["x-correlation-id"];
  if (typeof header === "string" && header.length > 0) return header;
  if (typeof (req as any).id === "string") return (req as any).id;
  return randomUUID();
}

// ─── W23G.3 Structural Archetype Detection ──────────────────────────────────
// Exported so the detection logic can be unit-tested independently of the
// full HTTP route handler. Used by the W23F.S missing_params recovery branch.
//
// Archetype priority order (most-specific first):
//   - wyckoff_spring/upthrust before wyckoff (broad Wyckoff terms)
//   - judas_swing / silver_bullet before generic breaker / fvg
//   - fvg before generic ICT terms
//
// Returns the archetype name + matched keyword list, or null if nothing matched.
//
export const STRUCTURAL_ARCHETYPE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["liquidity_sweep",  /\b(liquidity\s+sweep|BSL|SSL|buyside\s+liquidity|sellside\s+liquidity|stop\s+hunt)\b/i],
  ["order_block",      /\b(order\s+block|institutional\s+level|bullish\s+OB|bearish\s+OB)\b|(?<!\w)OB\s/i],
  ["fvg",              /\b(fair\s+value\s+gap|FVG|imbalance|displacement)\b/i],
  ["wyckoff_spring",   /\b(wyckoff\s+spring|spring\s+pattern|accumulation\s+spring)\b/i],
  ["wyckoff_upthrust", /\b(upthrust|UTAD|wyckoff\s+distribution)\b/i],
  ["judas_swing",      /\b(judas\s+swing|false\s+breakout\s+london)\b/i],
  ["silver_bullet",    /\b(silver\s+bullet|ICT\s+silver\s+bullet|10\s*am\s+ny)\b/i],
  ["breaker_block",    /\b(breaker\s+block|breaker\b)\b/i],
] as const;

export function detectStructuralArchetype(
  searchText: string,
): { archetypeName: string; matchedKeywords: string[] } | null {
  for (const [archetypeName, pattern] of STRUCTURAL_ARCHETYPE_PATTERNS) {
    const matches = searchText.match(new RegExp(pattern.source, "gi"));
    if (matches && matches.length > 0) {
      const matchedKeywords = [...new Set(matches.map((m) => m.trim().toLowerCase()))].slice(0, 5);
      return { archetypeName, matchedKeywords };
    }
  }
  return null;
}

export const agentRoutes = Router();
const agentService = new AgentService();

// ─── Strategy Validation Constants ──────────────────────────────
// Known ICT concepts that have cross-validated specs
const KNOWN_ICT_CONCEPTS = [
  "silver_bullet", "smt_reversal", "judas_swing", "ict_2022",
  "ote", "breaker", "turtle_soup", "iofed",
  "midnight_open", "ny_lunch_reversal", "eqhl_raid",
] as const;

/**
 * Run Python static validation on strategy code against its concept spec.
 * Returns { passed: boolean, errors: string[], warnings: string[] }
 * Uses runPythonModule (async spawn) instead of blocking execSync.
 */
async function runPythonValidation(
  pythonCode: string,
  conceptName: string,
): Promise<{ passed: boolean; errors: string[]; warnings: string[] }> {
  try {
    const result = await runPythonModule<{ passed: boolean; errors: string[]; warnings: string[] }>({
      scriptCode: `
import json, sys, os
sys.path.insert(0, '.')
from src.engine.validation import load_spec, validate_static_from_code
# Read config from --config temp file (avoids CLI length limits for python_code)
config_path = sys.argv[sys.argv.index('--config') + 1]
with open(config_path, 'r') as f:
    cfg = json.load(f)
spec = load_spec(cfg['concept_name'])
result = validate_static_from_code(cfg['python_code'], spec)
print(json.dumps({"passed": result.passed, "errors": result.errors, "warnings": result.warnings}))
`,
      config: { concept_name: conceptName, python_code: pythonCode },
      timeoutMs: 10_000,
      componentName: "strategy-validation",
    });
    return result;
  } catch {
    // If validation can't run, let the strategy through (fail-open)
    return { passed: true, errors: [], warnings: ["Validation could not run"] };
  }
}

// ─── Validation Schemas ──────────────────────────────────────────

const symbolEnum = z.enum(["MES", "MNQ", "MCL"]);

const runStrategySchema = z.object({
  strategy_name: z.string().min(1),
  one_sentence: z.string().min(1),
  python_code: z.string().min(1),
  params: z.record(z.unknown()).refine(
    (obj) => Object.keys(obj).length <= 5,
    { message: "Maximum 5 parameters" }
  ),
  symbol: symbolEnum,
  timeframe: z.string().min(1),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["ollama", "openclaw", "manual"]).default("ollama"),
});

const critiqueSchema = z
  .object({
    backtestId: z.string().uuid().optional(),
    results: z.record(z.unknown()).optional(),
    model: z.string().optional().default("llama3.1:8b"),
  })
  .refine((data) => data.backtestId || data.results, {
    message: "Either backtestId or results must be provided",
  });

const batchSchema = z.object({
  strategies: z.array(runStrategySchema).min(1).max(20),
});

const analyzeMarketSchema = z.object({
  symbol: symbolEnum,
  timeframe: z.string().default("1h"),
  adx_period: z.number().int().min(5).max(50).default(14),
});

const robustnessSchema = z.object({
  strategy_id: z.string().uuid(),
  config: z.record(z.unknown()),
  n_trials: z.number().int().min(10).max(5000).default(800),
});

const findStrategiesSchema = z.object({
  symbol: symbolEnum,
  timeframe: z.string().default("1h"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  count: z.number().int().min(1).max(10).default(5),
});

const scoutIdeaSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().optional(),
  source_quality: z.enum(["high", "medium", "low"]).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  instruments: z.array(z.string()).optional(),
  indicators_mentioned: z.array(z.string()).optional(),
  // Pass 4: signal_type discriminates strategy_candidate vs market_news_intel
  // vs research_find. Backward-compatible default = "strategy_candidate"
  // applied at write time in agent-service.scoutIdeas.
  signal_type: z.enum(["strategy_candidate", "market_news_intel", "research_find"]).optional(),
  // Optional fields used by Tier-1 regex pre-filter (Pass 4). Surfaced here
  // so n8n workflows can submit strict-shape ideas through the legacy route
  // and still get screened.
  entry_rules: z.string().optional(),
  concept_name: z.string().optional(),
});

const scoutSchema = z.object({
  ideas: z.array(scoutIdeaSchema).min(1),
});

// Strict scout schema — every field required. Used by the search-router
// pipeline (POST /api/agent/scout-ideas/strict). Off-schema submissions get
// 400'd, which is what stops OpenClaw's free-form chatter from leaking into
// the journal and downstream Discord channels.
const strictScoutIdeaSchema = z.object({
  thesis: z.string().min(20).max(2000),
  market: z.string().min(1),               // ES | NQ | CL | etc.
  timeframe: z.string().min(1),            // 5m | 15m | 1h | etc.
  entry_rules: z.string().min(20).max(2000),
  exit_rules: z.string().min(20).max(2000),
  risk_rules: z.string().min(10).max(1000),
  source_url: z.string().url(),
  regime: z.string().min(1),               // TRENDING_UP | RANGE_BOUND | etc.
  concept_name: z.string().min(1),         // canonical concept (e.g. "trend_follow_breakout")
  // Pass 19: added "graduated_bucket" — the ONLY source that may create a
  // strategy row. External callers that pass any other value get HTTP 423.
  source_provider: z.enum(["brave", "tavily", "exa", "parallel", "reddit", "manual", "graduated_bucket"]),
  confidence_score: z.number().min(0).max(1).optional(),
  // Pass 4: signal_type optional on strict schema as well. Default treatment
  // = "strategy_candidate". 5M news-intel runs will set "market_news_intel".
  signal_type: z.enum(["strategy_candidate", "market_news_intel", "research_find"]).optional(),
  // Pass 19: bucket_id propagated from graduation so runStrategyFromDSL can
  // backfill graduated_strategy_id on the bucket immediately after row insert.
  bucket_id: z.string().optional(),
});

const strictScoutSchema = z.object({
  ideas: z.array(strictScoutIdeaSchema).min(1).max(50),
});

// ─── POST /api/agent/run-strategy ────────────────────────────────

agentRoutes.post("/run-strategy", idempotencyMiddleware, async (req, res) => {
  const parsed = runStrategySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const strategyName = parsed.data.strategy_name.toLowerCase().replace(/-/g, "_");

  // ─── Validation gate: known ICT concepts ────────────────
  if (KNOWN_ICT_CONCEPTS.includes(strategyName as any)) {
    try {
      const validation = await runPythonValidation(parsed.data.python_code, strategyName);
      if (!validation.passed) {
        res.status(422).json({
          error: "strategy_validation_failed",
          concept: strategyName,
          errors: validation.errors,
          warnings: validation.warnings,
        });
        return;
      }
    } catch (err) {
      logger.error({ err, strategyName }, "Validation gate error — blocking strategy (fail-closed)");
      res.status(500).json({
        error: "strategy_validation_error",
        concept: strategyName,
        message: "Validation crashed — strategy blocked. Fix validation before retrying.",
      });
      return;
    }
  }

  // ─── Cross-validation gate: unknown concepts ────────────
  // If strategy claims to be an ICT concept but we don't have a spec → reject
  const ictPatterns = /\b(ict|smc|order.?block|fvg|breaker|sweep|liquidity)\b/i;
  if (!KNOWN_ICT_CONCEPTS.includes(strategyName as any) && ictPatterns.test(parsed.data.one_sentence)) {
    logger.info({ strategyName }, "Unknown ICT concept — rejected (no cross-validated spec)");
    res.status(400).json({
      error: "Unknown ICT concept",
      concept: strategyName,
    });
    return;
  }

  // Fire and forget
  agentService.runStrategy(parsed.data).catch((err) => {
    logger.error({ err, strategy: parsed.data.strategy_name }, "Fire-and-forget run-strategy failed");
  });

  res.status(202).json({ message: "Strategy submitted" });
});

// ─── POST /api/agent/critique ────────────────────────────────────

agentRoutes.post("/critique", async (req, res) => {
  const parsed = critiqueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.critiqueResults(parsed.data);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/batch ───────────────────────────────────────

agentRoutes.post("/batch", idempotencyMiddleware, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.batchSubmit(parsed.data.strategies).catch((err) => {
    logger.error({ err }, "Fire-and-forget batch submit failed");
  });

  res.status(202).json({ count: parsed.data.strategies.length, message: "Batch submitted" });
});

// ─── POST /api/agent/run-from-dsl ────────────────────────────────
// M1+M3 fix — single-call endpoint that compiles a full StrategyDSL,
// persists the strategy, and runs the backtest. n8n's Strategy_Generation_Loop
// "Submit Backtest" node should call THIS instead of /api/backtests (which
// requires a pre-existing strategyId and was the M1 blocker).

const runFromDslSchema = z.object({
  dsl: z.record(z.unknown()),
  source: z.enum(["ollama", "openclaw", "manual"]).default("openclaw"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

agentRoutes.post("/run-from-dsl", idempotencyMiddleware, async (req, res) => {
  const parsed = runFromDslSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }
  try {
    const result = await agentService.runStrategyFromDSL(
      parsed.data.dsl,
      { source: parsed.data.source, start_date: parsed.data.start_date, end_date: parsed.data.end_date },
    );
    if (result.status === "compile_failed") {
      res.status(422).json({ ...result, error: "DSL did not compile" });
      return;
    }
    if (result.skipped) {
      res.status(202).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "run-from-dsl failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/run-class-strategy ──────────────────────────
// Run a class-based strategy (BaseStrategy subclass) through the backtest engine

const runClassStrategySchema = z.object({
  strategy_name: z.string().min(1),
  strategy_class: z.string().min(1),  // e.g. "src.engine.strategies.breaker.BreakerStrategy"
  symbol: symbolEnum,
  timeframe: z.string().default("15min"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["manual", "ollama", "openclaw"]).default("manual"),
  description: z.string().default(""),
  params: z.record(z.unknown()).default({}),
});

agentRoutes.post("/run-class-strategy", idempotencyMiddleware, async (req, res) => {
  const parsed = runClassStrategySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Fire and forget
  agentService.runClassStrategy(parsed.data).catch((err) => {
    logger.error({ err, strategy_class: parsed.data.strategy_class }, "run-class-strategy failed");
  });

  res.status(202).json({ message: "Class strategy submitted", strategy_class: parsed.data.strategy_class });
});

// ─── POST /api/agent/scout-ideas ─────────────────────────────────
// LEGACY: loose schema, retained for the existing 5G/5H/5I scout workflows.
// New pipelines (Wave C4 search-router) MUST use /scout-ideas/strict.

agentRoutes.post("/scout-ideas", idempotencyMiddleware, async (req, res) => {
  const parsed = scoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await agentService.scoutIdeas(parsed.data.ideas, { correlationId: req.id ?? undefined });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "scout-ideas failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/scout-ideas/strict ──────────────────────────
// Pass 19: Cross-validation gate — only calls with source_provider='graduated_bucket'
// are allowed to create strategy rows. Direct scout calls from external sources
// are rejected with HTTP 423 ("Cross-validation required: post via /scout-ideas/pending
// instead."). Internal graduation calls from runGraduation() use 'graduated_bucket'.
//
// Original: accepted all scout providers directly, creating journal entries + strategies.
// New:      only accepts 'graduated_bucket' as source_provider; all others → 423.
//
// Enforces the full structured contract — anything off-schema gets 400'd.
// This is what stops OpenClaw's free-form chatter from leaking into the
// journal and downstream Discord channels.

agentRoutes.post("/scout-ideas/strict", requireLiveN8n({ soft: true }), async (req, res) => {
  const parsed = strictScoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — strict scout schema not satisfied",
      details: parsed.error.issues,
      hint: "Required fields: thesis, market, timeframe, entry_rules, exit_rules, risk_rules, source_url, regime, concept_name, source_provider",
    });
    return;
  }

  // Pass 19: Cross-validation gate — reject any call where the ideas do not
  // come from the graduated_bucket path. This is the hard enforcement that
  // no strategy row is created without cross-validation provenance.
  const nonGraduated = parsed.data.ideas.filter((i) => i.source_provider !== "graduated_bucket");
  if (nonGraduated.length > 0) {
    const blockedProviders = [...new Set(nonGraduated.map((i) => i.source_provider))];
    logger.info(
      { blockedProviders, count: nonGraduated.length },
      "scout-ideas/strict: rejected non-graduated_bucket call (Pass 19 gate)",
    );
    res.status(423).json({
      error: "Cross-validation required: post via /scout-ideas/pending instead.",
      reason: "pass19_cross_validation_required",
      blocked_providers: blockedProviders,
      hint: "All scout ideas must accumulate ≥3 distinct-source confirmations in the pending bucket before reaching the strategies table.",
    });
    return;
  }

  // M5 fix — collapse provider sources into the legacy enum so downstream
  // runStrategyFromDSL doesn't choke on graduated_bucket.
  // Original provider stays in `tags` for traceability.
  //
  // Pass 21: Stop coercing graduated_bucket entries to "openclaw" — preserve
  // the source on the journal row so periodic drain auto-detects it without
  // needing override or bucket_id in params. The earlier fall-through hid the
  // graduated provenance from drainScoutedIdeas's auto-detect path.
  const legacyShaped = parsed.data.ideas.map((i) => {
    const isGraduated = i.source_provider === "graduated_bucket";
    return {
      source: (isGraduated ? "graduated_bucket" : "openclaw") as "openclaw" | "graduated_bucket",
      title: i.thesis.slice(0, 200),
      description: `${i.thesis}\n\nEntry: ${i.entry_rules}\nExit: ${i.exit_rules}\nRisk: ${i.risk_rules}\nRegime: ${i.regime}`,
      url: i.source_url,
      source_quality: "high" as const,
      confidence_score: i.confidence_score,
      instruments: [i.market],
      indicators_mentioned: [i.concept_name, `provider:${i.source_provider}`],
      // Pass 19: carry bucket_id through so drainScoutedIdeas → runStrategyFromDSL
      // can backfill graduated_strategy_id on the bucket immediately.
      bucket_id: (i as any).bucket_id ?? undefined,
    };
  });

  try {
    const result = await agentService.scoutIdeas(legacyShaped, { correlationId: req.id ?? undefined });

    // M4 fix — fire-and-forget drain so strict scouts don't dead-end in journal.
    // Pass 19: drainScoutedIdeas now passes source='graduated_bucket' so the
    // assertCrossValidatedSource guard in runStrategyFromDSL passes.
    agentService
      .drainScoutedIdeas(parsed.data.ideas.length, { source: "graduated_bucket", bucketId: (parsed.data.ideas[0] as any).bucket_id ?? undefined })
      .catch((err) => req.log.warn({ err }, "scout-ideas/strict: post-scout drain failed"));

    res.status(201).json({ ...result, schema: "strict", drainTriggered: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/transcript-extract ──────────────────────────
// Pass 5 Branch D — receives YouTube transcript from 5O n8n workflow,
// runs GPT-5-mini transcript_extractor role to extract candidate strategies,
// returns array of strategies (each enriched with source_url + provider).
// Caller (5O) is responsible for posting each strategy to /scout-ideas/strict.

const transcriptExtractSchema = z.object({
  youtubeUrl: z.string().url(),
  title: z.string().min(1).max(500),
  channel: z.string().optional().default(""),
  transcript: z.string().min(200),
});

agentRoutes.post("/transcript-extract", idempotencyMiddleware, async (req, res) => {
  const parsed = transcriptExtractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { youtubeUrl, title, channel, transcript } = parsed.data;
  const truncated = transcript.slice(0, 8000);
  const userPayload = JSON.stringify({
    youtube_url: youtubeUrl,
    title,
    channel,
    transcript_text: truncated,
  });

  try {
    const raw = await callOpenAI("transcript_extractor", [
      { role: "user", content: userPayload },
    ]);

    if (!raw) {
      // Cloud unavailable / circuit open / empty response — return empty list,
      // never error the n8n workflow.
      res.status(200).json({ strategies: [] });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      logger.warn({ err, youtubeUrl }, "transcript-extract: model returned non-JSON");
      res.status(200).json({ strategies: [] });
      return;
    }

    const strategiesIn = (parsedJson as { strategies?: unknown }).strategies;
    if (!Array.isArray(strategiesIn)) {
      res.status(200).json({ strategies: [] });
      return;
    }

    const strategies = strategiesIn.map((s) => ({
      ...(s as Record<string, unknown>),
      source_url: youtubeUrl,
      source_provider: "youtube-transcript",
    }));

    res.json({ strategies });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, youtubeUrl }, "transcript-extract failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/scout-extract ───────────────────────────────
// Pass 16 — receives crawled web markdown (Brave News page bodies, Tavily
// blog crawl output, parallel/exa results) from the 5L/5M/5J n8n workflows,
// runs the GPT-5-mini transcript_extractor role (re-used: same job —
// "extract a complete systematic strategy from long-form text"), and
// returns ready-to-forward strict-scout ideas.
//
// Why re-use transcript_extractor instead of a new role:
//   - Identical job: read prose, extract MES/MNQ/MCL strategies, SKIP if incomplete.
//   - Conservative-skip behavior already baked in (won't fabricate params).
//   - KB cards (strategy-schema-snapshot + indicator-catalog) already attached.
//   - Avoids prompt sprawl and new token-budget allocation.
//
// Caller (n8n) is responsible for posting each returned idea to
// /scout-ideas/strict one-at-a-time, throttled by a 3s Wait, to respect
// the backend rate limiter that 5M Brave News was previously tripping.

const scoutExtractSchema = z.object({
  sourceUrl: z.string().url(),
  markdown: z.string().min(80).max(100_000), // 100KB guard; short Brave snippets allowed — model returns empty if insufficient
  sourceProvider: z.enum(["brave", "tavily", "parallel", "exa"]),
  title: z.string().max(500).optional().default(""),
});

// Strategy LOGIC is identical across contract sizes — opening range breakout on
// ES is the SAME setup on MES. Per operator directive (Pass 19 Track F), ES/NQ/CL
// articles are valid strategy sources; we auto-remap to the micro symbol so the
// safe (1/10th contract size) version is what lands in the strategies table.
// CLAUDE.md §13 Don't rule applies to LIVE EXECUTION contract sizing, not to
// strategy ideation. The DSL stores micro symbol; position sizing math uses
// MICRO point values, preserving the safety guarantee.
const MARKET_REMAP: Record<string, "MES" | "MNQ" | "MCL"> = {
  MES: "MES", MNQ: "MNQ", MCL: "MCL",
  ES:  "MES", NQ:  "MNQ", CL:  "MCL",
  "/ES": "MES", "/NQ": "MNQ", "/CL": "MCL",
  "ES1!": "MES", "NQ1!": "MNQ", "CL1!": "MCL",
  EMINI_SP: "MES", EMINI_NQ: "MNQ",
  SPY: "MES",  // SPY equity strategies translate to MES (same underlying SPX index)
  QQQ: "MNQ",  // QQQ equity strategies translate to MNQ (same underlying NDX index)
};

// Wave 10: ES→MES, NQ→MNQ, CL→MCL conversions lose 90% of dollar-risk exposure
// because point values differ 10× (ES=$50/pt → MES=$5/pt). Any max_contracts
// authored against a mini symbol must be multiplied by 10× when remapped to the
// micro equivalent so the intended dollar-risk is preserved.
//
// Already-micro symbols (MES/MNQ/MCL) and non-futures proxies (SPY/QQQ) are 1×
// because the source contract size already refers to the micro instrument.
const MARKET_SIZE_MULTIPLIER: Record<string, number> = {
  // Mini → Micro: 10× (point value ratio is exactly 10 for all three pairs)
  ES: 10, NQ: 10, CL: 10,
  "/ES": 10, "/NQ": 10, "/CL": 10,
  "ES1!": 10, "NQ1!": 10, "CL1!": 10,
  EMINI_SP: 10, EMINI_NQ: 10,
  // Already micro or equity proxy → 1× (no scale needed)
  MES: 1, MNQ: 1, MCL: 1,
  SPY: 1, QQQ: 1,
};

interface RemapResult {
  market: "MES" | "MNQ" | "MCL";
  /** Multiply any max_contracts / base_contracts / tier_increment by this value. */
  sizeMultiplier: number;
}

function remapMarket(raw: string): RemapResult | null {
  const k = String(raw ?? "").toUpperCase().trim();
  const market = MARKET_REMAP[k] ?? null;
  if (!market) return null;
  const sizeMultiplier = MARKET_SIZE_MULTIPLIER[k] ?? 1;
  return { market, sizeMultiplier };
}

// Wave 26 Pass K Phase 7 (2026-05-27) — Cross-market mechanic fallback.
// When the speaker demos on a non-MES/MNQ/MCL symbol (EURUSD, GBPUSD, AAPL,
// BTC, etc.) but the strategy mechanics PORT (per feedback_extractor_any_strategy_
// no_catalog_gate + mechanic-portability.ts), default the symbol to MES so the
// strategy survives extraction. The 3-symbol fan-out in admin.ts will then graduate
// it as MES + MNQ + MCL variants. Returning null here means "drop the strategy
// entirely" which contradicts the user's explicit cross-market rule.
//
// Patterns matched here are KNOWN demo symbols speakers commonly use that don't
// map to micro futures: forex (EURUSD/GBPUSD/USDJPY etc.), single-name stocks
// (AAPL/TSLA/MSFT/etc.), crypto (BTC/ETH/SOL), broad-market ETFs (SPY/QQQ),
// and major-index futures (ES/NQ/CL — these route to MES/MNQ/MCL via existing
// MARKET_REMAP). When raw matches the cross-market list AND the strategy's
// mechanic is portable (caller checks mechanicPortable upstream), default to MES.
const CROSS_MARKET_DEMO_SYMBOLS = new Set([
  // Major forex pairs
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "USDCAD", "NZDUSD", "EURJPY",
  "GBPJPY", "EURGBP", "AUDJPY", "EURAUD", "EURCHF", "XAUUSD",
  // Major single-name stocks
  "AAPL", "MSFT", "GOOGL", "GOOG", "TSLA", "NVDA", "AMZN", "META", "AMD", "NFLX",
  "GME", "AMC", "PLTR", "COIN",
  // Major crypto
  "BTC", "BTCUSD", "BTCUSDT", "XBTUSD", "ETH", "ETHUSD", "ETHUSDT", "SOL", "SOLUSD",
  "BNB", "ADA", "DOGE", "MATIC",
  // Broad-market ETFs (SPY/QQQ commonly used as index-futures-portable demos)
  "SPY", "QQQ", "IWM", "DIA", "GLD", "SLV", "USO", "TLT",
]);

// Wave 26 Pass L (2026-05-27) — Direction inference from entry_rule.
// The minimal-prompt extractor dropped `direction` from the schema (gemma now
// only emits the speaker's edge — entry rule, timeframes, stop, confluences).
// This helper derives direction from the entry_rule prose by scanning for
// long/short keywords. Defaults to "both" per the operator's mandate that most
// strategies are bidirectional.
//
// Returns "long" | "short" | "both". Always returns a value (never null).
// Bias rules:
//   - both long AND short keywords → "both"
//   - only long keywords           → "long"
//   - only short keywords          → "short"
//   - neither → "both" (operator default; bidirectional setup gate will
//     reject downstream if both entry sides aren't actually populated, so
//     wrong default is caught not silently shipped)
function inferDirectionFromEntryRule(entryRule: string | undefined | null): "long" | "short" | "both" {
  if (!entryRule || typeof entryRule !== "string") return "both";
  const text = entryRule.toLowerCase();
  // Long-side signals
  const longHit = /\b(?:buy|long|bullish|uptrend|higher highs?|bull(?:ish)?\s+(?:close|candle|bar)|go(?:ing)?\s+long|take\s+(?:a\s+)?long)\b/.test(text);
  // Short-side signals
  const shortHit = /\b(?:sell|short|bearish|downtrend|lower lows?|bear(?:ish)?\s+(?:close|candle|bar)|go(?:ing)?\s+short|take\s+(?:a\s+)?short)\b/.test(text);
  if (longHit && shortHit) return "both";
  if (longHit && !shortHit) return "long";
  if (shortHit && !longHit) return "short";
  return "both"; // operator default — most strategies trade both ways
}

function isCrossMarketDemoSymbol(raw: string): boolean {
  const k = String(raw ?? "").toUpperCase().trim();
  return CROSS_MARKET_DEMO_SYMBOLS.has(k);
}

// Pass 21 — CLAUDE.md §13 hard block: Trading Forge trades MES/MNQ/MCL micro
// futures EXCLUSIVELY. Options strategies (straddles, strangles, iron condors,
// calendar spreads, etc.) violate the framework even when discovered alongside
// futures content. Volatilitybox-style "use micro futures FOR volatility/options
// trading" articles also contaminate buckets because they conflate options
// edges with futures execution. This filter blocks the whole extraction
// payload — not just one idea — when options-strategy markers appear.
//
// Conservative: matches whole-word options-derivative terms ONLY. Won't catch
// "volatility" alone (legit futures concept) but DOES catch "selling premium",
// "iron condor", "credit spread", "covered call", etc.
const OPTIONS_FORBIDDEN_PATTERNS = [
  /\b(straddle|strangle|iron condor|iron butterfly|butterfly spread|calendar spread|diagonal spread|credit spread|debit spread|vertical spread|covered call|cash[- ]secured put|short put|short call|naked call|naked put|protective put|protective call|collar(?!\s*back)|ratio spread|jade lizard|broken wing)s?\b/i,
  /\bsell(?:ing)?\s+(?:the\s+)?(?:premium|option|put|call)\b/i,
  /\bbuy(?:ing)?\s+(?:the\s+)?(?:straddle|strangle|put|call|premium)\b/i,
  /\b(?:options?\s+(?:trader|strateg|premium|chain|expiration|expir))/i,
  /\b(?:theta|delta|gamma|vega)\s+(?:harvest|decay|trade|strategy)\b/i,
  /\b(?:0DTE|weekly|monthly)\s+(?:options?|expir)/i,
];

function containsForbiddenOptionsContent(text: string): { blocked: boolean; matched?: string } {
  if (!text) return { blocked: false };
  for (const p of OPTIONS_FORBIDDEN_PATTERNS) {
    const m = text.match(p);
    if (m) return { blocked: true, matched: m[0] };
  }
  return { blocked: false };
}

agentRoutes.post("/scout-extract", idempotencyMiddleware, async (req, res) => {
  // The multi-pass extraction pipeline (windowed-enum → recall → depth-coverage → bounded
  // repair → name/route) issues 10-15 sequential local-gemma calls; on the 8GB tower GPU a
  // single video can run 5-20 min. The server's default socket timeout (index.ts:618,
  // server.timeout = 5 min) destroys the connection mid-pipeline because no bytes flow while
  // gemma is generating — surfacing client-side as the bare "fetch failed" / RemoteDisconnected
  // we chased. Opt THIS request's socket out of the 5-min default (mirrors the SSE route's
  // req.setTimeout(0) at index.ts:615-617). 25-min bound, not 0, so a truly-hung pipeline
  // still releases the socket eventually rather than leaking it.
  req.setTimeout(25 * 60 * 1000);
  res.setTimeout(25 * 60 * 1000);

  const parsed = scoutExtractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Pass 21 — CLAUDE.md §13 hard block at INPUT: if the markdown contains
  // options-derivative content, refuse to even run the LLM. Saves tokens AND
  // prevents the extractor from leaking options strategies into downstream
  // buckets. URL-level filter too — block obviously options-themed sources.
  const optionsCheck = containsForbiddenOptionsContent(parsed.data.markdown);
  const urlCheck = containsForbiddenOptionsContent(parsed.data.sourceUrl);
  if (optionsCheck.blocked || urlCheck.blocked) {
    logger.warn(
      { sourceUrl: parsed.data.sourceUrl, matched: optionsCheck.matched ?? urlCheck.matched },
      "scout-extract: CLAUDE.md §13 block — options-derivative content rejected"
    );
    res.status(200).json({
      extracted: false,
      reason: "options_content_forbidden",
      matched: optionsCheck.matched ?? urlCheck.matched,
      ideas: [],
    });
    return;
  }

  const { sourceUrl, markdown, sourceProvider, title } = parsed.data;
  const correlationId: string | null = (req as { id?: string }).id ?? null;

  // W3.3 — Extraction lineage key: video_id + transcript_hash + extractor_version.
  // Stable composite key for replay/audit idempotency. The same video + transcript
  // content + extractor model version will always produce the same lineage key,
  // so re-extractions can be correlated across time.
  //   - video_id: last segment of sourceUrl (YouTube video ID when available,
  //     URL hash otherwise — deterministic regardless of URL format)
  //   - transcript_hash: SHA-256(markdown) truncated to 16 hex chars (64-bit)
  //   - extractor_version: local model name (e.g. "gemma4:e4b-it-qat")
  const _extractorVersion = process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e4b-it-qat";
  const _transcriptHash = createHash("sha256").update(markdown, "utf8").digest("hex").slice(0, 16);
  const _videoId = (() => {
    try {
      const u = new URL(sourceUrl);
      const v = u.searchParams.get("v");
      if (v) return v;
      const seg = u.pathname.split("/").filter(Boolean).pop();
      return seg ?? createHash("sha256").update(sourceUrl, "utf8").digest("hex").slice(0, 12);
    } catch {
      return createHash("sha256").update(sourceUrl, "utf8").digest("hex").slice(0, 12);
    }
  })();
  const extractionLineageKey = `${_videoId}:${_transcriptHash}:${_extractorVersion}`;

  // Pass 21 Fix #2: chunked extraction. Many YouTube transcripts (and long
  // articles) ramble for 3-5 minutes before specifics. A single 12K-char window
  // anchored at the start misses the meat. We try the full window first; on
  // empty result, fall back to 3 overlapping 4K-char chunks (start/mid/end)
  // and merge unique strategies by concept_name (W23G.7: threshold now 12K).
  // Sentinel: extractFromChunk returns this symbol when the model response
  // is not valid JSON. Distinguishes "garbage response" (non_json) from
  // "valid JSON with empty strategies array" (no_strategy_content).
  const NON_JSON_SENTINEL = Symbol("non_json");

  // Wave 11 — capture LLM-provided `empty_reason` when strategies array is empty.
  // The prompt v7 requires the LLM to populate one of 8 categories so future tuning
  // can see WHICH content type is being dropped. Each chunk may overwrite; if any
  // chunk yielded strategies we discard the captured reason.
  const VALID_EMPTY_REASONS = new Set([
    "no_strategy_content", "portfolio_theory", "missing_params",
    "promotional", "wrong_instrument", "speaker_uncertain",
    "transcript_corrupt", "other",
  ]);

  // W23G.2 — capture `instrument_classification` from the LLM response.
  // Valid values: "futures_primary" | "futures_with_forex_illustration" | "non_futures_primary".
  // The first non-null classification from any chunk wins (first pass is authoritative).
  const VALID_INSTRUMENT_CLASSIFICATIONS = new Set([
    "futures_primary", "futures_with_forex_illustration", "non_futures_primary",
  ]);
  let lastInstrumentClassification: string | null = null;

  let lastEmptyReason: string | null = null;
  let lastEmptyReasonDetail: string | null = null;
  // Track O (deepscan11, 2026-07-02): capture rejected_strategies from minimal
  // schema responses. Minimal schema emits rejected_strategies[] (with reason enum)
  // instead of the legacy empty_reason string — needed for FIX 5 audit visibility.
  let lastRejectedStrategies: Array<{ name?: string | null; reason: string; detail?: string | null }> = [];
  async function extractFromChunk(chunk: string): Promise<unknown[] | typeof NON_JSON_SENTINEL | null> {
    const userPayload = JSON.stringify({
      youtube_url: sourceUrl,
      title: title || sourceUrl,
      channel: sourceProvider,
      transcript_text: chunk,
    });
    // W23G.9: use callScoutExtractLlm (transcript_extractor role only) so
    // transient 429/5xx/timeout errors trigger exponential-backoff retry
    // (3 attempts, 1s/4s/15s ±25% jitter) before falling back to Ollama.
    // strategy_proposer is NOT wrapped here — different SLO.
    const raw = await callScoutExtractLlm([
      { role: "user", content: userPayload },
    ]);
    if (!raw) return null; // model unavailable
    try {
      const obj = JSON.parse(raw) as {
        strategies?: unknown;
        empty_reason?: unknown;
        empty_reason_detail?: unknown;
        instrument_classification?: unknown;
        // Track O (deepscan11, 2026-07-02): minimal schema uses rejected_strategies[]
        // instead of empty_reason string — capture for FIX 5 audit visibility.
        rejected_strategies?: unknown;
      };
      // W23G.2 — capture instrument_classification from the first chunk that provides it.
      if (lastInstrumentClassification === null && typeof obj.instrument_classification === "string") {
        const rawClass = obj.instrument_classification;
        if (VALID_INSTRUMENT_CLASSIFICATIONS.has(rawClass)) {
          lastInstrumentClassification = rawClass;
        }
      }
      const strategies = Array.isArray(obj.strategies) ? obj.strategies : [];

      // Wave 26 Pass L Fix G (2026-05-27) — Direction post-validator.
      // Gemma4:e2b consistently picks direction="long" when speaker's first example
      // is bullish, even when entry_sequence step text explicitly mirrors short-side.
      // STRICT_SCHEMA=true crashes on RTX 5060 8GB, so we coerce in code instead.
      try {
        const { coerceDirectionsInPlace } = await import("../lib/direction-coercion.js");
        const coerceLog = coerceDirectionsInPlace(
          strategies as Array<{ direction?: string; entry_sequence?: Array<{action?: string; rationale?: string|null}> }>,
        );
        if (coerceLog.length > 0) {
          logger.info(
            { sourceUrl, coerced: coerceLog.length, details: coerceLog },
            "scout-extract: direction post-validator coerced long→both based on step text",
          );
          try {
            await db.insert(auditLog).values({
              action: "extraction.direction_coerced",
              entityType: "strategy_candidate",
              entityId: sourceUrl,
              input: { coerced_count: coerceLog.length },
              result: { details: coerceLog },
              status: "info",
              correlationId,
            });
          } catch (e) {
            logger.warn({ err: e instanceof Error ? e.message : String(e) }, "extraction.direction_coerced audit insert failed (non-blocking)");
          }
        }
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "scout-extract: direction-coercion helper failed (non-blocking)");
      }

      // W23H-postmortem (2026-05-20): strict-schema mode requires free-form
      // object schemas to be JSON-encoded strings. Parse them back to objects
      // here so downstream (graduator, W23H.D evaluator) sees the canonical
      // shape: entry_params/exit_params (top-level) and
      // confirming_indicators[].params (via params_json).
      const parseJsonField = (obj: Record<string, unknown>, key: string) => {
        const v = obj[key];
        if (typeof v === "string") {
          try { obj[key] = JSON.parse(v); } catch { obj[key] = {}; }
        } else if (v === null || v === undefined) {
          obj[key] = {};
        }
      };
      for (const s of strategies) {
        const sObj = s as Record<string, unknown>;
        parseJsonField(sObj, "entry_params");
        parseJsonField(sObj, "exit_params");
        const ci = sObj.confirming_indicators;
        if (Array.isArray(ci)) {
          for (const item of ci) {
            const itm = item as Record<string, unknown>;
            if (typeof itm.params_json === "string" && itm.params === undefined) {
              try { itm.params = JSON.parse(itm.params_json); } catch { itm.params = {}; }
              delete itm.params_json;
            }
          }
        }
      }
      if (strategies.length === 0) {
        // Validate against allowed categories — discard anything else as "other"
        // so the audit-log enum stays predictable for downstream filtering.
        const rawReason = typeof obj.empty_reason === "string" ? obj.empty_reason : null;
        lastEmptyReason = rawReason && VALID_EMPTY_REASONS.has(rawReason) ? rawReason : (rawReason ? "other" : null);
        lastEmptyReasonDetail = typeof obj.empty_reason_detail === "string" ? obj.empty_reason_detail.slice(0, 500) : null;
        // Track O (deepscan11, 2026-07-02) FIX 5: minimal schema uses rejected_strategies[]
        // (with reason enum) instead of empty_reason string. Capture the reasons so the
        // scout_extract.empty_reasoned audit row is diagnosable from minimal-path responses.
        if (Array.isArray(obj.rejected_strategies)) {
          lastRejectedStrategies = (obj.rejected_strategies as Array<Record<string, unknown>>)
            .slice(0, 5)
            .map((r) => ({
              name: typeof r["name"] === "string" ? r["name"] : null,
              reason: typeof r["reason"] === "string" ? r["reason"] : "unknown",
              detail: typeof r["detail"] === "string" ? r["detail"].slice(0, 300) : null,
            }));
        } else {
          lastRejectedStrategies = [];
        }
      } else {
        lastEmptyReason = null;
        lastEmptyReasonDetail = null;
        lastRejectedStrategies = [];
      }
      return strategies;
    } catch {
      // Model returned non-JSON — propagate as sentinel so caller can emit
      // the distinct "non_json" reason rather than "no_strategy_content".
      return NON_JSON_SENTINEL;
    }
  }

  try {
    // W23G.7 — Single-pass extraction: 12K first-pass window (expanded from 8K).
    // Chunked fallback (3×4K) fires ONLY if first pass returns empty AND raw
    // markdown is longer than 12K. Per-call telemetry: extraction_mode field
    // is emitted in the audit log and the final response for observability.
    // Token estimate: char_count / 4 (no new deps, rough but sufficient for telemetry).
    const FIRST_PASS_WINDOW = 12_000;
    const CHUNKED_FALLBACK_THRESHOLD = 12_000;
    let extractionMode: "single_pass" | "chunked_fallback" | "chunked_oom_safe" = "single_pass";

    // Wave 26 Pass L (2026-05-27) — OOM-safe chunked path for long transcripts.
    // RTX 5060 8 GB VRAM OOMs at TRANSCRIPT_EXTRACTOR_NUM_CTX=32768 on
    // 24K-37K-char transcripts (GGML_ASSERT mem_buffer NULL). The chunker
    // splits into ~10K overlapping windows at a safer per-chunk ctx (12288)
    // and merges by concept_name. The 5 short-form videos that currently work
    // at the global 32K stay on the single-pass path — chunking only fires
    // above CHUNKING_THRESHOLD_CHARS (default 14000).
    let strategiesIn: unknown[] | typeof NON_JSON_SENTINEL | null;
    if (shouldChunkTranscript(markdown.length)) {
      extractionMode = "chunked_oom_safe";
      logger.info(
        { sourceUrl, markdown_length: markdown.length, threshold: CHUNKING_THRESHOLD_CHARS },
        "scout-extract: routing to OOM-safe chunked path",
      );
      try {
        // E-CHUNK-RETRY (5-URL audit run-4, 2026-06-23): the OOM-safe chunker is empirically
        // NON-DETERMINISTIC on heavy (>12K) transcripts — the SAME 35K SY2 transcript yielded
        // merged_strategies=4 on one run and =0 on the next (a transient empty per-chunk LLM
        // call zeroes the merge). Retry up to 3× when the merge is empty before giving up to the
        // sparse fallback — mirrors the enumerator's retry-once-on-0-items (FIX 11). Cheap
        // insurance: only fires on the empty path, and a single recovered attempt saves the video.
        const CHUNK_MAX_ATTEMPTS = 3;
        let merged!: Awaited<ReturnType<typeof extractTranscriptChunked>>["merged"];
        let rawChunks!: Awaited<ReturnType<typeof extractTranscriptChunked>>["rawChunks"];
        for (let attempt = 1; attempt <= CHUNK_MAX_ATTEMPTS; attempt++) {
          ({ merged, rawChunks } = await extractTranscriptChunked(markdown, {
            sourceUrl,
            title: title || sourceUrl,
            channel: sourceProvider,
          }));
          if (merged.strategies.length > 0) {
            if (attempt > 1) {
              logger.info({ sourceUrl, attempt }, "scout-extract: chunked extraction recovered on retry");
            }
            break;
          }
          if (attempt < CHUNK_MAX_ATTEMPTS) {
            logger.warn(
              { sourceUrl, attempt, max: CHUNK_MAX_ATTEMPTS },
              "scout-extract: chunked extraction returned 0 strategies — retrying (non-deterministic heavy-video path)",
            );
          }
        }
        // Surface chunk-level diagnostics in the audit_log via the per-chunk durations.
        logger.info(
          {
            sourceUrl,
            chunk_count: rawChunks.length,
            chunk_durations_ms: rawChunks.map((c) => c.durationMs),
            chunk_errors: rawChunks.filter((c) => c.errorReason).map((c) => ({ i: c.chunkIndex, reason: c.errorReason })),
            merged_strategies: merged.strategies.length,
          },
          "scout-extract: chunked extraction complete",
        );
        // Capture instrument_classification from the merged result (chunker
        // already applies "first non-null wins" semantics).
        if (lastInstrumentClassification === null && merged.instrument_classification) {
          if (VALID_INSTRUMENT_CLASSIFICATIONS.has(merged.instrument_classification)) {
            lastInstrumentClassification = merged.instrument_classification;
          }
        }
        if (merged.strategies.length === 0) {
          const rawReason = typeof merged.empty_reason === "string" ? merged.empty_reason : null;
          lastEmptyReason = rawReason && VALID_EMPTY_REASONS.has(rawReason) ? rawReason : (rawReason ? "other" : null);
          lastEmptyReasonDetail = typeof merged.empty_reason_detail === "string" ? merged.empty_reason_detail.slice(0, 500) : null;
        }
        strategiesIn = merged.strategies;
      } catch (chunkErr) {
        logger.error(
          { err: chunkErr instanceof Error ? chunkErr.message : String(chunkErr), sourceUrl },
          "scout-extract: chunked path threw — falling back to single-pass at FIRST_PASS_WINDOW",
        );
        extractionMode = "single_pass";
        strategiesIn = await extractFromChunk(markdown.slice(0, FIRST_PASS_WINDOW));
      }
    } else {
      strategiesIn = await extractFromChunk(markdown.slice(0, FIRST_PASS_WINDOW));
    }
    if (strategiesIn === null) {
      res.status(200).json({ extracted: false, reason: "model_unavailable", ideas: [] });
      return;
    }
    // Non-JSON response from model — emit distinct reason for observability.
    // Operators need to distinguish "LLM returned garbage" from "LLM returned
    // valid JSON with no strategies" when diagnosing extraction yield issues.
    if (strategiesIn === NON_JSON_SENTINEL) {
      res.status(200).json({ extracted: false, reason: "non_json", ideas: [] });
      return;
    }

    // W23G.7 + THIN-RECHUNK (2026-06-23): escalate single-pass → chunked when the result is EMPTY
    // *or THIN* on a substantial transcript. N7uP (11.5K, fit in one 12K window so NOT truncated)
    // still produced a generic 2-step result — a single-pass attention failure on a genuinely rich
    // VWAP+EMA+pre-market strategy. Chunking into overlapping 4K windows forces per-section
    // attention + synthesis recovers the full step set. "Thin" = every candidate is generic-named
    // OR <3 steps. Size guard (6K) preserves the original intent: don't burn extra LLM calls
    // re-chunking a genuinely-short clip that simply contains no strategy.
    const THIN_RECHUNK_MIN = 6_000;
    const isThinResult = (arr: unknown[]): boolean => {
      if (arr.length === 0) return true;
      return arr.every((s) => {
        const x = s as { concept_name?: string; name?: string; entry_sequence?: unknown[] };
        const cn = (x.concept_name || x.name || "").trim();
        const generic = !cn || /^extracted(_strategy)?$/i.test(cn);
        const steps = Array.isArray(x.entry_sequence) ? x.entry_sequence.length : 0;
        return generic || steps < 3;
      });
    };
    if (isThinResult(strategiesIn as unknown[]) && markdown.length > THIN_RECHUNK_MIN) {
      extractionMode = "chunked_fallback";
      // E-CHUNK-DENSE (5-URL audit run-4, 2026-06-23): cover the FULL transcript in overlapping
      // 4K windows, not just start/mid/end. The old 3-sample missed ~23K of a 35K transcript, so
      // a strategy taught in the un-sampled middle (SY2 Gann box) produced 0 strategies. 1K
      // overlap avoids splitting a rule across a window boundary; cap bounds LLM calls.
      const FB_WIN = 4000, FB_STEP = 3000, FB_MAX_WINDOWS = 12;
      const chunks: string[] = [];
      for (let off = 0; off < markdown.length && chunks.length < FB_MAX_WINDOWS; off += FB_STEP) {
        chunks.push(markdown.slice(off, off + FB_WIN));
      }
      const merged: unknown[] = [];
      const seenConcepts = new Set<string>();
      for (const c of chunks) {
        const res2 = await extractFromChunk(c);
        if (!res2 || res2 === NON_JSON_SENTINEL) continue;
        for (const s of (res2 as unknown[])) {
          const cn = ((s as { concept_name?: string }).concept_name || (s as { name?: string }).name || "").trim();
          // Only dedup SPECIFIC concept names. Generic "extracted_strategy" fragments from different
          // windows carry DIFFERENT content (different sections of the strategy) under the same
          // label — collapsing them by name would discard the very fragments synthesis must union
          // (the N7uP failure mode: all windows → "extracted_strategy" → deduped to 1 → no union).
          const generic = !cn || /^extracted(_strategy)?$/i.test(cn);
          if (!generic && seenConcepts.has(cn)) continue;
          if (!generic) seenConcepts.add(cn);
          merged.push(s);
        }
      }
      strategiesIn = merged;
      logger.info({ sourceUrl, chunked: true, found: merged.length }, "scout-extract chunked fallback");
    }

    // W23G.7 — per-call telemetry: log extraction_mode + estimated token count.
    const tokensEstimated = Math.ceil(markdown.length / 4);
    logger.info(
      {
        sourceUrl,
        extraction_mode: extractionMode,
        tokens_estimated: tokensEstimated,
        markdown_length: markdown.length,
        // W3.3: include lineage key in structured log so operators can grep by it
        lineage_key: extractionLineageKey,
      },
      "scout-extract telemetry",
    );

    // W3.3 — Extraction lineage audit row.
    // Emitted once per extraction run. Acts as the anchor for all other audit rows
    // (coverage_evaluated, config_used, quarantined, etc.) that share correlationId.
    // Enables idempotent replay: callers can detect duplicate extractions by lineage_key.
    insertAuditRow({
      action: "extraction.lineage_emitted",
      entityType: "scout_extract",
      entityId: null,
      status: "success",
      decisionAuthority: "system",
      result: {
        lineage_key: extractionLineageKey,
        video_id: _videoId,
        transcript_hash: _transcriptHash,
        extractor_version: _extractorVersion,
        source_url: sourceUrl,
        extraction_mode: extractionMode,
        markdown_length: markdown.length,
      },
      correlationId,
    }).catch((auditErr: unknown) => {
      logger.debug(
        { err: auditErr instanceof Error ? auditErr.message : String(auditErr), sourceUrl },
        "scout-extract: lineage_emitted audit insert failed (non-blocking)",
      );
    });

    // W23G.2 — audit event for mixed-instrument keep path.
    // When LLM classifies the transcript as futures_with_forex_illustration,
    // it means the video was kept despite a brief non-futures chart illustration.
    // Emit audit event for observability so operators can monitor false-keep rate.
    if (lastInstrumentClassification === "futures_with_forex_illustration") {
      insertAuditRow({
        action: "scout.mixed_instrument_kept_futures",
        entityType: "scout_extract",
        entityId: null,
        status: "success",
        decisionAuthority: "agent",
        result: {
          sourceUrl,
          title: title?.slice(0, 256) ?? null,
          sourceProvider,
          instrument_classification: lastInstrumentClassification,
          reason: "futures_with_forex_illustration: brief non-futures chart present but strategy is futures-primary",
          transcript_length: markdown.length,
        },
        correlationId: (req as { id?: string }).id ?? null,
      }).catch((auditErr) => {
        logger.warn(
          { err: auditErr instanceof Error ? auditErr.message : String(auditErr), sourceUrl },
          "scout-extract: mixed_instrument_kept_futures audit insert failed (non-blocking)",
        );
      });
    }

    // W23F.S (2026-05-19) — missing_params recovery branch.
    // When LLM returns empty with `missing_params` BUT the transcript clearly
    // references a known indicator/concept, synthesize a stub idea with
    // empty entry_params={} + provenance=params_inferred. The graduator's
    // CANONICAL_DEFAULT_PARAMS table will fill defaults at graduation time.
    // This unlocks SMC/ICT/Wyckoff/concept-named strategies that don't state
    // numeric params explicitly.
    //
    // W23G.3 (2026-05-19) — STRUCTURAL ARCHETYPE EXTENSION.
    // For SMC/ICT/Wyckoff structural patterns the problem is different: the LLM
    // cannot find *any* numeric params because the strategy has no numeric params —
    // the engine handles structural detection internally. We must NOT put these
    // through the generic indicator path (which would try to look up canonical
    // defaults for "liquidity_sweep" as if it were a parametric indicator). Instead,
    // detect archetype keywords in the title+transcript and synthesize a proper
    // structural stub with `entry_type: "structural"` and
    // `entry_indicator: "archetype:<name>"`. The engine routes via the structural
    // handler, bypassing parametric param validation entirely.
    //
    // Archetype detection order: most-specific first (e.g. "silver bullet" before
    // "breaker" so "ICT silver bullet" doesn't accidentally hit the breaker rule).
    if (
      (!Array.isArray(strategiesIn) || (strategiesIn as unknown[]).length === 0) &&
      lastEmptyReason === "missing_params"
    ) {
      // ── W23G.3 structural archetype scan ────────────────────────────────────
      // Delegate to the module-level detectStructuralArchetype() helper (exported
      // for unit testing). Searches title + first 12 K of transcript.
      const searchText = `${title ?? ""} ${markdown.slice(0, 12000)}`;
      const archetypeMatch = detectStructuralArchetype(searchText);
      const detectedArchetype = archetypeMatch?.archetypeName ?? null;
      const matchedKeywords = archetypeMatch?.matchedKeywords ?? [];

      if (detectedArchetype !== null) {
        // Structural recovery — emit archetype:<name> stub so engine routes to
        // structural handler. direction="both" is intentional: structural patterns
        // (liquidity sweeps, order blocks, FVGs) are symmetric by definition —
        // they fire on BSL sweeps → short and SSL sweeps → long. framework-overlay
        // is direction-agnostic and will apply Style C exits on both sides.
        const conceptName = (title || sourceUrl)
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 80) || `${detectedArchetype}_${Date.now()}`;
        const archStub = {
          name: `${conceptName.slice(0, 40)}_recovered`,
          symbol: "MES",
          timeframe: "5m",
          entry_type: "structural",
          entry_indicator: `archetype:${detectedArchetype}`,
          entry_params: {},
          entry_condition: `Structural ${detectedArchetype} pattern (engine archetype handler)`,
          direction: "both",
          concept_name: conceptName,
          extraction_provenance: "structural_recovery",
          archetype_detected: detectedArchetype,
        };
        strategiesIn = [archStub];
        lastEmptyReason = null;
        logger.info(
          { sourceUrl, detectedArchetype, matchedKeywords, conceptName },
          "scout-extract W23G.3: structural_recovery synthesized archetype stub",
        );
        // Audit event — non-blocking; audit failure must not drop the recovered stub.
        insertAuditRow({
          action: "scout.structural_recovery",
          entityType: "scout_extract",
          entityId: null,
          status: "success",
          decisionAuthority: "agent",
          result: {
            sourceUrl,
            title: title?.slice(0, 256) ?? null,
            archetype_name: detectedArchetype,
            transcript_keywords_matched: matchedKeywords,
          },
          correlationId: (req as { id?: string }).id ?? null,
        }).catch((auditErr: unknown) =>
          logger.warn(
            { err: auditErr instanceof Error ? auditErr.message : String(auditErr), sourceUrl },
            "scout-extract W23G.3: structural_recovery audit insert failed (non-blocking)",
          )
        );
      } else {
        // ── Original W23F.S generic indicator recovery (non-structural) ──────
        // Falls through only when no structural archetype matched. Keeps the
        // existing behavior for parametric indicators (RSI, MACD, EMA, etc.)
        // that have missing_params but DO have identifiable indicators in prose.
        const INDICATOR_REGEX = /\b(rsi|macd|adx|atr|bollinger|keltner|donchian|stochastic|vwap|cci|williams|supertrend|ichimoku|cumulative.delta|order.flow|volume.profile|orb|opening.range|9.{0,4}21.{0,4}ema|ema|sma|hma|dema|liquidity.sweep|order.block|fair.value.gap|fvg|smt|smc|ict|wyckoff|spring|breaker|silver.bullet|judas|optimal.trade.entry|ote|displacement|imbalance|mean.reversion|chandelier|fibonacci|pivot)\b/i;
        const m = markdown.match(INDICATOR_REGEX) ?? title?.match(INDICATOR_REGEX);
        if (m) {
          const detected = m[0].toLowerCase().replace(/\s+/g, "_");
          const conceptName = (title || sourceUrl).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || `${detected}_${Date.now()}`;
          const stubStrategy = {
            name: `${conceptName.slice(0, 40)}_recovered`,
            symbol: "MES",
            timeframe: "5m",
            entry_indicator: detected,
            entry_params: {},
            direction: "long",
            concept_name: conceptName,
            entry_condition: `Concept identified from transcript: ${detected} (canonical defaults will be applied at graduation)`,
            extraction_provenance_note: "W23F.S missing_params recovery — concept detected, params will use canonical defaults",
          };
          strategiesIn = [stubStrategy];
          lastEmptyReason = null;
          logger.info({ sourceUrl, detected, conceptName }, "scout-extract W23F.S: missing_params recovery synthesized stub");
        }
      }
    }

    if (!Array.isArray(strategiesIn) || (strategiesIn as unknown[]).length === 0) {
      // Wave 11 — audit the empty result with the LLM-captured category so future
      // extractor-tuning can see WHICH content class is being dropped (most-common
      // category in 7d will drive prompt/source-selection improvements).
      const llmReason = lastEmptyReason ?? "no_strategy_content";
      try {
        await insertAuditRow({
          action: "scout_extract.empty_reasoned",
          entityType: "scout_extract",
          entityId: null,
          status: "success",
          decisionAuthority: "agent",
          result: {
            sourceUrl,
            title: title?.slice(0, 256) ?? null,
            sourceProvider,
            empty_reason: llmReason,
            empty_reason_detail: lastEmptyReasonDetail,
            transcript_length: markdown.length,
            // Track O (deepscan11, 2026-07-02) FIX 5: minimal schema emits
            // rejected_strategies[] instead of empty_reason. Include here so
            // empty cycles are diagnosable from both legacy and minimal paths.
            rejected_strategy_reasons: lastRejectedStrategies.length > 0
              ? lastRejectedStrategies.map((r) => r.reason)
              : null,
            rejected_strategies_detail: lastRejectedStrategies.length > 0
              ? lastRejectedStrategies
              : null,
          },
          correlationId: (req as { id?: string }).id ?? null,
        });
      } catch (auditErr) {
        // Audit failures must NOT block the route response. Log and continue.
        logger.warn({ err: auditErr instanceof Error ? auditErr.message : String(auditErr), sourceUrl }, "scout-extract: empty_reasoned audit insert failed");
      }
      res.status(200).json({
        extracted: false,
        reason: llmReason,
        empty_reason_detail: lastEmptyReasonDetail,
        ideas: [],
      });
      return;
    }

    // ─── Wave 26 Pass K Phase 7 (2026-05-27) — Mechanic Portability (early) ──
    // Classify BEFORE the strategy-processing loop so the cross-market demo
    // fallback at the symbol-remap site can reference `portability.portable`.
    // (Pass K Phase 7 v1 had this defined AFTER the loop — caused ReferenceError
    // inside the loop body, which silently aborted the response. Reason fields
    // never reached the caller.)
    const portability = classifyMechanicPortability(markdown);
    // ─── CHUNK-FRAGMENT SYNTHESIS (2026-06-23) ──────────────────────────────────
    // The OOM-safe chunker emits ONE fragment per transcript window. For a single video that
    // teaches ONE coherent strategy, those fragments must be SYNTHESIZED into a single rich
    // strategy — NOT left as N thin ideas where the entire recall/coverage/repair pipeline grades
    // ideas[0] (often a generic 3-step fragment) and IGNORES the rich fragment sitting at ideas[2].
    // SY2 (Gann box, 35K) produced 4 fragments [3,4,5,4 steps]; only one had a specific
    // concept_name and the gate graded the generic one → false "thin extraction". Union them:
    // most-specific concept_name wins, steps + confluences are unioned (dedup), best non-null
    // entry_indicator carried. Fires ONLY on chunked modes with >1 fragment — single-pass
    // extractions (rf_/Fqx/75DJ, <12K) are untouched, so passing videos can't regress.
    if (
      (extractionMode === "chunked_oom_safe" || extractionMode === "chunked_fallback") &&
      Array.isArray(strategiesIn) &&
      (strategiesIn as unknown[]).length > 1
    ) {
      const frags = strategiesIn as Array<Record<string, unknown>>;
      const isGeneric = (n: unknown): boolean =>
        typeof n !== "string" || n.trim().length === 0 || /^extracted(_strategy)?$/i.test(n.trim());
      const nameOf = (f: Record<string, unknown>): string =>
        (typeof f.concept_name === "string" && f.concept_name) || (typeof f.name === "string" && f.name) || "";
      const specificNames = frags.map(nameOf).filter((n) => n && !isGeneric(n)).sort((a, b) => b.length - a.length);
      const conceptName = specificNames[0] ?? frags.map(nameOf).find((n) => n.length > 0) ?? "extracted_strategy";
      const seenAct = new Set<string>();
      const steps: Array<Record<string, unknown>> = [];
      for (const f of frags) {
        for (const st of (Array.isArray(f.entry_sequence) ? f.entry_sequence : []) as Array<Record<string, unknown>>) {
          const a = String(st?.action ?? "").trim().toLowerCase().replace(/\s+/g, " ");
          if (!a || seenAct.has(a)) continue;
          seenAct.add(a);
          steps.push({ ...st, step: steps.length + 1 });
        }
      }
      // Union confluences from BOTH representations a fragment may use: `confluences` (objects
      // {name,description}, what the coverage gate's depth check reads) AND `confluence_factors`
      // (canonical strings, what the A+ transform reads). The chunker often emits only one of the
      // two per fragment; reading just `confluences` dropped SY2's lone factor → 0 confluences →
      // coverage self-evident path (which needs >=1) failed. Convert strings → objects so the
      // synthesized strategy carries confluences the gate can count, and preserve the string list.
      const seenConf = new Set<string>();
      const confluences: Array<Record<string, unknown>> = [];
      const confluenceFactors: string[] = [];
      for (const f of frags) {
        for (const c of (Array.isArray(f.confluences) ? f.confluences : []) as Array<Record<string, unknown>>) {
          const nm = String((c && typeof c === "object" ? c.name : c) ?? "").trim();
          const k = nm.toLowerCase();
          if (!k || seenConf.has(k)) continue;
          seenConf.add(k);
          confluences.push(c);
        }
        for (const cf of (Array.isArray(f.confluence_factors) ? f.confluence_factors : []) as unknown[]) {
          const nm = String(cf ?? "").trim();
          const k = nm.toLowerCase();
          if (!k || seenConf.has(k)) continue;
          seenConf.add(k);
          confluences.push({ name: nm, description: "" });
          confluenceFactors.push(nm);
        }
      }
      const firstNonNull = (key: string): unknown =>
        frags.map((f) => f[key]).find((v) => v != null && v !== "" && !(typeof v === "string" && /^(unknown|none|null)$/i.test(v.trim())));
      const base =
        [...frags].sort(
          (a, b) =>
            (Array.isArray(b.entry_sequence) ? b.entry_sequence.length : 0) -
            (Array.isArray(a.entry_sequence) ? a.entry_sequence.length : 0),
        )[0] ?? {};
      const mergedFactors = Array.from(
        new Set([
          ...(Array.isArray(base.confluence_factors) ? (base.confluence_factors as unknown[]).map(String) : []),
          ...confluenceFactors,
        ]),
      );
      const synthesized: Record<string, unknown> = {
        ...base,
        concept_name: conceptName,
        name: conceptName,
        entry_sequence: steps,
        confluences,
        ...(mergedFactors.length > 0 && { confluence_factors: mergedFactors }),
        entry_indicator: firstNonNull("entry_indicator") ?? base.entry_indicator ?? null,
        direction: frags.some((f) => f.direction === "both") ? "both" : (firstNonNull("direction") ?? base.direction ?? "both"),
      };
      logger.info(
        {
          sourceUrl,
          fragments: frags.length,
          synthesized_steps: steps.length,
          synthesized_confluences: confluences.length,
          concept_name: conceptName,
        },
        "scout-extract: synthesized chunked fragments into single strategy",
      );
      strategiesIn = [synthesized];
    }

    const rawStrategyCount = Array.isArray(strategiesIn) ? (strategiesIn as unknown[]).length : 0;
    const rawStrategyNames = Array.isArray(strategiesIn)
      ? (strategiesIn as Array<Record<string, unknown>>)
          .map((s) => (typeof s?.name === "string" ? s.name : (typeof s?.concept_name === "string" ? s.concept_name : null)))
          .filter((n): n is string => n != null && n.length > 0)
          .slice(0, 3)
      : [];

    // Transform DSL-shaped output → strict scout shape.
    // CLAUDE.md §13 enforcement: MES/MNQ/MCL only — silently drop ES/NQ/CL/etc.
    const ideas: Array<Record<string, unknown>> = [];
    for (const sRaw of strategiesIn) {
      const s = sRaw as Record<string, unknown>;
      const rawSymbol = typeof s.symbol === "string" ? s.symbol : "";
      let remapped = remapMarket(rawSymbol);

      // Wave 26 Pass K Phase 7 (2026-05-27) — Cross-market demo fallback.
      // Per feedback_extractor_any_strategy_no_catalog_gate: a strategy
      // demonstrated on EURUSD / AAPL / BTC / SPY teaches mechanics that
      // PORT to MES/MNQ/MCL. Previously these dropped silently at this filter
      // (causing "no strategy content" Discord rejects on real strategies).
      // When the raw symbol is a known cross-market demo symbol AND the
      // mechanic-portability classifier upstream said portable=true (we
      // re-check here via the same heuristic — the formal check fired earlier
      // and would have rejected the WHOLE response if non-portable), default
      // to MES with sizeMultiplier=1 (no scaling — the speaker's contract
      // count is irrelevant for non-futures demos; graduator's risk-derived
      // pyramid recomputes from MES base anyway).
      if (!remapped && rawSymbol && isCrossMarketDemoSymbol(rawSymbol) && portability.portable) {
        remapped = { market: "MES", sizeMultiplier: 1 };
        // Audit so operators can see when fallback fires
        insertAuditRow({
          action: "scout.cross_market_demo_remap",
          entityType: "scout_extract",
          entityId: null,
          status: "info",
          input: { source_url: sourceUrl, raw_symbol: rawSymbol },
          result: { defaulted_to: "MES", reason: "cross_market_mechanic_portable" },
        }).catch(() => {});
      } else if (!remapped && !rawSymbol && portability.portable) {
        // Gemma extracted a strategy with NO symbol field at all (common when
        // the speaker never names a market or uses generic "the chart" language).
        // If the mechanic ports, default to MES same as the cross-market case.
        remapped = { market: "MES", sizeMultiplier: 1 };
        insertAuditRow({
          action: "scout.no_symbol_defaulted_to_mes",
          entityType: "scout_extract",
          entityId: null,
          status: "info",
          input: { source_url: sourceUrl },
          result: { defaulted_to: "MES", reason: "no_symbol_emitted_but_mechanic_portable" },
        }).catch(() => {});
      }

      if (!remapped) continue; // truly unmapped + non-portable — drop

      const { market, sizeMultiplier } = remapped;

      // Wave 10 Task 1: scale contract counts when remapping from mini → micro.
      // ES→MES / NQ→MNQ / CL→MCL: point value drops 10×, so contracts must rise
      // 10× to preserve the same dollar-risk exposure. Write an audit row for
      // every non-1× scaling so the 90-day reconstruction mandate is honored.
      const rawMaxContracts = typeof s.max_contracts === "number" ? s.max_contracts : null;
      const rawBaseContracts = typeof s.base_contracts === "number" ? s.base_contracts : null;
      const rawTierIncrement = typeof s.tier_increment === "number" ? s.tier_increment : null;

      const scaledMaxContracts   = rawMaxContracts   !== null ? Math.round(rawMaxContracts   * sizeMultiplier) : null;
      const scaledBaseContracts  = rawBaseContracts  !== null ? Math.round(rawBaseContracts  * sizeMultiplier) : null;
      const scaledTierIncrement  = rawTierIncrement  !== null ? Math.round(rawTierIncrement  * sizeMultiplier) : null;

      if (sizeMultiplier !== 1) {
        // Fire-and-forget audit row — the scout extract route is not transactional
        // so we accept that this row might not persist on catastrophic failure.
        db.insert(auditLog).values({
          action: "scout_extract.contract_remap_scaled",
          entityType: "scout_extract",
          entityId: sourceUrl,
          decisionAuthority: "system",
          input: { rawSymbol, sourceUrl } as Record<string, unknown>,
          result: {
            source_symbol:       rawSymbol,
            dest_market:         market,
            multiplier:          sizeMultiplier,
            max_contracts_pre:   rawMaxContracts,
            max_contracts_post:  scaledMaxContracts,
            base_contracts_pre:  rawBaseContracts,
            base_contracts_post: scaledBaseContracts,
            tier_increment_pre:  rawTierIncrement,
            tier_increment_post: scaledTierIncrement,
          } as Record<string, unknown>,
          status: "success",
          correlationId: null,
        }).catch((err) => {
          logger.warn({ err, rawSymbol, market, sizeMultiplier }, "scout-extract: audit_log write failed for contract_remap_scaled (non-blocking)");
        });

        logger.info(
          { rawSymbol, market, sizeMultiplier, rawMaxContracts, scaledMaxContracts },
          "scout-extract: contract count scaled for mini→micro remap",
        );
      }

      // Propagate scaled values back into the raw strategy record for downstream use
      if (scaledMaxContracts  !== null) s.max_contracts  = scaledMaxContracts;
      if (scaledBaseContracts !== null) s.base_contracts = scaledBaseContracts;
      if (scaledTierIncrement !== null) s.tier_increment = scaledTierIncrement;

      const desc = typeof s.description === "string" ? s.description : "";
      const entryCond = typeof s.entry_condition === "string" ? s.entry_condition : "";
      const entryInd = typeof s.entry_indicator === "string" ? s.entry_indicator : "";
      const exitType = typeof s.exit_type === "string" ? s.exit_type : "";
      const exitParams = s.exit_params && typeof s.exit_params === "object"
        ? JSON.stringify(s.exit_params) : "";
      const stopAtr = typeof s.stop_loss_atr_multiple === "number" ? s.stop_loss_atr_multiple : 1.5;
      const tpAtr = typeof s.take_profit_atr_multiple === "number" ? s.take_profit_atr_multiple : 3.0;
      const regime = typeof s.preferred_regime === "string" && s.preferred_regime.length > 0
        ? s.preferred_regime : "UNSPECIFIED";
      const concept = typeof s.concept_name === "string" && s.concept_name.length > 0
        ? s.concept_name : (typeof s.name === "string" ? s.name : "extracted_strategy");
      const tf = typeof s.timeframe === "string" ? s.timeframe : "5m";

      // strict schema field guards (min 20 for entry/exit, min 10 for risk, min 20 for thesis)
      const thesis = (desc || `${concept} on ${market} ${tf} via ${entryInd}`).slice(0, 2000);
      if (thesis.length < 20) continue;
      const entryRules = (entryCond || `Trigger on ${entryInd} per parameters ${JSON.stringify(s.entry_params ?? {})}`).slice(0, 2000);
      if (entryRules.length < 20) continue;
      const exitRules = (`${exitType || "atr_multiple"} exit; take profit at ${tpAtr}R; ${exitParams}`).slice(0, 2000);
      if (exitRules.length < 20) continue;
      // Use scaled max_contracts for the risk_rules prose if available
      const effectiveMaxContracts = scaledMaxContracts ?? (typeof s.max_contracts === "number" ? s.max_contracts : 3);
      const riskRules = `ATR stop ${stopAtr}x; max ${effectiveMaxContracts} ${market} contracts (risk-derived at signal time); structural stop ceiling 14pt MES / 40pt MNQ / 25 tick MCL per CLAUDE.md §4`;

      // Wave 16 (2026-05-18) — preserve LLM-extracted parametric DSL fields.
      // Prior code ran the LLM through transcript_extractor prompt v6 (which correctly
      // emits entry_indicator + entry_params + direction + extraction_confidence per
      // canonical-defaults table) — then read those fields into LOCAL variables
      // (entryInd, stopAtr, tpAtr, etc.) for prose construction but NEVER wrote them
      // to the output object. Downstream strategy_pending_mentions.extracted_idea
      // therefore always had entry_params={} and no entry_indicator, defeating every
      // Wave 9-14 graduator gate that depended on parametric data.
      //
      // Single-video probe with ema921.txt (rule-rich "9 21 EMA pullback") confirmed:
      // LLM correctly emits {entry_indicator: "ema_crossover", entry_params: {fast:9,
      // slow:21}, direction: "long"} and we were dropping all of it. This was the
      // root architectural bottleneck for the entire factory.
      const direction = typeof s.direction === "string" ? s.direction : "long";
      const llmEntryParams = s.entry_params && typeof s.entry_params === "object" ? s.entry_params as Record<string, unknown> : {};
      // Layer 3C.1 (2026-06-24): recover EXPLICIT indicator params from the transcript when the LLM
      // gave none (deterministic; no prompt change). Only TRANSCRIPT_EXPLICIT params are credited —
      // never silent defaults (3C.2 defaults policy keeps assumed defaults out of fidelity).
      const paramHint =
        (typeof s.entry_indicator === "string" ? s.entry_indicator : null) ??
        (typeof s.name === "string" ? s.name : null) ??
        (typeof s.concept_name === "string" ? s.concept_name : null);
      let entryParams = llmEntryParams;
      let paramSource: string | null = Object.keys(llmEntryParams).length > 0 ? "llm" : null;
      if (Object.keys(llmEntryParams).length === 0) {
        const scanned = scanIndicatorParams(markdown, paramHint);
        if (scanned.source === "TRANSCRIPT_EXPLICIT" && scanned.params) {
          entryParams = scanned.params;
          paramSource = "transcript_explicit";
        }
      }
      const extractionConfidence = typeof s.extraction_confidence === "number" ? s.extraction_confidence : 0.5;
      const entryType = typeof s.entry_type === "string" ? s.entry_type : null;
      const entryArchetype = typeof s.entry_archetype === "string" ? s.entry_archetype : null;
      const llmSessionFilter = typeof s.session_filter === "string" && s.session_filter.trim().length > 0 ? s.session_filter : null;
      // Layer 3A (2026-06-24): session is strategy IDENTITY, not metadata. When the LLM left it null,
      // recover a STRUCTURED session from the transcript (temporal normalization → ET-anchored window).
      const sessionWindow = llmSessionFilter ? null : extractSessionFromTranscript(markdown);
      // session_filter stays a string for backward-compat consumers (gemma-prose-to-v11, Pine export,
      // scout runner); populate it with the canonical label when we recovered a structured window.
      const sessionFilter = llmSessionFilter ?? sessionFilterLabel(sessionWindow);
      // Layer 3B (2026-06-24): classify directionality from TAUGHT transcript evidence (5-class model),
      // not the lossy "all strategies are both" assumption. Postprocessing only — no prompt change.
      const directionMeta = classifyDirectionFromTranscript(markdown);
      const exitParamsObj = s.exit_params && typeof s.exit_params === "object" ? s.exit_params as Record<string, unknown> : {};
      const extractedName = typeof s.name === "string" ? s.name : null;

      // Wave 23F (2026-05-19) — A+ confluence gate fields. Read from LLM output if present.
      const VALID_CONFLUENCE_FACTORS = new Set(["regime_match", "structural_setup", "volume_confirmation", "macro_alignment", "vp_shape"]);
      const confluenceFactors = Array.isArray(s.confluence_factors)
        ? (s.confluence_factors as unknown[]).filter((f): f is string => typeof f === "string" && VALID_CONFLUENCE_FACTORS.has(f))
        : undefined;
      const minFactorsSatisfied = typeof s.min_factors_satisfied === "number" && Number.isInteger(s.min_factors_satisfied)
        ? Math.max(0, Math.min(5, s.min_factors_satisfied))
        : undefined;
      const sourceClaimWinRate = typeof s.source_claim_win_rate === "number"
        ? Math.max(0, Math.min(1, s.source_claim_win_rate))
        : (s.source_claim_win_rate === null ? null : undefined);
      const sourceClaimAvgR = typeof s.source_claim_avg_r === "number"
        ? s.source_claim_avg_r
        : (s.source_claim_avg_r === null ? null : undefined);
      const VALID_SYMBOLS = new Set(["MES", "MNQ", "MCL"]);
      const extractedSymbols = Array.isArray(s.symbols)
        ? (s.symbols as unknown[]).filter((sym): sym is string => typeof sym === "string" && VALID_SYMBOLS.has(sym))
        : undefined;

      // W23H/W23G.11 (2026-05-21) — bias-MTF + confluence indicator fields.
      // Forward from LLM extraction so downstream graduator can populate
      // entry_quality.confirming_indicators + preferred_regimes[] +
      // bias_timeframe. Without these forwards the LLM output is silently
      // dropped at the route boundary even when correctly emitted.
      const VALID_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
      const biasTimeframe = typeof s.bias_timeframe === "string" && VALID_TIMEFRAMES.has(s.bias_timeframe)
        ? s.bias_timeframe : (s.bias_timeframe === null ? null : undefined);
      const biasCondition = typeof s.bias_condition === "string"
        ? s.bias_condition.slice(0, 500)
        : (s.bias_condition === null ? null : undefined);
      const executionTimeframe = typeof s.execution_timeframe === "string" && VALID_TIMEFRAMES.has(s.execution_timeframe)
        ? s.execution_timeframe : (s.execution_timeframe === null ? null : undefined);
      const primaryIndicator = typeof s.primary_indicator === "string"
        ? s.primary_indicator.slice(0, 100)
        : (s.primary_indicator === null ? null : undefined);
      const VALID_DIRECTIONS = new Set(["agree", "disagree", "either"]);
      const confirmingIndicators = Array.isArray(s.confirming_indicators)
        ? (s.confirming_indicators as unknown[])
            .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
            .map((it) => ({
              indicator: typeof it.indicator === "string" ? it.indicator : "",
              params: it.params && typeof it.params === "object" ? it.params : {},
              direction: typeof it.direction === "string" && VALID_DIRECTIONS.has(it.direction) ? it.direction : "agree",
            }))
            .filter((it) => it.indicator.length > 0)
        : (s.confirming_indicators === null ? null : undefined);
      const VALID_REGIMES = new Set(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
      const preferredRegimes = Array.isArray(s.preferred_regimes)
        ? (s.preferred_regimes as unknown[]).filter((r): r is string => typeof r === "string" && VALID_REGIMES.has(r))
        : (s.preferred_regimes === null ? null : undefined);

      // Wave 26 Pass I (2026-05-26) — v11 "to-the-T" deep extraction fields.
      // Forward Gemma's v11 output (entry_sequence, stop_loss object, targets,
      // filters, timeframes object, indicators_used) so the graduator can stamp
      // them per Pass I track 2 spec. Without these forwards the route silently
      // drops v11 depth and falls back to v10 prose-only shape.
      //
      // PROSE SYNTHESIZER (2026-05-26): Gemma4:e2b cannot emit v11 nested JSON
      // without GBNF grammar enforcement (which crashes Ollama on 8GB VRAM).
      // BUT Gemma captures the semantic content in v10 prose fields. The
      // synthesizer parses Gemma's prose (entry_rules, risk_rules, etc.) and
      // produces v11 structured fields. Merge happens BEFORE the field
      // extraction below so synthesized fields flow through the same forward path.
      //
      // v12+v13 SPEAKER VOCABULARY (2026-05-26): two-tier extraction.
      //
      // TIER 1 (v13 Pass 1 LLM call) — small focused Gemma call that ONLY
      //   extracts speaker_concepts. Tiny schema = high compliance even on
      //   gemma4:e4b-it-qat's 2B-effective brain. Works on ANY domain (Volume Profile,
      //   Wyckoff, options flow) — not constrained to a hardcoded catalog.
      //   Research: arXiv 2604.05158 + MasterPrompting 2026-05-12 benchmark.
      //
      // TIER 2 (v12 server-side NLP) — regex catalog for ICT/SMC vocabulary
      //   as backup if Pass 1 returns few/no concepts. Augmenting, not
      //   competing — concepts from both tiers get merged and deduplicated.
      //
      // Skip both tiers if Gemma already emitted speaker_concepts (future-proof).
      const sWithConcepts: Record<string, unknown> = { ...s };
      const existingConcepts = (s as Record<string, unknown>).speaker_concepts;
      if (!Array.isArray(existingConcepts) || existingConcepts.length === 0) {
        const mergedConcepts: Array<Record<string, unknown>> = [];
        const seenTerms = new Set<string>();
        // Tier 1 — Pass 1 LLM vocab extraction (works on any domain)
        try {
          const pass1 = await runPass1VocabularyExtraction(markdown);
          if (pass1 && pass1.speaker_concepts.length > 0) {
            for (const c of pass1.speaker_concepts) {
              const k = c.term.toLowerCase().trim();
              if (seenTerms.has(k)) continue;
              seenTerms.add(k);
              mergedConcepts.push({ ...c, source: "pass1_llm_extraction" });
            }
          }
        } catch (p1Err) {
          logger.warn({ err: p1Err instanceof Error ? p1Err.message : String(p1Err) }, "scout-extract: Pass 1 LLM vocab extraction failed (falling back to NLP)");
        }
        // Tier 2 — server-side NLP (ICT/SMC catalog as augmentation)
        try {
          const nlpConcepts = extractSpeakerConceptsFromTranscript(markdown);
          for (const c of nlpConcepts) {
            const k = c.term.toLowerCase().trim();
            if (seenTerms.has(k)) continue;
            seenTerms.add(k);
            mergedConcepts.push({ ...c, source: "server_side_nlp" } as Record<string, unknown>);
            if (mergedConcepts.length >= 25) break;
          }
        } catch (nlpErr) {
          logger.warn({ err: nlpErr instanceof Error ? nlpErr.message : String(nlpErr) }, "scout-extract: server-side NLP fallback failed (non-blocking)");
        }
        if (mergedConcepts.length > 0) {
          sWithConcepts.speaker_concepts = mergedConcepts;
        }
      }
      const synthesized = synthesizeV11FromGemmaProse(sWithConcepts);
      const sMerged: Record<string, unknown> = { ...sWithConcepts, ...synthesized };
      const entrySequence = Array.isArray(sMerged.entry_sequence)
        ? (sMerged.entry_sequence as unknown[]).filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
        : (sMerged.entry_sequence === null ? null : undefined);
      const stopLossV11 = sMerged.stop_loss && typeof sMerged.stop_loss === "object" && !Array.isArray(sMerged.stop_loss)
        ? sMerged.stop_loss as Record<string, unknown>
        : (sMerged.stop_loss === null ? null : undefined);
      const targetsV11 = Array.isArray(sMerged.targets)
        ? (sMerged.targets as unknown[]).filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
        : (sMerged.targets === null ? null : undefined);
      const filtersV11 = Array.isArray(sMerged.filters)
        ? (sMerged.filters as unknown[]).filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
        : (sMerged.filters === null ? null : undefined);
      const timeframesV11 = sMerged.timeframes && typeof sMerged.timeframes === "object" && !Array.isArray(sMerged.timeframes)
        ? sMerged.timeframes as Record<string, unknown>
        : (sMerged.timeframes === null ? null : undefined);
      const indicatorsUsedV11 = Array.isArray(sMerged.indicators_used)
        ? (sMerged.indicators_used as unknown[]).filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null)
        : (sMerged.indicators_used === null ? null : undefined);
      const extractionGapReasonV11 = typeof s.extraction_gap_reason === "string"
        ? s.extraction_gap_reason.slice(0, 500)
        : (s.extraction_gap_reason === null ? null : undefined);

      // Track O (deepscan11, 2026-07-02) — Numeric grounding enforcement.
      // If the LLM emitted numeric params (periods, thresholds, ATR multiples, etc.)
      // that appear NOWHERE in the transcript, the extraction hallucinated them.
      // Reject: 0% of numeric tokens grounded → quarantine with audit row.
      // Partial: some grounded → accept with audit row for calibration.
      // Error: helper threw → fail-open (log but proceed — don't strangle conveyor).
      try {
        const groundingResult = checkNumericGrounding(sMerged as Record<string, unknown>, markdown);
        if (groundingResult.status === "reject") {
          // 0% of numeric params grounded — strategy is hallucinated, quarantine it
          logger.warn(
            { sourceUrl, concept, failed_params: groundingResult.failed_params, all_candidates: groundingResult.all_candidates },
            "scout-extract: grounding rejected — numeric params not found in transcript",
          );
          insertAuditRow({
            action: "extraction.grounding_rejected",
            entityType: "scout_extract",
            entityId: sourceUrl,
            status: "warning",
            input: { source_url: sourceUrl, concept_name: concept },
            result: {
              failed_params: groundingResult.failed_params,
              all_candidates: groundingResult.all_candidates,
              grounded_pct: groundingResult.grounded_pct,
            },
            correlationId,
          }).catch((e) => {
            logger.warn({ err: e instanceof Error ? e.message : String(e) }, "extraction.grounding_rejected audit failed (non-blocking)");
          });
          continue; // quarantine — do not add to ideas
        } else if (groundingResult.status === "partial") {
          // Some grounded, some not — accept but emit calibration audit
          logger.info(
            { sourceUrl, concept, grounded_pct: groundingResult.grounded_pct, failed_params: groundingResult.failed_params },
            "scout-extract: grounding partial — some numeric params not found in transcript (accepted)",
          );
          insertAuditRow({
            action: "extraction.grounding_partial",
            entityType: "scout_extract",
            entityId: sourceUrl,
            status: "info",
            input: { source_url: sourceUrl, concept_name: concept },
            result: {
              grounded_pct: groundingResult.grounded_pct,
              failed_params: groundingResult.failed_params,
              all_candidates: groundingResult.all_candidates,
            },
            correlationId,
          }).catch((e) => {
            logger.warn({ err: e instanceof Error ? e.message : String(e) }, "extraction.grounding_partial audit failed (non-blocking)");
          });
          // fall through — accept with partial grounding
        } else if (groundingResult.status === "error") {
          // Helper bug — fail-open, log but don't reject
          logger.warn(
            { sourceUrl, concept, error: groundingResult.error },
            "scout-extract: grounding check failed (error) — proceeding without grounding enforcement",
          );
          insertAuditRow({
            action: "extraction.grounding_check_failed",
            entityType: "scout_extract",
            entityId: sourceUrl,
            status: "warning",
            input: { source_url: sourceUrl, concept_name: concept },
            result: { error: groundingResult.error },
            correlationId,
          }).catch((e) => {
            logger.warn({ err: e instanceof Error ? e.message : String(e) }, "extraction.grounding_check_failed audit failed (non-blocking)");
          });
          // fail-open — proceed
        }
      } catch (groundingErr) {
        // Outer guard — if checkNumericGrounding itself throws unexpectedly, fail-open
        logger.warn(
          { err: groundingErr instanceof Error ? groundingErr.message : String(groundingErr), sourceUrl },
          "scout-extract: grounding check outer guard threw — proceeding (fail-open)",
        );
      }

      // Wave 26 Pass I v12 (2026-05-26) — speaker_concepts vocabulary preservation.
      // Gemma emits speaker's exact terms (4H Candle Box, Hidden Level, IRS Model,
      // Optimum Zone, etc.) and the synthesizer maps them to v11 fields using the
      // speaker's words. Captures novel concepts that no canonical catalog can hold.
      const speakerConceptsV12 = Array.isArray(sMerged.speaker_concepts)
        ? (sMerged.speaker_concepts as unknown[])
            .filter((it): it is Record<string, unknown> => typeof it === "object" && it !== null && typeof (it as { term?: unknown }).term === "string")
            .slice(0, 20)
        : (sMerged.speaker_concepts === null ? null : undefined);

      ideas.push({
        thesis,
        market,
        timeframe: tf,
        entry_rules: entryRules,
        exit_rules: exitRules,
        risk_rules: riskRules.slice(0, 1000),
        source_url: sourceUrl,
        regime,
        concept_name: concept,
        source_provider: sourceProvider,
        confidence_score: 0.5,
        signal_type: "strategy_candidate",
        // Wave 16 — STRUCTURED DSL fields preserved from LLM extraction
        name:                       extractedName,
        entry_indicator:            entryInd || null,
        entry_archetype:            entryArchetype,
        entry_params:               entryParams,
        param_source:               paramSource, // Layer 3C.1: "llm" | "transcript_explicit" | null (source-vague)
        entry_condition:            entryCond || null,
        entry_type:                 entryType,
        direction,
        exit_type:                  exitType || null,
        exit_params:                exitParamsObj,
        stop_loss_atr_multiple:     stopAtr,
        take_profit_atr_multiple:   tpAtr,
        preferred_regime:           regime,
        session_filter:             sessionFilter,
        session_window:             sessionWindow, // Layer 3A structured session (null when LLM gave a string)
        direction_class:            directionMeta.class, // Layer 3B evidence-based 5-class directionality
        direction_confidence:       directionMeta.confidence,
        direction_evidence:         directionMeta.evidence,
        extraction_confidence:      extractionConfidence,
        // Sizing fields (scaled via mini→micro remap above)
        max_contracts:              effectiveMaxContracts,
        base_contracts:             scaledBaseContracts,
        tier_increment:             scaledTierIncrement,
        // Wave 23F (2026-05-19) — A+ confluence gate fields (optional; undefined when LLM omits)
        ...(confluenceFactors !== undefined   && { confluence_factors:       confluenceFactors }),
        ...(minFactorsSatisfied !== undefined && { min_factors_satisfied:    minFactorsSatisfied }),
        ...(sourceClaimWinRate !== undefined  && { source_claim_win_rate:    sourceClaimWinRate }),
        ...(sourceClaimAvgR !== undefined     && { source_claim_avg_r:       sourceClaimAvgR }),
        ...(extractedSymbols !== undefined    && { symbols:                  extractedSymbols }),
        // W23H/W23G.11 (2026-05-21) — bias-MTF + confluence indicator fields
        ...(biasTimeframe !== undefined        && { bias_timeframe:           biasTimeframe }),
        ...(biasCondition !== undefined        && { bias_condition:           biasCondition }),
        ...(executionTimeframe !== undefined   && { execution_timeframe:      executionTimeframe }),
        ...(primaryIndicator !== undefined     && { primary_indicator:        primaryIndicator }),
        ...(confirmingIndicators !== undefined && { confirming_indicators:    confirmingIndicators }),
        ...(preferredRegimes !== undefined     && { preferred_regimes:        preferredRegimes }),
        // Wave 26 Pass I (2026-05-26) — v11 deep-extraction forwards
        ...(entrySequence !== undefined           && { entry_sequence:           entrySequence }),
        ...(stopLossV11 !== undefined             && { stop_loss:                stopLossV11 }),
        ...(targetsV11 !== undefined              && { targets:                  targetsV11 }),
        ...(filtersV11 !== undefined              && { filters:                  filtersV11 }),
        ...(timeframesV11 !== undefined           && { timeframes:               timeframesV11 }),
        ...(indicatorsUsedV11 !== undefined       && { indicators_used:          indicatorsUsedV11 }),
        ...(extractionGapReasonV11 !== undefined  && { extraction_gap_reason:    extractionGapReasonV11 }),
        ...(speakerConceptsV12 !== undefined      && { speaker_concepts:         speakerConceptsV12 }),
      });
    }

    // ─── Wave 26 Pass K Phase 7 (2026-05-27) — Under-extraction detection ─────
    // Before mechanic-portability fires, remember how many raw strategies gemma
    // emitted BEFORE the symbol-remap + schema filter dropped them. If gemma saw
    // a strategy but ideas[] ended up empty, the user-facing embed should say
    // "Slumdawg almost had it — couldn't pull all the rules" instead of the
    // generic "mostly talk" reject. The bot reads `gemma_saw` to branch.
    // ─── Wave 26 Pass J Phase 2 (2026-05-26) — Mechanic Portability Audit ──
    // (Classification moved earlier in Pass K Phase 7v2 — see comment above the
    // strategy-processing loop. Audit emission stays here since it needs the
    // final ideas.length to surface "ideas_extracted: N" for observability.)
    insertAuditRow({
      action: "extraction.mechanic_portability_classified",
      entityType: "scout_extract",
      entityId: null,
      status: portability.portable ? "success" : "info",
      result: {
        source_url: sourceUrl,
        portable: portability.portable,
        reject_class: portability.reject_class,
        evidence: portability.evidence,
        confidence: portability.confidence,
        ideas_extracted: ideas.length,
        llm_instrument_classification: lastInstrumentClassification,
      },
    });

    if (ideas.length === 0) {
      // Disambiguate the empty-ideas case using mechanic portability:
      //   - portable + gemma saw something: under-extraction → extracted_under_filled
      //   - portable + gemma saw nothing:   no_strategy_content (mostly talk)
      //   - not portable: strategy mechanics don't port to intraday futures → reject_class
      if (portability.portable) {
        if (rawStrategyCount > 0) {
          // Gemma emitted a strategy but the symbol-remap + schema filter dropped it
          // (most common cause: under-extraction — strategy name present but
          // targets/entry_sequence/stop_loss missing or symbol field empty).
          res.status(200).json({
            extracted: false,
            reason: "extracted_under_filled",
            ideas: [],
            portable: true,
            gemma_saw: rawStrategyNames,
            gemma_saw_count: rawStrategyCount,
          });
          return;
        }
        res.status(200).json({
          extracted: false,
          reason: "no_strategy_content",
          ideas: [],
          portable: true,
        });
      } else {
        res.status(200).json({
          extracted: false,
          reason: portability.reject_class!,
          reason_detail: explainRejectClass(portability.reject_class!),
          evidence: portability.evidence,
          ideas: [],
          portable: false,
        });
      }
      return;
    }

    // Override path: Gemma flagged non_futures_primary but mechanic portability says it ports.
    // Speaker demonstrated on a forex/stock/crypto chart while teaching universal mechanics.
    // Trust the mechanic classifier over Gemma's chart-based classification.
    let finalClassification = lastInstrumentClassification ?? "futures_primary";
    if (lastInstrumentClassification === "non_futures_primary" && portability.portable) {
      insertAuditRow({
        action: "extraction.mechanic_classification_override",
        entityType: "scout_extract",
        entityId: null,
        status: "info",
        result: {
          source_url: sourceUrl,
          llm_said: "non_futures_primary",
          override_to: "futures_primary",
          reason: "mechanic_portability=true (cross-market mechanic — speaker chart is not the strategy's market)",
          ideas_count: ideas.length,
        },
      });
      finalClassification = "futures_primary";
    }

    // Layer 1 (E-RECALL 2026-06-22): wire the previously test-only recall tier into
    // production. Gap-fill ideas[0] (primary_tool_setup via Q6, time/candle/instrument)
    // BEFORE the coverage gate so the comparator sees the enriched extraction and the
    // _recall_primary_tool_note annotation populates. Sequential, single GPU. Non-blocking.
    try {
      const recallTarget = ideas[0] as import("../lib/transcript-extractor-recall.js").PrimaryStrategyShape | undefined;
      if (recallTarget) {
        const recallRes = await runRecallPass(markdown, recallTarget);
        if (!recallRes.failed && recallRes.appliedChanges.length > 0) {
          ideas[0] = recallRes.patched as typeof ideas[0];
          insertAuditRow({
            action: "extraction.recall_applied",
            entityType: "scout_extract",
            entityId: null,
            status: "info",
            result: {
              source_url: sourceUrl,
              applied_changes: recallRes.appliedChanges,
              lineage_key: extractionLineageKey,
              video_id: _videoId,
            },
            correlationId,
          }).catch(() => {});
        }
      }
    } catch (recallErr) {
      logger.warn(
        { err: recallErr instanceof Error ? recallErr.message : String(recallErr), sourceUrl },
        "scout-extract: recall pass threw (non-blocking — continuing without gap-fill)",
      );
    }

    // Layer 1.5 (CONFLUENCE RECOVERY 2026-06-23): the local model often files confirmations under
    // entry_sequence (procedural channel) instead of confluence_factors (evaluation channel). The
    // dual-score diagnostic PROVED this is representational — SY2/gdd/ktkqq/75DJ carry 3-6 distinct
    // confluence families in their step text while reporting 0 explicit; rf_/Fqx/iU8/z3Qn unchanged;
    // truly-thin N7uP stays at 1. This pass AUGMENTS (never replaces) ideas[0]'s confluences by
    // reading distinct categories from steps (family-deduped, provenance-tagged step_inferred vs
    // explicit). The gate is UNTOUCHED — it still requires real confluences; we read them from the
    // field the model used. Runs BEFORE coverage so FIX-13 + compilability both see the recovery.
    try {
      const recoveryTarget = ideas[0] as import("../lib/confluence-recovery.js").IdeaLike | undefined;
      if (recoveryTarget) {
        const rep = recoverConfluences(recoveryTarget);
        if (rep.recovered.length > 0) {
          insertAuditRow({
            action: "extraction.confluence_recovered",
            entityType: "scout_extract",
            entityId: null,
            status: "info",
            result: {
              source_url: sourceUrl,
              explicit_count: rep.explicit_count,
              recovered_count: rep.recovered.length,
              recovered: rep.recovered.map((r) => ({ category: r.category, canonical: r.name, step: r.evidence_step })),
              lineage_key: extractionLineageKey,
              video_id: _videoId,
            },
            correlationId,
          }).catch(() => {});
        }
      }
    } catch (recoveryErr) {
      logger.warn(
        { err: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr), sourceUrl },
        "scout-extract: confluence recovery threw (non-blocking — continuing)",
      );
    }

    // W3.1 — Coverage gate: enumerate what the speaker taught and cross-check
    // against the extraction. Layer 3 (E-REPAIR) runs the bounded repair loop on a
    // coverage_failed verdict BEFORE W3.2's quarantine. We use the first extracted
    // idea's entry_sequence + confluences as the representative extraction snapshot.
    let coverageVerdictResult: import("../lib/extraction-coverage-gate.js").CoverageVerdict | null = null;
    let coverageSpeakerItems: import("../lib/extraction-coverage-gate.js").SpeakerItem[] = [];
    try {
      const firstIdea = ideas[0] as import("../lib/extraction-coverage-gate.js").ExtractionSnapshot | undefined;
      if (firstIdea) {
        const { speakerItems, verdict } = await runCoverageGate(markdown, firstIdea);
        coverageSpeakerItems = speakerItems; // exposed below for cached fast-grade iteration
        let finalVerdict = verdict;
        let repairRounds = 0;
        let repairedItems: string[] = [];

        // Layer 3 (E-REPAIR): if a PRIMARY speaker item is missing/shallow, run the bounded
        // quote-grounded repair loop — feed the missing items + their verbatim quotes back to
        // gemma, gap-fill merge, re-verify (free, same speakerItems). Residual misses fall
        // through to the W3.2 quarantine below. Convergence is monotone + round-bounded.
        if (verdict.verdict !== "pass") {
          try {
            const repair = await runCoverageRepairLoop({
              transcript: markdown,
              extraction: firstIdea,
              speakerItems,
              verdict,
            });
            finalVerdict = repair.verdict;
            repairRounds = repair.rounds;
            repairedItems = repair.repaired;
            if (repair.rounds > 0) {
              ideas[0] = repair.extraction as typeof ideas[0]; // repaired extraction flows downstream
              insertAuditRow({
                action: "extraction.coverage_repair_round",
                entityType: "scout_extract",
                entityId: null,
                status: finalVerdict.verdict === "pass" ? "success" : "info",
                result: {
                  source_url: sourceUrl,
                  rounds: repair.rounds,
                  repaired: repair.repaired,
                  coverage_pct_before: verdict.coverage_pct,
                  coverage_pct_after: finalVerdict.coverage_pct,
                  still_missing: finalVerdict.missing,
                  still_shallow: finalVerdict.shallow,
                  lineage_key: extractionLineageKey,
                  video_id: _videoId,
                },
                correlationId,
              }).catch(() => {});
            }
          } catch (repairErr) {
            logger.warn(
              { err: repairErr instanceof Error ? repairErr.message : String(repairErr), sourceUrl },
              "scout-extract: coverage repair loop threw (non-blocking — using pre-repair verdict)",
            );
          }
        }

        // Layer 4 (E-NAMING 2026-06-22): on the COMPLETED (post-repair) extraction, replace a
        // generic concept_name with one synthesized from the top PRIMARY speaker item so the
        // graduator's deriveEntryIndicator routes it to a real archetype (e.g.
        // gann_box_4h_continuation) instead of pooling into the sha256("extracted") junk bucket.
        try {
          if (speakerItems.length > 0) {
            const idea0 = ideas[0] as Record<string, unknown>;
            const currentConcept = typeof idea0.concept_name === "string" ? idea0.concept_name : "";
            const currentName = typeof idea0.name === "string" ? idea0.name : "";
            const isGeneric = (s: string) => !s || /^extracted(_strategy)?$/i.test(s);
            if (isGeneric(currentConcept) && isGeneric(currentName)) {
              const topPrimary = speakerItems.find((i) => i.emphasis_level === "primary") ?? speakerItems[0];
              const slug = topPrimary.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "")
                .slice(0, 48);
              if (slug.length >= 3) {
                idea0.concept_name = slug;
                idea0.name = slug;
                // ensure entry_indicator non-null so the compilability gate + deriveEntryIndicator can route
                const ei = typeof idea0.entry_indicator === "string" ? idea0.entry_indicator : "";
                if (!ei) idea0.entry_indicator = slug;
                insertAuditRow({
                  action: "extraction.concept_named",
                  entityType: "scout_extract",
                  entityId: null,
                  status: "info",
                  result: {
                    source_url: sourceUrl,
                    synthesized_concept: slug,
                    from_speaker_item: topPrimary.name,
                    emphasis: topPrimary.emphasis_level,
                    lineage_key: extractionLineageKey,
                    video_id: _videoId,
                  },
                  correlationId,
                }).catch(() => {});
              }
            }
          }

          // FIX 6 (5-URL audit 2026-06-22): ensure entry_indicator is non-null even when the
          // concept is already well-named (e.g. "4h_candle_box_continuation", "volume_profile").
          // A null entry_indicator was quarantining good extractions + blocking archetype routing;
          // deriveEntryIndicator maps the concept -> archetype downstream.
          const eiIdea = ideas[0] as Record<string, unknown>;
          const eiVal = typeof eiIdea.entry_indicator === "string" ? eiIdea.entry_indicator : "";
          const eiConcept = typeof eiIdea.concept_name === "string"
            ? eiIdea.concept_name
            : (typeof eiIdea.name === "string" ? eiIdea.name : "");
          if (!eiVal && eiConcept && !/^extracted(_strategy)?$/i.test(eiConcept)) {
            eiIdea.entry_indicator = eiConcept;
          }
        } catch (nameErr) {
          logger.warn(
            { err: nameErr instanceof Error ? nameErr.message : String(nameErr), sourceUrl },
            "scout-extract: Layer 4 naming threw (non-blocking — keeping prior concept_name)",
          );
        }

        coverageVerdictResult = finalVerdict;
        // Emit audit row for observability — non-blocking. Reflects the FINAL (post-repair) verdict.
        // W3.3: lineage_key added for replay/idempotency correlation.
        insertAuditRow({
          action: "extraction.coverage_evaluated",
          entityType: "scout_extract",
          entityId: null,
          status: finalVerdict.verdict === "pass" ? "success" : "info",
          result: {
            source_url: sourceUrl,
            speaker_items_found: speakerItems.length,
            covered: finalVerdict.covered,
            shallow: finalVerdict.shallow,
            missing: finalVerdict.missing,
            coverage_pct: finalVerdict.coverage_pct,
            verdict: finalVerdict.verdict,
            repair_rounds: repairRounds,
            repaired_items: repairedItems,
            lineage_key: extractionLineageKey,
            video_id: _videoId,
            transcript_hash: _transcriptHash,
            extractor_version: _extractorVersion,
          },
          correlationId,
        }).catch((auditErr: unknown) => {
          logger.warn(
            { err: auditErr instanceof Error ? auditErr.message : String(auditErr), sourceUrl },
            "scout-extract: coverage_evaluated audit insert failed (non-blocking)",
          );
        });
        if (finalVerdict.verdict === "coverage_failed") {
          logger.warn(
            {
              sourceUrl,
              missing: finalVerdict.missing,
              shallow: finalVerdict.shallow,
              coverage_pct: finalVerdict.coverage_pct,
              repair_rounds: repairRounds,
              speaker_items: speakerItems.map((i) => `${i.name} [${i.emphasis_level}]`),
            },
            "scout-extract: coverage_failed AFTER repair — primary speaker tool still missing (W3.2 will quarantine)",
          );
        }
      }
    } catch (coverageErr) {
      logger.warn(
        { err: coverageErr instanceof Error ? coverageErr.message : String(coverageErr), sourceUrl },
        "scout-extract: coverage gate threw unexpectedly (non-blocking — continuing with extraction result)",
      );
    }

    // W3.2 — Compilability gate (fail-closed extraction quarantine).
    // For each extracted idea, run the compilability gate. Any idea that fails
    // is routed to needs_archetype_queue and marked quarantined in the response.
    // The gate is applied per-idea because multi-idea responses can have one
    // good and one bad extraction in the same response.
    //
    // Note: the fingerprint collision fix (computeQuarantineFingerprintHash) is
    // applied here — quarantined ideas get a unique per-source fingerprint that
    // NEVER collapses into the same bucket, regardless of their concept_name.
    let quarantinedCount = 0;
    const compilabilityResults: Array<{ ideaIndex: number; compilable: boolean; missing: string[]; quarantine_hash?: string }> = [];
    for (let ideaIdx = 0; ideaIdx < ideas.length; ideaIdx++) {
      const idea = ideas[ideaIdx] as Record<string, unknown>;
      const conceptName = typeof idea.concept_name === "string" ? idea.concept_name : "";
      const entryIndicator = typeof idea.entry_indicator === "string" ? idea.entry_indicator : null;
      const archetype = typeof idea.archetype === "string" ? idea.archetype : null;
      const entryParams = idea.entry_params && typeof idea.entry_params === "object" ? (idea.entry_params as Record<string, unknown>) : null;
      const entryCondition = typeof idea.entry_condition === "string" ? idea.entry_condition : null;
      const entryType = typeof idea.entry_type === "string" ? idea.entry_type : null;
      const direction = typeof idea.direction === "string" ? idea.direction : null;
      const ideaTimeframe = typeof idea.timeframe === "string" ? idea.timeframe : null;
      const confluenceFactors = Array.isArray(idea.confluences)
        ? (idea.confluences as Array<{ name?: string }>).map((c) => c.name ?? "").filter((n) => n.length > 0)
        : (Array.isArray(idea.confluence_factors) ? (idea.confluence_factors as string[]) : []);

      // Only apply coverage_verdict from W3.1 to the FIRST idea (it was computed against ideas[0]).
      const coverageForIdea = ideaIdx === 0 ? coverageVerdictResult : null;

      // 2026-06-24 Layer 1: resolve the entry_indicator through the SAME router the graduator
      // uses, so the gate's "does this carry a real trigger?" decision is resolution-aware.
      // "archetype:<key>" → structural (params optional); "uncatalogued:<...>" → needs-structure;
      // bare engine indicator (macd_crossover, …) → parametric (needs params).
      const resolvedEntryIndicator = deriveEntryIndicator(conceptName, null, entryIndicator);

      const gateResult = checkCompilabilityGate(
        {
          entry_indicator: entryIndicator,
          archetype,
          entry_params: entryParams,
          entry_condition: entryCondition,
          entry_type: entryType,
          resolved_entry_indicator: resolvedEntryIndicator,
          direction,
          timeframe: ideaTimeframe,
          confluence_factors: confluenceFactors,
          coverage_verdict: coverageForIdea,
        },
        conceptName,
      );

      if (!gateResult.compilable) {
        quarantinedCount++;
        const quarantineHash = computeQuarantineFingerprintHash({
          concept_name: conceptName,
          source_url: sourceUrl,
        });
        compilabilityResults.push({ ideaIndex: ideaIdx, compilable: false, missing: gateResult.missing, quarantine_hash: quarantineHash });
        // Route to quarantine queue — fire-and-forget, non-blocking
        quarantineExtraction({
          concept_name: conceptName,
          source_url: sourceUrl,
          missing: gateResult.missing,
          coverage_verdict: coverageForIdea,
          reason: gateResult.reason,
          correlationId,
        }).catch((qErr: unknown) =>
          logger.warn(
            { err: qErr instanceof Error ? qErr.message : String(qErr), sourceUrl, conceptName },
            "W3.2: quarantineExtraction() threw (non-blocking — extraction result still returned)",
          ),
        );
        logger.warn(
          { sourceUrl, conceptName, missing: gateResult.missing, quarantine_hash: quarantineHash, idea_index: ideaIdx },
          "W3.2: extraction quarantined — compilability gate failed",
        );
      } else {
        compilabilityResults.push({ ideaIndex: ideaIdx, compilable: true, missing: [] });
      }
    }

    // W23G.7 + W23G.2 — include telemetry fields in success response.
    // extraction_mode: single_pass | chunked_fallback — for callers to log cycle-level stats.
    // instrument_classification: advisory classification (Pass J: post-override-aware).
    // tokens_estimated: char_count / 4 estimate for budget observability.
    // W3.1 — coverage_verdict: advisory signal for downstream (W3.2 quarantine).
    // W3.2 — compilability_results: per-idea gate outcomes so n8n can skip quarantined ideas.
    res.json({
      extracted: true,
      ideas,
      extraction_mode: extractionMode,
      instrument_classification: finalClassification,
      mechanic_portable: portability.portable,
      tokens_estimated: Math.ceil(markdown.length / 4),
      ...(coverageVerdictResult !== null && { coverage_verdict: coverageVerdictResult }),
      _coverage_speaker_items: coverageSpeakerItems, // debug: raw enum output for cached fast-grade
      compilability_results: compilabilityResults,
      quarantined_count: quarantinedCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, sourceUrl }, "scout-extract failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/analyze-market ────────────────────────────────
// Synchronous — returns regime detection result

agentRoutes.post("/analyze-market", async (req, res) => {
  const parsed = analyzeMarketSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await analyzeMarket(
      parsed.data.symbol,
      parsed.data.timeframe,
      parsed.data.adx_period,
    );
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/robustness ────────────────────────────────────
// Fire-and-forget — returns job ID

agentRoutes.post("/robustness", async (req, res) => {
  const parsed = robustnessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Wave hardening 2026-06-22: INSERT mutable job row into agent_jobs (NOT
  // audit_log). audit_log is append-only; UPDATEs against it throw from the
  // migration-0058 trigger. Also emit an immutable "submitted" event to
  // audit_log so the audit trail remains complete.
  const correlationId = req.id ?? null;
  const [job] = await db.insert(agentJobs).values({
    action: "agent.robustness",
    strategyId: parsed.data.strategy_id,
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
    correlationId,
  }).returning();

  // Append-only submission event — audit trail only, never mutated.
  void db.insert(auditLog).values({
    action: "agent.robustness.submitted",
    entityType: "strategy",
    entityId: parsed.data.strategy_id,
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
    decisionAuthority: "agent",
    correlationId,
  }).catch((err) => {
    logger.warn({ err, jobId: job.id }, "Failed to write robustness.submitted audit event");
  });

  // Fix 3c (2026-06-29): set started_at on pickup so the stale-pending-sweeper
  // measures elapsed time from actual execution start (not job creation).
  void db.update(agentJobs).set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentJobs.id, job.id))
    .catch((dbErr) => { logger.warn({ err: dbErr, jobId: job.id }, "agent.robustness: failed to set started_at on pickup"); });

  // Fire and forget — update the mutable agent_jobs row when the run
  // finishes. These UPDATEs now succeed because agent_jobs has no
  // append-only trigger.
  const configJson = JSON.stringify(parsed.data.config);
  runRobustnessTest(parsed.data.strategy_id, configJson)
    .then(async (result) => {
      await db.update(agentJobs).set({
        status: "success",
        result: {
          is_robust: result.robustness?.is_robust ?? null,
          best_score: result.best_score ?? null,
          n_trials: result.n_trials ?? null,
        } as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      }).where(eq(agentJobs.id, job.id)).catch((dbErr) => {
        logger.error({ err: dbErr, jobId: job.id }, "Failed to update robustness agent_job row on success");
      });
      // Immutable terminal event for audit trail.
      void db.insert(auditLog).values({
        action: "agent.robustness.completed",
        entityType: "strategy",
        entityId: parsed.data.strategy_id,
        status: "success",
        decisionAuthority: "agent",
        correlationId,
      }).catch(() => undefined);
    })
    .catch(async (err) => {
      logger.error({ err, strategyId: parsed.data.strategy_id, jobId: job.id }, "Fire-and-forget robustness test failed");
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.update(agentJobs).set({
        status: "failure",
        result: { error: errorMsg } as unknown as Record<string, unknown>,
        errorMessage: errorMsg,
        updatedAt: new Date(),
      }).where(eq(agentJobs.id, job.id)).catch((dbErr) => {
        logger.error({ err: dbErr, jobId: job.id }, "Failed to update robustness agent_job row on failure");
      });
      void db.insert(auditLog).values({
        action: "agent.robustness.failed",
        entityType: "strategy",
        entityId: parsed.data.strategy_id,
        status: "failure",
        errorMessage: errorMsg,
        decisionAuthority: "agent",
        correlationId,
      }).catch(() => undefined);
    });

  res.status(202).json({ job_id: job.id, message: "Robustness test submitted" });
});

// ─── POST /api/agent/find-strategies ───────────────────────────────
// Fire-and-forget — calls Ollama gemma4:e4b-it-qat model to generate DSL strategies,
// validates each, then submits valid ones for backtest via agentService.runStrategy.

agentRoutes.post("/find-strategies", async (req, res) => {
  const parsed = findStrategiesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Wave hardening 2026-06-22: INSERT mutable job row into agent_jobs (NOT
  // audit_log). audit_log is append-only (migration-0058 trigger); UPDATEs
  // against it throw. Also emit an immutable submitted event to audit_log.
  const findStrategiesCorrelationId = req.id ?? null;
  const [job] = await db.insert(agentJobs).values({
    action: "agent.find-strategies",
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
    correlationId: findStrategiesCorrelationId,
  }).returning();

  void db.insert(auditLog).values({
    action: "agent.find-strategies.submitted",
    entityType: "strategy",
    input: parsed.data as unknown as Record<string, unknown>,
    status: "pending",
    decisionAuthority: "agent",
    correlationId: findStrategiesCorrelationId,
  }).catch((err) => {
    logger.warn({ err, jobId: job.id }, "Failed to write find-strategies.submitted audit event");
  });

  const { symbol, timeframe, start_date, end_date, count } = parsed.data;

  // Fire and forget — generate strategies via Ollama, validate, backtest
  (async () => {
    // Fix 3c (2026-06-29): set started_at on pickup so the stale-pending-sweeper
    // measures elapsed time from actual execution start (not job creation).
    void db.update(agentJobs).set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentJobs.id, job.id))
      .catch((dbErr) => { logger.warn({ err: dbErr, jobId: job.id }, "agent.find-strategies: failed to set started_at on pickup"); });

    const ollama = new OllamaClient();
    const results: Array<{ name: string; status: string; error?: string }> = [];

    // Fetch failure patterns from recent journal entries to avoid repeating mistakes
    let avoidBlock = "";
    try {
      const { avoidPatterns } = await agentService.getFailurePatterns(30, 50);
      if (avoidPatterns.length > 0) {
        avoidBlock = `\n\nAVOID these patterns from recent failed strategies:\n${avoidPatterns.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n`;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch failure patterns — continuing without AVOID list");
    }

    for (let i = 0; i < count; i++) {
      try {
        const prompt = `Generate a unique ${symbol} futures trading strategy for the ${timeframe} timeframe.
Strategy #${i + 1} of ${count}. Each strategy must be different.
Focus on proven edges: trend following, mean reversion, volatility expansion, or session patterns.
Target: $250+/day avg P&L, 60%+ win days, profit factor >= 1.75, max drawdown <= $2,000.${avoidBlock}
Output ONLY the DSL JSON object, nothing else.`;

        const response = await ollama.generate("gemma4:e4b-it-qat", prompt, {
          temperature: 0.7 + (i * 0.05), // Vary temperature for diversity
          num_ctx: 8192,
        });

        // Extract JSON from response (handle possible markdown fences)
        let jsonStr = response.response.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        let dsl: Record<string, unknown>;
        try {
          dsl = JSON.parse(jsonStr);
        } catch {
          results.push({ name: `strategy_${i + 1}`, status: "failed", error: "Invalid JSON from Ollama" });
          continue;
        }

        // Validate required DSL fields
        const requiredFields = ["name", "description", "symbol", "timeframe", "direction",
          "entry_type", "entry_indicator", "entry_params", "entry_condition",
          "exit_type", "exit_params", "stop_loss_atr_multiple"];
        const missing = requiredFields.filter((f) => !(f in dsl));
        if (missing.length > 0) {
          results.push({ name: String(dsl.name ?? `strategy_${i + 1}`), status: "failed", error: `Missing DSL fields: ${missing.join(", ")}` });
          continue;
        }

        // Validate entry_params has <= 5 keys
        const entryParams = dsl.entry_params as Record<string, unknown> | undefined;
        if (entryParams && Object.keys(entryParams).length > 5) {
          results.push({ name: String(dsl.name), status: "failed", error: "entry_params exceeds 5 parameter limit" });
          continue;
        }

        // If python_code is present, submit for backtest via runStrategy
        const pythonCode = dsl.python_code as string | undefined;
        if (pythonCode && pythonCode.length > 0) {
          const strategyResult = await agentService.runStrategy({
            strategy_name: String(dsl.name),
            one_sentence: String(dsl.description),
            python_code: pythonCode,
            params: (entryParams ?? {}) as Record<string, unknown>,
            symbol: symbol as "MES" | "MNQ" | "MCL",
            timeframe,
            start_date,
            end_date,
            source: "ollama",
          });
          results.push({ name: String(dsl.name), status: strategyResult.status });
        } else {
          // No python_code — save DSL-only strategy (compiler-validated, no backtest yet)
          results.push({ name: String(dsl.name), status: "validated", error: "No python_code — saved DSL only, backtest skipped" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ name: `strategy_${i + 1}`, status: "failed", error: msg });
      }
    }

    // Wave hardening 2026-06-22: update agent_jobs (mutable) — NOT audit_log
    // (append-only). If the pipeline is paused, runStrategy returns status
    // "skipped" for every strategy. Treating that as "failure" produces a false
    // alarm in the job tracker — surface it as "skipped" instead so operators
    // can distinguish a paused-pipeline outcome from genuine generation failures.
    const hasCompleted = results.some((r) => r.status === "completed");
    const allSkipped = results.length > 0 && results.every((r) => r.status === "skipped");
    const aggregatedStatus = hasCompleted ? "success" : (allSkipped ? "skipped" : "failure");
    await db.update(agentJobs).set({
      status: aggregatedStatus,
      result: { strategies: results } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(agentJobs.id, job.id));

    // Immutable terminal event for audit trail.
    void db.insert(auditLog).values({
      action: `agent.find-strategies.${aggregatedStatus === "success" ? "completed" : aggregatedStatus}`,
      entityType: "strategy",
      status: aggregatedStatus === "success" ? "success" : "failure",
      decisionAuthority: "agent",
      correlationId: findStrategiesCorrelationId,
      result: { strategies: results } as unknown as Record<string, unknown>,
    }).catch(() => undefined);

    logger.info({ jobId: job.id, results }, "find-strategies completed");
  })().catch((err) => {
    logger.error({ err, jobId: job.id }, "find-strategies failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    db.update(agentJobs).set({
      status: "failure",
      result: { error: errMsg } as unknown as Record<string, unknown>,
      errorMessage: errMsg,
      updatedAt: new Date(),
    }).where(eq(agentJobs.id, job.id)).catch((dbErr) => {
      logger.error({ err: dbErr, jobId: job.id }, "Failed to update agent_job status after find-strategies error");
    });
    void db.insert(auditLog).values({
      action: "agent.find-strategies.failed",
      entityType: "strategy",
      status: "failure",
      errorMessage: errMsg,
      decisionAuthority: "agent",
      correlationId: findStrategiesCorrelationId,
    }).catch(() => undefined);
  });

  res.status(202).json({ job_id: job.id, message: "Strategy search submitted" });
});

// ─── POST /api/agent/scout-ideas/pending ─────────────────────────────────
// Pass 18 — Cross-source validation pending bucket.
//
// Every scout extraction now lands here first instead of /scout-ideas/strict.
// The pending layer accumulates evidence: once ≥3 distinct source_providers
// confirm the same fingerprint, the route graduates the bucket by internally
// POSTing the best consensus idea to /scout-ideas/strict.
//
// Fingerprint key: sha256(market|entry_archetype|exit_type).hex()[:32]
//   - Same setup from different sources → same bucket
//   - Different setup (different market or different archetype) → new bucket
//
// Idempotency: (bucket_id, source_url) — same URL cannot count twice.
//
// is_cross_validation_result:
//   - false (default, organic scout): fire-and-forget POST to CV1 webhook
//   - true (CV1 cross-validator posting back a match): skip the webhook to
//     avoid infinite loops
//
// Graduation transaction is race-safe: UPDATE WHERE status='pending' means
// only one concurrent graduation wins.

// Extended source_provider enum for the pending endpoint (includes new scouts).
// Pass 21: added compound provider values that n8n workflows 5P/5Q/5R emit.
// They used to be rejected silently — a critical bug that blocked organic graduations.
const pendingSourceProviderEnum = z.enum([
  "brave", "tavily", "exa", "parallel", "reddit", "manual",
  "youtube", "scrapingbee", "apify", "tf_search",
  "scrapingbee_youtube", "reddit_json", "brave_search",
  "parallel_web_discovery", "exa_web_discovery",
  // Wave 9 (2026-05-17) — Google YT Data API + youtube-transcript npm chain
  "youtube_data_api", "youtube_transcript_npm",
]);

const pendingIdeaSchema = z.object({
  thesis: z.string().min(20).max(2000),
  market: z.enum(["MES", "MNQ", "MCL"]),
  timeframe: z.string().min(1),
  entry_rules: z.string().min(20).max(2000),
  exit_rules: z.string().min(20).max(2000),
  risk_rules: z.string().min(10).max(1000),
  source_url: z.string().url(),
  regime: z.string().min(1),
  concept_name: z.string().min(1),
  source_provider: pendingSourceProviderEnum,
  confidence_score: z.number().min(0).max(1).optional(),
  signal_type: z.enum(["strategy_candidate", "market_news_intel", "research_find"]).optional(),
  is_cross_validation_result: z.boolean().default(false),
  cross_validator_confidence: z.number().min(0).max(1).optional(),
  // Pass 20: scout layer that produced this mention.
  // Defaults to 'web' for backward compat with Pass 18/19 callers.
  // Graduation for concept-fingerprinted buckets requires all 3 layers true.
  layer: z.enum(["web", "youtube", "reddit"]).default("web"),
  // Wave 18 (2026-05-18) — rich parametric DSL forwarded by Wave 17 postLayerMention.
  // Optional because CV-only mentions (Wave 9 fallback, web-cite-only) won't have them.
  // When present, these MUST be propagated to extracted_idea so the graduator's
  // best-mention scorer + dsl_quality_critic + Wave 14 canonical-defaults can use them.
  name:                       z.string().optional(),
  entry_indicator:            z.string().optional(),
  entry_archetype:            z.string().optional(),
  entry_params:               z.record(z.unknown()).optional(),
  entry_condition:            z.string().optional(),
  entry_type:                 z.string().optional(),
  direction:                  z.enum(["long", "short", "both"]).optional(),
  exit_type:                  z.string().optional(),
  exit_params:                z.record(z.unknown()).optional(),
  stop_loss_atr_multiple:     z.number().optional(),
  take_profit_atr_multiple:   z.number().optional(),
  preferred_regime:           z.string().optional(),
  session_filter:             z.string().optional(),
  extraction_confidence:      z.number().min(0).max(1).optional(),
  max_contracts:              z.number().optional(),
  base_contracts:             z.number().optional(),
  tier_increment:             z.number().optional(),
  // Wave 23F (2026-05-19) — A+ confluence gate fields forwarded from scout-extract.
  // All optional: extractors that omit them must not crash the pipeline.
  // Defaults apply downstream at graduation, not at extraction.
  confluence_factors: z.array(z.enum([
    "regime_match", "structural_setup", "volume_confirmation",
    "macro_alignment", "vp_shape",
  ])).optional(),
  min_factors_satisfied:      z.number().int().min(0).max(5).optional(),
  source_claim_win_rate:      z.number().min(0).max(1).nullable().optional(),
  source_claim_avg_r:         z.number().nullable().optional(),
  symbols:                    z.array(z.enum(["MES", "MNQ", "MCL"])).optional(),
  // W23F.E — scout-runner rotation seed tag (post-restart fix 2026-05-19).
  // Stored in extracted_idea so the graduator can prefer it when LLM symbol inference is ambiguous.
  __scout_seeded_symbol:      z.enum(["MES", "MNQ", "MCL"]).optional(),
  // Wave 26 Pass H1 Bug 4 — operator-ingest sibling-accept bypass.
  // When operator-ingest already has ≥1 validated bucket for the same video_id,
  // subsequent layers that fail source-URL verification (e.g. intermittent YouTube
  // network failures) can be accepted-by-sibling. The field carries the UUID of an
  // already-accepted bucket from this same ingest correlationId.
  operator_ingest_sibling_bucket_id: z.string().uuid().optional(),
  // Wave 26 Pass H1 Bug 1 — absorbed sub-concepts for multi-layer archetype merge.
  // Stored in bucket.config.absorbed_sub_concepts for traceability.
  absorbed_sub_concepts: z.array(z.string()).optional(),
  // Wave 26 Pass I (2026-05-26) — v11 deep-extraction fields. Synthesized from
  // Gemma prose by gemma-prose-to-v11.ts and forwarded through the route chain.
  // All optional + permissive shape — zod was stripping these silently without explicit declaration.
  entry_sequence:        z.array(z.record(z.unknown())).optional(),
  stop_loss:             z.record(z.unknown()).optional(),
  targets:               z.array(z.record(z.unknown())).optional(),
  filters:               z.array(z.record(z.unknown())).optional(),
  timeframes:            z.record(z.unknown()).optional(),
  indicators_used:       z.array(z.record(z.unknown())).optional(),
  extraction_gap_reason: z.string().optional(),
  _v11_synthesis_source: z.string().optional(),
  // Wave 26 Pass I v12 — speaker vocabulary preservation
  speaker_concepts:      z.array(z.record(z.unknown())).optional(),
});

// Graduation threshold constants — explicit, no magic numbers
const GRADUATION_SOURCE_COUNT_THRESHOLD    = 3;
const GRADUATION_PROVIDERS_THRESHOLD       = 3;
// Pass 21 — fast-graduation path: when at least 2 of the 3 layers are confirmed
// (web + reddit, OR web + youtube, OR reddit + youtube) AND ≥2 distinct providers
// AND ≥3 total source mentions, allow graduation without requiring all 3 layers.
// Rationale: YouTube's transcript_extractor is intentionally strict (won't
// fabricate parametric strategies). Real edges discovered on web + reddit
// shouldn't be held hostage to a YouTube layer that may never confirm.
// Strict 3-layer path remains as the GOLD standard; this is the SILVER path.
const FAST_GRADUATION_SOURCE_COUNT_THRESHOLD = 3;
const FAST_GRADUATION_PROVIDERS_THRESHOLD    = 2;
const FAST_GRADUATION_LAYERS_THRESHOLD       = 2;

agentRoutes.post("/scout-ideas/pending", idempotencyMiddleware, async (req, res) => {
  const parsed = pendingIdeaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — pending scout schema not satisfied",
      details: parsed.error.issues,
      hint: "Required fields: thesis, market, timeframe, entry_rules, exit_rules, risk_rules, source_url, regime, concept_name, source_provider",
    });
    return;
  }

  const idea = parsed.data;

  // Pass 21 — CLAUDE.md §13 hard block: refuse to accept any mention whose
  // content references options derivatives. Trading Forge trades MES/MNQ/MCL
  // futures only; options strategies (straddles, strangles, etc.) are out of
  // scope and would pollute buckets. Check all narrative fields + the source URL.
  for (const [field, txt] of [
    ["thesis", idea.thesis],
    ["entry_rules", idea.entry_rules],
    ["exit_rules", idea.exit_rules],
    ["risk_rules", idea.risk_rules],
    ["source_url", idea.source_url],
    ["concept_name", idea.concept_name],
  ] as const) {
    const c = containsForbiddenOptionsContent(txt);
    if (c.blocked) {
      req.log.warn({ field, matched: c.matched, sourceUrl: idea.source_url }, "scout-ideas/pending: CLAUDE.md §13 block — options content rejected");
      res.status(422).json({
        accepted: false,
        reason: "options_content_forbidden",
        field,
        matched: c.matched,
        hint: "Trading Forge trades MES/MNQ/MCL micro futures exclusively. Options derivatives are out of scope per CLAUDE.md §13.",
      });
      return;
    }
  }

  const correlationId = getCorrelationId(req);
  const entryArchetype = extractEntryArchetype(idea.entry_rules);
  // Pass 20: use concept-name fingerprint as the primary bucket key.
  // This distinguishes "1-min ORB" from "15-min ORB" (same archetype + exit,
  // but different concept names → different buckets).
  const useConceptFingerprint = true; // always on for Pass 20+ submissions

  // 0. Pass 19 Track E — Source URL verification gate.
  // Every mention must point to a REAL, REACHABLE URL with content that
  // matches the strategy thesis. Stops fabricated URLs from incrementing
  // bucket source counts and falsely graduating strategies.
  //
  // Wave 26 Pass H1 Bug 4: when operator_ingest_sibling_bucket_id is set,
  // the same video_id's URL already passed verification for a sibling mention
  // in this same operator-ingest correlationId. Accept-by-sibling if the
  // failure reason is "unreachable" (intermittent network) — do NOT bypass
  // for content-mismatch failures (those indicate a genuinely wrong URL).
  try {
    const { verifySourceUrl } = await import("../services/source-url-verifier.js");
    const verification = await verifySourceUrl({
      sourceUrl:      idea.source_url,
      market:         idea.market,
      conceptName:    idea.concept_name,
      entryArchetype,
      thesis:         idea.thesis,
    });
    if (!verification.verified) {
      // Check for sibling-accept bypass (same-ingest same-video_id intermittent failure)
      const siblingBucketId = idea.operator_ingest_sibling_bucket_id;
      const isIntermittentFailure = verification.reason === "unreachable";
      if (siblingBucketId && isIntermittentFailure) {
        // Accept-by-sibling: emit audit row and continue
        logger.info(
          { sourceUrl: idea.source_url, reason: verification.reason, siblingBucketId, correlationId },
          "scout-ideas/pending: source URL accepted-by-sibling (same ingest, intermittent failure)",
        );
        db.insert(auditLog).values({
          action:            "pending_bucket.source_url_accepted_by_sibling",
          entityType:        "system_journal",
          input:             { source_url: idea.source_url, source_provider: idea.source_provider, market: idea.market, concept_name: idea.concept_name } as Record<string, unknown>,
          result:            {
            reason: verification.reason,
            sibling_bucket_id: siblingBucketId,
            video_id: (() => {
              const m = idea.source_url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
              return m?.[1] ?? null;
            })(),
          } as Record<string, unknown>,
          status:            "accepted",
          decisionAuthority: "gate",
          correlationId,
        }).catch((err) => logger.warn({ err }, "pending_bucket.source_url_accepted_by_sibling audit write failed"));
        // Fall through to rest of handler (do NOT return here)
      } else {
        logger.warn(
          { sourceUrl: idea.source_url, reason: verification.reason, detail: verification.detail, correlationId },
          "scout-ideas/pending: source URL verification FAILED — rejecting mention",
        );
        db.insert(auditLog).values({
          action:            "pending_bucket.source_url_rejected",
          entityType:        "system_journal",
          input:             { source_url: idea.source_url, source_provider: idea.source_provider, market: idea.market, concept_name: idea.concept_name } as Record<string, unknown>,
          result:            { reason: verification.reason, detail: verification.detail, fetchedBytes: verification.fetchedBytes ?? null } as Record<string, unknown>,
          status:            "rejected",
          decisionAuthority: "gate",
          correlationId,
        }).catch((err) => logger.warn({ err }, "pending_bucket.source_url_rejected audit write failed"));
        res.status(422).json({
          accepted: false,
          reason:   "source_url_verification_failed",
          detail:   verification.reason,
          message:  verification.detail,
          hint:     "Source URL must be reachable (HEAD 2xx), return ≥200 chars of content, and match ≥2 strategy keywords (market, concept, archetype, thesis). Test/fixture URLs are rejected.",
        });
        return;
      }
    }
  } catch (verifyErr) {
    // Fail-CLOSED on verifier crash — better to reject than to admit unverified.
    logger.error({ err: verifyErr, sourceUrl: idea.source_url, correlationId }, "scout-ideas/pending: verifier threw — failing closed");
    res.status(503).json({ accepted: false, reason: "verifier_unavailable", message: "Source URL verifier failed; retry shortly." });
    return;
  }

  // 1. Compute fingerprint.
  // Pass 20: prefer concept-name fingerprint. Falls back to archetype fingerprint
  // if concept_name is missing/empty (defensive — schema requires min(1) but guard here).
  const exitType       = normalizeExitType(idea.exit_rules);
  const fingerprintHash = useConceptFingerprint && idea.concept_name
    ? computeConceptFingerprintHash({ market: idea.market, concept_name: idea.concept_name })
    : computeFingerprintHash({ market: idea.market, entry_archetype: entryArchetype, exit_type: exitType });

  try {
    // 2. Upsert into strategy_pending_buckets
    //    ON CONFLICT: bump last_seen_at. source_count and distinct_providers are
    //    recomputed from mentions after each insert (below) to stay consistent.
    //    We detect new-vs-existing by checking whether first_seen_at == last_seen_at
    //    after the upsert (or by checking if the returned row has sourceCount==0).
    //    The reliable approach: attempt insert, if conflict → update, then check
    //    if the row's first_seen_at equals its last_seen_at at time of returning.
    // Wave 26 Pass H1 Bug 1: when absorbed_sub_concepts is present, embed in
    // layerCoverageJson (the only available JSONB column on pending_buckets).
    // Consumers read bucket.layerCoverageJson.absorbed_sub_concepts for traceability.
    const absorbedSubConcepts = Array.isArray(idea.absorbed_sub_concepts) ? idea.absorbed_sub_concepts : undefined;
    const upserted = await db.insert(strategyPendingBuckets).values({
      fingerprintHash,
      market:        idea.market,
      entryArchetype,
      exitType,
      conceptName:       idea.concept_name || null,
      // Pass 20: initialize layer_coverage_json with the incoming layer set to true.
      // Other layers default to false until they post a mention.
      layerCoverageJson: {
        web: false, youtube: false, reddit: false, [idea.layer ?? "web"]: true,
        ...(absorbedSubConcepts ? { absorbed_sub_concepts: absorbedSubConcepts } : {}),
      },
      sourceCount:       0,
      distinctProviders: 0,
      status:            "pending",
    }).onConflictDoUpdate({
      target: strategyPendingBuckets.fingerprintHash,
      set: {
        lastSeenAt:  sql`NOW()`,
        // Update concept_name if not yet set (first mention wins the name)
        conceptName: sql`COALESCE(strategy_pending_buckets.concept_name, EXCLUDED.concept_name)`,
      },
    }).returning();

    const bucket = upserted[0];
    if (!bucket) {
      res.status(500).json({ error: "Failed to upsert pending bucket" });
      return;
    }

    // Detect if this is a brand-new bucket: sourceCount == 0 means no mentions
    // have ever been added (first upsert sets sourceCount=0, distinct=0).
    // On subsequent upserts the count will be ≥ 1 because we update it below.
    // This is reliable because the upsert ON CONFLICT path does not reset counts.
    const isBucketNew = bucket.sourceCount === 0 && bucket.distinctProviders === 0;
    if (isBucketNew) {
      db.insert(auditLog).values({
        action:            "pending_bucket.created",
        entityType:        "strategy_pending_bucket",
        entityId:          bucket.id,
        input: {
          fingerprint_hash: fingerprintHash,
          market:           idea.market,
          entry_archetype:  entryArchetype,
          exit_type:        exitType,
          source_provider:  idea.source_provider,
          source_url:       idea.source_url,
          concept_name:     idea.concept_name,
        } as unknown as Record<string, unknown>,
        status:            "success",
        decisionAuthority: "agent",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, bucketId: bucket.id }, "pending-bucket: audit_log created write failed");
      });
    }

    // 3. Insert mention (idempotent on bucket_id + source_url)
    // Wave 18 — propagate ALL rich parametric DSL fields (when present) so
    // downstream graduator can use them. Without this, the schema-validated
    // fields would be silently dropped at the storage boundary.
    const extractedIdeaJson: Record<string, unknown> = {
      thesis:           idea.thesis,
      market:           idea.market,
      timeframe:        idea.timeframe,
      entry_rules:      idea.entry_rules,
      exit_rules:       idea.exit_rules,
      risk_rules:       idea.risk_rules,
      source_url:       idea.source_url,
      regime:           idea.regime,
      concept_name:     idea.concept_name,
      source_provider:  idea.source_provider,
      confidence_score: idea.confidence_score,
    };
    // Wave 18 — only add rich fields if Wave 17 caller actually forwarded them.
    // Optional fields are `undefined` in `idea` when caller omits them; we strip
    // those before storage to keep extracted_idea clean.
    const richKeys = [
      "name", "entry_indicator", "entry_archetype", "entry_params", "entry_condition",
      "entry_type", "direction", "exit_type", "exit_params",
      "stop_loss_atr_multiple", "take_profit_atr_multiple",
      "preferred_regime", "session_filter", "extraction_confidence",
      "max_contracts", "base_contracts", "tier_increment",
      // Wave 23F (2026-05-19) — A+ confluence gate fields
      "confluence_factors", "min_factors_satisfied",
      "source_claim_win_rate", "source_claim_avg_r", "symbols",
      // W23F.E — scout rotation seed metadata (post-restart fix 2026-05-19)
      "__scout_seeded_symbol",
      // Wave 26 Pass I (2026-05-26) — v11 deep-extraction fields (synthesized from
      // Gemma prose by gemma-prose-to-v11.ts when model doesn't emit them directly).
      // Persisted to extracted_idea so the graduator's Pass I track 2 stamping path
      // can read them. Without this addition v11 fields are silently dropped here.
      "entry_sequence", "stop_loss", "targets", "filters", "timeframes",
      "indicators_used", "extraction_gap_reason", "_v11_synthesis_source",
      // Wave 26 Pass I v12 — speaker vocabulary preservation
      "speaker_concepts",
    ] as const;
    // These Wave 23F fields can legitimately be null (null = "source didn't state a value").
    // They must pass through even when null so the graduator can distinguish
    // "extractor omitted the field" (undefined → not stored) from "source had no claim" (null → stored).
    const nullAllowedRichKeys = new Set(["source_claim_win_rate", "source_claim_avg_r"]);
    for (const k of richKeys) {
      const v = (idea as Record<string, unknown>)[k];
      if (nullAllowedRichKeys.has(k)) {
        if (v !== undefined) extractedIdeaJson[k] = v;
      } else {
        if (v !== undefined && v !== null) extractedIdeaJson[k] = v;
      }
    }

    const mentionInserted = await db.insert(strategyPendingMentions).values({
      bucketId:                 bucket.id,
      sourceProvider:           idea.source_provider,
      sourceUrl:                idea.source_url,
      extractedIdea:            extractedIdeaJson,
      isCrossValidationResult:  idea.is_cross_validation_result,
      crossValidatorConfidence: idea.cross_validator_confidence !== undefined
        ? String(idea.cross_validator_confidence)
        : null,
      scoutLayer:               idea.layer ?? "web",
    }).onConflictDoNothing()   // idempotent — same URL for same bucket is a no-op
      .returning();

    const mentionWasNew = mentionInserted.length > 0;

    // 4. Recompute source_count + distinct_providers + layer_coverage from the mentions table.
    //    This is authoritative — avoids drift from concurrent inserts.
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
    const sourceCount       = Number((counts as any)?.source_count       ?? 0);
    const distinctProviders = Number((counts as any)?.distinct_providers ?? 0);
    const hasWeb     = Boolean((counts as any)?.has_web);
    const hasYoutube = Boolean((counts as any)?.has_youtube);
    const hasReddit  = Boolean((counts as any)?.has_reddit);
    const layerCoverageJson = { web: hasWeb, youtube: hasYoutube, reddit: hasReddit };
    // All 3 layers confirmed — Pass 20 graduation requirement for concept-fingerprinted buckets
    const allLayersCovered = hasWeb && hasYoutube && hasReddit;

    // Update bucket with fresh counts and layer coverage.
    // Wave 26 Pass H1 Bug 1: merge absorbed_sub_concepts into layerCoverageJson
    // using spread so existing absorbed_sub_concepts are never overwritten on re-post.
    const layerCoverageWithAbsorbed = absorbedSubConcepts
      ? { ...layerCoverageJson, absorbed_sub_concepts: absorbedSubConcepts }
      : layerCoverageJson;
    await db.update(strategyPendingBuckets).set({
      sourceCount,
      distinctProviders,
      layerCoverageJson: layerCoverageWithAbsorbed,
      lastSeenAt: sql`NOW()`,
    }).where(eq(strategyPendingBuckets.id, bucket.id));

    // Audit: mention added (only when new)
    if (mentionWasNew) {
      db.insert(auditLog).values({
        action:            "pending_bucket.mention_added",
        entityType:        "strategy_pending_bucket",
        entityId:          bucket.id,
        input:             {
          source_provider:              idea.source_provider,
          source_url:                   idea.source_url,
          is_cross_validation_result:   idea.is_cross_validation_result,
          source_count_after:           sourceCount,
          distinct_providers_after:     distinctProviders,
        } as unknown as Record<string, unknown>,
        status:            "success",
        decisionAuthority: "agent",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, bucketId: bucket.id }, "pending-bucket: audit_log mention_added write failed");
      });
    }

    // 5. Fire-and-forget CV1 webhook (only for organic scout submissions)
    // Pass 21 (2026-05-12): n8n cv1-validate workflow is RETIRED (CLAUDE.md §2b
    // moved discovery in-process via autonomous-scout-runner.ts). Backend was
    // still firing the webhook → flooded Railway n8n service logs with "unknown
    // webhook" errors. Gated behind explicit TF_ENABLE_CV1_WEBHOOK env (default
    // false). Set to "true" only if the cv1-validate workflow is re-imported.
    const cv1Enabled = String(process.env.TF_ENABLE_CV1_WEBHOOK ?? "").toLowerCase() === "true";
    const n8nBaseUrl = process.env.N8N_BASE_URL;
    const cv1BearerToken = process.env.N8N_CV1_BEARER ?? process.env.N8N_BEARER_TOKEN;
    if (cv1Enabled && !idea.is_cross_validation_result && n8nBaseUrl && cv1BearerToken && mentionWasNew) {
      const mentionId = mentionInserted[0]?.id;
      fetch(`${n8nBaseUrl}/webhook/cv1-validate`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${cv1BearerToken}`,
        },
        body: JSON.stringify({ bucket_id: bucket.id, seed_mention_id: mentionId }),
        signal: AbortSignal.timeout(5_000),
      }).catch((err) => {
        // Fire-and-forget — CV1 failure never blocks the pending insert
        logger.warn({ err, bucketId: bucket.id }, "pending-bucket: CV1 webhook fire failed (non-fatal)");
      });
    }

    // 6. Graduation check — race-safe via UPDATE WHERE status='pending'
    //
    // Pass 20: concept-fingerprinted buckets (concept_name set) require ALL 3
    // scout layers (web + youtube + reddit) to be confirmed in addition to the
    // existing distinct_providers ≥ 3 AND source_count ≥ 3 thresholds.
    //
    // Legacy buckets (concept_name NULL) use the old distinct_providers-only
    // logic to remain backward-compatible with Pass 18/19 data.
    const isConceptBucket = !!bucket.conceptName;
    const layerGatePassed = isConceptBucket ? allLayersCovered : true;

    // Pass 21 — count how many of the 3 layers are confirmed for the fast path.
    const layersCovered = isConceptBucket
      ? Number(layerCoverageJson.web ?? false) + Number(layerCoverageJson.youtube ?? false) + Number(layerCoverageJson.reddit ?? false)
      : 3;  // legacy buckets get full credit
    const goldPath =
      sourceCount >= GRADUATION_SOURCE_COUNT_THRESHOLD &&
      distinctProviders >= GRADUATION_PROVIDERS_THRESHOLD &&
      layerGatePassed;
    const silverPath =
      sourceCount >= FAST_GRADUATION_SOURCE_COUNT_THRESHOLD &&
      distinctProviders >= FAST_GRADUATION_PROVIDERS_THRESHOLD &&
      layersCovered >= FAST_GRADUATION_LAYERS_THRESHOLD;

    let finalStatus = bucket.status;
    if (goldPath || silverPath) {
      // Atomic lock: only the first concurrent writer wins the graduation.
      // status is set to 'graduating' atomically — subsequent concurrent
      // inserts will find status!='pending' and skip.
      const graduated = await db.update(strategyPendingBuckets).set({
        status:       "graduating",
        graduatedAt:  sql`NOW()`,
      }).where(
        and(
          eq(strategyPendingBuckets.id, bucket.id),
          eq(strategyPendingBuckets.status, "pending"),
        )
      ).returning();

      if (graduated.length > 0) {
        // We won the graduation race — proceed
        finalStatus = "graduating";
        logger.info({ bucketId: bucket.id, sourceCount, distinctProviders }, "pending-bucket: starting graduation");

        // Increment graduation counter immediately (bucket is now locked for graduation)
        pendingBucketsGraduatedTotal.inc();

        // Run graduation in background — do not await (keeps /pending fast)
        runGraduation(bucket.id, sourceCount, distinctProviders, correlationId).catch((err) => {
          logger.error({ err, bucketId: bucket.id }, "pending-bucket: graduation failed");
        });
      } else {
        // Another concurrent insert already graduated this bucket
        const [current] = await db.select({ status: strategyPendingBuckets.status })
          .from(strategyPendingBuckets)
          .where(eq(strategyPendingBuckets.id, bucket.id))
          .limit(1);
        finalStatus = current?.status ?? "graduating";
      }
    }

    // SSE: emit pending_bucket.updated after every new mention (counts changed).
    // Placed AFTER graduation check so finalStatus is accurate.
    // Idempotency: skip if mention was a duplicate (counts unchanged).
    if (mentionWasNew) {
      broadcastSSE("pending_bucket.updated", {
        bucket_id:          bucket.id,
        fingerprint_hash:   fingerprintHash,
        source_count:       sourceCount,
        distinct_providers: distinctProviders,
        status:             finalStatus,
        market:             idea.market,
        entry_archetype:    entryArchetype,
        correlation_id:     correlationId,
      });
    }

    res.status(201).json({
      accepted:           true,
      bucket_id:          bucket.id,
      fingerprint_hash:   fingerprintHash,
      entry_archetype:    entryArchetype,
      exit_type:          exitType,
      source_count:       sourceCount,
      distinct_providers: distinctProviders,
      status:             finalStatus,
      mention_was_new:    mentionWasNew,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, fingerprintHash }, "scout-ideas/pending failed");
    res.status(500).json({ error: msg });
  }
});

/**
 * Resolves a system_journal row ID to its compiled strategies.id, if 8A has
 * already drained the journal and created a strategy row. Returns null if the
 * journal hasn't been compiled yet — callers should re-attempt via backfill.
 */
async function resolveStrategyIdFromJournalId(journalId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ strategyId: systemJournal.strategyId })
      .from(systemJournal)
      .where(eq(systemJournal.id, journalId))
      .limit(1);
    return row?.strategyId ?? null;
  } catch (err) {
    logger.warn({ err, journalId }, "resolveStrategyIdFromJournalId: query failed");
    return null;
  }
}

/**
 * Backfill `strategy_pending_buckets.graduated_strategy_id` for buckets that
 * have graduated but whose journal entry has only just been compiled by 8A
 * synthesizer. Idempotent and safe to call repeatedly.
 *
 * Strategy: find all buckets with status='graduated' AND graduated_strategy_id
 * IS NULL, look up the most recent matching `pending_bucket.graduated` audit
 * row (which carries graduated_journal_id), resolve the journal's strategy_id,
 * and patch the bucket. Returns the count of buckets backfilled.
 *
 * Called: (a) lazily inside the GET /pending-buckets list endpoint (bounded
 * cost — at most N buckets per call), (b) once per graduation as a delayed
 * retry inside runGraduation.
 */
async function backfillGraduatedStrategyIds(maxBuckets = 50): Promise<number> {
  try {
    // Find graduated buckets with no strategy_id yet
    const candidates = await db
      .select({ id: strategyPendingBuckets.id })
      .from(strategyPendingBuckets)
      .where(
        and(
          eq(strategyPendingBuckets.status, "graduated"),
          sql`${strategyPendingBuckets.graduatedStrategyId} IS NULL`,
        ),
      )
      .limit(maxBuckets);

    if (candidates.length === 0) return 0;

    let patched = 0;
    for (const bucket of candidates) {
      // Find the graduation audit row carrying this bucket's journal_id
      const [audit] = await db
        .select({ result: auditLog.result })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "pending_bucket.graduated"),
            eq(auditLog.entityId, bucket.id),
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(1);

      let journalId: string | null = (audit?.result as any)?.graduated_journal_id ?? null;

      // Fallback for buckets graduated before the journal_id stash existed: try
      // to match a system_journal row created near the graduation time whose
      // strategy_params.url is one of the bucket's mention source_urls.
      if (!journalId || typeof journalId !== "string") {
        const [bucketRow] = await db
          .select({ graduatedAt: strategyPendingBuckets.graduatedAt })
          .from(strategyPendingBuckets)
          .where(eq(strategyPendingBuckets.id, bucket.id))
          .limit(1);

        const mentionUrls = await db
          .select({ sourceUrl: strategyPendingMentions.sourceUrl })
          .from(strategyPendingMentions)
          .where(eq(strategyPendingMentions.bucketId, bucket.id));

        if (!bucketRow?.graduatedAt || mentionUrls.length === 0) continue;

        const gradAt = bucketRow.graduatedAt instanceof Date
          ? bucketRow.graduatedAt : new Date(bucketRow.graduatedAt as unknown as string);
        const windowStart = new Date(gradAt.getTime() - 5 * 60_000);
        const windowEnd = new Date(gradAt.getTime() + 60 * 60_000);

        const candidates = await db.execute(sql`
          SELECT id, strategy_id, strategy_params
          FROM system_journal
          WHERE created_at BETWEEN ${windowStart.toISOString()} AND ${windowEnd.toISOString()}
            AND source = 'openclaw'
          ORDER BY created_at ASC
          LIMIT 20
        `);
        const candidateRows: Array<{ id: string; strategy_id: string | null; strategy_params: any }> =
          Array.isArray(candidates) ? candidates as any : ((candidates as any)?.rows ?? []);
        const urlSet = new Set(mentionUrls.map((m) => m.sourceUrl));
        const match = candidateRows.find((c) => {
          const url = c.strategy_params?.url;
          return typeof url === "string" && urlSet.has(url);
        });
        if (!match) continue;
        journalId = match.id;
      }

      const strategyId = await resolveStrategyIdFromJournalId(journalId);
      if (!strategyId) continue;

      await db
        .update(strategyPendingBuckets)
        .set({ graduatedStrategyId: strategyId })
        .where(eq(strategyPendingBuckets.id, bucket.id));
      patched++;
    }
    if (patched > 0) {
      logger.info({ patched, candidates: candidates.length }, "backfillGraduatedStrategyIds: patched buckets");
    }
    return patched;
  } catch (err) {
    logger.warn({ err }, "backfillGraduatedStrategyIds: failed (non-fatal)");
    return 0;
  }
}

/**
 * Graduation flow — runs after the bucket is atomically set to 'graduating'.
 * Picks the best consensus mention, POSTs to /scout-ideas/strict, and updates
 * bucket status to 'graduated' (or rolls back to 'pending' on failure so the
 * next mention can retry).
 *
 * Emits SSE pending_bucket.graduated and Discord alert on success.
 */
async function runGraduation(
  bucketId: string,
  sourceCount: number,
  distinctProviders: number,
  correlationId?: string,
  /** Wave 26 Pass D — true for /pending-buckets/:id/graduate operator endpoint
   *  (manual force-graduate). Bypasses GRADUATION_DAILY_CAP guardrail (which
   *  exists to stop autonomous scout floods, not operator manual batches). */
  bypassDailyCap: boolean = false,
): Promise<void> {
  try {
    // Read all mentions for this bucket (with scout_layer for tag evidence)
    const mentions = await db.select().from(strategyPendingMentions)
      .where(eq(strategyPendingMentions.bucketId, bucketId));

    if (mentions.length === 0) {
      logger.warn({ bucketId }, "graduation: no mentions found — rolling back to pending");
      // 2026-05-26 fix: also null graduatedAt so the bucket isn't poisoned for future retries.
      await db.update(strategyPendingBuckets).set({ status: "pending", graduatedAt: null })
        .where(eq(strategyPendingBuckets.id, bucketId));
      return;
    }

    // Wave 13B (2026-05-18) — DSL richness scoring. Prior logic ranked by
    // confidence_score alone, which let web-layer CV-only mentions (entry_long
    // = "Web-layer cross-validation: ..." with no params) win over real Reddit
    // or YouTube DSL extractions. Result: graduator assembled strategies from
    // citation text instead of actual entry rules, and LLM judge correctly
    // rejected them.
    //
    // New scoring (higher = richer DSL):
    //   +10  entry_params is a non-empty object (numeric params present)
    //   + 5  entry_long / entry_rules contains a structural keyword
    //        (cross/close/break/above/below/when/sweep/MSS/FVG/etc)
    //   + 3  entry_long / entry_rules is ≥80 chars (real prose, not citation)
    //   + 2  provider rank: youtube_transcript_npm > reddit_json > brave > web_data_api
    //   + 1  base for CV-result mentions (still slight preference)
    //   * cross_validator_confidence as a tie-breaker multiplier on top
    //
    // Picks the mention with the highest score — guaranteed to be the richest
    // DSL the bucket has accumulated, NOT the first-extracted or highest-confidence
    // CV citation.
    const STRUCTURAL_KEYWORDS_RE = /\b(close|cross|break|above|below|enter|trigger|when|rsi\s*[<>]|sweep|displacement|mss|(^|\W)fvg(\W|$)|retrace|(^|\W)ote(\W|$)|breaker|choch|(^|\W)bos(\W|$)|killzone|manipulation|order.block|fair.value.gap|liquidity|raid|accumulation|distribution|spring|upthrust|imbalance|absorption)\b/i;
    const PROVIDER_RANK: Record<string, number> = {
      youtube_transcript_npm: 4,
      reddit_json: 3,
      brave_search: 2,
      youtube_data_api: 1,  // CV-only fallback — least rich
      exa: 3, parallel_web_discovery: 2, exa_web_discovery: 2,
    };
    function scoreMentionRichness(m: typeof mentions[0]): number {
      const idea = (m.extractedIdea as any) ?? {};
      const entryParams = idea?.entry_params;
      const entryLong = String(idea?.entry_long ?? idea?.entry_rules ?? idea?.entry_condition ?? "");
      const entryRules = String(idea?.entry_rules ?? "");
      const combinedProse = `${entryLong} ${entryRules}`.trim();
      let score = 0;
      if (entryParams && typeof entryParams === "object" && Object.keys(entryParams).length > 0) score += 10;
      if (STRUCTURAL_KEYWORDS_RE.test(combinedProse)) score += 5;
      if (combinedProse.length >= 80) score += 3;
      score += PROVIDER_RANK[m.sourceProvider ?? ""] ?? 0;
      if (m.isCrossValidationResult) score += 1;
      const tieBreak = m.crossValidatorConfidence !== null ? Number(m.crossValidatorConfidence) : 0;
      return score + tieBreak * 0.5;  // small tie-break weight
    }
    let best = mentions[0];
    let bestScore = scoreMentionRichness(best);
    for (const m of mentions) {
      const s = scoreMentionRichness(m);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    logger.info({
      bucketId, bestSource: best.sourceProvider, bestScore,
      candidates: mentions.length,
    }, "graduator: best-mention selected by Wave 13B richness scoring");

    const ideaPayload = best.extractedIdea as Record<string, unknown>;

    // Pass 21 (2026-05-12) — DIRECT graduation. We no longer write scout
    // candidates to system_journal (that table belongs to the bot's actual
    // trade-journal, read by the 3am GPT-5 self-critique agent). The legacy
    // /scout-ideas/strict → drain chain also broke for silver-path graduations
    // because the journal lacked DSL fields. Now we construct the production
    // strategy in-process using framework-overlay and insert directly.
    const { graduateBucketDirectly, deriveEntryType } = await import("../services/direct-bucket-graduator.js");

    // Read bucket metadata now (needed by graduator + downstream audit)
    const [bucketMetaEarly] = await db.select({
      market:         strategyPendingBuckets.market,
      entryArchetype: strategyPendingBuckets.entryArchetype,
      exitType:       strategyPendingBuckets.exitType,
      conceptName:    strategyPendingBuckets.conceptName,
      layerCoverageJson: strategyPendingBuckets.layerCoverageJson,
    }).from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.id, bucketId))
      .limit(1);

    // Layer URL split for audit + graduator tags
    const _webUrls     = mentions.filter((m) => (m as any).scoutLayer === "web").map((m) => m.sourceUrl);
    const _youtubeUrls = mentions.filter((m) => (m as any).scoutLayer === "youtube").map((m) => m.sourceUrl);
    const _redditUrls  = mentions.filter((m) => (m as any).scoutLayer === "reddit").map((m) => m.sourceUrl);
    const _layerTags: string[] = ["cross-validated"];
    if (_webUrls.length > 0)     _layerTags.push("web-confirmed");
    if (_youtubeUrls.length > 0) _layerTags.push("youtube-confirmed");
    if (_redditUrls.length > 0)  _layerTags.push("reddit-confirmed");
    const _lcj = (bucketMetaEarly?.layerCoverageJson as any) ?? {};
    const _layersCovered = Number(_lcj.web ?? false) + Number(_lcj.youtube ?? false) + Number(_lcj.reddit ?? false);

    const grad = await graduateBucketDirectly({
      bucketId,
      bestMention: {
        sourceUrl: best.sourceUrl,
        sourceProvider: best.sourceProvider,
        scoutLayer: (best as any).scoutLayer ?? null,
        extractedIdea: ideaPayload,
      },
      bucketMeta: {
        conceptName: bucketMetaEarly?.conceptName ?? "unknown_concept",
        market: (bucketMetaEarly?.market as any) ?? "MES",
        entryArchetype: bucketMetaEarly?.entryArchetype ?? null,
        exitType: bucketMetaEarly?.exitType ?? null,
      },
      sourceCount,
      distinctProviders,
      layersCovered: _layersCovered,
      layerTags: _layerTags,
      webUrls: _webUrls,
      youtubeUrls: _youtubeUrls,
      redditUrls: _redditUrls,
      correlationId: correlationId ?? null,
      bypassDailyCap,
    });

    // For backward-compat with the rest of the handler (audit + Discord notify)
    const graduatedStrategyId: string | null = grad.strategyId;
    const graduatedJournalId: string | undefined = undefined;  // no longer used — system_journal is no longer polluted

    // Audit log
    const sourceUrls = mentions.map((m) => m.sourceUrl);

    // Read bucket metadata needed for SSE + Discord
    const [bucketMeta] = await db.select({
      market:         strategyPendingBuckets.market,
      entryArchetype: strategyPendingBuckets.entryArchetype,
      exitType:       strategyPendingBuckets.exitType,
    }).from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.id, bucketId))
      .limit(1);

    const conceptName = typeof (ideaPayload as any)?.concept_name === "string"
      ? (ideaPayload as any).concept_name : undefined;

    // Pass 20: compute per-layer source URLs for audit evidence.
    const webUrls     = mentions.filter((m) => (m as any).scoutLayer === "web").map((m) => m.sourceUrl);
    const youtubeUrls = mentions.filter((m) => (m as any).scoutLayer === "youtube").map((m) => m.sourceUrl);
    const redditUrls  = mentions.filter((m) => (m as any).scoutLayer === "reddit").map((m) => m.sourceUrl);
    // Tags for the graduated strategy row (one per confirmed layer)
    const layerTags: string[] = ["cross-validated"];
    if (webUrls.length > 0)     layerTags.push("web-confirmed");
    if (youtubeUrls.length > 0) layerTags.push("youtube-confirmed");
    if (redditUrls.length > 0)  layerTags.push("reddit-confirmed");

    // ─── Wave 12: Gate-aware bucket transition + audit (FAIL-CLOSED) ──────────
    // The previous code unconditionally set bucket.status='graduated' and fired
    // audit status='success' regardless of whether the strategy INSERT succeeded.
    // This produced 6 leaked buckets with graduated_strategy_id=NULL per 24h cycle.
    //
    // Correct ordering:
    //   graduateBucketDirectly() returns strategyId=non-null  → INSERT succeeded
    //   graduateBucketDirectly() returns insertFailed=true    → DB INSERT failed (infra)
    //   graduateBucketDirectly() returns skipped=true (only)  → gate rejection (no INSERT attempted)
    //
    // For INSERT failure and gate rejection: revert bucket to pending so the next
    // cron cycle can retry. Do NOT mark `graduated` with a null strategy id.
    if (graduatedStrategyId !== null) {
      // ─── SUCCESS PATH ───────────────────────────────────────────────────────
      // INSERT confirmed — only now mark the bucket graduated.
      await db.update(strategyPendingBuckets).set({
        status:               "graduated",
        graduatedAt:          sql`NOW()`,
        graduatedStrategyId:  graduatedStrategyId,
      }).where(eq(strategyPendingBuckets.id, bucketId));

      // Store the journal_id in `result` so the backfill query can resolve
      // strategy_id later. The backfill scans audit rows where
      // action='strategy.cross_validated' AND result->>'journal_id' IS NOT NULL
      // AND the matching bucket still has graduated_strategy_id=NULL.
      db.insert(auditLog).values({
        action:            "strategy.cross_validated",
        entityType:        "strategy_pending_bucket",
        entityId:          bucketId,
        input:             {
          bucket_id:             bucketId,
          distinct_providers:    distinctProviders,
          source_count:          sourceCount,
          source_urls:           sourceUrls,
          graduated_strategy_id: graduatedStrategyId,
          graduated_journal_id:  graduatedJournalId ?? null,
          concept_name:          conceptName,
          market:                bucketMeta?.market,
          entry_archetype:       bucketMeta?.entryArchetype,
          web_source_urls:       webUrls,
          youtube_source_urls:   youtubeUrls,
          reddit_source_urls:    redditUrls,
          layer_tags:            layerTags,
        } as unknown as Record<string, unknown>,
        result:            {
          graduated_journal_id:  graduatedJournalId ?? null,
          graduated_strategy_id: graduatedStrategyId,
          layer_tags:            layerTags,
          web_source_urls:       webUrls,
          youtube_source_urls:   youtubeUrls,
          reddit_source_urls:    redditUrls,
        } as unknown as Record<string, unknown>,
        status:            "success",
        decisionAuthority: "agent",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, bucketId }, "graduation: audit_log write failed");
      });
    } else if (grad.insertFailed) {
      // ─── INSERT FAILURE PATH (infrastructure error / constraint collision) ──
      // The graduator already wrote the DLQ row + graduation.rejected_insert_failed
      // audit. Here we: revert bucket to pending, fire the cross_validated audit
      // with status=failure so the operator can query the exact 24h failure rate.
      logger.error(
        { bucketId, conceptName, reason: grad.reason },
        "graduation: INSERT failed — reverting bucket to pending for retry"
      );
      // 2026-05-26 fix: null graduatedAt too — leaving it set poisons the bucket
      // for future drain cycles (drain skips when graduatedAt != null).
      await db.update(strategyPendingBuckets).set({
        status: "pending",
        graduatedAt: null,
      }).where(eq(strategyPendingBuckets.id, bucketId));

      db.insert(auditLog).values({
        action:            "strategy.cross_validated",
        entityType:        "strategy_pending_bucket",
        entityId:          bucketId,
        input:             {
          bucket_id:             bucketId,
          distinct_providers:    distinctProviders,
          source_count:          sourceCount,
          source_urls:           sourceUrls,
          graduated_strategy_id: null,
          concept_name:          conceptName,
          market:                bucketMeta?.market,
          entry_archetype:       bucketMeta?.entryArchetype,
          web_source_urls:       webUrls,
          youtube_source_urls:   youtubeUrls,
          reddit_source_urls:    redditUrls,
          layer_tags:            layerTags,
        } as unknown as Record<string, unknown>,
        result:            {
          graduated_strategy_id: null,
          error:                 grad.reason,
          layer_tags:            layerTags,
          web_source_urls:       webUrls,
          youtube_source_urls:   youtubeUrls,
          reddit_source_urls:    redditUrls,
        } as unknown as Record<string, unknown>,
        status:            "failure",
        decisionAuthority: "system",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, bucketId }, "graduation: failure audit_log write failed");
      });

      // Return early — do not fire SSE graduation event or Discord notify for a failed INSERT
      return;
    } else {
      // ─── GATE REJECTION PATH (thin_dsl, no_engine_indicator, etc.) ─────────
      // The graduator already wrote a graduation.rejected_* audit row. The bucket
      // was previously transitioned to `graduating` by the cron. Revert it so it
      // can be re-attempted if the concept name or DSL extraction improves.
      // NOTE: if the concept is structurally un-graduatable (no engine spec, bad
      // DSL) the cron will keep attempting until the bucket expires or is killed.
      // That is intentional — future engine additions may unblock these.
      logger.warn(
        { bucketId, conceptName, reason: grad.reason },
        "graduation: gate rejected — reverting bucket to pending"
      );
      // 2026-05-26 fix: clear graduatedAt so the bucket isn't poisoned for future
      // retries (when the engine gains support for previously-rejected concepts).
      await db.update(strategyPendingBuckets).set({
        status: "pending",
        graduatedAt: null,
      }).where(eq(strategyPendingBuckets.id, bucketId));

      db.insert(auditLog).values({
        action:            "strategy.cross_validated",
        entityType:        "strategy_pending_bucket",
        entityId:          bucketId,
        input:             {
          bucket_id:          bucketId,
          distinct_providers: distinctProviders,
          source_count:       sourceCount,
          source_urls:        sourceUrls,
          concept_name:       conceptName,
          market:             bucketMeta?.market,
          entry_archetype:    bucketMeta?.entryArchetype,
          layer_tags:         layerTags,
        } as unknown as Record<string, unknown>,
        result:            {
          graduated_strategy_id: null,
          rejection_reason:      grad.reason,
          layer_tags:            layerTags,
        } as unknown as Record<string, unknown>,
        status:            "rejected",
        decisionAuthority: "system",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, bucketId }, "graduation: rejected audit_log write failed");
      });

      // Return early — do not fire SSE graduation event or Discord notify for a rejected bucket
      return;
    }

    // Legacy audit row for backward-compat with backfill query that scans
    // 'pending_bucket.graduated' rows.
    db.insert(auditLog).values({
      action:            "pending_bucket.graduated",
      entityType:        "strategy_pending_bucket",
      entityId:          bucketId,
      input:             { bucket_id: bucketId, concept_name: conceptName } as unknown as Record<string, unknown>,
      result:            {
        graduated_journal_id:  graduatedJournalId ?? null,
        graduated_strategy_id: graduatedStrategyId,
      } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "agent",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, bucketId }, "graduation: legacy audit_log write failed");
    });

    // SSE: pending_bucket.graduated — frontend subscribes to this event
    broadcastSSE("pending_bucket.graduated", {
      bucket_id:             bucketId,
      market:                bucketMeta?.market ?? null,
      entry_archetype:       bucketMeta?.entryArchetype ?? null,
      source_urls:           sourceUrls,
      graduated_strategy_id: graduatedStrategyId ?? null,
      source_count:          sourceCount,
      distinct_providers:    distinctProviders,
      concept_name:          conceptName ?? null,
      correlation_id:        correlationId ?? null,
    });

    // Discord: single INFO message to #strategy-finds channel on graduation.
    // Uses DISCORD_WEBHOOK_URL (default channel) — dedup is handled by
    // notification-service title-based cooldown (10-min window). Because each
    // bucket has a unique ID in the title, dedup will never suppress distinct
    // graduations. Fire-and-forget.
    const frontendBaseUrl = process.env.FRONTEND_BASE_URL ?? "";
    const bucketLink = frontendBaseUrl
      ? `${frontendBaseUrl}/pending-buckets/${bucketId}`
      : `bucket:${bucketId}`;
    const sourceList = sourceUrls
      .slice(0, 5)
      .map((u, i) => `${i + 1}. ${u}`)
      .join("\n");
    // Resolve a human-meaningful archetype label for Discord. When the
    // bucket-level entryArchetype is missing or 'unknown' (LLM scout-extract
    // couldn't classify), fall back to the same regex-derived entry_type the
    // graduator uses for the DSL — so Discord shows what the strategy actually
    // does instead of "unknown".
    const displayArchetype =
      (bucketMeta?.entryArchetype && bucketMeta.entryArchetype !== "unknown")
        ? bucketMeta.entryArchetype
        : deriveEntryType(conceptName ?? "", bucketMeta?.entryArchetype ?? null);
    notifyInfo(
      `New strategy graduated: ${conceptName ?? displayArchetype} (${bucketMeta?.market ?? "?"})`,
      [
        `Market: **${bucketMeta?.market ?? "?"}** | Archetype: **${displayArchetype}**`,
        `Confirmed by **${distinctProviders}** independent sources (${sourceCount} total mentions)`,
        `Sources:\n${sourceList}`,
        graduatedStrategyId ? `Strategy ID: \`${graduatedStrategyId}\`` : "",
        bucketLink ? `[View bucket](${bucketLink})` : `Bucket ID: \`${bucketId}\``,
      ].filter(Boolean).join("\n"),
      {
        bucket_id:    bucketId,
        strategy_id:  graduatedStrategyId ?? null,
        market:       bucketMeta?.market ?? null,
        source_count: sourceCount,
      },
    );

    logger.info({ bucketId, graduatedStrategyId, sourceCount, distinctProviders, correlationId }, "pending-bucket: graduated successfully");

    // Delayed backfill retry: if graduated_strategy_id is still null (journal
    // hasn't been compiled by 8A yet), schedule retries at 60s/5m/30m. This
    // covers the common case where 8A drains within minutes of graduation.
    // Each retry is bounded (one bucket); cron-based bulk backfill handles
    // anything that slips past.
    if (!graduatedStrategyId && graduatedJournalId) {
      const retryAfterMs = [60_000, 5 * 60_000, 30 * 60_000];
      for (const delay of retryAfterMs) {
        setTimeout(async () => {
          try {
            const sid = await resolveStrategyIdFromJournalId(graduatedJournalId);
            if (!sid) return;
            // Only patch if still null (avoid clobbering a manual / earlier patch)
            await db.update(strategyPendingBuckets)
              .set({ graduatedStrategyId: sid })
              .where(
                and(
                  eq(strategyPendingBuckets.id, bucketId),
                  sql`${strategyPendingBuckets.graduatedStrategyId} IS NULL`,
                ),
              );
            logger.info({ bucketId, strategyId: sid, delayMs: delay }, "pending-bucket: graduated_strategy_id backfilled");
          } catch (err) {
            logger.warn({ err, bucketId, delayMs: delay }, "pending-bucket: backfill retry failed (non-fatal)");
          }
        }, delay).unref();
      }
    }
  } catch (err) {
    // Rollback to pending so the next mention can retry graduation
    logger.error({ err, bucketId }, "graduation: failed — rolling bucket back to pending");
    // 2026-05-26 fix: null graduatedAt too — leaving it set poisons future retries.
    await db.update(strategyPendingBuckets).set({ status: "pending", graduatedAt: null })
      .where(eq(strategyPendingBuckets.id, bucketId))
      .catch((rollbackErr) => {
        logger.error({ err: rollbackErr, bucketId }, "graduation: rollback itself failed");
      });
    throw err; // re-throw so the caller can log the root error
  }
}

// ─── GET /api/agent/pending-buckets ──────────────────────────────────────
// Pass 18 — Frontend PendingValidationTab list endpoint. Returns buckets
// filtered by status (default 'pending'), most recent first, with the set
// of distinct providers surfaced for chip rendering.

const pendingBucketStatusEnum = z.enum([
  "pending", "graduating", "graduated", "expired", "killed",
]);

agentRoutes.get("/pending-buckets", async (req, res) => {
  const statusParam = String(req.query.status ?? "pending");
  const parsedStatus = pendingBucketStatusEnum.safeParse(statusParam);
  if (!parsedStatus.success) {
    res.status(400).json({ error: "Invalid status filter", allowed: pendingBucketStatusEnum.options });
    return;
  }
  const status = parsedStatus.data;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  try {
    // Lazy backfill — bounded — so this list endpoint also drives
    // graduated_strategy_id reconciliation as a side effect when the operator
    // visits the tab. Fire-and-forget; failures non-fatal.
    backfillGraduatedStrategyIds(25).catch(() => undefined);

    // Refresh the Prometheus gauge from authoritative DB counts (bounded query,
    // cheap — runs whenever the operator pulls the list). Fire-and-forget.
    db.execute(sql`
      SELECT status, COUNT(*)::int AS n
      FROM strategy_pending_buckets
      GROUP BY status
    `).then((res: any) => {
      const rowsAll: Array<{ status: string; n: number }> =
        Array.isArray(res) ? res : (res?.rows ?? []);
      for (const s of ["pending", "graduating", "graduated", "expired", "killed"]) {
        const found = rowsAll.find((r) => r.status === s);
        pendingBucketsTotal.set({ status: s }, found?.n ?? 0);
      }
    }).catch(() => undefined);

    // Pass 21 (2026-05-12) — surface conceptName + layerCoverageJson on the
    // list payload so the new Scout page can render layer chips + humanized
    // concept titles without an extra fetch per bucket.
    const rows = await db
      .select({
        id:                  strategyPendingBuckets.id,
        fingerprintHash:     strategyPendingBuckets.fingerprintHash,
        market:              strategyPendingBuckets.market,
        entryArchetype:      strategyPendingBuckets.entryArchetype,
        exitType:            strategyPendingBuckets.exitType,
        sourceCount:         strategyPendingBuckets.sourceCount,
        distinctProviders:   strategyPendingBuckets.distinctProviders,
        status:              strategyPendingBuckets.status,
        firstSeenAt:         strategyPendingBuckets.firstSeenAt,
        lastSeenAt:          strategyPendingBuckets.lastSeenAt,
        graduatedAt:         strategyPendingBuckets.graduatedAt,
        graduatedStrategyId: strategyPendingBuckets.graduatedStrategyId,
        conceptName:         strategyPendingBuckets.conceptName,
        layerCoverageJson:   strategyPendingBuckets.layerCoverageJson,
      })
      .from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.status, status))
      .orderBy(desc(strategyPendingBuckets.lastSeenAt))
      .limit(limit);

    if (rows.length === 0) {
      res.json({ data: [], total: 0 });
      return;
    }

    const bucketIds = rows.map((r) => r.id);
    const providerRows = await db
      .selectDistinct({
        bucketId:       strategyPendingMentions.bucketId,
        sourceProvider: strategyPendingMentions.sourceProvider,
      })
      .from(strategyPendingMentions)
      .where(inArray(strategyPendingMentions.bucketId, bucketIds));

    const providersByBucket = new Map<string, string[]>();
    for (const p of providerRows) {
      const arr = providersByBucket.get(p.bucketId) ?? [];
      arr.push(p.sourceProvider);
      providersByBucket.set(p.bucketId, arr);
    }

    const data = rows.map((r) => ({
      id:                  r.id,
      fingerprintHash:     r.fingerprintHash,
      market:              r.market,
      entryArchetype:      r.entryArchetype,
      exitType:            r.exitType,
      sourceCount:         r.sourceCount,
      distinctProviders:   r.distinctProviders,
      status:              r.status,
      firstSeenAt:         r.firstSeenAt instanceof Date ? r.firstSeenAt.toISOString() : r.firstSeenAt,
      lastSeenAt:          r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : r.lastSeenAt,
      graduatedAt:         r.graduatedAt instanceof Date ? r.graduatedAt.toISOString() : (r.graduatedAt ?? null),
      graduatedStrategyId: r.graduatedStrategyId ?? null,
      providers:           providersByBucket.get(r.id) ?? [],
      // Pass 21 — Pass 20 concept-fingerprint fields surfaced on the list endpoint
      conceptName:         r.conceptName ?? null,
      layerCoverageJson:   r.layerCoverageJson ?? null,
    }));

    res.json({ data, total: data.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, status }, "GET /pending-buckets failed");
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agent/pending-buckets/:id/mentions ─────────────────────────
// Pass 18 — Returns all mentions for a bucket so the frontend can render the
// provider chips, source URLs, and CV confidence per row.

agentRoutes.get("/pending-buckets/:id/mentions", async (req, res) => {
  const bucketId = String(req.params.id);
  try {
    const rows = await db
      .select({
        id:                       strategyPendingMentions.id,
        bucketId:                 strategyPendingMentions.bucketId,
        sourceProvider:           strategyPendingMentions.sourceProvider,
        sourceUrl:                strategyPendingMentions.sourceUrl,
        crossValidatorConfidence: strategyPendingMentions.crossValidatorConfidence,
        isCrossValidationResult:  strategyPendingMentions.isCrossValidationResult,
        createdAt:                strategyPendingMentions.createdAt,
      })
      .from(strategyPendingMentions)
      .where(eq(strategyPendingMentions.bucketId, bucketId))
      .orderBy(desc(strategyPendingMentions.createdAt));

    const data = rows.map((r) => ({
      id:                       r.id,
      bucketId:                 r.bucketId,
      sourceProvider:           r.sourceProvider,
      sourceUrl:                r.sourceUrl,
      crossValidatorConfidence: r.crossValidatorConfidence !== null ? Number(r.crossValidatorConfidence) : null,
      isCrossValidationResult:  r.isCrossValidationResult,
      createdAt:                r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    }));

    res.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, bucketId }, "GET /pending-buckets/:id/mentions failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/pending-buckets/:id/graduate ────────────────────────
// Pass 18 — Operator force-graduate. Skips the 3-source threshold and runs
// the same graduation flow used by automatic graduation.

agentRoutes.post("/pending-buckets/:id/graduate", idempotencyMiddleware, async (req, res) => {
  const bucketId = String(req.params.id);
  const correlationId = getCorrelationId(req);

  try {
    const [bucket] = await db.select()
      .from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.id, bucketId))
      .limit(1);

    if (!bucket) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }

    if (bucket.status !== "pending") {
      res.status(409).json({
        error:  `Bucket not in pending state (status=${bucket.status})`,
        status: bucket.status,
      });
      return;
    }

    const locked = await db.update(strategyPendingBuckets).set({
      status:      "graduating",
      graduatedAt: sql`NOW()`,
    }).where(
      and(
        eq(strategyPendingBuckets.id, bucketId),
        eq(strategyPendingBuckets.status, "pending"),
      ),
    ).returning();

    if (locked.length === 0) {
      const [current] = await db.select({ status: strategyPendingBuckets.status })
        .from(strategyPendingBuckets)
        .where(eq(strategyPendingBuckets.id, bucketId))
        .limit(1);
      res.status(409).json({
        error:  "Bucket already graduating (race lost)",
        status: current?.status ?? "graduating",
      });
      return;
    }

    pendingBucketsGraduatedTotal.inc();

    db.insert(auditLog).values({
      action:            "pending_bucket.graduated_by_operator",
      entityType:        "strategy_pending_bucket",
      entityId:          bucketId,
      input: {
        bucket_id:          bucketId,
        source_count:       bucket.sourceCount,
        distinct_providers: bucket.distinctProviders,
        operator_forced:    true,
      } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "human",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, bucketId }, "pending_bucket.graduated_by_operator audit write failed");
    });

    broadcastSSE("pending_bucket.updated", {
      bucket_id:          bucketId,
      fingerprint_hash:   bucket.fingerprintHash,
      source_count:       bucket.sourceCount,
      distinct_providers: bucket.distinctProviders,
      status:             "graduating",
      market:             bucket.market,
      entry_archetype:    bucket.entryArchetype,
      correlation_id:     correlationId,
    });

    runGraduation(bucketId, bucket.sourceCount, bucket.distinctProviders, correlationId, true).catch((err) => {
      logger.error({ err, bucketId }, "operator force-graduate: graduation failed");
    });

    res.status(202).json({ ok: true, status: "graduating", strategyId: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, bucketId }, "POST /pending-buckets/:id/graduate failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/pending-buckets/:id/kill ────────────────────────────
// Pass 18 — Operator kill. Sets status='killed' so the row is excluded from
// future graduation and disappears from the operator's pending list.

agentRoutes.post("/pending-buckets/:id/kill", idempotencyMiddleware, async (req, res) => {
  const bucketId = String(req.params.id);
  const correlationId = getCorrelationId(req);

  try {
    const [bucket] = await db.select()
      .from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.id, bucketId))
      .limit(1);

    if (!bucket) {
      res.status(404).json({ error: "Bucket not found" });
      return;
    }

    if (bucket.status === "killed") {
      res.json({ ok: true, status: "killed", strategyId: null });
      return;
    }

    if (bucket.status === "graduated") {
      res.status(409).json({
        error:  "Cannot kill a graduated bucket — strategy already in pipeline",
        status: bucket.status,
      });
      return;
    }

    await db.update(strategyPendingBuckets)
      .set({ status: "killed" })
      .where(eq(strategyPendingBuckets.id, bucketId));

    db.insert(auditLog).values({
      action:            "pending_bucket.killed",
      entityType:        "strategy_pending_bucket",
      entityId:          bucketId,
      input: {
        bucket_id:          bucketId,
        previous_status:    bucket.status,
        source_count:       bucket.sourceCount,
        distinct_providers: bucket.distinctProviders,
      } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "human",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, bucketId }, "pending_bucket.killed audit write failed");
    });

    broadcastSSE("pending_bucket.updated", {
      bucket_id:          bucketId,
      fingerprint_hash:   bucket.fingerprintHash,
      source_count:       bucket.sourceCount,
      distinct_providers: bucket.distinctProviders,
      status:             "killed",
      market:             bucket.market,
      entry_archetype:    bucket.entryArchetype,
      correlation_id:     correlationId,
    });

    res.json({ ok: true, status: "killed", strategyId: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, bucketId }, "POST /pending-buckets/:id/kill failed");
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agent/pending-mention/:id ──────────────────────────────────
// Pass 18 — CV1 workflow fetches the seed mention to build search terms.
// Returns the full extracted_idea + bucket metadata for the mention.

agentRoutes.get("/pending-mention/:id", async (req, res) => {
  try {
    const [mention] = await db.select({
      id:                      strategyPendingMentions.id,
      bucketId:                strategyPendingMentions.bucketId,
      sourceProvider:          strategyPendingMentions.sourceProvider,
      sourceUrl:               strategyPendingMentions.sourceUrl,
      extractedIdea:           strategyPendingMentions.extractedIdea,
      isCrossValidationResult: strategyPendingMentions.isCrossValidationResult,
      createdAt:               strategyPendingMentions.createdAt,
    }).from(strategyPendingMentions)
      .where(eq(strategyPendingMentions.id, req.params.id))
      .limit(1);

    if (!mention) {
      res.status(404).json({ error: "Mention not found" });
      return;
    }

    // Include bucket metadata
    const [bucket] = await db.select({
      id:                strategyPendingBuckets.id,
      fingerprintHash:   strategyPendingBuckets.fingerprintHash,
      market:            strategyPendingBuckets.market,
      entryArchetype:    strategyPendingBuckets.entryArchetype,
      exitType:          strategyPendingBuckets.exitType,
      sourceCount:       strategyPendingBuckets.sourceCount,
      distinctProviders: strategyPendingBuckets.distinctProviders,
      status:            strategyPendingBuckets.status,
    }).from(strategyPendingBuckets)
      .where(eq(strategyPendingBuckets.id, mention.bucketId))
      .limit(1);

    res.json({ mention, bucket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/pending-bucket/:id/kill ─────────────────────────────────
// Pass 18 — Operator kills a pending bucket (marks status='killed').
// Emits audit_log entry and SSE event. Idempotent: killing an already-killed
// bucket is a no-op (returns 200 with already_killed=true).

agentRoutes.post("/pending-bucket/:id/kill", async (req, res) => {
  const bucketId = req.params.id;
  const correlationId = getCorrelationId(req);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : "operator_killed";

  try {
    // Atomic update: only kill if currently pending (not already killed/graduated)
    const updated = await db.update(strategyPendingBuckets).set({
      status: "killed",
    }).where(
      and(
        eq(strategyPendingBuckets.id, bucketId),
        sql`${strategyPendingBuckets.status} NOT IN ('killed', 'graduated')`,
      )
    ).returning();

    if (updated.length === 0) {
      // Either not found or already in a terminal state
      const [current] = await db.select({ status: strategyPendingBuckets.status })
        .from(strategyPendingBuckets)
        .where(eq(strategyPendingBuckets.id, bucketId))
        .limit(1);

      if (!current) {
        res.status(404).json({ error: "Pending bucket not found" });
        return;
      }

      res.json({ killed: false, already_killed: true, status: current.status, bucket_id: bucketId });
      return;
    }

    // Audit
    db.insert(auditLog).values({
      action:            "pending_bucket.killed",
      entityType:        "strategy_pending_bucket",
      entityId:          bucketId,
      input:             { reason, killed_by: "operator" } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "agent",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, bucketId }, "pending-bucket kill: audit_log write failed");
    });

    // SSE
    broadcastSSE("pending_bucket:killed", {
      bucket_id:      bucketId,
      reason,
      correlation_id: correlationId,
    });

    logger.info({ bucketId, reason, correlationId }, "pending-bucket: killed by operator");
    res.json({ killed: true, bucket_id: bucketId, status: "killed" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, bucketId, correlationId }, "pending-bucket kill failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/discover-strategy-names ────────────────────────────────
// Pass 20 Layer 1 — GPT-5-mini strategy_name_discoverer role.
// Reads a web article markdown and returns an array of named strategies found.
// No DSL extraction here — just names + 1-sentence concepts.
// Idempotent. Audit log: scout.names_discovered per call.
//
// This is the first step in the 3-layer scout architecture:
//   Layer 1 (this endpoint): discover names from web articles
//   Layer 2 (transcript-extract): YouTube transcripts → DSL extraction
//   Layer 3 (Reddit): community validation
// Graduation: same concept_name confirmed across all 3 layers → /strategies.

const discoverStrategyNamesSchema = z.object({
  sourceUrl:      z.string().url(),
  markdown:       z.string().min(200).max(100_000), // 100KB guard
  sourceProvider: z.enum(["brave", "tavily", "exa", "parallel", "manual"]),
});

agentRoutes.post("/discover-strategy-names", idempotencyMiddleware, async (req, res) => {
  const parsed = discoverStrategyNamesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — discover-strategy-names schema not satisfied",
      details: parsed.error.issues,
      hint: "Required: sourceUrl (URL), markdown (200+ chars), sourceProvider",
    });
    return;
  }

  const { sourceUrl, markdown, sourceProvider } = parsed.data;
  const correlationId = getCorrelationId(req);
  const truncated = markdown.slice(0, 8000);

  const userPayload = JSON.stringify({
    source_url:     sourceUrl,
    source_provider: sourceProvider,
    article_markdown: truncated,
  });

  try {
    const raw = await callOpenAIOrFallback("strategy_name_discoverer", [
      { role: "user", content: userPayload },
    ]);

    if (!raw) {
      res.status(200).json({ discovered: false, count: 0, names: [] });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      logger.warn({ err, sourceUrl }, "discover-strategy-names: model returned non-JSON");
      res.status(200).json({ discovered: false, count: 0, names: [] });
      return;
    }

    const namesIn = (parsedJson as { names?: unknown }).names;
    if (!Array.isArray(namesIn) || namesIn.length === 0) {
      res.status(200).json({ discovered: false, count: 0, names: [] });
      return;
    }

    // Validate and normalize each name entry
    const names = namesIn
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => ({
        name:              typeof n.name            === "string" ? n.name.trim()             : "",
        concept_archetype: typeof n.concept_archetype === "string" ? n.concept_archetype.trim() : "unknown",
        brief_concept:     typeof n.brief_concept   === "string" ? n.brief_concept.trim().slice(0, 150) : "",
        source_url:        typeof n.source_url      === "string" ? n.source_url.trim()       : sourceUrl,
        source_provider:   sourceProvider,
      }))
      .filter((n) => n.name.length > 0); // drop nameless items

    // Audit log — fire-and-forget
    db.insert(auditLog).values({
      action:            "scout.names_discovered",
      entityType:        "system_journal",
      input:             { source_url: sourceUrl, source_provider: sourceProvider, markdown_bytes: markdown.length } as Record<string, unknown>,
      result:            { count: names.length, names: names.map((n) => n.name) } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "agent",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, sourceUrl }, "discover-strategy-names: audit_log write failed");
    });

    logger.info({ sourceUrl, sourceProvider, count: names.length, correlationId }, "discover-strategy-names: completed");
    res.json({ discovered: names.length > 0, count: names.length, names });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, sourceUrl, correlationId }, "discover-strategy-names failed");
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/agent/web-discovery ──────────────────────────────────────────
// Pass 20 Track H — Three-broker fan-out: Exa + Brave Search + Parallel.ai.
//
// All 3 Layer-1 sources are queried in parallel via Promise.allSettled.
// Results are merged into a single flat array, deduped by source_url (first
// occurrence wins — preserves provider attribution).
//
// Response: { strategies: [...], counts: {exa, brave, parallel, total_after_dedupe} }
//
// Fail-OPEN: any single broker failure returns [] for its slice; the other
// brokers' results are still returned. Never 5xx the caller.
// Idempotent. Audit log: scout.web_discovery_invoked per call.

const webDiscoverySchema = z.object({
  query: z.string().min(3).max(500),
});

agentRoutes.post("/web-discovery", idempotencyMiddleware, async (req, res) => {
  const parsed = webDiscoverySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — web-discovery schema not satisfied",
      details: parsed.error.issues,
      hint: "Required: query (3-500 chars, e.g. 'opening range breakout futures trading strategy')",
    });
    return;
  }

  const { query } = parsed.data;
  const correlationId = getCorrelationId(req);

  try {
    // Fan-out to all 3 Layer-1 sources in parallel.
    // Promise.allSettled: one broker failure must not suppress others.
    const [exaResult, braveResult, parallelResult] = await Promise.allSettled([
      runExaDiscovery(query, correlationId),
      runBraveDiscovery(query, correlationId),
      runParallelDiscovery(query),
    ]);

    const exaStrategies      = exaResult.status      === "fulfilled" ? exaResult.value      : [];
    const braveStrategies    = braveResult.status     === "fulfilled" ? braveResult.value     : [];
    const parallelStrategies = parallelResult.status  === "fulfilled" ? parallelResult.value  : [];

    if (exaResult.status === "rejected") {
      logger.warn({ reason: exaResult.reason, query }, "web-discovery: exa broker rejected");
    }
    if (braveResult.status === "rejected") {
      logger.warn({ reason: braveResult.reason, query }, "web-discovery: brave broker rejected");
    }
    if (parallelResult.status === "rejected") {
      logger.warn({ reason: parallelResult.reason, query }, "web-discovery: parallel broker rejected");
    }

    // Normalise parallel strategies to the shared shape — parallel broker returns
    // a different interface (no concept_archetype/brief_concept fields) so we adapt.
    const parallelNormalised = parallelStrategies.map((s) => ({
      name:              s.name,
      concept_archetype: "unknown" as const,
      brief_concept:     s.concept ?? "",
      source_url:        s.source_url ?? "",
      source_provider:   "parallel" as const,
    }));

    // Merge: exa first (highest signal quality), then brave, then parallel.
    const merged = [
      ...exaStrategies,
      ...braveStrategies,
      ...parallelNormalised,
    ];

    // Dedupe by source_url — keep first occurrence, preserving provider attribution.
    const seenUrls  = new Set<string>();
    const deduped   = merged.filter((s) => {
      if (!s.source_url) return true; // keep items with no URL (can't dedupe them)
      if (seenUrls.has(s.source_url)) return false;
      seenUrls.add(s.source_url);
      return true;
    });

    const counts = {
      exa:               exaStrategies.length,
      brave:             braveStrategies.length,
      parallel:          parallelStrategies.length,
      total_after_dedupe: deduped.length,
    };

    // Audit log — fire-and-forget
    db.insert(auditLog).values({
      action:            "scout.web_discovery_invoked",
      entityType:        "system_journal",
      input:             { query } as Record<string, unknown>,
      result:            { counts, strategy_names: deduped.map((s) => s.name) } as unknown as Record<string, unknown>,
      status:            "success",
      decisionAuthority: "agent",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, query }, "web-discovery: audit_log write failed");
    });

    logger.info({ query, counts, correlationId }, "web-discovery: completed");
    res.json({ strategies: deduped, counts });
  } catch (err) {
    // Belt-and-suspenders — brokers never throw, but guard top-level just in case.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, query, correlationId }, "web-discovery: unexpected error (returning [])");
    res.json({ strategies: [], counts: { exa: 0, brave: 0, parallel: 0, total_after_dedupe: 0 }, error: msg });
  }
});

// ─── POST /api/agent/cross-validate ──────────────────────────────────────
// Pass 18 — Thin LLM wrapper for the CV1 n8n workflow.
//
// Receives a seed extraction + N candidates from CV1.
// Calls cross_source_validator role (GPT-5-mini, adversarial similarity judge).
// Returns per-candidate match verdict with confidence.
//
// CV1 uses the response to decide which candidates to POST back to
// /scout-ideas/pending as confirmed matches (is_cross_validation_result=true).

const crossValidateSchema = z.object({
  seed: z.object({
    thesis:          z.string().min(1),
    market:          z.string().min(1),
    timeframe:       z.string().min(1),
    entry_rules:     z.string().min(1),
    exit_rules:      z.string().min(1),
    risk_rules:      z.string().min(1),
    regime:          z.string().min(1),
    concept_name:    z.string().min(1),
    source_url:      z.string().url(),
    source_provider: z.string().min(1),
    confidence_score: z.number().min(0).max(1).optional(),
  }),
  candidates: z.array(z.object({
    source_provider: z.string().min(1),
    source_url:      z.string().url(),
    extracted_idea:  z.record(z.unknown()),
  })).max(20),  // Guard: oversized payload rejected
});

agentRoutes.post("/cross-validate", idempotencyMiddleware, async (req, res) => {
  const parsed = crossValidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request — cross-validate schema not satisfied",
      details: parsed.error.issues,
    });
    return;
  }

  const { seed, candidates } = parsed.data;
  const correlationId = getCorrelationId(req);

  if (candidates.length === 0) {
    // Empty candidates — nothing to validate
    res.json({ matches: [] });
    return;
  }

  // Audit: cross_validator.invoked — record that the LLM judge was called
  db.insert(auditLog).values({
    action:            "cross_validator.invoked",
    entityType:        "strategy_pending_bucket",
    input:             {
      seed_source_url:   seed.source_url,
      seed_concept_name: seed.concept_name,
      seed_market:       seed.market,
      candidate_count:   candidates.length,
    } as unknown as Record<string, unknown>,
    status:            "pending",
    decisionAuthority: "agent",
    correlationId,
  }).catch((err) => {
    logger.warn({ err, correlationId }, "cross-validate: audit_log invoked write failed");
  });

  const userPayload = JSON.stringify({ seed, candidates });

  try {
    // Measure cross-validator LLM call latency per spec §Observability
    const cvStartSec = Date.now() / 1000;
    const raw = await callOpenAIOrFallback("cross_source_validator", [
      { role: "user", content: userPayload },
    ]);
    crossValidatorLatencySeconds.observe(Date.now() / 1000 - cvStartSec);

    if (!raw) {
      // Both cloud and Ollama unavailable — return empty matches (fail-open at
      // the cross-validator level; the bucket will not graduate without real
      // corroboration, which is the safe direction).
      crossValidatorCallsTotal.labels({ outcome: "model_unavailable" }).inc();
      res.json({ matches: [], reason: "model_unavailable" });
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      logger.warn({ raw: raw.slice(0, 200), correlationId }, "cross-validate: model returned non-JSON");
      crossValidatorCallsTotal.labels({ outcome: "error" }).inc();
      res.json({ matches: [], reason: "non_json" });
      return;
    }

    const matchesIn = (parsedJson as { matches?: unknown }).matches;
    if (!Array.isArray(matchesIn)) {
      crossValidatorCallsTotal.labels({ outcome: "error" }).inc();
      res.json({ matches: [], reason: "invalid_schema" });
      return;
    }

    // Validate each match entry — drop malformed items rather than crash
    const matches = matchesIn
      .filter((m) =>
        typeof (m as any)?.index === "number" &&
        typeof (m as any)?.is_same_setup === "boolean" &&
        typeof (m as any)?.confidence === "number" &&
        typeof (m as any)?.divergence_notes === "string",
      )
      .map((m: any) => ({
        index:            Number(m.index),
        is_same_setup:    Boolean(m.is_same_setup),
        confidence:       Number(m.confidence),
        divergence_notes: String(m.divergence_notes),
      }));

    // Emit per-match audit rows and metric counters
    let confirmedCount = 0;
    let rejectedCount  = 0;
    for (const match of matches) {
      const isConfirmed = match.is_same_setup && match.confidence >= 0.7;
      const outcome = isConfirmed ? "match_confirmed" : "match_rejected";
      crossValidatorCallsTotal.labels({ outcome }).inc();
      if (isConfirmed) confirmedCount++;
      else rejectedCount++;

      // Per-match audit row — fire-and-forget
      const candidateInfo = candidates[match.index];
      db.insert(auditLog).values({
        action:            `cross_validator.${outcome}`,
        entityType:        "strategy_pending_bucket",
        input:             {
          seed_concept_name:    seed.concept_name,
          seed_market:          seed.market,
          candidate_index:      match.index,
          candidate_source_url: candidateInfo?.source_url ?? null,
          candidate_provider:   candidateInfo?.source_provider ?? null,
          is_same_setup:        match.is_same_setup,
          confidence:           match.confidence,
          divergence_notes:     match.divergence_notes.slice(0, 500),
        } as unknown as Record<string, unknown>,
        status:            "success",
        decisionAuthority: "agent",
        correlationId,
      }).catch((err) => {
        logger.warn({ err, correlationId, matchIndex: match.index }, `cross-validate: audit_log ${outcome} write failed`);
      });
    }

    logger.info(
      { correlationId, candidateCount: candidates.length, confirmedCount, rejectedCount },
      "cross-validate: verdicts emitted",
    );

    res.json({ matches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, correlationId }, "cross-validate failed");
    crossValidatorCallsTotal.labels({ outcome: "error" }).inc();
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agent/failure-patterns ──────────────────────────────
// Returns AVOID patterns from recent failed strategies (for n8n + Ollama prompt injection)

agentRoutes.get("/failure-patterns", async (req, res) => {
  const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
  const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
  try {
    const patterns = await agentService.getFailurePatterns(days, limit);
    res.json(patterns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/agent/jobs ───────────────────────────────────────────
// Wave hardening 2026-06-22: list agent jobs from agent_jobs (mutable
// job-state table), NOT audit_log. audit_log is append-only (migration 0058
// trigger); querying it for job status always returned "pending" because the
// completion UPDATEs were silently throwing.

agentRoutes.get("/jobs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const typeFilter = req.query.type as string | undefined;
  const statusFilter = req.query.status as string | undefined;

  // Map friendly type names to action prefixes (same surface as before)
  const typeActionMap: Record<string, string[]> = {
    "trading-quant": ["agent.run-strategy", "agent.run-class-strategy", "agent.batch", "agent.robustness", "agent.analyze-market"],
    "openclaw-scout": ["agent.find-strategies", "agent.scout-ideas"],
    "ollama-analyst": ["agent.critique"],
  };

  const conditions: ReturnType<typeof eq>[] = [];
  if (statusFilter) {
    // Map "failed" to include "failure" status
    if (statusFilter === "failed") {
      conditions.push(sql`${agentJobs.status} IN ('failed', 'failure')` as any);
    } else {
      conditions.push(eq(agentJobs.status, statusFilter));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count: rawTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentJobs)
    .where(whereClause);

  const fetchLimit = typeFilter ? Math.max(limit * 5, 200) : limit + offset + 10;
  const rows = await db
    .select()
    .from(agentJobs)
    .where(whereClause)
    .orderBy(desc(agentJobs.createdAt))
    .limit(fetchLimit);

  // Apply type filter (in-memory, same as before)
  let filtered = rows as typeof rows;
  if (typeFilter && typeActionMap[typeFilter]) {
    const allowedActions = typeActionMap[typeFilter];
    filtered = filtered.filter((j) => allowedActions.includes(j.action));
  }

  const total = typeFilter ? filtered.length : rawTotal;
  const paginated = filtered.slice(offset, offset + limit);

  res.json({ data: paginated, total });
});

// ─── GET /api/agent/jobs/:id ───────────────────────────────────────
// Wave hardening 2026-06-22: query agent_jobs (mutable) not audit_log.

agentRoutes.get("/jobs/:id", async (req, res) => {
  const [job] = await db
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.id, req.params.id));

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(job);
});

// DELETE /api/agent/jobs — Purge agent-specific jobs from agent_jobs (mutable).
// Wave hardening 2026-06-22: previously deleted from audit_log, which throws
// "audit_log is append-only" from the migration-0058 trigger. audit_log rows
// are immutable by design; only the mutable agent_jobs state is purged here.
agentRoutes.delete("/jobs", async (_req, res) => {
  const agentActions = [
    "agent.run-strategy",
    "agent.run-class-strategy",
    "agent.find-strategies",
    "agent.critique",
    "agent.batch",
    "agent.scout-ideas",
    "agent.robustness",
  ];
  await db.delete(agentJobs).where(inArray(agentJobs.action, agentActions));
  res.json({ deleted: true, message: "Agent jobs purged" });
});
