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
 *   Numeric value ≥ 1 enables the loop.  Any other value, a missing row,
 *   or a DB error disables the loop (FAIL-CLOSED) and emits
 *   auto_patch.loop_halted_skip.  Store 1 to enable, 0 to disable (never the
 *   string "true"/"false" — current_value is a NUMERIC column).
 *
 * Min-sample guard: env PATTERN_AGGREGATOR_MIN_CRITIQUES (default 10).
 *   Fewer critiques than the threshold → audit + return "insufficient_samples".
 *
 * A/B test: new prompt_versions rows start with isActive=false. The weekly
 *   prompt-evolution resolveAbTests() job determines which version wins.
 */

import { randomUUID } from "crypto";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { tradeCritique, systemParameters, auditLog, promptVersions, promptAbTests } from "../db/schema.js";
import { callOpenAI, getFallback, loadSystemPrompt, setAppendixCache } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyWarning } from "./notification-service.js";
import { logger } from "../lib/logger.js";

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_WINDOW = Number(process.env.PATTERN_AGGREGATOR_WINDOW ?? "20");
const MIN_CRITIQUES =  Number(process.env.PATTERN_AGGREGATOR_MIN_CRITIQUES ?? "10");
const KILL_SWITCH_PARAM = "auto_patch_loop_enabled";
const PROMPT_TYPE = "strategy_proposer";
const MIN_SAMPLES_PER_VARIANT = 20;

// F-6: consecutive-failure tracking (mirrors trade-critique-service.ts pattern)
const CONSEC_FAIL_KEY = "pattern_aggregator_consecutive_failures";
const CONSEC_FAIL_THRESHOLD = 3;

// F-7: readiness-nudge dedup window (env LEARNING_LOOP_READY_NUDGE_DAYS, default 7)
const NUDGE_DEDUP_DAYS = Number(process.env.LEARNING_LOOP_READY_NUDGE_DAYS ?? "7");
const NUDGE_ACTION = "auto_patch.loop_ready_but_disabled";

// ─── Consecutive-failure tracking (F-6) ──────────────────────────────────────

/**
 * Read the current consecutive-failure count from system_parameters.
 * Fail-open: returns 0 on any DB error so one bad read never falsely fires an alert.
 */
async function _readConsecFailures(): Promise<number> {
  try {
    const rows = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, CONSEC_FAIL_KEY))
      .limit(1);
    return rows.length > 0 ? parseInt(rows[0].currentValue ?? "0", 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Upsert the consecutive-failure counter, return the new value.
 * Never throws — failure to increment is non-fatal; returns 0 on error.
 */
async function _incrementConsecFailures(): Promise<number> {
  try {
    const current = await _readConsecFailures();
    const next = current + 1;
    await _upsertParam(CONSEC_FAIL_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

/**
 * Reset the consecutive-failure counter (called on a successful run).
 * Best-effort — failure to reset is non-fatal.
 */
async function _resetConsecFailures(): Promise<void> {
  try {
    await _upsertParam(CONSEC_FAIL_KEY, "0");
  } catch {
    // best-effort
  }
}

/**
 * Generic system_parameters upsert helper.
 * Uses .limit(1) for mock-safe resolution (consistent with _readConsecFailures).
 */
async function _upsertParam(key: string, value: string): Promise<void> {
  const rows = await db
    .select({ paramName: systemParameters.paramName })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, key))
    .limit(1);

  if (rows.length > 0) {
    await db
      .update(systemParameters)
      .set({ currentValue: value, updatedAt: new Date() })
      .where(eq(systemParameters.paramName, key));
  } else {
    await db.insert(systemParameters).values({
      paramName: key,
      currentValue: value,
      description: "Pattern aggregator consecutive failure counter (auto-resets on success)",
      domain: "critic",
    });
  }
}

/**
 * Fire the Discord WARN for N consecutive failures.
 * Fail-soft: any error is swallowed so the cron is never brought down
 * by a Discord or notification-service issue.
 */
function _warnConsecFailures(strikes: number): void {
  try {
    notifyWarning(
      "Pattern Aggregator — 3 Consecutive Failures",
      appendFamilyGradePostscript(
        `The pattern aggregator has failed ${strikes} times in a row. ` +
        `Check OPENAI_API_KEY, Ollama connectivity, and model availability. ` +
        `Trading Forge continues to operate normally — pattern aggregation is advisory.`,
        "The bot's self-improvement feature has been having trouble — it's trying to review trade patterns but keeps running into errors.",
        "No action needed. The bot is still trading normally. Tell Tony if this alert keeps appearing.",
      ),
      {
        strikes,
        param: KILL_SWITCH_PARAM,
        action: "investigate_llm_connectivity",
        service: "pattern_aggregator",
      },
    );
  } catch (err) {
    // Fail-soft — Discord failure must never crash the cron.
    logger.warn({ err }, "Pattern aggregator: consecutive-failure Discord WARN failed (non-fatal)");
  }
}

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
 *
 * @param dryRun - When true, suppresses prompt_versions INSERT, A/B test row creation,
 *   and audit_log writes. setAppendixCache() STILL fires (in-memory only — safe for
 *   replay). LLM call still fires; result returned for inspection. Pass 2 replay uses this.
 */
export async function runPatternAggregator(dryRun: boolean = false): Promise<PatternAggregatorResult> {
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
  // FIX (Finding MED — Wave A Critic): dryRun callers (replay harness) must
  // be able to produce non-empty analysis even when the operator has halted the
  // autonomous loop.  Suppressing only "audit_log writes" while still respecting
  // the kill switch contradicts the docstring at line 96 and makes the replay
  // harness return {status:"halted"}, which is an empty result useless for
  // grading.  When dryRun===true we skip the kill-switch gate and log a warn
  // so the operator knows the bypass occurred.  The non-dryRun production path
  // retains kill-switch semantics unchanged.
  if (dryRun) {
    logger.warn(
      { killSwitchParam: KILL_SWITCH_PARAM },
      "pattern-aggregator: dryRun bypasses kill switch",
    );
  } else {
    const killSwitchValue = await _readKillSwitch();
    if (killSwitchValue === false) {
      const correlationId = randomUUID();
      logger.info({ correlationId }, "Pattern aggregator: kill switch engaged — skipping");
      await _audit("auto_patch.loop_halted_skip", "success", { reason: "kill_switch" });
      // L4: emit structured kill-switch-observed event so post-incident review can
      // reconstruct whether the loop was halted during any window.
      await insertAuditRowSafe({
        action: "auto_patch.loop_halted_kill_switch",
        entityType: "scheduler",
        status: "info",
        result: { service: "pattern-aggregator", param: KILL_SWITCH_PARAM } as Record<string, unknown>,
        correlationId,
      });

      // F-7: readiness nudge — fire as a side-effect, never a gate.
      // Count eligible critiques and notify if the loop WOULD aggregate right now
      // if it were enabled.  Deduped to at most once per NUDGE_DEDUP_DAYS days.
      // Fail-soft: any error here must never block the halted return.
      try {
        const eligible = await _countEligibleCritiques();
        await _maybeEmitReadinessNudge(eligible);
      } catch (err) {
        logger.warn({ err }, "pattern-aggregator: readiness nudge check failed (non-fatal)");
      }

      return { ...empty, status: "halted", durationMs: Date.now() - startTime };
    }
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
    if (!dryRun) await _audit("pattern_aggregator.failed", "failure", { reason: "db_read_error", error: String(err) });
    return { ...empty, status: "failed", durationMs: Date.now() - startTime };
  }

  // ── Step 3: Min-sample guard ───────────────────────────────────────────────
  if (rows.length < MIN_CRITIQUES) {
    logger.info(
      { rowCount: rows.length, minRequired: MIN_CRITIQUES },
      "Pattern aggregator: insufficient samples — skipping",
    );
    if (!dryRun) await _audit("pattern_aggregator.insufficient_samples", "success", {
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

    // F-6: track consecutive failures and fire a Discord WARN at the threshold.
    // Fail-soft: counter read/write errors are non-fatal; warn is fire-and-forget.
    if (!dryRun) {
      const strikes = await _incrementConsecFailures();

      await _audit("pattern_aggregator.failed", "failure", {
        critiques_reviewed: rows.length,
        reason: "all_providers_failed",
        strikes,
      });

      if (strikes >= CONSEC_FAIL_THRESHOLD) {
        _warnConsecFailures(strikes);
        // Emit a dedicated audit row so post-incident review can reconstruct the alert.
        await _audit("pattern_aggregator.consecutive_failure_alert", "failure", {
          strikes,
          threshold: CONSEC_FAIL_THRESHOLD,
          alert_sent: true,
        });
      }
    }

    return { ...empty, status: "failed", critiques_reviewed: rows.length, durationMs: Date.now() - startTime };
  }

  const trimmedOutput = llmOutput.trim();

  // ── Step 6: NO_CHANGE path ─────────────────────────────────────────────────
  if (trimmedOutput === "NO_CHANGE" || trimmedOutput.startsWith("NO_CHANGE")) {
    logger.info({ critiquesReviewed: rows.length }, "Pattern aggregator: LLM found no robust patterns — no_change");
    if (!dryRun) await _audit("pattern_aggregator.no_change", "success", {
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

  // ── Step 7 + 8: Persist prompt_versions + A/B test (skipped in dry-run) ─────
  let newVersionId: string | null = null;
  let abTestId: string | null = null;

  if (!dryRun) {
    try {
      const result = await _storeVersionAndABTest(PROMPT_TYPE, trimmedOutput);
      newVersionId = result.versionId;
      abTestId = result.abTestId;
    } catch (err) {
      logger.error({ err }, "Pattern aggregator: failed to persist prompt_versions — continuing without persistence");
      // Non-fatal: still update the in-memory cache below
    }
  }

  // ── Step 9: Update appendix cache immediately (always fires — in-memory, safe) ──
  setAppendixCache(PROMPT_TYPE, trimmedOutput);
  logger.info(
    { promptType: PROMPT_TYPE, contentLength: trimmedOutput.length },
    "Pattern aggregator: appendix cache updated",
  );

  // ── Step 10: Audit + return ────────────────────────────────────────────────
  const durationMs = Date.now() - startTime;

  // Extract bullet hints for structured result (best-effort parse)
  const paramHints = _extractBulletPoints(trimmedOutput);

  if (!dryRun) {
    // F-6: reset consecutive-failure counter on success so the next run starts fresh.
    await _resetConsecFailures();

    await _audit("pattern_aggregator.completed", "success", {
      critiques_reviewed: rows.length,
      new_prompt_version_id: newVersionId,
      ab_test_id: abTestId,
      provider: usedProvider,
      appendix_length: trimmedOutput.length,
      durationMs,
    });
  }

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
 * FAIL-CLOSED: returns true (enabled) ONLY when the row is present AND
 * Number(current_value) >= 1.  An absent row, any value that parses to
 * less than 1, or a DB error all return false (disabled) so the LLM-mutation
 * loop never fires without explicit operator opt-in.
 *
 * NOTE: current_value is a NUMERIC column — never store the string "true".
 * Store 1 to enable, 0 to disable.
 *
 * F-5 fix (Wave B): inverted from the previous fail-open semantic.
 */
async function _readKillSwitch(): Promise<boolean> {
  try {
    const rows = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, KILL_SWITCH_PARAM))
      .limit(1);

    // Absent row → DISABLED (fail-closed).
    if (rows.length === 0) return false;
    // Numeric ≥ 1 enables the loop.  "1" → 1, "0" → 0, "true" → NaN → false.
    return Number(rows[0].currentValue) >= 1;
  } catch (err) {
    logger.warn({ err }, "Pattern aggregator: failed to read kill switch — defaulting to disabled (fail-closed)");
    return false; // fail-closed
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
 * Count how many eligible trade_critique rows currently exist (same window as
 * the normal aggregation path: last DEFAULT_WINDOW rows, capped by MIN_CRITIQUES).
 * Returns the count as a non-negative integer.
 * Fail-open: returns 0 on any DB error so a bad read never crashes the halt path.
 */
async function _countEligibleCritiques(): Promise<number> {
  try {
    const rows = await db
      .select({ id: tradeCritique.id })
      .from(tradeCritique)
      .orderBy(desc(tradeCritique.critiquedAt))
      .limit(DEFAULT_WINDOW);
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * Check whether a readiness-nudge audit row was written within the dedup window.
 * Returns true if a recent nudge row exists (within NUDGE_DEDUP_DAYS days).
 * Fail-open: returns false on any DB error (let the nudge fire so operator isn't silenced).
 */
async function _hasRecentNudgeAudit(): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - NUDGE_DEDUP_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, NUDGE_ACTION),
          gte(auditLog.createdAt, cutoff),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * F-7: Emit the "loop ready but disabled" readiness nudge.
 *
 * Fires when the kill switch is DISABLED and the eligible critique count is at
 * or above MIN_CRITIQUES.  The nudge is:
 *   - An audit row (status=warning, action=auto_patch.loop_ready_but_disabled)
 *   - A Discord WARN via notifyWarning + family-grade postscript
 *
 * The nudge is DEDUPED: only fires if no row with this action exists in the last
 * NUDGE_DEDUP_DAYS days (env LEARNING_LOOP_READY_NUDGE_DAYS, default 7).
 *
 * INVARIANTS:
 *   - NEVER auto-enables the loop
 *   - NEVER mutates any prompt or kill-switch value
 *   - Fail-soft: any nudge/Discord/dedup error is swallowed (non-fatal)
 *   - Ordered as a side-effect — never blocks or gates the halted return
 */
async function _maybeEmitReadinessNudge(eligibleCritiques: number): Promise<void> {
  if (eligibleCritiques < MIN_CRITIQUES) {
    // Not ready yet — dormant path.  No nudge.
    return;
  }

  // Dedup: skip if a recent nudge was already sent.
  let recentExists = false;
  try {
    recentExists = await _hasRecentNudgeAudit();
  } catch {
    // Fail-open: let it fire if we can't check
  }

  if (recentExists) {
    logger.debug(
      { action: NUDGE_ACTION, dedupDays: NUDGE_DEDUP_DAYS },
      "pattern-aggregator: readiness nudge deduped — recent nudge exists within window",
    );
    return;
  }

  // ── Write audit row ──────────────────────────────────────────────────────────
  const nudgePayload = {
    eligibleCritiques,
    threshold: MIN_CRITIQUES,
    paramName: KILL_SWITCH_PARAM,
    dedupWindowDays: NUDGE_DEDUP_DAYS,
  };
  try {
    await _audit(NUDGE_ACTION, "warning", nudgePayload as unknown as Record<string, unknown>);
  } catch (err) {
    // Fail-soft — audit failure never crashes
    logger.warn({ err }, "pattern-aggregator: readiness nudge audit write failed (non-fatal)");
  }

  // ── Fire Discord WARN ────────────────────────────────────────────────────────
  const operatorBody =
    `Learning loop READY but OFF — ${eligibleCritiques} trade critiques have accumulated ` +
    `(threshold ${MIN_CRITIQUES}). The bot can start improving its own strategy generator, ` +
    `but it's currently disabled for safety. ` +
    `To turn it ON: set system_parameters.auto_patch_loop_enabled = 1 (numeric). ` +
    `Leaving it OFF is safe — the bot just won't self-improve.`;

  const fullBody = appendFamilyGradePostscript(
    operatorBody,
    `The trading bot has enough data to start learning from its own trades (${eligibleCritiques} ` +
    `critiques collected), but the self-improvement feature is turned off.`,
    `No action needed unless Tony says so. The bot continues trading normally either way.`,
  );

  try {
    notifyWarning(
      "Learning Loop READY but OFF",
      fullBody,
      {
        eligibleCritiques,
        threshold: MIN_CRITIQUES,
        paramName: KILL_SWITCH_PARAM,
        action: "set_auto_patch_loop_enabled_true_to_enable",
        service: "pattern_aggregator",
      },
    );
  } catch (err) {
    // Fail-soft — Discord failure must never crash the cron
    logger.warn({ err }, "pattern-aggregator: readiness nudge Discord WARN failed (non-fatal)");
  }
}

/**
 * Fire-and-forget audit row. Merges payload into result jsonb.
 * Never throws — non-blocking.
 */
async function _audit(
  action: string,
  status: "success" | "failure" | "warning" | "info",
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
