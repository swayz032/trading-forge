/**
 * carter-recommend.ts — Carter "recommendation-engine" grounded-analysis read tools.
 *
 * 4 GREEN, read-only, voice-friendly handlers that gather grounded raw material so
 * Carter's GPT-5.4 brain can recommend improvements/fixes to Trading Forge. These
 * tools do NOT write the recommendation themselves — they assemble the evidence
 * (where strategies are stuck, what gates block most, a per-strategy critique
 * bundle, and the hardening backlog) and hand it back structured + bounded.
 *
 *   diagnose_pipeline            — where strategies are stuck (stage counts, recent
 *                                  blocks, oldest-stuck, summary)
 *   analyze_gate_blocks          — FAST block-FREQUENCY view (NOT the slow Python
 *                                  counterfactual at src/engine/gate_block_analyzer.py)
 *   review_strategy              — per-strategy critique bundle (policy slice + latest
 *                                  backtest metrics + MC survival + blocking gate)
 *   find_hardening_opportunities — raw material for "what should I fix" (recent
 *                                  errors, stale strategies, stuck pre-paper, open issues)
 *
 * INVARIANTS:
 *   - All read-only. No mutations. No secrets read. No new RED paths.
 *   - Bounded outputs (voice agent) — arrays/strings capped.
 *   - Fail-SOFT on DB errors — return a structured { error } object, never crash the
 *     route. Bad INPUT still throws (mirrors carter-introspect.ts); review_strategy
 *     throws strategy_not_found like report_strategy_status / read_strategy_internals.
 *
 * Each handler matches `(params: unknown) => Promise<unknown>`. Handler keys in
 * CARTER_RECOMMEND_HANDLERS MUST match the CarterTool.handler field in
 * tool-registry.ts; the contract test enforces parity.
 */

import { db } from "../../db/index.js";
import {
  strategies,
  backtests,
  monteCarloRuns,
  auditLog,
  lifecycleTransitions,
  paperSignalLogs,
  carterIssues,
} from "../../db/schema.js";
import { desc, eq, and, gte, lt, inArray, ilike, sql } from "drizzle-orm";

import { logger } from "../logger.js";

// Gate threshold getters (env-synced, called at request time for the LIVE value).
import { getB14CiHighThreshold } from "../b14-ci-gate.js";
import { getWfeHardFloor } from "../wfe-gate.js";
import { getPboLifecycleThreshold } from "../pbo-gate.js";

// ─── Caps (voice-friendly bounded output) ─────────────────────────────────────
const RECENT_BLOCKS_SCAN_CAP = 500; // audit rows scanned for block grouping
const RECENT_BLOCKS_TOP = 8;
const OLDEST_STUCK_TOP = 5;
const GATE_BLOCK_SCAN_CAP = 1000; // signal/audit rows scanned for frequency grouping
const GATE_BLOCK_TOP = 12;
const RECENT_ERRORS_TOP = 10;
const STALE_STRATEGIES_TOP = 5;
const STUCK_PRE_PAPER_TOP = 5;
const OPEN_ISSUES_TOP = 10;

const DAY_MS = 86_400_000;

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function daysSince(v: unknown): number | null {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / DAY_MS));
}

// ─── diagnose_pipeline ────────────────────────────────────────────────────────
// No params. Returns where strategies are stuck.

async function diagnosePipeline(_params: unknown): Promise<unknown> {
  try {
    // stage_counts — strategies grouped by lifecycleState.
    const stageRows = await db
      .select({ state: strategies.lifecycleState, n: sql<number>`count(*)::int` })
      .from(strategies)
      .groupBy(strategies.lifecycleState);

    const stage_counts: Record<string, number> = {};
    for (const r of stageRows) {
      stage_counts[String(r.state)] = Number(r.n) || 0;
    }

    // recent_blocks — audit_log block rows (last 14 days), grouped by action, top ~8.
    const since14 = new Date(Date.now() - 14 * DAY_MS);
    const blockRows = await db
      .select({
        action: auditLog.action,
        errorMessage: auditLog.errorMessage,
        result: auditLog.result,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(and(gte(auditLog.createdAt, since14), ilike(auditLog.action, "%block%")))
      .orderBy(desc(auditLog.createdAt))
      .limit(RECENT_BLOCKS_SCAN_CAP);

    const blockAgg = new Map<string, { count: number; sample_reason: string | null }>();
    for (const r of blockRows) {
      const key = String(r.action);
      const prev = blockAgg.get(key);
      const reason =
        r.errorMessage ??
        ((r.result as Record<string, unknown> | null)?.["reason"] as string | undefined) ??
        null;
      if (prev) {
        prev.count += 1;
        if (!prev.sample_reason && reason) prev.sample_reason = reason;
      } else {
        blockAgg.set(key, { count: 1, sample_reason: reason });
      }
    }
    const recent_blocks = [...blockAgg.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, RECENT_BLOCKS_TOP)
      .map(([gate_or_action, v]) => ({
        gate_or_action,
        count: v.count,
        sample_reason: v.sample_reason,
      }));

    // oldest_stuck — strategies whose LATEST lifecycle transition is oldest (top ~5).
    const lastTransRows = await db
      .select({
        strategyId: lifecycleTransitions.strategyId,
        lastAt: sql<string>`max(${lifecycleTransitions.createdAt})`,
      })
      .from(lifecycleTransitions)
      .groupBy(lifecycleTransitions.strategyId);

    const stuckCandidates = lastTransRows
      .filter((r) => r.strategyId)
      .map((r) => ({ strategyId: r.strategyId as string, lastAt: r.lastAt }))
      .sort((a, b) => Date.parse(String(a.lastAt)) - Date.parse(String(b.lastAt)))
      .slice(0, OLDEST_STUCK_TOP);

    let oldest_stuck: Array<{ strategy: string; state: string | null; days_in_state: number | null }> = [];
    if (stuckCandidates.length > 0) {
      const ids = stuckCandidates.map((s) => s.strategyId);
      const stratRows = await db
        .select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState })
        .from(strategies)
        .where(inArray(strategies.id, ids));
      const byId = new Map(stratRows.map((s) => [s.id, s]));
      oldest_stuck = stuckCandidates.map((c) => {
        const s = byId.get(c.strategyId);
        return {
          strategy: s?.name ?? c.strategyId,
          state: s?.lifecycleState ?? null,
          days_in_state: daysSince(c.lastAt),
        };
      });
    }

    const totalStrategies = Object.values(stage_counts).reduce((a, b) => a + b, 0);
    const summary =
      `${totalStrategies} strategies across ${Object.keys(stage_counts).length} stages; ` +
      `${recent_blocks.length} block-action type(s) in last 14d` +
      (oldest_stuck[0]
        ? `; oldest-stuck "${oldest_stuck[0].strategy}" (${oldest_stuck[0].state}) ${oldest_stuck[0].days_in_state}d since last transition.`
        : ".");

    return { stage_counts, recent_blocks, oldest_stuck, summary };
  } catch (err) {
    logger.warn({ err }, "carter-recommend.diagnose_pipeline: failed");
    return { error: "diagnose_pipeline_failed" };
  }
}

// ─── analyze_gate_blocks ──────────────────────────────────────────────────────
// FAST block-FREQUENCY view — NOT the slow Python counterfactual.

interface AnalyzeGateBlocksParams {
  strategyName?: string;
  sinceDays?: number;
}

const COUNTERFACTUAL_NOTE =
  "Frequency only — the deep costing-vs-saving counterfactual is " +
  "src/engine/gate_block_analyzer.py, run offline.";

async function analyzeGateBlocks(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as AnalyzeGateBlocksParams;
  const sinceDays = Math.min(Math.max(Math.floor(Number(p.sinceDays) || 7), 1), 60);
  const strategyName =
    typeof p.strategyName === "string" && p.strategyName.trim() !== ""
      ? p.strategyName.trim()
      : null;
  const since = new Date(Date.now() - sinceDays * DAY_MS);

  try {
    // Primary path: paper_signal_logs where acted=false (the blocked-signal table).
    let source: "paper_signal_logs" | "audit_log" = "paper_signal_logs";
    let reasons: string[] = [];

    try {
      if (strategyName) {
        // Join sessions → strategies to filter by strategy name.
        const rows = await db
          .select({ reason: paperSignalLogs.reason })
          .from(paperSignalLogs)
          .innerJoin(
            sql`paper_sessions`,
            sql`paper_sessions.id = ${paperSignalLogs.sessionId}`,
          )
          .innerJoin(strategies, sql`${strategies.id} = paper_sessions.strategy_id`)
          .where(
            and(
              eq(paperSignalLogs.acted, false),
              gte(paperSignalLogs.createdAt, since),
              eq(strategies.name, strategyName),
            ),
          )
          .limit(GATE_BLOCK_SCAN_CAP);
        reasons = rows.map((r) => r.reason ?? "(unspecified)");
      } else {
        const rows = await db
          .select({ reason: paperSignalLogs.reason })
          .from(paperSignalLogs)
          .where(and(eq(paperSignalLogs.acted, false), gte(paperSignalLogs.createdAt, since)))
          .orderBy(desc(paperSignalLogs.createdAt))
          .limit(GATE_BLOCK_SCAN_CAP);
        reasons = rows.map((r) => r.reason ?? "(unspecified)");
      }
    } catch (innerErr) {
      logger.warn({ err: innerErr }, "carter-recommend.analyze_gate_blocks: paper_signal_logs path failed");
      reasons = [];
    }

    // Fallback: audit_log block rows when no blocked signals were found.
    if (reasons.length === 0) {
      source = "audit_log";
      const rows = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(gte(auditLog.createdAt, since), ilike(auditLog.action, "%block%")))
        .orderBy(desc(auditLog.createdAt))
        .limit(GATE_BLOCK_SCAN_CAP);
      reasons = rows.map((r) => String(r.action));
    }

    const agg = new Map<string, number>();
    for (const r of reasons) agg.set(r, (agg.get(r) ?? 0) + 1);
    const by_gate = [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GATE_BLOCK_TOP)
      .map(([gate_or_reason, count]) => ({ gate_or_reason, count }));

    return {
      since_days: sinceDays,
      strategy: strategyName,
      source,
      total_blocked: reasons.length,
      by_gate,
      note: COUNTERFACTUAL_NOTE,
    };
  } catch (err) {
    logger.warn({ err }, "carter-recommend.analyze_gate_blocks: failed");
    return { error: "analyze_gate_blocks_failed", note: COUNTERFACTUAL_NOTE };
  }
}

// ─── review_strategy ──────────────────────────────────────────────────────────
// Critique BUNDLE (raw material — Carter's brain writes the actual critique).

interface ReviewStrategyParams {
  strategyId?: string;
  name?: string;
}

async function reviewStrategy(params: unknown): Promise<unknown> {
  const p = (params ?? {}) as ReviewStrategyParams;
  if (!p.strategyId && !p.name) {
    throw new Error("params.strategyId or params.name is required");
  }

  const stratRows = p.strategyId
    ? await db.select().from(strategies).where(eq(strategies.id, p.strategyId)).limit(1)
    : await db.select().from(strategies).where(eq(strategies.name, p.name!)).limit(1);

  if (!stratRows[0]) throw new Error("strategy_not_found");
  const s = stratRows[0];
  const cfg = (s.config ?? {}) as Record<string, unknown>;

  // Latest backtest by created_at desc.
  let latest_backtest: Record<string, unknown> | null = null;
  let wfeOverall: number | null = null;
  let pboOverall: number | null = null;
  try {
    const btRows = await db
      .select({
        id: backtests.id,
        sharpeRatio: backtests.sharpeRatio,
        profitFactor: backtests.profitFactor,
        bif: backtests.bif,
        walkForwardResults: backtests.walkForwardResults,
        status: backtests.status,
        createdAt: backtests.createdAt,
      })
      .from(backtests)
      .where(eq(backtests.strategyId, s.id))
      .orderBy(desc(backtests.createdAt))
      .limit(1);
    const bt = btRows[0] ?? null;
    if (bt) {
      const wfr = (bt.walkForwardResults ?? {}) as Record<string, unknown>;
      wfeOverall = num(wfr["wfe_overall"]);
      pboOverall = num(wfr["pbo_overall"]);
      latest_backtest = {
        id: bt.id,
        status: bt.status,
        sharpe: num(bt.sharpeRatio),
        wfe: wfeOverall,
        pbo: pboOverall,
        bif: num(bt.bif),
        profit_factor: num(bt.profitFactor),
        created_at: toIso(bt.createdAt),
      };
    }
  } catch (err) {
    logger.warn({ err, strategyId: s.id }, "carter-recommend.review_strategy: backtest fetch failed");
  }

  // Latest MC run for that backtest.
  let monte_carlo: Record<string, unknown> | null = null;
  let ruinCiHigh: number | null = null;
  if (latest_backtest) {
    try {
      const mcRows = await db
        .select({
          probabilityOfRuin: monteCarloRuns.probabilityOfRuin,
          riskMetrics: monteCarloRuns.riskMetrics,
          createdAt: monteCarloRuns.createdAt,
        })
        .from(monteCarloRuns)
        .where(eq(monteCarloRuns.backtestId, latest_backtest["id"] as string))
        .orderBy(desc(monteCarloRuns.createdAt))
        .limit(1);
      const mc = mcRows[0] ?? null;
      if (mc) {
        const rm = (mc.riskMetrics ?? {}) as Record<string, unknown>;
        const ci = rm["probability_of_ruin_ci"] as Record<string, unknown> | undefined;
        ruinCiHigh = num(ci?.["ci_high"]);
        monte_carlo = {
          probability_of_ruin: num(mc.probabilityOfRuin),
          probability_of_ruin_ci_high: ruinCiHigh,
          survival_rate: rm["survival_rate"] ?? null,
          ruin_basis: rm["ruin_basis"] ?? null,
        };
      }
    } catch (err) {
      logger.warn({ err, strategyId: s.id }, "carter-recommend.review_strategy: mc fetch failed");
    }
  }

  // Derive the (likely) blocking gate from the evidence.
  let blocking_gate: string | null = null;
  try {
    const b14 = getB14CiHighThreshold();
    const wfeFloor = getWfeHardFloor();
    const pboThreshold = getPboLifecycleThreshold();
    if (ruinCiHigh !== null && ruinCiHigh > b14) {
      blocking_gate = `B14_RUIN_CI (ci_high ${ruinCiHigh.toFixed(3)} > ${b14.toFixed(3)})`;
    } else if (wfeOverall !== null && wfeOverall < wfeFloor) {
      blocking_gate = `WFE_HARD_FLOOR (${wfeOverall.toFixed(3)} < ${wfeFloor.toFixed(3)})`;
    } else if (pboOverall !== null && pboOverall > pboThreshold) {
      blocking_gate = `PBO_OVERFIT (${pboOverall.toFixed(3)} > ${pboThreshold.toFixed(3)})`;
    }
  } catch (err) {
    logger.warn({ err }, "carter-recommend.review_strategy: threshold getter threw");
  }

  return {
    id: s.id,
    name: s.name,
    lifecycleState: s.lifecycleState,
    symbols: Array.isArray(s.symbols) ? s.symbols : [s.symbol],
    entry_quality: cfg["entry_quality"] ?? null,
    position_size: cfg["position_size"] ?? null,
    exit_plan_config: cfg["exit_plan_config"] ?? s.exitPlanConfig ?? null,
    latest_backtest,
    monte_carlo,
    blocking_gate,
  };
}

// ─── find_hardening_opportunities ─────────────────────────────────────────────
// No params. Raw material for "what should I fix".

async function findHardeningOpportunities(_params: unknown): Promise<unknown> {
  const stalenessDays = Math.max(
    1,
    Math.floor(Number(process.env["BACKTEST_STALENESS_DAYS"]) || 30),
  );
  const result: Record<string, unknown> = {};

  // recent_errors — audit_log error/critical/failure rows, last ~10.
  try {
    const rows = await db
      .select({
        action: auditLog.action,
        status: auditLog.status,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(inArray(auditLog.status, ["error", "critical", "failure"]))
      .orderBy(desc(auditLog.createdAt))
      .limit(RECENT_ERRORS_TOP);
    result["recent_errors"] = rows.map((r) => ({
      action: r.action,
      status: r.status,
      at: toIso(r.createdAt),
    }));
  } catch (err) {
    logger.warn({ err }, "carter-recommend.find_hardening_opportunities: recent_errors failed");
    result["recent_errors"] = [];
  }

  // stale_strategies — latest backtest older than BACKTEST_STALENESS_DAYS, top ~5.
  try {
    const cutoff = new Date(Date.now() - stalenessDays * DAY_MS);
    const lastBtRows = await db
      .select({
        strategyId: backtests.strategyId,
        lastAt: sql<string>`max(${backtests.createdAt})`,
      })
      .from(backtests)
      .groupBy(backtests.strategyId);

    const stale = lastBtRows
      .map((r) => ({ strategyId: r.strategyId, lastAt: r.lastAt }))
      .filter((r) => r.strategyId && Date.parse(String(r.lastAt)) < cutoff.getTime())
      .sort((a, b) => Date.parse(String(a.lastAt)) - Date.parse(String(b.lastAt)))
      .slice(0, STALE_STRATEGIES_TOP);

    if (stale.length > 0) {
      const ids = stale.map((s) => s.strategyId as string);
      const nameRows = await db
        .select({ id: strategies.id, name: strategies.name })
        .from(strategies)
        .where(inArray(strategies.id, ids));
      const byId = new Map(nameRows.map((n) => [n.id, n.name]));
      result["stale_strategies"] = stale.map((s) => ({
        name: byId.get(s.strategyId as string) ?? s.strategyId,
        last_backtest_days: daysSince(s.lastAt),
      }));
    } else {
      result["stale_strategies"] = [];
    }
  } catch (err) {
    logger.warn({ err }, "carter-recommend.find_hardening_opportunities: stale_strategies failed");
    result["stale_strategies"] = [];
  }

  // stuck_pre_paper — CANDIDATE/TESTING strategies, oldest lifecycle change first, top ~5.
  try {
    const rows = await db
      .select({
        name: strategies.name,
        state: strategies.lifecycleState,
        changedAt: strategies.lifecycleChangedAt,
      })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["CANDIDATE", "TESTING"]))
      .orderBy(sql`${strategies.lifecycleChangedAt} asc nulls first`)
      .limit(STUCK_PRE_PAPER_TOP);
    result["stuck_pre_paper"] = rows.map((r) => ({
      name: r.name,
      state: r.state,
      days_in_state: daysSince(r.changedAt),
    }));
  } catch (err) {
    logger.warn({ err }, "carter-recommend.find_hardening_opportunities: stuck_pre_paper failed");
    result["stuck_pre_paper"] = [];
  }

  // open_issues — from carter_issues if the table exists (else omit the key).
  try {
    const rows = await db
      .select({
        issueKey: carterIssues.issueKey,
        severity: carterIssues.severity,
        title: carterIssues.title,
        lastSeen: carterIssues.lastSeen,
      })
      .from(carterIssues)
      .where(eq(carterIssues.resolved, false))
      .orderBy(desc(carterIssues.lastSeen))
      .limit(OPEN_ISSUES_TOP);
    if (rows.length > 0) {
      result["open_issues"] = rows.map((r) => ({
        issue_key: r.issueKey,
        severity: r.severity,
        title: r.title,
        last_seen: toIso(r.lastSeen),
      }));
    }
    // else: omit the key (no open issues) per spec.
  } catch (err) {
    // Table missing / unreadable — omit the key, degrade gracefully.
    logger.warn({ err }, "carter-recommend.find_hardening_opportunities: open_issues unavailable (table missing?)");
  }

  const recentErrCount = (result["recent_errors"] as unknown[]).length;
  const staleCount = (result["stale_strategies"] as unknown[]).length;
  const stuckCount = (result["stuck_pre_paper"] as unknown[]).length;
  const openCount = Array.isArray(result["open_issues"]) ? (result["open_issues"] as unknown[]).length : 0;
  result["summary"] =
    `${recentErrCount} recent error/critical event(s), ${staleCount} stale strategy(ies) ` +
    `(>${stalenessDays}d since backtest), ${stuckCount} stuck pre-PAPER, ${openCount} open issue(s).`;

  return result;
}

// ─── CARTER_RECOMMEND_HANDLERS ────────────────────────────────────────────────

/**
 * Map of handler keys → recommendation-engine handler functions.
 * Keys MUST match CarterTool.handler values in tool-registry.ts.
 * Spread into CARTER_READ_HANDLERS by carter-reads.ts.
 */
export const CARTER_RECOMMEND_HANDLERS: Record<string, (params: unknown) => Promise<unknown>> = {
  diagnose_pipeline: diagnosePipeline,
  analyze_gate_blocks: analyzeGateBlocks,
  review_strategy: reviewStrategy,
  find_hardening_opportunities: findHardeningOpportunities,
};
