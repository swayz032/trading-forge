# INDEPENDENT GRADE — PHASE A TRACE, ROWS 1–3 (`st5e-YJRfKc__s0`)

**Grader:** `accuracy-validator`, dispatched by the desk. **Doer ≠ grader:** I did not write, design, or
previously grade any artifact below, and I hold no prior lineage on this campaign's Phase A.
**Date:** 2026-08-08. **Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (`h1-wave4-sealed12-driver`).
**Method:** all work in isolated `git archive` extractions under my scratchpad. The shared tree was read
only, plus this one file. No `checkout`/`reset`/`amend`. Every plant lives in scratchpad copies; the
shared tree carries **ZERO** mutations.

---

## 0 — 🛑 PIN INTEGRITY: THE HEAD MOVED **FIVE COMMITS** DURING THIS GRADE, AND ROW 3 IS NOT AT THE PIN

`[MEASURED HERE]` The brief pinned **`9ba8dd2d`** (R-724). At first measurement HEAD was already
**`215b5123`**; at last measurement it was **`ee329b35`** — **5 commits past the pin.**

| commit | time | what |
|---|---|---|
| `9ba8dd2d` | 19:48:52 | **THE BRIEF'S PIN** — R-724. Artifact = blob `a9983df5`, **397 lines, ROWS 1–2 ONLY** |
| `215b5123` | 19:48:57 | AR-808 + **ROW 3** — blob `1ac47e2c`, 466 lines |
| `dd7d4452` | 19:51:55 | AR-809 — PROBE A run; blob `c8f5767b`, 553 lines |
| `0507ba8a` | 19:54:49 | AR-810 — lanes 3+5; blob `4fbc86f8`, 621 lines |
| `b7c987c9` | 19:57:10 | AR-811 — lane 2 executed on candles; blob `d5249a11`, 665 lines |
| `ee329b35` | 19:58:28 | AR-812 — mid-series control; artifact blob **unchanged** `d5249a11` |

🛑 **THE PIN CANNOT CARRY THE BRIEF.** **C4 grades ROW 3, and ROW 3 DOES NOT EXIST AT `9ba8dd2d`.**
AR-808 landed 5 seconds after the pin. ⇒ **I grade rows 1–3 at `215b5123`**, the earliest commit
containing all three, and I say so on every band.
✅ **JOIN KEY CHECKED:** rows 1–2 are **byte-identical** at `9ba8dd2d` and `215b5123` — `diff` is a pure
insertion `391a392,460`, **0 lines removed**. So grading at `215b5123` grades the pinned rows 1–2 verbatim.
✅ **AND ROWS 1–3 ARE BYTE-IDENTICAL FROM `215b5123` THROUGH `ee329b35`:** `diff` between the graded blob
and the HEAD blob removes **0 lines**. Everything after is **appended**. My rows-1–3 bands therefore
describe HEAD's rows 1–3 as well.
⚠️ **CONSEQUENCE, NAMED:** commits `dd7d4452`+ contain material NEW evidence (PROBE A at full strength;
row 2 executed on candles). **I did not grade it** — it postdates the brief. Two of my findings below
were independently found by the worker in that window; I say so and I did not lower a band for it.

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **C1** — WAIT_SESSION UNBOUND, refusal correct, `ny_am` 36.0× | **8** | ✅ **CONFIRMED** | census blob `23f30eb0` read + **my own** `bind_condition()` run + **my own** 1440-min execution of `is_in_killzone`; both controls reproduce (`764` TRUE / `0` unknown-zone) | "36.0× **wider**" is loose for 36.0× **as wide**; "only superset" holds under the **half-open** endpoint convention only |
| **C2** — 11/14 families → 8 primitives; type dispatch, not meaning matching | **8** | ✅ **CONFIRMED — AND UNDERSTATED** | my independent 14-family run reproduces `11`/`8`/`reason=None` **exactly**; 2nd path = census corpus (99 conditions) | ROW 2's PROBE B is discharged on a **wrong-key join** (F-2). Scope caveat **is** honoured everywhere |
| **C3** — WAIT_STRUCTURE#0 bound to a primitive with no opening range | **7** | ✅ **CONFIRMED** | signature + **all 15** `StructureState` fields enumerated by me at the executable line; `bindable/executed=True` from census **and** my binder run | At `215b5123` this is a **declared-contract** argument only. Closed after the pin at `b7c987c9`; **not graded by me** |
| **C4** — the only `BINDS` row: wrong identity **and** non-gating | **6** | ⚠️ **REFUTED IN PART** | non-gating comment + `_h_non_gating` verbatim at cited lines; `n_taught_binds=1` recomputed | **"the one row flagged `approximation=False`" is FALSE — there are TWO** (F-1). **"prose only" is FALSE** (F-4). `approximation=False` **has no path to red** (F-1) |
| **C5** — OR constructor exists, live, unreachable; 12-primitive enumeration as its own positive control | **5** | ⚠️ **REFUTED IN PART** | existence/liveness confirmed by me; **unreachability CONFIRMED — via MY 18, not their 12** | **The enumeration missed 6 reachable primitives and the positive control DOES NOT DISCRIMINATE — proven by plant (F-3).** Conclusion survives; evidence does not |
| **C6** — desk's own: transcript identity, frozen baseline, char-for-char | **7** | ✅ **CONFIRMED IN SUBSTANCE / citation REFUTED IN PART** | blob + sha256 recomputed by me; **`MANIFEST.sha256` 275/275 verify**, positive-controlled | **"there is no manifest hash" is FALSE (F-5)** — the desk understated its own evidence. **`d73abe52` is a COMMIT, not the phase_b spec (F-6)** |
| **C7** — the classifier examines meaning; `"opening range"` is a live `WAIT_STRUCTURE` stem; the sink was replaced | **8** | ✅ **CONFIRMED** | **verified by EXECUTING `_classify_family`, not by reading the comment**: ROW 2 text → `('WAIT_STRUCTURE','confident')`, ROW 1 → `('WAIT_SESSION','confident')`, nonsense → `('UNTYPED','unmatched')`, `_UNMATCHED_DEFAULT_FAMILY` attribute **absent** | none material |
| **C8** — the decisive mutation control proves independence-by-execution | **4** | 🛑 **REFUTED IN PART — the control has NO PATH TO RED at both tested positions** | my reproduction: mutation reaches the input (asserted), output identical — **but so is it for 44 of 60 positions regardless of value (F-9)** | Conclusion survives on **field absence**, not on this control. R-725 §3 had already scoped the wording; **AR-812's "edge objection CLOSED" is REFUTED** |
| **C9** — OR columns exist on another surface, unreachable from the spec-binding path | **7** | ✅ **CONFIRMED as a NAME-binding claim** | runtime closure: `compute_opening_range_breakout` **not** in either module namespace; positive control `compute_atr`/`compute_ema` **are** | **The import list bounds NAMES, not MODULES — `indicators.core` IS loaded and a dynamic-import idiom already exists at `spec_family_bindings.py:2506` (F-10)** |
| **C10** — desk's own: the visual-source check is NOT RUNNABLE | **8** | ✅ **CONFIRMED** | my independent whole-tree sweep **by file extension, not by name**: **24** media files exist (matching the desk's count exactly), **0** relate to `st5e-YJRfKc`; transcript carries no timestamps | none material |

**No band above 8 is issuable here.** Band 9 requires failure-injection plus zero open HIGHs plus an
independent re-scan; six MEDIUM findings are open and two claims rest on instruments I had to rebuild.

---

## DISCREPANCIES

### Discrepancy F-1: `approximation=False` on ROW 3 is a FAMILY CONSTANT WITH NO PATH TO RED — and it is not unique
**Severity:** CRITICAL (false positive — a check that cannot fail, presented as a judgment)
**Claim:** ROW 3, `:398-399` — *"it is the only row carrying `approximation=False` — **an explicit EXACTNESS
CLAIM**"*; `:447` — *"the one row claiming **exactness** is the one substituting both the concept and its effect."*
**Reality:** `approximation=False` for `INVALIDATE` is **`FAMILY_META["INVALIDATE"].base_approximation`**, a
static constant. **No input can move it.** `[MEASURED HERE]` I bound **6 wildly different texts** through the
real `bind_condition()` — the taught text, `"a stop at the half range mark"`, `"PURPLE MONKEY DISHWASHER"`,
**the empty string**, ROW 1's clock paragraph, and `"exit when the moon is in the seventh house"`:

```
DISTINCT OUTCOMES ACROSS ALL 6 TEXTS: 1
  -> (bindable=True, primitive='structural_stops.compute_structural_stop',
      approximation=False, executed=True)
```

**AND IT IS NOT THE ONLY SUCH ROW.** `[MEASURED HERE, census blob `23f30eb0`]` **two** of the 11 conditions
carry `approximation=False`:
`WAIT_SESSION:…#1` (ROW 1, `UNBOUND`) and `INVALIDATE:…#10` (ROW 3). The uniqueness claim is **false as written**.
**Sources compared:** [artifact `:398`: "the only row" | census blob: **2 rows** | my binder run: constant for all inputs]
**Source of truth:** the census blob and the binder. The artifact is wrong on uniqueness and mis-attributes
**intent** to a constant.
**SECOND, NON-OVERLAPPING PATH (corpus, not runtime):** across **all 99 conditions in 11 specs**,
`approximation` is **invariant within every single family** — `INVALIDATE` n=5 always `False`,
`WAIT_STRUCTURE` n=35 always `True`, `UNTYPED` n=43 always `False`. **Zero families vary.** ⇒ the field
carries **no per-condition information anywhere in the corpus**, not just on this row.
**Fix point:** `spec_family_bindings.py:725` (`INVALIDATE` `base_approximation=False`) — but the reporting
defect is at the artifact's `:398-399` and `:447-451`.
**Repro:** `python harness4.py` / `harness5.py` (scratchpad); or bind `{"type":"INVALIDATE","object":"","role":"invalidation"}`.
**Blast radius:** the row's most quoted sentence. ★ **The artifact correctly diagnoses "a boolean cannot
carry the difference between slightly loose and computing an unrelated quantity" — and then reads that
same boolean as an exactness assertion. `approximation=False` is not a claim the compiler made about
this condition; it is a claim about the FAMILY, made before the condition was seen.**

### Discrepancy F-2: ROW 2's PROBE B is discharged on a JOIN MADE WITH THE WRONG KEY
**Severity:** MEDIUM (unsound evidence; conclusion survives independent re-measurement)
**Claim:** `:389` — *"**B — DISCHARGED BY ROW 1's RUN** — the 14-family enumeration already covers **this
text** and this family"*; `:340` — *"PROBE B ALREADY EXPLAINS WHY IT BOUND."*
**Reality:** ROW 1's PROBE B ran on `entry_sequence[1]` (*"The 5m minute OB takes place from 9:30…"*).
ROW 2's condition text is `entry_sequence[0]` (*"once you take the price that's established…"*).
`[MEASURED HERE]` `SAME STRING? False`. The enumeration **did not cover this text**.
**Source of truth:** the two condition objects in blob `23f30eb0`; they are different strings.
**I RAN THE MISSING MEASUREMENT RATHER THAN ASSUME EITHER WAY:** all 14 families × **ROW 2's own text** →
`11` bind, `8` distinct primitives, and **`FAMILIES WHERE ROW1-TEXT AND ROW2-TEXT DIVERGE: []`** — zero.
⇒ **the conclusion is correct; the stated evidence path is not.** A discharge that names the wrong
artifact is a discharge that was never checked.
**Fix point:** artifact `:389`. **Repro:** `python harness4.py`, JOIN-KEY ATTACK block.
**Blast radius:** contained — ROW 2's field 4 reasoning, which I re-derived and upheld.

### Discrepancy F-3: THE 12-PRIMITIVE ENUMERATION MISSES **SIX** REACHABLE PRIMITIVES, AND ITS POSITIVE CONTROL DOES NOT DISCRIMINATE
**Severity:** CRITICAL (a positive control that cannot go red, load-bearing in a ruling)
**Claim:** AR-805 / artifact `:176-185` — *"every `primitive="…"` literal enumerated … the declared set is
[12] … **(The enumeration IS the positive control: the same command that returned nothing for the OR
constructor returned all twelve of these.)**"* — **adopted verbatim into R-724 §6**: *"REACHABILITY FROM
THE BINDER = MEASURED ABSENT (all `12` primitive literals enumerated, enumeration is its own positive control)."*
**Reality:** `[MEASURED HERE, AST walk + runtime introspection + executing `resolve_bundle_primitive()`]`
The literal set really is exactly those 12 — **my AST walk reproduces the worker's list precisely.** But
the **reachable** set is **18**. Six primitives are assigned through **non-literal** `primitive=` forms the
literal-grep is structurally blind to:

```
line 2620  primitive=bundle_primitive              (resolve_bundle_primitive() return value)
line 2691  primitive=LEVELZONE_RESOLVER_PRIMITIVE
line 2702  primitive=LEVELZONE_NATIVE_PRIMITIVE
line 2733  primitive=SESSION_NAME_ROUTE_PRIMITIVE
MISSED: levelzone_routing.population_a_resolver · levelzone_routing.retest_touch_check ·
        bias_native.compute_bias_signal · confirmation_native.compute_confirmation_signal ·
        sweep_native.compute_sweep_signal · mss_native.compute_mss_signal
```

**The code itself documents the population that was missed** — `spec_condition_compiler.py:117`:
`# Env-gated experiment primitives (never FAMILY_META declarations)`, listing all six.
**POSITIVE CONTROL, BUILT BECAUSE THE CLAIM DID NOT HAVE ONE — I planted the sought primitive twice:**

| plant | form | worker's method | my method |
|---|---|---|---|
| baseline (clean) | — | GREEN (correct) | GREEN (correct) |
| PLANT 1 | `primitive="indicators.compute_opening_range_breakout"` | **RED — catches** | RED — catches |
| PLANT 2 | module constant → `primitive=NAME` (**the exact shape 6 real primitives already use**) | 🛑 **GREEN — MISSES** | RED — catches |

⇒ **An enumeration is not a positive control for its own blind spot.** "The command returned 12 things"
proves the command runs; it says **nothing** about whether it would have found the target in a form it
cannot parse — and that blind spot is **populated by six real primitives in the unmodified file.**
**✅ THE CONCLUSION SURVIVES, ON MY EVIDENCE, NOT THEIRS:** `compute_opening_range_breakout` is **absent
from all 18**. **REACHABILITY-FROM-THE-BINDER = MEASURED ABSENT is UPHELD; the sentence certifying HOW it
was measured is REFUTED.**
**Fix point:** `spec_family_bindings.py` enumeration method (AR-805); the ruling text is R-724 §6.
**Repro:** `python harness1.py` (enumeration), `python harness2.py` (plant).
**Blast radius:** R-724 §6's three-way split — the middle term. ✅ The desk's **third** term
(*"REPOSITORY-WIDE REACHABLE CLOSURE = UNMEASURED"*) was correctly held open and is untouched by this.

### Discrepancy F-4: "NO PARAMETERS … FOR THIS CONDITION OR ANY OTHER" IS FALSE ON THE ARTIFACT THE ROW PINS
**Severity:** MEDIUM (claim silently widened from 3 rows to the whole spec; **self-corrected after the pin**)
**Claim:** `:66-67` — *"THE EXTRACTED REPRESENTATION CARRIES **NO PARAMETERS**, NO TIMEFRAME FIELD, NO
TIMEZONE FIELD, NO DIRECTION FIELD, NO ORDERING FIELD, AND NO AMBIGUITY FIELD — **FOR THIS CONDITION OR
ANY OTHER.**"* And ROW 3 `:407` — *"Field 2 — EXTRACTED — ✅ **prose only**, as everywhere else (`strategies[0].stop`)."*
**Reality:** `[MEASURED HERE, frozen artifact sha256 `7868524b…`]` typed fields **do** exist:
```
stop     = {"description": "...half range stop...", "level": null}
targets  = [{"description": "...", "level": null}, {"description": "...", "level": null}]
variants = [{"description": "...", "variant_label": "5-minute opening range"}, ...]   <- POPULATED
```
🛑 **`strategies[0].stop` — the exact object ROW 3 cites as "prose only" — is a two-key object with a
TYPED `level` slot.** The generalisation *"or any other"* is refuted on the row's own pinned input.
**Source of truth:** the frozen extraction artifact; my sha256 matches the census `extraction_sha256`.
**⭐ THE WORKER FOUND THIS ITSELF at AR-809 (`dd7d4452`), after the pin, and its reading is right:**
an empty typed slot is a **stronger** finding than a missing one — the pipeline has a place for the value
and did not fill it. **I did not lower the band for a defect the doer caught unaided.**
🛑 **BUT THE FALSE LINES STILL STAND AT HEAD.** `[MEASURED HERE]` the correction was **APPENDED** as
section A-1 (`:477`) and lines `:66-67` and `:407` are **unedited at `ee329b35`** — 0 lines removed
across all five commits. **The file now asserts both.** A reader of Field 2 gets the refuted claim with no
marker at the point of claim. ★ The worker **does** know the strike-in-place idiom — it used `~~…~~` on
`ENGINE_PRIMITIVE_MISSING` at `:241`. **Fix at the claim site, not only in an appendix.**
**Repro:** `python -c "import json;print(json.load(open('extraction.json'))['strategies'][0]['stop'])"`.

### Discrepancy F-5: THE DESK DECLARED AN "HONEST LIMIT" THAT DOES NOT EXIST — A FREEZE-TIME MANIFEST **DOES** PIN THE TRANSCRIPT
**Severity:** MEDIUM (understated evidence; a real second path was declared absent)
**Claim:** R-724 §2 — *"⚠️ **HONEST LIMIT:** there is **no `_MANIFEST.json`** in `SEALED-READ` — provenance
is by **co-commitment**, not by a manifest hash."*
**Reality:** `[MEASURED HERE]` **`docs/replay-results/h1-sealed-read-frozen/MANIFEST.sha256`** exists — one
directory **above** `SEALED-READ/`, under a **different filename** — and contains, verbatim:
```
eaf5425387556414ffae88c9446d3e80f244e2414ee129098bc892125190d5c4  SEALED-READ/transcripts/st5e-YJRfKc.txt
```
**It was committed at the freeze (`7f725002`) and it is the exact sha256 the desk quotes.** I verified
**all 275 entries on the live tree: `OK=275  FAIL=0`.**
**POSITIVE CONTROL (my checker must be able to go red):** I copied the frozen dir to scratchpad, appended
**one byte** to the transcript, re-ran → `SEALED-READ/transcripts/st5e-YJRfKc.txt: FAILED`. **The checker
discriminates.**
**Source of truth:** the manifest. The desk searched for **one filename** (`_MANIFEST.json`) in **one
directory** and generalised to "no manifest hash" — *2 filenames checked ≠ surface enumerated*.
**Fix point:** R-724 §2's honest-limit clause. ⇒ **PROVENANCE IS STRONGER THAN RULED:** not co-commitment,
but a freeze-time manifest hash that still verifies, plus a single introducing commit and no later modification.
**Repro:** `cd docs/replay-results/h1-sealed-read-frozen && sha256sum -c MANIFEST.sha256`.

### Discrepancy F-6: `d73abe52` IS A COMMIT — AND IT IS THE CRLF REPAIR, NOT "THE PHASE_B SPEC"
**Severity:** LOW (citation defect in a provenance argument)
**Claim:** R-724 §2 — *"introduced `2026-07-27` (`7f725002`) — the same day as the **phase_b spec it
produced (`d73abe52`)**"*, rendered in my brief as *"co-committed 2026-07-27 with the phase_b spec, d73abe52"*.
**Reality:** `[MEASURED HERE]` `git cat-file -t d73abe52` → **`commit`**, not a blob. It is
*"H1 SEALED-READ FROZEN: store the evidence VERBATIM (.gitattributes -text) — the first commit silently
normalized 250 of 275 blobs"*, at **22:53:33**, **100 seconds after** `7f725002`.
- **The transcript was NOT touched by `d73abe52`** — blob `d36e688d` is identical in both commits. It was
  among the 25 blobs already byte-correct, because `[MEASURED HERE]` **it contains 0 CRLF and 0 LF — a
  single 9386-byte line with no newlines to normalise.**
- The **phase_b spec** *was* renormalised there: `92efa0c1` → **`5ebb1130`**.
- ★ **AND THAT BLOB IS A REAL JOIN THE RULING DID NOT MAKE:** `5ebb1130` is byte-identical to
  `docs/replay-results/h1-battery/tier-a-extraction-provenance/st5e-YJRfKc__s0.json` at HEAD — **the
  phase_b spec and the trace's frozen extraction input are the same bytes.**
**Source of truth:** git object types and `ls-tree` at both commits.
**Fix point:** R-724 §2. **"Co-committed" is false at commit granularity** (two commits, 100 s apart);
same-day is true. ✅ **The substantive claim — frozen baseline, not a later retrieval — is CONFIRMED** by
F-5's manifest plus a single introducing commit plus zero later modifications.

### Discrepancy F-7: THE "WHAT THIS FILE DOES NOT ESTABLISH" SECTION IS STALE IN 3 OF ITS 5 ITEMS
**Severity:** MEDIUM (a caption is a claim — and this is the section a careful reader trusts most)
**Claim:** artifact closing section, **unchanged at HEAD** (`:660-665`):
1. *"**Two of three probes are unrun**; `UNVERIFIABLE` stands."*
2. *"nothing about **the other 10 conditions** of this spec."*
5. *"**The `9` `APPROXIMATED` conditions are untouched** — **this row** explains the single `UNBOUND` one only."*
**Reality:** `[MEASURED HERE, git-walked across all 8 revisions of the file]` the string
`"Two of three probes are unrun"` is present in **every revision from `d181fcd7` onward** — including
`91ecee67`, the commit that **added** `PROBE B (BINDER) — ✅ RUN`.
- At the graded `215b5123`: **B and C had both run**; only A was partial ⇒ *"two of three unrun"* is **false**.
- Item 2: **3 of 11** conditions are traced ⇒ "other 10" is wrong; it is 8.
- Item 5: **ROW 2 IS one of the 9 `APPROXIMATED`** and is traced. *"this row"* (singular) is stale from
  the one-row era, and the item **contradicts the existence of ROW 2 in the same file.**
**Source of truth:** the file's own ROW 1/2/3 probe-status tables, which say the opposite.
**Fix point:** artifact `:660-665` — and **at the emitter**: this section was never rewritten when rows
were appended. ★ **The error direction is UNDERSTATEMENT, which is the safe direction — but a
self-limitation section that is wrong about its own coverage is exactly as unreliable as one that
overstates, and a downstream reader cannot tell which way it errs without re-deriving it.**

### Discrepancy F-8: `n_taught_binds` APPLIES NO "TAUGHT" FILTER
**Severity:** LOW (caption at the census emitter; **the number is correct**)
**Claim:** C4 / AR-808 — *"`n_taught_binds=1` is arithmetically correct and I do not dispute it."*
**Reality:** ✅ **CORRECT, and I recomputed it: `BINDS=1, APPROXIMATED=9, UNBOUND=1`.** But
`[MEASURED HERE, `tier_a_compile_census.py:324,337`]`:
```python
taught = conds   # frozen forensics §0: every taught condition load-bearing unless dispositioned
"n_taught_binds": sum(1 for c in taught if c["bind_status"] == "BINDS"),
```
`taught` is **every condition, unfiltered** — the field name asserts a selection the code does not make.
For this spec the number is unaffected. ⚠️ Noted because the campaign leans on this field and the one
row it counts carries **`tf_class="TF_UNSPECIFIED"`**, not `EXEC_TAUGHT` — so the single "taught bind"
is a condition the census does not classify as taught. **Join key = `tf_class`; it was never in the sum.**

### Discrepancy F-9: 🛑🛑🛑 THE "DECISIVE CONTROL" WAS RUN TWICE IN A 44-BAR REGION WHERE **NO MUTATION OF ANY MAGNITUDE** CAN MOVE THE OUTPUT
**Severity:** CRITICAL (a check with no path to red, published as the campaign's strongest result)
**Claim:** AR-811 §2 / artifact LANE 2 C4–C5 — *"the taught quantity can be changed by `24` points and the
primitive bound to it returns the same answer to every field. **THAT IS NOT A LOOSE APPROXIMATION — IT IS
INDEPENDENCE.**"* AR-812 §2 — *"taught window moved to **index `30` of `60`** … ⇒ ✅ **THE EDGE OBJECTION IS
CLOSED.** The independence result is NOT an artefact of bar `0` sitting at the series boundary."*
**Reality:** `[MEASURED HERE, my own reproduction against the real `compute_structure_state`]`

I reproduced the experiment, **including the input-side control the reports do not show** — I asserted the
mutation actually lands (`high` column differs; bar high `617.64 → 629.64`, low `616.61 → 604.61`). It does.
Then I ran the taught OR at **every one of the 60 positions**:

```
BAR POSITIONS WHERE THE TAUGHT-OR MUTATION MOVES *ANY* FIELD:  [44 … 59]   (16 of 60)
POSITIONS WHERE IT MOVES NOTHING:                              [ 0 … 43]   (44 of 60)
AR-811 tested bar  0 -> in the responsive set? False
AR-812 tested bar 30 -> in the responsive set? False
```

🛑 **BOTH PUBLISHED CONTROLS LANDED IN THE DEAD ZONE.** And I proved the dead zone is structural, not
value-dependent: I planted a **dominating `640.0` spike** (≈22 pts above every other bar) at each index —
`swing_high` moved **only** for bars `49–59`.
**MECHANISM, MEASURED:** `[`market_structure.py:22-48`, `structure_engine.py:132-149`]` `detect_swings` uses a
**centred** `2*lookback+1 = 11`-bar rolling max, and `swing_high` is *"the **most-recent** confirmed swing
high"* — **not the highest.** ⇒ any bar that is not among the last ~11 is invisible to `swing_high`
**whatever value it holds.** Confirmed swing-high indices in my base series: `[11,17,25,31,39,45,53,59]`.
**Sources compared:** [AR-811: bar 0 identical ⇒ independence | AR-812: bar 30 identical ⇒ edge objection closed |
**my sweep: bars 0–43 ALL identical for ANY value** ⇒ position, not semantics]
**Source of truth:** my positional sweep. **The null is fully explained by position.**
**Q2 FROM THE BRIEF — is the positive control discriminating for the right reason? NO.** *"All highs ×1.05"*
fires because it scales bars `49–59`, which are **in** the live region. It proves the rig is alive
**globally**; it does **not** prove the rig is sensitive **at the mutation site**, which is the only
sensitivity the experiment needed. ★ **`A POSITIVE CONTROL MUST FIRE WHERE THE MUTATION IS, NOT SOMEWHERE
ELSE IN THE SAME SERIES.`**
**Fix point:** the fixture — place the taught OR at an index in `[44,59]`. R-725 §8-4 already orders a
permanent fixture carrying "both edge and mid-series mutations"; ⚠️ **as specified, that fixture would
enshrine two dead-zone positions and could never go red.**
**Repro:** `python harness7.py` (H-ALT), `python harness8.py` (positional sweep).
**Blast radius:** R-725's headline (*"THE MEASUREMENT THAT CLOSES IT … AT THE SERIES EDGE **AND**
MID-SERIES"*) — those are **not two independent probes**, they are two samples from one insensitive region.

✅ **WHAT SURVIVES, AND I AM EXPLICIT BECAUSE THIS IS THE CAMPAIGN'S LOAD-BEARING ROW:**
**`ENGINE_PRIMITIVE_WRONG_IDENTITY` FOR ROW 2 IS STILL CONFIRMED** — on the **field-absence** argument
(C3), which this attack does not touch: no `StructureState` field is an opening range, so no execution
can make it one. **What is refuted is the claim that the mutation control ADDED execution-grade proof.**
It added none; it re-confirmed a region where the instrument is blind.

⚖️ **CREDIT WHERE IT IS DUE, AND IT IS SUBSTANTIAL:** `R-725 §3` **already replaced** *"independence
proved"* with *"completely insensitive … **in the registered edge-window fixture**"*, and adopted verbatim:
*"Do not broaden this into a universal mathematical claim that the primitive can never correlate with an
opening range. **It may occasionally coincide when an OR bar also becomes a structural pivot.**"*
★★★★★ **THAT IS EXACTLY MY COUNTEREXAMPLE, ANTICIPATED AS A HYPOTHESIS BEFORE I MEASURED IT. I have
turned it from a caveat into a MEASUREMENT: it coincides at 16 of 60 positions.** ⇒ **The desk's
corrected wording is CORRECT. Two things remain wrong:** (1) **AR-812's "the edge objection is CLOSED"**
— it is not; the fix relocated the test within the same blind region; and (2) the artifact's
**"IT IS INDEPENDENCE"** is **unedited at HEAD**, so the superseded wording is still the one a reader of
the trace meets.

### Discrepancy F-10: THE IMPORT LIST BOUNDS **NAMES**, NOT **MODULES** — AND A DYNAMIC-IMPORT IDIOM ALREADY EXISTS IN THE SAME FILE
**Severity:** MEDIUM (bounds C9; does not overturn it)
**Claim:** AR-810 lane 5 / C9 — the OR columns are *"NOT reachable from the spec-binding path
(`spec_condition_compiler.py:50-58` imports only `compute_atr`, `compute_ema`)"*.
**Reality:** ✅ **CONFIRMED at the NAME level, measured at runtime, not by reading the import line:**
```
compute_opening_range_breakout in spec_condition_compiler namespace? False
compute_opening_range_breakout in spec_family_bindings   namespace? False
POSITIVE CONTROL — compute_atr present? True    compute_ema present? True
```
🛑 **BUT:** importing the spec-binding path loads **776 modules**, and `src.engine.indicators.core`
**IS among them** — `core.compute_opening_range_breakout` exists on the loaded module object, one
`getattr` away. **And the escape hatch is not hypothetical:** `[MEASURED HERE,
`spec_family_bindings.py:2506-2508`]` `import importlib` … `importlib.import_module("src.engine.session_windows")`
— **a dynamic import already lives in the binding module.** It targets `session_windows`, not the OR
constructor, so **no live route exists today**; but *"the import list is the reachability boundary"* is
**false as a principle** — a `from X import a, b` bounds which **names** are bound, never which **modules**
are resident. ⇒ **C9's conclusion stands; the reasoning that supports it must be stated as name-binding.**
**Repro:** `python -c "...; import src.engine.spec_condition_compiler; print(sys.modules['src.engine.indicators.core'])"`.

---

## THE DESK'S SPECIFIC QUESTIONS, ANSWERED

**Q: Rows 2 and 3 were not executed on candles. Does that gap change either verdict?**
**At `215b5123`, it bounds them; it does not overturn them.** `ENGINE_PRIMITIVE_WRONG_IDENTITY` for ROW 2
rests on *a missing output field*, and **a missing field is a stronger absence than a zero-valued one** —
the worker's own formulation, and it is correct: no execution can put an opening range into a dataclass
that has no slot for one. For ROW 3 the gating half is **stronger than a signature argument already** — it
is the implementation's own executable comment plus the `_h_non_gating` dispatch entry, both of which I
read at the line. ⇒ **verdicts stand, scoped to the declared contract.** ✅ The gap was closed after the
pin at `b7c987c9`; **I did not grade that work** and it is not in any band above.

**Q: Does the harness call the REAL production entry point?**
✅ **YES — and I did not take the worker's word for it: I called it myself.** `bind_condition()` at
`spec_family_bindings.py:2952` is the public entry; it resolves `role` off the condition dict and
dispatches to `_bind_condition_dispatch()`. My harness imports the module and calls that function. My
CONTROL 1 reproduces the census for **all three rows** — `bindable` and `unbound_reason` match on 3/3.

**Q: Were expected values hardcoded?**
✅ **NO.** I re-derived them the same way and confirm the discipline holds: my harness reads
`cond["bindable"]` / `cond["unbound_reason"]` out of blob `23f30eb0` **at runtime** and compares. I also
recomputed `extraction_sha256` myself (`7868524b…`) rather than trusting the census field or the manifest —
**and it matches**, so the census↔artifact join is sound on a path independent of both.

**Q: Is the 12-primitive enumeration sound as its own positive control?**
🛑 **NO. See F-3 — proven non-discriminating with a plant.** This is the single most consequential
finding in this grade, because it was **adopted verbatim into R-724 §6** as `MEASURED ABSENT`.

**Q: 3 of 11 traced — any claim silently widened?**
**One, F-4** (*"for this condition or any other"*), refuted on the row's own input. Everything else is
**correctly scoped and I checked each restatement individually**: `1 of 9 APPROXIMATED` (`:382`),
`1 of 1 BINDS` (`:399`), `3 of 11` (`:458`), and the type-dispatch caveat at `:225-231` all hold.
✅ **The C2 scope caveat IS honoured everywhere the claim is restated** — artifact `:227`,
AGENT-REPORTS `:164`, and R-724 §6, which adopts the read's PROVEN/NOT-YET-PROVEN table verbatim.
**This attack surface came back clean and I am reporting the null.**

**Q: Is R-724 §7's amendment of R-721 §3 correct, and does weaker text survive?**
✅ **THE AMENDMENT IS CORRECT AND MY MEASUREMENTS INDEPENDENTLY SUPPORT IT.** R-721 §3 treated
`APPROXIMATED` as a failing-but-loose state; ROW 2 is a **substitution**, not a loosening — and **F-1 makes
the amendment stronger than the desk argued**: the `approximation` boolean is **invariant within every
family across all 99 corpus conditions**, so it cannot distinguish "loose" from "unrelated quantity" **for
any row anywhere**, not merely for this one. ⚠️ **Surviving weaker text: F-7 item 5** — *"the 9
APPROXIMATED conditions are untouched"* — still carries the pre-ROW-2 reading **at HEAD**.

---

## NOVEL FINDINGS NO REPORT NAMES

**F-1** (`approximation=False` cannot fail; two rows carry it, not one) · **F-3** (six missed primitives;
positive control proven non-discriminating by plant) · **F-5** (the manifest the desk declared absent) ·
**F-6** (`d73abe52` is the CRLF repair commit) · **F-7** (stale self-limitation section) · **F-8**
(`n_taught_binds` has no taught filter). **F-2** and **F-4** are named by no report at the pin; **F-4 was
independently found by the worker after the pin.**

★ **THE PATTERN CONNECTING F-1 AND F-3:** both are *a value that cannot take the other value*, read as
though it had been decided. `approximation=False` never had a path to `True` for `INVALIDATE`; the
enumeration never had a path to red for a non-literal primitive. **In both cases the campaign quoted the
constant as evidence.** ⚠️ **This link is my inference across two verified findings and is itself
UNVERIFIED as a common root cause — two true facts do not make a true link.**

✅ **FIRST-PRINCIPLES ARITHMETIC, SHOWN** (C4's taught concept is real and computable):
`[MEASURED HERE, frozen transcript]` OR high `617.64`, OR low `616.61` ⇒ range `= 1.03`;
half range `= 0.515` ⇒ **≈ 52 cents**, matching the artifact's target text *"divided by two, which would be
about 52 cents"* (the source garbles `$1.03` as *"a$13"* / *"dollar three"*). ⇒ **the taught half-range stop
is an exact arithmetic level derivable from two numbers the lesson states.** `compute_structural_stop`'s
ladder — sweep wick > OB bottom > FVG bottom > swing low + tick buffer — **can produce none of them.**
**C4's "different concept" finding is CONFIRMED on stronger evidence than the row itself offers.**

---

## MANDATORY CLOSING COVERAGE

### 1 — Each claim, and the ≥2 non-overlapping paths
| claim | path A | path B | path C |
|---|---|---|---|
| **C1** census fields | census blob `23f30eb0` parsed by me | **my own** `bind_condition()` run (3/3 agree) | — |
| **C1** refusal correctness | `SESSION_KEYWORDS` read at `:507-513` | runtime: taught text → `None`; `"ny open"` → `ny_am` | flag state measured (`env` unset → `False`) |
| **C1** `36.0×` | **my own** 1440-min execution of `is_in_killzone` × 5 zones | ratio recomputed `180/5, 180/15, 180/30` | controls: `764` TRUE / `0` unknown-zone |
| **C2** 11/14 → 8 | **my own** 14-family run (reproduces exactly) | census corpus: `approximation` invariant in **all 7** families present, n=99 | 8-text × 14-family sensitivity sweep |
| **C3** signature + 15 fields | source read at `structure_engine.py:210-215`, `:94-115` | census `bindable/executed=True` | my binder run reproduces both |
| **C4** non-gating | comment read at `spec_condition_compiler.py:1802-1806` | `ENFORCED_DISPATCH:115` → `_h_non_gating` | `PARAMETER_CONSUMING_HANDLERS` excludes it (`:166`) |
| **C4** `n_taught_binds=1` | recomputed from the 11 rows | generator source `:337` | — |
| **C5** existence/liveness | `indicators/core.py:467-487` read | **my** repo-wide caller grep → `:649`, `:760` | positive control: same grep, 49 hits for a live primitive |
| **C5** unreachability | AST walk (12 literals + **6 non-literal forms**) | runtime introspection of `FAMILY_META` + module constants | **executing** `resolve_bundle_primitive()` over all 14 families |
| **C6** hashes | `git hash-object` → `d36e688d` · `sha256sum` → `eaf54253` | **`MANIFEST.sha256` written at freeze time**, 275/275 verify | `git log --follow`: one introducing commit, never modified |
| **C6** char-for-char | substring test, transcript vs artifact | byte-level: `find()` offsets 2474 / 115, windows printed | positive control (`"opening range"` present) |

### 2 — Positive-control witness for EVERY absence claim I make
| my absence claim | witness that the method can go RED |
|---|---|
| OR constructor absent from all 18 reachable primitives | **PLANT 1 + PLANT 2** — my AST+constant resolver catches **both** forms; the literal method catches only PLANT 1 (**that asymmetry IS F-3**) |
| No zone matches a taught window | `764` TRUE minutes across zones; unknown zone → `0`; `ny_am` **is** returned as a superset |
| No later retrieval of the transcript | filesystem sweep **returned 23 `st5e*` paths** (can return results); exactly **1** is a transcript; git history = 1 commit |
| Manifest verifies (F-5) | **appended 1 byte in a scratchpad copy → `FAILED`.** Checker discriminates |
| `approximation` never varies within a family | the same scan **does** report variation-capable output — it separated 7 families and printed the "VARIES" bucket, which came back **empty**; and the binder **does** vary for `WAIT_SESSION` (2 outcomes), so the rig detects variation when it exists |
| `n_taught_binds` has no filter | read the assignment line; `taught = conds` with **no predicate** |

### 3 — Join keys checked for every "identical / unchanged / matches" claim
- **rows 1–2 unchanged pin→graded rev:** `diff` of the two blobs → pure insertion, **0 lines removed**.
- **rows 1–3 unchanged graded rev→HEAD:** `diff` → **0 lines removed** across 5 commits.
- **census ↔ extraction artifact:** `extraction_sha256` — census field **vs my own `sha256sum`**, not the manifest.
- **transcript identity:** git blob SHA **and** sha256 **and** the freeze-time manifest line — three keys.
- **transcript untouched by the CRLF repair:** blob hash at `7f725002` **vs** at `d73abe52` — identical.
- **phase_b spec ≡ trace input:** blob `5ebb1130` at `d73abe52` **vs** the extraction-provenance path at HEAD.
- **"the same unchanged paragraph" (C2):** ROW 1 vs ROW 2 `object` strings — **`SAME STRING? False`** (F-2).
- **my 12 literals ≡ the worker's 12:** set equality, `WORKER_12 - FULL = ∅`.

### 4 — What I did NOT verify, and what each gap blocks
1. **Rows 2/3 executed on candles** — not run by me. **Blocks:** an observed-behaviour certification of
   `ENGINE_PRIMITIVE_WRONG_IDENTITY`. ⚠️ Work exists at `b7c987c9`/`ee329b35`; **it postdates the pin and
   I did not grade it. Its band is still owed.**
2. **The 8 untraced `APPROXIMATED` rows** — untouched, correctly disclaimed by the artifact. **Blocks:**
   any spec-level statement.
3. **The other 10 specs** — out of scope. **Blocks:** corpus generalisation of F-1 beyond the 99
   conditions I did scan.
4. **Flag-ON binder behaviour** — my "13/14 families are text-insensitive" is measured **only** under the
   default state (`TF_SESSION_ROLE_RESOLVER_ENABLED` unset; composition-bundle, FVG-identity and
   levelzone experiments all off, `restore=False`). Those paths **are** text-sensitive. **Blocks:**
   any claim about type dispatch under experiment flags. **This bound is on MY finding, not the worker's.**
5. **Whether `WAIT_STRUCTURE` is correctly ASSIGNED** — I graded binding, not classification. AR-810
   addresses it after the pin; **not graded.**
6. **`resolve_bundle_primitive`'s full range** — I probed 6 texts × 14 families, not the input space.
   `UNENUMERATED`. **Blocks:** "18" as a closed upper bound — **it is a floor, and 12 was a floor too.**
7. **Repository-wide reachable import closure** (R-724 §6's third term) — **still UNMEASURED**, by me and
   by the campaign. My 18 covers `spec_family_bindings.py`'s assignment sites, **not** every module.
8. **No `tsc`, no `vitest`, no pytest suite** — this is a Python-binder and provenance grade only.
9. **The census's own correctness** — `bind_status` remains **single-source**, computed once at generation
   (2026-07-28) and never recomputed. My binder run agrees with it for **3 conditions**; that is a join
   check on 3 rows, **not** an independent regeneration of the census. ⇒ **`single-source truth =
   unverifiable` still stands for the other 96 conditions.**

### 5 — INSTRUMENT DISCLOSURES (my own rig, and it did not work first time)
1. **My first primitive enumeration was the same broken method I later convicted.** I began with a plain
   `grep 'primitive\s*=\s*"'`, got 12, and **was one step from publishing the worker's number as my
   independent corroboration.** Only widening to `grep 'primitive\s*='` (no quote) exposed the 4
   non-literal sites. ★ **I reproduced the defect before I found it — had I stopped at the number
   matching, F-3 would not exist and I would have called a blind method "a second path".**
2. **`sha256sum -c` inflates my FAIL count by 1.** My `awk` counts the trailing
   `sha256sum: WARNING: 1 computed checksum did NOT match` line as a failure, so the plant reported
   `FAIL=2` for **one** real mismatch. Baseline `FAIL=0` (no warning line emitted). The named-file
   `…st5e-YJRfKc.txt: FAILED` row is the discriminating evidence, not the count.
3. **`git ls-tree | grep <8-char-prefix>` silently returns nothing for a commit hash.** My first check for
   `d73abe52` returned empty from **two** trees and read as "the blob is not there". The real answer was
   that it is **not a blob at all**. `git cat-file -t` settled it. ⚠️ **An empty `ls-tree` grep is not an
   absence — it is also what a category error looks like.**
4. **Console encoding mangles box-drawing and em-dashes** in my harness output (`�`). Cosmetic; every
   load-bearing value was re-read as ASCII/repr.

---

## VERDICT

**PASS WITH BOUNDED FINDINGS.** The Phase A rows 1–3 are **substantively sound**: every census field,
every signature, every field enumeration, and every quantitative figure I re-derived reproduces. **C1, C2
and C3 are CONFIRMED**, and C2 is **stronger than claimed** — 13 of 14 families are wholly text-insensitive
under default flags, and `approximation` is invariant within every family across all 99 corpus conditions.

**C4 and C5 are REFUTED IN PART.** Both reach the right conclusion on evidence that does not carry it:
C4's *"the one row flagged `approximation=False`"* is a **constant with no path to red, and it is not
unique**; C5's positive control is **proven non-discriminating by plant** and its enumeration missed **six
of eighteen** reachable primitives. **C6 is CONFIRMED in substance** — and its provenance is **stronger
than the desk ruled**, because a freeze-time manifest the desk declared absent pins the transcript and
still verifies 275/275.

🛑 **NOTHING HERE IS CERTIFIED AS A CAUSE.** `UNVERIFIABLE` stands per R-722 §4 / R-723 §2. This grade
certifies **mechanical and evidentiary soundness at `215b5123`**, not a causal classification — and the
band ceiling of **8** reflects six open findings and two rebuilt instruments.

**Grader:** `accuracy-validator` · independent · no lineage on rows 1–3.
**This receipt is uncommitted by design — the desk commits it.**
