// ds21 (deep-scan #21 Band F): leaf module (NO imports) for migration-journal integrity
// checks. Kept import-free on purpose so unit tests exercise it WITHOUT pulling in the
// db/index module-load throw (the collection-crash class flagged in the same scan).

export interface JournalWhenEntry {
  when: number;
  tag: string;
}

/**
 * Pure detector for the migration-ledger `when`-collision class. Returns one group per `when`
 * value shared by ≥2 journal entries (each group lists the colliding tags in journal order).
 * Empty array = no collisions.
 *
 * Why this matters: the boot-migration pending filter keys "already applied" on the journal
 * `when` epoch (stored as drizzle.__drizzle_migrations.created_at), not the per-migration tag/hash.
 * Two entries sharing a `when` → applying the first marks the second as applied → the second is
 * SILENTLY, PERMANENTLY skipped. This detector lets boot fire a loud CRITICAL instead of failing
 * silently. Deterministic + import-free → unit-testable without a DB.
 */
export function findDuplicateJournalWhens(
  entries: JournalWhenEntry[],
): Array<{ when: number; tags: string[] }> {
  const byWhen = new Map<number, string[]>();
  for (const e of entries) {
    const list = byWhen.get(e.when);
    if (list) list.push(e.tag);
    else byWhen.set(e.when, [e.tag]);
  }
  const groups: Array<{ when: number; tags: string[] }> = [];
  for (const [when, tags] of byWhen) {
    if (tags.length > 1) groups.push({ when, tags });
  }
  return groups;
}

/**
 * The 5 journal `when` values whose colliding sibling was applied OUT OF BAND — schema verified
 * present in prod (read-only 2026-07-05, see boot-migration-runner ds21 comment). A pending-by-hash
 * entry carrying one of these `when`s (with the `when` already recorded in the ledger) is ledger
 * DRIFT to backfill — record its hash WITHOUT re-running the SQL. Any FUTURE collision (a `when` not
 * in this set) is applied normally — that is the actual silent-skip bug fix.
 */
export const KNOWN_OUT_OF_BAND_APPLIED_WHENS: ReadonlySet<number> = new Set([
  1776200000000, // 0044a_system_parameters_tables / 0052_fk_cascade_hardening
  1748304000000, // 0147_quantum_mc_runs_replay_uniqueness / 0159_broker_accounts_ab_paper_routing
  1748390400000, // 0148_backtests_compliance_mode / 0160_shadow_signals
  1748563200000, // 0152_strategies_needs_revision_states / 0162_needs_archetype_queue
  1748649600000, // 0153_pipeline_modes_autopause / 0164_slumhouse_users
]);

/**
 * deep-scan fresh-bootstrap fix (2026-07-10): EMPTIED. This map used to carry the sha256
 * (BOM-stripped, matching boot-migration-runner's readUtf8StripBom) of the 10 migrations in the
 * 5 known `when`-collision groups whose schema was verified present in prod (0044a/0052,
 * 0147/0159, 0148/0160, 0152/0162, 0153/0164). Backfilling them (recording the ledger hash
 * WITHOUT running the SQL) was safe for THAT SPECIFIC already-existing prod database — but the
 * SAME hash-keyed decision applies unconditionally on ANY database, including a genuinely fresh
 * bootstrap (new environment, disaster recovery, PGlite replay test) where none of the 10 tables/
 * columns exist yet. Backfilling there means their CREATE TABLE / ADD COLUMN / CREATE INDEX SQL
 * NEVER RUNS — a silent, permanent fresh-bootstrap schema gap (verified via a full-journal PGlite
 * replay: with the map populated, 10 real migrations' SQL is skipped; system_parameters,
 * system_parameter_history, lifecycle_shadow_signals, needs_archetype_queue, slumhouse_users, and
 * 4 idempotent column/index additions never land).
 *
 * All 10 were independently re-verified (this scan) to be genuinely idempotent-safe to just
 * re-apply anywhere: every one uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` / drop-then-add constraint / `INSERT ... ON CONFLICT DO NOTHING`
 * (0159's INSERT is covered by the real `(firm_id, account_id_external)` unique index from 0098 —
 * the no-target ON CONFLICT DO NOTHING catches it). Per the migration-author skill's guidance,
 * an idempotent-by-construction migration is safe to route through normal `toApply` even under a
 * changed/mismatched hash — re-running it against the specific prod DB where the schema already
 * exists out-of-band is a harmless no-op, and running it against a fresh DB actually creates the
 * schema. This is also more robust than hash-based backfill under the documented CRLF-vs-LF
 * divergence between worktree histories: if a diverged worktree's prod ledger recorded a backfill
 * hash that doesn't byte-match THIS tree's file content, `appliedHashes.has(h)` is false anyway and
 * the entry falls through — the empty map means it then goes to `toApply` (safe, idempotent) rather
 * than depending on a hash match that line-ending drift can silently break.
 *
 * `computeMigrationPlan` takes this as an injectable parameter (5th arg, defaulting to this now-
 * empty map) so the backfill MECHANISM itself remains unit-testable with a synthetic map — the
 * mechanism is still valuable if some FUTURE out-of-band-applied, genuinely-non-idempotent
 * migration is ever discovered. Today, there are none: this map is empty and `toBackfill` is
 * always `[]` for the real journal.
 */
export const KNOWN_OUT_OF_BAND_APPLIED_HASHES: ReadonlyMap<string, string> = new Map([]);

export interface MigrationPlan<E> {
  /** run the SQL (genuinely pending — includes a FUTURE when-collision that was never applied) */
  toApply: E[];
  /** record the ledger row only (schema verified present) — no SQL re-run */
  toBackfill: E[];
}

/**
 * F1 fix (deep-scan Autonomy HIGH) — compute the boot-migration plan keyed on the migration HASH
 * (identity), not the journal `when` epoch. Closes the silent-skip class: two entries sharing a
 * `when` no longer cause the second to be treated as applied and permanently skipped.
 *
 * `hashOf(entry)` returns the sha256 of the entry's .sql file, or null when it cannot be read
 * (missing/locked) — in which case we FALL BACK to the legacy when-based applied-check for that
 * entry, so behavior is never worse than the pre-F1 filter.
 *
 *   - hash ∈ appliedHashes                                  → already applied (skip)
 *   - hash ∈ KNOWN_OUT_OF_BAND_APPLIED_HASHES (identity)    → BACKFILL (schema present, no re-run)
 *   - hash ∉ either, otherwise                              → APPLY (run SQL) — the bug fix
 *   - hash === null (unreadable)                            → when-based fallback
 *
 * The backfill decision keys on the migration HASH (exact identity), NOT `when` — a wrong-content
 * entry sharing a collision timestamp is applied, never marked-applied-without-schema (Finding B).
 *
 * `outOfBandHashes` (deep-scan fresh-bootstrap fix, 2026-07-10): defaults to the module-level
 * `KNOWN_OUT_OF_BAND_APPLIED_HASHES` (currently empty — see its doc comment). Injectable so unit
 * tests can exercise the backfill MECHANISM with a synthetic map without depending on real
 * migration content; the runtime call site (boot-migration-runner.ts) relies on the default.
 */
export function computeMigrationPlan<E extends { when: number; tag: string }>(
  entries: E[],
  appliedWhens: ReadonlySet<string>,
  appliedHashes: ReadonlySet<string>,
  hashOf: (e: E) => string | null,
  outOfBandHashes: ReadonlyMap<string, string> = KNOWN_OUT_OF_BAND_APPLIED_HASHES,
): MigrationPlan<E> {
  const toApply: E[] = [];
  const toBackfill: E[] = [];
  for (const e of entries) {
    const h = hashOf(e);
    if (h === null) {
      if (!appliedWhens.has(String(e.when))) toApply.push(e); // legacy when-based fallback
      continue;
    }
    if (appliedHashes.has(h)) continue; // applied by identity
    if (outOfBandHashes.has(h)) {
      toBackfill.push(e); // IDENTITY-verified out-of-band sibling (exact content) — record, don't re-run
    } else {
      toApply.push(e); // genuinely pending — a NEW when-collision is now APPLIED, not silently skipped
    }
  }
  return { toApply, toBackfill };
}
