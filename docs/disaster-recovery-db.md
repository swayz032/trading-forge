# Database Disaster Recovery — Runbook (deepscan6 S3, 2026-07-01)

> **Why this exists:** the deep-scan #6 audit found DR is **unproven** — the nightly
> backup cron is registered but `backups/db/` is empty, `pg_dump` is not installed on the
> tower, and no restore had ever been tested. A backup you have never restored is not a
> backup. This runbook closes that: how to get a *real* backup, how to restore it, and a
> drill checklist to prove it works.

## Current state (as found)

- `db-backup-service.ts` runs a 24h `db-backup` cron. It invokes `pg_dump` to
  `tf-db-backup-<iso>.sql`, then pushes to S3 when `S3_BUCKET` + AWS creds are set.
- **`pg_dump` is NOT on the tower's PATH**, so the dump step is skipped and no `.sql`
  artifact is produced. The `boot-migration-runner` has an explicit "pg_dump unavailable"
  fallback to an `information_schema` **schema-only JSON** — that captures structure, **not
  data**, and is not restorable as a working database.
- Net: there is currently **no data backup** and **no tested restore**.

## Fix step 1 — get real backups running (operator, ~15 min)

Install the PostgreSQL client tools so `pg_dump` / `psql` exist on the tower:

- Windows: install "PostgreSQL" (or just the "Command Line Tools") from
  https://www.postgresql.org/download/windows/ and add its `bin\` to PATH, **or**
  `winget install PostgreSQL.PostgreSQL` (then add `bin` to PATH). Confirm with
  `pg_dump --version` and `psql --version`.
- Alternative (no install): run the dump from Docker —
  `docker run --rm postgres:16 pg_dump "$env:DATABASE_URL" > tf-db-backup.sql`.

Then confirm the nightly backup produces an artifact: run `scripts/backup-db.sh` (or wait
for the `db-backup` cron) and verify a non-empty `backups/db/tf-db-backup-*.sql` appears
and (if S3 is configured) lands in the bucket.

> **Belt-and-suspenders:** Railway also offers managed Postgres backups. Enable them in the
> Railway dashboard for the Postgres service as a second, off-tower copy. Two independent
> backup paths is the institutional norm.

## Fix step 2 — restore (the tested path)

Restore a dump into a **scratch** database (never production for a drill):

```powershell
# 1. Create a scratch DB (local Postgres or a Railway preview DB).
# 2. Restore into it:
.\scripts\db-restore.ps1 `
  -BackupFile "backups\db\tf-db-backup-2026-07-01T...sql" `
  -TargetUrl  "postgresql://postgres:postgres@localhost:5432/tf_restore_drill"
```

`db-restore.ps1` refuses to run on an empty backup file, refuses to target a
production-shaped URL without `-Force`, restores with `ON_ERROR_STOP=1` (loud on failure),
and prints a post-restore sanity count (public tables / `audit_log` rows / `strategies`
rows). Non-trivial counts = a working restore.

## Fix step 3 — the DR drill (prove it; do this quarterly)

1. Take a fresh backup (step 1) and confirm the `.sql` is non-empty.
2. Restore it into a scratch DB (step 2).
3. Confirm the sanity counts are non-trivial and match roughly what prod has.
4. Spot-check: `SELECT max(created_at) FROM audit_log;` on the restored DB should be within
   ~24h of the backup's timestamp (i.e. the data is current, not a stale dump).
5. Record the drill date + result in `AGENT-LOGS.md`. **A drill you didn't log didn't
   happen.**

## Restore over production (real incident only)

Only in a genuine loss event, and only after confirming the backup is good on a scratch DB
first:

```powershell
.\scripts\db-restore.ps1 -BackupFile <good-backup>.sql -TargetUrl "$env:DATABASE_URL" -Force
```

The `-Force` flag is the deliberate friction. Then restart `TradingForgeAPI` (the
boot-migration-runner will reconcile any pending migrations against the restored state).

## Open items (operator)

- [ ] Install `pg_dump`/`psql` on the tower (or wire the Docker dump) — **unblocks backups**.
- [ ] Enable Railway managed Postgres backups (second copy).
- [ ] Run the first restore drill and log it.
- [ ] Consider adding a cron alert if `backups/db/` has no artifact newer than 48h (the
      backup silently not running is exactly what hid this gap).
