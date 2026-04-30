# Order Flow Integration — Trading Forge

> **Context:** ICT alone is documented at 50–65% real win rate. ICT + footprint
> data (real CVD, bid/ask delta, absorption, exhaustion at swing extremes) is
> the 75%+ tier in 2026. Order flow is where Apex top earners actually find
> edge. This is the edge multiplier.
>
> **Status:** Trading Forge currently has NO real footprint feed. F2 implements
> SYNTHETIC order flow signals derived from existing OHLCV bars. Real footprint
> is a future upgrade once a strategy reaches DEPLOY_READY and the user wants
> to evaluate uplift.

---

## 1. Vendor Comparison (April 2026)

### Bookmap — `$39–79/mo`
- **Strength:** 40 fps real-time CME order book heatmap. Tier-1
  institutional-grade microstructure. The reference product for visual
  liquidity reading.
- **Best for:** Visual / discretionary order flow reading. Spot iceberg orders,
  see absorption visually, watch large limit orders pull.
- **API:** Webhooks export selected signal events to external systems
  (BL signals, AddOns plugin SDK in Java/.NET).
- **Programmatic fit:** Medium. Bookmap is built for the human eye first; the
  AddOns SDK lets you compute features in-process and emit them, but it is
  heavier than ATAS scripting for a custom pipeline.
- **Trading Forge fit:** Lower. We don't need a heatmap GUI in the loop —
  we need numbers a Python service can consume.

### ATAS — `$85/mo` (single futures lifetime ≈ $1,200)
- **Strength:** Footprint charts (numbers bars), trade-by-trade delta,
  cumulative delta, SmartDOM, cluster search. Easier programmatic access
  than Bookmap.
- **API:** Indicator scripting in C# (similar idiom to NinjaScript). Custom
  indicators can write to disk / emit HTTP. Cluster search exposes
  programmatic delta/volume queries.
- **Trading Forge fit:** **Highest.** ATAS scripting can emit footprint
  features → webhook → Trading Forge bias engine → `compute_bias()` reads
  real CVD instead of synthetic CVD. Drop-in replacement for the synthetic
  signals once subscribed.

### Sierra Chart Numbers Bars — `$26/mo` + `$50/mo` CME data
- **Strength:** Already integrated into Sierra Chart (which the user may
  eventually use for ATS execution via Sierra ACSIL studies). Single tool
  for execution + footprint. Lowest cost.
- **API:** ACSIL (Advanced Custom Study Interface, C++). Compiled studies
  can read the entire footprint structure and write features to disk or
  network sockets.
- **Trading Forge fit:** **High** for cost-conscious all-in-one. Slightly
  more development friction than ATAS (C++ vs C#) but the same end pattern:
  study computes feature → emits to local Trading Forge service.

### Recommendation

For Trading Forge's ATS-driven, programmatic-first approach:

1. **First choice — ATAS** — best programmatic fit, modest cost, lowest
   integration effort to swap synthetic CVD for real CVD.
2. **Second choice — Sierra Chart Numbers Bars** — if the user adopts
   Sierra Chart for execution anyway, fold footprint into the same tool
   stack.
3. **Bookmap** — only if the user wants visual confirmation alongside the
   automated stack. Not the right shape for a pipeline that wants numbers,
   not pixels.

### Decision: Defer

Do **not** subscribe to anything for F1. Wait until:

- The first strategy reaches `DEPLOY_READY` on synthetic order flow signals.
- The user has live performance data showing where synthetic signals were
  ambiguous or wrong.
- The cost of footprint data (~$85–$130/mo) is justified by uplift
  measurable in paper P&L.

Until then, F2 implements synthetic order flow from OHLCV.

---

## 2. Synthetic vs Real Order Flow — Limitations

| Signal                    | Synthetic (OHLCV)                                        | Real (Footprint)                                  |
|---------------------------|----------------------------------------------------------|---------------------------------------------------|
| **CVD**                   | Bull%/Bear% of bar range × volume, cumulative            | Tick-by-tick aggressor side (bid lift / ask hit)  |
| **Absorption**            | High volume + small range vs rolling mean                | Large bid/ask sitting, thousands of contracts hit, no price move |
| **Exhaustion**            | Large bar with close in opposite extreme                 | Heavy aggressor flow + fading delta + rejection wick |
| **Sweep + delta confirm** | Synthetic CVD shifts > 1 σ at sweep bar                  | Real delta flips negative on stop-hunt high       |

**Synthetic signals approximate ~60–70% of real footprint signal quality.**
They will produce false positives where:
- Bar-range proxy disagrees with actual aggressor flow (e.g., narrow bar with
  one large aggressor lift looks neutral synthetically but is bullish on
  footprint).
- Volume is dominated by passive orders (synthetic treats all volume as
  directional).

**Future upgrade path:** Once ATAS or Sierra Chart is subscribed, replace the
four synthetic functions in `bias_engine.py` with real-feed equivalents. The
output dict shape stays identical — `cvd_zscore`, `absorption_active`,
`exhaustion_active`, `sweep_delta_confirmed`, `order_flow_score`. Downstream
consumers (playbook router, eligibility gate) require no changes.

---

## 3. Integration Surface

The four synthetic signals plug into `compute_bias()` and return as new keys
on the `DailyBiasState` dataclass. They are **additive** — existing fields
unchanged, existing tests remain valid, and existing callers that don't pass
`bars` see zero behavioral change.

Downstream consumers that want to use order flow:
- `playbook_router.py` — boost MEAN_REVERSION confidence when
  `absorption_active=True` near support/premium-discount edge.
- `eligibility_gate.py` — promote a B+ setup to A+ when
  `sweep_delta_confirmed=True` AND location score ≥ 80.
- `paper-signal-service.ts` — use `order_flow_score` as a tiebreaker between
  competing strategies on the same bar.

These wiring tasks are **out of scope for F2** — F2 only produces the signals.
A later wave wires them into routing logic.
