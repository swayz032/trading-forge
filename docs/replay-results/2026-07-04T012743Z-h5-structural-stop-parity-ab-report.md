# H5 Structural-Stop-Parity A/B Report (deep-scan #15, 2026-07-03)

Generated: 2026-07-04T012743Z
Symbol: MCL
Trades synthesized: 200

## Isolation-harness caveat

This report isolates the STOP-MODEL delta on a synthetic-but-real-code-path
series (see script docstring). It is NOT a full production strategy backtest.
Use it to gauge re-baseline magnitude before re-running real historical
backtests with the flag toggled.

## Summary

- Trades with a DIFFERENT risk_points under the fix: 197 / 200 (98.5%)
- Total P&L (old ATR-clamp): $-147.43
- Total P&L (new structural): $-616.86
- Total P&L delta: $-469.43
- Sharpe-like ratio (old): -0.4971
- Sharpe-like ratio (new): -2.3766
- Avg risk_points (old): 0.527
- Avg risk_points (new): 0.414
- Stop/trail exits (old): 2
- Stop/trail exits (new): 83

## Per-trade sample (first 20)

| # | dir | old risk_pts | new risk_pts | old basis | new basis | old exit | new exit | old P&L | new P&L | delta |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Short | 0.47 | 0.13 | atr_fallback | structural | signal | stop_loss | -3.86 | -13.39 | -9.53 |
| 1 | Short | 0.51 | 0.51 | atr_fallback | structural | signal | signal | -15.97 | -15.97 | 0.0 |
| 2 | Long | 0.52 | 0.23 | atr_fallback | structural | signal | signal | 1.69 | 1.69 | 0.0 |
| 3 | Short | 0.44 | 0.57 | atr_fallback | structural | signal | signal | 3.41 | 3.41 | 0.0 |
| 4 | Short | 0.62 | 0.14 | atr_fallback | structural | signal | trailing_stop | 13.77 | 1.0 | -12.77 |
| 5 | Short | 0.62 | 0.53 | atr_fallback | structural | signal | signal | 21.38 | 21.38 | 0.0 |
| 6 | Short | 0.54 | 0.28 | atr_fallback | structural | signal | stop_loss | 6.15 | -27.81 | -33.96 |
| 7 | Long | 0.61 | 0.64 | atr_fallback | structural | signal | signal | -30.5 | -30.5 | 0.0 |
| 8 | Long | 0.49 | 0.18 | atr_fallback | structural | signal | trailing_stop | -2.89 | 1.0 | 3.89 |
| 9 | Long | 0.48 | 0.53 | atr_fallback | structural | signal | signal | 18.82 | 18.82 | 0.0 |
| 10 | Long | 0.54 | 0.16 | atr_fallback | structural | signal | trailing_stop | -29.58 | 1.0 | 30.58 |
| 11 | Long | 0.56 | 0.77 | atr_fallback | structural | signal | signal | 8.31 | 8.31 | 0.0 |
| 12 | Long | 0.61 | 0.2 | atr_fallback | structural | signal | stop_loss | 4.71 | -19.71 | -24.42 |
| 13 | Short | 0.61 | 0.7 | atr_fallback | structural | signal | signal | -27.2 | -27.2 | 0.0 |
| 14 | Short | 0.52 | 0.23 | atr_fallback | structural | signal | signal | 7.71 | 7.71 | 0.0 |
| 15 | Short | 0.59 | 0.84 | atr_fallback | structural | signal | signal | -39.79 | -39.79 | 0.0 |
| 16 | Short | 0.53 | 0.13 | atr_fallback | structural | signal | stop_loss | -8.86 | -13.34 | -4.48 |
| 17 | Short | 0.61 | 0.49 | atr_fallback | structural | signal | signal | -13.6 | -13.6 | 0.0 |
| 18 | Short | 0.53 | 0.13 | atr_fallback | structural | signal | stop_loss | -23.19 | -12.85 | 10.34 |
| 19 | Short | 0.44 | 0.48 | atr_fallback | structural | take_profit | take_profit | 38.88 | 40.34 | 1.46 |
