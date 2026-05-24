/**
 * scripts/wave26-cohort-audit-report.ts — Wave 26 Group C Task 2
 *
 * Pure read-only audit_log query tool for cohort monitoring.
 * Generates a Markdown report with exit_plan distribution, regime distribution,
 * runner trail methods, fallback events, early-exit events, and hard invariants.
 *
 * Usage:
 *   npx tsx scripts/wave26-cohort-audit-report.ts [--days 1|7|14|30] [--strategy silver_bullet]
 *
 * Outputs:
 *   - Markdown report to stdout
 *   - Saved to docs/cohort-audit-reports/YYYY-MM-DD.md
 *
 * Hard rules:
 *   - Read-only: no audit_log mutations
 *   - Fail-soft: empty audit_log → zero counts, no crash
 *   - Pipeline-gate exempt: runs even when trading is paused
 *   - Logger from load-env / console only (no db-coupled logger import)
 *
 * @see CLAUDE.md §10b (audit_log reconstruction mandate)
 * @see docs/wave26-cohort-decision-rules.md (go/no-go criteria)
 */

import postgres from "postgres";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string, fallback: string): string {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return fallback;
}

const DAYS    = parseInt(getFlag("--days",     "1"),  10);
const STRAT   = getFlag("--strategy", "silver_bullet");

if (isNaN(DAYS) || DAYS < 1 || DAYS > 90) {
  console.error("ERROR: --days must be between 1 and 90");
  process.exit(1);
}

// ─── DB connection ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

let dbUrl: string | undefined;
try {
  const envContent = readFileSync(join(projectRoot, ".env"), "utf-8");
  const line = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  dbUrl = line?.split("=").slice(1).join("=").trim();
} catch {
  // .env not found — try process.env
}
dbUrl = dbUrl ?? process.env["DATABASE_URL"];

if (!dbUrl) {
  console.error("ERROR: DATABASE_URL not found in .env or environment");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 2, idle_timeout: 30 });

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AuditCountRow {
  count: string; // Postgres COUNT returns bigint as string
}

interface AuditJsonRow {
  result: Record<string, unknown> | null;
  created_at: Date;
  correlation_id: string | null;
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Count audit_log rows matching action + optional strategy filter within the window.
 * The strategy filter searches result JSONB for matching strategy_id.
 */
async function countAction(action: string, strategyFilter?: string): Promise<number> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  let rows: AuditCountRow[];

  if (strategyFilter) {
    rows = await sql<AuditCountRow[]>`
      SELECT COUNT(*)::text AS count
      FROM audit_log
      WHERE action = ${action}
        AND created_at >= ${since}
        AND (
          result->>'strategy_id' = ${strategyFilter}
          OR result->>'strategyId' = ${strategyFilter}
          OR input->>'strategy_id' = ${strategyFilter}
          OR input->>'strategyId' = ${strategyFilter}
        )
    `;
  } else {
    rows = await sql<AuditCountRow[]>`
      SELECT COUNT(*)::text AS count
      FROM audit_log
      WHERE action = ${action}
        AND created_at >= ${since}
    `;
  }
  return parseInt(rows[0]?.count ?? "0", 10);
}

/**
 * Fetch result JSONB rows for an action within the window.
 */
async function fetchResultRows(
  action: string,
  strategyFilter?: string,
  limit = 500,
): Promise<AuditJsonRow[]> {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  if (strategyFilter) {
    return sql<AuditJsonRow[]>`
      SELECT result, created_at, correlation_id
      FROM audit_log
      WHERE action = ${action}
        AND created_at >= ${since}
        AND (
          result->>'strategy_id' = ${strategyFilter}
          OR result->>'strategyId' = ${strategyFilter}
          OR input->>'strategy_id' = ${strategyFilter}
          OR input->>'strategyId' = ${strategyFilter}
        )
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }
  return sql<AuditJsonRow[]>`
    SELECT result, created_at, correlation_id
    FROM audit_log
    WHERE action = ${action}
      AND created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/**
 * Group rows by a JSONB field value, returning a count map.
 */
function groupByField(
  rows: AuditJsonRow[],
  fieldPath: string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    let val: unknown = row.result;
    for (const key of fieldPath) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        val = (val as Record<string, unknown>)[key];
      } else {
        val = null;
        break;
      }
    }
    const label = val == null ? "(unknown)" : String(val);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

/**
 * Group reason codes from a nested JSONB array field in fallback rows.
 * result.reasons is expected to be an object like { compute_throw: N, missing_liquidity: N }.
 */
function aggregateReasonCodes(rows: AuditJsonRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const reasons = (row.result?.["reasons"] ?? {}) as Record<string, number>;
    for (const [key, count] of Object.entries(reasons)) {
      totals.set(key, (totals.get(key) ?? 0) + (typeof count === "number" ? count : 1));
    }
  }
  return totals;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pct(count: number, total: number): string {
  if (total === 0) return "0.0";
  return ((count / total) * 100).toFixed(1);
}

function formatCountMap(
  map: Map<string, number>,
  total: number,
  indent = "  ",
): string {
  if (map.size === 0) return `${indent}(none)\n`;
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return sorted
    .map(([label, count]) => `${indent}- ${label}: ${count} (${pct(count, total)}%)`)
    .join("\n") + "\n";
}

function invariantLine(label: string, count: number, note: string): string {
  const icon = count > 0 ? "OK" : "--";
  return `${icon}  ${label}: ${count}${note ? " — " + note : ""}\n`;
}

// ─── Main report builder ───────────────────────────────────────────────────────

async function buildReport(): Promise<string> {
  const reportDate = new Date().toISOString().slice(0, 10);
  const windowLabel = DAYS === 1 ? "last 24h" : `last ${DAYS} days`;
  const lines: string[] = [];

  lines.push(`# Wave 26 Cohort Audit Report — ${reportDate}`);
  lines.push(`\n**Strategy:** ${STRAT}  |  **Window:** ${windowLabel}  |  **Generated:** ${new Date().toISOString()}`);
  lines.push("");

  // ─── Section 1: exit_plan_persisted distribution ────────────────────────────
  lines.push(`## ${STRAT} — exit_plan_persisted distribution (${windowLabel})`);
  lines.push("");

  const exitPlanRows = await fetchResultRows("signal.exit_plan_persisted", STRAT);
  const exitPlanTotal = exitPlanRows.length;

  // TP1 source distribution
  const tp1SourceMap = groupByField(exitPlanRows, ["tp1_source"]);
  const tp1Total = exitPlanTotal;
  lines.push(`**exit_plan_persisted total:** ${exitPlanTotal}`);
  lines.push("");
  lines.push("**TP1 sources:**");
  if (tp1Total === 0) {
    lines.push("  - (no exit_plan_persisted events in window)");
  } else {
    for (const [label, count] of [...tp1SourceMap.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  - ${label}: ${count} (${pct(count, tp1Total)}%)`);
    }
  }
  lines.push("");

  // Regime distribution
  const regimeMap = groupByField(exitPlanRows, ["regime"]);
  lines.push("**Regime distribution:**");
  const REGIMES = ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP"];
  for (const regime of REGIMES) {
    const count = regimeMap.get(regime) ?? 0;
    lines.push(`  - ${regime}: ${count}`);
  }
  const otherRegimes = [...regimeMap.entries()].filter(([k]) => !REGIMES.includes(k));
  for (const [label, count] of otherRegimes) {
    lines.push(`  - ${label}: ${count} (unexpected — check bias engine)`);
  }
  lines.push("");

  // Runner trail method distribution
  const runnerMap = groupByField(exitPlanRows, ["runner_trail_method"]);
  lines.push("**Runner trail method usage:**");
  const RUNNERS = ["anchored_vwap", "developing_poc", "chandelier", "structure_trail"];
  for (const runner of RUNNERS) {
    const count = runnerMap.get(runner) ?? 0;
    lines.push(`  - ${runner}: ${count}`);
  }
  const otherRunners = [...runnerMap.entries()].filter(([k]) => !RUNNERS.includes(k));
  for (const [label, count] of otherRunners) {
    lines.push(`  - ${label}: ${count}`);
  }
  lines.push("");

  // ─── Section 2: Fallback events (silent engine bugs) ─────────────────────────
  lines.push("## Fallback events (should be near-zero — any cluster = engine bug)");
  lines.push("");

  const fallbackRows = await fetchResultRows("signal.exit_plan_fallback_static", STRAT);
  const fallbackCount = fallbackRows.length;
  const fallbackReasons = aggregateReasonCodes(fallbackRows);

  lines.push(`**exit_plan_fallback_static:** ${fallbackCount} (${windowLabel})`);
  if (fallbackCount >= 5) {
    lines.push("  >> WARNING: 5+ fallback events detected — INVESTIGATE engine errors before expanding cohort");
  } else if (fallbackCount > 0) {
    lines.push("  >> NOTE: low fallback count — monitor but not blocking");
  } else {
    lines.push("  >> OK: zero fallback events");
  }

  if (fallbackReasons.size > 0) {
    lines.push("  - reasons:");
    for (const [reason, count] of [...fallbackReasons.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`    - ${reason}: ${count}`);
    }
  } else if (fallbackCount > 0) {
    // Fallback rows exist but no structured reasons — extract error_message
    const errorMessages = fallbackRows
      .map((r) => r.result?.["error"] ?? r.result?.["reason"] ?? "(no reason field)")
      .slice(0, 5);
    lines.push("  - sample error messages (first 5):");
    for (const msg of errorMessages) {
      lines.push(`    - ${String(msg).slice(0, 120)}`);
    }
  }
  lines.push("");

  // ─── Section 3: Early-exit + Pre-lunch + Delta-div events ───────────────────
  lines.push("## Early-exit + Pre-lunch + Delta-div events");
  lines.push("");

  const earlyExitCount = await countAction("signal.early_partial_exit_triggered", STRAT);
  const preLunchCount  = await countAction("signal.pre_lunch_partial_exit",        STRAT);
  const scalingCount   = await countAction("signal.scaling_schedule_selected",    STRAT);
  const runnerCount    = await countAction("signal.runner_trail_method_selected",  STRAT);

  lines.push(`**signal.early_partial_exit_triggered:** ${earlyExitCount}`);
  lines.push(`**signal.pre_lunch_partial_exit:** ${preLunchCount}`);
  lines.push(`**signal.scaling_schedule_selected:** ${scalingCount}`);
  lines.push(`**signal.runner_trail_method_selected:** ${runnerCount}`);
  lines.push("");

  // ─── Section 4: Hard invariants (proof of operation) ─────────────────────────
  lines.push("## Hard invariants (proof of operation)");
  lines.push("");
  lines.push("> These must be non-zero after at least one trading day of adaptive exit activity.");
  lines.push("");

  // 15:55 ET flatten events — look for the time_stop audit in paper-signal-service
  const flattenCount = await countAction("paper.time_stop_flatten", STRAT);
  // BE+1 on TP1 fills — exit_plan_persisted rows where tp1 was hit
  const tp1FillCount  = await countAction("paper.tp1_fill", STRAT);
  // DLL halts at 67%
  const dllHalt67Count  = await countAction("cross_symbol_dll_halt_triggered", STRAT);
  // 95% DLL force-close events
  const dll95Count = await countAction("paper.dll_95_force_close", STRAT);

  lines.push(invariantLine("15:55 ET flatten events", flattenCount, "should match trading days since opt-in"));
  lines.push(invariantLine("BE+1 on TP1 fills", tp1FillCount, "should match TP1 fill count"));
  lines.push(invariantLine("67% DLL halts", dllHalt67Count, "rare — occasional"));
  lines.push(invariantLine("95% DLL force-closes", dll95Count, "very rare — flag if any appear"));

  if (dll95Count > 0) {
    lines.push(`\n>> ALERT: ${dll95Count} 95% DLL force-close event(s) detected — INVESTIGATE IMMEDIATELY`);
  }
  lines.push("");

  // ─── Section 5: Cohort go/no-go quick assessment ─────────────────────────────
  lines.push("## Quick Go/No-Go Assessment");
  lines.push("");
  lines.push("> Run docs/wave26-cohort-decision-rules.md for full operator criteria.");
  lines.push("");

  const distinctRegimes = [...regimeMap.entries()].filter(([k]) => REGIMES.includes(k) && k !== "(unknown)").length;
  const liquidityTp1Count = tp1SourceMap.get("liquidity") ?? 0;
  const liquidityTp1Pct   = tp1Total > 0 ? (liquidityTp1Count / tp1Total) * 100 : 0;

  const checks: Array<{ label: string; pass: boolean; value: string }> = [
    {
      label: "fallback_static < 5/day",
      pass: fallbackCount < 5,
      value: `${fallbackCount} events`,
    },
    {
      label: "TP1 source: liquidity >= 50%",
      pass: liquidityTp1Pct >= 50 || tp1Total === 0,
      value: tp1Total === 0 ? "no data yet" : `${liquidityTp1Pct.toFixed(1)}% (${liquidityTp1Count}/${tp1Total})`,
    },
    {
      label: "Regime diversity >= 3 distinct",
      pass: distinctRegimes >= 3 || exitPlanTotal === 0,
      value: exitPlanTotal === 0 ? "no data yet" : `${distinctRegimes} distinct regimes`,
    },
    {
      label: "Zero 95% DLL force-closes",
      pass: dll95Count === 0,
      value: `${dll95Count} events`,
    },
  ];

  for (const c of checks) {
    const icon = c.pass ? "PASS" : "FAIL";
    lines.push(`[${icon}] ${c.label} — ${c.value}`);
  }

  const allPass = checks.every((c) => c.pass);
  lines.push("");
  if (allPass) {
    lines.push("**Overall: PASS — all quick checks green. See decision rules for full go/no-go.**");
  } else {
    const failingChecks = checks.filter((c) => !c.pass).map((c) => c.label);
    lines.push(`**Overall: REVIEW — failing checks: ${failingChecks.join(", ")}**`);
  }
  lines.push("");

  lines.push("---");
  lines.push(`*Report generated by scripts/wave26-cohort-audit-report.ts — §10b audit_log reconstruction*`);

  return lines.join("\n");
}

// ─── Output handlers ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error(`[wave26-cohort-audit-report] building report: strategy=${STRAT} days=${DAYS}`);

  let report: string;
  try {
    report = await buildReport();
  } catch (err) {
    console.error("[wave26-cohort-audit-report] FATAL: query failed:", err);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  // Print to stdout
  console.log(report);

  // Write to docs/cohort-audit-reports/<YYYY-MM-DD>.md
  const reportDate = new Date().toISOString().slice(0, 10);
  const reportsDir = join(projectRoot, "docs", "cohort-audit-reports");
  try {
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${reportDate}.md`);
    writeFileSync(reportPath, report, "utf-8");
    console.error(`[wave26-cohort-audit-report] saved to ${reportPath}`);
  } catch (err) {
    console.error("[wave26-cohort-audit-report] WARNING: could not write report file:", err);
    // Non-fatal — stdout output still produced
  }

  await sql.end({ timeout: 10 });
}

main().catch(async (err) => {
  console.error("[wave26-cohort-audit-report] unhandled error:", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
