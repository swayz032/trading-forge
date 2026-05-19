/**
 * Pass 21 — pairwise comparison of strategies within each archetype cluster.
 * Reads the actual DSL (timeframe, direction, entry_indicator, entry_long,
 * entry_params) and reports concretely where two strategies differ vs. where
 * they're literally identical at the rule level.
 *
 * Output: for each cluster, a table of which fields differ.
 * Verdict per pair:
 *   IDENTICAL    — same rule, same params → textual dupe, archive
 *   PARAM_DIFF   — different entry_params or indicator periods → real variant
 *   TF_DIFF      — different timeframe → real variant
 *   DIR_DIFF     — different direction → real variant
 *   RULE_DIFF    — different entry_long prose → ambiguous, inspect
 */
require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function archetype(name) {
  if (/orb|opening_range/i.test(name)) return "ORB";
  if (/holy_grail/i.test(name)) return "Raschke Holy Grail";
  if (/rsi_?2|rsi2|connors/i.test(name)) return "Connors RSI-2";
  if (/supertrend/i.test(name)) return "Supertrend";
  if (/volume_profile|poc|vah|val/i.test(name)) return "Volume Profile";
  if (/bollinger/i.test(name)) return "Bollinger";
  if (/fvg|fair_value_gap/i.test(name)) return "FVG";
  if (/inside_bar|nr4|nr7/i.test(name)) return "Inside Bar";
  if (/macd/i.test(name)) return "MACD";
  if (/liquidity_sweep|ict|smc|choch/i.test(name)) return "ICT/SMC";
  if (/vwap/i.test(name)) return "VWAP";
  if (/stochastic/i.test(name)) return "Stochastic";
  if (/keltner|donchian/i.test(name)) return "Channel";
  if (/(^|_)ema(_|$)|moving_average/i.test(name)) return "EMA-based";
  if (/asian|session/i.test(name)) return "Session";
  if (/mean_reversion|reversal/i.test(name)) return "Mean Reversion";
  if (/squeeze/i.test(name)) return "Squeeze";
  if (/pivot/i.test(name)) return "Pivot";
  return null;  // singletons skipped
}

function extractRuleSignature(s) {
  const c = s.config || {};
  const strat = c.strategy || {};
  return {
    timeframe: strat.timeframe ?? c.timeframe ?? null,
    direction: c.direction ?? "long",
    entry_indicator: (strat.indicators && strat.indicators[0]?.type) || strat.entry_indicator || null,
    entry_long: (strat.entry_long || "").slice(0, 300).trim(),
    entry_params: c.entry_params || {},
  };
}

function compareSigs(a, b) {
  const diffs = [];
  if (a.timeframe !== b.timeframe) diffs.push(`TF (${a.timeframe} vs ${b.timeframe})`);
  if (a.direction !== b.direction) diffs.push(`DIR (${a.direction} vs ${b.direction})`);
  if (a.entry_indicator !== b.entry_indicator) diffs.push(`INDICATOR (${a.entry_indicator} vs ${b.entry_indicator})`);
  const paramsA = JSON.stringify(a.entry_params || {});
  const paramsB = JSON.stringify(b.entry_params || {});
  if (paramsA !== paramsB) diffs.push(`PARAMS (${paramsA} vs ${paramsB})`);
  // Normalize entry_long for comparison — strip case + whitespace
  const ruleA = a.entry_long.toLowerCase().replace(/\s+/g, " ").trim();
  const ruleB = b.entry_long.toLowerCase().replace(/\s+/g, " ").trim();
  const ruleSame = ruleA === ruleB;
  if (!ruleSame) {
    // Compute rough similarity (token overlap)
    const tokA = new Set(ruleA.split(/\W+/).filter((t) => t.length > 2));
    const tokB = new Set(ruleB.split(/\W+/).filter((t) => t.length > 2));
    const overlap = [...tokA].filter((t) => tokB.has(t)).length;
    const total = new Set([...tokA, ...tokB]).size;
    const sim = total > 0 ? (overlap / total) : 0;
    diffs.push(`RULE_PROSE (similarity ${(sim*100).toFixed(0)}%)`);
  }
  return { diffs, ruleSame };
}

(async () => {
  try {
    const rows = await sql`
      SELECT id, name, config, created_at
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
      ORDER BY created_at ASC
    `;
    console.log(`Comparing ${rows.length} active graduated strategies\n`);

    // Group by archetype
    const groups = new Map();
    for (const r of rows) {
      const arch = archetype(r.name);
      if (!arch) continue;
      if (!groups.has(arch)) groups.set(arch, []);
      groups.get(arch).push(r);
    }

    // Only show clusters with >1 strategy
    const dupClusters = [...groups.entries()].filter(([, g]) => g.length > 1);
    console.log(`Clusters with >1 active strategy: ${dupClusters.length}\n`);
    console.log("══════════════════════════════════════════════════════");

    const recommendations = { archive: [], keep_variant: [], inspect: [] };

    for (const [arch, group] of dupClusters) {
      console.log(`\n▼ ${arch}  (${group.length} active strategies)`);

      // Extract signatures
      const sigs = group.map((s) => ({ ...s, sig: extractRuleSignature(s) }));

      // Print each strategy's rule signature
      for (const s of sigs) {
        console.log(`\n  [${s.id.slice(0,8)}] ${s.name}`);
        console.log(`     timeframe: ${s.sig.timeframe}  direction: ${s.sig.direction}  indicator: ${s.sig.entry_indicator}`);
        console.log(`     params:    ${JSON.stringify(s.sig.entry_params)}`);
        console.log(`     entry_long: "${s.sig.entry_long.slice(0,160)}${s.sig.entry_long.length > 160 ? '...' : ''}"`);
      }

      // Pairwise comparison
      console.log("\n  Pairwise diff:");
      for (let i = 0; i < sigs.length; i++) {
        for (let j = i+1; j < sigs.length; j++) {
          const cmp = compareSigs(sigs[i].sig, sigs[j].sig);
          const labelA = sigs[i].name.slice(0,40);
          const labelB = sigs[j].name.slice(0,40);
          if (cmp.diffs.length === 0) {
            console.log(`    DUPE      ${labelA}  ==  ${labelB}`);
            // Add the YOUNGER (created later) one to archive list
            const younger = new Date(sigs[i].created_at) < new Date(sigs[j].created_at) ? sigs[j] : sigs[i];
            if (!recommendations.archive.find((x) => x.id === younger.id)) {
              recommendations.archive.push({ id: younger.id, name: younger.name, reason: `identical_rules_as_${(younger === sigs[i] ? sigs[j] : sigs[i]).name}` });
            }
          } else if (cmp.diffs.length === 1 && cmp.diffs[0].startsWith("RULE_PROSE")) {
            const sim = parseInt(cmp.diffs[0].match(/(\d+)%/)?.[1] || "0");
            if (sim >= 70) {
              console.log(`    LIKELY_DUPE  (rule similarity ${sim}%, all other fields match)  ${labelA}  ~~  ${labelB}`);
              const younger = new Date(sigs[i].created_at) < new Date(sigs[j].created_at) ? sigs[j] : sigs[i];
              if (!recommendations.archive.find((x) => x.id === younger.id)) {
                recommendations.archive.push({ id: younger.id, name: younger.name, reason: `${sim}%_rule_similarity_to_${(younger === sigs[i] ? sigs[j] : sigs[i]).name}` });
              }
            } else {
              console.log(`    INSPECT      (rule similarity ${sim}%, all other fields match)  ${labelA}  ??  ${labelB}`);
              recommendations.inspect.push({ a: sigs[i].name, b: sigs[j].name, similarity: sim });
            }
          } else {
            console.log(`    REAL_VARIANT  ${labelA}  ≠  ${labelB}  [${cmp.diffs.join("; ")}]`);
            if (!recommendations.keep_variant.find((x) => x.a === sigs[i].name && x.b === sigs[j].name)) {
              recommendations.keep_variant.push({ a: sigs[i].name, b: sigs[j].name, diffs: cmp.diffs });
            }
          }
        }
      }
    }

    console.log("\n\n══════════════════════════════════════════════════════");
    console.log("RECOMMENDATIONS");
    console.log("══════════════════════════════════════════════════════");
    console.log(`\nArchive (true duplicates):    ${recommendations.archive.length}`);
    for (const r of recommendations.archive) {
      console.log(`  ✗ ${r.name}`);
      console.log(`     reason: ${r.reason}`);
    }
    console.log(`\nKeep as real variants:        ${recommendations.keep_variant.length} pairs preserved`);
    console.log(`\nNeeds human inspection:       ${recommendations.inspect.length} pairs`);
    for (const r of recommendations.inspect) {
      console.log(`  ? ${r.a}  vs  ${r.b}  (sim ${r.similarity}%)`);
    }
    console.log(`\nAfter applying: ${rows.length} - ${recommendations.archive.length} = ${rows.length - recommendations.archive.length} active strategies`);
  } finally {
    await sql.end();
  }
})();
