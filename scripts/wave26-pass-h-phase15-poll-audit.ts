/**
 * Poll audit_log for dE4lPhAWke8 re-ingest evidence.
 */
import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const corrId = "66bcbffc-74ab-4e5b-a359-161d638b2dd8";
  const r: any = await db.execute(sql`
    SELECT action, status, created_at, correlation_id, input, result
    FROM audit_log
    WHERE created_at > NOW() - INTERVAL '15 minutes'
      AND (
           correlation_id = ${corrId}
        OR input::text LIKE '%dE4lPhAWke8%'
        OR result::text LIKE '%dE4lPhAWke8%'
        OR input::text LIKE ${'%' + corrId + '%'}
        OR result::text LIKE ${'%' + corrId + '%'}
        OR (action IN ('scout.operator_ingested',
                       'scout.ideas_merged_under_archetype',
                       'scout.single_idea_sub_layer_rerouted',
                       'graduation.entry_quality_attached',
                       'graduation.factor_quality_classified',
                       'graduation.thin_confluence_warning',
                       'graduation.rejected_incomplete_bidirectional',
                       'graduation.bidirectional_incomplete_rejected',
                       'extraction.config_used',
                       'extraction.parity_test_run')
            AND created_at > NOW() - INTERVAL '5 minutes')
      )
    ORDER BY created_at DESC
    LIMIT 100
  `);
  console.log("=== AUDIT ROWS ===");
  for (const row of r as any[]) {
    const inP = JSON.stringify(row.input).slice(0, 240);
    const resP = JSON.stringify(row.result).slice(0, 240);
    console.log(`[${row.created_at}] ${row.action} (${row.status}) corr=${row.correlation_id ?? '-'}`);
    console.log(`  in:  ${inP}`);
    console.log(`  res: ${resP}`);
  }
  console.log("=== TOTAL AUDIT ROWS ===", (r as any[]).length);

  const stratR: any = await db.execute(sql`
    SELECT id, name, symbol, timeframe, archived_at, config->>'source_url' as src_url,
           config->>'source_bucket_id' as src_bid,
           config->>'entry_indicator' as ei,
           config->>'entry_archetype' as ea,
           config->'entry_quality'->>'factor_quality' as fq,
           length(config->'entry_quality'->>'factor_quality') as fq_len,
           config->'entry_quality'->'confluence_factors' as factors,
           config->'entry_quality'->'factor_sources' as fsrc
    FROM strategies
    WHERE config->>'source_url' LIKE '%dE4lPhAWke8%'
    ORDER BY symbol
  `);
  console.log("=== STRATEGIES FROM dE4lPhAWke8 (all) ===");
  console.log(JSON.stringify(stratR, null, 2));

  const bucketR: any = await db.execute(sql`
    SELECT id, concept_name, entry_archetype, market, status, graduated_strategy_id, layer_coverage_json
    FROM strategy_pending_buckets WHERE id::text = 'a82de33b-9822-40f5-bc31-907f9ffcbfd7'
  `);
  console.log("=== BUCKET a82de33b STATUS ===");
  console.log(JSON.stringify(bucketR, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
