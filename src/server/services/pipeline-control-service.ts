/**
 * Pipeline Control Service — manages pipeline mode (ACTIVE / PAUSED / VACATION).
 *
 * Reads/writes pipeline_mode from the system_parameters table and broadcasts SSE
 * so the dashboard updates instantly.
 *
 * n8n is intentionally always-on. Pipeline mode gates Trading Forge execution
 * authority, lifecycle promotion, scheduler jobs, paper execution, and deployment
 * prep. It must not deactivate n8n workflow intake or OpenClaw monitoring.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { systemParameters, auditLog } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";

export type PipelineMode = "ACTIVE" | "PAUSED" | "VACATION";
export type N8nPipelineControlStatus = {
  action: "left_running";
  status: "always_on";
  succeeded: number;
  failed: number;
  errors: Array<{ workflowId: string; error: string }>;
  note: string;
};

const VALID_MODES: PipelineMode[] = ["ACTIVE", "PAUSED", "VACATION"];
const PARAM_NAME = "pipeline_mode";

// system_parameters.current_value is numeric (per migration 0045 + schema.ts).
// Encode mode as integer: 0=PAUSED, 1=ACTIVE, 2=VACATION (per 0045 comment).
const MODE_TO_NUMERIC: Record<PipelineMode, string> = {
  PAUSED: "0",
  ACTIVE: "1",
  VACATION: "2",
};
const NUMERIC_TO_MODE: Record<string, PipelineMode> = {
  "0": "PAUSED",
  "1": "ACTIVE",
  "2": "VACATION",
};

// ─── In-memory cache (10s TTL) ────────────────────────────────
// Hot-path guards (paper signal evaluation, openPosition) call isActive()
// per-bar / per-order. A 10s TTL keeps the DB load bounded while remaining
// responsive to mode changes (any setMode() call invalidates the cache).
const CACHE_TTL_MS = 10_000;
let cachedMode: PipelineMode | null = null;
let cachedAt = 0;

function invalidateCache(): void {
  cachedMode = null;
  cachedAt = 0;
}

function isCacheFresh(): boolean {
  return cachedMode !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

function keepN8nAlwaysOn(): N8nPipelineControlStatus {
  return {
    action: "left_running",
    status: "always_on",
    succeeded: 0,
    failed: 0,
    errors: [],
    note: "n8n remains active in every pipeline mode; Trading Forge mode gates engine authority only.",
  };
}

export async function getMode(): Promise<PipelineMode> {
  if (isCacheFresh()) return cachedMode!;

  const [row] = await db
    .select({ currentValue: systemParameters.currentValue })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, PARAM_NAME));

  let val: PipelineMode = "ACTIVE";
  if (row && row.currentValue != null) {
    const numericKey = String(row.currentValue);
    val = NUMERIC_TO_MODE[numericKey] ?? "ACTIVE";
  }
  cachedMode = val;
  cachedAt = Date.now();
  return val;
}

export async function isActive(): Promise<boolean> {
  return (await getMode()) === "ACTIVE";
}

export async function setMode(
  mode: PipelineMode,
  reason: string,
): Promise<{
  previousMode: PipelineMode;
  newMode: PipelineMode;
  n8n: N8nPipelineControlStatus;
}> {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid pipeline mode: ${mode}. Valid: ${VALID_MODES.join(", ")}`);
  }

  const previousMode = await getMode();
  const [existing] = await db
    .select({ id: systemParameters.id })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, PARAM_NAME));

  const numericValue = MODE_TO_NUMERIC[mode];
  if (existing) {
    await db
      .update(systemParameters)
      .set({ currentValue: numericValue, updatedAt: new Date() })
      .where(eq(systemParameters.paramName, PARAM_NAME));
  } else {
    await db.insert(systemParameters).values({
      paramName: PARAM_NAME,
      currentValue: numericValue,
      domain: "scheduler",
      description: "Pipeline execution mode: 0=PAUSED, 1=ACTIVE, 2=VACATION",
    });
  }

  // Invalidate cache immediately so hot-path guards see the new mode
  // on their next call (no 10s lag for pause/resume).
  invalidateCache();

  // G4.1: pause/resume reconciliation hook (default off). When enabled,
  // pausing snapshots in-flight positions; resuming audit-logs any positions
  // that survived the pause for operator review. Auto-flatten of stale
  // positions is a follow-up — this scaffolding gives observability now.
  if (process.env.PAUSE_SNAPSHOT_ENABLED === "true") {
    runPauseResumeReconciliation(previousMode, mode, reason).catch((err) => {
      logger.error({ err, previousMode, newMode: mode }, "pause/resume reconciliation failed (non-blocking)");
    });
  }

  const n8nResult = keepN8nAlwaysOn();

  logger.info(
    { previousMode, newMode: mode, reason, n8n: n8nResult },
    `Pipeline mode changed: ${previousMode} -> ${mode}; n8n left running`,
  );

  await db.insert(auditLog).values({
    action: "pipeline.mode_change",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human",
    input: { previousMode, newMode: mode, reason } as Record<string, unknown>,
    result: { n8n: n8nResult } as unknown as Record<string, unknown>,
    status: n8nResult.failed === 0 ? "success" : "partial",
  });

  broadcastSSE("pipeline:mode-change", {
    previousMode,
    newMode: mode,
    reason,
    timestamp: new Date().toISOString(),
  });

  return { previousMode, newMode: mode, n8n: n8nResult };
}

/**
 * G4.1 — Pause/resume reconciliation. Called from setMode() under the
 * PAUSE_SNAPSHOT_ENABLED feature flag. On PAUSE-out: snapshot open positions
 * to audit log. On PAUSE-in: emit a "stale-positions-after-resume" SSE event
 * so operators can review.
 *
 * Behavior is deliberately conservative (audit + SSE only). A future revision
 * can add automatic flatten of positions whose mark moved > N ATR while paused.
 */
async function runPauseResumeReconciliation(
  previousMode: PipelineMode,
  newMode: PipelineMode,
  reason: string,
): Promise<void> {
  const goingPaused = previousMode === "ACTIVE" && newMode !== "ACTIVE";
  const resuming = previousMode !== "ACTIVE" && newMode === "ACTIVE";
  if (!goingPaused && !resuming) return;

  const { paperPositions } = await import("../db/schema.js");
  const { isNull } = await import("drizzle-orm");

  const openPositions = await db
    .select({
      id: paperPositions.id,
      sessionId: paperPositions.sessionId,
      symbol: paperPositions.symbol,
      side: paperPositions.side,
      entryPrice: paperPositions.entryPrice,
      contracts: paperPositions.contracts,
      openedAt: paperPositions.entryTime,
    })
    .from(paperPositions)
    .where(isNull(paperPositions.closedAt));

  if (openPositions.length === 0) {
    logger.info({ previousMode, newMode }, "pause/resume: no open positions to reconcile");
    return;
  }

  if (goingPaused) {
    await db.insert(auditLog).values({
      action: "pipeline.pause_snapshot",
      entityType: "system",
      entityId: null,
      decisionAuthority: "system",
      input: { previousMode, newMode, reason } as Record<string, unknown>,
      result: {
        snapshot_count: openPositions.length,
        positions: openPositions as unknown as Record<string, unknown>[],
      } as unknown as Record<string, unknown>,
      status: "success",
    });
    broadcastSSE("pipeline:pause_snapshot", {
      count: openPositions.length,
      positions: openPositions.map((p) => ({ id: p.id, symbol: p.symbol, side: p.side })),
    });
    logger.info({ count: openPositions.length }, "pause/resume: snapshot captured for paused positions");
  } else {
    // Resume — flag any position older than 5 min as stale (cheap proxy until
    // ATR-based mark drift logic lands).
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stale = openPositions.filter((p) => p.openedAt && p.openedAt < staleCutoff);
    if (stale.length > 0) {
      await db.insert(auditLog).values({
        action: "pipeline.resume_stale_positions",
        entityType: "system",
        entityId: null,
        decisionAuthority: "system",
        input: { previousMode, newMode, reason } as Record<string, unknown>,
        result: {
          stale_count: stale.length,
          positions: stale as unknown as Record<string, unknown>[],
        } as unknown as Record<string, unknown>,
        status: "success",
      });
      broadcastSSE("pipeline:resume_stale_positions", {
        count: stale.length,
        positions: stale.map((p) => ({ id: p.id, symbol: p.symbol, side: p.side })),
        message: "Operator review recommended — positions survived pause",
      });
      logger.warn({ count: stale.length }, "pause/resume: stale positions flagged after resume");
    }
  }
}
