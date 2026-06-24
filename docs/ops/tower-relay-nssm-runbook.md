# Tower Relay Client — NSSM Supervision Runbook (DEBT-5)

> Closes vacation-autonomy gap **DEBT-5**: the tower relay client (`scripts/tower-relay-client.cjs`)
> must be supervised by **its own NSSM service** so it auto-restarts on crash AND survives reboot,
> independently of `TradingForgeAPI`. Without this, a relay crash during a vacation kills the
> Discord/alert fanout with no self-heal. Script: `scripts/ops/install-tower-relay-nssm.ps1`.

## What the relay is
A WebSocket bridge: tower → Railway `tf-relay` (`wss://tf-relay-production.up.railway.app/__relay`),
forwarding HTTP frames to the local backend (`http://localhost:4000`). It is a **SINGLETON** — a
second connection force-closes the first. It reads `RELAY_SERVER` / `RELAY_TOKEN` / `RELAY_BACKEND`
from env and exits FATAL if `RELAY_SERVER` + `RELAY_TOKEN` are missing.

## Prerequisites
- `node.exe` at `C:\Program Files\nodejs\node.exe`
- `nssm.exe` at `bin\nssm\win64\nssm.exe` (run `scripts\wave19-nssm-migrate.ps1` once if absent — it downloads NSSM)
- Token file `C:\Users\tonio\bin\relay-token.txt` containing the shared secret that matches the Railway `tf-relay` `RELAY_TOKEN`
- ⚠️ **No PM2 copy running.** PM2 previously ran the relay as a dupe alongside NSSM (singleton thrash). The install script HARD-REFUSES if it finds one — clear it first: `pm2 delete tower-relay-client; pm2 save`.

## Install / reconfigure (idempotent)
Run from an **elevated** PowerShell (NSSM service install requires Administrator):
```powershell
cd C:\Users\tonio\Projects\trading-forge\trading-forge
.\scripts\ops\install-tower-relay-nssm.ps1
```
The script: preflights everything (fail-loud), guards against the PM2 dupe, installs/reconfigures the
`TFRelayClient` service, then **verifies health** — it confirms `SERVICE_RUNNING` and that the log shows
a live relay connection within 30s, failing loud (non-zero exit) if not. Re-running is safe (reconfigures in place).

**What it configures (enterprise hardening):**
| Setting | Value | Why |
|---|---|---|
| `Start` | `SERVICE_AUTO_START` | survives reboot |
| `AppExit Default` | `Restart` | auto-restart on crash |
| `AppRestartDelay` | `2000` ms | brief settle before respawn |
| `AppThrottle` | `10000` ms | a crash inside 10s = a failure → prevents a hot restart-loop |
| `AppStdout/Stderr` + rotation | `tower-relay-client.log` / `.err.log`, 10 MB online rotate, **append** | durable journal, never truncated on restart |
| `AppEnvironmentExtra` | `RELAY_SERVER` / `RELAY_TOKEN` / `RELAY_BACKEND` | the relay's required env (token read from the token file) |

## Verify (no changes)
```powershell
.\scripts\ops\install-tower-relay-nssm.ps1 -Verify
```
Exit 0 = healthy (RUNNING + connected in the log). Non-zero = unhealthy (inspect the logs).

## Token rotation
`RELAY_TOKEN` is baked into the service env at install. If the token rotates (it must match Railway's
`tf-relay` `RELAY_TOKEN`): update `C:\Users\tonio\bin\relay-token.txt`, then **re-run the install script**
(it re-reads the file and reconfigures in place).

## Uninstall
```powershell
.\scripts\ops\install-tower-relay-nssm.ps1 -Uninstall
```

## Troubleshooting
- **"nssm.exe not found"** → run `scripts\wave19-nssm-migrate.ps1` (downloads NSSM), then re-run.
- **"Token file ... not found / empty"** → create `C:\Users\tonio\bin\relay-token.txt` with the Railway-matching secret.
- **"A PM2-managed 'tower-relay-client' is present"** → `pm2 delete tower-relay-client; pm2 save`, then re-run.
- **Health verification FAILED but RUNNING** → the service is up but not connected. Check `tower-relay-client.err.log` for: bad/rotated token (Railway mismatch), `tf-relay` unreachable, or backend (`localhost:4000`) down. The service auto-restarts; fix the cause and re-run `-Verify`.
- **Reboot test** → reboot the tower; `Get-Service TFRelayClient` should show `Running` automatically (proves `SERVICE_AUTO_START`).

## Why NSSM, not PM2
PM2 state is per-user and didn't reliably survive reboot/session changes; the relay running under
both PM2 and NSSM caused singleton thrash (see `reference_pm2_vs_nssm_supervisor_conflict`). NSSM gives
a single, boot-persistent, Windows-native supervisor with recovery + throttle — the enterprise choice
for an unattended 30-day vacation window.
