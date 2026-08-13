# AUG-27 NO-CLAUDE AUTONOMY PRE-AUDIT — FAST/ROBUST LANE

**Date:** 2026-08-13  
**Purpose:** protect the Aug-27 backstop by proving Trading Forge can operate without Claude Code as a runtime dependency.  
**Scope:** advisor-side pre-audit only. This document does **not** modify Claude's in-progress AR-1138 engineering lane.

## 1. HARD REQUIREMENT

After the build is frozen, ordinary operation must not require an active Claude Code subscription/session.

Claude Code may build, diagnose, and repair software before the deadline, but the deployed system must own its own:

- startup and service supervision;
- market/data reconnect behavior;
- strategy scheduling;
- risk and lifecycle gates;
- durable state and restart recovery;
- reconciliation and duplicate prevention;
- health/readiness checks;
- nightly 3AM intelligence/reporting;
- alerts and fail-closed behavior.

A system that needs Claude to be opened every morning, manually restart services, repair ordinary drift, or make routine trading decisions is **NOT AUTONOMOUS-READY**.

## 2. REUSE BEFORE BUILD — EXISTING ASSETS

Do not rebuild capabilities that already exist. Current repository evidence shows reusable foundations:

1. **Night Agent / Learning Loop:** merged PR #28 (`Harden Night Agent desk and prompt caching`) and deployed commit `5688336e64c4ff1cba6386fc88fb64058ccba53d`. Reuse and certify its live side effects rather than replacing it.
2. **Paper structural isolation:** merged PR #19 makes paper rows structurally unroutable to funded broker egress via `paper_sim`. Preserve this separation during the official PAPER window.
3. **Broker-egress chokepoint:** merged PR #22 narrowed broker network egress and added a CI bypass guard. Reuse that chokepoint for production-readiness verification; do not add parallel sockets casually.
4. Existing execution/risk/reconciliation infrastructure must be tested as one unattended system instead of replaced by a new autonomy subsystem.

## 3. FAST ENGINEERING ORDER

### Lane A — current critical path (Claude, unchanged)

Continue AR-1138 from the exact local state when quota resumes:

`real sVkm grade -> certificate -> real compiler join -> §9.2 vertical`

Do not restart extraction. Do not redirect into Context Edge, Visual Intelligence, PAPER, n8n, or broker work until the ordered gate reports its result.

### Lane B — GPT shadow pre-audit (parallel, non-conflicting)

Work ahead of Claude and identify blockers in:

1. certificate -> compiler handoff;
2. §9.2 TS/DB/Python reload path;
3. batch/library edge-search path;
4. PAPER orchestration;
5. 3AM nightly evidence path;
6. unattended startup/recovery/readiness path.

No engineering writes to Claude's active files while its local state is unknown.

## 4. NO-CLAUDE AUTONOMY ACCEPTANCE DRILL

Before the Aug-27 backstop, perform a frozen-build drill with Claude Code absent from the runtime path.

Required evidence:

- [ ] Boot/restart from a known frozen build without Claude Code.
- [ ] Required services start automatically or fail loudly and safely.
- [ ] Data dependencies reconnect or block readiness explicitly.
- [ ] Stale/unknown broker/account truth blocks unsafe activity.
- [ ] Durable state survives restart without duplicate work/orders.
- [ ] Scheduler fencing proves one execution per scheduled job.
- [ ] Risk/lifecycle gates remain active after restart.
- [ ] Paper mode cannot egress to funded broker paths.
- [ ] Nightly 3AM workflow executes without Claude Code.
- [ ] Nightly workflow produces durable, traceable output or an explicit failure alert.
- [ ] Kill-switch / halt behavior can be exercised without Claude Code.
- [ ] Operator receives a simple green/yellow/red health result.

A manual recovery drill may use documented operator controls; normal daily operation may not depend on an AI coding session.

## 5. PAPER WINDOW CONTRACT

Official 3–5 trading-day PAPER qualification uses one frozen candidate version.

During PAPER:

- Night Agent may observe, analyze, detect anomalies, and report.
- Night Agent may propose future changes.
- It must not silently mutate the candidate under qualification.
- A material strategy/runtime semantic change creates a new candidate/version and resets the affected qualification evidence.

## 6. CONTEXT EDGE / VISUAL INTELLIGENCE DEADLINE RULE

The frozen Context Edge Lab and V4 Revision 5 remain valid, but deadline behavior is strict:

- collect cheap deterministic context alongside source-faithful backtests where possible;
- deep context analysis only on survivors;
- no giant Context Edge implementation before compiler breakthrough;
- no giant screenshot/Visual Intelligence project before a measured need;
- reuse deterministic market primitives before adding new visual/model infrastructure.

## 7. DEADLINE PRIORITY

Order work by whether it moves the system toward an autonomous qualified candidate:

**P0:** compiler correctness / real vertical  
**P0:** credible edge / qualification  
**P0:** PAPER + unattended runtime readiness  
**P0:** 3AM loop live evidence  
**P1:** lean Context Edge on survivors  
**P1:** measured Visual Intelligence gaps  
**P2:** wider compiler coverage after viable candidates exist  
**P3:** cosmetic or speculative work

Saved time becomes pre-backstop observation/recovery margin; it is not permission to invent extra features.

## 8. STOP CONDITIONS

Stop and report rather than papering over any of these:

- certificate semantics cannot be grounded;
- compiled strategy differs materially from certified source;
- PAPER and production egress are not structurally separated;
- restart can duplicate or lose durable state;
- runtime health depends on Claude Code being present;
- 3AM workflow claims success without durable evidence;
- a safety/readiness dependency is stale or unknown but the system proceeds anyway.

## 9. IMMEDIATE NEXT ACTION

While Claude is quota-paused, GPT should continue read-only/shadow inspection of the future joins and autonomy surfaces. When Claude resumes, it continues AR-1138 without a new mission. After each landed worker report, GPT verifies the actual repository evidence and issues the shortest robust next ruling.
