/**
 * Pass 21 (2026-05-16) — DSL quality audit for the 28 active strategies.
 *
 * For each, check:
 *   1. entry_indicator matches engine pattern_library
 *   2. entry_long has real trading rules (not just placeholder boilerplate)
 *   3. entry_params populated with indicator-correct keys
 *   4. Would the strategy survive the NEW scout-auditor v2 patterns?
 *   5. Would the strategy survive the NEW deriveEntryIndicator() reject path?
 *
 * Output: each strategy categorized as
 *   SOLID  — real rules + correct indicator + populated params
 *   THIN   — placeholder rules but engine-compatible indicator (retrofitable)
 *   WRONG  — wrong indicator assigned (e.g. supertrend → ema_crossover)
 *   JUNK   — would be rejected by new pipeline (auditor v2 or no-engine-indicator)
 *
 * Reports counts + per-strategy verdict + recommended actions.
 */
require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Mirror of dsl-sanitizer.ts ENTRY_PATTERN_ALLOWLIST
const VALID_INDICATORS = new Set([
  "sma_crossover", "ema_crossover", "rsi_reversal", "bollinger_breakout",
  "atr_breakout", "vwap_reversion", "donchian_breakout", "keltner_squeeze",
  "session_open_breakout", "macd_crossover", "vwap_fade", "event_driven_fade",
  "overnight_drift",
]);

const REQUIRED_PARAMS = {
  sma_crossover: ["fast_period", "slow_period"],
  ema_crossover: ["fast_period", "slow_period"],
  rsi_reversal: ["period", "oversold", "overbought"],
  bollinger_breakout: ["period", "std_dev"],
  atr_breakout: ["period", "multiplier"],
  vwap_reversion: ["deviation_threshold"],
  donchian_breakout: ["period"],
  keltner_squeeze: ["bb_period", "kc_period", "kc_multiplier"],
  session_open_breakout: ["range_minutes"],
  macd_crossover: ["fast_period", "slow_period", "signal_period"],
  vwap_fade: ["atr_extension_threshold"],
  event_driven_fade: ["atr_move_threshold", "event_window_minutes"],
  overnight_drift: ["drift_atr_threshold", "asia_lookback_bars"],
};

// Concepts the engine doesn't support — should reject under new pipeline
const ENGINE_REJECT_PATTERNS = [
  /supertrend/i,
  /(^|_)ict(_|$)|smc|choch|smart.money|order.block/i,
  /(^|_)fvg(_|$)|fair.value.gap|ifvg/i,
  /liquidity.sweep|liquidity.void/i,
  /volume.profile|market.profile|(^|_)poc(_|$)|(^|_)vah(_|$)|(^|_)val(_|$)/i,
  /pivot.point|floor.pivot|camarilla/i,
  /wyckoff|accumulation.distribution/i,
  /order.flow|footprint|bookmap|tape.reading/i,
];

// Scout-auditor v2 reject patterns
const AUDITOR_REJECT_PATTERNS = [
  /why.dont|why.don.t|why.doesn.t/i,                  // discussion threads
  /is.making.*realistic|is.*profitable\?/i,
  /anyone.else|who.else.uses/i,
  /(^|_)inventories(_|$)|crude.oil.inventories|jobless.claims/i,  // events
  /(^|_)secrets(_|$)|dangerous.traps|millionaires/i,  // click-bait
  /(^|_)explained.types.indicator/i,
  /(^|_)meaning.atas/i,
  /r.daytrading.on.reddit|r.futurestrading.on.reddit/i,
];

function isPlaceholderEntryRule(text) {
  if (!text || text.length < 30) return true;
  const t = text.toLowerCase();
  // Placeholder patterns from current graduator output
  if (/^reddit relevance match for/i.test(text)) return true;
  if (/^web.layer cross.validation:/i.test(text)) return true;
  if (/entry on .* signal per .* setup; framework overlay applies risk/i.test(text)) return true;
  // Real rules typically mention: trigger / cross / break / close / rsi / ema / volume / above / below
  const realRuleSignals = /(close[s]?\s+(above|below)|cross(es|ed)?\s+(above|below)|break[s]?\s+(above|below)|rsi\s*[<>]|ema\(|sma\(|enter\s+(long|short)\s+when|trigger\s+when)/i;
  if (!realRuleSignals.test(text)) return true;
  return false;
}

(async () => {
  try {
    const rows = await sql`
      SELECT id, name, config, created_at, tags
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
      ORDER BY name ASC
    `;
    console.log(`Auditing ${rows.length} active graduated strategies for DSL quality\n`);

    const verdicts = { SOLID: [], THIN: [], WRONG: [], JUNK: [] };

    for (const r of rows) {
      const c = r.config || {};
      const strat = c.strategy || {};
      const indicator = (strat.indicators && strat.indicators[0]?.type) || strat.entry_indicator || null;
      const tf = strat.timeframe || c.timeframe || "?";
      const dir = c.direction || "long";
      const entryLong = strat.entry_long || "";
      const params = c.entry_params || {};
      const paramKeys = Object.keys(params);

      const issues = [];
      let verdict = "SOLID";

      // Check 1: indicator engine-compatible?
      if (!indicator || !VALID_INDICATORS.has(indicator)) {
        issues.push(`indicator '${indicator}' not in engine allowlist`);
        verdict = "WRONG";
      }

      // Check 2: would NEW deriveEntryIndicator reject this concept?
      if (ENGINE_REJECT_PATTERNS.some((p) => p.test(r.name))) {
        issues.push("concept matches engine-reject pattern (Supertrend/ICT/FVG/Volume Profile/Pivot)");
        verdict = "JUNK";
      }

      // Check 3: would scout-auditor v2 reject the source title?
      if (AUDITOR_REJECT_PATTERNS.some((p) => p.test(r.name))) {
        issues.push("concept matches scout-auditor v2 reject pattern (discussion/event/click-bait)");
        verdict = "JUNK";
      }

      // Check 4: entry_long placeholder vs real rules
      const isPlaceholder = isPlaceholderEntryRule(entryLong);
      if (isPlaceholder) issues.push("entry_long is placeholder, no real trading rule prose");

      // Check 5: entry_params populated with required keys
      const required = REQUIRED_PARAMS[indicator] || [];
      const missing = required.filter((k) => !(k in params));
      if (missing.length > 0) issues.push(`entry_params missing required: [${missing.join(", ")}]`);

      // Final verdict logic (precedence):
      if (verdict === "JUNK") {
        // already set
      } else if (verdict === "WRONG") {
        // already set
      } else if (isPlaceholder || missing.length > 0) {
        verdict = "THIN";
      } else {
        verdict = "SOLID";
      }

      verdicts[verdict].push({ id: r.id, name: r.name, indicator, tf, params: JSON.stringify(params), issues });
    }

    console.log("══════════════════════════════════════════════════════");
    console.log("VERDICT SUMMARY");
    console.log("══════════════════════════════════════════════════════");
    console.log(`  SOLID (production-ready):  ${verdicts.SOLID.length}`);
    console.log(`  THIN (retrofitable):       ${verdicts.THIN.length}`);
    console.log(`  WRONG (bad indicator):     ${verdicts.WRONG.length}`);
    console.log(`  JUNK (archive recommend):  ${verdicts.JUNK.length}`);

    for (const [v, list] of Object.entries(verdicts)) {
      if (list.length === 0) continue;
      console.log(`\n── ${v} ──`);
      for (const s of list) {
        console.log(`  ${s.name}`);
        console.log(`     indicator=${s.indicator}  tf=${s.tf}  params=${s.params}`);
        for (const i of s.issues) console.log(`     • ${i}`);
      }
    }
  } finally {
    await sql.end();
  }
})();
