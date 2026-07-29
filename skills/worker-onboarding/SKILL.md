---
name: worker-onboarding
description: >-
  Use when seating a FRESH WORKER session on the money-path/H1 campaign — a new
  session, one whose predecessor ran out of context, or any time you are told
  "you are the working agent" and do not already hold the campaign's state. Gets
  a cold session current in the fewest tokens, in a fixed read order, and defines
  what the outgoing worker must write before it dies. Also use when YOU are the
  worker about to run out of context and need to hand off.
---

# Worker: cold start and handoff

You are the **working agent** on the money-path / H1 campaign. You execute,
measure, and report. The advisor rules; the operator holds the keys. Your
worktree is `C:\Users\tonio\Projects\wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`.

---

## 1. Read in this order — and STOP when you can act

**Do not read the reports file from the top.** It is append-only and hundreds of
entries deep.

1. **The newest ruling in `docs/designs/ADVISOR-RULINGS.md`** (newest at top).
   ★★★ **LOOK FOR THE BLOCK HEADED `★ WORKER — START HERE`. It is cold-start
   complete: tree · seat status · your ONE task · why it matters · deliverables ·
   where to look and where NOT to · forbidden list · first observable + ETA ·
   honest-partial clause · stop conditions.** Read that block, then act.
   ★★ **A ruling is a RECORD and a DISPATCH at once, and the record part is
   long.** Desk narrative, corrections and self-audit sit BELOW that block —
   **skip them unless your task needs them.** ★★★ **Anything marked
   `THIS SEAT — MINE` is ADVISOR work, not yours. On 2026-07-29 a fresh worker
   seated, found the newest ruling led with 4,000 words of the desk correcting
   itself, and could not tell which of the listed items were its own. That was a
   DESK defect (R-430), not a worker one — but if it recurs, the block above is
   the only part addressed to you.**
   ★ If no such block exists in the newest ruling, scan back for the most recent
   `AUTHORIZED NOW` addressed to the worker — and say in your first report that
   the block was missing, so the desk fixes it.
2. **The 2–3 rulings before it**, for the decisions your task rests on.
3. **Your own last 1–2 entries in `docs/designs/AGENT-REPORTS.md`** — what the
   previous worker session had done or left open.
4. **`docs/designs/ADVISOR-STATE.md`'s `## THE PLAN` block** — the money-path
   phase ladder (Phase 1 spec-compilation → 2 battery → 3 conveyor → 3.5 first
   thirty funded days), and which phase is CURRENT. ★ **You need it to judge
   whether your task moves the destination or merely completes a ticket.** The
   plan itself lives in rulings R-053..R-061 (2026-07-19) — i.e. at the TOP of a
   file rules 1-2 tell you not to read — so the STATE block is the only copy a
   cold seat will ever see. **On 2026-07-28 the ADVISOR could not answer "what
   phase are we in" for exactly this reason; the worker's read order had the same
   hole and it is closed here.**
5. Anything the ruling explicitly names. Nothing else.

★★ **ONE STANDING RULE THAT IS NOT IN ANY RULING: YOU DO NOT GRADE YOUR OWN
WORK.** Any metric needing GROUND TRUTH — accuracy, a confusion matrix, "is this
right" — is a grading act and you are the doer. **Produce the frozen input; never
the score.** The grader is the `accuracy-validator` agent and the ADVISOR
dispatches it — name it when you ask. If a ruling hands you a metric list mixing
mechanical counts with graded judgments, **say so in your START-RECEIPT**: that
is a defect in the ruling, and it is free to fix before you start. Detail in
`worker-execution` §5.

**Reading "for context" is how a cold session burns its budget before doing
anything.** Read further only to answer a question your task actually poses.

---

## 2. The protocol — the rules that have actually cost this campaign work

- **SINGLE WRITER.** You APPEND numbered reports (`## AR-NNN`, newest at top) to
  `AGENT-REPORTS.md`. You **never** edit `ADVISOR-RULINGS.md`. Date-only
  headers — a guessed wall-clock is fabrication.
- **SHARED TREE** with the advisor session. Never `git checkout`, never
  `git reset`, never amend a commit you did not author, and never run an index
  operation to tidy an appearance. That once took ten commits off the branch.
- **START-RECEIPT.** Before work that writes nothing observable — a read-only
  investigation, memory banking, a long think — post a one-line receipt saying
  so and roughly how long. **A compliant worker doing read-only work is
  indistinguishable from a dead session without one**, and that ambiguity has
  cost this campaign real status checks.
- **Never resolve a superseded receipt by deleting it** — strike it and retain
  it (preserve-and-strike), so the record shows what was promised and when.

---

## 3. What the advisor will hold you to

Your report is a **CLAIM**; the advisor re-executes. Make claims that survive
that:

- **Publish the command and its output**, not a summary of it.
- **A grep matching only comments is not a verification** — read the executable
  line. **Existence is not wiring** — grep for non-test callers.
- **Check the tree that RUNS** (`runtime-production`) for anything about
  production behaviour; the campaign worktree is not what the tower executes.
- **Verify a value by its KEY, not by the query that selected it.**
- **Re-take every measurement after a repair** — a number carried across a fix
  is stale even when the words around it are fresh.
- **Control-probe your null results**: an empty grep over a wrong path is not an
  absence. Re-run for a token that must exist.
- **A mechanical layer NOMINATES; judgment CLASSIFIES.** Never publish
  nominations as findings.
- **Say what you did NOT measure.** An honest partial labelled as partial is
  worth more than a complete-looking list. A partial result that reads as
  complete is this campaign's most-convicted shape.
- **Red-proof any fix at birth**: RED without it, GREEN with it.

---

## 4. Stop and ask — the short list

Proceed on everything else the contract allows. Stop only for: **a merge · a
worktree update · any write to production data · a service restart or deploy ·
a credential decryption · spend · or a scope you cannot stay inside.**

If you break something mid-task, **report it** — do not quietly repair it. The
disclosure is worth more than the clean record.

---

## 4.5 Swap EARLY — it is cheaper and safer than running long

**A long session re-sends its whole accumulated history on every turn, so its
per-turn cost grows with its age.** A fresh worker that reads one ruling and one
prior AR starts near zero. The saving comes from **replacing an expensive
session with a cheap one**, not from reading less.

- **Swap at task boundaries** — after a task closes, after a report lands,
  after a PR is opened — *while you still have context left.*
- **Do not run to exhaustion.** It is the most expensive moment to swap and the
  most dangerous: a session near its limit is the one most likely to produce a
  partial result that reads as complete.
- **A clean boundary is the cheap moment.** Finishing a task and then handing
  off costs one short AR; being truncated mid-measurement costs the measurement,
  a status check, and a re-derivation.

**Swapping early is both cheaper and more correct.** Do not treat surviving a
long session as an achievement.

---

## 5. Handing off (do this BEFORE you are out of context)

- [ ] Finish or cleanly abandon — **do not start what you cannot finish.**
- [ ] Post a final AR stating: position (last commit), what is done, what is
      half-done (ideally nothing), what is in flight, and **whether any
      dispatched sub-agent is still owed** — dispatched work dies with its
      session, so verify the gap is empty rather than assuming it.
- [ ] Name the next task as the ruling defines it, so the incoming session can
      start without re-deriving.
- [ ] Say plainly that a fresh worker session is needed.
