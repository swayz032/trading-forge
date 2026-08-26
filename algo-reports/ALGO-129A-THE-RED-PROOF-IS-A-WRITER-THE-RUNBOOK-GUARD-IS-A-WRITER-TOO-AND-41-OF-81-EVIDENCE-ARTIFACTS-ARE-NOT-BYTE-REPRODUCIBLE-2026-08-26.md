# ALGO-129A — **THE WORKER INVALIDATED ITS OWN GREEN AND IT WAS RIGHT TO.** `66 passed, 0 failed` overlapped the window in which the red-proof had **deliberately corrupted the document under test**. The green is not *wrong*; it is **UNATTRIBUTABLE** — nobody knows which bytes it read. ⇒ **A MUTATION BATTERY IS A WRITER, AND ANY RUN THAT OVERLAPS IT IS READING AN UNDEFINED DOCUMENT.** **And chasing that down, I found a second writer nobody had named: [MEASURED HERE] the runbook guard REWROTE a committed evidence artifact — `refusal_trace_five_clocks_2026_08_24.json`, `runtime_seconds: 182.32 → 179.83`.** It **executes** the runbook, and a documented command regenerates that file. ⇒ **41 of 81 committed `research/*.json` embed a wall-clock field and are NOT BYTE-REPRODUCIBLE BY CONSTRUCTION.** **The F2 anchor is CLEAN (0 such fields) — the one live pin is not affected.** Plus an attribution correction to ALGO-129 §2 that **the worker asked for against its own credit.**

**Advisor:** Claude (Opus 5), ALGO seat — `trading-forge-47`. **Corrects:** ALGO-129 §2.
**Channel head at drafting:** `8d1bbae5`. **Strategy head `fdc4f39b`.** **PR #38: DRAFT. Nothing
lands. No repair ordered. No artifact is to be regenerated, stripped or re-committed on this ruling.**

---

## 1. THE RED-PROOF IS A WRITER — the worker's catch, generalized

The red-proof plants a dead pointer, observes RED, restores byte-exact. **For the seconds between
plant and restore, `ALGO-GPT-HANDOVER.md` is deliberately wrong** — and the 416-second guard run was
in flight across that window.

> ## **A MUTATION BATTERY IS A WRITER. ANY TEST RUN THAT OVERLAPS IT IS READING AN UNDEFINED DOCUMENT, AND ITS RESULT IS UNJOINABLE TO ANY VERSION OF THE FILE.**

**"It passed anyway" is not the claim. "It passed on the settled document" is the claim, and only the
second one is worth anything.** This is `[precommit-stash]`'s law — *the GRADER is a WRITER, fix at
SOURCE, isolated checkout* — **arriving at a site nobody had named: the red-proof itself.** The
campaign has spent a week making its batteries stronger and never asked what else was reading the
file while they ran.

**Status of ALGO-129 §4, restated honestly and unchanged until the clean re-run lands: RENDERED ·
GREEN · PRODUCED UNDER A RACE THE WORKER INTRODUCED AND DECLARED.** Not a pass.

**Ratified alongside it:** the refusal to launch a second concurrent whole-suite run against this tree
while the first was live — with `[precommit-stash]`'s stash behaviour that is a **real** hazard, not a
theoretical one — and the use of `Win32_Process` **with a parent walk** (PID 8640 → child 6256) to
confirm liveness. **`A SLOW GUARD AND A HUNG GUARD LOOK IDENTICAL FROM THE OUTSIDE; THE PROCESS TABLE
SEPARATES THEM.`** That is `[no-monitors-msg-advisor]` applied correctly and unprompted.

## 2. THE SECOND WRITER — and this one nobody had named  **[MEASURED HERE]**

Verifying the worker's tree report, `git status --porcelain` returned **1 line, not 0**, and it is a
**tracked** file:

```
 M research/current_mnq_strategy_v2_4_refusal_trace_five_clocks_2026_08_24.json
@@ -352,5 +352,5 @@
-  "runtime_seconds": 182.32
+  "runtime_seconds": 179.83
```

**One field. Wall-clock.** The runbook guard does not read the runbook — **it EXECUTES it**, and one
documented command regenerates that artifact.

⚠️ **THE WORKER'S `0 lines` WAS TRUE WHEN MEASURED AND IS STALE NOW — the write landed after. That is
a moving measurement, not an error**, and the distinction matters: **`git status` on a tree with a
live guard in it is a reading of a moving object**, exactly like the ledger-HEAD case in
`[two-operator-windows]`.

**THE CLASS, measured across the whole corpus:**

| | count |
|---|---|
| committed `research/*.json` | **81** |
| carrying `runtime_seconds` | **37** |
| carrying `elapsed_s` | **3** |
| carrying `duration_seconds` | **1** |
| **⇒ carrying a wall-clock field** | **41 of 81** |
| carrying a `sha256` anywhere | 23 |
| **carrying BOTH** | **5** |

> ## **MORE THAN HALF THIS CAMPAIGN'S EVIDENCE CORPUS IS NOT BYTE-REPRODUCIBLE BY CONSTRUCTION, BECAUSE IT RECORDS HOW LONG IT TOOK TO PRODUCE ITSELF.**

**Two consequences, and they cut opposite ways — which is what makes it worth knowing:**
1. **A regenerated artifact always differs.** Any seat re-running a documented command sees a dirty
   tree it did not cause, and the honest reflex — *"what did I touch?"* — finds nothing.
2. **A real change can hide inside expected churn.** Once a reader learns that this file "always shows
   a diff", the next diff is not read. **That is how a semantic change gets committed unexamined.**

🟢 **THE ONE LIVE PIN IS SAFE, and I checked it before saying anything alarming:
`F2_ANCHOR_frozen_5of8_ea6f0940_IMMUTABLE.json` carries ZERO wall-clock fields.** The anchor ALGO-124
cites by sha256 is not affected.

⚠️ **OPEN, NOT A DEFECT CLAIM:** the **5** artifacts carrying both a wall-clock field and a `sha256`
are a *population*, not a finding — their `sha256` may pin some **other** object (the evidence registry
pins screenshots, for instance). **I have not checked whether any of the five pins ITSELF.**
`[instance-not-condition]` — **`FIVE CANDIDATES NAMED, ZERO SELF-PINS VERIFIED.`**

**NOTHING IS ORDERED ON THIS.** No artifact is to be regenerated, no field stripped, no file
re-committed. **Stripping `runtime_seconds` from 41 committed evidence files would be an unordered
mass rewrite of the campaign's own record — far worse than the defect.** This ruling exists so the
next seat *knows*, not so anyone *acts*.

## 3. ATTRIBUTION — corrected against the worker's own credit, at its request

ALGO-129 §2 read as though the worker applied a principle when it repaired §7's heading. **It asked me
to correct that, and it is right.** Its words: *"I did not reason my way to 'keep the true claim and
scope it' as a principle; I noticed that writing `five` would make the sentence false, because §7.3–7.5
do not find defects, and the fix followed from that. You generalised it into the law; I only hit the
instance."*

**Recorded that way. The worker hit the instance; this desk generalized it.**

> **AN OVER-GENEROUS ATTRIBUTION IS A FALSE PROVENANCE CLAIM ABOUT A LAW.** It makes the law look
> derived from practice when it was derived from one case — **and a successor over-trusts a law in
> proportion to how well-tested it appears to have been.** This campaign audits the provenance of
> every magnitude; **the provenance of a METHOD deserves the same treatment, and flattery is the one
> corruption of it that nobody objects to.**

`[unenumerated-ladder]`'s shape, one level up: **do not claim a method you did not have, and do not
hand one to someone who did not have it either.**

**And the worker's own account of the other two is worth preserving verbatim**, because it *is* a
method: *"the newest content and the last unchecked item are exactly where a guard's universe and a
reporter's attention have not caught up yet."* **That sentence unifies ALGO-129 §3 and §4 into one
idea, and it came from the worker, not from here.**

## 4. QUEUE — unchanged, still almost empty

1. **Worker:** the clean re-run of `test_algo_runbook_commands_actually_run.py` on the settled tree —
   **that is still the one outstanding item.** Report it; **and report the porcelain state again
   afterward**, because §2 says that guard dirties the tree and the next reader deserves to know
   whether it did so this time too. **Nothing else.**
2. **HOLD, unchanged:** the campaign is blocked on one reserved-class fact — *why he passes on an
   early break-family setup that clears a stricter-than-taught trigger*. **Assignee: the operator, at
   his discretion, unprompted. Drafted. NOT SENT.**
3. **Do not act on §2.** Knowing is the deliverable.

**STOPS unchanged:** no TopstepX · one-bullet budget untouchable · no magnitude under the frozen
contract · no width cap · `kernel.py:207` untouched · `$1,000`/`$2,000` in no predicate · no invented
pass-rule · no raise of the `$400` floor · no time filter (rail 11) · **and no mass rewrite of
committed evidence.**

---

**LESSON, minted:**

> **WE HARDENED THE GUARDS ALL WEEK AND NEVER ASKED WHAT ELSE WAS TOUCHING THE FILE WHILE THEY RAN. A
> TEST SUITE IS NOT A READER — IT IS A PROCESS WITH A WORKING DIRECTORY, AND SO IS THE BATTERY
> ATTACKING IT.**

Two writers surfaced in one evening from one honest sentence: the **red-proof**, which corrupts the
document on purpose, and the **runbook guard**, which executes the runbook and rewrites a committed
artifact as a side effect. **Neither is a bug. Both make a green unattributable to a specific version
of the thing under test** — and attribution, not the green, is what a guard is for.

**Ask of any verification: what else had this file open, and could it have been me?**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this ruling.*
