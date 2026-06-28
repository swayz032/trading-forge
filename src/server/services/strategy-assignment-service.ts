/**
 * Strategy Assignment Service — Track 5 (Pass 2)
 *
 * Assigns DEPLOYED strategies to broker accounts (operator's own + family members).
 * Provides the data backbone for:
 *   - Operator dashboard (StrategyAssignmentMatrix)
 *   - Family publish-to-family gate
 *   - Track 6 per-recipient Pine export (getActiveAssignment API)
 *
 * MFFU collaborative-trading detection:
 *   When 2+ family member accounts are about to run the same strategy on the same
 *   MFFU firm, we emit a compliance:collaborative_trading_warning SSE event and write
 *   an audit_log row (severity=warning). Assignment is NOT blocked — the warning gives
 *   the operator a chance to cancel and re-assign a different strategy.
 *
 *   Topstep multi-account exception: Topstep 2026 rules explicitly allow the same user
 *   to run the same strategy across multiple accounts. The warning does NOT fire for
 *   accounts whose firm_id='topstep'.
 *
 * Pipeline-pause guard: all write operations (assign, unassign, releaseToFamily) check
 * isPipelineActive() and reject with a 423-equivalent error when paused.
 *
 * Audit_log: every assignment / release / collision writes one audit row.
 */

import { db } from "../db/index.js";
import { accountStrategyAssignments, auditLog, strategies, brokerAccounts, instanceConfig } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignmentRecord {
  id: number;
  accountId: string;
  strategyId: string;
  status: "active" | "paused" | "archived";
  releasedToFamily: boolean;
  familyMemberLabel: string | null;
  assignedAt: Date;
  assignedBy: string;
}

export interface AssignStrategyOptions {
  /** 'operator' | 'system' | email or free-form label */
  assignedBy?: string;
  /** Label for family member (e.g. "Alice") — null for operator's own account */
  familyMemberLabel?: string | null;
  /**
   * Caller-supplied correlation ID propagated from the UI request or upstream
   * workflow. Written to all audit_log rows so the full
   * assign → Pine-export → order-route chain is queryable by a single ID.
   */
  correlationId?: string | null;
}

export interface CollaborativeTradingWarning {
  strategyId: string;
  firmId: string;
  affectedAccountIds: string[];
  familyMemberLabels: string[];
  rule: "mffu_no_collaborative_trading";
}

// ─── Pipeline-pause guard ─────────────────────────────────────────────────────

class PipelinePausedError extends Error {
  readonly statusCode = 423;
  constructor() {
    super("Pipeline is paused — strategy assignment writes are blocked");
    this.name = "PipelinePausedError";
  }
}

async function requirePipelineActive(): Promise<void> {
  const active = await isPipelineActive();
  if (!active) throw new PipelinePausedError();
}

export { PipelinePausedError };

// ─── instance_config.enabled_firms reader (60s cache) ────────────────────────
//
// The firm allowlist is per-instance config, not hardcoded. Reads from
// `instance_config` (singleton row, id=1). Defaults to ["topstep","mffu"] if
// the row is missing (boot-time fallback). Result cached for 60s to avoid
// hammering the DB on every assignment write.
//
// Mirrors the cache pattern used in compliance-gate-service.ts.

// Topstep is PRIMARY (operator mandate) — listed first so any ordered/pick-first
// consumer favors Topstep. Matches broker-router.ts ENABLED_FIRMS_FALLBACK.
// (2026-06-28: flipped from ["mffu","topstep"] — operator has no MFFU account;
// MFFU is a secondary/future option, never the default primary.)
const DEFAULT_ENABLED_FIRMS = ["topstep", "mffu"] as const;

let enabledFirmsCache: { value: string[]; expiresAt: number } | null = null;
const ENABLED_FIRMS_TTL_MS = 60_000;

/**
 * Returns the currently-enabled firms for this Trading Forge instance.
 * Cached for 60s. Callers should treat the array as read-only.
 *
 * Test helpers reset the cache via `__resetEnabledFirmsCache()` (exported).
 */
export async function getEnabledFirms(): Promise<string[]> {
  const now = Date.now();
  if (enabledFirmsCache && enabledFirmsCache.expiresAt > now) {
    return enabledFirmsCache.value;
  }

  let value: string[] = [...DEFAULT_ENABLED_FIRMS];
  try {
    const [row] = await db
      .select({ enabledFirms: instanceConfig.enabledFirms })
      .from(instanceConfig)
      .where(eq(instanceConfig.id, 1))
      .limit(1);
    if (row && Array.isArray(row.enabledFirms) && row.enabledFirms.length > 0) {
      value = (row.enabledFirms as unknown[])
        .filter((v): v is string => typeof v === "string");
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "strategy-assignment: instance_config read failed; using default enabled_firms",
    );
    // fall through with DEFAULT_ENABLED_FIRMS
  }

  enabledFirmsCache = { value, expiresAt: now + ENABLED_FIRMS_TTL_MS };
  return value;
}

/** Test-only: reset the 60s cache. Safe in production (no-op outside tests). */
export function __resetEnabledFirmsCache(): void {
  enabledFirmsCache = null;
}

// ─── Collaborative-trading detection ─────────────────────────────────────────

/**
 * Checks if assigning this strategy to this account would create an MFFU
 * collaborative-trading situation. Returns a warning object if so, null otherwise.
 *
 * Rules:
 *   - Fire when: firm_id = 'mffu' AND 2+ accounts (that are NOT the operator's own
 *     operator account) would run the same strategy simultaneously.
 *   - Topstep exception: firm_id = 'topstep' → never warn (multi-account same-strategy
 *     is explicitly allowed per Topstep 2026 rules).
 *   - "Family member" detection: account rows with family_member_label IS NOT NULL
 *     are family members. The operator's own account has no family_member_label.
 */
async function detectCollaborativeTradingRisk(
  strategyId: string,
  newAccountId: string,
  newFirmId: string,
  newFamilyLabel: string | null,
): Promise<CollaborativeTradingWarning | null> {
  // Topstep: multi-account same-strategy within one user is ALLOWED
  if (newFirmId === "topstep") return null;

  // Only MFFU has the collaborative-trading ban for now
  if (newFirmId !== "mffu") return null;

  // Query existing active assignments for this strategy on MFFU accounts
  const existingAssignments = await db
    .select({
      accountId: accountStrategyAssignments.accountId,
      familyMemberLabel: accountStrategyAssignments.familyMemberLabel,
      firmId: brokerAccounts.firmId,
    })
    .from(accountStrategyAssignments)
    .innerJoin(brokerAccounts, eq(accountStrategyAssignments.accountId, brokerAccounts.accountId))
    .where(
      and(
        eq(accountStrategyAssignments.strategyId, strategyId),
        eq(accountStrategyAssignments.status, "active"),
        eq(brokerAccounts.firmId, "mffu"),
      ),
    );

  if (existingAssignments.length === 0) return null;

  // Collect family-member accounts (accounts with a label, or any account if
  // the new account also has a label — operator's own account has null label)
  const allAccounts = [
    ...existingAssignments,
    { accountId: newAccountId, familyMemberLabel: newFamilyLabel, firmId: newFirmId },
  ];

  // Warning fires when 2+ family-member accounts are running the same strategy
  // on MFFU simultaneously. "Family member" = has a familyMemberLabel.
  const familyAccounts = allAccounts.filter((a) => a.familyMemberLabel !== null);
  if (familyAccounts.length < 2) return null;

  return {
    strategyId,
    firmId: "mffu",
    affectedAccountIds: familyAccounts.map((a) => a.accountId),
    familyMemberLabels: familyAccounts
      .map((a) => a.familyMemberLabel)
      .filter((l): l is string => l !== null),
    rule: "mffu_no_collaborative_trading",
  };
}

// ─── Core CRUD operations ─────────────────────────────────────────────────────

/**
 * Assign a DEPLOYED strategy to a broker account.
 *
 * Returns the new or existing assignment record (UNIQUE constraint means a
 * re-assignment of the same (account_id, strategy_id) pair returns the
 * existing row rather than inserting a duplicate — 409-equivalent).
 *
 * Fires SSE: strategy:assigned
 * Fires SSE: compliance:collaborative_trading_warning (if applicable)
 * Writes audit_log row on success.
 */
export async function assignStrategyToAccount(
  accountId: string,
  strategyId: string,
  options: AssignStrategyOptions = {},
): Promise<AssignmentRecord> {
  await requirePipelineActive();

  const assignedBy = options.assignedBy ?? "operator";
  const familyMemberLabel = options.familyMemberLabel ?? null;
  const correlationId = options.correlationId ?? null;

  // Verify the strategy is DEPLOYED (only DEPLOYED strategies can be assigned)
  const [strategy] = await db
    .select({ id: strategies.id, lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }
  // Cannot assign archived strategies
  if (strategy.lifecycleState === "RETIRED" || strategy.lifecycleState === "GRAVEYARD") {
    throw new Error(
      `Strategy ${strategyId} is in state ${strategy.lifecycleState} — archived/retired strategies cannot be assigned`,
    );
  }
  if (strategy.lifecycleState !== "DEPLOYED") {
    throw new Error(
      `Strategy ${strategyId} is in state ${strategy.lifecycleState} — only DEPLOYED strategies can be assigned`,
    );
  }

  // Verify the account exists and get firm_id for collaborative-trading check
  const [account] = await db
    .select({ accountId: brokerAccounts.accountId, firmId: brokerAccounts.firmId, enabled: brokerAccounts.enabled })
    .from(brokerAccounts)
    .where(eq(brokerAccounts.accountId, accountId));

  if (!account) {
    throw new Error(`Broker account ${accountId} not found`);
  }
  if (!account.enabled) {
    throw new Error(`Broker account ${accountId} is disabled`);
  }

  // Per-instance firm scope: read instance_config.enabled_firms (Pass 2.1).
  // Default ["mffu","topstep"] if instance_config row is missing.
  const enabledFirms = await getEnabledFirms();
  if (!enabledFirms.includes(account.firmId)) {
    throw new Error(
      `Broker account ${accountId} belongs to firm '${account.firmId}' which is not in instance_config.enabled_firms (${enabledFirms.join(", ")})`,
    );
  }

  // Check for UNIQUE constraint collision (idempotent assign)
  const [existing] = await db
    .select()
    .from(accountStrategyAssignments)
    .where(
      and(
        eq(accountStrategyAssignments.accountId, accountId),
        eq(accountStrategyAssignments.strategyId, strategyId),
      ),
    );

  if (existing) {
    // Return existing — idempotent. Broadcast collision SSE so the UI can surface it.
    logger.debug(
      { accountId, strategyId, correlationId },
      "strategy-assignment: UNIQUE collision — returning existing assignment",
    );
    broadcastSSE("strategy:assignment_collision", {
      accountId,
      strategyId,
      existingAssignmentId: existing.id,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    // Audit row for collision — required for state-transition observability
    await db.insert(auditLog).values({
      action: "strategy_assignment.collision",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "system",
      input: { accountId, strategyId, assignedBy, familyMemberLabel } as Record<string, unknown>,
      result: { existingAssignmentId: existing.id, note: "idempotent — returned existing" } as Record<string, unknown>,
      status: "success",
      correlationId,
    }).catch((err) => {
      logger.warn({ err, accountId, strategyId }, "strategy-assignment: collision audit log write failed (non-blocking)");
    });
    return rowToRecord(existing);
  }

  // Collaborative-trading check BEFORE insert
  const warning = await detectCollaborativeTradingRisk(
    strategyId,
    accountId,
    account.firmId,
    familyMemberLabel,
  );

  if (warning) {
    logger.warn(
      { warning },
      "strategy-assignment: MFFU collaborative-trading warning — assigning anyway but surfacing compliance event",
    );

    broadcastSSE("compliance:collaborative_trading_warning", {
      strategyId: warning.strategyId,
      firmId: warning.firmId,
      affectedAccountIds: warning.affectedAccountIds,
      familyMemberLabels: warning.familyMemberLabels,
      rule: warning.rule,
      timestamp: new Date().toISOString(),
    });

    // Discord alert — operator must be notified of MFFU collaborative-trading risk
    notifyCritical(
      "MFFU Collaborative-Trading Warning",
      appendFamilyGradePostscript(
        `Strategy ${strategyId} is being assigned to account ${accountId} on MFFU. ` +
          `2+ family members running the same strategy on MFFU risks collaborative-trading detection. ` +
          `Affected accounts: ${warning.affectedAccountIds.join(", ")}. Labels: ${warning.familyMemberLabels.join(", ")}.`,
        "A trading strategy couldn't be assigned to an account.",
        "No action needed — the bot will retry. Call Tony if trading doesn't start within an hour.",
      ),
      { strategyId, firmId: warning.firmId, affectedAccountIds: warning.affectedAccountIds },
    );

    await db.insert(auditLog).values({
      action: "strategy_assignment.collaborative_trading_warning",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "system",
      input: { accountId, strategyId, firmId: account.firmId, familyMemberLabel } as Record<string, unknown>,
      result: {
        severity: "warning",
        rule: warning.rule,
        affectedAccountIds: warning.affectedAccountIds,
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    });
  }

  // Insert the assignment
  const [inserted] = await db
    .insert(accountStrategyAssignments)
    .values({
      accountId,
      strategyId,
      status: "active",
      releasedToFamily: false,
      familyMemberLabel,
      assignedBy,
    })
    .returning();

  if (!inserted) {
    throw new Error("Failed to insert assignment row");
  }

  // Audit log
  await db.insert(auditLog).values({
    action: "strategy_assignment.assigned",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "system",
    input: { accountId, strategyId, familyMemberLabel, assignedBy } as Record<string, unknown>,
    result: { assignmentId: inserted.id, firmId: account.firmId } as Record<string, unknown>,
    status: "success",
    correlationId,
  });

  broadcastSSE("strategy:assigned", {
    assignmentId: inserted.id,
    accountId,
    strategyId,
    familyMemberLabel,
    firmId: account.firmId,
    correlationId,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { assignmentId: inserted.id, accountId, strategyId, firmId: account.firmId, correlationId },
    "strategy-assignment: strategy assigned to account",
  );

  return rowToRecord(inserted);
}

/**
 * Remove (archive) a strategy assignment.
 *
 * We soft-delete by setting status='archived' rather than hard-deleting
 * so audit history is preserved. Track 6 Pine export may still reference
 * the row.
 *
 * Fires SSE: strategy:unassigned
 * Writes audit_log row on success.
 */
export async function unassignStrategy(assignmentId: number): Promise<void> {
  await requirePipelineActive();

  const [existing] = await db
    .select()
    .from(accountStrategyAssignments)
    .where(eq(accountStrategyAssignments.id, assignmentId));

  if (!existing) {
    throw new Error(`Assignment ${assignmentId} not found`);
  }

  await db
    .update(accountStrategyAssignments)
    .set({ status: "archived" })
    .where(eq(accountStrategyAssignments.id, assignmentId));

  await db.insert(auditLog).values({
    action: "strategy_assignment.unassigned",
    entityType: "strategy",
    entityId: existing.strategyId,
    decisionAuthority: "system",
    input: { assignmentId, accountId: existing.accountId, strategyId: existing.strategyId } as Record<string, unknown>,
    result: { status: "archived" } as Record<string, unknown>,
    status: "success",
    correlationId: null,   // unassign is a standalone operator action; no upstream correlation
  });

  broadcastSSE("strategy:unassigned", {
    assignmentId,
    accountId: existing.accountId,
    strategyId: existing.strategyId,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { assignmentId, accountId: existing.accountId, strategyId: existing.strategyId },
    "strategy-assignment: assignment archived",
  );
}

/**
 * Toggle released_to_family for an assignment.
 *
 * When true: Track 6 can generate per-recipient Pine for this assignment.
 * When false: strategy is operator-internal only.
 *
 * Fires SSE: strategy:released_to_family or strategy:retracted_from_family
 * Writes audit_log row on success.
 */
export async function releaseStrategyToFamily(
  assignmentId: number,
  releasedToFamily: boolean,
  familyMemberLabel?: string,
): Promise<AssignmentRecord> {
  await requirePipelineActive();

  const [existing] = await db
    .select()
    .from(accountStrategyAssignments)
    .where(eq(accountStrategyAssignments.id, assignmentId));

  if (!existing) {
    throw new Error(`Assignment ${assignmentId} not found`);
  }

  // Server-side validation: family_member_label is required when releasing to family
  if (releasedToFamily) {
    const effectiveLabel = familyMemberLabel ?? existing.familyMemberLabel;
    if (!effectiveLabel || effectiveLabel.trim().length === 0) {
      throw new Error("family_member_label is required when releasing a strategy to family");
    }
  }

  const updateValues: Partial<typeof accountStrategyAssignments.$inferInsert> = {
    releasedToFamily,
  };
  if (familyMemberLabel !== undefined) {
    updateValues.familyMemberLabel = familyMemberLabel;
  }

  const [updated] = await db
    .update(accountStrategyAssignments)
    .set(updateValues)
    .where(eq(accountStrategyAssignments.id, assignmentId))
    .returning();

  if (!updated) {
    throw new Error("Failed to update assignment");
  }

  const eventName = releasedToFamily ? "strategy:released_to_family" : "strategy:retracted_from_family";

  await db.insert(auditLog).values({
    action: `strategy_assignment.${releasedToFamily ? "released_to_family" : "retracted_from_family"}`,
    entityType: "strategy",
    entityId: existing.strategyId,
    decisionAuthority: "system",
    input: {
      assignmentId,
      accountId: existing.accountId,
      strategyId: existing.strategyId,
      releasedToFamily,
      familyMemberLabel: updated.familyMemberLabel,
    } as Record<string, unknown>,
    result: { success: true } as Record<string, unknown>,
    status: "success",
    correlationId: null,
  });

  broadcastSSE(eventName, {
    assignmentId,
    accountId: updated.accountId,
    strategyId: updated.strategyId,
    releasedToFamily,
    familyMemberLabel: updated.familyMemberLabel,
    timestamp: new Date().toISOString(),
  });

  logger.info(
    { assignmentId, strategyId: updated.strategyId, releasedToFamily },
    `strategy-assignment: ${eventName}`,
  );

  return rowToRecord(updated);
}

// ─── Query operations ─────────────────────────────────────────────────────────

/**
 * Get all active assignments for a specific account.
 * Used by paper-execution-service to verify an account has an assignment before
 * generating signals.
 */
export async function getActiveAssignments(accountId: string): Promise<AssignmentRecord[]> {
  const rows = await db
    .select()
    .from(accountStrategyAssignments)
    .where(
      and(
        eq(accountStrategyAssignments.accountId, accountId),
        eq(accountStrategyAssignments.status, "active"),
      ),
    );

  return rows.map(rowToRecord);
}

/**
 * Get the active assignment for a specific account (single — first active row).
 * Exposed for Track 6 per-recipient Pine export to know which strategy to export.
 *
 * Returns: { strategy_id, family_member_label, assignment_id } or null if none.
 */
export async function getActiveAssignment(
  accountId: string,
): Promise<{ strategyId: string; familyMemberLabel: string | null; assignmentId: number } | null> {
  const [row] = await db
    .select()
    .from(accountStrategyAssignments)
    .where(
      and(
        eq(accountStrategyAssignments.accountId, accountId),
        eq(accountStrategyAssignments.status, "active"),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    strategyId: row.strategyId,
    familyMemberLabel: row.familyMemberLabel,
    assignmentId: row.id,
  };
}

/**
 * Get all assignments (all accounts, all strategies) — operator full-view.
 * Used by GET /api/strategy-assignments for the StrategyAssignmentMatrix.
 */
export async function getAllAssignments(): Promise<AssignmentRecord[]> {
  const rows = await db
    .select()
    .from(accountStrategyAssignments)
    .where(eq(accountStrategyAssignments.status, "active"));

  return rows.map(rowToRecord);
}

/**
 * Get all strategies currently released to family (released_to_family=true).
 * Used by FamilyPublishedStrategiesPanel.
 */
export async function getFamilyPublishedStrategies(): Promise<AssignmentRecord[]> {
  const rows = await db
    .select()
    .from(accountStrategyAssignments)
    .where(
      and(
        eq(accountStrategyAssignments.releasedToFamily, true),
        eq(accountStrategyAssignments.status, "active"),
      ),
    );

  return rows.map(rowToRecord);
}

/**
 * Convenience wrapper: unrelease a strategy from family (toggle off).
 * Preserves family_member_label so re-releasing can reuse it.
 */
export async function unreleaseFromFamily(assignmentId: number): Promise<AssignmentRecord> {
  return releaseStrategyToFamily(assignmentId, false);
}

/**
 * Audit query helper: get assignment history for a strategy (all statuses).
 * Used by the operator dashboard for strategy-level history.
 */
export async function getAssignmentHistory(strategyId: string): Promise<AssignmentRecord[]> {
  const rows = await db
    .select()
    .from(accountStrategyAssignments)
    .where(eq(accountStrategyAssignments.strategyId, strategyId))
    .orderBy(desc(accountStrategyAssignments.assignedAt));

  return rows.map(rowToRecord);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToRecord(row: typeof accountStrategyAssignments.$inferSelect): AssignmentRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    strategyId: row.strategyId,
    status: row.status as "active" | "paused" | "archived",
    releasedToFamily: row.releasedToFamily,
    familyMemberLabel: row.familyMemberLabel,
    assignedAt: row.assignedAt,
    assignedBy: row.assignedBy,
  };
}
