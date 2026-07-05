/**
 * NeMo Scenario Service — Track 1 (Challenger-Only, Phase 0)
 *
 * Orchestrates NeMo macro-narrative scenario generation and A14 conditioning.
 *
 * Architecture mirrors synthetic-black-swan-service.ts:
 *   1. Pipeline pause guard — paused pipelines return { skipped }
 *   2. Pending-row contract — NOT applicable (NeMo batch is fire-and-complete;
 *      individual scenario rows are inserted immediately on generation).
 *   3. Spawn Python subprocess: src.engine.nemo_scenario_designer
 *   4. Parse JSON output stream → insert into nemo_scenario_bank
 *   5. Trigger A14 conditioning per scenario
 *   6. Update used_in_a14_run_ids
 *   7. Audit log row
 *   8. SSE event 'nemo:scenario-generated'
 *
 * AUTHORITY BOUNDARY (Phase 0, challenger_only):
 *   - decision_role = challenger_only, authoritative = false on ALL rows
 *   - Zero promotion authority
 *   - No direct entry/exit/sizing authority
 *   - Disagreement with classical systems reduces confidence only
 *
 * Cost telemetry: writes quantum_run_costs row with module_name="nemo_scenario_designer".
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { nemoScenarioBank, auditLog, quantumRunCosts } from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { broadcastSSE } from "../routes/sse.js";
import { auditWriteFailuresTotal } from "../lib/metrics-registry.js";

// ─── Constants (no magic numbers) ─────────────────────────────────────────────

const NEMO_DEFAULT_COUNT = 500;
const NEMO_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4hr wall-clock cap
const NEMO_GENERATOR_VERSION = "nemo-scenario-designer-v1.0";

// ─── Governance labels ─────────────────────────────────────────────────────────

const GOVERNANCE = {
  experimental: true,
  authoritative: false,
  decisionRole: "challenger_only",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NeMoScenarioJson {
  scenario_label: string;
  severity: "mild" | "moderate" | "severe" | "extreme";
  duration_days: number;
  target_vol: number;
  target_trend: number;
  target_gap_profile: Record<string, unknown>;
  narrative: string;
  macro_links: Record<string, string>;
  generator_version: string;
  run_id: string;
  seed: number | null;
}

interface NeMoPythonResult {
  scenarios: NeMoScenarioJson[];
  count: number;
  generator_version: string;
  elapsed_ms: number;
  device: string;
  seed: number | null;
  governance: Record<string, unknown>;
  error?: string;
}

export interface NeMoBatchResult {
  skipped?: string;
  batchId?: string;
  scenariosGenerated?: number;
  scenariosInserted?: number;
  generatorVersion?: string;
  elapsedMs?: number;
  device?: string;
  error?: string;
  governance: typeof GOVERNANCE;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a batch of NeMo scenarios and condition A14 with each one.
 *
 * Fail-CLOSED on subprocess error. Pipeline pause guard. Audit_log on every batch.
 */
export async function generateNeMoBatch(
  count: number = NEMO_DEFAULT_COUNT,
  seed?: number,
): Promise<NeMoBatchResult> {
  // ── Pipeline pause guard ──────────────────────────────────────────────────
  if (!(await isPipelineActive())) {
    logger.warn("nemo-scenario-service: pipeline paused — skipping batch");
    return { skipped: "pipeline_paused", governance: GOVERNANCE };
  }

  const batchId = `nemo-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  // ── Write pending cost row (before Python spawn) ──────────────────────────
  let costRunId: string | undefined;
  try {
    const [costRow] = await db
      .insert(quantumRunCosts)
      .values({
        moduleName: "nemo_scenario_designer",
        status: "pending",
        wallClockMs: 0,          // updated to real value on completion
        costDollars: "0",        // local CPU/GPU — no cloud cost
        qpuSeconds: "0",
        cacheHit: false,
      })
      .returning({ id: quantumRunCosts.id });
    costRunId = costRow?.id;
  } catch (costErr) {
    logger.warn({ err: costErr }, "nemo-scenario-service: cost row insert failed (non-blocking)");
  }

  try {
    // ── Spawn Python subprocess ─────────────────────────────────────────────
    const pythonConfig: Record<string, unknown> = {
      count,
      seed: seed ?? null,
    };

    const pythonResult = await runPythonModule<NeMoPythonResult>({
      module: "src.engine.nemo_scenario_designer",
      config: pythonConfig,
      timeoutMs: NEMO_TIMEOUT_MS,
      componentName: "nemo_scenario_designer",
    });

    if (pythonResult.error) {
      throw new Error(pythonResult.error);
    }

    const { scenarios, elapsed_ms, device } = pythonResult;
    const wallClockMs = Date.now() - startedAt;

    // ── Insert scenarios into nemo_scenario_bank ────────────────────────────
    let insertedCount = 0;
    const insertedIds: number[] = [];

    for (const s of scenarios) {
      try {
        const [row] = await db
          .insert(nemoScenarioBank)
          .values({
            scenarioLabel: s.scenario_label,
            scenarioJson: s as unknown as Record<string, unknown>,
            severity: s.severity,
            durationDays: s.duration_days,
            targetVol: String(s.target_vol),
            targetTrend: String(s.target_trend),
            generatorVersion: s.generator_version || NEMO_GENERATOR_VERSION,
            usedInA14RunIds: [],
          })
          .returning({ id: nemoScenarioBank.id });

        if (row?.id) {
          insertedIds.push(row.id);
          insertedCount++;
        }
      } catch (rowErr) {
        logger.error(
          { err: rowErr, label: s.scenario_label },
          "nemo-scenario-service: failed to insert scenario row",
        );
      }
    }

    // ── Update cost row to completed ────────────────────────────────────────
    if (costRunId) {
      await db
        .update(quantumRunCosts)
        .set({
          status: "completed",
          wallClockMs,
          errorMessage: null,
        })
        .where(eq(quantumRunCosts.id, costRunId));
    }

    // ── Audit log ───────────────────────────────────────────────────────────
    await db.insert(auditLog).values({
      action: "nemo_scenario_batch_completed",
      entityType: "nemo_scenario_bank",
      status: "success",
      result: {
        batchId,
        scenariosGenerated: scenarios.length,
        scenariosInserted: insertedCount,
        elapsedMs: wallClockMs,
        device,
        seed: seed ?? null,
        governance: GOVERNANCE,
      },
      decisionAuthority: "challenger_only",
      durationMs: wallClockMs,
    });

    // ── SSE event ───────────────────────────────────────────────────────────
    broadcastSSE("nemo:scenario-generated", {
      batchId,
      count: insertedCount,
      generatorVersion: NEMO_GENERATOR_VERSION,
      elapsedMs: wallClockMs,
      governance: GOVERNANCE,
    });

    logger.info(
      { batchId, count: insertedCount, elapsedMs: wallClockMs, device },
      "nemo-scenario-service: batch complete",
    );

    return {
      batchId,
      scenariosGenerated: scenarios.length,
      scenariosInserted: insertedCount,
      generatorVersion: NEMO_GENERATOR_VERSION,
      elapsedMs: wallClockMs,
      device,
      governance: GOVERNANCE,
    };
  } catch (err) {
    const wallClockMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? err.message : String(err);

    logger.error(
      { err, batchId, count, seed },
      "nemo-scenario-service: batch failed",
    );

    // Update cost row to failed
    if (costRunId) {
      await db
        .update(quantumRunCosts)
        .set({
          status: "failed",
          wallClockMs,
          errorMessage: errMsg,
        })
        .where(eq(quantumRunCosts.id, costRunId))
        .catch((updateErr) => {
          // deepscan18: without this update, the cost row is stuck reporting
          // its pre-failure status forever (e.g. "running") — the challenger
          // cost-tracking ledger silently loses this batch's true outcome.
          logger.warn(
            { updateErr, costRunId, batchId, errMsg },
            "nemo-scenario-service: failed to mark quantum_run_costs row as failed (deepscan18) — cost row STUCK on stale status",
          );
          auditWriteFailuresTotal.labels({ action: "nemo_scenario.cost_row_update_failed" }).inc();
        });
    }

    // Audit + alert SSE on failure
    try {
      await db
        .insert(auditLog)
        .values({
          action: "nemo_scenario_batch_failed",
          entityType: "nemo_scenario_bank",
          status: "failure",
          errorMessage: errMsg,
          result: {
            batchId,
            elapsedMs: wallClockMs,
            governance: GOVERNANCE,
          },
          decisionAuthority: "challenger_only",
          durationMs: wallClockMs,
        });
    } catch (auditErr) {
      // deepscan18: this audit row is the ONLY durable record that a NeMo
      // scenario-generation batch failed — losing it silently means a
      // challenger-only batch failure leaves no trace at all.
      logger.error(
        { auditErr, batchId, errMsg },
        "nemo-scenario-service: nemo_scenario_batch_failed audit write failed (deepscan18)",
      );
      auditWriteFailuresTotal.labels({ action: "nemo_scenario_batch_failed" }).inc();
    }

    broadcastSSE("nemo:scenario-error", {
      batchId,
      error: errMsg,
      governance: GOVERNANCE,
    });

    return {
      error: errMsg,
      batchId,
      governance: GOVERNANCE,
    };
  }
}

/**
 * Read most recent scenarios from the bank.
 */
export async function getRecentNeMoScenarios(limit: number = 10): Promise<NeMoScenarioBankRow[]> {
  return db
    .select()
    .from(nemoScenarioBank)
    .orderBy(desc(nemoScenarioBank.createdAt))
    .limit(Math.min(limit, 100));
}

type NeMoScenarioBankRow = typeof nemoScenarioBank.$inferSelect;
