# GRADE (lane B) - EVENTMASK REPAIR: AR-666 (R-621 s5.1) + AR-667 (R-623 s7.1/s7.2)

**Grader:** accuracy-validator, independent lane B. **Doer != grader; I designed none of this code.**
**Date:** 2026-08-03.

## 0. TREE, PIN, AND THE JOIN KEY (read this before any number below)

**TREE:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` (linked worktree; `git rev-parse --git-common-dir` =
`C:/Users/tonio/Projects/trading-forge/trading-forge/.git`). **BRANCH:** `h1-wave4-sealed12-driver`.

**THE HEAD MOVED UNDER ME TWICE MID-GRADE.** Dispatch pin `4ac0a724` -> `1771b814` (9 commits) ->
`12760760` at commit time. A live worker shares this tree. `[MEASURED HERE]`

**JOIN KEY, re-derived not recalled, and re-derived AGAIN after the second move** - blob hash of every
file I measured, at the dispatch pin, at each HEAD, and in the working tree. All agree for all six: `[MEASURED HERE]`

| file | blob at `4ac0a724` == `1771b814` == `12760760` == worktree |
|---|---|
| `src/engine/backtester.py` | `e04c9ab84312bb5d56b717211df4a6c541b4a2d6` |
| `src/engine/tests/test_entry_windows.py` | `ee7342992e80145fe7e05bb6453e6c6747f658f7` |
| `src/engine/config.py` | `c40757c9bef793abdacf721093b016a2fdb7517e` |
| `src/engine/conftest.py` | `ffcae2e322f5bbb27357bdbab8a7cfa1a34ecf58` |
| `src/engine/tests/test_class_event_mask_parity.py` | `7568840c5f943e95eadfbf622baa3bb60355349d` |
| `src/engine/data_loader.py` | `c987ff53fcf923c7a53aac658dc0f11094f430bb` |

Only `src/engine/performance_gate.py` + 4 docs changed across that whole window, none of them a surface I
measured. **Therefore every finding below describes `4ac0a724`, `1771b814` AND `12760760` alike.**

## 0b. INDEPENDENCE DECLARATION - I WAS CONTAMINATED TWICE AND I AM NAMING BOTH

Structural independence is not a matter of how honestly I look, so I record the exposures:

1. **A `ripgrep` for `event_blackout_default` returned one line of the sibling lane's file**
   `docs/designs/GRADE-EVENTMASK-REPAIR-2026-08-03.md:174`, which refutes an *adjacent* claim (whether an
   opt-out from the default blackout exists via an IGNORE policy). **I did not open that file at any point.**
   **CONSEQUENCE: I do NOT adjudicate the opt-out question. It is not mine to be a second path on.**
2. **Re-deriving my pin after HEAD moved (a mandatory step) put `git log` in front of me**, and `R-632`
   /`6fe1827d` adopted the sibling lane at **band 6/10** carrying **F-A**: *"the four-test polarity guard runs
   the UTC fallback and never the production ET builder."* **My F-3 below is the same defect.** I measured it
   independently and BEFORE this exposure (execution census, completed prior to that `git log`), but I will
   not claim it as novel. **It is reported as CORROBORATION-BY-A-SECOND-PATH, and it is strictly wider.**

Per the rubric I **re-derived every band from current artifacts only** and did not carry the adopted 6.

## 1. GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| AR-666 / R-621 s5.1 - fallback polarity repair, landed `28a95a9a` | **7** | **VERIFIED** | Semantics read at the executable line + reproduced end-to-end by reverting it in memory (`MUT=BASE` -> the exact documented failure). Zero regressions re-measured on a surface WIDER than the doer's. Arms 3/4 absence re-confirmed by AST with a two-way positive control. | The repaired in-window line has **zero executions anywhere in the suite** (F-3). The 8-arm red-proof is not reproducible (F-5). |
| AR-666 claim *"2/8 arms -> 8/8, same unchanged harness"* | **n/a** | **UNVERIFIED** | The AST-extraction harness that produced these numbers **does not exist in any tree** under `C:/Users/tonio/Projects` (positive-controlled search, F-5). | Not refuted - **unverifiable**. The load-bearing red-proof for a money-path instrument has no durable artifact. |
| AR-667 / R-623 s7.2 - the revived "end-to-end proof" | **4** | **VERIFIED** | Every published number reproduced exactly. But three differently-broken masks reproduce them too (F-2); only 1 of 4 tests responds to the mechanism (F-1); one blocker-table row is false (F-4). | Rubric 3-4: *implemented but unproven.* |
| AR-667 s7.1 - the landing of `28a95a9a` itself | **7** | **VERIFIED** | Commit exists, diff is polarity + telemetry only, `signals.py` absent from the diff, 54 passed at HEAD. | Inherits F-3. |

**RECONCILIATION, CLAIMED vs VERIFIED (>1 band, so it is owed in writing).** AR-667 framed s7.2 as
*"THE END-TO-END PROOF I SAID I COULD NOT GIVE NOW EXISTS"* - a >=8 framing. I verify **4**. The gap is
**not** arithmetic: every number AR-667 published is correct and I reproduced all of them. The gap is that
the evidence **does not discriminate the mechanism it is offered as proof of**. Deleting the entire event
blackout leaves all four tests green and every headline number unchanged. A proof that survives the deletion
of the thing it proves is not a proof. The default assumption (inflation) is **sustained**.

---

## 2. HUNT FINDINGS

### Discrepancy F-1: AR-667's "4 passed" is a one-test delta wearing a four-test headline
**Severity:** CRITICAL (false positive - evidence inflation on a money-path instrument)
**Claim:** *"SAME UNCHANGED FIXTURE: pre-fix base `1 failed / 3 passed` -> fixed `4 passed`, running the REAL `run_backtest`."*
**Reality:** Exactly **1 of the 4** tests in `TestBacktesterWindowMask` responds to the eventmask polarity.
The other 3 are invariant to it - they were green on the broken base and stay green on every broken variant I built.
**Sources compared:** `[mutation census, MEASURED HERE]` `[report table, ARTIFACT-SOURCED]` `[static read of the assertions, MEASURED HERE]`

Red-path census. Each mutant edits `backtester.py` **in memory only** and runs the tree's own unchanged test file:

| mutant | what it breaks | tests turning RED |
|---|---|---|
| `BASE` full polarity revert, both builders | the repair | **1** - `test_window_mask_reduces_entries` |
| `HALF` keep `zeros(...)`, revert `mask[i]=True` | in-window SIT_OUT marking | **0** |
| `NOBLACKOUT` blackout branch deleted | the entire feature | **0** |
| `WINDOWSHIFT` windows moved to 23:30 | which bars are blacked out | **0** |
| `TELEMETRY` eighth arm reverted | the masked-count report | **0** |
| `DROPAUDIT` `engine_audit` key removed | result schema | 2 - `..._reduces_entries`, `test_engine_audit_key_present` |
| `SKIPCONST` counter pinned to 99 | the counter | 2 - `test_empty_windows_no_skipped`, `test_no_windows_field_no_skipped` |

So the three non-discriminating tests are not *vacuous* - `SKIPCONST` and `DROPAUDIT` prove they each have a
path to red. **They simply have no path to red for the eventmask.** `test_empty_windows_no_skipped` and
`test_no_windows_field_no_skipped` read
`result.get("engine_audit", {}).get("skipped_outside_window_count", 0)` and assert `== 0`: **the default `0`
means total absence of the field satisfies them.**
**Source of truth:** the mutation census. AR-667's own base row (`1 failed / 3 passed`) already contains this
fact - three tests passing on the *broken* base is the definition of not discriminating. The number is honest;
the headline built on it is not.
**Fix point:** `src/engine/tests/test_entry_windows.py:438-446` - the two `.get(..., 0)` defaults; and the
headline at `docs/designs/AGENT-REPORTS.md:353`. Per `report-table`, fix the emitter (the claim), not the row.
**Repro:**
```
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712
export PYTHONPATH="<scratch>;C:/Users/tonio/Projects/wt-h1-wave4-20260712"
TF_MUT=BASE python -m pytest src/engine/tests/test_entry_windows.py::TestBacktesterWindowMask -q -p tfmut
```
**Blast radius:** any ruling that reads "4 passed" as four independent witnesses of the polarity repair.
`R-623` s7.2's acceptance and every downstream citation of it.

---

### Discrepancy F-2: three differently-broken masks reproduce AR-667's headline numbers EXACTLY
**Severity:** CRITICAL (false positive - the discriminator does not discriminate)
**Claim:** *"the TRADE-LEVEL DISCRIMINATOR is the headline: `total_trades` 0 -> 1 and window-masked signals 0 -> 10, on real 63/64-key result dicts - NOT the stub."*
**Reality:** The numbers are **correct** and I reproduced every one. They discriminate **one bit** - the mask
*initialiser* - and nothing else. Reverting half the repair, deleting the feature outright, or moving the
blackout windows to hours that do not exist all produce byte-identical headline numbers.
**Sources compared:** `[MEASURED HERE, per-mutant, through the tree's OWN unchanged fixture helper]`

| mutant | `total_trades` | masked signals | keys | 4 tests | blackout stderr line |
|---|---|---|---|---|---|
| shipped fix (`IDENTITY`) | **1** | **10** | **64** | 4 passed | `masking 0/20 bars` |
| `BASE` (the real defect) | 0 | 0 (none printed) | 63 | 1 failed | `masking 20/20 bars` |
| `HALF` | **1** | **10** | **64** | 4 passed | `masking 0/20 bars` |
| `NOBLACKOUT` | **1** | **10** | **64** | 4 passed | **(nothing printed)** |
| `WINDOWSHIFT` | **1** | **10** | **64** | 4 passed | `masking 0/20 bars` |

**`NOBLACKOUT` deletes the entire event blackout and is indistinguishable from the correct fix** on every
asserted value. Its only tell is the *absence* of a stderr line, and **no test in the repository asserts on
that line** (verified: `grep` for `Default event blackout` / `masked ALL` / `_masked_bars` returns hits in
`backtester.py` only, zero in any test).
**Source of truth:** AR-667's own mechanism note is the refutation, one paragraph below its own headline:
*"no fixture bar falls in 8:30-9:00 / 14:00-14:30 ET, so the correct mask is all-False."* If no bar is ever
in a window, the in-window branch is dead code for this fixture, so the fixture cannot see it change.
**Fix point:** `src/engine/tests/test_entry_windows.py` - the fixture builds all 20 bars at 14:00/15:00 UTC
(`:338-344`). **Add bars inside 12:30-14:00 UTC (UTC builder) and, with a `ts_et` column, inside 08:30-09:00 ET.**
**Repro:** `TF_MUT=NOBLACKOUT python -m pytest src/engine/tests/test_entry_windows.py::TestBacktesterWindowMask -q -p tfmut` -> `4 passed`.
**Blast radius:** the guard offered as the standing regression protection for the polarity repair. A future
edit that re-breaks the blackout in any way other than the initialiser ships green.

---

### Discrepancy F-3: the repaired line has ZERO executions across the entire `run_backtest` test surface
**Severity:** CRITICAL (parity gap - tests exercise a path production does not use)
**Status:** **CORROBORATES `R-632` F-A by a second, non-overlapping path, and extends it.** The sibling lane
read `backtester.py:3970` statically. I ran a **dynamic execution census**. Both land on the same defect;
the second fact below is additional.
**Claim (implied by both AR-666 and AR-667):** that the repair of `_build_default_event_mask_et` is what the
end-to-end evidence exercises.
**Reality `[MEASURED HERE]`:** instrumented `backtester.py` in memory and ran **every test file in the repo
that calls `run_backtest`** (19 files, 386 tests):

```
default-blackout branch entered ....... 431
_build_default_event_mask_et  runs .... 0
_build_default_event_mask_utc runs .... 431
`mask[i] = True  # True = SIT_OUT` .... 0      <-- the repaired line, zero executions
```

Two separate holes, not one:
1. **The builder production uses is never run by any test.** `backtester.py:3970` selects the ET builder only
   when `ts_et` is a df column; `data_loader.py:1000/1008` is what aliases `ts_et`, and every test passes
   `data=` directly, bypassing the loader. The suite runs only the branch the code itself labels
   *"Legacy fallback - should be rare post-data-loader fix."*
2. **NEITHER builder's in-window branch is ever exercised.** Across all 431 invocations the SIT_OUT
   assignment fired **0 times**. The polarity repair's actual edit has no path to red anywhere in the suite.
**Control that this census is trustworthy:** the instrumented run and a clean run over the identical file set
produced **identical results - 6 failed / 380 passed / 3 skipped, same failing node IDs** - so the tracing did
not perturb the population. `[MEASURED HERE]`
**Nearest-neighbour check (law 9 - a boundary is proven by what it excludes):**
`src/engine/tests/test_class_event_mask_parity.py` does cover event masking, but it tests
`economic_calendar.generate_event_mask` / `apply_class_event_mask` - the **explicit-calendar** producer, the
*other* branch at `backtester.py:3892`. It does not touch either default builder, which is precisely why
AR-666 had to AST-extract them: they are nested inside `run_backtest` and cannot be imported.
**Source of truth:** the execution census.
**Fix point:** `src/engine/tests/test_entry_windows.py` fixture - add a `ts_et` column and in-window bars.
**Repro:** `TF_MUT=TRACE python -m pytest $(grep -rln "run_backtest(" --include=*.py src/engine/tests/) -q -p tfmut -s`, then count `MUT-TRACE:` lines.
**Blast radius:** every production DSL backtest. `[HYPOTHESIS, NOT MEASURED: that a production run has
`ts_et` and therefore takes the ET branch. I could not run a real data load - S3 refused pre-flight for
missing AWS credentials, reproduced in every run above. The static producer at `data_loader.py:1000` is
`[MEASURED HERE]`; the runtime consequence is not.]`

---

### Discrepancy F-4: AR-667's blocker-table row 4 is false on three independent grounds
**Severity:** HIGH (schema drift in a finding record - "FOUR blockers" is THREE)
**Claim:** blocker table row 4 - *"validator rejects `fixed_contracts=1` as probable misconfiguration"*,
column *"why it stayed invisible" = "swallowed"*; and the headline
*"THE FIXTURE HAD FOUR BLOCKERS, NOT ONE."*
**Reality:** that blocker was never in the fixture and could not have been swallowed.
**Sources compared:**
- **(i) The pre-AR-667 fixture did not use `type="fixed"`.** Materialised `git show e42da76b:src/engine/tests/test_entry_windows.py`
  -> `:366-368` reads `PositionSizeConfig(type="risk_derived_pyramid", base_contracts=1)`. The guard at
  `config.py:422-425` requires `self.type == "fixed"`, so it **cannot** fire. Executed with the env flag
  removed: that exact config **constructs cleanly, validator silent.** `[MEASURED HERE]`
- **(ii) It sits OUTSIDE the `try`, so it could not be swallowed.** In the old file, `PositionSizeConfig(...)`
  is an argument to `StrategyConfig(...)` at `:358`; the `try:` is at `:374`. That is the **same structural
  position as blocker 1**, which the report itself credits as *"the only visible failure"* precisely because
  it is outside the `try`. A pydantic `ValidationError` there escapes. Identical in the current file
  (`:387` vs `try:` at `:406`).
- **(iii) The guard is disarmed under the report's own command anyway.** `src/engine/conftest.py:29` runs
  `os.environ.setdefault("TF_ALLOW_FIXED_1", "true")` for every test under `src/engine/`, and `config.py:425`
  reads the env var **at validation time**, not import time. Verified both directions: without the flag it
  raises; with it, `fixed_contracts=1` constructs. `[MEASURED HERE]`
**Source of truth:** the `e42da76b` blob plus the executable validator line. Blocker 4 was an obstacle the doer
**created during the repair** (choosing `type="fixed"` and leaving `fixed_contracts` at its default 1), then
recorded as a pre-existing hidden blocker. Blockers 1, 2 and 3 survive scrutiny: 1 escaped (outside `try`),
2 and 3 are inside `run_backtest` and genuinely were swallowed.
**Fix point:** `docs/designs/AGENT-REPORTS.md:361` blocker table, row 4 - and the s7.2 headline count.
**Repro:** `git show e42da76b:src/engine/tests/test_entry_windows.py | grep -n "PositionSizeConfig" -A 3`
**Blast radius:** `R-624`/`R-630`'s reading of how deep the fixture rot went; the "ninth guard-shaped-object"
tally. **It does not touch the F-2 finding the desk already closed** - the *stub-satisfies-assertions* defect
is real and independently confirmed.

---

### Discrepancy F-5: the red-proof for a money-path instrument does not persist
**Severity:** HIGH (single-source truth = unverifiable)
**Claim:** *"`2/8` ARMS ON THE UNFIXED BASE -> `8/8` ON THE FIX, SAME UNCHANGED HARNESS."*
**Reality:** **I cannot verify this. The harness does not exist.** Searched every tree under
`C:/Users/tonio/Projects` for a `.py` file referencing `_build_default_event_mask_et` or the arm strings:
**zero hits outside `backtester.py` itself.** The isolated worktree `wt-eventmask-fix-20260803` still exists
but contains no arms script. The only surviving artifact,
`docs/designs/EVENTMASK-POLARITY-REPAIR-2026-08-03.patch`, is the code diff - **not the harness**.
**Positive control for this absence:** the same search **does** return
`wt-h1-wave4-20260712/src/engine/backtester.py` for `_build_default_event_mask_et`, so the method can find the
symbol when it is present. The null is meaningful. `[MEASURED HERE]`
**Source of truth:** the filesystem. `28a95a9a --stat` = `src/engine/backtester.py` only; the harness was
never committed.
**Fix point:** the 8 arms should be committed as tests. They are the only artifact that covers the ET builder
at all (F-3), and they are the only thing that would have caught `HALF`/`WINDOWSHIFT` (F-2).
**Repro:** `grep -rl "_build_default_event_mask_et" --include=*.py C:/Users/tonio/Projects | grep -v backtester.py` -> empty.
**Blast radius:** `red-path-decay` - the red path for this repair is now unreproducible, so no future change
can be proven against it. This is the single highest-leverage repair available here.

---

### Discrepancy F-6 (NOVEL): the comment's own documented opt-out is SILENTLY ABSORBED
**Severity:** HIGH (silent disagreement - a caller is told to set a field that is dropped without error)
**Claim under grade:** AR-666 - *"ARMS 3 AND 4 ARE NOT DELIVERABLE: THE MODES THEY NAME DO NOT EXIST IN THE
CODE."* **That claim is CONFIRMED (see s3).** This finding is the *dynamic-reach* half my absence duty owes.
**Reality:** `backtester.py:3908-3910` instructs callers verbatim: *"Callers can disable this by passing
event_calendar with an empty policies list and setting `event_blackout_default=False`."* `EventCalendarConfig`
leaves pydantic `extra` at its default (`ignore`), so:
```
EventCalendarConfig(policies=[], calendar_source='static', event_blackout_default=False)
  -> ACCEPTED, model_dump() == {'policies': [], 'calendar_source': 'static'}
```
**No error. The field is silently discarded.** `[MEASURED HERE]` And an empty `policies` list fails the
`and request.event_calendar.policies` test at `:3892`, falling through to the `elif` that applies the full
default blackout. A caller who follows the instruction literally gets a **silent no-op plus a full blackout**.
**Source of truth:** executed construction + the executable branch condition.
**Fix point:** `src/engine/config.py:516` - `model_config = ConfigDict(extra="forbid")` on `EventCalendarConfig`
would convert a silent drop into a loud error; and/or correct the comment at `backtester.py:3908-3910`.
**Repro:** `python -c "from src.engine.config import EventCalendarConfig; print(EventCalendarConfig(policies=[], event_blackout_default=False).model_dump())"`
**Blast radius:** any caller acting on that comment. **SCOPE LIMIT, DECLARED:** I am reporting the
*silent-absorption mechanism*, which I measured. I am **NOT** adjudicating whether an opt-out exists by some
other route - see s0b, contamination 1.

---

## 3. NOT REFUTED - THE HONEST NULLS (these are results, not gaps)

**N-1. AR-666's "ZERO REGRESSIONS - the same 6 tests fail identically" - SUBSTANCE CONFIRMED, and I widened it.**
The wording *"the SAME six tests, by name"* exceeded the published receipt, which is file-times-count
(`test_entry_windows x4, test_skip_engine x2`), not node IDs. **But the substance holds on two paths:**
- **Population arithmetic reconciles exactly.** AR-666: `6 failed + 438 passed + 6 skipped = 450` selected.
  Mine at HEAD, same command: `2 failed + 442 passed + 6 skipped = 450`. Identical population; exactly **4**
  tests moved failed->passed - precisely the four `TestBacktesterWindowMask` tests revived by the intervening
  fixture repair `98dfa126`. AR-666's decomposition predicts this exactly. `[MEASURED HERE + ARTIFACT-SOURCED]`
- **The names AR-666 never published, supplied here.** The 2 survivors are
  `test_skip_engine.py::TestCalendarFilter::test_economic_event_nfp_day_level` and
  `test_skip_engine.py::TestCheckEconomicEvent::test_nfp_inside_window` - **identical by node ID in both arms.**
- **Widened surface, also clean.** On all 19 files that call `run_backtest` (386 tests), fixed vs unfixed:
  6 failing node IDs **identical in both arms**, and exactly 1 test flips (`test_window_mask_reduces_entries`).
  **Zero regressions caused by the landed fix, on a surface larger than the doer's own `-k` selection.**

**N-2. AR-666's "arms 3 and 4 name modes that do not exist" - CONFIRMED by an independent method.**
AST scan (comments are invisible to a parser, docstrings reported separately) over **779 `.py` files, 0 parse
errors**: `event_blackout_default`, `require_event_calendar`, `calendar_required`, `REQUIRE_CALENDAR` ->
**0 executable hits, 0 docstring hits.** Unrestricted text search across the whole tree returns 5 hits: 3 in
docs (two of which are AR-666's own report and the ruling citing it) and **1 in `backtester.py:3909`, a
comment.** `EventCalendarConfig.model_fields` == `['policies', 'calendar_source']` - executed, not read.
AR-666's *"1 occurrence repo-wide"* was true when written; it is 5 today only because AR-666's own paperwork
added 3. **Substance intact.**

**N-3. Every number AR-667 published is accurate.** Reproduced through the tree's own unchanged fixture:
`total_trades` 0 -> 1, masked signals 0 -> 10, result dicts of exactly **63** (unfixed) and **64** (fixed) keys,
blackout log `masking 0/20 bars`, `4 passed`, and `54 passed` for the whole file. **No arithmetic discrepancy
anywhere.** The 63->64 delta is entirely one key, `roll_spread_costs`, which the engine adds only when a trade
exists - so "real dicts, not the stub" is CONFIRMED.

**N-4. First-principles money reconciliation - EXACT.** The single trade:
```
Size 6 contracts, Long, entry 5001.0, exit 4999.5, MES point value $5
gross = (4999.5 - 5001.0) x 6 x 5      = -45.00   (engine reports GrossPnL -45.0)
net   = -45.00 - 7.44 commission - 0 slip - 0 roll = -52.44
engine reports PnL -52.44, total_return -52.44, max_drawdown 52.44
commission 7.44 / 6 = $1.24 per contract round-turn
```
No off-by-one, no point-value drift, no MTM-vs-realized confusion. **`[MEASURED HERE]`**
**One scoping limit AR-667 did not state:** the trade's `Status` is **`"Open"`** with `Exit Idx 19` (the last
bar) - it is an end-of-data liquidation, not a closed round-trip. AR-667 honestly disclosed the synthetic
20-bar limit; it did not disclose that the counted trade never closed. Minor, recorded.

## 4. WHAT THE INSTRUMENT WAS

No file in the shared tree was written. `backtester.py` is read, mutated **in memory**, compiled, and installed
into `sys.modules` as `src.engine.backtester` by a pytest plugin loaded with `-p`, which runs before conftest
collection. The **real** tree, **real** `src/engine/conftest.py`, **real** rootdir and the **tree's own
unchanged test file** are used throughout. Every mutation asserts its anchor count and aborts on mismatch.
Harness: `<scratch>/tfmut.py`, `<scratch>/measure_trades.py`, `<scratch>/ast_absence.py`.

---

## 5. MANDATORY COVERAGE SECTION

### 5.1 What I verified, and via which two-plus non-overlapping paths

| claim | path A | path B |
|---|---|---|
| "4 passed" discriminates the polarity | mutation census (7 mutants, red-path table) | static read of the three assertions' `.get(...,0)` defaults + AR-667's own base row |
| `total_trades` 0->1 / signals 0->10 | re-executed through the tree's own fixture helper | counterfactual mutants reproducing the same numbers |
| the repaired line never executes | dynamic execution census (431 invocations) | static branch read `backtester.py:3970` + `data_loader.py:1000` producer |
| blocker-4 row | `git show e42da76b` blob (fixture used `risk_derived_pyramid`) | executed validator, both env directions + try/except structural position |
| zero regressions | AR-666's own `-k` command, both arms, by node ID | widened surface: all 19 `run_backtest` files, both arms, by node ID; plus 450-population arithmetic |
| arms 3/4 modes absent | AST over 779 files (executable lines only) | unrestricted text search + executed `EventCalendarConfig.model_fields` |
| the trade's money | engine-reported `GrossPnL`/`CommissionCost`/`PnL` | independent recomputation from contracts x points x $5 |

### 5.2 Positive-control witnesses for every absence claim I make

| absence claimed | witness that my method could have caught it |
|---|---|
| "only 1 of 4 tests discriminates" | `MUT=BASE` turns exactly that 1 red, **reproducing AR-667's published base row `1 failed / 3 passed` including the message `Expected >= 10 skipped bars, got 0`** |
| "the other 3 have no eventmask path to red" | `SKIPCONST` reds 2 of them, `DROPAUDIT` reds the third - so my instrument **can** red them, just not via the mask |
| "the in-window line never executes" | the same TRACE instrumentation **does** report 431 blackout-branch entries and 431 UTC-builder calls - the counter is live, only that line reads 0 |
| "TRACE did not perturb the run" | instrumented vs clean over the identical file set: **6 failed / 380 passed / 3 skipped, identical failing node IDs** |
| "0 executable hits for the 4 tokens" | two-way control **before** the scan: a planted file with `event_blackout_default = False` and `cfg.require_event_calendar` -> **2 hits flagged**; a comment-only file -> **0 hits**. Both directions required to pass or the run aborts. 0 parse errors over 779 files |
| "the arms harness does not exist" | the same search returns `backtester.py` for `_build_default_event_mask_et`, so it finds the symbol when present |
| "no test asserts on the blackout telemetry" | `MUT=TELEMETRY` reverts the eighth arm -> **4 passed**, confirming the absence behaviourally, not just by grep |
| "the module injection actually took effect" | `IDENTITY` reproduces the un-instrumented baseline exactly (`4 passed`), and the plugin prints the replaced-anchor counts and `__TF_MUT__` |

### 5.3 Join keys checked for every "identical / unchanged / matches" claim
- **Tree/pin:** six blob hashes, equal at `4ac0a724`, `1771b814`, and the worktree (s0). Nothing I measured moved.
- **"same tests":** compared by **pytest node ID**, sorted and `diff`ed - never by count.
- **"same fixture":** all runs import `_make_minimal_backtest_result` from the tree's own file, blob `ee734299`.
- **"pre-AR-667 fixture":** materialised by `git show e42da76b:<path>` to a scratch file. **No `git checkout`,
  `reset`, or amend was run** - the live worker's tree was never disturbed.
- **"same population":** 450 selected in AR-666's `-k` run and in mine; 386 in both arms of the wider sweep.

### 5.4 WHAT I DID NOT VERIFY - and why

1. **AR-666's `2/8 -> 8/8` arms result.** The harness does not exist in any tree (F-5). **UNVERIFIED, not refuted.**
2. **Whether a production run actually takes the ET branch.** Requires a real data load; S3 refused pre-flight
   for missing `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in every run. The producer at `data_loader.py:1000`
   is measured; **the runtime consequence is `[HYPOTHESIS]` and I have not upgraded it.**
3. **Whether an opt-out from the default blackout exists.** **Deliberately not adjudicated** - I was
   incidentally exposed to one line of the sibling lane's verdict on exactly that point (s0b). I cannot be an
   independent path on it.
4. **`runtime-production`.** Not read, not touched. `LANDED != RUNNING`; `28a95a9a` is in this campaign tree only.
5. **The 6 pre-existing failures on the wider surface** (`test_zero_trade_backtest_does_not_crash`,
   `test_no_trades_returns_zero_metrics`, `test_walk_forward_mode`, 3 in `test_parameter_jitter_battery`).
   Proven **polarity-invariant** (identical node IDs in both arms) - **not diagnosed.** Two of them are
   zero-trade-path tests and are worth someone's attention.
6. **The TypeScript / server side.** My AST scan is Python-only; the unrestricted text search covered all file
   types for the four tokens, but I did not analyse TS consumers of `engine_audit` or `roll_spread_costs`.
   (`roll_spread_costs` has **zero readers** anywhere in `src/` - written at `backtester.py:5959`/`:7992` only -
   so the 63/64 key-set variance has no in-repo consumer. Recorded, not escalated.)
7. **The internal disagreement inside the trade record** - `Return: 0.0` alongside `PnL: -52.44`, and
   `Exit Fees: 0.0` alongside `CommissionCost: 7.44`. **Consistent with the project rule that vectorbt is
   never passed fees for futures** (we compute P&L ourselves), so the vbt-native columns are expected to be
   empty. **Nominated, not convicted** - I did not trace which consumers read the vbt-native fields.
8. **Whether any of the 9 commits that landed while I measured changed behaviour I observed.** Bounded by the
   blob-hash join key: they did not touch my surfaces. **Anything outside those six files is `[UNENUMERATED]`.**
