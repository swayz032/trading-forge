# ALGO-114 — Runbook cold read. **The standing-state header of all five sunset documents carried a number no measurement supports, and it is arithmetically impossible.** The operator's commands, as printed, fail in PowerShell every time. Both fixed, both now guarded.

**Strategy head:** `69f6ca5b` (pushed, local == remote). **Suite:** 914 passed, 0 failed.
**Handover + runbook guards:** 23/23. **PR #38:** DRAFT / DO NOT MERGE.
**Nothing semantic changed. No question went to the operator. Reserved-class asks stay UNSENT.**

*Correction to my own commit message at `69f6ca5b`: it says "896 passed". The run was **914** —
the wider `-k` selection picked up the runbook-commands suite (7m12s). The figure here is right.*

---

## 0. YOU WERE RIGHT ABOUT THE PRIORITY, AND FOR THE REASON YOU GAVE

> *"A dead pointer in the handover costs GPT a lookup; a dead pointer in the runbook costs the
> OPERATOR the task."*

The runbook had **worse** defects than the handover, not milder ones. Both of the findings below
would have cost him the task on his first attempt, and neither was visible to any automated check.

## 1. THE WORST FIND — a number that cannot be true, in five headers at once

All five sunset documents carried, **byte-identical**:

> *"The bot's remaining known defect at 08:00 is that it spends its one daily trade BEFORE the
> operator's own entry clock on **13 of 14 sessions**."*

**No measurement supports 13.** And it is not merely unsupported — it is **impossible**:

> **A bullet cannot be spent in a session where the bot never traded.** The bot trades at all in
> **12** of 14. Any "spends it early in N of 14" claim is bounded above by 12. **13 > 12.**

**It had already been retracted — in a different document.** `ALGO-WORKER-SEAT-HANDOVER.md:45`:

> *"The earlier '13 of 14 / declines once' was the same instrument at `acceptance_bars = 2`
> before R1 — **a superseded brain**, not a different reading of this one."*

So the number was convicted once, corrected in the document that convicted it, and **survived
verbatim in five other headers** because nothing joined them.

### 1.1 What is actually true, measured from the frozen scorecard

| claim | measured |
|---|---|
| takes a trade at all | **12 of 14** *(he traded 7 of the same 14)* |
| bullet spent **before the audited window opens** | **10 of 14** — every in-window entry in those is unreachable |
| sessions where the bot traded **and** he entered — the only ones where the comparison is defined | **5** |
| of those, bot's first entry **precedes his clock** | **4** |

**The correction notice stays in the header**, rather than the number being silently swapped.

**Why the old guard never saw it:** the handover's accuracy test checked the document's *other*
number — `12 of 14` — and that one was right. **Nothing pointed at the 13.**

## 2. THE OPERATOR'S COMMANDS DO NOT RUN AS PRINTED

Every command in the runbook is written `PYTHONPATH=. python -m ...`. **That is Mac/Linux syntax.**
Run verbatim in PowerShell on this machine:

```
PYTHONPATH=. : The term 'PYTHONPATH=.' is not recognized as the name of a cmdlet,
function, script file, or operable program.
```

**It fails every time.** The book *did* mention this — as a conditional aside: *"If PowerShell
objects to `PYTHONPATH=.` at the front of a line…"*. **PowerShell always objects.** Phrasing a
certainty as a contingency is why he would have hit it, tried the thing that reads as the primary
form, and been stopped on his first paste.

**Fixed:** the two working lines (`cd`, `$env:PYTHONPATH = "."`) are now the **primary
instruction**, up front, followed by *"then every command below is just `python -m ...`"* — with
the **literal error text** so he recognises it, and the note that seeing it means a fresh window.
Both the failure and the fix were **verified on this machine**.

## 3. THE SAME THREE DEAD POINTERS, NINE TIMES — one inside the STOP procedure

`KILL-AND-HEARTBEAT.md` (×6), `SELF-EXPLANATION-AUDIT.md` (×2), `SEAT-HANDOFF-TEMPLATES.md` (×1).
All three are **`ALGO-`-prefixed on disk.**

**One of them is at line 378 — the "stop everything" procedure.** The operator trying to halt
something was being sent to a file that does not exist. Every cited **section number** was
verified to exist and to match its described content.

## 4. COMMANDS RUN VERBATIM BEFORE PUBLISHING, as ordered

`external_evidence_custody` and `refusal_legibility` both run and **match their documented sample
output**; the documented `python -c` one-liner runs and prints the documented format; all five
documented modules exist. The git commands were run as printed.

## 5. THE GUARD — derived, and its first version was green on a deleted claim

Added: the standing-state numbers are **re-derived from the scorecard** and asserted in **all five**
documents; the arithmetic property that convicts the old number (`pre_window <= traded`); and a
test that `13 of 14` may appear **only inside its own retraction**.

**Then the battery caught my guard, again.** The first version searched **the whole file**, so
deleting the measured bullet outright **stayed green** — because `**12 of 14**` also occurs in an
unrelated sentence further down the runbook.

> **A CLAIM THAT CAN BE SATISFIED BY A COINCIDENTAL MATCH ELSEWHERE IN THE FILE IS NOT BEING
> CHECKED WHERE IT MATTERS.**

Now scoped to the leading standing-state blockquote. **5/5 RED** — retracted number restored,
two different numbers drifted, the bullet deleted, the whole block deleted — byte-exact restore
`sha256`-verified.

**That is the second consecutive packet in which the guard I wrote to close a finding was itself
defective, and the battery — not review — found it both times.** Planting the *original* defect
rather than one of my choosing is what makes the difference.

## 6. ALSO LANDED — ALGO-113's band-edge requirement, verbatim

In GPT's first task as a hard requirement: `_pivot_close_away` ends `except Exception: return 0.5`
— acceptable for a quality score, **unacceptable for a band edge**, because a failed join yields a
plausible zone unrelated to the candle that drew it and **nothing goes red**. The band build must
**fail loudly** — raise, or emit an explicit refusal literal; it may not inherit the fallback and
may not be silently absent.

## 7. WHAT I DID NOT DO

No semantic code changed — five markdown files and one test. `ALGO-111 §5`'s AST sweep **not
started** (order 3, "only if time remains"; the cold read consumed it). No band built.
`kernel.py:205` untouched. Nothing from B1 on any pushed branch. Re-exam #4 not run. **The
engine-crash defect `V24_TARGET_DISTANCE_LT_REACTION_CONTACT` (`target_policy.py:157-161`) is
still carried and still unfixed.**

## 8. FOR ALGO-115

1. **The AST sweep is the last named item I have.** It is the honest instrument behind
   *deriving from the declaring surface is not deriving from the code*, and it is a precondition
   for the established-band path. Say whether it runs next.
2. **Your instrument-risk finding got worse, not better.** Of the last **six** defects I have
   found, **five were in instruments**: the stale F2 anchor pin, the typed-list path guard, the
   filter written from the fixed spelling, the whole-file claim search, and now a false number
   that five documents asserted and no guard examined. The strategy is better measured than the
   things measuring it.
3. **Nothing joins the five sunset documents.** They share a byte-identical header and had no
   test that they agree — which is exactly how one wrong number lived in all five. That guard now
   exists for the standing-state block **only**. The rest of the shared content is still unjoined.

---

**Enumerated.** 5 markdown files + 1 test changed. Battery: 5 defects, all RED, byte-exact
`sha256`-verified restore. 4 documented commands + 2 git commands run verbatim; 5 modules
existence-checked; every cited section number checked. Path scan: 16 paths named, 0 unresolved
after repair. Suite 914 passed / 0 failed at `69f6ca5b`.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
