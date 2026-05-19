/**
 * Pass 21 (2026-05-16) — one-time backfill + dedup of graduated strategies.
 *
 * Phase 1 (backfill): compute wide_fingerprint_hash for every bucket that has
 *   a graduated_strategy_id but NULL wide_fingerprint_hash. Read concept_name +
 *   the strategy's config to pull timeframe / direction / entry_params, then
 *   write the hash back.
 *
 * Phase 2 (dedup detection): group buckets by wide_fingerprint_hash. Any
 *   group with >1 graduated strategy is a textual-duplicate cluster.
 *
 * Phase 3 (cleanup): for each cluster, keep the OLDEST strategy (first-mover);
 *   for the others, tag them as 'archived_duplicate', remove from active
 *   listings via tag, and audit_log the action. Non-destructive — strategies
 *   stay in DB.
 *
 * Modes:
 *   --dry-run (default): report what would happen, no writes
 *   --apply:             execute the cleanup
 *
 * Run: node scripts/backfill-and-dedup-graduated.cjs [--apply]
 */
require("dotenv/config");
const postgres = require("postgres");
const { createHash } = require("crypto");

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Inline copies of the canonicalConceptName / computeWideConceptFingerprintHash
// logic. Keeping this script self-contained avoids needing tsx + the whole TF
// module graph just to run a one-time backfill.
//
// IMPORTANT: keep these in lockstep with src/server/services/strategy-fingerprint.ts.
// If you change either function there, mirror it here before re-running.
const ABBREVIATION_MAP = {
  orb: "opening_range_breakout", open: "opening", sma: "simple_moving_average",
  ema: "exponential_moving_average", bb: "bollinger_band", fvg: "fair_value_gap",
  ob: "order_block", ifvg: "inverse_fair_value_gap", poc: "point_of_control",
  val: "value_area_low", vah: "value_area_high", rth: "regular_trading_hours",
  eth: "extended_trading_hours", nyo: "ny_open", ldn: "london_session",
};
const STOPWORD_SUFFIXES = ["_strategy", "_setup", "_pattern", "_system", "_method", "_approach", "_technique", "_play"];
const STOPWORD_PREFIXES = ["the_", "a_", "an_"];
const NOISE_TOKENS = new Set([
  "linda","raschke","larry","connors","john","carter","raghee","horner","alexander","elder","murphy","wyckoff","fibonacci","fib","leibovit","tom","demark",
  "setup","setups","types","type","period","periods","meaning","meanings","definition","definitions","summary","overview",
  "i","u","e","x",
  "explained","explanation","explanations","explanatory","tested","testing","test","tests","tutorial","tutorials","guide","guides","ultimate","complete","beginners","advanced","exploring","explore","understanding","mastering","master","building","build","create","creating","dangerous","traps","trap","secrets","secret","profitable","profita","profit","profits","winning","wins","win","best","top","great","proven","signals","signal","results","result","backtest","backtests","backtested","backtesting","cheat","sheet","pdf","data","backed","magic","hours","millionaires","consistently","consistent","rules","rule","discovery","v1","v2","v3","fr","why","what","how","when","where","who","dont","don","people","more","use","uses","using","used","do","does","did","with","without","and","or","of","to","for","from","by","in","on","at","as","is","are","was","were","be","been","being","set","sets","setting","settings","based","still","works","work","tight","big","small","reward","risk","indicator","indicators","formula","formulas","capitalizing","capitalize","confirm","confirmation","candles","candle",
  "stratbase","litefinance","metricgate","edgeful","blog","alchemy","markets","atas","skyrexio","chartschool","stockcharts","finveroo","finwiz","thinkorswim","tos","trade2win","forums","forum","uk","tradezella","tradingview","tradingrage","investinglive","fluxcharts","luxalgo","optionalpha","fxopen","ig","phidias","prop","trinitytrading","trading","trader","traders","futures","stocks","stock","crypto","forex","options","futurestrading","daytrading","ai","docs","doc","com","org","net","alpha","alphalearning","learning","global","smart","money","brief",
  "reddit","subreddit","r","z","min","minute","minutes","hour","hourly","daily","im","ive","youve","didnt","early","late","before","after","easy","old","new","real","fake",
]);

function canonicalConceptName(name) {
  if (!name) return "";
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const tokens = s.split("_").flatMap((t) => ABBREVIATION_MAP[t] ? ABBREVIATION_MAP[t].split("_") : [t]);
  let rejoined = tokens.join("_");
  for (const suf of STOPWORD_SUFFIXES) if (rejoined.endsWith(suf)) rejoined = rejoined.slice(0, -suf.length);
  for (const pre of STOPWORD_PREFIXES) if (rejoined.startsWith(pre)) rejoined = rejoined.slice(pre.length);
  const all = rejoined.split("_").filter(Boolean);
  const denoised = all.filter((t) => !NOISE_TOKENS.has(t));
  const finalT = denoised.length > 0 ? denoised : all;
  let result = [...new Set(finalT)].sort().join("_");
  if (result.length > 60) {
    let t = result.slice(0, 60);
    const i = t.lastIndexOf("_");
    if (i > 0) t = t.slice(0, i);
    result = t;
  }
  return result;
}

function computeWideHash(market, concept, timeframe, direction, params) {
  const canon = canonicalConceptName(concept);
  const tf = (timeframe || "").toString().toLowerCase().trim();
  const dir = (direction || "long").toString().toLowerCase().trim();
  const p = params || {};
  const pairs = Object.keys(p).sort().map((k) => {
    const v = p[k];
    let s;
    if (typeof v === "number") s = Number.isFinite(v) ? (Math.round(v*10000)/10000).toString() : String(v);
    else if (v == null) s = "null";
    else if (typeof v === "object") s = JSON.stringify(v);
    else s = String(v).toLowerCase();
    return `${k}=${s}`;
  }).join(";");
  return createHash("sha256").update(`v2|${market}|${canon}|${tf}|${dir}|${pairs}`, "utf8").digest("hex").slice(0, 32);
}

(async () => {
  try {
    console.log(`MODE: ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}\n`);

    // Phase 1 — backfill
    console.log("══ Phase 1: Backfill wide_fingerprint_hash for existing buckets ══");
    const buckets = await sql`
      SELECT b.id AS bucket_id, b.concept_name, b.market, b.graduated_strategy_id, b.wide_fingerprint_hash,
             s.config, s.name AS strategy_name, s.created_at
      FROM strategy_pending_buckets b
      JOIN strategies s ON s.id = b.graduated_strategy_id
      WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
      ORDER BY s.created_at ASC
    `;
    console.log(`Buckets with graduated strategies: ${buckets.length}`);

    const computed = [];
    for (const b of buckets) {
      const c = b.config || {};
      const tf = c.strategy?.timeframe ?? null;
      const dir = c.direction ?? "long";
      const params = c.entry_params ?? {};
      const concept = b.concept_name || b.strategy_name;
      const hash = computeWideHash(b.market, concept, tf, dir, params);
      computed.push({ ...b, computedHash: hash, tf, dir });
    }

    if (APPLY) {
      let written = 0;
      for (const r of computed) {
        if (r.wide_fingerprint_hash !== r.computedHash) {
          await sql`UPDATE strategy_pending_buckets SET wide_fingerprint_hash = ${r.computedHash} WHERE id = ${r.bucket_id}`;
          written++;
        }
      }
      console.log(`Backfilled ${written} buckets with wide_fingerprint_hash`);
    } else {
      const wouldWrite = computed.filter((r) => r.wide_fingerprint_hash !== r.computedHash).length;
      console.log(`Would backfill ${wouldWrite} buckets (dry run)`);
    }

    // Phase 2 — detect clusters
    console.log("\n══ Phase 2: Detect duplicate clusters ══");
    const clusters = new Map();
    for (const r of computed) {
      if (!clusters.has(r.computedHash)) clusters.set(r.computedHash, []);
      clusters.get(r.computedHash).push(r);
    }
    const dupClusters = [...clusters.values()].filter((g) => g.length > 1);
    console.log(`Total wide-fingerprint groups: ${clusters.size}`);
    console.log(`Duplicate clusters (>1 strategy):  ${dupClusters.length}`);
    let totalDupes = 0;
    for (const g of dupClusters) totalDupes += g.length - 1; // keep 1 in each cluster
    console.log(`Total textual-duplicate strategies (to archive): ${totalDupes}`);

    console.log("\n── Cluster details ──");
    for (const g of dupClusters) {
      g.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      console.log(`\nCluster hash ${g[0].computedHash} — ${g.length} strategies, KEEP oldest:`);
      g.forEach((r, i) => {
        const verdict = i === 0 ? "✓ KEEP (oldest)" : "✗ ARCHIVE";
        console.log(`  ${verdict.padEnd(20)} ${r.strategy_name}  tf=${r.tf}  created=${new Date(r.created_at).toISOString().slice(0,10)}`);
      });
    }

    // Phase 3 — archive duplicates
    if (dupClusters.length > 0) {
      console.log(`\n══ Phase 3: ${APPLY ? "Archive" : "Would archive"} ${totalDupes} textual duplicates ══`);
      if (APPLY) {
        let archivedCount = 0;
        for (const g of dupClusters) {
          const keeper = g[0];
          for (const dupe of g.slice(1)) {
            // Tag the strategy as archived_duplicate
            await sql`
              UPDATE strategies
              SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['archived_duplicate']))
              WHERE id = ${dupe.graduated_strategy_id}
            `;
            // Write audit row
            await sql`
              INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
              VALUES (
                'strategy.archived_textual_duplicate',
                'strategy',
                ${dupe.graduated_strategy_id},
                ${sql.json({ strategy_name: dupe.strategy_name, wide_fingerprint: dupe.computedHash, cluster_size: g.length })},
                ${sql.json({ kept_strategy_id: keeper.graduated_strategy_id, kept_strategy_name: keeper.strategy_name })},
                'success',
                'system'
              )
            `;
            archivedCount++;
          }
        }
        console.log(`Archived ${archivedCount} strategies (tagged 'archived_duplicate')`);
      }
    } else {
      console.log("\nNo duplicate clusters — nothing to archive.");
    }

    console.log("\n══ Summary ══");
    console.log(`Total graduated strategies: ${buckets.length}`);
    console.log(`After dedup: ${buckets.length - totalDupes} unique edges`);
    console.log(`Mode: ${APPLY ? "APPLIED" : "DRY RUN — re-run with --apply to execute"}`);
  } finally {
    await sql.end();
  }
})();
