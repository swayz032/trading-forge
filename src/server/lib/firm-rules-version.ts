/**
 * firm-rules-version.ts — Firm rules version fingerprinting for drift detection.
 *
 * Wave 27.5 Pass A.1 — CRITICAL #1: Firm-Rule Parameter Drift Check
 *
 * Purpose: TypeScript mirror of src/engine/firm_rules_version.py.
 * Computes a deterministic 16-char hex prefix of SHA-256 over the combined
 * FIRM_CONFIGS + FIRM_RULES dictionaries.  Stamped on every new backtest row.
 * Monte Carlo reads the stored version, computes the current version, and
 * refuses to run if they differ.
 *
 * Cross-language parity contract:
 *   Python compute_firm_rules_version_from_dicts(fc, fr) === TS computeFirmRulesVersionFromDicts(fc, fr)
 *   for any identical JSON-serialisable dicts fc, fr.
 *   Validated by tests/python/test_firm_rules_version.py and
 *   src/server/__tests__/wave27-5-firm-rules-version-parity.test.ts.
 *
 * Design:
 *   - sha256(JSON.stringify({FIRM_CONFIGS: fc, FIRM_RULES: fr}, replacer, sortKeys))
 *     where sortKeys is achieved via a replacer that sorts object keys.
 *   - Separators: no whitespace — matches Python json.dumps(separators=(',',':'))
 *   - Returns lowercase hex slice [0:16].
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { createHash } from "node:crypto";

// ─── FIRM_CONFIGS canonical snapshot (mirrors src/engine/prop_compliance.py) ──
// This is the single source of truth for the TypeScript side of firm config.
// Keep in sync with prop_compliance.py::FIRM_CONFIGS.
// Only Topstep + MFFU per CLAUDE.md §6.
// M4 2026-06-23: aligned to src/engine/prop_compliance.py::FIRM_CONFIGS exactly.
// Any field added/removed/changed here MUST be mirrored to Python in the SAME
// commit; CI gate `npm run check:ts-python-firm-rules-version` enforces parity.
export const FIRM_CONFIGS_TS = {
  topstep_50k: {
    name: "Topstep 50K",
    monthly_fee: 49,
    activation_fee: 0,
    profit_target: 3000,
    max_drawdown: 2000,
    trailing: "eod",
    locks_at_start: true,
    consistency_rule: "topstep_50pct", // 50% best-day cap at Combine pass-request
    overnight_ok: false,
    payout_split: 0.90,
    payout_split_tiers: null,
    ongoing_fee: 0,
    daily_loss_limit: 1000,
    min_payout_days: 5,
    min_trading_days: 5,
  },
  mffu_50k: {
    // W3B F-2 (2026-07-17): mirrors the prop_compliance.py sync to canonical
    // firm_config.py Builder values — name Core→Builder, consistency_rule
    // "mffu_50pct"→"mffu_50pct_sim_payout", min_payout_days 5→2,
    // min_trading_days 5→1. Version hash bump is BY DESIGN (the MC drift gate
    // exists to refuse grading against stale rules).
    name: "MFFU 50K (Builder)",
    monthly_fee: 77,
    activation_fee: 0,
    profit_target: 3000,
    max_drawdown: 2000,
    trailing: "eod",
    locks_at_start: true,
    consistency_rule: "mffu_50pct_sim_payout",
    overnight_ok: false,
    payout_split: 0.80,
    payout_split_tiers: null,
    ongoing_fee: 0,
    // deep-scan Architecture re-cert HIGH: mirror Python prop_compliance.py / firm_config.py
    // ($1,000 MFFU Builder DLL — SOFT pause). Was stale null after the 2026-07-02 Python data-fix
    // (9f9b555) landed without updating this mirror → the ts-python-firm-rules-version CI gate went RED.
    daily_loss_limit: 1000,
    min_payout_days: 2,
    min_trading_days: 1,
  },
} as const;

// ─── FIRM_RULES canonical snapshot (mirrors src/engine/firm_config.py) ────────
// M4 2026-06-23: aligned to src/engine/firm_config.py::FIRM_RULES exactly.
// MFFU = BUILDER plan per operator's 2026-06-23 choice (EOD trailing + 40 micros,
// $1K soft-pause DLL, news ALLOWED, 50% consistency at SIM-funded payout only).
// Any field added/removed/changed here MUST be mirrored to Python in the SAME
// commit; CI gate `npm run check:ts-python-firm-rules-version` enforces parity.
export const FIRM_RULES_TS = {
  topstep_50k: {
    account_size: 50000,
    monthly_fee: 49,
    activation_fee: 0,
    ongoing_monthly_fee: 0,
    profit_target: 3000,
    max_drawdown: 2000,
    max_contracts: 50, // 50 micros (10:1 mini ratio) at $50K
    trailing: "eod",
    payout_split: 0.90,
    min_payout_days: 5,
    min_trading_days: 5,
    consistency_rule: "topstep_50pct", // 50% best-day cap at Combine pass-request
    daily_loss_limit: 1000,
    overnight_ok: false,
    weekend_ok: false,
    platform_lockdown_date: "2026-01-12",
    required_platform: "topstepx",
    allows_vps: false,
    allows_vpn: false,
    allows_remote_desktop: false,
    multi_account_within_user_allowed: true,
    copy_trades_within_user_allowed: true,
  },
  mffu_50k: {
    account_size: 50000,
    monthly_fee: 77,
    activation_fee: 0,
    ongoing_monthly_fee: 0,
    profit_target: 3000,
    max_drawdown: 2000,
    // MFFU Builder: 4 minis / 40 micros (eval + sim funded). NOT 50.
    max_contracts: 40,
    trailing: "eod",
    starting_floor: 48000, // Builder eval starting floor ($50K − $2K)
    payout_split: 0.80, // Builder 80/20 (eval + sim + live)
    // Builder: 2 qualifying days/cycle; pays every 48h after buffer
    min_payout_days: 2,
    payout_buffer: 2100, // $2,100 buffer cleared before first payout
    min_payout: 500, // Builder min payout $500
    min_trading_days: 1, // Builder eval 1-day minimum
    // 50% at the SIM-FUNDED payout stage only; NONE eval, NONE live
    consistency_rule: "mffu_50pct_sim_payout",
    // deep-scan Architecture re-cert HIGH: mirror Python firm_config.py:162 (MFFU consistency has no
    // rolling window — enforced at payout stage only). Missing key was half of the CI-gate RED drift.
    consistency_window_days: null,
    // Builder $1,000 DLL — SOFT pause (account survives, not a breach)
    daily_loss_limit: 1000,
    overnight_ok: false,
    weekend_ok: false,
    // Builder: every 48h after buffer cleared (5 sim payouts → live)
    payout_cycle_days: 2,
  },
} as const;


// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Produce a canonical JSON string with sorted keys (no whitespace).
 * Mirrors Python json.dumps(obj, sort_keys=True, separators=(',', ':'))
 */
function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedKeyReplacer);
}

/**
 * JSON.stringify replacer that sorts object keys lexicographically.
 * Primitive values are returned unchanged.
 * Arrays preserve their order (consistent with Python json.dumps).
 */
function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Compute SHA-256 (16-char hex prefix) over arbitrary firm config dicts.
 * Mirrors Python firm_rules_version.compute_firm_rules_version_from_dicts().
 *
 * @param firmConfigs - dict equivalent to FIRM_CONFIGS from prop_compliance.py
 * @param firmRules   - dict equivalent to FIRM_RULES from firm_config.py
 * @returns 16-character lowercase hex string
 */
export function computeFirmRulesVersionFromDicts(
  firmConfigs: Record<string, unknown>,
  firmRules: Record<string, unknown>,
): string {
  const combined = { FIRM_CONFIGS: firmConfigs, FIRM_RULES: firmRules };
  const canonical = canonicalJson(combined);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * Compute the current production firm rules version using the canonical
 * FIRM_CONFIGS_TS + FIRM_RULES_TS snapshots embedded in this module.
 *
 * This is the value written to backtests.firm_rules_version at insert time.
 *
 * @returns 16-character lowercase hex string
 */
export function computeFirmRulesVersion(): string {
  return computeFirmRulesVersionFromDicts(
    FIRM_CONFIGS_TS as unknown as Record<string, unknown>,
    FIRM_RULES_TS as unknown as Record<string, unknown>,
  );
}
