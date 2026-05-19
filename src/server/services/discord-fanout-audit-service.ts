/**
 * Discord Fan-Out Audit Service (Track 7)
 *
 * Boot-time validator. Verifies the Discord webhook URL is reachable by sending
 * a test ping and validating the 204/200 response from Discord.
 *
 * Adds `discordWebhookHealth` to the production-status route response.
 *
 * Fail-CLOSED: if the webhook is unreachable on boot, logs a critical error and
 * invokes notifyCritical (using the DB/SSE path since Discord is down). The
 * backend does NOT exit — alerting failure is not a boot-stopper for trading
 * itself, but is surfaced loudly in the production-status panel.
 *
 * Env vars:
 *   DISCORD_WEBHOOK_URL — full webhook URL (preferred over port-based relay)
 *   DISCORD_ALERT_PORT  — legacy port-based relay fallback
 */

import { logger } from "../lib/logger.js";

export type DiscordWebhookHealth = "healthy" | "unreachable" | "degraded" | "not_configured";

let _webhookHealth: DiscordWebhookHealth = "not_configured";
let _lastAuditAt: Date | null = null;
let _instanceId: string | null = null;

// ─── Resolve webhook URL ──────────────────────────────────────────────────────

function resolveWebhookUrl(): string | null {
  if (process.env["DISCORD_WEBHOOK_URL"]) {
    return process.env["DISCORD_WEBHOOK_URL"];
  }
  const port = process.env["DISCORD_ALERT_PORT"];
  if (port) {
    return `http://localhost:${port}/alert/discord`;
  }
  return null;
}

// ─── Boot-time audit ──────────────────────────────────────────────────────────

/**
 * Sends a test ping to the Discord webhook. Called once at boot.
 * Mutates the in-memory health state read by production-status.
 */
export async function runDiscordFanoutAudit(instanceId?: string): Promise<DiscordWebhookHealth> {
  _instanceId = instanceId ?? process.env["INSTANCE_ID"] ?? "backend";
  const webhookUrl = resolveWebhookUrl();

  if (!webhookUrl) {
    logger.warn("discord-fanout-audit: DISCORD_WEBHOOK_URL not configured — webhook health: not_configured");
    _webhookHealth = "not_configured";
    _lastAuditAt = new Date();
    return _webhookHealth;
  }

  const pingPayload = {
    type: "boot_audit",
    instance_id: _instanceId,
    timestamp: new Date().toISOString(),
    message: "Trading Forge backend boot — Discord webhook health check",
  };

  try {
    // Discord webhook accepts content field; relay port expects the full object
    const body = webhookUrl.startsWith("https://discord.com/api/webhooks/")
      ? { content: `[Trading Forge] Boot audit ping from ${_instanceId} at ${pingPayload.timestamp}` }
      : pingPayload;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });

    // Discord returns 204 (no content) on success; relay port may return 200
    if (res.status === 204 || res.status === 200) {
      _webhookHealth = "healthy";
      logger.info({ webhookUrl: webhookUrl.slice(0, 40) + "...", status: res.status }, "discord-fanout-audit: webhook healthy");
    } else if (res.status >= 400 && res.status < 500) {
      _webhookHealth = "degraded";
      logger.warn({ status: res.status }, "discord-fanout-audit: webhook returned 4xx — degraded");
    } else {
      _webhookHealth = "unreachable";
      logger.error({ status: res.status }, "discord-fanout-audit: webhook returned unexpected status — unreachable");
    }
  } catch (err) {
    _webhookHealth = "unreachable";
    const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    logger.error(
      { err, timeout: isTimeout },
      "discord-fanout-audit: webhook unreachable on boot — check DISCORD_WEBHOOK_URL",
    );

    // Fail-CLOSED: use the DB/SSE critical path since Discord is down
    try {
      const { notifyCritical } = await import("./notification-service.js");
      await notifyCritical(
        "discord_webhook_unreachable",
        `Discord webhook unreachable on boot (${_instanceId}). ` +
          `Check DISCORD_WEBHOOK_URL env var. All Discord alerts will fail until resolved. ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        { instanceId: _instanceId, webhookConfigured: true, timeout: isTimeout },
      );
    } catch (notifyErr) {
      logger.error({ notifyErr }, "discord-fanout-audit: notifyCritical also failed — no alert delivery path");
    }
  }

  _lastAuditAt = new Date();
  return _webhookHealth;
}

// ─── Accessors for production-status ─────────────────────────────────────────

export function getDiscordWebhookHealth(): DiscordWebhookHealth {
  return _webhookHealth;
}

export function getDiscordAuditLastRanAt(): Date | null {
  return _lastAuditAt;
}
