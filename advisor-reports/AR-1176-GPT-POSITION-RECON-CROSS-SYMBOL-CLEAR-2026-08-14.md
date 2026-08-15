# GPT EXTERNAL ADVISOR RULING — AR-1176

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / POSITION RECONCILIATION STATIC AUDIT  
**V4 stage:** AR / EXECUTION SAFETY  
**Status:** HIGH FINDING CONFIRMED — PREPARED FIX PACKET

## SIMPLE RESULT

The reconciliation system detects drift at **account + symbol** scope, but its admin clear path clears `needs_reconcile` rows at **account-only** scope.

This creates a cross-symbol unsafe-clear case:

```text
same account
MES drift unresolved
MNQ drift unresolved
        ↓
operator verifies MES only
        ↓
POST reconcile-clear(account)
        ↓
current service marks ALL needs_reconcile rows on account reconciled
        ↓
MNQ block disappears without MNQ being verified
```

For a system intended to trade MES/MNQ/MCL concurrently, reconciliation clearance must not erase sibling-symbol uncertainty.

---

## DIRECT CODE PROOF

### Detection is symbol-specific

`checkPositionDrift()` queries and marks orders using both:

```text
accountId = params.accountId
intendedSymbol = params.symbol
```

When drift is detected, only relevant account+symbol rows are changed to `needs_reconcile`.

### Entry block is account-wide

`isAccountBlockedForReconcile(accountId)` conservatively blocks the whole account when **any** `needs_reconcile` order exists. This is safe over-blocking and is not the defect.

### Clear is account-only

`clearAccountReconcileBlock(accountId, resolvedBy, correlationId)` updates:

```text
accountId = accountId
status = needs_reconcile
```

with **no symbol filter**.

### Route cannot express symbol

`POST /api/broker/fill-callback/reconcile-clear` accepts:

```text
account_id
rationale
timestamp_ms
hmac
correlation_id
```

There is no `symbol` in the schema or HMAC canonical.

The route therefore cannot request a symbol-scoped clear even if the caller wants one.

---

## SEVERITY

**HIGH before multi-symbol broker execution.**

The current block behavior is conservatively account-wide, but the unblock behavior is broader than the evidence being verified.

A safety clear must be no broader than the truth that was independently reconciled.

---

# SMALLEST SAFE FIX

Keep account-wide blocking.

Make clearance narrower.

Preferred contract:

```text
clearAccountReconcileBlock({
  accountId,
  symbol,
  resolvedBy,
  correlationId
})
```

The admin body must include `symbol`, and the HMAC must bind it.

Clear only:

```text
accountId = requested account
symbol = requested symbol
status = needs_reconcile
```

After the symbol clear:

- if another symbol still has `needs_reconcile`, the account stays blocked;
- if none remain, account becomes unblocked naturally through the existing query.

Do not add a separate mutable account-level “cleared” flag.

For a truly account-wide emergency clear later, require a separate explicit action with stronger proof; do not overload the normal symbol reconciliation endpoint.

---

# REQUIRED TESTS

## RED proof

Seed:

```text
Account A / MES / needs_reconcile
Account A / MNQ / needs_reconcile
```

Call current clear for Account A after a MES-only rationale.

Current result must demonstrate both rows can be changed to `reconciled`.

## GREEN proof

After repair:

```text
clear Account A + MES
=> MES reconciled
=> MNQ remains needs_reconcile
=> isAccountBlockedForReconcile(Account A) remains true
```

Then:

```text
clear Account A + MNQ
=> no needs_reconcile rows remain
=> account block clears
```

## Cross-account negative control

Account B rows must never change when clearing Account A.

## HMAC mutation control

Sign a clear for MES, mutate body symbol to MNQ, send same HMAC.

Required: `401`.

This proves the symbol scope is bound into authorization, not merely accepted by JSON.

---

# RELATION TO AR-1175

AR-1175 = one-contract quantity blind spot.

AR-1176 = unsafe broad reconciliation clear.

Separate fixes, separate evidence.

---

# GATES

No broker network required.
Server-mediated execution remains OFF.
AR-1138 remains first semantic gate.

## Bottom line

**CONFIRMED:** symbol-specific drift can be cleared account-wide.

**Prepared repair:** keep account-wide blocking conservative, but require symbol-scoped evidence and symbol-bound HMAC for normal reconciliation clearance.