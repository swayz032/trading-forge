# ALGO-139 — **BRANCH 2 FIRES: `A_REFUSED` 5 OF 5. His setup was on the table at every bullet clock and something killed it every time.** `his_setup_EVER_survived_this_session = True` on all five. **145 Route A attempts at those clocks: 140 `REJECTION_STORY_INCOMPLETE`, and EXACTLY ONE `FORCE_NOT_CONFIRMED` PER SESSION — five sessions, five ones.** ⇒ **arrival order is NOT the whole answer, and ALGO-137 §4's first branch is refuted by its own pre-registration.** **AND ON 2 OF 5 HIS SETUP SURVIVED TO RANKING *BEFORE* THE BREAK TOOK THE TRADE — 03-31 `08:02` vs a `09:03` bullet, 04-06 `08:29` vs `09:07`.** **🛑 PLUS A RETRACTION THAT IS MINE TO CARRY: I told the operator "the band moved nothing." That was never a measurement of the re-landed band — the census reads the bullet clock from a PINNED FILE. The correct statement is UNKNOWN, not UNCHANGED.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `352493bc`.
**Strategy head `4e09ecd8`.** **PR #38: DRAFT. No repair ordered. Nothing touched.**

---

## 1. 🛑 THE RETRACTION FIRST, BECAUSE IT WENT TO HIM

**[VERIFIED HERE]** `run_break_family_bullet_census_2026_08_26.py:147-152`:
```python
approvals = sorted(base.get(session, []), ...)   # base = a PINNED 40-approval capture
a = approvals[0]
et = pd.Timestamp(a["key"][1])                   # the bullet clock, READ FROM A FILE
```
**The bullet clock and its setup are read from a frozen capture. They are not re-derived from a run
of the current code.** ⇒ **"5/5 `BRK5` at identical clocks" was guaranteed before it ran — the same
file, read twice.**

**I passed that to the operator as "the band moved nothing."** The honest statement is **"whether the
band moved the bullet clocks is UNKNOWN and is being measured now."** **A constant presented as a
result** — the identical defect the worker convicted its own split of an hour earlier, and that I
ruled on in ALGO-134 §3. **Third time today a number that could not have come out otherwise was read
as evidence.**

**What survives:** ALGO-138's X-ray records are from a **live** `xray_session` at the re-landed head,
so **what Route A was doing at those clocks is real.** Only *"are those still the bullets"* is open.

## 2. THE FINDING  **[`ARTIFACT-SOURCED from the X-ray, NOT measured at the kernel` — the caveat is inside the artifact]**

`branch_counts: {"A_REFUSED": 5}` — **and the pre-registration carried a RESIDUAL branch, which came
back empty.** (I wrote a residual-less pre-registration this morning and 91% landed outside it;
this one is covered.)

| session | bullet | bullet reason | A attempts at that clock | first Route A survivor |
|---|---|---|---:|---|
| 03-23 | 08:14 `BRK5` | `PREBREAK_REPEAT_TEST` | 28 | 08:53 — **after** |
| 03-24 | 08:17 `BRK5` | `PREBREAK_REPEAT_TEST` | 32 | 08:27 — **after** |
| **03-31** | 09:03 `BRK5` | `ACCEPTED_BREAK_RETEST` | 6 | **08:02 — BEFORE by 1h01m** |
| **04-06** | 09:07 `BRK5` | `FIRST_BREAK_PRINT` | 37 | **08:29 — BEFORE by 38m** |
| 04-09 | 09:37 `BRK5` | `ACCEPTED_BREAK_RETEST` | 42 | 09:44 — **after** |

**TOTAL: `REJECTION_STORY_INCOMPLETE` 140 · `FORCE_NOT_CONFIRMED` 5 — exactly one per session, in
all five.**

> ## **HIS SETUP WAS AVAILABLE AND REFUSED AT EVERY BULLET CLOCK. THE REFUSAL HAS A NAME AND THE MECHANISM IS NOT ARRIVAL ORDER.**

**And 2 of 5 are stronger than that:** on 03-31 and 04-06 **a Route A candidate survived to ranking
BEFORE the break took the trade.** ⇒ **either something downstream of ranking refused his surviving
candidate, or the pinned bullet clock is not this pin's bullet** — and §1 makes the second live.
**Survived-to-ranking is not took-the-trade and the two are not to be conflated.**

## 3. 🛑 WHAT MUST NOT BE NAMED YET — and the procedure already exists

**`REJECTION_STORY_INCOMPLETE` is a GATE LABEL over sub-reasons.** ALGO-096 convicted an entire round
on exactly this: `killed_at=FORCE_NOT_CONFIRMED` was pinned to `force.py:123`, **which fired 0/14 at
his clocks**; *"never reaches `_control`"* turned out to be **loop order**; and **"first refusing
predicate by MAJORITY" hid the one row that reached the deeper gate.**

**The 140/5 split is that trap in its purest form.** 140 would dominate any majority read — **and the
row that got DEEPEST is the single `FORCE_NOT_CONFIRMED`, which recurs exactly once in every session.
A uniform count of one across five independent sessions is a structural signature, not noise.**

**ORDERED, and it is ALGO-096's own procedure, not a new method:**
1. **Print the EMITTER's reason field**, not the gate label — for both gates, by key.
2. **Report the DEEPEST gate BY KEY, never by majority.**
3. **Run the G-forced-TRUE ceiling** — force the story gate TRUE and report how far each attempt then
   reaches. **That separates "the story is genuinely incomplete" from "the story gate is mislabelling
   a different refusal."**
4. **Residual branch required**, as in ALGO-138.

**Nobody names the cause before those land.** `[gate-label-not-subreason]`.

## 4. QUEUE — two items, and the first outranks

1. **The live bullet clocks at the re-landed head** — earliest `SURVIVED_TO_RANKING` of any route per
   session, from a run rather than a file. **It decides whether §2's two BEFORE rows are a downstream
   refusal or a stale pin, and it is the acceptance line the operator was actually promised.**
2. **§3's emitter-reason + deepest-gate + G-forced-TRUE ceiling.**
3. **Not authorized:** any repair · the anchor · the rank · a time filter · the one-zone overlap
   thread. **The band stays re-landed and verified; its effect on the clocks is UNKNOWN, not zero.**

---

**LESSON, minted:**

> **A FROZEN INPUT PRODUCES A STABLE OUTPUT, AND STABILITY READS AS CONFIRMATION. "IDENTICAL CLOCKS" WAS NOT A NULL RESULT — IT WAS THE FILE ANSWERING ITS OWN QUESTION.**

Today's third instance: the rank's `7 of 7` was entailed by a dictionary · `SAME_ZONE 69` was entailed
by a grouping key · `identical clocks` was entailed by a pinned capture. **All three looked like
findings and all three were arithmetic.** The test that catches every one is the same single question,
and it is cheap: **what input would have had to change for this number to come out differently — and
was that input live?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
