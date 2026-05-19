/**
 * Wave 23F Trace Helper (2026-05-19)
 *
 * Operator-facing query utilities for reconstructing any Wave 23F scout cycle
 * or graduation from a single correlation_id. Designed for incident diagnosis
 * and promotion audit reconstruction.
 *
 * NOTE on schema: audit_log uses `result` (not `evidence`) for the outcome
 * JSONB column. The Wave23fTraceRow interface exposes it as `evidence` for
 * API stability in case the column is aliased in the future.
 *
 * Import: always from ./logger.js (leaf module) — never from ../index.js.
 * See CLAUDE.md §15 and memory feedback_helper_logger_import.md.
 */
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger.js";

export interface Wave23fTraceRow {
  created_at: Date;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  /** Maps to the `result` JSONB column on audit_log (schema alias). */
  evidence: unknown;
}

/**
 * Fetch all audit_log rows for a given correlation_id, ordered by created_at ASC.
 *
 * This is the primary reconstruction query: every W23F graduation row should
 * share the HTTP-request correlation_id that was active when the bucket first
 * triggered graduation via the /scout-ideas/pending handler.
 *
 * NOTE: scout_cycle.started rows use a DIFFERENT correlation_id (the cycle's
 * own UUID, set in autonomous-scout-runner.ts). They are NOT linked to the
 * HTTP-layer correlation_id because postLayerMention does not forward the
 * cycle correlationId as an HTTP header. This is a known gap (Wave 23F
 * Correlation Finding #1) — the cycle ID is stored as `entityId` on
 * scout_cycle.started rows and must be queried separately.
 *
 * @see summarizeWave23fCycle
 */
export async function traceWave23fCycle(correlationId: string): Promise<Wave23fTraceRow[]> {
  const rows = await db
    .select({
      created_at: auditLog.createdAt,
      action: auditLog.action,
      entity_type: auditLog.entityType,
      entity_id: auditLog.entityId,
      evidence: auditLog.result,
    })
    .from(auditLog)
    .where(eq(auditLog.correlationId, correlationId))
    .orderBy(asc(auditLog.createdAt));
  logger.info({ correlationId, row_count: rows.length }, "wave23f.trace_resolved");
  return rows;
}

/**
 * Summarize a Wave 23F cycle trace by correlation_id.
 *
 * Returns aggregate counts useful for operator dashboards and incident review.
 * All counts are computed from the rows returned by traceWave23fCycle().
 *
 * Expected correlation_id scope: HTTP-request correlationId from the
 * /scout-ideas/pending call that triggered graduation. This links:
 *   - pending_bucket.created (if new bucket)
 *   - pending_bucket.mention_added
 *   - graduation.entry_quality_attached
 *   - graduation.symbols_multi_market (conditional)
 *
 * scout_cycle.started rows are NOT included in this summary (different
 * correlation_id — see traceWave23fCycle jsdoc for explanation).
 */
export async function summarizeWave23fCycle(correlationId: string): Promise<{
  cycle_started: boolean;
  seeded_symbol: string | null;
  mentions_recorded: number;
  graduations: number;
  multi_market_graduations: number;
  total_events: number;
}> {
  const rows = await traceWave23fCycle(correlationId);
  return {
    cycle_started: rows.some((r) => r.action === "scout_cycle.started"),
    seeded_symbol:
      (rows.find((r) => r.action === "scout_cycle.started")?.evidence as any)?.seeded_symbol ?? null,
    mentions_recorded: rows.filter((r) => r.action.startsWith("mention.") || r.action === "pending_bucket.mention_added").length,
    graduations: rows.filter((r) => r.action === "graduation.entry_quality_attached").length,
    multi_market_graduations: rows.filter((r) => r.action === "graduation.symbols_multi_market").length,
    total_events: rows.length,
  };
}
