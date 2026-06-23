/**
 * contract-class.ts — Wave 27.5 Pass D.2 (paper-parity)
 *
 * Canonical contract-class resolution and per-class commission lookup.
 *
 * PROBLEM THIS SOLVES
 * -------------------
 * The legacy `getCommissionPerSide(firmId)` in shared/firm-config.ts is
 * symbol-agnostic: it returns the firm's single commission rate regardless of
 * whether the symbol is a MICRO (MES/MNQ/MCL, $0.37-$0.62/side) or a MINI
 * (ES/NQ/CL, $6.20/side at 10x tick value). When Phase 5 deployment (ES/NQ/CL
 * minis) lands, leaving the old helper in place would silently mis-price
 * commission by 10x for every mini contract.
 *
 * DESIGN
 * ------
 * - `getContractClass(symbol)` → "micro" | "mini" | "unknown"
 *   Pure lookup, never throws. "unknown" for any unrecognised symbol.
 *
 * - `getCommissionPerSide(symbol, firmId)` → number
 *   Symbol-aware replacement for the legacy helper.
 *   Resolution order:
 *     1. Firm-and-class-specific override table (COMMISSION_RATES_BY_CLASS)
 *     2. Contract-class default (micro: 0.62, mini: 6.20)
 *     3. Generic fallback for unknown symbols (DEFAULT_MICRO_COMMISSION_PER_SIDE)
 *   Emits audit row `commission.symbol_class_unknown` when class lookup fails.
 *   Emits info audit row `commission.mini_class_detected` on any mini symbol
 *   (Phase 5 visibility gate — operator awareness before minis go LIVE).
 *
 * PHASE 5 SAFETY GUARD
 * --------------------
 * Mini contracts (ES/NQ/CL) are gated behind Phase 5 (CLAUDE.md §5).
 * This helper does NOT block mini usage — it emits visibility audits so the
 * operator knows mini commission is being resolved, and returns the correct
 * per-contract dollar amount. Blocking minis at the entry-gate level is the
 * responsibility of the execution path, not this commission helper.
 *
 * BACKWARD COMPATIBILITY
 * ----------------------
 * All existing strategies are micro-only. The new helper returns identical
 * dollar amounts for micro symbols vs the legacy `getCommissionPerSide(firmId)`
 * for the same firm. No behavioral change for current production paths.
 *
 * AUDIT ROWS (non-blocking, fire-and-forget)
 * ------------------------------------------
 * Both audit rows are written via a passed-in `auditFn` callback so the helper
 * stays pure and testable without DB. Callers that do not care about audit
 * persistence pass a no-op.
 */

import { logger } from "./logger.js";

// ─── Contract-class table ────────────────────────────────────────────────────

/** Contract classes recognised by this helper. */
export type ContractClass = "micro" | "mini" | "unknown";

/**
 * Symbol-to-class mapping.
 * Micro = CME micro contracts (~$5 per point for MES).
 * Mini  = CME standard (e-mini) contracts (~$50 per point for ES) — Phase 5 only.
 */
const CONTRACT_CLASS_MAP: Record<string, ContractClass> = {
  // Micros (current production)
  MES: "micro",
  MNQ: "micro",
  MCL: "micro",
  // Minis (Phase 5 — not yet active in production)
  ES: "mini",
  NQ: "mini",
  CL: "mini",
} as const;

/**
 * Resolve the contract class for a symbol string.
 *
 * Case-insensitive. Returns "unknown" for any symbol not in the table —
 * never throws.
 */
export function getContractClass(symbol: string): ContractClass {
  if (!symbol) return "unknown";
  return CONTRACT_CLASS_MAP[symbol.toUpperCase()] ?? "unknown";
}

// ─── Commission rate tables ───────────────────────────────────────────────────

/**
 * Default per-side commission for MICRO contracts (the conservative/high value
 * = MFFU rate; Topstep is lower at $0.37 but we fall back to the higher rate
 * when firm is unknown — avoids overstating net P&L).
 */
export const DEFAULT_MICRO_COMMISSION_PER_SIDE = 0.62;

/**
 * Default per-side commission for MINI contracts (10× the micro base).
 * Derived from the 10:1 contract ratio: 10 MES = 1 ES in notional exposure,
 * so the commission per single mini contract is 10× the micro rate.
 * Topstep + MFFU 2026 published rates for e-mini ES/NQ/CL: $6.20/side.
 */
export const DEFAULT_MINI_COMMISSION_PER_SIDE = 6.20;

/**
 * Per-firm, per-class commission overrides.
 * Key format: `${firmId}.${contractClass}` (lower-cased firmId).
 *
 * These values mirror `src/engine/firm_config.py::FIRM_COMMISSIONS`.
 * When adding a new firm or new contract class, update BOTH files.
 */
const COMMISSION_RATES_BY_CLASS: Record<string, number> = {
  // Topstep — AUTHORITATIVE TopstepX/ProjectX all-in round-turn ÷ 2 (2026-06-23 correction;
  // was $0.37 — too low). MES/MNQ = $0.62/side ($1.24 RT). NOTE: this is class-based, so MCL
  // ($0.77/side, $1.54 RT) is slightly under-estimated here — the BACKTEST (firm_config.py)
  // has the exact per-symbol value; this TS rate is live/paper estimation (broker is
  // authoritative for real fills). TODO: per-symbol override if MCL estimation precision matters.
  "topstep.micro": 0.62,
  "topstep.mini":  1.90,  // ES/NQ $3.80 RT ÷ 2 (NOT 10× micro — commissions ~3× not 10×)
  // MFFU — AUTHORITATIVE MFFU instrument list all-in round-turn ÷ 2 (2026-06-23 correction;
  // was a flat $0.62 = TopstepX's value, wrong for MFFU). MES/MNQ = $0.95/side ($1.90 RT).
  // Class-based, so MCL ($0.58/side, $1.16 RT) is slightly over-estimated here — the BACKTEST
  // (firm_config.py) has the exact per-symbol value; this TS rate is live/paper estimation.
  "mffu.micro":    0.95,
  "mffu.mini":     2.34,  // ES/NQ $4.68 RT ÷ 2 (CL is $2.46 — see firm_config per-symbol)
} as const;

// ─── Audit callback type ──────────────────────────────────────────────────────

/** Optional async callback for emitting audit rows. No-op default keeps helper pure. */
export type AuditEmitter = (action: string, metadata: Record<string, unknown>) => void | Promise<void>;

const NO_OP_AUDIT: AuditEmitter = () => undefined;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Symbol-aware commission lookup — the canonical replacement for the legacy
 * symbol-agnostic `getCommissionPerSide(firmId)` helper.
 *
 * @param symbol  Contract symbol (e.g. "MES", "ES"). Case-insensitive.
 * @param firmId  Firm identifier (e.g. "topstep", "mffu"). Case-insensitive.
 *                Pass null/undefined to use the class-level default.
 * @param audit   Optional audit emitter. Defaults to a no-op so callers that
 *                do not need DB-backed auditing stay pure.
 *
 * @returns Per-side commission in dollars (number, never NaN).
 */
export function getCommissionPerSide(
  symbol: string,
  firmId: string | null | undefined,
  audit: AuditEmitter = NO_OP_AUDIT,
): number {
  const contractClass = getContractClass(symbol);
  const firmKey = firmId?.toLowerCase() ?? null;

  // ── Phase 5 visibility gate ─────────────────────────────────────────────────
  // Minis are NOT production-blocked here; audit row gives operator visibility
  // for when Phase 5 strategies land in the system.
  if (contractClass === "mini") {
    logger.info(
      { symbol, firmId, contractClass },
      "commission.mini_class_detected — Phase 5 mini contract symbol detected; not yet production-enabled",
    );
    void audit("commission.mini_class_detected", {
      symbol,
      firm_id: firmId ?? null,
      contract_class: "mini",
      phase5_future: true,
    });
  }

  // ── Unknown symbol ──────────────────────────────────────────────────────────
  if (contractClass === "unknown") {
    logger.warn(
      { symbol, firmId },
      "commission.symbol_class_unknown — symbol not in contract-class map; using generic fallback",
    );
    void audit("commission.symbol_class_unknown", {
      symbol,
      firm_id: firmId ?? null,
      fallback_rate: DEFAULT_MICRO_COMMISSION_PER_SIDE,
    });
    return DEFAULT_MICRO_COMMISSION_PER_SIDE;
  }

  // ── Firm + class specific override ─────────────────────────────────────────
  if (firmKey) {
    const overrideKey = `${firmKey}.${contractClass}`;
    const override = COMMISSION_RATES_BY_CLASS[overrideKey];
    if (override !== undefined) {
      return override;
    }
  }

  // ── Class-level default ─────────────────────────────────────────────────────
  return contractClass === "mini"
    ? DEFAULT_MINI_COMMISSION_PER_SIDE
    : DEFAULT_MICRO_COMMISSION_PER_SIDE;
}
