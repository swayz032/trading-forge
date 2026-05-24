/**
 * Framework Overlay — Pass 21 / 2026-05-11
 *
 * Applies CLAUDE.md §4 operator framework defaults to every compiled strategy
 * BEFORE it lands in the `strategies` table. This is what makes a scout-extracted
 * idea "production-grade":
 *
 *   - The ENTRY signal (indicator + parameters) is preserved from the source
 *     (YouTube speaker, Reddit post, web article). That's the edge hypothesis
 *     we want to test.
 *
 *   - The RISK MANAGEMENT (stop, TP, time_stop, sizing) is REPLACED with the
 *     operator's empirically-validated framework. We don't backtest the
 *     speaker's risk rules — we backtest whether their entry signal has edge
 *     under our risk rules.
 *
 * Without this overlay:
 *   - Speakers omit time_stop → strategy carries overnight (violates RTH_ONLY)
 *   - Speakers omit Chandelier trail → exit_params has `multiplier:2` with no
 *     formula → backtester doesn't know what to trail by
 *   - Speakers say fixed-point stops ("10pt stop") → violates CLAUDE.md §13
 *   - GPT extracts `direction:"both"` with one entry_condition → backtest
 *     fires both directions on every signal → garbage P&L
 *
 * Side effects:
 *   - metadata.source is set from the route-provided source, not hardcoded
 *     "openclaw" from the Python compiler (which is wrong for graduated_bucket
 *     and any future source we add).
 */
import { logger } from "../index.js";

export type StrategySource = "ollama" | "openclaw" | "manual" | "graduated_bucket";

interface CompiledConfig {
  strategy?: {
    stop_loss?: { type?: string; multiplier?: number };
    position_size?: Record<string, unknown>;
    exit?: string;
    entry_long?: string;
    entry_short?: string;
    [key: string]: unknown;
  };
  metadata?: { source?: string; tags?: string[]; schema_version?: string };
  direction?: string;
  entry_type?: string;
  exit_type?: string;
  exit_params?: Record<string, unknown>;
  take_profit?: { type?: string; multiplier?: number; partial_at_r?: number };
  regime_gate?: Record<string, unknown>;
  session_filter?: Record<string, unknown>;
  time_stop?: { type: string; flat_at: string };
  /**
   * W23H.4 — Per-strategy operator override for confluence → size multiplier lookup.
   * When present in the compiled config, callers pass this map to
   * computeRiskDerivedContracts() as confluence_size_multiplier_map.
   * When absent (default), the canonical DEFAULT_CONFLUENCE_MULTIPLIER applies.
   * Keys are confluence factor counts (1-4); values are multipliers (≥ 1.0).
   */
  confluence_size_multiplier?: Record<number, number>;
  /**
   * W23H.3 — Per-strategy entry time windows.
   * When non-empty, entries are blocked outside ALL listed windows.
   * When absent or empty (default), no time restriction is applied (current behavior preserved).
   *
   * Format: "HH:MM-HH:MM TZ"  — e.g. ["09:45-12:00 ET", "13:30-15:30 ET"]
   * Supported TZ shorthands: ET, PT, CT, MT, UTC (plus any IANA name).
   * Boundary: [start, end) — left-inclusive, right-exclusive.
   *
   * Enforced at three layers:
   *   1. paper-signal-service.ts — signal-time gate (before Stage 1)
   *   2. backtester.py — window mask applied to entry_long/entry_short after generate_signals()
   *   3. pine_compiler.py — emits additional Pine time() conditions in _build_session_filter()
   *
   * Validated at config extraction time (parseEntryWindows throws on malformed spec).
   * DO NOT silently skip malformed specs — fail loudly at config time.
   */
  allowed_entry_windows?: string[];
  /**
   * Wave 25 Pass 7 — adaptive exit engine config.
   * Stamped by applyFrameworkOverlay; consumed by paper-signal-service.ts at signal time.
   * exit_style: "adaptive" | "static_styleC" (default "static_styleC" for backward-compat).
   */
  exit_plan_config?: Record<string, unknown> | null;
  [key: string]: unknown;
}

// CLAUDE.md §4 framework defaults — kept in this file (not a JSON import) so
// schema drift surfaces in code review rather than as a silent JSON edit.
//
// W23F.N (2026-05-19): Style D is DEAD. Wave 23 spec mandates Style C 33/33/33
// as the canonical default. Style C: TP1 33% @ +1.0R, TP2 33% @ +2.0R, runner
// 33% trails developing session POC (Chandelier fallback). Move stop to BE+1
// on TP1 fill. Hard flatten 15:55 ET. No `styleD` key here — if you find
// yourself adding one back, you're regressing Wave 23. Read CLAUDE.md §2b.
const FRAMEWORK = {
  // Style C canonical default — 33/33/33 scale-out with runner.
  styleC: {
    tp1_at_r: 1.0,
    tp1_size_pct: 0.33,
    tp2_at_r: 2.0,
    tp2_size_pct: 0.33,
    // Runner is the remaining 34% (1.00 - 0.33 - 0.33). Trails developing
    // session POC when available; Chandelier(14, 2.0) is the fallback for
    // markets without volume profile feed.
    runner_size_pct: 0.34,
    runner_trail_primary: "developing_session_poc",
    runner_trail_fallback: { type: "chandelier", atr_period: 14, multiplier: 2.0 },
    move_stop_to: "BE+1tick",
    // partial_at_r mirrors tp1_at_r so the current backtester (which honors
    // a single partial_at_r in exit_params) executes the first TP slice
    // correctly. Multi-partial engine support is a consumer-side track.
    partial_at_r: 1.0,
  },
  // Hard flatten 15:55 ET — every strategy with session_filter=RTH_ONLY needs this
  timeStop: { type: "hard_flatten", flat_at: "15:55 ET" },
  // Structural stop ceilings per CLAUDE.md §4
  stopCeilingPts: { MES: 14, MNQ: 40, MCL: 25 } as Record<string, number>,
  // ATR floor multiplier — stop_distance must be >= 1.5 * current_tf ATR
  stopFloorAtrMultiple: 1.5,
  // 67% personal DLL of firm DLL
  personalDllPct: 0.67,
  // Risk-derived pyramid: base + increment per +$threshold cumulative profit.
  // W23F.N (2026-05-19) — Wave 23 spec: base 6 MES / 6 MNQ / 18 MCL with +3
  // increments per +$3K cumulative profit. The Wave 23 spec resets the pyramid
  // floor to align with Style C 33/33/33 partials (base must be ≥ 6 so 33% slice
  // is at least 2 contracts; MCL bumps to 18 so $1/tick × 25 ticks × 18 ≈ $450
  // risk delivers meaningful $/day at Phase 1 targets).
  // DO NOT add max_contracts here — it is computed at signal-time from
  // account_balance + ATR + firm cap (see src/server/lib/risk-sizing.ts).
  // A static max_contracts baked at graduation time cannot honor real dollar risk.
  baseSize: { MES: 6, MNQ: 6, MCL: 18 } as Record<string, number>,
  sizingTier: { increment: 3, threshold: 3000 },
  // 2% max risk per trade. Applied to the risk base of each firm:
  //   MFFU: 2% of current balance
  //   Topstep: 2% of trailing-DD buffer (currentBalance - trailingFloor)
  // This is the same numeric rate for both firms. The base differs.
  maxRiskPctPerTrade: 0.02,
  // Liquidity comfort cap: never trade more than N contracts regardless of what
  // the risk math says (thin book / slippage protection). Per-symbol because
  // book depth varies dramatically:
  //   MES: 200-500 at touch → 100 is safe (3× headroom over Phase 2 ramp of 33)
  //   MNQ: 50-150 at touch → 50 prevents eating the entire book
  //   MCL: 20-80 at touch (mostly retail flow) → 30 prevents 1-2 tick slippage
  // W23F.N (2026-05-19) — per-symbol replaces single global cap.
  liquidityComfortCap: { MES: 100, MNQ: 50, MCL: 30 } as Record<string, number>,

  // W23H.4 (2026-05-20) — Confluence-weighted sizing canonical defaults.
  // 1 factor (primary only) → 1.0×; 2 factors (one confirming) → 1.0×;
  // 3 factors (true confluence) → 1.5×; 4+ factors (extreme A+ setup) → 2.0×.
  // Applied to pyramidTier + riskDerivedCap BEFORE min() against firmCap + liquidityCap.
  // Operator can override per-strategy by setting confluence_size_multiplier in the
  // compiled config — that map is forwarded to computeRiskDerivedContracts().
  // When per-strategy map is absent, DEFAULT_CONFLUENCE_MULTIPLIER from risk-sizing.ts applies.
  confluenceSizeMultiplier: { 1: 1.0, 2: 1.0, 3: 1.5, 4: 2.0 } as Record<number, number>,
};

interface OverlayInput {
  compiled: CompiledConfig;
  source: StrategySource;
  symbol: "MES" | "MNQ" | "MCL";
  bucketId?: string;
  /**
   * Wave 25 Pass 7 — exit engine selector.
   * "adaptive"      = liquidity-mapped TP + regime scaling + AVWAP runner (new default for new strategies).
   * "static_styleC" = Wave 23 33/33/34 + POC trail (backward-compat for pre-Wave-25 strategies).
   * When omitted: defaults to "static_styleC" to preserve backward-compat for all existing strategies.
   * Callers creating NEW strategies should pass "adaptive" to enroll in Wave 25 exits.
   */
  exitStyle?: "adaptive" | "static_styleC";
}

interface OverlayResult {
  config: CompiledConfig;
  warnings: string[];
  appliedRules: string[];
}

/**
 * Wave 25 Pass 7 — exit_style switch.
 *
 * "adaptive"      = Wave 25 liquidity-mapped TP + regime scaling + AVWAP runner.
 *                   Default for NEW strategies created after Wave 25 Pass 7.
 * "static_styleC" = Wave 23 33/33/34 + developing_session_poc trail.
 *                   Default for EXISTING pre-Wave-25 strategies (backward-compat).
 *
 * Resolution order (highest wins):
 *   1. compiled config already has exit_plan_config.exit_style  → respect it (idempotent)
 *   2. input.exitStyle parameter explicitly passed               → use it
 *   3. Fall through to "static_styleC" for safety (never change existing strategies)
 *
 * Callers that want "adaptive" for new strategies should pass exitStyle="adaptive".
 * The overlay will then stamp exit_plan_config.exit_style="adaptive" in the config.
 * paper-signal-service.ts reads exit_plan_config.exit_style to route the exit call.
 *
 * INVARIANTS (NEVER overridden by adaptive engine — CLAUDE.md §4 + §13):
 *   - 15:55 ET hard flatten remains in time_stop block (unchanged here)
 *   - 67% personal DLL preserved in position_size block (unchanged here)
 *   - Per-symbol liquidity caps preserved (unchanged here)
 */

/**
 * Apply CLAUDE.md §4 framework defaults to a compiled DSL.
 * Idempotent — re-running on already-overlaid config is a no-op.
 */
export function applyFrameworkOverlay(input: OverlayInput): OverlayResult {
  const cfg: CompiledConfig = JSON.parse(JSON.stringify(input.compiled));
  const warnings: string[] = [];
  const applied: string[] = [];

  cfg.metadata = cfg.metadata ?? {};
  if (cfg.metadata.source !== input.source) {
    cfg.metadata.source = input.source;
    applied.push("metadata.source <- route-provided source");
  }

  // W23F.N (2026-05-19): Style C is the canonical exit. Style D is DEAD per
  // Wave 23 spec. The overlay normalizes every exit to Style C 33/33/33 so
  // backtests measure EDGE on the entry signal, not the speaker's risk choices.
  // Engine still uses exit_type="trailing_stop" because that's the ExitType enum
  // value vectorbt routes on. The Style C semantic lives in exit_params.
  if (cfg.exit_type === "fixed_target") {
    cfg.exit_type = "trailing_stop";
    applied.push("exit_type: fixed_target → trailing_stop (Style C normalize)");
  }

  const styleCExitProse = `Style C 33/33/33: TP1 ${Math.round(FRAMEWORK.styleC.tp1_size_pct * 100)}% @ ${FRAMEWORK.styleC.tp1_at_r}R / TP2 ${Math.round(FRAMEWORK.styleC.tp2_size_pct * 100)}% @ ${FRAMEWORK.styleC.tp2_at_r}R / runner ${Math.round(FRAMEWORK.styleC.runner_size_pct * 100)}% trails ${FRAMEWORK.styleC.runner_trail_primary} (Chandelier fallback). BE+1tick stop on TP1 fill.`;

  if (cfg.exit_type === "trailing_stop" || (cfg.take_profit && !cfg.take_profit.partial_at_r)) {
    cfg.take_profit = {
      ...(cfg.take_profit ?? {}),
      partial_at_r: cfg.take_profit?.partial_at_r ?? FRAMEWORK.styleC.tp1_at_r,
    };
    applied.push(`style_c.tp1_at_r=${FRAMEWORK.styleC.tp1_at_r}`);
  }
  if (cfg.exit_type === "trailing_stop") {
    cfg.exit_params = {
      ...(cfg.exit_params ?? {}),
      // Style C 33/33/33 schedule — primary contract for graduator + future engine support
      style: "c",
      partials: [
        { at_r: FRAMEWORK.styleC.tp1_at_r, size_pct: FRAMEWORK.styleC.tp1_size_pct },
        { at_r: FRAMEWORK.styleC.tp2_at_r, size_pct: FRAMEWORK.styleC.tp2_size_pct },
      ],
      runner: {
        size_pct: FRAMEWORK.styleC.runner_size_pct,
        trail_primary: FRAMEWORK.styleC.runner_trail_primary,
        trail_fallback: FRAMEWORK.styleC.runner_trail_fallback,
      },
      // Backward-compat for current single-partial engine: TP1 honors partial_at_r,
      // remaining 67% goes to trail (engine treats as 50/50 with trail; multi-partial
      // engine support pending consumer agent's W23 track).
      partial_at_r: FRAMEWORK.styleC.tp1_at_r,
      move_stop_to: FRAMEWORK.styleC.move_stop_to,
      trail: FRAMEWORK.styleC.runner_trail_fallback,
    };
    if (cfg.strategy) {
      // Wave 15 (2026-05-18) — signals.py:148 evaluates `config.exit` as
      // parseable grammar (not prose). Style C exit logic lives in
      // exit_params; strategy.exit grammar evaluates to never-true sentinel.
      // Prose lives in `exit_prose` for human-readable audit/UI.
      cfg.strategy.exit = "high < low";
      cfg.strategy.exit_prose = styleCExitProse;
    }
    applied.push("style_c.scale_out_runner");
  }

  // Final safety net — if strategy.exit prose still has a template hole at this
  // point, replace with Style C description so the field never reaches the
  // backtester with "N/A" or "{{...}}" inside.
  if (cfg.strategy && typeof cfg.strategy.exit === "string" && /\bN\/?A\b|\{\{|<[A-Z_]+>/i.test(cfg.strategy.exit)) {
    cfg.strategy.exit = "high < low";
    cfg.strategy.exit_prose = styleCExitProse;
    applied.push("template_hole.refilled (Style C exit prose)");
  }

  if (!cfg.time_stop) {
    cfg.time_stop = FRAMEWORK.timeStop;
    applied.push("time_stop=15:55 ET hard flatten");
  }

  const stop = cfg.strategy?.stop_loss;
  if (stop && stop.type === "atr") {
    const mult = typeof stop.multiplier === "number" ? stop.multiplier : 1.5;
    if (mult < FRAMEWORK.stopFloorAtrMultiple) {
      if (cfg.strategy) cfg.strategy.stop_loss = { type: "atr", multiplier: FRAMEWORK.stopFloorAtrMultiple };
      applied.push(`stop_loss.multiplier raised to ${FRAMEWORK.stopFloorAtrMultiple} (framework floor)`);
    }
    if (mult > 5) {
      warnings.push(`stop_loss.multiplier ${mult} > 5; schema will reject. Capping at 5.`);
      if (cfg.strategy) cfg.strategy.stop_loss = { type: "atr", multiplier: 5 };
    }
  } else if (stop && stop.type !== "atr") {
    warnings.push(`stop_loss.type=${stop.type} is non-structural; CLAUDE.md §13 forbids fixed-point stops. Replacing with atr 1.5x.`);
    if (cfg.strategy) cfg.strategy.stop_loss = { type: "atr", multiplier: FRAMEWORK.stopFloorAtrMultiple };
    applied.push("stop_loss <- atr 1.5x (framework override)");
  }

  // Wave 10: position_size type is now "risk_derived_pyramid".
  // Wave 22: position_size block is FIRM-AGNOSTIC. The `firm_configs` sub-object
  //          carries per-firm parameters; the sizing engine picks the right branch
  //          based on the destination account's broker_accounts.firm_id.
  //          No firm-specific lock-in in the strategy row.
  //
  // DO NOT write max_contracts here — that is the Wave 10 bug fix.
  // max_contracts was a static number baked at graduation time that could
  // never honor real account balance or ATR. It is now computed at signal-time
  // by computeRiskDerivedContracts() in src/server/lib/risk-sizing.ts.
  //
  // Idempotency rules:
  //   - Already "risk_derived_pyramid" with firm_configs → no-op (all fields checked below)
  //   - Missing position_size → insert full risk_derived_pyramid shape
  //   - Old "profit_tier_pyramid" → transform to risk_derived_pyramid
  //     (preserve base_contracts, tier_increment, tier_threshold_dollars,
  //      personal_dll_pct; DROP max_contracts + target_risk_dollars)
  //   - Any other type → overwrite to risk_derived_pyramid
  //
  // firm_configs shape (Wave 22):
  //   firm_configs.topstep.max_risk_pct_per_trade — % of trailing-DD buffer to risk per trade
  //   firm_configs.mffu.max_risk_pct_per_trade    — % of current balance to risk per trade
  //   Tier-specific contract caps + trailing_dd live in firm_config.py — looked up at signal time
  //   from the destination account's tier. Never stored in the strategy row.
  if (cfg.strategy && (!cfg.strategy.position_size || typeof cfg.strategy.position_size !== "object")) {
    cfg.strategy.position_size = {
      type: "risk_derived_pyramid",
      base_contracts: FRAMEWORK.baseSize[input.symbol] ?? 1,
      tier_increment: FRAMEWORK.sizingTier.increment,
      tier_threshold_dollars: FRAMEWORK.sizingTier.threshold,
      personal_dll_pct: FRAMEWORK.personalDllPct,
      max_risk_pct_per_trade: FRAMEWORK.maxRiskPctPerTrade,
      liquidity_comfort_cap: FRAMEWORK.liquidityComfortCap[input.symbol] ?? FRAMEWORK.liquidityComfortCap.MES,
      topstep_account_cap_override: null,
      computed_at_signal_time: true,
      // Wave 22: per-firm parameters — strategy works on any firm; firm resolved at signal time
      firm_configs: {
        topstep: {
          max_risk_pct_per_trade: FRAMEWORK.maxRiskPctPerTrade, // % of trailing-DD buffer
        },
        mffu: {
          max_risk_pct_per_trade: FRAMEWORK.maxRiskPctPerTrade, // % of current balance
        },
      },
    };
    applied.push("position_size <- risk_derived_pyramid framework (firm-agnostic, Wave 22)");
  } else if (cfg.strategy?.position_size) {
    const ps = cfg.strategy.position_size as Record<string, unknown>;

    // Remove legacy max_contracts if present — this was the bug.
    // target_risk_dollars was a placeholder for the missing dollar-ATR conversion;
    // it is superseded by max_risk_pct_per_trade in the new shape.
    if ("max_contracts" in ps) {
      delete ps.max_contracts;
      applied.push("position_size.max_contracts REMOVED (Wave 10 bug fix — computed at signal time)");
    }
    if ("target_risk_dollars" in ps) {
      delete ps.target_risk_dollars;
      applied.push("position_size.target_risk_dollars REMOVED (superseded by max_risk_pct_per_trade)");
    }

    // Normalize type to risk_derived_pyramid regardless of prior value.
    if (ps.type !== "risk_derived_pyramid") {
      ps.type = "risk_derived_pyramid";
      applied.push("position_size.type → risk_derived_pyramid (framework override)");
    }

    if (ps.personal_dll_pct === undefined) {
      ps.personal_dll_pct = FRAMEWORK.personalDllPct;
      applied.push("position_size.personal_dll_pct=0.67");
    }

    // W23F.N (2026-05-19) — sizing is FRAMEWORK-AUTHORITATIVE per CLAUDE.md §2b.
    // Overlay REPLACES scout-extracted base/tier values; the framework spec wins.
    // Without this, an LLM that emits "max 4 MES contracts" from a source survives
    // graduation even though Wave 23 base for MES is 6. The overlay is the canonical
    // gate — operator's pyramid math is the source of truth, not the YouTuber's.
    const fbBase = FRAMEWORK.baseSize[input.symbol] ?? FRAMEWORK.baseSize.MES;
    if (ps.base_contracts !== fbBase) {
      const prev = ps.base_contracts;
      ps.base_contracts = fbBase;
      applied.push(`position_size.base_contracts=${fbBase} (was ${prev ?? "undef"})`);
    }
    if (ps.tier_increment !== FRAMEWORK.sizingTier.increment) {
      const prev = ps.tier_increment;
      ps.tier_increment = FRAMEWORK.sizingTier.increment;
      applied.push(`position_size.tier_increment=${FRAMEWORK.sizingTier.increment} (was ${prev ?? "undef"})`);
    }
    if (ps.tier_threshold_dollars !== FRAMEWORK.sizingTier.threshold) {
      ps.tier_threshold_dollars = FRAMEWORK.sizingTier.threshold;
    }
    if (ps.max_risk_pct_per_trade === undefined) {
      ps.max_risk_pct_per_trade = FRAMEWORK.maxRiskPctPerTrade;
      applied.push(`position_size.max_risk_pct_per_trade=${FRAMEWORK.maxRiskPctPerTrade}`);
    }
    // W23F.N — per-symbol liquidity cap; override LLM value if it differs from canonical
    const targetLiquidityCap = FRAMEWORK.liquidityComfortCap[input.symbol] ?? FRAMEWORK.liquidityComfortCap.MES;
    if (ps.liquidity_comfort_cap !== targetLiquidityCap) {
      const prev = ps.liquidity_comfort_cap;
      ps.liquidity_comfort_cap = targetLiquidityCap;
      applied.push(`position_size.liquidity_comfort_cap=${targetLiquidityCap} (was ${prev ?? "undef"})`);
    }
    if (!("topstep_account_cap_override" in ps)) {
      ps.topstep_account_cap_override = null;
    }
    if (ps.computed_at_signal_time === undefined) {
      ps.computed_at_signal_time = true;
    }
    // Wave 22: ensure firm_configs is present in all overlaid strategy rows.
    // Idempotent: no-op if firm_configs already present with correct shape.
    if (!ps.firm_configs || typeof ps.firm_configs !== "object") {
      ps.firm_configs = {
        topstep: { max_risk_pct_per_trade: FRAMEWORK.maxRiskPctPerTrade },
        mffu:    { max_risk_pct_per_trade: FRAMEWORK.maxRiskPctPerTrade },
      };
      applied.push("position_size.firm_configs <- firm-agnostic block (Wave 22)");
    }
  }

  if (cfg.direction === "both" && cfg.strategy) {
    const el = String(cfg.strategy.entry_long ?? "").trim();
    const es = String(cfg.strategy.entry_short ?? "").trim();
    // W23H-postmortem (2026-05-20): Archetype strategies (ICT silver bullet,
    // CRT, power of 3, FVG, order_block, liquidity_sweep, etc.) use the
    // intentional sentinel "high < low" for BOTH entry_long and entry_short
    // because the strategy is handler-driven, not grammar-driven (see CLAUDE.md
    // §2b pinned facts). The structural-detector handler emits the actual long
    // AND short signals at runtime. Duplicate-sentinel must NOT be treated as
    // "duplicate L/S text" — that downgrade would mask real bidirectional
    // archetype strategies as long-only.
    const isArchetypeSentinel = (el === "high < low" && es === "high < low");
    const entryIndicatorIsArchetype = typeof cfg.entry_indicator === "string" &&
      cfg.entry_indicator.startsWith("archetype:");
    if (el && es && el === es && !isArchetypeSentinel && !entryIndicatorIsArchetype) {
      warnings.push("entry_long === entry_short with direction='both' — backtester ambiguity. Defaulting to direction='long' with original entry_condition. Manually flip to 'short' or split entry texts to fire both sides.");
      cfg.direction = "long";
      if (cfg.strategy) cfg.strategy.entry_short = "";
      applied.push("direction='both' with duplicate L/S text → coerced to 'long'");
    } else if (isArchetypeSentinel || entryIndicatorIsArchetype) {
      // Explicitly note we preserved bidirectional for archetype path
      applied.push("direction='both' preserved (archetype handler emits L/S signals — sentinel 'high < low' is by design)");
    }
  }

  const exitStr = cfg.strategy?.exit;
  if (typeof exitStr === "string" && /\bN\/?A\b/i.test(exitStr)) {
    warnings.push(`strategy.exit contains 'N/A' template hole — overlay refilled. Original: "${exitStr}"`);
  }

  // ─ Wave 25 Pass 7: exit_plan_config stamp ──────────────────────────────────
  // Stamps exit_plan_config.exit_style on the compiled config so paper-signal-service
  // can route to the correct exit engine at signal time.
  //
  // Resolution order:
  //   1. Compiled config already has exit_plan_config.exit_style → respect it (idempotent)
  //   2. input.exitStyle passed by caller → use it
  //   3. Default to "static_styleC" (backward-compat for all pre-Wave-25 strategies)
  //
  // NEVER changes an existing "adaptive" config back to "static_styleC" or vice versa
  // without explicit caller intent — idempotency is critical for graduated strategies.
  {
    const existingExitStyle = (cfg.exit_plan_config as { exit_style?: string } | null | undefined)?.exit_style;
    if (!existingExitStyle) {
      // No prior stamp — apply caller preference or default.
      const targetStyle = input.exitStyle ?? "static_styleC";
      cfg.exit_plan_config = {
        ...(cfg.exit_plan_config as Record<string, unknown> ?? {}),
        exit_style: targetStyle,
      } as CompiledConfig["exit_plan_config"];
      applied.push(`exit_plan_config.exit_style=${targetStyle} (Wave 25 Pass 7 stamp)`);
    }
    // else: already stamped → idempotent no-op
  }

  logger.info(
    { strategyName: cfg.strategy?.name ?? "unknown", source: input.source, symbol: input.symbol, appliedRules: applied, warnings },
    "framework-overlay applied",
  );

  return { config: cfg, warnings, appliedRules: applied };
}

export const __frameworkDefaults = FRAMEWORK;
