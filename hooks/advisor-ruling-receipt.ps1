# advisor-ruling-receipt.ps1 — PostToolUse companion to advisor-ruling-guard.ps1 (R-384).
#
# Two jobs, branched on tool_name:
#   Skill(advisor-ruling)        -> WRITE the sentinel (the skill was actually read)
#   Write/Edit on ADVISOR-RULINGS.md -> CONSUME (delete) the sentinel
#
# Consuming after each ruling is what makes this "once per RULING" rather than
# "once per session" — the exact failure R-383 measured (one invocation, then 23
# rulings from a remembered, and by then stale, copy of the skill).
#
# FAILS OPEN on any error: this hook must never break a legitimate write.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }

    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }

    $sentinel = Join-Path $env:USERPROFILE '.claude\.advisor-ruling-invoked'
    $tool = [string]$j.tool_name

    if ($tool -eq 'Skill') {
        # The Skill tool's argument key has varied; check the likely fields plus a raw fallback.
        $name = ''
        if ($j.tool_input.skill) { $name = [string]$j.tool_input.skill }
        elseif ($j.tool_input.name) { $name = [string]$j.tool_input.name }
        if (-not $name) { $name = $raw }

        if ($name -match 'advisor-ruling') {
            $dir = Split-Path $sentinel -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() | Set-Content -Path $sentinel -Encoding ascii
        }
        exit 0
    }

    if ($tool -match '^(Write|Edit|MultiEdit)$') {
        $path = [string]$j.tool_input.file_path
        if ($path -match 'ADVISOR-RULINGS\.md$' -and $path -notmatch 'ADVISOR-RULINGS-OPS\.md$') {
            Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    exit 0
}
catch {
    exit 0
}
