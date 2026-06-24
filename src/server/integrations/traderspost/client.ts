/**
 * TradersPost Client
 *
 * Submits webhook orders to TradersPost. This is the single call site for all
 * TradersPost HTTP submissions — previously inline in paper-execution-service.ts.
 *
 * Fail-CLOSED: any network error or unexpected HTTP status is returned as
 * { success: false, error: ... } — never throws, never swallows silently.
 *
 * Logging: logs key names and action types only. Never logs api keys or prices
 * in plain text outside of debug level.
 */

import { createHash, randomUUID } from "crypto";
import { logger } from "../../lib/logger.js";
import type { TradersPostWebhookPayload, TradersPostSubmitResult } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRADERSPOST_WEBHOOK_BASE_URL =
  process.env.TRADERSPOST_WEBHOOK_URL ?? "https://traderspost.io/trading/webhook";

const SUBMIT_TIMEOUT_MS = 10_000; // 10 s — broker webhook must respond promptly

// ─── Deterministic idempotency key ───────────────────────────────────────────

/**
 * Inputs required to compute a bar-scoped idempotency key.
 * All five fields identify a unique bar-signal event on a specific account.
 */
export interface IdempotencyKeyInputs {
  accountId: string;
  strategyId: string;
  ticker: string;
  action: string;
  barTs: string; // ISO-8601 or millis-as-string — must be stable per bar
}

/**
 * Build a deterministic, bar-scoped idempotency key.
 *
 * FINDING #2 FIX: The old code used `correlationId ?? strategyId-ticker-action`
 * as the X-Idempotency-Key. Because correlationId was a fresh UUID per HTTP
 * request, a TradingView retry of the SAME bar+signal generated a different key,
 * causing TradersPost to fire a second live order (double exposure).
 *
 * The key is now SHA-256(accountId|strategyId|ticker|action|barTs) — deterministic
 * on the bar-event tuple. A retry of the same bar produces the same key; TradersPost
 * deduplicates on it server-side. The correlationId remains available for tracing
 * but is NOT used in the idempotency key.
 */
export function buildDeterministicIdempotencyKey(inputs: IdempotencyKeyInputs): string {
  const raw = [inputs.accountId, inputs.strategyId, inputs.ticker, inputs.action, inputs.barTs].join("|");
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// ─── Submission function ─────────────────────────────────────────────────────

/**
 * Submit a webhook order to TradersPost.
 *
 * @param payload       - Complete webhook payload (apiKey must be included).
 * @param correlationId - Optional trace ID propagated from the caller (for
 *                        structured logging and audit_log correlation only).
 *                        NOT used to build the idempotency key — see
 *                        idempotencyInputs below.
 * @param idempotencyInputs - Bar-scoped inputs for the deterministic
 *                        X-Idempotency-Key header. When provided, the key is
 *                        SHA-256(accountId|strategyId|ticker|action|barTs).
 *                        When omitted, falls back to strategyId-ticker-action
 *                        (legacy behaviour, bar-timestamp-less — avoid when
 *                        barTs is available).
 * @returns TradersPostSubmitResult — success flag + raw response info.
 */
export async function submitWebhookOrder(
  payload: TradersPostWebhookPayload,
  correlationId?: string | null,
  idempotencyInputs?: IdempotencyKeyInputs | null,
): Promise<TradersPostSubmitResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  // F-3 FIX: Idempotency key is bar-scoped (SHA-256 over the five-field
  // bar-event tuple), not correlationId-based. A TradingView retry of the same
  // bar+signal will produce the same key, preventing a duplicate live order.
  // Fallback: when barTs is unavailable, append a randomUUID() so each call is
  // unique — the previous static "strategyId-ticker-action" key caused TradersPost
  // to treat every same-direction entry as a duplicate after the first submission.
  const idempotencyKey = idempotencyInputs
    ? buildDeterministicIdempotencyKey(idempotencyInputs)
    : `${payload.strategyId ?? "tf"}-${payload.ticker}-${payload.action}-${randomUUID()}`;

  try {
    logger.debug(
      {
        action: payload.action,
        ticker: payload.ticker,
        orderType: payload.orderType,
        positionType: payload.positionType,
        strategyId: payload.strategyId,
        idempotencyKey,
      },
      "traderspost:client: submitting webhook order",
    );

    const response = await fetch(TRADERSPOST_WEBHOOK_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Idempotency key — TradersPost deduplicates on this value.
        // Stable for the same logical signal; unique across different signals.
        "X-Idempotency-Key": idempotencyKey,
      },
      // Never log the full payload — it contains the api key
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    if (!response.ok) {
      logger.warn(
        {
          statusCode: response.status,
          action: payload.action,
          ticker: payload.ticker,
        },
        "traderspost:client: webhook submission returned non-OK status",
      );
      return {
        success: false,
        statusCode: response.status,
        responseBody,
        error: `HTTP ${response.status}`,
      };
    }

    logger.info(
      {
        statusCode: response.status,
        action: payload.action,
        ticker: payload.ticker,
        strategyId: payload.strategyId,
      },
      "traderspost:client: webhook order submitted successfully",
    );

    return { success: true, statusCode: response.status, responseBody };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const errorMsg = isAbort
      ? `TradersPost webhook timeout after ${SUBMIT_TIMEOUT_MS}ms`
      : `TradersPost webhook fetch error: ${err instanceof Error ? err.message : String(err)}`;

    logger.error(
      { error: errorMsg, action: payload.action, ticker: payload.ticker },
      "traderspost:client: webhook submission failed",
    );

    return { success: false, error: errorMsg };
  }
}
