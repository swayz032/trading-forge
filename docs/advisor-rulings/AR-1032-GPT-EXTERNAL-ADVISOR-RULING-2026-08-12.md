# GPT EXTERNAL ADVISOR RULING — AR-1032 / LOCAL MP1 REPAIR NOT YET CERTIFIABLE / PUSH EXACT REPAIR THEN CLOSE ONE REAL DB-READ FAIL-OPEN / NO LIVE-DB CAMPAIGN

## 1. VERDICT

**AR-1032 is NOT YET ACCEPTED AS LANDED MP1 AUTHORITY.**

The engineering described in the report is directionally strong and the local evidence is substantial, but the load-bearing repair commit `4f5a5815` is **not on origin**. GitHub cannot resolve that SHA, and `origin/h1-wave4-sealed12-driver` remains exactly at the pre-MP1 pin `3be07ddc043faa82c5a6291345b669aece57e968`.

Therefore the current status is:

- **MP1-CANDIDATE-INGRESS-1: LOCAL RED→GREEN CLAIMED, NOT EXTERNALLY CERTIFIED.**
- **Do not call MP1 closed yet.**
- **Do not discard or rewrite the local repair merely because it is not pushed.**
- **Push the exact existing repair first, then continue with the one bounded fail-open repair below.**

This is not a request for another grader, another architecture pass, or a live-database campaign.

## 2. WHAT GPT INDEPENDENTLY VERIFIED AT THE PRE-MP1 PIN

At `3be07ddc`:

1. `spec-onboarding-service.ts` persists the candidate sidecar as siblings of `compiled_spec`:
   - `execution_candidate_id`
   - `execution_candidate_cache_identity`
   - `execution_candidate_receipt`
   and `compiled_spec.spec_hash` is present as the outer parent-spec anchor.

2. `/api/backtests` currently builds its execution config from request-body `...rest` plus an explicitly reconstructed strategy object. Candidate fields are not part of the request schema and are not copied from the persisted strategy config into `fullConfig`.

3. `runBacktest()` passes the config it receives directly through the existing Node→Python JSON transport. No new subprocess bridge is needed.

4. Python `BacktestRequest` has no candidate-authority fields at the pre-repair pin.

5. `opening_range_candidate_persistence.resolve_row_for_execution()` is the existing authoritative validator for a persisted candidate row and includes the required outer parent anchor plus candidate/cache/receipt validation. Reuse is correct; a second validator would be wrong.

The worker's stated repair shape therefore matches the measured architecture: this is an activation/threading defect, not a missing candidate system.

## 3. FIRST REQUIRED ACTION — PUSH THE EXACT LOCAL REPAIR

Push commit `4f5a5815` to `h1-wave4-sealed12-driver` **without opportunistic edits folded into it**.

After push, verify from the remote that:

- the SHA resolves;
- its parent is `3be07ddc`;
- the changed production files are the claimed `src/server/routes/backtests.ts` and `src/engine/backtester.py`;
- the two claimed MP1 ingress test files are present;
- the committed `backtester.py` change remains the intended bounded addition rather than the previously reverted broad Ruff rewrite.

If the pushed SHA differs because the commit had to be recreated, report the new full SHA and exact diff. Do not pretend `4f5a5815` landed if it did not.

## 4. ONE REAL MP1 BLOCKER REMAINS — DB READ FAILURE MUST NOT DOWNGRADE AUTHORITY

The worker correctly disclosed a pre-existing fail-open, and GPT independently confirms the shape from the current route.

Today `/api/backtests` does this:

- attempts to read `strategies` by `strategyId`;
- if the read fails and no request strategy was supplied, it returns an error;
- **if the read fails and the request DID supply `strategy`, it proceeds.**

That behavior is incompatible with candidate authority once MP1 exists.

Why: when the DB read fails, the route cannot know whether `strategyId` names:

- a legacy receiptless strategy, or
- a candidate-aware strategy whose sidecar must be enforced.

Treating "DB authority unavailable" as "legacy/no candidate" is a silent downgrade. A caller could then provide a request-body strategy while the candidate sidecar is unknowable.

**RULING: fail closed on the strategy-authority DB read.**

If the route cannot read the persisted strategy row, it may not execute that `strategyId` as though candidate authority were absent.

Smallest acceptable repair:

- on the DB strategy lookup exception, return a deterministic non-202 refusal/error response before slot acquisition and before Python spawn;
- do not infer legacy status;
- do not accept request-body strategy as a substitute for unavailable persisted authority;
- do not add retries, caches, fallback stores, or a second manual-strategy architecture in this lane.

A stable code such as `strategy_authority_unavailable` is preferred over an English-only message.

## 5. REQUIRED RED→GREEN FOR THE FAIL-OPEN

Use the existing real route-handler harness from the MP1 repair. Do not build another framework.

Required control set:

1. **RED witness:** DB strategy read throws + request-body strategy supplied → pre-fix route proceeds far enough to represent the fail-open.
2. **GREEN:** same arm after repair returns deterministic non-202 `strategy_authority_unavailable` (or equivalent stable named code), before `_acquireBacktestSlot()` and before `runBacktest`/Python.
3. **Normal candidate-aware exact-match arm remains GREEN.**
4. **Candidate-aware request-body strategy conflict remains 409/refused.**
5. **Legacy row with a successful DB read remains behaviorally unchanged.**
6. **DB read failure with no provided strategy remains refused/error, not weakened.**

One direct spy proving `runBacktest` was not called on the DB-failure arm is sufficient. No live Postgres is required for this repair.

## 6. LIVE DB ROUND TRIP — NOT REQUIRED TO CLOSE THIS UNIT

GPT accepts contract-level proof for the literal DB persistence→route field join **provided the repair commit is pushed and externally inspectable**.

Reason: the writer and reader live in the same repository and the exact persisted field names are explicit and testable. A live Postgres round trip here would add environment cost without testing a different semantic question.

Do not build a database integration campaign merely to prove JSONB preserves named keys.

A real candidate-aware full backtest is also **not required for MP1-CANDIDATE-INGRESS-1** because this lane deliberately proves identity continuity/refusal, not Opening Range trading semantics. Full execution use belongs to `OR-STATE-HANDOFF-1` / OR V1.0.

## 7. THE CANDIDATE MAY BE VALIDATED AND THEN DISCARDED — FOR THIS LANE ONLY

AR-1032 states that Python validates `resolve_row_for_execution()` and then does not yet use the returned `OpeningRangeExecutionCandidate` to change trades.

That is acceptable for **MP1 ingress** and must remain explicit.

The lane's contract is:

> the exact persisted taught candidate reaches the engine and is proven before execution can continue.

It is **not** yet:

> Opening Range execution consumes that candidate's duration/session semantics.

Do not smuggle OR trading behavior into MP1 to make the validator "useful." That is the next compiler/execution handoff problem and has its own controls.

## 8. NO INDEPENDENT GRADE REQUIRED

Do **not** dispatch an accuracy-validator at this point.

The decisive claims are mechanical and can be independently checked from the pushed diff plus RED→GREEN tests:

- sidecar copied from DB authority;
- request override blocked for candidate-aware rows;
- Python reuses the existing validator;
- mismatch refuses before market data;
- DB authority outage fails closed;
- legacy successful-read path remains unchanged.

A grader would be duplicate cost unless the final pushed diff reveals a materially different implementation than the report describes.

## 9. STOP CONDITIONS

STOP and report before further mutation if:

1. pushing the local repair reveals materially different code than AR-1032 describes;
2. the fail-closed DB repair requires changing trading/compiler/risk/P&L semantics;
3. candidate identity cannot be bound to persisted `compiled_spec.spec_hash` without inventing a value;
4. the repair requires a DB migration or a new candidate validator;
5. the exact-match candidate path can only proceed by trusting request-body candidate identity rather than DB authority;
6. the Python gate cannot refuse before market-data/execution work;
7. `EDGE-HTF-PASSTHROUGH-AUTHORITY-1` becomes load-bearing to this ingress repair.

Otherwise continue straight through.

## 10. EXIT CONDITION

After:

1. the MP1 repair is pushed and origin-verifiable;
2. the DB-read fail-open is repaired RED→GREEN with the bounded controls above;
3. the existing MP1 ingress suites, 25 candidate receipt/persistence obligations, adjacent backtest suites, and `tsc --noEmit` are green at the final pin;
4. no STOP is active;

post one worker report with the final remote SHA.

GPT will then independently verify the pushed code and, if it matches the contract, close:

**`MP1-CANDIDATE-INGRESS-1`**

and authorize the next money-path unit:

**persisted candidate/config authority → backtest row/config persistence → Python execution-side candidate use / `OR-STATE-HANDOFF-1` as dependency requires.**

Do not reopen Phase 5 referee work.
