<#
  WORKER-1 SEAT LAUNCHER -- AR-1271A sec 4.

  WHY THIS EXISTS
    Three consecutive Worker-1 seats were NOT bound to the Worker-1 guard. The cause was never
    the worktree's configuration, which GPT independently verified correct in AR-1271 sec 6. The
    cause is that Claude Code resolves its hook binding from the LAUNCH DIRECTORY, and the
    Desktop shortcut hard-codes `Set-Location 'C:\Users\tonio\Projects\trading-forge'` -- a
    container folder with no `.git` at all. Registration lives in the worktree; binding lives in
    the launch directory. A correct worktree cannot fix a wrong launch directory.

    AR-1271A sec 1 then rejected the obvious workaround: the operator is NOT the bootstrap. He must
    not type `cd`, must not inspect hook text, and must not decide whether a seat is safe enough
    to spend a one-shot authorization. This script is that missing mechanism.

  FAIL CLOSED
    Every check below refuses to start Claude rather than starting an unbound seat. An unbound
    seat is the dangerous outcome, not an inconvenient one: it looks completely normal from the
    inside, and the next thing it is asked to do is spend a NON-RENEWABLE authorization.
    `AN UNARMED GUARD AND A PERMISSIVE ONE LOOK IDENTICAL.`

  ZERO AGENT CALLS
    Nothing here dispatches a subagent. The arm witness is the registered SessionStart hook
    command run directly, which is why it costs nothing from the frozen budget (AR-1271A sec 4.4).

  This script assumes only its OWN location. The canonical worktree is resolved by the caller
  (see install_worker1_seat_shortcut.ps1) so no dated path is baked in here.
#>

#   -CheckOnly runs every check and reports, but does NOT start Claude. It exists so the
#   pre-flight can be red-proofed against a deliberately broken tree without seating anything.
#   A guard whose refusal path has never been observed is not yet an instrument.
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$Worktree = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.ArrayList

function Refuse([string]$check, [string]$detail) {
  [void]$failures.Add("[$check] $detail")
}

Write-Host ''
Write-Host '  WORKER-1 SEAT -- pre-flight' -ForegroundColor Cyan
Write-Host "  worktree: $Worktree"
Write-Host ''

# --- C1/C2: worktree identity -------------------------------------------------------------
$branch = $null
try {
  $inside = & git -C $Worktree rev-parse --is-inside-work-tree
  if ($inside -ne 'true') { Refuse 'C1 repo' "not a git work tree: $Worktree" }
  else {
    $branch = (& git -C $Worktree rev-parse --abbrev-ref HEAD).Trim()
    if ($branch -notlike 'claude/worker1-*') {
      Refuse 'C2 branch' "branch is '$branch', expected claude/worker1-*"
    }
  }
} catch {
  Refuse 'C1 repo' "git could not read $Worktree ($($_.Exception.Message))"
}

# --- C3: the guard is REGISTERED, with an Agent-bearing PreToolUse matcher ------------------
# Registration is not binding, but its ABSENCE is proof of non-binding, and it is free to check.
$settingsPath = Join-Path $Worktree '.claude\settings.json'
if (-not (Test-Path $settingsPath)) {
  Refuse 'C3 settings' "missing $settingsPath"
} else {
  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  $events = @('SessionStart', 'PreToolUse')
  foreach ($ev in $events) {
    $groups = $settings.hooks.$ev
    if (-not $groups) { Refuse 'C3 settings' "no $ev hook registered"; continue }
    $guarded = $false
    foreach ($g in $groups) {
      foreach ($h in $g.hooks) {
        if ($h.command -match 'claude_guard_hook') { $guarded = $true }
      }
      if ($ev -eq 'PreToolUse' -and $g.matcher -notmatch 'Agent') {
        Refuse 'C3 settings' "PreToolUse matcher '$($g.matcher)' does not cover Agent"
      }
    }
    if (-not $guarded) { Refuse 'C3 settings' "$ev does not route through claude_guard_hook" }
  }
}

# --- C4: the doorway the settings name actually exists --------------------------------------
$doorway = Join-Path $Worktree 'scripts\claude_guard_hook.mjs'
if (-not (Test-Path $doorway)) { Refuse 'C4 doorway' "missing $doorway" }

# --- C5: ARM WITNESS -- observe the guard decide, do not infer it from its inputs -------------
# Piped on stdin deliberately: a scratch file inside the worktree would be UNTRACKED, and an
# untracked file is exactly what SessionStart refuses to start on.
$manifest = Join-Path $Worktree '.claude\worker1-hook-guard-manifest.json'
if (-not (Test-Path $manifest)) {
  Refuse 'C5 arm' "missing guard manifest $manifest"
} elseif ($failures.Count -eq 0) {
  $payload = '{"hook_event_name":"SessionStart","source":"startup"}'
  # MEASURED 2026-08-16: `$payload | & node ...` prepended a UTF-8 BOM to stdin, so the guard
  # received BOM + '{...}', died on invalid JSON, and the launcher refused for a reason that had
  # nothing to do with the guard's state. Setting $OutputEncoding did NOT fix it -- PowerShell's
  # native-pipe encoder is not the only layer involved. So the pipe is removed entirely and the
  # exact bytes are written to the child's stdin stream.
  # `A FAIL-CLOSED REFUSAL FOR THE WRONG REASON STILL READS AS A REFUSAL.`
  # `PREFER THE FORM WITH FEWEST LAYERS BETWEEN YOU AND THE THING.`
  # MEASURED: the BOM is written when Process.StandardInput is first ACCESSED, so writing raw
  # bytes to .BaseStream does not avoid it and neither does closing BaseStream instead of the
  # writer -- all three variants delivered 37 bytes beginning EF BB BF where 34 were written.
  # cmd.exe performs the redirect itself, so no .NET StreamWriter exists to emit a preamble.
  # The payload lives in TEMP, never in the worktree: an untracked file there blocks SessionStart.
  $payloadFile = Join-Path $env:TEMP 'worker1_seat_armprobe.json'
  [System.IO.File]::WriteAllText($payloadFile, $payload, (New-Object System.Text.ASCIIEncoding))
  # The probe MUST run with the worktree as cwd. The guard resolves its repo with
  # `git rev-parse --show-toplevel`, and Claude Code fires SessionStart with the project dir as
  # cwd -- so probing from anywhere else measures a different tree. MEASURED: probing from the
  # container answered "not a git repository", which is the same decoy that caused this whole
  # defect. `MEASURED IS NOT MEASURED-WHERE-IT-RUNS.`
  Push-Location $Worktree
  try {
    $armed = & cmd.exe /c "node `"$doorway`" --manifest `"$manifest`" < `"$payloadFile`" 2>&1"
  } finally {
    Pop-Location
    Remove-Item $payloadFile -ErrorAction SilentlyContinue
  }
  $armedText = ($armed | Out-String).Trim()
  if ($armedText -match 'anchor verified') {
    Write-Host '  guard  : ARMED' -ForegroundColor Green
    Write-Host "           $armedText"
  } else {
    Refuse 'C5 arm' "guard did not arm. It answered: $armedText"
  }
}

# --- C6: frozen control plane is untouched (read-only; AR-1271A sec 5 no-spend proof) -----------
if ($failures.Count -eq 0) {
  $queue = Join-Path $Worktree 'docs\replay-results\svkm-extraction-certified\grade\opus-v2\isolated_fallback_queue_t1.json'
  $receipts = Join-Path $Worktree 'docs\replay-results\svkm-extraction-certified\grade\opus-v2\isolated-receipts-t1'
  if (Test-Path $queue) {
    $sha = (Get-FileHash $queue -Algorithm SHA256).Hash.ToLower()
    $q = Get-Content $queue -Raw | ConvertFrom-Json
    $spent = @($q.attempts.PSObject.Properties).Count
    $extra = @(Get-ChildItem $receipts -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'README.md' })
    Write-Host "  frozen : $(@($q.queue).Count) queued / $spent spent | receipts+$($extra.Count) | sha $($sha.Substring(0,12))"
    if ($spent -ne 0 -or $extra.Count -ne 0) {
      Write-Host '  NOTE   : frozen plane is NOT pristine -- report this before spending anything.' -ForegroundColor Yellow
    }
  }
}

# --- Decision --------------------------------------------------------------------------------
if ($failures.Count -gt 0) {
  Write-Host ''
  Write-Host '  WORKER-1 SEAT REFUSED TO START.' -ForegroundColor Red
  Write-Host '  This is an engineering fault, not something to fix by hand.' -ForegroundColor Red
  Write-Host ''
  foreach ($f in $failures) { Write-Host "    $f" -ForegroundColor Red }
  Write-Host ''
  Write-Host '  Start Claude normally and paste the lines above. Do not run the Worker-1'
  Write-Host '  onboarding until this reports ARMED -- an unbound seat cannot do Worker-1 work'
  Write-Host '  and must never spend the one-shot calibration.'
  Write-Host ''
  exit 1
}

if ($CheckOnly) {
  Write-Host ''
  Write-Host "  seat OK -- branch $branch. (-CheckOnly: not starting Claude.)" -ForegroundColor Green
  Write-Host ''
  exit 0
}

Write-Host ''
Write-Host "  seat OK -- branch $branch. Starting Claude in the governed worktree." -ForegroundColor Green
Write-Host ''
Set-Location $Worktree
claude
