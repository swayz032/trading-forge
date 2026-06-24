# GO-LIVE CHECKLIST — Server-Mediated Execution (Phase 1)

> **READ THIS BEFORE running real money through server-mediated execution.**
> Built + unit-tested 2026-06-22. NOT yet validated against a live broker feed —
> that final handshake is a you-with-a-live-account step, not a code step.

## What this is (plain English)

Today the live order path is TradingView Pine → TradersPost → broker. The Pine is a
**degraded** version of your validated strategy (no Style C runner, no confluence gate,
none of the risk/compliance hardening). **Server-mediated execution** fixes that: the
SERVER (which runs the full validated strategy + all gates + Style C exits + DLL +
compliance) fires the live orders, and **Phase 1 reconciles the actual broker fill**
back into the server so its view never drifts from reality.

It is **OFF by default.** Nothing changes until you complete this checklist and flip it on.

## The 3 steps before you flip it on

1. **Set the secrets in the live config (`.env`):**
   - `BROKER_FILL_HMAC_SECRET=<random, 32+ chars>` — authenticates the broker fill
     callback. **The bot will REFUSE to route any live order until this is set**
     (fail-closed safety — see `server-mediated-executor.ts::checkRoutingGuard`).
   - `SERVER_MEDIATED_EXECUTION_ENABLED=true` — the master switch. Leave it `false`
     until steps 2 + 3 are done.

2. **Confirm the real TradersPost fill-callback field names** match what we coded.
   We assumed `orderId` / `filledQty` / `avgFillPrice` / `fillId`. When you have a live
   TradersPost account, send one real fill through and check it matches
   `TradersPostFillSource.normalizeFillEvent()` in `fill-reconciliation-service.ts`.
   Adjust the field mapping if TradersPost uses different names.

3. **Connect the broker-position snapshot adapter.** The position-drift detection is
   now FULLY WIRED (2026-06-23, F-4): the `position-drift-reconcile` cron runs every 5 min
   (pipeline-exempt, fail-soft) → `runPositionDriftReconciliation()` → `checkPositionDrift()`.
   The ONE remaining go-live piece is `getBrokerPositionSnapshot(accountId, symbol)` in
   `fill-reconciliation-service.ts` — it currently returns `null` (drift sweep skips, never
   fabricates a position) and emits a one-time `fill_reconciliation.broker_snapshot_source_unconfigured`
   warn. Implement it to read the real broker position: **TopstepX** `GET /v2/positions?accountId={id}`
   (filter by symbol → `{qty, avgPrice}`) or **MFFU** Playwright snapshot of the position table.
   Return `{qty, avgPrice}` on success, `null` on broker error (sweep handles it safely).

4. **Seed the live `broker_accounts` rows (F-5).** Today `broker_accounts` has only paper-firm
   rows. Before flipping the flag, insert the real Topstep/MFFU account rows (account_id →
   firm_id + broker_type + Bitwarden vault ref). Without them `routeOrder()` can't resolve an
   account and fails closed — safe, but no orders route.

## Safety guarantees already in place

- **Default OFF** — zero behavior change until you flip the flag.
- **Fail-closed** — bot refuses to route live without `BROKER_FILL_HMAC_SECRET`.
- **Lifecycle-gated on BOTH entry paths (B1 + F-1, 2026-06-23)** — `routeOrder()` only fires
  for PAPER+ states. The internal A/B path (`paper-signal-service.ts`) and the external
  `/api/live-order` route both reject CANDIDATE/TESTING/SHADOW (fail-closed on lookup error).
- **SHADOW never routes** — strategies in SHADOW state never touch the broker.
- **needs_reconcile blocks entries** — any position whose fill is unknown/diverged
  blocks new live entries on that account until resolved + fires a Discord critical.
- **Idempotent** — duplicate fills don't double-count (UUID fallback when bar-timestamp
  absent, F-3, so distinct entries are never collapsed).
- **Migrations apply at boot (F-2 fixed 2026-06-23)** — `0170`+`0171` (live_order_pine_dedup,
  server_mediated_orders) journal timestamps corrected; the boot-migration-runner applies
  them on next deploy (they were previously skipped due to a backdated `when`).

## How to turn it OFF in an emergency

Set `SERVER_MEDIATED_EXECUTION_ENABLED=false` (or just unset `BROKER_FILL_HMAC_SECRET`)
and restart. The bot reverts to no server-side live routing.
