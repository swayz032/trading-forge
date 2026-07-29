# worker-execution-receipt.ps1 — PostToolUse companion to worker-execution-guard.ps1 (R-386).
#
# When Skill(worker-execution) is invoked, touch the sentinel. The guard compares
# this sentinel's mtime against ADVISOR-RULINGS.md's mtime: newer sentinel = the
# standard has been re-read since the last ruling landed.
#
# No consumption here (unlike the advisor's per-ruling gate): the ledger's own
# mtime is the expiry signal, so the gate re-arms automatically the moment the
# next ruling is written.
#
# FAILS OPEN on any error.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }
    if ([string]$j.tool_name -ne 'Skill') { exit 0 }

    $name = ''
    if ($j.tool_input.skill) { $name = [string]$j.tool_input.skill }
    elseif ($j.tool_input.name) { $name = [string]$j.tool_input.name }
    if (-not $name) { $name = $raw }

    if ($name -match 'worker-execution') {
        $sentinel = Join-Path $env:USERPROFILE '.claude\.worker-execution-loaded'
        $dir = Split-Path $sentinel -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() | Set-Content -Path $sentinel -Encoding ascii
    }
    exit 0
}
catch {
    exit 0
}
