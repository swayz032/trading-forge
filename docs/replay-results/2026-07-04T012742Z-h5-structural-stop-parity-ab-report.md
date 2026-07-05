# H5 Structural-Stop-Parity A/B Report (deep-scan #15, 2026-07-03)

Generated: 2026-07-04T012742Z
Symbol: MNQ
Trades synthesized: 171

## Isolation-harness caveat

This report isolates the STOP-MODEL delta on a synthetic-but-real-code-path
series (see script docstring). It is NOT a full production strategy backtest.
Use it to gauge re-baseline magnitude before re-running real historical
backtests with the flag toggled.

## Summary

- Trades with a DIFFERENT risk_points under the fix: 36 / 171 (21.1%)
- Total P&L (old ATR-clamp): $-1,885.32
- Total P&L (new structural): $-1,873.02
- Total P&L delta: $12.30
- Sharpe-like ratio (old): -6.5512
- Sharpe-like ratio (new): -6.6087
- Avg risk_points (old): 14.0
- Avg risk_points (new): 13.593
- Stop/trail exits (old): 154
- Stop/trail exits (new): 155

## Per-trade sample (first 20)

| # | dir | old risk_pts | new risk_pts | old basis | new basis | old exit | new exit | old P&L | new P&L | delta |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Short | 14.0 | 11.01 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -22.02 | 5.98 |
| 1 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 2 | Long | 14.0 | 14.0 | atr_fallback | structural | trailing_stop | trailing_stop | 0.5 | 0.5 | 0.0 |
| 3 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 4 | Short | 14.0 | 11.71 | atr_fallback | structural | trailing_stop | trailing_stop | 0.5 | 0.5 | 0.0 |
| 5 | Short | 14.0 | 14.0 | atr_fallback | structural | trailing_stop | trailing_stop | 0.5 | 0.5 | 0.0 |
| 6 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 7 | Long | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 8 | Long | 14.0 | 14.0 | atr_fallback | structural | trailing_stop | trailing_stop | 0.5 | 0.5 | 0.0 |
| 9 | Long | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 10 | Long | 14.0 | 13.53 | atr_fallback | structural | trailing_stop | trailing_stop | 0.5 | 0.5 | 0.0 |
| 11 | Long | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 12 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 13 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 14 | Short | 14.0 | 10.97 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -21.95 | 6.05 |
| 15 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 16 | Short | 14.0 | 10.55 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -21.1 | 6.9 |
| 17 | Short | 14.0 | 14.0 | atr_fallback | structural | take_profit | take_profit | 48.98 | 48.98 | 0.0 |
| 18 | Short | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
| 19 | Long | 14.0 | 14.0 | atr_fallback | structural | stop_loss | stop_loss | -28.0 | -28.0 | 0.0 |
