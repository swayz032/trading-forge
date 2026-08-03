# GRADE — GOLDEN SLICE `st5e-YJRfKc__s0`: "ZERO LOAD-BEARING ROWS CAN REACH A CONCRETE PHASE-1 PASS"

**Grader:** accuracy-validator (independent; doer ≠ grader)
**Date:** 2026-08-03
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**HEAD PINNED:** `6cc33ed62840b2d61ddd01894e43549fddf17557` (pinned before first measurement; re-checked at write time)
**Subject:** the ADVISOR DESK's synthesis of AR-712 / AR-713.

> **CLAIM UNDER GRADE, VERBATIM:** *"The ratified golden slice `st5e-YJRfKc__s0` (opening_range_breakout) has ZERO load-bearing rows that can reach a concrete Phase-1 PASS by any currently available honest route."*

---

## ★ VERDICT

| Sub-claim | Status | Band | Basis |
|---|---|---|---|
| **S1** — 11 load-bearing rows, 9×WAIT_STRUCTURE + 1×INVALIDATE + 1×WAIT_SESSION | **CONFIRMED** | 8 | MEASURED HERE, live compile; arithmetic reconciled; join key matched |
| **S2** — the 10 WAIT_STRUCTURE/INVALIDATE rows cannot pass (ii) whatever they bind to | **CONFIRMED (mechanism caption imprecise)** | 7 | MEASURED HERE + 2 positive controls |
| **S3** — WAIT_SESSION is the slice's only family-eligible row | **CONFIRMED** | 8 | MEASURED HERE over all 14 families |
| **S4** — three taught windows, 6 clock tokens, anchors [570,575,585,600] | **CONFIRMED** | 8 | MEASURED HERE, verbatim token parse |
| **S4** — *"approximation=False cannot be earned without the campaign making a selection"* | 🛑 **REFUTED** | — | MEASURED HERE — Test D |
| **S5** — THEREFORE zero load-bearing rows can PASS | ✅ **CONFIRMED** | **7** | 2 non-overlapping paths + 640-combination exhaustion + 4 positive controls |

### S5 = **CONFIRMED**, at band **7 VERIFIED** — *and the reason it is true is not the reason the desk gives.*

🛑🛑🛑 **THE HEADLINE: S5 IS TRUE BY LEXICAL ACCIDENT, NOT BY A FIDELITY GUARANTEE.** The golden slice
is blocked because its educator happened to say *"9:30 a.m. Eastern"* instead of *"the NY AM session"*.
**MEASURED HERE (Test D): delete all three taught windows and replace the row text with the bare string
`"ny am session"` — the row reaches `(ii) PASS`, `approximation=False`, bound to `[420,600)`.** A row that
teaches NO clock at all passes; the row that teaches THREE exact clocks fails. **The gate never compares
the bound window to the taught text.** See **F-1**.

---

## 1. LINEAGE DECLARATION (mandatory — read before weighing this grade)

**I am not a clean-room grader on this subject.** Earlier the same day (2026-08-03) I graded AR-704's
claim that `09:30-09:35 ET` is *"UNREPRESENTABLE / BLOCKED"* on this same slice, and **CONFIRMED** it —
receipt at `docs/replay-results/h1-battery/session-window-representability-grade-2026-08-03.md`.

Two consequences I disclose rather than manage:

1. **A confirmation bias runs toward CONFIRMING S5**, because S5 is a superset of a claim I already
   confirmed. My brief ordered me to default to REFUTED if uncertain; I have instead defaulted to
   *measured*, and I record below the four independent refutation attempts that FAILED and the one
   that SUCCEEDED (S4's mechanism).
2. **F-1 below is my own prior finding, re-derived and now WIDENED.** My prior receipt raised
   ("F-1 HIGH: the PINNED GUARD refusing clock tokens sits ONLY on the DEFAULT-OFF route") and left as
   **NOT DONE: "the real row's object text (hinge for F-1)."** That hinge is closed here, in §5.
   A grader promoting its own prior finding must be read with that in mind.

**Everything below was re-derived from HEAD artifacts. No number is carried forward from the prior receipt.**

---

## 2. BRIEF DEFECTS (a restriction/error in the brief is a hole in the result — named, not worked around)

| # | Defect | Effect |
|---|---|---|
| B-1 | Brief gives the instrument path as `forensics/compile_fidelity.py`. **No such file.** Real path: `src/engine/forensics/compile_fidelity.py`. | None — located by grep. `~line 503` was exact. |
| B-2 | Brief's rule of evidence says *"a census that says 'all flags off (legacy column)' is not evidence about default behaviour."* **Inverted as written:** all-flags-off **IS** the default (`family_meta_enforced()` → `False` with no env var — MEASURED HERE). | I did not rely on the inversion. The **real** trap in that scope line is different and I state it in §4. |
| B-3 | Brief asserts the disjunction blocks *"BEFORE the binding is consulted."* **Order is wrong** (§3.2). | Immaterial to the verdict; the caption is still a claim and is graded. |
| B-4 | No pinned hash supplied for a shared tree with a live worker seat and 89 dirty paths. I pinned it myself. | HEAD did not move during this grade (re-checked). |

---

## 3. WHAT I MEASURED

### 3.1 Path A — live FAMILY_META interrogation at HEAD `[MEASURED HERE]`

Read-only import; no file touched. All 14 families:

| family | base_apx | enforced_apx | **`enforced_honest_approximation()`** | executed |
|---|---|---|---|---|
| **WAIT_SESSION** | False | None | **False** | True |
| **WAIT_STRUCTURE** | True | None | **True** | True |
| **INVALIDATE** | False | **True** | **True** | True |
| EXIT_HINT | False | None | **False** | **False** |
| RESET / EXCEPTION | False | None | **False** (both `unsupported=True`) | True |
| VERIFY_STRUCTURE, WAIT_BIAS, CONFIRM_DIRECTION, WAIT_RETEST, FILTER, WAIT_CONFIRMATION, ENABLE_ENTRY, ENTER | — | — | **True** (all 8) | True |

- **Families with `enforced_honest_approximation() == False`: exactly 4** — `WAIT_SESSION`, `EXIT_HINT`, `RESET`, `EXCEPTION`.
- **Families with `executed == False`: exactly 1** — `EXIT_HINT`.

★ **S2's outcome is right; its stated mechanism conflates two different fields.** WAIT_STRUCTURE reaches
`True` via `base_approximation=True` (`enforced_approximation is None`). INVALIDATE reaches `True` via
`enforced_approximation=True` — **its `base_approximation` is `False`**. Same verdict, different lever;
a repair aimed at "the family term" must touch two different fields.

### 3.2 The executable line `[MEASURED HERE — read, not summarized]`

`src/engine/forensics/compile_fidelity.py:529-532`:

```python
    meta = FAMILY_META.get(binding.type)
    if meta is None:
        return bool(binding.approximation)
    return meta.enforced_honest_approximation() or bool(binding.approximation)
```

Python `or` evaluates left-to-right, so the family term **does** short-circuit. **But the brief's
"before the binding is consulted" is false:** `_check_concretely_bound` consults `binding.bindable`
(`:543`) and `binding.executed` (`:545`) **first**; the disjunction is the **third** test (`:547`).
For the INVALIDATE row the binding is fully consulted and *passes* both earlier tests — it is
`bindable=True, executed=True, approximation=False` — and is then blocked by the family term alone.

### 3.3 Path B — live Phase-1 gate execution `[MEASURED HERE]`

**This is a genuinely non-overlapping second path.** The desk's number comes from
`docs/replay-results/h1-battery/tier_a_compile_census.py`. I did **not** re-run it. I compiled the
extraction with `spec_producer.produce_spec_artifact` and ran the **production gate**
`compile_fidelity.run_leg_a_phase1` — the instrument that actually issues the verdict.

**ARM 1 — BASELINE, HEAD, default flags: `rows=11 · PASS=0 · BLOCK=11`.**
Every one of the 11 rows carries `load_bearing=True` (key **present**, value `True`,
`non_lb_disposition=None`), `ii_applicable=True`, and fails on exactly `['ii']`.

| row | family | (ii) failure reason |
|---|---|---|
| 1 | WAIT_SESSION | `unbound taught condition (no_recognized_session_keyword); §6a unenforced` |
| 9 rows | WAIT_STRUCTURE | `bound to an approximation … : 'structure_engine.compute_structure_state'` |
| 1 | INVALIDATE | `bound to an approximation … : 'structural_stops.compute_structural_stop'` |

★ **Note the WAIT_SESSION row fails EARLIER than the desk's model implies** — on `bindable=False`,
never reaching the approximation test at all. S3 correctly calls it *family-eligible*; it is
nonetheless *route-ineligible*, and that distinction is the whole of F-1.

### 3.4 POSITIVE CONTROLS — "0 PASS" is worthless without a path to green `[MEASURED HERE]`

In-memory `dataclasses.replace` on the imported module object. **No source file modified.**

| arm | mutation | result |
|---|---|---|
| **ARM 2** | `WAIT_STRUCTURE.base_approximation := False` | **9 rows flip to PASS** |
| **ARM 3** | `INVALIDATE.enforced_approximation := False` | **INVALIDATE flips to PASS** |
| **ARM 4** | restore | **identical to ARM 1** (`PASS=0`), no contamination |
| **Test C** | plant a session keyword | **WAIT_SESSION flips to PASS** (§5) |

**The harness emits PASS on all three families under mutation. The baseline zero is a real block,
not a dead instrument.**

---

## 4. THE SCOPE-FIELD TRAP (read before the value fields — campaign law)

`tier-a-compile-census.json` `scope_line`:

> `corpus = tier-a certified clean strategies (n=11 …) · extractions = persisted sealed-read WD phase_b · compiler = src/engine/extraction/spec_producer.py · binder = compile_binding_plan with ALL FLAGS OFF (legacy column) · no bars, no battery, no survivor arithmetic`

★ **The real trap is not the one the brief names.** All-flags-off IS the default. The trap is that the
census's per-row `approximation` field is the **legacy/binding-level** value, whereas check (ii) anchors
to the **flag-independent honest** value. **They disagree on the INVALIDATE row**: the census records
`"approximation": false, "bind_status": "BINDS"` — which reads as a clean row — while the gate blocks it.
Anyone reading `bind_status` as a proxy for (ii) will mis-predict that row. `[MEASURED HERE — census
row 10 vs ARM 1 row 11.]`

**Provenance join CLOSED.** The census's `extraction_source` points at a **temp scratchpad of a different
session** (`…d96dba1d…/scratchpad/SEALED-READ/phase_b`) which I cannot read. I closed it by content
instead of by path — `extraction_sha256` in the census is
`7868524ba4401755edb26a4db4aa1699e0c4b5ad0cc422e58a5bbf759d62ab99`, and **both** repo copies hash
**identically**:

```
7868524ba4401755edb26a4db4aa1699e0c4b5ad0cc422e58a5bbf759d62ab99  docs/replay-results/h1-sealed-read-frozen/SEALED-READ/phase_b/st5e-YJRfKc__s0.json
7868524ba4401755edb26a4db4aa1699e0c4b5ad0cc422e58a5bbf759d62ab99  docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json
```

The census and I graded the same bytes.

---

## 5. 🛑🛑🛑 F-1 (HIGH) — `approximation=False` IS GRANTED BY KEYWORD MEMBERSHIP, NEVER BY FIDELITY

**Severity:** HIGH (false-green class / silent fidelity failure)
**Status:** **OPEN at HEAD.** This is the one sub-claim I REFUTED.

**S4 claims:** *"`approximation=False` cannot be earned without the campaign making a selection on the
educator's behalf."*

**Reality `[MEASURED HERE]`.** The selection is irrelevant. The gate never looks at the taught windows.

**Test C — prepend a keyword to the REAL, UNMODIFIED row text (all three taught windows still present):**

| planted keyword | WAIT_SESSION verdict | scope line emitted |
|---|---|---|
| `ny am` | **PASS** | `name-route|zone=ny_am|window=[420,600)` |
| `new york am` | **PASS** | `name-route|zone=ny_am|window=[420,600)` |
| `london session` | **PASS** | `name-route|zone=london|window=[120,300)` |
| `silver bullet` | **PASS** | `name-route|zone=silver_bullet|window=[180,240),[600,660),[840,900)` |

★★★ **Test D — the discriminating fixture. DELETE every taught window; set the text to the bare
string `"ny am session"`:**

> **`WAIT_SESSION -> PASS | ii.passed=True | concretely bound honest approximation=False -> 'session_windows' [name-route|zone=ny_am|window=[420,600)]`**

**A row that teaches NO clock time at all earns `approximation=False`. The row that teaches THREE exact
clock ranges earns `BLOCK`.** `approximation=False` is granted by membership in an 18-phrase keyword
list, exactly as R-655 §3 diagnosed, and **never** by demonstrated fidelity.

**The fidelity error this certifies as honest** `[MEASURED HERE — `_REAL_ZONE_INTERVALS` at
`spec_family_bindings.py:1863`]`:

| taught window | minutes | EXACT canonical match | merely CONTAINED BY | error if bound to `ny_am` |
|---|---|---|---|---|
| 5-minute `[570,575)` | 5 | **NONE** | `ny_am` | **36× too wide**, starts 150 min early |
| 15-minute `[570,585)` | 15 | **NONE** | `ny_am` | 12× too wide |
| 30-minute `[570,600)` | 30 | **NONE** | `ny_am` | 6× too wide |

`ny_am = [420,600)` = 07:00–10:00 ET, 180 minutes. **No taught window equals any canonical zone; all
three are merely *contained by* `ny_am`.** Note `[570,600)` shares `ny_am`'s **end** (600) but not its
start — a near-miss that would read as a match to anyone eyeballing the numbers.

**Blast radius.** Any spec whose session row contains one of the 18 phrases certifies
`approximation=False` for a window up to 36× the taught span. **The golden slice is protected only by
its educator's word choice.** A second educator teaching the identical 5-minute opening range while
saying *"the NY AM session"* **passes (ii)** with a 180-minute window. The desk's own R-657 §1 already
recorded that clock-teaching spans three unrelated sources — so the exposed population is not
hypothetical.

**Fix point:** `src/engine/forensics/compile_fidelity.py:547` (`_honest_approximation` has no fidelity
term) with the grant issued at the name-route in `spec_family_bindings.py`. The built cure —
`resolve_exact_clock_span`, which grants `approximation=False` only when the primitive's executed window
**equals** the parsed taught span — is **REVERTED and not currently available** (§6).

**Repro:**
```
python -c "import sys,json,copy; sys.path.insert(0,r'C:/Users/tonio/Projects/wt-h1-wave4-20260712');
from src.engine.extraction.spec_producer import produce_spec_artifact
from src.engine.forensics import compile_fidelity as CF
raw=json.load(open(r'C:/Users/tonio/Projects/wt-h1-wave4-20260712/docs/replay-results/h1-sealed-read-frozen/SEALED-READ/phase_b/st5e-YJRfKc__s0.json',encoding='utf-8'))
s=copy.deepcopy(raw['strategies'][0]); s['entry_sequence'][1]['action']='ny am session'
seal=CF.run_leg_a_phase1(produce_spec_artifact(s,video='v',transcript_chars=9386))
print([(r.type,r.row_verdict,[c.reason for c in r.checks if c.code=='ii']) for r in seal.rows if r.type=='WAIT_SESSION'])"
```

**Why this does NOT refute S5:** the honest route must preserve what the educator taught. Editing the
row text to insert a keyword is fabrication, not a route. **S5 survives — but its truth is an accident
of vocabulary, and the desk should not bank integrity credit on it.**

---

## 6. REFUTATION ATTEMPTS THAT FAILED (the four that keep S5 standing)

### R-1 — Exhaustive flag-space sweep `[MEASURED HERE]` — **FAILED to refute**

All 7 binding-relevant booleans × 5 `TF_ROLE_DEMOTION_MODE` values = **640 combinations**:
`TF_FVG_IDENTITY_ENABLED`, `TF_LEVELZONE_ROUTING_ENABLED`, `TF_LEVELZONE_RESOLVER_ENABLED`,
`TF_COMPOSITION_BUNDLE_ENABLED`, `TF_OR_BRANCHES_ENABLED`, `TF_SESSION_ROLE_RESOLVER_ENABLED`,
`TF_FAMILY_META_ENFORCED`.

> **`COMBINATIONS RUN: 640` → histogram: `(11 rows, 0 load-bearing PASS, 0 non-LB PASS, BLOCK) -> 640`. Uniform. No exceptions raised.**

**Liveness control (or the sweep would be vacuous):** `family_meta_enforced()` returns `True` with the
flag on and `False` with it off **within the same process** → readers are **uncached**, the sweep really
did vary the system.

### R-2 — The `(ii)-not-applicable` auto-PASS route `[MEASURED HERE]` — **FAILED to refute**

`ii_applicable = load_bearing and not _is_provenance_only(ctype, binding)` (`:462`). A **load-bearing**
row whose family has `executed=False` receives **`(ii) PASS — "not applicable"`** (`:467`) and, with no
other failing check, `row_verdict = PASS`. This is a real, undocumented PASS route the sub-claims never
mention. It is **unreachable on this slice, and on any slice**, two ways:

1. **Only `EXIT_HINT` has `executed=False`** (§3.1), and
2. **`grep -c "EXIT_HINT" src/engine/extraction/spec_producer.py` = `0`** — the compiler **never emits
   an EXIT_HINT row for any input.**

Row arithmetic confirms the closure: 5 `entry_sequence` + 5 `confluences` + 1 `stop` = **11 = rows
observed**; the slice's **2 `targets` compile to ZERO rows**.

### R-3 — Non-load-bearing disposition `[MEASURED HERE]` — **FAILED to refute (but bounds the claim)**

Dispositioning all 11 rows non-LB with a written disposition: **`LB-PASS=0 · nonLB-PASS=11`.**
So the seal *will* print 11 PASS rows — and **S5 is true only because of the words "load-bearing."**
A relay that drops that qualifier inverts the finding. `[Flagged: the desk's synthesis keeps the
qualifier; downstream summaries must too.]`

### R-4 — Join-key divergence `binding.type` vs `cond['type']` `[MEASURED HERE]` — **FAILED to refute**

(i) tests `cond['type'] in FAMILY_META`; `_honest_approximation` looks up `FAMILY_META.get(binding.type)`
and **skips the family term entirely** when that returns `None`. A divergence would bypass the blocker.
**Measured: 11 rows, 11 bindings, type mismatches = NONE.**

### R-5 — Is the Lane A exact-clock route live? `[MEASURED HERE]` — **CONFIRMS the revert, independently**

AR-712 built a route that would bind this exact row. R-661 accepted the worker's claim that the
"source genuinely reverted" — **an advisor checking a doer's self-report, not an independent path.**
I closed it by **live attribute introspection at HEAD**, which does not read the source at all:

- `dataclasses.fields(FamilyMeta)` = 11 fields, **`exact_clock_primitive` NOT among them**
- `hasattr(spec_family_bindings, 'resolve_exact_clock_span')` → **False**
- `hasattr(spec_family_bindings, 'exact_clock_route_stats')` → **False**

**The route is genuinely absent from the importable module.** It survives only as
`docs/designs/lane-a-exact-clock-route-2026-08-03.patch`. **"Currently available" therefore excludes it,
and S5's qualifier is doing real work.**

### R-6 — Alternative Phase-1 entry point — **FAILED to refute**

`run_leg_a` (`:868`) is the only orchestration wrapper and hard-gates on `run_leg_a_phase1`, returning
BLOCK without countersign whenever the automated leg blocks. There is no second Phase-1 verdict producer.

---

## 7. S1 AND S4 — measured, with one correction

**S1 `[MEASURED HERE]` — CONFIRMED exactly.** `{'WAIT_STRUCTURE': 9, 'WAIT_SESSION': 1, 'INVALIDATE': 1}`
from the **live compile**, and independently the same triple from the census's own `conditions[]`.
All 11 explicitly `load_bearing: True`. **No miscount, no mistype.**

★ One nuance the count hides: the census carries `load_bearing_spine`, which is **`true` for only 5 of 11**
(the `entry_sequence` rows). The forensics §0 default (`cond.get("load_bearing", True)`) makes all 11
load-bearing. **Two different fields, two different populations (5 vs 11)** — the census's own
`eligibility` block names both readings (`criterion_strict` vs `criterion_spine`) and reports
`n_eligible_strict = 0` **and** `n_eligible_spine_only = 0`. S5 holds under **both** readings.

**S4's factual half `[MEASURED HERE]` — CONFIRMED verbatim.** Row text:

> *"The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern. The 15-minute is the first 15 minutes of the market. So, from 9:30 to now 9:45. And the 30 minute is from 9:30 to 10 a.m. Eastern."*

Token parse: `['9:30','9:35','9:30','9:45','9:30','10 a.m.']` = **6 clock tokens**; distinct anchors
**{570, 575, 585, 600}** — matches `[570,575,585,600]` exactly. Three windows. **CONFIRMED.**

**S4's mechanism half — REFUTED (§5).**

★ **A lead I chased and am reporting as NOT decisive:** row 3 (`WAIT_STRUCTURE`) says *"after this **30
minute** range is over. So from 7 a.m. onwards in this case off of the Pacific Standard chart"* — 7 a.m.
PT = 10 a.m. ET = minute 600 = the 30-minute range's end. This is arguably the source **selecting** the
30-minute window for the breakout step, which would refute S4's *"the source never selects one."*
**I am not scoring it as a refutation:** it sits in a different row, is hedged *"in this case"*, and
describes the example rather than stating a rule. **It is a genuine open question for a fresh reader,
not a measurement.** `[HYPOTHESIS — flagged, not relied upon.]` It does not touch S5 either way:
`[570,600)` matches **no** canonical zone (§5), so even a settled selection binds nothing.

---

## 8. GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| Composite claim (S5) | **7** | **VERIFIED — CONFIRMED** | Live gate (Path B) + live FAMILY_META (Path A), disjoint from the desk's census; 640-combo exhaustion with liveness control; 4 positive controls; 6 refutation attempts | F-1 open; DB/battery/runtime unverified (§9) |
| S1 row census | **8** | VERIFIED | Live compile + census `conditions[]` + arithmetic reconciliation; sha256 join key | none |
| S2 family-anchored block | **7** | VERIFIED (caption imprecise) | ARM 2 + ARM 3 red-proofs | mechanism differs per family; brief's ordering claim false (§3.2) |
| S3 sole family-eligible row | **8** | VERIFIED | All 14 families enumerated live | "family-eligible" ≠ "route-eligible" (§3.3) |
| S4 taught-window facts | **8** | VERIFIED | Verbatim token parse | — |
| **S4 selection mechanism** | **2** | 🛑 **REFUTED** | **Test D** | **F-1 HIGH, OPEN** |

**Band 7 and not higher.** 7–8 is the realistic ceiling for a maintained production system; I withhold 8
because the runtime/battery/DB layers are unverified (§9) and because the claim's truth rests on a
lexical accident I can demonstrate is one input-string away from inverting. **Band 9 is unavailable**:
it requires zero open HIGHs, and F-1 is open at HEAD.

**No band was carried forward.** The desk did not state a band; I did not reconcile against one.

---

## 9. COVERAGE — what I verified, and what I did NOT

### Verified, and by which two-plus non-overlapping paths

| claim | path 1 | path 2 | path 3 |
|---|---|---|---|
| Row composition 9/1/1 | live `produce_spec_artifact` compile | census `conditions[]` (different generator) | source-object arithmetic (5+5+1) |
| FAMILY_META honest values | live method call on imported objects | executable source line read at `:593-605` | `test_compile_fidelity_leg_a.py:157` asserts the same anchor |
| 0 PASS at baseline | live `run_leg_a_phase1` | census `eligible_strict=[] / eligible_spine_only=[]` | 640-combo sweep |
| Lane A route absent | `dataclasses.fields` introspection | `hasattr` on module | patch file exists un-applied |
| Same bytes graded | sha256 of both repo copies | census `extraction_sha256` | — |

### Positive-control witnesses for every absence claim I make

| absence claim | witness that the method can fire |
|---|---|
| "0 PASS at baseline" | ARM 2 → 9 PASS; ARM 3 → 1 PASS; Test C → WAIT_SESSION PASS |
| "0 PASS across 640 flag combos" | `family_meta_enforced()` on=True/off=False in-process → readers uncached |
| "no EXIT_HINT row" | row arithmetic reconciles to 11 exactly; `grep -c` = 0 with a known-present control (`WAIT_SESSION` greps non-zero in the same file) |
| "no canonical zone equals a taught window" | the same comparator reports `CONTAINED BY=['ny_am']` — it is not returning empty for everything |
| "no type mismatches" | comparator enumerated all 11 rows and 11 bindings, printing counts, not a bare "NONE" |

### Join keys checked

- `extraction_sha256` `7868524b…` — census ≡ both repo copies (byte identity, not path identity).
- `binding.type` ≡ `cond['type']` on all 11 rows — the key `_honest_approximation` actually reads.
- HEAD `6cc33ed6…` pinned before first measurement and re-checked at write; **did not move.**

### 🛑 What I did NOT verify

1. **No database, no battery, no bars, no runtime.** Everything here is compile-time gate behaviour.
   I make **no** claim about what the strategy would do on real ES/MES data.
2. **`vi_cert` leg-level failure is MY artifact, not evidence.** I ran with `certificate=None`, so the
   leg-level `vi_cert` check fails in **every** arm including ARM 2. Row verdicts are certificate-
   independent (`_verdict_for_condition` never reads it), so the row-level findings stand — but
   **nothing here grades the (vi) provenance chain**, and the `automated_verdict=BLOCK` I printed
   must **not** be cited as evidence about the real seal.
3. **The other 10 tier-A specs.** F-1's blast radius is reasoned from the 18-keyword list and R-657 §1's
   three clock-teaching sources; I did **not** run the keyword test across the corpus. **The claim
   "other specs are exposed" is HYPOTHESIS, not measurement.**
4. **AR-712 / AR-713 as documents.** I graded the desk's *synthesis*, not the worker reports. I did not
   verify AR-712's acceptance criteria, its ablation, or the two guards it says it turned red.
5. **The `resolve_exact_clock_span` patch's correctness.** I proved it is **absent**; I did **not** grade
   whether it would work if applied.
6. **`TF_FAMILY_META_ENFORCED_PINS`** and non-`TF_` configuration. The sweep covered 7 booleans plus
   `TF_ROLE_DEMOTION_MODE`; other env/config surfaces are **UNENUMERATED**.
7. **Whether row 3 selects the 30-minute window** (§7). A semantic reading question for a fresh reader.
8. **`production_executed`** is consumed only by `family_meta_reachability_sweep.py` and tests — **never
   by the gate** `[MEASURED HERE]`. INVALIDATE's `production_executed=False` has **no** effect on (ii).
   I did not chase whether that is intended.

### Instrument faults I caught in myself

- My first grep for the instrument used the brief's path and returned nothing — **had I stopped there I
  would have published a false "file does not exist."** Law 10 again.
- `git grep --include=` is a fatal-error form (option-after-argument) that prints to stderr and yields
  **no rows**; read as a clean absence it manufactures a null. I re-ran with `-- '*.py'` pathspecs.
- I nearly reported ARM 1's `automated_verdict=BLOCK` as corroboration before noticing `vi_cert` was
  **my own missing certificate**. Recorded above as a non-finding.

---

## 10. WHAT THE DESK SHOULD DO WITH THIS

1. **The golden slice stands, and S5 may be relayed as CONFIRMED — with the qualifier "load-bearing"
   intact** (§R-3) and **with F-1 attached.** S5 confirmed is *not* a statement that the fidelity
   architecture is sound.
2. **F-1 is the finding, not S5.** The campaign's stop condition has been read as *"the architecture
   refuses clock-taught sessions."* The measurement says something worse: **it refuses clock-taught
   sessions and accepts keyword-taught ones without checking their windows at all.** A refusal that
   correlates with vocabulary rather than fidelity is not a safety property.
3. **Do not treat the reverted Lane A patch as a closed lane.** It is the only built artifact addressing
   F-1, and F-1 is open at HEAD.

---

*Grader: accuracy-validator. Independent of AR-712/AR-713 authorship. **Lineage declared in §1** — I
confirmed a subset of this claim earlier the same day and F-1 is my own prior finding re-derived and
widened. Every measurement above was re-run from HEAD `6cc33ed6…`; no value is carried forward.
No source file was modified; all mutations were in-memory on imported module objects.*
