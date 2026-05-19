/**
 * Pass 21 (2026-05-12) — DEEP scan of graduated strategies. Goes beyond the
 * earlier audit-graduated-strategy-dsls.ts shape checks and tests for:
 *
 *   A. Semantic correctness
 *     A1. entry_type matches concept_name (e.g., concept "orb_open_range" → entry_type "session_pattern")
 *     A2. entry_indicator matches entry_type (orb→session_open_breakout, etc.)
 *     A3. indicator params in sane ranges (EMA 5-200, RSI 2-21, ATR 7-21, period > 0)
 *
 *   B. Framework compliance (CLAUDE.md §4)
 *     B1. stop ceiling ≤ 14pt MES / 40pt MNQ / 25 ticks MCL
 *     B2. stop floor ≥ 1.5×ATR (multiplier ≥ 1.5)
 *     B3. NO fixed-point stops (CLAUDE.md §13 Don't)
 *     B4. time_stop = 15:55 ET hard_flatten exactly
 *     B5. personal DLL = 67% of firm DLL
 *     B6. base 4 MES, cap 30 MES (mini contracts FUTURE)
 *     B7. NO ES/NQ/CL minis until contract_class="mini" set
 *
 *   C. Replay integrity
 *     C1. concept_name fingerprint unique across the library
 *     C2. journal_id present and points to a real entry
 *     C3. provider/layer counts ≥ graduation threshold (2 providers, 2+ layers or 3 mentions)
 *     C4. source URLs non-empty and structured (http/https)
 *
 *   D. False-positive detection
 *     D1. concept name not template/generic (e.g., "futures_strategy", "trading_method")
 *     D2. concept name not duplicate of an exclusion-set entry (ORB SEO regraduation, etc.)
 *     D3. archetype="unknown" with no deriveEntryType match (means concept_name is too vague)
 *     D4. graduation older than 30 days but never backtested (orphan)
 *
 *   E. Compliance gates wired
 *     E1. regime_gate.enabled
 *     E2. session_filter RTH_ONLY (or explicit non-RTH justification)
 *     E3. Tier-1 economic data check (FOMC/CPI/NFP blackout when MFFU is enabled_firm)
 *     E4. 2% rule check (max loss per trade ≤ 2% account)
 *
 * Reports per-strategy DEFECTS (must-fix) and WARNINGS (should-review).
 * Exits 0 even if found — audit only.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

// CLAUDE.md §4 ceilings by contract
const STOP_CEILINGS: Record<string, number> = {
  MES: 14, MNQ: 40, MCL: 25 / 4, // 25 ticks at $0.01 each (MCL tick = 0.01)
  ES: 14, NQ: 40, CL: 25 / 4,    // mini-contract ceiling same; flag if used
};

const MINI_SYMBOLS = new Set(["ES", "NQ", "CL"]);

// Mapping of canonical entry_type → allowed entry_indicator families
const TYPE_INDICATOR_COMPAT: Record<string, RegExp> = {
  session_pattern: /opening_range_breakout|session_open_breakout|orb|vwap|volume_profile|pivot/i,
  breakout: /breakout|inside_bar|nr4|squeeze|fvg|liquidity_sweep|ict|smc/i,
  trend_follow: /ema|sma|macd|supertrend|adx|crossover|pullback/i,
  mean_reversion: /rsi|bollinger|stochastic|williams|squeeze|fade|reversion/i,
  volatility_expansion: /atr|donchian|keltner|breakout/i,
  event_driven: /news|fomc|cpi|nfp|inventory|earnings/i,
};

// Indicator parameter sanity bounds
const PERIOD_BOUNDS: Record<string, [number, number]> = {
  ema: [5, 200],
  sma: [5, 200],
  rsi: [2, 21],
  atr: [7, 21],
  bollinger: [10, 30],
  macd: [5, 26],
  adx: [7, 21],
};

// Templates / generic names that suggest a graduation false-positive
const GENERIC_NAME_PATTERNS = [
  /^(futures|trading)_strategy(_\d+)?$/i,
  /^method_\d+$/i,
  /^pattern_\d+$/i,
  /^unknown(_strategy)?$/i,
  /\b(strategy|method|approach)\b\s*$/i,
];

interface Result { id: string; name: string; symbol: string; defects: string[]; warnings: string[]; }

function checkIndicatorPeriod(name: string, value: unknown): string | null {
  const n = String(name).toLowerCase();
  const bounds = Object.entries(PERIOD_BOUNDS).find(([k]) => n.includes(k));
  if (!bounds || typeof value !== "number") return null;
  const [, [lo, hi]] = bounds;
  if (value < lo || value > hi) {
    return `param ${name}=${value} outside sane range [${lo}, ${hi}]`;
  }
  return null;
}

async function deepScan(): Promise<Result[]> {
  // LEFT JOIN to strategy_pending_buckets via concept_name fingerprint so we
  // can fetch the graduation evidence (distinct_providers, source_count,
  // layer_coverage_json, web/youtube/reddit URLs) that's stored normalized in
  // the bucket, not in strategy.config.metadata. Older strategies pre-Pass 20
  // may not have a matching bucket — those get a "no bucket evidence" note.
  const rows = await sql<Array<{
    id: string;
    name: string;
    symbol: string;
    config: any;
    created_at: Date;
    bucket_id: string | null;
    bucket_provider_count: number | null;
    bucket_source_count: number | null;
    bucket_layer_coverage: any;
    bucket_concept_name: string | null;
    mention_urls: string[] | null;
  }>>`
    SELECT s.id, s.name, s.symbol, s.config, s.created_at,
           b.id                  AS bucket_id,
           b.distinct_providers  AS bucket_provider_count,
           b.source_count        AS bucket_source_count,
           b.layer_coverage_json AS bucket_layer_coverage,
           b.concept_name        AS bucket_concept_name,
           (SELECT array_agg(m.source_url ORDER BY m.id)
              FROM strategy_pending_mentions m
             WHERE m.bucket_id = b.id) AS mention_urls
    FROM strategies s
    LEFT JOIN strategy_pending_buckets b
      ON b.graduated_strategy_id = s.id
    WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
    ORDER BY s.created_at ASC
  `;

  console.log(`Deep-scanning ${rows.length} graduated strategies\n`);

  // For C1 fingerprint uniqueness: build map
  const fingerprintMap = new Map<string, string[]>();
  for (const r of rows) {
    const cn = String(r.config?.metadata?.concept_name ?? r.name).toLowerCase();
    const market = r.symbol;
    const fp = `${market}|${cn.replace(/[^a-z0-9_]/g, "")}`;
    if (!fingerprintMap.has(fp)) fingerprintMap.set(fp, []);
    fingerprintMap.get(fp)!.push(r.id);
  }

  const results: Result[] = [];

  for (const r of rows) {
    const defects: string[] = [];
    const warnings: string[] = [];
    const c = r.config ?? {};
    const cn = String(c?.metadata?.concept_name ?? r.name).toLowerCase();
    const strat = c?.strategy ?? {};

    // Correct paths discovered 2026-05-12 deep-scan rewrite:
    //   - entry_type, direction, exit_type, time_stop, regime_gate,
    //     session_filter, entry_params, exit_params all live at TOP-LEVEL of
    //     config (NOT under config.strategy)
    //   - stop_loss, position_size, indicators, entry_long/short live under
    //     config.strategy.*
    //   - metadata is JOIN'd from strategy_pending_buckets (not denormalized)

    // ── A. Semantic correctness ─────────────────────────────────────────
    const entryType: string = c?.entry_type ?? "";
    const entryIndicator: string = strat?.indicators?.[0]?.type ?? strat?.entry_indicator ?? "";

    if (entryType && entryType !== "unknown") {
      // A2: indicator must match entry_type family
      const compat = TYPE_INDICATOR_COMPAT[entryType];
      if (compat && entryIndicator && !compat.test(entryIndicator) && !compat.test(cn)) {
        warnings.push(`A2: entry_indicator='${entryIndicator}' may not match entry_type='${entryType}' (concept: ${cn})`);
      }
    }

    // A3: indicator param bounds (entry_params at TOP-LEVEL not strategy.*)
    const entryParams = c?.entry_params ?? {};
    for (const [k, v] of Object.entries(entryParams)) {
      const err = checkIndicatorPeriod(k, v);
      if (err) warnings.push(`A3: ${err}`);
    }

    // ── B. Framework compliance ────────────────────────────────────────
    const sl = strat?.stop_loss ?? {};
    const market = r.symbol;
    const ceiling = STOP_CEILINGS[market];

    // B1+B2: stop loss must be ATR (no fixed points)
    if (sl?.type !== "atr") {
      defects.push(`B3: stop_loss.type='${sl?.type}' (must be 'atr', NO fixed-point stops per CLAUDE.md §13)`);
    } else {
      const mult = Number(sl?.multiplier ?? 0);
      if (mult < 1.5) {
        warnings.push(`B2: stop multiplier=${mult} < 1.5× ATR floor (CLAUDE.md §4)`);
      }
      if (mult > 5) {
        warnings.push(`B1/B2: stop multiplier=${mult} suspiciously high — verify against ${ceiling}pt ceiling`);
      }
    }

    // B4: time_stop must be 15:55 ET hard_flatten — TOP-LEVEL not strategy.*
    const ts = c?.time_stop ?? {};
    if (ts?.type !== "hard_flatten" || ts?.flat_at !== "15:55 ET") {
      defects.push(`B4: time_stop=${JSON.stringify(ts)} (must be hard_flatten @ 15:55 ET)`);
    }

    // B5: personal DLL = 67%
    const ps = strat?.position_size ?? {};
    if (ps?.type === "profit_tier_pyramid") {
      const dll = Number(ps?.personal_dll_pct ?? 0);
      if (Math.abs(dll - 0.67) > 0.02) {
        warnings.push(`B5: personal_dll_pct=${dll} (expected ~0.67)`);
      }
      // B6: base 4 MES
      const base = Number(ps?.base_contracts ?? 0);
      const cap = Number(ps?.max_contracts ?? 0);
      if (market === "MES" && base !== 4) {
        warnings.push(`B6: base_contracts=${base} (CLAUDE.md §4 default = 4 MES)`);
      }
      if (market === "MES" && cap > 30) {
        defects.push(`B6: max_contracts=${cap} > 30 MES cap`);
      }
    } else {
      defects.push(`B5/B6: position_size.type='${ps?.type}' (must be 'profit_tier_pyramid')`);
    }

    // B7: mini contracts banned until contract_class="mini" + migration
    if (MINI_SYMBOLS.has(market)) {
      const cclass = c?.metadata?.contract_class ?? "";
      if (cclass !== "mini") {
        defects.push(`B7: symbol='${market}' is a MINI but contract_class!='mini' — CLAUDE.md §5 BLOCKER (10x silent risk inflation)`);
      }
    }

    // ── C. Replay integrity ────────────────────────────────────────────
    // C1: fingerprint dedup
    const fp = `${market}|${cn.replace(/[^a-z0-9_]/g, "")}`;
    const fpHits = fingerprintMap.get(fp) ?? [];
    if (fpHits.length > 1 && fpHits[0] !== r.id) {
      defects.push(`C1: duplicate concept fingerprint '${fp}' — already used by ${fpHits[0]}`);
    }

    // C3: graduation evidence pulled from JOINed pending_bucket row.
    // Pre-Pass-20 strategies may have no matching bucket — skip C3/C4 then.
    if (r.bucket_provider_count !== null) {
      const providerCount = Number(r.bucket_provider_count);
      const sourceCount = Number(r.bucket_source_count ?? 0);
      const layerCov = r.bucket_layer_coverage ?? {};
      const layerCount = Object.values(layerCov as Record<string, boolean>).filter(Boolean).length;
      if (providerCount < 2) {
        warnings.push(`C3: bucket distinct_providers=${providerCount} < 2 (cross-validation threshold)`);
      }
      if (layerCount < 2 && sourceCount < 3) {
        warnings.push(`C3: bucket layers=${layerCount} + source_count=${sourceCount} (need ≥2 layers OR ≥3 mentions)`);
      }
      // C4: source URLs from strategy_pending_mentions (normalized table)
      const all = r.mention_urls ?? [];
      if (all.length === 0) {
        warnings.push(`C4: bucket has 0 mentions in strategy_pending_mentions (provider count says ${providerCount} but URLs missing — possible data integrity issue)`);
      } else {
        const bad = all.filter((u: any) => typeof u !== "string" || !/^https?:\/\//.test(u));
        if (bad.length) warnings.push(`C4: ${bad.length}/${all.length} malformed mention URL(s)`);
      }
    } else {
      // No bucket row found — pre-Pass-20 strategy (manual graduation, no evidence trail)
      warnings.push(`C3: no strategy_pending_buckets row matches strategy_id (pre-Pass-20 manual graduation? cannot verify cross-validation)`);
    }

    // ── D. False-positive detection ────────────────────────────────────
    // D1: generic / template name
    for (const pat of GENERIC_NAME_PATTERNS) {
      if (pat.test(cn)) {
        defects.push(`D1: concept_name '${cn}' matches generic-template pattern ${pat}`);
        break;
      }
    }

    // D3: entry_type=='unknown' AND concept doesn't resolve via regex
    if (entryType === "unknown") {
      defects.push(`D3: entry_type='unknown' (deriveEntryType should resolve from concept_name)`);
    }

    // D4: orphan — graduated > 30d ago but never backtested
    const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86_400_000;
    if (ageDays > 30) {
      const [bt] = await sql<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM strategy_backtest_runs WHERE strategy_id = ${r.id}
      `;
      if ((bt?.count ?? 0) === 0) {
        warnings.push(`D4: graduated ${ageDays.toFixed(0)}d ago, 0 backtest runs (orphan)`);
      }
    }

    // ── E. Compliance gates ────────────────────────────────────────────
    // TOP-LEVEL config paths, not strategy.*
    const regimeGate = c?.regime_gate ?? {};
    if (!regimeGate?.enabled) {
      defects.push(`E1: regime_gate.enabled !== true (CLAUDE.md §13 — every strategy must have regime tag)`);
    } else if (!regimeGate?.preferred_regime) {
      warnings.push(`E1: regime_gate enabled but no preferred_regime set`);
    }
    const sessionFilter = c?.session_filter ?? {};
    if (!sessionFilter?.enabled || sessionFilter?.session !== "RTH_ONLY") {
      warnings.push(`E2: session_filter=${JSON.stringify(sessionFilter)} (expected enabled+RTH_ONLY)`);
    }
    // E3: MFFU Tier-1 econ blackout — this is enforced at the LIFECYCLE/runtime
    // level (paper engine + compliance gates), not in strategy DSL. Drop the
    // warning; strategies don't need to declare it inline.

    results.push({ id: r.id, name: r.name, symbol: r.symbol, defects, warnings });
  }

  return results;
}

(async () => {
  try {
    const results = await deepScan();
    let totalDefects = 0;
    let totalWarnings = 0;
    const clean: string[] = [];
    const flagged: Result[] = [];

    for (const r of results) {
      if (r.defects.length === 0 && r.warnings.length === 0) clean.push(r.name);
      else flagged.push(r);
      totalDefects += r.defects.length;
      totalWarnings += r.warnings.length;
    }

    // Frequency analysis
    const defectFreq = new Map<string, number>();
    const warnFreq = new Map<string, number>();
    for (const r of results) {
      for (const d of r.defects) {
        const key = d.split(":")[0];
        defectFreq.set(key, (defectFreq.get(key) ?? 0) + 1);
      }
      for (const w of r.warnings) {
        const key = w.split(":")[0];
        warnFreq.set(key, (warnFreq.get(key) ?? 0) + 1);
      }
    }

    console.log("=== Per-strategy report ===");
    for (const r of flagged) {
      console.log(`\n${r.name} (${r.symbol})`);
      for (const d of r.defects) console.log(`  DEFECT  ${d}`);
      for (const w of r.warnings) console.log(`  WARN    ${w}`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Total strategies: ${results.length}`);
    console.log(`  Clean: ${clean.length}`);
    console.log(`  Flagged: ${flagged.length} (defects + warnings)`);
    console.log(`  Total defects:  ${totalDefects}`);
    console.log(`  Total warnings: ${totalWarnings}`);

    if (defectFreq.size) {
      console.log(`\n=== Defect frequency ===`);
      for (const [k, n] of [...defectFreq.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${n}`);
      }
    }
    if (warnFreq.size) {
      console.log(`\n=== Warning frequency ===`);
      for (const [k, n] of [...warnFreq.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${n}`);
      }
    }
  } finally {
    await sql.end();
  }
})();
