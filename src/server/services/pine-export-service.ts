import { spawn, type ChildProcess } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyExports, strategyExportArtifacts, auditLog, backtests, monteCarloRuns, quantumMcRuns } from "../db/schema.js";
import { logger } from "../index.js";
import { broadcastSSE } from "../routes/sse.js";
import { parsePythonJson } from "../../shared/utils.js";
import { getPythonSubprocessStats } from "../lib/python-runner.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

// FIX 4: Pine compiler subprocess pool — mirrors python-runner.ts semaphore pattern.
// Without a cap, concurrent export requests can leak unbounded Python processes.
const PINE_MAX_SUBPROCESSES = Math.max(
  1,
  parseInt(process.env.PINE_MAX_SUBPROCESSES ?? "3", 10) || 3,
);
let _pineActiveCount = 0;
const _pineWaitQueue: Array<() => void> = [];

function _acquirePineSlot(): Promise<void> {
  if (_pineActiveCount < PINE_MAX_SUBPROCESSES) {
    _pineActiveCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _pineWaitQueue.push(() => {
      _pineActiveCount++;
      resolve();
    });
  });
}

function _releasePineSlot(): void {
  _pineActiveCount = Math.max(0, _pineActiveCount - 1);
  const next = _pineWaitQueue.shift();
  if (next) next();
}

// FIX 4: SIGTERM drain registry for Pine compiler subprocesses.
// Entries auto-remove on process exit so the set always reflects live procs.
const _activePineProcs = new Set<ChildProcess>();

function _registerPineProc(child: ChildProcess): void {
  _activePineProcs.add(child);
  child.once("exit", () => _activePineProcs.delete(child));
}

interface CompilerOutput {
  exportability: {
    score: number;
    band: string;
    indicator_scores: Record<string, number>;
    deductions: string[];
    recommendations: string[];
    exportable: boolean;
  };
  artifacts: Array<{
    artifact_type: string;
    file_name: string;
    content: string;
    size_bytes: number;
  }>;
  strategy_name: string;
  pine_version: string;
  content_hash: string;
}

/**
 * G6.3 — Exportability pre-check for TESTING → PAPER promotion.
 *
 * Calls the Pine compiler in dry-run / dual-output mode and returns the
 * exportability score + deductions without persisting an export artifact.
 * Lifecycle service can use this as a hard gate before writing PAPER state.
 *
 * Returns { ok, score, band, deductions, recommendations }. `ok` is true iff
 * the strategy compiles AND the compiler's `exportable` flag is set.
 *
 * NOTE: This is a thin wrapper over the existing compiler — it does not
 * yet perform full semantic-equivalence checking (running the strategy in
 * Python AND a Pine simulator and asserting trades match within tolerance).
 * That is documented as the next G6.3 iteration; today's check catches the
 * "strategy can't be expressed in Pine at all" failure mode.
 */
export async function checkExportability(strategyId: string): Promise<{
  ok: boolean;
  score: number | null;
  band: string | null;
  deductions: string[];
  recommendations: string[];
  error?: string;
}> {
  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    if (!strat) {
      return { ok: false, score: null, band: null, deductions: ["strategy_not_found"], recommendations: [] };
    }
    // Dry-run: run the dual compiler with persist=false — only inspect
    // exportability metadata. No DB rows are written.
    const result = await compileDualPineExport(strategyId, undefined, undefined, false);
    return {
      ok: !!result?.exportability?.exportable,
      score: result?.exportability?.score ?? null,
      band: result?.exportability?.band ?? null,
      deductions: result?.exportability?.deductions ?? [],
      recommendations: result?.exportability?.recommendations ?? [],
    };
  } catch (err) {
    return {
      ok: false,
      score: null,
      band: null,
      deductions: ["compiler_error"],
      recommendations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Dual-artifact compiler output — both _INDICATOR.pine and _STRATEGY.pine. */
interface DualCompilerOutput {
  exportability: {
    score: number;
    band: string;
    indicator_scores: Record<string, number>;
    deductions: string[];
    recommendations: string[];
    exportable: boolean;
  };
  strategy_name: string;
  pine_version: string;
  content_hash: string;
  indicator_artifact: {
    artifact_type: string;   // "dual_indicator"
    file_name: string;       // "{name}_INDICATOR.pine"
    content: string;
    size_bytes: number;
  } | null;
  strategy_artifact: {
    artifact_type: string;   // "dual_strategy"
    file_name: string;       // "{name}_STRATEGY.pine"
    content: string;
    size_bytes: number;
  } | null;
  alerts_artifact: {
    artifact_type: string;   // "dual_alerts_json"
    file_name: string;
    content: string;
    size_bytes: number;
  } | null;
  indicator_firms: string[];
  strategy_firms: string[];
  degradation_notes: string[];
}

// FIX 4: runPineCompiler now uses pool semaphore + SIGTERM registry + 120s timeout.
async function runPineCompiler(configPath: string, correlationId?: string): Promise<CompilerOutput> {
  await _acquirePineSlot();
  try {
    return await new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      const args = ["-m", "src.engine.pine_compiler", "--input-json", configPath];

      const proc = spawn(pythonCmd, args, {
        env: { ...process.env },
        cwd: PROJECT_ROOT,
      });
      _registerPineProc(proc);

      // FIX 4: increased from 60s → 120s per audit requirement
      const TIMEOUT_MS = 120_000;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill("SIGTERM"); } catch { /* dead */ }
          killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 2000);
          reject(new Error(`Pine compiler timed out after ${TIMEOUT_MS / 1000}s`));
        }
      }, TIMEOUT_MS);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          stderr += msg + "\n";
          logger.info({ component: "pine-compiler", correlationId }, msg);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        if (code === 0) {
          try {
            resolve(parsePythonJson<CompilerOutput>(stdout));
          } catch {
            reject(new Error(`Failed to parse Pine compiler output: ${stdout.slice(0, 500)}`));
          }
        } else {
          reject(new Error(`Pine compiler failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  } finally {
    _releasePineSlot();
  }
}

// FIX 4: runDualPineCompiler now uses pool semaphore + SIGTERM registry + 120s timeout.
async function runDualPineCompiler(configPath: string, strategyId?: string, correlationId?: string): Promise<DualCompilerOutput> {
  await _acquirePineSlot();
  try {
    return await new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";
      // --dual flag activates compile_dual_artifacts() in pine_compiler.py
      // --strategy-id passes the DB UUID so it is embedded in TradersPost webhook payloads
      const args = ["-m", "src.engine.pine_compiler", "--input-json", configPath, "--dual"];
      if (strategyId) {
        args.push("--strategy-id", strategyId);
      }

      const proc = spawn(pythonCmd, args, {
        env: { ...process.env },
        cwd: PROJECT_ROOT,
      });
      _registerPineProc(proc);

      // FIX 4: increased from 60s → 120s per audit requirement
      const TIMEOUT_MS = 120_000;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { proc.kill("SIGTERM"); } catch { /* dead */ }
          killTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* dead */ } }, 2000);
          reject(new Error(`Dual Pine compiler timed out after ${TIMEOUT_MS / 1000}s`));
        }
      }, TIMEOUT_MS);

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          stderr += msg + "\n";
          logger.info({ component: "pine-compiler-dual", correlationId }, msg);
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        if (code === 0) {
          try {
            resolve(parsePythonJson<DualCompilerOutput>(stdout));
          } catch {
            reject(new Error(`Failed to parse dual Pine compiler output: ${stdout.slice(0, 500)}`));
          }
        } else {
          reject(new Error(`Dual Pine compiler failed (exit ${code}): ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  } finally {
    _releasePineSlot();
  }
}

/**
 * Compile BOTH Pine artifacts (INDICATOR + STRATEGY) for a strategy that has
 * reached DEPLOY_READY.  Writes two artifact rows to strategy_export_artifacts:
 *   - artifact_type="dual_indicator"  → {name}_INDICATOR.pine (Apex/Tradeify path)
 *   - artifact_type="dual_strategy"   → {name}_STRATEGY.pine (ATS/TradersPost path)
 *   - artifact_type="dual_alerts_json" → alerts metadata for both paths
 *
 * DB schema is NOT changed — both artifacts are separate rows in
 * strategy_export_artifacts (same exportId).  Callers can filter by
 * artifact_type to get the right file for each firm.
 *
 * No exportability score gate — both artifacts are ALWAYS produced when the
 * strategy is exportable.  The score is surfaced as metadata only.
 */
export async function compileDualPineExport(
  strategyId: string,
  firmKey?: string,
  injectedRiskIntelligence?: Record<string, number | string | null> | null,
  persist: boolean = true,
  correlationId?: string,
) {
  // FIX 4: track wall-clock duration for audit_log
  const startMs = Date.now();

  // 1. Load strategy from DB
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  // P2-4: When persist=false (dry-run / checkExportability), skip all DB writes.
  // Return in-memory result only — no export row, no artifact rows, no audit log.
  let exportId: string | null = null;
  if (persist) {
    // 2. Insert pending export row (export_type = "pine_dual" to distinguish from legacy)
    const [exportRow] = await db
      .insert(strategyExports)
      .values({
        strategyId,
        exportType: "pine_dual",
        status: "compiling",
        propOverlayFirm: firmKey ?? null,
      })
      .returning();
    exportId = exportRow.id;
  }

  try {
    // 3. Risk intelligence — same fetch logic as compilePineExport
    let riskIntelligence: Record<string, number | string | null> | null =
      injectedRiskIntelligence ?? null;
    let latestBacktestId: string | null = null;
    if (riskIntelligence === null) {
      try {
        const [latestBacktest] = await db
          .select({ id: backtests.id })
          .from(backtests)
          .where(eq(backtests.strategyId, strategyId))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (latestBacktest) {
          latestBacktestId = latestBacktest.id;
          const [mcRun] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
              sharpeP50: monteCarloRuns.sharpeP50,
              riskMetrics: monteCarloRuns.riskMetrics,
            })
            .from(monteCarloRuns)
            .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          const [quantumRun] = await db
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              governanceLabels: quantumMcRuns.governanceLabels,
            })
            .from(quantumMcRuns)
            .where(eq(quantumMcRuns.backtestId, latestBacktest.id))
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (mcRun || quantumRun) {
            const rm = (mcRun?.riskMetrics as Record<string, unknown> | null) ?? {};
            const ruinProb = mcRun?.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
            const survivalRate = ruinProb != null ? 1 - ruinProb : null;
            const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
            const sharpeP50 = mcRun?.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;
            const govLabels = (quantumRun?.governanceLabels as Record<string, unknown> | null) ?? {};
            const quantumEst = quantumRun?.estimatedValue != null ? Number(quantumRun.estimatedValue) : null;

            const candidate: Record<string, number | string | null> = {
              breach_probability: breachProb,
              ruin_probability: ruinProb,
              survival_rate: survivalRate,
              mc_sharpe_p50: sharpeP50,
              quantum_estimate: quantumEst,
            };
            if (govLabels.decision_role != null) {
              candidate.governance_label = govLabels.decision_role as string;
            }

            const hasData = Object.values(candidate).some((v) => v != null);
            if (hasData) riskIntelligence = candidate;
          }
        }
      } catch (riErr) {
        logger.warn(
          { strategyId, err: riErr },
          "Failed to fetch risk intelligence for dual Pine export (non-blocking)",
        );
      }
    }

    // 4. Build config — pass strategy_id so it embeds in webhook payloads
    const strategyConfig = strategy.config as Record<string, unknown>;
    const config = {
      strategy: { ...strategyConfig },
      firm_key: firmKey,
      strategy_id: strategyId,
      ...(riskIntelligence != null ? { risk_intelligence: riskIntelligence } : {}),
    };

    const tmpPath = pathResolve(tmpdir(), `pine-dual-config-${strategyId.slice(0, 8)}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: DualCompilerOutput;
    try {
      // FIX 4: pass correlationId to subprocess wrapper
      result = await runDualPineCompiler(tmpPath, strategyId, correlationId);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    const durationMs = Date.now() - startMs;

    // P2-4: persist=false → skip all DB writes, return in-memory result only
    let artifactRows: { id: string; artifactType: string; fileName: string; sizeBytes: number | null }[] = [];

    if (persist && exportId) {
      // 5. Update export row — FIX 3: write contentHash, configSnapshot, backtestId
      await db
        .update(strategyExports)
        .set({
          exportabilityScore: String(result.exportability.score),
          exportabilityDetails: result.exportability,
          status: "completed",
          pineVersion: result.pine_version,
          // FIX 3: persist content_hash so re-export drift is detectable
          contentHash: result.content_hash ?? null,
          // FIX 3: snapshot the strategy config at export time for reproducibility
          configSnapshot: strategyConfig,
          // FIX 3: link to the backtest that produced this export
          backtestId: latestBacktestId ?? null,
        })
        .where(eq(strategyExports.id, exportId));

      // 6. Insert artifacts — FIX 3: include contentHash per artifact
      const dualArtifacts = [
        result.indicator_artifact,
        result.strategy_artifact,
        result.alerts_artifact,
      ].filter(Boolean) as NonNullable<DualCompilerOutput["indicator_artifact"]>[];

      for (const artifact of dualArtifacts) {
        // FIX 3: compute per-artifact SHA-256 content hash
        const { createHash } = await import("crypto");
        const artifactHash = createHash("sha256").update(artifact.content).digest("hex");
        const [row] = await db
          .insert(strategyExportArtifacts)
          .values({
            exportId,
            artifactType: artifact.artifact_type,
            fileName: artifact.file_name,
            content: artifact.content,
            sizeBytes: artifact.size_bytes,
            pineVersion: result.pine_version,
            // FIX 3: per-artifact hash
            contentHash: artifactHash,
          })
          .returning();
        artifactRows.push(row);
      }

      // 7. Audit log — FIX 4: include durationMs, contentHash, exportType
      await db.insert(auditLog).values({
        action: "pine-export.compile-dual",
        entityType: "strategy_export",
        entityId: exportId,
        input: { strategyId, firmKey, exportType: "pine_dual", correlationId },
        result: {
          exportabilityScore: result.exportability.score,
          band: result.exportability.band,
          contentHash: result.content_hash,
          indicator_file: result.indicator_artifact?.file_name,
          strategy_file: result.strategy_artifact?.file_name,
          degradation_notes: result.degradation_notes,
          artifactCount: artifactRows.length,
          // FIX 4: track duration for performance monitoring
          durationMs,
          status: "success",
        },
        status: "success",
        decisionAuthority: "human",
      });

      // 8. SSE broadcast — pine:export-completed (hyphen, frontend discriminated union)
      broadcastSSE("pine:export-completed", {
        strategyId,
        exportId,
        contentHash: result.content_hash,
        exportabilityScore: result.exportability.score,
        durationMs,
      });

      if (result.exportability.score < 70) {
        broadcastSSE("alert:triggered", {
          type: "low_exportability",
          strategyId,
          score: result.exportability.score,
          message: `Pine dual export score ${result.exportability.score}/100 — strategy may not export cleanly`,
        });
      }

      // 9. Warn if degradation notes present
      if (result.degradation_notes.length > 0) {
        broadcastSSE("alert:triggered", {
          type: "pine_export_degradation",
          strategyId,
          notes: result.degradation_notes,
          message: `Pine dual export has degradation notes: ${result.degradation_notes.join("; ")}`,
        });
      }
    }

    return {
      id: exportId,
      strategyId,
      exportType: "pine_dual",
      exportabilityScore: result.exportability.score,
      exportabilityBand: result.exportability.band,
      status: "completed",
      contentHash: result.content_hash,
      indicator_file: result.indicator_artifact?.file_name,
      strategy_file: result.strategy_artifact?.file_name,
      degradation_notes: result.degradation_notes,
      artifacts: artifactRows.map((r) => ({
        id: r.id,
        artifactType: r.artifactType,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
      })),
      exportability: result.exportability,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;

    if (persist && exportId) {
      await db
        .update(strategyExports)
        .set({ status: "failed", errorMessage: errorMsg })
        .where(eq(strategyExports.id, exportId));

      // FIX 4: audit log on failure includes durationMs
      await db.insert(auditLog).values({
        action: "pine-export.compile-dual",
        entityType: "strategy_export",
        entityId: exportId,
        input: { strategyId, firmKey, exportType: "pine_dual", correlationId },
        result: { error: errorMsg, durationMs, status: "failure" },
        status: "failure",
        decisionAuthority: "human",
        errorMessage: errorMsg,
      });
    }

    // SSE broadcast on failure — always emit regardless of persist flag
    broadcastSSE("pine:export-failed", {
      strategyId,
      errorCode: "compile_dual_failed",
      message: errorMsg,
      durationMs,
    });

    return { id: exportId, status: "failed", error: errorMsg };
  }
}

export async function compilePineExport(
  strategyId: string,
  firmKey?: string,
  exportType: string = "pine_indicator",
  injectedRiskIntelligence?: Record<string, number | string | null> | null,
  correlationId?: string,
) {
  // FIX 4: track wall-clock duration for audit_log
  const startMs = Date.now();

  // 1. Load strategy from DB
  const [strategy] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  // 2. Insert pending export row
  const [exportRow] = await db
    .insert(strategyExports)
    .values({
      strategyId,
      exportType,
      status: "compiling",
      propOverlayFirm: firmKey ?? null,
    })
    .returning();

  const exportId = exportRow.id;

  try {
    // 3. Fetch risk intelligence from MC + quantum MC runs (best-effort, non-blocking).
    //    If the caller already has MC results in scope (e.g. auto-trigger), they can inject
    //    riskIntelligence directly to skip the DB round-trip.
    let riskIntelligence: Record<string, number | string | null> | null =
      injectedRiskIntelligence ?? null;
    if (riskIntelligence === null) {
      try {
        // Find the most recent backtest for this strategy (any status — MC may exist even if bt failed)
        const [latestBacktest] = await db
          .select({ id: backtests.id })
          .from(backtests)
          .where(eq(backtests.strategyId, strategyId))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (latestBacktest) {
          // Fetch most recent classical MC run for this backtest
          const [mcRun] = await db
            .select({
              probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
              sharpeP50: monteCarloRuns.sharpeP50,
              riskMetrics: monteCarloRuns.riskMetrics,
            })
            .from(monteCarloRuns)
            .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
            .orderBy(desc(monteCarloRuns.createdAt))
            .limit(1);

          // Fetch most recent quantum MC run for this backtest
          const [quantumRun] = await db
            .select({
              estimatedValue: quantumMcRuns.estimatedValue,
              governanceLabels: quantumMcRuns.governanceLabels,
            })
            .from(quantumMcRuns)
            .where(eq(quantumMcRuns.backtestId, latestBacktest.id))
            .orderBy(desc(quantumMcRuns.createdAt))
            .limit(1);

          if (mcRun || quantumRun) {
            const rm = (mcRun?.riskMetrics as Record<string, unknown> | null) ?? {};
            const ruinProb = mcRun?.probabilityOfRuin != null ? Number(mcRun.probabilityOfRuin) : null;
            const survivalRate = ruinProb != null ? 1 - ruinProb : null;
            const breachProb = rm.breach_probability != null ? Number(rm.breach_probability) : null;
            const sharpeP50 = mcRun?.sharpeP50 != null ? Number(mcRun.sharpeP50) : null;
            const govLabels = (quantumRun?.governanceLabels as Record<string, unknown> | null) ?? {};
            const quantumEst = quantumRun?.estimatedValue != null ? Number(quantumRun.estimatedValue) : null;

            const candidate: Record<string, number | string | null> = {
              breach_probability: breachProb,
              ruin_probability: ruinProb,
              survival_rate: survivalRate,
              mc_sharpe_p50: sharpeP50,
              quantum_estimate: quantumEst,
            };
            if (govLabels.decision_role != null) {
              candidate.governance_label = govLabels.decision_role as string;
            }

            // Only include risk_intelligence if at least one numeric field is non-null
            const hasData = Object.values(candidate).some((v) => v != null);
            if (hasData) riskIntelligence = candidate;
          }
        }
      } catch (riErr) {
        // Risk intelligence is advisory — never block export on query failure
        logger.warn(
          { strategyId, err: riErr },
          "Failed to fetch risk intelligence for Pine export (non-blocking)",
        );
      }
    }

    // 4. Build config and write to temp file
    const strategyConfig = strategy.config as Record<string, unknown>;
    const config = {
      strategy: {
        ...strategyConfig,
        export_type: exportType,
      },
      firm_key: firmKey,
      ...(riskIntelligence != null ? { risk_intelligence: riskIntelligence } : {}),
    };

    const tmpPath = pathResolve(tmpdir(), `pine-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: CompilerOutput;
    try {
      // FIX 4: pass correlationId to subprocess wrapper
      result = await runPineCompiler(tmpPath, correlationId);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    const durationMs = Date.now() - startMs;

    // 5. Update export row — FIX 3: write contentHash, configSnapshot
    await db
      .update(strategyExports)
      .set({
        exportabilityScore: String(result.exportability.score),
        exportabilityDetails: result.exportability,
        status: "completed",
        pineVersion: result.pine_version,
        // FIX 3: persist content_hash so re-export drift is detectable
        contentHash: result.content_hash ?? null,
        // FIX 3: snapshot strategy config at export time
        configSnapshot: strategyConfig,
      })
      .where(eq(strategyExports.id, exportId));

    // 6. Insert artifacts — FIX 3: include contentHash per artifact
    const artifactRows = [];
    for (const artifact of result.artifacts) {
      const { createHash } = await import("crypto");
      const artifactHash = createHash("sha256").update(artifact.content).digest("hex");
      const [row] = await db
        .insert(strategyExportArtifacts)
        .values({
          exportId,
          artifactType: artifact.artifact_type,
          fileName: artifact.file_name,
          content: artifact.content,
          sizeBytes: artifact.size_bytes,
          pineVersion: result.pine_version,
          // FIX 3: per-artifact hash
          contentHash: artifactHash,
        })
        .returning();
      artifactRows.push(row);
    }

    // 7. Audit log — FIX 4: include durationMs, contentHash, correlationId
    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType, correlationId },
      result: {
        exportabilityScore: result.exportability.score,
        band: result.exportability.band,
        contentHash: result.content_hash,
        artifactCount: result.artifacts.length,
        // FIX 4: track duration for performance monitoring
        durationMs,
        status: "success",
      },
      status: "success",
      decisionAuthority: "human",
    });

    // 8. Broadcast export completion SSE — pine:export-completed (hyphen, frontend discriminated union)
    broadcastSSE("pine:export-completed", {
      strategyId,
      exportId,
      contentHash: result.content_hash,
      exportabilityScore: result.exportability.score,
      durationMs,
    });

    // Broadcast SSE alert if exportability score is low
    if (result.exportability.score < 70) {
      broadcastSSE("alert:triggered", {
        type: "low_exportability",
        strategyId,
        score: result.exportability.score,
        message: `Pine export score ${result.exportability.score}/100 — strategy may not export cleanly`,
      });
    }

    return {
      id: exportId,
      strategyId,
      exportType,
      exportabilityScore: result.exportability.score,
      exportabilityBand: result.exportability.band,
      status: "completed",
      contentHash: result.content_hash,
      artifacts: artifactRows.map((r) => ({
        id: r.id,
        artifactType: r.artifactType,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
      })),
      exportability: result.exportability,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startMs;

    await db
      .update(strategyExports)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(strategyExports.id, exportId));

    // FIX 4: audit log on failure includes durationMs
    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType, correlationId },
      result: { error: errorMsg, durationMs, status: "failure" },
      status: "failure",
      decisionAuthority: "human",
      errorMessage: errorMsg,
    });

    // SSE broadcast on failure
    broadcastSSE("pine:export-failed", {
      strategyId,
      errorCode: "compile_failed",
      message: errorMsg,
      durationMs,
    });

    return { id: exportId, status: "failed", error: errorMsg };
  }
}

export async function getExport(exportId: string) {
  const [exportRow] = await db
    .select()
    .from(strategyExports)
    .where(eq(strategyExports.id, exportId));
  return exportRow ?? null;
}

export async function getExportArtifacts(exportId: string) {
  return db
    .select()
    .from(strategyExportArtifacts)
    .where(eq(strategyExportArtifacts.exportId, exportId));
}

export async function getArtifact(artifactId: string) {
  const [artifact] = await db
    .select()
    .from(strategyExportArtifacts)
    .where(eq(strategyExportArtifacts.id, artifactId));
  return artifact ?? null;
}
