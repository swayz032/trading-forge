# ALGO-143 — **CONFIRMED ON THE EXAM'S OWN PATH: 14 of 14 sessions join to the instant, so *"his setup is the first trade on 8 of 14"* is no longer a private walk.** Producer **named**: `frozen_replay_regrade.py:245`, driven by `run_frozen_14_case_baseline.py`, importing the same three production functions. **The 08-21 disagreement is PIN DRIFT on 10 of 14 — not a path difference — and the regrade reports *bot traded at all* 14 of 14 against the old artifact's 12.** **CUSTODY CLEAN: the producer rewrites the committed scorecard on every run; the worker copied it out, saved the re-run under its own name, restored the original sha-verified — [VERIFIED HERE] one file added, 773 insertions, ZERO deletions, porcelain 0.** **🛑 AND THE SAME ARTIFACT CARRIES THE OTHER HALF, WHICH MUST TRAVEL WITH IT: `bot_state_in_window = BUDGET_CONSUMED_BEFORE_WINDOW` ON ALL FOURTEEN SESSIONS, and `agreement_decided_cases = 0/8`. EVERY ONE OF THOSE 8 REJECTION TRADES HAPPENS BEFORE THE EVIDENCE WINDOW OPENS.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Channel head at drafting:** `35635ca4`.
**Strategy head `406a629b`.** **PR #38: DRAFT. Nothing built. No repair.**

---

## 1. THE JOIN — confirmed, and the producer is named not guessed

`current_mnq_strategy_v2_4_frozen_replay_regrade.py:245` computes `session_first_entry_time`. **Its
walker imports `iter_actionable_candidates`, `one_minute_entry` and `target_policy.build_and_classify`
— the same three, in the same order, as the private walk.** Re-run at `dd9c8f20`, joined by key:
**every session's first entry matches to the instant, 14 of 14.**

⇒ **"8 OF 14 SESSIONS' FIRST TRADE IS A ZONE REJECTION" IS CONFIRMED BY THE INSTRUMENT THAT PRODUCES
THE SCORECARD.** ALGO-141 §4's open item is closed, **and it closed in the direction that strengthens
the finding** — the 08-21 artifact is stale by 10 of 14 sessions, not wrong by path.

**[VERIFIED HERE] custody:** `git diff --name-only dd9c8f20 406a629b` → **one new file**;
`--stat` → **773 insertions, 0 deletions**; `porcelain 0`. **The committed scorecard is byte-unchanged
against a producer whose own header says it overwrites it.**

## 2. 🛑 THE OTHER HALF OF THE SAME ARTIFACT, AND IT IS NOT A CAVEAT

**[VERIFIED HERE] every one of the 14 cases:** `bot_state_in_window = BUDGET_CONSUMED_BEFORE_WINDOW`.
`entry_family_receipt` is `None` on all fourteen — **that receipt covers in-window entries and there
are none.** `aggregates.agreement_decided_cases = "0/8"`.

> ## **THE BOT NOW TRADES HIS SETUP ON 8 OF 14 SESSIONS, AND ALL 14 OF ITS TRADES HAPPEN BEFORE THE REPLAY WINDOW OPENS. THE TWO NUMBERS ARE NOT IN TENSION — THE SECOND SAYS THE FIRST CANNOT BE SCORED.**

**These are different objects and conflating them is the error this desk has made all night:**
- **`8 of 14`** — **what the bot trades.** Confirmed, two paths, one pin.
- **`0/8`** — **whether it matches his marked decision.** **It cannot: he trades from 08:00, his
  replay evidence starts at 09:30, and the one bullet is spent before the evidence begins on every
  session.**

**This is not new — it is the 08:00 arm's known state** (ALGO-124 §2: 1/8, then 0/8 when 04-14 fell to
`BUDGET_CONSUMED_BEFORE_WINDOW`). **What is new is that we now know WHAT those unscoreable trades
are.** For a week the answer was *"break-family, 6 of 6."* **It is a zone rejection on 8 of 14.**

⇒ **THE EXAM CANNOT EVALUATE THE 08:00 CONFIGURATION. Not underpowered — STRUCTURALLY BLIND.** Every
trade it would score falls outside its own window. **Any future ruling that reads an 08:00-arm
agreement number as evidence about fidelity is reading a measurement of an empty set**, and rail
11 still forbids narrowing the window to fix it.

## 3. THE JOIN PREDICATE THAT NEARLY BECAME THE FINDING OF THE NIGHT

The worker's first join compared timestamps **by string slice**: `'2026-03-23 08:14:00'` against
`'2026-03-23T08:14:00'` — **a space against a `T`.** It reported **DIFFER on all fourteen**, and it was
one step from *"the walk and the exam disagree on every single session"* — **the largest false finding
available tonight, arriving at the exact moment we most wanted a clean answer.**

**What caught it: the printed times were visibly identical while the verdict said otherwise.**

> ## **A JOIN PREDICATE IS AN INSTRUMENT, AND ITS FALSE ANSWER LOOKS EXACTLY LIKE A DISCOVERY. A BROKEN COMPARISON DOES NOT FAIL — IT RETURNS `DIFFER`, AND `DIFFER` READS AS A FINDING.**

**ORDERED into the method section:** **print the joined VALUES beside the verdict, always.** Had only
the verdict printed, there would have been nothing to notice. **This is the third artifact-contradicts-
itself catch tonight** — `$22,702` at $30/pt, the 126-line `engine.py`, and now this. **Each was caught
because a number was visibly impossible next to its own claim, and none by a guard.**

## 4. WHERE THE NIGHT LANDS

**Established:** his setup is the trade on **8 of 14**, confirmed on the exam's own path · the 4 that
miss are refused by **his own `$400` floor** (`$277.50 · $255.00 · $180.00 · $255.00`) · the ceiling
says opening that floor **buys one session and costs another** · **`0 of 6` was a frozen file and every
story built on it is retired, two of them mine.**

**Open, and both are his:** the ALGO-142 question — *when the near reaction is under `$400` and price
has NOT worked through it, stand down or take the next one?* — **his corpus answers both ways** · and
now **§2's consequence: his evidence cannot see the trades his bot makes.**

**Not authorized:** the `$400` floor · `target_policy.py:115` · `PROCESSED_REACTION_REASONS` · the
anchor · the rank · a time filter · the overlap thread · **and no agreement number from the 08:00 arm
may be cited as fidelity evidence.**

---

**LESSON, minted:**

> **THE ANSWER AND THE REASON IT WAS INVISIBLE ARRIVED IN THE SAME FILE. `8 of 14` AND `BUDGET_CONSUMED_BEFORE_WINDOW × 14` ARE TWO FIELDS OF ONE ARTIFACT, AND FOR A WEEK WE READ THE SECOND AS A SCORE INSTEAD OF AS A STATEMENT ABOUT WHAT THE SCORE COULD SEE.**

An agreement figure over a window the subject never enters is not a low score — **it is a measurement
of an empty set, and it reports as `0` rather than as `UNDEFINED`.** **That is the same defect as a
broken join predicate returning `DIFFER`: the instrument's failure mode is indistinguishable from a
result.** Ask of any zero: **is this a measured absence, or an absent measurement?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling. The regrade's own `pnl_or_exit_used` field reads `false`.*
