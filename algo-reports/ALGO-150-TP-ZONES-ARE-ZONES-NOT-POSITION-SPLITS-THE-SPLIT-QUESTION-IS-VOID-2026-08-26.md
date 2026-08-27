# ALGO-150 — **OPERATOR: *"i dont have tp1 and tp1 them are zones not trades."* THE SPLIT QUESTION IS VOID AND SO IS THE PREMISE UNDER IT.** TP1/TP2/TP3 are **marked destination ZONES on the chart**, not rungs of a scale-out on one position. ⇒ **there is no split, nothing comes off at TP1, and ALGO-149's *"only open question"* was built on a mechanic he does not use.** **AND IT REHABILITATES THE CODE ON ONE POINT AND SHARPENS THE DEFECT ON ANOTHER:** `class Target` holding **one** `executable_price` is **CORRECT** — one trade, one target zone. **The "ladder" was never a multi-exit plan; it is the SET OF MARKED DESTINATIONS, and choosing among them is exactly what `target_policy` already does.** ⇒ **ALGO-145/146/148/149's "the ladder is unbuilt" is WITHDRAWN as stated.** **What survives, and is now the whole of it, is his own sentence: *"the bot suppose to find the next tp zone if the first one is too close"* — and `target_policy.py:115` closes that path to his setup.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Withdraws:** ALGO-149 §4's question ·
ALGO-145 §5 / ALGO-146 / ALGO-148 §4's "unbuilt ladder" framing. **Channel head at drafting:**
`43ed065d`. **PR #38: DRAFT. Nothing built.**

---

## 1. WHAT HE CORRECTED, AND WHAT IT DISSOLVES

**I read `tp_ladder` / `TP1, TP2, TP3` / `multiple_directional_tps_allowed` as a POSITION LADDER —
partial exits at successive targets. It is not.** They are **zones he marks**, the same kind of object
as his key zones. **The trade targets one of them.**

⇒ **`ALGO-149 §4`'s question — *"how much comes off at TP1, and at TP2?"* — HAS NO REFERENT.** There
is no split because there is no scale-out. **The absence I verified under fourteen names across five
surfaces was real, and it was the absence of a mechanic he does not have.**

> ## **I SEARCHED EXHAUSTIVELY FOR A NUMBER THAT DOES NOT EXIST BECAUSE THE THING IT WOULD PARAMETERISE DOES NOT EXIST. FOURTEEN NAMES, FIVE SURFACES, FOUR POSITIVE CONTROLS — AND NOT ONE OF THEM COULD TELL ME I WAS SEARCHING FOR THE WRONG KIND OF OBJECT.**

**A rigorous absence check confirms a string is missing. It cannot tell you the concept is
misconceived** — and every control I ran made the search look sounder while the premise stayed wrong.

## 2. WHAT IT REHABILITATES

**`class Target` carrying ONE `executable_price` is CORRECT.** One trade, one target zone.
**ALGO-145's *"the bot has one rung and he has three"* is wrong: he does not have three rungs, he has
three marked zones and picks one.** ⇒ **and `targets.py` already builds destination candidates from
three families and selects among them — which is the actual taught behaviour.**

**WITHDRAWN, plainly:** *"the TP ladder is taught and implemented nowhere"* (ALGO-145 §1, ALGO-146,
ALGO-148 §4). **The taught object is a set of destination zones. The code has that.**
**`avoid_chart_clutter` remains the campaign's one confirmed taught-and-unbuilt clause.**

## 3. 🛑 WHAT SURVIVES — and it is his own sentence, unchanged since he first said it

> **"the bot suppose to find the next tp zone if the first once is too close so why did the bot stand odwn"**

**Read as ZONES, that sentence is unambiguous: when the nearest TP zone is too close, target the NEXT
ZONE.** It is a **target-selection** rule, not a scale-out rule — **and it needs no split, no rung
count, and no number.**

**And the mechanism exists in code and is closed to his setup** (ALGO-142, `[MEASURED]`):
```python
def _current_candidate_processed_reaction(d, setup, entry_location, candidate_reason) -> bool:
    if setup not in {"BRK5", "BRK15"}:        # target_policy.py:115
        return False
```
`PROCESSED_REACTION_ROLLOVER` at `:180` **takes the next destination.** **A break can reach it. A
rejection cannot — two independent guards, either sufficient.**

⇒ **ALGO-142's finding is the live one and always was. The ladder detour was mine.** The four
refusals — `$277.50 · $255.00 · $180.00 · $255.00` — **are a rejection with no route to the next
zone.**

**STILL NOT AUTHORIZED, and the reason is unchanged:** his `processed_rollover_rule` releases a zone
on **INTERACTION** — *"after the nearby TP/reaction area has actually been interacted with"* — and his
three named continuation mechanisms are break-shaped. **Whether a too-close-but-untouched zone
releases is the question `no_blind_rollover` answers NO to.** **His sentence and that clause still
point different ways, and now they point at ZONES, which is a smaller and cleaner disagreement than
the one I posed.**

## 4. QUEUE

1. **Re-read `no_blind_rollover` · `too_close_rule` · `processed_rollover_rule` AS ZONE-SELECTION
   RULES**, not as scale-out rules. **Report whether the disagreement survives that reading.** It may
   dissolve exactly as the split did.
2. **Correct the specification §7** — it now describes a ladder-shaped object. **It must say ZONES.**
   Cited, `NOT REPRESENTED` until he sees it.
3. **Not authorized:** `target_policy.py:115` · the `$400` floor · any repair.

---

**LESSON, minted:**

> **I BUILT FIVE RULINGS ON A MISREADING OF ONE WORD, AND EVERY CHECK I RAN MADE THE MISREADING LOOK BETTER-EVIDENCED. THE OPERATOR CORRECTED IT IN NINE WORDS.**

`tp_ladder`, `TP1/TP2/TP3`, `multiple_directional_tps_allowed`, three screenshots labelled
`multi_target_ladder` — **every artifact was consistent with a position ladder AND with a set of
marked zones, and I never noticed there were two readings.** **Rigour applied to the wrong object
produces confidence, not correction:** the more carefully I verified, the more certain I became.

**Ask, before the first measurement: WHAT KIND OF THING IS THIS — and is there a second reading in
which every piece of my evidence still fits?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
