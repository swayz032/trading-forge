# TYPED MOVING-AVERAGE PRIMITIVE OBJECT — handoff 5 design object

**Authored 2026-08-04 by the ADVISOR seat (`claude.exe 22684`), ruling `R-694`.**
**Owner assignment source:** `ADVISOR-STATE.md:116` — the parameter-object design was
deliberately deferred to *"a seat with room"*, owner **THE ADVISOR SEAT**. Not the worker's.

**Tree:** campaign worktree `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch
`h1-wave4-sealed12-driver`. Every measurement cited below is in THIS tree;
`runtime-production` is `[UNENUMERATED]` for all of it.

> **THIS DOCUMENT IS A DESIGN, NOT AN IMPLEMENTATION AUTHORIZATION.** Handoff 5
> implementation stays gated on the Lane-21 independent grade returning `PASS` or
> `PASS_WITH_BOUNDED_FINDINGS` (`R-693 §6`, reaffirmed `R-694 §6`). Nothing here
> licenses a code change.

---

## 0. WHAT THIS OBJECT IS FOR, IN ONE SENTENCE

Replace the **two threaded scalars** that handoff 6 proved can reach a Python
evaluator with **one typed object** the enforced dispatcher routes as a single
semantic instruction — so that a taught value travels as *itself*, with its
provenance and its refusals attached, rather than as an anonymous number.

**IT DOES NOT** touch the sealed-spec producer, does not extract anything from a
transcript, and does not author a numeric parser. `RECEIVES`, never `EXTRACTS`
(`R-686 §4.2`) — an extracting parser inside the producer would be the **third**
numeric parser in a codebase currently being repaired for exactly that.

---

## 1. THE ENVELOPE — reconciled, not overwritten

The campaign adopted this envelope at `R-678 §4c`, explicitly in preference to an
unrestricted dict:

```
primitive_id · primitive_version · arguments · source_provenance · parameter_status
```

The external read of 2026-08-04 proposed a **flattened** field list (fast type,
fast period, slow type, slow period, price source, crossing relation, direction).
**Both are kept, at different levels:** the flattened fields live **INSIDE
`arguments`**, and the adopted envelope is unchanged.

**Why not replace the envelope with the flat list:** the envelope is
primitive-*general* and the dispatcher is primitive-general. A flat MA-shaped
object would make the router's type depend on which primitive it is routing,
which is the shape that forces a second router later. **The envelope stays
general; the arguments stay typed.**

---

## 2. THE OBJECT

```jsonc
{
  "primitive_id":      "moving_average_crossover",
  "primitive_version": 1,

  "arguments": {
    "fast_type":         "SMA" | "EMA",
    "fast_period":       <int, >0>,
    "slow_type":         "SMA" | "EMA",
    "slow_period":       <int, >0>,
    "price_source":      "close" | "open" | "hl2" | "hlc3" | "ohlc4",
    "chart_timeframe":   "<explicit timeframe token>",
    "crossing_relation": "crosses_above" | "crosses_below" | "crosses",
    "direction":         "bullish" | "bearish" | "both"
  },

  "source_provenance": {
    "<argument name>": {
      "tier":   "EXACT_TRANSCRIPT" | "VALIDATED_STRUCTURED" | "INFERRED" | "NONE",
      "locator": "<transcript span / artifact field — how to re-find it>"
    }
  },

  "parameter_status": {
    "<argument name>": "TAUGHT" | "ASSUMED" | "REFUSED"
  }
}
```

### 2.1 THREE CORRECTIONS TO THE EXTERNAL FIELD LIST — each from a measurement, not a preference

**(a) `chart_timeframe` IS PRESENT, AND ITS ABSENCE WOULD HAVE BEEN THE EXPENSIVE
OMISSION.** `[MEASURED — `AR-737 §4`, carried at `ADVISOR-STATE.md` item 4]` the MA's
chart timeframe is one of exactly **TWO** live `ASSUMED` arguments (the other is the
input series). `ADVISOR-STATE` item 4 makes **`approximation=False` UNAVAILABLE if any
load-bearing argument is `ASSUMED`** (`R-677 §2.4.2`). **An object with no field for the
timeframe can never record it as TAUGHT, and therefore can never support
`approximation=False` — it would cap the fidelity ceiling of every strategy compiled
through it, permanently and invisibly.** The external list omitted it.

**(b) `parameter_status` IS PER-ARGUMENT, NOT PER-OBJECT, AND THE MEASUREMENT FORCES
THIS.** `[MEASURED — `AR-737 §4`]` an educator said *"it's not the exponential"* — an
explicit **REFUSAL** of the MA *type* while the *periods* were taught. **A single
object-level status cannot express `fast_type: REFUSED` alongside `fast_period: TAUGHT`;
it must either drop the refusal or falsely downgrade the periods.** The external read's
single `source-resolution status` field is that shape.

**(c) THE THIRD VALUE IS `REFUSED`, AND IT IS MEASURED RATHER THAN CHOSEN.** A
two-valued status (`taught`/`assumed`) silently converts *"the teacher said NOT this"*
into *"the teacher did not say"*. Those are opposite facts. `type: SMA` alone cannot
record a refusal — that is precisely what `AR-737 §4` caught.

---

## 3. THE SERIALIZATION LAW — the field list is not the design without it

★★★★★ **OMIT THE KEY ENTIRELY WHEN THERE ARE NO ARGUMENTS. NEVER `null`. NEVER `{}`.**

`[MEASURED — `AR-739 §1`, `_spec_hash` reimplemented independently, `18/18` sealed
artifacts reproduced]` **omit → `0/18` re-seal · `null` or `{}` → `18/18` re-seal.**

**This single choice is the whole difference between a change that preserves every
sealed artifact and one that invalidates all eighteen.** A field list that permits an
empty object is not a safe design regardless of how correct its fields are — and a
field list is exactly the form in which this law gets dropped, because it is not a
field.

**Corollary, measured:** `[MEASURED — all 18 sealed artifacts, two live controls]`
sealed top-level keys carry `0` bindings (control: `18/18` carry `spec_hash`), so a
`ConditionBinding` field **cannot** move a sealed hash. The re-seal risk lives entirely
in the serialization law above, not in the object's existence.

---

## 4. WHAT THE CACHE KEY OWES (`R-680 §1`, measured)

```
primitive_id · primitive_version · canonical(arguments)
             · input-series identity · chart_timeframe
             · session context · data revision
```

**AND EXPLICITLY NOT `symbol`/`instrument`, NOT `spec identity`** — `[MEASURED —
`AR-743`, AST plus the runtime code object `compute.__code__`, controls both ways]`
`ctx` lifetime is ONE `compute()` call; one instance = one spec; each instrument gets
its own instance.

⚠️ **STANDING TRAP IF ANY CACHE IS EVER HOISTED TO INSTANCE LEVEL** (`R-680 §2`):
`black_swan_evaluator.py:368-370` sets `.symbol`/`.timeframe` **after** construction.
Cleared today for `SpecConditionStrategy`, but it proves *"symbol is fixed at
construction"* is a **per-class** fact, not a codebase one.

`canonical(arguments)` requires a canonicalization function — ordered keys, normalized
type casing — because two objects that differ only in key order must not occupy two
cache slots.

---

## 5. PRECEDENCE AND REFUSAL — adopted, restated verbatim

**Precedence (`R-684 §7`):** exact transcript **>** validated structured extraction of
that exact source **>** inferred/LLM **>** none.
★★★★★ **`AN INFERRED VALUE MUST NEVER OVERWRITE AN EXPLICIT SOURCE VALUE.`**
🛑 **`engine defaults may NEVER substitute` STANDS** — and `R-684 §6` measured the live
inversion: a validator-range **MIDPOINT** is substituted today on the TypeScript path.

**Block codes — exactly THREE (`R-684 §7.2`):**
`missing_source_parameter` · `conflicting_source_parameters` · `unknown_parameter_key`.

🛑 **`unresolved_source_ambiguity` IS RETIRED AS A COMPILER BLOCK CODE.** It survives
**only** as a CAMPAIGN RESEARCH VERDICT (*"the lesson genuinely does not say"*). **A
finding about a source is never a code in a compiler. They must never share a name
again.**

---

## 6. WHAT THE IMPLEMENTATION WILL OWE WHEN THE GATE LIFTS

Recorded now so the contract is fixed **before** the evidence arrives
(`pre-register-criteria`), not chosen after it:

1. **RED FIRST, HARD GATE.** The old two-scalar path must be shown FAILING under a
   valid parameterized fixture before the typed object is introduced. **If it does not
   fail, STOP and revise the hypothesis** (`R-679 §4`).
2. **NO FIXTURE VALUE MAY COINCIDE WITH AN ENGINE DEFAULT.** Measured forbidden set:
   `{5, 10, 14, 20, 30, 50, 250}`; the engine hardcodes `20`/`50` at
   `spec_condition_compiler.py:140-141` and `:143`. `A FIXTURE WHOSE TAUGHT PARAMETERS
   COINCIDE WITH AN ENGINE DEFAULT CANNOT WITNESS PARAMETER TRANSMISSION.`
3. **THE CONVICTED SHAPE IS FORBIDDEN BY NAME** (`R-692 §3`, `R-684 §1`): *"reading the
   period only to alter the cache key while the calculation remains hardcoded."*
   **Re-keying alone produces two cache slots holding the same hardcoded answer and a
   green test.** The only admissible claim without an evaluator change is `THE CACHE IS
   RE-KEYED; THE CHANNEL REMAINS SEVERED AT THE EVALUATOR.`
4. **A POSITIVE WITNESS THAT THE PRODUCTION PRIMITIVE RAN WITH THE TAUGHT VALUES** —
   not merely that two output arrays differ. Two arrays can differ for reasons
   unrelated to the parameter.
5. **FLAG-OFF MUST *REFUSE* PARAMETERIZED BINDINGS, NOT DROP THEM.** A silent drop is
   the midpoint-invention defect wearing a feature flag.
6. **EVERY RED-PROOF NAMES ITS EXPECTED-GREEN SET IN ADVANCE** (`R-681 §1`). `A
   MUTATION THAT BREAKS YOUR CONTROLS AS WELL AS YOUR ASSERTIONS HAS NOT TESTED YOUR
   ASSERTIONS.`
7. **TWO FIXTURES, NOT ONE** (`R-679 §4`): the CACHE test's arms need only differ; the
   PARAMETER-TRANSMISSION test must avoid every engine default on BOTH arms. `ONE
   FIXTURE THAT CAN FAIL FOR TWO REASONS IS NOT A CONTROL FOR EITHER.`

---

## 7. WHAT THIS OBJECT DOES NOT CLAIM

- ❌ It does **not** mean a taught number reaches this object today. **The producer end
  is ABSENT** — `[MEASURED]` `produce_spec_artifact` has `0` occurrences of
  `entry_params|param_source|entry_indicator` against a control of `4` for
  `entry_sequence|confluences`, and builds conditions from `_condition_text(step)` —
  **prose.** There is no upstream field for a taught number to occupy.
- ❌ It does **not** mean a full moving-average strategy compiles.
- ❌ It does **not** mean the compiler is operational.
- ❌ It does **not** certify handoff 6. That is `[MEASURED BY THE DOER, RE-RUN BY THIS
  DESK]` and stays there until the independent grade appends a verdict.
- ⚠️ `[MEASURED HERE, `R-694`]` the `13` frozen `phase_b` inputs carry `0`
  `entry_params` — **so even a complete object has nothing upstream to receive from
  yet.** That is a MEASUREMENT (Lane 13), not a preference, and it is why this design
  ships as a design.

★★★★★ **`WE BUILT THE MIDDLE OF A CHANNEL WHOSE BOTH ENDS ARE MISSING` — handoff 6
moved one third of it. This object is the shape of the next third. NEVER REPORT THE
CHANNEL AS PARTLY DELIVERED WITHOUT NAMING WHICH THIRD.**
