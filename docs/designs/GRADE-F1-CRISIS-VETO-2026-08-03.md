# GRADE — F-1 CRISIS-VETO REPAIR (Option B, `6b03a61c`)

**Date:** 2026-08-03 · **Mode:** GRADE + NOVEL HUNT · **Grader:** accuracy-validator (independent; doer ≠ grader)
**Tree (named in every finding):** `C:/Users/tonio/Projects/wt-h1-wave4-20260712`, branch `h1-wave4-sealed12-driver`
**Subject:** `6b03a61c` ("Option B"). Contrast-only: `67bc4178` ("Option A"). Ledger `R-630 §4.2`, `R-631`, `R-632 §5`, `R-633`, `R-635`. Reports `AR-676`–`AR-679`.

---

## 0. PIN INTEGRITY — the head moved, the subject did not

`[MEASURED HERE]` HEAD at dispatch was `b60036bd`; HEAD when I started was **`6db204ed`** (`AR-680` START-RECEIPT). A live worker shares this tree. I wrote nothing into it except this file and ran no `checkout`/`reset`.

**JOIN KEY = git blob sha of each subject file.** All three are byte-identical at all four points:

| file | `67bc4178` | `6b03a61c` | `b60036bd` | `6db204ed` (HEAD) | worktree |
|---|---|---|---|---|---|
| `src/engine/performance_gate.py` | `dca49a6a` | **`29d988e1`** | `29d988e1` | `29d988e1` | `29d988e1` |
| `src/engine/stress_test.py` | `d3fb6d8b` | `d3fb6d8b` | `d3fb6d8b` | `d3fb6d8b` | `d3fb6d8b` |
| `src/engine/backtester.py` | `e04c9ab8` | `e04c9ab8` | `e04c9ab8` | `e04c9ab8` | `e04c9ab8` |

➡️ **Everything below describes blob `29d988e1` of `performance_gate.py`.** The moved head does not touch this grade.

🛑 **LINEAGE DECLARATION (grading rule 2).** `F-1` was raised by **my own agent lineage** — `docs/designs/SWEEP-SWALLOWED-EXCEPTION-2026-08-03.md` (accuracy-validator, same day) published the `stress_test:131 → performance_gate:298` crashed-crisis finding. I did not design, build, or previously grade **the repair**, but I am not independent of **the defect**. Declared, not hidden.

---

## 1. THE GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| **F-1 repair (Option B) as shipped at `6b03a61c`** | **5 / 10** | **VERIFIED** | 3 arms re-derived on an independent fixture; population re-run with verbatim command; mutation + positive control | Guard has **no path to red** (F-G1); its own justifying comment is **refuted by the real producer** (F-G2); wider crash class still open (F-G3) |
| Claim (a) CRASHED arm | — | **VERIFIED** | `arms.py` §ARM(a) + `mutgate` probe | untested by any committed test, in any tree |
| Claim (b) BREACHED arm | — | **VERIFIED** | reason string reproduced byte-for-byte | — |
| Claim (c) CLEAN arm | — | **SPLIT: relation VERIFIED / number `28.8` UNVERIFIABLE** | relation holds on my fixture; `28.8` reproduces from **no** committed fixture | stats fixture exists only in transcript |
| Claim 4 regression (failure-set diff EMPTY) | — | **VERIFIED** | verbatim command, 6 names identical | — |

**Why 5 and not 7.** Band 7–8 requires *adversarially tested with residual risks documented*. The residual risks were documented honestly (`AR-678 §157` — credit where due), but the repair is **not tested at all**: deleting it entirely changes nothing in the campaign population. Band 5 = *happy-path only*, which is exactly what this is. It is above 3–4 because the arms are demonstrably true at the pin — I proved them myself.

---

## 2. WHAT I CONFIRMED (the honest positives)

`[MEASURED HERE]` — my own fixture (`avg_daily_pnl 400 / 60 of 100 winning days / max_dd 1200 / sharpe 1.4 / pf 1.6`), deliberately **not** the worker's, so this is a second path and not a re-run of their instrument.

```
[NO-CRISIS] score=17.7 passed=True veto=False reason=''
[CLEAN]     score=17.7 passed=True veto=False reason=''       -> identical on score, passed AND reason
[BREACHED]  score=0.0  passed=False veto=True
            reason="crisis-stress-breach: scenario '2008_gfc' max_drawdown $9999 exceeds firm_max_dd $2000"
[CRASHED]   score=0.0  passed=False veto=True
            reason="crisis-stress-unevaluated: scenario '2008_gfc' did not complete ('boom'); its drawdown is unknown, not zero"
```

**Regression claim — reproduced digit-for-digit with the verbatim command:**
```
cd C:/Users/tonio/Projects/wt-h1-wave4-20260712
python -m pytest src/engine/tests/ -q -k "performance_gate or forge_score or stress or crisis"
-> 6 failed, 101 passed, 3 skipped, 8280 deselected, 16 warnings in 78.46s
```
`[MEASURED HERE]` The six by NAME: `test_performance_gate.py::TestPerformanceGate::test_tier1_passes` + `test_track3_strategy_regime_wiring.py::test_exit_style_d_on_crisis[{SilverBullet,OTE,Breaker,JudasSwing,PowerOf3}Strategy]`. **Failure-set diff EMPTY — CONFIRMED by name, not by count.**

⚠️ **Claim (c)'s number `28.8` is UNVERIFIABLE as published.** `AR-678` never names its stats fixture. `[MEASURED HERE]` The three committed fixtures in `test_performance_gate.py` produce **63.0 / 10.0 / 0** (`_tier1_stats` / `_tier3_stats` / `_failing_stats`), base and clean alike. None is `28.8`. The *relation* the claim asserts (clean ≡ base) is TRUE and I verified it; the *number* is a recollection. Same species as `R-634`'s catch, one layer down.

---

### Discrepancy F-G1: the F-1 repair has NO PATH TO RED — deleting it entirely changes nothing
**Severity:** CRITICAL (silent disagreement — a guard that cannot fail is not a guard)
**Claim:** `AR-678` — *"`F-1` STAYS CLOSED"*, `AR-677` — *"ALL THREE ARMS AS STAGED"*.
**Reality:** True today, and **nothing in the repository will notice when it stops being true.**
**Sources compared:**
- source A — exact-string sweep: `crisis-stress-unevaluated` appears in **1** `.py` file tree-wide, `performance_gate.py:328`. **Zero test files.** `[MEASURED HERE]`
- source B — filesystem sweep across **all 20+ trees** under `C:/Users/tonio/Projects`: the string appears in exactly **3** files — `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md`, `performance_gate.py`. **The red-proof exists in prose and in production code, and in no test, in no tree.** `[MEASURED HERE]`
- source C — **mutation, in-memory, nothing written to the shared tree**:

| run | probe CRASHED veto | probe BREACHED veto | population result |
|---|---|---|---|
| `TF_MUT=NONE` (control) | True | True | **6 failed, 101 passed, 3 skipped, 8281 deselected** |
| `TF_MUT=ERRARM` — **delete the entire F-1 repair** | **False** | True | **6 failed, 101 passed, 3 skipped, 8281 deselected** ← *identical, same 6 names* |
| `TF_MUT=DDARM` — delete the pre-existing DD arm ✅ **POSITIVE CONTROL** | True | **False** | **7 failed, 100 passed** — `TestForgeScore::test_crisis_veto_triggers_on_dd_breach` goes **RED** |

**Source of truth:** the mutation. The DDARM control proves the instrument *can* convict a deleted veto arm; ERRARM proves it does not convict the deleted F-1 arm. This is a positive-controlled absence, not a bare null.
**Fix point:** `src/engine/tests/test_performance_gate.py` — one test asserting the CRASHED shape `{"passed": False, "max_drawdown": 0, "error": ...}` yields `crisis_veto is True` and `score == 0.0`. `[MEASURED HERE]` `test_performance_gate.py` contains **zero** occurrences of the key `"error"`.
**Repro:**
```
export PYTHONPATH=<scratch-with-mutgate.py>
TF_MUT=ERRARM python -m pytest src/engine/tests/ -q -p mutgate -k "performance_gate or forge_score or stress or crisis"
TF_MUT=DDARM  python -m pytest src/engine/tests/ -q -p mutgate -k "performance_gate or forge_score or stress or crisis"
```
**Blast radius:** the promotion gate. The `passed is False` condition was already silently reverted once (`67bc4178` → `6b03a61c`) — deliberately and correctly. **The identical revert of the `"error"` condition would be invisible.** This is `feedback_green_law` / `red-path-decay` at the money path.

---

### Discrepancy F-G2: the comment left in the code to protect the revert is REFUTED by the real producer
**Severity:** CRITICAL (false negative on a hard veto — and the false statement is now a permanent instruction to future readers)
**Claim (verbatim, `AR-678 §184`, and shipped as a code comment at `performance_gate.py:331-341`):**
> *"every scenario `stress_test.py` can produce with `passed=False` already carries either a real `max_drawdown` (`:122-124`, **caught by the DD compare**) or an `error` key (`:132-138`, caught above), so it added no coverage."*

**Reality:** `[MEASURED HERE]` **FALSE whenever the configured `prop_firm_max_dd` is below the gate's hardcoded `2000.0`.** The `max_drawdown` is real; it is **not caught**, because the two halves of one rule compare against different numbers.

Two-hop test using the **REAL producer** `run_stress_test` feeding the **REAL consumer** `compute_forge_score` — no hand-built dicts:

```
  cfg_dd  scen_dd | st.passed sc.passed has_error | gate.veto gate.passed  score
    2000     1800 |      True      True     False |     False        True   17.7
    2000     2500 |     False     False     False |      True       False    0.0
    1500     1800 |     False     False     False |     False        True   17.7  <== STRESS TEST SAYS FAIL, GATE SAYS PASS
    3000     2500 |      True      True     False |      True       False    0.0  <== STRESS TEST SAYS PASS, GATE SAYS VETO
```

**Sources compared:** [`stress_test.py:171` → `request.prop_firm_max_dd` (configured) | `performance_gate.py:318` → `firm_max_dd` (hardcoded `2000.0`, never passed) | `backtester.py:8410-8420` → `full_forge_score(..., crisis_results=crisis)` with **no `firm_max_dd=`**]
**Source of truth:** the configured `prop_firm_max_dd` — it is the operator's firm limit; the gate's `2000.0` is a default nobody set.
**Fix point:** `src/engine/backtester.py:8410` — pass `firm_max_dd=config.get("prop_firm_max_dd", 2000.0)`, the same expression already used at `:8396`.

🛑🛑 **THE LINK THE DESK TREATED AS TWO SEPARATE ITEMS IS ONE DEFECT.** `Q1` (*"is Option B's safety inherited rather than designed?"*) and `Q2` (`F-1b`) have the same answer: **Option B is safe only because `F-1b` is latent.** The `passed is False` condition Option B reverted is the **only** thing that catches the `1500/1800` row. Option A would have caught it; Option B does not.
➡️ **CONSEQUENCE THE DESK MUST NOT MISS:** the code comment is engineered to stop a future reader restoring that condition. **If `F-1b` is fixed and the comment is believed, nothing breaks.** But **if the operator ever sets `prop_firm_max_dd < 2000` while `F-1b` stands, the comment is actively wrong and the gate silently passes a stress-test failure.** Correct order: **fix `F-1b` first**, then the comment becomes true. It is false as written today.

---

### Discrepancy F-G3: a stress test that crashes WHOLESALE deletes the crisis evaluation — F-1's own class, one level up, closed by neither option
**Severity:** CRITICAL (false positive on a promotion-gate number)
**Claim:** *"a crisis scenario that did not compute no longer scores as a clean pass."*
**Reality:** True per-scenario for `(ValueError, IndexError, KeyError)` only. For every other exception type the scenario dict is **never constructed** and the whole crisis result is discarded.
**Sources compared:** `[MEASURED HERE]` planted raiser inside `_run_crisis_backtest`'s inner `run_backtest`:
```
ValueError        -> run_stress_test RETURNED  passed=False scenarios=8 with_error_key=8
KeyError          -> run_stress_test RETURNED  passed=False scenarios=8 with_error_key=8
IndexError        -> run_stress_test RETURNED  passed=False scenarios=8 with_error_key=8
RuntimeError      -> PROPAGATED OUT of run_stress_test
TypeError         -> PROPAGATED OUT of run_stress_test
ZeroDivisionError -> PROPAGATED OUT of run_stress_test
```
Then `[MEASURED HERE, reading the executable lines]` `backtester.py:8432-8434`:
```python
except Exception as e:
    print(f"Stress test skipped: {e}", file=sys.stderr)
    result["crisis_results"] = None
```
`performance_gate.py:295` is `if crisis_results is not None:` → **the loop never runs, no veto, full score.** `[MEASURED HERE]` `compute_forge_score(stats, crisis_results=None)` → `passed=True, veto=False, score=17.7`.
🛑 **Second hop, worse:** `full_forge_score` at `:8410` is *inside the same `try`, after* `run_stress_test`. When the stress test raises, **the crisis-aware rescore never happens at all** and `result["forge_score"]` silently retains the crisis-blind value computed earlier at `:5592-5609`. The only trace is one line on stderr.
**Source of truth:** the exception. A stress test that blew up is not a stress test that passed.
**Fix point:** `src/engine/backtester.py:8432` — a stress-test exception must produce a **veto sentinel**, not `None`. `crisis_results = {"scenarios": [{"name": "stress_suite", "passed": False, "max_drawdown": 0, "error": str(e)}]}` reuses the arm that already works.
**Blast radius:** identical to F-1 — promotion gate, `forge_score`, `forge_score_components`, everything downstream of `passed`.

---

### Discrepancy F-G4: four more scenario shapes the crisis loop scores as clean
**Severity:** HIGH (schema drift → silent false pass)
`[MEASURED HERE]`, fed to `compute_forge_score` directly:

| shape | result |
|---|---|
| `crisis_results = {}` (no `scenarios` key) | `veto=False passed=True score=17.7` — **silent** |
| scenario missing `max_drawdown` key | `veto=False passed=True score=17.7` |
| `max_drawdown = NaN` | `veto=False passed=True score=17.7` (`nan > 2000.0` is `False`) |
| `max_drawdown = None` or `"9999"` | **raises `TypeError`** → caught by `backtester.py:8432` → `crisis_results=None` → **no veto** (F-G3's path) |
| `scenarios = None` | **raises `TypeError`** → same swallow |

**Source of truth:** `s.get("max_drawdown", 0.0)` defaults an *absent* measurement to a *passing* value — the exact vacuity shape F-1 was raised for, still present on the neighbouring key.
**Fix point:** `performance_gate.py:296-298` — treat a missing/None/non-finite `max_drawdown` as unevaluated (route it to the `crisis-stress-unevaluated` arm), and treat a non-empty `crisis_results` with no usable `scenarios` as unevaluated rather than as absent.
**Repro:** `compute_forge_score(STATS, crisis_results={"passed": False, "scenarios": [{"name":"x","passed":False,"max_drawdown":float("nan")}]})`

---

## 3. HONEST NULLS — I went looking and found nothing. Each is a complete answer.

**Q4 — is `crisis_veto`'s `break` correct? ✅ YES. NO REFUTATION FOUND.** `[MEASURED HERE]` `break` only ever executes *after* `crisis_veto = True`, so no entry can mask a later one. All three orderings veto:
```
CLEAN-then-CRASHED   -> veto=True  reason=crisis-stress-unevaluated 'crashed_second'
BREACH-then-CRASHED  -> veto=True  reason=crisis-stress-breach 'breach_first'
CRASHED-then-BREACH  -> veto=True  reason=crisis-stress-unevaluated 'crashed_first'
```
Only the *reason string* reports the first hit, which can under-describe a worse later scenario. Cosmetic, not a gate defect.

**Sign convention — CHECKED, CLEAN.** I suspected `max_drawdown` might arrive negative (the gate's own caller wraps it: `abs(oos.get("max_drawdown", 0))` at `backtester.py:8415`, while `stress_test.py:122` and `:171` do **not**). `[MEASURED HERE]` `backtester.py:5463` `drawdown_dollars = peak - equity  # positive = how much lost from peak`; `:5464` `max_dd = float(np.max(...))`. Positive by construction at both producer sites (`:5464`, `:7685`). **Not a defect. Dead lead, reported as such.**

**Q1 sole-producer — CONFIRMED, not refuted.** `[MEASURED HERE]` `run_stress_test` has exactly **one** non-test call site (`backtester.py:8398`); `crisis_results=` reaches the gate from exactly **one** non-test site (`backtester.py:8420`); `compute_forge_score` has one non-test importer. Filesystem sweep across all trees for `prop_firm_max_dd` returned **40 files, 5 distinct basenames, all `.py`** — no JSON, no TS, no YAML producer. The worker's `[UNENUMERATED]` flag at `AR-678 §157` was appropriately cautious; **the enumeration now supports it.** ➡️ But note F-G2: **the hole does not need a third producer.** The same producer opens it.

**Q2 `F-1b` — MEASURED: LATENT, NOT LIVE — and one config line from LIVE.** `[MEASURED HERE]` Every firm in the registry has `max_drawdown: 2000` — `firm_config.py:127` (topstep_50k), `:152` (mffu_50k), mirrored in `firm-rules-version.ts` (`FIRM_CONFIGS_TS` + `FIRM_RULES_TS`, all four blocks `2000`). No non-test site anywhere on the filesystem assigns `prop_firm_max_dd`. ⚠️ **But it is a first-class `StressTestRequest` field read from an arbitrary caller dict (`config.get("prop_firm_max_dd", 2000.0)`), and `test_config.py:268` already exercises `1500.0`.** It is designed to vary. **LATENT today; F-G2 is what it costs the day it varies.**

---

## 4. MANDATORY COVERAGE SECTION

### 4.1 What I verified, and via which two-plus non-overlapping paths
| claim | path A | path B | path C |
|---|---|---|---|
| (a) CRASHED | independent fixture in `arms.py` (not the worker's stats) | `mutgate` in-process probe at `pytest_configure` | ERRARM mutation flips it to `veto=False` |
| (b) BREACHED | `arms.py` reason string reproduced byte-for-byte | source read of the untouched f-string at `:320-323`; blob-diff shows `6b03a61c` did not touch that block | DDARM mutation turns `test_crisis_veto_triggers_on_dd_breach` red |
| (c) CLEAN | `arms.py` — score, `passed` **and** `crisis_veto_reason` all equal to the no-crisis base | committed `test_crisis_veto_all_pass_no_score_change` asserts the same relation | attempted third path (reproduce `28.8`) **FAILED** — reported as SPLIT |
| regression | verbatim `-k` command, full run, 6 names | `TF_MUT=NONE` control run, same collection | `comm`-style name comparison against `R-635`'s independently reproduced headline |
| F-G2 | `stress_test.run_stress_test` real producer → real gate | source read of both threshold expressions | `firm_config.py` / `firm-rules-version.ts` registry values |
| F-G3 | planted raiser, 6 exception types | source read of `backtester.py:8432-8434` executable lines | `compute_forge_score(crisis_results=None)` measured directly |

### 4.2 Positive-control witnesses for every absence claim
- **"the F-1 arm has no test"** → `TF_MUT=DDARM` deleted a *different* veto arm and the same population went **7 failed / 100 passed**, naming `test_crisis_veto_triggers_on_dd_breach`. The instrument convicts a covered arm; it did not convict this one.
- **"`crisis-stress-unevaluated` appears in no test, in no tree"** → the same sweep positively returned 3 files (2 docs + the production module), so its null is meaningful.
- **"zero non-test callers pass `firm_max_dd=`"** → the same grep positively returns `prop_firm_max_dd=` at `backtester.py:8396` and `stress_test.py:213`, and `prop_firm_max_dd=1500.0` at `test_config.py:268` — it finds this argument shape *including a non-2000 value*.
- **"no config sets `prop_firm_max_dd`"** → the filesystem sweep positively returned 40 files across 20+ trees; the null is "no *non-`.py`* file", not "no files".
- **"the primary tree has 0 hits"** → ⚠️ **that was MY false negative, caught by law 10.** `C:/Users/tonio/Projects/trading-forge/src` **does not exist**; `git rev-parse --git-common-dir` resolves to `trading-forge/**trading-forge**/.git`. Re-run against the real path returned the expected 4 hits. Recorded because the near-miss is the lesson.

### 4.3 Join keys checked
- "unchanged / byte-identical" between commits → **git blob sha** per file (table §0), not diff-looks-empty.
- "the reason string is unchanged" → the **f-string source text** at `:320-323` plus the **rendered output**, both compared.
- "the same 6 failures" → **test node IDs**, not the count `6`.
- "the population is the campaign baseline" → the **verbatim `-k` expression**, shipped with every count below (`R-634`'s law).
- "the tree I measured is the tree under grade" → `git rev-parse --git-common-dir`, not `--show-toplevel`.

### 4.4 🛑 WHAT I DID NOT VERIFY
1. **The literal `28.8`.** Not reproducible from any committed fixture; `AR-678` does not publish its stats. Graded SPLIT, not refuted.
2. **Whether the 5 `track3` crisis failures relate to F-1.** `R-635`/`AR-679` measured `40 failed / 9 passed` on base and changed alike; I reproduced the 5-in-my-population but **did not** re-run the 49-test standalone file. `[RELAYED from AR-679, CORROBORATED only for the 5 inside my `-k`.]`
3. **The database.** I did not query Postgres for a stored strategy config carrying `prop_firm_max_dd`. My filesystem null covers files only. If configs are persisted as JSONB, **F-1b's LATENT verdict is filesystem-scoped and could be wrong.** ⚠️ Named as the single biggest hole in this grade.
4. **Whether `NaN` `max_drawdown` is actually producible** by `run_backtest`. F-G4's NaN row is a measured *gate* behaviour; that a NaN can *reach* it is `[HYPOTHESIS]`.
5. **Any non-Python consumer of `forge_score_components.crisis_veto`.** I enumerated producers, not the TS/frontend readers of the vetoed value.
6. **The 6 pre-existing failures themselves** — out of scope, still undiagnosed, unchanged by this repair.
7. **Runtime/deployed behaviour.** Everything here is this worktree at blob `29d988e1`. `LANDED ≠ RUNNING`.

---

## 5. RECOMMENDED ORDER (not authorization — the desk's call)
1. **F-G1** — one test for the CRASHED arm. Cheapest, and it is the thing standing between this repair and a silent revert.
2. **F-G2 / `F-1b`** — pass `firm_max_dd=` at `backtester.py:8410`. **Then** the shipped comment becomes true. Until then it is false as written.
3. **F-G3** — veto sentinel instead of `crisis_results = None` at `backtester.py:8432`.
4. **F-G4** — route absent/non-finite `max_drawdown` to the unevaluated arm.

**Verdict: the repair does what it says. Nothing guarantees it will keep doing so, and the note it left behind to defend itself is not true.**
