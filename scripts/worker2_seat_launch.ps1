<#
  WORKER-2 SEAT LAUNCHER -- mirrors scripts/worker1_seat_launch.ps1 (AR-1271A sec 4).

  UPDATED 2026-08-18 (Phase D/E of the two-worker activation): Worker-2 now has its own native
  hook guard (.claude/worker2-hook-guard-manifest.json, same pinned toolbox Worker-1 uses,
  bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198 -- zero changes to the shared law). This launcher now
  arm-witnesses it the same way Worker-1's does: observe the guard actually decide, do not infer
  it from its inputs.

  UPDATED 2026-08-18 (operator decision): now passes --dangerously-skip-permissions, same as
  Worker-1. The underlying guard mechanism is byte-identical to Worker-1's (zero changes to the
  pinned toolbox, bbf2e6c2e9ae39a7f0f2be182c9046165eb4b198) -- only the manifest (session_anchor +
  edit_scope data) is new to this branch, and it was control-tested before this flag was added:
  arm witness + 2 positive + 6 negative controls (Worker-1-owned-path BLOCK, unarmed-session DENY,
  out-of-scope-in-lane DENY, self-protected-surface DENY, wrong-branch STOP, wrong-worktree STOP),
  all correct. Same division of labour as Worker-1: this flag removes the OPERATOR prompt, it does
  not remove the GUARD -- a guard deny still blocks the tool call with the guard's own reason, and
  this launcher still REFUSES to reach the launch line unless C5 observed the guard actually arm.

  This script assumes only its own location, same as Worker-1's launcher.
#>

param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$Worktree = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.ArrayList

function Refuse([string]$check, [string]$detail) {
  [void]$failures.Add("[$check] $detail")
}

Write-Host ''
Write-Host '  WORKER-2 SEAT -- pre-flight' -ForegroundColor Cyan
Write-Host "  worktree: $Worktree"
Write-Host ''

# --- C1/C2: worktree identity -------------------------------------------------------------
$branch = $null
try {
  $inside = & git -C $Worktree rev-parse --is-inside-work-tree
  if ($inside -ne 'true') { Refuse 'C1 repo' "not a git work tree: $Worktree" }
  else {
    $branch = (& git -C $Worktree rev-parse --abbrev-ref HEAD).Trim()
    if ($branch -notlike 'claude/worker2-*') {
      Refuse 'C2 branch' "branch is '$branch', expected claude/worker2-*"
    }
  }
} catch {
  Refuse 'C1 repo' "git could not read $Worktree ($($_.Exception.Message))"
}

# --- C3: onboarding skill present (identity package) -----------------------------------------
$skill = Join-Path $Worktree '.claude\skills\worker-2-paper-runtime-onboarding\SKILL.md'
if (-not (Test-Path $skill)) { Refuse 'C3 identity' "missing $skill" }

# --- C4: guard registered + doorway present ---------------------------------------------------
$settingsPath = Join-Path $Worktree '.claude\settings.json'
$manifest = Join-Path $Worktree '.claude\worker2-hook-guard-manifest.json'
$doorway = Join-Path $Worktree 'scripts\claude_guard_hook.mjs'
if (-not (Test-Path $settingsPath)) { Refuse 'C4 settings' "missing $settingsPath" }
if (-not (Test-Path $manifest)) { Refuse 'C4 manifest' "missing $manifest" }
if (-not (Test-Path $doorway)) { Refuse 'C4 doorway' "missing $doorway" }

# --- C5: ARM WITNESS -- observe the guard decide, do not infer it from its inputs -------------
if ($failures.Count -eq 0) {
  $probeSession = 'seat-armprobe-w2'
  $payload = '{"hook_event_name":"SessionStart","source":"startup","session_id":"' + $probeSession + '"}'
  $payloadFile = Join-Path $env:TEMP 'worker2_seat_armprobe.json'
  [System.IO.File]::WriteAllText($payloadFile, $payload, (New-Object System.Text.ASCIIEncoding))
  Push-Location $Worktree
  try {
    $armed = & cmd.exe /c "node `"$doorway`" --manifest `"$manifest`" < `"$payloadFile`" 2>&1"
  } finally {
    Pop-Location
    Remove-Item $payloadFile -ErrorAction SilentlyContinue
  }
  $armedText = ($armed | Out-String).Trim()

  try {
    $probeGitDir = (& git -C $Worktree rev-parse --absolute-git-dir).Trim()
    Remove-Item (Join-Path $probeGitDir "tf-claude-guard-session-$probeSession.json") -ErrorAction SilentlyContinue
  } catch { }

  if ($armedText -match 'STOP' -or $armedText -match 'could not be armed') {
    Refuse 'C5 arm' "guard REFUSED to arm. It answered: $armedText"
  } elseif ($armedText -match 'anchor verified') {
    Write-Host '  guard  : ARMED' -ForegroundColor Green
    Write-Host "           $armedText"
  } else {
    Refuse 'C5 arm' "guard did not arm. It answered: $armedText"
  }
}

Write-Host '  NOTE   : collision boundaries beyond this worktree/branch/edit-scope are still' -ForegroundColor Yellow
Write-Host '           DOCTRINE (ownership-collision-matrix.yaml, Claude Lead), not machine-' -ForegroundColor Yellow
Write-Host '           enforced. The guard enforces THIS worker''s own scope and self-protection.' -ForegroundColor Yellow

# --- Decision --------------------------------------------------------------------------------
if ($failures.Count -gt 0) {
  Write-Host ''
  Write-Host '  WORKER-2 SEAT REFUSED TO START.' -ForegroundColor Red
  Write-Host ''
  foreach ($f in $failures) { Write-Host "    $f" -ForegroundColor Red }
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
Write-Host '  Run /worker-2-paper-runtime-onboarding once seated.' -ForegroundColor Green
Write-Host ''
Set-Location $Worktree

# --dangerously-skip-permissions: the operator is not the permission pipeline. This is only safe
# because the launcher REFUSED to reach this line unless C5 observed the guard actually arm --
# same reasoning as worker1_seat_launch.ps1, same underlying guard code.
claude --dangerously-skip-permissions
