/**
 * audit-log-helper.ts — centralized audit_log insert wrapper.
 *
 * WHY THIS EXISTS:
 *   165+ scattered `db.insert(auditLog).values({...})` call sites across the
 *   codebase made it impossible to enforce correlation_id propagation. Wave 4
 *   (2026-05-16) adds a logger.warn whenever a row is written without a
 *   correlationId so context propagation gaps are surfaced at runtime without
 *   blocking legitimate cron / backfill paths that have no request context.
 *
 * USAGE:
 *   import { insertAuditRow } from "../lib/audit-log-helper.js";
 *   await insertAuditRow({ action: "...", entityId: "...", ... });
 *
 * MIGRATION STRATEGY:
 *   Hot call sites (lifecycle-service, broker-router, agent-service) are the
 *   priority; others can be migrated incrementally. The function is a drop-in
 *   for `db.insert(auditLog).values({...})` — same shape, same return type.
 *
 * NON-BLOCKING:
 *   Callers that already .catch() errors continue to work. This helper does NOT
 *   throw on insert failure — it warns and rethrows so callers see the original
 *   error, not a wrapper error.
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
// Import logger from ../lib/logger.js (not ../index.js) to avoid pulling the
// entire Express bootstrap graph (routes/, services/) into any module that
// only needs to write an audit row. Wave 6 architect verification caught this:
// importing from ../index.js dragged routes/compliance.ts into bitwarden +
// dead-mans-heartbeat test loads, which mocked db/schema.js partially and
// blew up on the unmocked `complianceRulesets` export.
import { logger } from "./logger.js";

/** Shape accepted by the audit_log table insert. Matches schema.$inferInsert. */
export type AuditRowValues = typeof auditLog.$inferInsert;

/**
 * insertAuditRow — drop-in wrapper over `db.insert(auditLog).values(values)`.
 *
 * Emits a structured logger.warn when `correlationId` is null/undefined so
 * operators can query for propagation gaps via log aggregation. Does NOT throw
 * on missing correlationId — that would break cron/backfill paths with no
 * request context.
 *
 * Rethrows DB errors so callers that `.catch()` errors continue to function.
 */
export async function insertAuditRow(values: AuditRowValues): Promise<void> {
  if (values.correlationId == null) {
    logger.warn(
      {
        action: values.action,
        entityId: values.entityId,
        entityType: values.entityType,
      },
      "audit_log row written without correlation_id — context propagation gap",
    );
  }

  await db.insert(auditLog).values(values);
}
