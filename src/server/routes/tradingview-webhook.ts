/**
 * tradingview-webhook.ts — Track 8 / Pass 3
 *
 * POST /api/tradingview/marker
 *
 * Receives Pine alert webhooks from TradingView. Validates HMAC signature
 * using per-(account_id, strategy_id) secret from account_strategy_assignments.
 * Inserts a row into tradingview_markers, broadcasts SSE, writes audit_log.
 *
 * Security properties:
 *   - HMAC validated with crypto.timingSafeEqual (no timing oracle)
 *   - Fail-CLOSED: invalid HMAC → 401 + audit_log + structured WARN log
 *   - Rate-limited per account_id (10 req / 60s via accountRateLimit)
 *   - 2-firm constraint: only MFFU + Topstep accounts accepted
 *   - Pipeline pause guard: 423 when pipeline paused
 *   - Correlation ID: propagated from payload or generated fresh
 *
 * Idempotency (bonus):
 *   Same (account_id, strategy_id, bar_timestamp, signal) within 5 s is
 *   de-duplicated at the DB level via a unique index on those four columns
 *   (added in migration 0102). Duplicate inserts are silently swallowed —
 *   the first write wins. The response is still 200 (not 409) to satisfy
 *   TradingView's retry logic.
 *
 * NOTE: the idempotency de-dup is implemented via DO NOTHING on conflict,
 * which requires an additional unique index. The bonus test covers this path.
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { sql as drizzleSql } from "drizzle-orm";
import { tradingviewMarkers, auditLog } from "../db/schema.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { strictRateLimit } from "../middleware/rate-limit.js";
import {
  validateHmac,
  lookupHmacSecret,
} from "../services/tradingview-marker-service.js";
import { broadcastSSE } from "./sse.js";
import { logger } from "../index.js";

export const tradingViewWebhookRoutes = Router();

// ─── Allowed firms ────────────────────────────────────────────────────────────
// Only MFFU + Topstep accounts accepted per Pass 1 Track 2 cleanup.

const ALLOWED_FIRM_IDS = new Set(["mffu", "topstep"]);

// ─── Per-account rate limiter ─────────────────────────────────────────────────
// TradingView can fire rapidly on volatile bars. Limit per account_id to
// prevent webhook spam DoS, independent of IP (account_id is the meaningful key).

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const accountBuckets = new Map<string, RateLimitBucket>();

// 10 requests per 60 seconds per account_id
const ACCOUNT_RATE_LIMIT = 10;
const ACCOUNT_RATE_WINDOW_MS = 60_000;

function checkAccountRateLimit(accountId: string): boolean {
  const now = Date.now();
  const bucket = accountBuckets.get(accountId);

  if (!bucket || now > bucket.resetAt) {
    accountBuckets.set(accountId, { count: 1, resetAt: now + ACCOUNT_RATE_WINDOW_MS });
    return true; // allow
  }

  bucket.count++;
  return bucket.count <= ACCOUNT_RATE_LIMIT;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of accountBuckets) {
    if (now > bucket.resetAt) accountBuckets.delete(key);
  }
}, 300_000);

// ─── Request schema ───────────────────────────────────────────────────────────

const markerPayloadSchema = z.object({
  strategy_id:    z.string().uuid("strategy_id must be a UUID"),
  account_id:     z.string().uuid("account_id must be a UUID"),
  bar_timestamp:  z.string().datetime({ message: "bar_timestamp must be ISO 8601" }),
  signal:         z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  hmac:           z.string().min(1, "hmac is required"),
  correlation_id: z.string().uuid().optional().nullable(),
}).passthrough(); // allow extra fields to be stored in pine_alert_payload

// ─── Broker account lookup ────────────────────────────────────────────────────

async function lookupBrokerFirm(accountId: string): Promise<string | null> {
  try {
    const rows = await db.execute(
      drizzleSql`SELECT firm_id
                   FROM broker_accounts
                  WHERE account_id = ${accountId}::uuid
                    AND enabled = true
                  LIMIT 1`
    );
    const row = (rows as unknown as { rows: Array<{ firm_id: string }> }).rows?.[0];
    return row?.firm_id ?? null;
  } catch (err) {
    logger.warn({ accountId, err }, "tradingview-webhook: broker_accounts lookup failed");
    return null;
  }
}

// ─── Audit log helper ─────────────────────────────────────────────────────────

async function writeAuditRow(params: {
  action: string;
  strategyId: string;
  accountId: string;
  correlationId: string | null;
  status: "success" | "failure" | "warning";
  result: Record<string, unknown>;
  durationMs: number;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: params.action,
      entityType: "tradingview_marker",
      entityId: null,
      decisionAuthority: "system",
      input: {
        strategyId: params.strategyId,
        accountId: params.accountId,
      } as Record<string, unknown>,
      result: params.result as Record<string, unknown>,
      status: params.status,
      durationMs: params.durationMs,
      correlationId: params.correlationId,
    });
  } catch (err) {
    logger.error({ err }, "tradingview-webhook: audit_log write failed (non-blocking)");
  }
}

// ─── POST /api/tradingview/marker ─────────────────────────────────────────────

tradingViewWebhookRoutes.post(
  "/marker",
  strictRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();

    // 1. Pipeline pause guard
    if (!(await isPipelineActive())) {
      res.status(423).json({ error: "pipeline_paused" });
      return;
    }

    // 2. Parse body
    const parsed = markerPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.issues });
      return;
    }

    const {
      strategy_id,
      account_id,
      bar_timestamp,
      signal,
      hmac,
      correlation_id,
      ...extraFields
    } = parsed.data;

    // Resolve or generate correlation ID
    const correlationId: string = correlation_id ?? randomUUID();

    // 3. Per-account rate limit
    if (!checkAccountRateLimit(account_id)) {
      logger.warn(
        { accountId: account_id, correlationId },
        "tradingview-webhook: rate limit exceeded for account"
      );
      res.status(429).json({ error: "rate_limit_exceeded", retryAfterSec: 60 });
      return;
    }

    // 4. 2-firm guard — only MFFU + Topstep
    const firmId = await lookupBrokerFirm(account_id);
    if (!firmId || !ALLOWED_FIRM_IDS.has(firmId)) {
      logger.warn(
        { accountId: account_id, firmId, correlationId },
        "tradingview-webhook: account firm not in allowed set (MFFU/Topstep only)"
      );
      await writeAuditRow({
        action: "tradingview_marker.rejected_firm",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: { reason: "firm_not_allowed", firmId },
        durationMs: Date.now() - startedAt,
      });
      res.status(403).json({ error: "firm_not_allowed", allowed: ["mffu", "topstep"] });
      return;
    }

    // 5. Look up HMAC secret
    const secret = await lookupHmacSecret(account_id, strategy_id);
    if (!secret) {
      logger.warn(
        { accountId: account_id, strategyId: strategy_id, correlationId },
        "tradingview-webhook: no HMAC secret found — assignment may be missing"
      );
      await writeAuditRow({
        action: "tradingview_marker.hmac_secret_missing",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: { reason: "hmac_secret_missing" },
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "hmac_secret_not_found" });
      return;
    }

    // 6. Validate HMAC (constant-time)
    const isValid = validateHmac(req.body as Record<string, unknown>, hmac, secret);
    if (!isValid) {
      logger.warn(
        { accountId: account_id, strategyId: strategy_id, correlationId },
        "tradingview-webhook: HMAC validation failed"
      );
      await writeAuditRow({
        action: "tradingview_marker.hmac_invalid",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: { reason: "hmac_mismatch" },
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "hmac_invalid" });
      return;
    }

    // 7. Insert marker row (hmac_validated=true)
    // Build the full payload object to store (includes extra fields)
    const pineAlertPayload = {
      strategy_id,
      account_id,
      bar_timestamp,
      signal,
      ...extraFields,
    } as Record<string, unknown>;

    let markerId: number | null = null;
    try {
      // Use raw SQL for DO NOTHING idempotency on (account_id, strategy_id, bar_timestamp, signal)
      // Drizzle insert returns the row; on conflict we still return success to TradingView.
      const barTs = new Date(bar_timestamp).toISOString();
      const payloadJson = JSON.stringify(pineAlertPayload);
      const result = await db.execute(
        drizzleSql`INSERT INTO tradingview_markers
                     (strategy_id, account_id, bar_timestamp, signal, pine_alert_payload, hmac_validated, correlation_id)
                   VALUES (
                     ${strategy_id}::uuid,
                     ${account_id}::uuid,
                     ${barTs}::timestamptz,
                     ${signal}::smallint,
                     ${payloadJson}::jsonb,
                     true,
                     ${correlationId}::uuid
                   )
                   ON CONFLICT DO NOTHING
                   RETURNING id`
      );
      const rows = (result as unknown as { rows: Array<{ id: number }> }).rows;
      markerId = rows?.[0]?.id ?? null;
    } catch (err) {
      logger.error(
        { err, accountId: account_id, strategyId: strategy_id, correlationId },
        "tradingview-webhook: marker DB insert failed"
      );
      await writeAuditRow({
        action: "tradingview_marker.insert_failed",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: { reason: "db_insert_failed", error: err instanceof Error ? err.message : String(err) },
        durationMs: Date.now() - startedAt,
      });
      res.status(500).json({ error: "marker_persist_failed" });
      return;
    }

    const durationMs = Date.now() - startedAt;

    // 8. Audit log row (non-blocking)
    await writeAuditRow({
      action: "tradingview_marker.received",
      strategyId: strategy_id,
      accountId: account_id,
      correlationId,
      status: "success",
      result: {
        markerId,
        barTimestamp: bar_timestamp,
        signal,
        firmId,
        hmacValidated: true,
        idempotent: markerId === null, // null = duplicate — row already existed
      },
      durationMs,
    });

    // 9. SSE broadcast
    broadcastSSE("tradingview:marker-received", {
      markerId,
      strategyId: strategy_id,
      accountId: account_id,
      barTimestamp: bar_timestamp,
      signal,
      firmId,
      correlationId,
      receivedAt: new Date().toISOString(),
    });

    logger.info(
      {
        markerId,
        strategyId: strategy_id,
        accountId: account_id,
        barTimestamp: bar_timestamp,
        signal,
        correlationId,
        durationMs,
        idempotent: markerId === null,
      },
      "tradingview-webhook: marker received and stored"
    );

    res.status(200).json({
      ok: true,
      markerId,
      correlationId,
      idempotent: markerId === null,
    });
  }
);
