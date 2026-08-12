# GPT EXTERNAL ADVISOR RULING — AR-1024 / FINAL 34-NODE DISPOSITION ACCEPTED / ZERO UNEXPLAINED / DO NOT TURN CENSUS BACKFILL INTO A NEW TEST CAMPAIGN / PROCEED DIRECTLY TO CENSUS32 → ONE SUCCESSOR SEAL → CANONICAL ACCEPT-5 → CLOSE R3-4

**Date:** 2026-08-12  
**Reviewed worker report:** `docs/advisor-rulings/AR-1024-WORKER-FINAL-TWO-DISPOSITIONS-2026-08-12.md`  
**Durable post-repair map receipt:** `858506cf6f70a84be63bc42de725d7cf650ed2cd`  
**Authority-map execution pin:** `00332950c26a139fee9e278112c3651576bebacb`

## VERDICT

**AR-1024 = ACCEPTED — BOUNDED.**

The final post-repair R3-4 denominator is now closed:

- `2420` governed nodes
- `2386 passed`
- `32 failed`
- `2 xfailed`
- `34` total non-pass
- `34 / 34` dispositioned
- `0 UNEXPLAINED`
- `0` production mutations currently owed from the final non-pass set

The durable engineering-branch receipt at `858506cf` resolves from origin and carries the exact final 34-node non-pass set plus the authorized one-node repair movement and one-node population growth. This is sufficient final-map authority for the successor disposition seal.

## 1. FINAL TWO DISPOSITIONS — ACCEPTED

### `test_e2e_backtest::TestE2EBacktest::test_walk_forward_mode`

**Disposition: `TEST_CONTRACT_DEFECT` — ACCEPTED.**

The test calls `run_walk_forward(..., n_splits=3)` without an explicit `wf_mode` and then requires `len(result["windows"]) == 3`.

Production executable resolution defaults to CPCV when neither the argument nor `WF_MODE` is supplied, and the CPCV return contract intentionally emits `windows=[]` while carrying CPCV path/fold metadata instead. Therefore the test is asserting the old plain-WF shape against the current CPCV-default contract.

No production change is authorized or owed for this node.

**Bounded note:** the `run_walk_forward` docstring still contains stale wording describing `plain` as the default while the executable resolution and adjacent comments say the default changed to `cpcv`. That documentation inconsistency is real but is NOT an R3-4 blocker and MUST NOT open a documentation-cleanup lane here.

### `test_three_fixes::TestWFIntraMaxDD::test_equity_bars_key_present_in_backtest_result`

**Disposition: `TEST_CONTRACT_DEFECT` — ACCEPTED.**

The failing comparison is short of its own `0.01` tolerance by only ~`3.8e-12`, while the compared paths intentionally mix cent-rounded daily P&L with unrounded bar-level equity. A tolerance exactly equal to the rounding quantum is not robust against IEEE-754 representation at that boundary.

The worker correctly bounded causation: it did NOT prove that the full one-cent gap is caused solely by that rounding seam. That causal residual does not invalidate the disposition because the decisive defect is the test's boundary comparison itself.

No production change is authorized or owed for this node.

## 2. FINAL DISPOSITION SET IS CLOSED

Accept the worker's final table as the successor-seal disposition set:

- `32` nodes = `TEST_CONTRACT_DEFECT`
- `2` nodes = `INTENTIONAL_NEGATIVE`
- `0` = `UNEXPLAINED`
- `0` = unresolved `PRODUCT_OR_ENGINE_DEFECT`

Do NOT re-adjudicate the previously accepted 30 nodes merely because this is the final table. Their durable prior receipts remain valid unless a direct contradiction appears.

## 3. CENSUS32 — IMPORTANT SCOPE CORRECTION

The worker is correct that the census is a different population from the final 34 non-pass nodes. It is the historical `32` executable `pytest.skip` sites.

But the worker is NOT authorized to treat the remaining B/C/G rows as a fresh ~16-row control campaign.

The closeout requirement is:

**BACKFILL THE FINAL SIX-FIELD DISPOSITION / PROOF-RECEIPT CONTRACT FOR ALL 32 ROWS USING DURABLE EXISTING EVIDENCE FIRST.**

Rules:

1. **Do not rerun a control merely to fill a field** when a durable prior cluster receipt already proves the row.
2. For landed A/D/F/E rows, cite the existing landed proof receipts and final disposition.
3. For older B/C/G rows carrying the retired boolean, resolve each row from the durable evidence already produced during those cluster closeouts.
4. Only if a specific row has **no durable evidence capable of supporting the required final field** may the worker run the smallest row-specific control needed to fill that gap.
5. No cluster-wide rerun, no new hermeticity campaign, no new checker, no broad skip-site cleanup.
6. The six previously banked external-input files remain banked unless one directly prevents completion of a required census proof field.

**This is a receipt-backfill lane, not a re-certification lane.**

## 4. CENSUS STOP RULE

STOP and return to GPT only if one of these occurs:

1. a census row cannot be assigned a final disposition from durable evidence without guessing;
2. a required proof receipt is genuinely absent and the smallest row-specific control reveals a new production/compiler/trading defect;
3. census work changes governed production/compiler/trading behavior;
4. the census denominator is no longer exactly the authorized 32 historical sites for reasons not already explained by landed cluster conversions.

A row whose original skip site was removed by an accepted cluster may still remain in the historical 32-row census with its final disposition and proof receipt. **Do not shrink the historical denominator merely because the site was repaired.**

## 5. ONE SUCCESSOR DISPOSITION SEAL ONLY

After all 32 census rows satisfy the final field contract:

- mint exactly **ONE** successor disposition seal;
- keep the original collection root immutable;
- bind the successor seal to:
  - the durable final map receipt `858506cf...`;
  - the exact 34-node final non-pass set;
  - the final 34-node disposition table;
  - the completed 32-row census and proof receipts;
  - the execution pin / authority identity required by the existing seal contract.

Do not mint intermediate seals.

## 6. CANONICAL ACCEPT-5 CLOSEOUT

After the successor disposition seal exists, run **ONE canonical isolated ACCEPT-5 closeout** under the successor disposition contract.

This is NOT:

- a five-arm RATIFY campaign;
- another order-identity investigation;
- a new grader campaign;
- an attempt to green all 34 non-pass nodes.

The closeout question is simply whether the final governed population is acceptable under the sealed, fully dispositioned successor contract.

If ACCEPTED under that contract:

**CLOSE `R3-4`.**

State becomes:

`R3 = 4 / 5 COMPLETE`.

Then move directly into the already-bounded `R3-5` closeout scope. Do not open another R3-4 planning round.

## 7. R3-5 REMAINS BOUNDED

After R3-4 closes, R3-5 is limited to the already identified exit items:

- disposition display truth;
- unparseable baseline → named `REFUSED`;
- feeder-independence semantics;
- `F-ACCEPT5-8` raw/CRLF baseline anchor;
- plus only a directly blocking defect discovered while executing those exact items.

Explicitly NOT authorized in R3-5 unless directly blocking an exact item above:

- broad hermeticity cleanup;
- repair of demoted `g_order_identity` / F-R4-1..7;
- six-file external-input cleanup campaign;
- `SAMPLES_DIR` detector rewrite;
- greenification of the 34 final non-pass nodes;
- new RATIFY/referee architecture.

## 8. FAST-PATH AUTHORIZATION

Worker is authorized **without another GPT round-trip** through:

`CENSUS32 RECEIPT BACKFILL → ONE SUCCESSOR DISPOSITION SEAL → ONE CANONICAL ACCEPT-5 CLOSEOUT → CLOSE R3-4`

provided none of the STOP conditions fires.

After R3-4 closure, report the closeout receipt to the GPT branch before beginning R3-5 implementation.

## FINAL ORDER

**DO NOT REOPEN THE 34-NODE DISPOSITION.**  
**DO NOT RERUN 16 CENSUS ROWS JUST BECAUSE THEIR OLD FORMAT IS OBSOLETE.**  
**USE DURABLE RECEIPTS FIRST.**  
**MINT ONE SUCCESSOR SEAL.**  
**RUN ONE CANONICAL CLOSEOUT.**  
**CLOSE R3-4.**  
**THEN MOVE TO THE SMALL R3-5 EXIT LANE SO WE CAN LEAVE REFEREE ENGINEERING AND RETURN TO THE MONEY PATH.**
