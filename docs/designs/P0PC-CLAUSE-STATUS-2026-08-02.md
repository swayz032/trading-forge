# `P0PC` — ACCEPTANCE CLAUSE STATUS ON THE CURRENT OBJECT

**Authored 2026-08-02 by the working agent, under `R-591 §6`.**
**Task: report which printed values bear on each acceptance clause, and what they
currently are. NOT: whether any clause is MET.**

🛑 **`REPORT THE READINGS, NEVER THE VERDICT.` No clause below is graded. Every
`status` value is a statement about whether an INSTRUMENT EXISTS AND WHAT IT
PRINTED — never about whether the property holds. The MET/NOT-MET ruling is the
desk's, and then an independent grader's (`R-591 §6`, `grader-agent`).**

---

## 0. THE OBJECT UNDER MEASUREMENT — PINNED BEFORE ANY READING

```
campaign tree   C:/Users/tonio/Projects/wt-h1-wave4-20260712
branch          h1-wave4-sealed12-driver
HEAD at run     b203cba4
git status --porcelain -- prototypes/     EMPTY   (clean; no edit by me, R-591 §6 forbids edits)
```

**sha256 of all 11 `.mjs` in `prototypes/p0-vnext-admission/` at run time:**

| file | sha256 |
|---|---|
| `corpus.mjs` | `e377abc758897aa5dc3d49834634d81f803c58cfe648a8503ed37c75f7d78d27` |
| `emitted-freeze.mjs` | `a4da4708a7a5fba7b3b62b19ee8092b03a46fd150d54ba22e2fe5847c81c315c` |
| `fs-tracker.mjs` | `03ef8f0f4dde43b29ac6837f8c64ed8cef571a28c359bc3c34ac853d1b96b242` |
| `membership.mjs` | `be3639b42baa7ba09dbc589e5c929efe6b8c6b9b1d7f83ebcda75b93aeb29ea4` |
| `module-collections.mjs` | `cbb2cccfc164e3b85145857a0b5f4071688ad59a9d8127d3736063f66b5a5dff` |
| `module-tuple.mjs` | `63bbde8f75ac5fe5212379ff241baf945e6d2503df1883d3d6d49b4266683fba` |
| `red-proof.mjs` | `942b347357cc27cd5eecc63942d410e3c50562553a94fe314d93d81a192cb417` |
| `run.mjs` | `a85c3f0d3541cd465725140af06266eb451118da03e6ae229643b12c3786557e` |
| `runtime-admission.mjs` | `afa38b8d89e4bb822e78eeb3d33da683deffbcd35e7765db43ae96ae262f8627` |
| `source-admission.mjs` | `ae8ae16abc23745bf598cad3927c5c7e14d3f4d05fce20e717bbad5f8fe2f909` |
| `type-value-proof.mjs` | `0caab6bda2d9409ce3c931ca88017ab9ca5af066d236cf421f66c6a9543c7606` |

### 0a. WHICH SIX ARE "THE SIX SCRIPTS" — DERIVED, NOT RELAYED

`[MEASURED HERE]` — counted how many other `.mjs` import each file:

```
imported_by=0  ->  emitted-freeze.mjs · red-proof.mjs · run.mjs · type-value-proof.mjs
imported_by>0  ->  corpus(2) fs-tracker(1) membership(3) module-collections(2)
                   module-tuple(1) runtime-admission(2) source-admission(4)
```

⚠️ **So "the six" is not a clean entry-point partition: `module-collections.mjs`
(imported by 2) and `module-tuple.mjs` (imported by 1) are BOTH libraries AND
independently runnable.** The other four are pure entry points. **Stated because
"the six scripts" is a phrase I inherited, and it turns out to describe a
convention rather than a structural fact.**

### 0b. COMMANDS AND EXIT CODES — no pipe between `node` and `$?`

```
node run.mjs                 EXIT 0
node module-collections.mjs  EXIT 0
node module-tuple.mjs        EXIT 0
node emitted-freeze.mjs      EXIT 0
node type-value-proof.mjs    EXIT 0
node red-proof.mjs           EXIT 0
```
**stderr was 0 bytes for all six.** ⚠️ **Exit codes captured with no pipe and no
`/tmp` redirect — `AR-630 §4` was convicted on both (`$?` read `tail`'s status;
an MSYS `C:\` redirect failure returned `1` indistinguishable from a guard
firing). Captures went to the session scratchpad.**

---

## 1. THE ACCEPTANCE TEXT, VERBATIM FROM THE GRAPH JSON

**Source:** `docs/designs/V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json`, node `P0PC`,
field `acceptance`. **Quoted, never paraphrased:**

> "The six populations are disjoint and sum to the frozen 52; surface-invalid rows
> are inadmissible, mutation-as-type-error rows name the type checker, and only
> surface-valid fixture-valid rows may credit 1b-S. Type-only identifiers stay
> silent while the same spelling in value position is exclusively FREE_REF, with
> POSITION_UNCLASSIFIED fail-closed. Fixture scaffolding preserves emitted
> behavior. The effective compiler-emitter-loader tuple is an input; one source is
> executed as CJS and ESM; exactly one callable project export is required; every
> terminal acceptance failure exits non-zero after evidence collection while the
> restored control exits zero."

⚠️ **THE CLAUSE SPLIT IS MINE AND I AM DECLARING IT AS AN ASSUMPTION, NOT A FACT.**
The field is one string. I split it at its four SENTENCE boundaries, giving four
clauses. ✅ **Two independent corroborations that this is the desk's own
numbering:** `R-588 §2` cites *"clause `1`"* for *"mutation-as-type-error rows
name the type checker"* — sentence 1 ✅ · `R-591 §1.3` calls *"clause-4"* the one
whose status is UNKNOWN over exit-code/red-path behaviour — sentence 4 ✅.
**If the desk numbers them differently, the ROWS below still stand; only their
labels move.**

---

## 2. THE CLAUSE TABLE

| # | clause (verbatim fragment) | bearing prints | observed values @ `b203cba4` | status |
|---|---|---|---|---|
| **1a** | "The six populations are disjoint and sum to the frozen 52" | `run.mjs` → `LIKE-FOR-LIKE` block: `six_population_partition`, `partition_sums_to`, `partition_must_sum_to`, `rows_in_two_populations`, `rows_in_no_population` | `attributed 44 · honest_named_miss 3 · surface_invalid 0 · fixture_invalid 0 · caught_by_typechecker 5 · position_unclassified 0` · `partition_sums_to: 52` · `partition_must_sum_to: 52` · `rows_in_two_populations: []` · `rows_in_no_population: []` | **READING_PRESENT** |
| **1b** | "surface-invalid rows are inadmissible" | `run.mjs:765` FAILURE_CLASS `surface_invalid_rows`, fires on `surface_invalid > 0`, message *"the number is INADMISSIBLE"* · reachability witness: `red-proof.mjs` row `surface_invalid_rows` | gate condition present and reachable: `PASS surface_invalid_rows exit=1` under injection; `0` members in the clean run | **READING_PRESENT** |
| **1c** | "mutation-as-type-error rows name the type checker" | `run.mjs` → `TYPE-CHECKER OWNERSHIP JOIN (item 14)` block, keyed `(row, owned expression, span, expected defect)` | `6` rows join, each with declared-vs-saw and a span: `34(d-u)` TS2304@L1:46 · `52(a)` TS1117@L1:33 · `52(b)` TS1117@L1:33 · `52(c)` TS1117@L1:33 · `52(d)` TS1117@L1:33 · `54(c)` TS2532@L2:1 + TS2540@L2:40 | **READING_PRESENT** |
| **1d** | "only surface-valid fixture-valid rows may credit 1b-S" | `run.mjs:604-605` (`SURFACE_INVALID`/`FIXTURE_INVALID` are their own partition members, so they cannot land in `attributed`) · `run.mjs:765` · `red-proof.mjs` rows `surface_invalid_rows`, `fixture_invalid` | **both excluded populations are EMPTY in the clean run (`0` and `0`)**, so no row is observed being denied 1b-S credit; the injections that populate them **fail the gate (`exit=1`) rather than printing a credit-denial** | 🛑 **READING_AMBIGUOUS** |
| **2** | "Type-only identifiers stay silent while the same spelling in value position is exclusively FREE_REF, with POSITION_UNCLASSIFIED fail-closed" | `type-value-proof.mjs` → `THE D/E PROPERTY`, `RESIDUAL REACHABLE`, the 15-case table · `run.mjs` partition `position_unclassified` · `red-proof.mjs` row `position_unclassified` | `D (type-only) -> ADMITTED, FREE_REF on Widget = 0` · `E (value-only) -> REJECTED, FREE_REF on Widget = 1` · `same spelling in both arms: true` · `RESIDUAL REACHABLE ... : true [POSITION_UNCLASSIFIED,POSITION_UNCLASSIFIED]` · `15 / 15 cases pass` · `position_unclassified: 0` in the clean partition · `PASS position_unclassified exit=1` | **READING_PRESENT** |
| **3** | "Fixture scaffolding preserves emitted behavior" | `emitted-freeze.mjs` → the 39-row table, the roll-up line, `MEMBER SET (item 16)`, `COMPARATOR CONTROLS`, `BLINDNESS WITNESS`, and the per-change pre-registered diffs | `rows compared: 39 | COVERED by emit: 37 (EMIT-IDENTICAL 29, CHANGED 8) | NOT-COVERED-BY-EMIT: 2 [26(a), 26(b)] | UNDECLARED: 0` · `member failures 0` · `annotation-only edit reads IDENTICAL: true | behaviour edit reads DIFFERENT: true` · `BLINDNESS WITNESS ... IDENTICAL=true, module-edge path convicts=true` · each of the `8` CHANGED rows prints a PRE-REGISTERED reason with its was/now diff | **READING_PRESENT** |
| **4a** | "The effective compiler-emitter-loader tuple is an input" | `run.mjs` → `EFFECTIVE-MODULE TUPLE (reference, fixture.ts)` + `TUPLE CROSS-CHECK` · `module-tuple.mjs` (whole output) | tuple printed as a record (`format ESM`, `decidedBy nearest package.json "type":"module"`, `tsVersion 5.9.3`, `module/moduleResolution NodeNext`) · `TUPLE CROSS-CHECK (my derivation vs ts.impliedNodeFormat): AGREE on all rows` · `red-proof.mjs`: `PASS tuple_disagreement exit=1` | **READING_PRESENT** |
| **4b** | "one source is executed as CJS and ESM" | `run.mjs` → `TWIN ASSERTION (item 7)` · `module-tuple.mjs` → both arms · `red-proof.mjs` row `twin` | `PASS 54 (twin.cts) vs …(twin.mts) | sameBytes=true (131B) | CJS->only-module-system=true | ESM->admitted=true` · `PASS 54(b) … sameBytes=true (96B)` · executed: ESM `typeof this = "undefined"`, CJS `typeof this = "object"` with the CJS arm as the POSITIVE CONTROL · `PASS twin exit=1` | **READING_PRESENT** |
| **4c** | "exactly one callable project export is required" | `run.mjs` rows `55(a)`–`55(d)`, catcher `1b-S:exports` | `55(a) empty module (no project at all)` · `55(b) only an unrelated const export` · `55(c) only a helper function export` · `55(d) non-callable project export` — all four `ATTRIBUTED 1b-S:exports` | **READING_PRESENT** |
| **4d** | "every terminal acceptance failure exits non-zero after evidence collection while the restored control exits zero" | `red-proof.mjs` → `CONTROL (no injection)` line, the 43 `PASS` rows, `CONTROL GREEN:` line, `VERDICT:` line · the `allOk` conjunction at `red-proof.mjs:604` | `CONTROL (no injection) exit=0 GREEN <- the discriminator: this suite is not always-red` · every one of the 43 rows `exit=1` · `CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 43 / 43` · `VERDICT: the runner is an ENFORCING GATE` · `allOk = controlOk && countOk && identityOk && provenanceOk && completenessOk && effectOk && rows.every(r => r.ok)` | **READING_PRESENT** |

---

## 3. 🛑 THE `25` vs `43` DISTINCTION — RE-DERIVED HERE, NOT RELAYED FROM `R-591`

**`R-591 §1.3` reported that `43/43` was joined to the wrong population. I did not
take that on report — it is a claim about the object I was sent to measure.**

**TWO DIFFERENT PRINTS, TWO DIFFERENT POPULATIONS, BOTH LIVE AT `b203cba4`:**

```
red-proof.mjs:601   COMPLETENESS (F-4): all 25 of run.mjs's declared FAILURE_CLASSES
                    have a demonstrated red path — ASSERTED, not assumed.
red-proof.mjs:606   CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 43 / 43
```

**WHERE EACH DENOMINATOR COMES FROM `[MEASURED HERE, executable lines read]`:**

- **`43` = `EXPECTED_ROW_COUNT`**, defined at `red-proof.mjs:452` as
  `CLASSES.length + SHARED.length + EXPECT.length + FREEZE_EXPECT.length + STANDALONE_ROWS`
  — **all four are `red-proof.mjs`'s OWN tables.**
- **`25` = `declaredFailureClasses.length`**, and the join is REAL, not a
  hand-copy: `red-proof.mjs:589` reads
  `extractModuleCollections(fs.readFileSync(RUNNER, 'utf8'), 'run.mjs').get('FAILURE_CLASSES')?.keys`
  — **it parses `run.mjs`'s source and takes that file's declared class list.**

**COUNTED INDEPENDENTLY, WITH THE CAMPAIGN'S OWN EXTRACTOR:**

```
red-proof.mjs   CLASSES 16 + SHARED 2 + EXPECT 21 + FREEZE_EXPECT 2 + STANDALONE 2  = 43
run.mjs         FAILURE_CLASSES                                                      = 25
SAME POPULATION?  false
```

✅ **Both re-derivations agree with the programs' own runtime prints (`43` and
`25`), and `R-591 §1.3`'s decomposition `16/2/21/2/2` reproduces exactly.**

**WHICH CLAUSE EACH PRINT ACTUALLY SPEAKS TO:**

- **`43 / 43` speaks to clause `4d`** — it counts how many of `red-proof.mjs`'s own
  declared rows demonstrated a red path. **It does NOT speak to "every failure
  class `run.mjs` declares has a red path"**, because `run.mjs`'s classes are not
  its population.
- **`COMPLETENESS (F-4): all 25` is the print that speaks to `run.mjs`'s declared
  classes** — and it is a conditional print: `red-proof.mjs:596-601` emits a
  `*** STOP CONDITION (F-4)` line instead when the list is unreadable or any class
  is uncovered. **The `COMPLETENESS` line appearing at all is itself the signal.**

⚠️ **NOT A VERDICT: I am not saying clause `4d` is met, and I am not saying the
`43/43` print is wrong. I am saying the two numbers count different sets, and the
mapping above is which clause each can bear on.**

---

## 4. 🛑 THE ONE FRAGMENT WITH A GAP — CLAUSE `1d`, AND WHY IT FAILS CLOSED

**`R-591 §6`: *"an acceptance clause with no instrument is the most valuable thing
you could find here."* This is not quite that — it is one fragment whose
instrument cannot be mapped from the current prints, which is why it takes the
mandatory residual rather than a pass or a fail.**

**THE FRAGMENT:** *"only surface-valid fixture-valid rows may credit 1b-S."*

**WHAT EXISTS `[MEASURED HERE]`:**
- `run.mjs:604-605` puts `SURFACE_INVALID` and `FIXTURE_INVALID` in their **own
  partition slots**, so by construction such a row cannot also sit in
  `attributed`. **That is a structural argument from reading the code, not a
  printed observation.**
- `run.mjs:765` fires `surface_invalid_rows` when `surface_invalid > 0`, printing
  *"the number is INADMISSIBLE"*.
- `red-proof.mjs` proves BOTH classes are reachable: `PASS surface_invalid_rows
  exit=1`, `PASS fixture_invalid exit=1`.

**WHY IT IS STILL AMBIGUOUS:**
1. **In the clean run both populations are EMPTY (`0`, `0`).** No row is observed
   being denied 1b-S credit, because no row is in a position to be denied.
2. **The injections that populate them FAIL THE GATE (`exit=1`) rather than
   printing a credit-denial for a surviving run.** So the observed enforcement is
   *"the whole number becomes inadmissible"*, which is a STRONGER and DIFFERENT
   statement from *"this row did not credit 1b-S."*
3. ★★★★★ **AND THE REASON I WILL NOT READ THE ZERO AS A PASS: `run.mjs:175`
   records, in its own words, that this exact zero was once fabricated —
   *"`FIXTURE_INVALID` had NO ASSIGNMENT SITE — the value was unreachable, so
   `fixture_invalid: 0` was DEFINITIONAL, not measured. A five-population
   partition wearing a six-population caption."*** ✅ **That defect is FIXED —
   `FIXTURE_INVALID_CODES` exists at `:179` and the red-proof reaches the class —
   so today's zero has a reachability witness the historical one lacked.**
   ⚠️ **But a zero whose own file documents it having been definitional is a zero
   I report as a reading, never as a satisfied condition.**

**WHAT WOULD RESOLVE IT (named so the desk can order it rather than re-derive it):**
a print, under an injection that makes exactly one row `SURFACE_INVALID` or
`FIXTURE_INVALID`, showing **that row's id absent from the `attributed` member
list while the partition still sums** — i.e. the exclusion observed on a live
member, not inferred from an empty set.

---

## 5. ⚠️ MY OWN INSTRUMENT LIED FIRST — DISCLOSED, BECAUSE IT NEARLY BECAME §3

**My first count of the two populations was a hand-rolled brace-depth scanner in
the scratchpad. It returned:**

```
CLASSES 13 · SHARED 2 · EXPECT 27 · FREEZE_EXPECT 2 · STANDALONE 2  = 46
run.mjs FAILURE_CLASSES = 18
```

**Both figures are WRONG.** They disagreed with the programs' own runtime `.length`
reads (`43`, `25`). ★★★★★ **`A SURPRISING RESULT ACCUSES THE INSTRUMENT FIRST` —
and mine was a hand-built parser of a language it does not parse, which is the
`hardcoded-test` shape this campaign already carries a conviction for. I threw it
away and re-counted with `extractModuleCollections` — the campaign's own
extractor, and the very function `red-proof.mjs:589` uses for this join — which
reproduced `43` and `25` exactly.**
⚠️ **Had I trusted it, this report would have opened with a fabricated
`46 ≠ 43` discrepancy in the object I was sent to measure.**

**Also disclosed:** a first attempt at that count died on bash quote-nesting
(`unexpected EOF`) and a second on Windows ESM absolute-path imports
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`). **Neither was a finding about the prototype;
both were my shell.**

---

## 6. ⚠️ WHAT I DID **NOT** MEASURE

1. **I did not run any injection myself.** Every `exit=1` row quoted from
   `red-proof.mjs` is that program's own output on its own injections
   `[MEASURED BY THE OBJECT UNDER TEST]`. **I ran the suite; I did not
   independently reproduce a single red path.**
2. **`R-591 §1.3` notes clause-4 status was `UNKNOWN` at grade 5 because
   `red-proof.mjs` had gained `209` lines and `allOk` a new `effectOk` conjunct
   since `613a7c15`. I report the readings at `b203cba4` and did NOT diff the
   two revisions** — so I cannot say what changed between them. `[UNENUMERATED]`
3. **I did not verify that the four sentences are the desk's intended clause
   split** beyond the two corroborations in `§1`. If the desk splits differently,
   re-label the rows; the readings do not move.
4. **`43/43` and `25/25` are the programs' assertions about themselves.** I
   verified the DENOMINATORS by independent extraction; I did not verify that
   every one of the 43 rows genuinely exercised a distinct path.
5. **No clause is graded here, by design.** The absence of a MET/NOT-MET column is
   deliberate and is the contract (`R-591 §6`).
