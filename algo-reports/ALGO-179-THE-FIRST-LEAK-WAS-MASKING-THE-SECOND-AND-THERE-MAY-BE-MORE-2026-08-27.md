# ALGO-179 — **THE SECOND LEAK IS REAL AND THE FIRST ONE WAS HIDING IT. `build_premarket_plan_v24` WINDOWS TO `PRE_END = 09:29` REGARDLESS OF THE DECISION CLOCK, SO A `09:00` DECISION CONSULTS SIX BARS THAT HAVE NOT PRINTED — AND `pm_structure` GATES AN ENTIRE AUTHORIZATION BRANCH AT `levels.py:253`. FUTURE BARS SWITCH `_range_room_authorization` ON AND OFF.** **🛑 AND `levels.py:21`'s OWN DOCSTRING SAYS *"when CAUSAL pre-open structure is MIXED/ranging"*. IT IS NOT CAUSAL. THAT IS THE THIRD SELF-REFUTING PROSE CLAIM IN THIS CODEBASE TODAY, AFTER THE DOCSTRING THAT FAILED ITS OWN GREP AND THE COMMENT CELEBRATING A DUPLICATE IT HAD NOT DELETED.** **🛑🛑 AND THE SCOPE NUMBER IS NOT `1 of 56` — THE WORKER WAS RIGHT TO REFUSE TO QUOTE IT AS A BOUND. `[MEASURED HERE] 89 OF THE 240 MINUTES OF HIS `08:00-12:00` DECISION WINDOW SIT BEFORE `PRE_END` — `37.1%`. THE LEAK IS STRUCTURAL AT EVERY ONE OF THEM AND MERELY SILENT WHERE THE LABEL DOES NOT FLIP.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `fe448d00`.
**Strategy head `3c822592`.** **PR #38: DRAFT / DO NOT MERGE.**

---

## 1. RATIFIED — and the sentence you put in the title is the one that matters

> **"This was UNREACHABLE before my repair… the old code was non-causal in a way that MASKED this one."**

**Pre-repair the only anchor was `09:30`, which is after `PRE_END = 09:29`, so the premarket window was
always complete and this leak could never fire.** **Your repair put anchors inside the premarket window
for the first time.** ⇒ **it is not a regression against prior behaviour, and it is exactly the sentence
a worker is tempted to omit. It is in your title. Ratified without qualification.**

> ## **A LOOKAHEAD DEFECT CAN HOLD A SECOND LOOKAHEAD OUT OF RANGE. THE BROKEN ANCHOR WAS SO LATE THAT EVERY DOWNSTREAM FIXED CLOCK HAPPENED TO BE SATISFIED. FIXING THE FIRST ONE DID NOT CREATE THE SECOND — IT MADE IT REACHABLE.**

## 2. 🛑 THE SCOPE, RESTATED — `1 of 56` IS NOT A RISK BOUND

**You declined to quote the ratio as if it bounded the risk. Correct, and here is the number that
does:**

| | |
|---|---:|
| his decision window `08:00–12:00` | **240 min** |
| **before `PRE_END = 09:29`** | **89 min — `37.1%`** |
| anchor-pairs where the OUTCOME differed (14 sessions × 4 anchors) | 1 of 56 |

> ## **`37.1%` OF HIS DECISION WINDOW CONSULTS A PREMARKET WINDOW THAT HAS NOT CLOSED. THAT IS THE EXPOSURE. `1 of 56` IS THE OBSERVED FLIP RATE ON A 14-SESSION SAMPLE, AND A LATENT LEAK WITH A LOW FIRING RATE IS STILL A LEAK — ESPECIALLY ONE HEADED FOR A 1,925-SESSION BACKTEST.**

**The mechanism is measured, not inferred:** `pm_structure` at `2026-03-25 09:00` reads **DOWN** on full
data and **MIXED** when truncated to completed bars — **and `MIXED` is precisely the branch that gates
`_range_room_authorization`.**

## 3. THE REPAIR IS AUTHORIZED — same class, same reasoning, no new degree of freedom

**Bound the premarket plan by the decision clock: the plan available at `T` uses bars completed by
`min(T, PRE_END)`.** **`PRE_END = 09:29` STAYS — it is the definition of the premarket session and is
not being retuned.** ⇒ **no constant is chosen, so nothing is fitted.** **`A FIDELITY REPAIR IS A
TRANSLATION, NOT A FIT` — the same ruling as ALGO-174, applied to the same defect class one layer down.**

**And "structure so far" is a coherent object.** Asking what the premarket structure is at `09:00` has a
real answer — the structure of the premarket **up to `09:00`**. **The alternative reading, that
pre-`PRE_END` decisions should consult no plan at all, is refused: it would silence `37%` of his own
stated trading window.**

**🛑 PRE-REGISTERED, BEFORE THE REPAIR RUNS:**
1. **Some mornings will change their `MIXED` classification, authorization will change, and trades will
   change. That is the EXPECTED outcome, not evidence of error.**
2. **The direction is UNKNOWN and I am predicting neither more nor fewer trades.**
3. **`P1` must be re-run at all `56` anchor-pairs afterwards and come back `56 of 56`** — **the same
   instrument, unchanged.** `[red-path-decay]`.
4. **Its control must go RED first, as before.**

## 4. 🛑🛑 AND THE ENUMERATION THIS OPENS, WHICH IS THE REAL ORDER

**§1 says the old anchor masked a downstream fixed clock. That reasoning does not stop at one.**

> ## **EVERY COMPONENT ON THE DECISION PATH THAT CARRIES A HARDCODED CLOCK WAS, UNTIL YESTERDAY, ONLY EVER CONSULTED AT `09:30`. ALL OF THEM ARE NOW CONSULTED FROM `08:00`. THE PREMARKET PLAN IS THE ONE `P1` HAPPENED TO CATCH — NOT NECESSARILY THE ONLY ONE.**

**AUTHORIZED, and it is mechanical:** **enumerate every literal time and every fixed session boundary
reachable from the decision path** — `PRE_END` · `PRE_START` · `RTH_END` · `TRADE_START` · `LAST_ENTRY` ·
any `Timestamp(f"{dte} …")` · any `.between_time` · any `index.time >= …` — **and for each, state whether
it can be consulted at a decision clock EARLIER than itself.** **Report by key. Derive nothing, repair
nothing.** **`[instance-not-condition]`: name the mechanism, then run the enumeration over it — and this
time the mechanism is named and the enumeration is a grep.**

## 5. THE DISPOSITIONS — RATIFIED, AND THEY CORRECT SOMETHING I SAID

| | |
|---|---:|
| total bullets, 14 sessions, **before and after** | **14 / 14 — none lost, none gained** |
| identical (same clock AND same level) | **10** |
| moved | **4** |

**`2026-03-31 09:00 → 10:15` moved OUT of the window entirely — and it was NEVER one of the five.**
**Its own location was available at its own clock; what changed is the COMPETITION.**

⇒ **I told the operator "one in-window bullet is gone." That is true only of the in-window count. THE
TRADE STILL HAPPENS, at `10:15`.** **Nothing was removed — one trade relocated, and the correction is
mine.**

**And your expectation-2 report is the kind I most need: `bullets did not go up`. I pre-registered that
they might; they did not; you said so plainly rather than leaving the prediction unmentioned.**
**A pre-registration is only worth something if the branches that DIDN'T fire get reported too.**

**Full suite: failure set BYTE-IDENTICAL to the reverted-kernel baseline, same 8 members, by `comm`.
ZERO net regressions from the repair plus the guard updates.** Ratified.

## 6. AUTHORIZED — in this order

1. **The §4 hardcoded-clock enumeration.** **First**, because it may change what the §3 repair should
   look like, and because it is a grep.
2. **The §3 premarket repair**, with its pre-registration and a `56 of 56` `P1` re-run.
3. **Runbook count → membership** — you now hold the failing SET, so write it from the set.
4. **THEN the 15m-close optimisation** under ALGO-175 §5's exactness obligation. **You were right to
   hold it: a 15m-close rebuild interacts with exactly the window semantics in question, and running
   it first would have proved exactness against a semantics we are about to change.**
5. **STILL NOT AUTHORIZED:** PnL · Monte Carlo · re-score · map build · moving `warmup_ref` ·
   adoption decision inside a result message.

---

**LESSON, minted:**

> **THE DOCSTRING AT `levels.py:21` SAYS *"CAUSAL PRE-OPEN STRUCTURE"* AND THE STRUCTURE IS NOT CAUSAL. THAT IS THREE SELF-REFUTING PROSE CLAIMS IN THIS CODEBASE IN ONE DAY — A DOCSTRING THAT FAILED ITS OWN GREP, A COMMENT CELEBRATING A DUPLICATE IT HAD NOT DELETED, AND A WORD THAT ASSERTS THE EXACT PROPERTY ITS FUNCTION VIOLATES.**

**All three were written by someone who understood the hazard precisely.** **`causal`, `deleted`,
`zero` — each is the vocabulary of a person who had the right concept in mind and then described an
intention rather than a state.** ⇒ **the more expert the comment, the more completely it substitutes
for the check.**

> **A WORD LIKE `causal`, `safe`, `validated` OR `deleted` IN A COMMENT IS A HYPOTHESIS WITH NO TEST ATTACHED. GREP FOR THOSE WORDS AND TEST WHAT EACH ONE ASSERTS — THE CODEBASE HAS ALREADY TOLD YOU WHERE ITS AUTHORS THOUGHT THE DANGER WAS.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
