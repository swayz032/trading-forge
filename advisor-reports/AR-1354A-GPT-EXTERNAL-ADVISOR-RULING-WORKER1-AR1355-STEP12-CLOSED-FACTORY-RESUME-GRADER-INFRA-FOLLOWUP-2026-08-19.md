# GPT EXTERNAL ADVISOR RULING — AR-1354A

**Date:** 2026-08-19  
**Repository:** `swayz032/trading-forge`  
**Reviewed report:** `AR-1355-WORKER1-GPT-ENGINEERING-INDEPENDENT-GRADE-2026-08-19.md`  
**Controlling prior ruling:** AR-1353A  
**Factory steady-state authority:** AR-1340A  
**GPT-authored grade target:** `external-advisor/gpt-engineering` @ `eb1c2959d91039033a5fe1a2cea77d440bbac73f`

## DISPOSITION

**PASS — STEP 12 IS CLOSED. THE STRATEGY FACTORY MAY RESUME IMMEDIATELY UNDER AR-1340A'S SINGLE-PASS, FAIL-CLOSED STEADY-STATE LAW.**

Worker 1 supplied sufficient independent executable evidence against GPT-authored code to satisfy the substantive doer-versus-grader separation required for this closeout. The failure of the isolated `accuracy-validator` execution seat is a separate grader-infrastructure defect; it does **not** convert a passing production repair into a failed repair, and it must not become an artificial Strategy Factory blocker.

The current 42 Opus-regenerated units remain preserved. No mass semantic rerun is authorized. Current real backtest-survivor count remains **0** and must remain 0 until a source strategy genuinely earns `FAITHFUL_COMPILE_READY_FOR_BACKTEST` through the current Factory bar.

---

## 1. WHY AR-1355 IS SUFFICIENT TO CLOSE STEP 12

GPT authored the load-bearing repair. Worker 1 did not author that GPT patch. Worker 1 then pinned the exact GPT handoff SHA in a detached worktree and executed the required controls against those exact bytes.

That preserves the load-bearing independence property:

```text
repair author = GPT
execution / adversarial grader = Worker 1
same actor? = NO
exact target pinned? = YES
```

The originally requested `accuracy-validator` identity could not execute because its isolated synthetic worktree seat was rejected by the repo's guard. That is a measured execution-mechanism failure, not evidence that Worker 1 authored or altered the GPT repair under grade.

For this closeout only, the exact grader-identity requirement is therefore superseded by the stronger substantive evidence actually obtained: a separate actor executed the exact GPT-authored target, reproduced the required controls, and added a discriminating attack not authored by GPT.

This is **not** permission to normalize self-grading or to silently abandon isolated grading in future lanes. The grader-seat defect remains an explicit follow-up in Section 6.

---

## 2. BLOCKING REPAIR — EXECUTABLE EVIDENCE ACCEPTED

AR-1355 executed all three minimum blocking commands against exact GPT SHA `eb1c2959...`:

### A. GPT adversarial task-authority proof

```text
python scripts/_gpt_ar1354_missing_task_anchor_red_proof.py
```

Result: all eight controls passed, including refusal on:

- missing receipt task SHA;
- missing task index;
- malformed task index;
- missing index task SHA;
- task-index unit-identity mismatch;
- missing actual task file;
- mutated actual task file;
- plus the untouched real-artifact positive path.

### B. Prior escalated cross-task regression proof

```text
python scripts/_ar1353_f5_escalated_attack_proof.py
```

Result: the planted bad receipt/raw-response combination remained caught by the task-SHA join; exit 0.

### C. Real Factory inventory regeneration

```text
python scripts/strategy_factory_prep_provenance_inventory.py
```

Result:

```text
total_units              47
opus_batch                42
none                       5
needs_regeneration         0
```

AR-1355 correctly notes that 42/5/0 alone is only a regression baseline. GPT accepts that methodology correction. The fail-closed proof comes from the adversarial controls and the independently constructed live attack below, not from an unchanged happy-path count by itself.

---

## 3. THE NOVEL REAL-CORPUS ATTACK IS THE DECISIVE INDEPENDENT CONTROL

Worker 1 independently attacked committed corpus data rather than merely trusting GPT's own proof harness.

The attack copied another real unit's `batch_task_index.json` and `batch_task.txt` into victim unit `75DJN5UVQnw__s0`.

The production inventory changed from:

```text
42 opus_batch / 5 none / 0 needs-regeneration
```

to:

```text
41 opus_batch / 1 gemma / 5 none / 1 needs-regeneration
```

with explicit refusal because the task-index identity named the donor video instead of the victim video.

Worker 1 then restored the source artifacts in a `finally` path and independently reverified the clean 42/5/0 baseline.

That attack has real discriminating power. It demonstrates that the repaired validator does not merely preserve the happy path; it detects a cross-unit authority substitution and fails the contaminated unit closed.

GPT independently re-read the exact production target and confirms the implementation performs the required chain:

```text
receipt identity
-> raw-response SHA
-> required receipt task SHA
-> required task-index file
-> task-index unit identity
-> required index task SHA
-> receipt/index task-SHA equality
-> required actual batch_task.txt
-> actual task-file SHA equality
-> only then trust opus_batch authority
```

The repair therefore satisfies the narrow Step-12 authority-binding obligation.

---

## 4. WHAT STAYS FROZEN / WHAT DOES NOT REOPEN

The following are **not reopened** by AR-1355:

- AR-1234's retirement of Gemma from load-bearing locator authority;
- the 42-unit Opus locator regeneration;
- the historical sVkm/G2-D repair campaign;
- already-closed compiler certification work;
- multi-strategy identity fail-closed law;
- the current refusal dispositions merely because yield is low.

No 42-unit semantic rerun is authorized.

If a future targeted check proves a specific artifact is corrupt or authority-invalid, remediate that measured unit. Do not convert a local defect into a factory-wide replay without evidence.

---

## 5. STRATEGY FACTORY RESUME — EXACT LAW

Resume immediately under AR-1340A.

For each frozen source strategy:

1. freeze transcript/source and modern extraction identity;
2. run the current authorized preparation/source-grounding path;
3. run the current blind Stage-1 adjudication once;
4. run the current revealed Stage-2 support adjudication once;
5. run current lints/integrity/conflation/enumeration obligations once where required;
6. finalize with the current certificate machinery;
7. compile only a genuinely clean certificate;
8. otherwise emit the exact measured refusal and continue to the next source unit.

A semantic failure is a result, not a retry trigger. Retry only a measured transport/infrastructure failure that produced no valid adjudication result, on the same frozen inputs with a retry receipt.

Low certification yield does not fail the conveyor. False certification, hidden condition loss, semantic invention, nondeterminism, or identity loss does.

**Do not stop the entire Factory every time one strategy honestly refuses.** Continue through the population.

---

## 6. TWO NARROW FOLLOW-UPS — NONBLOCKING TO FACTORY RESUME

### A. Evidence-preservation hardening in the old AR-1353 attack harness

Worker 1 correctly identified a real pre-existing test-harness risk in:

```text
scripts/_ar1353_f5_escalated_attack_proof.py
```

It mutates a real committed `batch_raw_response.txt` and restores it only after the validation call, without `try/finally`. An unexpected exception could strand mutated evidence.

Required narrow repair:

- preferably run the planted mutation entirely in a temporary copied fixture; or
- at minimum wrap mutation/validation/restoration in `try/finally` and verify original bytes/hashes after restoration.

This is an evidence-preservation/test-harness defect, **not** a demonstrated production certification defect and **not** a reason to reopen Step 12.

### B. Isolated grader-seat / guard compatibility

AR-1355 measured that `accuracy-validator` with `isolation:"worktree"` cannot execute because the synthetic isolated branch/session does not satisfy the current armed-seat/resume-anchor guard.

Required repair direction:

- preserve fail-closed guard semantics;
- do **not** globally trust all `worktree-agent-*` branches;
- create an explicit, durable parent-session/anchor binding for an authorized isolated grader seat, or an equally strong isolated execution mechanism;
- add a negative control proving an unrelated synthetic worktree cannot borrow another session's authorization;
- add a positive control proving an explicitly bound isolated grader can execute read/test commands against its pinned target.

Until that mechanism is repaired, future reports must disclose when a nominally independent isolated grader could not execute. Do not silently substitute a weaker grader identity and call it equivalent.

Neither A nor B blocks Strategy Factory processing.

---

## 7. GET-AHEAD FACTORY -> FAITHFUL BACKTEST BRIDGE

AR-1355 also executed GPT's separate get-ahead controls:

```text
python scripts/_gpt_factory_faithful_handoff_adversarial_proof.py
```

Result: 8/8 admission controls passed.

It also ran the real current negative path:

```text
python scripts/strategy_factory_faithful_compile_handoff.py \
  --video-id 75DJN5UVQnw \
  --strategy-index 0 \
  --out-dir tmp/factory-faithful-handoff-negative
```

Result:

```text
REFUSED
reason = FACTORY_DISPOSITION_NOT_COMPILE_READY
```

That is the correct current answer. There is still no real clean Factory survivor.

The bridge is accepted as the current next-stage candidate path because its admission controls and known-current refusal behaved correctly. It does **not** authorize inventing a survivor or bypassing the Factory.

When the first real source unit earns `FAITHFUL_COMPILE_READY_FOR_BACKTEST`, run that unit through the Factory-specific handoff/verification path and return the exact:

- source identity;
- certificate SHA/state;
- extraction/transcript hashes;
- spec file SHA / spec hash / graph hash;
- Factory handoff receipt;
- zero/substitution/approximation status required by current authority;
- onboarding/preflight result.

Only then proceed to the existing source-faithful backtest path.

---

## 8. CURRENT MONEY-PATH STATUS

```text
Step 12 authority cleanup:          CLOSED
42 Opus-regenerated units:          KEEP
Factory mass rerun:                 NO
Strategy Factory steady-state:      RESUME NOW
Real compile-ready survivors:       0
Broad backtesting:                  NOT YET
PAPER/live:                         NOT AUTHORIZED
```

The correct next milestone is not another governance loop around already-fixed locator provenance. It is to run the Strategy Factory forward until real source strategies either earn a faithful compile or receive honest refusal dispositions.

---

## 9. EXACT NEXT WORKER-1 ORDER

### Primary lane — start now

Resume the Strategy Factory conveyor from the current frozen/authoritative inputs under AR-1340A. Process source units continuously under the single-pass current-certifier law. Do not pause for an advisor ruling on each honest refusal.

### Stop/report condition for the money path

Report when one of these occurs:

1. a real strategy first reaches `FAITHFUL_COMPILE_READY_FOR_BACKTEST`; or
2. a new systemic defect appears that could invalidate multiple Factory units or produce false certification/identity substitution/nondeterminism; or
3. the current frozen Factory population completes and the final disposition counts are available.

If condition 1 occurs, immediately run the faithful handoff/preflight path for that exact survivor before any broad backtest.

### Parallel maintenance lane — narrow and nonblocking

Repair the AR-1353 mutation harness and the isolated-grader seat mechanism with focused adversarial controls. Do not hold the Strategy Factory waiting on those maintenance items.

---

# FINAL RULING

**AR-1355 PASSES THE SUBSTANTIVE INDEPENDENT EXECUTION BAR FOR GPT'S STEP-12 REPAIR. GPT AUTHORED THE FIX; WORKER 1 PINNED THE EXACT GPT SHA, EXECUTED ALL REQUIRED CONTROLS, AND ADDED A REAL-CORPUS CROSS-UNIT SUBSTITUTION ATTACK THAT THE REPAIR CORRECTLY FAILED CLOSED. THE ISOLATED `accuracy-validator` SEAT FAILURE IS A SEPARATE GUARD-INFRASTRUCTURE DEFECT AND WILL BE REPAIRED AS A NONBLOCKING HARDENING ITEM. STEP 12 IS CLOSED. KEEP THE 42 OPUS UNITS. DO NOT MASS-RERUN THEM. RESUME THE STRATEGY FACTORY NOW UNDER AR-1340A. CURRENT REAL BACKTEST SURVIVOR COUNT REMAINS ZERO; THE FIRST BACKTEST MUST WAIT UNTIL A REAL SOURCE STRATEGY EARNS A CLEAN FACTORY CERTIFICATE AND PASSES THE FAITHFUL HANDOFF/PREFLIGHT PATH. NO PAPER/LIVE AUTHORIZATION IS GRANTED BY THIS RULING.**