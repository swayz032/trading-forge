# Trading Forge — DB restore helper (deepscan6 S3, 2026-07-01)
#
# Restores a `tf-db-backup-*.sql` (pg_dump plain SQL, produced by db-backup-service.ts /
# scripts/backup-db.sh) into a TARGET database via psql. Guarded so a drill cannot
# clobber production by accident.
#
# Usage (PowerShell):
#   .\scripts\db-restore.ps1 -BackupFile "backups\db\tf-db-backup-2026-07-01T...sql" `
#                            -TargetUrl  "postgresql://user:pass@localhost:5432/tf_restore_drill"
#
#   # To restore over an existing prod-shaped target you MUST pass -Force (safety catch):
#   .\scripts\db-restore.ps1 -BackupFile <f> -TargetUrl <prod-ish-url> -Force
#
# Requires: psql on PATH. If psql/pg_dump are not installed on the tower, install the
# PostgreSQL client tools (see docs/disaster-recovery-db.md) — that is ALSO what unblocks
# the nightly backup itself (the service skips pg_dump when it is absent).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }
if ((Get-Item $BackupFile).Length -eq 0) { throw "Backup file is EMPTY (0 bytes): $BackupFile — this is the 'no successful dump' failure mode; fix backups before drilling restore." }
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw "psql not found on PATH. Install the PostgreSQL client tools first (see docs/disaster-recovery-db.md). This same gap is why the nightly pg_dump backup is not running."
}

# Safety catch: refuse to restore into the live production DB unless -Force is given.
# We treat the Railway public proxy host as 'production-shaped'.
$prodHostMarkers = @("proxy.rlwy.net", "railway.app")
$looksProd = $false
foreach ($m in $prodHostMarkers) { if ($TargetUrl -match [regex]::Escape($m)) { $looksProd = $true } }
if ($looksProd -and -not $Force) {
  throw "TargetUrl looks like PRODUCTION ($TargetUrl). Restoring will OVERWRITE it. Re-run with -Force only if you truly intend to restore over production. For a DRILL, point -TargetUrl at a scratch DB (e.g. a local Postgres or a Railway preview DB)."
}

Write-Host "Restoring $BackupFile -> $TargetUrl" -ForegroundColor Cyan
$start = Get-Date
# -v ON_ERROR_STOP=1 so a mid-restore failure aborts loudly instead of a half-restore.
& psql $TargetUrl -v ON_ERROR_STOP=1 -f $BackupFile
if ($LASTEXITCODE -ne 0) { throw "psql restore FAILED (exit $LASTEXITCODE)." }

# Post-restore sanity: confirm the trust-spine + core tables exist and audit_log is non-empty.
$checkSql = "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS tables, (SELECT count(*) FROM audit_log) AS audit_rows, (SELECT count(*) FROM strategies) AS strategies;"
Write-Host "Post-restore sanity:" -ForegroundColor Cyan
& psql $TargetUrl -v ON_ERROR_STOP=1 -c $checkSql
$elapsed = [int]((Get-Date) - $start).TotalSeconds
Write-Host "Restore + sanity check completed in ${elapsed}s. Verify the counts above are non-trivial." -ForegroundColor Green
