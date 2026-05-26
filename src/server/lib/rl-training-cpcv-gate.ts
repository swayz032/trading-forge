/**
 * rl-training-cpcv-gate.ts — Wave 29 Pass C.3 (backtest-core)
 *
 * Pure-function CPCV purge gate for RL training data.
 *
 * Institutional 2026 mandate: RL policies must not train on bars whose
 * timestamps fall within any OOS fold's [oos_start, oos_end] range.
 * IS/OOS overlap in training data introduces lookahead leakage and inflates
 * in-sample performance estimates — the same purge contract enforced by
 * db_loader.py (Wave 27 Pass 1) for quantum replay, now mirrored for RL.
 *
 * Design:
 *   - PURE FUNCTIONS ONLY — no I/O, no Date.now(), no side effects.
 *     The gate is replay-deterministic: same inputs → same output always.
 *   - Training rows carry cpcv_fold_id + fold_phase from quantum_rl_runs.
 *   - OOS folds carry oos_start + oos_end from walk_forward_windows.
 *   - A row is flagged as leaked when its fold_phase === "is" AND
 *     the cpcv_fold_id's corresponding dates overlap with any OOS window.
 *     The stricter check: any IS row whose timestamp falls within any OOS
 *     [oos_start, oos_end] range is rejected.
 *   - On leakage detection → emits quantum_rl.training_cpcv_purge_violation
 *     audit (via returned payload; caller inserts).
 *
 * Mirrors: src/engine/replay/db_loader.py CPCV purge enforcement (oos_start > is_end).
 *
 * Import notes (CLAUDE.md feedback_helper_logger_import.md):
 *   logger imported from ./logger.js leaf — never from ../index.js.
 */

import { logger } from "./logger.js";

// ─── Input / Output Types ─────────────────────────────────────────────────────

/**
 * One RL training row from quantum_rl_runs.
 * The gate only needs the fold context, not the full state vector.
 */
export interface RlTrainingRow {
  /** quantum_rl_runs.id — for error reporting */
  row_id?: number | string | null;
  /** walk_forward_windows.id — FK; nullable for live-paper rows (skip purge) */
  cpcv_fold_id: number | string | null;
  /** "is" | "oos" | null — sourced from governance_labels or explicit field */
  fold_phase: string | null;
  /** ISO-8601 date string YYYY-MM-DD — bar date for this row; nullable for non-bar rows */
  bar_date?: string | null;
}

/**
 * One OOS fold from walk_forward_windows.
 */
export interface OosFold {
  /** walk_forward_windows.id (numeric or UUID) */
  fold_id: number | string;
  /** ISO-8601 date YYYY-MM-DD — start of OOS period (inclusive) */
  oos_start: string | null;
  /** ISO-8601 date YYYY-MM-DD — end of OOS period (inclusive) */
  oos_end: string | null;
}

/**
 * Result returned by validateRlTrainingCpcvPurge.
 */
export interface RlCpcvGateResult {
  /** True when no leakage detected; false when training set must be rejected. */
  ok: boolean;
  /** Count of training rows detected as IS/OOS leakage. */
  leakageRowCount: number;
  /** Human-readable block reason when ok=false. */
  blockedReason?: string;
  /**
   * Audit payload to merge into audit_log.result when ok=false.
   * Caller is responsible for inserting the audit row.
   * action = "quantum_rl.training_cpcv_purge_violation"
   */
  auditPayload?: {
    leakage_row_count: number;
    total_training_rows: number;
    oos_folds_checked: number;
    sample_leaked_fold_ids: Array<number | string>;
    blocked_reason: string;
  };
}

// ─── Date helpers (pure, no Date.now()) ──────────────────────────────────────

/** Parse YYYY-MM-DD → UTC epoch ms. Returns null for invalid input. */
function _parseDateMs(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  // Accept only YYYY-MM-DD format
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (isNaN(ms)) return null;
  return ms;
}

/** Returns true when testDate falls within [rangeStart, rangeEnd] (inclusive). */
function _dateInRange(
  testMs: number,
  startMs: number | null,
  endMs: number | null,
): boolean {
  if (startMs === null || endMs === null) return false;
  return testMs >= startMs && testMs <= endMs;
}

// ─── Fold index (OOS ranges pre-parsed once) ─────────────────────────────────

interface _ParsedOosFold {
  fold_id: number | string;
  startMs: number | null;
  endMs: number | null;
}

function _parseOosFolds(oosFolds: OosFold[]): _ParsedOosFold[] {
  return oosFolds.map((f) => ({
    fold_id: f.fold_id,
    startMs: _parseDateMs(f.oos_start),
    endMs: _parseDateMs(f.oos_end),
  }));
}

// ─── Main Gate Function ───────────────────────────────────────────────────────

/**
 * Validate that RL training rows carry no IS/OOS leakage.
 *
 * A training row is considered leaked when ALL of:
 *   1. fold_phase === "is"  (IS-phase row — should be training-safe)
 *   2. cpcv_fold_id is non-null  (fold-aware row; live-paper rows skip purge)
 *   3. bar_date falls within any OOS fold's [oos_start, oos_end] range
 *
 * Row types that are skipped (not flagged as leakage):
 *   - fold_phase !== "is"  (OOS rows, live-paper rows)
 *   - cpcv_fold_id is null  (live-paper inference rows)
 *   - bar_date is null  (non-bar metadata rows)
 *
 * @param trainingRows  Array of RL training rows to inspect.
 * @param oosFolds      OOS fold ranges from walk_forward_windows.
 * @returns             Gate result — ok=false when any leakage detected.
 */
export function validateRlTrainingCpcvPurge(
  trainingRows: RlTrainingRow[],
  oosFolds: OosFold[],
): RlCpcvGateResult {
  if (trainingRows.length === 0) {
    logger.debug(
      { oosFoldsCount: oosFolds.length },
      "rl-training-cpcv-gate: empty training set — gate trivially passes",
    );
    return { ok: true, leakageRowCount: 0 };
  }

  if (oosFolds.length === 0) {
    // No OOS folds → nothing to check against; pass through
    logger.debug(
      { trainingRowCount: trainingRows.length },
      "rl-training-cpcv-gate: no OOS folds provided — gate trivially passes",
    );
    return { ok: true, leakageRowCount: 0 };
  }

  const parsedFolds = _parseOosFolds(oosFolds);

  // Track leaked rows
  let leakageCount = 0;
  const leakedFoldIds = new Set<number | string>();

  for (const row of trainingRows) {
    // Skip non-IS rows and rows without fold or bar context
    if (row.fold_phase !== "is") continue;
    if (row.cpcv_fold_id === null || row.cpcv_fold_id === undefined) continue;
    if (!row.bar_date) continue;

    const barMs = _parseDateMs(row.bar_date);
    if (barMs === null) {
      logger.warn(
        { row_id: row.row_id, bar_date: row.bar_date },
        "rl-training-cpcv-gate: unparseable bar_date — skipping row",
      );
      continue;
    }

    // Check if this bar date falls within ANY OOS window
    for (const fold of parsedFolds) {
      if (_dateInRange(barMs, fold.startMs, fold.endMs)) {
        leakageCount++;
        leakedFoldIds.add(row.cpcv_fold_id);
        break; // One match is enough to flag this row
      }
    }
  }

  if (leakageCount === 0) {
    logger.debug(
      { trainingRowCount: trainingRows.length, oosFoldsCount: oosFolds.length },
      "rl-training-cpcv-gate: PASS — no IS/OOS leakage detected",
    );
    return { ok: true, leakageRowCount: 0 };
  }

  const blockedReason =
    `IS/OOS leakage detected: ${leakageCount} training rows overlap with OOS fold date ranges. ` +
    `Affected fold ids: [${Array.from(leakedFoldIds).slice(0, 5).join(", ")}]. ` +
    `RL policy must not train on data from OOS windows (CPCV purge contract).`;

  logger.warn(
    {
      leakageRowCount: leakageCount,
      totalTrainingRows: trainingRows.length,
      oosFoldsChecked: oosFolds.length,
      sampleLeakedFoldIds: Array.from(leakedFoldIds).slice(0, 5),
    },
    "rl-training-cpcv-gate: FAIL — IS/OOS leakage detected",
  );

  return {
    ok: false,
    leakageRowCount: leakageCount,
    blockedReason,
    auditPayload: {
      leakage_row_count: leakageCount,
      total_training_rows: trainingRows.length,
      oos_folds_checked: oosFolds.length,
      sample_leaked_fold_ids: Array.from(leakedFoldIds).slice(0, 10),
      blocked_reason: blockedReason,
    },
  };
}
