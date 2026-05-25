# Wave 26 Pass H - Tower Autonomy & Stability Hardening
# ONE-TIME ADMIN SETUP. Run as Administrator.
#
# Ships: H.1 Defender exclusions + H.2 NSSM TradingForgeAPI service +
#        H.3 zombie node killer task + H.5 nightly maintenance task.
# H.4 (health watchdog) is the n8n workflow already deployed (no admin needed).
#
# Idempotent - safe to re-run.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$TF_ROOT = "C:\Users\tonio\Projects\trading-forge\trading-forge"
$OLLAMA_MODELS = "$env:USERPROFILE\.ollama\models"
$LOG_DIR = "C:\Users\tonio\bin\tf-logs"

Write-Host ""
Write-Host "=== Wave 26 Pass H - Tower Autonomy Setup ===" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null

# ===== H.1 DEFENDER EXCLUSIONS =====
Write-Host "H.1 - Adding Windows Defender exclusions..." -ForegroundColor Yellow

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
        Add-MpPreference -ExclusionPath $p -ErrorAction Stop
        Write-Host "  + path: $p" -ForegroundColor Green
    } catch {
        Write-Host "  ! path skipped: $p" -ForegroundColor DarkGray
    }
}
foreach ($p in $EXCLUDED_PROCS) {
    try {
        Add-MpPreference -ExclusionProcess $p -ErrorAction Stop
        Write-Host "  + proc: $p" -ForegroundColor Green
    } catch {
        Write-Host "  ! proc skipped: $p" -ForegroundColor DarkGray
    }
}
$cur = (Get-MpPreference).ExclusionPath.Count
Write-Host "  Defender now has $cur path exclusions." -ForegroundColor Cyan
Write-Host ""

# ===== H.2 NSSM TradingForgeAPI SERVICE =====
Write-Host "H.2 - Installing NSSM TradingForgeAPI service..." -ForegroundColor Yellow

$nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source
if (-not $nssm) {
    Write-Host "  NSSM not found. Installing via winget..."
    winget install -e --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    $nssmCandidates = @(
        "C:\ProgramData\chocolatey\bin\nssm.exe",
        "C:\Program Files\NSSM\nssm.exe",
        "C:\Program Files (x86)\nssm\win64\nssm.exe",
        "C:\Program Files\NSSM\win64\nssm.exe"
    )
    foreach ($c in $nssmCandidates) { if (Test-Path $c) { $nssm = $c; break } }
    if (-not $nssm) { $nssm = (Get-Command nssm.exe -ErrorAction SilentlyContinue).Source }
}
if (-not $nssm) {
    Write-Host "  ERROR: NSSM still not found. Install manually from https://nssm.cc/download then re-run." -ForegroundColor Red
    exit 1
}
Write-Host "  NSSM found at: $nssm" -ForegroundColor Green

$SVC = "TradingForgeAPI"
$NODE_EXE = (Get-Command node.exe).Source
$TSX_CLI = "$TF_ROOT\node_modules\tsx\dist\cli.mjs"
$ENTRY = "$TF_ROOT\src\server\index.ts"

if (-not (Test-Path $TSX_CLI)) {
    Write-Host "  ERROR: tsx not found at $TSX_CLI. Run 'npm install' in $TF_ROOT first." -ForegroundColor Red
    exit 1
}

# Remove existing (idempotent)
& $nssm stop $SVC 2>&1 | Out-Null
& $nssm remove $SVC confirm 2>&1 | Out-Null

# Install fresh - node runs tsx cli which runs src/server/index.ts (no build needed)
& $nssm install $SVC $NODE_EXE "`"$TSX_CLI`" `"$ENTRY`""
& $nssm set $SVC AppDirectory $TF_ROOT
& $nssm set $SVC AppEnvironmentExtra "NODE_ENV=production" "PORT=4000"
& $nssm set $SVC AppStdout "$LOG_DIR\trading-forge-api.log"
& $nssm set $SVC AppStderr "$LOG_DIR\trading-forge-api.err.log"
& $nssm set $SVC AppRotateFiles 1
& $nssm set $SVC AppRotateOnline 1
& $nssm set $SVC AppRotateBytes 10485760
& $nssm set $SVC AppExit Default Restart
& $nssm set $SVC AppThrottle 5000
& $nssm set $SVC AppRestartDelay 2000
& $nssm set $SVC AppStopMethodSkip 0
& $nssm set $SVC AppStopMethodConsole 5000
& $nssm set $SVC AppKillProcessTree 1
& $nssm set $SVC Start SERVICE_AUTO_START
& $nssm set $SVC Description "Trading Forge API - auto-respawn on crash, boots on startup. Wave 26 Pass H."

# Start
& $nssm start $SVC 2>&1 | Out-Null
Start-Sleep -Seconds 8
$status = & $nssm status $SVC
Write-Host "  Service status: $status" -ForegroundColor Green

# Probe /api/health
try {
    $hc = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -TimeoutSec 10 -UseBasicParsing
    Write-Host "  /api/health responding HTTP $($hc.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "  /api/health not yet responding - tail $LOG_DIR\trading-forge-api.err.log" -ForegroundColor Yellow
}
Write-Host "  NSSM service installed and started." -ForegroundColor Cyan
Write-Host ""

# ===== H.3 ZOMBIE NODE KILLER (hourly task) =====
Write-Host "H.3 - Installing zombie node killer scheduled task..." -ForegroundColor Yellow

# Use single-quoted here-string so $ inside the script body stays literal
$KILLER_SCRIPT = @'
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
Register-ScheduledTask -TaskName "TF_ZombieNodeKiller" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Wave 26 Pass H.3 - kills orphan node procs" | Out-Null
Write-Host "  TF_ZombieNodeKiller scheduled (hourly)." -ForegroundColor Green
Write-Host ""

# ===== H.5 3AM NIGHTLY MAINTENANCE =====
Write-Host "H.5 - Installing 3am nightly maintenance task..." -ForegroundColor Yellow

# Single-quoted here-string - all $ stays literal in the output script.
# We string-replace the NSSM path placeholder after writing.
$MAINT_SCRIPT = @'
$ErrorActionPreference = "Continue"
$logPath = "C:\Users\tonio\bin\tf-logs\nightly-maint.log"
$nssm    = "__NSSM_PATH__"
Add-Content $logPath "[$(Get-Date -Format 'o')] === nightly maintenance start ==="

& $nssm restart TradingForgeAPI 2>&1 | Out-Null
Start-Sleep -Seconds 5
$svcStatus = (& $nssm status TradingForgeAPI)
Add-Content $logPath "[$(Get-Date -Format 'o')] svc_status=$svcStatus"

Get-ChildItem $env:TEMP -Filter "tsx-*" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem "$env:LOCALAPPDATA\npm-cache\_logs" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force -ErrorAction SilentlyContinue

$drive = Get-PSDrive C
$pctFree = [math]::Round($drive.Free / ($drive.Used + $drive.Free) * 100, 1)
Add-Content $logPath "[$(Get-Date -Format 'o')] disk_c_free_pct=$pctFree"
if ($pctFree -lt 20) {
    Add-Content $logPath "[$(Get-Date -Format 'o')] DISK_LOW_ALERT - POSTing to Discord via tf-relay"
    try {
        Invoke-RestMethod -Uri "https://tf-relay-production.up.railway.app/api/admin/alerts/disk-low" -Method Post -Body (@{free_pct = $pctFree} | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
    } catch {}
}
Add-Content $logPath "[$(Get-Date -Format 'o')] === nightly maintenance done ==="
'@
$MAINT_SCRIPT = $MAINT_SCRIPT.Replace('__NSSM_PATH__', $nssm)
$MAINT_PATH = "$LOG_DIR\nightly-maint.ps1"
$MAINT_SCRIPT | Out-File -FilePath $MAINT_PATH -Encoding UTF8 -Force

$action2 = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$MAINT_PATH`""
$trigger2 = New-ScheduledTaskTrigger -Daily -At "3:00AM"
$principal2 = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings2 = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -WakeToRun
Unregister-ScheduledTask -TaskName "TF_NightlyMaintenance" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "TF_NightlyMaintenance" -Action $action2 -Trigger $trigger2 -Principal $principal2 -Settings $settings2 -Description "Wave 26 Pass H.5 - 3am restart + cache prune + disk alert" | Out-Null
Write-Host "  TF_NightlyMaintenance scheduled (daily 3am, wake-to-run)." -ForegroundColor Green
Write-Host ""

# ===== SUMMARY =====
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Pass H Setup Complete" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Verify (no admin needed after this):"
Write-Host "  curl http://localhost:4000/api/health"
Write-Host "  sc query TradingForgeAPI"
Write-Host "  Get-ScheduledTask TF_ZombieNodeKiller, TF_NightlyMaintenance"
Write-Host ""
Write-Host "Live logs:  Get-Content $LOG_DIR\trading-forge-api.log -Tail 50 -Wait"
Write-Host "Err logs:   Get-Content $LOG_DIR\trading-forge-api.err.log -Tail 50 -Wait"
Write-Host "Restart:    nssm restart TradingForgeAPI"
Write-Host ""
Write-Host "Note: TF API runs via tsx (skips the 246 preexisting tsc errors)."
Write-Host "No npm run build needed - tsx loads .ts at runtime."
Write-Host ""
