# Wave 19 finalize v3 - install real Python + fix Openclaw Paused
# Run from admin PowerShell:
#   .\scripts\wave19-finalize-v3.ps1

$ErrorActionPreference = "Continue"
$nssm = "C:\Users\tonio\Projects\trading-forge\trading-forge\bin\nssm\win64\nssm.exe"

Write-Host "=== Wave 19 Finalize v3 ===" -ForegroundColor Cyan
Write-Host ""

# [1] Fix OpenclawGateway stuck in Paused state
Write-Host "[1/6] Fixing OpenclawGateway Paused state (force kill + restart)..."
# Find its node PID via NSSM
$openclawPid = & $nssm processes OpenclawGateway 2>&1 | Select-String -Pattern "\d+" | Select-Object -First 1 | ForEach-Object { $_.Matches[0].Value }
if ($openclawPid) {
    Write-Host "  Force-killing OpenclawGateway worker PID $openclawPid..."
    Stop-Process -Id $openclawPid -Force -ErrorAction SilentlyContinue
}
# Stop service hard
& $nssm stop OpenclawGateway 2>&1 | Out-Null
Start-Sleep -Seconds 3
& $nssm start OpenclawGateway 2>&1 | Out-Null
Start-Sleep -Seconds 5
$openclaw = Get-Service OpenclawGateway -ErrorAction SilentlyContinue
Write-Host "  OpenclawGateway: $($openclaw.Status)" -ForegroundColor $(if ($openclaw.Status -eq "Running") {"Green"} else {"Yellow"})

# [2] Check for real Python install
Write-Host ""
Write-Host "[2/6] Checking for system-wide Python..."
$realPython = @(
    "C:\Program Files\Python313\python.exe",
    "C:\Program Files\Python312\python.exe",
    "C:\Python313\python.exe",
    "C:\Python312\python.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $realPython) {
    Write-Host "  No system-wide Python found. Downloading Python 3.13 installer..." -ForegroundColor Yellow
    $installer = "$env:TEMP\python-3.13-installer.exe"
    if (Test-Path $installer) { Remove-Item $installer -Force }
    $urls = @(
        "https://www.python.org/ftp/python/3.13.0/python-3.13.0-amd64.exe",
        "https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe"
    )
    foreach ($u in $urls) {
        Write-Host "    Trying $u..." -NoNewline
        try {
            Invoke-WebRequest -Uri $u -OutFile $installer -UseBasicParsing -TimeoutSec 60 -ErrorAction Stop
            if ((Test-Path $installer) -and (Get-Item $installer).Length -gt 10000000) {
                Write-Host " [OK $((Get-Item $installer).Length / 1MB -as [int])MB]" -ForegroundColor Green
                break
            }
        } catch {
            Write-Host " [FAIL: $($_.Exception.Message.Split([Environment]::NewLine)[0])]" -ForegroundColor Red
            if (Test-Path $installer) { Remove-Item $installer -Force }
        }
    }
    if (-not (Test-Path $installer)) {
        Write-Host "  [FATAL] Python installer download failed from all sources" -ForegroundColor Red
        Write-Host "  Manual fix: download from python.org and re-run this script"
        exit 1
    }
    Write-Host "  Installing Python silently (this takes 1-2 minutes)..."
    # Silent install for all users + add to PATH
    $proc = Start-Process -FilePath $installer -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1", "Include_test=0", "Include_doc=0", "Include_launcher=1" -Wait -PassThru
    Write-Host "  Installer exit code: $($proc.ExitCode)"
    Start-Sleep -Seconds 3
    # Re-scan for python
    $realPython = @(
        "C:\Program Files\Python313\python.exe",
        "C:\Program Files\Python312\python.exe",
        "C:\Python313\python.exe",
        "C:\Python312\python.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($realPython) {
        Write-Host "  [OK] Python installed at: $realPython" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Installer ran but python.exe not found at expected paths" -ForegroundColor Red
        Write-Host "  Run 'where.exe python' to locate it, then update PYTHON_BIN env var manually"
        exit 1
    }
} else {
    Write-Host "  [OK] Found existing Python: $realPython" -ForegroundColor Green
}

# [3] Install Python dependencies the project needs
Write-Host ""
Write-Host "[3/6] Installing Python dependencies (vectorbt, polars, etc.)..."
Set-Location "C:\Users\tonio\Projects\trading-forge\trading-forge"
if (Test-Path "pyproject.toml") {
    & $realPython -m pip install --upgrade pip --quiet 2>&1 | Out-Null
    & $realPython -m pip install -e . --quiet 2>&1 | Tee-Object -FilePath "$env:TEMP\pip-install.log" | Select-Object -Last 5
    Write-Host "  [OK] Dependencies installed (full log: $env:TEMP\pip-install.log)" -ForegroundColor Green
} else {
    Write-Host "  No pyproject.toml found - skipping deps. May need manual pip install." -ForegroundColor Yellow
}

# [4] Update TradingForgeAPI env to use real Python
Write-Host ""
Write-Host "[4/6] Setting PYTHON_BIN on TradingForgeAPI..."
& $nssm set TradingForgeAPI AppEnvironmentExtra "NODE_ENV=production" "PORT=4000" "PYTHON_BIN=$realPython" 2>&1 | Out-String | ForEach-Object { $_.TrimEnd() }
Write-Host "  [OK]" -ForegroundColor Green

# [5] Restart TradingForgeAPI
Write-Host ""
Write-Host "[5/6] Restarting TradingForgeAPI..."
& $nssm restart TradingForgeAPI 2>&1 | Out-Null
Start-Sleep -Seconds 10

# [6] Final verification
Write-Host ""
Write-Host "[6/6] Final state ===" -ForegroundColor Cyan
$svcs = @("TradingForgeAPI", "TradingForgeDiscordBot", "OpenclawGateway", "TowerRelayClient")
foreach ($name in $svcs) {
    $s = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($s) {
        $color = if ($s.Status -eq "Running") { "Green" } else { "Red" }
        Write-Host ("  {0,-32} {1}" -f $name, $s.Status) -ForegroundColor $color
    }
}

Write-Host ""
Write-Host "API Health:" -ForegroundColor Cyan
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 15
    $j = $r.Content | ConvertFrom-Json
    $color = if ($j.status -eq "ok") { "Green" } else { "Yellow" }
    Write-Host "  status=$($j.status) uptime=$([int]$j.uptime)s" -ForegroundColor $color
    Write-Host "  db=$($j.database.status) ollama=$($j.ollama.status) python=$($j.python.status)" -ForegroundColor $color
    if ($j.python.status -ne "ok") {
        Write-Host "  python error: $($j.python.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "  DOWN: $_" -ForegroundColor Red
}
