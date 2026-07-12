param(
  [string]$Distro = "Ubuntu-22.04",
  [string]$RunnerDir = "~/actions-runner",
  [string]$TaskName = "TF-CI-Runner"
)

$ErrorActionPreference = "Stop"
$Wsl = (Get-Command wsl.exe).Source
& $Wsl -d $Distro -- bash -lc "test -x $RunnerDir/run.sh"
if ($LASTEXITCODE -ne 0) {
  throw "GitHub runner is not installed at $RunnerDir inside $Distro"
}

$Action = New-ScheduledTaskAction `
  -Execute $Wsl `
  -Argument "-d $Distro -- bash -lc 'cd $RunnerDir && exec ./run.sh'"
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Force | Out-Null

$Info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
Write-Host "Registered $TaskName for $Distro. Last result: $($Info.LastTaskResult)"
