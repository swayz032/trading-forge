# AR-1176 — READY-TO-EDIT MAP

Parent finding: drift is marked per `(account_id, symbol)`, but `clearAccountReconcileBlock()` clears every `needs_reconcile` order for the entire account. Clearing MES can therefore erase unresolved MNQ/MCL evidence.

## Open first

1. `src/server/services/fill-reconciliation-service.ts`
2. `src/server/routes/fill-callback.ts`
3. `src/server/__tests__/fill-reconciliation.test.ts`

## Exact production seams

Service today:

```ts
clearAccountReconcileBlock(accountId, resolvedBy, correlationId)
```

with WHERE:

```text
account_id = accountId
AND status = needs_reconcile
```

Route today accepts:

```text
account_id
rationale
timestamp_ms
hmac
```

and the reconcile-clear HMAC does not bind a symbol.

## RED first

Create a two-symbol witness:

```text
Account A:
  MES = needs_reconcile
  MNQ = needs_reconcile

operator clears MES

expected:
  MES -> reconciled
  MNQ -> STILL needs_reconcile
  account-wide entry block -> still TRUE because MNQ remains unresolved
```

The existing service test `Test 15: clearAccountReconcileBlock...` is the right block to extend, but the DB mock must capture the WHERE inputs strongly enough to prove `intendedSymbol` is part of the real production update predicate.

Also add route/HMAC contract cases:

```text
symbol is required for normal reconcile-clear
HMAC for MES cannot be replayed as MNQ
```

Focused command:

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
```

## Smallest repair

Change normal clear semantics to exact symbol scope, conceptually:

```ts
clearAccountReconcileBlock(accountId, symbol, resolvedBy, correlationId)
```

Update the DB predicate to include:

```text
account_id = accountId
intended_symbol = symbol
status = needs_reconcile
```

Update audit + SSE payloads to carry the symbol.

Update `ReconcileClearBodySchema` to require a symbol and bind that symbol into the HMAC canonical message. The same signed request must not authorize a different symbol.

Keep `isAccountBlockedForReconcile(accountId)` account-wide and conservative: ANY unresolved symbol keeps new entries blocked unless a later separately-reviewed policy explicitly scopes entry blocking.

If an emergency account-wide clear is ever needed, it must be a separate explicit admin action with a separate HMAC scope and is OUT OF SCOPE for this packet.

## Forbidden detours

- Do not weaken the account-wide entry block.
- Do not auto-clear sibling symbols.
- Do not create a generic wildcard `symbol=*` normal path.
- Do not touch broker network transport.
- Do not combine this with AR-1184 account-identity work.

## GREEN

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
npm run build
```

Then canonical relevant server lane.

## Controls

Must prove:

```text
MES clear affects MES only
MNQ remains unresolved
account remains blocked while MNQ unresolved
MES-signed HMAC mutated to MNQ -> rejected
wrong account -> rejected/does not clear
```

## Mutation control

Remove the symbol predicate from the service update. The two-symbol test MUST fail.

## Expected touched-file boundary

```text
src/server/services/fill-reconciliation-service.ts
src/server/routes/fill-callback.ts
src/server/__tests__/fill-reconciliation.test.ts
```

A new tiny route-focused test file is allowed only if extending the existing file cannot exercise the actual route contract without copying route logic.

## Completion receipt

RED output, exact new HMAC canonical shape, GREEN output, two-symbol control, HMAC mutation control, commit/push proof, STOP for GPT review.
