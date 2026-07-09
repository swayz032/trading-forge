/**
 * migration-plan-hash-keyed.test.ts — deep-scan Autonomy F1 (HIGH): the boot-migration plan must
 * key on migration HASH (identity), not the journal `when` epoch, so two entries sharing a `when`
 * can no longer cause the second to be silently skipped. The BACKFILL decision also keys on hash
 * (re-cert Finding B), so a wrong-content entry sharing a collision timestamp is applied, never
 * blind-marked-applied. Pure-function tests (leaf lib, no db boot).
 */
import { describe, it, expect } from "vitest";
import {
  computeMigrationPlan,
  KNOWN_OUT_OF_BAND_APPLIED_WHENS,
  KNOWN_OUT_OF_BAND_APPLIED_HASHES,
} from "../lib/migration-journal-utils.js";

type E = { when: number; tag: string };
const KNOWN_WHEN = [...KNOWN_OUT_OF_BAND_APPLIED_WHENS][0]; // 1776200000000 (0044a/0052)
const KNOWN_HASH = [...KNOWN_OUT_OF_BAND_APPLIED_HASHES.keys()][0]; // an exact verified-sibling hash

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

  it("out-of-band sibling identified by exact HASH → BACKFILL, not re-run", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "0052_fk_cascade_hardening" }],
      new Set([String(KNOWN_WHEN)]),
      new Set(),
      () => KNOWN_HASH, // exact verified-sibling content hash
    );
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["0052_fk_cascade_hardening"]);
    expect(plan.toApply).toEqual([]);
  });

  it("FINDING B — entry sharing a known WHEN but with DIFFERENT content (non-matching hash) → APPLY, never blind-backfill", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "corrupt_or_reused_timestamp" }],
      new Set([String(KNOWN_WHEN)]),
      new Set(),
      () => "not-a-known-sibling-hash",
    );
    expect(plan.toApply.map((e) => e.tag)).toEqual(["corrupt_or_reused_timestamp"]);
    expect(plan.toBackfill).toEqual([]); // schema NOT assumed present — applied, not silently recorded
  });

  it("known sibling but hash ALREADY applied → skipped (never re-backfilled)", () => {
    const plan = computeMigrationPlan(
      [{ when: KNOWN_WHEN, tag: "0052_fk_cascade_hardening" }],
      new Set([String(KNOWN_WHEN)]),
      new Set([KNOWN_HASH]), // already recorded by hash
      () => KNOWN_HASH,
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

  it("mixed batch: applied / new / future-collision / known-sibling all routed correctly", () => {
    const knownSiblingHash = [...KNOWN_OUT_OF_BAND_APPLIED_HASHES.keys()][5]; // 0160_shadow_signals
    const entries: E[] = [
      { when: 1, tag: "done" },
      { when: 2, tag: "fresh" },
      { when: 3, tag: "future_dup" },
      { when: KNOWN_WHEN, tag: "0160_shadow_signals" },
    ];
    const hashOf = (e: E) => (e.tag === "0160_shadow_signals" ? knownSiblingHash : `hash-${e.tag}`);
    const plan = computeMigrationPlan(entries, new Set(["3", String(KNOWN_WHEN)]), new Set(["hash-done"]), hashOf);
    expect(plan.toApply.map((e) => e.tag).sort()).toEqual(["fresh", "future_dup"]);
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["0160_shadow_signals"]);
  });
});
