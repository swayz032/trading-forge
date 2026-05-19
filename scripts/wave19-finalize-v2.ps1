# Wave 19 finalize v2 - fix TowerRelayClient env + Python install
# Run from admin PowerShell:
#   .\scripts\wave19-finalize-v2.ps1

$nssm = "C:\Users\tonio\Projects\trading-forge\trading-forge\bin\nssm\win64\nssm.exe"

Write-Host "=== Wave 19 Finalize v2 ===" -ForegroundColor Cyan
Write-Host ""

# [1] Set TowerRelayClient env vars (RELAY_SERVER, RELAY_TOKEN, RELAY_BACKEND)
Write-Host "[1/5] Setting TowerRelayClient env vars..."
& $nssm set TowerRelayClient AppEnvironmentExtra `
    "NODE_ENV=production" `
    "RELAY_SERVER=wss://tf-relay-production.up.railway.app/__relay" `
    "RELAY_TOKEN=oeLdOMZOmgc0KqrVh1GjwgQD0uw4i3AhUVTMJZD2" `
    "RELAY_BACKEND=http://localhost:4000" 2>&1 | Out-String | ForEach-Object { $_.TrimEnd() }
Write-Host "  [OK]" -ForegroundColor Green

# [2] Resume any Paused services and restart all 4
Write-Host ""
Write-Host "[2/5] Restarting all 4 services..."
$svcs = @("TradingForgeAPI", "TradingForgeDiscordBot", "OpenclawGateway", "TowerRelayClient")
foreach ($name in $svcs) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s) {
        Write-Host "  $name (current: $($s.Status))..." -NoNewline
        try {
            # Resume if Paused, otherwise stop+start
            if ($s.Status -eq "Paused") {
                Resume-Service -Name $name -ErrorAction Stop
            } else {
                Stop-Service -Name $name -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
                Start-Service -Name $name -ErrorAction Stop
            }
            Write-Host " [OK]" -ForegroundColor Green
        } catch {
            Write-Host " [FAIL: $($_.Exception.Message.Split([Environment]::NewLine)[0])]" -ForegroundColor Red
        }
    }
}

Start-Sleep -Seconds 8

# [3] Status check
Write-Host ""
Write-Host "[3/5] Service status:" -ForegroundColor Cyan
foreach ($name in $svcs) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host ("  {0,-32} {1}" -f $name, $s.Status) -ForegroundColor $color
    }
}

# [4] API health
Write-Host ""
Write-Host "[4/5] API health:" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 8
    $j = $r.Content | ConvertFrom-Json
    Write-Host "  status=$($j.status) uptime=$([int]$j.uptime)s"
    Write-Host "  db=$($j.database.status) ollama=$($j.ollama.status) python=$($j.python.status)"
    if ($j.python.status -ne "ok") {
        Write-Host "  python error: $($j.python.error)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  DOWN: $_" -ForegroundColor Red
}

# [5] Python install path check
Write-Host ""
Write-Host "[5/5] Python install path check:" -ForegroundColor Cyan
$realPython = @("C:\Python313\python.exe", "C:\Python312\python.exe", "C:\Program Files\Python313\python.exe", "C:\Program Files\Python312\python.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($realPython) {
    Write-Host "  Real Python found at: $realPython" -ForegroundColor Green
    Write-Host "  To fix python EACCES, run:"
    Write-Host "    $nssm set TradingForgeAPI AppEnvironmentExtra `"NODE_ENV=production`" `"PORT=4000`" `"PYTHON_BIN=$realPython`""
    Write-Host "    $nssm restart TradingForgeAPI"
} else {
    Write-Host "  No system-wide Python install found (only WindowsApps stub)." -ForegroundColor Yellow
    Write-Host "  WindowsApps stub doesn't work under SYSTEM service account (EACCES)."
    Write-Host ""
    Write-Host "  RECOMMENDED FIX: Install Python 3.13 system-wide from python.org" -ForegroundColor Yellow
    Write-Host "    1. Download: https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe"
    Write-Host "    2. Run installer, check 'Add Python to PATH' + 'Install for all users'"
    Write-Host "    3. After install, re-run this script to verify"
    Write-Host ""
    Write-Host "  Or run THIS one-liner to download + silent-install in one shot:" -ForegroundColor Cyan
    Write-Host '    $u="https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe"; iwr $u -OutFile "$env:TEMP\py.exe" -UseBasicParsing; & "$env:TEMP\py.exe" /quiet InstallAllUsers=1 PrependPath=1; Start-Sleep 60'
}
