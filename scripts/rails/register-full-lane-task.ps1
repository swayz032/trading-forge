# scripts/rails/register-full-lane-task.ps1 — idempotent Task Scheduler registration for the
# nightly rails FULL lane. Mirrors register-soak-task.ps1. Script file may live in a frozen
# worktree while WorkingDir points at the MAIN checkout so .env + data/rails resolve live.
param(
  [string]$ScriptPath = "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\rails\full-lane.cjs",
  [string]$WorkingDir = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$TaskName   = "TF-Rails-Full-Lane",
  [string]$At         = "10:00PM"
)
$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
if (-not (Test-Path $ScriptPath)) { throw "full-lane not found: $ScriptPath" }
if (-not (Test-Path $WorkingDir)) { throw "working dir not found: $WorkingDir" }
$Action   = New-ScheduledTaskAction -Execute $Node -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger  = New-ScheduledTaskTrigger -Daily -At $At
# 22:00 is well clear of the soak's 03:00-09:00 window. 90-min cap kills a hung lane before soak.
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 90) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered '$TaskName' @ $At tower-local. Next run: $($info.NextRunTime)"
