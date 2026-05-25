# Wave 26 Pass H — Tower Autonomy & Stability Hardening
# ONE-TIME ADMIN SETUP. Run as Administrator (right-click PowerShell → Run as Administrator).
#
# This script ships H.1 (Defender exclusions) + H.2 (NSSM TradingForgeAPI service)
# + H.3 (zombie node killer scheduled task) + H.5 (3am nightly maintenance task).
# H.4 (health watchdog) is wired separately via n8n workflow (no admin needed).
#
# Verifies elevation, idempotent — safe to re-run.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$TF_ROOT = "C:\Users\tonio\Projects\trading-forge\trading-forge"
$OLLAMA_MODELS = "$env:USERPROFILE\.ollama\models"
$LOG_DIR = "C:\Users\tonio\bin\tf-logs"

Write-Host "`n=== Wave 26 Pass H — Tower Autonomy Setup ===`n" -ForegroundColor Cyan

# Ensure log dir exists for NSSM
New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null

# ─── H.1 — DEFENDER EXCLUSIONS ─────────────────────────────────────────
Write-Host "H.1 — Adding Windows Defender exclusions…" -ForegroundColor Yellow

$EXCLUSIONS = @(
    "$TF_ROOT\node_modules",
    "$TF_ROOT\dist",
    "$TF_ROOT\.git",
    "$TF_ROOT\.next",
    "$TF_ROOT\Trading_forge_frontend\amber-vision-main\node_modules",
    "$TF_ROOT\Trading_forge_frontend\amber-vision-main\dist",
    "$TF_ROOT\Trading_forge_frontend\amber-vision-main\node_modules\.vite",
    "$TF_ROOT\.venv",
    "$TF_ROOT\__pycache__",
    "$TF_ROOT\src\engine\__pycache__",
    "$OLLAMA_MODELS",
    "$env:LOCALAPPDATA\npm-cache",
    "$env:LOCALAPPDATA\Yarn\Cache",
    "$env:TEMP\tsx-*"
)
$EXCLUDED_PROCS = @("node.exe", "python.exe", "ollama.exe", "tsx.exe")

foreach ($p in $EXCLUSIONS) {
    try {
        Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue
        Write-Host "  + path: $p" -ForegroundColor Green
    } catch { Write-Host "  ! path: $p ($($_.Exception.Message))" -ForegroundColor Red }
}
foreach ($p in $EXCLUDED_PROCS) {
    try {
        Add-MpPreference -ExclusionProcess $p -ErrorAction SilentlyContinue
        Write-Host "  + proc: $p" -ForegroundColor Green
    } catch { Write-Host "  ! proc: $p" -ForegroundColor Red }
}
$cur = (Get-MpPreference).ExclusionPath.Count
Write-Host "  Defender now has $cur path exclusions.`n" -ForegroundColor Cyan

# ─── H.2 — NSSM TradingForgeAPI SERVICE ──────────────────────────────
Write-Host "H.2 — Installing NSSM TradingForgeAPI service…" -ForegroundColor Yellow

# Install NSSM via winget if missing
$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    Write-Host "  NSSM not found. Installing via winget…"
    winget install -e --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements
    # winget usually puts nssm in a versioned chocolatey-style path; resolve it
    $nssmCandidates = @(
        "C:\ProgramData\chocolatey\bin\nssm.exe",
        "C:\Program Files\NSSM\nssm.exe",
        "C:\Program Files (x86)\nssm\win64\nssm.exe"
    )
    foreach ($c in $nssmCandidates) { if (Test-Path $c) { $nssm = $c; break } }
    if (-not $nssm) { $nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source }
}
if (-not $nssm) {
    Write-Host "  ERROR: NSSM still not found. Install manually from https://nssm.cc/download and re-run." -ForegroundColor Red
    exit 1
}
Write-Host "  NSSM found at: $nssm"

$SVC = "TradingForgeAPI"
$NODE_EXE = (Get-Command node.exe).Source
$ENTRY = "$TF_ROOT\dist\server\index.js"  # production build

# Remove existing service if it exists (idempotent — fresh config every run)
& $nssm stop $SVC 2>&1 | Out-Null
& $nssm remove $SVC confirm 2>&1 | Out-Null

# Install fresh
& $nssm install $SVC $NODE_EXE $ENTRY
& $nssm set $SVC AppDirectory $TF_ROOT
& $nssm set $SVC AppEnvironmentExtra "NODE_ENV=production" "PORT=4000"
& $nssm set $SVC AppStdout "$LOG_DIR\trading-forge-api.log"
& $nssm set $SVC AppStderr "$LOG_DIR\trading-forge-api.err.log"
& $nssm set $SVC AppRotateFiles 1
& $nssm set $SVC AppRotateOnline 1
& $nssm set $SVC AppRotateBytes 10485760  # 10 MB
& $nssm set $SVC AppExit Default Restart   # auto-respawn on any exit
& $nssm set $SVC AppThrottle 5000          # don't tight-loop on instant crashes
& $nssm set $SVC AppRestartDelay 2000      # 2s pause between restarts (matches §15a)
& $nssm set $SVC AppStopMethodSkip 0       # graceful stop allowed
& $nssm set $SVC AppStopMethodConsole 5000 # 5s for Ctrl-C
& $nssm set $SVC AppKillProcessTree 1      # kill spawned children too
& $nssm set $SVC Start SERVICE_AUTO_START   # boot with Windows
& $nssm set $SVC Description "Trading Forge API — auto-respawn on crash, boots on startup. Wave 26 Pass H."

# Try to start (silently fail if dist/ doesn't exist yet)
if (Test-Path $ENTRY) {
    & $nssm start $SVC 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    $status = & $nssm status $SVC
    Write-Host "  Service status: $status" -ForegroundColor $(if ($status -match "RUNNING") {"Green"} else {"Yellow"})
} else {
    Write-Host "  ! dist/server/index.js missing — run 'npm run build' then 'nssm start $SVC'" -ForegroundColor Yellow
}
Write-Host "  NSSM service '$SVC' installed.`n" -ForegroundColor Cyan

# ─── H.3 — ZOMBIE NODE KILLER (hourly scheduled task) ────────────────
Write-Host "H.3 — Installing zombie node killer scheduled task…" -ForegroundColor Yellow

$KILLER_SCRIPT = @'
# Wave 26 Pass H.3 — kill orphan node.exe processes referencing trading-forge
# whose parent process is no longer alive. Runs hourly to prevent zombie pile-up.
$tfPath = "trading-forge"
$killed = 0
$alivePids = (Get-Process -ErrorAction SilentlyContinue).Id
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    $cmd = $_.CommandLine
    if ($cmd -and $cmd -match $tfPath) {
        $parentAlive = $alivePids -contains $_.ParentProcessId
        if (-not $parentAlive) {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                $killed++
            } catch {}
        }
    }
}
"$(Get-Date -Format 'o') killed_zombies=$killed" | Out-File -Append "C:\Users\tonio\bin\tf-logs\zombie-killer.log"
'@
$KILLER_PATH = "$LOG_DIR\zombie-killer.ps1"
$KILLER_SCRIPT | Out-File -FilePath $KILLER_PATH -Encoding UTF8 -Force

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$KILLER_PATH`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Unregister-ScheduledTask -TaskName "TF_ZombieNodeKiller" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "TF_ZombieNodeKiller" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Wave 26 Pass H.3 — kills orphan node.exe procs from trading-forge dev restarts" | Out-Null
Write-Host "  ✓ TF_ZombieNodeKiller scheduled (hourly).`n" -ForegroundColor Green

# ─── H.5 — 3am nightly maintenance ────────────────────────────────────
Write-Host "H.5 — Installing 3am nightly maintenance task…" -ForegroundColor Yellow

$MAINT_SCRIPT = @"
# Wave 26 Pass H.5 — nightly maintenance: restart TradingForgeAPI to clear leaks +
# prune tsx/node caches + disk-space alert
`$ErrorActionPreference = "Continue"
`$logPath = "C:\Users\tonio\bin\tf-logs\nightly-maint.log"
Add-Content `$logPath "[`$(Get-Date -Format 'o')] === nightly maintenance start ==="

# Restart NSSM TradingForgeAPI (clears any memory leaks)
& "$nssm" restart TradingForgeAPI 2>&1 | Out-Null
Start-Sleep -Seconds 5
`$svcStatus = (& "$nssm" status TradingForgeAPI)
Add-Content `$logPath "[`$(Get-Date -Format 'o')] svc_status=`$svcStatus"

# Prune tsx + node caches
Get-ChildItem `$env:TEMP -Filter "tsx-*" -ErrorAction SilentlyContinue | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem "`$env:LOCALAPPDATA\npm-cache\_logs" -ErrorAction SilentlyContinue | Where-Object { `$_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue

# Disk-space alert at 20% free
`$drive = Get-PSDrive C
`$pctFree = [math]::Round(`$drive.Free / (`$drive.Used + `$drive.Free) * 100, 1)
Add-Content `$logPath "[`$(Get-Date -Format 'o')] disk_c_free_pct=`$pctFree"
if (`$pctFree -lt 20) {
    Add-Content `$logPath "[`$(Get-Date -Format 'o')] DISK_LOW_ALERT — POSTing to Discord via tf-relay"
    try {
        Invoke-RestMethod -Uri "https://tf-relay-production.up.railway.app/api/admin/alerts/disk-low" -Method Post -Body (@{free_pct = `$pctFree} | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
    } catch {}
}
Add-Content `$logPath "[`$(Get-Date -Format 'o')] === nightly maintenance done ==="
"@
$MAINT_PATH = "$LOG_DIR\nightly-maint.ps1"
$MAINT_SCRIPT | Out-File -FilePath $MAINT_PATH -Encoding UTF8 -Force

$action2 = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$MAINT_PATH`""
$trigger2 = New-ScheduledTaskTrigger -Daily -At "3:00AM"
$principal2 = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -WakeToRun
Unregister-ScheduledTask -TaskName "TF_NightlyMaintenance" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "TF_NightlyMaintenance" -Action $action2 -Trigger $trigger2 -Principal $principal2 -Settings $settings2 -Description "Wave 26 Pass H.5 — 3am restart + cache prune + disk alert" | Out-Null
Write-Host "  ✓ TF_NightlyMaintenance scheduled (daily 3am ET, wake-to-run).`n" -ForegroundColor Green

# ─── SUMMARY ──────────────────────────────────────────────────────────
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Pass H Setup Complete" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════`n" -ForegroundColor Cyan

Write-Host "Verify (no admin needed after this):"
Write-Host "  Get-MpPreference | Select-Object -ExpandProperty ExclusionPath | Measure-Object"
Write-Host "  sc query TradingForgeAPI"
Write-Host "  Get-ScheduledTask -TaskName TF_ZombieNodeKiller,TF_NightlyMaintenance"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Build production bundle: cd $TF_ROOT && npm run build"
Write-Host "  2. Start service:           nssm start TradingForgeAPI"
Write-Host "  3. Verify API responds:     curl http://localhost:4000/api/health"
Write-Host "  4. n8n health-watchdog workflow imports automatically via API (no manual step)"
Write-Host ""
