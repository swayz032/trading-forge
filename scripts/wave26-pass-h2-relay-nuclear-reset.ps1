# Nuclear singleton reset: stop both NSSMs (TradingForgeAPI + TFRelayClient),
# kill ALL node + cmd processes (orphans + service children), wait for clean
# state, restart NSSMs. ~20s TF API downtime. Closes orphan loops definitively.
#
# Logs every step to C:\Users\tonio\bin\tf-logs\relay-nuclear-reset.log so we
# can read results from outside the elevated window.
#
# REQUIRES: admin elevation.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$NSSM = "C:\Users\tonio\bin\nssm\nssm.exe"
$LOG  = "C:\Users\tonio\bin\tf-logs\relay-nuclear-reset.log"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue

function L($msg) { "[{0}] {1}" -f (Get-Date -Format o), $msg | Tee-Object -FilePath $LOG -Append | Write-Host }

L "=== nuclear reset start ==="

L "stopping NSSM services..."
& $NSSM stop TFRelayClient   2>&1 | Out-String | ForEach-Object { L $_ }
& $NSSM stop TradingForgeAPI 2>&1 | Out-String | ForEach-Object { L $_ }
Start-Sleep -Seconds 4

L "taskkill all cmd.exe..."
taskkill /F /IM cmd.exe 2>&1 | Out-String | ForEach-Object { L $_ }

L "taskkill all node.exe..."
taskkill /F /IM node.exe 2>&1 | Out-String | ForEach-Object { L $_ }

Start-Sleep -Seconds 6

$nodeAfter = (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count
$cmdAfter  = (Get-Process cmd  -ErrorAction SilentlyContinue | Measure-Object).Count
L "after-kill counts: node=$nodeAfter cmd=$cmdAfter (expect 0/0)"

L "starting NSSM services..."
& $NSSM start TradingForgeAPI 2>&1 | Out-String | ForEach-Object { L $_ }
& $NSSM start TFRelayClient   2>&1 | Out-String | ForEach-Object { L $_ }

Start-Sleep -Seconds 8

$svcTF  = Get-Service TradingForgeAPI -ErrorAction SilentlyContinue
$svcRC  = Get-Service TFRelayClient   -ErrorAction SilentlyContinue
$nodeFin = (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count
L "final: TradingForgeAPI=$($svcTF.Status) TFRelayClient=$($svcRC.Status) node_count=$nodeFin"

L "=== nuclear reset done ==="
