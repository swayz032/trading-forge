# GPT EXTERNAL ADVISOR RULING — AR-1155

**Date:** 2026-08-13  
**Branch:** `external-advisor/gpt-rulings`  
**Audit target commit:** `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Audit target tree:** `46ff2b8778045f15af273a076a60d18210eb6b3e`  
**Parent GPT ruling:** AR-1154 @ `e8090f4f08d760eaa493411e72756b4c3b9b3ed9`  
**Status:** STATIC AUDIT / PRE-ENGINEERING / NO CLAUDE INTERFERENCE  
**Scope:** GPT-P0-2 from AR-1153 only. Claude retains exclusive authority over unfinished AR-1138 compiler/grading work.

---

## 0. EVIDENCE-METADATA CORRECTION

AR-1154 named `46ff2b8778045f15af273a076a60d18210eb6b3e` as its worker audit target. Current GitHub branch metadata proves that value is the **tree SHA**, not the commit SHA.

The current worker branch is:

```text
h1-wave4-sealed12-driver
commit = 5a82f6f51eeb0d6b47976f83a73cfa8446ca0013
tree   = 46ff2b8778045f15af273a076a60d18210eb6b3e
```

This ruling uses the corrected identifiers. No substantive AR-1154 finding changes from that metadata correction.

---

# 1. DECISION

The exact P0-2 finding is:

> **THE CURRENT REPOSITORY DOES NOT HAVE AN OFFICIAL CUSTOM-PAPER QUALIFICATION ACTIVATION FUNCTION.**

Current production authority is still split according to the older design:

```text
TESTING / SHADOW
    -> internal Massive WebSocket simulator

transition to PAPER
    -> stop internal simulator
    -> declare TradersPost canonical journal

PILOT / DEPLOYED
    -> live-capital routing allowed
```

That old PAPER authority is explicitly enforced in multiple independent production paths.

V4, AR-1151, AR-1152, and AR-1154 require a different qualification contract:

```text
heavy historical robustness
-> official custom PAPER qualification
-> 3 valid days minimum / 5 target
-> only then downstream live-capital stages
```

Therefore P0-2 is **not** solved by adding a hash check to `POST /api/paper/start` or by making `startStream()` async.

The smallest robust repair is:

```text
all lifecycle edges INTO PAPER
    -> ONE shared async qualification activation authority
       -> resolve exact executable candidate
       -> resolve exact run/feed environment
       -> resolve deployed runtime revision
       -> set-once / verify identity
       -> close the pre-PAPER session boundary cleanly
       -> create/activate the official qualification session
    -> synchronous startStream()
```

On every restart/recovery:

```text
official PAPER session
    -> SAME identity verifier
    -> if exact match: resume
    -> if missing/mismatch/ambiguous: DO NOT START / DO NOT COUNT DAY
```

Do not create a second PAPER engine. Reuse the existing stream, signal, execution, risk, session, audit, and scheduler infrastructure.

---

# 2. CURRENT AUTHORITY — MEASURED CALL GRAPH

## 2.1 `POST /api/paper/start` is currently PRE-PAPER only

File:

`src/server/routes/paper.ts`

The route initially allows several lifecycle names, then applies the stronger PAPER+ authority guard:

```ts
const PAPER_PLUS_STATES = ["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"];
```

For any of those states it returns 409 with:

```text
paper_start_refused_paper_state
```

and documents:

```text
PAPER+ strategies use TradersPost as canonical journal —
internal simulator is pre-PAPER only.
```

Only the surviving pre-PAPER path inserts `paper_sessions` and calls:

```ts
startStream(session.id, symbols)
```

### Ruling

Do **not** treat this route as the existing official V4 PAPER start seam.

Keep its current TESTING/pre-PAPER utility unless/until a shared activation service is deliberately delegated to it. Do not open a manual bypass around lifecycle qualification gates.

---

## 2.2 Lifecycle transition INTO PAPER is the current authority switch

File:

`src/server/services/lifecycle-service.ts`

The canonical ladder includes:

```text
CANDIDATE -> TESTING -> SHADOW -> PAPER -> DEPLOY_READY -> ...
```

Both legal inbound PAPER edges pass through the same lifecycle service:

```text
TESTING -> PAPER   // legacy direct edge
SHADOW  -> PAPER   // canonical edge
```

The lifecycle service already executes the hard promotion gates before the state transition.

It atomically manages `shadowModeEnabled` around SHADOW transitions.

After a transition where:

```ts
toState === "PAPER"
```

current code explicitly finds an active `paper_sessions` row and calls:

```ts
await stopStream(activeSessId)
```

then emits:

```text
paper.engine_authority_declared
```

with `transitioned_to: "PAPER"`.

The surrounding comments state that TradersPost becomes canonical at PAPER and the internal simulator must stop to avoid dual-stream P&L corruption.

### Ruling

**This is the correct orchestration neighborhood for official V4 PAPER activation, but the old authority action inside it is stale relative to the new V4 custom-PAPER contract.**

Do not bolt identity onto an unrelated route while leaving this transition semantics untouched.

---

## 2.3 Boot recovery independently refuses to resume PAPER internal streams

File:

`src/server/scheduler.ts`

Boot calls:

```text
resumeActivePaperSessions()
```

The function declares:

```ts
const PAPER_PLUS_STATES = new Set(["PAPER", "DEPLOY_READY", "PILOT", "DEPLOYED"]);
```

and skips internal-stream resurrection when the strategy is in one of those states.

The code explicitly logs that only pre-PAPER sessions are resumed.

### Ruling

After the V4 authority update, official `PAPER` must be handled separately from `DEPLOY_READY`, `PILOT`, and `DEPLOYED`.

Do **not** globally delete this safety guard.

Target behavior:

```text
PAPER
    -> may resume CUSTOM qualification stream only after identity verification

DEPLOY_READY / PILOT / DEPLOYED
    -> must NOT be resurrected as custom PAPER streams
```

---

## 2.4 `failed_to_stream` auto-recovery has an unsafe ordering for future qualification

File:

`src/server/scheduler.ts`

The stale-session recovery path currently:

```text
write restart-attempt audit
-> UPDATE paper_sessions.status = active
-> startStream(...)
```

This is acceptable for current pre-PAPER simulation but is wrong for official V4 qualification because `active` would be restored before qualification identity has been reverified.

### Ruling

For an official PAPER session, recovery order must become:

```text
read session
-> verify candidate/run/runtime identity
-> verify feed/recovery prerequisites
-> only then mark qualification-active / active
-> startStream(...)
```

A mismatch must leave the session non-countable and must not overwrite its original identity stamp.

---

## 2.5 `startStream()` must remain synchronous

File:

`src/server/services/paper-trading-stream.ts`

Production signature:

```ts
export function startStream(sessionId: string, symbols: string[]): void
```

Its `paper_stream.started` audit is intentionally fire-and-forget/nonblocking.

### Ruling

**DO NOT PUT DB IDENTITY WORK IN `startStream()`.**

Do not change this primitive to async merely for qualification identity.

The async verifier/orchestrator must complete first; only then call the existing synchronous stream primitive.

---

# 3. EXECUTABLE CANDIDATE AUTHORITY — REUSE, DO NOT COPY

File:

`src/server/services/paper-signal-service.ts`

The runtime session-loader already defines the executable translation chain:

```text
strategy.config
-> isDSLStrategy(...)
-> translateDSLToPaperConfig(...)
-> StrategyConfig
-> CachedSession.config
-> evaluateSignals(...)
```

AR-1152 already froze the complete candidate projection:

```text
paper-candidate-v1

strategy_id
strategy_name
symbol
timeframe
executable_config       // AFTER the SAME runtime translation
live_exit_plan_config   // dedicated strategies.exitPlanConfig
```

### Ruling

Create no second translator and no hand-maintained subset of strategy config fields.

Extract or expose a pure/shared runtime projection helper from the same semantic path so both:

```text
paper execution
and
paper candidate hashing
```

consume the same translated config authority.

A copied translator is forbidden because translator drift would make the hash certify different semantics than the engine executes.

---

# 4. LIVE EXIT AUTHORITY

The official candidate hash must include the dedicated top-level live exit configuration:

```text
strategies.exitPlanConfig
```

not merely a historical copy nested inside strategy JSON.

This requirement remains unchanged from AR-1152.

Mutation of only the dedicated exit configuration must invalidate candidate identity.

---

# 5. RUN/ENVIRONMENT AUTHORITY

Do not hash sparse request JSON as the run identity.

The official run fingerprint must use **resolved effective values** actually consumed during qualification.

At minimum preserve the AR-1152 v1 contract:

```text
paper_candidate_hash
mode = paper
firm_id

resolved session config:
- side
- cooldown_bars
- daily_loss_budget
- bypass_news_blackout
- fill_model_enabled
- latency_ms
- firm_key
- trailing_dd_amount

resolved feed identity:
- feed mode
- nominal delay
- root / stream symbol(s)
- provider contract ticker(s)

runtime_revision
```

### Important dependency

P0-3 still owns the final Massive Futures feed/contract resolver and cold-start warmup contract.

P0-2 should define the interface now, but **official qualification must fail closed until P0-3 can supply resolved feed authority**.

Do not substitute a root symbol or guessed provider ticker just to make the hash computable.

---

# 6. RUNTIME REVISION AUTHORITY

This audit did not find a proven canonical runtime-revision resolver on the current worker branch.

Do not infer the executing build from GitHub HEAD at receipt/report time.

### Smallest robust contract

Add one tiny normalized resolver, conceptually:

```ts
resolveRuntimeRevision(): string | null
```

Official qualification requires a non-empty deploy-stamped revision.

Preferred normalized source:

```text
TF_RUNTIME_REVISION
```

The deployment pipeline/platform may populate that value from its real deployed commit/build identifier, but application code should consume one normalized contract rather than knowing many platform-specific environment names.

Rules:

```text
TF_RUNTIME_REVISION present
    -> use exact immutable value

missing
    -> official PAPER activation BLOCKED
```

No fallback to:

- current GitHub branch HEAD;
- package version;
- wall-clock build time;
- an arbitrary source-tree hash generated later.

The executing process must tell us what build it is.

---

# 7. EXACT TARGET SERVICE / SEMANTIC AUTHORITY

Create one narrow shared authority — name may follow repo convention, but semantics must be singular.

Recommended surface:

```text
paper-qualification-activation-service.ts
```

with two conceptual operations:

```text
prepare/activate official qualification
verify existing official qualification session
```

It must NOT become a second engine.

It owns only:

```text
candidate projection
+ run projection
+ runtime revision
+ set-once stamp / compare
+ activation eligibility result
```

It delegates actual streaming/execution to existing services.

### Required result type

Conceptually:

```text
GREEN
    exact identity proven; activation/resume may proceed

BLOCKED
    missing or mismatched identity/feed/runtime evidence;
    no official activation/resume
```

Do not use a permissive `unknown -> continue` state.

---

# 8. SET-ONCE PERSISTENCE — REUSE `paper_sessions.config` + AUDIT SPINE

Reuse the AR-1152 storage contract:

```text
paper_sessions.config.qualification_identity
```

Example semantic contents:

```text
schema_version
candidate_hash
run_config_hash
runtime_revision
stamped_at
qualification_started_at
```

The append-only `audit_log` must preserve the canonical candidate projection and resolved run projection used to compute those hashes.

### First official activation

```text
no stored qualification identity
-> compute exact projections
-> persist identity ONCE
-> persist immutable identity snapshot audit
-> activation may proceed only after both durable writes succeed
```

For this specific qualification identity write, audit persistence is **not** optional telemetry. It is part of the proof chain.

Do not use the normal fire-and-forget audit pattern for the set-once identity snapshot.

### Restart/resume

```text
stored identity exists
-> recompute candidate/run/runtime
-> exact compare

all match
-> GREEN

any mismatch
-> append mismatch evidence
-> BLOCK
-> do not overwrite old stamp
```

The system must never “heal” an identity mismatch by replacing the original hash.

---

# 9. CLEAN PRE-PAPER -> OFFICIAL PAPER SESSION BOUNDARY

The current transition stops the internal stream but can leave a stale `paper_sessions.status='active'` row that boot recovery later recognizes and skips as PAPER+.

That stale-row pattern is not an acceptable official qualification boundary.

### Fastest robust target

At successful transition into official V4 PAPER:

```text
existing TESTING/SHADOW simulation session
-> close/stop it as PRE-PAPER evidence
-> preserve its historical rows

then

create one fresh official qualification session
-> mode = paper
-> lifecycle assertion = PAPER
-> shadow disabled
-> carry only resolved STATIC run configuration needed for the new run
-> stamp qualification identity
-> start official custom stream
```

Why a fresh session is preferred:

- pre-PAPER equity/trade counters do not contaminate qualification;
- pre-PAPER signal rows remain clearly historical;
- 3–5 day receipt window gets one clean session anchor;
- restart logic has an unambiguous official session;
- the existing unique active-session-per-strategy invariant can remain useful.

Do not delete or rewrite the pre-PAPER session history.

If implementation evidence proves a fresh row is materially more dangerous than a partitioned existing row, Claude may return with that evidence for review. Do not silently reuse a mixed TESTING/SHADOW session as official qualification without an explicit boundary contract.

---

# 10. THREE-PHASE ACTIVATION ORDER

The target order should be explicit.

## Phase A — PREPARE, before PAPER becomes active

Resolve and validate:

```text
strategy row
-> exact runtime-translated executable config
-> dedicated live exit config
-> candidate hash
-> resolved session defaults
-> resolved feed/provider identity
-> runtime revision
-> run hash
```

Any missing required authority = BLOCK.

## Phase B — COMMIT qualification boundary

Within the narrowest safe transactional unit:

```text
verify expected source lifecycle edge
-> terminate/close previous pre-PAPER active session boundary
-> transition strategy to PAPER + shadow false
-> create official qualification session
-> write set-once qualification identity
-> write immutable identity audit snapshot
```

Use existing optimistic lifecycle-state guard and one-active-session uniqueness rather than inventing a second lock authority.

If existing transaction structure cannot atomically include all of these without invasive refactor, preserve the same safety invariant with an explicit non-countable intermediate state and return for review. Never expose a countable session before identity durability succeeds.

## Phase C — START

Only after Phase B succeeds:

```text
startStream(officialSessionId, resolvedSymbols)
```

`startStream()` stays synchronous.

If stream startup fails:

```text
session -> failed_to_stream / non-countable
identity stamp remains immutable
restart path must reverify before retry
```

Do not roll back the historical identity snapshot just because the external feed failed after commit.

---

# 11. RESTART / BOOT ORDER

For an active official PAPER qualification session at process boot:

```text
load session + stored qualification_identity
-> load current strategy
-> recompute exact executable candidate
-> resolve effective run/feed environment
-> resolve current runtime revision
-> compare all three identities
-> verify pending-entry/feed recovery prerequisites
-> only if GREEN call startStream()
```

Mismatch or missing authority:

```text
NO startStream
NO day counting
write qualification_identity_mismatch / resume_blocked evidence
operator/Claude investigation required
```

Do not let `paper_sessions.status='active'` alone imply the run is qualification-valid.

---

# 12. FAILED-STREAM RETRY ORDER

For an official PAPER row in `failed_to_stream`:

Current pre-PAPER ordering must not be reused blindly.

Target:

```text
failed_to_stream
-> check retry cap
-> verify SAME qualification identity
-> verify current runtime revision
-> verify feed resolver/warmup authority
-> if GREEN: transition to active and start stream
-> else remain blocked/non-countable
```

The existing retry-cap / warning infrastructure is reusable.

Do not create another retry scheduler.

---

# 13. MANUAL ROUTE POLICY

`POST /api/paper/start` should not become a shortcut around lifecycle gates.

Fastest safe choice:

```text
keep /api/paper/start = TESTING/pre-PAPER simulator utility
```

Official qualification is entered through lifecycle promotion and the shared activation authority.

If a future operator endpoint is needed to retry an already-approved PAPER session, it must call the SAME verifier/service and cannot accept arbitrary candidate identity from the request body.

Never let the client tell the server which hash should be trusted.

---

# 14. CAPITAL-SAFETY BOUNDARY MUST REMAIN UNCHANGED

Files inspected:

- `src/server/services/server-mediated-executor.ts`
- `src/server/routes/live-order.ts`

Current live-capital authority is correctly restricted to:

```ts
LIVE_EXECUTION_STATES = new Set(["DEPLOYED", "PILOT"])
```

PAPER is simulation-only.

### Ruling

The V4 custom-PAPER repair must **NOT** add PAPER to `LIVE_EXECUTION_STATES`.

Do not weaken the `/api/live-order` lifecycle gate.

Do not route official PAPER qualification orders to real capital merely because PAPER now uses the internal custom engine.

The intended boundary remains:

```text
PAPER = qualification simulation
PILOT / DEPLOYED = live-capital-capable states under existing broker safeguards
```

---

# 15. REQUIRED RED -> GREEN TEST PACKET

Claude should not implement this from prose alone. Minimum evidence after AR-1138:

## Identity unit/mutation tests

1. mutate entry/trigger/confluence config outside legacy five-field hash -> candidate hash changes;
2. mutate only dedicated `exitPlanConfig` -> candidate hash changes;
3. rename strategy -> candidate hash changes;
4. symbol mutation -> candidate hash changes;
5. timeframe mutation -> candidate hash changes;
6. JSON key order only -> candidate hash unchanged;
7. resolved run-default change -> candidate unchanged, run hash changes;
8. runtime revision change -> candidate/run inputs unchanged but continuity invalidates.

## Real activation seam tests

9. canonical `SHADOW -> PAPER` cannot produce a qualification-active session before verifier GREEN;
10. legacy `TESTING -> PAPER` uses the exact same verifier;
11. missing runtime revision blocks official activation;
12. unresolved provider/feed identity blocks official activation;
13. first valid activation stamps identity once and writes immutable snapshot evidence;
14. concurrent activation attempts produce one official active session / one set-once identity;
15. identity-persistence failure cannot produce a countable PAPER session;
16. immutable snapshot audit failure cannot produce a countable PAPER session.

## Restart tests

17. same candidate + run + runtime on restart -> verifier GREEN and stream can start;
18. candidate mutation after stamp -> resume blocked, old stamp unchanged;
19. dedicated exit mutation -> resume blocked;
20. resolved environment mutation -> resume blocked through run hash;
21. runtime deploy mutation -> resume blocked;
22. missing stamp on an alleged official session -> resume blocked, not auto-created silently on restart.

## Scheduler/retry tests

23. boot `PAPER` path verifies before `startStream()`;
24. `failed_to_stream` PAPER retry verifies before status becomes qualification-active;
25. `DEPLOY_READY`, `PILOT`, `DEPLOYED` are still never resurrected as custom PAPER streams;
26. retry cap/alert behavior remains intact.

## Capital-safety controls

27. `server-mediated-executor` still refuses live routing for PAPER;
28. `/api/live-order` still rejects PAPER strategy IDs;
29. SHADOW still cannot contact broker routing;
30. pre-PAPER TESTING `/api/paper/start` behavior remains backward-compatible unless deliberately routed through the shared service.

## Mutation control

31. remove/bypass the verifier from ONE real activation/resume path and prove an integration test fails.

A green helper test without this production-path mutation witness is insufficient.

---

# 16. IMPLEMENTATION ORDER AFTER AR-1138

Do not implement this while Claude owns unfinished compiler state.

After AR-1138 reaches its pushed decision point, the smallest safe order is:

```text
1. shared executable-candidate projection helper
2. canonical sorted-json SHA-256 helper for paper-candidate-v1 / paper-run-v1
3. tiny runtime revision resolver
4. extend PaperSessionConfigShape with qualification_identity
5. shared prepare/verify qualification service
6. wire both inbound PAPER lifecycle edges through prepare step
7. replace stale PAPER authority switch with clean custom-PAPER session boundary
8. boot PAPER resume -> verifier -> startStream
9. failed_to_stream PAPER retry -> verifier -> active/start
10. P0-3 feed resolver plugs into run identity
11. AR-1154 daily receipt consumes the three identity values
12. AR-1151 counts only receipt-valid days
```

Do not combine this with broad lifecycle refactoring.

Do not redesign broker routing.

Do not migrate the legacy frozen-policy hash.

Do not add another scheduler.

---

# 17. STOP CONDITIONS FOR CLAUDE

Stop and report instead of guessing if any of these occur:

1. no single runtime translation helper can be shared without changing executable semantics;
2. current lifecycle transaction cannot preserve a clean pre-PAPER / official-PAPER boundary without exposing a countable half-state;
3. the current database cannot create a fresh official session while preserving pre-PAPER history without violating a measured invariant;
4. runtime revision cannot be provided by the deployed process;
5. P0-3 cannot resolve the provider contract/feed authority deterministically;
6. an existing intended custom-PAPER activation implementation appears on a newer worker commit and supersedes this static map.

If one fires, bring repository evidence back to the advisor. Do not invent a second authority.

---

# 18. STATUS / DISPOSITION

```text
P0-2 activation seam trace                    COMPLETE
current official custom-PAPER start service   NOT PRESENT
current /api/paper/start                      PRE-PAPER ONLY
current lifecycle PAPER authority             STALE FOR V4 CUSTOM PAPER
current boot PAPER internal resume             INTENTIONALLY BLOCKED BY OLD DESIGN
startStream synchronous contract              KEEP
runtime executable config authority           PROVEN / REUSE
live exit config authority                    PROVEN / REUSE
candidate/run identity contract               FROZEN BY AR-1152
runtime revision resolver                     MISSING / SMALL P0 JOIN
set-once session JSONB + audit design          REUSE
capital routing for PAPER                     MUST REMAIN BLOCKED
Claude AR-1138 files                           UNTOUCHED
```

---

# 19. BOTTOM LINE

P0-2 found the exact hidden timeline risk:

**The repo currently reaches PAPER by shutting OFF the engine V4 now needs for custom PAPER qualification.**

That is not a reason to rebuild PAPER.

It is a bounded authority update across known seams:

```text
lifecycle enters PAPER
-> prove exact candidate
-> prove exact run/feed environment
-> prove exact deployed runtime
-> set-once identity
-> clean fresh qualification session
-> custom PAPER stream starts

restart
-> prove all three again
-> same = resume
-> different/unknown = stop
```

And the capital wall stays intact:

```text
PAPER != live money
PILOT / DEPLOYED remain the only live-execution states
```

This removes the discovery burden from Claude while preserving fast/robust engineering and the current capital-safety architecture.