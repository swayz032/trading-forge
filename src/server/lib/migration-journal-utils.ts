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
