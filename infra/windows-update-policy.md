# Windows Update Policy Runbook — C8

**Purpose:** Prevent forced Windows reboots during market hours. April 2024,
April 2025, and April 2026 (KB5082063) all triggered reboot loops on Windows
Server / Windows 11. A reboot during cash-session trading kills active
positions; if short ES and ESM6 gaps up while Skytech is offline, losses can
be catastrophic.

**Added cost:** $0. Pure Windows Group Policy + PowerShell + the Trading Forge
scheduler. No third-party agents.

**Failure mode this closes:** the August 2024 KB5041580 reboot caused a 47-min
outage during US Open. The April 2026 KB5082063 cycle on Server 2025 caused
multi-hour reboot loops on the morning of 2026-04-09. Pattern is annual and
predictable.

---

## Defense Layer 1 — Group Policy: Disable Auto-Restart

Group Policy edits below are **mandatory** for any Skytech tower running
Trading Forge. Apply via `gpedit.msc` (Pro/Enterprise) or via the registry
fallback at the bottom of this section (Home edition).

### Path
`Computer Configuration → Administrative Templates → Windows Components → Windows Update → Manage end user experience`

### Policies to enable

| Policy | Setting | Why |
| --- | --- | --- |
| `No auto-restart with logged on users for scheduled automatic updates installations` | **Enabled** | Defers any scheduled restart while a user is signed in. Trading Forge is interactive — operator is always signed in during market hours. |
| `Turn off auto-restart for updates during active hours` | **Enabled**, Start = `00:00`, End = `23:59` | Active hours can only span 18 contiguous hours on Win11; we use the full allowed window plus the registry override below to cover the remaining 6 hours (futures ETH session). |
| `Specify deadline before auto-restart for update installation` | **Enabled**, deadline = **14 days** | The maximum supported deadline. Forces a manual maintenance window every two weeks. |
| `Specify Engaged restart transition and notification schedule for updates` | **Enabled**, transition = **7 days**, snooze = **3 days** | Lets the operator snooze any "restart soon" prompt for up to 3 days, covering any unexpected weekend assignment. |
| `Configure Automatic Updates` | **Enabled**, option **3** (Auto download and notify for install) | Updates download in the background but do **not** install without operator action. |

### Active hours registry fallback (covers the 6-hour gap)

Windows 11/Server 2025 caps the GUI active-hours setting at 18 hours. Futures
trade 23 hours, Sun 6 PM ET → Fri 5 PM ET. Set the registry keys below to
cover the remaining hours. PowerShell (run as Administrator):

```powershell
# Active hours: 00:00 → 23:59 max in GUI. Use scan-deferral + reboot-deferral
# registry to cover the full 23/6 futures window.
$path = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
New-Item -Path $path -Force | Out-Null
Set-ItemProperty -Path $path -Name 'NoAutoRebootWithLoggedOnUsers' -Value 1 -Type DWord
Set-ItemProperty -Path $path -Name 'AUPowerManagement'             -Value 0 -Type DWord
Set-ItemProperty -Path $path -Name 'NoAutoUpdate'                  -Value 0 -Type DWord
Set-ItemProperty -Path $path -Name 'AUOptions'                     -Value 3 -Type DWord
Set-ItemProperty -Path $path -Name 'ScheduledInstallDay'           -Value 0 -Type DWord
Set-ItemProperty -Path $path -Name 'ScheduledInstallTime'          -Value 3 -Type DWord  # 03:00 ET, well after 17:00 ET futures close

# Defer feature updates 365 days, quality (security) updates 7 days
$deferPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
New-Item -Path $deferPath -Force | Out-Null
Set-ItemProperty -Path $deferPath -Name 'DeferFeatureUpdates'         -Value 1   -Type DWord
Set-ItemProperty -Path $deferPath -Name 'DeferFeatureUpdatesPeriodInDays' -Value 365 -Type DWord
Set-ItemProperty -Path $deferPath -Name 'DeferQualityUpdates'         -Value 1   -Type DWord
Set-ItemProperty -Path $deferPath -Name 'DeferQualityUpdatesPeriodInDays' -Value 7   -Type DWord

# Force gpupdate so the policies take effect immediately
gpupdate /force
```

### Verify the policy is active

```powershell
# Should print 1 — auto-restart suppressed when user signed in
(Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU').NoAutoRebootWithLoggedOnUsers

# Should print 7 — quality updates deferred
(Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate').DeferQualityUpdatesPeriodInDays

# Verify reboot-required state
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
# False = no pending reboot. True = pending — DO NOT TRADE.
```

---

## Defense Layer 2 — Active Hours (Full Weekly Coverage)

Trading Forge active-hours layout:

| Window | Reason |
| --- | --- |
| Sun 18:00 ET → Fri 17:00 ET | Futures regular trading (ETH + RTH) |
| Fri 17:00 ET → Sun 18:00 ET | Maintenance window — manual updates only |

Only Friday 17:00 ET → Sunday 18:00 ET (~49 hours) is safe for installing
updates that require a reboot. Outside that window, the operator must
**never** install updates. The C8 cron (8:00 AM ET pre-market) is the
forcing function that catches operator drift.

---

## Defense Layer 3 — Manual Update Procedure

Run this only on **Friday after 17:00 ET** or **before Sunday 18:00 ET**.
Never during a trading session.

```powershell
# 1. Pause Trading Forge pipeline first (fail-closed)
curl -X POST "http://localhost:3000/api/pipeline-control/mode" `
     -H "Content-Type: application/json" `
     -d '{"mode":"PAUSED","reason":"manual windows-update window"}'

# 2. Confirm pause took effect
curl http://localhost:3000/api/pipeline-control/mode

# 3. Trigger update scan + install
$session = New-Object -ComObject 'Microsoft.Update.Session'
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
"$($result.Updates.Count) updates available"

if ($result.Updates.Count -gt 0) {
    $updates = New-Object -ComObject 'Microsoft.Update.UpdateColl'
    foreach ($u in $result.Updates) { [void]$updates.Add($u) }
    $downloader = $session.CreateUpdateDownloader()
    $downloader.Updates = $updates
    [void]$downloader.Download()
    $installer = $session.CreateUpdateInstaller()
    $installer.Updates = $updates
    $installResult = $installer.Install()
    "Reboot required: $($installResult.RebootRequired)"
}

# 4. If reboot required, reboot NOW (before market opens)
shutdown /r /t 60 /c "Trading Forge maintenance reboot"

# 5. After reboot, run the health check and resume pipeline
pwsh -NoProfile -File C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\pre-trading-day-health-check.ps1
# If exit code = 0, resume:
curl -X POST "http://localhost:3000/api/pipeline-control/mode" `
     -H "Content-Type: application/json" `
     -d '{"mode":"ACTIVE","reason":"post-update health check passed"}'
```

---

## Defense Layer 4 — Pre-Market Health Check (Automated)

The Trading Forge scheduler fires a cron at **08:00 AM ET, weekdays**, that
runs `scripts/pre-trading-day-health-check.ps1`. The script:

1. Reads the `RebootPending` and `RebootRequired` registry keys plus
   `PendingFileRenameOperations` and the CCM RebootPending flag.
2. Reads the `WindowsUpdateClient` event log for failed-install events
   (event IDs 20 and 25) in the last 24 hours.
3. Confirms the Trading Forge Node and Python processes are live.
4. Confirms C: drive has at least 10 GB free.
5. Confirms RAM utilization is below 80%.

### Exit-code → action table

| Exit code | Meaning | Action taken by cron |
| --- | --- | --- |
| 0 | Healthy | No-op, log success |
| 1 | Pending reboot | `setMode("PAUSED", "windows-pending-reboot")` + critical alert |
| 2 | Update install failures in last 24h | `setMode("PAUSED", "windows-update-failures")` + critical alert |
| 3 | Service / disk / RAM degraded | `setMode("PAUSED", "host-degraded")` + critical alert |
| 99 | Script crash | `setMode("PAUSED", "health-check-crash")` + critical alert |
| _any non-zero_ | Generic failure | Fail-CLOSED — pause, alert, await operator |

**Bypass for testing only:** set `BYPASS_PRE_MARKET_HEALTH_CHECK=true` in
the Trading Forge process environment. The cron will log a WARNING and
skip both the script and the pause. Use this only when load-testing
post-update-pause behavior in a sandbox.

### Verify the cron is registered

```bash
# From the trading-forge directory
curl http://localhost:3000/api/admin/scheduler/health | jq '."pre-trading-day-health-check"'
```

The response should contain `lastRunAt` after the first 08:00 ET fire.

---

## Manual Verification Commands

Run these any time you suspect a Windows update has slipped through:

```powershell
# 1. Pending reboot check (fastest)
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\PackagesPending'
)
$paths | ForEach-Object { [pscustomobject]@{ path = $_; pending = (Test-Path $_) } } | Format-Table

# 2. Recent update failures
Get-WinEvent -FilterHashtable @{
  LogName='System'
  ProviderName='Microsoft-Windows-WindowsUpdateClient'
  Id=@(20,25)
  StartTime=(Get-Date).AddHours(-24)
} | Select TimeCreated, Id, Message | Format-List

# 3. Last 5 installed updates (sanity check)
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5

# 4. Run the full Trading Forge health check
pwsh -NoProfile -File C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\pre-trading-day-health-check.ps1
$LASTEXITCODE  # 0 = healthy
```

---

## Recovery After a Forced Reboot

If a Windows update slipped past every defense and Skytech rebooted during
market hours:

1. Sign in immediately.
2. Run the manual verification commands above.
3. Open the Trading Forge dashboard. The pipeline will already be PAUSED
   if the 8:00 AM ET cron caught the pending reboot. If the reboot
   happened mid-session, dispatch the C4 network-failover runbook
   (`infra/network-redundancy.md`) to confirm broker connectivity is
   restored before doing anything else.
4. Inspect open positions in the Live tab. Do **not** auto-flatten — the
   prop-firm side may have already filled stops while Skytech was offline.
5. Reconcile actual broker positions vs `paper_positions` table (or vs
   the broker GUI for live).
6. Once positions are reconciled and the host is stable, run the health
   check (`pre-trading-day-health-check.ps1`) and resume the pipeline.

---

## References

- C4 — Network Redundancy Runbook: `infra/network-redundancy.md`
- C8 — Pre-Trading-Day Health Check Script: `scripts/pre-trading-day-health-check.ps1`
- Pipeline Control Service: `src/server/services/pipeline-control-service.ts`
- Scheduler: `src/server/scheduler.ts` (job name `pre-trading-day-health-check`)
- KB5082063 (April 2026): Microsoft Security Update — Windows Server 2025
- KB5041580 (August 2024): Reboot loop on Windows 11 23H2
