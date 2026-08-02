# GRADE — P0PC BATCH 5 (R-585 §6 item 1) — FIFTH INDEPENDENT ACCURACY-VALIDATOR GRADE

**Object:** `prototypes/p0-vnext-admission/` @ **`613a7c15`** (delivery `7c7b9ab0` + pin bump `613a7c15`)
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
**Git common dir:** `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` — LINKED WORKTREE, confirmed, not a standalone repo.
**Scope:** ITEM 1 ONLY. Item 2 (`ASSIGNEE: NONE`) NOT graded. `R-585 §2`'s falsifier NOT in scope — declared by the desk, not lapsed.
**Date:** 2026-08-02

---

## VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `p0-vnext-admission` item 1 (`MISS_NOT_CAUGHT` two-direction tripwire) | **6 / 10** | **VERIFIED** (independent; I did not design, build or previously grade this object) | 8 executed mutations + 2 independent AST re-derivations + 6-script re-run; every claim below carries its command | 1 CRITICAL, 1 HIGH, 3 MEDIUM — all listed |

**BASIS FOR BAND 6.** The item-1 property is REAL and I could not break it at its own seam: C1 survived the standing two-edit bar for the **first time in five grades** `[MEASURED HERE]`, both tripwire directions fire, the load-bearing (b) direction has a genuine discriminating path to red, and the red is attributable to exactly one class. That is above "happy-path only".

It is **not** band 7, because band 7 requires *residual risks documented*. On first contact I found a **live false-green path (F-1) in `module-collections.mjs` — the file this very batch edited** (its pinned population grew 13 → 14 this batch): three edits retire an entire covered file and its live enforcement table while **all three gates report green and `red-proof.mjs` stdout is byte-identical to the clean control**. An undocumented CRITICAL inside the delivery's own blast radius is not a documented residual.

**Prior band was 5 (R-585). This is a +1 move, within the plausibility rule, and it is earned by C1 — which four prior grades refuted and this one could not.**

---

## PER-CLAIM

| Claim | Verdict |
|---|---|
| **C1** — two-edit bar on the pinned excuse list | **CONFIRMED at the stated bar** · scope error in the desk's absolute phrasing (F-6) |
| **C2** — shrink-forcing second direction | **CONFIRMED** · direction (b) has a real path to red · residual F-4 (absence is *borrowed* coverage) |
| **C3** — red-proof isolation | **CONFIRMED** — strongest result in the batch |
| **C4** — `KNOWN_UNCAUGHT_COUNT` self-certifying magnitude | **CONFIRMED as a real declaration** · but REDUNDANT with the pin; worth exactly +1 edit |
| **C5** — completeness `24 → 25` | **CONFIRMED by independent recomputation** · caption defect F-3 |
| **C6** — six scripts green | **CONFIRMED** |
| **NOVEL — instance eleven** | **FOUND — F-1, CRITICAL** |
| **NOVEL — level five** | **FOUND — F-2, HIGH** |
| **NOVEL — `document-vs-program` (`run.mjs:312`)** | **NOT REFUTED** — fail-closed by crash `[MEASURED]`; see §NOVEL-3 |
| **NOVEL — `PINNED_BLOBS` placeholder** | **CARRIED RESIDUAL CONFIRMED STILL OPEN** (latent, not exploited) |

---

## NOOP CONTROL (run FIRST, per the campaign's rewriting-harness law)

`[MEASURED HERE]` Baseline sha256 of all 11 `.mjs` files captured before any edit; `git status --porcelain -- prototypes/` EMPTY; `git diff --stat 613a7c15 HEAD -- prototypes/` EMPTY (object untouched by later desk commits, verified rather than trusted).

**Every mutation below was reverted by `Edit`, never `git checkout`/`reset`/`stash`.** Final state `[MEASURED HERE]`:

```
25c2f272fa941a1b7657d4fcdb768f7da78f16aa8ab974400ba20f6c71774e32 *run.mjs
5044f4345a902de0abaca902c0b4f94be187ec2447dc6b76cb2c397373ee3ea0 *red-proof.mjs
6981c92a85cc1b331c114ee688ec400cb6973b8bb5db883368c2e254ef8a12e2 *module-collections.mjs
e377abc758897aa5dc3d49834634d81f803c58cfe648a8503ed37c75f7d78d27 *corpus.mjs
```
All match the pre-grade baseline byte-for-byte; `git status --porcelain -- prototypes/` EMPTY; `run.mjs` and `red-proof.mjs` stdout re-verified **byte-identical to the pristine baseline** after all restores.

⚠️ **INSTRUMENT FAILURE, DISCLOSED:** my first baseline loop wrote to `/tmp_out_*.txt` → `Permission denied` (the MSYS→`C:\` trap the brief warned of). A later comparison then reported four scripts as `*** DIFFERS ***` — that was **my missing baseline files, not the artifact**. Re-measured; the artifact is clean. Reported because a grader's harness is the first suspect for a surprising red.

---

## F-1 — CRITICAL — **INSTANCE ELEVEN: THE SET-OF-SETS PROTECTS ITS TABLE AXIS AND NOT ITS FILE AXIS**

**Severity:** CRITICAL (silent retirement of an enforcement surface; all gates green)

**Claim under test:** `module-collections.mjs` closed INSTANCE TEN by making every file *declare* how many enforcement tables it covers, "so a silent shrink must edit a number that states its own magnitude."

**Reality:** the law was applied to the **table** axis and never to the **file** axis. `[MEASURED HERE — executable line]`

```js
// module-collections.mjs:376
console.log(`MODULE COLLECTIONS — pin ${MODULE_PIN_COMMIT} | ${Object.keys(COVERED_FILES).length} files | ${DECLARED_TABLE_TOTAL} pinned tables (DECLARED) | ${findings.length} finding(s)`);
```

`DECLARED_TABLE_TOTAL = 14` is a declared literal cross-checked against `summedFromFiles`. **There is no `DECLARED_FILE_TOTAL`.** The printed file count is a `Object.keys()` over the consumption, asserted against nothing — verbatim *THE PIN FREEZES THE DECLARATION; THE COUNT READS THE CONSUMPTION*, in the file shipped to make that class visible.

**Repro — 3 edits, all inside `module-collections.mjs` (the file that structurally cannot pin itself):**
1. delete `'membership.mjs': Object.freeze({ tables: Object.freeze(['HISTORICAL_RENAMES']) }),` from `PINNED_MODULE_COLLECTIONS` (`:112`)
2. delete `'membership.mjs': 1,` from `COVERED_FILES` (`:153`)
3. `DECLARED_TABLE_TOTAL` `14` → `13` (`:158`)

**Measured result `[MEASURED HERE]`:**

```
$ node module-collections.mjs
MODULE COLLECTIONS — pin 7c7b9ab0 | 5 files | 13 pinned tables (DECLARED) | 0 finding(s)
VERDICT: PASS — every pinned enforcement table matches the pinned artifact.
EXIT: 0

$ node run.mjs
GATE: PASS — every enforced class is clean. Misses are honest and do NOT fail the gate.
EXIT: 0

$ node red-proof.mjs
CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 43 / 43
VERDICT: the runner is an ENFORCING GATE
EXIT: 0
>>> STDOUT BYTE-IDENTICAL TO THE PRISTINE BASELINE <<<
```

**The only residue in the entire system** was an incidental, ungated diagnostic counter in `run.mjs`: `SEPARABILITY: files actually opened during this run: 88` → `87` (one fewer `git show`). Nothing asserts 88. So even the accidental witness is itself instance-eleven-shaped.

**Blast radius (from the file's own comment, `:105-111`):** `HISTORICAL_RENAMES` is live — it maps the pinned baseline's ids at `membership.mjs:95`, `:98`, `:101`. With its pin retired, dropping its single entry silently un-maps `54` → `54(c)` and the expected-membership set quietly changes shape. That is the precise defect the pin was added to prevent, now reachable with the pin's own bookkeeping.

**Fix point:** `module-collections.mjs:376` + a `DECLARED_FILE_TOTAL` literal cross-checked against **all three** file-keyed collections — `COVERED_FILES`, `PINNED_MODULE_COLLECTIONS`, `PINNED_BLOBS` — since all three are self-certifying and none declares its own cardinality.

**Why this is level five and not a repeat:** the four prior remedies each moved the defect one level up (mutable array → cardinality → declaration-tautology → parent/child echo). This one moved it one **axis** over: within a single guard, one dimension was given the law and the orthogonal dimension was not.

---

## F-2 — HIGH — **`derivationsAgree` IS TAUTOLOGICAL OVER THE FOUR TABLES ITS CAPTION CLAIMS TO PROTECT**

**Severity:** HIGH (vacuous guard + false independence caption; the real protection comes from a different guard)

**Caption (`red-proof.mjs:350-351`):** *"Two INDEPENDENT derivations of the same magnitude must agree — if the key list and the arithmetic drift apart, the guard itself has rotted and says so rather than picking one."*

**Executable lines `[MEASURED HERE]`:**
```js
// :307-308
const STANDALONE_ROWS = 2;
const EXPECTED_ROW_COUNT = CLASSES.length + SHARED.length + EXPECT.length + FREEZE_EXPECT.length + STANDALONE_ROWS;
// :337-344
const DECLARED_ROW_KEYS = [ ...CLASSES.map(…), ...SHARED.map(…), ...EXPECT.map(…), ...FREEZE_EXPECT.map(…),
                            'freeze_control', 'over_correction_control' ];
// :352
const derivationsAgree = DECLARED_ROW_KEYS.length === EXPECTED_ROW_COUNT;
```
Both operands are the **same four `.length` terms**. The comparison algebraically reduces to `2 === STANDALONE_ROWS`. `[MEASURED: CLASSES 16, SHARED 2, EXPECT 21, FREEZE_EXPECT 2, STANDALONE 2 → 43, matching the printed 43.]`

**POSITIVE CONTROL (this is an absence claim, so it owes one) `[MEASURED HERE]`** — deleted one `EXPECT` row (`uncaught_stale`), ran `node red-proof.mjs`:

```
grep -c "derivations disagree"        -> 0
grep -c "STOP CONDITION (F-1b)"       -> 0
CONTROL GREEN: false | CLASSES WITH A DEMONSTRATED RED PATH: 5 / 42
```

The denominator tracked the deletion **43 → 42 in perfect silence** and the identity block never printed. The retirement was caught **only** by `checkPinnedCollections` (the pin on `EXPECT`) firing inside the children — a *different* guard. `derivationsAgree` contributes **zero** discriminating power over `CLASSES`/`SHARED`/`EXPECT`/`FREEZE_EXPECT`; its entire reach is the `STANDALONE_ROWS` literal and the two hand-written keys.

**This is the R-575 remedy relocated:** R-575 moved the denominator from *accumulator vs accumulator* to *declaration-sum vs declaration-sum* and captioned the result "independent". It is the same shape one level up.

**Fix point:** `red-proof.mjs:307` — `EXPECTED_ROW_COUNT` must be a **declared literal (43)**, not a sum over the tables it is meant to police; or the caption at `:350-351` must be corrected to say what the check actually does.

---

## F-3 — MEDIUM — **THE `COMPLETENESS (F-4)` LINE SAYS "DEMONSTRATED" WHERE THE CODE CHECKS "DECLARED"**

**Executable line `[MEASURED HERE]`** — `red-proof.mjs:390-402`. `uncoveredFailureClasses` filters on whether a class **name appears** in `CLASSES`/`SHARED`/`EXPECT`. It never consults `r.ok`. The printed sentence claims demonstration.

**Measured twice, both during genuinely RED runs:**
- under the direction-(b) retirement: `COMPLETENESS (F-4): all 25 … have a demonstrated red path — ASSERTED, not assumed.` printed alongside `42 / 43` and `VERDICT: NOT a gate. classes without a demonstrated red path: uncaught_stale->uncaught_gap`.
- under the `EXPECT`-row deletion: the same green sentence printed while **37** classes were listed as having no demonstrated red path.

`allOk` includes `rows.every(r => r.ok)`, so the **exit code and VERDICT are correct** — this is a caption defect, not a false green. But it is the F-4 property's own receipt reading GREEN inside a RED run. Campaign law: *a caption is a claim*; fix the emitter, not the table.

**Fix point:** `red-proof.mjs:402` — say "…are DECLARED with a red-path row", or gate the sentence on `rows.every(r => r.ok)`.

---

## F-4 — MEDIUM — **THE "MUST SHRINK" PROPERTY IS NOT SELF-CONTAINED; ITS ABSENCE DIRECTION IS BORROWED**

**Executable line `[MEASURED HERE]`** — `run.mjs:638`:
```js
const uncaughtStale = KNOWN_UNCAUGHT.filter((id) => results.some((r) => r.id === id) && !uncaughtNow.includes(id));
```
`KNOWN_UNCAUGHT` is the pinned DECLARATION; `results.some(...)` is the CONSUMPTION. **A declared gap id absent from `results` is exempt from BOTH directions**, with zero edits to the pinned table. Nothing in `run.mjs` asserts `KNOWN_UNCAUGHT ⊆ corpus ids`.

**The doer's stated defense HOLDS TODAY — verified, not assumed `[MEASURED HERE]`.** Deleted row `59(a)` from `corpus.mjs`:
```
GATE: FAIL (1 class(es))
  *** membership: MISSING from the pinned EXPANDED corpus (expected by 5edfc4b2): 59(a)
EXIT: 1
```
`uncaught_gap` stayed silent; `membership` caught it, exactly as `run.mjs:636-637` says it would.

**The residual:** that coverage is **borrowed** from `membership.mjs`'s expanded pin. A `KNOWN_UNCAUGHT` entry naming an id **outside** the pinned corpus — legal after any future pin bump — becomes a permanently silent, permanently un-shrinkable excuse: not stale (it never appears in `results`), not undeclared, and invisible to `membership`.

**Fix point:** `run.mjs:638` — add `KNOWN_UNCAUGHT.filter(id => !results.some(r => r.id === id))` as its own failure condition ("a declared known-open gap names a row that does not exist").

---

## F-5 — MEDIUM (CARRIED) — **`PINNED_BLOBS` PLACEHOLDER BYPASS STILL OPEN**

`[MEASURED HERE — executable line]` `module-collections.mjs:310`:
```js
if (PINNED_BLOBS[file] && !PINNED_BLOBS[file].startsWith('PLACEHOLDER') && blob !== PINNED_BLOBS[file]) {
```
One `'PLACEHOLDER_…'` value disarms pin-move detection with gate and consumer both green. **Confirmed still open.**

**Positive verification that it is latent, not exploited `[MEASURED HERE]`** — I re-derived all six blobs independently with `git rev-parse 7c7b9ab0:prototypes/p0-vnext-admission/<file>`; all six match `PINNED_BLOBS` exactly and none is a placeholder:
```
run.mjs 183bbdc8… · red-proof.mjs 7e0ebf83… · type-value-proof.mjs 468ac763…
source-admission.mjs a36d2c50… · runtime-admission.mjs 6e7a3f51… · membership.mjs 10ccce6e…
```
Also noted: `PINNED_BLOBS` has no reverse-direction check and no declared cardinality — an orphan entry is silent (harmless), a missing one throws (correct). Folded into F-1's fix.

---

## F-6 — LOW — **C1's DEFEAT COST, MEASURED (scope correction on `R-586 §1`)**

`R-586 §1` states, unqualified: *"the excuse-list itself can no longer grow silently."*

| Attack | Cost | Result `[MEASURED HERE]` |
|---|---|---|
| Grow `KNOWN_UNCAUGHT` + `KNOWN_UNCAUGHT_COUNT` together | **2 edits** | **BLOCKED.** `GATE: FAIL (1 class(es))` · `module_collections: run.mjs: KNOWN_UNCAUGHT UNDECLARED row(s) — legitimate growth must bump the pin: 58` · EXIT 1, both clean and injected. Fires FIRST, via `process.exit(1)` at `run.mjs:68`, so nothing downstream can downgrade it. |
| Same, after retiring the pin's coverage from inside `module-collections.mjs` | **5 edits, 2 files** | **SUCCEEDS.** `PROTO_INJECT=uncaught_undeclared node run.mjs` → `GATE: PASS`, **EXIT 0** — the injection that reddens the shipped gate now certifies it. |

**Verdict: the claim is TRUE at the campaign's standing two-edit bar and OVERSTATED as an absolute.** Recommended re-scoping: *"cannot grow within the standing two-edit bar; the cheapest measured defeat is five edits, three of them inside the structurally unpinnable `module-collections.mjs`."*

A note the desk should keep: in the 5-edit attack the **clean** control still went red — `uncaught_gap: declared known-open gap(s) are NOW CAUGHT: 58` — because row `58` is genuinely caught in the pristine corpus. **You cannot pad the excuse list with a row that is actually being caught; direction (b) reddens instantly.** That is C2's design working harder than claimed, and it is the strongest single property in this delivery.

---

## C2 / C3 / C4 / C5 / C6 — SUPPORTING MEASUREMENTS

**C3 — ISOLATION. CONFIRMED, and it is the cleanest result in the batch `[MEASURED HERE]`:**
```
$ PROTO_INJECT=uncaught_undeclared node run.mjs   → EXIT 1
GATE: FAIL (1 class(es))
  *** uncaught_gap: row(s) caught NOTHING and are NOT declared as a known-open gap: 58

$ PROTO_INJECT=uncaught_stale node run.mjs        → EXIT 1
GATE: FAIL (1 class(es))
  *** uncaught_gap: declared known-open gap(s) are NOW CAUGHT: 59(a) — the declaration is STALE and must shrink
```
**Exactly one class, and it is the class under test, in both arms.** No neighbouring class contributed. `A RED THAT ARRIVES VIA A NEIGHBOURING CLASS PROVES NOTHING ABOUT THIS ONE` — satisfied by execution, not by argument.

**C2 — DIRECTION (b) HAS A REAL PATH TO RED `[MEASURED HERE]`.** One-expression edit at `run.mjs:638` (`false &&` prepended to the predicate — deliberately *not* `[]`, which would have created a module-level array literal and tripped the pin for the wrong reason):
- `node run.mjs` → **stdout BYTE-IDENTICAL to pristine**, EXIT 0. The shipped gate cannot see its own retired half.
- `PROTO_INJECT=uncaught_stale node run.mjs` → `GATE: PASS`, **EXIT 0** (was FAIL/1).
- `node red-proof.mjs` → **`*** FAIL uncaught_stale exit=0 … names 'uncaught_gap'=false`** · `42 / 43` · `VERDICT: NOT a gate` · EXIT 1.

**So direction (b) is guarded — by the sibling gate, not by `run.mjs` itself.** Stated precisely because the distinction is load-bearing: anyone running only `node run.mjs` would see nothing.

**C4 `[MEASURED HERE]`.** `KNOWN_UNCAUGHT_COUNT` is a numeric literal, so `extractModuleCollections` does not see it — **it is NOT pinned**; only the list is. Its throw is real:
```
$ node run.mjs   # list=3, COUNT=4
Error: INSTRUMENT FAULT: KNOWN_UNCAUGHT declares 4 known-open gap(s) but lists 3 — the declaration and its stated magnitude disagree
EXIT: 1
```
It is the **correct shape** (declaration vs consumption), so it is *not* instance eleven. But it is **redundant with the pin**: the pin already sees every content change to the list (added/removed/duplicated keys, and `keys: null` if an element stops being a string literal). Its marginal value is exactly **+1 edit** on the attacker's cost, and it is the last line only once the pin has been retired.

**C5 — INDEPENDENT RECOMPUTATION `[MEASURED HERE]`.** My own AST walk (deliberately **not** importing `module-collections.mjs` — a grade that reproduces its instrument is not a second path):
```
FAILURE_CLASSES @613a7c15 : 25
FAILURE_CLASSES @5a5838bc : 24
ADDED   : uncaught_gap
REMOVED : <none>
UNCHANGED (join key = class name): 24
COVERAGE (independent): 25 / 25 covered      UNCOVERED: <none>
EXPECT rows naming uncaught_gap: uncaught_undeclared, uncaught_stale
```
**The count moved for exactly the right reason**: one class added, zero removed, 24 unchanged *by name*, and the two new `EXPECT` rows are the two new injections. Caveat = F-3 (the word "demonstrated").

Also independently confirmed here: `DECLARED_ROW_KEYS` extracts to `[null,null,null,null,null,null]` → `keys: null` → genuinely unpinnable, corroborating `R-586 §1`'s mechanism claim.

**C6 `[MEASURED HERE]`, post-restore:** all six EXIT 0 — `run.mjs` `GATE: PASS` · `red-proof.mjs` `CONTROL GREEN: true | 43 / 43` `ENFORCING GATE` · `module-collections.mjs` `6 files | 14 pinned tables (DECLARED) | 0 finding(s)` `VERDICT: PASS` · `type-value-proof.mjs` `15 / 15` · `module-tuple.mjs` · `emitted-freeze.mjs` `both must be true` controls both true.

---

## NOVEL-3 — `run.mjs:312` AS A `document-vs-program` EXHIBIT — **NOT REFUTED**

The law is stated in prose at `:312` — *"AN INJECTION THAT DID NOT LAND PRODUCES A GREEN INDISTINGUISHABLE FROM A GUARD THAT DID NOT FIRE"* — and enforced by `PLANT_WITNESS` for **exactly one** injection family (`34(d-u)`, pushes at `:323` and `:338`) out of 13 `switch` cases and 25 `INJECT ===` sites. The two injections added today have **no landing witness**.

**I tested whether that is exploitable `[MEASURED HERE]`.** Made the injection non-landing (`CORPUS.find(x => x.id === '59(a)')` → `'59(zz)'`, so the spread receives `undefined`):
```
$ PROTO_INJECT=uncaught_undeclared node run.mjs
TypeError: c.factory is not a function   at run.mjs:347:30
EXIT: 1
```
**Fail-closed and loud.** And the clean control under the same mutation stayed byte-identical/EXIT 0, so the defect is invisible until the injection is exercised — i.e. by `red-proof.mjs`, whose `names '<class>'=true` assertion is the de-facto landing witness.

**Verdict: no defect found here — the property is discharged by crash rather than by design.** Recorded as a residual, not a finding: the discharge is incidental (a malformed row happens to throw), so an injection that lands *partially* — right shape, wrong effect — would still be silent in `run.mjs` and would rest entirely on red-proof's class-name assertion. That assertion **cannot distinguish direction (a) from direction (b)**, since both print under the single class name `uncaught_gap`. This is the honest null the brief asked for, with its boundary named.

**Coupling worth recording:** the `uncaught_undeclared` red path is only red *because* `59(a)` is still uncaught. When `F-3` closes, **both** new red-proof rows break — one for the right reason (the shrink is forced) and one for a coupling reason. Expected and arguably desirable; noted so it is not later mistaken for a regression.

---

## DESK AUDIT — `R-586`

| Figure / claim | Join key I checked | Verdict |
|---|---|---|
| "Commits `7c7b9ab0` (delivery) + `613a7c15` (pin bump + decline), both verified present" | `git log --oneline`, both resolve | **CONFIRMED** |
| "NEWEST AR NAMED: `AR-628` — newest `## AR-` on disk" | `grep -o "^## AR-[0-9]*" \| sort -n \| tail` → `AR-626, AR-627, AR-628` | **CONFIRMED** |
| "GRAPH OBJECT: ADOPTED — on-disk blob `4b806d35…`, RE-DERIVED `[MEASURED HERE]`" | `git cat-file -t 4b806d35…` → `blob` | **EXISTS — but see below** |
| §1: "`KNOWN_UNCAUGHT` states its own magnitude and throws on disagreement" | induced the disagreement | **CONFIRMED** |
| §1: "unlike `DECLARED_ROW_KEYS` (`keys: null`, unpinnable)" | independent AST extraction → 6 nulls | **CONFIRMED** |
| §1: "the excuse-list itself can no longer grow silently" | 2-edit and 5-edit attacks | **SCOPE ERROR — see F-6** |
| §1: "row `58` … is OUTSIDE the pinned 52 (so the partition checks stay silent)" | both injections fired exactly 1 class | **CORROBORATED** (not independently enumerated — see below) |
| §1: `[MEASURED BY DOER — NOT reproduced here]` on the two red-proofs, `43/43`, `all 25` | all three now independently reproduced by me | **CORRECT LABELLING — no defect.** Good discipline; the desk did not launder a relayed figure as its own. |
| §6.1 "DISPATCHED NOW" | the desk's own correction at the ruling head | **ALREADY SELF-CORRECTED, accurately** |

**Answering the desk's direct question — "assume there are others" (claims asserting a completed act that had not happened):**

**I found no second instance in `R-586`.** That is an honest null, and here is its coverage: I checked every `[MEASURED HERE]`-tagged figure in the ruling head and §1–§6 against an independent command (blob existence, newest-AR ordering, both commit hashes, the `keys: null` mechanism, the throw, the isolation reasoning). The `§6.1` gap you already caught was the only past-tense-before-the-act I could find. The forward-looking `receipt path docs/designs/GRADE-P0PC-BATCH5-2026-08-02.md` is correctly phrased as a destination — `[MEASURED HERE]` the file did not exist when I began and I created it.

**One join key you did not check, and it is the graph-object blob.** `git cat-file -t 4b806d35…` returns `blob`, so the hash is **not fabricated** — but the ruling never names **which path** that blob is the content of. A bare blob hash with no path is unfalsifiable as written: it proves an object exists in the store, not that the graph object is what you re-derived. Given `ops_external_reader_fabricates_sha_tails` is already campaign law, the fix is one token: name the path beside the hash so the next reader can re-derive it. This is the *shape* of your two known errors (certifying via the neighbouring observation), not a repeat of them.

**Second, smaller one:** §1's ratification of the isolation reasoning is sound and I confirmed its *conclusion* by execution, but the desk ratified it as "sound on its face" without enumerating the pinned-52 membership. I also did not enumerate it — my confirmation is that exactly one class fired, which is consistent with row `58` being outside the 52 but does not independently establish it. Logged under "did not verify" rather than claimed.

---

## MANDATORY CLOSING COVERAGE SECTION

### 1. What I verified, and via which two-plus NON-OVERLAPPING paths

| Claim | Path A | Path B (non-overlapping) |
|---|---|---|
| C1 two-edit bar | executed the 2-edit growth → pin fires, EXIT 1 | executed the 5-edit retirement → succeeds, quantifying the true cost from the other side |
| C2 direction (b) fires | executed `PROTO_INJECT=uncaught_stale` → 1 class red | executed the *retirement* of direction (b) → `red-proof` flips 43/43 → 42/43 (path to red, not just presence) |
| C2 absence sub-case | read the executable line `run.mjs:638` (`results.some` guard) | executed the corpus deletion → `membership` fires, `uncaught_gap` silent |
| C3 isolation | `GATE: FAIL (1 class(es))` in both arms | class-name text in the message matches `uncaught_gap` in both arms |
| C4 magnitude | read `extractModuleCollections` — numeric literals are not extracted, so COUNT is unpinned | executed the drift → `INSTRUMENT FAULT` throw, EXIT 1 |
| C5 `24 → 25` | my own AST extractor over `run.mjs` @ `613a7c15` vs @ `5a5838bc` | `red-proof.mjs`'s own printed `all 25` (a different implementation, in a different file) |
| C5 coverage 25/25 | my own set arithmetic over `CLASSES`/`SHARED`/`EXPECT` | `red-proof`'s internal `uncoveredFailureClasses` |
| C6 | exit codes of all six | stdout byte-comparison of `run.mjs` + `red-proof.mjs` against pristine baselines |
| F-1 | `module-collections.mjs` standalone `VERDICT: PASS`, 0 findings | `run.mjs` EXIT 0 **and** `red-proof.mjs` stdout byte-identical — three independent gates, all silent |
| F-2 | algebra over the two executable lines `:308` / `:337-344` | executed positive control — `EXPECT` row deleted, `derivations disagree` count = 0 |
| F-5 | read the `startsWith('PLACEHOLDER')` bypass | re-derived all six blobs with `git rev-parse` — none is a placeholder |

### 2. Positive-control witnesses for every absence claim I make

| Absence claimed | Positive control |
|---|---|
| "`derivationsAgree` cannot see a table change" (F-2) | Deleted an `EXPECT` row and ran the gate: `grep -c "derivations disagree"` → **0**, `grep -c "STOP CONDITION (F-1b)"` → **0**, while the denominator moved 43 → 42. The guard was given the exact condition it claims to detect and stayed silent. |
| "no gate catches the dropped covered file" (F-1) | Ran **all three** gates under the mutation and captured full stdout: `module-collections` `0 finding(s)`/EXIT 0, `run.mjs` EXIT 0, `red-proof.mjs` byte-identical/EXIT 0. Not a grep — three executions. |
| "`uncaught_gap` is blind to an absent declared row" (F-4) | Deleted `59(a)`: the gate DID redden — but the firing class was `membership`, and `uncaught_gap` printed nothing. The witness shows *which* guard spoke, not merely that one did. |
| "no second false-completed-act claim in R-586" | Re-derived each `[MEASURED HERE]` figure with an independent command (blob type, AR ordering, both commits, `keys: null`, the throw). Named the two join keys that remain unchecked rather than reporting a clean sweep. |
| "a non-landing injection is not silent" (NOVEL-3) | Forced `find` → `undefined` and executed: `TypeError`, EXIT 1. The failure mode was induced, not assumed absent. |
| "the pin has no placeholder disarming it" (F-5) | `git rev-parse` on all six pinned paths; all six match and none begins `PLACEHOLDER`. |

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **"object untouched since `613a7c15`"** → `git diff --stat 613a7c15 HEAD -- prototypes/` (empty) **and** `git status --porcelain -- prototypes/` (empty). Two directions: committed drift and working-tree drift.
- **"restored byte-identical"** → sha256 per file against the pre-grade baseline, after **every** mutation, plus `git status --porcelain` empty at the end.
- **"stdout byte-identical"** → full-file `diff` against the pristine capture, not a tail or a grep.
- **"24 unchanged"** (C5) → join key = **class name string**, matched pairwise between `613a7c15` and `5a5838bc`; `ADDED` and `REMOVED` reported separately so a substitution could not hide inside a stable count.
- **"blobs match the pin"** (F-5) → join key = `<commit>:<repo-relative path>` → blob sha, re-derived for all six.
- **`43 = 16 + 2 + 21 + 2 + 2`** → each term measured by my own AST walk, not read from the program's own printout.

### 4. WHAT I DID **NOT** VERIFY

1. **Item 2 in any form.** Out of scope by the brief; `ASSIGNEE: NONE`. `R-585 §2`'s falsifier not exercised — declared, not lapsed.
2. **The membership of the pinned 52.** I never enumerated it. My confirmation that rows `58` and `59(a)` sit outside it is *inferential* — exactly one class fired in each injection arm, which is consistent with it. `[CORROBORATED, NOT ENUMERATED]` This is the same gap I flagged in the desk's §1.
3. **A rename of a `KNOWN_UNCAUGHT` row.** C2 asks about absent / renamed / reclassified. I executed **absent** (corpus deletion) and **reclassified** (the `uncaught_stale` injection *is* a reclassification). I did **not** execute a rename of `59(a)`; I am relying on the code path plus the pre-existing `membership_rename` red-proof. `[UNENUMERATED]`
4. **F-4's forward scenario.** I did not construct a `KNOWN_UNCAUGHT` entry naming an id outside the pinned corpus *after a legitimate pin bump*, because that requires a commit and the brief forbids committing in this shared tree. The hole is established by reading `run.mjs:638` and by the measured silence of `uncaught_gap` under deletion; the post-bump exploit is `[HYPOTHESIS-UNPROVEN]`.
5. **`F-4` (completeness) in isolation.** Every isolated test of it trips the pin on `FAILURE_CLASSES`/`EXPECT` first, so I could not obtain a red attributable to F-4 alone. I verified its *inputs* independently (my own 25/25 recomputation) and its *mechanism* by reading `:390`; the doer's account that adding the class reddened red-proof until the `EXPECT` rows existed is `[RELAYED]`.
6. **The other four scripts' stdout against a pristine baseline.** `module-collections`, `module-tuple`, `emitted-freeze`, `type-value-proof` — their baselines were lost to my own `/tmp` instrument failure. I verified exit codes and headline assertions for all four, but not byte-identity. `run.mjs` and `red-proof.mjs` — the two that matter for every claim here — *were* byte-compared.
7. **Whether F-1's 3-edit path would survive code review.** It is silent to all three *gates*; I make no claim about a human reader noticing `14 → 13`. The finding is about what the instruments certify, not about the desk's attention.
8. **Anything outside `prototypes/p0-vnext-admission/`.** No runtime, trading, capital, broker or `runtime-production` surface was read or touched. No commit, checkout, reset, stash or amend was performed at any point.

---

## RECOMMENDED ORDER OF REPAIR

1. **F-1 (CRITICAL)** — `DECLARED_FILE_TOTAL`, cross-checked against `COVERED_FILES`, `PINNED_MODULE_COLLECTIONS` **and** `PINNED_BLOBS`. This closes the axis, not the instance.
2. **F-2 (HIGH)** — make `EXPECTED_ROW_COUNT` a declared literal, or correct the "INDEPENDENT" caption. A guard that cannot fail is not a guard.
3. **F-3, F-4 (MEDIUM)** — one-line emitter fix; one added failure condition.
4. **F-5 (MEDIUM, carried)** — fold the placeholder bypass into F-1's fix.
5. **F-6 (LOW)** — re-scope `R-586 §1`'s sentence to the two-edit bar.

**⚠️ The pattern across F-1 and F-2 is one sentence:** *when a remedy is applied, sweep every OTHER dimension of the same guard in the same wave* — the table axis got the law and the file axis did not; the accumulator got the law and the declaration-sum did not. Both are `mint-a-law-then-sweep-it-backward` left half-done.
