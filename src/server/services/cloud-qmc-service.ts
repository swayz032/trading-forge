/**
 * Cloud QMC Service — Tier 4.5 (Gemini Quantum Blueprint, W4)
 *
 * Orchestrates the async best-effort Ising-encoded IBM QPU enrichment pipeline:
 *   encode → submit to IBM → poll → fetch syndromes → invoke Ising decoder → persist
 *
 * AUTHORITY BOUNDARY:
 *   - Output is challenger-only evidence stored in cloud_qmc_runs.
 *   - MUST NOT influence lifecycle promotion decisions.
 *   - SHADOW ONLY: enqueue is called AFTER classical promotion completes.
 *     Promotion does NOT wait for this service.
 *   - governance_labels.decision_role = "challenger_only" on all rows.
 *
 * Architecture:
 *   - enqueueCloudQmcRun(): called post-promotion, writes "queued" row,
 *     submits IBM job asynchronously. Never throws — errors are logged only.
 *   - pollPendingJobs(): called by cloud-qmc-poll scheduler cron (every 5 min).
 *     Finds queued/running rows, checks IBM job status, fetches results when done.
 *   - Budget guard: CloudBudgetTracker with 2x pessimism factor.
 *   - Backend rotation: ibm_fez → ibm_kingston → ibm_marrakesh.
 *   - isActive() guard: poll cron early-exits when pipeline is paused.
 *
 * IBM credential setup:
 *   export IBM_QUANTUM_TOKEN=<your-token>
 *   IBM token is obtained from: https://quantum.ibm.com/account
 *   Without the token, all submissions are skipped and logged.
 *   QUANTUM_CLOUD_ENABLED=true must also be set to enable IBM submissions.
 *
 * Budget:
 *   600s/month total IBM QPU budget — ALL reserved for Ising-encoded IAE runs.
 *   Pessimism factor 2x: each 60s estimated run consumes 120s of budget capacity.
 *   This allows 5 runs/month (5 × 120s = 600s budget exhausted).
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, unlinkSync } from "fs";

// FINDING #9 FIX: promisified execFile to replace spawnSync inside async path.
// spawnSync blocks the Node event loop up to 5s — freezes broker-router/kill-switch/SSE.
const execFileAsync = promisify(execFile);
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { resolve as pathResolve } from "path";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  cloudQmcRuns,
  backtests,
  strategies,
  auditLog,
} from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import {
  recordCost,
  completeCost,
  STALE_PENDING_SENTINEL_ID,
} from "../lib/quantum-cost-tracker.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// IBM Heron backend rotation order (156-qubit, operational)
const IBM_BACKENDS = ["ibm_fez", "ibm_kingston", "ibm_marrakesh"] as const;
type IbmBackend = typeof IBM_BACKENDS[number];

// 5-minute hard cap per job submission
const IBM_JOB_TIMEOUT_MS = 5 * 60 * 1000;

// Governance label enforced on all cloud_qmc_runs rows
const GOVERNANCE_LABELS = {
  experimental: true,
  authoritative: false,
  decision_role: "challenger_only",
} as const;

// Python cloud QMC runner timeout (35s: 30s submit + overhead)
const PYTHON_SUBMIT_TIMEOUT_MS = 35_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CloudQmcEnqueueInput {
  strategyId: string;
  backtestId: string;
  /** Classical Monte Carlo ruin probability (for agreement comparison) */
  classicalRuinProb?: number | null;
  /** Local IAE estimate (for agreement comparison) */
  localIaeEstimate?: number | null;
}

export interface CloudQmcRunStatus {
  runId: string;
  strategyId: string;
  backtestId: string;
  status: string;
  backendName: string;
  ibmJobId: string | null;
  isingCorrectedEstimate: number | null;
  pymatchingEstimate: number | null;
  agreementWithClassical: number | null;
  governanceLabels: typeof GOVERNANCE_LABELS;
}

export interface PollResult {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  staleSwept: number;
}

// ─── Stale queued/running job sweep ───────────────────────────────────────────
//
// fixwave (2026-07-17): pollPendingJobs() had no upper bound on how long a row
// could sit in "queued" or "running" — a row whose IBM submission failed
// silently (ibmJobId stays null; the existing comment at the skip site above
// literally says "submit failed silently?") or whose IBM job status polling
// never resolves (poll_ibm_job keeps returning "running", or throws every
// cycle) occupies one of the LIMIT-20 slots forever, crowding out fresh runs
// and giving the operator no signal that anything is stuck — it just silently
// never completes. Two thresholds, not one: a "queued" row with NO ibmJobId
// never had an async external dependency in the first place (submission is a
// synchronous step inside enqueueCloudQmcRun), so it can be swept quickly; a
// "running" row with a real ibmJobId may legitimately sit in IBM's public
// QPU queue for many hours, so it gets a much longer grace window before
// being declared stale.

/** Hours a "queued" row with no ibmJobId may sit before being swept as stale
 * (submission never even happened — nothing async to wait for). */
export const CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS = Number(
  process.env.CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS ?? "1",
);

/** Hours a "queued"/"running" row WITH an ibmJobId may sit before being swept
 * as stale — generous to cover legitimate IBM public-tier queue wait times. */
export const CLOUD_QMC_STALE_RUNNING_HOURS = Number(
  process.env.CLOUD_QMC_STALE_RUNNING_HOURS ?? "48",
);

/**
 * Pure predicate: has this queued/running cloud_qmc_runs row exceeded its
 * staleness window? No DB access — testable in isolation.
 */
export function isCloudQmcRunStale(
  row: { status: string; ibmJobId: string | null; createdAt: Date },
  now: Date = new Date(),
): boolean {
  if (row.status !== "queued" && row.status !== "running") return false;

  const ageHours = (now.getTime() - row.createdAt.getTime()) / (1000 * 60 * 60);

  if (row.status === "queued" && !row.ibmJobId) {
    return ageHours >= CLOUD_QMC_STALE_QUEUED_NO_JOB_ID_HOURS;
  }
  return ageHours >= CLOUD_QMC_STALE_RUNNING_HOURS;
}

/**
 * Sweep stale queued/running cloud_qmc_runs rows to status="failed" so they
 * stop occupying poll slots and the operator gets a visible failure signal
 * instead of silent indefinite limbo. Never throws — DB failures are logged
 * and swallowed (matches quantum-cost-tracker.ts::pruneStalePendingCosts).
 * Returns the count of rows swept.
 */
export async function sweepStaleCloudQmcRuns(): Promise<number> {
  try {
    const pendingRows = await db
      .select({
        id: cloudQmcRuns.id,
        status: cloudQmcRuns.status,
        ibmJobId: cloudQmcRuns.ibmJobId,
        createdAt: cloudQmcRuns.createdAt,
      })
      .from(cloudQmcRuns)
      .where(inArray(cloudQmcRuns.status, ["queued", "running"]));

    const now = new Date();
    const staleIds: string[] = [];
    const staleReasons = new Map<string, string>();

    for (const row of pendingRows) {
      if (!isCloudQmcRunStale(row, now)) continue;
      staleIds.push(row.id);
      staleReasons.set(
        row.id,
        row.status === "queued" && !row.ibmJobId
          ? "stale_queued_no_ibm_job_id_swept"
          : "stale_pending_swept_exceeded_staleness_window",
      );
    }

    if (staleIds.length === 0) return 0;

    // Group by error message so each distinct reason gets one UPDATE.
    const byReason = new Map<string, string[]>();
    for (const id of staleIds) {
      const reason = staleReasons.get(id)!;
      const bucket = byReason.get(reason) ?? [];
      bucket.push(id);
      byReason.set(reason, bucket);
    }

    for (const [reason, ids] of byReason) {
      await db
        .update(cloudQmcRuns)
        .set({
          status: "failed",
          completedAt: now,
          errorMessage: reason,
        })
        .where(inArray(cloudQmcRuns.id, ids));
    }

    logger.warn(
      { staleCount: staleIds.length },
      "cloud-qmc: swept stale queued/running run(s) to failed",
    );

    return staleIds.length;
  } catch (err) {
    logger.warn({ err }, "cloud-qmc: sweepStaleCloudQmcRuns failed");
    return 0;
  }
}

// ─── Python runner helper ─────────────────────────────────────────────────────

interface CloudQmcPythonResult {
  status: string;
  ibm_job_id: string | null;
  backend_name: string;
  qpu_seconds_used: number | null;
  raw_syndrome_count: number | null;
  ising_corrected_estimate: number | null;
  pymatching_estimate: number | null;
  uncorrected_estimate: number | null;
  // True only when a REAL Ising ONNX decode happened (IsingDecoderWrapper.is_ising_loaded).
  // ising_corrected_estimate is non-null even when the PyMatching identity-matrix
  // placeholder fallback ran — do not infer decode success from that field alone.
  ising_model_loaded: boolean;
  error_message: string | null;
  n_logical_qubits: number;
  n_physical_qubits: number;
  surface_code_distance: number;
  governance_labels: Record<string, unknown>;
}

function runPythonCloudQmc(
  configPath: string,
  timeoutMs: number = PYTHON_SUBMIT_TIMEOUT_MS,
): Promise<CloudQmcPythonResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.cloud_backend", "--cloud-qmc-submit", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Cloud QMC Python submit timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      logger.debug({ component: "cloud-qmc" }, d.toString().trim());
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Cloud QMC Python exited code=${code}, stderr=${stderr.slice(0, 500)}`));
        return;
      }
      try {
        // Find the last JSON object in stdout (Python may emit log lines before it)
        const jsonMatch = stdout.match(/\{[\s\S]*\}(?=[^}]*$)/);
        const raw = jsonMatch ? jsonMatch[0] : stdout.trim();
        resolve(JSON.parse(raw) as CloudQmcPythonResult);
      } catch (err) {
        reject(new Error(`Cloud QMC Python output parse failed: ${err}. stdout=${stdout.slice(0, 300)}`));
      }
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// ─── Budget guard ─────────────────────────────────────────────────────────────

/**
 * Check if the IBM QPU budget allows another Ising-encoded IAE run.
 *
 * Calls Python cloud_backend budget checker with 2x pessimism factor.
 * Returns { allowed, remainingSeconds, reason }.
 */
async function checkIbmBudget(): Promise<{
  allowed: boolean;
  reason: string;
  remainingSeconds: number;
}> {
  // QUANTUM_CLOUD_ENABLED gate
  const cloudEnabled = (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true";
  if (!cloudEnabled) {
    return {
      allowed: false,
      reason: "QUANTUM_CLOUD_ENABLED is not true — cloud submissions disabled",
      remainingSeconds: 0,
    };
  }

  // IBM token gate
  const ibmToken = process.env.IBM_QUANTUM_TOKEN ?? "";
  if (!ibmToken) {
    return {
      allowed: false,
      reason: "IBM_QUANTUM_TOKEN not set — configure token to enable IBM submissions",
      remainingSeconds: 0,
    };
  }

  // Budget check via Python (2x pessimism: estimated 60s → 120s budget consumed).
  // FINDING #9 FIX: replaced spawnSync (blocks Node event loop up to 5s) with
  // execFileAsync (awaited, non-blocking). Timeout semantics preserved (5000ms).
  let configPath: string | null = null;
  try {
    configPath = `${tmpdir()}/cloud_qmc_budget_${randomUUID()}.json`;
    writeFileSync(configPath, JSON.stringify({ action: "budget_check", estimated_seconds: 60 }));

    const pythonBin = process.platform === "win32" ? "python" : "python3";
    const inlineScript = `
import json, sys
sys.path.insert(0, '${PROJECT_ROOT.replace(/\\/g, "/")}')
from src.engine.cloud_backend import CloudBudgetTracker
t = CloudBudgetTracker()
remaining = t.get_remaining()
allowed = t.can_run_ibm(60, 600)
print(json.dumps({"allowed": allowed, "ibm_seconds_remaining": remaining["ibm_seconds_remaining"]}))
`;
    const { stdout } = await execFileAsync(pythonBin, ["-c", inlineScript], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    });

    if (configPath) { try { unlinkSync(configPath); } catch { /* non-fatal cleanup */ } configPath = null; }

    if (stdout) {
      const budgetResult = JSON.parse(stdout.trim());
      return {
        allowed: budgetResult.allowed,
        reason: budgetResult.allowed ? "budget_ok" : "budget_exhausted",
        remainingSeconds: budgetResult.ibm_seconds_remaining,
      };
    }
  } catch (err) {
    if (configPath) { try { unlinkSync(configPath); } catch { /* non-fatal cleanup */ } }
    logger.warn({ err }, "cloud-qmc: budget check failed — treating as budget_exhausted for safety");
  }

  return { allowed: false, reason: "budget_check_failed", remainingSeconds: 0 };
}

// ─── Enqueue (post-promotion fire-and-forget) ────────────────────────────────

/**
 * Enqueue an Ising-encoded IBM QPU run for a strategy that just promoted TESTING→PAPER.
 *
 * Called by lifecycle-service.ts AFTER classical promotion completes.
 * NEVER throws — errors are logged and absorbed.
 * NEVER blocks promotion — this is async, best-effort enrichment.
 *
 * Pending-row contract:
 *   1. Insert cloud_qmc_runs row with status="queued"
 *   2. Check budget — if insufficient, update to "budget_exhausted"
 *   3. Submit IBM job — if fails, update to "failed"
 *   4. Poll cron picks up "queued"/"running" rows every 5 min
 */
export async function enqueueCloudQmcRun(input: CloudQmcEnqueueInput): Promise<void> {
  const { strategyId, backtestId, classicalRuinProb, localIaeEstimate } = input;
  const correlationId = randomUUID();

  // TDZ guard: hoist cost row ID and start time outside try so catch/finally can reference them
  let cloudQmcCostRowId: string = STALE_PENDING_SENTINEL_ID;
  const enqueueStartMs = Date.now();

  try {
    // Surface code params (d=3, 5 logical qubits)
    const nLogical = 5;
    const nPhysical = nLogical * 17; // 17 physical per logical for d=3

    // 1. Insert pending row
    const [row] = await db
      .insert(cloudQmcRuns)
      .values({
        strategyId,
        backtestId,
        backendName: IBM_BACKENDS[0], // Start with ibm_fez; may be updated on submission
        surfaceCodeDistance: 3,
        nLogicalQubits: nLogical,
        nPhysicalQubits: nPhysical,
        status: "queued",
        governanceLabels: GOVERNANCE_LABELS,
      })
      .returning({ id: cloudQmcRuns.id });

    const runId = row.id;
    logger.info(
      { runId, strategyId, backtestId, correlationId },
      "cloud-qmc: enqueued run (shadow-only, post-promotion, never blocks)",
    );

    // 1a. Cost tracking — insert pending cloud_qmc cost row before IBM submission
    const costResult = await recordCost({
      moduleName: "cloud_qmc",
      backtestId,
      strategyId,
      qpuSeconds: 0,
      costDollars: 0,
      cacheHit: false,
    });
    cloudQmcCostRowId = costResult.id;

    // 2. Audit log
    await db.insert(auditLog).values({
      action: "cloud-qmc.enqueued",
      entityType: "strategy",
      entityId: strategyId,
      input: { backtestId, runId, correlationId },
      result: { status: "queued", governanceLabels: GOVERNANCE_LABELS },
      status: "pending",
      decisionAuthority: "cloud_quantum_challenger",
      correlationId,
    });

    // 3. Budget check (async — does not block the pending row being created)
    const budget = await checkIbmBudget();
    if (!budget.allowed) {
      await db
        .update(cloudQmcRuns)
        .set({ status: "budget_exhausted", errorMessage: budget.reason })
        .where(eq(cloudQmcRuns.id, runId));

      await db.insert(auditLog).values({
        action: "cloud-qmc.budget_exhausted",
        entityType: "strategy",
        entityId: strategyId,
        input: { runId, backtestId, reason: budget.reason },
        result: { remainingSeconds: budget.remainingSeconds, month: new Date().toISOString().slice(0, 7) },
        status: "completed",
        decisionAuthority: "cloud_quantum_challenger",
        correlationId,
      });

      logger.info(
        { runId, strategyId, reason: budget.reason, remainingSeconds: budget.remainingSeconds },
        "cloud-qmc: budget exhausted — row created as budget_exhausted, promotion unaffected",
      );

      // Mark cost row as failed — budget gate prevents any QPU usage
      await completeCost(cloudQmcCostRowId, {
        wallClockMs: Date.now() - enqueueStartMs,
        status: "failed",
        errorMessage: `budget_exhausted: ${budget.reason}`,
      });
      return;
    }

    // 4. Submit IBM job via Python backend (backend rotation: fez → kingston → marrakesh)
    let submitSuccess = false;
    let lastError = "";
    let selectedBackend: IbmBackend = IBM_BACKENDS[0];
    let submittedQpuSeconds: number | null = null;

    // QC-2 (deep-scan 2026-07-11): call Python ONCE. submit_surface_code_iae() already rotates through
    // ALL IBM_ISING_BACKENDS internally (cloud_backend.py:1081). The prior outer `for backend of
    // IBM_BACKENDS` loop multiplied that: 3 (TS) x 3 (Python-internal) = up to 9 real IBM API round-trips
    // for what should be a single exhaustive 3-backend attempt — tripling real cloud exposure/latency.
    {
      selectedBackend = IBM_BACKENDS[0];
      try {
        const configPath = `${tmpdir()}/cloud_qmc_submit_${randomUUID()}.json`;
        writeFileSync(
          configPath,
          JSON.stringify({
            action: "submit_surface_code_iae",
            backend_name: IBM_BACKENDS[0],
            run_id: runId,
            backtest_id: backtestId,
            strategy_id: strategyId,
            n_logical_qubits: nLogical,
            classical_ruin_prob: classicalRuinProb ?? null,
            local_iae_estimate: localIaeEstimate ?? null,
            timeout_ms: IBM_JOB_TIMEOUT_MS,
          }),
        );

        const pyResult = await runPythonCloudQmc(configPath, PYTHON_SUBMIT_TIMEOUT_MS);
        unlinkSync(configPath);

        if (pyResult.status === "submitted" || pyResult.status === "completed") {
          // Record the backend Python ACTUALLY rotated to (used_backend), not the seed — the prior
          // per-TS-loop code stamped the loop's seed backend even when Python internally fell through
          // to a different one.
          const actualBackend = (pyResult.backend_name as IbmBackend) || IBM_BACKENDS[0];
          selectedBackend = actualBackend;
          await db
            .update(cloudQmcRuns)
            .set({
              backendName: actualBackend,
              ibmJobId: pyResult.ibm_job_id,
              submittedAt: new Date(),
              status: pyResult.ibm_job_id ? "running" : "failed",
              errorMessage: pyResult.error_message,
              nLogicalQubits: pyResult.n_logical_qubits || nLogical,
              nPhysicalQubits: pyResult.n_physical_qubits || nPhysical,
              surfaceCodeDistance: pyResult.surface_code_distance || 3,
            })
            .where(eq(cloudQmcRuns.id, runId));

          submittedQpuSeconds = pyResult.qpu_seconds_used ?? null;
          submitSuccess = true;
          logger.info(
            { runId, backend: actualBackend, ibmJobId: pyResult.ibm_job_id, strategyId },
            "cloud-qmc: IBM job submitted",
          );
        } else if (pyResult.status === "budget_exhausted") {
          await db
            .update(cloudQmcRuns)
            .set({ status: "budget_exhausted", errorMessage: pyResult.error_message })
            .where(eq(cloudQmcRuns.id, runId));

          await completeCost(cloudQmcCostRowId, {
            wallClockMs: Date.now() - enqueueStartMs,
            status: "failed",
            errorMessage: `budget_exhausted: ${pyResult.error_message ?? "unknown"}`,
          });
          return;
        } else {
          lastError = pyResult.error_message ?? `status=${pyResult.status}`;
          logger.warn({ runId, error: lastError }, "cloud-qmc: submission failed (all IBM backends exhausted internally)");
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ runId, err: lastError }, "cloud-qmc: submission error");
      }
    }

    if (!submitSuccess) {
      await db
        .update(cloudQmcRuns)
        .set({
          status: "failed",
          backendName: selectedBackend,
          errorMessage: `All backends failed: ${lastError}`,
        })
        .where(eq(cloudQmcRuns.id, runId));

      // All backends failed — mark cloud_qmc cost row as failed
      await completeCost(cloudQmcCostRowId, {
        wallClockMs: Date.now() - enqueueStartMs,
        status: "failed",
        errorMessage: `all_backends_failed: ${lastError}`,
      });

      logger.warn(
        { runId, strategyId, lastError },
        "cloud-qmc: all IBM backends failed — row marked failed, promotion unaffected",
      );
    } else {
      // IBM job submitted successfully — mark cloud_qmc cost row as completed
      // Note: qpu_seconds here is the submission-time estimate; actual QPU seconds
      // are populated by the poll completion path (ising_decoder cost row).
      await completeCost(cloudQmcCostRowId, {
        wallClockMs: Date.now() - enqueueStartMs,
        status: "completed",
        qpuSeconds: submittedQpuSeconds,
      });
    }

  } catch (outerErr) {
    // Outer catch: enqueue itself failed. Log only — NEVER propagate.
    logger.warn(
      { strategyId, backtestId, err: outerErr, correlationId },
      "cloud-qmc: enqueueCloudQmcRun failed (non-blocking — classical promotion already complete)",
    );
    // Best-effort cost row failure mark — safe because completeCost never throws
    await completeCost(cloudQmcCostRowId, {
      wallClockMs: Date.now() - enqueueStartMs,
      status: "failed",
      errorMessage: outerErr instanceof Error ? outerErr.message : String(outerErr),
    });
  }
}

// ─── Poll pending jobs (called by cloud-qmc-poll cron) ───────────────────────

/**
 * Poll pending/running IBM jobs and update cloud_qmc_runs when complete.
 *
 * Called by cloud-qmc-poll scheduler job every 5 minutes.
 * isActive() guard: early-exit when pipeline is paused.
 *
 * For each running row:
 *   1. Call Python to check IBM job status
 *   2. If complete: fetch syndrome results, run Ising decoder, persist
 *   3. Update row to "completed" or "failed"
 */
export async function pollPendingJobs(): Promise<PollResult> {
  const result: PollResult = { processed: 0, completed: 0, failed: 0, skipped: 0, staleSwept: 0 };

  // isActive() guard
  if (!(await isPipelineActive())) {
    logger.debug("cloud-qmc-poll: pipeline not ACTIVE — skipping poll");
    return result;
  }

  // QUANTUM_CLOUD_ENABLED gate
  const cloudEnabled = (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true";
  if (!cloudEnabled) {
    logger.debug("cloud-qmc-poll: QUANTUM_CLOUD_ENABLED not set — skipping poll");
    return result;
  }

  // Sweep rows stuck in queued/running past their staleness window BEFORE
  // fetching this cycle's work — a swept row won't also be re-processed
  // below (it's now "failed"), and this runs every 5-min cron cycle so no
  // separate cron registration is needed (scheduler.ts is out of scope for
  // this fix — see sweepStaleCloudQmcRuns() docstring for the failure mode).
  result.staleSwept = await sweepStaleCloudQmcRuns();

  // Find all queued and running rows
  let pendingRows: Array<{
    id: string;
    strategyId: string;
    backtestId: string;
    ibmJobId: string | null;
    backendName: string;
    status: string;
  }>;

  try {
    pendingRows = await db
      .select({
        id: cloudQmcRuns.id,
        strategyId: cloudQmcRuns.strategyId,
        backtestId: cloudQmcRuns.backtestId,
        ibmJobId: cloudQmcRuns.ibmJobId,
        backendName: cloudQmcRuns.backendName,
        status: cloudQmcRuns.status,
      })
      .from(cloudQmcRuns)
      .where(inArray(cloudQmcRuns.status, ["queued", "running"]))
      .orderBy(desc(cloudQmcRuns.createdAt))
      .limit(20); // Process at most 20 pending runs per poll cycle
  } catch (err) {
    logger.warn({ err }, "cloud-qmc-poll: could not query pending rows");
    return result;
  }

  if (pendingRows.length === 0) {
    logger.debug("cloud-qmc-poll: no pending rows");
    return result;
  }

  logger.info({ count: pendingRows.length }, "cloud-qmc-poll: processing pending rows");

  for (const row of pendingRows) {
    result.processed++;

    if (!row.ibmJobId) {
      // No IBM job ID yet — still queued (submit failed silently?) — skip
      result.skipped++;
      continue;
    }

    // TDZ guard: hoist ising_decoder cost row ID and poll start time outside inner try
    let isingCostRowId: string = STALE_PENDING_SENTINEL_ID;
    const pollRowStartMs = Date.now();

    try {
      // Call Python to check job status and fetch syndromes if complete
      const configPath = `${tmpdir()}/cloud_qmc_poll_${randomUUID()}.json`;
      writeFileSync(
        configPath,
        JSON.stringify({
          action: "poll_ibm_job",
          job_id: row.ibmJobId,
          backend_name: row.backendName,
          run_id: row.id,
        }),
      );

      const pyResult = await runPythonCloudQmc(configPath, PYTHON_SUBMIT_TIMEOUT_MS);
      unlinkSync(configPath);

      if (pyResult.status === "completed") {
        // Insert ising_decoder pending cost row before running the decoder path
        // The decode happens inside Python (pyResult already carries decoded outputs),
        // so we record the cost immediately and complete it right after.
        const isingCostResult = await recordCost({
          moduleName: "ising_decoder",
          backtestId: row.backtestId,
          strategyId: row.strategyId,
          qpuSeconds: pyResult.qpu_seconds_used ?? 0,
          costDollars: 0,
          cacheHit: false,
        });
        isingCostRowId = isingCostResult.id;

        // Compute agreement metrics
        let agreementWithClassical: number | null = null;
        let agreementWithLocalIae: number | null = null;

        const estimate = pyResult.ising_corrected_estimate;

        if (estimate != null) {
          // Fetch classical ruin prob from quantum_mc_runs for comparison
          try {
            const { quantumMcRuns } = await import("../db/schema.js");
            const { eq: drizzleEq, desc: drizzleDesc } = await import("drizzle-orm");
            const [qmcRow] = await db
              .select({ estimatedValue: quantumMcRuns.estimatedValue, classicalValue: quantumMcRuns.classicalValue })
              .from(quantumMcRuns)
              .where(drizzleEq(quantumMcRuns.backtestId, row.backtestId))
              .orderBy(drizzleDesc(quantumMcRuns.createdAt))
              .limit(1);

            if (qmcRow?.classicalValue != null) {
              const classical = parseFloat(String(qmcRow.classicalValue));
              agreementWithClassical = Math.abs(estimate - classical);
            }
            if (qmcRow?.estimatedValue != null) {
              const iae = parseFloat(String(qmcRow.estimatedValue));
              agreementWithLocalIae = Math.abs(estimate - iae);
            }
          } catch {
            // Non-fatal — skip agreement computation
          }
        }

        await db
          .update(cloudQmcRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            qpuSecondsUsed: pyResult.qpu_seconds_used != null
              ? String(pyResult.qpu_seconds_used)
              : null,
            rawSyndromeCount: pyResult.raw_syndrome_count,
            isingCorrectedEstimate: pyResult.ising_corrected_estimate != null
              ? String(pyResult.ising_corrected_estimate)
              : null,
            pymatchingEstimate: pyResult.pymatching_estimate != null
              ? String(pyResult.pymatching_estimate)
              : null,
            uncorrectedEstimate: pyResult.uncorrected_estimate != null
              ? String(pyResult.uncorrected_estimate)
              : null,
            agreementWithClassical: agreementWithClassical != null
              ? String(agreementWithClassical)
              : null,
            agreementWithLocalIae: agreementWithLocalIae != null
              ? String(agreementWithLocalIae)
              : null,
          })
          .where(eq(cloudQmcRuns.id, row.id));

        // Determine whether a REAL Ising ONNX decode occurred (vs the PyMatching
        // identity-matrix placeholder fallback). ising_corrected_estimate is non-null
        // in BOTH cases (the fallback backfills it), so it cannot be used as the
        // success signal — use the decoder's own ising_model_loaded flag instead.
        const isingDecoderSucceeded = pyResult.ising_model_loaded === true;
        const isingDecodeErrorMsg = isingDecoderSucceeded
          ? null
          : "ising_fallback_to_pymatching";

        await completeCost(isingCostRowId, {
          wallClockMs: Date.now() - pollRowStartMs,
          status: isingDecoderSucceeded ? "completed" : "failed",
          errorMessage: isingDecodeErrorMsg,
          qpuSeconds: pyResult.qpu_seconds_used ?? 0,
        });

        logger.info(
          {
            runId: row.id,
            strategyId: row.strategyId,
            isingEstimate: pyResult.ising_corrected_estimate,
            agreementWithClassical,
            qpuSeconds: pyResult.qpu_seconds_used,
            isingDecoderSucceeded,
          },
          "cloud-qmc: job completed, evidence persisted (challenger-only, Phase 0 shadow)",
        );
        result.completed++;

      } else if (pyResult.status === "running") {
        // Still running — leave as "running", will be picked up next poll
        await db
          .update(cloudQmcRuns)
          .set({ status: "running" })
          .where(eq(cloudQmcRuns.id, row.id));
        result.skipped++;

      } else {
        // Failed or error — no ising_decoder cost row (decoder never ran)
        await db
          .update(cloudQmcRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorMessage: pyResult.error_message ?? `unexpected_status=${pyResult.status}`,
          })
          .where(eq(cloudQmcRuns.id, row.id));

        logger.warn(
          { runId: row.id, strategyId: row.strategyId, status: pyResult.status, error: pyResult.error_message },
          "cloud-qmc: job failed",
        );
        result.failed++;
      }

    } catch (pollErr) {
      // Non-fatal — log and continue to next row
      logger.warn({ runId: row.id, err: pollErr }, "cloud-qmc: poll error for row, continuing");

      // If an ising_decoder cost row was created before the error, mark it failed
      await completeCost(isingCostRowId, {
        wallClockMs: Date.now() - pollRowStartMs,
        status: "failed",
        errorMessage: pollErr instanceof Error ? pollErr.message : String(pollErr),
      });

      result.failed++;
    }
  }

  logger.info(result, "cloud-qmc-poll: cycle complete");
  return result;
}

// ─── Query helpers (for lifecycle-service and critic) ────────────────────────

/**
 * Get latest completed cloud_qmc_runs row for a given backtest.
 * Returns null if no completed run exists.
 *
 * This is the mirror of getLatestAdversarialStressRun() in adversarial-stress-service.ts.
 * Used by Tier 7 measurement queries.
 */
export async function getLatestCloudQmcRun(
  backtestId: string,
): Promise<{
  runId: string;
  isingCorrectedEstimate: number | null;
  pymatchingEstimate: number | null;
  agreementWithClassical: number | null;
  agreementWithLocalIae: number | null;
  backendName: string;
  status: string;
} | null> {
  try {
    const [row] = await db
      .select({
        id: cloudQmcRuns.id,
        isingCorrectedEstimate: cloudQmcRuns.isingCorrectedEstimate,
        pymatchingEstimate: cloudQmcRuns.pymatchingEstimate,
        agreementWithClassical: cloudQmcRuns.agreementWithClassical,
        agreementWithLocalIae: cloudQmcRuns.agreementWithLocalIae,
        backendName: cloudQmcRuns.backendName,
        status: cloudQmcRuns.status,
      })
      .from(cloudQmcRuns)
      .where(
        and(
          eq(cloudQmcRuns.backtestId, backtestId),
          eq(cloudQmcRuns.status, "completed"),
        ),
      )
      .orderBy(desc(cloudQmcRuns.createdAt))
      .limit(1);

    if (!row) return null;

    return {
      runId: row.id,
      isingCorrectedEstimate: row.isingCorrectedEstimate != null
        ? parseFloat(String(row.isingCorrectedEstimate))
        : null,
      pymatchingEstimate: row.pymatchingEstimate != null
        ? parseFloat(String(row.pymatchingEstimate))
        : null,
      agreementWithClassical: row.agreementWithClassical != null
        ? parseFloat(String(row.agreementWithClassical))
        : null,
      agreementWithLocalIae: row.agreementWithLocalIae != null
        ? parseFloat(String(row.agreementWithLocalIae))
        : null,
      backendName: row.backendName,
      status: row.status,
    };
  } catch (err) {
    logger.warn({ backtestId, err }, "cloud-qmc: getLatestCloudQmcRun failed — returning null");
    return null;
  }
}

/**
 * List recent cloud_qmc_runs rows for a strategy (for status API).
 */
export async function listCloudQmcRunsForStrategy(
  strategyId: string,
  limit = 10,
): Promise<Array<{
  id: string;
  backtestId: string;
  backendName: string;
  status: string;
  ibmJobId: string | null;
  isingCorrectedEstimate: string | null;
  pymatchingEstimate: string | null;
  qpuSecondsUsed: string | null;
  agreementWithClassical: string | null;
  createdAt: Date | null;
  governanceLabels: unknown;
}>> {
  try {
    return await db
      .select({
        id: cloudQmcRuns.id,
        backtestId: cloudQmcRuns.backtestId,
        backendName: cloudQmcRuns.backendName,
        status: cloudQmcRuns.status,
        ibmJobId: cloudQmcRuns.ibmJobId,
        isingCorrectedEstimate: cloudQmcRuns.isingCorrectedEstimate,
        pymatchingEstimate: cloudQmcRuns.pymatchingEstimate,
        qpuSecondsUsed: cloudQmcRuns.qpuSecondsUsed,
        agreementWithClassical: cloudQmcRuns.agreementWithClassical,
        createdAt: cloudQmcRuns.createdAt,
        governanceLabels: cloudQmcRuns.governanceLabels,
      })
      .from(cloudQmcRuns)
      .where(eq(cloudQmcRuns.strategyId, strategyId))
      .orderBy(desc(cloudQmcRuns.createdAt))
      .limit(limit);
  } catch (err) {
    logger.warn({ strategyId, err }, "cloud-qmc: listCloudQmcRunsForStrategy failed");
    return [];
  }
}
