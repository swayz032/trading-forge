import { db } from "../db/index.js";
import { alerts } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { logger } from "../lib/logger.js";
import { notifyWarning, notifyInfo } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { warningSeverityDiscordRoutedTotal } from "../lib/metrics-registry.js";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType = "trade_signal" | "drawdown" | "regime_change" | "degradation" | "drift" | "decay" | "system" | "lifecycle";

export async function createAlert(params: {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  // H7: guarantee every critical alert carries a family-grade postscript so
  // family members always have context. Callers that already wrap with
  // appendFamilyGradePostscript() pass through unchanged (sentinel present).
  // The 9 AlertFactory paths that don't include a postscript get this
  // generic fallback applied centrally — zero caller changes required.
  const FAMILY_SENTINEL = "--- For family members ---";
  const effectiveMessage =
    params.severity === "critical" && !params.message.includes(FAMILY_SENTINEL)
      ? params.message +
        "\n\n--- For family members ---\n" +
        "What this means: The trading system detected a critical issue. Auto-remediation was attempted.\n" +
        "What to do: No immediate action needed — wait 5 minutes. If you see multiple alerts in a row, call Tony."
      : params.message;

  const [alert] = await db.insert(alerts).values({
    type: params.type,
    severity: params.severity,
    title: params.title,
    message: effectiveMessage,
    metadata: params.metadata ?? {},
  }).returning();

  // Broadcast via SSE
  broadcastSSE("alert:new", alert);

  // Log critical alerts
  if (params.severity === "critical") {
    logger.error({ alert: params }, `CRITICAL ALERT: ${params.title}`);
    // C2: add Authorization header when API_KEY is set so the Discord bot
    // accepts the request instead of returning 401. Check response.ok so
    // 4xx responses are visible even when the bot returns a non-success status.
    try {
      const discordPort = process.env.DISCORD_ALERT_PORT || "4100";
      const apiKey = process.env.API_KEY;
      const discordHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) {
        discordHeaders["Authorization"] = `Bearer ${apiKey}`;
      }
      // Deep-scan #5 A-1 (2026-06-29): forward correlationId into the Discord payload so an
      // alert seen on a phone can be traced back to the audit_log chain. It is stored in the
      // DB alert.metadata but was never sent to Discord — forensic lookup from Discord was
      // impossible. Pull from metadata.correlationId (the canonical propagation key).
      const _alertCorrelationId = (params.metadata?.correlationId as string | null | undefined) ?? null;
      const response = await fetch(`http://localhost:${discordPort}/alert/alerts`, {
        method: "POST",
        headers: discordHeaders,
        body: JSON.stringify({ title: params.title, message: effectiveMessage, severity: "critical", correlationId: _alertCorrelationId }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "alert delivery to discord bot failed");
      }
    } catch (e) {
      // Best-effort — a hung relay must never block critical alert delivery
      const isAbort = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      logger.warn({ err: e, timeout: isAbort }, "Failed to send Discord alert");
    }
  } else if (params.severity === "warning") {
    logger.warn({ alertId: alert.id, type: params.type }, `Alert (warning): ${params.title}`);
    // Route warning-severity alerts through notification-service (batched Discord delivery).
    // appendFamilyGradePostscript appends a plain-English block for non-technical family members.
    notifyWarning(
      params.title,
      appendFamilyGradePostscript(
        params.message,
        `A warning was triggered: "${params.title}". The system detected an issue that needs attention but is not yet critical.`,
        "Tell Tony: 'There is a warning alert in the trading system.' If you cannot reach him, the system is still safe — no orders are affected by a warning.",
      ),
      params.metadata,
    );
    warningSeverityDiscordRoutedTotal.inc({ severity: "warning" });
  } else {
    // severity === "info"
    logger.info({ alertId: alert.id, type: params.type }, `Alert: ${params.title}`);
    // Route info-severity alerts through notification-service (immediate delivery).
    notifyInfo(
      params.title,
      appendFamilyGradePostscript(
        params.message,
        `An informational update was triggered: "${params.title}". This is for operator awareness only.`,
        "No action needed. This is just an update.",
      ),
      params.metadata,
    );
    warningSeverityDiscordRoutedTotal.inc({ severity: "info" });
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
  //
  // Wave hardening 2026-06-22, autonomous-readiness A-4:
  // Added family-grade postscript via appendFamilyGradePostscript so non-technical
  // family members understand the alert and have a concrete action (power-cycle).
  notifyHeartbeatStale: (lastAt: Date | null, minutesSince: number, backendRestartedAt?: string) => {
    const hoursSince = Math.round(minutesSince / 60);
    const technicalBody =
      `Backend heartbeat is stale. Last heartbeat: ${lastAt ? lastAt.toISOString() : "never"}. ` +
      `Silence duration: ${minutesSince} minutes. ` +
      (backendRestartedAt ? `Backend last restarted: ${backendRestartedAt}. ` : "") +
      `Auto-restart will be attempted autonomously (see audit_log dead_mans_heartbeat.auto_restart_attempted). ` +
      `If auto-restart fails, verify the backend process is running on the Skytech tower.`;
    return createAlert({
      type: "system",
      severity: "critical",
      title: "Dead-man heartbeat: backend silent",
      message: appendFamilyGradePostscript(
        technicalBody,
        `The trading bot stopped responding about ${hoursSince > 0 ? `${hoursSince} hour${hoursSince !== 1 ? "s" : ""}` : `${minutesSince} minutes`} ago. We're trying to restart it automatically.`,
        "If the bot is still offline in 5 minutes, hold the power button on the home computer for 5 seconds to reboot it — the bot restarts on its own after reboot. If you can't reach Tony, this is the safe action.",
      ),
      metadata: {
        lastHeartbeatAt: lastAt ? lastAt.toISOString() : null,
        minutesSince,
        backendRestartedAt: backendRestartedAt ?? null,
        event: "heartbeat_stale",
      },
    });
  },

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
  //
  // FIX 4 (DEBT-4) 2026-06-24: wrapped with appendFamilyGradePostscript so family members
  // receive plain-English context (mirrors heartbeat/BW alert pattern). The cookie failure
  // only affects dashboard snapshots — live trading continues safely — so the family action
  // is low-urgency (tell Tony, don't panic).
  notifyCookieRefreshFailed: (firmId: string, error: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: `Cookie refresh failed: ${firmId}`,
      message: appendFamilyGradePostscript(
        `Automated session cookie refresh for firm "${firmId}" failed. ` +
        `Dashboard snapshots and authenticated actions for this firm will degrade until cookies are renewed. ` +
        `Error: ${error}`,
        `The bot's connection to the ${firmId} dashboard expired and could not renew automatically.`,
        `Tell Tony: '${firmId} cookies failed to refresh.' The bot is still trading safely — this only affects dashboard snapshots.`,
      ),
      metadata: {
        firmId,
        error,
        event: "cookie_refresh_failed",
      },
    }),

  // A-1: Operator-absent auto-promote sweep failure alert.
  // Fires when the catch() wrapping the vacation auto-promote sweep catches an
  // unexpected error (e.g. DB unavailable, lifecycle-service import failure).
  // This is Discord-CRITICAL so the operator sees the failure even while on
  // vacation. appendFamilyGradePostscript adds a plain-English family postscript
  // so a family member reading Discord knows no action is needed immediately.
  notifyAbsentAutoPromoteFailed: (errorMessage: string, correlationId: string) =>
    createAlert({
      type: "system",
      severity: "critical",
      title: "Vacation auto-promote sweep FAILED",
      message: appendFamilyGradePostscript(
        `The operator-absent auto-promote sweep threw an unexpected error and did NOT run. ` +
        `DEPLOY_READY strategies may not have been promoted to PILOT during this vacation window. ` +
        `Error: ${errorMessage}. CorrelationId: ${correlationId}. ` +
        `Review lifecycle-service logs and re-trigger manually via the admin dashboard.`,
        "The bot tried to automatically advance a strategy while you were away, but hit a technical error. No trades were affected.",
        "The bot is still running safely — call Tony when he's back so he can review. No action needed right now.",
      ),
      metadata: { errorMessage, correlationId, event: "absent_auto_promote_sweep_failed" },
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
