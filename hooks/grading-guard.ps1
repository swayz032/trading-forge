# grading-guard.ps1 — PreToolUse guard for the grading-integrity skill.
# Blocks a Write/Edit ONLY when an ungrounded grading-victory phrase appears with
# NO evidence marker attached. Fails OPEN on any error (never blocks legit work).
# Registered in .claude/settings.json under hooks.PreToolUse (matcher Write|Edit|MultiEdit).

$ErrorActionPreference = 'SilentlyContinue'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }

    $j = $raw | ConvertFrom-Json
    if ($null -eq $j) { exit 0 }

    $tool = [string]$j.tool_name
    if ($tool -notmatch '^(Write|Edit|MultiEdit)$') { exit 0 }

    # Collect the text being written (handles Write/Edit/MultiEdit shapes).
    $text = ''
    $ti = $j.tool_input
    if ($ti.content)    { $text += "`n" + [string]$ti.content }
    if ($ti.new_string) { $text += "`n" + [string]$ti.new_string }
    if ($ti.edits)      { foreach ($e in $ti.edits) { if ($e.new_string) { $text += "`n" + [string]$e.new_string } } }
    if (-not $text) { exit 0 }

    # The lie-shape: a bare grading-victory claim.
    $claim =
        ($text -match '(?i)\b(9|10)\s*/\s*10\b') -or
        ($text -match '(?i)\b100\s*%\s*(complete|done|pass(ed)?|verified|working|solid)') -or
        ($text -match '(?i)all systems.{0,24}(10\s*/\s*10|pass|green|verified|perfect|go\b)') -or
        ($text -match '(?i)\b(bulletproof|flawless|fully verified|production[- ]ready|zero (bugs|issues|gaps|defects))\b')
    if (-not $claim) { exit 0 }

    # Evidence markers — if any are present, treat the claim as grounded and allow.
    $tick = [char]96
    $evidence =
        ($text.Contains([string]$tick)) -or                                  # `command` / `file` backticks
        ($text -match '(?i)\b\d+\s*/\s*\d+\s*(tests?|pass|passed|green)') -or # N/N tests
        ($text -match '[\w./\\-]+:\d+') -or                                   # file:line
        ($text -match '(?i)\b(UNVERIFIED|CLAIMED|VERIFIED)\b') -or            # already using the status contract
        ($text -match [char]0x2192)                                          # → evidence arrow
    if ($evidence) { exit 0 }

    # Ungrounded grading claim → block and instruct.
    $msg = @'
grading-integrity guard BLOCKED this write: an ungrounded grading claim was detected (e.g. "10/10", "100% complete", "production-ready", "bulletproof", "all systems pass") with no evidence attached. A self-reported score is a CLAIM, not a VERDICT (see .claude/skills/grading-integrity). Before re-issuing this write, either:
  (1) attach reproducible evidence for the claim — a command + its actual output, a file:line pointer, or N/N test counts; or
  (2) mark it status=CLAIMED / UNVERIFIED and route certification to the independent accuracy-validator agent.
Remember: 10 is effectively unreachable, 7-8 is the realistic ceiling, and a >1-band jump in one wave is implausible. Re-issue the write with evidence.
'@
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    # Never let a guard failure block real work.
    exit 0
}
