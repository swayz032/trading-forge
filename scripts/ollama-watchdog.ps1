# ollama-watchdog.ps1 — autonomous Ollama supervisor for the TF tower.
#
# WHY: Ollama is a plain user-level tray app with NO supervisor (unlike TF API/Discord
# under NSSM). Two documented incident classes leave extraction dead until a human acts:
#   (a) 2026-06-29 orphaned llama-server.exe after a TDR/freeze — model shows "resident"
#       in /api/ps but calls hang; server.log: "cudaMalloc failed" / "TerminateProcess:
#       Access is denied". VRAM held by a wedged child.
#   (b) process death — tray app killed by a freeze/logoff; nothing restarts it.
# This watchdog detects both, auto-recovers (kill orphans -> relaunch -> patient warm),
# and doubles as a warm-keeper (re-pins the model with keep_alive=-1 after any unload).
#
# DESIGN RULES (tf-debugging A1 / autonomous-readiness):
#   - Busy != wedged: on probe timeout, check GPU utilization; >15% => likely a real
#     extraction grinding -> do NOT count a failure, never kill a working inference.
#   - 2 consecutive failed cycles (~10 min apart) required before any kill action.
#   - Rate limit: max 3 kill-cycles per 24h, then alert-only (mirrors dead-man <=3/24h).
#   - Kill switch: create file C:\Users\tonio\bin\ollama-watchdog.DISABLED to disable.
#   - Alerts via local Discord sidecar (POST :4100/alert/alerts) with family-grade text;
#     falls back to log-only. Log: C:\Users\tonio\bin\ollama-watchdog.log
#   - Scheduled task: TF-OllamaWatchdog, every 5 min, user session (tray app = user-level).
#   - -DryRun: run all checks, take no kill/start actions.
#
# PS 5.1 compatible. ASCII only.

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ----- config -----
$BinDir      = "C:\Users\tonio\bin"
$LogPath     = Join-Path $BinDir "ollama-watchdog.log"
$StatePath   = Join-Path $BinDir "ollama-watchdog-state.json"
$DisablePath = Join-Path $BinDir "ollama-watchdog.DISABLED"
$OllamaExe   = "C:\Users\tonio\AppData\Local\Programs\Ollama\ollama app.exe"
$BaseUrl     = "http://localhost:11434"
$AlertUrl    = "http://localhost:4100/alert/alerts"
$Model       = [Environment]::GetEnvironmentVariable("TRANSCRIPT_EXTRACTOR_LOCAL_MODEL", "User")
if (-not $Model) { $Model = "gemma4:e4b-it-qat" }
$ProbeTimeoutResidentSec = 120   # model resident -> probe should be fast; allow queue depth
$ProbeTimeoutColdSec     = 300   # cold load of e4b -> patient warm, never abort early
$MaxActionsPer24h        = 3
$FailuresBeforeAction    = 2
$BusyGpuUtilPct          = 15

if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Force $BinDir | Out-Null }

function Log([string]$msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $LogPath -Value $line -Encoding ascii
    Write-Host $line
}

function Trim-Log {
    try {
        if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 2MB)) {
            $tail = Get-Content $LogPath -Tail 2000
            Set-Content -Path $LogPath -Value $tail -Encoding ascii
        }
    } catch {}
}

$EnvFile = "C:\Users\tonio\Projects\trading-forge\trading-forge\.env"
function Get-EnvValue([string]$key) {
    try {
        $line = Select-String -Path $EnvFile -Pattern ("^{0}=" -f $key) | Select-Object -First 1
        if ($line) { return ($line.Line -replace ("^{0}=" -f $key), "").Trim('"').Trim() }
    } catch {}
    return $null
}

function Send-Alert([string]$title, [string]$message, [string]$severity) {
    Log ("ALERT [{0}] {1} - {2}" -f $severity, $title, $message)
    # Primary: Discord alert sidecar (:4100) — requires Bearer API_KEY (alert-service.ts pattern)
    try {
        $headers = @{ }
        $apiKey = Get-EnvValue "API_KEY"
        if ($apiKey) { $headers["Authorization"] = "Bearer $apiKey" }
        $body = @{ title = $title; message = $message; severity = $severity } | ConvertTo-Json
        Invoke-RestMethod -Uri $AlertUrl -Method Post -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 4 | Out-Null
        return
    } catch {
        Log "ALERT sidecar failed ($($_.Exception.Message)); trying direct webhook."
    }
    # Fallback: raw Discord webhook
    try {
        $hook = Get-EnvValue "DISCORD_WEBHOOK_URL"
        if ($hook) {
            $body = @{ content = ("**[{0}] {1}**`n{2}" -f $severity.ToUpper(), $title, $message) } | ConvertTo-Json
            Invoke-RestMethod -Uri $hook -Method Post -ContentType "application/json" -Body $body -TimeoutSec 5 | Out-Null
            return
        }
    } catch {}
    Log "ALERT delivery failed on all paths (log-only)."
}

function Get-State {
    if (Test-Path $StatePath) {
        try { return (Get-Content $StatePath -Raw | ConvertFrom-Json) } catch {}
    }
    return New-Object PSObject -Property @{ consecutiveFailures = 0; actions = @() }
}

function Save-State($state) {
    $state | ConvertTo-Json | Set-Content -Path $StatePath -Encoding ascii
}

function Get-GpuUtil {
    try {
        $out = & "$env:windir\System32\nvidia-smi.exe" --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>$null
        return [int](($out | Select-Object -First 1).Trim())
    } catch { return -1 }
}

function Get-VramUsedMb {
    try {
        $out = & "$env:windir\System32\nvidia-smi.exe" --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
        return [int](($out | Select-Object -First 1).Trim())
    } catch { return -1 }
}

function Test-OllamaHttp {
    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/tags" -TimeoutSec 5 | Out-Null
        return $true
    } catch { return $false }
}

function Get-ResidentModels {
    # PS 5.1 gotcha: bare `return @()` unrolls to $null at the call site — the comma
    # operator preserves the (possibly empty) array so callers can tell "empty" from "failed".
    try {
        $ps = Invoke-RestMethod -Uri "$BaseUrl/api/ps" -TimeoutSec 5
        if ($ps.models) { return ,@($ps.models) }
        return ,@()
    } catch { return $null }  # null = endpoint itself failed
}

function Invoke-Probe([int]$timeoutSec) {
    # 1-token chat probe; keep_alive -1 re-pins the model (warm-keeper side effect).
    $body = @{
        model      = $Model
        messages   = @(@{ role = "user"; content = "ping" })
        stream     = $false
        keep_alive = -1
        options    = @{ num_predict = 1 }
    } | ConvertTo-Json -Depth 5
    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/chat" -Method Post -ContentType "application/json" -Body $body -TimeoutSec $timeoutSec | Out-Null
        return $true
    } catch { return $false }
}

function Restart-Ollama($state) {
    # Rate limit check
    $now = Get-Date
    $recent = @($state.actions | Where-Object { $_ -and (([datetime]$_) -gt $now.AddHours(-24)) })
    if ($recent.Count -ge $MaxActionsPer24h) {
        Send-Alert "Ollama watchdog: rate-limited" ("Wedge confirmed but {0} kill-cycles already ran in 24h. MANUAL ACTION NEEDED: close GPU-heavy apps, then run scripts/ollama-watchdog.ps1 by hand, or reboot the tower. Extraction is DOWN until then." -f $recent.Count) "critical"
        return $false
    }
    if ($DryRun) { Log "DRYRUN: would kill *llama*/*ollama*, verify VRAM, relaunch, warm."; return $true }

    $vramBefore = Get-VramUsedMb
    Log ("ACTION: kill-cycle starting (VRAM used before: {0} MB)" -f $vramBefore)
    Send-Alert "Ollama watchdog: auto-recovering" "Ollama is wedged (model unresponsive, GPU idle). Killing the stuck process and restarting it automatically. No action needed yet - next update in ~10 minutes." "warning"

    try { Get-Process -Name "*llama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 6
    $vramAfter = Get-VramUsedMb
    Log ("Killed ollama/llama processes (VRAM used after: {0} MB)" -f $vramAfter)

    try {
        Start-Process -FilePath $OllamaExe | Out-Null
    } catch {
        Send-Alert "Ollama watchdog: relaunch FAILED" ("Could not start '{0}': {1}. MANUAL ACTION NEEDED." -f $OllamaExe, $_.Exception.Message) "critical"
        return $false
    }

    # wait for HTTP up (max 60s)
    $up = $false
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Seconds 5
        if (Test-OllamaHttp) { $up = $true; break }
    }
    if (-not $up) {
        Send-Alert "Ollama watchdog: API did not come up" "Restarted Ollama but :11434 is still not answering after 60s. MANUAL ACTION NEEDED (check the tower)." "critical"
        return $false
    }

    Log "Ollama HTTP up; issuing patient warm call ($ProbeTimeoutColdSec s timeout)..."
    $warm = Invoke-Probe $ProbeTimeoutColdSec
    # record the action regardless of warm outcome
    $state.actions = @($state.actions) + @($now.ToString("o"))
    if ($warm) {
        Send-Alert "Ollama watchdog: recovered" "Ollama restarted and the model is warm again. Extraction is back. No action needed." "info"
        return $true
    }
    Send-Alert "Ollama watchdog: warm-up failed after restart" "Restarted Ollama but the model would not load within 5 minutes. MANUAL ACTION NEEDED: check VRAM (close Chrome/TradingView) or reboot the tower." "critical"
    return $false
}

# ----- main -----
Trim-Log
if (Test-Path $DisablePath) { Log "Disabled via ollama-watchdog.DISABLED; exiting."; exit 0 }

# single-instance guard (warm call can outlive the 5-min schedule)
$mtx = New-Object System.Threading.Mutex($false, "Global\TFOllamaWatchdog")
if (-not $mtx.WaitOne(0)) { Log "Another watchdog run is active; exiting."; exit 0 }

try {
    $state = Get-State

    # 1. process/HTTP liveness
    if (-not (Test-OllamaHttp)) {
        $procs = @(Get-Process -Name "*llama*" -ErrorAction SilentlyContinue)
        Log ("HTTP :11434 DOWN. llama-family processes running: {0}" -f $procs.Count)
        if ($DryRun) { Log "DRYRUN: would recover (kill ghosts if any + relaunch + warm)."; exit 0 }
        $state.consecutiveFailures = [int]$state.consecutiveFailures + 1
        # process dead is unambiguous - act immediately (no busy false-positive possible)
        $null = Restart-Ollama $state
        $state.consecutiveFailures = 0
        Save-State $state
        exit 0
    }

    # 2. residency + probe
    $resident = Get-ResidentModels
    if ($null -eq $resident) { Log "WARN: /api/ps failed while /api/tags OK; skipping cycle."; exit 0 }

    $isResident = $false
    foreach ($m in $resident) { if ($m.name -like "$Model*") { $isResident = $true } }

    if ($isResident) { $timeout = $ProbeTimeoutResidentSec } else { $timeout = $ProbeTimeoutColdSec; Log "Model not resident; probe doubles as warm-keeper (cold timeout $timeout s)." }

    $ok = Invoke-Probe $timeout
    if ($ok) {
        if ([int]$state.consecutiveFailures -gt 0) { Log "Probe OK; resetting failure counter." }
        $state.consecutiveFailures = 0
        Save-State $state
        Log ("HEALTHY (resident={0})" -f $isResident)
        exit 0
    }

    # 3. probe failed - busy or wedged?
    $util = Get-GpuUtil
    if ($util -ge $BusyGpuUtilPct) {
        Log ("Probe timed out but GPU util {0}% >= {1}% - likely BUSY (real inference in flight). Not counting a failure." -f $util, $BusyGpuUtilPct)
        exit 0
    }

    $state.consecutiveFailures = [int]$state.consecutiveFailures + 1
    Log ("Probe FAILED with idle GPU (util {0}%). consecutiveFailures={1}/{2} (resident={3})" -f $util, $state.consecutiveFailures, $FailuresBeforeAction, $isResident)

    if ([int]$state.consecutiveFailures -lt $FailuresBeforeAction) {
        Save-State $state
        Log "Below action threshold; will re-check next cycle."
        exit 0
    }

    # 4. wedge confirmed
    Log "WEDGE CONFIRMED (2 consecutive idle-GPU probe failures - orphan/wedge signature per tf-debugging A1b)."
    $null = Restart-Ollama $state
    $state.consecutiveFailures = 0
    Save-State $state
} finally {
    $mtx.ReleaseMutex() | Out-Null
    $mtx.Dispose()
}
