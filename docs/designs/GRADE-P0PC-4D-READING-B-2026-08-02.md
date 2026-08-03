# GRADE — `P0PC` acceptance clause `4d` under reading `(B)` (PATH B, independent)

**Grader:** `accuracy-validator`, dispatched under `R-597 §4` / re-fired `R-599`, briefed to **REFUTE**.
**Object pinned:** `prototypes/p0-vnext-admission/` at **`ee31fe4446333a1cb8f36c5a56eb2adee1d91aa0`**.
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`).
**Date:** 2026-08-02.

---

## VERDICT

> **CLAIM UNDER GRADE:** "`P0PC` acceptance clause `4d` is MET at commit `ee31fe44` under reading `(B)` — every terminal acceptance failure prints its own finding before exiting non-zero, and the restored control exits zero."

### `REFUTED` · BAND **5/10** · `VERIFIED`

**Refuted on the boundary, not on the arithmetic — and the refutation is the desk's own pre-registered test, honoured on the inconvenient answer.**

Split precisely, because the two halves of the claim do not share a fate:

| Half of the claim | Verdict | Basis |
|---|---|---|
| "the restored control exits zero" | **HOLDS** | `MEASURED HERE` — `exit=0`, `225` lines, `0` stderr bytes, reproduced 7× including pre- and post-restore |
| "every terminal acceptance failure prints its own finding before exiting non-zero" | **REFUTED** | `MEASURED HERE` — three independent routes produce `exit≠0` with `OWN_FINDING=false`; the class containing them is excluded only by a proposition I measured **FALSE** |

**The property reading `(B)` names is real on the injection population — and I widened that population by 48% and it still held (37/37, not 25/25).** The claim fails not because the desk mis-measured what it measured, but because the counterexample class was ruled out of scope by `R-596 §1`'s assertion *"No object-under-test mutation reaches an `INSTRUMENT FAULT` site"* — and `R-594 §3` had pre-registered the exact test for that. **The test is now satisfied on three routes, one of them a single-byte mutation of a fixture body.** By its own written terms those sites are *"an acceptance failure wearing an instrument-fault caption, and it is IN scope"* — and in scope they are counterexamples.

⚠️ **The one honest escape, named so the desk cannot be ambushed by it:** `R-594 §3`'s *category rationale* ("an `INSTRUMENT FAULT` is a statement that the measuring apparatus is broken") can still be argued to cover all three of my routes. **The pre-registered falsifier and the category rationale now DISAGREE.** That is itself the finding: `R-594 §3` wrote *"A CATEGORY BOUNDARY DEFENDED ONLY BY THE CAPTION ON EACH SIDE IS NOT A BOUNDARY."* The boundary is now defended by exactly that. The desk may re-rule the category explicitly — but it may **no longer** rest on `§1`'s measurement, which tested a different proposition than the falsifier posed.

### Why band 5 and not higher
Rubric: `5–6` = happy-path only. The instrument itself is good work — reading-neutral **by measurement** (verified two ways), with a genuine demonstrated red witness, reproducing exactly. But every knob it scored was a knob the desk's own regex chose, **and the counterexample lives in the population it did not enumerate.** Of the three arguments `R-596 §3` offered for reading `(B)`, one is refuted by measurement, one is a non-sequitur, and one cuts both ways; `R-596 §2`'s join is false; `R-596 §1`'s mechanism claim is false. A band ≥7 requires adversarial testing with residual risks *documented* — here the principal residual risk was *excluded on a refuted premise*, which is not the same thing.

---

## PROVENANCE OF EVERY MEASUREMENT (read this before the findings)

### The pinned object never drifted, but HEAD moved twice
`MEASURED HERE`. `HEAD` was `47d7127a` at my start and `48ea8b68` at my end. `git diff --stat ee31fe44 HEAD -- prototypes/` was **empty at both readings** — the graded object is stable across the move. Join key for "unchanged" is the **blob**, not the commit.

### 🛑 A CONCURRENT WRITER CORRUPTED MY FIRST MEASUREMENT — disclosed because it nearly became a finding
My **first** run of `evidence-order.mjs` in the campaign tree returned `CONTROL exit=1`, refusing to measure. `run.mjs` direct gave:

```
Error: INSTRUMENT FAULT: row 34(d-u) declares owned expression "undeclaredReader(lane)" with NO `witness`
    at ownershipJoin (run.mjs:201:13)
```

This was **false as a fact about the pinned object**: `MEASURED HERE`, `corpus.mjs:97` declares `witness: 'undeclaredReader'`, no corpus row lacks a string witness, and every file was byte-identical to `ee31fe44`. Two re-runs then exited `0`. The discriminator was **mtime**: my session-baseline listing recorded `corpus.mjs` at `Aug 2 17:46`; mid-grade it read **`2026-08-02 20:43:33`** with **content sha unchanged** — a mutate-and-revert cycle by another process, with `git status` clean at both ends.

★ **Later confirmed by digest join.** My own deliberate falsifier (below) reproduced `EFFECT-DIGEST: ade9a2a1cdfa951017360c33de60d5114ebcebff1e0fbeecb11fe3d791ea9d1c` — **byte-identical** to the digest emitted by the accidental campaign-tree failure. The peer grader had planted the same `witness` deletion. `A SURPRISING RESULT ACCUSES THE INSTRUMENT FIRST` — and here the "instrument" was the shared tree itself.

**Consequence:** every number below was taken in an isolated proxy, never in the campaign tree.

### The proxy is a verified faithful copy of the PIN, not of the working tree
I materialised all 19 files with `git cat-file blob ee31fe44:<path>` — the object DB, which applies **no smudge filters** and which no concurrent agent can move. This is strictly stronger than a copy-vs-working-tree check, which would have passed even on a mutated file. `core.autocrlf=false`; `.gitattributes` declares `*.mjs text eol=lf`.

| file | `ee31fe44` (sha256 head) | proxy | campaign tree |
|---|---|---|---|
| `RESULTS-2026-08-02.md` | `dc27e4643b53c957` | ✅ same | ✅ same |
| `corpus.mjs` | `e377abc758897aa5` | ✅ same | ✅ same |
| `emitted-freeze.mjs` | `a4da4708a7a5fba7` | ✅ same | ✅ same |
| `evidence-order.mjs` | `4fb19d67ef0e45ea` | ✅ same | ✅ same |
| `fs-tracker.mjs` | `03ef8f0f4dde43b2` | ✅ same | ✅ same |
| `membership.mjs` | `be3639b42baa7ba0` | ✅ same | ✅ same |
| `module-collections.mjs` | `cbb2cccfc164e3b8` | ✅ same | ✅ same |
| `module-tuple.mjs` | `63bbde8f75ac5fe5` | ✅ same | ✅ same |
| `red-proof.mjs` | `942b347357cc27cd` | ✅ same | ✅ same |
| `run.mjs` | `a85c3f0d3541cd46` | ✅ same | ✅ same |
| `runtime-admission.mjs` | `afa38b8d89e4bb82` | ✅ same | ✅ same |
| `source-admission.mjs` | `ae8ae16abc23745b` | ✅ same | ✅ same |
| `surface/ambient.d.ts` | `00140b2ee7dd7d1b` | ✅ same | ✅ same |
| `surface/helper.ts` | `27f16c1b2952371f` | ✅ same | ✅ same |
| `surface/ledger.ts` | `c5299befce35142b` | ✅ same | ✅ same |
| `surface/package.json` | `8d5cf54ed160f49e` | ✅ same | ✅ same |
| `surface/pure-math.ts` | `72c55be9ae1afeea` | ✅ same | ✅ same |
| `surface/tsconfig.pinned.json` | `21a54038ff861d43` | ✅ same | ✅ same |
| `type-value-proof.mjs` | `0caab6bda2d9409c` | ✅ same | ✅ same |

**File count, three independent sides:** `git ls-tree -r --name-only ee31fe44` = **19** · proxy `find -type f` = **19** · campaign tree = **19**. An added or omitted file cannot hide. Verified **twice** — once before measuring, once post-hoc after the peer finished.

### The proxy reproduces the reported result exactly
`MEASURED HERE`. `node run.mjs` ×3 → `exit=0 lines=225 stderr=0` each time. `node evidence-order.mjs` → **the reported table byte-for-byte**: `CONTROL exit=0 lines=225 stderr_bytes=0`, `4d-i 25/25`, `col(i) 25/25`, `col(ii) 23/25`, `0` UNKNOWN, the two named divergent rows, `RED WITNESS exit=1 lines=0 0/0`. TypeScript `5.9.3` on both sides; `GIT_DIR` exported so `loadPinnedText`'s `git show` pins resolve from outside the repo.

★ **Control of my own harness:** the proxy control still printed exactly `225` lines *after* I added my helper scripts to the directory — so my instrumentation did not perturb the object.

---

## TARGET 1 — `R-596 §3`'s three arguments for reading `(B)`

**Finding: argument 1 is REFUTED BY MEASUREMENT. Argument 2 is a non-sequitur. Argument 3 cuts against the desk at least as hard as for it. None survives as a reason to prefer `(B)`.**

### Argument 1 — "untrusted output" — `REFUTED`, `MEASURED HERE`
> *"`(A)` would make the instrument print `220` lines of UNTRUSTWORTHY output. When `collection_shape` fires, the pinned set-of-sets is compromised … Emitting them is manufacturing confidence, not collecting evidence."*

The argument names `collection_shape`. **`MEASURED HERE`: when `collection_shape` fires, the system prints `226` lines — the FULL evidence body — and its finding at line 224.**

```
$ PROTO_INJECT=new_unpinned_collection node run.mjs   # exit=1, 226 lines
224:  *** collection_shape: NEW UNPINNED exported collection(s) — pin it or declare it
      EXEMPT in code (R-562): ROGUE_SELF_CERTIFYING_SET
```

The argument therefore condemns behaviour **the system already exhibits for the very class it names**. It does not distinguish `(A)` from `(B)`; it describes `run.mjs` at `ee31fe44` doing the thing the argument calls "manufacturing confidence". The class that truncates is **not** `collection_shape` — see Target 3.

### Argument 2 — `run.mjs:117` downgrade-immunity — `NON-SEQUITUR`
> *"`run.mjs:117` — 'then exits immediately — nothing downstream can downgrade it' — is a DELIBERATE, MEASURED property … `(A)` would re-open the downgrade path the design closed."*

The cited measurement (`AR-607 §1`) is about **where the check is REGISTERED** — deleting the `collection_shape` entry from `FAILURE_CLASSES` let the injection report `GATE: PASS`. `ARTIFACT-SOURCED`, and I accept it as true. But it bears on **registration**, not on **print order**. `(A)` asks that evidence be *collected before* exit; it does not ask that downstream logic be allowed to *re-decide* the verdict. **Printing is not downgrading.** `MEASURED HERE`: `process.exit()` occurs exactly **once** in `run.mjs`, at `:138`; `FAILURE_CLASSES` is not even constructed until `:746` and `process.exitCode` is set at `:840`. A body-then-exit ordering would still terminate at an unconditional `process.exit(1)` and nothing in `failures` (`:830`) can see the early gate's findings. The feared downgrade path is asserted, not shown — `HYPOTHESIS`. Two true facts do not make a true link.

### Argument 3 — the `:96-100` exit-hook precedent — `DOUBLE-EDGED`
> *"`:96-100` moved the `EFFECT-DIGEST` into a `process.on('exit')` hook … The design's own notion of 'evidence that must survive' is the evidence bearing on THIS failure."*

`MEASURED HERE`: the hook preserves the `EFFECT-DIGEST` — and it is the **only** stdout line surviving a `:201` throw (`"EFFECT-DIGEST: ade9a2a1…\n"`). But what it preserves is an **injection-provenance fingerprint for pairwise-distinctness**, not the failing class's finding. The precedent establishes that the design took deliberate trouble to make a specific piece of evidence **survive an early exit** — which is `(A)`-flavoured reasoning (*collect the evidence even when exiting early*), not `(B)`-flavoured. Read plainly, argument 3 supports `(A)` at least as well as `(B)`.

### The structural point the desk itself flagged
`R-596 §3` closes: *"EVERY ONE OF THOSE THREE ARGUMENTS FAVOURS THE CONCLUSION THAT UNBLOCKS ME."* `ARTIFACT-SOURCED`. That self-warning was correct and it was not enough: **all three arguments are also independently weak**, and none was checked against the executable lines before being written down. Argument 1 in particular is refuted by a single command.

---

## TARGET 2 — is `OWN_FINDING` (`/^\s*\*\*\* /m`) too weak for `25/25` to mean anything?

**Finding: the predicate is a genuine PROXY and is weaker than its name, but `25/25` (and `37/37`) is NOT an artifact of it. I could not construct a vacuous pass. Honest partial.**

Three measurements, each with its control:

1. **It discriminates on the control.** `MEASURED HERE`: the clean control's `225` lines contain **no** line matching `/^\s*\*\*\* /m`. A predicate satisfied by a passing run would be worthless; this one is not.
2. **Every `YES` on the population is backed by a real explanatory line.** `MEASURED HERE`, including the two rows that carry reading `(B)`'s whole weight:
   ```
   *** module_collections: run.mjs: NEW UNPINNED module-level collection
       'ROGUE_UNPINNED_TABLE' — pin it or bump 3978c1c5 (R-568 item 5)
   ```
   That names the class, the file, the object and the remedy. Reading `(B)`'s `YES` on those rows is substantively earned, not scraped off a banner.
3. **But the predicate does not literally measure "its own finding."** `MEASURED HERE` — I enumerated every `*** `-at-line-start emitter in the harness. There are **three**, and only one is a `FAILURE_CLASSES` finding:
   - `run.mjs:835` `  *** ${name}: ${msg()}` — the class's own finding ✅
   - `run.mjs:136` `  *** module_collections: ${f}` — the **extra-tabular** early gate (not one of the 25)
   - `run.mjs:691` `  *** FAIL *** ${t.pair} | …` — a **twin REPORT line**, naming no class

   For the `twin` knob the predicate is satisfied at **line 107** by that report line — **117 lines before** the class's own finding at line 224. So `OWN_FINDING` measures *"some `*** `-prefixed line exists"*, which on this system is **implied by** but **not identical to** *"the failing class printed its own finding."*

**Attempted vacuity construction — FAILED, and the failure is informative.** For `run.mjs:691` to fire without the `twin` class, the two would need independent predicates; `MEASURED HERE` they share one (`!t.ok` at `:691` vs `twinChecks.some(t => !t.ok)` at `:761`), so they cannot be separated. And `process.exitCode = failures.length ? 1 : 0` (`:840`) means a non-zero exit *requires* a finding, except via the early gate (which prints its own) or an uncaught throw (Target 4). **So on this system: `exit ≠ 0` ⟹ (a finding printed) ∨ (an uncaught throw).** No vacuous pass exists.

⚖️ **Verdict on Target 2:** the `25/25` is not a predicate artifact. But it is `MEASURED BY A PROXY` two emitters wider than the property it is captioned as measuring, and any future change that lets `:691` or `:136` fire independently would silently make it vacuous. `A CAPTION IS A CLAIM` — the column is captioned "own finding printed"; what it tests is "a starred line exists".

---

## TARGET 3 — are the 2 divergent rows terminal acceptance failures at all? (`:108` vs `:746`)

**Finding: the caption tension resolves cleanly — two different objects share one name. But resolving it REFUTES `R-596 §2`'s join, which the desk explicitly claimed to have re-derived rather than accepted.**

### The `:108`/`:746` tension is a name collision, not a contradiction
`MEASURED HERE`, from the executable lines:
- `run.mjs:121–139` — the **early gate**: `checkPinnedCollections(...)` over the six-file `PINNED_MODULE_COLLECTIONS` set-of-sets (the *enforcement tables*). Prints `*** module_collections: …`, then `process.exit(1)` at `:138`. `run.mjs:108`'s caption is **accurate**: this check is not a `FAILURE_CLASSES` entry.
- `run.mjs:824` — the **declared class** `collection_shape`, whose predicate is `aux.collection_missing.length > 0 || aux.collection_undeclared.length > 0`, i.e. `checkAuxiliaryCollections` over **`corpus.mjs`'s exported collections**. A different check on a different population that happens to reuse the word "collection".

Both of `R-596 §2`'s readings of the comment are indeed defensible, as the desk said. **I did not touch it** (`R-596 §6` forbids it).

### 🛑 But `R-596 §2`'s join is FALSE — `MEASURED HERE`, three non-overlapping paths
> `R-596 §2`: *"`[MEASURED HERE]` `module_collection_add`/`_delete` are **INJECTION KNOBS, NOT CLASSES** — the declared class they fire is **`collection_shape`, AND IT IS ONE OF THE `25`.** So the truncating failure is inside the acceptance population by **BOTH** denominators."*

| path | evidence | result |
|---|---|---|
| **A — observed effect** | parse `^\s*\*\*\* (\w+):` out of each run's stdout | the two knobs drive **`module_collections`**; `collection_shape` is driven **only** by `new_unpinned_collection` |
| **B — static reachability** | `process.exit()` occurs **once**, at `:138`; `FAILURE_CLASSES` is declared at `:746` | a run exiting at `:138` **never constructs the table**, so `collection_shape` cannot have been evaluated |
| **C — message-text join** | early gate emits `*** module_collections: …` (`:136`); `collection_shape` emits `"NEW UNPINNED exported collection(s) — pin it or declare it EXEMPT in code (R-562)"` (`:827`) | the observed 5-line output carries the **former** |

**`module_collections` is NOT one of the 25 declared `FAILURE_CLASSES`.** My class-coverage sweep flags it explicitly as the sole name printed that is not a declared class.

### The `25` that made this mistake possible
`MEASURED HERE` — **two different populations both of size 25, sharing only 15 names:**

| | count | |
|---|---|---|
| `run.mjs`'s `FAILURE_CLASSES` (AST-extracted by its true `[name, hit, msg]` tuple shape) | **25** | |
| `evidence-order.mjs`'s injection knobs (desk regex) | **25** | |
| **names in both** | **15** | |
| in `FAILURE_CLASSES`, no knob of that name | 10 | `uncaught_gap, partition_sum, partition_overlap, partition_orphan, membership, green_membership, disposition, twin_pairs_membership, prereg_membership, collection_shape` |
| a knob, not a `FAILURE_CLASS` name | 10 | `module_collection_add, module_collection_delete, new_unpinned_collection, own_extra_code, own_extra_inside_anchor, own_unrelated_attributed, own_unrelated_nonowned, prereg_delete, substituted_diagnostic, twin_pairs_delete` |

`R-596 §2` records that the extractor's first pass returned `0` and that *"the count `25` matching the campaign's known value is the join that told me the second read was right."* **That join is the defect.** `25` matching a known `25` was a **numerical coincidence between two disjoint-by-40% populations**, and it licensed a false membership claim. `I MEASURED THE NEIGHBOURING OBJECT.`

### So: are the 2 rows terminal *acceptance* failures?
**`UNKNOWN`, and it is the desk's call — but the answer the desk relied on is unavailable.** They fire a gate the code says is deliberately **outside** the acceptance table, and they exit before any declared class is evaluated. `R-596 §2`'s ground for placing them inside the population ("`collection_shape` is one of the 25") is refuted, so the "**BOTH** denominators agree" reassurance is void on the `25` side. I did not re-derive the `43` side (see Coverage).

★ **Note the consequence for the `(A)`/`(B)` framing itself, since it is not obvious:** those 2 rows are the *only* reason the two columns ever disagree. If they are **not** terminal acceptance failures, column (ii) becomes `35/35` on the true population and **reading `(A)` is MET too** — the `(A)`/`(B)` question the campaign has spent five rulings on would be **moot on this evidence**. If they **are**, `(A)` fails and `(B)` holds. Either way the reading question turns entirely on a membership fact the desk got wrong.

---

## TARGET 4 — the ~22 `INSTRUMENT FAULT` sites and `R-594 §3`'s boundary

**Finding: `R-594 §3`'s PRE-REGISTERED FALSIFIER IS SATISFIED, on three independent routes. `R-596 §1`'s mechanism claim is FALSE. This is the refutation.**

### What was pre-registered
> `R-594 §3`, verbatim: *"if ANY of those ~22 sites is reachable by a mutation of the **OBJECT UNDER TEST** rather than of the **INSTRUMENT**, then it is an acceptance failure wearing an instrument-fault caption, and it is IN scope."*

### What the desk concluded, and what it actually tested
> `R-596 §1`: *"Six pinned files … ALL INSTRUMENT. `corpus.mjs`, the object under test, is NOT among them. **No object-under-test mutation reaches an `INSTRUMENT FAULT` site.**"*

That final sentence is a bare **mechanism claim** with no measurement in the same breath. And the measurement offered for it answers a **different question**: *"which files does `PINNED_MODULE_COLLECTIONS` cover?"* `PINNED_MODULE_COLLECTIONS` governs the set-of-sets pin. It has **nothing to do** with which mutations reach `run.mjs:201`'s witness check, which reads `corpus.mjs`'s row declarations directly. `A MECHANISM CLAIM GETS ITS OWN TEST.`

### Three routes, each with a landed-plant assertion and a byte-identical restore

| route | mutation | site reached | exit | stdout lines | `(i)` OWN | `(ii)` FULL | needs an injection? |
|---|---|---|---|---|---|---|---|
| **#1** | `corpus.mjs` — delete `witness:` from row `34(d-u)`'s `typecheckerOwned` | `run.mjs:201` | **1** | 1 | **NO** | NO | **no — clean control** |
| **#2 (A)** | `corpus.mjs` — row `34(d-u)` **BODY** only: `(lane: Lane)` → `(lane:Lane)` (**1 byte**) | `run.mjs:397` | **1** | 1 | **NO** | NO | yes (`own_extra_inside_anchor`) |
| **#2 (B)** | `surface/tsconfig.pinned.json` malformed | `source-admission.mjs:57` | **1** | **0** | **NO** | NO | no |

**Route #1 is the strongest and needs no injection at all:** a defect in `corpus.mjs` — the file `R-596 §1` *itself names* as "the object under test" — produces a terminal non-zero exit whose entire stdout is `"EFFECT-DIGEST: ade9a2a1…\n"`. **Zero findings printed.**

**Route #2(A) closes the only ambiguity in #1.** A purist could argue `typecheckerOwned` is an *expectation* and therefore instrument-side. Route #2(A) mutates **only the fixture body** — the exact surface all 37 injections mutate, unambiguously the object under test — by **one byte**, and reaches `run.mjs:397`.

**Route #2(B)** additionally exercises `source-admission.mjs:57`, which `AR-639 §5` explicitly listed as *not classified*. It terminates at import time with **literally zero stdout**.

★ **Independent corroboration of route #1, unplanned:** the peer grader's mutate-and-revert cycle produced the *same* failure in the campaign tree before I designed anything, emitting the *same* `EFFECT-DIGEST ade9a2a1…`. Two agents, two occasions, one digest — `CORROBORATED` on a join key neither of us chose.

### The positive control that makes "37/37" mean something
`MEASURED HERE`. My scoring harness **did** report `exit≠0 ∧ OWN_FINDING=false` — three times. So when it reports `37/37 own=true` across the injection population, that is a **measured absence, not a dead probe**. `AN ABSENCE CLAIM OWES A POSITIVE CONTROL`; this one has three witnesses.

### Where that leaves the boundary
`R-596 §1` accepted a "CLEAN NEGATIVE" and ruled the sites OUT. The negative was clean only because the falsifier was never actually run against the object under test — the desk substituted a pinned-set enumeration for a reachability test. `MEASURED HERE`, reachability is **live on three routes**. `R-596 §1`'s own caveat — *"`[UNENUMERATED — carried]` ONE of the throw sites was exercised, not `22`. … per-site reachability is not [measured]"* — was the correct read of its own evidence, and the boundary ruling should not have been issued on top of it.

⚠️ **I do not claim to have settled the category.** I claim the pre-registered test that was to settle it has now returned the inconvenient answer, and that the stated ground for the convenient one is false.

---

## TARGET 5 — does `evidence-order.mjs` leak a reading? is `25` the wrong denominator?

### Reading-leakage: **NO LEAK FOUND.** Two non-overlapping paths.
- **Path A — read the executable lines.** `evidence-order.mjs:168–172`'s `faults` list has exactly four terms: unscorable cells; red witness failed to throw; red witness scored non-zero on a column; nothing scored. **No term references column (ii).** Exit is `process.exitCode = faults.length ? 1 : 0` (`:177/:181`).
- **Path B — execution, which is the real test.** The run reports **`col(ii) 23/25`** — two reds — and still **`exit=0`**. If a reading had leaked into the exit path, those reds would have forced non-zero. `stderr` is `0` bytes; knobs are iterated in sorted order; nothing is written to stderr on any path.

✅ **`R-597`'s core structural verification holds, and I confirmed it by execution rather than by reading alone.** Both columns are structural predicates, the same predicates score the red witness, and the exit code is genuinely reading-neutral. **This part of the desk's work is sound.**

### 🛑 Denominator: `25` is WRONG. The true declared population is **37**.
`MEASURED HERE`, two non-overlapping paths plus an execution control.

`evidence-order.mjs:40` derives the population with `/INJECT === '([a-z_]+)'/g` — a **text** path over `run.mjs`. It is structurally blind to `switch (INJECT) { case '…': }`, and `run.mjs` has **two** such statements (`:306` in `corpusUnderTest()`, `:455` in `GREEN_UNDER_TEST`).

- **Path A — TypeScript AST walk** of `run.mjs`, collecting every literal compared against the `INJECT` binding by any syntax (binary `===`/`==`/`!==`, `switch`-case, `Array.includes`, element access, `INJECT.startsWith`): **37 names**. Desk regex: **25**. Missed: **12**. Nothing in the regex set was absent from the AST set (`0`), so this is pure under-enumeration, not disagreement.
- **Path B — direct read of the executable case labels** at `run.mjs:307–335` and `:456–461`.

**The 12 knobs the fixture never scored:**
`green_add` · `green_delete` · `green_duplicate` · `green_to_red` · `membership_add` · `membership_delete` · `membership_delete_guard` · `membership_duplicate` · `membership_rename` · `partition_overlap` · `uncaught_stale` · `uncaught_undeclared`

**Positive control that these are REAL knobs, not dead names** (`MEASURED HERE`): all 12 exit `1` and each drives a *named* class red — e.g. `green_to_red` drives four (`uncaught_gap, membership, green_membership, disposition`). A non-existent knob would have produced the control's `exit=0 / 225 lines`. `green_delete` is the instructive one: it prints `225` lines, **identical in count to the control**, yet `exit=1` and fires `green_membership` — a line-count proxy would have missed it entirely, which is exactly why the desk was right to use structural predicates.

**Six measured blind spots in the regex** — each returns *no match at all*, so the knob is **dropped silently** rather than truncated:

| form | seen? |
|---|---|
| `INJECT === 'own_extra_code'` | ✅ MATCH |
| `INJECT === 'own_extra_2'` (digit) | ❌ MISSED |
| `INJECT === 'ownExtraCode'` (camelCase) | ❌ MISSED |
| `INJECT === "own_extra_code"` (double quotes) | ❌ MISSED |
| `INJECT==='own_extra_code'` (no spaces) | ❌ MISSED |
| `INJECT !== 'own_extra_code'` (negated) | ❌ MISSED |
| `switch (INJECT) { case 'own_extra_code': }` | ❌ MISSED |

⚠️ The header line *"declared injection knobs parsed from `run.mjs`: 25"* is therefore a false caption on a live instrument — and the comment above it (`:34–36`) is right about the principle (*"A hand-copied list … is a fabricated safety claim"*) while the implementation delivers a **32% under-count**. `COMPUTE THE CLOSURE, NOT THE GREP.`

### And the substance survives the wider population — this cuts FOR the desk
`MEASURED HERE`, all 37 knobs on the desk's **own** two predicates:

```
POPULATION (AST)                 : 37
exit non-zero                    : 37/37
exit ZERO (no terminal failure)  : 0
COLUMN (i)  own finding          : 37/37
COLUMN (ii) full evidence body   : 35/37   (same two divergent rows, nothing new)
```

**And the acceptance population is fully covered:** all **25/25** declared `FAILURE_CLASSES` are driven red by the 37-knob population — **zero** never-exercised classes. So reading `(B)`'s property is not merely unrefuted on the desk's 25; it holds on a population **48% larger**, and every declared acceptance class prints its own finding when made to fail. **The wrong denominator did not change this answer.** It is a real defect in the instrument that happened not to be load-bearing for the arithmetic — which is precisely why it must be recorded rather than waved off: nothing in the fixture would have told anyone if it *had* been.

---

## ⚠️ DECLARED EXPOSURE — read this before weighing my independence

I was instructed not to read the peer receipt at `GRADE-P0PC-4D-READING-2026-08-02.md`, and **I did not open it.** But while running my final object-drift check, `git log --oneline` printed commit `48ea8b68`'s subject, which states the peer's conclusion in one clause. I declare it rather than conceal it, because a grader who saw something and stayed silent is worth less than one who says so.

**Why my verdict is not anchored to it:** every measurement in this receipt was executed and recorded **before** `48ea8b68` existed in this tree (my prior drift check at `47d7127a` showed the file absent, and both peer receipt paths were `ABSENT` at my start-of-session check). My evidence chain — the 37-knob AST enumeration, the class-coverage sweep, the three falsifier routes, the argument-1 refutation — is self-contained and reproducible from the commands below without reference to any other grade. **`TIMESTAMP = JOIN KEY`**, and on that key my findings predate the exposure. I formed and wrote the `REFUTED` verdict from route #1, which I designed from `R-594 §3`'s text.

---

## MANDATORY COVERAGE SECTION

### 1. What I verified, and via which two-plus non-overlapping paths

| claim | path 1 | path 2 | path 3 |
|---|---|---|---|
| pinned object undrifted | `git diff ee31fe44 HEAD -- prototypes/` at two different HEADs | per-file sha256 vs `git cat-file blob` | file count via `git ls-tree` |
| proxy is faithful to the pin | materialised **from** the object DB (not the working tree) | post-hoc sha256 table, on-disk files, no pipe | file count 19 on three sides |
| reported table reproduces | `node evidence-order.mjs` in proxy | `node run.mjs` ×3 direct | falsifier's pre/post-restore controls |
| control exits zero | 3× direct runs (`exit=0`, 225 lines, 0 stderr) | `evidence-order.mjs`'s own control line | 4 further controls inside the two falsifiers |
| knob population = 37 | TypeScript AST walk (5 syntactic forms) | direct read of `run.mjs:307–335`, `:456–461` | execution: all 12 land, each fires a named class |
| the two 25s are different sets | AST tuple-shape extraction of `FAILURE_CLASSES` | desk-regex replication | set difference: 15 shared, 10+10 disjoint |
| divergent rows fire `module_collections`, not `collection_shape` | observed `*** <class>:` in stdout | static: single `process.exit` at `:138` < `:746` | message-text join (`:136` vs `:827`) |
| `collection_shape` prints the full body | `PROTO_INJECT=new_unpinned_collection` → 226 lines | its finding located at line 224 | body markers present ×4 |
| a terminal failure can print no finding | falsifier route #1 (clean control) | routes #2(A) 1-byte body, #2(B) surface | peer's accidental run, matching `EFFECT-DIGEST` |
| `evidence-order.mjs` leaks no reading | read `faults` at `:168–172` + exit at `:177/:181` | execution: `col(ii) 23/25` red yet `exit=0` | stderr 0 bytes on every path |

### 2. Positive-control witnesses for every absence claim I make

| absence claim | its positive control |
|---|---|
| "no counterexample among the 37 injections" | the same harness **did** report `exit≠0 ∧ own=false` on 3 falsifier routes — the probe is alive |
| "the control prints no `*** ` line" | failing runs **do** print one, at a located line number |
| "no corpus row lacks a string witness" | the scan **did** print rows when I removed one; and `CORPUS length: 68` proves it enumerated |
| "the regex misses no knob the AST found" | reverse direction measured too: `in regex but not in AST: 0` |
| "no `FAILURE_CLASS` is never exercised" | 25/25 covered, each with the naming knob(s) listed |
| "the 12 extra knobs are not dead names" | each exits 1 and drives a *named* class; a dead name would give the control's `exit=0` |
| "no reading leaks into the exit path" | `col(ii)` genuinely had 2 reds and exit was still 0 |
| "I did not modify the campaign tree" | my proxy mutations **did** move shas, and were restored and re-verified |

### 3. Join keys for every "identical / unchanged / matches" claim
- "proxy == pin": **sha256 per file** against `git cat-file blob ee31fe44:<path>`, plus **file count** from `git ls-tree`. Not `git show` (which applies smudge filters) and not the working tree (which moves).
- "campaign tree unmodified": **sha256 of all 18 hashed entries**, session-baseline vs end, plus `git status --porcelain` at both ends.
- "peer's accidental failure == my deliberate route #1": **`EFFECT-DIGEST` `ade9a2a1cdfa951017360c33de60d5114ebcebff1e0fbeecb11fe3d791ea9d1c`**.
- "pinned object undrifted across the HEAD move": the **blob**, not the commit.
- "concurrent writer occurred": **mtime** (`17:46` → `20:43:33`) against **unchanged content sha** — content alone would have shown nothing.

### 4. 🛑 What I did NOT verify

- **Per-site reachability of the remaining `INSTRUMENT FAULT` sites.** `MEASURED HERE` there are **23** `INSTRUMENT FAULT` throws and **27** throws total (`run.mjs` 5, `membership.mjs` 10, `module-collections.mjs` 9, `source-admission.mjs` 2, `red-proof.mjs` 1). I exercised **3** sites (`run.mjs:201`, `run.mjs:397`, `source-admission.mjs:57`). **`AR-639 §5`'s `[UNENUMERATED — 22 sites, 1 exercised]` is NOT closed by this grade** — it is narrowed to *20 of 23 unexercised*. My refutation needs only one; the blast radius still needs all of them.
- **The category question itself.** Whether a corpus row's `typecheckerOwned` declaration, a fixture body, or the pinned tsconfig counts as "object under test" vs "instrument" is a **definitional choice the desk owns**. I measured reachability; I did not and cannot rule the category. `4d-ii`'s final state is therefore `UNKNOWN` on the desk's ruling, `REFUTED` on the claim as certified.
- **`red-proof.mjs`'s 43-row denominator.** Not re-derived. `R-596 §2`'s "**BOTH** denominators" reassurance is refuted only on the `25` side; the `43` side is `[UNENUMERATED]` here.
- **The other five harness scripts as gates.** `red-proof.mjs`, `emitted-freeze.mjs`, `type-value-proof.mjs`, `module-tuple.mjs`, `membership.mjs` were never run standalone. `R-596 §4`'s six-script acceptance is **not** re-verified by me.
- **Whether the node's `acceptance` prose maps to `run.mjs`'s `FAILURE_CLASSES` at all.** The authoritative text (read from the graph JSON, node `P0PC`, not from a paraphrase) says *"every terminal acceptance failure exits non-zero after evidence collection while the restored control exits zero."* The identification of "terminal acceptance failure" with `FAILURE_CLASSES` ∪ the early gate is an **interpretation the campaign made and I inherited**; I did not independently justify it, and it is upstream of both readings.
- **Combinatorial injections.** Every measurement is single-knob. Interactions unmeasured.
- **`R-597`, `R-598`, `R-599`, `AR-640` in full.** I read `R-596` complete, `R-594 §2–§3`, `AR-639 §5`, and the graph JSON's `acceptance`. `R-597`/`R-598` I read only at their heading blocks. `AR-640` I did not open beyond its heading.
- **The peer grade.** Not opened. Exposure limited to one commit subject, declared above.
- **`runtime-production`.** Not touched, **not read**. No trading, capital or broker surface in scope.
- **Flakiness in the campaign tree.** I diagnosed the failing control as a concurrent writer on mtime evidence. I did **not** prove the absence of genuine nondeterminism in the harness; the proxy was stable across ~90 runs, which is evidence but not proof.

---

## RESTORATION PROOF

### Campaign tree — I mutated **nothing**
```
$ git -C C:/Users/tonio/Projects/wt-h1-wave4-20260712 status --porcelain -- prototypes/
   START reading: <empty>
   END   reading: <empty>          (identical; recorded at both ends per the amendment)

$ git diff --stat -- prototypes/
   <empty>
```
⚠️ Per the amendment I did **not** assume `prototypes/` started clean and did **not** clean anything. It was clean at both readings. I left every other dirty path in the tree (`AGENT-LOGS.md`, `docs/…`, ~60 untracked files) **untouched** — those are other seats' work.

**sha256, campaign tree, session-baseline vs end — all 18 hashed entries IDENTICAL:**

| file | sha256 (unchanged at both readings) |
|---|---|
| `corpus.mjs` | `e377abc758897aa5dc3d49834634d81f803c58cfe648a8503ed37c75f7d78d27` |
| `run.mjs` | `a85c3f0d3541cd465725140af06266eb451118da03e6ae229643b12c3786557e` |
| `evidence-order.mjs` | `4fb19d67ef0e45ea1a05690e1f8b1d9f22bb996bd73fc50c187a3c2a818b9d2d` |
| `module-collections.mjs` | `cbb2cccfc164e3b85145857a0b5f4071688ad59a9d8127d3736063f66b5a5dff` |
| `membership.mjs` | `be3639b42baa7ba09dbc589e5c929efe6b8c6b9b1d7f83ebcda75b93aeb29ea4` |
| `source-admission.mjs` | `ae8ae16abc23745bf598cad3927c5c7e14d3f4d05fce20e717bbad5f8fe2f909` |
| `red-proof.mjs` | `942b347357cc27cd5eecc63942d410e3c50562553a94fe314d93d81a192cb417` |
| `module-tuple.mjs` | `63bbde8f75ac5fe5212379ff241baf945e6d2503df1883d3d6d49b4266683fba` |
| `emitted-freeze.mjs` | `a4da4708a7a5fba7b3b62b19ee8092b03a46fd150d54ba22e2fe5847c81c315c` |
| `fs-tracker.mjs` | `03ef8f0f4dde43b29ac6837f8c64ed8cef571a28c359bc3c34ac853d1b96b242` |
| `runtime-admission.mjs` | `afa38b8d89e4bb822e78eeb3d33da683deffbcd35e7765db43ae96ae262f8627` |
| `type-value-proof.mjs` | `0caab6bda2d9409c...` (+ 6 `surface/` entries, all identical) |

**Only file I wrote in the campaign tree:** this receipt, `docs/designs/GRADE-P0PC-4D-READING-B-2026-08-02.md`. No commit. No `checkout`/`reset`/`stash`/index operation. `run.mjs:138` and the `:108`/`:746` caption untouched.

### Proxy — every mutation reverted byte-identical
All mutate-and-revert work happened in `…/scratchpad/p0-grade/`. Three episodes (`corpus.mjs` ×2, `surface/tsconfig.pinned.json` ×1), each asserting its plant **landed** before measuring and re-hashing after.

```
ALL 19 PROXY FILES == ee31fe44   (re-verified after every episode)
corpus.mjs        before == after : true
tsconfig.pinned   before == after : true
post-restore control              : exit=0, 225 lines, 0 stderr   (proves the restore, not just the hash)
```

---

## MINIMAL REPRODUCING CASES

Set up the isolated proxy (never mutate the shared tree):
```bash
TREE=C:/Users/tonio/Projects/wt-h1-wave4-20260712
mkdir -p /tmp/p0 && cd "$TREE"
git ls-tree -r --name-only ee31fe44 -- prototypes/p0-vnext-admission/ | while read -r p; do
  rel="${p#prototypes/p0-vnext-admission/}"; mkdir -p "/tmp/p0/$(dirname "$rel")"
  git cat-file blob "ee31fe44:$p" > "/tmp/p0/$rel"
done
mkdir -p /tmp/p0/node_modules && cp -r "$TREE/node_modules/typescript" /tmp/p0/node_modules/
export GIT_DIR=C:/Users/tonio/Projects/trading-forge/trading-forge/.git
cd /tmp/p0 && node run.mjs >/dev/null; echo "control exit=$?"     # 0
```

**F-1 — the denominator is 25, the population is 37:**
```bash
cd /tmp/p0
node -e "const s=require('fs').readFileSync('run.mjs','utf8');
console.log('desk regex :',new Set([...s.matchAll(/INJECT === '([a-z_]+)'/g)].map(m=>m[1])).size);
console.log('switch-case knobs the regex cannot see:',
  [...s.matchAll(/case '([a-z_]+)':/g)].map(m=>m[1]).join(' '));"
# desk regex : 25
# switch-case knobs ...: partition_overlap uncaught_undeclared uncaught_stale membership_rename
#   membership_add membership_delete membership_duplicate membership_delete_guard green_to_red
#   green_delete green_add green_duplicate green_to_red
```

**F-2 — the divergent rows fire `module_collections`, NOT `collection_shape`:**
```bash
cd /tmp/p0
PROTO_INJECT=module_collection_add    node run.mjs 2>/dev/null | grep '\*\*\*'
#   *** module_collections: run.mjs: NEW UNPINNED module-level collection 'ROGUE_UNPINNED_TABLE' ...
PROTO_INJECT=new_unpinned_collection  node run.mjs 2>/dev/null | grep -c .   # 226  <- full body
PROTO_INJECT=new_unpinned_collection  node run.mjs 2>/dev/null | grep '\*\*\*'
#   *** collection_shape: NEW UNPINNED exported collection(s) ... (R-562): ROGUE_SELF_CERTIFYING_SET
```

**F-3 — THE REFUTATION. A terminal non-zero exit that prints no finding, on the clean control:**
```bash
cd /tmp/p0
cp corpus.mjs /tmp/corpus.bak
# delete the `witness` from row 34(d-u)'s declaration — object under test, no injection
node -e "const f='corpus.mjs',fs=require('fs');const s=fs.readFileSync(f,'utf8');
const a=\"witness: 'undeclaredReader', \";
if(!s.includes(a)) throw new Error('anchor absent — plant would be a no-op');
fs.writeFileSync(f, s.replace(a,''));"
node run.mjs; echo "exit=$?"
#   EFFECT-DIGEST: ade9a2a1cdfa951017360c33de60d5114ebcebff1e0fbeecb11fe3d791ea9d1c
#   exit=1        <- non-zero, ZERO '*** ' findings, 1 stdout line
cp /tmp/corpus.bak corpus.mjs && sha256sum corpus.mjs   # e377abc7… restored
```

**F-4 — same result from a ONE-BYTE fixture-body mutation (no expectation touched):**
```bash
cd /tmp/p0 && cp corpus.mjs /tmp/corpus.bak
sed -i 's/(lane: Lane) => ({ v: undeclaredReader(lane) })/(lane:Lane) => ({ v: undeclaredReader(lane) })/' corpus.mjs
PROTO_INJECT=own_extra_inside_anchor node run.mjs; echo "exit=$?"   # exit=1, 1 line, no '*** '
cp /tmp/corpus.bak corpus.mjs
```

---

## SUMMARY TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `4d-ii` two-column instrument (`evidence-order.mjs`) @ `ee31fe44` | **6/10** | `VERIFIED` | Reproduces exactly; reading-neutral confirmed by execution (`col(ii)` red, `exit=0`) as well as by reading; red witness genuine | Population under-enumerated **32%** (25 of 37); 6 measured regex blind spots; `OWN_FINDING` is a proxy 2 emitters wider than its caption |
| Claim "`4d` is MET under reading `(B)`" | **5/10** | `VERIFIED` | Property holds 37/37 and 25/25 classes; **but** 3 counterexample routes exist in the class excluded by a **refuted** mechanism claim | `R-596 §1` mechanism FALSE; `R-596 §2` join FALSE; `R-596 §3` arg 1 refuted, arg 2 non-sequitur, arg 3 double-edged; category question unruled |
| "restored control exits zero" | **8/10** | `VERIFIED` | `exit=0`, 225 lines, 0 stderr; 7 runs incl. pre/post-restore; stable in isolation | Flaky in the **shared** tree under concurrent writers (diagnosed, not a property of the object) |

### What I would tell the desk in one line
**The arithmetic was right and the boundary was wrong.** Reading `(B)`'s property is real — I widened the population by 48% trying to break it and it held. But `4d` cannot be called MET on this evidence, because the one class of counterexample was excluded by a sentence that measured the wrong thing, and the desk's own pre-registered falsifier — the one it promised to honour *"on the convenient answer"* — now returns the inconvenient one on three routes, the cheapest being a single byte.

---
*Grader: `accuracy-validator` (PATH B). Receipt written by the grader; the desk commits it. `4d` remains, on my evidence, `NOT MET` as certified and `UNKNOWN` pending an explicit category ruling that does not rest on `R-596 §1`.*
