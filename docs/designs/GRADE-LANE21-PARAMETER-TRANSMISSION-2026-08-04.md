# INDEPENDENT GRADE — Lane 21 parameter transmission + cache isolation

## START-RECEIPT (committed BEFORE dispatch, deliberately)

**Dispatched:** 2026-08-04, advisor seat `claude.exe 22684`, ruling `R-693`.
**Pinned commit:** `dd2371af`
**Grader:** `accuracy-validator` (this project's named fresh-eyes instrument).
**Receipt path:** this file. The grader appends its verdict below.

> **WHY THIS FILE EXISTS BEFORE THE VERDICT DOES.** `R-682` recorded a grade as
> *"DISPATCHED AND RUNNING"* with a receipt path that **never existed**, and the
> dispatching conversation was `/clear`ed. `TaskList` was measured BLIND in the same
> minute a background event arrived, so its emptiness proved nothing either way.
> The countermeasure minted then was **COMMIT THE START-RECEIPT FIRST**, and that is
> what this is. **If no verdict is ever appended below, the dispatch died and the
> grade is UNSATISFIED — that must be visible on disk, not inferable from silence.**

## THE CLAIM UNDER GRADE (verbatim — grade THIS, not a paraphrase)

> One enforced Python evaluator path now consumes parameters supplied through
> `ConditionBinding`, and distinct off-default values produce distinct production
> calculations and decisions without cache collision.

**Explicitly NOT under grade, and each is FALSE today — do not credit or refute them:**
transcript values reach this evaluator · `produce_spec_artifact` preserves numeric
parameters · sealed specs carry typed parameter objects · the flag-OFF path supports
parameterized conditions · a full moving-average strategy compiles · the compiler is
operational · the `30` inherited regression failures are harmless.

## DISPOSITION (grader writes exactly one)

`PASS` · `PASS_WITH_BOUNDED_FINDINGS` · `FAIL` · `UNVERIFIABLE`

**A `PASS` must stay scoped to the claim above.** An honest null —
*"no refutation found; here is what I covered and what I could not"* — is a complete
and valued answer. **A manufactured finding is worse than none.**

---

## VERDICT

**Grader:** `accuracy-validator`, independent seat. **Graded at:** `dd2371af781eccfe815291cf6deddbbe8d71103c`.
**Date:** 2026-08-04.

### DISPOSITION: `PASS_WITH_BOUNDED_FINDINGS`

**VERIFIED band 7** (adversarially tested, residual risks documented). Not 8: the refusal
doctrine this module states in its own docstring is measurably incomplete (F-2), and two
properties the claim itself asserts have **no path to red** (F-5, F-6).

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| Lane 21 enforced bias-parameter transmission @`dd2371af` | 7 | **VERIFIED** | 12 production mutations (8 required, all caught); wrapper-free replication with zero monkeypatching; independent from-scratch EMA oracle; AST import-closure regression, sha256-identical failure sets | F-1 wired-HTF branch discards accepted periods · F-2 unrecognised parameter keys silently defaulted · F-3 over-long slow period silently all-False · F-4 `direction="both"` gate hardcoded · F-5/F-6 unguarded key dimensions |

### PIN INTEGRITY (checked first, before any measurement)

Tree HEAD had **already moved** past the pin: `c972172d` (the START-RECEIPT commit above).
`dd2371af` is an ancestor. All four graded blobs are **byte-identical at the pin, at HEAD,
and in the shared working tree** — `MEASURED HERE` via `git ls-tree` + `git hash-object`:

```
b4a664d237d92bf57d0c3a16ccc0b1cdcca881ce  src/engine/spec_condition_compiler.py
81cc998b20a571922b561a854d5b8f5051bd0cc3  src/engine/tests/test_bias_parameter_transmission.py
e55e103e760e3fc6a82c820a7efda13e081a0696  src/server/services/executable-parameter-contract.ts
b175e34250963bc988cc63bb7e6f0b59b96d80bc  src/server/services/executable-parameter-contract.test.ts
```

`git diff dd2371af HEAD --` over the four files is **empty**. The pin is honoured.
All mutation work ran in two private worktrees I created — `C:\Users\tonio\avg-post`
(`dd2371af`) and `C:\Users\tonio\avg-pre` (`b9e4288c` = `dd2371af~1`). **The shared campaign
tree was never checked out, reset, or written to.**

### THE CLAIM IS CONFIRMED AS LITERALLY WORDED

Every clause holds under adversarial attack. Reproduced the author's headline numbers
exactly, `MEASURED HERE`: arms differ **22/200** bars; armA vs engine-default EMA(20/50)
**10/200**; armB **14/200**; **1** invocation for identical periods, **2** for distinct;
forbidden default set `{5,10,14,20,30,50,250}`.

**The strongest evidence is one the author never produced — WRAPPER-FREE REPLICATION.**
Every assertion in the author's file runs under a `monkeypatch` spy, so Q12 cannot be
answered from that file. I ran two probes with **zero monkeypatching**, no spy installed,
reading the value straight off the returned DataFrame:

- **Per-condition arrays differ on 22/200 bars** — spy-free, matching the spied figure.
- **`entry_long` differs on 4/200 bars** between a spec taught `EMA(7,90)` and one taught
  `EMA(31,120)`; ARM_A fires **4** entries, ARM_B fires **2**. **The author never measured
  this.** It is the finding that upgrades "decisions" from a diagnostic array to a real
  entry decision, and it is what makes the word *decisions* in the claim defensible.

**Independent oracle, not the production helper.** The author's `_ema_cross` calls
production `compute_ema`, so it shares an instrument with the code under test. I wrote an
EMA from first principles (`alpha = 2/(p+1)`, recursive, seeded on the first value, never
importing `compute_ema`): it puts the two arms **23/200** apart against production's
**22/200**, and agrees with the production arrays on **193/200** and **192/200** bars. The
7-8 bar gap is warm-up seeding (`compute_ema` emits **0** NaN bars, so it does not seed the
way mine does) — `HYPOTHESIS` as to mechanism, but the direction and magnitude corroborate
the claim through a path that touches none of production's arithmetic.

### MUTATION RESULTS — all 8 required mutations are CAUGHT

Production source mutated; **the permanent test file was never edited**. Baseline for both
named files: `0 failed, 26 passed`. Restored byte-identically after every run (verified by
`git hash-object` == `b4a664d2…`).

| # | Mutation | Result | Tests that go red |
|---|---|---|---|
| M1 | restore hardcoded 20/50 inside `_eval_wait_bias` | **CAUGHT** 2 failed | `…no_hardcoded_default_supplied_the_result`, `…decision_changes_on_controlled_bars` |
| M2 | keep new cache key, do not pass the periods | **CAUGHT** 4 failed | + `…primitive_is_invoked_with_the_periods`, `…absent_parameters_take_the_documented_default` |
| M3 | restore directional-boolean-only cache key | **CAUGHT** 5 failed | + `…different_periods_create_distinct_entries`, `…reversing_declaration_order_changes_nothing` |
| M4 | remove caching entirely | **CAUGHT** 1 failed | `…identical_periods_still_reuse_one_computation` |
| M5a | swap fast/slow at the handler call site | **CAUGHT** 3 failed | `…primitive_is_invoked…`, `…no_hardcoded_default…`, `…absent_parameters…` |
| M6 | accept `fast >= slow` | **CAUGHT** 1 failed | `…is_refused_not_defaulted[bad3-fast >= slow]` |
| M7 | replace invalid values with defaults | **CAUGHT** 3 failed | `…[bad0-zero]`, `…[bad1-negative]`, `…[bad2-non-integer]` |
| M8 | both conditions use the FIRST declared parameter set | **CAUGHT** 4 failed | `…primitive_is_invoked…`, `…no_hardcoded_default…`, `…decision_changes…`, `…reversing_declaration_order…` |

**My own four, beyond the brief:**

| # | Mutation | Result |
|---|---|---|
| M5b | swap fast/slow **inside** the primitive, *after* the spy has recorded the args | **CAUGHT** 2 failed |
| M9 | consume `fast_period` but silently keep the hardcoded slow leg (**partial** transmission) | **CAUGHT** 1 failed — `…no_hardcoded_default…` alone |
| M10 | off-by-one on the consumed fast period (`eff_fast + 1`) | **CAUGHT** 2 failed |
| M11 | drop `want_bearish` from the composite key, keep `parameters` | **UNCOVERED HOLE — see F-5** |

M5b and M9 matter: they are the two shapes that pass the *invoked-with* witness and can
only be killed by the array-equality witness. Witness 6 is therefore load-bearing on its
own, and M9 shows the guard set has real **single-leg** granularity (Q3).

### FINDINGS

#### Discrepancy F-1: the wired-HTF branch ACCEPTS the taught periods and DISCARDS them
**Severity:** HIGH (silent scope gap / false-green shape the fixture cannot see)
**Claim:** "distinct off-default values produce distinct production calculations and decisions"
**Reality:** With `htf_daily_trend` materialized and non-null on every bar, the primitive **is
invoked with `(7, 90)` and `(31, 120)`** — the author's Witness 3 would be **green** — yet the
two arms' decisions differ on **0/200 bars** and both arrays are **all-True**.
**Sources compared:** [spy call log: `[(7,90,False),(31,120,False)]` | armA vs armB decisions: `0/200` | both arrays all-True: `True`]
**Source of truth:** `spec_condition_compiler.py:800-801` returns `out` **before**
`eff_fast`/`eff_slow` are ever computed at `:815-816`. On a fully-wired frame the taught
periods are dead arguments.
**Fix point:** `src/engine/spec_condition_compiler.py:800-801` (the early `return out`) — or the
claim/docstring must say *proxy-fallback bars only*.
**Repro:** run the two-arm spec with `df.with_columns(pl.Series("htf_daily_trend", ["bullish"]*200))`.
**Blast radius:** `attach_htf_columns` is called by the **real backtester** at
`src/engine/backtester.py:6736`, so this is live infrastructure, not a dormant branch
(`MEASURED HERE`). The parameter channel exists **only on bars the real HTF signal does not
already decide**. This is the `cache-key-only` false-green one level deeper: *the argument
arrived* is not *the argument was read*. The fixture never materializes an HTF column, so
nothing in the permanent suite can see it.

#### Discrepancy F-2: an unrecognised parameter KEY is silently replaced by the engine default
**Severity:** HIGH (contradicts the module's own load-bearing docstring)
**Claim:** `_resolve_bias_periods` docstring, `:573-578` — *"A parameter that is PRESENT but
unusable … raises, naming the key — it is never quietly replaced by a default … a silent
substitution is exactly the parameter-loss channel this path repairs."*
**Reality:** a present parameter under an unrecognised key **is** quietly replaced by the default:

```
{'period': 7}                   -> NO REFUSAL; primitive called with (20, 50); differs from EMA20/50 on 0/200 bars
{'fast': 7, 'slow': 90}         -> NO REFUSAL; primitive called with (20, 50); differs from EMA20/50 on 0/200 bars
{'ema_fast': 7, 'ema_slow': 90} -> NO REFUSAL; primitive called with (20, 50); differs from EMA20/50 on 0/200 bars
{'fast_period': 7, 'slow_period': 90, 'signal_period': 9} -> third key silently dropped
```

**Source of truth:** `:582` iterates only `("fast_period", "slow_period")`; `:583` treats "key
not in params" as *not taught*. It cannot distinguish **not taught** from **taught under a
different name**.
**Fix point:** `src/engine/spec_condition_compiler.py:580-585` — reject unknown keys in `params`.
**Repro:** bind a WAIT_BIAS condition with `parameters=(("period", 7),)` under
`TF_FAMILY_META_ENFORCED=true` and read the spy's period tuple.
**Blast radius:** the producer end does not exist yet, so the key vocabulary is **unfixed**.
A producer emitting `period`/`fast`/`ema_fast` gets `EMA(20/50)`, no error, no trace — which
is precisely the parameter-loss channel this lane exists to close. This is the finding most
likely to bite the **next** lane.

#### Discrepancy F-3: a taught `slow_period` at or above the bar count silently returns all-False
**Severity:** MEDIUM
**Reality:** `slow_period=500` and even `slow_period=199` at `n=200` → **no refusal**, primitive
invoked with the taught value, array True on **0/200 bars**.
**Source of truth:** `:818` `if n < eff_slow + 2: return out` — the moving floor **relocates**
the silent-death threshold, it does not refuse. The author's own comment at `:811-814` names
all-False as *"INDISTINGUISHABLE from 'the parameter did not transmit'"* and then leaves that
exact outcome reachable one bar past the new floor.
**Fix point:** `src/engine/spec_condition_compiler.py:818` — raise instead of returning `out`.
**Repro:** `parameters=(("fast_period",7),("slow_period",199))` on a 200-bar frame.
**Blast radius:** a taught long period silently produces a permanently-false condition, which
in a strict-AND spine (`:1369-1370`) silently kills **every** entry for that spec. No test
covers `slow_period > N_BARS`.

#### Discrepancy F-4: `direction="both"` gates the long/short split with hardcoded EMA(20/50)
**Severity:** MEDIUM
**Reality:** primitive call log for a `direction="both"` spec teaching `(7,90)`:
`[(7, 90, False), (None, None, False)]` — a **second, unparameterized** evaluation decides the
entry direction.
**Source of truth:** `:1388-1392` reads the **legacy** `wait_bias_cache`, which `_h_wait_bias`
never populates under enforced dispatch (it writes `wait_bias_param_cache`, `:558`). So
`if False not in wait_bias_cache` is **always true** on the enforced path → a fresh
default-period array every time, both a parameter gap and a redundant computation.
**Fix point:** `src/engine/spec_condition_compiler.py:1388-1390`.
**Repro:** `{"direction": "both"}` spec, one parameterized WAIT_BIAS condition, spy the primitive.
**Blast radius:** every `direction="both"` spec. No test covers `direction="both"` with parameters.

#### Discrepancy F-5: the DIRECTION half of the composite cache key has no path to red
**Severity:** MEDIUM (unguarded mechanism claim — law 5 / law 8)
**Claim:** `:546-548` — *"DIRECTION STAYS IN THE KEY … two conditions with identical periods and
opposite directions must still not share a slot."*
**Reality:** the property is **correct today** (`MEASURED HERE`: bull vs bear with identical
periods → 2 invocations `[(7,90,False),(7,90,True)]`, arrays differ **200/200**) but **nothing
tests it**. Mutation **M11** (`cache_key = b.parameters`) is green on `0 failed, 26 passed`
across both named files **and** green across all **11 WAIT_BIAS-touching files in the
closure** (`275` tests, `5 failed → 5 failed`, zero new failures).
**Source of truth:** the mutation survived; the guard does not exist. The test file's own
`_spec` docstring explains it deliberately uses **one** direction throughout — a sound choice
for witnessing parameter separation, but it leaves the direction dimension unmeasured.
**Fix point:** `src/engine/tests/test_bias_parameter_transmission.py` — add an opposite-direction,
identical-period fixture asserting 2 invocations.
**Repro:** apply M11 to `:557`, run the 11-file WAIT_BIAS surface, observe no new red.
**Blast radius:** latent. A future edit collapsing the key would silently hand a bearish
condition the bullish array.

#### Discrepancy F-6: identical-period reuse depends on a tuple ordering nothing enforces
**Severity:** LOW
**Reality:** two conditions teaching the **same** periods with the items in **reversed tuple
order** produce **2** primitive invocations, not 1: `[(7,90,False),(7,90,False)]`.
**Source of truth:** `:557` keys on raw tuple identity. The permanent test never sees this
because its own helper `_plan` normalises with `tuple(sorted(params.items()))`. **The
harness supplies the canonical form that production does not enforce.**
**Fix point:** `src/engine/spec_condition_compiler.py:557` — normalise, e.g. key on
`tuple(sorted(b.parameters or ()))`.
**Blast radius:** duplicate computation only; values stay correct. Answers Q8 precisely.

#### F-7 (LOW, caption): `self._last_bias_periods = (eff_fast, eff_slow)` at `:817` is write-only
Zero readers repo-wide (`MEASURED HERE`, whole-`src` sweep). Dead assignment that reads like
an observability hook.

### THE AUTHOR'S NUMBERS, INDEPENDENTLY CHECKED

| Author's number | My measurement | Verdict |
|---|---|---|
| decisions differ 0/200 pre-repair, 22/200 post | 22/200 post; pre-repair revert → 0/200 | **CONFIRMED** |
| arm A vs default 10/200, arm B 14/200 | 10/200, 14/200 | **CONFIRMED** |
| real invocations: 1 pre-repair, 2 post | 1 (identical periods) / 2 (distinct) | **CONFIRMED** |
| 68-file import closure | **68** at PRE, 69 at POST (+1 = the new file) | **CONFIRMED** — derived independently by AST module-graph walk, not a name grep |
| PRE ≡ POST, failure NAME sets empty-diff | **empty diff**, sha256 `5cd376d8…` **both sides** | **CONFIRMED**, positive-controlled |
| PRE/POST 30 failed / 1203 passed | **35 failed / 1198 passed on both sides**; total 1233 both | **RECONCILED** — see below |
| contract suite 13 → 22 tests | 13 → 22 `it()/test()` declarations | **CONFIRMED** (static, `ARTIFACT-SOURCED`) |
| leaf out-degree 0 | 0 importers, 0 `src` imports | **CONFIRMED** (static) |

**The 30-vs-35 reconciliation is my instrument's gap, not a defect.** My worktrees use a
**sparse checkout** (`src` + `scripts`) because a full checkout of this commit dies on Windows
`MAX_PATH` inside `docs/replay-results/h1-scripts/frontier-birth-gate/result-cache/`. Exactly
**5** tests fail for want of `docs/`: 4 × `FileNotFoundError` in
`test_levelzone_population_a_resolver.py` (`docs/replay-results/h1-battery/levelzone-object-reference-census.json`,
`…/claude-rung-v32/shakedown_specs/*.spec.json`) and 1 ×
`test_role_demotion.py::test_real_committed_audit_file_loads_and_resolves_known_row`.
**35 − 5 = 30** and **1198 + 5 = 1203**. The author's absolute figures are corroborated; the
load-bearing claim (PRE ≡ POST) is confirmed independently of the discrepancy.

### THE 15 MANDATORY QUESTIONS

1. **Primitive truly consumes the periods, or tests manufacture the output?** — **CONSUMES.**
   Wrapper-free, spy-free run yields 22/200 differing per-condition and 4/200 differing
   `entry_long`. M1 goes red. The oracle `_ema_cross` is only ever *compared against*, never
   fed in; my independent scratch-EMA agrees on direction and magnitude.
2. **Both arrays from real production calculations?** — **YES.** No stub exists; the spy
   delegates to `original_eval`. Decisively, my two core probes install no spy at all.
3. **Does changing only ONE period alter invocation and output?** — **YES.** M9 (fast consumed,
   slow hardcoded) and M10 (off-by-one on fast) both go red. Single-leg granularity is real.
4. **Could the tests pass while the evaluator still uses 20/50?** — **NO.** M1 → 2 red.
5. **Could they pass if ONLY the cache key changes but the primitive stays hardcoded?** — **NO.**
   M2 → 4 red (key kept, periods not passed); M1 → 2 red (periods passed, ignored). Both
   halves are independently guarded — the specific false-green R-692 §3 forbids is closed.
6. **Could they pass if the cache is deleted entirely?** — **NO.** M4 → `…identical_periods_still_reuse_one_computation` red.
7. **Could declaration order contaminate one condition with the other?** — **NO.** M8 → 4 red, M3 → 5 red.
8. **Is identical-period reuse real?** — **YES for canonically-ordered tuples** (1 invocation,
   measured). **NO under reversed tuple order** (2 invocations) — **F-6**.
9. **Do invalid supplied periods hard-refuse without falling back?** — **YES** for the five
   covered shapes (zero, negative, float, `bool`, `fast >= slow`); M6/M7 red. **NO** for
   unrecognised keys (**F-2**) or over-long slow periods (**F-3**).
10. **Does an ABSENT parameter preserve legacy behaviour?** — **YES.** Unparameterized binding
    invoked with `(20, 50)`; array equals the default answer; corroborated by the empty-diff
    regression across 1233 tests.
11. **Is the mutation control the ACTUAL pre-repair defect shape?** — **YES.** I diffed the
    planted `reverted_handler` against the real pre-repair `_h_wait_bias` at `dd2371af~1`
    (`b9e4288c`): same bare `want_bearish` key, same `wait_bias_cache`, no periods passed. The
    only textual difference is `self._eval_wait_bias` → `original_eval(inner, …)`, the same
    function object. Independently corroborated: my **out-of-suite** revert (M3) goes red on
    5 tests, so the in-suite control is not the only witness.
12. **Do any tests depend on monkeypatching that bypasses production semantics?** — **No bypass.**
    The spy records and delegates. **And the claim does not rest on it:** my wrapper-free
    probes reproduce the core result with zero monkeypatching, reading `entry_long` off the
    returned DataFrame.
13. **Did the change affect unrelated families or dispatch paths?** — **NO.** Empty, sha-identical
    failure-name diff across the independently-derived 68-file closure, positive-controlled.
    `wait_bias_param_cache` has exactly two sites (creation `:1236`, sole reader `:558`);
    legacy `wait_bias_cache` untouched.
14. **Is the claim properly restricted to the enforced path?** — **YES, and the restriction is
    load-bearing.** `TF_FAMILY_META_ENFORCED` is **DEFAULT OFF**
    (`src/engine/family_meta_enforcement.py:55`). The word *enforced* in the claim is accurate
    and necessary; blast radius in the default configuration is **zero**. The author disclosed
    this rather than hiding it.
15. **Does the sorted inherited failure set remain identical before and after?** — **YES.** 35
    names both sides, sha256 `5cd376d842a36be587122e3211284c0c126aa481d2ceff979ef9da0346db1d2b`
    on both, with a live positive control on the diff instrument.

### WHAT THE CLAIM WOULD NEED TO SAY TO BE UNCONDITIONALLY TRUE

> One enforced Python evaluator path now consumes parameters supplied through
> `ConditionBinding` **on bars the real HTF signal does not already decide, for the two
> recognised key names `fast_period`/`slow_period`, when the taught slow period leaves at
> least two bars of margin**, and distinct off-default values produce distinct production
> calculations and decisions without **parameter-dimension** cache collision.

Every inserted qualifier is a measured finding above (F-1, F-2, F-3, F-5). None of them
refutes the claim; together they bound it.

---

## MANDATORY COVERAGE SECTION

### 1. What I verified, and via which non-overlapping paths

| Claim element | Path A | Path B | Path C |
|---|---|---|---|
| primitive consumes the taught periods | author's suite under spy (`MEASURED BY GRADED INSTRUMENT`) | **wrapper-free, spy-free** production run reading `entry_long`/`last_per_condition_bool` off the returned DataFrame (`MEASURED HERE`) | 12 production mutations vs the **unedited** test file (`MEASURED HERE`) |
| the arms' arrays are the ones their periods imply | production `compute_ema` oracle (author's `_ema_cross`) | **from-scratch EMA**, `alpha=2/(p+1)`, never importing `compute_ema`: 23/200 vs 22/200 (`MEASURED HERE`) | M1/M9/M10 all red |
| no cache collision (parameter dimension) | invocation-count assertions | independent spy on a hand-built plan, separate specs per arm (`MEASURED HERE`) | M3/M4/M8 all red |
| no regression | author's stated 30/1203 (`RELAYED`) | **my own AST import-closure** (68 files) run on PRE and POST, failure-name sha256 compared (`MEASURED HERE`) | positive control on the diff instrument |
| pin integrity | `git ls-tree` at pin and HEAD | `git hash-object` on the shared working tree + `git diff dd2371af HEAD` (`MEASURED HERE`) | — |
| enforced flag is default-OFF | source read `family_meta_enforcement.py:55` | `family_meta_enforced()` gating at `spec_condition_compiler.py:1206,1261` (`MEASURED HERE`) | — |

### 2. Positive-control witnesses — with VALUES, not the word PASS

- **Two arms are genuinely distinguishable:** `EMA7/90 vs EMA31/120 differ on 22/200 bars`.
- **Fixture periods are off-default:** engine defaults `[5, 10, 14, 20, 30, 50, 250]`;
  fixture periods `[7, 31, 90, 120]`; intersection **empty**.
- **Bar count clears the floor:** `N_BARS=200, longest slow leg=120, floor=122`.
- **Absent parameters still run** (so the refusal tests are not satisfied by an
  always-raising path): unparameterized binding invoked with **`[(20, 50)]`**.
- **Pre-repair defect is real:** reverted single-slot handler → decisions differ **0/200**.
- **Regression diff instrument is alive:** planting one fabricated failure name into a copy
  of the 35-name set → `CONTROL FIRED: diff detects a 1-name change`.
- **Mutation harness is alive:** 11 of 12 mutations produce red; the restored file hashes to
  `b4a664d2…` after every single run.
- **Direction separation genuinely works today** (the property M11 leaves unguarded):
  bull vs bear, identical periods → **2** invocations `[(7,90,False),(7,90,True)]`, arrays
  differ **200/200**.
- **Absence claim `_last_bias_periods` has no reader:** whole-`src` sweep returns the single
  write site `:817` and nothing else.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- **Pin ≡ HEAD ≡ working tree:** blob SHA-1 per file (four hashes listed above), not filename or mtime.
- **PRE ≡ POST regression:** sorted `FAILED|ERROR` **node-id name set**, joined on
  `file::class::test[param]`, compared by sha256 (`5cd376d8…` both sides) — not on counts,
  which would have hidden a swap.
- **Closure equivalence:** module dotted-name graph reaching `src.engine.spec_condition_compiler`,
  68 at PRE / 69 at POST joined on file path; the delta is exactly the new test file.
- **Mutation restoration:** `git hash-object` == `b4a664d237d92bf57d0c3a16ccc0b1cdcca881ce`.
- **Mutation control fidelity:** planted `reverted_handler` body vs the real `dd2371af~1`
  `_h_wait_bias`, compared statement by statement.
- **Arm ↔ array binding:** `condition_id` (`armA`/`armB`), so that "armA got armA's answer" is
  not inferred from ordering.

### 4. What I did NOT verify

- **`npx vitest run` and `tsc --noEmit` were never executed.** My sparse worktrees have no
  `node_modules`, and installing one into the shared tree risks a live sibling session. The TS
  numbers (13 → 22, out-degree 0) are **static/`ARTIFACT-SOURCED`** only; `tsc 0` and the
  `3 failed / 19 passed` TS mutation red-proof are **`RELAYED`, unverified**. The TS files are
  Lane 20 and outside this claim, so I chose the Python side; a reader wanting the TS lane
  certified must dispatch that separately.
- **No database, no SSE, no `audit_log`, no `correlation_id` trace.** This change touches none.
- **No live backtest, no real market data, no P&L.** Everything ran on a seeded synthetic
  200-bar frame (`seed=11`). **No first-principles P&L reconciliation was owed or done** —
  this change produces booleans, not currency.
- **F-1's production frequency is unmeasured.** I proved the wired branch discards the periods
  and that `attach_htf_columns` is called from the real backtester, but **not what fraction of
  real bars are wired**. If that fraction is high, the parameter channel is narrow in
  practice; if low, F-1 is mostly theoretical. That measurement needs real HTF cache data.
- **The full 68-file closure under mutation M11 was killed** (exit 137, resource kill). I
  substituted an enumerated 11-file WAIT_BIAS surface (275 tests). So F-5 is "uncovered across
  the WAIT_BIAS surface I enumerated", **not** "uncovered across the entire repository".
- **The 5 `docs/`-dependent regression failures were reconciled by their error text, not by
  re-running with `docs/` present** — a full checkout hits Windows `MAX_PATH` at this commit.
- **`_h_structure`'s sibling cache key (`:528`) was not re-graded here**; I graded it in a
  prior pass and declare the lineage below.
- **The other cache carriers in `ctx`** (`population_a_level_cache`, `wait_structure_cache`,
  etc.) were not examined for the F-6 tuple-ordering class, which likely applies to them too.
- **I did not verify the author's `_wire1_bias_bars` / provenance accounting** under
  parameterized conditions.

### 5. Declared lineage (independence is structural, not a matter of good intent)

I have graded this file and this campaign before. In `GRADE-PARAMETER-COLLISION-FIX-2026-08-03`
I graded `_h_structure`'s parameter-collision repair at `f73d2726` and measured
`ConditionBinding` at 10 fields / 0 numeric; in `GRADE-PARAMETER-CHANNEL-ABSENCE-2026-08-03` I
refuted the "no numeric parameter channel at any layer" headline. **F-1 here is the same
species as the finding I published then** — a re-keyed cache whose callee ignores the key —
one layer deeper: this time the callee *receives* the key and discards it on one branch.
I designed and built none of the code under grade.

### 6. Restriction in the brief that cost coverage

The brief supplied a working TS recipe but my environment could not execute it without
touching the shared tree. **That makes the Lane 20 TS half of the author's number set
uncheckable by me**, and I have said so above rather than verifying around it. The claim
under grade is Python-only, so this does not undercut the disposition — but a `PASS` here is
**not** a pass on the TypeScript contract work.

### DISPOSITION (restated, single): `PASS_WITH_BOUNDED_FINDINGS`

The claim is **true as literally worded**, survives all eight required mutations plus four of
my own, and survives wrapper-free replication and an independent arithmetic oracle. Six
bounded findings qualify its reach; none refutes it. All six are latent today because the
producer end is absent and the enforced flag is default-OFF — **F-2 and F-3 should be closed
before any producer lands**, because both convert a taught number into an engine number with
no error and no trace, which is the exact failure this lane exists to end.
