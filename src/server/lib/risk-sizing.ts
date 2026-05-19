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
  evidence: Record<string, number | string | null>;
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
  const liquidityCap = cfg.liquidity_comfort_cap;

  // Pyramid tier (slow ramp-up)
  const profitFloor = Math.max(0, input.cumulativeProfit);
  const tiers = Math.floor(profitFloor / cfg.tier_threshold_dollars);
  const pyramidTier = cfg.base_contracts + cfg.tier_increment * tiers;

  // Wave 23: Account health ratio for pyramid floor enforcement.
  // Floor binds when account is healthy (>= 85% of starting capital).
  // Starting capital: for Topstep = accountStartingFloor; for MFFU = 50K default.
  const startingCapitalForHealth = input.accountStartingFloor ?? 50_000;
  const accountHealthRatio = startingCapitalForHealth > 0
    ? input.accountBalance / startingCapitalForHealth
    : 1.0;
  const accountIsHealthy = accountHealthRatio >= 0.85;

  // Edge case: balance ≤ 0
  if (input.accountBalance <= 0) {
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
    };
  }

  // ── Wave 22: Firm-aware risk dollar computation ──────────────────────────────
  let riskDollars: number;
  let riskCapMethod: "topstep_trailing_dd" | "mffu_balance_pct";

  // Topstep-specific trailing state (resolved with sensible defaults)
  const trailingDD = input.trailingDD ?? 2000;                          // 50K Topstep default
  const highWaterBalance = input.highWaterBalance ?? input.accountBalance; // first day: HWM = current
  const accountStartingFloor = input.accountStartingFloor ?? 50_000;    // 50K Topstep default

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
        evidence: {
          accountBalance: input.accountBalance,
          trailingFloor,
          buffer,
          highWaterBalance,
          trailingDD,
          accountStartingFloor,
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
      };
    }

    riskDollars = buffer * cfg.max_risk_pct_per_trade;
  } else {
    // MFFU: risk against current balance (unchanged from Wave 10)
    riskCapMethod = "mffu_balance_pct";
    riskDollars = input.accountBalance * cfg.max_risk_pct_per_trade;
  }

  // Risk-derived ceiling (common to both firms)
  const stopDollarsPerContract = input.stopMultiplier * input.atrPoints * input.pointDollarValue;
  const riskDerivedCap = Math.floor(riskDollars / stopDollarsPerContract);

  // Edge case: computed cap ≤ 0 (extreme ATR or tiny account/buffer).
  // Wave 23: On healthy accounts, pyramid floor still applies even here.
  // If accountIsHealthy AND riskCap <= 0, we use base_contracts as the floor.
  // This handles the Topstep fresh-combine case: riskCap=0 but account is healthy.
  // On drawdown accounts, this rejection holds (risk-cap protects the account).
  if (riskDerivedCap <= 0) {
    if (accountIsHealthy && cfg.base_contracts > 0) {
      // Pyramid floor applies on healthy account — use base_contracts
      const flooredContracts = cfg.base_contracts;
      return {
        finalContracts: flooredContracts,
        pyramidTier,
        riskDerivedCap,
        firmCap: null,
        liquidityCap,
        rejectionReason: null,  // not a rejection — floor overrides
        firm,
        riskCapMethod,
        firmCapApplied: false,
        pyramidFloorApplied: true,
        accountHealthRatio,
        evidence: {
          accountBalance: input.accountBalance,
          atrPoints: input.atrPoints,
          stopMultiplier: input.stopMultiplier,
          pointDollarValue: input.pointDollarValue,
          stopDollarsPerContract,
          riskDollars,
          ...(firm === "topstep" ? { trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor } : {}),
          pyramidTier,
          riskDerivedCap,
          firmCap: null,
          liquidityCap,
          finalContracts: flooredContracts,
          rejectionReason: null,
          firm,
          accountHealthRatio,
          pyramidFloorApplied: true,
          bindingCap: "pyramid_floor_override",
          base_contracts: cfg.base_contracts,
          riskCapMethod,
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
      evidence: {
        accountBalance: input.accountBalance,
        atrPoints: input.atrPoints,
        stopMultiplier: input.stopMultiplier,
        pointDollarValue: input.pointDollarValue,
        stopDollarsPerContract,
        riskDollars,
        ...(firm === "topstep" ? { trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor } : {}),
        pyramidTier,
        riskDerivedCap,
        firmCap: null,
        liquidityCap,
        finalContracts: 0,
        rejectionReason: "negative_cap",
        firm,
        accountHealthRatio,
        pyramidFloorApplied: false,
      },
    };
  }

  // Effective firm cap: DSL override takes priority over live firm cap
  const effectiveFirmCap: number | null =
    typeof cfg.topstep_account_cap_override === "number"
      ? cfg.topstep_account_cap_override
      : (input.firmContractCap ?? null);

  // Final: compute the risk-capped minimum first, then apply pyramid floor.
  // Step 1: min(pyramidTier, riskDerivedCap, firmCap, liquidityCap)
  let finalContracts = Math.min(pyramidTier, riskDerivedCap, liquidityCap);
  const firmCapApplied = effectiveFirmCap !== null && effectiveFirmCap < Math.min(pyramidTier, riskDerivedCap, liquidityCap);
  if (effectiveFirmCap !== null) {
    finalContracts = Math.min(finalContracts, effectiveFirmCap);
  }
  finalContracts = Math.max(0, finalContracts);

  // Step 2 (Wave 23): Pyramid floor enforcement.
  // On healthy accounts (>= 85% of starting capital), base_contracts is the minimum viable
  // contract count. Risk-cap can return fewer than base on fresh Topstep combines (narrow
  // buffer = low risk cap), which would break Style C 33/33/33 partials.
  // Rule: if account is healthy AND risk-cap produced fewer than base_contracts → use base_contracts.
  // On drawdown accounts (< 85%), risk-cap fully binds — floor does not override.
  let pyramidFloorApplied = false;
  if (accountIsHealthy && finalContracts < cfg.base_contracts) {
    finalContracts = cfg.base_contracts;
    pyramidFloorApplied = true;
  }

  // Which cap is binding?
  let bindingCap = "pyramid";
  if (pyramidFloorApplied) {
    bindingCap = "pyramid_floor_override";
  } else if (riskDerivedCap <= pyramidTier && (effectiveFirmCap === null || riskDerivedCap <= effectiveFirmCap) && riskDerivedCap <= liquidityCap) {
    bindingCap = "risk_derived";
  } else if (effectiveFirmCap !== null && effectiveFirmCap <= pyramidTier && effectiveFirmCap <= riskDerivedCap && effectiveFirmCap <= liquidityCap) {
    bindingCap = "firm_cap";
  } else if (liquidityCap <= pyramidTier && liquidityCap <= riskDerivedCap && (effectiveFirmCap === null || liquidityCap <= effectiveFirmCap)) {
    bindingCap = "liquidity_cap";
  }

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
    evidence: {
      accountBalance: input.accountBalance,
      cumulativeProfit: input.cumulativeProfit,
      atrPoints: input.atrPoints,
      stopMultiplier: input.stopMultiplier,
      pointDollarValue: input.pointDollarValue,
      stopDollarsPerContract,
      riskDollars,
      ...(firm === "topstep" ? { trailingFloor, buffer, highWaterBalance, trailingDD, accountStartingFloor } : {}),
      pyramidTier,
      riskDerivedCap,
      firmCap: effectiveFirmCap,
      liquidityCap,
      finalContracts,
      bindingCap,
      base_contracts: cfg.base_contracts,
      tier_increment: cfg.tier_increment,
      tier_threshold_dollars: cfg.tier_threshold_dollars,
      max_risk_pct_per_trade: cfg.max_risk_pct_per_trade,
      tiers_earned: tiers,
      firm,
      riskCapMethod,
      accountHealthRatio,
      pyramidFloorApplied,
    },
  };
}
