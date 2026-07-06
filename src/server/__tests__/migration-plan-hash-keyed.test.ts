/**
 * migration-plan-hash-keyed.test.ts — deep-scan Autonomy F1 (HIGH): the boot-migration plan must
 * key on migration HASH (identity), not the journal `when` epoch, so two entries sharing a `when`
 * can no longer cause the second to be silently skipped. Pure-function tests (leaf lib, no db boot).
 */
import { describe, it, expect } from "vitest";
import {
  computeMigrationPlan,
  KNOWN_OUT_OF_BAND_APPLIED_WHENS,
} from "../lib/migration-journal-utils.js";

type E = { when: number; tag: string };
const KNOWN_WHEN = [...KNOWN_OUT_OF_BAND_APPLIED_WHENS][0]; // 1776200000000 (0044a/0052)

// hashOf resolver from a tag→hash map; a tag absent from the map means "unreadable .sql" (null).
function resolver(map: Record<string, string | null>) {
  return (e: E) => (e.tag in map ? map[e.tag] : `hash-${e.tag}`);
}

describe("computeMigrationPlan — hash-keyed pending (F1)", () => {
  it("applied-by-hash → skipped (neither applied nor backfilled)", () => {
    const entries: E[] = [{ when: 100, tag: "a" }];
    const plan = computeMigrationPlan(entries, new Set(), new Set(["hash-a"]), resolver({}));
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("normal new migration (hash unknown, ordinary when) → APPLY", () => {
    const entries: E[] = [{ when: 200, tag: "b" }];
    const plan = computeMigrationPlan(entries, new Set(), new Set(), resolver({}));
    expect(plan.toApply.map((e) => e.tag)).toEqual(["b"]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("THE BUG FIX — a FUTURE when-collision (when recorded, NOT in known set) → APPLY, not skipped", () => {
    // entry `second` shares when=999 with an already-applied `first`; pre-F1 it was silently skipped.
    const entries: E[] = [{ when: 999, tag: "second" }];
    const plan = computeMigrationPlan(
      entries,
      new Set(["999"]), // when 999 recorded by the collision partner
      new Set(["hash-first"]), // only the partner's hash is applied
      resolver({}), // second → hash-second (not applied)
    );
    expect(plan.toApply.map((e) => e.tag)).toEqual(["second"]); // applied now, no longer silent-skip
    expect(plan.toBackfill).toEqual([]);
  });

  it("known out-of-band sibling (known when, when recorded, hash not applied) → BACKFILL, not re-run", () => {
    const entries: E[] = [{ when: KNOWN_WHEN, tag: "0052_fk_cascade_hardening" }];
    const plan = computeMigrationPlan(
      entries,
      new Set([String(KNOWN_WHEN)]), // the collision `when` is recorded (by its partner)
      new Set(["hash-0044a"]), // partner applied; 0052's hash not recorded
      resolver({}),
    );
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["0052_fk_cascade_hardening"]);
    expect(plan.toApply).toEqual([]); // schema present → record ledger, never re-run the SQL
  });

  it("known when but hash IS applied → skipped (never re-backfilled)", () => {
    const entries: E[] = [{ when: KNOWN_WHEN, tag: "0052_fk_cascade_hardening" }];
    const plan = computeMigrationPlan(
      entries,
      new Set([String(KNOWN_WHEN)]),
      new Set(["hash-0052_fk_cascade_hardening"]), // already recorded by hash
      resolver({}),
    );
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("hash unreadable (null) + when applied → fallback skip (never worse than pre-F1)", () => {
    const entries: E[] = [{ when: 300, tag: "c" }];
    const plan = computeMigrationPlan(entries, new Set(["300"]), new Set(), resolver({ c: null }));
    expect(plan.toApply).toEqual([]);
    expect(plan.toBackfill).toEqual([]);
  });

  it("hash unreadable (null) + when NOT applied → fallback APPLY", () => {
    const entries: E[] = [{ when: 400, tag: "d" }];
    const plan = computeMigrationPlan(entries, new Set(), new Set(), resolver({ d: null }));
    expect(plan.toApply.map((e) => e.tag)).toEqual(["d"]);
  });

  it("mixed batch: applied / new / future-collision / known-sibling all routed correctly", () => {
    const entries: E[] = [
      { when: 1, tag: "done" }, // applied by hash → skip
      { when: 2, tag: "fresh" }, // new → apply
      { when: 3, tag: "future_dup" }, // future collision → apply
      { when: KNOWN_WHEN, tag: "0160_shadow_signals" }, // known sibling → backfill
    ];
    const plan = computeMigrationPlan(
      entries,
      new Set(["3", String(KNOWN_WHEN)]),
      new Set(["hash-done", "hash-partner3", `hash-0044a`]),
      resolver({}),
    );
    expect(plan.toApply.map((e) => e.tag).sort()).toEqual(["fresh", "future_dup"]);
    expect(plan.toBackfill.map((e) => e.tag)).toEqual(["0160_shadow_signals"]);
  });
});
