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
- 🛑 **DOES IT COMPUTE THE TAUGHT CONCEPT? NO.** The signature admits **no start/end parameters**. There
  is **no arbitrary-window constructor and no opening-range constructor** on this surface.
- 🛑 **AND THE NEAREST NEIGHBOUR IS A WRONG-IDENTITY TRAP, MEASURED:** `NY_AM_START_MIN = 7*60`,
  `NY_AM_END_MIN = 10*60` (`:59-60`) ⇒ **`ny_am` = `07:00–10:00` ET.** It **contains** all three taught
  windows and **equals none of them** — it is `30×` the width of the `09:30–09:35` variant. Binding this
  condition to `ny_am` would return `True` for two and a half hours the teacher never included.
- **State machine required?** **YES, and it is a second gap:** the taught rule is *form the range over a
  fixed window → project its high/low → wait for a breakout*, an ordered sequence. `is_in_killzone` is a
  stateless per-bar boolean and constructs no range object. **`UNMEASURED`: whether any other engine
  surface constructs an opening range.** *What would measure it:* an import-closure search for a
  range-constructor primitive; **not yet run, and I will not assert its absence without one** — an empty
  grep is not an absence.

### Field 6 — FINAL CAUSAL CLASSIFICATION — ⚠️ **PRODUCED, NOT CERTIFIED** (`R-723 §2`)
- **PRIMARY BLOCKER (proposed):** **`PARAMETER_SCHEMA_MISMATCH`**
  — the earliest measured divergence. The teacher's rule left the source **fully specified** (three exact
  clock spans, named timezone) and arrived at the compiler as an **untyped English sentence with no
  parameter fields at all**. The binder cannot fail *or* succeed on a parameter it was never handed.
- **SECONDARIES (listed separately, deliberately not merged):**
  1. **`CANONICAL_TERM_UNRESOLVED`** — even a correctly typed clock window has no canonical form; the
     vocabulary is a closed enum of five *named* zones (field 3).
  2. **`ENGINE_PRIMITIVE_MISSING`** — `is_in_killzone` takes no window parameters; no opening-range
     constructor was found on this surface (field 5).
  3. **`TEMPORAL_MODEL_COLLAPSED`** — *(weakest of the three; flagged, not argued)* the ordered
     range→breakout sequence has no carrier in the extracted representation.
- 🛑 **WHY I AM NOT NAMING `EXTRACTION_MISSING_REQUIRED_INFORMATION`:** the information is **not
  missing** — `9:30 a.m. Eastern to 9:35 a.m. Eastern` is present verbatim in the artifact. **What is
  missing is its TYPE, not its CONTENT**, and those are different enum values. ★ **`INFORMATION THAT
  SURVIVES AS PROSE HAS BEEN PRESERVED AND NOT DELIVERED.`**
- 🛑 **WHY THIS ROW CANNOT YET DISCRIMINATE, STATED PLAINLY:** the framework's decision table requires
  PROBE B (*does a correct canonical object bind?*) and PROBE C (*can the engine compute it?*) to
  separate a canonicalization defect from an engine defect. **NEITHER HAS BEEN RUN.** Until they are,
  the ordering of my primary and secondaries is an **argued reading of static evidence, not a measured
  discrimination**, and `R-722 §4`'s `UNVERIFIABLE` stands.

### ROW 1 — PROBE STATUS
| probe | status | note |
|---|---|---|
| **A — extraction** | ⚠️ **ARTIFACT-SIDE ONLY** | the frozen source lesson is not in this tree; I compared the artifact against itself and the census, never against the lesson |
| **B — binder** | 🛑 **NOT RUN** | next action: build a test-only canonical `WAIT_SESSION` object carrying an explicit window and feed it to the real binder. **Diagnosis-only (`R-722 §5-1`); expected values COMPUTED, never hand-copied** |
| **C — engine** | 🛑 **NOT RUN** | next action: call `is_in_killzone` on deterministic timestamps inside/outside `09:30–09:35` ET and record what it can and cannot express |
| **attempt budget** | `0 / 2` on every probe | `R-648`, per-probe |

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
