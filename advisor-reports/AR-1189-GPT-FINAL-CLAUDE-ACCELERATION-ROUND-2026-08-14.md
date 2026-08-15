# GPT EXTERNAL ADVISOR RULING — AR-1189

**Date:** 2026-08-14  
**Type:** CONTROL / FINAL PRE-RESET CLAUDE ACCELERATION ROUND  
**Status:** STAGED / STOP PREPARING AFTER THIS / BUILD NEXT  
**Branch:** `external-advisor/gpt-rulings`

## DECISION

The final useful pre-reset Claude acceleration round is complete.

GPT has now removed the major avoidable research, context-reconstruction, coordination, reporting, and grading setup costs for both Claude workers without changing production code or weakening proof requirements.

**AR-1138 remains the first worker order.** Nothing in AR-1189 replaces, renumbers, or pulls work ahead of it.

After this control, the default engineering action is:

```text
STOP PREPARING
-> LET WORKERS BUILD
-> GPT INDEPENDENTLY GRADE REAL COMMITS
```

More speculative planning before fresh worker evidence would now create stale-plan risk and paperwork rather than speed.

---

# 1. WORKER 1 READY-TO-EDIT PATH — COMPLETE

Staged under:
`advisor-prepared/two-worker-claude/worker1-implementation-maps/`

## A. Graph closure
`POST-AR-1138-GRAPH-CLOSURE.md`

Rules:
- AR-1138 GPT PASS first;
- reuse existing `DecisionAtom` / canonical graph / conservation-ledger backbone;
- accepted AR-1138 strategy only;
- one real RED if a graph/conservation gap exists;
- no competing graph architecture;
- if the existing path is already sufficient, publish proof and move on rather than making cosmetic changes.

## B. Compiler vertical
`POST-AR-1138-COMPILER-VERTICAL.md`

Rules:
- one real source-faithful strategy first;
- AR-1138 accepted production trace determines the real compiler seam;
- deterministic output or exact refusal;
- pinned source evidence outranks paraphrase;
- unsupported/ambiguous meaning fails closed;
- no midpoint/default guessing, retry hunting, or hand-edited extraction JSON.

## C. Strategy Factory vertical
`POST-AR-1138-STRATEGY-FACTORY-VERTICAL.md`

Rules:
- consume exact compiler artifact/hash;
- preserve source identity/provenance/entry/invalidation/source exits;
- executable artifact or exact refusal;
- no Context Observer, qualification, PAPER, optimization, or broker mutation at this boundary.

## D. Library disposition
`POST-AR-1138-LIBRARY-DISPOSITION.md`

Rules:
- only after one vertical is independently green;
- run canonical library through the same production path;
- every strategy becomes COMPILED or exact REFUSED(reason);
- counts must conserve;
- same input/code must produce same disposition;
- census first, not a 120-row repair marathon.

## E. Golden-run handoff
`POST-AR-1138-GOLDEN-RUN-HANDOFF.md`

Rules:
- first golden candidate is the exact GPT-accepted AR-1138 strategy;
- Worker 1 freezes source→graph→compiler→factory lineage;
- downstream stages may judge/observe/execute later but may not silently rewrite source semantics;
- no easier candidate swapping after results are seen.

---

# 2. GPT PRE-GRADE CARDS — COMPLETE

Staged:
`advisor-prepared/two-worker-claude/GPT-PRE-GRADE-CARDS.md`

GPT now has compact pre-grade checklists for:
- AR-1138 completion;
- Worker 1 Graph/Compiler/Factory vertical;
- library disposition;
- Worker 2 priority micro-packets.

This speeds grading setup only. It does NOT make worker prose proof.

Universal law remains:

```text
worker report = index
actual Git commit/code/tests/controls = proof
```

---

# 3. WORKER-TO-WORKER HANDOFF CONTRACT — COMPLETE

Staged:
`advisor-prepared/two-worker-claude/WORKER-HANDOFF-CONTRACT.md`

Short contract fields:

```text
FROM
TO
JOB
COMMIT
CONTRACT_CHANGED
CONTRACT_UNCHANGED
CONSUMER_ACTION
DO_NOT_TOUCH
EVIDENCE
KNOWN_LIMIT
```

Key law:
- sender commits before handoff;
- receiver consumes committed interface;
- receiver does not silently repair sender's semantic lane;
- broken/ambiguous dependency is sent back as evidence.

---

# 4. SHORT EVIDENCE RECEIPT — COMPLETE

Staged:
`advisor-prepared/two-worker-claude/EVIDENCE-RECEIPT-TEMPLATE.md`

One bounded worker order now reports only what grading needs:
- starting/ending SHA;
- exact RED;
- changed files;
- exact GREEN;
- negative/mutation control;
- full regression where required;
- commit/push;
- known limit;
- cross-lane touches;
- zero broker egress;
- stopped for GPT.

This replaces unnecessary storytelling, not evidence.

---

# 5. WORKTREE COLLISION GUARD — COMPLETE

Staged:
`advisor-prepared/two-worker-claude/WORKTREE-COLLISION-GUARD.json`

Semantic ownership:

```text
Worker 1
Graph Engineering / Compiler / Strategy Factory

Worker 2
PAPER / Qualification Ops / Autonomous Runtime / Execution Safety
```

Coordination-required surfaces include:
- `package.json`;
- `src/server/db/schema.ts`;
- `src/server/index.ts`;
- workflows;
- migrations;
- shared contracts/lifecycle/assignment authority;
- any file already modified by the other active worker branch.

Shared-file use is not prohibited. It requires an explicit committed handoff/ownership resolution before the second worker edits/merges.

---

# 6. STOP-RESEARCHING RULE — COMPLETE

Staged:
`advisor-prepared/two-worker-claude/STOP-RESEARCHING-RULE.md`

Default loop:

```text
identity/lane
-> inventory/prior art
-> canonical owner found
-> real RED reproduced
-> STOP broad research
-> smallest repair
-> GREEN + control
-> commit/push/receipt
```

Research reopens only if evidence changes the next safe edit.

This explicitly blocks:
- while-I-am-here refactors;
- endless advisor-history reading;
- broad scanning after owner + RED are known;
- retry hunting;
- new subsystem creation before existing authority is checked;
- fixing unrelated failures during a bounded packet.

---

# MACHINE QUEUE UPDATED

`advisor-prepared/two-worker-claude/EXECUTION-QUEUE.json`

Now version:
`two-worker-execution-queue-v1.2`

It links:
- startup card;
- test index;
- GPT pre-grade cards;
- worker handoff contract;
- evidence receipt;
- collision guard;
- stop-researching rule;
- Worker 1 post-AR-1138 queue;
- Worker 2 ready-to-edit queue.

AR-1138 is still the active Worker 1 order.

---

# EXACT NEXT EVENT

When Claude quota returns:

```text
1. Worker 1 distinct onboarding
2. resume exact unfinished AR-1138 state
3. finish only authorized AR-1138 work
4. RED/GREEN/controls
5. commit + push
6. short evidence receipt/report
7. STOP
8. GPT independently inspect actual repo evidence
9. GPT ACCEPT / CORRECT / STOP
```

If and only if AR-1138 is accepted and two-worker identity/worktree activation is proven:

```text
Worker 1
-> post-AR-1138 Graph/Compiler/Factory cards

Worker 2
-> AR-1178
-> GPT grade
-> AR-1175
-> GPT grade
-> AR-1176
-> GPT grade
-> AR-1173
-> GPT grade
-> AR-1184 Phase A
-> GPT grade
```

One active bounded order per worker.

---

# LOCKS PRESERVED

```text
AR-1138 FIRST
no production code changed by this acceleration round
Worker 2 remains gated before activation
Agent Teams remains gated before activation receipt
broker egress OFF
Topstep live transport OFF
P0-6 deployment still obeys AR-1169 gate
Codex completed work must not be duplicated
Worker 1 cannot take runtime/execution safety ownership by default
Worker 2 cannot reinterpret source/compiler semantics
GPT grades real repository evidence, not prose
```

Credential containment remains the only special immediate exception: if a potentially live exposed credential is confirmed, revoke/rotate safely first without printing secret bytes.

---

# BOSS / ADVISOR RULING

The Claude-support system is now sufficiently prepared.

The team has:

```text
DISTINCT WORKER IDENTITIES
+ SEPARATE OWNERSHIP LANES
+ START CARD
+ MACHINE QUEUE
+ TEST INDEX
+ WORKER 2 READY-TO-EDIT MAPS
+ WORKER 1 POST-AR-1138 READY-TO-EDIT MAPS
+ GPT PRE-GRADE CARDS
+ SHORT HANDOFF CONTRACT
+ SHORT EVIDENCE RECEIPT
+ COLLISION GUARD
+ STOP-RESEARCHING RULE
+ GPT INDEPENDENT REVIEW
```

The next meaningful speed gain comes from **executing code**, not writing more plans.

Therefore after AR-1189:

**STOP PREPARING BY DEFAULT. BUILD. TEST. COMMIT. GRADE. REPEAT.**

New preparation is authorized only when fresh worker evidence exposes a new blocker, dependency, or architectural conflict that materially changes the next safe edit.