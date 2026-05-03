# Trading Forge — Credential Vault Setup (C6)

Runbook for Bitwarden CLI vault integration. Protects API keys and secrets
from .env file exfiltration — the #1 malware vector for retail trading setups
(Microsoft threat report 2025-2026).

**Cost:** $0. Bitwarden Personal tier is permanently free. CLI is MIT-licensed.
**Hardware required:** None. Software TOTP is sufficient per NIST 800-63B for
this threat model. YubiKey is a future upgrade option, not required.

---

## Table of Contents

1. [Bitwarden CLI Installation](#1-bitwarden-cli-installation)
2. [Vault Initialization](#2-vault-initialization)
3. [Populating Trading Forge Credentials](#3-populating-trading-forge-credentials)
4. [Enabling Vault Mode in Trading Forge](#4-enabling-vault-mode-in-trading-forge)
5. [TOTP Two-Factor Authentication](#5-totp-two-factor-authentication)
6. [IP Whitelisting](#6-ip-whitelisting)
7. [Encrypted Backup Procedure](#7-encrypted-backup-procedure)
8. [Quarterly Rotation Schedule](#8-quarterly-rotation-schedule)
9. [Troubleshooting / Fail-Closed Behavior](#9-troubleshooting--fail-closed-behavior)
10. [Recovery Procedure](#10-recovery-procedure)

---

## 1. Bitwarden CLI Installation

```powershell
# Option A: npm global install (recommended — matches Trading Forge Node environment)
npm install -g @bitwarden/cli

# Option B: winget (Windows native)
winget install Bitwarden.BitwardenCLI

# Verify installation
bw --version
# Expected: 2024.x.x or later
```

Source: https://bitwarden.com/help/cli/ (MIT-licensed, github.com/bitwarden/clients)

---

## 2. Vault Initialization

```powershell
# Login to Bitwarden (opens browser for SSO or enter master password)
bw login

# Unlock the vault — outputs a session token
bw unlock
# Copy the session token from "To unlock your vault, set your session key..."
# Export it for the current shell session:
$env:BW_SESSION = "your-session-token-here"

# Verify the vault is unlocked
bw status
# Expected: { "status": "unlocked", ... }

# Create a folder for Trading Forge credentials
bw create folder '{"name": "TradingForge"}'
# Save the returned folder ID — you will need it for TF_VAULT_FOLDER_ID

# List folders to find the ID if you missed it
bw list folders | ConvertFrom-Json | Where-Object { $_.name -eq "TradingForge" }
```

**Session token duration:** Bitwarden CLI sessions expire after inactivity. Re-run
`$env:BW_SESSION = $(bw unlock --raw)` when the server needs to be restarted. The
BW_SESSION can be set in the shell before launching Trading Forge via PM2/npm.

**For PM2 startup:** set BW_SESSION in the shell before `pm2 start` or use
`ecosystem.config.cjs` env block (never commit the token — rotate after session ends).

---

## 3. Populating Trading Forge Credentials

Each credential is stored as a Bitwarden Secure Note item in the TradingForge folder
with custom fields. The credential-loader reads fields by name.

### Method A: JSON Secure Note (recommended — one item per credential group)

```powershell
# Build the JSON payload with all secrets
$secrets = @{
    DATABASE_URL          = "postgresql://user:pass@host:5432/db"
    DATABENTO_API_KEY     = "db-xxxxxx"
    AWS_ACCESS_KEY_ID     = "AKIA..."
    AWS_SECRET_ACCESS_KEY = "xxxxxx..."
    OPENAI_API_KEY        = "sk-..."
    BRAVE_API_KEY         = "BSA-..."
    BRAVE_SEARCH_API_KEY  = "BSA-..."
    TAVILY_API_KEY        = "tvly-..."
    ALPHA_VANTAGE_API_KEY = "xxxxxx"
    MASSIVE_API_KEY       = "xxxxxx"
    FRED_API_KEY          = "xxxxxx"
    BLS_API_KEY           = "xxxxxx"
    EIA_API_KEY           = "xxxxxx"
    OPENCLAW_GATEWAY_TOKEN = "xxxxxx"
    N8N_API_KEY           = "xxxxxx"
    DISCORD_BOT_TOKEN     = "xxxxxx"
    API_KEY               = "xxxxxx"
    IBM_QUANTUM_TOKEN     = "xxxxxx"
    SUPADATA_API_KEY      = "xxxxxx"
    EXA_API_KEY           = "xxxxxx"
    PARALLEL_API_KEY      = "xxxxxx"
} | ConvertTo-Json -Compress

# Get the folder ID
$folderId = (bw list folders | ConvertFrom-Json | Where-Object { $_.name -eq "TradingForge" }).id

# Create the item
$item = @{
    type     = 2  # Secure Note
    name     = "TradingForge.Credentials"
    notes    = $secrets
    folderId = $folderId
} | ConvertTo-Json -Compress

bw create item $item
```

### Method B: Individual items with custom fields (more granular)

```powershell
# Example: create one item per secret key
$folderId = "your-folder-id"

function New-BwCredential {
    param($key, $value, $folderId)
    $item = @{
        type     = 2
        name     = "TradingForge.$key"
        notes    = ""
        folderId = $folderId
        fields   = @(
            @{ name = $key; value = $value; type = 1 }  # type 1 = hidden field
        )
    } | ConvertTo-Json -Depth 5 -Compress
    bw create item $item
}

New-BwCredential -key "DATABASE_URL"      -value "postgresql://..." -folderId $folderId
New-BwCredential -key "OPENAI_API_KEY"    -value "sk-..."           -folderId $folderId
# ... repeat for each credential
```

### Verify the credentials loaded correctly

```powershell
# List all items in the TradingForge folder
bw list items --folderid $folderId | ConvertFrom-Json | Select-Object id, name
```

---

## 4. Enabling Vault Mode in Trading Forge

Edit `.env` to activate vault mode. When vault mode is active, secret values
in `.env` are ignored — the vault is the source of truth.

```env
# .env — vault mode configuration (these are the ONLY vault-related lines needed)
TF_VAULT_MODE=bitwarden
TF_VAULT_FOLDER_ID=your-bitwarden-folder-id-here

# BW_SESSION — best set in shell before starting the server, not in .env
# If you must set it in .env for PM2 startup, rotate after each session:
# BW_SESSION=your-session-token

# Non-secret config remains in .env (these are NOT secrets)
PORT=4000
NODE_ENV=production
LOG_LEVEL=info
DB_POOL_MAX=4
MAX_PYTHON_SUBPROCESSES=6
# ... all TF_* flags, QUANTUM_* flags, DEEPAR_* settings, etc.
```

**Start the server with vault mode:**

```powershell
# Set session token in shell (not .env)
$env:BW_SESSION = $(bw unlock --raw)

# Start Trading Forge — vault loads automatically
npm start
# or
pm2 start ecosystem.config.cjs
```

**Verify vault is active:**

```powershell
# Check /api/health for vault status
Invoke-WebRequest -Uri "http://localhost:4000/api/health" |
    ConvertFrom-Json |
    Select-Object -ExpandProperty vault
# Expected: { "mode": "bitwarden", "status": "bitwarden_active", "loaded": N }
```

### Fail-closed behavior verification

```powershell
# Test 1: Vault mode active, vault unavailable → must fail CLOSED
$env:TF_VAULT_MODE = "bitwarden"
Remove-Item Env:BW_SESSION -ErrorAction SilentlyContinue
npm start
# Expected: process exits with error "BW_SESSION env var not set"

# Test 2: Vault mode active, correct BW_SESSION → must start
$env:BW_SESSION = $(bw unlock --raw)
npm start
# Expected: server starts, /api/health shows vault.mode=bitwarden

# Test 3: Vault mode disabled → env-var fallback (backwards-compatible)
$env:TF_VAULT_MODE = "env"
npm start
# Expected: server starts, /api/health shows vault.mode=env
```

---

## 5. TOTP Two-Factor Authentication

Enable TOTP on all accounts that have API keys stored in Trading Forge:

### Accounts requiring TOTP

| Account | Why | Recommended App |
|---|---|---|
| Bitwarden (master vault) | Guards all other credentials | Bitwarden built-in TOTP |
| Anthropic / OpenAI | AI API key exfiltration = full agent control | Google Authenticator |
| AWS Console | AWS key compromise = S3 data access | Google Authenticator |
| Databento | Historical data access | Google Authenticator |
| IBM Quantum | QPU credits and quantum jobs | Google Authenticator |
| Prop firm portals (Topstep, Apex, MFFU, etc.) | Account takeover = trading loss | Bitwarden TOTP |
| Railway (hosting) | Server-side environment variable access | Google Authenticator |

### Bitwarden built-in TOTP (recommended for prop firm logins)

Bitwarden Personal tier includes TOTP generation for vault items.

1. Open Bitwarden web vault or desktop app
2. Edit the prop firm login item
3. Click "Authenticator Key (TOTP)" field
4. Scan the QR code or paste the secret key from the prop firm's 2FA setup page
5. Bitwarden now generates TOTP codes alongside the username/password

### Google Authenticator (for AWS, Anthropic, OpenAI)

1. Download Google Authenticator (iOS/Android, free)
2. Enable 2FA on each service account (look for "Security" or "2FA" in account settings)
3. Scan the QR code with Google Authenticator
4. Store the backup codes in Bitwarden as a Secure Note

### TOTP backup codes

Always save backup codes in Bitwarden after enabling TOTP:

```powershell
# Create a Secure Note for backup codes
$item = @{
    type     = 2
    name     = "TradingForge.BackupCodes.OpenAI"
    notes    = "OpenAI 2FA backup codes (enable after TOTP setup):`n1. xxxxx-xxxxx`n2. xxxxx-xxxxx`n..."
    folderId = $folderId
} | ConvertTo-Json -Compress
bw create item $item
```

---

## 6. IP Whitelisting

Where services support it, add your Skytech tower's public IP to the allow-list.
This limits blast radius even if an API key is compromised.

### Check your public IP

```powershell
(Invoke-WebRequest -Uri "https://api.ipify.org").Content
# Example output: 203.0.113.42
```

### Services with IP whitelisting (free tier)

| Service | Location | Notes |
|---|---|---|
| AWS IAM | IAM → Policies → Condition: `aws:SourceIp` | Per-user or role policy condition |
| Databento | Account Settings → API Keys → IP Restrictions | Per-key allowlist |
| Railway | Not supported (use API key rotation instead) | N/A |
| Anthropic | Not supported (use key rotation) | N/A |
| OpenAI | Not supported (use key rotation) | N/A |

### AWS IAM example policy condition (restrict by IP)

```json
{
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": [
        "203.0.113.42/32"
      ]
    }
  }
}
```

Add this condition to the Trading Forge IAM user's inline policy. If your ISP
assigns a dynamic IP, update after each IP change or use a static IP (residential
static IP from ISP: typically $5-15/month, contact your ISP).

---

## 7. Encrypted Backup Procedure

Back up the vault export quarterly. Two layers of protection:
1. GPG-encrypted file (symmetric passphrase stored separately from vault)
2. SSH-key-protected storage location

### GPG installation

```powershell
# Windows: install Gpg4win (free, open source)
winget install GnuPG.GnuPG

# Verify
gpg --version
```

### Quarterly vault export + GPG encryption

```powershell
# 1. Unlock vault
$env:BW_SESSION = $(bw unlock --raw)

# 2. Export vault (JSON format, includes all items)
$exportPath = "$env:USERPROFILE\Documents\bitwarden-export-$(Get-Date -Format 'yyyy-MM-dd').json"
bw export --format json --output $exportPath

# 3. Encrypt with GPG symmetric encryption
$encryptedPath = "$exportPath.gpg"
gpg --batch --yes --symmetric --cipher-algo AES256 --output $encryptedPath $exportPath

# 4. Verify the encrypted file is readable (dry-run decrypt, suppress output)
gpg --batch --decrypt --passphrase-fd 0 $encryptedPath 2>&1 | Select-String "gpg: Good"

# 5. Delete the unencrypted export immediately
Remove-Item $exportPath -Force

# 6. Move encrypted backup to a separate location from the primary system
# Options:
#   - USB drive stored physically separate from Skytech tower
#   - AWS S3 bucket (different account from Trading Forge keys):
#     aws s3 cp $encryptedPath s3://your-personal-backup-bucket/bitwarden/
#   - Google Drive (personal, not same Google account as any trading account)
Write-Host "Backup complete: $encryptedPath"
Write-Host "Store this file somewhere physically separate from your computer."
```

### SSH key generation for server access (if applicable)

```powershell
# Generate Ed25519 key pair (more secure than RSA for new deployments)
ssh-keygen -t ed25519 -C "trading-forge-$(Get-Date -Format 'yyyy-MM-dd')" -f "$env:USERPROFILE\.ssh\trading-forge"

# Store the private key path in Bitwarden as a Secure Note
# DO NOT store the private key contents in Bitwarden — only the path and public key
```

---

## 8. Quarterly Rotation Schedule

Rotate credentials every 90 days. Schedule a reminder in your calendar.

### Rotation checklist (run every ~90 days)

```
[ ] Bitwarden master password — change at bitwarden.com/account
[ ] Bitwarden API key (if using CLI API key auth instead of interactive login)
[ ] OpenAI API key — platform.openai.com → API Keys → Create new key
[ ] Anthropic API key — console.anthropic.com → API Keys
[ ] AWS Access Key ID + Secret — IAM → Security credentials → Create access key
[ ] Databento API key — databento.com → Account → API Keys
[ ] Massive API key — check Massive account settings
[ ] IBM Quantum token — quantum.ibm.com → Account → API Token
[ ] N8N API key — n8n Settings → API
[ ] Discord bot token — discord.com/developers
[ ] Prop firm portal passwords (Topstep, Apex, MFFU, etc.)
[ ] Railway API token (if used in scripts)
[ ] Export encrypted Bitwarden backup (see Section 7)
```

### Rotation procedure

```powershell
# For each rotated credential:
# 1. Generate the new key/token in the service dashboard
# 2. Update it in Bitwarden FIRST (before revoking old key)
bw unlock  # ensure session is active
$env:BW_SESSION = $(bw unlock --raw)

# Update an existing item's custom field
$itemId = (bw list items --search "TradingForge.Credentials" | ConvertFrom-Json)[0].id
$item = bw get item $itemId | ConvertFrom-Json
# Edit $item.notes (JSON string) or $item.fields to update the value
$updatedJson = $item | ConvertTo-Json -Compress
bw edit item $itemId $updatedJson

# 3. Test that the server starts successfully with the new credentials
$env:BW_SESSION = $(bw unlock --raw)
# Restart Trading Forge and verify /api/health

# 4. Revoke the old key in the service dashboard
# 5. Verify the old key no longer works
```

---

## 9. Troubleshooting / Fail-Closed Behavior

### Error: "BW_SESSION env var not set"

```powershell
# Re-unlock the vault and export the session
$env:BW_SESSION = $(bw unlock --raw)
# Then restart Trading Forge
```

### Error: "Bitwarden vault is locked"

```powershell
# Session has expired — re-unlock
$env:BW_SESSION = $(bw unlock --raw)
```

### Error: "Bitwarden CLI (bw) not found"

```powershell
# Reinstall
npm install -g @bitwarden/cli
# Verify
bw --version
```

### Error: "Required credentials missing from vault: DATABASE_URL"

DATABASE_URL is the only required credential. If it is missing from the vault:
1. Check that the TradingForge folder exists and contains items
2. Verify TF_VAULT_FOLDER_ID matches the actual folder ID:
   `bw list folders | ConvertFrom-Json | Where-Object { $_.name -eq "TradingForge" }`
3. Check that the item has a field named exactly `DATABASE_URL`
4. Verify bw status is `unlocked` and the session has not expired

### Emergency fallback (vault unavailable, system must start)

If the vault is genuinely unavailable and you need Trading Forge running urgently:

```powershell
# Temporarily revert to env mode (no vault)
$env:TF_VAULT_MODE = "env"
# Ensure .env contains the required credentials
# Start Trading Forge
npm start

# IMPORTANT: Rotate all credentials and re-enable vault mode as soon as possible.
# This fallback bypasses the vault — treat the env file as a temporary credential
# exposure until you can re-enable vault mode.
```

Document this emergency access in your incident log. Rotate all credentials within
24 hours of any unplanned env-mode fallback.

---

## 10. Recovery Procedure

If your Bitwarden account is locked out (lost master password or TOTP device):

1. Use Bitwarden backup codes (stored when you set up TOTP — see Section 5)
2. If backup codes are also lost: contact Bitwarden support (bitwarden.com/contact)
3. While locked out: use the emergency env-mode fallback (Section 9) to keep
   Trading Forge running
4. Restore from the GPG-encrypted backup (Section 7):

```powershell
# Decrypt the backup
$backupPath = "path\to\bitwarden-export-YYYY-MM-DD.json.gpg"
$restoredPath = $backupPath -replace "\.gpg$", ".restored.json"
gpg --output $restoredPath --decrypt $backupPath

# Import the backup into a new Bitwarden account
# Bitwarden web vault: Settings → Import Data → Bitwarden (json)

# Immediately enable TOTP on the new account
# Re-enable TF_VAULT_MODE=bitwarden once restored

# Delete the decrypted file
Remove-Item $restoredPath -Force
```

---

## Operational Notes

- **Session lifetime:** BW_SESSION tokens expire after vault inactivity (default: 30 days
  for personal tier). Re-run `$env:BW_SESSION = $(bw unlock --raw)` before restarting
  Trading Forge after an idle period.

- **PM2 and BW_SESSION:** If using PM2 for process management, set BW_SESSION in the
  shell before `pm2 start` or `pm2 restart`. PM2 does not inherit shell env vars across
  reboots — add `BW_SESSION` to the PM2 process's env config or a pre-start script.

- **Health monitoring:** `/api/health` includes a `vault` field:
  ```json
  { "mode": "bitwarden", "status": "bitwarden_active", "loaded": 18 }
  ```
  If `status` is `not_loaded`, credentials were not loaded from vault. Alert if this
  appears in production when TF_VAULT_MODE=bitwarden.

- **Never commit BW_SESSION:** The session token grants full vault read access. Treat it
  like a private key. If accidentally committed, immediately revoke by running `bw lock`
  and generating a new session.

- **Logging guarantee:** credential-loader.ts logs only credential key names, never values.
  BW_SESSION is redacted from all error messages before logging.

- **Threat model scope:** This vault integration protects against:
  - Malware reading `.env` files from disk
  - Accidental `.env` commits to version control
  - Shoulder surfing of terminal env-var output
  
  It does NOT protect against:
  - Compromised Bitwarden master account (mitigated by TOTP + strong master password)
  - Memory scraping on a fully compromised host (requires full disk encryption, separate concern)
  - Process-level env inspection on a live compromised system (mitigated by BW_SESSION rotation)
