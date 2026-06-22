/**
 * live-order.ts — Workstream W1 CORE
 *
 * POST /api/live-order
 *
 * TF Order Gateway: the in-process gate between every Pine alert and live broker
 * order submission. Makes `routeOrder()` a real production caller so that the
 * full gate stack (kill-switch FIRST, pipeline, compliance, firm-cap, correlation
 * guard) governs live money — not just paper simulation.
 *
 * Problem solved:
 *   Previously, live orders fired Pine → TradersPost → broker, bypassing every
 *   in-process gate. routeOrder() existed with full gate logic but had ZERO
 *   production callers. This endpoint closes that gap.
 *
 * Security properties:
 *   - HMAC validated with createHmac + timingSafeEqual (no timing oracle).
 *     Uses LIVE_ORDER_HMAC_SECRET env var. Fail-CLOSED 401 on bad/missing.
 *   - Kill-switch gate is the FIRST gate inside routeOrder() — HALT returns 423.
 *   - Compliance / firm-cap / correlation guard all run inside routeOrder().
 *   - No double-forward: routeOrder() calls submitWebhookOrder() internally for
 *     traderspost broker_type. This route does NOT call submitWebhookOrder().
 *   - Every block writes a live_order.blocked_* audit_log row.
 *
 * HMAC contract:
 *   Pine alert payload must include:
 *     - `live_order_hmac` (string) — HMAC-SHA256 over the canonical message:
 *       `${account_id}|${ticker}|${action}|${timestamp_ms}`
 *       signed with LIVE_ORDER_HMAC_SECRET (operator-set, ≥32 chars).
 *     - `timestamp_ms` (number) — Unix millis at alert fire time (replay guard).
 *
 * Payload shape (TradingView Pine alert JSON):
 * {
 *   "account_id":     "<broker_accounts.account_id UUID>",
 *   "ticker":         "MES1!",
 *   "action":         "enter_long" | "enter_short" | "exit_long" | "exit_short",
 *   "order_type":     "market" | "limit" | "stop" (optional, default market),
 *   "quantity":       6,                (optional — routeOrder clamps to firm cap)
 *   "strategy_id":    "<UUID>",         (optional — for idempotency key)
 *   "bar_timestamp":  "2026-06-22T...", (optional — for idempotency key)
 *   "timestamp_ms":   1750000000000,   (REQUIRED — replay guard)
 *   "live_order_hmac":"<hex>",          (REQUIRED — auth)
 *   "correlation_id": "<UUID>"          (optional — propagate existing trace)
 * }
 */

import { Router, type Request, type Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { routeOrder } from "../services/broker-router.js";
import type { WebhookSignal } from "../integrations/traderspost/webhook-builder.js";

export const liveOrderRoutes = Router();

// ─── Replay guard window ──────────────────────────────────────────────────────
// 2-minute window: tight enough to block replayed Pine alerts,
// generous enough to tolerate TradingView → network → server latency.
const REPLAY_WINDOW_MS = 2 * 60 * 1000;

// ─── HMAC secret resolution ───────────────────────────────────────────────────
// Operator MUST set LIVE_ORDER_HMAC_SECRET (≥32 chars) in production .env.
// Missing secret → every request is rejected 503 (fail-CLOSED, not 401, so Pine
// retries back off instead of burning through the alert quota with auth loops).
function getLiveOrderSecret(): string | null {
  const secret = process.env.LIVE_ORDER_HMAC_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

// ─── HMAC verification ────────────────────────────────────────────────────────
// Canonical message: `{account_id}|{ticker}|{action}|{timestamp_ms}`
// Same as what Pine would compute at alert fire time.

function verifyLiveOrderHmac(
  accountId: string,
  ticker: string,
  action: string,
  timestampMs: number,
  providedHmac: string,
  secret: string,
): boolean {
  try {
    const message = `${accountId}|${ticker}|${action}|${timestampMs}`;
    const expected = createHmac("sha256", secret)
      .update(message, "utf8")
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(providedHmac, "utf8");

    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Request schema ───────────────────────────────────────────────────────────

const liveOrderPayloadSchema = z.object({
  account_id:      z.string().uuid("account_id must be a UUID"),
  ticker:          z.string().min(1, "ticker is required"),
  action:          z.enum(["enter_long", "enter_short", "exit_long", "exit_short", "exit"]),
  order_type:      z.enum(["market", "limit", "stop", "stop_limit"]).optional(),
  quantity:        z.number().int().positive().optional(),
  price:           z.number().optional(),
  stop_price:      z.number().optional(),
  strategy_id:     z.string().uuid().optional().nullable(),
  bar_timestamp:   z.string().optional().nullable(),
  timestamp_ms:    z.number().int().positive("timestamp_ms must be a positive integer (Unix millis)"),
  live_order_hmac: z.string().min(1, "live_order_hmac is required"),
  correlation_id:  z.string().uuid().optional().nullable(),
});

// ─── Audit helper ─────────────────────────────────────────────────────────────

async function writeBlockedAuditRow(params: {
  action: string;
  accountId: string;
  ticker: string;
  correlationId: string | null;
  reason: string;
  detail?: Record<string, unknown>;
  durationMs: number;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: params.action,
      entityType: "live_order",
      entityId: null,
      decisionAuthority: "system",
      input: {
        accountId: params.accountId,
        ticker: params.ticker,
      } as Record<string, unknown>,
      result: {
        reason: params.reason,
        blocked: true,
        ...params.detail,
      } as Record<string, unknown>,
      status: "blocked",
      durationMs: params.durationMs,
      correlationId: params.correlationId,
    });
  } catch (err) {
    logger.error({ err }, "live-order: audit_log write failed (non-blocking)");
  }
}

// ─── POST /api/live-order ─────────────────────────────────────────────────────

liveOrderRoutes.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();

    // 1. Resolve HMAC secret — fail-CLOSED on missing/short secret.
    //    503 (not 401) so the caller knows the server is misconfigured, not auth-rejected.
    const secret = getLiveOrderSecret();
    if (!secret) {
      logger.error(
        {},
        "live-order: LIVE_ORDER_HMAC_SECRET missing or too short — rejecting all requests until configured",
      );
      res.status(503).json({
        error: "gateway_not_configured",
        detail: "LIVE_ORDER_HMAC_SECRET is not set or < 32 chars; operator must configure before live orders are accepted",
      });
      return;
    }

    // 2. Parse payload.
    const parsed = liveOrderPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_payload", details: parsed.error.issues });
      return;
    }

    const {
      account_id,
      ticker,
      action,
      order_type,
      quantity,
      price,
      stop_price,
      strategy_id,
      bar_timestamp,
      timestamp_ms,
      live_order_hmac,
      correlation_id,
    } = parsed.data;

    const correlationId: string = correlation_id ?? randomUUID();

    // 3. Verify HMAC — fail-CLOSED 401 on mismatch.
    const hmacValid = verifyLiveOrderHmac(
      account_id,
      ticker,
      action,
      timestamp_ms,
      live_order_hmac,
      secret,
    );
    if (!hmacValid) {
      logger.warn(
        { accountId: account_id, ticker, correlationId },
        "live-order: HMAC verification failed — 401",
      );
      await writeBlockedAuditRow({
        action: "live_order.blocked_hmac_invalid",
        accountId: account_id,
        ticker,
        correlationId,
        reason: "hmac_invalid",
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "hmac_invalid" });
      return;
    }

    // 4. Replay guard — reject timestamps outside the 2-minute window.
    //    Checked AFTER HMAC so we don't leak timing info about secret validity.
    const nowMs = Date.now();
    if (Math.abs(nowMs - timestamp_ms) > REPLAY_WINDOW_MS) {
      logger.warn(
        { accountId: account_id, ticker, correlationId, timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms },
        "live-order: stale payload rejected — timestamp_ms outside 2-minute window",
      );
      await writeBlockedAuditRow({
        action: "live_order.blocked_stale_payload",
        accountId: account_id,
        ticker,
        correlationId,
        reason: "stale_payload",
        detail: { timestamp_ms, nowMs, deltaMs: nowMs - timestamp_ms, windowMs: REPLAY_WINDOW_MS },
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "stale_payload" });
      return;
    }

    // 5. Build WebhookSignal and call routeOrder().
    //    routeOrder() is the SINGLE SOURCE OF TRUTH per CLAUDE.md §7.
    //    It runs: kill-switch FIRST → pipeline → enabled_firms → compliance → broker dispatch.
    //    For traderspost broker_type it calls submitWebhookOrder() internally.
    //    This route does NOT call submitWebhookOrder() — no double-forward.
    const signal: WebhookSignal = {
      action,
      ticker,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(stop_price !== undefined ? { stopPrice: stop_price } : {}),
      ...(order_type !== undefined ? { orderType: order_type } : {}),
      ...(strategy_id ? { strategyId: strategy_id } : {}),
      ...(bar_timestamp ? { barTimestamp: bar_timestamp } : {}),
    };

    // Pass the timestamp_ms as webhookFiredAt so routeOrder() can compute
    // fire_to_ack_ms for the webhook.broker_ack audit row.
    const result = await routeOrder(account_id, signal, correlationId, timestamp_ms);

    const durationMs = Date.now() - startedAt;

    // 6. Gate blocked — write audit row and return 4xx.
    if (!result.success) {
      const isHalt = result.reason === "production_halt";
      const isFirmOrCompliance =
        result.reason === "compliance_violation" ||
        result.reason === "account_not_found";

      const auditAction = isHalt
        ? "live_order.blocked_production_halt"
        : `live_order.blocked_${result.reason}`;

      await writeBlockedAuditRow({
        action: auditAction,
        accountId: account_id,
        ticker,
        correlationId,
        reason: result.reason,
        detail: {
          brokerType: result.brokerType,
          firmId: result.firmId,
          error: result.error,
          statusCode: result.statusCode,
        },
        durationMs,
      });

      logger.warn(
        { accountId: account_id, ticker, correlationId, reason: result.reason, durationMs },
        "live-order: order blocked by gate",
      );

      // HALT = 423 (unavailable due to policy — retry later when halt lifts)
      // compliance / firm = 403 (forbidden)
      // other failures = 503
      const statusCode = isHalt ? 423 : isFirmOrCompliance ? 403 : 503;

      res.status(statusCode).json({
        blocked: true,
        reason: result.reason,
        correlationId,
        error: result.error,
      });
      return;
    }

    // 7. Success — routeOrder forwarded to TradersPost (or stub for TopstepX).
    logger.info(
      {
        accountId: account_id,
        ticker,
        correlationId,
        brokerType: result.brokerType,
        firmId: result.firmId,
        statusCode: result.statusCode,
        durationMs,
      },
      "live-order: order forwarded via routeOrder()",
    );

    res.status(200).json({
      forwarded: true,
      reason: result.reason,
      correlationId,
      brokerType: result.brokerType,
      firmId: result.firmId,
      statusCode: result.statusCode,
    });
  },
);
