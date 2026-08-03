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

---

## 1. INTERIM RECEIPT — headline results (committed before the remaining probes)

**All measurements below are MEASURED HERE unless labelled otherwise.**

### 1.1 Blob join keys (the thing I measured IS the thing the claims name)

| File | at `c067a652` | at `HEAD` (`07e7a151`) | in worktree |
|---|---|---|---|
| `src/engine/spec_family_bindings.py` | `bb1d23ca` | `bb1d23ca` | `bb1d23ca` |
| `src/engine/session_windows.py` | `fcfcd2c3` | `fcfcd2c3` | `fcfcd2c3` |

Both clean in `git status --porcelain`. Measurements taken in the live worktree therefore describe the pin.

Three blobs used for the merge, **all verified against their git object ids**:

- `7c9e69a1` — the file at `e460c88d` **AND** at `c067a652^`. F-1 and Lane A share an identical base file.
- `bb1d23ca` — F-1 applied (`c067a652`).
- `2bcfbc76` — Lane A applied. **VERIFIED**: `git apply` of the committed `docs/designs/lane-a-exact-clock-route-2026-08-03.patch` onto `7c9e69a1` produces byte-exactly `2bcfbc760d8b11562224126b5db418c0711abd07`.

`git diff --stat e460c88d c067a652 -- src/` = **only** `spec_family_bindings.py` (+160) and its test file (+125). No other runtime module differs between the two bases.

### 1.2 CLAIM 2 — the combined tree the worker called `[UNMEASURED — STRUCTURALLY]` NOW EXISTS AND IS MEASURED

`git merge-file` over (F-1, base, Lane A) yields **6 conflicts** — reproducing the worker's "6 conflict hunks". All 6 are the overlapping insert of `resolve_exact_clock_span`, which BOTH changes define. I resolved it the two honest ways and built both.

Population: the 16 `shakedown_specs/*.spec.json`, **161 taught conditions** (independently counted). Run mode: **direct harness driving `run_leg_a_phase1`, NOT pytest.** Flags at default (`TF_SESSION_ROLE_RESOLVER_ENABLED` unset, `TF_FAMILY_META_ENFORCED` unset).

| arm | module blob | rows | PASS | description |
|---|---|---|---|---|
| A0_base | `7c9e69a1` | 161 | **0** | neither change |
| A_F1only | `bb1d23ca` | 161 | **0** | `c067a652` (F-1 only) |
| B_laneAonly | `2bcfbc76` | 161 | **1** | base + committed Lane A patch — **the worker's arm** |
| C_both_F1parser | `321021ed` | 161 | **1** | **F-1 + Lane A**, keeping F-1's tier1-OR-tier2 parser |
| D_both_laneAparser | `6891429e` | 161 | **1** | **F-1 + Lane A**, keeping Lane A's tier1-ONLY parser |

Row-level diff, **join key = (spec_file, condition_id)**, union = 161 keys, every arm carries all 161:

- `A0_base → A_F1only` : **0 rows move** (F-1 alone moves nothing on this population)
- `A_F1only → B_laneAonly` : **1 row moves** — the subject row, `BLOCK/['ii']` → `PASS/[]`
- `A_F1only → C_both_F1parser` : **1 row moves** — the same row
- `B_laneAonly → C_both_F1parser` : **0 rows move**
- `C_both_F1parser → D_both_laneAparser` : **0 rows move**

Subject row in every Lane-A-bearing arm: `bindable=True, approximation=False, executed=True, fail_codes=[], row_verdict=PASS`, `primitive='src.engine.indicators.core.compute_opening_range_breakout'`, `session_zone=None`.

**ANSWER TO THE OPEN QUESTION: the PASS SURVIVES in a tree containing BOTH F-1 and Lane A, under BOTH conflict resolutions, and adding F-1 to the Lane A tree moves ZERO of the 161 rows.**

**MECHANISM (measured, not reasoned):** the row's object text is

> `"marking out the top and the bottom of that range from 9:30 to 9:45. That's the first 15 minutes of the New York Stock Exchange open, and that is my trading range for this trading session"`

- `resolve_session_keyword(obj)` = **None** → the row never takes the keyword route → **F-1's fidelity term never fires on it.**
- TIER-1 market context IS present (`New York Stock Exchange`, span 103–126) → F-1's tier1-OR-tier2 parser and Lane A's tier1-only parser return the **same** span `(570, 585)`. The one declared difference between the parsers is immaterial to this row.

### 1.3 ROW pass != SPEC pass — CONFIRMED

`automated_verdict = BLOCK` for **all 16 specs in all 5 arms**, sole leg-level failure code `vi_cert`. `kFyD3H6I1I8__s0` carries 20 rows, of which 1 passes. Nothing here is a spec-level or Phase-1 pass.

### 1.4 The `172` denominator — PARTIALLY UNVERIFIED

`161` from 16 files: **CONFIRMED** (per-file counts recorded). The `+11 golden-slice rows`: **I could not reproduce them.** Sweeping every JSON under `docs/` through `_spec_body` + `_taught_conditions`, **exactly one** artifact yields 11 taught conditions — `shakedown_specs/CLDEIsNpVRc__s0.spec.json`, which is already inside the 161. No `st5e-YJRfKc*` artifact in this tree yields any taught conditions (all return 0). So `172` is not reconstructible here; `161` is.

### 1.5 CLAIM 1 — headline

- **Target 4 (is the comparison real?) — CONFIRMED, by interception.** Replacing `session_windows.is_in_killzone` with a liar evaluating `[500,505)` made `_derive_session_zone_window_by_execution("ny_am")` return `((500,505),)` while the local mirror `_REAL_ZONE_INTERVALS["ny_am"]` stayed `((420,600),)`. It genuinely EXECUTES the primitive; it does not restate the constant.
- **Target 3 (fail-closed) — CONFIRMED at every reachable boundary**: broken import, raising primitive, `_to_et_minutes_of_day` returning None, unknown/None/empty zone, unparseable clock, 3 clock tokens, reversed span — **all resolve to `approximation=True`**.
- **Target 2 (corpus impact `0`) — CONFIRMED** by an independent shape-agnostic walk with live positive controls (details in §2).
- **Target 1 (tier-2 asymmetry) — the safety argument is REFUTED** (details in §2).

