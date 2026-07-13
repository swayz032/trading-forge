/**
 * slippage-survival-gate.ts — Wave A (paper-parity), 2026-07-03
 *
 * Pure-function Slippage-Survival promotion gate.
 *
 * Design spec: docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md
 *
 * The Python engine producer (parallel track — src/engine/statistics/slippage_survival.py)
 * holds a backtest's realized trades fixed and re-applies slippage at 1x/2x/3x,
 * recomputing PF + expectancy on each stressed net-P&L series ("fixed-signal
 * re-price" — a cost-sensitivity analysis, not a full re-run). It writes the
 * result to `backtests.slippage_survival` JSONB with this EXACT shape:
 *
 *   {
 *     "schema_version": 1,
 *     "multiples": [1.0, 2.0, 3.0],
 *     "pf": { "1x": 1.82, "2x": 1.31, "3x": 0.94 },
 *     "expectancy_r": { "1x": 0.41, "2x": 0.19, "3x": -0.03 },
 *     "breaks_at": 3.0,            // smallest multiple where edge dies; null = survives all
 *     "retention_2x": 0.46,        // expectancy_r.2x / expectancy_r.1x (fragility telemetry)
 *     "n_trades": 214,
 *     "insufficient_sample": false,
 *     "computed_at": "2026-07-03T..."
 *   }
 *
 * This module is intentionally free of DB access and side effects (pure reader)
 * so tests can cover every branch without a DB connection. It mirrors the shape
 * and conventions of bif-gate.ts / b14-ci-gate.ts / wfe-gate.ts.
 *
 * Gate semantics (priority order — first match wins):
 *
 *   0. SLIPPAGE_SURVIVAL_GATE_ENABLED=false
 *      → passed=false, status="disabled", reason "slippage_survival.gate_disabled_fail_closed"
 *      → A disabled execution-risk gate cannot authorize DEPLOY_READY.
 *
 *   1. slippage_survival is null/undefined (no producer output on this backtest —
 *      pre-Wave-A backtest, or the row genuinely has no sweep computed yet)
 *      → passed=false, status="legacy_null", reason "slippage_survival.unavailable_fail_closed"
 *      → Historical rows remain readable but must be re-run before promotion.
 *
 *   2. slippage_survival is a non-null object but does NOT have `breaks_at` as an
 *      own property (producer shape drift / wrong-key write — e.g. a future
 *      producer change renames the field and the consumer silently reads
 *      `undefined`). This is DISTINCT from a genuine "survives all multiples"
 *      result, which the contract represents as an EXPLICIT `breaks_at: null`
 *      key. Conflating the two would make a broken producer indistinguishable
 *      from a clean pass — an instruction from the parent task explicitly forbids
 *      this ("must NOT silently pass").
 *      → passed=false, status="malformed", reason "slippage_survival.malformed_fail_closed"
 *      → A malformed producer result is insufficient evidence to promote.
 *
 *   3. insufficient_sample === true (n_trades < SLIPPAGE_SURVIVAL_MIN_TRADES on the
 *      producer side; producer emits this flag with breaks_at=null per contract)
 *      → passed=false, status="insufficient_sample", reason "slippage_survival.insufficient_sample_fail_closed"
 *      → Not enough trades to trust the sweep, so no promotion.
 *
 *   4. breaks_at != null AND breaks_at <= SLIPPAGE_SURVIVAL_BLOCK_MULT (default 2.0)
 *      → passed=false, status="blocked", reason "slippage_survival.blocked_breaks_at_at_or_below_threshold"
 *      → HARD block. Edge dies at ≤2x slippage — living on optimistic fills.
 *
 *   5. breaks_at === 3.0 (survives 2x, dies at 3x — edge of the sweep)
 *      → passed=true, status="warn_breaks_at_above_block", reason "slippage_survival.warn_breaks_at_above_block"
 *      → SOFT warn: promotion allowed, but flagged for operator attention.
 *
 *   6. else (breaks_at === null i.e. survives every swept multiple, or any other
 *      finite value strictly above the block threshold and not exactly 3.0)
 *      → passed=true, status="clean", reason "slippage_survival.clean"
 *
 * Env overrides:
 *   SLIPPAGE_SURVIVAL_GATE_ENABLED  (default "true") — setting false blocks promotion
 *   SLIPPAGE_SURVIVAL_BLOCK_MULT    (default "2.0")   — block if edge dies at ≤ this multiple
 *   SLIPPAGE_SURVIVAL_MULTIPLES     (default "1,2,3") — sweep points (producer-side; mirrored
 *                                                        here for TS-side display/telemetry only —
 *                                                        does NOT affect this gate's decision logic)
 *   SLIPPAGE_SURVIVAL_MIN_PF        (default "1.0")   — survival PF floor (producer-side; mirrored
 *                                                        here for parity/telemetry only)
 *   SLIPPAGE_SURVIVAL_MIN_TRADES    (default "20")    — sample-size guard (producer-side; mirrored
 *                                                        here for parity/telemetry only)
 *
 * Convention: strict <= (not <) for the block threshold — breaks_at exactly equal
 * to SLIPPAGE_SURVIVAL_BLOCK_MULT DOES block (per design spec: "breaks_at <=
 * SLIPPAGE_SURVIVAL_BLOCK_MULT"). This is the OPPOSITE convention from BIF/B14's
 * strict `>` block threshold — intentional, matches the design spec verbatim.
 */

import { logger } from "./logger.js";

// ── Env helpers ────────────────────────────────────────────────────────────────

/**
 * Read SLIPPAGE_SURVIVAL_GATE_ENABLED from env.
 * Default true. Disabling an execution-risk gate is itself insufficient evidence
 * for a promotion and therefore fails closed in the evaluator.
 * Exported for tests.
 */
export function getSlippageSurvivalGateEnabled(): boolean {
  const raw = process.env.SLIPPAGE_SURVIVAL_GATE_ENABLED;
  return raw !== "false";
}

/**
 * Read SLIPPAGE_SURVIVAL_BLOCK_MULT from env.
 * Default 2.0 — breaks_at <= this value triggers a HARD block.
 * Exported for tests.
 */
export function getSlippageSurvivalBlockMult(): number {
  const raw = process.env.SLIPPAGE_SURVIVAL_BLOCK_MULT;
  if (raw === undefined || raw === "") return 2.0;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(
      { raw, defaulted: 2.0 },
      "SLIPPAGE_SURVIVAL_BLOCK_MULT is invalid — using default 2.0",
    );
    return 2.0;
  }
  return parsed;
}

/**
 * Read SLIPPAGE_SURVIVAL_MULTIPLES from env.
 * Default [1, 2, 3] — producer-side sweep points, mirrored here for TS-side
 * telemetry/display parity only. Does NOT affect this gate's decision logic
 * (the gate reads the producer's already-computed `breaks_at` / `pf` / etc.).
 * Exported for tests.
 */
export function getSlippageSurvivalMultiples(): number[] {
  const raw = process.env.SLIPPAGE_SURVIVAL_MULTIPLES;
  if (raw === undefined || raw === "") return [1, 2, 3];
  const parsed = raw
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n) && n > 0);
  if (parsed.length === 0) {
    logger.warn(
      { raw, defaulted: [1, 2, 3] },
      "SLIPPAGE_SURVIVAL_MULTIPLES is invalid — using default [1,2,3]",
    );
    return [1, 2, 3];
  }
  return parsed;
}

/**
 * Read SLIPPAGE_SURVIVAL_MIN_PF from env.
 * Default 1.0 — producer-side survival PF floor, mirrored here for parity/
 * telemetry only. Exported for tests.
 */
export function getSlippageSurvivalMinPf(): number {
  const raw = process.env.SLIPPAGE_SURVIVAL_MIN_PF;
  if (raw === undefined || raw === "") return 1.0;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(
      { raw, defaulted: 1.0 },
      "SLIPPAGE_SURVIVAL_MIN_PF is invalid — using default 1.0",
    );
    return 1.0;
  }
  return parsed;
}

/**
 * Read SLIPPAGE_SURVIVAL_MIN_TRADES from env.
 * Default 20 — producer-side sample-size guard, mirrored here for parity/
 * telemetry only. Exported for tests.
 */
export function getSlippageSurvivalMinTrades(): number {
  const raw = process.env.SLIPPAGE_SURVIVAL_MIN_TRADES;
  if (raw === undefined || raw === "") return 20;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn(
      { raw, defaulted: 20 },
      "SLIPPAGE_SURVIVAL_MIN_TRADES is invalid — using default 20",
    );
    return 20;
  }
  return parsed;
}

// ── Data contract ────────────────────────────────────────────────────────────

/**
 * Shape of `backtests.slippage_survival` JSONB, exactly as emitted by the
 * Python producer (src/engine/statistics/slippage_survival.py). See module
 * docstring for the full contract.
 */
export interface SlippageSurvivalDict {
  schema_version?: number;
  multiples?: number[];
  pf?: Record<string, number>;
  expectancy_r?: Record<string, number>;
  breaks_at?: number | null;
  retention_2x?: number | null;
  n_trades?: number | null;
  insufficient_sample?: boolean;
  computed_at?: string;
}

// ── Result shape ─────────────────────────────────────────────────────────────

export type SlippageSurvivalGateStatus =
  | "disabled"
  | "legacy_null"
  | "malformed"
  | "insufficient_sample"
  | "blocked"
  | "warn_breaks_at_above_block"
  | "clean";

export interface SlippageSurvivalGateResult {
  /** True when the gate allows promotion; false when it blocks. */
  passed: boolean;
  /** Terminal state string (see module docstring for the full state machine). */
  status: SlippageSurvivalGateStatus;
  /** Human-readable reason string for the audit row. */
  reason: string;
  /** Full audit payload — merge into the audit_log result field. */
  auditPayload: {
    enabled: boolean;
    breaks_at: number | null;
    block_mult: number;
    n_trades: number | null;
    retention_2x: number | null;
    insufficient_sample: boolean;
    blocked: boolean;
    legacy_null: boolean;
    status: SlippageSurvivalGateStatus;
    reason: string;
  };
}

// ── Gate evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the Slippage-Survival gate.
 *
 * @param slippageSurvival  The `backtests.slippage_survival` JSONB dict.
 *                          Pass null/undefined when the backtest has no sweep
 *                          computed (pre-Wave-A grandfather).
 * @param opts               Optional overrides (primarily for tests).
 */
export function evaluateSlippageSurvivalGate(
  slippageSurvival: SlippageSurvivalDict | null | undefined,
  opts?: {
    enabled?: boolean;
    blockMult?: number;
  },
): SlippageSurvivalGateResult {
  const enabled = opts?.enabled ?? getSlippageSurvivalGateEnabled();
  const blockMult = opts?.blockMult ?? getSlippageSurvivalBlockMult();

  // Best-effort raw-value extraction for the audit payload — used across every
  // branch below so the audit row always carries whatever data IS present,
  // even on disabled/legacy/malformed paths (observability, not just gating).
  const rawBreaksAt =
    slippageSurvival != null && slippageSurvival.breaks_at != null
      ? Number(slippageSurvival.breaks_at)
      : null;
  const breaksAt = rawBreaksAt !== null && Number.isFinite(rawBreaksAt) ? rawBreaksAt : null;
  const nTrades =
    slippageSurvival?.n_trades != null && Number.isFinite(Number(slippageSurvival.n_trades))
      ? Number(slippageSurvival.n_trades)
      : null;
  const retention2x =
    slippageSurvival?.retention_2x != null && Number.isFinite(Number(slippageSurvival.retention_2x))
      ? Number(slippageSurvival.retention_2x)
      : null;

  function buildResult(
    status: SlippageSurvivalGateStatus,
    passed: boolean,
    reason: string,
    overrides?: { legacyNull?: boolean; insufficientSample?: boolean; blocked?: boolean },
  ): SlippageSurvivalGateResult {
    return {
      passed,
      status,
      reason,
      auditPayload: {
        enabled,
        breaks_at: breaksAt,
        block_mult: blockMult,
        n_trades: nTrades,
        retention_2x: retention2x,
        insufficient_sample: overrides?.insufficientSample ?? false,
        blocked: overrides?.blocked ?? false,
        legacy_null: overrides?.legacyNull ?? false,
        status,
        reason,
      },
    };
  }

  // ── 0. Master switch OFF — execution evidence cannot be waived ────────────
  if (!enabled) {
    logger.warn(
      { breaks_at: breaksAt, block_mult: blockMult },
      "Slippage-Survival gate: SLIPPAGE_SURVIVAL_GATE_ENABLED=false — blocking promotion (slippage_survival.gate_disabled_fail_closed)",
    );
    return buildResult(
      "disabled",
      false,
      "slippage_survival.gate_disabled_fail_closed",
      { blocked: true },
    );
  }

  // ── 1. Legacy null — no slippage_survival on this backtest ─────────────────
  if (slippageSurvival == null) {
    logger.warn(
      {},
      "Slippage-Survival gate: slippage_survival absent — blocking promotion until a fresh sweep is present (slippage_survival.unavailable_fail_closed)",
    );
    return buildResult(
      "legacy_null",
      false,
      "slippage_survival.unavailable_fail_closed",
      { legacyNull: true, blocked: true },
    );
  }

  // ── 2. Malformed / wrong-key shape guard ────────────────────────────────────
  // Distinguishes an intentional "survives all" result (`breaks_at: null`
  // explicitly present as an own key, per the producer contract) from a
  // producer that never wrote the field at all (shape drift / wrong key).
  // Conflating the two would make a broken producer look identical to a
  // genuine clean survivor — this must be visibly distinct, never a silent pass.
  if (!Object.prototype.hasOwnProperty.call(slippageSurvival, "breaks_at")) {
    logger.warn(
      { keys: Object.keys(slippageSurvival) },
      "Slippage-Survival gate: slippage_survival present but missing `breaks_at` key — blocking malformed producer shape (slippage_survival.malformed_fail_closed)",
    );
    return buildResult(
      "malformed",
      false,
      "slippage_survival.malformed_fail_closed",
      { blocked: true },
    );
  }

  // ── 3. Insufficient sample — producer flagged too few trades to trust ──────
  if (slippageSurvival.insufficient_sample === true) {
    logger.warn(
      { n_trades: nTrades },
      "Slippage-Survival gate: insufficient_sample=true — blocking promotion pending adequate evidence (slippage_survival.insufficient_sample_fail_closed)",
    );
    return buildResult(
      "insufficient_sample",
      false,
      "slippage_survival.insufficient_sample_fail_closed",
      { insufficientSample: true, blocked: true },
    );
  }

  // ── 4. Hard block — edge dies at or below the block multiple ───────────────
  // Strict <= per design spec: breaks_at exactly equal to blockMult DOES block.
  if (breaksAt !== null && breaksAt <= blockMult) {
    logger.warn(
      { breaks_at: breaksAt, block_mult: blockMult },
      "Slippage-Survival gate: BLOCKED — edge dies at or below block multiple (living on optimistic fills) — slippage_survival.blocked_breaks_at_at_or_below_threshold",
    );
    return buildResult(
      "blocked",
      false,
      "slippage_survival.blocked_breaks_at_at_or_below_threshold",
      { blocked: true },
    );
  }

  // ── 5. Warn — survives the block threshold but still dies within the swept range ──
  // Generalized from a hardcoded `=== 3.0` so the telemetry stays accurate if
  // SLIPPAGE_SURVIVAL_MULTIPLES is ever tuned: any non-null breaks_at that reached
  // here is > blockMult (the <= blockMult case blocked in step 4). The edge holds
  // through the block multiple but decays before the top of the sweep.
  if (breaksAt !== null) {
    logger.warn(
      { breaks_at: breaksAt, block_mult: blockMult },
      "Slippage-Survival gate: WARN — edge survives the block multiple but dies at a higher swept multiple (slippage_survival.warn_breaks_at_above_block)",
    );
    return buildResult(
      "warn_breaks_at_above_block",
      true,
      "slippage_survival.warn_breaks_at_above_block",
    );
  }

  // ── 6. Clean pass — survives every swept multiple (or otherwise unflagged) ─
  return buildResult("clean", true, "slippage_survival.clean");
}
