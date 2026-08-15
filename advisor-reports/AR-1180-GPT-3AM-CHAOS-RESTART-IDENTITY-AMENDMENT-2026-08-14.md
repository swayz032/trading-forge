# GPT EXTERNAL ADVISOR RULING — AR-1180

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / 3AM CHAOS AMENDMENT  
**V4 stage:** AR / NIGHTLY EVIDENCE  
**Parent packet:** AR-1157 P0-4 3AM durable receipt join  
**Status:** CURRENT CANDIDATE RECHECKED — ADD RESTART/DUPLICATE CONTROLS, DO NOT BUILD NEW NIGHTLY SYSTEM

## SIMPLE RESULT

GPT rechecked the canonical 3AM workflow at accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99`.

The correct centerline remains:

`workflows/n8n/14A-master-nightly-intelligence_Nk4pmHP6c0VOEOaT.json`

It still schedules:

```text
0 3 * * *
```

and already uses daily idempotency keys on major organ calls and report delivery.

Do not create a second 3AM scheduler.

### New chaos finding

`Init Run` creates a fresh random `correlation_id` on every n8n execution:

```text
14a-<current-time>-<random>
```

while the side-effect idempotency keys are date based, for example:

```text
14a:regime:<date>
14a:leak:<date>
14a:decay:<date>
14a:rank:<date>
14a:report:<date>
```

At the current candidate, GPT finds no `$execution.id` use and no durable receipt write in the workflow.

Therefore a crash/restart on the same scheduled day can produce:

```text
attempt 1
correlation_id = A
some daily-idempotent organs complete
process/workflow dies

attempt 2
correlation_id = B
same daily side-effect keys replay/dedupe
remaining work continues

result:
side effects may be one-per-day
BUT evidence is split across A and B
AND there is no durable canonical receipt joining both attempts
```

This does not invalidate AR-1157. It sharpens the exact restart/duplicate contract the implementation must satisfy.

---

# REQUIRED IDENTITY MODEL

AR-1157 already requires actual `n8n_execution_id` plus durable correlation/provenance.

Add one stable logical identity for the scheduled run slot, separate from attempt identity.

Recommended semantics:

```text
nightly_slot_id = workflow identity + scheduled local date/slot
execution_attempt_id = actual n8n $execution.id
correlation_id = trace identity for that attempt
```

A retry/recovery of the same 3AM slot must attach to the same durable slot receipt rather than creating a second independent business receipt.

Do not make `correlation_id` deterministic if that would destroy per-attempt tracing. Keep slot identity and attempt identity separate.

---

# DURABLE RETRY RULE

For each logical 3AM slot:

```text
ONE canonical receipt
MANY possible attempt records
ONE final composite verdict
```

Suggested uniqueness:

```text
UNIQUE(workflow_name, scheduled_for_slot)
```

with child attempt records or structured attempt history keyed by actual n8n execution ID.

The exact schema may reuse an existing receipt/audit authority if it can express this losslessly.

---

# REQUIRED CHAOS TESTS

## Chaos 1 — crash after first organ

Simulate:

```text
receipt slot created
regime completed
process dies before leak/decay/ranking/report
```

On retry:

- same slot receipt is resumed/reconciled;
- new n8n execution ID is recorded as a second attempt;
- successful already-idempotent side effects are not duplicated;
- missing organs run or are explicitly marked failed/not-run;
- final receipt cannot claim full PASS unless all required evidence is present.

## Chaos 2 — crash after report delivery but before final receipt close

On retry:

- `14a:report:<date>` prevents duplicate delivery if the receiving endpoint honors the idempotency contract;
- receipt recovery queries/reconstructs delivery outcome rather than blindly posting a second report;
- final receipt records whether delivery was proven, unknown, or failed.

If the receiver cannot prove prior idempotency consumption, mark delivery state UNKNOWN and fail closed on evidence; do not invent success.

## Chaos 3 — duplicate scheduler fire

Start two attempts for the same slot concurrently.

Required:

```text
one logical slot receipt
no duplicate mutation/report side effects
both execution attempts durably visible
one authoritative finalizer
```

Use DB uniqueness/transactional authority, not an in-memory Set.

## Chaos 4 — database unavailable at receipt start

Required:

- no optimizer/mutation branch may proceed without durable run authority;
- reporting may use the existing fallback only if policy explicitly permits it, but it must not be called a fully evidenced 3AM PASS;
- retry remains possible after DB recovery.

## Chaos 5 — n8n restart at 02:59–03:01 local time

Prove the schedule semantics produce either:

```text
one recovered slot
```

or a clearly recorded missed-slot failure.

No silent double-run and no silent missing day.

---

# KEEP AR-1157 LAWS

Still required:

- actual n8n execution identity;
- durable Trading Forge receipt independent of n8n retention;
- MES/MNQ/MCL coverage;
- organ status reducer;
- GPT vs fallback report lineage;
- persist receipt before/independent of delivery;
- frozen PAPER candidate before/after immutability firewall.

This AR only adds restart/concurrency semantics.

---

# SEPARATE 8AM ROUTE OBSERVATION

`src/server/routes/openclaw-daily-report.ts` is a different 8AM report path. Its header claims "Idempotent per day" but the route itself contains no visible dedupe persistence/check; that should be audited later as a separate reporting hygiene issue.

Do not confuse it with canonical 14A 3AM P0-4.

---

# ORDERING

AR-1138 remains first semantic gate.
AR-1157 + this amendment remain prepared Worker 2 work after activation and higher-priority runtime gates permit.

## Bottom line

**3AM system is not greenfield.** Existing date-keyed side-effect dedupe is useful.

**Missing chaos law:** retries need one stable logical nightly-slot receipt with separate actual execution attempts, so a crash cannot split one night's truth across unrelated correlation IDs.