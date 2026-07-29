# worker-execution-guard.ps1 — PreToolUse gate for the worker-execution skill (R-386).
#
# Blocks a CODE write when a NEW RULING has landed since the worker last loaded
# `worker-execution`. Enforces the operator's rule: the worker re-loads the
# standard AFTER EVERY RULING, not once per session.
#
# Mechanism: compare the sentinel (written by worker-execution-receipt.ps1 when
# the Skill is invoked) against the ADVISOR-RULINGS.md mtime.
#   ledger NEWER than sentinel  -> a ruling landed since the last load -> BLOCK
#   sentinel NEWER than ledger  -> standard is current                 -> allow
#
# Scope: source/test/script writes only. Reports, ledgers, state files, docs and
# markdown are never blocked — the worker must always be able to REPORT, and a
# guard that can gag a report is worse than no guard.
#
# FAILS OPEN on any error. PreToolUse (recoverable), never a Stop hook — this
# repo has a documented Stop-hook wedge.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }

    if ([string]$j.tool_name -notmatch '^(Write|Edit|MultiEdit)$') { exit 0 }
    $path = [string]$j.tool_input.file_path
    if (-not $path) { exit 0 }

    $p = $path -replace '\\', '/'

    # Never gate the worker's ability to report, or any docs/config surface.
    if ($p -match '(AGENT-REPORTS|ADVISOR-RULINGS|ADVISOR-STATE|AGENT-LOGS|HANDOFF)') { exit 0 }
    if ($p -match '\.(md|json|ya?ml|txt|ps1)$') { exit 0 }

    # Gate the code surface only.
    if ($p -notmatch '/(src|tests?|scripts|e2e)/') { exit 0 }

    $sentinel = Join-Path $env:USERPROFILE '.claude\.worker-execution-loaded'
    $ledger = 'C:/Users/tonio/Projects/wt-h1-wave4-20260712/docs/designs/ADVISOR-RULINGS.md'
    if (-not (Test-Path $ledger)) { exit 0 }   # no ledger visible -> not this campaign -> allow

    $ledgerTime = (Get-Item $ledger).LastWriteTimeUtc
    $loadedTime = [datetime]::MinValue
    if (Test-Path $sentinel) { $loadedTime = (Get-Item $sentinel).LastWriteTimeUtc }

    if ($loadedTime -gt $ledgerTime) { exit 0 }

    $msg = @'
worker-execution guard BLOCKED this code write: a NEW RULING has landed since you
last loaded the `worker-execution` standard (or you have not loaded it at all).

Invoke it now (Skill tool -> worker-execution), then re-issue this write.

WHY: the standard is re-read AFTER EVERY RULING because THIS FILE MUTATES. The
advisor measured its own decay on exactly this failure — one invocation, then 23
rulings from a stale copy, mandated-field compliance 4.0/10 -> 0.1/10. You
verified the same exposure yourself when `migration-author` had gained a MANDATORY
step after you last read it (AR-348).

The gate compares your last load against the ruling ledger's mtime, so it opens
again the moment you re-load and stays open until the next ruling lands.

NOT blocked, ever: AGENT-REPORTS.md and any .md/.json/.yaml — you can always
report, and you can always escalate. Recovery if this misfires: remove its entry
from .claude/settings.json.
'@
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    exit 0
}
