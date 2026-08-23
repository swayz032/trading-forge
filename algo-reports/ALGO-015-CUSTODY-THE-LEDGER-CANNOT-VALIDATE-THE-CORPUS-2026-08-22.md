# ALGO-015 — Two custody findings. One closes an authorized work item; one is an unguarded exposure.

**Strategy head:** `d066dc0e718a` (pushed, remote verified) · PR #38 **DRAFT / DO NOT MERGE** ·
no semantic file modified · §9.2 grader outstanding, semantics not started.

Compact. Neither finding needs a ruling, but one of them cancels work you authorized.

---

## 1. The ledger cannot validate the frozen corpus. The overlap is zero and it is structural.

You authorized a ledger matched-row census under ALGO-002 §3.3. It has a definitive answer.
[MEASURED HERE]

    frozen corpus   14 sessions   2026-03-23 .. 2026-04-14
    trade ledger    55 dates      2025-04-02 .. 2025-06-20   (74 rows)
    dates in common 0
    date cells that failed to parse  0

That last line is the control, not decoration. **A join that silently dropped rows it could not
read would report zero overlap too, and would look exactly like this finding.** Zero unparsed,
so the zero is real.

**What still stands:** the ledger remains good evidence of *what the trader does* — stop
discipline (the four rows at exactly −$517.50, 17.25 points), contract sizing, hold times. None
of that is affected. **What it cannot do** is serve as row-level ground truth for any of the 14
replay sessions, because it does not describe those days. Nine months separate them.

I built a guard rather than writing a note. The two artifacts sit side by side in `research/`
with the same instrument and the same symbol, so a future join would look entirely reasonable
and produce a silently empty match set — or a silently wrong one if a date parse ever broke. It
gates on the **measurement**, so if the operator later supplies overlapping rows it stops
refusing on its own; a test reads the guard's body and fails if it contains a literal date or a
constant answer. The refusal has a positive witness — a synthetic overlapping pair is permitted
— without which the refusal would only prove the guard always refuses.

**Consider §3.3's matched-row census closed as `IMPOSSIBLE_ON_THIS_EVIDENCE`, not as done.**

---

## 2. The ground truth for all 14 cases is an uncommitted file in a Downloads folder

    C:/Users/tonio/Downloads/mnq_replay_v3_labels_FROZEN.json   33,598 B
    C:/Users/tonio/Downloads/backtesting-analytics.csv          10,771 B

The first holds the trader labels. **Every agreement figure, every mismatch class and every
censoring decision in the 14-case baseline is downstream of it**, and it lives where browsers
write and where people tidy up.

**Both hashes currently match** what the committed artifacts were produced from, with a negative
control (an unrelated repo file hashes to neither). So this is not a custody break. It is an
exposure that had no detector, and now has one.

The design point, because it is the same defect class I have been fixing all day: the expected
hash is read from the **committed artifact** — `trader_labels_file_sha256` in the scorecard,
`custody.sha256` in the reconciliation — and never re-derived from the live file. *A check that
hashes a file and compares it to that same file's hash passes by construction and prints the
reassurance anyway.* The test I care about proves it: change **only** the artifact, leave the
live file untouched, and the verdict must flip to `CHANGED`. A self-certifying module stays `OK`
forever and that test goes red.

Four statuses, none collapsing into another — `OK` · `CHANGED` · `MISSING` ·
`NO_EXPECTATION_RECORDED`. A missing expectation is not a matching one.

**It copies, moves and commits nothing**, and a test enforces that by banning
`shutil`/`copy`/`rename`/`subprocess` from the module. The ledger holds the operator's real
realized P&L; pushing it to a remote is his call, not a side effect of a custody check. I have
told him plainly that his ground truth is one accidental delete from unreproducible and left the
decision with him.

Suite 12 failed / 1024 passed, same 12 as the parent commit throughout.

---

## 3. Still open, unchanged

- **§9.2** — the independent DISPROVE grade of the repaired evaluator. Dispatched after the quota
  reset, running, no verdict yet. Semantics remain not started. If it dies silently a second
  time I will publish that rather than grade my own repair.
- **ALGO-014** — is `BRK15` a fifth legal route or a variant of `B_NORMAL_BREAKOUT`? Until you
  rule, the ALGO-013 §2 numbers stay upper bounds.
- **ALGO-013 §6** — re-rule §8 on 8.6:1 rather than 15.1:1.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.**
