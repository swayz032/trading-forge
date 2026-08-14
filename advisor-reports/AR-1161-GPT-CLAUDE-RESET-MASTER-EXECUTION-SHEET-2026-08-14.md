# GPT EXTERNAL ADVISOR RULING — AR-1161

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Parent GPT ruling:** AR-1160 @ `53f07c18aad9023db7c51c5c437de04ce81dd9a4`  
**Status:** MASTER RESET / CONSUMPTION INDEX / TWO-WORKER QUEUE CONTROL  

---

# 1. PURPOSE

This file is the single Claude reset entrypoint for the GPT pre-solved work.

Claude must NOT be expected to discover a pile of independent GPT rulings and infer their order from filenames or timestamps.

On quota reset, the main Claude session should read this master sheet first, then open only the packet currently authorized for execution.

The operating model is:

```text
GPT pre-solves / freezes packet
        ↓
MASTER SHEET selects next authorized packet
        ↓
Claude consumes ONE bounded packet per active worker
        ↓
RED -> implementation -> GREEN -> commit -> report
        ↓
GPT independently verifies repo evidence
        ↓
MASTER SHEET / next ruling authorizes next unit
```

This prevents rediscovery, skipped dependencies, duplicated work, and Claude quota waste.

---

# 2. ABSOLUTE FIRST ACTION WHEN CLAUDE RETURNS

Claude is currently paused mid-order on AR-1138 compiler/grading work.

Therefore the first action remains:

```text
resume exact unfinished AR-1138 state
-> finish the existing order
-> run required tests/evidence
-> commit and push
-> publish worker report
-> STOP for external-advisor grading
```

Do NOT begin AR-1154 through AR-1160 implementation before AR-1138 reaches that committed decision point.

Do NOT restart AR-1138 from scratch.
Do NOT let a second teammate modify AR-1138-owned compiler/grader files.

---

# 3. GPT PRE-SOLVED PACKET INDEX

These packets are preparation and control rulings, not claims that the implementation is already complete.

| Packet | Commit | Purpose | Default owner after AR-1138 |
|---|---|---|---|
| AR-1153 | `5e14ff4a408ebd38350e3aaef951ab735c8f8112` | V4 robust acceleration lane map | Lead reference |
| AR-1154 | `e8090f4f08d760eaa493411e72756b4c3b9b3ed9` | Deterministic PAPER day receipt | Worker 2 / Runtime |
| AR-1155 | `a4f56596737cba71a0c3a56ab81a53dd6b923b1e` | PAPER qualification activation seam | Worker 2 / Runtime |
| AR-1156 | `4ba07d598b37b3da30ff1030bdc9894c6b2a563e` | Massive Futures PAPER feed work order | Worker 2 / Runtime |
| AR-1157 | `2f5f0163d6250015880d268ad93c5334c2233699` | 3AM durable receipt join | Worker 2 / Runtime |
| AR-1158 | `f4b4d37c883c50e529541faddae3f2380dafc0fe` | Strategy rotation coordinator work order | Worker 2 / Runtime |
| AR-1159 | `f9b4a070c93d807cfea93b19046d08951501aba2` | Acceleration consumption + worker topology | Lead control |
| AR-1160 | `53f07c18aad9023db7c51c5c437de04ce81dd9a4` | Agent Teams / Ubuntu WSL topology | Lead control |
| AR-1161 | current | Master reset / execution index | Lead control |

Future GPT packets must be added to the same logical queue through a newer ruling rather than silently changing this file's meaning.

---

# 4. TWO CLAUDE WORKERS MAXIMUM

The user has chosen a strict maximum of TWO Claude workers because Claude usage quota is valuable.

After AR-1138 is closed and externally reviewed, preferred topology:

```text
GPT external advisor / flashlight
              ↓
Claude Worker 1 = TEAM LEAD + COMPILER / MONEY PATH
              ↕ direct Agent Teams messages
Claude Worker 2 = PAPER / AUTONOMY / EXECUTION-SAFETY PATH
```

No third Claude worker.

Worker 1 owns:

```text
compiler
source-faithful deterministic strategy artifacts
Strategy Factory
library disposition
compiler refusal repairs directly blocking usable strategies
```

Worker 2 owns disjoint units such as:

```text
PAPER receipts / qualification
Massive Futures PAPER feed
3AM durable evidence join
strategy rotation
cold-start / recovery
Topstep / Slumhouse execution safety
position reconciliation
duplicate-order defense
kill switch / flatten
```

Ubuntu/WSL Claude Code Agent Teams is the preferred coordination mode when available and enabled.

---

# 5. DO THE PACKETS GET COMPLETED ONE BY ONE?

Not as one giant chronological checklist.

Correct rule:

> ONE bounded packet per active worker at a time, respecting dependencies.

With one worker:

```text
packet A
-> test
-> commit
-> GPT grade
-> packet B
```

With two workers and genuinely disjoint authorities:

```text
Worker 1: compiler packet X ---------------------> commit/report

Worker 2: runtime packet Y ----------------------> commit/report

                     GPT grades both
                           ↓
                  next safe assignments
```

Do NOT make Claude execute AR-1154, AR-1155, AR-1156, AR-1157, AR-1158 merely because the numbers are consecutive.

The lead must choose the next packet by dependency and capital-risk priority.

---

# 6. HOW CLAUDE MUST READ A PRE-RULING

For each authorized packet, Claude should:

```text
1. Read AR-1161 master sheet.
2. Read the exact authorized packet in full.
3. Confirm current repository state has not materially invalidated the packet.
4. Reuse the authorities/file seams already measured by GPT.
5. Do NOT repeat broad architecture research unless a measured fact changed.
6. Produce the required pre-fix RED witness where the packet requires one.
7. Implement the smallest bounded repair/build.
8. Run the packet's required tests + relevant regression tests.
9. Run positive/mutation controls when required.
10. Commit and push the exact bounded unit.
11. Publish a worker report containing commit SHA, files, tests, evidence, deviations, and blockers.
12. STOP and wait for GPT external-advisor grading before taking a dependent next unit.
```

This is how the pre-rulings convert into saved Claude time.

---

# 7. CLAUDE MUST NOT REDISCOVER FROZEN FACTS BY DEFAULT

A GPT packet may contain already-measured facts such as:

```text
existing service authority
existing DB table
existing lifecycle behavior
missing join
required invariant
known unsafe crash window
exact RED -> GREEN test matrix
stop condition
```

Claude should do a narrow current-state verification, not restart the investigation from zero.

Rediscovery is justified only if:

```text
repository SHA changed the relevant seam
packet references a file/service that no longer exists
current tests contradict the frozen finding
a dependency landed after the packet that materially changes the design
```

If that happens, Claude reports the changed evidence instead of silently improvising a new architecture.

---

# 8. FIRST TEAM SPLIT AFTER AR-1138

AR-1138 must finish first.

After GPT grades it, the default split is:

## WORKER 1 / LEAD

Continue the compiler / Strategy Factory money path from the newly reviewed AR-1138 state.

Do not abandon the compiler merely because runtime packets exist.

## WORKER 2

Take the highest-priority disjoint prepared runtime packet authorized by the newest GPT ruling.

The lead should not dump all AR-1154..AR-1158 into Worker 2's context at once.

Give Worker 2 exactly one bounded implementation target, with references to prerequisite packets only as needed.

---

# 9. AGENT TEAMS COMMUNICATION RULE

Worker-to-worker messaging is for dependency coordination.

Useful examples:

```text
Worker 1 -> Worker 2:
Artifact contract is now committed at SHA X. Field Y is authoritative.

Worker 2 -> Worker 1:
Runtime requires field Z. It is absent from the frozen compiler artifact. I made no workaround; dependency sent to lead.

Worker 2 -> Lead:
My packet is GREEN at SHA Y. No files overlap Worker 1 ownership.
```

Forbidden:

```text
both workers edit the same semantic authority
both workers change the same migration concurrently
Worker 2 invents a compiler workaround
Worker 1 changes runtime contract under Worker 2 without message/review
both workers modify tests until each local implementation looks green
```

---

# 10. QUOTA-EFFICIENCY LAW

The two-worker system exists to improve VERIFIED OUTPUT PER CLAUDE TOKEN.

Therefore:

```text
no third worker
no duplicate repo exploration
no broad speculative redesign
no loading every packet into every teammate
no parallel work on the same dependency
no giant uncommitted sessions
```

Prefer:

```text
small bounded packet
-> direct implementation
-> real test
-> commit
-> review
```

The GPT lane continues to perform as much ahead-of-worker inspection and work-order preparation as practical so Claude quota is spent on implementation and proof.

---

# 11. TIME-SAVED MEASUREMENT

Each packet consumed by Claude should report:

```text
packet ID
packet SHA
worker ID
start timestamp
first code edit timestamp
first RED timestamp
GREEN timestamp
commit timestamp
research time before first edit
number of rework loops
whether any GPT-frozen fact required rediscovery
```

Classification:

```text
A = direct packet consumption; no material rediscovery
B = small current-state verification
C = packet stale/incomplete and needed material revision
D = packet ignored and broad work duplicated
```

Target is mostly A/B and near-zero D.

---

# 12. RESET PROMPT / ENTRYPOINT FOR THE CLAUDE LEAD

When Claude returns, the operational instruction is conceptually:

```text
Read advisor-reports/AR-1161-GPT-CLAUDE-RESET-MASTER-EXECUTION-SHEET-2026-08-14.md on external-advisor/gpt-rulings.

Your first and only implementation priority is to resume and finish the exact currently paused AR-1138 compiler/grading order from its existing state. Do not start downstream GPT packets yet. Finish, test, commit, push, report, then stop for GPT external review.

After AR-1138 receives a clean external-advisor decision point, use a maximum of two Claude workers through Agent Teams/Ubuntu WSL: Worker 1 = lead + compiler/money path; Worker 2 = disjoint PAPER/runtime/execution-safety work. Consume one bounded GPT packet per worker at a time. Do not rediscover frozen facts unless current repository evidence materially changed.
```

---

# 13. BOTTOM LINE

The pre-rulings are now organized as an executable queue, not a pile of notes.

Claude should always know:

```text
WHERE TO START = AR-1161
WHAT TO DO FIRST = finish paused AR-1138
HOW MANY WORKERS = maximum 2
WHO OWNS WHAT = Worker 1 compiler / Worker 2 runtime
HOW TO USE GPT PACKETS = one bounded packet per active worker
WHEN TO MOVE ON = after test + commit + report + GPT grade
```

This is the control layer that converts GPT's ahead-of-worker research into actual Claude speed and quota savings.