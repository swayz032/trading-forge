# GPT EXTERNAL ADVISOR RULING — AR-1156

**Date:** 2026-08-13  
**Branch:** `external-advisor/gpt-rulings`  
**Audit target commit:** `5a82f6f51eeb0d6b47976f83a73cfa8446ca0013`  
**Audit target tree:** `46ff2b8778045f15af273a076a60d18210eb6b3e`  
**Parent GPT ruling:** AR-1155 @ `a4f56596737cba71a0c3a56ab81a53dd6b923b1e`  
**Status:** STATIC AUDIT / READY-TO-CODE WORK ORDER / NO CLAUDE INTERFERENCE  
**Scope:** GPT-P0-3 from AR-1153 only. Claude retains exclusive authority over unfinished AR-1138 compiler/grading work.

---

# 1. DECISION

P0-3 is now frozen as a ready-to-code work order.

The exact finding is:

> **THE EXISTING MASSIVE FUTURES INTEGRATION IS REUSABLE IN SHAPE, BUT ITS PROVIDER CONTRACT IS STALE IN BOTH REST AND WEBSOCKET, AND THE CUSTOM PAPER PATH HAS NO DETERMINISTIC ROOT-SYMBOL → LISTED-CONTRACT RESOLUTION OR TRUE COLD-START WARMUP.**

Do **not** build another market-data system.

The smallest robust repair is:

```text
strategy logical root (MES / MNQ / MCL)
    ↓
Massive listed-contract resolver
    ↓
resolved provider ticker (example shape: MESU6)
    ↓
Massive Futures REST v1 warmup
    ↓
delay-aware feed-recency proof
    ↓
AR-1155 qualification identity/run stamp
    ↓
existing synchronous paper stream
    ↓
existing signal/execution/risk engine
```

The critical design law is:

```text
logical_symbol != provider_ticker
```

The strategy must remain logically `MES`, `MNQ`, or `MCL`; Massive must receive the exact listed contract ticker selected for the run. A futures roll must never silently mutate the strategy's semantic symbol or silently continue the same qualification run under a different provider contract.

---

# 2. CURRENT OFFICIAL MASSIVE CONTRACT — REVALIDATED 2026-08-13

External provider facts in this ruling were revalidated against Massive's official current documentation on 2026-08-13. These are provider facts, not remembered assumptions.

## 2.1 Futures REST aggregates

Official documentation:

`https://massive.com/docs/rest/futures/aggregates`

Current endpoint:

```text
GET https://api.massive.com/futures/v1/aggs/{ticker}
```

Important current contract:

```text
path ticker = LISTED futures contract ticker
example = GCJ5

resolution = 1min / 1session / etc.
window_start = date or Unix NANOSECONDS
limit = default 1000, max 50000
sort = e.g. window_start.desc
response rows = results[]
```

Current aggregate row includes at least:

```text
ticker
window_start
open
high
low
close
volume
transactions
session_end_date
```

`window_start` is a nanosecond Unix timestamp in REST results.

## 2.2 Futures WebSocket minute aggregates

Official documentation:

`https://massive.com/docs/websocket/futures/aggregates-per-minute`

For the delayed individual feed documented for Starter:

```text
wss://delayed.massive.com/futures
```

Authentication is message-based:

```json
{"action":"auth","params":"YOUR_API_KEY"}
```

Minute aggregate subscription is topic-based:

```json
{"action":"subscribe","params":"AM.<LISTED_TICKER>"}
```

Official minute event shape includes:

```text
ev = "AM"
sym = listed contract ticker
v = volume
o = open
h = high
l = low
c = close
s = window-start Unix MILLISECONDS
e = window-end Unix MILLISECONDS
```

Do not copy the REST timestamp unit into the WebSocket parser. REST `window_start` is nanoseconds; WS `s/e` are milliseconds.

## 2.3 Futures Starter plan

Official current pricing:

`https://massive.com/pricing?product=futures`

As revalidated 2026-08-13, Futures Starter is:

```text
$29/month
All Futures Tickers
Unlimited API Calls
2 Years Historical Data
CME / CBOT / NYMEX / COMEX
10-minute Delayed Data
Reference Data
Minute Aggregates
WebSockets
Snapshot
Second Aggregates
```

Therefore:

> **Starter is valid for delayed custom-PAPER pipeline / strategy / restart-integrity qualification, but it is NOT evidence of real-time execution latency.**

Do not call delayed PAPER latency proof.

## 2.4 Futures contracts reference authority

Official documentation:

`https://massive.com/docs/rest/futures/contracts`

Current endpoint:

```text
GET /futures/v1/contracts
```

It supports point-in-time contract lookup using filters including:

```text
date
product_code
ticker
active
type
first_trade_date
last_trade_date
limit
sort
```

Returned contract metadata includes:

```text
ticker
product_code
active
type
first_trade_date
last_trade_date
days_to_maturity
trading_venue
```

This endpoint is the correct provider-side authority for discovering listed Massive tickers.

---

# 3. CURRENT REPOSITORY MASSIVE ADAPTER IS STALE — MEASURED

File:

`src/data/fetchers/massive.ts`

Current implementation defaults to:

```text
https://api.massive.io/v1
```

and `fetchBars()` constructs:

```text
/base/bars?symbol=...&timeframe=...&from=...&to=...
```

then expects:

```ts
data.bars
```

That is not the current Massive Futures aggregate contract.

Current official Futures history is:

```text
/futures/v1/aggs/{listedTicker}
response.results[]
window_start in nanoseconds
```

### Ruling

Repair the existing fetcher. Do not add a parallel `massive-futures-v2.ts` engine unless a measured code constraint makes that unavoidable.

The normalized internal `Bar` surface should stay stable.

---

# 4. CURRENT WEBSOCKET ADAPTER IS ALSO STALE — MEASURED

The same `massive.ts` currently:

- defaults to `wss://stream.massive.io/v1/stream`;
- sends API credentials through a WebSocket Authorization header;
- sends subscription payload `{ action: "subscribe", symbols }`;
- expects a generic message shape with `symbol`, `timestamp`, `open`, `high`, `low`, `close`, `volume`.

Current official Futures minute WebSocket instead uses:

```text
host: wss://delayed.massive.com/futures   // Starter delayed lane
message auth: {action:"auth",params:"..."}
subscription: AM.<listed ticker>
event: ev="AM", sym, o/h/l/c/v, s/e
```

### Ruling

The Massive repair must cover REST **and** WebSocket in the same provider-adapter patch.

A REST-only fix is incomplete and must not be marked P0-3 GREEN.

---

# 5. EXACT TWO-NAME SYMBOL CONTRACT

The existing PAPER engine currently treats one string as both:

```text
strategy symbol identity
and
provider subscription identity
```

That must be split at the provider boundary.

Freeze this minimal semantic type:

```ts
interface ResolvedMassiveFuturesSubscriptionV1 {
  logical_symbol: "MES" | "MNQ" | "MCL";
  provider_ticker: string;
  product_code: string;
  feed_mode: "delayed" | "realtime";
  nominal_delay_seconds: number;
  resolved_as_of_trading_date: string;
  resolution_policy_version: "massive-front-contract-v1";
}
```

Field names may follow repo naming conventions; semantics may not change.

## Logical symbol

Stable Trading Forge strategy identity:

```text
MES
MNQ
MCL
```

This remains the symbol seen by:

- strategy configuration;
- signal evaluator;
- risk engine;
- context/SMT plumbing that is keyed on root symbols;
- PAPER trade/session evidence;
- candidate identity.

## Provider ticker

Exact Massive listed contract used for provider calls, e.g. shape:

```text
MESU6
```

This is used only at the data-provider boundary and is stamped into the PAPER run identity.

### Forbidden shortcut

Do not globally replace strategy root `MES` with `MESU6`.

A provider roll must not rename the strategy or silently alter source semantics.

---

# 6. MASSIVE LISTED-CONTRACT RESOLVER — DETERMINISTIC V1 POLICY

No measured production Massive-specific listed-contract resolver was found in the audited worker tree.

The existing `contract-specs-service.ts` is useful but it serves a different authority:

```text
Databento Definition / hardcoded fallback
-> multiplier
-> tick size
-> point value
-> expiry/spec metadata
```

Do not make it pretend to be Massive ticker authority.

Use Massive's own Contracts API for Massive ticker discovery.

## 6.1 Supported P0 scope

Official custom PAPER v1 supports only:

```text
MES
MNQ
MCL
```

An unrecognized root fails closed until explicitly added with tests.

## 6.2 Candidate discovery

For qualification trading date `D`:

```text
GET /futures/v1/contracts
  date=D
  product_code=<logical root>
  active=true
  type=single
  sort=last_trade_date.asc
```

Use a bounded candidate set of the nearest active single contracts. The implementation may use a fixed bounded limit (recommended <= 20) rather than hard-coding one quarterly cycle assumption.

Filter out rows with:

```text
missing ticker
active != true
type != single
last_trade_date < D
```

If none remain: BLOCK.

## 6.3 Deterministic front-contract authority

Do not select the provider ticker from whichever result happened to arrive first.

For each bounded active candidate, query the most recent **completed prior session** aggregate:

```text
GET /futures/v1/aggs/{ticker}
resolution=1session
sort=window_start.desc
```

Exclude any still-in-progress current session.

Choose the listed contract with the greatest prior completed-session `volume`.

Why prior completed-session volume:

- it is provider-grounded;
- it tracks actual trading activity rather than merely nearest expiry;
- it stays stable throughout the next qualification session;
- process restart during the same session cannot flip contracts just because current-session volume changed intraday.

This is a **Trading Forge deterministic selection policy**, not a claim that Massive itself defines "front month" this way.

## 6.4 Ambiguity / refusal

Fail closed if:

```text
no active single contracts
no candidate with positive completed-session volume
provider contract response malformed
provider ticker missing
completed-session authority cannot be established
highest-volume authority is unresolved/ambiguous
```

Do not guess the ticker from the month code or current calendar month.

## 6.5 Run continuity at roll

The selected `provider_ticker` belongs in `paper-run-v1`, not `paper-candidate-v1`.

Therefore:

```text
same strategy + MESU6
    -> same candidate identity

same strategy + MESZ6 after roll
    -> candidate hash unchanged
    -> run/feed hash changes
```

During an official 3–5 day qualification chain, a provider-ticker change cannot be silently overwritten.

Default P0 rule:

```text
provider ticker differs from set-once run identity
-> block/partition old continuity
-> start a new PAPER run chain
```

A future separately ratified roll-continuity policy may relax this, but P0 must fail closed.

---

# 7. REST ADAPTER REPAIR — READY-TO-CODE CONTRACT

Target file:

`src/data/fetchers/massive.ts`

Keep the timeout/circuit-breaker-compatible behavior already present.

Replace the historical Futures path with a listed-contract adapter conceptually equivalent to:

```text
GET https://api.massive.com/futures/v1/aggs/{providerTicker}
  resolution=1min
  window_start.gte=<from>
  window_start.lte=<to>
  limit=<bounded>
  sort=window_start.asc
  apiKey=<credential>
```

Exact credential transport can follow Massive's supported REST client pattern; do not preserve a stale endpoint merely to preserve the old header pattern.

Parse:

```text
response.results[]
```

Normalize each row to the existing internal bar shape:

```ts
{
  timestamp: ISO milliseconds,
  open,
  high,
  low,
  close,
  volume
}
```

## 7.1 Nanosecond normalization

REST `window_start` is nanoseconds.

Normalize to millisecond precision before creating a JS `Date`:

```text
unix_ms = floor(window_start_ns / 1_000_000)
```

Do not feed a nanosecond value directly to `new Date(...)`.

Validate:

```text
finite timestamp
finite OHLC
volume finite and >= 0
ticker == requested provider ticker
```

Malformed rows are not synthetic zero bars.

## 7.2 Pagination

If `next_url` is present, use it through the same authenticated Massive authority until the requested bounded warmup/range is complete.

Do not assume one response page is always enough.

---

# 8. WEBSOCKET ADAPTER REPAIR — READY-TO-CODE CONTRACT

Target:

`src/data/fetchers/massive.ts`

For Starter custom PAPER:

```text
feed_mode = delayed
ws_host = wss://delayed.massive.com/futures
nominal_delay_seconds = 600
```

Connection sequence:

```text
connect
-> send {action:"auth", params: apiKey}
-> wait for auth_success
-> send {action:"subscribe", params:"AM.<providerTicker>[,AM.<providerTicker>...]"}
-> process only ev="AM"
```

Normalize:

```text
msg.sym -> provider ticker
msg.s   -> ISO timestamp (already milliseconds)
msg.o   -> open
msg.h   -> high
msg.l   -> low
msg.c   -> close
msg.v   -> volume
```

Reject/ignore status/control messages as bars.

A message with malformed OHLC/timestamp/ticker must not become a zero/NaN bar.

## 8.1 Feed label must be explicit

Do not infer feed mode later from how old the newest bar looks.

The resolved subscription must explicitly carry:

```text
provider = massive
feed_mode = delayed
nominal_delay_seconds = 600
provider_ticker
```

If a later account uses real-time Massive, it must be explicitly configured/proven as real-time. Do not label a socket real-time merely because it connected.

Unknown entitlement/mode = official PAPER BLOCKED.

---

# 9. PROVIDER-TICKER → LOGICAL-SYMBOL REMAP

Target service:

`src/server/services/paper-trading-stream.ts`

Current internal maps are keyed by the strategy symbol and should not be rewritten to listed-contract semantics throughout the engine.

Add the narrowest provider-boundary mapping needed so that:

```text
Massive socket subscribes to provider_ticker
Massive event arrives with provider_ticker
adapter/stream boundary maps it back to logical_symbol
existing pushBar(logical_symbol, ...)
existing handleBar/logical session lookup
existing evaluateSignals
```

Recommended semantic surface:

```ts
interface ResolvedFeedSymbol {
  logicalSymbol: string;
  providerTicker: string;
}
```

Shared WebSocket connection reuse should key the external socket by provider ticker, while all downstream strategy buffers remain keyed by logical root.

Do not make the strategy engine understand futures month codes just to satisfy the data vendor.

---

# 10. COLD-START WARMUP — THE CURRENT MISSING P0

Measured current stream state:

```text
barBuffer = in-memory Map
BAR_BUFFER_SIZE = 200
```

The current reconnect path has useful same-process logic:

```text
WebSocket disconnect/reconnect
-> if prior buffer exists, REST backfill gap
-> queue realtime bars arriving during backfill
-> merge/process them afterward
```

This is good and must be reused.

But true process restart loses `barBuffer` entirely.

Therefore a fresh boot cannot rely on the reconnect backfill path.

## 10.1 Required cold-start contract

Before an official PAPER session is qualification-active:

```text
resolve provider ticker
-> REST fetch latest completed 1-minute history
-> normalize provider ticker to logical root
-> sort ascending
-> deduplicate timestamps deterministically
-> require 200 valid bars
-> seed existing barBuffer
-> prove delay-aware recency
-> only then allow synchronous startStream()
```

Recommended helper location is the existing provider/stream layer, not a new engine.

Conceptual async seam:

```ts
warmResolvedMassiveFeed(subscription): Promise<WarmupEvidence>
```

AR-1155's async qualification activator calls that helper before it calls the existing synchronous `startStream()`.

## 10.2 Warmup history window

Do not request only "last 200 wall-clock minutes"; weekends, maintenance, and no-trade intervals can yield fewer than 200 bars because Massive does not emit a bar for an interval with no trades.

Use a sufficiently broad bounded lookback and retain the latest 200 valid 1-minute bars. A practical first request may cover several calendar days and expand boundedly if necessary within available Starter history.

The acceptance criterion is **200 valid complete bars**, not a particular number of elapsed minutes.

If fewer than 200 valid bars are obtainable for a supported active contract: BLOCK official qualification activation and preserve the reason.

---

# 11. DELAY-AWARE RECENCY / WATERMARK CONTRACT

Starter is intentionally 10 minutes delayed.

Therefore this is WRONG:

```text
wall_clock_now - latest_bar > 2 minutes
-> feed stale
```

It would mark a healthy Starter feed stale forever.

Use:

```text
wallclock_lag_seconds = wall_clock_now - latest_complete_bar_timestamp
nominal_delay_seconds = 600
excess_lag_seconds = max(0, wallclock_lag_seconds - nominal_delay_seconds)
```

Qualification freshness is based on `excess_lag_seconds`, not raw wall-clock lag.

Freeze a bounded configurable jitter/closure allowance, recommended initial default:

```text
MASSIVE_PAPER_MAX_EXCESS_LAG_SECONDS = 180
```

This 180-second value is a Trading Forge operational tolerance, not a Massive SLA.

Then:

```text
excess_lag <= tolerance
-> recency GREEN

excess_lag > tolerance
-> feed YELLOW/RED per receipt policy; activation/recovery BLOCKED for official qualification
```

Also preserve:

```text
latest_provider_bar_ts
wallclock_lag_seconds
nominal_delay_seconds
excess_lag_seconds
```

as feed evidence.

Market-closed periods require session-aware handling; do not call a weekend stale merely because no current bar should exist. The qualification day receipt must distinguish expected market closure from a feed outage.

---

# 12. SAME-PROCESS RECONNECT / GAP RECOVERY — REUSE AND HARDEN

Current `paper-trading-stream.ts` already has:

```text
isBackfilling
pendingRealtimeBars
backfillBars(symbol,lastTimestamp)
```

and buffers live bars during a REST gap fill.

Keep this architecture.

Required P0 changes:

1. backfill REST call uses `provider_ticker`, not logical root;
2. recovered rows are mapped back to `logical_symbol` before existing engine processing;
3. recovered + queued live bars are sorted and timestamp-deduped deterministically;
4. durable gap/recovery evidence is written for AR-1154 receipt reconciliation;
5. unresolved continuity cannot become GREEN.

## 12.1 Durable audit events

Exact action names can follow repo convention. Preserve these semantics:

```text
paper_feed.gap_detected
paper_feed.backfill_started
paper_feed.backfill_completed
paper_feed.gap_unresolved
paper_feed.reconnected
```

Minimum evidence:

```text
session_id
logical_symbol
provider_ticker
feed_mode
last_bar_before_gap
reconnect_at
requested_from
requested_to
recovered_first_bar
recovered_last_bar
recovered_count
queued_ws_count
continuity_status
correlation_id
```

A failed audit that is required to prove gap resolution must leave the day non-GREEN; silence is not proof of continuity.

---

# 13. P0-2 / P0-3 ACTIVATION JOIN

AR-1155 and this ruling now join exactly as follows.

## First official PAPER activation

```text
lifecycle gates pass
-> load exact executable candidate
-> resolve session/risk defaults
-> resolve Massive feed mode
-> resolve logical root -> provider ticker
-> perform REST cold-start warmup
-> prove feed recency / continuity
-> resolve runtime revision
-> compute paper_candidate_hash
-> compute paper_run_config_hash INCLUDING provider ticker/feed evidence
-> set-once qualification identity + immutable audit
-> create/activate official PAPER session
-> synchronous startStream(resolved subscription)
```

Any missing provider authority = BLOCK before a countable session exists.

## Process restart

```text
load stored official PAPER session + identity
-> recompute candidate identity
-> recompute run environment
-> re-resolve provider contract authority
-> compare stored provider ticker
-> cold-start REST warmup
-> prove recency
-> compare runtime revision
-> only if everything matches: mark resumable + start stream
```

If the current resolver would select a different provider ticker than the stored run identity, do not silently switch. Partition/restart qualification.

---

# 14. PAPER RUN IDENTITY FIELDS — FROZEN

AR-1152/AR-1155 `paper-run-v1` must now contain provider-grounded fields sufficient to prove what market data actually drove the run.

Minimum Massive feed projection:

```text
provider: "massive"
feed_mode: "delayed" | "realtime"
nominal_delay_seconds: number
logical_symbol: string
provider_ticker: string
product_code: string
resolution_policy_version: "massive-front-contract-v1"
rest_api_contract: "futures-v1-aggs"
ws_channel: "AM"
resolved_as_of_trading_date: YYYY-MM-DD
```

Do not hash mutable latest-bar timestamps into the run identity. Those belong to daily/restart evidence.

A provider ticker or feed-mode mutation must change the run hash while leaving the strategy candidate hash unchanged.

---

# 15. FAIL-CLOSED MATRIX

Official custom PAPER activation/resume is BLOCKED on any of the following:

```text
MASSIVE_API_KEY missing
unsupported logical root
Contracts API error
no active single listed contract
provider ticker missing/malformed
completed-prior-session selection authority unavailable
ambiguous top contract authority
feed mode unknown
configured feed mode inconsistent with known entitlement/endpoint
REST Futures aggregate request failure
REST response not status OK / results malformed
window_start malformed
provider ticker in returned bar mismatches request
fewer than 200 usable warmup bars
warmup timestamps unresolved duplicate/non-monotonic
feed excess lag exceeds allowed tolerance while market expected open
WebSocket auth failure
WebSocket subscription rejection
WebSocket event malformed
stored provider ticker mismatch on restart
unresolved reconnect gap
qualification candidate/run/runtime identity mismatch
required feed evidence write failure
```

No branch may convert any of those states to GREEN merely because no bad trade occurred.

---

# 16. LIVE-CAPITAL SAFETY INVARIANT — DO NOT TOUCH

Current `server-mediated-executor.ts` correctly defines:

```ts
LIVE_EXECUTION_STATES = new Set(["DEPLOYED", "PILOT"])
```

Keep it that way.

PAPER remains simulation-only even after the custom Massive stream becomes official qualification authority.

Do not add `PAPER` to live routing.

Do not let the $29 delayed feed become a live-capital execution source.

---

# 17. RED → GREEN TEST PACKET

Claude implementation is not accepted without real production-path evidence.

## Provider REST tests

1. `fetchBars()` hits `/futures/v1/aggs/{listedTicker}`, not legacy `/bars`.
2. Query uses `resolution=1min` and correct range/sort semantics.
3. Parses `results[]`.
4. Converts known nanosecond `window_start` to exact expected millisecond/ISO minute.
5. Malformed nanosecond timestamp refuses/drops with evidence; does not create 1970/overflow bar.
6. Returned ticker mismatch refuses the row/request.
7. Pagination follows `next_url` when needed.
8. A legacy `{bars:[...]}` response does NOT falsely pass as valid current Futures data.

## Provider WebSocket tests

9. Starter delayed socket uses `wss://delayed.massive.com/futures`, not legacy `.io` host.
10. Auth message is emitted before subscription.
11. Subscription uses `AM.<providerTicker>`.
12. Subscription waits for `auth_success`.
13. `ev="AM"` event maps `sym/o/h/l/c/v/s` correctly.
14. Status/control event cannot become a market bar.
15. malformed/NaN aggregate cannot enter `barBuffer`.

## Symbol-resolution tests

16. MES strategy remains logical `MES` while provider subscription is a listed MES contract.
17. resolver queries active single contracts for the exact point-in-time date.
18. highest prior completed-session volume wins deterministically.
19. mutating current in-progress session volume does NOT alter the prior-session selection.
20. zero usable volume authority BLOCKS.
21. unresolved top-volume ambiguity BLOCKS.
22. unsupported root BLOCKS.
23. provider ticker mutation changes run hash but not candidate hash.

## Cold-start tests

24. empty process buffer requires REST warmup before official activation.
25. 200 valid sorted unique bars -> warmup GREEN.
26. 199 valid bars -> activation BLOCKED under the v1 requirement.
27. duplicate provider rows dedupe deterministically without double-processing.
28. out-of-order provider rows sort deterministically before seed.
29. cold restart repeats identity check + REST warmup; it does not assume old memory survived.
30. `startStream()` remains synchronous.

## Delay / gap tests

31. Starter healthy delayed bar around nominal 600s lag plus small jitter can pass.
32. same feed with excessive lag beyond configured tolerance fails recency.
33. market-closed expected gap is distinguished from provider outage.
34. same-process reconnect queues WS bars while REST backfill runs.
35. backfill + queued bars merge in strict timestamp order without duplicates.
36. unresolved missing interval leaves receipt non-GREEN.
37. gap recovery evidence joins to the same paper session/correlation chain.

## Safety mutation tests

38. changing `feed_mode` invalidates run identity.
39. changing `provider_ticker` invalidates run identity.
40. changing runtime revision still invalidates continuity via AR-1155.
41. `PAPER` remains absent from `LIVE_EXECUTION_STATES`.
42. no new telemetry table is required for this work order.
43. existing pre-PAPER stream/reconnect tests remain GREEN or are deliberately versioned with equivalent semantics.

---

# 18. POSITIVE CONTROLS / MUTATION CONTROLS

At least these controls must be demonstrated, not merely asserted:

```text
CONTROL A
same logical MES + same candidate + different provider ticker
-> candidate hash SAME
-> run hash DIFFERENT

CONTROL B
same delayed provider ticker + latest bar moves by one normal delayed minute
-> run hash SAME
-> runtime feed evidence changes

CONTROL C
change old stale REST response shape from results[] back to bars[]
-> current adapter test FAILS

CONTROL D
change WS event key sym -> symbol in fixture
-> parser test FAILS

CONTROL E
bypass cold warmup with empty buffer
-> activation test FAILS

CONTROL F
add PAPER to LIVE_EXECUTION_STATES
-> capital-safety test FAILS
```

A test against a copied helper rather than the production adapter/activation seam is not sufficient.

---

# 19. FAST IMPLEMENTATION ORDER FOR CLAUDE AFTER AR-1138

Do this in the smallest complete vertical sequence.

## Patch 1 — provider adapter correctness

```text
massive.ts Futures REST path/parser
+ delayed Futures WS host/auth/sub/parser
+ provider-contract fixtures/tests
```

Stop if current official docs cannot be reproduced by fixtures.

## Patch 2 — deterministic listed-contract resolver

```text
Massive Contracts API client/helper
+ completed-prior-session volume selector
+ MES/MNQ/MCL allowlist
+ fail-closed tests
```

Do not mix with Databento spec authority.

## Patch 3 — logical/provider symbol boundary

```text
ResolvedFeedSymbol
+ socket keyed by provider ticker
+ downstream bar remapped to logical root
+ production stream tests
```

## Patch 4 — cold-start warmup + recency

```text
async warmup helper
+ 200-bar seed
+ delay-aware watermark
+ activation BLOCK on insufficient/stale evidence
```

## Patch 5 — reconnect durable evidence

```text
reuse existing backfill/pendingRealtimeBars
+ provider ticker awareness
+ deterministic merge/dedup
+ durable gap/recovery evidence
```

## Patch 6 — AR-1155 integration

```text
qualification activator calls resolver/warmup
+ Massive feed projection joins paper-run-v1
+ set-once identity
+ restart verifier
+ daily receipt consumes feed evidence
```

This sequence keeps each patch reviewable while closing one full vertical dependency at a time.

---

# 20. DO NOT DO

Do not:

- build a second PAPER engine;
- build a generic market-data abstraction rewrite;
- replace the entire stream service;
- globally turn MES into MESU6 inside strategy logic;
- infer front month from calendar month alone;
- select whichever contract row arrives first;
- use current in-progress session volume as the only restart-sensitive selector;
- pretend Databento's contract-spec row is a Massive listed-ticker join;
- call delayed Starter data real-time;
- use delayed PAPER as execution-latency certification;
- make `startStream()` async;
- add PAPER to live-capital routing;
- create a new telemetry table;
- touch unfinished AR-1138 compiler/grader work;
- expand Visual Intelligence or Context Edge during this P0.

---

# 21. STOP CONDITIONS

Claude must stop and report rather than improvise if:

1. official Massive Futures docs materially differ from the contracts frozen here at implementation time;
2. MES/MNQ/MCL `product_code` lookup does not return a deterministic listed-contract candidate set;
3. prior completed-session aggregate authority cannot be queried on the subscribed plan;
4. provider ticker cannot be mapped back to logical root without changing strategy semantics;
5. warmup cannot seed the exact existing production buffer without bypassing required state initialization;
6. a provider-ticker roll must be supported mid-run for business reasons before a continuity policy is ratified;
7. implementing the feed seam requires changing Claude's unfinished AR-1138 compiler surface.

Return measured evidence for the blocked point. Do not invent a fallback.

---

# 22. ACCEPTANCE EVIDENCE REQUIRED FROM CLAUDE

A future implementation report must contain machine-produced evidence for:

```text
1. exact changed commit(s)
2. exact provider endpoint fixtures used
3. REST RED before / GREEN after
4. WS RED before / GREEN after
5. listed-contract resolver candidate table for at least MES, MNQ, MCL
6. resolver positive + ambiguity controls
7. logical_symbol/provider_ticker witness
8. cold-start empty-buffer RED
9. 200-bar warmup GREEN
10. delayed recency positive + stale mutation control
11. reconnect/backfill deterministic merge witness
12. unresolved-gap fail-closed witness
13. AR-1155 activation seam cannot become countable before warmup/identity GREEN
14. restart with same identity/provider ticker resumes
15. restart with changed provider ticker blocks/partitions
16. PAPER -> broker route still blocked
17. exact test command + full pass/fail counts
```

Do not report "Massive fixed" based only on unit tests around a new helper if the real `paper-trading-stream.ts` path was not exercised.

---

# 23. P0-3 OUTPUT CONTRACT TO AR-1154 DAILY RECEIPT

The PAPER-DAY receipt must be able to consume at least:

```text
provider = massive
feed_mode
nominal_delay_seconds
logical_symbol
provider_ticker
resolution_policy_version
warmup_bar_count
warmup_completed_at
latest_provider_bar_ts
wallclock_lag_seconds
excess_lag_seconds
gap_detected_count
gap_recovered_count
unresolved_gap_count
restart_warmup_complete
provider_ticker_matches_run_identity
```

Daily receipt logic remains the semantic authority for GREEN/YELLOW/RED.

P0-3 only ensures the market-data producer emits deterministic, joinable evidence.

---

# 24. STATUS

```text
Current Massive Futures REST adapter              = STALE / REPAIR REQUIRED
Current Massive Futures WS adapter                = STALE / REPAIR REQUIRED
Official Futures REST endpoint contract           = VERIFIED 2026-08-13
Official delayed minute WS contract               = VERIFIED 2026-08-13
Starter $29 / 10-minute delayed status            = VERIFIED 2026-08-13
Massive Contracts provider-ticker authority       = VERIFIED AVAILABLE
Massive-specific front-contract resolver in repo  = NOT FOUND IN MEASURED PRODUCTION PATH
Existing Databento contract-spec authority        = REUSE FOR SPECS, NOT PROVIDER TICKER
Same-process reconnect/backfill foundation        = REUSE
True cold-start warmup                             = MISSING
Logical/provider symbol split                     = MISSING
Delay-aware PAPER watermark                       = MISSING
Durable gap/recovery receipt evidence             = PARTIAL/MISSING JOIN
PAPER live-capital block                          = KEEP
Claude AR-1138 compiler work                      = UNTOUCHED
```

---

# 25. BOTTOM LINE

The fastest robust P0-3 implementation is not "plug MES into Massive and hope."

It is:

```text
MES strategy stays MES
        ↓
Massive Contracts API
        ↓
deterministic listed contract
        ↓
provider_ticker pinned in run identity
        ↓
current Futures REST v1 warmup
        ↓
200 valid minute bars
        ↓
10-minute-delay-aware recency proof
        ↓
current AM WebSocket protocol
        ↓
provider bar remapped back to MES
        ↓
existing PAPER engine
        ↓
durable gap/restart evidence
        ↓
AR-1154 valid PAPER-day receipt
```

This repairs the real provider seams, preserves Trading Forge strategy semantics, preserves the existing stream engine, makes futures rolls observable rather than silent, and gives AR-1155 the exact feed identity it needs before official PAPER qualification can safely count a day.

**GPT-P0-3: COMPLETE / FROZEN.**
