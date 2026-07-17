/**
 * Wave 27 Pass 3.G2 — Replay Grading Harness Shared Infrastructure
 *
 * Pure-function helpers shared across all replay-grade-*.ts scripts and the
 * unified replay-grade.ts dispatcher.  No DB calls are embedded here; every
 * helper that needs a DB client accepts it as a parameter so callers control
 * connection lifecycle.
 *
 * Governance:
 *   - Advisory only.  Does NOT write to any production table.
 *   - No side-effects inside this module — callers decide when to write.
 *   - All functions exported and unit-testable in isolation.
 *
 * Consumed by:
 *   - scripts/replay-grade.ts          (unified dispatcher)
 *   - scripts/replay-grade-*.ts        (individual tool entry points)
 *   - src/server/__tests__/replay/replay-grade-unified.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** All tool names recognised by the unified dispatcher. */
export const ALL_TOOL_NAMES = [
  "quantum",
  "confluence",
  "critique",
  "robustness",
  "survival-twin",
  "pattern-aggregator",
  "consistency",
] as const;

export type ToolName = typeof ALL_TOOL_NAMES[number];

/** Verdict values produced by all replay-grading tools. */
export type ReplayVerdict =
  | "SIGNAL"
  | "INCONCLUSIVE"
  | "NO SIGNAL"
  | "NO_SIGNAL"
  | "PRELIMINARY"
  | "FAILURE";

/** Exit code conventions — match existing individual scripts. */
export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

// ─── CLI argument parsing ──────────────────────────────────────────────────────

export interface ParsedArgs {
  /** --tool <name|all> */
  tool: string;
  /** --apply: write markdown file(s) to disk */
  apply: boolean;
  /** --limit N: restrict number of rows/folds/strategies */
  limit: number | undefined;
  /** --output <path>: custom output path (single-tool only) */
  customOutput: string | undefined;
  /** --strategy <id>: filter to one strategy (critique tool only) */
  strategyId: string | undefined;
  /** --days N: look-back window in days (critique tool only, default 90) */
  lookbackDays: number;
  /** Raw argv slice after process.argv[1] */
  rawArgs: string[];
}

/**
 * Parse CLI arguments from process.argv (or a supplied override for testing).
 * Pure function — reads no globals; caller passes argv.
 */
export function parseCLIArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  const toolIdx = args.indexOf("--tool");
  const tool = toolIdx !== -1 ? (args[toolIdx + 1] ?? "all") : "all";

  const apply = args.includes("--apply");

  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;

  const outputIdx = args.indexOf("--output");
  const customOutput = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  const strategyIdx = args.indexOf("--strategy");
  const strategyId = strategyIdx !== -1 ? args[strategyIdx + 1] : undefined;

  const daysIdx = args.indexOf("--days");
  const lookbackDays = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 90;

  return { tool, apply, limit, customOutput, strategyId, lookbackDays, rawArgs: args };
}

/**
 * Validate that a tool name is known.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateToolName(tool: string): string | null {
  if (tool === "all") return null;
  if ((ALL_TOOL_NAMES as readonly string[]).includes(tool)) return null;
  return (
    `Unknown tool: "${tool}". ` +
    `Valid options: ${ALL_TOOL_NAMES.join(" | ")} | all`
  );
}

// ─── Repository root resolution ────────────────────────────────────────────────

/**
 * Resolve the repository root from an import.meta.url or __filename value.
 * Returns the absolute path to the root (the directory containing package.json).
 *
 * Works whether called from scripts/ (one level up) or anywhere inside src/.
 * Pure function — no filesystem access; caller supplies the starting path.
 */
export function resolveRepoRoot(fromFilePath: string): string {
  // fromFilePath may be a file URL (import.meta.url) or an absolute path
  const filePath = fromFilePath.startsWith("file:")
    ? fileURLToPath(fromFilePath)
    : fromFilePath;
  // scripts/ lives one level below repo root; src/ lives two levels below
  const dir = path.dirname(filePath);
  // Walk up until we find package.json or hit filesystem root
  let current = dir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Fallback: assume one level up from scripts/
  return path.join(dir, "..");
}

/**
 * Build the standard output path for a replay-results markdown file.
 * Pattern: <repoRoot>/docs/replay-results/<isoDate>-<suffix>.md
 */
export function buildOutputPath(
  repoRoot: string,
  isoDate: string,
  suffix: string,
): string {
  return path.join(repoRoot, "docs", "replay-results", `${isoDate}-${suffix}.md`);
}

/**
 * Resolve the markdown output path for a SINGLE tool's report.
 *
 * FIX (fix-wave telemetry-honesty-registry-dashboards, 2026-07-17 — HIGH
 * finding): scripts/replay-grade.ts's single-tool CLI dispatch previously
 * discarded the parsed `--output <path>` flag entirely — `parseCLIArgs`
 * correctly parsed it into `customOutput` (docstring: "custom output path
 * (single-tool only)"), but the dispatch call site spread
 * `...(customOutput ? {} : {})`, which is `{}` on BOTH branches and never
 * threaded the value anywhere. Every `--tool=<x> --apply --output <path>`
 * invocation silently ignored the operator's path and always wrote to the
 * standard `buildOutputPath()` location instead — a discarded-flag class of
 * silent failure (the CLI accepted the flag, printed no error, and just did
 * something else).
 *
 * This helper is the single source of truth both scripts/replay-grade.ts and
 * its tests reason about: apply=false always means "no file" (dry-run
 * contract preserved); apply=true honors an explicit override when given,
 * otherwise falls back to the standard `<isoDate>-<suffix>.md` convention.
 *
 * NOT used for `--tool=all` — the combined weekly-roundup report is the only
 * consumer of `customOutput` in that mode (each of the 7 per-tool sub-reports
 * still writes to its own standard path; routing the same custom path into
 * per-tool dispatch would make all 7 collide on one file).
 */
export function resolveReportOutputPath(opts: {
  apply: boolean;
  customOutput?: string;
  repoRoot: string;
  isoDate: string;
  suffix: string;
}): string | undefined {
  if (!opts.apply) return undefined;
  return opts.customOutput ?? buildOutputPath(opts.repoRoot, opts.isoDate, opts.suffix);
}

// ─── CPCV purge enforcement ────────────────────────────────────────────────────

/**
 * Canonical CPCV purge check — used by all replay harnesses.
 * Fails CLOSED on any violation, including equality.
 *
 * oos_start must be STRICTLY after is_end (millisecond-resolution).
 * Equality (oos_start === is_end to the millisecond) is a purge violation —
 * the IS and OOS windows share a boundary bar, which constitutes look-ahead.
 *
 * FIX (Finding #16 — Wave A Critic): the previous implementation used `<=`
 * which means:
 *   oosStartDate <= isEndDate  →  violation
 * This correctly catches overlap but ALSO correctly catches equality.
 * However, quantum-disagreement.ts::checkPurgeViolation compared ISO date
 * STRINGS with `<=` (lexicographic), which is only correct when both strings
 * are the same ISO format (date-only "YYYY-MM-DD").  When the DB returns
 * sub-day timestamps ("2026-01-15T09:00:00.000Z"), the string comparison
 * can disagree with the Date-object comparison for the same fence-post value.
 *
 * Resolution:
 *   - THIS function (harness-base.ts::checkCpcvPurge) is CANONICAL and always
 *     uses Date objects with strict `<` for the pass condition.
 *   - quantum-disagreement.ts::checkPurgeViolation now delegates here.
 *   - The equality boundary case IS a violation (strict `<` required).
 *
 * Returns a violation description string, or null if clean.
 */
export function checkCpcvPurge(
  foldId: string,
  isEnd: string,
  oosStart: string,
): string | null {
  const isEndDate = new Date(isEnd);
  const oosStartDate = new Date(oosStart);

  // Strict: oos_start must be STRICTLY after is_end (not equal, not before).
  // Equality-to-the-millisecond IS a purge violation.
  if (!(oosStartDate > isEndDate)) {
    const overlapMs = isEndDate.getTime() - oosStartDate.getTime();
    const overlapDays = Math.round(overlapMs / 86_400_000);
    const overlapLabel = overlapMs === 0
      ? "boundary equality (oos_start == is_end)"
      : `overlap of ${overlapDays} day(s)`;
    return (
      `PURGE VIOLATION on fold ${foldId}: ` +
      `oos_start (${oosStart}) must be strictly after is_end (${isEnd}). ` +
      `Detected ${overlapLabel}.`
    );
  }
  return null;
}

// ─── Markdown report helpers ───────────────────────────────────────────────────

/**
 * Build the standard markdown header shared across all replay reports.
 */
export function buildMarkdownHeader(opts: {
  title: string;
  isoDate: string;
  toolName: string;
  runMetadata?: Record<string, string | number>;
}): string {
  const lines: string[] = [
    `# ${opts.title}`,
    "",
    `**Date:** ${opts.isoDate}  `,
    `**Tool:** ${opts.toolName}  `,
    `**Run type:** local simulator (no cloud QPU)  `,
  ];

  if (opts.runMetadata) {
    for (const [key, val] of Object.entries(opts.runMetadata)) {
      lines.push(`**${key}:** ${val}  `);
    }
  }

  lines.push("", "---", "");
  return lines.join("\n");
}

/**
 * Build the standard markdown footer shared across all replay reports.
 */
export function buildMarkdownFooter(opts: {
  isoDate: string;
  governanceNote?: string;
}): string {
  const note =
    opts.governanceNote ??
    "Challenger outputs are advisory only. No promotion authority. No execution authority.";
  return [
    "",
    "---",
    "",
    `*Generated ${opts.isoDate} — ${note}*`,
    "",
  ].join("\n");
}

// ─── Combined weekly roundup report ───────────────────────────────────────────

export interface ToolSummary {
  tool: ToolName;
  verdict: string;
  spearmanRho?: number | null;
  pValue?: number | null;
  n?: number;
  outputFile?: string;
  error?: string;
}

/**
 * Build the combined markdown report for --tool=all (Sunday weekly cron).
 *
 * Shape matches the Wave 27 Pass 3 spec:
 *   - Per-tool section with verdict + link
 *   - Cross-tool summary table
 *   - Aggregate decision
 */
export function buildCombinedMarkdownReport(
  summaries: ToolSummary[],
  isoDate: string,
): string {
  const toolsRun = summaries.map(s => s.tool).join(", ");

  const lines: string[] = [
    "# Wave 27 — Replay Grading Weekly Roundup",
    "",
    `**Date:** ${isoDate}`,
    `**Tools Run:** ${toolsRun}`,
    "",
    "---",
    "",
  ];

  // Per-tool sections
  for (const s of summaries) {
    const titleCase = s.tool
      .split("-")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    lines.push(`## ${titleCase}`, "");

    if (s.error) {
      lines.push(`**Verdict:** FAILURE`, "");
      lines.push(`**Error:** ${s.error}`, "");
    } else {
      const nStr = s.n !== undefined ? `n = ${s.n}` : "n = unavailable";
      lines.push(`**Verdict:** ${s.verdict} | ${nStr}`, "");
      if (s.outputFile) {
        lines.push(`[Full report](${s.outputFile})`, "");
      }
    }

    lines.push("");
  }

  lines.push("---", "");

  // Cross-tool summary table
  lines.push("## Cross-Tool Signal Summary", "");
  lines.push("| Tool | Verdict | Spearman ρ | p-value | n |");
  lines.push("|---|---|---|---|---|");

  for (const s of summaries) {
    const rho =
      s.spearmanRho !== null && s.spearmanRho !== undefined
        ? s.spearmanRho.toFixed(4)
        : "—";
    const pv =
      s.pValue !== null && s.pValue !== undefined
        ? s.pValue.toFixed(4)
        : "—";
    const n = s.n !== undefined ? String(s.n) : "—";
    const verdict = s.error ? "FAILURE" : s.verdict;
    lines.push(`| ${s.tool} | ${verdict} | ${rho} | ${pv} | ${n} |`);
  }

  lines.push("");

  // Aggregate decision
  const verdictCounts: Record<string, number> = {};
  for (const s of summaries) {
    const v = s.error ? "FAILURE" : s.verdict;
    verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
  }

  const signalCount = verdictCounts["SIGNAL"] ?? 0;
  const inconclusiveCount = verdictCounts["INCONCLUSIVE"] ?? 0;
  const noSignalCount =
    (verdictCounts["NO SIGNAL"] ?? 0) + (verdictCounts["NO_SIGNAL"] ?? 0);
  const preliminaryCount = verdictCounts["PRELIMINARY"] ?? 0;
  const failureCount = verdictCounts["FAILURE"] ?? 0;

  let operatorAction: string;
  if (signalCount >= 3) {
    operatorAction =
      ">=3 tools showing SIGNAL — consider promoting one to hard gate (requires architect review first).";
  } else if (signalCount >= 1) {
    operatorAction =
      `${signalCount} tool(s) showing SIGNAL — monitor; accumulate more folds before hard gate.`;
  } else if (preliminaryCount === summaries.length) {
    operatorAction =
      "All tools PRELIMINARY — data still accumulating. Re-run after 2-4 more weeks.";
  } else {
    operatorAction =
      "No clear signal across tools — hold at challenger governance. Continue data accumulation.";
  }

  lines.push(
    "## Aggregate Decision",
    "",
    `- Tools with SIGNAL: ${signalCount}`,
    `- Tools with INCONCLUSIVE: ${inconclusiveCount}`,
    `- Tools with NO_SIGNAL: ${noSignalCount}`,
    `- Tools with PRELIMINARY: ${preliminaryCount}`,
    `- Tools with FAILURE: ${failureCount}`,
    `- Operator action: ${operatorAction}`,
    "",
    "---",
    "",
    `*Generated ${isoDate} — Challenger outputs are advisory only. No promotion authority. No execution authority.*`,
    "",
  );

  return lines.join("\n");
}

// ─── File write helper ─────────────────────────────────────────────────────────

/**
 * Write a markdown report to disk, creating parent directories as needed.
 * Returns the output path on success, or throws on failure.
 *
 * Caller is responsible for handling the thrown error (log + exit if needed).
 */
export function writeMarkdownReport(outputPath: string, content: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, "utf8");
}

// ─── Summary extraction helpers ────────────────────────────────────────────────

/**
 * Extract a ToolSummary from any analysis result that has the common fields.
 * Each tool produces a different result shape; callers normalize it here.
 */
export function extractToolSummary(
  tool: ToolName,
  result: {
    verdict: string;
    validFolds?: number;
    spearmanRho?: number;
    spearmanPValue?: number;
    critiquesAnalyzed?: number;
    totalB15Rows?: number;
    // critique uses mannWhitneyPValue, not spearmanPValue
    mannWhitneyPValue?: number;
    // n fields differ per tool
    n?: number;
  },
  outputFile?: string,
): ToolSummary {
  const n =
    result.validFolds ??
    result.critiquesAnalyzed ??
    result.totalB15Rows ??
    result.n;

  const pValue =
    result.spearmanPValue ??
    result.mannWhitneyPValue ??
    null;

  return {
    tool,
    verdict: result.verdict,
    spearmanRho: result.spearmanRho ?? null,
    pValue,
    n,
    outputFile,
  };
}
