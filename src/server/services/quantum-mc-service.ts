import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, monteCarloRuns, quantumMcRuns, quantumMcBenchmarks, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { parsePythonJson } from "../../shared/utils.js";

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
}

interface BenchmarkOutput {
  metric: string;
  quantum_value: number;
  classical_value: number;
  absolute_delta: number;
  relative_delta: number;
  passes: boolean;
  tolerance_config: Record<string, unknown>;
  reproducibility_hash: string;
  notes: string;
}

function runPythonQuantumMC(configPath: string): Promise<QuantumResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.quantum_mc", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const TIMEOUT_MS = 300_000; // 5 min
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

function runPythonQuantumBench(configPath: string): Promise<BenchmarkOutput> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.quantum_bench", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const TIMEOUT_MS = 60_000;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; proc.kill("SIGTERM"); reject(new Error("Benchmark timed out")); }
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        try { resolve(parsePythonJson<BenchmarkOutput>(stdout)); }
        catch { reject(new Error(`Failed to parse benchmark output: ${stdout.slice(0, 500)}`)); }
      } else {
        reject(new Error(`Benchmark failed (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(err); }
    });
  });
}

export async function runQuantumMC(
  backtestId: string,
  eventType: string = "breach",
  firmKey: string = "topstep_50k",
  options: { threshold?: number; epsilon?: number; alpha?: number; backend?: string } = {},
) {
  // Fetch backtest
  const [bt] = await db.select().from(backtests).where(eq(backtests.id, backtestId));
  if (!bt) throw new Error(`Backtest ${backtestId} not found`);
  if (bt.status !== "completed") throw new Error(`Backtest not completed (status: ${bt.status})`);

  // Insert pending quantum run
  const [qmcRow] = await db
    .insert(quantumMcRuns)
    .values({
      backtestId,
      method: "iae",
      governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
    })
    .returning();

  try {
    // Build config for Python
    const config = {
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

    const tmpPath = pathResolve(tmpdir(), `qmc-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: QuantumResult;
    try {
      result = await runPythonQuantumMC(tmpPath);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // Update DB
    await db.update(quantumMcRuns).set({
      backend: result.backend_used,
      numQubits: result.num_qubits,
      estimatedValue: String(result.estimated_value),
      confidenceInterval: result.confidence_interval,
      executionTimeMs: result.execution_time_ms,
      gpuAccelerated: result.backend_used.includes("gpu"),
      rawResult: result.raw_result,
      reproducibilityHash: result.reproducibility_hash,
    }).where(eq(quantumMcRuns.id, qmcRow.id));

    await db.insert(auditLog).values({
      action: "quantum-mc.run",
      entityType: "quantum_mc",
      entityId: qmcRow.id,
      input: { backtestId, eventType, firmKey },
      result: { estimated_value: result.estimated_value, backend: result.backend_used },
      status: "success",
      durationMs: result.execution_time_ms,
    });

    return { id: qmcRow.id, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db.update(quantumMcRuns).set({
      rawResult: { error: errorMsg },
    }).where(eq(quantumMcRuns.id, qmcRow.id));

    await db.insert(auditLog).values({
      action: "quantum-mc.run",
      entityType: "quantum_mc",
      entityId: qmcRow.id,
      input: { backtestId, eventType, firmKey },
      result: { error: errorMsg },
      status: "failure",
    });

    return { id: qmcRow.id, status: "failed", error: errorMsg };
  }
}

export async function runHybridCompare(
  backtestId: string,
  eventType: string = "breach",
  firmKey: string = "topstep_50k",
  threshold?: number,
) {
  // Run quantum estimation
  const quantumResult = await runQuantumMC(backtestId, eventType, firmKey, { threshold });

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

  // Store benchmark
  if (quantumResult.id) {
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
      notes: delta <= 0.05
        ? "Quantum estimate within 5% of classical MC"
        : `Delta ${delta.toFixed(4)} exceeds 5% tolerance`,
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
