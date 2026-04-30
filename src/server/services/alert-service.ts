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
};
