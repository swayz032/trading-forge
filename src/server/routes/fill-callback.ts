/**
 * fill-callback.ts — Phase 1 Fill Reconciliation Ingest Endpoint
 *
 * POST /api/broker/fill-callback
 *
 * Receives normalized broker fill events (from TradersPost status webhooks or
 * any BrokerFillSource) and feeds them into fill-reconciliation-service.ts.
 *
 * FLAG-GATED: SERVER_MEDIATED_EXECUTION_ENABLED=true (DEFAULT OFF).
 * When the flag is OFF, every request returns 200 with outcome: "flag_disabled"
 * (not 503/404 — the caller should not retry).
 *
 * ─── Authentication ──────────────────────────────────────────────────────────
 * HMAC-SHA256 over canonical message:
 *   `${broker_source}|${timestamp_ms}|${broker_fill_id ?? ""}|${symbol}`
 * Signed with BROKER_FILL_HMAC_SECRET env var (≥32 chars).
 *
 * Replay guard: 60-second timestamp_ms drift window.
 * All HMAC comparisons use crypto.timingSafeEqual (no timing oracle).
 *
 * Missing/invalid HMAC → 401. No secret configured → 503.
 *
 * ─── Broker source routing ────────────────────────────────────────────────────
 * The `broker_source` field ("traderspost" | "topstepx") selects the
 * BrokerFillSource implementation. The raw payload is passed to
 * normalizeFillEvent() for broker-specific field mapping. When no source
 * matches, the payload is passed directly as a pre-normalized FillEvent.
 *
 * ─── Idempotency ─────────────────────────────────────────────────────────────
 * Re-posting the same broker_fill_id is a no-op (duplicate_skipped).
 * No state changes occur on duplicate ingestion. Callers should treat
 * duplicate_skipped as success.
 *
 * ─── Reconcile-clear admin endpoint ─────────────────────────────────────────
 * POST /api/broker/fill-callback/reconcile-clear
 *
 * Admin action: clear all needs_reconcile orders for an account after manual
 * verification. Same BROKER_FILL_HMAC_SECRET authentication.
 * Body: { account_id, rationale (≥50 chars), timestamp_ms, hmac }
 *
 * ─── Audit actions ───────────────────────────────────────────────────────────
 * All fill ingestion audit is written by fill-reconciliation-service.ts.
 * This route writes:
 *   fill_callback.auth_failure         — HMAC / secret failure
 *   fill_callback.flag_disabled        — flag=off 200 no-op
 *   fill_callback.reconcile_clear      — admin clear action
 */

import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
  ingestFillEvent,
  clearAccountReconcileBlock,
  FILL_SOURCES,
  isServerMediatedExecutionEnabled,
  type FillEvent,
} from "../services/fill-reconciliation-service.js";

export const fillCallbackRoutes = Router();

// ─── Replay guard window ──────────────────────────────────────────────────────
// 60 seconds: tight enough to block replays; generous for webhook delivery latency
const REPLAY_WINDOW_MS = 60 * 1000;

// ─── HMAC secret ─────────────────────────────────────────────────────────────

function getFillHmacSecret(): string | null {
  const secret = process.env.BROKER_FILL_HMAC_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

// ─── HMAC verification ────────────────────────────────────────────────────────
// Canonical message: `${broker_source}|${timestamp_ms}|${broker_fill_id ?? ""}|${symbol}`

function verifyFillCallbackHmac(params: {
  brokerSource: string;
  timestampMs: number;
  brokerFillId: string;
  symbol: string;
  providedHmac: string;
  secret: string;
}): boolean {
  try {
    const { brokerSource, timestampMs, brokerFillId, symbol, providedHmac, secret } = params;
    const message = `${brokerSource}|${timestampMs}|${brokerFillId}|${symbol}`;
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

// ─── Audit write ─────────────────────────────────────────────────────────────

async function writeAudit(
  action: string,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  status: string,
  correlationId?: string | null,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      entityType: "fill_callback",
      entityId: null,
      decisionAuthority: "system",
      input,
      result,
      status,
      correlationId: correlationId ?? null,
    });
  } catch (err) {
    logger.error({ err, action }, "fill-callback: audit write failed (non-blocking)");
  }
}

// ─── Fill ingestion schema ────────────────────────────────────────────────────

const FillCallbackBodySchema = z.object({
  /** Which broker integration sent this fill (selects BrokerFillSource) */
  broker_source: z.enum(["traderspost", "topstepx"]).optional().default("traderspost"),

  /** Broker-side order reference (primary match key) */
  broker_order_ref: z.string().optional().nullable(),

  /** Bar-scoped idempotency key (secondary match key) */
  idempotency_key: z.string().optional().nullable(),

  /** Futures symbol */
  symbol: z.string().min(1),

  /** Number of contracts filled in this event */
  filled_qty: z.number().int().min(0),

  /** Average fill price for this event */
  filled_avg_price: z.number(),

  /** Broker-reported fill status */
  status: z.enum(["filled", "partially_filled", "rejected", "cancelled"]),

  /** Unique fill ID from the broker — used for deduplication */
  broker_fill_id: z.string().optional().nullable(),

  /** Timestamp in milliseconds (Unix epoch) — used for replay guard */
  timestamp_ms: z.number(),

  /** HMAC-SHA256 signature */
  hmac: z.string(),

  /** Optional correlation ID for traceability */
  correlation_id: z.string().optional().nullable(),
});

// ─── POST /api/broker/fill-callback ──────────────────────────────────────────

fillCallbackRoutes.post("/", async (req: Request, res: Response) => {
  const correlationId = (req as Request & { id?: string }).id ?? randomUUID();

  // ── Secret check ────────────────────────────────────────────────────────
  const secret = getFillHmacSecret();
  if (!secret) {
    logger.error("fill-callback: BROKER_FILL_HMAC_SECRET not configured — rejecting 503");
    await writeAudit(
      "fill_callback.auth_failure",
      { reason: "secret_not_configured" },
      { status: 503 },
      "failure",
      correlationId,
    );
    return res.status(503).json({ error: "Fill callback endpoint not configured" });
  }

  // ── Schema validation ────────────────────────────────────────────────────
  const parseResult = FillCallbackBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    await writeAudit(
      "fill_callback.auth_failure",
      { reason: "invalid_schema", errors: parseResult.error.issues },
      { status: 400 },
      "failure",
      correlationId,
    );
    return res.status(400).json({ error: "Invalid request body", details: parseResult.error.issues });
  }

  const body = parseResult.data;

  // ── Replay guard ─────────────────────────────────────────────────────────
  const now = Date.now();
  const drift = Math.abs(now - body.timestamp_ms);
  if (drift > REPLAY_WINDOW_MS) {
    logger.warn(
      { drift, timestamp_ms: body.timestamp_ms, window: REPLAY_WINDOW_MS },
      "fill-callback: timestamp outside replay window — 401",
    );
    await writeAudit(
      "fill_callback.auth_failure",
      { reason: "timestamp_outside_window", drift, timestamp_ms: body.timestamp_ms },
      { status: 401 },
      "failure",
      correlationId,
    );
    return res.status(401).json({ error: "Request timestamp outside acceptable window" });
  }

  // ── HMAC verification ────────────────────────────────────────────────────
  const hmacValid = verifyFillCallbackHmac({
    brokerSource: body.broker_source,
    timestampMs: body.timestamp_ms,
    brokerFillId: body.broker_fill_id ?? "",
    symbol: body.symbol,
    providedHmac: body.hmac,
    secret,
  });

  if (!hmacValid) {
    logger.warn(
      { broker_source: body.broker_source, symbol: body.symbol },
      "fill-callback: HMAC verification failed — 401",
    );
    await writeAudit(
      "fill_callback.auth_failure",
      { reason: "invalid_hmac", broker_source: body.broker_source, symbol: body.symbol },
      { status: 401 },
      "failure",
      correlationId,
    );
    return res.status(401).json({ error: "Authentication failed" });
  }

  // ── Flag gate ────────────────────────────────────────────────────────────
  if (!isServerMediatedExecutionEnabled()) {
    await writeAudit(
      "fill_callback.flag_disabled",
      { broker_source: body.broker_source, symbol: body.symbol },
      { outcome: "flag_disabled" },
      "skipped",
      correlationId,
    );
    return res.status(200).json({ outcome: "flag_disabled" });
  }

  // ── Normalize fill event via BrokerFillSource ────────────────────────────
  let fillEvent: FillEvent;
  const fillSource = FILL_SOURCES[body.broker_source];

  if (fillSource) {
    // Pass the raw body; normalizeFillEvent may remap broker-specific fields
    const normalized = fillSource.normalizeFillEvent(body);
    if (!normalized) {
      // Source-specific normalization rejected the payload (e.g. non-fill status)
      return res.status(200).json({ outcome: "ignored_non_fill_status" });
    }
    fillEvent = {
      ...normalized,
      // Caller-provided fields always take precedence over broker field names
      broker_order_ref: body.broker_order_ref ?? normalized.broker_order_ref,
      idempotency_key: body.idempotency_key ?? normalized.idempotency_key,
      symbol: body.symbol,
      filled_qty: body.filled_qty,
      filled_avg_price: body.filled_avg_price,
      status: body.status,
      broker_fill_id: body.broker_fill_id ?? normalized.broker_fill_id,
      correlation_id: body.correlation_id ?? normalized.correlation_id,
    };
  } else {
    // Unknown source — treat body as pre-normalized FillEvent
    fillEvent = {
      broker_order_ref: body.broker_order_ref,
      idempotency_key: body.idempotency_key,
      symbol: body.symbol,
      filled_qty: body.filled_qty,
      filled_avg_price: body.filled_avg_price,
      status: body.status,
      broker_fill_id: body.broker_fill_id,
      source: "unknown",
      correlation_id: body.correlation_id,
    };
  }

  // ── Ingest fill ──────────────────────────────────────────────────────────
  const result = await ingestFillEvent(fillEvent, correlationId);

  logger.info({ result, correlationId }, "fill-callback: fill ingestion complete");

  return res.status(200).json({ outcome: result.outcome, correlationId, ...result });
});

// ─── POST /api/broker/fill-callback/reconcile-clear ──────────────────────────

const ReconcileClearBodySchema = z.object({
  account_id: z.string().uuid(),
  /** Operator rationale for clearing needs_reconcile — must be meaningful */
  rationale: z.string().min(50, "rationale must be at least 50 characters"),
  timestamp_ms: z.number(),
  hmac: z.string(),
  correlation_id: z.string().optional().nullable(),
});

fillCallbackRoutes.post("/reconcile-clear", async (req: Request, res: Response) => {
  const correlationId = (req as Request & { id?: string }).id ?? randomUUID();

  const secret = getFillHmacSecret();
  if (!secret) {
    return res.status(503).json({ error: "Fill callback endpoint not configured" });
  }

  const parseResult = ReconcileClearBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid request body", details: parseResult.error.issues });
  }

  const body = parseResult.data;

  // Replay guard
  const drift = Math.abs(Date.now() - body.timestamp_ms);
  if (drift > REPLAY_WINDOW_MS) {
    return res.status(401).json({ error: "Request timestamp outside acceptable window" });
  }

  // HMAC: canonical message uses "reconcile-clear" as the source
  const hmacValid = verifyFillCallbackHmac({
    brokerSource: "reconcile-clear",
    timestampMs: body.timestamp_ms,
    brokerFillId: body.account_id,
    symbol: body.rationale.slice(0, 64),
    providedHmac: body.hmac,
    secret,
  });

  if (!hmacValid) {
    await writeAudit(
      "fill_callback.auth_failure",
      { reason: "invalid_hmac", action: "reconcile-clear", account_id: body.account_id },
      { status: 401 },
      "failure",
      correlationId,
    );
    return res.status(401).json({ error: "Authentication failed" });
  }

  const result = await clearAccountReconcileBlock(
    body.account_id,
    body.rationale,
    correlationId,
  );

  await writeAudit(
    "fill_callback.reconcile_clear",
    { account_id: body.account_id, rationale: body.rationale },
    { cleared: result.cleared },
    "success",
    correlationId,
  );

  return res.status(200).json({ outcome: "reconcile_cleared", ...result, correlationId });
});
