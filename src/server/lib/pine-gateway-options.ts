/**
 * pine-gateway-options.ts
 *
 * Pass 4 Track B — Pure gateway-options resolution helper.
 *
 * Separated from pine-export-service.ts so it can be tested without
 * pulling in the DB module (which requires DATABASE_URL at import time).
 *
 * gateway_mode (snake_case) is the key Track A's pine_compiler.py reads
 * from the config JSON when deciding which webhook payload shape to emit.
 *
 * mode='tf_gateway'  → compact TF-gateway payload shape routed through routeOrder()
 *                      so every alert hits the kill-switch, compliance gate, firm-cap
 *                      clamp, and TradersPost circuit breaker.
 * mode='direct'      → legacy traderspost.io direct path (bypasses broker-router).
 *                      Operator must explicitly opt-in or accept the audit WARN.
 */

export interface GatewayOptions {
  mode: "tf_gateway" | "direct";
  gatewayUrl?: string;
}

/**
 * Derive gateway options from caller-supplied options or env fallback.
 *
 * Resolution order (highest priority first):
 *   1. Explicit `gatewayOptions` argument (operator opted-in deliberately → no audit)
 *   2. LIVE_ORDER_GATEWAY_URL env present → tf_gateway mode (institutional default)
 *   3. LIVE_ORDER_GATEWAY_URL missing → direct mode + LOUD audit + Discord WARN
 *
 * Returns the resolved GatewayOptions plus a flag indicating whether the
 * fallback audit should fire (shouldAuditFallback=true means: env was missing
 * AND no explicit opts were passed — operator must be notified that Path A is active).
 */
export function deriveGatewayOptions(
  _strategyId: string,
  explicit?: GatewayOptions,
): { opts: GatewayOptions; shouldAuditFallback: boolean } {
  // 1. Explicit caller opt-in — no fallback audit regardless of env
  if (explicit != null) {
    return { opts: explicit, shouldAuditFallback: false };
  }

  // 2. Env-driven institutional default
  const gatewayUrl = process.env["LIVE_ORDER_GATEWAY_URL"];
  if (gatewayUrl && gatewayUrl.trim() !== "") {
    return {
      opts: { mode: "tf_gateway", gatewayUrl: gatewayUrl.trim() },
      shouldAuditFallback: false,
    };
  }

  // 3. Missing env → fallback to direct with loud audit
  return {
    opts: { mode: "direct" },
    shouldAuditFallback: true,
  };
}
