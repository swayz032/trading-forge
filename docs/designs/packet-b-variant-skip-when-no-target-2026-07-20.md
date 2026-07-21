# RATIFY PACKET — B-variant: skip-when-no-target (dual-arm)

**STATUS: STAGED.** Engine-instrument class. Authorization: **operator's "Test BOTH ways"**
(his channel) + **R-139** + **R-138 §3**. Pre-live; the sealed 77 untouched. Independent grade
is the gate.

**★ THIS IS AN ARM, NOT A REPLACEMENT.** Arm A (enter-with-no-take-profit) is the as-built,
operator-accepted behaviour and **stays**. This packet builds **arm B** so the battery decides
on data, under the pre-registered **R-061 overlay-A/B** pattern with **effective-N tuples
distinguishing arms.** **Neither arm is promoted by this packet.**

---

## 1. What & why now

The target-gate fix (`12bb4ac2`, graded Band 7) removed future-dated exit targets. Where the
causal truth is *"no target exists yet"*, both strategies **enter with no take-profit** —
quantified at **`eqhl_raid` 46/597 = 7.7%** and **`ict_swing` 3/56 = 5.4%** of all real entries,
against a pre-fix `both_none=0` (the fake net was near-universal).

**The operator accepted arm A knowingly, with the number in front of him** — and separately
ordered **both arms measured** rather than either assumed. **R-138 §3's reasoning, ratified:**
don't guess between them; the battery decides.

**Arm B:** when no causal target exists, **skip the entry** — conservative, fewer trades,
nothing ever rides without a take-profit.

## 2. Blast radius

**This is an ENTRY-PATH change** — explicitly out of scope for the target-gate packet, and
**in scope here only because the operator's ruling authorizes it.**

- Changes **which trades exist** in arm B, not merely their exits. Trade counts, and every
  metric derived from them, differ between arms **by design** — that is the comparison.
- **Arm A is untouched.** Nothing in this packet may alter as-built behaviour.
- **NOT touched:** `ict_scalp` (probed clean, 0/590 — no target defect to arm) · the level/zone
  resolver · session resolver · detectors · promotion gates · fill/P&L/sizing · tier-a.

## 3. Scope-lock

**IN:** an arm-B variant of `eqhl_raid` and `ict_swing` that **suppresses the entry** when
target selection yields none; arm selection wired so both arms are runnable and
**distinguishable in results.**

**PROHIBITED, carried forward and non-negotiable:**
- **★ THE FABRICATED-FALLBACK BAN SURVIVES INTO BOTH ARMS** (R-137). Arm B skips; it does **not**
  invent a target to enter on. **A substitute target converts a look-ahead defect into a
  fabricated-signal defect — strictly worse, because it PROBES CLEAN.**
- Arm B must not be presented as the default, the fix, or the recommendation. **It is an arm.**
- No `approximation=False`.

## 4. Verification plan — RETURN CHECKLIST (blocking)

1. **★ ARM ISOLATION PROVEN:** arm A's output is **byte-identical** to current `main` behaviour
   when arm A is selected — **proven, not asserted.** An A/B harness that perturbs A cannot
   measure B.
2. **★ EFFECTIVE-N TUPLES distinguish the arms** (R-061) — results carry which arm produced
   them; **an aggregate that pools arms is the failure this pattern exists to prevent.**
3. **The suppressed entries are ENUMERATED**, not just counted — arm B must be able to say
   *which* trades it declined, so the comparison is auditable rather than a delta.
4. **Both polarities:** arm B skips when no causal target exists, **and enters normally when one
   does.** A variant that never enters is not conservative, it is broken.
5. **No-fabrication check** — arm B produces **no target and no entry**, never a substitute.
6. Any rate carries its **null** and its **n**.
7. Existing tests pass; arm-A tests must be **unaffected**.

## 5. Rollback

Arm selection is a flag, **default = arm A** (the operator-accepted behaviour). Single-commit
revert removes arm B entirely. **Neither arm is promoted by landing this** — promotion is the
battery's call on data, separately graded.
