# One-shot cleanup: stop NSSM, kill user-owned orphan node/cmd procs running
# tower-relay-client (leaves SYSTEM-owned NSSM children alone), restart NSSM.
# REQUIRES: admin elevation. Idempotent.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$NSSM = "C:\Users\tonio\bin\nssm\nssm.exe"
$SVC  = "TFRelayClient"

Write-Host "=== Relay singleton cleanup v2 ===" -ForegroundColor Cyan

# Stop NSSM first so its child shuts down cleanly
& $NSSM stop $SVC 2>&1 | Out-String | Write-Host
Start-Sleep -Seconds 3

# Find every cmd.exe and node.exe owned by interactive user 'tonio'
# (NSSM services run as SYSTEM, so this filter spares them automatically).
$me = $env:USERNAME
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='cmd.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $owner = $null
    try { $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction Stop; $owner = $o.User } catch {}
    $cl = $_.CommandLine
    if ($cl -and ($cl -like '*tower-relay-client*' -or $cl -like '*start-tower-relay*')) {
        if ($owner -eq $me -or $null -eq $owner) {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
                Write-Host "  killed pid=$($_.ProcessId) owner=$owner cmd=$($_.Name)" -ForegroundColor Yellow
                $killed++
            } catch { Write-Host "  fail pid=$($_.ProcessId): $($_.Exception.Message)" -ForegroundColor Red }
        }
    }
}
Write-Host "Killed $killed orphan procs" -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Start NSSM as the sole supervisor
& $NSSM start $SVC 2>&1 | Out-String | Write-Host
Start-Sleep -Seconds 5

# Verify
$svc = Get-Service -Name $SVC -ErrorAction SilentlyContinue
$live = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -and $_.CommandLine -like '*tower-relay-client*' } |
         Measure-Object).Count
Write-Host ""
Write-Host "Service: $($svc.Status)   Live relay procs: $live (expected 1)" -ForegroundColor Cyan
if ($svc.Status -eq 'Running' -and $live -eq 1) {
    Write-Host "OK: singleton restored" -ForegroundColor Green
}
