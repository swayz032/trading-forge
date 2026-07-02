# Futures Instruments — what Trading Forge trades (reference)

Trading Forge trades **micro futures** on CME/NYMEX. Micros are 1/10 the size of the
e-mini ("mini") contracts — same price, 1/10 the dollar risk per point. We trade micros
because they let the pyramid sizing scale smoothly and keep prop-firm drawdown survivable.

## The three core instruments

| Symbol | Name | Underlying | Tick | Tick $ | Point $ | Mini (10×) |
|---|---|---|---|---|---|---|
| **MES** | Micro E-mini S&P 500 | S&P 500 index | 0.25 pt | $1.25 | **$5 / pt** | ES ($50/pt) |
| **MNQ** | Micro E-mini Nasdaq-100 | Nasdaq-100 index | 0.25 pt | $0.50 | **$2 / pt** | NQ ($20/pt) |
| **MCL** | Micro WTI Crude Oil | WTI crude | 0.01 | $1.00 | **$100 / pt** | CL ($1000/pt) |

- "S&P 500 / ES" = MES underlying; "Nasdaq-100 / NQ" = MNQ underlying; "crude oil / CL" = MCL.
- A 14-point MES move = $70/contract. A 62-point MNQ move = $124/contract. A 1.00-point MCL
  move (100 ticks) = $100/contract. These match the framework stop ceilings (14 MES / 62 MNQ /
  1.00pt MCL) — a structural stop wider than the ceiling means SKIP the trade.
- **Mini→micro conversion is 10×:** a transcript saying "trade 3 ES" becomes "30 MES" — same
  dollar exposure. Never flip MES→ES (or micro→mini) without `contract_class="mini"` + mini
  specs, or you 10× silent risk.

## Sessions (ET) and why timing matters

- **Globex / electronic:** ~18:00 prior day → 17:00 ET (nearly 24h, Sun–Fri), 1h break.
- **RTH (regular/cash):** equities 09:30–16:00 ET; crude pit 09:00–14:30 ET.
- The bot is a **day-trader only** — flat by 15:55 ET hard time-stop; EOD trailing drawdown
  makes overnight holds incompatible with the prop accounts.

**Killzones (ICT-style windows the engine scores):** London, NY AM, NY PM, Silver Bullet
(~10:00–11:00 ET), Macro window. The 09:30–11:30 window is where most of the day's high/low
forms; the **11:30–13:30 lunch dead zone is a hard no-trade** (>60% false-breakout rate); PM
13:30–15:30 is a real structural window but runs on tapered size (EOD-DD risk).

## Microstructure notes the bot uses

- **Liquidity comfort caps:** MES 100 / MNQ 50 / MCL 30 contracts — book depth ceilings so the
  bot never eats the whole order book (crude is thinnest → tightest cap).
- **Stop buffers (sweep-aware):** MES 3 ticks (0.75pt) / MNQ 5 ticks (1.25pt) / MCL 2 ticks
  (0.02) — a 1-tick stop on MES sits inside the empirical sweep zone and gets hunted.
- **Crude follows DXY + yields, not NYSE breadth** — for MCL the `internals_aligned` confluence
  factor is zeroed and its weight moves to `cross_asset_aligned`.
- **Roll:** front-month futures roll quarterly (equity indices: Mar/Jun/Sep/Dec; crude monthly).
  Held-overnight positions pay a roll spread — itemized per symbol in backtests.
- **VIX margin expansion:** CME raises initial margin when VIX spikes (>30 halves max size, >50
  quarters) — the backtester models this so sizing that passes live doesn't get rejected.

## Why micros + horizontal scaling

The growth plan is mostly **horizontal** — multiple Topstep accounts + copy-trade at moderate
size — NOT maxing one account to the 50-micro cap. Minis (true ES/NQ/CL) are a FUTURE phase,
gated until a single funded balance ≥ $200K with an explicit `contract_class="mini"` declaration.
