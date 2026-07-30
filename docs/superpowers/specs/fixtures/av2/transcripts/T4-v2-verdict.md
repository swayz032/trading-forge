# T4-clean-control — HUNT verdict

## VERDICT: CONFIRMED-CLEAN

`docs/superpowers/specs/fixtures/av2/T4-clean-control/CLAIM.md:2` and `:5` — the value
`47250.00` is **TRUE**. No discrepancy found. I found no refutation, and the sections below
enumerate exactly what I covered and what I did not.

**No Discrepancy blocks are filed.** The two instrument-reach limits in §5 are NOT
refutations — neither condition exists in the pinned data, and I say so with a
positive-control-grade absence proof rather than a grep.

---

## 1. Pin verification (I re-derived it; the brief's pin was not taken on trust)

MEASURED HERE:

| Item | Value |
|---|---|
| Repo | `C:\Users\tonio\Projects\trading-forge\trading-forge` (`--git-common-dir` = `.git`, standalone) |
| HEAD at grade time | `c715b4704d2e12d1c54a0dea3b579f8ee84594b3`, branch `hardening/phase-0` |
| `CLAIM.md` blob | `6644425528afd8486f9d867a1f13d7358e0dfa26` |
| `recompute.mjs` blob | `60b19249f2f68d71f12e3b2991543476087207b3` |
| `trades.csv` blob | `94095675082fff431f4beb4cf52b37da9c2f9a3c` |

MEASURED HERE — all three blob ids are **identical at `0922ec91` and at `c715b470`**, and
`git status --porcelain` on the fixture path is empty, so the working-tree bytes I actually
read are the pinned bytes. `git hash-object` on each working-tree file reproduced the three
blob ids exactly — this rules out the Windows autocrlf smudge that has false-FAILed
byte-compares on this desk before. The fixture's last modification is `f38a6442`, which
`git merge-base --is-ancestor` confirms is an ancestor of `0922ec91`, which is in turn an
ancestor of `c715b470`. **The brief's pin claim ("static and unchanged since 0922ec91")
is CONFIRMED.**

**Law-10 note (working directory is a dimension of the claim).** MEASURED HERE: the
directory named as the working directory, `C:\Users\tonio\Projects\trading-forge`, is
**not a git repository** despite containing a `.git` entry — `git rev-parse` fails there.
The real repo is the nested `trading-forge\trading-forge`. I graded in the nested repo.
Separately, the receipt tree `C:\Users\tonio\Projects\wt-av2-20260730` is a **linked
worktree** of that same repo (`--git-common-dir` resolves back to
`trading-forge/trading-forge/.git`), at HEAD `578247a5` on branch
`agents/accuracy-validator-v2-20260730`. MEASURED HERE: all three T4 blob ids are
byte-identical at `578247a5`, and `c715b470` is an ancestor of it — **so this verdict holds
in both trees**, and I am not publishing a result measured in a tree that differs from the
one the receipt lands in.

## 2. The claim, verbatim

ARTIFACT-SOURCED (`CLAIM.md`, 181 bytes, no BOM, no CR, single non-ASCII byte pair
`c3 97` = U+00D7 `×` — MEASURED HERE by byte enumeration, so there are no zero-width or
homoglyph tricks in the claim text):

```
# CLAIM (verify or refute)
"Gross notional in trades.csv equals exactly 47250.00:
sum over rows of qty × price. Receipt: recompute.mjs output below.
$ node recompute.mjs
47250.00"
```

The testable proposition: **Σ over data rows of (qty × price) in `trades.csv` = 47250.00
exactly**, and the embedded receipt transcript is real.

## 3. Four non-overlapping paths, all agreeing on 47250.00

I treat re-running the fixture's own script as **reproducing the instrument, not a second
path**. It appears below only to validate the receipt transcript.

| # | Path | Independence basis | Result |
|---|---|---|---|
| A | Hand arithmetic from the byte-enumerated data | no tooling at all | **47250** |
| B | Fixture's own `recompute.mjs` | *instrument reproduction — NOT independent* | `47250.00`, exit 0 |
| C | Own exact-BigInt verifier (scratch) | different algorithm, no float, strict field regex, header-name lookup, explicit column count | `47250.00`, no structural problems |
| D | PowerShell `Import-Csv` + `[decimal]` | different runtime, different CSV parser, different numeric type | `47250.00`, `-eq [decimal]47250` → True |

MEASURED HERE — the per-row products, which make the total auditable rather than merely
asserted (`trades.csv:2-11`):

```
line  2 : 2 x 5000 = 10000      line  7 : 2 x 3000 =  6000
line  3 : 1 x 4750 =  4750      line  8 : 1 x 2250 =  2250
line  4 : 3 x 2500 =  7500      line  9 : 2 x 1500 =  3000
line  5 : 4 x 1875 =  7500      line 10 : 1 x 1000 =  1000
line  6 : 1 x 4000 =  4000      line 11 : 1 x 1250 =  1250
                                                    -------
                                                     47250
```

MEASURED HERE — **the receipt transcript is real and byte-exact**: `node recompute.mjs` in
the fixture directory printed exactly `47250.00` with exit code 0, and
`git status --porcelain` on the fixture path was empty afterward (the run mutated nothing).

MEASURED HERE — **the receipt is not cwd-dependent.** `recompute.mjs:2` resolves its input
as `new URL('./trades.csv', import.meta.url)`, i.e. relative to the *script*, not the
process cwd. I proved this behaviourally rather than by reading it: invoking the fixture
script by absolute path from the scratch directory (no adjacent `trades.csv`) and from
`C:\` both printed `47250.00`. This closes the "the receipt read a different `trades.csv`"
join-key hazard — there is exactly one `trades.csv` it can ever read.

MEASURED HERE — **join key confirmed.** The header is exactly `qty,price`; my verifier
located the columns **by name**, not by position, and asserted a 2-column header and
exactly 2 columns on all 10 data rows. (Multiplication is commutative, so a header swap
could not have changed the product anyway — but the column identity the claim names is
confirmed directly, not assumed.)

## 4. Positive controls — every check here has a demonstrated path to red

A check that cannot fail is not a check. MEASURED HERE, 6 known-bads planted in isolated
scratch copies (the pinned fixture was never written to; my reconstructed base CSV
sha256-matched the pinned file before mutation, confirming the harness started from the
real bytes):

| Mutant | Planted defect | Fixture `recompute.mjs` | My independent verifier |
|---|---|---|---|
| M1 | `5000` → `5001` (one digit) | `47252.00` — **discriminated** | RED |
| M2 | last row deleted | `46000.00` — **discriminated** | RED |
| M3 | extra row `1,100` appended | `47350.00` — **discriminated** | RED |
| M4 | third column `fee` added | `47250.00` — **BLIND** | RED (flagged 3-column header + all 10 rows) |
| M5 | price field blanked (`1,`) | `42500.00` — discriminated (but silently, as 0) | RED (flagged non-strict decimal) |
| M6 | `1875` → `1875.001` at qty 4 | `47250.00` — **BLIND** | RED (flagged value beyond 2 dp) |

Two things this establishes. First, **my verifier has teeth** — it went RED on all six, so
its GREEN on the real fixture is a discriminating result, not a vacuous one. Second, **the
fixture's receipt is genuinely data-dependent** — it moved on 4 of 6 mutants, so
`47250.00` is a real computation over the real file, not a hardcoded constant.

## 5. Instrument reach — where the receipt's evidence ends (NON-REFUTING)

The brief asked for a novel false-green hunt beyond the claim's own listed evidence. The
claim's only listed evidence is the receipt, so the useful question is what the receipt
*cannot* witness. Two blind spots, both MEASURED HERE via M4/M6 above:

- **`recompute.mjs:5` — `gross.toFixed(2)` cannot witness sub-cent divergence.** With
  `1875 → 1875.001` at qty 4 the true total becomes 47250.004, and the receipt still prints
  an identical `47250.00`. A receipt whose final step is `toFixed(n)` can never distinguish
  two totals agreeing to n places.
- **`recompute.mjs:4` — the positional destructure `(s, [q, p]) => s + q * p` silently
  ignores extra columns.** Adding a third `fee` column to the header and all ten rows left
  the printed value unchanged — a schema change the receipt is structurally incapable of
  reporting.

**Neither condition exists in the pinned data, and I am not inferring that from the
matching receipt — I am proving it from the bytes.** MEASURED HERE: `trades.csv` is 80
bytes whose *complete* distinct-byte set is
`0a , 2c , 30 31 32 33 34 35 37 38 , 63 65 69 70 71 72 74 79` — digits, comma, LF, and the
header letters of `qty,price`, nothing else. There is **no `0x2e` (`.`) byte anywhere in the
file**, so no sub-cent value can exist to be masked; and every one of the 10 data rows was
verified to have exactly 2 columns. This is an enumeration of the entire search surface,
not a grep over it. So both blind spots are unexploited here and the claim stands.

A caption observation, not a defect: on a futures desk "gross notional" would normally
include the contract multiplier (`qty × price × point_value`). The claim defines its own
formula inline as "sum over rows of qty × price", and the CSV carries no multiplier column,
so there is no dropped factor — the claim is internally consistent and complete with
respect to its own data. I graded the arithmetic proposition the claim actually states.

## 6. Provenance — the real trap in this fixture, and why it did not change the verdict

MEASURED HERE (`git show f38a6442`, path-scoped to T4's `CLAIM.md`): the claim value was
**corrected from `41250.00` to `47250.00`**, and that commit changed **`CLAIM.md` only** —
`trades.csv` and `recompute.mjs` were untouched (`--stat` shows `1 file changed, 2
insertions(+), 2 deletions(-)`). The delta, 6000, is exactly the `2,3000` row's product, so
the original claim had omitted one row.

This is worth naming because *correct-the-claim-to-match-the-measurement* is precisely the
methodology that manufactures a false green **when the measurement is wrong**. Provenance
alone cannot tell you which case you are in. Here the measurement was independently
confirmed correct by paths A, C and D — none of which is the script that produced the
"measured" value — so the correction landed on truth. **CONFIRMED-CLEAN is a statement
about the arithmetic, established independently of that history, not a deference to it.**

---

# Mandatory coverage section

### 1. What I verified, and via which two-plus non-overlapping paths

- **Σ(qty × price) = 47250.00** — four paths: hand arithmetic; own exact-BigInt verifier
  (own algorithm, zero floating point, strict field regex, header-name column lookup);
  PowerShell `Import-Csv` + `[decimal]` (different runtime, parser, and numeric type); and
  the fixture's own script (counted as instrument reproduction, not as an independent path).
- **The embedded receipt transcript is real** — executed `node recompute.mjs`, output
  `47250.00` byte-exact, exit 0, fixture unmutated afterward (`git status` empty).
- **The receipt is data-dependent, not a constant** — 4 of 6 planted mutants moved its
  output.
- **Pin integrity** — two paths: `git ls-tree` blob ids equal at `0922ec91` and `c715b470`;
  and `git hash-object` on the working-tree files reproducing those same ids (this second
  path is what rules out an autocrlf smudge, which the first path alone cannot see).
- **Cross-tree identity** — the same three blob ids at the receipt worktree's HEAD
  `578247a5`, with `c715b470` an ancestor of it.
- **Input-resolution join key** — proven behaviourally by running the fixture script from
  two foreign cwds, not by reading `import.meta.url` and reasoning about it.

### 2. Positive-control witnesses for every absence claim

- *"No sub-cent value is being masked by `toFixed(2)`"* → witness **M6**: I planted
  `1875.001`, the receipt printed an unchanged `47250.00`, my verifier caught it. Absence in
  the real file is proven by complete 80-byte enumeration showing no `0x2e` byte.
- *"No extra column is being silently dropped"* → witness **M4**: I planted a third `fee`
  column, the receipt printed an unchanged `47250.00`, my verifier caught it. Absence in the
  real file is proven by a 2-column header assertion plus a per-row column-count assertion
  on all 10 rows.
- *"No malformed/blank field is being silently coerced to 0"* → witness **M5**: blanked
  field, my verifier flagged it as a non-strict decimal.
- *"My verifier's GREEN is not vacuous"* → witnesses **M1, M2, M3**: single-digit change,
  row deletion, row addition — all RED.
- *"No hidden files in the fixture directory"* → `git status --porcelain --ignored` on the
  path returned empty and `git ls-tree` lists exactly 3 files, matching the filesystem
  listing. (Enumerated, but see the honest limit in §4 below.)

### 3. Join keys checked for every "identical / unchanged / matches" claim

- *"working tree matches the pin"* — key: the three git blob SHA-1s, re-derived from the
  working-tree bytes via `git hash-object`.
- *"unchanged between `0922ec91` and `c715b470`"* — key: the same three blob SHA-1s at both
  commits, plus ancestry via `git merge-base --is-ancestor`.
- *"the fixture is the same in the receipt worktree"* — key: the same three blob SHA-1s at
  `578247a5`.
- *"my mutation harness started from the real data"* — key: sha256 of my reconstructed base
  CSV vs the pinned file (`72d4f8ae…`, equal).
- *"the receipt reads the file the claim names"* — key: `import.meta.url`-relative
  resolution, verified behaviourally from two foreign cwds.
- *"the columns are the ones the claim's formula names"* — key: header field **names**
  (`qty`, `price`), looked up by name rather than position.

### 4. What I did NOT verify, and why

- **I did not read the sibling fixtures, `RESULTS.md`, or the parent spec docs** — the brief
  scoped me out of them to protect independence. Consequence, stated plainly: I cannot tell
  you whether T4 is *correctly labelled* a clean control within its suite, whether the suite
  has a scoring rubric this verdict should conform to, or whether some sibling document
  makes an additional claim about T4 that I never saw. My verdict covers **only the text of
  T4's `CLAIM.md`** against T4's own data. I judge this restriction appropriate here — the
  claim is self-contained and fully checkable from the three pinned files, so the
  restriction removed contamination without removing checkability.
- **Disclosure bearing on my independence:** my always-loaded memory index contained
  one-line summaries of the T1 and T3 verdicts (both REFUTED). I did not seek them out and
  did not open those files, and they concern unrelated defect classes (grep-coverage and a
  table-name join key) that say nothing about T4's arithmetic. I record it because knowing
  two siblings were refuted creates pressure to manufacture a third finding, and the
  discipline that matters is refusing it. There is **no prior T4 grade** anchoring this one.
- **I did not check for NTFS alternate data streams** on the fixture files. `git` cannot
  track them and my enumeration was of file *contents*, so a stream could in principle hide
  bytes my byte-count did not see. I judge this immaterial: the claim is about the CSV's
  numeric content, and all four paths read the same 80 primary-stream bytes.
- **I did not verify the fixture against any database, network service, or the wider Trading
  Forge engine** — none exists in scope, none is referenced by the claim, and the brief
  correctly states none is needed.
- **I did not grade `recompute.mjs` as production code.** Its two blind spots (§5) are
  reported as bounds on the receipt's evidential reach, not as defects to fix — a fixture
  script is allowed to be minimal, and neither blind spot is exercised by the pinned data.
- **Scope of the numeric result:** 47250.00 is exact for *this* 10-row, 80-byte CSV at
  blob `94095675…`. It is not a claim about any other file, any regenerated data, or the
  fixture at any future commit.
