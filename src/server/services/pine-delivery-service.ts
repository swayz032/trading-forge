/**
 * pine-delivery-service.ts — Track 6 / Pass 2
 *
 * Bundles .pine + setup README + per-recipient instructions and delivers
 * via the configured channel.
 *
 * Channels (in priority order):
 *   1. filesystem (default) — write bundle to data/pine-bundles/<recipient>/ directory.
 *      Operator hand-delivers via secure messaging.
 *   2. Discord webhook — POST embed to operator's Discord channel.
 *      Activated by PINE_DELIVERY_DISCORD_WEBHOOK env var.
 *   3. email (SMTP) — send as attachment.
 *      Activated by SMTP_HOST + PINE_DELIVERY_EMAIL_TO env vars.
 *
 * Security notes:
 *   - HMAC secrets are NOT included in Discord / email delivery bodies.
 *     The bundle .pine file contains the embedded secret already.
 *   - Filesystem bundles are written to a path outside the web root.
 *   - Discord delivery sends filename + artifact_hash + recipient_label only
 *     (no raw Pine code, no HMAC values in Discord message).
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve as pathResolve, join as pathJoin } from "path";
import { logger } from "../index.js";
import { broadcastSSE } from "../routes/sse.js";
import { notifyWarning } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");
const BUNDLE_DIR = pathJoin(PROJECT_ROOT, "data", "pine-bundles");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeliveryBundle {
  recipientLabel: string;
  strategyName: string;
  artifactFileName: string;
  pineContent: string;
  setupReadme: string;
  artifactHash: string;
  /** Propagated from generateRecipientExport for end-to-end trace linkage. */
  correlationId?: string | null;
  /** Strategy ID — written to audit_log entity reference. */
  strategyId?: string | null;
}

export interface DeliveryResult {
  channel: "filesystem" | "discord" | "email";
  bundlePath: string | null;
  delivered: boolean;
  error?: string;
}

// ─── Filesystem Delivery (default) ───────────────────────────────────────────

function deliverToFilesystem(bundle: DeliveryBundle): DeliveryResult {
  try {
    const recipientDir = pathJoin(BUNDLE_DIR, bundle.recipientLabel);
    if (!existsSync(recipientDir)) {
      mkdirSync(recipientDir, { recursive: true });
    }

    const pineFilePath = pathJoin(recipientDir, bundle.artifactFileName);
    const readmeFilePath = pathJoin(recipientDir, "SETUP_README.md");

    writeFileSync(pineFilePath, bundle.pineContent, "utf8");
    writeFileSync(readmeFilePath, bundle.setupReadme, "utf8");

    logger.info(
      { recipientLabel: bundle.recipientLabel, pineFilePath, readmeFilePath },
      "pine-delivery: bundle written to filesystem",
    );

    return {
      channel: "filesystem",
      bundlePath: recipientDir,
      delivered: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, recipientLabel: bundle.recipientLabel }, "pine-delivery: filesystem write failed");
    return {
      channel: "filesystem",
      bundlePath: null,
      delivered: false,
      error: errorMsg,
    };
  }
}

// ─── Discord Webhook Delivery ─────────────────────────────────────────────────

async function deliverToDiscord(bundle: DeliveryBundle): Promise<DeliveryResult> {
  const webhookUrl = process.env.PINE_DELIVERY_DISCORD_WEBHOOK;
  if (!webhookUrl) {
    return { channel: "discord", bundlePath: null, delivered: false, error: "PINE_DELIVERY_DISCORD_WEBHOOK not configured" };
  }

  try {
    // Security: do NOT include HMAC or raw Pine code in Discord message.
    // Send only metadata: recipient, strategy, filename, hash (first 16 chars).
    const payload = {
      embeds: [
        {
          title: "Pine Script Bundle Ready",
          description: [
            `**Recipient:** ${bundle.recipientLabel}`,
            `**Strategy:** ${bundle.strategyName}`,
            `**File:** ${bundle.artifactFileName}`,
            `**Hash:** \`${bundle.artifactHash.slice(0, 16)}\``,
            "",
            "Retrieve bundle from operator filesystem and deliver via secure messaging.",
          ].join("\n"),
          color: 0x10B981,  // Trading Forge emerald
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text();
      const errorMsg = `Discord webhook ${resp.status}: ${body.slice(0, 200)}`;
      logger.warn({ recipientLabel: bundle.recipientLabel, status: resp.status }, "pine-delivery: Discord webhook returned non-OK");
      notifyWarning(
        "Pine Bundle Discord Delivery Failed",
        appendFamilyGradePostscript(
          `Discord notification for recipient ${bundle.recipientLabel} failed (HTTP ${resp.status}). ` +
            `Bundle is available on filesystem — manual delivery required.`,
          "There was an issue delivering a trading script to a family member's account.",
          "No action needed — the bot will retry. Call Tony if trading doesn't start for the family member within an hour.",
        ),
        { recipientLabel: bundle.recipientLabel, status: resp.status },
      );
      return {
        channel: "discord",
        bundlePath: null,
        delivered: false,
        error: errorMsg,
      };
    }

    logger.info(
      { recipientLabel: bundle.recipientLabel, artifactHash: bundle.artifactHash.slice(0, 16) },
      "pine-delivery: Discord notification sent",
    );

    return { channel: "discord", bundlePath: null, delivered: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ recipientLabel: bundle.recipientLabel, err }, "pine-delivery: Discord webhook request failed");
    notifyWarning(
      "Pine Bundle Discord Delivery Error",
      appendFamilyGradePostscript(
        `Discord notification for recipient ${bundle.recipientLabel} threw an error: ${errorMsg}. ` +
          `Bundle is available on filesystem — manual delivery required.`,
        "There was an issue delivering a trading script to a family member's account.",
        "No action needed — the bot will retry. Call Tony if trading doesn't start for the family member within an hour.",
      ),
      { recipientLabel: bundle.recipientLabel },
    );
    return { channel: "discord", bundlePath: null, delivered: false, error: errorMsg };
  }
}

// ─── Email Delivery ───────────────────────────────────────────────────────────

async function deliverToEmail(bundle: DeliveryBundle): Promise<DeliveryResult> {
  const smtpHost = process.env.SMTP_HOST;
  const emailTo = process.env.PINE_DELIVERY_EMAIL_TO;

  if (!smtpHost || !emailTo) {
    return {
      channel: "email",
      bundlePath: null,
      delivered: false,
      error: "SMTP_HOST or PINE_DELIVERY_EMAIL_TO not configured",
    };
  }

  // Email delivery stub — requires nodemailer in production.
  // Currently returns unimplemented until SMTP is configured.
  logger.warn(
    { recipientLabel: bundle.recipientLabel, smtpHost, emailTo },
    "pine-delivery: email delivery stub — SMTP not implemented; use filesystem delivery",
  );
  return {
    channel: "email",
    bundlePath: null,
    delivered: false,
    error: "email_delivery_not_implemented — use filesystem or Discord",
  };
}

// ─── Main Delivery Function ───────────────────────────────────────────────────

/**
 * Deliver a per-recipient Pine bundle via the configured channel.
 *
 * Always writes to filesystem first (default, reliable).
 * Additionally fires Discord notification when PINE_DELIVERY_DISCORD_WEBHOOK is set.
 * Email is a stub — not implemented until SMTP_HOST is configured.
 *
 * Returns array of DeliveryResult (one per attempted channel).
 */
export async function deliverPineBundle(bundle: DeliveryBundle): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  // Always deliver to filesystem (default channel — operator hand-delivers)
  results.push(deliverToFilesystem(bundle));

  // Optionally notify via Discord
  if (process.env.PINE_DELIVERY_DISCORD_WEBHOOK) {
    results.push(await deliverToDiscord(bundle));
  }

  // Optionally deliver via email (stub)
  if (process.env.SMTP_HOST && process.env.PINE_DELIVERY_EMAIL_TO) {
    results.push(await deliverToEmail(bundle));
  }

  // ── SSE event — one event covering all attempted channels ───────────────────
  const channelSummary = results.map((r) => ({
    channel: r.channel,
    delivered: r.delivered,
    error: r.error,
  }));
  const anySuccess = results.some((r) => r.delivered);

  broadcastSSE("pine_export:delivered", {
    recipientLabel: bundle.recipientLabel,
    strategyName: bundle.strategyName,
    artifactHash: bundle.artifactHash.slice(0, 16),
    correlationId: bundle.correlationId ?? null,
    channels: channelSummary,
    allDelivered: anySuccess,
    timestamp: new Date().toISOString(),
  });

  // ── Audit log ────────────────────────────────────────────────────────────────
  // Best-effort — delivery result is already surfaced via SSE and pino logs.
  db.insert(auditLog).values({
    action: "pine_export.delivered",
    entityType: "strategy_export",
    entityId: bundle.strategyId ?? null,
    decisionAuthority: "system",
    input: {
      recipientLabel: bundle.recipientLabel,
      artifactHash: bundle.artifactHash.slice(0, 16),
      correlationId: bundle.correlationId ?? null,
    } as Record<string, unknown>,
    result: {
      channels: channelSummary,
      anySuccess,
    } as Record<string, unknown>,
    status: anySuccess ? "success" : "failure",
    correlationId: bundle.correlationId ?? null,
  }).catch((err) => {
    logger.warn({ err, recipientLabel: bundle.recipientLabel }, "pine-delivery: audit log write failed (non-blocking)");
  });

  return results;
}
