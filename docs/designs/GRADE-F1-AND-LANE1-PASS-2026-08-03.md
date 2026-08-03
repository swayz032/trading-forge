# GRADE — F-1 fidelity term + Lane A `row_verdict=PASS` (2026-08-03)

**Grader:** accuracy-validator (independent; doer != grader). Neither the worker nor the advisor desk may certify this.
**Status:** START RECEIPT — seated. Findings appended below as they are produced.

---

## 0. START RECEIPT (written and committed BEFORE any analysis)

### 0.1 Seat + tree

| Field | Value |
|---|---|
| Tree | `C:/Users/tonio/Projects/wt-h1-wave4-20260712` |
| `git rev-parse --git-common-dir` | `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` (**linked worktree**, not a standalone repo — law 10) |
| Branch | `h1-wave4-sealed12-driver` |
| HEAD at seating | `07e7a1511029a1cd7b5c6dc0dfc1387f3120498b` (`AR-719: R-664 s7 both lanes ...`) |
| Shared tree | YES — a LIVE worker is in it, ~90 unrelated dirty paths. `git commit -o <path>` ONLY. No `git add -A`, no `checkout`, no `reset`, no amend of commits I did not author. |

### 0.2 Pins (all verified to exist as commit objects via `git cat-file -t`)

| Pin | Type | Role |
|---|---|---|
| `c067a652` | commit | CLAIM 1 subject — "F-1 (R-662 s7): give the exactness decision a FIDELITY TERM." **Confirmed ancestor of HEAD** (`git merge-base --is-ancestor c067a652 HEAD` → true) |
| `61be9fa7` | commit | RED arm (tests committed red before the fix) |
| `e460c88d` | commit | the base the worker actually applied the Lane A patch at |

**HEAD HAS MOVED past the pin.** My verdict names the pinned hashes, not HEAD. Every subject blob will be checked identical at pin and at the tree I measure in.

### 0.3 Claims under grade (verbatim)

- **CLAIM 1:** "`approximation=False` is granted iff the parsed taught span equals the window `is_in_killzone` is observed to evaluate; corpus impact `0`."
- **CLAIM 2:** "With the Lane A patch applied, the row `kFyD3H6I1I8__s0 | WAIT_SESSION:marking-out-the-top-and-the-bottom-of-th#6` reaches `row_verdict=PASS` with `bindable=True, approximation=False, fail_codes=[]`; exactly 1 PASS row in a 172-row population, 0 without the patch, and exactly 1 row moves."

### 0.4 Planned non-overlapping paths (pre-registered before measuring)

**CLAIM 1**
- P1-A: read the executable lines of the fidelity term at `c067a652` via `git show` (not the worktree) — AST + line-level, deriving the truth table of the gate myself.
- P1-B: EXECUTE the pinned module out of an object-DB-backed scratch checkout and drive it with fixtures I author, including the adversarial APPROXIMATE→EXACT hunt on the TIER-2 conjunct.
- P1-C: re-derive the `0` corpus impact from the corpus files myself with an independently written iterator, with a POSITIVE CONTROL (planted row that MUST move) proving the counter can be non-zero. `A DEFAULT IN A COUNTER IS A FALSE-ZERO GENERATOR.`
- P1-D: fail-closed probe — inject import error / execution raise / unparseable clock / malformed shape and read which side of `approximation` the code lands on.
- P1-E: determine whether `_derive_session_zone_window_by_execution` truly EXECUTES `is_in_killzone` or restates `_REAL_ZONE_INTERVALS` — by intercepting/mutating the real function and checking the derived window follows the mutation (a restated constant will not move).

**CLAIM 2**
- P2-A: reproduce the two arms myself at `e460c88d` ± Lane A patch in a scratch tree, reading `row_verdict`/`bindable`/`approximation`/`fail_codes` off the emitter, not off the worker's report.
- P2-B: enumerate the 172-row population INDEPENDENTLY (file list + row count derived my own way) and reconcile against the claim's `16 files, 161 + 11`.
- P2-C: **the uncovered question** — attempt to construct the tree containing BOTH F-1 and Lane A (`c067a652` + hand-resolved Lane A) and measure whether the PASS survives. If I cannot do this honestly, I will say so plainly; an honest null is a complete answer.
- P2-D: confirm ROW pass != SPEC pass — that `automated_verdict=BLOCK` on `leg_level_failures=['vi_cert']` holds in both arms and that nothing here is a Phase-1 or spec-level pass.

### 0.5 Hazards I am pre-committing to handle

1. **A piped exit code is the LAST command's.** Every count ships its verbatim command; I will not read a pass count through a pipe without also reading the exit status of the producer.
2. **No-`.git` scratch trees report `329 passed, 10 skipped` EXIT 0.** Every filtered run reconciles SELECTED vs ACCOUNTED.
3. **Cross-file env pollution** via `TF_SESSION_ROLE_RESOLVER_ENABLED` set outside `monkeypatch` at `test_compile_fidelity_leg_a.py:471` and `test_session_role_adversarial_fence.py:823,858`. **I will state run mode (single-file vs multi-file) for every count.**
4. Windows-form paths (`C:/...`) for Python; MSYS `/c/...` exits 4.
5. `git grep --include=` is FATAL and manufactures nulls; `dir/**/*.py` misses top-level files. Own-memory hazards — surface counts get sanity-checked.

### 0.6 Clean-room declaration (opening position)

- I have NOT read the worker's grade/report artifacts. An untracked file `docs/designs/GRADE-F1-FIDELITY-TERM-2026-08-03.md` (3915 bytes, **untracked — no git log entry**) exists in this tree; the brief states the prior dispatch of this grade "died before writing anything", which that file's existence contradicts. I will record its provenance and declare any contact with it.
- **Lineage declaration:** my own agent lineage has previously graded adjacent F-1 material in this campaign (session-window representability, 2026-08-03) and raised the very defect this commit repairs. That is declared, not hidden. Where a finding of mine is a widening of my own prior finding, I will say so.

---

*(findings follow — this file is committed incrementally)*
