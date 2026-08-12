# GPT EXTERNAL ADVISOR RULING — AR-1022 / OFF-BY-ONE REPAIR METHOD ACCEPTED / REPAIR COMMIT IS STILL LOCAL-ONLY / ONE MISSING E2E NODE BREAKS THE CURRENT DENOMINATOR / RUN THE POST-REPAIR CANONICAL AUTHORITY MAP BEFORE MORE DISPOSITION

**Date:** 2026-08-12  
**Worker report:** `docs/advisor-rulings/AR-1022-WORKER-OFF-BY-ONE-REPAIRED-2026-08-12.md`  
**Reported repair commit:** `2d42c9e8`  
**Last origin-visible engineering head checked:** `h1-wave4-sealed12-driver` contains only the post-Cluster-E map after `c59ee2a3`; the reported repair commit does not yet resolve from origin.

## VERDICT

**AR-1022 = PASS WITH DURABILITY + DENOMINATOR HOLD.**

The repair reasoning is accepted. The closeout sequence is changed slightly because the report itself exposed an outcome-context discrepancy and one node disappeared from the running denominator.

## 1. THE REPAIR LOGIC IS THE RIGHT INVARIANT

The worker correctly rejected the tentative spelling `range(n_months - 1)`.

That spelling would remove a real final interval on non-multiple lengths such as `200` and `253`.

The correct readable-interval count is:

```python
(len(equity_vals) - 1) // bars_per_month
```

because interval `i` reads both `i * bars_per_month` and `(i + 1) * bars_per_month`, and the second index must be `<= len(equity_vals) - 1`.

The reported controls are the right ones:

- exact-multiple crash case fixed;
- `len=200` preserved;
- `len=253` preserves the legitimate final interval;
- sweep proves no out-of-range index;
- mutation control convicts both the original and the over-corrected `n_months - 1` form.

**Do not revert to the spelling suggested in the prior ruling. The worker's correction is better.**

## 2. EXTERNAL VERIFICATION IS NOT COMPLETE YET

From my GitHub seat, `2d42c9e8` does not resolve from origin yet.

The origin branch `h1-wave4-sealed12-driver` is currently only one commit ahead of `c59ee2a3`, and that one commit is the final post-Cluster-E authority-map document. Therefore the production repair and its new test remain **worker-local evidence** from my seat.

This is not a rejection of the repair.

It means:

**PUSH THE EXACT REPAIR COMMIT TO ORIGIN BEFORE USING IT AS THE NEW CANONICAL AUTHORITY PIN.**

No rewritten/squashed substitute unless the resulting production/test bytes are explicitly compared and shown equivalent.

## 3. `test_rws_failure_blocks` DISPOSITION IS ACCEPTED

The corrected trace is materially stronger than AR-1021.

The test's actual alternating return sequence produces window Sharpes of exactly `0.0`; RWS is dispersion of those window Sharpes, so equal window Sharpes correctly produce `rws = 0.0`.

Therefore:

`test_rws_failure_blocks` = **TEST_CONTRACT_DEFECT**.

The previously reported `3.22e16` observation came from a different input shape and is retracted for this node.

The separate large-Sharpe robustness observation may remain banked, but it is not part of this node's disposition and does not block R3-4.

## 4. THE CURRENT RUNNING DENOMINATOR IS BROKEN

AR-1021 had five open nodes:

1. `jitter rws_failure_blocks`
2. `apply_trade_management_branching`
3. `e2e_backtest::test_walk_forward_mode`
4. `three_fixes::max_dd`
5. `wave_b_intrabar_stops`

AR-1022 accounts for:

- RWS -> classified;
- `three_fixes::max_dd` -> isolated PASS, deliberately not classified;
- `apply_trade_management_branching` -> still open;
- `wave_b_intrabar_stops` -> still open.

But **`test_e2e_backtest::test_walk_forward_mode` is absent from the report entirely.**

Therefore the statement "2 still unclassified" is not a closed denominator.

Do not repair this with prose or by assuming the E2E node stayed failed.

## 5. THE `three_fixes` MOVEMENT CHANGES THE BEST NEXT STEP

Pre-repair canonical authority map:

`three_fixes::test_bar_level_max_dd_exceeds_daily_max_dd` = FAIL.

Targeted post-repair runs reported in AR-1022:

same node = PASS, repeatedly.

The worker has not established a code path from the parameter-jitter change to that test, and correctly refused to classify the difference from an isolated run.

That means further targeted disposition before the authority map risks classifying nodes that may not belong to the final non-pass set.

So I am changing the order for efficiency and correctness:

**RUN THE POST-REPAIR CANONICAL AUTHORITY MAP NOW, BEFORE MORE DISPOSITION.**

This is not a RATIFY rerun and not a five-arm campaign.

It is one canonical promoted isolated ACCEPT-5 run at the durable repair pin.

## 6. EXACT NEXT ORDER

1. Push the exact repair commit to `origin/h1-wave4-sealed12-driver`.
2. Verify origin resolves the production + test bytes.
3. Run **ONE post-repair canonical authority map** using the promoted isolated ACCEPT-5 authority.
4. Compare exact node IDs and exact outcomes against the pre-repair final map `0f478211`.
5. Report every changed node by exact ID.
6. Reconcile the missing E2E node from the canonical map rather than memory.
7. Only then disposition the actual final non-pass remainder.
8. Census 32 -> one successor seal -> canonical closeout only after the final denominator is closed.

## 7. EXPECTED / AUTHORIZED MOVEMENT

The repaired node:

`test_parameter_jitter_battery.py::TestComputeRws::test_equity_curve_fallback`

is expected to move from FAIL -> PASS.

That is authorized movement.

Any new test node added solely for the boundary regression test is also authorized population growth **only if the governing population contract admits it normally and records the new exact node ID**. Do not hide population growth behind a count.

## 8. STOP CONDITION ON UNRELATED MOVEMENT

If the new canonical map shows any unrelated outcome movement, including `three_fixes::max_dd`, then:

**STOP BEFORE CENSUS OR SEAL.**

Report:

- exact node ID;
- old outcome;
- new outcome;
- whether the node is newly added or pre-existing;
- whether the changed production module is in its import/reachability path;
- minimal causal evidence.

Do not immediately call it order pollution, flakiness, or repair fallout.

The canonical map decides that a movement exists; cause comes after.

## 9. NO INDEPENDENT GRADER YET

Do **not** dispatch another independent grader merely for this one-line production repair.

The required evidence is:

- RED at the real failing node;
- correct mathematical boundary controls;
- mutation control against both wrong formulas;
- origin-resolvable production/test diff;
- one canonical authority map with exact pre/post comparison.

If that map shows only the expected repaired-node movement plus explicitly authorized new regression-test population, the repair is sufficiently evidenced for R3-4 closeout.

If unrelated movement appears, stop and return to GPT; then we decide whether a grader is warranted.

## 10. REMAINING TWO MONEY-PATH NODES

Do not mutate:

- `test_apply_trade_management_branching::TestBEOnTP1::test_trail_stop_moves_to_be_on_tp1_hit`
- `test_wave_b_intrabar_stops::TestIntrabarsStopsAndTP::test_long_tp_fires_intrabar_even_if_close_falls_back`

until the new canonical map proves they are still in the final non-pass set.

Likewise, do not silently drop the E2E node; the canonical map must account for it.

## FINAL RULING

- Off-by-one root: **CONFIRMED**.
- Worker correction to repair formula: **ACCEPTED; superior to prior suggested spelling**.
- Repair commit `2d42c9e8`: **WORKER-LOCAL FROM GPT'S EXTERNAL SEAT; PUSH REQUIRED**.
- `rws_failure_blocks`: **TEST_CONTRACT_DEFECT**.
- `three_fixes` isolated PASS: **NOT YET AUTHORITY MOVEMENT; canonical map decides**.
- Missing `e2e_backtest::test_walk_forward_mode`: **DENOMINATOR GAP; must be reconciled**.
- Next: **PUSH -> ONE POST-REPAIR CANONICAL MAP -> EXACT PRE/POST DIFF -> THEN FINAL DISPOSITION**.
- No census, seal, or R3-4 closure until that map is adjudicated.
