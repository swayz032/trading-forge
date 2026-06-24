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

// F-1 (Pass 6 / Track A 2026-05-20): Pine cannot compute HMAC-SHA256 natively.
// Old contract required runtime `hmac` field signed over canonical bar payload —
// impossible from Pine. New contract:
//   - `hmac` is OPTIONAL (legacy clients still validated when present).
//   - AUTH CONTRACT (clarified 2026-06-22): at least ONE of `hmac` (legacy) or
//     `secret_check` (preferred) must be present AND valid; a request with neither
//     is rejected 401 hmac_invalid (fail-closed). Both Zod-optional by design — you
//     cannot make either mandatory without breaking one client class.
//   - `secret_check` is the REQUIRED mechanism for Pine clients — export-time signature emitted by pine_compiler
//     proving the Pine file came from a trusted artifact. Computed over a FIXED
//     payload at compile-time (e.g. "{strategy_id}|{account_id}|export") and
//     embedded as a Pine string literal. The backend re-computes the same
//     signature using the per-(account, strategy) secret and compares with
//     constant-time equality. Replay-resistance is provided by the existing
//     10-minute bar_timestamp window (line ~259) plus the unique-index dedupe
//     on (account_id, strategy_id, bar_timestamp, signal).
// BUG-5 fix: bar_timestamp accepts either ISO-8601 string OR numeric Unix milliseconds integer.
// Pine v5 str.tostring(time) returns Unix millis (integer series); str.format_time() does not
// exist in Pine v5. The schema coerces numeric millis to ISO-8601 string via transform so
// all downstream code (replay window check, DB insert) works with a consistent string type.
const markerPayloadSchema = z.object({
  strategy_id:    z.string().uuid("strategy_id must be a UUID"),
  account_id:     z.string().uuid("account_id must be a UUID"),
  bar_timestamp:  z.union([
    z.string().datetime({ message: "bar_timestamp must be ISO 8601 or Unix millis integer" }),
    z.number().int().positive().transform((ms) => new Date(ms).toISOString()),
  ]),
  signal:         z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  hmac:           z.string().min(1).optional(),     // F-1: optional legacy
  secret_check:   z.string().min(1).optional(),     // F-1: export-time anti-tamper signature
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
    // Capture the webhook fired-at time for downstream latency measurement.
    // TradingView alert payloads may include a `time` field (ISO timestamp or
    // Unix millis of the bar close that triggered the alert). If present, use
    // that as the fire time (closest approximation to when Pine emitted the
    // alert). Otherwise fall back to the handler entry timestamp.
    const rawTime = (req.body as Record<string, unknown>)?.["time"];
    let webhookFiredAt: number = startedAt;
    if (rawTime !== undefined && rawTime !== null) {
      const parsed =
        typeof rawTime === "number"
          ? rawTime
          : typeof rawTime === "string"
          ? Date.parse(rawTime)
          : NaN;
      if (!Number.isNaN(parsed) && parsed > 0) {
        webhookFiredAt = parsed;
      }
    }

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
      secret_check,
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

    // 6. Validate authenticity (constant-time).
    // F-1 (Pass 6 / Track A 2026-05-20): two acceptable proofs of origin.
    //   (a) Legacy: payload includes `hmac` covering canonical fields. We still
    //       honor it for backwards-compat with previously-exported Pine files
    //       that pasted a pre-computed HMAC string. Validates via validateHmac().
    //   (b) Preferred: payload includes `secret_check` — the export-time
    //       signature of a FIXED payload computed by pine_compiler. We
    //       re-compute the same signature on the server with the stored
    //       per-account secret and compare in constant time.
    // At least ONE of the two MUST be present and valid, else 401.
    let isValid = false;
    let proofMode: "hmac_canonical" | "secret_check" | "none" = "none";
    if (typeof hmac === "string" && hmac.length > 0) {
      isValid = validateHmac(req.body as Record<string, unknown>, hmac, secret);
      proofMode = "hmac_canonical";
    } else if (typeof secret_check === "string" && secret_check.length > 0) {
      // Export-time signature over the fixed marker payload. MUST match the
      // value emitted by pine_compiler's `_build_marker_alert()`. Format:
      // expected = HMAC_SHA256(secret, "{strategy_id}|{account_id}|marker_export").
      const { createHmac, timingSafeEqual } = await import("crypto");
      const expected = createHmac("sha256", secret)
        .update(`${strategy_id}|${account_id}|marker_export`, "utf8")
        .digest("hex");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(secret_check, "utf8");
      isValid = a.length === b.length && timingSafeEqual(a, b);
      proofMode = "secret_check";
    }

    if (!isValid) {
      logger.warn(
        { accountId: account_id, strategyId: strategy_id, correlationId, proofMode },
        "tradingview-webhook: authentication failed (neither hmac nor secret_check valid)"
      );
      await writeAuditRow({
        action: "tradingview_marker.hmac_invalid",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: { reason: "hmac_mismatch", proofMode },
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "hmac_invalid" });
      return;
    }

    // F-2: Replay prevention — reject stale payloads outside 10-minute window.
    // bar_timestamp is the close time of the TradingView bar that triggered the alert.
    // Legitimate TradingView webhook delivery is near-instant (< 30s typical).
    // 10 minutes is generous enough to handle TradingView server-side retry storms
    // while closing the replay window to an operationally safe bound.
    // NOTE: this check is AFTER HMAC validation — never timestamp-check before auth
    // (would leak timing info about secret validity if ordered before HMAC).
    const REPLAY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const barTimestampMs = new Date(bar_timestamp).getTime();
    const nowMs = Date.now();
    if (Math.abs(nowMs - barTimestampMs) > REPLAY_WINDOW_MS) {
      logger.warn(
        {
          accountId: account_id,
          strategyId: strategy_id,
          correlationId,
          barTimestamp: bar_timestamp,
          nowMs,
          deltaMs: nowMs - barTimestampMs,
        },
        "tradingview-webhook: stale payload rejected — bar_timestamp outside 10-minute window"
      );
      await writeAuditRow({
        action: "tradingview_marker.stale_payload",
        strategyId: strategy_id,
        accountId: account_id,
        correlationId,
        status: "failure",
        result: {
          reason: "stale_payload",
          barTimestamp: bar_timestamp,
          deltaMs: nowMs - barTimestampMs,
          windowMs: REPLAY_WINDOW_MS,
        },
        durationMs: Date.now() - startedAt,
      });
      res.status(401).json({ error: "stale_payload" });
      return;
    }

    // 7. Insert marker row (hmac_validated=true)
    // Build the full payload object to store (includes extra fields).
    // webhookFiredAt is stored so downstream order routing can compute
    // end-to-end latency (fire_to_ack_ms) for the webhook.broker_ack audit row.
    const pineAlertPayload = {
      strategy_id,
      account_id,
      bar_timestamp,
      signal,
      webhookFiredAt,
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
                   ON CONFLICT (account_id, strategy_id, bar_timestamp, signal) DO NOTHING RETURNING id`
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
