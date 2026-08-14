# GPT EXTERNAL ADVISOR RULING — AR-1165

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** LANE-SCOPED ONBOARDING / INBOX ROUTING CORRECTION

---

# 1. RULING

The user identified a material flaw in AR-1164.

AR-1164 correctly separated Worker 1 and Worker 2 by role, but it did not explicitly separate the incoming ruling/report stream consumed during onboarding and execution.

If both workers execute the same onboarding behavior and that onboarding blindly reads the same advisor rulings and agent reports, then both workers can inherit the same active task context, duplicate investigation, compete for the same packet, or accidentally treat the other worker's report as their own instruction.

Therefore the architecture is amended as follows:

**Shared engineering laws. Separate operational inboxes.**

```text
                 SHARED CORE
      engineering laws / safety / evidence
                         |
          +--------------+--------------+
          |                             |
 WORKER 1 LANE INBOX              WORKER 2 LANE INBOX
 Compiler / Strategy Factory      PAPER / Runtime / Safety
          |                             |
 Worker 1 current ruling          Worker 2 current ruling
 Worker 1 prior reports           Worker 2 prior reports
 Worker 1 owned backlog           Worker 2 owned backlog
          |                             |
          +------ dependency messages --+
```

---

# 2. WHAT BOTH WORKERS MAY READ

Both workers may consume a small shared set of cross-project authorities:

- shared worker execution law;
- repository / evidence rules;
- RED -> GREEN -> regression protocol;
- safety and fail-closed rules;
- Blueprint V4 stage boundaries;
- current global milestone / release gate;
- ownership map;
- cross-lane interface contracts explicitly marked SHARED;
- external-advisor rulings explicitly marked GLOBAL or BOTH-WORKERS.

These are doctrine, not task assignment.

Neither worker should infer a task merely because a shared document mentions work outside its lane.

---

# 3. WORKER 1 INBOX

Worker 1 = Team Lead + Graph Engineering -> Compiler -> Strategy Factory.

Its onboarding/execution intake should read by default only:

```text
GLOBAL / SHARED authorities
+ WORKER-1 / COMPILER lane rulings
+ WORKER-1 agent reports
+ WORKER-1 active order
+ explicit dependency messages addressed to Worker 1
```

Worker 1 must NOT automatically ingest Worker 2 PAPER/runtime/execution reports as actionable work.

Worker 1 may inspect Worker 2 material only when one of these is true:

1. Worker 2 sends an explicit dependency/interface message;
2. the external advisor marks the item CROSS-LANE;
3. Worker 1 needs read-only evidence to verify an upstream/downstream contract;
4. the active order explicitly authorizes the read.

Reading does not grant edit authority.

---

# 4. WORKER 2 INBOX

Worker 2 = PAPER -> Qualification operations -> Autonomous Runtime -> Execution Safety.

Its onboarding/execution intake should read by default only:

```text
GLOBAL / SHARED authorities
+ WORKER-2 / RUNTIME lane rulings
+ WORKER-2 agent reports
+ WORKER-2 active order
+ explicit dependency messages addressed to Worker 2
```

Worker 2 must NOT automatically ingest Worker 1 compiler/Strategy-Factory reports as actionable work.

Worker 2 may inspect Worker 1 material only under the same bounded cross-lane conditions above.

Reading does not grant edit authority.

---

# 5. ROUTING METADATA IS REQUIRED

Every new advisor ruling and worker report used by the two-worker system should carry machine-readable routing metadata near the top.

Minimum fields:

```text
LANE: GLOBAL | WORKER-1 | WORKER-2 | CROSS-LANE
OWNER: worker-1 | worker-2 | external-advisor | shared
ACTIONABLE_BY: worker-1 | worker-2 | both | none
DEPENDS_ON: <AR/commit/report IDs or NONE>
SUPERSEDES: <ID or NONE>
```

Optional but recommended:

```text
READ_ONLY_FOR: worker-1 | worker-2 | both | none
FILES_OWNED: <paths/service families>
FILES_FORBIDDEN: <paths/service families>
CONTRACT_EXPORTED: <contract ID or NONE>
```

A worker MUST NOT treat a document as its order unless `ACTIONABLE_BY` includes that worker.

---

# 6. ONBOARDING SHOULD RESOLVE IDENTITY BEFORE READING TASK HISTORY

Correct startup order:

```text
1. Load shared execution law.
2. Resolve worker identity: WORKER-1 or WORKER-2.
3. Load ownership/forbidden-surface map.
4. Load only GLOBAL shared authorities.
5. Load the worker's lane manifest.
6. Load the worker's current active order.
7. Load only the prior reports/rulings referenced by that active order or lane manifest.
8. Check direct teammate dependency mailbox.
9. Execute.
```

Incorrect startup order:

```text
read every recent ruling/report
-> infer what looks unfinished
-> start working
```

That behavior is prohibited in two-worker mode.

---

# 7. USE A LANE MANIFEST / CURSOR — DO NOT SCAN THE WHOLE REPORT DIRECTORY

Each lane should have one small authoritative manifest or cursor that tells the worker exactly what to consume.

Conceptually:

```text
worker-1-manifest
  active_order: AR-xxxx
  required_context: [AR-a, AR-b, commit-c]
  last_consumed_report: REPORT-x
  owned_surfaces: [...]

worker-2-manifest
  active_order: AR-yyyy
  required_context: [AR-d, AR-e, commit-f]
  last_consumed_report: REPORT-y
  owned_surfaces: [...]
```

The worker follows the manifest instead of recursively reading `advisor-reports/`, `agent-reports/`, or AGENT-LOGS to discover its job.

This reduces duplicate work and saves Claude context/quota.

---

# 8. CROSS-LANE COMMUNICATION

Agent Teams messaging becomes the normal dependency bridge.

Example:

```text
Worker 2 -> Worker 1
TYPE: DEPENDENCY
NEED: compiled artifact must export source_session_timezone
WHY: PAPER qualification cannot deterministically schedule session boundary
AUTHORITY: no workaround added
```

Worker 1 may respond:

```text
TYPE: CONTRACT-RESPONSE
STATUS: PROVIDED | REFUSED | NEEDS-ADVISOR
COMMIT: <sha>
CONTRACT: <field/schema/version>
```

Worker 2 consumes the contract response, not Worker 1's entire report history.

---

# 9. GPT EXTERNAL ADVISOR VISIBILITY

GPT external advisor remains the only participant that should normally inspect both lanes end-to-end for independent review, collision detection, architecture drift, duplicate authorities, and final rulings.

The two Claude workers do not need symmetric global operational context.

This is intentional separation of duties.

---

# 10. CURRENT ACTIVATION RULE STILL HOLDS

This amendment does NOT authorize Worker 2 to start before the current paused Worker 1 order is completed and externally reviewed.

Sequence remains:

```text
current worker resumes exact unfinished AR-1138
-> finish
-> tests/evidence
-> commit/push
-> worker report
-> GPT independent review
-> freeze lane manifests / routing
-> activate Worker 2 on a truly disjoint packet
```

---

# 11. BOTTOM LINE

The user is correct.

Two workers cannot safely share a blind onboarding feed that reads the same rulings and agent reports.

The corrected design is:

**ONE shared engineering constitution + TWO lane-specific operational inboxes + explicit cross-lane messages + GPT global oversight.**

Worker 1 sees Worker 1 work by default.

Worker 2 sees Worker 2 work by default.

Shared/global documents teach the system; they do not assign duplicate jobs.

This correction supersedes any reading of AR-1164 that would cause both workers to scan the same report/ruling history for active work.