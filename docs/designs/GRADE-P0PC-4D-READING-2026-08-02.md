# GRADE — `P0PC` clause `4d` under reading (B) · 2026-08-02

**Grader:** independent `accuracy-validator`, dispatched per `R-598 §3` / `R-597 §4`.
**Object:** `prototypes/p0-vnext-admission/` pinned at `ee31fe44`.
**Instrument under grade:** `prototypes/p0-vnext-admission/evidence-order.mjs`.
**Mode:** HUNT + GRADE. Brief was to REFUTE.

---

## VERDICT — THE CLAIM DOES **NOT** SURVIVE. CLAUSE `4d` IS `UNKNOWN`.

> **CLAIM (verbatim):** *"P0PC acceptance clause `4d` is MET at `ee31fe44` under reading (B) — every terminal acceptance failure prints its own finding before exiting non-zero, and the restored control exits zero."*

**It does not survive, and the reason is not that column (i) is empirically false.** `[MEASURED HERE]` I re-ran the instrument and extended it: column (i) is `37/37`, not `25/25`, and I found **no row anywhere in the knob population that prints no finding.** The claim fails for a different and more serious reason:

**Column (i) has no path to red inside the population `4d` was ruled to cover.** `[MEASURED HERE]` Both of `run.mjs`'s non-throw termination paths emit a `*** ` line from *the same guarded block that decides the non-zero exit*, with no conditional in between. A run cannot exit non-zero on either path and fail `OWN_FINDING`. The only terminations that score `NO` are `INSTRUMENT FAULT` throws — and `R-594 §3` / `R-596 §1` ruled those **out** of `4d`'s population. So the instrument's single `0/0` red witness is drawn from outside the set it is certifying.

`R-596 §0` states this in its own words while withdrawing the opposite conclusion: *"it is simply TRUE on the acceptance population and FALSE outside it."* That sentence is the definition of a green with no in-scope path to red. **`R-594 §2`'s withdrawn `(B)` leg — *"satisfied by construction and never measured … unfalsifiable"* — was correct as applied to `4d`'s ruled population, and the withdrawal rests on a witness that `§1` of the same ruling excludes.**

Two of `R-596 §3`'s three arguments for reading (B) fail on measurement (`F-5`, `F-6`); the third has a measured counter-instance in the object itself (`F-7`). The population the claim quantifies over is unresolved and the desk's only measured answer to it is false (`F-2`). Object-under-test mutations **do** reach `0/0` terminations, in two files, so the exclusion that makes (B) green is unsound on its stated ground (`F-3`).

**`4d-ii` is `UNKNOWN`. I refuse to round it.** `4d-i` and `4d-iii` I independently **confirm** (see the table).

---

## VERDICT TABLE

| System | Band /10 | Status | Evidence | Open risks |
|---|---|---|---|---|
| Clause `4d-i` — terminal acceptance failure exits non-zero | 8 | **VERIFIED** | `[MEASURED HERE]` all **37** injection knobs exit `1`; two non-overlapping paths (instrument re-run + my own harness over the full population) | Population definition still open (`F-2`) |
| Clause `4d-iii` — restored control exits zero | 8 | **VERIFIED** | `[MEASURED HERE]` clean control `exit=0`, `225` stdout lines, `stderr` `0` bytes, reproduced 4× across the session | none |
| Clause `4d-ii` — *"after evidence collection"* | — | **UNKNOWN / UNVERIFIED** | column (i) `37/37` is true but **unfalsifiable in scope** (`F-1`); population unresolved (`F-2`) | Cannot be ruled either way on this evidence |
| `evidence-order.mjs` as an instrument | 4 | **VERIFIED (band re-derived)** | Exit logic genuinely reading-neutral — confirmed at the executable line. But population truncated **12 of 37** (`F-4`), self-check blind to truncation (mutation-tested), column (i) has no in-population red | Reported denominator wrong; truncation undisclosed |
| `R-596 §3`'s provisional reading (B) | 3 | **UNVERIFIED** | Arg (3) supports **(A)** (`F-5`); arg (2) is a non-sequitur (`F-6`); arg (1) has a measured counter-instance (`F-7`) | Reading remains genuinely open |
| `R-596 §1`'s boundary ruling | 3 | **UNVERIFIED** | Six-file premise **confirmed** by independent import; the *inference* — "no object-under-test mutation reaches an `INSTRUMENT FAULT` site" — **refuted twice** (`F-3`) | Boundary conclusion may survive on other grounds; its stated ground does not |

**Claimed vs verified reconciliation:** the claim asserts `4d` MET. I return `UNKNOWN` on `4d-ii`. That is a >1-band divergence on the load-bearing fragment. Default assumption per my contract is that the claim was inflated; here the more accurate reading is that the claim was **built on a column that cannot fail**, and the desk itself pre-registered the suspicion (`R-597 §4`) rather than hiding it. The desk's refusal to self-rule was correct.

---

## LINEAGE DECLARATION

I did **not** design, build, or previously grade this object, this instrument, or any clause of `P0PC`. I hold no prior band in this lineage.

**Prior artifacts I consulted, and how:** `R-594`, `R-596`, `R-597`, `R-598` (read verbatim from `ADVISOR-RULINGS.md`), and the background summary in my dispatch brief which referenced `GRADE-P0PC-TRANSITION-2026-08-02.md`. **I did not open that prior grade and did not read its band.** I consulted the rulings *as attack targets*, which is what the brief named them; every number in this verdict is re-derived from the artifacts at `ee31fe44`, not carried from any report. Where a ruling's figure and my measurement disagree, I state both and name the instrument that produced mine.

**Pin verification (done before anything else):** `git rev-parse --git-common-dir` → `.../trading-forge/.git` (linked worktree, correct tree). `git diff --stat ee31fe44 HEAD -- prototypes/` → **empty** at grade start (`HEAD=d1496213`) and again at grade end (`HEAD=47d7127a`). **HEAD moved twice during this grade** — `312e200b`, `397b5daf`, `47d7127a` — all `docs/designs/` ledger/state only; `git diff --stat d1496213 HEAD -- prototypes/` → empty. **This verdict describes `ee31fe44`.**

---

## Discrepancy F-1: column (i) cannot go red inside `4d`'s ruled population — reading (B) is satisfied by construction

**Severity:** CRITICAL (false positive — a green with no in-scope path to red)

**Claim:** `R-597` — *"COLUMN (i) `25/25`"* offered as reading (B)'s verdict, and `R-596 §0` — *"'every termination prints its own finding first' is a proposition with a live path to RED — it is FALSIFIABLE."*

**Reality:** `[MEASURED HERE]` `run.mjs` has exactly **two** non-throw paths to a non-zero exit. In both, the `*** ` emission and the exit decision are governed by the **same** non-empty guard, executed in sequence with nothing conditional between them:

- `run.mjs:133-138` — `if (collectionFindings.length) { … for (const f of collectionFindings) console.log('  *** module_collections: ' + f); … process.exit(1); }`
- `run.mjs:833-840` — `if (failures.length) { … for (const f of failures) console.log('  *** ' + f); } … process.exitCode = failures.length ? 1 : 0;`

Non-zero exit on either path therefore **entails** at least one `/^\s*\*\*\* /m` match. `OWN_FINDING` is true by construction, not by discovery. The only terminations scoring `NO` are uncaught `INSTRUMENT FAULT` throws — which `R-596 §1` ruled **out** of `4d`'s population. **The instrument's sole `0/0` witness is out-of-population by the desk's own ruling in the same document that used it to establish falsifiability.**

**Sources compared:** [instrument re-run: col (i) `25/25`, red witness `0/0` | my full-population harness: col (i) `37/37`, zero exceptions | `run.mjs:133-138` + `:833-840` read at the executable line: emission and exit share one guard | `R-596 §0` prose: *"TRUE on the acceptance population and FALSE outside it"*]

**Source of truth:** the executable lines. `R-596 §0`'s own sentence concedes the structure; it simply drew the opposite conclusion from it. A red drawn from outside a universally-quantified claim's population does not falsify that claim.

**Fix point:** not a code fix — a **ruling** fix. Either (a) `4d`'s population must be widened to include the throw class, at which point `F-3`'s two probes are live counterexamples and `4d-ii` is **NOT MET** under (B) as well; or (b) the population stays narrow, and reading (B) must be recorded as **unfalsifiable in scope** — i.e. `4d-ii` is untestable under (B) and the clause cannot be discharged by this instrument at all.

**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
sed -n '133,138p;833,841p' run.mjs      # emission and exit share one guard
node evidence-order.mjs                  # col (i) 25/25; the only 0/0 row is the throw witness
```

**Blast radius:** `4d` → `P0PC` ten-of-ten → the head of the 11-hop hard chain to `BFREEZE` (`R-591`). A `4d` MET on this column would transition the campaign's critical-path head on a tautology.

---

## Discrepancy F-2: `R-596 §2`'s `[MEASURED HERE]` join is false — the divergent rows fire `module_collections`, which is **not** one of the 25

**Severity:** CRITICAL (silent disagreement / join-key error in a load-bearing ruling)

**Claim:** `R-596 §2`, tagged `[MEASURED HERE, FAILURE_CLASSES extracted by its true [name, hit, msg] tuple shape]`: *"The declared CLASS they fire is `collection_shape`, and `collection_shape` **IS** one of the `25`."* → *"the truncating failure is inside the acceptance population by **BOTH** denominators, `25` and `43`."*

**Reality:** `[MEASURED HERE]` `module_collection_add` and `module_collection_delete` fire the class **`module_collections`**, not `collection_shape`. `module_collections` is **not** a `FAILURE_CLASSES` entry. They are two different checks over two different file populations:

| | `module_collections` | `collection_shape` |
|---|---|---|
| declared in `FAILURE_CLASSES`? | **NO** (string absent from the block) | YES, `run.mjs:824` |
| enforced at | `run.mjs:121` `checkPinnedCollections`, exits `:138` | end-of-run gate |
| data surface | `PINNED_MODULE_COLLECTIONS` — **6 INSTRUMENT files** | `collectionNamesOf(corpusModule)` — corpus.mjs exports |
| fired by knob | `module_collection_add` / `_delete` | `new_unpinned_collection` |
| finding text | `run.mjs: NEW UNPINNED module-level collection 'ROGUE_UNPINNED_TABLE' — pin it or bump 3978c1c5 (R-568 item 5)` | `NEW UNPINNED exported collection(s) — pin it or declare it EXEMPT in code (R-562): ROGUE_SELF_CERTIFYING_SET` |

**Sources compared:** [runtime stdout of both knobs: `*** module_collections: …` vs `*** collection_shape: …` | `FAILURE_CLASSES` block extraction: `includes('module_collections') === false`, `includes('collection_shape') === true` | `red-proof.mjs:100-101` declares class `'module_collections'` for both knobs, `:89` declares `'collection_shape'` for `new_unpinned_collection` | `PINNED_MODULE_COLLECTIONS` enumerated **by import**: 6 files = `run.mjs`, `red-proof.mjs`, `type-value-proof.mjs`, `source-admission.mjs`, `runtime-admission.mjs`, `membership.mjs`]

**Source of truth:** all four agree against the ruling. `red-proof.mjs:100-101` is decisive because it is the object's **own declaration table** — and it is the very "43" denominator `R-596 §2` cited as its corroborating second path.

**Fix point:** `docs/designs/ADVISOR-RULINGS.md` — `R-596 §2`'s `[MEASURED HERE]` sentence and the *"BOTH denominators"* conclusion built on it. The `25`-half is false; the `43`-half stands.

**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
PROTO_INJECT=module_collection_add   node run.mjs | grep -E '^\s*\*\*\* '   # module_collections
PROTO_INJECT=new_unpinned_collection node run.mjs | grep -E '^\s*\*\*\* '   # collection_shape
grep -n "module_collection_add\|new_unpinned_collection" red-proof.mjs      # :89 vs :100-101
node -e "const s=require('fs').readFileSync('run.mjs','utf8');const b=s.slice(s.indexOf('const FAILURE_CLASSES = ['),s.indexOf('const failures = FAILURE_CLASSES.filter'));console.log(b.includes('module_collections'),b.includes('collection_shape'))"
```

**Blast radius:** this join was `R-596`'s answer to exactly the question the brief's attack target 3 raises. With it removed, **whether the two truncating rows are "terminal acceptance failures" at all is OPEN.** `run.mjs:108`'s *"DELIBERATELY **NOT** A `FAILURE_CLASSES` ENTRY"* is not a caption defect against `:746` as `R-596 §2` supposed — it is literally accurate about a **different check**. If `FAILURE_CLASSES` governs, reading (A) has **no counterexample** and the (A)/(B) dispute is empty. That possibility is now live and unresolved.

---

## Discrepancy F-3: an object-under-test mutation **does** reach `INSTRUMENT FAULT` sites, in two files, scoring `0/0`

**Severity:** CRITICAL (the exclusion that makes reading (B) green rests on a refuted premise)

**Claim:** `R-596 §1`: *"**No object-under-test mutation reaches an `INSTRUMENT FAULT` site.**"* — the stated ground for ruling the ~22 throw sites out of `4d`'s population.

**Reality:** `[MEASURED HERE]` two probes, each a single-field edit to `corpus.mjs` (the object under test), reverted and byte-proven:

**Probe A** — deleted `witness: 'undeclaredReader',` from row `34(d-u)` (`corpus.mjs:97`):
```
EXIT=1 · STDOUT LINES=1 · STDERR=897 bytes · OWN_FINDING = NO (0 matches) · FULL_BODY = NO
stdout: EFFECT-DIGEST: ade9a2a1cdfa951017360c33de60d5114ebcebff1e0fbeecb11fe3d791ea9d1c
stderr: Error: INSTRUMENT FAULT: row 34(d-u) declares owned expression "undeclaredReader(lane)" with NO `witness` …
        at ownershipJoin (run.mjs:201:13)
```

**Probe B** — appended `export const GRADER_PROBE_UNPINNED_TABLE = ['x'];` to `corpus.mjs`. **This is the real-world form of the exact defect `collection_shape` exists to catch:**
```
EXIT=1 · STDOUT LINES=1 · STDERR=660 bytes · OWN_FINDING = NO (0 matches) · FULL_BODY = NO
stderr: Error: INSTRUMENT FAULT: the static collection parser disagrees with the executed runtime
        reader on corpus.mjs — runtime-only: [GRADER_PROBE_UNPINNED_TABLE], parser-only: []…
        at assertParserAgreesWithRuntime (module-collections.mjs:292:11)  ← from run.mjs:132
```

**Probe B is the sharpest result in this grade.** Knob `new_unpinned_collection` scores column (i) `YES` with a 226-line full body **only because `run.mjs:582-584` injects the rogue collection into an in-memory object spread** — `collectionNamesOf({ ...corpusModule, ROGUE_SELF_CERTIFYING_SET: ['x'] })` — which executes *after* the `assertParserAgreesWithRuntime` guard at `:132`. **The knob bypasses the throw the real defect hits.** `collection_shape`'s finding never prints when the defect is actually in the file.

**Sources compared:** [`R-596 §1` prose: no object mutation reaches a throw | Probe A: `corpus.mjs` → `run.mjs:201` throw, `0/0` | Probe B: `corpus.mjs` → `module-collections.mjs:292` throw, `0/0` | knob `new_unpinned_collection` on the same defect class: `exit=1 lines=226 own=Y full=Y`]

**Source of truth:** the two executed probes. `R-596 §1`'s **six-file premise is correct** — I re-derived it independently by importing `module-collections.mjs` and reading `PINNED_MODULE_COLLECTIONS`'s keys, confirming `corpus.mjs` is not among them. The premise is true; the **inference** from it does not hold, because `PINNED_MODULE_COLLECTIONS` governs only *one* of the throw families. `run.mjs:201`'s throw reads `CORPUS` — which comes from `corpus.mjs` — and has nothing to do with the pinned set.

**Fix point:** `R-596 §1`'s inference sentence. Note also the object's own asymmetry, which is the real defect: `fixture_invalid` — an **authoring defect in `corpus.mjs`** — is a declared `FAILURE_CLASSES` entry that prints a full 230-line body; a **missing `witness`, also an authoring defect in `corpus.mjs`** — throws with 1 line of stdout. Two defects of the same species in the same file, two opposite evidence behaviours. The `acceptance-failure` / `instrument-fault` boundary tracks **which code path happens to catch it**, not any property of the object.

**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
# Probe A: delete `witness: 'undeclaredReader', ` from corpus.mjs:97, then:
node run.mjs; echo "EXIT=$?"        # 1, stdout 1 line, no *** line
# Probe B: append `export const GRADER_PROBE_UNPINNED_TABLE = ['x'];` to corpus.mjs, then:
node run.mjs; echo "EXIT=$?"        # 1, stdout 1 line, no *** line
# REVERT BOTH. corpus.mjs sha256 must return to
#   e377abc758897aa5dc3d49834634d81f803c58cfe648a8503ed37c75f7d78d27
```

**Blast radius:** `F-3` is what converts `F-1` from a structural observation into a live falsification. If the throw class is admitted to `4d`'s population — and probes A and B show it is reachable from the object under test by one-field edits — then column (i) has **real in-population reds** and `4d-ii` is **NOT MET** under reading (B) too.

---

## Discrepancy F-4: the knob population is silently truncated — 12 of 37 knobs are invisible, and the self-check cannot detect it

**Severity:** CRITICAL (schema drift in the instrument's own denominator)

**Claim:** `evidence-order.mjs:34-36` — *"THE POPULATION IS DERIVED FROM `run.mjs`, NEVER HAND-COPIED. A hand-copied list of 25 names is a fabricated safety claim: it would keep passing after `run.mjs` gained or lost a class."* `R-597` — *"the knobs are **LIVE-PARSED** from `run.mjs`"*; reported *"declared injection knobs parsed from run.mjs: 25"*.

**Reality:** `[MEASURED HERE]` the parse is live, and **truncated**. `/INJECT === '([a-z_]+)'/g` (`evidence-order.mjs:40`) is blind to the `case '<knob>':` form, which `run.mjs` already uses for **12 knobs** in two `switch (INJECT)` blocks at `run.mjs:306` and `:455`:

`green_add · green_delete · green_duplicate · green_to_red · membership_add · membership_delete · membership_delete_guard · membership_duplicate · membership_rename · partition_overlap · uncaught_stale · uncaught_undeclared`

**The true population is 37, not 25.** I ran all 12 with the instrument's verbatim predicates: **all exit `1`, all `own=Y`, all `full=Y`.** So the corrected figures are **col (i) `37/37`, col (ii) `35/37`** — the verdict *direction* is unchanged, which is why this is a truncation finding and not a reversal. Three consequences that do bite:

1. **The stated design rationale is defeated on the axis it names.** Any knob added in `case` form will not "keep the population honest" — it will be silently omitted. That form is already in use for 12 of 37.
2. **The `25 == 25` coincidence that `R-596 §2` used as its confirming join is an artifact of this bug.** `R-596 §8` records: *"the count `25` matching the campaign's known value is the join that told me the second read was right."* Correct parsing yields **37**, and the collision with `FAILURE_CLASSES`' 25 disappears. A truncation bug supplied the corroboration for `F-2`'s false join.
3. **The self-check is blind to truncation.** `[MEASURED HERE — mutation test]` I narrowed the regex to `/INJECT === '(getter)'/g` (population = 1), ran the instrument, and reverted:
```
declared injection knobs parsed from run.mjs: 1
4d-ii  COLUMN (i)  own finding printed      : 1/1
4d-ii  COLUMN (ii) full evidence body       : 1/1
DIVERGENT ROWS …:  <none>
MEASUREMENT COMPLETE: 1 knobs scored on both columns; RED witness demonstrated at 0/0.
INSTRUMENT EXIT CODE = 0
```
**A one-knob population reports a clean double green, erases the entire reading dispute, and exits 0.** The `faults` list (`evidence-order.mjs:168-172`) has exactly four conditions — `unknown.length`, `!red.threw`, `red.ownFinding || red.fullBody`, `scored.length === 0` — and the only population check fires solely at **zero**.

**Sources compared:** [instrument's own parse: 25 | `case '…':` extraction: 12 additional | union: 37 | `red-proof.mjs` `EXPECT`: 21 knob rows, **all 21 inside my 37**, plus 16 of my 37 with no `EXPECT` row → `21 + 16 = 37` ✔ | execution of all 12 unseen knobs: 12/12 exit 1, own=Y, full=Y]

**Source of truth:** the union, 37. Cross-checked three ways and arithmetically closed against `red-proof.mjs`.

**Fix point:** `prototypes/p0-vnext-admission/evidence-order.mjs:40` — the extraction regex — **and** `:168-172`, which needs a population-completeness fault so a future truncation cannot pass green. Per campaign law, fix at the **emitter**, not in the report table.

**Repro:**
```bash
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712/prototypes/p0-vnext-admission
node -e "const s=require('fs').readFileSync('run.mjs','utf8');
const A=new Set([...s.matchAll(/INJECT === '([a-z_]+)'/g)].map(m=>m[1]));
const B=new Set([...s.matchAll(/case '([a-z_0-9]+)':/g)].map(m=>m[1]));
console.log('instrument sees',A.size,'| unseen',[...B].filter(x=>!A.has(x)).sort().join(' '));"
PROTO_INJECT=membership_rename node run.mjs | grep -E '^\s*\*\*\* '   # a live, unseen knob
```

**Blast radius:** every figure `R-596 §4` pre-registered and `R-597` accepted (`25/25`, `23/25`, `0` UNKNOWN) carries a denominator short by 12. `R-597`'s *"Both landed exactly"* is a pre-registration matched against a truncated population.

---

## Discrepancy F-5: `R-596 §3` argument (3) — the exit-hook precedent — supports reading **(A)**

**Severity:** MODERATE (an argument cited for (B) that argues for (A))

**Claim:** `R-596 §3` arg 3: *"The file already answered this question once, **in the same direction**"* — `run.mjs:96-100` moved `EFFECT-DIGEST` into a `process.on('exit')` hook.

**Reality:** `[MEASURED HERE — the comment read at the executable line]` `run.mjs:96-98` states its reason: *"Emitted from an `exit` hook rather than at the end of the file, **because the collection gate below EXITS EARLY (`process.exit(1)`)** — a fingerprint missing exactly when a class fires would be **blind to the classes that matter most**."*

That is reading (A)'s concern, written by the design, about **the same early exit at `:138`**. And the design's response was **not** to accept the evidence loss — it was to build a mechanism that **preserves the evidence across the early exit.** `[MEASURED HERE]` the mechanism demonstrably works even through an uncaught throw: in both `F-3` probes the single stdout line was `EFFECT-DIGEST: …`, emitted from that hook after the process was already dying.

**Sources compared:** [`R-596 §3` arg 3: the precedent favours (B) | `run.mjs:96-98` verbatim: the precedent's stated purpose is to stop evidence being lost to `:138` | `F-3` probes: hook fires on a throw, finding does not]

**Source of truth:** the comment's own stated reason. The precedent is *"engineer around the early exit so the evidence survives"* — (A)'s direction. It is a precedent for **fixing** the truncation, not for redefining "evidence collection" down to the one line that already prints.

**Fix point:** `R-596 §3` argument 3.
**Repro:** `sed -n '92,105p' prototypes/p0-vnext-admission/run.mjs`
**Blast radius:** one of three legs under the provisional reading; with `F-6` it leaves arg 1 standing alone.

---

## Discrepancy F-6: `R-596 §3` argument (2) — the downgrade argument — is a non-sequitur. Premise true, inference invalid.

**Severity:** MODERATE

**Claim:** `R-596 §3` arg 2: *"`run.mjs:117` — 'exits immediately — nothing downstream can downgrade it' — is a DELIBERATE, MEASURED property … **`(A)` would re-open the downgrade path the design closed.**"*

**Reality:** `[MEASURED HERE]` I tested both halves using `run.mjs:840` **verbatim** (`process.exitCode = failures.length ? 1 : 0;`), in a standalone script touching no repo file:

| variant | result |
|---|---|
| collection gate defers (`process.exitCode = 1`), then `:840` verbatim | **exit 0** — the downgrade is **REAL**. Premise TRUE. |
| same deferral, `:840` becomes `(failures.length \|\| collectionFindings.length) ? 1 : 0` | **exit 1** — downgrade closed **without** the early exit. |

`run.mjs:840` is an unconditional **assignment**, so the risk is genuine. But it is closed by a one-token change. The argument therefore establishes *"the collection gate's failure must not be silently downgraded"* — which **both** readings satisfy — and not *"the evidence body must be suppressed."* It does not discriminate (A) from (B).

**Sources compared:** [`R-596 §3` arg 2 | `run.mjs:840` read at the executable line: plain assignment, no `||` | naive-defer probe: exit 0 | fixed-defer probe: exit 1]
**Source of truth:** the two probes.
**Fix point:** `R-596 §3` argument 2.
**Repro:** the two-variant script above; `sed -n '840p' prototypes/p0-vnext-admission/run.mjs`
**Blast radius:** leaves arg 1 as the sole surviving support for (B).

---

## Discrepancy F-7: argument (1)'s principle is not the principle the object follows

**Severity:** MODERATE (internal inconsistency; argument (1) itself is **NOT REFUTED**)

**Claim:** `R-596 §3` arg 1: when the pinned set is compromised, *"every downstream number is computed against a set that failed its own integrity check. **Emitting them is manufacturing confidence, not collecting evidence.**"*

**Reality:** `[MEASURED HERE]` the object does not apply that principle elsewhere. `FAILURE_CLASSES` entry `surface_invalid_rows` (`run.mjs:765`) declares its own run's number **INADMISSIBLE** in the finding text — *"the number is INADMISSIBLE"* — and that run prints **230 stdout lines, `full_body = YES`**. So a run the object itself calls inadmissible still emits the complete body. Same for `fixture_invalid` (230 lines, an authoring defect declared a gate failure).

**Sources compared:** [`R-596 §3` arg 1's principle | `surface_invalid_rows`: `exit=1 lines=230 own=Y full=Y` | `fixture_invalid`: `exit=1 lines=230 own=Y full=Y` | `module_collection_add/_delete`: `exit=1 lines=5 full=N`]

**Source of truth:** the measured line counts. **Argument (1) is the one leg of `R-596 §3` I could not refute** — it is a genuine substantive position about what a compromised pin should emit. But it is a position about what the design *ought* to do, not evidence about what *"after evidence collection"* **means**, and the object applies its opposite in at least two declared classes.

**Fix point:** none in code. `R-596 §3` arg 1 should be re-stated as a design preference, not a reading of the acceptance text.
**Repro:** `PROTO_INJECT=surface_invalid_rows node run.mjs | wc -l` → `230`
**Blast radius:** the surviving leg of (B) is weaker than `R-596 §3` presents it.

---

## NOT REFUTED — attack targets that came back clean

**Target 2 — is `OWN_FINDING` too weak?** `[MEASURED HERE]` **No, not in the way suspected.** The predicate discriminates: the clean control prints **zero** `/^\s*\*\*\* /m` matches (grep exit 1) while all 37 failing knobs print at least one. And the two divergent rows print substantive, self-naming, remediating findings — e.g. `*** module_collections: run.mjs: NEW UNPINNED module-level collection 'ROGUE_UNPINNED_TABLE' — pin it or bump 3978c1c5 (R-568 item 5)`. That is not a bare `***` decoration; it names class, file, object, and remedy. **The predicate's weakness is `F-1` (no in-population path to red), not triviality of content.**

**Target 5, part 1 — does the exit code leak a reading?** `[MEASURED HERE]` **No.** `evidence-order.mjs:168-177`: the `faults` list references `unknown.length`, `red.threw`, `red.ownFinding || red.fullBody`, `scored.length === 0`. The **population's** `fullBody` is never read by the exit logic; the only `fullBody` reference is the *red witness's*, which correctly guards the `0/0` requirement. The early `process.exit(1)` at `:100-102` fires only on a control that fails to exit 0. `R-597`'s read of this is correct and I confirm it. `R-598`'s STOP — *"`evidence-order.mjs` given an exit code that follows column (ii)"* — is not tripped at `ee31fe44`.

**`4d-i` and `4d-iii`.** `[MEASURED HERE]` All 37 knobs exit non-zero; the clean control exits 0 with 225 lines and 0 stderr bytes, reproduced 4×. Both fragments **confirmed independently.**

**`R-596 §1`'s six-file premise.** `[MEASURED HERE]` Re-derived by importing `module-collections.mjs` and reading `PINNED_MODULE_COLLECTIONS`'s keys — **not** by grepping source, so this is a genuinely different path from the doer's: `run.mjs`, `red-proof.mjs`, `type-value-proof.mjs`, `source-admission.mjs`, `runtime-admission.mjs`, `membership.mjs`. **`corpus.mjs` is not among them. Premise CONFIRMED.** Only the inference drawn from it fails (`F-3`).

---

## MANDATORY CLOSING COVERAGE

### (a) What I verified, and via which two-plus NON-OVERLAPPING paths

| Claim | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| Column (i) is `37/37`, not `25/25` | ran `evidence-order.mjs` unmodified (25 rows) | my own harness applying its **verbatim predicates** to the 12 knobs its parser cannot see | arithmetic closure against `red-proof.mjs` `EXPECT`: 21 declared + 16 undeclared = 37 |
| Column (i) has no in-population red (`F-1`) | read `run.mjs:133-138` and `:833-840` at the executable line — emission and exit share one guard | executed all 37 knobs: zero exceptions | `R-596 §0`'s own prose concedes *"TRUE on the acceptance population and FALSE outside it"* |
| Divergent rows fire `module_collections`, not `collection_shape` (`F-2`) | runtime stdout of both knobs | `FAILURE_CLASSES` block string test (positive control below) | `red-proof.mjs:89` vs `:100-101` — the object's own declaration table |
| Object mutations reach throw sites (`F-3`) | Probe A: `corpus.mjs` → `run.mjs:201` | Probe B: `corpus.mjs` → `module-collections.mjs:292` (**different file, different throw family**) | contrast against knob `new_unpinned_collection`, which reaches the printing path on the same defect class |
| Population truncated by 12 (`F-4`) | `case '…':` extraction diffed against the instrument's regex | **execution** of all 12 — all live, all exit 1 | full `grep -n INJECT run.mjs` (36 lines) enumerating the complete dispatch surface: only two forms exist |
| Downgrade argument (`F-6`) | read `run.mjs:840` — plain assignment | naive-defer probe → exit 0 | fixed-defer probe → exit 1 |
| Pin holds at `ee31fe44` | `git diff --stat ee31fe44 HEAD -- prototypes/` empty at start | re-run at end after HEAD moved twice | `git rev-parse --git-common-dir` confirms the correct linked worktree |

**Where I deliberately did NOT create a second path:** I did not re-run the doer's `evidence-order.mjs` invocation and call that a second path — reproducing an instrument is the same path wearing a second hat. Every corroboration above uses a different mechanism (execution vs. source read vs. runtime import vs. the object's own declaration table).

### (b) Positive-control witness for EVERY absence claim

| Absence claim | Positive control |
|---|---|
| `module_collections` is **not** in the `FAILURE_CLASSES` block | The **same** extraction on the **same** block returns `true` for `collection_shape`. The method finds what is there. |
| The clean control prints **no** `/^\s*\*\*\* /m` line (grep exit 1) | The **same** grep returns ≥1 hit on all 37 failing knobs, and 2 hits on `membership_delete`. |
| Probes A and B print **no** `*** ` line | Same grep, same predicate, returns hits on every non-throw failure; and both probes **did** emit their `EFFECT-DIGEST` line, proving stdout was captured and not simply lost. |
| The `faults` list has **no** population-completeness check beyond `length === 0` | **Mutation test:** I planted a known-bad (population truncated to 1) and the self-check **failed to catch it** — printed `MEASUREMENT COMPLETE`, exit 0. The known-bad was caught by nothing. |
| No **third** knob-dispatch form exists in `run.mjs` beyond `INJECT === '…'` and `switch (INJECT)`/`case` | I enumerated **all 36** lines matching `INJECT` in `run.mjs` and classified each: 1 declaration, 2 template-output echoes, 2 `switch` heads, 13 `case` labels, the rest `===` comparisons, remainder comments. No `.startsWith`, no index lookup, no double-quoted form. |
| `red-proof.mjs` `EXPECT` contains no knob outside my 37 | The same extraction found **21** rows and matched **21/21** into my 37 — the method resolves names successfully, and `21 + 16 = 37` closes. |

**Absence claim I explicitly decline to make:** I could not locate the origin of `R-596 §2`'s *"`red-proof`'s `43` … rows `36`/`37`"*. `[MEASURED HERE]` `EXPECT` has **21** rows by two independent counting methods, with the two knobs at the table's tail, and `grep -n '\b43\b' red-proof.mjs` returns nothing. **I did not run `red-proof.mjs`, so I do not claim the 43 is wrong** — I mark it `[UNENUMERATED]`. It is not load-bearing for this verdict; the `43`-half of `F-2` stands regardless, because `EXPECT` names the class `module_collections` explicitly.

### (c) Join key for every "identical / unchanged / matches" claim

- **"`prototypes/` byte-unchanged by this grade"** — join key: **`sha256` of all 12 `.mjs` files**, captured before any mutation and again after the final revert. **All 12 match exactly.** Baseline/final, verbatim: `corpus.mjs e377abc7…d78d27` · `emitted-freeze.mjs a4da4708…c81c315c` · `evidence-order.mjs 4fb19d67…818b9d2d` · `fs-tracker.mjs 03ef8f0f…1d96b242` · `membership.mjs be3639b4…aeb29ea4` · `module-collections.mjs cbb2cccf…6b5a5dff` · `module-tuple.mjs 63bbde8f…266683fba` · `red-proof.mjs 942b3473…192cb417` · `run.mjs a85c3f0d…3786557e` · `runtime-admission.mjs afa38b8d…6ae262f8627` · `source-admission.mjs ae8ae16a…5fe2f909` · `type-value-proof.mjs 0caab6bd…543c7606`. Plus `git status --porcelain -- prototypes/` **empty**, verified 3×.
- **"the object is the one named in the claim"** — join key: `git diff --stat ee31fe44 HEAD -- prototypes/`, **empty** at grade start (`HEAD=d1496213`) and at grade end (`HEAD=47d7127a`). The three intervening commits touch only `docs/designs/`.
- **"my harness uses the instrument's predicates unchanged"** — join key: the literal source of `BODY_MARKERS` (`['PINNED SURFACE:', 'SEPARABILITY:', 'NEGATIVE CONTROL:']`) and `FINDING_RE` (`/^\s*\*\*\* /m`), copied verbatim from `evidence-order.mjs:48-52`. My harness reproduces the instrument's own 25 rows identically before extending to 37.
- **"the two divergent rows are the same two the desk reported"** — join key: knob **name** (`module_collection_add`, `module_collection_delete`), `exit=1`, `lines=5`, and the `EFFECT-DIGEST` values `67ba9827…` / `e0d5a53b…`, which match `red-proof.mjs:173-174`'s pinned digests exactly.
- **"only two forms of `run.mjs:840`'s behaviour were compared"** — join key: the assignment expression copied character-for-character from `:840`.

### (d) WHAT I DID NOT VERIFY

1. **I did not run `red-proof.mjs`, `emitted-freeze.mjs`, `type-value-proof.mjs`, or `membership.mjs` as gates.** I read them and imported `module-collections.mjs`, but the "six scripts exit 0" acceptance leg is **`RELAYED`**, not measured here. The `43` denominator is `[UNENUMERATED]` for the same reason.
2. **Per-site reachability of the remaining `INSTRUMENT FAULT` throws.** I exercised **2 of ~22** (`run.mjs:201`, `module-collections.mjs:292`) — one more than `AR-639 §5`'s carried `[UNENUMERATED]`, and enough to refute `F-3`'s target claim, but the other ~20 are **`UNENUMERATED`**. I did not test whether `membership.mjs`'s 10 throws are object-reachable; by inspection they read **pinned git blobs**, not the working tree, so I expect not — that expectation is a **`HYPOTHESIS`**, not a measurement.
3. **Whether `module_collections` *should* count as a "terminal acceptance failure."** This is a question about the acceptance **text**, not the code. `F-2` shows the desk's only measured answer is wrong; it does not supply the right one. **Resolving it is a ruling, not a measurement, and it is a second open reading layered under the (A)/(B) one.**
4. **The acceptance text itself at its source.** I read the clause as quoted in my brief and in `R-594`/`R-596`; I did **not** open `V4-PHASE1-EXECUTION-GRAPH-2026-08-02.json` or verify blob `876c3a230d51815f49f98c36ea4109fe0b236b97`. Given `[obligation_lost_inside_a_mapped_fragment]` — this campaign has already lost *"after evidence collection"* once inside a restatement — **the verbatim clause should be re-read from the blob by whoever rules on this.** My verdict is scoped to the clause **as quoted to me**.
5. **The `(A)`-compatible fix, end to end.** `F-6`'s probe shows the downgrade is closable in principle with a one-token change to `:840`. I did **not** apply it to `run.mjs` and re-run the suite, so I do not claim reading (A) is *implementable without side effects* — only that arg 2 does not establish the contrary. `R-596 §6`/`R-598` make `run.mjs:138` a STOP and I honoured it.
6. **Cross-tree scope.** I worked exclusively in `C:/Users/tonio/Projects/wt-h1-wave4-20260712`. I did **not** sweep the primary tree or other worktrees for a second copy of `evidence-order.mjs`. Every null result here is scoped to **this tree**.
7. **Timing/ordering under concurrency.** Single-process runs only. Nothing about `runtime-production`, capital, credentials, or network was touched, read, or measured.

---

## WHAT THE DESK MUST DECIDE (not my call, but the fork is now explicit)

`4d-ii` cannot be discharged by `evidence-order.mjs` as it stands, under either reading, until the population question is answered. The fork:

- **If `4d`'s population includes throw-reachable terminations** — and `F-3` proves object-under-test one-field edits reach them in two files — then column (i) has real reds and **`4d-ii` is NOT MET under (B) either.**
- **If `4d`'s population excludes them**, then column (i) **cannot fail** (`F-1`) and reading (B) is **unfalsifiable in scope** — a green that is a restatement of `run.mjs`'s print structure. `4d-ii` is then **not dischargeable by this instrument at all**, and `R-594 §2`'s withdrawn `(B)` leg should be **reinstated**.

Either way the claim does not survive, and `F-4` must be fixed at the emitter before any figure from this instrument is cited again — a truncation to 1 knob currently reports a clean double green and erases the dispute.

---

**Grader's closing note.** Four of the five named targets returned findings and one (`OWN_FINDING`'s triviality) returned an honest null. The desk's decision in `R-597 §4` **not** to rule `4d` on `R-596 §3` was correct: two of those three arguments do not survive measurement, and the one that does is a design preference rather than a reading. The instrument is honest in intent — the reading-neutral exit logic is real and I confirm it — but its population is short by 12 and its central column has no path to red inside the scope it certifies.

**`4d` = `UNKNOWN`. Not MET, not NOT-MET. I decline to round it.**
