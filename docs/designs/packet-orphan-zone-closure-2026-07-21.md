# RATIFY PACKET — orphan-zone closure (the gap that blocks the engine from loading)

**STATUS: RATIFIED — OPTION A CHOSEN (R-185 §2). SEQUENCED AFTER THE FIX WAVE LANDS** (same file,
one writer, per R-184). Authorization: **R-175 §3 / R-183 §2 / R-185 §2** (ordered as the session lane's scoped follow-up).
Engine-instrument class. Pre-live; the sealed 77 untouched. Independent grade is the gate.

**★ THIS IS THE LAST BLOCKER ON THE ENFORCEMENT FLAG.** With all pins active the engine **correctly
refuses to load**, because pin (b2) — `EMIT ⊆ COVERED` — fires on this defect. Closing it is what
lets the flag load under **all** pins.

---

## 1. What & why now — measured

`resolve_session_keyword` can emit **7** zone names. `session_windows._ZONE_CHECKS` covers **5**.
The difference is exactly **`lunch_blackout`** and **`overnight`**.

- **Consumer:** `spec_condition_compiler.py:447` calls `is_in_killzone(ts, zone)` → for those two
  zones it returns **False for all 1,440 minutes of the day** — *including 11:30–13:30 ET, the very
  window `lunch_blackout` names.* Positive-controlled: at 12:30 ET `is_in_lunch_blackout()` is
  **True** while `is_in_killzone(ts,"lunch_blackout")` is **False**; `is_in_killzone(ts,"ny_am")` is
  **True** at 09:00 ET, proving the probe is live.
- **The binding plan meanwhile reports `bindable=True, approximation=False, executed=True`.** An
  always-False gate wearing an exactness claim.
- **A passing test blessed it** (`test_spec_family_bindings.py:334`) until it was rewritten as a
  tripwire.

**This is the pointer lie one level down** — not a pointer to nothing, but a **value nothing can
evaluate**.

## 2. Blast radius

- **Closes the last (b2) violation**, so the enforcement flag can load under all pins. **That is the
  point of this packet.**
- **If the fix is COVER (option B below), behaviour CHANGES**: conditions bound to those zones stop
  being permanently-False and **begin to gate**. Historical output for any spec touching them moves.
  **Declared here, not discovered downstream.**
- **The `:334` TRIPWIRE WILL FIRE — by design.** It asserts the gate is False for all 1,440 minutes
  and **self-destructs with a rewrite message when coverage closes.** **Its failure is the packet
  working, not a regression.** Rewrite it; do not delete it.

**NOT touched:** the sealed 77 · promotion gates · fill/P&L/sizing · tier-a · the session role
resolver (closed honest-partial — leave it) · `swing`'s flag · the enforcement build itself.

## 2a. ★ THE CHOICE IS MADE — OPTION A, ON THE DATA (R-185 §2)

**The census answered blocking item 1, and the choice followed the numbers rather than convenience:**
`lunch_blackout` binds **0** conditions; `overnight` binds **1**, and that one is `role=confluence`,
**proven never evaluated on 149,196 real bars.** **Effective demand for BOTH options: ZERO.**

**Four grounds, as ruled:** (i) **effective demand is zero for both** · (ii) **the demand-driven
law** — covering zones no trader in this corpus teaches is **building unrequested behaviour** ·
(iii) **removal is the smaller change on a live file** · (iv) ★ **THE BRIDGE IS NOT BURNED** — the
window checkers still exist, so if a tier-a/c corpus ever teaches lunch-avoidance or overnight logic,
**Option B becomes a small demand-justified packet THEN**, and the census artifact records exactly
what to revisit and why.

**★ WHY OPTION B WAS UNPAYABLE FOR `overnight` — kept on the record so nobody re-opens it casually:**
its keyword list bundles **incompatible clocks** that do not intersect into one interval · **three
conflicting definitions already live in this repo**, with the engine disagreeing with its own only
real corpus teaching by **2h at the open and 2.5h at the close** · and `OVERNIGHT_END_MIN = 1860`
**is not a minute-of-day**, so the standard predicate shape would **silently drop more than half the
intended window while wearing `approximation=False`.**
**Sounds precise, isn't — and it would PROBE CLEAN.**

## 2b. ★ ADDED SCOPE (R-185 §2-3) — both ride this packet

1. **THE `:334` TRIPWIRE RETIRES WITH ITS SUBJECT.** Its premise is *"this phrase binds
   `lunch_blackout`"* — **Option A kills the emission, so the premise dies.** Rewrite it to assert
   the new truth (the phrase no longer binds; nothing emits an uncovered zone). ★ **It retires BY
   DESIGN, not by accident — that is the whole difference between a self-destructing instrument and
   one somebody quietly deleted.**
2. **★ THE `:747` COMMENT IS FACTUALLY WRONG AND CORRECTS HERE.** It reads *"26 of 27 corpus-wide
   WAIT_SESSION conditions never bind."* **The truth is 27 of 27 effectively never bind** — the
   single binder binds an **orphan zone**, so it was never real. **Correct it, and record that this
   STRENGTHENS the role-aware resolver's case: the 8 real bound rows all came from the NEW lane; the
   LEGACY path binds nothing real in this corpus.**

## 3. The exact change, scope-locked — pick ONE, and justify it

**OPTION A — STOP EMITTING.** `resolve_session_keyword` no longer returns `lunch_blackout`/
`overnight`; those phrases resolve to **honestly unbound** with an informative reason.
*Conservative: no behaviour change to any currently-binding condition; the teaching is refused
rather than silently ignored.*

**OPTION B — COVER THEM HONESTLY.** Add both to `_ZONE_CHECKS` with **real, defensible windows**.
*Higher value — the teachings become live — but it CHANGES BEHAVIOUR and needs its window
definitions defended, not assumed.*

**★ THE CHOICE MUST BE ARGUED FROM THE DATA, not from convenience:** how many corpus conditions
actually bind each zone? If the answer is ~0, Option A is honest and cheap. If real teachings depend
on them, Option B earns its blast radius. **State the counts before choosing.**

**PROHIBITED, by name:**
- **★ Inventing a window to satisfy the loader.** `overnight` has **no single agreed clock
  definition** — this is exactly the *"London killzone"* problem the session lane already convicted
  (*"sounds precise, isn't"*). **Picking one silently is fabricated precision, and it PROBES CLEAN.**
  If no defensible window exists, that is an argument **for Option A**, not for a guess.
- Suppressing the `:334` tripwire instead of rewriting it.
- Any `approximation=False` for these zones under either option.
- Touching the enforcement build's pins, the sealed fence, or the session resolver's rule.

## 4. Verification plan — RETURN CHECKLIST (blocking)

1. **★ THE COUNTS FIRST** — how many corpus conditions bind `lunch_blackout` / `overnight` today,
   derived programmatically. **The option choice is justified by these numbers, in writing.**
2. **★ `EMIT ⊆ COVERED` NOW HOLDS, PROVEN BY THE ENFORCEMENT GUARD ITSELF** — with all pins active
   the engine **LOADS**. That is the acceptance test, and it is the guard the build already shipped.
3. **★ RED-PROOF IT:** re-introduce an uncovered emission and show the guard **still refuses to
   load**. **A guard that stops firing because the thing it guards was removed is not a guard.**
4. **The `:334` tripwire is REWRITTEN, not deleted** — and its replacement asserts the new truth
   with the same both-directions discipline (it must fail if the gap reopens).
5. **If Option B: every newly-covered window is DEFENDED with a source or a stated convention**, and
   the **behaviour delta is measured and published** (how many conditions changed from never-True to
   sometimes-True, with n).
6. **If Option A: prove the phrases are refused, not silently dropped** — an informative reason, and
   a test that the refusal is visible.
7. Any rate carries its **null** and its **n**. Flag-OFF byte-identity preserved with a can-fail
   control.
8. Existing tests pass; **name any test that encoded the always-False behaviour** rather than
   quietly editing it.

## 5. Rollback

Single-commit revert. Under Option A no behaviour changes, so revert is inert. Under Option B revert
restores the always-False gates — **so the bars lift on the GRADE, not the landing.**

---

## RIDER — the pin-selector EXPIRY TRIPWIRE (R-175 §2)

The enforcement build's **pin selector is a TRANSITION instrument** and its shape quietly becomes a
default if left alone. **Ordered: a self-destruct test in the `:334` pattern, keyed to THIS lane's
closure — when the orphan gap closes, any remaining reference to the pin selector FAILS CI with a
rewrite message.**

**It ships with this packet**, because this packet is the event it is keyed to. **A transition
instrument that cannot outlive its reason is the only kind worth having.**
