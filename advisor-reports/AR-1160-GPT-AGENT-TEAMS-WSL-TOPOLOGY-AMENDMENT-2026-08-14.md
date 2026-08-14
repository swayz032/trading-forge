# GPT EXTERNAL ADVISOR RULING — AR-1160

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Parent GPT ruling:** AR-1159 @ `f9b4a070c93d807cfea93b19046d08951501aba2`  
**Status:** OPERATING-TOPOLOGY AMENDMENT / CLAUDE CODE AGENT TEAMS + WINDOWS WSL  

---

# 1. DECISION

AR-1159 remains valid, with one improvement:

> When the second Claude implementation lane is authorized, prefer Claude Code **Agent Teams** running through Ubuntu/WSL rather than two unrelated manually coordinated sessions, provided the feature is available in the installed Claude Code version and the teammates are given hard non-overlapping ownership.

This does **not** authorize a second worker before the unfinished AR-1138 compiler/grading order reaches a committed, externally reviewed decision point.

---

# 2. VERIFIED FEATURE MODEL

Current Claude Code documentation describes Agent Teams as an experimental feature in which:

```text
team lead
  -> shared task list
  -> teammate A
  -> teammate B
  -> direct teammate-to-teammate messaging
  -> lead synthesizes / coordinates
```

Each teammate is an independent Claude Code session with its own context window.

Agent Teams currently require Claude Code v2.1.32 or later and are disabled by default until the experimental setting is enabled.

Claude Code itself supports Windows through WSL, including WSL 1 and WSL 2. Therefore a Windows host with Ubuntu/WSL is a valid operating environment for the feature path.

---

# 3. WINDOWS / WSL MODE FOR TRADING FORGE

For the first Trading Forge trial, use Ubuntu/WSL and prefer **in-process teammate mode**.

Reason:

- direct inter-agent messaging and the shared task list do not require split panes;
- in-process mode avoids adding terminal/tmux complexity during the first production-engineering trial;
- the engineering value is teammate coordination, not visual panes.

Split-pane/tmux mode may be evaluated later after the workflow is proven stable.

---

# 4. IMPORTANT LIMITATION — AGENT TEAMS DO NOT REMOVE FILE-COLLISION RISK

Agent-team communication is useful, but it does not make overlapping edits safe by itself.

Trading Forge must still obey:

```text
one semantic authority
one owner per active file/service family
no concurrent migration-number collision
no two workers modifying the same test oracle
no worker invalidates another worker's pinned baseline
```

The team lead must assign disjoint work before implementation begins.

If the tasks cannot be partitioned cleanly, use one implementation worker.

---

# 5. RECOMMENDED TEAM AFTER AR-1138 CLOSES

## Lead — MAIN CLAUDE SESSION

Owns:

- shared task list;
- dependency ordering;
- teammate messaging;
- integration awareness;
- stop conditions;
- final worker report.

The lead should not casually duplicate implementation work already assigned to a teammate.

## Teammate A — COMPILER / STRATEGY FACTORY

Own only:

```text
compiler money path
source-faithful deterministic artifacts
library disposition
Strategy Factory
compiler refusal repairs directly blocking usable strategies
```

## Teammate B — PAPER / AUTONOMY / EXECUTION SAFETY

Own only disjoint packets such as:

```text
PAPER receipt / qualification
Massive Futures PAPER feed
3AM durable receipt
strategy rotation
cold-start / recovery
Topstep / Slumhouse execution safety
duplicate-order defense
position reconciliation
kill switch / flatten
```

Teammate B must not edit active compiler/grader authority owned by Teammate A.

---

# 6. COMMUNICATION LAW

Direct teammate messaging should be used for dependencies, not for informal architecture invention.

Good message examples:

```text
A -> B: compiler artifact contract is now frozen at SHA X; field Y is authoritative.
B -> A: runtime requires field Z but it is absent; do not invent it here — flag dependency to lead.
A -> lead: task complete, tests green, SHA X.
B -> lead: blocked on migration owned by A; no edit made.
```

Bad behavior:

```text
both agents independently solve the same semantic problem
both edit the same migration
both change the same fixture to make their own tests pass
one silently works around the other's contract
```

The mailbox is a coordination tool, not permission to blur ownership.

---

# 7. RESET SEQUENCE

When Claude quota returns:

```text
1. ONE worker resumes exact unfinished AR-1138 order.
2. Finish -> test -> commit -> push -> report.
3. GPT independently grades repository evidence.
4. If AR-1138 is at a clean reviewed decision point, enable the Agent Team topology.
5. Lead creates two disjoint implementation lanes.
6. Teammates consume frozen GPT packets rather than rediscovering architecture.
7. Integrate/review each bounded unit before dependent follow-on work.
```

Do not spawn teammate B merely because the feature exists. Spawn it when there is a genuinely independent ready packet.

---

# 8. EXPECTED SPEED EFFECT

Agent Teams improve the earlier two-worker model because coordination no longer depends entirely on the human relaying messages between separate sessions.

Expected benefits:

```text
shared task visibility
+ direct dependency messages
+ less duplicate investigation
+ faster blocker handoff
+ clearer lead ownership
```

The practical throughput ceiling remains constrained by:

```text
Claude quota/token use
shared schemas
integration/tests
sequential dependencies
review gates
```

Therefore retain AR-1159's planning range rather than claiming 2x speed automatically.

---

# 9. BOTTOM LINE

**YES — Ubuntu/WSL makes the new Claude Code Agent Teams workflow usable from the user's Windows machine.**

**YES — Agent Teams are a better future topology than two unrelated Claude windows because teammates can share tasks and message each other directly.**

**NO — this does not change the immediate reset rule: finish AR-1138 with one worker first.**

After AR-1138 is cleanly closed, the preferred topology becomes:

```text
GPT external advisor / flashlight
          ↓
Claude team lead
     ↙          ↘
Compiler A    Runtime/Safety B
     ↘          ↙
 direct dependency messages
          ↓
verified integration
          ↓
GPT external ruling
```

This is the fastest robust configuration currently recommended for Trading Forge.