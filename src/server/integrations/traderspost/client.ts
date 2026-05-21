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

import { logger } from "../../lib/logger.js";
import type { TradersPostWebhookPayload, TradersPostSubmitResult } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRADERSPOST_WEBHOOK_BASE_URL =
  process.env.TRADERSPOST_WEBHOOK_URL ?? "https://traderspost.io/trading/webhook";

const SUBMIT_TIMEOUT_MS = 10_000; // 10 s — broker webhook must respond promptly

// ─── Submission function ─────────────────────────────────────────────────────

/**
 * Submit a webhook order to TradersPost.
 *
 * @param payload       - Complete webhook payload (apiKey must be included).
 * @param correlationId - Optional trace ID propagated from the caller. Used to
 *                        construct the X-Idempotency-Key header so duplicate
 *                        submissions (retries, network blips) are deduplicated
 *                        by TradersPost. Falls back to strategyId+ticker+action
 *                        when correlationId is not provided.
 * @returns TradersPostSubmitResult — success flag + raw response info.
 */
export async function submitWebhookOrder(
  payload: TradersPostWebhookPayload,
  correlationId?: string | null,
): Promise<TradersPostSubmitResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  // F-6: Idempotency key — prevents duplicate fills on retry/network blips.
  // Prefer correlationId (trace-safe, globally unique per bar-signal pair).
  // Fallback: strategyId-ticker-action (stable for same signal, no timestamp drift).
  const idempotencyKey =
    correlationId ??
    [payload.strategyId ?? "tf", payload.ticker, payload.action].join("-");

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
