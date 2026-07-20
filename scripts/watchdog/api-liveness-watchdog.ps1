# scripts/watchdog/api-liveness-watchdog.ps1
#
# External API-liveness watchdog (ops-experience, Grade-B rider; design in
# docs/external-api-watchdog-design-2026-07-20.md, parameters ruled in OR-020 §2).
#
# WHY THIS EXISTS: on 2026-07-18 the canonical node_modules lost 18 of 34 declared deps; the
# API could not boot (load-env.ts imports dotenv) and the outage ran ~26 HOURS with no alert.
# Every existing watcher shared a failure domain with its subject — the dead-man's heartbeat
# runs IN-PROCESS inside the API, discord.js was one of the missing packages so the messenger
# died of the same cause, and the green board reads an endpoint the API itself serves.
# A watcher must not share a failure domain with its subject.
#
# HARD CONSTRAINTS:
#   * ZERO repo dependencies. No node, no npm, no node_modules import. The entire point is
#     surviving a broken tree — a watchdog that needs the tree cannot report the tree is broken.
#   * NEVER restarts anything. The API already has an in-process auto-restart with its own
#     guard rails; a second external restarter would race it and could produce the 4 AM
#     crash-loop OR-013 §3 forbids. ONE restarter per system. This one only ever TELLS.
#   * 503 auth_not_configured is HEALTHY (up and correctly refusing an unauthenticated call).
#     Alerting on it would train the operator to ignore the watchdog.
#
# Modelled on ollama-watchdog.ps1, which was source-audited during the OR-014 forensics and
# found well-built: mutex-guarded, rate-limited, kill-file switch, -DryRun.

[CmdletBinding()]
param(
    [string] $HealthUrl   = 'http://127.0.0.1:4000/api/health',
    [string] $LogPath     = 'C:\Users\tonio\bin\tf-logs\api-watchdog.log',
    [string] $StatePath   = 'C:\Users\tonio\bin\tf-logs\api-watchdog.state.json',
    [string] $KillFile    = 'C:\Users\tonio\bin\tf-logs\api-watchdog.OFF',
    [int]    $FailThreshold   = 3,      # OR-020 §2(i): alert at ~3 consecutive misses (~15 min)
    [int]    $ReAlertMinutes  = 60,
    [int]    $TimeoutSec      = 8,
    [string[]] $WatchServices = @('TradingForgeAPI', 'TradingForgeDiscordBot'),
    [switch] $DryRun,
    [switch] $SelfTest                  # emit classifier results for fixtures, then exit
)

$ThresholdVersion = 'watchdog_thresholds_v1'

# ── PURE CLASSIFIER ──────────────────────────────────────────────────────────────────────────
# Deterministic in -> deterministic out. No I/O, no clock. The test harness dot-sources this
# file with -SelfTest and drives this function with fixtures, so the PRODUCTION path is the
# tested path — there is no parallel copy to drift.
function Get-LivenessVerdict {
    param(
        [Nullable[int]] $StatusCode,   # $null when no HTTP response at all
        [string]        $Body,
        [string]        $ErrorKind     # '', 'refused', 'timeout', 'probe_error'
    )

    if ($null -ne $StatusCode) {
        # ANY HTTP response means something is listening and serving.
        if ($StatusCode -eq 503 -and $Body -match 'auth_not_configured') {
            return [pscustomobject]@{ Verdict = 'AUTH_GATED_UP'; Healthy = $true;  Reason = 'auth gate active (up)' }
        }
        if ($StatusCode -ge 200 -and $StatusCode -lt 600) {
            return [pscustomobject]@{ Verdict = 'UP';            Healthy = $true;  Reason = "http $StatusCode" }
        }
    }

    switch ($ErrorKind) {
        'refused'     { return [pscustomobject]@{ Verdict = 'DOWN';      Healthy = $false; Reason = 'connection refused — nothing listening' } }
        'timeout'     { return [pscustomobject]@{ Verdict = 'AMBIGUOUS'; Healthy = $false; Reason = 'probe timed out' } }
        'probe_error' { return [pscustomobject]@{ Verdict = 'AMBIGUOUS'; Healthy = $false; Reason = 'watchdog probe itself failed' } }
    }
    # Fail-safe: an unrecognised shape counts as unhealthy and says so, rather than passing quietly.
    return [pscustomobject]@{ Verdict = 'AMBIGUOUS'; Healthy = $false; Reason = 'unclassifiable probe result' }
}

# Pure alert decision — separated so the rate-limiting is testable without a clock.
function Get-AlertDecision {
    param(
        [int] $ConsecutiveFailures,
        [int] $Threshold,
        [bool] $AlreadyAlerted,
        [double] $MinutesSinceLastAlert,
        [int] $ReAlertMinutes,
        [bool] $Healthy
    )
    if ($Healthy) {
        if ($AlreadyAlerted) { return [pscustomobject]@{ Action = 'RECOVERY'; Reason = 'recovered after alerting' } }
        return [pscustomobject]@{ Action = 'NONE'; Reason = 'healthy' }
    }
    if ($ConsecutiveFailures -lt $Threshold) {
        return [pscustomobject]@{ Action = 'NONE'; Reason = "below threshold ($ConsecutiveFailures/$Threshold)" }
    }
    if (-not $AlreadyAlerted) { return [pscustomobject]@{ Action = 'ALERT'; Reason = 'threshold crossed' } }
    if ($MinutesSinceLastAlert -ge $ReAlertMinutes) { return [pscustomobject]@{ Action = 'REALERT'; Reason = 'still down' } }
    return [pscustomobject]@{ Action = 'NONE'; Reason = 'rate-limited' }
}

if ($SelfTest) {
    # Fixture-driven classifier dump for the test harness. Prints one JSON line per case.
    $cases = @(
        @{ n='http200';        s=200;   b='{"ok":true}';                      e='' }
        @{ n='auth_gated_503'; s=503;   b='{"error":"auth_not_configured"}';  e='' }
        @{ n='other_503';      s=503;   b='{"error":"something_else"}';       e='' }
        @{ n='http500';        s=500;   b='boom';                             e='' }
        @{ n='refused';        s=$null; b='';                                 e='refused' }
        @{ n='timeout';        s=$null; b='';                                 e='timeout' }
        @{ n='probe_error';    s=$null; b='';                                 e='probe_error' }
        @{ n='unknown';        s=$null; b='';                                 e='' }
    )
    foreach ($c in $cases) {
        $v = Get-LivenessVerdict -StatusCode $c.s -Body $c.b -ErrorKind $c.e
        [pscustomobject]@{ case=$c.n; verdict=$v.Verdict; healthy=$v.Healthy } | ConvertTo-Json -Compress
    }
    $alerts = @(
        @{ n='healthy_quiet';   f=0; a=$false; m=0.0;   h=$true  }
        @{ n='healthy_recover'; f=0; a=$true;  m=0.0;   h=$true  }
        @{ n='below_threshold'; f=2; a=$false; m=0.0;   h=$false }
        @{ n='threshold';       f=3; a=$false; m=0.0;   h=$false }
        @{ n='rate_limited';    f=9; a=$true;  m=5.0;   h=$false }
        @{ n='realert';         f=9; a=$true;  m=61.0;  h=$false }
    )
    foreach ($c in $alerts) {
        $d = Get-AlertDecision -ConsecutiveFailures $c.f -Threshold 3 -AlreadyAlerted $c.a `
                               -MinutesSinceLastAlert $c.m -ReAlertMinutes 60 -Healthy $c.h
        [pscustomobject]@{ case=$c.n; action=$d.Action } | ConvertTo-Json -Compress
    }
    exit 0
}

# ── I/O layer ────────────────────────────────────────────────────────────────────────────────
function Write-WatchdogLog {
    param([string] $Message)
    try {
        $dir = Split-Path -Parent $LogPath
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message | Out-File -FilePath $LogPath -Append -Encoding utf8
    } catch { }   # logging must never be the thing that kills the watchdog
}

# Kill-file: disable without unregistering the task.
if (Test-Path $KillFile) { Write-WatchdogLog "SKIP: kill-file present ($KillFile)"; exit 0 }

# Mutex: overlapping ticks must not stack.
$mutex = New-Object System.Threading.Mutex($false, 'Global\TF-ApiLivenessWatchdog')
if (-not $mutex.WaitOne(0)) { Write-WatchdogLog 'SKIP: previous tick still running'; exit 0 }

try {
    $status = $null; $body = ''; $errKind = ''
    try {
        $resp   = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $TimeoutSec -UseBasicParsing
        $status = [int] $resp.StatusCode
        $body   = [string] $resp.Content
    } catch [System.Net.WebException] {
        $r = $_.Exception.Response
        if ($r) { $status = [int] $r.StatusCode; try { $body = (New-Object System.IO.StreamReader($r.GetResponseStream())).ReadToEnd() } catch { } }
        elseif ($_.Exception.Message -match 'timed out') { $errKind = 'timeout' }
        else { $errKind = 'refused' }
    } catch {
        if ($_.Exception.Message -match 'timed out|timeout') { $errKind = 'timeout' }
        elseif ($_.Exception.Message -match 'refused|actively refused|Unable to connect') { $errKind = 'refused' }
        else { $errKind = 'probe_error' }
    }

    $verdict = Get-LivenessVerdict -StatusCode $status -Body $body -ErrorKind $errKind

    # OR-020 §2(ii): the Discord bot has no HTTP surface — probe its service state instead.
    $svcReport = @()
    foreach ($svc in $WatchServices) {
        try {
            $s = Get-Service -Name $svc -ErrorAction Stop
            $svcReport += "$svc=$($s.Status)"
        } catch { $svcReport += "$svc=ABSENT" }
    }

    # State (consecutive failures + last alert) — fail-safe defaults if unreadable.
    $state = [pscustomobject]@{ consecutiveFailures = 0; alerted = $false; lastAlertUtc = $null }
    try { if (Test-Path $StatePath) { $state = Get-Content $StatePath -Raw | ConvertFrom-Json } } catch { }

    if ($verdict.Healthy) { $state.consecutiveFailures = 0 }
    else { $state.consecutiveFailures = [int]$state.consecutiveFailures + 1 }

    $minsSince = 0.0
    if ($state.lastAlertUtc) { try { $minsSince = ((Get-Date).ToUniversalTime() - [datetime]$state.lastAlertUtc).TotalMinutes } catch { } }

    $decision = Get-AlertDecision -ConsecutiveFailures $state.consecutiveFailures -Threshold $FailThreshold `
                                  -AlreadyAlerted ([bool]$state.alerted) -MinutesSinceLastAlert $minsSince `
                                  -ReAlertMinutes $ReAlertMinutes -Healthy $verdict.Healthy

    $line = "{0} verdict={1} reason='{2}' fails={3} action={4} services=[{5}] thresholds={6}" -f `
            $(if ($DryRun) { '[DRYRUN]' } else { '' }), $verdict.Verdict, $verdict.Reason,
            $state.consecutiveFailures, $decision.Action, ($svcReport -join ' '), $ThresholdVersion
    Write-WatchdogLog $line

    if (-not $DryRun -and $decision.Action -in @('ALERT', 'REALERT', 'RECOVERY')) {
        $msg = if ($decision.Action -eq 'RECOVERY') {
            "OK  Trading Forge API is back up. ($($verdict.Reason); services: $($svcReport -join ', '))"
        } else {
            "DOWN  Trading Forge API has not answered for $($state.consecutiveFailures) checks (~$($state.consecutiveFailures * 5) min). $($verdict.Reason). Services: $($svcReport -join ', '). The watchdog does not restart anything - this is a report."
        }
        # Ordered fallback: the incident killed the primary path, so try sidecar -> webhook -> log.
        $sent = $false
        foreach ($target in @($env:TF_ALERT_SIDECAR_URL, $env:DISCORD_WEBHOOK_URL)) {
            if ($sent -or [string]::IsNullOrWhiteSpace($target)) { continue }
            try {
                Invoke-RestMethod -Uri $target -Method Post -TimeoutSec 8 -ContentType 'application/json' `
                                  -Body (@{ content = $msg } | ConvertTo-Json -Compress) | Out-Null
                $sent = $true
                Write-WatchdogLog "alert sent via $($target -replace '/[^/]*$','/***')"
            } catch { Write-WatchdogLog "alert path failed: $($_.Exception.Message)" }
        }
        if (-not $sent) { Write-WatchdogLog "ALERT NOT DELIVERED (log-only): $msg" }

        if ($decision.Action -eq 'RECOVERY') { $state.alerted = $false; $state.lastAlertUtc = $null }
        else { $state.alerted = $true; $state.lastAlertUtc = (Get-Date).ToUniversalTime().ToString('o') }
    }

    if (-not $DryRun) {
        try { $state | ConvertTo-Json -Compress | Out-File -FilePath $StatePath -Encoding utf8 } catch { Write-WatchdogLog 'state write failed' }
    }
}
finally { $mutex.ReleaseMutex() | Out-Null; $mutex.Dispose() }
