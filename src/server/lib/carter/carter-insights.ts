/**
 * carter-insights.ts — read side of Carter's proactive "Analyst".
 *
 * One GREEN, read-only, no-param handler: `get_daily_insights`. It returns the
 * LATEST insight bundle the daily analyst sweep stored in carter_memory
 * (kind='insight', source='analyst'), parsed back into its structured shape so
 * Carter's gpt-5.4 brain can synthesize a spoken briefing on connect.
 *
 * REUSE: reads via carter-memory-store.queryMemories (kind filter) — no SQL is
 * re-implemented here. queryMemories is fail-soft (returns [] on DB error), so a
 * read failure degrades to { note: "no insights yet" }, never a throw.
 *
 * Handler key MUST match the CarterTool.handler field in tool-registry.ts; the
 * contract test enforces parity. Spread into CARTER_READ_HANDLERS via
 * carter-reads.ts.
 */

import { queryMemories } from "./carter-memory-store.js";
import { logger } from "../logger.js";

/**
 * get_daily_insights (GREEN read, no params) — returns the latest analyst
 * insight bundle parsed, or { note: "no insights yet" } when none exist / the
 * stored content is unparseable.
 */
async function getDailyInsights(_params: unknown): Promise<unknown> {
  const rows = await queryMemories({ kind: "insight", limit: 1 });
  if (rows.length === 0) {
    return { note: "no insights yet" };
  }

  const latest = rows[0]!;
  let bundle: Record<string, unknown>;
  try {
    const parsed = JSON.parse(latest.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { note: "no insights yet" };
    }
    bundle = parsed as Record<string, unknown>;
  } catch (err) {
    logger.warn({ err }, "carter-insights.get_daily_insights: stored bundle unparseable");
    return { note: "no insights yet" };
  }

  const createdAtIso =
    latest.createdAt instanceof Date ? latest.createdAt.toISOString() : String(latest.createdAt);

  return {
    generated_at: bundle["generated_at_iso"] ?? createdAtIso,
    headline: bundle["headline"] ?? null,
    pipeline: bundle["pipeline"] ?? null,
    hardening: bundle["hardening"] ?? null,
    recent_decisions: bundle["recent_decisions"] ?? null,
  };
}

/** Spread into CARTER_READ_HANDLERS (carter-reads.ts). */
export const CARTER_INSIGHTS_READ_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  get_daily_insights: getDailyInsights,
};
