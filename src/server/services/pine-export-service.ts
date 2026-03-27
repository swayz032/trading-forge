import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyExports, strategyExportArtifacts, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
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
    // 3. Build config and write to temp file
    const config = {
      strategy: strategy.config,
      firm_key: firmKey,
    };

    const tmpPath = pathResolve(tmpdir(), `pine-config-${randomUUID()}.json`);
    writeFileSync(tmpPath, JSON.stringify(config));

    let result: CompilerOutput;
    try {
      result = await runPineCompiler(tmpPath);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // 4. Update export row with results
    await db
      .update(strategyExports)
      .set({
        exportabilityScore: String(result.exportability.score),
        exportabilityDetails: result.exportability,
        status: "completed",
        pineVersion: result.pine_version,
      })
      .where(eq(strategyExports.id, exportId));

    // 5. Insert artifacts
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

    // 6. Audit log
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
    });

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
