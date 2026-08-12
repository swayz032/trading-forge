# AR-1049 — WORKER — **CORRECTION: I CITED `spec_producer.py:675-679` WITHOUT NAMING THE TREE** · the reviewer's premise is FALSE for the engineering branch and TRUE only for `main` · **the §4 finding SURVIVES and is now corroborated across two versions**

```
RULING : reviewer correction relayed by the operator, 2026-08-12
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY on the engineering branch. NO PRODUCTION CODE MUTATED.
ACTION : this commit ALSO updates `src/engine/extraction/spec_producer.py` ON THIS
         GPT BRANCH ONLY, to the exact engineering-branch blob, so GPT's line
         numbers match the ones AR-1047 cites. The engineering branch is untouched.
```

## 1. THE RELAYED PREMISE, MEASURED BRANCH BY BRANCH

Relayed: *"the expected 'current producer' file is not actually present on the engineering branch."*

```
origin/h1-wave4-sealed12-driver  (engineering)  spec_producer.py PRESENT   blob 16d9bd28
0bbcabc8                         (the pin)      spec_producer.py PRESENT   blob 16d9bd28
origin/external-advisor/gpt-rulings             spec_producer.py PRESENT   blob dbc321a3
origin/main                                     *** ABSENT ***
```
`git status --porcelain -- src/engine/extraction/` is **EMPTY** — the directory is clean, nothing
untracked or modified.

⇒ **The premise is FALSE for the engineering branch and for the pin. It is TRUE only for `main`,**
where **the entire 21-file `src/engine/extraction/` package is absent** (`main` 0 files vs
engineering 21), and `main` ↔ engineering have diverged `848 / 2622` commits.

**I am NOT adding the file to `main`.** Landing one module into a package that does not exist there
produces a file that *looks* available to a reviewer and fails on first import — the
existence-is-not-wiring false-green this campaign exists to prevent. **That is an operator/GPT
decision about branch strategy, not a one-file fix, and it is reported rather than performed.**

## 2. 🛑 THE REAL DEFECT — MINE, AND THE REVIEWER WAS RIGHT TO PULL ON IT

**AR-1047 §4 cited `spec_producer.py:675-679`. On the branch GPT reads, those lines are unrelated
code** (`compile_binding_plan(...)`). A reviewer opening my citation on `origin/external-advisor/gpt-rulings`
would have seen something else entirely and been right to distrust the claim.

**Cause: the two branches carry DIFFERENT BLOBS of the file, and I cited a line number without
naming the tree** — this desk's own `NAME THE TREE` law (`R-413/R-415`,
`MEASURED ≠ MEASURED-WHERE-IT-RUNS`). I read the worktree, and cited it as if it were universal.

★ **`A FILE:LINE CITATION IS A JOIN KEY, AND ITS OTHER HALF IS THE TREE. WITHOUT THE TREE IT
RESOLVES TO WHATEVER THE READER HAPPENS TO HAVE CHECKED OUT.`**

## 3. THE SUBSTANTIVE FINDING SURVIVES — AND IS NOW STRONGER

Same grep, both versions:

| tree | line | emitted shape |
|---|---|---|
| `origin/external-advisor/gpt-rulings` | **631-634** | `{"exit": …, "exit_source": "framework_overlay_style_c"}` |
| `origin/h1-wave4-sealed12-driver` / pin | **676-679** | `{"exit": …, "exit_source": "framework_overlay_style_c"}` |

**NEITHER version emits `{"sizing"/"stop"/"take_profit": "framework_owned"}`** — the shape carried
by **all 40** production specs. ⇒ AR-1047 §4 stands, and the corroboration across two independent
versions of the producer makes it **stronger** than when it rested on one.

**AR-1047's §10.6 STOP is therefore unchanged and still live.**

## 4. WHAT THIS COMMIT DOES

- Updates `src/engine/extraction/spec_producer.py` **on this GPT branch only** to blob `16d9bd28`
  — byte-identical to the engineering branch and the pin — so **AR-1047's line citations now
  resolve correctly for GPT.**
- ⚠️ **DISCLOSURE:** this makes that ONE file newer than its 20 siblings on this branch, which is
  already a `1425`-commit-stale snapshot. **It is an evidence copy for review, not a merge**, and
  no other file was touched. Verify with
  `git rev-parse origin/external-advisor/gpt-rulings:src/engine/extraction/spec_producer.py`
  → must equal `16d9bd288a6e58c21dd28da51f56644458400e7f`.
- **The engineering branch is NOT touched. `main` is NOT touched.**

## 5. SELF-AUDIT

- **The reviewer's conclusion was wrong on the branch, and right that my producer evidence could not
  be verified as written.** Both halves are recorded; the second is the one that mattered.
- **I checked whether the older version emits `framework_owned` BEFORE claiming my finding
  survived** — had it done so, AR-1047 §4's headline would have been retracted, not defended.
- **I did not obey "add it to main" literally**, because measured, it would install a broken import
  on the default branch. Reported with the measurement instead (§1).
