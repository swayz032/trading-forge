# GPT EXTERNAL ADVISOR RULING — AR-1184

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / PAPER -> EXECUTION PARITY STATIC AUDIT  
**V4 stage:** Q / AR / EXECUTION SAFETY  
**Status:** CRITICAL MULTI-ACCOUNT PARITY GAP CONFIRMED — BROKER EGRESS REMAINS CLOSED

## SIMPLE RESULT

At accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`, the internal PAPER -> server-mediated execution bridge **is wired** for entries and exits.

That is the good news.

The critical problem is **account identity is not conserved symmetrically**.

### Entry path

In `paper-signal-service.ts`, after the PAPER entry is opened, the server-mediated entry bridge resolves its broker target as:

```ts
broker account where:
  firm_id = PAPER session firm
  enabled = true
LIMIT 1
```

The source comment calls this:

```text
first enabled account for this firm
```

It does not bind the entry to one explicit account assignment.

### Exit path

`paper-execution-service.ts` was already hardened against this exact class of bug.

Its `_resolveSmeContextForExit(...)`:

- resolves active `account_strategy_assignments` for strategy + firm;
- requires **exactly one** matching enabled account;
- if 0 or >1 matches, it refuses to guess and suppresses the live exit;
- explicitly documents that the old first-enabled-account behavior could route an exit for account B to account A.

Therefore the current asymmetry permits this sequence:

```text
Topstep account A enabled
Topstep account B enabled
same strategy is eligible across both

PAPER entry fires
        ↓
entry resolver LIMIT 1
        ↓
live entry may route to account A simply because A is first
        ↓
later TP / trail / flatten occurs
        ↓
exit resolver sees A + B as ambiguous
        ↓
exit is suppressed fail-closed
        ↓
possible live position remains open on A while PAPER position changes/closes
```

This is not acceptable multi-account parity.

---

# SEVERITY

**CRITICAL before any real broker egress.**

The side/quantity math can be perfectly correct and still be unsafe if the order is sent to the wrong account or the exit cannot identify the account that received the entry.

Topstep multi-account use is an intended Scaling path, so `LIMIT 1` is not a safe long-term identity model.

---

# CORRECT ARCHITECTURAL LAW

A live-shaped PAPER decision that may later become broker execution must carry **one explicit execution account identity** from entry through every later exit/reconcile action.

Required conservation:

```text
PAPER SESSION / EXECUTION CANDIDATE
        ↓
EXPLICIT account_id
        ↓
ENTRY INTENT account_id
        ↓
SERVER-MEDIATED ORDER account_id
        ↓
FILL / POSITION RECON account_id
        ↓
TP / STOP / TRAIL / FLATTEN account_id
```

No stage may rediscover the account by:

- `LIMIT 1` among a firm's accounts;
- database row order;
- "first active assignment";
- strategy+firm when more than one account is valid.

---

# SMALLEST ROBUST FIX

The existing exit comment already points at the durable fix: thread explicit account identity into the PAPER/session execution authority.

Before changing schema, first inspect whether an existing authoritative account key/id already belongs on the PAPER session/assignment path and reuse it if lossless.

If no exact account identity exists, add the smallest canonical field/link necessary so the session being used for live-shaped execution is account-scoped.

Then:

1. Entry routing consumes that exact account ID.
2. Exit routing consumes the exact same account ID; do not re-resolve by strategy+firm.
3. Fill reconciliation uses the same ID.
4. Account assignment validation confirms the strategy is currently authorized for that account before entry.
5. If explicit account identity is missing/invalid/ambiguous, broker execution is refused before PAPER state can be mistaken for live parity.

Do not solve this by changing entry from `LIMIT 1` to another arbitrary ordering rule.

---

# NO-EGRESS PARITY RECEIPT

Before any network order is allowed, add/prove a no-egress parity receipt for each execution decision.

Minimum entry intent:

```text
strategy_id
candidate/artifact identity
paper_session_id
account_id
firm_id
symbol
side
quantity
order_type
bar_timestamp
correlation_id
idempotency identity
broker_egress = false
```

Minimum exit intent additionally includes:

```text
position/order lineage
exit type = TP1 | TP2 | BE_MOVE | TRAIL | FLATTEN
remaining/pre-exit quantity as applicable
price / stop price
```

The same intent fields should feed the eventual broker adapter after launch gates open rather than translating the PAPER decision twice independently.

Framework-owned sizing/risk/SL/TP changes are allowed only where already canonical; the parity test compares the **final approved PAPER execution decision** to the no-egress broker intent.

---

# REQUIRED TESTS

## RED 1 — wrong-account entry witness

Fixture:

```text
Firm Topstep
Account A enabled
Account B enabled
same strategy/session firm
```

Current entry resolver can return whichever matching account DB returns first.

Prove the selected account is not tied to an explicit PAPER account identity.

## RED 2 — entry/exit asymmetry

Fixture with active assignments for the same strategy on A and B:

```text
entry resolver -> selects one via LIMIT 1
exit resolver -> sees 2 and returns null / suppresses route
```

That exact split is the safety regression witness.

## GREEN — explicit account conservation

Create two independent account-scoped execution/PAPER contexts:

```text
Context A -> Account A
Context B -> Account B
```

Same strategy may be used on both where Topstep rules/config permit it.

Required:

- A entry intent only names A;
- A TP/stop/flatten only names A;
- B entry/exit only names B;
- database insertion order has no effect;
- disabling/removing A assignment blocks only A's new entry path under the defined safety policy;
- no cross-account order intent appears.

## Mutation control

Replace explicit account use in the test adapter with `.limit(1)` firm lookup.

Parity/account-identity test must fail.

## Restart control

After a PAPER/runtime restart, restored open-position/execution lineage must still identify the exact account without querying "first account for firm".

---

# EXISTING EXIT HARDENING — REUSE IT

Do not remove the current exit fail-closed ambiguity guard until explicit account identity is proven end-to-end.

It is currently protecting capital from wrong-account exits.

Once exact account identity is available, replace the ambiguous strategy+firm discovery with direct account lineage and retain validation that the account/strategy relationship remains authorized.

---

# SEPARATE KNOWN EXIT-ORDERING GATE

This report does not close the older go-live issue where PAPER state is mutated before broker exit confirmation.

Current server-mediated comments still describe PAPER entry/exit state as applied first, then live routing fire-and-forget. Broker route failure moves order state to `needs_reconcile` but does not rewind PAPER state.

That is a separate GL-8 / live-execution ordering/reconciliation gate and stays OPEN for the Topstep gap map.

---

# GATES

- `SERVER_MEDIATED_EXECUTION_ENABLED` remains OFF.
- Broker egress remains ZERO for parity proof.
- Topstep network remains closed until paid access + explicit authorization.
- AR-1138 remains first semantic gate.
- P0-6 remains the first Worker 2 live-machine hardening lane after activation.

## Bottom line

**PAPER -> server-mediated execution is wired, but account identity is not safely conserved on entry.**

The entry path can pick the first enabled account while the exit path correctly refuses ambiguity.

**Fix before live:** one explicit account identity must travel from PAPER decision through entry, fill reconciliation, and every exit. Never pick a live account by row order.