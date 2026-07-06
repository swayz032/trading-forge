/**
 * Correlated Position Guard — Tier 5.3.1 (W5b)
 *
 * TypeScript mirror of src/engine/compliance/compliance_gate.py:check_correlated_position_guard().
 * Implemented here (not as Python subprocess) because this runs on the hot bar-tick
 * evaluation path — a Python subprocess call per bar would add 50-200ms latency.
 *
 * Reads src/engine/compliance/correlation_matrix.yaml at module load time.
 * Falls back to an empty matrix (all pairs allowed) if YAML is unavailable.
 *
 * Symmetry: MNQ→MES and MES→MNQ produce identical decisions.
 * Parity: logic is identical to the Python implementation; both read the same YAML.
 * Audit: emits compliance.correlated_position_blocked log on every block.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyWarning } from "./notification-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const KILL_REASON_CORRELATED_POSITION_OPEN = "correlated_position_open";
export const DEFAULT_CORRELATION_THRESHOLD = 0.70;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorrelatedPositionGuardResult {
  allowed: boolean;
  reason: typeof KILL_REASON_CORRELATED_POSITION_OPEN | null;
  blockingSymbol: string | null;
  blockingCorrelation: number | null;
  threshold: number;
  symbol: string;
  topstepExceptionApplied?: boolean;
}

interface OpenPositionSymbol {
  symbol: string;
  // F-3: Topstep multi-account exception requires firm + userId + strategyId context
  firmId?: string | null;
  userId?: string | null;
  strategyId?: string | null;
}

// ─── Matrix Loading ───────────────────────────────────────────────────────────

interface CorrelationMatrix {
  correlations: Record<string, number>;
  threshold: number;
}

/**
 * Build the canonical pair key — lexicographically sorted, joined with '_'.
 * Symmetric: pairKey("MNQ", "MES") === pairKey("MES", "MNQ") === "MES_MNQ"
 */
export function pairKey(symbolA: string, symbolB: string): string {
  const parts = [symbolA.toUpperCase(), symbolB.toUpperCase()].sort();
  return `${parts[0]}_${parts[1]}`;
}

function loadCorrelationMatrix(): CorrelationMatrix {
  // Path: <project-root>/src/engine/compliance/correlation_matrix.yaml
  // Resolved relative to this file (src/server/services/) → up 2 dirs → src/engine/compliance/
  const yamlPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
    "../../engine/compliance/correlation_matrix.yaml",
  );

  const fallback: CorrelationMatrix = { correlations: {}, threshold: DEFAULT_CORRELATION_THRESHOLD };

  try {
    const raw = fs.readFileSync(yamlPath, "utf-8");
    // Minimal YAML parser for flat key: value format (no full YAML dependency needed)
    // The correlation_matrix.yaml only uses simple key: value pairs under "correlations:"
    const correlations: Record<string, number> = {};
    let threshold = DEFAULT_CORRELATION_THRESHOLD;
    let inCorrelationsBlock = false;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") continue;

      if (trimmed === "correlations:") {
        inCorrelationsBlock = true;
        continue;
      }

      // Top-level threshold key
      if (trimmed.startsWith("threshold:")) {
        inCorrelationsBlock = false;
        const val = trimmed.split(":")[1]?.trim();
        if (val) threshold = parseFloat(val);
        continue;
      }

      if (inCorrelationsBlock) {
        // Lines like: "  MES_MNQ: 0.95   # comment"
        const commentStripped = trimmed.split("#")[0].trim();
        const colonIdx = commentStripped.indexOf(":");
        if (colonIdx !== -1) {
          const key = commentStripped.slice(0, colonIdx).trim();
          const val = commentStripped.slice(colonIdx + 1).trim();
          if (key && val) {
            correlations[key] = parseFloat(val);
          }
        }
      }
    }

    logger.debug({ keys: Object.keys(correlations).length, threshold }, "Correlation matrix loaded");
    return { correlations, threshold };
  } catch (err) {
    logger.warn(
      { err, yamlPath },
      "Tier 5.3.1: correlation_matrix.yaml not loaded — guard defaults to pass-through (all pairs allowed)",
    );
    // deep-scan long-tail F-2 (CRITICAL): a missing/corrupt matrix silently disabled portfolio
    // concentration protection with NO operator-visible signal. Emit an audit row + Discord WARN so the
    // fail-OPEN is loud, not silent. Fire-and-forget: this loader is cached (getCorrelationMatrix memoizes
    // _matrix), so the alert fires ONCE per process on first load, never per signal.
    const errMsg = err instanceof Error ? err.message : String(err);
    void insertAuditRowSafe({
      action: "compliance.correlation_matrix_load_failed",
      entityType: "system",
      entityId: "correlation_matrix",
      status: "warning",
      decisionAuthority: "gate",
      result: {
        yamlPath,
        error: errMsg,
        impact: "correlated-position guard is PASS-THROUGH (all correlated pairs allowed) until the matrix loads",
      },
    }).catch(() => { /* audit is best-effort */ });
    try {
      notifyWarning(
        "Correlated-position guard DEGRADED — concentration protection is OFF",
        `correlation_matrix.yaml failed to load (${errMsg}). All correlated pairs (e.g. MES+MNQ) are currently ALLOWED. Restore the file to re-enable the guard.`,
      );
    } catch { /* alert is best-effort */ }
    return fallback;
  }
}

// Load once at module startup — static config, no need to reload per bar
let _matrix: CorrelationMatrix | null = null;

export function getCorrelationMatrix(): CorrelationMatrix {
  if (!_matrix) {
    _matrix = loadCorrelationMatrix();
  }
  return _matrix;
}

/** Test hook — reset the matrix so tests can inject their own. */
export function __resetCorrelationMatrixForTests(override?: CorrelationMatrix): void {
  _matrix = override ?? null;
}

// ─── Guard Function ───────────────────────────────────────────────────────────

/**
 * Check whether a proposed new entry is blocked by an existing correlated position.
 *
 * @param symbol            Proposed entry symbol
 * @param openPositions     All currently open positions (any session).
 *                          May carry { firmId, userId, strategyId } for F-3 exception logic.
 * @param matrixOverride    Inject a custom matrix (used in tests). If null, loads from YAML.
 * @param proposedFirmId    FirmId of the new entry's session (used for F-3 Topstep exception).
 * @param proposedUserId    UserId of the new entry's session (used for F-3 Topstep exception).
 * @param proposedStrategyId StrategyId of the new entry's session (used for F-3 Topstep exception).
 */
export function checkCorrelatedPositionGuard(
  symbol: string,
  openPositions: OpenPositionSymbol[],
  matrixOverride: CorrelationMatrix | null = null,
  proposedFirmId?: string | null,
  proposedUserId?: string | null,
  proposedStrategyId?: string | null,
): CorrelatedPositionGuardResult {
  const matrix = matrixOverride ?? getCorrelationMatrix();
  const { correlations, threshold } = matrix;

  // Empty open positions → always allowed (first trade of the day)
  if (openPositions.length === 0) {
    return {
      allowed: true,
      reason: null,
      blockingSymbol: null,
      blockingCorrelation: null,
      threshold,
      symbol,
    };
  }

  for (const pos of openPositions) {
    const posSymbol = pos.symbol;
    if (!posSymbol) continue;

    // Same symbol — not a correlation block (handled by existing single-position-per-session guard)
    if (posSymbol.toUpperCase() === symbol.toUpperCase()) continue;

    const key = pairKey(symbol, posSymbol);
    const corr = correlations[key] ?? 0.0;

    if (!(key in correlations)) {
      logger.warn(
        { symbol, posSymbol, key },
        "Tier 5.3.1: unknown pair in correlation matrix — defaulting to 0.0 (ALLOWED)",
      );
    }

    if (corr > threshold) {
      // ── F-3: Topstep multi-account exception ─────────────────────────────
      // Per CLAUDE.md §6: same operator running the SAME strategy across their
      // OWN Topstep accounts is ALLOWED. MFFU collaborative-trading ban always applies.
      // Cross-firm (Topstep ↔ MFFU) correlated positions: always block.
      const proposedIsTopstep = (proposedFirmId ?? "").toLowerCase() === "topstep";
      const blockingIsTopstep = (pos.firmId ?? "").toLowerCase() === "topstep";
      const sameUser     = proposedUserId != null && pos.userId != null && proposedUserId === pos.userId;
      const sameStrategy = proposedStrategyId != null && pos.strategyId != null && proposedStrategyId === pos.strategyId;

      if (proposedIsTopstep && blockingIsTopstep && sameUser && sameStrategy) {
        // Topstep same-operator same-strategy multi-account: allow
        logger.info(
          {
            symbol,
            blockingSymbol: posSymbol,
            correlation: corr,
            threshold,
            firmId: proposedFirmId,
            userId: proposedUserId,
            strategyId: proposedStrategyId,
            action: "compliance.correlated_position_topstep_exception_applied",
          },
          "F-3: Topstep multi-account exception — correlated position ALLOWED (same user, same strategy)",
        );
        // Don't block — continue checking other positions
        continue;
      }

      logger.info(
        {
          symbol,
          blockingSymbol: posSymbol,
          correlation: corr,
          threshold,
          action: "compliance.correlated_position_blocked",
        },
        "Tier 5.3.1: new entry BLOCKED — correlated position open",
      );
      return {
        allowed: false,
        reason: KILL_REASON_CORRELATED_POSITION_OPEN,
        blockingSymbol: posSymbol,
        blockingCorrelation: corr,
        threshold,
        symbol,
      };
    }
  }

  return {
    allowed: true,
    reason: null,
    blockingSymbol: null,
    blockingCorrelation: null,
    threshold,
    symbol,
  };
}
