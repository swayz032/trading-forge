# ALGO-044 — Grade repairs: 10 of 13 findings closed, F-1 red-proofed because it changes no number. `acceptance_bars` is LOAD-BEARING and the pre-registered rule picks 3 — reported, not landed.

**Strategy head:** `8dc9d7e2 (pushed, verified)` · PR #38 **DRAFT / DO NOT MERGE** · kernel/entries/force/engine
**byte-identical to `068bb24a`**.

---

## 1. F-1 (CRITICAL) — closed, and the important part is that it changed nothing

The no-decision branch now emits `budget_faithful` with `bullet_spent_before_window: False`, so
`NO_ENTRY_IN_WINDOW` is reachable, `AGREEMENT_CLASSES` is no longer degenerate, and a genuine
decline classifies instead of aborting the baseline with a misdiagnosing stale-artifact error.

**And the published numbers did not move at all** — the bot trades in all 14 sessions, so the
branch never fires and the four metrics are still `0`. **That is exactly why the repair needed a
red-proof rather than a re-run.** A structural zero I merely *claim* to have fixed is no better
than the one the grader found. So there is now a positive-control file that proves each of the
four states is reachable, plus a structural test joining the synthetic fixture to the emitter —
because a fixture proving the classifier works is worth nothing if the branch feeding it still
omits the key.

It also proves the `REGRADE_ROW_PREDATES_THE_F1_REPAIR` guard **survives** for its real purpose:
the repair did not buy reachability by deleting a check.

**The four metrics are now measurements that can move. They were constructions that could not.**

---

## 2. F-4 / F-5 — my own tests, and the grade was right about all of it

The 14-mutation battery walked through four green holes, the worst being a re-classified
`MISSED_TRADER_ENTRY` at `6/8` and an outright `8/8`. Every assertion read the artifact's summary
and checked it against another summary field.

There is now a `_recomputed_headline(doc)` that re-derives the figure from `doc["cases"]` and
`AGREEMENT_CLASSES`, and the headline test asserts against **that** rather than against a
character-identical twin of the emitter expression. The flatters-test no longer restates
arithmetic: it asserts the **classifier property** underneath it — that no symmetric-excluded
session is an agreement — which is the thing that would actually have to break.

`test_the_bot_still_never_genuinely_declines` was unfalsifiable until F-1; it is now live and
says so in its own docstring.

---

## 3. F-6, F-2, F-3, F-8, F-11, F-12, F-13 — closed

- **F-6** the second, censoring-blind agreement rule (timing deltas over `cases`, not `unc`) —
  scoped to `unc`. It sat three lines below a comment asserting no second place existed.
- **F-2** the dead `FORCE_RECEIPT_DISAGREES_WITH_KERNEL_GATE` raise is gone, replaced by an
  assertion that states what the receipt actually establishes: **reproducibility, not
  agreement**. The artifact caption that sold it as a live guard is rewritten.
- **F-3** `independent_force`'s docstring now carries the measured truth — full power against
  implementation drift in `force.py` (6000/6000), **zero power against specification error**
  (0 disagreements across shared-threshold and shared-anchor mutations). It is a drift detector
  between two copies of one rule, and it is captioned as one. **Closing the gap for real means
  anchoring thresholds to the frozen spec rather than `Params` — a semantics change I did not
  make.**
- **F-8** the stale caption citing a class the artifact no longer carries and "the published
  6/8". Removed rather than re-pinned: re-pinning only schedules the next staleness.
- **F-11** artifact deletion was caught *by accident*; it is now its own assertion that fails
  rather than skips.
- **F-12** the `n == 0` branch omitted keys `compare()` reads, so NaN defaults reported a
  **spurious** three-field divergence where the two derivations agreed perfectly. Fixed, and
  `compare()` now raises a named error on an incomplete result instead of inventing one.
- **F-13** `pnl_or_exit_used: False` was a hardcoded literal — a field that cannot go red. It is
  now **derived** from an AST scan of the scoring path's identifiers. Identifiers, not
  substrings: those modules deliberately discuss PnL while explaining none may be used, and a
  grep would convict the prose.

---

## 4. What I did NOT close, and why

- **F-9 — the censoring annotation.** Read literally it selects 8, not 6; the real discriminator
  is a hand-written list sitting **outside** `labels_sha256`. **The denominator is unsigned.**
  I am not touching it: every correction here moves the headline in the bot's favour (5/6), and
  a party may not adopt the reading that flatters it. **Yours.**
- **F-7 — no tests bind the scorecard at the graded pin.** Not retrofittable; the tests exist in
  the current tree. Recorded so nobody reads the pin's green as coverage.
- **F-10** the decorative `internal_labels_sha256` reproduces under no canonicalization and is
  compared to nothing. The whole-file sha256 *is* verified and is the real anchor. Left as-is
  pending your call on whether to delete the field or make it real.
- **The grade's own largest gap** — it did not run the baseline end-to-end, so it could not
  confirm the committed scorecard is not stale relative to its emitter. **I have now run it
  twice today, so on the current tree that gap is closed by construction** — but not at the pin.

---

## 5. The `acceptance_bars` exam — LOAD-BEARING, rule picks 3, NOT landed

    acceptance_bars = 1   ->  40 Route D grants
    acceptance_bars = 2   ->  28      (the value in force)
    acceptance_bars = 3   ->  25

Monotone, so R3 applies: the textbook is silent (re-checked, not remembered), the strictest
tested value grants fewest, **chosen = 3**. No agreement rate, headline or outcome participated —
`evaluate()` is a pure function and a test asserts on the AST that it subscripts only strictness
fields.

**I am not landing it.** Two reasons, both of which I want you to weigh:

1. It is a **semantic constant**, and by the instrument's own design its verdict is a route to a
   decision, not the decision.
2. **It was measured under the 08:00 window I have recommended reverting.** If the window goes
   back to 09:30 the corpus changes and this must be re-run. Landing a constant selected on a
   corpus that is about to change would be the reverse of pre-registration.

The instrument is committed with its rule pre-registered and its tests in place, so re-running it
after your window ruling is one command.

---

## 6. Queue

Repairs landed. **Awaiting your rulings on: the window revert (ALGO-042), the F-9 denominator,
and whether to land `acceptance_bars = 3` after the window is settled.** Then the rest of the
exam — the §1 censoring classes and the window deltas — and FREEZE.

Suite **7 failed / 1469 passed** — enumerated. **No PnL, realized outcome, winner/loser label or clean-edge
result participated in any decision in this packet.**
