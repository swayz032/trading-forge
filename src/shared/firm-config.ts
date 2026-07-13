import { getFirmStageRules } from "./firm-stage-rules.js";

// ─── Legacy projection of the canonical stage rule book ────────────────────
// Every TS file that needs the legacy 50K account shape imports from here.
// Rule values originate in firm-stage-rules.json, which separates evaluation,
// funded, payout, and live requirements.
// Only Topstep (PRIMARY) + MFFU (secondary) per CLAUDE.md §6.
// Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed 2026-05-19.
// ALL firms are 50K accounts. We trade MICROS only (MES/MNQ/MCL).
//
// ─── Phase 5 Mini Contract Scaffold ─────────────────────────────────────────
//
// Phase 5 deployment criteria: operator funded account balance >= $200K.
// This is a FUTURE deployment, not currently active.
//
// How to enable: set TF_PHASE_5_ENABLED=true in tower .env AFTER:
//   1. Operator deposits and funded balance reaches $200K
//   2. Operator runs the Phase 5 validation cycle (manual sign-off required)
//   3. System Map sync passes with mini contract entries registered
//
// Why feature-gated: prevent accidental 10x size inflation from generic symbol
// routing. Micro aliases (ES→$5/pt, NQ→$2/pt, CL→$100/pt) vs true minis
// (ES=$50/pt, NQ=$20/pt, CL=$1000/pt) differ by exactly 10x. Routing a mini
// symbol to the micro spec silently inflates risk math by a full order of magnitude.
//
// Reference: CLAUDE.md §5 "Mini contracts (ES/NQ/CL) are FUTURE — graduate when
// single account funded balance >= $200K" and feedback_day_trader_only_no_swing.md
// (Pass 1 Track 1 safety guard). See also src/engine/config.py for Python mirror.
//
// ENABLED DEFAULT: false (institutional default is opt-IN explicitly).
// FIRST-CALL WARNING: When PHASE_5_ENABLED=true, resolveContractSpec() logs
// once so operators cannot miss Phase 5 activation on boot.

export interface FirmAccountConfig {
  accountSize: number;
  monthlyFee: number;
  activationFee: 0;              // ALWAYS $0 — all firms
  ongoingMonthlyFee: number;
  profitTarget: number;
  maxDrawdown: number;            // Also serves as buffer amount
  /** Max MICRO contracts at $50K (50 = 5 minis × 10:1 ratio). */
  maxContracts: number;
  trailing: "eod" | "intraday";
  payoutSplit: number;            // Initial split
  payoutSplitTiers?: { threshold: number; split: number }[];
  payoutCountTiers?: { payoutNumber: number; split: number }[];  // Alpha: count-based tiers
  minPayoutDays: number;
  consistencyRule: number | null;
  dailyLossLimit: number | null;
  overnightOk: boolean;
  weekendOk: boolean;             // All firms = false
  commissionPerSide: number;      // Per-side commission in dollars
  minTradingDays: number;         // Min trading days required to pass eval
  // ── MFFU 2026 compliance fields ──────────────────────────────────────────
  payoutCycleDays?: number;                    // MFFU: 14 (bi-weekly)
  hftMaxTradesPerDay?: number;                 // MFFU: 500 (trades/day ceiling before HFT classification)
  collaborativeTradingBanned?: boolean;        // MFFU: true (multiple accounts same strategy = ban)
  sameDeviceBanned?: boolean;                  // MFFU: true (family on shared computer = ban)
  hedgingSameUnderlyingBanned?: boolean;       // MFFU: true (MNQ+NQ simultaneously = violation)
  twoPercentRulePct?: number;                  // MFFU: 0.02 (max 2% account loss per single trade)
  baselineSlippageTicksMes?: number;           // MFFU: 2 (slippage floor for MES per Rule 7)
  tier1EventBlackoutMinutes?: number;          // MFFU: 30 (blackout window around Tier-1 events)
  simultaneousLimitsAtSamePriceBanned?: boolean; // MFFU: true (Rule 6)
  // ── Topstep 2026 compliance fields ───────────────────────────────────────
  platformLockdownDate?: string;               // Topstep: "2026-01-12" (TopstepX-only since this date)
  requiredPlatform?: string;                   // Topstep: "topstepx"
  allowsVps?: boolean;                         // Topstep: false (personal device only)
  allowsVpn?: boolean;                         // Topstep: false
  allowsRemoteDesktop?: boolean;               // Topstep: false
  allowsCloudFailover?: boolean;               // Topstep: false (VPS/VPN/remote banned = no cloud failover)
  multiAccountWithinUserAllowed?: boolean;     // Topstep: true
  copyTradesWithinUserAllowed?: boolean;       // Topstep: true
  // ── Topstep 2026-06-02 voluntary-DLL payout cap promo ────────────────────
  // XFA payout caps indexed by path: { standard: {base, withDll}, consistency: {base, withDll} }
  // null for each path = uncapped (LFA). MFFU carries no such field (flat $2K cap).
  xfaPayoutCaps?: Record<string, { base: number; withDll: number }>;
}

export interface FirmConfig {
  name: string;
  displayName: string;
  evaluationType: "one_step" | "two_step";
  accountTypes: Record<string, FirmAccountConfig>;
  /**
   * Wave 24 Item 17 — C11 macro gate mode per firm.
   * "strict":   MFFU rule — block entries during FOMC/CPI/NFP ±30min (unchanged).
   * "advisory": Topstep as of April 2026 — Topstep Help Center publishes NO hard
   *             news-trading blackout. Emit audit warn but do NOT block the entry.
   * Default "strict" for any unknown firm (fail-closed).
   */
  macro_blackout_mode: "strict" | "advisory";
}

// ─── Firm Data (50K accounts only) ──────────────────────────────────────────

function stageNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric stage rule: ${label}`);
  }
  return value;
}

function stageBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid boolean stage rule: ${label}`);
  }
  return value;
}

function stageZero(value: unknown, label: string): 0 {
  if (value !== 0) {
    throw new Error(`Expected zero stage rule: ${label}`);
  }
  return 0;
}

function stageRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid object stage rule: ${label}`);
  }
  return value as Record<string, unknown>;
}

function legacyTrailing(value: unknown, label: string): "eod" | "intraday" {
  if (value === "eod") return "eod";
  if (value === "realtime") return "intraday";
  throw new Error(`Invalid trailing stage rule: ${label}`);
}

const MFFU_STAGE_RULES = getFirmStageRules("mffu_50k");
const MFFU_EVALUATION = MFFU_STAGE_RULES.evaluation;
const MFFU_PAYOUT = MFFU_STAGE_RULES.payout;
const MFFU_EXECUTION = MFFU_STAGE_RULES.execution;
const TOPSTEP_STAGE_RULES = getFirmStageRules("topstep_50k");
const TOPSTEP_EVALUATION = TOPSTEP_STAGE_RULES.evaluation;
const TOPSTEP_PAYOUT = TOPSTEP_STAGE_RULES.payout;
const TOPSTEP_EXECUTION = TOPSTEP_STAGE_RULES.execution;
const TOPSTEP_PAYOUT_PATHS = TOPSTEP_PAYOUT["paths"] as Record<string, Record<string, unknown>>;
const TOPSTEP_STANDARD_CAP = stageRecord(
  TOPSTEP_PAYOUT_PATHS["standard"]?.["payout_cap"],
  "topstep.payout.standard.payout_cap",
);
const TOPSTEP_CONSISTENCY_CAP = stageRecord(
  TOPSTEP_PAYOUT_PATHS["consistency"]?.["payout_cap"],
  "topstep.payout.consistency.payout_cap",
);

/**
 * Backward-compatible account projection. `consistencyRule` intentionally
 * remains null: neither firm's payout-stage condition is an evaluation or
 * account-survival violation. Stage-aware consumers use firm-stage-rules.ts.
 */
export const FIRMS: Record<string, FirmConfig> = {
  mffu: {
    name: MFFU_STAGE_RULES.firm_id,
    displayName: MFFU_STAGE_RULES.display_name,
    evaluationType: MFFU_STAGE_RULES.evaluation_type,
    macro_blackout_mode: MFFU_STAGE_RULES.macro_blackout_mode,
    accountTypes: {
      "50k": {
        accountSize: stageNumber(MFFU_EVALUATION.account_size, "mffu.evaluation.account_size"),
        monthlyFee: stageNumber(MFFU_EVALUATION.monthly_fee, "mffu.evaluation.monthly_fee"),
        activationFee: stageZero(MFFU_EVALUATION.activation_fee, "mffu.evaluation.activation_fee"),
        ongoingMonthlyFee: stageNumber(MFFU_EVALUATION.ongoing_monthly_fee, "mffu.evaluation.ongoing_monthly_fee"),
        profitTarget: stageNumber(MFFU_EVALUATION.profit_target, "mffu.evaluation.profit_target"),
        maxDrawdown: stageNumber(MFFU_EVALUATION.max_drawdown, "mffu.evaluation.max_drawdown"),
        maxContracts: stageNumber(MFFU_EVALUATION.max_contracts, "mffu.evaluation.max_contracts"),
        trailing: legacyTrailing(MFFU_EVALUATION.trailing, "mffu.evaluation.trailing"),
        payoutSplit: stageNumber(MFFU_PAYOUT["payout_split"], "mffu.payout.payout_split"),
        minPayoutDays: stageNumber(MFFU_PAYOUT["minimum_qualifying_days"], "mffu.payout.minimum_qualifying_days"),
        consistencyRule: null,
        dailyLossLimit: stageNumber(MFFU_EVALUATION.daily_loss_limit, "mffu.evaluation.daily_loss_limit"),
        overnightOk: stageBoolean(MFFU_EVALUATION.overnight_ok, "mffu.evaluation.overnight_ok"),
        weekendOk: stageBoolean(MFFU_EVALUATION.weekend_ok, "mffu.evaluation.weekend_ok"),
        commissionPerSide: stageNumber(MFFU_EXECUTION["commission_per_side"], "mffu.execution.commission_per_side"),
        minTradingDays: stageNumber(MFFU_EVALUATION.min_trading_days, "mffu.evaluation.min_trading_days"),
        payoutCycleDays: stageNumber(MFFU_PAYOUT["payout_cycle_days"], "mffu.payout.payout_cycle_days"),
        hftMaxTradesPerDay: stageNumber(MFFU_EXECUTION["hft_max_trades_per_day"], "mffu.execution.hft_max_trades_per_day"),
        collaborativeTradingBanned: stageBoolean(MFFU_EXECUTION["collaborative_trading_banned"], "mffu.execution.collaborative_trading_banned"),
        sameDeviceBanned: stageBoolean(MFFU_EXECUTION["same_device_banned"], "mffu.execution.same_device_banned"),
        hedgingSameUnderlyingBanned: stageBoolean(MFFU_EXECUTION["hedging_same_underlying_banned"], "mffu.execution.hedging_same_underlying_banned"),
        twoPercentRulePct: stageNumber(MFFU_EXECUTION["two_percent_rule_pct"], "mffu.execution.two_percent_rule_pct"),
        baselineSlippageTicksMes: stageNumber(MFFU_EXECUTION["baseline_slippage_ticks_mes"], "mffu.execution.baseline_slippage_ticks_mes"),
        tier1EventBlackoutMinutes: stageNumber(MFFU_EXECUTION["tier1_event_blackout_minutes"], "mffu.execution.tier1_event_blackout_minutes"),
        simultaneousLimitsAtSamePriceBanned: stageBoolean(MFFU_EXECUTION["simultaneous_limits_at_same_price_banned"], "mffu.execution.simultaneous_limits_at_same_price_banned"),
      },
    },
  },
  topstep: {
    name: TOPSTEP_STAGE_RULES.firm_id,
    displayName: TOPSTEP_STAGE_RULES.display_name,
    evaluationType: TOPSTEP_STAGE_RULES.evaluation_type,
    macro_blackout_mode: TOPSTEP_STAGE_RULES.macro_blackout_mode,
    accountTypes: {
      "50k": {
        accountSize: stageNumber(TOPSTEP_EVALUATION.account_size, "topstep.evaluation.account_size"),
        monthlyFee: stageNumber(TOPSTEP_EVALUATION.monthly_fee, "topstep.evaluation.monthly_fee"),
        activationFee: stageZero(TOPSTEP_EVALUATION.activation_fee, "topstep.evaluation.activation_fee"),
        ongoingMonthlyFee: stageNumber(TOPSTEP_EVALUATION.ongoing_monthly_fee, "topstep.evaluation.ongoing_monthly_fee"),
        profitTarget: stageNumber(TOPSTEP_EVALUATION.profit_target, "topstep.evaluation.profit_target"),
        maxDrawdown: stageNumber(TOPSTEP_EVALUATION.max_drawdown, "topstep.evaluation.max_drawdown"),
        maxContracts: stageNumber(TOPSTEP_EVALUATION.max_contracts, "topstep.evaluation.max_contracts"),
        trailing: legacyTrailing(TOPSTEP_EVALUATION.trailing, "topstep.evaluation.trailing"),
        payoutSplit: stageNumber(TOPSTEP_PAYOUT["payout_split"], "topstep.payout.payout_split"),
        minPayoutDays: stageNumber(TOPSTEP_PAYOUT_PATHS["standard"]?.["minimum_winning_days"], "topstep.payout.standard.minimum_winning_days"),
        consistencyRule: null,
        dailyLossLimit: stageNumber(TOPSTEP_EVALUATION.daily_loss_limit, "topstep.evaluation.daily_loss_limit"),
        overnightOk: stageBoolean(TOPSTEP_EVALUATION.overnight_ok, "topstep.evaluation.overnight_ok"),
        weekendOk: stageBoolean(TOPSTEP_EVALUATION.weekend_ok, "topstep.evaluation.weekend_ok"),
        commissionPerSide: stageNumber(TOPSTEP_EXECUTION["commission_per_side"], "topstep.execution.commission_per_side"),
        minTradingDays: stageNumber(TOPSTEP_EVALUATION.min_trading_days, "topstep.evaluation.min_trading_days"),
        platformLockdownDate: String(TOPSTEP_EXECUTION["platform_lockdown_date"]),
        requiredPlatform: String(TOPSTEP_EXECUTION["required_platform"]),
        allowsVps: stageBoolean(TOPSTEP_EXECUTION["allows_vps"], "topstep.execution.allows_vps"),
        allowsVpn: stageBoolean(TOPSTEP_EXECUTION["allows_vpn"], "topstep.execution.allows_vpn"),
        allowsRemoteDesktop: stageBoolean(TOPSTEP_EXECUTION["allows_remote_desktop"], "topstep.execution.allows_remote_desktop"),
        allowsCloudFailover: (
          stageBoolean(TOPSTEP_EXECUTION["allows_vps"], "topstep.execution.allows_vps")
          || stageBoolean(TOPSTEP_EXECUTION["allows_vpn"], "topstep.execution.allows_vpn")
          || stageBoolean(TOPSTEP_EXECUTION["allows_remote_desktop"], "topstep.execution.allows_remote_desktop")
        ),
        multiAccountWithinUserAllowed: stageBoolean(TOPSTEP_EXECUTION["multi_account_within_user_allowed"], "topstep.execution.multi_account_within_user_allowed"),
        copyTradesWithinUserAllowed: stageBoolean(TOPSTEP_EXECUTION["copy_trades_within_user_allowed"], "topstep.execution.copy_trades_within_user_allowed"),
        xfaPayoutCaps: {
          standard: {
            base: stageNumber(TOPSTEP_STANDARD_CAP["base"], "topstep.payout.standard.payout_cap.base"),
            withDll: stageNumber(TOPSTEP_STANDARD_CAP["with_dll"], "topstep.payout.standard.payout_cap.with_dll"),
          },
          consistency: {
            base: stageNumber(TOPSTEP_CONSISTENCY_CAP["base"], "topstep.payout.consistency.payout_cap.base"),
            withDll: stageNumber(TOPSTEP_CONSISTENCY_CAP["with_dll"], "topstep.payout.consistency.payout_cap.with_dll"),
          },
        },
      },
    },
  },
};

// ─── Phase 5 Feature Gate ─────────────────────────────────────────────────────
//
// Read from env var TF_PHASE_5_ENABLED (case-insensitive, default false).
// DO NOT set this to true until the operator has a funded balance >= $200K and
// has completed the Phase 5 validation cycle.
//
// Warn tracking is done at module level so the activation banner fires once per
// process, not on every resolveContractSpec() call.

export const PHASE_5_ENABLED: boolean =
  (process.env["TF_PHASE_5_ENABLED"] ?? "false").toLowerCase() === "true";

let _phase5WarnEmitted = false;

// ─── Contract Spec Interface ─────────────────────────────────────────────────

export interface ContractSpec {
  tickSize: number;
  tickValue: number;
  pointValue: number;
  /** Phase 5 scaffold: "micro" for current production, "mini" for Phase 5 true-mini specs. */
  contractClass: "micro" | "mini";
}

// ─── Contract Specs ─────────────────────────────────────────────────────────

// Micro contract specs (current production).
// Do NOT modify these entries — downstream tests pin exact values.
const MICRO_SPECS: Record<string, ContractSpec> = {
  MES: { tickSize: 0.25, tickValue: 1.25,  pointValue: 5.00,     contractClass: "micro" },
  MNQ: { tickSize: 0.25, tickValue: 0.50,  pointValue: 2.00,     contractClass: "micro" },
  MCL: { tickSize: 0.01, tickValue: 1.00,  pointValue: 100.00,   contractClass: "micro" },
} as const;

// Phase 5 true-mini contract specs (FUTURE — NOT active in production).
// These carry INSTITUTIONAL-CORRECT 10x point values vs the micro specs.
// ES: $50/pt (vs MES $5/pt)   — 10x multiplier
// NQ: $20/pt (vs MNQ $2/pt)   — 10x multiplier
// CL: $1000/pt (vs MCL $100/pt) — 10x multiplier
// Verified against CME Group contract specifications 2026-05-25.
const MINI_SPECS: Record<string, ContractSpec> = {
  ES: { tickSize: 0.25, tickValue: 12.50, pointValue: 50.00,   contractClass: "mini" },
  NQ: { tickSize: 0.25, tickValue: 5.00,  pointValue: 20.00,   contractClass: "mini" },
  CL: { tickSize: 0.01, tickValue: 10.00, pointValue: 1000.00, contractClass: "mini" },
} as const;

/**
 * CONTRACT_SPECS — public table (backward-compat surface).
 *
 * ES/NQ/CL entries here remain the MICRO aliases (S3 data-path compat).
 * Phase 5 true-mini specs live in MINI_SPECS and are only accessible via
 * resolveContractSpec() with an explicit contractClass argument.
 */
export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  // Micro contracts — current production
  MES: MICRO_SPECS["MES"]!,
  MNQ: MICRO_SPECS["MNQ"]!,
  MCL: MICRO_SPECS["MCL"]!,
  // S3 data-path labels — MICRO aliases (point_value = micro, NOT full-size)
  ES: MICRO_SPECS["MES"]!,
  NQ: MICRO_SPECS["MNQ"]!,
  CL: MICRO_SPECS["MCL"]!,
};

// ─── Phase 5-aware contract spec resolver ────────────────────────────────────

/**
 * Resolve the ContractSpec for a symbol with Phase 5 safety gating.
 *
 * This is the Phase 5-aware replacement for direct CONTRACT_SPECS[symbol] lookups.
 * All new callers that may encounter ES/NQ/CL symbols should use this helper.
 *
 * Resolution rules (mirrors src/engine/config.py::resolve_contract_spec):
 * 1. If contractClass explicitly provided:
 *    - "micro" → returns the micro spec (MICRO_SPECS via alias map)
 *    - "mini"  → returns the true mini spec (MINI_SPECS)
 *    - other   → throws with valid options listed
 * 2. If contractClass is undefined AND PHASE_5_ENABLED is false:
 *    - Always returns the MICRO spec (safety default)
 * 3. If contractClass is undefined AND PHASE_5_ENABLED is true:
 *    - Throws — forces every call site to explicitly declare intent
 *
 * Activation banner: if PHASE_5_ENABLED=true, logs one WARN via console.warn
 * on first call so operators cannot miss Phase 5 activation.
 *
 * @param symbol        Contract symbol (case-insensitive: "MES", "ES", etc.)
 * @param contractClass "micro" | "mini" | undefined (auto-resolve per rules)
 * @returns ContractSpec matching the resolved class
 * @throws Error on invalid contractClass, unknown symbol, or ambiguous Phase 5 call
 */
export function resolveContractSpec(
  symbol: string,
  contractClass?: "micro" | "mini",
): ContractSpec {
  // ── Phase 5 activation banner (one-shot per process) ─────────────────────
  if (PHASE_5_ENABLED && !_phase5WarnEmitted) {
    console.warn(
      "WARN [firm-config.ts::resolveContractSpec] PHASE_5_ENABLED=true — " +
      "mini contract specs (ES/NQ/CL at 10x point values) are active. " +
      "Verify operator has funded balance >= $200K and completed Phase 5 " +
      "validation cycle before any live order routing.",
    );
    _phase5WarnEmitted = true;
  }

  const sym = symbol.toUpperCase();
  // Alias map: micro-named mini tickers → canonical micro symbol
  const microAliasMap: Record<string, string> = { ES: "MES", NQ: "MNQ", CL: "MCL" };
  const microAliasSymbols = new Set(["ES", "NQ", "CL"]);

  // ── Explicit contractClass provided ──────────────────────────────────────
  if (contractClass !== undefined) {
    if (contractClass === "micro") {
      const microSym = microAliasSymbols.has(sym) ? microAliasMap[sym]! : sym;
      const spec = MICRO_SPECS[microSym];
      if (!spec) {
        throw new Error(
          `Unknown micro symbol: '${symbol}'. ` +
          `Valid micro symbols: ${Object.keys(MICRO_SPECS).sort().join(", ")}`,
        );
      }
      return spec;
    }

    if (contractClass === "mini") {
      // Reject micro symbols with mini class — mismatched pairing
      const microToMini: Record<string, string> = { MES: "ES", MNQ: "NQ", MCL: "CL" };
      if (microToMini[sym]) {
        throw new Error(
          `Symbol '${symbol}' is a micro contract. ` +
          `For the mini equivalent use '${microToMini[sym]}' + contractClass='mini'.`,
        );
      }
      const spec = MINI_SPECS[sym];
      if (!spec) {
        throw new Error(
          `Unknown mini symbol: '${symbol}'. ` +
          `Valid Phase 5 mini symbols: ${Object.keys(MINI_SPECS).sort().join(", ")}`,
        );
      }
      return spec;
    }

    // TypeScript narrows away invalid values at compile time, but guard at runtime
    throw new Error(
      `Invalid contractClass='${contractClass as string}'. Must be 'micro' or 'mini'.`,
    );
  }

  // ── No explicit class — apply Phase 5 gating ─────────────────────────────
  if (PHASE_5_ENABLED) {
    throw new Error(
      `resolveContractSpec('${symbol}') called without explicit contractClass ` +
      `while PHASE_5_ENABLED=true. ` +
      `When Phase 5 is active every call site must explicitly declare ` +
      `contractClass='micro' or contractClass='mini' to prevent accidental ` +
      `10x size inflation. Set TF_PHASE_5_ENABLED=false to restore ` +
      `micro-safety-default behaviour.`,
    );
  }

  // PHASE_5_ENABLED=false + no class → safety default: always return micro spec
  if (microAliasSymbols.has(sym)) {
    return MICRO_SPECS[microAliasMap[sym]!]!;
  }
  const microSpec = MICRO_SPECS[sym];
  if (microSpec) return microSpec;

  throw new Error(
    `Unknown symbol: '${symbol}'. ` +
    `Valid symbols: ${[...Object.keys(MICRO_SPECS), ...Object.keys(microAliasMap)].sort().join(", ")}`,
  );
}

// ─── Contract Cap Bounds (mirrors Python firm_config.py) ────────────────────
// Active 50K stage contracts: Topstep permits 50 micros and MFFU Builder
// permits 40. The global bound remains 60 for compatibility with historical
// non-active plans; consumers must use the per-firm cap above it.

export const CONTRACT_CAP_MIN = 0;
export const CONTRACT_CAP_MAX = 60;

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_ACCOUNT_SIZE = 50_000;
export const DEFAULT_ACCOUNT_TYPE = "50k";

// ─── Helper Functions (simplified — all firms are 50K only) ─────────────────

/** Get a firm's 50K account config. accountType param kept for backward compat but defaults to "50k". */
export function getFirmAccount(firmName: string, accountType: string = "50k"): FirmAccountConfig | null {
  const firm = FIRMS[firmName.toLowerCase()];
  if (!firm) return null;
  return firm.accountTypes[accountType.toLowerCase()] ?? firm.accountTypes["50k"] ?? null;
}

function getFirmStageRulesByLegacyName(firmName: string) {
  const normalized = firmName.trim().toLowerCase();
  const firmKey = normalized === "topstep"
    ? "topstep_50k"
    : normalized === "mffu"
      ? "mffu_50k"
      : null;
  if (!firmKey) throw new Error(`Unknown legacy firm name '${firmName}'.`);
  return getFirmStageRules(firmKey);
}

/** Get risk-relevant limits for a firm (always 50K) */
export function getFirmLimit(
  firmName: string,
  _accountType: string = "50k",
): { maxDrawdown: number; maxContracts: number; dailyLossLimit: number | null; trailing: "eod" | "intraday" } | null {
  const acct = getFirmAccount(firmName, "50k");
  if (!acct) return null;
  return {
    maxDrawdown: acct.maxDrawdown,
    maxContracts: acct.maxContracts,
    dailyLossLimit: acct.dailyLossLimit,
    trailing: acct.trailing,
  };
}

/** Return all FirmConfig values */
export function getAllFirms(): FirmConfig[] {
  return Object.values(FIRMS);
}

/**
 * Wave 24 Item 17 — Return the C11 macro blackout mode for a given firmId.
 * "strict": block entries during news windows (MFFU).
 * "advisory": warn but allow through (Topstep).
 * Falls back to "strict" for unknown firms (fail-closed).
 */
export function getMacroBlackoutMode(firmId: string | null | undefined): "strict" | "advisory" {
  if (!firmId) return "strict";
  const firm = FIRMS[firmId.toLowerCase()];
  return firm?.macro_blackout_mode ?? "strict";
}

/** Find which firm has the tightest (smallest) drawdown */
export function getTightestDrawdown(): { firm: string; maxDrawdown: number } | null {
  let tightest: { firm: string; maxDrawdown: number } | null = null;
  for (const firm of Object.values(FIRMS)) {
    const acct = firm.accountTypes["50k"];
    if (!acct) continue;
    if (!tightest || acct.maxDrawdown < tightest.maxDrawdown) {
      tightest = { firm: firm.name, maxDrawdown: acct.maxDrawdown };
    }
  }
  return tightest;
}

// ─── Commission Helpers ──────────────────────────────────────────────────────

/** Default commission per side when firmId is null/unknown. */
export const DEFAULT_COMMISSION_PER_SIDE = 0.62;

/**
 * Returns the per-side commission in dollars for a given firmId.
 * Reads directly from FIRMS (the single source of truth).
 * Falls back to DEFAULT_COMMISSION_PER_SIDE when firmId is null/unknown —
 * conservative choice that avoids overstating net P&L.
 */
export function getCommissionPerSide(firmId: string | null | undefined): number {
  if (!firmId) return DEFAULT_COMMISSION_PER_SIDE;
  const firm = FIRMS[firmId.toLowerCase()];
  if (!firm) return DEFAULT_COMMISSION_PER_SIDE;
  const acct = firm.accountTypes["50k"];
  if (!acct) return DEFAULT_COMMISSION_PER_SIDE;
  return acct.commissionPerSide;
}

/**
 * Payout buffer required after funding. This is intentionally distinct from
 * evaluation drawdown: MFFU Builder requires its $2,100 payout buffer, while
 * Topstep's configured XFA paths do not declare a dollar payout buffer.
 */
export function getBufferAmount(firmName: string, _accountType: string = "50k"): number | null {
  try {
    const payout = getFirmStageRulesByLegacyName(firmName).payout;
    const buffer = payout["payout_buffer"];
    return typeof buffer === "number" ? buffer : 0;
  } catch {
    return null;
  }
}

/** Total hurdle = evaluation target + configured post-funding payout buffer. */
export function getTotalHurdle(firmName: string, _accountType: string = "50k"): number | null {
  const acct = getFirmAccount(firmName, "50k");
  const buffer = getBufferAmount(firmName, _accountType);
  if (!acct || buffer == null) return null;
  return acct.profitTarget + buffer;
}

// ─── Liquidity Comfort Caps (F-3) ───────────────────────────────────────────
// Per-symbol book-depth ceiling for paper + backtest sizing.
// Wave 23 canonical per CLAUDE.md §4: MES=100, MNQ=50, MCL=30.
// Paper-signal-service and risk-sizing.ts use these as fallback when
// position_size.liquidity_comfort_cap is absent from the DSL config.
export const LIQUIDITY_COMFORT_CAPS: Record<string, number> = {
  MES: 100,
  MNQ: 50,
  MCL: 30,
} as const;
/** Fallback when symbol not in LIQUIDITY_COMFORT_CAPS (conservative mid-range). */
export const LIQUIDITY_COMFORT_CAP_DEFAULT = 50;

// ─── Topstep Trailing-DD by Account Size (F-5) ──────────────────────────────
// Trailing drawdown amounts indexed by account starting floor ($).
// Source: docs/prop-firm-rules-2026-topstep.md §Trailing Drawdown.
// Resolution order for paper-signal-service:
//   session.config.trailing_dd_amount → this table → 2000 (50K default)
export const TOPSTEP_TRAILING_DD_BY_SIZE: Record<number, number> = {
  50000: 2000,
  100000: 3000,
  150000: 4500,
} as const;

// ─── MFFU 2026 named constants (no magic numbers in compliance code) ─────────
// Canonical source: docs/prop-firm-rules-2026-mffu.md §§1,7,8,9
// These must stay in sync with the `mffu["50k"]` entry in FIRMS above.
// If a value changes in FIRMS it must change here too — test mffu-2026-compliance
// asserts equality between constants and firm-config values.

/** Max trades per day before MFFU classifies the account as HFT (Rule 1). */
export const MFFU_HFT_MAX_TRADES_PER_DAY = stageNumber(
  MFFU_EXECUTION["hft_max_trades_per_day"],
  "mffu.execution.hft_max_trades_per_day",
);

/** Max fraction of account balance that a single trade's intended loss may represent (Rule 8). */
export const MFFU_TWO_PERCENT_RULE_PCT = stageNumber(
  MFFU_EXECUTION["two_percent_rule_pct"],
  "mffu.execution.two_percent_rule_pct",
);

/** Minimum slippage tick floor for MES on MFFU paths — enforced in slippage.py (Rule 7). */
export const MFFU_BASELINE_SLIPPAGE_TICKS_MES = stageNumber(
  MFFU_EXECUTION["baseline_slippage_ticks_mes"],
  "mffu.execution.baseline_slippage_ticks_mes",
);

/** Payout cycle in calendar days for the selected Builder plan. */
export const MFFU_PAYOUT_CYCLE_DAYS = stageNumber(
  MFFU_PAYOUT["payout_cycle_days"],
  "mffu.payout.payout_cycle_days",
);

/** Initial trader payout split (Rule 9). */
export const MFFU_PAYOUT_SPLIT = stageNumber(MFFU_PAYOUT["payout_split"], "mffu.payout.payout_split");

// ─── Topstep 2026 named constants (no magic numbers in compliance code) ───────
// Canonical source: docs/prop-firm-rules-2026-topstep.md §Platform §API

/** Date Topstep locked trading exclusively to TopstepX platform. */
export const TOPSTEP_PLATFORM_LOCKDOWN_DATE = String(TOPSTEP_EXECUTION["platform_lockdown_date"]);

/** Required platform identifier after lockdown. */
export const TOPSTEP_REQUIRED_PLATFORM = String(TOPSTEP_EXECUTION["required_platform"]);

/** Topstep does NOT allow cloud failover (VPS/VPN/remote desktop banned). */
export const TOPSTEP_ALLOWS_CLOUD_FAILOVER = (
  stageBoolean(TOPSTEP_EXECUTION["allows_vps"], "topstep.execution.allows_vps")
  || stageBoolean(TOPSTEP_EXECUTION["allows_vpn"], "topstep.execution.allows_vpn")
  || stageBoolean(TOPSTEP_EXECUTION["allows_remote_desktop"], "topstep.execution.allows_remote_desktop")
);

/** TopstepX API monthly subscription fee in USD (with promo code). */
export const TOPSTEPX_API_MONTHLY_FEE_USD = 14.50;

/** Promo code for TopstepX API subscription discount. */
export const TOPSTEPX_PROMO_CODE = "topstep";

// ─── Payout Cap Model (2026-06-02 Topstep voluntary-DLL promo) ───────────────
//
// Topstep XFA (Express Funded Account) payout caps:
//   Standard Path:    base $2,000 / with voluntary-DLL $4,000
//   Consistency Path: base $3,000 / with voluntary-DLL $6,000
//
// Live Funded Account (LFA) is uncapped regardless of DLL opt-in.
// MFFU payout cap: $2,000 flat — no promo, dll_opted_in is ignored.
//
// Conservative contract: default dll_opted_in=false → base cap.
// Never assume the doubled cap unless dll_opted_in is explicitly true.

/** Topstep XFA payout caps per path. withDll = cap after voluntary-DLL opt-in. */
export const TOPSTEP_XFA_PAYOUT_CAPS: Readonly<Record<string, { base: number; withDll: number }>> = {
  standard: {
    base: stageNumber(TOPSTEP_STANDARD_CAP["base"], "topstep.payout.standard.payout_cap.base"),
    withDll: stageNumber(TOPSTEP_STANDARD_CAP["with_dll"], "topstep.payout.standard.payout_cap.with_dll"),
  },
  consistency: {
    base: stageNumber(TOPSTEP_CONSISTENCY_CAP["base"], "topstep.payout.consistency.payout_cap.base"),
    withDll: stageNumber(TOPSTEP_CONSISTENCY_CAP["with_dll"], "topstep.payout.consistency.payout_cap.with_dll"),
  },
} as const;

/**
 * Sentinel value for an uncapped payout tier (Topstep LFA).
 * null means "no cap enforced by policy".
 */
export const TOPSTEP_LFA_PAYOUT_CAP: null = null;

/** MFFU flat per-request payout cap. No voluntary-DLL promo applies. */
export const MFFU_PAYOUT_CAP = stageNumber(MFFU_PAYOUT["maximum_request"], "mffu.payout.maximum_request");

/**
 * Return the maximum payout per withdrawal request for a given firm/stage/path combination.
 *
 * Topstep XFA: doubles when dll_opted_in=true (2026-06-02 voluntary-DLL promo).
 * Topstep LFA: uncapped — returns null.
 * MFFU: always $2,000 regardless of dll_opted_in (promo is Topstep-only).
 *
 * Conservative default: dll_opted_in=false → base cap.
 * Never returns the doubled cap unless dll_opted_in is explicitly true.
 *
 * @param firmId       "topstep" | "mffu"
 * @param accountStage "xfa" | "lfa"
 * @param payoutPath   "standard" | "consistency"
 * @param dllOptedIn   Whether the account elected the voluntary DLL at checkout.
 *                     Default false = base cap (safe conservative default).
 * @returns            Cap in USD, or null for "uncapped".
 */
export function getPayoutCap(
  firmId: string,
  accountStage: "xfa" | "lfa",
  payoutPath: "standard" | "consistency" = "standard",
  dllOptedIn: boolean = false,
): number | null {
  const firm = firmId.toLowerCase();

  if (firm === "topstep") {
    if (accountStage === "lfa") return TOPSTEP_LFA_PAYOUT_CAP; // null — uncapped
    // XFA
    const caps = TOPSTEP_XFA_PAYOUT_CAPS[payoutPath];
    if (!caps) {
      throw new Error(
        `Unknown payoutPath '${payoutPath}' for Topstep XFA. Valid: ${Object.keys(TOPSTEP_XFA_PAYOUT_CAPS).join(", ")}`,
      );
    }
    return dllOptedIn ? caps.withDll : caps.base;
  }

  if (firm === "mffu") {
    // dll_opted_in is intentionally ignored — MFFU has no voluntary-DLL promo.
    return MFFU_PAYOUT_CAP;
  }

  throw new Error(`Unknown firmId '${firmId}'. Valid: 'topstep', 'mffu'.`);
}
