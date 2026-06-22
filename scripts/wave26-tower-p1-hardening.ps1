# Wave 26 P1 tower hardening — applies the consolidated autonomous-readiness +
# local-dev-optimizer recommendations in one elevated run.
#
# Closes the daily-reboot autonomy failure. Target: 14-day unattended uptime.
#
# Steps:
#   1. OLLAMA_KEEP_ALIVE=24h + OLLAMA_MAX_LOADED_MODELS=1 + OLLAMA_FLASH_ATTENTION=true (Machine scope!)
#   2. NSSM AppMemoryLimit on TF API (4 GB) + Discord bot (1 GB)
#   3. Defender exclusions on .ollama/models + trading-forge project
#   4. Restart Ollama service (picks up new env)
#   5. Restart TF API + Discord bot (picks up new .env model name)
#   6. Warm-up the new gemma3n model via curl so it's resident before first signal
#
# Pagefile change is NOT scripted — requires Control Panel UI + reboot.
# That's a separate operator action documented in the audit.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$LOG  = "C:\Users\tonio\bin\tf-logs\tower-p1-hardening.log"
$NSSM = "C:\Users\tonio\bin\nssm\nssm.exe"
$null = New-Item -ItemType Directory -Path (Split-Path $LOG) -Force -ErrorAction SilentlyContinue
function L($m) { "[{0}] {1}" -f (Get-Date -Format o), $m | Tee-Object -FilePath $LOG -Append | Write-Host }

L "=== Wave 26 P1 tower hardening ==="

# ===== 1. Ollama env vars at MACHINE scope =====
L "Setting Ollama env vars (Machine scope — NSSM/LocalSystem inherits)..."
[System.Environment]::SetEnvironmentVariable("OLLAMA_KEEP_ALIVE",       "24h",  "Machine")
[System.Environment]::SetEnvironmentVariable("OLLAMA_MAX_LOADED_MODELS","1",    "Machine")
[System.Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION",  "true", "Machine")
L "  OLLAMA_KEEP_ALIVE=24h  OLLAMA_MAX_LOADED_MODELS=1  OLLAMA_FLASH_ATTENTION=true"

# ===== 2. NSSM memory ceilings =====
L "Setting NSSM AppMemoryLimit on TradingForgeAPI (4 GB) + TradingForgeDiscordBot (1 GB)..."
& $NSSM set TradingForgeAPI       AppMemoryLimit 4294967296 2>&1 | ForEach-Object { L "  $_" }
& $NSSM set TradingForgeDiscordBot AppMemoryLimit 1073741824 2>&1 | ForEach-Object { L "  $_" }

# ===== 3. Defender exclusions (idempotent) =====
L "Verifying / adding Defender exclusions..."
$existing = (Get-MpPreference -ErrorAction SilentlyContinue).ExclusionPath
$wanted = @(
    "C:\Users\tonio\.ollama\models",
    "C:\Users\tonio\.ollama",
    "C:\Users\tonio\Projects\trading-forge\trading-forge\node_modules",
    "C:\Users\tonio\Projects\trading-forge\trading-forge\dist",
    "C:\Users\tonio\Projects\trading-forge\trading-forge\logs",
    "C:\Users\tonio\Projects\trading-forge"
)
foreach ($p in $wanted) {
    if ($existing -notcontains $p) {
        Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue
        L "  added exclusion: $p"
    } else {
        L "  already excluded: $p"
    }
}
# Process-level exclusions
$existingProc = (Get-MpPreference -ErrorAction SilentlyContinue).ExclusionProcess
foreach ($proc in @("ollama.exe","ollama_llama_server.exe","node.exe","python.exe")) {
    if ($existingProc -notcontains $proc) {
        Add-MpPreference -ExclusionProcess $proc -ErrorAction SilentlyContinue
        L "  added process exclusion: $proc"
    }
}

# ===== 4. Restart Ollama (picks up Machine env vars) =====
L "Restarting Ollama (so new Machine-scope env vars take effect)..."
Get-Process ollama -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; L "  killed ollama pid=$($_.Id)" } catch {}
}
Start-Sleep -Seconds 4
Start-Process -FilePath "C:\Users\tonio\AppData\Local\Programs\Ollama\ollama app.exe" -WindowStyle Hidden -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6
$ver = (Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 5 -ErrorAction SilentlyContinue)
L "  Ollama back up: version=$($ver.version)"

# ===== 5. Restart TF API + Discord bot (pick up new .env model name) =====
L "Restarting TradingForgeAPI + TradingForgeDiscordBot..."
foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
    sc.exe stop $svc 2>&1 | ForEach-Object { L "  stop $svc: $_" }
}
Start-Sleep -Seconds 4
foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
    sc.exe start $svc 2>&1 | ForEach-Object { L "  start $svc: $_" }
}
Start-Sleep -Seconds 8

# ===== 6. Warm-up curl — load gemma3n into VRAM before first signal =====
L "Warming gemma3n into VRAM..."
$body = '{"model":"gemma4:e2b","prompt":"warm","stream":false,"keep_alive":-1,"options":{"num_predict":3}}'
try {
    $resp = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 60
    L "  warm-up OK: response=$($resp.response.Substring(0, [Math]::Min(50, $resp.response.Length)))"
} catch { L "  warm-up FAILED: $($_.Exception.Message)" }

# ===== verify final state =====
L ""
L "=== final state ==="
foreach ($svc in @("TradingForgeAPI","TradingForgeDiscordBot")) {
    $s = Get-Service $svc -ErrorAction SilentlyContinue
    L "  $svc = $($s.Status)"
}
$loaded = Invoke-RestMethod -Uri "http://localhost:11434/api/ps" -TimeoutSec 5 -ErrorAction SilentlyContinue
foreach ($m in $loaded.models) {
    L "  Ollama loaded: $($m.name) (vram=$([math]::Round($m.size_vram/1MB))MB, expires=$($m.expires_at))"
}
L ""
L "DONE. Next: open Control Panel and set pagefile to 8192-24576 MB (requires reboot)."
