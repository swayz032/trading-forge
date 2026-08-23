# ALGO-030 — ALGO-029 accepted. Derivation layer started, runbook + kill switch already landed.

**Strategy head:** `2b4c48484181` (pushed, verified) · PR #38 **DRAFT / DO NOT MERGE** ·
kernel/entries/force/engine **byte-identical to `068bb24a`** · grade still in flight.

ALGO-029's order is accepted: **DONE by the 27th, not parked.** Publishing and continuing rather
than idling on a round-trip, per your execution note. Checklist status below.

---

## Item 3 — safety core: **DONE**

Safety-critical coverage **0/7 → 7/7**, offline `FakeSession`, nothing connected.

**And it found a defect, which is the point of proving rather than documenting:**

> **A FAILED CLOSE ABORTS `flatten()` AND LEAVES LATER POSITIONS OPEN.**

`flatten()` closes one at a time and raises on a rejection, so the remaining positions stay
open. `cancel_all()` has the same shape. Measured, not assumed. It is in the runbook as the
loudest line in the document, with the instruction to re-run and then **check positions by eye**,
and the absolute fallback of closing in the TopstepX app.

## Item 6 — self-sufficiency pack: **1(a) and 1(c) DONE**

`ALGO-RUNBOOK.md` is on the branch: what the bot is, every command with exact syntax, how to
read the exam printout line by line, stopping everything, what each runtime refusal means, his
own words for incidents, where artifacts live, how to work with GPT after the 27th.

**It leads with what does NOT exist,** because a flattering runbook is worse than none: there is
**no "start the bot" command** — measured, the runtimes are libraries with no `__main__`;
nothing is connected; the ladder covers **eval and broker-paper too**; and a closing section
lists the remaining holes.

**A test runs every command the book documents**, extracted from the book itself, in a
subprocess, requiring a zero exit and non-empty output — he must have something to paste to GPT.
That test exists because the failure already happened: a documented command crashed on a renamed
key, and every unit test passed because they all call `measure()` and none call `main()`.
**A CLI is only proven by running the CLI.** It also pins the "expect 7 failures" number he uses
to tell normal from broken.

## Item 1 — the brain: **STARTED**

The derivation layer is built and tested, **BUILD ONLY** — not imported by kernel, entries,
engine or signal, and a test enforces all four.

The frozen spec is the textbook and it is far more specific than the code: `zone_gate` names
**six** valid rejection interactions where `_valid_rejection_side` has one. The layer names which
one occurred, and a test asserts the six constants match the spec **verbatim** so an edit forces
a deliberate update.

**APPROACH is computed.** The spec's `mere_approach_without_touch → NO_TRADE` means a real
approach needs a bar wholly outside the zone followed by one that touches it. The subtle case
has its own test: **price that sat inside the band all along has approached nothing**, though a
naive `_reaches` says yes on every such bar and today's literal says `approach=True` regardless.
`touch_without_directional_control → WAIT_OR_NO_TRADE` is enforced too.

Two things caught during the build, both worth the record:
- **My classifier scanned every bar for a rejection wick**, including bars nowhere near the zone,
  so a distant pin outranked the real touch. A wick ten points out is not a rejection *of the
  level*. Fixed.
- **The module refused my first control fixture and was right.** A big-wick small-body hammer is
  not directional control. The fixture was rebuilt, not the code.

**Next in item 1:** the story layer, then the four-route state machine tying approach →
interaction → story → force, then the §7 mutation campaign. The window amendment has its hazard
map already (ROLE-1 only; the `kernel.py:132` anchor untouched, per ALGO-028's law).

## Items 2, 4, 5 — not started

Item 2 is gated on the finished brain. Items 4 and 5 are documentation-shaped and I will take
them after the state machine, unless you want them earlier.

---

Suite **7 failed / 1187 passed**, enumerated; same 7, all outside this lane. **No PnL, realized
outcome, winner/loser label or clean-edge result participated in any decision in this packet.**
