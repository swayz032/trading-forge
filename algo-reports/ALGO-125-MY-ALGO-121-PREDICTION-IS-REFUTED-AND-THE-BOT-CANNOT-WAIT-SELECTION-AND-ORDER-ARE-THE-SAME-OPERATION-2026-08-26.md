# ALGO-125 — **MY ALGO-121 §4 PREDICTION IS REFUTED.** (ALGO-106 §4: in the subject, unexplained. It is.) **THE REVERT IS RATIFIED — verified here, not taken on trust.** And the thing three repairs have now died on is named: **`_analysis_run_day`'s `return` sits INSIDE the candidate loop (`engine.py:43…76`), so SELECTION AND ORDER ARE THE SAME OPERATION. THE BOT CANNOT WAIT.** Its one-bullet budget is **his, frozen, and correct** (ALGO-011 §2) — the defect is that nothing ever compares a qualifying candidate against what the session might still offer, so **"A+" must carry the entire burden of selectivity alone, at the first candidate that clears the gate.** That is the same defect as the destination layer, one layer up: **he is not earlier or farther than the bot — HE IS MORE SELECTIVE, AT BOTH ENDS.** ⇒ **reachability is the wrong axis, and every geometry repair will keep being eaten.** **HONEST STOP: the repair is NOT derivable from held evidence.** `wait_semantics` is about labels; **"A+" is invoked as a gate three times and DEFINED NOWHERE** (searched, with a positive control).

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Rules on:** the worker's re-exam #5
and revert, `trading-forge-8d`. **Strategy head `f132617c`. Channel head at drafting: `41675e99`.**
**PR #38: DRAFT. Nothing lands. No repair is ordered. The revert is not reopened.**

---

## 1. REFUTED

ALGO-121 §4 predicted that fills sitting 5.75–28.17 pt outside a ~5-pt band would sit **inside** a
~32-pt band. On 04-14 the fill moved from **28.17 pt outside to 29.75 pt outside — further.** Per
ALGO-106 §4 it is in the subject line and gets no re-explanation here.

**What replaced it is worth more than the prediction was, and it is the worker's, not mine:**

> **His band grows on the side price came FROM, never the side it goes TO.**

A resistance zone is `[close, high]`, so the added width lies entirely **below** the extreme. A long
fill **above** the high gains nothing from it, by construction. **A wick-to-close band captures the
REJECTION approach; it can never contain a BREAK-family fill that lands beyond the level.**

🛑 **AND THAT PUTS A QUESTION AGAINST ALGO-102A THAT I WILL NOT ANSWER AHEAD OF THE TABLE.** If some
or all of its 6-of-6 *"fills 5.75–28.17 pt beyond the authorising band"* are **break-family** entries,
then a rejection-shaped band cannot contain them **by construction** and **the displacement may not be
a defect at all.** I have asked the worker for one added column — the setup (`REV` / `BRK5` / `BRK15`)
per row. **That column decides whether ALGO-102A survives, and it is the cheapest high-stakes
measurement on the board.**

## 2. THE REVERT — ratified, and independently verified

`git diff --stat a355507d f132617c -- research/current_mnq_strategy_v2_4_levels.py` → **empty,
exit 0.** Delta between the two pins: **9 files, 45,787 insertions, 0 deletions** — every one an
artifact. Local head `f132617c` == `ls-remote`. **[MEASURED HERE], not relayed.**

The worker executed a pre-registered disposition, in one commit, on an unwanted answer, with no clause
re-expressed. **That is the hardest act this ladder asks of anyone.** ⇒ **The revert stands and is not
reopened by anything below.** A re-read after an unwanted answer is a goalpost with a citation, and §6
exists precisely so that nothing in this ruling can be mistaken for one.

**The guard held:** partition over **518** changed keys — (a) 209 · (b) 151 · (c) 143 (80 added, 63
removed) · **(d) 0** · (e) 15. **(d) empty ⇒ the exam read the band and only the band.** Map 865→522,
established identical by key 14/14, width median 5.07→32.50, reclaim-threshold distance 0.00→16.25
median / 62.13 max (ALGO-121 §3a, confirmed).

**And the residual bucket earned its place on its first run — it caught three defects in the worker's
own instrument**, one of which is a standing trap for this whole codebase:

> 🛑 **`Location.side` IS THE LIVE ROLE, NOT THE CREATION POLARITY.** `zone_lifecycle` does
> `replace(zone, side=role)` on a break/flip, and **355 of 865 BEFORE zones carry a live role
> differing from their id's side.** **Any analysis on this repo that joins on `side` is silently
> mirrored for 41% of its population.** Into the method section, above the band work.

## 3. THE THIRD OCCURRENCE — and it is not a property of any repair

| ruling | the change | what happened |
|---|---|---|
| **ALGO-098 §5.4** | a route batch: 40 → 143 approvals, **removed 0, added 103** | *"first approval earlier on **10 of 14** sessions"* — re-summed there from the row keys at `5b488564` |
| **ALGO-105/106** | a magnitude retirement (`body_frac`, `close_loc`) | ALGO-108: predicate proof held, **eleven approvals vanished by rank displacement** |
| **tonight, ALGO-119** | a zone **shape** repair, magnitude-free | `decisions_through_window_end` 1 → 5, first A+ now **precedes** the window, **04-14 LEFT** |

**Three structurally unrelated changes — a route set, two numbers, and a geometry — produced the same
regression through the same channel.** ⇒ **The regression is not a property of any of them. It is a
property of the pipeline that contains them.**

*(Deliberately NOT cited: ALGO-105 §4's "bullet spent before his clock on 13 sessions", **retracted by
ALGO-115** as unsupported and arithmetically impossible. ALGO-098's 10-of-14 is a different, sourced
claim and survives.)*

## 4. PRIOR ART — the budget is HIS, it is frozen, and it is NOT the defect

`research/current_mnq_strategy_v2_4_session_budget.py` exists precisely for this, ruled at
**ALGO-011 §2**:

```python
# The trader's frozen rule: one A+ trade per session. Not a tunable.
MAX_FULLY_APPROVED_EXECUTED_TRADES_PER_SESSION = 1
```

Enforced three implicit ways — `_analysis_run_day`'s `RETURN_INSIDE_CANDIDATE_LOOP`,
`find_first_actionable_signal`'s `FIRST_ACTIONABLE_ONLY`, and `ShadowRuntime._session_consumed`'s
`EXPLICIT_JOURNAL_GUARD`. **That module also records ALGO-010's retracted absence claim**, whose
lesson stands and applies to my own §7 below: **`A RULE IMPLEMENTED AS CONTROL FLOW HAS NO NAME TO
GREP FOR — the `return` inside a loop IS the budget.`**

⇒ **The one-bullet budget is not to be touched, widened, made conditional or "tested at 2".** It is
his rule. **Nothing in this ruling is a proposal to change it, and any future seat reading §5 as one
has misread it.**

## 5. THE FINDING — the bot cannot wait  **[MEASURED HERE at the executable line]**

`current_mnq_strategy_v2_4_engine.py:43` opens
`for cand, actionable, plan in iter_actionable_candidates(...)`. The refusals at `:45`, `:48`, `:60`,
`:73` are `continue`. **The `return {` at `:76` sits INSIDE that loop.** `signal.py:91` has the same
shape.

> ## **SELECTION AND ORDER ARE THE SAME OPERATION. THE FIRST CANDIDATE THAT CLEARS THE GATE IS THE TRADE.**
> **There is no point — none — at which the bot compares a qualifying candidate against what the
> session might still offer. So the qualifier has to carry the ENTIRE burden of selectivity, alone, at
> the moment the first candidate appears.**

**He waits. The bot cannot.** `WAIT ≠ NO_TRADE` is a standing rail of this campaign *about his
labels*; **there is no mechanism corresponding to it in the execution path.**

⇒ **This is why a faithful repair and an unfaithful one produce the same sign.** Any change that
admits more candidates moves "first" earlier. **The exam then scores faithfulness and reachability
with one number, and cannot separate them.**

## 6. THE UNIFICATION — entry and destination are one defect, and this is the campaign's shape

| | budget | the rule AS BUILT | the rule AS TAUGHT | state of the qualifier |
|---|---|---|---|---|
| **ENTRY** | 1 trade/session — **his, frozen** | **first fully-approved candidate** (`engine.py:76`) | first **A+** | **"A+" DEFINED NOWHERE** (§7) |
| **DESTINATION** | 1 TP1 | **first past `$400`** (`target_policy.py:135-186`) | first **MEANINGFUL** reaction | **hardcoded `True`** for the dominant family (ALGO-122) |

**Both layers are first-past-the-post over an admission set. In both, the qualifier is the thing that
is supposed to make "first" correct. In one it is undefined; in the other it is asserted.**

> **HE IS NOT EARLIER THAN THE BOT AND HE IS NOT FARTHER. HE IS MORE SELECTIVE, AT BOTH ENDS. ONE
> DISEASE, TWO SYMPTOMS — ENTRIES EARLY AND DESTINATIONS NEAR.**

⇒ **Reachability is the wrong axis.** Widening zones, adding routes and retiring magnitudes all push
the same lever the wrong way. **The missing thing is not geometry. It is selectivity** — and no amount
of correct drawing supplies it.

## 7. THE HONEST STOP — the repair is not derivable from held evidence

I looked for a taught rule that would let the bot pass on a qualifying candidate.

- **`wait_semantics`** (crosswalk **and** addendum): *"WAIT is distinct from NO_TRADE and remains WAIT
  when the frozen replay ends while the trader is still waiting."* **That is a rule about LABEL
  SEMANTICS, not a mechanism for declining a qualifying setup.** It does not reach this.
- **"A+"** appears as a gate — *"all other **A+** entry requirements pass"* · *"every other **A+**
  gate passes"* · *"5m **A+** pattern identity"* — and **is defined nowhere in any held surface.**
  Searched the evidence registry, the addendum, the gold fixtures and `spec.json`, **with a positive
  control** (`A+` → 2 hits in the addendum, both returned, so the search works).

⇒ **`no citation found in the surfaces named`.** **STOP, and say so** — ALGO-119 §3.6's honest close,
applied to this desk's own lane. **No pass-rule, no selectivity threshold, no "wait for a better
setup" heuristic is to be invented, tonight or by any successor.** Inventing one would be the largest
overfit available to this campaign, because it would be tuned against fourteen sessions whose answers
we already hold.

## 8. THE MEASUREMENT-VALIDITY CONSEQUENCE — and it binds the NEXT attempt only

> **UNDER A ONE-BULLET BUDGET, ANY REPAIR THAT INCREASES REACHABILITY MOVES THE FIRST APPROVAL EARLIER
> AND IS SCORED BY THE EXAM AS A REGRESSION — WHETHER IT IS FAITHFUL OR NOT. THE EXAM CAN DETECT THAT
> A REACHABILITY CHANGE HAPPENED. IT CANNOT JUDGE WHETHER IT WAS FAITHFUL.**

ALGO-119 §3.6 made that instrument the sole arbiter of exactly this class of change. **That is a
disposition-design defect of precisely the class ALGO-117 §4(b) minted** — *name the layer that can
satisfy every clause AND every disposition branch, and refuse it at drafting if the authorized change
cannot reach that layer.* The 08:00 arm was **1/8 before the batch existed** (ALGO-105); one session
was the entire margin.

**RULED, forward only:** a reachability-increasing repair is **dispositioned on structural
observables** — map size, per-route membership, entry-to-band displacement, first-approval clock,
`decisions_through_window_end`, the `reference_tp_reward_usd` distribution — **with the exam reported
beside them and not as the trigger.** That is ALGO-117 §4(c) as originally ordered, and re-exam #5 is
now the measured price of having departed from it.

**This changes nothing about tonight.** The revert was correctly pre-registered and correctly
executed under the rule that was in force. **A disposition rule may be improved for the next attempt;
it may never be improved for the attempt whose answer you have just seen.**

## 9. A THIRD RESERVED-CLASS ASK — drafted, HELD, NOT SENT

The campaign's single named blocker is now a fact about **his own decision process that no artifact
records**: *when a valid setup appears early in a session, what makes him pass on it?* **That is the
reserved class**, it joins the two asks ALGO-117 §5 holds drafted and unsent, and **it is not sent.**
The evidence baseline stays closed; nothing about historical data is being asked. **Recorded here so
that if he ever asks what this campaign needs from him, the answer is one sentence and already
written.**

## 10. QUEUE

1. **Worker, authorized, no round-trip:** publish ALGO-124 · run the **`reference_tp_reward_usd`
   baseline distribution at `f132617c`** (diagnostic only, against ALGO-123's two modes) · land the
   **6-row entry-displacement table WITH A SETUP COLUMN** (§1) · put the `Location.side` live-role trap
   into the method section.
2. **Advisor-owned:** the `A+` provenance census, in ALGO-087's form. **§7 is the expected answer and
   a complete one.**
3. **HOLD, unchanged:** established-path band · magnitude census · `avoid_chart_clutter` ·
   **the now-three reserved-class asks.**
4. **CLOSED tonight:** the exceptional-single-swing band shape as a *scored* repair. It is faithful,
   it is measured, its artifacts are kept, and **it is not re-landed under the instrument that cannot
   score it.**

**STOPS, unchanged and absolute:** no TopstepX of any kind · **the one-bullet budget is untouchable** ·
no magnitude under the frozen contract · no width cap · `kernel.py:207` untouched · `$1,000`/`$2,000`
in no predicate · **and no invented pass-rule.**

---

**LESSON, minted:**

> **WHEN THREE UNRELATED REPAIRS FAIL THE SAME WAY, STOP DEBUGGING THE REPAIRS. THE FOURTH ONE WILL
> FAIL TOO, AND THE THING THEY SHARE IS NOT IN ANY OF THEM.**

This campaign spent a week improving *what the bot can see* — routes, magnitudes, zone geometry — and
every improvement was converted into a worse score by the one line that decides *when it fires*.
**`return` inside a loop is not a bug and reads as unremarkable in review; it is a design commitment
that selection equals order, and it silently priced every repair upstream of it.** The pattern was
only visible from three failures, which means **the campaign paid three times for one lesson and could
not have paid less** — and that is the honest defence of tonight's revert.

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
