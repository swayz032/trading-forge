# EXTERNAL READ — 2026-08-04 — AR-785 / LANE 29

> **PROVENANCE:** Arrived as **OPERATOR-RELAYED CHAT**, not on
> `origin/external-advisor/gpt-rulings` (that branch's newest commit remains
> `953a907c`, 2026-08-02, per `R-698`). Committed here VERBATIM under `R-700 §1`:
> `AN ADOPTION BY REFERENCE TO A SOURCE NOT IN THE REPOSITORY IS AN ADOPTION OF
> NOTHING.` Consumed by `R-707`. **A CHANNEL IS NOT AN AUTHOR** — adopted on
> merit where `R-707` says so, and REFUSED where `R-707` says so.

---

GPT EXTERNAL ADVISOR RULING — ACCEPT AR-785; LANE 29 CLOSED, SHORT-FRAME BYPASS REMOVED, PROCEED TO LANE 30

AR-785 is accepted.

Lane 29 closes successfully.

The stop condition did not fire:

- no existing failure was introduced by the shipped Lane-29 change;
- `ONLY_IN_A = 0`;
- all eight failures present only when Lane 29 is absent belong to the new Lane-29 verification surface;
- inherited failure membership is identical by full node ID between the two measured arms.

FAN-IN is now:

`2/3`

SHORT-FRAME DEFECT CLOSED

The root cause is accepted:

- both the flag-OFF refusal and the enforced-dispatch consume-or-refuse guard previously sat below the `n < MIN_BARS_REQUIRED` return;
- `_h_wait_bias`'s insufficient-frame refusal was also unreachable below that return;
- short frames could therefore discard supplied parameters in either flag state.

The repair correctly moves parameter acknowledgement to the first operation in `compute()`.

Approved invariant:

> Every supplied parameter must be acknowledged before any early return, evaluator, cache construction, state reset, or dispatch decision can occur.

The moved guard now precedes:

- the short-frame return;
- `candle_confirmation_check`;
- context construction;
- cache construction;
- enforced dispatch;
- legacy dispatch;
- per-condition publication.

The additional behavior change is approved:

> A parameter-related refusal now occurs before mutation of diagnostic state on `self`.

A refusal that resets state before raising is a partial execution and is not the desired boundary.

SIX-ROW MATRIX ACCEPTED

The following behavior is now approved and permanently witnessed:

1. `n=20`, flag OFF, parameterized binding
   → `parameterized_binding_requires_enforced_dispatch`

2. `n=29`, flag OFF, parameterized binding
   → `parameterized_binding_requires_enforced_dispatch`

3. `n=20`, flag ON, unsupported parameterized route
   → `parameter_supplied_to_non_consuming_route`

4. `n=29`, flag ON, unsupported parameterized route
   → `parameter_supplied_to_non_consuming_route`

5. Short frame, parameterless binding, either flag state
   → legacy all-False behavior preserved

6. Short frame, valid parameterized `WAIT_BIAS`
   → insufficient-frame refusal, never silent all-False output

The `n=29` versus `n=30` boundary test is approved as the discriminator preventing an always-refuse implementation.

The sentinel witness is also accepted because it is bidirectional:

- refusal rows prove the early branch did not execute;
- the parameterless control proves the early branch actually does clear the sentinel.

SELF-MINTED REFUSAL CODE RATIFIED

The refusal code:

`taught_parameters_require_a_sufficient_frame`

is ratified.

It must continue to identify:

- condition identifier;
- supplied parameter keys;
- available frame length;
- required minimum or calculated floor.

Use it only when:

- valid taught parameters are present;
- the semantic calculation cannot be performed with the available history.

Do not use it for:

- malformed values;
- unknown keys;
- unsupported routes;
- flag-OFF dispatch.

Those remain separate refusal families.

F-3 REACHABILITY FINDING ACCEPTED

The worker's generalization is correct:

> A valid refusal implemented below an early return is not a refusal on the early-return path.

Lane 29 did not invent a new F-3 behavior. It made the previously approved taught-parameter insufficiency behavior reachable on short inputs.

ORDERING PROOF ACCEPTED

The full-frame delegating counters are the correct timing witness.

Testing evaluator counts only on a short frame would be vacuous because the early return suppresses evaluation even when the guard is missing.

The measured combination is accepted:

- zero confirmation/evaluator invocation under refusal;
- greater-than-zero invocation on a parameterless control;
- structural ordering of the acknowledgement before every downstream operation.

RED-PROOF PREDICTION MISS

The pre-registered seven-RED prediction matched the reachability plant exactly.

True removal of Lane 29 produced eight RED tests because the ordering test detects a stronger property than the reachability-only plant.

This is recorded as:

`PREDICTION MISS — PLANT WEAKER THAN FULL ABSENCE`

It does not invalidate the repair.

The distinction is valuable:

- the seven-row RED set proves short-path reachability;
- the eighth test proves physical position before full-frame evaluation.

Both are required and neither substitutes for the other.

REGRESSION POPULATION WARNING

The 172-versus-171 inherited-failure discrepancy remains unresolved.

Approved current interpretation:

- Lane 29 did not create the additional inherited failure because `ONLY_IN_A = 0`;
- at least six tests in the measured population are order-dependent;
- the addition of a new test module may have changed collection order, but that remains a hypothesis.

Do not:

- join the 171 and 172 populations by count;
- claim a new inherited regression;
- claim the discrepancy is explained.

Lane 30 must reconcile the specific 80-versus-81 scoped population required by R-702. It does not need to expand into a broad investigation of the 171-versus-172 whole-suite variation unless the same member explains both.

WHOLE-SUITE RESULT ACCEPTED WITH EXCLUSION

The measured suite population remains:

`src/engine/tests/` excluding `test_cloud_backend.py`

The exclusion must remain explicit because `test_cloud_backend.py` is:

`HUNG / UNENUMERATED`

not passing and not covered.

LANE 29 FINAL STATUS

`CLOSED`

No further Lane-29 repair is required.

LANE 30 AUTHORIZATION CONFIRMED

Proceed with Lane 30.

Lane 30 must close all remaining verification holes.

1. M5 — EFFECTIVE ORDERING WITNESS

Replace the ineffective `last_per_condition_bool` timing claim with a direct execution witness such as `_last_bias_periods`.

Required planted defect:

- move or defer the refusal until after one real condition has evaluated.

The permanent test must fail because the direct witness changed from its untouched sentinel state.

The test must also include a positive control proving the witness changes when evaluation legitimately occurs.

2. M3 — MIRROR PARTIAL RECOGNITION

Add the opposite hybrid case:

- canonical `slow_period` supplied;
- fast period supplied under an unrecognized key;
- planted defect defaults fast while honoring slow.

Both directions must permanently refuse:

- taught fast + default slow;
- default fast + taught slow.

The refusal must name only the unsupported or unrecognized key responsible for the hybrid.

3. F-E — REPOSITORY-ANCHORED CENSUS GUARD

The census must derive its root from the repository or test-file location.

It must not depend on the process current working directory.

Required non-vacuity controls:

- scanned Python-file count greater than zero;
- target production module discovered;
- at least one known constructor detected;
- running from a different current working directory yields the same census;
- forcing the scan root to an empty surface turns the test RED.

The constructor matcher must cover the six named forms:

- keyword `parameters=`;
- positional constructor argument;
- aliased `ConditionBinding`;
- module-qualified constructor;
- `dataclasses.replace`;
- imported or aliased `replace`.

Each form requires a controlled positive fixture.

A planted production constructor using any supported form must fail the guard.

4. F-F — COMMENT AND EXECUTION ORDER

Lane 29 appears to have satisfied the preferred F-F repair by moving acknowledgement above `candle_confirmation_check`.

Lane 30 must pin this permanently.

Required test:

- parameterized refusal occurs;
- confirmation evaluator invocation count remains zero;
- the same instrument records a positive count on a parameterless control.

After that proof, retain only comments that precisely match the measured order.

5. REGRESSION POPULATION RECONCILIATION

Reconstruct the 80-file and 81-file populations from their original derivation rules.

Report:

- exact member only in the 81-file set;
- exact member only in the 80-file set, if any;
- which derivation included or excluded it;
- whether the difference was correct;
- one canonical derived population for the final re-grade.

The comparison must use normalized repository-relative paths and a break-control.

Do not reconcile by deleting a member merely to make counts equal.

LANE-30 STOP CONDITIONS

Stop and report if:

- the repository-anchored census finds an actual production parameter writer;
- any newly supported constructor form reveals a production-populated `ConditionBinding.parameters`;
- the ordering repair changes legitimate parameterless behavior;
- the M3 mirror case is already accepted by an intended canonical alias layer;
- the canonical regression population cannot be derived deterministically.

RE-GRADE AFTER LANE 30

Once Lane 30 is green, return to the desk for the independent re-grade.

Do not begin Gate 3 before that grade.

The grade must retest:

- F-A consume-or-refuse across all enforced handlers;
- F-B short-frame acknowledgement;
- F-2 complete substitution;
- F-2D both hybrid directions;
- F-3 insufficient-frame refusal;
- flag-OFF refusal;
- pre-evaluation ordering;
- census portability;
- all six constructor forms;
- all ten original mutations.

Gate 2 closes only if the result is:

`PASS`

or:

`PASS_WITH_BOUNDED_FINDINGS`

with no finding involving:

- silent substitution;
- partial recognition;
- unused accepted parameters;
- flag-OFF parameter loss.

CURRENT POSITION

Gate 1 — COMPLETE
Gate 2 — LANES 28 AND 29 COMPLETE; LANE 30 ACTIVE
Gate 3 — BLOCKED
Gate 4 — NOT STARTED
Gate 5 — NOT STARTED

AR-785 closes the early-return hole. A short market-data frame can no longer make supplied trading parameters disappear before the system decides whether it can consume them.
