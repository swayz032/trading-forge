import { describe, expect, it } from "vitest";
import {
  TopstepXOfflineAdapter,
  reconcileTopstepXPosition,
} from "../offline-adapter.js";
import { TopstepXOrderSide, TopstepXOrderStatus, TopstepXOrderType } from "../types.js";

const ACCOUNT_ID = 465;
const CONTRACT_ID = "CON.F.US.EP.U25";

function marketOrder(customTag: string) {
  return {
    accountId: ACCOUNT_ID,
    contractId: CONTRACT_ID,
    type: TopstepXOrderType.Market,
    side: TopstepXOrderSide.Bid,
    size: 2,
    customTag,
  };
}

describe("TopstepXOfflineAdapter", () => {
  it("deduplicates order retries by the account-scoped customTag", () => {
    const adapter = new TopstepXOfflineAdapter();

    const first = adapter.placeOrder(marketOrder("tf-order-001"));
    const retry = adapter.placeOrder(marketOrder("tf-order-001"));

    expect(first).toEqual({ success: true, orderId: 1, errorCode: 0, errorMessage: null, duplicate: false });
    expect(retry).toEqual({ ...first, duplicate: true });
    expect(adapter.searchOrders(ACCOUNT_ID)).toHaveLength(1);
  });

  it("rejects a conflicting payload that reuses a customTag", () => {
    const adapter = new TopstepXOfflineAdapter();
    adapter.placeOrder(marketOrder("tf-order-002"));

    const conflict = adapter.placeOrder({ ...marketOrder("tf-order-002"), size: 3 });

    expect(conflict.success).toBe(false);
    expect(conflict.errorMessage).toBe("custom_tag_payload_conflict");
    expect(adapter.searchOrders(ACCOUNT_ID)).toHaveLength(1);
  });

  it("ingests fills once and converges the position after duplicate replay", () => {
    const adapter = new TopstepXOfflineAdapter();
    const placed = adapter.placeOrder(marketOrder("tf-order-003"));
    const trade = {
      id: 9001,
      accountId: ACCOUNT_ID,
      contractId: CONTRACT_ID,
      creationTimestamp: "2026-08-14T15:00:00.000Z",
      price: 6400.25,
      profitAndLoss: null,
      fees: 1.4,
      side: TopstepXOrderSide.Bid,
      size: 2,
      voided: false,
      orderId: placed.orderId!,
    };

    expect(adapter.ingestTrade(trade)).toEqual({ applied: true, duplicate: false });
    expect(adapter.ingestTrade(trade)).toEqual({ applied: false, duplicate: true });
    expect(adapter.searchOrders(ACCOUNT_ID)[0]).toMatchObject({
      status: TopstepXOrderStatus.Filled,
      fillVolume: 2,
      filledPrice: 6400.25,
    });
    expect(adapter.searchOpenPositions(ACCOUNT_ID)).toEqual([
      expect.objectContaining({ contractId: CONTRACT_ID, type: 1, size: 2, averagePrice: 6400.25 }),
    ]);
  });

  it("rebuilds the same state when reconnect trade events arrive out of order", () => {
    const adapter = new TopstepXOfflineAdapter();
    const buy = adapter.placeOrder(marketOrder("tf-order-004"));
    const sell = adapter.placeOrder({ ...marketOrder("tf-order-005"), side: TopstepXOrderSide.Ask, size: 1 });
    const events = [
      { id: 9102, accountId: ACCOUNT_ID, contractId: CONTRACT_ID, creationTimestamp: "2026-08-14T15:02:00.000Z", price: 6401, profitAndLoss: 2.5, fees: 1.4, side: TopstepXOrderSide.Ask, size: 1, voided: false, orderId: sell.orderId! },
      { id: 9101, accountId: ACCOUNT_ID, contractId: CONTRACT_ID, creationTimestamp: "2026-08-14T15:01:00.000Z", price: 6400, profitAndLoss: null, fees: 1.4, side: TopstepXOrderSide.Bid, size: 2, voided: false, orderId: buy.orderId! },
    ];

    adapter.replayTrades(events);

    expect(adapter.searchOpenPositions(ACCOUNT_ID)).toEqual([
      expect.objectContaining({ type: 1, size: 1, averagePrice: 6400 }),
    ]);
    expect(adapter.searchTrades(ACCOUNT_ID).map((trade) => trade.id)).toEqual([9101, 9102]);
  });

  it("flatten cancels open orders and closes every open position", () => {
    const adapter = new TopstepXOfflineAdapter();
    const filled = adapter.placeOrder(marketOrder("tf-order-006"));
    adapter.placeOrder({ ...marketOrder("tf-order-007"), type: TopstepXOrderType.Limit, limitPrice: 6399 });
    adapter.ingestTrade({ id: 9201, accountId: ACCOUNT_ID, contractId: CONTRACT_ID, creationTimestamp: "2026-08-14T15:03:00.000Z", price: 6400, profitAndLoss: null, fees: 1.4, side: TopstepXOrderSide.Bid, size: 2, voided: false, orderId: filled.orderId! });

    const result = adapter.flattenAccount(ACCOUNT_ID);

    expect(result).toEqual({ cancelledOrderIds: [2], closedContractIds: [CONTRACT_ID] });
    expect(adapter.searchOpenOrders(ACCOUNT_ID)).toEqual([]);
    expect(adapter.searchOpenPositions(ACCOUNT_ID)).toEqual([]);
  });
});

describe("reconcileTopstepXPosition", () => {
  it("reports exact, quantity drift, price drift, and missing broker position", () => {
    expect(reconcileTopstepXPosition({ qty: 2, avgPrice: 6400.25 }, { qty: 2, avgPrice: 6400.25 })).toEqual({ status: "exact" });
    expect(reconcileTopstepXPosition({ qty: 2, avgPrice: 6400.25 }, { qty: 1, avgPrice: 6400.25 })).toMatchObject({ status: "drift", reason: "quantity_mismatch" });
    expect(reconcileTopstepXPosition({ qty: 2, avgPrice: 6400.25 }, { qty: 2, avgPrice: 6400.5 }, 0.24)).toMatchObject({ status: "drift", reason: "price_mismatch" });
    expect(reconcileTopstepXPosition({ qty: 2, avgPrice: 6400.25 }, null)).toMatchObject({ status: "drift", reason: "broker_position_missing" });
  });
});
