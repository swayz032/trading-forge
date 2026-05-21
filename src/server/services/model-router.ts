/**
 * Model Router — Selects local Ollama or cloud GPT-5-mini based on task role.
 *
 * Local models handle volume (fast, free, 24/7).
 * Cloud model handles depth (frontier reasoning for critic, proposer, review).
 * Every cloud call has a local fallback.
 *
 * Token budget: ~185K tokens/day out of 2.5M free (7.4%).
 *
 * Scout Architecture Fix (Pass 1 Branch C, 2026-05-04):
 *   - Added 3 roles: scout_auditor, dsl_quality_critic, transcript_extractor
 *   - Extended loadSystemPrompt() with KB card + few-shot injection
 *   - Backwards-compatible: existing single-arg callers still work
 *   - Cache: 60s TTL keyed by (role, taskContext-hash) with Promise-based
 *     in-flight dedup (single concurrent build per cache key).
 */

import { createHash } from "crypto";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { logger } from "../index.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "../../..");

export interface ModelConfig {
  provider: "openai" | "ollama";
  model: string;
  temperature: number;
  maxTokens: number;
  systemPromptPath?: string;
  responseFormat?: "json" | "text";
  /**
   * Pass 9 Branch A — Responses API migration.
   *
   * When set to "v1" AND the per-role env flag
   * OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=true is also set, callOpenAI
   * routes through the Responses API (`/v1/responses`) with native strict
   * JSON schema enforcement (when a schema is mapped via
   * `loadStrictSchemaForRole`). Default OFF for ALL roles — operator flips
   * one role at a time. No behavior change unless the flag is set.
   *
   * Both fields are required for routing — bare-metal env-flag with no
   * config field is treated as "not yet ready for Responses API".
   */
  responsesApiVersion?: "v1";
  fallback?: {
    provider: "ollama";
    model: string;
  };
  /** Optional per-role override; falls back to default 30s. */
  timeoutMs?: number;
}

export type ModelRole =
  | "critic_evaluator"
  | "strategy_proposer"
  | "nightly_review"
  | "scout_auditor"            // NEW (Pass 1 Branch C)
  | "dsl_quality_critic"       // NEW (Pass 1 Branch C)
  | "transcript_extractor"     // NEW (Pass 1 Branch C)
  | "tournament_prosecutor"    // NEW (Pass 14 — Strategy Tournament graduation)
  | "tournament_promoter"      // NEW (Pass 14 — Strategy Tournament graduation)
  | "bias_engine_evaluator"    // NEW (Track 5 — Phase D Readiness: bias engine graduation verdict)
  | "cross_source_validator"   // NEW (Pass 18 — Cross-source strategy validation)
  | "strategy_name_discoverer" // NEW (Pass 20 — Layer 1 web discovery: name harvesting)
  | "fast_critique"
  | "dsl_writer"
  | "quick_classifier"          // NEW (Pass 21 — phi4-mini for binary/categorical decisions)
  | "embedder";

/**
 * Per-role KB card manifest. Each entry is a path RELATIVE to `src/agents/`.
 * Cards are loaded in declared order and appended to the system prompt with
 * a `## KB: <cardName>` separator. Missing cards are skipped (graceful
 * degradation — Branch B may ship cards on a different cadence).
 *
 * Roles with no cards (empty array) get a pure prompt — file I/O is skipped.
 *
 * IMPORTANT: keys MUST cover every entry in ModelRole — `kbInjectionTest`
 * asserts this. Adding a new role requires adding its KB list here too.
 */
const KB_MANIFEST: Record<ModelRole, readonly string[]> = {
  critic_evaluator: [
    "kb/indicator-catalog.md",
    "kb/regime-taxonomy.md",
    "kb/prop-firm-rules-summary.md",
  ],
  strategy_proposer: [
    "kb/strategy-schema-snapshot.json",
    "kb/indicator-catalog.md",
    "kb/regime-taxonomy.md",
    "kb/anti-pattern-catalog.md",
  ],
  nightly_review: ["kb/anti-pattern-catalog.md"],
  scout_auditor: [], // binary accept/reject — few-shot only, no schema cards
  dsl_quality_critic: [
    "kb/strategy-schema-snapshot.json",
    "kb/anti-pattern-catalog.md",
  ],
  transcript_extractor: [
    "kb/strategy-schema-snapshot.json",
    "kb/indicator-catalog.md",
  ],
  tournament_prosecutor: [
    "kb/indicator-catalog.md",
    "kb/regime-taxonomy.md",
    "kb/prop-firm-rules-summary.md",
    "kb/anti-pattern-catalog.md",
  ],
  tournament_promoter: [
    "kb/anti-pattern-catalog.md",
    "kb/prop-firm-rules-summary.md",
  ],
  // bias_engine_evaluator — reads anti-pattern catalog for context on what good calibration
  // looks like vs what prior miscalibrations looked like. Few-shot examples are mandatory
  // because the verdict structure (GRADUATE/STAY_IN_SHADOW/KILL) is novel.
  bias_engine_evaluator: [
    "kb/anti-pattern-catalog.md",
  ],
  // cross_source_validator — adversarial similarity judge for the pending-bucket layer.
  // Needs indicator catalog + regime taxonomy to judge whether indicators overlap ≥50%
  // and regimes are compatible. Also needs strategy schema snapshot to understand the
  // full shape of what it's comparing.
  cross_source_validator: [
    "kb/indicator-catalog.md",
    "kb/regime-taxonomy.md",
    "kb/strategy-schema-snapshot.json",
  ],
  // strategy_name_discoverer — Layer 1 web discovery: reads articles and pulls out
  // NAMES of strategies only. No indicator periods, no DSL extraction — just names
  // + 1-sentence concepts. Minimal KB: no regime taxonomy needed at this layer.
  strategy_name_discoverer: [],
  fast_critique: [],
  dsl_writer: [],
  quick_classifier: [],
  embedder: [],
};

/**
 * Roles that load few-shot examples from `src/agents/kb/few-shot/<role>/*.json`.
 * Authored by Pass 3 (Branch B). Until those files exist, the few-shot loader
 * silently returns no examples (graceful degradation).
 */
const FEWSHOT_ROLES: ReadonlySet<ModelRole> = new Set<ModelRole>([
  "strategy_proposer",
  "scout_auditor",
  "dsl_quality_critic",
  "transcript_extractor",
  "tournament_prosecutor",
  "tournament_promoter",
  "bias_engine_evaluator",
  "cross_source_validator",
  "strategy_name_discoverer",
]);

const MODEL_CONFIGS: Record<ModelRole, ModelConfig> = {
  // Cloud models — frontier reasoning for depth
  critic_evaluator: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 2048,
    systemPromptPath: "src/agents/critic-evaluator.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  strategy_proposer: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.7,
    maxTokens: 3072,
    systemPromptPath: "src/agents/strategy-proposer.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "qwen2.5-coder:7b" },
  },
  nightly_review: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.4,
    maxTokens: 4096,
    systemPromptPath: "src/agents/nightly-self-critique.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // ─── New roles (Pass 1 Branch C) ────────────────────────────────────────
  // scout_auditor — bouncer at /scout-ideas intake. Tight temp + small JSON.
  scout_auditor: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.1,
    maxTokens: 256,
    systemPromptPath: "src/agents/scout-auditor.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // dsl_quality_critic — runs after synthesizer, before journal insert.
  dsl_quality_critic: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 1024,
    systemPromptPath: "src/agents/dsl-quality-critic.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // transcript_extractor — long-form output (multiple strategies per video).
  // W23H-postmortem-4 (2026-05-20): bumped 4096 → 8192. Wave 23H v9 prompt
  // emits confirming_indicators[] + bias_timeframe + preferred_regimes[] +
  // entry_params per strategy; multi-strategy outputs were truncating at 4096
  // (finishReason: "length"), producing malformed JSON that the route
  // classified as model_unavailable. JackTrades 4H+15M (the canonical MTF
  // target) failed for this reason. GPT-5-mini supports up to 16K output.
  transcript_extractor: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.3,
    maxTokens: 8192,
    systemPromptPath: "src/agents/transcript-extractor.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "qwen2.5-coder:7b" },
  },
  // ─── Tournament roles (Pass 14 — Strategy Tournament hPXh graduation) ───
  // tournament_prosecutor — adversarial bear-case attack on a proposed strategy.
  tournament_prosecutor: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.3,
    maxTokens: 1024,
    systemPromptPath: "src/agents/tournament-prosecutor.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // tournament_promoter — final verdict (PROMOTE/REVISE/KILL) via 6-rule matrix.
  tournament_promoter: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 768,
    systemPromptPath: "src/agents/tournament-promoter.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // bias_engine_evaluator — Phase D Readiness: reads SHADOW calibration evidence and
  // returns GRADUATE / STAY_IN_SHADOW / KILL in plain English for operator.
  // Daily token budget: 25k (operator-triggered, not on every cron cycle).
  // Fallback: Ollama deepseek-r1:14b (reasoning model appropriate for multi-source eval).
  bias_engine_evaluator: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 1024,
    systemPromptPath: "src/agents/bias-engine-evaluator.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
    timeoutMs: 45_000,
  },
  // ─── Pass 18 — Cross-source validator ───────────────────────────────────
  // Adversarial similarity judge for the pending-bucket layer.
  // Bias toward "different" — false positives hurt more than false negatives.
  // Daily cap: 20k tokens (sparse invocations; only fires per CV1 webhook).
  cross_source_validator: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.2,
    maxTokens: 1500,
    systemPromptPath: "src/agents/cross-source-validator.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
  },
  // ─── Pass 20: Layer 1 web discovery ─────────────────────────────────────
  // strategy_name_discoverer — reads articles, pulls out NAMES only.
  // Low temp (0.3) for consistent extraction, 2048 tokens for multi-name lists.
  // Fallback: Ollama qwen2.5-coder:7b (fast enough for bulk article scanning,
  // fits in RTX 5060 8 GB VRAM; replaces unloadable qwen3-coder:30b).
  strategy_name_discoverer: {
    provider: "openai",
    model: "gpt-5-mini",
    temperature: 0.3,
    maxTokens: 2048,
    systemPromptPath: "src/agents/strategy-name-discoverer.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "qwen2.5-coder:7b" },
  },
  // ─── Local models (volume / fallback) ───────────────────────────────────
  // Pass 21 (2026-05-12): qwen3-coder:30b + trading-quant retired — both 18 GB,
  // can't load on RTX 5060 8 GB VRAM. Replaced with qwen2.5-coder:7b (4.7 GB,
  // 76 HumanEval, fits cleanly) + phi4-mini (2.5 GB) for quick classification.
  // deepseek-r1:14b (9 GB) retained for explicit reasoning roles — borderline
  // VRAM fit, partial CPU offload, 45s timeout on every call.
  fast_critique: {
    provider: "ollama",
    model: "deepseek-r1:14b",
    temperature: 0.3,
    maxTokens: 2048,
    timeoutMs: 45_000,
  },
  dsl_writer: {
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    temperature: 0.5,
    maxTokens: 3072,
  },
  quick_classifier: {
    provider: "ollama",
    model: "phi4-mini",
    temperature: 0.2,
    maxTokens: 512,
  },
  embedder: {
    provider: "ollama",
    model: "nomic-embed-text",
    temperature: 0,
    maxTokens: 0,
  },
};

/**
 * Select model config for a given role.
 * Falls back to local model if cloud is unavailable.
 */
export function selectModel(role: ModelRole): ModelConfig {
  const config = MODEL_CONFIGS[role];
  if (!config) {
    logger.warn({ role }, "Unknown model role, falling back to fast_critique");
    return MODEL_CONFIGS.fast_critique;
  }
  return config;
}

// ─── KB injection (Pass 1 Branch C) ────────────────────────────────────────

export interface PromptTaskContext {
  signalType?: "strategy_candidate" | "market_news_intel";
  regime?: string;
  symbol?: string;
}

interface CacheEntry {
  /** Resolved system prompt. */
  value: string;
  /** epoch ms — entry expires after this timestamp. */
  expiresAt: number;
}

const PROMPT_CACHE_TTL_MS = 60_000;
const promptCache = new Map<string, CacheEntry>();
/**
 * In-flight build dedup. Today every build is synchronous, so this Map is
 * effectively unused. It exists as a contract for future async upgrades —
 * if buildPromptSync becomes buildPromptAsync, concurrent callers for the
 * same key will share a single in-flight Promise instead of stampeding.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * Test helper — clears the in-memory prompt cache. Exposed for unit tests
 * that need a clean cache between assertions. Production code never calls
 * this. Not part of the public API.
 */
export function __clearPromptCacheForTests(): void {
  promptCache.clear();
  inFlight.clear();
}

function cacheKey(role: ModelRole, ctx?: PromptTaskContext): string {
  if (!ctx) return `${role}::nil`;
  const canonical = JSON.stringify({
    signalType: ctx.signalType ?? null,
    regime: ctx.regime ?? null,
    symbol: ctx.symbol ?? null,
  });
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `${role}::${hash}`;
}

/**
 * Read a KB file relative to `src/agents/`. Returns null if missing —
 * Branch B may ship cards incrementally, so missing files are not fatal.
 */
function readKbCard(relPath: string): string | null {
  try {
    const fullPath = resolve(PROJECT_ROOT, "src/agents", relPath);
    return readFileSync(fullPath, "utf-8");
  } catch {
    logger.debug({ relPath }, "KB card not found, skipping");
    return null;
  }
}

/**
 * Load few-shot examples for a role. Each example is a JSON file under
 * `src/agents/kb/few-shot/<role>/`. The expected shape is `{ input, output }`
 * but we tolerate any object — non-conforming files render as raw JSON.
 *
 * Optional task-context filter: when `taskContext.signalType` is set, prefer
 * examples whose `tags` (or `category`) contain that signal type. If no
 * examples match the filter, fall back to all examples (so a missing tag
 * never starves the prompt).
 */
function loadFewShotExamples(
  role: ModelRole,
  taskContext: PromptTaskContext | undefined,
): string {
  if (!FEWSHOT_ROLES.has(role)) return "";

  const dir = resolve(
    PROJECT_ROOT,
    "src/agents/kb/few-shot",
    roleToDirName(role),
  );

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort(); // deterministic order
  } catch {
    return ""; // dir missing — Branch B hasn't shipped yet
  }
  if (files.length === 0) return "";

  type Example = { raw: unknown; text: string };
  const all: Example[] = [];
  for (const f of files) {
    try {
      const content = readFileSync(resolve(dir, f), "utf-8");
      const parsed = JSON.parse(content);
      all.push({ raw: parsed, text: formatFewShot(parsed) });
    } catch (err) {
      logger.debug({ file: f, err }, "Failed to parse few-shot example");
    }
  }
  if (all.length === 0) return "";

  // Filter by signalType if specified. Match against `tags` array,
  // `category` string, or `signalType` field.
  let selected = all;
  if (taskContext?.signalType) {
    const target = taskContext.signalType;
    const filtered = all.filter((ex) => exampleMatchesSignal(ex.raw, target));
    if (filtered.length > 0) selected = filtered;
  }

  return selected.map((e) => e.text).join("\n\n");
}

function exampleMatchesSignal(raw: unknown, target: string): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (obj.signalType === target) return true;
  if (obj.category === target) return true;
  if (Array.isArray(obj.tags) && obj.tags.includes(target)) return true;
  return false;
}

function formatFewShot(parsed: unknown): string {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "input" in parsed &&
    "output" in parsed
  ) {
    const obj = parsed as { input: unknown; output: unknown };
    const inputStr =
      typeof obj.input === "string" ? obj.input : JSON.stringify(obj.input, null, 2);
    const outputStr =
      typeof obj.output === "string"
        ? obj.output
        : JSON.stringify(obj.output, null, 2);
    return `INPUT: ${inputStr}\n→ OUTPUT: ${outputStr}`;
  }
  return JSON.stringify(parsed, null, 2);
}

function roleToDirName(role: ModelRole): string {
  // few-shot directories use kebab-case (matches Branch B authoring convention)
  return role.replace(/_/g, "-");
}

/**
 * Build the assembled prompt for a role. Synchronous internally — wrapped
 * in a Promise by `loadSystemPrompt()` so the cache layer can dedupe
 * concurrent in-flight builds.
 */
function buildPromptSync(
  role: ModelRole,
  taskContext: PromptTaskContext | undefined,
): string {
  const config = MODEL_CONFIGS[role];
  if (!config) return "";

  // 1. Base prompt from .md file.
  let base = "";
  if (config.systemPromptPath) {
    try {
      const fullPath = resolve(PROJECT_ROOT, config.systemPromptPath);
      base = readFileSync(fullPath, "utf-8");
    } catch {
      logger.debug(
        { role, path: config.systemPromptPath },
        "System prompt file not found, returning empty base",
      );
    }
  }

  // 2. KB cards for this role.
  const cards: string[] = [];
  for (const cardPath of KB_MANIFEST[role] ?? []) {
    const content = readKbCard(cardPath);
    if (content !== null) {
      const cardName = cardPath.replace(/^kb\//, "");
      cards.push(`## KB: ${cardName}\n\n${content.trim()}`);
    }
  }

  // 3. Few-shot examples for roles that opt in.
  const fewShot = loadFewShotExamples(role, taskContext);

  const parts: string[] = [];
  if (base.trim().length > 0) parts.push(base.trim());
  if (cards.length > 0) parts.push(cards.join("\n\n"));
  if (fewShot.trim().length > 0) {
    parts.push(`## Few-shot examples\n\n${fewShot.trim()}`);
  }

  return parts.join("\n\n");
}

/**
 * Load system prompt + KB cards + few-shot examples for a role.
 *
 * Backwards-compatible: existing callers passing only `role` still get a
 * working prompt. The `taskContext` arg is optional and only filters
 * few-shot examples (it does not change KB card selection).
 *
 * Caching: 60s TTL per (role, ctx-hash). Concurrent calls share an
 * in-flight Promise so two callers don't both hit disk simultaneously.
 *
 * Missing KB / few-shot files are non-fatal — Branch B may ship cards on
 * a different cadence. Missing prompt file returns the assembled
 * KB+few-shot content without a base.
 */
export function loadSystemPrompt(
  role: ModelRole,
  taskContext?: PromptTaskContext,
): string {
  const key = cacheKey(role, taskContext);
  const now = Date.now();

  const existing = promptCache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  // Build is synchronous today (file I/O is sync via readFileSync). The
  // cache stores the resolved string. The `inFlight` Map is reserved for
  // a future async upgrade path so concurrent callers de-stampede on the
  // same key.
  const value = buildPromptSync(role, taskContext);
  promptCache.set(key, {
    value,
    expiresAt: now + PROMPT_CACHE_TTL_MS,
  });
  return value;
}

/**
 * Get fallback config for a role (when cloud API is down).
 */
export function getFallback(role: ModelRole): ModelConfig | null {
  const config = MODEL_CONFIGS[role];
  if (!config?.fallback) return null;

  return {
    provider: config.fallback.provider,
    model: config.fallback.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

/**
 * Check if a role uses cloud model.
 */
export function isCloudModel(role: ModelRole): boolean {
  return MODEL_CONFIGS[role]?.provider === "openai";
}

// ─── Pass 9 Branch A — Responses API migration ─────────────────────────────

/**
 * Normalized parsed response shape that callers (and the cost tracker)
 * see regardless of whether the underlying upstream was Chat Completions
 * (`/v1/chat/completions`) or the Responses API (`/v1/responses`).
 */
export interface ParsedLLMResponse {
  /** Raw output text — caller parses as JSON downstream. */
  text: string;
  /** Responses-API only: explicit refusal field on the assistant message. */
  refusal?: string;
  inputTokens: number;
  outputTokens: number;
  /** Responses-API only — GPT-5 reasoning tokens. */
  reasoningTokens?: number;
  /** "stop" | "length" | "refusal" | "content_filter" | etc. */
  finishReason: string;
  apiPath: "chat_completions" | "responses";
  usedStrictSchema: boolean;
}

/**
 * Per-role feature flag detection. The flag name is derived from the role:
 * `OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=true` enables the Responses API
 * for that role only. Every other role continues to use Chat Completions.
 *
 * Default OFF. Operator flips one role at a time.
 */
export function isResponsesApiEnabled(role: ModelRole): boolean {
  const envName = `OPENAI_USE_RESPONSES_API_${role.toUpperCase()}`;
  return process.env[envName] === "true";
}

/**
 * Parse a Chat Completions API response into the normalized shape.
 * Tolerates missing usage block (some upstream errors return partial JSON).
 */
export function parseChatCompletionsResponse(raw: any): ParsedLLMResponse {
  const choice = raw?.choices?.[0];
  const content = choice?.message?.content ?? "";
  const usage = raw?.usage ?? {};
  return {
    text: typeof content === "string" ? content : "",
    inputTokens: Number(usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? 0),
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "stop",
    apiPath: "chat_completions",
    usedStrictSchema: false,
  };
}

/**
 * Parse a Responses API response into the normalized shape.
 *
 * Responses API output shape:
 *   {
 *     output: [{ type: "message", content: [{ type: "output_text", text }],
 *                role: "assistant", refusal? }],
 *     usage: { input_tokens, output_tokens,
 *              output_tokens_details: { reasoning_tokens } },
 *     incomplete_details: null | { reason }
 *   }
 *
 * Multi-content-block messages are concatenated. Refusal field is
 * surfaced if present at the message level. `incomplete_details.reason`
 * is exposed via `finishReason` when present (e.g., "max_output_tokens").
 */
export function parseResponsesApiResponse(raw: any): ParsedLLMResponse {
  const output = Array.isArray(raw?.output) ? raw.output : [];
  const message = output.find((o: any) => o?.type === "message") ?? output[0];
  let text = "";
  let refusal: string | undefined;

  if (message) {
    if (typeof message.refusal === "string" && message.refusal.length > 0) {
      refusal = message.refusal;
    }
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const b of blocks) {
      if (b?.type === "output_text" && typeof b.text === "string") {
        text += b.text;
      } else if (b?.type === "refusal" && typeof b.refusal === "string") {
        refusal = refusal ?? b.refusal;
      }
    }
  }

  const usage = raw?.usage ?? {};
  const reasoningTokens = Number(usage?.output_tokens_details?.reasoning_tokens ?? 0);

  let finishReason = "stop";
  if (refusal) finishReason = "refusal";
  else if (raw?.incomplete_details?.reason) finishReason = String(raw.incomplete_details.reason);

  return {
    text,
    refusal,
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    reasoningTokens: reasoningTokens > 0 ? reasoningTokens : undefined,
    finishReason,
    apiPath: "responses",
    usedStrictSchema: false, // overwritten by caller when applicable
  };
}

/**
 * Map a role to its strict JSON schema (or null when the role's output
 * shape is too varied for token-level schema enforcement).
 *
 * Strict-schema roles (4): scout_auditor, dsl_quality_critic,
 *   strategy_proposer, transcript_extractor.
 * Non-strict roles (2 — fall back to `json_object`):
 *   critic_evaluator, nightly_review.
 *
 * Returns a JSON-Schema-compatible object suitable for embedding into
 * `response_format: { type: "json_schema", json_schema: { strict: true,
 * schema: ... } }`. File reads are wrapped in try/catch so a missing
 * snapshot during dev never crashes the call path — null fall-through
 * uses `json_object` mode (same as current Chat Completions today).
 */
export async function loadStrictSchemaForRole(role: ModelRole): Promise<unknown | null> {
  switch (role) {
    case "strategy_proposer":
    case "transcript_extractor": {
      try {
        const fs = await import("fs/promises");
        const fullPath = resolve(PROJECT_ROOT, "src/agents/kb/strategy-schema-snapshot.json");
        const raw = await fs.readFile(fullPath, "utf-8");
        const base = JSON.parse(raw);

        // W23H-postmortem (2026-05-20): the v9 prompt asks for these fields but
        // the LLM was omitting them. JSON-Schema-enforced strict mode FORCES
        // emission. Each field is nullable (LLM emits null when truly N/A) so
        // the schema is satisfied without fabrication.
        const w23hExtensions = {
          bias_timeframe: {
            type: ["string", "null"],
            description: "Higher timeframe used for trend bias (e.g. '4h', '1h', '1d'). Required field — emit null if strategy is single-timeframe with no HTF bias reference.",
          },
          bias_condition: {
            type: ["string", "null"],
            description: "Plain-English summary of the HTF rule (e.g. 'ema_50_4h > ema_200_4h', '4H candle range defined'). Required field — emit null if bias_timeframe is null.",
          },
          execution_timeframe: {
            type: ["string", "null"],
            description: "Lower timeframe for actual entry signals — typically equals 'timeframe'. Required field — emit null when single-TF.",
          },
          primary_indicator: {
            type: ["string", "null"],
            description: "For confluence strategies — alias of entry_indicator. Required field — may equal entry_indicator or be null for single-indicator strategies.",
          },
          confirming_indicators: {
            type: ["array", "null"],
            description: "For multi-step strategies (ICT/SMC/Wyckoff/CRT) and confluence strategies, list each subsidiary structural mechanic. Required field — emit null only for TRULY single-step single-condition strategies (rare).",
            items: {
              type: "object",
              properties: {
                indicator: { type: "string" },
                params: { type: "object", additionalProperties: true },
                direction: { type: "string", enum: ["agree", "disagree", "either"] },
              },
              required: ["indicator", "params", "direction"],
              additionalProperties: true,
            },
          },
          min_factors_satisfied: {
            type: ["integer", "null"],
            description: "How many of (1 primary + N confirming) must fire. Required when confirming_indicators is non-empty; emit null otherwise.",
          },
          preferred_regimes: {
            type: ["array", "null"],
            description: "Regimes in which the strategy is allowed to fire. Multi-valued array of {TRENDING_UP, TRENDING_DOWN, RANGE_BOUND}. Required field — for archetype:* strategies, default to all 3 unless source explicitly narrows. Emit null only when truly undetermined.",
            items: { type: "string", enum: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"] },
          },
          confluence_factors: {
            type: ["array", "null"],
            description: "Subset of W23F.B enum: regime_match, structural_setup, volume_confirmation, macro_alignment, vp_shape. Emit only tokens source explicitly mentions; null/empty if none.",
            items: { type: "string", enum: ["regime_match", "structural_setup", "volume_confirmation", "macro_alignment", "vp_shape"] },
          },
          source_claim_win_rate: {
            type: ["number", "null"],
            description: "When source EXPLICITLY states a win rate %, emit as float 0-1. Emit null if not stated. NEVER fabricate.",
          },
          source_claim_avg_r: {
            type: ["number", "null"],
            description: "When source EXPLICITLY states avg R, emit float. Emit null if not stated. NEVER fabricate.",
          },
        };

        // Inject extensions into properties + required arrays.
        // OpenAI strict mode requires ALL properties to be in required (use null for N/A).
        const mergedProps = { ...(base.properties ?? {}), ...w23hExtensions };
        const newRequired = Array.from(new Set([...(base.required ?? []), ...Object.keys(w23hExtensions)]));
        return {
          ...base,
          properties: mergedProps,
          required: newRequired,
          additionalProperties: false,
        };
      } catch (err) {
        logger.debug({ role, err }, "loadStrictSchemaForRole: snapshot read failed, falling back to json_object");
        return null;
      }
    }
    case "scout_auditor":
      return {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 10 },
          accept: { type: "boolean" },
          reason: { type: "string", maxLength: 200 },
        },
        required: ["score", "accept", "reason"],
        additionalProperties: false,
      };
    case "dsl_quality_critic":
      return {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 0, maximum: 10 },
          accept: { type: "boolean" },
          concerns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                issue: { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["field", "issue", "severity"],
              additionalProperties: false,
            },
          },
          reasoning: { type: "string", maxLength: 500 },
        },
        required: ["score", "accept", "concerns", "reasoning"],
        additionalProperties: false,
      };
    // ─── Pass 18: cross_source_validator strict schema ──────────────────
    case "cross_source_validator":
      return {
        type: "object",
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                is_same_setup: { type: "boolean" },
                confidence: { type: "number" },
                divergence_notes: { type: "string" },
              },
              required: ["index", "is_same_setup", "confidence", "divergence_notes"],
              additionalProperties: false,
            },
          },
        },
        required: ["matches"],
        additionalProperties: false,
      };
    case "critic_evaluator":
    case "nightly_review":
    default:
      // Variable JSON shape — strict schema would over-constrain. Falls
      // back to `response_format: { type: "json_object" }` (today's Chat
      // Completions behavior).
      return null;
  }
}

function getOpenAIProxyBase(): string {
  return process.env.OPENAI_PROXY_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}/api/openai-proxy/v1`;
}

/**
 * Chat Completions caller — the legacy path. Behavior is byte-identical to
 * pre-Pass-9. Default for ALL roles when the per-role flag is OFF.
 */
async function callChatCompletions(
  config: ModelConfig,
  systemPrompt: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  role?: ModelRole,
): Promise<ParsedLLMResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL: getOpenAIProxyBase() });

  const allMessages = systemPrompt
    ? [{ role: "system" as const, content: systemPrompt }, ...messages]
    : messages;

  // W23H-postmortem (2026-05-20): wire strict JSON schema (structured outputs)
  // for roles that have one. Prompt-only directives weren't enough — LLM kept
  // omitting fields. JSON-Schema-enforced strict mode forces emission.
  let responseFormat: Record<string, unknown> | undefined;
  if (role && config.responseFormat === "json") {
    const schema = await loadStrictSchemaForRole(role);
    if (schema) {
      responseFormat = {
        type: "json_schema",
        json_schema: { name: `${role}_output`, strict: true, schema },
      };
    } else {
      responseFormat = { type: "json_object" };
    }
  } else if (config.responseFormat === "json") {
    responseFormat = { type: "json_object" };
  }

  const isGpt5 = config.model.startsWith("gpt-5");
  const response = await client.chat.completions.create({
    model: config.model,
    messages: allMessages,
    ...(isGpt5
      ? { max_completion_tokens: config.maxTokens }
      : { max_tokens: config.maxTokens, temperature: config.temperature }),
    ...(responseFormat ? { response_format: responseFormat as never } : {}),
  });

  return parseChatCompletionsResponse(response);
}

/**
 * Responses API caller — the new path. Native strict JSON schema when
 * `loadStrictSchemaForRole(role)` returns a schema; falls back to
 * `json_object` mode otherwise (matches Chat Completions parity).
 *
 * Routed through the same `/api/openai-proxy/v1` base — Step 6 added the
 * `/v1/responses` passthrough so the proxy applies the same daily budget,
 * circuit breaker, and telemetry to both paths.
 */
async function callResponsesApi(
  role: ModelRole,
  config: ModelConfig,
  systemPrompt: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<ParsedLLMResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const schema = await loadStrictSchemaForRole(role);
  const usedStrictSchema = schema !== null;

  const inputMessages = systemPrompt
    ? [{ role: "system" as const, content: systemPrompt }, ...messages]
    : messages;

  const isGpt5 = config.model.startsWith("gpt-5");
  const body: Record<string, unknown> = {
    model: config.model,
    input: inputMessages,
    ...(isGpt5
      ? { max_output_tokens: config.maxTokens }
      : { max_output_tokens: config.maxTokens, temperature: config.temperature }),
  };

  if (usedStrictSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: `${role}_output`,
        strict: true,
        schema,
      },
    };
  } else if (config.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  const url = `${getOpenAIProxyBase()}/responses`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "<read failed>");
    throw new Error(`Responses API HTTP ${res.status}: ${errText}`);
  }

  const raw = await res.json();
  const parsed = parseResponsesApiResponse(raw);
  parsed.usedStrictSchema = usedStrictSchema;
  return parsed;
}

/**
 * Call OpenAI API with the model config for a role.
 *
 * Routing (Pass 9 Branch A):
 *   - Default: Chat Completions (`/v1/chat/completions`).
 *   - When `OPENAI_USE_RESPONSES_API_<ROLE_UPPER>=true` AND
 *     `config.responsesApiVersion === "v1"`: Responses API (`/v1/responses`).
 *
 * Returns text content (the JSON string callers parse) or null on failure.
 * Refusal path returns null (caller treats as fallback trigger).
 *
 * Cost tracker + audit log records distinguish the two paths so operators
 * can compare aggregate quality + cost between Chat Completions and
 * Responses API after canary rollout.
 */
export async function callOpenAI(
  role: ModelRole,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  taskContext?: PromptTaskContext,
): Promise<string | null> {
  const config = MODEL_CONFIGS[role];
  if (!config || config.provider !== "openai") return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn({ role }, "OPENAI_API_KEY not set, skipping cloud model");
    return null;
  }

  const cb = CircuitBreakerRegistry.get("openai", { failureThreshold: 3, cooldownMs: 30_000 });
  if (cb.currentState === "OPEN") {
    logger.warn({ role, circuitState: cb.status() }, "OpenAI circuit OPEN — skipping, caller should use fallback");
    return null;
  }

  const useResponsesApi =
    isResponsesApiEnabled(role) && config.responsesApiVersion === "v1";

  const systemPrompt = loadSystemPrompt(role, taskContext);
  const startedAt = Date.now();

  let parsed: ParsedLLMResponse | null = null;
  try {
    parsed = await cb.call(async () => {
      try {
        if (useResponsesApi) {
          return await callResponsesApi(role, config, systemPrompt, messages);
        }
        return await callChatCompletions(config, systemPrompt, messages, role);
      } catch (innerErr: any) {
        // Pass 21 — Trading Forge daily-budget gate returns 429 with
        // type='daily_budget_exceeded'. This is an EXPECTED control-plane
        // signal to fall back to Ollama, NOT an OpenAI outage. Do NOT bump
        // the circuit-breaker failure counter; return null so the caller
        // routes to Ollama silently. Without this, every budget-exhausted
        // call increments the breaker → trips → emits a CRITICAL alert.
        const status = innerErr?.status ?? innerErr?.response?.status;
        const errType = innerErr?.error?.type ?? innerErr?.code;
        const isBudget = status === 429 && (errType === "daily_budget_exceeded" || String(innerErr?.message ?? "").includes("daily GPT-5 mini budget"));
        if (isBudget) {
          logger.info({ role }, "openai-proxy: budget gate hit (429) — falling back to Ollama, NOT bumping circuit");
          return null;  // success-with-empty-result; breaker stays CLOSED
        }
        throw innerErr;  // genuine OpenAI error — let breaker count it
      }
    });
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      logger.warn({ role, endpoint: "openai", reopensAt: err.reopensAt.toISOString() }, "OpenAI circuit OPEN — caller should use fallback");
    } else {
      logger.error({ role, err, useResponsesApi }, "OpenAI call failed, caller should use fallback");
    }
    // Fire-and-forget telemetry on the failed attempt — distinguishes paths.
    void recordCallTelemetry(role, {
      apiPath: useResponsesApi ? "responses" : "chat_completions",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      status: "error",
      usedStrictSchema: false,
    });
    return null;
  }

  if (!parsed) return null;

  const durationMs = Date.now() - startedAt;

  // Cost tracker — fire-and-forget; never blocks caller.
  void recordCallTelemetry(role, {
    apiPath: parsed.apiPath,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    reasoningTokens: parsed.reasoningTokens,
    usedStrictSchema: parsed.usedStrictSchema,
    durationMs,
    status: "success",
  });

  // Audit log — distinct action names so operators can grep by path during canary.
  void writeLlmAuditLog(role, parsed, durationMs);

  if (parsed.refusal) {
    logger.info({ role, refusal: parsed.refusal }, "LLM explicitly refused");
    return null;
  }

  if (!parsed.text) {
    logger.warn({ role, apiPath: parsed.apiPath }, "OpenAI returned empty response");
    return null;
  }

  logger.info(
    {
      role,
      model: config.model,
      apiPath: parsed.apiPath,
      usedStrictSchema: parsed.usedStrictSchema,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      reasoningTokens: parsed.reasoningTokens,
      durationMs,
    },
    "OpenAI call completed",
  );

  return parsed.text;
}

/**
 * callOpenAIOrFallback — tries cloud first, falls back to Ollama when cloud
 * returns null (circuit open, quota exhausted, missing key, refusal, empty).
 *
 * Added 2026-05-11 Pass 17: scout-extract was returning model_unavailable
 * when openai CB tripped, blocking organic flow. Every role in MODEL_CONFIGS
 * already declares a `fallback: {provider:"ollama", model:"..."}` — this
 * helper actually USES it, which the original callOpenAI did not.
 *
 * Behavior: same return contract as callOpenAI (string | null). Ollama is
 * called with the same role's system prompt joined with the concatenated
 * user/assistant messages and `json: true` (Ollama's structured-output mode).
 */
export async function callOpenAIOrFallback(
  role: ModelRole,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  taskContext?: PromptTaskContext,
): Promise<string | null> {
  const cloud = await callOpenAI(role, messages, taskContext);
  if (cloud) return cloud;

  const config = MODEL_CONFIGS[role];
  if (!config?.fallback || config.fallback.provider !== "ollama") {
    logger.warn({ role }, "callOpenAIOrFallback: cloud null and no ollama fallback configured");
    return null;
  }

  try {
    // Lazy import avoids any circular-dep risk via the logger module chain.
    const { OllamaClient } = await import("./ollama-client.js");
    const ollama = new OllamaClient();
    const systemPrompt = loadSystemPrompt(role, taskContext);
    const userChunks = messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n");
    const prompt = `${systemPrompt}\n\n${userChunks}`;
    const wantJson = config.responseFormat === "json";
    const startedAt = Date.now();
    const res = await ollama.generate(config.fallback.model, prompt, undefined, wantJson);
    const durationMs = Date.now() - startedAt;
    logger.info(
      { role, model: config.fallback.model, durationMs, responseLen: res?.response?.length ?? 0 },
      "callOpenAIOrFallback: Ollama fallback completed",
    );
    return res?.response ?? null;
  } catch (err) {
    logger.error({ role, err }, "callOpenAIOrFallback: Ollama fallback failed");
    return null;
  }
}

/**
 * Cost tracker integration. Imported lazily so the model-router does not
 * eagerly pull in the DB layer for callers (e.g., test harnesses) that
 * mock callOpenAI directly.
 */
async function recordCallTelemetry(
  role: ModelRole,
  payload: {
    apiPath: "chat_completions" | "responses";
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    usedStrictSchema: boolean;
    durationMs: number;
    status: "success" | "error";
  },
): Promise<void> {
  try {
    const { recordLlmCall } = await import("./cost-tracker.js");
    await recordLlmCall({ role, ...payload });
  } catch (err) {
    logger.debug({ err, role }, "cost-tracker.recordLlmCall failed (fire-and-forget)");
  }
}

async function writeLlmAuditLog(
  role: ModelRole,
  parsed: ParsedLLMResponse,
  durationMs: number,
): Promise<void> {
  try {
    const { db } = await import("../db/index.js");
    const { auditLog } = await import("../db/schema.js");
    const action =
      parsed.apiPath === "responses" ? "llm.gpt5mini_call_responses" : "llm.gpt5mini_call";
    await db
      .insert(auditLog)
      .values({
        action,
        decisionAuthority: "system",
        status: "success",
        durationMs,
        result: {
          role,
          apiPath: parsed.apiPath,
          usedStrictSchema: parsed.usedStrictSchema,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          reasoningTokens: parsed.reasoningTokens ?? null,
          finishReason: parsed.finishReason,
          refusal: parsed.refusal ?? null,
        } as Record<string, unknown>,
      });
  } catch (err) {
    logger.debug({ err, role }, "writeLlmAuditLog failed (fire-and-forget)");
  }
}

// ─── W23G.9 — Scout-extract exponential-backoff retry ──────────────────────
//
// Context: 429/5xx/timeout/model_unavailable from OpenAI was failing scout-
// extract outright, losing 5-10% of ideas per cycle. This block adds 3-attempt
// retry with exponential backoff + ±25% jitter, capped at 30s total wall time
// (1s + 4s + 15s delays = 20s delays + ~5s typical API call = well under 30s).
//
// ONLY used by callScoutExtractLlm (transcript_extractor role).
// strategy_proposer has different SLO and the synthesizer refusal contract;
// it MUST NOT be wrapped here.
//
// Audit rows emitted per attempt failure (llm.retry_attempt) and on final
// success-after-retry (llm.recovered_after_retry) or exhaustion
// (llm.exhausted_retries).

/** Reasons that qualify as transient and should be retried. */
export type LlmRetryReason =
  | "http_429"
  | "http_5xx"
  | "network_timeout"
  | "model_unavailable"
  | "rate_limit";

/** Result from withScoutExtractRetry — either the raw text or null (exhausted). */
export interface ScoutExtractRetryResult {
  text: string | null;
  /** true when a retry succeeded after at least one failure */
  recoveredAfterRetry: boolean;
  /** true when all attempts failed */
  exhausted: boolean;
  /** number of attempts made (1 = success on first try) */
  attempts: number;
  /** last retry reason, if any */
  lastReason?: LlmRetryReason;
}

/** Classify an error/status into a retry reason (or null = not retryable). */
export function classifyLlmError(
  err: unknown,
  httpStatus?: number,
): LlmRetryReason | null {
  if (httpStatus === 429) return "http_429";
  if (httpStatus !== undefined && httpStatus >= 500) return "http_5xx";

  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset")
  ) {
    return "network_timeout";
  }
  if (msg.includes("model_unavailable")) return "model_unavailable";
  if (msg.includes("rate_limit")) return "rate_limit";

  // OpenAI SDK wraps HTTP status in .status
  const status = (err as { status?: number })?.status;
  if (status === 429) return "http_429";
  if (typeof status === "number" && status >= 500) return "http_5xx";

  return null;
}

/**
 * Exponential-backoff delays in milliseconds (base values before jitter).
 * Attempt 1 waits 1s, attempt 2 waits 4s, attempt 3 waits 15s.
 * Total wall clock: ~20s delays + API call time < 30s budget.
 */
const SCOUT_RETRY_BASE_DELAYS_MS = [1_000, 4_000, 15_000] as const;
const MAX_SCOUT_ATTEMPTS = 3;

/**
 * withScoutExtractRetry — wraps a single LLM call function with 3-attempt
 * exponential-backoff retry for transient errors.
 *
 * Constraints:
 *   - ONLY for scout_extract / transcript_extractor role.
 *   - Idempotent: same messages in → same extraction logic; no side effects
 *     are introduced by the retry itself.
 *   - Audit rows written fire-and-forget (never block the caller path).
 *   - Total wall-clock budget: 30s (1 + 4 + 15 delays + up to ~5s API call).
 *
 * @param callFn    The raw LLM call to retry. Must throw OR return null to
 *                  signal failure. Returning a non-null string = success.
 * @param auditFn   Fire-and-forget audit writer injected for testability.
 *                  In production pass writeScoutRetryAudit; in tests pass a spy.
 * @param sleepFn   setTimeout wrapper injected for test speed.
 */
export async function withScoutExtractRetry(
  callFn: () => Promise<string | null>,
  auditFn: (row: {
    action: string;
    decisionAuthority: string;
    status: string;
    result: Record<string, unknown>;
  }) => Promise<void>,
  sleepFn: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<ScoutExtractRetryResult> {
  let lastReason: LlmRetryReason | undefined;
  let attempt = 0;

  for (; attempt < MAX_SCOUT_ATTEMPTS; attempt++) {
    try {
      const text = await callFn();

      if (text !== null) {
        // Success path
        if (attempt > 0) {
          // Recovered after at least one retry
          void auditFn({
            action: "llm.recovered_after_retry",
            decisionAuthority: "system",
            status: "success",
            result: {
              role: "scout_extract",
              model_id: MODEL_CONFIGS.transcript_extractor?.model ?? "unknown",
              attempts_total: attempt + 1,
              last_reason: lastReason ?? null,
            },
          });
        }
        return {
          text,
          recoveredAfterRetry: attempt > 0,
          exhausted: false,
          attempts: attempt + 1,
          lastReason,
        };
      }

      // callFn returned null — OpenAI returned nothing (budget, circuit, refusal).
      // Treat as non-retryable (budget gate / circuit open are not transient).
      return {
        text: null,
        recoveredAfterRetry: false,
        exhausted: false,
        attempts: attempt + 1,
        lastReason: undefined,
      };
    } catch (err: unknown) {
      const reason = classifyLlmError(err);
      if (!reason) {
        // Non-transient error — do not retry
        logger.warn(
          { err, attempt: attempt + 1, role: "scout_extract" },
          "withScoutExtractRetry: non-transient error, not retrying",
        );
        return {
          text: null,
          recoveredAfterRetry: false,
          exhausted: false,
          attempts: attempt + 1,
          lastReason: undefined,
        };
      }

      lastReason = reason;

      // Emit audit row for this failed attempt (fire-and-forget)
      void auditFn({
        action: "llm.retry_attempt",
        decisionAuthority: "system",
        status: "retrying",
        result: {
          role: "scout_extract",
          attempt: attempt + 1,
          reason,
          model_id: MODEL_CONFIGS.transcript_extractor?.model ?? "unknown",
          err_message: err instanceof Error ? err.message : String(err ?? ""),
        },
      });

      const isLastAttempt = attempt === MAX_SCOUT_ATTEMPTS - 1;
      if (isLastAttempt) break; // fall through to exhaustion path

      // Apply jitter ±25% to avoid retry storms
      const base = SCOUT_RETRY_BASE_DELAYS_MS[attempt] ?? 1_000;
      const jitter = base * 0.25 * (Math.random() * 2 - 1); // [-25%, +25%]
      const delay = Math.max(100, Math.round(base + jitter));
      logger.info(
        { role: "scout_extract", attempt: attempt + 1, reason, delay_ms: delay },
        "withScoutExtractRetry: transient error, retrying after backoff",
      );
      await sleepFn(delay);
    }
  }

  // All attempts exhausted
  void auditFn({
    action: "llm.exhausted_retries",
    decisionAuthority: "gate",
    status: "rejected",
    result: {
      role: "scout_extract",
      attempts_total: MAX_SCOUT_ATTEMPTS,
      last_reason: lastReason ?? null,
      model_id: MODEL_CONFIGS.transcript_extractor?.model ?? "unknown",
    },
  });
  logger.warn(
    { role: "scout_extract", last_reason: lastReason },
    "withScoutExtractRetry: all retries exhausted, routing to Ollama fallback",
  );

  return {
    text: null,
    recoveredAfterRetry: false,
    exhausted: true,
    attempts: MAX_SCOUT_ATTEMPTS,
    lastReason,
  };
}

/**
 * Audit writer used by callScoutExtractLlm in production.
 * Lazily imports db/schema to avoid eager bootstrap graph pull.
 */
async function writeScoutRetryAudit(row: {
  action: string;
  decisionAuthority: string;
  status: string;
  result: Record<string, unknown>;
}): Promise<void> {
  try {
    const { db } = await import("../db/index.js");
    const { auditLog } = await import("../db/schema.js");
    await db.insert(auditLog).values({
      action: row.action,
      decisionAuthority: row.decisionAuthority as "system" | "gate" | "agent" | "operator",
      status: row.status as "success" | "failure" | "retrying" | "rejected",
      result: row.result,
    });
  } catch (err) {
    logger.debug({ err, action: row.action }, "writeScoutRetryAudit: audit insert failed (fire-and-forget)");
  }
}

/**
 * callScoutExtractLlm — production entry-point for scout_extract / transcript_extractor
 * LLM calls with exponential-backoff retry and Ollama fallback on exhaustion.
 *
 * ONLY use this for the transcript_extractor role in the scout-extract route.
 * Do NOT use for strategy_proposer (different SLO + synthesizer refusal contract).
 *
 * Retry behaviour: up to 3 attempts, delays 1s / 4s / 15s (±25% jitter).
 * Retries on: HTTP 429, HTTP 5xx, network timeout, model_unavailable, rate_limit.
 * On exhaustion: falls back to Ollama qwen2.5-coder:7b (deterministic) via the
 * same Ollama path as callOpenAIOrFallback.
 *
 * @param messages    Chat messages to send (same contract as callOpenAI).
 * @param taskContext Optional task context for prompt caching.
 * @param callFn      Injected for tests; defaults to callOpenAI.
 * @param sleepFn     Injected for tests to avoid real setTimeout delays.
 */
export async function callScoutExtractLlm(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  taskContext?: PromptTaskContext,
  callFn: typeof callOpenAI = callOpenAI,
  sleepFn?: (ms: number) => Promise<void>,
): Promise<string | null> {
  const role = "transcript_extractor" as const;

  const result = await withScoutExtractRetry(
    () => callFn(role, messages, taskContext),
    writeScoutRetryAudit,
    sleepFn,
  );

  if (result.text !== null) return result.text;

  // Fallback to Ollama — either on exhaustion (transient LLM errors) or on
  // clean null (budget gate / circuit open). callOpenAIOrFallback already
  // handles the Ollama path; route through it so we don't duplicate that logic.
  // On retry-exhaustion, cloud is known bad — skip cloud call, go direct to Ollama.
  if (result.exhausted) {
    const config = MODEL_CONFIGS[role];
    if (!config?.fallback || config.fallback.provider !== "ollama") {
      logger.warn({ role }, "callScoutExtractLlm: retries exhausted but no Ollama fallback configured");
      return null;
    }
    try {
      const { OllamaClient } = await import("./ollama-client.js");
      const ollama = new OllamaClient();
      const systemPrompt = loadSystemPrompt(role, taskContext);
      const userChunks = messages
        .filter((m) => m.role !== "system")
        .map((m) => m.content)
        .join("\n\n");
      const prompt = `${systemPrompt}\n\n${userChunks}`;
      const wantJson = config.responseFormat === "json";
      const startedAt = Date.now();
      const res = await ollama.generate(config.fallback.model, prompt, undefined, wantJson);
      const durationMs = Date.now() - startedAt;
      logger.info(
        { role, model: config.fallback.model, durationMs, responseLen: res?.response?.length ?? 0, retries_exhausted: true },
        "callScoutExtractLlm: Ollama fallback after retry exhaustion completed",
      );
      return res?.response ?? null;
    } catch (err) {
      logger.error({ role, err }, "callScoutExtractLlm: Ollama fallback after retry exhaustion failed");
      return null;
    }
  }

  // Clean null from callOpenAI (budget gate / circuit open / refusal) — delegate
  // to callOpenAIOrFallback which handles the Ollama path with proper logging.
  return callOpenAIOrFallback(role, messages, taskContext);
}

export { MODEL_CONFIGS, KB_MANIFEST, FEWSHOT_ROLES };
