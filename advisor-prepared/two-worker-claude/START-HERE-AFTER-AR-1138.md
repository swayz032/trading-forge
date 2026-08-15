# CLAUDE TWO-WORKER START CARD — AFTER AR-1138

**Purpose:** one-screen startup card. Read this before long advisor history.

## HARD GATE

Do not activate two-worker mode until:

```text
AR-1138 finished
-> tests/evidence
-> commit + push + worker report
-> GPT independent PASS
-> distinct Worker 1 / Worker 2 onboarding identities installed + proven
```

Until that gate passes, Worker 1 resumes AR-1138 and Worker 2 does not start production work.

## WORKER 1

```text
ID: worker-1
ROLE: Trading Forge Worker 1 / Agent Teams Lead
LANE: COMPILER-FACTORY
MISSION: Graph Engineering -> Compiler -> Strategy Factory
```

Startup order:
1. invoke Worker-1-specific onboarding identity;
2. invoke canonical `worker-execution` skill explicitly;
3. print worker_id / role / lane / active order / branch / worktree / teammate;
4. load only Worker 1 lane manifest + active order + referenced evidence;
5. check teammate messages;
6. execute one bounded order.

First order before activation remains **AR-1138**.

After GPT accepts AR-1138, Worker 1 stays on GE/Compiler/Strategy Factory. The first end-to-end proof target is **AR-1183**, using the accepted AR-1138 strategy as the golden candidate when the compiler/factory path is runnable.

Worker 1 must not take PAPER/runtime/execution-safety semantic ownership without explicit cross-lane handoff.

## WORKER 2

```text
ID: worker-2
ROLE: Trading Forge Worker 2 / Runtime & Execution Engineer
LANE: PAPER-RUNTIME-SAFETY
MISSION: PAPER -> Qualification Ops -> Autonomous Runtime -> Execution Safety
```

Startup order:
1. invoke Worker-2-specific onboarding identity;
2. invoke canonical `worker-execution` skill explicitly;
3. print worker_id / role / lane / active order / branch / worktree / teammate;
4. load only Worker 2 lane manifest + ONE authorized packet + referenced evidence;
5. check teammate messages;
6. execute one bounded order.

Default post-activation triage priority, subject to GPT authorization one packet at a time:

```text
1. AR-1178  production dev-auth bypass hardening        [tiny / critical]
2. AR-1175  one-contract reconciliation blind spot     [small / capital safety]
3. AR-1176  symbol-scoped reconcile clear              [small / capital safety]
4. AR-1173  fatal unhandled-rejection restart path     [small / autonomy]
5. AR-1184  explicit PAPER->broker account identity    [larger / must precede broker egress]
6. AR-1177  exact release-SHA full-lane authority      [launch gate]
7. AR-1174  honest dormant network-failover status     [observability before activation]
8. AR-1154/1155/1156/1157+1180/1158+1181 as authorized
```

AR-1179 is a credential-containment/security incident lane: if a potentially live secret is confirmed, rotate/revoke first, then clean the tracked scratch surface. Never copy secret bytes into reports.

Worker 2 must not reinterpret source strategy semantics or modify Worker 1 compiler authority to make runtime tests pass.

## GLOBAL LOCKS

```text
BROKER EGRESS: OFF
TOPSTEP LIVE TRANSPORT: OFF / topstepx_not_configured
NO CLAUDE TOPOLOGY CHANGE MID-AR-1138
NO SHARED WORKTREE
NO SHARED IDENTITY-BEARING ONBOARDING
ONE BOUNDED ACTIVE ORDER PER WORKER
GPT GRADES REPOSITORY EVIDENCE, NOT REPORT PROSE
```

## FAST COMPLETION RECEIPT

Every packet ends with:

```text
worker_id
active_order
base_sha
result_sha
touched_files
RED command + result
GREEN command + result
positive/negative/mutation control when required
build/full-lane result when required
commit
push proof
cross-lane dependency message if any
STOP for GPT review when gated
```
