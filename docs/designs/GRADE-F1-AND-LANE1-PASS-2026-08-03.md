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


---

## 2. FINDINGS

### F-1 (HIGH, OPEN) — the stated reason for the TIER-2 widening is REFUTED at the executable line, and it opens a NO-BIND -> BIND path in the combined tree

**Claim under test** (`spec_family_bindings.py` conjunct (4) note, and the commit message verbatim):

> "Conjunct (3) already requires both numerals to be governed by a span preposition, which is this module's own stated condition for admitting tier 2."

**REFUTED — MEASURED HERE.** Conjunct (3) is `len(_SESSION_CLOCK_SPAN_PREP_RE.findall(text)) < 2`. That regex is

```
\b(from|until|till|through|between|starting|after|before|by|to)\s+(?:the\s+)?\d{1,2}(?::[0-5]\d)?(?:\s*(?:a\.?m\.?|p\.?m\.?))?(?![\d:])
```

Colon and meridiem are BOTH optional, so it matches a preposition followed by any bare 1-2 digit integer, **anywhere in the text, with no linkage whatsoever to the two clock tokens the parser actually used**. Measured:

| text | prep hits |
|---|---|
| `'from 9:30 a.m. to 10:00 a.m.'` | `['from','to']` |
| `'wait after 5 bars, before 20 ema'` | `['after','before']` |
| `'close after 3 candles and take profit by 2 R'` | `['after','by']` |

The module's own tier-2 docstring states the intended condition as *"a tier-2 marker now counts only when the CLOCK TOKEN is additionally GOVERNED by a span/selection preposition"*. The code implements a strictly weaker, decoupled condition: *"the text contains >=2 preposition+numeral pairs"*.

**The consequence, MEASURED in the combined tree** (`h1_link_test.py`, arms C and D). Fixture — teaches NO session span; two swing-reference points, and the two prepositions are supplied by *risk* numerals:

```
"size to 2 percent and trail by 3 R. the 7:00 a.m. swing and the 10:00 a.m. swing
 are my reference points, eastern"
```

| arm | parsed span | bindable | approximation | row_verdict |
|---|---|---|---|---|
| **C** (F-1 + Lane A, **F-1's tier1-OR-tier2 parser kept**) | `(420, 600)` | **True** | **False** | **PASS** |
| **D** (F-1 + Lane A, Lane A's tier1-ONLY parser kept) | `None` | False | — | BLOCK `['ii']` |

That is a **NO-BIND -> BIND with `approximation=False`**, on the Lane A route, created solely by the tier-2 widening — i.e. precisely the risk the commit argues is *"inverted"*:

> "Lane A converts NO-BIND -> BIND, where a false span invents a confident bind; **this route** only ever converts EXACT -> APPROXIMATE ... so the risk asymmetry is inverted"

The asymmetry argument is sound **for the keyword route in isolation** (section 3.1 proves it). It does not hold for the function, which the same commit declares will become the single shared parser: *"When Lane A lands there is ONE parser here, not two."*

- **Tier-2's real reach, measured:** `_SESSION_CLOCK_TZ_CONTEXT_RE`'s `a\.m\.\b` / `p\.m\.\b` alternatives **never match a trailing "a.m. "** (the `\b` after a literal `.` fails before a space). So tier-2 in practice fires on the bare timezone words `eastern|est|edt` and bare `am|pm`. This is the exact class the module's own M1 FIX docstring records as having produced a false bind (*"'eastern time' is ordinary English scheduling vocabulary"*). The narrowing added to contain it is the conjunct that does not do what it says.
- **Not guarded:** the five F-1 tests at `c067a652` are `test_f1_taught_span_narrower_...`, `..._equal_to_bound_window_...`, `..._unparseable_clock_...`, `..._adjacent_window_off_by_one_minute_...`, `..._name_only_row_is_untouched_...`. Every fixture in all five is a text where the two clock tokens ARE the span. **None exercises a fabricated span.**
- **FAIRNESS — the widening is LOAD-BEARING, not gratuitous.** MEASURED: all three green-arm fixtures (`"the london session from 2:00 a.m. to 5:00 a.m. Eastern"` etc.) carry `tier1=False, tier2=True`. Under tier-1-only they parse to `None` and the green arm of the F-1 tests becomes unreachable. The worker's "refuse everything" argument is **correct**. The defect is not the widening — it is conjunct (3) failing to bind the prepositions to the clock tokens.

**Fix point:** `src/engine/spec_family_bindings.py` — `_SESSION_CLOCK_SPAN_PREP_RE` / conjunct (3) in `resolve_exact_clock_span`. The test must be POSITIONAL: each of the TWO clock tokens must itself be governed by a span preposition, not "the text contains two prepositions somewhere".

**Repro:**

```
python <S>/h1_link_test.py <S>/trees/C_both_F1parser
python <S>/h1_link_test.py <S>/trees/D_both_laneAparser
```

**Blast radius:** LATENT at `c067a652` — section 3.4 measures **zero** corpus rows reaching the keyword route, and Lane A has not landed. It becomes LIVE the moment Lane A lands with F-1's parser kept, which is the resolution the commit message announces.

### F-2 (MEDIUM) — Lane A's honesty comparison has a path to red against the PRIMITIVE but is a TAUTOLOGY against the PARSE

Lane A derives the probe's arguments **from the parsed span itself** and then compares the probe's answer to that same span:

```python
_derived = _derive_exact_clock_primitive_window(_end - _start, f"{_start//60:02d}:{_start%60:02d}")
if _derived is not None and _derived == (_start, _end):   # grant approximation=False
```

**MEASURED HERE:** swept 1946 spans (206 start minutes x 10 durations across the whole day):

- `derived == parsed span`: **1946**
- `derived != parsed span`: **0**
- `derived is None`: **0**

**POSITIVE CONTROL (the guard is NOT vacuous):** tampering `compute_opening_range_breakout` to aggregate 5 minutes more than asked makes `_derive(15,'09:30')` return `(570,590)`, and the route then **refuses** — subject row `PASS -> BLOCK`, `fail_codes=['ii']`, PASS rows in that spec `1 -> 0`; restoring returns it to PASS. So the comparison is a live check that the PRIMITIVE honours its declared window.

**But it is not, and cannot be, a check on the READING OF THE SOURCE.** All fidelity of Lane A's `approximation=False` rests on `resolve_exact_clock_span` alone — which is exactly the surface F-1 shows can fabricate.

### F-3 (MEDIUM) — the CLAIM's unqualified "iff" is refuted by the code, by the dispatch, and by the repo's own test

**MEASURED HERE through the PUBLIC dispatch** (not the private helper):

```
bind_condition({"id": ..., "type": "WAIT_SESSION", "role": "spine", "object": "ny am session"})
  -> bindable=True, approximation=False, session_zone='ny_am'
```

`approximation=False` is granted with **no span parsed and no comparison performed** (`resolve_exact_clock_span` returns `None`; the term short-circuits on `if not _SESSION_CLOCK_TOKEN_RE.search(...)` and returns `base_approximation`, which is `False`). The executed window for `ny_am` is `((420,600),)` — 180 minutes.

The **code and the commit message are correctly scoped** ("*a row that carries clock teaching* earns exactness IF AND ONLY IF..."). The **claim as handed to this grade dropped that qualifier**, and the dropped scope is exactly where the motivating defect lives — a row that names a session and carries no clock is still certified EXACT against whatever the zone happens to be. `c067a652` additionally **PINS this as correct** in `test_f1_name_only_row_is_untouched_by_the_fidelity_term`. This is a declared, deliberate scope boundary (R-662 stop condition 1, a re-baseline decision reserved for the desk) — the defect is in the CAPTION, not the code. `A CAPTION IS A CLAIM.`

### F-4 (LOW) — the `172` denominator does not reconcile; `161` does

`161` from 16 files: reproduced exactly, per-file. The `+11` golden-slice rows: **not reproducible in this tree.** Every JSON under `docs/` pushed through `_spec_body` + `_taught_conditions` yields exactly ONE artifact with 11 taught conditions — `shakedown_specs/CLDEIsNpVRc__s0.spec.json`, already inside the 161, so counting it would DOUBLE-COUNT. No `st5e-YJRfKc*` artifact in this tree yields any taught conditions.

### F-5 (LOW / informational) — `_REAL_ZONE_INTERVALS` has already drifted from the executed window for `macro_window`

MEASURED: `_derive_session_zone_window_by_execution("macro_window")` = `((153,180),(243,270),(590,610))`; the local mirror `_REAL_ZONE_INTERVALS["macro_window"]` = `((590,610),(153,180),(243,270))` — same members, **different order**, so `derived != mirror`. Harmless today (the term compares against a 1-tuple `(span,)`, which a 3-run zone can never equal, so multi-run zones always fail closed). It is a standing trap for any future "cheaper" substitution of the mirror for the execution probe — which R-660 section 3 forbids and this commit correctly resists.

---

## 3. WHAT WAS CONFIRMED, AND HOW

### 3.1 The asymmetry claim IS true for the keyword route in isolation

`_session_keyword_fidelity_approximation`'s clock-carrying branch returns `derived != (span,)` **ignoring `base_approximation`** — structurally an APPROXIMATE->EXACT upgrade is possible. MEASURED, it cannot happen at this pin:

- Path A (enumeration): `requires_session_keyword=True` on **exactly one** family — `WAIT_SESSION` — with `base_approximation=False, enforced_approximation=None`.
- Path B (execution): `FAMILY_META["WAIT_SESSION"].effective_approximation()` = **False under `TF_FAMILY_META_ENFORCED` both `false` AND `true`**.

So the value entering the term is always `False`, and the term can only hold it or raise it to `True`. **CONFIRMED — but it is a coincidence of one field, not a structural property.** If `WAIT_SESSION` ever gains `enforced_approximation=True` (as `INVALIDATE`/`ENABLE_ENTRY`/`ENTER`/`FILTER` already have in this same file, for exactly the "fidelity lie" reason), the term silently becomes an APPROXIMATE->EXACT upgrader.

### 3.2 The comparison is REAL — proven by interception, not by reading

`session_windows.is_in_killzone` replaced with a liar evaluating `[500,505)`:

| | value |
|---|---|
| `_derive_session_zone_window_by_execution("ny_am")` under intercept | `((500, 505),)` — **followed the mutation** |
| `_derive_session_zone_window_by_execution("london")` under intercept | `((500, 505),)` — followed the mutation |
| `_REAL_ZONE_INTERVALS["ny_am"]` (the local mirror) | `((420, 600),)` — **did not move** |
| after restore | `((420, 600),)` |

A restated constant cannot follow a mutated primitive. **It executes. CONFIRMED.**

Execution-derived windows, all five zones: `london ((120,300),)` · `ny_am ((420,600),)` · `ny_pm ((810,960),)` · `silver_bullet ((180,240),(600,660),(840,900))` · `macro_window ((153,180),(243,270),(590,610))`.

### 3.3 Fail-closed — CONFIRMED at every reachable boundary

| injected fault | `_derive...` | resulting `approximation` |
|---|---|---|
| `session_windows` import broken | `None` | **True** |
| `is_in_killzone` raises | `None` | **True** |
| `_to_et_minutes_of_day` returns `None` | `None` | **True** |
| unknown / `None` / empty zone | `None` | **True** |
| 3 clock tokens | span `None` | **True** |
| reversed span (`10:00 -> 7:00`) | span `None` | **True** |
| clock but no span preposition | span `None` | **True** |

**HONEST NULL on the malformed-shape probe.** Calling the private helper with a non-string `object` raises an uncaught `TypeError` — but this is **NOT reachable** through the dispatch, which coerces at `_bind_condition_dispatch`: `obj = str(condition.get("object", "") or "")`. MEASURED end-to-end: `object` = `int` / `list` / `dict` / `None` all return `bindable=False` with **no raise**, so the documented "Never raises" contract of `_bind_condition_dispatch` holds. **Positive control for this null:** the direct helper call DOES raise, proving my detector can fire.

### 3.4 Corpus impact `0` — CONFIRMED by an independent, shape-agnostic path

Deliberately NOT the worker's method: a recursive walker that assumes no nesting depth and no key path (`.spec.entry_conditions`, `strategies`, etc.), plus an **in-memory A/B** binding every condition twice through the PUBLIC `bind_condition` — arm PRE with `_session_keyword_fidelity_approximation` neutralised to `return base_approximation`, arm POST shipped — diffing every field of the `ConditionBinding`.

**POSITIVE CONTROLS RUN BEFORE THE CENSUS EMITS** (`A DEFAULT IN A COUNTER IS A FALSE-ZERO GENERATOR`):

| control | expected to move | observed |
|---|---|---|
| clock taught, span != window (`9:30-9:35` on `ny_am`) | YES | **moved**, `False -> True` |
| clock taught, 3 tokens | YES | **moved**, `False -> True` |
| no clock (`"ny am session"`) | no | did not move |
| clock taught, span == window | no | did not move |

Census (flag OFF = the route the term lives on):

| measure | value |
|---|---|
| JSON files under `docs/` | **1077** (parse failures **0**) |
| dicts visited | 439,132 |
| condition-shaped dicts | **15,464** |
| distinct `object` strings | **2130** (worker said 2,129) |
| **distinct objects resolving to a session ZONE** | **0** |
| ...of those also carrying a clock token (term fires) | **0** |
| **condition dicts whose BINDING MOVES under F-1** | **0** |
| `WAIT_SESSION` condition dicts | 2784 — of which **0** bind by session keyword |

**BOUNDARY (a boundary is proven by what it excludes):** widened to a tree-wide sweep — **1343 JSON files tree-wide, 25,514 condition-shaped dicts, 0 session-keyword hits**; 2 parse failures, both named and both non-corpus (`tests/python/golden/quantum_mc_breach.json`, non-UTF-8; `Trading_forge_frontend/amber-vision-main/tsconfig.node.json`, JSONC comments). **POSITIVE CONTROL for the tree-wide sweep:** the same walker over an in-memory planted fixture returns exactly **1** hit.

**The zero is bigger than "nothing changed": ZERO of 2784 `WAIT_SESSION` conditions bind by session keyword at all.** The repaired route carries **no corpus traffic**. `corpus impact 0` is therefore TRUE and, at this pin, *could not have been otherwise* — it measures an unexercised path, not a conservative term. The worker disclosed this in its own commit message ("0 bind by session keyword at all"); my independent count agrees.

**Flag arms:** with `TF_SESSION_ROLE_RESOLVER_ENABLED=true` the fidelity term is **called 0 times** (instrumented call counter) — the name route runs instead and the same fixture is REFUSED (`bindable=False`). With the flag unset/`false`, 1 call. The term is a flag-OFF-only surface.

### 3.5 CLAIM 2 — path to red for the arm harness

The SAME harness reports `PASS=0` (arms A0/A) and `PASS=1` (arms B/C/D), and tampering the ORB primitive inside arm C drives the subject row `PASS -> BLOCK` and back. The harness discriminates in both directions.

---

## 4. VERDICTS

### CLAIM 1 — **PARTIALLY CONFIRMED**

| component | verdict |
|---|---|
| the mechanism EXECUTES the primitive and does not restate a constant | **CONFIRMED** (interception, 3.2) |
| fails closed on import/execution/parse/shape faults | **CONFIRMED** (3.3) |
| within the clock-carrying scope, exactness is earned only on span == executed window | **CONFIRMED** |
| the route only ever converts EXACT -> APPROXIMATE | **CONFIRMED at this pin**, by coincidence of one field, not structurally (3.1) |
| `corpus impact 0` | **CONFIRMED** independently, with positive controls — and vacuous, because 0 rows reach the route (3.4) |
| the unqualified **"iff"** | **REFUTED** — `approximation=False` is still granted by membership to every no-clock row (F-3) |
| the stated safety reason for the TIER-2 widening | **REFUTED** at the executable line, with a measured NO-BIND -> BIND consequence in the combined tree (F-1) |

### CLAIM 2 — **CONFIRMED** (one component unverified)

| component | verdict |
|---|---|
| the named row reaches `row_verdict=PASS` with `bindable=True, approximation=False, fail_codes=[]` | **CONFIRMED** — in 3 independent arms |
| `0` PASS without the patch | **CONFIRMED** — at BOTH bases (`7c9e69a1` and `bb1d23ca`) |
| exactly **1** row moves | **CONFIRMED** — full 161-key join; `A_F1only -> B_laneAonly` = 1, and that row is the subject |
| population `172` | **PARTIALLY VERIFIED** — `161` reproduced exactly; `+11` not reproducible (F-4) |
| ROW pass != SPEC pass; `automated_verdict=BLOCK` on `['vi_cert']` | **CONFIRMED** — all 16 specs, all 5 arms |
| the substitution's residue (`[UNMEASURED — STRUCTURALLY]`) | **NOW MEASURED: the PASS survives with F-1 present, under BOTH conflict resolutions; 0 of 161 rows move when F-1 is added to the Lane A tree** |

### BAND

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| F-1 fidelity term @ `c067a652` | **7** | **VERIFIED** | executed-not-restated proven by interception; fail-closed at 7 injected faults; corpus 0 re-derived shape-agnostically with 4 positive controls + a tree-wide boundary sweep; 5 tests with a real red arm | F-1 fabricated-span class unguarded by any test; F-3 caption overstates scope; route has ZERO corpus traffic so the repair is unexercised; 3.1 asymmetry is one field away from inverting |
| Lane A `row_verdict=PASS` demonstration | **8** | **VERIFIED** | reproduced in 5 arms incl. 2 the worker could not build; 161-key row-level join; harness red-proofed both directions; patch post-image verified byte-exact against blob `2bcfbc76` | F-4 `172` denominator unreconciled; F-2 the honesty comparison cannot discriminate a wrong parse |

**Basis.** Both sit in the rubric's `7-8` band — *adversarially tested with residual risks documented* — which is the realistic ceiling for a maintained production system. Neither reaches 9: there are open HIGH/MEDIUM findings with concrete repros, and no independent re-scan beyond mine. F-1 is held to 7 rather than 8 by an unguarded false-EXACT/false-BIND class plus a caption that overstates the guarantee. The Lane A demonstration earns 8 because every load-bearing component reproduced exactly through an independently constructed instrument, and the worker's one declared gap — which it correctly refused to reason past — closes in its favour.

**CLAIMED vs VERIFIED reconciliation:** no band was claimed by the worker for either item (the worker declined to self-certify, which is correct). The worker's *factual* claims reconcile with mine everywhere except the two caption defects (F-3, F-4) and one refuted mechanism claim (F-1). Notably the worker's own commit message discloses the vacuity of its `0` ("0 bind by session keyword at all") and declares the tier-2 difference rather than folding it in silently — both are marks in its favour.

---

## 5. MANDATORY COVERAGE — WHAT I DID **NOT** VERIFY

1. **The `339 passed` suite count and the RED arm at `61be9fa7`.** Desk-confirmed and out of scope for me. **I did not run pytest at all, in any tree.** Every count in this receipt comes from a direct harness. The KNOWN HAZARD (`329 passed, 10 skipped, EXIT 0` in a tree without `.git`) therefore never applied to me, and I make no claim about it.
2. **The `+11` golden-slice rows.** Not located; the `172` denominator is unverified (F-4). My prior grade of the golden slice found 11 rows and 0 PASS, but that is my **own lineage, RELAYED**, not measured here.
3. **The two combined arms (C, D) are MY constructions**, not artifacts anyone has ratified. Their module blobs are `321021ed` / `6891429e` and the build script is auditable, but which conflict resolution the desk will actually adopt is not mine to decide. If the desk resolves differently from both, my Claim-2 residue answer does not automatically transfer.
4. **No database, no `audit_log`, no SSE, no broker, no correlation_id trace, no bar data, no backtest, no P&L.** Nothing on the money path was touched; no first-principles P&L recomputation was owed or performed.
5. **Phase 2 / `countersign_phase2`** — not exercised. I confirmed `vi_cert` blocks at leg level; I did not test what happens when a certificate IS supplied.
6. **`TF_FAMILY_META_ENFORCED=true` over the full population.** I measured `effective_approximation()` under both flag values for `WAIT_SESSION` only; I did not re-run the 161-row population under enforcement.
7. **The condition dicts outside `docs/`** were counted for the session-keyword sweep but not A/B bound.
8. **Whether Lane A will land at all**, and therefore whether the F-1 residual becomes live, is a HYPOTHESIS about a future decision. F-1's blast radius is LATENT today; I measured the mechanism, not the roadmap.
9. **`resolve_session_keyword`'s own correctness.** I used it as an oracle for "does this row reach the keyword route". If IT is broken, my `0` inherits the break — though the planted positive controls do prove it returns a zone for texts that carry the keywords.
10. **I did not re-derive the desk's byte-identity finding** (instructed not to). It nonetheless fell out as a free join key: `compile_fidelity.py` = `d8eee0e6` at `c067a652`, at `e460c88d`, and in the worktree.

## 6. CLEAN-ROOM DECLARATION

- **I did not read the worker's report or grade artifacts.** I read the commit message of `c067a652` (part of the artifact under grade), the committed `.patch` file, the module source, and the test source. Every number in this receipt was produced by instruments I wrote in this session.
- **I did read 12 header lines** of the untracked `docs/designs/GRADE-F1-FIDELITY-TERM-2026-08-03.md` to establish its provenance. It is a **start-receipt from a prior dispatch of my own agent type** and contains **no findings** — its own text says *"This file will be OVERWRITTEN with findings; if it still says START-RECEIPT, the grade did not finish."* It still says START-RECEIPT, and it is untracked, so the prior dispatch never committed it. (The brief said the prior dispatch wrote "nothing"; more precisely it wrote an uncommitted start-receipt.)
- **LINEAGE DECLARED:** my own agent lineage graded adjacent F-1 material earlier the same day (`session-window-representability-grade-2026-08-03`) and raised the defect `c067a652` repairs. F-3 in this receipt is a re-measurement of that same finding at a new pin. That is a lineage overlap, declared, not hidden — but every number here is re-derived from current artifacts; no prior score or prior "fixed" claim was carried forward.
- **HEAD MOVED TWICE during this grade** (`07e7a151` -> `b103e056`). All subject blobs were re-verified identical to the pin at the END of the run: `spec_family_bindings.py` `bb1d23ca`, `session_windows.py` `fcfcd2c3`, `compile_fidelity.py` `d8eee0e6`; the 16 spec data files clean in `git status --porcelain`.
- **Instrument fault I caught in myself (1):** my first zone census iterated `SESSION_KEYWORDS.values()` when the dict is `{zone: (keywords...)}`, producing five `None` derivations that would have read as "the primitive is unrunnable for every zone". Caught because `_REAL_ZONE_INTERVALS` showed real windows for the same keys. Corrected before any conclusion was drawn.
- **Instrument fault I caught in myself (2):** my tree-wide sweep printed `under docs/ = 0` because `pathlib` normalises away the `./` prefix I was matching on. Cosmetic label only — the census walked all 1343 files; the `docs/`-only count of 1077 was measured separately.
- **Instrument fault I caught in myself (3):** a `git apply` invocation with no patch argument hung for 2 minutes waiting on stdin. It produced no measurement and was replaced.

## 7. COMMANDS — VERBATIM, WITH POPULATION AND RUN MODE

Run mode for **every** count in this receipt: **direct Python harness, Python 3.13.0, `C:\Program Files\Python313\python.exe`, Windows-form paths. NOT pytest.** No test collection, so no skip accounting applies. Flags at OS default (`TF_SESSION_ROLE_RESOLVER_ENABLED` and `TF_FAMILY_META_ENFORCED` both explicitly `os.environ.pop`-ed) unless a probe states otherwise.

Scratchpad root `<S>` = `C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/c986268d-575c-4961-a07f-244339c698a7/scratchpad`

| # | command | population |
|---|---|---|
| 1 | `git rev-parse --git-common-dir` ; `git merge-base --is-ancestor c067a652 HEAD` | the tree |
| 2 | `git cat-file -t 7c9e69a1` / `bb1d23ca` / `2bcfbc76` | 3 blobs |
| 3 | `git apply -v laneA.patch` onto a copy of blob `7c9e69a1`, then `git hash-object` | 1 file — post-image = `2bcfbc760d8b11562224126b5db418c0711abd07` |
| 4 | `git merge-file -L ... merged_raw.py base.py theirs_laneA.py` | exit **6** = 6 conflicts |
| 5 | `python <S>/h1_probe1.py` | FAMILY_META, all families |
| 6 | `python <S>/h1_probe2.py` | 5 zones; 6 fault injections; 9 fixtures; 4 malformed shapes |
| 7 | `python <S>/h1_probe3.py` | 10 adversarial texts x 2 parser variants |
| 8 | `python <S>/h1_probe4.py` | 5 object shapes through the full dispatch |
| 9 | `python <S>/h1_corpus.py` | **1077 JSON, 15,464 condition dicts, 2130 distinct objects** + 4 positive controls |
| 10 | `python <S>/h1_widen.py` | **1343 JSON tree-wide, 25,514 condition dicts** + planted control + 2 flag arms |
| 11 | `python <S>/h1_claim2_pop.py` | **16 spec files -> 161 taught conditions** |
| 12 | `python <S>/arm_runner.py <S>/trees/<arm> <S>/out/<arm>.json` x5 | **161 rows per arm**, 5 arms |
| 13 | `python <S>/compare_arms.py` | 161-key join across 5 arms |
| 14 | `python <S>/h1_laneA_redpath.py` | **1946 spans** + tamper control + route red-proof |
| 15 | `python <S>/h1_link_test.py <S>/trees/C_both_F1parser` and `.../D_both_laneAparser` | 5 fixtures x 2 combined arms |

Exit codes were read directly (`echo "..._EXIT=$?"`) on every run; where a pipe was used the masking is stated inline. No count in this receipt was read through an unchecked pipe.
