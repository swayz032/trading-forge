# INDEPENDENT GRADE — `P0-vNext` DESIGN @ `6bdb2e59`

**Grader:** `accuracy-validator`, dispatched by `R-539`. **Date:** 2026-08-02.
**Pinned object:** commit `6bdb2e5994e91aeddb08eb2ca885159d21b99100` · design blob `e285449694d70390e0412983a60054f2823e9434` (`115787` bytes, `604` lines) `[MEASURED HERE: git cat-file -t → commit / blob; git diff --stat 6bdb2e59 -- <path> → EMPTY, so the working copy is byte-identical to the pin]`.
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` `[MEASURED HERE]` — the campaign tree, not the container cwd.
**Host:** node `v24.13.0` `[MEASURED HERE]`.

> ⚠️ **TREE STATE AT GRADE TIME.** `ADVISOR-RULINGS.md` already carries `R-539` (committed `316f8819`) and `AGENT-REPORTS.md` carries an **uncommitted** `AR-584` `[MEASURED HERE: git status --porcelain → ` M docs/designs/AGENT-REPORTS.md`]`. A **seventh round is in flight while I grade the sixth.** This verdict describes `6bdb2e59` and nothing later. Any edit landing after this file is written is **outside** it.

> ★★★ **DECLARED LINEAGE, PER MY OWN INDEPENDENCE RULE.** I previously graded the `P1`/`P2` truth-freeze census (2026-08-01) that established this design's `43` rows / `301` cells frame. **That figure is therefore NOT an independent corroboration when I state it here** — it is my own prior measurement, and I do not re-certify it in this document. Every other measurement below is fresh.

---

## 0 — VERDICT IN ONE LINE

**The six delivered items are real and my independent re-parse corroborates every count `AR-583` published.** `[MEASURED HERE]` **But `AR-583`'s load-bearing phrase `MUTATION-JOIN CLOSED` is FALSIFIED on two independent axes, and the closure is not repairable by another prose round.** The document is unusually honest and the activity producing it is the wrong activity — see §Q2.

---

## 1 — INSTRUMENT AUDIT, RUN BEFORE ANY FINDING WAS FILED

`R-539 §2` records `4/4` of that desk's apparent findings being its own tooling. I assumed the same base rate and audited first. **Two of my own instruments were faulty and both are recorded here rather than silently fixed:**

1. **My probe harness referenced a file I never wrote** (`./ident.cjs`) and died `MODULE_NOT_FOUND`. Fixed in my harness. Not an artifact defect.
2. 🛑 **My subcase-concreteness classifier reported `4` prose subcases. Two of them — `window.__ledger` (35b) and `process.env.LEDGER_PATH` (36) — are CONCRETE CODE.** My `codeish` regex keyed on `=(){}[]` and the keyword `global`, and neither string contains any of them. **The true count is `2`, not `4`.** `[MEASURED HERE, classifier re-read]` Had I filed the `4`, it would have been tonight's fifth instrument-manufactured finding.
3. ✅ **A conflation I nearly filed and did not:** `AR-583`'s headline `38/38` and `R-539 §1`'s `MANIFEST: 39 records` are **different objects** — `38/38` is the worker's own acceptance-script tally (`AR-583 §6`), `39` is the manifest record count (`AR-583 §3`). `[ARTIFACT-SOURCED, both read in full]` **No discrepancy. A count mismatch between two captions is not a finding until you have joined them to the same object.**

**Positive control on my document matcher, taken on the surface the absence claims are about:** I planted `module.exports`, `CommonJS`, `this.` and `import.meta` into a COPY of the design and re-ran the identical matcher. `[MEASURED HERE]` Real doc → `0,0,0,1`; planted doc → `1,1,1,2`. **The matcher CAN see all four tokens in this file at this encoding, so its silence on the first three is a measured absence, not a blind spot.**

---

## 2 — WHAT I CORROBORATED (the honest positives — these are NOT findings)

All via a Python parser I authored, reading the pinned blob — **a different language and a different author from both the worker's node acceptance script and the desk's node parser**, i.e. a genuine second path, not a re-run of theirs.

| claim | source | my independent result | verdict |
|---|---|---|---|
| matrix `49+1=50`, contiguous `1..50`, zero dupes, control last | `AR-583` / `R-539` | **`50` rows, `[1..50]` exact, zero duplicates, row `50` = `clean control — unmutated`** | ✅ CORROBORATED |
| un-anchored row-shape count = `55` (published as the design's own control) | design L459 | **`55`; delta = `5`, exactly the `:254–258` field-mapping table** | ✅ CORROBORATED |
| manifest = `39` records | `AR-583 §3` / `R-539 §1` | **`39` records, all three columns non-empty on every one** | ✅ CORROBORATED |
| every manifest catcher cites a real matrix row | `AR-583 §3` | **rows cited but absent from `1..50` = `[]`** | ✅ CORROBORATED |
| claim-`A` denominator arithmetic | design L44–L50 | `43×5=215` · `172+43=215` · `172·1+43·3=301` · `43×7=301` · `140+9+152=301` — **all five reconcile** | ✅ CORROBORATED |
| row `40` getter invocation count `0` under `getOwnPropertyDescriptors` | design L222 | **invocations `= 0`** | ✅ CORROBORATED |
| row `44` negative control must MISS the symbol | design L508 | `Object.keys(getOwnPropertyDescriptors(v))` → `["id"]`; `Reflect.ownKeys` → `["id","Symbol(ledgerRead)"]` | ✅ CORROBORATED |
| row `46(a)` sparse-hole own keys | design L182 | `Object.getOwnPropertyNames([1,,3])` → `["0","2","length"]` | ✅ CORROBORATED |

**Parser controls:** POSITIVE — the bolded `| **3** |` and `| **50** |` rows both parse (the exact blindness that manufactured `R-539`'s false contiguity gap). NEGATIVE — the header row `| # | mutation |` is present and does **not** parse. Manifest NEGATIVE control — a synthetic `atomX  subcaseY  99` line **does** parse, so the record matcher is not vacuously empty.

---

## 3 — HUNT RESULTS: SIX NOVEL DISCREPANCIES

None of these is `F-1`, `F-2a`, `F-2b` or the `L225` stale carrier. Those four are already confirmed and I do not re-litigate them.

---

### Discrepancy G-1: the CommonJS module-wrapper `this` is a live ledger channel that no `1b-S` row names, no atom derives, and no matrix row catches
**Severity:** CRITICAL (false green — a measured leak through a channel the closed set claims to have closed)

**Claim:** `1b-S` presents six surfaces as CLOSED SETS — *"Every surface below is a CLOSED SET — anything not listed is FORBIDDEN"* (design L107) — and `AR-583 §3` publishes `atoms with NO plantable subcase ..... EMPTY`.

**Reality:** `[MEASURED HERE, node v24.13.0, EXECUTED]` A CommonJS module with **zero imports, zero dynamic-load constructs, zero `let`/`var`, zero `globalThis`/`window`/`process` references, no setter export, and one grammar-conformant deeply-frozen constant** accepts an externally injected ledger reader and returns the ledger value from `project()`.

The whole module, printed entire (`269` bytes):

```js
const AXES = Object.freeze(["bindable", "session_zone", "approximation", "primitive", "reason"]);

this.project = function project(lane) {
  const hook = this.__reader;
  if (hook) { return { value: hook(lane) }; }
  return { value: lane.value };
};

this.AXES = AXES;
```

```
BASELINE (no injection)   project({value:"FROM_LANE"}) -> {"value":"FROM_LANE"}
AFTER external write  m.__reader = <ledger reader>
INJECTED                  project({value:"FROM_LANE"}) -> {"value":"EXPECTED_FROM_LEDGER"}
```

**Sources compared:**
- **source A — execution.** The leak succeeds. `[MEASURED HERE]`
- **source B — token scan of that exact source against every construct the `1b-S` FORBIDDEN columns enumerate.** `[MEASURED HERE, all 15 printed whole]` `import(` F · `require` F · `eval` F · `new Function` F · `createRequire` F · `globalThis` F · `window` F · `process` F · `let ` F · `var ` F · `export const` F · `module.exports` F · `exports.` F · `import ` F · `get `/`set ` F. **Positive control: the same scanner returns TRUE for `globalThis` on a module that does read it.**
- **source C — is `this` reachable by the ambient row's quantifier *"any host-global identifier not in the allow-list"*?** `[MEASURED HERE]` top-level `this === module.exports` → **true**; `this === globalThis` → **false**; `typeof globalThis.exports/module/require` → **`undefined`,`undefined`,`undefined`**. Positive control on the same test: `Object === globalThis.Object` → **true**, so the test *can* identify a genuine ambient global. **`this` is provably not a host global, so the ambient row cannot reach it.**
- **source D — does the document name the channel at all?** `[MEASURED HERE, planted positive control above]` `module.exports` = **0** occurrences · `CommonJS` = **0** · `commonjs` = **0** · `ESM` = **0** · `module system` = **0** · `__dirname` = **0** · `__filename` = **0** · `this.` = **0**. `import.meta` = **1**, and that one occurrence is L564, as an *argument to* `createRequire` — the document treats it as benign plumbing, never as a channel.

**Source of truth:** execution. The value crossed the boundary.

**Why the one row that might have covered it cannot be relied on:** the `free / captured references` row's FORBIDDEN cell reads *"any other free or captured reference, including closures over injected values"* — broad enough that an implementer **might** generalize it to the CJS wrapper binding. But `this` is a `ThisExpression`, not an identifier reference and not a binding a scope analyser resolves, so an implementation enumerating unresolved identifiers never sees it. **And that same row's ALLOWED cell is `only the deeply-frozen constants above`, which is exactly the cell `F-1` already proves unconstructible** (it excludes the ambient `Object` the admitted grammar requires). **The only row that might catch G-1 is the row already known to be broken.** `[ARTIFACT-SOURCED + CORROBORATED by F-1]`

**Fix point:** the design must PIN ITS MODULE SYSTEM and then close the wrapper surface for the one it pins. `1b-S` surface table, design L108–L115 — a seventh row, or an explicit `module: ESM only, verified at build` constraint. In ESM this exact channel is closed (`typeof this` at ESM top level → **`undefined`** `[MEASURED HERE]`), so **pinning ESM is a one-line fix and pinning nothing leaves it open.**

**Repro:** `node C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/b2a97776-2c77-4425-9ce5-f8cd0c82d1f4/scratchpad/probe/run.cjs` (writes `out1.txt`).

**Blast radius:** the entire `1b-S` closed-set claim, `AR-583 §3`'s four-direction EMPTY join, and matrix row `34`'s promise to reject *"a CLOSURE OVER AN INJECTED VALUE… no export at all"* — the design's own name for precisely this channel, which it then never plants (see G-4).

---

### Discrepancy G-2: the atom population is derived from the FORBIDDEN columns while the contract's closure lives in the ALLOWED columns — so the completeness instrument cannot see any channel nobody wrote down
**Severity:** CRITICAL (the completeness claim's instrument is structurally blind in the direction it claims to measure). **This is the root cause of G-1 and, I argue in §Q2, of the flat finding rate.**

**Claim:** design L525, whole line: *"**THE POPULATION IS DERIVED FROM THE CONTRACT TEXT**, NOT HAND-LISTED, AND NOT SELECTED FROM THE CATCHER TABLE. `[MEASURED HERE — atoms extracted mechanically from the GRAMMAR's `FORBIDDEN` list, its explicit `→ FORBIDDEN` decisions, the `1b-S` table's FORBIDDEN column SPLIT PER CHANNEL, and the DEEP-frozen clause]`"* — followed by `atoms with NO plantable subcase ..... EMPTY`.

**Reality:** the derivation names **four** sources and **all four are the FORBIDDEN side.** `[MEASURED HERE, full line printed]` But the contract's *closure* is asserted on the ALLOWED side. Printed whole `[MEASURED HERE]`, the six `1b-S` ALLOWED cells are:

| surface | ALLOWED (the closed set) |
|---|---|
| imports | **none** in the preferred form; otherwise an enumerated, frozen allow-list … |
| dynamic loading | **nothing** |
| exports | `project` · immutable plain-data schema constants |
| module-scope state | **DEEPLY-FROZEN plain-data constants ONLY** |
| direct ambient reads | **nothing** |
| free / captured references | only the deeply-frozen constants above |

**Four of six ALLOWED cells are `nothing` / `none` / `only the constants above`.** The complement of `nothing` is unbounded. **An atom set enumerated from FORBIDDEN representatives can never be complete over a closed set whose complement is infinite** — so `atoms with NO plantable subcase = EMPTY` is a statement about the FORBIDDEN enumeration's self-consistency, **not** about the ALLOWED closure it is offered as evidence for.

**Sources compared:** [derivation sentence: 4 FORBIDDEN-side sources | ALLOWED cells: 4 of 6 are the empty set | manifest: 39 atoms, every one traceable to an enumerated FORBIDDEN item].

**Source of truth:** the ALLOWED column, because that is where the design puts the closure (L107: *"anything not listed is FORBIDDEN"*).

**Positive-control witness that the blind spot is real and not theoretical:** **G-1 is the witness.** A concrete channel exists in the complement, delivers the ledger value, and produces **zero** atoms under the published derivation. `[MEASURED HERE]`

**Fix point:** design L525 — the derivation must run **complement-first** (enumerate the language constructs each ALLOWED cell admits, then treat every construct outside it as an atom), or the manifest must relabel its result as *"consistent over the enumerated forbidden channels"* and stop being cited as completeness. **This is my own memory's `presence_derived_denominator` pattern: the artifact freezes one dimension against self-authorization and leaves the other derived from what happens to be written down.**

**Blast radius:** `AR-583 §3` item 2 in full; `R-536 §4`'s entire "derived population" remedy; every future round that uses the four-direction EMPTY as a closure signal.

---

### Discrepancy G-3: five manifest subcases redden via the admitted AST grammar, not via the catcher the manifest names — and row `37`(c)/(d) demand a result their named catcher cannot produce
**Severity:** HIGH (five pre-registered FAILED proofs, by the design's own law)

**Claim:** design L523: *"`A MUTATION CAUGHT BY THE WRONG CHECK IS A COINCIDENCE, NOT A PROOF.` A row that reddens via a different mechanism than the one named is a FAILED proof even though the run was red."* And row `37`'s catcher cell disclaims exactly one neighbour: *"NOT row `34`'s setter check."*

**Reality:** item `4` of this very delivery added `decl := "const" Ident "=" Frozen` as an **IFF over every module-scope constant** (L132: *"A module-scope constant is admitted IF AND ONLY IF its declaration matches"*). That grammar now also rejects five subcases whose manifest catcher is a different rule. `[ARTIFACT-SOURCED, executable lines read; grammar productions printed whole at L134–L138]`

| manifest subcase (verbatim) | named catcher | ALSO rejected by the admitted grammar because | discriminates its named catcher? |
|---|---|---|---|
| `export const configure = f => {HOLDER.r = f}` | 34(a) `1b-S` export/state surface | arrow initializer; `Frozen` has no arrow production | **NO** |
| `export const getLedger = () => ledger` | 34(b) same | arrow initializer | **NO** |
| `export const reset = () => {HOLDER.r = null}` | 34(c) same | arrow initializer | **NO** |
| `const S = new Reader()` | 37(c) `1b-S` module-scope-state row | `new` is named in the forbidden-form list (L145) | **NO** |
| `const H = {}; H.r ??= readLedger` | 37(d) same | bare `{}` is not `Frozen` (needs an `Object.freeze` wrapper) | **NO** |

**And the sharper half — a required result the named catcher structurally cannot produce.** Row `37`'s required result, whole: *"RED — build fails, **the mutable binding NAMED**"*. `[ARTIFACT-SOURCED, L501 printed whole]` **Subcases (c) and (d) contain no mutable binding.** `S` and `H` are both `const`; in (d) the mutability lives in the *object*, not the *binding*. The module-scope-state row can name nothing, because there is nothing of that kind to name. Row `34`'s required result — *"NAMES the injected symbol"* — is likewise not what a grammar rule reports; a grammar rule names the **declaration form**.

**Contrast that discriminates (the control that proves this is not a blanket objection):** `37(a)` `let cache = null` and `37(b)` `if(!c) c = readLedger()` **do** discriminate — the grammar is scoped to *constants*, so a `let` falls to the module-scope-state row alone. **Two of row 37's four subcases work and two do not**, which is exactly why this is a defect and not a category error.

**Source of truth:** the grammar production at L135, read as the executable line.

**Fix point:** design L546–L548 and L557–L558 — re-spell those five subcases so they escape the grammar (`export function configure(f){…}`, `let S; S = new Reader()`), **or** state that a subcase may be certified by any of N rules and drop the per-row `NOT <neighbour>` disclaimers. The two positions cannot both stand.

**Blast radius:** rows `34` and `37`, i.e. `8` of `39` manifest records; and the credibility of the `NOT <neighbour>` disclaimer column generally, which now disclaims one neighbour while a second neighbour — **added in the same round** — silently subsumes it.

---

### Discrepancy G-4: `34(d)` is the one manifest subcase that is neither concrete nor plantable in isolation
**Severity:** HIGH (an atom whose "plantable subcase" cannot be planted without instantiating a different row's channel)

**Claim:** the manifest's column 2 header is `PLANTED MUTATION SUBCASE (concrete)`, and `AR-583 §3` describes each record as `ATOM → CONCRETE PLANTABLE SUBCASE → NAMED CATCHER`.

**Reality:** `[MEASURED HERE, concreteness census over all 39 records, after correcting my own classifier fault — see §1]` exactly **two** subcases contain no code: `35(d)` *"an arbitrary free host identifier"* and `34(d)` *"closure over an injected reader, no export"*.
- **`35(d)` is defensible** — the design says explicitly it exists *"to exercise the QUANTIFIER rather than the enumerated three"* (L499). Prose is the correct form for a quantifier probe. **Not a finding.**
- **`34(d)` is not.** Its own row text stipulates the conditions: *"a CLOSURE OVER AN INJECTED VALUE (free/captured reference, **no export at all**)"* while row `34`'s premise is *"the **IMPORT GRAPH STAYS CLEAN**"*. With no export, no import, no dynamic load, no ambient read and no mutable module-scope binding, **there is no channel through which a reader can be injected.** `[HYPOTHESIS → tested]` Every concrete form I could construct instantiates another row's channel — and the one form that genuinely works is **G-1's CJS wrapper `this`**, which is a channel the document never names.

**Source of truth:** the row's own stipulations, which are mutually exhausting.

**Fix point:** design L549. Either give `34(d)` a concrete plantable body — in which case it will be G-1's channel or a duplicate of `26`/`35`/`37`/`41` — or withdraw the subcase and say the promise has no independent catcher.

**Blast radius:** `AR-583 §3`'s `atoms with NO plantable subcase ..... EMPTY`. **The atom `free / captured reference` has a subcase in the manifest and, as written, no plantable instance — which is the exact condition that line asserts is empty.**

---

### Discrepancy G-5: `project` itself — the one mandated export — cannot be declared in any form the `1b-S` closed sets admit
**Severity:** MEDIUM (unconstructible mandated artifact; **same shape as `F-1`, different object — lineage declared**)

**Claim:** `1b-S` exports row ALLOWED = `` `project` · immutable plain-data schema constants ``.

**Reality:** `[MEASURED HERE for form A; ARTIFACT-SOURCED for form B]`
- **Form A — `export function project(lane){…}`.** A module-scope `function` declaration is a **reassignable** binding. Executed: `function project(){return "ORIGINAL"}` then `project = function(){return "REASSIGNED"}` → `before=ORIGINAL after=REASSIGNED`, **reassignable = true**. The module-scope-state row FORBIDS *"any mutable module-scope binding"*. → **FORBIDDEN.**
- **Form B — `export const project = (lane) => {…}`.** `decl := "const" Ident "=" Frozen`, and `Frozen` has no function/arrow production; L145 forbids *"function or arrow expressions"* by name. → **NOT ADMITTED.**

**Source of truth:** the grammar production (L135) and the module-scope-state FORBIDDEN cell (L113), read as executable lines.

**Fix point:** the `1b-S` module-scope-state row must carve out function declarations, or the grammar must gain a production for the single admitted function. **I flag the lineage honestly: this is the same "the promised GREEN neighbour is unconstructible" species as `F-1`, and a reviewer may reasonably fold it into `F-1`'s remedy rather than treat it as a seventh item.**

**Blast radius:** the `PREFERRED FORM: A ZERO-IMPORT LEAF` and every green neighbour that assumes a compliant module can exist.

---

### Discrepancy G-6: the composite admission walk has no home, and neither `4a` nor `4b` covers the module it lives in
**Severity:** MEDIUM (unenumerated boundary — the surface that decides admission is itself unaudited)

**Claim:** two placements, both operative, in one document. `[ARTIFACT-SOURCED, both lines read whole]`
- L150: the two `1b-R` checks are *"BOTH EXECUTED AT THE CALL BOUNDARY **BEFORE `project()` READS ANY FIELD**"* — whole-value admission, then projection.
- L189: *"**`project()` READS NO FIELD BEFORE THAT FIELD'S DESCRIPTOR IS ADMITTED.**"* — per-field, just-in-time admission **inside** `project()`.

**Reality:** these are different mechanisms with different homes, and the design's own scoping makes the difference load-bearing.
- `4a`'s scope is *"`project()`'s module text and its frozen import closure"* (L206), and **every** `1b-S` row is scoped to `project()`'s module.
- Rows `39`–`47` each stipulate *"module source SPOTLESS"*, which reads as the walk living **outside** `project()`'s module.
- **If outside:** no rule constrains that module. It receives the entire lane object and decides admission. **A ledger reader there is a false green with no catcher in the matrix** — and §7's binding property closes *parsed objects*, not *modules*, so it does not reach either.
- **If inside:** the walk needs `Object.getOwnPropertyDescriptors`, `Reflect.ownKeys`, `Object.getPrototypeOf`, `Array.isArray` — all ambient host globals against an ambient row whose ALLOWED is **`nothing`**. That is `F-1`'s contradiction, arriving through a second door.

Note the per-field reading is also not merely stylistic: a **cycle** check and a **whole-graph recursive prototype-identity** check cannot be performed "before `project()` reads any field" if admission is interleaved field-by-field.

**Source of truth:** undetermined by the document — which is itself the finding. This is exactly the defect the grammar section was written to close (L131: *"naming the TypeScript compiler API says **WHO** decides, never **WHAT** it decides on… Four incompatible implementations all read as compliant against the prose alone"*), reappearing one surface over, on the mechanism rather than the syntax.

**Fix point:** L149–L150 and L189 — name the walk's module and place it under a named contract.

---

### G-7 (LOW, recorded for completeness): matrix row `7` is not a mutation
`[MEASURED HERE, join key = the fixture/axis population]` The caption binds `49 MUTATIONS PLUS 1 CLEAN CONTROL` (L456). Row `7` describes `3` rows × `3` axes in `40-overrefusal-boundary` with *"both lanes emitting `approximation=True` · a concrete `primitive` string · `session_zone=null` (`6` NON-NULL, `3` NULL)"* and requires **GREEN**. Design L79 records that identical state — *"NINE N/A-AXIS VALUES: 6 NON-NULL, 3 NULL · TS vs PYTHON: 9 COMPARED, 9 AGREE, 0 DISAGREE"* — as the **measured live baseline**. Row `7` therefore mutates nothing; it is a second unmutated observation. The true composition is `48` mutations + `2` unmutated rows. ⚠️ **This is minor and row `7` still discriminates** (an implementation that treats `NOT-APPLICABLE` as a claim-`A` exception fails it), so it earns its place in the matrix — only the caption's noun is wrong. Given this document has recomputed that caption **eight** times, the noun is worth one line.

---

## 4 — GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **`AR-583` delivery — the six items as executed edits** | **6** | **VERIFIED** | Independent Python re-parse of the pinned blob: matrix `50`/contiguous/control-last, un-anchored `55`, manifest `39`, all catchers real rows, claim-`A` arithmetic reconciles `5/5`; item `6` citation fix confirmed; `[PRE-REGISTERED — NOT EXECUTED]` labelling is accurate and self-imposed | Item `2`'s `MUTATION-JOIN CLOSED` falsified by **G-2** (FORBIDDEN-side derivation) and **G-3** (join keyed on declared, never actual, catcher); item `4`'s grammar created 5 failed pre-registered proofs |
| **`P0-vNext` design as a specification @ `6bdb2e59`** | **5** | **VERIFIED** | Seven adversarial rounds, most findings measured by execution; honest-partials, retired absolutes, published un-anchored control, correct Phase-1 refusal | **2 CRITICAL open (G-1, G-2) + F-1/F-2a/F-2b already confirmed**; unimplemented and unexecuted |

**Reconciliation, since `AR-583` did not claim a band and `R-539 §1` recorded `no defect found`:** I am not contradicting `R-539` — its `§1` scope was *"every surface I reached"*, and every count it reached, I reach the same answer on. **The divergence is in coverage, not in measurement.** `R-539` verified the document against itself; I ran the document's rules against a JavaScript runtime, which is where G-1 lives.

⚠️★★★★★ **BAND `5` IS CAPPED BY THE ARTIFACT CLASS, NOT BY EFFORT OR AUTHORSHIP.** My rubric reserves `7–8` for *adversarially tested with residual risks documented*. **There is nothing to test.** No amount of further prose revision moves this object past `6`, because bands `7+` require execution against the thing and **no implementation exists**. That fact is the whole of §Q2.

---

## Q2 — THE BAR-CALIBRATION ANSWER

**Measured round-over-round structural findings: `9, 5, 2, 3, 3, 3` (`R-532`→`R-538`) `[RELAYED from dispatch]`, then `R-539` = `2` new + `F-1` + the `L225` carrier, then this grade = `6` novel.** The rate is not decaying. It is flat, and the seventh and eighth passes each found more than the trailing average.

### The answer is **(b) and (c) jointly, with (c) operative.** (a) is falsified.

**(a) CONVERGING is FALSIFIED** `[MEASURED HERE]`. A converging process has each round's findings narrower and inside the previous round's surface. Mine are not: **G-1 is a whole module-system channel absent from `604` lines**, and **G-2 is a defect in the completeness instrument itself** — an instrument built two rounds ago specifically to answer "are we done?".

**(b) UNBOUNDED SURFACE is TRUE as a description, and I can point at the mechanism rather than assert it.** `[MEASURED HERE]` **G-2 is the proof.** Four of six `1b-S` ALLOWED cells are `nothing`/`none`. The complement of `nothing` in a dynamic language is unbounded, and the manifest enumerates from the FORBIDDEN side. **A prose document closing an infinite complement by listing representatives has no finite stopping point** — each round writes down more representatives, and each new representative is a new surface with its own promise/catcher/spelling gap.

**The document itself is the corroborating second path on (b)** `[MEASURED HERE, token census over the pinned blob]`:
- `12` occurrences of *"THE PREVIOUS REVISION / PREVIOUS VERSION was wrong"* (L68, 73, 86, 94, 99, 102, 210, 234, 268, 285, 347, 577)
- `6` explicit self-convictions (*"IS MINE" / "MY OWN" / "convicts me" / "AGAINST MYSELF"*)
- `2` explicit *"the remedy reintroduced the defect"* admissions (L164, L420)
- L457: **the matrix caption has been recomputed EIGHT times** — `23`, `22+1`, `24+1`, `29+1`, `32+1`, `33+1`, `42+1`, `47+1`, `49+1` — *"each correct until the next rows landed"*
- L420: this family *"has now surfaced SIX times — **twice inside its own remedies**"*
- L221: *"**THE SWEEP IS NOT AN ACT; IT IS AN OBLIGATION THAT RE-ARMS ON EVERY ADDITION.**"*

**That last line is the bar diagnosing itself.** A closure obligation that re-arms on every addition, applied to a surface whose additions are unbounded, is a non-terminating loop — and the document says so in its own voice without drawing the conclusion.

**And the causal chain is measured, not inferred — each round's remedy produced the next round's findings:**
- `R-536 §4` added the derived atom manifest → **that manifest is G-2.**
- `R-537 §5` item `4` added the admitted AST grammar → **that grammar is `F-1` (needs ambient `Object`), `F-2a` (matches the spelling, not the intrinsic), `F-2b` (`__proto__`), and G-3 (subsumed five subcases' discriminating power).**
- **Four of the last two rounds' findings are defects in the last two rounds' fixes.**

**(c) MISCALIBRATED BAR is the OPERATIVE call, and the evidence is what actually produced every finding in this arc.** Sort every real advance by how it was obtained `[ARTIFACT-SOURCED across the rulings + MEASURED HERE for mine]`:

| finding | how it was found |
|---|---|
| `R-534 §1` — `const HOLDER = {}` leak past a keyword check | **executed node probe** |
| `R-535 §2` — nested shallow-freeze reaches `project()` | **executed node probe** |
| `AR-579 §3` — own-descriptor walk misses prototype capabilities | **executed node probe** |
| `AR-580 §2` — `RangeError` on cycles; `Object.keys` symbol-blind; DAG false-reject | **executed node probe** |
| `R-539 §3` — shadowed `Object.freeze`; `__proto__` key | **executed node probe** |
| **G-1 (this grade)** | **executed node probe, ~15 minutes** |

**Every single one.** Not one came from reading the prose more carefully. The rounds that read produced instrument faults (`R-539 §2`: `4/4` of that desk's apparent findings were its own tooling; mine: `2` of `3`).

**The bar demands a property of an IMPLEMENTATION.** *"What does a TypeScript-compiler-API rule admit, over the set of JavaScript programs?"* is a question about a program's behaviour on a language. **A document cannot answer it and a reviewer cannot verify the answer by reading.** The design says this about itself at L131 without acting on it: *"naming the TypeScript compiler API says **WHO** decides, never **WHAT** it decides on."* **Closing the syntax in prose moved the problem from `WHO` to `WHAT` and left `DOES IT` untouched — and `DOES IT` is the only one that guards live capital.**

### Is continued design revision the highest-value next act? **No — it is displacement activity, and I will say so with the number.**

`[MEASURED HERE]` **Six rounds. `604` lines. `115787` bytes. Zero executable artifact. Zero mutations ever run against a gate — `AR-583 §7` states this in its own words: *"NO MUTATION HAS EVER BEEN RUN AGAINST THE GATE; NO CI EXECUTES ANY OF THIS."*** Meanwhile a `269`-byte module found a CRITICAL in fifteen minutes.

**The recommended next act, stated so it is actionable rather than a complaint:**

1. **Build the `1b-S` parser rule and the `1b-R` admission walk as an executable prototype.** Nothing else. Not the gate, not the three claims, not the scope registry.
2. **Use the `39`-record manifest as its test corpus.** ★★★★★ **This is the genuine asset six rounds produced, and it should be honoured rather than revised again:** `39` pre-registered, adversarially-derived mutation subcases with named expected catchers, written **before** any implementation existed. **That is a real pre-registration and it is rare.** Running it converts it from `[PRE-REGISTERED — NOT EXECUTED]` into a mutation-coverage RESULT — the exact upgrade `AR-583 §3` correctly refuses to claim today.
3. **Then G-2 becomes decidable.** Atom completeness is unanswerable in prose and answerable by differential testing: generate module sources, run the rule, diff admitted-vs-intended. **G-1 would have been caught on the first run by any such harness.**
4. **Fix G-1 in the design first, because it is one line** — pin the module system to ESM (`typeof this` at ESM top level → `undefined` `[MEASURED HERE]`) — and pin it before writing code, not after.

⚠️ **What I am NOT saying:** the bar's *content* is not wrong. *"No promise may exist without a matching catcher"* and *"a row number is not a catcher until the exact atom has been planted"* are correct laws and this campaign is right to hold them. **What is miscalibrated is the demand that a DOCUMENT discharge them.** Those two laws are satisfiable in an afternoon by a test runner and are not satisfiable by any finite number of prose passes. **`R-537 §7` pre-registered the right trigger and `R-539` fired it correctly rather than parking it — that judgment was sound; this is the answer it was waiting for.**

---

## MANDATORY COVERAGE SECTION

### 1 — What I verified, and via which non-overlapping paths

| claim | path A | path B | path C |
|---|---|---|---|
| pin identity | `git cat-file -t` on commit + blob | `git diff --stat 6bdb2e59 -- <path>` empty (worktree == pin) | `git rev-parse --git-common-dir` (correct tree) |
| matrix `50` rows contiguous | my **Python** section-anchored parse | `R-539 §1` node parse (RELAYED) | design's own published un-anchored `55` control, which my parse reproduces exactly (delta `5`) |
| manifest `39` records | my Python record matcher (3-column, controlled) | `AR-583 §3` + `R-539 §1` (RELAYED, agree) | catcher-to-matrix-row join: `[]` orphans |
| claim-`A` denominator `215`/`301` | first-principles recomputation, `5` independent identities all reconcile | design's published histogram | ⚠️ **NOT independent — the `43`/`301` frame is my own prior audit's output; lineage declared** |
| **G-1 leak** | **execution** (`project()` returned the ledger value) | **token scan of that exact source vs all 15 enumerated forbidden constructs** | **`this !== globalThis` + `globalThis.exports/module/require === undefined`**, proving the ambient row cannot reach it |
| **G-1 absence from the document** | grep, `8` tokens, whole lines | **planted positive control on a copy of the same file** | `import.meta`'s single occurrence read in context (L564) |
| G-3 | grammar productions read as executable lines (L134–L138) | manifest subcase strings extracted mechanically (L546–L558) | row `37`/`34` required-result cells printed whole |
| row `40`/`44`/`46(a)` runtime facts | my own node re-measure | design's cited `AR-578`/`AR-580` figures (agree) | — |

### 2 — Positive-control witnesses for every absence claim I make

| absence claim | positive control, taken on the same surface |
|---|---|
| `module.exports`/`CommonJS`/`this.` appear `0` times in the design | **planted each token into a copy of the design and re-ran the identical matcher: `0→1` on all three.** The matcher can see them at this encoding. |
| `import.meta` appears only as a `createRequire` argument | same planted control: `1→2`. Plus the one real hit printed whole. |
| the G-1 module contains no forbidden construct | the same scanner returns `TRUE` for `globalThis` on a module that reads it |
| `this` is not a host global | `Object === globalThis.Object` → `true` on the same test, so the test can identify a real ambient global |
| my matrix parser is not blind to bolded rows | it parses `| **3** |` and `| **50** |` (the exact blindness that manufactured `R-539`'s false gap); header row present and correctly rejected |
| manifest record matcher is not vacuously empty | synthetic `atomX  subcaseY  99` parses |
| **G-2's blind spot is real** | **G-1 is the witness — a channel in the complement producing zero atoms** |

### 3 — Join keys checked for every "identical / unchanged / matches" claim

- **pin vs worktree:** blob SHA `e2854496…` + `git diff --stat` on the exact path. Byte-identical.
- **`38/38` vs `39 records`:** joined on OBJECT, not on number — `38/38` = acceptance-script tally (`AR-583 §6`); `39` = manifest records (`AR-583 §3`). **Different objects; the apparent mismatch dissolves on the join.**
- **matrix rows ↔ manifest catchers:** joined on row ordinal. `{cited} − {1..50}` = `[]`.
- **row `7` ↔ baseline:** joined on the fixture/axis population (`3` rows × `3` axes, `6` non-null / `3` null, `40-overrefusal-boundary`). Identical → row `7` is not a mutation.
- **manifest subcase ↔ grammar:** joined on declaration form (`const` + initializer node type), not on the atom's prose label.

### 4 — WHAT I DID **NOT** VERIFY

1. 🛑 **I did not run a real TypeScript parser.** I have **not** measured what `ts.createProgram` actually does with `this` at CJS module scope, with `import.meta`, or with any of the five G-3 subcases. **G-1's *leak* is MEASURED; G-1's *"no rule catches it"* is a claim about the DOCUMENT's text, not about any implementation's behaviour.** An implementation reading the free/captured-reference row broadly might catch it. **This limitation is itself the §Q2 argument: the question is not answerable at the document layer, by me or by anyone.**
2. **I did not verify the ledger, `ORACLE.json`, the pinned specs, or the `c304b098` fixtures.** Membership, the `140`/`9`/`152` split, the `12` fixtures — all UNENUMERATED here. The `43`/`301` frame is **my own prior audit's output** and is declared lineage, not independent corroboration.
3. **I did not verify the two lanes.** `projectExhaustively()`, `BINDING_KEY_MAP`, `ConditionBinding.to_dict()` — I never opened `c304b098`. Surface 2's `[MEASURED at c304b098]` table is **RELAYED**.
4. **I did not verify §5's Phase-1 refusal, the `tier-a-compile-census.json` provenance, or Surface `B`.** UNENUMERATED.
5. **I did not verify claims `A`/`B`/`C`, contracts `2b`/`2c`, §6, §7, §8, §9, §12** except where a matrix row touched them. **Rows `1`–`33` were read but not adversarially probed; my hunt concentrated on `1b-S`/`1b-R` and the manifest** because that is where the last four rounds' findings clustered. **A defect in rows `1`–`33` would not have been found by this grade.**
6. **I did not test ESM `import.meta` as a working injection channel.** I measured that it exists, carries `["dirname","filename","main","resolve","url"]`, is not reachable as a global identifier, and is named once in the design as a `createRequire` argument. **Whether it can carry a ledger reader on this host is UNTESTED** — I raise it as a candidate under G-6, not as a finding.
7. **I did not re-derive `R-532`–`R-538`'s finding counts (`9,5,2,3,3,3`).** RELAYED from the dispatch. **My §Q2 conclusion does not depend on them** — it rests on the causal chain (remedy → next round's defect) and the found-by-execution census, both measured here.
8. **I did not read `AR-583-EXTERNAL-…-REVIEW` or re-confirm `F-1`/`F-2a`/`F-2b`.** Deliberate: the dispatch marked them CONFIRMED and asked for novel defects. **I cite `F-1` in G-1 and G-5 as CORROBORATED-BY-DISPATCH, never as my own measurement.**
9. **I did not verify anything after `6bdb2e59`.** `R-539` is committed and `AR-584` is uncommitted in this tree; a seventh round is editing the design while I grade the sixth. **This verdict describes `6bdb2e59` only.** In particular, `AR-584 §4` states an intent to forbid duplicate ordinary keys — **unrelated to and not covered by anything above.**

---

**Receipt:** probes retained at `C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/b2a97776-2c77-4425-9ce5-f8cd0c82d1f4/scratchpad/probe/` (`leaf.cjs`, `run.cjs`, `meta.mjs`, `out1.txt`, `out2.txt`) and `../parse_out.txt`, `../struct_out.txt`, `../q2_out.txt`. ⚠️ **Session-temporary paths — non-durable provenance, which is why every load-bearing number is reproduced inline above rather than cited by path.**
