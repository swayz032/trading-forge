# GPT EXTERNAL ADVISOR RULING — AR-1017 / INTERIM DISPOSITION ACCEPTED / 18-NODE A+ CLUSTER MAY BE BANKED AS TEST_CONTRACT_DEFECT / CONTINUE THE REMAINING 17 / DO NOT LET STOP[44] COUNTS SUBSTITUTE FOR A NODE-ID JOIN

**Date:** 2026-08-12  
**Reviewed worker report:** `docs/advisor-rulings/AR-1017-WORKER-DISPOSITION-IN-PROGRESS-2026-08-12.md`  
**Final authority pin:** `c59ee2a37a34f51e419166371fd3da523bef3595`  
**Final map commit:** `0f4782115d66e1bf03956d7b0de098643c74cec9`

## VERDICT

**AR-1017 = PASS_FOR_INTERIM_DISPOSITION.**

The worker correctly stopped short of claiming the 35-node disposition is complete. The first 18 nodes may be banked; 17 remain unclassified and R3-4 closeout remains open.

The reporting-process failure is acknowledged and corrected: a worker result that exists only in chat is not delivered. From this point the GPT branch remains the authoritative worker→advisor handoff.

## 1. A+ 18-NODE CLUSTER — ACCEPTED

Disposition accepted for all 18 final non-pass nodes in:

`src/engine/tests/test_a_plus_gate_parity.py`

Category:

**`TEST_CONTRACT_DEFECT`**

Accepted causal statement, and no stronger:

> These tests exercise/import an A+ backtester API surface that has no implementation in the repository history established by the durable prior-art receipt; their non-pass state is caused by the test contract targeting a non-existent API, not by a newly observed regression in an implementation that previously existed.

Independent verification:

- `R-694` at `0e17d13f` independently verified `def _apply_a_plus_confluence_gate|def _compute_rolling_volume_mean` has `0` definitions repo-wide while the same instrument positively finds `def run_backtest` in `backtester.py`.
- At the final authority pin, `test_a_plus_gate_parity.py` directly imports `_apply_a_plus_confluence_gate` inside the failing A+ gate tests.
- The final map contains exactly 18 non-pass nodes from this file, joining the prior-art cluster by file and count.

Therefore the 18-node root is sufficiently dispositioned for R3-4.

### Bound that MUST travel with the disposition

This disposition answers **why these tests are non-pass**.

It does **not** decide whether an A+ confluence gate should exist as a future product feature, whether these tests should eventually be deleted/rewritten, or whether the intended feature was abandoned.

Do not silently convert `TEST_CONTRACT_DEFECT` into:

- `PRODUCT FEATURE NOT NEEDED`,
- `SAFE TO DELETE`,
- `SAFE TO XFAIL`, or
- `IMPLEMENTATION SHOULD NEVER EXIST`.

No repair is required for these 18 before R3-4 closeout.

## 2. REMAINING 17 — CONTINUE BY ROOT CLUSTER

Proceed without another GPT round-trip.

Remaining population:

- 4 `test_pnl_accuracy.py`
- 3 `test_parameter_jitter_battery.py`
- 2 `test_accuracy_fixes.py`
- 2 `test_production_hardening_g2a_g2b.py`
- 2 `test_session_role_adversarial_fence.py` (`xfailed`)
- 1 `test_apply_trade_management_branching.py`
- 1 `test_e2e_backtest.py`
- 1 `test_three_fixes.py`
- 1 `test_wave_b_intrabar_stops.py`

Use the fixed disposition vocabulary already authorized:

- `KNOWN_PREEXISTING_FAILURE`
- `EXPOSED_BY_ISOLATION`
- `TEST_CONTRACT_DEFECT`
- `PRODUCT_OR_ENGINE_DEFECT`
- `ENVIRONMENT_OR_DEPENDENCY`
- `INTENTIONAL_NEGATIVE`
- `UNEXPLAINED`

Classify by causal root, not by truncated `failure_reprs` tails and not merely by filename.

## 3. STOP[44] — THE 7-VS-4 PnL COUNT MUST BE JOINED BEFORE USE

The worker correctly did not infer that the final map's 4 `test_pnl_accuracy.py` nodes are automatically the same population as the historical `STOP [44]` statement about 7 PnL nodes.

Before using STOP[44] as the disposition authority:

1. recover/enumerate the exact node IDs governed by the historical 7-node statement, or the narrowest durable receipt that identifies them;
2. intersect that set with the exact final 35-node set;
3. report the join cardinality and exact matching node IDs;
4. apply STOP[44] only to the joined nodes.

If the historical 7 cannot be enumerated from durable evidence, mark that historical set **UNENUMERATED** and do not use the number `7` as authority over the final four.

No PnL repair, weakening, skip, xfail, or greenification is authorized during disposition.

## 4. THE TWO XFAILS

The worker's stated method is correct:

`xfail` is an outcome, not a disposition category.

For each of the two `test_session_role_adversarial_fence.py` nodes, prove from current source and/or durable prior art that the xfail marker is intentional and still corresponds to the condition being exercised.

Only then may it be classified `INTENTIONAL_NEGATIVE`.

If the marker is stale, generic, or masks a different defect, classify the actual root instead.

## 5. INSTRUMENT FAULTS

The disclosed cp1252 issue and truncated-repr clustering artefact do not invalidate the accepted 18-node conclusion because that conclusion was re-grounded in source and durable prior art.

The consequence is binding for the remaining work:

**DO NOT CLUSTER OR CLASSIFY THE REMAINING 17 FROM TRUNCATED `failure_reprs` TAILS.**

A failure-signature counter is exploratory only unless the join back to exact nodes and causal source is demonstrated.

## 6. REPORTING CADENCE

The worker may continue autonomously, but because the operator explicitly moved the advisor loop onto the GPT branch:

- each meaningful disposition milestone must be committed to `external-advisor/gpt-rulings`;
- no chat-only report counts as delivered;
- do not wait until seal/census if a new STOP condition, `PRODUCT_OR_ENGINE_DEFECT`, or `UNEXPLAINED` cluster appears.

If the remaining 17 all classify cleanly with no STOP, one final completed-disposition report is sufficient before census/seal work.

## 7. STOP CONDITIONS

Return to GPT before census/seal if any of the remaining 17 becomes:

1. `UNEXPLAINED` after bounded causal investigation;
2. `PRODUCT_OR_ENGINE_DEFECT` that would require changing production/compiler/trading behavior before closeout;
3. an xfail whose intent cannot be proved;
4. a PnL node whose disposition depends on the historical 7-node STOP[44] set but that set cannot be joined to exact current node IDs in a way that materially changes the decision.

Otherwise continue.

## CURRENT STATE

- Final authority map: ✅ accepted
- Final non-pass population: `35`
- Disposition complete: `18 / 35`
- A+ cluster: ✅ `TEST_CONTRACT_DEFECT`
- Remaining: `17`
- Census 32: not started
- Successor seal: not minted
- Canonical ACCEPT-5 closeout: not run
- R3-4: **OPEN**

## NEXT

**Classify the remaining 17 by causal root → land the completed disposition report on the GPT branch → if no STOP fired, proceed to census 32 → one successor seal → canonical ACCEPT-5.**

Do not repair failures merely to make the suite green. Do not reopen RATIFY. Do not start side cleanup.
