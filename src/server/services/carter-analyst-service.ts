/**
 * carter-analyst-service.ts — Carter's proactive "Analyst" daily aggregator.
 *
 * A DATA-AGGREGATOR cron (NO LLM). Once a day it gathers system signals — the
 * existing grounded read tools Carter's brain already uses — into one bounded
 * insight bundle, stores it as a `kind='insight'` carter_memory row, and posts a
 * concise family-grade Discord digest. On connect, Carter's gpt-5.4 brain reads
 * the stored bundle via the `get_daily_insights` read tool and SYNTHESIZES the
 * spoken briefing from it. This service composes NO prose beyond a short
 * count-derived headline — there is no model call anywhere in this file.
 *
 * REUSE rule (CLAUDE.md): the gatherers call the EXISTING handler functions
 * (diagnose_pipeline / find_hardening_opportunities / read_recent_decisions) via
 * their canonical handler maps — no SQL is duplicated here. Storage reuses
 * carter-memory-store.insertMemory (no new table).
 *
 * Guards mirror composite-health-digest-service.ts EXACTLY:
 *   - In-flight lock contention guard (_tryAcquireAnalystLock).
 *   - DST-safe ET-hour guard (fires only at ANALYST_HOUR_ET; caller passes asOf).
 *   - Fail-SOFT everywhere — every gatherer + Discord post is wrapped; the sweep
 *     NEVER throws out of the cron. Failures emit carter_analyst.sweep_failed.
 *
 * Audit actions:
 *   carter_analyst.sweep_completed             (success — bundle stored)
 *   carter_analyst.sweep_failed                (error — unexpected internal failure)
 *   carter_analyst.sweep_skipped_lock_contention  (info — previous tick in-flight)
 *   carter_analyst.sweep_skipped_dst_guard        (info — ET-hour != ANALYST_HOUR_ET)
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ../lib/logger.js leaf — never from ../index.js.
 */

import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notify } from "./notification-service.js";
import { insertMemory } from "../lib/carter/carter-memory-store.js";

// REUSE the existing grounded read handlers — do NOT re-implement their queries.
import { CARTER_RECOMMEND_HANDLERS } from "../lib/carter/carter-recommend.js";
import { CARTER_INTROSPECT_HANDLERS } from "../lib/carter/carter-introspect.js";

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** ET hour the analyst sweep is allowed to fire (08:00 ET morning briefing prep). */
const ANALYST_HOUR_ET = 8;
/** Recent lifecycle decisions to pull into the bundle (bounded). */
const RECENT_DECISIONS_LIMIT = 10;

// ─── Public Types ─────────────────────────────────────────────────────────────

export type AnalystSweepStatus =
  | "completed"
  | "skipped_lock_contention"
  | "skipped_dst_guard"
  | "failed";

export interface InsightBundle {
  generated_at_iso: string;
  pipeline: unknown;
  hardening: unknown;
  recent_decisions: unknown;
  headline: string;
}

export interface AnalystSweepResult {
  status: AnalystSweepStatus;
  correlationId: string;
  durationMs: number;
  headline?: string;
  memoryId?: number | null;
  dryRun?: boolean;
}

// ─── DST-safe ET-hour guard ────────────────────────────────────────────────────
// Mirrors composite-health-digest-service._getEtHour — Intl resolves
// America/New_York automatically, so this is DST-safe by construction.

function _getEtHour(asOf: Date): number {
  const etHourStr = asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(etHourStr, 10);
}

// ─── In-flight lock (mirrors scheduler._tryAcquireJobLock) ─────────────────────

let _sweepInFlight = false;

function _tryAcquireAnalystLock(correlationId: string): boolean {
  if (_sweepInFlight) {
    logger.warn(
      { correlationId, jobName: "carter-analyst-daily" },
      "carter-analyst: previous sweep still in-flight — skipping",
    );
    return false;
  }
  _sweepInFlight = true;
  return true;
}

function _releaseAnalystLock(): void {
  _sweepInFlight = false;
}

/** Exported for test isolation only. */
export function _resetAnalystLockForTest(): void {
  _sweepInFlight = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Length of an array-valued field, 0 when absent / non-array / error envelope. */
function arrLen(obj: unknown, key: string): number {
  if (!obj || typeof obj !== "object") return 0;
  const v = (obj as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Compose a SHORT plain-string headline from the gathered counts only.
 * NO LLM — pure string assembly Carter's brain can read back verbatim or expand.
 */
function composeHeadline(
  pipeline: unknown,
  hardening: unknown,
  recentDecisions: unknown,
): string {
  const parts: string[] = [];

  const staleCount = arrLen(hardening, "stale_strategies");
  if (staleCount > 0) parts.push(`${staleCount} strateg${staleCount === 1 ? "y" : "ies"} stale`);

  const stuckCount = arrLen(hardening, "stuck_pre_paper");
  if (stuckCount > 0) parts.push(`${stuckCount} stuck pre-PAPER`);

  // Heaviest recent block (top of the count-sorted recent_blocks list).
  if (pipeline && typeof pipeline === "object") {
    const blocks = (pipeline as Record<string, unknown>)["recent_blocks"];
    if (Array.isArray(blocks) && blocks.length > 0) {
      const top = blocks[0] as Record<string, unknown>;
      const gate = typeof top["gate_or_action"] === "string" ? top["gate_or_action"] : "a gate";
      const count = Number(top["count"]) || 0;
      if (count > 0) parts.push(`top block ${gate} (${count}x)`);
    }
  }

  const openIssues = arrLen(hardening, "open_issues");
  if (openIssues > 0) parts.push(`${openIssues} open issue${openIssues === 1 ? "" : "s"}`);

  const errCount = arrLen(hardening, "recent_errors");
  if (errCount > 0) parts.push(`${errCount} recent error${errCount === 1 ? "" : "s"}`);

  let decisionCount = 0;
  if (recentDecisions && typeof recentDecisions === "object") {
    decisionCount = Number((recentDecisions as Record<string, unknown>)["count"]) || 0;
  }
  if (decisionCount > 0) parts.push(`${decisionCount} recent decision${decisionCount === 1 ? "" : "s"}`);

  if (parts.length === 0) return "Nothing notable — pipeline quiet, no stale strategies or open issues.";
  return parts.join(", ") + ".";
}

/** Run one gatherer fail-soft; returns its result or a structured error envelope. */
async function gather(
  name: string,
  fn: (() => Promise<unknown>) | undefined,
  correlationId: string,
): Promise<unknown> {
  if (typeof fn !== "function") {
    logger.warn({ name, correlationId }, "carter-analyst: gatherer handler missing");
    return { error: `${name}_handler_missing` };
  }
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, name, correlationId }, "carter-analyst: gatherer threw (non-fatal)");
    return { error: `${name}_failed` };
  }
}

// ─── Main public function ─────────────────────────────────────────────────────

/**
 * runCarterAnalystSweep
 *
 * Gathers pipeline diagnosis + hardening opportunities + recent lifecycle
 * decisions into a bounded insight bundle, stores it as a kind='insight'
 * carter_memory row, and posts a family-grade Discord digest. NEVER throws.
 *
 * @param opts.asOf    Override "now" for the DST guard + generated_at_iso.
 *                     Default: new Date(). Caller passes it so tests can time-travel.
 * @param opts.dryRun  Skip Discord post; bundle + audit row still written.
 */
export async function runCarterAnalystSweep(
  opts: { asOf?: Date; dryRun?: boolean } = {},
): Promise<AnalystSweepResult> {
  const correlationId = randomUUID();
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const dryRun = opts.dryRun ?? false;

  // ── 1. Lock contention guard ──────────────────────────────────────────────
  if (!_tryAcquireAnalystLock(correlationId)) {
    await insertAuditRowSafe({
      action: "carter_analyst.sweep_skipped_lock_contention",
      entityType: "carter_analyst_daily",
      entityId: null,
      result: { correlationId, dryRun },
      status: "info",
      decisionAuthority: "system",
      correlationId,
    });
    return { status: "skipped_lock_contention", correlationId, durationMs: Date.now() - t0, dryRun };
  }

  try {
    // ── 2. DST-safe ET-hour guard ───────────────────────────────────────────
    const etHour = _getEtHour(asOf);
    if (etHour !== ANALYST_HOUR_ET) {
      logger.debug(
        { etHour, correlationId, jobName: "carter-analyst-daily" },
        "carter-analyst: ET-hour mismatch — skipping (DST guard)",
      );
      await insertAuditRowSafe({
        action: "carter_analyst.sweep_skipped_dst_guard",
        entityType: "carter_analyst_daily",
        entityId: null,
        result: { etHour, expected: ANALYST_HOUR_ET, correlationId, dryRun },
        status: "info",
        decisionAuthority: "system",
        correlationId,
      });
      return { status: "skipped_dst_guard", correlationId, durationMs: Date.now() - t0, dryRun };
    }

    logger.info(
      { correlationId, jobName: "carter-analyst-daily", dryRun },
      "carter-analyst: sweep start (ET-hour confirmed)",
    );

    // ── 3. Gather signals (fail-soft each) ──────────────────────────────────
    const pipeline = await gather(
      "diagnose_pipeline",
      CARTER_RECOMMEND_HANDLERS["diagnose_pipeline"]
        ? () => CARTER_RECOMMEND_HANDLERS["diagnose_pipeline"]!(undefined)
        : undefined,
      correlationId,
    );
    const hardening = await gather(
      "find_hardening_opportunities",
      CARTER_RECOMMEND_HANDLERS["find_hardening_opportunities"]
        ? () => CARTER_RECOMMEND_HANDLERS["find_hardening_opportunities"]!(undefined)
        : undefined,
      correlationId,
    );
    const recentDecisions = await gather(
      "read_recent_decisions",
      CARTER_INTROSPECT_HANDLERS["read_recent_decisions"]
        ? () => CARTER_INTROSPECT_HANDLERS["read_recent_decisions"]!({ limit: RECENT_DECISIONS_LIMIT })
        : undefined,
      correlationId,
    );

    // ── 4. Build the bounded bundle (NO LLM — headline is count-derived) ─────
    const headline = composeHeadline(pipeline, hardening, recentDecisions);
    const bundle: InsightBundle = {
      generated_at_iso: asOf.toISOString(),
      pipeline,
      hardening,
      recent_decisions: recentDecisions,
      headline,
    };

    // ── 5. Store as a kind='insight' carter_memory row (fail-soft) ───────────
    const memoryId = await insertMemory({
      kind: "insight",
      content: JSON.stringify(bundle),
      source: "analyst",
    });

    // ── 6. Post the family-grade Discord digest (fail-soft) ──────────────────
    if (!dryRun) {
      try {
        const operatorBody = [
          `[CARTER ANALYST] Daily insight bundle`,
          headline,
          `Correlation ID: ${correlationId}`,
        ].join("\n");
        const fullBody = appendFamilyGradePostscript(
          operatorBody,
          `Carter's daily check of the bot found: ${headline}`,
          "No action needed — Carter will walk Tony through this on the next call.",
        );
        notify({
          severity: "INFO",
          title: "[Carter Analyst] Daily insight bundle",
          body: fullBody,
          metadata: { job: "carter-analyst-daily", headline, memoryId, correlationId },
        });
      } catch (discordErr) {
        const errMsg = discordErr instanceof Error ? discordErr.message : String(discordErr);
        logger.error(
          { err: discordErr, correlationId, jobName: "carter-analyst-daily" },
          "carter-analyst: Discord post failed (non-fatal)",
        );
        // Discord failure must NOT fail the sweep — bundle already stored.
        await insertAuditRowSafe({
          action: "carter_analyst.sweep_completed",
          entityType: "carter_analyst_daily",
          entityId: null,
          result: { memoryId, headline, discord_failed: errMsg, dry_run: dryRun, correlationId, duration_ms: Date.now() - t0 },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
        return {
          status: "completed",
          correlationId,
          durationMs: Date.now() - t0,
          headline,
          memoryId,
          dryRun,
        };
      }
    }

    // ── 7. Emit success audit row ────────────────────────────────────────────
    const durationMs = Date.now() - t0;
    await insertAuditRowSafe({
      action: "carter_analyst.sweep_completed",
      entityType: "carter_analyst_daily",
      entityId: null,
      result: { memoryId, headline, dry_run: dryRun, correlationId, duration_ms: durationMs },
      status: "success",
      decisionAuthority: "system",
      correlationId,
    });

    logger.info(
      { correlationId, memoryId, headline, dryRun, durationMs, jobName: "carter-analyst-daily" },
      "carter-analyst: sweep complete",
    );

    return { status: "completed", correlationId, durationMs, headline, memoryId, dryRun };
  } catch (err) {
    // ── Catch-all — NEVER throw out of the cron ──────────────────────────────
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, correlationId, jobName: "carter-analyst-daily" },
      "carter-analyst: sweep failed (unexpected) — emitting sweep_failed audit",
    );
    await insertAuditRowSafe({
      action: "carter_analyst.sweep_failed",
      entityType: "carter_analyst_daily",
      entityId: null,
      result: { error: errMsg, correlationId, dryRun, duration_ms: Date.now() - t0 },
      status: "error",
      decisionAuthority: "system",
      correlationId,
    });
    return { status: "failed", correlationId, durationMs: Date.now() - t0, dryRun };
  } finally {
    _releaseAnalystLock();
  }
}
