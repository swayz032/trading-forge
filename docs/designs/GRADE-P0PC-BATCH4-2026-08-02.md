# GRADE — P0PC BATCH 4 (FOURTH INDEPENDENT GRADE)

**Object:** `prototypes/p0-vnext-admission/` @ **`5a5838bc`**
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
**Grader:** accuracy-validator (independent; did not design, build, or previously grade this batch)
**Date:** 2026-08-02

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| p0-vnext-admission batch 4 (`5a5838bc`) | **5 / 10** | **VERIFIED** | 6/6 gates green (NOOP control); 7 executed mutations, all restored byte-identical | **F-1d CRITICAL** (C1 refuted, 2 executed counterexamples); C6 strong form refuted; **R-584 §1 acceptance refuted by execution**; `PINNED_BLOBS` PLACEHOLDER escape; pin covers 6 files ≠ the 6 gates |

**Basis for band 5 ("happy-path only" for the central mechanism).** The batch genuinely closed three
real defects with discriminating fixtures I reproduced independently (C3, C4, C5 — and C5 is
**stronger than the doer claimed**). But **C1, the headline claim the whole batch is built around,
is REFUTED BY EXECUTION**, and its blast radius is **numerically identical** to the defect it claimed
to close. The provenance mechanism discriminates the attack class that was *anticipated* (parent-side
substitution) and is structurally blind to the one that was not (child-side substitution). It is not
band 4 — the delivery is real, adversarially tested, and three of its four items hold under attack.
It is not band 6 — an instrument that certifies itself an `ENFORCING GATE`, `EXIT 0`, with **stdout
byte-identical to the clean control**, while a live one-token defect retires a red path, has not
earned the band its predecessors were denied for the same reason.

**Object integrity confirmed before grading** [MEASURED HERE]:
```
$ git diff 5a5838bc HEAD -- prototypes/     # (HEAD = 241b548f)
(empty)
```
The docs-only commit `241b548f` did not touch the object. Verdict describes `5a5838bc` exactly.

---

## PER-CLAIM

| Claim | Verdict |
|---|---|
| C1 — witness provenance is fixed | **REFUTED** (CRITICAL, 2 executed counterexamples) |
| C2 — defeating the `cls` half needs two coordinated edits | **REFUTED** — it is **ONE**, and not in `red-proof.mjs` |
| C3 — main-entry guard class swept, set is exactly TWO | **CONFIRMED** (3 independent enumeration routes + discriminating probe) |
| C4 — 1-table execution witness | **CONFIRMED** (exact message reproduced + second path via consumer) |
| C5 — `FAILURE_CLASSES` completeness asserted | **CONFIRMED, AND STRONGER THAN CLAIMED** — the "ADDED" direction works; I tested it |
| C6 — missing `INJECTION:` reported as provenance, *never* as "declared but never ran" | **REFUTED in the strong form** (both vocabularies print) |

---

## Discrepancy F-1d: THE WITNESS IS AN ECHO OF THE REQUEST, NOT A WITNESS OF THE WORK

**Severity:** CRITICAL (false positive — self-certifying instrument)

**Claim (C1, verbatim):** *"Witness provenance is fixed: `red-proof.mjs:143` parses
`/^INJECTION: (.*)$/m` from the child's own stdout, so a row's recorded identity comes from what
actually RAN, never from the declaration it is checked against."*

**Reality:** The child does not report what it *ran*. It reports what it was *asked to run*.
[MEASURED HERE — read the executable lines]

```
run.mjs:38    const INJECT = process.env.PROTO_INJECT || '';
run.mjs:693   console.log(`INJECTION: ${INJECT || '<none — this is the clean control>'}`);
```

`red-proof.mjs:114` sets `PROTO_INJECT: inject`; the child prints that same string back verbatim;
`red-proof.mjs:143` parses it and records it as "what actually RAN". **Nothing in that chain is
derived from the mutation the child actually applied.** The round trip proves only that an
environment variable crossed a process boundary.

The dispatch that maps the injection *name* to the actual *mutation* — `run.mjs:236-336`,
`:367-382`, a set of scattered `if (INJECT === 'x' && c.id === 'y')` statements and two `switch`
blocks — is **not a pinned collection**, is not witnessed, and is invisible to every guard in the
suite. R-582's remedy moved the key's manufacture across the process boundary; the object on the
far side of that boundary is still the parent's own argument.

> **A WITNESS THAT ECHOES THE REQUEST CANNOT SPEAK ABOUT THE WORK.**

### Counterexample A — one token, byte-identical output

```
run.mjs:298   - if (INJECT === 'own_unrelated_nonowned' && c.id === '34(b)') …
              + if (INJECT === 'own_unrelated_nonowned' && c.id === '35(a)') …
```
Row (c)'s declared subject is *"unrelated TS2304 on a **NON-OWNED** row (34(b))"*. After the edit it
plants on 35(a) — the row (a) already covers. The distinct NON-OWNED-row direction is retired.

```
$ node red-proof.mjs                                        EXIT=0
CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 41 / 41
VERDICT: the runner is an ENFORCING GATE — control green, every declared class ran exactly once and red-proofed.

$ diff NOOP_red-proof.out MUT_C1_redproof.out
(empty — BYTE-IDENTICAL to the clean control)
```

### Counterexample B — the guard protecting the campaign's own F-1 CRITICAL

```
run.mjs:251   - case 'membership_delete_guard': return CORPUS.filter((c) => c.id !== '56(a)');
              + case 'membership_delete_guard': return CORPUS.filter((c) => c.id !== '38');
```
Row (i) exists specifically to protect the `export * from` guard row `56(a)` — the accuracy-validator's
F-1 CRITICAL. After the edit it deletes `38` instead, duplicating row (f).

```
$ node red-proof.mjs                                        EXIT=0
CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 41 / 41
VERDICT: the runner is an ENFORCING GATE …
$ diff NOOP_red-proof.out MUT_C2_redproof.out               (empty — BYTE-IDENTICAL)
```

**Positive control that the retirement is REAL, not merely relabelled** [MEASURED HERE]:
```
$ PROTO_INJECT=membership_delete_guard node run.mjs | grep -E "56\(a\)|\*\*\* membership"
56(a)     ATTRIBUTED             static edge: export * from      1b-S:import-cardinality
  *** membership: MISSING from the pinned 52 …: 38 | MISSING from the pinned EXPANDED corpus …: 38
```
`56(a)` is **ATTRIBUTED** — present, never deleted. The class fires on `38`. The declared work did
not happen and the suite certified it anyway.

**Sources compared:** [red-proof.mjs stdout: `41/41 ENFORCING GATE EXIT 0` | run.mjs child stdout
under the same mutation: `56(a) ATTRIBUTED`, i.e. the declared deletion never occurred | `git status`:
the only delta is one token in `run.mjs`]

**Source of truth:** the child's *behaviour* (row 56(a) still present). The parent's witness is
wrong because it reads the request, not the behaviour.

**Fix point:** `run.mjs:693` — the emitted witness must be derived from the mutation actually
applied (e.g. print the `PLANT_WITNESS` entries, or a digest of the mutated corpus/target id), not
from `process.env.PROTO_INJECT`. `red-proof.mjs:142-152` must then join on that derived value. The
existing `PLANT_WITNESS` array (`run.mjs:268`) is already the right shape and is currently populated
by only 2 of the ~30 injections.

**Blast radius — the reachability is UNCHANGED from the defect C1 claimed to close.**
`namedOurClass` blocks *cross-class* substitution only. Within a class group it is no defence.
Class-group sizes in `EXPECT` [MEASURED HERE, AST-extracted, 19 rows total]:

| named class | rows | retirable (all but one) |
|---|---|---|
| `type_invalid_unclassified` | 5 | 4 |
| `membership` | 5 | 4 |
| `green_membership` | 3 | 2 |
| `module_collections` | 2 | 1 |
| `disposition`, `twin_pairs_membership`, `prereg_membership`, `collection_shape` | 1 each | 0 |
| **total** | **19** | **11** |

**11 of 19 EXPECT rows are retirable this way — exactly the 11 that R-582's grade retired.**
The fix relocated the spelling of the attack from the parent to the child; it did not reduce its
reach by one row. [MEASURED HERE for 2 of the 11; the other 9 are HYPOTHESIS-UNPROVEN by the same
mechanism — see "What I did NOT verify".]
The 16 `CLASSES` rows are additionally exposed to *within-class fixture* substitution (change which
`c.id` the injection lands on); not separately measured.

**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
node red-proof.mjs > CLEAN.out                      # EXIT 0
# edit run.mjs:298  '34(b)' -> '35(a)'
node red-proof.mjs > MUT.out; echo $?               # EXIT 0
diff CLEAN.out MUT.out                              # empty
```

---

## C2 — "two coordinated edits": REFUTED. It is ONE, in a different file.

**Claim:** the `cls` half is declaration-sourced but `namedOurClass` defends it, and defeating it
needs two coordinated edits.

**Reality:** [MEASURED HERE] Both counterexamples above required **one token, in `run.mjs`, with
`red-proof.mjs` untouched.** I never needed to attack the `cls` half at all — it is not the binding
constraint. The doer's threat model assumes the attacker must edit the *checker*. The cheapest
defeat edits the *subject*, where no witness, no pin, and no count is looking.

Re-deriving the brief's item 1 (`DECLARED_ROW_KEYS` "three-edit path"): the three-edit arithmetic is
**correct but irrelevant** [CORROBORATED — I re-derived it by reading `red-proof.mjs:303-360`;
retiring a row via `DECLARED_ROW_KEYS` requires the loop head, the key list, *and* `EXPECTED_ROW_COUNT`
or `STANDALONE_ROWS` to move together, else `derivationsAgree` reddens]. It is irrelevant because
the one-edit child-side path bypasses all three.

---

## C6 — REFUTED in the strong form

**Claim:** *"A missing `INJECTION:` line is reported as a PROVENANCE failure … **never** as
`declared but never ran`."*

Induced a **single-row** real provenance loss (`run.mjs:693` guarded with `if (INJECT !== 'parse')`)
[MEASURED HERE]:

```
*** STOP CONDITION (F-1c): a row was recorded WITHOUT a child-printed witness. …
***   parse: the child printed no 'INJECTION:' line — nothing witnesses what it ran
*** STOP CONDITION (F-1b): the built rows do not MATCH the declared rows one-for-one. …
***   DECLARED BUT NEVER RAN (1): parse                    <-- the exact vocabulary C6 says never appears
***   RAN BUT UNDECLARED: «NO INJECTION WITNESS»
CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 40 / 41
VERDICT: NOT a gate. row PROVENANCE missing on 1 row(s) … | row IDENTITY broken (1 declared class(es) never ran …
   … | classes without a demonstrated red path: «NO INJECTION WITNESS»
```

The provenance failure **is** reported, first, distinctly, and first in the VERDICT — that part holds.
But `red-proof.mjs:355-358` claims *"the two must not print the same way"*, and they do: `parse` is
reported as `DECLARED BUT NEVER RAN`, and the final summary lists a nonsense class
`«NO INJECTION WITNESS»` as a class "without a demonstrated red path".

**Severity: MEDIUM — a caption defect, not a false green.** The gate fails loudly (`EXIT 1`, `40/41`,
`NOT a gate`). Per this desk's own caption-is-a-claim law, fix at the emitter: suppress the F-1b
identity block for rows whose `provOk === false`, since their identity is uninterpretable by the
file's own stated design.

---

## C3 — CONFIRMED (set is exactly TWO)

Enumerated by **three routes neither the doer nor the dispatcher used**, over a **filesystem sweep**
(not `git grep`), on the whole `prototypes/` subtree [MEASURED HERE]:

| route | pattern | hits |
|---|---|---|
| A | `argv` (any use) | `module-collections.mjs:368`, `module-tuple.mjs:129` (+2 comment lines in module-tuple) |
| B | `import.meta.main` (native, Node ≥24.2 — the idiom that never mentions `import.meta.url`) | **0** |
| C | `require.main` / `process.mainModule` (CJS idioms) | **0** |

Route B is the one specifically requested and it is empty. Both live sites carry the robust form.
`emitted-freeze.mjs`, `type-value-proof.mjs`, `run.mjs`, `red-proof.mjs` have **no** guard — correct,
they are scripts, not dual-purpose modules.

**Discriminating positive control** (proves the shipped form actually fires where the old one did not,
and that the probe can say `false`) [MEASURED HERE]:

| probe path | FRAGILE (old form) | ROBUST (shipped form) |
|---|---|---|
| `…/scratchpad/a b/probe.mjs` | **false** | **true** |
| `…/scratchpad/probe_nospace.mjs` | true | true |

`import.meta.url` renders the space as `a%20b`; `argv[1]` carries it literally. The 2×2 discriminates.

---

## C4 — CONFIRMED (exact witness, plus a second path)

```
$ node module-collections.mjs                                     # CONTROL
MODULE COLLECTIONS — pin 1a1abb46 | 6 files | 13 pinned tables (DECLARED) | 0 finding(s)
VERDICT: PASS …                                                   EXIT=0

# delete 'FIXTURE_INVALID_CODES' from PINNED_MODULE_COLLECTIONS['run.mjs'].tables
$ node module-collections.mjs
Error: INSTRUMENT FAULT: run.mjs is declared to cover 4 enforcement table(s) but
PINNED_MODULE_COLLECTIONS lists 3 (FAILURE_CLASSES, SIX, SURFACE_CODES) — a table was added or
silently dropped                                                  EXIT=1

$ node run.mjs                                                    RUN_EXIT=1   # second path: consumer throws at module load
$ node module-collections.mjs      # after restore                EXIT=0  PASS
```
Verbatim match to the claim. The consumer propagation is a genuinely non-overlapping second path —
it proves the fault is not confined to the file's own `isDirectRun` branch.

**Instance-eleven hunt on this file: HONEST NULL.** `COVERED_FILES` declares per-file magnitudes;
`DECLARED_TABLE_TOTAL = 13` is a literal cross-checked against their sum
(`module-collections.mjs:159-162`); membership between `COVERED_FILES` and
`PINNED_MODULE_COLLECTIONS` is asserted in **both** directions (`:163-182`). The printed
`6 files | 13 pinned tables` comes from the declarations, not from a `reduce` over the consumption.
`emitted-freeze.mjs:146` derives `EXPECTED_SOURCE_COUNT` from the pinned baseline, not from `rows`.
**No instance eleven found in the enforcement files.** [The search surface is enumerated under
Coverage; this is a bounded null, not a global one.]

---

## C5 — CONFIRMED, AND STRONGER THAN THE DOER CLAIMED

The declared confound is **real** [MEASURED HERE] — adding a class to `run.mjs`'s `FAILURE_CLASSES`
does trip the pin and redden the control:
```
$ node run.mjs
GATE: FAIL (1 class(es))
  *** module_collections: run.mjs: FAILURE_CLASSES UNDECLARED row(s) — legitimate growth must bump the pin: grader_probe_uncovered_class
                                                                  RUN_EXIT=1
```
**But it is not load-bearing, and the untested direction WORKS.** F-4 reads `run.mjs`'s *source* via
the extractor rather than executing it, so it fires independently of the control:
```
$ node red-proof.mjs                                              EXIT=1
*** STOP CONDITION (F-4): 1 declared failure class(es) in run.mjs have NO red path here: grader_probe_uncovered_class
VERDICT: NOT a gate. the CONTROL failed … | 1 declared failure class(es) have no red path: grader_probe_uncovered_class | …
```
The "class ADDED" direction is now **MEASURED**, fires correctly, and is named distinguishably from
the control failure. The doer under-claimed. C5 is the strongest item in the batch.

---

## Residual R-1: `PINNED_BLOBS` validates presence, not plausibility

**Severity:** MEDIUM (weakened mechanism claim; needs a 2nd edit to reach a false green)

`module-collections.mjs:125-135` claims *"The blob of every pinned file is asserted below, so moving
this constant cannot be quiet."* The module-load guard (`:172`) tests only **truthiness**
(`if (!PINNED_BLOBS[f]) throw`), and the comparison (`:310`) is explicitly **skipped** for any value
starting with `PLACEHOLDER`.

[MEASURED HERE] Replacing one blob value with `'PLACEHOLDER_grader_probe'`:
```
$ node module-collections.mjs
MODULE COLLECTIONS — pin 1a1abb46 | 6 files | 13 pinned tables (DECLARED) | 0 finding(s)
VERDICT: PASS — every pinned enforcement table matches the pinned artifact.     EXIT=0
$ node run.mjs                                                                  RUN_EXIT=0  GATE: PASS
```
Pin-move detection for that file is now off, silently, and both the gate and its consumer stay green.
This is *"present and well-typed is not can-fail"*. **Fix:** assert `/^[0-9a-f]{40}$/` at module load,
and make `PLACEHOLDER` a loud, enumerated, time-boxed exemption rather than a silent prefix test.

## Residual R-2: the pin's 6 covered files are not the 6 gates

[MEASURED HERE] Gates run directly: `run, red-proof, emitted-freeze, type-value-proof,
module-collections, module-tuple`. Pin-covered: `run, red-proof, type-value-proof, source-admission,
runtime-admission, membership`. **Uncovered gates:** `emitted-freeze.mjs`, `module-collections.mjs`,
`module-tuple.mjs`.

**Materially harmless today, and I am saying so rather than inflating it** — I enumerated their
module-level collections: `emitted-freeze.mjs` holds only runtime accumulators (`rows`,
`memberFailures`, `nonSource`, all `keys=null len=0`); `module-tuple.mjs` holds **none**;
`module-collections.mjs`'s three are the declared structural self-pinning regress, already mitigated
by the C4 magnitude cross-checks. There is nothing there to shrink. Worth a one-line note in the
file so the next reader does not have to re-derive it.

## Item 2 (brief) — nothing was hidden from the pin guard: CONFIRMED

Two non-overlapping paths agree on `red-proof.mjs`'s module-level collection set [MEASURED HERE]:
AST via the shipped `extractModuleCollections`, and an independent raw regex over
`^const \w+ = [\[{]`. Both yield the same 6: `CLASSES(16)`, `SHARED(2)`, `EXPECT(19)`,
`FREEZE_EXPECT(2)` — all four **COVERED** — plus `rows` and `DECLARED_ROW_KEYS`, both
`keys=null` (uncertifiable by construction) and **both already present in the pinned artifact**, so
neither trips "NEW UNPINNED". `provenanceFailureRows` is a `.filter()` call expression, not a literal,
so it is not a collection by the parser's definition. **Moving the state onto the rows introduced no
new unpinned table and concealed nothing.** `16+2+19+2+2 = 41` reconciles the printed denominator.

## Item 3 (brief) — the two controls: SAME TRICK, WEARING A WITNESS

`freeze_control` and `over_correction_control` assert the child witnessed `<none — this is the clean
control>`. That token is produced by `run.mjs:693` **iff `process.env.PROTO_INJECT` is empty**. So the
control witnesses *"no env var was set"* — **not** *"no mutation is present"*.

This is not a hypothesis. It is already measured by counterexamples A and B above: in **both** runs
`run.mjs` carried a live behavioural mutation, and both times the control row printed
```
PASS over_correction_control … control ran '<none — this is the clean control>'
```
**The control certified a mutated tree as clean.** It is the same echo seam as F-1d, and it means the
`CONTROL GREEN: true` discriminator — the thing the whole suite rests on per `red-proof.mjs:164-167` —
speaks only about the environment, never about the artifact.

---

## Item 4 (brief) — GRADING THE DESK (R-583 / R-584)

### 4a. The figures: HONEST NULL. No fabricated join keys found.

An independent read-only figure audit of `R-583` and `R-584` re-derived every quantitative claim
against on-disk artifacts via `git show` / `git ls-tree` / `git hash-object` [MEASURED BY GRADED
INSTRUMENT — a separate auditor, read-only mandate]. **All checked out**, including: `grep -c` counts
with comment-vs-executable classification; commit `5a5838bc` timestamp `16:42:07`; the graph blob
`4b806d35…` unchanged across both rulings; the "six pinned files" and "exactly two guards / five
`path.dirname` others" cardinalities; and the three self-referential sequence counts (`R-574 §0`
"sixth time", `MISS_NOT_CAUGHT` "fifth", `P0PG` "four cycles") by full-corpus enumeration.

**I corroborated two of those on my own non-overlapping path** [MEASURED HERE]: the `INJECTION` grep
in `run.mjs` is 4 hits of which `:37` and `:312` are comments and `:67`/`:693` executable (matches
R-583 §1's self-correction exactly); and the "exactly two" guard set, which I re-derived by three
routes R-583/R-584 did not use (§C3 above). **R-583's self-correction of R-582 §1 is accurate**, and
the desk's own `grep -v "://"` near-miss was correctly self-caught. Two runtime claims were
`UNVERIFIABLE` to that auditor under its read-only mandate; **I executed both myself** — the clean
control (§NOOP) and the space-path discriminating pair (§C3) — and both hold.

### 4b. But one desk figure IS refuted — and by a method the figure audit structurally could not use.

**Severity:** MEDIUM (a ruling declares an acceptance criterion MET that execution shows is NOT met)

**Claim (R-584 §1, verbatim):** *"`R-583 §2.2`'s REQUIRED ACCEPTANCE IS MET… a missing witness
reports 'nothing witnesses what it ran' — provenance failure, **NOT** 'declared but never ran'."*

The read-only audit marked this **CONFIRMED** — correctly, on its evidence: the string at
`red-proof.mjs:366` is present and reads exactly as quoted.

**But the claim is an ABSENCE claim** (`NOT 'declared but never ran'`), and **an absence claim owes a
positive control, not a grep for the string that is supposed to be there.** I induced the condition
(§C6) and **both** vocabularies print:

```
***   parse: the child printed no 'INJECTION:' line — nothing witnesses what it ran      <- present, as ruled
***   DECLARED BUT NEVER RAN (1): parse                                                  <- the vocabulary ruled absent
```

**Source of truth:** the executed output. **The acceptance criterion `R-583 §2.2` set is NOT met at
`5a5838bc`.** The presence of the right sentence does not establish the absence of the wrong one —
they are emitted by two different, independently-reachable branches (`red-proof.mjs:363-367` and
`:368-377`). This is verbatim the desk's own *caption-is-a-claim* / *grep-true-conclusion-false*
species, on a ruling written to close a caption defect.

**Fix point:** `red-proof.mjs:368` — gate the F-1b identity block on `provenanceOk`, since the file's
own comment (`:355-358`) states that a provenance-failed row's identity is *"UNINTERPRETABLE, not
merely wrong."* Then re-assert R-583 §2.2 against the **executed** output, with a planted
known-bad, rather than against the string literal.

**Method note for the desk:** a read-only auditor cannot discharge an absence claim about runtime
behaviour. Route absence-shaped acceptance criteria to an auditor with execution rights, or the
"CONFIRMED" is bounded to "the string exists".

---

# MANDATORY CLOSING COVERAGE SECTION

## 1. What I verified, and via which non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Object untouched by `241b548f` | `git diff 5a5838bc HEAD -- prototypes/` (empty) | sha256 of all 11 `.mjs` before/after my work (identical) | `git status --porcelain -- prototypes/` (empty) |
| C1 refuted | executed mutation A → byte-identical stdout, EXIT 0 | executed mutation B (different class group, different dispatch construct: `if` vs `switch`) | child-behaviour positive control: `56(a) ATTRIBUTED` proves the declared work did not run |
| C2 (one edit, not two) | mutation A touched only `run.mjs`, 1 token | mutation B touched only `run.mjs`, 1 token | `red-proof.mjs` sha256 unchanged across both (`040ad548…`) |
| C3 (set = 2) | filesystem `find` + `grep argv` over whole `prototypes/` subtree | `grep import.meta.main` (0) | `grep require.main\|mainModule` (0); + 2×2 space/no-space runtime probe |
| C4 | direct `node module-collections.mjs` → INSTRUMENT FAULT | consumer `node run.mjs` → exit 1 at module load | restore → PASS exit 0 |
| C5 | `node run.mjs` shows the confound is real | `node red-proof.mjs` shows F-4 fires anyway, named separately | F-4 reads source, not runtime — read at `red-proof.mjs:386` |
| C6 refuted | induced single-row provenance loss, read stdout | verdict-line text lists both failure vocabularies | `EXIT=1`, `40/41` confirms it fails loudly (not a false green) |
| Item 2 (nothing hidden) | shipped AST extractor | independent raw regex `^const \w+ = [\[{]` | arithmetic reconciliation `16+2+19+2+2 = 41` |
| Instance-eleven null | read executable lines `module-collections.mjs:147-182` | executed C4 deletion → INSTRUMENT FAULT (the guard has a path to red) | `emitted-freeze.mjs:146` denominator traced to pinned baseline |

## 2. Positive-control witnesses for every absence claim

- **"No third main-entry guard"** → the 2×2 space/no-space probe shows my detection method
  *distinguishes* the fragile from the robust form (`FRAGILE=false, ROBUST=true` under a space).
  A method that returns `true` for both would have been a dead probe. Search surface enumerated
  (filesystem sweep of all 17 files in `prototypes/`, three idiom routes).
- **"The retired red path really is retired"** (F-1d) → `PROTO_INJECT=membership_delete_guard node run.mjs`
  prints `56(a) ATTRIBUTED`, i.e. the row the injection is declared to delete is still present.
- **"No instance eleven in the enforcement files"** → the C4 1-table deletion is the planted known-bad:
  the magnitude guard **does** have a path to red, so its silence on the clean tree is a measured
  absence, not a dead check.
- **"Nothing hidden from the pin guard"** → the raw-regex path independently found `rows` and
  `DECLARED_ROW_KEYS` (lines 170, 333), i.e. it *can* see uncovered collections; it did not simply
  return the pinned four.
- **NOOP control ran FIRST** and was green on all six gates before any mutation was believed.
- **Instrument failure caught and named:** my first C3 probe was written via a bash heredoc that ate
  the `\\` in the regex, producing a `SyntaxError`. That was my tooling lying, not the artifact. I
  rewrote it byte-exact and re-ran. Recorded because a heredoc-mangled probe returning `false` would
  have manufactured a false finding.

## 3. Join keys checked for every "identical / unchanged / matches" claim

- **"byte-identical stdout"** → `diff` of full captured stdout files, not a tail or a grep.
  Join key: the complete stdout stream of `node red-proof.mjs`.
- **"tree restored"** → sha256 of all 11 `.mjs` files against the pre-mutation baseline, **plus**
  `git status --porcelain -- prototypes/` empty, **plus** all six gates re-run green afterwards.
  Join key: file content hash, not mtime and not `git diff` alone.
- **"11 of 19 retirable" matches R-582's 11** → join key is the *class name* column of `EXPECT`,
  recounted from the AST (19 rows), grouped, and `Σ(size−1)` over groups of size ≥2 = 11.
- **"41 = 16+2+19+2+2"** → counts taken from the AST extractor, not from the printed banner.

## 4. WHAT I DID NOT VERIFY

1. **R-583 / R-584 figures — audited by a SECOND INSTRUMENT, not by me directly.** The figure sweep
   was run by a separate read-only auditor [MEASURED BY GRADED INSTRUMENT]. I personally
   re-derived only **two** of its results on an independent path (the `INJECTION` grep
   comment/executable split, and the two-guard cardinality). **The remaining figures are
   CORROBORATED, not MEASURED HERE** — a single auditor's null is one path. Its own declared blind
   spot (a guard not mentioning `import.meta.url` would escape its grep) I closed separately with
   routes B and C in §C3. Its two `UNVERIFIABLE` runtime claims I executed myself.
2. **9 of the 11 predicted retirable `EXPECT` rows.** I executed 2 (one from the
   `type_invalid_unclassified` group, one from `membership`). The other 9 are **HYPOTHESIS-UNPROVEN**
   by the same mechanism — the arithmetic is measured, the individual executions are not.
3. **The 16 `CLASSES` rows' exposure to within-class *fixture* substitution.** Argued from the same
   seam; not executed. Not counted in the 11.
4. **Whether a `PLACEHOLDER` blob composes with a `MODULE_PIN_COMMIT` move into a full false green.**
   I measured only that the presence guard is vacuous (one edit). The two-edit composition is
   **UNVERIFIED** — I did not want to move the pin constant in a shared tree.
5. **`corpus.mjs`, `membership.mjs`, `source-admission.mjs`, `runtime-admission.mjs` internals.**
   Read only where the six claims reached them. Their catcher tables were **not** adversarially tested
   this pass.
6. **`type-value-proof.mjs` and `emitted-freeze.mjs` beyond their NOOP green and their denominators.**
   No mutation testing of their own red paths this pass.
7. **Case-sensitivity residual on the robust main-entry guard.** On Windows,
   `path.resolve(argv[1])` preserves the caller's casing while `fileURLToPath(import.meta.url)` may
   not. Not tested. Bounded, low, and shared by both sites — **not** a third instance.
8. **Any claim about how this behaves on a non-Windows platform or a non-v24.13.0 Node.**
   All measurements are `win32`, Node `v24.13.0`, this tree only.
9. **Concurrency.** A second seat shares this tree. All my runs were sequential and the tree verified
   clean before and after, but I cannot exclude another agent having read the object mid-run.

---

## Scope of this band

Band 5 is scoped to: `prototypes/p0-vnext-admission/` @ `5a5838bc` · the 6-gate battery as invoked by
the access recipe · Node v24.13.0 · win32 · tree `wt-h1-wave4-20260712` · 7 executed mutations.
It is not a statement about the P0-vNext design, the corpus's substantive verdicts, or any number
this prototype produces about admission.

**Lineage declaration:** I did not design, build, or previously grade this batch. I am the fourth
independent grader in this lineage; grades 1-3 (`R-561`, `R-578`, `R-582`) were issued by other
seats and I re-derived this band from current artifacts only, ignoring their bands.
