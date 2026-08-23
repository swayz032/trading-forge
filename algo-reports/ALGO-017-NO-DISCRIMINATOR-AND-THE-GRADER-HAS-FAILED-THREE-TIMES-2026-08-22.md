# ALGO-017 — Nothing the kernel records separates a wanted trade from an unwanted one. And the grader has now failed three times.

**Strategy head:** `f14f71e7c9f2` (pushed, remote verified) · PR #38 **DRAFT / DO NOT MERGE** ·
no semantic file modified.

Two things. The first changes what the state machine can be built from. The second is a blocker
I am publishing rather than working around, per your §9.

---

## 1. No recorded field discriminates. Not one.

ALGO-016 established the corpus splits into 7 entries the trader wanted and 7 he did not. The
state machine's whole job is to tell those apart, so I asked the prior question: **is the
information even present in what the kernel records?**

**CATEGORICAL — the receipts are indistinguishable:**

| | route | story | location |
|---|---|---|---|
| **wanted** | REV 5, BRK5 2 | ZONE_REJECTION 5, PREBREAK_REPEAT 1, FIRST_BREAK 1 | WICK 5, SWING 2 |
| **unwanted** | REV 5, BRK5 2 | ZONE_REJECTION 5, PREBREAK_REPEAT 2 | WICK 4, SWING 3 |

**NUMERIC — 0 of 11 fields show complete separation.** Every single range overlaps.

**And three fields are constant across all fourteen cases:**

    force_receipt.confirmed                            always True
    force_receipt.latest_close_at_directional_extreme  always True
    force_receipt.partial_momentum_geometry            always True

A field with one value carries no information. **These cannot discriminate anything, and a
receipt built from them cannot explain a decision — which is what a receipt is for.** I built
those receipts three reports ago and called them "real and falsifiable". They are falsifiable in
the sense that they would raise if the kernel disagreed with itself; they are not informative.

**Consequence: the four-route state machine cannot be built from the fields the kernel currently
records.** Tuning a threshold on a field whose two groups overlap completely cannot succeed. This
is not a reason to stop — it is a reason not to spend the next phase on parameter work that
cannot pay.

**Honest limit, stated in the module and pinned by a test:** seven per group. Absence of
*complete* separation at n=7 is not proof that no signal exists; a weak but real effect would not
show. The decision-relevant claim is the weaker one — nothing available to build from today.

The load-bearing test is the positive witness: a search that never fires reports zero every time
and reads exactly like a finding. A synthetic scorecard with a planted separating field must be
detected, and one with overlapping groups must not be. Both directions pinned.
`trader_label_censored` is excluded and enforced by a test — derived from the trader's own label,
it separates by construction and would be circular.

---

## 2. BLOCKER — the independent grader has failed three times

§9.2 gates all semantic work on an independent DISPROVE grade of the repaired evaluator.

| attempt | outcome |
|---|---|
| 1 | failed visibly — `You've hit your weekly limit` |
| 2 | dispatched after the quota reset, full six-claim brief. **Never returned.** Two messages, no reply. |
| 3 | dispatched with a deliberately narrowed two-question brief, on the theory that breadth was the problem. **Never returned.** One message, no reply. |

I am not dispatching a fourth. Three attempts is enough to call it a mechanism failure rather
than bad luck, and repeating it would burn tokens to learn nothing. **Grading my own repair is
what doer ≠ grader forbids, and I am the last person who should self-certify here — I have
published four wrong numbers in two days.**

**What I did instead of waiting idle:** everything in §1, plus ALGO-015 and ALGO-016, none of
which needed the gate. Semantics remain NOT STARTED.

**What I need from you.** ALGO-012 offered three options and you have not yet ruled. I now
recommend **(b) — you grade the repaired evaluator directly from the repository**, as you did at
ALGO-006 and ALGO-008. It is three files, and the window-join change is four lines:

    research/current_mnq_strategy_v2_4_frozen_replay_regrade.py    169 lines
    research/run_frozen_14_case_baseline.py                        281 lines
    research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json

All three are still at `068bb24a` and have not been touched since the grade was requested.

**One thing I would grade first if I were you**, because it is the highest-value attack and I
found half of it myself: `missed_trader_entries = 0` is a tautology (ALGO-016 §2a). Ask what
*else* in that runner is structurally incapable of being nonzero.

---

## 3. Corrections

- **`f14f71e7` commit message is corrupted.** One line reads *" is excluded and a test enforces
  it"* — the field name `trader_label_censored` was eaten. I used an unquoted heredoc so a shell
  variable would expand, and the shell executed the backticked identifier as a command
  substitution. The code and tests are unaffected; only the message text lost a word. I am not
  force-pushing over a pushed commit for a message typo. Commit messages now go through a file,
  so no shell touches them again.
- **`20ee1502` commit message** says "7 failed / 1060 passed"; the actual run was **1064**.
  Already noted in ALGO-016 §5.

---

## 4. Outstanding

- **§9.2** — blocked as above. Your call.
- **ALGO-014** — is `BRK15` a fifth route or a variant of `B_NORMAL_BREAKOUT`? Until you rule,
  ALGO-013 §2's numbers are upper bounds.
- **ALGO-013 §6** — re-rule §8 on 8.6 : 1 rather than 15.1 : 1.
- **The evidence gap that matters most**, from ALGO-016 §4: the corpus has 7 sessions where the
  trader declined and the bot did not, and 6 of those are right-censored so we do not know what
  he eventually did. **Why he passed on those specific days is the single most valuable thing
  anyone could add to this campaign**, and no amount of re-measuring gets at it. I have asked him
  directly.

Suite 7 failed / 1074 passed; the same 7, all outside this lane. **No PnL, realized outcome,
winner/loser label or clean-edge result participated in any decision in this packet.**
