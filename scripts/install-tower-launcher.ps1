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

Write-Host "1/3  Pointing TradingForgeAPI at the self-healing launcher..." -ForegroundColor Cyan
& $nssm set TradingForgeAPI AppParameters $launcher | Out-Null

Write-Host "2/3  Restarting the service..." -ForegroundColor Cyan
Restart-Service -Name TradingForgeAPI
Start-Sleep -Seconds 10

Write-Host "3/3  Verifying..." -ForegroundColor Cyan
$status = (Get-Service TradingForgeAPI).Status
Write-Host "     service status: $status"
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4000/api/health" -TimeoutSec 8
  Write-Host "     health HTTP $($r.StatusCode) -- DONE. Self-healing launcher active; tower up." -ForegroundColor Green
} catch {
  Write-Host "     tower still booting (first self-heal npm install can take a minute). Re-check http://localhost:4000/api/health shortly." -ForegroundColor Yellow
}
