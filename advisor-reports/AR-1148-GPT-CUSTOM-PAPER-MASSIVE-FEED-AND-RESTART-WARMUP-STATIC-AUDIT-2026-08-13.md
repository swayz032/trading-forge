# AR-1148 — GPT STATIC AUDIT: CUSTOM PAPER MASSIVE FEED + RESTART WARMUP

**Date:** 2026-08-13  
**Runtime lineage inspected:** `main` at `64bd430810dc73e4206f8221792c922364eeec0f`  
**External verification:** current official Massive Futures documentation checked 2026-08-13.  
**Compiler lane:** untouched; Claude remains mid-order on AR-1138.

## 1. WebSocket protocol: core choice is now verified

Current `src/data/fetchers/massive.ts` subscribes to futures minute aggregates with channel `AM` and defaults the WebSocket to:

```text
wss://delayed.massive.com/futures
```

Current official Massive Futures WebSocket documentation now confirms both:

```text
host: wss://delayed.massive.com/futures
minute channel: AM
```

The repo fixture README still labels the exact futures WebSocket path as unconfirmed; that documentation is now stale and can be updated later. No redesign is required for this specific WebSocket host/channel choice.

## 2. The custom engine is statically pinned to the delayed feed

`paper-trading-stream.ts::getMassiveFetcher()` currently constructs the fetcher with only:

```text
{ apiKey }
```

No WebSocket base URL/feed mode is supplied.

`massive.ts::createWebSocket()` therefore falls back to `wss://delayed.massive.com/futures` every time.

Current official Massive pricing/docs show Futures Starter ($29) minute/second WebSockets as **10-minute delayed**; Futures Advanced is the real-time individual plan.

### Important consequence

Changing the subscription alone would not automatically make the custom PAPER engine real-time: the current adapter still selects the delayed socket unless its feed URL selection is changed/configured.

Treat feed recency as an explicit PAPER environment property, not something inferred from the account subscription.

## 3. REST backfill adapter is incompatible with the current official Futures REST API

Current `massive.ts::fetchBars()` defaults to:

```text
base URL: https://api.massive.io/v1
request: /bars?symbol=...&timeframe=...&from=...&to=...
response expectation: data.bars[] with timestamp/open/high/low/close/volume
```

Current official Massive Futures REST documentation uses:

```text
host: https://api.massive.com
endpoint: /futures/v1/aggs/{ticker}
bar-size parameter: resolution=1min (etc.)
response array: results[]
bar time field: window_start (Unix nanoseconds)
```

This is not a cosmetic hostname difference; the path, query contract, response envelope, and timestamp representation differ.

### Verdict

The current custom PAPER REST backfill path must be treated as **not certified against the current Futures REST contract** until updated and exercised with a real fixture/live smoke.

## 4. Cold process restart has an additional warmup gap even before REST repair

The custom stream's `barBuffer` is process-local memory.

On a process restart:

```text
barBuffer starts empty
-> scheduler resumes the PAPER stream
-> WebSocket connects
-> connected handler asks whether the buffer already contains bars
-> REST backfill is started only when a prior in-memory buffer exists
-> cold restart therefore has no historical buffer to trigger backfill
```

`startStream()` simply registers the session/symbol and ensures the socket; it does not pre-warm the rolling bar buffer from persistent history.

### Why this matters

The custom engine derives rolling indicator/context state from that buffer. A cold restart can therefore re-enter PAPER with restored session/position state but a cold market-context window that must rebuild bar by bar.

That breaks the desired invariant that an application restart is behaviorally equivalent to uninterrupted PAPER operation.

## 5. Same-process reconnect and cold restart are different failure classes

Current code does attempt REST backfill on a WebSocket reconnect **inside the same process** when the symbol already has buffered bars. It also buffers newly arriving WebSocket bars while backfill runs, then replays them in timestamp order.

That design is useful and should be preserved.

But two separate fixes/evidence checks are required:

```text
A. SAME-PROCESS WS RECONNECT
   -> repair current REST adapter contract
   -> prove gap bars are restored once, in order

B. COLD PROCESS RESTART
   -> explicitly warm the required historical window before candidate evaluation resumes
   -> prove indicator/context state reaches the intended baseline before a qualification interval is counted
```

Do not treat A as proof of B.

## 6. Contract-ticker resolution remains a separate P0 data-identity requirement

Official Massive futures feeds require a **listed futures contract ticker**, and their Contracts API is the canonical way to discover active listed contracts.

The repo's own fixture README already records that root-symbol -> dated-contract resolution was not implemented in the adapter.

Current custom stream passes the strategy/session symbol to `createWebSocket([symbol], ...)` verbatim, and the fetcher subscribes to `AM.<that symbol>` verbatim.

Before official PAPER, the data receipt must prove that each logical product maps to the intended listed contract and that the mapping/roll decision is recorded. Do not guess a contract-code formula when the provider exposes a reference endpoint for this purpose.

## 7. What the $29 delayed feed can and cannot prove

A 10-minute delayed minute-aggregate feed can still be useful for deterministic **strategy-behavior PAPER** if the engine consistently evaluates by the bar's market timestamp and the qualification explicitly records that the feed is delayed.

It does **not by itself** prove real-time operational timing/latency readiness for the later execution environment.

Therefore keep two evidence claims separate:

```text
CUSTOM PAPER STRATEGY QUALIFICATION
- candidate logic/state behavior
- simulated fills/risk accounting
- restart durability
- 3AM learning-loop evidence

REAL-TIME EXECUTION READINESS
- current-timestamp feed arrival
- event timing/latency
- downstream execution connectivity and controls
```

A delayed custom PAPER run must never be mislabeled as proof of the second claim.

## 8. Fastest bounded engineering acceptance contract

Do not rebuild the market-data layer. Close four narrow joins:

1. **REST contract repair** — current official futures aggregate endpoint + response/timestamp parser.
2. **Listed-contract resolver** — use provider reference data and persist the chosen ticker/roll receipt.
3. **Cold-start warmup** — populate the required rolling bar/context window before a resumed PAPER session is considered qualification-ready.
4. **Feed-recency receipt** — record delayed vs real-time mode so qualification reports cannot confuse the two.

Then run one controlled evidence test:

```text
warm session
-> disconnect/reconnect
-> prove exact ordered gap repair
-> process restart
-> prove cold warmup to equivalent indicator/context state
-> resume same frozen candidate
-> no duplicate qualifying signal/trade state
```

## 9. Verdict

- Massive futures delayed WebSocket host: **CURRENTLY VERIFIED**.
- Futures minute channel `AM`: **CURRENTLY VERIFIED**.
- $29 Starter WebSocket recency: **10-MINUTE DELAYED**.
- Current custom engine feed selection: **PINNED TO DELAYED HOST BY DEFAULT**.
- Current REST backfill implementation vs current Massive Futures REST API: **CONTRACT MISMATCH / NOT CERTIFIED**.
- Same-process reconnect buffering architecture: **USEFUL FOUNDATION**.
- Cold-process historical warmup: **NOT FOUND**.
- Listed contract-ticker resolver on this custom feed path: **NOT FOUND**.
- Restart-equivalent market-context state: **NOT YET CERTIFIED**.

**Advisor directive:** carry REST repair + contract resolution + cold-start warmup + feed-recency stamping as bounded P0 custom-PAPER readiness work. Do not interrupt AR-1138 and do not broaden this into a market-data rewrite.