---
name: grading-integrity
description: >-
  Use WHENEVER assigning or reporting a score, grade, or readiness verdict for any Trading Forge
  system — "X/10", letter grades, percentages, "production-ready", "institutional-grade",
  "all gates pass", "complete", "fixed", "10/10", "bulletproof", or any deep-scan band score.
  Enforces evidence-grounded, doer-separated, re-measured-from-zero grading so scores stop
  inflating after an agent works on the thing it is grading. Rigid — follow exactly.
---

# Grading Integrity

## The one law

**A self-reported score is a CLAIM, not a VERDICT.** The agent that did the work may never
be the agent that certifies the work. A number with no reproducible evidence attached is not a
score — it is a feeling, and it is recorded as `UNVERIFIED`, never as the claimed value.

This skill exists because agents grade a system 6.5/10 cold, do fix work, then grade their own
work 10/10, and an independent re-scan later finds 7.5. The 10/10 was not malice — it was an
unanchored number produced by the party motivated to declare success. Fix it mechanically.

## The four rules (all four are mandatory)

### 1. Doer ≠ grader
- The agent that edited the code MUST NOT issue the final band. It reports `status=CLAIMED` only.
- The certifying band (`status=VERIFIED`) is issued by an **independent** agent that did not make
  the edits. Use the `accuracy-validator` agent — its mandate is verification through **two
  non-overlapping data paths**. Launch it adversarially: its job is to *disprove* "done", not confirm it.
- If doer and grader are the same context, the score is `UNVERIFIED` by definition.

### 2. No bare numbers — every band cites reproducible evidence
Each system/band graded MUST attach at least one of:
- exact command(s) run **plus a real excerpt of the output** (not "I ran the tests" — the output),
- a `file:line` pointer to the code that proves the claim,
- a test name + pass/fail counts,
- a query + the rows it returned.

Evidence must be **reproducible** — another agent running the same command gets the same result.
No evidence → the band is recorded as `UNVERIFIED`, not as the number the doer wanted.

### 3. Fixed rubric — 10 is effectively unreachable
Measure every scan against this same ruler. Do not invent a per-scan rubric.

| Band | Meaning |
|------|---------|
| 0–2 | Broken / not implemented / crashes |
| 3–4 | Implemented but unproven; known correctness gaps |
| 5–6 | Works on the happy path; gaps under adversarial/edge conditions; some gates unenforced |
| **7–8** | **Institutional core: adversarially tested, gates enforced, residual known risks documented. This is the realistic ceiling for a maintained production system.** |
| 9 | 7–8 PLUS independent re-scan confirmed + failure-injection passed + zero open HIGHs |
| 10 | Reserved / effectively unreachable — would need formal proof + sustained live evidence. **If an agent writes 10, that is itself the red flag.** |

Trading Forge deep-scan history sits at **6.8–7.9**. That range is honest. A claimed jump of
**more than 1 band in a single wave**, from fixes alone, without an independent re-scan, is
**implausible** — flag it and downgrade to `UNVERIFIED` pending independent confirmation.

### 4. Re-measure from zero
Each scan re-derives the band from **current artifacts only**. "I fixed X earlier" is not
evidence X works now. Ignore prior scores and prior completion claims — including your own memory
of having fixed something. Grade what the code/tests/queries prove *today*.

## Output contract

Report scores only in this shape. One row per system. No prose numbers outside the table.

| System | Band | Status | Evidence | Open risks |
|--------|------|--------|----------|------------|
| e.g. DLL kill-switch | 7 | VERIFIED (accuracy-validator, 2 paths) | `npx vitest run kill-switch` → 14/14; `killswitch.ts:212` awaited force-close | race on cache-miss below 5s TTL |

- `Status` is `CLAIMED` (doer) or `VERIFIED` (independent grader) — never blank.
- A `VERIFIED` band that differs from the `CLAIMED` band by more than 1 → reconcile in writing.
  The default assumption on a gap is that the claim was inflated; prove otherwise.

## Red flags — auto-downgrade the score to UNVERIFIED

Any of these invalidates a score on sight:
- A bare number with no evidence pointer.
- The words **"10/10", "100%", "all systems", "fully", "completely", "bulletproof", "flawless"**.
- Score improved by >1 band in one wave with no independent re-scan.
- Grader is the doer.
- "should", "will", "probably", "expected to" in place of observed output.
- A "gate passes" claim that cites the gate's **own** self-report rather than an independent path
  (this is exactly the false-green class `accuracy-validator` exists to catch).

## Scope every score (companion rule)
Per the result-claim-scoping rule: scope every band to `corpus_version + battery + engine + data
snapshot`, and report uncertainty as a bound, not a point (e.g. "0/100 = ≤~3.6% @95%", never "0%").
A score with no scope is `UNVERIFIED`.

## The workflow in one line
Doer applies fixes → doer reports `CLAIMED` band + evidence bundle → **independent** `accuracy-validator`
re-derives the band from the evidence only → discrepancy >1 band triggers written reconciliation →
only then does a band become `VERIFIED`.
