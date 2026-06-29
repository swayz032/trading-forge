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

// ─── Wave 26 — Transcript Extractor local-first routing ───────────────────────
//
// gemma4:e2b is the LOCAL PRIMARY for transcript_extractor.
// Cloud gpt-5-mini is the FALLBACK (fires only on Ollama failure or force-cloud).
//
// OLLAMA_HEALTHY is set by checkTranscriptExtractorOllamaHealth() at module load.
// Module-level flag (not exported) — callers route through callScoutExtractLlm()
// which reads it. Starts as true; set false only if boot ping fails or model
// is not found in tags list.
let OLLAMA_HEALTHY = true;

// E-BOOT (2026-06-22): the test-inference probe was a single 15s call with NO keep_alive —
// cold-loading a 7GB gemma4:e2b on 8GB VRAM during a busy boot (migrations + disk I/O)
// routinely exceeds 15s, leaving OLLAMA_HEALTHY stuck false and routing extraction to the
// forbidden cloud → null (the live-test root cause). This shared helper warm-loads the model
// (keep_alive HOLDS it in VRAM so the subsequent extraction calls are warm), uses a 60s
// timeout, and retries once. Used by both the boot probe and the runtime recheck.
// 2026-06-23 cold-load-spiral fix: gemma4:e2b's FULL cold-load (5.1B + 514906-merge tokenizer)
// can exceed 60s on the 8GB tower. A probe that aborts mid-load makes Ollama abort the load
// ("client connection closed before llama-server finished loading") → the next request cold-loads
// again → infinite OLLAMA_HEALTHY=false + circuit-breaker-OPEN spiral. Two defenses:
//   (1) 180s probe budget so the boot probe WAITS for a cold-load instead of aborting it.
//   (2) keep_alive=-1 so the probe PINS the model in VRAM — once loaded it never idles out,
//       so subsequent extraction calls are always warm (no cold-load under a request, ever).
// Both are also enforced daemon-side via OLLAMA_KEEP_ALIVE=-1; this is defence-in-depth for the
// per-request path and for any Ollama whose daemon env wasn't set.
const BOOT_PROBE_MS = Number(process.env.TRANSCRIPT_EXTRACTOR_BOOT_PROBE_MS) || 180_000;
// Ollama keep_alive: the NUMBER -1 means "pin in VRAM forever"; a duration string needs a unit
// ("30m"). The string "-1" is INVALID — Ollama's duration parser rejects it ("missing unit in
// duration -1"), which silently fails the health probe → OLLAMA_HEALTHY stuck false. So emit the
// numeric -1 when the env says "-1"/unset; otherwise pass the duration string through verbatim.
const _kaEnv = process.env.TRANSCRIPT_EXTRACTOR_KEEP_ALIVE || "-1";
const PROBE_KEEP_ALIVE: string | number = _kaEnv === "-1" ? -1 : _kaEnv;

async function runTestInferenceProbe(
  ollamaBase: string,
  targetModel: string,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 2026-06-23 false-negative fix: probe the SAME endpoint the extractor uses — /api/chat,
      // NOT /api/generate. On this tower gemma4:e2b returns empty/invalid on /api/generate while
      // /api/chat works fine; a /api/generate probe therefore false-negatives → OLLAMA_HEALTHY
      // stuck false → extractions wrongly route to the (forbidden) cloud fallback. The health
      // probe MUST exercise the production code path or it isn't a health check.
      // NO `format` constraint on the probe: gemma4:e2b returns EMPTY under generic
      // `format:"json"` (Ollama #15260 grammar bug) even though it executes fine. The probe only
      // needs to confirm the model loads + emits text; the extractor's own `format:<schema>`
      // (specific GBNF) is a different, working path. A health check that triggers a known
      // empty-output bug is worse than no check — it false-negatives every boot.
      const probeRes = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
          stream: false,
          keep_alive: PROBE_KEEP_ALIVE,
          options: { num_predict: 16 },
        }),
        signal: AbortSignal.timeout(BOOT_PROBE_MS),
      });
      const probeData = (await probeRes.json()) as {
        message?: { content?: string };
        eval_count?: number;
        error?: string;
      };
      // Healthy = HTTP ok, no error, AND the model actually GENERATED tokens (eval_count > 0).
      // We do NOT require non-empty content text: gemma4:e2b can emit leading whitespace and hit
      // the num_predict cap (done_reason="length") with blank visible content while still
      // executing perfectly — checking content-emptiness false-negatives that. The real failure
      // mode (the cold-load spiral) is a HANG/timeout or HTTP error, which eval_count>0 excludes.
      const executed = typeof probeData.eval_count === "number" && probeData.eval_count > 0;
      if (!probeRes.ok || probeData.error || !executed) {
        if (attempt === 0) continue; // one retry
        return { ok: false, error: probeData.error ?? (!executed ? "no_tokens_generated" : `HTTP ${probeRes.status}`) };
      }
      return { ok: true };
    } catch (e) {
      if (attempt === 0) continue; // one retry (e.g. first-call cold-load timeout)
      return { ok: false, error: (e as Error).message };
    }
  }
  return { ok: false, error: "probe_exhausted" };
}

/**
 * Whether TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true is set in the environment.
 * Operator panic-revert: flips primary back to gpt-5-mini without code change.
 * Evaluated at module load AND re-read per call so a process restart picks it up.
 */
function isForceCloud(): boolean {
  return (process.env.TRANSCRIPT_EXTRACTOR_FORCE_CLOUD ?? "false") === "true";
}

/** Local model name — overridable per deployment.
 *
 * Wave 26 Pass B (2026-05-25): primary is gemma4 (operator's choice).
 * Pass B ALSO ships the universal fixes that make gemma4 work for strict JSON:
 *   1. JSON Schema object as `format` (Ollama GBNF grammar-constrained sampling
 *      — forces output shape at the token level, not just "valid JSON")
 *   2. /api/chat endpoint (proper Gemma <start_of_turn>user/model template)
 *   3. temperature=0, top_p=0.9, top_k=20 (strict sampling)
 *   4. NO `think` field anywhere (Ollama bug #15260 silently drops schema
 *      enforcement on gemma4 when think:false is explicitly set — omit entirely)
 *   5. Literal "Return JSON matching the schema." in user message
 *
 * Bug 2026-05-26: bare "gemma4" returned `{"error":"model 'gemma4' not found"}`
 * from Ollama (no gemma4:latest alias shipped). Default is now the tagged
 * "gemma4:e2b" — matches the actual pulled model. */
function getLocalTranscriptModel(): string {
  return process.env.TRANSCRIPT_EXTRACTOR_LOCAL_MODEL ?? "gemma4:e2b";
}

/**
 * Whether strict JSON Schema enforcement is enabled (Ollama GBNF grammar sampling).
 *
 * When true (default): passes the full transcript-extractor-output-schema.json
 * as `format` object to Ollama /api/chat → GBNF-constrained sampling enforces
 * `{strategies: [...], empty_reason?, ...}` shape at the token level.
 *
 * When false: falls back to `format: "json"` string mode (syntactic JSON only,
 * no shape control — legacy behavior).
 *
 * Set TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false as an escape hatch if schema
 * enforcement breaks on a specific model deployment.
 *
 * IMPORTANT: Never set `think: false` anywhere in the Ollama request body.
 * Ollama bug #15260 — passing `think: false` silently drops `format` schema
 * enforcement on gemma4. The fix is to omit `think` entirely.
 */
function isStrictSchemaMode(): boolean {
  const val = process.env.TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA;
  // Default true — only disable when explicitly set to "false"
  return val !== "false";
}

/** Ollama context window for transcript_extractor.
 *
 * Wave 26 Pass I (v11): default raised 16384 → 32768.
 * Rationale: 23K-char transcripts (e.g. dE4lPhAWke8) + v11 extended-rule
 * prompt (~6K tokens with KB injection + few-shot) + v11 richer output (4K+)
 * requires 32K to avoid truncation. 16K covered ~95% of v10 transcripts but
 * failed on long-form institutional strategy videos. RTX 5060 8 GB VRAM:
 * gemma4:e2b (~5.5 GB) + 32K ctx (~4.8 GB KV cache) FITS but is tight.
 * Operator can lower to 16384 for VRAM relief via TRANSCRIPT_EXTRACTOR_NUM_CTX=16384. */
//
// Wave 26 Pass L (2026-05-27) — chunked-path NUM_CTX override.
// The chunker (src/server/lib/transcript-chunker.ts) sets this transient
// override before each per-chunk callScoutExtractLlm() invocation and clears
// it after. Lets the chunked path use a smaller, OOM-safe ctx (default 12288
// = ~3K tokens transcript chunk + ~3K prompt + 4K output) without disturbing
// the global TRANSCRIPT_EXTRACTOR_NUM_CTX=32768 that 5 long-form videos
// already depend on. Pure in-process — no env mutation, no async leakage.
let _chunkedNumCtxOverride: number | null = null;
export function setChunkedNumCtxOverride(n: number | null): void {
  if (n === null) { _chunkedNumCtxOverride = null; return; }
  if (!Number.isFinite(n) || n < 2048 || n > 131072) return;
  _chunkedNumCtxOverride = n;
}
function getTranscriptOllamaNumCtx(): number {
  if (_chunkedNumCtxOverride !== null) return _chunkedNumCtxOverride;
  const raw = process.env.TRANSCRIPT_EXTRACTOR_NUM_CTX;
  const parsed = raw ? Number.parseInt(raw, 10) : 32768;
  if (!Number.isFinite(parsed) || parsed < 2048 || parsed > 131072) return 32768;
  return parsed;
}

/**
 * Determine the effective provider for transcript_extractor at module load.
 * Force-cloud and Ollama unhealthy both flip to cloud.
 */
function getTranscriptExtractorProvider(): "openai" | "ollama" {
  if (isForceCloud()) return "openai";
  if (!OLLAMA_HEALTHY) return "openai";
  return "ollama";
}

function getTranscriptExtractorModel(): string {
  if (isForceCloud()) return "gpt-5-mini";
  if (!OLLAMA_HEALTHY) return "gpt-5-mini";
  return getLocalTranscriptModel();
}

function getTranscriptExtractorFallbackProvider(): "openai" | "ollama" {
  // When primary is Ollama → fallback is cloud
  // When primary is cloud (force or unhealthy) → no meaningful fallback (stays cloud)
  if (isForceCloud() || !OLLAMA_HEALTHY) return "openai";
  return "openai";
}

function getTranscriptExtractorFallbackModel(): string {
  return "gpt-5-mini";
}

/**
 * Ping Ollama at boot to confirm gemma4:e2b is available AND executable.
 *
 * Two-phase check:
 *   1. /api/tags — confirm model exists in registry
 *   2. Test inference — send a tiny JSON probe to confirm the model can actually
 *      load and execute (catches "memory layout cannot be allocated" errors from
 *      Ollama versions that list gemma4 but cannot run it, e.g. Ollama < 0.4.x)
 *
 * Sets OLLAMA_HEALTHY=false if either phase fails.
 * Fire-and-forget: any error is logged and swallowed — never blocks startup.
 */
export async function checkTranscriptExtractorOllamaHealth(): Promise<void> {
  const ollamaBase = process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const targetModel = getLocalTranscriptModel();
  try {
    // Phase 1: tags check
    const res = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { status: res.status, ollamaBase },
        "model-router: Ollama health ping returned non-OK — transcript_extractor routing to cloud fallback",
      );
      return;
    }
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    const modelFound = models.some(
      (m) => m.name === targetModel || m.name.startsWith(targetModel.split(":")[0] ?? ""),
    );
    if (!modelFound) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { targetModel, available: models.map((m) => m.name) },
        "model-router: gemma4:e2b not found in Ollama tags — transcript_extractor routing to cloud fallback",
      );
      return;
    }

    // Phase 2: test inference — send a tiny probe to verify the model actually loads.
    // Catches "memory layout cannot be allocated" errors that occur with older Ollama
    // versions (< 0.4.x) that list Gemma 4 in tags but cannot execute it.
    // 15s timeout — model cold-start can be slow but should not exceed 15s for a 2-token response.
    const probe = await runTestInferenceProbe(ollamaBase, targetModel);
    if (!probe.ok) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { targetModel, ollamaBase, probeError: probe.error },
        "model-router: Ollama test-inference probe failed — transcript_extractor routing to cloud fallback (model cannot execute; check Ollama version ≥ 0.4.x for gemma4 support)",
      );
      return;
    }

    OLLAMA_HEALTHY = true;
    logger.info(
      { targetModel, ollamaBase },
      "model-router: Ollama health OK — transcript_extractor primary is local gemma4:e2b",
    );
  } catch (err) {
    OLLAMA_HEALTHY = false;
    logger.warn(
      { err, ollamaBase, targetModel },
      "model-router: Ollama health check failed — transcript_extractor routing to cloud fallback",
    );
  }
}

/**
 * recheckOllamaHealth — runtime recheck of the Ollama health state.
 *
 * Re-runs the same 2-phase probe as checkTranscriptExtractorOllamaHealth
 * (Phase 1: /api/tags registry, Phase 2: /api/generate test-inference) and
 * resets OLLAMA_HEALTHY at runtime.
 *
 * Called by POST /api/admin/ollama-health-recheck to recover from the
 * stuck-false scenario (NSSM respawn or keep_alive:0 unload after boot-time
 * health check ran). Returns the new value of OLLAMA_HEALTHY so the caller
 * can surface it in the response.
 *
 * Never throws — errors are logged and reflected in the return value.
 */
export async function recheckOllamaHealth(): Promise<{ healthy: boolean; reason?: string }> {
  const ollamaBase = process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const targetModel = getLocalTranscriptModel();
  try {
    // Phase 1: tags check
    const res = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { status: res.status, ollamaBase },
        "model-router: recheckOllamaHealth Phase 1 failed — /api/tags non-OK",
      );
      return { healthy: false, reason: `tags_non_ok_${res.status}` };
    }
    const data = await res.json() as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    const modelFound = models.some(
      (m) => m.name === targetModel || m.name.startsWith(targetModel.split(":")[0] ?? ""),
    );
    if (!modelFound) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { targetModel, available: models.map((m) => m.name) },
        "model-router: recheckOllamaHealth Phase 1 failed — model not found in tags",
      );
      return { healthy: false, reason: "model_not_in_tags" };
    }

    // Phase 2: test-inference probe
    const probe = await runTestInferenceProbe(ollamaBase, targetModel);
    if (!probe.ok) {
      OLLAMA_HEALTHY = false;
      logger.warn(
        { targetModel, ollamaBase, probeError: probe.error },
        "model-router: recheckOllamaHealth Phase 2 failed — test-inference probe failed",
      );
      return { healthy: false, reason: probe.error ?? "probe_failed" };
    }

    OLLAMA_HEALTHY = true;
    logger.info(
      { targetModel, ollamaBase },
      "model-router: recheckOllamaHealth succeeded — OLLAMA_HEALTHY reset to true",
    );
    return { healthy: true };
  } catch (err) {
    OLLAMA_HEALTHY = false;
    const reason = err instanceof Error ? err.message : String(err ?? "unknown");
    logger.warn(
      { err, ollamaBase, targetModel },
      "model-router: recheckOllamaHealth threw — OLLAMA_HEALTHY set false",
    );
    return { healthy: false, reason };
  }
}

/**
 * Production setter: force OLLAMA_HEALTHY to false so extraction routes to
 * the cloud fallback. Used by the ollama-keepwarm-watchdog after recovery
 * ladder exhaustion (Step C). Does NOT affect the circuit breaker — callers
 * should call recheckOllamaHealth() on recovery to re-enable local routing.
 */
let _lastOllamaUnhealthyNotifyMs = 0;
export function setOllamaUnhealthy(reason: string): void {
  const wasHealthy = OLLAMA_HEALTHY;
  OLLAMA_HEALTHY = false;
  logger.warn(
    { reason },
    "model-router: OLLAMA_HEALTHY set false by production caller — cloud fallback active",
  );
  // Deep-scan #5 A-4 (2026-06-29): local Ollama going unhealthy was log-only — the operator
  // got NO Discord ping even though cloud fallback now incurs cost and OLLAMA_HEALTHY has a
  // documented stuck-false history. Fire a deduped warning (on the healthy→unhealthy edge,
  // and at most once per OLLAMA_UNHEALTHY_NOTIFY_COOLDOWN_MS). Dynamic import avoids any
  // static import cycle through this low-level module; fully fail-soft.
  const cooldownMs = Number(process.env.OLLAMA_UNHEALTHY_NOTIFY_COOLDOWN_MS ?? 30 * 60 * 1000);
  const now = Date.now();
  if (wasHealthy || now - _lastOllamaUnhealthyNotifyMs > cooldownMs) {
    _lastOllamaUnhealthyNotifyMs = now;
    import("./notification-service.js")
      .then(({ notifyWarning }) =>
        notifyWarning(
          "Local LLM (Ollama) unhealthy — cloud fallback active",
          `model-router set OLLAMA_HEALTHY=false (reason: ${reason}). Transcript extraction is now routing to the cloud fallback (incurs cost). The system auto-rechecks on recovery; if this persists, the tower's Ollama may need a restart or model re-pull.`,
        ),
      )
      .catch((e) => logger.warn({ err: e }, "model-router: ollama-unhealthy Discord notify failed (non-blocking)"));
  }
}

/**
 * Test helper: override OLLAMA_HEALTHY state.
 * Production code should use setOllamaUnhealthy() instead.
 */
export function __setOllamaHealthyForTests(healthy: boolean): void {
  OLLAMA_HEALTHY = healthy;
}

/**
 * Test helper: read current OLLAMA_HEALTHY state.
 */
export function __getOllamaHealthyForTests(): boolean {
  return OLLAMA_HEALTHY;
}

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
    provider: "ollama" | "openai";
    model: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "json" | "text";
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
  | "trade_critique"            // NEW (Wave 26 Pass 1 — per-trade autopsy; GPT-5.4 + Ollama fallback)
  | "pattern_aggregator"        // NEW (Wave 26 Pass 4 — nightly+trade critique feedback loop; GPT-5.4 text output)
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
  // Wave 26 Pass L (2026-05-27) — KB cards gated on TRANSCRIPT_EXTRACTOR_USE_LEGACY.
  // Minimal prompt is self-contained (8 fields, flat schema). Injecting the legacy
  // strategy-schema-snapshot.json on top of the minimal prompt caused gemma4:e2b to
  // ignore the minimal 8-field shape and output the W23H legacy fields (entry_long,
  // entry_short, entry_indicator, symbol, max_contracts) because the KB card looks
  // more authoritative than the prompt. Probe N7uP9V0Iktc confirmed the regression
  // on 2026-05-27 — gemma returned PLTR / W23H shape even though minimal prompt was
  // loaded. Fix: legacy flag flips BOTH prompt AND KB cards atomically.
  transcript_extractor:
    (process.env.TRANSCRIPT_EXTRACTOR_USE_LEGACY ?? "false").toLowerCase() === "true"
      ? ["kb/strategy-schema-snapshot.json", "kb/indicator-catalog.md"]
      : [],
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
  // trade_critique — institutional per-trade autopsy. Prop-firm rules summary
  // gives the rubric grounding on Topstep consistency cap math.
  trade_critique: ["kb/prop-firm-rules-summary.md"],
  // pattern_aggregator — reads trade_critique rows as context; no KB cards needed.
  // The trade_critique rows ARE the context; KB cards would dilute the signal.
  pattern_aggregator: [],
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
  //
  // Wave 26 (local-first swap): primary flipped to local Ollama gemma4:e2b
  // (5.1B effective-2B, Q4_K_M, 7.2 GB) — 96.7% of GPT-5-mini burn traced
  // to this single role (127.7M tokens / 7,938 calls over 15 days). Cloud
  // gpt-5-mini is now the FALLBACK (fires only when Ollama is down, returns
  // invalid JSON, or times out, or TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true).
  // Prompt + KB cards + few-shot UNCHANGED — model swap only.
  // Boot health check sets OLLAMA_HEALTHY module flag; FORCE_CLOUD is the
  // operator panic-revert without code change.
  transcript_extractor: {
    provider: getTranscriptExtractorProvider(),
    model: getTranscriptExtractorModel(),
    temperature: 0.3,
    maxTokens: 8192,
    // Wave 26 Pass L (2026-05-27) — Minimal 8-field prompt is the default.
    // Legacy 940-line v12 prompt available via TRANSCRIPT_EXTRACTOR_USE_LEGACY=true.
    // The minimal prompt fixed gemma4:e2b's recursive-loop bug + restored extraction
    // depth. Direct A/B probe: v12 = 82s + infinite recursive output; minimal = 29s
    // + clean JSON with strategies/stop/confluences populated.
    systemPromptPath: getTranscriptExtractorPromptPath(),
    responseFormat: "json",
    // NOTE: responsesApiVersion intentionally NOT set for Ollama primary path.
    // When force-cloud is active the provider flips to "openai" but we still
    // do NOT use the Responses API — json_object mode is correct here because
    // loadStrictSchemaForRole returns null for transcript_extractor (W23H fix13).
    fallback: {
      provider: getTranscriptExtractorFallbackProvider(),
      model: getTranscriptExtractorFallbackModel(),
      temperature: 0.3,
      maxTokens: 8192,
      responseFormat: "json",
    },
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
  // ─── Wave 26 Pass 1: trade_critique ──────────────────────────────────────
  // GPT-5.4 full model (operator-specified literal — do NOT normalise to mini).
  // 8192 token output budget for dual-output JSON (technical_diagnosis +
  // plain_english_summary) plus chain-of-thought attribution reasoning.
  // Strict Responses-API schema enforcement (NOT json_object — institutional bar).
  // Fallback: Ollama deepseek-r1:14b (reasoning model appropriate for trade autopsy).
  trade_critique: {
    provider: "openai",
    model: "gpt-5.4",
    temperature: 0.2,
    maxTokens: 8192,
    systemPromptPath: "src/agents/trade-critique.md",
    responseFormat: "json",
    responsesApiVersion: "v1",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
    timeoutMs: 90_000, // full-model reasoning needs more headroom than mini
  },
  // ─── Wave 26 Pass 4: pattern_aggregator ──────────────────────────────────
  // GPT-5.4 full model — reads trade_critique technical_diagnosis batch and
  // emits a strategy_proposer prompt appendix as plain-text markdown (NOT JSON).
  // responseFormat:"text" bypasses buildJsonSchema entirely — this role emits
  // prompt-appendix markdown, not structured data.
  // Fallback: Ollama deepseek-r1:14b (reasoning model for pattern synthesis).
  pattern_aggregator: {
    provider: "openai",
    model: "gpt-5.4",
    temperature: 0.2,
    maxTokens: 8192,
    systemPromptPath: "src/agents/pattern-aggregator.md",
    responseFormat: "text",
    fallback: { provider: "ollama", model: "deepseek-r1:14b" },
    timeoutMs: 90_000,
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

// ─── Wave 26 Pass 4: Appendix cache (architectural loop fix) ───────────────
//
// Problem: buildPromptSync() is SYNCHRONOUS but getActivePromptContent() is ASYNC.
// They cannot be directly composed in the hot path without adding async/await
// to every buildPromptSync caller (breaking 8+ callers).
//
// Solution: module-level Map<string, string> warmed at boot and updated by
// pattern-aggregator-service after each aggregation run. buildPromptSync reads
// the map synchronously — no I/O, no async in hot path.
//
// The map is NOT exported directly to prevent callers from mutating it without
// the telemetry side-effect. Use setAppendixCache() to mutate.

const _appendixCache = new Map<string, string>();

/**
 * Update the appendix cache for a prompt type. Called by pattern-aggregator-service
 * after each successful aggregation run. Also called by warmAppendixCache() at boot.
 *
 * Thread-safe: JavaScript single-threaded; Map.set() is atomic.
 *
 * F-4 fix (Wave B): also invalidates every promptCache entry whose key starts
 * with the same promptType prefix so the NEXT loadSystemPrompt() call rebuilds
 * with the freshly injected appendix instead of serving a stale 60-second TTL hit.
 * The __clearPromptCacheForTests export remains intact.
 */
export function setAppendixCache(promptType: string, content: string): void {
  _appendixCache.set(promptType, content);

  // Invalidate any cached prompt that was built with the old appendix value.
  // cacheKey() produces "<role>::<ctx-json>" — exact role match covers all contexts.
  for (const key of promptCache.keys()) {
    if (key.startsWith(`${promptType}::`)) {
      promptCache.delete(key);
    }
  }

  logger.info(
    { promptType, contentLength: content.length },
    "model-router: appendix cache updated + promptCache entries invalidated",
  );
}

/**
 * Return the number of entries in the appendix cache.
 * Used by tests and diagnostics — not business logic.
 */
export function getAppendixCacheSize(): number {
  return _appendixCache.size;
}

/**
 * Boot-warm the appendix cache by reading active prompt_versions rows.
 * Call once at startup AFTER migrations apply. Fail-open: any error is
 * logged as info and the cache starts empty (no strategy generation blocked).
 *
 * Imports DB lazily to avoid circular dependency at module-load time.
 */
export async function warmAppendixCache(): Promise<void> {
  try {
    // Lazy import to avoid circular at module-load (model-router → db before db is ready)
    const { db } = await import("../db/index.js");
    const { promptVersions } = await import("../db/schema.js");
    const { eq } = await import("drizzle-orm");

    const activeVersions = await db
      .select({ promptType: promptVersions.promptType, content: promptVersions.content })
      .from(promptVersions)
      .where(eq(promptVersions.isActive, true));

    for (const row of activeVersions) {
      if (row.content && row.content.trim().length > 0) {
        _appendixCache.set(row.promptType, row.content);
      }
    }

    logger.info(
      { warmedCount: activeVersions.length, cacheSize: _appendixCache.size },
      "model-router: appendix cache warmed at boot",
    );
  } catch (err) {
    logger.info(
      { err },
      "model-router: appendix cache warm failed at boot — starting empty (non-blocking)",
    );
  }
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

/**
 * Test helper — clears the appendix cache. Exposed for unit tests that need
 * a clean appendix state between assertions. Production code never calls this.
 */
export function __clearAppendixCacheForTests(): void {
  _appendixCache.clear();
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
  if (typeof parsed === "object" && parsed !== null && "input" in parsed) {
    const obj = parsed as Record<string, unknown>;
    // Accept both `output` and `expected_output` keys (authoring convention drift).
    // W23H-postmortem-fix16 (2026-05-21): transcript-extractor + scout-auditor +
    // dsl-quality-critic + strategy-proposer use `expected_output`. Previously
    // these silently fell through to the raw JSON dump path, losing the
    // INPUT/OUTPUT framing that teaches the LLM the example pattern.
    const outputKey = "output" in obj ? "output" : "expected_output" in obj ? "expected_output" : null;
    if (outputKey) {
      const inputStr =
        typeof obj.input === "string" ? obj.input : JSON.stringify(obj.input, null, 2);
      const out = obj[outputKey];
      const outputStr = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return `INPUT: ${inputStr}\n→ OUTPUT: ${outputStr}`;
    }
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

  // 4. Wave 26 Pass 4: Appendix cache injection (synchronous — no async in hot path).
  //    Reads the module-level _appendixCache populated by warmAppendixCache() at boot
  //    and updated by pattern-aggregator-service after each aggregation run.
  //    Sampled telemetry: audit row fires 1-in-100 cache hits to avoid per-call spam.
  const appendix = _appendixCache.get(role);
  if (appendix && appendix.trim().length > 0) {
    parts.push(appendix.trim());
    // Sampled 1-in-100 telemetry — fire-and-forget, never throws, never awaited
    if (Math.random() < 0.01) {
      import("../db/index.js").then(({ db }) =>
        import("../db/schema.js").then(({ auditLog }) =>
          db.insert(auditLog).values({
            action: "pattern_evolution.applied",
            entityType: "model_router",
            status: "success",
            result: { role, appendix_length: appendix.length },
            decisionAuthority: "scheduler",
          }).catch(() => {}),
        ),
      ).catch(() => {});
    }
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
    // W23H-postmortem-fix13 (2026-05-21): transcript_extractor reverted to
    // json_object mode. Strict schema with 35 required fields made GPT-5-mini
    // emit `strategies: []` rather than try to satisfy. Direct A/B proved
    // json_object + v9 prompt produces every W23H field (bias_timeframe,
    // confirming_indicators, preferred_regimes) on JackTrades transcript;
    // strict mode produced empty across all 5 test transcripts.
    // strategy_proposer kept on strict (separate SLO + smaller surface).
    case "transcript_extractor":
      return null;
    case "strategy_proposer": {
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
            description: "For multi-step strategies (ICT/SMC/Wyckoff/CRT) and confluence strategies, list each subsidiary structural mechanic. Required field — emit null only for TRULY single-step single-condition strategies (rare). params_json is a JSON-encoded string of indicator parameters (e.g. '{\"period\":14}') to satisfy strict-mode constraints — emit '{}' if no params.",
            items: {
              type: "object",
              properties: {
                indicator: { type: "string" },
                params_json: { type: "string", description: "JSON-encoded params object as string. Use '{}' for no params." },
                direction: { type: "string", enum: ["agree", "disagree", "either"] },
              },
              required: ["indicator", "params_json", "direction"],
              additionalProperties: false,
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
        const mergedProps = { ...(base.properties ?? {}), ...w23hExtensions };
        const newRequired = Array.from(new Set([...(base.required ?? []), ...Object.keys(w23hExtensions)]));
        const merged = {
          ...base,
          properties: mergedProps,
          required: newRequired,
          additionalProperties: false,
        };

        // W23H-postmortem (2026-05-20): OpenAI strict-mode constraints are
        // unforgiving. Recursively enforce them on every object node:
        //   1. additionalProperties: false (mandatory at every level)
        //   2. ALL properties must appear in required[] (use nullable type
        //      to allow LLM to emit null when N/A).
        //   3. Strip $defs (snapshot has a couple of incompatible defs that
        //      OpenAI's validator chokes on; refs are inlined elsewhere).
        const normalizeStrict = (node: unknown): unknown => {
          if (Array.isArray(node)) return node.map(normalizeStrict);
          if (node === null || typeof node !== "object") return node;
          const obj = node as Record<string, unknown>;
          // Strip keywords OpenAI strict mode does not support
          delete obj.default;
          // $ref cannot have sibling keywords in strict mode — strip everything else
          if (typeof obj.$ref === "string") {
            for (const k of Object.keys(obj)) if (k !== "$ref") delete obj[k];
            return obj;
          }
          // Recurse into all values first
          for (const k of Object.keys(obj)) obj[k] = normalizeStrict(obj[k]);
          // Free-form object detection: strict mode forbids "type:'object'" without
          // explicit properties. Convert to JSON-encoded string. The scout-extract
          // route handler parses the string back to an object for downstream code.
          const isFreeFormObject =
            (obj.type === "object" || (Array.isArray(obj.type) && (obj.type as unknown[]).includes("object"))) &&
            (!obj.properties || (typeof obj.properties === "object" && Object.keys(obj.properties as object).length === 0));
          if (isFreeFormObject) {
            const desc = typeof obj.description === "string"
              ? `${obj.description} (emit as JSON-encoded string, e.g. '{"period":14}')`
              : 'JSON-encoded object as string (e.g. \'{"period":14}\')';
            // Erase object-typed fields and replace with nullable string
            for (const k of Object.keys(obj)) delete obj[k];
            obj.type = ["string", "null"];
            obj.description = desc;
            return obj;
          }
          // Apply strict-mode normalization to object schemas
          const isObjectSchema =
            (obj.type === "object" || (Array.isArray(obj.type) && (obj.type as unknown[]).includes("object"))) &&
            obj.properties && typeof obj.properties === "object";
          if (isObjectSchema) {
            obj.additionalProperties = false;
            const propKeys = Object.keys(obj.properties as Record<string, unknown>);
            // Ensure ALL properties are required + their types allow null
            // (so the LLM can satisfy the schema by emitting null for
            // properties it wasn't going to populate)
            obj.required = [...propKeys];
            for (const pk of propKeys) {
              const prop = (obj.properties as Record<string, unknown>)[pk] as Record<string, unknown>;
              if (prop && typeof prop === "object" && prop.type) {
                if (typeof prop.type === "string" && prop.type !== "null") {
                  prop.type = [prop.type, "null"];
                } else if (Array.isArray(prop.type) && !prop.type.includes("null")) {
                  prop.type = [...prop.type, "null"];
                }
              }
            }
          }
          return obj;
        };

        const normalized = normalizeStrict(JSON.parse(JSON.stringify(merged))) as Record<string, unknown>;
        // Keep $defs (refs need them) — normalizer already cleaned the def
        // bodies. Drop $schema as OpenAI rejects unknown top-level keys.
        delete normalized.$schema;
        return normalized;
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
    // ─── Wave 26 Pass 1: trade_critique strict schema ──────────────────────
    // Dual-output shape: technical_diagnosis + plain_english_summary.
    // All nullable fields required in the schema so strict mode forces emission
    // (LLM emits null for fields where data is unavailable rather than omitting).
    case "trade_critique":
      return {
        type: "object",
        properties: {
          technical_diagnosis: {
            type: "object",
            properties: {
              entry_quality_score: { type: "number" },
              exit_execution_delta_r: { type: "number" },
              confluence_factors_missed: {
                type: "array",
                items: { type: "string" },
              },
              parameter_hint: {
                type: ["object", "null"],
                properties: {
                  field: { type: "string" },
                  current: { type: ["string", "number", "null"] },
                  suggested_range: { type: "string" },
                  confidence: { type: "number" },
                },
                required: ["field", "current", "suggested_range", "confidence"],
                additionalProperties: false,
              },
              regime_mismatch: { type: "boolean" },
              attribution: {
                type: "object",
                properties: {
                  regime:     { type: "number" },
                  structure:  { type: "number" },
                  narrative:  { type: "number" },
                  confluence: { type: "number" },
                  decay:      { type: "number" },
                  liquidity:  { type: "number" },
                  fill:       { type: "number" },
                  exit_plan:  { type: "number" },
                },
                required: ["regime","structure","narrative","confluence","decay","liquidity","fill","exit_plan"],
                additionalProperties: false,
              },
              realized_r: { type: ["number", "null"] },
              expected_r_percentile: { type: ["number", "null"] },
              topstep_consistency_current_pct: { type: ["number", "null"] },
              topstep_consistency_distance_to_cap: { type: ["number", "null"] },
            },
            required: [
              "entry_quality_score",
              "exit_execution_delta_r",
              "confluence_factors_missed",
              "parameter_hint",
              "regime_mismatch",
              "attribution",
              "realized_r",
              "expected_r_percentile",
              "topstep_consistency_current_pct",
              "topstep_consistency_distance_to_cap",
            ],
            additionalProperties: false,
          },
          plain_english_summary: {
            type: "object",
            properties: {
              grade:           { type: "string", enum: ["A+","A","B+","B","C+","C","D","F"] },
              one_liner:       { type: "string" },
              what_went_right: { type: "string" },
              what_to_watch:   { type: "string" },
              action_needed:   { type: "string" },
            },
            required: ["grade","one_liner","what_went_right","what_to_watch","action_needed"],
            additionalProperties: false,
          },
        },
        required: ["technical_diagnosis", "plain_english_summary"],
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
    const costTracker = await import("./cost-tracker.js") as Record<string, unknown>;
    if (typeof costTracker["recordLlmCall"] === "function") {
      await (costTracker["recordLlmCall"] as (v: Record<string, unknown>) => Promise<void>)({ role, ...payload } as Record<string, unknown>);
    }
  } catch (err) {
    logger.debug({ err, role }, "cost-tracker.recordLlmCall not available (fire-and-forget)");
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

// ─── Wave 26 — Transcript Extractor audit row shape ───────────────────────────

export interface TranscriptExtractorAuditResult {
  model: string;
  provider: "ollama" | "openai";
  fellback: boolean;
  fallback_reason?: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: string;
  durationMs: number;
}

/**
 * Write per-call audit row for transcript_extractor with model/provider/fellback
 * fields per §10b instrumentation requirement.
 * Fire-and-forget — never blocks caller.
 */
async function writeTranscriptExtractorAudit(
  result: TranscriptExtractorAuditResult,
  correlationId?: string,
): Promise<void> {
  try {
    const { db } = await import("../db/index.js");
    const { auditLog } = await import("../db/schema.js");
    await db.insert(auditLog).values({
      action: "llm.transcript_extractor_call",
      decisionAuthority: "system",
      status: "success",
      durationMs: result.durationMs,
      result: {
        model: result.model,
        provider: result.provider,
        fellback: result.fellback,
        fallback_reason: result.fallback_reason ?? null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishReason: result.finishReason,
        ...(correlationId ? { correlation_id: correlationId } : {}),
      } as Record<string, unknown>,
    });
  } catch (err) {
    logger.debug({ err }, "writeTranscriptExtractorAudit failed (fire-and-forget)");
  }
}

// ─── Wave 26 Pass B — Transcript Extractor output schema ─────────────────────
//
// Loaded once at module level (sync, tiny file). Passed as `format` object to
// Ollama /api/chat for GBNF grammar-constrained sampling (Ollama 0.5+).
// Self-contained — no $ref to external paths; Ollama needs it resolvable at
// request time.
//
// IMPORTANT: Never add a `think` field to the Ollama request body.
// Ollama bug #15260 — passing `think: false` silently drops `format` schema
// enforcement on gemma4. Fix = omit `think` entirely.
let _transcriptOutputSchema: Record<string, unknown> | null = null;
function loadTranscriptOutputSchema(): Record<string, unknown> | null {
  if (_transcriptOutputSchema !== null) return _transcriptOutputSchema;
  try {
    // Wave 26 Pass L (2026-05-27) — Minimal flat 8-field schema is the default.
    // The legacy v11 schema with nested $defs caused gemma4:e2b to enter
    // recursive-loop output ("results":[{"results":[...]}]) that exhausted
    // num_predict before producing parseable JSON. Operator escape hatch:
    // TRANSCRIPT_EXTRACTOR_USE_LEGACY=true to fall back to the v11 schema.
    const useLegacy = (process.env.TRANSCRIPT_EXTRACTOR_USE_LEGACY ?? "false").toLowerCase() === "true";
    const schemaRel = useLegacy
      ? "src/agents/kb/transcript-extractor-output-schema.json"
      : "src/agents/kb/transcript-extractor-minimal-schema.json";
    const schemaPath = resolve(PROJECT_ROOT, schemaRel);
    const raw = readFileSync(schemaPath, "utf-8");
    _transcriptOutputSchema = JSON.parse(raw) as Record<string, unknown>;
    return _transcriptOutputSchema;
  } catch (err) {
    logger.warn({ err }, "model-router: failed to load transcript-extractor schema — falling back to format:json string mode");
    return null;
  }
}

// Wave 26 Pass L (2026-05-27) — System prompt selector.
// Default: minimal 8-field prompt (~90 lines). Legacy: v12 940-line prompt
// behind TRANSCRIPT_EXTRACTOR_USE_LEGACY=true. The minimal prompt is paired
// with the minimal schema; the env var flips BOTH atomically.
function getTranscriptExtractorPromptPath(): string {
  const useLegacy = (process.env.TRANSCRIPT_EXTRACTOR_USE_LEGACY ?? "false").toLowerCase() === "true";
  return useLegacy
    ? "src/agents/transcript-extractor.md"
    : "src/agents/transcript-extractor-minimal.md";
}

/**
 * Build a Gemma-4-correct few-shot messages array for transcript_extractor.
 *
 * WHY this format is required (verified sources):
 *   1. Gemma has NO native system role (Google AI Gemma prompt docs) — only
 *      user/model turns. Ollama auto-collapses system into first user turn but
 *      loses join-formatting control. We own the format explicitly.
 *   2. Few-shot examples MUST be alternating user/assistant turns — Gemma learns
 *      "produce JSON" from real assistant turns containing JSON, NOT from
 *      JSON-dumped strings inside a flat system block.
 *   3. temperature=0 + GBNF schema triggers Ollama issue #15502 (token repetition
 *      loop). Workaround: temperature=0.1. This function itself is format-only;
 *      see callOllamaForTranscriptExtractor for sampling params.
 *   4. Schema must be re-stated in the final user turn because Gemma loses
 *      long-range schema awareness across multi-turn context.
 *
 * Message structure produced:
 *   Turn 1 user:      rules + KB + schema-as-text + "Example 1 input:" + fewshot1.input
 *   Turn 1 assistant: JSON.stringify(fewshot1.expected_output)
 *   Turn 2 user:      "Example 2 input:" + fewshot2.input
 *   Turn 2 assistant: JSON.stringify(fewshot2.expected_output)
 *   Turn 3 user:      "Example 3 input:" + fewshot3.input  (refusal example)
 *   Turn 3 assistant: JSON.stringify(fewshot3.expected_output)  (empty strategies)
 *   Final user:       "Now extract from this transcript. Return ONLY JSON matching
 *                      the schema above.\n\nTranscript:\n" + transcript
 *
 * NOTE: qwen2.5-coder:7b also accepts this turn structure (it supports both
 * system+user and pure user/assistant patterns) but its native format is
 * system + alternating turns. If using qwen, this format is slightly suboptimal
 * but functionally correct. Consider model-family detection for qwen if needed.
 */
export function buildGemmaFewShotMessages(
  role: ModelRole,
  taskContext: PromptTaskContext | undefined,
  userPayload: string,
  schema: Record<string, unknown> | null,
): Array<{ role: "user" | "assistant"; content: string }> {
  // ── Step 1: Rules + KB content WITHOUT few-shot (Gemma needs these inline) ──
  const rulesAndKb = buildPromptWithoutFewShot(role, taskContext);
  const schemaStr = schema ? `\n\n## Output JSON Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`` : "";
  const rulesBlock = `${rulesAndKb}${schemaStr}`;

  // ── Step 2: Load few-shot files DIRECTLY as structured objects ──────────────
  // Don't go through loadFewShotExamples() — that formats as "INPUT: ... → OUTPUT: ..."
  // strings which are only useful in flat system prompts. Gemma needs real turns.
  //
  // Wave 26 Pass L (2026-05-27) — transcript_extractor in minimal mode SKIPS few-shot.
  // The 9 fixture files in src/agents/kb/few-shot/transcript-extractor/ all have
  // expected_output in the W23H schema (entry_long/entry_short/entry_indicator/...);
  // few-shot examples are the strongest signal in any prompt, so gemma faithfully
  // copies the W23H shape regardless of what the minimal system prompt asks for.
  // Probe N7uP9V0Iktc confirmed this on 2026-05-27. Minimal prompt is self-contained
  // (8 inline examples per field) and does not need few-shot. Operator escape:
  // TRANSCRIPT_EXTRACTOR_USE_LEGACY=true restores the W23H few-shot path.
  const skipFewShotForMinimal =
    role === "transcript_extractor" &&
    (process.env.TRANSCRIPT_EXTRACTOR_USE_LEGACY ?? "false").toLowerCase() !== "true";
  const fewShotDir = skipFewShotForMinimal
    ? resolve(PROJECT_ROOT, "src/agents/kb/few-shot", "__skip_minimal_mode__")
    : resolve(PROJECT_ROOT, "src/agents/kb/few-shot", roleToDirName(role));
  type FewShotFile = { input: unknown; expected_output: unknown };
  const examples: FewShotFile[] = [];
  try {
    const files = readdirSync(fewShotDir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(fewShotDir, f), "utf-8")) as FewShotFile;
        if (parsed.input !== undefined && parsed.expected_output !== undefined) {
          examples.push(parsed);
        }
      } catch {
        // Non-fatal — missing or malformed example skipped; model sees fewer turns
      }
    }
  } catch {
    // Dir missing entirely — skip all examples; model still gets rules+KB+final turn
  }

  // ── Step 3: Build alternating user/assistant turns ─────────────────────────
  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Filter by taskContext.signalType if specified (same filter logic as loadFewShotExamples)
  let selectedExamples = examples;
  if (taskContext?.signalType) {
    const target = taskContext.signalType;
    const filtered = examples.filter((ex) => exampleMatchesSignal(ex, target));
    if (filtered.length > 0) selectedExamples = filtered;
  }

  for (let i = 0; i < selectedExamples.length; i++) {
    const ex = selectedExamples[i]!;
    const inputStr = typeof ex.input === "string" ? ex.input : JSON.stringify(ex.input, null, 2);
    const outputStr = JSON.stringify(ex.expected_output);

    if (i === 0) {
      // First turn: include rules + KB + schema + first example input
      msgs.push({
        role: "user",
        content: `${rulesBlock}\n\nExample ${i + 1} input:\n${inputStr}`,
      });
    } else {
      msgs.push({
        role: "user",
        content: `Example ${i + 1} input:\n${inputStr}`,
      });
    }
    msgs.push({ role: "assistant", content: outputStr });
  }

  // ── Step 4: Final user turn with the actual transcript ─────────────────────
  // Schema is re-stated in the instruction because Gemma loses long-range schema
  // awareness across multi-turn context (empirically observed + Google docs confirm).
  const schemaReminder = schema
    ? " Return ONLY JSON matching the schema above."
    : " Return ONLY valid JSON.";
  const finalUserContent =
    msgs.length > 0
      ? // Examples were added — no need to re-inject rules block
        `Now extract from this transcript.${schemaReminder}\n\nTranscript:\n${userPayload}`
      : // No examples (dir missing) — include rules block in the only user turn
        `${rulesBlock}\n\nNow extract from this transcript.${schemaReminder}\n\nTranscript:\n${userPayload}`;

  msgs.push({ role: "user", content: finalUserContent });

  return msgs;
}

/**
 * Build rules + KB content for a role, WITHOUT the few-shot examples section.
 * Used by buildGemmaFewShotMessages to inject rules into the first user turn
 * instead of a system message (Gemma has no native system role).
 *
 * Includes appendix cache (same as buildPromptSync step 4) so pattern-aggregator
 * improvements still reach Gemma's context.
 */
function buildPromptWithoutFewShot(
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
      logger.debug({ role, path: config.systemPromptPath }, "buildPromptWithoutFewShot: prompt file not found");
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

  // NOTE: Few-shot section INTENTIONALLY OMITTED — caller (buildGemmaFewShotMessages)
  // injects examples as real alternating turns, not as strings inside the rules block.

  const parts: string[] = [];
  if (base.trim().length > 0) parts.push(base.trim());
  if (cards.length > 0) parts.push(cards.join("\n\n"));

  // 4. Appendix cache injection (same as buildPromptSync step 4 — pattern-aggregator
  //    improvements must reach the model even in Gemma few-shot format).
  const appendix = _appendixCache.get(role);
  if (appendix && appendix.trim().length > 0) {
    parts.push(appendix.trim());
  }

  return parts.join("\n\n");
}

/**
 * Call Ollama gemma4 (Wave 26 Pass C) via /api/chat with:
 *   - Gemma-4-correct few-shot message format (alternating user/assistant turns,
 *     NO system role — Gemma has no native system role per Google AI docs)
 *   - JSON Schema as format object for GBNF grammar-constrained sampling (Ollama 0.5+)
 *   - Gemma-4 proper sampling (per Google docs + Unsloth + Ollama issue #15502):
 *       temperature=0.1  NOT 0 — avoids GBNF repetition loop (Ollama issue #15502)
 *       top_p=0.95       Google default (NOT 0.9)
 *       top_k=64         Google default (NOT 20 — too tight for JSON escapes)
 *       min_p=0.0        Google default
 *       repeat_penalty=1.0  explicit; default but documented
 *       num_predict=2048    HARD CAP — prevents unbounded repetition if bug fires
 *   - 30s per-call timeout (R2 requirement)
 *
 * Returns: { text: string, model, durationMs } on success
 *          throws on timeout / connection refused / invalid JSON with
 *          reason attached as err.fallbackReason for callScoutExtractLlm.
 *
 * Schema enforcement: controlled by TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA env var
 * (default true). When false → falls back to format:"json" string mode (escape
 * hatch for model deployments that don't support GBNF schema enforcement).
 */
async function callOllamaForTranscriptExtractor(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  taskContext?: PromptTaskContext,
  // 2026-06-23 enumerator-debt fix: secondary gemma callers (coverage enumeration, recall) need a
  // DIFFERENT output shape than the strategies extractor. Without this, the enum prompt asking for
  // `{speaker_items:[...]}` was GBNF-locked to the strategies schema + fed extractor few-shot →
  // gemma returned `{strategies:[...]}` → parseSpeakerItems found no speaker_items → empty enum →
  // coverage silently fell to the self-evident path (which can't detect missing speaker items).
  // schemaOverride: pass a custom GBNF JSON schema (locks gemma to the CORRECT shape).
  // skipFewShot: send the prompt verbatim with NO extractor few-shot / KB injection.
  opts?: { schemaOverride?: Record<string, unknown> | null; skipFewShot?: boolean },
): Promise<{ text: string; model: string; durationMs: number; inputTokens: number; outputTokens: number }> {
  const role = "transcript_extractor" as const;
  const model = getLocalTranscriptModel();

  const { OllamaClient } = await import("./ollama-client.js");
  // Wave 26 Pass C-fix (2026-05-25): bump timeout 30s → 120s. Gemma 4 on RTX
  // 5060 8 GB VRAM (8.95 GB model = VRAM spillover) takes 30-90s per call on
  // cold start; first call after model unload routinely hits >30s. Original
  // R2 30s spec was for a smaller model. Per-call retry remains 3 attempts.
  // Override via env: TRANSCRIPT_EXTRACTOR_OLLAMA_TIMEOUT_MS (range 30000-300000).
  const timeoutMs = (() => {
    const raw = process.env.TRANSCRIPT_EXTRACTOR_OLLAMA_TIMEOUT_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : 120_000;
    if (!Number.isFinite(parsed) || parsed < 30_000 || parsed > 300_000) return 120_000;
    return parsed;
  })();
  const ollama = new OllamaClient(undefined, timeoutMs);

  // Determine schema first — needed for buildGemmaFewShotMessages AND for formatArg.
  // A schemaOverride (enum/recall) takes precedence over the strategies schema.
  const strictSchema = isStrictSchemaMode();
  const schema =
    opts && "schemaOverride" in opts ? (opts.schemaOverride ?? null) : strictSchema ? loadTranscriptOutputSchema() : null;

  // Extract transcript payload from incoming messages (non-system content).
  const userPayload = messages
    .filter((m) => m.role !== "system")
    .map((m) => m.content)
    .join("\n\n");

  // Build Gemma-4-correct few-shot message array (Wave 26 Pass C).
  // NO system role — rules + KB injected into first user turn.
  // Few-shot examples as alternating user/assistant turns.
  // Schema re-stated in final user turn for long-range awareness.
  // skipFewShot (enum/recall): send the self-contained prompt verbatim — NO extractor few-shot or
  // KB, which would bias gemma toward strategy extraction and the wrong output shape.
  const chatMessages = opts?.skipFewShot
    ? [{ role: "user" as const, content: userPayload }]
    : buildGemmaFewShotMessages(role, taskContext, userPayload, schema);

  // GEMMA 4 PROPER SAMPLING (per Google AI docs + Unsloth Gemma 3 fine-tune guide
  // + Ollama issue #15502 workaround):
  //   temperature=0.1  NOT 0 — temp=0 + GBNF schema triggers Ollama issue #15502
  //                    (token repetition loop). Google's recommended range for
  //                    strict JSON is 0.1 (HuggingFace gemma-3-27b-it discussion #84).
  //   top_p=0.95       Google default (was 0.9 — too restrictive for JSON escapes).
  //   top_k=64         Google default (was 20 — Gemma's vocab tail matters for
  //                    JSON escapes: \", \n, etc. top_k=20 cuts these off).
  //   min_p=0.0        Google default; explicit for documentation.
  //   repeat_penalty=1.0  Ollama default; explicit to prevent unintended change.
  //   num_predict=4096    Wave 26 Pass I (v11): raised from 2048.
  //                    v11 richer output (entry_sequence + stop_loss + targets
  //                    + filters + timeframes + indicators_used) requires 3-4K
  //                    output tokens for a full 3-step ICT strategy. 2048 was
  //                    truncating v11 outputs mid-array. Still acts as hard cap
  //                    against issue #15502 repetition loop.
  // num_ctx: v11 raised to 32768 (see getTranscriptOllamaNumCtx for rationale).
  // NEVER add: think field — Ollama bug #15260 silently drops format enforcement
  const numCtx = getTranscriptOllamaNumCtx();
  // Wave 26 Pass H Phase 1.5 Fix 6 (2026-05-26) — extractor determinism.
  //
  // ★ INVARIANT: temperature MUST remain ≥ 0.1. temperature=0 + GBNF schema
  //   triggers Ollama issue #15502 (token repetition loop until num_predict
  //   exhausted). Phase 1.5 dispatch requested temp=0.0 but the documented
  //   Ollama bug overrides that — we use the lowest safe value (0.1).
  //
  // ★ INVARIANT: top_p MUST remain at 0.95 (NOT 0.1 as the Phase 1.5 dispatch
  //   suggested). Lowering top_p below 0.5 cuts off JSON-escape tokens in
  //   Gemma's vocab tail (\\", \\n) → malformed JSON → cloud fallback. Lower
  //   top_p does NOT help determinism with grammar-constrained sampling.
  //
  // The Phase 1.5 dispatch's actual determinism goal is satisfied by:
  //   seed=42   — Ollama supports deterministic seeded sampling (any non-zero
  //               value produces reproducible output for given prompt+options).
  //   temperature=0.1 (locked min for GBNF) + seed=42 = deterministic enough
  //   for the 5-fixture parity test contract.
  //
  // The extractor.config_used audit row at the end of this function lets us
  // verify the determinism config is actually applied per-call (no env drift).
  const TRANSCRIPT_EXTRACTOR_SEED = Number(process.env.TRANSCRIPT_EXTRACTOR_OLLAMA_SEED ?? "42");
  const samplingOptions = {
    num_ctx: numCtx,
    temperature: 0.1,
    top_p: 0.95,
    top_k: 64,
    min_p: 0.0,
    repeat_penalty: 1.0,
    num_predict: 4096,
    seed: TRANSCRIPT_EXTRACTOR_SEED,
  };

  // Determine format: schema object (GBNF strict) or "json" string (syntactic only).
  // Schema object requires Ollama 0.5+. Legacy Ollama falls back gracefully to
  // treating unknown format values as no-format (still valid JSON output expected
  // from the sampling, just no grammar enforcement).
  const formatArg: boolean | Record<string, unknown> = schema ?? true;

  // Wave 26 Pass C-fix: keep Gemma resident between calls. Default 30m covers
  // a full 29-URL extraction batch without unload tax. Env override:
  // TRANSCRIPT_EXTRACTOR_OLLAMA_KEEP_ALIVE (e.g. "1h", "0" to disable).
  const keepAlive = process.env.TRANSCRIPT_EXTRACTOR_OLLAMA_KEEP_ALIVE ?? "30m";

  // Wave 26 Pass I v12 (2026-05-26) — Gemma 4 native THINKING MODE.
  // Per Google's Gemma 4 control-token docs: thinking mode is activated by
  // including the <|think|> control token in the system instruction with
  // proper <|turn>system ... <turn|> wrapping.
  //
  // CRITICAL: Ollama's gemma4:e2b chat template is naked `{{ .Prompt }}` (no
  // chat-template wrapping). So passing a system role via Ollama /api/chat
  // does NOT auto-wrap with <|turn>system ... <turn|>. We must inject the
  // Gemma 4 control tokens MANUALLY into the user-turn content so the model
  // sees them in its input stream.
  //
  // Output parsing: strip everything between <|channel>thought and <channel|>
  // before JSON.parse. The thought content must NOT be returned to the next
  // turn per Google docs.
  // Wave 26 Pass L (2026-05-27) — thinking-mode preamble injects a `reasoning_notes`
  // top-level field instruction that is INCOMPATIBLE with the new minimal schema
  // (additionalProperties:false). On minimal mode, gemma emits reasoning_notes per
  // the preamble → schema rejects → "ollama_invalid_json" → fallback → null.
  // Probe iU8ww5MC2FQ confirmed: direct Ollama (no preamble) works in 49s with
  // clean JSON; model-router path with preamble fails in 8s. Default thinking OFF
  // when minimal schema is active. Operator override: TRANSCRIPT_EXTRACTOR_THINKING_MODE=true.
  const isLegacyMode =
    (process.env.TRANSCRIPT_EXTRACTOR_USE_LEGACY ?? "false").toLowerCase() === "true";
  const thinkingDefault = isLegacyMode ? "true" : "false";
  const ENABLE_GEMMA_THINKING =
    (process.env.TRANSCRIPT_EXTRACTOR_THINKING_MODE ?? thinkingDefault).toLowerCase() === "true";

  // Inject Gemma 4 thinking activation as PLAIN-TEXT instruction at the very
  // top of the first user message. We do NOT inject raw <|turn>... markers
  // because (a) Ollama's gemma4:e2b template is naked {{ .Prompt }} so those
  // markers reach the model as literal text it doesn't know how to parse,
  // and (b) raw control tokens trigger Ollama runner errors.
  //
  // Instead we instruct Gemma in NATURAL LANGUAGE to do step-by-step reasoning
  // before JSON output. Gemma 4 is highly instructable per Google docs
  // ("Adaptive Thought Efficiency using System Instructions" section).
  const chatMessagesWithThinking = ENABLE_GEMMA_THINKING && chatMessages.length > 0
    ? chatMessages.map((msg, idx) => {
        if (idx === 0 && msg.role === "user") {
          const preamble = "STEP 1 — THINK FIRST (do not skip this):\nBefore emitting JSON, write a brief 'reasoning_notes' section enumerating the speaker's proprietary vocabulary you noticed in the transcript. Look for:\n- Named tools/zones (e.g. 'the X Box', 'the Hidden Level', 'the Optimum Zone')\n- Named models/frameworks (e.g. 'IRS Model', 'Power of 3', 'CRT', 'the Box system')\n- Named entry steps (e.g. 'Change of State', 'Rebalance', 'Sweep')\n- Named filters (e.g. 'avoid skinny candles', 'no equal liquidity')\nEmit this reasoning AT THE TOP of your output as a JSON comment-like string `\"reasoning_notes\": \"<2-3 sentences listing speaker terms you found>\"` ABOVE the strategies array.\n\nSTEP 2 — EXTRACT TO JSON using those speaker terms in speaker_concepts.\n\n---\n\n";
          return { role: msg.role, content: preamble + msg.content };
        }
        return msg;
      })
    : chatMessages;

  const startedAt = Date.now();
  const res = await ollama.chat(model, chatMessagesWithThinking, samplingOptions, formatArg, keepAlive);
  const durationMs = Date.now() - startedAt;

  let raw = res?.message?.content ?? "";
  if (!raw || raw.trim().length === 0) {
    const e = new Error("Ollama returned empty response for transcript_extractor") as Error & { fallbackReason: string };
    e.fallbackReason = "ollama_empty_response";
    throw e;
  }

  // Strip Gemma 4 thought channel from raw response BEFORE JSON parse.
  // Pattern (per Google Gemma 4 docs): <|channel>thought ... <channel|>
  // Also handle variant: model may emit "<channel|>" without leading "<|channel>thought".
  // Conservative: strip everything from first <|channel> up to and including <channel|>.
  if (raw.includes("<|channel>") || raw.includes("<channel|>")) {
    const beforeStrip = raw.length;
    raw = raw.replace(/<\|channel>[\s\S]*?<channel\|>/g, "").trim();
    // If still contains an orphan <channel|>, drop everything before it (just keep the response part)
    if (raw.includes("<channel|>")) raw = raw.split("<channel|>").pop()?.trim() ?? raw;
    if (raw.includes("<|channel>")) raw = raw.split("<|channel>")[0]?.trim() ?? raw;
    // Strip any stray <|turn>...<turn|> wrappers Ollama left in
    raw = raw.replace(/<\|turn>[a-z]+\s*/g, "").replace(/<turn\|>/g, "").trim();
    logger.info({ stripped_chars: beforeStrip - raw.length, remaining: raw.length }, "model-router: stripped Gemma 4 thought channel");
  }

  // R3: JSON validation gate — if parse fails, record reason and throw
  let parsedOutput: Record<string, unknown>;
  try {
    parsedOutput = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const e = new Error("Ollama returned non-JSON for transcript_extractor") as Error & { fallbackReason: string };
    e.fallbackReason = "ollama_invalid_json";
    throw e;
  }

  // Wave 26 Pass I (v11) — under-extraction detection + fire-and-forget audit.
  // Check if any extracted strategies are missing v11 required depth fields for
  // ICT/archetype strategies. Log the audit row; do NOT block the extraction
  // (graduator handles downstream rejection; we audit for visibility only).
  // Archetypes that require deep extraction: ict_*, bounce_off_level, archetype:*.
  const ICT_ARCHETYPES_RE = /archetype:|ict_|bounce_off_level|sfp|liquidity_raid|bias_aligned/i;
  try {
    const strategies = Array.isArray((parsedOutput as Record<string, unknown>).strategies)
      ? ((parsedOutput as Record<string, unknown>).strategies as Record<string, unknown>[])
      : [];
    const underExtracted = strategies.filter((s) => {
      const ind = String((s as Record<string, unknown>).entry_indicator ?? "");
      if (!ICT_ARCHETYPES_RE.test(ind)) return false;
      const seq = (s as Record<string, unknown>).entry_sequence;
      const hasSeq = Array.isArray(seq) && seq.length >= 2;
      const stopS = (s as Record<string, unknown>).stop_loss_structured;
      const hasStop = stopS !== null && stopS !== undefined;
      const tgts = (s as Record<string, unknown>).targets;
      const hasTargets = Array.isArray(tgts) && tgts.length >= 1;
      return !hasSeq || !hasStop || !hasTargets;
    });
    if (underExtracted.length > 0) {
      const { db } = await import("../db/index.js");
      const { auditLog } = await import("../db/schema.js");
      db.insert(auditLog).values({
        action: "extraction.under_extracted",
        entityType: "llm_call",
        entityId: null,
        input: { model, role } as Record<string, unknown>,
        result: {
          under_extracted_count: underExtracted.length,
          strategy_names: underExtracted.map((s) => (s as Record<string, unknown>)["name"]),
          missing_fields: underExtracted.map((s) => ({
            name: (s as Record<string, unknown>)["name"],
            has_entry_sequence: Array.isArray((s as Record<string, unknown>)["entry_sequence"]) && ((s as Record<string, unknown>)["entry_sequence"] as unknown[]).length >= 2,
            has_stop_loss_structured: (s as Record<string, unknown>)["stop_loss_structured"] != null,
            has_targets: Array.isArray((s as Record<string, unknown>)["targets"]) && ((s as Record<string, unknown>)["targets"] as unknown[]).length >= 1,
          })),
        } as Record<string, unknown>,
        status: "failure",
        decisionAuthority: "system",
      }).catch(() => { /* non-blocking */ });
    }
  } catch { /* non-blocking — never fail extraction on audit error */ }

  // Wave 26 Pass H Phase 1.5 Fix 6 (2026-05-26) — per-call determinism audit.
  // Fire-and-forget; never blocks the extractor return. Lets us verify the
  // sampling config that was actually applied per extraction, so we can detect
  // env-var drift (e.g. operator setting TRANSCRIPT_EXTRACTOR_OLLAMA_SEED=null).
  try {
    const { db } = await import("../db/index.js");
    const { auditLog } = await import("../db/schema.js");
    db.insert(auditLog).values({
      action: "extraction.config_used",
      entityType: "llm_call",
      entityId: null,
      input: { model, role } as Record<string, unknown>,
      result: {
        temperature: samplingOptions.temperature,
        seed: samplingOptions.seed,
        top_p: samplingOptions.top_p,
        top_k: samplingOptions.top_k,
        num_ctx: samplingOptions.num_ctx,
        num_predict: samplingOptions.num_predict,
        model,
        provider: "ollama",
        prompt_version: 12,
        thinking_mode: ENABLE_GEMMA_THINKING,
      } as Record<string, unknown>,
      status: "success",
      decisionAuthority: "system",
    }).catch(() => { /* non-blocking */ });
  } catch { /* non-blocking */ }

  return { text: raw, model, durationMs, inputTokens: 0, outputTokens: 0 };
}

// ─── W3.3 — Fail-Loud: local-LLM-down signal ─────────────────────────────────
//
// When OLLAMA_HEALTHY is false AND cloud is also unavailable (budget gate,
// circuit open, or retries exhausted), the system was about to silently return
// null. Instead, emit:
//   1. audit row: extraction.local_llm_down (queryable, structured)
//   2. Discord critical alert (operator visibility)
//   3. quarantineExtraction() so the video can be re-extracted later
//
// Fire-and-forget — never blocks the extraction return path.
// Accepts optional `source_url` extracted from the messages payload when
// available (best-effort; absent on chunked paths where messages are chunks).

interface LocalLlmDownOpts {
  messages: Array<{ role: string; content: string }>;
  fallback_reason: string;
  source_url?: string;
}

async function emitLocalLlmDownSignal(opts: LocalLlmDownOpts): Promise<void> {
  // H6: inline Ollama health recheck before firing the EXTRACTION LOST alert.
  // The boot-time probe (checkTranscriptExtractorOllamaHealth at T+0) can catch
  // gemma4:e2b during a 7GB cold-load and mark OLLAMA_HEALTHY=false as a false
  // negative. A runtime recheck here (2–5s) aborts the spurious critical alert
  // and resets OLLAMA_HEALTHY=true so the next extraction call routes locally.
  const _h6Recheck = await recheckOllamaHealth();
  if (_h6Recheck.healthy) {
    logger.info(
      { fallback_reason: opts.fallback_reason },
      "model-router: EXTRACTION LOST alert aborted — Ollama recheck healthy; boot-time false-negative corrected",
    );
    return;
  }

  const { messages, fallback_reason } = opts;

  // Best-effort: extract source_url from the user message JSON payload.
  // scout-extract sends { youtube_url, title, channel, transcript_text }.
  let sourceUrl: string | null = opts.source_url ?? null;
  if (!sourceUrl) {
    try {
      const userMsg = messages.find((m) => m.role === "user");
      if (userMsg) {
        const parsed = JSON.parse(userMsg.content) as Record<string, unknown>;
        if (typeof parsed.youtube_url === "string") sourceUrl = parsed.youtube_url;
      }
    } catch { /* best-effort, non-blocking */ }
  }

  logger.error(
    { fallback_reason, sourceUrl, OLLAMA_HEALTHY },
    "extraction.local_llm_down: Ollama is unhealthy and cloud fallback is unavailable — extraction lost",
  );

  // 1. Audit row (structured, queryable)
  try {
    const { db } = await import("../db/index.js");
    const { auditLog } = await import("../db/schema.js");
    await db.insert(auditLog).values({
      action: "extraction.local_llm_down",
      decisionAuthority: "system",
      status: "failure",
      result: {
        fallback_reason,
        source_url: sourceUrl,
        ollama_healthy_flag: OLLAMA_HEALTHY,
        model: getLocalTranscriptModel(),
        recommendation: "Run POST /api/admin/ollama-health-recheck to restore local routing",
      } as Record<string, unknown>,
    });
  } catch (err) {
    logger.debug({ err }, "emitLocalLlmDownSignal: audit insert failed (fire-and-forget)");
  }

  // 2. Discord critical alert
  try {
    const { notifyCritical } = await import("../services/notification-service.js");
    const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");
    notifyCritical(
      "EXTRACTION LOST — local Ollama DOWN + cloud unavailable",
      appendFamilyGradePostscript(
        `Reason: ${fallback_reason}\nSource: ${sourceUrl ?? "(unknown)"}\nFix: POST /api/admin/ollama-health-recheck to restore local routing`,
        "The strategy-research bot cannot extract new trading strategies right now — the local AI model is down and the cloud backup is also unavailable.",
        "No action needed today. Check back tomorrow. Tony will be alerted automatically and can restore the system via the admin panel.",
      ),
      { fallback_reason, source_url: sourceUrl, ollama_healthy_flag: OLLAMA_HEALTHY },
    );
  } catch (err) {
    logger.debug({ err }, "emitLocalLlmDownSignal: Discord notify failed (fire-and-forget)");
  }

  // 3. Quarantine so the extraction can be replayed once Ollama recovers
  try {
    const { quarantineExtraction } = await import("../lib/quarantine-extraction.js");
    await quarantineExtraction({
      concept_name: "local_llm_down_quarantine",
      source_url: sourceUrl,
      missing: ["local_llm_unavailable"],
      coverage_verdict: null,
      reason: fallback_reason,
      correlationId: null,
    });
  } catch (err) {
    logger.debug({ err }, "emitLocalLlmDownSignal: quarantineExtraction failed (fire-and-forget)");
  }
}

/**
 * callScoutExtractLlm — production entry-point for scout_extract / transcript_extractor
 * LLM calls with exponential-backoff retry and cloud fallback.
 *
 * Wave 26 local-first swap: PRIMARY is now Ollama gemma4:e2b.
 * Cloud gpt-5-mini is the FALLBACK (fires only when Ollama fails).
 *
 * Routing logic:
 *   1. If TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true → skip Ollama, use cloud
 *      (operator panic-revert; flips primary without code change)
 *   2. If OLLAMA_HEALTHY=false (set at boot by checkTranscriptExtractorOllamaHealth)
 *      → skip Ollama, use cloud
 *   3. Otherwise: try Ollama (up to 3 attempts with retry), then fall back to
 *      cloud on exhaustion or per-call failure (timeout/invalid JSON/empty)
 *
 * R4 token budget gate: when cloud budget is exhausted (budget_exhausted_forced_ollama
 * scenario), the normal cloud path returns null and we stay Ollama-only — cloud
 * is what we're protecting.
 *
 * Function signature UNCHANGED — downstream callers (agent.ts, scout-extract route)
 * depend on `(messages, taskContext, callFn, sleepFn) => Promise<string | null>`.
 *
 * @param messages    Chat messages to send (same contract as callOpenAI).
 * @param taskContext Optional task context for prompt caching.
 * @param callFn      Injected for tests; defaults to callOpenAI (cloud path).
 *                    When testing Ollama-primary routing, inject a mock that
 *                    drives the cloud fallback path.
 * @param sleepFn     Injected for tests to avoid real setTimeout delays.
 */
export async function callScoutExtractLlm(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  taskContext?: PromptTaskContext,
  callFn: typeof callOpenAI = callOpenAI,
  sleepFn?: (ms: number) => Promise<void>,
  // 2026-06-23: enum/recall pass a custom output schema + skip the extractor few-shot so gemma
  // returns their shape (e.g. {speaker_items:[...]}) instead of being GBNF-locked to strategies.
  opts?: { schemaOverride?: Record<string, unknown> | null; skipFewShot?: boolean },
): Promise<string | null> {
  const role = "transcript_extractor" as const;
  const forceCloud = isForceCloud();
  const ollamaHealthy = OLLAMA_HEALTHY;

  // ── Path A: force-cloud or boot-unhealthy → use existing cloud+retry path ──
  if (forceCloud || !ollamaHealthy) {
    const reason = forceCloud ? "force_cloud_env" : "ollama_unhealthy_at_boot";
    logger.info({ role, reason }, "callScoutExtractLlm: routing to cloud primary (TRANSCRIPT_EXTRACTOR_FORCE_CLOUD or Ollama unhealthy)");

    const result = await withScoutExtractRetry(
      () => callFn(role, messages, taskContext),
      writeScoutRetryAudit,
      sleepFn,
    );

    if (result.text !== null) {
      void writeTranscriptExtractorAudit({
        model: "gpt-5-mini",
        provider: "openai",
        fellback: false,
        inputTokens: 0,
        outputTokens: 0,
        finishReason: "stop",
        durationMs: 0,
      });
      return result.text;
    }

    if (result.exhausted) {
      // Cloud retries exhausted — nothing left to try.
      // When Ollama is unhealthy (not just force-cloud), this is the silent-drop
      // scenario: local is down AND cloud is also down. Emit fail-loud signals.
      if (!forceCloud) {
        void emitLocalLlmDownSignal({
          messages,
          fallback_reason: "ollama_unhealthy_cloud_also_exhausted",
        });
      }
      void writeTranscriptExtractorAudit({
        model: "gpt-5-mini",
        provider: "openai",
        fellback: false,
        fallback_reason: "cloud_retries_exhausted",
        inputTokens: 0,
        outputTokens: 0,
        finishReason: "error",
        durationMs: 0,
      });
      return null;
    }

    // Budget gate / circuit open / refusal — try the openai-or-fallback path.
    // If that also returns null and Ollama is still the reason for this path,
    // emit the loud signal so the failure is not silent.
    const fallbackResult = await callOpenAIOrFallback(role, messages, taskContext);
    if (fallbackResult === null && !forceCloud) {
      void emitLocalLlmDownSignal({
        messages,
        fallback_reason: "ollama_unhealthy_cloud_budget_or_circuit",
      });
    }
    return fallbackResult;
  }

  // ── Path B: Ollama primary — try up to 3 attempts, then fall back to cloud ──
  let ollamaText: string | null = null;
  let ollamaFallbackReason: string | undefined;
  let ollama_durationMs = 0;

  for (let attempt = 0; attempt < MAX_SCOUT_ATTEMPTS; attempt++) {
    try {
      const res = await callOllamaForTranscriptExtractor(messages, taskContext, opts);
      ollamaText = res.text;
      ollama_durationMs = res.durationMs;
      logger.info(
        { role, model: res.model, durationMs: res.durationMs, attempt: attempt + 1 },
        "callScoutExtractLlm: Ollama primary succeeded",
      );
      break;
    } catch (err: unknown) {
      const fallbackReason = (err as { fallbackReason?: string }).fallbackReason ?? classifyLlmError(err) ?? "ollama_error";
      ollamaFallbackReason = fallbackReason;

      // Check if retryable
      const isRetryable =
        fallbackReason === "network_timeout" ||
        fallbackReason === "ollama_timeout" ||
        classifyLlmError(err) !== null;

      logger.warn(
        { role, attempt: attempt + 1, fallbackReason, isRetryable },
        "callScoutExtractLlm: Ollama primary attempt failed",
      );

      void writeScoutRetryAudit({
        action: "llm.retry_attempt",
        decisionAuthority: "system",
        status: "retrying",
        result: {
          role: "scout_extract",
          attempt: attempt + 1,
          reason: fallbackReason,
          model_id: getLocalTranscriptModel(),
          err_message: err instanceof Error ? err.message : String(err ?? ""),
          path: "ollama_primary",
        },
      });

      const isLastAttempt = attempt === MAX_SCOUT_ATTEMPTS - 1;
      if (isLastAttempt || !isRetryable) break;

      // Backoff before retry
      const base = SCOUT_RETRY_BASE_DELAYS_MS[attempt] ?? 1_000;
      const jitter = base * 0.25 * (Math.random() * 2 - 1);
      const delay = Math.max(100, Math.round(base + jitter));
      if (sleepFn) {
        await sleepFn(delay);
      } else {
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }

  if (ollamaText !== null) {
    // Success on Ollama primary
    void writeTranscriptExtractorAudit({
      model: getLocalTranscriptModel(),
      provider: "ollama",
      fellback: false,
      inputTokens: 0,
      outputTokens: 0,
      finishReason: "stop",
      durationMs: ollama_durationMs,
    });
    return ollamaText;
  }

  // ── Ollama failed all attempts — fall back to cloud gpt-5-mini ──
  logger.warn(
    { role, fallbackReason: ollamaFallbackReason },
    "callScoutExtractLlm: Ollama primary exhausted — falling back to cloud gpt-5-mini",
  );

  void writeScoutRetryAudit({
    action: "llm.transcript_extractor_ollama_fallback_to_cloud",
    decisionAuthority: "system",
    status: "retrying",
    result: {
      role: "scout_extract",
      ollama_model: getLocalTranscriptModel(),
      fallback_reason: ollamaFallbackReason ?? "unknown",
    },
  });

  // Try cloud with retry
  const cloudResult = await withScoutExtractRetry(
    () => callFn(role, messages, taskContext),
    writeScoutRetryAudit,
    sleepFn,
  );

  if (cloudResult.text !== null) {
    void writeTranscriptExtractorAudit({
      model: "gpt-5-mini",
      provider: "openai",
      fellback: true,
      fallback_reason: ollamaFallbackReason,
      inputTokens: 0,
      outputTokens: 0,
      finishReason: "stop",
      durationMs: 0,
    });
    return cloudResult.text;
  }

  // R4: cloud is what we're protecting — if cloud budget is exhausted after
  // Ollama has already failed, there is nothing left to try.
  void writeTranscriptExtractorAudit({
    model: "gpt-5-mini",
    provider: "openai",
    fellback: true,
    fallback_reason: ollamaFallbackReason ?? "ollama_failure_cloud_budget_also_exhausted",
    inputTokens: 0,
    outputTokens: 0,
    finishReason: "error",
    durationMs: 0,
  });

  if (!cloudResult.exhausted) {
    // Clean null from cloud (budget gate / circuit) — no further path
    logger.warn({ role }, "callScoutExtractLlm: Ollama failed and cloud budget/circuit unavailable — returning null");
    return null;
  }

  logger.error({ role }, "callScoutExtractLlm: both Ollama primary and cloud fallback exhausted");
  return null;
}

/** Test helper: call emitLocalLlmDownSignal directly. Production code never calls this. */
export const __emitLocalLlmDownSignalForTests = emitLocalLlmDownSignal;

export { MODEL_CONFIGS, KB_MANIFEST, FEWSHOT_ROLES };
