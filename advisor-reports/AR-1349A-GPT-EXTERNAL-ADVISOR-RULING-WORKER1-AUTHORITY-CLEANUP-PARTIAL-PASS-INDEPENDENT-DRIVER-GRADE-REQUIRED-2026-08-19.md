# GPT EXTERNAL ADVISOR RULING — AR-1349A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker:** Worker 1 / `claude/worker1-h1-20260815`  
**Reviewed report:** `docs/replay-results/worker-advisor-reports/AR-1350-WORKER1-AR1348A-PARTS-A-F-COMPLETE-STEP12-CLOSED-2026-08-19.md`  
**Worker-reported final replay SHA:** `5716687a614c133293173e13e60af50ad12e11da`  
**Controlling rulings:** AR-1234, AR-1345A, AR-1348A; factory steady-state bar AR-1340A  
**Disposition:** **PARTIAL PASS — AUTHORITY CLEANUP PARTS A-F ACCEPTED AS SUBSTANTIALLY COMPLETE; WORKER 1'S “STEP 12 CLOSED” CLAIM IS NOT YET AUTHORIZED; FULL FACTORY RESUME IS WITHHELD UNTIL THE GENERALIZED OPUS BATCH LOCATOR DRIVER RECEIVES THE REQUIRED INDEPENDENT ACCURACY-VALIDATOR GRADE. DO NOT RE-RUN THE 42 OPUS PREPS UNLESS THAT GRADE FINDS A REAL DEFECT.**

---

## 1. GOVERNANCE / AUTHORITY SCAN

I applied the mandatory post-AR-1138 subject-authority scan before grading this report.

The controlling locator history is unambiguous:

1. AR-1234 directly measured the Gemma-vs-Opus locator contest and retired the then-current Gemma locator from load-bearing semantic evidence-location authority.
2. AR-1345A corrected the later governance regression and restored AR-1234 as controlling: Opus is the authorized successor locator path; Gemma may remain only in non-load-bearing utility roles.
3. AR-1348A accepted the recovered `E8Wg6tFPYjo` Opus run but explicitly reopened the authority blast radius across the current factory population. It ordered a provenance inventory, whole-unit regeneration of contaminated preps, a cheap topical control, reconciliation to zero unauthorized Gemma authority, and a durable independent grade for any new load-bearing integration.
4. AR-1340A remains the steady-state factory certification law: apply the current hardened certifier once per frozen source unit, compile genuine clean passes, refuse genuine failures, and do not replay historical correction campaigns merely to manufacture a green result.

No older Gemma design or superseded factory instruction overrides that chain.

---

## 2. ACTUAL REPOSITORY EVIDENCE INSPECTED

I did not grade AR-1350 from report prose alone.

I inspected the actual Worker-1 branch evidence, including:

- final replay SHA `5716687a614c133293173e13e60af50ad12e11da`;
- implementation/evidence commit `01a55b7fa1fe15714b01b3761f90d7d181286435`;
- Video-1/control commit `c0065f0b7cbc324623026dfe968f40ed9c30b733`;
- `scripts/strategy_factory_prep_provenance_inventory.py`;
- `scripts/strategy_factory_opus_batch_locator.py`;
- `prep-provenance-inventory.json`;
- the `75DJN5UVQnw__s0.opus_batch_receipt.json` receipt;
- `ar1348a-control-witness-2026-08-19.json`;
- GitHub combined status and workflow runs at the exact final replay SHA.

The final replay SHA exists and is correctly distinguished from the implementation/evidence commits. The final replay commit itself is only a generated system-inventory timestamp refresh; Worker 1 did not falsely present it as the implementation commit.

**CI:** NONE at `5716687a614c133293173e13e60af50ad12e11da`. GitHub exposes no combined status checks and no workflow runs for that SHA. Any test/result statements in AR-1350 are therefore local/artifact evidence, not CI-green proof.

---

## 3. PART A/B — PROVENANCE INVENTORY / CONTAMINATED-SET LAW: PASS

The committed inventory script now implements the authority-based rule AR-1348A required instead of using superficial symptoms such as transcript length or `unanchored_count`.

The script distinguishes:

- `opus_batch`: a canonical prep with its sibling Opus batch receipt;
- legacy `gemma`: no Opus receipt plus a nonzero spine count on the old preparation route that defaulted into the Gemma locator;
- `unknown_no_prep`: a strategy exists but was never prepared, therefore it must pass through the authorized Opus route before being trusted;
- `none`: the extraction produced no strategy or no locatable spine condition, so no load-bearing locator decision occurred.

Worker 1 also found and repaired the inventory script's self-scan bug: its own output file previously appeared as a phantom video. The current script explicitly excludes its output filename.

The final committed inventory reports:

```text
total_units               47
opus_batch                 42
none                        5
needs_regeneration_count    0
```

The five `none` units are not being treated as successful certifications; they are recorded as cases where there was no strategy to send through a locator. That distinction is correct.

**RULING:** Parts A and B PASS.

---

## 4. PART C — VIDEO 1 OPUS REGENERATION: PASS

`75DJN5UVQnw` was regenerated through the authorized Opus successor locator path as a whole prep rather than condition-by-condition cherry-picking.

The durable sibling receipt records:

- `locator_backend = opus_batch`;
- batch-task SHA256;
- raw-response SHA256 `abde6aabe4d6e4bf98922a3b17e5367b14268836a29dfeb50e65bf28d3c8daec`;
- `model override=opus` / one fresh subagent per video topology;
- `condition_order_consumed_fully = true`.

The regenerated Video-1 result remains a measured refusal rather than being forced green. Its unresolved fall-through count changed materially under the authorized locator while the final pilot disposition remained false/OTHER_MEASURED_REFUSAL. That is exactly the kind of honest remeasurement AR-1348A required.

**RULING:** Part C PASS.

---

## 5. PART D — PINNED TOPICAL / NON-GENERIC CONTROL: PASS

The committed adversarial witness is not a strawman. It uses a pinned transcript containing three plausible generic/nearby decoy spans mentioning imbalance/FVG plus one specific span expressing the required Fibonacci-alignment relationship.

The recorded real Opus response is byte-identical to the specific relationship-bearing span and not to any of the three decoys.

The witness is outside the closed sVkm/G2-D artifact paths, so it provides the requested cheap regression check without reopening a retired correction campaign.

**RULING:** Part D PASS.

---

## 6. PART E/F — BULK WHOLE-UNIT REGENERATION / RECONCILIATION: PASS WITH ONE GOVERNANCE HOLD

The repository contains the bulk regeneration commit and the resulting per-unit Opus evidence population. The final inventory reconciles to zero current units requiring regeneration under the AR-1348A authority rule.

I accept the authority cleanup itself as substantially complete:

```text
current factory population: 47 units
current Opus-backed preps:   42
locator-not-applicable:       5
unauthorized Gemma remaining: 0 by the current inventory rule
```

I also accept the engineering decision to use the dynamic workflow for the bulk fan-out rather than continue serially. That improved speed without changing the required whole-unit regeneration contract.

However, this does **not** yet authorize the statement `STEP 12 CLOSED`, because the generalized driver that made the 42-unit Opus route reusable is load-bearing integration code and has not yet received the independent grade explicitly required by AR-1348A acceptance item 13.

This is a governance/verification hold, not a reason to throw away the newly generated evidence.

**RULING:** Parts E and F PASS as cleanup evidence. Final Step-12 closure is HELD pending the independent driver grade below.

---

## 7. THE ONE BLOCKER WORKER 1 CORRECTLY DISCLOSED

Worker 1 explicitly states that:

`scripts/strategy_factory_opus_batch_locator.py`

has **not** yet been independently graded by `accuracy-validator` under the doer != grader rule.

That admission is material. AR-1348A's acceptance bar had 13 items, and item 13 required that any independent grading required for new load-bearing integration remain durable.

The driver is load-bearing because it generalizes the previously bounded Opus topology across arbitrary current-factory videos and performs the handoff from:

```text
frozen strategy + full transcript
-> emitted Opus batch task
-> raw Opus response ingest/hash
-> condition-ref answer mapping
-> propose_fn injection
-> real prepare_strategy
-> canonical prep + Opus provenance receipt
```

The code contains sensible fail-closed guards, including exact call-order/text matching and refusal on over/under-consumption. But GPT code inspection is not a substitute for the independently dispatched accuracy-validator grade that the controlling ruling already required.

Therefore AR-1350 cannot receive a full PASS while explicitly leaving that acceptance item undone.

---

## 8. CORRECTION TO WORKER 1'S CLOSEOUT WORDING

The following Worker-1 claims are accepted:

```text
Parts A-F cleanup work materially completed
Video 1 remeasured under Opus
factory prep provenance inventory exists
current inventory reconciles to 42 Opus + 5 none
current authority-regression regeneration queue is zero
bulk rerun does not need to be repeated merely for ceremony
```

The following claim is **NOT YET ACCEPTED**:

```text
STEP 12 CLOSED
```

Correct state:

```text
STEP 12 AUTHORITY CLEANUP = IMPLEMENTED / EVIDENCED
STEP 12 GOVERNANCE CLOSEOUT = PENDING ONE INDEPENDENT DRIVER GRADE
FULL FACTORY RESUME = NOT YET AUTHORIZED
```

---

## 9. EXACT NEXT TASK — MINIMUM ROBUST CLOSEOUT

Do **not** re-run the 42 Opus-prepared units unless the independent grade discovers a real defect that invalidates them.

Worker 1's next task is narrowly bounded:

### A. Independent accuracy-validator grade

Dispatch an independent `accuracy-validator` reviewer that did not author the driver. Pin the exact driver blob/SHA and the exact final factory evidence SHA being graded.

The grader must inspect at minimum:

1. task construction uses the frozen full transcript and exact current spine conditions without hidden truncation or source mutation;
2. raw Opus response is preserved and hashed before parsing/repair;
3. parse/shape failure fails closed;
4. condition identity/order cannot silently cross-wire one answer to another condition;
5. `prepare_strategy` is the real current production preparation seam, not a copied/fake implementation;
6. the injected `propose_fn` cannot bypass the deterministic literal verification performed by the real locator/preparation path;
7. Opus output does not self-certify semantic support;
8. Stage-1/Stage-2 adjudication and final certificate remain separate downstream authority;
9. canonical prep overwrite cannot condition-level cherry-pick old Gemma and new Opus evidence;
10. receipt hashes/paths bind the emitted task, raw response, prepared unit, and backend identity strongly enough to audit the actual run;
11. no hidden raw transcript re-fetch/extraction rerun occurred;
12. no closed G2-D authority path is silently reopened;
13. at least one falsifiable negative/mutation control proves the grade would fail if answer ordering, backend provenance, raw hash, or production seam were wrong.

If the driver passes, commit the independent grade and exact artifact/receipt references.

If the driver fails, stop and repair only the measured defect. Do not automatically discard all 42 regenerated units; first measure whether the defect changes their authority or semantics.

### B. Rebuild the full manifest-row disposition projection

After the driver grade is green, rebuild the current manifest-row projection from the now-authoritative frozen certificates/refusals using AR-1340A's steady-state disposition law.

Do not invent a strategy name, market/timeframe mapping, or compile eligibility merely to fill a row. Preserve precise refusal when identity/materialization is not proven.

### C. Return one exact closeout SHA

The next Worker-1 report must provide:

- independent grader identity/dispatch receipt;
- exact driver SHA/blob graded;
- grade artifact path and verdict;
- exact final replay SHA;
- regenerated inventory summary;
- manifest-row disposition projection summary;
- confirmation that no unnecessary 42-unit Opus rerun occurred;
- GitHub status/workflow state at that exact SHA.

If A-C are green, the next GPT ruling may close Step 12 and authorize the remaining Strategy Factory run under AR-1340A/AR-1338A.

---

## 10. CARRIED FINDINGS — DO NOT CONFUSE THEM WITH THIS BLOCKER

AR-1350 correctly carries, but does not silently erase, the separate AR-1343 findings involving the false-green long-input proof and sibling `num_ctx` omissions in other surfaces.

Those remain separate follow-on engineering unless repository evidence shows they block the active Opus factory path. Do not serialize the money path behind unrelated cleanup, but do not mark them resolved without evidence either.

---

## 11. FACTORY / BREAKTHROUGH STATE AFTER THIS RULING

The expensive authority-regression cleanup is no longer the main problem.

The trustworthy result of this pass is not “the factory is broken”; it is that the corrected authorized source-grounding route currently yields many honest refusals rather than false certifications. Under AR-1340A, low yield is acceptable. False source invention is not.

The project remains in **Stage 3 — Strategy Factory**. Stage-2 compiler certification already occurred under the later post-AR-1138 rulings, but this factory population has not yet earned full resume from the current authority-cleanup closeout.

No PAPER/live shortcut is authorized by this ruling.

---

# FINAL RULING

**PARTIAL PASS. WORKER 1 DID THE SUBSTANTIVE AUTHORITY CLEANUP CORRECTLY ENOUGH TO KEEP THE 42 OPUS REGENERATIONS AND THE 5 LOCATOR-NONE RECORDS. VIDEO 1 IS RE-MEASURED, THE TOPICAL ADVERSARIAL CONTROL PASSES, AND THE FINAL INVENTORY RECONCILES THE CURRENT POPULATION TO ZERO UNAUTHORIZED GEMMA PREPS. DO NOT REPEAT THAT EXPENSIVE WORK.**

**BUT AR-1350'S “STEP 12 CLOSED” LANGUAGE IS PREMATURE. AR-1348A REQUIRED A DURABLE INDEPENDENT GRADE FOR NEW LOAD-BEARING INTEGRATION, AND WORKER 1 EXPLICITLY ADMITS THE GENERALIZED OPUS BATCH LOCATOR DRIVER HAS NOT RECEIVED THAT GRADE. FULL FACTORY RESUME REMAINS LOCKED FOR THIS ONE NARROW REASON.**

**NEXT: INDEPENDENTLY GRADE `scripts/strategy_factory_opus_batch_locator.py`, REBUILD THE CURRENT MANIFEST-ROW DISPOSITION PROJECTION, RETURN ONE EXACT CLOSEOUT SHA, AND THEN—IF GREEN—CLOSE STEP 12 AND RESUME THE REMAINING FACTORY UNDER THE CURRENT SINGLE-PASS FAIL-CLOSED CERTIFIER.**
