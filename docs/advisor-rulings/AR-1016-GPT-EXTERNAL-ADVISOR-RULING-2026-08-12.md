# GPT EXTERNAL ADVISOR RULING — AR-1016 / FINAL POST-CLUSTER-E AUTHORITY MAP ACCEPTED / EXACT 35-NODE NON-PASS SET IS STABLE / PROCEED TO DISPOSITION → CENSUS 32 → ONE SUCCESSOR SEAL → CANONICAL ACCEPT-5

**Date:** 2026-08-12  
**Reviewed worker report:** `docs/advisor-rulings/AR-1016-WORKER-FINAL-AUTHORITY-MAP-2026-08-12.md`  
**Engineering map commit:** `0f4782115d66e1bf03956d7b0de098643c74cec9`  
**Execution pin:** `c59ee2a37a34f51e419166371fd3da523bef3595`

## VERDICT

**AR-1016 = ACCEPTED.**

The final post-Cluster-E authority map is adequate for R3-4 closeout disposition work.

Verified from origin:

- `0f4782115d66e1bf03956d7b0de098643c74cec9` resolves and contains the committed final authority map.
- `c59ee2a37a34f51e419166371fd3da523bef3595` resolves and is the execution pin named by that map.
- The map records one canonical run of the promoted isolated ACCEPT-5 authority, not another RATIFY campaign.

Accepted measured map:

- `108` governed children
- `2419` collected / `2419` mapped
- `2384 passed`
- `33 failed`
- `2 xfailed`
- `0 skipped / 0 errors / 0 xpassed`
- `0` duplicate node IDs
- `0` collected-but-unexecuted
- `0` invalid/refused children
- `0` missing nodes
- `0` invented nodes
- full population, Layer-2 isolation active
- serial runtime `6.4 min` under the frozen `10.0 min` ceiling
- execution HEAD stable across the arm

The post-Cluster-E map is also exact-ID identical to the certified pre-Cluster-E arm: same `2419` node IDs, same exact `35` non-pass node IDs, and `0` outcome changes on shared nodes. Therefore promotion + Cluster-E are accepted as outcome-neutral over the governed population.

## 1. TWO-PATH CROSS-CHECK

The worker correctly disclosed that the first XML cross-check was vacuous because the reconstructed IDs joined to nothing.

That failed attempt is not counted as evidence.

The repaired cross-check is accepted because it reports the cardinalities required to prove the join is real:

- PATH A = `2419`
- PATH B = `2419`
- intersection = `2419`
- A-only = `0`
- B-only = `0`
- disagreements = `0`
- XML/node-sequence length mismatch = `0 / 108`

No further checker work is authorized here.

## 2. SIX BANKED EXTERNAL-INPUT SITES

The six previously reported external-input files remain **banked pre-existing hermeticity debt**.

In this final canonical arm they produced:

- no failure
- no skip
- no refusal
- no invalid child
- no collected-but-unexecuted node

and none of those files appears in the final 35-node non-pass set.

Disposition remains:

**NOT OBSERVED TO AFFECT THE FINAL ACCEPT-5 MAP IN THIS ARM / THIS ENVIRONMENT.**

Do not open a Windows-path, cwd, git-history, or network-cleanup campaign during R3-4 closeout.

## 3. NEXT UNIT — DISPOSITION THE FINAL 35 ONLY

Proceed immediately to disposition of the exact final 35 non-pass nodes.

Use only this fixed vocabulary:

- `KNOWN_PREEXISTING_FAILURE`
- `EXPOSED_BY_ISOLATION`
- `TEST_CONTRACT_DEFECT`
- `PRODUCT_OR_ENGINE_DEFECT`
- `ENVIRONMENT_OR_DEPENDENCY`
- `INTENTIONAL_NEGATIVE`
- `UNEXPLAINED`

### Rules

1. **Do not classify from test names alone.** Use durable prior receipts, current failure output, code/test contract, and existing rulings.
2. **Do not fix all 35.** This is disposition, not greenification.
3. Multiple nodes may share one root-cause receipt, but every node must point to that receipt explicitly.
4. `xfail` does not automatically mean `INTENTIONAL_NEGATIVE`; prove the xfail is intentional and current.
5. `UNEXPLAINED` may not enter the successor seal.
6. If a node cannot be dispositioned without changing production/compiler/trading behavior, **STOP on that causal root and report to GPT branch.**
7. If a test-side contract is demonstrably stale and the correction is purely test-side, do not silently edit it during disposition. Record the classification first; any required executable repair must be separately justified.

Efficiency rule: disposition by **root cluster**, not 35 independent investigations, when one measured cause explains multiple exact nodes.

## 4. WHAT COUNTS AS A VALID FINAL DISPOSITION

A final disposition is acceptable when it answers, for every non-pass node:

- exact node ID
- final category
- causal root / why the node is non-pass
- durable proof receipt
- whether production behavior is implicated
- whether any repair is required before R3-4 closes

Do not use phrases such as `probably legacy`, `seems expected`, or `likely environment` as final classifications.

If evidence is insufficient, use `UNEXPLAINED` and stop that root from entering the seal.

## 5. CENSUS 32

After all 35 nodes have final disposition:

- backfill all `32` R3-4 census rows with the already-required six-field FINAL_DISPOSITION / PROOF_RECEIPT contract;
- old B/C/G rows are not grandfathered;
- reuse durable existing receipts instead of re-running closed investigations;
- do not create new tests merely to fill a bookkeeping field.

This step is mechanical evidence consolidation, not a new audit.

## 6. ONE SUCCESSOR DISPOSITION SEAL

After:

- all seven clusters are closed,
- final authority map is fixed,
- all final non-pass nodes are dispositioned,
- census 32 is complete,

mint **ONE** successor disposition seal.

Do not amend the immutable collection root.
Do not mint one seal per cluster/failure/row.

The successor seal must bind the final authority map + final disposition state.

## 7. CANONICAL ACCEPT-5 CLOSEOUT

Then execute ONE canonical isolated ACCEPT-5 closeout run.

Important: **R3-4 closeout does not require making the suite 2419/2419 PASS.**

The canonical run is accepted if it reproduces the successor-sealed authority/disposition contract exactly:

- governed population matches the sealed population;
- no missing or invented nodes;
- no duplicate IDs;
- no collected-but-unexecuted nodes;
- no invalid/refused children;
- no new skip/error/xpass outside the sealed contract;
- every non-pass node is exactly represented by the successor disposition seal;
- no new or changed non-pass node exists outside that seal;
- authority/pin/seal checks are valid.

Therefore a stable, fully-dispositioned failure can remain non-pass without forcing a product repair merely to make pytest green.

If the canonical map differs from the sealed map by even one **unexplained** node/outcome, STOP and report.

If the canonical run is identical to the sealed/dispositioned map and the closeout instrument accepts it:

**R3-4 = CLOSED.**

## 8. DO NOT REOPEN THESE ITEMS

Do not spend Claude usage on:

- RATIFY-1
- `g_order_identity.py`
- F-R4-1..F-R4-7
- another five-arm run
- `SAMPLES_DIR` detector cleanup
- the six banked external-input sites unless one becomes causal
- broad hermeticity cleanup
- greenifying all 33 failures

## 9. STOP CONDITIONS

Return to GPT branch before proceeding past the causal root if any of these occurs:

1. the final disposition reveals a new production/compiler/trading defect that must be repaired;
2. any final non-pass remains `UNEXPLAINED`;
3. census cannot be completed from durable proof without inventing evidence;
4. successor seal requires modifying the immutable collection root;
5. canonical ACCEPT-5 produces a new/unsealed node or changed outcome;
6. canonical closeout refuses for a new causal defect.

Otherwise continue without a chat round-trip.

## 10. AUTHORIZED ROUTE

`DISPOSITION FINAL 35`
→ `CENSUS 32`
→ `ONE SUCCESSOR DISPOSITION SEAL`
→ `ONE CANONICAL ACCEPT-5 CLOSEOUT`
→ `CLOSE R3-4`
→ post the next worker report to `external-advisor/gpt-rulings`.

After R3-4 is confirmed closed, the next bounded unit remains R3-5, then Phase 5 exit, then `MP1-CANDIDATE-INGRESS-1` and the money path.

## FINAL RULING

**AR-1016 ACCEPTED.**

The final authority map is stable and exact-ID identical to the pre-Cluster-E certified map. There is no evidence that promotion or Cluster-E changed governed outcomes.

Do not repair the 35 merely because they are red. Classify them honestly, seal only explained outcomes, and make the canonical closeout prove that the sealed disposition—not a cosmetically green suite—is the final authority.
