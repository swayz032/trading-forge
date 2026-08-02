# SURFACE B — POPULATION FREEZE (PRE-REGISTRATION)

**Authored 2026-08-02 at ruling `R-588`, by the advisor desk.**
**Owner: THIS DESK.** Surface `B` was named at `R-529`, recorded as *"an open
obligation on THIS DESK, not on the worker"*, and left unassigned for `58`
rulings. This document is the first act of taking it.

---

## 0. WHAT THIS DOCUMENT IS, AND WHAT IT IS NOT

**IT IS** a pre-registration: the KEYING, the population-derivation RULE, the
fidelity axes, the consumer profile, and — written before any Surface-`B` number
exists — **what would make this freeze WRONG.**

🛑 **IT IS NOT the freeze itself, and it is not a result.** No Surface-`B`
population has been enumerated. No Surface-`B` number is claimed anywhere below.
Any reader who takes a count from this file has taken it from the SEED (§5),
which is a different population and is labelled as such at every occurrence.

★★★★★ **`A PRE-REGISTRATION READ AFTER THE RESULT IS A RATIONALISATION.` The
whole value of this file is its timestamp relative to the data, so it is
committed BEFORE the enumeration work begins, in its own commit, and never
edited to match an outcome. Corrections get a dated correction block, not a
silent rewrite.**

---

## 1. WHY SURFACE B EXISTS — AND WHY IT IS THE ONLY THING THAT ENDS PHASE 1

`BLUEPRINT-V4-DRAFT.md §15.6a` (adopted `R-529 §5`) splits Phase 1 in two:

| | surface | what closing it buys |
|---|---|---|
| **A** | **PARITY INSTRUMENT** — `P0-vNext` | **"qualifies the INSTRUMENT. Does NOT advance Phase-1 exit."** |
| **B** | **TIER-A COMPILE-FIDELITY GATE** | **"THIS is the surface Phase 1 exits on."** |

**BINDING, from the same section:** `BLUEPRINT PHASE 1 MAY NOT CITE ANY P0-vNext
GREEN AS COMPILE FIDELITY.`

---

## 2. THE ANCHOR — THE BAR IS NOT MINE TO SET, AND THAT IS DELIBERATE

**Phase-1 EXIT CRITERION, verbatim and unchanged since `R-055`/`R-401`:**

> *"≥1 tier-A spec compiles with ALL load-bearing conditions concretely bound
> AND the compile-fidelity forensics gate passes calibration."*

★★★★★ **THIS DESK DOES NOT GET TO CHOOSE THE BAR, AND SAYING SO IS AN
ANTI-GAMING DEVICE, NOT A COURTESY.** I read the SEED's score (§5) BEFORE writing
this file. **A desk that has seen a `0` and then authors the criterion is a desk
that can lower it without noticing.** The criterion above predates this seat by
hundreds of rulings and is quoted, not restated. **What is mine to define is the
POPULATION and the AXES — and §6/§7 constrain those by RULE precisely because
that is where I could still flatter the result.**

---

## 3. KEYING

Minimum key, per `§15.6a`:

```
tier_a_spec_id × condition_id × fidelity_axis
```

Each row additionally carries, non-optionally:

- `spec_content_hash` — the exact spec bytes the row was adjudicated against
- `extraction_sha256` — the extraction the spec derives from
- `load_bearing` — `true|false`, with the adjudication basis named
- `authority_citation` — the source authority for the load-bearing call
- `bind_status` — `BINDS | APPROXIMATED | UNBOUND`
- `disposition_ruling` — the ruling id, where a condition was dispositioned

🛑 **A row missing `spec_content_hash` or `authority_citation` is INADMISSIBLE,
not defaulted.** `absence-means-maximum-scope`: an absent constraint widens
scope, so it fails closed.

---

## 4. POPULATION-DERIVATION RULE — STATED BEFORE THE POPULATION IS ENUMERATED

★★★★★ **THE RULE IS WRITTEN FIRST AND THE MEMBERS ARE COMPUTED FROM IT. A
HAND-PICKED MEMBER LIST IS HOW A DENOMINATOR GETS FLATTERED, AND `n_selected`
IS EXACTLY THE FIELD THAT COULD BE QUIETLY TRIMMED.**

1. **Admission is by RULE over the current certified-clean tier-A corpus**, never
   by enumeration-then-justification.
2. **Fail-closed on partial cleanliness** — the seed's own `selection_rule`
   already does this (`n_clean == n_strategies` keep all · `n_clean == 0` drop
   all · **partial → fail closed**) and it is INHERITED, not re-derived.
3. **Every dropped member is named with its reason**, in the artifact, as a row —
   never as a count. A drop that appears only as a decremented total is a silent
   population edit.
4. **The rule is executed by committed code with a committed output**, not by a
   session transcript. `census-prompt`: the C8 census's lesson is that the
   instrument must be a file in the repo.

---

## 5. THE SEED — `be194136` — AND WHY IT SEEDS BUT DOES NOT DEFINE

**Artifact:** `docs/replay-results/h1-battery/tier-a-compile-census.json`
(`111,683` B, blob `23f30eb0…`), generator
`docs/replay-results/h1-battery/tier_a_compile_census.py`, committed at
`be194136`.

🛑 **`§15.6a` FORBIDS ITS PROMOTION, and this is the defect that killed six `P0`
attempts:** *"`A HISTORICAL POPULATION CAN SEED A CURRENT FREEZE; IT CANNOT
BECOME THE CURRENT DENOMINATOR BY RETAINING THE SAME CAPTION.`"* Its
`extraction_source` is session-temporary and its `SUPERSESSION_MARKER` is
RANKING-scoped — sound for what it counted, in July, on that corpus.

✅ **PROVENANCE MADE DURABLE AT `R-588` `[MEASURED HERE]`.** The census named its
only `extraction_source` as a scratchpad path inside session `d96dba1d`, whose
temp root was last touched `2026-07-12`. It is now preserved in-repo at
`docs/replay-results/h1-battery/tier-a-extraction-provenance/` — `13` files,
`96` KB — and the copy is **proven, not trusted**: every preserved file's
recomputed `sha256` was joined against the census's own
`specs[].extraction_sha256`, recorded three weeks earlier. **`11` matched, `2`
are the declared `dropped_not_clean` pair, `13` total. CONFIRMED, and re-verified
against the COMMITTED git objects rather than the working copy.**

⚠️★★★★★ **AND THE PRESERVATION BROKE ITS OWN JOIN ON THE FIRST ATTEMPT, RECORDED
BECAUSE IT IS THE MORE USEFUL HALF:** git normalised `CRLF→LF` on commit, every
one of the `13` files lost `74–114` bytes, and **`13 / 13` stopped hashing to the
census's recorded values.** A fresh checkout would have failed the join and read
as *bad provenance* rather than as a line-ending filter. Fixed with
`* -text`. ★★★★★ **`A PRESERVATION THAT REWRITES BYTES IS NOT A PRESERVATION —
AND THE WORKING COPY CANNOT SHOW YOU THAT. ONLY THE COMMITTED OBJECT CAN.`**

### 5a. PRIOR EVIDENCE FROM THE SEED — **THE SEED'S NUMBERS, NOT SURFACE `B`'s**

`[MEASURED HERE, at the census artifact]` — recorded because it sets the honest
scale of the remaining work, and labelled at every occurrence as the SEED's:

```
bind_status, all 99 conditions      : UNBOUND 47 · APPROXIMATED 47 · BINDS 5      (sums to 99)
bind_status, 53 load-bearing (spine): UNBOUND 28 · APPROXIMATED 25 · BINDS absent (sums to 53)
eligible, strict criterion          : 0 of 11
eligible, narrower spine-only       : 0 of 11
```

🛑★★★★★ **ZERO OF `53` LOAD-BEARING CONDITIONS BIND. All `5` `BINDS` in the whole
census are on NON-load-bearing conditions.** ✅ **The absence is proven, not
inferred from a missing key: the emitter DOES emit `BINDS` when non-zero (it
prints `5` in the all-conditions bucket — that is the positive control), and the
spine partition `28 + 25` sums exactly to the declared `n_spine_or_trigger = 53`,
so there is no room for an unemitted third bucket.**

⚠️ **WHAT THIS DOES AND DOES NOT LICENCE.** It is `[ARTIFACT-SOURCED]` evidence
about the JULY population under the JULY classifier. It does **NOT** transfer to
Surface `B` — that is the same caption-transfer error `§15.6a` forbids, and
inheriting a `0` would be as wrong as inheriting an `11`. **What it licenses is
one expectation: the gap between "the instrument works" and "≥1 spec fully
binds" is LARGE, and no `P0-vNext` result of any colour will shrink it.**

---

## 6. FIDELITY AXES — DECLARED NOW, SO THEY CANNOT BE CHOSEN LATER

`fidelity_axis` is a **CLOSED enumeration with a mandatory residual.** Per
`advisor-ruling §4`: *every ordered taxonomy owes a RESIDUAL category, or the
classifier must mis-file or stay silent — and both hide the finding.*

| axis | question it answers |
|---|---|
| `CONDITION_PRESENCE` | is the taught condition present in the compiled spec at all? |
| `CONDITION_SEMANTICS` | does it mean what the source taught (ordering, not one-bar AND)? |
| `BINDING_CONCRETENESS` | is it concretely bound, or approximated, or unbound? |
| `OVERLAY_SEPARATION` | is framework-owned risk/stop/target/sizing kept out of source logic? |
| `AXIS_UNCLASSIFIED` | **RESIDUAL — FAILS CLOSED.** Never silently dropped, never defaulted. |

🛑 **`AXIS_UNCLASSIFIED > 0` makes a Surface-`B` result INADMISSIBLE until
adjudicated** — it may not be netted out, and it may not be reported as a
footnote to an otherwise-green number.

---

## 7. CONSUMER PROFILE — FROZEN BEFORE ANY RESULT IS READ

**Who consumes a Surface-`B` row, and therefore what a row must survive:**

1. **The Phase-1 exit declaration** — consumes `load_bearing` + `bind_status`
   per spec. This is the only consumer that can END Phase 1.
2. **The compile-fidelity forensics gate** — consumes `CONDITION_SEMANTICS` and
   `OVERLAY_SEPARATION`; it is the exit criterion's SECOND leg and it is
   independent of leg one.
3. **Phase-2 battery attribution** — consumes the frozen profile to fill the
   `compile-fidelity-loss` bin of `v3-1`'s four-bin failure attribution.

🛑 **CONSEQUENCE, STATED NOW SO IT CANNOT BE NEGOTIATED LATER:** because consumer
`3` is Phase 2's attribution bin, **a Surface-`B` profile that changes after
Phase 2 starts retroactively invalidates every wave verdict read through it.**
That is why it freezes here and not at first use.

---

## 8. WHAT WOULD MAKE THIS FREEZE WRONG

**Written before any Surface-`B` number exists. Any one of these fires ⇒ the
freeze is re-opened by a dated ruling, never quietly amended.**

1. **The seed's `11 / 99 / 53` appears as Surface `B`'s denominator anywhere** —
   under any caption. This is the named `stop condition` in `R-588 §6`.
2. **The population-derivation rule (§4) is executed and the member list is then
   hand-edited** — in either direction.
3. **`AXIS_UNCLASSIFIED` rows are netted out, defaulted, or footnoted** rather
   than blocking admissibility.
4. **A row credits `BINDS` without `spec_content_hash` + `authority_citation`.**
5. **The exit bar in §2 is restated in different words** — restatement is how a
   criterion drifts; it is quoted or it is not used.
6. **Any Surface-`B` count is published before this file is committed** — that
   would make the pre-registration retrospective, which is the one defect it
   exists to prevent.
7. **The `tier-a-extraction-provenance` copy stops hashing to the census's
   `extraction_sha256`** — the join in §5 is load-bearing and it has already
   broken once.

---

## 9. NOT FROZEN YET — THE HONEST OPEN LIST

`[UNENUMERATED — OPEN]`, and named so nobody reads §1–§8 as completeness:

- **Surface `B`'s current membership and `N` are UNKNOWN.** `§15.6a` requires
  current re-ranking, exact spec hashes, load-bearing adjudication and this
  profile freeze first. **Only the last of those is done by this file.**
- **Whether the current certified-clean tier-A corpus is the July corpus.** Not
  measured. Must not be assumed from the seed.
- ~~**Load-bearing adjudication authority** — `§2`'s criterion has a STRICT and a
  SPINE-ONLY reading and the seed scored `0` under BOTH. Which one binds Phase-1
  exit is **an open desk question**, and it must be settled BEFORE members are
  scored, not after.~~ **→ SETTLED. See the correction block below.**

### ✅ DATED CORRECTION — 2026-08-02, `R-589`: THE LOAD-BEARING READING IS SETTLED

**Appended as a dated block, NOT a rewrite of §9, because `§0` of this file
forbids editing a pre-registration to match a later state. The struck line above
stays legible.**

🛑 **RESOLUTION: the STRICT reading binds. SPINE-ONLY has NO AUTHORITY ANYWHERE.**

**AUTHORITY, found and now preserved `[MEASURED HERE]`:**
`docs/designs/survivor-forensics-preregistration-2026-07-19.md` **§0 — "LOAD-BEARING
— THE DEFINITION THIS PROTOCOL RUNS ON (frozen now; it was the gameable hole)"**:

> *"R-042 §5 makes survivor eligibility turn on 'load-bearing conditions
> concretely bound' but **no artifact in the pipeline defines or carries the
> term. Frozen here:** … **DEFAULT: every taught condition is LOAD-BEARING.** A
> condition is non-load-bearing ONLY by a written per-condition disposition
> produced at compile time … **No field → treated as `true`.** … This is the
> conservative direction: **over-inclusion makes eligibility harder, never
> easier.**"*

✅ **AND IT RESOLVES `R-042 §5`'s DEFERRED THRESHOLD, which was the open half of
`§2`'s anchor.** `R-042 §5` said the threshold would be *"set from the post-wire
measured distribution, not guessed now"*; forensics §0 leg (ii) froze it:
**"every load-bearing condition is concretely bound — `approximation=False` —
CATEGORICALLY; no threshold."** **So the bar is categorical, and `§2`'s anchor is
now complete rather than partially deferred.**

✅ **SPINE-ONLY REFUTED BY ABSENCE, WITH A POSITIVE CONTROL `[MEASURED HERE]`:** no
ruling in `ADVISOR-RULINGS.md` narrows the load-bearing set to spine/trigger —
**positive control: `grep -c 'load-bearing'` over the same file returns `159`, so
the instrument reads this file and this term fine.** The spine-only phrasing
exists ONLY inside the census artifact, self-described as *"narrower reading"*,
carrying no citation. ★★★★★ **`A READING THAT APPEARS ONLY IN THE ARTIFACT IT
WOULD FLATTER IS NOT A READING; IT IS A GOALPOST.`**

⚠️★★★★★ **THE AUTHORITY WAS UNTRACKED WHEN I FOUND IT.** That 18,840-byte file —
the sole definition of the term Phase 1 exits on, written expressly to close *"the
gameable hole"* — **was not in version control.** Preserved in the same wave, with
seven other cited-but-untracked authorities including `SEAL-GO.token`. **`A
DEFINITION THAT EXISTS ONLY IN A WORKING TREE IS ONE `git clean` FROM MAKING THE
EXIT CRITERION UNDEFINED AGAIN — SILENTLY, AND WITH EVERY DOCUMENT STILL CITING
IT.`**

✅★★★ **WHY SETTLING IT NOW IS SAFE RATHER THAN CONVENIENT, STATED BECAUSE THE
TIMING IS THE WHOLE QUESTION: the seed scores `0` under BOTH readings
(`n_eligible_strict = 0`, `n_eligible_spine_only = 0`). **THE CHOICE CANNOT
FLATTER ANY NUMBER THAT CURRENTLY EXISTS** — which makes this the cheapest and
least corruptible moment the campaign will ever have to fix the reading. Deferring
it until a population scores non-zero is exactly when it becomes corruptible.**
- **Population overlap** among tier-A, `corpus_A` and `POP-120` — `§15.8` lists
  it as bounded-open and it is not closed here.

---

## 10. NEXT ACTION

**Owner: this desk.** Settle `§9`'s load-bearing adjudication reading, then
execute `§4`'s rule as committed code against the current corpus. **No Surface-`B`
number is read until both are done and this file is committed.**
