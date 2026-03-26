# Paper Trading Auto-Pilot — Design

**Date:** 2026-03-17
**Status:** APPROVED

## Goal

Winning strategies (TIER_1/2/3) auto-deploy to paper trading. The system evaluates signals on live data, executes trades with realistic slippage, tracks P&L, and broadcasts to the dashboard in real-time. The trader monitors — the system trades.

## What Already Exists

| Component | Status |
|-----------|--------|
| Frontend page (PaperTrading.tsx) | Built — KPIs, equity curve, positions, trades |
| API routes (13 endpoints) | Built — full CRUD + analytics |
| Execution service | Built — slippage modeling for 8 contracts |
| DB schema (3 tables) | Built — sessions, positions, trades |
| React Query hooks | Built — all CRUD operations |
| Massive WebSocket | Built — connects, subscribes, streams bars |
| SSE broadcasts | Built — integrated into execution service |

## What's Missing (4 Components)

### 1. Price Stream Service (`paper-trading-stream.ts`)

Bridges Massive WebSocket to the paper engine.

- On session start: connect Massive WS for that symbol
- On each bar: mark-to-market all open positions + evaluate strategy signals
- On session stop: disconnect WS
- Shared connections: one WS per unique symbol across sessions
- Reconnect handling: use Massive's built-in exponential backoff

### 2. Signal Evaluator (`paper-signal-service.ts`)

Runs strategy logic on live data to generate entry/exit signals.

- Maintains a rolling window of recent bars per symbol (enough for indicators)
- Computes indicators (same functions as backtester)
- Evaluates entry/exit expressions or runs class-based strategy.compute()
- Session filter: only fires during strategy's `preferred_sessions`
- Cooldown: no re-entry within N bars after an exit (configurable, default 4 bars)
- Returns: `{ signal: "entry_long" | "exit" | "hold", price, reason }`

### 3. Risk Gate (`paper-risk-gate.ts`)

Pre-trade validation before every position open.

- Max contracts per symbol (from prop firm config if set)
- Session drawdown limit: stop trading if session loss > configurable threshold (default $2,000)
- Max concurrent positions per session (default 1)
- Daily loss limit across all sessions
- Returns: `{ allowed: boolean, reason?: string }`

### 4. Real-time Frontend Updates

Enhance existing PaperTrading.tsx with live SSE.

- Subscribe to SSE events: `paper:position-opened`, `paper:trade`, `paper:pnl`
- Update React Query cache on SSE events (no polling needed)
- Signal log: show every signal evaluated (taken, skipped with reason)
- Execution quality panel: avg slippage vs backtest assumptions

## Data Flow

```
Massive WS bar arrives
  → paper-trading-stream receives bar
  → updatePositionPrices(sessionId, {symbol: bar.close})  [mark-to-market]
  → paper-signal-service.evaluate(strategy, recentBars)
    → if entry signal:
        paper-risk-gate.check(session, symbol, contracts)
          → if allowed: openPosition(session, symbol, side, price, contracts)
          → if denied: log reason to signal_log
    → if exit signal or stop-loss:
        closePosition(position, price)
  → SSE broadcast to all connected frontends
```

## Strategy Auto-Promotion

When a backtest completes with TIER_1/2/3:
1. Strategy lifecycle → "PAPER"
2. Paper session auto-created
3. Stream service connects and starts evaluating
4. Trader gets notification (Discord + dashboard alert)

## Session Configuration

Each strategy's config gains:
```json
{
  "preferred_sessions": ["NY_RTH"],  // or ["London", "NY_RTH"], ["Asia"]
  "max_concurrent_positions": 1,
  "cooldown_bars": 4,
  "daily_loss_limit": 2000,
  "max_contracts": null  // null = use prop firm cap
}
```

Default: NY RTH only, 1 position, 4-bar cooldown, $2K daily loss limit.

## NOT Building (YAGNI)

- No live broker integration
- No ML regime detection (use backtest's preferred_regime tag)
- No multi-account simulation
- No custom order types (market orders with slippage model)
- No bracket orders (stop-loss checked on each bar, not as resting order)

## Implementation Order

1. Price Stream Service (Massive → paper engine bridge)
2. Signal Evaluator (indicator computation + signal generation on live bars)
3. Risk Gate (pre-trade checks)
4. Auto-promotion (backtest TIER → paper session)
5. Frontend SSE integration (live updates)
6. Signal log table + UI
