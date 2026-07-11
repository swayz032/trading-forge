param(
  [string]$ScriptPath = "C:\Users\tonio\Projects\trading-forge\trading-forge\scripts\rails\worktree-ttl.cjs",
  [string]$WorkingDir = "C:\Users\tonio\Projects\trading-forge\trading-forge",
  [string]$TaskName = "TF-Rails-WorktreeTTL",
  [string]$At = "10:15AM"
)

$ErrorActionPreference = "Stop"
$Node = (Get-Command node).Source
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Rail script not found: $ScriptPath" }
if (-not (Test-Path -LiteralPath $WorkingDir)) { throw "Working directory not found: $WorkingDir" }

$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$ScriptPath`"" -WorkingDirectory $WorkingDir
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $At
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Force | Out-Null
$Info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered $TaskName. Next run: $($Info.NextRunTime)"
