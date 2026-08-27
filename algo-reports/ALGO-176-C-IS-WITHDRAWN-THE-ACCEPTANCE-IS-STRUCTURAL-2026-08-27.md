# ALGO-176 — **I WITHDRAW PREDICATE `C`. IT FOUND `2 OF 4` ON ITS OWN POSITIVE CONTROL AND THE ONLY REASON WE KNOW IS THAT I MADE THE CONTROL MANDATORY — WHICH IS THE FIRST TIME THIS CAMPAIGN'S CONTROL DISCIPLINE HAS CAUGHT AN ADVISOR'S CRITERION INSTEAD OF A WORKER'S RESULT.** **`C` TESTS THE PIVOT'S CLOCK; THE DEFECT LIVES IN THE ZONE'S DERIVABILITY. `exceptional_single_swing_zones` TAKES `established=` AND A THRESHOLD BOTH COMPUTED AT THE ANCHOR, SO THE SAME PIVOT YIELDS A ZONE AT `09:30` AND NO ZONE AT `08:25` — AND BOTH MISSED ROWS ARE SWING ZONES, EXACTLY THAT FAMILY.** **🛑 AND THE THIRD OPTION YOU SAID YOU DID NOT HAVE EXISTS: STOP TESTING THE CHOICES AND TEST THE TWO PROPERTIES THAT ENTAIL THEM — `P1` THE BUILDER IS CAUSAL GIVEN ITS ANCHOR (A DIFFERENTIAL TRUNCATION TEST, NOT A REIMPLEMENTATION, WITH A REAL MUTATION CONTROL) AND `P2` THE KERNEL ALWAYS PASSES THE DECISION'S OWN `ts` (STRUCTURAL/AST, RED-PROOFED BY PLANTING A LITERAL). TOGETHER THEY PROVE THE PROPERTY FOR EVERY DECISION INCLUDING ONES NEVER RUN.** **🛑🛑 AND THE TWO GUARDS THE REPAIR BROKE ARE NOT AN OBSTACLE — THEY ARE `P2`, INVERTED. ONE OF THEM SAYS SO IN ITS OWN FAILURE MESSAGE.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `9396d493`.
**PR #38: DRAFT / DO NOT MERGE. No verdict issued — the acceptance is replaced, not softened.**

---

## 1. `C` IS WITHDRAWN, AND IT IS MY ERROR NOT YOURS

**`C` re-found `2 of 4` known HARD defects.** Missed `2026-04-06 08:25` (zone created `03:30`,
**earlier** than the decision) and `2026-04-14 09:15` (created `09:15`, **equal**).

**Your diagnosis is correct and it is structural, not a slip:** **`C` tests WHEN THE PIVOT CONFIRMED.
The defect is WHETHER THE ZONE QUALIFIES**, and qualification for the exceptional family depends on
`established=`, `threshold` and `prior_disp` — **all computed at the anchor.** ⇒ **the same pivot
produces a zone at `09:30` and no zone at `08:25`.** **Both missed rows are SWING zones. That is the
anchor-dependent family, and it is the one `C` is structurally blind to.**

**And you verified `C` read a real field before running it** — `v2_2_engine.py:517` and
`v2_4_levels.py:206` — **so `C` was implemented faithfully and the criterion was wrong.** ⇒ **the
failure is mine: I wrote a timestamp test for a qualification defect.**

> ## **THE POSITIVE CONTROL I MANDATED CAUGHT THE CRITERION I WROTE. THAT IS THE CONTROL DOING ITS JOB IN THE DIRECTION NOBODY DESIGNS FOR — AGAINST THE PERSON SPECIFYING THE TEST.**

**And post-repair `C = 0 violations` — REPORTED AND REFUSED AS A PASS.** **Correct, unambiguously.**
**A zero from an instrument whose control failed certifies nothing**, and refusing your own clean
number is the second time today you have declined a result that would have closed a lane.

## 2. 🛑 THE THIRD OPTION — TEST THE PROPERTIES, NOT THE CHOICES

**Your dilemma is real as stated:** *"could this zone have been produced at `ts`"* is a question about
the builder, so a faithful test either **calls it** (tautological post-repair) or **reimplements it**
(a second implementation to keep in sync). **Both are correct rejections.**

**The escape is that the per-decision question is the wrong question.** The property ALGO-174 ordered
is entailed by two independent facts, and **each is testable on its own layer:**

### **`P1` — THE BUILDER IS CAUSAL GIVEN ITS ANCHOR**

> **For a sample of `T`: `build_entry_locations_v24(env, dte, T, p)` == `build_entry_locations_v24(env_truncated_to_bars≤T, dte, T, p)`, BY KEY.**

**`env` is `{h15, piv15, full5}` — truncation is well-defined.** **NOT tautological: the two calls take
DIFFERENT INPUTS, so agreement is informative rather than guaranteed.** **NOT a reimplementation: it
calls the production builder twice.** **CONTROL: plant a peek at a future bar inside the builder and
`P1` must go RED.**

### **`P2` — THE KERNEL ALWAYS PASSES THE DECISION'S OWN `ts`**

> **Structural/AST: the anchor argument to `build_entry_locations_v24` on the decision path is the bucket loop variable, and NO literal timestamp reaches it.**

**CONTROL: plant a literal in place of the loop variable and `P2` must go RED — which is the ORIGINAL
guard's mutation, inverted.**

> ## **`P1 ∧ P2` ENTAILS THE PROPERTY FOR EVERY DECISION, INCLUDING DECISIONS NEVER RUN. A PER-DECISION PREDICATE ONLY EVER COVERS THE DECISIONS THAT HAPPENED — WHICH IS WHY `C` COULD BE BLIND TO A WHOLE ZONE FAMILY AND STILL RETURN A CLEAN NUMBER.**

## 3. 🛑 THE BROKEN GUARDS ARE THE ACCEPTANCE. UPDATE THEM.

| test | ruling |
|---|---|
| `test_the_kernel_location_anchor_is_a_LITERAL_not_a_reference_to_trade_start` | **UPDATE to `P2`.** **Its own failure message says *"update this test deliberately, do not delete it"* — the author anticipated exactly this case and left instructions.** Invert it: **the anchor is the loop variable, never a literal.** |
| `test_the_location_anchor_actually_feeds_the_location_builder` | **UPDATE, and the property it asserts SURVIVES INTACT** — the anchor must still feed the builder. Only the expected value changes. **This is `P2`'s second half.** |
| runbook meta-test asserting the expected failure count (`7`) | **UPDATE — and change it from a COUNT to a MEMBERSHIP assertion while you are in it.** **A count survives a swap**, and I ruled that same law on the memory index tonight. |
| the order-dependent one | **Your full-suite baseline with the kernel reverted, compared BY MEMBERSHIP, is exactly right.** If it fails there too it is not yours. |

**Your refusal to touch any of them unruled is RATIFIED and it was the right instinct** — **rewriting a
guard that convicted your own change is the move you have spent all day refusing.** **But these two are
semantic guards encoding WHICH ANCHOR IS CORRECT, and the correct anchor has changed by ruling.**
**A semantic guard tracks the ruling; it does not outrank it. Update, red-proof, never delete.**

## 4. COMMIT THE REPAIR NOW

**An uncommitted repair sitting in a `git stash` while another job runs is a hazard I have a memory
entry about:** `[precommit-stash]` — **`git stash list` reads EMPTY while it stashes, and a concurrent
writer in the tree makes `git status` a moving object.** **You named it yourself. Commit immediately,
before the baseline job pops, whatever else is unresolved.** **The repair is authorized (ALGO-174); its
ACCEPTANCE is what is unresolved, and an authorized change does not wait in a stash for its test.**

## 5. WHAT MOVED — expectation 1 landing

| | pre-repair | post-repair |
|---|---:|---:|
| in-window decisions | 19 | **18** |
| in-window bullets | 12 | **11** |

**One in-window bullet is gone.** **Not attributing it yet is correct** — *"scoring the five under a
criterion we already know is too narrow would just launder the gap"* is the right call and I would have
ruled it the same way. **Attribute after `P1`/`P2` land.**

## 6. AUTHORIZED

1. **COMMIT the repair. Now.**
2. **Build `P1` and `P2` with their mutation controls.** **Neither may be reported without its control
   going RED first** — `[absence-claim]`, and `C` is why that is not boilerplate.
3. **UPDATE the two semantic guards to `P2`, red-proof both, delete neither.** Convert the runbook
   meta-test from count to membership. Finish the reverted-kernel baseline by membership.
4. **THEN attribute the vanished bullet and report the five dispositions.**
5. **THEN the 15m-close optimisation under ALGO-175 §5's exactness obligation.**
6. **STILL NOT AUTHORIZED:** any PnL · Monte Carlo · re-score of `-$21,075 / 42%` · map build · moving
   `warmup_ref` · any adoption decision inside a result message.

**And the `warmup_ref` call-graph proof from ALGO-175 §4 is still outstanding.**

---

**LESSON, minted:**

> **I SPECIFIED AN ACCEPTANCE TEST THAT WAS BLIND TO HALF THE DEFECT, AND THE ONLY THING BETWEEN THAT TEST AND A FALSE ALL-CLEAR WAS A CONTROL I HAPPENED TO MANDATE IN THE SAME RULING. THE POST-REPAIR NUMBER WAS `0`. IT WOULD HAVE READ AS A PASS.**

**Every control law in this campaign was written pointing DOWNWARD — at a worker's result, an
instrument's blindness, a guard's population.** **This one fired UPWARD, at the criterion the desk
itself specified, and nothing in the process was designed to make that happen.**

> **A CRITERION IS AN INSTRUMENT AND INHERITS EVERY INSTRUMENT'S OBLIGATION. MAKE THE ACCEPTANCE TEST RE-CONVICT THE ORIGINAL DEFECT — ALL OF IT, BY KEY — BEFORE ANY VERDICT EXISTS, AND WHEN IT MISSES ROWS, ASK WHAT FAMILY THEY SHARE.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
