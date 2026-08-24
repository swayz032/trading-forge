# ALGO-084 — R-A **NOT LANDED**: it fails its own pre-registered test and loosens the entry gate

**Strategy head:** `2a84102a3f1a9e55067f0670b3d2bb5e975b0008` (pushed, `ls-remote` verified)
**Chain:** `a19a1c49` → `2a84102a`
**PR #38:** DRAFT / DO NOT MERGE
**Production files modified:** **NONE.** `target_policy.py` is reverted to HEAD; R-A exists only
as a held patch.
**Suite:** enumerated → **1645 passed, 7 failed.** Membership vs baseline: **zero added, zero
removed.**
**Numbering:** ALGO-083 was consumed by the operator directive, and you assigned ALGO-084 to the
R-D/R-C ruling; this report took the next free slot, so that ruling is **ALGO-085**.

---

## 1. The verdict your own pre-registration produced

> *"03-24's target moves; **NO other day changes**. If another day moves, R-A is wrong as
> scoped."* — ALGO-082

Measured across all 14 sessions, committed pin vs working tree:

| | count |
|---|---|
| approvals **removed** | **0** ✔ |
| approvals **ADDED** | **18** ✘ (must have been 0) |
| targets **changed** on surviving approvals | **27**, across **9 sessions** ✘ |

Sessions whose targets moved: 03-23, 03-25, 03-26, 03-31, 04-01, 04-07, 04-08, 04-09, 04-13.

**R-A fails its own rule. It is not landed.**

## 2. The mechanism — worse than "too broad"

Dropping a near **spent** destination promotes a **farther** one. The farther target has a larger
distance, therefore a larger reference reward, which can **clear the $400 TP floor that had been
refusing the entry outright**.

Measured, 2026-04-07 08:28 L:
- **BEFORE:** `TP1_REFERENCE_REWARD_UNDER_400:90.00` → **refused**
- **AFTER:** **approved** at 24253.75

> **A target-universe repair silently loosens the ENTRY gate through an UNCITED reward floor.**
> That is an entry-admission change nobody authorised, and it is invisible unless the guard
> measures approvals.

## 3. The guard I almost used would have passed vacuously

The X-ray in-window grant capture that guarded R1/R1b records `SURVIVED_TO_RANKING` — **upstream
of `build_and_classify`**. R-A cannot move it *by construction*, so that guard would have
reported a clean pass while 18 approvals appeared underneath it.

The capture landed here (`run_approved_entry_membership_capture.py`) keys on **fully-approved
entries** and carries each chosen target beside it, so an approval that survives with a
**different target** shows up as a change rather than as identity.

## 4. What survives, and what I did not do

Held, not discarded — `research/_held_patches/`:
- `RA_spent_zone_filter_NOT_LANDED_2026_08_24.patch`
- `test_RA_spent_zone_filter_NOT_LANDED.py.txt` (10 guards)

**Your required red-proof PASSED in isolation:** planting the bar-start defect turned
`test_a_bar_STILL_FORMING_at_the_clock_is_NOT_evidence` RED, and the module restored byte-exact
(`27d1b91f8fbb1ca7`). **The predicate is sound; its blast radius is what fails.**

**R-B is NOT started.** R-B admits *new* destinations, changing which is nearest, changing the
reward, able to flip the same $400 gate — the same class of unintended entry admission. Landing
R-B on the old grant-based guard would repeat this failure invisibly. Its guard must measure
approvals.

## 5. What I think this is telling us

The $400 floor is **uncited** (ALGO-076) and **not binding at his own entry** (ALGO-077, 81/81 ·
10/10 · 122/122 · 3/3). It nevertheless sits between the target layer and the entry decision, so
**any** target-universe change becomes an entry-gate change. R-A, R-B and R-D all move that
universe.

That suggests the ordering question is yours to rule: whether the floor's coupling to entry
admission should be settled *before* any universe repair lands, rather than each repair
discovering it separately.

## 6. Asks for ALGO-085

1. **R-A**: reject as scoped, or re-scope (e.g. apply only where it cannot flip the reward gate),
   or land with the entry-admission delta explicitly accepted and enumerated?
2. **R-B**: hold until (1) resolves, given the shared mechanism?
3. **R-D/R-C reports**: proceed now, or after the floor-coupling question?

Artifacts at `2a84102a`: `..._ra_membership_guard_2026_08_24.json` (all 18 additions and 27
target moves by key), `run_approved_entry_membership_capture.py`, and the two held-patch files.

---

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
