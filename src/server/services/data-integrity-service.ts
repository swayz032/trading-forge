/**
 * A8 — Data Integrity Service (consolidated reconciliation + drift detection)
 *
 * Single nightly service that runs two complementary check categories:
 *
 * Category 1 — Reconciliation: independent sources should agree.
 *   - Every audit_log.action='lifecycle.*' row has a matching lifecycle_transitions row
 *   - Every paper_trades row has a matching paper_positions lifecycle (open → close)
 *   - Every lifecycle_transitions.backtest_id actually exists in backtests
 *   - Every PAPER strategy has at least one paper_sessions row in a valid state
 *
 * Category 2 — Drift Detection: same input → same output.
 *   - Query backtest_provenance for backtests with same (data_hash + strategy_hash)
 *     but different result_hash values
 *   - Compute Population Stability Index (PSI) on Sharpe / PF / MaxDD distributions
 *   - Alert if PSI > 0.2 (industry-standard "significant drift" threshold)
 *
 * Findings are written to data_integrity_findings with a check_type discriminator
 * so reconciliation and drift findings are queryable independently or together.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dataIntegrityFindings } from "../db/schema.js";
import { createAlert } from "./alert-service.js";
import { logger } from "../lib/logger.js";

// ─── Finding shape ────────────────────────────────────────────────────────────

export type CheckType = "reconciliation" | "drift_detection";
export type Severity = "info" | "warning" | "critical";

export interface Finding {
  checkType: CheckType;
  checkName: string;
  severity: Severity;
  affectedEntityType?: string;
  affectedEntityId?: string;
  details: Record<string, unknown>;
}

// ─── PSI helper ──────────────────────────────────────────────────────────────

/**
 * Compute Population Stability Index between two numeric distributions.
 *
 * PSI = Σ (observed_i − expected_i) × ln(observed_i / expected_i)
 *
 * Distributions are binned into `numBuckets` equal-width deciles derived from
 * the combined min/max. A smoothing floor of 0.0001 prevents ln(0).
 *
 * Industry thresholds:
 *   PSI < 0.1   — no significant drift
 *   PSI 0.1–0.2 — moderate drift (warning)
 *   PSI > 0.2   — significant drift (alert)
 *   PSI > 0.5   — extreme drift (critical)
 *
 * Returns 0 if either distribution has fewer than 2 elements (insufficient data).
 */
export function computePSI(observed: number[], expected: number[], numBuckets = 10): number {
  if (observed.length < 2 || expected.length < 2) return 0;

  const allValues = [...observed, ...expected];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);

  // Degenerate case: all values are identical — no drift possible
  if (max === min) return 0;

  const bucketWidth = (max - min) / numBuckets;

  const bucketIndex = (v: number): number => {
    const idx = Math.floor((v - min) / bucketWidth);
    // Clamp last value to final bucket rather than numBuckets (out of range)
    return Math.min(idx, numBuckets - 1);
  };

  // Build frequency arrays
  const obsCounts = new Array<number>(numBuckets).fill(0);
  const expCounts = new Array<number>(numBuckets).fill(0);
  for (const v of observed) obsCounts[bucketIndex(v)]++;
  for (const v of expected) expCounts[bucketIndex(v)]++;

  // Convert counts to proportions with smoothing floor
  const SMOOTH = 0.0001;
  const obsPct = obsCounts.map((c) => Math.max(c / observed.length, SMOOTH));
  const expPct = expCounts.map((c) => Math.max(c / expected.length, SMOOTH));

  // PSI formula
  let psi = 0;
  for (let i = 0; i < numBuckets; i++) {
    psi += (obsPct[i] - expPct[i]) * Math.log(obsPct[i] / expPct[i]);
  }
  return psi;
}

// ─── Category 1: Reconciliation ──────────────────────────────────────────────

/**
 * Check 1a: Every audit_log row with action LIKE 'lifecycle.%' should have
 * a corresponding lifecycle_transitions row for the same entity_id.
 *
 * Lifecycle audit_log rows that have no lifecycle_transitions entry indicate
 * the dual-write contract in lifecycle-service.ts was violated or a partial
 * commit occurred.
 */
async function checkAuditLogLifecycleGaps(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Find audit_log lifecycle rows whose entity_id has no lifecycle_transitions row
  // created within 30 seconds (generous window for clock skew).
  const result = await db.execute(sql`
    SELECT al.id AS audit_id,
           al.entity_id,
           al.action,
           al.created_at
    FROM audit_log al
    LEFT JOIN lifecycle_transitions lt
      ON lt.strategy_id = al.entity_id
      AND ABS(EXTRACT(EPOCH FROM (lt.created_at - al.created_at))) < 30
    WHERE al.action LIKE 'lifecycle.%'
      AND al.entity_id IS NOT NULL
      AND lt.id IS NULL
      AND al.created_at > NOW() - INTERVAL '7 days'
    LIMIT 100
  `);

  const rows = Array.from(result) as Array<{
    audit_id: string;
    entity_id: string;
    action: string;
    created_at: Date;
  }>;

  if (rows.length === 0) {
    findings.push({
      checkType: "reconciliation",
      checkName: "audit_log_lifecycle_gap",
      severity: "info",
      details: {
        message: "All lifecycle audit_log rows have matching lifecycle_transitions entries",
        orphanCount: 0,
        windowDays: 7,
      },
    });
    return findings;
  }

  // Group by severity: < 5 orphans = warning, >= 5 = critical
  const severity: Severity = rows.length >= 5 ? "critical" : "warning";

  findings.push({
    checkType: "reconciliation",
    checkName: "audit_log_lifecycle_gap",
    severity,
    affectedEntityType: "strategy",
    details: {
      message: `${rows.length} lifecycle audit_log row(s) have no matching lifecycle_transitions entry`,
      orphanCount: rows.length,
      orphanAuditIds: rows.map((r) => r.audit_id),
      orphanEntityIds: [...new Set(rows.map((r) => r.entity_id))],
      windowDays: 7,
    },
  });

  return findings;
}

/**
 * Check 1b: Every paper_trades row should have a corresponding paper_positions
 * row in the same session (i.e. the trade exit links back to a closed position).
 *
 * Trades with no matching session position record indicate a paper execution
 * partial write or a position that was force-closed without proper lifecycle.
 */
async function checkPaperTradesPositionGaps(): Promise<Finding[]> {
  const findings: Finding[] = [];

  const result = await db.execute(sql`
    SELECT pt.id AS trade_id,
           pt.session_id,
           pt.symbol,
           pt.entry_time,
           pt.exit_time,
           pt.created_at
    FROM paper_trades pt
    WHERE NOT EXISTS (
      SELECT 1
      FROM paper_positions pp
      WHERE pp.session_id = pt.session_id
        AND pp.symbol = pt.symbol
        AND pp.entry_time <= pt.entry_time
    )
    AND pt.created_at > NOW() - INTERVAL '7 days'
    LIMIT 100
  `);

  const rows = Array.from(result) as Array<{
    trade_id: string;
    session_id: string;
    symbol: string;
    entry_time: Date;
    exit_time: Date;
    created_at: Date;
  }>;

  if (rows.length === 0) {
    findings.push({
      checkType: "reconciliation",
      checkName: "paper_trades_position_gap",
      severity: "info",
      details: {
        message: "All paper_trades rows have matching paper_positions lifecycle entries",
        orphanCount: 0,
        windowDays: 7,
      },
    });
    return findings;
  }

  const severity: Severity = rows.length >= 10 ? "critical" : "warning";

  findings.push({
    checkType: "reconciliation",
    checkName: "paper_trades_position_gap",
    severity,
    affectedEntityType: "paper_session",
    details: {
      message: `${rows.length} paper_trades row(s) have no matching paper_positions entry`,
      orphanCount: rows.length,
      orphanTradeIds: rows.map((r) => r.trade_id),
      orphanSessionIds: [...new Set(rows.map((r) => r.session_id))],
      windowDays: 7,
    },
  });

  return findings;
}

/**
 * Check 1c: Every lifecycle_transitions.backtest_id should reference an existing
 * backtests row. A dangling FK (possible if a backtest was hard-deleted outside
 * normal cascade) indicates referential integrity failure.
 */
async function checkLifecycleTransitionsBacktestFKs(): Promise<Finding[]> {
  const findings: Finding[] = [];

  const result = await db.execute(sql`
    SELECT lt.id AS transition_id,
           lt.strategy_id,
           lt.backtest_id,
           lt.from_state,
           lt.to_state,
           lt.created_at
    FROM lifecycle_transitions lt
    WHERE lt.backtest_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM backtests b WHERE b.id = lt.backtest_id
      )
      AND lt.created_at > NOW() - INTERVAL '30 days'
    LIMIT 100
  `);

  const rows = Array.from(result) as Array<{
    transition_id: string;
    strategy_id: string;
    backtest_id: string;
    from_state: string;
    to_state: string;
    created_at: Date;
  }>;

  if (rows.length === 0) {
    findings.push({
      checkType: "reconciliation",
      checkName: "lifecycle_transitions_backtest_fk",
      severity: "info",
      details: {
        message: "All lifecycle_transitions.backtest_id values reference existing backtests",
        orphanCount: 0,
        windowDays: 30,
      },
    });
    return findings;
  }

  findings.push({
    checkType: "reconciliation",
    checkName: "lifecycle_transitions_backtest_fk",
    severity: "critical",
    affectedEntityType: "strategy",
    details: {
      message: `${rows.length} lifecycle_transitions row(s) reference non-existent backtest_id`,
      orphanCount: rows.length,
      orphanTransitionIds: rows.map((r) => r.transition_id),
      orphanStrategyIds: [...new Set(rows.map((r) => r.strategy_id))],
      orphanBacktestIds: [...new Set(rows.map((r) => r.backtest_id))],
      windowDays: 30,
    },
  });

  return findings;
}

/**
 * Check 1d: Every strategy in PAPER lifecycle state should have at least one
 * paper_sessions row with status='active' or status='stopped'.
 *
 * A PAPER strategy with zero sessions indicates the lifecycle promotion happened
 * but session creation failed, which leaves the strategy in a phantom state.
 */
async function checkPaperStrategiesHaveSessions(): Promise<Finding[]> {
  const findings: Finding[] = [];

  const result = await db.execute(sql`
    SELECT s.id AS strategy_id,
           s.name AS strategy_name,
           s.lifecycle_state,
           s.lifecycle_changed_at
    FROM strategies s
    WHERE s.lifecycle_state = 'PAPER'
      AND NOT EXISTS (
        SELECT 1
        FROM paper_sessions ps
        WHERE ps.strategy_id = s.id
          AND ps.status IN ('active', 'stopped', 'paused')
      )
    LIMIT 50
  `);

  const rows = Array.from(result) as Array<{
    strategy_id: string;
    strategy_name: string;
    lifecycle_state: string;
    lifecycle_changed_at: Date;
  }>;

  if (rows.length === 0) {
    findings.push({
      checkType: "reconciliation",
      checkName: "paper_strategy_no_sessions",
      severity: "info",
      details: {
        message: "All PAPER strategies have at least one valid paper_sessions row",
        orphanCount: 0,
      },
    });
    return findings;
  }

  findings.push({
    checkType: "reconciliation",
    checkName: "paper_strategy_no_sessions",
    severity: "critical",
    affectedEntityType: "strategy",
    details: {
      message: `${rows.length} PAPER strategy/strategies have no matching paper_sessions row`,
      orphanCount: rows.length,
      orphanStrategyIds: rows.map((r) => r.strategy_id),
      orphanStrategyNames: rows.map((r) => r.strategy_name),
    },
  });

  return findings;
}

/**
 * Run all four reconciliation checks and return combined findings.
 */
export async function runReconciliationChecks(): Promise<Finding[]> {
  const t0 = Date.now();
  logger.info({ checkCategory: "reconciliation" }, "data-integrity: starting reconciliation checks");

  const [lifecycleGaps, positionGaps, backtestFKs, paperSessions] = await Promise.all([
    checkAuditLogLifecycleGaps(),
    checkPaperTradesPositionGaps(),
    checkLifecycleTransitionsBacktestFKs(),
    checkPaperStrategiesHaveSessions(),
  ]);

  const all = [...lifecycleGaps, ...positionGaps, ...backtestFKs, ...paperSessions];

  const critical = all.filter((f) => f.severity === "critical").length;
  const warnings = all.filter((f) => f.severity === "warning").length;

  logger.info(
    {
      checkCategory: "reconciliation",
      total: all.length,
      critical,
      warnings,
      durationMs: Date.now() - t0,
    },
    "data-integrity: reconciliation checks complete",
  );

  return all;
}

// ─── Category 2: Drift Detection ─────────────────────────────────────────────

/**
 * Detect metric drift by querying backtest_provenance for groups that share
 * the same (data_hash, strategy_hash) — meaning same market data + same strategy
 * logic — and computing PSI on the Sharpe / PF / MaxDD distributions across those
 * groups when we can correlate back to backtests metrics.
 *
 * PSI thresholds:
 *   < 0.1  — stable (info)
 *   0.1–0.2 — moderate drift (warning)
 *   > 0.2  — significant drift, alert (warning with PSI>0.2 note)
 *   > 0.5  — extreme drift (critical)
 */
export async function runDriftDetection(): Promise<Finding[]> {
  const t0 = Date.now();
  logger.info({ checkCategory: "drift_detection" }, "data-integrity: starting drift detection");

  const findings: Finding[] = [];

  // Step 1: find (data_hash, strategy_hash) groups with multiple distinct result_hashes.
  // These are the candidates where same inputs produced different outputs — nondeterminism
  // or true distribution shift across code versions.
  const groupResult = await db.execute(sql`
    SELECT bp.data_hash,
           bp.strategy_hash,
           COUNT(DISTINCT bp.result_hash) AS distinct_hashes,
           COUNT(DISTINCT bp.code_git_sha) AS distinct_git_shas,
           ARRAY_AGG(DISTINCT bp.backtest_id) AS backtest_ids,
           ARRAY_AGG(DISTINCT bp.code_git_sha) AS git_shas
    FROM backtest_provenance bp
    WHERE bp.created_at > NOW() - INTERVAL '30 days'
    GROUP BY bp.data_hash, bp.strategy_hash
    HAVING COUNT(DISTINCT bp.result_hash) > 1
    LIMIT 50
  `);

  const driftGroups = Array.from(groupResult) as Array<{
    data_hash: string;
    strategy_hash: string;
    distinct_hashes: number;
    distinct_git_shas: number;
    backtest_ids: string[];
    git_shas: string[];
  }>;

  if (driftGroups.length === 0) {
    findings.push({
      checkType: "drift_detection",
      checkName: "psi_distribution_drift",
      severity: "info",
      details: {
        message: "No metric distribution drift detected — all (data_hash, strategy_hash) groups produce consistent result_hashes",
        driftGroupCount: 0,
        windowDays: 30,
      },
    });

    logger.info(
      { checkCategory: "drift_detection", durationMs: Date.now() - t0, driftGroupCount: 0 },
      "data-integrity: drift detection complete — no drift groups found",
    );

    return findings;
  }

  // Step 2: for each drift group, pull the actual metric values from the backtests
  // table and compute PSI on Sharpe, PF, and MaxDD distributions.
  for (const group of driftGroups) {
    const backtestIds = group.backtest_ids;
    if (!backtestIds || backtestIds.length < 2) continue;

    // Query metrics for this group's backtests
    const metricsResult = await db.execute(sql`
      SELECT b.id,
             b.sharpe_ratio::float,
             b.profit_factor::float,
             b.max_drawdown::float,
             bp.code_git_sha,
             bp.result_hash
      FROM backtests b
      JOIN backtest_provenance bp ON bp.backtest_id = b.id
      WHERE b.id = ANY(${sql.raw(`ARRAY[${backtestIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
        AND b.status = 'completed'
        AND b.sharpe_ratio IS NOT NULL
        AND b.profit_factor IS NOT NULL
        AND b.max_drawdown IS NOT NULL
    `);

    const metrics = Array.from(metricsResult) as Array<{
      id: string;
      sharpe_ratio: number;
      profit_factor: number;
      max_drawdown: number;
      code_git_sha: string;
      result_hash: string;
    }>;

    if (metrics.length < 2) continue;

    // Split metrics into two populations: first git SHA vs rest
    // This compares "old code version distribution" against "new code version distribution"
    const gitShas = [...new Set(metrics.map((m) => m.code_git_sha))];
    if (gitShas.length < 2) continue;

    const baseline = metrics.filter((m) => m.code_git_sha === gitShas[0]);
    const current = metrics.filter((m) => m.code_git_sha !== gitShas[0]);

    if (baseline.length === 0 || current.length === 0) continue;

    const psiSharpe = computePSI(
      current.map((m) => m.sharpe_ratio),
      baseline.map((m) => m.sharpe_ratio),
    );
    const psiPF = computePSI(
      current.map((m) => m.profit_factor),
      baseline.map((m) => m.profit_factor),
    );
    const psiMaxDD = computePSI(
      current.map((m) => m.max_drawdown),
      baseline.map((m) => m.max_drawdown),
    );

    const maxPSI = Math.max(psiSharpe, psiPF, psiMaxDD);

    let severity: Severity;
    if (maxPSI > 0.5) {
      severity = "critical";
    } else if (maxPSI > 0.2) {
      severity = "warning";
    } else if (maxPSI > 0.1) {
      severity = "warning";
    } else {
      severity = "info";
    }

    findings.push({
      checkType: "drift_detection",
      checkName: "psi_distribution_drift",
      severity,
      affectedEntityType: "backtest",
      details: {
        message:
          maxPSI > 0.2
            ? `Significant metric distribution drift detected (max PSI ${maxPSI.toFixed(3)})`
            : maxPSI > 0.1
            ? `Moderate metric distribution drift detected (max PSI ${maxPSI.toFixed(3)})`
            : `No significant drift — PSI within acceptable range (max PSI ${maxPSI.toFixed(3)})`,
        dataHash: group.data_hash,
        strategyHash: group.strategy_hash,
        distinctResultHashes: group.distinct_hashes,
        distinctGitShas: group.distinct_git_shas,
        gitShas: group.git_shas,
        backtestIds: backtestIds,
        psi: {
          sharpe: Math.round(psiSharpe * 10000) / 10000,
          profitFactor: Math.round(psiPF * 10000) / 10000,
          maxDrawdown: Math.round(psiMaxDD * 10000) / 10000,
          max: Math.round(maxPSI * 10000) / 10000,
        },
        sampleSizes: {
          baseline: baseline.length,
          current: current.length,
        },
        thresholds: {
          warning: 0.1,
          significant: 0.2,
          critical: 0.5,
        },
      },
    });
  }

  // If we iterated but all groups had insufficient data, add a summary info finding
  if (findings.length === 0) {
    findings.push({
      checkType: "drift_detection",
      checkName: "psi_distribution_drift",
      severity: "info",
      details: {
        message: "Drift groups found but all had insufficient metric data for PSI computation",
        driftGroupCount: driftGroups.length,
        windowDays: 30,
      },
    });
  }

  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  logger.info(
    {
      checkCategory: "drift_detection",
      driftGroupsFound: driftGroups.length,
      findingCount: findings.length,
      critical,
      warnings,
      durationMs: Date.now() - t0,
    },
    "data-integrity: drift detection complete",
  );

  return findings;
}

// ─── Persistence helper ───────────────────────────────────────────────────────

/**
 * Atomically write a batch of findings to data_integrity_findings.
 * All inserts are in a single transaction. On any error the entire batch rolls back
 * so there are no partial findings from a failed run.
 */
async function persistFindings(findings: Finding[]): Promise<void> {
  if (findings.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.insert(dataIntegrityFindings).values(
      findings.map((f) => ({
        checkType: f.checkType,
        checkName: f.checkName,
        severity: f.severity,
        affectedEntityType: f.affectedEntityType ?? null,
        affectedEntityId: f.affectedEntityId ? f.affectedEntityId as `${string}-${string}-${string}-${string}-${string}` : null,
        details: f.details as Record<string, unknown>,
        resolved: false,
      })),
    );
  });

  logger.info(
    {
      count: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
    "data-integrity: findings persisted",
  );
}

// ─── Alert firing ─────────────────────────────────────────────────────────────

async function fireAlertsForFindings(findings: Finding[]): Promise<void> {
  const criticals = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");

  if (criticals.length > 0) {
    await createAlert({
      type: "system",
      severity: "critical",
      title: `Data integrity: ${criticals.length} critical finding(s)`,
      message: criticals
        .map((f) => `[${f.checkType}/${f.checkName}] ${String(f.details.message ?? f.checkName)}`)
        .join("\n"),
      metadata: {
        checkTypes: [...new Set(criticals.map((f) => f.checkType))],
        checkNames: criticals.map((f) => f.checkName),
        criticalCount: criticals.length,
      },
    }).catch((err: unknown) => {
      logger.warn({ err }, "data-integrity: failed to create critical alert (non-blocking)");
    });
  }

  if (warnings.length > 0) {
    await createAlert({
      type: "system",
      severity: "warning",
      title: `Data integrity: ${warnings.length} warning(s)`,
      message: warnings
        .map((f) => `[${f.checkType}/${f.checkName}] ${String(f.details.message ?? f.checkName)}`)
        .join("\n"),
      metadata: {
        checkTypes: [...new Set(warnings.map((f) => f.checkType))],
        checkNames: warnings.map((f) => f.checkName),
        warningCount: warnings.length,
      },
    }).catch((err: unknown) => {
      logger.warn({ err }, "data-integrity: failed to create warning alert (non-blocking)");
    });
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run the full data integrity suite: reconciliation + drift detection.
 *
 * Findings are written atomically per category (two separate transactions)
 * so a drift detection failure does not roll back reconciliation findings.
 * Alerts are fired after both persist calls succeed.
 */
export async function runFullDataIntegritySuite(): Promise<{
  reconciliationFindings: Finding[];
  driftFindings: Finding[];
  totalFindings: number;
  criticalCount: number;
  warningCount: number;
  durationMs: number;
}> {
  const t0 = Date.now();
  const runAt = new Date().toISOString();

  logger.info({ runAt }, "data-integrity: starting full suite");

  // Run both categories, allowing one to fail without aborting the other.
  // Declared without initializer — guaranteed reassigned in try OR catch
  // (lint: no-useless-assignment requires no dead default value).
  let reconciliationFindings: Finding[];
  let driftFindings: Finding[];

  try {
    reconciliationFindings = await runReconciliationChecks();
    await persistFindings(reconciliationFindings);
  } catch (err: unknown) {
    logger.error({ err }, "data-integrity: reconciliation checks failed");
    reconciliationFindings = [
      {
        checkType: "reconciliation",
        checkName: "suite_error",
        severity: "critical",
        details: {
          message: "Reconciliation suite threw an unexpected error",
          error: err instanceof Error ? err.message : String(err),
        },
      },
    ];
    // Best-effort persist the error finding
    await persistFindings(reconciliationFindings).catch(() => {});
  }

  try {
    driftFindings = await runDriftDetection();
    await persistFindings(driftFindings);
  } catch (err: unknown) {
    logger.error({ err }, "data-integrity: drift detection failed");
    driftFindings = [
      {
        checkType: "drift_detection",
        checkName: "suite_error",
        severity: "critical",
        details: {
          message: "Drift detection suite threw an unexpected error",
          error: err instanceof Error ? err.message : String(err),
        },
      },
    ];
    await persistFindings(driftFindings).catch(() => {});
  }

  const allFindings = [...reconciliationFindings, ...driftFindings];
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;
  const durationMs = Date.now() - t0;

  // Fire consolidated alerts
  await fireAlertsForFindings(allFindings).catch((err: unknown) => {
    logger.warn({ err }, "data-integrity: alert firing failed (non-blocking)");
  });

  logger.info(
    {
      runAt,
      totalFindings: allFindings.length,
      criticalCount,
      warningCount,
      reconciliationCount: reconciliationFindings.length,
      driftCount: driftFindings.length,
      durationMs,
    },
    "data-integrity: full suite complete",
  );

  return {
    reconciliationFindings,
    driftFindings,
    totalFindings: allFindings.length,
    criticalCount,
    warningCount,
    durationMs,
  };
}
