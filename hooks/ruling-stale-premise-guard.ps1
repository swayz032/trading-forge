# ruling-stale-premise-guard.ps1 - PreToolUse guard on the ruling ledger (R-416).
#
# Blocks a ruling that does not reference the NEWEST agent report on disk.
#
# WHY (2026-07-28, measured): R-412 rejected two claims using the premise
# "the W7nln concrete row does not exist". AR-377 had landed ~20 minutes
# earlier proving that row IS real in runtime-production - the two seats had
# measured DIFFERENT TREES (spec_family_bindings.py is 160,049 B in the
# campaign worktree and 35,046 B in the executing checkout). The ledger then
# carried a confident rejection whose premise was already dead, and only the
# WORKER noticed - by auditing the desk's consistency rather than its orders.
#
# A ruling is not sealed when it is committed: the premises under it keep
# moving, and the newest report can invalidate a ruling written before it.
# This guard makes "did you read the latest report?" a precondition of writing,
# not a matter of memory.
#
# It does NOT require agreeing with the newest AR - only NAMING it. Writing
# "AR-380 landed and is unruled; this ruling predates it" satisfies the guard
# and leaves the reader an honest trail.
#
# ASCII ONLY on purpose - literal non-ASCII breaks PowerShell string parsing
# when the file is read as ANSI (ruling-mechanism-guard's first version died
# that way). Mirrors that guard: stdin JSON, FAILS OPEN, exit 2 = block.

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }
    if ([string]$j.tool_name -notmatch '^(Write|Edit|MultiEdit)$') { exit 0 }

    $path = [string]$j.tool_input.file_path
    if ($path -notmatch 'ADVISOR-RULINGS\.md$') { exit 0 }
    if ($path -match 'ADVISOR-RULINGS-OPS\.md$') { exit 0 }

    # The reports file sits beside the ledger.
    $dir = Split-Path -Parent $path
    $reports = Join-Path $dir 'AGENT-REPORTS.md'
    if (-not (Test-Path $reports)) { exit 0 }   # no relay -> nothing to be stale about

    # Newest AR number. Reports are newest-at-top, but take the MAX so the
    # guard does not depend on file ordering staying that way.
    $nums = Select-String -Path $reports -Pattern '^##\s+AR-(\d+)' -AllMatches |
            ForEach-Object { [int]$_.Matches[0].Groups[1].Value }
    if (-not $nums) { exit 0 }
    $newest = ($nums | Measure-Object -Maximum).Maximum

    $text = ''
    $ti = $j.tool_input
    if ($ti.content)    { $text += "`n" + [string]$ti.content }
    if ($ti.new_string) { $text += "`n" + [string]$ti.new_string }
    if ($ti.edits)      { foreach ($e in $ti.edits) { if ($e.new_string) { $text += "`n" + [string]$e.new_string } } }
    if (-not $text) { exit 0 }

    # Only judge writes that are actually AUTHORING a ruling. A typo fix or an
    # in-place annotation of an old ruling must not be gated.
    if ($text -notmatch '(?m)^##\s+R-\d+') { exit 0 }

    if ($text -match ("AR-" + $newest)) { exit 0 }

    $msg = "ruling-stale-premise guard BLOCKED this ledger write: the newest agent" + "`n" +
           "report on disk is AR-$newest and this ruling never names it." + "`n`n" +
           "Read it before ruling. If it is genuinely unrelated, say so explicitly -" + "`n" +
           "e.g. 'AR-$newest landed and is unruled; it does not bear on this ruling' -" + "`n" +
           "which satisfies this guard and leaves the next reader an honest trail." + "`n`n" +
           "WHY THIS IS A GATE (2026-07-28, measured): R-412 rejected two claims on the" + "`n" +
           "premise that a concrete binding row 'does not exist'. AR-377 had landed 20" + "`n" +
           "minutes earlier proving it DOES exist in runtime-production - the two seats" + "`n" +
           "had measured different trees (160,049 B vs 35,046 B). The ledger carried a" + "`n" +
           "confident rejection whose premise was already dead, and the WORKER caught it," + "`n" +
           "not the desk." + "`n`n" +
           "A ruling is not sealed when it is committed. The premises under it keep" + "`n" +
           "moving, and the newest report can invalidate a ruling written before it."
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    exit 0
}
