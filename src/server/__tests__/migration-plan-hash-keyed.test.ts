/**
 * migration-plan-hash-keyed.test.ts — deep-scan Autonomy F1 (HIGH): the boot-migration plan must
 * key on migration HASH (identity), not the journal `when` epoch, so two entries sharing a `when`
 * can no longer cause the second to be silently skipped. The BACKFILL decision also keys on hash
 * (re-cert Finding B), so a wrong-content entry sharing a collision timestamp is applied, never
 * blind-marked-applied. Pure-function tests (leaf lib, no db boot).
 *
 * deep-scan fresh-bootstrap fix (2026-07-10): KNOWN_OUT_OF_BAND_APPLIED_HASHES is now EMPTY (all
 * 10 formerly-backfilled migrations were re-verified idempotent-safe to just re-apply — see the
 * map's doc comment in migration-journal-utils.ts). The backfill MECHANISM itself is still real
 * and tested here via the new injectable `outOfBandHashes` 5th parameter with a SYNTHETIC map, so
 * coverage doesn't depend on any real migration's content. A separate block asserts the actual
 * shipped default (the real, now-empty KNOWN_OUT_OF_BAND_APPLIED_HASHES) never backfills anything.
 */
import { describe, it, expect } from "vitest";
import {
  computeMigrationPlan,
  KNOWN_OUT_OF_BAND_APPLIED_WHENS,
  KNOWN_OUT_OF_BAND_APPLIED_HASHES,
} from "../lib/migration-journal-utils.js";

type E = { when: number; tag: string };

// Historical when-collision pairs (documentation only — KNOWN_OUT_OF_BAND_APPLIED_WHENS is dead
// in the runtime path; computeMigrationPlan never reads it). Reused below purely as realistic
// `when` values for synthetic-map tests, not because the pending decision depends on them.
const KNOWN_WHEN = [...KNOWN_OUT_OF_BAND_APPLIED_WHENS][0]; // 1776200000000 (0044a/0052)

// A synthetic out-of-band map for testing the BACKFILL mechanism in isolation, independent of
// the real (now-empty) KNOWN_OUT_OF_BAND_APPLIED_HASHES default.
const SYNTHETIC_HASH = "synthetic-verified-sibling-hash";
const SYNTHETIC_OUT_OF_BAND: ReadonlyMap<string, string> = new Map([
  [SYNTHETIC_HASH, "synthetic_sibling_migration"],
]);

// hashOf resolver from a tag→hash map; a tag absent means "unreadable .sql" (null) → default hash-<tag>.
function resolver(map: Record<string, string | null>) {
  return (e: E) => (e.tag in map ? map[e.tag] : `hash-${e.tag}`);
}

describe("computeMigrationPlan — hash-keyed pending + hash-keyed backfill (F1 + Finding B)", () => {
  it("applied-by-hash → skipped (neither applied nor backfilled)", () => {
    const plan = computeMigrationPlan([{ when: 100, tag: "a" }], new Set(), new Set(["hash-a"]), resolver({}));
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("normal new migration → APPLY", () => {
    const plan = computeMigrationPlan([{ when: 200, tag: "b" }], new Set(), new Set(), resolver({}));
    expect(plan.toApply.map((e) => e.tag)).toEqual(["b"]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("THE BUG FIX — a FUTURE when-collision (hash not applied, not a known sibling) → APPLY, not skipped", () => {
    const plan = computeMigrationPlan(
      [{ when: 999, tag: "second" }],
      new Set(["999"]), // when recorded by the collision partner
      new Set(["hash-first"]), // only partner's hash applied
      resolver({}), // second → hash-second (not applied, not a known sibling)
    );
    expect(plan.toApply.map((e) => e.tag)).toEqual(["second"]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("out-of-band sibling identified by exact HASH (synthetic map) → BACKFILL, not re-run", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "synthetic_sibling_migration" }],
      new Set([String(KNOWN_WHEN)]),
      new Set(),
      () => SYNTHETIC_HASH, // exact synthetic-sibling content hash
      SYNTHETIC_OUT_OF_BAND, // injected map — mechanism test, independent of real (empty) default
    );
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["synthetic_sibling_migration"]);
    expect(plan.toApply).toEqual([]);
  });

  it("FINDING B — entry sharing a known WHEN but with DIFFERENT content (non-matching hash) → APPLY, never blind-backfill", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "corrupt_or_reused_timestamp" }],
      new Set([String(KNOWN_WHEN)]),
      new Set(),
      () => "not-a-known-sibling-hash",
      SYNTHETIC_OUT_OF_BAND,
    );
    expect(plan.toApply.map((e) => e.tag)).toEqual(["corrupt_or_reused_timestamp"]);
    expect(plan.toBackfill).toEqual([]); // schema NOT assumed present — applied, not silently recorded
  });

  it("known sibling but hash ALREADY applied → skipped (never re-backfilled)", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "synthetic_sibling_migration" }],
      new Set([String(KNOWN_WHEN)]),
      new Set([SYNTHETIC_HASH]), // already recorded by hash
      () => SYNTHETIC_HASH,
      SYNTHETIC_OUT_OF_BAND,
    );
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("hash unreadable (null) + when applied → fallback skip (never worse than pre-F1)", () => {
    const plan = computeMigrationPlan([{ when: 300, tag: "c" }], new Set(["300"]), new Set(), resolver({ c: null }));
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("hash unreadable (null) + when NOT applied → fallback APPLY", () => {
    const plan = computeMigrationPlan([{ when: 400, tag: "d" }], new Set(), new Set(), resolver({ d: null }));
    expect(plan.toApply.map((e) => e.tag)).toEqual(["d"]);
  });

  it("mixed batch: applied / new / future-collision / known-sibling (synthetic) all routed correctly", () => {
    const entries: E[] = [
      { when: 1, tag: "done" },
      { when: 2, tag: "fresh" },
      { when: 3, tag: "future_dup" },
      { when: KNOWN_WHEN, tag: "synthetic_sibling_migration" },
    ];
    const hashOf = (e: E) => (e.tag === "synthetic_sibling_migration" ? SYNTHETIC_HASH : `hash-${e.tag}`);
    const plan = computeMigrationPlan(
      entries,
      new Set(["3", String(KNOWN_WHEN)]),
      new Set(["hash-done"]),
      hashOf,
      SYNTHETIC_OUT_OF_BAND,
    );
    expect(plan.toApply.map((e) => e.tag).sort()).toEqual(["fresh", "future_dup"]);
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["synthetic_sibling_migration"]);
  });
});

describe("KNOWN_OUT_OF_BAND_APPLIED_HASHES — real default is EMPTY (fresh-bootstrap fix, 2026-07-10)", () => {
  it("the shipped map has zero entries", () => {
    expect(KNOWN_OUT_OF_BAND_APPLIED_HASHES.size).toBe(0);
  });

  it("the 5 former when-collision pairs now BOTH route to toApply under the real default (none silently skipped via backfill)", () => {
    // Reproduces the exact 5 pairs documented in KNOWN_OUT_OF_BAND_APPLIED_WHENS, but exercised
    // through computeMigrationPlan's REAL default (no injected map) to prove the production
    // behavior: on a fresh bootstrap (empty appliedWhens/appliedHashes), every one of the 10
    // formerly-backfilled migrations is now actually applied, not silently ledger-recorded.
    const pairs: Array<[number, string, string]> = [
      [1776200000000, "0044a_system_parameters_tables", "0052_fk_cascade_hardening"],
      [1748304000000, "0147_quantum_mc_runs_replay_uniqueness", "0159_broker_accounts_ab_paper_routing"],
      [1748390400000, "0148_backtests_compliance_mode", "0160_shadow_signals"],
      [1748563200000, "0152_strategies_needs_revision_states", "0162_needs_archetype_queue"],
      [1748649600000, "0153_pipeline_modes_autopause", "0164_slumhouse_users"],
    ];
    const entries: E[] = pairs.flatMap(([when, a, b]) => [
      { when, tag: a },
      { when, tag: b },
    ]);
    // Fresh bootstrap: nothing applied yet, hashOf returns a distinct per-tag hash (as it would
    // for 10 real, distinct .sql files with different byte content).
    const plan = computeMigrationPlan(entries, new Set(), new Set(), (e) => `hash-${e.tag}`);
    expect(plan.toBackfill).toEqual([]); // nothing backfilled — the class-3 fresh-bootstrap fix
    expect(plan.toApply.map((e) => e.tag).sort()).toEqual([...entries.map((e) => e.tag)].sort());
  });
});
