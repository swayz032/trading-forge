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
 * The sha256 (BOM-stripped, matching boot-migration-runner's readUtf8StripBom) of the 10 migrations
 * in the 5 known `when`-collision groups whose schema is verified present in prod. The backfill
 * decision keys on THIS (exact migration identity), not on `when` — so a corrupted/edited/new entry
 * that merely happens to share one of the 5 timestamps but has DIFFERENT content will NOT be
 * backfilled (its hash won't match) — it falls through to `toApply` and is applied, never silently
 * marked-applied-without-schema. (deep-scan re-cert Finding B hardening.)
 */
// 2026-07-09 RECOMPUTED: boot-migration-runner's readUtf8StripBom now also normalizes
// CRLF→LF (this tower's git checkout has core.autocrlf=true, which silently converts
// LF-stored git blobs to CRLF on disk — see readUtf8StripBom's docstring). The old hashes
// below were stale under the new normalized algorithm, which caused these already-applied
// migrations to look unapplied and attempt to re-run — the SAME failure class as the
// incident that prompted the CRLF fix (0000_previous_nuke.sql: CREATE TABLE "alerts"
// collided with an already-existing table, fail-closed boot, NSSM crash-loop). Verified
// live (read-only, 2026-07-09) that all 10 files are byte-identical to their single git
// commit (`git diff HEAD` clean) — content unchanged since the original 2026-07-05
// out-of-band verification, so that verification's conclusion still holds; only the
// fingerprint needed correcting. Verified (read-only, 2026-07-09) the schema effects of
// all 10 are still live: system_parameters/system_parameter_history/lifecycle_shadow_
// signals/needs_archetype_queue/slumhouse_users/quantum_mc_runs/broker_accounts tables
// present; strategies.paper_account_routing + its CHECK constraint present; both A/B
// seed rows present; broker_accounts_firm_id_check includes 'paper'.
export const KNOWN_OUT_OF_BAND_APPLIED_HASHES: ReadonlyMap<string, string> = new Map([
  ["554e34e0b57c317f9a492faf424bab24609c2a5dc447c457a877e26dedd7fb5d", "0044a_system_parameters_tables"],
  ["13f3098bd86a0647e74451d9d4b40e2fd408354a2ee3790f11ee52784e665640", "0052_fk_cascade_hardening"],
  ["8a990ac03e44fe7adca62b553ffc993028e34172a1ee6f86e1a12243d1285ca5", "0147_quantum_mc_runs_replay_uniqueness"],
  ["4197c4200560fe35eed742b7b031c1fca6fe13299d6a5eaa272ab4cc51d99034", "0159_broker_accounts_ab_paper_routing"],
  ["2a62fedb6e9dd39a9fb4aebd2d32a969ad3bdf459e4727603d9a5f994dbf0443", "0148_backtests_compliance_mode"],
  ["f1685456e0cbbf3885e282bad61b9f578a4f77385dc10e001b8e3ebde33bc879", "0160_shadow_signals"],
  ["decf587e31100ddbf83c8463d51ee79b77091876a11ad95ee5772def8900bce8", "0152_strategies_needs_revision_states"],
  ["7fc225e1a21cb2c890bb8b2d7f430a3f6f6e4138cffaf901a8e925c2e4ee081e", "0162_needs_archetype_queue"],
  ["fd386be36d175e6462a941c6e02ea893b99f5c858ed33348b2edd7a3c4c1f1d9", "0153_pipeline_modes_autopause"],
  ["dd26e57c3d4b099ed0be75e46c1e6d1c29f4e0e821647b13bbe285fae03851f1", "0164_slumhouse_users"],
]);

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
 */
export function computeMigrationPlan<E extends { when: number; tag: string }>(
  entries: E[],
  appliedWhens: ReadonlySet<string>,
  appliedHashes: ReadonlySet<string>,
  hashOf: (e: E) => string | null,
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
    if (KNOWN_OUT_OF_BAND_APPLIED_HASHES.has(h)) {
      toBackfill.push(e); // IDENTITY-verified out-of-band sibling (exact content) — record, don't re-run
    } else {
      toApply.push(e); // genuinely pending — a NEW when-collision is now APPLIED, not silently skipped
    }
  }
  return { toApply, toBackfill };
}
