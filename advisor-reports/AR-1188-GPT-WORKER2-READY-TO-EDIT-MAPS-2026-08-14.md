# GPT EXTERNAL ADVISOR RULING — AR-1188

**Date:** 2026-08-14  
**Type:** CONTROL / CLAUDE ACCELERATION / READY-TO-EDIT MAPS  
**Status:** STAGED / NO PRODUCTION CODE CHANGED  
**Branch:** `external-advisor/gpt-rulings`

## DECISION

GPT completed the next acceleration layer requested after AR-1187.

Five highest-priority Worker 2 packets are no longer merely "ready to research." They now have bounded **ready-to-edit implementation maps** identifying the exact production seam, existing test surface, required RED witness, smallest repair, forbidden detours, GREEN commands, controls, mutation witness, and expected touched-file boundary.

AR-1138 remains the first semantic gate. These maps do not authorize Worker 2 before AR-1138 GPT acceptance + distinct two-worker activation proof.

## MAPS STAGED

### AR-1178 — production dev-auth bypass

Path:
`advisor-prepared/two-worker-claude/implementation-maps/AR-1178-AUTH-DEV-BYPASS.md`

Fast path:

```text
src/server/middleware/auth.ts
+ existing auth middleware test
-> RED: production + AUTH_DEV_BYPASS=true must refuse
-> repair: explicit flag AND NODE_ENV=development
-> GREEN + mutation
```

No new auth subsystem.

### AR-1175 — one-contract reconciliation blind spot

Path:
`advisor-prepared/two-worker-claude/implementation-maps/AR-1175-ONE-CONTRACT-DRIFT.md`

Fast path:

```text
fill-reconciliation-service.ts
+ existing fill-reconciliation.test.ts
-> RED: server 1 MES / broker 0 MES must drift
-> default qty tolerance = 0
-> safe finite env parsing
-> GREEN + long/short controls + mutation
```

No broker network work.

### AR-1176 — symbol-scoped reconcile clear

Path:
`advisor-prepared/two-worker-claude/implementation-maps/AR-1176-SYMBOL-SCOPED-RECONCILE-CLEAR.md`

Fast path:

```text
fill-reconciliation-service.ts
+ fill-callback.ts
+ existing reconciliation test
-> RED: clearing MES must not clear MNQ
-> require symbol in normal clear
-> bind symbol into HMAC
-> account-wide entry block remains conservative
```

No wildcard normal clear.

### AR-1173 — unhandled rejection fatal teardown

Path:
`advisor-prepared/two-worker-claude/implementation-maps/AR-1173-UNHANDLED-REJECTION-FATAL-TEARDOWN.md`

Fast path:

```text
index.ts existing unhandledRejection handler
-> RED: unknown rejection must request fatal teardown once
-> reuse existing gracefulShutdown
-> no second shutdown subsystem
```

At most one tiny test seam is allowed if needed to exercise the real handler policy without booting the full server.

### AR-1184 — PAPER/live account identity

Path:
`advisor-prepared/two-worker-claude/implementation-maps/AR-1184-PAPER-LIVE-ACCOUNT-IDENTITY.md`

This is intentionally split:

#### Phase A — fast immediate safety repair

```text
paper-signal-service entry resolver
currently: first enabled account for firm LIMIT 1
repair: use active strategy assignment authority
0 matches -> refuse
1 match -> exact account
>1 matches -> refuse
```

This removes silent wrong-account entry routing without a migration.

#### Phase B — later definitive multi-account support

Before multi-account broker egress, persist one explicit broker account identity through:

```text
launch/session
-> entry
-> server_mediated_orders
-> fill reconciliation
-> exits/modifies/flatten
```

Phase B is NOT automatically bundled into Phase A.

## RECOMMENDED WORKER 2 MICRO-ORDER AFTER ACTIVATION

One bounded packet at a time:

```text
1. AR-1178
2. GPT grade
3. AR-1175
4. GPT grade
5. AR-1176
6. GPT grade
7. AR-1173
8. GPT grade
9. AR-1184 Phase A
10. GPT grade
```

This ordering prioritizes security + capital truth + autonomous crash safety while keeping patches small and independently gradeable.

AR-1184 Phase B remains separately gated before any true multi-account broker egress.

## SPEED IMPROVEMENT

Worker 2 no longer needs to spend its first context window answering:

```text
where is the bug?
which function owns it?
which test file should I open?
what should RED look like?
what architecture must I avoid?
```

The intended worker loop is now:

```text
onboard identity
-> read START-HERE
-> read EXECUTION-QUEUE
-> open ONE ready-to-edit map
-> open listed production/test files
-> run listed RED
-> make bounded fix
-> GREEN + controls
-> commit/push/report
-> STOP for GPT
```

## LOCKS PRESERVED

```text
AR-1138 FIRST
Worker 2 GATED until AR-1138 GPT PASS + identity activation receipt
Agent Teams activation still gated
broker egress OFF
Topstep live transport OFF
do not duplicate Codex work
no source-semantic changes from Worker 2
one active order per worker
```

## BOTTOM LINE

The top Worker 2 queue is now **ready to edit, not ready to research**.

That is the highest-leverage safe acceleration GPT can provide before Claude quota returns: remove research/context tax without weakening RED/GREEN proof, mutation controls, ownership boundaries, or independent GPT grading.
