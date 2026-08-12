# GPT EXTERNAL ADVISOR RULING — AR-1035 / OR-STATE-HANDOFF-1 CLOSED / DO NOT REOPEN ACCEPT-5 / NEXT: OR-V1.0 EXECUTION CHAIN

## 1. VERDICT

**AR-1035 ACCEPTED.**

**`OR-STATE-HANDOFF-1 = CLOSED` at remote engineering pin `0bbcabc81ae2ed6350bcda4d8494cff1e618dd81`.**

The pushed implementation closes the missing semantic hop without rebuilding the candidate or introducing a second Opening Range engine:

`DB-authoritative receipt → resolve_row_for_execution() → exact returned OpeningRangeExecutionCandidate → backtester main() → from_compiled_spec(opening_range_candidate=...) → SpecConditionStrategy → _h_opening_range → opening_range_adapter → OpeningRangeState`.

The decisive property is now real: changing only the taught candidate changes the real Opening Range lock/state boundary. The worker’s 5m-vs-15m witness is the correct semantic discriminator for this unit.

## 2. EXTERNAL VERIFICATION

GPT independently verified on origin:

1. Commit `c3355df47f37ea2cdbbb9ee00aea78dc0b363fa8` resolves and contains the bounded handoff repair.
2. `resolve_candidate_authority()` retains the exact object returned by `resolve_row_for_execution()` and returns `(refusal, candidate)`; no second candidate reconstruction is introduced.
3. `main()` passes that same local `_proven_candidate` into the already-existing `from_compiled_spec(..., opening_range_candidate=...)` parameter.
4. `_h_opening_range` already consumes `candidate.definition` and `candidate.variant` through the existing certified opening-range adapter.
5. The new fail-closed join rejects a candidate whose `source_condition_id` differs from the actual `ConditionBinding.condition_id`.
6. Final commit `0bbcabc8` changes only generated `SYSTEM-INVENTORY.md`; no further production semantics are hidden in the landing commit.

This is exactly the intended repair class: **one proof, one object, one handoff**.

## 3. WORKER FINDING 1 — STALE CANONICAL MANIFEST IS REAL, BUT NON-BLOCKING HERE

The worker found:

- committed canonical regression manifest: `107` members;
- current derivation: `108` members;
- added derived member: `engine/tests/test_mp1_backtester_ingress.py`.

GPT independently verified that the committed manifest still omits that MP1 file and that its own guard explicitly forbids blind regeneration without a member-diff review.

**RULING: DO NOT REGENERATE `canonical_regression_population.txt` in this lane.**

Reason: Phase 5 / ACCEPT-5 is already closed. The accepted closeout used the frozen referee population plus its successor disposition contract. Blindly adding the new post-close money-path test would change that closed population and could force a new baseline/disposition/seal cycle for no trading-semantic benefit.

Bank this as:

**`ACCEPT5-POSTCLOSE-POPULATION-DRIFT-1` — OPEN / NON-BLOCKING TO OR V1.0.**

Wake it only if one of these becomes true:

1. ACCEPT-5 is intentionally used again as current certification authority;
2. CI or a required pre-push gate blocks money-path work on the mismatch;
3. a future ruling explicitly authorizes a new post-close regression population.

Until then: no manifest regeneration, no successor seal, no RATIFY, no census revival, no Phase-5 reopening.

The individual red test must remain disclosed in reports; do not misreport a broad suite as green if it includes that known red.

## 4. WORKER FINDING 2 — TEST-ONLY `validate_candidate_authority` WRAPPER

`validate_candidate_authority()` is now a refusal-only compatibility wrapper around `resolve_candidate_authority()` and has no non-test production caller.

**RULING: KEEP IT FOR NOW.**

It is not on the money path, does not create a second proof, and removing it would churn existing MP1 tests for cleanup-only value. Do not spend a lane retiring it. Revisit only during a later bounded hygiene pass or if it causes a real ambiguity.

## 5. NEXT UNIT — `OR-V1.0-EXECUTION-CHAIN-1`

The next objective is no longer transport. It is the remaining source-faithful execution chain after the Opening Range state exists:

`range locked → breakout → optional confirmation/retest if source requires it → entry → invalidation → framework-owned stop/target/exit → deterministic trade result`.

This unit may proceed straight through without another GPT permission round-trip **unless a STOP below fires**.

### Step A — READ-ONLY MAP FIRST

Before mutation, trace ONE real frozen golden candidate end-to-end and publish a compact table for every relevant condition/role:

- source condition id / role;
- compiled `ConditionBinding.type` and primitive;
- exact production handler currently reached;
- whether it is gating, non-gating, approximation, or refused;
- whether its output is actually consumed in the entry decision;
- where invalidation is consumed;
- which framework layer owns stop/target/exit.

Do not infer the sequence from names. Measure the actual binding plan and actual dispatch.

The map must answer these questions explicitly:

1. What exact condition produces the **breakout** decision after the OR locks?
2. Is confirmation/retest source-required, optional, OR-branched, or merely contextual for this golden strategy?
3. What exact boolean/event makes `entry_long` / `entry_short` true?
4. What exact source invalidation can block or cancel that entry?
5. Which stop/target/exit pieces are source-owned versus framework-overlay-owned?

### Step B — CLOSE THE FIRST REAL EXECUTION HOLE, NOT A THEORETICAL ONE

If the map shows an existing primitive/handler is already correct but disconnected, wire the smallest missing hop and RED→GREEN it.

If the map shows a condition is currently approximated or non-gating and making it exact requires semantics the source did not provide, **STOP**. Do not invent a breakout threshold, retest tolerance, confirmation rule, invalidation rule, or direction.

### Step C — REQUIRED ENTRY-CHAIN CONTROLS

At minimum, use deterministic synthetic bars through the real production path to prove:

1. **No pre-lock entry:** before the selected candidate’s OR lock, no breakout-derived entry can occur.
2. **No-breakout arm:** after lock, price that does not satisfy the source breakout rule produces no entry.
3. **Breakout arm:** same state with only the source-required breakout fact changed produces the expected directional entry.
4. **Candidate discrimination:** same spec + same bars, 5m vs 15m candidate changes the earliest bar on which the breakout can even become eligible where the windows differ.
5. **Required confirmation/retest discrimination:** if the source makes it mandatory, absence blocks entry and presence permits it. If it is optional, prove the optional branch instead of silently making it mandatory.
6. **Invalidation:** a source invalidation that is true before entry prevents/voids the entry in the real path; a clean control does not.
7. **Wrong-direction control:** a long-only breakout fact must not manufacture a short, and vice versa, according to the source’s actual direction contract.

A test that only checks a helper in isolation is insufficient. At least one witness must pass through `SpecConditionStrategy.compute()` and the real backtester entry path.

### Step D — FRAMEWORK EXIT CHAIN

After the entry chain is faithful, verify the existing framework overlay owns stop/target/position sizing/exit exactly as previously designed. Do **not** move source logic into the framework or framework policy into the compiler.

For one deterministic trade fixture, prove:

- entry price/time are produced by the source-faithful entry chain;
- framework stop is attached through the existing authoritative path;
- framework target/runner logic is attached through the existing authoritative path;
- source invalidation and framework risk controls remain distinguishable in trace/receipt;
- the resulting trade closes for the expected reason under a deliberately constructed stop/target path.

Do not optimize parameters or profitability in this unit. This is fidelity, not edge search.

## 6. WHAT COUNTS AS OR V1.0 COMPLETE

`OR V1.0` is complete when ONE real frozen source strategy/candidate can travel through the production path and produce a deterministic, source-faithful executed trade (or a named refusal) with all of these attributable:

- selected taught OR candidate;
- locked range state;
- breakout condition;
- optional/required confirmation or retest semantics exactly as taught;
- direction and entry;
- source invalidation;
- framework stop/target/exit provenance;
- no guessed values and no silent defaults.

A compile that reaches `from_compiled_spec()` but never produces a faithful trade is not V1.0 complete.

## 7. STOP CONDITIONS

STOP and report before semantic mutation if any of the following occurs:

1. the golden source does not actually specify enough information to define the breakout/confirmation/retest/invalidation being implemented;
2. two competing conditions could plausibly own the same execution role and the compiler does not distinguish them;
3. making a currently approximate primitive exact requires inventing a threshold, duration, price relation, tolerance, session rule, or direction;
4. the candidate condition-id relation no longer uniquely joins the execution condition being evaluated;
5. entry fidelity requires changing framework stop/target/risk policy;
6. framework exit behavior would need to be changed merely to make the golden strategy profitable;
7. the repair expands into a new compiler, a new OR calculator, a DB migration, or a new checker framework;
8. `EDGE-HTF-PASSTHROUGH-AUTHORITY-1` becomes load-bearing to whether this strategy is eligible to enter in the test being claimed.

Otherwise continue through the bounded chain.

## 8. REGRESSION / EVIDENCE POLICY

Run the smallest relevant suites:

- MP1/MP2 ingress controls;
- OR candidate/adapter/transport/fanout controls;
- spec-condition compiler and trigger-safety controls touched by the change;
- the new end-to-end OR V1.0 execution witness;
- TypeScript only if TypeScript changes.

Do not run ACCEPT-5, RATIFY, a five-arm certification, live Postgres, Monte Carlo, OOS/WF, or a long historical backtest merely to prove this semantic chain.

The known canonical-manifest red must be reported separately, not “fixed” by changing the denominator.

## 9. AFTER OR V1.0

If OR V1.0 closes cleanly, the next path is:

**real historical backtest → `EDGE-HTF-PASSTHROUGH-AUTHORITY-1` before ranking → OOS / walk-forward / Monte Carlo / sensitivity / regime / execution+prop simulation → paper → Slumdawg/TopstepX.**

Do not begin edge ranking while HTF authority can silently change eligibility or metrics.

## 10. NEXT REPORT

Report when either:

- `OR-V1.0-EXECUTION-CHAIN-1` is complete and pushed with the final SHA and one deterministic real-path trade witness; or
- a STOP condition fires.

Do not hand off merely because this is a new sub-unit if the current worker has adequate context.