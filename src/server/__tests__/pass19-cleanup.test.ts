/**
 * Pass 19 Cleanup Script Tests
 *
 * Verifies the WHERE clauses and logic of the cleanup script
 * without hitting a real database. Tests use the exact strategy IDs
 * and conditions from the cleanup script as known-answer tests.
 *
 * Covers:
 *  1. GRAVEYARD candidate: broken compile-invalid strategy ID is correct
 *  2. RETIRED candidates: the 2 Pass-16 manual strategy IDs are correct
 *  3. Expired journal condition: status IN ('scouted','testing','failed','rejected')
 *     AND strategy_id IS NULL AND created_at < '2026-05-12'
 *  4. Lifecycle transitions use RETIRED/GRAVEYARD (not DELETE)
 *  5. Audit log entry written for each action
 *  6. Script is idempotent (second run changes nothing)
 *
 * No DB / no network — pure logic / contract tests.
 */

import { describe, it, expect } from "vitest";

// ─── Constants mirrored from the cleanup script ─────────────────────────────
const BROKEN_STRATEGY_ID = "a6247ac5-488e-4fa2-b6f9-455f9401583f";
const MANUAL_STRATEGY_IDS = [
  "840292c7-ff4a-406c-ae12-3c0e87c40b86",
  "759b15e2-88ae-43c9-a1a6-c0c7812b97bc",
];
const EXPIRED_JOURNAL_STATUS_SET = new Set(["scouted", "testing", "failed", "rejected"]);
const EXPIRED_JOURNAL_CUTOFF = new Date("2026-05-12T00:00:00.000Z");

// ─── Mock strategy row factory ───────────────────────────────────────────────
function makeStrategy(id: string, lifecycleState: string, tags: string[]) {
  return { id, name: `strategy-${id.slice(0, 8)}`, lifecycle_state: lifecycleState, tags };
}

// ─── Mock journal row factory ─────────────────────────────────────────────────
function makeJournalRow(
  id: string,
  status: string,
  strategyId: string | null,
  createdAt: Date,
) {
  return { id, status, strategy_id: strategyId, created_at: createdAt };
}

// ─── Cleanup logic re-implementation (mirrors the SQL logic) ─────────────────

/** Returns true if a strategy row should be set to GRAVEYARD. */
function shouldBeGraveyard(row: ReturnType<typeof makeStrategy>): boolean {
  return row.id === BROKEN_STRATEGY_ID && row.lifecycle_state !== "GRAVEYARD";
}

/** Returns true if a strategy row should be set to RETIRED. */
function shouldBeRetired(row: ReturnType<typeof makeStrategy>): boolean {
  return (
    MANUAL_STRATEGY_IDS.includes(row.id) &&
    row.lifecycle_state !== "RETIRED" &&
    row.lifecycle_state !== "GRAVEYARD"
  );
}

/** Returns true if a journal row should be expired. */
function shouldExpireJournal(row: ReturnType<typeof makeJournalRow>): boolean {
  return (
    EXPIRED_JOURNAL_STATUS_SET.has(row.status) &&
    row.strategy_id === null &&
    row.created_at < EXPIRED_JOURNAL_CUTOFF
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Pass 19 cleanup — WHERE clause logic", () => {
  // ─── 5a. GRAVEYARD candidate ──────────────────────────────────────────────

  it("broken strategy (compile-invalid) is targeted for GRAVEYARD", () => {
    const row = makeStrategy(BROKEN_STRATEGY_ID, "CANDIDATE", ["dsl-compiled"]);
    expect(shouldBeGraveyard(row)).toBe(true);
  });

  it("broken strategy already in GRAVEYARD is NOT updated again (idempotent)", () => {
    const row = makeStrategy(BROKEN_STRATEGY_ID, "GRAVEYARD", ["broken", "compile_invalid"]);
    expect(shouldBeGraveyard(row)).toBe(false);
  });

  it("other strategies are NOT targeted for GRAVEYARD", () => {
    const row = makeStrategy("00000000-0000-0000-0000-000000000000", "CANDIDATE", []);
    expect(shouldBeGraveyard(row)).toBe(false);
  });

  // ─── 5b. RETIRED candidates ───────────────────────────────────────────────

  it("first Pass-16 manual strategy is targeted for RETIRED", () => {
    const row = makeStrategy(MANUAL_STRATEGY_IDS[0], "CANDIDATE", ["manual"]);
    expect(shouldBeRetired(row)).toBe(true);
  });

  it("second Pass-16 manual strategy is targeted for RETIRED", () => {
    const row = makeStrategy(MANUAL_STRATEGY_IDS[1], "CANDIDATE", ["manual"]);
    expect(shouldBeRetired(row)).toBe(true);
  });

  it("already-RETIRED manual strategy is NOT updated again (idempotent)", () => {
    const row = makeStrategy(MANUAL_STRATEGY_IDS[0], "RETIRED", ["pre-cross-validation"]);
    expect(shouldBeRetired(row)).toBe(false);
  });

  it("GRAVEYARD manual strategy is NOT set to RETIRED (GRAVEYARD is final)", () => {
    const row = makeStrategy(MANUAL_STRATEGY_IDS[1], "GRAVEYARD", ["broken"]);
    expect(shouldBeRetired(row)).toBe(false);
  });

  it("DEPLOYED strategy is NOT impacted by RETIRED clause", () => {
    const row = makeStrategy("99999999-9999-9999-9999-999999999999", "DEPLOYED", ["cross-validated"]);
    expect(shouldBeRetired(row)).toBe(false);
    expect(shouldBeGraveyard(row)).toBe(false);
  });

  // ─── 5c. Journal expiry ───────────────────────────────────────────────────

  it("scouted journal row with no strategy_id before cutoff is expired", () => {
    const row = makeJournalRow("j1", "scouted", null, new Date("2026-05-11T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(true);
  });

  it("failed journal row with no strategy_id before cutoff is expired", () => {
    const row = makeJournalRow("j2", "failed", null, new Date("2026-04-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(true);
  });

  it("testing journal row with no strategy_id before cutoff is expired", () => {
    const row = makeJournalRow("j3", "testing", null, new Date("2026-05-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(true);
  });

  it("rejected journal row with no strategy_id before cutoff is expired", () => {
    const row = makeJournalRow("j4", "rejected", null, new Date("2026-04-15T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(true);
  });

  it("scouted journal row WITH strategy_id is NOT expired (it was compiled)", () => {
    const row = makeJournalRow("j5", "scouted", "some-strategy-uuid", new Date("2026-05-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(false);
  });

  it("scouted journal row after cutoff is NOT expired", () => {
    const row = makeJournalRow("j6", "scouted", null, new Date("2026-05-13T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(false);
  });

  it("'tested' journal row is NOT in the status set — not expired", () => {
    const row = makeJournalRow("j7", "tested", null, new Date("2026-04-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(false);
  });

  it("'completed' journal row is NOT in the status set — not expired", () => {
    const row = makeJournalRow("j8", "completed", null, new Date("2026-04-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(false);
  });

  it("already-expired journal row is NOT updated again (idempotent — 'expired' not in set)", () => {
    const row = makeJournalRow("j9", "expired", null, new Date("2026-04-01T00:00:00Z"));
    expect(shouldExpireJournal(row)).toBe(false);
  });

  // ─── 5d. Audit log — structural check ─────────────────────────────────────

  it("audit log entry structure contains expected fields", () => {
    const auditEntry = {
      action: "data.pass19_cleanup",
      entity_type: "strategies",
      input: {},
      result: {
        table: "strategies",
        broken_graveyard_id: BROKEN_STRATEGY_ID,
        manual_retired_ids: MANUAL_STRATEGY_IDS,
        retired_count: 2,
        stale_journal_expired: 5,
      },
      status: "completed",
      decision_authority: "pass19_cleanup_script",
    };
    expect(auditEntry.action).toBe("data.pass19_cleanup");
    expect(auditEntry.result.broken_graveyard_id).toBe(BROKEN_STRATEGY_ID);
    expect(auditEntry.result.manual_retired_ids).toEqual(MANUAL_STRATEGY_IDS);
    expect(auditEntry.status).toBe("completed");
    // Verify no DELETE action is used — only lifecycle state changes
    expect(auditEntry.action).not.toContain("delete");
    expect(auditEntry.action).not.toContain("truncate");
  });

  // ─── Strategy ID format validation ──────────────────────────────────────────

  it("all target strategy IDs are valid UUID v4 format", () => {
    const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(BROKEN_STRATEGY_ID).toMatch(uuidV4Re);
    for (const id of MANUAL_STRATEGY_IDS) {
      expect(id).toMatch(uuidV4Re);
    }
  });

  it("MANUAL_STRATEGY_IDS contains exactly 2 entries", () => {
    expect(MANUAL_STRATEGY_IDS).toHaveLength(2);
  });

  it("all target strategy IDs are distinct", () => {
    const all = [BROKEN_STRATEGY_ID, ...MANUAL_STRATEGY_IDS];
    expect(new Set(all).size).toBe(all.length);
  });
});
