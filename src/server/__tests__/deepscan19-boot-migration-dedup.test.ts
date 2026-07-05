/**
 * Deep-Scan #19 D-1 — boot-migration dedup must not silently drop duplicate-`when` twins.
 *
 * The Drizzle journal `when` timestamp is NOT unique (5 twin pairs collide, e.g.
 * 0147/0159). The pre-fix runner keyed the applied-set on `when` alone, so on an
 * incremental deploy the second twin of an already-applied `when` was filtered out
 * of `pending` and NEVER ran. computePendingMigrations() disambiguates duplicate
 * `when`s by the unique sha256 file hash while keeping the fast when-check for the
 * (majority) unique-`when` entries.
 */
import { describe, it, expect, vi } from "vitest";

// computePendingMigrations is pure; mock the db import chain (boot-migration-runner
// transitively imports ../db/index.js which requires DATABASE_URL at module load).
vi.mock("../db/index.js", () => ({ db: {} }));

import {
  computePendingMigrations,
  type JournalEntry,
} from "../lib/boot-migration-runner.js";

function entry(idx: number, tag: string, when: number): JournalEntry {
  return { idx, version: "7", when, tag, breakpoints: true };
}

// Deterministic fake hasher: hash = "h:" + tag (unique per file, like sha256(content)).
const hashByTag = (e: JournalEntry): string | null => `h:${e.tag}`;

describe("DS19 D-1: computePendingMigrations", () => {
  it("keeps legacy behavior for unique-`when` entries (applied when → not pending)", () => {
    const entries = [entry(1, "0001_a", 100), entry(2, "0002_b", 200)];
    const pending = computePendingMigrations(
      entries,
      new Set(["100"]), // 0001 applied
      new Set(["h:0001_a"]),
      hashByTag,
    );
    expect(pending.map((e) => e.tag)).toEqual(["0002_b"]);
  });

  it("REGRESSION: duplicate-`when` twin — second twin is pending when only the first was applied", () => {
    // 0147 and 0159 share when=1748304000000. On an incremental deploy 0147 is
    // already recorded; 0159 was ADDED later sharing the same when.
    const WHEN = 1748304000000;
    const entries = [
      entry(149, "0147_quantum_mc_runs_replay_uniqueness", WHEN),
      entry(159, "0159_broker_accounts_ab_paper_routing", WHEN),
    ];
    // Applied table: ONLY 0147's when + hash present (the incremental-deploy state).
    const appliedWhens = new Set([String(WHEN)]);
    const appliedHashes = new Set(["h:0147_quantum_mc_runs_replay_uniqueness"]);

    const pending = computePendingMigrations(entries, appliedWhens, appliedHashes, hashByTag);

    // The BUG this closes: pre-fix, `when`-only dedup dropped BOTH twins (0159
    // never ran). Post-fix, 0159 is correctly pending.
    expect(pending.map((e) => e.tag)).toEqual(["0159_broker_accounts_ab_paper_routing"]);
  });

  it("duplicate-`when` twin — neither pending when BOTH hashes applied (fresh-bootstrap state)", () => {
    const WHEN = 1748304000000;
    const entries = [entry(149, "0147_x", WHEN), entry(159, "0159_y", WHEN)];
    const pending = computePendingMigrations(
      entries,
      new Set([String(WHEN)]),
      new Set(["h:0147_x", "h:0159_y"]),
      hashByTag,
    );
    expect(pending).toEqual([]);
  });

  it("duplicate-`when` twin with an unreadable/missing file → treated pending (apply loop will report)", () => {
    const WHEN = 1748304000000;
    const entries = [entry(149, "0147_x", WHEN), entry(159, "0159_missing", WHEN)];
    const nullForMissing = (e: JournalEntry): string | null =>
      e.tag === "0159_missing" ? null : `h:${e.tag}`;
    const pending = computePendingMigrations(
      entries,
      new Set([String(WHEN)]),
      new Set(["h:0147_x"]),
      nullForMissing,
    );
    expect(pending.map((e) => e.tag)).toEqual(["0159_missing"]);
  });

  it("does not read files (call the hasher) for unique-`when` entries", () => {
    let hasherCalls = 0;
    const countingHasher = (e: JournalEntry): string | null => {
      hasherCalls += 1;
      return `h:${e.tag}`;
    };
    const entries = [entry(1, "0001_a", 100), entry(2, "0002_b", 200)];
    computePendingMigrations(entries, new Set(), new Set(), countingHasher);
    expect(hasherCalls).toBe(0); // fast path never hashes
  });
});
