# M3 — strategies.lifecycle_state SHADOW Verification

**Date:** 2026-06-23
**Owner:** trading-forge-architect (hardening/phase-0)
**Verdict:** VERIFIED-CORRECT — NO MIGRATION NEEDED
**Status:** CLOSED

---

## Background

Wave 29 Pass A added `SHADOW` to `lifecycle-service.ts::VALID_STATES`
(commit `125fd83`, 2026-05-26). The same wave's migration `0160_shadow_signals.sql`
created the `lifecycle_shadow_signals` table and added
`strategies.shadow_mode_enabled BOOLEAN DEFAULT FALSE`.

**Deep-scan finding M3** flagged it as UNVERIFIED whether `0160` also updated the
`strategies.lifecycle_state` CHECK / enum constraint to permit the new `'SHADOW'`
value. If the column carried a pre-Wave-29 CHECK constraint that didn't name
`'SHADOW'`, then `UPDATE strategies SET lifecycle_state='SHADOW'` would throw a
`23514` (check_violation) at runtime — caught silently by the lifecycle
orchestrator's try/catch and leaving the strategy stuck in `TESTING`.

---

## Verification procedure

1. **grep all migrations for `lifecycle_state` DDL.** Results:

   | Migration | Operation on `strategies.lifecycle_state` |
   |---|---|
   | `0015_schema_sync.sql` (line 23) | `ALTER TABLE "strategies" ADD COLUMN IF NOT EXISTS "lifecycle_state" text NOT NULL DEFAULT 'CANDIDATE';` |
   | `0017_add_indexes.sql` (line 4)  | `CREATE INDEX IF NOT EXISTS "strategies_lifecycle_state_idx" ON "strategies" USING btree ("lifecycle_state");` |
   | `0045_strategy_cleanup_and_source.sql` | Reference only (column name in another table comment) |
   | `0077_lifecycle_pilot_state.sql` | **Explicit documentation that the column has NO CHECK constraint** (see below) |
   | `0109_archive_zombie_strategies.sql` | Uses `UPDATE strategies SET lifecycle_state = 'GRAVEYARD'` — no DDL |
   | `0110_wave22_firm_agnostic_position_size.sql` | `WHERE lifecycle_state NOT IN (...)` — no DDL |
   | `0152_strategies_needs_revision_states.sql` | `COMMENT ON COLUMN strategies.lifecycle_state IS '...'` (documentation only) |
   | `0160_shadow_signals.sql` | Adds `shadow_mode_enabled` boolean only — does NOT alter `lifecycle_state` |

2. **`schema.ts` line 66** confirms the column is declared as plain `text(...)` with
   no constraint:
   ```ts
   lifecycleState: text("lifecycle_state").notNull().default("CANDIDATE"),
   // CANDIDATE | TESTING | PAPER | DEPLOY_READY | PILOT | DEPLOYED |
   // DECLINING | RETIRED | GRAVEYARD | NEEDS_ARCHETYPE | NEEDS_REVISION
   ```
   (the comment is documentation; not a CHECK).

3. **Migration `0077_lifecycle_pilot_state.sql` lines 17–25 explicitly document the design intent:**

   > Since `lifecycle_state` was created as a text column with no constraint in
   > the original schema (state is enforced at application layer), we just add
   > a new comment/documentation row for the PILOT state — **no DDL change
   > needed on the column itself. The application VALID_STATES array is the gate.**

   This was the same pattern Wave 29 Pass A relied on when adding `SHADOW`.

4. **No `lifecycle_state_enum` TYPE exists** — `grep -r "CREATE TYPE.*lifecycle_state"`
   over `src/server/db/migrations/` returns zero matches. The column is plain TEXT
   with the application layer (`VALID_STATES`) as the single source of truth for
   permitted values.

---

## Conclusion

- **State is (a) Free TEXT** per the M3 fix matrix.
- **No migration is needed.** `UPDATE strategies SET lifecycle_state='SHADOW'`
  cannot fail at the DB layer for constraint reasons.
- **The application-layer `VALID_STATES` array in
  `src/server/services/lifecycle-service.ts` remains the authoritative gate.**
  Wave 29 Pass A's addition of `'SHADOW'` to that array is sufficient.
- **Integration test added:** `src/server/__tests__/m3-lifecycle-state-shadow-pglite.test.ts`
  exercises the actual UPDATE round-trip on a real (PGlite) Postgres instance
  with all live DDL applied and confirms `'SHADOW'` is accepted without violation.

This finding is **VERIFIED-CORRECT** and closes M3.

---

## Audit invariants future agents must preserve

1. **Do NOT add a CHECK constraint to `strategies.lifecycle_state`** without
   FIRST updating `VALID_STATES` in `lifecycle-service.ts` AND every consumer
   of the column (lifecycle transitions, shadow ladder, regime-drift-detector,
   etc.). The fail-OPEN at the DB level is intentional: state-machine validity
   is owned by TypeScript, not Postgres.

2. **If you must add a CHECK constraint** (e.g. for a strict-mode operator
   requirement or downstream DB-level analytics tool), the migration MUST:
   - Enumerate ALL current `VALID_STATES` values (including future-added ones).
   - Use a `DO $$ ... EXCEPTION WHEN ... END $$` block to be idempotent.
   - Be paired with a backfill query that audits existing rows for any
     unexpected value before the constraint goes live.
   - Be paired with a new pglite integration test that asserts every state in
     `VALID_STATES` round-trips through an UPDATE without violation.

3. **The `lifecycle_shadow_signals.lifecycle_state` column (migration 0160 line 64)
   is a SEPARATE column on a SEPARATE table** that defaults to `'SHADOW'`.
   Do not conflate it with `strategies.lifecycle_state`. Both are plain TEXT.

---

## References

- `src/server/db/migrations/0015_schema_sync.sql:23` — original column creation
- `src/server/db/migrations/0077_lifecycle_pilot_state.sql:9-25` — documented design intent
- `src/server/db/migrations/0160_shadow_signals.sql` — Wave 29 Pass A migration
- `src/server/db/schema.ts:66` — current schema declaration
- `src/server/services/lifecycle-service.ts` — VALID_STATES authoritative gate
- `src/server/__tests__/m3-lifecycle-state-shadow-pglite.test.ts` — integration verification
