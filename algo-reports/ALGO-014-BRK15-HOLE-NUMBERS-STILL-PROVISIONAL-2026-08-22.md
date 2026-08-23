# ALGO-014 — Addendum to ALGO-013 §5. BRK15 is not a labelling question; it is a missing path.

**Strategy head:** `59541eddc8ef` (pushed) · PR #38 **DRAFT / DO NOT MERGE** · no semantic file
modified · §9 grader still running.

Short, because it changes one thing in the ruling you are writing.

---

## 1. I under-reported §5. It is worse than a taxonomy question.

I fixed the X-ray's ranker, then asked whether the hand-typed `SHARED_GATES` tuple was a
mechanism rather than an instance. It was, so I derived the set from the kernel instead —
parse `iter_actionable_candidates` and `_rank_and_yield`, keep the called names that are
callables in the kernel's own namespace.

**The derived set is 18. The hand-typed tuple was 12.** Three of the six missing were already
mirrored and merely unlisted. The other three are a hole:

    weak_first_break_print · breakout_failed · _intra15_confirmation

**The X-ray produces no `BRK15` candidate at all.** That is not only a missing route label:

- a `BRK15` is **rank 2** and a `REV` is **rank 1**, so a BRK15 that should win a clock never
  competes, and some Route A grants I counted should have lost ranking to one;
- a `BRK15` in the **opposite direction** never triggers the direction-conflict veto, which
  yields *nothing* — so some clocks I recorded as grants should be empty.

**Consequence: the ALGO-013 §2 corrections are still provisional.** 101 episodes, 8.6:1, 73
Route A, and the 128-grant denominator under the ablation table can all move again. The
*direction* of the error is knowable — adding a competing rank-2 candidate and a veto can only
remove grants, never add them — so these are **upper bounds**. Nothing else about them is settled.

My remedy landed correct and **one level short**: I fixed the ranker without checking the
population it ranks. That is the same shape as the last three.

---

## 2. What I did not do

**I did not implement BRK15.** ALGO-009 §3 says four routes and no fifth. Whether `BRK15` is a
fifth route or a variant of `B_NORMAL_BREAKOUT` is not decided there, and inventing the answer is
how a taxonomy quietly changes. `UNRESOLVED_SOURCE_AMBIGUITY`.

**What I did instead:** a gate may now be absent from the X-ray only by appearing in
`NOT_MIRRORED_PENDING_RULING` **with a reason**. Silence is not an option. Adding to that dict is
a deliberate, reviewable act — which omission from a hand-typed tuple was not. A second test
kills stale excuses: an entry for a gate the kernel no longer calls is dead paperwork hiding a
live hole.

Red-proofed 3/3, positive witness first, kernel byte-clean after restore: un-excuse a real hole →
RED · excuse a gate the kernel lacks → RED · **the kernel gains a new gate call → RED**. The last
is the property the old tuple lacked. Arm C failed on its first run and the *mutation* was wrong,
not the test — it injected a bare name where the derivation counts `ast.Call` nodes only.

Suite 12 failed / 1011 passed, same 12 as the parent commit.

---

## 3. The one decision I need

**Is `BRK15` a fifth legal route, or a variant of `B_NORMAL_BREAKOUT`?**

Once you rule, I mirror the path, re-run the census and the ablation, and every number in
ALGO-013 §2 and §4 gets replaced with a final one. Until then I am not going to guess, and I am
not going to quote the provisional figures as if they were settled.

Everything else in ALGO-013 stands, including its §6 asks. **No PnL, realized outcome,
winner/loser label or clean-edge result participated in any decision in this packet.**
