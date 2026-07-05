# =============================================================================
# Wire the self-healing boot launcher into the TradingForgeAPI service.
#
# RUN ONCE, AS ADMINISTRATOR:
#   Right-click this file  >  "Run with PowerShell"  (accept the elevation prompt)
#   -- or from an elevated PowerShell:  .\scripts\install-tower-launcher.ps1
#
# After this, every tower restart auto-heals a missing/incomplete node_modules
# (runs npm install) before booting, so a restart can never crash into "Paused".
#
# To REVERT to the old direct-tsx launch, run elevated:
#   nssm set TradingForgeAPI AppParameters "<repo>\node_modules\tsx\dist\cli.mjs <repo>\src\server\index.ts"
#   Restart-Service TradingForgeAPI
# =============================================================================
$ErrorActionPreference = "Stop"
$nssm     = "C:\Users\tonio\bin\nssm\nssm.exe"
$launcher = "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\tower-boot.mjs"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "NOT ELEVATED. Right-click this file, Run with PowerShell as admin (or use an admin PowerShell)." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $nssm))     { Write-Host "nssm.exe not found at $nssm" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $launcher)) { Write-Host "launcher not found at $launcher" -ForegroundColor Red; exit 1 }

# deepscan17 G-1 (2026-07-05): repo root is the launcher's grandparent dir
# (<repo>\scripts\tower-boot.mjs) — used only to find the NSSM stdout log for
# the post-restart verification step below (wave19-nssm-migrate.ps1 wired
# StdoutLog to <repo>\logs\api-out.log; that convention is unchanged here).
$repoRoot = Split-Path -Parent (Split-Path -Parent $launcher)
$stdoutLog = Join-Path $repoRoot "logs\api-out.log"

Write-Host "1/3  Pointing TradingForgeAPI at the self-healing launcher..." -ForegroundColor Cyan
& $nssm set TradingForgeAPI AppParameters $launcher | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "     nssm set exited $LASTEXITCODE -- ABORTING before restart (service left untouched)." -ForegroundColor Red
  exit 1
}

# Read back what NSSM actually stored — `nssm set` can silently no-op on a
# wrong service name or a registry permission issue; a swallowed exit code
# there previously meant this script could restart the service on the OLD
# tsx-direct config and still print a false "DONE" once /api/health returned
# 200 (the old config serves health fine too — that's the whole silent-misconfig
# risk this launcher exists to close).
$readback = (& $nssm get TradingForgeAPI AppParameters 2>&1 | Out-String).Trim()
if ($readback -ne $launcher) {
  Write-Host "     VERIFY FAILED: AppParameters reads back as [$readback], expected [$launcher]." -ForegroundColor Red
  Write-Host "     ABORTING before restart -- service left on its previous config." -ForegroundColor Red
  exit 1
}
Write-Host "     confirmed: AppParameters = $readback" -ForegroundColor DarkGray

Write-Host "2/3  Restarting the service..." -ForegroundColor Cyan
Restart-Service -Name TradingForgeAPI
Start-Sleep -Seconds 10

Write-Host "3/3  Verifying..." -ForegroundColor Cyan
$status = (Get-Service TradingForgeAPI).Status
Write-Host "     service status: $status"
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4000/api/health" -TimeoutSec 8
  Write-Host "     health HTTP $($r.StatusCode)" -ForegroundColor Green
} catch {
  Write-Host "     tower still booting (first self-heal npm install can take a minute). Re-check http://localhost:4000/api/health shortly." -ForegroundColor Yellow
}

# Config readback proves NSSM is *configured* to use the launcher; it doesn't
# prove the running process actually took that path (a stale/cached process
# could still be alive). tower-boot.mjs's log() helper always prints at least
# one "[tower-boot ...]" line before handing off to tsx, so grep the NSSM
# stdout log for it as live confirmation the wrapper genuinely executed.
if (Test-Path $stdoutLog) {
  $bootLines = Get-Content $stdoutLog -Tail 40 | Select-String -Pattern "\[tower-boot "
  if ($bootLines) {
    Write-Host "     confirmed: tower-boot.mjs log lines found in $stdoutLog -- DONE. Self-healing launcher is genuinely active." -ForegroundColor Green
  } else {
    Write-Host "     WARNING: AppParameters is correct but no '[tower-boot ' lines found in the last 40 lines of $stdoutLog yet." -ForegroundColor Yellow
    Write-Host "     This can just mean the log hasn't flushed yet -- re-check the log in a minute before assuming failure." -ForegroundColor Yellow
  }
} else {
  Write-Host "     NOTE: could not find $stdoutLog to confirm the wrapper actually ran (config readback above is still correct)." -ForegroundColor Yellow
}
