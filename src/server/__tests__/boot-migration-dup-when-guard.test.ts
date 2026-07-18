/**
 * boot-migration-dup-when-guard.test.ts
 *
 * Deep-scan F durable root-cause guard.
 *
 * The boot-migration-runner keys its "already applied" pending filter on the journal
 * `when` epoch (= drizzle.__drizzle_migrations.created_at), NOT on tag/hash. If two
 * journal entries share an identical `when`, applying the first records that `when` and
 * the SECOND is silently, permanently skipped — surfacing only later as an opaque
 * "table/column does not exist" runtime error.
 *
 * The 5 existing collisions need no action: a read-only live-DB check confirmed all 5 later
 * siblings' schema already EXISTS (applied out-of-band — the ledger row is merely absent, which
 * is inert because the runner keys `pending` on `when`). The migrations are idempotent anyway
 * (e.g. 0052_fk_cascade_hardening uses drop-then-add — `DROP CONSTRAINT IF EXISTS` before each
 * `ADD CONSTRAINT`; its own header declares idempotency), so even a re-run would be safe. (An
 * earlier note here wrongly called 0052 non-idempotent — corrected 2026-07-05 after an
 * independent grader disproved it.)
 *
 * What this guard DOES close: it blocks the bug class going forward. Any NEW duplicate-`when`
 * beyond the 5 known-existing pairs fails CI — forcing the author to give the new migration a
 * unique `when` before it can silently skip on boot.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { findDuplicateJournalWhens } from "../lib/migration-journal-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const journal = JSON.parse(
  readFileSync(resolve(__dirname, "../db/migrations/meta/_journal.json"), "utf-8"),
) as { entries: Array<{ when: number; tag: string }> };

// The 5 known-existing duplicate-`when` collisions (later sibling applied out-of-band —
// schema exists in prod, verified read-only; ledger row merely absent, which is inert
// because the runner keys `pending` on `when`). The migrations ARE idempotent (e.g. 0052
// uses DROP CONSTRAINT IF EXISTS before each ADD), so even a re-run would be safe — no
// action needed on these; this guard only blocks NEW collisions going forward.
const ALLOWLISTED_DUP_WHENS: ReadonlySet<number> = new Set([]);
// The 5 formerly-duplicate `when` collisions were RESOLVED in the campaign's base
// commit ("migrations: give dup-when journal siblings unique whens (fixes boot
// CRITICAL)") — each later sibling was bumped to when+1 (unique, order-preserving).
// Zero duplicate-`when` groups remain in the journal. This guard now blocks ANY
// new collision going forward.

describe("deep-scan F — migration journal duplicate-`when` guard", () => {
  it("has NO new duplicate-`when` collisions beyond the allowlisted 5", () => {
    const groups = findDuplicateJournalWhens(journal.entries);
    const unexpected = groups.filter((g) => !ALLOWLISTED_DUP_WHENS.has(g.when));
    if (unexpected.length > 0) {
      const detail = unexpected
        .map((g) => `when=${g.when}: [${g.tags.join(", ")}]`)
        .join("; ");
      throw new Error(
        `NEW migration-journal duplicate-\`when\` collision detected: ${detail}. ` +
          "The boot-migration pending filter keys on `when`, so the LATER migration would be " +
          "SILENTLY SKIPPED on boot (never applied, no ledger row). Give the new migration a " +
          "unique `when` in meta/_journal.json before merging.",
      );
    }
    expect(unexpected).toEqual([]);
  });

  it("the allowlisted collisions still exist (removing one requires updating this guard intentionally)", () => {
    const dupWhens = new Set(findDuplicateJournalWhens(journal.entries).map((g) => g.when));
    for (const w of ALLOWLISTED_DUP_WHENS) {
      // If a collision was genuinely resolved (unique `when` assigned), drop it from the
      // allowlist in the SAME change — this assertion makes that a deliberate edit, not drift.
      expect(dupWhens.has(w)).toBe(true);
    }
  });
});
