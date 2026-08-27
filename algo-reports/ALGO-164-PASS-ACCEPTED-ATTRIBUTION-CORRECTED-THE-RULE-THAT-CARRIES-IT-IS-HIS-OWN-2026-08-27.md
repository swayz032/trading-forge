# ALGO-164 — **THE PASS IS ACCEPTED, THE SELF-REFUTATION IS RATIFIED, AND THE CORRECTED ATTRIBUTION IS BETTER THAN THE CLAIM IT REPLACES: THE RULE CARRYING THIS BUILD IS `REPETITION COUNT`, WHICH IS BOTH PUBLISHED PRACTICE *AND* HIS OWN FROZEN TEACHING — TWO INDEPENDENT PROVENANCES WHERE THE SPEC CLAIMED ONE.** **[VERIFIED HERE at `de7e43fd`] `MEMBERS_ONLY` reproduces the entire result — `17 of 28`, identical to `AS_BUILT` and to `NO_CONFLUENCE`. 🛑 AND `CONFLUENCE_ONLY` SCORES `6` — WORSE THAN v2.4's `13` ON A MAP `12.4×` SMALLER. THE RANK THE SPEC CALLED "THE WHOLE BUILD" IS NOT MERELY INERT; RANKED ALONE IT IS THE WORST ARM MEASURED.** **The sort key is `(-confluence, -members, -last_t)` and confluence is flat on 62% of candidates with `5M_REACTION_CLUSTER` firing `203 of 203` ⇒ `members` was always the operative key. `3.00` zones a session against `37.3`, `17 of 28` against `13`, adverse branch checked directly and did not fire.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `0141909d`.
**Strategy head `de7e43fd`.** **PR #38: DRAFT / DO NOT MERGE. v2.4 unedited and unmoved in both runs.**

---

## 1. RULING ON QUESTION 1 — **THE PASS IS ACCEPTED. IT CERTIFIES THE OUTPUT, NOT THE MECHANISM.**

**Accepted, and your reasoning is right.** Acceptance was pre-registered in ALGO-161 §4 on **outputs**
(`≤5 zones a session` AND `>13 of his 28`), at `4e823af4`, before any builder existed. **Both hold:
`3.00` and `17`.** **And you checked my adverse branch DIRECTLY rather than inferring it** — `0 of 28`
covered only by dropped ranks 4-6 — **which is the difference between a pre-registration honoured and
a pre-registration recited.**

> ## **AN ACCEPTANCE TEST CERTIFIES WHAT IT MEASURED. IT MEASURED OUTPUTS, SO IT CERTIFIES OUTPUTS. A MECHANISM CLAIM RIDING IN THE SAME DOCUMENT INHERITS NONE OF THAT AUTHORITY — AND THIS ONE IS NOW REFUTED WHILE THE PASS STANDS.**

**`MNQ-SR-CLEANROOM-SPEC.md` §1 — *"Rule 4 is the whole build … confluence count IS the rank"* —
is marked `REFUTED IN PLACE`, with the ablation cited beside it. NOT rewritten, NOT deleted.** A spec
that quietly becomes correct is a spec nobody can audit.

**🛑 AND THE CORRECTION IMPROVES THE RESULT RATHER THAN WEAKENING IT.** The operative rule is
**published Rule 3 — *"priority to areas price has reversed at least 2-3 times"*** — which is **also
his own frozen teaching**: *"multiple independent reactions strengthen a key level."* ⇒ **the build now
rests on a rule carrying TWO independent provenances (outside practice + his corpus) where the spec
credited one.** **Both were pre-registered in ALGO-161 §2 before any run, so correcting WHICH of them
did the work is not post-hoc selection — it is fixing a misattribution inside a fixed set.**

## 2. RULING ON QUESTION 2 — **RETIRE THE CLAIM. DO NOT TOUCH THE CODE. DO NOT RE-DERIVE THE FAMILIES.**

| arm | covers his 28 |
|---|---:|
| `RECENCY_ONLY` | **22** |
| `AS_BUILT` · `NO_CONFLUENCE` · `MEMBERS_ONLY` | **17** |
| **`CONFLUENCE_ONLY`** | **`6`** |
| *v2.4, `37.3` zones/session* | *`13`* |

**`CONFLUENCE_ONLY = 6` is the finding under the finding.** Inert would mean *"contributes nothing."*
**Ranked alone it is the worst arm measured — worse than the 37-zone map it was supposed to improve
on.** ⇒ **there is no repair case. A term that is flat where it must separate and harmful where it
does separate is not undertuned; it is the wrong quantity.**

**Your refusal to re-derive a discriminating family set is RATIFIED and it is the sharpest call in the
packet:** *"pick families until the rank separates is threshold search wearing a different hat."*
**Exactly so — and it would be worse than a threshold search, because it would be searching over the
DEFINITION of the predicate rather than over its value.**

**Disposition: the CLAIM is retired; the CODE is not edited.** `mnq_sr_cleanroom_v1.py` is a **frozen
test artifact** and editing it after its test — even to delete something provably inert — is the habit
that makes commit-order proofs worthless. **`NO_CONFLUENCE == AS_BUILT == 17` is recorded as the
licence for any SUCCESSOR build to drop it, citing this ablation. This build stays exactly as it ran.**

## 3. 🛑 RULING ON `RECENCY_ONLY` — **NOT ADOPTED. AND ONE OF YOUR THREE REASONS IS WRONG, WHICH MATTERS.**

**Your restraint is correct and the declaration written into the runner BEFORE it ran is the right
instrument.** `TOP_PER_SESSION` never moved in any arm — **verified, so my forbidden third run did not
happen.** But the three reasons are not equal and the weakest should not be load-bearing:

| your reason | ruling |
|---|---|
| *"recency is not one of ALGO-161's four published rules"* | **🛑 WRONG, and the error is mine.** Recency **is** published S/R practice (levels decay), and it is **already in v2.4's own composite** — a `recency` term at `0.15` weight with a `recency_half_life_days` parameter. **My four-rule list was a summary of one search, not an enumeration of the literature**, and treating it as a closed set is `[unenumerated-ladder]` — *never treat a list you cannot exhaustively name as a denominator.* |
| *"taking it because it scored 22 selects by what it does to the fourteen sessions"* | ✅ **DECISIVE. This alone settles it.** |
| *"it may be a labelling artifact — recent levels are nearest the session he drew for"* | ✅ **The sharpest observation in the packet, and it cuts both ways: it may equally be a REAL fact about how he trades. This instrument cannot separate them, which is precisely why it cannot license the choice.** |

⇒ **`RECENCY_ONLY` is NOT adopted, and it is RECORDED as the campaign's strongest open hypothesis.**
**It must be tested where it cannot be contaminated: out-of-sample, on history that is not these
fourteen sessions.** **Do not re-run it against them in any form.**

**AND THE REASON THE LANE MUST NOW CLOSE:** **these 14 sessions have been scored `2` runs and `5`
ablation arms deep.** **Every arm scored against a fixed test set spends some of its independence, and
nothing replenishes it** — collection is closed by operator order. **This test set is nearly spent, and
that is a resource fact, not a criticism of any run.**

## 4. RULING ON QUESTION 3 — **THE LANE CLOSES HERE, AS A COMPLETED COMPARISON.**

**What it delivered, stated at its true size:**

| | clean-room | v2.4 |
|---|---:|---:|
| zones per session | **`3.00`** | `37.3` |
| his 28, pad `0.00` | **`17`** | `13` |
| his 28, pad `10.00` | `20` | **`25`** |

**Both pads travel together, as ordered.** **It still loses at pad `10.00`, and that is what `37` zones
buy — blanket coverage, not precision.** **No profitability claim: no PnL read, R-geometry frozen and
untested.**

> ## **A MAP `12.4×` SMALLER THAT CONTAINS MORE OF HIS ACTUAL LEVELS, BUILT FROM PUBLISHED PRACTICE AND HIS OWN TEACHING, WITH NO FITTED NUMBER AND NO READ OF THE TEST SET DURING CONSTRUCTION. THAT IS THE FIRST THING THIS CAMPAIGN HAS PRODUCED THAT MOVES A NUMBER IN THE RIGHT DIRECTION FOR A REASON IT CAN NAME.**

**And it settles the question ALGO-158 could not:** the object was reachable. **It was never reachable
by a threshold — `[predicate-proof-not-pipeline]`, `[rank-faithful-map-is-the-defect]` and three days
of tuning lanes all held — it was reachable by a rule of a different KIND, and `members` is that rule.**

## 5. AUTHORIZED — THE NEXT GATE IS THE OPERATOR'S STATED DESTINATION

**He has said it twice and it has never been actioned: *"ENGINEER THE BREAKTHROUGH so we can head back
to BACKTEST, MONTE CARLO … we need to make sure we find a EGDE but NO OVER FITTING."***

**The map was never the profitability question. `[the-edge-is-target-geometry-not-levels]` is, and it
remains completely untested:** his median target `66.1` pts = `3.83R` against the bot's realised
`20.68` pts = `1.16R` — **`−0.18R`/trade against `+1.3R`/trade at 38% wins.**

**AUTHORIZED — build `MNQ-SR-CLEANROOM-v2`, a RUNNABLE strategy, not a map:**
1. **The v1 map builder, unchanged** (`members` rank; confluence droppable per §2, citing the ablation).
2. **Wire it to entry, stop and target:** `17.25`-pt stop · **the `3.83R` target geometry as a FROZEN
   INPUT** · one A+ trade per session · window `08:00-12:00` · direction both, mirrored.
3. **FREEZE and COMMIT the whole thing before any backtest runs.** `FIDELITY → FREEZE → CLEAN EDGE`
   is the standing order and **no Monte Carlo runs before the freeze.**

**🛑 THE FOURTEEN SESSIONS ARE OUT OF SCOPE FROM THIS POINT.** Not as a map reference, not as a scoring
set, not as an ablation target, **not as a sanity check.** They are spent. **The backtest runs on the
full contiguous history** — `[nq-ratio-adj-parquet-history-has-holes]`: **`2020-01`..`2026-03` is the
only contiguous block; 2016/2017/2019 are ABSENT and 2015 dies in warm-up. State the window you use.**

**Not authorized:** any v2.4 edit · any threshold search · any parameter chosen by its backtest result ·
**any adoption of recency** · any Monte Carlo before the freeze · any PnL input to a fidelity decision.

---

**LESSON, minted:**

> **THE BUILD PASSED, AND THE MECHANISM ITS OWN SPEC CREDITED SCORED `6` OUT OF `28` WHEN TESTED ALONE — WORSE THAN THE 37-ZONE MAP IT REPLACED. A RIGHT ANSWER AND A WRONG EXPLANATION ARRIVED IN THE SAME COMMIT, AND ONLY AN ABLATION NOBODY REQUIRED SEPARATED THEM.**

**Nothing in the acceptance test could have caught it.** The outputs were correct, the pre-registration
was honoured, the adverse branch was checked. **A passing test tells you the output is right; it is
silent on WHY, and the why is what the next build inherits.** ⇒ **an inert term that ships inside a
success becomes load-bearing in whatever is built on top of it.**

> **WHEN A BUILD PASSES, ABLATE THE THING YOU CREDITED. THE PASS PROTECTS THE RESULT; IT DOES NOT PROTECT THE STORY, AND THE STORY IS WHAT GETS REUSED.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
