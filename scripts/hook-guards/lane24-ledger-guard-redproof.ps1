# LANE 24 red-proof harness (R-694 §5).
#
# Drives the two hook scripts as what they are: pure stdin-JSON -> exit-code
# functions. Runs against COPIES with an ISOLATED $env:USERPROFILE, so the live
# advisor sentinel is never read, written, or deleted -- a sibling advisor seat is
# publishing rulings in this same minute.
#
# R-694 §5: "ONE FIXTURE THAT CAN FAIL FOR TWO REASONS IS NOT A CONTROL FOR EITHER"
# -> mechanism A and mechanism B get separate fixtures, and the ORIGINAL protection
# gets its own positive fixture so the repair cannot pass by simply not gating.

param(
    [Parameter(Mandatory = $true)][string]$GuardPath,
    [Parameter(Mandatory = $true)][string]$ReceiptPath,
    [Parameter(Mandatory = $true)][string]$Label
)

$ErrorActionPreference = 'Stop'
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) "lane24-sandbox"
$sentinel = Join-Path $sandbox '.claude\.advisor-ruling-invoked'

function Reset-Sandbox([bool]$armed) {
    if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $sandbox '.claude') -Force | Out-Null
    if ($armed) {
        [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() | Set-Content -Path $sentinel -Encoding ascii
    }
}

function Invoke-Hook([string]$script, [string]$json) {
    $prev = $env:USERPROFILE
    $env:USERPROFILE = $sandbox
    # PS 5.1 wraps a native exe's stderr in ErrorRecords and, under
    # ErrorActionPreference='Stop', turns the guard's own BLOCK message into a
    # terminating error -- i.e. the instrument would die on exactly the case it
    # exists to observe. Never redirect the child's stderr here.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # PowerShell has no `<` redirection; pipe the JSON to the child's stdin.
        $out = $json | & powershell -NoProfile -ExecutionPolicy Bypass -File $script
        $code = $LASTEXITCODE
        return @{ exit = $code; out = ($out -join "`n") }
    }
    finally { $env:USERPROFILE = $prev; $ErrorActionPreference = $prevEAP }
}

function BashJson([string]$cmd) {
    $o = [ordered]@{ tool_name = 'Bash'; tool_input = [ordered]@{ command = $cmd } }
    return ($o | ConvertTo-Json -Depth 6 -Compress)
}

# ── The exact shape that blocked AR-770: a WORKER report whose PROSE quotes both
#    tokens, while the command itself only writes AGENT-REPORTS.md. ──────────────
# FAITHFUL to what actually blocked AR-770: the two tokens were on DIFFERENT lines
# of the heredoc body ("explicit-path commits (git commit -o)" in one paragraph,
# "touch ADVISOR-RULINGS.md" in the NOT-DOING list). Reconstructed from the report,
# not invented -- my first version put both on ONE line, which is a strictly harder
# case the observed defect never presented, and it made a correct repair read as
# broken. A FIXTURE THAT IS NOT THE OBSERVED SHAPE TESTS A DEFECT NOBODY HAS.
$quotationOnly = @'
cat > /tmp/ar.md <<'ENDOFAR'
I will use explicit-path commits (git commit -o) and run no index-wide operation.
NOT DOING: start handoff 5, or touch ADVISOR-RULINGS.md.
ENDOFAR
python -c "splice('docs/designs/AGENT-REPORTS.md')"
'@

# HARDER VARIANT, reported separately and NOT claimed as fixed: both tokens on ONE
# line, e.g. a commit message that says "never git commit ADVISOR-RULINGS.md from a
# worker seat". Per-line matching cannot separate this from a real publish; only
# stripping quoted/heredoc regions can.
$quotationSameLine = 'git commit -o docs/designs/AGENT-REPORTS.md -m "worker seats never git commit ADVISOR-RULINGS.md"'

$genuineLedgerCommit = 'git commit -o docs/designs/ADVISOR-RULINGS.md -m "R-999: a real ruling"'
$workerCommit = 'git commit -o docs/designs/AGENT-REPORTS.md -m "AR-999: a worker report"'

$results = @()
function Record($id, $desc, $expected, $actual, $mechanism) {
    $pass = ($expected -eq $actual)
    $script:results += [pscustomobject]@{
        ID = $id; MECH = $mechanism; EXPECTED = $expected; ACTUAL = $actual
        VERDICT = $(if ($pass) { 'ok' } else { 'RED' }); WHAT = $desc
    }
}

Write-Output "=================== $Label ==================="

# ─── MECHANISM A — the guard cannot tell an action from a quotation of one ───
Reset-Sandbox $false
$r = Invoke-Hook $GuardPath (BashJson $quotationOnly)
Record 'A1' 'quotation-only worker write (AR-770 shape) must PASS' 0 $r.exit 'A'

Reset-Sandbox $false
$r = Invoke-Hook $GuardPath (BashJson $workerCommit)
Record 'A2' 'plain worker commit, no ledger token at all, must PASS' 0 $r.exit 'A-control'

Reset-Sandbox $false
$r = Invoke-Hook $GuardPath (BashJson $quotationSameLine)
Record 'A5' 'HARDER: quotation on the SAME line as a real commit verb, must PASS' 0 $r.exit 'A-harder'

# ─── THE ORIGINAL PROTECTION — must still bite after any repair ───
Reset-Sandbox $false
$r = Invoke-Hook $GuardPath (BashJson $genuineLedgerCommit)
Record 'A3' 'GENUINE ledger commit, sentinel ABSENT, must BLOCK' 2 $r.exit 'A-protection'

Reset-Sandbox $true
$r = Invoke-Hook $GuardPath (BashJson $genuineLedgerCommit)
Record 'A4' 'GENUINE ledger commit, sentinel FRESH, must PASS' 0 $r.exit 'A-protection'

# ─── MECHANISM B — a write that never happened must not consume the sentinel ───
# The receipt never inspects any success/exit field (measured: 0 occurrences of
# tool_response|tool_result|exit_code across every hook), so PostToolUse after a
# FAILED command consumes exactly as it does after a successful one.
Reset-Sandbox $true
$failedJson = '{"tool_name":"Bash","tool_input":{"command":' + (ConvertTo-Json $genuineLedgerCommit) + '},"tool_response":{"exit_code":1,"stderr":"error: pathspec did not match any file(s) known to git"}}'
$null = Invoke-Hook $ReceiptPath $failedJson
$survived = Test-Path $sentinel
Record 'B1' 'FAILED ledger commit must NOT consume the sentinel' $true $survived 'B'

Reset-Sandbox $true
$okJson = '{"tool_name":"Bash","tool_input":{"command":' + (ConvertTo-Json $genuineLedgerCommit) + '},"tool_response":{"exit_code":0,"stdout":"1 file changed"}}'
$null = Invoke-Hook $ReceiptPath $okJson
$consumed = -not (Test-Path $sentinel)
Record 'B2' 'SUCCESSFUL ledger commit must consume (disarm preserved)' $true $consumed 'B-protection'

Reset-Sandbox $true
$null = Invoke-Hook $ReceiptPath (BashJson $quotationOnly)
$survivedQuote = Test-Path $sentinel
Record 'B3' 'quotation-only command must NOT consume the sentinel' $true $survivedQuote 'B'

$results | Format-Table -AutoSize | Out-String | Write-Output
$red = @($results | Where-Object { $_.VERDICT -eq 'RED' })
Write-Output "RED: $($red.Count) / $($results.Count)   [$(($red | ForEach-Object { $_.ID }) -join ', ')]"
if (Test-Path $sandbox) { Remove-Item $sandbox -Recurse -Force }
