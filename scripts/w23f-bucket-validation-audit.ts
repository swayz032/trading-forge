/**
 * W23F.O — Bucket Validation Audit
 *
 * For every stuck bucket, predict whether it will pass the graduation gates
 * end-to-end. Identifies:
 *   - GREEN: would graduate cleanly (valid indicator, real params, full DSL)
 *   - YELLOW: would graduate but with legacy_no_confluence (no confluence_factors)
 *   - RED-INDICATOR: rejected — indicator not in compiler catalog
 *   - RED-PARAMS: rejected — missing required params
 *   - RED-THIN: rejected — placeholder/empty entry_condition
 *   - DUPLICATE: an active strategy with same concept already exists
 *
 * Run: railway run -- npx tsx scripts/w23f-bucket-validation-audit.ts
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });

// Engine-supported indicators per dsl-compiler.ts primitive grammar
const VALID_INDICATORS = new Set([
  "ema_crossover", "sma_crossover", "dema_crossover",
  "rsi_reversal", "rsi_divergence",
  "bollinger_breakout", "macd_crossover",
  "atr_breakout", "atr_trailing_stop", "donchian_breakout",
  "session_open_breakout",
  "vwap_fade", "vwap_reversion",
  "supertrend", "ichimoku_cloud",
  "cumulative_delta",
  // Wave 14 canonical-defaults targets that the graduator can handle
  "opening_range_breakout",
]);

// Indicators the compiler explicitly knows but require specific param sets
const REQUIRED_PARAMS: Record<string, string[]> = {
  ema_crossover: ["fast_period", "slow_period"],
  sma_crossover: ["fast_period", "slow_period"],
  rsi_reversal: ["period"],
  bollinger_breakout: ["period"],
  session_open_breakout: ["range_minutes"],
  macd_crossover: [],
  vwap_fade: [],
  vwap_reversion: [],
  atr_breakout: ["period"],
  donchian_breakout: ["period"],
};

async function main() {
  console.log("=== W23F.O Bucket Validation Audit ===\n");

  const buckets = await sql<any[]>`
    SELECT id::text, market, concept_name, source_count, distinct_providers,
           layer_coverage_json, first_seen_at, last_seen_at
    FROM strategy_pending_buckets
    WHERE graduated_strategy_id IS NULL
      AND source_count >= 3
      AND distinct_providers >= 2
      AND (
        (layer_coverage_json->>'web' = 'true' AND layer_coverage_json->>'reddit' = 'true') OR
        (layer_coverage_json->>'web' = 'true' AND layer_coverage_json->>'youtube' = 'true') OR
        (layer_coverage_json->>'reddit' = 'true' AND layer_coverage_json->>'youtube' = 'true')
      )
      AND last_seen_at > NOW() - INTERVAL '30 days'
    ORDER BY source_count DESC, last_seen_at DESC
  `;
  console.log(`Found ${buckets.length} stuck buckets to validate.\n`);

  const buckets_GREEN: any[] = [];
  const buckets_YELLOW: any[] = [];
  const buckets_RED_INDICATOR: any[] = [];
  const buckets_RED_PARAMS: any[] = [];
  const buckets_RED_THIN: any[] = [];
  const buckets_DUPLICATE: any[] = [];
  const missingIndicators = new Map<string, number>();

  // Check what strategies already exist (dedup against active library)
  const existingStrategies = await sql<{ name: string }[]>`SELECT name FROM strategies WHERE archived_at IS NULL`;
  const existingNames = new Set(existingStrategies.map(s => s.name));

  for (const b of buckets) {
    // Get the best (richest) mention for this bucket
    const mentions = await sql<any[]>`
      SELECT extracted_idea, scout_layer, source_provider
      FROM strategy_pending_mentions
      WHERE bucket_id = ${b.id}::uuid
      ORDER BY (CASE
        WHEN extracted_idea ? 'entry_params' AND jsonb_typeof(extracted_idea->'entry_params')='object' AND extracted_idea->'entry_params' != '{}'::jsonb THEN 1
        WHEN extracted_idea ? 'entry_indicator' THEN 2
        ELSE 3
      END) ASC, created_at DESC
      LIMIT 1
    `;

    const best = mentions[0]?.extracted_idea ?? {};
    const indicator: string = best.entry_indicator || "";
    const params = best.entry_params && typeof best.entry_params === "object" ? best.entry_params : {};
    const entryCondition: string = best.entry_condition || best.entry_long || "";

    // Predict graduation name
    const expectedName = (() => {
      // Mirror deriveStrategyName logic
      const pretty = b.concept_name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
      const tf = best.timeframe || "5m";
      const sym = (best.symbols?.[0] ?? b.market).toLowerCase();
      if (/_(\d+m|\d+h|\d+d)$/.test(pretty)) return `${pretty}_${sym}`.slice(0, 80);
      return `${pretty}_${sym}_${tf}`.slice(0, 80);
    })();

    // CHECK 1: duplicate name
    if (existingNames.has(expectedName)) {
      buckets_DUPLICATE.push({ ...b, expectedName, indicator });
      continue;
    }

    // CHECK 2: thin DSL
    const thinDsl = !indicator || (!Object.keys(params).length && !entryCondition);
    if (thinDsl) {
      buckets_RED_THIN.push({ ...b, indicator: indicator || "<none>", reason: "no indicator + no params + no entry_condition" });
      continue;
    }

    // CHECK 3: indicator in catalog
    if (!VALID_INDICATORS.has(indicator)) {
      buckets_RED_INDICATOR.push({ ...b, indicator, expectedName });
      missingIndicators.set(indicator, (missingIndicators.get(indicator) ?? 0) + 1);
      continue;
    }

    // CHECK 4: required params present
    const required = REQUIRED_PARAMS[indicator] ?? [];
    const missingParams = required.filter(p => !(p in params));
    if (missingParams.length > 0) {
      buckets_RED_PARAMS.push({ ...b, indicator, expectedName, missingParams });
      continue;
    }

    // CHECK 5: confluence_factors → YELLOW vs GREEN
    const hasConfluence = Array.isArray(best.confluence_factors) && best.confluence_factors.length > 0;
    const row = { ...b, indicator, expectedName, params, direction: best.direction || "long", confluence: best.confluence_factors || [] };
    if (hasConfluence) buckets_GREEN.push(row); else buckets_YELLOW.push(row);
  }

  // ─── Report ───────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║                     VALIDATION RESULTS                                ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  console.log(`🟢 GREEN — would graduate cleanly with full W23F shape:  ${buckets_GREEN.length}`);
  for (const x of buckets_GREEN.slice(0, 15)) {
    console.log(`     ${x.market} | ${x.indicator.padEnd(22)} | ${x.expectedName.slice(0, 50)}`);
  }

  console.log(`\n🟡 YELLOW — would graduate as legacy_no_confluence:       ${buckets_YELLOW.length}`);
  for (const x of buckets_YELLOW.slice(0, 15)) {
    console.log(`     ${x.market} | ${x.indicator.padEnd(22)} | ${x.expectedName.slice(0, 50)}`);
  }

  console.log(`\n🔴 RED-INDICATOR — engine doesn't know the indicator:    ${buckets_RED_INDICATOR.length}`);
  console.log(`   Top missing indicators (occurrences):`);
  for (const [ind, n] of Array.from(missingIndicators.entries()).sort((a,b) => b[1]-a[1]).slice(0, 10)) {
    console.log(`     ${(ind || "<empty>").padEnd(40)} ×${n}`);
  }

  console.log(`\n🔴 RED-PARAMS — indicator OK but params missing:         ${buckets_RED_PARAMS.length}`);
  for (const x of buckets_RED_PARAMS.slice(0, 10)) {
    console.log(`     ${x.market} | ${x.indicator.padEnd(22)} | missing: ${x.missingParams.join(", ")}`);
  }

  console.log(`\n🔴 RED-THIN — no indicator + no params + no entry_cond:  ${buckets_RED_THIN.length}`);

  console.log(`\n⚪ DUPLICATE — strategy with this name already exists:    ${buckets_DUPLICATE.length}`);
  for (const x of buckets_DUPLICATE.slice(0, 5)) {
    console.log(`     ${x.expectedName}`);
  }

  console.log("\n=== TOTALS ===");
  console.log(`Stuck buckets       : ${buckets.length}`);
  console.log(`Will-graduate (G+Y) : ${buckets_GREEN.length + buckets_YELLOW.length}`);
  console.log(`Cannot-graduate (R) : ${buckets_RED_INDICATOR.length + buckets_RED_PARAMS.length + buckets_RED_THIN.length}`);
  console.log(`Already exist       : ${buckets_DUPLICATE.length}`);
  console.log(`Realistic library size after sweep: ${(buckets_GREEN.length + buckets_YELLOW.length)} new strategies`);

  console.log("\n=== Per-market breakdown ===");
  const all = [...buckets_GREEN, ...buckets_YELLOW];
  const byMarket: Record<string, number> = {};
  for (const x of all) byMarket[x.market] = (byMarket[x.market] ?? 0) + 1;
  for (const m of ["MES", "MNQ", "MCL"]) console.log(`  ${m}: ${byMarket[m] ?? 0} would graduate`);

  console.log("\n=== Indicator-fix impact (what would unlock if added to compiler) ===");
  for (const [ind, n] of Array.from(missingIndicators.entries()).sort((a,b) => b[1]-a[1]).slice(0, 5)) {
    console.log(`  Adding '${ind}' → +${n} strategies unlock`);
  }

  await sql.end();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
