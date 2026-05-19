# TopstepX Integration — DEFERRED

## Status

**Not implemented.** TopstepX integration is deferred until the operator opens a Topstep account with an active TopstepX API subscription.

The `broker_type='topstepx'` value is reserved in the `broker_accounts` table constraint. The broker-router returns `{ success: false, reason: "topstepx_not_configured" }` for any account with this broker type.

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

The broker-router `routeOrder()` function already has a dispatch branch that calls the TopstepX client. Replace the stub error return with a real `submitWebhookOrder()` call.

## Topstep 2026 compliance notes

Per `docs/prop-firm-rules-2026-topstep.md`:

1. **Personal device only** — no VPS, VPN, or remote servers. TopstepX code paths must NOT use Railway cloud failover (B6). This is enforced by the broker-router routing decision, not by TopstepX itself.
2. **Multi-account within one user is allowed** — a single Topstep subscription covers multiple accounts. The `broker_accounts` table can have multiple rows with `firm_id='topstep'` and different `account_id_external` values.
3. **Copy trades across own accounts are allowed** — `correlated-position-guard.ts` does NOT block same-strategy entries across operator's own Topstep accounts.

## References

- TopstepX API documentation: https://api.topstepx.com/docs (requires active subscription)
- Topstep 2026 rules: `docs/prop-firm-rules-2026-topstep.md`
- Broker router: `src/server/services/broker-router.ts`
- Migration 0098: `src/server/db/migrations/0098_broker_accounts.sql`
