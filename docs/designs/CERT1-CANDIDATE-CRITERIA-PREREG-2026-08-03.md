# CERTIFICATE-1 CANDIDATE CRITERIA — PRE-REGISTRATION

**Author:** advisor desk, seat `claude.exe 13916` (ninth `/clear`), 2026-08-03.
**Status at write time:** ledger `R-676`. **`AR-737` HAS LANDED ON DISK AND I HAVE
NOT READ IT.** Its header line (seen via a monitor event, not the file) says it
*refutes R-676's central estimate in the direction that costs more.*

## WHY THIS FILE EXISTS, AND WHY IT IS COMMITTED BEFORE THE READ

`R-676 §3.4` reserved the re-selection criteria to this seat and bound them to
`R-665 §2.4` / `R-667 §4`: **criteria are fixed BEFORE candidates are named.**

`R-676 §6` sent the worker to size the moving-average door. That report is now on
disk. If I read it first and write criteria second, every criterion I write is
open to the charge that it was shaped by what turned out to be cheap — and this
campaign has been convicted on exactly that shape (`A CRITERION RE-READ AFTER IT
RETURNS AN UNWANTED ANSWER IS NOT AN INTERPRETATION — IT IS A GOALPOST WITH A
CITATION`, `R-668 §2`).

`R-676 §3.1` made it mandatory that the expected trace be hand-written and
committed BEFORE either path runs. **This file applies that same law to the desk
itself.** The git timestamp is the point; the prose is secondary.

**HONEST DISCLOSURE OF THE ORDERING:** I did not write this during the window I
had while the worker was still running — I spent that window on `advisor-ruling
§1` verification (below). The window closed on its own. This is therefore the
strongest pre-registration still available, **not** the strongest that existed.

## WHAT I MEASURED MYSELF BEFORE WRITING THESE

Campaign tree `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`, HEAD `e93ce5a5`.

- `[MEASURED HERE]` The binder's complete primitive vocabulary is **exactly `12`**
  values (`spec_family_bindings.py:608–750`, `primitive=` ∪ `enforced_primitive=`,
  deduped). **Reproduces `R-676 §2` item-for-item** — two independent runs, one
  result.
- `[MEASURED HERE]` **No moving-average primitive exists**, under a LIVE control:
  the same matcher returns `0` for `sma|ema|moving|average|ma_` and **`4`** for
  `session|structure`. Per `R-675 §1`, the control's value is stated beside the
  zero, so the zero is admissible.
- `[MEASURED HERE]` `compute_sma` (`indicators/core.py:22`) =
  `series.rolling_mean(window_size=period)`; `compute_ema` (`:27`) =
  `series.ewm_mean(span=period)`. **Read at the executable line. Both are exact —
  no proxy, no approximation branch.** Non-test call sites, def/import lines
  excluded: `6` and `15`.
- ⚠️ `[JOIN-KEY DISCREPANCY — UNRESOLVED, DO NOT QUOTE EITHER FIGURE AS SETTLED]`
  `R-676 §2` states `5` and `14` non-test call sites; I measure `6` and `15` after
  excluding `def`/`import` lines, and `8`/`20` without excluding them. **Neither
  matches. The population rule differs and I have not reconciled it.** It is not
  load-bearing for any criterion below — what matters is only that both functions
  are exact and are called by non-test code, which is measured.
- ⚠️ `[JOIN-KEY DISCREPANCY — UNRESOLVED]` `R-668` and the campaign skill both
  state tier-A is an **`11`**-spec population. `[MEASURED HERE]`
  `tier-a-extraction-provenance/` holds **`13`** spec JSONs + `_MANIFEST.json`
  (two videos contribute `__s0` and `__s1` variants). **`11` vs `13` is a
  population question I have not resolved. I do not quote `11` as measured.**

## THE CRITERIA — a Certificate-1 candidate must satisfy ALL SIX

**Certificate 1 = COMPILER CONFORMANCE ONLY. It says nothing about money.**
Certificate 2 (market qualification) is a separate gate and `R-667 §4.1` —
the instrument must be one this repo has data for — **still binds it in full.**

- **C1 · ONE UNAMBIGUOUS READING.** Every load-bearing condition admits exactly
  one reading at the decision level. *Disqualifier witnessed:* the retired
  opening-range slice carried `6` clock tokens against `4` anchors (`R-660`).
- **C2 · EXACT PRIMITIVE, NO PROXY.** Every load-bearing condition binds to a
  primitive the engine computes **exactly** — no `approximation=True`, no
  bypassed branch, no proxy standing in for a taught concept. *(Legitimised by
  `R-676 §4`: this selects for VALIDITY OF THE TEST, not for passability. It
  would still be correct if every family passed.)*
- **C3 · HAND-WRITABLE EXPECTED TRACE.** A human must be able to write the
  complete expected decision trace for each synthetic fixture **before** either
  path runs, and commit it (`R-676 §3.1`). **If the taught logic cannot be
  hand-traced, it is not a Certificate-1 candidate — however meritorious.**
- **C4 · INDEPENDENTLY INTERPRETABLE.** The reference interpreter (Path A) must
  be writable from the taught text **alone**, without consulting the production
  binder. *If writing Path A requires reading Path B, there is no second path —
  only a mirror.*
- **C5 · NO EDUCATOR-ABSENT DERIVATION.** Units, thresholds and anchors compile
  as taught. *Disqualifier witnessed:* converting `ExB66jcyKxg__s0`'s taught
  absolute NIFTY points into a `3:1` ratio is a derivation the educator never
  made (`R-669 §3`, `PRESERVE MEANING`).
- **C6 · DECISION-BEARING AND DEFECT-SENSITIVE.** The spec emits at least one
  entry decision and one exit decision that a trace can compare, **and every
  planted defect in the battery** (`>`→`<`, period, session shift, direction
  reversal, removed exit, changed stop) **must be capable of moving the trace.**
  A mutation that cannot move the trace proves nothing about the comparator.

## BANS THAT STAND UNCHANGED

- `R-665 §2.4` — **no candidate may be preferred because it passes.** C2 is not a
  loophole in this: it selects on *exactness of the taught concept's
  implementation*, never on *predicted verdict*.
- `R-670 §2` — Lane A may not land until conjunct `(3)` is positional.
- `FAMILY_META` edits remain forbidden on `R-667`'s evidence (both terms measured
  HONEST).

## PRE-COMMITMENT TO `NONE` — binding on me

**If no spec in the named population satisfies C1–C6, that is a COMPLETE AND
CORRECT ANSWER**, and the next question is the **ENGINE layer** — not a re-read
of C1–C6, not a widened population chosen after the fact.
`A SEARCH THAT MAY ONLY SUCCEED IS NOT A SEARCH` (`R-667 §4.5`).

**I also pre-commit the inverse:** if the population that qualifies is reachable
only by *adding* a primitive to the binder, then the honest report is
*"Certificate 1 is not demonstrable on the existing vocabulary"* — and the cost
of adding one is an ENGINEERING decision made in the open, **never** a criterion
quietly written to make it unnecessary.

## ORTHOGONALITY TEST, SELF-APPLIED (`R-667 §4`)

*Would each criterion still be correct if I already knew which spec it selected?*
**C1–C6: YES.** Each is a property of what a fidelity proof structurally
requires, and each would disqualify a candidate that was otherwise certain to
pass. **None is a passability proxy in disguise.**

## WHAT THIS FILE DOES NOT DO

It does **not** name a candidate. It does **not** name a population. It does
**not** authorize a build. Those are `R-677`'s, written after `AR-737` is read.

---

# CORRECTION — appended after reading `AR-737` (same day, `R-677`)

**The criteria C1–C6 above are UNCHANGED. Two of my measurements are not.**
Both of my "discrepancy" notes were **my instrument, not the ruling's error.**

### 1. The call-site counts — `R-676` was right, I measured the neighbouring object
`AR-737 §1` reproduces `5` and `14` **exactly**, under the rule **call syntax,
non-test, non-`def`**: `grep -rn "compute_sma(" …`. **I grepped `compute_sma`
without the parenthesis**, so I counted mentions — imports and references — not
calls. `R-676 §2`'s figures stand; my `6`/`15` and `8`/`20` were never measuring
call sites at all. *(`feedback_i_measured_the_neighbouring_object` — the JOIN KEY
is the claim.)*

### 2. The `12`-value vocabulary — my "independent reproduction" was not independent
I wrote that my `12` *"reproduces `R-676 §2` item-for-item — two independent runs,
one result."* **That claim is withdrawn.** `[MEASURED, `AR-737 §1`, AST]` the
resolvable-primitive universe is **`18`**, not `12`: `FAMILY_META` `11` distinct ·
`PRIMITIVE_RESOLVERS` `13` · `EXPERIMENT_PRIMITIVES` `7` · `MECHANISMS` `3`. The
`12` is `FAMILY_META` **plus `fvg_native` only** — a PARTIAL denominator.

★★★★★ **I reproduced `R-676`'s POPULATION CHOICE, not its result.** I read the
same block (`spec_family_bindings.py:608–750`) the ruling read, got the same
number, and called it corroboration. **`A GRADE REPRODUCING ITS INSTRUMENT IS NOT
A SECOND PATH` (`audit-population`) — and I quoted that very law two sections
above while breaking it.** One path run twice is not two paths.

✅ **THE CONCLUSION SURVIVES, and the worker checked rather than assumed:** over
the full `18`, moving-average matches `= 0`, under a positive control of `2`
(two planted names). **`NOT ONE IS A MOVING AVERAGE` stands on the correct
denominator.**

### 3. Tier-A `11` vs `13` — still unresolved, still not to be quoted
`AR-737` did not touch it. Its own sweep population is **`18` spec files /
`183` conditions**, a different set again. **Three populations are now in play
(`11`, `13`, `18`) and none has been reconciled to another.** Unchanged status:
`[UNENUMERATED]`.

### 4. What this does to C1–C6 — nothing, and one criterion earned its place
**No criterion is amended.** `AR-737` and the operator's direction both land on a
false-success hazard (an engine hardcoded at `EMA(20)/EMA(50)` matching a spec
that teaches `20/50` **for the wrong reason**). **`C6` disqualifies it** — it
requires *every* planted defect, including the period mutation, to be **capable
of moving the trace**, and a period that never travels cannot move anything.
★★★ **C6 was written before either input arrived. It is the criterion that
catches the trap, and that is the argument for pre-registration, not for me.**
