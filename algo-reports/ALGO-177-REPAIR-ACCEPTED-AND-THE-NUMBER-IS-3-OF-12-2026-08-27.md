# ALGO-177 — **THE REPAIR IS ACCEPTED. `P1` AND `P2` BOTH PASS WITH THEIR CONTROLS RED FIRST, BOTH SEMANTIC GUARDS ARE UPDATED AND RED-PROOFED WITHOUT LOSING WHAT THEY ORIGINALLY PROTECTED, REGRESSIONS ARE EXACTLY `2` BY MEMBERSHIP AND BOTH ARE THOSE GUARDS, AND `warmup_ref` IS PROVEN ISOLATED BY A TAINT CLOSURE THAT HAS ITS OWN POSITIVE CONTROL. VERIFIED HERE AT `b9b87b61`: `kernel.py:270` BUILDS INSIDE `for ts in bucket_starts:` AT `ts`, AND THE `09:30` LITERAL SURVIVES ONLY AS `warmup_ref` AT `:226`.** **🛑 AND THE NUMBER COMES DOWN: `3 OF 12`, NOT `5`. TWO OF THE FIVE WERE PREDICATE `A` FALSE POSITIVES — EXACTLY THE OVER-STRICTNESS THE WORKER FLAGGED BEFORE RUNNING IT — AND I RATIFIED `5 of 12` IN ALGO-174 AND PUT IT ON SCREEN TO THE OPERATOR. THE LADDER IS CORRECTED HERE.** **🛑🛑 THE CORROBORATION IS THE STRONGEST EVIDENCE IN THE PACKET AND IT COMES FROM A SECOND DIRECTION: BOTH FALSE POSITIVES ARE UNCHANGED POST-REPAIR — SAME CLOCK, SAME LEVEL — WHILE ALL THREE REAL ONES MOVED OFF THE OFFENDING LEVEL.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `05af72b6`.
**Repair `b9b87b61`.** **PR #38: DRAFT / DO NOT MERGE.**
**CORRECTS: ALGO-173 §1 and ALGO-174 §1 — `5 of 12` → `3 of 12`.**

---

## 1. ACCEPTED — the verdict, with its scope stated

| | |
|---|---|
| **`P1`** builder causal given its anchor | **PASS**, 3 flagged sessions, **two controls RED first** |
| **`P2`** kernel passes the decision's own `ts` | **PASS**, AST, **control RED first** |
| **`warmup_ref` isolation** | **PROVEN** — taint closure `['warmup_ref']`, intersection with builder args **EMPTY**, 3 red-proofs |
| **regressions** | **exactly `2` by MEMBERSHIP** (baseline 8 → 10), both anchor guards, **both now fixed** |
| **`comm -13` / `comm -23`** | **nothing else broke; nothing was accidentally fixed** |

> ## **THE PROPERTY IS ESTABLISHED STRUCTURALLY RATHER THAN SAMPLED: `P2` COVERS EVERY DECISION INCLUDING ONES NEVER RUN, AND `P1` MAKES THE ANCHOR SUFFICIENT. THAT IS A STRONGER ACCEPTANCE THAN ANY PER-DECISION PREDICATE COULD HAVE GIVEN, AND IT EXISTS BECAUSE `C` FAILED ITS CONTROL.**

**Scope held honestly: `P1` passes at sampled anchors on 3 sessions, not "for all `T`."** ⇒ **widen it
to all 14 sessions as cheap completion (§5.1); the acceptance stands either way because `P2` is
structural.**

## 2. 🛑 FIVE PLACES THIS WOULD HAVE GONE GREEN FOR THE WRONG REASON, AND EACH WAS CLOSED

1. **Truncation BY COMPLETION, not by index.** *A 15m bar stamped `09:15` has not completed at
   `09:20`.* **Truncating by index leaves a forming bar in the input and `P1` passes for the wrong
   reason.** ⇒ **the single sharpest line in the packet, and it was closed before the run.**
2. **`P1` sensitive to a SINGLE-LINE peek** — a peek in the ATR reference line alone goes RED, not
   only a gross one-hour peek. **A control that only catches gross violations certifies nothing about
   subtle ones.**
3. **Vacuity guard** — the full-input build must return a non-empty authorized set or `P1` fails as
   vacuous. **`[absence-claim]` applied to a differential test.**
4. **`ts` verified BOUND BY `for ts in bucket_starts:`** — otherwise `P2` is satisfied by any local
   that happens to be named `ts`. **That is the join-key law applied to an AST assertion.**
5. **A CONTROL ON THE CONTROL** — the taint tracker plants an alias chain and requires it be
   followed, **so a tracker that returned `{seed}` could not pass.** **`[same-layer-agreement]`'s
   answer: the instrument that proves isolation is itself proven capable of finding leakage.**

**And the guards were updated WITHOUT LOSING WHAT THEY PROTECTED:** the original hazard is still
guarded in its other direction — **planting `TRADE_START` as the anchor goes RED.** ⇒ **the update is
not a loosening.** **`A GUARD REPAIRED BY LOOSENING IS A GUARD RETIRED QUIETLY` — and this one was not.**

## 3. 🛑 THE CORRECTION: `3 OF 12`. I RATIFIED `5` AND PUBLISHED IT.

| decision | verdict at its OWN `ts` | post-repair behaviour |
|---|---|---|
| `2026-03-30 08:05` | **NOT producible — REAL** | same clock, **DIFFERENT level** |
| `2026-04-02 08:05` | **NOT producible — REAL** | `08:05 → 08:55`, **`REV → BRK5`** |
| `2026-04-06 08:25` | **NOT producible — REAL** | `08:25 → 08:45`, **`SWING → WICK_ZONE`** |
| `2026-03-23 08:10` | **producible — FALSE POSITIVE** | **UNCHANGED** |
| `2026-04-14 09:15` | **producible — FALSE POSITIVE** | **UNCHANGED** |

**The two false positives are predicate `A`'s fixed `08:00` reference** — a level that legitimately
became available between `08:00` and the decision scored as affected. **`04-14`'s zone has
`created == decision ts` to the second.** **You flagged this over-strictness BEFORE running it
(ALGO-175), and it has now been measured rather than argued.**

> ## **THE CORROBORATION IS A SECOND PATH, NOT A RESTATEMENT: THE REPAIR LEFT BOTH FALSE POSITIVES EXACTLY WHERE THEY WERE AND MOVED ALL THREE REAL ONES OFF THE OFFENDING LEVEL. A CLASSIFICATION THAT PREDICTS WHICH ROWS A FIX WILL MOVE, AND IS RIGHT `5 OF 5`, IS NOT THE SAME KIND OF CLAIM AS A COUNT.**

**WHAT SURVIVES THE CORRECTION, and it is the vivid half:** **both identifier-string cases are REAL** —
`2026-03-30 08:05` on `S:...T08:45:00:93755` and `2026-04-02 08:05` on `SWING:S:...T08:45:00:94666`.
**`3 of 12` is still a quarter of the in-window bullets, and the two trades whose levels carry a
forty-minute-future timestamp in their own names are both in it.**

**MY ERROR, NAMED:** ALGO-174 §1 ratified `5 of 12` **and I put it on screen to the operator as a
finding.** **The instrument that corrected it is the per-decision own-`ts` build — which I ordered
built for `P1`/`P2`, a different purpose entirely.** ⇒ **an instrument built for one job paid off
sideways, and the campaign's own enumeration was the thing it audited.**

## 4. AND A SCOPE ERROR IN YOUR OWN BOOKKEEPING, CORRECTLY DIAGNOSED

*"My earlier `4 regressions` was wrong — I had compared at a different SCOPE (10 selected tests vs the
full suite)."* ⇒ **`[guard-green-for-the-wrong-reason]`'s SCOPE arm, in a regression count, caught by
switching to membership against a reverted-kernel baseline.** **That is the third time today the fix
for a wrong number was `compare SETS, not COUNTS`.**

## 5. AUTHORIZED

1. **Widen `P1` to all 14 sessions** at a sample of `T` per session. Cheap, and it converts "3
   sessions" into "the horizon we have."
2. **Runbook count → membership.** **Your refusal to write a membership list from a count is exactly
   right** — get the failing SET from the full-suite run first.
3. **THEN the vanished bullet and the five dispositions**, now that the criterion is sound.
4. **THEN the 15m-close optimisation** under ALGO-175 §5's exactness obligation — **exact membership
   equality by key, all 14 sessions, every bucket. Not a sample.**
5. **STILL NOT AUTHORIZED:** PnL · Monte Carlo · re-score of `-$21,075 / 42%` · map build · moving
   `warmup_ref` · adoption decision inside a result message.

---

**LESSON, minted:**

> **THE CAMPAIGN'S OWN ENUMERATION OVER-COUNTED BY TWO, AND THE THING THAT CAUGHT IT WAS AN INSTRUMENT BUILT FOR AN UNRELATED PURPOSE ONE RULING EARLIER. NOBODY WENT LOOKING FOR THE ERROR — A BETTER TOOL EXISTED AND SOMEONE POINTED IT AT AN OLD NUMBER.**

**Both times a number fell today it fell because a NEW instrument was aimed BACKWARD at a
SETTLED result** — the null control at `17 of 28`, the own-`ts` build at `5 of 12`. **Neither was a
re-audit; both were a tool arriving and someone choosing to spend it on something already believed.**

> **WHEN YOU BUILD AN INSTRUMENT, RUN IT ONCE AGAINST A NUMBER YOU HAVE ALREADY PUBLISHED. THE CHEAPEST AUDIT AVAILABLE IS A NEW TOOL POINTED AT AN OLD CONCLUSION, AND IT IS THE ONE NOBODY SCHEDULES.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
