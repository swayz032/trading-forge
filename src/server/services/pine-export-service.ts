import { spawn } from "child_process";
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

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

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

function runPineCompiler(configPath: string): Promise<CompilerOutput> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", "src.engine.pine_compiler", "--input-json", configPath];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    const TIMEOUT_MS = 60_000;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(new Error(`Pine compiler timed out after ${TIMEOUT_MS / 1000}s`));
      }
    }, TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "pine-compiler" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
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
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

export async function compilePineExport(
  strategyId: string,
  firmKey?: string,
  exportType: string = "pine_indicator",
  injectedRiskIntelligence?: Record<string, number | string | null> | null,
) {
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
    const config = {
      strategy: {
        ...strategy.config as Record<string, unknown>,
        export_type: exportType,
      },
      firm_key: firmKey,
      ...(riskIntelligence != null ? { risk_intelligence: riskIntelligence } : {}),
    };

    const tmpPath = pathResolve(tmpdir(), `pine-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: CompilerOutput;
    try {
      result = await runPineCompiler(tmpPath);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // 5. Update export row with results
    await db
      .update(strategyExports)
      .set({
        exportabilityScore: String(result.exportability.score),
        exportabilityDetails: result.exportability,
        status: "completed",
        pineVersion: result.pine_version,
      })
      .where(eq(strategyExports.id, exportId));

    // 6. Insert artifacts
    const artifactRows = [];
    for (const artifact of result.artifacts) {
      const [row] = await db
        .insert(strategyExportArtifacts)
        .values({
          exportId,
          artifactType: artifact.artifact_type,
          fileName: artifact.file_name,
          content: artifact.content,
          sizeBytes: artifact.size_bytes,
          pineVersion: result.pine_version,
        })
        .returning();
      artifactRows.push(row);
    }

    // 7. Audit log
    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType },
      result: {
        exportabilityScore: result.exportability.score,
        band: result.exportability.band,
        artifactCount: result.artifacts.length,
      },
      status: "success",
      decisionAuthority: "human",
    });

    // 8. Broadcast export completion SSE
    broadcastSSE("pine:export_completed", {
      strategyId,
      exportId,
      score: result.exportability.score,
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

    await db
      .update(strategyExports)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(strategyExports.id, exportId));

    await db.insert(auditLog).values({
      action: "pine-export.compile",
      entityType: "strategy_export",
      entityId: exportId,
      input: { strategyId, firmKey, exportType },
      result: { error: errorMsg },
      status: "failure",
      decisionAuthority: "human",
      errorMessage: errorMsg,
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
