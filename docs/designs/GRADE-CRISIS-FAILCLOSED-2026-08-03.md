# GRADE — independent verification of `eac48f29` (crisis fail-closed packet, R-639 §6.2 / R-644)

**Grader:** `accuracy-validator` (independent; doer ≠ grader)
**Date:** 2026-08-03
**Subject commit:** `eac48f292db24ee4e7c2fde0426a1a09809cd002` on `h1-wave4-sealed12-driver`
**Tree:** `C:\Users\tonio\Projects\wt-h1-wave4-20260712` (linked worktree; `git rev-parse --git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`)
**Report under grade:** AR-689 (landed at `f24fed2a`)

## 0. PIN INTEGRITY AND LINEAGE

**HEAD MOVED DURING THIS GRADE.** At dispatch the pin was `eac48f29`; HEAD was already `f24fed2a` (AR-689's own report commit). `[MEASURED HERE]` `eac48f29` **is** an ancestor of `f24fed2a`, and all four subject blobs are **byte-identical at pin, at HEAD, and in the working tree**:

| file | blob (pin = HEAD = worktree) |
|---|---|
| `src/engine/backtester.py` | `d359a8f4bec0f19fe588782b132a48f67c7fd455` |
| `src/engine/performance_gate.py` | `d6b7c45f99eaac9f6a1911d49299946aa4808a38` |
| `src/engine/tests/test_crisis_fail_closed.py` | `830c47df6d0716a7d7772378f4b86026effffac9` |
| `src/engine/tests/test_performance_gate.py` | `57880b8a654a5291e1da8c502c60b044c1e6e0f3` |

So this verdict describes **what is actually running now**, not only the pin. `[MEASURED HERE]`
One unrelated path was dirty in the shared tree throughout (` M src/engine/tests/test_synthetic_market_simulator.py`) — a live worker seat. It is outside the regression population and was never touched.

🛑 **LINEAGE DECLARED (grading rule 2).** My own lineage produced `GRADE-F1-CRISIS-VETO-2026-08-03`, which raised findings **F-G1, F-G2, F-G3 and F-G4** — the findings this commit repairs. I did not design or build this repair, but I am **grading the fix to defects my own lineage convicted**. That is a structural non-independence and it is declared here rather than assumed away.

✅ **NO CLAIMED BAND TO RECONCILE.** AR-689 states *"I DO NOT GRADE THIS"* and requested this grade. There is no doer-issued band, so no >1-band reconciliation is owed. That is correct doer behaviour and is noted in the work's favour.

## 1. VERDICT

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| Crisis fail-closed packet `eac48f29` (members 1–3) | **7** | **VERIFIED** | 4-arm red-proof reproduced from the shipped commit; name-level regression set-diff with positive-controlled comparator; AST+text verbatim proof; 44-case gate input sweep; 5 mutants; per-test vacuity instrument | **F-1 (HIGH)** member 2's guard is defeated by a one-token indirection → crashed stress suite scores **60.1, passed=True** while the suite stays fully green. **F-2 (MEDIUM)** the except handler is no longer exception-safe. **F-4 (INFO)** the gate raises rather than fails closed on non-list `scenarios` |

**Band 7, not 8:** the repair's *behaviour* is correct on every input I could reach and is well red-proofed, but the crash path — the whole point of member 2 — has **no behavioural test at all**, and its only guard is structurally defeatable (F-1, measured three ways). **Not 9:** an open HIGH.
**All three verbatim claims are CONFIRMED.** The defect I found is in the **guard**, not in the repair.

### Claim-by-claim

| # | Claim | Status |
|---|---|---|
| 1 | Four-arm deletion red-proof, every arm convicts only its own guard, clean control | **CONFIRMED** |
| 2 | Regression `4 failed, 119 passed` → `4 failed, 130 passed`; same 4 failures name-for-name; +11 = exactly the 11 added; no test changed verdict | **CONFIRMED** (via a stronger path than the worker used) |
| 3 | `crisis_results=None` still means "no crisis stage ran", still does not veto — asserted, not assumed | **CONFIRMED** (and independently red-proofed) |
| ★ | "The rescore body moved **VERBATIM**" (the flagged highest-risk deviation) | **CONFIRMED** mechanically, AST + text |
| + | R-644 §3 fixtures carry real under-limit drawdowns; §4 positive witnesses added | **CONFIRMED** |
| + | No existing test became vacuous | **CONFIRMED** by an independent instrument |
| + | No false-positive veto (healthy crisis still scores normally) | **CONFIRMED** |

## 2. CLAIM 1 — THE FOUR-ARM RED-PROOF · CONFIRMED

Each arm materialised fresh from the **shipped commit** (`git archive eac48f29 | tar -x -C <scratch>`), one deletion each, with **two assertions the worker's method did not state**: the target text occurs exactly once and the mutation changed the file, and the file **still compiles** (a syntax error would fail everything and fake a broad conviction). `[MEASURED HERE]`

| arm | deletion | CONVICTED (excl. pre-existing `test_tier1_passes`) | totals |
|---|---|---|---|
| CONTROL | none | **NONE** | `1 failed, 41 passed` |
| 1 | `firm_max_dd=` kwarg | `test_rescore_threads_configured_firm_max_dd` | `2 failed, 40 passed` |
| 2 | `except` → `crisis_results = None` | `test_stress_crash_handler_emits_sentinel_and_rescores` · `test_no_except_handler_sets_crisis_results_to_none` | `3 failed, 39 passed` |
| 3 | usable-`max_drawdown` check | `…_on_missing_max_drawdown` · `…_on_non_finite_max_drawdown` | `3 failed, 39 passed` |
| 4 | empty-`scenarios` veto | `test_crisis_veto_triggers_on_empty_scenarios` | `2 failed, 40 passed` |

**Reproduces the worker's table exactly. No arm bleeds into another's guard. The control is clean.** `[MEASURED HERE]`

## 3. CLAIM 2 — REGRESSION · CONFIRMED, VIA A NON-OVERLAPPING PATH

The worker compared **counts** (`119` → `130`). A count diff cannot see a swap: one test going red while another goes green nets to zero. I built a **name-level** instrument instead — per-test `nodeid → verdict`, set-diffed.

**The comparator carries its own positive control**: before the real comparison it plants one verdict flip and one vanished test into a copy of the data and asserts it reports both. `[MEASURED HERE]` `>>> CONTROL OK: comparator detects flips and disappearances`

Population derived independently from the worker's own stated rule (test files naming `forge_score` / `crisis_results` / `run_stress_test`) → **the same 7 files** under `src/engine/tests/`.

```
base(parent)=123  new(pin)=134  added=11  removed=0  changed=0
FAILED at base == FAILED at new, name for name:
  test_no_double_deduction_same_rate · test_1min_bars_is_globex
  test_walk_forward_mode · test_tier1_passes
```

**0 of 123 shared tests changed verdict. 0 disappeared. 11 added, all PASSED — and they are exactly the 11 new tests, by name.** `[MEASURED HERE]` This is exhaustive over the population, not a sample, so no confidence bound is owed.

### F-3 (LOW/INFO) — the population boundary is narrower than its own stated rule, but the omission is harmless

The stated rule is "**every** test file naming forge_score / crisis_results / run_stress_test". Applied to the whole tree that yields **9** collectable test files, not 7 — `./test_e2e.py` and `./tests/test_track_b_fixes_2026_06_29.py` were excluded by an unstated `src/engine/tests/` scoping. (This is my own recorded trap `git_pathspec_double_star`: a directory-scoped surface silently drops top-level files.)

**I ran both excluded files at parent and at pin rather than assuming:** `[MEASURED HERE]`
- `test_e2e.py` — **collection ERROR at both revisions**, identically (`DataLoadConfigError: S3 read`). Uncollectable here either way.
- `tests/test_track_b_fixes_2026_06_29.py` — **`25 passed` at parent, `25 passed` at pin.**

**The under-scoping hid nothing. Measured, not assumed.** Severity LOW — the boundary should be stated as scoped, since the rule as written is wider than the set used.

## 4. ★ THE HIGHEST-VALUE TARGET — "THE RESCORE BODY MOVED VERBATIM" · CONFIRMED

Verified **two ways**, mechanically, not by reading.

**Path 1 — AST (semantics).** Parsed the old inline block out of `eac48f29^` and the `_rescore_with_crisis` body out of `eac48f29`, dedented both, and diffed `ast.dump` statement by statement. **The only semantic delta in the entire moved body:**

```
+   keyword(arg='firm_max_dd',
+     value=Call(func=Attribute(value=Name(id='config'), attr='get'),
+                args=[Constant('prop_firm_max_dd'), Constant(2000.0)]))
```

That **is** member 1, declared in the packet. Every other statement is identical.

**Path 2 — normalized text** (catches comment drift, which an AST diff discards). Entire diff:

```
+    firm_max_dd=config.get("prop_firm_max_dd", 2000.0),
+return _stress_forge_result
```

The added `return` is helper-only and does not touch `result`. **The P0-1 comment travelled verbatim** — it produced no diff line. `[MEASURED HERE]`

**Extraction scope-safety — the failure mode an AST-identical move can still cause.** Extracting a block out of `main()` silently deletes its local bindings. I checked every name the block bound, in the **parent**, for any later read inside `main()`: `[MEASURED HERE]`

| name | last occurrence in parent | read after the moved block? |
|---|---|---|
| `_stress_forge_result` | 8423 (inside block) | **no** |
| `full_forge_score` | 8410 (inside block) | **no** |
| `oos` | 8417 (inside block) | **no** |
| `mc` | 8419 (inside block) | **no** |

**No orphaned reads. The extraction is scope-clean.** The worker's verbatim claim is truthful and the widest-blast-radius deviation is sound.

## 5. NOVEL HUNT — RESULTS

### ★★ F-1 (HIGH) — `TestMember2Wiring` is defeated by a one-token indirection; a crashed stress suite then scores 60.1 and PASSES

The worker conceded the AST test "would not catch a rewrite that keeps the call names and changes their meaning" and asked for exactly this. **I measured three such rewrites.** All keep both call names; all leave the committed suite at `1 failed, 41 passed` — the clean control. `[MEASURED HERE]`

| mutant | edit | suite | crashed stress suite scores | fail-open? |
|---|---|---|---|---|
| **PIN (as shipped)** | — | `1 failed, 41 passed` | **0.0**, `crisis_veto=True`, `passed=False` | no — correct |
| **M-A** | `_rescore_with_crisis(result, **None**, config)` | **`1 failed, 41 passed` — GREEN** | **60.1**, `crisis_veto=False`, **`passed=True`** | **YES** |
| **M-B** | `_blank = None; result["crisis_results"] = _blank` | **`1 failed, 41 passed` — GREEN** | **60.1**, `crisis_veto=False`, **`passed=True`** | **YES** |
| **M-D** | sentinel called, value **discarded**; hand-built crisis dict | **`1 failed, 41 passed` — GREEN** | **60.1**, `crisis_veto=False`, **`passed=True`** | **YES** |
| M-C | sentinel loses its `error` key | `4 failed` — **caught** (3 tests) | — | caught |

**M-B is the damning one.** `test_no_except_handler_sets_crisis_results_to_none` exists solely to stop `crisis_results = None` in an except handler. It matches only `ast.Constant` None, so binding `None` to a name first restores **the literal original F-G3 defect** and the guard never fires. `[MEASURED HERE]`

**Money-path consequence.** `60.1` is not an abstract number: `src/server/services/lifecycle-service.ts:3112` is `if (forgeScore < 50) {` — the executable CANDIDATE→TESTING gate, **measured at the executable line, not from the `forgeScore >= 50` comments** (all six other hits are captions). **A crashed stress suite would clear promotion.**

Severity HIGH because member 2's guard is the **only** guard on the crash path and `main()` has no end-to-end test.
**This is a guard-strength finding, not a defect in the shipped behaviour** — the code as landed is correct on every input tested.

#### REMEDY — built, and RED-PROOFED with the convicting instrument

A behavioural test needing **no click `CliRunner` and no canned backtest**: extract main's except-handler body by AST and **execute the shipped statements** with the real helpers bound, then assert the **outcome**. Three assertions: crisis recorded non-None · the rescore received *the same object* that was recorded · **`forge_score == 0.0` with `crisis_veto=True`**.

| tree | result |
|---|---|
| **PIN** | **3 passed** ✅ |
| M-A | 2 failed ✅ | M-B | 2 failed ✅ | M-C | 1 failed ✅ | M-D | 1 failed ✅ |

**GREEN at the pin, RED on all four mutants** — a proven path to red, verified with the instrument that convicts. Draft: `<scratch>/proposed_behavioural_test.py`. Recommend landing it as `TestStressCrashHandlerBehaviour` beside `TestMember2Wiring` (which should stay — it is cheap and catches deletion).

### F-2 (MEDIUM) — the crash handler is no longer exception-safe; a second raise escapes `main()`

The handler calls `_rescore_with_crisis` — **the same function that may have just raised inside the `try`** — with the same `result` and `config`, unguarded. When the failure cause lives in those objects, the second call raises again and **there is no handler above it**. `[MEASURED HERE]`

```
oos_metrics.max_drawdown is a string  -> ESCAPED main(): TypeError: bad operand type for abs(): 'str'
oos_metrics is not a dict            -> ESCAPED main(): AttributeError: 'list' object has no attribute 'get'
config is not a dict                 -> ESCAPED main(): AttributeError: 'list' object has no attribute 'get'
```

The pre-commit handler was `print(...)` + `result["crisis_results"] = None` — **neither can raise**, so `main()` always continued.

**Severity deliberately held at MEDIUM, not CRITICAL.** A dead `main()` produces no JSON, so the run fails **loudly**; this is a robustness/availability regression, **not a false-green**. **Reachability from production data is `[UNENUMERATED]`** — I did not demonstrate a real config or `oos_metrics` that triggers it. The control-flow property is measured; the trigger is not.
Cheap remedy: wrap the handler's rescore in its own `try/except` and fall back to recording the sentinel without a rescore.

### F-4 (INFO) — the gate RAISES on a non-list `scenarios` rather than failing closed

`compute_forge_score` raises `AttributeError`/`TypeError` when `scenarios` is a dict, string, int, `None`, or a list of strings. `[MEASURED HERE]`

**Contained today, and I verified the containment rather than assuming it.** Driving the shipped handler end-to-end, **every** malformed `run_stress_test` return still lands fail-closed, because the raise is caught and converted into a sentinel veto: `[MEASURED HERE]`

| stress outcome | forge_score | veto | recorded |
|---|---|---|---|
| raises `RuntimeError` | **0.0** | True | SENTINEL |
| `{"scenarios": "oops"}` | **0.0** | True | SENTINEL |
| `{"scenarios": None}` | **0.0** | True | SENTINEL |
| returns a `list`, not a dict | **0.0** | True | SENTINEL |
| healthy suite | 60.1 | False | dict |
| breach $1800 vs firm $1500 | **0.0** | True | dict |

`_rescore_with_crisis` is the **only** call site passing non-`None` `crisis_results` (the other two — `backtester.py:5576` and `:7738` — pass `crisis_results=None` explicitly), so the raise is contained **today**. It is a latent trap for any future caller outside a `try`.

### FALSE-POSITIVE CHECK — the gate does NOT veto everything · CONFIRMED

44 gate evaluations (22 input shapes × firm limits 1500 and 2000). `[MEASURED HERE]`
- **Healthy inputs still score normally**: single under-limit scenario → **60.10, passed=True**; healthy 3-scenario suite (400/900/1200) → **60.10, passed=True**; `crisis_results=None` → **60.10, passed=True**.
- **Member 1's discriminator is real**: `max_drawdown=1800` **vetoes at firm 1500** and **does not veto at firm 2000**. The two halves of the rule now compare against the same number.
- **Every unevaluated shape fails closed**: `{}`, `{"scenarios": []}`, `{"scenarios": [{}]}`, missing key, `None`, `NaN`, `±inf`, `"1800"`, `"abc"`, `True`. The `not isinstance(_raw_dd, bool)` exclusion is correct and load-bearing — without it `True` would coerce to `1.0` and pass.
- `crisis_veto` is **never reset to `False`** once set (all six assignments are `= True`).

### VACUITY HUNT — HONEST NULL, via an instrument that does not use verdicts at all

This is the class that triggered the ruling and is structurally invisible to a failure-set diff. I built a pytest plugin that patches `compute_forge_score` **before collection** and records, per test nodeid, every `(score, crisis_veto, passed)` outcome — then diffed parent vs pin.

```
shared tests calling compute_forge_score: 27
changed-outcome count: 0
```

**No existing test changed its forge-score outcome. None went vacuous.** `[MEASURED HERE]`
The three tests asserting on a degenerate value are all intentional and identical at both revisions: `test_crisis_veto_triggers_on_dd_breach` (0.0 by design), `test_crisis_veto_triggers_on_unevaluated_scenario` (0.0 by design), `test_failing_scores_low` (0.0 from bad stats, `crisis_veto=False`).

This **corroborates by a second, independent path** the worker's own catch of `test_crisis_veto_all_pass_no_score_change`, and I confirmed both R-644 §4 witnesses are present in the diff: that test gained `assert result_with_crisis["score"] > 0`, and `test_score_capped_at_100` gained `assert result["crisis_veto"] is False` + `assert result["score"] > 0` — the latter matters because `assert score <= 100` alone is satisfied by `0.0`.

## 6. CLAIM 3 — THE `None` DISCRIMINATOR · CONFIRMED AND RED-PROOFED

Asserted at `test_performance_gate.py`, inside `test_crisis_veto_triggers_on_empty_scenarios`:

```python
result_none = compute_forge_score(stats, mc_results=mc, crisis_results=None)
assert result_none["crisis_veto"] is False
assert result_none["score"] > 0
```

Note it asserts the **non-degenerate** form (`score > 0`), not merely `crisis_veto is False`.

**A present assertion is not a working one**, so I red-proofed it — **M-E**: made `crisis_results=None` also veto (`if crisis_results is not None:` → `if True:` with `(crisis_results or {})`). Result: **`8 failed, 34 passed`**, including `test_crisis_veto_triggers_on_empty_scenarios`. **The discriminator has a genuine path to red.** `[MEASURED HERE]`

⚠️ **INSTRUMENT SELF-CORRECTION.** M-E's first run reported `1 failed, 41 passed` — a **false negative**: an MSYS `/c/...` path leaked into a Windows-Python string and the mutation never landed, so I had re-run the unmutated pin. Caught by re-running with a Windows path and a mutation-landed assertion. The `8 failed` figure is from the run where the mutation is proven to have landed and compiled. Two further instrument faults are recorded in §7.

## 7. COVERAGE

### 7.1 Every command run, verbatim (Python is `& 'C:\Program Files\Python313\python.exe'`)

| # | command | result |
|---|---|---|
| 1 | `git rev-parse --git-common-dir` / `HEAD` / `eac48f29` | linked worktree; HEAD `f24fed2a` ≠ pin; pin **is** ancestor |
| 2 | `git rev-parse eac48f29:<f>` vs `HEAD:<f>` vs `git hash-object <f>` ×4 | all 4 blobs identical across all three |
| 3 | `git show eac48f29 --stat` | 5 files, +492/−44 |
| 4 | `git archive eac48f29 \| tar -x -C <scratch>/pin`; same for `eac48f29^` → `/parent` | scratch blobs == pin blobs |
| 5 | `python -m pytest src/engine/tests/test_crisis_fail_closed.py -q` | `8 passed` |
| 6 | `python -m pytest .../test_performance_gate.py .../test_crisis_fail_closed.py -q` @pin | **`1 failed, 41 passed`** (matches AR-689) |
| 7 | same, `test_performance_gate.py` alone @parent | **`1 failed, 30 passed`** (matches AR-689 baseline) |
| 8 | `grep -rlE "forge_score\|crisis_results\|run_stress_test" src/engine/tests/test_*.py` | **7 files** (= worker's population) |
| 9 | same grep tree-wide, `--include="test_*.py"` | **9** files → 2 excluded (F-3) |
| 10 | 7-file population @pin | **`4 failed, 130 passed`** |
| 11 | 6-file population @parent | **`4 failed, 119 passed`** |
| 12 | `verdicts.py` (nodeid→verdict) @parent, @pin | 123 / 134 verdicts |
| 13 | `compare.py` (positive-controlled set diff) | CONTROL OK; **added=11 removed=0 changed=0** |
| 14 | `arms.py {1..4}` + pytest per arm | arm table reproduced exactly (§2) |
| 15 | `mutants.py {A,B,C,D}` + pytest per mutant | **A/B/D GREEN**, C caught (§5) |
| 16 | M-E (`crisis_results=None` also vetoes) + pytest | **`8 failed, 34 passed`** |
| 17 | `probe_gate.py` (22 shapes × 2 firm limits) | 44 evaluations, table in §5 |
| 18 | `handler_flow.py` (shipped block, 6 stress outcomes + 3 re-raise triggers) | fail-closed table; 3 escapes |
| 19 | `score_actual_handler.py` @pin/mutA/mutB/mutD | pin **0.0**; A/B/D **60.1, passed=True** |
| 20 | `vacuum_plugin.py` @parent, @pin + diff | 27 shared, **changed=0** |
| 21 | `verbatim.py` (AST + text diff of the moved body) | one kwarg + one `return` |
| 22 | `python -m pytest test_e2e.py tests/test_track_b_fixes_2026_06_29.py` @both | collection ERROR both; **25 passed / 25 passed** |
| 23 | `grep -n forgeScore src/server/services/lifecycle-service.ts` | executable `:3112 if (forgeScore < 50)` |

### 7.2 Claims verified through TWO+ NON-OVERLAPPING PATHS

| claim | path A | path B |
|---|---|---|
| Regression / no verdict change | count totals reproduced (`119`→`130`) — the worker's path | **name-level `nodeid→verdict` set diff**, positive-controlled — sees swaps a count cannot |
| "Moved verbatim" | **AST-dump statement diff** (semantics) | **normalized-text diff** (comments) + parent-side orphaned-read census |
| Four-arm red-proof | worker's arm table (relayed) | **re-derived from `git archive eac48f29`** in 4 fresh trees with mutation-landed + compiles assertions |
| Fixture de-vacuation | worker's re-read of fixtures | **per-test `compute_forge_score` outcome recorder**, parent vs pin — uses no verdicts at all |
| `None` discriminator | assertion **read at the executable line** | **M-E red-proof** — 8 convictions incl. that test |
| Fail-closed on bad crisis input | **unit sweep** of `compute_forge_score` (44 evals) | **end-to-end shipped-handler execution** (6 stress outcomes) |
| Promotion threshold `50` | code comments (captions, ×6) — **rejected as evidence** | **executable line** `lifecycle-service.ts:3112` |

### 7.3 Positive-control witnesses (every absence claim has one)

| absence claim | witness that proved the instrument can go red |
|---|---|
| "no test changed verdict" | comparator planted a `PASSED→FAILED` flip **and** a vanished test; reported both before the real diff |
| "no arm bleeds into another's guard" | each arm asserts target-found-exactly-once + file-changed + **still compiles**; CONTROL run convicts only the pre-existing failure |
| "no existing test went vacuous" | instrument recorded 27 shared tests and **did** flag the 3 genuinely-degenerate ones — it is not blind to degeneracy |
| "`crisis_results=None` does not veto" | **M-E** made it veto → 8 convictions |
| "the wiring guard is blind to rewrites" | **M-C** (sentinel loses `error`) **was** caught — so the suite is not uniformly blind; A/B/D are specific holes |
| "proposed remedy closes F-1" | GREEN at pin, **RED on all four mutants** |
| "extraction orphaned no reads" | grep enumerated **every** occurrence of all 4 bound names in the parent, not just those after the block |

### 7.4 Join keys checked for every "identical / unchanged / matches" claim

- **Commit identity:** full 40-char SHA `eac48f29…cd002`, plus ancestry to HEAD.
- **File identity:** git **blob SHAs**, compared pin ↔ HEAD ↔ worktree ↔ scratch — not paths, not mtimes, not line counts.
- **Test identity:** full pytest **nodeid** (`file::Class::test`), path-separator-normalized — not counts, not test names alone.
- **Population identity:** re-derived from the worker's stated predicate, then compared as a **file set**.
- **Vacuity identity:** `(nodeid, score, crisis_veto, passed)` tuples joined on nodeid.
- **Verbatim identity:** `ast.dump` per statement (semantic) + dedented source lines (textual).

### 7.5 🛑 WHAT I DID **NOT** VERIFY

1. **`main()` end-to-end.** I never ran the click CLI with a real config and real data. My handler measurements **execute the shipped except-handler statements extracted by AST** — faithful to the handler, but they do not prove the surrounding `main()` reaches that block with the state I supplied. This gap predates the packet and the worker declared it.
2. **F-2 reachability.** The re-raise/escape is measured as a control-flow property with three synthetic triggers. **I did not demonstrate a production config or `oos_metrics` shape that reaches it.** `[UNENUMERATED]` — do not treat F-2 as a live incident.
3. **The database.** No Postgres query. Specifically **not** closed: whether any persisted JSONB config carries a non-`2000.0` `prop_firm_max_dd` (the open item AR-689 itself carried forward), and whether any historical `backtests` row was scored under the pre-fix crisis-blind path. Per my own recorded reference `two_trees_two_databases`, each tree's `.env` points at a **different** instance, so this needs the DB named before it is asked.
4. **The TypeScript consumer.** I read `backtest-service.ts:1123-1129` and `backtests.ts:506` and confirmed they consume `crisis_results` / `failed_scenarios` — corroborating the sentinel's superset shape — but **ran no TS test and no round-trip**. Whether the sentinel round-trips its Zod/Drizzle shape into `failed_scenarios` is **not verified**.
5. **`TF_STRESS_TEST_MODE=pipeline`** still sets `crisis_results = None` outside any except handler. AR-689 declares this as deliberate and I agree it is out of this packet's scope, but I **did not test** whether a pipeline-mode run can reach a promotion decision with that `None`.
6. **`stress_test.py:216`** is a second CLI that calls `run_stress_test` and `json.dump`s the result **without** ever calling `compute_forge_score` — so it applies **no crisis veto at all**. Out of scope here; flagged as an unexamined surface, not a finding.
7. **Non-determinism / flake.** Each measurement was run once (twice where an instrument was corrected). I did not repeat runs to bound flake. `test_tier1_passes` failed identically in every one of the ~20 runs, which is weak corroboration of stability only.
8. **Windows/CPython 3.13 only.** All results are bound to `C:\Program Files\Python313\python.exe` on this box. `[MACHINE-BOUND]`
9. **Scope bound.** Band 7 is scoped to: commit `eac48f29` · the 7-file regression population (+2 boundary files) · 44 gate-input evaluations · 5 mutants · 4 deletion arms · this engine and OS. The false-green hunt found **no false-green on any reachable input in an enumerated 44-case space** — that is a bound on the space I searched, **not** a claim that none exists.

### 7.6 Instrument faults I hit and corrected (recorded so the next reader does not trust them silently)

1. **`join`/`awk` comparator reported `PASSED` vs `PASSED` as CHANGED** — 123 false CHANGED rows. Replaced with the Python comparator and its positive control. *A comparator that flags everything is as useless as one that flags nothing.*
2. **My own proposed test contaminated the subject tree** — copying `test_grader_behavioural.py` into `<scratch>/pin` inflated the population to `4 failed, 133 passed`. Removed; re-measured back to **`4 failed, 130 passed`** before any further use.
3. **MSYS `/c/...` paths leaked into Windows-Python strings twice** — once silently dropping the M-E mutation (false negative, §6), once writing the vacuity JSON to a nonexistent path. Both re-run with Windows-form paths. *This is the access recipe's warning, and it cost me two measurements.*
4. **`handler_flow.py` hardcodes the pin's try/except**, so running it inside a mutant tree measured the **pin's** handler, not the mutant's — it reported all mutants fail-closed. Discarded and replaced with `score_actual_handler.py`, which extracts the handler **from the tree under test** by AST. *The neighbouring-object error, caught in my own instrument.*
5. **`grep -v test`** would have hidden `backtest-service.ts` (the string "backtest" contains "test"). Re-run without the filter.

## 8. RECOMMENDATIONS

1. **F-1 — land the behavioural crash-path test** (drafted and red-proofed above) beside `TestMember2Wiring`. Keep the AST test; it catches deletion cheaply. This is the one item that should not carry forward: it closes the only unguarded seam on the crash path.
2. **F-2 — wrap the handler's `_rescore_with_crisis` in its own `try/except`**, falling back to recording the sentinel without a rescore, so a second raise cannot escape `main()`.
3. **F-3 — state the regression population as `src/engine/tests/`-scoped**, or widen it to match its own wording. Harmless today, measured.
4. **F-4 — consider coercing a non-list `scenarios` to unevaluated** inside `compute_forge_score` rather than raising, so the gate is fail-closed at its own boundary and not only by grace of its caller's `try`.
5. **Open the DB question** (§7.5 item 3) naming which instance is being queried.

---
**Closing.** The three verbatim claims are **CONFIRMED**, the flagged high-risk extraction is **CONFIRMED verbatim and scope-clean**, and the fail-closed behaviour is genuinely comprehensive with **no false-positive veto**. The work is honest: the worker declared its deviations, refused to grade itself, and named the exact weakness I then measured. **Band 7 — VERIFIED**, held below 8 by one open HIGH in the guard (not in the repair) and no behavioural coverage of the crash path.
