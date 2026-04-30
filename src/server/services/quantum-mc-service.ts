import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, monteCarloRuns, quantumMcRuns, quantumMcBenchmarks, auditLog, strategies, strategyExports } from "../db/schema.js";
import { logger } from "../index.js";
import { parsePythonJson } from "../../shared/utils.js";
import { compilePineExport } from "./pine-export-service.js";
import { tracer } from "../lib/tracing.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

interface QuantumResult {
  estimated_value: number;
  confidence_interval: { lower: number; upper: number; confidence_level: number };
  num_oracle_calls: number;
  num_qubits: number;
  backend_used: string;
  execution_time_ms: number;
  governance_labels: Record<string, unknown>;
  reproducibility_hash: string;
  raw_result: Record<string, unknown>;
  // Cloud execution metadata — present only when a cloud backend was used
  cloud_provider?: string | null;
  cloud_backend_name?: string | null;
  cloud_job_id?: string | null;
  cloud_qpu_time_seconds?: number;
  cloud_cost_dollars?: number;
}


export interface QuantumRuntimeStatus {
  latestRunAt: string | null;
  latestRunStatus: string | null;
  latestRunMethod: string | null;
  latestBackend: string | null;
  latestBenchmarkAt: string | null;
  recentRunCount: number;
  recentFallbackCount: number;
  fallbackReady: boolean;
  authorityBoundary: "challenger_only";
}

function runPythonQuantumMC(configPath: string, timeoutMs: number = 300_000): Promise<QuantumResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.quantum_mc", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const TIMEOUT_MS = timeoutMs;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Quantum MC timed out after ${TIMEOUT_MS / 1000}s`));
      }
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "quantum-mc-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        try {
          resolve(parsePythonJson<QuantumResult>(stdout));
        } catch {
          reject(new Error(`Failed to parse quantum MC output: ${stdout.slice(0, 500)}`));
        }
      } else {
        reject(new Error(`Quantum MC failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

export async function runQuantumMC(
  backtestId: string,
  eventType: string = "breach",
  firmKey: string = "topstep_50k",
  options: {
    threshold?: number;
    epsilon?: number;
    alpha?: number;
    backend?: string;
    optInCloud?: boolean;
    cloudProvider?: string;
    cloudBackend?: string;
    correlationId?: string;
  } = {},
) {
  const correlationId = options.correlationId ?? null;
  const qmcSpan = tracer.startSpan("quantum_mc.run");
  qmcSpan.setAttribute("backtestId", backtestId);
  qmcSpan.setAttribute("eventType", eventType);
  qmcSpan.setAttribute("firmKey", firmKey);

  // Fetch backtest
  const [bt] = await db.select().from(backtests).where(eq(backtests.id, backtestId));
  if (!bt) throw new Error(`Backtest ${backtestId} not found`);
  if (bt.status !== "completed") throw new Error(`Backtest not completed (status: ${bt.status})`);

  // Insert running quantum run
  // Insert a running row with a provisional method label — updated after the Python
  // engine returns so we reflect the actual execution path (iae or classical_fallback).
  const [qmcRow] = await db
    .insert(quantumMcRuns)
    .values({
      backtestId,
      status: "running",
      method: "iae",  // provisional — overwritten below once result is available
      governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
    })
    .returning();
  qmcSpan.setAttribute("qmcRunId", qmcRow.id);

  try {
    // Build config for Python
    const config: Record<string, unknown> = {
      model: {
        model_type: "empirical_binned",
        parameters: {},
        n_samples: Array.isArray(bt.dailyPnls) ? (bt.dailyPnls as number[]).length : 0,
        bins: null,
        probabilities: null,
        // Pass raw data — Python will build the distribution
      },
      event_type: eventType,
      threshold: options.threshold ?? 2000,
      epsilon: options.epsilon ?? 0.01,
      alpha: options.alpha ?? 0.05,
      backend: options.backend ?? null,
      seed: 42,
      daily_pnls: bt.dailyPnls ?? [],
      firm_key: firmKey,
    };

    // Cloud config passthrough — only attached when caller opts in
    if (options.optInCloud) {
      config.cloud_config = {
        provider: options.cloudProvider ?? null,
        backend_name: options.cloudBackend ?? null,
        opt_in_cloud: true,
        ibm_token: process.env.IBM_QUANTUM_TOKEN ?? null,
        ibm_instance: process.env.IBM_QUANTUM_INSTANCE ?? "open-instance",
        braket_region: process.env.BRAKET_REGION ?? "us-east-1",
        braket_s3_bucket: process.env.BRAKET_S3_BUCKET ?? "amazon-braket-trading-forge",
        budget_limit_seconds: parseInt(process.env.IBM_QUANTUM_BUDGET_SECONDS ?? "600", 10),
        budget_limit_dollars: parseFloat(process.env.BRAKET_BUDGET_DOLLARS ?? "30"),
      };
    }

    // Cloud runs get a 15-minute timeout; local runs keep the standard 5-minute limit
    const timeoutMs = options.optInCloud ? 900_000 : 300_000;

    const tmpPath = pathResolve(tmpdir(), `qmc-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: QuantumResult;
    try {
      result = await runPythonQuantumMC(tmpPath, timeoutMs);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // Update DB — write the actual method from the Python result so classical
    // fallbacks are not silently labelled "iae" in the persistent record.
    const actualMethod = (result.raw_result?.method as string | undefined) ?? "iae";
    await db.update(quantumMcRuns).set({
      status: "completed",
      method: actualMethod,
      backend: result.backend_used,
      numQubits: result.num_qubits,
      estimatedValue: String(result.estimated_value),
      confidenceInterval: result.confidence_interval,
      executionTimeMs: result.execution_time_ms,
      gpuAccelerated: result.backend_used.includes("gpu"),
      rawResult: result.raw_result,
      reproducibilityHash: result.reproducibility_hash,
      // Cloud metadata — null when local execution path was used
      cloudProvider: result.cloud_provider ?? null,
      cloudBackendName: result.cloud_backend_name ?? null,
      cloudJobId: result.cloud_job_id ?? null,
      cloudQpuTimeSeconds: result.cloud_qpu_time_seconds ? String(result.cloud_qpu_time_seconds) : null,
      cloudCostDollars: result.cloud_cost_dollars ? String(result.cloud_cost_dollars) : null,
      cloudRegion: options.optInCloud ? (process.env.BRAKET_REGION ?? "us-east-1") : null,
    }).where(eq(quantumMcRuns.id, qmcRow.id));

    await db.insert(auditLog).values({
      action: "quantum-mc.run",
      entityType: "quantum_mc",
      entityId: qmcRow.id,
      input: { backtestId, eventType, firmKey },
      result: { estimated_value: result.estimated_value, backend: result.backend_used },
      status: "success",
      durationMs: result.execution_time_ms,
      decisionAuthority: "agent",
      correlationId,
    });

    // ─── Auto-persist benchmark comparison (challenger evidence) ───
    // Joins quantum run against the latest classical MC run for this backtest.
    // Skipped silently if no classical run exists yet — MC may still be in-flight.
    try {
      const classicalMcRun = await db.select().from(monteCarloRuns).where(eq(monteCarloRuns.backtestId, backtestId)).limit(1);
      if (classicalMcRun.length > 0) {
        const classicalValue = classicalMcRun[0].probabilityOfRuin;
        const quantumValue = result.estimated_value;
        const delta = Math.abs(quantumValue - Number(classicalValue));
        const isClassicalFallback = result.raw_result?.classical_fallback;
        // Determine backend type for benchmark provenance
        const autoBenchBackendType = isClassicalFallback
          ? "classical_fallback"
          : (result.cloud_provider ?? (result.backend_used.includes("gpu") ? "local_gpu" : "local"));
        await db.insert(quantumMcBenchmarks).values({
          quantumRunId: qmcRow.id,
          classicalRunId: classicalMcRun[0].id,
          metric: eventType,
          quantumValue: String(quantumValue),
          classicalValue: String(classicalValue),
          absoluteDelta: String(delta),
          relativeDelta: String(Number(classicalValue) !== 0 ? delta / Math.abs(Number(classicalValue)) : 0),
          toleranceThreshold: "0.05",
          passes: delta < 0.05,
          backendType: autoBenchBackendType,
          notes: isClassicalFallback
            ? "Classical fallback — delta is classical-vs-classical."
            : `Delta: ${delta.toFixed(4)}`,
        });
        logger.info({ backtestId, quantumRunId: qmcRow.id, delta }, "Auto benchmark comparison persisted");
      }
    } catch (err) { logger.warn({ err }, "Auto benchmark comparison failed"); }

    // ── Fix 2.12: Quantum-enriched Pine re-compile (fire-and-forget) ──
    // After quantum MC completes, trigger a second Pine compile that includes the quantum
    // estimate in risk intelligence. This enriches the prop-risk overlay with the challenger
    // estimate so the exported Pine reflects the latest confidence data.
    // Guards: strategy must be PAPER or DEPLOY_READY, and a prior Pine export must already
    // exist (we don't create a first export here — MC auto-trigger owns that).
    // Wrapped in try/catch so quantum MC completion is never blocked by Pine failure.
    try {
      if (bt.strategyId) {
        // Check lifecycle state
        const [strat] = await db
          .select({ lifecycleState: strategies.lifecycleState })
          .from(strategies)
          .where(eq(strategies.id, bt.strategyId))
          .limit(1);

        if (strat && ["PAPER", "DEPLOY_READY"].includes(strat.lifecycleState)) {
          // Check whether a prior Pine export exists for this strategy
          const [priorExport] = await db
            .select({ id: strategyExports.id, propOverlayFirm: strategyExports.propOverlayFirm })
            .from(strategyExports)
            .where(eq(strategyExports.strategyId, bt.strategyId))
            .orderBy(desc(strategyExports.createdAt))
            .limit(1);

          if (priorExport) {
            // Use the firm key from the prior export so the re-compile is consistent
            const reFirmKey = priorExport.propOverlayFirm ?? "topstep_50k";

            // Build risk intelligence enriched with the quantum estimate
            const quantumRiskIntelligence: Record<string, number | string | null> = {
              quantum_estimate: result.estimated_value,
              // governance label so the Pine overlay knows this is a challenger estimate
              governance_label: "challenger_only",
            };

            logger.info(
              { strategyId: bt.strategyId, backtestId, quantumEstimate: result.estimated_value, firmKey: reFirmKey },
              "Auto Pine quantum-enriched re-compile triggered",
            );

            compilePineExport(bt.strategyId, reFirmKey, "pine_indicator", quantumRiskIntelligence).then((pineResult) => {
              logger.info(
                {
                  strategyId: bt.strategyId,
                  exportId: pineResult.id,
                  score: pineResult.exportabilityScore ?? 0,
                  status: pineResult.status,
                },
                "Auto Pine quantum-enriched re-compile completed",
              );
            }).catch((pineErr) => {
              logger.warn(
                { strategyId: bt.strategyId, err: pineErr },
                "Auto Pine quantum-enriched re-compile failed (non-blocking)",
              );
            });
          } else {
            logger.info(
              { strategyId: bt.strategyId },
              "Auto Pine quantum-enriched re-compile skipped: no prior export exists",
            );
          }
        } else {
          logger.info(
            { strategyId: bt.strategyId, lifecycleState: strat?.lifecycleState ?? "unknown" },
            "Auto Pine quantum-enriched re-compile skipped: strategy not in PAPER or DEPLOY_READY",
          );
        }
      }
    } catch (pineRecompileErr) {
      logger.warn(
        { backtestId, err: pineRecompileErr },
        "Auto Pine quantum-enriched re-compile check threw (non-blocking)",
      );
    }

    qmcSpan.setAttribute("status", "completed");
    qmcSpan.setAttribute("backend", result.backend_used);
    qmcSpan.end();
    return { id: qmcRow.id, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(quantumMcRuns).set({
      status: "failed",
      rawResult: { error: errorMsg },
    }).where(eq(quantumMcRuns.id, qmcRow.id));

    await db.insert(auditLog).values({
      action: "quantum-mc.run",
      entityType: "quantum_mc",
      entityId: qmcRow.id,
      input: { backtestId, eventType, firmKey },
      result: { error: errorMsg },
      status: "failure",
      decisionAuthority: "agent",
      errorMessage: errorMsg,
      correlationId,
    });

    qmcSpan.setAttribute("status", "failed");
    qmcSpan.end();
    return { id: qmcRow.id, status: "failed", error: errorMsg };
  }
}

export async function runHybridCompare(
  backtestId: string,
  eventType: string = "breach",
  firmKey: string = "topstep_50k",
  threshold?: number,
  context?: { correlationId?: string },
) {
  const correlationId = context?.correlationId;
  // Run quantum estimation
  const quantumResult = await runQuantumMC(backtestId, eventType, firmKey, { threshold, correlationId });

  // Get latest classical MC run for comparison
  const [classicalRun] = await db
    .select()
    .from(monteCarloRuns)
    .where(eq(monteCarloRuns.backtestId, backtestId))
    .orderBy(desc(monteCarloRuns.createdAt))
    .limit(1);

  const classicalValue = classicalRun?.probabilityOfRuin
    ? Number(classicalRun.probabilityOfRuin)
    : 0;

  // Compute delta
  const quantumValue = "estimated_value" in quantumResult ? quantumResult.estimated_value : 0;
  const delta = Math.abs(quantumValue - classicalValue);

  // Store benchmark — annotate when the quantum run fell back to classical so the
  // critic knows the delta is classical-vs-classical, not quantum-vs-classical.
  if (quantumResult.id) {
    const isClassicalFallback = !!(
      "raw_result" in quantumResult &&
      (quantumResult as { raw_result?: Record<string, unknown> }).raw_result?.classical_fallback
    );
    const benchmarkNotes = delta <= 0.05
      ? "Quantum estimate within 5% of classical MC"
      : `Delta ${delta.toFixed(4)} exceeds 5% tolerance`;
    const notes = isClassicalFallback
      ? "Classical fallback — quantum circuit did not execute. Delta is classical-vs-classical."
      : benchmarkNotes;

    // Determine backend type for benchmark provenance
    const hybridBenchBackendType = isClassicalFallback
      ? "classical_fallback"
      : (
          "cloud_provider" in quantumResult && (quantumResult as { cloud_provider?: string | null }).cloud_provider
            ? (quantumResult as { cloud_provider?: string | null }).cloud_provider!
            : "local"
        );
    await db.insert(quantumMcBenchmarks).values({
      quantumRunId: quantumResult.id,
      classicalRunId: classicalRun?.id ?? null,
      metric: eventType,
      quantumValue: String(quantumValue),
      classicalValue: String(classicalValue),
      absoluteDelta: String(delta),
      relativeDelta: String(classicalValue !== 0 ? delta / Math.abs(classicalValue) : 0),
      toleranceThreshold: "0.05",
      passes: delta <= 0.05,
      backendType: hybridBenchBackendType,
      notes,
    });

    // Update quantum run with classical comparison
    await db.update(quantumMcRuns).set({
      classicalValue: String(classicalValue),
      toleranceDelta: String(delta),
      withinTolerance: delta <= 0.05,
    }).where(eq(quantumMcRuns.id, quantumResult.id));
  }

  return {
    quantumResult,
    classicalValue,
    delta,
    withinTolerance: delta <= 0.05,
  };
}

export async function getQuantumRun(runId: string) {
  const [run] = await db.select().from(quantumMcRuns).where(eq(quantumMcRuns.id, runId));
  return run ?? null;
}

export async function getBenchmark(benchmarkId: string) {
  const [bench] = await db.select().from(quantumMcBenchmarks).where(eq(quantumMcBenchmarks.id, benchmarkId));
  return bench ?? null;
}

export async function getQuantumRuntimeStatus(): Promise<QuantumRuntimeStatus> {
  const [latestRun, latestBenchmark, recentRuns] = await Promise.all([
    db
      .select({
        createdAt: quantumMcRuns.createdAt,
        status: quantumMcRuns.status,
        method: quantumMcRuns.method,
        backend: quantumMcRuns.backend,
        rawResult: quantumMcRuns.rawResult,
      })
      .from(quantumMcRuns)
      .orderBy(desc(quantumMcRuns.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        createdAt: quantumMcBenchmarks.createdAt,
      })
      .from(quantumMcBenchmarks)
      .orderBy(desc(quantumMcBenchmarks.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        rawResult: quantumMcRuns.rawResult,
      })
      .from(quantumMcRuns)
      .where(eq(quantumMcRuns.status, "completed"))
      .orderBy(desc(quantumMcRuns.createdAt))
      .limit(100),
  ]);

  const recentRunCount = recentRuns.length;
  const recentFallbackCount = recentRuns.filter((run) => {
    const raw = run.rawResult as Record<string, unknown> | null;
    return raw?.classical_fallback === true;
  }).length;

  return {
    latestRunAt: latestRun?.createdAt?.toISOString() ?? null,
    latestRunStatus: latestRun?.status ?? null,
    latestRunMethod: latestRun?.method ?? null,
    latestBackend: latestRun?.backend ?? null,
    latestBenchmarkAt: latestBenchmark?.createdAt?.toISOString() ?? null,
    recentRunCount,
    recentFallbackCount,
    fallbackReady: true,
    authorityBoundary: "challenger_only",
  };
}
