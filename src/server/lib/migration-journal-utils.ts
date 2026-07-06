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
 *   - hash ∉ appliedHashes + known out-of-band `when` (recorded) → BACKFILL (schema present, no re-run)
 *   - hash ∉ appliedHashes otherwise                        → APPLY (run SQL) — the bug fix
 *   - hash === null (unreadable)                            → when-based fallback
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
    if (KNOWN_OUT_OF_BAND_APPLIED_WHENS.has(e.when) && appliedWhens.has(String(e.when))) {
      toBackfill.push(e); // ledger drift on a verified-present sibling — record, don't re-run
    } else {
      toApply.push(e); // genuinely pending — a NEW when-collision is now APPLIED, not silently skipped
    }
  }
  return { toApply, toBackfill };
}
