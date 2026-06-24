/**
 * TradersPost Webhook Integration — Types
 *
 * Type definitions for TradersPost webhook payloads.
 * Reference: https://traderspost.io/docs/webhooks
 */

// ─── Allowed action values ───────────────────────────────────────────────────

export type TradersPostAction = "buy" | "sell" | "exit" | "cancel";

// ─── Allowed order types ─────────────────────────────────────────────────────

export type TradersPostOrderType = "market" | "limit" | "stop" | "stop_limit";

// ─── Allowed position types ──────────────────────────────────────────────────

export type TradersPostPositionType = "long" | "short";

// ─── Core webhook payload ────────────────────────────────────────────────────

/**
 * Canonical TradersPost webhook payload shape.
 * All fields match the TradersPost expected JSON format.
 * price/quantity/stopPrice are strings to avoid floating-point JSON encoding issues.
 */
export interface TradersPostWebhookPayload {
  /** TradersPost webhook API key (from account settings) */
  apiKey: string;

  /** Action to perform */
  action: TradersPostAction;

  /** Symbol ticker (e.g. "MES1!", "MNQ1!", "MCL1!") */
  ticker: string;

  /** Order quantity as string */
  quantity?: string;

  /** Order type */
  orderType: TradersPostOrderType;

  /** Position type for entry signals */
  positionType?: TradersPostPositionType;

  /** Limit price (required for limit orders) */
  price?: string;

  /** Stop price (required for stop/stop_limit orders) */
  stopPrice?: string;

  /** Strategy ID embedded for traceability (Trading Forge internal) */
  strategyId?: string;

  /** Custom passthrough JSON field for metadata */
  passthrough?: Record<string, unknown>;
}

// ─── Submission result ───────────────────────────────────────────────────────

export interface TradersPostSubmitResult {
  success: boolean;
  statusCode?: number;
  responseBody?: unknown;
  error?: string;
  /**
   * Present when this result followed one or more 5xx retries.
   * - 0  → first attempt succeeded (or a non-5xx failure — no retry was made)
   * - 1  → first attempt failed 5xx; second attempt produced this result
   * - 2  → first two attempts failed 5xx; third attempt produced this result
   *
   * Callers that receive `success: false` AND `retryAttempt >= RETRY_MAX_ATTEMPTS_5XX`
   * should escalate from notifyWarning to notifyCritical — all retry budget was consumed.
   */
  retryAttempt?: number;
}
