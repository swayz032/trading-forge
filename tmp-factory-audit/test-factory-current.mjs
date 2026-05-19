import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: { rejectUnauthorized: false } });
try {
  console.log("\n========== W23F Factory Live Test — current DB state ==========\n");

  // 1) Last scout cycle started
  const cycles = await sql`
    SELECT created_at, correlation_id,
           result->>'cycle_index' AS cycle_index,
           result->>'seeded_symbol' AS seeded_symbol,
           result->>'query_count' AS query_count
    FROM audit_log
    WHERE action = 'scout_cycle.started'
    ORDER BY created_at DESC LIMIT 5`;
  console.log("=== scout_cycle.started (last 5) ===");
  if (cycles.length === 0) console.log("  (NONE — W23F.E audit emission not yet fired; service may need restart)");
  for (const c of cycles) console.log(`  ${c.created_at.toISOString()} | cycle=${c.cycle_index} seeded=${c.seeded_symbol ?? "—"} queries=${c.query_count ?? "—"} cid=${c.correlation_id?.slice(0,8)}`);

  // 2) Most recent mentions with rich confluence
  console.log("\n=== mentions with confluence_factors (W23F.B output, last 5) ===");
  const richMentions = await sql`
    SELECT created_at, scout_layer,
           extracted_idea->'confluence_factors' AS factors,
           extracted_idea->>'min_factors_satisfied' AS min_sat,
           extracted_idea->'symbols' AS symbols,
           extracted_idea->>'__scout_seeded_symbol' AS seeded
    FROM strategy_pending_mentions
    WHERE extracted_idea ? 'confluence_factors'
    ORDER BY created_at DESC LIMIT 5`;
  if (richMentions.length === 0) console.log("  (NONE — W23F.B prompt not yet active or no extractions since restart)");
  for (const m of richMentions) console.log(`  ${m.created_at.toISOString().slice(0,19)} | layer=${m.scout_layer} factors=${JSON.stringify(m.factors)} min=${m.min_sat} symbols=${JSON.stringify(m.symbols)} seeded=${m.seeded}`);

  // 3) Graduations with entry_quality (last 5)
  console.log("\n=== graduation.entry_quality_attached (last 5) ===");
  const grads = await sql`
    SELECT created_at, correlation_id, entity_id,
           result->>'confluence_factor_count' AS cf_count,
           result->>'provenance' AS provenance,
           result->>'symbols_count' AS sym_count,
           result->'symbols' AS symbols
    FROM audit_log
    WHERE action = 'graduation.entry_quality_attached'
    ORDER BY created_at DESC LIMIT 5`;
  if (grads.length === 0) console.log("  (NONE — no graduations since W23F.D shipped)");
  for (const g of grads) console.log(`  ${g.created_at.toISOString()} | cf=${g.cf_count} prov=${g.provenance} symcount=${g.sym_count} syms=${JSON.stringify(g.symbols)} cid=${g.correlation_id?.slice(0,8)}`);

  // 4) Multi-market graduations
  console.log("\n=== graduation.symbols_multi_market (all-time) ===");
  const multi = await sql`
    SELECT COUNT(*)::int n FROM audit_log WHERE action = 'graduation.symbols_multi_market'`;
  console.log(`  count: ${multi[0].n}`);

  // 5) Current active strategies — entry_quality + symbols populated?
  console.log("\n=== active strategies — entry_quality + symbols inspection ===");
  const strats = await sql`
    SELECT name, symbol, symbols,
           config->'entry_quality'->>'extraction_provenance' AS provenance,
           config->'entry_quality'->'confluence_factors' AS factors,
           config->'entry_quality'->>'min_factors_satisfied' AS min_sat,
           lifecycle_state
    FROM strategies WHERE archived_at IS NULL ORDER BY created_at DESC`;
  for (const s of strats) {
    console.log(`  ${s.name}`);
    console.log(`    symbol(legacy)=${s.symbol}  symbols(W23F.A)=${JSON.stringify(s.symbols)}`);
    console.log(`    provenance=${s.provenance ?? "<missing>"}  factors=${JSON.stringify(s.factors) ?? "<missing>"}  min_sat=${s.min_sat ?? "<missing>"}`);
    console.log(`    lifecycle=${s.lifecycle_state}`);
  }

  // 6) Rotation distribution — last 24h
  console.log("\n=== W23F.E rotation distribution (last 24h cycles) ===");
  const rot = await sql`
    SELECT result->>'seeded_symbol' AS sym, COUNT(*)::int n
    FROM audit_log
    WHERE action = 'scout_cycle.started' AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1 ORDER BY n DESC`;
  if (rot.length === 0) console.log("  (no cycles in last 24h — service may not be running W23F.E code yet)");
  for (const r of rot) console.log(`  ${r.sym ?? "<no seeded_symbol>"} : ${r.n}`);

  // 7) Bucket diversity post-W23F.E
  console.log("\n=== bucket markets last 24h (rotation effect) ===");
  const buck = await sql`
    SELECT market, COUNT(*)::int n
    FROM strategy_pending_buckets
    WHERE last_seen_at > NOW() - INTERVAL '24 hours'
    GROUP BY 1 ORDER BY n DESC`;
  for (const b of buck) console.log(`  ${b.market}: ${b.n}`);

  // 8) Empty-reasoned + reject rates (LLM quality post-W23F.B)
  console.log("\n=== extraction quality last 24h (post-W23F.B prompt) ===");
  const quality = await sql`
    SELECT action, COUNT(*)::int n
    FROM audit_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND action IN ('scout_extract.empty_reasoned','graduation.entry_quality_attached',
                     'graduation.rejected_thin_dsl','graduation.rejected_dsl_quality_critic',
                     'graduation.rejected_no_engine_indicator','strategy.cross_validated')
    GROUP BY 1 ORDER BY n DESC`;
  for (const q of quality) console.log(`  ${q.action}: ${q.n}`);

} finally { await sql.end(); }
