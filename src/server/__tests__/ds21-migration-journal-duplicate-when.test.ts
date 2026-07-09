import { describe, it, expect } from "vitest";
import { findDuplicateJournalWhens } from "../lib/migration-journal-utils.js";

// ds21 (deep-scan #21 Band F): regression guard for the migration-ledger `when`-collision
// detector. Tests the leaf directly (no db-import) so it never joins the collection-crash class.

describe("findDuplicateJournalWhens", () => {
  it("returns [] when every `when` is unique", () => {
    const entries = [
      { when: 1, tag: "0001_a" },
      { when: 2, tag: "0002_b" },
      { when: 3, tag: "0003_c" },
    ];
    expect(findDuplicateJournalWhens(entries)).toEqual([]);
  });

  it("returns [] for an empty journal", () => {
    expect(findDuplicateJournalWhens([])).toEqual([]);
  });

  it("detects a single duplicate pair with both tags", () => {
    const groups = findDuplicateJournalWhens([
      { when: 100, tag: "0147_earlier" },
      { when: 100, tag: "0159_later" },
      { when: 200, tag: "0160_unique" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].when).toBe(100);
    expect(groups[0].tags).toEqual(["0147_earlier", "0159_later"]);
  });

  it("detects a triple collision (≥3 entries sharing one `when`)", () => {
    const groups = findDuplicateJournalWhens([
      { when: 5, tag: "a" },
      { when: 5, tag: "b" },
      { when: 5, tag: "c" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tags).toEqual(["a", "b", "c"]);
  });

  it("detects exactly the 5 real production collision pairs (Band F fixture)", () => {
    // The live meta/_journal.json collisions confirmed by accuracy-validator via hash comparison.
    const realCollisions = [
      { when: 1776200000000, tag: "0044a_system_parameters_tables" },
      { when: 1776200000000, tag: "0052_fk_cascade_hardening" },
      { when: 1748304000000, tag: "0147_quantum_mc_runs_replay_uniqueness" },
      { when: 1748304000000, tag: "0159_broker_accounts_ab_paper_routing" },
      { when: 1748390400000, tag: "0148_backtests_compliance_mode" },
      { when: 1748390400000, tag: "0160_shadow_signals" },
      { when: 1748563200000, tag: "0152_strategies_needs_revision_states" },
      { when: 1748563200000, tag: "0162_needs_archetype_queue" },
      { when: 1748649600000, tag: "0153_pipeline_modes_autopause" },
      { when: 1748649600000, tag: "0164_slumhouse_users" },
      // plus a handful of genuinely-unique entries that must NOT be flagged
      { when: 1748700000000, tag: "0191_unique_one" },
      { when: 1748700000001, tag: "0192_unique_two" },
    ];
    const groups = findDuplicateJournalWhens(realCollisions);
    expect(groups).toHaveLength(5);
    // every group is exactly a 2-tag pair (earlier + later sibling)
    for (const g of groups) expect(g.tags).toHaveLength(2);
    // the later-sibling that was silently skipped must appear in a flagged group
    const flaggedTags = groups.flatMap((g) => g.tags);
    for (const later of ["0052_fk_cascade_hardening", "0159_broker_accounts_ab_paper_routing",
      "0160_shadow_signals", "0162_needs_archetype_queue", "0164_slumhouse_users"]) {
      expect(flaggedTags).toContain(later);
    }
  });
});
