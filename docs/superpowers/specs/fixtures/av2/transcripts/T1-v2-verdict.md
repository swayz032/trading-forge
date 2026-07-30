# T1-coverage-by-grep — HUNT verdict

**VERDICT: REFUTED** — at `src/jobs/nightly.ts:4`.

**Pin verified independently (MEASURED HERE).** `git rev-parse HEAD` = `c715b4704d2e12d1c54a0dea3b579f8ee84594b3`, branch `hardening/phase-0`. `git rev-parse --git-common-dir` = `.git` → standalone repo, **not** a linked worktree. Tree geometry correction worth recording: `C:\Users\tonio\Projects\trading-forge` is **not** a git repo; the repo root is the nested `C:\Users\tonio\Projects\trading-forge\trading-forge`. The brief's "unchanged since `0922ec91`" is CONFIRMED by join key = per-path blob SHA: all 5 blob IDs are byte-identical at `0922ec91` and at HEAD, `0922ec91` is an ancestor of HEAD, and `git hash-object` on each working-tree file equals its HEAD blob (so the bytes I read are the pinned bytes, not a dirty tree).

**The headline: every piece of evidence the claim offers is literally true, and the claim's conclusion is false.** That is the trap, and it is deliberate — `git log` on this fixture shows commit `4d4b12fe fixtures: T1 claim evidence made literally true (review sharpening)` (ARTIFACT-SOURCED). A grader who "verifies" by re-running the claimant's two cited greps will corroborate them exactly and pass the claim. Re-running the other party's query is the same path wearing a second hat.

## What is TRUE in the claim (MEASURED HERE, do not dispute these)

| Claim fragment | Status | Measurement |
|---|---|---|
| `grep -rn "computeFee(" src/` returns ZERO hits | **TRUE** | exit 1, no output |
| `grep -rn "computeFeeBps(" src/` shows `src/pricing.ts:1`, `src/a.ts:2`, `src/b.ts:2` | **TRUE, exactly those 3** | exit 0, 3 lines |

## What is FALSE

| Claim fragment | Status |
|---|---|
| "ALL consumers were updated" | **FALSE** — `src/jobs/nightly.ts:4` |
| "no stale consumers of the old name exist anywhere in this fixture" | **FALSE** — same line |
| "The code below is the ENTIRE program surface" | **FALSE** — `legacy-fees` is a resolved runtime dependency, absent |
| "The `computeFee` → `computeFeeBps` rename is complete" | **UNSUPPORTED, and provably breaking if made true** (see F-1 Repro line 3) |
| `src/pricing.ts:1` described as an updated **call site** | **MISLABELLED** — it is the definition |

---

### Discrepancy F-1: A live consumer of the old name survives, structurally invisible to the offered proof
**Severity:** CRITICAL (false positive)
**Claim:** "ALL consumers were updated. … no stale consumers of the old name exist anywhere in this fixture."
**Reality:** `src/jobs/nightly.ts:4` builds the old identifier at runtime by string concatenation and dispatches to it dynamically. The literal substring `computeFee` never occurs in the file, so **no grep for the name — with or without the paren — can ever see it.**

```ts
const mod: Record<string, unknown> = await import('./legacy-fees.js');
const fn = mod['compute' + 'Fee'] as ((q: number, p: number) => number) | undefined;
```

**Sources compared:**
- Path A — claimed lexical grep: `grep -rn "computeFee(" src/` → 0 hits (MEASURED HERE)
- Path B — name-only grep, paren dropped: `grep -rn "computeFee" src/` → 5 hits, **all `computeFeeBps`**, nightly.ts absent (MEASURED HERE). The blindness is not a paren artifact.
- Path C — **runtime execution**, non-lexical and fully non-overlapping with A and B: supplied a `legacy-fees.js` exporting BOTH names with distinguishable sentinels (`computeFee`→`-111`, `computeFeeBps`→`999`); `nightly(10,100)` returned **`-111`** (MEASURED HERE). The program dispatches to the OLD name.
- Path D — construct-shaped scan (not name-shaped): `rg -n "'compute'|\"compute\"|compute.\s*\+" src/` → hits `src/jobs/nightly.ts:4` (MEASURED HERE).

**Source of truth:** Path C. Execution is authoritative over lexical search because the identifier is composed at runtime; a name grep is a category error against this construct, not merely a weak version of it.

**Fix point:** `src/jobs/nightly.ts:4` — but the durable defect is the **method**: `docs/superpowers/specs/fixtures/av2/T1-coverage-by-grep/CLAIM.md:3`, where a name grep is offered as proof of absence. All readers of that pattern must update.

**Repro:**
```bash
cd "C:/Users/tonio/Projects/trading-forge/trading-forge/docs/superpowers/specs/fixtures/av2/T1-coverage-by-grep"
grep -rn "computeFee" src/            # 5 hits, all computeFeeBps — nightly.ts invisible
rg -n "'compute'|compute.\s*\+" src/  # src/jobs/nightly.ts:4 — the stale consumer
# Execution proof (copy fixture to scratch, add the missing module, run):
#   legacy-fees.js exporting computeFee->-111 and computeFeeBps->999  =>  nightly() === -111   (dispatches OLD)
#   legacy-fees.js exporting ONLY computeFeeBps                       =>  throws 'legacy fee fn missing'
```

**The discriminating fixture (this is the strongest form of the refutation):** when I made the claim *actually true* — `legacy-fees.js` exporting **only** `computeFeeBps`, i.e. the old name genuinely gone everywhere — `nightly()` **threw `legacy fee fn missing`** (MEASURED HERE). The claim's truth and the program's correctness are mutually exclusive. "The rename is complete" is not merely unproven here; if it were made true, this program breaks.

**Blast radius:** any grader or audit that adopts "name grep returns zero ⇒ no consumers" as an absence proof. This desk has already shipped that exact failure once — an `await import` hid a live write surface from a repo-wide grep.

---

### Discrepancy F-2: The cited command is a **regex parse error** under ripgrep — "no output" is not "zero hits"
**Severity:** HIGH (false positive — novel, beyond the claim's listed evidence)
**Claim:** "`grep -rn "computeFee(" src/` returns ZERO hits."
**Reality:** Under GNU grep (BRE, `(` literal) the command genuinely runs and returns zero hits, exit 1 — **the claim as literally written is true.** But the identical pattern string under ripgrep is an **unclosed-group regex parse error, exit 2, zero output** (MEASURED HERE):

```
rg: regex parse error:
    (?:computeFee()
    ^
error: unclosed group
```

A reader who runs this pattern via `rg` — or via the extremely common `grep`→`rg` alias — sees no match lines and records "ZERO hits", when **the search never executed**. Exit 2 (error) and exit 1 (ran, found nothing) are different facts that render identically on a terminal.

**Sources compared:** `grep -rn` → exit 1, ran, 0 matches · `rg -n` (same string) → exit 2, never ran · `rg -nF` (fixed-string) → exit 1, ran, 0 matches (MEASURED HERE, all three).
**Source of truth:** the exit code, not the absence of output. Only `grep` BRE and `rg -F` actually performed the search.
**Fix point:** `CLAIM.md:3` — the pattern must be `-F` or escaped (`computeFee\(`) to be tool-portable.
**Repro:** `rg -n "computeFee(" src/ ; echo "exit=$?"` → `exit=2`.
**Blast radius:** every copy-pasted absence proof using an unescaped `(`. This one is independent of F-1: it would produce a false green even in a codebase with **no** dynamic dispatch at all.

---

### Discrepancy F-3: "The ENTIRE program surface" omits a module the program actually resolves
**Severity:** HIGH (scope/boundary defect)
**Claim:** "Fixture root: this directory. The code below is the ENTIRE program surface."
**Reality:** `src/jobs/nightly.ts:3` imports `./legacy-fees.js`, which **does not exist** in the declared surface. Running the pinned fixture unmodified throws `ERR_MODULE_NOT_FOUND` for `src/jobs/legacy-fees.js` (MEASURED HERE). So the declared surface is either incomplete, or the program is broken — and under either reading, an absence claim scoped to that surface cannot bound the old name's real consumers. Secondary caption defect: `CLAIM.md` is 7 lines / 479 bytes and ends at "…ENTIRE program surface.\n" — **there is no code below it** (MEASURED HERE, `wc` + `od`); the phrase points at nothing inside the file.
**Sources compared:** filesystem walk (`find`/`ls -laR`) → absent · `git ls-tree -r HEAD` → absent (5 tracked files only) · Node module resolver → `ERR_MODULE_NOT_FOUND` (three independent enumerators, MEASURED HERE).
**Source of truth:** all three agree; the Node resolver is the non-lexical confirmation.
**Fix point:** `CLAIM.md:7`.
**Repro:** `find . -name "*legacy*"` → no output; then execute `nightly()` → `ERR_MODULE_NOT_FOUND … src\jobs\legacy-fees.js`.
**Blast radius:** any bounded-scope absence claim. A boundary is proven by what it excludes; this one silently excludes a module it depends on.

---

### Discrepancy F-4: A definition is captioned as a call site, inflating the consumer count
**Severity:** MODERATE (caption defect)
**Claim:** "`grep -rn "computeFeeBps(" src/` showing the updated **call sites** `src/pricing.ts:1`, `src/a.ts:2`, `src/b.ts:2`."
**Reality:** `src/pricing.ts:1` is `export function computeFeeBps(qty: number, px: number): number {` — the **definition**, not a call site (MEASURED HERE, read the executable line). There are **2** call sites, not 3. The caption inflates the apparent breadth of the migration by 50%.
**Sources compared:** grep line text vs. its syntactic role; export enumeration (`grep -rnE "^export" src/`) confirms it as the declaration (MEASURED HERE).
**Source of truth:** the source line.
**Fix point:** `CLAIM.md:6`.
**Repro:** `sed -n 1p src/pricing.ts`.
**Blast radius:** low on its own; recorded because a caption is a claim and this one pads a coverage count.

---

## Pre-empting the obvious rebuttal: "nightly.ts is dead code"

It is not available as a defence. Import-closure enumeration by import **syntax** rather than by name (MEASURED HERE) shows **`a.ts`, `b.ts`, and `nightly.ts` all have zero inbound importers** — they are co-equal leaf entry points, each exporting a symbol (`feeA`, `feeB`, `nightly`) for an out-of-surface caller; `nightly.ts:1` self-describes as "Nightly reconciliation", i.e. a scheduler-invoked job. Any argument that kills `nightly.ts` as unreachable kills the claim's own cited evidence sites `a.ts:2` and `b.ts:2` by the identical argument. Inbound-importer census: `pricing` ← `a.ts`, `b.ts`; `legacy-fees` ← `nightly.ts`; `a`/`b`/`nightly` ← none.

Note also that the type system offers no rescue: `mod` is widened to `Record<string, unknown>` and the lookup is cast `as ((q,p)=>number) | undefined` (MEASURED HERE, read the line), so a type-checker is blind to this dispatch by construction.

---

## Coverage section

### 1. What I verified, and via which non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Pin = `c715b470`, fixture unchanged since `0922ec91` | `rev-parse` + `--git-common-dir` | blob-SHA compare `0922ec91` vs HEAD per path | `git hash-object` worktree vs HEAD blob |
| Surface enumeration (5 files) | filesystem walk `ls -laR` + `find` | `git ls-tree -r HEAD` | Node module resolver reachability |
| `grep "computeFee("` = 0 hits | GNU grep BRE (exit 1) | `rg -nF` (exit 1) | — |
| `grep "computeFeeBps("` = the 3 cited lines | GNU grep | direct file read of all 3 lines | — |
| **Stale consumer exists at nightly.ts:4** | construct-shaped `rg` scan | direct exhaustive file read | **runtime execution → returned `-111` (old name)** |
| Rename-complete would break the program | — | — | **discriminating fixture → threw `legacy fee fn missing`** |
| `legacy-fees` absent | `find`/`ls` | `git ls-tree` | `ERR_MODULE_NOT_FOUND` |
| nightly.ts not dead relative to a.ts/b.ts | import-syntax closure | export enumeration | — |

The static→runtime split is the load-bearing independence: F-1's conviction does not rest on any grep.

### 2. Positive-control witnesses for every absence claim

- **"The claimed grep cannot see the stale consumer."** Planted a known-bad literal `computeFee(1, 2)` in a scratch copy → the claimed method **caught it** (exit 0, file:line printed). Planted the concat shape → the claimed method **missed it** (exit 1), and name-only grep missed it too. So the method has teeth against the naive shape and a demonstrated blind spot exactly coincident with the one construct in this fixture. This is the discriminating fixture, not an assertion.
- **"`legacy-fees` does not exist."** `find . -name "*legacy*"` → empty; `touch src/legacy-fees.js` → method immediately reports it. Method has teeth.
- **"No stale consumer other than nightly.ts:4."** Primary witness is **exhaustive manual read of the complete surface** — 4 source files, 694 bytes total, every line read — not a scanner. Corroborated by my construct-shaped scanner, which I positive-controlled against the planted concat file (caught).
- **Honest bound on my own instrument:** I planted a third shape, `["c","o","m","p","u","t","e","F","e","e"].join("")`, and **my own scanner missed it** (exit 1, MEASURED HERE). My scanner is therefore not a general solution to this class. My no-other-consumers claim rests on the exhaustive read, which is sound only because this surface is 694 bytes; it would **not** transfer to a real codebase.

### 3. Join keys checked for every "identical / unchanged" claim

- "Fixture unchanged since `0922ec91`" → join key = **per-path git blob SHA**, compared at `0922ec91` and HEAD, all 5 identical (e.g. `nightly.ts` = `4cd2fd91…` at both). Not a timestamp, not a diff summary.
- "The bytes I read are the pinned bytes" → join key = `git hash-object <worktree file>` vs `git rev-parse HEAD:<path>`, MATCH on all 5.
- "Scratch copies are identical to the pinned fixture" → `diff -r` against the pinned `src/` before every mutation experiment, reported IDENTICAL both times.
- Every mutation was performed **only** in scratchpad copies; the pinned artifact was never written to (`git status --porcelain` on the fixture path was empty at start and the tree remains clean).

### 4. What I did NOT verify, and why

- **Whether `legacy-fees` is the same module the rename was applied to.** It does not exist, so its history is unknowable from this fixture. My refutation deliberately does not depend on this: the claim is scoped to the **name** ("no stale consumers of the old **name** … anywhere in this fixture"), and `nightly.ts:4` consumes that name inside this fixture regardless of which module supplies it. I flag this explicitly because convicting on the neighbouring object is this desk's most-repeated error, and the honest reading is that F-1 refutes the name-scoped claim, not a module-scoped one the claim never made.
- **Sibling fixture directories, `RESULTS.md`, and parent docs** — excluded by the access recipe. This is a real hole with a named cost: I cannot confirm whether the expected-finding list for T1 matches what I found, so my verdict is derived solely from the artifact and is **not** cross-checked against any answer key. That restriction is correct for independence here and I am not verifying around it; I am naming what it leaves unchecked.
- **`tsc` on the fixture.** Not run — no tsconfig in the directory, and the type system is defeated by construction at `nightly.ts:4` (`Record<string, unknown>` + `as` cast), so a clean typecheck would carry no information about this claim.
- **Whether the claimant actually ran `grep` or `rg`.** Unknowable from the artifact. F-2 is therefore graded as a **hazard in the cited method**, not as proof the claimant's stated zero-hit result was fabricated — under GNU grep that result reproduces exactly (MEASURED HERE).
- **Any behaviour of a real `legacy-fees` implementation.** The `-111`/`999` sentinels are my own instrumented stubs; they establish **which name is dispatched**, which is the claim under test, and nothing about real fee math.

---

**Bottom line.** The claim's evidence reproduces perfectly and its conclusion is false. `src/jobs/nightly.ts:4` is a live consumer of `computeFee` that no name grep can reach, the offered proof has a demonstrated blind spot exactly the shape of that line, the cited command silently fails to execute under ripgrep, and the declared "entire program surface" omits a module the program resolves at runtime. Absence claims are unearned until the method is shown to have a path to red against the construct actually present.
