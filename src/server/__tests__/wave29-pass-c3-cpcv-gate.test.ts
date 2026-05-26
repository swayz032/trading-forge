/**
 * wave29-pass-c3-cpcv-gate.test.ts — Wave 29 Pass C.3
 *
 * Tests for the TS CPCV purge gate (rl-training-cpcv-gate.ts).
 * Pure-function tests — no DB, no I/O, fully deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  validateRlTrainingCpcvPurge,
  type RlTrainingRow,
  type OosFold,
} from "../lib/rl-training-cpcv-gate.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OOS_FOLD_APR: OosFold = {
  fold_id: 1,
  oos_start: "2024-04-01",
  oos_end: "2024-04-30",
};
const OOS_FOLD_JUL: OosFold = {
  fold_id: 2,
  oos_start: "2024-07-01",
  oos_end: "2024-07-31",
};

// ─── Empty / trivial cases ────────────────────────────────────────────────────

describe("validateRlTrainingCpcvPurge — trivial cases", () => {
  it("passes when training set is empty", () => {
    const result = validateRlTrainingCpcvPurge([], [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes when OOS folds are empty", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, []);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes when both are empty", () => {
    const result = validateRlTrainingCpcvPurge([], []);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });
});

// ─── Clean cases (no leakage) ─────────────────────────────────────────────────

describe("validateRlTrainingCpcvPurge — clean training data", () => {
  it("passes IS rows with bar_dates before OOS window", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-03-15" },
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-02-20" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes IS rows with bar_dates after OOS window", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-05-01" },
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-06-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes OOS-phase rows even if their dates fall within OOS window", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "oos", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes live-paper rows (cpcv_fold_id null)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: null, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("passes IS rows with null bar_date (non-bar metadata rows)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: null },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });
});

// ─── Leakage detection ────────────────────────────────────────────────────────

describe("validateRlTrainingCpcvPurge — leakage detection", () => {
  it("detects IS row whose bar_date is inside OOS window", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(false);
    expect(result.leakageRowCount).toBe(1);
    expect(result.blockedReason).toContain("IS/OOS leakage");
  });

  it("detects boundary start date (oos_start inclusive)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-01" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(false);
    expect(result.leakageRowCount).toBe(1);
  });

  it("detects boundary end date (oos_end inclusive)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-30" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(false);
    expect(result.leakageRowCount).toBe(1);
  });

  it("date 1 day before OOS start is clean (not inclusive of prior-day)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-03-31" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("counts all leaked rows across multiple OOS folds", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },  // fold 1 OOS
      { cpcv_fold_id: 2, fold_phase: "is", bar_date: "2024-07-15" },  // fold 2 OOS
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-03-15" },  // clean
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR, OOS_FOLD_JUL]);
    expect(result.ok).toBe(false);
    expect(result.leakageRowCount).toBe(2);
  });

  it("includes auditPayload when leakage detected", () => {
    const rows: RlTrainingRow[] = [
      { row_id: 42, cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(false);
    expect(result.auditPayload).toBeDefined();
    expect(result.auditPayload!.leakage_row_count).toBe(1);
    expect(result.auditPayload!.total_training_rows).toBe(1);
    expect(result.auditPayload!.oos_folds_checked).toBe(1);
    expect(result.auditPayload!.sample_leaked_fold_ids).toContain(1);
  });

  it("auditPayload is undefined when no leakage", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-03-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    expect(result.ok).toBe(true);
    expect(result.auditPayload).toBeUndefined();
  });
});

// ─── OOS fold with null dates ─────────────────────────────────────────────────

describe("validateRlTrainingCpcvPurge — OOS fold with null dates", () => {
  it("skips OOS fold with null oos_start — does not leak on matching date", () => {
    const folds: OosFold[] = [
      { fold_id: 1, oos_start: null, oos_end: "2024-04-30" },
    ];
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, folds);
    // null oos_start → range unparseable → no overlap possible
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });

  it("skips OOS fold with null oos_end", () => {
    const folds: OosFold[] = [
      { fold_id: 1, oos_start: "2024-04-01", oos_end: null },
    ];
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "2024-04-15" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, folds);
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });
});

// ─── Unparseable bar_date ─────────────────────────────────────────────────────

describe("validateRlTrainingCpcvPurge — unparseable bar_date", () => {
  it("skips rows with invalid bar_date format (no crash)", () => {
    const rows: RlTrainingRow[] = [
      { cpcv_fold_id: 1, fold_phase: "is", bar_date: "not-a-date" },
    ];
    const result = validateRlTrainingCpcvPurge(rows, [OOS_FOLD_APR]);
    // Unparseable → skip → no leakage
    expect(result.ok).toBe(true);
    expect(result.leakageRowCount).toBe(0);
  });
});
