# ALGO-042 — Window amendment LANDED as ordered, and it makes fidelity WORSE: 5/8 → 1/8. I recommend you rule on reverting. Grade re-dispatched, arena-isolated.

**Strategy head:** `025b5a1e` (pushed, verified) · PR #38 **DRAFT / DO NOT MERGE** ·
kernel/entries/force/engine/signal/levels **byte-identical to `068bb24a`** — the only code
change is `core`.

---

## 1. The amendment landed. The deltas are the deliverable and they are bad.

| | 09:30 | 08:00 |
|---|---|---|
| **agreement (decided cases)** | **5/8** | **1/8** |
| bot entered in window | 7 | 1 |
| bot unavailable in window | 7 | 13 |
| sessions whose bullet was spent pre-window | 7 | 13 |
| decisions through window end | 39 | 87 |
| missed trader entries | 2 | 6 |

**Six of fourteen classes changed. Every one a degradation. Zero improvements.**
03-24, 03-30, 03-31 and 04-06 went `AGREE` → `MISSED_TRADER_ENTRY`. 04-01 and 04-07 went
`CENSORED_BOT_ENTERED` → `CENSORED_BOT_BUDGET_CONSUMED`.

**And the reason is your own ALGO-041 §1 argument.** The bot's absence is *endogenous*. Giving
an over-permissive entry gate ninety more minutes does not make it selective — it gives it more
room to spend the day's single bullet before the trader has even looked at the chart. **The
amendment does not fix the defect; it feeds it.** §1 says the honest fix is the new brain not
granting the bad pre-window entry at all. This measures exactly that, from the other side.

**A second cost, arguably worse than the headline:** the amendment collapses the analytic
corpus. The discriminator search went from 7-vs-7 to **1 wanted vs 0 unwanted**. The instrument
for finding what separates a good entry from a bad one can no longer run at all. An empty
comparison group is not a weaker answer — it is no answer.

---

## 2. A no-op I nearly shipped as a result

`prepare()` filtered the traded bars to `>= 09:30` in a **second copy of the literal** (ROLE 4).
With ROLE 1 alone, the window would have moved to a time **with no bars in it**: the amendment
would have changed nothing and I would have reported zero deltas as if 08:00 had been tested.

The ROLE-4 *floor* is now **derived** from `TRADE_START` instead of duplicated — landed as a
separate step first and **proven a no-op** by an identical `7 failed / 1445 passed` before the
constant moved. The 15:59 ceiling stays a literal: RTH data hygiene is a different question from
where trading may begin.

This is a scope expansion beyond the ROLE-1-only instruction and I am flagging it rather than
burying it. Without it the order could not have been carried out at all.

**Validity checks:** 18 pre-window 5m bars exist in every one of the 14 sessions, so this is a
real measurement, not an empty-window artifact. The replay windows are narrow per-decision
windows (earliest 09:30), so the **join did not move — only the bot did**. The comparison is
fair.

**ROLE 2 verified site by site.** `kernel.py:132` and every other session-open anchor still
reads 09:30.

---

## 3. Five guards fired, and they were right to — but they pinned the wrong thing

Five tests hard-pinned literals measured at 09:30 (`== 7`, `"5 of 5"`, `5 wanted vs 2
unwanted`). A literal pins the wrong thing when the window is a governed constant you may move
again: it fails on **every** amendment and says nothing about whether the property still holds.

All five now assert the **property** and **derive** the number — the standard you ratified in
ALGO-041 §2. The partition (present / absent / declined) instead of `7`; that the smaller group
is below the testable minimum instead of `5 vs 2`; that an **empty** census is reported honestly
instead of required to be non-empty.

**My own censoring-symmetry canary was one of them** — it pinned three sessions and the
amendment took it to seven. It now asserts derivation and self-consistency, plus a new test
recording that the amendment made the asymmetry *worse*, because the cost is the thing most
likely to be forgotten if the amendment is reverted.

---

## 4. **My recommendation: revert the window to 09:30 — but it is your call, not mine**

I landed it as ordered and I am **not** reverting on my own judgement; the order was explicit
and repeated across two sessions. But the evidence now attached to it did not exist when it was
given, and it points one way:

- it costs 4 of 5 agreements and buys nothing measurable;
- it destroys the discriminator corpus;
- its stated purpose — matching the trader's 8:00–12:00 teaching — is a *brain* problem, and
  the brain that could use the wider window (derivation + state machine, refusing 93.8% of
  Route A grants) is still BUILD-ONLY and unwired.

**The amendment's value can only be judged after the new brain is wired, which is post-FREEZE.
Its cost is payable now.** Reverting is one constant and is cheap; the docs carry the window
explicitly so 1/8 cannot be misread as the 09:30 result either way.

---

## 5. Grade re-dispatched — ONE dispatch, arena-isolated as mandated

Built with `git archive`, never the working tree, smoke-tested before spending the dispatch.

**Two arenas, because attack item 5 could not run in one.** The censoring-asymmetry work landed
*after* pin `4d786333`, so it does not exist there. Rather than skip the item or let the grader
near my tree, there is a second read-only arena at `ea6f0940` — asymmetry present, window **not**
amended. Both verified at `TRADE_START = 09:30`, headline 5/8. The brief names which arena owns
which item and tells the grader that seeing 08:00 or 1/8 means it is in the wrong tree.

Brief carries your narrowed list — re-derive 5/8 two ways · residual generosity · prove the
force cross-check is not a transcription · next structurally-zero metric · attack the asymmetry
pinning — with the two closed leads explicitly excluded so no budget is spent there.

---

## 6. Queue

Amendment **landed and measured** (revert decision yours). Grade **running**. Next: the exam —
`acceptance_bars` {1,2,3} sensitivity, the §1 censoring classes, and these window deltas —
then FREEZE on a pass. I am building the exam instrument now with the decision rules
**pre-registered** from your ALGO-037 ruling 1, before any result is visible.

Suite **7 failed / 1446 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
