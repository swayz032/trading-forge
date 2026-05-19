/**
 * Graveyard Intelligence Service — extracts failure patterns from dead strategies.
 *
 * Clusters graveyard embeddings via Python DBSCAN, generates avoidance guidance,
 * and stores it in system_parameters for injection into the strategy proposer prompt.
 */

import { db } from "../db/index.js";
import { strategyGraveyard, systemParameters } from "../db/schema.js";
import { eq, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";

interface ClusterResult {
  cluster_id: number;
  cluster_name: string;
  count: number;
  failure_modes: Record<string, number>;
  failure_categories: Record<string, number>;
  avg_severity: number;
  member_ids: string[];
}

export async function extractFailurePatterns(): Promise<{
  clusterCount: number;
  totalEntries: number;
  patterns: string;
}> {
  // Fetch graveyard entries with embeddings
  const entries = await db
    .select({
      id: strategyGraveyard.id,
      embedding: strategyGraveyard.embedding,
      failureModes: strategyGraveyard.failureModes,
      failureCategory: strategyGraveyard.failureCategory,
      failureSeverity: strategyGraveyard.failureSeverity,
    })
    .from(strategyGraveyard)
    .where(isNotNull(strategyGraveyard.embedding));

  if (entries.length < 3) {
    logger.info(
      { count: entries.length },
      "Not enough graveyard entries for clustering (need 3+)",
    );
    return { clusterCount: 0, totalEntries: entries.length, patterns: "" };
  }

  // Prepare entries for Python — failureSeverity is numeric (string from DB), cast to float
  const pythonEntries = entries.map((e) => ({
    id: e.id,
    embedding: e.embedding,
    failureModes: e.failureModes,
    failureCategory: e.failureCategory,
    failureSeverity: e.failureSeverity ? Number(e.failureSeverity) : 0.5,
  }));

  // Run Python clustering
  let clusters: ClusterResult[];

  try {
    clusters = await runPythonModule<ClusterResult[]>({
      module: "src.engine.graveyard.cluster",
      config: { entries: pythonEntries },
      componentName: "graveyard-cluster",
      timeoutMs: 120_000,
    });
  } catch (err) {
    logger.error({ err }, "Graveyard clustering failed");
    return { clusterCount: 0, totalEntries: entries.length, patterns: "" };
  }

  if (!Array.isArray(clusters) || clusters.length === 0) {
    logger.warn("Graveyard clustering returned empty result");
    return { clusterCount: 0, totalEntries: entries.length, patterns: "" };
  }

  // Generate avoidance patterns text for prompt injection
  const patternLines: string[] = [
    `# Strategy Failure Patterns (${entries.length} dead strategies analyzed)`,
    "",
  ];

  for (const cluster of clusters) {
    if (cluster.cluster_id === -1) continue; // Skip DBSCAN noise points

    const topModes = Object.entries(cluster.failure_modes).slice(0, 5);
    const topCategories = Object.entries(cluster.failure_categories).slice(0, 3);

    patternLines.push(
      `## Cluster ${cluster.cluster_id} (${cluster.count} strategies, avg severity ${cluster.avg_severity.toFixed(2)})`,
    );
    patternLines.push(
      `Common failure modes: ${topModes.map(([m, c]) => `${m} (${c}x)`).join(", ")}`,
    );
    if (topCategories.length > 0) {
      patternLines.push(
        `Categories: ${topCategories.map(([c, n]) => `${c} (${n}x)`).join(", ")}`,
      );
    }
    patternLines.push("AVOID: Strategies matching this failure pattern.");
    patternLines.push("");
  }

  const patternsText = patternLines.join("\n");

  // Upsert into system_parameters
  // Use description field for the full patterns text, currentValue as a version counter
  const paramName = "graveyard_avoidance_patterns";

  const [existing] = await db
    .select()
    .from(systemParameters)
    .where(eq(systemParameters.paramName, paramName))
    .limit(1);

  if (existing) {
    // Update: bump version, refresh description with latest patterns
    const nextVersion = String(Number(existing.currentValue) + 1);
    await db
      .update(systemParameters)
      .set({
        currentValue: nextVersion,
        description: patternsText,
        updatedAt: new Date(),
      })
      .where(eq(systemParameters.id, existing.id));
  } else {
    // Insert fresh
    await db.insert(systemParameters).values({
      paramName,
      domain: "strategy_proposer",
      currentValue: "1",
      description: patternsText,
    });
  }

  logger.info(
    { clusterCount: clusters.length, totalEntries: entries.length },
    "Graveyard failure patterns extracted and stored",
  );

  return {
    clusterCount: clusters.length,
    totalEntries: entries.length,
    patterns: patternsText,
  };
}

/**
 * Get avoidance patterns for prompt injection.
 * Returns the patterns text or null if not yet extracted.
 */
export async function getAvoidancePatterns(): Promise<string | null> {
  const [param] = await db
    .select()
    .from(systemParameters)
    .where(eq(systemParameters.paramName, "graveyard_avoidance_patterns"))
    .limit(1);

  return param?.description ?? null;
}

/**
 * Generate a structured failure mode report and persist it in system_parameters
 * for nightly critique consumption. Builds on extractFailurePatterns() output
 * and stores in a separate param key so the nightly critique can inject it.
 */
export async function generateFailureModeReport(): Promise<string> {
  const { clusterCount, patterns } = await extractFailurePatterns();

  if (clusterCount === 0) return "No failure patterns detected yet.";

  // Persist the report in system_parameters under a dedicated key for nightly critique
  const paramName = "graveyard_meta_learning_report";
  const [existing] = await db
    .select()
    .from(systemParameters)
    .where(eq(systemParameters.paramName, paramName))
    .limit(1);

  if (existing) {
    const nextVersion = String(Number(existing.currentValue) + 1);
    await db
      .update(systemParameters)
      .set({
        currentValue: nextVersion,
        description: patterns,
        updatedAt: new Date(),
      })
      .where(eq(systemParameters.id, existing.id));
  } else {
    await db.insert(systemParameters).values({
      paramName,
      domain: "nightly_critique",
      currentValue: "1",
      description: patterns,
    });
  }

  logger.info({ clusterCount }, "Graveyard meta-learning report generated and persisted");
  return patterns;
}
