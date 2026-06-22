# Wave 26 Pass H follow-up - NSSM wrapper for tower-relay-client.cjs
# Closes the autonomy gap caught 2026-05-25: Pass H wrapped TradingForgeAPI
# but missed the relay-client.cjs WebSocket bridge to Railway tf-relay.
# Manual cmd-window loop went dark on 2026-05-13 and stayed dark for 12 days
# until operator noticed via watchdog 503s.
#
# ONE-TIME ADMIN SETUP. Run as Administrator. Idempotent.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Continue"

$SVC      = "TFRelayClient"
$NSSM     = "C:\Users\tonio\bin\nssm\nssm.exe"
$CMD_EXE  = "C:\Windows\System32\cmd.exe"
$LAUNCHER = "C:\Users\tonio\bin\start-tower-relay-client.cmd"
$LOG_DIR  = "C:\Users\tonio\bin\tf-logs"

Write-Host ""
Write-Host "=== Wave 26 Pass H-2 - NSSM TFRelayClient ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $NSSM))     { Write-Host "FAIL: nssm.exe missing at $NSSM" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $LAUNCHER)) { Write-Host "FAIL: launcher missing at $LAUNCHER" -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null

# Stop + remove if exists (idempotent re-run)
& $CMD_EXE /c "`"$NSSM`" stop $SVC >NUL 2>&1"
& $CMD_EXE /c "`"$NSSM`" remove $SVC confirm >NUL 2>&1"

# Install as wrapper around the existing .cmd loop. NSSM supervises the cmd.exe;
# the cmd.exe internal `:loop` still respawns the node child on its own exits.
# If cmd.exe itself dies (rare), NSSM restarts it. Belt-and-suspenders.
& $NSSM install $SVC $CMD_EXE "/c `"$LAUNCHER`""
& $NSSM set $SVC AppDirectory "C:\Users\tonio\bin"
& $NSSM set $SVC AppExit Default Restart
& $NSSM set $SVC AppRestartDelay 2000
& $NSSM set $SVC AppThrottle 5000
& $NSSM set $SVC AppStdout "$LOG_DIR\tf-relay-client.out.log"
& $NSSM set $SVC AppStderr "$LOG_DIR\tf-relay-client.err.log"
& $NSSM set $SVC AppRotateFiles 1
& $NSSM set $SVC AppRotateBytes 10485760
& $NSSM set $SVC Start SERVICE_AUTO_START
& $NSSM set $SVC Description "Trading Forge tower-relay-client.cjs supervisor (WebSocket bridge to Railway tf-relay)"

# Start it
& $NSSM start $SVC
Start-Sleep -Seconds 3

# Verify
$svcInfo = Get-Service -Name $SVC -ErrorAction SilentlyContinue
if ($svcInfo -and $svcInfo.Status -eq "Running") {
    Write-Host "OK: $SVC installed and running" -ForegroundColor Green
} else {
    Write-Host "WARN: $SVC state=$($svcInfo.Status) - check logs at $LOG_DIR" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Verify: Get-Service $SVC"
Write-Host "Logs:   $LOG_DIR\tf-relay-client.{out,err}.log"
Write-Host "Stop:   & '$NSSM' stop $SVC"
Write-Host "Remove: & '$NSSM' remove $SVC confirm"
Write-Host ""
