# AR-1023 — WORKER — POST-REPAIR CANONICAL MAP: EXACTLY THE AUTHORIZED MOVEMENT, NOTHING ELSE · AND I RETRACT TWO OF MY OWN AR-1022 CLAIMS

```
RULING : AR-1022 GPT ruling, gpt-rulings 24585f73
PIN    : 00332950  (PUSHED; origin/h1-wave4-sealed12-driver resolves it)
MAP    : ONE canonical promoted isolated ACCEPT-5 run, scripts/accept5_isolated_runner.py
         --out-dir only. No --reverse, no --reverse-nodes, no --limit, no --no-layer2.
STATUS : §8 STOP does NOT fire. 34 non-pass. 2 nodes genuinely open.
```

## 0. 🛑 TWO RETRACTIONS FIRST — BOTH MINE, BOTH IN AR-1022

**GPT caught the first; the pre-repair map caught the second. Recording them before any result,
because AR-1022's numbers were used to reorder the campaign.**

### [R1] I DROPPED A NODE FROM MY OWN DENOMINATOR

AR-1022 §8 said *"2 of 4 still unclassified"* and named only `apply_trade_management` and
`wave_b_intrabar_stops`. **`test_e2e_backtest::TestE2EBacktest::test_walk_forward_mode` was absent
from the report entirely** — even though **my own four-file run had printed it as FAILED**. I
measured it and then did not carry it into the writeup. GPT's ruling §4 is correct: that was not a
closed denominator. ★ `[count-obligations]` — **nothing detects a missing row except a reader.**

### [R2] 🛑 MY "UNEXPECTED OUTCOME MOVEMENT" ALARM WAS FALSE — I MEASURED THE WRONG NODE

AR-1022 §7 reported `three_fixes::max_dd` moving FAIL → PASS and flagged it as a possible
authority movement. **It is withdrawn in full.**

I located that node by grepping test *function names* for `max_dd`, which returned
`TestWFIntraMaxDD::test_bar_level_max_dd_exceeds_daily_max_dd`. `[MEASURED HERE]` the actual
non-pass node in the pre-repair map is a **different function in the same class**:

```
pre-repair map, test_three_fixes.py:
  failed  TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result   <- the REAL node
occurrences of test_bar_level_max_dd_exceeds_daily_max_dd in the pre-repair map: 0
```

Re-measured at the correct node ID:

```
TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result  -> 1 failed  (3 runs of 3)
TestWFIntraMaxDD::test_bar_level_max_dd_exceeds_daily_max_dd       -> 1 passed  (never in the set)
```

**The node I called "moved" was never in the failing set, so its PASS was never evidence of
anything.** The canonical map below confirms the real node still fails. **There was no movement,
there is no order-pollution question, and GPT's §5 reorder rested partly on my false alarm.**

★★★★★ **`I CONVICTED AR-1021 OF MEASURING THE NEIGHBOURING OBJECT AND THEN DID IT MYSELF, IN THE
SAME REPORT, INSIDE THE SECTION WHERE I WAS BEING CAREFUL. A GREP OVER FUNCTION NAMES IS NOT A JOIN
ONTO A NODE-ID SET.`** (`[i-measured]`, now 7×.)

## 1. ORIGIN RESOLVES THE REPAIR (ruling §6 steps 1-2)

```
push: 0f478211..00332950  h1-wave4-sealed12-driver -> h1-wave4-sealed12-driver
git ls-remote origin refs/heads/h1-wave4-sealed12-driver
  00332950c26a139fee9e278112c3651576bebacb
git show origin/...:src/engine/parameter_jitter_battery.py  -> repair comment+line present
git show origin/...:src/engine/tests/test_parameter_jitter_battery.py
  -> test_equity_curve_fallback_window_boundary present (1)
```
No squash, no rewrite: `2d42c9e8` is the repair verbatim; `00332950` is the SYSTEM-INVENTORY
regeneration the **pre-push hook** demanded (line-number shifts from my 4 added comment lines only;
`src/` Python line count `120770 -> 120774`; **zero** count or classification changes;
`system_inventory.py --check` exits 0).

## 2. THE POST-REPAIR CANONICAL MAP (ruling §6 step 3)

```
children (governed files)     : 108
nodes collected               : 2420        (pre: 2419)
  passed                      : 2386        (pre: 2384)
  failed                      : 32          (pre: 33)
  xfailed                     : 2           (pre: 2)
  xpassed / skipped / error   : 0 / 0 / 0
NON-PASS TOTAL                : 34          (pre: 35)
duplicate node IDs            : 0
collected-but-unexecuted      : 0
invalid / refused children    : 0
wall clock, serial            : 6.5 min     (pre-registered ceiling 10.0)
```

**Two-path derivation, same discipline as the pre-repair map:**

```
PATH A  aggregate.json['outcomes']              2420 nodes · 34 non-pass
PATH B  each child's acceptance-run.xml         2420 testcases · 34 non-pass
        (pytest's OWN junitxml, 108 children)
JOIN SIZE NON-ZERO : True
```
★ The pre-repair map recorded a **vacuous** PATH B whose intersection was empty. **I printed the
join size beside the verdict for exactly that reason.**

## 3. EXACT PRE/POST DIFF BY NODE ID (ruling §6 steps 4-5)

```
=== LEFT THE NON-PASS SET ===
  failed -> passed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback

=== ENTERED THE NON-PASS SET ===
  (none)

=== OUTCOME CHANGED WHILE STILL NON-PASS ===
  (none)

=== POPULATION GROWTH: +1 ===
  passed   src/engine/tests/test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback_window_boundary
```

⇒ **EXACTLY the movement ruling §7 authorized, and nothing else.** The new node is named by exact
ID, not hidden behind a count.

🛑 **RULING §8 DOES NOT FIRE. No unrelated outcome movement exists.**

## 4. THE NODES UNDER DISCUSSION — CONFIRMED POSITIVELY, NOT INFERRED FROM ABSENCE

```
passed   TestComputeRws::test_equity_curve_fallback                    <- repaired
passed   TestComputeRws::test_equity_curve_fallback_window_boundary    <- new, authorized
failed   TestComputeRws::test_stable_monthly_returns_low_rws
failed   TestRunB15Battery::test_rws_failure_blocks
failed   TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit
failed   TestE2EBacktest::test_walk_forward_mode                       <- the node I dropped [R1]
failed   TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result  <- real node, NO movement [R2]
failed   TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back
```

**`test_walk_forward_mode` is reconciled from the canonical map, not from memory** (ruling §6 step 6).

## 5. THE FINAL DENOMINATOR IS NOW CLOSED — 34 NON-PASS

Of AR-1021's five open nodes:

| node | disposition |
|---|---|
| `jitter::test_rws_failure_blocks` | `TEST_CONTRACT_DEFECT` — **accepted by AR-1022 ruling §3** |
| `apply_trade_management::test_trail_stop_moves_to_be_on_tp1_hit` | `TEST_CONTRACT_DEFECT` — evidence §6 |
| `wave_b_intrabar_stops::test_long_tp_fires_intrabar...` | `TEST_CONTRACT_DEFECT` — evidence §7 |
| `e2e_backtest::test_walk_forward_mode` | **OPEN** — not yet diagnosed |
| `three_fixes::test_equity_bars_key_present_in_backtest_result` | **OPEN** — not yet diagnosed |

## 6. `test_trail_stop_moves_to_be_on_tp1_hit` = `TEST_CONTRACT_DEFECT` — PRODUCTION IS CORRECT

The BE+1 invariant **is implemented** (`# INVARIANT: BE+1 tick on TP1 fill`). It never fires because
its precondition is never met. `[MEASURED HERE]`:

```
adaptive_tp1_price   = 4009.0     adaptive_tp1_source = r_multiple
risk_points          = 9.0        stop_basis          = atr_fallback   (1.5 x ATR 6.0)
adaptive_tp1_filled  = False      trail_stop_final    = 3991.0 = entry - 1R
```
The fixture's own comment documents *"6pt stop -> 1R = 6pt, TP1 = 4006"* and sets `high[2] = 4007.0`
to cross it. **Production's 1R is 9.0, so TP1 is 4009.0 — the engineered bar falls 2 points short.**

**Positive control — the invariant fires exactly at its own threshold:**
```
high[2]=4007.0   tp1_filled=False  trail_stop_final=3991.0
high[2]=4008.99  tp1_filled=False  trail_stop_final=3991.0     <- negative control
high[2]=4009.0   tp1_filled=True   trail_stop_final=4000.25    <- BE+1 = entry + 1 tick
high[2]=4020.0   tp1_filled=True   trail_stop_final=4011.0
```
**No production defect. No mutation performed** (ruling §10 honoured).

## 7. `test_long_tp_fires_intrabar_even_if_close_falls_back` = `TEST_CONTRACT_DEFECT` — TWO WRONG PREMISES

Observed `exit_idx = 3`, expected `5`. `[MEASURED HERE]` `exit_reason = 'trailing_stop'`:

```
risk_points 6.0 -> initial stop 4394.0 ; lowest low 4399.0 -> plain stop NEVER hit
bar2 high 4420.0 -> trail ratchets to 4420 - 6 = 4414.0
bar3 low  4409.0 <= 4414.0 -> trailing_stop fires at bar 3
```
**The test's own engineered 4420 spike arms the trail it forgot to account for.** Its premise names
only the structural TP and the initial stop.

**Its SECOND assertion is also wrong, and the spike is not why.** Positive control with the spike
removed:
```
bar2_high=4420.0  exit_idx=3  reason='trailing_stop'   <- fixture as written
bar2_high=4406.0  exit_idx=5  reason='take_profit'     <- spike removed: right BAR, wrong REASON
bar2_high=4414.0  exit_idx=5  reason='take_profit'     <- just below arming threshold
bar2_high=4416.0  exit_idx=4  reason='trailing_stop'   <- just above
```
The test asserts `exit_reason == 'signal'` on the premise *"without htf_cache no structural TP"*.
`[MEASURED]` the exit row shows **Style C static partials are ON by default** and derive TPs from
R-multiples, not from `htf_cache`:
```
static_c_partials_enabled = True
static_c_tp1_price = 4406.0 (entry + 1R)   static_c_tp1_filled = True
static_c_tp2_price = 4412.0 (entry + 2R)   static_c_tp2_filled = True
```
This matches the documented Style C path (*"TP1 at +1.0R (33%), TP2 at +2.0R (33%)"*). **The
fixture's model of production is stale on both counts. No production defect. No mutation.**

## 8. LIMITATIONS — WHAT I DID NOT MEASURE

- **The two OPEN nodes are not diagnosed at all** — `e2e::test_walk_forward_mode` and
  `three_fixes::test_equity_bars_key_present_in_backtest_result`. I have their failure text only.
  Ruling §6 step 7 defers disposition to after this map; I have not started them.
- **I did not re-derive the pre-repair map**; I parsed its committed 35-node list and asserted the
  parse recovered exactly 35 before diffing (it did). A mis-parse would have been caught by that
  assertion, not by the diff.
- **No independent grader dispatched** — ruling §9 forbids one for this repair.
- **ONE arm only.** This is not a re-certification of execution identity, and no reverse arms ran.
- **`three_fixes` was proven unmoved by the canonical map**, not by a causal account. I still have
  no explanation for AR-1021's *"short by 0.0000000000038"* description of that node, which matches
  neither function I ran. **Flagging it as an unresolved description mismatch, not a defect.**

## 9. NOT CLAIMED

**No census 32. No successor seal. No canonical closeout. No R3-4 closure.** Ruling §7 blocks all
four until the final denominator is adjudicated, and 2 nodes remain open.

## 10. ARTIFACTS

```
origin/h1-wave4-sealed12-driver = 00332950   (repair 2d42c9e8 + inventory 00332950)
map run   : C:\Users\tonio\a5post\isolated-432bbfc4fdd6\{aggregate.json,manifest.json}
            108 children · 2420 nodes · 34 non-pass · 6.5 min serial
PATH A/B  : 2420 / 2420 testcases · 34 / 34 non-pass · join size non-zero
```

★★★★★ **`THE MAP MOVED EXACTLY ONE NODE AND ADDED EXACTLY ONE. THE ONLY TWO SURPRISES IN THIS
CAMPAIGN STEP WERE BOTH MINE, AND BOTH WERE JOIN ERRORS — ONE ROW DROPPED FROM A DENOMINATOR, ONE
NODE MATCHED BY NAME INSTEAD OF BY ID.`**
