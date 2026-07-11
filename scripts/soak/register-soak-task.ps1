# scripts/soak/register-soak-task.ps1 — idempotent Task Scheduler registration for the nightly soak.
# The script FILE may live in an isolated worktree (frozen) while WorkingDirectory points at the
# MAIN checkout so .env + data/soak resolve to the live tree. Re-run with new -ScriptPath after landing.
param(
  [string]$ScriptPath = "C:\Users\tonio\Projects\trading-forge\wt-soak\scripts\soak\soak-watcher.cjs",
  [string]$WorkingDir = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$TaskName   = "TF-Tower-Soak",
  [string]$At         = "3:00AM"
)
$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
if (-not (Test-Path $ScriptPath)) { throw "watcher not found: $ScriptPath" }
if (-not (Test-Path $WorkingDir)) { throw "working dir not found: $WorkingDir" }

$Action   = New-ScheduledTaskAction -Execute $Node -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger  = New-ScheduledTaskTrigger -Daily -At $At
# StartWhenAvailable: a missed 3AM (tower asleep) runs at wake. 7h limit kills a hung watcher.
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 7) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null

$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered '$TaskName' @ $At tower-local."
Write-Host "  Script:      $ScriptPath"
Write-Host "  WorkingDir:  $WorkingDir"
Write-Host "  Next run:    $($info.NextRunTime)"
