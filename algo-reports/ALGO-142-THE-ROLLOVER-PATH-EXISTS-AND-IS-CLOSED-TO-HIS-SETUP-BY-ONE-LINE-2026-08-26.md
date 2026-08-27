# ALGO-142 — **THE OPERATOR ASKED: *"the bot suppose to find the next tp zone if the first one is too close so why did the bot stand down."* HE IS RIGHT THAT THE MECHANISM EXISTS. [MEASURED HERE] IT IS IMPLEMENTED — `PROCESSED_REACTION_ROLLOVER` at `target_policy.py:180` — AND IT IS CLOSED TO HIS SETUP BY ONE LINE: `target_policy.py:115` — `if setup not in {"BRK5", "BRK15"}: return False`. A BREAK CAN SKIP A WORKED-THROUGH TP1 AND TAKE THE NEXT DESTINATION. A REJECTION CAN NEVER DO IT, EVER, BY CONSTRUCTION.** **🛑 BUT I AM NOT CALLING IT A DEFECT, BECAUSE HIS OWN CLAUSE NAMES THREE MECHANISMS AND ALL THREE ARE BREAK-SHAPED — so the exclusion may be faithful.** **AND HIS SENTENCE CONFLICTS WITH THREE OF HIS OWN RECORDED CLAUSES** — `under_400_immediate_entry = BLOCK` · `no_blind_rollover` · `under_400_tp2_behavior: "Do not blindly leapfrog untouched TP1"` — **all from his own 08-20 video review, and all ratified by him today.** ⇒ **THIS IS THE RESERVED CLASS AND IT GOES TO HIM: two of his rules point different ways and only he can say which governs.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `9e2129ec`.
**Strategy head `dd9c8f20`.** **PR #38: DRAFT. Nothing built. Nothing proposed.**

---

## 1. HE IS RIGHT THAT THE MECHANISM EXISTS  **[MEASURED HERE]**

`target_policy.py`, the live gate:
- `:145` `if _current_candidate_processed_reaction(...)` → `:148` `processed.append(d)` → **skip this
  destination**
- `:180` `return target, f"PROCESSED_REACTION_ROLLOVER:{skipped}->NEXT:{d.kind}"` — **it takes the
  NEXT destination.** **That is exactly "find the next TP zone."**

**And the door it comes through:**
```python
def _current_candidate_processed_reaction(d, setup, entry_location, candidate_reason) -> bool:
    if setup not in {"BRK5", "BRK15"}:        # target_policy.py:115
        return False
    if candidate_reason not in PROCESSED_REACTION_REASONS:
        return False
    return _overlap(entry_location, d.location)
```
`PROCESSED_REACTION_REASONS = {PREBREAK_REPEAT_TEST_INTRA5_FORCE, FIRST_BREAK_PRINT_THEN_INTRA5_FORCE,
WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE}` — **three break-family literals.**

> ## **A BREAK CAN ROLL PAST A WORKED-THROUGH TP1 TO THE NEXT DESTINATION. A REJECTION CANNOT — NOT BY QUALITY, NOT BY CIRCUMSTANCE, NOT EVER. TWO INDEPENDENT GUARDS EXCLUDE IT AND EITHER ALONE WOULD SUFFICE.**

**On 03-31 the bot refused at 08:02 (`$277.50`) and 08:04 (`$255.00`) and never entered all session
(ALGO-140 §2). It had no route by which to look past those.**

## 2. 🛑 WHY I AM NOT CALLING IT A DEFECT

`processed_rollover_rule`, his words: *"A later continuation earned at the same physical TP1/reaction
area through **repeat-test momentum, completed-break follow-through, or weak-break pullback/15m-bar3
continuation** may treat that reaction as processed and use the next meaningful destination."*

**All three named mechanisms are break behaviours, and the code's three literals map to them
one-for-one.** ⇒ **`setup not in {BRK5, BRK15}` may be a faithful reading of "these three and no
others."**

**The counter-reading is equally available**, and it is in the same file:
`processed_reaction_continuation` — *"**After the nearby TP/reaction area has actually been interacted
with**, a later test/attack of that same physical area with an already-approved continuation story and
sustained momentum/force may earn a new entry whose destination is the next meaningful reaction."*
**The CONDITION there is that the area has been interacted with. The three mechanisms are how a
continuation is EARNED — not obviously a list of who may earn it.**

**I can argue it either way from his own corpus, which is the definition of a question I must not
answer for him.**

## 3. AND HIS SENTENCE CONFLICTS WITH THREE OF HIS OWN CLAUSES

From `direct_trader_tp_gap_clarification`, sourced to his **own 2026-08-20 video review**, and inside
spec §7 which he **ratified today**:

| his recorded rule | what it says |
|---|---|
| `under_400_immediate_entry` | **`BLOCK`** |
| `under_400_tp2_behavior` | *"Do not blindly leapfrog untouched TP1 merely because TP2 is farther away."* |
| `no_blind_rollover` | *"An untouched under-$400 TP1 may not be automatically skipped just because a farther TP2 exists."* |
| `true_displacement_prebreak_alone_processes_near_tp` | **`False`** |

**And the campaign has retired the immediate-rollover shape TWICE:**
`supersedes_older_clauses[4]` (the 08-20 clause auto-promoting TP2 when TP1 fell inside
`min_room_r × stop`) and `examples_of_superseded_interpretations[1]`
(`automatic_1_5R_close_TP1_rollover_to_TP2`).

> **THE WORD DOING ALL THE WORK IS `UNTOUCHED`. His rule blocks on an untouched near TP and permits
> the next destination once that area has been WORKED THROUGH. "Too close" and "already dealt with"
> are different conditions, and his sentence tonight does not say which one he means.**

## 4. 🛑 RESERVED CLASS — IT GOES TO HIM, AND IT IS ONE QUESTION

**This is not a derivation I am declining to do. Both readings are supported by his own corpus, so no
amount of reading resolves it.** `[question-channel-retired]` reserves exactly this: *a fact about his
own intent that no artifact records.*

**THE QUESTION, and nothing else goes with it:** *when the first meaningful reaction is under $400 and
price has NOT yet worked through it — do you stand down, or do you take the trade aiming at the next
one?*

**Both answers are already written in his files and they disagree. He is the only authority.**

**IF HE SAYS STAND DOWN:** the bot is correct, `target_policy.py:115` is faithful, and the four
refusals are his own rule working. **Nothing changes.**
**IF HE SAYS TAKE THE NEXT ONE:** `:115` and the three break-only literals are the defect, it is one
line and one frozenset, **and it is a transcription repair with no new number** — but it still needs
the derivation of *what a rejection's processed-continuation reason IS*, because his three named
mechanisms do not supply one.

## 5. QUEUE

1. **AWAITING HIS ANSWER. Nothing is built on either branch before it lands.**
2. **The ALGO-141 reconciliation continues** — it is independent of this and still the job.
3. **Not authorized:** touching `:115`, `PROCESSED_REACTION_REASONS`, the `$400` floor, or anything
   else.

---

**LESSON, minted:**

> **THE OPERATOR ASKED WHY THE BOT STOOD DOWN AND THE ANSWER IS THAT IT HAD NO ROUTE NOT TO — AND WE ONLY FOUND THAT BECAUSE HE ASKED. A MECHANISM THAT IS IMPLEMENTED, REACHABLE, AND CLOSED TO HALF ITS POPULATION BY ONE LINE IS INVISIBLE TO EVERY AUDIT THAT ASKS "DOES THIS EXIST?"**

`grep PROCESSED_REACTION_ROLLOVER` returns a definition, a call site and a consumer — **all three real,
and his setup routed around all three.** It is `[existence-is-not-wiring]`'s deepest form yet:
**not unbuilt, not unreachable, but reachable for one family only** — and the excluded family is the
one whose absence we have spent a week measuring.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
