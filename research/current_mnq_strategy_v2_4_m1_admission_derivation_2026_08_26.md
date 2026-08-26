# M1 — the LOCATION ADMISSION magnitudes. Derivation document, written for GPT to execute.

**ALGO-107 §5**, implementing **ALGO-102B §3**. This is the campaign's remaining lane. Every
other lane has closed: R2/R2b/T3′′ repaired the story layer, F1 the force layer, B1 was closed as
a repair by ALGO-107, and ALGO-100D/102/103 all converged on the same residual — **the flood is
made at the admission layer, and the admission layer is where the untaught numbers live.**

**Nothing in this document lands anything.** It specifies the work, publishes the provenance pass
that is already measured, and pre-registers the fork *before* the sensitivity results exist.

**Instrument:** `run_m1_admission_magnitude_provenance_2026_08_26.py` (committed).
**Output:** `current_mnq_strategy_v2_4_m1_admission_provenance_2026_08_26.json` (committed).
**Declaring surface:** `current_mnq_strategy_v2_4_key_level_semantics.json`, release
`MNQ-V2.4-SR-LOCATION-EQUATION-5`, frozen `2026-08-20` — **the file `levels.py:46` actually
reads.** Not the `key_level_semantics` block inside `spec.json`. Reading the wrong surface is how
ALGO-076 reached an uncited conclusion, and ALGO-102B retracted a deletion over it.

---

## 0. THE ONE RESULT THAT CHANGES HOW M1 MUST BE MEASURED

Today's B1 guard (ALGO-107 §4, reported separately) produced a finding that **binds every step
below**, so it comes first rather than buried in the evidence section.

B1 loosened `_momentum` — a **break-family trigger** predicate. It was *proven* beforehand,
algebraically and over 400k random bars, that the loosening **cannot refuse anything the retired
fractions accepted**. That proof is correct and the measurement confirms it: **zero break-family
approvals were removed at the 08:00 pin.**

**And seven approvals disappeared anyway.** All seven were Route A `REV` — a route `_momentum`
never evaluates. All seven are explained, **7 of 7**, by the same mechanism:

> A newly-admitted `BRK5` landed in the **same bucket** as an existing `REV`, and
> `kernel.py:205` ranks `{"BRK5": 3, "BRK15": 2, "REV": 1}`, so the break candidate won the
> bucket and the rejection candidate stopped being an approval.

**The lesson M1 must carry: a proof about a PREDICATE does not transfer to the PIPELINE that
contains it.** "This clause can only admit more" is compatible with "the system approves
*different* trades, and fewer of some kind." Admission-layer work is *more* exposed to this than
trigger-layer work, because admitting a location creates candidates on every route at once.

**Therefore every M1 measurement below is specified as a membership diff over the FULL approval
set with a per-route breakdown and an explicit displacement audit — never as an admission count.**
An M1 change that reduced the flood by displacing his own Route A entries would be a *failure*
that a count would report as a success.

---

## 1. THE DERIVED MAGNITUDE SET — 10 numbers reach location admission

**Derived, not listed.** The instrument walks every numeric leaf of the declaring surface, plus
every strategy parameter that surface *names* — by a `*_uses_frozen_strategy_parameter` reference
or inside an `equation`/`zone_half_width`/`minimum_room` expression string — and resolves those
against the engine's own `Params` defaults. Add a number to the spec and it appears without
editing the instrument. A typed list is satisfied by whatever the author remembered.

| # | magnitude | value | how the spec carries it |
|---|---|---|---|
| 1 | `established_zone_path.minimum_independent_rejections` | `2` | literal |
| 2 | `exceptional_single_swing_path.lookback_calendar_days` | `40` | literal |
| 3 | `…minimum_wick_fraction_uses_frozen_strategy_parameter` → `Params.min_wick` | `0.20` | **named**, resolved from the engine |
| 4 | `exceptional_single_swing_path.absolute_displacement_floor_atr` | `1.0` | literal |
| 5 | `exceptional_single_swing_path.recent_displacement_percentile` | `0.75` | literal |
| 6 | `…minimum_reference_pivots_for_percentile` | `4` | literal |
| 7 | `exceptional_single_swing_path.equation` → `Params.min_wick` | `0.20` | **named inside the equation string** |
| 8 | `exceptional_single_swing_path.zone_half_width` → `Params.key_level_pad_atr` | `0.06` | **named inside an expression** |
| 9 | `exceptional_single_swing_path.zone_half_width` → `4_ticks` | `4` | literal **inside** an expression string |
| 10 | `range_day_zone_room.minimum_room` → `Params.min_room_r` | `1.50` | **named inside an expression** |

**Five of the ten are invisible to any audit that only reads the JSON's numeric leaves** (#3, #7,
#8, #9, #10). They are carried inside strings. That alone is worth recording: the admission
surface's magnitude count has been under-stated by half in every prior discussion of it.

---

## 2. STEP 1 — PROVENANCE. **Measured, and the first instrument was wrong.**

### 2.1 The finding

**No admission magnitude has a teaching citation. Zero of ten.** Not one of these numbers can be
traced to anything the operator said, wrote, or demonstrated in any teaching surface the repo
holds.

### 2.2 How the first pass got it wrong, and why that matters more than the result

The first version of the scan searched the corpus for each number as a substring and reported
**"4 of 10 uncited"** — i.e. *six were cited*. **Every one of those six hits was noise:**

| number | what the "citation" actually was |
|---|---|
| `2` | the string `MNQ v2.4`; a bar index (`Bar 2:`); `"rank": 2` in a source-policy list |
| `4` | `v2.4` again; the branch name `…-v2-4-zone-first-candles`; a section heading `### 4–5` |
| `40` | **inside a sha256** (`…45c7928…4680a7d5…`); a timestamp `10:40:33` |
| `1.0` | `Maximum strategy trades: 1 per session`; `Bar 1:` |
| `1.50` | **an audio chime's `"duration_seconds": 1.5`** |

A boundary filter (reject a match glued to `[0-9A-Za-z_.]`) removes the sha256 and version-string
class. **It does not remove the chime**, which is boundary-clean and still irrelevant. So the
instrument now returns **every hit with its surrounding text**, and the verdict is made by
reading. There is no "cited: true" column, because that column is not derivable by search.

**This is the shape of the whole M1 problem in miniature.** An audit that counts hits reports a
reassuring number over a worse truth, and the reassuring direction is the dangerous one — it says
"these numbers came from him" when nothing says that.

**The absence claim is proved live by a positive control.** The taught `$400` minimum-target floor
— which *is* operator teaching and *is* held in
`trader_fidelity_addendum_2026_08_20.json:101` — is found by the **same filtered scan**:
`"…from the platform TP display: $400 or more is safe; under $400 is…"`. A control that only
passes unfiltered would prove nothing about a filtered miss, so the control faces the same filter.

### 2.3 CONCEPT vs MAGNITUDE — the distinction the ruling turns on

A number can be taught with no numeral. "Wait for the second rejection" teaches
`minimum_independent_rejections = 2`. So the instrument also searches concept terms derived from
each magnitude's own key path. Reading those hits:

| magnitude | is the CONCEPT taught? | is the NUMBER taught? |
|---|---|---|
| `minimum_independent_rejections = 2` | **YES** — *"Primary evidence includes **repeated independent** rejection/wick events"* (`engineer_onboarding.md:56`) | **NO** — "repeated" does not say *two* |
| `absolute_displacement_floor_atr = 1.0` | **YES** — *"**Strong displacement** away from a swing can support the exceptional single-swing path"* (`:57`) | **NO** — "strong" does not say *one ATR* |
| `recent_displacement_percentile = 0.75` | **YES**, same sentence — "strong relative to what" is a real question | **NO** — nothing selects Q75 over Q60 or Q90 |
| `lookback_calendar_days = 40` | partially — a lookback must exist | **NO** |
| `min_wick = 0.20` | **YES** — wick quality is taught throughout | **NO** |
| `minimum_reference_pivots_for_percentile = 4` | weak — a sample-size floor is an engineering necessity | **NO** |
| `key_level_pad_atr = 0.06`, `4_ticks` | **YES, AND TAUGHT DIFFERENTLY — see §3** | **NO** |
| `min_room_r = 1.50` | **YES** — the MIXED-morning room rule is taught (`:61`) | **NO** |

**The pattern is uniform: the operator taught every CONCEPT and not one MAGNITUDE.** That is
exactly the ALGO-071 §3 situation — his own answer retired `body_frac`/`close_loc` because the
*concept* was his and the *number* was an engineer's — reproduced across the entire admission
surface, ten times over.

### 2.4 A near-contradiction, read carefully rather than published as one

`engineer_onboarding.md:58` says *"PDH, PDL, PWH and PWL are part of context/key-map
construction."* The loaded spec lists all four under `forbidden_location_families` and states they
are *"explicitly excluded."*

**These are not in conflict, and it would be sloppy to report them as such.** The spec forbids
them as **location families with entry authority** — `legacy_reference_fail_closed` sets
`daily_weekly_named_level_entry_authority: false` — while the onboarding line assigns them a
**context/map** role. Same objects, two different powers. Noted here so the next reader who spots
it does not re-open it, and because the entry-authority/context split is a distinction M1 must
preserve in anything it changes.

---

## 3. THE SHARPEST GAP M1 EXPOSES — the zone is a band, and the code builds the wrong band

This is the single highest-value item on the admission surface and it is **not** a threshold
question.

**What the code does.** `zone_half_width = max(4_ticks, key_level_pad_atr × pivot_ATR)` — a
**symmetric** pad of ±(4 ticks or 0.06 ATR) around a pivot price.

**What the operator taught.** In his own words, recorded when he corrected the vocabulary:

> *"i take a key zone with a wick and i draw the zone from the top of the wick"*

— an **asymmetric** band, from the rejection wick's extreme to that candle's close, with **both
edges read off the rejecting candle**. `engineer_onboarding.md:55` carries the weaker half of the
same teaching: *"Key levels are zones, not magic single prices."* **ALGO-071** closed this as one
of his two reserved answers: zones are BANDS, the labels' one-tick `trader_zones` are his *level
lines*, and the width comes from **held** artifacts — never from the labels, and never chosen to
make a day overlap (the ALGO-064 contamination law).

**THREE QUALIFIERS, because getting these wrong sends the whole lane the wrong way:**

1. **Scope: 5m and 15m ONLY.** He never taught 30-minute wick-to-close zones; that was a
   cross-teacher error from the R-736 golden. Anything built here is a 5m/15m construction.
2. **Two recorded descriptions, and they are not identical.** His quote describes a **single
   rejection candle** (wick-top → close). ALGO-071's pinned screenshots describe *"the reaction
   area between the wick extremes of the **rejection cluster**"* — measured at **~4, ~8, ~19,
   ~22, ~30, ~32 pts**. Single candle vs cluster is a real difference. **Reconciling them from
   the held artifacts is part of the work, and it is not resolved here.** Do not silently pick
   one.
3. **Do not ask him.** The evidence baseline is CLOSED and he has said repeatedly not to bring
   replay markings back to him. The width is derived from held artifacts **once**, published
   with its citations, and only then applied.

**These are different constructions, not different calibrations of one construction.**

**And the coded floor sits below the entire observed teaching range.** `TICK = 0.25`, so
`levels.py:149`'s `max(TICK * 4.0, key_level_pad_atr × atr)` has a floor of **1.0 pt half-width =
2.0 pts full width**, against pinned teaching bands of **~4 to ~32 pts**. The floor is not a
conservative version of his band; it is narrower than the narrowest one anybody measured.

- The taught band is **asymmetric** and **event-derived** — its edges come from the candle that
  did the rejecting, so a violent rejection makes a wide band and a shallow one makes a narrow
  band, automatically, with no parameter.
- The coded band is **symmetric** and **volatility-derived** — its width comes from ATR and a
  fraction, and knows nothing about the candle that made the level.

**Consequence for M1:** `key_level_pad_atr` and `4_ticks` are not two numbers to re-derive. They
are **two numbers implementing a band the operator did not describe.** Replacing the construction
retires both magnitudes at once and needs no new number — the ALGO-071 §3 move, applied to the
band instead of the candle, exactly as T3′′ applied it to the story.

**This is the M1 candidate with a real chance of reducing the flood for a taught reason**, because
band width directly controls how many locations a session admits, and ALGO-102 measured the map
admitting a **median 64 locations per session.**

**It is also the one most exposed to §0.** Changing band geometry changes which bucket a candidate
lands in and therefore which route wins it. It must be measured as a full membership diff.

---

## 4. STEP 2 — STRUCTURAL SENSITIVITY. Specification, to be executed.

**The question.** For each magnitude, as it moves across its declared range, does the admitted
location set change **structurally** (different locations, different routes winning buckets) or
only **marginally** (the same locations with slightly different edges)? A magnitude whose whole
declared range produces one structure is not doing work and can be retired without replacement. A
magnitude that flips structure inside its range is **load-bearing and untaught** — the worst
category, and the one that must be replaced by a construction rather than re-tuned.

**Ranges are declared BEFORE any run, and are not search spaces.** They exist to characterise
sensitivity, not to select a value. **No value discovered by this sweep may be adopted.** Adopting
a swept value is a threshold search, which the spec's own `anti_overfit` block forbids
(`no_threshold_search: true`) and which this ladder has refused twice.

**THE RANGES ARE DERIVED WHERE THE CODEBASE DECLARES THEM.** `PARAMETER_REGISTRY`
(`current_mnq_strategy_v2_2_engine.py:89`) already declares an intended range for every `Params`
magnitude. Those are the codebase's own declarations and they are used verbatim — inventing a
range next to a declared one is choosing a search space by hand.

**Structural finding in its own right: exactly 3 of the 10 have a declared range.** All three are
the `Params` magnitudes. **The seven that live in the JSON spec have no declared range anywhere** —
they were written as constants with no stated tolerance, which is itself evidence about how they
were chosen.

| # | magnitude | sweep range | source of the range |
|---|---|---|---|
| 3,7 | `min_wick` | `{0.16, 0.20, 0.26}` | **DECLARED** `(0.16, 0.26)` + frozen value |
| 8 | `key_level_pad_atr` | `{0.04, 0.06, 0.09}` | **DECLARED** `(0.04, 0.09)` + frozen value |
| 10 | `min_room_r` | `{1.25, 1.50, 2.00}` | **DECLARED** `(1.25, 2.00)` + frozen value |
| 1 | `minimum_independent_rejections` | `{1, 2, 3}` | **MINE** — "repeated" admits at least these readings |
| 2 | `lookback_calendar_days` | `{20, 40, 60}` | **MINE** — half, current, and half again |
| 4 | `absolute_displacement_floor_atr` | `{0.5, 1.0, 1.5}` | **MINE** — "strong" plausibly spans these |
| 5 | `recent_displacement_percentile` | `{0.60, 0.75, 0.90}` | **MINE** — median-ish to clearly exceptional |
| 6 | `minimum_reference_pivots_for_percentile` | `{3, 4, 6}` | **MINE** — floors that keep a percentile meaningful |
| 9 | `4_ticks` floor | `{2, 4, 8, 16}` | **MINE** — half, current, double, and **16 ticks = 4.0 pts**, the narrowest band anyone actually measured (§3) |

**The six ranges marked MINE are the weakest part of this document and are labelled so nobody
mistakes them for teaching.** They bound a sensitivity question; they are not candidate values,
and §5 forbids adopting any of them.

**Method — one magnitude moved at a time, everything else frozen:**

1. Capture at **both pins** (`08:00`, `09:30`) with
   `run_approved_entry_membership_capture.py` (`as_of=replay_end`), and the candidate table
   with `run_algo096_candidate_table_six_clocks.py` (`as_of=None`). **State the horizon on every
   number**; they are different questions and have been conflated before.
2. Report, for every sweep point, **against the frozen baseline**:
   - approvals **added** and **removed**, by key — never a count;
   - **per-route breakdown** (`BRK5` / `BRK15` / `REV`) of both;
   - **the displacement audit of §0**: for every removal, is there an addition in the same
     `(session, bucket)` at a higher `kernel.py:205` rank? Removals so explained are
     **displacements, not refusals**, and must be labelled that way;
   - sessions **silenced** (had approvals, now none) — a silenced session is a structural change
     however small the count moved;
   - **the 04-14 control by key AND target** — `09:38 L BRK5` target `25869.0`;
   - whether **his six clocks** survive to ranking.
3. **Classify each magnitude** by what its whole range does: `INERT` (no membership change
   anywhere in range) · `MARGINAL` (changes edges, same structure) · `LOAD-BEARING` (structure
   flips inside the declared range).

**Cost control:** ~27 sweep points × 2 pins. If that is too many runs, cut **breadth before
rigour** — drop magnitudes from the sweep and say which, never drop a pin, the control, or the
displacement audit. **`log` what was dropped**; a silently truncated sweep reads as full coverage.

---

## 5. STEP 3 — THE HONEST FORK, pre-registered before any sensitivity result exists

Written now, while the outcome is unknown, because a rule written after the numbers is a goalpost
with a citation. **All three branches are real outcomes and one of them closes M1 with no change.**

**FORK A — a magnitude is `INERT` across its whole declared range.**
→ **Retire it**, replacing it with nothing. An inert number is not a threshold, it is decoration,
and decoration on a fidelity surface is a false claim of precision. Requires: the membership diff
showing no change at any sweep point at both pins, plus a mutation battery proving the retirement
is actually reachable — *an inert magnitude and a magnitude nothing reads look identical.*

**FORK B — a magnitude is `LOAD-BEARING` and its concept is taught (§2.3 shows most are).**
→ **Replace the CONSTRUCTION, do not re-tune the number.** This is the ALGO-071 §3 / T3′′ / B1
move: express the taught concept as a comparison between quantities the market provides, with no
constant. §3's band is the worked example. Requires: a derivation document with the taught
sentence quoted and each conjunct mapped to it, an a-priori fixture table **committed before any
guard runs**, and the §4 measurement including the displacement audit.
**And ALGO-107's law applies before any prediction is made: PROVE THE DIRECTION FIRST.** B1
assumed a faithful expression would be stricter than an untaught number; it was **looser**, and
the campaign's public prediction was unreachable from the moment the clause was written. Whatever
replaces a band or a floor, prove `OLD ⟹ NEW` or `NEW ⟹ OLD` **before** predicting an effect —
and then still measure, because §0 shows the pipeline can remove what the predicate cannot.

**FORK C — a magnitude is `LOAD-BEARING` and its concept is NOT taught.**
→ **STOP. Change nothing, and say so.** There is no faithful expression to derive because there is
no teaching to express. Record it as **an engineering necessity with no fidelity basis**, name it
in the handover's open queue, and leave it frozen. **Do not ask the operator** — the evidence
baseline is CLOSED and he is not a question channel for this. **Do not invent a derivation from
market structure and present it as his** — that is the failure mode this entire campaign exists to
prevent, and it is more tempting here than anywhere else, because a plausible-sounding structural
story is easy to write for any of these ten numbers.

### The pre-registered acceptance for any M1 change, conjunctive

A change proceeds only if **all** hold. **A packet arguing an M1 change succeeded because the
approval count fell will be refused**, exactly as the count argument was refused before.

1. The taught sentence is **quoted**, with its surface and line.
2. **No new magnitude** is introduced — asserted by an **AST scan** of the changed clause, not a
   text or line scan. (A line scan reads one branch; a text scan reads docstrings. Both have
   produced false greens here.)
3. The **04-14 control** survives **by key and by target** at **both pins**.
4. **No session is silenced.**
5. Every removal is **classified** — refusal or displacement (§0) — and displacements of **his
   own Route A entries** count **against** the change, not for it.
6. The a-priori fixture table is **committed before the guard runs** and **conflicts with
   nothing**; if it conflicts, the lane **closes** with no second expression.
7. A **mutation battery** goes RED on every planted defect, compared **by membership**, with a
   **byte-exact sha256-verified restore**.

---

## 6. WHAT THIS DOCUMENT DOES NOT DO

No admission magnitude is changed. No map repair is landed. Nothing from B1 lands — ALGO-107
closed it as a repair and the measurement in §0 is reported as evidence, not as a proposal. The
story, force, target and route layers are untouched. The 17.25-pt stop, the targets and the exam
rules are untouched. R2c stays unmerged. **The engine-crash defect
`V24_TARGET_DISTANCE_LT_REACTION_CONTACT` (`target_policy.py:157-161`, raises instead of
declining) is still carried and still unfixed** — and it matters to §4, because **a crashed
session is not a no-trade decision** and a sweep point that crashes must be reported as a crash,
never scored as a silence.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this document.
