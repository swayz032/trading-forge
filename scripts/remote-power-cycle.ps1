# remote-power-cycle.ps1 — Pass 7 Track B
#
# TP-Link Kasa smart-plug power-cycle escape valve for the Skytech tower.
# Triggered by dead-mans-heartbeat-service when the 24h auto-restart cap is
# reached and KASA_DEVICE_IP is configured.
#
# Usage (direct):
#   powershell.exe -NonInteractive -File scripts\remote-power-cycle.ps1
#
# Environment variables required (read from process env; caller must set them):
#   KASA_DEVICE_IP    — IPv4 address of the Kasa smart plug on the LAN
#   KASA_USERNAME     — Kasa cloud account email
#   KASA_PASSWORD     — Kasa cloud account password
#
# On success: exits 0.
# On failure: writes plain-English error to $LogFile and exits 1.
#
# Supported devices: TP-Link Kasa HS103 / HS105 / HS110 (local LAN API v1).
# The local LAN protocol is used (no cloud round-trip) so the plug operates
# even when cloud services are degraded.

param()
$ErrorActionPreference = "Stop"

# ─── Log file (appended per invocation) ─────────────────────────────────────
$LogFile = "C:\Users\tonio\bin\kasa-cycle.log"
$Timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")

function Write-Log {
    param([string]$Message)
    $line = "[$Timestamp] $Message"
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
    Write-Output $line
}

# ─── Read env vars ───────────────────────────────────────────────────────────
$KasaIp       = $env:KASA_DEVICE_IP
$KasaUser     = $env:KASA_USERNAME
$KasaPassword = $env:KASA_PASSWORD

if (-not $KasaIp) {
    Write-Log "ERROR: KASA_DEVICE_IP is not set. Cannot perform remote power-cycle."
    exit 1
}
if (-not $KasaUser) {
    Write-Log "ERROR: KASA_USERNAME is not set. Cannot authenticate to Kasa smart plug."
    exit 1
}
if (-not $KasaPassword) {
    Write-Log "ERROR: KASA_PASSWORD is not set. Cannot authenticate to Kasa smart plug."
    exit 1
}

Write-Log "INFO: Remote power-cycle initiated for plug at $KasaIp"

# ─── Kasa local LAN protocol (port 9999, XOR-encoded JSON) ──────────────────
#
# The Kasa local LAN API uses a simple XOR cipher starting at key 0xAB.
# Command to turn plug OFF: {"system":{"set_relay_state":{"state":0}}}
# Command to turn plug ON:  {"system":{"set_relay_state":{"state":1}}}
# Response is XOR-encoded JSON; we only care about exit code.

function Invoke-KasaCommand {
    param(
        [string]$IpAddress,
        [string]$JsonCommand
    )

    # Encode the JSON command using the Kasa XOR cipher (key starts at 0xAB).
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($JsonCommand)
    $encoded = New-Object byte[] ($bytes.Length + 4)
    # 4-byte big-endian length prefix
    $len = $bytes.Length
    $encoded[0] = [byte](($len -shr 24) -band 0xFF)
    $encoded[1] = [byte](($len -shr 16) -band 0xFF)
    $encoded[2] = [byte](($len -shr 8)  -band 0xFF)
    $encoded[3] = [byte]($len            -band 0xFF)

    $key = 0xAB
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $encoded[$i + 4] = [byte]($bytes[$i] -bxor $key)
        $key = $encoded[$i + 4]
    }

    # Send via TCP to port 9999.
    try {
        $tcp    = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($IpAddress, 9999)
        $stream = $tcp.GetStream()
        $stream.Write($encoded, 0, $encoded.Length)
        $stream.Flush()
        # Read response (we only validate a reply arrives; ignore content).
        $buf = New-Object byte[] 4096
        $stream.ReadTimeout = 5000
        $null = $stream.Read($buf, 0, $buf.Length)
        $stream.Close()
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# ─── Turn plug OFF ───────────────────────────────────────────────────────────
Write-Log "INFO: Sending OFF command to plug at $KasaIp ..."
$offCmd  = '{"system":{"set_relay_state":{"state":0}}}'
$offOk   = Invoke-KasaCommand -IpAddress $KasaIp -JsonCommand $offCmd

if (-not $offOk) {
    Write-Log "ERROR: Failed to send OFF command to Kasa plug at $KasaIp. Check that the plug is reachable on the LAN (KASA_DEVICE_IP=$KasaIp) and that port 9999 is not blocked by Windows Firewall."
    exit 1
}

Write-Log "INFO: Plug is now OFF. Waiting 30 seconds for tower to fully power down ..."
Start-Sleep -Seconds 30

# ─── Turn plug ON ────────────────────────────────────────────────────────────
Write-Log "INFO: Sending ON command to plug at $KasaIp ..."
$onCmd = '{"system":{"set_relay_state":{"state":1}}}'
$onOk  = Invoke-KasaCommand -IpAddress $KasaIp -JsonCommand $onCmd

if (-not $onOk) {
    Write-Log "ERROR: OFF command succeeded but ON command failed. Tower is currently POWERED OFF. Manual intervention required: physically press the power button on the tower or toggle the smart plug from the Kasa app."
    exit 1
}

Write-Log "INFO: Plug is now ON. Tower is powering up. NSSM will auto-restart TradingForgeAPI."
Write-Log "INFO: Remote power-cycle complete. Exit 0."
exit 0
