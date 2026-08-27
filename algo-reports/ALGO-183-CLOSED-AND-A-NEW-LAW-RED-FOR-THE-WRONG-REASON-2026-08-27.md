# ALGO-183 — **THE CAUSALITY CLASS IS CLOSED. `plan.primary` `10/56 → 0/56`, `pm_structure` `2/56 → 0/56`, `P1` `56/56`, `P3` `56/56` OVER ALL SIXTEEN PLAN FIELDS, `P2` WIDENED TO GUARD BOTH BUILDERS AND THEIR PLACEMENT INSIDE THE LOOP, ZERO NEW SUITE FAILURES AND ONE FEWER THAN BASELINE.** **🛑 AND THE WORKER MINTED A LAW THIS DESK DID NOT HAVE: A GUARD CAN BE **RED FOR THE WRONG REASON**, AND IT IS *HARDER* TO CATCH THAN GREEN-FOR-THE-WRONG-REASON, BECAUSE IN A RED-PROOF **RED IS THE OUTCOME YOU ARE HOPING FOR**. ITS HOIST TEST RAISED `AttributeError` ON AST NODES WITHOUT A `lineno`, REPORTED RED, AND LOOKED LIKE SUCCESS. ADOPTED AS A STANDING LAW, NOT AN ARM OF THE OLD ONE.** **🛑🛑 AND THE REQUIRED-`as_of` DESIGN PAID OFF WITHIN THE HOUR: IT FORCED `candidate_xray.py:117` TO DECLARE `09:30` OUT LOUD. AN INVISIBLE NON-CAUSALITY BECAME A GREPPABLE ONE, WHICH IS EXACTLY WHAT THE PARAMETER WAS FOR.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `e46584e8`.
**Strategy head `9e0bc950`.** **PR #38: DRAFT / DO NOT MERGE.**

---

## 1. CLOSED  **[VERIFIED HERE at `9e0bc950`]**

`premarket.py:33` — **`def build_premarket_plan_v24(full5, dte, as_of):`** required, positional, **no
default.** `kernel.py:263` `for ts in bucket_starts:` → **`:279` `build_premarket_plan_v24(full5, dte, ts)`.**

| | before | after |
|---|---:|---:|
| `plan.primary` | 10 / 56 | **0 / 56** |
| `plan.pm_structure` | 2 / 56 | **0 / 56** |
| `P1` (reach: locations only) | — | **56 / 56** |
| `P3` (all 16 plan fields) | — | **56 / 56** |
| suite vs 8-member baseline | — | **zero new, one GONE** |

**Three design decisions here are better than what I ordered, and each is reasoned from today's own
convictions:**

1. **NO DEFAULT ON `as_of`.** *"A `None` default would silently restore the defect for the next caller
   who forgot — we have already watched a `09:30` literal survive its own deletion by moving to another
   file."* ⇒ **the API is designed against ALGO-172's failure mode.**
2. **EXPLICIT `None` still allowed, meaning *"the whole premarket session, NOT FOR DECISION USE."*** ⇒
   **the unsafe path is made VISIBLE rather than impossible.** **A banned path gets worked around; a
   greppable one gets audited.**
3. **`P3` covers ALL SIXTEEN plan fields, not the three consumed today.** *"A test scoped to today's
   consumers goes blind the moment a fourth is read, and being consumed where nobody looked is exactly
   how this survived."* ⇒ **that is `REACH` (ALGO-181 §2) applied FORWARD IN TIME.**

**Controls RED first on all of it, including a SINGLE-BAR peek.** **A control that only catches gross
violations certifies nothing about subtle ones, and that is now twice you have built the subtle one
unprompted.**

## 2. 🛑 THE NEW LAW — **RED FOR THE WRONG REASON**

> **"A guard RED for the wrong reason is as useless as one GREEN for the wrong reason, and HARDER to
> notice, because in a red-proof RED IS THE OUTCOME YOU ARE HOPING FOR."**

**The hoist test raised `AttributeError` on AST nodes lacking `lineno`. The red-proof reported RED. It
looked like success.** ⇒ **the guard would have gone RED on any tree, including a correct one, and its
own proof-of-detection was the thing certifying it.**

**ADOPTED AS A STANDING LAW IN ITS OWN RIGHT, not as a seventh arm of
`[guard-green-for-the-wrong-reason]`.** The old law is about **what an instrument looks at**;
**this one is about the DIRECTION OF THE CHECKER'S HOPE.**

> ## **EVERY VERIFICATION LAW THIS CAMPAIGN HAS MINTED POINTS AT A GREEN NOBODY QUESTIONED. NOT ONE POINTED AT A RED. IN A RED-PROOF THE CONFIRMATION BIAS INVERTS, AND WE HAD NO INSTRUMENT AIMED THAT WAY AT ALL.**

**THE OPERATIONAL FORM, binding from here:** **a red-proof must assert the guard failed FOR THE PLANTED
REASON — the failure output must name the planted defect — and must carry a vacuity assert.** **"It
went red" is not a red-proof. "It went red saying the thing I planted" is.**

## 3. THE RUNBOOK — and the answer was already written down

> **"THE RUNBOOK ALREADY LISTED THE SEVEN NAMES — the guard simply was not reading them. Nothing had to
> be written down; something had to start being read."**

**Third time today the answer was already on disk and unread:** the `map_anchor` field naming both
files · the `FIRST_A_PLUS` memory with no index pointer · **the runbook's seven names.**

> ## **THIS CAMPAIGN'S RECURRING FAILURE IS NOT MISSING INFORMATION. IT IS UNREAD INFORMATION — AND EVERY INSTANCE COST A DAY OR MORE.**

**And the red-proof is the best-designed one in the packet: REPLACE ONE FAILING NAME WITH A
CURRENTLY-PASSING TEST, COUNT UNCHANGED AT `7`, RED.** ⇒ **that red-proofs the exact law I ruled three
separate times today — `a count survives a swap` — by constructing the swap.** **Asserting both
directions separately, plus a self-consistency check of the runbook's count against its own list, is
the shape.** **And it caught your own `removeprefix`-after-`split` parsing bug by failing loudly, which
is what a guard with a vacuity assert is for.**

## 4. ⚠️ THE X-RAY — RULED, BECAUSE A CLAIM IN A COMMITTED ARTIFACT IS NOW FALSE

**[VERIFIED HERE] `candidate_xray.py:112-117` anchors at `09:30` and passes it as `as_of`.**
**The X-ray describes itself as a *mirror* (`:16`), and the pinned map capture's `map_anchor` field
reads `"09:30 session open, mirroring candidate_xray.py and kernel.py"`.** ⇒ **that provenance line was
TRUE when written and is FALSE now — not because it changed, but because `kernel.py` moved beneath it.**

> ## **`[unjoined-duplicates-rot-together]` APPLIED TO A DESCRIPTION OF CODE: A COMMENT THAT NAMES TWO FILES AS AGREEING BECOMES A LIE THE MOMENT ONE OF THEM IS FIXED, AND NOTHING JOINS THEM.**

**RULED:**
1. **Every X-ray-derived artifact on this ladder is stamped `MEASURES THE PRE-REPAIR ENGINE`.** **Not
   deleted, not re-scored** — the same disposition as the map numbers.
2. **AUTHORIZED: repair the X-ray anchor** — pass the decision `ts`, same one-line pattern. **It is a
   diagnostic whose entire purpose is to explain the kernel, and one that explains a different engine
   is worse than none.** **Its self-description as a mirror is the property being restored.**
3. **Your flag before anyone quotes it is the right escalation and is ratified.**

**And note what the required parameter did on its own:** **the signature change FORCED the X-ray to
name its anchor.** ⇒ **an invisible non-causality became a greppable declaration within the hour.
That is design decision (1) earning its keep before the ruling on it was even written.**

## 5. AUTHORIZED — and it is the last item

1. **The X-ray anchor repair (§4.2).**
2. **THE 15M-CLOSE OPTIMISATION**, under ALGO-175 §5, unchanged: **EXACT MEMBERSHIP EQUALITY BY KEY,
   ALL 14 SESSIONS, EVERY BUCKET. Not a sample, not a count, not a spot-check.** **Its licence is a fact
   about the data — pivots on a 15m frame cannot change between 15m closes — and NEVER a runtime
   figure.** **Exact ⇒ memoisation. Any difference anywhere ⇒ a different strategy wearing a speed
   argument, and it is refused.** **Report the achieved runtime for `1,925` sessions.**
3. **THEN STOP AND REPORT.** **The fidelity gate is what closes here, and the next thing after it is a
   decision the operator has already named — backtest, then Monte Carlo — which is a separate ruling
   with its own pre-registration.**
4. **STILL NOT AUTHORIZED:** PnL · Monte Carlo · re-score of `-$21,075 / 42%` · map build · moving
   `warmup_ref` or `PRE_END` · adoption decision inside a result message.

---

**LESSON, minted:**

> **THE CAMPAIGN BUILT SIX WAYS TO CATCH A GREEN THAT MEANT NOTHING AND ZERO WAYS TO CATCH A RED THAT MEANT NOTHING. THE WORKER FOUND THE SEVENTH BY WATCHING ITS OWN RED-PROOF SUCCEED FOR THE WRONG REASON — IN THE ONE PLACE WHERE FAILURE IS THE RESULT YOU WANT AND THEREFORE THE ONE PLACE NOBODY AUDITS.**

**Every law on this ladder was written by someone suspicious of a pass.** **A red-proof inverts that:
the tester wants RED, gets RED, and stops.** ⇒ **the discipline that protects a green does not
transfer, because it was never about rigour — it was about which answer we were braced to distrust.**

> **ASK OF ANY CHECK: WHICH OUTCOME AM I HOPING FOR? THAT IS THE OUTCOME I WILL NOT INTERROGATE, AND IT IS WHERE THE NEXT WRONG ANSWER WILL BE.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
