# Mutation Kill Matrix

Purpose: prove the test suite can detect implementation defects, not merely confirm the current implementation.

A mutation is considered **KILLED** only when the production source is deliberately changed (in an isolated test/worktree/runner) and at least one listed test fails for the intended reason. This file is a preregistered map; rows remain `PENDING` until an automated mutation campaign records evidence.

| Mutation ID | Planted defect | Defended requirement(s) | Expected killer | Status |
|---|---|---|---|---|
| MUT-001 | Allow one price update to advance BREAK -> PUSH_1 -> ENTRY_READY | IND-MOM-001 | giant-spike + entry-chain invariant | PENDING |
| MUT-002 | Count equal-price reprints as fresh push | IND-MOM-002 | repeated-equal-low/high test | PENDING |
| MUT-003 | Ignore recoil reset | IND-MOM-003 | hard-recoil test/fuzz | PENDING |
| MUT-004 | Remove elapsed-time limit on Push 2 | IND-MOM-004 | slow-push test | PENDING |
| MUT-005 | Carry PUSH_1 across new 5m candle | IND-MOM-005 | Candle-3 reset test | PENDING |
| MUT-006 | Restore snapshot without schema check | IND-REL-001 | snapshot-schema hardening | PENDING |
| MUT-007 | Do not clear state on symbol/contract change | IND-DATA-004 | symbol-change test | PENDING |
| MUT-008 | Treat delayed feed as realtime in live mode | IND-DATA-001 | runtime delayed-live test | PENDING |
| MUT-009 | Treat feed gap as no-trade interval | IND-DATA-002 | runtime gap test | PENDING |
| MUT-010 | Accept off-grid price silently | IND-NUM-002 | price-grid rejection | PENDING |
| MUT-011 | LONG proof rounds down (easier) | IND-ENT-001/NUM | proof-grid integration | PENDING |
| MUT-012 | SHORT proof rounds up (easier) | IND-ENT-001/NUM | proof-grid integration | PENDING |
| MUT-013 | LONG conservative TP rounds up/deeper into pool | IND-TP-001 | target-grid integration | PENDING |
| MUT-014 | SHORT conservative TP rounds down/deeper into pool | IND-TP-002 | target-grid integration | PENDING |
| MUT-015 | NaN score allowed into proof sorting | IND-NUM-003 | numeric fail-closed | PENDING |
| MUT-016 | Choose first input candidate rather than deterministic sort | IND-ENT-004 | permutation property | PENDING |
| MUT-017 | Timeframe always outranks calibrated selection score | IND-ENT-004 | calibrated-score test | PENDING |
| MUT-018 | Countertrend structural threshold equals with-trend threshold | IND-ENT-003 | countertrend-strength test | PENDING |
| MUT-019 | Remove min proof distance | IND-ENT-001 | nearest-tiny-wick test | PENDING |
| MUT-020 | Remove max proof distance | IND-ENT-002 | too-far proof test | PENDING |
| MUT-021 | Always choose closest target pool | IND-TP-004 | strong-withtrend skip-minor test | PENDING |
| MUT-022 | Always choose farther target pool | IND-TP-003 | weak/countertrend close-pool tests | PENDING |
| MUT-023 | Use far wick as conservative target | IND-TP-001/002 | target geometry tests | PENDING |
| MUT-024 | Expose swing at pivot time instead of confirmation time | IND-SWG-001 | future-leak swing test | PENDING |
| MUT-025 | Promote isolated wick to reaction pool | IND-ZONE-001 | single-wick test | PENDING |
| MUT-026 | Make reaction clustering depend on input order | IND-ZONE-002 | cluster permutation test | PENDING |
| MUT-027 | Red trendline crossing flips intraday direction | IND-SEM-001 | golden fixture/platform semantic test | BLOCKED until platform/golden executable fixture |
| MUT-028 | Recompute PDH/PDL as 09:30-16:00 custom session | IND-TIME-002 | platform Daily parity fixture | BLOCKED until platform fixture |
| MUT-029 | Use unfinished HTF value historically | IND-SWG/TIME | Pine live/reload/future-leak fixture | BLOCKED until Pine |
| MUT-030 | Infer stop-first/target-first from 5m OHLC path | IND-EDGE-002 | data/research policy + ordered-path test | PENDING |
| MUT-031 | Random row split instead of chronological day split | IND-EDGE-003 | research split integrity | PENDING |
| MUT-032 | Compute MAE/MFE after exit and call it in-trade excursion | IND-EDGE | path-metrics pre-exit test | PENDING |
| MUT-033 | Hide delayed/replay mode in UI | IND-OPS/human factors | UI acceptance test | BLOCKED until Pine/FXR UI |
| MUT-034 | Silently truncate reaction zones at resource limit | IND-OPS | capacity/resource test | BLOCKED until platform implementation |

## Mutation campaign rules

1. Each mutant changes one semantic behavior at a time.
2. Run the same test command used by the clean baseline.
3. Clean baseline must be green before mutation.
4. Record mutant diff/hash, killer test, failure message, runtime, and code SHA.
5. A mutant that survives is a testing defect or missing requirement; do not dismiss it because the planted bug appears unlikely.
6. Equivalent mutants must be independently justified and reviewed rather than simply excluded by name.
7. Mutation score is reported by requirement severity, not only as one global percentage. All S4/live-state mutants must be killed before `REFERENCE_VERIFIED`.
