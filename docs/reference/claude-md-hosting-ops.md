# Hosting Topology & Power Resilience (UPS + Kasa)

> Moved verbatim from CLAUDE.md §15a during the 2026-08-18 token-optimization pass.
> On-demand reference — load for tower/Railway ops, self-restart, or power-resilience setup.

## §15a. Hosting Topology (Pass 21, 2026-05-12)

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│ SKYTECH TOWER (home, 24/7)      │         │ RAILWAY (cloud, 99.95% SLA)      │
│                                 │         │                                  │
│  • NSSM TradingForgeAPI :4000   │────────▶│  • n8n service                   │
│  • Ollama (qwen3 + deepseek)    │         │  • Postgres                      │
│  • Python backtest engine       │         │  • tf-relay service              │
│  • DuckDB + Polars              │   WSS   │                                  │
│  tower-relay-client.cjs       ──┼────────▶│      forwards HTTP frames        │
└─────────────────────────────────┘  HTTP   └──────────────────────────────────┘
```

**Required env vars (tower-side .env):**
```
N8N_BASE_URL=https://n8n-production-84ff.up.railway.app
TF_N8N_API_KEY=<JWT from n8n Settings → API>
TF_BACKEND_PUBLIC_URL=https://tf-relay-production.up.railway.app
ADMIN_RESTART_HMAC_SECRET=<random 32+ char secret — set same value in .env and keep offline>
```

**Self-restart endpoint (Wave 24 Pass 1, Item 8):**
NSSM TradingForgeAPI auto-respawns stale code. Non-admin `sc stop` is denied. Use the HMAC-signed self-restart endpoint to trigger a graceful restart without admin access:
```bash
TIMESTAMP=$(date +%s)
REASON="deploy_2026-05-23"
SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
curl -X POST https://<relay>/api/admin/self-restart \
  -H "Content-Type: application/json" \
  -H "X-Restart-Signature: $SIG" \
  -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
```
Replay protection: timestamp drift > 60s → 401. NSSM respawns automatically to fresh code. Set NSSM `RestartDelay=2000` so process has time to flush logs before port re-binds.

**Pinned facts:**
- n8n on Railway requires `PORT=5678`
- Same `N8N_ENCRYPTION_KEY` as the previous local install
- Cloudflare Quick Tunnel URLs are DEPRECATED — use stable `tf-relay` service
- Tower relay client logs: `C:\Users\tonio\bin\tower-relay-client.log`
- Relay singleton — second client connection force-closes the older one
- `RELAY_TOKEN` must match between Railway env and tower client env

### Power resilience hardware — UPS + Kasa (HARD RULE for any live/PAPER+ operation)

Trading Forge is hybrid (CLAUDE.md §15a topology diagram): the institutional safety
stack — kill-switch L1-L9, B14 ci_high gate, compliance enforce, frozen-policy hash,
paper-journal-recon, audit chain, scheduler crons — all run ON THE TOWER inside
TradingForgeAPI. **None of these fire when the tower is offline.** A Pine→TradersPost
family bot would technically keep firing during a tower outage (TradingView + TradersPost
are cloud-only), but it would do so with zero institutional safety net — exactly the
retail-shaped failure mode the 4-wave 2026-06-23 hardening sweep eliminated. The Full
Slumdawg DIRECT path and the TF Gateway archetype path are HARD-DEPENDENT on the tower
and stop entirely when it goes down.

**Therefore: any operator running live or PAPER+ strategies MUST have both UPS and Kasa
installed before the first live trade.** This is not optional gear; it's the physical-layer
prerequisite for the safety contract.

**Topology (mandatory order):**
```
WALL OUTLET → KASA SMART PLUG → UPS → TOWER
```
Kasa upstream of UPS is critical: it lets `triggerRemotePowerCycle()` actually cut all
power downstream (including UPS battery) so the tower cold-boots. Reversed order
(Tower→Kasa→UPS or UPS upstream of Kasa) means the remote-cycle path cannot fully
de-energize the tower and NSSM may not respawn into fresh code. The UPS smooths grid
brownouts because Kasa just passes power through normally — UPS only sees Kasa cuts
during an explicit power-cycle (rare).

**Hardware (~$170-220 total):**
- **UPS:** CyberPower CP1500AVRLCD or APC BX1500M (~900W output, 10-30 min runtime for
  a desktop tower). Closes the brief-outage failure mode (open positions exposed to
  arbitrary fill at re-open after a 5-minute brownout). ~$150-200.
- **Kasa:** TP-Link HS103 (cheapest) or HS105 (more compact). HS110's energy monitoring
  is not used. ~$10-20.

**Role separation:**
| Failure mode | UPS handles | Kasa handles |
|---|---|---|
| Brief brownout (<30 min) during RTH | YES (invisible to bot) | no |
| Bot software hang (tower fine, API frozen) | no | YES (auto-cycles after 3 failed restarts) |
| Long outage (UPS battery exhausted) | dies gracefully, tower shuts down clean | restores power when grid returns + tower BIOS auto-boots |
| Tower BIOS lockup / NSSM stuck | no | YES (hard power-cycle) |

**Operator setup (one-time):**
1. Purchase UPS + Kasa per the spec above.
2. Cable: wall outlet → Kasa → UPS → tower (NOT tower → UPS → Kasa).
3. Connect Kasa to home Wi-Fi via the Kasa app.
4. Router DHCP reservation: assign a **static IP** to the Kasa's MAC address so the
   IP never changes across reboots.
5. **Kasa app config:** Device Settings → "Default Power State" → **On** (foolproof —
   ensures plug auto-energizes when grid returns after a long outage).
6. **Tower BIOS/UEFI config:** Power Management → "AC Power Recovery" (or "Restore on
   AC/Power Loss") → **Power On** (default is "Off" on most boards — without this, the
   Kasa energizing the tower does nothing because the motherboard won't auto-boot).
   This is the more important of the two — skip it and the Kasa work is dead.
7. Set the three env vars below in your tower `.env` and restart the backend.
8. Verify the boot log says "KASA remote power-cycle escape valve is ACTIVE" before
   declaring setup complete.

**Required env vars (all three or none — `startup-config-check.ts` enforces, and
M13 commit `ef3ba4c` 2026-06-23 added a runtime fail-CLOSED guard at
`triggerRemotePowerCycle()` entry that throws `remote_power_cycle_partial_config` if
called with partial config):**
```
KASA_DEVICE_IP=192.168.1.42    # IPv4 of the smart plug (static LAN IP)
KASA_USERNAME=you@example.com  # Kasa cloud account email
KASA_PASSWORD=yourpassword     # Kasa cloud account password
```

**What happens during a remote power-cycle (dead-man's heartbeat + KASA path):**
When the dead-man's heartbeat fires 3 auto-restart attempts in 24h and all fail, the
4th-attempt code path checks `KASA_DEVICE_IP`. If set, it invokes
`scripts/remote-power-cycle.ps1` (via `remote-power-cycle-service.ts`):
1. `remote-power-cycle-service.ts` writes a `recovery.remote_power_cycle_triggered`
   audit row with `correlationId` before touching the plug.
2. `scripts/remote-power-cycle.ps1` sends OFF→30s→ON via the local LAN API (port 9999,
   no cloud round-trip — works even during internet outages).
3. Script appends to `C:\Users\tonio\bin\kasa-cycle.log`.
4. Discord CRITICAL fires with operator-version (full technical + audit ID) AND
   family-grade postscript ("wait 10 minutes, check heartbeat, call Tony if still down").
5. NSSM auto-respawns TradingForgeAPI on power-up.

**What happens during a grid outage (UPS path):**
1. Grid drops → Kasa loses power → UPS battery kicks in immediately → tower keeps
   running.
2. If grid returns within UPS runtime (~10-30 min): zero downtime; bot doesn't notice.
3. If grid stays down past UPS runtime: UPS battery exhausts → controlled shutdown of
   tower (BIOS-managed if "AC Power Recovery" is set, otherwise NSSM crash-loop logs).
4. When grid returns: Kasa re-energizes (Default Power State = On) → tower BIOS detects
   AC restored → motherboard auto-boots → Windows boots → NSSM auto-starts
   TradingForgeAPI → backend back online + scheduler catches up missed crons.

**When KASA vars are absent:** the dead-man's heartbeat path fires the terminal Discord
CRITICAL with "hold the power button for 5 seconds" — operator must be physically
present. This is acceptable for CANDIDATE/TESTING strategies but a HARD violation of
the vacation-mode contract for PAPER+ strategies.

**When UPS is absent:** any grid blip causes uncontrolled tower shutdown mid-RTH. Open
positions are exposed to whatever fill the broker gives at re-open. There is no
software-side mitigation for this — the safety stack we shipped cannot fire when
electricity stops.

**Family-distribution mandate:** each family member running an independent bot needs
their own UPS + Kasa on their own tower. Per memory `feedback_family_not_part_of_operator_scaling`,
family members are not a single-tower-shared operation; each is a standalone deployment.

---

> **Living rules end here.** For build history, see `AGENT-LOGS.md`. For subsystem architecture, see `Trading Forge System Map v2.md`. For agent contract, see `AGENTS.md`.
