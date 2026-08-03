# GRADE — EVENT-MASK POLARITY REPAIR (R-623 §7.1 / §7.2, AR-666 / AR-667)

**Date:** 2026-08-03 · **Mode:** GRADE + adversarial HUNT, briefed to REFUTE
**Agent:** `accuracy-validator`, dispatched by the desk (doer ≠ grader; the desk ordered this work and therefore cannot grade it).

---

## GRADER IDENTITY & LINEAGE DECLARATION

**Independence:** I did not author, design, or implement `28a95a9a` (the engine fix) or `98dfa126` (the fixture revival). I wrote no line of `backtester.py`, `signals.py`, or `test_entry_windows.py`.

🛑 **LINEAGE — REQUIRED DISCLOSURE.** I previously graded **the defect this work repairs**, at
`docs/designs/GRADE-POLARITY-STARVATION-2026-08-03.md` (Claim 1, band 6/10, pins `4776093f`/`5154ab9a`).
That grade measured the **pre-fix** blob `177ec9e1` — which is byte-identical to `28a95a9a^:src/engine/backtester.py`, the base arm of this grade. **Same lineage.** Per my charter every band below is **re-derived from current artifacts only**; I reused no prior score. Where the prior receipt is relevant I re-measured it here from scratch (see §C1) and cite the prior only as `CORROBORATED`, never as authority.

**Tree (law 10 — a result must name its tree):** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, a **linked worktree**; `git rev-parse --git-common-dir` = `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`; branch `h1-wave4-sealed12-driver`. Every finding is from THIS tree. I did **not** read `runtime-production` (brief prohibition) and did **not** read the sibling tree `wt-eventmask-fix-20260803`, which exists and is named for this same fix.

---

## PINS, AND THE HEAD THAT MOVED

| | value |
|---|---|
| HEAD at grade start | `b2025c4b1d09ad4db0890abb299627192c0a82ec` |
| **HEAD at grade end** | **`4ac0a7249ebc256117a065dfefd8ccd071b44808`** 🛑 **moved mid-grade — 17 new commits from a live worker** |
| Engine fix pin | `28a95a9a` (`git cat-file -t` = commit) ✅ ancestor of HEAD |
| Fixture pin | `98dfa126` (`git cat-file -t` = commit) ✅ ancestor of HEAD |

`[MEASURED HERE]` **Blob identity across the pins — this is the join key for every claim below:**

| path | `28a95a9a` | `98dfa126` | HEAD start `b2025c4b` | **HEAD end `4ac0a724`** |
|---|---|---|---|---|
| `src/engine/backtester.py` | `e04c9ab8` | `e04c9ab8` | `e04c9ab8` | **`e04c9ab8` — UNCHANGED** |
| `src/engine/signals.py` | `ad4cd1b9` | `ad4cd1b9` | `ad4cd1b9` | **`ad4cd1b9` — UNCHANGED** |
| `src/engine/tests/test_entry_windows.py` | `97d8a82e` | `9be5ccd9` | `9be5ccd9` | 🛑 **`ee734299` — CHANGED under me** |

**Scope of this verdict:** every claim is graded **at its pin** (`98dfa126` fixture blob `9be5ccd9`), as briefed. Because `backtester.py` and `signals.py` are byte-identical at the pin *and* at end-HEAD, all engine findings hold at both. The fixture findings are re-measured at end-HEAD separately and reported as such (§F-B, §F-C).

🛑 **Why the fixture moved:** a **sibling grader lane** independently found the same swallow-stub vacuity I was measuring (their **F-2**), and the worker closed it at `4b6892a8` / `4ac0a724` *while this grade was running*. My positive control was built and executed before I saw those commits; it therefore functions as an **independent second path** on their finding and on their fix. I flag this explicitly because a grade that silently absorbs another lane's conclusion is not a second path.

**Isolation proof.** The campaign tree was **read-only except this receipt**. All mutation arms ran from object-DB materialisation (`git archive <commit> src pyproject.toml`) into
`…\scratchpad\emgrade\{base,fixed,head,etrevert,utcrevert,head_etrevert}`.
Two-sided sha256, object-DB vs materialised copy:

| arm | `backtester.py` sha256 | source |
|---|---|---|
| `base` | `e3d2db83…5a9e6003` | `28a95a9a^` (pre-fix) |
| `fixed` | `6a95c3a4…b2531af4` | `98dfa126` (post-fix) |

`[MEASURED HERE]` **The "same unchanged fixture" join key**: `test_entry_windows.py` sha256 = `103b2719…50b9ba44` **identical in `base` and `fixed`**. `signals.py` sha256 = `c428b26d…113c09e70` identical in both. File counts 2140 == 2140. Single-variable comparison proven, not asserted.

`[MEASURED HERE]` **Tree integrity at end:** `git status --porcelain -- backtester.py signals.py test_entry_windows.py` → **empty** (all three pristine vs HEAD). I ran no checkout/reset/stash/clean/commit and no index operation. `.pytest_cache` mtime `2026-07-12` = pre-existing, and gitignored; `__pycache__` dirs are gitignored (`.gitignore:8`). All campaign-tree pytest runs used `PYTHONDONTWRITEBYTECODE=1 -p no:cacheprovider`.

---

## VERDICT TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **C1** — polarity inverted; "100% of entry signals ANDed away" | **6/10** | **MECHANISM VERIFIED · MAGNITUDE REFUTED** | Inversion read at the executable line on both sides + AST-lifted builders fed identical timestamps | "100%" is false in general: **95.83% / 92.31% / 85.71%** by session shape. 100% holds **only** when the data has zero bars in the blackout windows — which is exactly the fixture used |
| **C2** — fix is scoped; both builders fixed | **8/10** | **VERIFIED** | `git show --stat 28a95a9a` = 1 file; `git log … -- signals.py` = zero commits; both builders' 4 polarity lines read in the diff | None found. Strongest claim of the set |
| **C3** — 4 tests genuinely pass, not vacuous | **5/10** | **VERIFIED AS A POINT OBSERVATION · REFUTED AS A STRUCTURAL PROPERTY** | `4 passed` reproduced; stub-marker count **0**; real dicts 63/64 keys | 🛑 **Planted-raise positive control at the pin → 3 of 4 still PASS off the stub.** The repair made the swallow *loud*, not *fatal*. Closed at HEAD by another lane, not by this work |
| **C4** — no assertion weakened, 59→59 | **8/10** | **VERIFIED — and by a stronger instrument than claimed** | Count 59==59 **and** assertion **content byte-identical**, sha256 `0276fb12…` on both sides | Count alone would not have shown this; the content hash does |
| **C5** — `total_trades` 0→1, masked signals 0→10, same fixture | **8/10** | **VERIFIED** | Measured in both arms; fixture sha256 identical; attribution nailed by single-line mutation | Delta is *indirect* (entries survive → window filter can then count them). True, but not the mechanism the phrasing implies |
| **C6** — "NO opt-out … un-disableably" | **4/10** | **SPLIT — gate + zero-producers VERIFIED · "NO opt-out" REFUTED** | Gate/elif/producer census all measured | 🛑 **A working opt-out exists and is documented three lines above the code**: a non-empty `[IGNORE]` policy takes branch 1 and yields a 0/20 mask |

**Auto-downgrade triggers observed:** C1 carries a bare universal quantifier ("100%") contradicted by measurement. C3's "NOT vacuous" was certified from a single clean run with **no path-to-red** — a green with no discriminating fixture behind it.

**Novel-hunt findings beyond the six claims:** **F-A** (CRITICAL — the guard is blind to a re-inversion of the *production* builder; still open at end-HEAD), **F-B** (HIGH — two tests pass on a degenerate `{}`; still open at end-HEAD), **F-D** (HIGH — three suites certify production code they never execute), **F-C** (LOW — undisclosed pre-existing red in the brief's own recipe).

**System band for the repair as a whole: 6/10.** The polarity fix itself is correct, complete, and correctly scoped (that part earns 8). The **certification around it** overclaims twice and the guard it ships has a measured blind spot. Band 9+ is unreachable: the guard does not cover the production builder.

---

## CLAIM-BY-CLAIM

### C1 — polarity inversion, and the "100%"

`[MEASURED HERE]` **Mechanism VERIFIED at the executable line, both sides.**
- Consumer, `signals.py:288-290` (blob `ad4cd1b9`, unchanged since `234f7792`, 2026-07-02):
  ```python
  block = pl.Series("event_block", ~event_mask.astype(bool))
  entry_long  = entry_long  & block
  entry_short = entry_short & block
  ```
  with the docstring at `:275` "**True values block entry signals (SIT_OUT)**".
- Producer, pre-fix: docstring "**True = ALLOW trade**", `mask = _np_ev.ones(...)`, `mask[i] = False` inside the windows. Post-fix: "**True = SIT_OUT**", `zeros`, `mask[i] = True`. The inversion is real and the repair inverts it back.

🛑 **MAGNITUDE REFUTED.** `[MEASURED HERE]` Builders **AST-lifted** (`ast.get_source_segment` → `exec`, not retyped) from both pinned blobs and fed identical `ts_et` series. A bar's entry survives iff `mask` is `False`:

```
scenario                              bars  BASE surv  BASE supp%   FIXED supp%
FULL 24h session (1-min bars)         1440         60     95.83%          4.17%
RTH 09:30-16:00 ET                     390         30     92.31%          7.69%
08:00-15:00 ET                         420         60     85.71%         14.29%
Fixture-shaped: 09:00 & 10:00 ET only   20          0    100.00%          0.00%
```

Surviving bars on BASE, RTH: `['14:00','14:01',…,'14:29']` — **every survivor is inside the FOMC blackout window the mask exists to avoid.** The defect is a *selection inversion*, not plain suppression: the engine traded **only** during macro events.

**"100%" is true in exactly one case — when the data contains no blackout-window bars.** That is precisely the shape of the fixture the desk generalised from (bars at 09:00 and 10:00 ET; note `09:00` is excluded by `(8*60+30) <= t < (9*60+0)`, a half-open boundary). `[CORROBORATED]` my prior receipt measured 76.89% on real `--smoke` data and 92.5% on an independent ET fixture, at this same base blob — a different scenario set reaching the same structural conclusion.

**Note for the record:** the fix's own docstring states this correctly — *"entries were kept ONLY inside the 8:30/14:00 windows and removed everywhere else — a perfect inversion of intent."* **The artifact is more accurate than the claim written about it.** The claim regressed relative to the code it describes.

### C2 — scope · **VERIFIED**

`[MEASURED HERE]`
- `git show --stat 28a95a9a` → `src/engine/backtester.py | 52 ++++---` — **1 file changed, 42 insertions(+), 10 deletions(-)**. Exactly matches the brief's `+42/-10`.
- `git log --oneline 28a95a9a^..HEAD -- src/engine/signals.py` → **empty**. `signals.py`'s last commit is `234f7792` (2026-07-02), a month before this campaign. Blob `ad4cd1b9` identical at all four revs. **signals.py was NOT touched.**
- **BOTH builders fixed** — four polarity lines in the diff: ET `:3941` `zeros` + `:3964` `mask[i] = True`; UTC `:3980` `zeros` + `:3995` `mask[i] = True`.

### C3 — "4 passed and NOT vacuous" · **SPLIT**

`[MEASURED HERE]` The green is real **today**, on three paths:
1. `4 passed in 4.88s` reproduced from the brief's verbatim recipe in the campaign tree.
2. Stub-marker grep in the `-s` run: `grep -c "NOT a measurement"` → **0**. The crash handler never fired.
3. Direct measurement of the helper's return: **63 keys (base) / 64 keys (fixed)**, `"_error" in result` = **False**, `engine_audit` = 9 keys. Not the 2-key stub. The 64th key is **`roll_spread_costs`**, which exists only once a trade is taken — independent corroboration that the fixed arm really traded.

🛑 **But "NOT vacuous" was certified with no path to red.** `[MEASURED HERE]` I built the discriminating fixture the repair never did: monkeypatch `run_backtest`, then invoke **the real four test bodies** imported from the real test module (not retyped).

**At the pin `98dfa126`:**
```
ARM 0  UNPLANTED                    4/4 PASS
ARM 1  PLANTED RAISE -> stub        3/4 PASS   <-- three greens off a crash handler, still
ARM 2  PLANTED {}  (no exception)   2/4 PASS
ARM 3  PLANTED None                 0/4 PASS
```
**ARM 1 = 3/4 PASS.** The repair added a `print` + traceback and **still returned the stub**. Under `-q`, pytest captures stderr and discards it on pass — so the "visible" traceback is invisible in exactly the case that matters. *Making a failure visible is not the same as making it fatal.*

`[MEASURED HERE]` **At end-HEAD `4ac0a724` the raise path is CLOSED**, verified by re-running my **unchanged convicting instrument** (`poscontrol.py`, same file, only the outcome-classifier widened to catch `pytest.fail`'s `BaseException`-derived `Failed`):
```
ARM 1  PLANTED RAISE   0/4 PASS   <-- fixed, independently confirmed
```
Credit belongs to `4b6892a8` (another lane's F-2), **not** to `98dfa126`. C3 as written describes the pin, where the hole was open.

### C4 — "no assertion weakened" · **VERIFIED, by a better instrument**

The brief itself flagged that count ≠ content. `[MEASURED HERE]` I diffed the assertions themselves:
```
old assert-line count: 59      new assert-line count: 59
sha256 old: 0276fb12e24f55438707728dd4758f887874a10bc3f79def752f8a647f75f6a7
sha256 new: 0276fb12e24f55438707728dd4758f887874a10bc3f79def752f8a647f75f6a7
diff  -> IDENTICAL
```
**Byte-identical assertion content.** No threshold loosened, no comparison flipped, no expected value edited, none added or removed. (The line-numbered hashes *do* differ — only because line numbers shifted. Hashing with `grep -n` would have produced a false positive; that is why the content hash is the right join key.) The removed lines are scaffolding + pre-existing ruff import debt, as claimed.

### C5 — trade-level discriminator · **VERIFIED**

`[MEASURED HERE]` Same fixture (sha256 `103b2719…`), single variable:

| arm | keys | `total_trades` | `skipped_outside_window_count` (`["09:45-12:00 ET"]`) |
|---|---|---|---|
| base | 63 | **0** | **0** |
| fixed | 64 | **1** | **10** |

Pytest arms: base `1 failed, 3 passed` → fixed `4 passed`. Both reproduce the claim exactly.

**Attribution — the brief's question, answered.** `[MEASURED HERE]` The base/fixed arms differ in one file, whose diff contains exactly four semantic lines plus docstrings and telemetry. Telemetry cannot move a count. I nailed it further with **single-builder mutation** (§F-A): re-inverting only the UTC builder's two lines at `98dfa126` reproduces the base failure (`1 failed, 3 passed`) with everything else post-fix. **The 0→10 delta is attributable to the polarity lines and nothing else.** Mechanism is indirect but sound: entries survive the event mask → the entry-window filter then has signals to skip and count.

### C6 — "there is NO opt-out … un-disableably" · **SPLIT, and the headline is REFUTED**

**Verified parts.** `[MEASURED HERE]`
- Gate at **`backtester.py:3892`** (desk said "~3899"; the `elif` is at `:3902`), inside `run_backtest` (`def` at `:3625` — the DSL path):
  ```python
  if request.event_calendar and request.event_calendar.policies and "ts_event" in df.columns:
  ...
  elif "ts_event" in df.columns:      # :3902  -> default blackout
  ```
- **Empty policies DO fall through.** `[]` is falsy, so `EventCalendarConfig(policies=[])` fails the first branch and gets the default mask. Confirmed by execution: first-branch `False`.
- **Zero producers** in this tree. Surface enumerated across `.py/.ts/.tsx/.js/.json/.sql` = 10 files. The only assignment sites are `walk_forward.py:376, 1343, 1423, 1450`, all `event_calendar=request.event_calendar` — **pass-throughs, not producers**. Nothing originates a value.
  - **Positive control for that absence** `[MEASURED HERE]`: I planted `event_calendar=EventCalendarConfig(...)` in a `.py` and `{"event_calendar": …}` in a `.json` in a scratch dir; **my pattern caught both**. The instrument can find a producer, so its null is meaningful.
  - **Join-key trap avoided:** `macro.ts:210` matches `event_calendar` but is `from src.data.macro.event_calendar import …` — a **different object** (a macro data module that really exists at `src/data/macro/event_calendar.py`), not the `BacktestRequest` field. `backtest-service.ts:233` is a **type declaration** (`event_calendar?: {`), not a producer. Counting either would have inflated the census.

🛑 **REFUTED — the opt-out exists, works, and is documented three lines above the code.** `[MEASURED HERE]` `backtester.py:3908-3910` says verbatim: *"Callers can disable this by passing event_calendar with an empty policies list and setting event_blackout_default=False (not yet a field — **use EventCalendarConfig with an explicit IGNORE policy to override**)."* `config.py:512` makes `IGNORE` a first-class action: `action: Literal["SIT_OUT","REDUCE","WIDEN","IGNORE"] = "SIT_OUT"`. Executed:

```
(a) GATE at backtester.py:3892
    None                  first-branch=False -> FALLS THROUGH to elif = DEFAULT BLACKOUT
    policies=[]  (empty)  first-branch=False -> FALLS THROUGH to elif = DEFAULT BLACKOUT
    policies=[IGNORE]     first-branch=True  -> explicit calendar path   <-- default blackout NEVER REACHED
    policies=[SIT_OUT]    first-branch=True  -> explicit calendar path

(b) generate_event_mask, 20 bars ALL inside 08:30-09:00 ET
    policies=[IGNORE]     blocked=0/20  -> NO suppression
```
A **non-empty** policy list is truthy regardless of action, so `[IGNORE]` satisfies the gate and skips the default blackout entirely; and `economic_calendar.py:1258` (`if action not in ("SIT_OUT","REDUCE"): continue`) over `mask = np.zeros(...)` guarantees an `IGNORE`-only calendar can never block a bar.

**Honest limit on (b):** on my chosen date `policies=[SIT_OUT]` *also* returned 0/20, because no real FOMC event sits on 2026-01-05 in the static calendar. So (b) alone does not discriminate `IGNORE` from `SIT_OUT`. **The refutation rests on (a)**, which is decisive on its own and independently confirmed by reading `:1258`. I record this rather than let a confounded arm carry weight.

**What survives of C6:** *no caller uses the opt-out* — true, and materially important. But **"there is no opt-out"** is false. The distinction changes the remedy: a **wiring gap** (expose/plumb the existing override) is not a **design defect** (build an override that does not exist).

---

## NOVEL HUNT — findings NOT in the six claims

### Discrepancy F-A: the revived guard is BLIND to a re-inversion of the **production** builder
**Severity:** CRITICAL (false green — the guard cannot fail for the defect it certifies)
**Claim:** "the four `TestBacktesterWindowMask` tests … deliver the end-to-end proof" of the polarity repair.
**Reality:** They exercise **only** `_build_default_event_mask_utc`, the branch the code itself labels *"Legacy fallback — ts_et not available (should be rare post-data-loader fix)"*. Re-inverting the **ET** builder — the normal production path — leaves the suite fully green.
**Sources compared:**
- runtime spy on `generate_signals`: `{'has_ts_et': False, 'n_bars': 20, 'event_mask_sum': 0}` → **UTC builder selected**; the fixture DataFrame has no `ts_et` column (`backtester.py:3970` `if "ts_et" in df.columns:`).
- mutation arm **ET-REVERT** (`:3941 zeros→ones`, `:3964 True→False`, UTC left correct) → **`4 passed`**
- mutation arm **UTC-REVERT** (`:3980`, `:3995`; ET left correct) → **`1 failed, 3 passed`**
- **re-run at end-HEAD `4ac0a724`** (backtester blob unchanged `e04c9ab8`) → **`4 passed`. Still blind.**
**Source of truth:** the mutation arms. A guard that stays green when you re-introduce the exact defect in the exact function that runs in production is not a guard for that defect.
**Fix point:** `src/engine/tests/test_entry_windows.py` — the fixture DataFrame (`~:333`) must also emit a `ts_et` column, or gain a sibling case that does. One added column converts a blind guard into a real one.
**Repro:**
```bash
git archive 4ac0a724 src pyproject.toml | tar -x -C /scratch/etrevert
# in /scratch/etrevert/src/engine/backtester.py: line 3941 zeros->ones, line 3964 True->False
cd /scratch/etrevert && PYTHONPATH=. python -m pytest \
  src/engine/tests/test_entry_windows.py::TestBacktesterWindowMask -q      # -> 4 passed
```
**Blast radius:** every consumer of "the polarity is guarded" — R-623 §7.2's acceptance, AR-667's "end-to-end proof", and any future refactor of `_build_default_event_mask_et`. The ET builder is the DST-safe one the M3 fix introduced *because* it is the one that runs.

### Discrepancy F-B: two tests still pass on a degenerate `{}` — the `.get(…, DEFAULT)` equals the asserted value
**Severity:** HIGH (assertion satisfiable by a default) — **OPEN at end-HEAD**, not closed by the F-2 repair
**Claim:** (implied by the F-2 fix) "a swallowed `run_backtest` failure cannot produce a passing test."
**Reality:** True for the **exception** path only. A `run_backtest` that returns successfully but degenerately still manufactures greens.
**Sources compared:** ARM 2 (`run_backtest` → `{}`, no exception raised) at the pin → **2/4 PASS**; **the same at end-HEAD `4ac0a724` → still 2/4 PASS.** `[CORROBORATED]` a delegated static sweep of `src/engine/tests/` independently flagged the identical two lines (`:440-441`, `:445-446`) as a residual double-default (`{}` then `0`) **after** the F-2 repair — a genuinely non-overlapping path: it read the source, I executed a planted return.
**Source of truth:** the two assertions read their value through a default equal to the value they assert:
```python
skipped = result.get("engine_audit", {}).get("skipped_outside_window_count", 0)
assert skipped == 0
```
`test_empty_windows_no_skipped` and `test_no_windows_field_no_skipped` pass when the key is **entirely absent**. They cannot distinguish "measured 0" from "nothing there".
**Fix point:** `src/engine/tests/test_entry_windows.py` — assert key presence *before* reading, or drop the default so a missing key raises: `result["engine_audit"]["skipped_outside_window_count"]`.
**Repro:** monkeypatch `src.engine.backtester.run_backtest` to `lambda *a, **kw: {}`, then call the two test bodies → both PASS.
**Blast radius:** these two are 2 of the 4 tests carrying the polarity certification. Combined with F-A, the suite's effective discriminating power rests on **one** test, `test_window_mask_reduces_entries`.

### Discrepancy F-D: three tests certify production code they never execute
**Severity:** HIGH (false green — the assertion cannot reach the production artifact)
**Claim:** (implied by file/test names) these suites guard production behaviour.
**Reality:** `[MEASURED HERE — I read every line below myself in the current tree]` Three suites assert against objects defined **inside the test file**. The production symbol is never imported, never called, and in one case **does not exist outside tests at all.**

**F-D.1 — `src/engine/tests/test_wave_a_dsr_sharpe_fixes.py:28-41`** (7 tests). The helper's own docstring: *"Replicate the CPCV DSR try/except block from walk_forward.py."*
```python
def _simulate_dsr_exception_block(self, exc: Exception) -> dict:
    try:
        raise exc
    except Exception as _dsr_exc:
        _dsr_result = {"dsr": None, "dsr_pass": False, "dsr_unavailable": True, ...}
        return _dsr_result
```
The tests then `assert result["dsr_pass"] is False` etc. — reading back the literal the helper just wrote. `[MEASURED HERE]` the file's entire production import surface is `from src.engine.risk_metrics import compute_sharpe_distribution` — **`walk_forward` is never imported.** Deleting the real FIX-7 handler from `walk_forward.py` leaves all 7 tests green. This is the desk's own *hand-copied-expected-value* defect one level up: a hand-copied **mechanism**.

**F-D.2 — `src/engine/tests/test_deepscan17_b9_chandelier_regime_multiplier.py:39`** (10 tests). `_select_chandelier_multiplier` is **defined at line 39 of the test file**. `[MEASURED HERE]` `grep -rn "_select_chandelier_multiplier" --include=*.py src/engine | grep -v "/tests/"` → **zero hits**. The function under test exists *only* in the test file; `backtester._apply_adaptive_management` could return any value and all 10 pass.

**F-D.3 — `src/engine/tests/test_quantum_rl_agent.py:531-541, 544-549`** (2 tests). `patch.dict(os.environ, {"QUANTUM_RL_IBM_CLOUD_OPT_IN": "false", …})`, then `opt_in = os.environ.get("QUANTUM_RL_IBM_CLOUD_OPT_IN","").lower()=="true"`, then `assert opt_in is False`. **The test asserts a value it set two lines earlier.** `_build_vqc_policy_ibm` is never invoked despite the docstring. The second test's `""` default also satisfies the assertion unconditionally.

**Source of truth:** the import lists and definition sites, read directly.
**Fix point:** each file — import and call the production symbol, or delete the suite. A replica cannot guard its original.
**Repro:** `grep -rn "_select_chandelier_multiplier" --include=*.py src/engine | grep -v "/tests/"` → empty; and read `test_wave_a_dsr_sharpe_fixes.py:14-21` for the import surface.
**Blast radius:** FIX-7's DSR fail-closed contract (a TS consumer is documented to block on `dsr_pass=False`), the B9 chandelier regime multiplier, and the quantum-RL cloud opt-in governance gate — three "guarded" properties with no guard.

### Observation F-C: the brief's own recipe 2 is not green, and the claims do not disclose it
**Severity:** LOW (disclosure gap — **not** a refutation of C2)
`[MEASURED HERE]` `pytest src/engine/tests/ -q -k "event or mask or signal or blackout"` → **`2 failed, 442 passed, 6 skipped`**:
`test_skip_engine.py::TestCalendarFilter::test_economic_event_nfp_day_level` and `::TestCheckEconomicEvent::test_nfp_inside_window`.
**Pre-existing, not caused by the fix** — proven by running `test_skip_engine.py` in both arms: **`2 failed, 100 passed` identically on base and fixed**, and `skip_engine.py` contains no reference to `backtester`. Recorded so no future reader mistakes this red for fallout of the repair — or mistakes the repair's green for a clean lane.

---

## MANDATORY COVERAGE SECTION

### 1. What I verified, and the two-plus non-overlapping paths per claim

| claim | path A | path B | path C |
|---|---|---|---|
| **C1 mechanism** | read the executable lines in both blobs (`signals.py:288-290`, `backtester.py:3941/3964/3980/3995`) | **AST-lifted** builders executed on identical timestamps | end-to-end pytest base-vs-fixed delta |
| **C1 magnitude** | AST-lift over 4 independent session shapes | survivor clock-time enumeration (all inside blackout) | `[CORROBORATED]` prior receipt, different data (76.89% smoke), same base blob |
| **C2** | `git show --stat` (commit metadata) | blob-SHA equality of `signals.py` across 4 revs + `git log -- signals.py` = empty | diff hunk read: all 4 polarity lines present |
| **C3** | pytest `4 passed` (campaign tree + scratch) | stub-marker grep = 0 in `-s` output | direct helper-return measurement: 63/64 keys, `_error` False |
| **C4** | assert-line **count** 59==59 | assert-line **content sha256 identical** `0276fb12…` | `diff` of extracted assertion lines → empty |
| **C5** | pytest arm deltas (`1 failed,3 passed` → `4 passed`) | direct measurement of `total_trades` / `skipped` | single-builder mutation isolating the polarity lines |
| **C6 gate** | source read of `:3892`/`:3902` | executed gate predicate over 4 config arms | `generate_event_mask` executed on in-window bars |
| **C6 producers** | enumerated file surface (10 files, 6 extensions) | assignment-site pattern + **planted positive control** | join-key disambiguation of 2 false hits |

### 2. Positive-control witnesses for every absence claim I make

| my absence claim | positive control | result |
|---|---|---|
| "the crash-handler stub never fires in the green run" | planted `RuntimeError` in `run_backtest`; real test bodies invoked | control **fires** — 3/4 pass off the stub at the pin, 0/4 at HEAD. Method proven able to detect the stub |
| "zero `event_calendar` producers in this tree" | planted `event_calendar=EventCalendarConfig(...)` in `.py` **and** `{"event_calendar": …}` in `.json` | **both caught** by the same pattern → the null is meaningful |
| "the guard is blind to ET re-inversion" | UTC-REVERT arm (the *discriminating* control) | UTC-REVERT → **`1 failed`**; ET-REVERT → **`4 passed`**. The suite CAN go red — just not for the ET builder |
| "no assertion content changed" | line-numbered hash deliberately computed too — it **differs**, proving the content hash is not trivially insensitive | content hash identical, numbered hash differs |
| **F-D.2** "`_select_chandelier_multiplier` exists only in the test file" | the **same** grep run **without** the `grep -v "/tests/"` filter | returns **6+ hits** in the test file → the pattern demonstrably matches this symbol, so the filtered null is a real absence, not a broken pattern |
| **F-D.1** "`walk_forward` is never imported there" | read the file's complete import block (`:12-21`), not a keyword grep | only `src.engine.risk_metrics` imported; enumerated surface, not a sample |

### 3. Join keys checked for every "identical / unchanged / same" claim

- **"same unchanged fixture" (C5):** `test_entry_windows.py` sha256 `103b2719…50b9ba44` — **identical in base and fixed arms**; `signals.py` sha256 `c428b26d…` identical; arm file counts 2140 == 2140.
- **"only backtester.py changed" (C2):** blob SHA `ad4cd1b9` for `signals.py` at `28a95a9a`, `98dfa126`, `b2025c4b`, `4ac0a724`.
- **"my verdict describes the pin" :** `backtester.py` = `e04c9ab8` at all four revs including end-HEAD; `test_entry_windows.py` = `9be5ccd9` at the pin, **`ee734299` at end-HEAD** (explicitly scoped in §PINS).
- **"59 assertions unchanged" (C4):** sha256 of the extracted assertion text, not line numbers, not a count.
- **C6 producer census:** the field `BacktestRequest.event_calendar` vs the module `src.data.macro.event_calendar` — **different objects sharing a name**; 2 of 10 surface hits excluded on that key.

### 4. What I did NOT verify

1. **`runtime-production`.** Brief prohibition. So "the default blackout suppresses every DSL run" is **unverified for what is actually deployed**. LANDED ≠ RUNNING.
2. **The sibling tree `wt-eventmask-fix-20260803`**, which exists and is named for this exact fix. C6's "repo-wide" is graded **for `wt-h1-wave4-20260712` only**. `git worktree list` shows 10+ linked worktrees plus standalone trees; I swept **one**. A cross-tree claim needs a filesystem sweep I did not run.
3. **The `ts_et`-present production path end-to-end.** I proved the ET builder is *uncovered* by mutation, and I exercised it via AST lift — but I never ran a full `run_backtest` on a DataFrame carrying `ts_et`. My attempt failed on a dtype error in **my own** fixture (`str` → `datetime[μs, UTC]` cast), which I did not chase. **The ET builder's post-fix behaviour inside a real `run_backtest` is `HYPOTHESIS`, not measured.**
4. **Whether `_get_events_for_policies` has real events on any date** — so C6(b) could not discriminate `IGNORE` from `SIT_OUT`. The refutation rests on the gate predicate (a), not on (b).
5. **The parse-failure branch.** The fix's docstring says an unparseable timestamp now leaves the bar at `False` = tradable, "deliberately unchanged". I did **not** test a `None`/malformed `ts_et`. A fail-**open** on bad data is exactly the class this desk keeps re-finding; it is untested here.
6. **The delegated `src/engine/tests/` sweep — verified only in part.** It reports **329/329 `.py` files regex-swept, 31 opened in detail** (so ~90% of files were pattern-matched but not read), and returns ~35 further candidates I have **NOT** independently confirmed. Those are `[RELAYED — UNVERIFIED]` and are deliberately **not** written up as findings above. I hand-verified **4 of its top candidates and 4 of 4 held** (F-B, F-D.1, F-D.2, F-D.3) — which raises confidence in the instrument but is **not** a certification of the remainder. Named-but-unverified, in descending reported severity: `test_topstep_standard_lane.py` (5 tests, `.get("consistency_fail_rate", 0.0)` == 0.0), `test_quantum_mc.py:480` and `test_paper_backtest_sizing_parity.py:299` (`except Exception: pytest.skip(...)` — a real regression reports as green-by-skip), `test_pnl_accuracy.py:859` (skips when `total_trades == 0`, which is the primary failure mode of the code under test — and was **literally the state this polarity bug produced**), `test_metric_snapshot.py` (15 skips; green-by-missing-snapshot), `test_backtester.py:305-308`, `test_black_swan_evaluator.py:690-702`, `test_monte_carlo.py:772/786`, `test_risk_metrics.py:128-131`. The sweep reports **zero** matches for `assert True`, literal self-comparison, and `xfail`. **Do not read this list as measured, and do not read the absence of further findings as their non-existence.**
   - 🛑 One relayed item deserves the desk's attention on its face: `test_pnl_accuracy.py:859-860` skips the commission-accuracy suite when `total_trades == 0`. **The event-mask polarity bug produced exactly zero-trade runs by construction.** If that is accurate, the commission suite was green-by-skip for the entire life of this defect. `[RELAYED — UNVERIFIED]`, and worth its own lane.
7. **Anything at end-HEAD beyond the three graded files** — 17 commits landed mid-grade touching `invariant_harness/core.py` and `test_invariant_harness.py`. Out of scope, unread.
8. **`git status` porcelain went 84 → 87 lines.** I attribute this to the concurrent worker and this receipt, but I did **not** line-by-line diff the untracked set to prove none of it is mine.

---

## SELF-VERIFICATION

1. ✅ Every CRITICAL/HIGH finding carries a concrete repro command, not a hypothesis (F-A: `git archive` + two line edits + pytest; F-B: one monkeypatch; F-D: one grep + one import-block read).
2. ✅ Every "source of truth" was compared against ≥1 independent source (table §1).
3. ➖ Correlation-id hop-walking: **not applicable** — no state transition, DB write, SSE broadcast, or `audit_log` row is in scope. Recorded rather than silently skipped.
4. ➖ First-principles P&L recomputation: **not applicable** — no P&L, commission, or point-value claim under grade. `total_trades` 0→1 is a count, verified directly.
5. ✅ Every absence claim shows a positive-control witness (§2); every "unchanged" claim shows its join key (§3).
6. ✅ Everything I ran out of access, data, or time for is named in §4 — including my own failed ET-path fixture and the unreturned sweep.

**Two instrument self-convictions recorded, both caught by my own controls before they reached a finding:**
- My first positive-control harness crashed on ARM 2 (`IndexError` — a bare `assert` yields an empty message). **My instrument, not the artifact.** Fixed and re-run; had I read the crash as a result I would have reported a false CRITICAL.
- My first C6 execution arm died on a polars dtype cast in **my** fixture and would have read as "the opt-out errors out". I replaced it with a direct gate/mask probe rather than report the failure as a property of the code.

**Verdict issued at:** engine `28a95a9a` / fixture `98dfa126`, with `backtester.py` = `e04c9ab8` and `signals.py` = `ad4cd1b9` also holding at end-HEAD `4ac0a724`.
