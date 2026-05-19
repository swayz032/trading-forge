/**
 * Prompt Evolution Service — Makes strategy generation smarter over time.
 *
 * Runs weekly (Sunday 10 PM ET). Analyzes past 7 days of system_journal
 * entries to discover which concept patterns, symbols, and timeframes
 * produce TIER_1/2/3 strategies vs REJECTED ones. Synthesizes findings
 * into a "prompt appendix" that is injected into the strategy_proposer
 * system prompt so both GPT-5-mini and Ollama fallback learn from history.
 *
 * Storage: prompt_versions table for versioned content + A/B testing.
 *          Legacy fallback: system_parameters row with paramName = "prompt_evolution_appendix".
 *
 * A/B Testing: New prompt versions are tested against the current active
 *              version. Strategies are deterministically assigned to variant
 *              A or B using a hash of their strategyId. After 7 days with
 *              20+ samples per variant, the system auto-promotes or rolls back.
 *
 * Contract: getActivePromptContent(promptType) returns the current active prompt
 *           content, with A/B-aware variant selection. getPromptAppendix() is a
 *           convenience wrapper for the "strategy_proposer" type.
 */

import { createHash } from "crypto";
import { eq, gte, and, sql, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemJournal, systemParameters, auditLog, promptVersions, promptAbTests } from "../db/schema.js";
import { callOpenAI, getFallback, loadSystemPrompt } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── Constants ─────────────────────────────────────────────────

const PARAM_NAME = "prompt_evolution_appendix";
const PARAM_DOMAIN = "strategy_generation";
const LOOKBACK_DAYS = 7;
const MIN_SAMPLES_PER_VARIANT = 20;
const PASS_RATE_THRESHOLD = 0.05;    // 5% pass rate improvement to promote B
const FORGE_SCORE_THRESHOLD = 3;      // 3 forge score improvement to promote B
const ROLLBACK_STDDEV_THRESHOLD = 2;  // 2 stddev below baseline to rollback
const MAX_EXTENSIONS = 2;             // Max 2 test extensions (14 days total)

// ─── Types ─────────────────────────────────────────────────────

interface JournalEntry {
  id: string;
  source: string;
  generationPrompt: string | null;
  strategyParams: unknown;
  forgeScore: string | null;
  tier: string | null;
  status: string;
  createdAt: Date;
}

interface TierAnalysis {
  tier: string;
  count: number;
  concepts: string[];
  symbols: string[];
  timeframes: string[];
  avgForgeScore: number | null;
}

interface EvolutionResult {
  period_start: string;
  period_end: string;
  total_entries: number;
  tier_breakdown: Record<string, number>;
  prefer: string[];
  avoid: string[];
  best_performing: string;
  common_failure_modes: string;
  appendix_text: string;
}

interface VariantMetrics {
  totalStrategies: number;
  passedStrategies: number;
  passRate: number;
  avgForgeScore: number;
  forgeScores: number[];
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Retrieve the current prompt appendix from prompt_versions (A/B-aware).
 * Called by model-router when building the strategy_proposer system prompt.
 *
 * FAIL-SAFE: Returns empty string on any error so strategy generation
 * is never blocked by prompt evolution infrastructure.
 */
export async function getPromptAppendix(): Promise<string> {
  return getActivePromptContent("strategy_proposer");
}

/**
 * Get the active prompt content for a given prompt type.
 * If an A/B test is running, uses hash of a random strategyId seed to pick variant.
 * For deterministic per-strategy selection, use getActivePromptContentForStrategy().
 */
export async function getActivePromptContent(promptType: string): Promise<string> {
  try {
    // Check for active version in prompt_versions
    const activeVersions = await db
      .select({ content: promptVersions.content })
      .from(promptVersions)
      .where(and(
        eq(promptVersions.promptType, promptType),
        eq(promptVersions.isActive, true),
      ))
      .orderBy(desc(promptVersions.version))
      .limit(1);

    if (activeVersions.length > 0) {
      return activeVersions[0].content;
    }

    // Fall back to legacy system_parameters
    const rows = await db
      .select({ description: systemParameters.description })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, PARAM_NAME));

    if (rows.length === 0 || !rows[0].description) return "";
    return rows[0].description;
  } catch (err) {
    logger.warn({ err }, "Prompt evolution: failed to read active content — returning empty (non-blocking)");
    return "";
  }
}

/**
 * Get the active prompt content for a specific strategy (A/B-aware).
 * Uses hash of strategyId for deterministic 50/50 split when an A/B test is running.
 */
export async function getActivePromptContentForStrategy(
  promptType: string,
  strategyId: string,
): Promise<{ content: string; versionId: string | null; variant: "A" | "B" | null }> {
  try {
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
      const test = runningTests[0];
      const variant = hashToVariant(strategyId);

      const versionId = variant === "A" ? test.versionAId : test.versionBId;
      if (versionId) {
        const version = await db
          .select({ content: promptVersions.content })
          .from(promptVersions)
          .where(eq(promptVersions.id, versionId))
          .limit(1);

        if (version.length > 0) {
          return { content: version[0].content, versionId, variant };
        }
      }
    }

    // No A/B test running — return active version
    const activeVersions = await db
      .select({ id: promptVersions.id, content: promptVersions.content })
      .from(promptVersions)
      .where(and(
        eq(promptVersions.promptType, promptType),
        eq(promptVersions.isActive, true),
      ))
      .orderBy(desc(promptVersions.version))
      .limit(1);

    if (activeVersions.length > 0) {
      return { content: activeVersions[0].content, versionId: activeVersions[0].id, variant: null };
    }

    // Fall back to legacy system_parameters
    const rows = await db
      .select({ description: systemParameters.description })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, PARAM_NAME));

    const content = rows.length > 0 && rows[0].description ? rows[0].description : "";
    return { content, versionId: null, variant: null };
  } catch (err) {
    logger.warn({ err }, "Prompt evolution: failed to read content for strategy — returning empty (non-blocking)");
    return { content: "", versionId: null, variant: null };
  }
}

/**
 * Main weekly job: analyze journal entries, synthesize patterns,
 * store updated prompt appendix with A/B testing.
 */
export async function runPromptEvolution(): Promise<void> {
  const startTime = Date.now();
  logger.info("Prompt evolution: starting weekly analysis");

  // 1. Fetch journal entries from past 7 days (only tested/failed, not scouted)
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const entries = await db
    .select({
      id: systemJournal.id,
      source: systemJournal.source,
      generationPrompt: systemJournal.generationPrompt,
      strategyParams: systemJournal.strategyParams,
      forgeScore: systemJournal.forgeScore,
      tier: systemJournal.tier,
      status: systemJournal.status,
      createdAt: systemJournal.createdAt,
    })
    .from(systemJournal)
    .where(
      and(
        gte(systemJournal.createdAt, cutoff),
        sql`${systemJournal.status} IN ('tested', 'failed', 'promoted')`,
      ),
    )
    .orderBy(desc(systemJournal.createdAt));

  if (entries.length === 0) {
    logger.info("Prompt evolution: no testable journal entries in past 7 days — skipping");
    broadcastSSE("prompt-evolution:complete", {
      status: "skipped",
      reason: "no_entries",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  logger.info({ entryCount: entries.length }, "Prompt evolution: fetched journal entries for analysis");

  // 2. Group by tier and extract patterns
  const tierAnalysis = analyzeTiers(entries);
  const tierBreakdown: Record<string, number> = {};
  for (const ta of tierAnalysis) {
    tierBreakdown[ta.tier] = ta.count;
  }

  // 3. Build LLM prompt with concrete data
  const analysisPrompt = buildEvolutionPrompt(tierAnalysis, entries.length);

  // 4. Call LLM (nightly_review role — cloud first, Ollama fallback)
  let usedProvider = "unknown";

  let resultJson: string | null = await callOpenAI("nightly_review", [
    { role: "user", content: analysisPrompt },
  ]);

  if (resultJson) {
    usedProvider = "openai";
  } else {
    logger.info("Prompt evolution: cloud unavailable, falling back to Ollama");
    const fallback = getFallback("nightly_review");
    const fallbackModel = fallback?.model ?? "deepseek-r1:14b";
    const ollama = new OllamaClient();
    const systemPrompt = loadSystemPrompt("nightly_review");
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${analysisPrompt}` : analysisPrompt;
    try {
      const response = await ollama.generate(fallbackModel, fullPrompt, undefined, true);
      resultJson = response.response;
      usedProvider = "ollama";
    } catch (err) {
      logger.error({ err }, "Prompt evolution: Ollama fallback also failed");
    }
  }

  if (!resultJson) {
    logger.error("Prompt evolution: all model calls failed — aborting");
    broadcastSSE("prompt-evolution:complete", {
      status: "failed",
      reason: "model_unavailable",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 5. Parse the LLM result
  let evolution: EvolutionResult;
  try {
    evolution = JSON.parse(resultJson);
  } catch {
    logger.warn("Prompt evolution: LLM returned non-JSON — building fallback appendix from raw text");
    evolution = buildFallbackEvolution(resultJson, entries, tierBreakdown);
  }

  // 6. Build the final appendix text
  const appendixText = evolution.appendix_text || buildAppendixText(evolution);

  if (!appendixText || appendixText.length < 20) {
    logger.warn("Prompt evolution: appendix too short — skipping persistence");
    return;
  }

  // 7. Store as versioned prompt and manage A/B testing
  const promptType = "strategy_proposer";

  try {
    await storeVersionAndManageAbTest(promptType, appendixText);
    logger.info("Prompt evolution: new version stored with A/B test management");
  } catch (err) {
    logger.error({ err }, "Prompt evolution: failed to store versioned prompt — falling back to legacy");
    // Fall back to legacy system_parameters storage
    await legacyPersist(appendixText);
  }

  // 8. Audit log
  try {
    await db.insert(auditLog).values({
      action: "prompt_evolution.complete",
      entityType: "system_parameters",
      status: "success",
      durationMs: Date.now() - startTime,
      result: {
        entries_analyzed: entries.length,
        tier_breakdown: tierBreakdown,
        prefer_count: evolution.prefer?.length ?? 0,
        avoid_count: evolution.avoid?.length ?? 0,
        appendix_length: appendixText.length,
        provider: usedProvider,
      },
      decisionAuthority: "scheduler",
    });
  } catch {
    // Non-blocking
  }

  // 9. Broadcast SSE
  const durationMs = Date.now() - startTime;
  broadcastSSE("prompt-evolution:complete", {
    status: "success",
    entriesAnalyzed: entries.length,
    tierBreakdown,
    preferCount: evolution.prefer?.length ?? 0,
    avoidCount: evolution.avoid?.length ?? 0,
    appendixLength: appendixText.length,
    provider: usedProvider,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    {
      entriesAnalyzed: entries.length,
      tierBreakdown,
      appendixLength: appendixText.length,
      provider: usedProvider,
      durationMs,
    },
    "Prompt evolution: weekly analysis complete",
  );
}

/**
 * Resolve running A/B tests by comparing variant metrics.
 * Called weekly by the scheduler.
 */
export async function resolveAbTests(): Promise<void> {
  logger.info("Prompt A/B resolution: starting");

  const runningTests = await db
    .select()
    .from(promptAbTests)
    .where(eq(promptAbTests.status, "running"));

  if (runningTests.length === 0) {
    logger.info("Prompt A/B resolution: no running tests — skipping");
    return;
  }

  for (const test of runningTests) {
    try {
      await resolveOneTest(test);
    } catch (err) {
      logger.error({ err, testId: test.id }, "Prompt A/B resolution: failed to resolve test");
    }
  }

  logger.info({ testsProcessed: runningTests.length }, "Prompt A/B resolution: complete");
}

// ─── A/B Test Management ──────────────────────────────────────

/**
 * Store a new prompt version and create/skip A/B test as appropriate.
 */
async function storeVersionAndManageAbTest(promptType: string, content: string): Promise<void> {
  // Get the current max version
  const maxVersionRow = await db
    .select({ maxVer: sql<number>`COALESCE(MAX(${promptVersions.version}), 0)` })
    .from(promptVersions)
    .where(eq(promptVersions.promptType, promptType));

  const nextVersion = (maxVersionRow[0]?.maxVer ?? 0) + 1;

  // Check if there's a running A/B test for this prompt type
  const runningTest = await db
    .select()
    .from(promptAbTests)
    .where(and(
      eq(promptAbTests.promptType, promptType),
      eq(promptAbTests.status, "running"),
    ))
    .limit(1);

  if (runningTest.length > 0) {
    // A/B test already running — store the version but don't start a new test
    await db.insert(promptVersions).values({
      promptType,
      version: nextVersion,
      content,
      isActive: false,  // Not active — queued for next test cycle
    });
    logger.info({ promptType, version: nextVersion }, "Prompt evolution: new version queued (A/B test already running)");
    return;
  }

  // Get the current active version
  const currentActive = await db
    .select()
    .from(promptVersions)
    .where(and(
      eq(promptVersions.promptType, promptType),
      eq(promptVersions.isActive, true),
    ))
    .orderBy(desc(promptVersions.version))
    .limit(1);

  // Insert the new version as inactive
  const [newVersion] = await db.insert(promptVersions).values({
    promptType,
    version: nextVersion,
    content,
    isActive: false,
  }).returning();

  if (currentActive.length === 0) {
    // No active version — this is the first one; activate it directly
    await db
      .update(promptVersions)
      .set({ isActive: true })
      .where(eq(promptVersions.id, newVersion.id));
    logger.info({ promptType, version: nextVersion }, "Prompt evolution: first version — activated directly");
    return;
  }

  // Create A/B test: version A = current active, version B = new
  await db.insert(promptAbTests).values({
    promptType,
    versionAId: currentActive[0].id,
    versionBId: newVersion.id,
    startedAt: new Date(),
    status: "running",
  });

  logger.info(
    { promptType, versionA: currentActive[0].version, versionB: nextVersion },
    "Prompt evolution: A/B test created",
  );
}

/**
 * Resolve a single A/B test by comparing metrics from strategies generated
 * with each variant in the test period.
 */
async function resolveOneTest(test: typeof promptAbTests.$inferSelect): Promise<void> {
  const testAge = Date.now() - test.startedAt.getTime();
  const testDays = testAge / (24 * 60 * 60 * 1000);

  // Count extensions: each extension adds 7 days, max 2 extensions (21 days total)
  const extensions = Math.floor(Math.max(0, testDays - 7) / 7);

  // Collect metrics for each variant
  const metricsA = await collectVariantMetrics(test.versionAId!, test.startedAt);
  const metricsB = await collectVariantMetrics(test.versionBId!, test.startedAt);

  logger.info({
    testId: test.id,
    metricsA: { total: metricsA.totalStrategies, passRate: metricsA.passRate, avgForge: metricsA.avgForgeScore },
    metricsB: { total: metricsB.totalStrategies, passRate: metricsB.passRate, avgForge: metricsB.avgForgeScore },
    testDays: Math.round(testDays),
    extensions,
  }, "Prompt A/B resolution: variant metrics collected");

  // Check if we have enough samples
  const enoughSamples = metricsA.totalStrategies >= MIN_SAMPLES_PER_VARIANT
    && metricsB.totalStrategies >= MIN_SAMPLES_PER_VARIANT;

  if (!enoughSamples) {
    if (extensions >= MAX_EXTENSIONS) {
      // Max extensions reached — keep A (the current active), discard B
      await concludeTest(test, "A", metricsA, metricsB, "insufficient_samples_max_extensions");
      return;
    }
    // Not enough data yet — extend (just leave running, checked again next week)
    logger.info(
      { testId: test.id, samplesA: metricsA.totalStrategies, samplesB: metricsB.totalStrategies },
      "Prompt A/B resolution: insufficient samples — extending test",
    );
    return;
  }

  // Compare: is B significantly better?
  const passRateImprovement = metricsB.passRate - metricsA.passRate;
  const forgeScoreImprovement = metricsB.avgForgeScore - metricsA.avgForgeScore;

  // Check for rollback: B is significantly worse (2 stddev below A baseline)
  const stddevA = computeStdDev(metricsA.forgeScores);
  const forgeScoreDiff = metricsB.avgForgeScore - metricsA.avgForgeScore;

  if (stddevA > 0 && forgeScoreDiff < -ROLLBACK_STDDEV_THRESHOLD * stddevA) {
    // B is significantly worse — rollback to A
    await concludeTest(test, "A", metricsA, metricsB, "rollback_b_worse_2stddev");
    return;
  }

  // Check if B wins
  if (passRateImprovement >= PASS_RATE_THRESHOLD || forgeScoreImprovement >= FORGE_SCORE_THRESHOLD) {
    // B is better — promote B
    await concludeTest(test, "B", metricsA, metricsB, "b_promoted");
    return;
  }

  // Inconclusive — extend if possible
  if (extensions >= MAX_EXTENSIONS) {
    // Max extensions reached — keep A
    await concludeTest(test, "A", metricsA, metricsB, "inconclusive_max_extensions");
    return;
  }

  logger.info(
    { testId: test.id, passRateImprovement, forgeScoreImprovement },
    "Prompt A/B resolution: inconclusive — extending test",
  );
}

/**
 * Conclude an A/B test: promote the winner, deactivate the loser.
 */
async function concludeTest(
  test: typeof promptAbTests.$inferSelect,
  winner: "A" | "B",
  metricsA: VariantMetrics,
  metricsB: VariantMetrics,
  reason: string,
): Promise<void> {
  const winnerVersionId = winner === "A" ? test.versionAId! : test.versionBId!;

  // Deactivate all versions of this prompt type, then activate the winner
  await db
    .update(promptVersions)
    .set({ isActive: false })
    .where(eq(promptVersions.promptType, test.promptType));

  await db
    .update(promptVersions)
    .set({
      isActive: true,
      metrics: winner === "A"
        ? metricsA as unknown as Record<string, unknown>
        : metricsB as unknown as Record<string, unknown>,
    })
    .where(eq(promptVersions.id, winnerVersionId));

  // Update the test record
  await db
    .update(promptAbTests)
    .set({
      endedAt: new Date(),
      metricsA: metricsA as unknown as Record<string, unknown>,
      metricsB: metricsB as unknown as Record<string, unknown>,
      winner,
      status: "completed",
    })
    .where(eq(promptAbTests.id, test.id));

  // Also sync the active content back to legacy system_parameters for backward compatibility
  const winnerContent = await db
    .select({ content: promptVersions.content })
    .from(promptVersions)
    .where(eq(promptVersions.id, winnerVersionId))
    .limit(1);

  if (winnerContent.length > 0) {
    await legacyPersist(winnerContent[0].content);
  }

  // Audit log
  try {
    await db.insert(auditLog).values({
      action: "prompt_ab_test.resolved",
      entityType: "prompt_ab_tests",
      entityId: test.id,
      result: {
        winner,
        reason,
        metricsA: { passRate: metricsA.passRate, avgForge: metricsA.avgForgeScore, total: metricsA.totalStrategies },
        metricsB: { passRate: metricsB.passRate, avgForge: metricsB.avgForgeScore, total: metricsB.totalStrategies },
      },
      status: "success",
      decisionAuthority: "scheduler",
    });
  } catch {
    // Non-blocking
  }

  broadcastSSE("prompt-ab-test:resolved", {
    testId: test.id,
    promptType: test.promptType,
    winner,
    reason,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { testId: test.id, winner, reason, promptType: test.promptType },
    "Prompt A/B test resolved",
  );
}

/**
 * Collect performance metrics for strategies that were generated
 * while a specific prompt version was active.
 *
 * Since we can't retroactively know which version each strategy used
 * (unless we tag them), we use the deterministic hash-based split:
 * strategies whose ID hashes to the same variant as this version
 * are attributed to it.
 */
async function collectVariantMetrics(
  versionId: string,
  testStartedAt: Date,
): Promise<VariantMetrics> {
  // First, figure out if this is version A or B in the test
  const tests = await db
    .select()
    .from(promptAbTests)
    .where(sql`${promptAbTests.versionAId} = ${versionId} OR ${promptAbTests.versionBId} = ${versionId}`)
    .limit(1);

  if (tests.length === 0) {
    return { totalStrategies: 0, passedStrategies: 0, passRate: 0, avgForgeScore: 0, forgeScores: [] };
  }

  const isVariantA = tests[0].versionAId === versionId;
  const targetVariant: "A" | "B" = isVariantA ? "A" : "B";

  // Get all journal entries since the test started
  const entries = await db
    .select({
      id: systemJournal.id,
      strategyId: systemJournal.strategyId,
      forgeScore: systemJournal.forgeScore,
      tier: systemJournal.tier,
      status: systemJournal.status,
    })
    .from(systemJournal)
    .where(
      and(
        gte(systemJournal.createdAt, testStartedAt),
        sql`${systemJournal.status} IN ('tested', 'failed', 'promoted')`,
      ),
    );

  // Filter to entries that hash to this variant
  const variantEntries = entries.filter((entry) => {
    const id = entry.strategyId ?? entry.id;
    return hashToVariant(id) === targetVariant;
  });

  const forgeScores: number[] = [];
  let passedCount = 0;

  for (const entry of variantEntries) {
    if (entry.forgeScore) {
      const score = Number(entry.forgeScore);
      if (!isNaN(score)) forgeScores.push(score);
    }

    // "Passed" = has a tier that's not REJECTED
    const passed = entry.tier && entry.tier !== "REJECTED" && entry.status !== "failed";
    if (passed) passedCount++;
  }

  const total = variantEntries.length;
  const avgForge = forgeScores.length > 0
    ? forgeScores.reduce((a, b) => a + b, 0) / forgeScores.length
    : 0;

  return {
    totalStrategies: total,
    passedStrategies: passedCount,
    passRate: total > 0 ? passedCount / total : 0,
    avgForgeScore: Math.round(avgForge * 100) / 100,
    forgeScores,
  };
}

// ─── Utility Functions ────────────────────────────────────────

/**
 * Deterministic hash-based A/B split. Given a string ID, always returns
 * the same variant ("A" or "B") for reproducibility.
 */
function hashToVariant(id: string): "A" | "B" {
  const hash = createHash("sha256").update(id).digest();
  // Use first byte: even = A, odd = B (50/50 split)
  return hash[0] % 2 === 0 ? "A" : "B";
}

/**
 * Compute standard deviation of an array of numbers.
 */
function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Legacy persistence: upsert to system_parameters for backward compatibility.
 */
async function legacyPersist(appendixText: string): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(systemParameters)
      .where(eq(systemParameters.paramName, PARAM_NAME));

    if (existing.length > 0) {
      const prevVersion = Number(existing[0].currentValue) || 0;
      await db
        .update(systemParameters)
        .set({
          currentValue: String(prevVersion + 1),
          description: appendixText,
          updatedAt: new Date(),
        })
        .where(eq(systemParameters.paramName, PARAM_NAME));
    } else {
      await db.insert(systemParameters).values({
        paramName: PARAM_NAME,
        currentValue: "1",
        description: appendixText,
        domain: PARAM_DOMAIN,
        autoTunable: false,
      });
    }
  } catch (err) {
    logger.error({ err }, "Prompt evolution: legacy persist failed");
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function analyzeTiers(entries: JournalEntry[]): TierAnalysis[] {
  const groups: Record<string, JournalEntry[]> = {};

  for (const entry of entries) {
    const tier = entry.tier ?? "UNTIERED";
    if (!groups[tier]) groups[tier] = [];
    groups[tier].push(entry);
  }

  return Object.entries(groups).map(([tier, items]) => {
    const concepts: string[] = [];
    const symbols: string[] = [];
    const timeframes: string[] = [];
    let scoreSum = 0;
    let scoreCount = 0;

    for (const item of items) {
      // Extract concept from generation prompt
      if (item.generationPrompt) {
        concepts.push(item.generationPrompt);
      }

      // Extract symbol/timeframe from strategyParams
      if (item.strategyParams && typeof item.strategyParams === "object") {
        const params = item.strategyParams as Record<string, unknown>;
        if (typeof params.symbol === "string") symbols.push(params.symbol);
        if (typeof params.timeframe === "string") timeframes.push(params.timeframe);
      }

      // Forge score
      if (item.forgeScore) {
        const score = Number(item.forgeScore);
        if (!isNaN(score)) {
          scoreSum += score;
          scoreCount++;
        }
      }
    }

    return {
      tier,
      count: items.length,
      concepts,
      symbols: [...new Set(symbols)],
      timeframes: [...new Set(timeframes)],
      avgForgeScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
    };
  });
}

function buildEvolutionPrompt(tierAnalysis: TierAnalysis[], totalEntries: number): string {
  const tierSummaries = tierAnalysis.map((ta) => {
    const conceptList = ta.concepts.length > 0
      ? ta.concepts.slice(0, 10).map((c) => `  - "${c}"`).join("\n")
      : "  (none recorded)";
    const symbolList = ta.symbols.length > 0 ? ta.symbols.join(", ") : "mixed/unknown";
    const tfList = ta.timeframes.length > 0 ? ta.timeframes.join(", ") : "mixed/unknown";

    return `### ${ta.tier} (${ta.count} strategies, avg forge score: ${ta.avgForgeScore ?? "N/A"})
Concepts:
${conceptList}
Symbols: ${symbolList}
Timeframes: ${tfList}`;
  }).join("\n\n");

  return `You are analyzing the past week's automated strategy generation results for Trading Forge, a futures trading system targeting $250+/day on 50K prop firm accounts.

## Task
Review the tier breakdown below and synthesize actionable patterns into a structured JSON response that will be appended to the strategy proposer's system prompt to improve future generations.

## Data (past 7 days, ${totalEntries} total strategies)

${tierSummaries}

## Required JSON Response Format
{
  "period_start": "ISO date string",
  "period_end": "ISO date string",
  "total_entries": ${totalEntries},
  "tier_breakdown": { "TIER_1": N, "TIER_2": N, ... },
  "prefer": ["pattern or concept that succeeded - be specific", ...],
  "avoid": ["pattern or concept that failed - be specific", ...],
  "best_performing": "1-2 sentence description of what worked best and why",
  "common_failure_modes": "1-2 sentence description of recurring failure patterns",
  "appendix_text": "The full text block to append to the strategy proposer prompt. Format it as:\\nLEARNED PATTERNS (auto-updated weekly):\\n- Prefer: [list]\\n- Avoid: [list]\\n- Best performing: [details]\\n- Common failure modes: [details]"
}

## Guidelines
- Be specific. "Mean reversion on MES 5min" is useful. "Good strategies" is not.
- Focus on actionable guidance that would change what the proposer generates next week.
- If there are too few entries to draw conclusions, say so in the appendix and keep recommendations conservative.
- The appendix_text must be self-contained — it will be appended directly to the system prompt.
- Keep appendix_text under 500 words. Conciseness matters for prompt budget.`;
}

function buildAppendixText(evolution: EvolutionResult): string {
  const preferList = (evolution.prefer ?? []).map((p) => `  - ${p}`).join("\n");
  const avoidList = (evolution.avoid ?? []).map((a) => `  - ${a}`).join("\n");

  return `\nLEARNED PATTERNS (auto-updated weekly, v${new Date().toISOString().slice(0, 10)}):
- Prefer:
${preferList || "  (insufficient data)"}
- Avoid:
${avoidList || "  (insufficient data)"}
- Best performing: ${evolution.best_performing || "(insufficient data)"}
- Common failure modes: ${evolution.common_failure_modes || "(insufficient data)"}`;
}

function buildFallbackEvolution(
  rawText: string,
  entries: JournalEntry[],
  tierBreakdown: Record<string, number>,
): EvolutionResult {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  return {
    period_start: weekAgo.toISOString().slice(0, 10),
    period_end: now.toISOString().slice(0, 10),
    total_entries: entries.length,
    tier_breakdown: tierBreakdown,
    prefer: [],
    avoid: [],
    best_performing: "(LLM returned unstructured text — see raw analysis below)",
    common_failure_modes: "(LLM returned unstructured text — see raw analysis below)",
    appendix_text: `\nLEARNED PATTERNS (auto-updated weekly, v${now.toISOString().slice(0, 10)}):
Note: Auto-analysis returned unstructured text. Raw insights:
${rawText.slice(0, 800)}`,
  };
}
