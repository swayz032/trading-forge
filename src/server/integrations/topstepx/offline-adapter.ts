import {
  TopstepXOrderSide,
  TopstepXOrderStatus,
  TopstepXOrderType,
  TopstepXPositionType,
  type TopstepXOrder,
  type TopstepXPlaceOrderRequest,
  type TopstepXPlaceOrderResult,
  type TopstepXPosition,
  type TopstepXTrade,
} from "./types.js";

type TradeIngestResult = { applied: boolean; duplicate: boolean; error?: string };

function positionKey(accountId: number, contractId: string): string {
  return `${accountId}:${contractId}`;
}

function orderFingerprint(request: TopstepXPlaceOrderRequest): string {
  return JSON.stringify({
    accountId: request.accountId,
    contractId: request.contractId,
    type: request.type,
    side: request.side,
    size: request.size,
    limitPrice: request.limitPrice ?? null,
    stopPrice: request.stopPrice ?? null,
    trailPrice: request.trailPrice ?? null,
    stopLossBracket: request.stopLossBracket ?? null,
    takeProfitBracket: request.takeProfitBracket ?? null,
  });
}

function validateOrder(request: TopstepXPlaceOrderRequest): string | null {
  if (!Number.isSafeInteger(request.accountId) || request.accountId <= 0) return "invalid_account_id";
  if (!request.contractId.trim()) return "invalid_contract_id";
  if (!Number.isSafeInteger(request.size) || request.size <= 0) return "invalid_order_size";
  if (request.type === TopstepXOrderType.Limit && !Number.isFinite(request.limitPrice)) return "limit_price_required";
  if (request.type === TopstepXOrderType.Stop && !Number.isFinite(request.stopPrice)) return "stop_price_required";
  return null;
}

export class TopstepXOfflineAdapter {
  private nextOrderId = 1;
  private nextPositionId = 1;
  private readonly orders = new Map<number, TopstepXOrder>();
  private readonly trades = new Map<number, TopstepXTrade>();
  private readonly positions = new Map<string, TopstepXPosition>();
  private readonly customTags = new Map<string, { orderId: number; fingerprint: string }>();

  placeOrder(request: TopstepXPlaceOrderRequest): TopstepXPlaceOrderResult {
    const validationError = validateOrder(request);
    if (validationError) {
      return { success: false, errorCode: 1, errorMessage: validationError, duplicate: false };
    }

    const tagKey = request.customTag ? `${request.accountId}:${request.customTag}` : null;
    const fingerprint = orderFingerprint(request);
    if (tagKey) {
      const existing = this.customTags.get(tagKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return { success: false, errorCode: 2, errorMessage: "custom_tag_payload_conflict", duplicate: true };
        }
        return { success: true, orderId: existing.orderId, errorCode: 0, errorMessage: null, duplicate: true };
      }
    }

    const id = this.nextOrderId++;
    const now = new Date().toISOString();
    const order: TopstepXOrder = {
      ...request,
      customTag: request.customTag ?? null,
      limitPrice: request.limitPrice ?? null,
      stopPrice: request.stopPrice ?? null,
      trailPrice: request.trailPrice ?? null,
      stopLossBracket: request.stopLossBracket ?? null,
      takeProfitBracket: request.takeProfitBracket ?? null,
      id,
      creationTimestamp: now,
      updateTimestamp: now,
      status: TopstepXOrderStatus.Open,
      fillVolume: 0,
      filledPrice: null,
    };
    this.orders.set(id, order);
    if (tagKey) this.customTags.set(tagKey, { orderId: id, fingerprint });
    return { success: true, orderId: id, errorCode: 0, errorMessage: null, duplicate: false };
  }

  cancelOrder(accountId: number, orderId: number): boolean {
    const order = this.orders.get(orderId);
    if (!order || order.accountId !== accountId || order.status !== TopstepXOrderStatus.Open) return false;
    order.status = TopstepXOrderStatus.Cancelled;
    order.updateTimestamp = new Date().toISOString();
    return true;
  }

  ingestTrade(trade: TopstepXTrade): TradeIngestResult {
    if (this.trades.has(trade.id)) return { applied: false, duplicate: true };
    if (trade.voided) return { applied: false, duplicate: false, error: "voided_trade" };
    if (!Number.isSafeInteger(trade.size) || trade.size <= 0 || !Number.isFinite(trade.price)) {
      return { applied: false, duplicate: false, error: "invalid_trade" };
    }
    const order = this.orders.get(trade.orderId);
    if (!order || order.accountId !== trade.accountId || order.contractId !== trade.contractId) {
      return { applied: false, duplicate: false, error: "order_mismatch" };
    }
    if (order.fillVolume + trade.size > order.size) {
      return { applied: false, duplicate: false, error: "overfill_rejected" };
    }

    const previousVolume = order.fillVolume;
    order.fillVolume += trade.size;
    order.filledPrice = previousVolume === 0
      ? trade.price
      : ((order.filledPrice ?? 0) * previousVolume + trade.price * trade.size) / order.fillVolume;
    order.status = order.fillVolume === order.size ? TopstepXOrderStatus.Filled : TopstepXOrderStatus.Open;
    order.updateTimestamp = trade.creationTimestamp;
    this.trades.set(trade.id, { ...trade });
    this.applyPositionDelta(trade);
    return { applied: true, duplicate: false };
  }

  replayTrades(trades: readonly TopstepXTrade[]): TradeIngestResult[] {
    return [...trades]
      .sort((a, b) => a.creationTimestamp.localeCompare(b.creationTimestamp) || a.id - b.id)
      .map((trade) => this.ingestTrade(trade));
  }

  private applyPositionDelta(trade: TopstepXTrade): void {
    const key = positionKey(trade.accountId, trade.contractId);
    const current = this.positions.get(key);
    const currentSigned = current
      ? current.size * (current.type === TopstepXPositionType.Long ? 1 : -1)
      : 0;
    const delta = trade.size * (trade.side === TopstepXOrderSide.Bid ? 1 : -1);
    const nextSigned = currentSigned + delta;
    if (nextSigned === 0) {
      this.positions.delete(key);
      return;
    }

    const sameDirection = currentSigned === 0 || Math.sign(currentSigned) === Math.sign(delta);
    const flipped = currentSigned !== 0 && Math.sign(currentSigned) !== Math.sign(nextSigned);
    let averagePrice = current?.averagePrice ?? trade.price;
    if (sameDirection) {
      averagePrice = currentSigned === 0
        ? trade.price
        : (Math.abs(currentSigned) * averagePrice + Math.abs(delta) * trade.price) / Math.abs(nextSigned);
    } else if (flipped) {
      averagePrice = trade.price;
    }

    this.positions.set(key, {
      id: current?.id ?? this.nextPositionId++,
      accountId: trade.accountId,
      contractId: trade.contractId,
      creationTimestamp: current?.creationTimestamp ?? trade.creationTimestamp,
      type: nextSigned > 0 ? TopstepXPositionType.Long : TopstepXPositionType.Short,
      size: Math.abs(nextSigned),
      averagePrice,
    });
  }

  searchOrders(accountId: number): TopstepXOrder[] {
    return [...this.orders.values()].filter((order) => order.accountId === accountId).sort((a, b) => a.id - b.id).map((order) => ({ ...order }));
  }

  searchOpenOrders(accountId: number): TopstepXOrder[] {
    return this.searchOrders(accountId).filter((order) => order.status === TopstepXOrderStatus.Open);
  }

  searchTrades(accountId: number): TopstepXTrade[] {
    return [...this.trades.values()].filter((trade) => trade.accountId === accountId).sort((a, b) => a.creationTimestamp.localeCompare(b.creationTimestamp) || a.id - b.id).map((trade) => ({ ...trade }));
  }

  searchOpenPositions(accountId: number): TopstepXPosition[] {
    return [...this.positions.values()].filter((position) => position.accountId === accountId).sort((a, b) => a.contractId.localeCompare(b.contractId)).map((position) => ({ ...position }));
  }

  flattenAccount(accountId: number): { cancelledOrderIds: number[]; closedContractIds: string[] } {
    const cancelledOrderIds = this.searchOpenOrders(accountId).map((order) => order.id);
    for (const orderId of cancelledOrderIds) this.cancelOrder(accountId, orderId);
    const closedContractIds = this.searchOpenPositions(accountId).map((position) => position.contractId);
    for (const contractId of closedContractIds) this.positions.delete(positionKey(accountId, contractId));
    return { cancelledOrderIds, closedContractIds };
  }
}

export type PositionReconciliation =
  | { status: "exact" }
  | { status: "drift"; reason: "quantity_mismatch" | "price_mismatch" | "broker_position_missing"; serverQty: number; serverAvgPrice: number; brokerQty: number | null; brokerAvgPrice: number | null };

export function reconcileTopstepXPosition(
  server: { qty: number; avgPrice: number },
  broker: { qty: number; avgPrice: number } | null,
  priceTolerance = 0,
): PositionReconciliation {
  if (!broker) {
    return { status: "drift", reason: "broker_position_missing", serverQty: server.qty, serverAvgPrice: server.avgPrice, brokerQty: null, brokerAvgPrice: null };
  }
  if (server.qty !== broker.qty) {
    return { status: "drift", reason: "quantity_mismatch", serverQty: server.qty, serverAvgPrice: server.avgPrice, brokerQty: broker.qty, brokerAvgPrice: broker.avgPrice };
  }
  if (Math.abs(server.avgPrice - broker.avgPrice) > priceTolerance) {
    return { status: "drift", reason: "price_mismatch", serverQty: server.qty, serverAvgPrice: server.avgPrice, brokerQty: broker.qty, brokerAvgPrice: broker.avgPrice };
  }
  return { status: "exact" };
}
