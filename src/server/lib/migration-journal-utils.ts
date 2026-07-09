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
export const KNOWN_OUT_OF_BAND_APPLIED_HASHES: ReadonlyMap<string, string> = new Map([
  ["9221cbe8a762b0ec034e4d56a60d650ec56f5f5f5bee56a53d800c268f3563d7", "0044a_system_parameters_tables"],
  ["26a8a67e6934c7d68a273cc0fe380348f065bc6f7824e271630f4f7e923ee344", "0052_fk_cascade_hardening"],
  ["a1f50c5143b98b5ac85f3b556e65caa41a9ea6215b846cdfef2f7fec99e9d898", "0147_quantum_mc_runs_replay_uniqueness"],
  ["1604a45a5bfee65f6d3fdc1b0e2a3494c64892e94789ddfa35db87cbf67ceb45", "0159_broker_accounts_ab_paper_routing"],
  ["92b267614b9dd34391467f9ca14a67252fb058938e84976bdb885e249baa0f16", "0148_backtests_compliance_mode"],
  ["6226f021e27bb8fea9c565f4a119ad76d712edca2ee117f42eb2e0f27b6647bc", "0160_shadow_signals"],
  ["8350ce96e295a795aed9ff50d2906ea0eae56f9ca9f3c30937970a1d2e7dffbe", "0152_strategies_needs_revision_states"],
  ["df54b99b2a4ae16ea866324cd91d79db1af6708e4f298a0aad1e8a4376a6d966", "0162_needs_archetype_queue"],
  ["cd015c0f78ac89bee9665b0ff2ae888a13f682b1afa4296de4db3f2d9fbf95ab", "0153_pipeline_modes_autopause"],
  ["520f32f67d4680d6218f445177f48919c41a855303264372ae9a9d66189ad589", "0164_slumhouse_users"],
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
