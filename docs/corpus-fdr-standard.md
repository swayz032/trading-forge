# Corpus-Level False-Discovery-Rate Standard

**System:** Trading Forge backtesting engine
**Layer:** Roadmap Band D, items D2 (corpus FDR) + D4 (regime-stratified reporting)
**Status:** HARNESS BUILT — statistics + report script shipped; noise floor still
pending the operator-scheduled N=100 null-calibration batch (see
`docs/gate-battery-calibration.md`)
**Owner:** critic-optimizer subsystem — `src/engine/statistics/corpus_fdr.py`
(pure math) + `scripts/corpus-fdr-report.py` (I/O + report assembly)

---

## Purpose

The per-strategy gate battery (CPCV, PBO < 15%, full-Bailey DSR, WFE >= 0.70,
B14 ruin `ci_high`, B15 jitter, BIF) is institutional-grade for evaluating ONE
strategy against its own history. It has no visibility into the population it
was drawn from. When ~200 compiled strategies are run through it and "12 of
200 passed," that sentence is not yet statistically honest — some non-zero
number of those 12 passes are expected BY CHANCE even under the null
hypothesis that every strategy in the corpus has zero real edge, purely
because 200 independent "trials" against the same battery will produce some
false passes at whatever rate the battery's noise floor sits at.

This is compounded by a structural bias unique to this corpus: strategies are
scouted from YouTube/Reddit/web educators who are sampled by **marketing
reach**, not trading skill. A corpus built this way is adversarially biased
toward overfit-looking edges — educators who post backtests tend to post the
ones that looked good, and viral educators are not selected for statistical
rigor. The corpus-level FDR layer is the check against exactly this bias.

---

## Standing Rule (read this before citing any corpus-level pass count)

> **Population-level claims ("family X generalizes", "N of M strategies
> passed", "the scout pipeline is working") REQUIRE the corpus-FDR report.
> Raw pass counts are NEVER a sufficient citation for a population-level
> claim.**
>
> Run `python scripts/corpus-fdr-report.py` and cite the resulting headline
> ("X passes, Y expected by chance, excess = X-Y") instead of "X of M
> strategies passed."

This mirrors the existing standing rule in `docs/gate-battery-calibration.md`
("Population-scale passes only count above the noise floor") — that document
establishes the noise floor measurement; this document establishes what to do
with a population of strategies ONCE you have that floor, plus the
per-strategy statistical lens that sits between "did it pass" and "is that
pass meaningful at corpus scale."

---

## Composition rule: floor-relative FIRST, then FDR across survivors

The two layers answer different questions and must be applied **in this
order, never the reverse**:

1. **Floor-relative check (E[FD]).** Before looking at any individual
   strategy, ask: given the corpus size and the measured full-battery
   false-pass rate (from `scripts/null_gate_calibration.py`), how many passes
   would we expect by pure chance? If the raw pass count is not meaningfully
   above `E[FD]` (and especially not above `E[FD]`'s 95% CI upper bound), the
   ENTIRE corpus-level claim is suspect regardless of which specific
   strategies passed. This is the sanity gate that answers "is there any
   signal here at all."

2. **FDR-across-survivors (Benjamini-Hochberg).** Only once the floor check
   suggests real signal is plausible does it make sense to ask "WHICH specific
   strategies are distinguishable from the noise floor." Benjamini-Hochberg
   controls the expected proportion of false discoveries AMONG THE REJECTED
   (BH-significant) set — it answers "of the passes, which ones would we bet
   on individually," not "is there a corpus-wide signal at all."

Applying BH first and treating "N BH-rejected" as proof of corpus-wide signal
without checking it against `E[FD]` is a common misuse: BH is a
within-population comparison and says nothing about whether the population
itself was drawn from a biased sampling process (which is exactly the
marketing-reach bias this corpus has). Applying only the floor check without
BH loses the ability to identify SPECIFIC promotable strategies — it's a
population-level sanity check, not a per-strategy decision rule.

`src/engine/statistics/corpus_fdr.py::build_corpus_report()` implements this
composition explicitly in its per-strategy verdict classification:

```
if strategy did not gate-pass:            verdict = "failed"
elif BH-significant at q_promotion:       verdict = "passed"
else:                                      verdict = "passed_but_within_noise_floor"
```

A strategy that "passed" the per-strategy gate battery but is not
BH-significant at the promotion q-level is explicitly labeled
`passed_but_within_noise_floor` — it gate-passed, but the corpus-level lens
cannot yet distinguish it from a chance pass given how many strategies were
evaluated.

---

## Which q-level gates which kind of claim

| q-level | Use for | Rationale |
|---|---|---|
| **q = 0.10** (`CORPUS_FDR_Q_RESEARCH`) | Research-triage claims: "this batch of scout output looks promising, dig deeper", ranking candidates for the next research cycle, deciding whether to expand an educator-concept family | Exploratory/screening-stage FDR control conventionally tolerates a higher false-discovery budget than confirmatory decisions — the cost of a false positive here is "spend more research time on a dead end," not "risk live capital." This mirrors the general two-stage FDR practice (Storey, 2002, "A direct approach to false discovery rates", J.R. Statist. Soc. B 64(3):479-498) of using a looser q at a discovery/screening stage and a stricter q at a confirmatory stage. |
| **q = 0.05** (`CORPUS_FDR_Q_PROMOTION`) | Promotion-relevant claims: any statement that influences a lifecycle promotion decision, any Discord/dashboard claim that a strategy or family "works," any claim used to justify allocating research or capital resources | q = 0.05 is the long-standing conventional FDR control level from Benjamini & Hochberg (1995) itself, and is the level at which a false-discovery claim starts to carry real downstream cost (operator time, capital risk, reputational cost of a family-wide rollout). Trading Forge's own per-strategy gates already use analogous conventions at this tightness — DSR's own significance test uses p < 0.05 (`src/engine/risk_metrics.py::compute_deflated_sharpe_ratio`), and PBO's institutional threshold is 15% (`PBO_OVERFIT_THRESHOLD_PCT`), both established as the "this matters for a real decision" bar elsewhere in this codebase. Using the SAME conventional 0.05 level for the corpus-wide lens keeps the whole battery internally consistent rather than introducing a novel threshold. |

**A note on precision here:** these two q-levels are principled defaults
grounded in the general (long-established, still-current) FDR literature
above, not a claim of a specific "2025/2026 institutional-practice" citation
that this pass verified against fresh external sources. If dedicated
corroboration from current (2025-2026) institutional multiple-testing
practice specifically for backtest-population screening is wanted, that is
exactly the `institutional-edge-researcher` subagent's mandate (per
`CLAUDE.md` §11 subagent assignments) — route that research request there
rather than trusting an unverified citation here.

Both levels are env-overridable (`CORPUS_FDR_Q_RESEARCH`,
`CORPUS_FDR_Q_PROMOTION`) for a documented, deliberate deviation — never edit
the code defaults without updating this table.

---

## The p-value ladder (what "per-strategy p-value" even means here)

The per-strategy gate battery does not uniformly emit one canonical p-value.
`derive_pvalue_for_strategy()` in `src/engine/statistics/corpus_fdr.py`
implements an explicit precedence ladder:

1. **`pbo_overall_p_value`** (preferred) — the Bailey et al. rank-based PBO
   p-value, computed by `src/engine/pbo_gate.py` and surfaced at
   `wf_result["pbo_overall_p_value"]` / persisted at
   `backtests.walk_forward_results.pbo_overall_p_value`. This is a direct,
   already-computed p-value under the null hypothesis that OOS rank is
   uniformly distributed (no genuine backtest-overfitting skill). Preferred
   because it is purpose-built as a p-value, not derived.

2. **DSR-derived p-value** — `wf_metadata["dsr"]` (see
   `src/engine/risk_metrics.py::compute_deflated_sharpe_ratio`) is the DSR
   TEST STATISTIC (a z-score), not a probability. The upstream helper's own
   formula is `p_value = 1 - Phi(dsr)` (risk_metrics.py:566) — a one-line
   transform of a value that IS already persisted, even though the transform
   itself (the `p_value` key) is not threaded through to `wf_metadata` today
   (only `dsr` and `dsr_pass` survive persistence — see
   `src/engine/walk_forward.py`). `corpus_fdr.py` recomputes this transform
   with an exact stdlib normal CDF (`math.erf`-based, no scipy) rather than
   requiring an upstream schema change to thread the p-value through.

3. **Missing** — when neither source is usable (e.g. `dsr_unavailable=True`,
   or the record predates either field), the strategy is assigned
   `p_value=None` and **excluded from the BH ranking**. It is never assigned
   a fabricated `p=1.0` or `p=0.5` — either of those would silently bias the
   FDR calculation (a fabricated `p=1.0` makes BH more conservative than
   warranted by ANY evidence; a fabricated `p=0.5` implies "50-50 coin flip"
   evidence that was never actually measured). Excluded strategies are
   counted and reported loudly (`n_missing_pvalue` in the report) rather than
   silently dropped.

---

## The Sharpe-haircut lens (complementary to BH, not a replacement)

`compute_sharpe_haircut()` implements a Harvey-Liu-Zhu (2016)-STYLE haircut —
read the methodology caveat in the function's docstring before citing this as
"the HLZ haircut." HLZ (2016, "...and the Cross-Section of Expected Returns",
Review of Financial Studies 29(1):5-68) compute haircuts against an
empirically-fitted benchmark distribution built from ~300 previously-published
risk factors; that specific empirical benchmark dataset does not exist in
this codebase, and fabricating one would violate the "never fabricate" rule.

Instead, `compute_sharpe_haircut()` applies the closed-form Bailey & Lopez de
Prado (2014) expected-max-Sharpe-under-H0 correction — the SAME `E[maxSR]`
formula already used elsewhere in this codebase by
`src/engine/statistics/backtest_inflation_factor.py` (BIF) and
`src/engine/risk_metrics.py::compute_deflated_sharpe_ratio` (DSR) — as a
deterministic, theoretically-grounded proxy for "how much of this Sharpe
could be multiple-testing artifact given N trials." This keeps the haircut
internally consistent with the rest of the statistics stack rather than
introducing a second, incompatible multiple-testing correction.

**Why keep both BH and the haircut, rather than picking one:**
- BH (on p-values) answers: "is THIS strategy's evidence distinguishable from
  the corpus noise floor at the target FDR level."
- The haircut (on Sharpe ratios) answers: "how much of THIS strategy's raw
  Sharpe survives once we price in how many strategies were tried." It
  degrades gracefully even for strategies that lack a usable p-value (it only
  needs `observed_sharpe`), which is a useful cross-check exactly when the
  p-value ladder bottoms out to "missing."

Report both per strategy; do not average or otherwise combine them into a
single number — they measure different things and a combined number would
hide which lens is driving the verdict.

---

## Per-educator-family grouping vs. corpus-wide

An educator with 1-of-8 strategies BH-significant is a different signal than
an educator with 8-of-8: the former looks like "one genuine idea buried in
seven overfit variants from the same source," the latter looks like "this
educator's whole catalog might share systematic, possibly-illusory edge (or
possibly a genuinely skilled educator)." `compute_family_grouped_fdr()`
computes BH BOTH within each educator-proxy group AND corpus-wide, and the
report surfaces both tables.

**Documented schema gap:** there is no `educators` / `channels` table
anywhere in the schema — no `channel_id`, no creator identity is persisted
anywhere. `scripts/corpus-fdr-report.py` uses the EARLIEST
`strategy_pending_mentions.source_url` for the bucket that graduated into
each strategy as the best available per-source grouping proxy. This groups
strategies extracted from the **same specific source video/article**, not
necessarily every video from the same creator/channel across time — two
strategies from the same YouTuber's two different videos will NOT be grouped
together today. A real `content_sources`/`educators` table with a
`channel_id` foreign key would be the correct long-term fix; that is schema
work, out of scope for this Band-D statistics pass, and is recorded here as a
coordination finding for whichever future pass owns scout-pipeline schema.

---

## Regime-attribution gap (D4)

Every strategy's report row is meant to carry a per-regime performance
breakdown. What actually exists today:

- `backtests.mrp_regime_breakdown` (B10 Minimum Regime Performance gate) IS
  persisted per-backtest as a `{regime: sharpe}` dict, computed from
  `backtestTrades.macroRegime` groupings. The taxonomy here is the MACRO
  regime vocabulary (`RISK_ON` / `RISK_OFF` / `TIGHTENING` / `EASING` /
  `STAGFLATION` / `GOLDILOCKS` / `TRANSITION`, from
  `macro-gate-service.ts` / `macro_snapshots.macro_regime`). This is what
  `attach_regime_breakdown()` surfaces today, tagged
  `macro_regime_taxonomy: "macro_regime_6class_risk_on_off_etc"`.

- The **5-class institutional regime** (`TRENDING` / `EXPANSION` /
  `COMPRESSION` / `HIGH_VOL_MACRO` / `RANGE_BOUND` / `LOW_LIQ_CHOP`, from
  `classify_institutional_regime()` in `bias_engine.py`, Wave 25 Pass 6) is
  **NOT** persisted per-trade or per-backtest anywhere in the schema. It is
  computed LIVE at signal time and persisted only as a single current-state
  value (`bias_state.regime_label`) plus a single freeze-time snapshot
  (`strategies.regime_trained_on`, stamped once at frozen-policy-hash time).
  There is no historical per-fold breakdown of institutional-5-class-regime
  performance to report.

This is a genuine coordination finding, not a design choice made by this
pass. `attach_regime_breakdown()` reports the macro-regime breakdown when
present and returns an explicit, always-present `institutional_5class_gap`
string explaining the absence rather than fabricating a 5-class breakdown.
Closing this gap would require either (a) persisting
`institutional_regime` per `backtestTrades` row (an engine + schema change,
touching `src/engine/backtester.py` and the `backtest_trades` migration —
outside this statistics-layer pass's file boundary), or (b) a dedicated
post-backtest aggregation pass analogous to the existing B10 MRP computation
but keyed on the institutional taxonomy instead of the macro taxonomy.

---

## How the operator runs the report

```bash
# 1. (One-time / whenever the gate battery changes) measure the noise floor:
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42
#    -> writes null_calibration_report.json (~2-3 hours for N=100)

# 2. Run the corpus report (reads DATABASE_URL + null_calibration_report.json):
python scripts/corpus-fdr-report.py

# Optional overrides:
python scripts/corpus-fdr-report.py \
    --calibration-report null_calibration_report.json \
    --population-size 200 \
    --q-research 0.10 \
    --q-promotion 0.05 \
    --output-dir docs/corpus-fdr-reports

# Outputs:
#   docs/corpus-fdr-reports/<ISO-date>-corpus-fdr-report.json  (full machine-readable)
#   docs/corpus-fdr-reports/<ISO-date>-corpus-fdr-report.md    (human-readable + plain-English summary)
```

If `null_calibration_report.json` has not been produced yet (or its
`full_battery.trials == 0`), the report says so LOUDLY:

> NOISE FLOOR NOT YET MEASURED — run `... null_gate_calibration.py --n 100
> --seed 42` before trusting any corpus-level pass count. Expected false
> discoveries is UNKNOWN, not zero.

Do not interpret a raw pass count as meaningful in that state, and do not
edit the code to assume a false-pass rate of 0.0 as a "reasonable default" —
that is exactly the silent bias this document exists to prevent.

**Re-run the report** whenever: the strategy population changes materially
(new backtest batch completes), the gate battery version changes (re-run
calibration first per `docs/gate-battery-calibration.md`), or before any
population-level claim is made in an operator-facing summary, Discord digest,
or dashboard.

---

## File map

| File | Role |
|---|---|
| `src/engine/statistics/corpus_fdr.py` | Pure math: BH, haircut, family grouping, E[FD], regime-gap surfacing, report assembly. No I/O. |
| `src/engine/tests/test_corpus_fdr.py` | 42 pytest: BH fixture (hand-verified), haircut monotonicity/edge-cases, family grouping, noise-floor-absent path, E[FD] Wilson-CI propagation, p-value ladder, determinism, end-to-end report. |
| `scripts/corpus-fdr-report.py` | I/O: DB read (psycopg2, fail-soft), calibration-report read, Markdown+JSON report write. Owns ALL side effects for this pass. |
| `docs/gate-battery-calibration.md` | The noise-floor measurement procedure this document's E[FD] consumes. |
| `docs/corpus-fdr-standard.md` | This document. |

---

## Isolation / non-interference guarantees

- This pass does NOT modify `src/engine/statistics/backtest_inflation_factor.py`,
  `src/engine/pbo_gate.py`, `src/engine/risk_metrics.py`, or any existing gate
  logic — it reads their already-persisted outputs read-only.
- This pass does NOT modify `lifecycle-service.ts` or any promotion gate — the
  corpus report is advisory-only, file-output-only, and never mutates a
  strategy's `lifecycle_state`.
- This pass does NOT introduce new DB tables or migrations — it reads
  existing columns (`backtests.tier`, `backtests.walk_forward_results`,
  `backtests.mrp_regime_breakdown`, `backtests.sharpe_ratio`,
  `strategy_pending_buckets` / `strategy_pending_mentions`) and writes only to
  the filesystem (`docs/corpus-fdr-reports/`).
