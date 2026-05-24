/**
 * Pattern Aggregator Service — Wave 26 Pass 4
 *
 * Closes the broken feedback loop that existed since the nightly critique was first
 * built. Every 4 hours, reads recent trade_critique rows, identifies recurring patterns
 * across technical_diagnosis fields, and emits a strategy_proposer prompt appendix.
 *
 * The appendix is stored as a new prompt_versions row (isActive=false; A/B test decides
 * activation) AND immediately injected into the module-level appendix cache in
 * model-router.ts so buildPromptSync picks it up synchronously without any async path.
 *
 * Architecture decision — module-level cache (not async hot path):
 *   buildPromptSync() at model-router.ts is SYNCHRONOUS. getActivePromptContent()
 *   is ASYNC. They cannot be directly composed. The solution is a module-level
 *   Map<string, string> in model-router.ts (the _appendixCache) that is:
 *     1. Warmed at boot by warmAppendixCache() (reads DB once, fail-open)
 *     2. Updated by this service's setAppendixCache() after every aggregation run
 *     3. Read synchronously by buildPromptSync() via _appendixCache.get(promptType)
 *   No async in the hot path. No breaking change to callers.
 *
 * Kill switch: system_parameters row with paramName="auto_patch_loop_enabled".
 *   Value "false" (string) halts the aggregator and emits auto_patch.loop_halted_skip.
 *   Missing row is treated as "true" (fail-open, loop enabled).
 *
 * Min-sample guard: env PATTERN_AGGREGATOR_MIN_CRITIQUES (default 10).
 *   Fewer critiques than the threshold → audit + return "insufficient_samples".
 *
 * A/B test: new prompt_versions rows start with isActive=false. The weekly
 *   prompt-evolution resolveAbTests() job determines which version wins.
 */

import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tradeCritique, systemParameters, auditLog, promptVersions, promptAbTests } from "../db/schema.js";
import { callOpenAI, getFallback, loadSystemPrompt, setAppendixCache } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { logger } from "../lib/logger.js";

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_WINDOW = Number(process.env.PATTERN_AGGREGATOR_WINDOW ?? "20");
const MIN_CRITIQUES =  Number(process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES ?? "10");
const KILL_SWITCH_PARAM = "auto_patch_loop_enabled";
const PROMPT_TYPE = "strategy_proposer";
const MIN_SAMPLES_PER_VARIANT = 20;

// ─── Types ─────────────────────────────────────────────────────

export interface PatternAggregatorResult {
  status: "completed" | "insufficient_samples" | "halted" | "failed" | "no_change";
  critiques_reviewed: number;
  parameter_hints: string[];
  concept_avoidance: string[];
  regime_notes: string[];
  new_prompt_version_id: string | null;
  ab_test_id: string | null;
  provider: string;
  durationMs: number;
}

interface CritiqueTechnicalDiagnosis {
  entry_quality_score?: number | null;
  exit_execution_delta_r?: number | null;
  confluence_factors_missed?: string[];
  parameter_hint?: string | null;
  regime_mismatch?: boolean | null;
  attribution?: Record<string, number> | null;
  realized_r?: number | null;
  expected_r_percentile?: number | null;
  topstep_consistency_current_pct?: number | null;
}

interface CritiqueSummaryRow {
  id: string;
  grade: string;
  technicalDiagnosis: CritiqueTechnicalDiagnosis;
  critiquedAt: Date;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Run the pattern aggregation cycle. Called every 4 hours by scheduler.
 *
 * Steps:
 *  1. Check kill switch (system_parameters)
 *  2. Read last N trade_critique rows (N = PATTERN_AGGREGATOR_WINDOW)
 *  3. Min-sample guard (MIN_CRITIQUES)
 *  4. Build input payload (technical_diagnosis only — plain_english_summary excluded)
 *  5. Call GPT-5.4 ("pattern_aggregator" role), Ollama fallback
 *  6. If LLM returns "NO_CHANGE" → audit + return
 *  7. Persist new prompt_versions row (isActive=false)
 *  8. Start A/B test vs current active version (replicated from prompt-evolution-service)
 *  9. Update appendix cache via setAppendixCache() so buildPromptSync picks it up now
 * 10. Audit row
 */
export async function runPatternAggregator(): Promise<PatternAggregatorResult> {
  const startTime = Date.now();

  const empty: PatternAggregatorResult = {
    status: "failed",
    critiques_reviewed: 0,
    parameter_hints: [],
    concept_avoidance: [],
    regime_notes: [],
    new_prompt_version_id: null,
    ab_test_id: null,
    provider: "none",
    durationMs: 0,
  };

  // ── Step 1: Kill-switch check ──────────────────────────────────────────────
  const killSwitchValue = await _readKillSwitch();
  if (killSwitchValue === false) {
    logger.info("Pattern aggregator: kill switch engaged — skipping");
    await _audit("auto_patch.loop_halted_skip", "success", { reason: "kill_switch" });
    return { ...empty, status: "halted", durationMs: Date.now() - startTime };
  }

  // ── Step 2: Read recent trade critiques ────────────────────────────────────
  let rows: CritiqueSummaryRow[];
  try {
    const rawRows = await db
      .select({
        id: tradeCritique.id,
        grade: tradeCritique.grade,
        technicalDiagnosis: tradeCritique.technicalDiagnosis,
        critiquedAt: tradeCritique.critiquedAt,
      })
      .from(tradeCritique)
      .orderBy(desc(tradeCritique.critiquedAt))
      .limit(DEFAULT_WINDOW);
    rows = rawRows as CritiqueSummaryRow[];
  } catch (err) {
    logger.error({ err }, "Pattern aggregator: failed to read trade_critique rows");
    await _audit("pattern_aggregator.failed", "failure", { reason: "db_read_error", error: String(err) });
    return { ...empty, status: "failed", durationMs: Date.now() - startTime };
  }

  // ── Step 3: Min-sample guard ───────────────────────────────────────────────
  if (rows.length < MIN_CRITIQUES) {
    logger.info(
      { rowCount: rows.length, minRequired: MIN_CRITIQUES },
      "Pattern aggregator: insufficient samples — skipping",
    );
    await _audit("pattern_aggregator.insufficient_samples", "success", {
      rows_found: rows.length,
      min_required: MIN_CRITIQUES,
    });
    return {
      ...empty,
      status: "insufficient_samples",
      critiques_reviewed: rows.length,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Step 4: Build LLM input (technical_diagnosis only) ────────────────────
  const diagnosisPayload = rows.map((r) => ({
    grade: r.grade,
    technical_diagnosis: r.technicalDiagnosis ?? {},
  }));

  const userMessage = JSON.stringify(diagnosisPayload, null, 2);

  // ── Step 5: Call LLM ───────────────────────────────────────────────────────
  let llmOutput: string | null = null;
  let usedProvider = "none";

  try {
    llmOutput = await callOpenAI("pattern_aggregator", [
      { role: "user", content: userMessage },
    ]);
    if (llmOutput) usedProvider = "openai";
  } catch (err) {
    logger.warn({ err }, "Pattern aggregator: GPT-5.4 call failed — trying Ollama fallback");
  }

  if (!llmOutput) {
    const fallback = getFallback("pattern_aggregator");
    if (fallback) {
      try {
        const ollama = new OllamaClient();
        const systemPrompt = loadSystemPrompt("pattern_aggregator");
        const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;
        const response = await ollama.generate(fallback.model, fullPrompt, undefined, false);
        llmOutput = response.response?.trim() ?? null;
        if (llmOutput) usedProvider = "ollama";
      } catch (err) {
        logger.error({ err }, "Pattern aggregator: Ollama fallback also failed");
      }
    }
  }

  if (!llmOutput) {
    logger.error("Pattern aggregator: both providers failed — aborting");
    await _audit("pattern_aggregator.failed", "failure", {
      critiques_reviewed: rows.length,
      reason: "all_providers_failed",
    });
    return { ...empty, status: "failed", critiques_reviewed: rows.length, durationMs: Date.now() - startTime };
  }

  const trimmedOutput = llmOutput.trim();

  // ── Step 6: NO_CHANGE path ─────────────────────────────────────────────────
  if (trimmedOutput === "NO_CHANGE" || trimmedOutput.startsWith("NO_CHANGE")) {
    logger.info({ critiquesReviewed: rows.length }, "Pattern aggregator: LLM found no robust patterns — no_change");
    await _audit("pattern_aggregator.no_change", "success", {
      critiques_reviewed: rows.length,
      provider: usedProvider,
      durationMs: Date.now() - startTime,
    });
    return {
      ...empty,
      status: "no_change",
      critiques_reviewed: rows.length,
      provider: usedProvider,
      durationMs: Date.now() - startTime,
    };
  }

  // ── Step 7 + 8: Persist prompt_versions + A/B test ────────────────────────
  let newVersionId: string | null = null;
  let abTestId: string | null = null;

  try {
    const result = await _storeVersionAndABTest(PROMPT_TYPE, trimmedOutput);
    newVersionId = result.versionId;
    abTestId = result.abTestId;
  } catch (err) {
    logger.error({ err }, "Pattern aggregator: failed to persist prompt_versions — continuing without persistence");
    // Non-fatal: still update the in-memory cache below
  }

  // ── Step 9: Update appendix cache immediately ──────────────────────────────
  setAppendixCache(PROMPT_TYPE, trimmedOutput);
  logger.info(
    { promptType: PROMPT_TYPE, contentLength: trimmedOutput.length },
    "Pattern aggregator: appendix cache updated",
  );

  // ── Step 10: Audit + return ────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;

  // Extract bullet hints for structured result (best-effort parse)
  const paramHints = _extractBulletPoints(trimmedOutput);

  await _audit("pattern_aggregator.completed", "success", {
    critiques_reviewed: rows.length,
    new_prompt_version_id: newVersionId,
    ab_test_id: abTestId,
    provider: usedProvider,
    appendix_length: trimmedOutput.length,
    durationMs,
  });

  logger.info(
    { critiquesReviewed: rows.length, provider: usedProvider, versionId: newVersionId, durationMs },
    "Pattern aggregator: completed",
  );

  return {
    status: "completed",
    critiques_reviewed: rows.length,
    parameter_hints: paramHints,
    concept_avoidance: [],
    regime_notes: [],
    new_prompt_version_id: newVersionId,
    ab_test_id: abTestId,
    provider: usedProvider,
    durationMs,
  };
}

// ─── Private helpers ───────────────────────────────────────────

/**
 * Read kill switch from system_parameters.
 * Returns true (enabled) if row missing or value != "false".
 * Returns false (disabled) only when value is exactly "false".
 */
async function _readKillSwitch(): Promise<boolean> {
  try {
    const rows = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, KILL_SWITCH_PARAM))
      .limit(1);

    if (rows.length === 0) return true; // missing = enabled (fail-open)
    return String(rows[0].currentValue).trim() !== "false";
  } catch (err) {
    logger.warn({ err }, "Pattern aggregator: failed to read kill switch — defaulting to enabled");
    return true; // fail-open
  }
}

/**
 * Persist a new prompt_versions row and manage A/B test lifecycle.
 * Replicated from prompt-evolution-service.ts to avoid circular import risk
 * (prompt-evolution-service.ts imports from model-router.ts; model-router.ts
 * would need to import from pattern-aggregator-service.ts for cache updates).
 */
async function _storeVersionAndABTest(
  promptType: string,
  content: string,
): Promise<{ versionId: string; abTestId: string | null }> {
  // Get max version for this prompt type
  const maxVersionRow = await db
    .select({ maxVer: sql<number>`COALESCE(MAX(${promptVersions.version}), 0)` })
    .from(promptVersions)
    .where(eq(promptVersions.promptType, promptType));

  const nextVersion = (maxVersionRow[0]?.maxVer ?? 0) + 1;

  // Check for running A/B test
  const runningTests = await db
    .select()
    .from(promptAbTests)
    .where(and(
      eq(promptAbTests.promptType, promptType),
      eq(promptAbTests.status, "running"),
    ))
    .limit(1);

  if (runningTests.length > 0) {
    // A/B test already running — queue the version, don't start a new test
    const [newRow] = await db.insert(promptVersions).values({
      promptType,
      version: nextVersion,
      content,
      isActive: false,
    }).returning({ id: promptVersions.id });

    logger.info({ promptType, version: nextVersion }, "Pattern aggregator: new version queued (A/B test already running)");
    return { versionId: newRow.id, abTestId: null };
  }

  // Get current active version
  const currentActive = await db
    .select()
    .from(promptVersions)
    .where(and(
      eq(promptVersions.promptType, promptType),
      eq(promptVersions.isActive, true),
    ))
    .orderBy(desc(promptVersions.version))
    .limit(1);

  // Insert new version as inactive
  const [newVersion] = await db.insert(promptVersions).values({
    promptType,
    version: nextVersion,
    content,
    isActive: false,
  }).returning();

  if (currentActive.length === 0) {
    // First version — activate directly
    await db
      .update(promptVersions)
      .set({ isActive: true })
      .where(eq(promptVersions.id, newVersion.id));

    logger.info({ promptType, version: nextVersion }, "Pattern aggregator: first version — activated directly");
    return { versionId: newVersion.id, abTestId: null };
  }

  // Create A/B test: A = current active, B = new version
  const [newTest] = await db.insert(promptAbTests).values({
    promptType,
    versionAId: currentActive[0].id,
    versionBId: newVersion.id,
    startedAt: new Date(),
    status: "running",
  }).returning({ id: promptAbTests.id });

  logger.info(
    { promptType, versionA: currentActive[0].version, versionB: nextVersion, testId: newTest.id },
    "Pattern aggregator: A/B test created",
  );

  return { versionId: newVersion.id, abTestId: newTest.id };
}

/**
 * Fire-and-forget audit row. Merges payload into result jsonb.
 * Never throws — non-blocking.
 */
async function _audit(
  action: string,
  status: "success" | "failure",
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      entityType: "pattern_aggregator",
      status,
      result: payload,
      decisionAuthority: "scheduler",
    });
  } catch (err) {
    logger.warn({ err, action }, "Pattern aggregator: audit row write failed (non-blocking)");
  }
}

/**
 * Extract bullet points from the appendix markdown for the structured result.
 * Best-effort only — used for result reporting, not for any gate logic.
 */
function _extractBulletPoints(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().slice(2).trim())
    .filter((line) => line.length > 0)
    .slice(0, 8); // cap at 8 bullets (matches rubric max)
}
