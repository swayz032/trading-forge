# Wave 19 finalize - completes NSSM migration tasks the main script aborted on
# Run from your existing admin PowerShell:
#   .\scripts\wave19-finalize.ps1

$nssm = "C:\Users\tonio\Projects\trading-forge\trading-forge\bin\nssm\win64\nssm.exe"
$pythonPath = "C:\Users\tonio\AppData\Local\Microsoft\WindowsApps\python.exe"
if (-not (Test-Path $pythonPath)) {
    # Fallback - find any python.exe via where.exe
    $found = (where.exe python 2>&1 | Select-Object -First 1)
    if ($found -and (Test-Path $found)) { $pythonPath = $found }
}

Write-Host "=== Wave 19 Finalize ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/4] Setting PYTHON_BIN env var on TradingForgeAPI service..."
Write-Host "  Using python at: $pythonPath"
& $nssm set TradingForgeAPI AppEnvironmentExtra "NODE_ENV=production" "PORT=4000" "PYTHON_BIN=$pythonPath" 2>&1 | Out-String | ForEach-Object { $_.TrimEnd() }
Write-Host "  [OK]" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Configure all 4 services to run as your user account (needed for WindowsApps access)..."
$svcs = @("TradingForgeAPI", "TradingForgeDiscordBot", "OpenclawGateway", "TowerRelayClient")
# Run as LocalSystem is fine for most; only API needs python which requires user context
# Skip user-credential config for now - use LocalSystem default and rely on PYTHON_BIN env var

Write-Host ""
Write-Host "[3/4] Restarting TradingForgeAPI to load Wave 19 python-runner patch..."
& $nssm restart TradingForgeAPI 2>&1 | Out-String | ForEach-Object { $_.TrimEnd() }
Start-Sleep -Seconds 6

Write-Host ""
Write-Host "[3.5/4] Starting any non-Running services..."
foreach ($name in $svcs) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s -and $s.Status -ne "Running") {
        Write-Host "  Starting $name..." -NoNewline
        try {
            Start-Service -Name $name -ErrorAction Stop
            Write-Host " [OK]" -ForegroundColor Green
        } catch {
            Write-Host " [FAIL: $($_.Exception.Message.Split([Environment]::NewLine)[0])]" -ForegroundColor Red
        }
    }
}

Start-Sleep -Seconds 8

Write-Host ""
Write-Host "[4/4] Final state ===" -ForegroundColor Cyan
foreach ($name in $svcs) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host ("  {0,-32} {1}" -f $name, $s.Status) -ForegroundColor $color
    } else {
        Write-Host ("  {0,-32} NOT INSTALLED" -f $name) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "API Health:" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 10
    $j = $r.Content | ConvertFrom-Json
    $statusColor = if ($j.status -eq "ok") { "Green" } else { "Yellow" }
    Write-Host "  status=$($j.status) uptime=$([int]$j.uptime)s" -ForegroundColor $statusColor
    Write-Host "  db=$($j.database.status) ollama=$($j.ollama.status) python=$($j.python.status)" -ForegroundColor $statusColor
    if ($j.python.status -ne "ok") { Write-Host "  python error: $($j.python.error)" -ForegroundColor Red }
} catch {
    Write-Host "  DOWN: $_" -ForegroundColor Red
}
