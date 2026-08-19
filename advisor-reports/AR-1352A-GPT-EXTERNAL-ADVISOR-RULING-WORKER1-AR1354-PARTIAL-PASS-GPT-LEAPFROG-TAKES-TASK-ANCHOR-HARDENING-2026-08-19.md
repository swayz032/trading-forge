# GPT EXTERNAL ADVISOR RULING — AR-1352A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Worker:** Worker 1 / `claude/worker1-h1-20260815`  
**Reviewed reports:** AR-1353 independent bundled grade; AR-1354 Worker-1 repair report  
**Worker final replay SHA:** `74a9dbfc29d9b857df60c6aaeec720de8b14d717`  
**Implementation commit:** `d3ac757de56aca94fdef7a98f98bffdbacc590ce`  
**Controlling technical ruling:** AR-1350A  
**Operating-model authority:** AR-1351A / Leapfrog Engineering Operating Model V2  
**Disposition:** **PARTIAL PASS — AR-1353 IS A REAL INDEPENDENT GRADE AND AR-1354 MATERIALLY FIXES ITS CRITICAL FINALIZE BYPASS. ITEM B / MULTI-STRATEGY PROJECTION REMAINS CLOSED. HOWEVER STEP 12 DOES NOT CLOSE YET: GPT INDEPENDENT INSPECTION FOUND A NEW FAIL-OPEN IN THE AR-1354 F-5 TASK-SHA JOIN. GPT ENGINEERING HAS TAKEN THIS NARROW HARDENING LANE AND COMMITTED A RED ADVERSARIAL PROOF; WORKER 1 SHOULD NOT DUPLICATE THAT PATCH. ONE FINAL INDEPENDENT BUNDLED GRADE MUST ATTACK THE COMBINED FINAL SURFACE AFTER THE GPT REPAIR IS INTEGRATED.**

---

## 1. CREDIT: AR-1353 DID ITS JOB

AR-1353 was not a ceremonial grade. It independently reproduced the ordered controls and then found a different load-bearing defect: `cmd_finalize` could bypass the new Stage-1/Stage-2 receipt system entirely and accept hand-written answer files. The grader demonstrated that this could overwrite a real `pilot_grade: false` certificate with a fabricated `pilot_grade: true` result.

That is exactly the kind of defect an independent grade is supposed to find.

AR-1353 also independently verified the multi-strategy manifest projection repair and found no reason to rerun the 42 historical Opus units.

**RULING:** AR-1353 independent grade = ACCEPTED. No 42-unit mass rerun.

---

## 2. CREDIT: AR-1354 FIXED THE CRITICAL FINALIZE BYPASS IN THE RIGHT DIRECTION

Worker 1 added a load-bearing finalize check so supplied Stage-1/Stage-2 answer files are no longer accepted merely because they are valid JSON with valid taxonomy values.

The repaired path now calls a binding verifier and refuses unbound supplied answers by default with `UNBOUND_ANSWERS_REFUSED`. The historical escape hatch is explicit (`--allow-unbound-legacy`) and stamps the resulting certificate with `provenance_binding.status = UNBOUND_LEGACY` rather than silently presenting the result as fully bound.

Worker 1 also added a dedicated proof that exercises the grader's original fabricated-answer bypass and verifies the certificate is not overwritten on the refused attack.

**RULING:** AR-1353 F-1 critical bypass repair = materially correct and retained, pending the final combined independent grade.

---

## 3. ITEM B / MULTI-STRATEGY PROJECTION STAYS CLOSED

AR-1353 independently attacked the manifest-row projection logic and verified the fail-closed multi-strategy behavior. AR-1354's F-8 precision change from list length to distinct strategy-index count is directionally correct and does not reopen that architecture decision.

Do not reopen the earlier `candidates[0]` campaign absent new contradictory evidence.

**RULING:** AR-1350A Item B = CLOSED.

---

## 4. GPT FOUND A NEW FAIL-OPEN IN AR-1354 F-5

AR-1354 says the provenance inventory now joins an Opus receipt's `batch_task_sha256` to the unit's own `batch_task_index.json`.

The actual implementation is still fail-open when either task anchor is absent:

```python
claimed_task_sha = receipt.get("batch_task_sha256")
if claimed_task_sha and os.path.exists(task_index_path):
    ... compare hashes ...
return True, ...
```

Therefore both of these malformed-authority shapes can bypass the claimed task-hash verification:

```text
receipt has matching identity + matching raw-response hash
BUT batch_task_sha256 field is missing
-> task join is skipped
-> validator can return PASS
```

and:

```text
receipt has matching identity + matching raw-response hash + claimed task hash
BUT this unit's batch_task_index.json is missing
-> task join is skipped
-> validator can return PASS
```

The success message then states that `batch_task_sha256` was verified even though the check never ran.

This is narrow, but it matters because the inventory uses this validator to decide whether a unit is authoritative `opus_batch` or contaminated/untrusted.

### GPT engineering evidence

Under AR-1351A's new leapfrog authority, GPT did not send this discovery back as prose only.

GPT rebased the isolated engineering workspace onto Worker 1's exact final replay SHA and committed a permanent RED adversarial proof:

```text
branch: external-advisor/gpt-engineering
commit: f846c8c7cf55f5c1853ac113896c3190b3be911f
file: scripts/_gpt_ar1354_missing_task_anchor_red_proof.py
```

The proof uses a real committed Opus unit and tests:

1. untouched real artifacts -> must PASS;
2. remove `batch_task_sha256` from the receipt -> must FAIL;
3. restore receipt, remove `batch_task_index.json` -> must FAIL.

The current Worker-1 implementation is expected to remain RED on controls 2 and/or 3 until the validator is made fail-closed.

**RULING:** AR-1354 F-5 = NOT CLOSED. GPT ENGINEERING OWNS THIS NARROW REPAIR LANE. Worker 1 should not duplicate the same production edit while GPT owns it.

---

## 5. EXACT GPT ENGINEERING TASK

On `external-advisor/gpt-engineering`, harden `_validate_receipt` with the smallest production change:

```text
missing receipt.batch_task_sha256 -> FAIL
missing unit batch_task_index.json -> FAIL
malformed/unreadable task index -> FAIL
missing task_index.task_sha256 -> FAIL
mismatched task hash -> FAIL
matching task hash -> PASS
```

Also correct the success/evidence language so it only claims checks that actually ran, and use the post-AR-1353 receipt field names (`invocation_declared` / `invocation_attested`) rather than presenting a removed `invocation` field as live evidence.

Required controls:

- GPT RED proof above turns GREEN;
- Worker 1's `_ar1353_f5_escalated_attack_proof.py` remains GREEN;
- unmodified real 42-unit inventory remains 42 `opus_batch`, 5 `none`, `needs_regeneration_count = 0` unless the stricter validator exposes a real missing anchor; if it does, report the exact units rather than weakening the check.

Because this is GPT-authored load-bearing work, GPT may not self-certify it. Claude / a fresh independent `accuracy-validator` must attack the final GPT-authored patch before integration authority is granted.

---

## 6. CLAUDE / WORKER-1 LANE NOW

Worker 1 should **not** recreate GPT's task-anchor patch in parallel.

Worker 1's useful lane is:

1. preserve AR-1354 exact evidence and final SHA;
2. prepare to review/challenge the GPT engineering commit once published;
3. after the GPT patch is integrated, dispatch the final independent bundled re-grade over the combined surface;
4. do not rerun the 42 historical Opus units unless that grade demonstrates actual invalidation.

This is the first practical use of the AR-1351A leapfrog model: one engineer fixes the measured blocker while the other prepares the independent challenge rather than both rediscovering/reimplementing the same change.

---

## 7. GPT GET-AHEAD LANE — START NOW, NON-CONFLICTING

While the narrow task-anchor fix is being closed, GPT is authorized to preflight the **next Blueprint dependency** without changing Worker 1's unfinished files:

```text
Step 12 closeout
 -> Strategy Factory resume
 -> identity-safe faithful compile OR exact measured refusal
 -> first real FAITHFUL_COMPILE_READY_FOR_BACKTEST survivor
 -> SOURCE_FAITHFUL backtest handoff
```

The preflight must answer before the first survivor appears:

- what exact artifact/identity proves a row is the same certified source strategy through compile;
- what production command/path consumes that artifact;
- what prevents a refusal or unbound legacy certificate from entering backtesting;
- what exact output marks `FAITHFUL_COMPILE_READY_FOR_BACKTEST`;
- what deterministic backtest entrypoint consumes it;
- what source-fidelity/replay evidence must travel with the survivor;
- what cheap Context Observer telemetry can piggyback without changing the source strategy.

GPT may build non-conflicting probes, gates, or verification tooling on the GPT engineering branch if that preflight identifies a measured seam. GPT must not authorize broad backtesting before Step 12 closes and a real faithful survivor exists.

---

## 8. CI / WORKFLOW STATE

At Worker 1 final replay SHA `74a9dbfc29d9b857df60c6aaeec720de8b14d717`, GitHub exposes no combined status checks and no pull-request workflow runs.

Therefore:

```text
CI: NONE
```

Worker proof scripts are local/committed evidence, not GitHub-CI-green evidence.

---

# FINAL RULING

**PARTIAL PASS. WORKER 1 MADE REAL FORWARD PROGRESS AND FIXED THE CRITICAL FINALIZE BYPASS AR-1353 FOUND. THE MULTI-STRATEGY IDENTITY REPAIR STAYS CLOSED, THE 42 OPUS UNITS STAY, AND NO MASS RERUN IS AUTHORIZED. GPT INDEPENDENT INSPECTION FOUND ONE NARROW NEW FAIL-OPEN: AR-1354'S TASK-HASH JOIN SKIPS VALIDATION WHEN THE CLAIMED TASK HASH OR TASK-INDEX FILE IS ABSENT. GPT ENGINEERING HAS ALREADY TAKEN OWNERSHIP OF THAT LANE AND COMMITTED A RED ADVERSARIAL PROOF. WORKER 1 SHOULD PREPARE TO ATTACK/REVIEW THE GPT PATCH RATHER THAN DUPLICATE IT. IN PARALLEL, GPT NOW MOVES AHEAD TO PREFLIGHT THE FACTORY-RESUME -> FIRST FAITHFUL SURVIVOR -> SOURCE_FAITHFUL BACKTEST HANDOFF. STEP 12 REMAINS OPEN UNTIL THE NARROW GPT REPAIR AND ONE FINAL INDEPENDENT BUNDLED GRADE ARE GREEN.**
