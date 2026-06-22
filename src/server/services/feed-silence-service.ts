/**
 * Feed Silence Service — Workstream W1 (go-live blocker #5a)
 *
 * Per-strategy expected-cadence silence alarm.
 *
 * PROBLEM: Nothing today detects the live TradingView/Pine feed going SILENT
 * for a specific strategy. Dead-man's heartbeat detects backend silence;
 * webhook-latency-monitor measures round-trip latency of *received* webhooks.
 * Neither catches the case where alerts simply stop arriving for a given
 * strategy during RTH — leaving open positions unmanaged with no alarm.
 *
 * SOLUTION: For every ACTIVE live/paper strategy (lifecycle_state IN
 * ('PAPER', 'DEPLOY_READY', 'PILOT', 'DEPLOYED')):
 *   1. Read the last received inbound signal timestamp from paper_signal_logs
 *      (the authoritative last-received-signal source for paper/live strategies).
 *   2. Compare against the strategy's bar interval (timeframe) × a configurable
 *      multiplier (default: 3).
 *   3. If the strategy has been silent beyond that threshold AND we are currently
 *      inside RTH (09:30–16:00 ET, Mon–Fri), fire a Discord CRITICAL + write a
 *      feed.silence_detected audit row.
 *   4. In-process per-strategy dedup prevents alert spam across ticks.
 *
 * SIGNAL SOURCE:
 *   paper_signal_logs.created_at — most recent row per strategy_id (joined
 *   through paper_sessions). This table is written on EVERY inbound signal
 *   regardless of whether a position was opened (acted=true/false). It is the
 *   authoritative last-received-signal record for any strategy receiving live
 *   TradingView/Pine alerts.
 *
 *   Assumption documented: if paper_signal_logs has NO rows for a strategy that
 *   should be receiving signals, that itself is considered silence as of the
 *   strategy's activation time.
 *
 * PIPELINE EXEMPT: This cron fires even when the pipeline is PAUSED because a
 *   feed going silent is a safety signal independent of research gate state.
 *   An operator who paused the pipeline still needs to know if a deployed
 *   strategy stopped receiving signals.
 *
 * ENV VARS:
 *   FEED_SILENCE_THRESHOLD_MULTIPLIER  (default: 3)   N × bar-interval before alarm
 *   FEED_SILENCE_MIN_BAR_INTERVAL_MS   (default: 60000)  min 1 min regardless of timeframe
 *   FEED_SILENCE_MAX_BAR_INTERVAL_MS   (default: 3600000) cap at 1h for strategy silence
 *
 * Failure posture: fails open on DB errors — a broken silence detector never
 * blocks the pipeline. Individual strategy errors are caught and logged.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const RTH_START_ET_HOUR = 9;   // 09:30 AM ET (we check >= 9 for safety margin)
const RTH_END_ET_HOUR   = 16;  // 04:00 PM ET

/** Lifecycle states considered "active" for silence monitoring */
const ACTIVE_LIFECYCLE_STATES = ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"] as const;

/** Default: 3 × bar-interval before firing a silence alert */
const DEFAULT_THRESHOLD_MULTIPLIER = 3;

/** Minimum bar interval to use in silence math — 1 minute */
const DEFAULT_MIN_BAR_INTERVAL_MS = 60_000;

/** Maximum bar interval cap — 1 hour. Strategies with longer bars (daily etc.)
 *  are excluded from per-bar silence monitoring (would create too many false
 *  positives on low-frequency strategies that legitimately don't signal for hours). */
const DEFAULT_MAX_BAR_INTERVAL_MS = 3_600_000;

// ─── PostgreSQL schema-drift error code ───────────────────────────────────────
const PG_RELATION_NOT_FOUND = "42P01";

function isTableMissingError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PG_RELATION_NOT_FOUND
  );
}

// ─── In-process dedup map ─────────────────────────────────────────────────────
// Maps strategyId → ISO timestamp string of the silence window we already alerted for.
// Resets when the feed recovers (new signal arrives). Prevents alert spam across
// cron ticks while the silence persists.
//
// Exported for test inspection only.
export const _silenceAlertedFor: Map<string, string> = new Map();

// ─── Env-configurable thresholds (no magic numbers) ──────────────────────────

function getThresholdMultiplier(): number {
  const raw = process.env.FEED_SILENCE_THRESHOLD_MULTIPLIER;
  const val = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(val) && val > 0 ? val : DEFAULT_THRESHOLD_MULTIPLIER;
}

function getMinBarIntervalMs(): number {
  const raw = process.env.FEED_SILENCE_MIN_BAR_INTERVAL_MS;
  const val = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(val) && val > 0 ? val : DEFAULT_MIN_BAR_INTERVAL_MS;
}

function getMaxBarIntervalMs(): number {
  const raw = process.env.FEED_SILENCE_MAX_BAR_INTERVAL_MS;
  const val = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(val) && val > 0 ? val : DEFAULT_MAX_BAR_INTERVAL_MS;
}

// ─── Timeframe → ms conversion ───────────────────────────────────────────────

/**
 * Convert a TradingView/Pine timeframe string to milliseconds.
 * Examples: "1" → 60_000, "5" → 300_000, "15" → 900_000, "1h" → 3_600_000,
 *           "60" → 3_600_000, "D" → 86_400_000.
 * Unknown formats → null (caller treats as non-monitorable).
 */
export function timeframeToMs(timeframe: string | null | undefined): number | null {
  if (!timeframe) return null;

  const tf = timeframe.trim().toUpperCase();

  // Daily / weekly / monthly — too coarse for silence monitoring
  if (tf === "D" || tf === "W" || tf === "M" || tf === "1D" || tf === "1W" || tf === "1M") {
    return null;
  }

  // Match "Nh" or "Nm" (hours/minutes with suffix)
  const withSuffix = /^(\d+)(H|M)$/.exec(tf);
  if (withSuffix) {
    const n = Number(withSuffix[1]);
    const unit = withSuffix[2];
    if (!Number.isFinite(n) || n <= 0) return null;
    return unit === "H" ? n * 3_600_000 : n * 60_000;
  }

  // Plain numeric string → minutes (TradingView default: "5" = 5-minute bar)
  const asNumber = Number(tf);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    if (asNumber >= 60 && asNumber % 60 === 0) {
      // 60, 120, 240 etc. are hour-based bars
      return (asNumber / 60) * 3_600_000;
    }
    return asNumber * 60_000;
  }

  return null;
}

// ─── RTH helper (copied verbatim from dead-mans-heartbeat-service.ts) ────────
// Track A F-2: Use Intl.DateTimeFormat.formatToParts() to extract the ET hour
// without re-parsing a locale string. toLocaleString→new Date() round-trip
// re-parses in the *system* TZ on Windows — formatToParts gives the numeric
// field directly, no TZ ambiguity.

export function isEtRth(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  // "24" is returned at midnight by some ICU builds — normalise to 0.
  const hour = hourPart ? (Number(hourPart.value) % 24) : 0;
  // Only Monday–Friday: check day-of-week in ET
  const dayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).formatToParts(now);
  const dayPart = dayParts.find((p) => p.type === "weekday");
  const day = dayPart?.value ?? "Mon";
  const isWeekday = !["Sat", "Sun"].includes(day);
  return isWeekday && hour >= RTH_START_ET_HOUR && hour < RTH_END_ET_HOUR;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface StrategyFeedStatus {
  strategyId: string;
  strategyName: string;
  timeframe: string | null;
  barIntervalMs: number | null;
  thresholdMs: number | null;
  lastSignalAt: Date | null;
  silenceMs: number | null;
  isSilent: boolean;
  alertFired: boolean;
  skipReason?: string;
}

export interface FeedSilenceRunResult {
  checkedAt: string;
  rtbGate: boolean;  // RTH gate passed?
  strategiesChecked: number;
  silentStrategies: number;
  alertsFired: number;
  statuses: StrategyFeedStatus[];
}

// ─── Core implementation ──────────────────────────────────────────────────────

/**
 * Query all active strategies with their last signal timestamp from
 * paper_signal_logs (via paper_sessions join).
 *
 * Returns an array of {strategy_id, strategy_name, timeframe, last_signal_at}.
 * Uses lazy import of schema to preserve test isolation.
 */
async function queryActiveStrategiesWithLastSignal(): Promise<
  Array<{
    strategyId: string;
    strategyName: string;
    timeframe: string | null;
    lastSignalAt: Date | null;
  }>
> {
  const stateList = ACTIVE_LIFECYCLE_STATES.map((s) => `'${s}'`).join(", ");

  // Raw SQL to avoid Drizzle ORM type complexity when joining across three tables.
  // We want: for each active strategy, the most recent paper_signal_logs entry.
  const rows = await db.execute(sql`
    SELECT
      s.id          AS strategy_id,
      s.name        AS strategy_name,
      s.timeframe   AS timeframe,
      MAX(psl.created_at) AS last_signal_at
    FROM strategies s
    LEFT JOIN paper_sessions ps ON ps.strategy_id = s.id
    LEFT JOIN paper_signal_logs psl ON psl.session_id = ps.id
    WHERE s.lifecycle_state IN (${sql.raw(stateList)})
    GROUP BY s.id, s.name, s.timeframe
    ORDER BY s.name
  `);

  const rawRows = rows as unknown as Array<{
    strategy_id: string;
    strategy_name: string;
    timeframe: string | null;
    last_signal_at: Date | string | null;
  }>;

  return rawRows.map((r) => ({
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    timeframe: r.timeframe ?? null,
    lastSignalAt: r.last_signal_at
      ? r.last_signal_at instanceof Date
        ? r.last_signal_at
        : new Date(r.last_signal_at)
      : null,
  }));
}

/**
 * Check a single strategy for feed silence.
 * Returns the status object; fires alert + audit row when silent during RTH.
 */
async function checkSingleStrategy(
  strategyId: string,
  strategyName: string,
  timeframe: string | null,
  lastSignalAt: Date | null,
  nowMs: number,
  correlationId: string,
): Promise<StrategyFeedStatus> {
  const barIntervalMs = timeframeToMs(timeframe);
  const minBar = getMinBarIntervalMs();
  const maxBar = getMaxBarIntervalMs();
  const multiplier = getThresholdMultiplier();

  // Skip: timeframe not parseable
  if (barIntervalMs === null) {
    return {
      strategyId,
      strategyName,
      timeframe,
      barIntervalMs: null,
      thresholdMs: null,
      lastSignalAt,
      silenceMs: null,
      isSilent: false,
      alertFired: false,
      skipReason: "timeframe_unparseable",
    };
  }

  // Skip: bar interval too large for silence monitoring (e.g. daily bars)
  if (barIntervalMs > maxBar) {
    return {
      strategyId,
      strategyName,
      timeframe,
      barIntervalMs,
      thresholdMs: null,
      lastSignalAt,
      silenceMs: null,
      isSilent: false,
      alertFired: false,
      skipReason: "bar_interval_exceeds_max",
    };
  }

  const effectiveBarMs = Math.max(barIntervalMs, minBar);
  const thresholdMs = effectiveBarMs * multiplier;

  const silenceMs =
    lastSignalAt !== null ? nowMs - lastSignalAt.getTime() : null;

  const isSilent =
    silenceMs === null
      ? true  // no signal EVER recorded for this active strategy → definitely silent
      : silenceMs > thresholdMs;

  const status: StrategyFeedStatus = {
    strategyId,
    strategyName,
    timeframe,
    barIntervalMs,
    thresholdMs,
    lastSignalAt,
    silenceMs,
    isSilent,
    alertFired: false,
  };

  if (!isSilent) {
    // Feed is healthy — clear any prior dedup entry so it can re-alert if silent again
    _silenceAlertedFor.delete(strategyId);
    return status;
  }

  // Compute the silence window key for dedup
  const silenceWindowKey = lastSignalAt?.toISOString() ?? "never";

  // Dedup: already alerted for this exact silence window
  if (_silenceAlertedFor.get(strategyId) === silenceWindowKey) {
    logger.debug(
      { strategyId, strategyName, silenceWindowKey },
      "feed-silence: dedup hit — already alerted for this silence window",
    );
    return status;
  }

  // Fire the alert
  const silenceSec = silenceMs !== null ? Math.round(silenceMs / 1000) : null;
  const thresholdSec = Math.round(thresholdMs / 1000);
  const lastSeenStr = lastSignalAt?.toISOString() ?? "never";

  const operatorBody =
    `Strategy **${strategyName}** (id: ${strategyId}) has not received a signal for ` +
    `${silenceSec !== null ? `${silenceSec}s` : "its entire active lifetime"}. ` +
    `Threshold: ${thresholdSec}s (${multiplier}× ${timeframe ?? "?"} bar interval). ` +
    `Last signal: ${lastSeenStr}. ` +
    `Check TradingView alert status, Pine script execution, and TradersPost routing.`;

  const fullBody = appendFamilyGradePostscript(
    operatorBody,
    `The trading bot "${strategyName}" has stopped receiving signals from TradingView for more than ${Math.round(thresholdSec / 60)} minutes.`,
    "Message the operator. The bot cannot trade without signals — open positions may be unmanaged.",
  );

  notifyCritical(`Feed silence: ${strategyName}`, fullBody, {
    strategyId,
    strategyName,
    timeframe,
    thresholdSec,
    silenceSec,
    lastSignalAt: lastSeenStr,
    correlationId,
  });

  logger.error(
    {
      strategyId,
      strategyName,
      timeframe,
      thresholdMs,
      silenceMs,
      lastSignalAt: lastSeenStr,
      correlationId,
    },
    "feed-silence: strategy feed silence detected — alert fired",
  );

  // Audit row (lazy schema import for test isolation)
  await insertAuditRow({
    action: "feed.silence_detected",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "system",
    input: {
      strategyName,
      timeframe,
      thresholdMs,
      thresholdMultiplier: multiplier,
      barIntervalMs: effectiveBarMs,
    } as Record<string, unknown>,
    result: {
      silenceMs,
      lastSignalAt: lastSeenStr,
      alertFired: true,
    } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) =>
    logger.error(
      { err, strategyId, strategyName },
      "feed-silence: audit row insert failed (non-blocking)",
    ),
  );

  // Mark as alerted for this silence window
  _silenceAlertedFor.set(strategyId, silenceWindowKey);
  status.alertFired = true;
  return status;
}

/**
 * runFeedSilenceCheck — main entry point, called by the scheduler cron.
 *
 * 1. Gate: if outside RTH, log + return immediately.
 * 2. Query active strategies with last signal timestamp.
 * 3. For each strategy, check silence vs threshold.
 * 4. Fire alert + audit on silence.
 *
 * Fails open: any DB error is caught, logged, and treated as "no alarm" for
 * that strategy. The monitor never blocks the pipeline.
 */
export async function runFeedSilenceCheck(): Promise<FeedSilenceRunResult> {
  const correlationId = randomUUID();
  const checkedAt = new Date().toISOString();

  if (!isEtRth()) {
    logger.debug({ correlationId }, "feed-silence: outside RTH — skipping check");
    return {
      checkedAt,
      rtbGate: false,
      strategiesChecked: 0,
      silentStrategies: 0,
      alertsFired: 0,
      statuses: [],
    };
  }

  logger.info({ correlationId }, "feed-silence: RTH gate passed — querying active strategies");

  let strategies: Awaited<ReturnType<typeof queryActiveStrategiesWithLastSignal>>;
  try {
    strategies = await queryActiveStrategiesWithLastSignal();
  } catch (err) {
    if (isTableMissingError(err)) {
      logger.warn(
        { err, correlationId },
        "feed-silence: strategies or paper_signal_logs table missing (schema drift) — skipping",
      );
    } else {
      logger.error({ err, correlationId }, "feed-silence: DB query failed — fail-open");
    }
    return {
      checkedAt,
      rtbGate: true,
      strategiesChecked: 0,
      silentStrategies: 0,
      alertsFired: 0,
      statuses: [],
    };
  }

  logger.info(
    { correlationId, count: strategies.length },
    "feed-silence: checking strategies for signal silence",
  );

  const nowMs = Date.now();
  const statuses: StrategyFeedStatus[] = [];
  let silentCount = 0;
  let alertCount = 0;

  for (const s of strategies) {
    try {
      const status = await checkSingleStrategy(
        s.strategyId,
        s.strategyName,
        s.timeframe,
        s.lastSignalAt,
        nowMs,
        correlationId,
      );
      statuses.push(status);
      if (status.isSilent) silentCount++;
      if (status.alertFired) alertCount++;
    } catch (err) {
      logger.error(
        { err, strategyId: s.strategyId, strategyName: s.strategyName, correlationId },
        "feed-silence: per-strategy check threw — skipping this strategy (fail-open)",
      );
    }
  }

  logger.info(
    {
      correlationId,
      strategiesChecked: strategies.length,
      silentStrategies: silentCount,
      alertsFired: alertCount,
    },
    "feed-silence: tick complete",
  );

  return {
    checkedAt,
    rtbGate: true,
    strategiesChecked: strategies.length,
    silentStrategies: silentCount,
    alertsFired: alertCount,
    statuses,
  };
}

// ─── Test seam ────────────────────────────────────────────────────────────────
// Exported ONLY for unit tests. Production code must not import __test__.
export const __test__ = {
  DEFAULT_THRESHOLD_MULTIPLIER,
  DEFAULT_MIN_BAR_INTERVAL_MS,
  DEFAULT_MAX_BAR_INTERVAL_MS,
  RTH_START_ET_HOUR,
  RTH_END_ET_HOUR,
  ACTIVE_LIFECYCLE_STATES,
  timeframeToMs,
  isEtRth,
  checkSingleStrategy,
  clearDedupMap: () => _silenceAlertedFor.clear(),
};
