export enum TopstepXOrderSide {
  Bid = 0,
  Ask = 1,
}

export enum TopstepXOrderType {
  Limit = 1,
  Market = 2,
  StopLimit = 3,
  Stop = 4,
  TrailingStop = 5,
  JoinBid = 6,
  JoinAsk = 7,
}

export enum TopstepXOrderStatus {
  None = 0,
  Open = 1,
  Filled = 2,
  Cancelled = 3,
  Expired = 4,
  Rejected = 5,
  Pending = 6,
}

export enum TopstepXPositionType {
  Undefined = 0,
  Long = 1,
  Short = 2,
}

export interface TopstepXPlaceOrderRequest {
  accountId: number;
  contractId: string;
  type: TopstepXOrderType;
  side: TopstepXOrderSide;
  size: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  trailPrice?: number | null;
  customTag?: string | null;
  stopLossBracket?: { ticks: number; type: TopstepXOrderType } | null;
  takeProfitBracket?: { ticks: number; type: TopstepXOrderType } | null;
}

export interface TopstepXPlaceOrderResult {
  success: boolean;
  orderId?: number;
  errorCode: number;
  errorMessage: string | null;
  duplicate: boolean;
}

export interface TopstepXOrder extends TopstepXPlaceOrderRequest {
  id: number;
  creationTimestamp: string;
  updateTimestamp: string;
  status: TopstepXOrderStatus;
  fillVolume: number;
  filledPrice: number | null;
}

export interface TopstepXTrade {
  id: number;
  accountId: number;
  contractId: string;
  creationTimestamp: string;
  price: number;
  profitAndLoss: number | null;
  fees: number;
  side: TopstepXOrderSide;
  size: number;
  voided: boolean;
  orderId: number;
}

export interface TopstepXPosition {
  id: number;
  accountId: number;
  contractId: string;
  creationTimestamp: string;
  type: TopstepXPositionType;
  size: number;
  averagePrice: number;
}
