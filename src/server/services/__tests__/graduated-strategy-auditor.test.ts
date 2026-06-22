/**
 * Auditor regression tests (Pass 21, 2026-05-12).
 *
 * Fixture-based: known-good DSL → 0 defects. Known-bad DSL with one specific
 * fault per fixture → exactly the matching defect code.
 *
 * Why: the first version of the deep-scan script that became this auditor had
 * a JSON-path bug (read `config.strategy.time_stop` instead of
 * `config.time_stop`) that produced 96 fake defects on a clean library. These
 * tests lock the correct paths in place — any future refactor that breaks
 * the path will fail loudly here BEFORE shipping.
 */
import { describe, it, expect } from "vitest";
import { auditGraduatedConfig } from "../graduated-strategy-auditor.js";

const GOOD_CONFIG = {
  metadata: { source: "graduated_bucket", tags: [], schema_version: "v1" },
  direction: "long",
  exit_type: "trailing_stop",
  entry_type: "trend_follow",
  entry_params: { ema_fast: 9, ema_slow: 21 },
  time_stop: { type: "hard_flatten", flat_at: "15:55 ET" },
  regime_gate: { enabled: true, preferred_regime: "TRENDING_UP" },
  session_filter: { enabled: true, session: "RTH_ONLY" },
  exit_params: { partial_at_r: 1, move_stop_to: "BE+1tick", trail: { type: "chandelier", atr_period: 14, multiplier: 2 } },
  take_profit: {},
  description: "Trend-follow on 9/21 EMA pullback",
  strategy: {
    name: "mes_ema921_pullback_5m",
    symbol: "MES",
    timeframe: "5m",
    entry_long: "Long when 9 EMA crosses above 21 EMA after pullback",
    entry_short: "",
    exit: "Style D trailing",
    indicators: [{ type: "ema_crossover", fast: 9, slow: 21 }],
    stop_loss: { type: "atr", multiplier: 2 },
    position_size: {
      type: "profit_tier_pyramid",
      base_contracts: 4,
      max_contracts: 30,
      tier_increment: 2,
      tier_threshold_dollars: 3000,
      personal_dll_pct: 0.67,
      target_risk_dollars: 500,
    },
  },
} as const;

describe("graduated-strategy-auditor", () => {
  it("PASS: known-good production-grade config has 0 defects", () => {
    const r = auditGraduatedConfig({ conceptName: "mes_ema921_pullback_5m", symbol: "MES", config: GOOD_CONFIG });
    expect(r.passed).toBe(true);
    expect(r.defects).toEqual([]);
  });

  it("B3: detects fixed-point stop_loss", () => {
    const bad = { ...GOOD_CONFIG, strategy: { ...GOOD_CONFIG.strategy, stop_loss: { type: "points", value: 10 } } };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "B3_FIXED_POINT_STOP")).toBe(true);
  });

  it("B4: detects missing time_stop at TOP-LEVEL (NOT under config.strategy)", () => {
    // PATH-BUG REGRESSION GUARD — auditor must look at config.time_stop, not config.strategy.time_stop
    const bad = { ...GOOD_CONFIG, time_stop: {} };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "B4_TIME_STOP_MISSING")).toBe(true);
  });

  it("B4: path-bug guard — config.strategy.time_stop is IGNORED (top-level is canonical)", () => {
    // Place a valid time_stop INSIDE strategy.* (wrong path) and leave top-level missing.
    // Auditor must still fail because it should ONLY read the top-level path.
    const bad = {
      ...GOOD_CONFIG,
      time_stop: undefined,
      strategy: { ...GOOD_CONFIG.strategy, time_stop: { type: "hard_flatten", flat_at: "15:55 ET" } },
    };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "B4_TIME_STOP_MISSING")).toBe(true);
  });

  it("E1: detects regime_gate disabled", () => {
    const bad = { ...GOOD_CONFIG, regime_gate: { enabled: false } };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "E1_REGIME_GATE_DISABLED")).toBe(true);
  });

  it("E1: W23F live-fix — config.strategy.regime_gate is now READ (archetype graduation path)", () => {
    const cfg = {
      ...GOOD_CONFIG,
      regime_gate: undefined,
      strategy: { ...GOOD_CONFIG.strategy, regime_gate: { enabled: true } },
    };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: cfg });
    expect(r.defects.some((d) => d.code === "E1_REGIME_GATE_DISABLED")).toBe(false);
  });

  it("POSITION_SIZE_TYPE_WRONG: detects dynamic_atr instead of profit_tier_pyramid", () => {
    const bad = { ...GOOD_CONFIG, strategy: { ...GOOD_CONFIG.strategy, position_size: { type: "dynamic_atr" } } };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "POSITION_SIZE_TYPE_WRONG")).toBe(true);
  });

  it("B6: detects MES cap > 100 contracts", () => {
    const bad = {
      ...GOOD_CONFIG,
      strategy: { ...GOOD_CONFIG.strategy, position_size: { ...GOOD_CONFIG.strategy.position_size, max_contracts: 101 } },
    };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "B6_MES_CAP_EXCEEDED")).toBe(true);
  });

  it("B7: rejects mini symbol without contract_class flag", () => {
    const bad = { ...GOOD_CONFIG };
    const r = auditGraduatedConfig({ conceptName: "es_pullback", symbol: "ES", config: bad });
    expect(r.defects.some((d) => d.code === "B7_MINI_WITHOUT_FLAG")).toBe(true);
  });

  it("B7: accepts mini symbol with contract_class='mini'", () => {
    const ok = { ...GOOD_CONFIG, metadata: { ...GOOD_CONFIG.metadata, contract_class: "mini" } };
    const r = auditGraduatedConfig({ conceptName: "es_pullback", symbol: "ES", config: ok });
    expect(r.defects.some((d) => d.code === "B7_MINI_WITHOUT_FLAG")).toBe(false);
  });

  it("D3: detects entry_type='unknown'", () => {
    const bad = { ...GOOD_CONFIG, entry_type: "unknown" };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: bad });
    expect(r.defects.some((d) => d.code === "D3_UNKNOWN_ENTRY_TYPE")).toBe(true);
  });

  it("D1: detects generic 'futures_strategy' name", () => {
    const r = auditGraduatedConfig({ conceptName: "futures_strategy", symbol: "MES", config: GOOD_CONFIG });
    expect(r.defects.some((d) => d.code === "D1_GENERIC_NAME")).toBe(true);
  });

  it("C1: flags duplicate fingerprint when caller passes one", () => {
    const r = auditGraduatedConfig({
      conceptName: "x",
      symbol: "MES",
      config: GOOD_CONFIG,
      duplicateFingerprintOf: "abc-123",
    });
    expect(r.defects.some((d) => d.code === "C1_DUPLICATE_FINGERPRINT")).toBe(true);
  });

  it("B5: warns on personal_dll_pct drift", () => {
    const drift = {
      ...GOOD_CONFIG,
      strategy: { ...GOOD_CONFIG.strategy, position_size: { ...GOOD_CONFIG.strategy.position_size, personal_dll_pct: 0.95 } },
    };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: drift });
    expect(r.warnings.some((w) => w.code === "B5_PERSONAL_DLL_DRIFT")).toBe(true);
    expect(r.passed).toBe(true); // warning only, no defect
  });

  it("B2: warns on stop multiplier < 1.5", () => {
    const drift = {
      ...GOOD_CONFIG,
      strategy: { ...GOOD_CONFIG.strategy, stop_loss: { type: "atr", multiplier: 1.0 } },
    };
    const r = auditGraduatedConfig({ conceptName: "x", symbol: "MES", config: drift });
    expect(r.warnings.some((w) => w.code === "B2_STOP_MULTIPLIER_LOW")).toBe(true);
  });
});
