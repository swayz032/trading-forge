# scripts/rails/register-cert-rig-task.ps1 — idempotent Task Scheduler registration for the Rail 3
# nightly certification rig. Mirrors register-full-lane-task.ps1. Runs at 01:30 (NOT 23:30) so it
# sequences cleanly AFTER the 22:00 full-lane's worst-case finish (22:00 + its 180-min cap = 01:00)
# and BEFORE the soak's 03:00 window: 22:00 full-lane → 01:30 cert-rig → 03:00 soak, single-file,
# all inside the rails window. The rig's own tower-idle guard is the overlap backstop (if the
# full-lane somehow still runs, the rig sees python workers and SKIPs). WorkingDir = MAIN checkout
# so .env + data/rails + the npm invariant checks resolve to the live tree.
param(
  [string]$ScriptPath = "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\rails\cert-rig.cjs",
  [string]$WorkingDir = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$TaskName   = "TF-Rails-Cert-Rig",
  [string]$At         = "1:30AM"
)
$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
if (-not (Test-Path $ScriptPath)) { throw "cert-rig not found: $ScriptPath" }
if (-not (Test-Path $WorkingDir)) { throw "working dir not found: $WorkingDir" }
$Action   = New-ScheduledTaskAction -Execute $Node -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger  = New-ScheduledTaskTrigger -Daily -At $At
# 60-min cap: the invariant battery is fast (npm check scripts, seconds each). Done by ~02:30 worst
# case, clear of the 03:00 soak. StartWhenAvailable runs a missed tick at wake.
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
$info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered '$TaskName' @ $At tower-local. Next run: $($info.NextRunTime)"
