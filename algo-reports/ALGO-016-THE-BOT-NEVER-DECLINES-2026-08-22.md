# ALGO-016 — The bot took a trade in 14 of 14 sessions. The headline measures the wrong half.

**Strategy head:** `20ee150227df` (pushed, remote verified) · PR #38 **DRAFT / DO NOT MERGE** ·
no semantic file modified · §9.2 grader still outstanding.

This is the most important thing I have measured on this campaign, and it reframes ALGO-013.

---

## 1. The measurement

    sessions                        14
    BOT entered in                  14      <- every single one
    BOT declined in                  0
    TRADER entered in                7
    TRADER did not enter in          7

    trader entered  x bot entered    7
    trader entered  x bot declined   0
    trader declined x bot entered    7
    trader declined x bot declined   0      <- NOT ONE session where both stood aside

`bot_state_in_window` takes exactly two values across the whole corpus: `ENTER_LONG` and
`ENTER_SHORT`. There is no third.

---

## 2. Three consequences

**(a) `missed_trader_entries = 0` is a TAUTOLOGY.** A missed entry requires the bot to DECLINE
where the trader entered. The bot declines nowhere, so the metric is structurally incapable of
being nonzero. I published it as evidence the failure is "one-sided". It is one-sided — but not
because the bot is good at not missing. `bot_declined_in_window_count = 0` is the same. **This is
the attack I briefed a grader to make on my own work, and it lands.**

**(b) The headline measures the wrong half.** "6 of 8" is carried entirely by DIRECTION, because
the decision of *whether* to trade is a constant. On the 7 sessions the trader entered, the bot
matched direction 6 times — that is real signal. On the 7 he did not, the bot entered all 7 —
**the entry-selection model has no measurable signal at all.** It is not weak; it is constant,
and a constant cannot be scored.

**(c) It composes badly with the daily bullet.** The bullet guarantees *at most* one trade per
session. This says the authorization layer guarantees *at least* one. Together: **exactly one
trade every session, unconditionally.**

**Not a claim about profitability.** No PnL, realized outcome or winner/loser label is read here
or anywhere in this campaign. It is a claim about **selectivity**: the trader passes on half
these days and the machine passes on none.

**Selection caveat I cannot resolve:** these 14 sessions were chosen for review and are not a
random sample, which biases the absolute decline rate. It does not touch the finding, which
compares both agents **within the identical 14 sessions**.

---

## 3. Censoring is applied uniformly — and I was the one who got it wrong

The highest-risk thing in the evaluator, checked independently against the labels file rather
than against the scorecard's own flags:

    uniform: True · disagreements 0 · unknown actions 0
    14 = 7 trader entries + 1 positive decline + 6 right-censored

My first derived rule — *"no entry AND timeline ends at the window end"* — flagged 2026-04-02 as
wrongly-uncensored. **The labels file is right and my rule was wrong.** `WAIT` means the replay
ended while he was still watching (censored). `NO_TRADE` is a positive decision to decline, which
is a real decision. 2026-04-02 is `NO_TRADE` at exactly the window end, is kept in the
denominator, and carries `BOT_ONLY_ENTRY_UNCENSORED_DECLINE`.

**So the one place the labels depart from a naive rule is a place where they are STRICTER —
keeping in the denominator a case the bot FAILS.** That is the opposite of a manufactured score.
A test now pins `WAIT` and `NO_TRADE` as disjoint, because collapsing them would move that case
out and flatter the headline.

**Recorded limitation:** all 14 `decision_timeline` arrays have exactly one entry. The schema can
express a trader changing his mind mid-window; this corpus never does. Any reasoning that needs a
multi-step trader timeline has no support here.

---

## 4. What I think this means for §6, and it is not what ALGO-013 implied

ALGO-013 handed you an ablation table showing that restoring v2.2's requirements kills 124 of 128
Route A grants. Read beside this, the two say the same thing from opposite ends: **the
authorization layer says yes to everything.** §5B was right, and the mechanism is now visible at
source *and* in the outcome.

But ALGO-014's caution stands and this strengthens it — **do not read the ablation table as a
to-do list.** On April 9, restoring all six kills the bad short *and* the machine's own long. An
authorization layer that says yes to everything is not repaired by one that says no to
everything. What the state machine needs is the trader's *reason* for passing on those 7 days,
and I do not have it from this evidence.

**That is the gap I would like the next ruling to point at**: the corpus contains 7 sessions
where the trader declined and the bot did not, and 6 of them are right-censored so we do not even
know what he eventually did. The most valuable evidence anyone could add to this campaign is
*why he passed*, on those specific days.

---

## 5. Outstanding, unchanged

- **§9.2** — two graders dispatched, neither has returned. If the second also goes silent I will
  publish that as the blocker rather than grade my own repair. Semantics remain not started.
- **ALGO-014** — is `BRK15` a fifth route or a variant of `B_NORMAL_BREAKOUT`?
- **ALGO-013 §6** — re-rule §8 on 8.6:1 rather than 15.1:1.

**Correction to my own commit message on `20ee1502`:** it states "suite 7 failed / 1060 passed".
The actual run was **7 failed / 1064 passed**. I wrote the figure before the run finished. The
failure count and the failing set are correct.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.**
