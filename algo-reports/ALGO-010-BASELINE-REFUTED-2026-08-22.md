# ALGO-010 — STOP: the baseline was refuted. Your queue reorder rests on a premise that failed.

**This report exists to halt a semantic mutation you authorized.** ALGO-009 §9 says: *"If it
materially refutes the measured failure shape or finds a blocking instrumentation defect,
report that before semantic mutation."* It did. I have not begun the breakthrough.

**Strategy head:** `5e33fe917850` · PR #38 **OPEN / DRAFT / DO NOT MERGE**.
**Grader:** `accuracy-validator`, no lineage, DISPROVE mandate. **BAND 5, REFUTED**, pinned at
`9e6d37b3`. Verdict verbatim: *"Do not mutate strategy semantics on this scorecard."*

I reproduced every critical on my own instrument before acting. All held.

---

## 1. What was wrong — and the first one poisoned everything downstream

### F-1 · The join was SESSION, not WINDOW

`_full_entry_decisions_through` filters `entry_time > end` and **never** `entry_time < start`.
The window filter is asymmetric, so `decisions[0]` is the first A+ of the **session**.

- 39 A+ decisions existed across the 14 sessions. **14 published, 25 discarded.**
- **7 of 14** reported bot decisions occurred *before* the audited window opened — by up to
  103 minutes — while the artifact's own status string read `SAME_WINDOW`.
- The grader tested four window-scoped joins (first-in-window, closest-to-trader, any-match,
  last-in-window). **All four converge on 6/14.**

In the instrument's defence, which I want on record: the regrade module's docstring is honest
— it promises a *session-scoped* answer. The break was my runner consuming that answer as the
bot's *window* decision.

### F-2 · A real direction inversion was published as zero

**2026-04-09**, window 11:15–11:35: bot SHORT at **11:27 and 11:28, in-window**; trader LONG
at 11:35. Eight minutes apart. The session join hid it behind a 09:52 pre-window entry.

I published `opposite_direction_at_decision: 0`. It is 1, and it is the highest-severity class
in the taxonomy.

### F-3 · Two classifier branches were structurally dead

The bot entered in **14/14** sessions, so every branch requiring `bot not entered` was
unreachable. `MISSED_TRADER_ENTRY = 0` and `WAIT_VS_NO_TRADE = 0` were **checks with no path
to red**, not measurements.

Worse, two aggregates I reported were tautologies: `entered_vs_not_agreement = 7/14` is
*identical to the count of trader entries* — the bot contributed nothing to it.

### F-4 · Six of fourteen trader labels are RIGHT-CENSORED — this destroys my conclusion

The labels file says so at top level: `status: FROZEN_WITH_TRADER_WAIT_AT_REPLAY_END`,
`wait_at_replay_end_count: 6`, and six `capture_warnings` reading
`TRADER_ENDED_PRESENTED_REPLAY_STILL_WAITING`. Each of those six carries a **single timeline
entry stamped at exactly the window end**.

**The trader had not declined. The replay was cut off while he was still watching.** My script
read none of those fields and scored WAIT as a decline.

> Over-entry cases with an **uncensored** trader decline **and** an in-window bot entry: **1**.

My headline — *"the kernel is not blind, it is trigger-happy"* — had **zero fully-qualified
witnesses** when I wrote it.

### F-5 · The "bullet" mechanism does not exist

No one-trade-per-session rule appears anywhere in the 23-module import closure (grader
red-proofed with a planted `already_traded_today`), and the bot took **both directions in 6 of
14 sessions**. My `EARLIER_OPPOSITE_ENTRY_CONSUMED_BULLET` class named a mechanism that is not
in the code. Removed, not renamed.

This also retracts my own earlier commit `c59f77c6`, which claimed "measured evidence for the
bullet-consumption classification." The entries were genuinely earlier; the *mechanism* I
attributed them to was invented.

### F-7 · The force receipt named the wrong function

I justified it as *"the entry passed `one_minute_entry`, which is the force gate."* That is a
v2.2 **fill-price helper** — next 1m bar, slippage, tick rounding. Zero force logic.

The conclusion survives by a different route (`iter_actionable_candidates` has exactly one
`yield`; all branches force-gate before it), but an implication-by-existence receipt **cannot
go red**. The grader ruled it inadequate before semantic repair and I accept that.

---

## 2. The corrected measurement

Window join, censored cases segregated:

| metric | value |
|---|---|
| exact action agreement | **6/14** |
| **on the 8 cases the trader actually decided** | **6/8** |
| opposite direction at decision | **1** (2026-04-09, −8m) |
| missed trader entries | 0 *(branch now live, unexercised)* |
| bot-only entry vs a **real** decline | **1** (2026-04-02, trader NO_TRADE) |
| censored, segregated | 6 |
| decisions through end / in-window | 39 / 25 |

**6/14 reproduces the RELAYED baseline exactly.** The number my own commit dismissed as
unreliable was right; my replacement was the unreliable one.

The five AGREE timing deltas are tight: 0, +6m, +6m, −2m, +2m.

---

## 3. Why I stopped, and what I think it means for §8

Your ALGO-009 reorder put **entry-authorization false positives** first, on the strength of my
"nine mismatches, all false/early entries, zero missed" shape. Under the corrected join that
shape is **two genuine disagreements on uncensored cases**: one direction inversion, one
over-entry.

I am not asking you to re-reorder from my reading. I am reporting that the premise changed and
letting you rule. What I would flag for that ruling:

1. **The permission-density finding SURVIVES and is now the strongest evidence I have.** The
   X-ray's 315 surviving candidates against 7 trader trades is untouched by the join defect —
   it never used the scorecard. The grader corroborated its direction independently: 39
   fully-gated entries, and a **data-blind always-long null scores 4/14 against the kernel's
   as-shipped 5/14**. On n=7 directional calls, one-sided binomial p = 0.227; Wilson 95% CI
   [35.9%, 91.8%] straddles 50%.
   **A repair queue cannot be ranked on 6/14 vs 5/14 vs 4/14. It can be ranked on 14/14
   entries vs 7, and on 315 permissions vs 7.**
2. **Six censored labels mean the corpus can only adjudicate 8 cases.** Before more fidelity
   scoring, we need a ruling on what a censored WAIT means. It is not a decline; it is absence
   of evidence.
3. **Your §6 "candle knowledge must become load-bearing" is confirmed by measurement.** The
   grader found `gate.py` and `zone_candles.py` have **zero production callers** — the whole
   `zone_candles → gate` limb is built, tested, and never invoked. The reachable path imports
   exactly one symbol, `classify_patterns`, consuming 4 of 8 `CandleEvidence` fields. A
   351-line corpus contributes four booleans. The branch name *zone-first-candles* describes
   an intent, not a wiring.

---

## 4. Answers to the specific challenges you set in §9

| your challenge | answer |
|---|---|
| recompute 5/14 and census from rows | **11/11 aggregates recomputed exactly** by the grader. The arithmetic was never wrong; the join was. |
| resolve 7 vs 9 | **7 is correct**, 9 was all bot-extra-entry disagreements. Worse than I said: the wrong figure sat inside a block headed "MEASURED" and repeated three times. |
| is `missed = 0` real | **No.** Structurally unreachable branch. My own earlier "verification" confirmed the kernel *finds* entries but missed that the *branch could never fire*. |
| are the two opposite entries causally separate | **One is a false positive** — on 2026-03-23 the bot also read SHORT correctly in-window at +6m, so it belongs in no defect queue. **The other is a misfiled true positive** of the class I reported as empty. |
| is `EARLY_ENTRY_SECONDS` load-bearing | **No — it is dead code.** The census is byte-identical at 0 and at 100,000 minutes; the `ws == PRECEDES` disjunct short-circuits. My code comment credited it with a reclassification it never made. |
| is the 6-REV/3-BRK5 clustering accurate | Arithmetically exact, **diagnostically misleading**. Per occurrence BRK5 is worse (75% vs 60%), and under the correct join the rates **invert**. n=4. Do not order a queue on it. |
| is the force receipt adequate | **No.** Must become an explicit `force.confirmed` snapshot before semantic repair. |
| is the candle corpus wired | **No.** Zero production callers for the gate limb. |

---

## 5. What I have NOT done

- **No strategy-semantic file has been modified.** The four-route state machine is not started.
- The X-ray (`8c5927ad`) is **not certified** — outside the grader's pin.
- The repaired scorecard is **not yet independently graded**. I will dispatch a fresh grader
  against it rather than certify my own repair.

## 6. What I intend, absent a contrary ruling

1. Dispatch an independent grade of the **repaired** scorecard — doer ≠ grader, and I have now
   published two wrong baselines in one day.
2. Emit the explicit force receipt (F-7), since you require it before semantic repair anyway.
3. Hold the breakthrough until you rule on the censored-WAIT question and on whether §8's
   reorder still stands.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this packet.**
