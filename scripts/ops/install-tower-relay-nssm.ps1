#requires -Version 5.1
<#
.SYNOPSIS
  Enterprise-grade NSSM install / reconfigure / verify / uninstall for the Trading Forge
  tower relay client (scripts/tower-relay-client.cjs).

.DESCRIPTION
  Closes vacation-autonomy gap DEBT-5: registers the relay WebSocket bridge (tower to Railway
  tf-relay) as its OWN Windows service so it auto-restarts on crash AND survives reboot,
  supervised INDEPENDENTLY of TradingForgeAPI. Without this, a relay crash during a vacation
  kills the Discord/alert fanout with no self-heal.

  Enterprise properties:
    - Idempotent: re-running reconfigures in place (stop, set, start); never errors on re-run.
    - Fail-loud preflight: admin, node.exe, nssm.exe, relay script, token file, log dir all
      verified BEFORE any change; aborts with a clear reason if any is missing.
    - PM2-dupe guard: detects a PM2-managed tower-relay-client (the known singleton-thrash
      conflict) and refuses to proceed until it is removed (pm2 delete tower-relay-client).
    - Supervised recovery: AppExit=Restart, AppRestartDelay=2000ms, AppThrottle=10000ms
      (a crash inside 10s counts as a failure, preventing a hot restart-loop).
    - Survives reboot: Start=SERVICE_AUTO_START.
    - Log rotation: 10 MB rotate, online + append (never truncates the journal on restart).
    - Post-install HEALTH VERIFICATION: confirms SERVICE_RUNNING and that the log shows a live
      relay connection within a timeout; FAILS LOUD (non-zero exit) if it cannot.

  RUN FROM AN ELEVATED PowerShell (NSSM service install requires Administrator).

.PARAMETER Verify
  Health-check an existing install only (no changes). Exit 0 = healthy, non-zero = unhealthy.

.PARAMETER Uninstall
  Stop + remove the service (e.g. to hand supervision back to PM2 or migrate).

.EXAMPLE
  # Elevated PowerShell - install/reconfigure + verify:
  .\scripts\ops\install-tower-relay-nssm.ps1

.EXAMPLE
  .\scripts\ops\install-tower-relay-nssm.ps1 -Verify      # health-check only
  .\scripts\ops\install-tower-relay-nssm.ps1 -Uninstall   # remove the service

.NOTES
  RELAY_TOKEN is read from the token file at install time and baked into the service env.
  If the token rotates (it must match the Railway tf-relay RELAY_TOKEN), RE-RUN this script.
  The relay is a SINGLETON - a second connection force-closes the first, so never run both
  this NSSM service AND a PM2 copy.
#>
[CmdletBinding()]
param(
  [string]$ServiceName  = "TFRelayClient",
  [string]$ProjectRoot  = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$NodeExe      = "C:\Program Files\nodejs\node.exe",
  [string]$RelayScript  = "scripts\tower-relay-client.cjs",
  [string]$TokenFile    = "C:\Users\tonio\bin\relay-token.txt",
  [string]$RelayServer  = "wss://tf-relay-production.up.railway.app/__relay",
  [string]$RelayBackend = "http://localhost:4000",
  [string]$LogDir       = "C:\Users\tonio\bin",
  [int]   $VerifyTimeoutSec = 30,
  [switch]$Verify,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

$RelayScriptPath = Join-Path $ProjectRoot $RelayScript
$StdoutLog       = Join-Path $LogDir "tower-relay-client.log"
$StderrLog       = Join-Path $LogDir "tower-relay-client.err.log"

# === locate nssm.exe (project-local first, then PATH) ===
$NssmExe = Join-Path $ProjectRoot "bin\nssm\win64\nssm.exe"
if (-not (Test-Path $NssmExe)) {
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { $NssmExe = $cmd.Source }
  else { Fail "nssm.exe not found at $NssmExe and not on PATH. Run scripts\wave19-nssm-migrate.ps1 first (it downloads NSSM), or install NSSM, then re-run." }
}

function Get-NssmStatus {
  $raw = & $NssmExe status $ServiceName 2>$null
  if (-not $raw) { return "ABSENT" }
  return ($raw | Out-String).Trim()
}

# === HEALTH VERIFICATION (shared by -Verify and post-install) ===
function Test-RelayHealthy {
  param([int]$TimeoutSec)
  $status = Get-NssmStatus
  if ($status -ne "SERVICE_RUNNING") { Warn "Service status is '$status' (expected SERVICE_RUNNING)."; return $false }
  Ok "Service status: SERVICE_RUNNING"

  # Confirm a live relay connection in the log within the timeout. The client logs a
  # connection line on (re)connect; we accept any of the known healthy markers.
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $healthyPattern = "connected|relay (open|ready)|listening|WS open|handshake ok"
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $StdoutLog) {
      $tail = Get-Content $StdoutLog -Tail 40 -ErrorAction SilentlyContinue
      if ($tail -match $healthyPattern) { Ok "Relay log shows a live connection."; return $true }
      if ($tail -match "FATAL|RELAY_SERVER and RELAY_TOKEN") { Warn "Relay log shows a FATAL/missing-env error - check env + token file."; return $false }
    }
    Start-Sleep -Milliseconds 750
  }
  $secs = $TimeoutSec
  Warn "No healthy connection line in the log within $secs s. Service is RUNNING but the relay may not be connected - inspect $StdoutLog / $StderrLog."
  return $false
}

# === -Verify mode: health-check only, no changes ===
if ($Verify) {
  Info "Verify-only mode for service '$ServiceName'."
  if ((Get-NssmStatus) -eq "ABSENT") { Fail "Service '$ServiceName' is NOT installed. Run without -Verify to install it." }
  if (Test-RelayHealthy -TimeoutSec $VerifyTimeoutSec) { Ok "Relay service is HEALTHY."; exit 0 }
  Fail "Relay service is NOT healthy (see warnings above)."
}

# === admin required for install/uninstall ===
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Not elevated. Right-click PowerShell -> 'Run as Administrator', then re-run." }

# === -Uninstall mode ===
if ($Uninstall) {
  Info "Uninstalling service '$ServiceName'."
  if ((Get-NssmStatus) -eq "ABSENT") { Ok "Service '$ServiceName' is already absent - nothing to do."; exit 0 }
  & $NssmExe stop $ServiceName 2>$null | Out-Null
  Start-Sleep -Seconds 2
  & $NssmExe remove $ServiceName confirm 2>$null | Out-Null
  Start-Sleep -Seconds 1
  if ((Get-NssmStatus) -eq "ABSENT") { Ok "Service '$ServiceName' removed." } else { Fail "Service still present after remove - check NSSM / Services.msc." }
  exit 0
}

# === PREFLIGHT (fail-loud before any change) ===
Info "Preflight checks..."
if (-not (Test-Path $NodeExe))         { Fail "node.exe not found at $NodeExe." }
if (-not (Test-Path $RelayScriptPath)) { Fail "Relay script not found at $RelayScriptPath." }
if (-not (Test-Path $TokenFile))       { Fail "Relay token file not found at $TokenFile (the relay needs RELAY_TOKEN; create it with the shared secret matching Railway)." }
if (-not (Test-Path $LogDir))          { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null; Info "Created log dir $LogDir." }
$RelayToken = (Get-Content $TokenFile -Raw -ErrorAction Stop).Trim()
if ([string]::IsNullOrWhiteSpace($RelayToken)) { Fail "Token file $TokenFile is empty." }
Ok "node, nssm, relay script, token file, log dir all present."

# === PM2-dupe guard (known singleton-thrash conflict) ===
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
  $pm2List = & pm2 jlist 2>$null | Out-String
  if ($pm2List -match "tower-relay-client") {
    Fail "A PM2-managed 'tower-relay-client' is present. The relay is a SINGLETON (a 2nd connection force-closes the 1st). Remove the PM2 copy first: 'pm2 delete tower-relay-client; pm2 save' then re-run this script."
  }
}
Ok "No PM2 relay-client duplicate detected."

# === install or reconfigure (idempotent) ===
$exists = (Get-NssmStatus) -ne "ABSENT"
if ($exists) {
  Info "Service exists - reconfiguring in place."
  & $NssmExe stop $ServiceName 2>$null | Out-Null
  Start-Sleep -Seconds 2
} else {
  Info "Installing new service '$ServiceName'."
  & $NssmExe install $ServiceName $NodeExe | Out-Null
}

# Core invocation
& $NssmExe set $ServiceName Application $NodeExe | Out-Null
& $NssmExe set $ServiceName AppParameters "`"$RelayScriptPath`"" | Out-Null
& $NssmExe set $ServiceName AppDirectory $ProjectRoot | Out-Null
& $NssmExe set $ServiceName DisplayName "Trading Forge Relay Client" | Out-Null
& $NssmExe set $ServiceName Description "Tower-Railway relay WebSocket bridge. Independently supervised so it auto-restarts on crash and survives reboot (vacation-autonomy DEBT-5). Singleton." | Out-Null

# Environment (relay client reads RELAY_SERVER/RELAY_TOKEN/RELAY_BACKEND from env; FATAL if missing)
$envBlock = "RELAY_SERVER=$RelayServer`r`nRELAY_TOKEN=$RelayToken`r`nRELAY_BACKEND=$RelayBackend"
& $NssmExe set $ServiceName AppEnvironmentExtra $envBlock | Out-Null

# Supervised recovery - restart on crash, but throttle to prevent a hot restart loop
& $NssmExe set $ServiceName AppExit Default Restart | Out-Null
& $NssmExe set $ServiceName AppRestartDelay 2000 | Out-Null
& $NssmExe set $ServiceName AppThrottle 10000 | Out-Null
& $NssmExe set $ServiceName AppNoConsole 1 | Out-Null

# Survive reboot
& $NssmExe set $ServiceName Start SERVICE_AUTO_START | Out-Null

# Logs - rotate at 10 MB, online, APPEND (disposition 4 = open/append, never truncate the journal)
& $NssmExe set $ServiceName AppStdout $StdoutLog | Out-Null
& $NssmExe set $ServiceName AppStderr $StderrLog | Out-Null
& $NssmExe set $ServiceName AppStdoutCreationDisposition 4 | Out-Null
& $NssmExe set $ServiceName AppStderrCreationDisposition 4 | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmExe set $ServiceName AppRotateOnline 1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 10485760 | Out-Null

Ok "Service configured (recovery + auto-start + log rotation + env)."

# === start + verify ===
Info "Starting service..."
& $NssmExe start $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 2

if (Test-RelayHealthy -TimeoutSec $VerifyTimeoutSec) {
  Ok "Relay service '$ServiceName' INSTALLED, RUNNING, and HEALTHY."
  Info "Verify anytime:  .\scripts\ops\install-tower-relay-nssm.ps1 -Verify"
  Info "Logs:            $StdoutLog  /  $StderrLog"
  Info "Token rotation:  update $TokenFile, then re-run this script."
  exit 0
}
Fail "Service installed but health verification FAILED. Inspect $StdoutLog / $StderrLog. The service is set to auto-restart; fix the underlying issue (env, token, or backend reachability) and re-run -Verify."
