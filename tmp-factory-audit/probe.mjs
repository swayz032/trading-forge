import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
try {
  console.log("=== ACTIVE STRATEGIES (by market) ===");
  const strats = await sql`
    SELECT name, symbol, timeframe, config->>'direction' AS direction, lifecycle_state, created_at
    FROM strategies WHERE archived_at IS NULL ORDER BY created_at DESC`;
  for (const s of strats) console.log(`  ${s.symbol}/${(s.timeframe||'').padEnd(4)} | ${(s.direction||'?').padEnd(5)} | ${s.name} | ${s.lifecycle_state}`);
  const byMarket = await sql`SELECT symbol, COUNT(*)::int n FROM strategies WHERE archived_at IS NULL GROUP BY symbol`;
  console.log("  Market distribution (active):");
  for (const r of byMarket) console.log(`    ${r.symbol}: ${r.n}`);

  console.log("\n=== BUCKETS BY MARKET (all-time + last 24h) ===");
  const bucketAll = await sql`SELECT market, COUNT(*)::int n FROM strategy_pending_buckets GROUP BY market ORDER BY n DESC`;
  for (const r of bucketAll) console.log(`  ${r.market}: ${r.n} buckets total`);
  const bucket24h = await sql`SELECT market, COUNT(*)::int n FROM strategy_pending_buckets WHERE last_seen_at > NOW() - INTERVAL '24 hours' GROUP BY market ORDER BY n DESC`;
  console.log("  Buckets active in last 24h:");
  for (const r of bucket24h) console.log(`    ${r.market}: ${r.n}`);

  console.log("\n=== MENTIONS WITH RICH DSL (entry_indicator + entry_params populated) ===");
  const richTotal = await sql`
    SELECT COUNT(*)::int n FROM strategy_pending_mentions
    WHERE jsonb_typeof(extracted_idea->'entry_params')='object'
      AND extracted_idea->'entry_params' != '{}'::jsonb
      AND extracted_idea ? 'entry_indicator'`;
  console.log(`  Total rich mentions in DB: ${richTotal[0].n}  (was 0 pre-Wave-16/17/18)`);

  const rich24h = await sql`
    SELECT COUNT(*)::int n FROM strategy_pending_mentions
    WHERE jsonb_typeof(extracted_idea->'entry_params')='object'
      AND extracted_idea->'entry_params' != '{}'::jsonb
      AND extracted_idea ? 'entry_indicator'
      AND created_at > NOW() - INTERVAL '24 hours'`;
  console.log(`  Rich mentions in last 24h: ${rich24h[0].n}`);

  console.log("\n=== SAMPLE RICH MENTIONS (post-Wave-16/17/18 — last 10) ===");
  const sample = await sql`
    SELECT scout_layer, source_provider,
           extracted_idea->>'entry_indicator' AS ind,
           extracted_idea->'entry_params' AS params,
           extracted_idea->>'direction' AS dir,
           created_at
    FROM strategy_pending_mentions
    WHERE jsonb_typeof(extracted_idea->'entry_params')='object'
      AND extracted_idea->'entry_params' != '{}'::jsonb
      AND extracted_idea ? 'entry_indicator'
    ORDER BY created_at DESC LIMIT 10`;
  if (sample.length === 0) console.log("  (NONE — Wave 16/17/18 are loaded but no scout cycles have run since)");
  for (const m of sample) console.log(`  ${m.created_at.toISOString().slice(0,19)} | ${m.scout_layer.padEnd(8)} | ind=${m.ind?.padEnd(20)} | params=${JSON.stringify(m.params)?.slice(0,40)} | dir=${m.dir}`);

  console.log("\n=== SCOUT CYCLE ACTIVITY (audit_log) — last 24h ===");
  const cycleAudit = await sql`
    SELECT action, COUNT(*)::int n FROM audit_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND (action LIKE 'graduation.%' OR action='strategy.cross_validated' OR action='scout_extract.empty_reasoned' OR action='scout_extract.contract_remap_scaled')
    GROUP BY action ORDER BY n DESC`;
  for (const r of cycleAudit) console.log(`  ${r.action}: ${r.n}`);
} finally { await sql.end(); }
