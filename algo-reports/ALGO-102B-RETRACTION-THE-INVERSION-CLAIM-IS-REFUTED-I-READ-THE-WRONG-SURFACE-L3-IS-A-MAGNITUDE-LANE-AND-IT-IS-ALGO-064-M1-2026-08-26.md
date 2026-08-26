# ALGO-102B — **RETRACTION.** ALGO-102 §2's central claim — that the taught secondary-evidence clause is *inverted* in code — is **REFUTED**, by the worker, before any lane derived from it. I read `spec.json`'s `key_level_semantics` block and `video_evidence.md`; **the code loads a different file**, `current_mnq_strategy_v2_4_key_level_semantics.json`, and that file **explicitly authorizes the single-swing family** in a frozen, trader-confirmed contract. This is precisely the wrong-surface error this desk convicted ALGO-076 for, committed by the desk that wrote the law. The measurement survives untouched; the diagnosis is re-scoped from a **family** lane to a **magnitude** lane — which is **ALGO-064's M1, still open since 2026-08-23.**

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Retracts:** ALGO-102 §2 and the
L3a plain reading in ALGO-102 §4. **Ruled on:** the worker's refutation, re-verified at the line
here. **Channel head at drafting:** `e077b591`. **Main head:** `c62bb561e015`. **PR #38: DRAFT.**
**T3″ is unaffected and proceeds** (committed `ee4eac59`, a-priori table clean on all seven
fixtures, guard running).

## 1. The refutation, verified at the line [MEASURED HERE at `6ea8f16a`]

`levels.py:46` — `SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_key_level_semantics.json")`,
loaded by `load_key_level_spec()`. **That file, not `spec.json`, governs location admission.** It
carries `release_id: MNQ-V2.4-SR-LOCATION-EQUATION-5` and, verbatim:

> **purpose:** *"Encode the **trader-confirmed** location scope: structural support/resistance is
> the only regular key-level family, with active 15m FVGs allowed to strengthen a structural zone
> **or themselves serve as a support/resistance interaction band when they appear first**.
> PDH/PDL/PWH/PWL are explicitly excluded."*
>
> **allowed_location_families:** `causal_15m_repeated_rejection_support_resistance` ·
> **`causal_exceptional_single_swing_support_resistance`** ·
> `accepted_and_retested_support_resistance_role_flip` ·
> **`active_15m_FVG_as_support_or_resistance_interaction_band`**
>
> **exceptional_single_swing_path:** `enabled: true`, with a complete frozen equation —
> `min_wick`, `absolute_displacement_floor_atr 1.0`, `recent_displacement_percentile 0.75`,
> `minimum_reference_pivots_for_percentile 4`, plus `no_overlap_duplicate_with_established_zone`
> and `must_survive_zone_lifecycle_to_map_freeze`.

**Both families ALGO-102 §4's plain reading would have stripped are explicitly allowed here.** The
worker's reconciliation is correct and is adopted: `secondary_quality_evidence` answers *what
makes a level high quality*; `allowed_location_families` answers *what may be a location at all* —
different questions. `video_evidence` item 2's *"cannot bypass all other quality/context checks"*
is satisfied on its own terms: the single-swing path does not bypass checks, **it has its own**
(wick, ATR floor, percentile, no-overlap, lifecycle survival). **The clause is not inverted.**

**This desk's error, named plainly:** ALGO-087 minted the law that *every provenance grade names
its surfaces and the corpus is always among them*, after ALGO-076 graded the $400 floor UNCITED
from a grep that never touched the file holding the answer. **ALGO-102 §2 repeated it** — and
worse, ALGO-064 §2 had already quoted this very file to this desk on 08-23. The citation was in my
own ledger and I did not open the file the code loads. **Retracted in full.**

## 2. What survives — all of the measurement, and a sharper finding

Nothing measured in ALGO-102 §1 or §3 depends on the retracted reading. Still standing:
map **50–69** authorized locations per session (median 64), **61–90** distinct bands (median 84);
**54–84%, median 66%**, from the single-swing path; quality non-discriminating (**89.9%** of 1,114
inside 0.62–0.86, **86.7%** confluence 0); **76%** of RTH 5m bars intersecting a live level;
`_range_room_authorization` firing **zero** times in 14 sessions; and ALGO-102 §3's target
finding entirely (the bot takes **rank 0**, his TP is **rank 4/7/17**, median 5.5 traded through)
— which never rested on §2 at all.

**And the finding is sharper stated correctly:** the path the spec itself names **EXCEPTIONAL**
supplies the **majority** of the map. Its own name is the citation: an exceptional path admitting
**42 of 64** locations per session is not being exceptional. **The defect is not which family is
allowed; it is the magnitudes deciding how many members that family admits** — `min_wick 0.20`
(a v2.2 default shipped with the search range `(0.16, 0.26)`), `absolute_displacement_floor_atr
1.0`, and `recent_displacement_percentile 0.75` over as few as **4** reference pivots. The
worker's observation on the percentile is the load-bearing one: **a percentile admits a fixed
PROPORTION of the recent distribution by construction**, so map size is pinned to the distribution
rather than to whether the market actually offered levels.

**Also measured and worth its own line:** `recent_respected_pivot` and
`prior_support_resistance_role_history` — two of the four `secondary_quality_evidence` items —
**appear in no Python file at all.** Spec vocabulary with no implementation. Named, not opened.

## 3. RE-SCOPED — L3 is a MAGNITUDE lane, and it is ALGO-064's M1, still open

**PRIOR ART, and it is this desk's own:** ALGO-064 §2 ruled on 2026-08-23 that *"the level-quality
thresholds are UNTAUGHT parameters — the trader taught WHICH levels (structural S/R), not a wick
fraction"*, and §3 ordered **M1: derive the level DEFINITION from the teaching, verify on held
2025 evidence, one clause per teaching citation, no clause without one.** **M1 was never run** —
the campaign turned to the story layer. **L3 is not a new lane; it is M1, and it is cited as such
rather than re-opened as a discovery.**

**Two hard constraints the loaded spec places on it, and they change the shape of any repair:**
`anti_overfit.no_threshold_search: true` and
**`changing_this_contract_invalidates_prior_v2_4_evidence: true`.** So a magnitude change here is
**a new spec release that re-runs the exam**, not a tweak — and `percentile_is_market_regime_
adaptation_not_variant_selection: true` is the contract's own defence of the percentile, which any
derivation must answer rather than ignore.

**ORDERED (report-only; nothing lands; after the T3″ packet):**
1. **PROVENANCE, per magnitude** — `min_wick`, the 1.0-ATR floor, `0.75`, the `4`-pivot minimum:
   for each, the surfaces searched **named**, and the citation status stated as *"no citation found
   in the surfaces named"* per ALGO-087, never as proof of absence. **The loaded
   `key_level_semantics.json` is among the named surfaces, first.**
2. **SENSITIVITY, structural, no choice made** — map size per session as each magnitude moves
   across its declared range (`min_wick` over its own `(0.16, 0.26)`; the percentile over a stated
   sweep), reported as a table. **This measures how much of the map is decided by an untaught
   number; it selects nothing.** ALGO-102 §4's rails hold in full: no target size, no value
   proposed, no selection by what fits the 14 sessions, out-of-sample structure on the 10-year tape.
3. **THE HONEST FORK, pre-registered:** if M1's derivation cannot express the level definition
   from the teachings without a new magnitude, **the lane closes and the residual is a
   reserved-class ask** — his own account of what makes a level worth watching. That ask is
   legitimate under ALGO-022 (it is about his method, not about historical evidence) and it is one
   of the very few left.

**Not ordered, and forbidden:** deleting or disabling any `allowed_location_family`. That reading
is retracted.

LESSON: the law says *name your surfaces*. I named two and neither was the one the code loads —
while a ruling in my own ledger had already quoted the right file to me. **A citation you have
read before does not count as a surface you have searched; only opening the file the code opens
does.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
