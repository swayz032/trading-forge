# ruling-mechanism-guard.ps1 - PreToolUse guard on the ruling ledger (R-392).
#
# Blocks a ruling that asserts a MECHANISM ("by construction", "cannot happen",
# "guaranteed", "is excluded") with NO evidence in the same sentence.
#
# WHY (2026-07-28, measured): half the desk's errors in one session were this one
# shape - a causal story stated in a ruling's calm voice without reading or running
# the thing that would prove it:
#   R-390 "a pass-1 failure is excluded by construction" -> the PASS 2 loop filters NOTHING
#   R-381 "you cite 0098:33-34 for firm_id"              -> verified the file, not the line
#   R-371 "your initiative covered my error"             -> unverified causal narrative
# A wrong NUMBER is caught by the next measurement. A wrong MECHANISM is OBEYED:
# R-390's sentence would have told the next reader to ignore a live alarm.
#
# ASCII ONLY on purpose - literal non-ASCII breaks PowerShell string parsing when
# the file is read as ANSI (this script's own first version died that way).
# Mirrors grading-guard.ps1: stdin JSON, FAILS OPEN, exit 2 = block.

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

    $text = ''
    $ti = $j.tool_input
    if ($ti.content)    { $text += "`n" + [string]$ti.content }
    if ($ti.new_string) { $text += "`n" + [string]$ti.new_string }
    if ($ti.edits)      { foreach ($e in $ti.edits) { if ($e.new_string) { $text += "`n" + [string]$e.new_string } } }
    if (-not $text) { exit 0 }

    # Evidence must sit NEAR the claim, so judge sentence by sentence.
    $sentences = [regex]::Split($text, '(?<=[.!?])\s+|\r?\n')

    # (a) MECHANISM claims - how something works.
    # (b) JOIN claims - two artifacts asserted to correspond. Six of the desk's
    #     errors on 2026-07-28 were joins asserted without checking the key:
    #     file<->line, number<->population, metric-name<->instrument, table<->table.
    $claimRx = '(?i)(by construction|cannot fail|cannot happen|can never|could never|is excluded|excluded by|guarantee[sd]?|impossible|therefore it cannot' +
               '|concordance|reproduces the|matches the (table|count|census|register)|same population|corresponds to|checked against)'

    $tick  = [char]96      # backtick  - code/file reference
    $arrow = [char]0x2192  # right arrow - command output
    $evidRx = '(?i)(' + [regex]::Escape($tick) + '|:\d+|' + [regex]::Escape($arrow) +
              '|MEASURED|UNPROVEN|HYPOTHESIS|ASSUMED|UNVERIFIED|WITHDRAWN|I ran|I read|re-ran|reran|' +
              'verified at (this|my) desk|read the (loop|line|file|source|executable))'

    $bad = @()
    foreach ($s in $sentences) {
        if (($s -match $claimRx) -and ($s -notmatch $evidRx)) {
            $t = ($s -replace '\s+', ' ').Trim()
            if ($t.Length -gt 140) { $t = $t.Substring(0, 140) + '...' }
            if ($t) { $bad += $t }
        }
    }
    if ($bad.Count -eq 0) { exit 0 }

    $list = ($bad | Select-Object -First 3) -join "`n    - "
    $msg = "ruling-mechanism guard BLOCKED this ledger write: a MECHANISM claim with no" + "`n" +
           "evidence attached in the same sentence." + "`n`n" +
           "    - " + $list + "`n`n" +
           "A mechanism claim states HOW something works (by construction / cannot happen /" + "`n" +
           "is excluded / guaranteed). Attach ONE of, in the SAME sentence:" + "`n" +
           "  * the executable line or file:line you actually read (backticks or path:NN)" + "`n" +
           "  * the command and its result" + "`n" +
           "  * an explicit grade: MEASURED / HYPOTHESIS / UNPROVEN / ASSUMED" + "`n`n" +
           "WHY THIS IS A GATE (2026-07-28, measured): R-390 asserted a pass-1 failure was" + "`n" +
           "'excluded by construction'. The PASS 2 loop filters nothing - the sentence was" + "`n" +
           "invented, and it would have taught the next reader to wave off a live alarm." + "`n" +
           "A wrong number gets corrected; a wrong mechanism gets obeyed. Label it a" + "`n" +
           "hypothesis, or go read the line."
    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    exit 0
}
