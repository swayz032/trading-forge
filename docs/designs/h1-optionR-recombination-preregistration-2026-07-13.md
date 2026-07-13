# H1 — OPTION R (RECOMBINATION) PRE-REGISTRATION — frozen 2026-07-13, BEFORE the number

> Invoked under the Wave-6 fork license ("options decided there, on that evidence"). This is **NOT pass-3.** The iteration budget stays spent; the pass-2 extractor is frozen at its SHA with **zero changes.** Option R recombines already-independently-graded components; it moves no bar.

## §0 — WHY (what pass-2's own number actually measured)
Pass-2's frozen Gate-3 read 17.5% gated / 17.9% terminal-equivalent **quote-FIELD generation infidelity** — the model's *typed* quote slot is not verbatim (self-checked: 32/34 truly absent; `"5-minut"`, paraphrases; sentinel 0.0% = never abstains). That number measured the wrong anchor. The campaign already owns a band-8 instrument whose whole job is verbatim anchoring **mechanically**: the A-prime `locate_anchor` (PROPOSE via gemma → **VERIFY by mechanical substring+boundary**, owns the truth), which grounded **89% of pilot conditions**. Quote-as-you-extract's real mechanism was never the quote-field-as-anchor — it was **evidence-in-view generation discipline** to cure the ~25% condition-drift disease. Whether pass-2's conditions (written with the trader's words in the window) are more faithful is **the number nobody has measured**, because the frozen gate correctly read the generated quotes instead.

## §1 — THE PIPELINE (frozen, one-pipeline rule)
1. **Pass-2 extractor — FROZEN as-is** (zero changes; not pass-3).
2. **Generated `transcript_quote` field — DEMOTED to generation-scaffolding.** Its 83% infidelity is documented; **it is NEVER the anchor.**
3. **Band-8 `locate_anchor` — the anchor authority** (as it was in the pilot): PROPOSE (gemma, may abstain) → VERIFY (mechanical substring, owns the truth).
4. **Mechanical substring verification** — the locator's VERIFY stage is the sole truth of "anchored."
5. **The standing rater protocol** — unchanged, downstream.

**ONE-PIPELINE RULE:** pass-2's extractor throughout; **no per-video cherry-picking among extractor generations. Ever.** One extractor, one locator, measured as one pipeline.

## §2 — THE MEASUREMENT (spent-16 design pool ONLY, first)
Over pass-2's **already-extracted conditions** (the 195 `quote_bearing_rows_for_one_rater_pass` from the pass-2 report — same `condition_text`, same `field`, same `video_id`), run `locate_anchor(full_transcript, condition_text)` per condition. The generated quote field is ignored entirely.
- **Support = located / conditions.** Report **BOTH numbers** (§12 discipline): gated-comparable (over the 194 non-null) AND terminal-equivalent-comparable (over all 195, locator-declined counted as a miss — the number the fresh-12 reproduces).
- **The FROZEN bar — UNCHANGED, no goalpost motion:** ≥92% support / **≤8% miss.** Same bar the pilot conveyor used.
- One-rater pass, spent-16 design pool only. The sealed 12 are **not touched.**

## §3 — PRE-COMMITTED, BOTH WAYS
- **CLEARS (≤8% locator-miss)** → the recombined pipeline **freezes**, and the sealed 12 get their **terminal read** in the clean room whose shape has been frozen for a day (fresh conductor, 2 blind raters, read once, ≥60% all-conditions-clean, economics rider — bar UNCHANGED).
- **MISSES (>8%)** → the **deeper fork fires with ALL evidence in hand** — cloud-model extraction as a fresh pre-reg, human-extraction economics, or source decisions. Option R will have cost one cheap measurement of components that already existed.

## §4 — DIRECTION-CHECK ON THE RULING (on the record, operator-authored)
Option R **can fail** — the design-pool measurement is fully capable of coming back <92%, and then the deeper fork fires having lost almost nothing. It recombines **only independently-graded components** (pass-2 extractor: shipped; locator: band-8). It **moves no bar.** It is **not** motivated reasoning about a beloved architecture — it is the observation that the pilot's conveyor already solved anchoring mechanically, and the iteration replaced a working mechanical anchor with a generative one as a *side effect* of chasing condition-drift. **Measure the drift cure under the working anchor before buying a bigger model.**

## §5 — THE REFRAME (fidelity's three entry points)
"The human-in-loop adjudication IS the extraction system" was almost right: **the raters are the CERTIFICATION system; extraction still needs an extractor.** The open question is only *where fidelity enters*: **model discipline** (pass-2's contribution), **mechanical anchoring** (the locator's), or **judgment** (the raters'). Option R **stacks all three** — which is the architecture the pilot already proved end-to-end at 0/16, *with a worse extractor than we have now.*

## §6 — PARALLEL, INDEPENDENT: the 5 blind adjudications
Gate-2's record closes **regardless of the fork road.** The 5 over/under-split escalations get fresh-context **blind** adjudication (no baseline count, no pass-2 count shown) in parallel with §2:
- **Over-split / fabrication candidates (§13, >2-of-16 = systematic):** E9MzEC_yNoM (pass-2→3), IyFioFkRgWo (pass-2→2, known-1), kFyD3H6I1I8 (pass-2→2).
- **Under-split / silencing candidates (§9b strict-fail; unrecoverable direction):** -igpOZs8LsM (pass-2→1), R5L890juvRw (pass-2→1).
If ≥3 over-splits adjudicate as fabrications → §13 systematic fires → pass-2 output is suspect for any downstream use → **prunes Option R's option space before spend.** The terminal-read decision lands on the COMBINED evidence: Gate-2 record closed, recombined pipeline's honest number known, one clean room still unspent.

*Frozen 2026-07-13, operator-ruled, BEFORE the design-pool locator number and BEFORE the adjudications return. Vaulted FF.*

---

## PRE-READ ADDENDUM 1 — plumbing-exclusion protocol (dated 2026-07-13, added AFTER freeze, BEFORE the number is read)

The band-8 locator's `_default_propose_fn` RAISES on empty/non-JSON gemma content (a cold-load blip) — correct fail-closed design: it never silently fakes a decline. The Option R measurement therefore wraps the propose call in retry (3×, linear backoff — the blip warms) and, on persistent failure, records the condition as `plumbing_error` and **EXCLUDES it from BOTH numerator and denominator.**

**RATIONALE:** a transient transport blip is not a real anchoring outcome; counting it as a miss would launder plumbing into a fidelity signal. Exclusion is numerator-AND-denominator-neutral — it fabricates nothing.

**DIRECTION-OF-EFFECT: neutral-to-strict.** Exclusion cannot inflate the pass rate of the scored set (see the worst-case line below, which re-counts every exclusion as a miss).

**THREE PINS (operator-ratified):**
1. **This amendment is papered** — written here before the read, so the number is judged against a pre-reg whose text matches the instrument that produced it.
2. **Exclusion cap = 5% of rows (~10 of 195).** Above the cap → the run is **INDETERMINATE-for-instrument-instability**; the remedy is a WARM re-probe of the excluded keys (the tower is already warm), NOT a read on a gutted denominator.
3. **Worst-case sensitivity line in the report** — support recomputed with EVERY excluded row counted as a miss. Verdict survives worst-case → exclusion-robust. Worst-case flips the verdict → INDETERMINATE → warm re-probe before any read.

**SINGLE-EPOCH CONFIRMATION:** the read run uses a FRESH per-condition cache, all 195 rows under the retry-wrapped propose_fn, one epoch — no instrument mix inside the run.

---

## PRE-READ ADDENDUM 2 — §9b FIRES; pass-2 Gate 2 = FAILED (scope = the GATE); merge-silencing named; §2 wiring-verify pending (dated 2026-07-13)

**§9b RULING (operator):** R5L890juvRw is an adjudicated-real under-split (stage-2 blind transcript adjudication: 2 genuine VWAP setups, pass-2 wrote 1). The frozen words leave no discretion — "any real loss fails the gate; one silenced strategy is one too many" (§9b); "under-split = STRICT FAIL" (§13). Medium confidence counts (neither §9a nor §9b qualifies "adjudicated-real" by confidence tier; un-pinned terms resolve to the strictest reading — for an omission-hunting guard, the reading that keeps the net tight). **Pass-2's Gate 2 flips MET → FAILED. Scope = the GATE, not the video, not the campaign.**

This re-opens nothing and forks nothing new: Gate 3 already failed, the budget is spent, the fork already fired. Gate 2 joining Gate 3 completes the honest record — **pass-2 as a certified unit is dead twice over**, the exact state Option R was licensed under (Option R never claimed pass-2 was gate-clean; it claimed the components were honestly graded).

**Phase-A enumeration defect ledger (recorded):** 2 fabrications (§13-handled: excluded/recorded/taxed) + 1 confirmed silencing. **Lower bound ≥1/16 videos silenced** — stated as a LOWER BOUND, never a rate: only baseline-disagreement trips were adjudicated, the baseline was itself wrong in 2 of 5 adjudications, and a merge both instruments agree on is invisible. **Nobody is licensed to quote "1/16" as a rate.**

**THE DISEASE — MERGE-SILENCING (a third class §13's physics never enumerated):** not omission-of-content (17 conditions extracted vs baseline 14 — Phase-B did its job) and not invention. It is fully-taught, fully-anchorable content packaged under WRONG OBJECT BOUNDARIES — two opposite-direction VWAP setups fused into one self-contradictory strategy. It sits in the blind spot of BOTH nets: the coverage lint hunts dropped content (nothing dropped); Stage-2 support hunts unanchorable inventions (every condition anchors — it was taught). Worst harm: at the terminal read each merged condition could individually grade CLEAN while the strategy object is garbage → **merge-silencing could inflate a fidelity verdict.**

**§2 WIRING-VERIFY (owed, claimed-safeguards law, H1 catch #4):** the note "likely self-fails cert on contradictory entries" is a CLAIM. Feed R5L890's ACTUAL merged object (real vault artifact, not synthetic) through the downstream path claimed to catch it (cert compile / contradictory-entry / Stage-2) and OBSERVE. Rejected → recorded, harm-model "corrupt spec never trusted; the two real setups stay untested until re-run", acceptable+taxed. Sails through → CRIT: fence it (ratify-packet, instrument code) before any terminal read or H2 battery, regardless of the locator number.

**SCOPE LINE carried by ANY terminal verdict from here:** "enumeration mis-packaging unmeasured on the sealed set; design-pool lower bound 1/16." (Claim-scoping, not bar motion — read shape/metric/≥60% bar untouched; the precondition only makes the read HARDER to reach — the legal direction.)

---

## §2 WIRING-VERIFY — RESOLVED = CRIT (observed 2026-07-13, real R5L890 object through the real cert path)

Fed R5L890's ACTUAL merged object (real vault artifact, real transcript — two verbatim opposite-direction entries: long trend-continuation `"...we can try our long trade"` + reversion `"use the central vwap as a target"`) through `assemble_certificate`. OBSERVED, not inferred (script `scripts/h1_optionR_R5L890_wiring_verify.py`, report `R5L890_wiring_verify.json`):

| | direction_conflation_lint | **pilot_grade** (terminal-read grade) | full_grade |
|---|---|---|---|
| **CASE A** — terminal reality (no topology / unwired A-packet) | **NOT_EVALUATED** (`no_compiled_topology`) | **TRUE — sails through** | False |
| **CASE B** — counterfactual (A-packet wired, opposite dirs in one and_group) | **FAIL** (correctly catches it) | **TRUE — STILL sails through** | False |

**THE CLAIM "likely self-fails cert on contradictory entries" is FALSIFIED.** Two independent reasons the merge-silenced object is NOT rejected by the terminal-read path:
1. Terminal reality: no topology overlay → `direction`/`and_group` never populate → the conflict is structurally invisible AND `direction_conflation_lint` is NOT_EVALUATED.
2. **Even if the A-packet were wired** (CASE B): `pilot_grade` gates ONLY on `f2_coverage_gate` PASS + `causality_lint` regex-leg PASS — it does **NOT** gate on `direction_conflation_lint`. The lint FAILing is invisible to `pilot_grade`. Wiring the A-packet alone would NOT save the terminal read.

**VERDICT = CRIT.** A self-contradictory spec gets `pilot_grade=True`; each merged condition can grade CLEAN at the terminal read while the strategy object is garbage → merge-silencing could INFLATE a fidelity verdict. Per the pre-committed branch: **FENCE REQUIRED (ratify-packet, instrument code) before ANY terminal read or H2 battery, regardless of the locator number.** The fence cannot be "wire the A-packet" — CASE B proves `pilot_grade` is blind even then; the fence must make the terminal-read grade itself reject a merge-silenced object (opposite-direction entries fused under one strategy with no directional OR-split). `full_grade` correctly rejects both cases (it is the H2 precondition), but the terminal read consumes `pilot_grade`.

*§2 wiring-verify RESOLVED CRIT 2026-07-13. Any terminal read is now BLOCKED on the fence, independent of Option R's number.*
