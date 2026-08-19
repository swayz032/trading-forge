# Golden Fixture — MNQU2026 Duplicate TP Shelf + Entry Confirmation — 2026-08-10

Status: USER-VISUAL SEMANTIC FIXTURE / RESEARCH ONLY

## Screenshot context

- Platform: TradingView
- Instrument: MNQU2026
- Execution chart: 5 minute
- Visible macro state: `📉 BIG DIRECTION = DOWN`
- Visible current move: `📉 DOWN WITH DIRECTION`
- Active plan: `🔴 SHORT`
- Short Entry Zone: approximately `29,719.00`

## TP correction

The reviewed v0.17.2 panel showed approximately:

- TP1 = `29,694.75`
- TP2 = `29,678.50`
- TP3 = `29,643.25`

Operator ruling:

- TP1 and TP2 are two descriptions/parts of the **same physical reaction shelf** and must not consume two TP numbers.
- The old TP3 around `29,643.25` should promote to **TP2** after same-shelf deduplication.
- The engine must continue searching deeper history for a genuinely separate **TP3**.
- Cross-timeframe target-price spacing alone is insufficient. Final ordering must preserve each candidate reaction zone's LOW/HIGH bounds and require the next candidate's entire zone to sit beyond the prior selected zone plus the calibrated shelf-fusion/separation allowance.

## Entry-confirmation wording correction

The same screenshot showed `CANDLE SETUP = REJECTION` before price had broken the active Short Entry Zone. This wording is rejected because it can be mistaken for a trade signal.

New UI contract:

- Row name: `🕯️ ENTRY CONFIRMATION`
- Before price engages/breaks the active Entry Zone: `NOT ACTIVE YET`
- While price is interacting with the Entry Zone but has not confirmed: `👀 WATCHING CANDLES`
- After a valid proof close: `✅ ENTRY BREAK CONFIRMED`
- Strong directional engulf may display `⚡ BULLISH/BEARISH ENGULF CONFIRMED` only when relevant to the active Entry Zone sequence.
- Fully qualified candle/momentum lane: `✅ MOMENTUM CONFIRMED`
- Final standard state: `✅ PASSED`

`NOW` must use explicit trader language, including:

- `⏳ WAIT FOR PRICE TO BREAK LONG ENTRY`
- `⏳ WAIT FOR PRICE TO BREAK SHORT ENTRY`
- `⏳ WAIT FOR NEXT CANDLE BREAK`
- `⚡ BREAK CONFIRMED — CHECK MOMENTUM`
- `⚡ MOMENTUM BUILDING`
- `✅ LONG ENTRY READY`
- `✅ SHORT ENTRY READY`

A random rejection/doji/engulf candle away from the active Entry Zone may still be measured internally for research, but it must not be surfaced in the beginner panel as an actionable setup.
