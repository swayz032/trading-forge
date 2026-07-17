/**
 * ab-comparison-weekly-digest-service.ts — Wave 29 Pass D.3 (critic-optimizer)
 *
 * Weekly Friday 17:00 ET Discord digest summarizing A/B paper routing performance
 * (Sub-Account 1 baseline vs Sub-Account 2 RL-challenger) + RL training summary.
 * Gives the operator a weekly checkpoint without needing to glance at dashboards
 * daily.
 *
 * Schedule: 0 21,22 * * 5 (Friday 21,22 UTC — ET-hour guard inside handles DST).
 * Pipeline-gate EXEMPT — operator visibility must fire whether pipeline paused or not.
 *
 * Audit actions:
 *   ab_comparison_digest.completed              (success — digest posted to Discord)
 *   ab_comparison_digest.skipped_lock_contention (info — previous tick in-flight)
 *   ab_comparison_digest.skipped_dst_guard       (info — not Friday 17:00 ET)
 *   ab_comparison_digest.discord_failed          (warning — Discord post failed)
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { randomUUID } from "crypto";
import { sql, and, gte, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
// HIGH fix (critic-replay-lifecycle-misc, 2026-07-17): P&L delta / Sharpe now
// sourced from the real realized-P&L journal (paper_trades) instead of a
// never-written audit action — see _queryAccountMetrics doc comment.
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { notifyInfo } from "./notification-service.js";

// ─── Public Types ──────────────────────────────────────────────────────────────

export type DigestStatus =
  | "completed"
  | "skipped_lock_contention"
  | "skipped_dst_guard";

export interface RegimeEdge {
  regime: string;
  sharpeGap: number;
  sessions: number;
}

export interface AbWeeklyMetrics {
  baseline: {
    cumulativePnlDelta: number;
    rollingSharp20: number | null;
  };
  challenger: {
    cumulativePnlDelta: number;
    rollingSharp20: number | null;
  };
  sharpeGap: number | null;
  sharpeTrend: "improving" | "declining" | "stable" | "insufficient_data";
  killSwitchArmedSessions: number;
  killSwitchEngageCount: number;
  rlTrainingEpochCount: number;
  regimeBreakdown: RegimeEdge[];
  noDataFound: boolean;
}

export interface DigestResult {
  status: DigestStatus;
  correlationId: string;
  durationMs: number;
  metrics?: AbWeeklyMetrics;
  dryRun: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Target ET hour for the weekly digest (17 = 5 PM ET). */
const TARGET_ET_HOUR = 17;

/** Day-of-week guard: Friday = 5 in Intl weekday numbering (Sun=0). */
const TARGET_ET_DAY = "Fri";

/** Sub-account routing labels per migration 0159_broker_accounts_ab_paper_routing.sql */
const BASELINE_ACCOUNT = "baseline";
const CHALLENGER_ACCOUNT = "rl-challenger";

// ─── DST-safe ET helpers ───────────────────────────────────────────────────────

/**
 * Returns the current Eastern Time hour (0-23) using Intl.DateTimeFormat.
 * DST-safe: America/New_York resolves spring-forward/fall-back automatically.
 * Mirrors composite-health-digest-service.ts / regime-drift-detector-service.ts.
 */
export function _getEtHour(asOf: Date): number {
  const etHourStr = asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(etHourStr, 10);
}

/**
 * Returns the abbreviated weekday name ("Mon", "Tue", ..., "Fri", "Sat", "Sun")
 * in Eastern Time. DST-safe.
 */
export function _getEtWeekday(asOf: Date): string {
  return asOf.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
}

// ─── In-flight lock ───────────────────────────────────────────────────────────

let _digestInFlight = false;

function _tryAcquireDigestLock(): boolean {
  if (_digestInFlight) return false;
  _digestInFlight = true;
  return true;
}

function _releaseDigestLock(): void {
  _digestInFlight = false;
}

/** Test seam — reset the in-flight lock between tests. Do NOT call from production code. */
export function _resetDigestLockForTest(): void {
  _digestInFlight = false;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the 7-day window boundaries relative to asOf.
 */
function _weekWindow(asOf: Date): { windowStart: Date; windowEnd: Date } {
  const windowEnd = new Date(asOf);
  const windowStart = new Date(asOf);
  windowStart.setDate(windowStart.getDate() - 7);
  return { windowStart, windowEnd };
}

/**
 * Compute cumulative P&L delta + rolling Sharpe for a given paper_account_routing
 * label over the last 7 days.
 *
 * CORRECTED (HIGH fix, critic-replay-lifecycle-misc, 2026-07-17): this previously
 * queried audit_log for action='signal.rl_ab_routed' — that string is never
 * written by any producer (it's the *SSE event name* from sse.ts's
 * WAVE29_EVENTS.RL_AB_ROUTED = "signal:rl_ab_routed", confused here for a DB
 * audit action) — with fields 'account_routing' / 'realized_pnl'. The real
 * per-signal routing audit action is `quantum_rl.signal_routed`
 * (paper-signal-service.ts), but it fires at entry/routing time BEFORE a
 * trade's P&L is known, and its result payload never carries a realized_pnl
 * field at all — so no amount of field-renaming against that action can ever
 * populate P&L. Renaming to it would still leave this permanently zero.
 *
 * The real realized-P&L journal is `paper_trades.pnl` (NET, post-commission).
 * closePosition() zeroes `paper_positions.unrealized_pnl` on close — the
 * realized P&L lands in `paper_trades` instead (documented + already relied on
 * by consistency-tracker-service.ts for the identical "where does realized P&L
 * actually live" question). The routing label lives on
 * `strategies.paper_account_routing` (migration 0159, NOT NULL default
 * 'baseline'), joined paper_trades -> paper_sessions -> strategies.
 *
 * "Session" here means an NY-calendar trading day
 * (DATE(exit_time AT TIME ZONE 'America/New_York')) — the same daily-bucket
 * convention used by consistency-tracker-service.ts / daily-trade-cap.ts —
 * not one entry per individual trade.
 */
async function _queryAccountMetrics(
  routingLabel: string,
  windowStart: Date,
  _windowEnd: Date,
): Promise<{ cumulativePnlDelta: number; rollingSharp20: number | null; sessionPnls: number[] }> {
  try {
    // strategies.paper_account_routing is NOT NULL (default 'baseline'), but
    // the OR-NULL clause is kept defensively to mirror the same fail-soft
    // default paper-signal-service.ts applies when the strategy row itself
    // can't be resolved (routingDecision ?? "baseline").
    const routingClause = routingLabel === BASELINE_ACCOUNT
      ? sql`(s.paper_account_routing = ${BASELINE_ACCOUNT} OR s.paper_account_routing IS NULL)`
      : sql`s.paper_account_routing = ${routingLabel}`;

    type DailyRow = { day: string; pnl: number };
    const dailyRows = await db.execute<DailyRow>(
      sql`
        SELECT
          DATE(pt.exit_time AT TIME ZONE 'America/New_York') AS day,
          SUM(pt.pnl::numeric) AS pnl
        FROM paper_trades pt
        JOIN paper_sessions ps ON ps.id = pt.session_id
        JOIN strategies s ON s.id = ps.strategy_id
        WHERE
          ${routingClause}
          AND pt.exit_time >= ${windowStart.toISOString()}::timestamptz
        GROUP BY 1
        ORDER BY 1
      `,
    );

    const sessionPnls: number[] = (dailyRows as unknown as DailyRow[]).map((row) => Number(row.pnl));
    const cumulativePnlDelta = sessionPnls.reduce((a, b) => a + b, 0);

    // Rolling 20-session Sharpe: mean / std of the last ≤20 daily-bucket P&Ls
    const last20 = sessionPnls.slice(-20);
    let rollingSharp20: number | null = null;
    if (last20.length >= 2) {
      const mean = last20.reduce((a, b) => a + b, 0) / last20.length;
      const variance = last20.reduce((s, v) => s + (v - mean) ** 2, 0) / (last20.length - 1);
      const std = Math.sqrt(variance);
      rollingSharp20 = std > 0 ? mean / std : null;
    }

    return { cumulativePnlDelta, rollingSharp20, sessionPnls };
  } catch (err) {
    logger.warn({ err, routingLabel }, "ab-comparison-weekly-digest: _queryAccountMetrics failed — returning zeroed metrics");
    return { cumulativePnlDelta: 0, rollingSharp20: null, sessionPnls: [] };
  }
}

/**
 * Count audit_log rows matching an action within the 7-day window.
 */
async function _countAuditAction(action: string, windowStart: Date, _windowEnd: Date): Promise<number> {
  try {
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, action),
          gte(auditLog.createdAt, windowStart),
        ),
      );
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * Count kill_switch armed-and-idle evaluations: audit_log rows where
 * quantum_rl.kill_switch_evaluated has should_dormant=false (evaluated,
 * within tolerance, did not engage) within the 7-day window.
 *
 * CORRECTED (HIGH fix, critic-replay-lifecycle-misc, 2026-07-17): the real
 * producer (src/engine/quantum_rl_agent.py::compute_rl_kill_switch_state)
 * never writes a `decision` field on this action — it writes a boolean
 * `should_dormant` (verified via grep against the Python emitter). The old
 * `result->>'decision' != 'engaged'` comparison silently matched every row
 * (NULL != 'engaged' is NULL, which is falsy in SQL WHERE — so this returned
 * zero armed-idle sessions, not "all of them," regardless of actual state).
 * Rows with reason='insufficient_samples' never reached a real evaluation
 * (baseline_n/rl_n below the lookback floor) so they're excluded from the
 * armed-and-idle count — they weren't "armed," just under-sampled.
 */
async function _countKillSwitchArmedIdle(windowStart: Date, _windowEnd: Date): Promise<number> {
  try {
    const rows = await db
      .select({ resultJson: auditLog.result })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "quantum_rl.kill_switch_evaluated"),
          gte(auditLog.createdAt, windowStart),
          sql`(${auditLog.result}->>'should_dormant')::boolean = false`,
          sql`${auditLog.result}->>'reason' IS DISTINCT FROM 'insufficient_samples'`,
        ),
      );
    return rows.length;
  } catch {
    return 0;
  }
}

/**
 * Compute per-regime Sharpe gap (challenger - baseline) grouped by macro regime
 * at trade exit.
 *
 * CORRECTED (HIGH fix, critic-replay-lifecycle-misc, 2026-07-17): this previously
 * read the same never-written `signal.rl_ab_routed` action and an
 * `institutional_regime` field that doesn't exist anywhere on it either — real
 * per-strategy institutional regime lives on `bias_state` (excluded from this
 * fix wave — owned by another concurrent session). `paper_trades.macro_regime`
 * is the real per-trade regime field that DOES exist (captured from
 * macroSnapshots at close time) and needs no join outside this wave's scope.
 */
async function _computeRegimeBreakdown(
  windowStart: Date,
  _windowEnd: Date,
): Promise<RegimeEdge[]> {
  try {
    type TradeRegimeRow = { regime: string | null; routing: string; pnl: number };
    const rows = await db.execute<TradeRegimeRow>(
      sql`
        SELECT
          pt.macro_regime AS regime,
          COALESCE(s.paper_account_routing, ${BASELINE_ACCOUNT}) AS routing,
          pt.pnl::numeric AS pnl
        FROM paper_trades pt
        JOIN paper_sessions ps ON ps.id = pt.session_id
        JOIN strategies s ON s.id = ps.strategy_id
        WHERE pt.exit_time >= ${windowStart.toISOString()}::timestamptz
      `,
    );

    // Group by (regime, routing_label) → collect P&Ls
    const regimeMap: Record<string, { baseline: number[]; challenger: number[] }> = {};

    for (const row of (rows as unknown as TradeRegimeRow[])) {
      const regime = row.regime ?? "UNKNOWN";
      const routing = row.routing;
      const pnl = Number(row.pnl);

      if (!regimeMap[regime]) {
        regimeMap[regime] = { baseline: [], challenger: [] };
      }
      if (routing === CHALLENGER_ACCOUNT) {
        regimeMap[regime].challenger.push(pnl);
      } else {
        regimeMap[regime].baseline.push(pnl);
      }
    }

    const breakdown: RegimeEdge[] = [];
    for (const [regime, { baseline, challenger }] of Object.entries(regimeMap)) {
      const sessions = baseline.length + challenger.length;
      if (sessions === 0) continue;

      const sharpeSingle = (pnls: number[]): number | null => {
        if (pnls.length < 2) return null;
        const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
        const std = Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1));
        return std > 0 ? mean / std : null;
      };

      const baseS = sharpeSingle(baseline);
      const challS = sharpeSingle(challenger);
      const sharpeGap = baseS !== null && challS !== null ? challS - baseS : 0;

      breakdown.push({ regime, sharpeGap, sessions });
    }

    return breakdown.sort((a, b) => b.sessions - a.sessions);
  } catch {
    return [];
  }
}

// ─── Discord message builder ───────────────────────────────────────────────────

function _buildKillSwitchLine(armedSessions: number, engageCount: number): string {
  if (engageCount === 0 && armedSessions === 0) {
    return "Kill switch: currently dormant";
  }
  if (engageCount > 0) {
    return `Kill switch: engaged ${engageCount} time${engageCount !== 1 ? "s" : ""} this week (${armedSessions} session${armedSessions !== 1 ? "s" : ""} armed and idle)`;
  }
  return `Kill switch: armed and idle for ${armedSessions} session${armedSessions !== 1 ? "s" : ""} (did not fire)`;
}

function _formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}$${Math.abs(pnl).toFixed(2)}`;
}

function _formatSharpe(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
}

function _buildDigestBody(
  metrics: AbWeeklyMetrics,
  correlationId: string,
): string {
  const lines: string[] = [
    "Wave 29 Weekly A/B Snapshot (Fri 17:00 ET)",
    "",
  ];

  if (metrics.noDataFound) {
    lines.push("Past 7 days: No A/B data yet — no closed paper_trades rows found for either routing.");
    lines.push("The RL challenger may not have routed any signals this week.");
    lines.push("");
    lines.push(`Correlation ID: ${correlationId}`);
    return lines.join("\n");
  }

  const { baseline, challenger, sharpeGap, sharpeTrend, killSwitchArmedSessions, killSwitchEngageCount, rlTrainingEpochCount, regimeBreakdown } = metrics;

  lines.push("Past 7 days:");
  lines.push(
    `  Baseline (Sub-Account 1): ${_formatPnl(baseline.cumulativePnlDelta)} cumulative, 20-session Sharpe ${_formatSharpe(baseline.rollingSharp20)}`,
  );
  lines.push(
    `  RL-Challenger (Sub-Account 2): ${_formatPnl(challenger.cumulativePnlDelta)} cumulative, 20-session Sharpe ${_formatSharpe(challenger.rollingSharp20)}`,
  );

  if (sharpeGap !== null) {
    const gapSign = sharpeGap >= 0 ? "+" : "";
    const helpingOrHurting = sharpeGap >= 0 ? "RL is helping" : "RL is hurting";
    lines.push(
      `  Edge: ${gapSign}${sharpeGap.toFixed(2)} Sharpe (${helpingOrHurting})`,
    );
  } else {
    lines.push("  Edge: insufficient Sharpe data (< 2 sessions in one account)");
  }

  if (sharpeTrend !== "insufficient_data") {
    lines.push(`  Trend vs prior week: ${sharpeTrend}`);
  }

  lines.push("");
  lines.push(`RL training: ${rlTrainingEpochCount} epoch${rlTrainingEpochCount !== 1 ? "s" : ""} this week`);
  lines.push(_buildKillSwitchLine(killSwitchArmedSessions, killSwitchEngageCount));

  if (regimeBreakdown.length > 0) {
    lines.push("");
    lines.push("Regime breakdown:");
    for (const { regime, sharpeGap: rGap, sessions } of regimeBreakdown) {
      const sign = rGap >= 0 ? "+" : "";
      lines.push(`  ${regime}: edge ${sign}${rGap.toFixed(2)} over ${sessions} session${sessions !== 1 ? "s" : ""}`);
    }
  }

  lines.push("");
  lines.push(`Correlation ID: ${correlationId}`);
  return lines.join("\n");
}

// ─── Main public function ──────────────────────────────────────────────────────

/**
 * runAbComparisonWeeklyDigest
 *
 * Computes the past 7 days of A/B paper routing performance, RL training summary,
 * kill switch state, and per-regime Sharpe delta, then posts a family-grade
 * Discord digest at Friday 17:00 ET.
 *
 * Guards:
 *   1. Lock contention guard — mirrors scheduler._tryAcquireJobLock pattern.
 *   2. DST-safe ET-hour guard — only fires when ET hour == 17 AND weekday == Fri.
 *      Caller passes `asOf` to enable time-travel in tests.
 *
 * @param opts.asOf    Override "now" for the guards. Default: new Date().
 * @param opts.dryRun  Skip Discord post AND skip audit row. Default: false.
 */
export async function runAbComparisonWeeklyDigest(
  opts: { asOf?: Date; dryRun?: boolean } = {},
): Promise<DigestResult> {
  const correlationId = randomUUID();
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date();
  const dryRun = opts.dryRun ?? false;

  // ── 1. Lock contention guard ──────────────────────────────────────────────
  if (!_tryAcquireDigestLock()) {
    logger.info(
      { correlationId, jobName: "ab-comparison-weekly-digest" },
      "ab-comparison-weekly-digest: previous tick still in-flight — skipping",
    );
    if (!dryRun) {
      await insertAuditRowSafe({
        action: "ab_comparison_digest.skipped_lock_contention",
        entityType: "scheduler_job",
        entityId: "ab-comparison-weekly-digest",
        result: { correlationId },
        status: "info",
        decisionAuthority: "system",
        correlationId,
      });
    }
    return {
      status: "skipped_lock_contention",
      correlationId,
      durationMs: Date.now() - t0,
      dryRun,
    };
  }

  try {
    // ── 2. DST-safe ET-hour + day-of-week guard ───────────────────────────
    const etHour = _getEtHour(asOf);
    const etWeekday = _getEtWeekday(asOf);

    if (etHour !== TARGET_ET_HOUR || etWeekday !== TARGET_ET_DAY) {
      logger.debug(
        {
          correlationId,
          jobName: "ab-comparison-weekly-digest",
          etHour,
          etWeekday,
          expectedHour: TARGET_ET_HOUR,
          expectedDay: TARGET_ET_DAY,
        },
        "ab-comparison-weekly-digest: ET-hour/weekday guard failed — skipping (DST guard)",
      );
      if (!dryRun) {
        await insertAuditRowSafe({
          action: "ab_comparison_digest.skipped_dst_guard",
          entityType: "scheduler_job",
          entityId: "ab-comparison-weekly-digest",
          result: { correlationId, etHour, etWeekday, expectedHour: TARGET_ET_HOUR, expectedDay: TARGET_ET_DAY },
          status: "info",
          decisionAuthority: "system",
          correlationId,
        });
      }
      return {
        status: "skipped_dst_guard",
        correlationId,
        durationMs: Date.now() - t0,
        dryRun,
      };
    }

    logger.info(
      { correlationId, jobName: "ab-comparison-weekly-digest", dryRun },
      "ab-comparison-weekly-digest: tick start (Friday 17:00 ET confirmed)",
    );

    // ── 3. Compute 7-day metrics ──────────────────────────────────────────
    const { windowStart, windowEnd } = _weekWindow(asOf);

    const [baselineMetrics, challengerMetrics, killSwitchEngageCount, killSwitchArmedSessions, rlTrainingEpochCount, regimeBreakdown] =
      await Promise.all([
        _queryAccountMetrics(BASELINE_ACCOUNT, windowStart, windowEnd),
        _queryAccountMetrics(CHALLENGER_ACCOUNT, windowStart, windowEnd),
        _countAuditAction("quantum_rl.kill_switch_engaged", windowStart, windowEnd),
        _countKillSwitchArmedIdle(windowStart, windowEnd),
        _countAuditAction("quantum_rl.training_completed", windowStart, windowEnd),
        _computeRegimeBreakdown(windowStart, windowEnd),
      ]);

    // Determine if there is any data at all
    const noDataFound =
      baselineMetrics.sessionPnls.length === 0 &&
      challengerMetrics.sessionPnls.length === 0 &&
      rlTrainingEpochCount === 0;

    // Sharpe gap: challenger Sharpe minus baseline Sharpe
    const sharpeGap =
      baselineMetrics.rollingSharp20 !== null && challengerMetrics.rollingSharp20 !== null
        ? challengerMetrics.rollingSharp20 - baselineMetrics.rollingSharp20
        : null;

    // Trend is "improving" if challenger is gaining Sharpe vs baseline (positive gap),
    // "declining" if losing, "stable" if within ±0.05, "insufficient_data" if gap is null.
    const sharpeTrend: AbWeeklyMetrics["sharpeTrend"] =
      sharpeGap === null
        ? "insufficient_data"
        : sharpeGap > 0.05
          ? "improving"
          : sharpeGap < -0.05
            ? "declining"
            : "stable";

    const metrics: AbWeeklyMetrics = {
      baseline: {
        cumulativePnlDelta: baselineMetrics.cumulativePnlDelta,
        rollingSharp20: baselineMetrics.rollingSharp20,
      },
      challenger: {
        cumulativePnlDelta: challengerMetrics.cumulativePnlDelta,
        rollingSharp20: challengerMetrics.rollingSharp20,
      },
      sharpeGap,
      sharpeTrend,
      killSwitchArmedSessions,
      killSwitchEngageCount,
      rlTrainingEpochCount,
      regimeBreakdown,
      noDataFound,
    };

    // ── 4. Build Discord message ──────────────────────────────────────────
    const operatorBody = _buildDigestBody(metrics, correlationId);

    const plainWhat = noDataFound
      ? "The weekly A/B performance check ran but found no trading data yet for this week. The RL challenger may not have routed any signals."
      : sharpeGap !== null && sharpeGap > 0
        ? `This week's check shows the RL challenger has a +${sharpeGap.toFixed(2)} Sharpe edge over the baseline account. It appears to be helping.`
        : sharpeGap !== null && sharpeGap < 0
          ? `This week's check shows the RL challenger is underperforming the baseline by ${Math.abs(sharpeGap).toFixed(2)} Sharpe. Tony should review.`
          : "The weekly A/B check ran successfully. Both accounts were compared for performance.";

    const plainAction = noDataFound
      ? "No action needed. The system is accumulating evidence — check again next week."
      : killSwitchEngageCount > 0
        ? `The RL kill switch fired ${killSwitchEngageCount} time${killSwitchEngageCount !== 1 ? "s" : ""} this week. Tony may want to check the audit logs.`
        : "No action needed. Tony can review the full breakdown if interested.";

    const fullBody = appendFamilyGradePostscript(operatorBody, plainWhat, plainAction);

    // ── 5. Post to Discord (skip in dryRun) ──────────────────────────────
    if (!dryRun) {
      try {
        notifyInfo(
          "[W29D.3] Weekly A/B Snapshot — Friday 17:00 ET",
          fullBody,
          {
            job: "ab-comparison-weekly-digest",
            baselinePnl: metrics.baseline.cumulativePnlDelta,
            challengerPnl: metrics.challenger.cumulativePnlDelta,
            sharpeGap,
            sharpeTrend,
            rlTrainingEpochs: rlTrainingEpochCount,
            killSwitchEngaged: killSwitchEngageCount,
            correlationId,
          },
        );
      } catch (discordErr) {
        // Discord post failure must NOT throw to caller per charter
        const errMsg = discordErr instanceof Error ? discordErr.message : String(discordErr);
        logger.warn(
          { err: discordErr, correlationId, jobName: "ab-comparison-weekly-digest" },
          "ab-comparison-weekly-digest: Discord post failed — emitting discord_failed audit",
        );
        await insertAuditRowSafe({
          action: "ab_comparison_digest.discord_failed",
          entityType: "scheduler_job",
          entityId: "ab-comparison-weekly-digest",
          result: { error: errMsg, correlationId },
          status: "warning",
          decisionAuthority: "system",
          correlationId,
        });
        // Continue — success audit row still written below
      }
    } else {
      logger.info(
        { correlationId, dryRun, operatorBody },
        "ab-comparison-weekly-digest: dryRun=true — Discord post and audit suppressed",
      );
    }

    // ── 6. Emit success audit row (skip in dryRun) ────────────────────────
    const durationMs = Date.now() - t0;
    if (!dryRun) {
      await insertAuditRowSafe({
        action: "ab_comparison_digest.completed",
        entityType: "scheduler_job",
        entityId: "ab-comparison-weekly-digest",
        result: {
          correlationId,
          baseline_pnl: metrics.baseline.cumulativePnlDelta,
          baseline_sharpe: metrics.baseline.rollingSharp20,
          challenger_pnl: metrics.challenger.cumulativePnlDelta,
          challenger_sharpe: metrics.challenger.rollingSharp20,
          sharpe_gap: metrics.sharpeGap,
          sharpe_trend: metrics.sharpeTrend,
          kill_switch_armed_sessions: metrics.killSwitchArmedSessions,
          kill_switch_engage_count: metrics.killSwitchEngageCount,
          rl_training_epoch_count: metrics.rlTrainingEpochCount,
          regime_breakdown: metrics.regimeBreakdown,
          no_data_found: metrics.noDataFound,
          duration_ms: durationMs,
          dry_run: false,
        },
        status: "success",
        decisionAuthority: "system",
        correlationId,
      });
    }

    logger.info(
      {
        correlationId,
        jobName: "ab-comparison-weekly-digest",
        dryRun,
        durationMs,
        noDataFound,
        sharpeGap,
        sharpeTrend,
        rlTrainingEpochs: rlTrainingEpochCount,
        killSwitchEngaged: killSwitchEngageCount,
      },
      "ab-comparison-weekly-digest: weekly digest complete",
    );

    return {
      status: "completed",
      correlationId,
      durationMs,
      metrics,
      dryRun,
    };
  } finally {
    _releaseDigestLock();
  }
}
