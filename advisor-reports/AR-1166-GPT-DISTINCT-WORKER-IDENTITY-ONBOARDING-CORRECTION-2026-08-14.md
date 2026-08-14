# GPT EXTERNAL ADVISOR RULING — AR-1166

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** DISTINCT WORKER IDENTITY / ONBOARDING CORRECTION

---

# 1. CORRECTION

The user identified the deeper architectural issue missed by AR-1164 and only partially addressed by AR-1165:

`/worker-onboarding` is an identity-establishing mechanism, not merely a generic rules loader.

If both Claude instances run the exact same onboarding command with the same identity payload, both may initialize as the same worker, inherit the same mission, same active history, same report/ruling stream, and same ownership assumptions.

That is unsafe in two-worker Agent Teams mode.

Therefore two-worker mode requires **distinct onboarding identities from the first instruction**.

---

# 2. REQUIRED IDENTITY MODEL

```text
WORKER 1 IDENTITY
Name/Role: Trading Forge Worker 1 / Team Lead
Mission: Graph Engineering -> Compiler -> Strategy Factory
Operational lane: COMPILER-FACTORY

WORKER 2 IDENTITY
Name/Role: Trading Forge Worker 2 / Runtime & Execution Engineer
Mission: PAPER -> Qualification Ops -> Autonomous Runtime -> Execution Safety
Operational lane: PAPER-RUNTIME-SAFETY
```

They may share the same engineering constitution and worker-execution skill, but they must NOT share the same onboarding identity.

---

# 3. DO NOT USE ONE AMBIGUOUS ONBOARDING ENTRYPOINT

Unsafe:

```text
/worker-onboarding
```

for both workers when that command creates one generic/single worker identity.

Preferred design:

```text
/worker-onboarding worker-1
/worker-onboarding worker-2
```

or equivalent explicit commands/aliases such as:

```text
/worker-1-onboarding
/worker-2-onboarding
```

The exact implementation can reuse shared internal content, but the resolved identity must be different before any task/ruling/report history is loaded.

---

# 4. IDENTITY MUST BE RESOLVED FIRST

Correct startup order:

```text
1. Invoke worker-specific onboarding identity.
2. Set worker_id / lane / role / ownership boundaries.
3. Load shared engineering constitution.
4. Load shared worker-execution skill.
5. Load only that identity's lane manifest/inbox.
6. Load that worker's active order and referenced history.
7. Check teammate dependency messages.
8. Execute.
```

Incorrect:

```text
1. Run generic onboarding.
2. Read shared reports/rulings.
3. Decide afterward which worker this session is.
```

Identity cannot be inferred after task history has already contaminated context.

---

# 5. SHARED SKILL IS ALLOWED; SHARED IDENTITY IS NOT

This distinction is now authoritative:

```text
SHARED
- worker-execution skill
- RED/GREEN protocol
- evidence standards
- safety law
- commit/report discipline
- repo integrity rules

NOT SHARED
- worker identity
- lane mission
- active order
- default ruling/report inbox
- owned service/file families
- forbidden surfaces
- worktree/branch
```

Therefore the existing `worker-execution` skill should remain common unless direct audit later proves role-specific execution mechanics require an overlay.

The onboarding entrypoint must be worker-specific.

---

# 6. ONBOARDING PAYLOAD REQUIREMENTS

Each worker onboarding identity should establish at minimum:

```text
WORKER_ID
ROLE
LANE
MISSION
ACTIVE_ORDER_SOURCE
RULING_INBOX
REPORT_INBOX
OWNED_SURFACES
FORBIDDEN_SURFACES
WORKTREE / BRANCH RULE
TEAMMATE_ID
ESCALATION_TARGET
```

Worker 1 example:

```text
WORKER_ID: worker-1
ROLE: team-lead / graph-compiler-factory
LANE: compiler-factory
RULING_INBOX: worker-1 + global
REPORT_INBOX: worker-1 + explicit cross-lane
```

Worker 2 example:

```text
WORKER_ID: worker-2
ROLE: runtime-execution-engineer
LANE: paper-runtime-safety
RULING_INBOX: worker-2 + global
REPORT_INBOX: worker-2 + explicit cross-lane
```

---

# 7. AGENT TEAMS LEAD / TEAMMATE RELATIONSHIP

Because only two Claude Code instances are authorized:

```text
Claude Instance 1
= Agent Teams lead
= Worker 1 identity
= Graph Engineering -> Compiler -> Strategy Factory

Claude Instance 2
= Agent Teams teammate
= Worker 2 identity
= PAPER -> Runtime -> Execution Safety
```

There is no third Claude coordinator.

GPT external advisor remains outside Claude usage and provides global independent review/planning.

---

# 8. HISTORICAL REPORT CONTAMINATION RULE

A worker-specific onboarding must not blindly scan all historical advisor rulings / agent reports.

After identity is set, the worker loads:

```text
GLOBAL doctrine
+ its own lane manifest
+ its own active order
+ only referenced prior evidence
+ explicit cross-lane dependency messages
```

This prevents identity collision and context pollution.

---

# 9. ACTIVATION SEQUENCE

Still unchanged:

```text
resume and finish current AR-1138
-> test / commit / push / worker report
-> GPT independent review
-> create/freeze Worker 1 identity onboarding
-> create/freeze Worker 2 identity onboarding
-> create/freeze lane manifests
-> start 2-worker Agent Teams
```

Worker 2 must never be launched first as a generic `/worker-onboarding` clone.

---

# 10. BOTTOM LINE

The correct architecture is NOT:

```text
same onboarding identity
+ different job instructions later
```

It is:

```text
DISTINCT IDENTITY AT ONBOARDING
        +
SHARED EXECUTION LAW
        +
SEPARATE LANE INBOXES
        +
DIRECT TEAMMATE MESSAGING
```

Worker 1 and Worker 2 must know who they are before they read any active work history.

This ruling supersedes any interpretation of AR-1164/AR-1165 that permits both Claude instances to initialize through the same identity-bearing onboarding payload.