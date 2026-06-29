/**
 * admin-workflow-backup.ts — Deep-scan #4 backend-DR (2026-06-29)
 *
 * Durable sink for the n8n `3A-workflow-backup` workflow. The 3A workflow used to
 * SSE-broadcast "Backup Complete" while persisting NOTHING (the audit found it stored
 * only {id,name,active,nodeCount} to its own output). Railway n8n is ephemeral sqlite
 * with no attached volume — a wipe loses all 32 workflows (the Wave-9 incident wiped 29).
 *
 * 3A now POSTs the FULL workflow node graph (the "Fetch Workflow Detail" output) here;
 * this route writes it to the `workflow_backups` table (migration 0184). content_hash
 * dedups identical consecutive backups so the table holds a history of DISTINCT versions,
 * not one row per nightly tick.
 *
 * Auth: optional shared-secret header `X-Workflow-Backup-Secret` checked against
 * WORKFLOW_BACKUP_SECRET when that env var is set (mirrors the LIQUIDITY_MAP_BATCH_SECRET
 * pattern on the naked-pocs-batch endpoint). When unset, the endpoint is open (internal /
 * tower-only network) so the backup path never silently fails on a missing secret.
 *
 * Route: POST /api/admin/workflow-backup
 *   Body: { id, name?, active?, nodes?, connections?, settings?, ... } (full workflow JSON)
 *   200 { persisted:false, unchanged:true, backupId } when identical to latest backup
 *   201 { persisted:true, backupId, contentHash }      when new / changed
 *   400 on missing workflow id
 *   401 on bad secret (only when WORKFLOW_BACKUP_SECRET set)
 */
import { Router } from "express";
import { createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { workflowBackups, auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export const adminWorkflowBackupRoutes = Router();

/** Stable SHA-256 over the workflow node graph (sorted-key JSON) for dedup. */
function computeContentHash(body: Record<string, unknown>): string {
  // Canonical-sort so key ordering from n8n doesn't produce spurious new versions.
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// Exported for direct unit testing (repo's supertest-free convention).
export async function handleWorkflowBackup(
  req: { body?: unknown; header: (name: string) => string | undefined },
  res: { status: (c: number) => { json: (b: unknown) => unknown } },
): Promise<unknown> {
  // Optional shared-secret gate — only enforced when configured.
  const expectedSecret = process.env.WORKFLOW_BACKUP_SECRET;
  if (expectedSecret) {
    const provided = req.header("X-Workflow-Backup-Secret");
    if (provided !== expectedSecret) {
      return res.status(401).json({ error: "invalid_workflow_backup_secret" });
    }
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const workflowId =
    typeof body.id === "string" ? body.id
    : typeof body.workflowId === "string" ? (body.workflowId as string)
    : null;

  if (!workflowId) {
    return res.status(400).json({ error: "missing_workflow_id" });
  }

  const workflowName = typeof body.name === "string" ? body.name : null;
  const active = typeof body.active === "boolean" ? body.active : null;
  const nodeCount = Array.isArray(body.nodes) ? body.nodes.length : null;
  const contentHash = computeContentHash(body);

  try {
    // Dedup: skip-insert when the most recent backup for this workflow is identical.
    const [latest] = await db
      .select({ id: workflowBackups.id, contentHash: workflowBackups.contentHash })
      .from(workflowBackups)
      .where(eq(workflowBackups.workflowId, workflowId))
      .orderBy(desc(workflowBackups.createdAt))
      .limit(1);

    if (latest && latest.contentHash === contentHash) {
      logger.debug({ workflowId, contentHash }, "workflow-backup: unchanged — skip-insert");
      return res.status(200).json({ persisted: false, unchanged: true, backupId: latest.id });
    }

    const [row] = await db
      .insert(workflowBackups)
      .values({
        workflowId,
        workflowName,
        active,
        nodeCount,
        fullJson: body,
        contentHash,
        source: typeof body.source === "string" ? (body.source as string) : "n8n_3a_backup",
      })
      .returning({ id: workflowBackups.id });

    db.insert(auditLog)
      .values({
        action: "workflow_backup.persisted",
        entityType: "workflow",
        entityId: null,
        decisionAuthority: "system",
        status: "success",
        input: { workflowId, workflowName, nodeCount } as Record<string, unknown>,
        result: { backupId: row.id, contentHash } as Record<string, unknown>,
      })
      .catch((err) => logger.warn({ err }, "workflow_backup.persisted audit write failed"));

    logger.info({ workflowId, workflowName, nodeCount, backupId: row.id }, "workflow-backup: persisted");
    return res.status(201).json({ persisted: true, backupId: row.id, contentHash });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, workflowId }, "workflow-backup: persist failed");
    db.insert(auditLog)
      .values({
        action: "workflow_backup.failed",
        entityType: "workflow",
        entityId: null,
        decisionAuthority: "system",
        status: "failure",
        input: { workflowId } as Record<string, unknown>,
        result: { error: errMsg } as Record<string, unknown>,
      })
      .catch(() => {});
    return res.status(500).json({ error: "workflow_backup_persist_failed", message: errMsg });
  }
}

adminWorkflowBackupRoutes.post("/workflow-backup", (req, res) => {
  void handleWorkflowBackup(req, res);
});
