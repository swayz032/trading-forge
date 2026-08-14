# GPT EXTERNAL ADVISOR RULING — AR-1164

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Status:** TWO-WORKER ONBOARDING / SKILL ARCHITECTURE

---

# 1. RULING

YES. The second Claude worker should have its own role-specific onboarding and worker-skill instructions because Worker 1 and Worker 2 own different parts of Blueprint V4 and have different failure modes.

Do NOT create two completely independent engineering constitutions. Use one shared core plus role-specific overlays.

```text
SHARED WORKER CORE
├── Worker 1 onboarding + Worker 1 skill overlay
└── Worker 2 onboarding + Worker 2 skill overlay
```

This preserves one engineering culture while keeping authority boundaries explicit.

---

# 2. SHARED CORE — BOTH WORKERS

Both workers inherit the same non-negotiable laws:

- repository evidence before claims;
- RED -> implementation -> GREEN -> relevant regression evidence;
- mutation/positive controls when required;
- no fake-green tests;
- fail closed on unsupported or ambiguous money-path behavior;
- reuse existing authorities before adding architecture;
- do not silently change semantics to make tests pass;
- commit bounded work with exact evidence;
- publish a worker report after each authorized packet;
- respect GPT external-advisor review gates;
- no overlapping ownership or concurrent edits to the same semantic authority;
- communicate dependencies through Agent Teams rather than inventing cross-lane workarounds.

---

# 3. WORKER 1 ROLE

**Role:** Team Lead / Graph Engineering / Compiler / Strategy Factory.

Blueprint V4 ownership:

```text
GRAPH ENGINEERING
-> COMPILER
-> STRATEGY FACTORY
```

Worker 1 onboarding must teach:

- exact source-fidelity mission;
- DecisionAtom/state-machine/decision-closure/dependency-graph authorities;
- source semantics, ordering, invalidation, entry, source-owned exits;
- compiler lowering and refusal rules;
- Strategy Factory throughput and faithful/refused disposition;
- extraction/grading/compiler provenance boundaries;
- how and when to send stable artifact contracts to Worker 2;
- never modify Worker 2 runtime/PAPER authority just to unblock itself.

Worker 1 skill should optimize for:

- faithful strategy representation;
- deterministic compiler behavior;
- refusal correctness;
- library throughput;
- evidence-backed compiler fixes;
- exact contract publication to downstream stages.

---

# 4. WORKER 2 ROLE

**Role:** PAPER / Qualification operations / Autonomous Runtime / Execution Safety.

Primary ownership includes prepared disjoint work involving:

```text
PAPER receipts and qualification orchestration
Massive Futures PAPER feed
3AM durable evidence join
strategy rotation
cold-start / restart / recovery
Topstep / Slumhouse execution authority
order idempotency / duplicate-order defense
position reconciliation
kill switch / flatten
runtime audit / durability / safety
```

Worker 2 onboarding must teach:

- Topstep is downstream execution, not part of source strategy semantics;
- the custom PAPER engine is authoritative for PAPER qualification;
- only qualified strategy artifacts enter autonomous runtime;
- execution must fail closed on stale, missing, contradictory, duplicate, or unreconciled state;
- durable/idempotent OMS behavior, restart safety, position reconciliation and no duplicate orders;
- no invention of compiler/source semantics;
- when runtime needs a missing artifact field, message Worker 1/lead and stop rather than creating a workaround;
- use the existing Slumhouse/Topstep authority where present; never create a duplicate connector without evidence;
- runtime changes require crash/reconnect/idempotency evidence where relevant.

Worker 2 skill should optimize for:

- durable PAPER evidence;
- deterministic qualification lifecycle;
- restart/recovery correctness;
- runtime autonomy;
- execution safety;
- capital protection;
- exact upstream/downstream contract enforcement.

---

# 5. ONBOARDING AND SKILL ARE DIFFERENT

Do not collapse these into one document.

**Onboarding = who am I, what system am I entering, what do I own, what must I never touch, how do I communicate, what is the current mission.**

**Worker skill = how I execute tasks repeatedly: investigation method, RED/GREEN protocol, evidence requirements, testing standards, commit/report format, stop conditions, anti-patterns.**

Therefore each worker gets both:

```text
Worker 1 onboarding
Worker 1 role skill

Worker 2 onboarding
Worker 2 role skill
```

while both inherit the shared worker core.

---

# 6. TOKEN-EFFICIENCY LAW

Because Claude quota is constrained, do not duplicate hundreds of lines of common rules into both role files.

Preferred structure:

```text
CORE WORKER RULES (shared, short, authoritative)
        ↓                    ↓
WORKER 1 ROLE OVERLAY    WORKER 2 ROLE OVERLAY
        ↓                    ↓
ONBOARDING 1            ONBOARDING 2
```

Each onboarding should point to the shared core and its role overlay.

This minimizes context waste while preserving clear specialization.

---

# 7. AGENT TEAMS COMMUNICATION CONTRACT

Worker-to-worker messaging must be part of both onboardings.

Examples:

```text
Worker 1 -> Worker 2:
Compiler artifact contract X is committed at SHA Y. Fields A/B/C are authoritative.

Worker 2 -> Worker 1:
Runtime packet requires field D; current artifact lacks it. No workaround added. Dependency returned to lead.
```

Forbidden:

- Worker 2 editing Graph Engineering/compiler semantics;
- Worker 1 editing runtime safety authority to satisfy its own tests;
- both workers changing the same migration/schema concurrently;
- hidden workaround layers between stages;
- duplicate semantic authorities.

---

# 8. ACTIVATION TIMING

Build/freeze the Worker 2 onboarding and skill BEFORE or at the two-agent activation checkpoint.

Correct sequence:

```text
finish AR-1138
-> GPT grade
-> load shared core + Worker 1 overlay/onboarding
-> load shared core + Worker 2 overlay/onboarding
-> activate two-worker Agent Teams
-> assign one bounded packet per worker
```

Do not launch Worker 2 as a generic clone of Worker 1 and teach the role later.

---

# 9. BOTTOM LINE

YES — separate role-specific onboarding and skills are the correct design.

But the robust version is:

**one shared worker core + Worker 1 role overlay/onboarding + Worker 2 role overlay/onboarding.**

Worker 1 = Graph Engineering -> Compiler -> Strategy Factory.

Worker 2 = PAPER -> autonomy/runtime -> execution safety.

This separation should be in place before the second Claude worker begins real implementation work.