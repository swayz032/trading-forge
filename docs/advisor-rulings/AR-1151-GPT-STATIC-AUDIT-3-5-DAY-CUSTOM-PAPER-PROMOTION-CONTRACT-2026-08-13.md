# AR-1151 — GPT STATIC AUDIT — 3–5 DAY CUSTOM PAPER PROMOTION CONTRACT

Date: 2026-08-13
Repo: `swayz032/trading-forge`
Runtime/PAPER authority inspected: current `main`

## Verdict

**THE CURRENT 30-DAY OUTER PRECONDITION IS OBSOLETE FOR THE CURRENT V4 DEADLINE PLAN, BUT DO NOT MERELY CHANGE `30` TO `3`.**

The fast/robust replacement is:

- **minimum: 3 receipt-valid custom-PAPER market days**
- **target: 5 receipt-valid custom-PAPER market days**
- retain the existing heavy historical/robustness promotion gates
- count only days whose custom-PAPER qualification receipt is complete and candidate identity stayed frozen
- preserve manual/cron/Carter promotion-path parity

The 3–5 day stage is an **operational/execution-integrity qualification**, not the place where statistical edge is invented from a tiny live sample. Edge must already be supported by the historical robustness stack before the candidate enters official PAPER.

## Current code — good structure, stale policy

Current shared precondition:
`src/server/lib/paper-to-deploy-ready-precondition.ts`

It centralizes:
- `PAPER_TO_DEPLOY_READY_MIN_TRADING_DAYS = 30`
- `PAPER_TO_DEPLOY_READY_MIN_ROLLING_SHARPE = 1.5`
- one pure evaluator used to keep manual and cron paths in parity

This centralization is GOOD engineering and must be preserved.

The file itself explicitly describes the 30-day rule as **INTERIM**, intended to be superseded by a future qualifying-day evaluator. That future evaluator has not replaced the current constants on `main`.

## Existing heavy gate stack must stay

Current `src/server/lib/paper-to-deploy-ready-gates.ts` preserves the real robustness stack after the outer PAPER precondition, including:

1. B14 survival-twin evidence
2. B14 ruin-CI hard gate
3. B15 parameter robustness
4. WFE hard floor
5. parameter drift
6. DSR walk-forward
7. BIF
8. Wave 26 orchestrator including multiple-testing evidence such as WRC/SPA where supplied
9. composite shadow (observability only)
10. frozen-policy drift

Do **not** weaken or bypass those just to meet the calendar deadline.

## New qualifying-day semantics

A calendar date should count toward the 3-day minimum / 5-day target only when the official custom Massive PAPER candidate has a **valid daily qualification receipt** per AR-1150.

At minimum a counted day must prove:

```text
same_complete_candidate_version == true
custom_paper_session_identity_present == true
custom_massive_paper_authority == true
nightly_required_evidence_complete == true
unresolved_provider_gap == false
incomplete_restart_recovery == false
unreconciled_signal_execution_count == 0
duplicate_execution_count == 0
critical_risk_control_failure_count == 0
unauthorized_candidate_mutation_count == 0
```

A day with zero executed trades is not automatically bad and is not automatically good.

- If the strategy legitimately had no qualifying signal, the receipt must be able to show that the engine was healthy and no expected signal was silently missed.
- At least one complete strategy-triggered entry→management→exit path must be exercised before the official PAPER run can be treated as proof that execution wiring works. If the candidate's natural cadence produces too little execution evidence, do not fabricate trades to make the calendar pass; treat execution-path proof as incomplete and use a separately identified deterministic readiness drill where appropriate.

## Rolling Sharpe treatment

`rollingSharpe30d >= 1.5` is structurally tied to the old 30-day model. A 3–5 day PAPER window is too short to treat a 30-day rolling-Sharpe statistic as the primary proof of edge.

Therefore the replacement evaluator should NOT silently pretend 3–5 days makes `rollingSharpe30d` statistically equivalent to the old contract.

Fast/robust separation:

- historical edge/robustness proof remains in backtest/OOS/WFA/MC/PBO/DSR/WRC-SPA/B15/etc.
- official 3–5 day custom PAPER proves current implementation integrity, state recovery, risk wiring, signal/execution parity, and absence of catastrophic divergence
- short-window PAPER P&L/Sharpe remains visible evidence, but must not be over-claimed as a new statistical edge proof

Any exact short-window performance veto beyond catastrophic/drift/risk evidence should be explicitly justified and tested rather than copied from the 30-day rule.

## Manual / cron / Carter parity

The July Gate-3 parity work fixed a real bypass by centralizing the precondition and routing manual promotions through the same rule as the cron. Carter's promotion action also benefits from that shared path.

Preserve this invariant:

```text
ONE shared qualifying-day evaluator
        ↓
cron promotion
manual promotion
Carter promotion
        ↓
SAME verdict
```

No duplicate `3`, `5`, or alternate qualifying-day logic in separate callers.

## Counting authority

The old query counts distinct dates with closed `paper_trades`. The new rule needs **receipt-valid trading days**, not merely dates on which one trade row exists.

Do not let a corrupted day count merely because one trade closed.

Preferred architecture:

```text
custom PAPER day evidence
        ↓
deterministic daily receipt/reconciliation
        ↓
VALID / INVALID qualification-day verdict
        ↓
shared PAPER precondition counts VALID days
```

Use the existing append-only trust/audit spine or a narrowly scoped durable receipt surface if needed; do not create duplicate trading telemetry. Whatever persistence is selected must provide idempotent one-day/one-candidate accounting so reruns cannot double-count a day.

## Boundary contract

- `0–2` valid days: **BLOCK**
- `3–4` valid days: **minimum duration satisfied**, eligible to proceed only if all other qualification/robustness gates and execution-integrity requirements are green
- `5+` valid days: **target duration satisfied**, still no bypass of any hard gate
- any candidate-version change: old run stops counting toward the new version unless an explicitly versioned policy says otherwise
- any invalid day: do not count it as a qualifying day; preserve evidence and reason

## Deadline behavior

The deadline must never create a fail-open branch.

Do not implement:

```text
if (date >= Aug 27) allow promotion
```

The deadline controls engineering priority, not gate truth.

The safe speed mechanism is to make the 3–5 days **higher-information days**, not lower-integrity days.

## Tests required for the eventual implementation

At minimum:

1. pure boundary matrix: 0,1,2 BLOCK; 3,4 minimum satisfied; 5 target satisfied
2. manual/cron/Carter all consume the same evaluator
3. invalid receipt does not increment the count
4. duplicate receipt/rerun does not double-count one date
5. zero-trade healthy day cannot be confused with missing telemetry
6. provider-gap/restart-incomplete day does not count
7. candidate hash mismatch resets/partitions evidence by version
8. all existing PAPER→DEPLOY_READY heavy gates still execute after duration passes
9. 2 valid days + excellent backtest evidence still BLOCKS on duration
10. 5 valid days + failed B14/WFE/B15/etc. still BLOCKS

Use RED→GREEN evidence against the real lifecycle path, not tests of a copied helper.

## Fast engineering order

After the compiler critical path:

1. complete candidate-version identity
2. deterministic daily receipt
3. shared 3-min / 5-target qualifying-day evaluator
4. replace old 30-day outer precondition in one shared contract
5. preserve heavy gate stack unchanged except where independently measured defects require repair
6. live custom-PAPER + 3AM proof
7. no-Claude autonomy drill

## Status

- shared manual/cron precondition architecture: **GOOD / REUSE**
- current 30-day policy: **STALE FOR CURRENT V4 PLAN**
- 3–5 day receipt-valid policy: **FROZEN REQUIREMENT, NOT YET IMPLEMENTED**
- heavy robustness stack: **PRESERVE**
- deadline bypass: **FORBIDDEN**
