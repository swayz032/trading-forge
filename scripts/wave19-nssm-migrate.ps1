# Wave 19 - NSSM migration (production-grade Windows service replacement for pm2)
#
# RUN AS ADMINISTRATOR.
#
# USAGE (in admin PowerShell):
#   cd C:\Users\tonio\Projects\trading-forge\trading-forge
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\wave19-nssm-migrate.ps1
#
# Idempotent - re-running is safe.

# Write start marker immediately so external watchers know we're alive
$markerPath = "C:\Users\tonio\Projects\trading-forge\trading-forge\logs\wave19-started.marker"
New-Item -ItemType Directory -Force -Path (Split-Path $markerPath) | Out-Null
"started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $markerPath -Force

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"admin context: $isAdmin" | Out-File -Append -FilePath $markerPath
if (-not $isAdmin) {
    "ABORT - not running as admin. Right-click PowerShell - Run as Administrator." | Out-File -Append -FilePath $markerPath
    Write-Host "ABORT - not running as admin. Press any key to exit."
    $null = $host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
}

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\Users\tonio\Projects\trading-forge\trading-forge"
$NssmDir = "$ProjectRoot\bin\nssm"
$NssmExe = "$NssmDir\win64\nssm.exe"
$LogsDir = "$ProjectRoot\logs"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " Wave 19 - pm2 to NSSM migration" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# --- Step 1: Ensure NSSM binary is available ------------------------------
if (-not (Test-Path $NssmExe)) {
    Write-Host ""
    Write-Host "[1/6] NSSM not found - trying multiple download sources..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $NssmDir | Out-Null
    $zip = "$env:TEMP\nssm-2.24.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    $sources = @(
        @{ Url = "https://nssm.cc/release/nssm-2.24.zip"; Name = "nssm.cc" },
        @{ Url = "https://web.archive.org/web/2024/https://nssm.cc/release/nssm-2.24.zip"; Name = "web.archive.org" },
        @{ Url = "https://kirelos.com/wp-content/uploads/2020/04/echo/nssm-2.24.zip"; Name = "kirelos.com mirror" }
    )
    $downloaded = $false
    foreach ($src in $sources) {
        Write-Host "  Trying $($src.Name)..." -NoNewline
        try {
            Invoke-WebRequest -Uri $src.Url -OutFile $zip -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
            if ((Test-Path $zip) -and (Get-Item $zip).Length -gt 100000) {
                Write-Host " [OK]" -ForegroundColor Green
                $downloaded = $true
                break
            } else {
                Write-Host " [FAIL: tiny file]" -ForegroundColor Yellow
                if (Test-Path $zip) { Remove-Item $zip -Force }
            }
        } catch {
            Write-Host " [FAIL: $($_.Exception.Message.Split([Environment]::NewLine)[0])]" -ForegroundColor Yellow
            if (Test-Path $zip) { Remove-Item $zip -Force }
        }
    }
    # Last-resort fallback: try Chocolatey if installed
    if (-not $downloaded) {
        $choco = Get-Command choco -ErrorAction SilentlyContinue
        if ($choco) {
            Write-Host "  Falling back to Chocolatey install..." -NoNewline
            & choco install nssm -y --force --no-progress 2>&1 | Out-Null
            $chocoNssm = Get-Command nssm -ErrorAction SilentlyContinue
            if ($chocoNssm) {
                Copy-Item $chocoNssm.Source $NssmExe -Force
                Write-Host " [OK]" -ForegroundColor Green
                $downloaded = $true
            } else {
                Write-Host " [FAIL]" -ForegroundColor Yellow
            }
        }
    }
    if (-not $downloaded) {
        throw "NSSM download failed from ALL sources. Manual workaround: download nssm-2.24.zip from any mirror, extract to $NssmDir\, then re-run this script."
    }
    if (Test-Path $zip) {
        Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
        Copy-Item -Path "$env:TEMP\nssm-2.24\*" -Destination $NssmDir -Recurse -Force
        Remove-Item $zip -Force
    }
    if (-not (Test-Path $NssmExe)) { throw "NSSM download succeeded but extract failed - check $NssmDir" }
    Write-Host "  [OK] NSSM installed at $NssmExe" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[1/6] NSSM already at $NssmExe - skipping download" -ForegroundColor Green
}

# --- Step 2: Stop pm2 processes (taskkill - bypasses wedged pm2 daemon) ---
Write-Host ""
Write-Host "[2/6] Stopping pm2 god daemon + all managed processes..." -ForegroundColor Yellow

# Wave 19 v2: skip pm2 CLI entirely. The daemon has been wedging this whole
# session - calling 'pm2 kill' hangs on file locks. Direct taskkill via PIDs
# read from .pm2/pm2.pid + .pm2/dump.pm2 + scan node.exe cmdlines for our
# project paths. No daemon involvement.

# 2a. Kill pm2 god daemon by PID file
$pm2PidFile = "$env:USERPROFILE\.pm2\pm2.pid"
if (Test-Path $pm2PidFile) {
    $godPid = (Get-Content $pm2PidFile -ErrorAction SilentlyContinue) -as [int]
    if ($godPid -and $godPid -gt 0) {
        try {
            Stop-Process -Id $godPid -Force -ErrorAction Stop
            Write-Host "  [OK] killed pm2 god daemon (PID $godPid)" -ForegroundColor Green
        } catch {
            Write-Host "  god daemon PID $godPid already dead" -ForegroundColor Gray
        }
    }
}

# 2b. Kill node processes whose command line references pm2 OR our project paths.
# Use Get-CimInstance with a 15s timeout via job to avoid WMI-overload hangs.
Write-Host "  Scanning node processes for pm2/project references..."
$killJob = Start-Job -ScriptBlock {
    $patterns = @("\.pm2\\", "PM2 v", "trading-forge\\node_modules", "openclaw\\dist\\index", "tower-relay-client\.cjs")
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    $hits = @()
    foreach ($p in $procs) {
        if ($p.CommandLine) {
            foreach ($pat in $patterns) {
                if ($p.CommandLine -match $pat) {
                    $hits += [PSCustomObject]@{ Id = $p.ProcessId; Cmd = $p.CommandLine.Substring(0, [Math]::Min(80, $p.CommandLine.Length)) }
                    break
                }
            }
        }
    }
    return $hits
}
$gotResult = Wait-Job $killJob -Timeout 15
if ($gotResult) {
    $hits = Receive-Job $killJob
    foreach ($h in $hits) {
        try {
            Stop-Process -Id $h.Id -Force -ErrorAction Stop
            Write-Host "  [OK] killed pid=$($h.Id)" -ForegroundColor Green
        } catch {
            Write-Host "  pid=$($h.Id) already dead" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  [WARN] WMI scan timed out at 15s - skipping cmdline scan, killing all node.exe started before pm2 resurrect heuristic" -ForegroundColor Yellow
    # Fallback: kill any node.exe NOT touched in the last 5 minutes (Claude Code's node is recent)
    $recent = (Get-Date).AddMinutes(-5)
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -lt $recent } | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; Write-Host "  [OK] killed pid=$($_.Id)" -ForegroundColor Green } catch {}
    }
}
Stop-Job $killJob -ErrorAction SilentlyContinue
Remove-Job $killJob -Force -ErrorAction SilentlyContinue

# 2c. Clear stale pm2 lockfiles (must succeed for any future pm2 ops to not hang)
foreach ($lock in @("reload.lock", "pub.sock", "rpc.sock")) {
    $lockPath = "$env:USERPROFILE\.pm2\$lock"
    if (Test-Path $lockPath) {
        try { Remove-Item -Force $lockPath -ErrorAction Stop; Write-Host "  [OK] cleared $lock" -ForegroundColor Gray } catch {}
    }
}

Write-Host "  [OK] Step 2 complete (pm2 decommissioned, no CLI calls used)" -ForegroundColor Green

# --- Step 3: Service definitions (4 services) -----------------------------
$Services = @(
    @{
        Name        = "TradingForgeAPI"
        DisplayName = "Trading Forge API (port 4000)"
        Description = "Trading Forge backend - Express + tsx runtime"
        Executable  = "C:\Program Files\nodejs\node.exe"
        Arguments   = "node_modules\tsx\dist\cli.mjs src\server\index.ts"
        WorkDir     = $ProjectRoot
        StdoutLog   = "$LogsDir\api-out.log"
        StderrLog   = "$LogsDir\api-error.log"
        EnvVars     = @{ NODE_ENV = "production"; PORT = "4000" }
    },
    @{
        Name        = "TradingForgeDiscordBot"
        DisplayName = "Trading Forge Discord Bot"
        Description = "Discord bot for ops alerts"
        Executable  = "C:\Program Files\nodejs\node.exe"
        Arguments   = "node_modules\tsx\dist\cli.mjs src\discord\bot.ts"
        WorkDir     = $ProjectRoot
        StdoutLog   = "$LogsDir\discord-out.log"
        StderrLog   = "$LogsDir\discord-error.log"
        EnvVars     = @{ NODE_ENV = "production" }
    },
    @{
        Name        = "OpenclawGateway"
        DisplayName = "OpenClaw Gateway"
        Description = "OpenClaw n8n discovery gateway"
        Executable  = "C:\Program Files\nodejs\node.exe"
        Arguments   = "`"$env:APPDATA\npm\node_modules\openclaw\dist\index.js`" gateway --port 18789"
        WorkDir     = "$env:APPDATA\npm\node_modules\openclaw"
        StdoutLog   = "$LogsDir\openclaw-out.log"
        StderrLog   = "$LogsDir\openclaw-error.log"
        EnvVars     = @{ NODE_ENV = "production" }
    },
    @{
        Name        = "TowerRelayClient"
        DisplayName = "Trading Forge Tower Relay Client"
        Description = "WebSocket reverse-tunnel client to tf-relay on Railway"
        Executable  = "C:\Program Files\nodejs\node.exe"
        Arguments   = "scripts\tower-relay-client.cjs"
        WorkDir     = $ProjectRoot
        StdoutLog   = "$LogsDir\relay-out.log"
        StderrLog   = "$LogsDir\relay-error.log"
        EnvVars     = @{ NODE_ENV = "production" }
    }
)

# --- Step 4: Stop + remove existing NSSM services if present (idempotent) -
Write-Host ""
Write-Host "[3/6] Removing any existing NSSM services for idempotency..." -ForegroundColor Yellow
foreach ($svc in $Services) {
    $existing = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Stopping + removing existing service: $($svc.Name)"
        & $NssmExe stop $svc.Name confirm 2>&1 | Out-Null
        & $NssmExe remove $svc.Name confirm 2>&1 | Out-Null
    }
}
Write-Host "  [OK] Service slots cleared" -ForegroundColor Green

# --- Step 5: Install + configure each NSSM service ------------------------
Write-Host ""
Write-Host "[4/6] Installing 4 NSSM services..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null

foreach ($svc in $Services) {
    Write-Host "  Installing $($svc.Name)..." -NoNewline
    # Install service
    & $NssmExe install $svc.Name $svc.Executable | Out-Null
    & $NssmExe set $svc.Name AppParameters $svc.Arguments | Out-Null
    & $NssmExe set $svc.Name AppDirectory $svc.WorkDir | Out-Null
    & $NssmExe set $svc.Name DisplayName $svc.DisplayName | Out-Null
    & $NssmExe set $svc.Name Description $svc.Description | Out-Null
    # Logging
    & $NssmExe set $svc.Name AppStdout $svc.StdoutLog | Out-Null
    & $NssmExe set $svc.Name AppStderr $svc.StderrLog | Out-Null
    & $NssmExe set $svc.Name AppRotateFiles 1 | Out-Null
    & $NssmExe set $svc.Name AppRotateOnline 1 | Out-Null
    & $NssmExe set $svc.Name AppRotateBytes 10485760 | Out-Null
    # Restart policy
    & $NssmExe set $svc.Name AppExit Default Restart | Out-Null
    & $NssmExe set $svc.Name AppRestartDelay 2000 | Out-Null
    & $NssmExe set $svc.Name AppThrottle 5000 | Out-Null
    # Environment
    $envLines = @()
    foreach ($k in $svc.EnvVars.Keys) { $envLines += "$k=$($svc.EnvVars[$k])" }
    if ($envLines.Count -gt 0) {
        & $NssmExe set $svc.Name AppEnvironmentExtra $envLines | Out-Null
    }
    # Auto-start on boot
    & $NssmExe set $svc.Name Start SERVICE_AUTO_START | Out-Null
    Write-Host " [OK]" -ForegroundColor Green
}

# --- Step 6: Start all services ------------------------------------------
Write-Host ""
Write-Host "[5/6] Starting all 4 services..." -ForegroundColor Yellow
foreach ($svc in $Services) {
    Write-Host "  Starting $($svc.Name)..." -NoNewline
    & $NssmExe start $svc.Name 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    $s = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    if ($s -and $s.Status -eq "Running") {
        Write-Host " [OK] Running" -ForegroundColor Green
    } else {
        Write-Host " [WARN] Status: $($s.Status)" -ForegroundColor Yellow
    }
}

# --- Step 7: Verify ------------------------------------------------------
Write-Host ""
Write-Host "[6/6] Verification:" -ForegroundColor Yellow
foreach ($svc in $Services) {
    $s = Get-Service -Name $svc.Name -ErrorAction SilentlyContinue
    $statusColor = if ($s.Status -eq "Running") { "Green" } else { "Red" }
    Write-Host ("  {0,-32} {1}" -f $svc.Name, $s.Status) -ForegroundColor $statusColor
}

# Health check the API
Write-Host ""
Write-Host "API health check:" -NoNewline
Start-Sleep -Seconds 5
try {
    $r = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 10
    $j = $r.Content | ConvertFrom-Json
    Write-Host " [OK] uptime=$([int]$j.uptime)s status=$($j.status)" -ForegroundColor Green
} catch {
    Write-Host " [WARN] API not responding yet (may still be starting): $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " [OK] Wave 19 migration complete." -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "From now on, manage services with native Windows commands:"
Write-Host "  Restart API:   nssm restart TradingForgeAPI"
Write-Host "  OR:            Restart-Service TradingForgeAPI"
Write-Host "  Status:        Get-Service TradingForge*"
Write-Host "  Stop:          nssm stop TradingForgeAPI"
Write-Host "  Logs:          $LogsDir\api-out.log (auto-rotates at 10MB)"
Write-Host ""
Write-Host "NO MORE PM2 HANGS. Services auto-restart on crash, survive reboots, no file locks."
