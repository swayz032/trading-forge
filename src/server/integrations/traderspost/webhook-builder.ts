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

/**
 * Build a Pine alert payload string (JSON template for TradingView alert body).
 * Used by pine-export-service to generate the Pine script alert() call body.
 *
 * The strategyId is embedded so TradersPost passthrough traces back to Trading Forge.
 * For TopstepX broker_type, returns a Pine comment stub — not yet implemented.
 */
export function buildPineAlertTemplate(
  ticker: string,
  strategyId: string | undefined,
  brokerType: "traderspost" | "topstepx",
): string {
  if (brokerType === "topstepx") {
    // TopstepX Pine payload is deferred until the operator opens a Topstep account
    // with TopstepX API subscription ($14.50/mo, promo code "topstep").
    // When deferred work begins, mirror the TradersPost payload structure.
    return `// TopstepX webhook payload — not yet implemented. Deferred until TopstepX account configured.`;
  }

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
