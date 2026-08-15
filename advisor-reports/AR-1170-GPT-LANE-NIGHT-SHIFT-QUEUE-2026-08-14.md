# GPT EXTERNAL ADVISOR RULING — AR-1170

**Date:** 2026-08-14  
**Branch:** `external-advisor/gpt-rulings`  
**Type:** CONTROL / GPT FLASHLIGHT QUEUE UPDATE  
**Status:** ACTIVE GPT LANE NIGHT-SHIFT QUEUE

## PURPOSE

Codex completed a large amount of offline production-hardening work and has now hit its usage limit. Claude remains paused until reset. GPT therefore owns the no-Claude/no-Codex flashlight lane until Claude resumes.

This queue exists to prevent duplicate work, preserve Blueprint V4 + Revision 5 ordering, and pre-solve the smallest safe Claude packets before reset.

## HARD ORDERING LAW

Blueprint V4 + Revision 5 remains authoritative:

```text
Graph Engineering
-> Compiler
-> Strategy Factory
-> Context Observer
-> Qualification
-> Autonomous Runtime
```

`AR-1138` remains the first semantic gate.

**AR NUMBER != EXECUTION POSITION.**

No task below may pull Worker 2, Agent Teams, PAPER qualification, or broker egress ahead of the AR-1138/two-worker activation gate.

---

# CURRENT VERIFIED STATE

## P0-6 code candidate

GPT independently accepted exact candidate:

`65a53ea95111a469e2324ba2e9df576f605eca99`

per AR-1169.

Meaning:

```text
P0-6 CODE CANDIDATE = ACCEPTED
P0-6 DEPLOYMENT = CLOSED UNTIL AR-1138 GPT ACCEPTANCE
P0-6 FINAL SYSTEM GREEN = CLOSED UNTIL LIVE WITNESSES PASS
```

## Two-worker setup

Codex installed the prepared distinct Worker 1 and Worker 2 onboarding identities into the project skill surfaces and left Agent Teams disabled.

GPT must **verify**, not reinstall, after AR-1138 closes unless a mismatch is proven.

---

# DO NOT DUPLICATE — CODEX ALREADY COMPLETED

GPT and Claude must not redo these merely because they appear in older packets:

1. Worker 1 / Worker 2 onboarding installation.
2. Agent Teams capability discovery.
3. P0-6 static candidate construction.
4. Running-code identity false-green repair.
5. LocalSystem candidate identity preflight.
6. Runtime dirty-state capture/preservation.
7. Nightly Rails root-cause diagnosis.
8. Canonical integration-validator test-lane correction.
9. Existing offline Topstep enum/idempotency/fill/reconnect/position/cancel/flatten/reconciliation work.
10. Healthy/no-op Railway n8n watchdog proof.
11. Preparation of the privileged P0-6 deployment/rollback packet.

Reuse and independently grade these results. Do not ask Codex or Claude to reconstruct them.

---

# GPT NIGHT-SHIFT QUEUE — ACTIVE ORDER

These are **GPT flashlight/research/audit tasks**. They may be worked while Claude is paused because they do not mutate Claude-owned AR-1138 semantic authority.

## GPT-N1 — Fake-Green Hunt

**Priority:** P0

Inspect production-critical test and launch surfaces for false confidence:

- tests that exercise copies/mocks instead of production code;
- tests not routed into canonical lanes;
- swallowed failures or fail-open fallbacks;
- dead-zone controls;
- mocks that make impossible states pass;
- advisory checks incorrectly treated as blocking;
- production routes not reached by the test.

**Output:** bounded findings + exact RED witness + smallest repair packet + mutation/negative control where appropriate.

**Do not edit AR-1138 compiler semantics.**

---

## GPT-N2 — Autonomous Runtime / Vacation-Mode Audit

**Priority:** P0

Audit the real autonomous-readiness surfaces against the requirement that Trading Forge survives unattended operation.

Check:

- manual restart dependencies;
- manual migration dependencies;
- in-memory-only state that dies on restart;
- alerts without auto-remediation;
- stale session/job cleanup;
- service/process recovery;
- credential-expiry recovery;
- operator-required carry-forwards;
- recovery audit trail and alert truth.

**Output:** ranked autonomy gaps and bounded future Worker 2 packets.

---

## GPT-N3 — Reconnect / Crash Matrix

**Priority:** P0

Map existing behavior and missing proof for:

- API/service crash;
- Windows reboot;
- DB disconnect/reconnect;
- WebSocket disconnect/reconnect;
- Massive feed interruption;
- broker/event stream reconnect;
- duplicate replay;
- out-of-order replay;
- crash during state transition;
- crash during recovery itself.

Reuse Codex's already-completed offline reconnect proof. Only identify remaining gaps.

**Output:** deterministic fault matrix + test packet + stop conditions.

---

## GPT-N4 — Position Reconciliation Audit

**Priority:** P0

Inspect the existing reconciliation service and every authoritative position source.

Required scenarios:

```text
internal > external
internal < external
flat internal / open external
open internal / flat external
partial reduction
flip
out-of-order fills
replayed fills
reconnect snapshot disagreement
```

Required safety goal:

```text
detect disagreement
-> stop unsafe new entries
-> reconcile or HALT
-> durable audit
-> actionable alert
```

**Output:** missing production paths/tests only. Do not rebuild already-proven Topstep offline logic.

---

## GPT-N5 — CI / Launch-Gate Audit

**Priority:** P0

Determine which checks are actually blocking versus merely advisory.

Target:

```text
critical production failure
-> CI/launch gate MUST STOP
```

Audit:

- canonical test discovery;
- build gate;
- production isolation;
- compliance/system map;
- runtime identity;
- recovery/cold-start gates;
- PAPER continuity;
- security/secrets;
- workflow failure handling.

**Output:** launch-gate truth table: BLOCKING / ADVISORY / ORPHAN / DUPLICATE / MISSING.

---

## GPT-N6 — Security / Secrets Audit

**Priority:** P0

Static audit only; never expose secrets.

Check:

- tracked credential-like files;
- committed tokens/API keys/secrets;
- `.env` handling;
- log/receipt secret leakage;
- production auth bypasses;
- unsafe default credentials;
- broad token scopes;
- plaintext handoff artifacts;
- GitHub/CI secret handling;
- n8n/Topstep/Massive credential boundaries.

**Output:** secret-safe findings + exact file/path references + smallest fixes/tests.

No token value may be copied into a GPT ruling.

---

## GPT-N7 — 3AM Receipt Chaos Audit

**Priority:** P1

Starting from the already-prepared durable 3AM receipt design, inspect failure cases:

- job crashes before receipt commit;
- receipt committed but report delivery fails;
- duplicate 3AM invocation;
- DB unavailable;
- n8n unavailable;
- restart at 02:59/03:00;
- stale receipt replay;
- same evidence consumed twice;
- partial report publication.

**Output:** idempotent state-machine / receipt contract and exact chaos tests.

---

## GPT-N8 — Strategy Rotation Chaos Audit

**Priority:** P1

Starting from the already-mapped rotation coordinator gap, test the dangerous transition:

```text
Strategy A demoted
-> reserve Strategy B selected
-> assignment changes
-> runtime reconcile
```

Fault points:

- crash after demotion before replacement;
- crash after replacement selection before assignment;
- duplicate coordinator run;
- stale leader runs after newer leader;
- both A and B become active;
- neither A nor B becomes active;
- restart during transaction.

**Output:** one authoritative restart-safe transaction contract + RED/GREEN/chaos controls.

---

## GPT-N9 — 120-Strategy Load-Test Design

**Priority:** P1

Do not run the semantic library before AR-1138 permits it.

Prepare the load-test contract for later execution:

- 120 strategy artifacts;
- shared market-data fanout;
- concurrent PAPER candidates/sessions where authorized;
- scheduler pressure;
- DB write/read pressure;
- memory/CPU/event-loop pressure;
- duplicate suppression;
- queue/backpressure behavior;
- restart under load.

Define explicit PASS / WARN / FAIL thresholds before execution.

**Output:** deterministic benchmark plan, measurements, acceptance thresholds, and smallest instrumentation gaps.

---

## GPT-N10 — One-Strategy Golden Run Contract

**Priority:** P1

Prepare the end-to-end proof harness for exactly one real source strategy:

```text
source video/transcript
-> extraction
-> Graph Engineering
-> Compiler
-> Strategy Factory
-> source-faithful backtest/replay
-> Qualification
-> PAPER
-> execution intent
```

AR-1138 owns the semantic unlock; GPT only prepares the downstream proof contract now.

Required properties:

- source provenance conserved;
- no hand-edited intermediate artifact;
- fail-closed unsupported semantics;
- deterministic replay;
- candidate identity preserved end-to-end;
- exact refusal if no faithful compile;
- no live broker egress during proof.

**Output:** golden-run receipt schema + test sequence + stop conditions.

---

## GPT-N11 — PAPER -> Execution Parity Audit

**Priority:** P1

Audit whether the same qualified strategy decision becomes the same execution intent across PAPER and later broker routing.

Compare:

- strategy/candidate identity;
- symbol/contract;
- side;
- quantity;
- order type;
- limit/stop values where applicable;
- timestamps/correlation IDs;
- risk adjustments;
- duplicate/idempotency keys;
- exit/flatten semantics.

**Output:** parity contract + mismatches + future test packet.

No Topstep network call is authorized by this audit.

---

## GPT-N12 — Topstep Remaining-Gap Map

**Priority:** P2 until paid/network access exists

Reconcile the old go-live register against current code and Codex's completed offline work.

Mark each live-execution item:

```text
SOLVED
PARTIAL
STILL OPEN
STALE/SUPERSEDED
GATED ON PAID ACCESS
```

Do not rebuild offline adapter work.

Do not authorize REST/WebSocket/Practice/Combine/funded/live calls.

**Output:** current exact remaining broker-readiness map only.

---

# GPT GRADING QUEUE — WHEN CLAUDE RETURNS

These are not night-shift research tasks; they are future grading gates.

## G1 — AR-1138 Worker 1 grade

First Claude result to grade.

Inspect real commit/code/tests, then ACCEPT/CORRECT/STOP.

## G2 — Two-worker activation receipt

Only after AR-1138 GPT acceptance.

Verify:

- Worker 1 identity != Worker 2 identity;
- separate lane/inbox/worktree/branch ownership;
- Agent Teams messaging works;
- Worker 2 cannot mutate Worker 1 semantic authority;
- no third Claude context is introduced;
- installed skill hashes still match prepared/accepted sources.

## G3 — P0-6 Phase B live deployment grade

Exact candidate:

`65a53ea95111a469e2324ba2e9df576f605eca99`

Grade:

- clean exact-SHA release source;
- LocalSystem watchdog;
- health <-> direct Git identity parity;
- Full-Lane/Cert-Rig fresh scheduled witnesses;
- cold start/recovery;
- one-time PAPER rehydration;
- duplicate suppression;
- zero broker egress;
- rollback.

## G4 — n8n true-failure branch grade

Do not repeat healthy/no-op proof.

Still required:

- gated unhealthy restart positive control;
- healthy/no-op negative control;
- Discord alert positive control;
- no secret leakage.

---

# GATES THAT REMAIN CLOSED TONIGHT

```text
AR-1138 semantic implementation        = CLAUDE-OWNED / PAUSED
Agent Teams activation                 = CLOSED
Worker 2 implementation                = GATED_IDLE
P0-6 privileged deployment             = CLOSED
P0-6 final GREEN                       = CLOSED
PAPER qualification activation         = CLOSED
Topstep network access                 = CLOSED
Broker egress                          = ZERO
Real live-capital trading              = CLOSED
```

GPT night-shift work may inspect/read/design/grade static repository evidence, but must not pretend these runtime gates are satisfied.

---

# FASTEST SAFE EXECUTION MODEL AFTER RESET

```text
Claude reset
-> Worker 1 resumes exact AR-1138
-> tests / commit / push / report
-> GPT grades AR-1138
-> if ACCEPT: verify + activate distinct 2-worker topology
-> Worker 1 continues GE -> Compiler -> Strategy Factory
-> Worker 2 takes highest-priority disjoint runtime/P0-6 packet
-> GPT grades both lanes independently
```

Prepared GPT packets from this night-shift queue should be handed to Claude only when their prerequisites are satisfied.

## BOTTOM LINE

Codex materially reduced the construction backlog.

GPT's job tonight is now:

```text
FIND THE NEXT REAL HOLES
-> PROVE THEY ARE REAL
-> PRE-SOLVE THE SMALLEST SAFE FIX/TEST PACKETS
-> DO NOT DUPLICATE CODEX
-> DO NOT TOUCH AR-1138 SEMANTIC AUTHORITY
-> HAVE TOMORROW'S WORK READY BEFORE CLAUDE RESETS
```
