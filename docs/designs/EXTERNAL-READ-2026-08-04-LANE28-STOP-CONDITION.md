# EXTERNAL READ — 2026-08-04 — Lane 28 stop condition (`AR-782`)

> **PROVENANCE, STATED PLAINLY:** relayed by the operator as CHAT, not fetched from
> `origin/external-advisor/gpt-rulings` (that branch's newest commit is `953a907c`,
> 2026-08-02 12:36 — two days stale; see `R-698`). Committed here verbatim by the
> advisor seat under `R-700 §1`: **AN ADOPTION BY REFERENCE TO A SOURCE NOT IN THE
> REPOSITORY IS AN ADOPTION OF NOTHING.**
>
> **THIS FILE IS THE SOURCE, NOT THE AUTHORITY.** `A CHANNEL IS NOT AN AUTHOR.`
> Adjudicated on merit at `R-704`, which ADOPTS most of it, ADDS three obligations
> it omitted, and DECLINES its gate renumbering for the fourth time.
>
> **VERIFIED BEFORE ADOPTION:** the commit it names, `29ba8bb5`, is REAL and is HEAD
> of `h1-wave4-sealed12-driver` `[MEASURED HERE, git cat-file -t]` — recorded because
> this channel fabricated SHA tails on 2026-07-31.

---

GPT EXTERNAL ADVISOR RULING — APPLY CONSUME-OR-REFUSE TO `_h_structure`; RE-AIM THE COLLISION TESTS TO THE REAL CONSUMING ROUTE

The stop condition fired correctly.

Decision:

> YES — the consume-or-refuse invariant applies to `_h_structure`.

`_h_structure` receives `ConditionBinding.parameters`, uses them in cache identity, and sends no parameter into `_eval_wait_structure`.

That is not parameter consumption.

No exemption is authorized.

Do not add invented period semantics to `_eval_wait_structure`, and do not preserve a test-only monkeypatch that makes production appear capable of something it cannot do.

DISPOSITION OF COMMIT `29ba8bb5`

The Lane-28 production direction is approved.

The commit is not yet accepted as a completed green lane because four existing tests remain red.

Status:

`LANE 28 — APPROVED REPAIR, TEST-CONTRACT RECONCILIATION REQUIRED`

The four failures do not reveal a live production caller. They reveal a stale test contract that institutionalizes the now-prohibited accept-and-discard behavior.

THE CONFLICT IS RESOLVED AS FOLLOWS

The earlier cache-collision repair remains conceptually valid:

> Different semantic parameter sets must not share one cached result.

But that property belongs only to a route that genuinely consumes those parameters.

It does not authorize a non-consuming handler to accept parameters merely so its cache can distinguish them.

Therefore:

- `_h_structure` must refuse all non-empty parameters.
- `_h_wait_bias` remains the supported parameter-consuming route.
- Cache-separation and reuse proofs must live on `_h_wait_bias` or another future route that actually consumes the parameter object.
- `test_parameter_collision.py` must no longer monkeypatch fake period semantics into `_eval_wait_structure`.

TEST RECONCILIATION AUTHORIZED

Reconcile the four failing tests with an explicit old-property-to-new-property table before editing them.

Required dispositions:

1. `test_both_conditions_are_actually_dispatched`

Re-home its useful dispatch witness to `WAIT_BIAS`, or remove it as a duplicate only if an existing permanent test already proves both parameterized conditions reach the real consuming handler.

2. `test_two_same_family_conditions_with_different_periods_must_evaluate_differently`

Re-home to two canonical `WAIT_BIAS` parameter objects using off-default values.

The result must differ because the evaluator consumed different periods, not merely because the cache key changed.

3. `test_identical_periods_still_share_one_computation`

Re-home to `WAIT_BIAS`.

Identical semantic parameter objects must reuse one real calculation.

4. `test_reversing_condition_order_changes_the_shared_value`

Do not preserve an assertion that production order dependence is acceptable.

Translate the underlying mutation purpose into:

> Reversing condition order must not change either condition's parameter-specific result.

If the existing test is intentionally a planted-defect control rather than a production assertion, keep it clearly labeled as a mutation control and aim it at the real consuming route.

Do not simply change `WAIT_STRUCTURE` to `WAIT_BIAS` without verifying that each test still witnesses its stated property.

MANDATORY NEGATIVE TEST FOR `_h_structure`

Retain or add a permanent production-path test proving:

- flag ON;
- `WAIT_STRUCTURE`;
- any non-empty parameter set;
- refusal before evaluation and cache mutation.

Approved refusal code:

`parameter_supplied_to_non_consuming_route`

This code is ratified.

The refusal must name:

- condition identifier;
- primitive;
- unsupported parameter keys where available.

LANE-28 ACCEPTANCE CONDITIONS

Lane 28 closes only when:

- all 14 enforced handlers remain classified;
- every handler is covered by consume-or-refuse behavior;
- `_h_structure` refuses parameterized bindings;
- all seven environment-gated handlers fail closed while their consumption capability remains unverified;
- `_h_session` refuses parameters;
- `WAIT_BIAS` still consumes distinct off-default values;
- different `WAIT_BIAS` parameters remain cache-isolated;
- identical `WAIT_BIAS` parameters still reuse computation;
- declaration order cannot contaminate results;
- the old accept-and-discard plant fails a permanent test;
- the affected suite returns green apart from the unchanged inherited population.

Do not classify the four old failures as inherited after this ruling. They must be reconciled because they directly contradict the approved invariant.

BROAD SWEEP

Allow the already-running broad sweep to finish or reach a declared timeout.

Report it separately as:

- completed with result;
- timed out;
- hung;
- or unverifiable.

Do not wait for it before repairing the four directly identified tests.

CONTINUE SERIAL LANES AFTER GREEN

Once Lane 28 is green and committed with named paths, proceed without another authorization to:

- Lane 29 — move parameter acknowledgement above the short-frame return;
- Lane 30 — repair ordering, mirror-partial-recognition, census portability, comment accuracy, and the 80-versus-81 regression-population discrepancy.

Do not begin Lane 29 while Lane 28 still carries the four contradictory failures.

FINAL SCOPE

This ruling does not claim:

- `WAIT_STRUCTURE` supports periods;
- the source producer supplies parameters;
- sealed specifications preserve parameters;
- the activation flag may be enabled;
- Gate 2 is closed.

Current state:

Gate 1 — complete
Gate 2 — Lane 28 repair active
Gate 3 — blocked
Gate 4 — not started
Gate 5 — not started

The correct resolution is not to exempt `_h_structure`. It is to preserve cache-collision protection on the route that truly consumes parameters and make every non-consuming route refuse them honestly.
