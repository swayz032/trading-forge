# GRADE — PLANT LANDING (`plant-landing.mjs`) · 2026-08-02

**Commissioned by:** R-603 · **Grader:** `accuracy-validator`, briefed to REFUTE · **Doer:** the worker that built both instruments (AR-646/AR-647) and correctly refused to certify either.
**Pinned object:** `prototypes/p0-vnext-admission/` @ **`3b9cc68e8d9171e67467f597c5779d1dd12d3c5f`**
**Instruments examined:** `plant-landing.mjs` (222 lines), `evidence-order.mjs` (`PINNED_KNOBS` only) · **System under test:** `run.mjs`
**Lineage declaration:** I did not design, build, or previously grade `plant-landing.mjs` or `evidence-order.mjs`. I have graded prior artifacts in this campaign lineage (`P0PC` 4d readings, batches 1–5, R-588). I re-derived every band below from the pinned artifacts only.

---

## VERDICT

> **REFUTED** — **band 5/10 · VERIFIED**

The claim has three conjuncts. Two survive; the load-bearing one fails.

| # | Conjunct | Verdict |
|---|---|---|
| A | "each of the 37 declared injection knobs … demonstrably changes the recorded effect ledger" | **CORROBORATED** (reproduced independently: 37/37, 37 distinct digests, 0 collisions) |
| B | "…attributable to its own injection" | **TRUE, but VACUOUS on 5 of 37 rows** — attributable to the injection's *name* by boolean/arithmetic construction, with no observation of the guarded code |
| C | **"a plant that does NOT land cannot be scored as one"** | **FALSE — REFUTED on 3 of 37 rows by direct measurement** |

Conjunct C is the entire reason the instrument exists (`plant-landing.mjs:4-7`: *"A knob whose plant silently no-opped would exit 1 for an unrelated reason and be scored as a pass — which is the load-bearing gap in 4d-i"*). I built three plants that were **requested but swallowed at their consumer**, and the detector scored all three `LANDED`, printed **`LANDING PROVEN`**, and exited **0**.

🛑 **READ THIS BEFORE ACTING:** this is a refutation of the **detector's discriminating power**, *not* a claim that the plants are broken. `[MEASURED HERE]` at `3b9cc68e` all four consumers I inspected do consume their plant, and all 37 knobs exit 1. **The desk's `37/37` number is very probably factually right. What is refuted is that this instrument establishes it.**

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `plant-landing.mjs` @ `3b9cc68e` | **5/10** | **VERIFIED** | 3 demonstrated false-`LANDED` rows (MUT-1/2/6); 1 correct-`UNPROVABLE` positive control (MUT-4); 28 control runs + 82 knob runs; digest recomputed from first principles on 2 rows | 5/37 rows are not evidence of landing; 2/37 cannot go red at all; red-proof witness class misses the failure mode; no population floor |

**Band reconciliation (required, claim−verified > 1).** AR-647 does not state a numeral, but "**ALL 37 PLANTS ARE PROVEN TO LAND … 0 ARE UNPROVABLE**" is a band-7/8-shaped certification. I verify **5**. The gap is *not* inflation of the measurements — every number AR-647 printed reproduced exactly in my proxy, including the control digest to all 64 hex characters, and §6's self-disclaimers are unusually honest and accurate. The gap is that the instrument's **red-proof exercises one failure axis only** (a knob *name* with no implementation), and the axis the claim needs to exclude (a knob *requested* but *swallowed*) was never tested — and fails. Band 5 = "happy-path only" is the correct rubric row: the happy path here is *the plant actually working*. It is not lower because 32/37 rows are sound, determinism and string-level attribution survived substantially harder attack than they were originally given, and the `UNPROVABLE` branch turns out to be correct.

---

## TARGET 1 — Is `EFFECT-DIGEST` a sound landing detector? **NO, on 5 of 37 rows.**

### The census `[MEASURED HERE — grep -n "recordEffect(" run.mjs, all 10 sites]`

The ledger is `acc.push([surface, value])` hashed at `run.mjs:102`. Ten sites feed it. The question I asked of each: **is the recorded `value` an observation of work, or a function of `INJECT`?**

| `run.mjs` | surface | recorded value | class |
|---|---|---|---|
| `:121` | `collection_simulation` | `{simulateDelete: INJECT==='…'?{…}:null, simulateAdd: INJECT==='…'?{…}:null}` | **REQUEST** |
| `:344` | `corpus_under_test` | the selected/mutated population, as built | observed |
| `:448` | `submitted_bodies` | `r.submittedBody` — the body actually submitted | observed |
| `:484` | `greens_under_test` | as built | observed |
| `:535` | `negative_control_reported` | `INJECT==='neg_control' ? false : !ctrlRes.violations.some(…)` | **REQUEST** |
| `:536` | `surface_extra_roots` | basenames of **real** temp dirs created at `:526` | observed |
| `:540` | `emit_tuple_args` | `{injectWrongContainer: INJECT==='emitted_module'}` | **REQUEST** |
| `:557` | `getter_invocations` | `__GETTER_HITS__ + (INJECT==='getter' ? 1 : 0)` | **REQUEST** |
| `:589` | `live_collections` | the mutated collections, as built — but recorded **before** its consumer at `:594` | observed, upstream |
| `:711` | `ledger_hits` | `[...ledgerHits].sort()` after `:706` adds to the tracked set | observed |

Four sites record a value that is a **pure function of the environment variable**. They cover five knobs: `module_collection_add`, `module_collection_delete`, `emitted_module`, `getter`, `neg_control`.

This is the defect `run.mjs:41-60` was written to eliminate, surviving one layer down. That header declares: *"IDENTITY FROM WHAT WAS \*BUILT\*, NEVER FROM WHAT WAS \*ASKED FOR\*"* and property 1: *"`INJECT` IS NEVER RECORDED. Recording the label would rebuild the echo one layer down… What goes in is the VALUE that reached the check."* `[MEASURED HERE]` **`INJECT` is indeed never recorded verbatim** (Target 3 positive control below proves it). But `{injectWrongContainer: true}` is a one-bit re-encoding of `INJECT === 'emitted_module'`, and `+1` is an arithmetic one. **The echo was rebuilt in a boolean and in an integer.** `run.mjs:118-120` defends `:121` with *"Recording the argument rather than the flag that produced it is the whole point"* — `[MEASURED HERE]` at `:540` the argument **is** the flag, boolean for boolean; that distinction does not exist at that line.

### The two early-exit rows: the ledger is *nothing but* the request `[MEASURED HERE — independent recomputation]`

At the pin, `module_collection_add`/`_delete` redden the collection gate and `run.mjs:138` calls `process.exit(1)`, so `:121` is the **only** `recordEffect` that ever executes. I recomputed both digests from the object literal at `:121-126` and the hash expression at `:102` **without running the system**:

```bash
node -e "const {createHash}=require('crypto'); const h=a=>createHash('sha256').update(JSON.stringify(a)).digest('hex');
console.log(h([['collection_simulation',{simulateDelete:null,simulateAdd:{file:'run.mjs',collection:'ROGUE_UNPINNED_TABLE'}}]]));
console.log(h([['collection_simulation',{simulateDelete:{file:'red-proof.mjs',collection:'EXPECT',key:'new_unpinned_collection'},simulateAdd:null}]]));"
```
```
recomputed  module_collection_add    : 67ba9827bd50af5270bbd2100310edfc84a329019ec5603d14a8f9c7c674fcba
observed    module_collection_add    : 67ba9827bd50af5270bbd2100310edfc84a329019ec5603d14a8f9c7c674fcba   ← EXACT, 64/64 chars
recomputed  module_collection_delete : e0d5a53b51a06f5e7deeaf4d9458661c01397ac42d4064fd89329c50f0c4e27d
observed    module_collection_delete : e0d5a53b51a06f5e7deeaf4d9458661c01397ac42d4064fd89329c50f0c4e27d   ← EXACT, 64/64 chars
```

**A landing witness I can predict from the source text, before any work happens, is a receipt for the request.** For these two rows the recorded "effect ledger" contains exactly one entry and that entry is the request object. `digest ≠ control` is a mathematical consequence of the env var. It cannot fail to differ, and it carries zero information about whether `checkPinnedCollections` responded.

### Discrepancy F-1 — a requested-but-swallowed plant is scored `LANDED`

```
### Discrepancy F-1: EFFECT-DIGEST scores a swallowed plant as LANDED (3 of 37 knobs)
**Severity:** CRITICAL (false positive — the exact false-green the instrument exists to prevent)
**Claim:** "a plant that does NOT land cannot be scored as one" (R-603 brief; plant-landing.mjs:4-7, :219)
**Reality:** three plants swallowed at their consumer were each scored LANDED, printed
             "LANDING PROVEN: all 1 pinned plants land, each attributable to its own injection",
             and exited 0.
**Sources compared:** [plant-landing.mjs verdict: LANDED | process exit of run.mjs: 0, i.e. the gate
             never fired | normalized stdout: BYTE-IDENTICAL to the clean control]
**Source of truth:** the exit code and stdout. The run behaved exactly like the clean control —
             nothing was planted. Only the recorded REQUEST moved the digest.
**Fix point:** run.mjs:121 · run.mjs:540 — recordEffect wraps the ARGUMENT handed to the consumer.
             The record must be taken from the consumer's OBSERVED response, not its input.
**Blast radius:** plant-landing.mjs's own verdict for 3 rows; red-proof.mjs's PINNED_EFFECT_DIGESTS
             for emitted_module (measured blind, below); the "37 plants proven to land" position
             already recorded in ADVISOR-STATE at 06ad5e51.
```

**Repro (runs in an isolated copy; nothing in the campaign tree is touched):**
```bash
# 1. materialise the pin from the object DB
git cat-file blob 3b9cc68e:prototypes/p0-vnext-admission/module-collections.mjs > module-collections.mjs   # (and the other 20 files)
# 2. ONE-TOKEN EDIT — swallow the plant at its consumer, module-collections.mjs:334
#      if (simulateAdd?.file === file) {        ->   if (false && simulateAdd?.file === file) {
# 3. ask the detector
node plant-landing.mjs --population module_collection_add
```
Observed:
```
module_collection_add         0     LANDED       digest≠control       a628e2263a64
POPULATION: 1 pinned knobs
LANDED     : 1/1  {"digest≠control":1}
UNPROVABLE : 0
LANDING PROVEN: all 1 pinned plants land, each attributable to its own
PROCESS EXIT: 0
```
The same one-token edit at `module-collections.mjs:347` (`module_collection_delete`) → `LANDED`, `b366f0d7a895`, exit 0.
Ignoring the argument at `module-tuple.mjs:51` (`emitted_module`) → `LANDED`, `b7abc0bfb3f1`, exit 0.

**`emitted_module` is the worst of the three and the finding is sharper than "false positive"** `[MEASURED HERE, probe2]`:

| | digest |
|---|---|
| clean control | `c5eb7df2c8c4d6cc…` |
| `emitted_module`, plant **lands** (pristine pin) | `b7abc0bfb3f1f72c…` — exit **1** |
| `emitted_module`, plant **swallowed** | `b7abc0bfb3f1f72c…` — exit **0** |

**Byte-identical.** The effect digest for this knob is *insensitive to whether the plant landed at all* — it records `{injectWrongContainer:true}` and nothing downstream. For this row the digest channel is not merely weak, it is **provably blind**, and no digest pin anywhere can catch a regression in it.

**Why this is a real defect and not a simulated one:** the edits are ordinary source edits at the consumer — precisely the shape of a refactor that breaks a plant. Nothing in the harness is bypassed. The join key proving the fixture is clean: in **every** mutated tree the control digest stayed `c5eb7df2c8c4d6ccffdc993e15b1e55b3978641112aa44be2cb21a4a8c0c51f4`, identical to the pristine pin — so each mutation touched only the injected path.

### Discrepancy F-2 — two rows cannot go red at all

```
### Discrepancy F-2: `getter` and `neg_control` landings are entailed by the env var
**Severity:** CRITICAL (vacuous certification — a check with no path to red)
**Claim:** these two rows are evidence that their plants landed.
**Reality:** the recorded value is a pure re-encoding of PROTO_INJECT. No consumer can swallow it,
             because the injection's entire effect IS the recorded number.
**Sources compared:** [recorded getter_invocations: 0 -> 1 | RAW observed __GETTER_HITS__: 0 -> 0]
**Source of truth:** the raw observable. The `getter` injection invokes no getter.
**Fix point:** run.mjs:554 (`+ (INJECT === 'getter' ? 1 : 0)`) · run.mjs:519 (`? false :`)
**Blast radius:** 2 of the 37 rows in AR-647 §3's table.
```
**Repro** — add one stderr line beside `run.mjs:554` (stdout and the ledger stay untouched) and run the control and the knob:
```
PROTO_INJECT=""        GRADER_RAW_GETTER_HITS=0 RECORDED=0   digest=c5eb7df2c8c4
PROTO_INJECT="getter"  GRADER_RAW_GETTER_HITS=0 RECORDED=1   digest=14568f293edc
```
`[MEASURED HERE]` **the only real observable, `__GETTER_HITS__`, does not move.** `corpus.mjs:307`'s lazy getter is invoked zero times in both runs. The `+1` is synthesised from the env var, so `digest ≠ control` is arithmetically entailed — `__GETTER_HITS__ + 1 === __GETTER_HITS__` is unsatisfiable. **There is no state of the world in which this row reports anything but `LANDED`.** I applied the desk's own rule before calling it vacuous (`FORCE IT RED before calling it vacuous`): the row has no consumer to swallow and no arithmetic path to equality, so it cannot be forced red.

`neg_control` `[ARTIFACT-SOURCED — run.mjs:519, read at the executable line]`: `reported: INJECT === 'neg_control' ? false : !ctrlRes.violations.some(…)`. `admitRuntime` at `:516` runs identically either way and its result is **discarded** for this field; the injection overwrites the reported boolean directly. Same class as `getter`. I did not build a fixture for it, so its unfalsifiability is `[HYPOTHESIS]` from the source text, not measured.

★ The contrast that shows `run.mjs` knows the difference: `:525-529` (`surface_health`) creates a **real** broken file on disk, and the comment says so — *"The injection adds a REAL broken root, so the detector's real diagnostic path runs."* That is a genuine plant. Four sites are not.

---

## TARGET 2 — Is 3 control runs enough? **I could not make the control digest wander. HONEST NULL.**

`[MEASURED HERE — probe1 (12 serial + 8 env/cwd), probe3 (8 concurrent)]` **28 control runs, zero variation.**

```
=== A · CONTROL x12 (serial) ===
distinct digests    : 1  [ 'c5eb7df2c8c4' ]
distinct stdout sha : 1        distinct NORM sha : 1
exits : [ 0 ]   stderr bytes : [ 0 ]   stdout byte lengths : [ 13342 ]

=== B · ENV / CWD VARIATION ===                      === C · CONCURRENCY ===
baseline    sameDigest=true  sameNorm=true           8 controls launched simultaneously
TZ=Asia/Tokyo      true            true              distinct digests : 1
TZ=UTC             true            true              all == serial baseline c5eb7df2… : true
LANG/LC_ALL=de_DE  true            true              distinct normalized stdout : 1
TMPDIR/TEMP/TMP=A  true            true
TMPDIR/TEMP/TMP=B  true            true
cwd = parent dir   true            true
cwd = filesystem root  true        true
```

★ **The strongest determinism evidence is one I did not design for:** my proxy sits at a different absolute path, on a different drive location, with `typescript` resolved through a shim — and it reproduced AR-647's reported control digest `c5eb7df2c8c4d6ccffdc993e15b1e55b3978641112aa44be2cb21a4a8c0c51f4` **to all 64 characters.** That is a genuinely non-overlapping second path to the same value.

⚠️ **This raises the evidence but does not change its kind.** The worker's own grading was right: *"EVIDENCE of determinism, not PROOF."* 28 runs bound the per-run flip probability, they do not exclude a rare or environment-specific wander. I did not vary: node version (24.13.0 only), OS, filesystem type, or locale beyond `de_DE`. Unpinned input worth naming: **the runs depend on `typescript@5.9.3` resolved from an ancestor `node_modules` outside the 21-file pin** (`sha256(lib/typescript.js) = 3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`). A different TypeScript would be free to move every digest.

**Target 2: NOT REFUTED.**

---

## TARGET 3 — "the environment variable is the only thing that changed." **NOT REFUTED, and it now rests on more than the worker had.**

The worker tested the **control** three times. It never tested a **knob** twice — so the table was 37 single measurements, and `run.mjs:66-68`'s own stated property (*"the parent asserts that the same injection twice yields the SAME digest"*) was **not** asserted by `plant-landing.mjs`, which runs each knob exactly once (`:128`). I closed that gap.

`[MEASURED HERE — probe1 §D: two full passes over all 37, the second in REVERSE order]`
```
knobs whose digest OR normalized stdout MOVED between the two passes: 0
knobs sharing the CONTROL digest: 0 []
distinct digests across 37: 37 | collisions: 0
exit-code histogram: { '1': 37 }        knobs exiting 0: []       STDERR nonzero knobs: []
PLANT_WITNESS coverage: 2/37 [ 'own_extra_inside_anchor', 'substituted_diagnostic' ]
```
`[MEASURED HERE — probe3: 8 knobs run concurrently vs serially]` all 8 digest-identical (`emitted_module`, `getter`, `neg_control`, `wrong_catcher`, `parse`, `surface_health`, `ledger_read`, `twin`).

**Positive control for the absence claim "`INJECT` does not leak into the ledger"** — six unimplemented names, chosen to attack length, case, near-miss and JSON-hostility:
```
zzGRADER_a                                digest==control:true  norm==control:true
zzGRADER_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  digest==control:true  norm==control:true
zz"quote\slash                            digest==control:true  norm==control:true
zz{json:1}                                digest==control:true  norm==control:true
emitted_modulE      (case variant)        digest==control:true  norm==control:true
emitted_module_     (suffix variant)      digest==control:true  norm==control:true
```
**No leak, and matching is exact** — no prefix/substring/case accident can move a digest. `run.mjs` is byte-identical across runs by construction of the harness (`plant-landing.mjs:49-54` re-spawns the same file path and varies only `PROTO_INJECT`), and I verified my proxy's 21 files were pin-identical at both start and end.

**Target 3: NOT REFUTED at the string level.** ⚠️ But note precisely what this buys: the digest difference *is* attributable to the env var. F-1/F-2 show that for 5 rows **that is all it is attributable to** — the env var, not the work. Attribution and evidence are not the same property, and this claim only establishes the first.

---

## TARGET 4 — Does the red-proof discriminate, and is the guard the SAME one? **YES to both. NOT REFUTED.**

`[MEASURED HERE — `grep -n "faultsFor" plant-landing.mjs`, complete output, 2 lines]`
```
108:function faultsFor(rs) {
191:for (const f of faultsFor(rows)) note(f);
```
**Exactly one definition, exactly one call site.** Stage 2 spawns *the same file* (`:202 fileURLToPath(import.meta.url)`), so the child reaches `:191` by the identical code path. **Not a test-only copy — confirmed at the executable line.**

`[MEASURED HERE — `grep -n -i "population\|process.argv\|process.env" plant-landing.mjs`]` `POPULATION` is read only from `process.argv` (`:118-119`). The file's **only** `process.env` use is `:51`, passing `PROTO_INJECT` to the child. **There is no environment path to the population.** AR-647 §4's claim that `--population` "cannot silently redirect a real measurement" is **NOT REFUTED**: it is argv-only, and `:120` prints a `⚠️ POPULATION OVERRIDDEN` banner.

**Is the `UNPROVABLE` verdict driven by evidence or by the name looking synthetic?** `[MEASURED HERE — MUT-4]` I swallowed the plant of **`wrong_catcher`** — a real, pinned, unremarkable knob name — with a one-token edit at `run.mjs:358`:
```
wrong_catcher                 0     UNPROVABLE   digest==control and stdout==control  c5eb7df2c8c4
UNPROVABLE : 1 (wrong_catcher)
*** STOP CONDITION (plant landing): PLANT NOT PROVEN TO LAND: 'wrong_catcher' — digest==control
    and stdout==control; its exit code cannot be credited to an injection
PROCESS EXIT: 1
```
**The classifier is evidence-driven, not name-driven, and the guard fails the command and names the knob.** `classify()` reaches `UNPROVABLE` through `digest === CONTROL.digest`, with no reference to the name. **This is a favourable finding and it is the positive control that makes F-1 damning:** the same detector, same harness, same population size, same swallow technique — **red** for `wrong_catcher`, **falsely green** for `module_collection_add`/`_delete`/`emitted_module`. The only difference is whether the recorded entry is the work or the request.

### Discrepancy F-3 — the red witness is drawn from the wrong failure axis

```
### Discrepancy F-3: the red-proof's disabled-plant class misses the class the claim excludes
**Severity:** CRITICAL (a guard with no path to red on the failure mode that matters)
**Claim:** AR-647 §4 — a disabled plant is caught, "precisely the state a silently-no-opping knob
           would be in."
**Reality:** the three witnesses are knob NAMES WITH NO IMPLEMENTATION, so no `INJECT === '…'`
           branch fires and nothing is recorded. That tests "never requested". The failure mode
           conjunct C must exclude is "requested, recorded, then swallowed" — never tested, and it
           fails.
**Sources compared:** [disabled-name witnesses: 3/3 caught | requested-but-swallowed: 0/3 caught]
**Source of truth:** the swallowed fixtures (F-1). Both are "the plant did not land".
**Fix point:** plant-landing.mjs:161 — the `disabled` array enumerates one axis only.
**Blast radius:** the whole `37/37` certification; AR-647 §4's two-stage red-proof claim.
```
The parenthetical at `plant-landing.mjs:158` — *"Nothing in run.mjs matches it, so no plant applies — exactly the state a silently-no-opping knob would be in"* — is the load-bearing mechanism claim, and it is **false**. `[MEASURED HERE]` a name that matches nothing produces `digest == control` (caught). A name that matches and is then swallowed produces `digest ≠ control` (**not** caught). These are different states and the instrument only tests the benign one. The constraint that forced this is real and stated honestly (`run.mjs` was read-only under R-602 §4.1) — but a red-proof restricted to the axis the constraint permits is a red-proof on one axis, and the receipt should say so.

### Discrepancy F-4 — no population floor (lower severity, but it is R-601's shape again)

```
### Discrepancy F-4: any subset prints "LANDING PROVEN" and exits 0
**Severity:** HIGH (a partial result that reads as complete)
**Claim:** the receipt line "POPULATION: 37 pinned knobs / LANDED: 37/37 / LANDING PROVEN".
**Reality:** POPULATION comes from argv with no membership check against PINNED_KNOBS and no floor.
**Sources compared:** [--population emitted_module -> "POPULATION: 1 pinned knobs … LANDING PROVEN:
           all 1 pinned plants land", exit 0 | PINNED_KNOBS.length = 37]
**Source of truth:** PINNED_KNOBS (evidence-order.mjs:229, Object.freeze, 37 members).
**Fix point:** plant-landing.mjs:119 — POPULATION is unchecked; faultsFor() has no completeness term.
**Blast radius:** any future re-run or wrapper; the word "pinned" in the summary caption.
```
`[MEASURED HERE — pristine pinned instrument, no mutation]`
```
$ node plant-landing.mjs --population emitted_module
⚠️ POPULATION OVERRIDDEN (red-proof mode): emitted_module
POPULATION: 1 pinned knobs
LANDED     : 1/1  {"digest≠control":1}
LANDING PROVEN: all 1 pinned plants land, each attributable to its own
PROCESS EXIT: 0
$ node plant-landing.mjs --population getter,neg_control
POPULATION: 2 pinned knobs ... LANDED: 2/2 ... LANDING PROVEN: all 2 pinned plants land   exit 0
```
This is the shape **R-601 §2** minted a law about one ruling earlier — *"A POPULATION OF ONE IS REPORTED AS A COMPLETE MEASUREMENT"*, *"the population needs a FLOOR THAT BITES, AND A COUNT WILL NOT DO IT"* — and `plant-landing.mjs` has no floor, not even a count. Mitigation, stated fairly: the `⚠️` banner does print, so this is **not silent**, and `faultsFor()` is the only exit-code driver. But the banner is a `console.log`, and the instrument's own law is `AN ASSERT THAT CANNOT FAIL THE COMMAND IS A PRINTOUT` (`:195`). The caption `N pinned knobs` is false whenever the override is used — a caption is a claim.

---

## TARGET 5 — Is the `UNPROVABLE` branch reachable and correct on a real knob? **YES. DISCHARGED FAVOURABLY.**

AR-647 §6 declared this `[UNENUMERATED]`: *"`UNPROVABLE` was defined but never observed on a real knob, so that branch's behaviour on a REAL population is unenumerated."* **It is now enumerated.** MUT-4 (Target 4 above) is the witness: `wrong_catcher`, a real pinned knob with its plant swallowed, was classified `UNPROVABLE` on the correct evidence (`digest==control and stdout==control`), named in a `*** STOP CONDITION`, faulted through the shared `faultsFor()`, and **exited 1**. The branch is reachable, correctly guarded, and correctly wired to the process exit code.

**Minimal repro:** materialise the pin, change `run.mjs:358` to `if (false && INJECT === 'wrong_catcher' && …)`, run `node plant-landing.mjs --population wrong_catcher` → exit 1.

---

## TARGET 6 — A knob showing a distinct digest while NOT exercising the class it names? **YES — two, and the desk should know which.**

**`getter` does not invoke a getter.** `[MEASURED HERE — MUT-3, above]` `__GETTER_HITS__` is `0` in the control and `0` under the injection; `corpus.mjs:307`'s lazy getter fires zero times either way. The knob exercises *the gate's arithmetic reaction to a non-zero count*, not *a getter being invoked*. Its name promises the latter.

**`neg_control` does not make the negative control fail.** `[ARTIFACT-SOURCED — run.mjs:519]` it overwrites the *reported* boolean with `false`; `admitRuntime`'s actual violations are computed identically and discarded for that field. The knob exercises *the gate's reaction to a false report*, not *the negative control genuinely failing*.

⚠️ **This is a 2-of-37 answer, not a survey.** The worker's §6 scope limit — *"LANDED … does NOT mean the plant landed WHERE ITS AUTHOR INTENDED, or that it exercises the class it names"* — is **correct and I could not overturn it**; I confirmed it costs something real on at least these two rows. The knob→class mapping for the other 35 is **NOT derived here** and remains owed (AR-645 §8).

---

## MANDATORY COVERAGE SECTION

### What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| control digest `c5eb7df2…` is the pin's true control | 12 serial runs in my proxy | AR-647's reported value, reproduced from a **different absolute path** with shimmed `typescript` | 8 concurrent runs + 8 env/cwd variants |
| `module_collection_add`/`_delete` ledger = the request only | observed digest from `run.mjs` | **first-principles recomputation** from `:121-126` + `:102`, no instrument involved (exact 64/64 match) | early-exit at `:138` is the only reachable path |
| a swallowed plant is scored `LANDED` | `plant-landing.mjs` verdict = `LANDED`, exit 0 | `run.mjs` process exit = 0 and normalized stdout **byte-identical to the control** | `red-proof.mjs` in the same tree: `*** FAIL emitted_module exit=0` |
| the digest channel is blind to `emitted_module`'s landing | swallowed digest `b7abc0bf…` == landed digest `b7abc0bf…` | `red-proof.mjs` `EFFECT IDENTITY … pinned=true` line **byte-identical** in pristine and mutated trees | — |
| `getter`'s recorded effect is synthesised | raw `__GETTER_HITS__` 0→0 while `RECORDED` 0→1 | source read at `run.mjs:554` | arithmetic: `n+1 === n` unsatisfiable |
| per-knob determinism | forward pass over 37 | reverse-order pass over 37 | 8 knobs concurrent vs serial |
| `faultsFor()` is shared | complete grep: 1 definition, 1 call site | stage 2 spawns the same file path (`:202`) so the child reaches `:191` | MUT-4: a real knob faulted through it and exited 1 |

### Positive-control witnesses for every absence claim I make

| My absence claim | Positive control that proves the method can see the thing |
|---|---|
| "`INJECT` does not leak into the ledger" | 6 unimplemented names — long, case-variant, suffix-variant, JSON-hostile — **all** returned `digest == control` **and** `norm == control`. A leak of any kind would have moved at least one. |
| "the control digest does not wander" | The method **does** detect movement: the same comparison flagged 37 distinct knob digests and, in MUT-1/2/6, three digests that moved off the control. |
| "no knob shares the control digest" | MUT-4 **produced** a knob sharing the control digest (`wrong_catcher`, `c5eb7df2c8c4`) and the detector reported it. The channel is not stuck-on-distinct. |
| "only 4 of 10 `recordEffect` sites are request-shaped" | Enumerated surface: complete `grep -n "recordEffect(" run.mjs` output, all 10 sites read individually at the executable line. Cross-check: complete `grep -n "INJECT ===" run.mjs`, 25 sites. |
| "`faultsFor` has no second copy" | Complete unfiltered grep output quoted (2 lines); plus `grep -rn "plant-landing\|--population"` across all 21 files returned no other referencing file. |
| "the red-proof cannot catch a swallowed plant" | The **same** red-proof **did** catch a name-disabled plant, 3/3, in the same runs. It is not inert — it is axis-limited. |

### Join key for every "identical / unchanged / matches" claim

| Claim | Join key |
|---|---|
| my proxy == the pin | per-file `sha256` of `git cat-file blob 3b9cc68e:<path>` vs the file on disk, **21/21, checked at start AND end**, plus a file **count** on both sides (21 = 21) |
| each mutated tree differs from the pin in exactly one place | control digest in that tree == `c5eb7df2c8c4d6ccffdc993e15b1e55b3978641112aa44be2cb21a4a8c0c51f4` (the pristine control), verified in all five trees |
| `emitted_module` swallowed == `emitted_module` landed | full 64-char `EFFECT-DIGEST` `b7abc0bfb3f1f72c…`, both runs |
| `red-proof.mjs`'s digest apparatus unchanged by the swallow | the `EFFECT IDENTITY: 38 distinct injections fingerprinted by OBSERVED EFFECT \| pairwise-distinct=true deterministic=true pinned=true (declared 38)` line, **byte-identical** in `redproof-pristine.out` and `redproof-mut2.out` |
| the pinned object is unchanged at current HEAD | `git diff --stat 3b9cc68e ec69459c -- prototypes/p0-vnext-admission/` → **empty** |
| my verdict describes the same bytes AR-647 measured | commit `3b9cc68e`, and the 21-file sha256 table below |

### What I did NOT verify

- **31 of the 32 sound rows.** I demonstrated the detector *would* catch a swallowed plant on **one** observed-effect knob (`wrong_catcher`). That the other 31 behave the same is `[HYPOTHESIS]` from the shared `recordEffect`-of-observed-value structure. I did not build 31 fixtures.
- **`run.mjs:589 live_collections` — 3 knobs (`twin_pairs_delete`, `prereg_delete`, `new_unpinned_collection`).** The record at `:589` precedes its consumer `checkAuxiliaryCollections` at `:594`, so it is **structurally swallowable in the same way as F-1**. I did **not** run that mutation. `[HYPOTHESIS]` — if confirmed, F-1's count rises from 3 to 6.
- **`neg_control`'s unfalsifiability** — read at `:519`, not measured with a fixture.
- **The knob→class mapping** for 35 of 37 knobs (Target 6 beyond the two found). Still owed per AR-645 §8.
- **`corpusUnderTest()`'s switch** (`run.mjs:~300-338`) — which knobs route through `:344` was not enumerated.
- **`red-proof.mjs`'s `43` denominator and its `38` declared effect digests vs the `37` pinned knobs.** A visible denominator mismatch I did not re-derive; out of scope, and AR-647 §6 already flags it.
- **Combinatorial injections** — every run here is single-knob, as the harness only supports.
- **`evidence-order.mjs` column (i) and clause `4d`** — excluded by the brief as settled (R-600). I did not re-examine them and this grade neither supports nor disturbs them.
- **Determinism beyond one machine:** node 24.13.0, Windows 11, one filesystem, `typescript@5.9.3`. No other node/OS/TS combination tested.
- **`runtime-production`** — not touched, not read. No trading, capital or broker surface was in scope or examined.

---

## PROXY PROOF

Materialised with `git cat-file blob 3b9cc68e:<path>` (object DB — no smudge filters, and no concurrent agent can move it). Anchored to the **commit**, never to the working tree.

**File count: pin 21 · proxy 21.** `sha256` mismatches: **0 at start, 0 at end.**

| sha256 (pin blob == proxy file) | path (under `prototypes/p0-vnext-admission/`) |
|---|---|
| `dc27e4643b53c9579f727af6ad929bce793a77c3ffb3f89e21fc59f53e25f35a` | `RESULTS-2026-08-02.md` |
| `e377abc758897aa5dc3d49834634d81f803c58cfe648a8503ed37c75f7d78d27` | `corpus.mjs` |
| `a4da4708a7a5fba7b3b62b19ee8092b03a46fd150d54ba22e2fe5847c81c315c` | `emitted-freeze.mjs` |
| `9af0d6eecc247fcf164c3e9559177070970b7afea30eb84937bcc6c605af0f87` | `evidence-order.mjs` |
| `03ef8f0f4dde43b29ac6837f8c64ed8cef571a28c359bc3c34ac853d1b96b242` | `fs-tracker.mjs` |
| `b4bcf23bbb71a42a21561848af654bfac68d132322c00a37c547f0a74cc1191b` | `knob-population-redproof.mjs` |
| `be3639b42baa7ba09dbc589e5c929efe6b8c6b9b1d7f83ebcda75b93aeb29ea4` | `membership.mjs` |
| `cbb2cccfc164e3b85145857a0b5f4071688ad59a9d8127d3736063f66b5a5dff` | `module-collections.mjs` |
| `63bbde8f75ac5fe5212379ff241baf945e6d2503df1883d3d6d49b4266683fba` | `module-tuple.mjs` |
| `f52f7cafb69e62aa0f3ba5772082c7fc6ef5d786814e2e828ac7888f3e9f18f9` | **`plant-landing.mjs`** |
| `942b347357cc27cd5eecc63942d410e3c50562553a94fe314d93d81a192cb417` | `red-proof.mjs` |
| `a85c3f0d3541cd465725140af06266eb451118da03e6ae229643b12c3786557e` | **`run.mjs`** |
| `afa38b8d89e4bb822e78eeb3d33da683deffbcd35e7765db43ae96ae262f8627` | `runtime-admission.mjs` |
| `ae8ae16abc23745bf598cad3927c5c7e14d3f4d05fce20e717bbad5f8fe2f909` | `source-admission.mjs` |
| `00140b2ee7dd7d1bd63ff30ff12274711d9510a9541d784afd0015d9ffced1ad` | `surface/ambient.d.ts` |
| `27f16c1b2952371f7111fe8075dad6ae94de6eaa5b797dc701655c4bf72236ed` | `surface/helper.ts` |
| `c5299befce35142b76162d01c9a604dedac22d34a432d74bdb6149464e8ede5f` | `surface/ledger.ts` |
| `8d5cf54ed160f49e1fa06527e74796767a2d9969c6331a2ecd414abaa323e36f` | `surface/package.json` |
| `72c55be9ae1afeea8294ef3651fba2970d2db099273427373cf92036c70d862e` | `surface/pure-math.ts` |
| `21a54038ff861d4320dc813bbb256462d34386f30ea7a03890871290261c083f` | `surface/tsconfig.pinned.json` |
| `0caab6bda2d9409ce3c931ca88017ab9ca5af066d236cf421f66c6a9543c7606` | `type-value-proof.mjs` |

**Declared proxy substitutions** (a proxy-for-production must declare its substitutions):
1. `typescript` is resolved through a 1-line CJS shim that `require`s the campaign tree's real `node_modules/typescript/lib/typescript.js` (`sha256 3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`, v5.9.3). The **same bytes** of TypeScript execute; only the resolution path differs, and `ts`'s default-lib resolution still points at the real package directory.
2. `GIT_DIR` is set to the container's git common dir so `membership.mjs:64` / `module-collections.mjs:189`'s `git show <commit>:<path>` object reads resolve from outside the repo. These are immutable object reads.
3. **Neither substitution moved the measurement:** the proxy reproduced AR-647's control digest exactly.

**Isolated work location** (all execution, all mutation): `…\scratchpad\plant-grade\` (pristine) and `…\scratchpad\mut{1,2,3,4,6}-*\` (one mutation each). Every mutated tree was verified 21/21 pin-identical *before* its mutation.

---

## RESTORATION / NON-INTERFERENCE PROOF

```
$ git status --porcelain -- prototypes/     # AT START
(empty)
$ git status --porcelain -- prototypes/     # AT END
(empty)
```
**Clean at both ends.** No file in `prototypes/` was created, modified, or deleted by me. Per-file content join re-verified at the end: **0/21 drift vs `3b9cc68e`**.

⚠️ **HEAD MOVED MID-GRADE — and this is why the brief's object-DB recipe mattered.** `HEAD` was `3b9cc68e` at start and `ec69459c` at end (6 new commits: R-603, AR-648, R-604, AR-649, and two ADVISOR-STATE updates). `[MEASURED HERE]` `git diff --stat 3b9cc68e ec69459c -- prototypes/p0-vnext-admission/` is **empty** — the pinned object did not move, only `docs/designs/*`. **So this verdict describes both `3b9cc68e` and current `ec69459c`.** Had I anchored to the working tree instead of the commit, this grade would have been unattributable.

**No index operation of any kind** was run in this worktree: no `checkout`, `reset`, `stash`, `add`, `commit`, `worktree`, or `restore`. Every read of pinned content went through `git cat-file` / `git show` / `git ls-tree` (object reads). `runtime-production` was neither read nor touched. `ADVISOR-RULINGS.md`, `ADVISOR-STATE.md` and `AGENT-REPORTS.md` were **read only**. This file is the only file I wrote in the campaign tree.

---

## WHAT I WOULD TELL THE DESK IN ONE PARAGRAPH

The instrument is good work and its author's self-disclaimers are unusually honest — every number in AR-647 §3 reproduced exactly, including the control digest to all 64 characters, and determinism and attribution held up under 28 control runs, concurrency, env/cwd variation and an order-reversed second pass that the original never had. **But `EFFECT-DIGEST` is a landing witness for 32 of 37 rows, not 37.** Four `recordEffect` sites record a value computed from `PROTO_INJECT` rather than observed from the guarded code, and for `module_collection_add` and `module_collection_delete` I recomputed the entire "effect ledger" from the source text without running anything. Swallow the plant at its consumer and the detector still prints **`LANDING PROVEN`** and exits **0** — on `emitted_module` with a digest **byte-identical** to the landed one, which means no digest pin anywhere can protect that row. The reason this was missed is structural and worth minting: the red-proof's three witnesses are knob *names with no implementation*, which tests "never requested" — a different failure mode from "requested then swallowed", and the only one the constraint of a read-only `run.mjs` permitted. **`37/37` is very likely factually true; it is not proven by this instrument, and `getter` and `neg_control` can never be anything but `LANDED`.** The smallest repair that would buy the most: move the `recordEffect` at `:121` and `:540` to wrap the consumer's *return value* instead of its argument, replace `:554`'s `+ (INJECT === 'getter' ? 1 : 0)` with a real getter invocation, and give `faultsFor()` a population term that bites.
