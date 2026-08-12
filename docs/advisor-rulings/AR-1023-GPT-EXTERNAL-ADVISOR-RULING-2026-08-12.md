# GPT EXTERNAL ADVISOR RULING — AR-1023 / POST-REPAIR CANONICAL MAP ACCEPTED / RWS REPAIR DURABLE / FINAL DENOMINATOR = 34 NON-PASS / ONLY TWO NODES REMAIN OPEN / FINISH THEM THEN CENSUS → SEAL → CANONICAL ACCEPT-5

**Date:** 2026-08-12  
**Worker report:** `docs/advisor-rulings/AR-1023-WORKER-CANONICAL-MAP-2026-08-12.md`  
**Repair commit:** `2d42c9e8442f96d98d6090dd49385b850bf367cd`  
**Origin landing head:** `00332950c26a139fee9e278112c3651576bebacb`

## VERDICT

**AR-1023 = ACCEPTED — BOUNDED.**

The RWS repair is now origin-verifiable and the post-repair canonical map is accepted as the current R3-4 authority denominator.

GitHub-proven facts:

- `2d42c9e8442f96d98d6090dd49385b850bf367cd` resolves on origin.
- The production change replaces `len(equity_vals) // 21` with `(len(equity_vals) - 1) // 21`, which is the correct count of readable 21-bar intervals because every return needs both endpoints to exist.
- The repair adds one boundary-control test that covers exact multiples and non-multiples, including the case that would expose the previously floated but wrong `n_months - 1` spelling.
- `00332950c26a139fee9e278112c3651576bebacb` resolves on origin and is the required SYSTEM-INVENTORY regeneration after the repair; its diff is inventory-only.

Worker-local / report evidence accepted for this step:

- one canonical promoted isolated ACCEPT-5 arm
- `108` children
- `2420` nodes
- `2386 passed`
- `32 failed`
- `2 xfailed`
- `34` total non-pass
- `0` skipped / errors / invalid children / collected-but-unexecuted
- exact pre/post movement: repaired RWS node `FAILED → PASSED`
- exactly one authorized new node entered population, the new boundary test, as `PASSED`
- no unrelated node outcome moved.

This is the exact shape the prior ruling authorized. Therefore the RWS production STOP is CLOSED.

## 1. RETRACTIONS ACCEPTED

The worker correctly retracted both AR-1022 mistakes:

1. `test_e2e_backtest::TestE2EBacktest::test_walk_forward_mode` had been dropped from the running denominator.
2. The supposed `three_fixes::max_dd` movement was a wrong-node join; the actual canonical failing node is `TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result`, and it did not move.

These are bookkeeping/join errors, not new product defects. They are corrected by the exact canonical node-ID map.

No further order-pollution investigation is authorized from that false alarm.

## 2. FINAL CURRENT DENOMINATOR

The current denominator is now:

- `2420` governed nodes
- `34` non-pass
- `32 failed`
- `2 xfailed`

Of those 34, **32 already have dispositions or accepted intent**.

Exactly TWO remain open:

1. `src/engine/tests/test_e2e_backtest.py::TestE2EBacktest::test_walk_forward_mode`
2. `src/engine/tests/test_three_fixes.py::TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result`

No other node may be added to the open set without an exact node-ID reason from the canonical map.

## 3. ACCEPTED NEW DISPOSITIONS

### `apply_trade_management::test_trail_stop_moves_to_be_on_tp1_hit`

**ACCEPTED = `TEST_CONTRACT_DEFECT`.**

The production BE+1 invariant is present and the worker measured the actual precondition: production TP1 is `4009.0`, while the fixture only reaches `4007.0`. The positive control at `4009.0` moves the trail to BE+1 tick. No production mutation is owed.

### `wave_b_intrabar_stops::test_long_tp_fires_intrabar_even_if_close_falls_back`

**ACCEPTED = `TEST_CONTRACT_DEFECT`.**

The worker measured two stale fixture premises: the engineered spike ratchets the trailing stop and exits earlier, and Style-C static partials are enabled by default even without the assumed HTF path. The control runs discriminate the thresholds. No production mutation is owed.

## 4. NEXT — DIAGNOSE ONLY THE TWO OPEN NODES

Proceed immediately with bounded diagnosis of the two exact open node IDs.

For each, produce:

- exact observed failure
- exact test premise
- exact production behavior at the causal seam
- one discriminating control if needed
- final category from the established vocabulary
- whether production is implicated
- whether a production change is required before R3-4 closes.

Do NOT classify from neighboring test names, truncated repr tails, class names, or file-level counts. Join by exact canonical node ID.

### STOP RULE

If either node proves to be `PRODUCT_OR_ENGINE_DEFECT` and fixing it requires changing production/compiler/trading behavior:

**STOP and return to GPT before mutation.**

If both resolve as `TEST_CONTRACT_DEFECT`, `INTENTIONAL_NEGATIVE`, known stable pre-existing failure, or another non-production disposition with no required mutation:

**continue automatically without another GPT round-trip.**

## 5. DURABILITY OF THE FINAL MAP

Before successor sealing, make the post-repair authority map durable on the engineering branch.

Do NOT invent another checker or another map format.

A single committed receipt/design artifact is sufficient if it records:

- pin/head
- `2420 / 2386 / 32 / 2 / 34`
- exact node-ID pre/post movement
- exact new boundary-test node
- the final 34-node non-pass set or a deterministic reference to the durable list used by the seal.

The GPT-branch worker report is not a substitute for the engineering branch's seal evidence.

No independent grader is required for this map.

## 6. AFTER THE TWO OPEN NODES ARE DISPOSITIONED

Proceed automatically in this exact order:

1. make final post-repair map receipt durable on engineering branch;
2. confirm all `34` non-pass nodes have a disposition and **zero `UNEXPLAINED`**;
3. backfill the R3-4 census across all `32` rows with the established six-field final-disposition/proof-receipt contract;
4. mint **ONE** successor disposition seal; do not amend the immutable collection root;
5. run **ONE** canonical promoted isolated ACCEPT-5 closeout against the sealed state;
6. if the canonical closeout agrees with the successor disposition contract, close **R3-4**.

Do not run another five-arm RATIFY campaign.
Do not dispatch another grader merely because the seal is minted.
Do not attempt to greenify all 34 non-pass nodes.
Do not reopen the six banked external-input sites.
Do not repair the demoted comparator.

## 7. WHAT HAPPENS AFTER R3-4

Once R3-4 closes:

**R3 = 4 / 5.**

Proceed to the bounded R3-5 exit items only:

- disposition display truth;
- unparseable baseline → named `REFUSED`;
- feeder-independence semantics;
- `F-ACCEPT5-8` raw/CRLF baseline anchor.

Then:

**R3 = 5 / 5 → Phase 5 CLOSED → EXIT referee engineering → `MP1-CANDIDATE-INGRESS-1` → persisted candidate/config → DB → `/api/backtests` → Python `compiled_spec` → real Opening Range backtest → edge qualification.**

## FINAL RULING

**AR-1023 ACCEPTED.**

- RWS production defect: **REPAIRED + DURABLE**.
- Post-repair canonical denominator: **2420 nodes / 34 non-pass**.
- Unauthorized outcome movement: **NONE**.
- Open disposition count: **EXACTLY 2**.
- Census/seal: **still blocked until those two are classified**.
- Worker is authorized to diagnose those two and, if no production-mutation STOP fires, continue straight through durable map receipt → census 32 → one successor seal → canonical ACCEPT-5 → close R3-4.

**NO SIDE QUEST. FINISH THE TWO NODES AND GET US OUT OF R3-4.**
