# GRADE — INVARIANT HARNESS REPAIRS (AR-654 / AR-655 / AR-656)

**Commissioned by:** `R-614` · **Grader:** independent (`accuracy-validator`), briefed to REFUTE
**Date:** 2026-08-03
**Tree:** `C:/Users/tonio/Projects/wt-h1-wave4-20260712` · branch `h1-wave4-sealed12-driver`
**Pin at start:** `3e266a851389004794502a867190cc01891ea3cb`
**HEAD at end:** `fe196b30df6563809b7e17962f5eb1b86a40fab7` — **HEAD MOVED TWICE MID-GRADE** (`3e266a85` → `486a76bf` → `fe196b30`; advisor ruling/state commits). **All five graded files are BYTE-IDENTICAL across both moves** — re-verified at the final HEAD: `core.py` = `7e08dd2ca9e4cba91e230cf30ebef4edcb103c0b`, `invariant_absence_sweep.py` = `5c0f759429e140fb8637bd385160ddffd19cb8f7`, unchanged from the pin (full blob table in §Coverage). **Every finding below is scoped to those blob hashes, not to a branch tip that keeps moving.**

**Lineage declaration:** I did not write, design, or previously grade this code, this instrument, or its repairs. No prior grade of this lineage exists from me.

---

## VERDICTS

| # | Claim | Verdict | Band | Status |
|---|-------|---------|------|--------|
| 1 | "`INV-7`, `INV-9`, `INV-10` can now fail when the metric they guard is wrong or missing, and cannot be satisfied by the defect they are named for" | **REFUTED** | **4/10** | `VERIFIED` |
| 2 | "`invariant_absence_sweep.py` correctly measures which invariants are blind — 9 of 14 blind, 5 guarded" | **SURVIVES** (count corroborated; scope narrower than the caption reads) | **6/10** | `VERIFIED` |
| 3a | "A failing **CRITICAL** invariant reaches something that stops or flags a run" | **SURVIVES — the worker under-claimed; a listener exists and it hard-blocks** | **6/10** | `VERIFIED` |
| 3b | Same claim for **WARNING** severity (`INV-9`, `INV-10`) | **REFUTED — nothing listens, and the consumer logs "all checks passed"** | **2/10** | `VERIFIED` |

**Lane band overall: 4/10 `VERIFIED`.** The claimed direction of travel is real — the three checks genuinely acquired an absence arm that fires, and that is a true improvement measured here. But the property as stated ("can fail when the metric is wrong **or** missing") holds only for *missing*, and only while `total_trades` survives. Two of the three repairs are on a severity that reaches no consumer.

Band 9/10 was never reachable: `0` runs against the real wave rig, and the TS half of the propagation chain was read, not executed.

---

## TARGET 1 — PROPAGATION (highest value)

### F-1 · A listener EXISTS. The worker's "I have still not shown anyone listens" is an honest under-claim. `[MEASURED HERE — file:line]`

The full CRITICAL chain, every hop at an executable line:

| Hop | Location | Behaviour |
|-----|----------|-----------|
| Python sets verdict | `invariant_harness/core.py:939` | `overall_passed=len(critical_failures) == 0` |
| Serialise (single) | `backtester.py:5954-5960` | `result["invariants"] = {... "overall_passed": ...}` |
| Serialise (CLI/WF) | `backtester.py:8429-8436` | same, plus `total_checks` |
| stderr sentinel | `backtester.py:6079-6082`, `:8443` | `INVARIANT_FAILURE_JSON {...}` when `not overall_passed` |
| Sentinel parsed | `python-runner.ts:219`, `:249` | `INVARIANT_FAILURE_SENTINEL` → `{type:"invariant_failure"}` |
| Sentinel → event | `python-runner.ts:430` | `backtest.invariant_failure_detected` |
| Persist join | `backtest-service.ts:102` | `"invariants"` in the `buildResultExtras` key allowlist → `backtests.resultExtras` |
| Fallback ingest | `backtest-service.ts:1250-1251` | if stdout lacked it, adopt the sentinel payload |
| Gate read | `backtest-service.ts:1285` | `invariantFailed = invariants.overall_passed === false` |
| audit_log | `backtest-service.ts:1346-1366` | action `backtest.invariants_failed`, `status:"failure"` |
| SSE | `backtest-service.ts:1383` | `backtest:truthiness_failure` |
| Discord | `backtest-service.ts:1396-1405` | `notifyCritical("BACKTEST TRUTHINESS FAILURE")` when severity CRITICAL |
| **HARD BLOCK** | `lifecycle-service.ts:1689-1709` | `if (invariants?.overall_passed === false)` → audit row `lifecycle.invariant_blocked`, `reason:"invariant_harness_failed"` → `return {success:false}` — **TESTING→PAPER refused** |

`INV-7` is `severity="CRITICAL"` (`core.py:402/418/434/444`), so **`INV-7`'s new RED does propagate all the way to a refused promotion.** That is a genuine correction in the worker's favour and the desk should record it.

### F-2 · CRITICAL · Lead (a) resolved: the `try:` swallow is real, and it fails **OPEN** — but it does not touch a *failed check* `[MEASURED HERE]`

`backtester.py:5939` / `:8416` open `try:`; `:6083` / `:8444` close with `except Exception as _inv_err:` → print `{"event":"invariants.error"}` to stderr → **no re-raise, no exit-code change, and `result["invariants"]` is never assigned.**

Consequence, traced: harness throws ⇒ `result["invariants"]` absent ⇒ `invariants == null` at `backtest-service.ts:1285` ⇒ `invariantFailed = false` ⇒ `hasTruthinessFailure = false` (`:1302`) ⇒ early `return` (`:1319`); and at `lifecycle-service.ts:1689` `invariants?.overall_passed === false` is `false` for `undefined` ⇒ **the hard gate does not fire and promotion proceeds.**

So the answer to the worker's lead (a) is precise: **the swallow does not suppress a failed check — a failed check propagates fine. It suppresses a harness CRASH, and it fails open.** The only trace is one stderr line with no sentinel prefix, which `python-runner.ts` does not parse (it keys on `INVARIANT_FAILURE_JSON`; `invariants.error` appears in no parser — enumerated in §Coverage).

### F-3 · CRITICAL · Lead (b) resolved: a WARNING failure reaches NOTHING, and makes the system log "all checks passed" `[MEASURED HERE]`

- `core.py:939` — `overall_passed` is a function of `critical_failures` **only**.
- `core.py:883-890` — `_WARNING_CHECKS` contains `_check_sharpe_finite` (`INV-9`) and `_check_profit_factor_finite` (`INV-10`).
- A WARNING failure therefore lands in `report.warnings[]`, `overall_passed` stays `True`, `invariantFailed = false`.
- `backtest-service.ts:1302` — `hasTruthinessFailure = invariantFailed || parityFailed || parityUnexpectedSkip`.
- `backtest-service.ts:1304-1319` — when false and `invariants != null`, the service logs:

```
event: "backtest.truthiness_passed"   →   "backtest.truthiness: all checks passed"
```

**A failing `INV-9` / `INV-10` causes the system to emit a log line asserting all checks passed.** That is a false green produced by the consumer, not by the harness.

- `invariants.warnings` has **ZERO readers** anywhere in `./src` or `./scripts`. Positive control for that absence: the identically-shaped search for `critical_failures` returns 6 hits including both live gates (`backtest-service.ts:1286,1328,1401`; `lifecycle-service.ts:1690`). Surface enumerated as all 30 `warnings`-token hits in `src/server` + `src/engine`; every one belongs to an unrelated subsystem (`extraction-quality-gate.ts`, `startup-config-check.ts`, `agent.ts`, and a `warnings` jsonb column on the **`complianceReviews`** table — `schema.ts:542-553` — not on `backtests`).
- `backtest-service.ts:1323` — `severity = invariantCritical || parityCatastrophic ? "CRITICAL" : "WARNING"`. A WARNING-severity invariant contributes nothing to severity even when the block is entered via a parity failure.

**Net: `AR-656`'s two repairs (`INV-9`, `INV-10`) are, at this commit, incapable of affecting any outcome — no gate, no alert, no audit row, no SSE.** They are observable only by reading `resultExtras.invariants.warnings` by hand.

---

## TARGET 2 — THE REPAIRS THEMSELVES → CLAIM 1 **REFUTED**

Battery: `probe_refute.py`, 21 cases, **16 disagree with the claim**. The probe is validated by 5 controls that behaved as specified — `CTL-1` PASS, `CTL-2`/`CTL-3` FAIL, and notably `H10` and `H14` went RED — so it is not an instrument that cannot return a negative.

Escalation: `probe_blast.py` runs the **full 14-check harness** through the public `run_invariants()` on an internally-coherent winning fixture and reports `overall_passed` — i.e. exactly the bit `lifecycle-service.ts:1689` gates on.

```
scenario                                                    overall  crit  warn
S0 BASELINE untouched (control)                             GREEN    0     0
S1 max_drawdown = 0.0 (the AR-654 sign-flip defect), WINNER GREEN    0     0
S2 max_drawdown = NaN                                       GREEN    0     0
S3 max_drawdown = +inf                                      GREEN    0     0
S4 max_drawdown ABSENT + total_trades ABSENT                RED      1     0   (caught by INV-5, not by the repair)
S5 total_trades ABSENT + all 3 repaired metrics ABSENT      RED      1     0   (same incidental catch)
S6 sharpe wrongly annualised sqrt(52) (2.2x)                GREEN    0     0
S7 total_trades + 3 metrics + long_short_split ABSENT       GREEN    0     0
```

### F-4 · CRITICAL · `INV-7` is still satisfied by the exact defect it is named for, on any winning run `[MEASURED HERE]`

`core.py:421` — the new arithmetic arm is `if max_dd == 0.0 and total_return < 0.0`. It is conditioned on the run having **lost money**. `AR-654 §4`'s convicting defect (sign flip ⇒ `max_drawdown → 0.0` on all 90 backtests) is therefore still invisible on every **profitable** run.

Measured (`S1`): a run starting at 50 000, dipping to **48 000** (a real \$2 000 peak-to-trough drawdown, present in `equity_bars`), ending at 52 000, reporting `max_drawdown = 0.0` ⇒ **`overall_passed = GREEN`, 0 critical, 0 warnings.** The check's own `actual` field reads `max_drawdown = 0.0000` and its evidence says *"is non-negative (positive loss figure)"*.

`equity_bars` is present in the same dict and is what `INV-8` already reads (`core.py:456-458`). The drawdown is re-derivable from data in hand; the repair does not do it.

### F-5 · CRITICAL · A wrong-typed / non-finite `max_drawdown` is silently coerced to `0.0`, and the check then reports `0.0000` as the observed value `[MEASURED HERE]`

`core.py:383` reads via `_aggregate_metric_raw` (sentinel-preserving), then **`core.py:405` immediately does `max_dd = _safe_float(raw)`**, and `_safe_float` (`:121-126`) maps NaN, ±inf and non-numeric to its `default=0.0`.

So `NaN` (`S2`), `+inf` (`S3`) and `"not-a-number"` (`H4`) all become `0.0` ⇒ pass on any non-losing run ⇒ **GREEN**.

**This makes a mechanism claim in the code FALSE as applied to `INV-7`.** `_aggregate_metric_raw`'s docstring (`core.py:132-135`) states it *"does NOT filter NaN/inf — used by the finiteness checks (INV-9 …, INV-10 …) which must preserve NaN so they can detect it."* True for `INV-9`/`INV-10`. `INV-7` takes the raw value and destroys exactly that information one line later. The sentinel buys absence-detection only; it buys nothing against corruption.

Secondary: `actual="max_drawdown = 0.0000"` is a **caption that misreports its own input** — a reader of the report cannot distinguish "drawdown was zero" from "drawdown was NaN/inf/a string". `-0.0` (`H8`) likewise renders `-0.0000` and passes.

### F-6 · CRITICAL · One absent key — `total_trades` — vacates all three repairs at once, and the whole harness reports 14/14 clean on an EMPTY DICT `[MEASURED HERE]`

All three repaired checks gate on `total_trades` read through `_aggregate_metric`, which returns `0` on absence, and `0` means "vacuously pass":
`core.py:384` (`INV-7`), `:490,493` (`INV-9`), `:580,583` (`INV-10`).

Measured, three encodings of the same disarm: `total_trades` **absent** (`H5`), `= NaN` (`H6`, `_safe_float`→0), `= 0.4` (`H7`, `int()`→0). Each makes the repaired check pass while its metric is missing.

`S4`/`S5` were caught — but by `INV-5` (`long_short_trade_counts_match_total_trades`), incidentally, because my fixture carried a `long_short_split`. `S7` removes the split as well and the containment collapses: **GREEN, 0 critical, 0 warnings.**

Reduced to its cleanest form:

```
run_invariants({})          → overall_passed=True  total=14  passed=14  failed=0  crit=0  warn=0
run_invariants({'backtest_id':'x'}) → overall_passed=True  total=14  passed=14  failed=0
```

**The 14-check truth layer issues a clean bill of health on an empty result dict.** Downstream, `overall_passed=true` is what `lifecycle-service.ts:1689` reads as "promote".

### F-7 · HIGH · `INV-9`'s chosen band admits the exact periodicity error its own comment names as a target `[MEASURED HERE]`

`core.py:551` sets `LO, HI = 1.0/3.0, 3.0`. The comment immediately above (`:547-550`) justifies the band by naming two errors it must catch: *"sqrt(252)/sqrt(12) = 4.58x, sqrt(252)/sqrt(52) = 2.2x."*

`2.2 < 3.0`, so the weekly-annualisation error is **inside** the accepted band. Measured: `H9`/`S6` — a Sharpe annualised with `sqrt(52)` instead of `sqrt(252)` passes; `H10` — the `sqrt(12)` error correctly FAILS. `H10` is the discriminating control: the arm works, the band is drawn one target too wide. The code contradicts its own comment.

### F-8 · HIGH · `INV-9`'s scale arm returns `passed=True` when it is skipped, and is skipped in two reachable cases `[MEASURED HERE]`

`core.py:540,544` gate the arm on `len(daily) >= 2 and std > 0.0 and abs(sharpe_val) > 1e-9`.

- `daily_pnls` absent ⇒ arm skipped ⇒ `sharpe_ratio = 99.0` passes (`H11`).
- `sharpe_ratio == 0.0` ⇒ `abs(...) > 1e-9` false ⇒ arm skipped ⇒ a Sharpe collapsed to exactly zero on a profitable run passes (`H12`).

The docstring (`:536`) says *"Skipped (not passed) when the series cannot support it."* The function returns `passed=True` (`:567-575`). For every consumer, skipped **is** passed — there is no third state. (`InvariantReport` has no `NOT_APPLICABLE`; the worker flagged that gap and correctly said it needs a ruling.)

### F-9 · MEDIUM · `INV-10`'s direction arm is inert when `total_return` is absent `[MEASURED HERE]`

`core.py:633-637` compares against `_aggregate_metric(result,"total_return",0.0)`. Absent ⇒ `0.0` ⇒ neither `> 0.0` nor `< 0.0` ⇒ `disagrees=False`. Measured (`H15`): an **inverted** profit factor (0.556 on a winning run — the named `AR-654 §2 P4` defect) passes once `total_return` goes missing. `H14` is the control: with `total_return` present, the inversion is correctly caught.

**Within declared scope, reported for completeness, NOT counted as a defect:** `H16` (PF 10x too large, same direction) and `H18` (PF `998.9`, just under the 999 sentinel) both pass. The check's `tolerance` field says *"direction must agree with total_return"*, so magnitude blindness is disclosed. It does mean the claim "can fail when the metric is **wrong**" is broader than what `INV-10` implements.

---

## TARGET 3 — THE SWEEP'S OWN VALIDITY → CLAIM 2 **SURVIVES**, scope narrower than it reads

### F-10 · `9 of 14` is CORROBORATED by two non-overlapping paths `[MEASURED HERE]`

- **Path A** — the worker's instrument, unmodified, on the pinned blob: `9 of 14 invariants PASS on a result whose metrics are absent`, control line `checks failing on GOOD data: none`. Reproduced exactly.
- **Path B** — never calls a check. Parses `core.py`'s AST and classifies each of the 14 by whether it makes any `_MISSING`-sentinel read. Result: **11 of 14 make no sentinel read.**

The two paths disagree on exactly **2 named rows**: `_check_daily_pnl_sum` and `_check_equity_curve_continuous`. On inspection **the sweep is right and my AST heuristic is too crude** — those two detect absence by empty-collection test (`daily_pnls` / `equity_curve` empty while `total_trades > 0`) rather than by sentinel. Sentinel-reading is sufficient for guardedness, not necessary. Path B's disagreement is a defect in Path B, and it localises cleanly. **Count corroborated; no discrepancy stands against the sweep.**

The sweep also correctly resists the self-certifying-collection defect: it reads the population from `C._CRITICAL_CHECKS + C._WARNING_CHECKS` (`sweep:27-28`) rather than a hand-kept list, and says so. Credit noted.

### F-11 · HIGH · The sweep's fixture conceals the single highest-leverage absence `[MEASURED HERE]`

`sweep:76` hardcodes `empty = {"total_trades": 10}` and never varies it. Fixture-stability matrix:

| absence encoding | blind count |
|---|---|
| A `{"total_trades": 10}` (the sweep's) | **9** of 14 |
| B metrics present but explicitly `None` | **9** of 14 |
| C `{"total_trades": 1}` | **9** of 14 |
| D `total_trades` absent entirely (`{}`) | **14** of 14 |

The headline is robust across three encodings — real credit. But the one variation the sweep never makes is the one that matters: **`total_trades` is itself a metric, it is read through the same defaulting helper, and removing it takes the blind count to 14/14 (F-6).** An instrument that asserts "trades were taken" as its fixed premise cannot see the case where that premise is the missing datum.

### F-12 · MEDIUM · Class A vs Class B: the admission is HONEST, and understated in one specific respect `[MEASURED HERE / ARTIFACT-SOURCED]`

The sweep has exactly two columns — absent-input and good-input (`sweep:80-83`) — so it measures **Class A (absent) only**. It has no wrong-value fixture and cannot separate Class A from Class B. The worker's statement that Class B exposure across the other 12 is `UNMEASURED` is **accurate and verified**.

Understated in one respect: Class B is also unmeasured for the **three repaired** checks, and my battery finds substantial Class B holes in all three (F-4, F-5, F-7, F-8, F-9). The table's word **`guarded`** therefore means *guarded against absence*, not *guarded* — and the 5-row `guarded` column is the natural thing for a reader to quote as "5 checks that work". Recommend the emitter, not the prose, be changed: rename the column to `absence-guarded`. (Fix at the emitter — `sweep:90` — not by hand-editing any report table.)

Minor, `[MEASURED HERE]`: `sweep:71` prints *"could not read the harness registry (**`_ALL_CHECKS`**)"* while `sweep:27` tests for `_CRITICAL_CHECKS` / `_WARNING_CHECKS`. No symbol named `_ALL_CHECKS` exists in `core.py`. Cosmetic — the branch is unreachable at this commit — but it is a caption naming an object that does not exist.

---

## TARGET 4 — SEVERITY SPLIT (contract question — reporting what the code does, not deciding it)

`[MEASURED HERE]` — what the code does:

| Check | Severity | Sets `overall_passed=False`? | Reaches a gate / alert / audit row? |
|-------|----------|------------------------------|-------------------------------------|
| `INV-7` max_drawdown | `CRITICAL` (`core.py:402,418,434,444`) | **Yes** (`:939`) | **Yes** — hard-blocks TESTING→PAPER (`lifecycle-service.ts:1689`), audit row, SSE, Discord |
| `INV-9` sharpe_finite | `WARNING` (`:501,515,529,564,574`) | **No** | **No reader anywhere** (F-3) |
| `INV-10` profit_factor | `WARNING` (`:591,605,623,652,662`) | **No** | **No reader anywhere** (F-3) |

Consequence, stated plainly: **two of the three repairs cannot affect any outcome at this commit**, and a failure in either causes `backtest-service.ts:1307-1317` to log *"all checks passed"*.

Two facts the desk needs when it rules, neither of which I am deciding:
1. The severities are **inherited, not chosen by this work** — `INV-9`/`INV-10` were `WARNING` in the original Pass B-2 design (`core.py:41-44,62-70`, which documents WARNING as *"Investigated offline — common in degenerate-parameter runs"*). `AR-656` repaired the predicates and did not touch severity.
2. The header's stated rationale for WARNING — degenerate-parameter noise — applied to the **old** predicates (bare finiteness). The **new** arms are arithmetic disagreements (a Sharpe 4.58x off its own daily series; a PF whose sign contradicts `total_return`). Whether that class still belongs in the offline bucket is the ruling; the old justification does not automatically carry to the new predicate.

---

## TARGET 5 — NOVEL HUNT (my chosen angle: the fail-open, and the empty-dict green)

I chose the propagation-failure axis over the remaining-9 axis, because a blind check that nobody reads and a crash that nobody notices are the same false green, and the crash path had never been traced.

Findings already stated as **F-2** (harness throw ⇒ silent fail-open, no sentinel, gate does not fire) and **F-6** (`run_invariants({})` ⇒ 14/14 clean). Both are novel to this grade — neither appears in `AGENT-REPORTS.md`'s `LANE-5`/`LANE-6` entries nor in the `AR-654`/`655`/`656` blind-spot lists.

One further observation, `[MEASURED HERE]`, on the worker's declared blind spot that `INV-3`'s cross-referencing idiom was *"copied without being independently validated"*: `_check_daily_pnl_sum` is one of the two rows where my AST path disagreed with the sweep (F-10), and the reason is that it guards by empty-collection test rather than by sentinel. That idiom **does** detect absence of its own metric under fixtures A/B/C — but it collapses with everything else under fixture D (`total_trades` absent). So the copied idiom inherits precisely the `total_trades` dependency of F-6. The worker was right to flag it; the flag resolves to the same root cause rather than to a separate one.

---

## PROXY PROOF (I ran code; here is the isolation)

The campaign tree was **never written to except this receipt**, and never executed from. All execution used a scratchpad copy materialised from the **object DB** via `git cat-file blob <pin>:<path>` — no working-tree read, no smudge filter, immune to a concurrent agent's mutate-and-revert.

Scratchpad: `C:\Users\tonio\AppData\Local\Temp\claude\C--Users-tonio-Projects-trading-forge\bf71e513-390a-4a0f-8dee-135d60168b22\scratchpad\invariant-grade\`

Per-file `sha256`, left side `git cat-file blob 3e266a85:<path> | sha256sum`, right side `sha256sum <materialised file>`:

| Verdict | blob id | sha256 | path |
|---|---|---|---|
| MATCH | `7e08dd2ca9e4cba91e230cf30ebef4edcb103c0b` | `26d12c748d3ee2b44956220bb01d5b251ba3f8f41311f9b910721fee02d29efc` | `src/engine/invariant_harness/core.py` |
| MATCH | `f8f3b41d7f94612f0009038123e41b22db20df58` | `3417f3852b1b2db757d7857b2e52c573090a369d16d1b7e171f3cb10523f45b0` | `src/engine/invariant_harness/__init__.py` |
| MATCH | `a0e8b43f73036d82fa44c9bcacb3abcf8243db7b` | `f77a2abee2dd6f248b50fc3dc1662475b7b50ca048e62336e11ee9488a226d5a` | `src/engine/tests/test_invariant_harness.py` |
| MATCH | `5c0f759429e140fb8637bd385160ddffd19cb8f7` | `bcbcfcb947d25a1c74567d580e76fd513c2e1222c7469b0eec2b7a730c3dd8e7` | `scripts/invariant_absence_sweep.py` |

**File count both sides: 4 and 4** (`git ls-tree -r <pin>` filtered to the four paths = 4; `find <scratchpad>/pin -type f` = 4). A separate 3-file `work/` copy was re-verified against the object DB independently before execution (3 MATCH, 3 files).

**Blob identity across the mid-grade HEAD move** — join key is the blob sha, compared at pin `3e266a85` vs end HEAD `486a76bf`:

| Verdict | blob | path |
|---|---|---|
| UNCHANGED | `7e08dd2ca9e4cba91e230cf30ebef4edcb103c0b` | `src/engine/invariant_harness/core.py` |
| UNCHANGED | `5c0f759429e140fb8637bd385160ddffd19cb8f7` | `scripts/invariant_absence_sweep.py` |
| UNCHANGED | `56da26522a0978d0e62dfbe9f073ca08a6571681` | `src/server/services/lifecycle-service.ts` |
| UNCHANGED | `ca8f2901a755db6974cbd9afc2029536aa99eb52` | `src/server/services/backtest-service.ts` |
| UNCHANGED | `177ec9e14190c424a921d0a5d391a3a77f06dbd1` | `src/engine/backtester.py` |

`mtime` recorded as the mutate-revert tell (content sha and `git status` are both blind to it): `core.py` 2026-08-02 23:51:26, `invariant_absence_sweep.py` 2026-08-02 23:55:08, `lifecycle-service.ts` 2026-07-21 13:07:19. No mid-grade movement observed on the graded files.

Probe scripts (scratchpad only): `work/probe_refute.py` (21-case battery), `work/probe_blast.py` (full-harness blast radius), `work/probe_pathb.py` (AST derivation + fixture matrix).

**My own instrument had a bug and the control caught it — disclosed.** `probe_blast.py`'s first run reported `S0 BASELINE = RED` (`daily_pnl_sum_matches_total_return` + `sharpe_finite_if_trades`). The fixture was wrong, not the code: a hand-written `daily_pnls` literal summed to 3 000 against a 2 000 `total_return`, and `sharpe_ratio=1.5` disagreed with its own series. Fixed by deriving `daily_pnls` as the first differences of `equity_bars` and `sharpe_ratio` from that series with `sqrt(252)`, making the baseline coherent **by construction**. All S-row conclusions above come from the corrected run, in which `S0` is GREEN with 0 critical and 0 warnings. Had I not carried a baseline control I would have published contaminated scenarios.

---

## MANDATORY COVERAGE

### What I verified, and via which two-plus non-overlapping paths

| Claim | Path 1 | Path 2 | Agreement |
|---|---|---|---|
| `9 of 14` blind | executed the worker's sweep on the pinned blob | **AST parse** of `core.py`, classifying by `_MISSING`-sentinel read — never calls a check | Agree on 12 of 14; the 2 disagreements are Path 2's defect (F-10) |
| `9/14` is fixture-stable | sweep's own fixture `{"total_trades":10}` | 3 further encodings: explicit `None`, `total_trades=1`, `{}` | 9/9/9, then 14 under `{}` (F-11) |
| `INV-7/9/10` fail on ABSENT metric | 21-case battery reading `.passed` per check | full-harness `run_invariants()` reading `overall_passed` | Agree — absence arm genuinely fires (CTL-2) |
| `INV-7/9/10` fail on WRONG metric | same battery | same full-harness escalation | Agree — **does not hold** (F-4/5/7/8/9) |
| CRITICAL propagates | source read of all 13 hops, each cited `file:line` | independent grep enumeration of the sentinel + `overall_passed` + `resultExtras` reader sets | Agree — chain complete |
| WARNING reaches nothing | `core.py:939` + `_WARNING_CHECKS` membership (severity algebra) | enumerated reader search for `invariants.warnings` across `./src`+`./scripts` | Agree — no reader |

### Positive control for every absence claim I make

| Absence claim | Positive control | Outcome |
|---|---|---|
| `invariants.warnings` has no reader | identically-shaped search for `critical_failures` | **6 hits incl. both live gates** — method finds readers when they exist |
| `invariants.error` reaches no parser | search for `INVARIANT_FAILURE_JSON` | **found in `python-runner.ts:219,249` + tests** — method finds parsed sentinels |
| no reader outside the two services | whole-tree filesystem sweep (not `git grep`) for `run_invariants|InvariantHarness|invariant_harness`, `node_modules`/`.git`/`replay-results` excluded | found all 4 call sites incl. both `backtester.py` sites — method is not filtering out the answer (the `SCOUT-ORACLE-FIT` doc records a prior `grep -v test` that deleted every `backtester.py` line; I did not filter on filename) |
| my battery isn't uniformly red | 5 expected-outcome controls incl. `H10`, `H14` | all 5 behaved as specified — **probe can return a negative** |
| my blast fixture isn't contaminated | `S0` untouched baseline | GREEN, 0 crit, 0 warn — after I fixed my own bug (disclosed above) |

### Join keys for every "identical / unchanged / matches" claim

- "graded files unchanged across the HEAD move" → **git blob sha** per path, pin vs end HEAD (5-row table above). Not `git status`, not mtime, not a working-tree diff.
- "scratchpad copy == pinned source" → **sha256 of `git cat-file blob` output** vs **sha256 of the materialised file**, plus file counts both sides. Explicitly **not** a `copy == working-tree` comparison.
- "Python `result["invariants"]` is the object the TS gate reads" → key name `"invariants"` traced through `buildResultExtras`'s allowlist (`backtest-service.ts:102`) into `backtests.resultExtras`, then read as `extras.invariants` (`lifecycle-service.ts:1688`) and `result.invariants` (`backtest-service.ts:1282`); field name `overall_passed` identical on both sides (`core.py:105` / `backtester.py:5957,8432` → `backtest-service.ts:374,1285` / `lifecycle-service.ts:1689`).
- "Path A and Path B measured the same population" → both enumerate from `_CRITICAL_CHECKS + _WARNING_CHECKS` in that order; 14 rows both sides, compared by `fn.__name__`.

### What I did NOT verify, and why

1. **The TS half was READ, never EXECUTED.** Every hop from `python-runner.ts` through `lifecycle-service.ts` is `[MEASURED HERE — file:line]` on the pinned blob, **not** `[MEASURED BY EXECUTION]`. I did not run `test_invariant_blocks_promotion.test.ts` (which asserts exactly the block at `:1689`) nor any vitest. **So "the hard gate fires" is a source-level finding.** A `runtime-production`-adjacent or DB-backed execution was out of scope by brief. This is the single largest gap in claim 3a and the reason its band is 6, not 8.
2. **`0` runs against the real wave rig** — same blind spot the worker declared, uncorrected. Every fixture is synthetic and hand-built by me. I never invoked `run_backtest()` / `walk_forward.py`, so I have **not** shown that a real engine run can actually produce the shapes I injected (`max_drawdown` NaN, `total_trades` absent). **F-4/F-5/F-6 prove the CHECK accepts these inputs; they do not prove the ENGINE emits them.** Reachability from the engine is `UNKNOWN` and is the right next lane.
3. **The full pytest suite was not run**, nor `test_invariant_harness.py` (67 tests claimed by `AR-656`). I did not verify that count, and I did not check whether my findings break any existing test.
4. **The other 9 blind invariants were not individually red-proofed.** I measured their blind/guarded verdict on 4 fixtures (F-11) but built no per-check Class B battery for them. Class B exposure for `INV-1..6`, `8`, `11..14` remains **UNMEASURED** — the worker's admission stands unchallenged and unimproved.
5. **`INV-3`'s copied cross-referencing idiom** — partially addressed (F-10, and the note in Target 5) but I did not independently validate the idiom's arithmetic, only its absence-detection behaviour.
6. **No DB round-trip.** I did not confirm that `resultExtras` JSONB actually persists and reloads the `invariants` shape (no `information_schema` check, no live row). The join is proven **in source**; the schema↔reality leg is untested. Given this desk's history (Pass 7 found 5 missing columns this way), that leg deserves its own measurement.
7. **`runtime-production` not touched and not read**, per brief.
8. **Whether `equity_bars` is reliably present** in real single-window and walk-forward results — my F-4 remediation suggestion (re-derive drawdown from `equity_bars`) assumes it is populated. `UNENUMERATED`.
9. **Discord/SSE delivery not observed.** `notifyCritical` and `broadcastSSE` are called at the cited lines; that they deliver is `HYPOTHESIS`.

### Git status

**Start** (pin `3e266a85`) and **end** (HEAD `fe196b30`) — **the 7 tracked modifications are IDENTICAL at both ends, and dirty as the brief predicted; recorded, not fixed.** Untracked went **77 → 78**, and the one addition is this receipt (`?? docs/designs/GRADE-INVARIANT-HARNESS-2026-08-03.md`) — verified by name, so I am not asserting "unchanged" over a delta I caused:

```
 M AGENT-LOGS.md
 M docs/A12-AUDIT-REPORT.md
 M docs/replay-results/h1-scripts/claude-rung-v32/enum-consistency-22.json
 M docs/replay-results/h1-scripts/frontier-designpool-configpass-v2/_support_cache.json
 M docs/scaling-validation/cli-report-existence-test.md
 M docs/wave25-exit-engine-ab-report.md
 M src/engine/tests/test_synthetic_market_simulator.py
?? (77 untracked paths, incl. docs/designs/GRADE-*.md and docs/replay-results/** caches)
```

No `checkout`, `reset`, `stash`, `clean`, `commit`, `add`, or any index operation was run in this tree. `ADVISOR-RULINGS.md`, `ADVISOR-STATE.md`, `AGENT-REPORTS.md` and the graph JSON were **read only**. This receipt is the only file I wrote here.

---

## WHAT I WOULD FIX FIRST (ordered by false-green risk, not by effort)

1. **F-6** — make `total_trades` absence a CRITICAL failure in its own right. One check closes the disarm for all three repairs and stops `run_invariants({})` reading 14/14 green. Highest leverage in the whole report.
2. **F-5** — in `INV-7`, test `_is_finite(raw)` **before** `_safe_float`, and fail on non-finite/non-numeric. Also stop rendering a coerced `0.0000` as the observed value.
3. **F-4** — condition the zero-drawdown arm on a re-derived peak-to-trough from `equity_bars` rather than on `total_return < 0`, so the sign-flip defect is caught on winning runs too.
4. **F-3 / Target 4** — a desk ruling on whether the new arithmetic arms stay `WARNING`. If they stay, they need a reader; `warnings[]` currently has none, and the consumer logs "all checks passed" over them.
5. **F-2** — the `except Exception` at `backtester.py:6083`/`:8444` should emit the parsed sentinel (or set `result["invariants"] = {"overall_passed": false, ...}`) so a harness crash fails closed rather than open.
6. **F-7** — narrow `HI` below 2.2, or drop the 2.2x claim from the comment. As written the code contradicts its own stated target.
7. **F-11 / F-12** — vary `total_trades` in the sweep, and rename the `guarded` column to `absence-guarded` **at the emitter** (`sweep:90`).
