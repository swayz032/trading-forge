# advisor-ruling-guard.ps1 — PreToolUse guard for the advisor-ruling skill (R-384).
#
# Blocks a ledger write/commit unless the `advisor-ruling` skill was invoked
# since the last ruling. Reads stdin JSON, FAILS OPEN on any error, exit 2 = block.
#
# Why this exists (measured 2026-07-28, R-383): the desk invoked the skill ONCE,
# declared it "already loaded", and ruled 23 more times from memory. §7 field
# compliance fell 4.0/10 -> 0.1/10. Worse, the skill FILE was edited four times
# that day, so the remembered copy was stale by construction.
# A rule written in a document you read from memory is a caption, not a gate.
#
# ── R-641 (2026-08-03): THIS GUARD HAD NEVER FIRED ON A REAL RULING. ──────────
# MEASURED: the matcher was `Write|Edit|MultiEdit` and the desk writes the ledger
# by SHELL (head/cat/tail/cp + `git commit -o`). So R-631..R-640 — ten consecutive
# rulings — were entirely ungated. A guard blind to the write mechanism actually
# in use is a green check with no path to red.
#
# THE TRAP IN THE OBVIOUS FIX: adding `Bash` to the matcher ALONE makes the guard
# PASS BY FAILING — a Bash call has no `tool_input.file_path`, so the old code
# hit `if (-not $path) { exit 0 }` and allowed everything. It must read
# `tool_input.command` instead.
#
# WHY IT GATES `git commit` AND NOT ANY MENTION OF THE FILE: this desk greps,
# seds and `git log`s the ledger constantly during verification. Matching the
# filename alone would block its own READS — a guard that blocks verification is
# worse than no guard. The COMMIT is the act that publishes a ruling; an
# uncommitted splice is not a ruling.
#
# KNOWN LIMIT, stated rather than papered over: a `git commit -a` that sweeps the
# ledger without naming it evades this guard. That is already a protocol
# violation (the protocol mandates `commit -o <path>`), so it is not covered here.
#
# Recovery if this ever misfires: delete this hook entry from
# .claude/settings.json, or `New-Item` the sentinel file by hand.

$ErrorActionPreference = 'SilentlyContinue'

function Test-LedgerPublishCommand([string]$cmd) {
    # R-694 §5 / AR-774: the old test was `$cmd -match 'git\s+commit' -and $cmd -match
    # 'ADVISOR-RULINGS\.md'` over the WHOLE command string, which cannot tell an ACTION
    # from a QUOTATION of one -- a heredoc body or a commit message mentioning both
    # tokens matched exactly like a real publish. Measured twice: it false-BLOCKED a
    # worker report (AR-770), and it silently CONSUMED the advisor's sentinel (fixture
    # B3). Both tokens must now appear on the SAME line.
    if (-not $cmd) { return $false }
    $joined = [regex]::Replace($cmd, "\\\s*\r?\n", " ")   # join shell line-continuations first
    foreach ($line in ($joined -split "\r?\n")) {
        if ($line -match 'git\s+commit' -and $line -match 'ADVISOR-RULINGS\.md') { return $true }
    }
    return $false
}


try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }

    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }

    $tool = [string]$j.tool_name
    $isLedgerWrite = $false

    if ($tool -match '^(Write|Edit|MultiEdit)$') {
        $path = [string]$j.tool_input.file_path
        # Only the money-path/H1 ruling ledger. -OPS and other ledgers are out of scope.
        if ($path -and $path -match 'ADVISOR-RULINGS\.md$' -and $path -notmatch 'ADVISOR-RULINGS-OPS\.md$') {
            $isLedgerWrite = $true
        }
    }
    elseif ($tool -eq 'Bash') {
        $cmd = [string]$j.tool_input.command
        # Gate the PUBLISHING act only — a commit that names the ledger.
        # Reads (grep/sed/git log) mention the path too and must NOT be blocked.
        if (Test-LedgerPublishCommand $cmd) {
            $isLedgerWrite = $true
        }
    }

    if (-not $isLedgerWrite) { exit 0 }

    $sentinel = Join-Path $env:USERPROFILE '.claude\.advisor-ruling-invoked'
    $fresh = $false
    if (Test-Path $sentinel) {
        $stamp = [long](Get-Content $sentinel -Raw).Trim()
        $ageSec = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $stamp)
        # Sentinel is consumed after each ruling, so presence is the gate;
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

The sentinel is consumed after every ruling, so this is once per ruling, not once
per session. Recovery if this guard ever misfires: remove its entry from
.claude/settings.json.
'@
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    # Never let a guard failure block real work.
    exit 0
}
