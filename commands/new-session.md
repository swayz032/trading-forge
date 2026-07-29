---
description: Mission-load a fresh session — read CLAUDE.md, AGENTS.md, and AGENT-LOGS.md so you understand the project before doing anything else
allowed-tools: Read, Glob, Grep
---

You are starting a NEW session on the Trading Forge project. Before doing anything else — before asking questions, before exploring code, before suggesting an approach — you MUST load the project mission by reading these three files **in this order** and **in full** (no `limit`, no skipping):

1. **`trading-forge/CLAUDE.md`** — the living rules: mission, current phase, framework, prop firms, lifecycle gates, Don't rules. This is the operating contract.
2. **`trading-forge/AGENTS.md`** — the agent contract: forcing functions (Validation Cadence, n8n Drift, System Map Sync, CI Hard Gates), pipeline path, broker abstraction, operator-absent mode, multi-pass execution pattern, hard gates table.
3. **`trading-forge/AGENT-LOGS.md`** — the build journal and pinned known-facts section. This contains: (a) what's been built and shipped pass by pass, (b) pinned facts agents keep misdiagnosing (e.g., Tavily key is NOT expired), and (c) prior session learnings worth carrying forward.

After reading, write a **one-paragraph mission brief** back to the user covering:
- Current phase (Production Hardening — no new subsystems)
- The scaling target ($250/day → $1K–5K+/day via 4 levers)
- The two approved prop firms (Topstep + MFFU; 9 legacy firms removed 2026-05-10)
- Any RED forcing functions that would block infra work
- Any pinned known facts from AGENT-LOGS.md you must not misdiagnose this session

Then ask the user: **"What's the mission for this session?"** Do not propose work until they answer.

## Mandatory at session end

When this session ends — when you have finished the task, are about to hand off, or detect the user is wrapping up — you MUST append a new entry to `trading-forge/AGENT-LOGS.md` summarizing the work done in this session. Format:

```markdown
### Session Log — YYYY-MM-DD <short title>

**Mission:** <one sentence — what the user asked for>

**Work completed:**
- <bullet of what shipped / was fixed>
- <files touched, migrations added, workflows updated, tests added>

**Verification:**
- <test runs / validator results / live checks>

**Known-facts updates:** (only if you added pinned facts or corrected a misdiagnosis pattern)
- <link to or summary of the pinned fact>

**Carry-forward for next session:**
- <unfinished work, blocked items, follow-ups>
```

Place the new entry **above** the existing `## Known-Facts Pin — Stop Misdiagnosing These` section so the journal stays chronological and the pinned facts remain at the bottom.

If the session ended without producing meaningful work, write a one-line entry stating that — DO NOT skip the log entry just because the session was short. The journal is the source of truth for what happened.
