import { db } from "../db/index.js";
import { alerts } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "trade_signal" | "drawdown" | "regime_change" | "degradation" | "drift" | "decay" | "system" | "lifecycle";

export async function createAlert(params: {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const [alert] = await db.insert(alerts).values({
    type: params.type,
    severity: params.severity,
    title: params.title,
    message: params.message,
    metadata: params.metadata ?? {},
  }).returning();

  // Broadcast via SSE
  broadcastSSE("alert:new", alert);

  // Log critical alerts
  if (params.severity === "critical") {
    logger.error({ alert: params }, `CRITICAL ALERT: ${params.title}`);
    try {
      const discordPort = process.env.DISCORD_ALERT_PORT || "4100";
      await fetch(`http://localhost:${discordPort}/alert/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: params.title, message: params.message, severity: "critical" }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (e) {
      // Best-effort — a hung relay must never block critical alert delivery
      const isAbort = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      logger.warn({ err: e, timeout: isAbort }, "Failed to send Discord alert");
    }
  } else {
    logger.info({ alertId: alert.id, type: params.type }, `Alert: ${params.title}`);
  }

  return alert;
}

// Pre-built alert factories for common scenarios
export const AlertFactory = {
  drawdownWarning: (strategyId: string, drawdown: number, limit: number) =>
    createAlert({
      type: "drawdown",
      severity: drawdown > limit * 0.8 ? "critical" : "warning",
      title: `Drawdown alert: $${drawdown.toFixed(0)} / $${limit}`,
      message: `Strategy ${strategyId} drawdown at ${((drawdown / limit) * 100).toFixed(0)}% of limit`,
      metadata: { strategyId, drawdown, limit },
    }),

  driftAlert: (strategyId: string, metric: string, deviation: number) =>
    createAlert({
      type: "drift",
      severity: deviation > 2 ? "critical" : "warning",
      title: `Drift detected: ${metric} (${deviation.toFixed(1)}σ)`,
      message: `Strategy ${strategyId} ${metric} has drifted ${deviation.toFixed(1)} standard deviations from backtest`,
      metadata: { strategyId, metric, deviation },
    }),

  decayAlert: (strategyId: string, level: string) =>
    createAlert({
      type: "decay",
      severity: level === "quarantine" || level === "retire" ? "critical" : "warning",
      title: `Alpha decay: ${level}`,
      message: `Strategy ${strategyId} moved to decay level: ${level}`,
      metadata: { strategyId, level },
    }),

  systemError: (component: string, error: string | Error) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `System error: ${component}`,
      message: error instanceof Error ? error.message : error,
      metadata: { component },
    }),

  deployReady: (strategyId: string, message: string) =>
    createAlert({
      type: "lifecycle",
      severity: "info",
      title: "Strategy ready for deployment",
      message,
      metadata: { strategyId, action: "review_library" },
    }),

  circuitOpen: (endpoint: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Circuit breaker OPEN: ${endpoint}`,
      message: `Circuit breaker for "${endpoint}" has tripped open. Requests to this subsystem are being rejected until the cooldown elapses and a probe succeeds.`,
      metadata: { endpoint, event: "circuit_open" },
    }),

  schedulerMissed: (jobName: string, overdueMs: number) =>
    createAlert({
      type: "system",
      severity: "warning",
      title: `Scheduler missed: ${jobName}`,
      message: `Scheduled job "${jobName}" is ${Math.round(overdueMs / 1000)}s overdue.`,
      metadata: { jobName, overdueMs },
    }),

  paperSessionStale: (sessionId: string, lastSignalAgeMs: number) =>
    createAlert({
      type: "system",
      severity: "warning",
      title: `Paper session stale: ${sessionId.slice(0, 8)}`,
      message: `Paper session ${sessionId} has not received a signal in ${Math.round(lastSignalAgeMs / 1000)}s.`,
      metadata: { sessionId, lastSignalAgeMs },
    }),

  complianceDrift: (firm: string, summary: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Compliance drift detected: ${firm}`,
      message: summary,
      metadata: { firm },
    }),

  // D6: Kill switch tripped — used when the automated kill switch halts trading
  // to prevent prop firm daily loss breach or consecutive loss streaks.
  criticalAlert: (component: string, metadata: Record<string, unknown>) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Kill switch: ${component}`,
      message: `Kill switch tripped for ${component}: ${JSON.stringify(metadata)}`,
      metadata: { component, ...metadata },
    }),

  // A7: Signal correlation alert — Two Sigma failure mode detection.
  // Fires when two strategies have cosine(signal_a, signal_b) > threshold.
  signalCorrelation: (
    strategyIdA: string,
    strategyIdB: string,
    similarity: number,
    threshold: number,
  ) =>
    createAlert({
      type: "drift",
      severity: "critical",
      title: `Signal correlation ALERT: ${similarity.toFixed(3)} > ${threshold}`,
      message:
        `Strategies ${strategyIdA.slice(0, 8)} and ${strategyIdB.slice(0, 8)} have cosine similarity ` +
        `${similarity.toFixed(3)} (threshold: ${threshold}). Two Sigma failure mode: ` +
        `different code, identical signals. Review before allowing deployment.`,
      metadata: { strategyIdA, strategyIdB, similarity, threshold },
    }),

  // Track 7: Dead-man's heartbeat stale alert.
  // Fires when the backend has been silent for > 2h during RTH and SMS is unavailable.
  // backendRestartedAt (M-8): ISO timestamp of when the backend process started this cycle.
  // Allows operators to correlate a stale alert with a recent restart-and-silent condition.
  notifyHeartbeatStale: (lastAt: Date | null, minutesSince: number, backendRestartedAt?: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: "Dead-man heartbeat: backend silent",
      message:
        `Backend heartbeat is stale. Last heartbeat: ${lastAt ? lastAt.toISOString() : "never"}. ` +
        `Silence duration: ${minutesSince} minutes. ` +
        (backendRestartedAt ? `Backend last restarted: ${backendRestartedAt}. ` : "") +
        `Verify the backend process is running on the Skytech tower.`,
      metadata: {
        lastHeartbeatAt: lastAt ? lastAt.toISOString() : null,
        minutesSince,
        backendRestartedAt: backendRestartedAt ?? null,
        event: "heartbeat_stale",
      },
    }),

  // C6: Bitwarden session expiring soon alert.
  // Fires when the BW_SESSION token will expire within `hoursRemaining` hours.
  notifyBwSessionExpiringSoon: (hoursRemaining: number) =>
    createAlert({
      type: "system",
      severity: hoursRemaining <= 1 ? "critical" : "warning",
      title: `Bitwarden session expiring in ${hoursRemaining}h`,
      message:
        `The Bitwarden vault session token will expire in approximately ${hoursRemaining} hour(s). ` +
        `The daily session refresh cron should renew it automatically. If this alert persists, ` +
        `run 'bw login' manually on the Skytech tower and update BW_SESSION in the .env file.`,
      metadata: {
        hoursRemaining,
        event: "bw_session_expiring_soon",
      },
    }),

  // Track 7: Prop-firm cookie refresh failed alert.
  // Fires when automated Playwright cookie refresh fails for a firm, meaning session cookies
  // will go stale and the dashboard snapshot / login sequence will break.
  notifyCookieRefreshFailed: (firmId: string, error: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Cookie refresh failed: ${firmId}`,
      message:
        `Automated session cookie refresh for firm "${firmId}" failed. ` +
        `Dashboard snapshots and authenticated actions for this firm will degrade until cookies are renewed. ` +
        `Error: ${error}`,
      metadata: {
        firmId,
        error,
        event: "cookie_refresh_failed",
      },
    }),

  // H-4: Reconciliation mismatch alert (first-class method).
  // Fires when daily reconciliation detects count or PnL mismatches across sources.
  criticalReconciliationMismatch: (
    reconDate: string,
    mismatchCount: number,
    details: Array<{ source: string; expected: number | string; actual: number | string; delta?: number }>,
  ) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Reconciliation mismatch: ${reconDate} (${mismatchCount} check${mismatchCount !== 1 ? "s" : ""} failed)`,
      message:
        `Daily reconciliation for ${reconDate} found ${mismatchCount} mismatch(es). ` +
        `Sources: ${details.map((d) => d.source).join(", ")}. ` +
        `Investigate production_trades vs TradersPost vs Tradovate vs MFFU dashboard.`,
      metadata: {
        reconDate,
        mismatchCount,
        details,
        event: "reconciliation_mismatch",
      },
    }),
};
