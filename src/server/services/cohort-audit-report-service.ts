/**
 * cohort-audit-report-service.ts — Wave 26 Group C Task 2
 *
 * Read-only audit_log query service for cohort adaptive-exit monitoring.
 * Produces a structured Markdown report of exit_plan events, regime distribution,
 * runner trail usage, fallback clusters, and hard invariant counts.
 *
 * Design rules:
 *   - Read-only: never writes to audit_log (script/cron caller writes the receipt)
 *   - Fail-soft: empty result sets → zero counts, no throws
 *   - No business logic: pure aggregation of existing audit events
 *   - Logger from leaf module only (never ../index.js — bootstrap isolation)
 *   - §10b mandate: this IS the audit_log reconstruction harness for adaptive exits
 *
 * Public API:
 *   buildCohortAuditReport(opts) → { markdown, summary }
 *   _TEST_ONLY_buildReportFromRows(rows, opts) → { markdown, summary }  (test seam)
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { and, eq, gte, sql as drizzleSql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CohortReportOpts {
  days: number;          // lookback window in days (1 | 7 | 14 | 30)
  strategy: string;      // strategy name filter (e.g. "silver_bullet")
  correlationId: string; // for structured logging
}

export interface CohortReportSummary {
  exit_plan_total:       number;
  fallback_count:        number;
  fallback_cluster:      boolean;  // true if fallbackCount >= 5
  liquidity_tp1_pct:     number;   // 0-100
  distinct_regimes:      number;
  dll_95_force_closes:   number;
  all_checks_pass:       boolean;
}

export interface CohortReportResult {
  markdown: string;
  summary:  CohortReportSummary;
}

// ─── Canonical sets ───────────────────────────────────────────────────────────

const CANONICAL_REGIMES = [
  "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND",
  "EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP",
];

const CANONICAL_RUNNERS = [
  "anchored_vwap", "developing_poc", "chandelier", "structure_trail",
];

// ─── Row shape pulled from audit_log ─────────────────────────────────────────

interface AuditRow {
  action:     string;
  result:     Record<string, unknown> | null;
  created_at: Date;
}

// ─── Internal query helpers ───────────────────────────────────────────────────

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Fetch audit_log rows for a specific action within the window,
 * optionally filtered to a strategy (searches both result and input JSONB).
 */
async function _fetchRows(
  action: string,
  since: Date,
  strategy: string,
  limit = 500,
): Promise<AuditRow[]> {
  try {
    // Drizzle does not expose raw jsonb contains easily; use sql template for the
    // JSONB contains check. The strategy filter is a LIKE search on the jsonb text
    // to avoid injecting into a raw query — but strategy names are trusted input
    // (internal scheduler, not user-supplied).
    const rows = await db
      .select({
        action:     auditLog.action,
        result:     auditLog.result,
        created_at: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, action),
          gte(auditLog.createdAt, since),
          // Strategy filter: match strategy_id in result or input JSONB
          drizzleSql`(
            (${auditLog.result}->>'strategy_id') = ${strategy}
            OR (${auditLog.result}->>'strategyId') = ${strategy}
            OR (${auditLog.input}->>'strategy_id') = ${strategy}
            OR (${auditLog.input}->>'strategyId') = ${strategy}
          )`,
        ),
      )
      .orderBy(drizzleSql`${auditLog.createdAt} DESC`)
      .limit(limit);

    return rows as AuditRow[];
  } catch (err) {
    logger.warn({ err, action }, "cohort-audit-report: query failed — returning empty");
    return [];
  }
}

/**
 * Fetch count for an action within the window (unfiltered by strategy).
 * Used for invariant checks that are session-level (15:55 flatten, DLL events).
 */
async function _fetchCount(action: string, since: Date): Promise<number> {
  try {
    const rows = await db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int` })
      .from(auditLog)
      .where(and(eq(auditLog.action, action), gte(auditLog.createdAt, since)));
    return (rows[0]?.cnt as number) ?? 0;
  } catch (err) {
    logger.warn({ err, action }, "cohort-audit-report: count query failed — returning 0");
    return 0;
  }
}

// ─── Report builder (uses pre-fetched rows — pure for testing) ────────────────

export interface _TestRows {
  exitPlanRows:    AuditRow[];
  fallbackRows:    AuditRow[];
  earlyExitCount:  number;
  preLunchCount:   number;
  scalingCount:    number;
  runnerCount:     number;
  flattenCount:    number;
  tp1FillCount:    number;
  dllHalt67Count:  number;
  dll95Count:      number;
}

function _buildMarkdown(
  rows: _TestRows,
  opts: CohortReportOpts,
): CohortReportResult {
  const { strategy, days } = opts;
  const windowLabel = days === 1 ? "last 24h" : `last ${days} days`;
  const reportDate  = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Wave 26 Cohort Audit Report — ${reportDate}`);
  lines.push(`\n**Strategy:** ${strategy}  |  **Window:** ${windowLabel}`);
  lines.push("");

  // ─── Section 1: exit_plan_persisted ────────────────────────────────────────
  lines.push(`## ${strategy} — exit_plan_persisted distribution (${windowLabel})`);
  lines.push("");

  const { exitPlanRows } = rows;
  const exitPlanTotal = exitPlanRows.length;

  // TP1 source distribution
  const tp1Map = new Map<string, number>();
  for (const r of exitPlanRows) {
    const src = String(r.result?.["tp1_source"] ?? "(unknown)");
    tp1Map.set(src, (tp1Map.get(src) ?? 0) + 1);
  }
  const tp1Total = exitPlanTotal;

  lines.push(`**exit_plan_persisted total:** ${exitPlanTotal}`);
  lines.push("");
  lines.push("**TP1 sources:**");
  if (tp1Total === 0) {
    lines.push("  - (no exit_plan_persisted events in window)");
  } else {
    const sorted = [...tp1Map.entries()].sort((a, b) => b[1] - a[1]);
    for (const [label, count] of sorted) {
      const p = ((count / tp1Total) * 100).toFixed(1);
      lines.push(`  - ${label}: ${count} (${p}%)`);
    }
  }
  lines.push("");

  // Regime distribution
  const regimeMap = new Map<string, number>();
  for (const r of exitPlanRows) {
    const regime = String(r.result?.["regime"] ?? "(unknown)");
    regimeMap.set(regime, (regimeMap.get(regime) ?? 0) + 1);
  }
  lines.push("**Regime distribution:**");
  for (const regime of CANONICAL_REGIMES) {
    lines.push(`  - ${regime}: ${regimeMap.get(regime) ?? 0}`);
  }
  const otherRegimes = [...regimeMap.entries()].filter(([k]) => !CANONICAL_REGIMES.includes(k) && k !== "(unknown)");
  for (const [label, count] of otherRegimes) {
    lines.push(`  - ${label}: ${count} (unexpected — check bias engine)`);
  }
  lines.push("");

  // Runner trail method distribution
  const runnerTrailMap = new Map<string, number>();
  for (const r of exitPlanRows) {
    const method = String(r.result?.["runner_trail_method"] ?? "(unknown)");
    runnerTrailMap.set(method, (runnerTrailMap.get(method) ?? 0) + 1);
  }
  lines.push("**Runner trail method usage:**");
  for (const runner of CANONICAL_RUNNERS) {
    lines.push(`  - ${runner}: ${runnerTrailMap.get(runner) ?? 0}`);
  }
  const otherRunners = [...runnerTrailMap.entries()].filter(([k]) => !CANONICAL_RUNNERS.includes(k) && k !== "(unknown)");
  for (const [label, count] of otherRunners) {
    lines.push(`  - ${label}: ${count}`);
  }
  lines.push("");

  // ─── Section 2: Fallback events ────────────────────────────────────────────
  lines.push("## Fallback events (should be near-zero — any cluster = engine bug)");
  lines.push("");

  const fallbackCount = rows.fallbackRows.length;

  // Aggregate reason codes from result.reasons JSONB
  const reasonTotals = new Map<string, number>();
  for (const r of rows.fallbackRows) {
    const reasons = (r.result?.["reasons"] ?? {}) as Record<string, unknown>;
    for (const [key, val] of Object.entries(reasons)) {
      const n = typeof val === "number" ? val : 1;
      reasonTotals.set(key, (reasonTotals.get(key) ?? 0) + n);
    }
  }

  lines.push(`**exit_plan_fallback_static:** ${fallbackCount} (${windowLabel})`);
  if (fallbackCount >= 5) {
    lines.push("  >> WARNING: 5+ fallback events — INVESTIGATE engine errors before expanding cohort");
  } else if (fallbackCount > 0) {
    lines.push("  >> NOTE: low fallback count — monitor but not blocking");
  } else {
    lines.push("  >> OK: zero fallback events");
  }

  if (reasonTotals.size > 0) {
    lines.push("  - reasons:");
    for (const [reason, count] of [...reasonTotals.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`    - ${reason}: ${count}`);
    }
  } else if (fallbackCount > 0) {
    // Sample raw errors when no structured reasons
    const errorSamples = rows.fallbackRows
      .slice(0, 5)
      .map((r) => String(r.result?.["error"] ?? r.result?.["reason"] ?? "(no reason)").slice(0, 100));
    lines.push("  - sample errors (first 5):");
    for (const msg of errorSamples) {
      lines.push(`    - ${msg}`);
    }
  }
  lines.push("");

  // ─── Section 3: Early-exit + Pre-lunch + Delta-div events ──────────────────
  lines.push("## Early-exit + Pre-lunch + Delta-div events");
  lines.push("");
  lines.push(`**signal.early_partial_exit_triggered:** ${rows.earlyExitCount}`);
  lines.push(`**signal.pre_lunch_partial_exit:** ${rows.preLunchCount}`);
  lines.push(`**signal.scaling_schedule_selected:** ${rows.scalingCount}`);
  lines.push(`**signal.runner_trail_method_selected:** ${rows.runnerCount}`);
  lines.push("");

  // ─── Section 4: Hard invariants ────────────────────────────────────────────
  lines.push("## Hard invariants (proof of operation)");
  lines.push("");
  lines.push("> Non-zero after at least one day of adaptive-exit activity.");
  lines.push("");

  function inv(label: string, count: number, note: string): string {
    const icon = count > 0 ? "OK" : "--";
    return `${icon}  ${label}: ${count} — ${note}`;
  }
  lines.push(inv("15:55 ET flatten events", rows.flattenCount,   "should match trading days since opt-in"));
  lines.push(inv("BE+1 on TP1 fills",       rows.tp1FillCount,   "should match TP1 fill count"));
  lines.push(inv("67% DLL halts",           rows.dllHalt67Count, "rare — occasional"));
  lines.push(inv("95% DLL force-closes",    rows.dll95Count,     "very rare — flag if any appear"));

  if (rows.dll95Count > 0) {
    lines.push(`\n>> ALERT: ${rows.dll95Count} 95% DLL force-close event(s) detected — INVESTIGATE`);
  }
  lines.push("");

  // ─── Section 5: Quick go/no-go ─────────────────────────────────────────────
  lines.push("## Quick Go/No-Go Assessment");
  lines.push("");
  lines.push("> See docs/wave26-cohort-decision-rules.md for full criteria.");
  lines.push("");

  const distinctRegimes = CANONICAL_REGIMES.filter((r) => (regimeMap.get(r) ?? 0) > 0).length;
  const liquidityTp1Count = tp1Map.get("liquidity") ?? 0;
  const liquidityTp1Pct   = tp1Total > 0 ? (liquidityTp1Count / tp1Total) * 100 : 0;

  const checks = [
    { label: "fallback_static < 5/day",        pass: fallbackCount < 5,              value: `${fallbackCount} events` },
    { label: "TP1 liquidity >= 50%",            pass: liquidityTp1Pct >= 50 || tp1Total === 0, value: tp1Total === 0 ? "no data" : `${liquidityTp1Pct.toFixed(1)}% (${liquidityTp1Count}/${tp1Total})` },
    { label: "Regime diversity >= 3",           pass: distinctRegimes >= 3 || exitPlanTotal === 0, value: exitPlanTotal === 0 ? "no data" : `${distinctRegimes} distinct` },
    { label: "Zero 95% DLL force-closes",       pass: rows.dll95Count === 0,           value: `${rows.dll95Count} events` },
  ];

  for (const c of checks) {
    lines.push(`[${c.pass ? "PASS" : "FAIL"}] ${c.label} — ${c.value}`);
  }

  const allPass = checks.every((c) => c.pass);
  lines.push("");
  if (allPass) {
    lines.push("**Overall: PASS — all quick checks green. See decision rules for full go/no-go.**");
  } else {
    const failing = checks.filter((c) => !c.pass).map((c) => c.label).join(", ");
    lines.push(`**Overall: REVIEW — failing: ${failing}**`);
  }
  lines.push("");
  lines.push("---");
  lines.push("*Generated by cohort-audit-report-service.ts — §10b audit_log reconstruction*");

  const summary: CohortReportSummary = {
    exit_plan_total:     exitPlanTotal,
    fallback_count:      fallbackCount,
    fallback_cluster:    fallbackCount >= 5,
    liquidity_tp1_pct:   liquidityTp1Pct,
    distinct_regimes:    distinctRegimes,
    dll_95_force_closes: rows.dll95Count,
    all_checks_pass:     allPass,
  };

  return { markdown: lines.join("\n"), summary };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Build a cohort audit report by querying audit_log.
 *
 * Fail-soft: individual query failures return zero counts (logged as warn).
 * Never throws — caller can fire-and-forget.
 */
export async function buildCohortAuditReport(
  opts: CohortReportOpts,
): Promise<CohortReportResult> {
  const { days, strategy, correlationId } = opts;
  const since = sinceDate(days);

  logger.info(
    { days, strategy, correlationId, since: since.toISOString() },
    "cohort-audit-report: building report",
  );

  // Fetch all needed rows in parallel
  const [
    exitPlanRows,
    fallbackRows,
    earlyExitCount,
    preLunchCount,
    scalingCount,
    runnerCount,
    flattenCount,
    tp1FillCount,
    dllHalt67Count,
    dll95Count,
  ] = await Promise.all([
    _fetchRows("signal.exit_plan_persisted",         since, strategy),
    _fetchRows("signal.exit_plan_fallback_static",   since, strategy),
    _fetchCount("signal.early_partial_exit_triggered", since),
    _fetchCount("signal.pre_lunch_partial_exit",       since),
    _fetchCount("signal.scaling_schedule_selected",    since),
    _fetchCount("signal.runner_trail_method_selected", since),
    _fetchCount("paper.time_stop_flatten",             since),
    _fetchCount("paper.tp1_fill",                      since),
    _fetchCount("sizing.dll_force_close",              since), // MED-3 2026-06-29: fixed wrong action name (was cross_symbol_dll_halt_triggered — kill-switch writes sizing.dll_force_close)
    _fetchCount("sizing.dll_force_close_completed",    since), // MED-3 2026-06-29: fixed wrong action name (was paper.dll_95_force_close — kill-switch writes sizing.dll_force_close_completed)
  ]);

  const testRows: _TestRows = {
    exitPlanRows,
    fallbackRows,
    earlyExitCount,
    preLunchCount,
    scalingCount,
    runnerCount,
    flattenCount,
    tp1FillCount,
    dllHalt67Count,
    dll95Count,
  };

  const result = _buildMarkdown(testRows, opts);

  logger.info(
    { correlationId, summary: result.summary },
    "cohort-audit-report: report built",
  );

  return result;
}

/**
 * Test seam: build report from pre-supplied rows without DB queries.
 * Allows unit tests to inject synthetic audit_log data.
 */
export function _TEST_ONLY_buildReportFromRows(
  rows: _TestRows,
  opts: CohortReportOpts,
): CohortReportResult {
  return _buildMarkdown(rows, opts);
}
