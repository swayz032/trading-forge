# advisor-ruling-guard.ps1 — PreToolUse guard for the advisor-ruling skill (R-384).
#
# Blocks a write to ADVISOR-RULINGS.md unless the `advisor-ruling` skill was
# invoked since the last ruling was written. Mirrors grading-guard.ps1:
# reads stdin JSON, FAILS OPEN on any error, exit 2 = block with a message.
#
# Why this exists (measured 2026-07-28, R-383): the desk invoked the skill ONCE,
# declared it "already loaded", and ruled 23 more times from memory. §7 field
# compliance fell 4.0/10 -> 0.1/10. Worse, the skill FILE was edited four times
# that day, so the remembered copy was stale by construction.
# A rule written in a document you read from memory is a caption, not a gate.
#
# Recovery if this ever misfires: delete this hook entry from
# .claude/settings.json, or `New-Item` the sentinel file by hand.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }

    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }

    $tool = [string]$j.tool_name
    if ($tool -notmatch '^(Write|Edit|MultiEdit)$') { exit 0 }

    $path = [string]$j.tool_input.file_path
    if (-not $path) { exit 0 }
    # Only the money-path/H1 ruling ledger. -OPS and other ledgers are out of scope.
    if ($path -notmatch 'ADVISOR-RULINGS\.md$') { exit 0 }
    if ($path -match 'ADVISOR-RULINGS-OPS\.md$') { exit 0 }

    $sentinel = Join-Path $env:USERPROFILE '.claude\.advisor-ruling-invoked'
    $fresh = $false
    if (Test-Path $sentinel) {
        $stamp = [long](Get-Content $sentinel -Raw).Trim()
        $ageSec = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $stamp)
        # Sentinel is consumed after each ruling write, so presence is the gate;
        # the age cap only stops a very old stray sentinel from counting.
        if ($ageSec -ge 0 -and $ageSec -lt 3600) { $fresh = $true }
    }
    if ($fresh) { exit 0 }

    $msg = @'
advisor-ruling guard BLOCKED this ledger write: the `advisor-ruling` skill has not
been invoked for this ruling.

Invoke it now (Skill tool -> advisor-ruling), then re-issue this write.

WHY THIS IS NOT CEREMONY (R-383, measured): invoking once per session and ruling
from memory collapsed §7 field compliance from 4.0/10 to 0.1/10 across 23 rulings.
And the skill file MUTATES mid-session — it was edited four times on 2026-07-28 —
so a remembered copy is stale by construction. You re-read it not for discipline
but because you may have changed it.

The sentinel is consumed after every ruling write, so this is once per ruling,
not once per session. Recovery if this guard ever misfires: remove its entry from
.claude/settings.json.
'@
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    # Never let a guard failure block real work.
    exit 0
}
