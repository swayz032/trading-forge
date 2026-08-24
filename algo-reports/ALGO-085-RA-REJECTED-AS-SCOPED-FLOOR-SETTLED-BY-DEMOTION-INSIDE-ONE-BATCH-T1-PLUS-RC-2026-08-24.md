# ALGO-085 — R-A REJECTED AS SCOPED: its own pre-registration decided, and it is honoured. The floor-coupling question is answered NOW, by design: the $400 floor is DEMOTED inside one unified batch (T1 target semantics + R-C freshness), never touched standalone. Law minted: a repair's guard measures the layer the repair acts on.

**Advisor:** Claude (Fable 5), ALGO seat. **Rules on:** ALGO-084 @ `ed8241cc`, strategy head
`2a84102a` (ls-remote verified; chain `a19a1c49 → 2a84102a`). **Channel head at drafting:**
`ed8241cc`. **Main-channel head:** `c62bb561e015`, untouched. **PR #38: DRAFT / DO NOT MERGE.**
**DECISION: R-A REJECTED AS SCOPED (§2) + R-B HELD (§3) + FLOOR COUPLING SETTLED BY DESIGN
(§4) + ONE BATCH REPORT ORDERED (§5).** Newest ladder entry: ALGO-084.

## 1. Verification [MEASURED HERE unless graded]

- `target_policy.py` at `2a84102a` vs `a19a1c49`: **empty diff — reverted byte-exact.**
  Commit adds only the held patch, held tests (`.txt`, inert), the guard artifact, and the
  capture script. Suite 1645/7 [RELAYED].
- Guard artifact re-derived from rows: **ADDED 18 · REMOVED 0 · TARGETS CHANGED 27** across
  the nine named sessions; the 04-07 08:28 L BRK5 addition is present by key. Verdict field
  `FAILS_PRE_REGISTERED_EXPECTATION_NOT_LANDED` matches the row data. (The 04-07
  before-reason string `TP1_REFERENCE_REWARD_UNDER_400:90.00` is [ARTIFACT-SOURCED to the
  report; the guard rows carry keys, not reasons].)
- **The coupling mechanism read at the executable lines** (`classify_first_reaction_
  destination`, target_policy.py:112–165 at `2a84102a`): the floor evaluates the FIRST
  meaningful non-processed destination and **refuses OUTRIGHT — it does not roll to the
  next destination.** So whichever zone is nearest after any universe change re-rolls the
  entry decision single-shot. That is why 18 entries appeared: R-A promoted farther
  destinations whose reference reward cleared $400. The worker's mechanism claim is
  CONFIRMED at the line.

## 2. R-A — REJECTED AS SCOPED, and the process is ratified

The pre-registered rule ("if another day moves, R-A is wrong as scoped") was written
precisely so this decision would not be a judgment call. 27 target moves across 9 sessions
and 18 entry admissions: **rejected as scoped.** The PREDICATE remains sound (red-proof went
RED on the planted bar-start defect; module restored byte-exact) and survives into §4.

**Worker conduct ratified in full:** reverting instead of landing, holding the patch + 10
guards instead of discarding, and — the important one — noticing that the R1/R1b grant
capture would have passed VACUOUSLY because it records `SURVIVED_TO_RANKING`, upstream of
`build_and_classify`. **LAW MINTED: a repair's guard must measure the layer the repair acts
on — a guard at the wrong layer is not weak evidence, it is a green light wired to nothing.**
The approved-entry capture (with the chosen target beside each approval) is the canonical
guard for every target-layer and entry-layer repair from here on.

## 3. R-B — HELD as standalone. Same mechanism, same single-shot gate.

## 4. The floor coupling — SETTLED NOW, by design, not discovered repair-by-repair

The worker's ordering question is answered: **yes, it is settled before any universe repair
lands — and the settlement is DEMOTION INSIDE THE BATCH, never a standalone floor change**
(a standalone change is itself an entry-admission change with no citation in either
direction).

**T1 — the unified target-layer design** (subsumes R-A + R-B + R-D):
1. The destination universe = **FRESH KEY LEVEL ZONE bands**: kind-restricted to key zones
   (R-D, cited "targeted the next key zone" ×3), spent-filtered (R-A predicate, completed
   bars), plus 30m HTF rejection bands (R-B, cited; 60m stays PROVISIONAL-UNCITED).
2. The **$400 floor is DEMOTED to record-only**: it is UNCITED (ALGO-076), non-binding at
   his own entries (ALGO-077: 81/81 · 10/10 · 122/122 · 3/3), and its one useful act —
   refusing micro-targets — is superseded by the CITED kind restriction that removes micro
   clusters from the universe. The telemetry line stays for audit; the refusal goes.
   Recorded in `UNFROZEN_CHOICES` as DEMOTED-UNCITED.
3. Entry admission's target requirement becomes **existence of a lawful target**
   (`NO_DESTINATION` / `NO_MEANINGFUL_DESTINATION` still refuse — no next key zone, no
   trade; taught-adjacent and unchanged).

**T1 MAY NOT LAND ALONE.** Demoting the floor releases the entries it was accidentally
refusing — R-A alone showed 18 — and most of those are exactly the early stale-zone trades
the census convicted. The CITED repair for those is **R-C (freshness: a bullet only at a
zone no completed bar has tested since its birth)**. So T1 and R-C are ONE BATCH: designed
together, reported together, landed together or not at all.

## 5. ORDERED — the batch report (hypothetical, nothing lands), then ALGO-086

Using the approved-entry capture at both pins, over all 14 sessions, publish per-repair AND
combined deltas — every entry added/removed by key, every target change by key:
- **Pre-registered expectations:** (a) 04-14 control's approved entry SURVIVES with a valid
  key-zone target — else the batch fails its control; (b) the five convicted early trades
  (03-23 08:14 S · 03-24 08:17 S · 03-31 09:03 L · 04-06 09:07 S · 04-09 09:37 L) are
  REFUSED by R-C, each with its freshness evidence printed; (c) 03-30's selected target
  contains his TP; (d) the net approved-entry delta is fully enumerated, and every
  ADDITION passes the ALGO-070 clause walk (matching family · taught story · in-window ·
  not Route A on BROKEN · blocked-by-budget-alone accounting).
- Taught exceptions to R-C (e.g., Route D accepted-break retest, which by construction
  revisits a tested level) are enumerated IN the report with their taught story cited —
  not silently exempted.
- **ALGO-086 rules the batch; it lands only whole; re-exam #3 only after.** No partial
  landing, no floor change outside the batch, R2 stays in the worktree, stops unchanged.

LESSON: the uncited number was never load-bearing at the teacher's entries and always
load-bearing at the machine's — which is exactly what an unowned parameter does: it governs
the cases nobody designed. It leaves inside a batch whose every element carries a citation,
or it does not leave at all.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any
decision in this ruling.
