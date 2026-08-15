# GPT EXTERNAL ADVISOR RULING — AR-1174

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / RECONNECT + CRASH STATIC AUDIT  
**V4 stage:** AR / EXECUTION SAFETY SUPPORT  
**Status:** FINDING CONFIRMED — ACTIVATION REMAINS GATED

## SIMPLE RESULT

Trading Forge contains a substantial network-failover state machine, but at accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99` the monitor is **intentionally not started**.

That was a correct prior safety decision: repo comments record that activating it would wake a real global kill-switch Layer 4 path that had not been safely scoped/operated, while the documented tether-recovery API does not exist.

However, the dormant module still initializes its internal state to `PRIMARY_HEALTHY`, and `getNetworkFailoverStatus()` returns that state with `lastCheckedAt=null`.

So there are two separate facts that must never be confused:

```text
NETWORK FAILOVER CODE EXISTS = YES
NETWORK FAILOVER MONITOR ACTIVE = NO
NETWORK CONNECTIVITY MEASURED HEALTHY = NOT PROVEN
```

---

## VERIFIED EVIDENCE

### 1. Monitor activation is deliberately withheld

`src/server/index.ts` explains that `startNetworkFailoverMonitor()` was found dormant and briefly considered for activation, but was reverted because:

- `isConnectivityDegraded()` is consumed by production kill-switch Layer 4;
- Layer 4 is system-wide/unscoped;
- activation would therefore wake a real never-before-exercised halt path;
- the documented `POST /api/admin/network-failover/confirm-tethering` recovery route does not exist.

The boot path starts `startComputeFailoverMonitor()` but does not start the network monitor.

### 2. Dormant state defaults to healthy-looking value

`src/server/lib/network-failover.ts` initializes:

```ts
let _state: NetworkState = "PRIMARY_HEALTHY";
let _lastCheckedAt: Date | null = null;
let _initialized = false;
```

`getNetworkFailoverStatus()` returns `state: getNetworkState()` and `lastCheckedAt`, but no `monitorActive` / `initialized` / `authority` field.

Therefore an unstarted monitor can expose:

```text
state = PRIMARY_HEALTHY
lastCheckedAt = null
```

The health endpoint includes this diagnostic snapshot.

### 3. Documented recovery route remains absent

Current repo search for `confirm-tethering` resolves docs, module comments/tests, and the dormant-activation explanation, but no mounted admin route implementation.

---

# DO NOT 'FIX' BY SIMPLY STARTING THE MONITOR

That would be unsafe.

The previous grader correctly identified that activation changes actual trading authority through kill-switch Layer 4.

This audit therefore separates **observability repair** from **behavior activation**.

---

# PACKET A — SAFE OBSERVABILITY REPAIR

This can be done without activating Layer 4.

Add explicit diagnostic authority to `NetworkFailoverStatus`, for example:

```text
monitorActive: boolean
measurementAuthority: "measured" | "not_started" | "stale"
```

Rules:

- `_initialized === false` => `monitorActive=false`, authority=`not_started`.
- no successful/failed probe has completed => never present the diagnostic as measured healthy.
- keep the existing legacy `_state` value untouched for now so this packet cannot accidentally alter kill-switch semantics.
- health/dashboard consumers must visibly distinguish `PRIMARY_HEALTHY` default state from a measured healthy result.

### RED proof

Reset module without starting monitor.

Current behavior:

```text
state PRIMARY_HEALTHY
lastCheckedAt null
no explicit inactive authority
```

### GREEN proof

Same fixture after repair:

```text
monitorActive false
measurementAuthority not_started
lastCheckedAt null
```

Start monitor with controlled successful probe:

```text
monitorActive true
measurementAuthority measured
lastCheckedAt non-null
```

Mutation control: force `_initialized=false` while preserving `_state=PRIMARY_HEALTHY`; test must still refuse to call the status measured healthy.

---

# PACKET B — FUTURE BEHAVIOR ACTIVATION, STILL CLOSED

Do not activate until all of these are proven together:

1. Decide whether Layer 4 is intentionally global or must be account/broker scoped.
2. Build/verify a real recovery/control route or remove the false documentation and define the actual autonomous recovery mechanism.
3. Prove ISP outage vs broker-side outage classification.
4. Prove outage cannot duplicate orders during reconnect.
5. Prove recovery does not automatically reopen/duplicate a previously rejected signal.
6. Prove stale monitor state after process restart is deterministic.
7. Prove alert + recovery audit trail.
8. Positive control: real injected connectivity failure reaches intended halt/annotation behavior.
9. Negative control: broker-side outage does not falsely claim USB tethering fixes it.
10. Restart control: service restart during FAILOVER_ALERT cannot silently return to measured `PRIMARY_HEALTHY` without a fresh probe.

No Topstep network access is required for this packet; use controlled local/offline adapters until later explicit authorization.

---

# RELATION TO CODEX WORK

Do not duplicate Codex's completed offline Topstep reconnect replay/idempotency work.

This finding concerns the separate Trading Forge **network-failover authority/state machine and its dormant activation boundary**.

---

# ORDERING

AR-1138 remains first.

P0-6 live deployment remains higher immediate Worker 2 priority after two-worker activation.

This packet is prepared so later reconnect hardening does not start by rediscovering why the network monitor is dormant.

## Bottom line

**CONFIRMED:** network failover is built but intentionally dormant, and dormant diagnostics can look `PRIMARY_HEALTHY` without a measurement.

**SAFE NEXT FIX:** make diagnostic authority explicit first.

**DO NOT START THE MONITOR YET:** behavioral activation requires scoped halt/recovery/reconnect proof.