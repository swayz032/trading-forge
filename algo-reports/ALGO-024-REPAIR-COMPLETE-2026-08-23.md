# ALGO-024 — The §1 repair contract is COMPLETE. Headline 5/8. Grade re-dispatched.

**Strategy head:** `4d786333ccee` (pushed, remote verified) · PR #38 **DRAFT / DO NOT MERGE** ·
kernel/entries/force/engine **byte-identical to `068bb24a`** · **semantics NOT started.**

All eight items of ALGO-020 §1 are landed, plus §2's BRK15 mirror. Pre-flight was run against
ALGO-020 and found no contradiction; ALGO-021/022/023 changed nothing in the queue.

---

## 1. The contract, item by item

**F-1 — the headline is now 5/8, matching the grade exactly.**

    bullet spent pre-window : 7 sessions, hiding 16 unreachable in-window entries
    agreement (decided)     : 5/8
    MISSED_TRADER_ENTRY     : 2, on real data, both BUDGET_CONSUMED_BEFORE_WINDOW
                              (2026-03-23, 2026-04-09) — no fixture needed

Two surfaces, separately labelled: `in_window` is production-faithful and is **the** headline;
`authorization_view` carries the budget-ignored kernel view tagged
`BUDGET_IGNORED_DIAGNOSTIC_ONLY_NOT_THE_BOT_S_DECISION`.

**A near-miss I am putting on the record because it is the same failure as the one being
repaired.** My first pass folded `BUDGET_CONSUMED` into the *decline* branch, so 2026-04-02 came
out `BOTH_DECLINED` — an **agreement** — and the figure read **6/8** again. The bot did not stand
aside there; it traded at 09:37, before the 10:35 window. Unavailable, declined and entered are
three states. New classes `TRADER_DECLINED_BOT_TRADED_PRE_WINDOW` and
`CENSORED_BOT_BUDGET_CONSUMED`, the first deliberately **not** an agreement class. That single
distinction is the whole difference between 6/8 and 5/8, and I nearly shipped the flattering one.

**F-2 + G-1.** Agreement comes off `_mismatch_class` and nowhere else — `AGREE ∪ BOTH_DECLINED`,
censored excluded by the classifier, no parallel compare, no hardcoded `/14`.

**F-3.** Censoring membership derives from the flag set; the prose under-selection (8 vs 6) is
recorded; the labels file is not edited. **ALGO-016 §3's "uniform" claim stays withdrawn.**

**F-4 — the receipt can now disagree.** Replaced by a second implementation written from raw 1m
bars, calling neither `force_snapshot` nor `momentum_bar` (enforced on the AST). They agree
across all 39 candidate evaluations and **no verdict moved**, which is what a check should do.
Red-proofed: perturb its observation floor and the cross-check fires; all six divergence kinds
proven individually reachable. **The BRK15 parent is fixed** — 15m floored to the decision clock,
not 5m at the signal time, which would have raised against *correct* kernel decisions.

**F-5.** Measured directly: a CWD-relative glob from `Projects` returns **0** modules, anchored
returns **61**, and `_assert_enumerated(0)` now raises where it previously passed. The
second-trade guard is AST-structural with a negative control. `assert X or True` deleted —
strengthening it immediately went **red**, because the word it checked for is not in the module.
An always-true assert had been hiding a broken assertion, which is what they are for.

**F-6.** Labels **committed** after a field scan (42 keys, no monetary field). Both hash scopes
are now named in the artifact so nobody compares them again; git custody covers the whole byte
range including the censoring annotation, without needing the freeze signature that neither of
us could reproduce. The Downloads original is corroboration only and a divergence raises.

**G-3.** Ordering pinned at the source: the regrade raises `DECISION_CLOCKS_NOT_IN_ORDER`. My
first attempt put it in the runner referencing a field that does not exist — removed, not
shipped.

**§8 ratios.** Both, always: **authorization 8.6 : 1** (60 episodes vs 7 trades) and
**executable 1.1 : 1** (8 vs 7), side by side in the totals and in the printout.

---

## 2. §2 — BRK15 mirrored, and it is not dead code

Recorded as `B_NORMAL_BREAKOUT / BRK15_WEAK_FIRST_BREAK_CONTINUATION`; the four-route taxonomy
is intact and `NOT_MIRRORED_PENDING_RULING` is now empty. Full pending machinery mirrored:
arming from a completed weak break, `breakout_failed` invalidation, the 60-minute expiry, and
`_intra15_confirmation` through the 15m parent.

The census came back **byte-identical**, which on its own is indistinguishable from dead code.
So I measured the path:

    BRK15 records across the 14 sessions : 4,567, in all 14
      INTRA_15M_FORCE_NOT_CONFIRMED       4,508
      WEAK_BREAK_PENDING_WINDOW_EXPIRED      49   <- weak breaks DO arm
      DECISION_CLOCK_PAST_LAST_ENTRY          6
      STRUCTURAL_PRIOR_VETO                   4   <- 15m force DID confirm, four times
    survivors                                 0

**Zero survivors is a result, not an absence of code.** ⇒ **ALGO-013 §2/§4 are now FINAL, not
upper bounds:** 167 raw, 101 episodes, Route A 73 of 101, B 6, D 22.

---

## 3. What the repair did to my own earlier findings

**ALGO-016 SURVIVES, as you ruled it would.** Bot traded at all in the session **14 of 14**;
trader 7; it never *genuinely* declines — 0 sessions. What changes is the in-window view: it
entered inside the window in only 7, because in the other 7 it had already fired.

**And the failure sharpens from DIRECTION to TIMING.** When the bot is actually present in-window
and the trader trades, it picks the same direction **5 of 5**. The old 6-of-7 counted 2026-04-09
as an opposite-direction error; budget-faithfully the bot was not there, so it is a miss.
Direction is not the problem. Firing once a day regardless, half the time before the window
opened, is.

**ALGO-017 WEAKENS and I say so.** The discriminator population falls from 7-vs-7 to **5-vs-2**,
below the minimum group size, and **zero** numeric fields are testable. The verdict is now
`NOT TESTABLE`, not "no discriminator found" — issuing the second from zero tests would be a
green check with no path to red. A positive witness pins that a larger population becomes
testable again, so it is a property of the data and not of the code.

---

## 4. A pattern worth naming, because it bit four times today

A guard that reads **prose** convicts the sentence written to make the promise. Banned-substring
checks for `survivors[0]`, `winner`, `shutil/copy/rename` and `force_snapshot/momentum_bar` each
fired on the module's own docstring explaining it does not do the thing. All four are now AST
checks. The lesson is not "word it carefully" — it is **check the code, not the prose.**

---

## 5. Status

**Grade re-dispatched** against pin `4d786333ccee`, briefed to attack the repair in order:
re-derive 5/8 two ways · find any generosity I left · prove the force cross-check is not a
transcription of the thing it checks · verify the BRK15 mirror line-by-line against the kernel ·
**find the next metric that is structurally incapable of being nonzero.**

Suite 7 failed / 1114 passed, enumerated; same 7, all outside this lane. **Semantics stay closed
until it passes.** No PnL, realized outcome, winner/loser label or clean-edge result participated
in any decision in this packet.
