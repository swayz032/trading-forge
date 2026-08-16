---
name: ratify-packet
description: >-
  Use when a change would touch INSTRUMENT code — measurement, validity, or
  engine surfaces (backtester, gates, classifiers, extraction-fidelity logic,
  sizing math, anything that produces numbers other decisions trust) — BEFORE
  writing any code. As of the 2026-07-11 operator amendment, instrument changes
  proceed AUTONOMOUSLY under mandatory independent grading (doer != grader); only
  the irreversible / live-capital class waits for the operator's explicit go.
  Also use when judging whether a change is in that reserved class.
---

# Ratify Packet — autonomous under independent grade (operator-amended 2026-07-11)

## Operator amendment (2026-07-11) — read this first

The operator ratified relaxing this skill from "wait for explicit per-item
permission before writing instrument code" to **"proceed autonomously under
independent grading."** His instruction: stop asking permission on every
instrument fix; use best judgment on what's best for him.

This amendment KEEPS the mechanism that actually caught the F-2 / timestamp-emit
/ Defect-10 defects — the **independent grader (doer != grader)** — and DROPS the
permission-wait for everything except the irreversible / live-capital class.
Reason it holds: in all three historical saves it was the independent grader,
not the operator's go, that caught the defect. Verification is the protection;
the permission ceremony was not.

## The standing rule (amended)

Any instrument-touching change still **stages its full 5-part packet** (below)
as its receipt, then **proceeds autonomously through the agent-loop**
(scope-locked implementer -> fresh-context independent grader). The **independent
grade — not operator permission — is the gate.** The operator holds a **standing
veto** and gets a post-hoc summary he can reverse.

★★★ **THE GRADER HAS A NAME: THE `accuracy-validator` AGENT. Dispatch it — do not
invent a grader, and do not park the grade on "the advisor seat" or "a fresh
session."** Its mandate is false-positive hunting through **two non-overlapping
data paths**, which is exactly the shape of every claim this skill gates
("nothing changed", "the gate passes", "the refusal set is identical"). Launch it
**adversarially: its job is to DISPROVE "done", not to confirm it.**
★★★ **NEITHER THE DESIGNER NOR THE BUILDER MAY GRADE.** If this desk proposed the
change and a worker built it, *both* are disqualified however carefully either
checks — **independence is structural, not a matter of how honestly you look.**
★★ **DISPATCH IT EARLY, when the claim is made — not as a final formality before
merge.** (2026-07-29: this skill demanded an "independent grader" seven times and
never named one, so a whole advisor session routed grades to itself and a
hypothetical future seat. The operator had to point out the agent existed. On its
first real dispatch it found four failing tests that the designer AND the builder
had both missed — each had verified their own claim correctly and both had scoped
the question identically.)
★★★ **A RESTRICTION IN THE GRADER'S BRIEF IS A HOLE IN THE RESULT.** Before
dispatching, ask **which claim each restriction makes uncheckable** — if that
claim is the point of the work, the restriction is wrong. (Same session: "do NOT
touch the database" was written in for safety and guaranteed the one figure the
patch existed to produce came back UNVERIFIED.) Hand it the working access
recipe, and ask explicitly for the honest null: *"no refutation found, here is
what I covered and what I could not"* is a complete answer.

**Explicit operator ratification is STILL required — do NOT self-authorize — for
the irreversible / live-capital class only:**
- a change that alters a **live default in effect while live trading is active**
  (real capital moving in a funded account right now);
- a change that **re-baselines or invalidates a frozen / certified ref** other
  decisions already trust (frozen-policy hash, a VERIFIED band, a golden fixture,
  a live promotion threshold in force);
- **deleting or overwriting operator data**, or anything genuinely hard to reverse.

Everything else instrument-touching — the normal case while the system is
**pre-live** (nothing live-trading yet, by design) — proceeds: stage packet ->
implement via agent-loop -> independent grade -> post-hoc summary. A wrong edit
pre-live corrupts numbers a later decision would trust, NOT capital today, and
the independent grade catches it before it can go live. That is exactly the
window the F-2 save happened in.

If genuinely unsure whether a change is in the irreversible/live-capital class:
it is — get the explicit go (cheap). Otherwise, move.

**The operator is a non-coder (2026-07-11).** He cannot and should not evaluate
technical packets — asking him to "ratify" a code diff is rubber-stamping, not a
safety check. So: the reserved-class go/no-go is surfaced to him in **plain
English** — what it means for his money and his system, one decision, in the
plain-English style the `grading-integrity` + plain-English-stats rules require —
NEVER a code diff or a 5-part technical packet. The 5-part packet is the receipt
the INDEPENDENT GRADER rules on; the operator rules on a plain-English summary.

## What counts as instrument-touching

Code whose OUTPUT other decisions trust: the backtest engine and fill/P&L math,
promotion gates and their thresholds, classifiers that rule on validity/context,
extraction-fidelity logic, sizing math, MC/WF statistics. Review-time data paths
are instrument surfaces too — a "test-only" proxy that substitutes for the
production representation is still an instrument change.

NOT instrument-touching (no packet needed): docs, memory, ops tooling,
dashboards, alert plumbing, log lines — provided they don't alter any measured
value or gate outcome.

## The packet — the receipt that ships with the change

Stage these five facts BEFORE implementing (they are the receipt + the review
anchor, and for the irreversible/live-capital class they are what the operator
rules on):

1. **What & why now** — the defect or need, with receipts (repro command +
   output, file:line), never a narrative.
2. **Blast radius** — which certifications, baselines, or frozen refs this
   invalidates; which downstream consumers change behavior.
3. **The exact change, scope-locked** — what will be edited and what is
   explicitly OUT of scope.
4. **Verification plan** — the empirical proof that will accompany the change
   (parity run, flip-enumeration, receipt artifact). A derivation ships with its
   own receipt or it doesn't close.
5. **Rollback** — how to revert cleanly. Env/flag-gate any change that alters a
   live default.

For the irreversible/live-capital class: stage the packet, then **HOLD** for the
explicit go. For everything else: stage the packet, then implement.

## What ratification IS and is NOT (irreversible/live-capital class only)

| Counts as EXPLICIT ratify | Does NOT count |
|---|---|
| Operator addresses THE named item with a go — "ratified", "approved", "fire", "yes do it" | Silence / no objection after time passes |
| A blanket "I approve, use your judgment" — for the AUTONOMOUS class this IS the standing authorization; for the irreversible/live-capital class, confirm the specific item | Approval of a DIFFERENT packet used as cover for an unrelated live-capital change |

## Implementation discipline (every instrument change, autonomous or ratified)

- Run through the **agent-loop**: scope-locked implementer -> fresh-context
  independent grader — no tired hands in the doer OR grader seat. This is
  mandatory and non-negotiable; it is the defect-catcher.
- Agent loops replace tired HANDS (mechanical: diff + tests); they do NOT replace
  validity READS (empirical parity/materiality).
- The change lands with its receipt; certification via skill `grading-integrity`
  (doer != grader). A >1-band self-claim is UNVERIFIED until an independent grader
  re-derives it.
- Post-hoc summary to the operator on every instrument wave: what changed, the
  independent grade, residual risks — so his standing veto is informed.

## Rationalizations — still invalid

| Excuse | Reality |
|---|---|
| "Autonomy means skip the independent grade too" | No. Autonomy dropped the permission-wait, NOT the grader. The grader is the whole protection. |
| "It's live-capital but tiny/obvious" | The irreversible/live-capital class waits for the explicit go regardless of size. F-2 was tiny and shipped a defect. |
| "Pre-live so I can skip verification" | Pre-live drops the PERMISSION-wait, not the verification. A corrupted number pre-live silently poisons every later decision. |
| "I'll grade my own fix" | Doer != grader, always. Same context grading itself is UNVERIFIED by definition. |
