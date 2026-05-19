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
}

interface OpenPositionSymbol {
  symbol: string;
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
 * @param symbol         Proposed entry symbol
 * @param openPositions  All currently open positions (any session). Only .symbol is read.
 * @param matrixOverride Inject a custom matrix (used in tests). If null, loads from YAML.
 */
export function checkCorrelatedPositionGuard(
  symbol: string,
  openPositions: OpenPositionSymbol[],
  matrixOverride: CorrelationMatrix | null = null,
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
