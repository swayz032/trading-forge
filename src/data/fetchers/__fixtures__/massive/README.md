# Massive WebSocket protocol fixtures (M1a, 2026-07-17)

Recorded/derived from Massive's real published documentation (`massive.com` —
Massive is Polygon.io, rebranded; the codebase's prior `massive.io` domain
reference was stale/wrong and 404s). Each fixture is annotated with its
CONFIRMED vs INFERRED provenance — never mix the two silently.

## Confirmed directly from official sources (2026-07-17)

- **Auth flow**: connect first (no `Authorization` header — that was the
  prior code's wrong guess), then send `{"action":"auth","params":"<API_KEY>"}`
  as a WS message. Server replies with an ARRAY:
  `[{"ev":"status","status":"auth_success","message":"authenticated"}]`.
  Source: web search result quoting Massive's own websocket auth docs
  (query: "massive.com docs websocket authenticate action auth params
  example json"), cross-confirmed by the `massive-com/client-js` GitHub
  README showing the identical `{action, params}` shape for `subscribe`.
- **Subscribe flow**: `{"action":"subscribe","params":"AM.<TICKER>,A.<TICKER>,..."}`
  — comma-separated `<CHANNEL>.<TICKER>` pairs in one `params` string, NOT
  the prior code's `{"action":"subscribe","symbols":[...]}` array-of-bare-
  symbols shape. Source: `massive-com/client-js` README code example
  (`stocksWS.send('{"action":"subscribe", "params":"AM.MSFT,A.MSFT"}')`).
- **Message delivery is array-wrapped**: every inbound WS frame is a JSON
  ARRAY of event objects, not a single bare object — confirmed by the same
  README's parse example (`const [message] = JSON.parse(response)` /
  `for (const message of messages)`), and the futures-specific docs page
  quoted verbatim below.
- **Futures per-minute aggregate (`AM`) shape** — fetched directly from
  `https://massive.com/docs/websocket/futures/aggregates-per-minute`
  (2026-07-17), quoted verbatim:
  ```json
  {
    "ev": "AM",
    "sym": "6CH5",
    "v": 91,
    "dv": 1353.1,
    "o": 6994.5,
    "c": 6995,
    "h": 6995,
    "l": 6994.5,
    "n": 10,
    "s": 1751933700000,
    "e": 1751933760000
  }
  ```
  Fields: `ev`=event type ("AM"), `sym`=ticker, `o`/`h`/`l`/`c`=OHLC,
  `v`=tick volume, `dv`=total dollar value traded, `n`=transaction count,
  `s`/`e`=aggregation-window start/end, Unix **milliseconds**. This is a
  COMPLETELY different shape than the prior code assumed (`msg.open`,
  `msg.timestamp`, full field names, single-object messages).
- **Futures tickers are dated contract codes** (e.g. `6CH5`), not bare root
  symbols like the prior code assumed (`"MES"`/`"MNQ"`) — CME-month-code +
  year-digit convention, confirmed by the same futures docs page's example.
- **Stocks delayed-tier WS host**: `wss://delayed.massive.com` — confirmed
  directly from the `massive-com/client-js` README's own client
  initialization example.

## NOT independently confirmed — flagged, not fabricated

- **The exact futures-cluster WS URL/path.** The JS client library's README
  only shows stocks examples; the futures websocket docs pages returned
  mostly navigation shells to the fetch tool (JS-rendered content the
  fetcher couldn't extract). By close analogy with the stocks delayed host
  and Polygon.io's historical multi-cluster convention, the most likely
  candidate is `wss://delayed.massive.com/futures` or a `futures.` subdomain
  variant — but this is NOT verified and MUST be confirmed (a support
  ticket, a free-tier signup, or a clean fetch of the futures websocket
  quickstart page) before the adapter is pointed at a real endpoint. The
  adapter takes the full WS URL as a config param specifically so this can
  be corrected without a code change once confirmed.
- **The exact root-symbol → dated-contract-ticker mapping** for MES/MNQ/MCL
  (e.g. does the Micro E-mini S&P 500 become `MESH25`, or some other
  Massive-specific root?). The one confirmed WS example (`6CH5` for a
  currency future) shows Massive/Polygon prefixing currency futures with
  `6`, which does NOT obviously generalize to equity-index or energy
  micros. Guessing this mapping risks silently subscribing to the WRONG
  contract — a real correctness bug, not a style issue — so this adapter
  does NOT attempt the mapping. **The real mechanism IS confirmed** (user-
  supplied Futures Overview page, 2026-07-17): `GET /futures/v1/contracts`
  — "a single source for discovering all listed futures contracts... query
  the full contract index with filters for product code... returning key
  attributes such as ticker" — is included in ALL futures plans (including
  the free "Futures Basic" tier, no paid subscription needed to call it).
  Ticker resolution should call this endpoint (filtered by product code,
  e.g. whatever Massive's product code is for Micro E-mini S&P 500) rather
  than a hardcoded formula — NOT implemented in this $0 MVP (out of M1a's
  strict `src/data/fetchers/` scope), but the adapter accepts whatever
  ticker string it's given verbatim so a future caller can wire this lookup
  in without an adapter change.
- **REST-vs-WebSocket timestamp unit mismatch, confirmed 2026-07-17**: the
  Futures Overview page states REST trade/quote/aggregate timestamps
  (`window_start` etc.) are Unix **nanoseconds**, while the WS `AM` message's
  `s`/`e` fields (confirmed above) are Unix **milliseconds**. Do not reuse
  one parsing helper for both without converting — a nanosecond value
  parsed as milliseconds is ~1,000,000x too large (lands in the year 5138+,
  not a subtle bug — but worth a defensive parse-time bounds check either
  layer could add later). Also confirmed: "A futures session opens the
  evening before the date it settles on, so a session bar's `window_start`
  is the day before its `session_end_date`" (CME Globex 18:00 CT prior-day
  convention) — relevant context for future REST-bar day-attribution work,
  not applicable to the WS `AM` adapter this file covers.
- **Auth-failure response shape** (invalid API key). No official example
  was fetchable; `auth-failed.json` below is a REASONABLE INFERENCE from
  the confirmed status-message shape (same `[{"ev":"status",...}]` envelope,
  `status` value changed to a failure indicator) — the adapter's handling
  of this fixture should be treated as best-effort until a real auth
  failure is observed and can be captured as a genuine recording.

## Fixture files

| File | Represents | Provenance |
|---|---|---|
| `auth-success.json` | Server's auth-success status frame | CONFIRMED |
| `auth-failed.json` | Server's auth-failure status frame | INFERRED (see above) |
| `subscribe-success.json` | Server's subscribe-confirmation status frame | INFERRED shape (status-envelope confirmed; exact `status`/`message` text for subscribe specifically not fetched verbatim) |
| `am-single.json` | One `AM` aggregate bar, array-wrapped | CONFIRMED (fields verbatim from the futures docs page; ticker/values are the page's own example) |
| `am-bundle.json` | Multiple `AM` bars bundled in one WS frame | CONFIRMED bundling behavior; individual bar values synthesized for test variety |
| `malformed-non-numeric-close.json` | An `AM` bar with `c: null` (missing/null field) | Synthesized negative-test fixture — exercises the adapter's explicit null/undefined-field check |
| `malformed-string-price.json` | An `AM` bar with `c: "not-a-price"` (non-coercible string) | Synthesized negative-test fixture — exercises the `Number.isNaN()` fallback path, distinct from the null-field check above |
| `malformed-negative-volume.json` | An `AM` bar with negative `v` | Synthesized negative-test fixture |
| `malformed-invalid-ohlc.json` | An `AM` bar where `l` > `h` (impossible OHLC) | Synthesized negative-test fixture |
