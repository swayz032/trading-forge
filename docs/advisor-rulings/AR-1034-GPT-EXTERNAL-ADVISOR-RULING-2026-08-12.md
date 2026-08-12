# GPT EXTERNAL ADVISOR RULING — AR-1034 / MP2-COMPILED-SPEC-INGRESS-1 CLOSED / NEXT: OR-STATE-HANDOFF-1

## 1. VERDICT

**AR-1034 ACCEPTED.**

**`MP2-COMPILED-SPEC-INGRESS-1 = CLOSED` at remote engineering pin `db277b3b51f79ba53f62595e99cbce9dcf84b465`.**

The worker proved the missing compiler-artifact transport hop and repaired it without changing compiler or trading semantics. Persisted `compiled_spec` now travels from the strategy DB row through `/api/backtests` into the existing Node→Python config transport, and the existing Python Band-C `from_compiled_spec(...)` dispatch is reachable through the real route.

No live-Postgres campaign, full market-data backtest, independent grader, ACCEPT-5 rerun, or Phase-5 referee work is owed for MP2.

The next active unit is **`OR-STATE-HANDOFF-1`**.

## 2. EXTERNAL VERIFICATION OF MP2

I independently resolved the pushed repair commit `27ef227a5409927e593edbfcea46988ebc3fce77` on origin.

Comparing MP1-close pin `d2f222531ef973e9e9d651cbfdad948cbbb1772b` to final MP2 pin `db277b3b51f79ba53f62595e99cbce9dcf84b465` shows the expected bounded shape:

- `src/server/routes/backtests.ts` — **+14 production lines**;
- the existing MP1 route ingress test file extended with MP2 controls;
- the existing MP1 Python ingress test file extended with MP2 dispatch controls;
- generated `SYSTEM-INVENTORY.md` only.

No compiler implementation, Opening Range arithmetic, entry logic, stop/target logic, risk math, P&L math, or backtester execution semantics were changed.

The production repair moves the persisted `compiled_spec` object from `stratConfig` into `fullConfig` after request-derived `...config`, so request input cannot replace the DB-owned compiler artifact. Legacy rows without persisted `compiled_spec` receive no fabricated artifact.

The worker's dispatch witness is also architecturally correct: Python already had `config.get("compiled_spec") -> from_compiled_spec(...)`; MP2 makes that existing branch reachable rather than adding a new compiler path.

Therefore MP2 is closed.

## 3. THE NEXT GAP IS NOW ONE OBJECT HANDOFF

Independent inspection of the final pin shows the next missing hop precisely.

### 3.1 Candidate proof already exists

At the earliest trustworthy Python boundary, `validate_candidate_authority(config)` reconstructs a `CandidatePersistenceRow` and calls the existing authoritative resolver:

`resolve_row_for_execution(row)`.

That resolver returns the exact proven `OpeningRangeExecutionCandidate` reconstructed from the persisted receipt and outer row anchors.

### 3.2 The current adapter discards that proven object

The current implementation calls:

`resolve_row_for_execution(row)`

but does not save the returned object. On success `validate_candidate_authority()` returns only `None`.

So MP1 proves the candidate and then immediately loses the very object it proved.

### 3.3 The downstream consumer is already built

`spec_condition_compiler.from_compiled_spec(...)` already accepts:

`opening_range_candidate: OpeningRangeExecutionCandidate | None`.

It passes that object unchanged into `SpecConditionStrategy`, whose constructor stores it as `self.opening_range_candidate`.

The real `_h_opening_range` handler already:

- hard-refuses if no candidate exists;
- reads `candidate.definition`;
- reads `candidate.variant`;
- derives the instance bar interval from the strategy timeframe;
- calls the existing certified `opening_range_adapter.compute_opening_range_state(...)` once per `(candidate, session_date)`;
- gates bars before/after the candidate's taught lock time;
- returns all-false when the adapter refuses.

Therefore **do not build a new Opening Range engine, adapter, calculator, state type, parameter channel, or candidate selector.** They already exist.

The missing seam is simply:

`resolved candidate from MP1 validator -> from_compiled_spec(opening_range_candidate=that exact object) -> existing SpecConditionStrategy -> existing _h_opening_range -> existing adapter/state`.

## 4. OR-STATE-HANDOFF-1 — EXACT OBJECTIVE

Make the **exact candidate object already proven by `resolve_row_for_execution(row)` survive the validation boundary and become the `opening_range_candidate` supplied to the existing `from_compiled_spec(...)` call.**

No second rehydration. No reconstruction from duration. No `candidates[0]`. No default 15m. No inference from route timeframe. No reading source prose again.

The object that was proven is the object that executes.

A legacy row with no candidate sidecar must continue to carry `None` and must not acquire a candidate.

A candidate refusal must continue to stop before Band C dispatch.

## 5. REQUIRED PRE-MUTATION TRACE — CONDITION OWNERSHIP

Before changing production code, measure one load-bearing relation on the frozen/golden Opening Range artifact:

**Does `resolved_candidate.source_condition_id` exactly equal the `ConditionBinding.condition_id` consumed by `_h_opening_range` for that candidate's Opening Range definition?**

Also inspect whether `resolved_candidate.definition.provenance.condition_id` agrees with the same binding id.

Expected truthful shape is one candidate bound to the exact source condition it was minted for.

If those ids agree on the frozen artifact, pin that relationship with a fail-closed control so one candidate cannot be silently applied to a different Opening Range condition in the same parent spec.

If they do **not** agree, **STOP and report the exact values and their derivation before inventing a translation or mapping.**

Do not normalize ids, strip prefixes, use suffix matching, or choose the only Opening Range condition by count unless a prior certified contract explicitly says that is the identity join.

## 6. SMALLEST ACCEPTABLE RED→GREEN PROOF

Use the existing MP1/MP2 Python ingress harness and existing Opening Range/compiler tests. No new framework.

### A. Handoff RED

At the real config-file `main()` boundary, use a valid candidate-aware config plus valid persisted `compiled_spec`.

Pre-repair, prove:

- candidate authority validates successfully;
- Band C dispatch is reached;
- but the `opening_range_candidate` argument received by `from_compiled_spec(...)` is `None` / absent.

Positive-control the spy by proving the exact `compiled_spec` reaches the same call.

### B. Exact-object GREEN

After the smallest repair:

- the same arm reaches `from_compiled_spec(...)` with an `OpeningRangeExecutionCandidate`;
- its `candidate_id`, `cache_identity`, `source_spec_id`, `source_condition_id`, selected `variant_label`, and `duration_minutes` match the object returned by the existing resolver;
- preferably prove **object identity within the Python process** (`is`) between the resolver result and the object handed to `from_compiled_spec`, or otherwise use a spy at the resolver seam that makes any second reconstruction visible.

The goal is to prove **one proof, one object, one handoff**.

### C. Candidate controls real Opening Range state

Use the existing `SpecConditionStrategy` / `_h_opening_range` / `opening_range_adapter` path with deterministic synthetic bars; do not run a full historical backtest merely to prove the state handoff.

Use at least two real taught candidates from the same frozen definition (for example the existing 5m and 15m alternatives if those are the frozen variants).

Required discrimination:

- same compiled spec;
- same bar stream;
- only candidate changes;
- after the 5m lock but before the 15m lock, the 5m candidate's Opening Range condition is active/complete while the 15m candidate is still forming/not active;
- after the later lock, both may be complete according to the existing adapter contract.

This is the decisive semantic witness that the candidate is not merely metadata riding beside the strategy: the taught duration changes the real state/gating boundary through the existing adapter.

Do not invent prices or breakout rules for this test; the claim is state-window selection, not profitability or breakout direction.

### D. Condition-ownership negative control

If §5 confirms exact id equality is the intended join, prove a candidate minted for a different condition id cannot drive this binding's `_h_opening_range` state. It must fail closed before producing a usable range/gate for that condition.

### E. MP1 refusal remains earlier

A swapped/tampered/incomplete candidate sidecar must still produce the existing named candidate refusal before `from_compiled_spec` or `_h_opening_range` executes.

### F. Legacy negative control

A legacy config with no candidate sidecar remains candidate-free. It must not infer a duration from timeframe, compiled spec, variant order, or source text.

If that legacy compiled spec contains an Opening Range condition, the existing `_h_opening_range` no-candidate refusal remains the correct behavior; do not weaken it to make legacy fixtures green.

### G. Regression set

At the final pin run:

- existing MP1 route ingress suite;
- existing MP1 Python ingress suite;
- existing candidate receipt + persistence obligations;
- smallest directly relevant `spec_condition_compiler` Opening Range / S6 execution tests;
- `opening_range_adapter` tests;
- `npx tsc --noEmit` if TypeScript changed (it should not need to for the pure Python handoff unless the measured implementation says otherwise).

Do not run broad ACCEPT-5/RATIFY certification for this one seam.

## 7. WHAT OR-STATE-HANDOFF-1 DOES NOT AUTHORIZE

Do **not** expand this unit into:

- breakout trigger design or repair;
- retest/confirmation semantics;
- stop-loss or target implementation;
- framework-overlay changes;
- position sizing;
- HTF eligibility/ranking repair;
- Monte Carlo, OOS, walk-forward, prop simulation or paper;
- DB schema work;
- candidate identity redesign;
- another Opening Range calculator;
- compiler vocabulary expansion;
- strategy ranking or edge claims.

This unit ends when the already-certified candidate controls the already-built Opening Range state path.

## 8. STOP CONDITIONS

STOP and report before further mutation if:

1. the frozen candidate's `source_condition_id` does not exactly match the Opening Range binding id it is supposed to drive;
2. more than one Opening Range condition exists in the compiled spec and one candidate cannot be joined to exactly one condition without a new mapping rule;
3. the only way to pass the candidate requires rebuilding it from receipt/config fields after validation instead of preserving the resolver's returned object;
4. `_h_opening_range` cannot consume the handed candidate without changing Opening Range arithmetic or source meaning;
5. the 5m-vs-15m (or equivalent taught variants) state-control does not move the lock/gate boundary in the expected direction through the existing adapter;
6. passing the candidate weakens MP1 refusal ordering or lets an unproven candidate reach Band C;
7. the repair requires a new parameter channel, new candidate selector, DB migration, new compiler, or new runner/checker framework;
8. any required value would have to be guessed from timeframe, strategy name, prose, array order, or a default.

Otherwise execute straight through.

## 9. NO INDEPENDENT GRADER YET

No independent grader is required for this bounded handoff if:

- the production diff is small;
- the exact-object transport is directly proven;
- the real existing OR handler/adapter produces the duration-discriminating state witness;
- MP1/MP2 regressions remain green;
- no STOP fires.

If the work unexpectedly changes Opening Range arithmetic, compiler semantics, breakout semantics, or market-data interpretation, stop and reassess grader need before certifying.

## 10. EXIT CONDITION

When the worker has durable evidence that:

`DB-authoritative receipt -> existing resolver -> exact OpeningRangeExecutionCandidate -> from_compiled_spec -> SpecConditionStrategy -> _h_opening_range -> opening_range_adapter -> OpeningRangeState`

and the taught-duration discrimination is proven with no STOP active, post the final remote SHA.

GPT will independently verify and close **`OR-STATE-HANDOFF-1`**.

Then the shortest path is the next genuine strategy-semantic unit: complete the remaining Opening Range V1.0 sequence from state into **breakout / optional confirmation-retest / entry / invalidation / stop / target / exit**, using source-grounded rules only.

`EDGE-HTF-PASSTHROUGH-AUTHORITY-1` remains HIGH and must be closed before strategy ranking, but it does not block this state handoff.

Do not reopen Phase 5 referee engineering.