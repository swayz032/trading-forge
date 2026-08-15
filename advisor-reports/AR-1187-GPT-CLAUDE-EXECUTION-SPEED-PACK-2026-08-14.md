# GPT EXTERNAL ADVISOR RULING — AR-1187

**Date:** 2026-08-14  
**Type:** CONTROL / CLAUDE EXECUTION ACCELERATION  
**Status:** STAGED / DOES NOT ALTER AR-1138  
**Branch:** `external-advisor/gpt-rulings`

## DECISION

GPT has staged a second acceleration layer for the two-Claude design.

The remaining avoidable Claude tax was not primarily coding. It was repeated context reconstruction:

```text
reset
-> read many advisor reports
-> infer identity/lane
-> infer active order
-> decide which packet is next
-> rediscover test commands
-> rediscover global safety locks
-> only then begin implementation
```

That repeated work burns Claude tokens and wall-clock time without improving engineering quality.

AR-1187 replaces that startup tax with three small prepared artifacts.

## STAGED ARTIFACTS

### 1. One-screen startup card

`advisor-prepared/two-worker-claude/START-HERE-AFTER-AR-1138.md`

It freezes:
- AR-1138 as the only pre-activation Worker 1 order;
- exact Worker 1 and Worker 2 identities/lanes;
- identity-first startup order;
- Worker 2 default post-activation triage order;
- broker/topstep locks;
- required completion receipt.

### 2. Machine-readable queue

`advisor-prepared/two-worker-claude/EXECUTION-QUEUE.json`

It freezes machine-readable:
- activation prerequisites;
- global locks;
- Worker 1 current and next proof target;
- Worker 2 prioritized packet queue;
- dependency edges;
- special credential-containment rule;
- explicit statement that queue order is routing metadata, not blanket authorization.

### 3. Fast test-command index

`advisor-prepared/two-worker-claude/TEST-COMMAND-INDEX.md`

It maps prepared packets to known repository test/build entrypoints and states exactly where a new RED test is still required.

It includes focused starting commands for:
- AR-1178 auth hardening;
- AR-1175/1176 fill reconciliation;
- AR-1173 fatal rejection teardown;
- AR-1184 PAPER/broker account identity;
- AR-1174 vacation/network honesty;
- AR-1177 exact release-SHA launch authority;
- AR-1171/1172 fake-green CI;
- AR-1182 120-strategy real fan-out load proof;
- AR-1183 one-strategy golden run.

## SPEED LAW

After reset, a worker should not default to reading the whole advisor history.

Preferred load order after identity is established:

```text
START-HERE-AFTER-AR-1138.md
-> own lane manifest
-> EXECUTION-QUEUE.json
-> ONE authorized AR packet
-> only evidence explicitly referenced by that packet
-> TEST-COMMAND-INDEX.md for first RED/GREEN entrypoint
```

Historical reports remain authoritative evidence, but they become lookup material rather than mandatory startup reading.

## WHAT THIS DOES NOT CHANGE

```text
AR-1138 remains first.
Two-worker mode still waits for AR-1138 completion + GPT PASS.
Distinct worker onboarding remains mandatory.
Canonical worker-execution remains shared law.
Broker egress stays OFF.
Topstep live transport stays OFF.
Worker 2 cannot reinterpret source semantics.
Worker 1 cannot silently take runtime/execution ownership.
GPT still independently grades actual repository evidence.
```

## EXPECTED ACCELERATION

This control does not make coding itself magically faster.

It removes repeated non-coding work:
- less history scanning;
- less queue ambiguity;
- less test-command discovery;
- fewer wrong-lane detours;
- fewer worker resets that reload irrelevant context;
- faster handoff after GPT rulings.

The largest benefit should appear after context resets and when Worker 2 consumes the prepared queue of short safety packets.

## NEXT OPTIONAL GPT ACCELERATION LAYER

If additional GPT flashlight time is available, GPT may prepare **implementation maps** for the highest-priority Worker 2 packets without touching production code:

```text
AR-1178
AR-1175
AR-1176
AR-1173
AR-1184
```

Each implementation map can pre-identify:
- exact production function(s);
- exact existing tests to extend;
- smallest new RED fixture;
- forbidden architectural detours;
- expected touched-file boundary;
- completion receipt.

That would turn each packet from "ready to research" into "ready to edit."

## BOTTOM LINE

The two-worker design now has:

```text
DISTINCT IDENTITIES
+ SHARED EXECUTION LAW
+ SEPARATE LANE MANIFESTS
+ ONE-SCREEN START CARD
+ MACHINE-READABLE QUEUE
+ TEST COMMAND INDEX
+ GPT PRE-SOLVED PACKETS
```

This is the correct next speed improvement because it reduces Claude token consumption without weakening RED/GREEN proof, repository evidence, safety gates, or independent GPT review.
