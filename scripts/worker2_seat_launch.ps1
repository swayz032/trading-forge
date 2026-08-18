<#
  WORKER-2 SEAT LAUNCHER -- mirrors scripts/worker1_seat_launch.ps1 (AR-1271A sec 4), minus the
  native-guard arm checks (C3-C6 there), because no native hook guard is installed on the
  Worker-2 branch yet. That is a separate, later, GPT-reviewed packet -- see the activation
  report on 2026-08-18. This script only proves worktree/branch identity and launches Claude in
  the correct directory. It does NOT pass --dangerously-skip-permissions: with no guard bound,
  removing the operator prompt would remove the only check that exists today.

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

# --- C3: onboarding skill present (identity package, not a policy guard) --------------------
$skill = Join-Path $Worktree '.claude\skills\worker-2-paper-runtime-onboarding\SKILL.md'
if (-not (Test-Path $skill)) { Refuse 'C3 identity' "missing $skill" }

Write-Host '  NOTE   : no native PreToolUse/SessionStart guard is installed for Worker 2 yet.' -ForegroundColor Yellow
Write-Host '           Edit-scope and collision boundaries are DOCTRINE (lane-manifest.md,' -ForegroundColor Yellow
Write-Host '           role-overlay.md, ownership-collision-matrix.yaml), not machine-enforced.' -ForegroundColor Yellow

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
claude
