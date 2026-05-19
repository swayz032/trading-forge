#!/bin/bash
# ─── Trading Forge — PostgreSQL Backup ─────────────────────────
# Dumps the local dev database to a timestamped gzip file.
# Retains the last 7 backups; older ones are pruned automatically.
#
# Usage:
#   ./scripts/backup-db.sh
#
# Cron (recommended — daily at 3 AM):
#   crontab -e
#   0 3 * * * /absolute/path/to/trading-forge/scripts/backup-db.sh >> /absolute/path/to/trading-forge/logs/backup.log 2>&1
#
# Windows Task Scheduler (via WSL or Git Bash):
#   schtasks /create /tn "TradingForge-DB-Backup" /tr "bash /c/Users/tonio/Projects/trading-forge/trading-forge/scripts/backup-db.sh" /sc daily /st 03:00

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups/db"
CONTAINER_NAME="trading-forge-postgres-local"
DB_NAME="trading_forge"
DB_USER="postgres"
RETENTION_COUNT=7

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

echo "[$(date)] Starting backup of $DB_NAME..."

# Verify container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "[$(date)] ERROR: Container $CONTAINER_NAME is not running. Aborting."
  exit 1
fi

# Dump and compress
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Verify backup is non-empty (at minimum a gzip header)
if [ ! -s "$BACKUP_FILE" ]; then
  echo "[$(date)] ERROR: Backup file is empty. Aborting."
  rm -f "$BACKUP_FILE"
  exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$(date)] Backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# Prune old backups — keep only the most recent $RETENTION_COUNT
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$RETENTION_COUNT" ]; then
  PRUNED=$(ls -t "$BACKUP_DIR"/*.sql.gz | tail -n +$((RETENTION_COUNT + 1)) | wc -l)
  ls -t "$BACKUP_DIR"/*.sql.gz | tail -n +$((RETENTION_COUNT + 1)) | xargs rm -f
  echo "[$(date)] Pruned $PRUNED old backup(s). Retained $RETENTION_COUNT."
fi

echo "[$(date)] Done."
