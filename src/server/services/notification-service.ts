/**
 * Notification Service — Discord webhook integration for Trading Forge.
 *
 * Delivers critical system events to a Discord channel via webhook so
 * the operator does not have to watch the dashboard to catch failures.
 *
 * Design constraints:
 *   - Zero new dependencies — uses native fetch (Node 18+)
 *   - Fire-and-forget — callers are never blocked
 *   - Silent no-op when DISCORD_WEBHOOK_URL is not set
 *   - Rate-limited: max 5 webhook calls per 60-second window (Discord allows
 *     30/min per webhook, but we stay conservative to avoid bursts)
 *   - WARNING messages are batched and flushed every 15 minutes
 *   - If Discord is unreachable, failure is logged and dropped — never rethrown
 *
 * Severity routing:
 *   CRITICAL  → immediate webhook send (0xFF0000 red)
 *   WARNING   → queued, flushed in batches every 15 min (0xFFA500 amber)
 *   INFO      → immediate send (0x0099FF blue)
 */

import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface NotifyOptions {
  severity: NotificationSeverity;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp: string;
  footer: { text: string };
  fields?: Array<{ name: string; value: string; inline: boolean }>;
}

interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_MAP: Record<NotificationSeverity, number> = {
  CRITICAL: 0xff0000, // Red
  WARNING: 0xffa500, // Amber
  INFO: 0x0099ff,    // Blue
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const WARNING_BATCH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const METADATA_FIELD_LIMIT = 10;
const FIELD_VALUE_MAX_LENGTH = 1024;
const DESCRIPTION_MAX_LENGTH = 4000;

// ─── Internal state ───────────────────────────────────────────────────────────

/** Timestamps of recent webhook calls within the current rate-limit window. */
const recentCallTimestamps: number[] = [];

/** Accumulated WARNING-severity messages awaiting the next batch flush. */
const warningQueue: NotifyOptions[] = [];

let warningFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** Title-based dedup — suppress identical titles within a cooldown window. */
const DEDUP_COOLDOWN_MS = 10 * 60_000; // 10 minutes
const recentTitles: Map<string, number> = new Map(); // title → timestamp

function isDuplicateTitle(title: string): boolean {
  const now = Date.now();
  // Prune expired entries
  for (const [key, ts] of recentTitles) {
    if (ts < now - DEDUP_COOLDOWN_MS) recentTitles.delete(key);
  }
  if (recentTitles.has(title)) {
    logger.debug({ title }, "NotificationService: duplicate title suppressed");
    return true;
  }
  recentTitles.set(title, now);
  return false;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

/**
 * Returns true if we have budget for another webhook call this window.
 * Prunes expired timestamps as a side effect.
 */
function checkRateLimit(): boolean {
  const now = Date.now();
  // Evict timestamps older than the window
  while (recentCallTimestamps.length > 0 && recentCallTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    recentCallTimestamps.shift();
  }
  return recentCallTimestamps.length < RATE_LIMIT_MAX;
}

function recordCall(): void {
  recentCallTimestamps.push(Date.now());
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildEmbed(opts: NotifyOptions): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `[${opts.severity}] ${opts.title}`.slice(0, 256),
    description: opts.body.slice(0, DESCRIPTION_MAX_LENGTH),
    color: COLOR_MAP[opts.severity],
    timestamp: new Date().toISOString(),
    footer: { text: "Trading Forge" },
  };

  if (opts.metadata && Object.keys(opts.metadata).length > 0) {
    const entries = Object.entries(opts.metadata).slice(0, METADATA_FIELD_LIMIT);
    embed.fields = entries.map(([key, value]) => ({
      name: key,
      value: String(typeof value === "object" ? JSON.stringify(value) : value).slice(0, FIELD_VALUE_MAX_LENGTH),
      inline: true,
    }));
  }

  return embed;
}

function buildBatchEmbed(items: NotifyOptions[]): DiscordEmbed {
  const lines = items.map((item) => `**${item.title}**\n${item.body}`);
  const description = lines.join("\n\n").slice(0, DESCRIPTION_MAX_LENGTH);
  return {
    title: `[WARNING BATCH] ${items.length} warnings accumulated`,
    description,
    color: COLOR_MAP.WARNING,
    timestamp: new Date().toISOString(),
    footer: { text: `Trading Forge | ${items.length} warnings` },
  };
}

// ─── Webhook call ─────────────────────────────────────────────────────────────

async function sendWebhook(webhookUrl: string, payload: DiscordWebhookPayload): Promise<void> {
  if (!checkRateLimit()) {
    logger.warn(
      { rateLimit: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS },
      "NotificationService: rate limit reached — webhook call dropped",
    );
    return;
  }

  recordCall();

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`Discord webhook HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
}

// ─── Warning batch flush ──────────────────────────────────────────────────────

function scheduleWarningFlush(): void {
  if (warningFlushTimer !== null) return; // already scheduled

  warningFlushTimer = setTimeout(() => {
    warningFlushTimer = null;
    flushWarningQueue().catch((err) => {
      logger.warn({ err }, "NotificationService: warning flush failed");
    });
  }, WARNING_BATCH_INTERVAL_MS);

  // Allow process to exit without waiting for this timer
  if (warningFlushTimer.unref) {
    warningFlushTimer.unref();
  }
}

async function flushWarningQueue(): Promise<void> {
  if (warningQueue.length === 0) return;

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const batch = warningQueue.splice(0, warningQueue.length);

  logger.info({ count: batch.length }, "NotificationService: flushing warning batch");

  const embed = buildBatchEmbed(batch);
  try {
    await sendWebhook(webhookUrl, { embeds: [embed] });
    logger.info({ count: batch.length }, "NotificationService: warning batch sent");
  } catch (err) {
    logger.warn(
      { err, count: batch.length },
      "NotificationService: failed to send warning batch — dropped",
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a notification to the configured Discord webhook.
 *
 * Returns immediately — all work is fire-and-forget.
 * Safe to call even when DISCORD_WEBHOOK_URL is not set.
 */
export function notify(opts: NotifyOptions): void {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    // Feature not configured — silent no-op (not an error)
    return;
  }

  // Dedup — suppress identical titles within 10-minute window
  if (opts.severity !== "CRITICAL" && isDuplicateTitle(opts.title)) {
    return;
  }

  if (opts.severity === "WARNING") {
    // Queue for batch delivery
    warningQueue.push(opts);
    scheduleWarningFlush();
    logger.debug({ title: opts.title }, "NotificationService: WARNING queued for batch");
    return;
  }

  // CRITICAL and INFO are sent immediately, fire-and-forget
  const embed = buildEmbed(opts);
  sendWebhook(webhookUrl, { embeds: [embed] }).then(() => {
    logger.debug(
      { severity: opts.severity, title: opts.title },
      "NotificationService: notification sent",
    );
  }).catch((err) => {
    logger.warn(
      { err, severity: opts.severity, title: opts.title },
      "NotificationService: failed to send notification — dropped",
    );
  });
}

/**
 * Convenience wrapper for CRITICAL severity.
 */
export function notifyCritical(title: string, body: string, metadata?: Record<string, unknown>): void {
  notify({ severity: "CRITICAL", title, body, metadata });
}

/**
 * Convenience wrapper for WARNING severity (batched).
 */
export function notifyWarning(title: string, body: string, metadata?: Record<string, unknown>): void {
  notify({ severity: "WARNING", title, body, metadata });
}

/**
 * Convenience wrapper for INFO severity.
 */
export function notifyInfo(title: string, body: string, metadata?: Record<string, unknown>): void {
  notify({ severity: "INFO", title, body, metadata });
}

/**
 * Force-flush the warning queue immediately.
 * Use during graceful shutdown to drain buffered warnings.
 */
export async function flushNotifications(): Promise<void> {
  if (warningFlushTimer !== null) {
    clearTimeout(warningFlushTimer);
    warningFlushTimer = null;
  }
  await flushWarningQueue();
}

/**
 * Returns diagnostic state — useful for tests and health checks.
 * Does NOT expose the webhook URL.
 */
export function getNotificationServiceStatus(): {
  configured: boolean;
  warningQueueDepth: number;
  recentCallCount: number;
  rateLimitBudgetRemaining: number;
} {
  const now = Date.now();
  const recent = recentCallTimestamps.filter((t) => t >= now - RATE_LIMIT_WINDOW_MS).length;
  return {
    configured: !!process.env.DISCORD_WEBHOOK_URL,
    warningQueueDepth: warningQueue.length,
    recentCallCount: recent,
    rateLimitBudgetRemaining: Math.max(0, RATE_LIMIT_MAX - recent),
  };
}

/**
 * Reset all internal state — intended for tests only.
 * Clears rate-limit timestamps, warning queue, and any pending flush timer.
 */
export function _resetForTests(): void {
  recentCallTimestamps.length = 0;
  warningQueue.length = 0;
  recentTitles.clear();
  if (warningFlushTimer !== null) {
    clearTimeout(warningFlushTimer);
    warningFlushTimer = null;
  }
}
