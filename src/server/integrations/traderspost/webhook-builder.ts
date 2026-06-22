/**
 * TradersPost Webhook Builder
 *
 * Constructs TradersPost webhook JSON payloads from paper-engine signal objects.
 * Extracted from pine-export-service.ts to provide a single authoritative builder
 * for all TradersPost submissions (paper-execution-service + pine export artifacts).
 *
 * Pine export artifacts embed the strategy_id so TradersPost alert payloads can
 * be traced back to the originating Trading Forge strategy in audit_log.
 */

import type { TradersPostWebhookPayload, TradersPostAction, TradersPostOrderType, TradersPostPositionType } from "./types.js";

// ─── Signal shape accepted by the builder ───────────────────────────────────

export interface WebhookSignal {
  /** Direction of the trade */
  action: "enter_long" | "enter_short" | "exit_long" | "exit_short" | "exit";

  /** Symbol ticker */
  ticker: string;

  /** Contract quantity (positive integer) */
  quantity?: number;

  /** Limit price for limit orders */
  price?: number;

  /** Stop price for stop orders */
  stopPrice?: number;

  /** Order type (defaults to "market" when not provided) */
  orderType?: "market" | "limit" | "stop" | "stop_limit";

  /** Trading Forge strategy ID for traceability */
  strategyId?: string;

  /**
   * ISO-8601 bar timestamp from the originating TradingView alert.
   * Used to build the deterministic X-Idempotency-Key in the TradersPost client
   * (FINDING #2 FIX): a retry of the same bar produces the same key so
   * TradersPost deduplicates server-side and no duplicate live order fires.
   * Optional — when absent the client falls back to strategyId-ticker-action.
   */
  barTimestamp?: string;
}

// ─── Action mapping ───────────────────────────────────────────────────────────

function mapAction(action: WebhookSignal["action"]): {
  tpAction: TradersPostAction;
  positionType?: TradersPostPositionType;
} {
  switch (action) {
    case "enter_long":
      return { tpAction: "buy", positionType: "long" };
    case "enter_short":
      return { tpAction: "sell", positionType: "short" };
    case "exit_long":
    case "exit_short":
    case "exit":
      return { tpAction: "exit" };
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown signal action: ${String(_exhaustive)}`);
    }
  }
}

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a TradersPost webhook payload from a signal object.
 *
 * The apiKey is injected at submission time (not stored in the payload shape
 * used for Pine export artifacts — it is added by the client module).
 */
export function buildWebhookPayload(
  apiKey: string,
  signal: WebhookSignal,
): TradersPostWebhookPayload {
  const { tpAction, positionType } = mapAction(signal.action);

  const orderType: TradersPostOrderType = signal.orderType ?? "market";

  const payload: TradersPostWebhookPayload = {
    apiKey,
    action: tpAction,
    ticker: signal.ticker,
    orderType,
  };

  if (positionType !== undefined) {
    payload.positionType = positionType;
  }

  if (signal.quantity !== undefined) {
    payload.quantity = String(signal.quantity);
  }

  if (signal.price !== undefined) {
    payload.price = String(signal.price);
  }

  if (signal.stopPrice !== undefined) {
    payload.stopPrice = String(signal.stopPrice);
  }

  if (signal.strategyId) {
    payload.strategyId = signal.strategyId;
    payload.passthrough = { trading_forge_strategy_id: signal.strategyId };
  }

  return payload;
}

// ─── TF Gateway options — Pine static-token path ─────────────────────────────

/**
 * Options for routing a Pine alert through the TF Order Gateway
 * instead of directly to TradersPost.
 *
 * Pine Script v5 cannot compute per-payload HMAC (no crypto library).
 * The gateway static-token path accepts the per-account `hmac_secret`
 * (from account_strategy_assignments) as a bearer token embedded at
 * export compile-time. The token is long-lived and scoped to the
 * (account, strategy) pair.
 *
 * When gatewayOptions is provided AND a gateway URL is resolvable,
 * buildPineAlertTemplate emits the TF gateway payload instead of the
 * direct TradersPost payload. Gate: only active when LIVE_ORDER_GATEWAY_URL
 * env var is set (or gatewayOptions.gatewayUrl is explicitly provided).
 */
export interface PineGatewayOptions {
  /** Per-account static bearer token — value of account_strategy_assignments.hmac_secret */
  staticToken: string;
  /** broker_accounts.account_id UUID for this export recipient */
  accountId: string;
  /** Trading Forge strategy UUID */
  strategyId: string;
  /**
   * Override URL for the TF gateway. If omitted, falls back to
   * LIVE_ORDER_GATEWAY_URL env var. Accepts the full URL including path,
   * e.g. https://tower.example.com/api/live-order
   */
  gatewayUrl?: string;
}

/**
 * Build a Pine alert payload string (JSON template for TradingView alert body).
 * Used by pine-export-service to generate the Pine script alert() call body.
 *
 * When gatewayOptions is supplied AND the LIVE_ORDER_GATEWAY_URL env var is set
 * (or gatewayOptions.gatewayUrl is provided), emits a TF gateway payload with
 * the per-account static bearer token instead of a direct TradersPost payload.
 * This routes Pine alerts through the full TF gate stack (kill-switch, compliance,
 * firm-cap, correlation guard) before reaching the broker.
 *
 * SEMANTIC NOTE: The Pine alert JSON body is a string literal embedded in the
 * exported .pine file. TradingView substitutes {{strategy.order.action}} and
 * {{strategy.order.contracts}} at alert-fire time. All other fields are baked in
 * at export time, including the static bearer token. The token is long-lived and
 * scoped to the (account, strategy) pair — not per-alert. Replay protection is
 * provided by the gateway's 2-minute timestamp_ms window + bar_timestamp dedup.
 *
 * EXPORTABILITY NOTE: The static token is embedded as a plain string literal in
 * the exported .pine file. Anyone with the .pine file can read the token. The
 * token is scoped to one (account, strategy) — it cannot be used for other
 * accounts or strategies. Treat the .pine file as a secret artifact.
 *
 * REPAINT NOTE: `{{time}}` in Pine is the bar's OPEN time (not close time) when
 * evaluated in a strategy script context. The gateway's 2-minute replay window
 * is calibrated for bar-close alert delivery. Intrabar alerts using `{{time}}`
 * of the current forming bar may be outside the window if the bar is old. Use
 * bar-close alert mode (alerts fire on barstate.isconfirmed) — always.
 *
 * For TopstepX broker_type, returns a Pine comment stub — not yet implemented.
 */
export function buildPineAlertTemplate(
  ticker: string,
  strategyId: string | undefined,
  brokerType: "traderspost" | "topstepx",
  gatewayOptions?: PineGatewayOptions,
): string {
  if (brokerType === "topstepx") {
    // TopstepX Pine payload is deferred until the operator opens a Topstep account
    // with TopstepX API subscription ($14.50/mo, promo code "topstep").
    // When deferred work begins, mirror the TradersPost payload structure.
    return `// TopstepX webhook payload — not yet implemented. Deferred until TopstepX account configured.`;
  }

  // ── TF Gateway path (Pine static-token mode) ──────────────────────────────
  // Active when gatewayOptions is provided AND a gateway URL is resolvable.
  // The static token is the per-(account,strategy) hmac_secret from DB.
  const gatewayUrl =
    gatewayOptions?.gatewayUrl ?? process.env.LIVE_ORDER_GATEWAY_URL;

  if (gatewayOptions && gatewayUrl) {
    // Pine alert body for TF gateway. Fields baked in at export time:
    //   account_id, strategy_id, ticker, live_order_token.
    // Fields substituted by TradingView at alert-fire time:
    //   action ({{strategy.order.action}}), quantity ({{strategy.order.contracts}}),
    //   timestamp_ms and bar_timestamp ({{time}} — Pine bar open time in Unix millis).
    //
    // NOTE: `{{time}}` is Pine's bar open time in ms. For bar-close alerts this
    // is consistently the same value per bar, providing reliable dedup.
    // The gateway's 2-minute replay window assumes alerts fire near bar close.
    return (
      `{"account_id": "${gatewayOptions.accountId}", ` +
      `"strategy_id": "${gatewayOptions.strategyId}", ` +
      `"ticker": "${ticker}", ` +
      `"action": "{{strategy.order.action}}", ` +
      `"quantity": {{strategy.order.contracts}}, ` +
      `"order_type": "market", ` +
      `"timestamp_ms": {{time}}, ` +
      `"bar_timestamp": "{{time}}", ` +
      `"live_order_token": "${gatewayOptions.staticToken}"}`
    );
  }

  // ── Direct TradersPost path (legacy / fallback) ───────────────────────────
  // TradersPost Pine alert body template (JSON string literal in Pine).
  const passthrough = strategyId
    ? `, "passthrough": {"trading_forge_strategy_id": "${strategyId}"}`
    : "";

  return (
    `{"action": "{{strategy.order.action}}", ` +
    `"ticker": "${ticker}", ` +
    `"quantity": "{{strategy.order.contracts}}", ` +
    `"orderType": "market"` +
    `${passthrough}}`
  );
}
