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
import { db } from "../../db/index.js";
import { auditLog } from "../../db/schema.js";
import type { TradersPostWebhookPayload, TradersPostSubmitResult } from "./types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const TRADERSPOST_WEBHOOK_BASE_URL =
  process.env.TRADERSPOST_WEBHOOK_URL ?? "https://traderspost.io/trading/webhook";

const SUBMIT_TIMEOUT_MS = 10_000; // 10 s — broker webhook must respond promptly

// ─── 5xx retry policy ────────────────────────────────────────────────────────
// Retries apply ONLY to transient server-side errors (HTTP 500–599).
// 4xx responses are client errors that will not succeed on retry — fail immediately.
// The X-Idempotency-Key header MUST remain constant across all retry attempts so
// TradersPost deduplicates correctly and never fires a duplicate order.

const RETRY_MAX_ATTEMPTS_5XX = 2; // beyond initial attempt = 3 total attempts
const RETRY_BASE_DELAY_MS = 500;
const RETRY_JITTER_MAX_MS = 200;

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
  // F-3 FIX: Idempotency key is bar-scoped (SHA-256 over the five-field
  // bar-event tuple), not correlationId-based. A TradingView retry of the same
  // bar+signal will produce the same key, preventing a duplicate live order.
  // Fallback: when barTs is unavailable, append a randomUUID() so each call is
  // unique — the previous static "strategyId-ticker-action" key caused TradersPost
  // to treat every same-direction entry as a duplicate after the first submission.
  const idempotencyKey = idempotencyInputs
    ? buildDeterministicIdempotencyKey(idempotencyInputs)
    : `${payload.strategyId ?? "tf"}-${payload.ticker}-${payload.action}-${randomUUID()}`;

  // ── Retry loop — 5xx only, idempotency key held constant across all attempts ──
  // The AbortController / timeout applies per-attempt (each attempt gets a fresh
  // signal because a single AbortController can only abort once).

  let attemptIndex = 0; // 0 = first attempt, 1 = first retry, 2 = second retry

  while (true) {
    // Fresh abort controller per attempt — the previous signal is already consumed
    // by clearTimeout / abort from the prior iteration.
    const attemptController = new AbortController();
    const attemptTimeoutId = setTimeout(() => attemptController.abort(), SUBMIT_TIMEOUT_MS);

    try {
      logger.debug(
        {
          action: payload.action,
          ticker: payload.ticker,
          orderType: payload.orderType,
          positionType: payload.positionType,
          strategyId: payload.strategyId,
          idempotencyKey,
          attemptIndex,
        },
        "traderspost:client: submitting webhook order",
      );

      const response = await fetch(TRADERSPOST_WEBHOOK_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Idempotency key — TradersPost deduplicates on this value.
          // Stable for the same logical signal; unique across different signals.
          // CRITICAL: This key is computed ONCE before the retry loop and held
          // constant across all attempts so TradersPost deduplicates correctly.
          "X-Idempotency-Key": idempotencyKey,
        },
        // Never log the full payload — it contains the api key
        body: JSON.stringify(payload),
        signal: attemptController.signal,
      });

      clearTimeout(attemptTimeoutId);

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        responseBody = null;
      }

      if (!response.ok) {
        const is5xx = response.status >= 500 && response.status < 600;

        if (is5xx && attemptIndex < RETRY_MAX_ATTEMPTS_5XX) {
          // Transient server error — eligible for retry
          logger.warn(
            {
              statusCode: response.status,
              action: payload.action,
              ticker: payload.ticker,
              attemptIndex,
              retriesRemaining: RETRY_MAX_ATTEMPTS_5XX - attemptIndex,
            },
            "traderspost:client: 5xx response — will retry",
          );

          // Jitter backoff: attempt 0→1 waits ~500–700 ms; attempt 1→2 waits ~1000–1200 ms
          const baseDelay = RETRY_BASE_DELAY_MS * (attemptIndex + 1);
          await new Promise((resolve) =>
            setTimeout(resolve, baseDelay + Math.floor(Math.random() * RETRY_JITTER_MAX_MS)),
          );

          attemptIndex++;
          continue; // retry
        }

        // Non-5xx (4xx) or all retries exhausted
        if (is5xx) {
          // All RETRY_MAX_ATTEMPTS_5XX retries consumed — emit exhaustion audit
          logger.error(
            {
              statusCode: response.status,
              action: payload.action,
              ticker: payload.ticker,
              attemptCount: attemptIndex + 1,
            },
            "traderspost:client: 5xx retry budget exhausted — order dropped",
          );

          // Fire-and-forget audit write — must not throw or block the return path
          void db
            .insert(auditLog)
            .values({
              action: "traderspost.webhook_5xx_exhausted",
              entityType: "broker_account",
              entityId: null,
              decisionAuthority: "system",
              input: {
                ticker: payload.ticker,
                action: payload.action,
                strategyId: payload.strategyId ?? null,
                idempotencyKey,
                correlationId: correlationId ?? null,
              } as Record<string, unknown>,
              result: {
                attemptCount: attemptIndex + 1,
                lastStatusCode: response.status,
                responseBody,
              } as Record<string, unknown>,
              status: "warning",
              correlationId: correlationId ?? null,
            })
            .catch((auditErr: unknown) => {
              logger.error(
                { auditErr },
                "traderspost:client: failed to write webhook_5xx_exhausted audit row (non-blocking)",
              );
            });

          // Callers should escalate to notifyCritical when retryAttempt >= RETRY_MAX_ATTEMPTS_5XX
          // — the full retry budget was consumed and a live order was silently dropped.
          return {
            success: false,
            statusCode: response.status,
            responseBody,
            error: `HTTP ${response.status} after ${attemptIndex + 1} attempts`,
            retryAttempt: attemptIndex,
          };
        }

        // 4xx — client error, do not retry, no audit row (caller error, not transient)
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
          retryAttempt: attemptIndex,
        };
      }

      // Success path
      if (attemptIndex > 0) {
        logger.info(
          {
            statusCode: response.status,
            action: payload.action,
            ticker: payload.ticker,
            strategyId: payload.strategyId,
            attemptIndex,
          },
          "traderspost:client: webhook order submitted successfully after retry",
        );
      } else {
        logger.info(
          {
            statusCode: response.status,
            action: payload.action,
            ticker: payload.ticker,
            strategyId: payload.strategyId,
          },
          "traderspost:client: webhook order submitted successfully",
        );
      }

      return { success: true, statusCode: response.status, responseBody, retryAttempt: attemptIndex };
    } catch (err: unknown) {
      clearTimeout(attemptTimeoutId);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errorMsg = isAbort
        ? `TradersPost webhook timeout after ${SUBMIT_TIMEOUT_MS}ms`
        : `TradersPost webhook fetch error: ${err instanceof Error ? err.message : String(err)}`;

      logger.error(
        { error: errorMsg, action: payload.action, ticker: payload.ticker },
        "traderspost:client: webhook submission failed",
      );

      // Network errors and timeouts are NOT retried — they are not 5xx HTTP responses.
      // A timeout means the broker may have already processed the order; retrying risks
      // a duplicate fill even though TradersPost deduplicates on the idempotency key,
      // because the server may not have read the header before timing out.
      return { success: false, error: errorMsg, retryAttempt: attemptIndex };
    }
  }
}

// ─── Credential probe transport (item 4, R-349 §2) ───────────────────────────

/**
 * Perform the credential-validity probe request.
 *
 * WHY IT LIVES HERE: this module is the ONE place permitted to open an HTTP
 * connection to a TradersPost host, enforced by
 * `services/__tests__/broker-egress-chokepoint.test.ts`. The probe previously
 * ran its own `fetch` from broker-router.ts against a duplicate copy of the same
 * base-URL constant — a second egress point with its own timeout, its own URL
 * resolution, and no shared contract with the order path. Two egress points mean
 * two sets of behaviour to keep correct; the enumeration that found them was done
 * by hand and does not re-run itself.
 *
 * This function is TRANSPORT ONLY. It deliberately does NOT decide whether the
 * probe may run — `checkProbeGate()` in broker-router.ts owns that, and moving
 * the decision here would scatter the gate the same way the fetch was scattered.
 *
 * SECURITY: the caller's apiKey is placed in the body and must never be logged.
 * Returns the raw status so the caller keeps its 401/403-vs-4xx interpretation.
 */
export async function probeCredentialTransport(
  apiKey: string,
  timeoutMs: number,
): Promise<{ ok: true; status: number } | { ok: false; isAbort: boolean }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(TRADERSPOST_WEBHOOK_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return { ok: true, status: resp.status };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    return { ok: false, isAbort: err instanceof Error && err.name === "AbortError" };
  }
}
