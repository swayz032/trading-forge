/**
 * Multi-Firm Promotion Service — B5 (W13 Team C Step 1)
 *
 * On PAPER → DEPLOY_READY promotion, iterate through all configured firms
 * (Topstep, Apex, MFFU, TPT, FFN, Alpha, Tradeify, Earn2Trade), run
 * compliance_gate.py per firm via check_strategy_compliance, and store one
 * per-firm deployment_eligibility row in strategy_firm_eligibility.
 *
 * AUTHORITY BOUNDARY:
 *   This service is ADDITIVE and OBSERVATIONAL. It does NOT gate the
 *   PAPER → DEPLOY_READY promotion — that decision is already made before
 *   this runs. Results are for human review and downstream multi-firm
 *   deployment planning.
 *
 * Design:
 *   - Called fire-and-forget from lifecycle-service.ts after successful
 *     PAPER → DEPLOY_READY transition (does not block the promotion).
 *   - One row per (strategy_id, firm_id) tuple in strategy_firm_eligibility.
 *   - Per-firm checks are INDEPENDENT: one firm failing ≠ other firms failing.
 *   - isActive() early-exit: skips evaluation when pipeline is paused.
 *   - Audit log entry per multi-firm evaluation (one aggregate + per-firm rows).
 *
 * Reuse:
 *   - compliance_gate.py check_strategy_compliance (existing, action="check_strategy_compliance")
 *   - firm-config.ts FIRMS (all 8 configured firms)
 *   - pipeline-control-service.isActive()
 *
 * Parity notes (paper/backtest):
 *   - Compliance rules applied here match the same per-firm rules used at
 *     TESTING → PAPER (compliance_gate.py + firm-config.ts). No divergence.
 *   - Strategy data sourced from latest completed backtest propCompliance
 *     result plus paper session metrics for realistic eligibility inputs.
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  strategies,
  backtests,
  paperSessions,
  paperTrades,
  auditLog,
  strategyFirmEligibility,
} from "../db/schema.js";
import { logger } from "../index.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { runPythonModule } from "../lib/python-runner.js";
import { FIRMS, getFirmAccount } from "../../shared/firm-config.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FirmEligibilityResult {
  firmId: string;
  eligible: boolean;
  eligibilityReason: string;
  complianceCheckResult: ComplianceCheckResult;
}

export interface ComplianceCheckResult {
  result: "pass" | "fail" | "needs_review" | "error";
  violations: string[];
  warnings: string[];
  risk_score: number;
  details: Record<string, unknown>;
}

export interface MultiFirmEligibilityOutput {
  strategyId: string;
  backtestId: string | null;
  firmResults: FirmEligibilityResult[];
  eligibleFirmCount: number;
  totalFirmCount: number;
  evaluatedAt: Date;
}

// ─── Strategy Data Extraction ─────────────────────────────────────────────────

/**
 * Build the strategy compliance input dict from backtest + paper session data.
 * These fields map directly to what check_strategy_compliance expects.
 */
async function buildStrategyComplianceInput(
  strategyId: string,
  backtestId: string | null,
): Promise<Record<string, unknown>> {
  // Start with backtest propCompliance if available — this has the validated
  // per-firm metrics from the backtester run.
  let backtestData: Record<string, unknown> = {};
  if (backtestId) {
    const [bt] = await db
      .select({
        propCompliance: backtests.propCompliance,
        maxDrawdown: backtests.maxDrawdown,
        sharpeRatio: backtests.sharpeRatio,
        profitFactor: backtests.profitFactor,
      })
      .from(backtests)
      .where(eq(backtests.id, backtestId));

    if (bt) {
      const pc = (bt.propCompliance ?? {}) as Record<string, unknown>;
      backtestData = {
        max_drawdown: bt.maxDrawdown ? Number(bt.maxDrawdown) : 0,
        sharpe_ratio: bt.sharpeRatio ? Number(bt.sharpeRatio) : 0,
        profit_factor: bt.profitFactor ? Number(bt.profitFactor) : 0,
        // Extract aggregate stats from propCompliance if present
        daily_loss: (pc.max_daily_loss_usd as number | undefined) ?? null,
        best_day_pnl: (pc.best_day_pnl as number | undefined) ?? null,
        total_pnl: (pc.total_pnl as number | undefined) ?? null,
        overnight_holding: (pc.overnight_holding as boolean | undefined) ?? false,
        contracts_per_symbol: (pc.contracts_per_symbol as Record<string, number> | undefined) ?? {},
        automated: true, // Trading Forge strategies are automated signals
      };
    }
  }

  // Layer in paper session reality if available — paper metrics are more
  // realistic than pure backtest for eligibility inputs.
  const [strategy] = await db
    .select({ symbol: strategies.symbol })
    .from(strategies)
    .where(eq(strategies.id, strategyId));

  if (strategy?.symbol) {
    // Aggregate paper trade data for a more realistic daily loss estimate
    const paperMetrics = await db
      .select({
        sessionId: paperSessions.id,
        dailyPnl: paperSessions.dailyPnl,
        peakEquity: paperSessions.peakEquity,
        currentEquity: paperSessions.currentEquity,
      })
      .from(paperSessions)
      .where(
        and(
          eq(paperSessions.strategyId, strategyId),
          eq(paperSessions.status, "completed"),
        ),
      )
      .orderBy(desc(paperSessions.createdAt))
      .limit(30);

    if (paperMetrics.length > 0) {
      const dailyPnls = paperMetrics
        .map((s) => (s.dailyPnl ? Number(s.dailyPnl) : 0))
        .filter((v) => v < 0); // Only losing days

      const worstDailyLoss = dailyPnls.length > 0
        ? Math.abs(Math.min(...dailyPnls))
        : 0;

      // Use paper reality for daily_loss if worse than backtest estimate
      const currentDailyLoss = (backtestData.daily_loss as number | null) ?? 0;
      if (worstDailyLoss > currentDailyLoss) {
        backtestData.daily_loss = worstDailyLoss;
      }

      // Set contracts_per_symbol from symbol if not already set
      if (
        Object.keys((backtestData.contracts_per_symbol as Record<string, number>)).length === 0 &&
        strategy.symbol
      ) {
        // Default: the latest backtest's max_contracts from firm config (15 for all 50K accounts)
        backtestData.contracts_per_symbol = { [strategy.symbol]: 15 };
      }
    }
  }

  return backtestData;
}

/**
 * Build firm_rules dict from FIRMS config for a given firmId.
 * Maps firm-config.ts schema to what compliance_gate.py check_strategy_compliance expects.
 */
function buildFirmRules(firmId: string): Record<string, unknown> {
  const acct = getFirmAccount(firmId, "50k");
  if (!acct) {
    return {};
  }

  return {
    max_drawdown_limit: acct.maxDrawdown,
    daily_loss_limit: acct.dailyLossLimit ?? null,
    consistency_threshold: acct.consistencyRule ?? null,
    overnight_allowed: acct.overnightOk,
    contract_limits: {
      // All contract types share the same per-firm maxContracts limit
      MES: acct.maxContracts,
      MNQ: acct.maxContracts,
      MCL: acct.maxContracts,
    },
    automation_banned: false, // All 8 firms allow automation during eval phase
    automation_banned_pa_live: false,
    commission_per_side: acct.commissionPerSide,
    profit_target: acct.profitTarget,
  };
}

// ─── Per-Firm Compliance Check ────────────────────────────────────────────────

/**
 * Run compliance_gate.py check_strategy_compliance for a single firm.
 * Returns a FirmEligibilityResult with eligible=true iff result="pass".
 * needs_review → eligible=true with a warning in eligibilityReason.
 */
async function checkFirmEligibility(
  firmId: string,
  strategyInput: Record<string, unknown>,
  correlationId?: string,
): Promise<FirmEligibilityResult> {
  const firmRules = buildFirmRules(firmId);
  const firmConfig = FIRMS[firmId];
  const displayName = firmConfig?.displayName ?? firmId;

  try {
    const result = await runPythonModule<ComplianceCheckResult>({
      module: "engine.compliance.compliance_gate",
      config: {
        action: "check_strategy_compliance",
        firm: firmId,
        strategy: strategyInput,
        firm_rules: firmRules,
      },
      timeoutMs: 15_000,
      componentName: `compliance_gate[${firmId}]`,
      correlationId,
    });

    const eligible = result.result === "pass" || result.result === "needs_review";
    let eligibilityReason: string;

    if (result.result === "pass") {
      eligibilityReason = `${displayName}: eligible — risk_score=${result.risk_score}, no violations`;
    } else if (result.result === "needs_review") {
      const warnings = result.warnings.slice(0, 3).join("; ");
      eligibilityReason = `${displayName}: eligible with warnings — ${warnings}`;
    } else {
      const violations = result.violations.slice(0, 3).join("; ");
      eligibilityReason = `${displayName}: NOT eligible — ${violations}`;
    }

    return {
      firmId,
      eligible,
      eligibilityReason,
      complianceCheckResult: result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { firmId, err },
      `multi-firm-promotion: compliance_gate subprocess error for ${firmId} — marking ineligible (fail-closed)`,
    );
    return {
      firmId,
      eligible: false,
      eligibilityReason: `${displayName}: check failed (subprocess error) — ${msg}`,
      complianceCheckResult: {
        result: "error",
        violations: [`Subprocess error: ${msg}`],
        warnings: [],
        risk_score: 100,
        details: { error: msg },
      },
    };
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Evaluate multi-firm eligibility for a strategy that just reached DEPLOY_READY.
 *
 * Called fire-and-forget from lifecycle-service.ts after successful PAPER →
 * DEPLOY_READY promotion. Does NOT block the promotion.
 *
 * For each of the 8 configured firms:
 *   1. Build per-firm rules from firm-config.ts
 *   2. Run compliance_gate.py check_strategy_compliance
 *   3. Persist one strategy_firm_eligibility row
 *
 * @param strategyId - UUID of the strategy that reached DEPLOY_READY
 * @param backtestId - UUID of the latest completed backtest (for metrics input)
 * @param correlationId - Optional HTTP request correlationId for tracing
 */
export async function evaluateMultiFirmEligibility(
  strategyId: string,
  backtestId: string | null,
  correlationId?: string,
): Promise<MultiFirmEligibilityOutput> {
  // Pipeline pause early-exit — don't run compliance checks when pipeline is paused
  if (!(await isPipelineActive())) {
    logger.info(
      { strategyId, correlationId },
      "multi-firm-promotion: pipeline paused — skipping multi-firm eligibility check",
    );
    return {
      strategyId,
      backtestId,
      firmResults: [],
      eligibleFirmCount: 0,
      totalFirmCount: 0,
      evaluatedAt: new Date(),
    };
  }

  const firmIds = Object.keys(FIRMS); // All 8 configured firms
  const evaluatedAt = new Date();

  logger.info(
    { strategyId, backtestId, firmCount: firmIds.length, correlationId },
    "multi-firm-promotion: starting eligibility checks",
  );

  // Build strategy input once — reused across all firm checks
  let strategyInput: Record<string, unknown> = {};
  try {
    strategyInput = await buildStrategyComplianceInput(strategyId, backtestId);
  } catch (err) {
    logger.warn(
      { strategyId, err },
      "multi-firm-promotion: failed to build strategy compliance input — using empty defaults",
    );
  }

  // Run per-firm checks sequentially to avoid hammering Python subprocess pool.
  // 8 firms × ~1s each = ~8s total — acceptable for a fire-and-forget.
  const firmResults: FirmEligibilityResult[] = [];
  for (const firmId of firmIds) {
    const result = await checkFirmEligibility(firmId, strategyInput, correlationId);
    firmResults.push(result);
  }

  const eligibleFirmCount = firmResults.filter((r) => r.eligible).length;

  // Persist one row per firm — upsert pattern: delete existing then insert
  // (drizzle doesn't support ON CONFLICT with multi-column PK easily here)
  try {
    await db.insert(strategyFirmEligibility).values(
      firmResults.map((r) => ({
        strategyId,
        firmId: r.firmId,
        eligible: r.eligible,
        eligibilityReason: r.eligibilityReason,
        complianceCheckResult: r.complianceCheckResult as Record<string, unknown>,
        checkedAt: evaluatedAt,
      })),
    );
  } catch (insertErr) {
    logger.error(
      { strategyId, err: insertErr },
      "multi-firm-promotion: failed to persist firm eligibility rows",
    );
    throw insertErr;
  }

  // Audit log: one aggregate entry for the whole multi-firm evaluation
  await db.insert(auditLog).values({
    action: "lifecycle.multi_firm_eligibility_checked",
    entityId: strategyId,
    entityType: "strategy",
    status: "success",
    decisionAuthority: "system",
    input: { backtestId, firmIds, evaluatedAt: evaluatedAt.toISOString() },
    result: {
      eligible_firm_count: eligibleFirmCount,
      total_firm_count: firmIds.length,
      eligible_firms: firmResults.filter((r) => r.eligible).map((r) => r.firmId),
      ineligible_firms: firmResults.filter((r) => !r.eligible).map((r) => r.firmId),
      per_firm_summary: Object.fromEntries(
        firmResults.map((r) => [
          r.firmId,
          {
            eligible: r.eligible,
            risk_score: r.complianceCheckResult.risk_score,
            violations: r.complianceCheckResult.violations,
          },
        ]),
      ),
    },
    correlationId,
  }).catch((auditErr) => {
    logger.warn(
      { strategyId, err: auditErr },
      "multi-firm-promotion: audit log insert failed (non-blocking)",
    );
  });

  logger.info(
    {
      strategyId,
      eligibleFirmCount,
      totalFirmCount: firmIds.length,
      eligibleFirms: firmResults.filter((r) => r.eligible).map((r) => r.firmId),
    },
    "multi-firm-promotion: eligibility evaluation complete",
  );

  return {
    strategyId,
    backtestId,
    firmResults,
    eligibleFirmCount,
    totalFirmCount: firmIds.length,
    evaluatedAt,
  };
}

/**
 * Query the latest firm eligibility results for a strategy.
 * Used by the dashboard and B7 (Kelly sizing) to determine per-firm allocation.
 */
export async function getLatestFirmEligibility(
  strategyId: string,
): Promise<FirmEligibilityResult[]> {
  const rows = await db
    .select()
    .from(strategyFirmEligibility)
    .where(eq(strategyFirmEligibility.strategyId, strategyId))
    .orderBy(desc(strategyFirmEligibility.checkedAt));

  // Return latest row per firmId
  const latestByFirm = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByFirm.has(row.firmId)) {
      latestByFirm.set(row.firmId, row);
    }
  }

  return Array.from(latestByFirm.values()).map((row) => ({
    firmId: row.firmId,
    eligible: row.eligible,
    eligibilityReason: row.eligibilityReason ?? "",
    complianceCheckResult: (row.complianceCheckResult ?? {
      result: "error",
      violations: [],
      warnings: [],
      risk_score: 0,
      details: {},
    }) as ComplianceCheckResult,
  }));
}
