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

## ROW 2 — FIRST LOAD-BEARING CONDITION — ✅ TRACED

**CONDITION:** `WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0`
**Census verdict being explained:** `bind_status=APPROXIMATED` · `bindable=True` · **`executed=True`** ·
`binds_to="structure_engine.compute_structure_state"` · `approximation=True` · `unbound_reason=None` ·
`role="spine"` · `load_bearing_spine=true` · `tf_class="EXEC_TAUGHT"`.
🛑 **THIS ROW IS THE DANGEROUS SHAPE AND ROW 1 WAS NOT: ROW 1 REFUSED LOUDLY. THIS ONE REPORTS
`bindable=True, executed=True` AND FEEDS A BACKTEST.**

### Field 1 — SOURCE EVIDENCE — ⚠️ ARTIFACT-SIDE ONLY (same ceiling as ROW 1)
> *"once you take the price that's established in the first 5, 15, and the 30 minute ranges, you have
> what we call the 5,5 and the 30 minute OB"*
(`strategies[0].entry_sequence[0].action`, frozen artifact `7868524b…`.) **Timestamp / chart evidence:
`UNMEASURED` — no frozen source lesson in this tree.**
⚠️ **AND A SOURCE-SIDE AMBIGUITY I AM NOT RESOLVING:** the artifact says **`"the 5,5 and the 30 minute
OB"`** where the surrounding teaching says `5 / 15 / 30`. **Either the teacher misspoke or the extractor
mis-transcribed, and I CANNOT TELL WHICH FROM THE ARTIFACT ALONE.** ★ **This is exactly what PROBE A
exists to settle, and it is the second concrete cost of the missing transcript.**

### Field 2 — EXTRACTED REPRESENTATION — ✅ MEASURED
`{"action": "<the sentence above>"}` — **prose only, no parameters**, identical in shape to ROW 1.
The taught content is a **range CONSTRUCTION rule** (take the high/low established across the first
5/15/30 minutes and call it the OB), carrying **no typed window, no price-level field, no ordering.**

### Field 3 — CANONICAL INTERPRETATION — ✅ MEASURED
- **Intended canonical concept:** construct and **retain** a price level pair (range high, range low)
  from a taught clock window, as a **persistent reference** later conditions test against.
- **Assigned canonical family:** `WAIT_STRUCTURE`.
- 🛑 **NO FAMILY IN THE `14`-VALUE VOCABULARY MEANS "CONSTRUCT AND RETAIN A PRICE LEVEL FROM A CLOCK
  WINDOW"** — the same vocabulary gap ROW 1 hit, reached from a different direction.

### Field 4 — BINDING RESULT — ✅ MEASURED
**Bound, no refusal:** `primitive=structure_engine.compute_structure_state`, `approximation=True`,
`executed=True`, `reason=None`.
🛑 **AND PROBE B ALREADY EXPLAINS WHY IT BOUND: THE TEXT WAS NEVER CONSULTED.** `WAIT_STRUCTURE` binds
to the structure engine **by family label**; the same paragraph typed `WAIT_BIAS` would have bound to
the regime classifier instead. **The bind is a dispatch, not a match.**

### Field 5 — ENGINE CAPABILITY — ✅ MEASURED AT THE DECLARED CONTRACT
`[MEASURED HERE, `src/engine/context/structure_engine.py:210-215`]`
```python
def compute_structure_state(exec_bars, htf_bars, htf_bias=None, lookback_swings=20) -> StructureState | None
```
**No session parameter. No clock parameter. No range-window parameter.**
`[MEASURED HERE, the `StructureState` dataclass, `:94-115` — every field enumerated]`:
`bos_recent · bos_direction · choch_recent · choch_direction · mss_recent · mss_direction ·
mss_displacement_atr_mult · displacement_active · premium_discount_zone · htf_bias_aligned ·
last_break_direction · last_break_age_bars · swing_high · swing_low · computed_at_bar_idx`.
🛑🛑 **NOT ONE FIELD IS AN OPENING RANGE.** The primitive detects **break-of-structure / change-of-
character / market-structure-shift on swing pivots.**
🛑 **THE NEAREST NEIGHBOUR IS THE TRAP THE FRAMEWORK NAMES BY NAME:** `swing_high` / `swing_low` are
*"most-recent confirmed swing high/low price"* — **derived from pivot detection over `lookback_swings`
bars, not from a clock window.** They are a plausible-looking stand-in for *"opening range high/low"*
that is **constructed from different inputs and means a different thing.** Framework, verbatim:
*"If a neighboring detector responds but computes different semantics, classify it as identity failure,
not support."*
⚠️ **SCOPE: measured at the DECLARED CONTRACT (signature + dataclass fields), not by executing it on
candles.** *What execution would add:* observed values. *What it would not change:* **there is no field
for the primitive to put an opening range in.** ★ **A missing output field is a stronger absence than a
zero-valued one.**

### Field 6 — FINAL CAUSAL CLASSIFICATION — ⚠️ **PRODUCED, NOT CERTIFIED** (`R-723 §2`)
- **PRIMARY BLOCKER (proposed): `ENGINE_PRIMITIVE_WRONG_IDENTITY`.** A range-construction rule is
  dispatched to a swing-structure detector that has no opening-range output, and the result is recorded
  as `bindable=True, executed=True`.
- **SECONDARIES:** `CANONICAL_TERM_UNRESOLVED` (no family carries the concept) ·
  `PARAMETER_SCHEMA_MISMATCH` (prose in, no typed window) · `TEMPORAL_MODEL_COLLAPSED` (the taught
  *retain-and-test-later* reference has no carrier).
- 🛑 **THE POINT OF THIS ROW, AND IT IS WORSE THAN ROW 1'S:** ROW 1 is a **refusal** — visible, counted
  as `UNBOUND`, safe. **ROW 2 is a SILENT SUBSTITUTION** — it passes every mechanical check, is counted
  as executed, and the only signal that anything is wrong is the `approximation=True` flag, **which does
  not say WHICH concept was substituted or how far off it is.**
  ★★★★★ **`AN UNBOUND CONDITION COSTS YOU A STRATEGY. A WRONGLY-BOUND ONE COSTS YOU A BACKTEST YOU
  BELIEVE.`**
- ✅ **AND THIS MEASURES THE HYPOTHESIS `AR-806 §2` REFUSED TO ASSERT** — for **this one row**, the
  type-dispatch mechanism is confirmed as the reason a semantically unrelated primitive was bound.
  🛑 **STILL NOT GENERALISED: `1` of the `9` `APPROXIMATED` rows is now traced. The other `8` are
  UNTRACED and I do not claim them.**

### ROW 2 — PROBE STATUS
| probe | status |
|---|---|
| **A — extraction** | ⚠️ **ARTIFACT-SIDE ONLY** — and it now has a concrete unresolved cost: the `"5,5"` vs `5/15/30` discrepancy |
| **B — binder** | ✅ **DISCHARGED BY ROW 1's RUN** — the 14-family enumeration already covers this text and this family |
| **C — engine** | ✅ **RUN AT THE DECLARED CONTRACT** — signature + full field enumeration; execution-on-candles not run and stated as such |

## ROW 3 — 🛑🛑🛑 **THE ONLY `BINDS` CONDITION IN THE ENTIRE GOLDEN SLICE** — ✅ TRACED

**CONDITION:** `INVALIDATE:so-you-ll-see-there-would-be-something-c#10`
**Census verdict:** **`bind_status=BINDS`** · `bindable=True` · `executed=True` · **`approximation=False`** ·
`binds_to="structural_stops.compute_structural_stop"` · `role="invalidation"` · `unbound_reason=None`.
★ **WHY THIS ROW WAS WORTH JUMPING TO:** the census records `n_taught_binds = 1` for this spec. **This is
that 1.** It is the campaign's entire concrete binding on the golden slice, and it is the only row
carrying `approximation=False` — **an explicit EXACTNESS claim.** **`1` of `1` `BINDS` rows now traced.**

### Field 1 — SOURCE — ⚠️ artifact-side only
> *"So, you'll see there would be something called a half range stop. And that's a stop below this
> halfrange mark."*
**Taught concept:** the stop sits at the **midpoint of the opening range** — a level derived
arithmetically from the OR high/low (the spec's own confluence steps define range value and half range).

### Field 2 — EXTRACTED — ✅ prose only, as everywhere else (`strategies[0].stop`).

### Field 3 — CANONICAL — ✅ family `INVALIDATE`; intended concept = **a stop at a taught, arithmetically
derived price level.**

### Field 4 — BINDING — ✅ bound, `approximation=False`, no refusal.

### Field 5 — ENGINE CAPABILITY — 🛑🛑 **MEASURED, AND IT IS A DOUBLE FAILURE**
**(a) IT COMPUTES A DIFFERENT LEVEL** `[MEASURED HERE, `structural_stops.py:194-219`]`:
```python
def compute_structural_stop(direction, entry_price, point_value, atr, tick_size, symbol="MES",
                            nearest_ob_below=None, nearest_ob_above=None,
                            nearest_fvg_below=None, nearest_fvg_above=None,
                            nearest_swing_low=None, nearest_swing_high=None,
                            sweep_wick_low=None, sweep_wick_high=None, ...)
    """For LONGS: stop goes BELOW structure (sweep wick > OB bottom > FVG bottom > swing low) ..."""
```
**The stop is chosen from a priority ladder of ICT structural levels plus a tick buffer. There is NO
parameter that can carry a half-range level, and no arithmetic on any taught range.**
**(b) AND THE VALUE IS NEVER USED** `[MEASURED HERE, `spec_condition_compiler.py:1802-1806`, the
implementation's own comment]`:
> *"Real (not merely documented) reuse of the INVALIDATE primitive: for every firing bar, compute the
> structural stop `compute_structural_stop` WOULD place, using the nearest confirmed swing low/high
> before that bar. **This is trace/provenance ONLY — the value is recorded, never used to gate entries
> or drive the actual exit (framework-owned).**"*
Corroborated by the dispatch table `[`:115`]`: `"structural_stops.compute_structural_stop": "_h_non_gating",  # INVALIDATE`
and by the inputs actually supplied `[`:1811-1827`]` — `detect_swings(...)` → `_nearest_swing_before(...)`,
i.e. **swing pivots, exactly the substitution ROW 2 found, reappearing here.**

### Field 6 — CLASSIFICATION — ⚠️ **PRODUCED, NOT CERTIFIED** (`R-723 §2`)
- **PRIMARY (proposed): `ENGINE_PRIMITIVE_WRONG_IDENTITY`** — a taught arithmetic level is bound to a
  structural-level selector that cannot express it.
- **SECONDARY: `PARAMETER_SCHEMA_MISMATCH`** — the half-range level has no parameter to travel in.
- 🛑🛑🛑★★★★★ **AND THE FINDING THAT OUTRANKS THE CLASSIFICATION: `THE GOLDEN SLICE'S ONLY BINDING IS
  BOTH A DIFFERENT CONCEPT AND NON-GATING.` It computes a swing-based stop rather than the taught
  half-range stop, and by the implementation's own words the number it produces is written to a trace
  file and never drives an exit.**
- ⚠️ **WHAT THIS DOES AND DOES NOT DO TO `n_taught_binds = 1`:** the count is **arithmetically correct**
  — one condition has `bind_status == BINDS`. **What is now measured is what that `1` IS.** ★★★★★
  **`THE NUMBER WAS NEVER WRONG; IT WAS NEVER A MEASURE OF WHAT ANYONE READ IT AS.`**
- ⚠️ **AND `approximation=False` IS THE PART THAT SHOULD ALARM A READER MOST:** the one row claiming
  **exactness** is the one substituting both the concept and its effect. `[`spec_family_bindings.py:67`]`
  justifies it as *"direct reuse of the audited stop-placement primitive"* — **true about the CALL, and
  silent about the SEMANTICS and the GATING.** ★★★ **`REUSING AN AUDITED PRIMITIVE IS NOT THE SAME AS
  COMPUTING THE AUDITED CONCEPT.`**

### ROW 3 — SCOPE AND LIMITS
- **MEASURED at the declared contract and the implementation's own executable comment; NOT executed on
  candles.** *What execution would add:* the specific recorded value. *What it would not change:* the
  ladder has no half-range input, and `_h_non_gating` is the dispatch entry.
- ✅ **`1 / 1` `BINDS` rows traced — this category is COMPLETE for the golden slice.**
- 🛑 **`3 / 11` conditions traced overall.** The `8` remaining `APPROXIMATED` rows are **untraced** and I
  claim nothing about them.

## PROBE A — ✅ RUN AT FULL STRENGTH (unblocked by `R-724 §2`)

**FROZEN BASELINE, IDENTITY VERIFIED BY ME rather than accepted from the ruling:**
`docs/replay-results/h1-sealed-read-frozen/SEALED-READ/transcripts/st5e-YJRfKc.txt` ·
`sha256 eaf5425387556414ffae88c9446d3e80f244e2414ee129098bc892125190d5c4` · blob `d36e688d` · **tracked** ·
`1722` words. **Matches `R-724 §2` on all three joins. Nothing fetched.**

### A-1 — ⚠️ **A CORRECTION TO MY OWN ROWS 1–3, AND IT MATTERS TO THE CLASSIFICATION**
I wrote, in ROW 1 field 2, that the extracted representation carries *"no parameters … for this condition
**or any other in the spec**."* 🛑 **THE SECOND HALF IS WRONG.** `[MEASURED HERE, frozen artifact]` the
schema **does** carry typed slots outside `entry_sequence`:
```
stop     = {"description": "...half range stop...",  "level": null}
targets  = [{"description": "...", "level": null}, {"description": "...", "level": null}]
variants = [{"description": "...9:30 a.m. Eastern to 9:35...", "variant_label": "5-minute opening range"}, ...]
```
⇒ **`level` EXISTS AS A TYPED FIELD AND IS `null`. `variant_label` EXISTS AND IS POPULATED.**
★★★★★ **THIS STRENGTHENS `PARAMETER_SCHEMA_MISMATCH` RATHER THAN WEAKENING IT, AND FOR A SHARPER REASON
THAN I ORIGINALLY GAVE: THE SLOT FOR THE TAUGHT NUMBER EXISTS, AND IT IS EMPTY. THE PIPELINE IS NOT
MISSING A PLACE TO PUT THE VALUE — IT HAS ONE AND DID NOT FILL IT.**
⚠️ **`entry_sequence` and `confluences` remain prose-only (`{action}` / `{description}`), which is what
ROWS 1–3 actually traced — so their evidence stands. Only my generalisation to "any other" was false.**

### A-2 — ✅ **WHY `level` IS `null` IS DEFENSIBLE, AND THIS IS THE EXTRACTOR BEHAVING WELL**
`[MEASURED HERE, transcript verbatim]` the lesson's numbers are **garbled in the source audio**: the range
`617.64 − 616.61 = 1.03` is spoken as **`"a dollar3"`** and again as **`"a$13 divided by two, which would
be about 52 cents"`**. **`52` cents is arithmetically consistent with `1.03`, so the TRUE value is
recoverable by inference — and the extractor did not infer it.** ⇒ **`level: null` is a REFUSAL TO INVENT
A NUMBER, not a dropped field.** ★★★ **`AN EMPTY TYPED SLOT BESIDE A GARBLED SOURCE IS THE COMPILER
DOING ITS JOB.`**

### A-3 — ✅ **WHAT THE EXTRACTOR PRESERVED — MEASURED SOURCE-SIDE, NOT ASSUMED**
| taught fact (transcript) | in artifact? |
|---|---|
| market opens `9:30 a.m. Eastern` | ✅ `entry_sequence[1]` verbatim |
| three OR variants `9:30–9:35 / 9:30–9:45 / 9:30–10:00` | ✅ `entry_sequence[1]` **and** `variants[]` with labels |
| OR high/low taken between those periods | ✅ `entry_sequence[2]` |
| range value `= high − low` | ✅ `confluences[2]` |
| half range `=` half the OR | ✅ `confluences[3]` |
| half-range **stop** below the half-range mark | ✅ `stop` |
| half-range **target** `= OR high + half range` | ✅ `targets[0]` |
| full-range target projected on the flip side | ✅ `targets[1]` |
| breakout direction `=` initial directional conviction | ✅ `entry_sequence[3]`, `[4]` |
| OR is a daily decision point, recomputed each day | ✅ `confluences[4]` |
| **the pullback permutation** (`pullback level = OR high − half range`, enter back toward the mark) | ✅ **extracted as a SEPARATE strategy `st5e-YJRfKc__s1` = `opening_range_pullback`** |
✅ **`"the 5,5 and the 30 minute OB"` IS THE TEACHER'S OWN WORDING** — artifact and transcript agree
character-for-character (`R-724 §3`, and I confirm it from the transcript myself). **The extractor is
exonerated for that string; the garble is upstream of extraction.**
⇒ 🛑 **`EXTRACTION_MISSING_REQUIRED_INFORMATION` IS REFUTED FOR EVERY FACT I CHECKED.** ⚠️ **AND
`R-724 §4`'s LIMIT IS BINDING ON ME: `ONE PRESERVED FACT IS NOT A PRESERVATION PROPERTY.` I checked the
`11` facts above; I did **not** prove the artifact is complete with respect to the whole lesson.**

### A-4 — 🛑 **WHAT THE *SOURCE ITSELF* NEVER SPECIFIES** (measured against the framework's own
OPENING-RANGE-BREAKOUT REQUIREMENTS list)
| required field | in the lesson? |
|---|---|
| breakout by **wick, touch, or close** | 🛑 **ABSENT** — *"when price breaks above the range high"*, no confirmation rule anywhere |
| **which** OR variant to trade (5 / 15 / 30) | 🛑 **ABSENT** — all three are taught as *"three different time periods to study market behavior"*; no selection rule |
| entry **expiration** | 🛑 **ABSENT** |
| immediate entry **vs** retest entry | ⚠️ **SPLIT DELIBERATELY** — breakout and pullback are taught as two setups, and the extractor split them into two strategies accordingly |
| **market scope** | ⚠️ **IMPLICITLY DEMONSTRATED ON ONE MARKET** — *"thousands of stocks"*, worked example on the S&P 500 at `616–617`. **Never says futures. Never declares itself market-agnostic.** |
| timezone | ✅ **PRESENT** — `Eastern`, with the chart example in Pacific and both stated |
| long/short symmetry | ✅ **PRESENT** — *"Do we see a breakout above or below? Whichever direction"* |
⇒ 🛑 **`UNRESOLVED_SOURCE_AMBIGUITY` IS THE CORRECT AND FINAL ANSWER FOR THE BREAKOUT-CONFIRMATION RULE
AND THE VARIANT-SELECTION RULE. The compiler must refuse them, and `R-722 §9`'s forbidden list already
names inventing defaults.** ★ **These are not compiler defects. A compiler that filled them in would be
the defect.**
⇒ ⚠️ **MARKET QUESTION (`R-722 §9`, desk-owned) — TRIGGER FIRED: this source classifies as
`IMPLICITLY DEMONSTRATED ON ONE MARKET`, and that market is EQUITIES, not futures.** **Routed to the
desk; not mine to rule.**

### A-5 — PROBE A BUDGET: `1 / 2`, succeeded first run.

---

## `REPAIR_SUFFICIENT_ALONE` — MANDATORY FIELD, ADDED RETROACTIVELY (`R-724 §5`, `§8-4`)

| row | primary blocker | `REPAIR_SUFFICIENT_ALONE` | measured reason |
|---|---|---|---|
| **ROW 1** (`WAIT_SESSION#1`) | `PARAMETER_SCHEMA_MISMATCH` | **`FALSE`** | Even a correctly typed clock window has **no canonical family to be typed as** (`14` families, none constructs a range over a taught window) **and no route to the engine** (no family declares `compute_opening_range_breakout`). Both measured. |
| **ROW 2** (`WAIT_STRUCTURE#0`) | `ENGINE_PRIMITIVE_WRONG_IDENTITY` | **`FALSE`** | Pointing this condition at a correct primitive still leaves it with **no typed window to pass** — `entry_sequence` is prose-only, measured. |
| **ROW 3** (`INVALIDATE#10`) | `ENGINE_PRIMITIVE_WRONG_IDENTITY` | **`FALSE`** | Two independent reasons: the stop ladder has **no half-range parameter**, and the handler is **`_h_non_gating`** — so even a correct level would not drive an exit. |
🛑 **ALL THREE ARE `FALSE`, AND THAT IS THE POINT OF THE FIELD `R-724 §5` MINTED:** `primary` names the
**earliest broken handoff**; this column names whether **fixing it alone would change the outcome.**
**Nowhere in this trace would it.** ★ **I proposed this as a co-primary ranking and the desk was right
that it is not one — it is a second question, and it now has its own field.**

## LANE 3 — WHO ASSIGNS `WAIT_STRUCTURE`, AND DOES IT EXAMINE MEANING? — ✅ ANSWERED

**ASSIGNER:** `src/engine/extraction/spec_producer.py`, `_classify_family` + its keyword/stem table.
🛑 **ANSWER: IT *DOES* EXAMINE MEANING. IT VALIDATES AND SEALS. ⇒ TYPE DISPATCH AT THE BINDER IS
LEGITIMATE, AND THE `AR-806` TRUST-BOUNDARY HYPOTHESIS IS *NOT* WHAT IS WRONG HERE.**
`[MEASURED HERE, `spec_producer.py:135-141`]` — **`"opening range"` is an EXPLICIT `WAIT_STRUCTURE`
stem**, sitting beside `"range" · "level" · "high of the" · "low of the" · "swing high" · "order block"`.
`[MEASURED HERE, `:129-134`, the code's own justification]`:
> *"★ DERIVED ADDITION (pin iii, disambiguated by construction): "opening range" is a named PRICE RANGE
> — two levels, a high and a low — and the family definition ALREADY carries "range", "level", "high of
> the", "low of the". **It is a level construct, not a clock window, so it belongs here.** As a 2-token
> span it also outranks and SUPPRESSES WAIT_SESSION's 1-token "opening"."*

★★★★★ **AND THIS IS THE PRECISE CAUSAL STATEMENT PHASE A EXISTS TO PRODUCE — THE CLASSIFIER'S REASONING
IS *CORRECT* AND ITS DESTINATION IS *WRONG*:**
- ✅ **The semantic judgment is right.** An opening range **is** a level construct (a high and a low), not
  a clock window. The deliberate suppression of `WAIT_SESSION` was **the right call** — and it is *why*
  ROW 1's `WAIT_SESSION` row is the only one that refused: the clock sentence kept the session family,
  the level sentences were correctly routed away from it.
- 🛑 **The destination is wrong.** `WAIT_STRUCTURE`'s attached primitive is
  `structure_engine.compute_structure_state`, which computes **market-structure EVENTS** (BOS / CHoCH /
  MSS / swing pivots) — **not level CONSTRUCTION from a window.** The family's own comment (`:126-128`)
  says it covers *"levels, BOS, FVG, order block, S/R, liquidity"* — **one family, two different
  computational kinds, one primitive.**
⇒ ★★★★★ **`THE DEFECT IS NOT A MISSING TRUST BOUNDARY. THE TAXONOMY CONFLATES "A STRUCTURAL LEVEL" WITH
"A MARKET-STRUCTURE EVENT", AND THE ONE PRIMITIVE BOLTED TO THAT FAMILY IMPLEMENTS ONLY THE SECOND.` The
classifier hands over an honest label; the label cannot carry the distinction that matters.**
⚠️ **THIS AMENDS MY OWN `AR-806 §2` READING** — I framed it as *"the text is never consulted."* **At the
BINDER that is true; at the CLASSIFIER it is false.** ★ **The text is consulted once, correctly, and
then the answer is thrown away by a mapping that cannot express it.**
✅ **AND THE WORSE VERSION WAS ALREADY FIXED** `[MEASURED HERE, `:172-179`]`: `WAIT_STRUCTURE` used to be
the `_UNMATCHED_DEFAULT_FAMILY` sink — *"35 of tier-A's 50 WAIT_STRUCTURE rows — 70% of that"* family —
and the comment records why it was worse: it *"silently promoted a no-evidence condition into a family
with a real primitive, where it bound with approximation=True — an np.ones pass-through, i.e. UNGATED
and LOOSER than taught."* **Replaced by `UNTYPED`.** ★★★ **A previous seat already fought this exact
species and won; ROW 2 is the residue that a sink-removal could not reach, because ROW 2's label is
EARNED, not defaulted.**

## LANE 5 — REPOSITORY-WIDE REACHABILITY OF AN OPENING-RANGE CONSTRUCTOR — ✅ MEASURED, AND IT CHANGES THE PICTURE

🛑 **NOT REACHABLE FROM THE SPEC-BINDING PATH** `[MEASURED HERE, `spec_condition_compiler.py:50-58`]`:
the compiler imports from `indicators.core` — **but only `compute_atr, compute_ema`** (`:52`).
**`compute_opening_range_breakout` is not imported, and no `FAMILY_META` primitive names it.**
✅🛑 **BUT IT IS REACHABLE FROM A *DIFFERENT* COMPILATION SURFACE, AND I DID NOT KNOW THIS SURFACE
EXISTED** `[MEASURED HERE]`:
- `config.py:304-306` — *"Phase 9: opening_range_breakout shipped atomically with
  `compute_opening_range_breakout()` … **Emits `orh_{range_minutes}m`, `orl_{range_minutes}m`,
  `or_range_{range_minutes}m` columns.**"*
- `extraction/topology_producer.py:78` — *"or `"close >= orh_15m"`. Prose conditions ("buy the pullback",
  "close above the …"*
- `extraction/compile_lints.py:131` — `comparator: Optional[str] = None  # raw comparator text, e.g.
  "close>orh_15m"`
⇒ ★★★★★ **THERE ARE TWO COMPILATION SURFACES. THE FAMILY-BINDING SURFACE SPEAKS IN PROSE → FAMILY →
PRIMITIVE AND CANNOT REACH THE OPENING RANGE. A COMPARATOR/TOPOLOGY SURFACE SPEAKS IN INDICATOR COLUMN
NAMES AND *CAN* ADDRESS IT DIRECTLY AS `orh_5m` / `orl_5m` / `or_range_5m`.** **The taught concept is
not merely computable — it is ALREADY ADDRESSABLE, by name, on a surface this trace had not looked at.**
⚠️ **SCOPE, AND IT IS TIGHT:** `[MEASURED]` the column names and the comparator form exist in those three
files. 🛑 **`UNMEASURED`: whether the golden slice's conditions can be routed onto that surface, whether
the topology producer runs for tier-A specs at all, and whether those comparator strings are ever
produced from prose.** *What would measure it:* trace `topology_producer` on this spec. **NOT DONE, and
I am not claiming a route exists — only that the ADDRESS does.**
🛑 **AND I AM NOT PROPOSING THIS AS THE REPAIR. Phase A is diagnosis** (`R-724 §8`), and *"the address
exists"* is a very long way from *"the route works"* — that gap is exactly where this campaign has been
burned before.
**POSITIVE CONTROLS FOR BOTH ABSENCE CLAIMS:** the import search returned `9` real
`src.engine.indicators.*` imports for the spec compiler; the tree-wide search shape returned real
`compute_atr` call sites in `anti_setups/miner.py` and `archetypes/classifier.py`.

## LANE 2 — ROW 2's FIVE ORDERED CONTROLS — ✅ ALL RUN. **`ENGINE_PRIMITIVE_WRONG_IDENTITY` IS NO LONGER A SIGNATURE ARGUMENT; IT IS EXECUTED.**

### C1–C3 — does binding identity move with the PROSE or with the LABEL?
| input | primitive returned | bindable | approx |
|---|---|---|---|
| label `WAIT_STRUCTURE` · **taught prose** | `structure_engine.compute_structure_state` | `True` | `True` |
| label `WAIT_STRUCTURE` · **unrelated trading prose** (*"bearish order block after a liquidity sweep"*) | `structure_engine.compute_structure_state` | `True` | `True` |
| label `WAIT_STRUCTURE` · 🛑 **NOT ABOUT TRADING AT ALL** (*"the capital of France is Paris and rainfall is seasonal"*) | `structure_engine.compute_structure_state` | **`True`** | `True` |
| **label `WAIT_BIAS`** · taught prose unchanged | `bias_engine.classify_institutional_regime` | `True` | `True` |
⇒ **identity moved with PROSE: `False` · with NON-TRADING PROSE: `False` · with LABEL: `True`.**
🛑 **A sentence about French geography binds `bindable=True` to the market-structure engine.**

### C4–C5 — 🛑🛑🛑 **THE DECISIVE ONE: MUTATE THE TAUGHT OPENING RANGE AND THE BOUND PRIMITIVE DOES NOT MOVE**
Deterministic candles, no randomness. **Bar 0 IS the taught window, built to the lesson's OWN worked
numbers** (`OR high 617.64` / `OR low 616.61`), then 59 zig-zag bars so the swing detector has real
pivots. **Independent reading of the taught rule** (computed outside any engine code): OR high/low = the
high/low established in the first window.

| run | independent OR reading | primitive `swing_high` / `swing_low` | other outputs | reports the taught OR? |
|---|---|---|---|---|
| **as taught** | `617.64` / `616.61` | `619.4999999999986` / `618.1649999999986` | `bos=False choch=False mss=False zone=discount last_break=None` | **`False`** |
| 🛑 **OR MUTATED `±12` pts** (`629.64` / `604.61`, a **`24`-point wider** opening range) | `629.64` / `604.61` | **`619.4999999999986` / `618.1649999999986` — BYTE-IDENTICAL** | **every field identical** | **`False`** |

✅ **POSITIVE CONTROL — THE PRIMITIVE IS ALIVE AND ITS OUTPUT CAN MOVE:** scaling **all** highs by `1.05`
changes `swing_high` `619.50 → 650.47`. ⇒ **The null above is a measurement, not a dead rig.**

★★★★★ **`THE TAUGHT QUANTITY CAN BE CHANGED BY 24 POINTS AND THE PRIMITIVE BOUND TO IT RETURNS THE SAME
ANSWER TO EVERY FIELD. THAT IS NOT A LOOSE APPROXIMATION — IT IS INDEPENDENCE.`** ⇒ **ROW 2's
`ENGINE_PRIMITIVE_WRONG_IDENTITY` is now supported by EXECUTION, discharging `R-724 §8-2`'s objection
that it rested on a signature-and-fields reading.**

⚠️ **THE HONEST ALTERNATIVE READING, STATED BECAUSE A SKEPTIC WOULD RAISE IT AND IT DESERVES AN ANSWER:**
bar `0` sits at the series edge, and a swing detector may structurally never designate an edge bar a
pivot — so *"swing_high ≠ OR high"* could be an artefact of my construction rather than of the concept.
**Two things answer it.** (1) **The taught rule does not care whether the OR high is a pivot** — it is
*the high of the first window*, by definition, so a primitive that can only report pivots cannot express
it regardless of position. (2) **The mutation control does not depend on the edge argument at all:**
widening the range by `24` points changed **no field**, including `premium_discount_zone`, which is a
whole-series quantity. ⚠️ **`UNMEASURED`: the same experiment with the OR window placed mid-series.**
*What it would add:* closes the edge objection completely. **Not run; the classification does not rest on
it, and I would rather name it than have it found.**

### LANE 2 — BUDGET: `1 / 2`, succeeded first run. **DIAGNOSIS ONLY — no production path, no repair.**

## WHAT THIS FILE DOES **NOT** ESTABLISH
1. **No cause is established.** Two of three probes are unrun; `UNVERIFIABLE` stands.
2. **Nothing about the other 10 specs**, and nothing about the other 10 conditions of this spec.
3. **Nothing about `runtime-production`** — unmeasured and out of scope.
4. **No repair is proposed or performed.** Phase A is diagnosis; repair is Phase B and is not authorized.
5. **The `9` `APPROXIMATED` conditions are untouched** — this row explains the single `UNBOUND` one only.
