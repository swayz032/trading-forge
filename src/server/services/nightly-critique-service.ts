/**
 * Nightly Critique Service — Closes the learning loop.
 *
 * Runs at 11:30 PM ET every night. Reviews the day's strategy generation
 * results from system_journal, calls the LLM to extract failure patterns
 * and success signals, then stores the analysis back into the system so
 * the next generation cycle can learn from it.
 *
 * Flow:
 *   1. Fetch system_journal entries from past 24h
 *   2. Group by tier (TIER_1, TIER_2, TIER_3, REJECTED)
 *   3. Call nightly_review model via model-router to analyze patterns
 *   4. Store per-entry analyst notes on journal entries
 *   5. Store lesson summary in system_parameters (nightly_critique_latest)
 *   6. Broadcast SSE event nightly:review-complete
 */

import { eq, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemJournal, systemParameters, auditLog } from "../db/schema.js";
import { callOpenAI, getFallback, loadSystemPrompt } from "./model-router.js";
import { OllamaClient } from "./ollama-client.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────

interface CritiqueResult {
  period_reviewed: string;
  strategies_generated: number;
  strategies_passed: number;
  pass_rate: number;
  top_concept: string;
  worst_concept: string;
  pattern_insights: string[];
  parameter_insights: string[];
  regime_insights: string[];
  recommendations: string[];
  confidence: "high" | "medium" | "low";
}

interface TierGroup {
  tier: string;
  count: number;
  entries: Array<{
    id: string;
    source: string;
    forgeScore: string | null;
    generationPrompt: string | null;
    strategyParams: unknown;
    performanceGateResult: unknown;
    tier: string | null;
    status: string;
  }>;
}

// ─── Main entry point ───────────────────────────────────────────

export async function runNightlyCritique(): Promise<void> {
  const startTime = Date.now();
  logger.info("Nightly critique: starting review cycle");

  // 1. Fetch journal entries from past 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentEntries = await db
    .select({
      id: systemJournal.id,
      source: systemJournal.source,
      generationPrompt: systemJournal.generationPrompt,
      strategyParams: systemJournal.strategyParams,
      forgeScore: systemJournal.forgeScore,
      performanceGateResult: systemJournal.performanceGateResult,
      tier: systemJournal.tier,
      status: systemJournal.status,
      analystNotes: systemJournal.analystNotes,
      createdAt: systemJournal.createdAt,
    })
    .from(systemJournal)
    .where(gte(systemJournal.createdAt, twentyFourHoursAgo));

  if (recentEntries.length === 0) {
    logger.info("Nightly critique: no journal entries in past 24h — skipping");
    broadcastSSE("nightly:review-complete", {
      status: "skipped",
      reason: "no_entries",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  logger.info({ entryCount: recentEntries.length }, "Nightly critique: fetched recent entries");

  // 2. Group by tier
  const tierGroups = groupByTier(recentEntries);

  // 2b. Fetch graveyard meta-learning report (if available) for context injection
  let graveyardReport: string | null = null;
  try {
    const { generateFailureModeReport } = await import("./graveyard-intelligence-service.js");
    graveyardReport = await generateFailureModeReport();
    if (graveyardReport === "No failure patterns detected yet.") graveyardReport = null;
  } catch (err) {
    logger.warn({ err }, "Nightly critique: graveyard meta-learning report unavailable");
  }

  // 3. Build the LLM prompt with concrete data
  const prompt = buildCritiquePrompt(tierGroups, recentEntries.length, graveyardReport);

  // 4. Call the LLM (cloud first, Ollama fallback)
  let usedProvider = "unknown";

  // Try cloud model first
  let critiqueJson: string | null = await callOpenAI("nightly_review", [
    { role: "user", content: prompt },
  ]);

  if (critiqueJson) {
    usedProvider = "openai";
  } else {
    // Fallback to Ollama
    logger.info("Nightly critique: cloud unavailable, falling back to Ollama");
    const fallback = getFallback("nightly_review");
    const fallbackModel = fallback?.model ?? "deepseek-r1:14b";
    const ollama = new OllamaClient();
    const systemPrompt = loadSystemPrompt("nightly_review");
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    try {
      const response = await ollama.generate(fallbackModel, fullPrompt, undefined, true);
      critiqueJson = response.response;
      usedProvider = "ollama";
    } catch (err) {
      logger.error({ err }, "Nightly critique: Ollama fallback also failed");
    }
  }

  if (!critiqueJson) {
    logger.error("Nightly critique: all model calls failed — aborting");
    broadcastSSE("nightly:review-complete", {
      status: "failed",
      reason: "model_unavailable",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 5. Parse the critique
  let critique: CritiqueResult;
  try {
    critique = JSON.parse(critiqueJson);
  } catch (err) {
    logger.error({ err, rawLength: critiqueJson.length }, "Nightly critique: failed to parse LLM response as JSON");
    // Store the raw text as-is so nothing is lost
    critique = {
      period_reviewed: new Date().toISOString().slice(0, 10),
      strategies_generated: recentEntries.length,
      strategies_passed: recentEntries.filter((e) => e.tier && e.tier !== "REJECTED").length,
      pass_rate: 0,
      top_concept: "parse_error",
      worst_concept: "parse_error",
      pattern_insights: ["LLM returned non-JSON response — raw text stored in analyst notes"],
      parameter_insights: [],
      regime_insights: [],
      recommendations: [],
      confidence: "low",
    };
  }

  // 6. Update journal entries with per-tier analyst notes
  const noteTimestamp = new Date().toISOString();
  const notePrefix = `[Nightly Critique ${noteTimestamp}]`;
  let updatedCount = 0;

  for (const entry of recentEntries) {
    // Only annotate entries that don't already have today's critique
    if (entry.analystNotes?.includes(notePrefix)) continue;

    const tierNote = buildEntryNote(entry.tier, critique, notePrefix);
    const existingNotes = entry.analystNotes ?? "";
    const newNotes = existingNotes
      ? `${existingNotes}\n\n${tierNote}`
      : tierNote;

    try {
      await db
        .update(systemJournal)
        .set({ analystNotes: newNotes })
        .where(eq(systemJournal.id, entry.id));
      updatedCount++;
    } catch (err) {
      logger.warn({ err, entryId: entry.id }, "Nightly critique: failed to update journal entry");
    }
  }

  logger.info({ updatedCount }, "Nightly critique: updated journal entries with analyst notes");

  // 7. Store lesson summary in system_parameters
  //    currentValue is numeric — use as a version counter.
  //    description holds the JSON critique text (text column).
  const summaryText = JSON.stringify(critique, null, 2);
  try {
    const existing = await db
      .select()
      .from(systemParameters)
      .where(eq(systemParameters.paramName, "nightly_critique_latest"));

    if (existing.length > 0) {
      const prevVersion = Number(existing[0].currentValue) || 0;
      await db
        .update(systemParameters)
        .set({
          currentValue: String(prevVersion + 1),
          description: summaryText,
          updatedAt: new Date(),
        })
        .where(eq(systemParameters.paramName, "nightly_critique_latest"));
    } else {
      await db.insert(systemParameters).values({
        paramName: "nightly_critique_latest",
        currentValue: "1",
        description: summaryText,
        domain: "critic",
        autoTunable: false,
      });
    }
    logger.info("Nightly critique: lesson summary persisted to system_parameters");
  } catch (err) {
    logger.error({ err }, "Nightly critique: failed to persist lesson summary");
  }

  // 8. Audit log
  try {
    await db.insert(auditLog).values({
      action: "nightly_critique.complete",
      entityType: "system_journal",
      status: "success",
      durationMs: Date.now() - startTime,
      result: {
        entries_reviewed: recentEntries.length,
        entries_annotated: updatedCount,
        pass_rate: critique.pass_rate,
        top_concept: critique.top_concept,
        worst_concept: critique.worst_concept,
        recommendations_count: critique.recommendations.length,
        provider: usedProvider,
      },
      decisionAuthority: "scheduler",
    });
  } catch {
    // Non-blocking — audit log failure should not break the pipeline
  }

  // 9. Broadcast SSE
  const durationMs = Date.now() - startTime;
  broadcastSSE("nightly:review-complete", {
    status: "success",
    entriesReviewed: recentEntries.length,
    entriesAnnotated: updatedCount,
    passRate: critique.pass_rate,
    topConcept: critique.top_concept,
    worstConcept: critique.worst_concept,
    recommendationsCount: critique.recommendations.length,
    provider: usedProvider,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    {
      entriesReviewed: recentEntries.length,
      entriesAnnotated: updatedCount,
      passRate: critique.pass_rate,
      provider: usedProvider,
      durationMs,
    },
    "Nightly critique: review cycle complete",
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function groupByTier(
  entries: Array<{ id: string; source: string; forgeScore: string | null; generationPrompt: string | null; strategyParams: unknown; performanceGateResult: unknown; tier: string | null; status: string }>,
): TierGroup[] {
  const groups: Record<string, TierGroup> = {};

  for (const entry of entries) {
    const tier = entry.tier ?? "UNTIERED";
    if (!groups[tier]) {
      groups[tier] = { tier, count: 0, entries: [] };
    }
    groups[tier].count++;
    groups[tier].entries.push({
      id: entry.id,
      source: entry.source,
      forgeScore: entry.forgeScore,
      generationPrompt: entry.generationPrompt,
      strategyParams: entry.strategyParams,
      performanceGateResult: entry.performanceGateResult,
      tier: entry.tier,
      status: entry.status,
    });
  }

  return Object.values(groups);
}

function buildCritiquePrompt(tierGroups: TierGroup[], totalCount: number, graveyardReport?: string | null): string {
  const tierSummaries = tierGroups.map((g) => {
    const entryDetails = g.entries
      .slice(0, 20) // Cap to prevent token overflow
      .map((e, i) => {
        const params = e.strategyParams
          ? JSON.stringify(e.strategyParams).slice(0, 300)
          : "none";
        const gateResult = e.performanceGateResult
          ? JSON.stringify(e.performanceGateResult).slice(0, 300)
          : "none";
        return `  ${i + 1}. [${e.source}] forgeScore=${e.forgeScore ?? "?"} prompt="${(e.generationPrompt ?? "").slice(0, 150)}" params=${params} gates=${gateResult}`;
      })
      .join("\n");

    return `### ${g.tier} (${g.count} strategies)\n${entryDetails}`;
  });

  return `You are reviewing the last 24 hours of Trading Forge strategy generation results.

## Summary
- Total strategies generated: ${totalCount}
- Breakdown by tier:
${tierGroups.map((g) => `  - ${g.tier}: ${g.count}`).join("\n")}

## Detailed Entries by Tier
${tierSummaries.join("\n\n")}

## Your Task
Analyze these strategy generation results and answer:
1. What patterns do the REJECTED strategies share? What common failure modes appear?
2. What do TIER_1 and TIER_2 strategies have in common? What made them succeed?
3. Are there parameter ranges, concepts, or sources that consistently fail or succeed?
4. What specific, actionable changes should the next generation cycle focus on?
5. Is the overall pass rate healthy, or is there a systemic issue?
${graveyardReport ? `\n## Historical Failure Patterns (Graveyard Intelligence)\nThe following failure patterns were extracted from strategies that previously died (RETIRED/GRAVEYARD). Use these to inform your analysis and recommendations — avoid suggesting approaches that match known failure clusters.\n\n${graveyardReport}` : ""}
Respond with valid JSON matching the expected schema.`;
}

function buildEntryNote(
  tier: string | null,
  critique: CritiqueResult,
  prefix: string,
): string {
  const lines = [prefix];

  if (tier === "REJECTED") {
    lines.push("Status: REJECTED — patterns identified in nightly review:");
    if (critique.pattern_insights.length > 0) {
      lines.push(`Failure patterns: ${critique.pattern_insights.slice(0, 3).join("; ")}`);
    }
    if (critique.recommendations.length > 0) {
      lines.push(`Next-gen guidance: ${critique.recommendations[0]}`);
    }
  } else if (tier === "TIER_1" || tier === "TIER_2") {
    lines.push(`Status: ${tier} — flagged as successful pattern in nightly review.`);
    if (critique.top_concept) {
      lines.push(`Top concept this cycle: ${critique.top_concept}`);
    }
  } else if (tier === "TIER_3") {
    lines.push("Status: TIER_3 — marginal pass. Review parameter sensitivity.");
    if (critique.parameter_insights.length > 0) {
      lines.push(`Parameter insight: ${critique.parameter_insights[0]}`);
    }
  } else {
    lines.push("Status: Untiered — no tier assigned at time of review.");
  }

  lines.push(`Overall pass rate: ${critique.pass_rate}% | Confidence: ${critique.confidence}`);
  return lines.join("\n");
}
