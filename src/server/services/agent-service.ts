import { createHash, randomUUID } from "crypto";
import { eq, and, gte, sql, desc, isNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, systemJournal, auditLog, backtests } from "../db/schema.js";
// Track A F-6: insertAuditRowSafe added. Remaining db.insert(auditLog) call
// sites in this file retain raw pattern until incremental migration completes.
// TODO: correlation_id not threaded through all call sites in this file.
import { insertAuditRow, insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { runBacktest } from "./backtest-service.js";
import { OllamaClient } from "./ollama-client.js";
import { GraveyardGate } from "./graveyard-gate.js";
import { logger } from "../lib/logger.js";
import { callOpenAI } from "./model-router.js";
import { getActiveVersionIdForGeneration } from "./prompt-evolution-service.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { runPythonModule } from "../lib/python-runner.js";
// C3: Prompt injection defense imports
import { sanitizeExternalContent } from "./llm-input-sanitizer.js";
import { validateRawLLMResponse, validateDSLOutput } from "./llm-output-validator.js";
import { sandboxCheckCode } from "./llm-sandbox-service.js";
// C9: DSL diversity check (W17 Team B) — pre-backtest template similarity gate
import { checkDslDiversity, persistDslFeatureVector, auditDslDiversityRejection } from "./dsl-diversity-service.js";
// FIX 6 (2026-07-02): Discord WARN for dsl_critic fail-open invocation visibility
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
// Pass 4 — Scout substance validation (Tier-1 regex + Tier-2 LLM auditor + premium format)
import {
  tier1RegexFilter,
  stripMarkdown,
  generateOneSentenceLead,
} from "./scout-formatter.js";

// Pass 4 — daily budget cap for scout_auditor LLM calls.
// Pure in-memory counter (resets on process restart) — sufficient because
// 200 calls/day << restart cadence. If we ever need persistence, swap for
// a redis/db-backed counter without touching callers.
const SCOUT_AUDITOR_DAILY_CAP = 200;
const scoutAuditorBudget: { day: string; count: number } = { day: "", count: 0 };
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function tryConsumeAuditorBudget(): boolean {
  const today = todayKey();
  if (scoutAuditorBudget.day !== today) {
    scoutAuditorBudget.day = today;
    scoutAuditorBudget.count = 0;
  }
  if (scoutAuditorBudget.count >= SCOUT_AUDITOR_DAILY_CAP) return false;
  scoutAuditorBudget.count += 1;
  return true;
}
/** Test helper — reset budget counter between assertions. */
export function __resetScoutAuditorBudgetForTests(): void {
  scoutAuditorBudget.day = "";
  scoutAuditorBudget.count = 0;
}

// ─── Pass 10: in-memory reject-spike detector ──────────────────────
// Each reject path calls trackRejectAndMaybeBroadcast() so the dashboard
// gets a real-time spike SSE event WITHOUT waiting for the 5-min cron.
// The cron in scout-watchdog-service.ts is the safety-net; this is the
// fast-path. Sliding 5-minute window per action; SSE fire-and-forget
// after threshold is crossed; per-action cooldown prevents flood.
const REJECT_SPIKE_WINDOW_MS = 5 * 60 * 1000;
const REJECT_SPIKE_THRESHOLD = 10;
const REJECT_SPIKE_COOLDOWN_MS = 5 * 60 * 1000;
const rejectTimestamps: Map<string, number[]> = new Map();
const rejectLastBroadcast: Map<string, number> = new Map();

function trackRejectAndMaybeBroadcast(action: string): void {
  try {
    const now = Date.now();
    const cutoff = now - REJECT_SPIKE_WINDOW_MS;
    let arr = rejectTimestamps.get(action);
    if (!arr) {
      arr = [];
      rejectTimestamps.set(action, arr);
    }
    arr.push(now);
    // Prune old entries in-place.
    while (arr.length > 0 && arr[0] < cutoff) arr.shift();

    if (arr.length < REJECT_SPIKE_THRESHOLD) return;

    const lastFired = rejectLastBroadcast.get(action) ?? 0;
    if (now - lastFired < REJECT_SPIKE_COOLDOWN_MS) return;
    rejectLastBroadcast.set(action, now);

    // Lazy import to avoid circular dependency at module load time.
    void (async () => {
      try {
        const { broadcastSSE } = await import("../routes/sse.js");
        broadcastSSE("scout-health:reject-spike", {
          action,
          count: arr!.length,
          windowMs: REJECT_SPIKE_WINDOW_MS,
          threshold: REJECT_SPIKE_THRESHOLD,
          source: "agent-service-inline",
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn({ err, action }, "trackRejectAndMaybeBroadcast: SSE failed — non-fatal");
      }
    })();
  } catch (err) {
    // Hot path — never propagate.
    logger.warn({ err, action }, "trackRejectAndMaybeBroadcast: unexpected error — suppressed");
  }
}

/** Test helper — reset the reject-spike state between assertions. */
export function __resetRejectSpikeStateForTests(): void {
  rejectTimestamps.clear();
  rejectLastBroadcast.clear();
}

// Pass 7 Task 2 — daily budget cap for dsl_quality_critic LLM calls.
// P2E (Wave 9, 2026-05-17): changed from fail-OPEN to fail-CLOSED on budget exhaustion.
// Rationale: budget exhaustion was silently passing every strategy, bypassing the critic gate.
// Ollama fallback (OLLAMA_DSL_CRITIC_FALLBACK=true) provides a local model path.
const DSL_QUALITY_CRITIC_DAILY_CAP = 100;
const dslQualityCriticBudget: { day: string; count: number } = { day: "", count: 0 };
function tryConsumeDslCriticBudget(): boolean {
  const today = todayKey();
  if (dslQualityCriticBudget.day !== today) {
    dslQualityCriticBudget.day = today;
    dslQualityCriticBudget.count = 0;
  }
  if (dslQualityCriticBudget.count >= DSL_QUALITY_CRITIC_DAILY_CAP) return false;
  dslQualityCriticBudget.count += 1;
  return true;
}
/** Test helper — reset DSL critic budget counter between assertions. */
export function __resetDslCriticBudgetForTests(): void {
  dslQualityCriticBudget.day = "";
  dslQualityCriticBudget.count = 0;
}

// FIX 6 (2026-07-02): Dedup-daily Discord WARN for dsl_critic fail-open visibility.
// Only one Discord WARN fires per day regardless of how many fail-open events occur.
// This prevents Discord spam when LLM is degraded. The audit_log row fires on EVERY
// fail-open event for full queryability.
const _criticFailOpenDiscordSent: { day: string } = { day: "" };
function _shouldSendCriticFailOpenDiscord(): boolean {
  const today = todayKey();
  if (_criticFailOpenDiscordSent.day === today) return false;
  _criticFailOpenDiscordSent.day = today;
  return true;
}
/** Test helper — reset the dedup state between test runs. */
export function __resetCriticFailOpenDiscordForTests(): void {
  _criticFailOpenDiscordSent.day = "";
}

export interface DslQualityCriticResult {
  accept: boolean;
  score: number;
  concerns: Array<string | { field?: string; issue?: string } | Record<string, unknown>>;
  reasoning: string;
  source: "critic" | "fail_open" | "budget_exhausted" | "ollama_fallback";
}

/**
 * P2E (Wave 9, 2026-05-17) — Ollama fallback path for dsl_quality_critic.
 * Called when cloud budget is exhausted AND OLLAMA_DSL_CRITIC_FALLBACK=true.
 * Uses gemma4:e4b-it-qat (local, zero cost) with same JSON output contract.
 * Returns DslQualityCriticResult or null on failure (caller then fails-CLOSED).
 */
export async function runDslQualityCriticOllama(
  payload: { dsl: Record<string, unknown>; sourceFind: { title: string; source: string | null; description: string } },
  journalId: string,
): Promise<DslQualityCriticResult | null> {
  try {
    const ollama = new OllamaClient("http://localhost:11434");
    const prompt = `You are a DSL quality critic for futures trading strategies. Given this strategy DSL and source context, evaluate quality and output JSON with: { score: 0-10, accept: boolean, concerns: [], reasoning: string }. Accept if score >= 7. Be strict — reject over-fit parameters, missing stops, or unrealistic risk.\n\nStrategy DSL:\n${JSON.stringify(payload.dsl, null, 2)}\n\nSource:\n${JSON.stringify(payload.sourceFind)}\n\nRespond with only valid JSON.`;
    const res = await ollama.generate("gemma4:e4b-it-qat", prompt, { temperature: 0.1 }, true);
    const raw = res.response;
    if (!raw) return null;
    let parsed: { score?: number; accept?: boolean; concerns?: unknown[]; reasoning?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn({ journalId }, "dsl_quality_critic_ollama: non-JSON response from Ollama");
      return null;
    }
    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const accept = typeof parsed.accept === "boolean" ? parsed.accept : score >= 7;
    const concerns = Array.isArray(parsed.concerns)
      ? (parsed.concerns as Array<string | Record<string, unknown>>)
      : [];
    return {
      accept,
      score,
      concerns,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      source: "ollama_fallback",
    };
  } catch (err) {
    logger.warn({ err, journalId }, "dsl_quality_critic_ollama: Ollama call failed");
    return null;
  }
}

/**
 * FIX 6 (2026-07-02): Emit dsl_critic.invocation_failed_fail_open audit row
 * + a deduped-daily Discord WARN when a critic invocation fails open.
 * Called from within runDslQualityCritic fail-open paths.
 */
async function _emitCriticFailOpenAudit(journalId: string, reason: string): Promise<void> {
  // Always write audit row — every fail-open event is queryable
  insertAuditRow({
    action: "dsl_critic.invocation_failed_fail_open",
    entityType: "system_journal",
    entityId: journalId,
    input: { journal_id: journalId } as Record<string, unknown>,
    result: { reason, accept: true, source: "fail_open" } as Record<string, unknown>,
    status: "warning",
    decisionAuthority: "system",
  }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "dsl_critic fail-open audit write failed"));

  // Deduped-daily Discord WARN — fire once per day to avoid spam
  if (_shouldSendCriticFailOpenDiscord()) {
    notifyWarning(
      "DSL Critic Fail-Open",
      appendFamilyGradePostscript(
        `DSL quality critic invocation failed (fail-open) — strategies passing WITHOUT critic review. Reason: ${reason}. Check audit_log action=dsl_critic.invocation_failed_fail_open for full event list.`,
        "The quality reviewer that normally checks new strategies is offline, so strategies are being approved without that safety check.",
        "No action needed right now, but tell Tony so he can restart the reviewer before more strategies are approved.",
      ),
      { journal_id: journalId, reason },
    );
  }
}

/**
 * Pass 7 Task 2 — DSL Quality Critic gate.
 *
 * Calls `selectModel("dsl_quality_critic")` after compile-validate has passed.
 * Output JSON contract: { score: 0-10, accept: bool, concerns: [...], reasoning: string }.
 *
 * P2E (Wave 9, 2026-05-17): budget exhaustion now FAILS-CLOSED (was fail-OPEN).
 * Set OLLAMA_DSL_CRITIC_FALLBACK=true to attempt local Ollama before failing.
 *
 * Fail-CLOSED paths (return accept=false, source=budget_exhausted):
 *   - daily budget exhausted (100/day cap) with no Ollama fallback configured
 *
 * Fail-OPEN paths (return accept=true, source=fail_open):
 *   - LLM null / throw / non-JSON parse (OpenAI path only)
 *   - missing accept field with score >= 6 heuristic
 *
 * Exported so tests can mock the LLM call.
 */
export async function runDslQualityCritic(
  payload: { dsl: Record<string, unknown>; sourceFind: { title: string; source: string | null; description: string } },
  journalId: string,
  callOpenAIFn: typeof callOpenAI = callOpenAI,
): Promise<DslQualityCriticResult> {
  if (!tryConsumeDslCriticBudget()) {
    // P2E: fail-CLOSED by default; attempt Ollama fallback if configured
    const ollamaFallback = process.env.OLLAMA_DSL_CRITIC_FALLBACK === "true";
    if (ollamaFallback) {
      logger.warn(
        { dailyCap: DSL_QUALITY_CRITIC_DAILY_CAP, journalId },
        "dsl_quality_critic: daily budget exhausted, attempting Ollama fallback",
      );
      const ollamaResult = await runDslQualityCriticOllama(payload, journalId);
      if (ollamaResult !== null) {
        // Audit: Ollama fallback fired
        await insertAuditRow({
          action: "dsl_quality_critic.budget_exhausted_ollama_fallback",
          entityType: "system_journal",
          entityId: journalId,
          input: { journal_id: journalId, fallback: "ollama" } as Record<string, unknown>,
          result: { accept: ollamaResult.accept, score: ollamaResult.score } as Record<string, unknown>,
          status: ollamaResult.accept ? "accepted" : "rejected",
          decisionAuthority: "system",
        }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
        return ollamaResult;
      }
      logger.warn({ journalId }, "dsl_quality_critic: Ollama fallback also failed — failing CLOSED");
    } else {
      logger.warn(
        { dailyCap: DSL_QUALITY_CRITIC_DAILY_CAP, journalId },
        "dsl_quality_critic: daily budget exhausted, failing CLOSED (set OLLAMA_DSL_CRITIC_FALLBACK=true for local fallback)",
      );
    }
    // Audit: budget exhaustion fail-CLOSED
    await insertAuditRow({
      action: "dsl_quality_critic.budget_exhausted_fail_closed",
      entityType: "system_journal",
      entityId: journalId,
      input: { journal_id: journalId, daily_cap: DSL_QUALITY_CRITIC_DAILY_CAP } as Record<string, unknown>,
      result: { accept: false, reason: "daily_cap_reached_fail_closed" } as Record<string, unknown>,
      status: "rejected",
      decisionAuthority: "system",
    }).catch((auditErr: unknown) => logger.warn({ err: auditErr }, "audit_log write failed (non-blocking)"));
    return { accept: false, score: 0, concerns: ["critic_budget_exhausted"], reasoning: "daily_cap_reached_fail_closed", source: "budget_exhausted" };
  }

  let raw: string | null | undefined;
  try {
    raw = await callOpenAIFn(
      "dsl_quality_critic",
      [{ role: "user", content: JSON.stringify(payload) }],
      { signalType: "strategy_candidate" },
    );
  } catch (err) {
    logger.warn({ err, journalId }, "dsl_quality_critic: LLM call threw, failing open");
    // FIX 6: emit audit row + deduped-daily Discord WARN so fail-open is queryable
    void _emitCriticFailOpenAudit(journalId, "llm_threw_fail_open");
    return { accept: true, score: 6, concerns: [], reasoning: "llm_threw_fail_open", source: "fail_open" };
  }

  if (!raw) {
    logger.warn({ journalId }, "dsl_quality_critic: LLM returned null, failing open");
    // FIX 6: emit audit row + deduped-daily Discord WARN
    void _emitCriticFailOpenAudit(journalId, "llm_null_fail_open");
    return { accept: true, score: 6, concerns: [], reasoning: "llm_null_fail_open", source: "fail_open" };
  }

  let parsed: { score?: number; accept?: boolean; concerns?: unknown[]; reasoning?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ journalId }, "dsl_quality_critic: non-JSON response, failing open");
    // FIX 6: emit audit row + deduped-daily Discord WARN
    void _emitCriticFailOpenAudit(journalId, "critic_parse_failed_fail_open");
    return {
      accept: true,
      score: 6,
      concerns: [],
      reasoning: "critic_parse_failed_fail_open",
      source: "fail_open",
    };
  }

  const score = typeof parsed.score === "number" ? parsed.score : 0;
  const accept = typeof parsed.accept === "boolean" ? parsed.accept : score >= 6;
  const concerns = Array.isArray(parsed.concerns)
    ? (parsed.concerns as Array<string | Record<string, unknown>>)
    : [];
  return {
    accept,
    score,
    concerns,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    source: "critic",
  };
}

interface Tier2AuditorResult {
  accept: boolean;
  score: number;
  reason: string;
  source: "auditor" | "fail_open" | "budget_exhausted";
}

/**
 * Tier-2 LLM auditor (GPT-5-mini scout_auditor role). Called after Tier-1
 * regex passes. Fail-OPEN on parse error / LLM error / budget exhaustion —
 * better to journal a noisy idea than silently drop quality leads.
 *
 * The function is exported so tests can mock callOpenAI and verify call args.
 */
async function tier2AuditorFilter(
  idea: { title: string; description: string; url?: string; source: string; signal_type?: string },
  callOpenAIFn: typeof callOpenAI = callOpenAI,
): Promise<Tier2AuditorResult> {
  if (!tryConsumeAuditorBudget()) {
    logger.warn(
      { dailyCap: SCOUT_AUDITOR_DAILY_CAP },
      "scout_auditor: daily budget exhausted, falling through (fail-open)",
    );
    return { accept: true, score: 0, reason: "budget_exhausted", source: "budget_exhausted" };
  }

  try {
    const raw = await callOpenAIFn(
      "scout_auditor",
      [
        {
          role: "user",
          content: JSON.stringify({
            title: idea.title,
            description: idea.description,
            url: idea.url,
            source: idea.source,
          }),
        },
      ],
      { signalType: (idea.signal_type as "strategy_candidate" | "market_news_intel") ?? "strategy_candidate" },
    );

    if (!raw) {
      return { accept: true, score: 0, reason: "llm_null_response", source: "fail_open" };
    }

    let parsed: { score?: number; accept?: boolean; reason?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { accept: true, score: 0, reason: "llm_parse_error", source: "fail_open" };
    }

    const score = typeof parsed.score === "number" ? parsed.score : 0;
    // Trust explicit accept boolean if present, else use score >= 5 heuristic.
    const accept = typeof parsed.accept === "boolean" ? parsed.accept : score >= 5;
    return {
      accept,
      score,
      reason: parsed.reason ?? (accept ? "auditor_accept" : "auditor_reject"),
      source: "auditor",
    };
  } catch (err) {
    logger.warn({ err }, "scout_auditor: LLM call threw, fail-open");
    return { accept: true, score: 0, reason: "llm_threw", source: "fail_open" };
  }
}
export { tier2AuditorFilter };

const _SYMBOLS = ["MES", "MNQ", "MCL"] as const;
type Symbol = (typeof _SYMBOLS)[number];

export interface RunStrategyInput {
  strategy_name: string;
  one_sentence: string;
  python_code: string;
  params: Record<string, unknown>;
  symbol: Symbol;
  timeframe: string;
  start_date?: string;
  end_date?: string;
  source: "ollama" | "openclaw" | "manual";
}

export interface CritiqueInput {
  backtestId?: string;
  results?: Record<string, unknown>;
  model?: string;
}

export interface ScoutIdea {
  source: string;
  title: string;
  description: string;
  url?: string;
  summary?: string;
  source_quality?: "high" | "medium" | "low";
  confidence_score?: number;
  instruments?: string[];
  indicators_mentioned?: string[];
  // Pass 4 — additive optional fields. Default downstream treatment of
  // signal_type=undefined is "strategy_candidate" (backward compat).
  signal_type?: "strategy_candidate" | "market_news_intel" | "research_find";
  entry_rules?: string;
  concept_name?: string;
}

// ─── Pass 19: Cross-validation insert guard ──────────────────────────────────
// This function MUST be called immediately before every db.insert(strategies).
// It enforces the mandate: no strategy row lands in the strategies table unless
// it came from cross-validation (graduated_bucket) or is an operator-initiated
// clone/regen of a cross-validated strategy.
//
// ALLOWED without cross-validation tags:
//   - source='clone'  → operator-initiated; inherits parent's cross-validated tag
//   - source='b4_regen' → regen from declining strategy; inherits parent's provenance
//   - source='evolved' → LLM-guided mutation child; passes auditGraduatedConfig
//                        before INSERT (FIX 1, deepscan11 Track P, 2026-07-02)
//
// BLOCKED: any other source not in the cross-validated exemption list.
export function assertCrossValidatedSource(source: string, tags: string[]): void {
  const EXEMPT_SOURCES = new Set(["clone", "b4_regen", "evolved"]);
  if (EXEMPT_SOURCES.has(source)) return;  // operator-initiated clone/regen/evolved exempted
  if (source === "graduated_bucket") return; // canonical cross-validated path
  if (tags.includes("cross-validated")) return; // inherited cross-validated tag
  throw new Error(
    `strategy_insert_violation: only graduated_bucket source or cross-validated tag is allowed; got source=${source}`,
  );
}

export class AgentService {
  private ollama: OllamaClient;
  private graveyardGate: GraveyardGate;

  constructor(ollamaClient?: OllamaClient) {
    this.ollama = ollamaClient ?? new OllamaClient();
    this.graveyardGate = new GraveyardGate(this.ollama);
  }

  /**
   * Compile + backtest a strategy candidate end-to-end.
   *
   * NOTE on tournament gating: the 4-role adversarial tournament
   * (Proposer → Critic → Prosecutor → Promoter) runs UPSTREAM in the n8n
   * Strategy_Generation_Loop workflow and is NOT invoked here. n8n is the
   * canonical orchestrator for the tournament; this Node loop only runs
   * the graveyard gate (cosine similarity) before proceeding to backtest.
   *
   * If POST /api/agent/run-strategy is called directly (bypassing n8n),
   * the tournament gate is BYPASSED. See CLAUDE.md
   * "Tournament Gating (n8n-canonical)" for context.
   */
  async runStrategy(input: RunStrategyInput, context?: { correlationId?: string }) {
    const correlationId = context?.correlationId;
    try {
    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block strategy compile→backtest when pipeline is PAUSED/VACATION.
    // n8n keeps scouting (writes to system_journal); those entries are
    // drained by drainScoutedIdeas() once the pipeline resumes.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "runStrategy", strategyName: input.strategy_name, source: input.source },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
    }

    // 0. Graveyard gate — reject if too similar to a dead strategy
    const graveyardCheck = await this.graveyardGate.check(
      `${input.strategy_name}: ${input.one_sentence}`,
    );
    if (graveyardCheck.blocked) {
      logger.info({ graveyardCheck }, "Strategy blocked by graveyard gate");
      return {
        strategyId: null,
        backtestId: null,
        status: "blocked",
        tier: null,
        forgeScore: null,
        graveyardCheck,
      };
    }

    // 0a. Strategy prevalidator — fingerprint match (graveyard journal),
    // correlation guard (DEPLOYED on same market+tf), and regime fit.
    // FIX 4: previously the prevalidator service was orphan-in-process —
    // n8n called it but direct API hits via POST /api/agent/run-strategy
    // bypassed it entirely. Wire it here so all paths are gated.
    //
    // Concept name derivation: lowercase the strategy_name + one_sentence
    // and pick the first archetype keyword that matches. Falls back to a
    // sanitized strategy_name slug if no archetype matches — that gives the
    // prevalidator something deterministic to fingerprint while not silently
    // mapping every untagged candidate to a single bucket.
    {
      const archetypeKeywords: Array<{ keyword: string; concept: string }> = [
        { keyword: "mean revert", concept: "mean_revert" },
        { keyword: "trend follow", concept: "trend_follow" },
        { keyword: "breakout", concept: "breakout" },
        { keyword: "scalp", concept: "scalp" },
        { keyword: "orb", concept: "orb" },
        { keyword: "vwap", concept: "vwap" },
        { keyword: "momentum", concept: "momentum" },
        { keyword: "range", concept: "range" },
        { keyword: "trend", concept: "trend_follow" },
      ];
      const descLowerForPrevalidator = `${input.strategy_name} ${input.one_sentence}`.toLowerCase();
      const matched = archetypeKeywords.find((a) => descLowerForPrevalidator.includes(a.keyword));
      const conceptNameSlug = input.strategy_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
      const conceptName = matched?.concept ?? (conceptNameSlug || "uncategorized");

      try {
        const { prevalidateCandidate } = await import("./strategy-prevalidator.js");
        const prevalidation = await prevalidateCandidate({
          conceptName,
          market: input.symbol,
          timeframe: input.timeframe,
          entryRules: input.one_sentence,
        });
        if (!prevalidation.passed) {
          logger.info(
            {
              strategyName: input.strategy_name,
              conceptName,
              fingerprint: prevalidation.fingerprint,
              reasons: prevalidation.reasons,
            },
            "Strategy blocked by prevalidator",
          );
          // Audit row mirroring graveyard-gate rejection pattern. No strategy
          // row is written — we reject at the gate, not after persistence.
          await db
            .insert(auditLog)
            .values({
              action: "strategy.prevalidator-rejected",
              entityType: "strategy",
              input: {
                strategy_name: input.strategy_name,
                source: input.source,
                symbol: input.symbol,
                timeframe: input.timeframe,
                conceptName,
              },
              result: {
                fingerprint: prevalidation.fingerprint,
                reasons: prevalidation.reasons,
                checks: prevalidation.checks,
              },
              status: "failure",
              decisionAuthority: "gate",
              correlationId: correlationId ?? null,
            })
            .catch((auditErr) => {
              logger.warn({ err: auditErr }, "prevalidator-rejected audit insert failed (non-blocking)");
            });
          return {
            strategyId: null,
            backtestId: null,
            status: "blocked_prevalidator",
            tier: null,
            forgeScore: null,
            prevalidation,
          };
        }
      } catch (preErr) {
        // Prevalidator infra failure (DB error, missing table) — log and proceed.
        // We treat infra failure as fail-open so the agent loop never deadlocks
        // on a transient prevalidator outage. The graveyard gate above is the
        // primary defense; this is a secondary correlation/regime guard.
        logger.warn({ err: preErr }, "Prevalidator threw — proceeding (fail-open)");
      }
    }

    // 0b. Query graveyard for relevant past failures — inject warnings but don't block.
    // Even if the candidate wasn't blocked by embedding similarity, there may be
    // relevant failure patterns from strategies with the same archetype. These
    // warnings flow into the return value and system journal for audit.
    let graveyardWarnings: string[] = [];
    try {
      // Heuristic: derive archetype from the strategy description keywords
      const descLower = `${input.strategy_name} ${input.one_sentence}`.toLowerCase();
      const archetypeHints: Array<{ keyword: string; category: string }> = [
        { keyword: "mean revert", category: "regime" },
        { keyword: "trend", category: "regime" },
        { keyword: "breakout", category: "robustness" },
        { keyword: "scalp", category: "execution" },
        { keyword: "orb", category: "robustness" },
        { keyword: "vwap", category: "robustness" },
        { keyword: "momentum", category: "regime" },
        { keyword: "range", category: "regime" },
      ];
      const matchedCategory = archetypeHints.find((h) => descLower.includes(h.keyword))?.category;

      if (matchedCategory) {
        const failures = await this.graveyardGate.getRelevantFailures(matchedCategory, 5);
        if (failures.length > 0) {
          graveyardWarnings = failures.map(
            (f) => `[${f.name}] ${f.deathReason ?? "unknown cause"}`
          );
          logger.info(
            { strategyName: input.strategy_name, category: matchedCategory, warningCount: graveyardWarnings.length },
            "Graveyard warnings attached — similar failure patterns found",
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, "Graveyard failure lookup failed (non-blocking)");
    }

    // 0c. C3: Sandbox check — AST scan LLM-generated python_code before executing
    // Only applied to AI-generated sources (ollama/openclaw) — manual code is
    // trusted (the single human operator wrote it). AST scan catches forbidden
    // imports and dangerous calls without executing the code.
    if (input.source === "ollama" || input.source === "openclaw") {
      const sandboxResult = await sandboxCheckCode(input.python_code, {
        runCode: false,  // AST scan only — no execution
        strategyName: input.strategy_name,
      });
      if (!sandboxResult.passed) {
        logger.warn(
          {
            strategyName: input.strategy_name,
            source: input.source,
            violations: sandboxResult.violations,
            syntaxError: sandboxResult.syntaxError,
          },
          "runStrategy: python_code blocked by sandbox AST scan",
        );
        return {
          strategyId: null,
          backtestId: null,
          status: "blocked_sandbox",
          tier: null,
          forgeScore: null,
          sandboxViolations: sandboxResult.violations,
        };
      }
    }

    // 1. Deduplicate strategy name — auto-version if name already exists
    let finalName = input.strategy_name;
    const existingNames = await db
      .select({ name: strategies.name })
      .from(strategies)
      .where(sql`lower(${strategies.name}) = lower(${input.strategy_name})`);
    if (existingNames.length > 0) {
      // Find highest existing version
      const versionPattern = new RegExp(`^${input.strategy_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: v(\\d+))?$`, "i");
      const allVersions = await db
        .select({ name: strategies.name })
        .from(strategies)
        .where(sql`lower(${strategies.name}) LIKE lower(${input.strategy_name + "%"})`);
      let maxVersion = 1;
      for (const row of allVersions) {
        const match = row.name.match(versionPattern);
        if (match) maxVersion = Math.max(maxVersion, match[1] ? Number(match[1]) : 1);
      }
      finalName = `${input.strategy_name} v${maxVersion + 1}`;
      logger.info({ original: input.strategy_name, deduped: finalName }, "Strategy name deduplicated");
    }

    // 2. Insert strategy into DB
    // P2D (Wave 9, 2026-05-17): guard all insert sites with assertCrossValidatedSource
    assertCrossValidatedSource(input.source, [input.source, "agent-generated"]);
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: finalName,
        description: input.one_sentence,
        symbol: input.symbol,
        timeframe: input.timeframe,
        source: input.source,
        config: {
          python_code: input.python_code,
          params: input.params,
          source: input.source,
          one_sentence: input.one_sentence,
        },
        tags: [input.source, "agent-generated"],
      })
      .returning();

    const strategyId = strategy.id;

    // 2. Build backtest config with python_code path
    const backtestConfig = {
      strategy: {
        name: input.strategy_name,
        symbol: input.symbol,
        timeframe: input.timeframe,
        python_code: input.python_code,
        params: input.params,
        indicators: [],
        entry_long: "",
        entry_short: "",
        exit: "",
        stop_loss: { type: "atr" as const, multiplier: 2.0 },
        position_size: { type: "dynamic_atr" as const, target_risk_dollars: 500 },
      },
      start_date: input.start_date,
      end_date: input.end_date,
      mode: "walkforward" as const,
    };

    // 3. Run backtest (reuses existing Python bridge)
    const result = await runBacktest(strategyId, backtestConfig, undefined, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 4. Log to systemJournal (include graveyard warnings if any)
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.one_sentence,
      strategyCode: input.python_code,
      strategyParams: {
        ...input.params,
        ...(graveyardWarnings.length > 0 ? { graveyardWarnings } : {}),
      },
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 5. Audit log (Track A F-6: migrated to insertAuditRowSafe)
    await insertAuditRowSafe({
      action: "agent.run-strategy",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategy_name: input.strategy_name, source: input.source },
      result: {
        backtestId: result.id,
        status: result.status,
        tier,
        forge_score: forgeScore,
        graveyardWarnings: graveyardWarnings.length > 0 ? graveyardWarnings : undefined,
      },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
      correlationId: correlationId ?? null,
    });

    logger.info({ strategyId, backtestId: result.id, tier, graveyardWarnings: graveyardWarnings.length }, "Agent strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
      graveyardWarnings: graveyardWarnings.length > 0 ? graveyardWarnings : undefined,
    };
    } catch (err) {
      // C4: Capture top-level runStrategy failures to DLQ — they are otherwise
      // absorbed by the route layer's fire-and-forget .catch() with only a log.
      const errorMsg = err instanceof Error ? err.message : String(err);
      await captureToDLQ({
        operationType: "agent:run_strategy_failure",
        entityType: "strategy",
        errorMessage: errorMsg,
        metadata: {
          strategy_name: input.strategy_name,
          source: input.source,
          symbol: input.symbol,
          timeframe: input.timeframe,
        },
      }).catch((dlqErr) => logger.error({ dlqErr }, "DLQ capture failed (runStrategy)"));
      throw err;
    }
  }

  /**
   * M3 FIX — Run a strategy from a full StrategyDSL via the Python compiler.
   *
   * This is the canonical path for n8n + scout pipeline. The legacy runStrategy()
   * passes python_code which the engine never executes (it reads entry_long
   * strings instead). This method:
   *   1. POSTs the DSL to the Python compiler (validates + compiles to engine config)
   *   2. Persists the strategy with the compiled config
   *   3. Runs the backtest with proper entry_long/exit/indicators populated
   *
   * Replaces the broken pipeline path: scout → ollama python_code → empty engine config → no backtest.
   *
   * Pass 19: When source='graduated_bucket' and pipeline is PAUSED, the strategy
   * row is still inserted (lifecycle=CANDIDATE, tags=[cross-validated, pending-backtest-pause-gated])
   * but the backtest is skipped. This ensures cross-validated strategies always
   * reach the strategies table regardless of pipeline pause state. Only the
   * graduated_bucket path bypasses the pause gate; all other sources remain blocked.
   */
  async runStrategyFromDSL(
    dsl: Record<string, unknown>,
    options: { source: "ollama" | "openclaw" | "manual" | "graduated_bucket"; start_date?: string; end_date?: string; bucketId?: string } = { source: "openclaw" },
    context?: { correlationId?: string },
  ): Promise<{
    strategyId: string | null;
    backtestId: string | null;
    status: string;
    tier: string | null;
    forgeScore: number | null;
    skipped?: boolean;
    reason?: string;
    compileErrors?: string[];
    dslDiversityCheck?: import("./dsl-diversity-service.js").DslDiversityCheckResult;
  }> {
    const correlationId = context?.correlationId;

    // Pipeline pause guard — Pass 19 discipline:
    //   graduated_bucket source: INSERT row (lifecycle=CANDIDATE) but SKIP backtest.
    //   All other sources: return skipped as before (existing behavior preserved).
    const pipelineActive = await isPipelineActive();
    if (!pipelineActive) {
      if (options.source !== "graduated_bucket") {
        logger.info({ fn: "runStrategyFromDSL", strategyName: String(dsl.name ?? "unknown") }, "Skipped: pipeline paused");
        return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
      }
      // graduated_bucket path: proceed to compile + insert, but skip the backtest below.
      logger.info(
        { fn: "runStrategyFromDSL", strategyName: String(dsl.name ?? "unknown"), bucketId: options.bucketId },
        "Pipeline paused but source=graduated_bucket — inserting CANDIDATE row, skipping backtest",
      );
    }

    // ─── Wave 1: TypeScript-side mini-guard (defense-in-depth) ──────────────
    // The Python compiler's StrategyDSL.validate_mini_guard() Pydantic validator
    // is the authoritative gate. This TypeScript check runs FIRST as a fast-fail
    // so we never waste a Python subprocess on a symbol that is structurally
    // rejected. CONTRACT_SPECS in config.py uses micro point values for ES/NQ/CL —
    // flipping without contract_class='mini' causes silent 10x risk inflation.
    // Mini support is deferred until $200K+ funded balance (see CLAUDE.md §5).
    const _dslSymbol = String((dsl as any)?.strategy?.symbol ?? (dsl as any)?.symbol ?? "");
    const _dslContractClass = String((dsl as any)?.strategy?.contract_class ?? (dsl as any)?.contract_class ?? "micro");
    const _MINI_SYMBOLS_TS = new Set(["ES", "NQ", "CL"]);
    const _MICRO_SYMBOLS_TS = new Set(["MES", "MNQ", "MCL"]);
    if (_MINI_SYMBOLS_TS.has(_dslSymbol)) {
      const miniError = _dslContractClass !== "mini"
        ? `mini contracts (symbol="${_dslSymbol}") require contract_class="mini" AND mini specs migration (not yet shipped). Use MES/MNQ/MCL micros for now.`
        : `mini contracts (symbol="${_dslSymbol}", contract_class="mini") are not yet implemented. Mini support requires full CONTRACT_SPECS migration (deferred until $200K+ funded balance). Use MES/MNQ/MCL micros for now.`;
      logger.error({ symbol: _dslSymbol, contract_class: _dslContractClass, correlationId }, `runStrategyFromDSL: mini-guard rejected — ${miniError}`);
      await db.insert(auditLog).values({
        action: "strategy.compile_rejected",
        entityType: "strategy",
        input: { dsl_name: (dsl as any)?.name, symbol: _dslSymbol, contract_class: _dslContractClass, source: options.source },
        result: { errors: [miniError], gate: "mini_guard_ts" },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null,
      }).catch((auditErr) => {
        logger.warn({ err: auditErr }, "mini_guard audit insert failed (non-blocking)");
      });
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: [miniError] };
    }
    if (_MICRO_SYMBOLS_TS.has(_dslSymbol) && _dslContractClass === "mini") {
      const miniError = `micro symbol "${_dslSymbol}" cannot be paired with contract_class="mini". Use contract_class="micro" (the default) for MES/MNQ/MCL.`;
      logger.error({ symbol: _dslSymbol, contract_class: _dslContractClass, correlationId }, `runStrategyFromDSL: mini-guard rejected — ${miniError}`);
      await db.insert(auditLog).values({
        action: "strategy.compile_rejected",
        entityType: "strategy",
        input: { dsl_name: (dsl as any)?.name, symbol: _dslSymbol, contract_class: _dslContractClass, source: options.source },
        result: { errors: [miniError], gate: "mini_guard_ts" },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null,
      }).catch((auditErr) => {
        logger.warn({ err: auditErr }, "mini_guard audit insert failed (non-blocking)");
      });
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: [miniError] };
    }

    // 1. Compile DSL → backtest config via Python
    // Pass 19 Track D: full DSL sanitizer. Strips non-schema top-level fields
    // (critic_score, critic_source, anything else the critic/LLM injects) AND
    // cleans entry_params against pattern_library allowlists. Python compiler
    // uses pydantic extra='forbid' so any extra field rejects the whole DSL.
    let sanitizedDsl: any = dsl;
    try {
      const { sanitizeDsl } = await import("./dsl-sanitizer.js");
      const result = sanitizeDsl(dsl as Record<string, unknown>);
      sanitizedDsl = result.sanitizedDsl;
    } catch (sanitizerErr) {
      logger.warn({ err: sanitizerErr, dsl_name: (dsl as any)?.name }, "dsl-sanitizer: failed, falling through to raw DSL");
    }

    // ─── Layer 2: Pre-backtest auditor gate (FAIL-CLOSED) ──────────────────
    // Re-validate the DSL against the framework auditor BEFORE the heavy
    // Python compile + backtest. This catches drift from manual UI edits,
    // SQL mutations, or migrations that bypassed the graduator's Layer-1
    // audit. Audit defects → refuse to enqueue. No wasted compute.
    // Pass 21 (2026-05-12) — paired with direct-bucket-graduator.ts Layer 1.
    if (options.source === "graduated_bucket") {
      try {
        const { auditGraduatedConfig, formatAuditResult } = await import("./graduated-strategy-auditor.js");
        const auditInput = {
          conceptName: String((sanitizedDsl as any)?.metadata?.concept_name ?? (sanitizedDsl as any)?.name ?? ""),
          symbol: String((sanitizedDsl as any)?.strategy?.symbol ?? (sanitizedDsl as any)?.symbol ?? ""),
          config: sanitizedDsl,
        };
        const audit = auditGraduatedConfig(auditInput);
        if (!audit.passed) {
          logger.error(
            { dsl_name: (sanitizedDsl as any)?.name, defects: audit.defects, warnings: audit.warnings, correlationId },
            `runStrategyFromDSL: REJECTED by pre-backtest auditor — ${formatAuditResult(audit)}`,
          );
          await db.insert(auditLog).values({
            action: "backtest.rejected_by_auditor",
            entityType: "strategy",
            input: { dsl_name: (sanitizedDsl as any)?.name, source: options.source },
            result: { defects: audit.defects, warnings: audit.warnings },
            status: "failure",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          }).catch((auditErr) => logger.warn({ err: auditErr }, "audit_log write failed for pre-backtest reject"));
          return {
            strategyId: null, backtestId: null, status: "audit_rejected",
            tier: null, forgeScore: null,
            skipped: true,
            reason: `audit_defects: ${audit.defects.map((d) => d.code).join(",")}`,
          };
        }
      } catch (auditErr) {
        // FAIL-CLOSED: the Layer-2 auditor is a gate; if the gate itself throws
        // we CANNOT know whether the graduated config is safe, so we must REFUSE
        // the promotion rather than silently wave it through (which is what the
        // old log-and-continue did — a fail-OPEN that contradicted this block's
        // own "FAIL-CLOSED" header). Reject + audit row + Discord WARN.
        logger.error(
          { err: auditErr, dsl_name: (sanitizedDsl as any)?.name, correlationId },
          "Layer 2 auditor THREW — failing CLOSED: refusing graduated_bucket promotion (gate cannot certify safety)",
        );
        await db.insert(auditLog).values({
          action: "backtest.auditor_error_fail_closed",
          entityType: "strategy",
          input: { dsl_name: (sanitizedDsl as any)?.name, source: options.source },
          result: { error: auditErr instanceof Error ? auditErr.message : String(auditErr) },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: correlationId ?? null,
        }).catch((writeErr) => logger.warn({ err: writeErr }, "audit_log write failed for auditor-error fail-closed"));
        notifyWarning(
          "Layer-2 Auditor Error — Promotion BLOCKED (fail-closed)",
          appendFamilyGradePostscript(
            `graduated-strategy-auditor threw while auditing "${String((sanitizedDsl as any)?.name ?? "unknown")}". The Layer-2 audit gate failed CLOSED and REFUSED the promotion. Investigate the auditor — no audit certification means no promotion.`,
            "A safety check errored out while reviewing a new strategy, so the system refused to promote it (the safe choice).",
            "Nothing is at risk. Let Tony know so he can fix the checker and let the strategy try again.",
          ),
          { dsl_name: (sanitizedDsl as any)?.name, correlationId },
        );
        return {
          strategyId: null, backtestId: null, status: "audit_rejected",
          tier: null, forgeScore: null,
          skipped: true,
          reason: "auditor_threw_fail_closed",
        };
      }
    }

    let compiled: any;
    try {
      compiled = await runPythonModule({
        module: "src.engine.compiler.compiler",
        args: ["--action", "compile"],
        config: sanitizedDsl,
        componentName: "agent-runStrategyFromDSL-compile",
      });
    } catch (err: any) {
      const errors = Array.isArray(err?.errors) ? err.errors.map(String) : [err?.message ?? String(err)];
      logger.warn({ errors, dsl_name: dsl.name }, "runStrategyFromDSL: compile failed");
      await db.insert(auditLog).values({
        action: "strategy.compile_rejected",
        entityType: "strategy",
        input: { dsl_name: dsl.name, source: options.source },
        result: { errors },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null,
      }).catch((auditErr) => {
        logger.warn({ err: auditErr }, "compile_rejected audit insert failed (non-blocking)");
      });
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: errors };
    }
    if (!compiled || (typeof compiled === "object" && "error" in compiled)) {
      const errMsg = (compiled as any)?.error ?? "compiler returned no config";
      await db.insert(auditLog).values({
        action: "strategy.compile_rejected",
        entityType: "strategy",
        input: { dsl_name: dsl.name, source: options.source },
        result: { errors: [String(errMsg)] },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null,
      }).catch((auditErr) => {
        logger.warn({ err: auditErr }, "compile_rejected audit insert failed (non-blocking)");
      });
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors: [String(errMsg)] };
    }

    // Pass 19: check compiled.valid !== true (catches payloads where compiler
    // returned a result object but marked it invalid, e.g. config={valid:false,errors:[...]}).
    if (typeof compiled === "object" && compiled !== null && (compiled as any).valid === false) {
      const compileErrors: string[] = Array.isArray((compiled as any).errors)
        ? (compiled as any).errors.map(String)
        : ["compiled.valid=false"];
      logger.warn({ errors: compileErrors, dsl_name: dsl.name }, "runStrategyFromDSL: compile returned valid=false");
      await db.insert(auditLog).values({
        action: "strategy.compile_rejected",
        entityType: "strategy",
        input: { dsl_name: dsl.name, source: options.source },
        result: { errors: compileErrors, valid: false },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null,
      }).catch((auditErr) => {
        logger.warn({ err: auditErr }, "compile_rejected audit insert failed (non-blocking)");
      });
      return { strategyId: null, backtestId: null, status: "compile_failed", tier: null, forgeScore: null, compileErrors };
    }

    // 2. Graveyard gate on the DSL one-sentence
    const dslName = String(dsl.name ?? `dsl_${Date.now()}`);
    const dslDescription = String(dsl.description ?? dslName);
    const graveyardCheck = await this.graveyardGate.check(`${dslName}: ${dslDescription}`);
    if (graveyardCheck.blocked) {
      logger.info({ graveyardCheck, dslName }, "DSL strategy blocked by graveyard gate");
      return { strategyId: null, backtestId: null, status: "blocked", tier: null, forgeScore: null };
    }

    // 2a. C9: DSL diversity gate — pre-backtest template similarity check.
    // Catches LLM mode-collapse before it wastes backtest compute.
    // Defense-in-depth with A7 (post-backtest signal correlation):
    //   C9 catches identical DSL templates (pre-backtest).
    //   A7 catches different code that produces identical signals (post-backtest).
    // Fail-open on pipeline pause and DB errors (non-blocking to main flow).
    if (options.source === "ollama" || options.source === "openclaw") {
      try {
        const diversityCheck = await checkDslDiversity(dsl);
        if (!diversityCheck.passed) {
          logger.warn(
            {
              dslName,
              source: options.source,
              maxSimilarity: diversityCheck.maxSimilarity,
              mostSimilarStrategyId: diversityCheck.mostSimilarStrategyId,
              strategiesChecked: diversityCheck.strategiesChecked,
              reason: diversityCheck.reason,
            },
            "runStrategyFromDSL: DSL rejected by C9 diversity gate",
          );
          // Audit log for the candidate contract (fire-and-forget)
          auditDslDiversityRejection({
            dsl,
            checkResult: diversityCheck,
            source: options.source,
            correlationId: correlationId ?? null,
          }).catch(() => {});
          return {
            strategyId: null,
            backtestId: null,
            status: "blocked_dsl_diversity",
            tier: null,
            forgeScore: null,
            dslDiversityCheck: diversityCheck,
          };
        }
        logger.debug(
          { dslName, maxSimilarity: diversityCheck.maxSimilarity, strategiesChecked: diversityCheck.strategiesChecked },
          "C9: DSL diversity gate passed",
        );
      } catch (diversityErr) {
        // Fail-open: gate error never blocks the pipeline
        logger.warn({ err: diversityErr, dslName }, "C9: diversity gate threw — proceeding (fail-open)");
      }
    }

    // 3. Persist strategy with the COMPILED config (not python_code)
    // Pass 19: graduated_bucket path gets canonical source + cross-validated tags.
    // assertCrossValidatedSource is checked here for all non-graduated_bucket paths.
    const isGraduatedBucket = options.source === "graduated_bucket";
    assertCrossValidatedSource(options.source, isGraduatedBucket ? ["cross-validated"] : []);

    const symbol = String(dsl.symbol);
    const timeframe = String(dsl.timeframe);
    const strategyTags: string[] = isGraduatedBucket
      ? ["cross-validated", "dsl-compiled", "3-source-consensus"]
      : [options.source, "dsl-compiled"];
    const strategySource: string = isGraduatedBucket ? "graduated_bucket" : options.source;

    let finalConfig: Record<string, unknown> = compiled as Record<string, unknown>;
    try {
      const { applyFrameworkOverlay } = await import("./framework-overlay.js");
      const overlayed = applyFrameworkOverlay({
        compiled: compiled as any,
        source: strategySource as any,
        symbol: symbol as "MES" | "MNQ" | "MCL",
        bucketId: options.bucketId,
      });
      finalConfig = overlayed.config as Record<string, unknown>;
      if (overlayed.warnings.length > 0) {
        logger.warn({ warnings: overlayed.warnings, strategyName: dslName }, "framework-overlay flagged production-DSL issues");
      }
      // FIX 1 (2026-07-02): write overlay audit rows (e.g. graduation.exit_type_normalized)
      if (overlayed.overlayAuditRows && overlayed.overlayAuditRows.length > 0) {
        for (const auditEvent of overlayed.overlayAuditRows) {
          insertAuditRow({
            action: auditEvent.action,
            entityType: "strategy",
            entityId: null,
            input: { dsl_name: dslName, source: strategySource } as Record<string, unknown>,
            result: auditEvent.data as Record<string, unknown>,
            status: auditEvent.status as "warning" | "success" | "failure" | "rejected" | "accepted",
            decisionAuthority: "system",
          }).catch((auditErr) => logger.warn({ err: auditErr }, `overlay audit write failed for ${auditEvent.action}`));
        }
      }
    } catch (overlayErr) {
      logger.warn({ err: overlayErr, strategyName: dslName }, "framework-overlay failed — falling through to raw compiled config");
    }

    const [strategy] = await db
      .insert(strategies)
      .values({
        name: dslName,
        description: dslDescription,
        symbol,
        timeframe,
        source: strategySource,
        config: finalConfig,
        preferredRegime: (dsl.preferred_regime ?? null) as string | null,
        tags: strategyTags,
      })
      .returning();
    const strategyId = strategy.id;

    // 3a. C9: Persist DSL feature vector for future diversity checks (fire-and-forget).
    // Written AFTER strategy DB insert so the feature table only contains accepted candidates.
    // Failures are non-blocking — the strategy was already accepted and will be backtested.
    persistDslFeatureVector(strategyId, dsl).catch((err) =>
      // deepscan17: silent failure here silently drops this strategy from the C9 diversity
      // gate's future similarity checks (mode-collapse coverage gap) with no trace.
      logger.warn({ err, strategyId }, "persistDslFeatureVector failed — C9 diversity-gate coverage gap for this strategy"),
    );

    // Pass 19: When pipeline is paused AND source=graduated_bucket, skip backtest.
    // Insert audit row for the pause-gated CANDIDATE and return early.
    if (!pipelineActive && isGraduatedBucket) {
      await db.insert(auditLog).values({
        action: "strategy.created_pause_gated",
        entityType: "strategy",
        entityId: strategyId,
        input: { dsl_name: dslName, source: strategySource, symbol, timeframe, bucket_id: options.bucketId ?? null },
        result: { strategy_id: strategyId, source: "graduated_bucket", lifecycle_state: "CANDIDATE" },
        status: "success",
        decisionAuthority: "agent",
        correlationId: correlationId ?? null,
      });

      // Journal entry (no backtest yet)
      await db.insert(systemJournal).values({
        strategyId,
        backtestId: null,
        source: strategySource as any,
        generationPrompt: dslDescription,
        strategyParams: dsl as Record<string, unknown>,
        forgeScore: null,
        tier: null,
        status: "scouted",
      });

      logger.info({ strategyId, dslName, bucketId: options.bucketId }, "runStrategyFromDSL: pause-gated CANDIDATE inserted (graduated_bucket)");
      return {
        strategyId,
        backtestId: null,
        status: "pending_backtest_pause_gated",
        tier: null,
        forgeScore: null,
        skipped: false,
        reason: undefined,
      };
    }

    // 4. Run backtest with the compiled config
    const backtestConfig = {
      ...compiled,
      start_date: options.start_date,
      end_date: options.end_date,
      mode: "walkforward" as const,
    };
    const result = await runBacktest(strategyId, backtestConfig, undefined, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 5. Journal entry
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: strategySource as any,
      generationPrompt: dslDescription,
      strategyParams: dsl as Record<string, unknown>,
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 6. Audit log
    await db.insert(auditLog).values({
      action: "agent.run-strategy-from-dsl",
      entityType: "strategy",
      entityId: strategyId,
      input: { dsl_name: dslName, source: strategySource, symbol, timeframe, bucket_id: options.bucketId ?? null },
      result: { backtestId: result.id, status: result.status, tier, forge_score: forgeScore },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
      correlationId: correlationId ?? null,
    });

    logger.info({ strategyId, backtestId: result.id, tier, dslName }, "runStrategyFromDSL complete");

    return { strategyId, backtestId: result.id, status: result.status, tier: tier ?? null, forgeScore: forgeScore ?? null };
  }

  async runClassStrategy(input: {
    strategy_name: string;
    strategy_class: string;
    symbol: string;
    timeframe: string;
    start_date?: string;
    end_date?: string;
    source: "manual" | "ollama" | "openclaw";
    description: string;
    params: Record<string, unknown>;
  }, context?: { correlationId?: string }) {
    const correlationId = context?.correlationId;
    try {
    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block class-based strategy run when pipeline is PAUSED/VACATION.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "runClassStrategy", strategyName: input.strategy_name, strategyClass: input.strategy_class },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", strategyId: null, backtestId: null, status: "skipped", tier: null, forgeScore: null };
    }

    // 1. Insert strategy into DB
    // P2D (Wave 9, 2026-05-17): guard insert site
    assertCrossValidatedSource(input.source, [input.source, "class-based"]);
    const [strategy] = await db
      .insert(strategies)
      .values({
        name: input.strategy_name,
        description: input.description,
        symbol: input.symbol,
        timeframe: input.timeframe,
        config: {
          strategy_class: input.strategy_class,
          params: input.params,
          source: input.source,
        },
        tags: [input.source, "class-based"],
      })
      .returning();

    const strategyId = strategy.id;

    // 2. Build minimal config (class-based path only needs dates + fees)
    const backtestConfig = {
      strategy: {
        name: input.strategy_name,
        symbol: input.symbol,
        timeframe: input.timeframe,
        indicators: [],
        entry_long: "",
        entry_short: "",
        exit: "",
        stop_loss: { type: "atr" as const, multiplier: 2.0 },
        position_size: { type: "dynamic_atr" as const, target_risk_dollars: 500 },
      },
      start_date: input.start_date,
      end_date: input.end_date,
      mode: "walkforward" as const,
    };

    // 3. Run backtest with strategy class path
    const result = await runBacktest(strategyId, backtestConfig, input.strategy_class, undefined, correlationId);

    const tier = "tier" in result ? result.tier : null;
    const forgeScore = "forge_score" in result ? result.forge_score : null;

    // 4. Log to systemJournal
    await db.insert(systemJournal).values({
      strategyId,
      backtestId: result.id,
      source: input.source,
      generationPrompt: input.description,
      strategyParams: input.params,
      forgeScore: forgeScore != null ? String(forgeScore) : null,
      tier: tier ?? null,
      status: result.status === "completed" ? "tested" : "failed",
    });

    // 5. Audit log
    await db.insert(auditLog).values({
      action: "agent.run-class-strategy",
      entityType: "strategy",
      entityId: strategyId,
      input: { strategy_name: input.strategy_name, strategy_class: input.strategy_class, source: input.source },
      result: {
        backtestId: result.id,
        status: result.status,
        tier,
        forge_score: forgeScore,
      },
      status: result.status === "completed" ? "success" : "failure",
      decisionAuthority: "agent",
      errorMessage: result.status !== "completed" ? (result as any).error ?? "backtest failed" : undefined,
      correlationId: correlationId ?? null,
    });

    logger.info({ strategyId, backtestId: result.id, tier, strategyClass: input.strategy_class }, "Class strategy run complete");

    return {
      strategyId,
      backtestId: result.id,
      status: result.status,
      tier,
      forgeScore,
    };
    } catch (err) {
      // C4: Capture top-level runClassStrategy failures to DLQ — they are otherwise
      // absorbed by the route layer's fire-and-forget .catch() with only a log.
      const errorMsg = err instanceof Error ? err.message : String(err);
      await captureToDLQ({
        operationType: "agent:run_class_strategy_failure",
        entityType: "strategy",
        errorMessage: errorMsg,
        metadata: {
          strategy_name: input.strategy_name,
          strategy_class: input.strategy_class,
          source: input.source,
          symbol: input.symbol,
          timeframe: input.timeframe,
        },
      }).catch((dlqErr) => logger.error({ dlqErr }, "DLQ capture failed (runClassStrategy)"));
      throw err;
    }
  }

  async critiqueResults(input: CritiqueInput) {
    const model = input.model ?? "fast";
    let metricsText: string;

    if (input.results) {
      metricsText = JSON.stringify(input.results, null, 2);
    } else if (input.backtestId) {
      const [bt] = await db.select().from(backtests).where(eq(backtests.id, input.backtestId));
      if (!bt) throw new Error(`Backtest ${input.backtestId} not found`);
      metricsText = JSON.stringify({
        sharpeRatio: bt.sharpeRatio,
        profitFactor: bt.profitFactor,
        winRate: bt.winRate,
        maxDrawdown: bt.maxDrawdown,
        avgDailyPnl: bt.avgDailyPnl,
        totalTrades: bt.totalTrades,
        totalReturn: bt.totalReturn,
        tier: bt.tier,
        forgeScore: bt.forgeScore,
      }, null, 2);
    } else {
      throw new Error("Either backtestId or results must be provided");
    }

    const prompt = `You are a quantitative analyst reviewing backtest results for a futures trading strategy.

RESULTS:
${metricsText}

SCORING CRITERIA:
- Avg daily P&L >= $250, Win rate >= 60%, Profit factor >= 1.75
- Max drawdown <= $2,000 (Topstep 50K limit)
- Sharpe ratio >= 1.5

Respond in strict JSON:
{
  "strengths": ["string", ...],
  "weaknesses": ["string", ...],
  "suggestions": ["string", ...],
  "overall_assessment": "string"
}`;

    let critique: { strengths: string[]; weaknesses: string[]; suggestions: string[]; overall_assessment: string };

    // Try cloud model first (GPT-5-mini for critic evaluation)
    const cloudResult = await callOpenAI("critic_evaluator", [
      { role: "user", content: prompt }
    ]);

    if (cloudResult) {
      // Parse cloud response
      try {
        critique = JSON.parse(cloudResult);
      } catch {
        critique = { strengths: [], weaknesses: [], suggestions: [], overall_assessment: cloudResult };
      }
    } else {
      // Fallback to Ollama
      const response = await this.ollama.generate(model, prompt, undefined, true);
      try {
        critique = JSON.parse(response.response);
      } catch {
        critique = {
          strengths: [],
          weaknesses: [],
          suggestions: [],
          overall_assessment: response.response,
        };
      }
    }

    if (input.backtestId) {
      await db
        .update(systemJournal)
        .set({ analystNotes: JSON.stringify(critique) })
        .where(eq(systemJournal.backtestId, input.backtestId));
    }

    return { critique };
  }

  async batchSubmit(strategyInputs: RunStrategyInput[]) {
    if (strategyInputs.length > 20) {
      throw new Error("Maximum 20 strategies per batch");
    }

    // ─── Pipeline pause guard ─────────────────────────────────────
    // Block the whole batch when pipeline is PAUSED/VACATION. Individual
    // runStrategy() calls also guard, but failing fast here avoids the
    // per-strategy DB writes a no-op batch would otherwise produce.
    if (!(await isPipelineActive())) {
      logger.info(
        { fn: "batchSubmit", count: strategyInputs.length },
        "Skipped: pipeline paused",
      );
      return { skipped: true, reason: "pipeline_paused", count: 0, results: [] };
    }

    const results: Array<{ strategy_name: string; status: string; strategyId?: string | null; backtestId?: string | null; error?: string }> = [];

    for (const input of strategyInputs) {
      try {
        const result = await this.runStrategy(input);
        results.push({
          strategy_name: input.strategy_name,
          status: result.status,
          strategyId: result.strategyId,
          backtestId: result.backtestId,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({
          strategy_name: input.strategy_name,
          status: "failed",
          error: errorMsg,
        });
        // Capture individual batch strategy failures to DLQ — they are otherwise absorbed silently
        captureToDLQ({
          operationType: "agent:batch_strategy_failure",
          entityType: "strategy",
          errorMessage: errorMsg,
          metadata: {
            strategy_name: input.strategy_name,
            source: input.source,
            symbol: input.symbol,
          },
        }).catch((dlqErr) => {
          logger.warn({ err: dlqErr, strategy_name: input.strategy_name }, "Failed to capture batch failure to DLQ");
        });
      }
    }

    return { count: results.length, results };
  }

  async scoutIdeas(ideas: ScoutIdea[], context?: { correlationId?: string }) {
    const correlationId = context?.correlationId ?? randomUUID();
    const receivedCount = ideas.length;

    // ─── Pass 4 Phase -2: Tier-1 regex pre-filter ────────────────────
    // Cheap, deterministic substance check BEFORE injection sanitize. Reject
    // placeholder titles, too-short descriptions, auto-slug concept_names,
    // and "see source for…" entry_rules. Each rejected idea writes an
    // audit_log row (action=scout.rejected_regex). Fire-and-forget audit
    // writes — never block the pipeline for an audit-write error.
    const tier1Survivors: ScoutIdea[] = [];
    let tier1RejectedCount = 0;
    for (const idea of ideas) {
      const decision = tier1RegexFilter(idea);
      if (decision.accept) {
        tier1Survivors.push(idea);
        continue;
      }
      tier1RejectedCount++;
      insertAuditRow({
          action: "scout.rejected_regex",
          entityType: "scout_idea",
          input: {
            title: idea.title,
            url: idea.url,
            source: idea.source,
            signal_type: idea.signal_type ?? "strategy_candidate",
          },
          result: { reason: decision.reason },
          status: "success",
          decisionAuthority: "gate",
          correlationId,
        })
        .catch((err) => logger.warn({ err }, "scout.rejected_regex audit write failed"));
      trackRejectAndMaybeBroadcast("scout.rejected_regex");
    }
    if (tier1RejectedCount > 0) {
      logger.info(
        { receivedCount, tier1Rejected: tier1RejectedCount, survivors: tier1Survivors.length },
        "scoutIdeas: Tier-1 regex filter complete",
      );
    }
    ideas = tier1Survivors;

    // C3: Phase -1: Prompt injection sanitization on all incoming external content
    // Each idea arrives from an untrusted source (Reddit, Brave, Tavily, YouTube, etc.)
    // Sanitize title+description before they touch any LLM prompt.
    const sanitizedIdeas: ScoutIdea[] = [];
    let totalInjectionBlocks = 0;
    for (const idea of ideas) {
      const combined = `${idea.title ?? ""} ${idea.description ?? ""} ${idea.summary ?? ""}`;
      const sanitizeResult = await sanitizeExternalContent(combined, {
        source: idea.source ?? "unknown",
        sourceUrl: idea.url,
      });

      if (sanitizeResult.blocked) {
        // High/critical injection detected — log and skip this idea entirely
        totalInjectionBlocks++;
        logger.warn(
          {
            source: idea.source,
            url: idea.url,
            detectionCount: sanitizeResult.detections.length,
            types: sanitizeResult.detections.map((d) => d.type),
          },
          "scoutIdeas: idea blocked by injection sanitizer",
        );
        continue;
      }

      // Replace description with sanitized version if content was modified
      if (sanitizeResult.wasModified) {
        // Re-split the sanitized combined back into description (we lose the split
        // boundary, so use the sanitized combined as the description — the title
        // is re-derived by preprocessing below). This is safe because the
        // preprocessing step below re-strips and re-derives the clean title.
        sanitizedIdeas.push({
          ...idea,
          description: sanitizeResult.sanitized,
        });
      } else {
        sanitizedIdeas.push(idea);
      }
    }

    if (totalInjectionBlocks > 0) {
      logger.info(
        { receivedCount, blocked: totalInjectionBlocks, remaining: sanitizedIdeas.length },
        "scoutIdeas: injection sanitization complete",
      );
    }

    // Replace ideas with sanitized set for all downstream processing
    ideas = sanitizedIdeas;

    // Phase 0: Preprocessing — filter, clean, extract metadata
    const htmlEntityMap: Record<string, string> = {
      "&amp;": "&", "&lt;": "<", "&gt;": ">",
      "&quot;": '"', "&#39;": "'", "&apos;": "'",
      "&#x2F;": "/", "&#x27;": "'",
    };
    const stripHtmlEntities = (s: string) =>
      s.replace(/&[#\w]+;/g, (match) => htmlEntityMap[match] || match);

    const titleSuffixPattern = /\s*[-|]\s*(Reddit|YouTube|TradingView)|\[[^\]]*\]/gi;
    const instrumentPattern = /(MES|MNQ|MCL|ES|NQ|CL)\b/gi;
    const indicatorPattern = /(VWAP|RSI|SMA|EMA|MACD|ATR|Bollinger|ORB|Order Block|FVG|ICT|SMC)\b/gi;

    ideas = ideas
      .filter((idea) => (idea.confidence_score ?? 1) >= 0.3)
      .map((idea) => {
        // Strip HTML entities
        const title = stripHtmlEntities(idea.title || "");
        const rawDescription = stripHtmlEntities(idea.description || "");

        // Clean title suffixes
        const cleanTitle = title.replace(titleSuffixPattern, "").trim();

        // Empty description fallback
        const description = rawDescription || idea.summary || cleanTitle || "No description";

        // Extract instruments from title + description (only if not already populated)
        const combined = `${cleanTitle} ${description}`;
        let instruments = idea.instruments;
        if (!instruments || instruments.length === 0) {
          const instrumentMatches = combined.match(instrumentPattern) || [];
          const extracted = [
            ...new Set(instrumentMatches.map((m) => m.toUpperCase())),
          ];
          if (extracted.length > 0) instruments = extracted;
        }

        // Extract indicators from title + description (only if not already populated)
        let indicators_mentioned = idea.indicators_mentioned;
        if (!indicators_mentioned || indicators_mentioned.length === 0) {
          const indicatorMatches = combined.match(indicatorPattern) || [];
          const extracted = [...new Set(indicatorMatches)];
          if (extracted.length > 0) indicators_mentioned = extracted;
        }

        return {
          ...idea,
          title: cleanTitle,
          description,
          instruments,
          indicators_mentioned,
        };
      });

    // Phase 1: Batch-level dedup (in-memory)
    const seen = new Set<string>();
    const batchDeduped: Array<ScoutIdea & { title_hash: string }> = [];
    let batchDuplicateCount = 0;

    for (const idea of ideas) {
      const hash = createHash("sha256")
        .update(idea.title + idea.description)
        .digest("hex");

      if (seen.has(hash)) {
        batchDuplicateCount++;
        continue;
      }
      seen.add(hash);
      batchDeduped.push({ ...idea, title_hash: hash });
    }

    // Phase 2: Cross-time dedup — check system_journal for existing scouted entries
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const existingEntries = await db
      .select({
        titleHash: sql<string>`strategy_params->>'title_hash'`,
        url: sql<string>`strategy_params->>'url'`,
      })
      .from(systemJournal)
      .where(
        and(
          eq(systemJournal.status, "scouted"),
          gte(systemJournal.createdAt, thirtyDaysAgo),
        )
      );

    const existingHashes = new Set(existingEntries.map((e) => e.titleHash).filter(Boolean));
    const existingUrls = new Set(existingEntries.map((e) => e.url).filter(Boolean));

    const newIdeas: Array<ScoutIdea & { title_hash: string }> = [];
    let crossTimeDuplicateCount = 0;

    for (const idea of batchDeduped) {
      if (existingHashes.has(idea.title_hash)) {
        crossTimeDuplicateCount++;
        continue;
      }
      if (idea.url && existingUrls.has(idea.url)) {
        crossTimeDuplicateCount++;
        continue;
      }
      newIdeas.push(idea);
    }

    // Phase 3: Tier-2 LLM auditor + premium pre-format + insert
    const ideaIds: string[] = [];
    let tier2RejectedCount = 0;

    for (const idea of newIdeas) {
      // Tier-2: GPT-5-mini scout_auditor (fail-OPEN on error)
      const tier2 = await tier2AuditorFilter({
        title: idea.title,
        description: idea.description,
        url: idea.url,
        source: idea.source,
        signal_type: idea.signal_type,
      });

      if (!tier2.accept) {
        tier2RejectedCount++;
        await db
          .insert(auditLog)
          .values({
            action: "scout.rejected_auditor",
            entityType: "scout_idea",
            input: {
              title: idea.title,
              url: idea.url,
              source: idea.source,
              signal_type: idea.signal_type ?? "strategy_candidate",
            },
            result: { score: tier2.score, reason: tier2.reason, source: tier2.source },
            status: "success",
            decisionAuthority: "gate",
          })
          .catch((err) => logger.warn({ err }, "scout.rejected_auditor audit write failed"));
        trackRejectAndMaybeBroadcast("scout.rejected_auditor");
        continue;
      }

      // Successful audit (or fail-open) — log for traceability.
      await db
        .insert(auditLog)
        .values({
          action: "scout.audited",
          entityType: "scout_idea",
          input: { title: idea.title, url: idea.url, source: idea.source },
          result: { score: tier2.score, reason: tier2.reason, source: tier2.source },
          status: "success",
          decisionAuthority: "gate",
        })
        .catch((err) => logger.warn({ err }, "scout.audited audit write failed"));

      // Premium pre-format: cleanedTitle + cleaned_lead. Raw fields preserved
      // so a future audit/debug session can replay the original content.
      const cleanedTitle = stripMarkdown(idea.title);
      const cleanedLead = generateOneSentenceLead(idea.description);

      const [entry] = await db
        .insert(systemJournal)
        .values({
          source: idea.source,
          generationPrompt: idea.summary ?? idea.description,
          strategyCode: null,
          strategyParams: {
            title: cleanedTitle,
            raw_title: idea.title,
            cleaned_lead: cleanedLead,
            raw_description: idea.description,
            url: idea.url,
            title_hash: idea.title_hash,
            source_quality: idea.source_quality,
            confidence_score: idea.confidence_score,
            instruments: idea.instruments,
            indicators_mentioned: idea.indicators_mentioned,
            signal_type: idea.signal_type ?? "strategy_candidate",
            auditor_score: tier2.score,
          },
          status: "scouted",
        })
        .returning();
      ideaIds.push(entry.id);
    }

    if (tier2RejectedCount > 0) {
      logger.info(
        { rejected: tier2RejectedCount, accepted: ideaIds.length },
        "scoutIdeas: Tier-2 auditor filter complete",
      );
    }

    return {
      received: receivedCount,
      new_count: ideaIds.length,
      batch_duplicate_count: batchDuplicateCount,
      cross_time_duplicate_count: crossTimeDuplicateCount,
      tier1_rejected: tier1RejectedCount,
      tier2_rejected: tier2RejectedCount,
      idea_ids: ideaIds,
    };
  }

  /**
   * Query recent journal entries for failure patterns to inject into strategy generation.
   * Returns an "AVOID" list derived from analyst critiques of recent failures.
   * Called by n8n before generating new strategies so the system learns from past mistakes.
   */
  async getFailurePatterns(days = 30, limit = 50): Promise<{
    avoidPatterns: string[];
    recentFailures: number;
    recentSuccesses: number;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Fetch recent journal entries that have analyst notes
    const entries = await db
      .select({
        tier: systemJournal.tier,
        status: systemJournal.status,
        analystNotes: systemJournal.analystNotes,
        forgeScore: systemJournal.forgeScore,
        source: systemJournal.source,
        generationPrompt: systemJournal.generationPrompt,
      })
      .from(systemJournal)
      .where(
        and(
          gte(systemJournal.createdAt, cutoff),
          sql`${systemJournal.analystNotes} IS NOT NULL`,
        ),
      )
      .orderBy(desc(systemJournal.createdAt))
      .limit(limit);

    const avoidPatterns: string[] = [];
    let recentFailures = 0;
    let recentSuccesses = 0;

    for (const entry of entries) {
      const isFailure = entry.tier === "REJECTED" || entry.status === "failed";
      if (isFailure) recentFailures++;
      else recentSuccesses++;

      if (!isFailure || !entry.analystNotes) continue;

      // Extract weaknesses and suggestions from analyst critique
      try {
        const critique = JSON.parse(entry.analystNotes);
        if (Array.isArray(critique.weaknesses)) {
          for (const w of critique.weaknesses) {
            if (typeof w === "string" && w.length > 10) {
              avoidPatterns.push(w);
            }
          }
        }
        if (Array.isArray(critique.suggestions)) {
          for (const s of critique.suggestions) {
            if (typeof s === "string" && s.length > 10) {
              avoidPatterns.push(s);
            }
          }
        }
      } catch {
        // analystNotes might be plain text — use directly
        if (entry.analystNotes.length > 20) {
          avoidPatterns.push(entry.analystNotes);
        }
      }
    }

    // Deduplicate and limit to most relevant patterns
    const unique = [...new Set(avoidPatterns)].slice(0, 20);

    logger.info({
      patterns: unique.length,
      recentFailures,
      recentSuccesses,
    }, "Failure patterns extracted for strategy generation");

    return {
      avoidPatterns: unique,
      recentFailures,
      recentSuccesses,
    };
  }

  /**
   * Drain scouted-but-unbacktested ideas from system_journal after a pause/vacation lift.
   *
   * Triggered by the scheduler's `pipeline-resume-drain` job when it detects a
   * transition from PAUSED/VACATION → ACTIVE. Walks scouted ideas (oldest first)
   * and converts each into a strategy via Ollama → runStrategy(), the same path
   * n8n's `8A-idea-to-strategy` workflow uses.
   *
   * Rate limit: max `limit` per call (default 100). Caller is responsible for
   * batching across multiple ticks if backlog exceeds the cap.
   *
   * Returns drain stats so the scheduler can write an audit row.
   */
  async drainScoutedIdeas(limit = 100, overrideOptions?: { source?: "ollama" | "openclaw" | "manual" | "graduated_bucket"; bucketId?: string }, context?: { correlationId?: string }): Promise<{
    scanned: number;
    drained: number;
    failed: number;
    errors: string[];
  }> {
    // Generate one correlationId per drain tick. All audit rows within this drain
    // share this ID so a single sweep is one linkable trace in audit_log.
    const drainCorrelationId = context?.correlationId ?? randomUUID();
    // Don't drain if pipeline isn't active — UNLESS this is a graduated_bucket
    // drain (Pass 19: graduated strategies must flow into the table even when
    // the pipeline is paused; backtest will be skipped).
    const isGraduatedDrain = overrideOptions?.source === "graduated_bucket";
    if (!isGraduatedDrain && !(await isPipelineActive())) {
      logger.info({ fn: "drainScoutedIdeas" }, "Skipped: pipeline not ACTIVE");
      return { scanned: 0, drained: 0, failed: 0, errors: ["pipeline_not_active"] };
    }

    // Find scouted-but-unbacktested ideas (no strategyId yet).
    // Pass 4 — skip market_news_intel rows; they don't become strategies.
    // Backward compat: rows without signal_type (pre-Pass-4 inserts) are
    // treated as strategy_candidate via the OR-NULL clause.
    const scouted = await db
      .select()
      .from(systemJournal)
      .where(
        and(
          eq(systemJournal.status, "scouted"),
          isNull(systemJournal.strategyId),
          or(
            sql`${systemJournal.strategyParams}->>'signal_type' = 'strategy_candidate'`,
            sql`${systemJournal.strategyParams}->>'signal_type' IS NULL`,
          ),
        ),
      )
      .orderBy(systemJournal.createdAt)
      .limit(limit);

    if (scouted.length === 0) {
      return { scanned: 0, drained: 0, failed: 0, errors: [] };
    }

    logger.info({ count: scouted.length, limit }, "Pipeline-resume drain: starting scouted-idea drain");

    // Fetch the active strategy_proposer prompt version ONCE per drain run.
    // Every strategy generated in this batch is stamped with this version ID on
    // its system_journal row so the A/B comparator can attribute by real prompt
    // instead of the old hashToVariant() coin-flip.  Fail-safe: null if no
    // versioned prompt is active or on DB error — never blocks generation.
    const generationPromptVersionId = await getActiveVersionIdForGeneration("strategy_proposer");

    let drained = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of scouted) {
      // Re-check pause flag every iteration — operator may pause again mid-drain.
      // Exception: graduated_bucket drains always proceed (strategies insert even when paused).
      if (!isGraduatedDrain && !(await isPipelineActive())) {
        logger.info({ fn: "drainScoutedIdeas", processed: drained }, "Pipeline paused mid-drain — stopping");
        break;
      }

      const params = (entry.strategyParams as Record<string, unknown> | null) ?? {};
      const title = String(params.title ?? "untitled");
      const description = entry.generationPrompt ?? title;

      try {
        // M3+M4+M5 fix — generate canonical StrategyDSL (not python_code) and route
        // through runStrategyFromDSL → Python compiler → real backtest config.
        // Old prompt asked for python_code which the engine never executed.
        const prompt = `You are a quantitative trading strategy architect. Convert this trading idea into a Trading Forge StrategyDSL.

Trading Idea:
Title: ${title}
Description: ${String(description).slice(0, 500)}
Source: ${entry.source ?? "unknown"}

Output ONLY a JSON object matching this StrategyDSL schema. No markdown fences, no prose.

REQUIRED FIELDS:
- name (string, snake_case, 3-100 chars)
- description (string, 10-500 chars, one-sentence edge thesis)
- symbol (one of: "MES", "MNQ", "MCL")
- timeframe (one of: "1m", "5m", "15m", "30m", "1h", "4h", "1d")
- direction (one of: "long", "short", "both")
- entry_type (one of: "breakout", "mean_reversion", "trend_follow", "volatility_expansion", "session_pattern")
- entry_indicator (one of these supported patterns):
    sma_crossover, ema_crossover, rsi_reversal, bollinger_breakout, atr_breakout,
    vwap_reversion, donchian_breakout, keltner_squeeze, session_open_breakout, macd_crossover
- entry_params (object, max 5 numeric keys, valid for the chosen entry_indicator)
- entry_condition (string, plain English entry rule)
- exit_type (one of: "fixed_target", "trailing_stop", "time_exit", "indicator_signal", "atr_multiple")
- exit_params (object)
- stop_loss_atr_multiple (number, 0.5 to 5.0)

OPTIONAL FIELDS:
- take_profit_atr_multiple (number, 1.0 to 10.0)
- preferred_regime (one of: "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "HIGH_VOL", "LOW_VOL")
- session_filter (one of: "RTH_ONLY", "ETH_ONLY", "ALL_SESSIONS", "LONDON", "ASIA")
- max_contracts (integer, 1-20)

Rules:
- max 5 entry_params
- stop_loss_atr_multiple < take_profit_atr_multiple
- Match entry_type to entry_indicator logically
- Output ONLY the JSON object`;

        // Pass 4 — route through model-router strategy_proposer role.
        // GPT-5-mini primary, Ollama gemma4:e4b-it-qat deterministic fallback
        // (configured in MODEL_CONFIGS.strategy_proposer.fallback). The new
        // strategy-proposer.md prompt allows refusal output:
        //   {reject: true, reason: "insufficient_signal", missing: [...]}
        // — handled below before any DSL parsing/compile attempt.
        let proposerResponse = await callOpenAI(
          "strategy_proposer",
          [{ role: "user", content: prompt }],
          { signalType: "strategy_candidate" },
        );

        // Cloud unavailable / circuit open → fallback to Ollama deterministically.
        if (!proposerResponse) {
          const ollamaResp = await this.ollama.generate("gemma4:e4b-it-qat", prompt, undefined, true);
          proposerResponse = ollamaResp.response;
        }

        // C3: Output validation — check raw LLM response for out-of-band content
        // before parsing. A compromised LLM response might echo injected instructions.
        const rawValidation = validateRawLLMResponse(proposerResponse);
        if (!rawValidation.passed) {
          failed++;
          const detectionTypes = rawValidation.detections.map((d) => d.name).join(",");
          errors.push(`${entry.id}: LLM output failed out-of-band check (${detectionTypes})`);
          logger.warn(
            { entryId: entry.id, detections: rawValidation.detections.length, detectionTypes },
            "drainScoutedIdeas: LLM response rejected by output validator",
          );
          continue;
        }

        let dsl: Record<string, unknown>;
        try {
          dsl = JSON.parse(proposerResponse);
        } catch {
          failed++;
          errors.push(`${entry.id}: invalid JSON from strategy_proposer`);
          continue;
        }

        // Pass 4 — refusal contract handling. Synthesizer is allowed to return
        // {reject: true, reason, missing} when the research-find is too vague
        // to extract a DSL from. Mark the journal row failed; do NOT try to
        // compile a refused DSL.
        if (dsl.reject === true) {
          failed++;
          const reason = String(dsl.reason ?? "unspecified");
          const missing = Array.isArray(dsl.missing) ? (dsl.missing as unknown[]).map(String) : [];
          const errMsg = `Synthesizer refused: ${reason}; missing: ${missing.join(",")}`;
          errors.push(`${entry.id}: ${errMsg}`);
          await db
            .update(systemJournal)
            .set({
              status: "failed",
              // system_journal has no errorMessage column — store refusal
              // reason in analystNotes (existing free-form field).
              analystNotes: errMsg,
            })
            .where(eq(systemJournal.id, entry.id));
          // Pass 7 — emit stable audit_log action so /api/scout/health and
          // future ops dashboards can count synthesizer refusals alongside
          // other reject paths (regex, auditor, compile, critic).
          await db
            .insert(auditLog)
            .values({
              action: "scout.synthesizer_refused",
              entityType: "system_journal",
              entityId: entry.id,
              input: { title, source: entry.source ?? null } as Record<string, unknown>,
              result: { reason, missing } as Record<string, unknown>,
              status: "rejected",
              decisionAuthority: "gate",
            })
            .catch((err) => logger.warn({ err, entryId: entry.id }, "scout.synthesizer_refused audit write failed"));
          trackRejectAndMaybeBroadcast("scout.synthesizer_refused");
          continue;
        }

        // Pass 7 Task 1 — DSL compile round-trip (validate-only via dsl_compiler).
        // Catches semantically-broken DSL (wrong enum values, indicator/param
        // mismatch) BEFORE we hit the heavyweight runStrategyFromDSL path.
        // Runs as `python -m src.engine.compiler.compiler --action validate`
        // with the candidate DSL passed as the temp config file. Output:
        // {valid: bool, errors: string[], compiled: {...}|null}. Fail-CLOSED
        // on compile failure (reject + audit row), fail-OPEN on subprocess
        // exception (logged, proceed to critic — better noisy DSL than silent
        // pipeline stall on infra issues).
        let compileFailed = false;
        let compileErrorDetail = "";
        // Pass 19 Track D: full DSL sanitizer (top-level + entry_params).
        let dslForCompile: any = dsl;
        try {
          const { sanitizeDsl } = await import("./dsl-sanitizer.js");
          const result = sanitizeDsl(dsl as Record<string, unknown>);
          dslForCompile = result.sanitizedDsl;
        } catch (sanitizerErr) {
          logger.warn({ err: sanitizerErr, entryId: entry.id }, "dsl-sanitizer: failed in drain path, falling through to raw DSL");
        }
        try {
          const compileResult = await runPythonModule<{
            valid?: boolean;
            errors?: string[];
            compiled?: unknown;
            error?: string;
          }>({
            module: "src.engine.compiler.compiler",
            args: ["--action", "validate"],
            config: dslForCompile,
            timeoutMs: 5_000,
            componentName: "dsl-compile-dryrun",
          });
          if (compileResult?.valid !== true) {
            compileFailed = true;
            compileErrorDetail = (compileResult?.errors ?? [compileResult?.error ?? "unknown"])
              .filter(Boolean)
              .join("; ")
              .slice(0, 500);
          }
        } catch (err) {
          // Subprocess error — fail-OPEN (don't block on infra hiccup) but log.
          logger.warn(
            { err, entryId: entry.id },
            "drainScoutedIdeas: dsl_compile dry-run threw — failing open to critic",
          );
        }

        if (compileFailed) {
          failed++;
          const errMsg = `DSL compile failed: ${compileErrorDetail}`;
          errors.push(`${entry.id}: ${errMsg}`);
          await db
            .update(systemJournal)
            .set({ status: "failed", analystNotes: errMsg })
            .where(eq(systemJournal.id, entry.id));
          await insertAuditRow({
              action: "scout.rejected_compile",
              entityType: "system_journal",
              entityId: entry.id,
              input: { dsl } as Record<string, unknown>,
              result: { compileError: compileErrorDetail } as Record<string, unknown>,
              status: "rejected",
              decisionAuthority: "gate",
              correlationId: drainCorrelationId,
            })
            .catch((err) => logger.warn({ err, entryId: entry.id }, "scout.rejected_compile audit write failed"));
          trackRejectAndMaybeBroadcast("scout.rejected_compile");
          continue;
        }

        // Pass 7 Task 2 — DSL Quality Critic (GPT-5-mini scout role).
        // Runs after compile passes; before journal final-state / strategy
        // insert. Fail-OPEN on parse error / budget exhaustion / LLM throw —
        // better to ship a noisy DSL than silently lose synthesis output.
        const criticAccept = await runDslQualityCritic(
          { dsl, sourceFind: { title, source: entry.source ?? null, description } },
          entry.id,
        );
        if (!criticAccept.accept) {
          failed++;
          const concernsField = (criticAccept.concerns ?? [])
            .map((c) => (typeof c === "string" ? c : (c?.field ?? JSON.stringify(c))))
            .join(", ")
            .slice(0, 200);
          const errMsg = `Quality critic rejected (score=${criticAccept.score}): ${(criticAccept.reasoning ?? "").slice(0, 300)}; concerns: ${concernsField}`;
          errors.push(`${entry.id}: ${errMsg}`);
          await db
            .update(systemJournal)
            .set({ status: "failed", analystNotes: errMsg.slice(0, 500) })
            .where(eq(systemJournal.id, entry.id));
          await insertAuditRow({
              action: "scout.rejected_critic",
              entityType: "system_journal",
              entityId: entry.id,
              input: { dsl } as Record<string, unknown>,
              result: {
                score: criticAccept.score,
                concerns: criticAccept.concerns,
                reasoning: criticAccept.reasoning,
                source: criticAccept.source,
              } as Record<string, unknown>,
              status: "rejected",
              decisionAuthority: "gate",
              correlationId: drainCorrelationId,
            })
            .catch((err) => logger.warn({ err, entryId: entry.id }, "scout.rejected_critic audit write failed"));
          trackRejectAndMaybeBroadcast("scout.rejected_critic");
          continue;
        }

        // Persist the critic score on the DSL so the strategy_params row
        // downstream carries it. runStrategyFromDSL persists strategyParams
        // verbatim, so writing here is sufficient.
        (dsl as Record<string, unknown>).critic_score = criticAccept.score;
        (dsl as Record<string, unknown>).critic_source = criticAccept.source;

        // C3: DSL output validation — schema + field-level injection scan
        // skipCompile=true here (compiler round-trip happens inside runStrategyFromDSL)
        const dslValidation = await validateDSLOutput(dsl, {
          skipCompile: true,
          source: `drain:${entry.source ?? "unknown"}`,
        });
        if (!dslValidation.passed) {
          failed++;
          errors.push(`${entry.id}: DSL validation failed: ${dslValidation.reasons.slice(0, 3).join("; ")}`);
          continue;
        }

        // Legacy field check (kept for compatibility — validateDSLOutput already covers this)
        const required = [
          "name", "description", "symbol", "timeframe", "direction",
          "entry_type", "entry_indicator", "entry_params", "entry_condition",
          "exit_type", "exit_params", "stop_loss_atr_multiple",
        ];
        const missing = required.filter((f) => !(f in dsl));
        if (missing.length > 0) {
          failed++;
          errors.push(`${entry.id}: missing DSL fields ${missing.join(",")}`);
          continue;
        }

        // Pass 19: if this drain was triggered from a graduated_bucket path,
        // use the override source so assertCrossValidatedSource passes and
        // the strategy row gets the correct source/tags.
        // Pass 21: auto-detect graduated entries from the journal row itself —
        // periodic drain cron has no override, but the journal entry's params
        // carry bucket_id when it came from /scout-ideas/strict via the
        // legacyShaped wrapper. Look for bucket_id (top-level or nested).
        const entryParams = (entry.strategyParams as Record<string, unknown> | null) ?? {};
        const journalBucketId: string | undefined =
          (typeof entryParams.bucket_id === "string" && entryParams.bucket_id) ||
          (typeof (entryParams as any).bucketId === "string" && (entryParams as any).bucketId) ||
          undefined;
        let mappedSource: "ollama" | "openclaw" | "manual" | "graduated_bucket";
        const journalSource = String(entry.source ?? "");
        if (
          overrideOptions?.source === "graduated_bucket" ||
          journalBucketId ||
          journalSource === "graduated_bucket"
        ) {
          mappedSource = "graduated_bucket";
        } else {
          const rawSource = String(entry.source ?? "openclaw");
          mappedSource = (rawSource === "ollama" || rawSource === "manual") ? rawSource : "openclaw";
        }

        // M3 fix — route through Python compiler → real backtest config
        const result = await this.runStrategyFromDSL(dsl, {
          source: mappedSource,
          bucketId: overrideOptions?.bucketId ?? journalBucketId,
        }, { correlationId: drainCorrelationId });

        // Link the journal entry to the new strategy (so it stops appearing in drain queue).
        // Also stamp generationPromptVersionId so the A/B comparator can attribute this
        // strategy to the real prompt version that generated it (not a coin-flip).
        if (result.strategyId) {
          await db
            .update(systemJournal)
            .set({
              strategyId: result.strategyId,
              status: result.status === "completed" ? "tested" : "failed",
              generationPromptVersionId,
            })
            .where(eq(systemJournal.id, entry.id));
          drained++;
        } else if (result.status === "compile_failed") {
          failed++;
          errors.push(`${entry.id}: compile failed: ${(result.compileErrors ?? []).slice(0, 2).join("; ")}`);
        } else {
          failed++;
          errors.push(`${entry.id}: ${result.status ?? "unknown"}${result.skipped ? " (re-paused)" : ""}`);
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.id}: ${msg}`);
        logger.warn({ err, entryId: entry.id }, "Pipeline-resume drain: idea conversion failed");
      }
    }

    logger.info(
      { scanned: scouted.length, drained, failed },
      "Pipeline-resume drain: completed",
    );

    return {
      scanned: scouted.length,
      drained,
      failed,
      errors: errors.slice(0, 20),
    };
  }
}
