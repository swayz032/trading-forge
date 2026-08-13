# AR-1142 — GPT PARALLEL PRE-AUDIT: NO-CLAUDE AUTONOMY + DEADLINE SPEED MAP

**Date:** 2026-08-13  
**Branch:** `external-advisor/gpt-rulings`  
**Purpose:** remove downstream surprises while the Claude worker is quota-paused, without modifying or redirecting the worker's unfinished AR-1138 compiler/grading files.

## 0. Non-collision rule

The worker's current local AR-1138 state remains authoritative for the compiler lane. This report is a parallel pre-audit only.

- Do not restart AR-1138 from scratch.
- Do not modify the worker's unfinished compiler/grading implementation from the advisor lane.
- Do not insert Context Edge, Visual Intelligence expansion, UI work, or broad refactors ahead of the compiler proof.
- Use this report to pre-clear the **Autonomous Runtime** and **Qualification** stages of V4 while the compiler lane remains paused.

V4 authoritative chain remains:

```text
GRAPH ENGINEERING
-> COMPILER
-> STRATEGY FACTORY
-> CONTEXT OBSERVER
-> QUALIFICATION
-> AUTONOMOUS RUNTIME
```

## 1. Reusable foundations already evidenced in repository history

These are not reasons to declare production readiness. They are reasons **not to rebuild from zero**.

### A. Learning-loop mode separation exists

Commit `ef94a48db0158d4551362fa4eacdd80aeda391af` introduced the three-mode learning-loop contract:

- OFF;
- OBSERVE = advisory intelligence, no autonomous mutation;
- AUTOPILOT = mutation-capable loops behind the autonomous gate.

The commit explicitly states the 14A nightly workflow was split so advisory organs run under `advisory_on` while mutation remains behind `autonomous_on`.

**Reuse decision:** PAPER should use OBSERVE/advisory behavior; do not design a second nightly brain.

### B. Paper restart durability has a real foundation

Commit `c4a730d0fd0cadfae1dcd7f45fba62d2146cb4a7` persisted the paper pending-entry queue and added boot rehydration evidence, specifically so a restart between signal and fill does not silently drop the trade. It also replaced unseeded fill randomness with deterministic seeded behavior and carried feed/certification labels.

**Reuse decision:** certify this path in the no-Claude drill; do not build a second pending-entry mechanism.

### C. Strategy demotion exists and has been hardened

Commit `f8fbcadf9cc7378ac6f685d23ece2f514887a04e` added in-process portfolio-drift auto-demotion, and later commit `2d42feb1a78e4002dca0e027ef5cf67e08221b41` corrected false-success notifications so a demotion is only reported after the lifecycle transition actually completes.

Additional demotion-path correctness work exists in commits including `a25022bd7b3d1b296d5748b36f722f7b438cd4e4`, `6a1419c0b740e73b9ee5a3fad13330710b16c9dc`, `befd4c3b568ac4791cdb52c8c25de66a34674b1d`, and `180065cde78a7c3b877464384cc5e3bb605eb783`.

**Reuse decision:** strategy health/decay should feed the existing lifecycle machinery; do not invent a parallel decay controller.

### D. Scheduler/autonomy hardening exists

Commit `b65cfb7524291b0695c3eb988ad6d2b84fc5ff6f` forced the scheduler's cron interpretation to UTC after proving many DST-paired autonomous safety jobs were silently dead under process-local timezone behavior.

Commit `04927bd3ce8ddc60f49ccf3cc1493c63f2dbf23b` fixed a scheduler registration defect that could prevent missed-run reconciliation, active-paper-session resume, and agent coordination on some restarts.

**Reuse decision:** no new scheduler. Certify the existing scheduler on the exact deployment environment.

### E. Failure-injection evidence exists for part of the autonomy stack

Commit `db24ffd860586ff6d9b65af8d4159d79683a6d78` added 42 failure-injection tests covering major capital-safety and self-heal states including DLL/trailing-DD force-close, dead-man heartbeat recovery, boot migration fail-closed behavior, compliance enforce defaults, and frozen-policy drift blocking.

**Reuse decision:** extend from these existing failure modes; do not replace them with prose checklists only.

### F. Recovery/watchdog work exists but must be distinguished from live activation

Commit `1f8290d34421c2cfe5d46d7faa9bb97b81305a0a` records a cold-recovery drill as built-complete while explicitly leaving the actual rebuild-the-box drill operator-held.

Commit `6173a538ddb05144afaee419eac1beae3da2a2fa` built and tested an external API-liveness watchdog but explicitly said it was **NOT registered** at that point.

**Reuse decision:** verify current activation state before claiming unattended recovery. Built code is not the same thing as active deployment.

### G. n8n health honesty was hardened

Commit `6d0efd0e0b0e4414c93e19cb60fa023c33e4a056` closed false-green cases where empty n8n execution evidence could be misread as healthy and where an unreachable n8n API could be confused with real workflow drift.

**Reuse decision:** the no-Claude acceptance test must require fresh live n8n evidence; repo/static evidence alone is insufficient.

## 2. Highest-value gap found by this pre-audit

### P0 GAP — the complete automatic strategy replacement chain is NOT YET PROVEN

Repository evidence strongly supports automatic strategy **demotion** and lifecycle transitions. This audit has **not** yet found end-to-end proof for the complete unattended rotation:

```text
active strategy confirmed decayed
-> active strategy demoted/removed from active duty
-> eligible qualified reserve population loaded
-> correct replacement chosen by deterministic policy
-> assignment/routing updated atomically
-> old strategy cannot keep firing
-> new strategy becomes active only after required gates
-> runtime/restart reconciliation confirms exactly one authoritative assignment
-> audit/alert proves what changed and why
```

This is deliberately recorded as **UNPROVEN**, not absent. Search/commit evidence did not establish the whole chain as one tested production path.

### Fastest correct next action for this gap

Do **not** build replacement logic from scratch first.

1. Trace the existing lifecycle, account-strategy assignment, ranking/health, family-release, and runtime-load paths.
2. Produce a one-page call graph identifying the current authority for each arrow above.
3. If the chain already exists, write one end-to-end failure-injection/integration witness proving it.
4. If one join is missing, repair only that first measured join.
5. Require idempotency/CAS semantics so a restart or duplicate event cannot activate two replacements.
6. No auto-swap may promote an unqualified challenger just because the active strategy decayed.

This is a **P0 no-Claude autonomy blocker** before unattended post-subscription operation.

## 3. PAPER / no-Claude blockers to certify, not redesign

### P0-1 — live 3AM readiness evidence

Before PAPER Day 1, prove on the actual deployed stack:

```text
scheduled run
-> learning loop resolves OBSERVE/advisory mode
-> analyses execute or fail loudly
-> report/fallback produced
-> correlation/idempotency trace survives
-> report is durably persisted/posted
-> retry/fallback behavior observable
-> mutation/autonomous path remains disabled for the frozen PAPER strategy
```

A committed 14A JSON or historical success is not enough.

### P0-2 — no-Claude cold restart drill

On the deployment intended to survive the subscription ending:

```text
stop/restart services or machine
-> services return without Claude
-> scheduler resumes
-> market/data state reconnects or fails closed
-> active PAPER/runtime assignment reloads exactly once
-> pending entry/position state reconciles
-> no duplicate order/signal is created
-> risk/kill-switch state survives or is re-established conservatively
-> n8n/report path returns
-> operator sees one simple health verdict
```

Claude Code must not appear in any mandatory step.

### P0-3 — PAPER isolation + transition authority

Use existing paper isolation and lifecycle code; prove the exact candidate under qualification cannot accidentally egress through a funded/live-capital route. Promotion/transition must be explicit, audited and gated.

### P0-4 — health truth, not green-by-default

The unattended system must distinguish at least:

- GREEN: verified healthy;
- YELLOW: degraded/unknown but fail-safe;
- RED: trading blocked/flattened/invalid qualification.

Unknown evidence must not render green.

## 4. Fast engineering allocation while the worker remains quota-paused

### Advisor/GPT lane — authorized now

1. Continue tracing the full decay-to-replacement call graph.
2. Trace exact paper boot/recovery joins and identify whether any runtime state remains memory-only.
3. Trace the exact 3AM report persistence path and list what must be live-smoke-tested.
4. Trace autonomous runtime startup dependencies and identify any hidden manual/Claude step.
5. Trace compiler downstream joins only far enough to identify future blockers; do not edit AR-1138 files.
6. Convert each discovered gap into the **smallest measured work order**, not a broad redesign.

### Claude worker lane — when quota resets

First action remains unchanged:

1. preserve current local AR-1138 work;
2. continue real sVkm grading exactly where paused;
3. certificate if evidence permits;
4. proceed to §9.2 production vertical;
5. report the completed decision point for independent advisor review.

Do not consume the fresh quota rebuilding this autonomy audit unless repository evidence has materially changed.

## 5. Deadline speed rule

The August goal requires margin before the final backstop. Therefore every engineering task must answer:

> Does this move the six-stage V4 chain closer to a qualified, unattended runtime, or remove a measured blocker on that path?

If no: defer it.

Priority:

```text
P0 compiler breakthrough
-> P0 faithful executable candidates
-> P0 credible edge / qualification
-> P0 3-5 day PAPER
-> P0 no-Claude autonomy proof
-> early downstream operational proving window
```

The Context Observer stays read-only during source-faithful screening and frozen PAPER. Visual Intelligence remains supporting capability only when a measured gap requires it.

## 6. Current pre-audit verdict

- **Compiler lane:** do not interfere; AR-1138 remains the worker's active unfinished job.
- **No-Claude architecture:** substantial reusable machinery exists; rebuilding from zero would be wasteful.
- **Paper restart durability:** real foundation exists; requires deployment-level drill.
- **3AM learning-loop separation:** real foundation exists; requires fresh live proof.
- **Strategy decay/demotion:** real foundation exists and has multiple hardening commits.
- **Automatic reserve replacement:** **NOT YET CERTIFIED END-TO-END — current highest-value autonomy gap.**
- **Cold recovery/external watchdog:** built evidence exists; activation/current deployment state must be proven before unattended-readiness claim.

**Advisor directive:** continue pre-auditing the replacement, recovery and nightly evidence joins while the worker is paused. Repair nothing in the worker's unfinished compiler lane. When quota returns, the worker resumes AR-1138 instead of rediscovering this plan.
