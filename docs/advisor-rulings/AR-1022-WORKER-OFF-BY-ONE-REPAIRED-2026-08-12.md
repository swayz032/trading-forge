# AR-1022 — WORKER — STOP §5[3] RESOLVED · OFF-BY-ONE REPAIRED · THE RULING'S SUGGESTED SPELLING WAS WRONG · `rws_failure_blocks` ROOT LOCATED (AR-1021 §2 CORRECTED)

```
RULING : AR-1020/1021 GPT ruling, 2026-08-12, gpt-rulings commit 37759ed4
PIN    : worker HEAD 0f478211 (ruling's evidence pin c59ee2a3 is an ANCESTOR of it)
COMMIT : 2d42c9e8  (the authorized repair)
STATUS : fast-path steps 1-5 DONE · step 6 partial (2 of 4 still open) ·
         NO census, NO seal, NO canonical map yet, NO R3-4 closure.
```

## 0. PRE-FLIGHT (ruling §9 step 1) — NO CONTRADICTION, SO I EXECUTED WITHOUT A ROUND-TRIP

Seven questions answered against **measured** state at `0f478211`, not at the ruling's pin.

⚠️ **The ruling's evidence pin `c59ee2a3` is an ANCESTOR of my HEAD**, so I re-measured the defect
here rather than inheriting it. `[MEASURED HERE]` exactly **one** commit separates them
(`0f478211`, the post-Cluster-E authority map) and it touches **no** Python under `src/engine`.

⚠️ **MY FIRST SEARCH FOR THE NAMED TEST NODE RETURNED NOTHING** — I grepped `tests/`, but the file
lives at `src/engine/tests/`. A positive control (`ls -d tests/` → exists) caught it before I
reported a false contradiction. **Recording it because a null from the wrong surface is not an
absence** (`[absence-claim]`).

## 1. RED, REPRODUCED AT MY HEAD (ruling §9 step 2)

```
src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback
E   IndexError: list index out of range
src\engine\parameter_jitter_battery.py:422: end_eq = equity_vals[(i + 1) * bars_per_month]
1 failed in 0.22s
```
Arithmetic, independent of pytest: `len=252` → `n_months = 12` → last index read `252`, max valid
`251`. **Deterministic, exactly as the ruling states.**

## 2. 🛑 THE RULING'S SUGGESTED SPELLING IS WRONG — AND ITS OWN §2 CONTROLS ARE WHAT CATCH IT

The ruling floated `range(n_months - 1)` as "plausible" and told me to verify rather than copy it.
**Verified. It is wrong**, and it fails the ruling's own required control:

```
     L  current  n_months-1  (L-1)//21
   252    CRASH          11         11
   253       12          11         12   <- n_months-1 DROPS A REAL FINAL INTERVAL
   200        9           8          9   <- ruling required 200 to stay STABLE; this moves it
    43        2           1          2
```

`(n_months - 1)` silently loses a legitimate final interval on **every non-multiple length**. The
ruling's §2 required `len=253` to "not lose a legitimate final interval" and `len=200` to remain
"behaviorally stable" — that spelling violates both.

**The correct invariant is `(len(equity_vals) - 1) // bars_per_month`**: interval `i` reads indices
`i*21` and `(i+1)*21`, so the count is bounded by the last *readable* index, `len-1`.

★ **`A SPELLING OFFERED IN A RULING IS A HYPOTHESIS, NOT A SPECIFICATION — AND THIS ONE WOULD HAVE
PASSED THE CRASH TEST WHILE QUIETLY DELETING DATA ON EVERY OTHER INPUT.`**

## 3. GREEN + BOUNDARY CONTROLS (ruling §9 steps 3-4)

`[MEASURED HERE]`, `n` monthly returns produced vs `(L-1)//21`:

```
  len   n_returns  expected     len   n_returns  expected
  252          11        11     254          12        12
  253          12        12     273          12        12
  200           9         9      42           1         1
   21           0         0      22           1         1
```
**Identical to pre-repair behaviour on every length that did not crash**; only the crashing
lengths changed. Invariant swept `L = 2..1999`: **zero** iterations index beyond `len-1`.

Test order the ruling demanded:
1. exact node → `1 passed`
2. full file → `2 failed, 27 passed` (was `2 failed, 26 passed`; the `+1` is my new test)

**The 2 remaining failures are the pre-existing already-classified nodes, NOT caused by my repair.**
Proved with a line-execution witness rather than asserted:

```
stable_monthly_returns_low_rws input   fallback-branch lines executed: NONE
rws_failure_blocks input (volatile)    fallback-branch lines executed: NONE
POSITIVE CONTROL equity_curve only     fallback-branch lines executed: [416,418,423,424,425,426,427]
```
The negative result comes from an instrument **shown capable of producing a positive**. And
`n_windows = 2` post-repair matches AR-1021's pre-repair value exactly. **The §3 STOP did not fire.**

## 4. THE NEW TEST IS RED-PROOFED AGAINST BOTH WRONG SPELLINGS

`test_equity_curve_fallback_window_boundary`, driven against the real module with byte-exact
save/restore of production:

```
WRONG A: len // 21 (original)      exit=1  1 failed
WRONG B: (len // 21) - 1           exit=1  1 failed
   AssertionError: len=253: expected 12 monthly returns, got 11
CORRECT: (len - 1) // 21           exit=0  1 passed
restored bytes-identical: True
```
**It convicts the ruling's own suggested spelling.** No new checker framework was created.

## 5. ⚠️ DISCLOSURE — MY FIRST COMMIT WAS REJECTED

`ruff-lint` blocked it on **7 findings PRE-EXISTING at HEAD** in the test file (`I001` + 6× `F401`).
`[MEASURED HERE]` by running ruff against `git show HEAD:` of that same file — **identical set**, so
none are mine. The hook only lints files a commit TOUCHES, so the debt sat unenforced.

Fixed narrowly (`--select=I001,F401 --fix`, safe fixes only, **no** `--unsafe-fixes`, **no**
`--no-verify`). Test outcomes unchanged across the lint fix. **Same wall and same remedy as
`AR-685` / `AR-16408` / `AR-17398` / `AR-28796` / `AR-32760`** — a five-times-convicted pattern.

## 6. `test_rws_failure_blocks` — ROOT LOCATED · `TEST_CONTRACT_DEFECT` · AR-1021 §2 CORRECTED

Bounded stage trace the ruling ordered (§4). **The value does NOT change between stages** — no seam:

```
1. base_backtest_result monthly_returns : 24 values -> 12 unique keys
2. compute_rws input series after sort  : [0.1,-0.1,0.1,-0.1,0.1,-0.1,0.1,-0.1,0.1,-0.1,0.1,-0.1]
3. compute_rws output window_sharpes    : [0.0, 0.0]
4. rws_detail["rws"]                    : 0.0
5. returned rws                         : 0.0   (line 541 is a plain read, no transform)
6. threshold decision rws > 0.2         : False
```

**Root:** every 6-month window of `[0.10, -0.10]*12` has **mean exactly 0**, and
`_sharpe_from_monthly_returns` returns `(mean/std)*sqrt(12)` → **exactly 0.0**. All window Sharpes
are equal, so their std-dev — which *is* RWS — is `0.0`. Positive control: a non-zero-mean window
returns `27.386`.

**The test's premise is the defect.** It assumes "volatile months → RWS > 0.20", but RWS measures
**dispersion of window Sharpes**, not volatility of returns. A perfectly alternating series is
maximally *stable* under this metric. Production math matches its own docstring.

🛑 **AND IT IS NOT THE KEY-COLLISION ROOT.** Control with the same 24 values as a **list** (no
collision): `window_sharpes [0.0,0.0,0.0,0.0]`, `rws 0.0` — **still fails**. So the collision is
incidental here.

⚠️ **CORRECTING AR-1021 §2.** It reported `compute_rws` returning `3.22e16` directly vs `0.0`
through the battery, and concluded "the collision does not explain this one — root not located".
**That measurement used a different input than the test does**: `([0.05]*6 + [-0.05]*6)*2`
(6-month blocks) instead of the test's `[0.10,-0.10]*12` (alternating). Re-measured, the test's own
input yields `0.0` **both** directly and through the battery. **There was never a divergence.**
★ `[i-measured]` again: the neighbouring object, not the one under test.

⇒ **CLASSIFY `test_rws_failure_blocks` = `TEST_CONTRACT_DEFECT`. No production defect. No repair.**

## 7. 🛑 UNEXPECTED OUTCOME MOVEMENT — `three_fixes::max_dd` NOW PASSES, AND I AM NOT CLASSIFYING IT

AR-1021 listed `test_bar_level_max_dd_exceeds_daily_max_dd` as one of the 5 remaining failures.
`[MEASURED HERE]` **it passes, 5 runs of 5, deterministically.**

- **Not caused by my repair:** that file never imports the module I changed `[MEASURED]`.
- **Not caused by code drift:** the only commit between the ruling's pin and my HEAD touches
  neither the test nor `backtester.py` `[MEASURED]` — the bytes are identical to the pin.

⇒ **The difference must be RUN CONTEXT, not code.** `scripts/acceptance_runner.py` takes node IDs
from one pytest process (plugin + junitxml from the *same* run), so a node can pass in isolation
and fail inside the full population. **HYPOTHESIS, UNPROVEN: cross-test pollution or ordering
dependence.**

🛑 **I am deliberately NOT classifying it from an isolated run** — that is exactly the error §6
above convicts AR-1021 of. Its outcome is settled by the canonical run at fast-path step 7, and
**if it passes there, that is an outcome movement the ruling §6 calls a STOP.**

## 8. STANDING — WHAT IS DONE AND WHAT IS NOT

```
DONE   1 preflight · 2 RED · 3 repair · 4 GREEN+controls · 5 bounded trace
OPEN   6 dispositions: 2 of 4 still unclassified, 1 moved to PASS (§7)
NOT STARTED  7 canonical map · 8 pre/post compare · 9 census 32 · 10 seal ·
             11 closeout · 12 R3-4
```

The two still unclassified, both reproduced at my HEAD with AR-1021's exact values:

- `test_apply_trade_management_branching::TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit`
  → `Expected trail_stop >= BE (4000.0), got 3991.0`
- `test_wave_b_intrabar_stops::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back`
  → `No-TP path: expected exit at original exit bar 5; got 3`

Both sit in money-path engine behaviour. **Per ruling §5 I will classify only; any new
`PRODUCT_OR_ENGINE_DEFECT` returns to GPT before any mutation.**

## 9. LIMITATIONS — WHAT I DID NOT MEASURE

- **No canonical ACCEPT-5 run has been made post-repair.** Every count in this report is from
  targeted runs, not the authority map. The `35`-node map is still the pre-repair one.
- **The `3.22e16` window Sharpes AR-1021 flagged as a degenerate zero-variance division are still
  unexamined.** My §6 result does not touch that; it remains an open robustness question.
- **No independent grade was dispatched.** This ruling does not require one, and I did not spend an
  uninvited agent. **Flagging it as GPT's call:** this is a production math change inside the
  battery we intend to trust for edge qualification, and doer ≠ grader still holds.
- I did not examine the two open nodes' roots at all yet — they are reproduced, not diagnosed.

## 10. ARTIFACTS

```
commit 2d42c9e8  src/engine/parameter_jitter_battery.py      (+8 -2, one logic line)
                 src/engine/tests/test_parameter_jitter_battery.py (+18 test, -8 lint)
branch h1-wave4-sealed12-driver @ 0f478211 -> 2d42c9e8
pre-commit on the landing commit: ruff lint Passed · metric snapshot Skipped
```

★★★★★ **`THE RULING NAMED THE BUG CORRECTLY AND THE FIX INCORRECTLY. TAKING THE SPELLING ON
AUTHORITY WOULD HAVE TRADED A LOUD CRASH FOR A SILENT ONE-MONTH DATA LOSS ON EVERY NON-MULTIPLE
INPUT — AND EVERY TEST IN THE FILE WOULD HAVE GONE GREEN.`**
