# ALGO-182 — SOURCE REPAIR LANDED. **`10 of 56 → 0 of 56`.** P1's reach annotated. Runbook now asserts a **SET**.

**Strategy head:** `9e0bc950` — pushed, remote-verified. **PR #38: DRAFT / DO NOT MERGE.**
**Semantic files modified:** `premarket.py` (signature), `kernel.py`, `levels.py`, `candidate_xray.py`
— all authorized by ALGO-181.
**Full-suite membership vs the reverted-kernel baseline: ZERO new failures. One GONE.**

---

## 1. THE REPAIR — at the source, not at the call sites

**`build_premarket_plan_v24` now takes a REQUIRED `as_of`.** It previously took no anchor at all,
so **there was nowhere for a caller to be causal even if it wanted to be — the absence of the
parameter was the defect.**

- **`as_of` is positional and required, with no default.** A default of `None` would have silently
  restored the defect for the next caller who forgot, and this campaign has already watched a
  `09:30` literal survive its own deletion by moving to another file. **Explicit `None` is still
  permitted and means *"the whole premarket session, NOT FOR DECISION USE"* — so a non-causal use
  is greppable rather than invisible.**
- **`PRE_END = 09:29` untouched** — the definition of the premarket session, not a parameter.
  **No constant is chosen anywhere in this repair.**
- **Truncation is BY COMPLETION** (`index + 5m <= as_of`), because a 5m bar stamped `09:25` has not
  printed at `09:29`. The inherited routine then applies its own `PRE_END` window, so the effective
  bound is exactly **`min(as_of, PRE_END)`**.
- **The same-day half of the OVERNIGHT range at `v2_2_engine.py:651` is bounded by the same
  truncation — for free.** A call-site patch would have left it for the next enumeration.

**Call sites:** `kernel.py` moved **inside the bucket loop** passing `ts` · `levels.py:252` passes
`open_ts` · `candidate_xray` passes its own · three test sites pass an explicit `None`.

## 2. ACCEPTANCE

| | result |
|---|---|
| **`P3`** — plan builder causal given its anchor, **all 16 fields** | **56/56 PASS** + field-enumeration control |
| **pinned measurement, predicate unchanged** | **`plan.primary` `10 → 0` of 56** · **`pm_structure` `2 → 0` of 56** |
| **`P1`** — unchanged instrument | **56 of 56** |
| **`P2`** — widened | **PASS** |

**P3 compares ALL 16 plan fields, not the three consumers read today.** A test scoped to today's
consumers goes blind the moment a fourth field is read — **and the reason this defect survived is
precisely that `plan` was consumed somewhere nobody was looking.**

**P3 CONTROLS, RED BEFORE THE RESULT WAS REPORTED:**
- the original defect (anchor accepted, then ignored) → **56 failed**
- a one-hour peek → **56 failed**
- **a SINGLE-BAR peek → 56 failed** — P3 is sensitive at one bar, not just grossly

## 3. 🛑 P1's REACH, ANNOTATED IN ITS OWN FILE

> **P1 EXERCISES `build_entry_locations_v24` ONLY. IT IS NOT EVIDENCE ABOUT THE DECISION PATH.**

The larger leak sat at `kernel.py:232`, outside that call graph, **while P1 returned green on every
question asked of it.** P1 is correct, its controls fire, its mutations go RED — **and its reach was
narrower than the defect.** A **sixth** way a guard goes green for the wrong reason, after the
population, the scope, the filter, the unit and the mutator: **an instrument looking at exactly the
right thing, and not far enough.** It is the hardest to catch, because *every question you ask it
comes back correct*.

**P2 WIDENED so this cannot recur:** it now asserts the premarket builder is anchored on `ts` too,
**and that both anchored builders sit INSIDE the per-decision loop.** Guarding only the convicted
call is how the bigger leak survived. Controls RED: no-`as_of` · wrong anchor · **hoisted out of
the loop**.

## 4. 🛑 A GUARD OF MINE THAT WAS **RED FOR THE WRONG REASON**

The hoist test raised `AttributeError` on AST nodes without a `lineno`. **Its red-proof reported
RED and looked like success.** A guard red for the wrong reason is as useless as one green for the
wrong reason — **and it is harder to notice, because in a red-proof, red is what you are hoping
for.** Fixed with `getattr` plus a vacuity assert, then re-proved.

## 5. RUNBOOK: COUNT → MEMBERSHIP

**A count survives a swap.** Third surface carrying that law in one day, after the memory index and
the regression comparison.

**The runbook ALREADY LISTED the seven names — the guard simply was not reading them.** The data
was there and the assertion was weaker than the documentation it checked. Nothing had to be written
down; something had to start being read.

Now asserted in **both directions separately**: NEW failures the runbook does not list, and listed
failures that now PASS. It also cross-checks the runbook's own count against its own list.

**RED-PROOFED BY THE CASE THE OLD GUARD COULD NOT SEE:** one failing name swapped for a real test
that currently passes, **count unchanged at 7** → **RED**, byte-exact restore.

**And a parsing bug of mine it caught by failing loudly:** I called `removeprefix` *after* `split`,
so every row parsed to the literal `"FAILED"`. Fixed, plus a vacuity guard and a shape check —
**an empty parse would have left the new-failure assertion green and silent.**

## 6. FULL-SUITE MEMBERSHIP

**ZERO new failures** against the 8-member reverted-kernel baseline. **One GONE** — the runbook
count test, which now passes. `7 failed, 1858 passed`.

## 7. NOT DONE, NOT CLAIMED

**The 15m optimisation is not started** — it is next and is now genuinely unblocked, since the
window semantics it must prove exactness against are finally settled.
**No PnL · no MC · no re-score · no map build · `warmup_ref` not moved · no adoption decision.**

⚠️ **One observation, not a task:** `candidate_xray.py` still anchors at `09:30` and therefore no
longer mirrors the repaired kernel. **It is a diagnostic, not production, and I have not changed
its anchor — but anything read from it is now measuring a different engine than the one that runs.**

*No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in
this packet.*
