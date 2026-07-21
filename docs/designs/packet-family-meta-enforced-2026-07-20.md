# RATIFY PACKET — `FAMILY_META` ENFORCED (the pointer lie, structurally closed)

**STATUS: STAGED — HELD FOR RATIFY, BUILD SEQUENCED AFTER THE IN-FLIGHT GRADES.**
Authorization: **R-153 §3** (ENFORCED ruled; demote-to-documentation REJECTED). Engine-instrument
class. Pre-live; the sealed 77 untouched. Independent grade is the gate.

**★ THIS IS THE LARGEST INSTRUMENT CHANGE SINCE THE COURTROOM WAS COMMISSIONED** (R-153 §3(d)).
It does not add a feature. **It removes the engine's ability to lie about what it runs.**

---

## 1. What & why now — measured, not asserted

The class sweep (AR-144) measured every `FAMILY_META` entry on **2000 real ES 5min bars**, corroborated
across **all 120 corpus specs × 600 bars**, with **all 7 positive controls fired before any zero was
trusted.** **14 families; 9 declare a real primitive; only 3 execute it cleanly.**

| Verdict | n | Families |
|---|---|---|
| REACHABLE | 3 | `WAIT_SESSION`, `WAIT_RETEST`, `WAIT_CONFIRMATION` |
| PARTIAL (branch-conditional) | 2 | `WAIT_STRUCTURE`, `VERIFY_STRUCTURE` |
| **NOT-REACHABLE** | **4** | `WAIT_BIAS`, `CONFIRM_DIRECTION`, **`FILTER`**, **`INVALIDATE`** |
| COULD-NOT-VERIFY | 2 | `ENABLE_ENTRY`, `ENTER` |

**The two that force this packet:**
- **`FILTER` (`:518`) declares `entry_quality.confluence_factor_presence` — THE MODULE DOES NOT EXIST.**
  `compute()` silently substitutes `np.ones(n, dtype=bool)`: **constant True, 2000/2000, n=2000**, for
  **390 corpus conditions carrying `role=spine`.** **A condition that cannot be false cannot gate.**
  The probe-that-cannot-fail shape, live in the execution graph. Mirrored at
  `src/server/lib/spec-family-bindings.ts:99`.
- **`INVALIDATE` (`:526`) is the SOLE `approximation=False` among executed families** and its primitive
  is **never called in production** (0 calls / 495 firing bars). Under `trace=True` it fires 492 times
  and **all four signal columns are byte-identical** — it could not change an output if it did run.

## 2. Blast radius — ★ THE LARGEST IN THE CAMPAIGN, DECLARED HERE NOT DISCOVERED DOWNSTREAM

- **★ EVERY BACKTEST NUMBER THIS ENGINE HAS EVER PRODUCED IS AFFECTED.** 390 spine conditions are
  currently constant-True. Under enforcement they either **fail loud at load** or **begin to gate**.
  **Historical output WILL change, and it may change a lot.** That is the point — they were never
  gating — but **no certified number may be silently re-baselined.** Every artifact whose number moves
  is **annotated, never overwritten** (append-only law).
- **★ THE FIDELITY NUMBER MOVES DOWN, AND SHOULD.** `INVALIDATE`'s `approximation=False` becomes
  `True` (pin (c), honest entry). **The campaign's approximation rate gets WORSE and more true.**
  It must be re-derived, never patched.
- **★ THE §6a COVERAGE DENOMINATOR GROWS** (R-153 §4): trigger-role conditions were never evaluated
  at all — **987** taught conditions the engine never tests — **the loop selects `role=="spine"` ONLY, so EVERY trigger role
  is skipped.** ★ **CORRECTED from 921 (AR-173, my error).** The old figure enumerated only 5
  families: WAIT_BIAS 42 + FILTER 39 + INVALIDATE 105 + ENABLE_ENTRY 480 + ENTER 255 = **921**. The
  missing 6: WAIT_SESSION 18 + WAIT_CONFIRMATION 21 + WAIT_RETEST 15 + WAIT_STRUCTURE 6 +
  VERIFY_STRUCTURE 3 + EXIT_HINT 3 = **66**. **921 + 66 = 987.** I summed the parts I was handed
  without asking whether they were ALL the parts.
  **The unbound count grows; the honest number gets honester.**
- **The TypeScript mirror carries the same declarations** and drifts the moment Python is enforced.

**NOT touched:** the sealed 77 · promotion gates · fill/P&L/sizing · tier-a · detectors · the
level/zone resolver · the session resolver · any `approximation=False` beyond the `INVALIDATE`
correction named above.

## 3. The exact change, scope-locked — R-153's four pins, verbatim

**IN:**
- **(a) SINGLE SOURCE.** Dispatch **DERIVES** from `FAMILY_META`. **A pointer that cannot lie because
  nothing else routes.** No parallel `if/elif` ladder may survive alongside it — a second router is a
  second truth.
- **(b) FAIL-LOUD AT LOAD.** A declared primitive that does not resolve is a **STARTUP ERROR**, never
  a silent `np.ones`. **The FILTER case becomes structurally unshippable.**
- **★ (b2) ZONE-COVERAGE — POINTER-TRUTH ONE LEVEL DOWN (R-156 §1).** **EMITTED VALUES ⊆ COVERED
  VALUES, enforced FAIL-LOUD AT LOAD.** **A resolver may not emit a value its consumer cannot
  check.** Convicting instance: `resolve_session_keyword` emits **7** zones while
  `session_windows.py`'s `_ZONE_CHECKS` covers **5**, so `lunch_blackout`/`overnight` are
  **always-False gates wearing `bindable=True, approximation=False, executed=True`** — with a
  **green test blessing one** (`test_spec_family_bindings.py:334`, a fabricated safety-claim in a
  fence). **This is the same lie as (b), one level down: (b) catches a pointer to nothing; (b2)
  catches a VALUE nothing can evaluate.** The check is mechanical — enumerate each resolver's
  emittable set, enumerate its consumer's covered set, **fail at load on any difference.**
- **(c) HONEST ENTRIES** for primitive-less families (`ENABLE_ENTRY`, `ENTER`, and any other): their
  **actual mechanism** declared, **`approximation=True`**, **no aspirational pointers ever again.**
- **(d) The trigger-role dispatch gap enters the design** (R-153 §4) — and its 987 conditions enter
  the §6a accounting **immediately**, ahead of this build.

**PROHIBITED, by name:**
- **★ Making a failing pointer PASS by pointing it at something plausible.** If `FILTER` has no real
  primitive, its honest entry says so — **inventing a `confluence_factor_presence` to satisfy the
  loader converts a pointer lie into a fabricated implementation, which is strictly worse because it
  would PROBE CLEAN.** This is the fabricated-fallback ban (R-137) in its newest costume.
- **Silencing the loud failure with a try/except or a default.** The whole change is the noise.
- **Re-baselining any certified artifact in place.**
- Touching `swing`'s flag · the sealed 77 · promotion gates · tier-a.

## 4. Verification plan — RETURN CHECKLIST (blocking)

Receipt or an explicit *"could not, because…"* per item. **A silent omission halts the lane.**

1. **★ FAIL-LOUD IS RED-PROVEN:** point a family at a **deliberately non-existent** primitive and show
   **load FAILS with a nameable error.** Then restore. **A guard that cannot fire is the exact defect
   this packet exists to delete** — it may not be introduced by the fix for it.
2. **★ THE SWEEP IS RE-RUN AS THE ACCEPTANCE TEST, and its verdicts must MOVE:** the 4 NOT-REACHABLE
   either become REACHABLE or become **honest entries** — **none may remain a live lie.** Re-run the
   same call-counter instrument, **positive controls first**, and publish the new table beside the old.
3. **★ NO SECOND ROUTER:** prove by test that removing/renaming a `FAMILY_META` entry **changes
   dispatch**. If dispatch still works with the entry gone, something else is routing and pin (a)
   is unmet.
4. **★ THE 390 ARE ACCOUNTED FOR INDIVIDUALLY** — for `FILTER`'s spine conditions, state what each
   now does (gates / fails load / honestly unbound). **An aggregate count hides which ones changed
   behaviour.**
5. **BACKTEST DELTA MEASURED AND PUBLISHED**, not discovered: run a fixed corpus before and after,
   report **how many strategies' signals moved and by how much**, with n. **A change this size that
   reports no delta has not been wired.**
   **★ SEPARATED PER-TIER (R-154 §2).** Shakedown/tier-b deltas **may never be read as tier-a
   impacts** — the scope-line law travels into the delta report. A pooled delta silently lets a
   large tier-b movement stand in for a tier-a claim (or hide the absence of one). **Each tier
   reports its own n and its own movement, and the report names which tier every figure belongs
   to.**
6. **Both polarities** on every enforced binding: resolves-and-runs, and fails-loud-when-absent.
7. **The TypeScript mirror** is either updated in the same wave or **explicitly declared drifted**
   with an owner — never left silently divergent.
8. **Any rate carries its null and its n.** The new approximation rate ships with **dual denominators**
   and **§6a coverage including the 987 trigger-role conditions.**
9. Existing tests pass. **If a test encoded the constant-True behaviour, name it** rather than
   quietly editing it.

## 5. Rollback

Single-commit revert restores the current (lying) dispatch. **Env-flag gated during build**
(`TF_FAMILY_META_ENFORCED`, default OFF) with **flag-OFF byte-identity PROVEN, not asserted**, so the
change lands dark and flips as one boundary. **Two-commit law:** enforcement lands separately from any
default change. **The bars lift on the GRADE, not the landing.**
