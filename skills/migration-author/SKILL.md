
## MANDATORY: the immutability manifest (added 2026-07-28, R-382)

**Every new migration MUST be recorded in `src/server/db/migrations-hash-manifest.json`
before the PR can go green.** Run it as the LAST step, after the `.sql` and the
journal entry are final:

```
node scripts/gen-migration-manifest.mjs
```

then commit the regenerated manifest **in the same change** as the migration.

CI enforces this — `migration-immutability-guard.test.ts` fails the **Lint** job
with *"New migration(s) not in the immutability manifest"*. The guard exists
(deep-scan F1, `0311746a`) to hash-pin already-applied migrations against the
file-rewritten-after-apply class, which crash-loops the fail-CLOSED boot runner.

> This step was missing from this skill until 2026-07-28 and a correctly-authored
> migration failed CI for it. **When a CI gate catches something the skill never
> mentioned, the finding is against the skill.**

---

name: migration-author
description: >-
  Use when creating, editing, or reviewing any SQL migration in Trading Forge
  (src/server/db/migrations/*.sql or meta/_journal.json) — before the file lands.
  Also use when judging whether an existing migration is idempotent, when a
  boot-migration crash-loop / "System is down" incident traces to a migration,
  or when a journal `when` collision alert fires.
---

# Migration Authoring — Trading Forge

## Why this skill exists (real incidents, not hypotheticals)

The boot-migration-runner is **FAIL-CLOSED**: ONE bad migration (or one stray
BOM byte) = the ENTIRE API offline, NSSM crash-loop → auto-Paused, hours of
"System is down" Discord criticals (2026-06-24 incident). A migration is the
highest-blast-radius file type in this repo. Author it like it can kill prod —
because it has.

## The checklist (all items, every migration)

### 1. Encoding — UTF-8, NO BOM
- **NEVER write or edit a `.sql` migration or `_journal.json` via PowerShell**
  (`Out-File` / `Set-Content` inject `EF BB BF` at byte 0 by default).
  `JSON.parse` on a BOM'd journal threw at boot and blocked the whole API.
- Use the Write/Edit tools, or node/perl. Verify if unsure:
  `head -c 3 <file> | xxd` — must not start `ef bb bf`.
- The runner now strips BOM via `readUtf8StripBom()` (commit 89fe6d7), but that
  is a safety net, not a license.

### 2. Idempotency — safe to re-apply, always
- Columns/indexes/tables: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT
  EXISTS`, `CREATE TABLE IF NOT EXISTS`.
- Constraints: Postgres has **no** `ADD CONSTRAINT IF NOT EXISTS`. The correct
  idiom is **drop-then-add**:
  ```sql
  ALTER TABLE t DROP CONSTRAINT IF EXISTS "t_fk";
  ALTER TABLE t ADD CONSTRAINT "t_fk" FOREIGN KEY ...;
  ```
- **Judging idempotency of an existing migration:** scan for a PRECEDING
  `DROP ... IF EXISTS` or a `DO $$ ... EXCEPTION` wrapper — NOT just a
  same-line `IF NOT EXISTS`. A false "non-idempotent" verdict on 0052 was
  pinned and later retracted because the reviewer only grepped same-line
  guards. Paired-guard check:
  ```bash
  python -c "import re;t=open('<file>',encoding='utf-8').read();a=re.findall(r'ADD CONSTRAINT \"([^\"]+)\"',t);d=re.findall(r'DROP CONSTRAINT IF EXISTS \"([^\"]+)\"',t);print('unguarded=',[x for x in a if x not in d])"
  ```
- Also read the migration's own header — authors state idempotency intent there.

### 3. Column TYPES — verify against schema.ts before inserting values
The 0175 incident: inserted the STRING `'false'` into
`system_parameters.current_value`, which is **numeric** → Postgres rejected →
boot blocked → prod down. Before any `INSERT`/`UPDATE` in a migration, open
`src/server/db/schema.ts` and confirm the actual column type. Booleans stored
in numeric columns are 1/0, not 'true'/'false'.

### 4. Journal entry — meta/_journal.json
Append one entry, matching the existing shape exactly:
```json
{ "idx": <last idx + 1>, "version": "7", "when": <unique ms>, "tag": "<NNNN_filename_no_ext>", "breakpoints": true }
```
- `when` must be **unique** — the runner's journal guard fires a Discord
  CRITICAL (`boot_migration.duplicate_journal_when_detected`) on collisions.
  Convention in recent entries: last `when` + 100.
- `idx` strictly increments; `tag` = filename without `.sql`.

### 5. Behavior changes default OFF
New behavior ships flag-gated (env var or nullable column), inert until the
operator flips it. State the flag and the inert-until condition in the header
comment. New columns are nullable unless a backfill is included.

### 6. Header comment (house format — see 0197 for the model)
```sql
-- NNNN (<context>): <one-line purpose>.
-- <why / what loop it closes>
-- Nullable + idempotent (<idioms used>); safe to re-apply. Inert until <flag/condition>.
```

### 7. Failure semantics you inherit for free
A failed migration rolls back inside its transaction and is NOT recorded as
applied → it re-runs clean on the next boot. Do not build partial-progress
migrations that assume earlier statements survived a failure.

### 8. Apply + recover
- Apply: `npm run db:migrate`, or wait for the boot-migration-runner on next
  API boot.
- If the API is crash-looped on a bad migration: fix the file on disk — NSSM
  auto-restarts after its throttle window and the runner re-applies clean.
  Claude canNOT restart the NSSM service (not elevated); the HMAC self-restart
  endpoint needs the API up. Fixing the tree is the recovery.

## Red flags — stop and fix before landing
- Any `.sql`/`_journal.json` write routed through PowerShell
- Bare `ADD CONSTRAINT` with no preceding `DROP CONSTRAINT IF EXISTS`
- `INSERT`/`UPDATE` values not checked against `schema.ts` column types
- Reused or guessed `when` value
- Behavior change with no flag gate and no header note
- "It'll only run once" as an argument against idempotency — re-runs happen
  (journal drift, dup-when siblings, restore-from-backup)
