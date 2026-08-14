# TopstepX offline adapter receipt — 2026-08-14

## Verdict

**GREEN for offline simulation only.** The live `broker-router` remains fail-closed with `topstepx_not_configured`. No account, subscription, API key, authentication request, WebSocket, REST request, Practice order, Combine order, or funded/live order was used.

## Implemented boundary

- Official enum and payload shapes for orders, trades, and positions.
- Account-scoped `customTag` retry deduplication.
- Fail-closed rejection when one `customTag` is reused with a different payload.
- Deterministic order placement, cancellation, fill accumulation, and open-order search.
- Trade-ID deduplication so reconnect replay cannot apply a fill twice.
- Timestamp/id sorting so out-of-order replay converges to the same position.
- Long/short position creation, weighted average price, reductions, flips, and flat state.
- Account flatten simulation that cancels open orders and clears positions.
- Pure server-versus-broker quantity/price reconciliation with explicit missing-position drift.

The simulator contains no transport dependency and is not imported by the live router. Its contract mirrors the official ProjectX endpoints `Order/place`, `Order/cancel`, `Order/search`, `Position/searchOpen`, `Position/closeContract`, and `Trade/search`, plus the official SignalR user-hub order/position/trade event payloads.

## Evidence

- `src/server/integrations/topstepx/__tests__/offline-adapter.test.ts`: 6/6 passed.
- Runtime safety battery including the adapter: 12 files, 170/170 passed.
- Node harness/watchdog/Rails battery: 23/23 passed.
- `npm run build`: exit 0.
- `npm run check:production-isolation`: exit 0.
- `npm run check:2026-compliance`: exit 0.
- `npm run system-map:check`: exit 0, zero drift.

## Required later, without Codex

Claude does not need Codex to continue. After the operator buys access, Claude must implement a separate authenticated transport, keep credentials in the existing vault, preserve the offline tests, add HTTP/SignalR contract fixtures, prove reconnect and duplicate delivery in Practice, prove broker-truth position reconciliation, and obtain GPT grading before any Combine activation. Offline green must never be relabeled Practice or live green.
