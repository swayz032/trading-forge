/**
 * Pass 21 v2 (2026-05-16) — honest dedup based on actual DSL rule identity.
 *
 * The earlier wide-fingerprint pass was conservative because it hashed
 * concept_name (which still carries article-title noise). This second pass
 * groups by the FUNCTIONAL trading rule:
 *
 *   key = sha256(archetype_keyword | entry_indicator | timeframe | direction | entry_params_json)
 *
 * If two strategies produce the same key, they are LITERALLY THE SAME TRADE.
 * Their entry_long prose differs (article title noise), their concept names
 * differ (URL slug differences), but the executable rule is identical.
 *
 * Archetype keyword is computed from the strategy name using the same regex
 * the cluster-comparator uses. This catches:
 *   - 3 Supertrend strategies, all `ema_crossover` 5m long, empty params → 1 keep, 2 archive
 *   - 3 Volume Profile strategies, all same indicator/tf/dir → 1 keep, 2 archive
 *   - 2 Holy Grail strategies, same indicator/tf/dir, empty params → 1 keep, 1 archive
 *
 * It correctly preserves:
 *   - 5m-ORB vs 15m-ORB (different timeframes)
 *   - rsi_reversal vs ema_crossover Connors (different indicators)
 *   - 9-EMA vs 21-EMA (different params, IF the scout actually populated them)
 *
 * Modes:
 *   --dry-run (default): report what would happen
 *   --apply:             execute the cleanup
 */
require("dotenv/config");
const postgres = require("postgres");
const { createHash } = require("crypto");

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function archetypeKeyword(name) {
  const n = name.toLowerCase();
  if (/orb|opening_range/i.test(n)) return "orb";
  if (/holy_grail/i.test(n)) return "holy_grail";
  if (/rsi_?2|rsi2|connors/i.test(n)) return "connors_rsi";
  if (/supertrend/i.test(n)) return "supertrend";
  if (/volume_profile|poc|vah|val/i.test(n)) return "volume_profile";
  if (/bollinger/i.test(n)) return "bollinger";
  if (/(^|_)fvg(_|$)|fair_value_gap/i.test(n)) return "fvg";
  if (/inside_bar|nr4|nr7/i.test(n)) return "inside_bar";
  if (/macd/i.test(n)) return "macd";
  if (/liquidity_sweep/i.test(n)) return "liquidity_sweep";
  if (/ict|smc|choch|smart_money/i.test(n)) return "ict_smc";
  if (/vwap/i.test(n)) return "vwap";
  if (/stochastic/i.test(n)) return "stochastic";
  if (/keltner|donchian/i.test(n)) return "channel";
  if (/asian|session/i.test(n)) return "session";
  if (/mean_reversion|reversal/i.test(n)) return "mean_reversion";
  if (/squeeze/i.test(n)) return "squeeze";
  if (/pivot/i.test(n)) return "pivot";
  // EMA / MA crossover family — group by indicator type, not by name
  if (/ema|moving_average/i.test(n)) return "ma_cross";
  if (/breakout/i.test(n)) return "breakout_generic";
  if (/news|fomc|cpi|nfp|inventories/i.test(n)) return "event_driven";
  if (/accumulation|distribution|wyckoff/i.test(n)) return "wyckoff";
  return "other";
}

function ruleKey(s) {
  const c = s.config || {};
  const strat = c.strategy || {};
  const arch = archetypeKeyword(s.name);
  const indicator = (strat.indicators && strat.indicators[0]?.type) || strat.entry_indicator || "unknown";
  const tf = strat.timeframe || c.timeframe || "unknown";
  const dir = c.direction || "long";
  const params = c.entry_params || {};
  const sortedKeys = Object.keys(params).sort();
  const paramSig = sortedKeys.map((k) => `${k}=${JSON.stringify(params[k])}`).join(";");
  const raw = `${arch}|${indicator}|${tf}|${dir}|${paramSig}`;
  return { key: createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16), arch, indicator, tf, dir, paramSig };
}

(async () => {
  try {
    console.log(`MODE: ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}\n`);

    const rows = await sql`
      SELECT id, name, config, created_at, tags
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
      ORDER BY created_at ASC
    `;
    console.log(`Active graduated strategies: ${rows.length}\n`);

    // Compute rule key for each
    const annotated = rows.map((s) => ({ ...s, ...ruleKey(s) }));

    // Group by key
    const groups = new Map();
    for (const r of annotated) {
      if (!groups.has(r.key)) groups.set(r.key, []);
      groups.get(r.key).push(r);
    }

    const dupGroups = [...groups.values()].filter((g) => g.length > 1);
    let totalArchive = 0;
    for (const g of dupGroups) totalArchive += g.length - 1;

    console.log(`Total unique rule keys:        ${groups.size}`);
    console.log(`Groups with >1 strategy:        ${dupGroups.length}`);
    console.log(`Total textual duplicates:       ${totalArchive}`);
    console.log(`After dedup:                    ${rows.length - totalArchive} active strategies`);
    console.log("");
    console.log("══════════════════════════════════════════════════════");
    console.log("DUPLICATE GROUPS");
    console.log("══════════════════════════════════════════════════════");

    const toArchive = [];
    for (const g of dupGroups) {
      g.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const keeper = g[0];
      console.log(`\n▼ Archetype: ${g[0].arch}  |  indicator: ${g[0].indicator}  |  tf: ${g[0].tf}  |  dir: ${g[0].dir}  |  params: '${g[0].paramSig || '(empty)'}'`);
      console.log(`   ${g.length} strategies, KEEP oldest (${keeper.name})`);
      for (let i = 0; i < g.length; i++) {
        const verdict = i === 0 ? "  ✓ KEEP    " : "  ✗ ARCHIVE";
        console.log(`${verdict} [${g[i].id.slice(0,8)}] ${g[i].name}  created=${new Date(g[i].created_at).toISOString().slice(0,10)}`);
        if (i > 0) toArchive.push({ id: g[i].id, name: g[i].name, keeperId: keeper.id, keeperName: keeper.name, key: g[i].key });
      }
    }

    if (APPLY && toArchive.length > 0) {
      console.log("\n══════════════════════════════════════════════════════");
      console.log("APPLYING ARCHIVAL...");
      console.log("══════════════════════════════════════════════════════");
      let n = 0;
      for (const a of toArchive) {
        await sql`
          UPDATE strategies
          SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['archived_duplicate', 'archived_rule_identity']))
          WHERE id = ${a.id}
        `;
        await sql`
          INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
          VALUES (
            'strategy.archived_rule_identity_duplicate',
            'strategy',
            ${a.id},
            ${sql.json({ strategy_name: a.name, rule_key: a.key })},
            ${sql.json({ kept_strategy_id: a.keeperId, kept_strategy_name: a.keeperName })},
            'success',
            'system'
          )
        `;
        n++;
      }
      console.log(`Archived ${n} strategies (tagged 'archived_duplicate' + 'archived_rule_identity')`);
    }

    console.log("\n══════════════════════════════════════════════════════");
    console.log(`SUMMARY (${APPLY ? "APPLIED" : "DRY RUN"})`);
    console.log("══════════════════════════════════════════════════════");
    console.log(`  Before: ${rows.length} active strategies`);
    console.log(`  After:  ${rows.length - toArchive.length} active strategies`);
    console.log(`  Removed: ${toArchive.length} textual duplicates`);
    if (!APPLY) console.log(`\nRe-run with --apply to execute.`);
  } finally {
    await sql.end();
  }
})();
