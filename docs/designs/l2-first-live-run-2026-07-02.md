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

---

# v2 addendum (same day) — educator's timeframe + Style-C-lite overlay + funnel

Operator + GPT review of v1 was correct on both counts: the daily 1.5xATR stop (~98 pts = $488/contract; $4.4K at
base-9 sizing) is an ILLEGAL trade under the production framework, and 12 trades/8yr was a daily-bar artifact of
an intraday strategy. v2: **15-minute ratio_adj bars (73,801, 2023→2026), true 4H-resampled bias, Style-C-lite
overlay (stop 1.5xATR15m with the §4 14-pt CEILING → SKIP; 3 units TP1@1R→BE / TP2@2R / runner; RTH-only entries;
15:55 ET flatten).**

## Funnel (where candidate bars disappear — GPT's request)

| stage (cumulative AND) | bars surviving | % of 73,801 |
|---|---|---|
| RTH entry window | 18,875 | 25.6% |
| + bearish 4H structure | 5,847 | 7.9% |
| + premium zone retrace | 3,014 | 4.1% |
| + liquidity sweep/supply touch | 1,854 | 2.5% |
| + bearish price action | **551 armed** | 0.75% |
| → entries (1-at-a-time; **230 skipped by stop ceiling**) | **220 trades** | — |

## v2 outcomes

| metric | v1 (daily, placeholder) | **v2 (15m, Style-C-lite)** |
|---|---|---|
| trades | 12 / 8yr | **220 / 3yr (~1.4/week)** |
| risk per trade | ~$490–$980 @1 lot (illegal) | **$81–$210 @3 lots (avg $158)** — sane vs a $1–2K DLL |
| stop-ceiling skips | n/a | 230 (the §4 skip rule firing live) |
| P&L | +102 pts | +164 pts (+$821 @3 lots), 45.5% obs. win rate, +0.75 pts/trade expectancy, $3,011 max DD |
| Ledger G | TRACEABLE 12/12 | **TRACEABLE 220/220, 31/31 provenance** |

**Honest read:** expectancy is thin and drawdown exceeds cumulative profit — the measured truth of a SHORT-ONLY
strategy on ES through a mostly-bull 2023–2026. That is a statement about the strategy-in-regime, not the
pipeline: the chain now executes at the educator's cadence, at legal risk sizes, with every one of 220 trades
traceable to his words. Edge assessment belongs to the institutional gate battery (WF/CPCV/PBO/DSR/B14), not
this harness.

---

# v3 addendum — bidirectional run (production direction convention) + the mirror finding

Operator question: "doesn't my overlay make strategies bidirectional and add other confluences?" — **yes on both**
(bidirectional-by-default extraction convention + Wave-26 completeness gate; the 11-factor TF confluence overlay
stacks on top in production). v1/v2 were deliberately `source_entry_only` + short-only — the pure-YouTube baseline.
v3 mirrors every evaluator (bullish structure / discount quadrant / demand-zone + sweep-strength / bullish PA) and
arms whichever side clears (stand-aside on conflicting reads).

## v3 result (15m, 2023→2026, Style-C-lite, both directions)

| | trades | P&L (pts @3 lots) | obs. win rate |
|---|---|---|---|
| **short (educator's taught side)** | 220 | **+164.3** | 45.5% |
| **long (naive mirror)** | 342 | **−895.7** | 46.8% |
| total | 562 | −731.4 (−$3,657) | 46.3% |

Ledger G: TRACEABLE 562/562, 31/31. Shorts are IDENTICAL to v2 (+164.3 / 220) — a clean consistency check.

## The finding: naive direction-mirroring must EARN its place

The educator's short-side logic held positive expectancy even through bull years; the mechanical long mirror lost
heavily. Mirroring is a HYPOTHESIS, not a free upgrade — exactly why the production architecture (a) has the
bidirectional-completeness gate with a deliberate long-only/short-only sentinel escape, and (b) sends each
strategy through the gate battery where a losing mirror side gets killed on evidence. This run is that principle
demonstrated with data — and it generalizes GPT's rule: **every enhancement (mirroring included) has to earn its
place against the source-only baseline.**

## Two-mode doctrine (GPT 2026-07-02 — STANDING INVARIANT, never lose the baseline)

- **Mode A — source_entry_only**: the educator's strategy + TF risk framework only. The permanent baseline;
  this research harness runs Mode A by construction, and the production toggle is `TF_CONFLUENCE_OVERLAY_DISABLED`.
- **Mode B — production**: source entry + TF institutional confluence overlay (11-factor gate, regime, killzones,
  liquidity map, macro/lunch blackouts) + real Style-C framework. Mode B lives in the PRODUCTION engine — the
  standalone harness cannot faithfully replicate the overlay's DB-backed services and must not fake them.
- Comparison harness already built: `scripts/confluence-overlay-ablation.py` (KEEP/LOOSEN verdict on expectancy /
  drawdown / trade-count / gate survival). Every overlay component must beat Mode A to keep its place.

---

# Mode A vs Mode B — first VALID production-path ablation (ict_swing, 2026-07-02)

Seven-attempt gauntlet, every stop a guard working or a real bug fixed (ratio-adjust refusal ×2, cache TTL,
firm-key validation, **the spec.symbol regression that was breaking ALL class-based Style-C backtests — found
live, fixed, pushed `a323d29`**, fixed-1 sizing gate, and the unregistered-strategy bypass that voided the first
comparison — compiled strategies MUST be playbook-registered or the 7-layer overlay silently no-ops: an
onboarding requirement for the corpus).

Valid run: `ict_swing` (playbook-registered), 1H ratio_adj ES 2023→2025, identical data + 1-lot sizing both modes.
**Gate engagement proven: raw=23 signals → gate=6.**

| metric | Mode A (source only) | Mode B (+ TF overlay) |
|---|---|---|
| trades | 8 | 3 |
| total P&L | −$1,830 | −$1,114 |
| max drawdown | $2,726 | **$1,415** |
| obs. win rate | 25% | 33.3% |
| Sharpe / PF | −0.41 / 0.52 | −0.57 / 0.19 |

**VERDICT: LOOSEN — overlay starves trades (3 < 40% floor of 8).**

Honest read: (1) the overlay behaved exactly like a defensive filter — halved drawdown and loss, raised win
rate — but cut trade count 62%, tripping the starvation rule; (2) **n=8 vs n=3 is statistically meaningless** —
this validates the HARNESS end-to-end, not a conclusion about the overlay; (3) the result is consistent with the
§13 "death by a thousand filters" doctrine and gate_block_analyzer's purpose. The statistical answer requires
higher-frequency strategies, the compiled corpus, and the full WF/CPCV/PBO/DSR battery under both modes.
