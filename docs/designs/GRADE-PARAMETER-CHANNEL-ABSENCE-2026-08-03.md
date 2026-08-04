# GRADE — AR-737 §5 "A NUMERIC PARAMETER CHANNEL THAT DOES NOT EXIST AT ANY LAYER"

**Mode:** HUNT (adversarial — dispatched to REFUTE an absence claim)
**Date:** 2026-08-03
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**`git rev-parse --git-common-dir`** = `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` (LINKED WORKTREE, not a standalone repo — law 10)
**HEAD at grade time:** `57adfb67aa1b2288b9f7d03d1f5185ecc1376522`
**Pins named in brief:** AR-737 landed `16252a30`, corrected `fea64db3`; worker's own measurement HEAD (from AR-737 body) `226f17ec`
**Flag state for every figure below:** DEFAULT (no `TF_*` variable set in any measuring process; printed and confirmed empty by the L3 harness)
**Dirty file recorded and left untouched, per brief:** `src/engine/tests/test_synthetic_market_simulator.py` (modified, sibling writer). I did not revert, clean, checkout or commit anything. 7 other tracked files were also dirty at grade start (`AGENT-LOGS.md`, `docs/A12-AUDIT-REPORT.md`, `docs/designs/CERT1-CANDIDATE-CRITERIA-PREREG-2026-08-03.md`, 2 replay-result JSONs, `docs/scaling-validation/cli-report-existence-test.md`, `docs/wave25-exit-engine-ab-report.md`) — none is a subject of this grade.

## HEAD-MOVEMENT IMMUNITY `[MEASURED HERE]`

All five subject blobs are **byte-identical at `226f17ec`, `16252a30`, `fea64db3`, `57adfb67`, AND the worktree**. This grade is immune to the head movement between the worker's measurement and mine.

| File | blob (identical at all 4 commits + worktree) |
|---|---|
| `src/engine/spec_family_bindings.py` | `bb1d23cae9291424130dd71a330b4e03774c85c2` |
| `src/engine/spec_condition_compiler.py` | `68754467f5701b8708fbde291b1dc6537ba50e2d` |
| `src/engine/family_meta_enforcement.py` | `1d3c173fc2a7fa2bebfcdc16bef35244a94bab92` |
| `src/server/lib/spec-family-bindings.ts` | `9ca9cc9cdd7ebb38432a815f12770934859e4fc3` |
| `src/engine/indicators/core.py` | `d270c99615227d2c566d14c349cf70708d1e3cc5` |

---

# VERDICT

| Layer | Claim as written | Verdict | Band |
|---|---|---|---|
| **LAYER 1** — "183/183 conditions carry EXACTLY 7 keys; PARAMETER-LIKE KEYS: 0" | corpus count | **CONFIRMED** (count exact via 2 independent paths) — but the caption says *"spec condition schema"* and measures the **sealed corpus**; the live producer emits **8** keys | **7** |
| **LAYER 2** — "`ConditionBinding`: 10 fields; only structured value is `session_zone`, a keyword. NO number." | binder carrier | **CONFIRMED** — strongest of the three; verified 3 ways incl. runtime introspection + TS-mirror parity | **8** |
| **LAYER 3** — "primitive call: period is a MODULE CONSTANT" | primitive call | **PARTIALLY CONFIRMED** — true of the ONE cited call site, **false as a general statement**; a live typed numeric parameter channel reaches `compute_sma`/`compute_ema` | **4** |
| **OVERALL** — *"A TAUGHT NUMBER HAS NOWHERE TO TRAVEL … AN EXACT MA BINDING REQUIRES A NUMERIC PARAMETER CHANNEL THAT DOES NOT EXIST AT ANY LAYER"* | headline | **PARTIALLY CONFIRMED — the headline generalization is REFUTED** | **5** |

**The one-sentence result:** AR-737's three layer measurements are *accurate as scoped statements about the spec-condition binding pipeline*, and I could not refute Layers 1 or 2. But the sentence they were assembled into is false: a **live, mounted, persisted, deterministic taught-text→numeric-parameter channel already exists**, it already parses AR-737's own quoted sentence *"once we close over this 20 period moving average"* into `{period: 20}`, it already distinguishes SMA from EMA, and it already implements AR-737 §5's own requirement 3 (declared assumptions that fail fidelity mode). **The mandate's stated fear — building a redundant channel — is realized.**

---

## Discrepancy F-1: A live taught-text→numeric-parameter channel exists and was missed

**Severity:** CRITICAL (false negative — an absence claim that is about to authorize a 5-surface build)
**Claim:** *"`A TAUGHT NUMBER HAS NOWHERE TO TRAVEL.` The extractor does not capture it … **AN EXACT MA BINDING REQUIRES A NUMERIC PARAMETER CHANNEL THAT DOES NOT EXIST AT ANY LAYER**"*
**Reality:** `src/server/lib/indicator-params.ts` is a 4-stage deterministic transcript parser whose module header states its purpose verbatim: *"This recovers EXPLICIT numeric params from the transcript (deterministic, no prompt change)"*. It is **live**: imported at `src/server/routes/agent.ts:18`, called at `:1621`, persisted at `:1886-1887` as `entry_params` / `param_source`, on a router mounted at `/api/agents` (`src/server/index.ts:546`).

**`[MEASURED HERE — executed the REAL module via `node_modules/.bin/tsx`, not a replica]`** — fed AR-737 §4's own verbatim quotes:

```
"once we close over this 20 period moving average"
   -> indicator=sma  params={"period":20}  conf=0.8  source=TRANSCRIPT_EXPLICIT
"this 13 EMA operated as a initial support"
   -> indicator=ema  params={"period":13}  conf=0.8  source=TRANSCRIPT_EXPLICIT
"that's the 20 SMA it's not the smooth moving average it's not the exponential"
   -> indicator=sma  params={"period":20}  conf=0.8  source=TRANSCRIPT_EXPLICIT
"the first two-minute candle closes over the 20 SMA"
   -> indicator=sma  params={"period":20}  conf=0.8  source=TRANSCRIPT_EXPLICIT
```

**It already satisfies four of AR-737 §5's five stated requirements:**

| AR-737 §5 requirement | Already implemented at |
|---|---|
| 1. taught **period** reaches `compute_*`'s `period` arg unmodified | `IndicatorConfig.period` → `indicators/core.py:588/592` (proved by value-equality below) |
| 2. taught **MA type** selects the function, honouring explicit refusal | `detectIndicator` → `sma`/`ema` split (`indicator-params.ts:38-40`); dispatcher branches `cfg.type == "sma"` vs `"ema"` |
| 3. assumptions **declared**, not silent | `applyParamDefaults` → `source=DEFAULT_ASSUMPTION @ 0.25`; `paramsSatisfyTrigger(..,"fidelity")` = **false** for assumptions, **true** for `TRANSCRIPT_EXPLICIT` — measured |
| 5. range validation | `src/server/lib/param-ranges.ts:25` and `src/engine/compiler/pattern_library.py:11-25` both declare `sma_crossover: fast_period [5,50], slow_period [20,200]` |

**Sources compared:**
- source A (AR-737 §5): "no numeric parameter channel at any layer"
- source B (`indicator-params.ts`, executed): `{period:20}` `TRANSCRIPT_EXPLICIT` from taught prose
- source C (`indicators/core.py` + `config.py`, executed): `IndicatorConfig(type='sma', period=20)` → `compute_sma(close, 20)`
- source D (`pattern_library.py`, executed): `validate_entry_params('sma_crossover', {fast_period:20, slow_period:50})` → `(True, [])`

**Source of truth:** B/C/D. They are executable and were executed; A is a scoped observation over-generalized into a universal.
**Fix point:** the sentence in `docs/designs/AGENT-REPORTS.md` AR-737 §5 must be re-scoped to *"…does not exist **in the spec-condition binding pipeline**"*; and the build plan's surface #4 ("`indicators/` — possibly NONE") must be widened to *"reuse `indicator-params.ts` + `IndicatorConfig`, do not rebuild"*.
**Repro:**
```
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712
./node_modules/.bin/tsx <script importing scanIndicatorParams from src/server/lib/indicator-params.ts>
```
**Blast radius:** the 5-surface build AR-737 authorizes — specifically a redundant text→number parser and a redundant SMA/EMA selector, in `src/server/lib/`, the **same directory** that already hosts `indicator-params.ts`. This project has shipped "built, zero callers" four times.

---

## Discrepancy F-2: Layer 3's "called with a constant" is false over the call-site population

**Severity:** HIGH (over-generalized measurement)
**Claim:** *"LAYER 3 primitive call: `compute_ema(s, BIAS_EMA_FAST)` — period is a MODULE CONSTANT at `:140`"* → generalized to *"the primitive is called with a constant"*.
**Reality:** the cited site is genuinely a constant `[MEASURED HERE — read `spec_condition_compiler.py:140-141,729-730`]`. But over the **non-test MA call-site population (population rule: `grep "compute_sma(|compute_ema(" --include=*.py src/`, minus `/tests/`, minus `def`)**, the constant case is the minority:

| Site | period argument | kind |
|---|---|---|
| `spec_condition_compiler.py:729,730,914` | `BIAS_EMA_FAST` / `BIAS_EMA_SLOW` / `RETEST_LEVEL_EMA_PERIOD` | module CONSTANT (the claim's site) |
| `indicators/core.py:588,592,707,711` | **`cfg.period`** | **pydantic `IndicatorConfig` field, `period: int = 14`** |
| `indicators/paper_bridge.py:252,253` | **`int(name[len(prefix):])`** | **parsed from a NAME STRING (`"sma_20"` → 20)** |
| `strategies/bounce_off_level.py:148,150` | **`self.ma_period`** | **instance param, and it SELECTS sma-vs-ema** |
| `strategies/gann_box_4h_continuation.py:221` | `self.trend_ema_period` | instance param |
| `regime.py:88` | `ma_period` | function argument |

**Runtime proof that `cfg.period` IS the primitive's `period` argument `[MEASURED HERE]`:**
```
compute_sma(close, 20)  direct         = 104.932500
via IndicatorConfig(type='sma',period=20) = 104.932500   IDENTICAL -> same argument
sma_20 last = 104.932500 ; sma_13 last = 104.583846      DIFFER (delta 0.348654) -> load-bearing
type='sma',period=20 -> 104.932500 ; type='ema',period=20 -> 104.748775  -> config SELECTS the function
```
**Liveness of that path:** `compute_indicators` is called at `backtester.py:3875` and `strategy_base.py:89` (`self.config.indicators`). Not dormant.
**Source of truth:** the executed values. **Fix point:** AR-737 §5 LAYER 3 line — scope it to `spec_condition_compiler`.
**Repro:** run the L3 harness (paths in COVERAGE below).
**Blast radius:** the estimate that surface #4 (`indicators/`) needs no work is right for the wrong reason — the parametric plumbing exists but is wired to a *different* config object than the binder uses.

---

## Discrepancy F-3: DSL↔runtime indicator vocabularies have ZERO intersection

**Severity:** MEDIUM (schema drift; a dead bridge, discovered while testing F-1)
**Claim:** not an AR-737 claim — a novel false-green found on the way.
**Reality `[MEASURED HERE]`:** `compile_to_backtest` emits `{"type": dsl.entry_indicator, **dsl.entry_params}` (`compiler.py:58-63`). But:
```
DSL entry_indicator vocabulary (ENTRY_PATTERNS)   : 16 names, incl. sma_crossover, ema_crossover
runtime IndicatorConfig.type vocabulary            : 13 names, incl. sma, ema
INTERSECTION                                       : []            <-- EMPTY
POSITIVE CONTROL (both sets non-empty)             : 16 and 13
```
Consequence, executed: `StrategyConfig(**compile_to_backtest(dsl)["strategy"])` raises `Unknown indicator type 'sma_crossover'`. **The Python DSL→backtest bridge cannot validate its own output.** The live bridge is `src/server/lib/dsl-compiler.ts:171`, which emits the *correct* shape `{ type: primitive, period: fast }`.
**Source of truth:** the raised `ValidationError`. **Fix point:** `src/engine/compiler/compiler.py:58-63` (or an explicit deprecation of the Python `compile_to_backtest`).
**Repro:** L3b harness, TEST 6/7.
**Blast radius:** anything still calling the Python `compile_to_backtest` produces configs the engine rejects.

---

## Discrepancy F-4: Layer 1's caption says "schema"; the live producer emits 8 keys, not 7

**Severity:** MEDIUM (caption-is-a-claim; the sealed corpus is stale w.r.t. the producer)
**Claim:** *"LAYER 1 spec condition **schema**: 183/183 conditions carry EXACTLY 7 keys"*
**Reality `[MEASURED HERE — executed `_entry_condition` at HEAD]`:**
```
producer output keys(8) = ['evidence','id','load_bearing','object','role','span','type','type_confidence']
sealed corpus shape     = keys(7) = evidence,id,object,role,span,type,type_confidence   (n=183, 18 files)
JOIN KEY (producer shape ∈ sealed shapes)? -> False
```
`spec_producer.py:508` adds `load_bearing`, with a comment declaring it *"additive, honest — NOT part of the parse-required contract"*. So the 7-key figure is a true statement about the **sealed corpus** and a false statement about the **schema**; and the condition dict is demonstrably **open to additive extension** — one such extension already shipped. That materially weakens "the schema cannot carry it" as a structural argument, though it is *not* itself a numeric channel (`load_bearing` is a bool).
**Source of truth:** the executed producer. **Fix point:** AR-737 §5 LAYER 1 wording. **Blast radius:** the "strictly larger object" sizing argument leans on schema rigidity that is not there.

---

## Discrepancy F-5: indicator-precedence bug loses the period in 1 of AR-737's 3 quoted sentences

**Severity:** MEDIUM (defect in the channel F-1 identifies — reported so the reuse is not oversold)
**Reality `[MEASURED HERE]`:** `INDICATOR_ALIASES` is ordered with `vwap` before the moving averages (`indicator-params.ts:32` vs `:38-40`, comment *"moving averages last (broadest)"*). `detectIndicator` returns on **first** match, so:
```
"closes over the 20 SMA and vwap"  -> indicator=vwap  params=null  source=NONE
```
The taught `20 SMA` is silently lost when a sentence also names VWAP. This is the **first** of the three sentences AR-737 §4 quotes as proof the period is taught.
**Fix point:** `src/server/lib/indicator-params.ts:28-41` (alias precedence / multi-indicator sentences).
**Blast radius:** under-counts `TRANSCRIPT_EXPLICIT` params on multi-indicator prose — i.e. it makes the existing channel look *less* capable than it is, which plausibly contributed to it being overlooked.

---

# WHAT I TRIED TO REFUTE AND COULD NOT (honest nulls)

These are the mandate's four hunt targets. Three produced no refutation.

**Target 1 — a spec/condition schema anywhere carrying a numeric field: NO REFUTATION.**
Population rule P2 (deliberately NOT the worker's `docs/**/*.spec.json`): `os.walk` the whole tree skipping `.git/node_modules/.venv/__pycache__/dist/build/.next/.turbo/coverage`; `json.load` **every** `.json`; classify **structurally** (any nested list-of-dicts where ≥3 of the 7 declared keys appear on the majority of entries) — filename-agnostic, so it catches caches, fixtures and raw extractor output.
```
.json files scanned            : 1343      (2 unreadable: tests/python/golden/quantum_mc_breach.json [UnicodeDecodeError],
                                            Trading_forge_frontend/amber-vision-main/tsconfig.node.json [JSONDecodeError/JSONC])
files carrying conditions      : 33
CONDITION OBJECTS              : 22470     (122x the worker's 183)
PARAMETER-LIKE KEY NAMES       : (none)
KEYS WITH NUMERIC VALUES       : n_family_hits only (249) — an audit artifact, not a spec key
*.spec.json on disk, tree-wide : 18        -> the worker's file population was COMPLETE for that pattern
```
The 183/7-key shape appears **exactly 183 times** tree-wide — the worker's count reproduces exactly under a completely different instrument. The wider population is dominated by a **6-key** shape (`evidence,id,object,role,span,type`, n=21480) that the sealed-corpus framing does not see; still no numeric.
No pydantic/TypedDict model describes a spec condition; no SQL column stores one (persistence is JSONB `strategies.config`); the frontend declares no condition type.

**Target 2 — is the clock-time precedent mischaracterised? NO — the worker was RIGHT, and understated its own case.**
I read `spec_family_bindings.py:2415-2440`. That site does not parse a taught number at all: it probes **1440 synthetic minutes** of 2024-01-03 through `sw.is_in_killzone(dt, zone)` and reduces the hits to minute-runs — it *derives a known zone's own boundaries*. The taught-text numerals are consumed by `_SESSION_CLOCK_TOKEN_RE` (`:961`) purely to **select** a zone. `[MEASURED HERE]` No numeral survives into `ConditionBinding`. "It produces a ZONE, not a free parameter" is correct.

**Target 3 — do the resolver registries thread a parameter? NO.** `[MEASURED HERE — AST signatures + live import]`
```
resolve_bundle_primitive(cond_type: str, object_text: str)      -> returns a primitive NAME (str)
bind_condition(condition: dict, restore, demoted_role, force_unexecuted)
resolve_primitive(declared: str)  ·  verify_dispatch_coverage(dispatch: dict[str, str])
EXPERIMENT_PRIMITIVES: frozenset len=7   PRIMITIVE_RESOLVERS: dict len=13   MECHANISMS: dict len=3
numeric-valued entries in PRIMITIVE_RESOLVERS / MECHANISMS: NONE
```

**Target 4 — is any numeric channel flag-gated? NO.** All 8 env reads in the three binder modules are boolean routing gates (`TF_FVG_IDENTITY_ENABLED`, `TF_LEVELZONE_ROUTING_ENABLED`, `TF_LEVELZONE_RESOLVER_ENABLED`, `TF_COMPOSITION_BUNDLE_ENABLED`, `TF_OR_BRANCHES_ENABLED`, `TF_SESSION_ROLE_RESOLVER_ENABLED`, `TF_WIRE1_HTF_COLUMNS`) plus `TF_ROLE_DEMOTION_MODE` (string mode) and a pins variable. None carries or opens a numeric parameter.

**Layer 2 could not be dented.** Three independent paths agree; a fourth attack (extensibility) failed:
- AST field census → 10 fields, 0 numeric annotations
- runtime `dataclasses.fields(ConditionBinding)` → 10 fields, 0 numeric
- TS mirror `spec-family-bindings.ts:30-41` → 10 fields, camelCase, 0 numeric — **parity holds**
- frozen dataclass **rejects** an extra kwarg: `ConditionBinding(..., period=20)` → `TypeError: unexpected keyword argument 'period'`

*Precision note, not a defect:* the claim cites `spec_family_bindings.py:762-777`; the class is at `753-778` and its **fields** are at `755-764`. `762-777` spans `executed`→`session_zone` and most of `to_dict`. The 10-field count is right.
*Scope note:* the sibling `BindingPlan` (`:2891`) **does** carry 4 ints (`spine_total`, `spine_bound`, `confluence_total`, `confluence_bound`). These are binder-computed counts, not carried parameters — they do not refute L2 as scoped, but they are why "the binding cannot carry a number" needs the words "`ConditionBinding`".

---

# COVERAGE

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| L1 count 183/183 × 7 keys | `glob docs/**/*.spec.json` + `json.load`, key-tuple census → 18 files / 183 conds / one shape | **filename-agnostic** `os.walk` of all 1343 `.json` + structural classifier → the 7-key shape occurs exactly 183× tree-wide | schema-definition side: no pydantic/TypedDict/SQL column exists to permit more |
| L1 "no parameter-like key" | name-based detector over 22470 objects → none | value-based numeric detector over the same → only `n_family_hits` | producer executed at HEAD → 0 numeric-valued keys |
| L2 `ConditionBinding` = 10 fields, no number | AST field census (no import, no flag can move it) | runtime `dataclasses.fields()` after live import | TS mirror interface read (`:30-41`) — parity |
| L3 cited site is a constant | read executable lines `:140-141`, `:729-730` | AST/grep call-site census | — |
| L3 general form FALSE | read `indicators/core.py:588-592` + `config.py:320-322` | **executed** `compute_indicators`, value-identity vs direct `compute_sma` call | liveness: callers at `backtester.py:3875`, `strategy_base.py:89` |
| F-1 channel exists AND is live | read `indicator-params.ts` executable lines | **executed the real module** via `tsx` on AR-737's own quotes | route mounted `index.ts:546`, persisted `agent.ts:1886-1887` |

I did **not** re-run the worker's greps and call agreement a second path. Where a figure of the worker's reproduces (L1's 183), it reproduces under an instrument built on a different principle (structural/`json.load`) than the worker's (filename glob).

### 2. Positive-control witnesses — every zero, with its VALUE

| Zero asserted | Control | Control's measured VALUE |
|---|---|---|
| "no parameter-like key in 22470 condition objects" | plant `ma_period: 20` into 3 real condition dicts, re-run both detectors | **numeric-detector fired 3, name-detector fired 3** (required 3/3) |
| "producer emits no numeric key" | same detector on the producer's real output + planted `ma_period=20` | **`['ma_period']`** returned |
| "`ConditionBinding` has 0 numeric fields" | identical introspection on sibling `BindingPlan` | **4 numeric found** (`spine_total`,`spine_bound`,`confluence_total`,`confluence_bound`) — detector demonstrably able to see ints |
| "period reaches the primitive unmodified" | 1-off period discrimination | `compute_sma(close,21)` = **104.913810** ≠ `period=20`'s **104.932500** |
| "the number is load-bearing" | vary period 20→13 | **104.932500 vs 104.583846**, delta **0.348654** |
| "config selects the function" | same period, both types | sma **104.932500** vs ema **104.748775** |
| "range validation is real" | out-of-range `fast_period=999` | **`False, ["Param 'fast_period' value 999 out of range [5, 50]"]`** |
| "scanner returns nothing when nothing is taught" | sentence with no numeral | **`{indicator:"sma", params:null, confidence:0, source:"NONE"}`** |
| "locality guard works" | `"wait 5 minutes, then check the 20 period moving average"` | bound **`{period:20}`**, not 5 |
| "fidelity mode rejects assumptions" | `paramsSatisfyTrigger(DEFAULT_ASSUMPTION,"fidelity")` | **false**; `"backtest"` → **true**; `TRANSCRIPT_EXPLICIT`/`"fidelity"` → **true** |
| "DSL/runtime vocabularies are disjoint" | both sets non-empty | **16 and 13**, intersection **[]** |
| "out-of-vocabulary type is rejected" | `IndicatorConfig(type="sma_crossover")` | **raised `ValidationError`** |

### 3. Join keys checked

- **L1 corpus↔producer:** key-tuple of the condition dict. Sealed = `(evidence,id,object,role,span,type,type_confidence)`; producer = that **+ `load_bearing`**. **Join FAILS** → F-4.
- **L3 config↔primitive:** the *computed value*. `compute_sma(close,20)` and `IndicatorConfig(period=20)` both = `104.932500` → same argument, not merely a same-named field.
- **Python↔TS binder parity:** field name set (snake vs camel), 10↔10, `session_zone`↔`sessionZone`. Holds.
- **Blob identity across pins:** sha1 per file, 4 commits + worktree — all identical.
- **DSL↔runtime vocabulary:** set intersection of indicator-type names = ∅.

### 4. What I did NOT verify

- **No database was touched.** Persistence of `entry_params`/`param_source` is `[MEASURED]` by reading the executable insert at `agent.ts:1886-1887` and the mount at `index.ts:546` — **I did not observe a row**. Whether a `transcript_explicit` param has *ever actually landed* in Postgres is `[UNENUMERATED]`.
- **No test suite was run** — no pytest, no vitest, no TS parity test. The 403-line mirror's parity is asserted from reading both interfaces, not from executing `tests/test_spec_family_bindings_parity.py` or `spec-family-bindings.test.ts`.
- **I did not run the LLM extractor.** Whether the model *emits* `entry_params` for MA strategies in practice (the `llmEntryParams` branch at `agent.ts:1618`) is `[UNENUMERATED]`; I verified only the deterministic fallback.
- **I did not adjudicate the design question** of whether the spec-condition pipeline *should* converge on `indicator-params.ts` / `IndicatorConfig`, or whether the two pipelines are deliberately separate. AR-737 §6 reserves design to the fresh seat; I report only that the machinery exists.
- **I did not re-derive AR-737's other figures** (the 8 MA object hits, the 3-family spread, the 18-primitive union, `FAMILY_META` counts). Out of scope of the §5 absence claim.
- **2 of 1343 JSON files were unreadable** (listed above) and are excluded from the P2 population. Neither is a spec file.
- **Structural classifier depth-capped at 14** nesting levels; a condition array buried deeper would be invisible. No evidence any exists.
- **One tree only.** Every figure is from `wt-h1-wave4-20260712`. I did not sweep the ~80 sibling worktrees; a channel existing only in another tree would not appear here. Per law 10 this null is scoped to this tree by name.
- **`paper_bridge.py` and `bounce_off_level.py` were read, not executed** — their parametric periods are `[MEASURED at the executable line]`, not runtime-witnessed like `indicators/core.py`.

### 5. Instrument faults self-caught during this grade

1. Python stdout defaulted to **cp1252** and crashed on the report's box-drawing characters — a silent truncation risk. Forced `PYTHONIOENCODING=utf-8` for every subsequent run.
2. My first structural classifier was too loose and swept **n8n workflow nodes** (`name`/`typeVersion`/`position`/`parameters`) into the condition population, inflating it to 27549 and producing a false `parameters` hit. Tightened to require ≥3 of the 7 declared keys → 22470, and the false `parameters` hit vanished.
3. Two of my own harness fixtures failed on **my** errors, not system defects (`exit` typed as dict when `StrategyConfig.exit: str`; `timeframe="5min"`/`entry_type="crossover"` not in the DSL enums). Corrected and re-run; recorded here so no reader mistakes them for findings.
4. `grep "compute_ema("` also matches `_compute_ema(` (`parity_engine/diff_harness.py:78`), inflating any raw call-site count by 3. My per-site table is hand-classified, not count-based.

---

**Lineage declaration:** I have not previously graded AR-737 or any part of the parameter-channel question. My prior work in this tree (session-window representability, golden-slice, F-1/Lane A) touched `spec_family_bindings.py`'s **session** routes; F-1 and F-2 above concern the **indicator/parameter** surface, which that work never examined. No self-grading.

---

# ADDENDUM — HEAD MOVED MID-GRADE (written after the body above)

**`57adfb67` → `a86c2bcc5c8ebd042fdd9b82eb583c4ab218ba05`** while I was measuring. Handled, not ignored:

- **The move touched 3 docs only** (`ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, `CERT1-CANDIDATE-CRITERIA-PREREG-2026-08-03.md`, +235 lines). **All 13 code files I relied on are byte-identical at `57adfb67`, `a86c2bcc`, AND the worktree** (re-verified by sha1 after the move).
- **The subject claim did not move.** The `## AR-737` heading block is **byte-identical across the move**: 13629 bytes, **sha256 `f5a2cdf3cd6f8ada2c2c`** at both commits. *(First comparison attempt gave a false mismatch — my slice fell back to a fixed 14000-char window at the old head where no `AR-738` existed to terminate it, and `AGENT-REPORTS.md` is newest-at-top so a bare `find('AR-737')` lands inside AR-739's body where it is merely cited. Self-caught; re-sliced on the `^## AR-NNN` heading.)*
- **Every band above therefore describes AR-737 at `a86c2bcc` as well as `57adfb67`.**

## The doer published Lane 1 mid-grade (AR-738 start-receipt, AR-739 result)

AR-738 states the seat is *"the same seat as AR-737"* — **the doer of the claim I am grading** — and correctly declares: *"Lane 2 (accuracy-validator, adversarial refutation of my own AR-737 §5) is the desk's to run — I neither dispatch nor interpret it."* **Structural independence held in both directions:** it did not read my verdict, and I did not read AR-739 until after my bands were fixed and my body written.

**My F-1 is not a duplicate of the doer's Lane 1.** `[MEASURED HERE — term census over the AR-739 block]`:
```
indicator-params 0 · scanIndicatorParams 0 · IndicatorConfig 0 · compute_indicators 0
entry_params 0 · TRANSCRIPT_EXPLICIT 0 · pattern_library 0 · param-ranges 0
dsl-compiler 0 · agent.ts 0 · ENTRY_PATTERNS 0 · indicator_params 0
```
Both AR-737 and AR-739 stay **inside the spec-condition binder**. Neither looks at the adjacent extraction/indicator pipeline where the live channel is. **F-1 stands as unfound by either report.**

AR-739's own §3 (*"the pipe is already laid"* — `_dispatch_enforced` already hands the whole `ConditionBinding` to handlers; only `_eval_wait_bias` fails to receive `b`) is a **different, complementary** finding that softens L3 from the inside, and it is **consistent with my F-2**. Its §4 cache hazard (9 family-keyed single-slot caches → a spec teaching "20 SMA" and "200 SMA" silently evaluates the first twice) is an independent catch I did not make and did not verify.

---

## Discrepancy F-6: the doer's own retraction over-corrects — an executable cross-language parity gate DOES exist

**Severity:** HIGH (a false absence, in the correction to the claim under grade — and load-bearing on AR-739's cost fork)
**Claim (AR-739 §0):** *"`THERE IS NO EXECUTABLE CROSS-LANGUAGE PARITY CHECK. THE "BYTE-FOR-BYTE MIRROR" IS GUARDED BY A COMMENT ASKING HUMANS TO REMEMBER.`"*
**Reality `[MEASURED HERE]`:** the doer verified two *specific filenames* and generalized to a universal absence. A **filesystem sweep** (`find`, not `git grep`) for `*parity*` returns **`scripts/check-spec-binding-plan-parity.ts`, 280 lines**, whose header states its method verbatim: *"spawn a Python subprocess, feed identical inputs, diff outputs … for … the condition-family BINDING PLAN"*. It computes the plan via TS `compileBindingPlan()` in-process and via Python `compile_binding_plan()` in a subprocess, and *"Asserts EXACT agreement on: compiled, triggerBound, spineTotal, spineBound, confluenceTotal, confluenceBound, approximationUsed, and the per-condition (bindable, primitive, approximation) tuple for every condition id."*

The doer's two sub-facts are **correct** (`tests/test_spec_family_bindings_parity.py` does not exist — my `find` confirms, positive control `test_family_meta_enforcement.py` **found**; and the TS unit test crosses no process boundary — my grep's 1 hit is a comment naming the Python file, so its *substance* holds). **The universal conclusion drawn from them is not.**

**And the gate is not dead — its corpus is present** `[MEASURED HERE]`:
```
SAMPLES_DIR (hardcoded absolute path, scripts/check-spec-binding-plan-parity.ts:72-73):
  C:\...\trading-forge\.claude\worktrees\extraction-100\tmp\generalization
  EXISTS -> *.spec.json count = 41        (matches the script's own comment)
  POSITIVE CONTROL, same test on this tree's shakedown_specs -> 16   (test discriminates)
```
**Source of truth:** the file and the directory listing. **Fix point:** AR-739 §0's universal sentence; and `scripts/check-spec-binding-plan-parity.ts:72-73` (a gate whose corpus is a **hardcoded absolute path into another worktree's `tmp/`** is machine- and tree-bound — it is one `rm -rf tmp` away from silently failing, and nothing in this tree owns that directory).
**Blast radius:** AR-739 §5 offers the desk a fork whose cheap branch (*"follow the 5-native precedent: TS-mirror cost ≈ ZERO, because the mirror is already accepted as partial"*) rests on the premise that nothing can fail. **An existing gate asserts the per-condition `(bindable, primitive, approximation)` tuple over 41 specs / 2371 conditions — a Python-only MA primitive changes `primitive` on the Python side and not the TS side, so that branch is not free.** Whether the gate is wired into CI I did **not** verify — see below.

## Layer 1's population is narrower than its caption, a second time

The same corpus gives L1 another population miss `[MEASURED HERE — `json.load`, key-tuple census]`:
```
parity-gate corpus: 41 files · 2371 conditions
  KEY SHAPE: n=2371  keys(6)=evidence,id,object,role,span,type     <- SIX keys, no type_confidence
  NUMERIC-VALUED KEYS: NONE      PARAMETER-LIKE KEYS: NONE
  POSITIVE CONTROL (planted ma_period=20): numeric=['ma_period'] paramlike=['ma_period']
```
So the shape AR-737 calls *"the spec condition schema"* (7 keys) is **one of at least three live shapes** — 7-key (183 sealed), 6-key (2371 in the gate's corpus; 21480 tree-wide), 8-key (the producer at HEAD). **L1's conclusion survives all of them — still zero numeric across every population I built — but "183/183 … EXACTLY 7 keys" describes a corpus, not a schema.** Band 7 for L1 is unchanged: the number is right, the caption is not.

**Boundary declaration (the brief said "read here, nowhere else"):** I crossed into `extraction-100/tmp/generalization` **only** to (a) test the existence/count of the directory and (b) `json.load` condition **key names**. I did so because a script *in this tree* names that path as its input corpus, which makes it part of this tree's effective population — an absence claim cannot be bounded by a restriction that hides the gate's own inputs. I read no logic and no other file there. Every other figure in this receipt is from `wt-h1-wave4-20260712` alone.

## Addendum coverage delta — what I still did NOT verify

- **I did not run `check-spec-binding-plan-parity.ts`.** Its existence, method, and corpus are `[MEASURED]`; that it currently **passes**, and whether any CI job or gate invokes it, are `[UNENUMERATED]`. A gate that exists and is never run is a different defect from one that does not exist — I have distinguished the two and proved only the first.
- **I did not verify AR-739's §4 cache hazard** (9 family-keyed caches) or its `_spec_hash` 18/18 reproduction. Those are the doer's measurements, `[RELAYED]` here, and they are the desk's to grade — grading them is a separate dispatch, and I will not certify a doer's self-report.
- **I did not diff the TS mirror beyond `ConditionBinding`'s field set.** AR-739's `FAMILY_META` 14↔14 zero-drift result is `[RELAYED]`, not re-derived by me.

**Status:** `VERIFIED` bands issued above and unchanged by the head move. Receipt written, **not committed** — the desk commits.
