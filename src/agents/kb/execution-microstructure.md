# Execution Microstructure — Trading Forge KB Card

> **Loaded by:** `trade_critique` (via `critique-knowledge-retriever.ts`). The retriever injects the ONE `## SYMBOL:` section matching the trade's symbol, so the `fill` attribution dimension can be judged against a real per-symbol benchmark instead of a generic guess.
> **Purpose:** Institutional benchmarks for fill quality, slippage tolerance, liquidity depth, and futures contract specifics per symbol. Grounds the `fill` dimension (`kb/attribution-methodology.md` KEY: fill).
> **Section-key convention:** each symbol is headed `## SYMBOL: <sym>` (lowercase). Keys: `mes`, `mnq`, `mcl`.
> **Authority:** Contract specs are canonical (CME + `src/shared/firm-config.ts` CONTRACT_SPECS use MICRO point values). Slippage/liquidity bands are operator-configurable heuristics grounded in the 2026 sweep-buffer recal + firm rules.
> **Last updated:** 2026-07-05.

---

## How the `fill` dimension uses this card

The critique compares realized `position.slippage` against the **expected ATR-scaled slippage** for the symbol + session, and checks `position.fill_probability` against the 0.80 floor. Slippage is a function of volatility + session, NEVER a constant (CLAUDE.md §13 Data). A fill inside the per-symbol tolerance band with fill_probability ≥ 0.80 is clean → low `fill` weight. A fill materially outside the band, or in a thin-liquidity window, earns `fill` weight and a `what_to_watch` note.

**Slippage sign convention:** positive slippage = worse-than-mid fill (paid up on entry / gave up on exit). MFFU mandates a MINIMUM 2-tick MES slippage in simulation — zero-slippage fills are a compliance red flag, not a good fill (`kb/prop-firm-rules-summary.md`).

---

## SYMBOL: mes

**Contract.** Micro E-mini S&P 500. Tick size **0.25 pt**; tick value **$1.25**; point value **$5.00** (CONTRACT_SPECS micro).

**Slippage benchmark.** Typical clean fill 1-2 ticks ($1.25-$2.50) in RTH liquid windows; MFFU simulation floor is 2 ticks. >3 ticks in RTH is elevated; expect wider around 9:30-9:35 ET and news. Stop buffer canonical **3 ticks / 0.75 pt** (`STOP_BUFFER_TICKS_MES=3`) — 1 tick sits INSIDE the empirical sweep zone.

**Liquidity depth.** 200-500 contracts typical at touch; liquidity comfort cap **100** (3× headroom). Deep enough that base-size (9 MES) fills are effectively frictionless in RTH.

**Session liquidity windows (ET).** Best: RTH 09:30-11:30 + PM 13:30-15:30 (PM = ~35% of HODs). AVOID: lunch dead zone 11:30-13:30 (>60% false-breakout rate — HARD blackout). Killzones: NY_AM 10:00-11:00, NY_PM 14:00-15:00, Silver Bullet windows. Overnight ETH is thin — widen slippage expectation.

**Commission.** Topstep MES/MNQ $0.62/side; MFFU Builder MES/MNQ $0.95/side
(per `src/shared/firm-stage-rules.json`).

## SYMBOL: mnq

**Contract.** Micro E-mini Nasdaq-100. Tick size **0.25 pt**; tick value **$0.50**; point value **$2.00** (CONTRACT_SPECS micro).

**Slippage benchmark.** MNQ is faster and noisier than MES — clean fill 1-3 ticks; expect more slip on momentum bursts. Stop buffer canonical **5 ticks / 1.25 pt** (`STOP_BUFFER_TICKS_MNQ=5`) — wider than MES because MNQ sweeps run deeper. >4 ticks slippage in RTH is elevated.

**Liquidity depth.** 50-150 contracts at touch; liquidity comfort cap **50** (prevents eating the entire book). Thinner relative depth than MES — size discipline matters more.

**Session liquidity windows (ET).** Same RTH structure as MES (NASDAQ-correlated). Best RTH 09:30-11:30 + PM 13:30-15:30; lunch blackout 11:30-13:30. MNQ leads on tech-driven momentum days — higher intra-window volatility, size the fill expectation up.

**Commission.** Topstep MES/MNQ $0.62/side; MFFU Builder MES/MNQ $0.95/side.

**Compliance note.** MNQ + NQ simultaneously = same underlying = MFFU hedging-ban violation (`kb/prop-firm-rules-summary.md`).

## SYMBOL: mcl

**Contract.** Micro WTI Crude Oil. Tick size **0.01 pt** ($1/barrel × 100 barrels micro-sized); tick value **$1.00**; point value **$100.00** (CONTRACT_SPECS micro). Ceiling stop is quoted in ticks: **100 ticks = 1.00 pt** (Wave 1 2026-06-27 recal).

**Slippage benchmark.** Crude is retail-flow-driven and gappy — 1-3 ticks clean in liquid windows, materially worse around EIA. Stop buffer canonical **2 ticks / 0.02 pt** (`STOP_BUFFER_TICKS_MCL=2`). Expect elevated slippage on the Wednesday 10:30 ET inventory release.

**Liquidity depth.** 20-80 contracts at touch (retail flow); liquidity comfort cap **30** — the thinnest of the three; 1-2 tick slippage on size is common. Book depth degrades fast outside RTH.

**Session liquidity windows (ET).** Best around RTH crude pit hours + the EIA window aftermath. AVOID entries in the ±15 min EIA release window (Wed 10:30 ET) unless `bypass_news_blackout`. Overnight crude is thin and headline-sensitive (geopolitics move it first).

**Commission.** Topstep MES/MNQ $0.62/side; MFFU Builder MES/MNQ $0.95/side.

**Confluence note.** For MCL, `internals_aligned` (stock breadth) is zeroed and its weight redistributes to `cross_asset_aligned` (DXY/yields) — crude follows the dollar and rates, not NYSE breadth (CLAUDE.md §2b MCL redistribution).

---

## Cross-symbol invariants

- Stop is structural with ATR bounds, NEVER fixed-point: floor 1.5×ATR (+6pt MES min), ceiling 14pt MES / 62pt MNQ / 100 ticks MCL. Skip the trade if structural distance > ceiling (CLAUDE.md §4).
- Use stop-LIMIT, never stop-market (§13 Execution).
- 15:55 ET hard flatten is an invariant across all symbols.
- Slippage is modeled as a function of volatility + session in the backtester — a fill that looks "too clean" for the session is as suspect as one that looks too slippy.

## Sources

- CME contract specs (MES / MNQ / MCL micro) — `src/shared/firm-config.ts` CONTRACT_SPECS.
- `kb/prop-firm-rules-summary.md` — commissions, MFFU 2-tick MES slippage floor, hedging ban.
- CLAUDE.md §4 (sweep-aware buffer table, stop ceilings, Wave 1 2026-06-27 recal), §2b (MCL confluence redistribution), §13 (lunch blackout evidence — Tradeify 13-yr dataset, TradingStats.net 12,095-day study).
- `src/engine/backtester.py` — session/volatility-dependent slippage model.
