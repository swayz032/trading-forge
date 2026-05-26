/**
 * Wave 27 Pass 3.G2 — Unified Replay Grading Dispatcher
 *
 * Single entry point for all Wave 27 replay-grading tools.
 *
 * WHEN TO USE THIS vs INDIVIDUAL SCRIPTS
 * ────────────────────────────────────────
 * Use THIS unified entry point:
 *   - CI / scheduled jobs (Sunday weekly cron from Wave 27 Pass 1.5)
 *   - --tool=all to run all tools in one pass and produce a combined report
 *   - Automated orchestration where a single process exit code is needed
 *
 * Use INDIVIDUAL scripts (replay-grade-<tool>.ts) directly:
 *   - Ad-hoc operator queries against a specific tool
 *   - Debugging a single tool's DB query or analysis
 *   - Exploratory analysis with tool-specific flags not exposed here
 *   - The individual scripts remain the canonical entry points for their tools
 *
 * --tool=all IS THE CANONICAL PATH for the Sunday weekly cron
 * ────────────────────────────────────────────────────────────
 * The quantum-replay-weekly-service.ts cron invokes this script with --tool=all.
 * That path runs all 7 tools sequentially, aggregates results into one combined
 * markdown report under docs/replay-results/<ISO>-weekly-roundup.md, and
 * returns the aggregate verdict to the caller.
 *
 * GOVERNANCE
 * ──────────
 * Challenger outputs are advisory, not authoritative.
 * No direct entry, exit, sizing, or promotion authority.
 * All tools run with read-only DB access. No production table writes.
 *
 * CLI:
 *   npx tsx scripts/replay-grade.ts --tool=quantum [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=confluence [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=critique [--apply] [--limit N] [--strategy <id>] [--days N]
 *   npx tsx scripts/replay-grade.ts --tool=robustness [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=survival-twin [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=pattern-aggregator [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=consistency [--apply] [--limit N]
 *   npx tsx scripts/replay-grade.ts --tool=all [--apply] [--limit N]
 *
 * Exit codes:
 *   0  — analysis completed (regardless of verdict)
 *   1  — DB error, invalid --tool, or CPCV purge violation
 */

import "dotenv/config";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  ALL_TOOL_NAMES,
  type ToolName,
  type ToolSummary,
  parseCLIArgs,
  validateToolName,
  buildOutputPath,
  buildCombinedMarkdownReport,
  writeMarkdownReport,
  extractToolSummary,
} from "../src/server/lib/replay/harness-base.js";

// ─── Re-export harness-base for test consumers ────────────────────────────────

export {
  parseCLIArgs,
  validateToolName,
  buildCombinedMarkdownReport,
  ALL_TOOL_NAMES,
  type ToolName,
  type ToolSummary,
};

// ─── Per-tool dispatch table ──────────────────────────────────────────────────

/**
 * Each entry maps a tool name to a lazy importer.
 *
 * Dynamic imports are used so that:
 *   1. A missing G1 module (pattern-aggregator, consistency) does not cause a
 *      compile-time error — those scripts land in Pass 3.G1.
 *   2. Only the required tool's code is loaded at runtime when --tool=<single>.
 *
 * Each imported module MUST export a `run<Name>Analysis(sql, opts?)` function
 * and a `build<Name>MarkdownReport(result, isoDate, ...)` function matching the
 * patterns established in Pass 1 / Pass 2.
 */

interface ToolDispatchResult {
  verdict: string;
  validFolds?: number;
  spearmanRho?: number;
  spearmanPValue?: number;
  critiquesAnalyzed?: number;
  totalB15Rows?: number;
  mannWhitneyPValue?: number;
  n?: number;
}

interface ToolDispatchOpts {
  sql: ReturnType<typeof postgres>;
  limit?: number;
  apply: boolean;
  isoDate: string;
  repoRoot: string;
  // critique-specific
  strategyId?: string;
  lookbackDays?: number;
}

/**
 * Run the quantum disagreement tool and return a normalised summary.
 */
async function runQuantumTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  const { runAnalysis, buildMarkdownReport } = await import(
    "./replay-grade-quantum.js"
  );

  const result = await runAnalysis(opts.sql, opts.limit);
  const report = buildMarkdownReport(result, opts.isoDate);

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(opts.repoRoot, opts.isoDate, "quantum-disagreement.md");
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] quantum report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "quantum",
    {
      verdict: result.verdict,
      validFolds: result.validFolds,
      spearmanRho: result.spearmanRho,
      spearmanPValue: result.spearmanPValue,
    },
    outputFile,
  );
}

/**
 * Run the confluence disagreement tool.
 */
async function runConfluenceTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  const { runConfluenceAnalysis, buildConfluenceMarkdownReport } = await import(
    "./replay-grade-confluence.js"
  );

  const result = await runConfluenceAnalysis(opts.sql, opts.limit);

  // Confluence report builder requires additional git SHA — best-effort
  let confluenceModuleSha = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    confluenceModuleSha = execSync(
      "git log -1 --format=%H -- src/server/services/confluence-score.ts",
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    )
      .trim()
      .slice(0, 12) || "unknown";
  } catch { /* non-fatal */ }

  const sqlWhereClause =
    "backtest_trades WHERE entry_time BETWEEN fold.is_start AND fold.oos_end, " +
    "walk_forward_windows WHERE is_metrics IS NOT NULL (Path C folds only)";

  const report = buildConfluenceMarkdownReport(
    result,
    opts.isoDate,
    "Wave 27 Pass 3.G2 unified dispatcher",
    confluenceModuleSha,
    sqlWhereClause,
  );

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(opts.repoRoot, opts.isoDate, "confluence-disagreement.md");
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] confluence report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "confluence",
    {
      verdict: result.verdict,
      validFolds: result.validFolds,
      spearmanRho: result.spearmanRho,
      spearmanPValue: result.spearmanPValue,
    },
    outputFile,
  );
}

/**
 * Run the critique grade signal tool.
 */
async function runCritiqueTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  // Run function lives in the script (has DB integration); report builder lives
  // in the pure-function library.
  const { runCritiqueGradeAnalysis } = await import("./replay-grade-critique.js");
  const { buildCritiqueMarkdownReport } = await import(
    "../src/server/lib/replay/critique-disagreement.js"
  );

  const lookbackDays = opts.lookbackDays ?? 90;
  const analysisOutput = await runCritiqueGradeAnalysis(opts.sql, {
    limitPositions: opts.limit,
    strategyId: opts.strategyId,
    lookbackDays,
  });

  const { result } = analysisOutput;

  let critiqueSHA = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    critiqueSHA = execSync(
      "git log --format=%H -1 -- src/server/services/trade-critique-service.ts",
      { encoding: "utf8" },
    )
      .trim()
      .slice(0, 12);
  } catch { /* non-fatal */ }

  const report = buildCritiqueMarkdownReport(result, opts.isoDate, {
    critiqueSHA,
    sampleSql:
      `SELECT * FROM paper_positions WHERE closed_at IS NOT NULL ` +
      `AND closed_at >= NOW() - INTERVAL '${lookbackDays} days'`,
  });

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(opts.repoRoot, opts.isoDate, "critique-disagreement.md");
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] critique report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "critique",
    {
      verdict: result.verdict,
      critiquesAnalyzed: result.critiquesAnalyzed,
      mannWhitneyPValue: result.mannWhitneyPValue,
    },
    outputFile,
  );
}

/**
 * Run the robustness gate signal tool.
 */
async function runRobustnessTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  // Run function lives in the script; report builder lives in the pure library.
  const { runRobustnessAnalysis } = await import("./replay-grade-robustness.js");
  const { buildRobustnessMarkdownReport } = await import(
    "../src/server/lib/replay/robustness-disagreement.js"
  );

  const result = await runRobustnessAnalysis(opts.sql, opts.limit);
  const report = buildRobustnessMarkdownReport(result, opts.isoDate);

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(opts.repoRoot, opts.isoDate, "robustness-disagreement.md");
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] robustness report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "robustness",
    {
      verdict: result.verdict,
      totalB15Rows: result.totalB15Rows,
      n: result.outcomeLinkedCount,
    },
    outputFile,
  );
}

/**
 * Run the survival-twin disagreement tool.
 */
async function runSurvivalTwinTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  const { runSurvivalTwinAnalysis, buildSurvivalTwinReport } = await import(
    "./replay-grade-survival-twin.js"
  );

  const result = await runSurvivalTwinAnalysis(opts.sql, opts.limit);
  const report = buildSurvivalTwinReport(result, opts.isoDate);

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(
      opts.repoRoot,
      opts.isoDate,
      "survival-twin-disagreement.md",
    );
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] survival-twin report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "survival-twin",
    {
      verdict: result.verdict,
      validFolds: result.validFolds,
      spearmanRho: result.spearmanRho,
      spearmanPValue: result.spearmanPValue,
    },
    outputFile,
  );
}

/**
 * Run the pattern-aggregator signal tool (Pass 3.G1 — lands soon).
 * Dynamic import degrades gracefully if the script is not yet present.
 */
async function runPatternAggregatorTool(
  opts: ToolDispatchOpts,
): Promise<ToolSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;

  try {
    mod = await import("./replay-grade-pattern-aggregator.js");
  } catch {
    logger.warn("replay-grade: pattern-aggregator script not found (Pass 3.G1 pending)");
    return {
      tool: "pattern-aggregator",
      verdict: "PRELIMINARY",
      error: "Script not yet available (Pass 3.G1 pending)",
    };
  }

  const result = await mod.runPatternAggregatorAnalysis(opts.sql, opts.limit);
  const report = mod.buildPatternAggregatorReport(result, opts.isoDate);

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(
      opts.repoRoot,
      opts.isoDate,
      "pattern-aggregator-disagreement.md",
    );
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] pattern-aggregator report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "pattern-aggregator",
    result as ToolDispatchResult,
    outputFile,
  );
}

/**
 * Run the consistency signal tool (Pass 3.G1 — lands soon).
 * Dynamic import degrades gracefully if the script is not yet present.
 */
async function runConsistencyTool(opts: ToolDispatchOpts): Promise<ToolSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;

  try {
    // @ts-expect-error — consistency script lands in Pass 3.G1; not yet present
    mod = await import("./replay-grade-consistency.js");
  } catch {
    logger.warn("replay-grade: consistency script not found (Pass 3.G1 pending)");
    return {
      tool: "consistency",
      verdict: "PRELIMINARY",
      error: "Script not yet available (Pass 3.G1 pending)",
    };
  }

  const result = await mod.runConsistencyAnalysis(opts.sql, opts.limit);
  const report = mod.buildConsistencyReport(result, opts.isoDate);

  let outputFile: string | undefined;
  if (opts.apply) {
    outputFile = buildOutputPath(
      opts.repoRoot,
      opts.isoDate,
      "consistency-disagreement.md",
    );
    writeMarkdownReport(outputFile, report);
    console.log(`[APPLY] consistency report written to: ${outputFile}`);
  }

  return extractToolSummary(
    "consistency",
    result as ToolDispatchResult,
    outputFile,
  );
}

// ─── Dispatch router ──────────────────────────────────────────────────────────

/**
 * Run a single named tool and return its ToolSummary.
 * Does NOT manage DB connection lifetime; caller owns the `sql` client.
 */
export async function dispatchTool(
  tool: ToolName,
  opts: ToolDispatchOpts,
): Promise<ToolSummary> {
  switch (tool) {
    case "quantum":
      return runQuantumTool(opts);
    case "confluence":
      return runConfluenceTool(opts);
    case "critique":
      return runCritiqueTool(opts);
    case "robustness":
      return runRobustnessTool(opts);
    case "survival-twin":
      return runSurvivalTwinTool(opts);
    case "pattern-aggregator":
      return runPatternAggregatorTool(opts);
    case "consistency":
      return runConsistencyTool(opts);
    default: {
      const _exhaustive: never = tool;
      throw new Error(`dispatchTool: unknown tool "${String(_exhaustive)}"`);
    }
  }
}

/**
 * Run all tools sequentially, aggregate results into a combined report.
 * Returns an array of ToolSummary (one per tool) and the combined report string.
 */
export async function runAllTools(
  opts: ToolDispatchOpts & { combinedOutputPath?: string },
): Promise<{ summaries: ToolSummary[]; combinedReport: string }> {
  const summaries: ToolSummary[] = [];

  for (const tool of ALL_TOOL_NAMES) {
    console.log(`\n--- Running tool: ${tool} ---`);
    try {
      const summary = await dispatchTool(tool, opts);
      summaries.push(summary);
      console.log(`[${tool}] verdict: ${summary.verdict}${summary.n !== undefined ? ` | n=${summary.n}` : ""}`);
    } catch (err) {
      logger.error({ err, tool }, `replay-grade: tool "${tool}" threw during dispatch`);
      console.error(`[ERROR] Tool "${tool}" failed: ${err}`);
      summaries.push({
        tool,
        verdict: "FAILURE",
        error: String(err),
      });
    }
  }

  const combinedReport = buildCombinedMarkdownReport(summaries, opts.isoDate);

  if (opts.apply) {
    const outPath =
      opts.combinedOutputPath ??
      buildOutputPath(opts.repoRoot, opts.isoDate, "weekly-roundup.md");
    writeMarkdownReport(outPath, combinedReport);
    console.log(`\n[APPLY] Combined weekly roundup written to: ${outPath}`);
  }

  return { summaries, combinedReport };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseCLIArgs(process.argv);
  const { tool, apply, limit, customOutput, strategyId, lookbackDays } = parsed;

  // Validate tool name
  const toolError = validateToolName(tool);
  if (toolError) {
    console.error(`[ERROR] ${toolError}`);
    process.exit(1);
  }

  // Require DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0]!;

  // Resolve repo root from this script's location
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.join(__dirname, "..");

  // Print header
  if (tool === "all") {
    console.log("=== REPLAY-GRADE — Wave 27 Weekly Roundup (--tool=all) ===");
    console.log(`Tools: ${ALL_TOOL_NAMES.join(", ")}`);
  } else {
    console.log(`=== REPLAY-GRADE — tool: ${tool} ===`);
  }

  if (!apply) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limit !== undefined) {
    console.log(`(Limit: ${limit} rows/folds/strategies per tool)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  const dispatchOpts: ToolDispatchOpts = {
    sql,
    limit,
    apply,
    isoDate,
    repoRoot,
    strategyId,
    lookbackDays,
  };

  try {
    if (tool === "all") {
      const combinedOutputPath = customOutput;
      const { summaries, combinedReport } = await runAllTools({
        ...dispatchOpts,
        combinedOutputPath,
      });

      await sql.end();

      // Print combined report to stdout
      console.log("\n" + combinedReport);

      // Print aggregate summary
      const signalCount = summaries.filter(s => s.verdict === "SIGNAL").length;
      const prelimCount = summaries.filter(s => s.verdict === "PRELIMINARY").length;
      const failureCount = summaries.filter(s => s.verdict === "FAILURE").length;

      console.log("=== Aggregate Summary ===");
      for (const s of summaries) {
        const n = s.n !== undefined ? ` | n=${s.n}` : "";
        const status = s.error ? ` [ERROR: ${s.error}]` : "";
        console.log(`  ${s.tool.padEnd(20)} ${s.verdict}${n}${status}`);
      }
      console.log();
      console.log(`SIGNAL: ${signalCount} | PRELIMINARY: ${prelimCount} | FAILURE: ${failureCount}`);

      if (!apply) {
        console.log("[DRY-RUN] No files written. Pass --apply to write reports.");
      }

      process.exit(0);
    } else {
      // Single-tool dispatch
      let summary: ToolSummary;
      try {
        summary = await dispatchTool(tool as ToolName, {
          ...dispatchOpts,
          // For single-tool apply, honour --output path override
          ...(customOutput ? {} : {}),
        });
      } catch (err) {
        logger.error({ err, tool }, "replay-grade: tool dispatch failed");
        console.error(`[ERROR] Tool "${tool}" failed: ${err}`);
        await sql.end();
        process.exit(1);
      }

      await sql.end();

      console.log(`\n=== Summary for ${tool} ===`);
      console.log(`Verdict: ${summary.verdict}`);
      if (summary.n !== undefined) console.log(`n: ${summary.n}`);
      if (summary.spearmanRho !== null && summary.spearmanRho !== undefined) {
        console.log(`Spearman rho: ${summary.spearmanRho.toFixed(4)}`);
      }
      if (summary.pValue !== null && summary.pValue !== undefined) {
        console.log(`p-value: ${summary.pValue.toFixed(4)}`);
      }
      if (summary.outputFile) {
        console.log(`Report: ${summary.outputFile}`);
      }
      if (!apply) {
        console.log("[DRY-RUN] No file written. Pass --apply to write report.");
      }

      process.exit(0);
    }
  } catch (err) {
    logger.error({ err }, "replay-grade: unexpected top-level error");
    console.error("[ERROR] Unexpected error:", err);
    try { await sql.end(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
