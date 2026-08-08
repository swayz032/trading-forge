# PHASE A — CAUSAL TRACE — `st5e-YJRfKc__s0` (`opening_range_breakout`)

**Authority:** `R-722 §9` (Phase A authorized) as amended by `R-723 §2`/`§6`.
**Instrument:** adopted **verbatim** from `docs/designs/EXTERNAL-READ-2026-08-04-BINDING-CAUSE-FRAMEWORK.md`
(six-field trace row · ten-value classification enum · one-primary-blocker · PROBE A/B/C · cause decision table).
**Doer:** worker seat `claude.exe 3160`. **Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`.

> 🛑 **THIS FILE IS NOT A CAUSAL RULING AND ITS CLASSIFICATIONS ARE NOT CERTIFIED.**
> `R-723 §2` split the acceptance: **mechanical completeness is mine; whether a `final causal
> classification` is CORRECT is neither mine nor the desk's** — it is pre-registered to an
> independent `accuracy-validator` grade, desk-dispatched. **`R-722 §4`'s standing disposition
> remains `UNVERIFIABLE` until that grade lands.** Nothing here may be quoted as the cause.

---

## FROZEN INPUTS (pinned before any row was written)

| input | identity | how joined |
|---|---|---|
| census artifact | `docs/replay-results/h1-battery/tier-a-compile-census.json`, blob **`23f30eb0`** | `git rev-parse HEAD:<path>` |
| extraction artifact | `docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json` | sha256 **`7868524ba4401755edb26a4db4aa1699e0c4b5ad0cc422e58a5bbf759d62ab99`** |
| join proof | census `specs[].extraction_sha256` **equals** the sha256 I computed myself with `sha256sum` | **not taken from `_MANIFEST.json`** — the manifest agrees, but a manifest restating a value is not a second path |
| compiler | `src/engine/spec_family_bindings.py` · `src/engine/session_windows.py` | read at the tree above |
| flag state | `TF_SESSION_ROLE_RESOLVER_ENABLED` — **unset in this environment**, default `"false"` (`spec_family_bindings.py:2406`) | `os.environ.get(...)` → `None`; executable default line quoted below |

**Spec-level census fields** (`stub = st5e-YJRfKc__s0`): `n_conditions_total=11` · `n_spine_or_trigger=5` ·
`n_spine_binds=0` · `n_taught_binds=1` · `spine_fully_binds=False` · `all_taught_binds=False` ·
`asset_class="equities"` · `instrument_class_extracted=None` · `direction="both"`.

---

## ROW 1 — CALIBRATION ROW (`R-722 §5-2`: the unambiguous row first, to prove the rig can produce a row at all)

**CONDITION:** `WAIT_SESSION:the-5m-minute-ob-takes-place-from-9-30-a#1`
**Census verdict being explained:** `bind_status=UNBOUND` · `bindable=False` · `executed=False` ·
`unbound_reason="no_recognized_session_keyword"` · `session_zone=null` · `session_keyword_resolves=false` ·
`role="spine"` · `load_bearing_spine=true` · `tf_class="EXEC_TAUGHT"` · `concepts=[]`.

### Field 1 — SOURCE EVIDENCE — ⚠️ **PARTIAL, AND I NAME THE MISSING HALF**
- **Teacher wording (preserved verbatim in the frozen extraction artifact,
  `strategies[0].entry_sequence[1].action`):**
  > *"The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern. The 15-minute is the
  > first 15 minutes of the market. So, from 9:30 to now 9:45. And the 30 minute is from 9:30 to 10
  > a.m. Eastern."*
- **Exact timestamp:** `UNMEASURED`. **Chart evidence:** `UNMEASURED`.
- **What would measure them:** the source transcript/video for video id `st5e-YJRfKc`. `[MEASURED HERE]`
  the frozen extraction artifact contains **no** timestamp, transcript offset, or chart reference —
  its keys are `coaching_notes · coverage_notes · dispatch_record · instrument_classification ·
  reader_identity · rejected_strategies · strategies`, and none carries source timing.
- 🛑 **CONSEQUENCE, STATED SO IT IS NOT QUIETLY ABSORBED: PROBE A CANNOT BE RUN AT FULL STRENGTH FROM
  THIS TREE.** PROBE A asks *"did the extractor preserve every concrete rule?"* and that is a
  **source-vs-artifact** comparison. I hold the artifact and **not** the source. ⇒ **Everything below
  is artifact-side evidence. I can prove what the artifact contains; I cannot prove what the lesson
  contained and the artifact dropped.**

### Field 2 — EXTRACTED REPRESENTATION — ✅ MEASURED, AND THIS IS THE ROW'S CENTRAL FINDING
`[MEASURED HERE, the frozen artifact, `strategies[0].entry_sequence`]` — **every one of the five steps
has exactly one key, `action`, whose value is a verbatim English sentence:**
```
entry_sequence[0] = {"action": "once you take the price that's established in the first 5, 15, and the 30 minute ranges, ..."}
entry_sequence[1] = {"action": "The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern. ..."}
entry_sequence[2] = {"action": "We take the opening range high and the opening range low in between these time periods. ..."}
entry_sequence[3] = {"action": "So now we take a look at these levels projected going out after this 30 minute range is over. ..."}
entry_sequence[4] = {"action": "When price breaks above the range high, ..."}
```
🛑🛑 **THE EXTRACTED REPRESENTATION CARRIES NO PARAMETERS, NO TIMEFRAME FIELD, NO TIMEZONE FIELD, NO
DIRECTION FIELD, NO ORDERING FIELD, AND NO AMBIGUITY FIELD — FOR THIS CONDITION OR ANY OTHER.** The
framework's field-2 checklist (*extracted condition · parameters · timeframe · direction · ordering ·
provenance · ambiguity status*) is satisfied **only** by `extracted condition`, and only as prose.
✅ **CORROBORATED INDEPENDENTLY BY THE CENSUS, WHICH JOINS ON A DIFFERENT PATH:** `concepts=[]` and
`session_zone=null` for this condition — the downstream reader also found nothing typed to read.
⚠️ **AND THE ARTIFACT'S OWN `coverage_notes` DISAGREE WITH THE COMPILER, WHICH IS EXACTLY THE KIND OF
DISAGREEMENT A TRACE EXISTS TO SURFACE:**
> *"VARIANT SUB-MECHANIC (5m/15m/30m windows): **PRESENT** — entry_sequence step 2 + variants[]."*
> *"PRECONDITION (first 5/15/30 min after 9:30 ET, recomputed each day): **PRESENT**."*
★★★ **THE EXTRACTOR MARKS THIS RULE `PRESENT` AND THE COMPILER SCORES IT `UNBOUND`. BOTH ARE
TRUTHFUL ABOUT DIFFERENT QUESTIONS — `PRESENT` MEANS *THE WORDS SURVIVED*; `UNBOUND` MEANS *NOTHING
TYPED ARRIVED*. A COVERAGE NOTE IS A CLAIM ABOUT TEXT, NOT ABOUT EXECUTABILITY.**

### Field 3 — CANONICAL INTERPRETATION — ✅ MEASURED
- **Intended canonical concept:** an *opening-range window* — session-anchored, **explicit clock span**,
  three taught variants: `09:30–09:35`, `09:30–09:45`, `09:30–10:00` **America/New_York**.
- **Required typed fields:** window start · window end · timezone · the day-relative recomputation rule.
- 🛑 **THE CANONICAL VOCABULARY AVAILABLE TO A `WAIT_SESSION` CONDITION IS A CLOSED FIVE-VALUE ENUM OF
  *NAMED* ZONES** `[MEASURED HERE, `spec_family_bindings.py:507-513`]`:
```python
SESSION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "london": ("london session", "london open", "london killzone"),
    "ny_am": ("ny am", "new york am", "new york morning", "ny morning", "ny open", "am session"),
    "ny_pm": ("ny pm", "new york pm", "new york afternoon", "ny afternoon", "pm session"),
    "silver_bullet": ("silver bullet",),
    "macro_window": ("macro window", "macro release"),
}
```
⇒ **THERE IS NO CANONICAL FORM IN WHICH "09:30–09:35 ET" CAN BE STATED.** The canonical layer can
express *which named killzone*, and cannot express *which clock window*.

### Field 4 — BINDING RESULT — ✅ MEASURED AT THE EXECUTABLE LINE
- **Family metadata** `[MEASURED HERE, `spec_family_bindings.py:642-648`]`:
```python
"WAIT_SESSION": FamilyMeta(
    primitive="session_windows",
    requires_session_keyword=True,
    base_approximation=False,
    unbound_reason="no_recognized_session_keyword",
    enforced_primitive="session_windows.is_in_killzone",
),
```
- **The branch that runs** `[MEASURED HERE, `:2708`, `:2723`, `:2739-2740`]`: `if meta.requires_session_keyword:`
  → `if session_role_resolver_enabled():` … `else: zone = resolve_session_keyword(obj)`.
- **Flag state, measured not assumed** `[`:2406`]`:
  `return os.environ.get("TF_SESSION_ROLE_RESOLVER_ENABLED", "false").strip().lower() == "true"` and the
  variable is **unset** ⇒ **the `else` branch is the live path**: pure keyword membership.
- **Attempted primitive:** `session_windows` / `session_windows.is_in_killzone`.
- **Result: REFUSAL.** `resolve_session_keyword(obj)` returns `None` — the object text contains no member
  of `SESSION_KEYWORDS` — so the flow falls past the bind and the condition carries
  `unbound_reason="no_recognized_session_keyword"`, matching the census field exactly.
- **Was approximation attempted? NO, and the refusal is DELIBERATE, not an oversight.** `[MEASURED HERE,
  `:2763-2784`]` the module documents the precedence fix in its own words:
  > *"flag OFF → bindable=False … flag ON → bindable=True, zone=ny_am ← the RTH day session, the
  > COMPLEMENT of the overnight range taught … THE REFUSAL IS LOAD-BEARING AND MUST SURVIVE THE FLAG."*
  ★★★ **THIS COMPILER HAS ALREADY BEEN BITTEN BY THE EXACT FAILURE THIS ROW IS ABOUT — A NAMED ZONE
  ACCEPTED AS A STAND-IN FOR A TAUGHT CLOCK WINDOW — AND IT NOW REFUSES RATHER THAN SUBSTITUTE. THE
  `UNBOUND` ON THIS ROW IS THE COMPILER BEHAVING CORRECTLY.**

### Field 5 — ENGINE CAPABILITY — ✅ MEASURED
- **Detector identity:** `session_windows.is_in_killzone` `[MEASURED HERE, `session_windows.py:155-161`]`:
```python
def is_in_killzone(timestamp_utc: datetime, zone: str) -> bool:
    """Mirrors killzone.ts::isInKillzone. Never raises; unknown zone -> False."""
    et_min = _to_et_minutes_of_day(timestamp_utc)
    if et_min is None: return False
    check = _ZONE_CHECKS.get(zone)
    return bool(check(et_min)) if check else False
```
- **Required inputs:** a UTC timestamp and a **zone NAME** drawn from
  `_ZONE_CHECKS = {london, ny_am, ny_pm, silver_bullet, macro_window}` (`:146-152`).
- 🛑 **DOES *THIS* PRIMITIVE COMPUTE THE TAUGHT CONCEPT? NO.** The signature admits **no start/end
  parameters** — it takes a zone NAME from a closed enum.
- ✅ **PROBE C RUN. TRUE-SETS MEASURED BY EXECUTION, NOT BY READING CONSTANTS** — every minute of a fixed
  EDT day (`2026-06-15`), 1-minute granularity, `1440` calls per zone:

| zone | measured TRUE-SET | minutes |
|---|---|---|
| `london` | `02:00–05:00` | 180 |
| `ny_am` | `07:00–10:00` | 180 |
| `ny_pm` | `13:30–16:00` | 150 |
| `silver_bullet` | `03:00–04:00, 10:00–11:00, 14:00–15:00` | 180 |
| `macro_window` | `02:33–03:00, 04:03–04:30, 09:50–10:10` | 74 |

  - **POSITIVE CONTROL:** `764` TRUE minutes across all zones ⇒ **the rig is live and CAN return True.**
  - **NEGATIVE CONTROL:** unknown zone `"zzz_zone_not_present"` ⇒ `0` TRUE minutes.
  - **RESULT — EXACT MATCH AGAINST EACH TAUGHT WINDOW: `NONE`, all three.** The only superset is `ny_am`:
    **`36.0×` wider than the 5m window** (`+175` min), `12.0×` the 15m (`+165`), `6.0×` the 30m (`+150`).
  - ⚠️ **CORRECTION TO THIS FILE'S FIRST VERSION (committed `d181fcd7`): I wrote `30×`. MEASURED IT IS
    `36.0×` (`180/5`). My figure was an unmeasured mental estimate sitting in a cell that demands a
    measurement, and PROBE C is what caught it.** ★ **`AN ESTIMATE INSIDE AN EVIDENCE CELL WEARS THE
    CELL'S AUTHORITY.`**
- 🛑🛑★★★★★ **AND PROBE C REFUTED MY OWN SECONDARY. THE ENGINE *CAN* COMPUTE THE TAUGHT CONCEPT —
  IT IS THE COMPILER THAT CANNOT ASK IT TO** `[MEASURED HERE, `src/engine/indicators/core.py:467-487`]`:
```python
def compute_opening_range_breakout(
    df: pl.DataFrame,
    range_minutes: int = 15,
    session_start_et: str = "09:30",
) -> tuple[pl.Series, pl.Series, pl.Series]:
    """...  Range LOCKS at session_start_et + range_minutes (e.g. 09:45 ET for 15-min OR)
             Values BEFORE the lock time are None (no lookahead) ... Resets each trading day
             09:30 ET start aligns with NYSE/CME RTH open"""
```
  **`range_minutes` and `session_start_et` are parameters.** ⇒ **ALL THREE taught variants are exactly
  expressible: `(5, "09:30")`, `(15, "09:30")`, `(30, "09:30")`.** It even locks the range and forbids
  lookahead, which is the taught semantics.
  - **IT IS LIVE, NOT DEAD CODE** `[MEASURED HERE, non-test callers]`: invoked at
    `indicators/core.py:649` and `:760` by the indicator dispatcher.
  - 🛑 **BUT NO BINDING FAMILY CAN REACH IT** `[MEASURED HERE, `spec_family_bindings.py`, every
    `primitive="…"` literal enumerated]`: the declared set is
    `bias_engine.classify_institutional_regime · entry_quality.confluence_factor_presence ·
    fvg_native.compute_fvg_signal · provenance_only · session_windows · session_windows.is_in_killzone ·
    spec_condition_compiler.candle_confirmation_check · spec_condition_compiler.retest_touch_check ·
    spec_condition_compiler.wait_bias_directional_proxy · spine_completion_trigger ·
    structural_stops.compute_structural_stop · structure_engine.compute_structure_state`.
    **`compute_opening_range_breakout` is not among them, and no family declares it.**
    (The enumeration IS the positive control: the same command that returned nothing for the OR
    constructor returned all twelve of these.)
- ★★★★★ **THE SENTENCE THIS ROW EXISTS TO PRODUCE: `THE ENGINE ALREADY COMPUTES THE TAUGHT CONCEPT,
  PARAMETERISED EXACTLY AS TAUGHT, AND THE SPEC-BINDING SURFACE HAS NO ROUTE TO IT.` The condition is
  instead routed at `WAIT_SESSION` to a killzone-membership boolean, which is a different concept.**
- **State machine required?** **YES** — *form the range → lock it → project high/low → wait for a
  breakout* is ordered. `is_in_killzone` is a stateless per-bar boolean constructing no range object;
  `compute_opening_range_breakout` **does** construct and lock the range. **`UNMEASURED`: whether the
  breakout-and-retest half has a carrier.** *What would measure it:* trace ROW 2 (`WAIT_STRUCTURE#0`).

### Field 4b — PROBE B (BINDER) — ✅ RUN, DIAGNOSIS-ONLY (`R-722 §5-1`), AND IT FOUND MORE THAN IT WAS SENT FOR
**Method:** feed condition objects to the **real production entry point** `bind_condition()`
(`spec_family_bindings.py:2952`). **Expected values COMPUTED from the committed census, never typed
in** (`hardcoded-test`): the control asserts against `cond["bindable"]` / `cond["unbound_reason"]`
read out of blob `23f30eb0` at runtime.

- ✅ **CONTROL 1 — THE HARNESS REPRODUCES THE CENSUS:** `WAIT_SESSION` + the taught text →
  `bindable=False`, `reason=no_recognized_session_keyword`, `zone=None`. **Census agreement: `True`.**
  ★ *If this had disagreed, the finding would have been against my rig, not the compiler.*
- ✅ **CONTROL 2 — POSITIVE, THE BINDER IS LIVE:** `WAIT_SESSION` + `"we enter during the ny open"` →
  **`bindable=True`, `primitive=session_windows`, `zone=ny_am`.** ⇒ **The refusal above is a property of
  the INPUT MEANING, not a dead code path.**
- 🛑 **THE ANSWER — all `14` canonical families × the taught text:** **`11` bind, to `8` distinct
  primitives, and `NONE` is the opening-range constructor.** Reachable set:
  `bias_engine.classify_institutional_regime · entry_quality.confluence_factor_presence ·
  provenance_only · spec_condition_compiler.candle_confirmation_check ·
  spec_condition_compiler.retest_touch_check · spine_completion_trigger ·
  structural_stops.compute_structural_stop · structure_engine.compute_structure_state`.
  Only `WAIT_SESSION` (`no_recognized_session_keyword`), `RESET` and `EXCEPTION`
  (`control_flow_*_unsupported`) refuse. **Positive control for that absence: the same enumeration
  returned 8 non-empty primitives, so it demonstrably can return results.**

🛑🛑🛑★★★★★ **AND HERE IS THE FINDING I WAS NOT SENT TO GET, WHICH IS WHY IT MATTERS:
THE SAME UNCHANGED SENTENCE — a paragraph about 9:30-to-9:35 clock windows — BINDS "SUCCESSFULLY",
`reason=None`, UNDER `11` DIFFERENT FAMILY TYPES, EACH TO A DIFFERENT PRIMITIVE.** Typed
`WAIT_STRUCTURE` it binds to the structure engine; typed `WAIT_BIAS` it binds to the institutional
regime classifier; typed `INVALIDATE` it binds to the structural-stop computer. **The text is never
consulted.**
★★★★★ **`BINDING ON THIS SURFACE IS TYPE DISPATCH, NOT MEANING MATCHING. THE FAMILY LABEL CHOSEN BY
THE EXTRACTOR — NOT THE TEACHER'S WORDS — DECIDES WHICH ENGINE PRIMITIVE RUNS, AND A MISTYPED
CONDITION BINDS CONFIDENTLY TO THE WRONG ONE WITH NO REFUSAL AND NO APPROXIMATION FLAG.`**
⚠️ **SCOPE, HONESTLY: this is measured for THIS text across `14` families. I have NOT measured whether
some families consult their text in other paths** (`WAIT_SESSION` demonstrably does — that is the whole
refusal). **What is established is that `11` families accepted a semantically unrelated paragraph
without complaint. What is NOT established is that no family anywhere validates text.**
⚠️ **AND IT IS A HYPOTHESIS, NOT A FINDING, THAT THIS EXPLAINS THE SPEC'S `9` `APPROXIMATED` ROWS** —
those are all typed `WAIT_STRUCTURE` and all bind to `structure_engine.compute_structure_state`. **The
shape fits. I have not traced them, and ROW 2 is where that gets measured rather than assumed.**

### Field 6 — FINAL CAUSAL CLASSIFICATION — ⚠️ **PRODUCED, NOT CERTIFIED** (`R-723 §2`)
- **PRIMARY BLOCKER (proposed):** **`PARAMETER_SCHEMA_MISMATCH`**
  — the earliest measured divergence. The teacher's rule left the source **fully specified** (three exact
  clock spans, named timezone) and arrived at the compiler as an **untyped English sentence with no
  parameter fields at all**. The binder cannot fail *or* succeed on a parameter it was never handed.
- **SECONDARIES (listed separately, deliberately not merged):**
  1. **`CANONICAL_TERM_UNRESOLVED`** — even a correctly typed clock window has no canonical form; the
     vocabulary is a closed enum of five *named* zones (field 3).
  2. ~~**`ENGINE_PRIMITIVE_MISSING`** — `is_in_killzone` takes no window parameters; no opening-range
     constructor was found on this surface (field 5).~~ 🛑 **STRUCK — REFUTED BY MY OWN PROBE C.**
     `compute_opening_range_breakout(df, range_minutes, session_start_et)` **exists, is parameterised
     exactly as taught, and is live in production.** **The engine primitive is NOT missing.**
     ★★★ **PRESERVED RATHER THAN DELETED: I proposed this secondary while its evidence cell said
     `UNMEASURED`, and the measurement killed it within the hour. That is the honest-partial clause
     working as designed — and it is the argument for never letting an `UNMEASURED` cell license a
     ranked blocker.**
  2b. **`ENGINE_PRIMITIVE_WRONG_IDENTITY` — REPLACES IT, and it is a stronger claim, not a weaker one.**
     The condition is routed to `session_windows.is_in_killzone` (killzone MEMBERSHIP) while the concept
     it teaches is an opening RANGE, and the correct constructor exists unreferenced by any family.
     ⇒ **The registry, not the engine, is where the taught concept dies.** Per the framework's own
     decision table: *"Canonical object cannot bind although exact engine primitive exists → binding-
     schema or registry defect."*
  3. **`TEMPORAL_MODEL_COLLAPSED`** — *(weakest of the three; flagged, not argued)* the ordered
     range→breakout sequence has no carrier in the extracted representation.
- 🛑 **WHY I AM NOT NAMING `EXTRACTION_MISSING_REQUIRED_INFORMATION`:** the information is **not
  missing** — `9:30 a.m. Eastern to 9:35 a.m. Eastern` is present verbatim in the artifact. **What is
  missing is its TYPE, not its CONTENT**, and those are different enum values. ★ **`INFORMATION THAT
  SURVIVES AS PROSE HAS BEEN PRESERVED AND NOT DELIVERED.`**
- ✅ **BOTH PROBES ARE NOW RUN, AND THE ORDERING ABOVE IS REVISED ON THEIR EVIDENCE:**
  **`CANONICAL_TERM_UNRESOLVED` IS PROMOTED TO CO-PRIMARY WITH `PARAMETER_SCHEMA_MISMATCH`** — and I
  state the reason rather than just the rank: **the two blockers are INDEPENDENT, and repairing either
  one alone leaves this condition exactly as unbound as it is today.**
  - Even a **perfectly typed** parameter object (`start=09:30, end=09:35, tz=America/New_York`) has
    **no canonical family to be typed AS** — the vocabulary is `14` families and none of them means
    *"construct a price range over a taught clock window"* `[MEASURED HERE, `FAMILY_META` keys]`.
  - Even a **perfect canonical term** has no route to the engine — **no family declares the OR
    constructor** (field 5), so the term would bind to nothing.
  ⇒ **The framework's decision-table row that fits is `Canonical object cannot bind although exact
  engine primitive exists → binding-schema or registry defect`.**
- ⚠️ **AND I APPLY `R-722 §3`'s ANTI-MONOCAUSE CLAUSE TO MY OWN ROW:** this is **not** one explanation.
  **Two independent handoffs are broken, and the earliest (extraction → canonical) is NOT SUFFICIENT to
  explain the failure**, because the next one would block regardless. ★★★ **`THE EARLIEST BROKEN
  HANDOFF IS NOT AUTOMATICALLY THE ONE WORTH REPAIRING — NAME WHETHER FIXING IT ALONE WOULD CHANGE THE
  OUTCOME.` Here it would not.**
- 🛑 **WHAT STILL CANNOT BE RULED FROM THIS ROW:** **PROBE A remains artifact-side** (no frozen source
  lesson in this tree), so `SOURCE_ITSELF_INCOMPLETE` cannot be excluded by measurement — only by the
  observation that the artifact already carries exact times, which is evidence about the artifact, not
  about the lesson. **`R-722 §4`'s `UNVERIFIABLE` stands until the independent grade lands.**

### ROW 1 — PROBE STATUS
| probe | status | note |
|---|---|---|
| **A — extraction** | ⚠️ **ARTIFACT-SIDE ONLY** | the frozen source lesson is not in this tree; I compared the artifact against itself and the census, never against the lesson |
| **B — binder** | ✅ **RUN, DIAGNOSIS-ONLY, BOTH CONTROLS FIRED** | real `bind_condition()`; harness reproduces the census; positive control binds `ny_am`; `11/14` families bind the taught text to `8` primitives, **none the OR constructor**. Attempts used: `1 / 2` |
| **C — engine** | ✅ **RUN, PASSED ITS OWN CONTROLS, AND CHANGED THE ANSWER** | `1440`-minute enumeration × 5 zones + positive and negative controls ⇒ no zone expresses any taught window (`36×`/`12×`/`6×` too wide). **Then found the real constructor: the engine CAN compute the taught concept and no family routes to it.** Attempts used: `1 / 2` |
| **attempt budget** | A `0/2` · **B `1/2`** · **C `1/2`** — both succeeded on their first *substantive* run | `R-648`, per-probe |

### INSTRUMENT DISCLOSURES — MY OWN TOOLING BROKE TWICE, BOTH LOUDLY
1. **Import shape.** `sys.path.insert(0,"src")` + `from engine...` works for `session_windows` (no
   intra-package imports) and **fails** for `spec_family_bindings`, which imports `src.engine.…`
   absolutely. `ModuleNotFoundError`, fixed by putting the repo root on the path.
2. **Signature shape.** I called `bind_condition(cond, role="spine")`; the public entry point takes
   `(condition, restore, demoted_role, force_unexecuted)` and reads `role` **off the condition dict**.
   `TypeError`, fixed by moving `role` into the dict.
✅ **NEITHER IS COUNTED AGAINST THE `R-648` PROBE BUDGET, AND I SAY WHY RATHER THAN JUST ASSERTING IT:**
the budget governs **failed attempts at a hypothesis** — *"a renamed hypothesis is the same attempt."*
These were **harness-construction errors that never produced a result**, and both **failed loudly with a
stack trace** rather than returning a plausible wrong answer. ★★★ **`AN INSTRUMENT THAT CRASHES HAS NOT
LIED TO YOU; THE BUDGET EXISTS FOR INSTRUMENTS THAT ANSWER.`** ⚠️ **Recorded anyway, because a clean
tooling log would imply the rig worked first time and it did not.**

---

## ROW 2 — FIRST LOAD-BEARING CONDITION — 🛑 NOT STARTED
Ordered second by `R-722 §5-2`. Target: `WAIT_STRUCTURE:...#0` (`role=spine`, `bind_status=APPROXIMATED`,
`binds_to=structure_engine.compute_structure_state`). **No cell measured. Nothing claimed.**

## WHAT THIS FILE DOES **NOT** ESTABLISH
1. **No cause is established.** Two of three probes are unrun; `UNVERIFIABLE` stands.
2. **Nothing about the other 10 specs**, and nothing about the other 10 conditions of this spec.
3. **Nothing about `runtime-production`** — unmeasured and out of scope.
4. **No repair is proposed or performed.** Phase A is diagnosis; repair is Phase B and is not authorized.
5. **The `9` `APPROXIMATED` conditions are untouched** — this row explains the single `UNBOUND` one only.
