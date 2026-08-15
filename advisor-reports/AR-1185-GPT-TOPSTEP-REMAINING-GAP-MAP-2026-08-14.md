# GPT EXTERNAL ADVISOR RULING — AR-1185

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / TOPSTEP REMAINING-GAP MAP  
**V4 stage:** DOWNSTREAM EXECUTION ONLY  
**Status:** CURRENT GAP MAP — DO NOT BUILD LIVE TRANSPORT BEFORE ITS GATE

## SIMPLE RESULT

Codex completed a large amount of useful **offline Topstep safety work**. GPT independently rechecked the accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99` against the older go-live register.

The result is:

```text
OFFLINE TOPSTEP MODEL / SAFETY = MUCH STRONGER
LIVE TOPSTEP TRANSPORT          = STILL INTENTIONALLY NOT BUILT
LIVE GO-LIVE CERTIFICATION      = STILL OPEN
```

This is correct ordering. Do not pay for/use Topstep network access just to make the checklist look greener before the semantic, PAPER, runtime, and safety gates are ready.

---

# WHAT CODEX ALREADY SOLVED OFFLINE — REUSE, DO NOT REBUILD

Current `TopstepXOfflineAdapter` at the accepted candidate contains real deterministic models for:

- official order/side/status/position types;
- account-scoped custom-tag idempotency;
- conflicting retry rejection;
- partial + complete fill accumulation;
- duplicate trade suppression;
- overfill rejection;
- out-of-order reconnect replay sorting/convergence;
- long/short position averaging;
- reductions, flips, and flat transitions;
- order cancellation;
- account flatten simulation;
- exact position reconciliation helper.

The tracked `STUB.md` correctly says:

```text
live transport is not implemented
offline ready
broker-router still returns topstepx_not_configured
```

and explicitly forbids wiring the offline simulator into the real broker router.

That boundary is good.

---

# CURRENT GO-LIVE GAP MAP

Legend:

```text
✅ OFFLINE CLOSED      = useful engineering already exists
🟡 PARTIAL             = some protection exists, launch proof still missing
🔴 OPEN                = real safety gap still exists
💳 PAID/NETWORK GATE   = cannot finish truthfully without Topstep API access
```

## GL-1 — Topstep order/fill/position adapter

**Status: ✅ OFFLINE CLOSED / 💳 LIVE OPEN**

Offline order/trade/position behavior is strong and should be reused.

Still missing by design:

- authenticated Topstep/ProjectX REST client;
- WebSocket event ingestion;
- real account discovery;
- real order submission/cancel/flatten;
- actual broker fill/position field mapping;
- Practice handshake.

Current broker router remains fail-closed with `topstepx_not_configured`.

Do not replace that fail-closed branch until paid access + Practice-grade evidence exist.

---

## GL-2 — Full live-order authentication envelope

**Status: 🟡 PARTIAL / 🔴 OPEN**

Current HMAC path is better than the old audit snapshot: it now binds:

```text
account_id
ticker
action
quantity
price
stop_price
timestamp_ms
```

But it does **not** bind all of the old launch requirement fields in that HMAC canonical, notably:

```text
order_type
strategy_id
bar_timestamp
```

Before any public/external live-order HMAC path can authorize capital, the exact economically/semantically meaningful envelope must be frozen and mutation-tested.

Do not assume static-token/Pine scoping closes HMAC-mode gaps; they are different auth classes.

---

## GL-3 — Pine/webhook freshness + duplicate truth

**Status: 🟡 PARTIAL / NEEDS CURRENT FIXTURE RE-GRADE**

Current static-token path has:

- a 2-minute request timestamp replay guard;
- DB-backed bar-timestamp/action dedup when `bar_timestamp` is present;
- fail-closed duplicate response.

Still requires a current end-to-end fixture proving:

- 5m+ alerts are not structurally rejected because bar-open vs bar-close time is confused;
- duplicate inserts fail closed under DB errors/races;
- `bar_timestamp` cannot be omitted by any launch-approved Pine path;
- retry after network ambiguity cannot double-route.

Do not reuse the stale 2026-07 audit conclusion blindly; re-grade the actual generated Pine payload before launch.

---

## GL-4 — strategy lifecycle identity on every live order

**Status: 🔴 OPEN for HMAC programmatic path**

Current static-token path requires `strategy_id`.

Current HMAC path allows `strategy_id` to be absent, and the lifecycle gate runs only when one is present.

The code labels this a backward-compat auth-class carve-out.

That may be acceptable for a narrowly defined privileged admin action, but it is not acceptable as a generic strategy entry bypass.

Before launch:

```text
ordinary strategy order => strategy_id REQUIRED => DEPLOYED/PILOT gate
privileged flatten/admin => separate explicit action/authority
```

Do not use strategy-less generic orders as the escape hatch.

---

## GL-5 — capital checks fail closed

**Status: 🟡 PARTIAL / RE-GRADE REQUIRED**

Prior waves hardened several broker-router/PAPER entry checks, and Codex did not need to rebuild them.

Before live launch, run one current fault-injection matrix through the **actual final route**:

```text
risk/compliance unavailable
DLL unavailable
route-size check throws
pipeline paused
kill switch unavailable
account assignment invalid
```

Entry must refuse. Exit/flatten safety must remain available according to the canonical policy.

Do not declare this closed from old line-number audits.

---

## GL-6 — broker fill + position reconciliation

**Status: 🟡 STRONG OFFLINE / 🔴 LIVE OPEN**

Good existing pieces:

- durable server-mediated order rows;
- fill callback/reconciliation state;
- Codex offline Topstep replay/position truth model;
- duplicate fill suppression;
- current generic drift service.

Remaining hard gaps:

1. `getBrokerPositionSnapshot()` in the actual production reconciliation service still returns `null` and explicitly says drift detection is inert until connected to real broker truth.
2. AR-1175: one-contract generic drift blind spot must be fixed (`default 1` contract tolerance -> exact futures quantity truth).
3. AR-1176: symbol-specific drift can currently be cleared account-wide.
4. Real Topstep fill/position schemas and reconnect ordering need Practice/network proof.

This is a no-go until all four are closed.

---

## GL-7 — durable live order record before routing

**Status: 🟡 PARTIAL / SERVER-MEDIATED PATH STRONGER**

The server-mediated executor now persists a `server_mediated_orders` row at `routed` **before** broker dispatch, then marks acked/needs-reconcile.

That materially improves the old audit state.

Before closing GL-7, prove every launch-approved live entry/exit path uses a durable pre-dispatch authority or explicitly remove/deprecate paths that bypass it.

Do not require the old `production_trades` table name if `server_mediated_orders` is now the canonical lossless replacement; certify semantics, not a stale table name.

---

## GL-8 — PAPER state vs real broker exit ordering

**Status: 🔴 OPEN**

Current server-mediated design still documents and implements:

```text
PAPER entry/exit state changes first
        ↓
live broker route fires afterward / fire-and-forget
```

A failed live exit can therefore leave:

```text
PAPER = flat/reduced
BROKER = still open/unknown
```

`needs_reconcile` is useful containment, but it does not itself prove capital is flat.

Before live launch, define and test the authoritative exit/reconciliation sequencing so the runtime never silently treats local flat as broker flat.

---

## GL-9 — distributed scheduler leadership/fencing

**Status: 🔴 OPEN / NOT CLOSED BY CODEX TOPSTEP WORK**

No evidence from this Topstep/offline packet closes the older multi-process scheduler-leadership requirement.

Before autonomous live execution, prove two service instances cannot run capital-affecting scheduled jobs twice and that a hung leader can be fenced safely.

Do not infer this from per-process `Set`/locks.

---

## GL-10 — ambiguous network-order truth recovery

**Status: ✅ OFFLINE MODEL STRONG / 💳 LIVE OPEN**

Codex proved useful offline reconnect replay convergence and idempotency behavior.

Still missing the real network question:

```text
POST order
network times out
was order accepted or not?
```

The live Topstep client must query authoritative order/trade truth before retrying. Never convert timeout into "probably failed" or blindly resubmit.

Practice fault injection is required.

---

## GL-11 — token rotation + exact account kill/flatten scope

**Status: 🟡 PARTIAL / OPEN**

Existing code has meaningful account/correlation safeguards, and Codex built offline account-scoped Topstep behavior.

Still require launch proof for:

- credential rotation without unsafe downtime;
- compromised credential revocation;
- exact account targeted by force-close/flatten;
- multi-account Topstep does not flatten sibling account accidentally;
- reconnect after credential expiry cannot duplicate an order.

---

## GL-12 — production security/readiness

**Status: 🔴 OPEN, ACTIVE GPT FINDINGS**

Current open items now have exact packets:

- **AR-1178:** `AUTH_DEV_BYPASS=true` can bypass auth even under production NODE_ENV; must become explicit local-only and production-boot-invalid.
- **AR-1173:** unhandled promise rejection logs and continues instead of entering existing fatal graceful-shutdown/restart path.
- **AR-1169/P0-6:** live `/api/health` identity/watchdog/cold-start/recovery still needs actual deployment witnesses.
- **AR-1179:** tracked operational `tmp-n8n/` dump surface recorded a hardcoded token-pattern hit; value-safe scan/rotation disposition required.

Do not call execution launch-ready until these are closed/reconciled.

---

# NEW CROSS-CUTTING CRITICAL — AR-1184 ACCOUNT IDENTITY

The old GL list did not capture the current multi-account asymmetry precisely enough.

At the accepted candidate:

```text
PAPER -> live ENTRY
selects first enabled broker account for the firm (LIMIT 1)

PAPER -> live EXIT
correctly refuses when strategy+firm maps to multiple accounts
```

This can route an entry to one Topstep account and later suppress the exit as ambiguous.

**AR-1184 is a mandatory pre-live gate.**

Explicit account identity must be conserved from PAPER/execution context through entry, fill reconciliation, and every exit.

---

# WHAT CAN BE DONE WITHOUT PAYING FOR TOPSTEP

Do these offline first:

```text
AR-1178 production auth bypass
AR-1175 exact quantity reconciliation
AR-1176 symbol-scoped reconcile clear
AR-1184 explicit account identity + no-egress parity
GL-2 full HMAC envelope
GL-4 no generic strategy-less live entry
GL-5 final fault matrix
GL-7 durable-path census
GL-8 exit ordering/reconciliation architecture + offline faults
GL-9 scheduler leadership/fencing
CI/security/P0-6 runtime hardening
```

No paid API is needed for those.

---

# WHAT REQUIRES TOPSTEP API / PRACTICE ACCESS LATER

Only after earlier gates are green:

```text
real auth/account discovery
real order submit/cancel/flatten
real WebSocket order/trade events
real position snapshots
real field mapping
network-timeout ambiguous-order recovery
credential expiration/reconnect
Practice fill/slippage/rejection behavior
1-micro final pilot only after full certification
```

Do not mix Practice proof with funded/live capital proof.

---

# CORRECT FUTURE ORDER

```text
AR-1138 semantic closure
        ↓
GPT grade
        ↓
two-worker activation
        ↓
P0-6 live-machine hardening
        ↓
o-egress execution safety gaps
        ↓
qualification + PAPER proof
        ↓
Topstep paid/Practice transport implementation
        ↓
full network/reconnect/fill/position certification
        ↓
GO / NO-GO
        ↓
only then 1-micro pilot
```

## Bottom line

Codex saved substantial time: **do not rebuild the Topstep state machine.**

What remains is mostly the hard part that cannot be faked offline: exact account identity, production fail-closed controls, live transport, broker truth, ambiguous-network recovery, and final Practice/live certification.

**Topstep network remains CLOSED.**