# GPT EXTERNAL ADVISOR RULING — AR-1163

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Parent GPT ruling:** AR-1162 @ `8335f2e2bd73608cd429144b026ea66334bd9fbe`  
**Status:** SEQUENCING CORRECTION / TWO-AGENT ACTIVATION CHECKPOINT  

---

# 1. THE TWO-AGENT SETUP IS NOT A LATE EXECUTION JOB

The Claude Code two-agent / Agent Teams topology is an **operating-mode control**, not a downstream implementation packet.

Its activation checkpoint is:

```text
AR-1138 reaches committed externally reviewed closure
-> enable/configure the two-Claude-worker topology
-> Worker 1 continues Graph Engineering -> Compiler -> Strategy Factory
-> Worker 2 begins the highest-priority disjoint authorized runtime/PAPER packet
```

Claude must NOT wait until AR-1154, AR-1155, AR-1156, AR-1157, AR-1158, AR-1159, AR-1160, AR-1161, or AR-1162 are "completed in numerical order" before enabling the second worker.

Those later-numbered GPT documents were written while Claude was quota-paused and include pre-audits, control instructions, and queue metadata. Their report numbers reflect publication order, not execution order.

---

# 2. CORRECT RESET SEQUENCE

When Claude quota returns:

```text
STEP 1
Resume and finish AR-1138 exactly where paused.

STEP 2
Run required tests/evidence, commit, push, and report.

STEP 3
GPT independently verifies AR-1138.

STEP 4
Once AR-1138 is accepted/closed at a safe committed decision point, activate the TWO-WORKER Agent Teams topology immediately.

STEP 5
Worker 1 / Lead:
Graph Engineering -> Compiler -> Strategy Factory.

Worker 2:
Take ONE disjoint authorized PAPER / autonomy / execution-safety packet.
```

The second worker is therefore intended to become useful **immediately after AR-1138 closure**, not near the end of the prepared packet list.

---

# 3. CONTROL DOCS VS EXECUTION PACKETS

The GPT branch now contains two different kinds of AR-numbered documents.

## CONTROL / ROUTING DOCS

Examples:

```text
AR-1159 = acceleration consumption / worker topology control
AR-1160 = Agent Teams + Ubuntu/WSL operating-mode amendment
AR-1161 = master reset / execution index
AR-1162 = V4 Graph Engineering ownership correction
AR-1163 = this activation-checkpoint clarification
```

These are read **up front when relevant**. They are not queued coding jobs.

## PRE-SOLVED EXECUTION PACKETS

Examples:

```text
AR-1154 = PAPER day receipt
AR-1155 = PAPER qualification activation seam
AR-1156 = Massive Futures PAPER feed
AR-1157 = 3AM durable receipt join
AR-1158 = strategy rotation coordinator
```

These are consumed one bounded packet at a time by the appropriate worker according to dependency and risk priority.

---

# 4. WHY THE NUMBER LOOKED WRONG

The report number is chronological publication order on the GPT branch, not the intended point in the engineering lifecycle.

While Claude was quota-paused, GPT kept working ahead and created additional reports. That caused the Agent Teams decision to receive the later identifier AR-1160 even though its intended activation point is right after AR-1138 closure.

Therefore:

```text
AR NUMBER != EXECUTION POSITION
```

The master queue and activation checkpoint determine execution position.

---

# 5. FINAL TWO-WORKER CHECKPOINT

```text
CURRENT:
Claude paused inside AR-1138.

FIRST WHEN QUOTA RETURNS:
Finish AR-1138 -> tests -> commit -> report -> GPT review.

THEN IMMEDIATELY:
Enable/use the two-Claude-worker Agent Teams setup.

WORKER 1 / LEAD:
Graph Engineering -> Compiler -> Strategy Factory.

WORKER 2:
Highest-priority disjoint PAPER / autonomous-runtime / execution-safety packet.

MAX CLAUDE WORKERS:
2.
```

This ruling supersedes any reading of AR-1160 as a late-stage execution item. AR-1160 is a control document whose activation checkpoint is immediately after AR-1138 closure.
