# H5 Structural-Stop-Parity A/B Report (deep-scan #15, 2026-07-03)

Generated: 2026-07-04T012741Z
Symbol: MES
Trades synthesized: 186

## Isolation-harness caveat

This report isolates the STOP-MODEL delta on a synthetic-but-real-code-path
series (see script docstring). It is NOT a full production strategy backtest.
Use it to gauge re-baseline magnitude before re-running real historical
backtests with the flag toggled.

## Summary

- Trades with a DIFFERENT risk_points under the fix: 186 / 186 (100.0%)
- Total P&L (old ATR-clamp): $-68.64
- Total P&L (new structural): $-494.26
- Total P&L delta: $-425.61
- Sharpe-like ratio (old): -0.2816
- Sharpe-like ratio (new): -2.2198
- Avg risk_points (old): 9.055
- Avg risk_points (new): 6.956
- Stop/trail exits (old): 2
- Stop/trail exits (new): 77

## Per-trade sample (first 20)

| # | dir | old risk_pts | new risk_pts | old basis | new basis | old exit | new exit | old P&L | new P&L | delta |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Short | 8.12 | 2.7 | atr_fallback | structural | signal | stop_loss | -3.31 | -13.51 | -10.2 |
| 1 | Short | 8.77 | 9.18 | atr_fallback | structural | signal | signal | -13.69 | -13.69 | 0.0 |
| 2 | Long | 8.98 | 4.4 | atr_fallback | structural | signal | signal | 1.45 | 1.45 | 0.0 |
| 3 | Short | 7.51 | 10.2 | atr_fallback | structural | signal | signal | 2.92 | 2.92 | 0.0 |
| 4 | Short | 10.57 | 2.84 | atr_fallback | structural | signal | trailing_stop | 11.8 | 1.25 | -10.55 |
| 5 | Short | 10.66 | 9.45 | atr_fallback | structural | signal | signal | 18.33 | 18.33 | 0.0 |
| 6 | Short | 9.33 | 5.18 | atr_fallback | structural | signal | stop_loss | 5.27 | -25.88 | -31.14 |
| 7 | Long | 10.41 | 11.41 | atr_fallback | structural | signal | signal | -26.14 | -26.14 | 0.0 |
| 8 | Long | 8.43 | 3.48 | atr_fallback | structural | signal | trailing_stop | -2.47 | 1.25 | 3.72 |
| 9 | Long | 8.28 | 9.48 | atr_fallback | structural | signal | signal | 16.13 | 16.13 | 0.0 |
| 10 | Long | 9.3 | 3.21 | atr_fallback | structural | signal | trailing_stop | -25.35 | 1.25 | 26.6 |
| 11 | Long | 9.65 | 13.58 | atr_fallback | structural | signal | signal | 7.12 | 7.12 | 0.0 |
| 12 | Long | 10.51 | 3.79 | atr_fallback | structural | signal | stop_loss | 4.04 | -18.93 | -22.97 |
| 13 | Short | 10.42 | 12.39 | atr_fallback | structural | signal | signal | -23.32 | -23.32 | 0.0 |
| 14 | Short | 8.92 | 4.4 | atr_fallback | structural | signal | signal | 6.61 | 6.61 | 0.0 |
| 15 | Short | 9.14 | 2.69 | atr_fallback | structural | signal | stop_loss | -7.6 | -13.47 | -5.88 |
| 16 | Short | 10.37 | 8.89 | atr_fallback | structural | signal | signal | -11.65 | -11.65 | 0.0 |
| 17 | Short | 9.11 | 2.61 | atr_fallback | structural | signal | stop_loss | -19.88 | -13.05 | 6.83 |
| 18 | Short | 7.5 | 8.67 | atr_fallback | structural | take_profit | signal | 33.33 | 31.27 | -2.05 |
| 19 | Short | 7.84 | 3.66 | atr_fallback | structural | take_profit | take_profit | 30.49 | 27.02 | -3.47 |
