# OR-Branches Fix — Frozen Baseline ("Before" column)

**Captured 2026-07-05 BEFORE any engine-logic change** (per GPT: freeze the baseline so the before/after
table is provenance-clean and the implementation can't retroactively move the reference). Pure measurement —
no engine files touched to produce this. Engine at HEAD `e2029bc` (Deep-Scan #17 P&L/gate fixes in; the
`or_branches` defect NOT yet fixed).

## Static defect (engine-independent structural fact)
| Metric | Before |
|---|---|
| OR branches extracted (in specs, 108/117 strategies) | **726** |
| OR branches executed by the engine (`or_branches` consumers) | **0** |
| **Composition Conservation Rate (CCR)** = executed / extracted | **0%** |
| OR-alternative condition-ids total (multi-option branches) | 1452 |
| … of which are `role="spine"` (strictly ANDed despite being alternatives) | **576** |
| Strategies with ≥1 spine-role OR-alternative (over-conjoined) | **93 / 117** |

Source: audit of `config.compiled_spec.spec.or_branches` vs `spec_condition_compiler.py`
(`spine_satisfied &= arr`, `grep -rl or_branch src/engine` = 0).

## Behavioral baseline (composition controlled-run instrument — SAME rig the re-run uses)
| Metric | Before |
|---|---|
| SDS (baseline, from increment-2 paired-delta `point_sds_before`) | **2.777** |
| Primary-set strategies (gating-fidelity ≥0.80) | 37 (17 families) |
| Zero-trade strategies — generic-binding baseline | 0 / 37 |
| Zero-trade strategies — native-bundle strict-AND (increment-2 "after") | **10 / 37** |
| Median trades/strategy — generic baseline | 611 (range 47–765) |

Note: the median-trade count reflects the lighter fixed-ATR-bracket measurement instrument (documented in the
composition experiment; never claimed as edge), NOT the full battery — it is used only for distribution
sufficiency and is identical before/after so it cancels.

## The "After" column — FILLED 2026-07-05 (post-fix re-run, `TF_OR_BRANCHES_ENABLED` on vs off)

Fix shipped (default OFF): `src/engine/spec_condition_compiler.py::_combine_spine_or_branches` +
`src/engine/spec_family_bindings.py::or_branches_enabled`. 2 correctness bugs fixed first
(`_resolve_wait_bias_bearish`, `_select_directional_arrays`), 86 pytest GREEN (66 pre-existing +
20 new semantic/regression tests), 0 regressions. Static CCR measured against a fresh DB export of
the full live corpus (120 rows / 726 or_branches / 108 strategies — reproduces the frozen Before
row exactly). Behavioral re-run used the SAME rig (`fvg-experiment-controlled-run.py`'s
`simulate_measurement_trades` + `load_ohlcv`, reused unmodified) on the SAME
`corpus-v2-mode-ab-strategies.json` 78-strategy corpus as increment 2, real S3 historical data.

### Static (CCR) — corpus-wide (120 strategies / 726 or_branches, DB-exported 2026-07-05)
| Metric | Before | After |
|---|---|---|
| CCR = executed / expected | **0%** (0/726) | **42.15%** (306/726) |

**CCR did NOT reach the hoped ~99%.** Root cause (measured, not guessed): honoring an or_branch can
only change gating for a group that has ≥1 `role="spine"` **executed** (non-EXIT_HINT) member — that
is the only kind of alternative the pre-fix strict-AND bug actually mis-combined. Of the 726 groups:
351 (48%) have **zero** spine-executed members (198 are confluence-only, 66 are trigger-only, and a
meaningful chunk reference `INVALIDATE`-family or `ENTER`-family condition-ids that live OUTSIDE
`entry_conditions`/spine scope entirely — stop-placement alternatives and unresolved cross-references,
132 condition-id references across the corpus). Those groups were never part of the over-conjunction
defect (confluence-role conditions never entered the AND chain either) — honoring them is a no-op by
construction, not a fix failure. Of the remaining 375 spine-touching groups, 306 fully executed as OR
(69 had their only spine member be an `EXIT_HINT`-typed binding, which — correctly — never enters the
gating loop at all, executed or not). **CCR = 42.15% is the honest, correctly-scoped number for
entry-spine-gating honoring; closing the rest requires a SEPARATE fix to INVALIDATE-alternative OR
composition (a different subsystem, `structural_stops.py`, explicitly out of scope here per this
module's hard exit/invalidation boundary) plus an extraction-side fix for the 132 dangling
condition-id references.**

### Behavioral — corpus-v2 78-strategy rig, primary set = strategies with ≥1 or_branch group
### structurally touching spine gating (pure static check, no bar data): **63 / 78, 21 families**
(clears the pre-registered floor of ≥15 strategies / ≥5 families by a wide margin). 0 of 15
non-target control strategies diverged (byte-identical before/after — single-variable proof holds).

| Metric | Before | After |
|---|---|---|
| Zero-trade strategies (of 63 primary) | 30 / 63 (47.6%) | **27 / 63 (42.9%)** |
| Revived (0 → nonzero trades) | — | **3** (`opening_range_breakout_orb_{mes,mnq,mcl}_5m`: 0→511, 0→503, 0→475) |
| Regressed (nonzero → 0 trades) | — | **0** |
| Median trades/strategy (nonzero only) | 538 (range 47–1251) | 522 (range 47–1251) |
| SDS, full manifest (78 strategies, all trades) | 2.848, 90% CI [2.146, 3.904], n=42 traded, `SDS_ROSE_STABLE` | 2.761, 90% CI [2.085, 3.797], n=45 traded, `SDS_ROSE_STABLE` |
| SDS paired-delta (pre-registered instrument, both-sides-traded only) | point_sds=2.7468 | point_sds=2.7468, **delta=0.000, 90% CI [0.000, 0.000]** |
| Paired-delta sample | — | n=33 strategies, 11 families (clears ≥15/≥5 floor) |
| Approximation/fidelity flag | unchanged | **0 diffs** — fix touches combination logic only, never primitive binding |

**Pre-registered decision (applied once):** delta CI [0.000, 0.000] is entirely < +0.20 MIN_EFFECT,
AND the sample floor (≥15 strategies / ≥5 families at qualifying fidelity) holds (n=33, 11 families)
→ **CONCLUSIVE NEGATIVE** per the composition-fidelity-experiment decision rule.

**Necessary caveat on what "CONCLUSIVE NEGATIVE" actually measures here:** `composition-paired-delta.py`'s
pairing rule (reused unmodified from increment 2) requires nonzero trades on BOTH sides to include a
strategy in the SDS comparison — there is no trade distribution to compare when one side is empty.
This means the delta is computed ONLY over the 60 (of 63) primary strategies whose trade count did
**not** change at all between modes — it structurally EXCLUDES the 3 strategies that revived from
zero trades (their "before" side has an empty distribution, so they can never enter a paired-delta).
The CONCLUSIVE NEGATIVE verdict is therefore accurate and honest for the question it asks ("among
strategies that already traded both before and after, did honoring OR change their trading STYLE/
distribution?" — no, byte-identically not) but it is a DIFFERENT question from "did honoring OR
revive collapsed strategies?" (yes, partially — 3 of 30 zero-trade strategies, 10% of the zero-trade
population, not the "10/37" figure from increment 2's differently-scoped fidelity set).

### Verdict — did honoring OR resolve the collapse?
**Partially, and not close to fully.** All three pre-registered falsification predictions are now
measured, none fully confirmed:
1. Zero-trade strategies do NOT broadly become tradeable — only 3 of 30 (10%) revived; 27 remain
   zero-trade even with the defect fixed, meaning something ELSE (not or_branch strict-AND) is
   collapsing those 27.
2. Trade frequency is flat for the 60 unaffected strategies (median 538→522, effectively unchanged)
   and the SDS paired-delta is exactly 0 for the population it can measure.
3. CCR reached 42.15%, not ~99% — a large fraction of extracted or_branches structurally cannot
   affect entry gating (confluence-role / trigger-role / invalidation-family / unresolved
   references), so "honor every or_branch" was never going to fully close the semantic gap via this
   fix alone.

**Combined with the increment-2 finding** (conjunction-level identity restoration also produced a
degenerate/flat result), the evidence across BOTH experiments points the SAME direction: the
OR→AND defect is REAL, CONFIRMED, and now PARTIALLY REMEDIATED (3 concrete revivals, CCR
0%→42%) — but it is **NOT the dominant mechanism** behind the corpus-wide collapse. **Recommendation:
stop iterating on evaluator/composition fixes as the primary lever and open the upstream audit** —
extraction over-compression (distinct educator concepts normalized to the same condition tokens),
the shared-cached-generic-array pattern in `spec_condition_compiler.py` (documented as the "parallel"
investigation in the composition-fidelity-experiment design doc), and/or execution-model/sequencing
issues (WAIT_RETEST, temporal ordering) are the more likely dominant bottlenecks for the 27
strategies that remain zero-trade and for corpus-wide behavior generally.
