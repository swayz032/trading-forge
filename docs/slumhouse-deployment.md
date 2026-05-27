# Slumhouse Portal — Deployment Runbook

Shipped 2026-05-27 on branch `feature/deep-analysis-pipeline`.

## What it is

Read-only friend-facing portal at `/slumhouse/*` sitting alongside the existing Trading Forge admin dashboard. Discord OAuth, 3 pages (The Crib · The Kitchen · The Recipe), street-translated jargon, no governance writes. All data sourced from existing TF systems (paper_trades, strategies, backtests, monte_carlo_runs, lifecycle_shadow_signals, strategy_health_scores, trade_critique).

## Required `.env` additions

```bash
# Discord OAuth (create app at https://discord.com/developers/applications)
DISCORD_CLIENT_ID=<from-discord-dev-portal>
DISCORD_CLIENT_SECRET=<from-discord-dev-portal>
DISCORD_REDIRECT_URI=https://tf-relay-production.up.railway.app/slumhouse/auth/callback

# Slumhouse session cookie HMAC secret (≥32 chars random)
SLUMHOUSE_SESSION_SECRET=<openssl rand -hex 32>
```

## Deploy steps

1. **Create Discord application** at https://discord.com/developers/applications
   - New Application → name "Slumhouse"
   - **OAuth2 → Redirects** → add `https://tf-relay-production.up.railway.app/slumhouse/auth/callback`
   - Copy **Client ID** and **Client Secret** into `.env`
2. **Generate session secret**: `openssl rand -hex 32` → paste into `SLUMHOUSE_SESSION_SECRET`
3. **Apply migration**: `npm run db:migrate` (applies `0164_slumhouse_users.sql`) — OR rely on boot-migration-runner on next NSSM restart
4. **Restart TF API** so the new routes load (use HMAC self-restart endpoint per `CLAUDE.md §15a`)
5. **Map friends manually** (operator-only — one row per friend):
   ```bash
   curl -X POST http://localhost:4000/api/admin/slumhouse-users \
     -H "Content-Type: application/json" \
     -d '{
       "discord_user_id": "111222333444555666",
       "display_name": "Kee",
       "broker_account_id": "abc12345-...-uuid-from-broker_accounts",
       "jersey_number": 4
     }'
   ```
   Discord user ID = right-click their handle in Discord → "Copy User ID" (Developer Mode required).
6. **DM friends** the link: `https://tf-relay-production.up.railway.app/slumhouse`
7. They click **Sign in with Discord** → if mapped, land on The Crib. If not yet mapped, see "Almost in" page until you POST their mapping.

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `GET /slumhouse` | none (serves `crib.html`) | Auto-redirects to `/slumhouse/login.html` if no cookie via client-side fetch |
| `GET /slumhouse/login.html` | none | Sign in with Discord button |
| `GET /slumhouse/auth/login` | none | Redirects to discord.com authorize |
| `GET /slumhouse/auth/callback` | Discord OAuth code | Exchanges code, sets session cookie, redirects to /slumhouse |
| `GET /slumhouse/auth/logout` | none | Clears cookie, redirects to /login.html |
| `GET /slumhouse/api/crib` | session | The Crib data (banner + Discord feed + Pot + Crew) |
| `GET /slumhouse/api/kitchen` | session | 6-stage pipeline counts |
| `GET /slumhouse/api/kitchen/menu` | session | DEPLOYED dishes for Today's Menu |
| `GET /slumhouse/api/recipe/:id` | session | Per-strategy validation deep-dive |
| `GET /api/admin/slumhouse-users` | operator | List all user mappings |
| `POST /api/admin/slumhouse-users` | operator | Upsert a user mapping |

## Audit events

- `slumhouse.login_success` — friend successfully signed in
- `slumhouse.login_unmapped_user` — Discord OK but no `slumhouse_users` row (warning)
- `slumhouse.login_failed` — OAuth or DB error (failure)
- `slumhouse.user_mapped` — operator added/updated a mapping (success)

## Single point of failure

Slumhouse availability = TF API availability. If the Skytech tower is down, Slumhouse is down. Same risk surface as TF today — no new exposure. Dead-mans-heartbeat alerts already cover this case.

## Anam.ai integration (already shipped)

The Crib page's "Video with Slumdawg" button embeds the Anam.ai persona iframe:
- Persona ID: `026cacc4-619e-4cec-a144-c4a8dfcb623e` (see `reference_anam_persona.md`)
- 5 tools wired through n8n → `/api/admin/slumdawg/*` HMAC-protected endpoints
- Restore prompt + greeting via `npx tsx scripts/restore-slumdawg-anam.ts`

## Testing

Slumhouse vitest suite under `src/server/__tests__/slumhouse/` — currently 10 test files, ~40 tests total. Run with:
```bash
npx vitest run src/server/__tests__/slumhouse/
```

## Carry-forward (Wave 30+ candidates)

- Discord auto-post on big wins (`#slumdawg-wins` channel)
- Per-strategy Anam tool to read the Slumdawg score aloud
- Daily 17:00 ET digest of "Today's Bag" to friends' Discord DMs
- Mobile-responsive layout audit (current layout assumes desktop)
- Optional Discord role gating ("Crew" role required to log in)
