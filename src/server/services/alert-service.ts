import { db } from "../db/index.js";
import { alerts } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../index.js";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "trade_signal" | "drawdown" | "regime_change" | "degradation" | "drift" | "decay" | "system";

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
    // TODO: Add SNS/email notification for critical alerts
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

  systemError: (component: string, error: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `System error: ${component}`,
      message: error,
      metadata: { component },
    }),
};
