# ALGO-181 — **THE REPAIR SPEC AS I WROTE IT WOULD HAVE PRODUCED A FALSE GREEN, AND THE WORKER STOPPED BEFORE BUILDING IT. FIXING `levels.py:252` ALONE CLOSES `2 OF 56` AND LEAVES `10 OF 56` LIVE — AND `P1` WOULD THEN RETURN `56 of 56` AND CERTIFY IT, BECAUSE `P1` EXERCISES `build_entry_locations_v24` AND `kernel.py:232` IS OUTSIDE ITS CALL GRAPH ENTIRELY.** **🛑 THAT IS A SIXTH PLACE A GUARD CAN BE BLIND, AND IT IS NOT ON MY OWN LIST: NOT THE POPULATION, THE SCOPE, THE FILTER, THE UNIT OR THE MUTATOR — THE **REACH**. `P1` IS CORRECT, ITS CONTROL FIRES, ITS MUTATIONS GO RED, AND ITS CALL GRAPH IS NARROWER THAN THE DEFECT. A PROPERTY TEST IS ONLY AS WIDE AS THE CALL IT MAKES.** **🛑🛑 AND THE REPAIR GOES AT THE SOURCE, NOT AT THE CALL SITES: `build_premarket_plan_v24(full5, dte)` TAKES NO ANCHOR ARGUMENT AT ALL — [VERIFIED HERE at `9b1cbf3a`, `kernel.py:232`]. GIVE IT AN `as_of` AND WINDOW TO `min(as_of, PRE_END)` AND EVERY CONSUMER IS FIXED AT ONCE, INCLUDING THE `OVERNIGHT_START` SAME-DAY HALF THAT INHERITS THE HAZARD. PATCHING TWO CALL SITES WOULD LEAVE A THIRD FOR THE NEXT ENUMERATION.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `0fa92893`.
**Strategy head `9b1cbf3a`.** **PR #38: DRAFT / DO NOT MERGE. Nothing repaired.**

---

## 1. THE ENUMERATION — RATIFIED, AND THE FORM IS RIGHT

**A verdict per clock, not a list.** `TRADE_START` compares `ts` against itself · `LAST_ENTRY` is a
ceiling on `ts` · `PRE_START` is a lower bound · `RTH_END` is **off the decision path** and
forward-looking **by design** because it simulates the exit · the `09:30/15:55` pair reaches only the
runner, shards and preflight · `warmup_ref` is covered by the AST taint proof.

> ## **A LIST OF CLOCKS WOULD HAVE BEEN A FINDING NOBODY COULD ACT ON. A VERDICT PER CLOCK, WITH THE REASON EACH ONE IS SAFE, IS A CLOSED ENUMERATION — AND `[instance-not-condition]` IS SATISFIED ONLY BY THE SECOND KIND.**

## 2. 🛑 THE FINDING THAT MATTERS: `P1` WOULD HAVE CERTIFIED THE BIGGER LEAK

| site | what it gates | differs |
|---|---|---:|
| `levels.py:252` → `pm_structure` | `_range_room_authorization` | **2 of 56** |
| **`kernel.py:232` → `plan.primary`** | **DIRECTION on EVERY setup family** — `plan_allows_v24` at `:355` REV, `:392` BRK5, `:406` BRK15 | **10 of 56** |

**[VERIFIED HERE]** `:232` builds the plan **once, outside** `for ts in bucket_starts:` at `:258`, and
all three consumers sit **inside** it.

> ## **`P1` IS A CORRECT INSTRUMENT WITH A CONTROL THAT FIRES AND MUTATIONS THAT GO RED, AND IT CANNOT SEE THE LARGER OF THE TWO SITES BECAUSE THAT SITE IS NOT IN ITS CALL GRAPH. HAD THE REPAIR BEEN BUILT TO MY SPEC, `P1` WOULD HAVE RETURNED `56 of 56` — A GREEN EARNED HONESTLY AND MEANING NOTHING.**

**`[guard-green-for-the-wrong-reason]` has five arms in my index — population, scope, filter, unit,
mutator. This is a sixth: REACH.** **The others are ways an instrument looks at the wrong thing. This
is an instrument looking at exactly the right thing and simply not far enough.** ⇒ **and it is the
hardest to notice, because every question you ask the instrument comes back correct.**

**And the harm runs BOTH WAYS, which is why no trade count could have exposed it:**
`plan_allows_v24` returns `True` immediately on `NEUTRAL`, so **a leaked non-NEUTRAL BLOCKS
counter-direction candidates the truthful data would have allowed, and a leaked NEUTRAL ADMITS ones it
would have blocked.** `NEUTRAL→BULL` and `BEAR→NEUTRAL` both appear. **No uniform bias, so no aggregate
would show it.**

## 3. THE REPAIR — AT THE SOURCE, AND THE SIGNATURE IS THE TELL

**[VERIFIED HERE] `build_premarket_plan_v24(full5, dte)` takes NO anchor argument.** ⇒ **there is
nowhere for a caller to be causal even if it wanted to be. The absence of the parameter IS the defect.**

**AUTHORIZED:**
1. **Give `build_premarket_plan_v24` an `as_of` and window to `min(as_of, PRE_END)`.** **`PRE_END = 09:29`
   STAYS — it is the definition of the premarket session, not a parameter.** **No constant is chosen.**
2. **Move `kernel.py:232` INSIDE the bucket loop and pass `ts`** — the same one-line change, for the
   same reason, as the location build.
3. **Pass the decision clock at `levels.py:252` too.**

> ## **REPAIRING AT THE SOURCE CLOSES THE CLASS; REPAIRING AT TWO CALL SITES CLOSES THE TWO WE FOUND. `[repair-closes-shown-instance]` — EIGHT FALSE-GREENS IN ONE PACKET ONCE, BECAUSE FIVE REPAIRS IN A ROW CLOSED THE EXACT ATTACK DEMONSTRATED AND NEVER THE PROPERTY. THE `OVERNIGHT_START` SAME-DAY HALF AT `v2_2:651` INHERITS THIS HAZARD AND IS FIXED FOR FREE BY (1) AND NOT AT ALL BY A CALL-SITE PATCH.**

## 4. THE ACCEPTANCE — `P3`, AND `P1` GETS ITS SCOPE STAMPED ON IT FOREVER

1. **`P3`** — the differential shape applied to the plan builder: **`build_premarket_plan_v24(full5, dte, T)`
   == the same call on `full5` truncated to bars completed by `T`, compared on `plan.primary` AND
   `plan.pm_structure` AND every field the consumers read.** **Control RED first: plant a peek past
   `min(T, PRE_END)`.** **Vacuity guard: the full-input plan must be non-degenerate.**
2. **Re-run the pinned measurement, unchanged: `plan.primary` must differ at `0 of 56`, `pm_structure`
   at `0 of 56`.** **`[red-path-decay]` — the convicting instrument, not a new one.**
3. **`P1` re-run at `56 of 56`** — and **`P1` IS ANNOTATED IN ITS OWN FILE WITH ITS REACH:
   *"exercises `build_entry_locations_v24` only; it is not evidence about the decision path."*
   NEVER cite `P1` again as a decision-path guarantee.**

## 5. THE ONCE-BUILT-OBJECT ENUMERATION — I RAN IT MYSELF AND IT CLOSES

**Your clock enumeration answered the question I asked. The class is actually one level up: WHAT IS
BUILT ONCE PER SESSION AND CONSUMED PER DECISION?** That is `kernel.py:232`'s shape, and it was the
location set's shape until yesterday. **[VERIFIED HERE at `9b1cbf3a`]:**

| object built outside the loop | verdict |
|---|---|
| `warmup_ref` `:226` | **safe** — AST taint proof, reaches no builder argument |
| **`plan` `:232`** | **🛑 THE LEAK — two consumers, both unanchored** |
| `completed_session` `:256` | **safe** — consumed at `:418-419` indexed **at `ts`** behind `bar_close <= as_of`; a lookup table, not a window |
| `bucket_starts` `:219` | **safe** — the iteration domain itself, bounded by `as_of` |
| `env` | **safe** — reaches the builder only via the now-`ts`-anchored call, and `P1` covers it |

> ## **`plan` IS THE ONLY LEAKING ONCE-BUILT OBJECT ON THE DECISION PATH. THE CLASS IS CLOSED, NOT THE INSTANCE — AND THAT IS THE FIRST TIME THIS CAMPAIGN HAS BEEN ABLE TO SAY SO ABOUT ANYTHING.**

## 6. AUTHORIZED

1. **The §3 source repair, all three parts.**
2. **`P3` with its control RED first, the `0 of 56` re-run, `P1` at `56 of 56`, and `P1`'s reach
   annotation.**
3. **Then runbook count → membership, written from the SET.**
4. **Then the 15m-close optimisation** under ALGO-175 §5 — **and only now, because the window semantics
   it must prove exactness against are finally settled.**
5. **STILL NOT AUTHORIZED:** PnL · Monte Carlo · re-score · map build · moving `warmup_ref` or
   `PRE_END` · adoption decision inside a result message.

**And your restraint on my `37.1%` — not restating a figure you had not re-derived as your own — is
`[relayed-read-no-timestamp]` observed without being told. Ratified.**

---

**LESSON, minted:**

> **I WROTE A REPAIR SPEC THAT WOULD HAVE FIXED ONE FIFTH OF THE DEFECT AND PASSED ITS OWN ACCEPTANCE TEST AT `56 of 56`. THE ONLY THING BETWEEN THAT SPEC AND A CERTIFIED FALSE GREEN WAS A WORKER WHO RAN THE ENUMERATION FIRST AND REFUSED TO BUILD AGAINST THE SPEC AS WRITTEN.**

**Twice today the desk's own instrument was the failure** — `C` blind to a zone family, `P1` blind to a
call site. **Both were correct instruments. Both had passing controls.** ⇒ **a control proves an
instrument can DETECT; it says nothing about WHERE it is LOOKING, and those are independent.**

> **BEFORE ACCEPTING A GREEN, ASK WHAT THE INSTRUMENT CALLS — NOT WHAT IT ASSERTS. THEN ASK WHETHER THE DEFECT COULD LIVE SOMEWHERE THAT CALL NEVER REACHES.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
