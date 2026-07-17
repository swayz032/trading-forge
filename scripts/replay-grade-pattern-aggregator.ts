/**
 * Wave 27 Pass 3.G1 — Pattern Aggregator Appendix Improvement Replay Grading Harness
 *
 * Answers: did the appendix output from pattern-aggregator ACTUALLY improve subsequent
 * strategy generation? When the aggregator produced a parameter_hint that was applied
 * to strategy_proposer prompt, did next-generation strategies have higher rolling Sharpe?
 *
 * CLI:
 *   npx tsx scripts/replay-grade-pattern-aggregator.ts             # dry-run (stdout only)
 *   npx tsx scripts/replay-grade-pattern-aggregator.ts --apply     # writes markdown to docs/replay-results/
 *   npx tsx scripts/replay-grade-pattern-aggregator.ts --limit N   # limit to N strategies
 *
 * Architecture:
 *   1. Query prompt_versions WHERE prompt_type='strategy_proposer' for appendix history
 *   2. Query lifecycle_transitions WHERE decision_authority='agent' for generated strategies
 *   3. Join to determine which strategies were generated under each appendix version
 *   4. Query paper_trades for rolling 30d Sharpe per strategy
 *   5. Run Spearman + Mann-Whitney analysis
 *   6. Emit verdict SIGNAL / INCONCLUSIVE / NO_SIGNAL / PRELIMINARY
 *
 * Pure-function library: src/server/lib/replay/pattern-aggregator-disagreement.ts
 *
 * Governance:
 *   - DOES NOT modify pattern-aggregator-service.ts
 *   - DOES NOT modify prompt_versions rows
 *   - DOES NOT modify lifecycle_transitions
 *   - Read-only by construction, not by a dryRun flag: this harness imports NO
 *     production service (see imports below — only the pure-function
 *     src/server/lib/replay/pattern-aggregator-disagreement.ts library, plus
 *     logger/fs/postgres). It reads PERSISTED `prompt_versions` +
 *     `lifecycle_transitions` + `paper_trades` columns and correlates
 *     historical outcomes; it does NOT invoke or re-execute
 *     pattern-aggregator-service.ts's CURRENT aggregation logic. (deep-scan
 *     Replay-F3, 2026-07-17 — a prior revision of this doc overstated a
 *     "passes dryRun=true through to the service" behavior that does not
 *     exist in this file; corrected here. Practical effect: if the live
 *     appendix-aggregation logic changed after a graded generation ran, this
 *     harness's history reflects the OLD logic, not today's — it cannot
 *     detect that kind of logic-vs-history drift.)
 *   - audit_log INSERTs merge into result jsonb only
 *   - Exit 0 on success; exit 1 only on DB error
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  evaluatePatternAggregatorSignal,
  buildPatternAggregatorMarkdownReport,
  computeSharpe,
  type AppendixVersion,
  type GeneratedStrategy,
  type PatternAggregatorAnalysisResult,
  MIN_VERSIONS_FOR_FULL_ANALYSIS,
  MIN_STRATEGIES_PER_VERSION,
} from "../src/server/lib/replay/pattern-aggregator-disagreement.js";

// ─── Rolling Sharpe window ────────────────────────────────────────────────────

const ROLLING_SHARPE_DAYS = 30;

// ─── DB analysis pipeline ─────────────────────────────────────────────────────

/**
 * Core analysis function. Accepts a raw postgres SQL client.
 * Exported for integration testing.
 */
export async function runPatternAggregatorAnalysis(
  sql: ReturnType<typeof postgres>,
  limitStrategies?: number,
): Promise<PatternAggregatorAnalysisResult> {
  // Step 1: load prompt_versions for strategy_proposer
  const rawVersions = await sql<
    Array<{
      id: string;
      version: number;
      created_at: Date;
      is_active: boolean;
    }>
  >`
    SELECT
      id,
      version,
      created_at,
      is_active
    FROM prompt_versions
    WHERE prompt_type = 'strategy_proposer'
    ORDER BY version ASC
  `;

  logger.info(
    { count: rawVersions.length },
    "replay-grade-pattern-aggregator: prompt_versions loaded",
  );

  if (rawVersions.length === 0) {
    logger.warn(
      "replay-grade-pattern-aggregator: no prompt_versions found for strategy_proposer",
    );
    return evaluatePatternAggregatorSignal([], [], new Map());
  }

  const versions: AppendixVersion[] = rawVersions.map((v) => ({
    versionId: v.id,
    versionIndex: v.version,
    activatedAt: v.created_at,
  }));

  // Step 2: load lifecycle_transitions for agent-generated strategies
  // decision_authority='agent' + transition from CANDIDATE indicates agent-generated
  const rawTransitions = await sql<
    Array<{
      strategy_id: string;
      created_at: Date;
    }>
  >`
    SELECT
      strategy_id,
      created_at
    FROM lifecycle_transitions
    WHERE decision_authority = 'agent'
      AND from_state = 'CANDIDATE'
      AND strategy_id IS NOT NULL
    ORDER BY created_at ASC
  `;

  logger.info(
    { count: rawTransitions.length },
    "replay-grade-pattern-aggregator: agent lifecycle_transitions loaded",
  );

  if (rawTransitions.length === 0) {
    logger.warn(
      "replay-grade-pattern-aggregator: no agent-generated strategies found in lifecycle_transitions",
    );
    return evaluatePatternAggregatorSignal(versions, [], new Map());
  }

  // Deduplicate strategies — keep earliest transition per strategy
  const strategyMap = new Map<string, Date>();
  for (const t of rawTransitions) {
    if (!t.strategy_id) continue;
    const existing = strategyMap.get(t.strategy_id);
    if (!existing || t.created_at < existing) {
      strategyMap.set(t.strategy_id, t.created_at);
    }
  }

  let strategyIds = [...strategyMap.keys()];
  if (limitStrategies != null) {
    strategyIds = strategyIds.slice(0, limitStrategies);
  }

  // We need to attribute strategies to appendix versions. We use generatedAt
  // to find the most recent version that was active at that time.
  // In the absence of activated_at column, we use created_at as proxy for
  // when the version became live.
  const strategies: GeneratedStrategy[] = strategyIds.map((strategyId) => {
    const generatedAt = strategyMap.get(strategyId)!;
    // Find the most recent version created before this strategy
    let best: AppendixVersion | null = null;
    for (const v of versions) {
      if (v.activatedAt <= generatedAt) {
        best = v;
      }
    }
    return {
      strategyId,
      appendixVersionId: best?.versionId ?? versions[0].versionId,
      appendixVersionIndex: best?.versionIndex ?? versions[0].versionIndex,
      generatedAt,
    };
  });

  logger.info(
    { total: strategyIds.length, attributed: strategies.length },
    "replay-grade-pattern-aggregator: strategies attributed to appendix versions",
  );

  // Step 3: load rolling 30d Sharpe from paper_trades per strategy
  // Join via paper_sessions → paper_trades
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ROLLING_SHARPE_DAYS);

  const rawTrades = await sql<
    Array<{
      strategy_id: string;
      pnl: string;
    }>
  >`
    SELECT
      ps.strategy_id,
      pt.pnl
    FROM paper_trades pt
    JOIN paper_sessions ps ON ps.id = pt.session_id
    WHERE ps.strategy_id = ANY(${strategyIds})
      AND pt.exit_time >= ${cutoffDate}
      AND pt.pnl IS NOT NULL
    ORDER BY ps.strategy_id, pt.exit_time ASC
  `;

  logger.info(
    { count: rawTrades.length, strategyCount: strategyIds.length },
    "replay-grade-pattern-aggregator: paper_trades loaded for Sharpe computation",
  );

  // Group PnLs by strategy_id
  const pnlsByStrategy = new Map<string, number[]>();
  for (const trade of rawTrades) {
    if (!trade.strategy_id) continue;
    const pnl = parseFloat(trade.pnl);
    if (!isFinite(pnl)) continue;
    if (!pnlsByStrategy.has(trade.strategy_id)) {
      pnlsByStrategy.set(trade.strategy_id, []);
    }
    pnlsByStrategy.get(trade.strategy_id)!.push(pnl);
  }

  // Compute Sharpe per strategy
  const sharpeByStrategy = new Map<string, number>();
  for (const [strategyId, pnls] of pnlsByStrategy) {
    sharpeByStrategy.set(strategyId, computeSharpe(pnls));
  }

  logger.info(
    {
      strategiesWithPnl: pnlsByStrategy.size,
      strategiesWithSharpe: sharpeByStrategy.size,
      totalStrategies: strategyIds.length,
      linkedPct:
        strategyIds.length > 0
          ? ((sharpeByStrategy.size / strategyIds.length) * 100).toFixed(1) +
            "%"
          : "0%",
    },
    "replay-grade-pattern-aggregator: Sharpe data join quality",
  );

  // Step 4: run analysis
  const result = evaluatePatternAggregatorSignal(
    versions,
    strategies,
    sharpeByStrategy,
  );

  // Step 5: log audit entries
  for (const entry of result.auditEntries) {
    if (entry.level === "warn") {
      logger.warn(
        entry.data ?? {},
        `replay-grade-pattern-aggregator: ${entry.message}`,
      );
    } else {
      logger.info(
        entry.data ?? {},
        `replay-grade-pattern-aggregator: ${entry.message}`,
      );
    }
  }

  return result;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode = args.includes("--apply");
  const limitIdx = args.indexOf("--limit");
  const limitStrategies =
    limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;

  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0];

  console.log(
    "=== REPLAY-GRADE-PATTERN-AGGREGATOR — Wave 27 Pass 3.G1 Appendix Improvement Signal Test ===",
  );
  if (!applyMode) {
    console.log(
      "(Dry-run mode: no markdown file written. Pass --apply to write report.)",
    );
  }
  if (limitStrategies !== undefined) {
    console.log(`(Limit mode: analyzing at most ${limitStrategies} strategies)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: PatternAggregatorAnalysisResult;
  try {
    analysis = await runPatternAggregatorAnalysis(sql, limitStrategies);
  } catch (err) {
    logger.error(
      { err },
      "replay-grade-pattern-aggregator: DB error during analysis",
    );
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  const report = buildPatternAggregatorMarkdownReport(analysis, isoDate);

  // Always print to stdout
  console.log(report);

  // Summary block
  console.log("=== Summary ===");
  console.log(
    `Prompt versions queried            : ${analysis.totalVersionsQueried}`,
  );
  console.log(
    `Qualifying versions (≥${MIN_STRATEGIES_PER_VERSION} strategies) : ${analysis.qualifyingVersions}`,
  );
  console.log(
    `Total strategies attributed        : ${analysis.totalStrategiesAttributed}`,
  );
  console.log(
    `Strategies with Sharpe data        : ${analysis.strategiesWithSharpe}`,
  );
  console.log(
    `Spearman ρ                         : ${analysis.spearmanRho.toFixed(4)}`,
  );
  console.log(
    `Spearman p-value                   : ${analysis.spearmanPValue.toFixed(4)}`,
  );
  console.log(
    `Consecutive pairs                  : ${analysis.consecutivePairs.length}`,
  );
  console.log(
    `Improvement rate (raw avg Sharpe)  : ${(analysis.improvementRate * 100).toFixed(1)}%`,
  );
  console.log(`Verdict                            : ${analysis.verdict}`);
  console.log(
    `Preliminary (< ${MIN_VERSIONS_FOR_FULL_ANALYSIS} versions)         : ${analysis.isPreliminary}`,
  );
  console.log();

  if (analysis.qualifyingVersions === 0) {
    console.log(
      `[INFO] No qualifying appendix versions found (all have < ${MIN_STRATEGIES_PER_VERSION} attributed strategies).`,
    );
    console.log(
      `       This is expected early in the pattern-aggregator lifecycle.`,
    );
    console.log(
      `       Re-run after the auto-patch loop has produced more strategies per version.`,
    );
    console.log();
  }

  if (applyMode) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, "..");
    const outputPath = path.join(
      repoRoot,
      "docs",
      "replay-results",
      `${isoDate}-pattern-aggregator-disagreement.md`,
    );

    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, report, "utf8");
      console.log(`[APPLY] Report written to: ${outputPath}`);
    } catch (writeErr) {
      console.error(`[ERROR] Failed to write report: ${writeErr}`);
      process.exit(1);
    }
  } else {
    console.log(
      "[DRY-RUN] No file written. Pass --apply to write report.",
    );
  }

  process.exit(0);
}

main();
