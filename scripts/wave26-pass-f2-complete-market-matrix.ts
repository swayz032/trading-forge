/**
 * Wave 26 Pass F.2 — Complete the (concept × market) matrix.
 *
 * After Pass F split, 12 (concept × market) cells were missing:
 *   - 3 agnostic concepts had MES only (silent INSERT failures in Pass F apply)
 *   - 3 nasdaq/oil concepts had MES only (Pass E backfill set symbols=[MNQ]/[MCL]
 *     but kept symbol='MES' + the _mes_ name; Pass F split skipped them
 *     because symbols.length===1)
 *
 * This script:
 *   1. Fixes the 3 nasdaq/oil rows so their `symbol` + `symbols[]` match
 *      their NAME (all say _mes_, so set to MES). This makes them the MES
 *      variant of the nasdaq/oil concept.
 *   2. Finds every (concept_stem, timeframe) tuple where any of {MES,MNQ,MCL}
 *      is missing, and INSERTs the missing variants with correct per-market
 *      sizing (MES 6/100, MNQ 6/50, MCL 18/30).
 *
 * Library-view correctness: every row's `symbol` column now matches its
 * `symbols[]` and matches its NAME, so frontend filters by symbol group
 * the strategies cleanly into MES / MNQ / MCL tabs.
 */
import { db } from "../src/server/db/index.js";
import { auditLog } from "../src/server/db/schema.js";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const FIX_REF = "wave26-pass-f2-complete-matrix";

const PER_MARKET_SIZING: Record<string, { base: number; cap: number }> = {
  MES: { base: 6,  cap: 100 },
  MNQ: { base: 6,  cap: 50  },
  MCL: { base: 18, cap: 30  },
};

async function main(): Promise<void> {
  console.log(`[wave26-pass-f2] mode=${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  // STEP 1 — Fix the symbol/symbols mismatch on nasdaq/oil rows where name has _mes_
  console.log("=== STEP 1: Fix nasdaq/oil rows with mismatched symbol vs name ===");
  const mismatchSql = sql`
    SELECT id::text, name, symbol, symbols
    FROM strategies
    WHERE source = 'graduated_bucket' AND created_at > NOW() - INTERVAL '24 hours'
      AND name ~ '_mes_' AND NOT (symbols @> ARRAY['MES']::text[])
  `;
  const mismatchRows = (await db.execute(mismatchSql)) as unknown as any[];
  console.log(`  Found ${mismatchRows.length} rows with name=_mes_ but symbols≠[MES]:`);
  for (const r of mismatchRows) {
    console.log(`    ${r.name}  symbol=${r.symbol}  symbols=[${r.symbols.join(",")}] → set to MES (matches name)`);
  }
  if (APPLY && mismatchRows.length > 0) {
    for (const r of mismatchRows) {
      await db.execute(sql`
        UPDATE strategies SET symbol = 'MES', symbols = ARRAY['MES']::text[], updated_at = NOW()
        WHERE id = ${r.id}::uuid
      `);
    }
    console.log(`  ✓ Fixed ${mismatchRows.length} rows.`);
  }

  // STEP 2 — Find concept × market matrix gaps and complete them
  console.log("\n=== STEP 2: Find missing (concept × market) cells ===");
  const matrixSql = sql`
    SELECT regexp_replace(name, '_(mes|mnq|mcl)_[a-z0-9]+$', '') as stem,
           timeframe,
           array_agg(DISTINCT symbol ORDER BY symbol) as has_markets,
           MIN(id::text) as sample_id
    FROM strategies WHERE source='graduated_bucket' AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY stem, timeframe
    ORDER BY stem, timeframe
  `;
  const matrix = (await db.execute(matrixSql)) as unknown as any[];

  const wanted = ["MES", "MNQ", "MCL"];
  const gaps: Array<{ stem: string; timeframe: string; missing: string[]; sample_id: string }> = [];
  for (const row of matrix) {
    const has = row.has_markets ?? [];
    const missing = wanted.filter(m => !has.includes(m));
    if (missing.length > 0) {
      gaps.push({ stem: row.stem, timeframe: row.timeframe, missing, sample_id: row.sample_id });
    }
  }
  console.log(`  ${matrix.length} concept-stems found; ${gaps.length} have missing markets.\n`);
  for (const g of gaps) {
    console.log(`    ${g.stem.padEnd(50)} tf=${g.timeframe.padEnd(4)} missing=[${g.missing.join(",")}]`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to mutate.");
    process.exit(0);
  }

  // STEP 3 — INSERT missing variants. Pull a sample row per gap to clone from.
  console.log("\n=== STEP 3: INSERT missing variants ===");
  let inserted = 0;
  let failed = 0;
  for (const g of gaps) {
    const [s] = (await db.execute(sql`
      SELECT name, symbol, symbols, timeframe, config, tags, preferred_regime, preferred_regimes,
             use_weighted_scoring, confluence_score_threshold::text, confluence_score_weights,
             exit_plan_config, daily_tf, htf_tf, itf_tf, trigger_tf, description
      FROM strategies WHERE id = ${g.sample_id}::uuid
    `)) as unknown as any[];
    if (!s) continue;

    for (const m of g.missing) {
      const variantName = `${g.stem}_${m.toLowerCase()}_${g.timeframe}`.slice(0, 80);
      const sizing = PER_MARKET_SIZING[m];
      const cfg = { ...(s.config ?? {}) } as Record<string, any>;
      if (cfg.strategy) {
        cfg.strategy = { ...cfg.strategy, symbol: m };
        if (cfg.strategy.position_size) {
          cfg.strategy.position_size = {
            ...cfg.strategy.position_size,
            base_contracts: sizing.base,
            liquidity_comfort_cap: sizing.cap,
          };
        }
      }
      cfg.metadata = { ...(cfg.metadata ?? {}), source: "graduated_bucket", fix_ref: FIX_REF, variant_of: s.name };
      const tagsLit = "{" + (s.tags ?? []).map((t: string) => `"${String(t).replace(/"/g, '\\"')}"`).join(",") + "}";
      const regimesLit = "{" + (s.preferred_regimes ?? []).map((t: string) => `"${String(t).replace(/"/g, '\\"')}"`).join(",") + "}";

      try {
        const r = (await db.execute(sql`
          INSERT INTO strategies (
            name, description, symbol, symbols, timeframe, source, config, tags,
            preferred_regime, preferred_regimes,
            use_weighted_scoring, confluence_score_threshold, confluence_score_weights,
            exit_plan_config, daily_tf, htf_tf, itf_tf, trigger_tf
          ) VALUES (
            ${variantName},
            ${"Per-market variant (Wave 26 Pass F.2 matrix completion). " + s.name},
            ${m}, ARRAY[${m}]::text[],
            ${g.timeframe},
            'graduated_bucket',
            ${JSON.stringify(cfg)}::jsonb,
            ${tagsLit}::text[],
            ${s.preferred_regime}, ${regimesLit}::text[],
            ${s.use_weighted_scoring ?? true},
            ${s.confluence_score_threshold},
            ${JSON.stringify(s.confluence_score_weights ?? {})}::jsonb,
            ${JSON.stringify(s.exit_plan_config ?? { exit_style: "adaptive" })}::jsonb,
            ${s.daily_tf}, ${s.htf_tf}, ${s.itf_tf}, ${s.trigger_tf}
          ) RETURNING id::text
        `)) as unknown as any[];
        const newId = r[0]?.id;
        if (newId) {
          inserted++;
          console.log(`  + ${variantName}  (${m} base=${sizing.base} cap=${sizing.cap})`);
          await db.insert(auditLog).values({
            action: "strategy.market_matrix_completed",
            entityType: "strategy",
            entityId: newId,
            input: { source_strategy_id: s.name, variant_market: m, concept_stem: g.stem } as Record<string, unknown>,
            result: { fix_ref: FIX_REF, variant_name: variantName } as Record<string, unknown>,
            status: "success",
            decisionAuthority: "system",
            correlationId: null,
          }).catch(() => {});
        } else {
          failed++;
          console.log(`  ! ${variantName} — INSERT returned no id`);
        }
      } catch (e) {
        failed++;
        console.log(`  ! ${variantName} — ${(e as Error).message.slice(0, 100)}`);
      }
    }
  }
  console.log(`\nSummary: ${inserted} new variants inserted, ${failed} failed.`);
  process.exit(0);
}

main().catch((e) => { console.error("Pass F.2 failed:", e); process.exit(1); });
