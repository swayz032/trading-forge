# First live run — l-2 compiled strategy on real market data (2026-07-02)

The final leg of the compiler pipeline, executed and traced end-to-end: **Transcript → Decision Graph →
EngineStrategySpec → grounded evaluators → Ledger-E interpreter → real ratio-adjusted bars → trades → P&L**,
with **LEDGER G (execution traceability)** closing the explainability loop. GPT's report format.

## Specification

| field | value |
|---|---|
| transcript | l-2iKbcm5UI (ICT 4-confluence shorts — 100% captured / conserved / grounded) |
| spec hash | `db02f7f303e929fbdb525530fbdbf359e97f84fc888652498cd9f6437b9c41ad` |
| graph canonical hash | `c01170eaeb448863` · Ledger D: **CONSERVED** |
| spec shape | 31 entry conditions · 5 AND-groups · 0 OR-branches · 0 invalidations |
| data | ES `ratio_adj` daily (Databento cache), 2018-01 → 2026-02, 1983 bars — §13-compliant (the unadjusted top-level parquet was correctly REFUSED by the data-quality guard on the first attempt) |
| exits | **framework-v1 overlay** (labeled, NOT source logic): stop 1.5×ATR14 / TP 2R / 10-bar time-stop · 1 MES lot ($5/pt) · no commissions |

## Execution

| metric | value |
|---|---|
| bars evaluated | 1942 |
| armed setups | 13 |
| entries | 12 (1 armed while a position was open) |
| invalidation vetoes | 0 (spec has none) |
| blocked-reason histogram | bias_direction 2932 · liquidity 854 · price_action 63 · ict_zone 9 |

The dominant blocker is bearish-structure — correct behavior for a **short-only** confluence strategy across
mostly-bull years. Entries cluster in exactly the bearish regimes: 2020-09, 2021-09/12, 2022-02/03, 2023-03/10,
2024-01, 2025-02/11/12, 2026-02.

## Market outputs

| metric | value |
|---|---|
| trades | 12 (6W / 6L — win rate is an OBSERVED output, not a target) |
| total P&L | **+102.39 pts (+$511.95** @ 1 MES lot) |
| expectancy | +8.53 pts/trade |
| max drawdown | $1,271 |
| exit mix | stop / tp / time_stop all exercised |

**These numbers are NOT a promotion claim** — v1 grounding is family-granularity, exits are the simplified
framework-v1 overlay, n=12 is far below statistical significance, and none of the institutional gates
(WFE/PBO/DSR/B14) were run. The run validates the **chain**, not the edge.

## Ledger G — execution traceability: **TRACEABLE**

- Conditions with verified transcript provenance: **31/31** (every condition's span slices to real transcript text)
- Trades fully traceable: **12/12** — every trade's trace lists {condition id → grounded evaluator → the
  educator's verbatim words}.

Sample — trade 1, SHORT @ 3732.05 on 2020-09-29 (stopped, −97.7 pts; losses trace identically to wins):

| evaluator | educator's transcript words |
|---|---|
| bearish_structure | "We then understand market structure is bearish." / "So, again, what I see here is a 4-hour break of structure in towards the downside." |
| supply_zone_touch \| detect_weakness | "…for the market to retrace towards that 0." / "…waiting … for liquidity to get taken out." |
| bearish_engulfing \| rejection_upper | "…and then for a bearish candle's low that is most likely going to be your liquidity low…" |
| meta_state | "We have all the confluences, we've hit the 0." |

## Findings from the first run (fixed in-run, both executor-side — compiler untouched)

1. **"confluences met"** (process-meta condition) was unroutable → permanently blocked arming. Routed as
   `meta_state` (the conjunction of the independently-required confluences — no market content). Follow-up:
   add to compression GENERIC_DENY behind the usual n=8 gate.
2. **Ledger G checker was wrong-shaped** — the `evidence` field holds clause-id references; the SPAN is the
   ground truth (and slices perfectly). Checker now verifies span→transcript and quotes the slice.
3. Data guard worked as designed: first attempt on the unadjusted parquet was refused (§13).

## The evidence-backed statement this run earns (GPT's formulation)

> This backtest is executing the educator's source-owned strategy logic as compiled, with every execution
> decision traceable back to the original transcript and every transformation between transcript and execution
> independently verified (Ledgers A–G).

## Honest v1 limits → next refinements

Family-granularity grounding (same-family conditions share one boolean) · framework-v1 exits instead of the real
Style-C overlay · daily bars (sessions vacuous) · single symbol · n=12. The path to production-grade: per-condition
evaluators via the real engine primitives (structure_engine / liquidity_levels), the real framework overlay
(Style C 33/33/34 + structural stops), intraday TFs, then the full institutional gate battery.
