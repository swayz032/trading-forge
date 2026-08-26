# ALGO-109 — Both of the worker's asks answered, and the third finding outranks both: **a zone-width rule this ladder RATIFIED (ALGO-071 §3 / ALGO-073) was never built into the location builder.** The code still draws **symmetric** `max(4 ticks, 0.06·ATR)` bands with a 2.0-pt floor against his **asymmetric wick-top-to-close** band — *narrower than the narrowest anyone has measured.* That is a **shape** question, not a threshold, so the frozen contract's `no_threshold_search` does not block it. Plus: rank displacement is real and re-labels every prior delta; the story-layer theorem is scoped correctly; and **the rank that decides which trade takes the bullet has no teaching citation in any surface searched.**

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** ALGO-108 @ `7cf09c5f`,
strategy head `6fcb2536` (M1 derivation landed), suite 896/0. **B1 remains CLOSED and unlanded;
nothing from it is on any pushed branch.** **Channel head at drafting:** `c48468c7`. **Main head:**
`c62bb561e015`. **PR #38: DRAFT / DO NOT MERGE.**

## 1. The measurement — and the finding that outranks it

**Size of the loosening:** 91 → **107** at 08:00 (**+25%**), 47 → **53** at 09:30 (**+21%**), every
addition BRK5. **So roughly a fifth to a quarter of break-family selectivity came from
`body_frac 0.62` / `close_loc 0.78` rather than from the taught sentence** — the number ALGO-107
§4 wanted as evidence for M1, and it is substantial.

**RANK DISPLACEMENT [MEASURED].** The predicate proof held **exactly** — **zero** break-family
approvals removed at either pin — and **eleven approvals vanished anyway.** All eleven Route A
REV; **11 of 11 same-bucket displacements**: a newly-admitted BRK5 landed in the same
(session, bucket) as an existing REV, and `kernel.py:205` ranks `BRK5 > REV`.

> **LAW MINTED: A PROOF ABOUT A PREDICATE DOES NOT TRANSFER TO THE PIPELINE THAT CONTAINS IT.**

This is `R-412`'s layer-scoped-proof trap in its sharpest form yet, and **the worker applied it to
its own claim**: its ALGO-106 line *"B1 can only ADD"* is recorded as **measured true scoped to
break-family approvals and false as a system claim**, rather than defended by its scoping. My
ALGO-107 §1 carried the same sentence and inherits the same correction — **owned here.**

## 2. ASK 1 — YES, displacement changes the campaign's model of the flood

**Every earlier Route A before/after in this campaign silently carries this coupling.** 40 → 143 →
91 → 107 were never pure story-layer effects; a cross-route rank interaction was mixed into each.
**ORDERED for every future delta: report membership PER ROUTE, not only in total.** Prior deltas
are re-labelled as *containing an unmeasured cross-route coupling* — **not retracted**, because
every load-bearing conclusion this campaign rests on is a **per-key** statement (the control by key
and target, the two hits, T3″'s two-session recovery), and per-key statements are immune to a
coupling that moves totals.

## 3. ASK 2 — the theorem, and it must be stated SCOPED or it is false

The worker asks whether a story-refused clock returning through the break family means story-layer
repairs *cannot* lower the bullet **by construction**. **Not in general — and the precise form
matters:**

> **A STORY REFUSAL IS EFFECTIVE ONLY AT BUCKETS WHERE NO HIGHER-RANKED ROUTE ALSO QUALIFIES.**

On 03-24 at 08:12 a break route did qualify, so T3″'s refusal was nullified and the bullet moved
**earlier** (08:17 → 08:12). At the 09:30 pin no break route qualified at the relevant buckets, so
**the same clause recovered two sessions.** Both facts are measured; the absolute claim would
contradict the second. **Story-layer repairs can move the bullet — just never where the break
family also qualifies at that bucket.**

**A bucket has one door per route, and refusing one door does not close the others.** That is the
architectural fact the campaign was missing, and it belongs in the handover as such.

## 4. NEW OBJECT, MEASURED HERE — the rank is untaught

`kernel.py:205`: `rank = {"BRK5": 3, "BRK15": 2, "REV": 1}`, applied as
`max(candidates, key=(rank, location.quality, location.confluence))`.

**Surfaces searched at head `6fcb2536` and NAMED** (ALGO-087's requirement): `spec.json` ·
`video_evidence.md` · `engineer_onboarding.md` · `trader_fidelity_addendum_2026_08_20.json` ·
`key_level_semantics.json`. **No citation for route precedence in any of them** — the only
`priority` hits govern *levels* and *targets* (`first_reaction_priority`,
`prioritize_relevant_nearby_levels`), never which route outranks which. Stated per ALGO-087 as
**"no citation found in the surfaces named"**, not as proof of absence.

**So an untaught precedence decides which trade takes the bullet whenever two routes qualify at one
bucket** — and it is exactly the machinery ALGO-099 §6c found had no implementing predicate for
`FIRST_A_PLUS`. **NAMED FOR GPT, NOT OPENED:** a ranking change cannot be derived, guarded and
examined in the time remaining, and a rank altered without a guard would silently rewrite every
bullet in the corpus.

## 5. M1's DERIVATION — RATIFIED, and its sharpest finding is not a threshold

**Ratified as landed** (`6fcb2536`), with three results that stand on their own:
1. **Ten magnitudes reach admission; FIVE are carried inside expression strings** and are invisible
   to any audit that reads only the JSON's numeric leaves. **That is a census-surface law in its
   own right** — a magnitude hiding inside a string is a magnitude no numeric sweep will ever find.
2. **ZERO of ten carries a teaching citation** — every *concept* taught, no *magnitude*. And the
   worker's first scan said "4 of 10 cited" where **every hit was noise** (`2` and `4` from
   "MNQ v2.4", `40` from inside a sha256, `1.5` from an audio chime's `duration_seconds`), so it
   **removed the `cited:true` column entirely** rather than ship a number search cannot support,
   and proved absence with a positive control facing the same filter. **That is the correct
   response to an instrument that cannot answer the question asked of it.**
3. **THE SHARPEST GAP IS A SHAPE, NOT A THRESHOLD — and it is a ratified rule that was never
   built.** The builder draws a **symmetric** band, `max(4 ticks, 0.06·ATR)` each side, floor 2.0
   pts full width. **ALGO-071 §3 and ALGO-073 ratified his band as ASYMMETRIC — top of the
   rejection wick to that candle's close** — measured against his own volunteered demo to
   **0.59/0.60 pts on both edges** (ALGO-089), with teaching bands spanning **~4–32 points**.
   **The code's band is narrower than the narrowest anyone measured, and the wrong shape.**

**Why this outranks everything else left:** it is **not** a threshold, so
`anti_overfit.no_threshold_search` does not block it; it is **already ruled**, so no new derivation
is needed; and a wrong zone *shape* propagates into every layer this campaign has measured —
**how many zones exist** (the map), **whether a bar "touches" one** (the story), **how far past the
band a fill lands** (ALGO-102A), and **where the next destination sits** (ALGO-102 §3). **It is the
same failure this ladder has now found five times: a ruled clause that never reached the code.**

## 6. Disposition and the remaining day

**Nothing further lands.** B1 stays closed and unlanded; the T3″ batch stays **UNRATIFIED-FOR-FREEZE**;
the engine-crash defect stays carried and documented.

**ORDERED, in priority order, and the first is the deliverable that matters most after sunset:**
1. **Fold §5.3 into the handover as GPT's FIRST TASK**, with its citations (`ALGO-071 §3`,
   `ALGO-073`, `ALGO-089`'s 0.59/0.60-pt measurement) and the executable site of the symmetric
   builder — stated as a **ruled-but-unbuilt** item, not as a new proposal.
2. Add §3's architectural fact (**one door per route; refusing one does not close the others**),
   §4's untaught rank, and §2's per-route reporting requirement to the handover's traps section.
3. The reserved-class asks stay **drafted and unsent**: what makes a level worth watching, and
   what the stop is measured from.

## 7. Conduct

The failing test on the landed head was found **only because B1's build ran the suite** — a test
pinning ONE shared list for both arms, true until T3″ landed and re-exam #3 regenerated the
artifacts. **The anchor did not move** (frozen 5/8, sha256 untouched — checked, not assumed), and
the repair pins each arm separately so a swap goes red, with a 3-defect battery and a byte-exact
restore. The worker also **deleted a decorative assert it had just written and measured RED**,
because the exact-equality assert above it always fired first — **a test that cannot be the failing
line is decoration, and removing your own new work on that ground is the standard.**

LESSON: I ratified "can only ADD" as though a predicate proof settled a system question. It did
not, and the eleven vanished approvals are the receipt. **Scope every proof to the object it
quantifies over, and name the pipeline the object sits in before predicting the pipeline's
behaviour.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
