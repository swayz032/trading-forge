/**
 * risk-sizing.ts — Wave 10 risk-derived contract sizing
 *                  Wave 22 firm-aware Topstep trailing-DD + MFFU 2% rule
 *                  Wave 23 pyramid floor enforcement (MES=6, MNQ=6, MCL=18)
 *
 * Pure helper. No DB calls, no imports from production services.
 * Can be called from paper-signal-service, broker-router, or tests without
 * any side effects.
 *
 * Architecture note (Wave 10):
 *   DO NOT write max_contracts into strategy configs. That is the bug this
 *   module is fixing. max_contracts was a static number baked at graduation
 *   time; it could never honor the operator's actual account balance or
 *   current ATR. Instead, call computeRiskDerivedContracts() at signal-time
 *   with live inputs and let the math determine the safe ceiling.
 *
 * Safety invariant (Wave 23 update):
 *   pyramidFloor = base_contracts (minimum from DSL config)
 *   On healthy accounts (balance >= 85% of startingCapital):
 *     finalContracts = max(base_contracts, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap))
 *     Pyramid BASE is the slow-ramp FLOOR and overrides risk-cap when account is healthy.
 *   On drawdown accounts (balance < 85% of startingCapital):
 *     finalContracts = max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap))
 *     Risk-cap fully binds to protect the account during drawdown.
 *
 *   Rationale: MES base=6, MNQ base=6, MCL base=18 are the minimum viable
 *   contract counts for Style C 33/33/33 partial exits (must be divisible by 3).
 *   At a fresh $50K Topstep combine (buffer=$2K, riskCap=1), without the floor,
 *   the function returns 1 contract — which is not divisible by 3 and produces
 *   incorrect partials. The floor ensures minimum viable trades on healthy accounts.
 *   On drawdown accounts (< 85% of starting), risk-cap protection takes priority.
 *
 * Wave 22 — Firm-aware risk cap:
 *
 *   MFFU branch (existing math, unchanged):
 *     riskDollars = currentBalance × max_risk_pct_per_trade
 *
 *   Topstep branch (NEW — trailing-DD buffer):
 *     trailingFloor = min(highWaterBalance - trailingDD, accountStartingFloor)
 *     buffer        = currentBalance - trailingFloor
 *     riskDollars   = buffer × max_risk_pct_per_trade
 *
 *   Topstep 50K trailing-DD = $2,000. Floor locks at $50K (starting balance) once
 *   HWM ≥ $52,000 (i.e. trailingFloor can never rise above $50K per rule §6).
 *
 *   Default firm = "topstep" (operator primary per directive 2026-05-18).
 *
 * Wave 23 — Pyramid floor enforcement:
 *   Micro pyramid floors: MES=6, MNQ=6, MCL=18 (all divisible by 3).
 *   These values must be stored in strategy DSL as base_contracts.
 *   The floor only overrides risk-cap on HEALTHY accounts (>= 85% of starting balance).
 *   Drawdown accounts (< 85%) let risk-cap fully bind to protect firm compliance.
 *
 *   LOCKED micro point values (per operator directive 2026-05-19):
 *     MES = $5/point  (1/10 of ES at $50/pt)
 *     MNQ = $2/point  (1/10 of NQ at $20/pt)
 *     MCL = $1/tick   ($100/point, tick=0.01, tick_value=$1.00)
 *   NEVER confuse mini and micro values — 10x difference silently inflates risk.
 */

/** Firm identifier — only Topstep + MFFU supported (legacy firms removed 2026-05-10). */
export type FirmId = "topstep" | "mffu";

/**
 * Canonical confluence-size multiplier map (operator defaults).
 *
 * W23H.4 — confluence count → position-size multiplier:
 *   1 factor  (primary only)      → 1.0× base (unchanged baseline)
 *   2 factors (one confirming)    → 1.0× base (one confirmation not enough to upsize)
 *   3 factors (true confluence)   → 1.5× upsize 50%
 *   4+ factors (extreme A+ setup) → 2.0× upsize 100%
 *
 * Counts ≤ 0 clamp to multiplier for 1 (1.0).
 * Counts ≥ 5 clamp to multiplier for 4 (2.0).
 *
 * The multiplier is applied to pyramidTier and riskDerivedCap BEFORE the
 * min() against firmCap and liquidityCap — so the upsize is always bounded
 * by the per-symbol liquidity_comfort_cap.
 *
 * Operator can override per-strategy via framework-overlay.ts
 * confluence_size_multiplier config field.
 *
 * Deep-scan #22 loop-3 (2026-07-09): this map is only CONSULTED when
 * CONFLUENCE_SIZE_UPSIZE_ENABLED=true (default false) — see
 * isConfluenceSizeUpsizeEnabled() / resolveConfluenceMultiplier() below. With
 * the flag OFF, the multiplier is pinned to 1.0 regardless of this map.
 */
export const DEFAULT_CONFLUENCE_MULTIPLIER: Record<number, number> = {
  1: 1.0,
  2: 1.0,
  3: 1.5,
  4: 2.0,
};

/**
 * Deep-scan #22 loop-3 (2026-07-09) — CONFLUENCE_SIZE_UPSIZE_ENABLED activation gate.
 *
 * Context: the ds22 FIX F-1 fix (commit 8bffa1b, confluence-provenance.ts
 * ::deriveEvidenceBackedConfluenceCount) corrected the sizing `confluence_count`
 * derivation to read the CORRECT evidence-backed field. That fix is pure
 * correctness on the COUNT. But `entry_quality.confluence_factors` is
 * near-universally populated (the graduator forces >= 2 factors at
 * graduation), while the OLD (buggy, pre-F-1) `confirming_indicators` read was
 * usually empty — so landing F-1's count fix as-is would, as a side effect,
 * silently ACTIVATE a previously-dead confluence-weighted position-size
 * UPSIZE (1.0x -> 1.5x/2.0x) for the common strategy shape. A silent
 * size-INCREASE is a risk-direction behavior change and must not ship without
 * a conscious operator opt-in (CLAUDE.md: ship gates strict, loosen with data
 * — not by accident of an unrelated bugfix).
 *
 * This flag decouples "is confluence_count correct" (yes, unconditionally —
 * F-1's fix, always active) from "does the count actually change position
 * size" (opt-in, default false). With the flag OFF (default):
 * resolveConfluenceMultiplier() always returns 1.0 — position size is
 * IDENTICAL to pre-ds22 (pre-F-1) historical behavior, a size NO-OP,
 * regardless of confluence_count or any configured
 * confluence_size_multiplier_map. With the flag ON: the (now evidence-backed,
 * auto_floor-excluded) confluence count drives the upsize as W23H.4 always
 * intended.
 *
 * Fail-safe: any error reading/parsing the env var is treated as false (no
 * upsize) — the safe default is always "no size change."
 * Env: CONFLUENCE_SIZE_UPSIZE_ENABLED (default "false")
 */
export function isConfluenceSizeUpsizeEnabled(): boolean {
  try {
    return process.env.CONFLUENCE_SIZE_UPSIZE_ENABLED === "true";
  } catch {
    return false;
  }
}

/**
 * Resolve the confluence multiplier for a given count using the provided map
 * (or the canonical default map). Clamps below-1 to 1.0 and above-4 to 2.0.
 *
 * Deep-scan #22 loop-3 gate: when `upsizeEnabled` is false (the default —
 * resolved fresh from CONFLUENCE_SIZE_UPSIZE_ENABLED on every call, so no
 * module reload is needed to react to env changes), this ALWAYS returns 1.0
 * regardless of `count` or `map` — the confluence-weighted upsize is inert.
 * This is the single gate point: every caller (computeRiskDerivedContracts
 * and any direct caller) is covered without needing its own flag check.
 */
export function resolveConfluenceMultiplier(
  count: number,
  map: Record<number, number> = DEFAULT_CONFLUENCE_MULTIPLIER,
  upsizeEnabled: boolean = isConfluenceSizeUpsizeEnabled(),
): number {
  if (!upsizeEnabled) return 1.0;
  const clamped = Math.max(1, Math.min(4, count));
  return map[clamped] ?? DEFAULT_CONFLUENCE_MULTIPLIER[clamped] ?? 1.0;
}

export interface RiskSizingInputs {
  positionSizeConfig: {
    type: "risk_derived_pyramid";
    base_contracts: number;
    tier_increment: number;
    tier_threshold_dollars: number;
    personal_dll_pct: number;
    max_risk_pct_per_trade: number;
    liquidity_comfort_cap: number;
    /** Firm-level override stored in the DSL config. null = use firmContractCap. */
    topstep_account_cap_override: number | null;
    computed_at_signal_time: true;
  };

  // ── W23H.4 confluence-weighted sizing ─────────────────────────────────────
  /**
   * Number of confluence factors satisfied at signal time.
   * Formula: confirming_indicators.length + 1 (primary indicator always counts).
   * Default: 1 (primary indicator only → multiplier 1.0, no behavior change).
   * Callers without confluence data omit this field — backward compat preserved.
   *
   * Deep-scan #22 loop-3: even when this is > 1 (evidence-backed confluence
   * present), the multiplier only activates when CONFLUENCE_SIZE_UPSIZE_ENABLED
   * (env, default false) is true — see resolveConfluenceMultiplier(). Default OFF
   * means this field is currently observability-only (still threaded into
   * confluenceAudit for visibility) and does not change finalContracts.
   */
  confluence_count?: number;
  /**
   * Per-operator override of the confluence → multiplier lookup table.
   * When omitted, uses DEFAULT_CONFLUENCE_MULTIPLIER (canonical operator defaults).
   * Operator can configure per-strategy via framework-overlay.ts confluence_size_multiplier.
   */
  confluence_size_multiplier_map?: Record<number, number>;
  /** Live account equity (from paper_sessions.current_equity). */
  accountBalance: number;
  /** Sum of realized P&L since the strategy's first trade (currentEquity - startingCapital). */
  cumulativeProfit: number;
  /** Current-timeframe ATR in price points (e.g. 4.0 for 4 MES points). */
  atrPoints: number;
  /** Stop ATR multiple from CLAUDE.md §4 framework (typically 1.5). */
  stopMultiplier: number;
  /** Dollar value of one price point for this symbol. MES=$5, MNQ=$2, MCL=$100. */
  pointDollarValue: number;
  /** Firm per-account contract ceiling from firm_config. null = no firm cap. */
  firmContractCap: number | null;

  // ── Wave 22 firm-aware fields ──────────────────────────────────────────────
  /**
   * Which prop firm this account belongs to.
   * Default: "topstep" (operator primary per directive 2026-05-18).
   */
  firm?: FirmId;
  /**
   * Topstep only — the trailing drawdown amount for this account tier ($).
   * For 50K Topstep: $2,000. Ignored for MFFU (uses balance-pct directly).
   * Default: 2000 (50K Topstep combine value from docs/prop-firm-rules-2026-topstep.md).
   */
  trailingDD?: number;
  /**
   * Topstep only — highest account equity seen since inception ($).
   * Used to compute the trailing floor: floor = min(HWM - trailingDD, startingFloor).
   * Default: accountBalance (first day, no drawdown yet).
   */
  highWaterBalance?: number;
  /**
   * Topstep only — the account's starting balance (= account_size at open, e.g. $50,000).
   * The trailing floor cannot rise above this value (locks at starting balance per rule §6).
   * Default: 50000 (50K Topstep combine).
   */
  accountStartingFloor?: number;

  // ── Wave 24 optional scaling inputs ──────────────────────────────────────────
  /**
   * Current VIX level (item 16: vol-scaling on max_risk_pct).
   * null/undefined → computeVolScale returns 1.0 (fail-open, single warn by caller).
   */
  vixNow?: number | null;
  /**
   * Current top-3 order-book depth for this symbol (item 11: liquidity haircut).
   * null/undefined → haircut returns 1.0 (fail-open).
   */
  currentTop3Depth?: number | null;
  /**
   * 20-day rolling median top-3 depth for this symbol (item 11 baseline).
   * null/undefined → haircut returns 1.0 (fail-open).
   */
  baseline20dMedianTop3Depth?: number | null;

  // ── Wave 25 Pass 2 Inst-10: Drawdown-room-anchored sizing (Topstep only) ──────
  /**
   * Current drawdown room in dollars (Topstep trailing-DD only).
   * drawdownRoom = max(0, currentBalance - (peakBalance - trailingDD))
   *             = max(0, buffer between current equity and trailing floor)
   *
   * When provided for firm="topstep": an additional cap is computed:
   *   drawdownRoomCap = floor(drawdownRoom × DRAWDOWN_ROOM_RISK_PCT / stopDollarsPerContract)
   *
   * Rationale: 3 independent 2026 sources (traderssecondbrain, proptradingvibes,
   * propfirmmatch) converge on "risk 1% of CURRENT DRAWDOWN ROOM, not 2% of balance."
   * On a $50K Topstep with $2,500 trailing DD, 2% of balance = $1,000 = 40% of DD room —
   * 3 losers and you're out. 1% of DD room ($25) on a 4pt ATR stop = 0 contracts when
   * DD room approaches zero — correct, that is the intended hard stop.
   *
   * null/undefined → drawdownRoomCap not applied (fail-open, backward compatible).
   * NOT applied for firm="mffu" (MFFU uses static 2% rule; drawdown-room logic is Topstep-only).
   */
  currentDrawdownRoom?: number | null;

  /**
   * Wave 26 Pass K Phase 2 (2026-05-26) — PM session size factor.
   * Multiplier in [0, 1] applied to pyramidTier BEFORE the min() against caps.
   * Computed by src/server/lib/pm-size-factor.ts; defaults: 1.0 AM, 0.50 at 13:30
   * ET linearly decaying to 0.25 by 15:00 ET, 0.0 after 15:30 ET.
   * null/undefined → no PM scaling (backward compat — pre-Pass-K call sites unchanged).
   */
  pmSizeFactor?: number | null;

  /**
   * Scaling-plan-baby-mode (2026-06-23) — Proven-trades ramp mode.
   *
   * When provided: tier = floor(provenTrades / proven_trades_per_tier)
   *   replaces the dollar-based tier formula.
   * When absent: falls back to dollar mode (backward-compat; byte-identical behavior).
   *
   * Definition: cumulative count of closed WINNING trades (net realized P&L > 0),
   * monotonic, survives withdrawals. Produced by the live paper/execution layer;
   * sizing only CONSUMES the value — never computes it.
   *
   * The config knob `proven_trades_per_tier` defaults from env
   * PROVEN_TRADES_PER_TIER (default "10").
   */
  provenTrades?: number | null;

  // ── Wave 1 Track 1B: symbol-aware stop floor ──────────────────────────────
  /**
   * Contract symbol (e.g. "MES", "MNQ", "MCL"). Optional for backward compat.
   * When provided and symbol="MES", the MES stop floor (STOP_FLOOR_PTS_MES=6.0)
   * is applied: if computed stop distance < floor, it is widened to the floor.
   * Widen-up semantics: never skips the trade, never reduces the stop.
   *
   * Also enables VIX-tiered ATR multiplier (VIX_TIERED_ATR_ENABLED) when vixNow
   * is provided, applying computeVixAtrMultiplier() to the stop multiplier.
   */
  symbol?: string | null;
}

/**
 * Audit payload emitted for W23H.4 confluence multiplier application.
 * Callers forward this to their audit log via insertAuditRow() as:
 *   action: "sizing.confluence_multiplier_applied"
 *
 * Present on every result (including early rejections) so callers have a
 * consistent shape to forward. On rejections, contracts_before and
 * contracts_after are both 0; binding_constraint is "rejection".
 */
export interface ConfluenceAuditPayload {
  confluence_count: number;
  multiplier: number;
  contracts_before: number;
  contracts_after: number;
  binding_constraint: "pyramidTier" | "riskDerivedCap" | "firmCap" | "liquidityCap" | "pyramid_floor_override" | "drawdown_room" | "rejection";
}

export interface RiskSizingResult {
  finalContracts: number;
  pyramidTier: number;
  riskDerivedCap: number;
  firmCap: number | null;
  liquidityCap: number;
  rejectionReason: null | "zero_atr" | "zero_balance" | "negative_cap" | "zero_buffer";
  // Wave 22 additions
  firm: FirmId;
  riskCapMethod: "topstep_trailing_dd" | "mffu_balance_pct";
  firmCapApplied: boolean;
  // Wave 23 additions
  /** True when pyramid base floor overrode risk-cap on a healthy account. */
  pyramidFloorApplied: boolean;
  /** Account health ratio: currentBalance / startingCapital. Floor binds when >= 0.85. */
  accountHealthRatio: number;
  evidence: Record<string, number | string | boolean | null>;
  // W23H.4 additions
  /** Audit payload for sizing.confluence_multiplier_applied event. Forward to insertAuditRow(). */
  confluenceAudit: ConfluenceAuditPayload;
  // Wave 25 Pass 2 Inst-10 additions
  /** Computed drawdown-room cap (contracts). null when not applicable (MFFU or input absent). */
  drawdownRoomCap: number | null;
  /** True when drawdownRoomCap was the binding constraint. */
  drawdownRoomCapBinding: boolean;
  // Scaling-plan-baby-mode (2026-06-23): proven-trades ramp observability
  /**
   * Which tier-ramp mode was used to compute pyramidTier.
   * "proven_trades" — provenTrades input was present; tier = floor(provenTrades / proven_trades_per_tier).
   * "dollar_fallback" — provenTrades absent; tier = floor(cumulativeProfit / tier_threshold_dollars).
   */
  scalingMode: "proven_trades" | "dollar_fallback";
  /** Tier count used in pyramidTier computation. Audit/observability only. */
  scalingTier: number;
}

// ── Wave 24 env-configurable scaling params ───────────────────────────────────
// Exposed as env vars so the operator can tune without a code deploy.
const RISK_VIX_TARGET  = parseFloat(process.env.RISK_VIX_TARGET   ?? "18");
const RISK_VOL_SCALE_MIN = parseFloat(process.env.RISK_VOL_SCALE_MIN ?? "0.5");
const RISK_VOL_SCALE_MAX = parseFloat(process.env.RISK_VOL_SCALE_MAX ?? "1.5");

// ── Wave 25 Pass 2 Inst-10 env var ────────────────────────────────────────────
// Fraction of current drawdown room to risk per trade (Topstep trailing-DD only).
// Default 0.08 = 8% of remaining drawdown buffer per NexusFi 2026-05 thread:
//   "8-12% of remaining drawdown buffer per trade" is the institutional range for
//   futures prop accounts. The prior default of 0.01 (1%) produced ~$20/trade on a
//   fresh $2K Topstep buffer → 0 contracts via floor(20 / stop_dollars), which
//   completely strangled sizing on a healthy new combine. 8% of a $2K buffer = $160,
//   which at 1.5×4pt ATR stop on MES ($30/contract) yields floor(160/30) = 5
//   contracts — meaningful Phase 1 sizing consistent with base 9.
// The secondary 2%-of-balance cap (max_risk_pct_per_trade) remains unchanged and
// continues to serve as the hard ceiling when the account grows large.
// Operator can tighten: DRAWDOWN_ROOM_RISK_PCT=0.04 for more conservative protection.
// Env: DRAWDOWN_ROOM_RISK_PCT (default 0.08)
const DRAWDOWN_ROOM_RISK_PCT = parseFloat(process.env.DRAWDOWN_ROOM_RISK_PCT ?? "0.08");

// ── Scaling-plan-baby-mode (2026-06-23): Proven-trades ramp config ────────────
// Number of proven winning trades required per pyramid tier step.
// When RiskSizingInputs.provenTrades is provided, tier = floor(provenTrades / PROVEN_TRADES_PER_TIER).
// When absent, falls back to dollar-based tier (backward compat).
// Env: PROVEN_TRADES_PER_TIER (default 10)
const PROVEN_TRADES_PER_TIER = parseInt(process.env.PROVEN_TRADES_PER_TIER ?? "10", 10);

// ── Wave 1 Track 1B: VIX-tiered ATR multiplier ───────────────────────────────
// Parity with Python `margin_expansion.apply_vix_atr_multiplier()`.
// Default OFF — when OFF, returns baseMultiplier unchanged (byte-identical behavior).
// When ON: replaces the static 1.5× stop-distance multiplier with a VIX-tiered value:
//   vix < 20  → VIX_ATR_TIER_LOW  (wider stop in calm vol)
//   vix 20-30 → VIX_ATR_TIER_MID  (wider stop in moderate vol)
//   vix > 30  → VIX_ATR_TIER_HIGH (widest stop in high vol — capital preservation)
//
// Env names MUST match Python side exactly (enforced by npm run check:ts-python-exit-parity):
//   VIX_TIERED_ATR_ENABLED  default "false"
//   VIX_ATR_TIER_LOW        default 1.5  (matches static base when calm)
//   VIX_ATR_TIER_MID        default 2.0
//   VIX_ATR_TIER_HIGH       default 2.5
const _VIX_TIERED_ATR_ENABLED = process.env.VIX_TIERED_ATR_ENABLED === "true";
const _VIX_ATR_TIER_LOW  = parseFloat(process.env.VIX_ATR_TIER_LOW  ?? "1.5");
const _VIX_ATR_TIER_MID  = parseFloat(process.env.VIX_ATR_TIER_MID  ?? "2.0");
const _VIX_ATR_TIER_HIGH = parseFloat(process.env.VIX_ATR_TIER_HIGH ?? "2.5");

// ── Wave 1 Track 1B: MES stop floor ──────────────────────────────────────────
// Widen-up floor for MES: if computed stop distance < floor, use floor instead.
// NEVER skip the trade on a narrow stop — widen to the floor (parity with Python).
// Only applied when RiskSizingInputs.symbol === "MES".
// Env: STOP_FLOOR_PTS_MES default 6.0
const _STOP_FLOOR_PTS_MES = parseFloat(process.env.STOP_FLOOR_PTS_MES ?? "6.0");

/**
 * Wave 24 Item 16 — VIX-driven vol scale on max_risk_pct_per_trade.
 *
 * Scale = clamp(vixTarget / vixNow, VOL_SCALE_MIN, VOL_SCALE_MAX).
 * Returns 1.0 (no-op) when vixNow is null/<=0 (fail-open — missing data must
 * never block entries; single warn emitted by caller).
 *
 * Institutional standard: risk = base × vix_scale × regime_scale.
 * At VIX=18 (target): scale=1.0. VIX=36: scale=0.5 (floor). VIX=9: scale=1.5 (ceiling).
 * Env: RISK_VIX_TARGET (default 18), RISK_VOL_SCALE_MIN (0.5), RISK_VOL_SCALE_MAX (1.5).
 */
export function computeVolScale(vixNow: number | null): number {
  if (vixNow == null || vixNow <= 0) return 1.0;
  return Math.max(RISK_VOL_SCALE_MIN, Math.min(RISK_VOL_SCALE_MAX, RISK_VIX_TARGET / vixNow));
}

/**
 * Wave 1 Track 1B — VIX-tiered ATR multiplier for stop-distance sizing.
 *
 * Mirrors Python `margin_expansion.apply_vix_atr_multiplier()`.
 * Note: this is DIFFERENT from computeVolScale() above.
 *   computeVolScale:      scales max_risk_pct_per_trade (how many dollars to risk)
 *   computeVixAtrMultiplier: scales the stop DISTANCE in ATR multiples
 *
 * When VIX_TIERED_ATR_ENABLED=false (default): returns baseMultiplier unchanged.
 *   → With flag OFF paper sizing is byte-identical to before.
 *
 * When enabled:
 *   vix < 20  → VIX_ATR_TIER_LOW  (1.5 default — calm market, normal stop)
 *   vix 20-30 → VIX_ATR_TIER_MID  (2.0 default — elevated vol, wider stop)
 *   vix > 30  → VIX_ATR_TIER_HIGH (2.5 default — crisis vol, widest stop)
 *
 * Fail-open on missing/zero VIX: returns baseMultiplier (data absence never blocks entries).
 *
 * @param vixNow        Current VIX level. null/0/negative → fail-open.
 * @param baseMultiplier  The ATR multiplier to use when flag is OFF or VIX absent.
 */
export function computeVixAtrMultiplier(vixNow: number | null, baseMultiplier: number): number {
  if (!_VIX_TIERED_ATR_ENABLED) return baseMultiplier;
  if (vixNow == null || vixNow <= 0) return baseMultiplier; // fail-open on missing data
  if (vixNow < 20) return _VIX_ATR_TIER_LOW;
  if (vixNow <= 30) return _VIX_ATR_TIER_MID;
  return _VIX_ATR_TIER_HIGH;
}

/**
 * Wave 24 Item 11 — Dynamic liquidity haircut on per-symbol caps.
 *
 * CME 2025 paper "Reassessing Liquidity Beyond Order Book Depth" documented
 * -27% top-3 depth collapse during Liberation Day 2025-04-02. Static caps
 * flood thinned books during liquidity events.
 *
 * haircut = min(1.0, currentTop3Depth / baseline20dMedianTop3Depth).
 * Returns 1.0 (no-op) when either input is missing — fail-open on absent data.
 * Audit emission (sizing.liquidity_haircut_applied) is handled by the caller.
 */
export function computeLiquidityHaircut(
  currentTop3Depth: number | null | undefined,
  baseline20dMedianTop3Depth: number | null | undefined,
): number {
  if (!currentTop3Depth || !baseline20dMedianTop3Depth) return 1.0;
  return Math.min(1.0, currentTop3Depth / baseline20dMedianTop3Depth);
}

/**
 * Compute trailing-DD floor for Topstep accounts.
 *
 * Per docs/prop-firm-rules-2026-topstep.md §6:
 *   - Floor starts at (startingBalance - trailingDD) = $48K for 50K.
 *   - Trails up as HWM rises.
 *   - LOCKS at startingBalance ($50K) once HWM >= startingBalance.
 *
 * Formula: trailingFloor = min(highWaterBalance - trailingDD, accountStartingFloor)
 * (min because the floor can never exceed the starting floor = locked ceiling)
 */
function computeTopstepTrailingFloor(
  highWaterBalance: number,
  trailingDD: number,
  accountStartingFloor: number,
): number {
  // As HWM rises, the trailing floor also rises — but locks at startingFloor.
  const rawFloor = highWaterBalance - trailingDD;
  return Math.min(rawFloor, accountStartingFloor);
}

/**
 * Compute the final contract count at signal time using risk-derived math.
 *
 * Firm-aware (Wave 22):
 *   - "topstep" (default): riskDollars = buffer × max_risk_pct_per_trade
 *     where buffer = currentBalance - trailingFloor
 *   - "mffu": riskDollars = accountBalance × max_risk_pct_per_trade  (unchanged)
 *
 * Common final step:
 *   pyramidTier      = base + increment × floor(max(0, cumulativeProfit) / threshold)
 *   stopDollars      = stopMultiplier × atrPoints × pointDollarValue
 *   riskDerivedCap   = floor(riskDollars / stopDollars)
 *   firmCap          = topstep_account_cap_override ?? firmContractCap ?? Infinity
 *   liquidityCap     = liquidity_comfort_cap
 *   finalContracts   = max(0, min(pyramidTier, riskDerivedCap, firmCap, liquidityCap))
 *
 * Edge cases:
 *   - ATR = 0 → rejectionReason = "zero_atr", finalContracts = 0
 *   - accountBalance ≤ 0 → rejectionReason = "zero_balance", finalContracts = 0
 *   - riskDerivedCap ≤ 0 → rejectionReason = "negative_cap", finalContracts = 0
 *   - buffer ≤ 0 (Topstep) → rejectionReason = "zero_buffer", finalContracts = 0
 *
 * personal_dll_pct is NOT enforced here. The caller (paper-execution-service)
 * already applies the DLL gate via checkRiskGate(); this function is sizing-only.
 */
export function computeRiskDerivedContracts(input: RiskSizingInputs): RiskSizingResult {
  const cfg = input.positionSizeConfig;

  // Wave 22: firm defaults to "topstep" per operator directive.
  const firm: FirmId = input.firm ?? "topstep";

  // Wave 24 Item 11: Dynamic liquidity haircut (CME Liberation Day -27% depth event).
  // haircut ∈ (0, 1.0]. 1.0 when depth data absent (fail-open).
  const liquidityHaircut = computeLiquidityHaircut(input.currentTop3Depth, input.baseline20dMedianTop3Depth);
  const liquidityCap = Math.floor(cfg.liquidity_comfort_cap * liquidityHaircut);

  // Wave 24 Item 16: VIX-driven vol scale on max_risk_pct (institutional standard).
  // scale ∈ [0.5, 1.5]. 1.0 when VIX data absent (fail-open).
  const volScale = computeVolScale(input.vixNow ?? null);
  const effectiveMaxRiskPct = cfg.max_risk_pct_per_trade * volScale;

  // W23H.4: Resolve confluence multiplier.
  // confluence_count defaults to 1 (primary indicator only) when omitted → multiplier 1.0.
  // This preserves exact backward compatibility: callers without confluence_count get 1.0×.
  const confluenceCount = input.confluence_count ?? 1;
  const multiplier = resolveConfluenceMultiplier(confluenceCount, input.confluence_size_multiplier_map);

  // Wave 25 Pass 2 Inst-10: Drawdown-room cap (Topstep trailing-DD only).
  // Applied only when currentDrawdownRoom is provided AND firm === "topstep".
  // NOT applied for MFFU (static 2% rule is the correct path for that firm).
  // Cap is computed here before rejection checks but only applied in the final min()
  // after stop dollars are known (must defer to after stopDollarsPerContract is computed).
  // We store the raw input here; the cap itself is computed after stopDollars is known.
  const hasDrawdownRoomInput = input.currentDrawdownRoom != null && input.currentDrawdownRoom >= 0;
  const drawdownRoomInput = hasDrawdownRoomInput ? (input.currentDrawdownRoom as number) : null;

  // Pyramid tier (slow ramp-up)
  // Scaling-plan-baby-mode (2026-06-23): proven-trades mode takes priority when
  // provenTrades is present. Backward-compat: absent provenTrades = dollar mode,
  // byte-identical to pre-baby-mode behavior.
  let tiers: number;
  let scalingMode: "proven_trades" | "dollar_fallback";
  if (input.provenTrades != null && Number.isFinite(input.provenTrades)) {
    const ptPerTier = PROVEN_TRADES_PER_TIER > 0 ? PROVEN_TRADES_PER_TIER : 10;
    tiers = Math.floor(Math.max(0, input.provenTrades) / ptPerTier);
    scalingMode = "proven_trades";
  } else {
    const profitFloor = Math.max(0, input.cumulativeProfit);
    tiers = Math.floor(profitFloor / cfg.tier_threshold_dollars);
    scalingMode = "dollar_fallback";
  }
  const pyramidTierRaw = cfg.base_contracts + cfg.tier_increment * tiers;

  // Wave 26 Pass K Phase 2 (2026-05-26) — Apply PM session size factor BEFORE
  // the min() against caps. EOD-DD-aware sizing per TTT Markets 2026-04 +
  // SurgeFunded 2026-02 institutional 2026 standard. Topstep EOD trailing DD
  // makes a PM loss un-recoverable before 15:55 flatten — every minute past
  // 13:30 ET reduces the recovery window. null/undefined factor → no scaling
  // (backward compat).
  const pmFactor = Number.isFinite(input.pmSizeFactor) && input.pmSizeFactor !== null && input.pmSizeFactor !== undefined
    ? Math.max(0, Math.min(1, input.pmSizeFactor as number))
    : 1.0;
  const pyramidTier = Math.floor(pyramidTierRaw * pmFactor);

  // Wave 23: Account health ratio for pyramid floor enforcement.
  // Floor binds when account is healthy (>= 85% of starting capital).
  // Starting capital: for Topstep = accountStartingFloor; for MFFU = 50K default.
  const startingCapitalForHealth = input.accountStartingFloor ?? 50_000;
  const accountHealthRatio = startingCapitalForHealth > 0
    ? input.accountBalance / startingCapitalForHealth
    : 1.0;
  const accountIsHealthy = accountHealthRatio >= 0.85;

  // Edge case: balance ≤ 0 OR non-finite. deep-scan sizing F-1 (HIGH, 2026-07-06): a NaN/undefined/Infinity
  // accountBalance previously sailed through this (`NaN <= 0` is false) and through every downstream cap/floor,
  // yielding finalContracts=NaN with rejectionReason=null (Math.max(0, NaN)=NaN, not 0) — a NaN order size that
  // reaches routeOrder() un-rejected. The live call site guards it with `|| 50_000`, but a pure sizing function
  // that gates real capital must be self-fail-closed, not caller-dependent (the TopstepX build-out is a future
  // direct caller). Reject non-finite as an invalid (zero-equivalent) balance.
  if (!Number.isFinite(input.accountBalance) || input.accountBalance <= 0) {
    return {
      finalContracts: 0,
      pyramidTier,
      riskDerivedCap: 0,
      firmCap: null,
      liquidityCap,
      rejectionReason: "zero_balance",
      firm,
      riskCapMethod: firm === "topstep" ? "topstep_trailing_dd" : "mffu_balance_pct",
      firmCapApplied: false,
      pyramidFloorApplied: false,
      accountHealthRatio,
      drawdownRoomCap: null,
      drawdownRoomCapBinding: false,
      scalingMode,
      scalingTier: tiers,
      evidence: {
        accountBalance: input.accountBalance,
        atrPoints: input.atrPoints,
        pyramidTier,
        riskDerivedCap: 0,
        firmCap: null,
        liquidityCap,
        finalContracts: 0,
        rejectionReason: "zero_balance",
        firm,
        accountHealthRatio,
        pyramidFloorApplied: false,
      },
      confluenceAudit: {
        confluence_count: confluenceCount,
        multiplier,
        contracts_before: 0,
        contracts_after: 0,
        binding_constraint: "rejection",
      },
    };
  }

  // Edge case: ATR = 0
  if (input.atrPoints <= 0) {
    return {
      finalContracts: 0,
      pyramidTier,
      riskDerivedCap: 0,
      firmCap: null,
      liquidityCap,
      rejectionReason: "zero_atr",
      firm,
      riskCapMethod: firm === "topstep" ? "topstep_trailing_dd" : "mffu_balance_pct",
      firmCapApplied: false,
      pyramidFloorApplied: false,
      accountHealthRatio,
      drawdownRoomCap: null,
      drawdownRoomCapBinding: false,
      scalingMode,
      scalingTier: tiers,
      evidence: {
        accountBalance: input.accountBalance,
        atrPoints: input.atrPoints,
        pyramidTier,
        riskDerivedCap: 0,
        firmCap: null,
        liquidityCap,
        finalContracts: 0,
        rejectionReason: "zero_atr",
        firm,
        accountHealthRatio,
        pyramidFloorApplied: false,
      },
      confluenceAudit: {
        confluence_count: confluenceCount,
        multiplier,
        contracts_before: 0,
        contracts_after: 0,
        binding_constraint: "rejection",
      },
    };
  }

  // ── Wave 22: Firm-aware risk dollar computation ──────────────────────────────
  let riskDollars: number;
  let riskCapMethod: "topstep_trailing_dd" | "mffu_balance_pct";

  // Topstep-specific trailing state (resolved with sensible defaults)
  const trailingDD = input.trailingDD ?? 2000;                          // 50K Topstep default
  const accountStartingFloor = input.accountStartingFloor ?? 50_000;    // 50K Topstep default

  // F-2 Fix: for Topstep, when highWaterBalance is omitted we must default
  // CONSERVATIVELY so the trailing-DD buffer is never overstated.
  // Old: HWM = accountBalance → on a losing day where balance < startingFloor,
  //   buffer = balance - (balance - trailingDD) = trailingDD (e.g. $2000 at $48K) — WRONG.
  // New: HWM = max(accountBalance, accountStartingFloor) → the trailing floor is computed
  //   using the highest defensible peak (at minimum the starting floor), so the resulting
  //   buffer = accountBalance - max(accountBalance, startingFloor - trailingDD)
  //   is never larger than real room. When balance < startingFloor buffer approaches 0.
  // For MFFU the highWaterBalance field is unused (different riskDollars branch) so
  // the default path does not matter, but we keep the same conservative expression.
  const hwmProvided = input.highWaterBalance !== undefined;
  const highWaterBalance = hwmProvided
    ? input.highWaterBalance!
    : Math.max(input.accountBalance, accountStartingFloor); // conservative: never below starting floor

  let trailingFloor: number | null = null;
  let buffer: number | null = null;

  if (firm === "topstep") {
    riskCapMethod = "topstep_trailing_dd";
    trailingFloor = computeTopstepTrailingFloor(highWaterBalance, trailingDD, accountStartingFloor);
    buffer = input.accountBalance - trailingFloor;

    // Edge case: no buffer left (account is at or below its trailing floor)
    if (buffer <= 0) {
      return {
        finalContracts: 0,
        pyramidTier,
        riskDerivedCap: 0,
        firmCap: null,
        liquidityCap,
        rejectionReason: "zero_buffer",
        firm,
        riskCapMethod,
        firmCapApplied: false,
        pyramidFloorApplied: false,
        accountHealthRatio,
        drawdownRoomCap: null,
        drawdownRoomCapBinding: false,
        scalingMode,
        scalingTier: tiers,
        evidence: {
          accountBalance: input.accountBalance,
          trailingFloor,
          buffer,
          highWaterBalance,
          trailingDD,
          accountStartingFloor,
          hwm_defaulted: !hwmProvided,  // F-2: visibility flag for conservative HWM default
          pyramidTier,
          riskDerivedCap: 0,
          firmCap: null,
          liquidityCap,
          finalContracts: 0,
          rejectionReason: "zero_buffer",
          firm,
          accountHealthRatio,
          pyramidFloorApplied: false,
        },
        confluenceAudit: {
          confluence_count: confluenceCount,
          multiplier,
          contracts_before: 0,
          contracts_after: 0,
          binding_constraint: "rejection",
        },
      };
    }

    riskDollars = buffer * effectiveMaxRiskPct;  // Wave 24: vol-scaled risk pct
  } else {
    // MFFU: risk against current balance (unchanged from Wave 10)
    riskCapMethod = "mffu_balance_pct";
    riskDollars = input.accountBalance * effectiveMaxRiskPct;  // Wave 24: vol-scaled
  }

  // Risk-derived ceiling (common to both firms)
  // Wave 1 Track 1B: apply VIX-tiered ATR multiplier + MES stop floor (parity with Python).
  // When VIX_TIERED_ATR_ENABLED=false (default): effectiveMultiplier = input.stopMultiplier.
  // When flag ON: multiplier is replaced by the VIX-tiered value via computeVixAtrMultiplier().
  // MES floor: widened stop distance ensures a minimum 6pt stop (widen-up, never skip).
  // With both flags OFF: byte-identical to the pre-Track-1B computation.
  const effectiveStopMultiplier = computeVixAtrMultiplier(input.vixNow ?? null, input.stopMultiplier);
  const rawStopDistancePts = effectiveStopMultiplier * input.atrPoints;
  const isMES = (input.symbol ?? "").toUpperCase() === "MES";
  const effectiveStopDistancePts = isMES
    ? Math.max(rawStopDistancePts, _STOP_FLOOR_PTS_MES)
    : rawStopDistancePts;
  const stopDollarsPerContract = effectiveStopDistancePts * input.pointDollarValue;
  const riskDerivedCap = Math.floor(riskDollars / stopDollarsPerContract);

  // Wave 25 Pass 2 Inst-10: Drawdown-room cap (Topstep only, when input provided).
  // drawdownRoomCap = floor(currentDrawdownRoom × DRAWDOWN_ROOM_RISK_PCT / stopDollarsPerContract)
  // Applied in the final min() below. null for MFFU or when input is absent.
  const drawdownRoomCap: number | null =
    firm === "topstep" && hasDrawdownRoomInput && drawdownRoomInput !== null
      ? Math.floor((drawdownRoomInput * DRAWDOWN_ROOM_RISK_PCT) / stopDollarsPerContract)
      : null;

  // Edge case: computed cap ≤ 0 (extreme ATR or tiny account/buffer).
  // Wave 23: On healthy accounts, pyramid floor still applies even here.
  // If accountIsHealthy AND riskCap <= 0, we use base_contracts as the floor.
  // This handles the Topstep fresh-combine case: riskCap=0 but account is healthy.
  // On drawdown accounts, this rejection holds (risk-cap protects the account).
  if (riskDerivedCap <= 0) {
    if (accountIsHealthy && cfg.base_contracts > 0) {
      // Pyramid floor applies on healthy account.
      // Pass 5 Track C F-7: floor must STILL be clamped by firmCap and liquidityCap.
      // Returning unbounded base_contracts allows a misconfigured strategy
      // (or overlay drift writing oversized base) to bypass firm/book limits.
      const effectiveFirmCapForFloor: number | null =
        typeof cfg.topstep_account_cap_override === "number"
          ? cfg.topstep_account_cap_override
          : (input.firmContractCap ?? null);
      // F-4 Fix: include drawdownRoomCap in the early-return floor min().
      // The main path (line ~705) already applies drawdownRoomCap in the min();
      // this early-return path previously omitted it, allowing base_contracts to
      // be returned even when DD room is too tight to support that many contracts.
      // drawdownRoomCap OVERRIDES the pyramid floor — consistent with line ~730 note.
      const flooredCandidates: number[] = [cfg.base_contracts, liquidityCap];
      if (effectiveFirmCapForFloor !== null) flooredCandidates.push(effectiveFirmCapForFloor);
      if (drawdownRoomCap !== null && drawdownRoomCap >= 0) flooredCandidates.push(drawdownRoomCap);
      const flooredContracts = Math.min(...flooredCandidates);
      const firmCapAppliedAtFloor =
        effectiveFirmCapForFloor !== null && effectiveFirmCapForFloor === flooredContracts &&
        effectiveFirmCapForFloor < cfg.base_contracts;
      // drawdownRoomCap binding when it was the actual constraining element
      const earlyReturnDrawdownRoomCapBinding =
        drawdownRoomCap !== null && drawdownRoomCap >= 0 && drawdownRoomCap === flooredContracts;
      return {
        finalContracts: flooredContracts,
        pyramidTier,
        riskDerivedCap,
        firmCap: effectiveFirmCapForFloor,
        liquidityCap,
        rejectionReason: null,  // not a rejection — floor overrides (or DD room cap)
        firm,
        riskCapMethod,
        firmCapApplied: firmCapAppliedAtFloor,
        pyramidFloorApplied: !earlyReturnDrawdownRoomCapBinding,
        accountHealthRatio,
        drawdownRoomCap,
        drawdownRoomCapBinding: earlyReturnDrawdownRoomCapBinding,
        scalingMode,
        scalingTier: tiers,
        evidence: {
          accountBalance: input.accountBalance,
          atrPoints: input.atrPoints,
          stopMultiplier: input.stopMultiplier,
          pointDollarValue: input.pointDollarValue,
          stopDollarsPerContract,
          riskDollars,
          ...(firm === "topstep" ? {
            trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor,
            hwm_defaulted: !hwmProvided,  // F-2: visibility flag for conservative HWM default
          } : {}),
          pyramidTier,
          riskDerivedCap,
          firmCap: effectiveFirmCapForFloor,
          liquidityCap,
          drawdownRoomCap: drawdownRoomCap ?? null,
          finalContracts: flooredContracts,
          rejectionReason: null,
          firm,
          accountHealthRatio,
          pyramidFloorApplied: !earlyReturnDrawdownRoomCapBinding,
          bindingCap: earlyReturnDrawdownRoomCapBinding ? "drawdown_room" : "pyramid_floor_override",
          base_contracts: cfg.base_contracts,
          riskCapMethod,
          confluenceCount,
          confluenceMultiplier: multiplier,
        },
        confluenceAudit: {
          confluence_count: confluenceCount,
          multiplier,
          contracts_before: pyramidTier,
          contracts_after: flooredContracts,
          binding_constraint: earlyReturnDrawdownRoomCapBinding ? "drawdown_room" : "pyramid_floor_override",
        },
      };
    }
    return {
      finalContracts: 0,
      pyramidTier,
      riskDerivedCap,
      firmCap: null,
      liquidityCap,
      rejectionReason: "negative_cap",
      firm,
      riskCapMethod,
      firmCapApplied: false,
      pyramidFloorApplied: false,
      accountHealthRatio,
      drawdownRoomCap,
      drawdownRoomCapBinding: false,
      scalingMode,
      scalingTier: tiers,
      evidence: {
        accountBalance: input.accountBalance,
        atrPoints: input.atrPoints,
        stopMultiplier: input.stopMultiplier,
        pointDollarValue: input.pointDollarValue,
        stopDollarsPerContract,
        riskDollars,
        ...(firm === "topstep" ? {
          trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor,
          hwm_defaulted: !hwmProvided,  // F-2: visibility flag
        } : {}),
        pyramidTier,
        riskDerivedCap,
        firmCap: null,
        liquidityCap,
        drawdownRoomCap: drawdownRoomCap ?? null,
        finalContracts: 0,
        rejectionReason: "negative_cap",
        firm,
        accountHealthRatio,
        pyramidFloorApplied: false,
      },
      confluenceAudit: {
        confluence_count: confluenceCount,
        multiplier,
        contracts_before: 0,
        contracts_after: 0,
        binding_constraint: "rejection",
      },
    };
  }

  // Effective firm cap: DSL override takes priority over live firm cap
  const effectiveFirmCap: number | null =
    typeof cfg.topstep_account_cap_override === "number"
      ? cfg.topstep_account_cap_override
      : (input.firmContractCap ?? null);

  // W23H.4: Apply confluence multiplier to pyramidTier and riskDerivedCap
  // BEFORE the min() against firmCap and liquidityCap. This ensures the upsize
  // is always bounded by the per-symbol liquidity_comfort_cap (operator-canonical).
  //
  // contracts_before captures the unmultiplied pyramidTier for audit.
  const contractsBefore = pyramidTier;
  const pyramidTierMultiplied = Math.floor(pyramidTier * multiplier);
  const riskDerivedCapMultiplied = Math.floor(riskDerivedCap * multiplier);

  // Final: compute the risk-capped minimum first, then apply pyramid floor.
  // Step 1: min(pyramidTierMultiplied, riskDerivedCapMultiplied, firmCap, liquidityCap)
  // Wave 25 Pass 2 Inst-10: Also apply drawdownRoomCap when it's a Topstep input.
  let finalContracts = Math.min(pyramidTierMultiplied, riskDerivedCapMultiplied, liquidityCap);
  const firmCapApplied = effectiveFirmCap !== null && effectiveFirmCap < Math.min(pyramidTierMultiplied, riskDerivedCapMultiplied, liquidityCap);
  if (effectiveFirmCap !== null) {
    finalContracts = Math.min(finalContracts, effectiveFirmCap);
  }
  // Wave 25 Pass 2 Inst-10: Apply drawdownRoomCap in the min() (Topstep only when provided).
  let drawdownRoomCapBinding = false;
  if (drawdownRoomCap !== null) {
    const preDrawdownContracts = finalContracts;
    finalContracts = Math.min(finalContracts, drawdownRoomCap);
    drawdownRoomCapBinding = drawdownRoomCap < preDrawdownContracts;
  }
  finalContracts = Math.max(0, finalContracts);

  // Step 2 (Wave 23): Pyramid floor enforcement.
  // On healthy accounts (>= 85% of starting capital), base_contracts is the minimum viable
  // contract count. Risk-cap can return fewer than base on fresh Topstep combines (narrow
  // buffer = low risk cap), which would break Style C 33/33/33 partials.
  // Rule: if account is healthy AND risk-cap produced fewer than base_contracts → use base_contracts.
  // On drawdown accounts (< 85%), risk-cap fully binds — floor does not override.
  // NOTE: floor uses base_contracts (not multiplied base) — floor is a safety minimum,
  // not an upsize trigger. Multiplier applies via pyramidTier, not the floor value.
  // NOTE: drawdownRoomCap (Inst-10) OVERRIDES the pyramid floor — when DD room is very
  // small, forcing base_contracts would violate the 1%-of-room safety contract.
  let pyramidFloorApplied = false;
  if (!drawdownRoomCapBinding && accountIsHealthy && finalContracts < cfg.base_contracts) {
    // MED C-2 fix (deep-scan #16 wave-1 track-3, 2026-07-04): this floor previously
    // force-set finalContracts = cfg.base_contracts UNCLAMPED — unlike the early-return
    // branch above (F-7/F-4), which was patched to min([base, liquidityCap, firmCap?,
    // drawdownRoomCap?]). A misconfigured strategy (or overlay drift writing an oversized
    // base_contracts) could bypass firmCap/liquidityCap here even though the early-return
    // path already guards against exactly that. Apply the SAME clamp for consistency —
    // drawdownRoomCap is deliberately excluded from this min() because entering this branch
    // already requires !drawdownRoomCapBinding (drawdownRoomCap did not constrain the
    // pre-floor finalContracts), so re-including it here would only matter in the edge case
    // where drawdownRoomCap sits between the pre-floor finalContracts and base_contracts —
    // guard against that edge case too by including it when present, mirroring the
    // early-return floor's [base_contracts, liquidityCap, firmCap?, drawdownRoomCap?] set.
    const flooredCandidates: number[] = [cfg.base_contracts, liquidityCap];
    if (effectiveFirmCap !== null) flooredCandidates.push(effectiveFirmCap);
    if (drawdownRoomCap !== null && drawdownRoomCap >= 0) flooredCandidates.push(drawdownRoomCap);
    finalContracts = Math.min(...flooredCandidates);
    pyramidFloorApplied = true;
  }

  // Which cap is binding? (Uses multiplied values for accurate attribution.)
  // drawdown_room takes priority when it was the binding constraint.
  let bindingCap = "pyramid";
  if (drawdownRoomCapBinding) {
    bindingCap = "drawdown_room";
  } else if (pyramidFloorApplied) {
    bindingCap = "pyramid_floor_override";
  } else if (riskDerivedCapMultiplied <= pyramidTierMultiplied && (effectiveFirmCap === null || riskDerivedCapMultiplied <= effectiveFirmCap) && riskDerivedCapMultiplied <= liquidityCap) {
    bindingCap = "risk_derived";
  } else if (effectiveFirmCap !== null && effectiveFirmCap <= pyramidTierMultiplied && effectiveFirmCap <= riskDerivedCapMultiplied && effectiveFirmCap <= liquidityCap) {
    bindingCap = "firm_cap";
  } else if (liquidityCap <= pyramidTierMultiplied && liquidityCap <= riskDerivedCapMultiplied && (effectiveFirmCap === null || liquidityCap <= effectiveFirmCap)) {
    bindingCap = "liquidity_cap";
  }

  // Map bindingCap → ConfluenceAuditPayload binding_constraint
  const bindingConstraintForAudit: ConfluenceAuditPayload["binding_constraint"] =
    bindingCap === "drawdown_room"          ? "drawdown_room"
    : bindingCap === "pyramid_floor_override" ? "pyramid_floor_override"
    : bindingCap === "risk_derived"         ? "riskDerivedCap"
    : bindingCap === "firm_cap"             ? "firmCap"
    : bindingCap === "liquidity_cap"        ? "liquidityCap"
    : "pyramidTier"; // "pyramid" = pyramidTier is binding

  return {
    finalContracts,
    pyramidTier,
    riskDerivedCap,
    firmCap: effectiveFirmCap,
    liquidityCap,
    rejectionReason: null,
    firm,
    riskCapMethod,
    firmCapApplied,
    pyramidFloorApplied,
    accountHealthRatio,
    drawdownRoomCap,
    drawdownRoomCapBinding,
    scalingMode,
    scalingTier: tiers,
    evidence: {
      accountBalance: input.accountBalance,
      cumulativeProfit: input.cumulativeProfit,
      atrPoints: input.atrPoints,
      stopMultiplier: input.stopMultiplier,
      pointDollarValue: input.pointDollarValue,
      stopDollarsPerContract,
      riskDollars,
      ...(firm === "topstep" ? {
        trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor,
        hwm_defaulted: !hwmProvided,  // F-2: visibility flag for conservative HWM default
      } : {}),
      pyramidTier,
      pyramidTierMultiplied,
      riskDerivedCap,
      riskDerivedCapMultiplied,
      firmCap: effectiveFirmCap,
      liquidityCap,
      drawdownRoomCap: drawdownRoomCap ?? null,
      drawdownRoomCapBinding,
      finalContracts,
      bindingCap,
      base_contracts: cfg.base_contracts,
      tier_increment: cfg.tier_increment,
      tier_threshold_dollars: cfg.tier_threshold_dollars,
      max_risk_pct_per_trade: cfg.max_risk_pct_per_trade,
      vol_scale: volScale,
      effective_max_risk_pct: effectiveMaxRiskPct,
      vix_now: input.vixNow ?? null,
      vix_target: RISK_VIX_TARGET,
      liquidity_haircut: liquidityHaircut,
      liquidity_cap_raw: cfg.liquidity_comfort_cap,
      current_top3_depth: input.currentTop3Depth ?? null,
      baseline_top3_depth: input.baseline20dMedianTop3Depth ?? null,
      tiers_earned: tiers,
      scaling_mode: scalingMode,
      scaling_tier: tiers,
      firm,
      riskCapMethod,
      accountHealthRatio,
      pyramidFloorApplied,
      confluenceCount,
      confluenceMultiplier: multiplier,
    },
    confluenceAudit: {
      confluence_count: confluenceCount,
      multiplier,
      contracts_before: contractsBefore,
      contracts_after: finalContracts,
      binding_constraint: bindingConstraintForAudit,
    },
  };
}
