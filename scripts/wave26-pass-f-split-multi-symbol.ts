/**
 * Wave 26 Pass F backfill — split existing multi-symbol strategy rows into
 * SEPARATE rows per market.
 *
 * Pre-Pass-F state: strategies created by Pass E carry `symbols=[MES,MNQ,MCL]`
 * in a single row. Backtest then routes to ONE market (the leader symbol),
 * giving us no signal on whether the concept earns on MNQ or MCL.
 *
 * Operator mandate: "separate them by market until they get tested" — each
 * (concept × market) pair is its own row, backtest independently, DEPLOY-stage
 * keeps only the markets where the concept proves out.
 *
 * What it does:
 *   1. Find strategies where array_length(symbols) > 1
 *   2. For each: shrink original row to symbols=[leader_market]
 *   3. For each non-leader market: INSERT a new row with that market's name,
 *      symbol, symbols=[market], and re-applied per-market position_size
 *      (MES base 6 + cap 100 / MNQ base 6 + cap 50 / MCL base 18 + cap 30).
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave26-pass-f-split-multi-symbol.ts          # dry-run
 *   npx tsx -r dotenv/config scripts/wave26-pass-f-split-multi-symbol.ts --apply  # mutate
 *
 * Only touches strategies created in the last 7d from source='graduated_bucket'.
 */
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Math.max(1, parseInt(daysArg.split("=")[1], 10)) : 7;
const FIX_REF = "wave26-pass-f-split-multi-symbol";

// Per-market sizing canonical (Wave 23 §4)
const PER_MARKET_SIZING: Record<string, { base: number; cap: number }> = {
  MES: { base: 6, cap: 100 },
  MNQ: { base: 6, cap: 50 },
  MCL: { base: 18, cap: 30 },
};

function deriveMarketSpecificName(originalName: string, originalMarket: string, newMarket: string): string {
  // strategy_name canonical pattern: `<concept>_<market>_<timeframe>` (W23F.M)
  // Replace _<old_market>_ → _<new_market>_; if not present, append.
  const oldLower = originalMarket.toLowerCase();
  const newLower = newMarket.toLowerCase();
  const re = new RegExp(`_${oldLower}_`);
  if (re.test(originalName)) {
    return originalName.replace(re, `_${newLower}_`);
  }
  // Doesn't have suffix — append market_timeframe extracted from tail
  return `${originalName}_${newLower}`;
}

async function main(): Promise<void> {
  console.log(`[wave26-pass-f-split] mode=${APPLY ? "APPLY" : "DRY-RUN"}  window=${DAYS}d\n`);

  const rows = await db.execute(sql`
    SELECT id::text, name, symbol, symbols, timeframe, config, tags, preferred_regime, preferred_regimes,
           use_weighted_scoring, confluence_score_threshold::text, confluence_score_weights,
           daily_tf, htf_tf, itf_tf, trigger_tf, exit_plan_config
    FROM strategies
    WHERE created_at > NOW() - (${DAYS}::int * INTERVAL '1 day')
      AND source = 'graduated_bucket'
      AND array_length(symbols, 1) > 1
    ORDER BY created_at ASC
  `);
  const list = rows as unknown as any[];
  console.log(`Found ${list.length} multi-symbol strategies to split.\n`);

  let splits = 0;
  let newRows = 0;
  for (const s of list) {
    const allSymbols = (s.symbols ?? []) as string[];
    const leader = allSymbols[0];
    const variants = allSymbols.slice(1);
    if (variants.length === 0) continue;

    console.log(`→ ${s.name}  [${allSymbols.join(",")}] → leader=${leader}, variants=[${variants.join(",")}]`);
    splits++;

    if (!APPLY) {
      newRows += variants.length;
      continue;
    }

    // 1. Shrink original row to symbols=[leader]
    await db.execute(sql`UPDATE strategies SET symbols = ARRAY[${leader}]::text[], updated_at = NOW() WHERE id = ${s.id}::uuid`);

    // 2. INSERT one new row per variant market
    for (const m of variants) {
      const variantName = deriveMarketSpecificName(s.name, leader, m).slice(0, 80);
      const sizing = PER_MARKET_SIZING[m] ?? PER_MARKET_SIZING.MES;

      // Clone config and adjust nested strategy.position_size + strategy.symbol
      const cfg = { ...(s.config ?? {}) } as Record<string, any>;
      if (cfg.strategy) {
        cfg.strategy = { ...cfg.strategy };
        cfg.strategy.symbol = m;
        if (cfg.strategy.position_size) {
          cfg.strategy.position_size = {
            ...cfg.strategy.position_size,
            base_contracts: sizing.base,
            liquidity_comfort_cap: sizing.cap,
          };
        }
      }
      cfg.metadata = { ...(cfg.metadata ?? {}), source: "graduated_bucket", variant_of_strategy_id: s.id, fix_ref: FIX_REF };

      // INSERT via raw SQL. Postgres-array literal format: '{a,b,c}' cast to text[].
      const tagsLit = "{" + (s.tags ?? []).map((t: string) => `"${String(t).replace(/"/g, '\\"')}"`).join(",") + "}";
      const regimesLit = "{" + (s.preferred_regimes ?? []).map((t: string) => `"${String(t).replace(/"/g, '\\"')}"`).join(",") + "}";
      const r = await db.execute<{ id: string }>(sql`
        INSERT INTO strategies (
          name, description, symbol, symbols, timeframe, source, config, tags,
          preferred_regime, preferred_regimes,
          use_weighted_scoring, confluence_score_threshold, confluence_score_weights,
          exit_plan_config, daily_tf, htf_tf, itf_tf, trigger_tf
        ) VALUES (
          ${variantName},
          ${"Per-market variant (Wave 26 Pass F split). " + (s.name)},
          ${m},
          ARRAY[${m}]::text[],
          ${s.timeframe},
          'graduated_bucket',
          ${JSON.stringify(cfg)}::jsonb,
          ${tagsLit}::text[],
          ${s.preferred_regime},
          ${regimesLit}::text[],
          ${s.use_weighted_scoring ?? true},
          ${s.confluence_score_threshold},
          ${JSON.stringify(s.confluence_score_weights ?? {})}::jsonb,
          ${JSON.stringify(s.exit_plan_config ?? { exit_style: "adaptive" })}::jsonb,
          ${s.daily_tf}, ${s.htf_tf}, ${s.itf_tf}, ${s.trigger_tf}
        )
        RETURNING id::text
      `).catch((e: any) => {
        console.log(`     ! ${variantName} (${m}) INSERT failed: ${(e as Error).message.slice(0, 100)}`);
        return [{ id: null }];
      });
      const newId = (r as any[])[0]?.id;
      if (newId) {
        newRows++;
        await db.insert(auditLog).values({
          action: "strategy.market_variant_backfilled",
          entityType: "strategy",
          entityId: newId,
          input: { source_strategy_id: s.id, variant_market: m } as Record<string, unknown>,
          result: { fix_ref: FIX_REF, variant_name: variantName, variant_market: m, leader_market: leader } as Record<string, unknown>,
          status: "success",
          decisionAuthority: "system",
          correlationId: null,
        }).catch((e) => console.warn(`  audit failed: ${(e as Error).message}`));
        console.log(`     + ${variantName} (${m}, base=${sizing.base}, cap=${sizing.cap})`);
      } else {
        console.log(`     ! ${variantName} (${m}) — name collision skipped`);
      }
    }
  }

  console.log(`\nSummary: ${splits} ${APPLY ? "split" : "would split"}, ${newRows} ${APPLY ? "new" : "would create"} variant rows.`);
  if (!APPLY) console.log("\nRe-run with --apply to mutate.");
  process.exit(0);
}

main().catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
