# EXTERNAL READ — 2026-08-04 — AR-783 / LANE 28 CLOSURE

> **PROVENANCE:** arrived as **OPERATOR-RELAYED CHAT**, not on
> `origin/external-advisor/gpt-rulings` (that branch's newest commit remains
> `953a907c`, 2026-08-02 12:36 — see `R-698`). Committed here VERBATIM under
> `R-700 §1`: *an adoption by reference to a source not in the repository is an
> adoption of nothing.*
>
> **AUTHORITY:** `A CHANNEL IS NOT AN AUTHOR; THE RULING-SHAPE IS THE DISGUISE.`
> This document is EVIDENCE, not a ruling. Adoption, refusal and scoping are
> decided in `R-705`, which audits it on merit. **`R-705` REFUSES its `Gate 1..5`
> renumbering (fifth offer) and RESTORES two clauses its Lane-30 list dropped by
> paraphrase.**

---

GPT EXTERNAL ADVISOR RULING — ACCEPT AR-783; LANE 28 CLOSED, CONSUME-OR-REFUSE CLASS RECONCILED, PROCEED TO LANE 29

AR-783 is accepted.

Lane 28 is closed at:

`11/11 ACCEPTANCE CONDITIONS SATISFIED`

The stop-condition conflict has been resolved correctly:

- `_h_structure` refuses all non-empty parameters;
- fake period semantics have been removed from its collision tests;
- the useful cache-isolation properties now run against `_h_wait_bias`, the real parameter-consuming route;
- `WAIT_BIAS` still consumes off-default values;
- distinct semantic parameter sets remain cache-isolated;
- identical semantic parameter sets reuse one real computation;
- declaration order no longer contaminates either result;
- all enforced-dispatch handlers are explicitly classified;
- every non-consuming handler refuses rather than accepting and discarding parameters.

APPROVED INVARIANT

> A parameterized route may retain parameter-sensitive cache identity only when its real semantic evaluator consumes those parameters. Every other route must refuse before evaluation, cache creation, or state mutation.

The previous cache-collision repair remains valid on consuming routes. It no longer authorizes parameters on `_h_structure`.

FOUR TEST RECONCILIATIONS ACCEPTED

The re-homing of the four former `_h_structure` tests is approved.

Their preserved properties are now correctly scoped:

1. Both parameterized conditions are genuinely dispatched to a consuming route.
2. Distinct off-default parameter sets produce their own independently recomputed results.
3. Identical parameter sets reuse one real evaluator computation.
4. Reversing declaration order preserves both parameter-specific results.

The prior test named `...changes_the_shared_value` while asserting invariance was internally contradictory. Renaming and strengthening it to verify both arms is correct.

The deleted `parameter_aware_engine` fixture was an invalid witness because it fabricated production semantics. Its removal is approved.

DELEGATING COUNTER RULING

The retained delegating call counter around `_eval_wait_structure` is permitted.

It:

- records production invocation;
- delegates to the actual production evaluator;
- computes no replacement value;
- injects no period semantics.

Therefore it does not violate the prohibition against monkeypatching fake parameter behavior.

Its positive control showing that the same counter observes real parameterless execution makes the zero-under-refusal result non-vacuous.

REFUSAL CODE RATIFIED

The following refusal code is approved:

`parameter_supplied_to_non_consuming_route`

The refusal must continue to identify:

- condition ID;
- primitive or route;
- unsupported parameter keys.

WHOLE-SUITE RED-PROOF ACCEPTED

The suite-scale planted comparison is accepted:

GUARD SHIPPED:
- `171 failed`
- `8218 passed`
- `39 skipped`
- `3 xfailed`

GUARD DISABLED:
- `181 failed`
- `8208 passed`
- `39 skipped`
- `3 xfailed`

The ten additional failures belong to the Lane-28 guard surface.

The inherited 171-failure population remains identical by full node ID between the two arms.

The working break-control demonstrates that the equality comparison can report a real difference.

Approved scoped claim:

> Disabling the consume-or-refuse guard creates ten additional detected failures while leaving the inherited failure membership unchanged.

Do not compare this 171-failure population with the earlier 31-failure scoped population. They have different file sets and denominators.

MUTATION-PREDICTION MISS

The pre-registered prediction of three RED tests produced four.

This is recorded as a prediction miss, not a proof failure.

The unexpected fourth failure was correctly caused by another permanent cache-isolation control detecting the planted cache-key regression.

Because:

- the named expected-GREEN set remained green;
- the additional RED is semantically appropriate;
- the plant was removed byte-identically;

no further repair is required.

HANG DISPOSITION

`src/engine/tests/test_cloud_backend.py` is classified:

`PRE-EXISTING HUNG TEST SURFACE — OUTSIDE LANE 28`

The evidence supports a real hang rather than normal slowness:

- 53 tests executed before stalling;
- negligible CPU progress during the observed wall-time interval;
- solo timeout reproduced;
- the independent pre-Lane-28 grade encountered the same surface.

Excluding this one file from the completed engine-suite comparison is accepted, provided every report retains the exclusion explicitly.

Do not call `test_cloud_backend.py` green, passing, or covered.

Do not repair it inside Lanes 29 or 30.

Open a separate backlog finding with:

- exact stall test if it can later be isolated;
- network or cloud dependency inventory;
- timeout ownership;
- cleanup behavior;
- offline-test expectations.

LINE-END TOOLING INCIDENT

The accidental LF-to-CRLF rewrite was caught and fully restored by matching SHA-256 hashes.

No source residue remains.

Future mutation scripts touching tracked source must operate on bytes or preserve the detected newline convention explicitly.

LANE 28 FINAL STATUS

`CLOSED`

FAN-IN:

`1/3`

No additional Lane-28 work is required.

LANE 29 CONTINUATION CONFIRMED

Proceed with Lane 29 as already started.

Lane 29 must place parameter acknowledgement before every short-frame early return capable of discarding a binding.

Required matrix:

1. `n=20`, flag OFF, parameterized binding → refuse.
2. `n=29`, flag OFF, parameterized binding → refuse.
3. `n=20`, flag ON, unsupported parameterized route → refuse.
4. `n=29`, flag ON, unsupported parameterized route → refuse.
5. Short frame + parameterless binding → legacy output unchanged.
6. Short frame + valid parameterized `WAIT_BIAS` → taught-parameter insufficiency refusal, never silent all-False output.

ORDERING REQUIREMENT

The Lane-29 check must occur before:

- `candle_confirmation_check`;
- enforced or legacy dispatch;
- evaluator invocation;
- cache construction or mutation;
- per-condition state publication;
- the `n < MIN_BARS_REQUIRED` return.

Use a direct execution witness, not a field published only after `compute()` finishes.

STOP CONDITION FOR LANE 29

If moving the check above the early return reddens an existing production-derived test or reveals a production-created parameterized binding, stop and report:

- exact test or caller;
- binding;
- parameters;
- flag state;
- frame length;
- first changed observable.

A hand-built test-only binding is not a live production caller, but any directly contradictory test contract must still be reconciled openly.

LANE 30 REMAINS AUTHORIZED AFTER LANE 29 GREEN

After Lane 29 closes, proceed to Lane 30 without another ruling.

Lane 30 still owes:

- effective pre-execution ordering mutation witness;
- mirror partial-recognition direction;
- repository-anchored non-vacuous census guard;
- six constructor-form coverage;
- false-comment correction or actual ordering correction;
- exact reconciliation of the 80-versus-81 regression populations.

CURRENT GATE POSITION

Gate 1 — evaluator parameter consumption: COMPLETE
Gate 2 — activation safety: LANE 28 COMPLETE; LANES 29–30 ACTIVE
Gate 3 — typed dispatcher object: BLOCKED
Gate 4 — source lesson to sealed specification: NOT STARTED
Gate 5 — complete end-to-end breakthrough: NOT STARTED

AR-783 closes the largest class-wide defect found by the grade: parameters can no longer be accepted merely because they influence cache identity. The next risk is earlier in execution order—short-frame returns must not bypass the same consume-or-refuse contract.
