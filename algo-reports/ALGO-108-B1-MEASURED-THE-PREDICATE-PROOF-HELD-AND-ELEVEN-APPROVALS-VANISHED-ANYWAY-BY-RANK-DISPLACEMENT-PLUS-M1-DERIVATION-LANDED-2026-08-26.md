# ALGO-108 — B1 measured at both pins: **the direction proof held exactly — zero break-family approvals removed — and ELEVEN approvals vanished anyway**, 11 of 11 same-bucket rank displacements of Route A. A proof about a predicate does not transfer to the pipeline that contains it. **M1's derivation document is landed.** Plus a failing test that was sitting on the head.

**Strategy head:** `6fcb2536` (pushed, `ls-remote` verified, local == remote, negative control clean).
**PR #38:** DRAFT / DO NOT MERGE. **Suite:** 896 passed, 0 failed.
**NOTHING FROM B1 IS LANDED** — ALGO-107 closed it as a repair and I did not reopen it. The B1
build exists only in the throwaway worktree `wt-algo-b1` and is never pushed.
**Re-exam #4 was NOT run** (ALGO-107 §4). No exam verdict appears anywhere below.

**HORIZONS:** every membership number is `as_of=replay_end`
(`run_approved_entry_membership_capture.py:72`). Nothing here is a survives-to-ranking number.

---

## 0. THE RESULT

ALGO-107 asked for the measured refutation beside the algebraic one, to quantify **how much
break-family selectivity comes from untaught numbers rather than from the teaching.**

**The algebraic proof was exactly right, and exactly incomplete.**

| | 08:00 | 09:30 |
|---|---|---|
| approvals, landed → B1 | **91 → 107** | **47 → 53** |
| added | **+23**, all `BRK5` | **+10**, all `BRK5` |
| **break-family approvals REMOVED** | **0** | **0** |
| removed | **7**, all Route A `REV` | **4**, all Route A `REV` |
| **removals that are same-bucket displacements** | **7 of 7** | **4 of 4** |
| `BRK5` / `REV` | 39→62 / 52→45 | 22→32 / 25→21 |
| sessions silenced | **0** | **0** |
| 04-14 control, **by key AND target** | identical (`09:38 L BRK5` → `25869.0`) | identical |
| shared approvals whose target moved | **0** | **0** |

**The loosening is large: +25% of approvals at 08:00, +21% at 09:30, entirely in the break
family.** That is the number ALGO-107 asked for — roughly a fifth to a quarter of break-family
selectivity was coming from `body_frac 0.62` and `close_loc 0.78`, not from the taught sentence.

## 1. THE FINDING THAT MATTERS MORE THAN THE SIZE

**Eleven approvals disappeared under a change proven incapable of refusing anything.**

The proof said: `body_frac >= 0.62 ∧ close_loc >= 0.78 ∧ bullish` ⟹ the taught clause. 400k random
bars, zero counterexamples. The measurement confirms it at the layer it describes — **not one
break-family approval was removed at either pin.**

All eleven removals are Route A `REV`, a route `_momentum` never evaluates. And **11 of 11** are
explained by one mechanism, with no residual:

> A newly-admitted `BRK5` landed in the **same `(session, bucket)`** as an existing `REV`, and
> `kernel.py:205` ranks `{"BRK5": 3, "BRK15": 2, "REV": 1}`. The break candidate won the bucket;
> the rejection candidate stopped being an approval.

**A PROOF ABOUT A PREDICATE DOES NOT TRANSFER TO THE PIPELINE THAT CONTAINS IT.** "This clause
can only admit more" is fully compatible with "the system approves fewer of some kind." I stated
in ALGO-106 that B1 "can only ADD"; scoped to break-family approvals that is measured true, and
**as a system claim it is false.** Recording it that way rather than leaning on the scoping.

**This is the sharper sibling of ALGO-107's law.** That one said: prove the DIRECTION before
predicting what a retirement does. This one says: **having proved the direction of the predicate,
you still do not know the direction of the system.** Both were needed to get B1 right and I had
only the first.

## 2. B1 MOVES 03-24 THE WRONG WAY — and re-opens the exact clock T3′′ refused

At the **08:00** pin the day's first approval moves **`08:17` → `08:12 S BRK5`.** B1 puts the
bullet *further* from his `09:32`, not closer. ALGO-105's prediction was not merely unreachable
(ALGO-107); the mechanism actively works against it.

**And `08:12` is not a new clock. It is the one T3′′ refused.** ALGO-103 §3 recorded
`08:12 S REV / prior_momentum_after_rejection` as **REFUSED** by T3′′, and it is absent from the
landed head. B1 admits **the same clock, same direction**, as `BRK5` via
`PREBREAK_REPEAT_TEST_INTRA5_FORCE`, on zone `S:2026-03-23T14:00…97276`, `ZoneState.TESTED`.

> **A bucket has one door per route.** The story layer refusing a clock does not close it; the
> break family is a separate entrance to the same bucket, and it outranks the door that refused.

At the **09:30** pin, 03-24 is untouched — his `09:32 L REV` is the only approval before and
after. **The harm is confined to the 08:00 arm**, which is the arm that reaches back to `08:12`.

## 3. THE BRK15 INVERSION — the honest answer is "no population", not "no effect"

ALGO-106 §1 flagged that `_momentum` is used **inverted** at `weak_break_continuation`
(`breakout_derivation.py:330`), where momentum being TRUE *refuses* the route, so a looser
predicate should refuse MORE BRK15.

**Measured: `BRK15` approvals = 0 at the landed head and 0 under B1, at BOTH pins.**

**So the inversion effect is UNMEASURABLE here, not absent.** `BRK15` contributes no approvals at
all in this 14-session window, so there is nothing for the inversion to remove. Reporting this as
"no effect" would be the same error as reporting a dead search as an absence proof. **If BRK15
ever approves anything, the inversion becomes live and untested.**

## 4. THE FAILING TEST THAT WAS SITTING ON THE HEAD — found by accident, landed at `853e15b0`

Running the suite in the B1 worktree surfaced **a test failing on the landed strategy head**:
`test_the_wired_arms_lose_the_same_four_against_the_anchor`. It fails at the head too, so it was
not B1's.

**Cause:** it pinned ONE shared list of four lost sessions for BOTH exam arms. True until T3′′
landed (`da7f9d3d`); re-exam #3 (`99901945`) regenerated the arm artifacts against the landed head,
**the 09:30 arm came back to `03-24` and `03-30`**, and the shared pin was then wrong for that arm.

**The anchor did not move.** The frozen 5/8 and its `sha256` are pinned by their own tests and are
untouched. What moved is one ARM, in the direction F2 measures — already published as re-exam #3.

**Repair:** each arm pinned separately and exactly, so a swap (the two arms trading which sessions
they lose — same count, different membership) goes red. Battery: drop a held session **RED**,
restore a lost one **RED**, drop the control **RED**; artifact restored byte-exact, `sha256`
verified, clean run green.

**And I deleted a decorative assert I had just written.** I added `04-14 not in lost`, measured it
RED, then found the **exact-equality** assert above it always fires first — it could never be the
failing line. A guard that cannot fire alone is decoration, not a guard.

## 5. M1'S DERIVATION DOCUMENT IS LANDED (ALGO-107 §5)

`research/current_mnq_strategy_v2_4_m1_admission_derivation_2026_08_26.md`, with its instrument
and measured output, at `6fcb2536`. Written for GPT to execute. Headlines:

- **TEN magnitudes reach location admission**, DERIVED from the declaring surface, never listed.
  **FIVE are carried inside expression strings** (`min_wick` ×2, `key_level_pad_atr`, `4_ticks`,
  `min_room_r`) and are **invisible to any audit that reads only the JSON's numeric leaves.** The
  admission surface's magnitude count has been under-stated by half in every prior discussion.
- **PROVENANCE: zero of ten has a teaching citation.** Every CONCEPT is taught
  (*"repeated independent rejection"*, *"strong displacement"*, *"key levels are zones"*) and **no
  MAGNITUDE is.** The ALGO-071 §3 situation, reproduced ten times over.
- **My first scan reported "4 of 10 uncited" and every hit was noise** — `2` and `4` from the
  string `MNQ v2.4`, `40` from **inside a sha256**, `1.0` from *"1 per session"*, `1.5` from **an
  audio chime's `duration_seconds`.** A boundary filter kills the sha/version class but **not the
  chime**, so the instrument now returns every hit **with its context** and there is **no
  `cited: true` column** — that column is not derivable by search. The absence claim is proved
  live by a positive control (the taught `$400` floor) facing **the same filter**.
- **The sharpest gap is not a threshold.** The code builds a **symmetric** band,
  `max(4 ticks, 0.06 × ATR)` (`levels.py:149`). He described an **asymmetric** one — *"i take a
  key zone with a wick and i draw the zone from the top of the wick"* — both edges read off the
  rejecting candle, so the band sizes itself with **no parameter**. `TICK = 0.25`, so the coded
  floor is **1.0 pt half-width / 2.0 pts full**, against pinned teaching bands of **~4 to ~32 pts
  (ALGO-071)** — **narrower than the narrowest band anyone measured.** Two magnitudes retire at
  once if the construction is replaced. Flagged, not resolved: his quote describes a **single
  rejection candle** and ALGO-071's screenshots describe a **rejection cluster**; scope is
  **5m/15m only**; and no width may be chosen to make a day overlap.
- **Sensitivity ranges are DERIVED where the codebase declares them** —
  `PARAMETER_REGISTRY` (`engine.py:89`) declares one for **exactly 3 of the 10**, all `Params`.
  **The seven JSON-spec magnitudes have no declared tolerance anywhere**, which is itself evidence
  about how they were chosen. The six ranges I supplied are labelled **MINE**.
- **§0 of that document carries this packet's displacement finding**, because it changes the
  method: every M1 measurement is specified as a membership diff **with a per-route breakdown and
  an explicit displacement audit**, never as an admission count. An M1 change that cut the flood
  by displacing his own Route A entries would be a failure a count would report as a success.
- **The fork is pre-registered before any sensitivity result exists**, and **FORK C**
  (load-bearing, concept not taught) **closes with NO change and NO question to the operator.**

## 6. ASKS FOR ALGO-109

1. **Does the displacement finding change the campaign's model of the flood?** Route A repairs
   have been measured against Route A. §1 shows the break family can delete Route A approvals
   without any Route A code changing. **The `REV` population is not independent of break-family
   admission**, and every earlier before/after on Route A carries that coupling silently.
2. **`08:12` (§2) generalises the ALGO-103 finding.** ALGO-104 asked whether `08:17 S BRK5` hands
   the distance to the map lane. §2 is stronger: **a clock the story layer explicitly refused
   returned through the break family at a higher rank.** If that is a real class, story-layer
   repairs cannot lower the bullet on their own **by construction**, and M1 is the only lane left.
3. **BRK15 (§3) has zero population in this window.** Is the inverted `_momentum` site worth
   testing at all, or is `BRK15` effectively dead code in the 2026 replay set?
4. **Known defect, still carried and unfixed:** `V24_TARGET_DISTANCE_LT_REACTION_CONTACT`
   (`target_policy.py:157-161`) **raises instead of declining.** It matters to M1's sweep: **a
   crashed session is not a no-trade decision** and must never be scored as a silence.

---

**Enumerated.** Captures: 2 code arms × 2 pins × 14 sessions, all `as_of=replay_end`. Diffs by
`key` tuple `(session, bucket, direction, setup)`; **membership, never counts**; control checked
by key **and target**; every removal audited for same-bucket displacement. Provenance: 10 derived
magnitudes × 6 corpus files, filtered scan with a positive control. Anchor battery: 3 defects,
all RED, `sha256`-verified byte-exact restore. Suite 896 passed / 0 failed at `6fcb2536`.
Commits this packet: `853e15b0` (anchor repair), `6fcb2536` (M1). R2c stays unmerged at
`7d42d121`. **Nothing from B1 is on any pushed branch.**

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
