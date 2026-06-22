# Remove duplicate legacy "TowerRelayClient" service that's competing with the
# new Wave 26 Pass H-2 "TFRelayClient". Both supervisors spawning the same
# relay client = singleton thrash. Leave TFRelayClient as the sole supervisor.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$NSSM = "C:\Users\tonio\bin\nssm\nssm.exe"
$LOG  = "C:\Users\tonio\bin\tf-logs\relay-dedupe.log"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue

function L($msg) { "[{0}] {1}" -f (Get-Date -Format o), $msg | Tee-Object -FilePath $LOG -Append | Write-Host }

L "=== dedupe start ==="

# Stop and remove the OLD service
L "stopping TowerRelayClient (legacy)..."
sc.exe stop TowerRelayClient 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 3
L "deleting TowerRelayClient service..."
sc.exe delete TowerRelayClient 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 2

# Kill any stray relay-client node + cmd procs to clear the field
L "killing stray relay procs..."
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cmd.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and ($_.CommandLine -like '*tower-relay-client*' -or $_.CommandLine -like '*start-tower-relay*')
} | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; L "  killed pid=$($_.ProcessId)" } catch { L "  fail pid=$($_.ProcessId): $($_.Exception.Message)" }
}
Start-Sleep -Seconds 4

# Ensure TradingForgeAPI is running (we may have stopped it during nuclear reset)
L "ensuring TradingForgeAPI running..."
sc.exe start TradingForgeAPI 2>&1 | ForEach-Object { L $_ }

# Ensure TFRelayClient is running as the sole supervisor
L "ensuring TFRelayClient running..."
sc.exe start TFRelayClient 2>&1 | ForEach-Object { L $_ }
Start-Sleep -Seconds 8

# Verify
$tf  = Get-Service TradingForgeAPI    -ErrorAction SilentlyContinue
$rc  = Get-Service TFRelayClient      -ErrorAction SilentlyContinue
$old = Get-Service TowerRelayClient   -ErrorAction SilentlyContinue
$nodeRelay = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -and $_.CommandLine -like '*tower-relay-client*' } |
              Measure-Object).Count

L "FINAL: TradingForgeAPI=$($tf.Status) TFRelayClient=$($rc.Status) TowerRelayClient_exists=$($null -ne $old) live_relay_procs=$nodeRelay"
L "=== dedupe done ==="
