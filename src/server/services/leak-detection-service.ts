/**
 * leak-detection-service.ts — Wave 4 Track 4B: Layer 15 Leak Detection Engine
 *
 * ADVISORY-ONLY — this service NEVER gates lifecycle transitions or promotions.
 * It observes DEPLOYED + PAPER strategies and surfaces degradation signals.
 *
 * ─── 6-Category taxonomy ────────────────────────────────────────────────────
 *
 * 1. EXECUTION_SLIPPAGE — avg(|slippage|) 20d z-score vs 60d baseline
 *    Source: paper_trades.slippage (joined through paper_sessions)
 *
 * 2. ALLOCATION_DRIFT — contracts used 20d z-score vs 60d baseline
 *    Source: paper_trades.contracts
 *    Detects: sizing path changes (drawdown room constraint, account state drift)
 *
 * 3. REGIME — current institutional_regime vs strategy's trained/preferred regimes
 *    Source: bias_state.evidence->>'institutional_regime'
 *            strategies.regime_trained_on / preferred_regimes
 *    Detects: trading outside trained regime without re-validation
 *
 * 4. ATTRIBUTION_OPACITY — fraction of recent critiques with data_completeness='minimal'
 *    or missing smt_score / regime_state in technical_diagnosis JSONB
 *    Source: trade_critique
 *    Detects: bot trading semi-blind (regime/SMT context unavailable)
 *
 * 5. SUBSYSTEM_CONSENSUS — composite_score drop > threshold AND ≥ N subsystems regressed
 *    Source: strategy_health_scores (latest vs prior row)
 *    Detects: broad internal health degradation before it manifests in live P&L
 *
 * 6. MC_DISTRIBUTION_BREACH — realized paper metrics vs promotion-time MC distribution
 *    Source: lifecycle_transitions.backtest_id → monte_carlo_runs (sharpe_p5, max_drawdown_p95)
 *            paper_trades.pnl (realized Sharpe + realized max-drawdown via equity curve)
 *    Detects: live performance is a tail outcome of its own MC distribution —
 *             early signal of regime shift or promotion-time overfit
 *    Point-in-time: uses FROZEN MC from the promotion lifecycle transition, never re-runs MC.
 *    Sample gate: skips if fewer than LEAK_MC_MIN_TRADES closed trades exist (no noise alarm).
 *
 * ─── Audit actions emitted ───────────────────────────────────────────────────
 *   layer15.leak_detected.execution_slippage     (info|warning|high)
 *   layer15.leak_detected.allocation_drift       (info|warning|high)
 *   layer15.leak_detected.regime                 (info|warning|high)
 *   layer15.leak_detected.attribution_opacity    (info|warning|high)
 *   layer15.leak_detected.subsystem_consensus    (info|warning|high)
 *   layer15.leak_detected.mc_distribution_breach (warning|high)
 *   layer15.run_completed                        (info — run summary)
 *   layer15.category_error                       (info — per-category read failure)
 *
 * ─── Discord alerts ──────────────────────────────────────────────────────────
 *   notifyWarning fires ONLY on severity='high'.
 *   Fail-soft: any notification failure is logged and never throws.
 *
 * ─── Env vars ────────────────────────────────────────────────────────────────
 *   LEAK_ENABLED                   (default: true)   — kill switch
 *   LEAK_LOOKBACK_DAYS             (default: 60)     — history window in days
 *   LEAK_SLIPPAGE_ZSCORE_HIGH      (default: 2.0)    — z-score → 'high'
 *   LEAK_SLIPPAGE_ZSCORE_WARN      (default: 1.0)    — z-score → 'warning'
 *   LEAK_ALLOCATION_ZSCORE_HIGH    (default: 2.0)    — z-score → 'high'
 *   LEAK_ALLOCATION_ZSCORE_WARN    (default: 1.0)    — z-score → 'warning'
 *   LEAK_COMPOSITE_DROP_THRESHOLD  (default: 0.15)   — composite drop threshold
 *   LEAK_MIN_REGRESSED_SUBSYSTEMS  (default: 3)      — min subsystems regressed
 *   LEAK_OPACITY_HIGH_PCT          (default: 0.50)   — minimal critique fraction → 'high'
 *   LEAK_OPACITY_WARN_PCT          (default: 0.25)   — minimal critique fraction → 'warning'
 *   LEAK_MC_MIN_TRADES             (default: 20)     — min closed trades for MC check
 *   LEAK_MC_DD_SEVERE_MULT         (default: 1.5)    — realized DD > mult×P95 → 'high'
 *
 * ─── Import notes ────────────────────────────────────────────────────────────
 *   logger from ./logger.js (leaf module — do NOT import from ../index.js)
 */

import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  auditLog,
  biasState,
  lifecycleTransitions,
  monteCarloRuns,
  paperSessions,
  paperTrades,
  strategies,
  strategyHealthScores,
  tradeCritique,
} from "../db/schema.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import {
  classifyFractionSeverity,
  classifyZScoreSeverity,
  computeMaxDrawdownFromPnls,
  computeMcDistributionBreach,
  computeSharpeFromPnls,
  computeZScore,
  splitWindows,
  type LeakSeverity,
} from "../lib/leak-metrics.js";
import { layer15LeakDetectionsTotal, layer15RunDurationMs } from "../lib/metrics-registry.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { logger } from "../lib/logger.js";
import { notifyWarning } from "./notification-service.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type LeakCategory =
  | "execution_slippage"
  | "allocation_drift"
  | "regime"
  | "attribution_opacity"
  | "subsystem_consensus"
  | "mc_distribution_breach";

export interface LeakFinding {
  /** One of the 6 Layer 15 taxonomy categories */
  category: LeakCategory;
  /** Info = FYI, warning = monitor, high = investigate now */
  severity: LeakSeverity;
  /** UUID of the affected strategy */
  strategyId: string;
  /** Display name for Discord messages */
  strategyName: string;
  /** Structured evidence payload — queryable in audit_log.result */
  evidence: Record<string, unknown>;
  /** Human-readable action for the operator */
  recommendedAction: string;
}

export interface LeakDetectionResult {
  run_id: string;
  started_at: string;
  completed_at: string;
  strategies_scanned: number;
  leaks: LeakFinding[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getCfg() {
  return {
    enabled: process.env.LEAK_ENABLED !== "false",
    lookbackDays: Math.max(1, parseInt(process.env.LEAK_LOOKBACK_DAYS ?? "60", 10)),
    slippageZHigh: parseFloat(process.env.LEAK_SLIPPAGE_ZSCORE_HIGH ?? "2.0"),
    slippageZWarn: parseFloat(process.env.LEAK_SLIPPAGE_ZSCORE_WARN ?? "1.0"),
    allocZHigh: parseFloat(process.env.LEAK_ALLOCATION_ZSCORE_HIGH ?? "2.0"),
    allocZWarn: parseFloat(process.env.LEAK_ALLOCATION_ZSCORE_WARN ?? "1.0"),
    compositeDropThreshold: parseFloat(
      process.env.LEAK_COMPOSITE_DROP_THRESHOLD ?? "0.15",
    ),
    minRegressedSubsystems: parseInt(
      process.env.LEAK_MIN_REGRESSED_SUBSYSTEMS ?? "3",
      10,
    ),
    opacityHighPct: parseFloat(process.env.LEAK_OPACITY_HIGH_PCT ?? "0.50"),
    opacityWarnPct: parseFloat(process.env.LEAK_OPACITY_WARN_PCT ?? "0.25"),
    mcMinTrades: Math.max(1, parseInt(process.env.LEAK_MC_MIN_TRADES ?? "20", 10)),
    mcDdSevereMult: parseFloat(process.env.LEAK_MC_DD_SEVERE_MULT ?? "1.5"),
  } as const;
}

// Observable lifecycle states (advisory scope — not gating these)
const OBSERVABLE_STATES = ["DEPLOYED", "PAPER"] as const;

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the Layer 15 leak detection scan.
 *
 * @param targetStrategyIds  Optional set of strategy UUIDs. When omitted, all
 *                           DEPLOYED + PAPER strategies are scanned.
 * @param correlationId      Optional correlation ID for tracing the caller.
 */
export async function runLeakDetection(
  targetStrategyIds?: string[],
  correlationId?: string,
): Promise<LeakDetectionResult> {
  const cfg = getCfg();
  const runId = randomUUID();
  const runCorrelationId = correlationId ?? randomUUID();
  const startedAt = new Date();

  if (!cfg.enabled) {
    logger.info({ runId }, "layer15: LEAK_ENABLED=false — skipping run");
    return {
      run_id: runId,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      strategies_scanned: 0,
      leaks: [],
    };
  }

  // ─── 1. Resolve strategy IDs ──────────────────────────────────────────────
  let strategyIds: string[];
  let strategyMeta: Array<{
    id: string;
    name: string;
    lifecycleState: string;
    preferredRegimes: string[] | null;
    regimeTrainedOn: string | null;
    symbol: string;
  }>;

  try {
    const query = db
      .select({
        id: strategies.id,
        name: strategies.name,
        lifecycleState: strategies.lifecycleState,
        preferredRegimes: strategies.preferredRegimes,
        regimeTrainedOn: strategies.regimeTrainedOn,
        symbol: strategies.symbol,
      })
      .from(strategies);

    const rows =
      targetStrategyIds && targetStrategyIds.length > 0
        ? await query.where(
            and(
              inArray(strategies.id, targetStrategyIds),
              inArray(strategies.lifecycleState, [...OBSERVABLE_STATES]),
            ),
          )
        : await query.where(
            inArray(strategies.lifecycleState, [...OBSERVABLE_STATES]),
          );

    strategyMeta = rows;
    strategyIds = rows.map((r) => r.id);
  } catch (err) {
    logger.error({ err, runId }, "layer15: failed to resolve strategy IDs");
    return {
      run_id: runId,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      strategies_scanned: 0,
      leaks: [],
    };
  }

  if (strategyIds.length === 0) {
    return {
      run_id: runId,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      strategies_scanned: 0,
      leaks: [],
    };
  }

  // ─── 2. Run all 5 categories (fail-soft per category) ────────────────────
  const allLeaks: LeakFinding[] = [];
  const cutoff = new Date(Date.now() - cfg.lookbackDays * 24 * 60 * 60 * 1000);

  const categoryRunners: Array<{
    name: LeakCategory;
    fn: () => Promise<LeakFinding[]>;
  }> = [
    {
      name: "execution_slippage",
      fn: () => detectExecutionSlippage(strategyIds, strategyMeta, cutoff, cfg),
    },
    {
      name: "allocation_drift",
      fn: () => detectAllocationDrift(strategyIds, strategyMeta, cutoff, cfg),
    },
    {
      name: "regime",
      fn: () => detectRegimeLeak(strategyIds, strategyMeta, cfg),
    },
    {
      name: "attribution_opacity",
      fn: () => detectAttributionOpacity(strategyIds, strategyMeta, cutoff, cfg),
    },
    {
      name: "subsystem_consensus",
      fn: () => detectSubsystemConsensus(strategyIds, strategyMeta, cfg),
    },
    {
      name: "mc_distribution_breach",
      fn: () => detectMcDistributionBreach(strategyIds, strategyMeta, cutoff, cfg),
    },
  ];

  for (const { name, fn } of categoryRunners) {
    try {
      const findings = await fn();
      allLeaks.push(...findings);
    } catch (err) {
      logger.warn({ err, category: name, runId }, "layer15: category read error — skipping");
      await insertAuditRowSafe({
        action: "layer15.category_error",
        entityType: "strategy",
        status: "failure",
        decisionAuthority: "agent",
        correlationId: runCorrelationId,
        input: { category: name, runId },
        result: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ─── 3. Persist each finding as an audit row + Discord on 'high' ─────────
  for (const finding of allLeaks) {
    const auditAction = `layer15.leak_detected.${finding.category}` as const;

    await insertAuditRowSafe({
      action: auditAction,
      entityType: "strategy",
      entityId: finding.strategyId as `${string}-${string}-${string}-${string}-${string}`,
      status: finding.severity === "high" ? "failure" : "pending",
      decisionAuthority: "agent",
      correlationId: runCorrelationId,
      input: { runId, strategyName: finding.strategyName },
      result: {
        severity: finding.severity,
        evidence: finding.evidence,
        recommendedAction: finding.recommendedAction,
      },
    });

    // Increment Prometheus counter
    layer15LeakDetectionsTotal.labels({ category: finding.category, severity: finding.severity }).inc();

    // Discord WARN only on 'high' severity — no noise on info/warning
    if (finding.severity === "high") {
      try {
        const body = appendFamilyGradePostscript(
          `Strategy **${finding.strategyName}** has a Layer 15 **${finding.category}** leak (${finding.severity}).\n` +
            `Recommended action: ${finding.recommendedAction}\n` +
            `Evidence: ${JSON.stringify(finding.evidence)}`,
          `The trading bot detected a potential performance issue with the "${finding.strategyName}" strategy.`,
          "No action required now. Monitor the dashboard and notify Tony if you see similar alerts repeatedly.",
        );
        notifyWarning(`Layer 15 Leak: ${finding.category}`, body, {
          strategyId: finding.strategyId,
          severity: finding.severity,
          runId,
        });
      } catch (err) {
        logger.warn({ err, finding }, "layer15: Discord notify failed — continuing");
      }
    }
  }

  // ─── 4. Run completion audit row + duration metric ────────────────────────
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  layer15RunDurationMs.observe(durationMs);

  await insertAuditRowSafe({
    action: "layer15.run_completed",
    entityType: "strategy",
    status: "success",
    decisionAuthority: "agent",
    correlationId: runCorrelationId,
    input: {
      runId,
      targetStrategyIds: targetStrategyIds ?? null,
    },
    result: {
      strategiesScanned: strategyIds.length,
      leaksFound: allLeaks.length,
      highCount: allLeaks.filter((l) => l.severity === "high").length,
      warningCount: allLeaks.filter((l) => l.severity === "warning").length,
      durationMs,
    },
  });

  logger.info(
    {
      runId,
      strategiesScanned: strategyIds.length,
      leaksFound: allLeaks.length,
      durationMs,
    },
    "layer15: run completed",
  );

  return {
    run_id: runId,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    strategies_scanned: strategyIds.length,
    leaks: allLeaks,
  };
}

// ─── Category 1: Execution Slippage ──────────────────────────────────────────

async function detectExecutionSlippage(
  strategyIds: string[],
  strategyMeta: Array<{ id: string; name: string }>,
  cutoff: Date,
  cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  // Fetch paper trades with non-null slippage for all target strategies
  const rows = await db
    .select({
      strategyId: paperSessions.strategyId,
      slippage: paperTrades.slippage,
      exitTime: paperTrades.exitTime,
    })
    .from(paperTrades)
    .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
    .where(
      and(
        inArray(paperSessions.strategyId, strategyIds),
        isNotNull(paperTrades.slippage),
        gte(paperTrades.exitTime, cutoff),
      ),
    )
    .orderBy(paperTrades.exitTime);

  const findings: LeakFinding[] = [];

  // Group by strategy
  const byStrategy = groupBy(rows, (r) => r.strategyId ?? "");

  for (const [strategyId, trades] of byStrategy.entries()) {
    if (!strategyId) continue;
    const meta = strategyMeta.find((s) => s.id === strategyId);
    const strategyName = meta?.name ?? strategyId;

    // Build sorted absolute slippage time-series (oldest-first)
    const absSlippages = trades
      .sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime())
      .map((t) => Math.abs(parseFloat(String(t.slippage ?? "0"))));

    if (absSlippages.length < 5) continue; // insufficient data — skip silently

    const { window20d, baseline60d } = splitWindows(absSlippages);
    const zScore = computeZScore(window20d, baseline60d);

    if (zScore === null) continue;

    const severity = classifyZScoreSeverity(zScore, cfg.slippageZHigh, cfg.slippageZWarn);
    if (severity === "info" && Math.abs(zScore) < 0.5) continue; // no signal

    const avg20d = window20d.reduce((a, b) => a + b, 0) / (window20d.length || 1);
    const avg60d =
      baseline60d.reduce((a, b) => a + b, 0) / (baseline60d.length || 1);

    findings.push({
      category: "execution_slippage",
      severity,
      strategyId,
      strategyName,
      evidence: {
        zScore: round2(zScore),
        avg20dSlippage: round2(avg20d),
        avg60dSlippage: round2(avg60d),
        tradeCount: absSlippages.length,
        window20dCount: window20d.length,
        baseline60dCount: baseline60d.length,
      },
      recommendedAction:
        severity === "high"
          ? "Investigate fill quality on recent trades. Check broker latency and limit-order distance."
          : "Monitor — slippage trending higher than baseline.",
    });
  }

  return findings;
}

// ─── Category 2: Allocation Drift ────────────────────────────────────────────

async function detectAllocationDrift(
  strategyIds: string[],
  strategyMeta: Array<{ id: string; name: string }>,
  cutoff: Date,
  cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  const rows = await db
    .select({
      strategyId: paperSessions.strategyId,
      contracts: paperTrades.contracts,
      exitTime: paperTrades.exitTime,
    })
    .from(paperTrades)
    .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
    .where(
      and(
        inArray(paperSessions.strategyId, strategyIds),
        gte(paperTrades.exitTime, cutoff),
      ),
    )
    .orderBy(paperTrades.exitTime);

  const findings: LeakFinding[] = [];
  const byStrategy = groupBy(rows, (r) => r.strategyId ?? "");

  for (const [strategyId, trades] of byStrategy.entries()) {
    if (!strategyId) continue;
    const meta = strategyMeta.find((s) => s.id === strategyId);
    const strategyName = meta?.name ?? strategyId;

    const contractSeries = trades
      .sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime())
      .map((t) => t.contracts);

    if (contractSeries.length < 5) continue;

    const { window20d, baseline60d } = splitWindows(contractSeries);
    const zScore = computeZScore(window20d, baseline60d);

    if (zScore === null) continue;

    const severity = classifyZScoreSeverity(zScore, cfg.allocZHigh, cfg.allocZWarn);
    if (severity === "info" && Math.abs(zScore) < 0.5) continue;

    const median20d = median(window20d);
    const median60d = median(baseline60d);

    findings.push({
      category: "allocation_drift",
      severity,
      strategyId,
      strategyName,
      evidence: {
        zScore: round2(zScore),
        median20dContracts: median20d,
        median60dContracts: median60d,
        direction: zScore > 0 ? "contracts_increasing" : "contracts_decreasing",
        tradeCount: contractSeries.length,
      },
      recommendedAction:
        severity === "high"
          ? "Investigate risk-derived sizing path. Check drawdown room, account balance, and pyramid ramp state."
          : "Monitor — position sizing deviating from historical baseline.",
    });
  }

  return findings;
}

// ─── Category 3: Regime Leak ──────────────────────────────────────────────────

async function detectRegimeLeak(
  strategyIds: string[],
  strategyMeta: Array<{
    id: string;
    name: string;
    lifecycleState: string;
    preferredRegimes: string[] | null;
    regimeTrainedOn: string | null;
    symbol: string;
  }>,
  _cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  // Get the most recent institutional_regime per unique symbol across target strategies
  const symbols = [...new Set(strategyMeta.map((s) => s.symbol).filter(Boolean))];
  if (symbols.length === 0) return [];

  const latestBySymbol = new Map<string, string | null>();

  for (const sym of symbols) {
    try {
      const rows = await db
        .select({
          evidence: biasState.evidence,
          regimeLabel: biasState.regimeLabel,
        })
        .from(biasState)
        .where(eq(biasState.symbol, sym))
        .orderBy(desc(biasState.computedAt))
        .limit(1);

      if (rows.length === 0) {
        latestBySymbol.set(sym, null);
        continue;
      }

      const evidenceObj = rows[0].evidence as Record<string, unknown> | null;
      const institutionalRegime =
        typeof evidenceObj?.["institutional_regime"] === "string"
          ? evidenceObj["institutional_regime"]
          : null;

      // Fall back to rule-based regimeLabel if institutional regime not computed yet
      latestBySymbol.set(sym, institutionalRegime ?? rows[0].regimeLabel ?? null);
    } catch (err) {
      logger.warn({ err, symbol: sym }, "layer15: failed to read bias_state for symbol");
      latestBySymbol.set(sym, null);
    }
  }

  const findings: LeakFinding[] = [];

  for (const s of strategyMeta) {
    if (!inStrategyIds(s.id, strategyIds)) continue;
    if (!s.regimeTrainedOn && (!s.preferredRegimes || s.preferredRegimes.length === 0)) {
      // Strategy has no regime constraints → not a regime leak target
      continue;
    }

    const currentRegime = latestBySymbol.get(s.symbol) ?? null;
    if (!currentRegime) continue; // no bias state data — skip

    // Normalise: institutional regime uses values like TRENDING, RANGE_BOUND, etc.
    // preferredRegimes uses TRENDING_UP, TRENDING_DOWN, RANGE_BOUND
    // We detect a mismatch when current regime doesn't appear in any form
    const trainedRegimes = [
      ...(s.regimeTrainedOn ? [s.regimeTrainedOn] : []),
      ...(s.preferredRegimes ?? []),
    ].map((r) => r.toUpperCase());

    const currentNorm = currentRegime.toUpperCase();
    const isMatch =
      trainedRegimes.length === 0 || // no constraint = any regime OK
      trainedRegimes.some((r) => currentNorm.startsWith(r) || r.startsWith(currentNorm));

    if (isMatch) continue;

    // DEPLOYED strategies in wrong regime = high; PAPER = warning
    const severity: LeakSeverity =
      s.lifecycleState === "DEPLOYED" ? "high" : "warning";

    findings.push({
      category: "regime",
      severity,
      strategyId: s.id,
      strategyName: s.name,
      evidence: {
        currentRegime,
        trainedRegimes,
        lifecycleState: s.lifecycleState,
        symbol: s.symbol,
        regimeTrainedOn: s.regimeTrainedOn,
        preferredRegimes: s.preferredRegimes,
      },
      recommendedAction:
        severity === "high"
          ? "Strategy is DEPLOYED in an untrained regime. Consider pause + re-validate via CPCV in current regime."
          : "Strategy in PAPER is trading outside its trained regime. Monitor P&L before promoting.",
    });
  }

  return findings;
}

// ─── Category 4: Attribution Opacity ─────────────────────────────────────────

async function detectAttributionOpacity(
  strategyIds: string[],
  strategyMeta: Array<{ id: string; name: string }>,
  cutoff: Date,
  cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  const rows = await db
    .select({
      strategyId: tradeCritique.strategyId,
      dataCompleteness: tradeCritique.dataCompleteness,
      technicalDiagnosis: tradeCritique.technicalDiagnosis,
      createdAt: tradeCritique.createdAt,
    })
    .from(tradeCritique)
    .where(
      and(
        inArray(tradeCritique.strategyId, strategyIds),
        gte(tradeCritique.createdAt, cutoff),
      ),
    )
    .orderBy(desc(tradeCritique.createdAt));

  const findings: LeakFinding[] = [];
  const byStrategy = groupBy(rows, (r) => r.strategyId ?? "");

  for (const [strategyId, critiques] of byStrategy.entries()) {
    if (!strategyId) continue;
    if (critiques.length < 3) continue; // too few to classify

    const meta = strategyMeta.find((s) => s.id === strategyId);
    const strategyName = meta?.name ?? strategyId;

    // Count minimal critiques and missing key diagnostic fields
    let minimalCount = 0;
    let missingSmtCount = 0;
    let missingRegimeStateCount = 0;

    for (const c of critiques) {
      if (c.dataCompleteness === "minimal") minimalCount++;
      const diag = (c.technicalDiagnosis ?? {}) as Record<string, unknown>;
      if (!("smt_score" in diag)) missingSmtCount++;
      if (!("regime_state" in diag)) missingRegimeStateCount++;
    }

    const minimalFraction = minimalCount / critiques.length;
    const smtMissingFraction = missingSmtCount / critiques.length;
    const regimeMissingFraction = missingRegimeStateCount / critiques.length;

    // Use the worst fraction as the driving metric
    const worstFraction = Math.max(minimalFraction, smtMissingFraction, regimeMissingFraction);

    const severity = classifyFractionSeverity(
      worstFraction,
      cfg.opacityHighPct,
      cfg.opacityWarnPct,
    );
    if (severity === "info" && worstFraction < 0.15) continue;

    findings.push({
      category: "attribution_opacity",
      severity,
      strategyId,
      strategyName,
      evidence: {
        totalCritiques: critiques.length,
        minimalCount,
        minimalFraction: round2(minimalFraction),
        missingSmtCount,
        smtMissingFraction: round2(smtMissingFraction),
        missingRegimeStateCount,
        regimeMissingFraction: round2(regimeMissingFraction),
        worstFraction: round2(worstFraction),
      },
      recommendedAction:
        severity === "high"
          ? "Bot is trading semi-blind. Check SMT live bridge and regime state pipeline. " +
            "Investigate why trade critiques are returning minimal data_completeness."
          : "Attribution data quality degraded. Monitor SMT and bias_state pipeline health.",
    });
  }

  return findings;
}

// ─── Category 5: Subsystem Consensus ─────────────────────────────────────────

async function detectSubsystemConsensus(
  strategyIds: string[],
  strategyMeta: Array<{ id: string; name: string }>,
  cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  // Get the 2 most recent health score rows per strategy (need prior + current)
  const allScores = await db
    .select({
      strategyId: strategyHealthScores.strategyId,
      compositeScore: strategyHealthScores.compositeScore,
      subsystemScores: strategyHealthScores.subsystemScores,
      evaluatedAt: strategyHealthScores.evaluatedAt,
    })
    .from(strategyHealthScores)
    .where(inArray(strategyHealthScores.strategyId, strategyIds))
    .orderBy(
      strategyHealthScores.strategyId,
      desc(strategyHealthScores.evaluatedAt),
    );

  const findings: LeakFinding[] = [];

  // Group by strategy and take the latest 2 rows
  const byStrategy = groupBy(allScores, (r) => r.strategyId);

  for (const [strategyId, scores] of byStrategy.entries()) {
    if (scores.length < 2) continue; // need at least 2 evaluations

    const current = scores[0]; // most recent (orderBy desc)
    const prior = scores[1];   // second most recent

    const currentComposite = current.compositeScore ?? null;
    const priorComposite = prior.compositeScore ?? null;

    if (currentComposite === null || priorComposite === null) continue;

    const drop = priorComposite - currentComposite; // positive = health degraded
    if (drop <= cfg.compositeDropThreshold) continue;

    // Count regressed subsystems
    const currentSubs = (current.subsystemScores ?? {}) as Record<string, { score?: number | null }>;
    const priorSubs = (prior.subsystemScores ?? {}) as Record<string, { score?: number | null }>;

    let regressedCount = 0;
    const regressedSubsystems: string[] = [];

    for (const key of Object.keys(priorSubs)) {
      const priorScore = priorSubs[key]?.score ?? null;
      const currentScore = currentSubs[key]?.score ?? null;
      if (priorScore !== null && currentScore !== null && priorScore > currentScore) {
        regressedCount++;
        regressedSubsystems.push(key);
      }
    }

    if (regressedCount < cfg.minRegressedSubsystems) continue;

    const meta = strategyMeta.find((s) => s.id === strategyId);
    const strategyName = meta?.name ?? strategyId;

    // Severity: composite dropped + multiple subsystems regressed = high
    const severity: LeakSeverity = drop >= cfg.compositeDropThreshold * 2 ? "high" : "warning";

    findings.push({
      category: "subsystem_consensus",
      severity,
      strategyId,
      strategyName,
      evidence: {
        compositeDrop: round2(drop),
        currentComposite: round2(currentComposite),
        priorComposite: round2(priorComposite),
        regressedSubsystems,
        regressedCount,
        threshold: cfg.compositeDropThreshold,
        priorEvaluatedAt: prior.evaluatedAt.toISOString(),
        currentEvaluatedAt: current.evaluatedAt.toISOString(),
      },
      recommendedAction:
        severity === "high"
          ? `Composite health dropped ${round2(drop * 100)}% — ${regressedCount} subsystems regressed. ` +
            "Review composite-health dashboard and investigate degraded subsystems before next promotion."
          : `Composite health declining (${regressedCount} subsystems regressed). Monitor closely.`,
    });
  }

  return findings;
}

// ─── Category 6: MC distribution breach ──────────────────────────────────────
//
// Compares live paper performance against the strategy's FROZEN promotion-time
// Monte Carlo distribution (point-in-time — no look-ahead, no fresh MC run).
//
// DB path: lifecycle_transitions.backtest_id → monte_carlo_runs (sharpe_p5, max_drawdown_p95)
//          paper_sessions → paper_trades (realized Sharpe + max-drawdown from equity curve)
//
// Fail-soft contract:
//   missing lifecycle transition   → skip
//   missing / incomplete MC run    → skip
//   null MC percentiles            → skip that dimension
//   tradeCount < mcMinTrades       → skip (insufficient sample; no false alarm)
//   any DB error                   → category runner catches it (never throws)

/** Group chronological trade rows into daily P&L sums (UTC date boundary). */
function computeDailyPnlsFromTrades(
  trades: ReadonlyArray<{ exitTime: Date; pnl: unknown }>,
): number[] {
  const byDay = new Map<string, number>();
  for (const t of trades) {
    const day = t.exitTime.toISOString().substring(0, 10); // YYYY-MM-DD (UTC)
    const pnl = parseFloat(String(t.pnl ?? "0"));
    if (!Number.isFinite(pnl)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
  }
  return [...byDay.values()];
}

async function detectMcDistributionBreach(
  strategyIds: string[],
  strategyMeta: Array<{ id: string; name: string }>,
  cutoff: Date,
  cfg: ReturnType<typeof getCfg>,
): Promise<LeakFinding[]> {
  // ── Step 1: find promotion-time backtestId per strategy ─────────────────────
  // Use lifecycle_transitions to pin the FROZEN MC to the moment of promotion,
  // not a fresh re-run — point-in-time, no look-ahead.
  const promotionRows = await db
    .select({
      strategyId: lifecycleTransitions.strategyId,
      backtestId: lifecycleTransitions.backtestId,
    })
    .from(lifecycleTransitions)
    .where(
      and(
        inArray(lifecycleTransitions.strategyId, strategyIds),
        inArray(lifecycleTransitions.toState, [
          "PAPER",
          "DEPLOY_READY",
          "PILOT",
          "DEPLOYED",
        ]),
        isNotNull(lifecycleTransitions.backtestId),
      ),
    )
    .orderBy(desc(lifecycleTransitions.createdAt));

  // Map strategy → most-recent promotion backtestId (DESC order ensures first hit is newest)
  const backtestIdByStrategy = new Map<string, string>();
  for (const row of promotionRows) {
    if (row.strategyId && row.backtestId && !backtestIdByStrategy.has(row.strategyId)) {
      backtestIdByStrategy.set(row.strategyId, row.backtestId);
    }
  }

  const backtestIds = [...new Set(backtestIdByStrategy.values())];
  if (backtestIds.length === 0) return []; // no strategies have promotion-time backtests

  // ── Step 2: fetch frozen MC percentiles for each promotion backtest ─────────
  const mcRows = await db
    .select({
      backtestId: monteCarloRuns.backtestId,
      sharpeP5: monteCarloRuns.sharpeP5,
      maxDrawdownP95: monteCarloRuns.maxDrawdownP95,
      createdAt: monteCarloRuns.createdAt,
    })
    .from(monteCarloRuns)
    .where(
      and(
        inArray(monteCarloRuns.backtestId, backtestIds),
        eq(monteCarloRuns.status, "completed"),
      ),
    )
    .orderBy(desc(monteCarloRuns.createdAt));

  // Map backtestId → most recent completed MC run
  const mcByBacktestId = new Map<string, (typeof mcRows)[0]>();
  for (const mc of mcRows) {
    if (!mcByBacktestId.has(mc.backtestId)) {
      mcByBacktestId.set(mc.backtestId, mc);
    }
  }

  // ── Step 3: fetch realized paper trade P&L within lookback window ────────────
  const paperRows = await db
    .select({
      strategyId: paperSessions.strategyId,
      pnl: paperTrades.pnl,
      exitTime: paperTrades.exitTime,
    })
    .from(paperTrades)
    .innerJoin(paperSessions, eq(paperTrades.sessionId, paperSessions.id))
    .where(
      and(
        inArray(paperSessions.strategyId, strategyIds),
        gte(paperTrades.exitTime, cutoff),
      ),
    )
    .orderBy(paperTrades.exitTime);

  // Group trades by strategy (chronological order preserved by orderBy above)
  const tradesByStrategy = groupBy(
    paperRows as Array<{ strategyId: string | null; pnl: unknown; exitTime: Date }>,
    (r) => r.strategyId ?? "",
  );

  // ── Step 4: evaluate each strategy ──────────────────────────────────────────
  const findings: LeakFinding[] = [];

  for (const strategyId of strategyIds) {
    // Fail-soft: no promotion backtestId → skip
    const backtestId = backtestIdByStrategy.get(strategyId);
    if (!backtestId) continue;

    // Fail-soft: no completed MC run for the promotion backtest → skip
    const mc = mcByBacktestId.get(backtestId);
    if (!mc) continue;

    const sharpeP5 =
      mc.sharpeP5 !== null && mc.sharpeP5 !== undefined
        ? parseFloat(String(mc.sharpeP5))
        : null;
    const maxDrawdownP95 =
      mc.maxDrawdownP95 !== null && mc.maxDrawdownP95 !== undefined
        ? parseFloat(String(mc.maxDrawdownP95))
        : null;

    // Fail-soft: both MC percentiles null → nothing to compare
    if (
      (sharpeP5 === null || !Number.isFinite(sharpeP5)) &&
      (maxDrawdownP95 === null || !Number.isFinite(maxDrawdownP95))
    ) {
      continue;
    }

    // Realized paper metrics
    const trades = (tradesByStrategy.get(strategyId) ?? []) as Array<{
      strategyId: string | null;
      pnl: unknown;
      exitTime: Date;
    }>;
    const tradeCount = trades.length;

    const orderedPnls = trades.map((t) => parseFloat(String(t.pnl ?? "0")));
    const dailyPnls = computeDailyPnlsFromTrades(trades);

    const realizedSharpe = computeSharpeFromPnls(dailyPnls);
    const realizedMaxDrawdown = computeMaxDrawdownFromPnls(orderedPnls);

    // Evaluate breach
    const result = computeMcDistributionBreach({
      realizedSharpe,
      realizedMaxDrawdown,
      sharpeP5: Number.isFinite(sharpeP5 as number) ? (sharpeP5 as number) : null,
      maxDrawdownP95: Number.isFinite(maxDrawdownP95 as number) ? (maxDrawdownP95 as number) : null,
      tradeCount,
      minTrades: cfg.mcMinTrades,
      severeDdMult: cfg.mcDdSevereMult,
    });

    // Only report actual breaches — skip clean / insufficient_sample / no_mc_data
    if (result.outcome !== "breach" || !result.severity) continue;

    const meta = strategyMeta.find((s) => s.id === strategyId);
    const strategyName = meta?.name ?? strategyId;

    findings.push({
      category: "mc_distribution_breach",
      severity: result.severity,
      strategyId,
      strategyName,
      evidence: {
        dimension: result.dimension,
        impliedPercentile: (() => {
          if (result.dimension === "dd") return ">P95";
          if (result.dimension === "sharpe") return "<P5";
          return "dd>P95 and sharpe<P5";
        })(),
        tradeCount,
        mcBacktestId: backtestId,
        ...(result.ddBreach && {
          realizedMaxDrawdown: round2(result.ddBreach.realized),
          mcMaxDrawdownP95: round2(result.ddBreach.p95Bound),
          ddPctOverBound: round2(result.ddBreach.pctOverBound),
          ddSevere: result.ddBreach.severe,
        }),
        ...(result.sharpeBreach && {
          realizedSharpe: round2(result.sharpeBreach.realized),
          mcSharpeP5: round2(result.sharpeBreach.p5Bound),
          sharpeSevere: result.sharpeBreach.severe,
        }),
      },
      recommendedAction:
        result.severity === "high"
          ? "Live P&L is a tail outcome of its own MC distribution — review for regime shift or " +
            "overfit. Consider running CPCV validation in current market regime before next promotion."
          : "Monitor — live performance is trending outside MC distribution bounds. " +
            "Review for regime shift / overfit before extending the observation window.",
    });
  }

  return findings;
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const existing = map.get(k);
    if (existing) {
      existing.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function inStrategyIds(id: string, ids: string[]): boolean {
  return ids.includes(id);
}
