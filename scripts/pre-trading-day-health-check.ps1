<#
.SYNOPSIS
    Trading Forge — Pre-Trading-Day Health Check (W17 / C8)

.DESCRIPTION
    Validates the local Skytech environment before the U.S. cash session opens.
    Runs as part of the 8:00 AM ET cron in src/server/scheduler.ts. The Node
    cron parses the exit code; on any non-zero result the pipeline is paused
    (fail-CLOSED) and a critical alert fires.

    April 2026 KB5082063 was the most recent forced-reboot event on Windows
    Server 2025. The same pattern recurred in April 2024 and April 2025. A
    forced reboot during market hours kills active positions and can cause
    catastrophic gap-up losses on short ES.

.OUTPUTS
    Exit code:
       0  = healthy (all 5 checks passed)
       1  = pending Windows reboot detected
       2  = failed Windows updates detected
       3  = service degraded (Node/Python down OR low disk OR high RAM)
      99  = script error (caller should treat as fail-CLOSED)

    Structured JSON written to stdout — Node parses for telemetry.

.PARAMETER MinFreeDiskGB
    Minimum free space on C: in GB. Default 10.

.PARAMETER MaxRamUsedPct
    Maximum RAM utilization percent. Default 80.

.PARAMETER NodeProcessName
    Process name for Trading Forge Node service. Default "node".

.PARAMETER PythonProcessName
    Process name for Trading Forge Python engine. Default "python".

.PARAMETER SkipServiceCheck
    Skip Node/Python process health check. Use for cold-boot diagnostics
    when services are intentionally down.

.EXAMPLE
    pwsh -NoProfile -File .\pre-trading-day-health-check.ps1
    pwsh -NoProfile -File .\pre-trading-day-health-check.ps1 -SkipServiceCheck

.NOTES
    Author:   Trading Forge / W17 Team A
    Runbook:  infra/windows-update-policy.md
    Pairs with: src/server/scheduler.ts pre-trading-day-health-check cron
#>

[CmdletBinding()]
param(
    [int]$MinFreeDiskGB = 10,
    [int]$MaxRamUsedPct = 80,
    [string]$NodeProcessName = "node",
    [string]$PythonProcessName = "python",
    [switch]$SkipServiceCheck
)

# Force non-interactive — never prompt for input during a cron run.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Result accumulator. Each check appends a structured record.
$results = [System.Collections.ArrayList]@()
$exitCode = 0

function Add-Result {
    param(
        [string]$Check,
        [string]$Status,        # 'pass' | 'fail' | 'warn' | 'skip'
        [string]$Detail,
        [hashtable]$Data = @{}
    )
    [void]$results.Add([pscustomobject]@{
        check  = $Check
        status = $Status
        detail = $Detail
        data   = $Data
    })
}

# ─── Check 1: Pending Windows Reboot ────────────────────────────────
# Multiple registry keys signal a pending reboot. Any one of them being
# present is sufficient to defer trading. Fail-CLOSED on read errors.
function Test-PendingReboot {
    $rebootKeys = @(
        @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'; Reason = 'CBS RebootPending' }
        @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'; Reason = 'WindowsUpdate RebootRequired' }
        @{ Path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\PackagesPending'; Reason = 'CBS PackagesPending' }
    )

    $signals = @()
    foreach ($k in $rebootKeys) {
        try {
            if (Test-Path -LiteralPath $k.Path) {
                $signals += $k.Reason
            }
        } catch {
            # If we can't even read the registry, treat as pending (fail-closed).
            $signals += "registry-read-error: $($k.Path)"
        }
    }

    # Pending file rename = files locked by an in-progress install waiting on reboot.
    try {
        $pendingFileRename = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue
        if ($null -ne $pendingFileRename -and $null -ne $pendingFileRename.PendingFileRenameOperations) {
            $signals += 'PendingFileRenameOperations'
        }
    } catch {
        # Non-fatal — key may not exist.
    }

    # CCM also writes a flag if a system update has armed a reboot.
    try {
        $ccm = Invoke-CimMethod -Namespace 'ROOT\ccm\ClientSDK' -ClassName 'CCM_ClientUtilities' -MethodName 'DetermineIfRebootPending' -ErrorAction SilentlyContinue
        if ($ccm -and ($ccm.RebootPending -or $ccm.IsHardRebootPending)) {
            $signals += "CCM RebootPending=$($ccm.RebootPending) HardRebootPending=$($ccm.IsHardRebootPending)"
        }
    } catch {
        # CCM not installed on most workstations — ignore.
    }

    if ($signals.Count -gt 0) {
        Add-Result -Check 'pending_reboot' -Status 'fail' -Detail "Reboot pending: $($signals -join '; ')" -Data @{ signals = $signals }
        return $false
    }
    Add-Result -Check 'pending_reboot' -Status 'pass' -Detail 'No pending reboot signals'
    return $true
}

# ─── Check 2: Failed Windows Updates ─────────────────────────────────
# Last 24h of WindowsUpdateClient event log. Event ID 20 = update failure,
# Event ID 25 = installation failed. Avoids PSWindowsUpdate dependency.
function Test-FailedUpdates {
    $cutoff = (Get-Date).AddHours(-24)
    try {
        $failures = Get-WinEvent -FilterHashtable @{
            LogName   = 'System'
            ProviderName = 'Microsoft-Windows-WindowsUpdateClient'
            Id        = @(20, 25)
            StartTime = $cutoff
        } -ErrorAction SilentlyContinue

        if ($failures -and $failures.Count -gt 0) {
            $messages = $failures | Select-Object -First 3 | ForEach-Object { $_.Message -replace '\s+', ' ' } | ForEach-Object {
                if ($_.Length -gt 200) { $_.Substring(0, 200) + '...' } else { $_ }
            }
            Add-Result -Check 'failed_updates' -Status 'fail' -Detail "$($failures.Count) update failure(s) in last 24h" -Data @{
                count    = $failures.Count
                messages = $messages
            }
            return $false
        }
        Add-Result -Check 'failed_updates' -Status 'pass' -Detail 'No update failures in last 24h'
        return $true
    } catch {
        # Event log read failure → soft-pass with warning. We don't want to
        # block trading because of a quirky log permission issue, but we want
        # the operator to know we couldn't verify.
        Add-Result -Check 'failed_updates' -Status 'warn' -Detail "Could not read WindowsUpdateClient log: $($_.Exception.Message)"
        return $true
    }
}

# ─── Check 3: Node + Python Service Health ───────────────────────────
function Test-Services {
    if ($SkipServiceCheck) {
        Add-Result -Check 'services' -Status 'skip' -Detail 'Skipped via -SkipServiceCheck'
        return $true
    }

    $nodeOk = $false
    $pythonOk = $false
    try {
        $nodeProc = Get-Process -Name $NodeProcessName -ErrorAction SilentlyContinue
        $nodeOk = ($null -ne $nodeProc -and $nodeProc.Count -gt 0)
    } catch { $nodeOk = $false }

    try {
        # Python may also run as 'python.exe', 'python3.exe', or 'pythonw.exe'.
        $pythonNames = @($PythonProcessName, 'python3', 'pythonw')
        $pythonProc = Get-Process -Name $pythonNames -ErrorAction SilentlyContinue
        $pythonOk = ($null -ne $pythonProc -and $pythonProc.Count -gt 0)
    } catch { $pythonOk = $false }

    if (-not $nodeOk -or -not $pythonOk) {
        $down = @()
        if (-not $nodeOk)   { $down += 'node' }
        if (-not $pythonOk) { $down += 'python' }
        Add-Result -Check 'services' -Status 'fail' -Detail "Service(s) not running: $($down -join ', ')" -Data @{
            node_running   = $nodeOk
            python_running = $pythonOk
            down           = $down
        }
        return $false
    }
    Add-Result -Check 'services' -Status 'pass' -Detail 'Node + Python processes detected'
    return $true
}

# ─── Check 4: Disk Space (C:) ────────────────────────────────────────
function Test-DiskSpace {
    try {
        $cVol = Get-Volume -DriveLetter C -ErrorAction Stop
        $freeGB = [math]::Round($cVol.SizeRemaining / 1GB, 2)
        if ($freeGB -lt $MinFreeDiskGB) {
            Add-Result -Check 'disk_space' -Status 'fail' -Detail "C: free space $freeGB GB < min $MinFreeDiskGB GB" -Data @{
                free_gb     = $freeGB
                min_free_gb = $MinFreeDiskGB
            }
            return $false
        }
        Add-Result -Check 'disk_space' -Status 'pass' -Detail "C: free space $freeGB GB" -Data @{ free_gb = $freeGB }
        return $true
    } catch {
        Add-Result -Check 'disk_space' -Status 'fail' -Detail "Disk-space check failed: $($_.Exception.Message)"
        return $false
    }
}

# ─── Check 5: RAM Utilization ────────────────────────────────────────
function Test-Ram {
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $totalKB = [double]$os.TotalVisibleMemorySize
        $freeKB  = [double]$os.FreePhysicalMemory
        if ($totalKB -le 0) {
            Add-Result -Check 'ram' -Status 'fail' -Detail 'TotalVisibleMemorySize reported as 0'
            return $false
        }
        $usedPct = [math]::Round((($totalKB - $freeKB) / $totalKB) * 100, 1)
        if ($usedPct -gt $MaxRamUsedPct) {
            Add-Result -Check 'ram' -Status 'fail' -Detail "RAM used $usedPct% > max $MaxRamUsedPct%" -Data @{
                used_pct = $usedPct
                max_pct  = $MaxRamUsedPct
            }
            return $false
        }
        Add-Result -Check 'ram' -Status 'pass' -Detail "RAM used $usedPct%" -Data @{ used_pct = $usedPct }
        return $true
    } catch {
        Add-Result -Check 'ram' -Status 'fail' -Detail "RAM check failed: $($_.Exception.Message)"
        return $false
    }
}

# ─── Run all checks; first failure wins exit code ───────────────────
try {
    $rebootOk   = Test-PendingReboot
    $updatesOk  = Test-FailedUpdates
    $servicesOk = Test-Services
    $diskOk     = Test-DiskSpace
    $ramOk      = Test-Ram

    if (-not $rebootOk) {
        $exitCode = 1
    } elseif (-not $updatesOk) {
        $exitCode = 2
    } elseif (-not $servicesOk -or -not $diskOk -or -not $ramOk) {
        $exitCode = 3
    } else {
        $exitCode = 0
    }
} catch {
    # Unexpected script-level failure → fail-closed.
    Add-Result -Check 'script' -Status 'fail' -Detail "Unexpected error: $($_.Exception.Message)"
    $exitCode = 99
}

# ─── Emit JSON to stdout for the Node cron to parse ─────────────────
$payload = [pscustomobject]@{
    schema_version = 1
    timestamp      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    hostname       = $env:COMPUTERNAME
    exit_code      = $exitCode
    checks         = @($results)
}

# ConvertTo-Json depth covers nested data hashtables.
$payload | ConvertTo-Json -Depth 6 -Compress

exit $exitCode
