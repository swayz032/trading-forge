# GPT EXTERNAL ADVISOR RULING — AR-1182

**Date:** 2026-08-14  
**Type:** GPT FLASHLIGHT / LOAD-TEST DESIGN  
**V4 stage:** Q / AR SUPPORT  
**Status:** BENCHMARK CONTRACT FROZEN — DO NOT RUN BEFORE SEMANTIC/LIFECYCLE GATES

## SIMPLE RESULT

The correct 120-strategy load test is **not 120 WebSockets**.

Current production PAPER stream architecture at accepted candidate `65a53ea95111a469e2324ba2e9df576f605eca99` already does the efficient thing:

```text
one shared Massive WebSocket per symbol
        ↓
one incoming bar
        ↓
find every PAPER session subscribed to that symbol
        ↓
resolve distinct timeframes once
        ↓
fan bar out across session-specific serialized locks
        ↓
update position + evaluate strategy per session
```

The source explicitly discusses the 120-strategy population and notes 1m sessions as a regression anchor.

Therefore the production-capacity proof must exercise this exact fan-out/evaluation/persistence path with 120 concurrent PAPER sessions.

---

# WHAT THE TEST MUST PROVE

Not merely speed.

It must prove all five at once:

```text
1. CORRECTNESS
2. ORDERING
3. NO DROPPED/DOUBLE BARS
4. NO CROSS-SESSION STATE BLEED
5. ENOUGH PERFORMANCE HEADROOM
```

A fast result with wrong trades is failure.

---

# LOAD SHAPE

## Phase A — deterministic controlled fixture

Create 120 PAPER sessions using production session/state services.

Distribute them across the three first-class logical markets:

```text
MES
MNQ
MCL
```

Do not hardcode an invented final distribution as proof of the real library.

Use a deterministic 120-session fixture for engineering stress, then Phase B uses the exact real-library symbol/timeframe census once compiler/Strategy Factory authority supplies it.

The fixture should include:

- repeated sessions on the same symbol/timeframe to stress shared aggregator fan-out;
- 1m sessions;
- multiple higher timeframes supported by the real compiler/library;
- sessions with open PAPER positions;
- sessions flat and evaluating entries;
- sessions whose strategies intentionally produce no signal.

## Phase B — real 120-strategy census

Once the real Strategy Factory library disposition is available after AR-1138/semantic gates:

```text
120 real candidate artifacts
-> exact symbol/timeframe/session configuration
-> same benchmark harness
```

Do not manufacture semantic strategy artifacts simply to hit 120.

---

# DATA INPUT

Use deterministic recorded/synthetic-but-valid 1m bar tape injected through the same bar-processing seam used by the production stream.

Do not spend Massive API quota for the benchmark if replay can exercise the exact downstream path.

Required tape characteristics:

- all three logical markets;
- normal bars;
- session boundary;
- price gaps;
- high/low stop/target touches;
- periods that create signals;
- periods that create no signals;
- enough bars to warm 200-bar buffers and higher-timeframe aggregation.

A second soak profile can run longer tape after the short deterministic benchmark passes.

---

# REAL PRODUCTION SURFACES THAT MUST BE INCLUDED

The benchmark must not replace these with dummy copies unless a specific dependency is deliberately isolated and the full integration profile still exists:

- `paper-trading-stream.ts` session fan-out;
- per-session serialization locks;
- timeframe aggregation;
- signal evaluation;
- PAPER position price/stop/target updates;
- PAPER execution writes;
- audit/correlation writes required by the production path;
- DB reads/writes used by session strategy evaluation.

The benchmark may substitute the external market transport with deterministic replay.

---

# IMPORTANT CURRENT-CODE TESTING TRAP

`processSessionBar()` catches/logs position-update and signal-evaluation exceptions internally.

Therefore:

```text
await handleBar(...)
```

returning successfully is **not proof that all 120 sessions succeeded**.

The harness must collect explicit per-session outcome instrumentation/counters and fail if any session processing error occurred.

Do not create a fake green benchmark where Promise resolution is the only verdict.

---

# REQUIRED METRICS

Per bar and overall:

```text
sessions targeted
sessions completed
sessions errored
sessions skipped
bar fanout wall time
per-session evaluation latency p50/p95/p99/max
per-session queue wait p50/p95/p99/max
max outstanding session queue depth
duplicate bar count
missing bar count
out-of-order bar count
DB write failures
audit write failures
signal count
trade/open/close count
memory before/peak/after
CPU time / event-loop lag if available
```

Per symbol/timeframe:

```text
raw bars in
aggregated buckets out
expected bucket closes
actual bucket closes
```

---

# CORRECTNESS ORACLES

## C1 — single vs 120 parity

Pick representative strategies and replay identical tape:

```text
run strategy alone
vs
run same strategy inside 120-session population
```

Its signals/trades/final state must be identical except for explicitly non-semantic IDs/timestamps.

## C2 — ordering

Every session must observe bars in source order.

## C3 — shared timeframe equality

Two sessions with same symbol+timeframe must observe byte/equivalent same aggregated bucket values.

## C4 — cross-session isolation

Mutating/session state for Strategy A may not change Strategy B unless the shared value is explicitly market-global read-only context.

## C5 — restart repeatability

Run the deterministic replay twice from clean state using the documented replay identity rules.

Semantic results must match.

---

# PERFORMANCE GATE

Do not use one laptop-specific microbenchmark as the universal truth.

### Blocking production-machine gate

On the actual intended PAPER runtime machine, with 120 sessions and three-symbol replay:

```text
sessions errored = 0
missing/duplicate/out-of-order bars = 0
queue backlog at end = 0
p99 complete fanout for one raw 1m bar <= 5 seconds
max fanout < 15 seconds
```

Why:

- raw cadence is 60 seconds;
- p99 <= 5 seconds gives about 12x timing headroom before the next 1m bar;
- max <15 seconds prevents occasional stalls from consuming more than 25% of a bar interval.

If production uses a faster raw cadence later, recalculate the budget against that cadence before launch.

### Soak gate

At least a full representative session replay must show no monotonic memory/queue growth after warmup.

Do not block CI on noisy CPU timing from shared GitHub runners; CI should block on correctness and a generous catastrophic-timeout ceiling. Production-machine certification owns tight latency numbers.

---

# SATURATION STEP

After 120 passes, optionally run:

```text
150
180
240 sessions
```

for capacity discovery only.

The launch requirement remains 120. Extra capacity tells us how much safety margin exists; it is not permission to silently increase production strategy count.

---

# STOP CONDITIONS

Any of these stops the load lane:

- semantic difference between solo and populated replay;
- one dropped or duplicated source bar;
- cross-session state bleed;
- queue growth that does not drain;
- internally logged session errors while benchmark reports green;
- DB/audit failure hidden from verdict;
- use of fake strategy copies instead of the real production evaluation path.

---

# ORDERING

Do not run the real-library Phase B until AR-1138 and Strategy Factory semantics are accepted.

The deterministic infrastructure harness can be implemented later as a disjoint Worker 2 support packet, but P0-6 live hardening remains higher priority immediately after two-worker activation.

## Bottom line

**Benchmark the real shared-socket -> 120-session fan-out path.**

Success means 120 strategies remain semantically identical, ordered, isolated, error-free, and comfortably faster than the next 1-minute bar.