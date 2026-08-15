# AR-1184 — READY-TO-EDIT MAP

Parent finding: the internal PAPER -> server-mediated execution bridge is wired, but the ENTRY callsite chooses the first enabled broker account for the firm. The EXIT callsite was already hardened to refuse 0-or-multiple account ambiguity. With multiple Topstep accounts, entry can therefore route to one account while exit later refuses because ownership is ambiguous.

Broker egress stays OFF during this work.

## Open first

1. `src/server/services/paper-signal-service.ts`
2. `src/server/services/paper-execution-service.ts`
3. `src/server/services/strategy-assignment-service.ts`
4. `src/server/db/schema.ts`
5. `src/server/routes/paper.ts`
6. Existing PAPER signal tests, especially:
   - `src/server/services/paper-signal-service.parity.test.ts`
   - `src/server/__tests__/paper-signal-service-deepscan-findings.test.ts`
7. `src/server/__tests__/server-mediated-executor.test.ts` for downstream routing invariants.

## Measured entry defect

The entry callsite currently resolves `_smeAccountId` using conceptually:

```text
broker_accounts
WHERE firm_id = session firm
AND enabled = true
LIMIT 1
```

That is not account identity. It is row order.

## Existing exit safety authority

`paper-execution-service.ts::_resolveSmeContextForExit(...)` already queries active `account_strategy_assignments` + enabled `broker_accounts`, and FAILS CLOSED unless exactly one account matches strategy+firm.

Its own comment states the definitive multi-account fix is to thread an explicit account ID onto the paper/session identity rather than guess.

## PHASE A — smallest immediate safety repair

This phase is the preferred first Claude edit because it removes the dangerous misroute without requiring a migration.

### RED

Create a production-path account-resolution witness for ENTRY:

```text
strategy S
firm topstep
Account A enabled + assigned to S
Account B enabled + assigned to S

entry signal fires

expected:
NO routeLiveEntry call
NO "first account" selection
visible unresolved/ambiguous audit
```

Also prove:

```text
exactly one active assigned account -> that exact account ID is used
zero active assigned accounts -> no broker route
```

Do not accept a test that only tests `server-mediated-executor.ts`; the defect is UPSTREAM in the PAPER entry account resolver.

### Smallest Phase A patch

Replace the `LIMIT 1` firm-only entry lookup with the same semantic authority family the exit path already uses:

```text
account_strategy_assignments
JOIN broker_accounts
WHERE strategy_id = current strategy
AND assignment status = active
AND broker firm = session firm
AND broker enabled = true
```

Then:

```text
candidate count == 1 -> use that account
candidate count == 0 -> suppress SME entry + loud audit
candidate count > 1 -> suppress SME entry + loud audit
```

Suggested audit action:

```text
sme.entry_account_unresolved
```

with reason `no_active_assignment` or `ambiguous_multi_account`.

This mirrors existing EXIT fail-closed behavior and removes the silent wrong-account route immediately.

### Phase A touched boundary

Preferred:

```text
src/server/services/paper-signal-service.ts
ONE focused real-callsite test file or existing PAPER signal test
```

No schema migration required for Phase A.

## PHASE B — definitive multi-account identity conservation

Do NOT bundle this automatically into Phase A unless the active order authorizes it.

Current `/api/paper/start` stores `strategyId`, `mode`, `firmId`, config and capital, but not a specific broker account identity. That is why a later live entry has to rediscover/guess.

Before true multi-account broker egress, establish one explicit account identity in the session/execution lineage:

```text
account assignment / launch intent
-> paper/session identity
-> entry LiveExecutionContext.accountId
-> server_mediated_orders.accountId
-> fill reconciliation accountId
-> every exit/modify/flatten accountId
```

The exact schema field name should follow repository conventions (for example an account FK/ID on `paper_sessions`), and must use a hand-written SQL migration per current repository migration law.

Phase B must define how one strategy is launched across multiple Topstep accounts: normally one independently identified session/execution instance per account or another existing explicit account-scoped runtime identity. Never recover multi-account identity later from "first row" or unordered DB results.

## RED controls for Phase B

When authorized later:

```text
Session A bound to Account A -> entry/exit/fill rows always Account A
Session B bound to Account B -> entry/exit/fill rows always Account B
same strategy on A+B -> no ambiguity and no cross-account leakage
restart/rehydration preserves bound account ID
deleted/disabled assignment -> fail closed, no broker route
```

## Forbidden detours

- No live Topstep network call.
- No enabling `SERVER_MEDIATED_EXECUTION_ENABLED` in production.
- No "pick first", random, insertion-order, or lowest-ID fallback.
- No duplicate assignment table.
- No source-strategy semantic changes.
- Do not weaken exit-side ambiguity guard.

## Focused commands

Start with the exact new/extended PAPER-signal account-resolution test, then:

```bash
npx vitest run src/server/__tests__/server-mediated-executor.test.ts
npm run build
```

Also run the existing PAPER signal test(s) actually touched by the worker.

## Mutation control

Restore the old firm-only `.limit(1)` behavior. The two-account ambiguity test MUST fail.

## Completion receipt — Phase A

RED output, exact real entry callsite exercised, GREEN output, 0/1/2-account controls, mutation proof, commit SHA, push proof, BROKER EGRESS STILL OFF, STOP for GPT review.

## Bottom line

Fast safe move:

```text
NOW: remove unsafe first-account guessing (Phase A)
LATER before multi-account live: persist explicit account identity end-to-end (Phase B)
```
