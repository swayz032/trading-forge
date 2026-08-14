[CmdletBinding()]
param(
    [switch] $Describe,
    [string] $InstallDirectory = 'C:\Users\tonio\bin\watchdogs'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'TF-ApiLivenessWatchdog'
$SourceScript = Join-Path $PSScriptRoot 'api-liveness-watchdog.ps1'
$InstalledScript = Join-Path $InstallDirectory 'api-liveness-watchdog.ps1'
$PowerShellExe = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path $PowerShellExe)) { $PowerShellExe = 'powershell.exe' }
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$InstalledScript`""

$Descriptor = [ordered]@{
    taskName = $TaskName
    intervalMinutes = 5
    userId = 'SYSTEM'
    runLevel = 'Highest'
    execute = $PowerShellExe
    arguments = $Arguments
    sourceScriptPath = $SourceScript
    installedScriptPath = $InstalledScript
}

if ($Describe) {
    $Descriptor | ConvertTo-Json -Compress
    exit 0
}

$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator rights are required to register the LocalSystem watchdog task.'
}
if (-not (Test-Path $SourceScript)) { throw "Watchdog source not found: $SourceScript" }

New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Copy-Item -LiteralPath $SourceScript -Destination $InstalledScript -Force

$TaskCommand = "`"$PowerShellExe`" $Arguments"
& schtasks.exe /Create /TN $TaskName /TR $TaskCommand /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks.exe failed with exit code $LASTEXITCODE" }

$Registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$Info = $Registered | Get-ScheduledTaskInfo
[ordered]@{
    registered = $true
    taskName = $TaskName
    state = [string]$Registered.State
    nextRunTime = $Info.NextRunTime.ToString('o')
    installedScriptPath = $InstalledScript
} | ConvertTo-Json -Compress
