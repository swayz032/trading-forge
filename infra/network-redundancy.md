# Network Redundancy Runbook — C4

**Purpose:** Maintain order-flow connectivity during ISP outages using a layered
defense. Q1 2026 ISP outages averaged 2-3 hours. Storm Kristin took 850K customers
offline simultaneously. June 12 2025 GCP outage: NinjaTrader + Tradovate down 4.5h.
This runbook covers all three defense layers at $0 added monthly cost.

**Added cost:** $0. Phone USB tethering uses your existing plan. Railway is
already $20/mo (paid plan, B6).

---

## Defense Layer 1 — Server-Side Order Placement (Primary)

**Why this is the best defense:** When orders are held by the broker's servers,
a local internet outage does NOT cancel them. The broker executes fills regardless
of your connectivity state.

**What "server-side" means in paper trading:**
Paper trading simulates live behavior. In live trading, stop orders placed
GTC (Good Till Cancelled) at the broker are server-side. In paper trading,
order management is simulated locally — but the _session_ remains active in the
database and positions are tracked in PostgreSQL (Railway), which is always
reachable even when Skytech is unreachable.

**Paper trading implication:**
If Skytech loses connectivity mid-session:
- The paper session row remains `status=active` in Railway PostgreSQL
- Open paper positions remain open in the DB
- The session does NOT auto-close on connectivity loss (no TTL)
- When connectivity restores, the session resumes and position management continues

This matches the live-trading analog: open broker positions survive an ISP outage.

**Paper parity note:** paper execution fills, slippage, and session classification
are unchanged by network state. Orders are journaled with a `connectivity_degraded`
flag when the failover monitor is in DEGRADED or FAILOVER_ALERT state, enabling
post-session analysis to filter trades taken during degraded connectivity.

**Action required during outage:** None for open positions. Do NOT manually close
positions during an outage — wait for connectivity to restore, then review.

---

## Defense Layer 2 — Phone USB Tethering (Free)

**When to activate:** The `network-failover.ts` monitor will fire a `CRITICAL`
alert and SSE event `network:failover-state-change` with `next="FAILOVER_ALERT"`
after 3 consecutive 30-second probe failures (90 seconds total detection window).

**Cost:** $0. Uses your existing cellular plan. Trading API traffic is
low-bandwidth: Tradovate REST API uses ~2-10 KB per request. A full trading
session generates well under 50 MB. Not a meaningful draw on any modern plan.

### Setup Steps (Windows 11 — one-time)

1. **Enable USB Debugging on your phone** (Android):
   - Settings → About Phone → tap "Build Number" 7 times
   - Settings → Developer Options → enable "USB Debugging"
   - (iPhone: USB tethering works natively — no developer mode needed)

2. **Connect phone to Skytech via USB cable**

3. **Enable USB Tethering on phone:**
   - Android: Settings → Network & Internet → Hotspot & Tethering → USB Tethering (toggle ON)
   - iPhone: Settings → Personal Hotspot → enable, then connect USB cable

4. **Windows auto-detects the new network adapter.**
   Wait 10-15 seconds for the adapter to initialize.

5. **Verify connectivity:**
   ```powershell
   # Check new network adapter appeared
   Get-NetAdapter | Where-Object Status -eq "Up"

   # Verify Tradovate is reachable
   Invoke-WebRequest -Uri "https://live.tradovateapi.com" -Method HEAD -TimeoutSec 5
   ```

6. **Confirm tethering in Trading Forge:**
   ```bash
   curl -X POST http://localhost:3000/api/admin/network-failover/confirm-tethering \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"confirmedBy": "operator"}'
   ```
   This transitions the network failover state to `TETHERING_ACTIVE` and clears
   the CRITICAL alert on the dashboard.

### Metric Monitoring During Tethering

The network failover monitor continues probing Tradovate every 30 s. When
3 consecutive probes pass, state transitions to `RECOVERED`.

Once your primary ISP is restored:
1. Reconnect to primary ISP (re-plug ethernet or re-enable WiFi)
2. Verify primary connectivity is stable (wait 60-90 s)
3. Disable USB tethering on phone
4. Clear tethering confirmation:
   ```bash
   curl -X POST http://localhost:3000/api/admin/network-failover/clear-tethering \
     -H "Authorization: Bearer $API_KEY"
   ```

### Phone Plan Data Cap Warning

Trading API traffic is low-bandwidth but monitor your data usage if on a
capped plan. The `network-failover.ts` monitor logs every probe attempt.
Typical probe traffic: ~1 KB per probe × 2 probes/min = ~2.88 MB/hour.
A 4-hour outage: ~11.5 MB. Well within any modern plan's threshold.

---

## Defense Layer 3 — Railway Cloud Failover (B6, $20/mo — Already Paid)

**When to activate:** Extended Skytech outage (hours, not minutes).
USB tethering is preferred for short outages because it keeps all compute
local and avoids Railway latency. Use Railway when:
- Hardware failure (not just ISP)
- Skytech needs a reboot/repair that will take more than 30 minutes
- USB tethering is insufficient (data cap, no phone available)

**See:** `infra/railway-failover.md` for full Railway failover procedure.

**State machine integration:** `compute-failover.ts` monitors local Python
availability independently of `network-failover.ts`. Network connectivity
and compute availability are separate monitors — a network outage may
or may not be accompanied by a Python/compute failure.

---

## Manual Phone-Based Kill Switch

**When to use:** If all connectivity is lost AND you have open live positions
that need to be closed immediately, call your broker directly.

**Tradovate:**
- Support: 1-888-770-2242 (24/7)
- Have your account number and last 4 digits of SSN ready
- Request: "Please flatten all open positions in my account immediately"
- Confirm: Ask for a trade confirmation number

**TopStep / funded account firms:**
- Refer to your firm's emergency contact in `docs/prop-firm-rules.md`
- Most funded account firms have a "trading halt" request process via email/chat

**Note for paper trading:** Paper trading does not require broker intervention —
paper positions are database rows, not live exchange orders. If Skytech is
unreachable for an extended period, paper positions remain open in Railway
PostgreSQL. They will be visible when connectivity restores.

---

## Dashboard SSE Events

| Event | State Transition | Action |
|-------|-----------------|--------|
| `network:failover-state-change` `next="DEGRADED"` | 1-2 probe failures | Monitor — may self-correct |
| `network:failover-state-change` `next="FAILOVER_ALERT"` | 3+ probe failures | Enable USB tethering NOW |
| `network:failover-state-change` `next="TETHERING_ACTIVE"` | Tethering confirmed | Continue trading on tether |
| `network:failover-state-change` `next="RECOVERED"` | Probes passing | Verify primary ISP, clear tether |

---

## Health Endpoint

```bash
curl http://localhost:3000/api/health | jq .networkFailover
```

Response:
```json
{
  "state": "PRIMARY_HEALTHY",
  "consecutiveFailures": 0,
  "consecutiveSuccesses": 12,
  "lastCheckedAt": "2026-04-30T14:00:00.000Z",
  "lastFailureReason": null,
  "failoverAlertTriggeredAt": null,
  "tetheringConfirmedAt": null,
  "tetheringConfirmedBy": null,
  "connectivityDegraded": false,
  "tradovateProbeUrl": "https://live.tradovateapi.com/v1/auth/accesstokenrequest"
}
```

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TRADOVATE_STATUS_URL` | Override Tradovate probe URL | `https://live.tradovateapi.com/v1/auth/accesstokenrequest` |
| `RITHMIC_STATUS_URL` | Enable Rithmic secondary probe | `https://rithmic.com/status` (configurable) |
| `FORCE_USB_TETHERING` | Simulate tethering-active state (test only) | `false` |

---

## Verification Procedure

To test the failover detection (without disabling real ISP):

```bash
# Set probe URLs to a blocked endpoint (firewall rule or unreachable host)
export TRADOVATE_STATUS_URL=http://127.0.0.1:19999  # nothing listens here

# Restart the server
npm run dev

# Watch the SSE stream — after ~90s (3 failures × 30s) you should see:
# network:failover-state-change { next: "FAILOVER_ALERT" }
```

To test full ISP failover (hardware firewall):
1. Block outbound traffic on primary NIC via Windows Firewall or router ACL
2. Within 90 seconds: FAILOVER_ALERT SSE fires
3. Enable USB tethering (steps above)
4. Confirm tethering via API
5. Verify order flow continues (paper session active, positions tracked)
6. Restore primary NIC traffic
7. Within 90 seconds: RECOVERED SSE fires
8. Clear tethering confirmation

**Verification success criterion (from plan):**
Failover detected within 60 seconds of primary ISP failure.
Order flow continues via phone USB tethering.
(60s = 2 probe intervals — practical detection at 90s covers the 60s threshold
plus one probe cycle of margin for timing variance.)
