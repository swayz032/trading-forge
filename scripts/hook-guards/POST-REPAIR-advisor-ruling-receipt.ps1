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

    # ── R-677 (2026-08-03): THIS BRANCH USED TO CONSUME, AND IT MADE THE NORMAL
    # AUTHORING WORKFLOW IMPOSSIBLE TO SATISFY. ───────────────────────────────
    # MEASURED at the desk, twice in one ruling: the guard gates BOTH the Edit and
    # the `git commit`, while this hook consumed on BOTH. So a desk that splices the
    # ledger with Edit and then publishes with `git commit -o` disarmed itself
    # mid-ruling:
    #     Skill(advisor-ruling) -> sentinel ARMED   (witness: age=7s)
    #     Edit ADVISOR-RULINGS.md -> sentinel CONSUMED here
    #     git commit -o ADVISOR-RULINGS.md -> guard BLOCKS, sentinel gone
    # Re-invoking the skill did not help: the next Edit ate it again. R-677 was
    # blocked twice on this before the cause was read out of these two files.
    #
    # R-641 added the Bash-commit consume below to fix a disarm that never fired.
    # It did not REMOVE this one — leaving TWO disarms against ONE arm. That is the
    # defect: a control is only correct if its arm and disarm are the same event.
    #
    # THE GUARD'S OWN STATED PHILOSOPHY DECIDES WHICH ONE SURVIVES:
    #   "The COMMIT is the act that publishes a ruling; an uncommitted splice is
    #    not a ruling."
    # An uncommitted splice is therefore not the thing to consume on. The commit is.
    # This branch now falls through WITHOUT consuming; the Bash branch below is the
    # single disarm. The guard is unchanged and still blocks an unarmed write.
    if ($tool -match '^(Write|Edit|MultiEdit)$') {
        exit 0
    }

    # R-641: the desk writes the ledger by SHELL, so the Write/Edit branch above
    # never fired for it and the sentinel was NEVER CONSUMED — making the gate
    # "once per hour" (the 3600s cap) instead of "once per ruling". That is the
    # same defect as the guard's, on the release side rather than the block side:
    # a control whose ARM works and whose DISARM does not is still broken.
    # Mirrors the guard's condition exactly — consume on the PUBLISHING act.
    if ($tool -eq 'Bash') {
        $cmd = [string]$j.tool_input.command
        if (Test-LedgerPublishCommand $cmd) {
            Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    exit 0
}
catch {
    exit 0
}
