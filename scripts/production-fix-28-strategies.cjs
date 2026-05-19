/**
 * Pass 21 (2026-05-17) — production-grade cleanup of the 28 active strategies.
 *
 * Two actions, both audit-logged, non-destructive:
 *   1. Archive 9 JUNK strategies (engine has no pattern OR auditor v2 would reject)
 *   2. Retrofit entry_params on 19 THIN strategies using deriveEntryParams() logic
 *      mirrored from src/server/services/direct-bucket-graduator.ts
 *
 * After this:
 *   - 9 strategies tagged 'archived_unsupported_concept' + 'archived_duplicate' (hidden from default list)
 *   - 19 strategies have populated entry_params (Connors RSI-2 → period=2, oversold=5, overbought=95;
 *     9_21_ema_pullback → fast=9 slow=21; etc.)
 *   - Backtest engine can compile + run each with meaningful distinguishing params
 *
 * Modes:
 *   --dry-run  (default): report what would change
 *   --apply:              execute
 */
require("dotenv/config");
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const ENGINE_REJECT_PATTERNS = [
  { re: /supertrend/i, concept: "supertrend" },
  { re: /(^|_)ict(_|$)|smc|choch|smart.money|order.block/i, concept: "ICT/SMC" },
  { re: /(^|_)fvg(_|$)|fair.value.gap|ifvg/i, concept: "FVG" },
  { re: /liquidity.sweep|liquidity.void/i, concept: "liquidity_sweep" },
  { re: /volume.profile|market.profile|(^|_)poc(_|$)|(^|_)vah(_|$)|(^|_)val(_|$)/i, concept: "volume_profile" },
  { re: /pivot.point|floor.pivot|camarilla/i, concept: "pivot_points" },
  { re: /wyckoff|accumulation.distribution/i, concept: "wyckoff" },
];

const AUDITOR_REJECT_PATTERNS = [
  { re: /why.dont|why.don.t|why.doesn.t|is.making.*realistic|anyone.else|who.else.uses/i, reason: "discussion_thread" },
  { re: /(^|_)inventories(_|$)|crude.oil.inventories|jobless.claims/i, reason: "economic_event_report" },
  { re: /(^|_)secrets(_|$)|dangerous.traps|millionaires/i, reason: "click_bait" },
  { re: /r.daytrading.on.reddit|r.futurestrading.on.reddit/i, reason: "reddit_thread_slug" },
];

function shouldArchive(name) {
  for (const p of ENGINE_REJECT_PATTERNS) {
    if (p.re.test(name)) return { archive: true, reason: `no_engine_pattern: ${p.concept}` };
  }
  for (const p of AUDITOR_REJECT_PATTERNS) {
    if (p.re.test(name)) return { archive: true, reason: `auditor_v2_reject: ${p.reason}` };
  }
  return { archive: false };
}

/**
 * Mirror of src/server/services/direct-bucket-graduator.ts deriveEntryParams.
 * Pass 21 v2 smart parser. Keep in lockstep with the TypeScript version.
 */
function smartExtractPeriods(cn) {
  const standardNums = (cn.match(/\b\d+\b/g) || []).map(Number);
  const compressedNums = [];
  const tokenMatches = cn.match(/([a-z]+)(\d{2,4})|([a-z]+\d+)/g) || [];
  for (const tok of tokenMatches) {
    const digitMatch = tok.match(/\d+/);
    if (!digitMatch) continue;
    const digits = digitMatch[0];
    if (digits.length === 1 || digits.length === 2) {
      compressedNums.push(Number(digits));
    } else if (digits.length === 3) {
      for (let i = 1; i < 3; i++) {
        const left = Number(digits.slice(0, i));
        const right = Number(digits.slice(i));
        if (left >= 2 && left <= 250 && right >= 2 && right <= 250) {
          compressedNums.push(left, right);
          break;
        }
      }
    } else if (digits.length === 4) {
      const split22 = [Number(digits.slice(0, 2)), Number(digits.slice(2))];
      if (split22.every((n) => n >= 2 && n <= 250)) compressedNums.push(...split22);
    }
  }
  return [...new Set([...standardNums, ...compressedNums])].filter((n) => n >= 2 && n <= 250);
}

function deriveEntryParams(conceptName, indicator) {
  if (!indicator) return {};
  const cn = conceptName.toLowerCase();
  const nums = smartExtractPeriods(cn);
  const params = {};
  if (indicator === "ema_crossover" || indicator === "sma_crossover" || indicator === "macd_crossover") {
    if (nums.length >= 2) {
      params.fast_period = nums[0];
      params.slow_period = nums[1];
      if (indicator === "macd_crossover" && nums.length >= 3) params.signal_period = nums[2];
    }
    // Linda Raschke Holy Grail = 20-EMA pullback with 14-ADX (ADX not in engine, just use 20)
    if (/holy.grail|raschke/.test(cn) && !params.fast_period) {
      params.fast_period = 20;
      params.slow_period = 50;
    }
  } else if (indicator === "rsi_reversal") {
    if (nums.length >= 1) params.period = nums[0];
    if (/connors|rsi.?2|rsi2/.test(cn)) {
      params.period = 2;
      params.oversold = 5;
      params.overbought = 95;
    }
  } else if (indicator === "bollinger_breakout") {
    if (nums.length >= 1) params.period = nums[0] >= 10 && nums[0] <= 30 ? nums[0] : 20;
    if (nums.length >= 2 && nums[1] >= 1 && nums[1] <= 4) params.std_dev = nums[1];
  } else if (indicator === "atr_breakout" || indicator === "donchian_breakout") {
    if (nums.length >= 1) params.period = nums[0];
  } else if (indicator === "session_open_breakout") {
    if (/15.?min|opening_range_15/.test(cn)) params.range_minutes = 15;
    else if (/5.?min|opening_range_5/.test(cn)) params.range_minutes = 5;
    else if (/30.?min|opening_range_30/.test(cn)) params.range_minutes = 30;
  } else if (indicator === "vwap_fade") {
    if (nums.length >= 1 && nums[0] <= 3) params.atr_extension_threshold = nums[0];
  }
  return params;
}

(async () => {
  try {
    console.log(`MODE: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

    const rows = await sql`
      SELECT id, name, config, tags
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
      ORDER BY name ASC
    `;
    console.log(`Active graduated strategies to process: ${rows.length}\n`);

    let archivedCount = 0;
    let retrofittedCount = 0;
    const archived = [];
    const retrofitted = [];

    for (const r of rows) {
      const decision = shouldArchive(r.name);
      if (decision.archive) {
        archived.push({ id: r.id, name: r.name, reason: decision.reason });
        if (APPLY) {
          await sql`
            UPDATE strategies
            SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['archived_duplicate', 'archived_unsupported_concept']))
            WHERE id = ${r.id}
          `;
          await sql`
            INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
            VALUES (
              'strategy.archived_production_cleanup',
              'strategy',
              ${r.id},
              ${sql.json({ strategy_name: r.name, reason: decision.reason })},
              ${sql.json({ archived_at: new Date().toISOString() })},
              'success',
              'system'
            )
          `;
          archivedCount++;
        }
      } else {
        // Retrofit entry_params
        const c = r.config || {};
        const strat = c.strategy || {};
        const indicator = (strat.indicators && strat.indicators[0]?.type) || strat.entry_indicator;
        const existingParams = c.entry_params || {};
        const derived = deriveEntryParams(r.name, indicator);
        // Merge: existing params win over derived (don't overwrite real data)
        const merged = { ...derived, ...existingParams };

        // Only retrofit if we actually derived something AND existing was empty/missing
        if (Object.keys(derived).length > 0 && Object.keys(existingParams).length === 0) {
          retrofitted.push({ id: r.id, name: r.name, indicator, derivedParams: derived });
          if (APPLY) {
            const newConfig = { ...c, entry_params: merged };
            await sql`UPDATE strategies SET config = ${sql.json(newConfig)} WHERE id = ${r.id}`;
            await sql`
              INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
              VALUES (
                'strategy.entry_params_retrofitted',
                'strategy',
                ${r.id},
                ${sql.json({ strategy_name: r.name, indicator, derived_from: "concept_name" })},
                ${sql.json({ before_params: existingParams, after_params: merged })},
                'success',
                'system'
              )
            `;
            retrofittedCount++;
          }
        }
      }
    }

    console.log("══════════════════════════════════════════════════════");
    console.log("ARCHIVE LIST (9 JUNK strategies)");
    console.log("══════════════════════════════════════════════════════");
    for (const a of archived) console.log(`  ✗ ${a.name}\n     reason: ${a.reason}`);

    console.log("\n══════════════════════════════════════════════════════");
    console.log(`RETROFIT LIST (${retrofitted.length} strategies get entry_params populated)`);
    console.log("══════════════════════════════════════════════════════");
    for (const r of retrofitted) console.log(`  ↻ ${r.name}\n     indicator=${r.indicator}  params=${JSON.stringify(r.derivedParams)}`);

    console.log("\n══════════════════════════════════════════════════════");
    console.log(`SUMMARY (${APPLY ? "APPLIED" : "DRY RUN"})`);
    console.log("══════════════════════════════════════════════════════");
    console.log(`  Before:           ${rows.length} active strategies`);
    console.log(`  Archived (JUNK):  ${archived.length}`);
    console.log(`  Retrofitted:      ${retrofitted.length}`);
    console.log(`  After:            ${rows.length - archived.length} active strategies`);
    if (!APPLY) console.log("\nRe-run with --apply to execute.");
  } finally {
    await sql.end();
  }
})();
