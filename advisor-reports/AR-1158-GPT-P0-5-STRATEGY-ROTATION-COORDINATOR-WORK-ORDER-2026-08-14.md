# GPT EXTERNAL ADVISOR RULING — AR-1158

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Audit target commit:** `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Parent GPT ruling:** AR-1157 @ `2f5f0163d6250015880d268ad93c5334c2233699`  
**Status:** STATIC AUDIT / READY-TO-CODE WORK ORDER / NO CLAIM OF IMPLEMENTATION COMPLETION  
**Scope:** GPT-P0-5 from AR-1153 only. Reuse existing lifecycle, assignment, ranking, audit, and runtime authorities; do not build a second strategy-management stack.

---

# 1. DECISION

P0-5 is now frozen as a **bounded strategy-rotation coordinator work order**.

The measured repository finding is:

> **TRADING FORGE ALREADY HAS BOTH SIDES OF STRATEGY ROTATION — HEALTH/DRIFT DEMOTION AND DEPLOYED-STRATEGY ACCOUNT ASSIGNMENT — BUT THE AUDITED PRODUCTION TREE DOES NOT SHOW ONE TRANSACTIONAL, RESTART-SAFE COORDINATOR THAT JOINS THEM.**

The fastest robust path is therefore:

```text
existing health/drift decision
    ↓
existing lifecycle demotion
    ↓
rotation coordinator
    ↓
qualified reserve selection
    ↓
atomic assignment transition
    ↓
runtime reconciliation/reload
    ↓
audit + alert + correlation receipt
```

Do **not** redesign LifecycleService, the assignment service, the PAPER engine, or the 3AM intelligence workflow.

P0-5 remains **not implemented** until worker code/tests are independently verified.

---

# 2. DEMOTION AUTHORITY EXISTS — MEASURED

Primary measured service:

`src/server/services/portfolio-drift-demotion-service.ts`

The service:

- reads real `strategies.rolling_sharpe_30d`;
- evaluates DEPLOYED strategies;
- has a default-OFF dry-run rollout;
- generates a correlation ID;
- uses `LifecycleService` directly;
- can drive `DEPLOYED -> DECLINING -> TESTING`;
- writes audit/notification evidence;
- relies on existing zombie-DECLINING recovery if the second transition fails.

This is a valid lifecycle-demotion authority.

### Ruling

Rotation must consume the canonical lifecycle result/event/state. Do not create another independent `if sharpe < X then rotate` implementation inside a new coordinator.

Health/demotion semantics remain owned by the existing services.

---

# 3. LIFECYCLE SERVICE DOES NOT OWN ACCOUNT ASSIGNMENTS — MEASURED

`src/server/services/lifecycle-service.ts` owns the strategy lifecycle state machine, including:

```text
DEPLOYED -> DECLINING
DECLINING -> TESTING
```

The audited lifecycle service does **not** import or update `accountStrategyAssignments`.

Therefore:

```text
strategy lifecycle demoted
```

is not the same state transition as:

```text
account no longer actively assigned to that strategy
```

That separation is reasonable architecture, but it creates a required coordination join.

### P0-5 law

A strategy that has ceased to be eligible for active execution must not remain silently active merely because its account-assignment row was not reconciled.

---

# 4. ASSIGNMENT AUTHORITY EXISTS — MEASURED

Primary service:

`src/server/services/strategy-assignment-service.ts`

Useful existing behavior includes:

- `assignStrategyToAccount(...)`;
- `unassignStrategy(...)`;
- active-assignment readers;
- pipeline-pause guard on assignment writes;
- account-enabled and firm-scope validation;
- strategy lifecycle check requiring `DEPLOYED` for assignment;
- correlation ID support on assignment audit rows;
- idempotent handling of an existing `(account_id, strategy_id)` pair;
- audit/SSE output.

This service is the assignment semantic authority and should be reused by the coordinator where its primitives are sufficient.

Do not create a parallel assignment table.

---

# 5. TWO ASSIGNMENT INVARIANT GAPS ARE MEASURED

Database migration:

`src/server/db/migrations/0100_account_strategy_assignments.sql`

currently guarantees:

```text
UNIQUE (account_id, strategy_id)
```

This prevents duplicate rows for the same pair.

It does **not** prove:

```text
one active strategy per account
```

or any more specific active-slot invariant.

The service itself exposes both:

```text
getActiveAssignments(accountId)   // plural
```

and:

```text
getActiveAssignment(accountId)    // singular, described as first active row
```

That means autonomous rotation must not assume that “the active strategy” is uniquely defined until the actual production/account model is made explicit.

## 5.1 Required first step

Before adding a unique index, measure the intended account model.

The worker must answer from actual call sites/data contracts:

```text
A. Is one active strategy allowed per account total?
B. Are multiple active strategies intentionally supported per account?
C. If multiple are allowed, what exact slot/key makes a rotation target unique?
   Examples of possible authorities: logical symbol, execution family, sub-account,
   strategy role, or another existing field.
```

Do not guess.

## 5.2 If one-active-per-account is the intended invariant

Add a database-enforced partial uniqueness constraint conceptually equivalent to:

```text
UNIQUE(account_id) WHERE status='active'
```

only after pre-migration duplicate measurement and deterministic reconciliation.

## 5.3 If multiple active strategies are intentional

Do **not** globally prohibit them.

Instead define and persist the real **rotation slot key** and enforce uniqueness on:

```text
(account_id, rotation_slot) WHERE status='active'
```

or the already-existing equivalent.

The coordinator must never use an arbitrary “first active row” as autonomous decision authority.

---

# 6. ASSIGN + UNASSIGN ARE NOT ONE MEASURED TRANSACTION — GAP

In the audited `strategy-assignment-service.ts`, `assignStrategyToAccount(...)` and `unassignStrategy(...)` are separate public operations.

No measured transaction wraps this semantic swap:

```text
old assignment active
+ new qualified strategy chosen
-> archive/disable old
-> activate new
```

This creates two dangerous crash windows if a coordinator simply calls the existing functions sequentially:

```text
archive old
CRASH
new never assigned
```

and, depending on order/model:

```text
assign new
CRASH
old remains active/ambiguous
```

### Ruling

P0-5 requires one transactionally authoritative rotation operation.

Prefer a small new function inside or immediately beside the existing assignment authority, for example semantically:

```text
rotateStrategyAssignment(...)
```

The exact name may follow repository conventions.

It must use one DB transaction for the persistent assignment state transition.

Do not implement the critical swap as unrelated HTTP calls from n8n.

---

# 7. ROTATION COORDINATOR INPUT CONTRACT

The coordinator must receive or resolve a demotion event with immutable lineage:

```text
rotation_correlation_id
triggering_correlation_id
account_id / target slot identity
old_strategy_id
old_assignment_id
old_lifecycle_state
trigger_reason
detected_at
```

It then re-reads current DB truth before acting.

### Stale-event guard

If the old strategy is no longer the active assignment for the target slot, the coordinator must classify the event as already reconciled/stale and stop idempotently.

Never rotate a newer assignment because an older delayed demotion event arrived late.

---

# 8. QUALIFIED RESERVE ELIGIBILITY — REUSE EXISTING AUTHORITIES

A reserve is an **already qualified strategy**, not a strategy invented by the nightly loop.

Minimum eligibility before a reserve can be selected:

```text
lifecycle eligibility is current and production-approved
not the demoted strategy itself
compatible with target account/firm
compatible with target logical symbol / rotation slot
not retired / graveyard / declining / testing / paper-only
not blocked by pipeline/kill/compliance controls
fresh enough under existing lifecycle/revalidation policy
has the execution artifact/config required by the target runtime
```

If the canonical active-assignment service requires `DEPLOYED`, then the coordinator must not bypass that rule by assigning a `DEPLOY_READY`, `PAPER`, `TESTING`, or newly optimized research child.

### MES / MNQ / MCL

Rotation compatibility must preserve the system's first-class strategy roots:

```text
MES
MNQ
MCL
```

A reserve for one logical market must not be silently substituted into another logical market merely because a provider ticker, timeframe, or strategy family looks similar.

Provider listed-contract identities remain feed-layer details and are not reserve identity authority.

---

# 9. RANKING AUTHORITY — DO NOT INVENT A SECOND SCORE

The existing system already exposes PAPER/edge ranking into the nightly intelligence path.

P0-5 must locate the production implementation behind that ranking endpoint and determine whether it is valid for **qualified DEPLOYED reserve ordering**.

Two acceptable outcomes:

### A. Existing ranking is valid for qualified reserves

Reuse it after applying hard eligibility filters.

### B. Existing ranking is not a DEPLOYED-reserve selector

Do not stretch its semantics silently.

Add the smallest deterministic reserve selector over existing versioned metrics/evidence, or stop and return the exact missing ranking join.

### Tie-break law

Any equal-rank reserve set must have a stable deterministic tie-break, e.g. a canonical persisted score tuple followed by stable strategy ID.

Never select “first row returned by DB/API.”

---

# 10. ATOMIC ROTATION CONTRACT

The database transition must be fail-closed.

Conceptual transaction:

```text
BEGIN

lock/re-read target account rotation slot
lock/re-read old assignment
lock/re-read reserve strategy

assert old assignment is still active
assert old strategy is no longer eligible or the triggering transition is still valid
assert reserve is currently eligible
assert reserve is compatible with account + slot + symbol
assert uniqueness invariant

archive/pause old assignment
activate/upsert new assignment
write durable rotation record/audit linkage

COMMIT
```

If any assertion fails:

```text
ROLLBACK
```

Do not partially rotate.

## 10.1 No qualified reserve

If no reserve qualifies:

```text
old ineligible strategy must not remain silently executable
new assignment = NONE
rotation outcome = BLOCKED_NO_RESERVE
operator alert = required
```

Fail closed rather than picking an unqualified strategy.

Whether the old assignment is archived/paused before the no-reserve result must follow the runtime safety invariant: an ineligible/demoted strategy cannot keep trading simply to avoid an empty slot.

---

# 11. RUNTIME RECONCILIATION / RELOAD

A committed DB rotation is not sufficient unless the runtime stops using stale assignment state.

The worker must trace the actual execution consumers of account assignments, including the PAPER/live/export consumers that use active-assignment readers.

Freeze one canonical post-commit behavior:

```text
DB transaction commits
    ↓
runtime receives assignment-change event OR re-reads DB at its existing safe boundary
    ↓
old strategy can no longer generate executable work for the rotated slot
    ↓
new strategy becomes eligible only after all existing gates pass
```

Do not add an unsafe hot-reload mechanism if the runtime already re-reads assignments per decision/session boundary.

The work order requires **proof of freshness**, not a mandated reload technology.

---

# 12. OPEN POSITION SAFETY

A strategy rotation decision must not orphan risk from an already-open position.

Before finalizing the execution semantics, measure whether the target runtime can have open positions when demotion fires.

Required rule:

```text
assignment rotation != permission to abandon an open position
```

Reuse existing force-close/session-close/risk ownership semantics where appropriate.

The coordinator must not create a second exit engine.

If existing policy says demotion flattens first, prove it.
If existing policy says the old strategy remains exit-owner until flat while new entries are blocked, prove and persist that handoff state.

Stop if open-position ownership cannot be determined safely from existing code.

---

# 13. RESTART / DUPLICATE RECONCILIATION

Rotation must be idempotent across:

```text
process crash
scheduler retry
duplicate lifecycle notification
SSE redelivery
n8n retry
DB reconnect
```

Minimum durable rotation identity:

```text
rotation_id
correlation_id
triggering_correlation_id
account_id
rotation_slot
old_assignment_id
old_strategy_id
new_strategy_id | null
status
created_at
committed_at
```

Statuses may follow repo style but must distinguish:

```text
PENDING
COMMITTED
BLOCKED_NO_RESERVE
STALE_ALREADY_RECONCILED
FAILED
```

A duplicate invocation after COMMITTED must return/reconstruct the same committed outcome, not choose a second reserve.

---

# 14. AUDIT / CORRELATION EVIDENCE

The same rotation correlation ID must link:

```text
triggering health/drift evidence
lifecycle demotion
reserve eligibility snapshot
reserve ranking decision
old assignment archival/pause
new assignment activation
runtime reconciliation
operator alert / no-reserve alert
final rotation outcome
```

Reuse `audit_log` and existing correlation plumbing where sufficient.

Do not create a second generic audit system.

A small purpose-built rotation receipt/table is acceptable only if needed for transactional/idempotent state; it should reference existing audit rows rather than duplicate their full content.

---

# 15. REQUIRED RED -> GREEN TEST MATRIX

The worker must test the real coordinator/assignment/lifecycle seams.

Minimum matrix:

| Case | Required outcome |
|---|---|
| demotion with one qualified reserve | old disabled + new active atomically |
| MES slot | MES-compatible reserve only |
| MNQ slot | MNQ-compatible reserve only |
| MCL slot | MCL-compatible reserve only |
| no reserve | fail closed; no unqualified assignment |
| top-ranked reserve becomes ineligible before commit | transaction abort/reselect under defined rule; no stale assign |
| crash before transaction | no state change |
| simulated failure inside transaction | rollback leaves no partial swap |
| retry after committed rotation | same outcome, no second rotation |
| stale duplicate demotion event | idempotent stale classification |
| competing rotation requests | one authoritative winner |
| ambiguous multiple active assignments | refuse until slot authority resolves |
| pipeline paused | assignment writes blocked |
| reserve not DEPLOYED when DEPLOYED is required | reject |
| old assignment already replaced manually | no overwrite of newer operator decision |
| open position present | existing ownership/flatten policy proven, no orphan |
| restart after DB commit before runtime notification | runtime reconciles from DB truth |

## Positive controls

At least these mutations must turn tests RED:

```text
remove eligibility filter
remove atomic transaction
allow stale event to overwrite current assignment
return arbitrary first active assignment
allow cross-symbol MES/MNQ/MCL substitution
```

---

# 16. FASTEST ALLOWED IMPLEMENTATION ORDER

```text
1. Trace active-assignment consumers and decide the real rotation slot invariant.
2. Freeze DB uniqueness rule for that slot; do not guess one-active-per-account.
3. Trace the production reserve/ranking authority.
4. Add one bounded coordinator around existing lifecycle + assignment services.
5. Make persistent old->new swap transactional.
6. Add no-qualified-reserve fail-closed behavior.
7. Add correlation/idempotent rotation receipt.
8. Prove runtime freshness/reconciliation after commit.
9. Prove open-position ownership behavior.
10. Run focused RED->GREEN + affected regressions.
11. Report exact commits/files/tests/evidence.
```

Do not detour into general portfolio optimization, rewrite the lifecycle ladder, redesign broker routing, or create new strategies during a rotation.

---

# 17. STOP CONDITIONS

Stop and report measured evidence instead of improvising if:

```text
A. Multiple active strategies per account are intentional but no stable rotation-slot identity exists.
B. The existing paper/edge ranking cannot semantically rank qualified DEPLOYED reserves and no bounded selector can be defined from existing evidence.
C. The runtime caches assignments with no safe reload/re-read boundary.
D. Open-position ownership after demotion is undefined.
E. Current deployment intentionally permits an ineligible lifecycle state to remain executable.
F. A transactional swap requires redesign of unrelated broker/account architecture.
G. Any proposed shortcut would allow PAPER/TESTING/new optimizer candidates to bypass deployment gates.
```

---

# 18. WORKER REPORT CONTRACT

Claude's implementation report must include:

1. implementation commit SHA;
2. exact files changed;
3. measured rotation-slot invariant;
4. DB constraint/migration evidence if changed;
5. exact reserve eligibility source;
6. exact ranking source/tie-break;
7. exact transaction boundary;
8. no-reserve behavior;
9. MES/MNQ/MCL compatibility evidence;
10. runtime reload/reconciliation evidence;
11. open-position handling evidence;
12. retry/restart/duplicate evidence;
13. correlation/audit evidence;
14. exact tests/commands/pass-fail counts;
15. mutation controls;
16. explicit proof no strategy bypassed the existing lifecycle/deployment gates.

The external advisor must independently inspect the actual commit and tests before marking P0-5 implemented/frozen.

---

# 19. FINAL RULING

The strategy-rotation problem is **not** missing demotion intelligence and **not** missing assignment CRUD.

Those already exist.

The missing safety-critical seam is the coordinator that makes them one deterministic operation:

```text
health says old strategy is no longer eligible
-> lifecycle truth changes
-> exact account/slot is identified
-> qualified reserve chosen deterministically
-> old/new assignment state changes atomically
-> runtime reconciles
-> restart cannot duplicate or reverse the choice
-> audit can reconstruct the whole decision
```

The strongest measured defects to close are:

1. lifecycle demotion currently does not reconcile assignment state;
2. assignment swap is not measured as one DB transaction;
3. DB uniqueness is only `(account_id, strategy_id)`, not a proven autonomous rotation-slot invariant;
4. the code exposes both plural active assignments and a singular first-active reader, so arbitrary-row behavior must not become autonomous authority.

Implementation authorization is granted for this bounded P0-5 work order.

**P0-5 is not yet claimed complete.**
