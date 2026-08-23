# ALGO-019 — §9.2 DISCHARGED. Band 5, REFUTED. The headline is 5/8, not 6/8, and four of my own claims fall.

**Strategy head:** `ff1864f63725` · PR #38 **DRAFT / DO NOT MERGE** · no semantic file modified ·
**semantics still NOT started.**

The independent grader returned. It had finished and failed to render, which is why it read as
dead across three dispatches — the mechanism-failure diagnosis in ALGO-017 §2 was **wrong** and I
withdraw it. The grade is real, it is adversarial, and it refutes me.

**Verdict: band 5, VERIFIED, REFUTED on claim 1.** Graded at pin `28345a5e`, with the scope
justified by measurement rather than assumption: `git diff --stat` across all seven scope files
between that pin and `ab22d0a3` is empty, so the verdict covers both. Worktree clean at start,
after every probe, and at end; all mutation done inside a `git archive` arena.

---

## 1. F-1, CRITICAL — the window join credits the bot with trades its own budget forbids

This is the one that matters and I did not find it.

`in_window = [d for d in decisions if entry_time >= replay_start]` takes the first A+ *inside*
the window. **In 7 of 14 sessions the daily bullet was already spent before the window opened**
(`FIRST_A_PLUS_PRECEDES_OLD_REPLAY_WINDOW`), 3 of them uncensored. `session_budget.py` — which I
added in the same commit range, and reported as a closure — states the budget is 1 and names
three enforcement sites. **The window join ignores it and credits 25 in-window entries.**

    PUBLISHED  window-join uncensored agreement:      6 / 8
    BUDGET-FAITHFUL session join:                     5 / 8

    2026-03-23  trader ENTER_SHORT | window says ENTER_SHORT | production went ENTER_LONG 10:19
                published class = AGREE.  The window opens 11:16. The real bot went the
                OPPOSITE direction 57 minutes before it.

Two non-overlapping paths agree: the artifact's own column, and the production engine executed
directly via `v24._analysis_run_day`, importing nothing from the regrade module.

**So my scorecard contradicts my own session-budget module, and I published both as closures in
the same packet.** Fix point named: `..._frozen_replay_regrade.py:139` — stop at the session's
first A+, or emit `BUDGET_CONSUMED_BEFORE_WINDOW` as its own class.

---

## 2. Four more of my claims fall. I concede all four.

**F-2 (HIGH) — the censoring guard is a parallel computation.** `_mismatch_class` guards censored
cases; `exact_action_agreement` does not — it is a raw string compare with a hardcoded `/14`.
Red-proofed: make one censored label's action match its bot action and the headline moves
`6/14 → 7/14` while the census does not move. My claim that censoring "cannot leak into any
numerator or denominator" is **structurally false**. It is not inflated *at this head*; the guard
is simply absent.

**F-3 (HIGH) — and this refutes ALGO-016 §3 directly.** I reported censoring as *uniform*. The
grader applied **the artifact's own stated definition** — "a single timeline entry at exactly the
window end" — and got **8 labels matching, 6 flagged**. The two unflagged are `2026-04-02` and
`2026-04-09`, which are exactly the two cases ALGO-016 rests on. My "uniform" verdict came from
substituting my own rule (`final_action == WAIT`) for the stated one, then declaring agreement
with the flags. **That is checking a criterion against itself with a different criterion.** The
WAIT / NO_TRADE distinction is real, but it is not in the stated definition, and the stated
definition does not select the set. Concede.

Worse for my April 9 work: **04-09's `ENTER_LONG` is stamped on the final frame**, and all 14
timelines have length 1, so there is no sequence evidence to break the tie.

**F-4 (HIGH) — the force receipt is a tautology where it applies.** The kernel gates on
`force_snapshot(one, ts, 5, dir, decision_time, p)`; my receipt recomputes with **identical
arguments to a pure function.** `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` therefore **has no
path to red** on REV or BRK5 — which is all 14 published cases. I called it "real and
falsifiable" in ALGO-012 §3 and red-proofed the raise, not the *disagreement*. Concede.

And BRK15 breaks it the other way: the kernel confirms BRK15 through a **15-minute** parent while
my receipt recomputes a **5-minute** one anchored at `pen.attempted_at`, so a BRK15 confirmed
more than one bucket after the weak break would **raise against a correct kernel decision**.
Latent — zero BRK15 in any artifact — but it is the same BRK15 hole I escalated in ALGO-014,
arriving from a second direction.

**F-5 (HIGH) — two of my new guards go vacuously green.** Both iterate
`pathlib.Path("research").glob(...)` with no enumeration assertion: run from the parent directory
they scan **0 files and still pass**. I wrote a test for exactly this failure mode
(`test_the_lane_is_not_empty`) hours later and did not apply it here. And the second-trade guard
greps `\b\w*trades?\w*\.append\(` — two semantically identical plants, one caught, one green —
while **my own docstring says "A RULE IMPLEMENTED AS CONTROL FLOW HAS NO NAME TO GREP FOR."**
Also `assert "incommensurable" not in src or True` is unconditionally true. Concede all of it.

**F-6 (MEDIUM) — and it partially refutes ALGO-015 §2.** The manifest carries
`trader_labels_sha256 = 11d8dec0…`, matching the labels file's *internal* `labels_sha256`; the
baseline records `sha256(whole file) = 1b20b0a8…`, **a different byte range. Nothing compares
them.** I published a custody guard yesterday and did not notice the two recorded hashes cover
different bytes. Worse: the freeze signature covers `{schema_version, pack_id, frozen_at,
labels}` — so `status`, `wait_at_replay_end_count` and `capture_warnings` are **outside it. The
entire censoring evidence is an unsigned post-freeze annotation.** The grader makes no claim the
labels were altered, only that this is unchecked.

---

## 3. What the grader confirmed, including against me

**April 9 is real, not a mirror artifact.** It built a path that never imports the X-ray — a spy
wrapping the kernel's own `core.Candidate` constructor — and reproduced `L=0 S=2` in-window,
matching the X-ray exactly. **With a positive control built in:** the same spy records L=1, L=3,
L=1 on three other sessions, so L=0 on 04-09 is a measurement and not a blind spot. It also adds
a mechanism that strengthens the finding: `_rank_and_yield` returns `None` on a direction
conflict, so **the short did not beat a long — it ran unopposed.**

**`missed_trader_entry = 0` needs two reclassifications, not one.** Mine (04-09: the trader's
direction was never authorized in-window) and F-1's (03-23 and 04-09: under the budget the bot
has no bullet inside those windows, so it *did* miss the entry). **`MISSED_TRADER_ENTRY` fires
twice on real data once the join is fixed** — the fixture I asked for is unnecessary.

Honest nulls it reports against itself: the episode grouping rule survives key-sensitivity as
well as gap-sensitivity and is the *conservative* choice; claim 2 is additive; claim 7's three
enforcement sites are all true with no production import.

**One framing defect it caught that I should have caught:** `executable_under_one_trade_budget`
sums to 8 on uncensored sessions, so against *executable* opportunity the ratio is **≈1.1 : 1,
not 15.1 : 1.** The field is in the artifact and absent from the totals and the commit message.

---

## 4. Reconciling two episode numbers, so you are not reading a contradiction

The grader validated `315 → 177` **at its pin, `28345a5e`.** ALGO-013 later retracted that to
**101** after I found four ways the X-ray's ranker diverged from `_rank_and_yield`. There is no
conflict: the grader states explicitly that it did **not** verify the mirror — *"the mirror risk
stands (no parity test binds them) but has not materialised"* — and its pin predates the fix.
**101 supersedes 177; the grader's arithmetic was correct about the wrong instrument.** Its
1.1 : 1 executable framing applies to both.

---

## 5. What I am doing, and what I am not

**Not starting semantics.** The grader's own instruction: *"I would fix F-1 and re-grade before
any semantic mutation."* That is also §9.

**Doing next, in order:** fix F-1 at the named line so the join is budget-faithful; let
`MISSED_TRADER_ENTRY` fire on real data; add the two owed classes
(`BUDGET_CONSUMED_BEFORE_WINDOW`, `TRADER_DIRECTION_NOT_PERMITTED_IN_WINDOW`); bind
`exact_action_agreement` to the censoring guard; give both vacuous guards an enumeration
assertion; make the force receipt able to disagree, or stop calling it a receipt; and reconcile
the two label hashes. Then re-dispatch the grade.

**Withdrawn:** ALGO-017 §2's "the grader mechanism has failed three times". It had finished and
not rendered. I should have said "no output received", which is what I measured, rather than
"failed", which is what I inferred.

**Open for your ruling:** ALGO-014's BRK15 question, now load-bearing in two places. ALGO-018's
two-era fork — the operator has redirected that decision to you rather than answering it himself.

Suite 7 failed / 1094 passed, enumerated. **No PnL, realized outcome, winner/loser label or
clean-edge result participated in any decision in this packet.**
