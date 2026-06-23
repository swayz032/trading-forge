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

3. **Wire the position-drift snapshot source to a cron.** `checkPositionDrift()` compares
   the server's position vs the broker's reported position and blocks trading on drift.
   It needs a real broker-position read (Playwright/MFFU snapshot, or TopstepX REST when
   that account exists) wired to a periodic cron. This is the one piece that genuinely
   needs a live account to finalize.

## Safety guarantees already in place

- **Default OFF** — zero behavior change until you flip the flag.
- **Fail-closed** — bot refuses to route live without `BROKER_FILL_HMAC_SECRET`.
- **SHADOW never routes** — strategies in SHADOW state never touch the broker.
- **needs_reconcile blocks entries** — any position whose fill is unknown/diverged
  blocks new live entries on that account until resolved + fires a Discord critical.
- **Idempotent** — duplicate fills don't double-count.

## How to turn it OFF in an emergency

Set `SERVER_MEDIATED_EXECUTION_ENABLED=false` (or just unset `BROKER_FILL_HMAC_SECRET`)
and restart. The bot reverts to no server-side live routing.
