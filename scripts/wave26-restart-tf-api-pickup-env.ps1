#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$LOG = "C:\Users\tonio\bin\tf-logs\tf-api-env-restart.log"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue
function L($m) { "[{0}] {1}" -f (Get-Date -Format o), $m | Tee-Object -FilePath $LOG -Append | Write-Host }

L "stopping TradingForgeAPI to pick up new .env..."
sc.exe stop TradingForgeAPI 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 4
L "starting TradingForgeAPI..."
sc.exe start TradingForgeAPI 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 8
$svc = Get-Service TradingForgeAPI -ErrorAction SilentlyContinue
L "final: $($svc.Status)"
