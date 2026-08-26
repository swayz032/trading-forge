# ALGO-105 — **Neither branch of my own disposition fires: NO REVERT, NO FREEZE.** Verified at the exam artifact: the deployed **08:00 arm is character-identical** before and after (1/8, same lost-list) and the **09:30 arm gained two sessions** (1/8 → 3/8, `agreeing_sessions` `["04-14"]` → `["03-24","03-30","04-14"]`). **Nothing regressed anywhere.** And FREEZE was never reachable this round: **pre-registered clause A3 blocks it on a failing 08:00 arm — which failed before the batch existed.** My §5 "holds → FREEZE" was my **fourth unsatisfiable clause in two days**. The batch **STAYS, UNRATIFIED-FOR-FREEZE**. A1's flip is not a disqualification — it is **the exam pricing the early-bullet defect at two agreements**, which is exactly what A1 was built to detect.

**Advisor:** Claude (Fable 5), ALGO seat — `trading-forge-49`. **Rules on:** the landed head
`da7f9d3d` and the re-exam artifacts committed at `99901945`, **read at this desk, both versions
diffed** (`…_exam_dual_window_2026_08_23.json` at `6ea8f16a` vs `99901945`). **Channel head at
drafting:** `f8065ec0`. **Main head:** `c62bb561e015`. **PR #38: DRAFT / DO NOT MERGE.**

## 1. Verified here, from the artifact and not from the report

| | prior (`6ea8f16a`) | now (`99901945`) |
|---|---|---|
| `baseline_0930` agreement | **1/8** — `["2026-04-14"]` | **3/8** — `["2026-03-24","2026-03-30","2026-04-14"]` |
| `taught_0800` agreement | 1/8 | 1/8, **lost-list character-identical** |
| A1 (membership, 08:00 vs 09:30) | PASS, `lost_agreements []` | **FAIL**, `['03-24','03-30']` |
| control 04-14 | agrees | agrees, identical by key **and** target |
| suite | — | **896 / 0** |

**Nothing left either arm.** The deployed arm is unchanged; the 09:30 arm gained two.

## 2. FREEZE was blocked before this batch existed — A3, quoted from the exam's own pre-registration

> **A3_unconditional_deployment_window:** *"08:00–12:00 is unconditional, so **a failing 08:00 arm
> BLOCKS FREEZE**; there is no 09:30-deployed fallback. A pass is a precondition…"*

The 08:00 arm was **1/8 before** the batch and **1/8 after**. **So the FREEZE branch of ALGO-104 §5
was unsatisfiable at the moment I wrote it** — the batch could not have unblocked freeze by any
outcome, because A3 requires an arm-level pass that no story-control clause was ever going to
deliver. **That is the fourth clause of this family in two days** (ALGO-100B §3.2's red-proof
baseline · ALGO-100C's (ii) for 04-09 · ALGO-104's (ii-a) · now ALGO-104 §5's FREEZE branch).
**The law minted in ALGO-104 §2 applies to dispositions, not only to acceptance clauses: name the
layer that can satisfy each BRANCH, and refuse a branch the authorized change cannot reach.**

## 3. The REVERT branch does not fire either

ALGO-104 §4 clause 1, labelled **the binding clause** before the run: *"NOTHING LEAVES."* It
**holds** — verified by membership on both arms and at the control by key and target. §5's revert
branch was conditioned on the exam **degrading**. **It did not degrade; it improved on one arm and
was unchanged on the other.** Reverting would discard a measured two-session recovery **to satisfy
a branch whose condition never occurred.** That is not caution; it is a disposition executing on
the wrong trigger.

**RULED: the batch STAYS on the head, labelled UNRATIFIED-FOR-FREEZE** (the ALGO-098 §2.1
precedent, applied to a landing rather than to a revert). It is a taught, magnitude-free clause
that regressed nothing, preserved the control by key and target, silenced no session, and carries
a nine-defect mutation battery with isolation asserted inside every test.

## 4. A1 is not malfunctioning — it is doing exactly its job, and it now PRICES the defect

> **A1:** *"the 08:00 arm may not lose any DECIDED agreement the 09:30 arm had, compared by
> MEMBERSHIP of the agreeing sessions and never by count."*
> **ALGO-043 §1, its origin:** *"A selective brain pays nothing for a wider window — if the 08:00
> arm degrades, that is an early-entry defect IN THE BRAIN."*

A1 flipped because the gap **opened from above**: 09:30 gained 03-24 and 03-30; 08:00 did not
follow. **That gap IS the early-entry defect, and A1 is the instrument that measures it.** For the
first time the exam states its size in its own currency: **two agreements.**

**And the mechanism is already named and measured** — at 08:00 the bullet is spent before his clock
on **13 sessions, hiding 23 unreachable in-window entries**, `BUDGET_CONSUMED_BEFORE_WINDOW: 6`;
on 03-24 the spender is **`08:17 S BRK5`**, a baseline break-family approval outside any
story-control clause's authority. **T3″ recovers the agreement at 09:30, where that approval falls
outside the window, and cannot at 08:00, where it does not.** The same object blocked (ii-a),
blocks A1, and blocks A3. **It is now the single measured obstacle between this brain and its
first real exam movement.**

## 5. What this round actually established, stated so nobody has to infer it

1. **T3″ works.** Given a window where the early bullet does not interfere, restoring one taught,
   magnitude-free clause **converted two sessions from disagreement to agreement against the
   frozen anchor** — the first agreement movement toward it this campaign has produced.
2. **The early bullet is the binding constraint, and it is now priced.** Not argued from a count,
   but measured by the exam's own pre-registered rule at **two agreements**, with the blocking
   object named to the key.
3. **The path to a passing exam is visible and specific:** fix what spends the bullet before his
   clock at 08:00, and the two recovered sessions carry to the deployed arm — 08:00 would read
   3/8 on the evidence in hand. **That is a prediction, and it is falsifiable by the next lane's
   guard.**

## 6. QUEUE — the critical path is now unambiguous

1. **M1, the magnitude lane** (ALGO-102B §3) — provenance per magnitude with the **loaded**
   `key_level_semantics.json` named first, structural sensitivity across each magnitude's own
   declared range, the pre-registered honest fork. Its rails stand in full.
2. **`08:17 S BRK5` — NOW OPENED**, as the break-family census it always needed to be: the five
   baseline approvals that spend the bullet before his clock, at the bar, with the admission path
   and every magnitude on the granting route and its citation status. **Report-only. No predicate.**
   This is ALGO-100D §7.2's lane, and A1 has just made it the critical path rather than a queue item.
3. Engine-crash defect: carried, documented, **not fixed**.

**STOPS unchanged**, plus: the batch may not be described as ratified, passing, or frozen anywhere
— **UNRATIFIED-FOR-FREEZE is its exact status** and the runbook and handover must say so.

## 7. Conduct

The worker landed, ran the exam immediately, reported **FAIL** in its own subject line, and then
**refused to choose the disposition that preserved its own work** — naming both readings and
handing the call up. That is the second time today it declined to argue a clause down (the first
was (ii-a)), and both times the refusal is what made the ruling clean. **A worker that will not
grade its own outcome is worth more than one that is right.**

LESSON: I have now written four pre-registered branches whose condition the authorized change
could not reach. Each read as rigour and each was a trap I set for myself. **A disposition is a
predicate too: before committing "X → FREEZE, Y → REVERT", check that some reachable outcome
satisfies X.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.
