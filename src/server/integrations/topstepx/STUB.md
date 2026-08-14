# TopstepX Integration — DEFERRED

## Status — live deferred, offline ready

**Live transport is not implemented.** Authentication and network transport stay deferred until the operator opens an account with active API access.

An offline-only simulator now exists in `offline-adapter.ts`. It models the official order, trade, position, cancel, flatten, retry-deduplication, reconnect replay, and reconciliation contracts without importing `fetch`, opening a socket, reading credentials, or touching the broker router.

The `broker_type='topstepx'` value is reserved in the `broker_accounts` table constraint. The broker-router continues to return `{ success: false, reason: "topstepx_not_configured" }` for any account with this broker type. Offline readiness is not live readiness.

## When to implement

When the operator activates a Topstep account and subscribes to the TopstepX API:

- **Cost:** $14.50/month with promo code `topstep`
- **API type:** REST + WebSocket
- **Auth:** OAuth API key
- **Platform mandate:** TopstepX is the ONLY supported platform since the January 12, 2026 lockdown. NinjaTrader and Tradovate are no longer accepted by Topstep.

## Implementation pattern

Mirror the `traderspost/` directory structure:

```
src/server/integrations/topstepx/
  types.ts          -- TopstepX REST/WebSocket payload types
  client.ts         -- submitOrder(payload) → TopstepXSubmitResult
  STUB.md           -- this file (remove when implemented)
```

Do not wire the simulator into `routeOrder()`. When paid access exists, implement a separate authenticated client, grade it against Practice first, and only then replace the fail-closed router branch.

## Topstep 2026 compliance notes

Per `docs/prop-firm-rules-2026-topstep.md`:

1. **Personal device only** — no VPS, VPN, or remote servers. TopstepX code paths must NOT use Railway cloud failover (B6). This is enforced by the broker-router routing decision, not by TopstepX itself.
2. **Multi-account within one user is allowed** — a single Topstep subscription covers multiple accounts. The `broker_accounts` table can have multiple rows with `firm_id='topstep'` and different `account_id_external` values.
3. **Copy trades across own accounts are allowed** — `correlated-position-guard.ts` does NOT block same-strategy entries across operator's own Topstep accounts.

## References

- ProjectX Gateway API documentation: https://gateway.docs.projectx.com/
- Topstep 2026 rules: `docs/prop-firm-rules-2026-topstep.md`
- Broker router: `src/server/services/broker-router.ts`
- Migration 0098: `src/server/db/migrations/0098_broker_accounts.sql`
