# GPT EXTERNAL ADVISOR RULING — AR-1181

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / STRATEGY ROTATION CHAOS AMENDMENT  
**V4 stage:** AR / STRATEGY ROTATION  
**Parent packet:** AR-1158 P0-5 Strategy Rotation Coordinator  
**Status:** CURRENT CANDIDATE RECHECKED — AR-1158 STILL OPEN / CHAOS MATRIX FROZEN

## SIMPLE RESULT

GPT rechecked accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`.

AR-1158 remains the correct architecture. Do not redesign it.

Current source still exposes separate assignment operations and no measured transactional `rotateStrategyAssignment(...)` authority. The assignment migration still enforces only:

```text
UNIQUE(account_id, strategy_id)
```

not a proven active rotation-slot invariant.

Therefore the crash windows identified in AR-1158 remain real until implementation proves otherwise.

This AR does not create a second coordinator design. It freezes the exact chaos acceptance matrix the future implementation must pass.

---

# CHAOS ACCEPTANCE MATRIX

## C1 — crash before DB transaction begins

Input: valid demotion event.

Inject crash before rotation transaction.

Required after restart:

- old DB assignment state unchanged;
- event can be retried;
- no reserve assignment created;
- no false success receipt.

## C2 — crash inside transaction after old row update

Inject failure after old assignment is staged inactive but before new assignment insert/update.

Required:

```text
transaction rolls back
old assignment remains exactly pre-rotation
new assignment absent
```

No half-swap is observable after reconnect.

## C3 — crash inside transaction after new row staged

Inject failure after new assignment is staged but before commit.

Required:

```text
ROLLBACK
old/new persistent state returns to exact pre-transaction truth
```

## C4 — process dies immediately AFTER COMMIT but BEFORE runtime notification

This is the most important restart boundary.

Required on restart:

- DB committed state is authority;
- runtime re-reads/reconciles current assignment truth;
- old strategy cannot continue executable work merely because notification/event was lost;
- new strategy is not double-assigned by retry;
- retry classifies original rotation as already committed/reconciled.

Do not rely on an in-memory event as the only bridge from DB to runtime.

## C5 — duplicate demotion event

Deliver the exact same triggering event twice, sequentially and concurrently.

Required:

```text
one rotation outcome
one active target-slot assignment
second event = already_reconciled / duplicate
```

No second reserve is selected because the first retry arrived late.

## C6 — stale event after a newer manual/operator assignment

Sequence:

```text
demotion event for Strategy A queued
operator legitimately assigns Strategy C
old demotion event arrives
```

Required:

- coordinator re-reads target slot;
- sees A is no longer active;
- refuses to rotate C;
- records stale/already-reconciled outcome.

## C7 — two coordinators race for same slot

Start two different valid rotation attempts for same account/slot at the same time.

Required:

- row/slot lock or equivalent transactional fencing;
- exactly one winner;
- second attempt re-reads committed truth and exits safely;
- never two active assignments for the same intended rotation slot.

## C8 — no eligible reserve

Required:

- demoted/ineligible strategy must not silently keep execution authority;
- no unqualified strategy is promoted to fill the hole;
- outcome = `BLOCKED_NO_RESERVE` or canonical equivalent;
- target slot remains safely unassigned/paused as defined by the runtime contract;
- alert/audit is durable.

## C9 — reserve loses eligibility between selection and commit

Select reserve B, then mutate its lifecycle/eligibility before transaction assertion.

Required:

- transaction re-reads reserve truth;
- refuses/rolls back;
- does not trust stale selector output.

## C10 — open position during rotation

If target account/slot has an open position when strategy A is demoted:

- rotation may not orphan management of that position;
- the exact owner of exit/stop/flatten responsibility must remain deterministic;
- new strategy B must not accidentally treat the inherited position as its own fresh entry unless explicitly designed/proven.

The implementation must measure actual runtime semantics before choosing the policy; do not guess.

## C11 — audit write failure

If durable rotation/audit linkage is part of the same safety transaction, injected audit failure must roll back or produce the explicitly designed durable recovery state.

No successful rotation may become unauditable by silently swallowing the only durable receipt write.

## C12 — restart replay

After any committed rotation, restart the service and replay the triggering event.

Required invariant:

```text
same committed assignment truth
no extra assignment
no extra lifecycle transition
no extra executable strategy
```

---

# CURRENT-CANDIDATE NON-FINDINGS

GPT does not claim existing assignment CRUD is generally broken.

Useful existing authorities remain and must be reused:

- DEPLOYED-only assignment guard;
- pipeline-pause guard;
- firm/account checks;
- collaborative-trading safety checks;
- audit/SSE output;
- pair-level idempotency.

The missing proof is the atomic autonomous **swap/coordinator** boundary, not ordinary CRUD.

---

# ORDERING

AR-1138 remains first.
P0-6 live runtime hardening remains immediate Worker 2 priority after activation where required.
AR-1158 + AR-1181 are the frozen rotation implementation/test contract for its later authorized slot.

## Bottom line

**No redesign needed.** AR-1158 is still right.

Tomorrow's worker should prove one thing: a strategy swap is either fully committed or not committed, and a crash/retry can never produce two strategies, no strategy by accident, or stale execution authority.