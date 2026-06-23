/**
 * fill-reconciliation-service.ts — Phase 1 Fill Reconciliation
 *
 * FLAG-GATED: SERVER_MEDIATED_EXECUTION_ENABLED=true (DEFAULT OFF)
 *
 * This is Phase 1 of the server-mediated execution loop (Phase 0 = order routing,
 * Phase 1 = fill feedback + position sync). Phase 0 already lives in
 * server-mediated-executor.ts and broker-router.ts.
 *
 * What this module adds:
 *   1. Order-state persistence helpers (INSERT at routed, UPDATE on ack/fail).
 *   2. Fill ingestion logic (match fill event → order row → sync paper position).
 *   3. Drift detection (compare server position vs broker snapshot).
 *   4. Fail-CLOSED block gate (needs_reconcile account blocks new entries).
 *   5. Phase-4C hook into reconciliation-service.ts (populate real fill IDs).
 *   6. BrokerFillSource interface for TradersPost + TopstepX pluggability.
 *
 * ─── PARITY CONTRACT ────────────────────────────────────────────────────────
 * Fill reconciliation must NEVER alter the paper trading simulation layer.
 * It only adjusts the SERVER POSITION state (what the live broker holds) to
 * match what the broker actually filled. The paper simulation continues to
 * run its own fill model — paper and live are intentionally divergent after
 * Phase 1 (slippage, partial fills, rejections are live-only phenomena).
 *
 * Paper journal events (paper_positions, paper_trades) are NEVER mutated by
 * fill reconciliation. The fill data updates:
 *   - server_mediated_orders.{status, filled_qty, filled_avg_price, broker_fill_id}
 *   - production_trades.{tradovate_fill_id, actual_pnl} (Phase-4C hooks)
 *   - audit_log rows for every fill event
 *
 * ─── FAIL-CLOSED INVARIANTS ─────────────────────────────────────────────────
 *   - Unmatched fill → mark order needs_reconcile + alert
 *   - Drift beyond tolerance → mark account needs_reconcile + alert
 *   - needs_reconcile account → BLOCK new server-mediated entries
 *   - Duplicate broker_fill_id → no-op (idempotent, return duplicate_skipped)
 *   - Fill ingestion with flag OFF → no-op (return flag_disabled)
 *
 * ─── AUDIT ACTIONS ──────────────────────────────────────────────────────────
 *   fill_reconciliation.order_persisted        — new order row at 'routed'
 *   fill_reconciliation.order_acked            — TradersPost ack received
 *   fill_reconciliation.order_routing_failed   — routing failure → needs_reconcile
 *   fill_reconciliation.fill_ingested          — fill callback matched + position synced
 *   fill_reconciliation.duplicate_skipped      — re-ingested broker_fill_id (no-op)
 *   fill_reconciliation.unmatched_fill         — fill callback with no matching order row
 *   fill_reconciliation.partial_fill_accumulated — partial fill appended to existing
 *   fill_reconciliation.drift_detected         — server position vs broker snapshot diverges
 *   fill_reconciliation.needs_reconcile_cleared — account cleared from needs_reconcile
 *   fill_reconciliation.entry_blocked_needs_reconcile — entry blocked due to open recon
 */

import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverMediatedOrders, auditLog, productionTrades } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { isServerMediatedExecutionEnabled } from "./server-mediated-executor.js";
import { notifyCritical } from "./notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";
import type { BrokerResult } from "./broker-router.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Drift tolerance: if the server's recorded filled_qty differs from the
 * broker-reported position by more than this absolute number of contracts,
 * the account is flagged as needs_reconcile.
 */
export const DRIFT_TOLERANCE_CONTRACTS = Number(
  process.env.FILL_RECON_DRIFT_TOLERANCE_CONTRACTS ?? 1,
);

/**
 * Drift tolerance for price: if the filled_avg_price differs from the
 * broker-reported price by more than this many points, flag drift.
 */
export const DRIFT_TOLERANCE_PRICE_POINTS = Number(
  process.env.FILL_RECON_DRIFT_TOLERANCE_PRICE_POINTS ?? 2,
);

// ─── Order lifecycle status enum ──────────────────────────────────────────────

export type OrderStatus =
  | "routed"
  | "acked"
  | "filled"
  | "partially_filled"
  | "rejected"
  | "reconciled"
  | "needs_reconcile";

// ─── BrokerFillSource interface ───────────────────────────────────────────────

/**
 * BrokerFillSource — abstraction over fill-event delivery mechanisms.
 *
 * TradersPost implementation: inbound webhook (POST /api/broker/fill-callback)
 * TopstepX implementation: REST polling / WebSocket (STUB — not yet built)
 *
 * Both produce a normalized FillEvent that fill-reconciliation-service can process
 * without knowing the underlying transport.
 */
export interface FillEvent {
  /**
   * Broker-side order reference from the original ack response.
   * Primary match key. May be absent for some broker integrations.
   */
  broker_order_ref?: string | null;

  /**
   * Bar-scoped idempotency key computed by broker-router at order time.
   * Secondary match key when broker_order_ref is not present.
   */
  idempotency_key?: string | null;

  /** Futures symbol (e.g. "MES", "MES1!") */
  symbol: string;

  /** Number of contracts actually filled in this event (partial or full) */
  filled_qty: number;

  /** Average fill price for this event */
  filled_avg_price: number;

  /**
   * Status from the broker:
   *   "filled"           — fully executed
   *   "partially_filled" — partial execution; more fill events may follow
   *   "rejected"         — order rejected by broker (not filled)
   *   "cancelled"        — cancelled before fill
   */
  status: "filled" | "partially_filled" | "rejected" | "cancelled";

  /**
   * Unique fill ID from the broker (Tradovate fill_id, TopstepX fill UUID, etc.)
   * Used for deduplication — re-ingesting the same fill is a no-op.
   */
  broker_fill_id?: string | null;

  /** Source broker integration that produced this fill event */
  source?: "traderspost" | "topstepx" | "unknown";

  /** Correlation ID from the original order dispatch (for traceability) */
  correlation_id?: string | null;
}

/**
 * BrokerFillSource — implemented per broker integration.
 *
 * TradersPost fill source = inbound webhook (fill-callback route).
 * TopstepX fill source = REST/WS pull (STUB, not yet built).
 */
export interface BrokerFillSource {
  readonly brokerType: "traderspost" | "topstepx";

  /**
   * Normalize a raw broker fill payload into a FillEvent.
   * Returns null when the payload should be ignored (e.g. non-fill status updates).
   */
  normalizeFillEvent(rawPayload: unknown): FillEvent | null;
}

// ─── TradersPost fill source implementation ───────────────────────────────────

/**
 * TradersPostFillSource normalizes the TradersPost fill callback payload.
 *
 * TradersPost sends status callbacks to a webhook URL we configure.
 * Shape: { orderId, status, symbol, filledQty, avgFillPrice, fillId, ... }
 *
 * NOTE: The exact TradersPost callback schema is not yet known (end-to-end
 * validation requires a live feed). This implementation covers the documented
 * fields. Schema may need adjustment at go-live — this is the "requires live
 * broker feed" gap documented in the Phase 1 summary.
 */
export class TradersPostFillSource implements BrokerFillSource {
  readonly brokerType = "traderspost" as const;

  normalizeFillEvent(rawPayload: unknown): FillEvent | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;
    const p = rawPayload as Record<string, unknown>;

    // TradersPost may send non-fill status updates (pending, open, etc.) — ignore them
    const status = String(p["status"] ?? "").toLowerCase();
    if (!["filled", "partially_filled", "partial_fill", "partially-filled", "rejected", "cancelled"].includes(status)) {
      return null;
    }

    // Normalize status to our internal enum
    let normalizedStatus: FillEvent["status"] = "filled";
    if (status.startsWith("partial")) normalizedStatus = "partially_filled";
    else if (status === "rejected") normalizedStatus = "rejected";
    else if (status === "cancelled") normalizedStatus = "cancelled";

    return {
      broker_order_ref: p["orderId"] != null ? String(p["orderId"]) : null,
      idempotency_key: p["idempotency_key"] != null ? String(p["idempotency_key"]) : null,
      symbol: String(p["symbol"] ?? ""),
      filled_qty: Number(p["filledQty"] ?? p["filled_qty"] ?? 0),
      filled_avg_price: Number(p["avgFillPrice"] ?? p["avg_fill_price"] ?? 0),
      status: normalizedStatus,
      broker_fill_id: p["fillId"] != null ? String(p["fillId"]) : null,
      source: "traderspost",
      correlation_id: p["correlation_id"] != null ? String(p["correlation_id"]) : null,
    };
  }
}

// ─── TopstepX fill source stub ────────────────────────────────────────────────

/**
 * TopstepXFillSource — stub implementation for future TopstepX REST/WS fill feed.
 *
 * TopstepX exposes order fill events via their WebSocket stream or REST polling.
 * When the operator opens a Topstep account with TopstepX API access ($14.50/mo
 * via TopstepX subscription), this stub should be replaced with a real implementation
 * that polls `GET /v1/orders/{orderId}/fills` or subscribes to the WS fill stream.
 *
 * See: src/server/integrations/topstepx/STUB.md
 */
export class TopstepXFillSource implements BrokerFillSource {
  readonly brokerType = "topstepx" as const;

  normalizeFillEvent(_rawPayload: unknown): FillEvent | null {
    // STUB: TopstepX fill feed not yet implemented.
    // When the operator opens a TopstepX account, implement REST polling or WS
    // subscription here. The FillEvent interface above is the target shape.
    logger.warn(
      "fill-reconciliation: TopstepXFillSource.normalizeFillEvent() called — STUB, returning null",
    );
    return null;
  }
}

// ─── Singleton fill sources ───────────────────────────────────────────────────

export const FILL_SOURCES: Record<string, BrokerFillSource> = {
  traderspost: new TradersPostFillSource(),
  topstepx: new TopstepXFillSource(),
};

// ─── Result types ─────────────────────────────────────────────────────────────

export type FillIngestResult =
  | { outcome: "flag_disabled" }
  | { outcome: "duplicate_skipped"; orderId: string }
  | { outcome: "unmatched_fill"; fillEvent: FillEvent }
  | { outcome: "fill_ingested"; orderId: string; newStatus: OrderStatus }
  | { outcome: "partial_fill_accumulated"; orderId: string; filledQty: number; intendedQty: number }
  | { outcome: "fill_error"; error: string };

export interface DriftCheckResult {
  driftDetected: boolean;
  accountId: string;
  reason?: string;
  serverQty?: number;
  brokerQty?: number;
  serverPrice?: number;
  brokerPrice?: number;
}

// ─── Audit write helper ───────────────────────────────────────────────────────

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
      entityType: "server_mediated_order",
      entityId: null,
      decisionAuthority: "system",
      input: input as Record<string, unknown>,
      result: result as Record<string, unknown>,
      status,
      correlationId: correlationId ?? null,
    });
  } catch (auditErr) {
    logger.error(
      { auditErr, action },
      "fill-reconciliation: audit write failed (non-blocking)",
    );
  }
}

// ─── Order persistence helpers ────────────────────────────────────────────────

/**
 * Persist a new order row at status='routed' when server-mediated-executor
 * dispatches an order. Called BEFORE routeOrder() returns.
 *
 * Uses ON CONFLICT DO NOTHING on idempotency_key so retries are safe.
 */
export async function persistOrderAtRouted(params: {
  idempotencyKey: string;
  accountId: string;
  strategyId: string;
  sessionId: string;
  correlationId?: string | null;
  intendedAction: string;
  intendedSymbol: string;
  intendedQty: number;
  intendedOrderType: string;
  intendedLimitPrice?: number | null;
  intendedStopPrice?: number | null;
}): Promise<string | null> {
  if (!isServerMediatedExecutionEnabled()) return null;

  try {
    const id = randomUUID();
    await db.insert(serverMediatedOrders).values({
      id,
      idempotencyKey: params.idempotencyKey,
      accountId: params.accountId,
      strategyId: params.strategyId,
      sessionId: params.sessionId,
      correlationId: params.correlationId ?? null,
      intendedAction: params.intendedAction,
      intendedSymbol: params.intendedSymbol,
      intendedQty: params.intendedQty,
      intendedOrderType: params.intendedOrderType,
      intendedLimitPrice: params.intendedLimitPrice != null ? String(params.intendedLimitPrice) : null,
      intendedStopPrice: params.intendedStopPrice != null ? String(params.intendedStopPrice) : null,
      status: "routed",
    }).onConflictDoNothing({ target: serverMediatedOrders.idempotencyKey });

    // Fetch the actual id (may differ if conflict occurred and existing row was kept)
    const existing = await db
      .select({ id: serverMediatedOrders.id })
      .from(serverMediatedOrders)
      .where(eq(serverMediatedOrders.idempotencyKey, params.idempotencyKey))
      .limit(1);

    const orderId = existing[0]?.id ?? id;

    await writeAudit(
      "fill_reconciliation.order_persisted",
      { idempotencyKey: params.idempotencyKey, accountId: params.accountId, intendedAction: params.intendedAction },
      { orderId, status: "routed" },
      "success",
      params.correlationId,
    );

    return orderId;
  } catch (err) {
    logger.error(
      { err, idempotencyKey: params.idempotencyKey },
      "fill-reconciliation: persistOrderAtRouted failed (non-blocking — order proceeds)",
    );
    return null;
  }
}

/**
 * Update order row to 'acked' when routeOrder() returns success,
 * capturing the broker_order_ref from the TradersPost responseBody if present.
 */
export async function updateOrderToAcked(params: {
  orderId: string;
  brokerResult: BrokerResult;
  correlationId?: string | null;
}): Promise<void> {
  if (!isServerMediatedExecutionEnabled()) return;

  try {
    // Extract broker_order_ref from responseBody if TradersPost included one
    const responseBody = params.brokerResult.responseBody as Record<string, unknown> | null | undefined;
    const brokerOrderRef =
      responseBody?.["orderId"] != null ? String(responseBody["orderId"]) :
      responseBody?.["order_id"] != null ? String(responseBody["order_id"]) :
      null;

    await db
      .update(serverMediatedOrders)
      .set({
        status: "acked",
        brokerOrderRef: brokerOrderRef ?? undefined,
        brokerResponse: params.brokerResult.responseBody as Record<string, unknown> | null | undefined ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(serverMediatedOrders.id, params.orderId));

    await writeAudit(
      "fill_reconciliation.order_acked",
      { orderId: params.orderId, brokerOrderRef },
      { status: "acked" },
      "success",
      params.correlationId,
    );
  } catch (err) {
    logger.error(
      { err, orderId: params.orderId },
      "fill-reconciliation: updateOrderToAcked failed (non-blocking)",
    );
  }
}

/**
 * Update order row to 'needs_reconcile' when routeOrder() returns failure.
 */
export async function updateOrderToNeedsReconcile(params: {
  orderId: string;
  reason: string;
  correlationId?: string | null;
}): Promise<void> {
  if (!isServerMediatedExecutionEnabled()) return;

  try {
    await db
      .update(serverMediatedOrders)
      .set({
        status: "needs_reconcile",
        updatedAt: new Date(),
      })
      .where(eq(serverMediatedOrders.id, params.orderId));

    await writeAudit(
      "fill_reconciliation.order_routing_failed",
      { orderId: params.orderId, reason: params.reason },
      { status: "needs_reconcile", needsReconcile: true },
      "failure",
      params.correlationId,
    );
  } catch (err) {
    logger.error(
      { err, orderId: params.orderId },
      "fill-reconciliation: updateOrderToNeedsReconcile failed (non-blocking)",
    );
  }
}

// ─── Fill ingestion ───────────────────────────────────────────────────────────

/**
 * ingestFillEvent — the core Phase 1 fill-reconciliation function.
 *
 * Matches a fill event to a server_mediated_orders row, updates the order
 * status and fill quantities, and emits audit events.
 *
 * Idempotent: re-ingesting the same broker_fill_id is a no-op.
 * Partial-fill aware: accumulates filled_qty across multiple fill events.
 *
 * DOES NOT modify paper_positions or paper_trades — those are simulation-only.
 *
 * Returns a FillIngestResult describing what happened.
 */
export async function ingestFillEvent(
  fillEvent: FillEvent,
  correlationId?: string | null,
): Promise<FillIngestResult> {
  if (!isServerMediatedExecutionEnabled()) {
    return { outcome: "flag_disabled" };
  }

  const effectiveCorrelationId = correlationId ?? fillEvent.correlation_id ?? randomUUID();

  // ── Dedup check: same broker_fill_id must only be processed once ──────────
  if (fillEvent.broker_fill_id) {
    try {
      const existing = await db
        .select({ id: serverMediatedOrders.id, status: serverMediatedOrders.status })
        .from(serverMediatedOrders)
        .where(eq(serverMediatedOrders.brokerFillId, fillEvent.broker_fill_id))
        .limit(1);

      if (existing.length > 0) {
        logger.info(
          { broker_fill_id: fillEvent.broker_fill_id, orderId: existing[0].id },
          "fill-reconciliation: duplicate broker_fill_id — skipping (idempotent)",
        );
        await writeAudit(
          "fill_reconciliation.duplicate_skipped",
          { broker_fill_id: fillEvent.broker_fill_id },
          { orderId: existing[0].id, currentStatus: existing[0].status },
          "success",
          effectiveCorrelationId,
        );
        return { outcome: "duplicate_skipped", orderId: existing[0].id };
      }
    } catch (err) {
      logger.error({ err }, "fill-reconciliation: dedup check failed — proceeding conservatively");
    }
  }

  // ── Match fill to order row ───────────────────────────────────────────────
  let orderRow: typeof serverMediatedOrders.$inferSelect | undefined;

  // Try broker_order_ref first (most specific)
  if (fillEvent.broker_order_ref) {
    try {
      const rows = await db
        .select()
        .from(serverMediatedOrders)
        .where(eq(serverMediatedOrders.brokerOrderRef, fillEvent.broker_order_ref))
        .limit(1);
      orderRow = rows[0];
    } catch (err) {
      logger.error({ err, broker_order_ref: fillEvent.broker_order_ref }, "fill-reconciliation: broker_order_ref lookup failed");
    }
  }

  // Fallback: match by idempotency_key
  if (!orderRow && fillEvent.idempotency_key) {
    try {
      const rows = await db
        .select()
        .from(serverMediatedOrders)
        .where(eq(serverMediatedOrders.idempotencyKey, fillEvent.idempotency_key))
        .limit(1);
      orderRow = rows[0];
    } catch (err) {
      logger.error({ err, idempotency_key: fillEvent.idempotency_key }, "fill-reconciliation: idempotency_key lookup failed");
    }
  }

  // Unmatched fill — cannot reconcile without an order row
  if (!orderRow) {
    logger.error(
      {
        broker_order_ref: fillEvent.broker_order_ref,
        idempotency_key: fillEvent.idempotency_key,
        symbol: fillEvent.symbol,
        status: fillEvent.status,
      },
      "fill-reconciliation: UNMATCHED FILL — no order row found (needs_reconcile)",
    );

    await writeAudit(
      "fill_reconciliation.unmatched_fill",
      {
        broker_order_ref: fillEvent.broker_order_ref,
        idempotency_key: fillEvent.idempotency_key,
        symbol: fillEvent.symbol,
        filled_qty: fillEvent.filled_qty,
        broker_fill_id: fillEvent.broker_fill_id,
      },
      { matched: false, action: "needs_reconcile" },
      "failure",
      effectiveCorrelationId,
    );

    // Discord critical — unmatched fill may mean position drift in the live account
    notifyCritical(
      "Unmatched Fill Event",
      appendFamilyGradePostscript(
        `Received a broker fill callback that could not be matched to any server-mediated order row. ` +
        `Symbol: ${fillEvent.symbol}, qty: ${fillEvent.filled_qty}, status: ${fillEvent.status}. ` +
        `Broker order ref: ${fillEvent.broker_order_ref ?? "none"}, idempotency key: ${fillEvent.idempotency_key ?? "none"}. ` +
        `Manual reconciliation required — verify live broker account state.`,
        "An unexpected fill arrived from the broker with no matching order on file.",
        "Tell Tony: 'Unmatched fill — check the live account.' If you cannot reach him, do nothing and wait.",
      ),
      { fillEvent, correlationId: effectiveCorrelationId },
    );

    broadcastSSE("fill_reconciliation:unmatched_fill", {
      symbol: fillEvent.symbol,
      filled_qty: fillEvent.filled_qty,
      broker_order_ref: fillEvent.broker_order_ref,
      correlationId: effectiveCorrelationId,
    });

    return { outcome: "unmatched_fill", fillEvent };
  }

  // ── Compute new state ──────────────────────────────────────────────────────
  const newFilledQty = orderRow.filledQty + fillEvent.filled_qty;
  const isPartial = fillEvent.status === "partially_filled" || newFilledQty < orderRow.intendedQty;
  const isFull = fillEvent.status === "filled" && newFilledQty >= orderRow.intendedQty;
  const isRejected = fillEvent.status === "rejected" || fillEvent.status === "cancelled";

  let newStatus: OrderStatus;
  if (isRejected) {
    newStatus = "rejected";
  } else if (isFull) {
    newStatus = "filled";
  } else {
    newStatus = "partially_filled";
  }

  // Compute weighted avg price across fill events
  let newAvgPrice: number;
  if (orderRow.filledQty === 0) {
    newAvgPrice = fillEvent.filled_avg_price;
  } else {
    const prevPrice = Number(orderRow.filledAvgPrice ?? 0);
    const prevQty = orderRow.filledQty;
    newAvgPrice = ((prevPrice * prevQty) + (fillEvent.filled_avg_price * fillEvent.filled_qty)) / newFilledQty;
  }

  // Append raw fill event to fill_events JSONB array
  const currentFillEvents = Array.isArray(orderRow.fillEvents) ? orderRow.fillEvents : [];
  const updatedFillEvents = [
    ...currentFillEvents,
    {
      ...fillEvent,
      received_at: new Date().toISOString(),
      correlation_id: effectiveCorrelationId,
    },
  ];

  // ── Update order row ───────────────────────────────────────────────────────
  try {
    await db
      .update(serverMediatedOrders)
      .set({
        status: newStatus,
        filledQty: newFilledQty,
        filledAvgPrice: String(newAvgPrice),
        brokerFillId: fillEvent.broker_fill_id ?? orderRow.brokerFillId ?? undefined,
        fillEvents: updatedFillEvents as Record<string, unknown>[],
        filledAt: newStatus === "filled" ? new Date() : orderRow.filledAt,
        updatedAt: new Date(),
      })
      .where(eq(serverMediatedOrders.id, orderRow.id));
  } catch (err) {
    logger.error(
      { err, orderId: orderRow.id },
      "fill-reconciliation: order row update failed",
    );
    return { outcome: "fill_error", error: err instanceof Error ? err.message : String(err) };
  }

  // ── Phase-4C hook: populate production_trades fill IDs ────────────────────
  // When a fill is confirmed, update production_trades with the real broker fill ID
  // so the daily reconciliation can compare actual fills vs expected.
  // This closes the "tradovate_fill_id" gap in reconciliation-service.ts.
  if (fillEvent.broker_fill_id && orderRow.correlationId) {
    try {
      await db
        .update(productionTrades)
        .set({
          tradovateFillId: fillEvent.broker_fill_id,
          // actual_pnl would be computed from filled_avg_price vs entry — left for future Phase
        })
        .where(eq(productionTrades.correlationId, orderRow.correlationId));
    } catch (err) {
      // Non-blocking — daily recon will still detect the mismatch
      logger.warn(
        { err, correlationId: orderRow.correlationId },
        "fill-reconciliation: production_trades phase-4C update failed (non-blocking)",
      );
    }
  }

  // ── Audit + SSE ───────────────────────────────────────────────────────────
  const auditAction = isPartial
    ? "fill_reconciliation.partial_fill_accumulated"
    : "fill_reconciliation.fill_ingested";

  await writeAudit(
    auditAction,
    {
      orderId: orderRow.id,
      broker_fill_id: fillEvent.broker_fill_id,
      filled_qty: fillEvent.filled_qty,
      filled_avg_price: fillEvent.filled_avg_price,
    },
    {
      newStatus,
      newFilledQty,
      newAvgPrice,
      intendedQty: orderRow.intendedQty,
    },
    "success",
    effectiveCorrelationId,
  );

  broadcastSSE("fill_reconciliation:fill_ingested", {
    orderId: orderRow.id,
    newStatus,
    newFilledQty,
    intendedQty: orderRow.intendedQty,
    correlationId: effectiveCorrelationId,
  });

  logger.info(
    {
      orderId: orderRow.id,
      newStatus,
      newFilledQty,
      intendedQty: orderRow.intendedQty,
      newAvgPrice,
    },
    "fill-reconciliation: fill ingested",
  );

  if (isPartial) {
    return {
      outcome: "partial_fill_accumulated",
      orderId: orderRow.id,
      filledQty: newFilledQty,
      intendedQty: orderRow.intendedQty,
    };
  }

  return { outcome: "fill_ingested", orderId: orderRow.id, newStatus };
}

// ─── Drift detection ──────────────────────────────────────────────────────────

/**
 * checkPositionDrift — compare server's order state vs a broker position snapshot.
 *
 * A "broker position snapshot" is what the broker currently holds for a given
 * account + symbol. The server_mediated_orders table records what the server
 * INTENDED to fill and what fill confirmations were received.
 *
 * If the broker-reported qty or price diverges beyond tolerance, mark the
 * account as needs_reconcile and emit a Discord critical.
 *
 * Parameters:
 *   accountId          — broker_accounts.account_id
 *   symbol             — futures symbol
 *   brokerPositionQty  — contracts broker reports holding (0 = flat)
 *   brokerAvgPrice     — broker's average cost basis (null if flat)
 *
 * NOTE: The broker position snapshot source is NOT yet wired for real live data
 * (this requires TopstepX REST or MFFU Playwright extraction). Until go-live,
 * the cron calling this function can pass values from the Playwright dashboard
 * snapshot or from a reconciliation-service.ts MFFU snapshot.
 *
 * The function is structured so that when the snapshot source is available, it
 * can be called from:
 *   a) a cron job (periodic drift detection)
 *   b) a webhook callback (real-time drift on every fill)
 */
export async function checkPositionDrift(params: {
  accountId: string;
  symbol: string;
  brokerPositionQty: number;
  brokerAvgPrice: number | null;
  correlationId?: string | null;
}): Promise<DriftCheckResult> {
  if (!isServerMediatedExecutionEnabled()) {
    return { driftDetected: false, accountId: params.accountId, reason: "flag_disabled" };
  }

  const effectiveCorrelationId = params.correlationId ?? randomUUID();

  // Sum the server's latest filled_qty for active (non-needs_reconcile) orders
  // for this account + symbol that are in a filled or partially_filled state.
  const serverRows = await db
    .select({
      filledQty: serverMediatedOrders.filledQty,
      filledAvgPrice: serverMediatedOrders.filledAvgPrice,
      intendedAction: serverMediatedOrders.intendedAction,
      status: serverMediatedOrders.status,
    })
    .from(serverMediatedOrders)
    .where(
      and(
        eq(serverMediatedOrders.accountId, params.accountId),
        eq(serverMediatedOrders.intendedSymbol, params.symbol),
        sql`status IN ('filled', 'partially_filled', 'acked')`,
      )
    );

  // Compute net server position (entries minus exits)
  let serverNetQty = 0;
  let serverWeightedPrice = 0;
  let serverQtyForPrice = 0;

  for (const row of serverRows) {
    const action = row.intendedAction;
    const qty = row.filledQty;
    const price = Number(row.filledAvgPrice ?? 0);

    if (action === "enter_long" || action === "enter_short") {
      serverNetQty += qty;
      if (qty > 0) {
        serverWeightedPrice = ((serverWeightedPrice * serverQtyForPrice) + (price * qty)) / (serverQtyForPrice + qty);
        serverQtyForPrice += qty;
      }
    } else if (action === "exit_long" || action === "exit_short") {
      serverNetQty -= qty;
    }
  }

  const qtyDrift = Math.abs(serverNetQty - params.brokerPositionQty);
  const priceDrift = params.brokerAvgPrice != null && serverQtyForPrice > 0
    ? Math.abs(serverWeightedPrice - params.brokerAvgPrice)
    : 0;

  const qtyDrifted = qtyDrift > DRIFT_TOLERANCE_CONTRACTS;
  const priceDrifted = priceDrift > DRIFT_TOLERANCE_PRICE_POINTS;
  const driftDetected = qtyDrifted || priceDrifted;

  if (!driftDetected) {
    return {
      driftDetected: false,
      accountId: params.accountId,
      serverQty: serverNetQty,
      brokerQty: params.brokerPositionQty,
      serverPrice: serverWeightedPrice,
      brokerPrice: params.brokerAvgPrice ?? undefined,
    };
  }

  // ── Drift detected: mark account needs_reconcile ──────────────────────────
  const driftReason =
    qtyDrifted
      ? `qty_drift: server=${serverNetQty} broker=${params.brokerPositionQty} (tolerance=${DRIFT_TOLERANCE_CONTRACTS})`
      : `price_drift: server=${serverWeightedPrice.toFixed(4)} broker=${params.brokerAvgPrice} (tolerance=${DRIFT_TOLERANCE_PRICE_POINTS}pt)`;

  logger.error(
    {
      accountId: params.accountId,
      symbol: params.symbol,
      serverNetQty,
      brokerQty: params.brokerPositionQty,
      qtyDrift,
      serverWeightedPrice,
      brokerAvgPrice: params.brokerAvgPrice,
      priceDrift,
    },
    "fill-reconciliation: DRIFT DETECTED — marking account needs_reconcile",
  );

  // Mark all acked/filled orders for this account as needs_reconcile
  await db
    .update(serverMediatedOrders)
    .set({ status: "needs_reconcile", updatedAt: new Date() })
    .where(
      and(
        eq(serverMediatedOrders.accountId, params.accountId),
        eq(serverMediatedOrders.intendedSymbol, params.symbol),
        sql`status IN ('acked', 'filled', 'partially_filled', 'routed')`,
      )
    );

  await writeAudit(
    "fill_reconciliation.drift_detected",
    {
      accountId: params.accountId,
      symbol: params.symbol,
      serverNetQty,
      brokerPositionQty: params.brokerPositionQty,
      qtyDrift,
      priceDrift,
      driftReason,
    },
    { driftDetected: true, action: "marked_needs_reconcile" },
    "failure",
    effectiveCorrelationId,
  );

  broadcastSSE("fill_reconciliation:drift_detected", {
    accountId: params.accountId,
    symbol: params.symbol,
    serverNetQty,
    brokerPositionQty: params.brokerPositionQty,
    driftReason,
    correlationId: effectiveCorrelationId,
  });

  notifyCritical(
    "Position Drift Detected",
    appendFamilyGradePostscript(
      `Position drift detected between server records and broker account. ` +
      `Account: ${params.accountId}, Symbol: ${params.symbol}. ` +
      `Server net qty: ${serverNetQty}, Broker qty: ${params.brokerPositionQty}. ` +
      `${driftReason}. New server-mediated entries for this account are BLOCKED until reconciled.`,
      "The bot's position records don't match what the broker shows.",
      "Tell Tony: 'Position drift on " + params.symbol + ".' If you cannot reach him, do not trade — the bot will block new orders automatically.",
    ),
    { accountId: params.accountId, symbol: params.symbol, driftReason, correlationId: effectiveCorrelationId },
  );

  return {
    driftDetected: true,
    accountId: params.accountId,
    reason: driftReason,
    serverQty: serverNetQty,
    brokerQty: params.brokerPositionQty,
    serverPrice: serverWeightedPrice,
    brokerPrice: params.brokerAvgPrice ?? undefined,
  };
}

// ─── Fail-CLOSED entry block gate ─────────────────────────────────────────────

/**
 * isAccountBlockedForReconcile — checks whether an account has any open
 * needs_reconcile orders, which blocks new server-mediated entries.
 *
 * Called by server-mediated-executor.ts BEFORE dispatching any new entry order.
 *
 * Fail-CLOSED: DB error → return true (block), emit audit, log error.
 * Flag OFF → return false (no block, no-op path).
 */
export async function isAccountBlockedForReconcile(
  accountId: string,
  correlationId?: string | null,
): Promise<boolean> {
  if (!isServerMediatedExecutionEnabled()) return false;

  try {
    const rows = await db
      .select({ id: serverMediatedOrders.id })
      .from(serverMediatedOrders)
      .where(
        and(
          eq(serverMediatedOrders.accountId, accountId),
          eq(serverMediatedOrders.status, "needs_reconcile"),
        )
      )
      .limit(1);

    const blocked = rows.length > 0;

    if (blocked) {
      logger.warn(
        { accountId, openNeedsReconcileOrderId: rows[0].id },
        "fill-reconciliation: account BLOCKED — open needs_reconcile order exists",
      );

      await writeAudit(
        "fill_reconciliation.entry_blocked_needs_reconcile",
        { accountId, openNeedsReconcileOrderId: rows[0].id },
        { blocked: true, reason: "open_needs_reconcile_order" },
        "blocked",
        correlationId,
      );
    }

    return blocked;
  } catch (err) {
    // Fail-CLOSED: DB error → block
    logger.error(
      { err, accountId },
      "fill-reconciliation: isAccountBlockedForReconcile DB error — fail-CLOSED, blocking entry",
    );
    await writeAudit(
      "fill_reconciliation.entry_blocked_needs_reconcile",
      { accountId, error: err instanceof Error ? err.message : String(err) },
      { blocked: true, reason: "db_error_fail_closed" },
      "failure",
      correlationId,
    );
    return true;
  }
}

/**
 * clearAccountReconcileBlock — admin action to clear needs_reconcile orders
 * for an account after manual verification. Updates all needs_reconcile orders
 * to 'reconciled' and emits a cleared audit row.
 *
 * Called from the HMAC admin endpoint that confirms reconciliation is resolved.
 */
export async function clearAccountReconcileBlock(
  accountId: string,
  resolvedBy: string,
  correlationId?: string | null,
): Promise<{ cleared: number }> {
  const result = await db
    .update(serverMediatedOrders)
    .set({ status: "reconciled", updatedAt: new Date() })
    .where(
      and(
        eq(serverMediatedOrders.accountId, accountId),
        eq(serverMediatedOrders.status, "needs_reconcile"),
      )
    )
    .returning({ id: serverMediatedOrders.id });

  const cleared = result.length;

  await writeAudit(
    "fill_reconciliation.needs_reconcile_cleared",
    { accountId, resolvedBy, cleared },
    { cleared, action: "set_to_reconciled" },
    "success",
    correlationId,
  );

  broadcastSSE("fill_reconciliation:reconcile_cleared", {
    accountId,
    cleared,
    resolvedBy,
    correlationId,
  });

  logger.info(
    { accountId, cleared, resolvedBy },
    "fill-reconciliation: needs_reconcile block cleared",
  );

  return { cleared };
}
