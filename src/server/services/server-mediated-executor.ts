/**
 * Server-Mediated Execution — Phase 0 Scaffold
 *
 * FLAG-GATED: SERVER_MEDIATED_EXECUTION_ENABLED=true (DEFAULT OFF)
 *
 * When the flag is OFF (the default), every function in this module is a no-op.
 * Zero existing code paths change. Paper simulation is byte-identical to today.
 *
 * When the flag is ON and the session's strategy lifecycle state is DEPLOYED or
 * PILOT, this module calls routeOrder() from broker-router.ts to place real broker
 * orders for every paper entry + exit decision. The gate stack (kill-switch, DLL,
 * compliance, pipeline-pause, circuit-breaker) runs INSIDE routeOrder() before any
 * broker contact — defense-in-depth at the broker layer.
 *
 * CALL SITE CONTRACT:
 *   Entry: Called AFTER the full gate stack has passed in paper-signal-service.ts
 *     (kill-switch, anti-setup, confluence, DLL, compliance, daily-cap, news blackout).
 *     The paper position is already created before this fires. Routing failure does
 *     NOT roll back the paper position — operator must reconcile manually.
 *
 *   Exits: Called AFTER paper-execution-service.ts has applied the exit decision
 *     (TP1 partial close, TP2 partial close, BE move, trail update, 15:55 flatten).
 *     Paper state is already updated. Routing failure does NOT revert paper state.
 *
 * SHADOW STATE INVARIANT:
 *   SHADOW strategies must NEVER call routeOrder(). The shadow stage exists to log
 *   signals without broker contact. This module enforces that invariant with an
 *   explicit guard (checked first, before flag, before any routeOrder call).
 *
 * FILL RECONCILIATION = PHASE 1 (NOT BUILT HERE):
 *   Phase 0 fires the live order and emits audit rows. It does NOT reconcile broker
 *   fill confirmations (actual fill price, partial fills, rejections after ack) back
 *   to paper_positions. That two-way sync is Phase 1.
 *
 *   In Phase 0:
 *     - On routeOrder success: paper position is open; audit action = order_routed.
 *     - On routeOrder failure: paper position is open (unchanged); audit action =
 *       order_routing_failed, status = needs_reconcile. Operator must verify the
 *       live broker account state manually.
 *
 * AUDIT ACTIONS EMITTED (all in paper-parity journal namespace):
 *   server_mediated.order_routed         — entry order successfully dispatched
 *   server_mediated.order_routing_failed — entry routing failed (needs reconcile)
 *   server_mediated.exit_routed          — exit order (TP1/TP2/BE_MOVE/TRAIL/flatten) dispatched
 *   server_mediated.exit_routing_failed  — exit routing failed (needs reconcile)
 *   server_mediated.shadow_blocked       — SHADOW guard fired (invariant enforced)
 */

import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { routeOrder } from "./broker-router.js";
import type { WebhookSignal } from "../integrations/traderspost/webhook-builder.js";
import { buildDeterministicIdempotencyKey } from "../integrations/traderspost/client.js";
import {
  persistOrderAtRouted,
  updateOrderToAcked,
  updateOrderToNeedsReconcile,
  isAccountBlockedForReconcile,
} from "./fill-reconciliation-service.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * The only lifecycle states that trigger live broker order routing.
 * DEPLOYED and PILOT are "live" — all other states (SHADOW, PAPER, TESTING,
 * CANDIDATE, DEPLOY_READY, DECLINING, RETIRED, GRAVEYARD, etc.) are
 * simulation-only and must never call routeOrder().
 */
export const LIVE_EXECUTION_STATES: ReadonlySet<string> = new Set(["DEPLOYED", "PILOT"]);

// ─── Flag helper ───────────────────────────────────────────────────────────────

/**
 * Returns true only when SERVER_MEDIATED_EXECUTION_ENABLED is the exact string
 * "true". Intentionally strict — "TRUE", "1", "yes", "on" all return false.
 * Default OFF (absent env var → false).
 */
export function isServerMediatedExecutionEnabled(): boolean {
  return process.env.SERVER_MEDIATED_EXECUTION_ENABLED === "true";
}

// ─── Context type ──────────────────────────────────────────────────────────────

/** Execution context threaded through from the signal processing pipeline. */
export interface LiveExecutionContext {
  /** broker_accounts.account_id for this session (passed as first arg to routeOrder) */
  accountId: string;
  /** strategies.lifecycle_state at signal time — guards SHADOW/non-live states */
  lifecycleState: string;
  /** paper_sessions.id — used as entityId in audit log rows */
  sessionId: string;
  /** strategies.id — embedded in WebhookSignal for traceability */
  strategyId: string;
  /** Correlation ID propagated from the signal chain (nullable) */
  correlationId?: string | null;
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface RoutingOutcome {
  /** Whether the order was dispatched to the broker layer */
  routed: boolean;
  /** Reason routing was skipped (flag_disabled | shadow_state_blocked | not_live_state) or broker failure reason */
  reason?: string;
  /** True when routeOrder returned failure — operator must verify live account state */
  needsReconcile?: boolean;
}

// ─── Internal: guard ──────────────────────────────────────────────────────────

/**
 * Checks SHADOW invariant first, then lifecycle state, then flag.
 * Returns a skip reason string if routing must be skipped, or null to proceed.
 *
 * Order: SHADOW → non-live-state → flag_disabled
 * SHADOW check is unconditional (even if flag is off, shadow must not route).
 */
function checkRoutingGuard(ctx: LiveExecutionContext): string | null {
  // SHADOW invariant: never route regardless of flag state
  if (ctx.lifecycleState === "SHADOW") {
    return "shadow_state_blocked";
  }
  // Flag check
  if (!isServerMediatedExecutionEnabled()) {
    return "flag_disabled";
  }
  // Live-state check
  if (!LIVE_EXECUTION_STATES.has(ctx.lifecycleState)) {
    return "not_live_state";
  }
  // Phase 1 go-live prerequisite (FAIL-CLOSED, forget-proof): server-mediated
  // execution must NOT route live orders unless broker fill reconciliation is
  // configured — otherwise the server fires live and never learns the actual
  // fill (blind position drift). BROKER_FILL_HMAC_SECRET authenticates the
  // /api/broker/fill-callback ingestion endpoint; without it, reconciliation
  // cannot run, so we refuse to route live. See
  // docs/go-live-server-mediated-execution.md for the full go-live checklist.
  if (!process.env.BROKER_FILL_HMAC_SECRET || process.env.BROKER_FILL_HMAC_SECRET.length < 32) {
    logger.error(
      { sessionId: ctx.sessionId, strategyId: ctx.strategyId },
      "server-mediated-executor: SERVER_MEDIATED_EXECUTION_ENABLED=true but BROKER_FILL_HMAC_SECRET is unset/<32 chars — REFUSING to route live (fill reconciliation not configured). Set BROKER_FILL_HMAC_SECRET (>=32 chars) before going live. See docs/go-live-server-mediated-execution.md.",
    );
    return "fill_recon_not_configured";
  }
  return null; // proceed
}

// ─── Internal: audit write ────────────────────────────────────────────────────

async function writeRoutingAudit(
  action: string,
  ctx: LiveExecutionContext,
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  status: string,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      entityType: "paper_session",
      entityId: ctx.sessionId,
      decisionAuthority: "system",
      input: {
        strategyId: ctx.strategyId,
        lifecycleState: ctx.lifecycleState,
        accountId: ctx.accountId,
        ...input,
      },
      result,
      status,
      correlationId: ctx.correlationId ?? null,
    });
  } catch (auditErr) {
    // Audit failure must never block routing or downstream logic — log only.
    logger.error(
      { auditErr, action, sessionId: ctx.sessionId },
      "server-mediated-executor: audit write failed (non-blocking)",
    );
  }
}

// ─── Internal: dispatch wrapper ───────────────────────────────────────────────

/**
 * Calls routeOrder(), writes an audit row, and returns a RoutingOutcome.
 *
 * Phase 1 additions:
 *   - INSERT server_mediated_orders row at 'routed' BEFORE calling routeOrder()
 *   - UPDATE to 'acked' on success, 'needs_reconcile' on failure
 *
 * Fail-CLOSED contract:
 *   - routeOrder returns { success: false } → status=needs_reconcile, routed=false
 *   - routeOrder throws → treated as failure, status=needs_reconcile, routed=false
 *   - In either failure case the paper position is NOT modified — Phase 1 reconcile required.
 */
async function dispatchRouteOrder(
  ctx: LiveExecutionContext,
  signal: WebhookSignal,
  auditAction: { success: string; failure: string },
  meta: Record<string, unknown>,
): Promise<RoutingOutcome> {
  // ── Phase 1: Persist order row at 'routed' BEFORE dispatching ──────────────
  // Build the same idempotency key that broker-router / TradersPost client uses
  // so fill callbacks can match back to this row via idempotency_key.
  const idempotencyKey = signal.barTimestamp
    ? buildDeterministicIdempotencyKey({
        accountId: ctx.accountId,
        strategyId: ctx.strategyId,
        ticker: signal.ticker,
        action: signal.action,
        barTs: signal.barTimestamp,
      })
    : // Fallback when no barTimestamp (e.g. stop-modify signals): use contextual key
      buildDeterministicIdempotencyKey({
        accountId: ctx.accountId,
        strategyId: ctx.strategyId,
        ticker: signal.ticker,
        action: signal.action,
        barTs: new Date().toISOString(),
      });

  const orderId = await persistOrderAtRouted({
    idempotencyKey,
    accountId: ctx.accountId,
    strategyId: ctx.strategyId,
    sessionId: ctx.sessionId,
    correlationId: ctx.correlationId,
    intendedAction: signal.action,
    intendedSymbol: signal.ticker,
    intendedQty: signal.quantity ?? 1,
    intendedOrderType: signal.orderType ?? "market",
    intendedLimitPrice: signal.price ?? null,
    intendedStopPrice: signal.stopPrice ?? null,
  });

  // ── Dispatch to broker ─────────────────────────────────────────────────────
  let brokerResult;

  try {
    brokerResult = await routeOrder(ctx.accountId, signal, ctx.correlationId ?? null);
  } catch (routeErr) {
    // routeOrder resolves (never throws) per broker-router contract, but
    // defense-in-depth: treat an unexpected throw as a routing failure.
    logger.error(
      { err: routeErr, ctx, signal },
      "server-mediated-executor: routeOrder threw unexpectedly — treating as routing failure",
    );
    if (orderId) {
      await updateOrderToNeedsReconcile({
        orderId,
        reason: routeErr instanceof Error ? routeErr.message : "route_threw_unexpectedly",
        correlationId: ctx.correlationId,
      });
    }
    await writeRoutingAudit(
      auditAction.failure,
      ctx,
      { ...meta, signal_action: signal.action, ticker: signal.ticker },
      {
        error: routeErr instanceof Error ? routeErr.message : String(routeErr),
        needsReconcile: true,
        note: "routeOrder threw unexpectedly — Phase 1 fill-reconciliation required",
      },
      "needs_reconcile",
    );
    return { routed: false, reason: "route_threw", needsReconcile: true };
  }

  if (brokerResult.success) {
    logger.info(
      {
        ctx: { sessionId: ctx.sessionId, strategyId: ctx.strategyId, lifecycleState: ctx.lifecycleState },
        signal,
        brokerType: brokerResult.brokerType,
        reason: brokerResult.reason,
      },
      "server-mediated-executor: order routed successfully",
    );
    if (orderId) {
      await updateOrderToAcked({ orderId, brokerResult, correlationId: ctx.correlationId });
    }
    await writeRoutingAudit(
      auditAction.success,
      ctx,
      { ...meta, signal_action: signal.action, ticker: signal.ticker },
      {
        success: true,
        reason: brokerResult.reason,
        brokerType: brokerResult.brokerType,
        statusCode: brokerResult.statusCode,
      },
      "success",
    );
    return { routed: true, needsReconcile: false };
  } else {
    // routeOrder returned success=false. Fail-CLOSED: write needs_reconcile audit.
    // Paper position state is unchanged — operator must verify live account manually.
    logger.error(
      {
        ctx: { sessionId: ctx.sessionId, strategyId: ctx.strategyId, lifecycleState: ctx.lifecycleState },
        signal,
        reason: brokerResult.reason,
        error: brokerResult.error,
      },
      "server-mediated-executor: routeOrder returned failure — needs_reconcile (Phase 1 fill-sync required)",
    );
    if (orderId) {
      await updateOrderToNeedsReconcile({
        orderId,
        reason: brokerResult.reason ?? "route_returned_failure",
        correlationId: ctx.correlationId,
      });
    }
    await writeRoutingAudit(
      auditAction.failure,
      ctx,
      { ...meta, signal_action: signal.action, ticker: signal.ticker },
      {
        success: false,
        reason: brokerResult.reason,
        error: brokerResult.error,
        needsReconcile: true,
        note: "Phase 1 fill-reconciliation required — verify live broker account state manually",
      },
      "needs_reconcile",
    );
    return { routed: false, reason: brokerResult.reason, needsReconcile: true };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Route a live entry order when the flag is ON and the strategy is DEPLOYED/PILOT.
 *
 * Called AFTER the full gate stack in paper-signal-service.ts has passed and
 * paper-execution-service.ts has opened the paper position. This call is
 * fire-and-forget from the caller's perspective — errors are isolated.
 *
 * @param params.ctx           Live execution context
 * @param params.symbol        Futures symbol (e.g. "MES", "MNQ")
 * @param params.side          "long" | "short"
 * @param params.quantity      Number of contracts to enter
 * @param params.barTimestamp  Optional ISO-8601 bar timestamp (for idempotency key)
 */
export async function routeLiveEntry(params: {
  ctx: LiveExecutionContext;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  barTimestamp?: string;
}): Promise<RoutingOutcome> {
  const { ctx, symbol, side, quantity, barTimestamp } = params;

  const skipReason = checkRoutingGuard(ctx);
  if (skipReason) {
    if (skipReason === "shadow_state_blocked") {
      // Write audit for SHADOW blocks so operators can confirm the invariant held
      await writeRoutingAudit(
        "server_mediated.shadow_blocked",
        ctx,
        { symbol, side, quantity, guard: "entry" },
        { blocked: true, reason: skipReason },
        "blocked",
      );
    }
    return { routed: false, reason: skipReason };
  }

  // ── Phase 1: Fail-CLOSED reconciliation gate ──────────────────────────────
  // If the account has any open needs_reconcile orders, block new entries.
  // Exits (TP1, TP2, flatten) are NOT blocked — you must always be able to
  // close a position even when reconciliation is pending.
  const blocked = await isAccountBlockedForReconcile(ctx.accountId, ctx.correlationId);
  if (blocked) {
    return { routed: false, reason: "account_needs_reconcile_block", needsReconcile: true };
  }

  const signal: WebhookSignal = {
    action: side === "long" ? "enter_long" : "enter_short",
    ticker: symbol,
    quantity,
    orderType: "market",
    strategyId: ctx.strategyId,
    barTimestamp,
  };

  return dispatchRouteOrder(
    ctx,
    signal,
    {
      success: "server_mediated.order_routed",
      failure: "server_mediated.order_routing_failed",
    },
    { symbol, side, quantity, guardedBy: "openPosition_post_gate_stack" },
  );
}

/**
 * Route a live partial exit order for TP1 or TP2.
 *
 * Called AFTER paper-execution-service.ts has applied the TP1/TP2 partial close
 * to the paper position. The paper contracts are already reduced.
 *
 * @param params.exitType      "TP1" | "TP2" (for audit label)
 * @param params.quantity      Contracts to close (pre-computed by exit handler)
 * @param params.price         Optional limit price for the exit
 */
export async function routeLiveExitPartial(params: {
  ctx: LiveExecutionContext;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  exitType: "TP1" | "TP2";
  price?: number;
  barTimestamp?: string;
}): Promise<RoutingOutcome> {
  const { ctx, symbol, side, quantity, exitType, price, barTimestamp } = params;

  const skipReason = checkRoutingGuard(ctx);
  if (skipReason) {
    if (skipReason === "shadow_state_blocked") {
      await writeRoutingAudit(
        "server_mediated.shadow_blocked",
        ctx,
        { symbol, side, quantity, exitType, guard: `exit_${exitType}` },
        { blocked: true, reason: skipReason },
        "blocked",
      );
    }
    return { routed: false, reason: skipReason };
  }

  const signal: WebhookSignal = {
    action: side === "long" ? "exit_long" : "exit_short",
    ticker: symbol,
    quantity,
    orderType: price != null ? "limit" : "market",
    price,
    strategyId: ctx.strategyId,
    barTimestamp,
  };

  return dispatchRouteOrder(
    ctx,
    signal,
    {
      success: "server_mediated.exit_routed",
      failure: "server_mediated.exit_routing_failed",
    },
    { symbol, side, quantity, exitType },
  );
}

/**
 * Route a stop-modification order for BE move or trail tighten.
 *
 * NOTE: TradersPost does not natively support cancel-replace of an existing stop.
 * Phase 0 sends a new stop order at the updated price. Phase 1 will handle
 * proper cancel-replace sequencing via fill reconciliation.
 *
 * @param params.modifyType    "BE_MOVE" | "TRAIL" (for audit label)
 * @param params.newStopPrice  The new stop price level
 */
export async function routeLiveExitModify(params: {
  ctx: LiveExecutionContext;
  symbol: string;
  side: "long" | "short";
  newStopPrice: number;
  modifyType: "BE_MOVE" | "TRAIL";
  barTimestamp?: string;
}): Promise<RoutingOutcome> {
  const { ctx, symbol, side, newStopPrice, modifyType, barTimestamp } = params;

  const skipReason = checkRoutingGuard(ctx);
  if (skipReason) {
    if (skipReason === "shadow_state_blocked") {
      await writeRoutingAudit(
        "server_mediated.shadow_blocked",
        ctx,
        { symbol, side, newStopPrice, modifyType, guard: `modify_${modifyType}` },
        { blocked: true, reason: skipReason },
        "blocked",
      );
    }
    return { routed: false, reason: skipReason };
  }

  const signal: WebhookSignal = {
    action: side === "long" ? "exit_long" : "exit_short",
    ticker: symbol,
    orderType: "stop",
    stopPrice: newStopPrice,
    strategyId: ctx.strategyId,
    barTimestamp,
  };

  return dispatchRouteOrder(
    ctx,
    signal,
    {
      success: "server_mediated.exit_routed",
      failure: "server_mediated.exit_routing_failed",
    },
    { symbol, side, newStopPrice, modifyType },
  );
}

/**
 * Route a full-position flatten (15:55 ET time-stop or DLL force-close).
 *
 * Called AFTER paper-execution-service.ts has closed the paper position.
 * Exits the full remaining quantity in the live account.
 *
 * @param params.flattenReason "TIME_STOP_1555" | "DLL_FORCE_CLOSE" | other (audit label)
 * @param params.quantity      Full remaining contracts to flatten
 */
export async function routeLiveFlatten(params: {
  ctx: LiveExecutionContext;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  flattenReason: string;
  barTimestamp?: string;
}): Promise<RoutingOutcome> {
  const { ctx, symbol, side, quantity, flattenReason, barTimestamp } = params;

  const skipReason = checkRoutingGuard(ctx);
  if (skipReason) {
    if (skipReason === "shadow_state_blocked") {
      await writeRoutingAudit(
        "server_mediated.shadow_blocked",
        ctx,
        { symbol, side, quantity, flattenReason, guard: "flatten" },
        { blocked: true, reason: skipReason },
        "blocked",
      );
    }
    return { routed: false, reason: skipReason };
  }

  const signal: WebhookSignal = {
    action: side === "long" ? "exit_long" : "exit_short",
    ticker: symbol,
    quantity,
    orderType: "market",
    strategyId: ctx.strategyId,
    barTimestamp,
  };

  return dispatchRouteOrder(
    ctx,
    signal,
    {
      success: "server_mediated.exit_routed",
      failure: "server_mediated.exit_routing_failed",
    },
    { symbol, side, quantity, flattenReason },
  );
}
