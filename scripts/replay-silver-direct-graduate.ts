/**
 * Pass 21 (2026-05-12) — replay graduation through the new direct-graduator
 * for buckets that are status='graduated' but graduated_strategy_id IS NULL.
 * These are the silver-path graduations that failed the old journal-drain chain.
 */
import "dotenv/config";
import postgres from "postgres";
import { graduateBucketDirectly } from "../src/server/services/direct-bucket-graduator.js";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const stuck = await sql<Array<{
    id: string;
    concept_name: string;
    market: "MES" | "MNQ" | "MCL";
    entry_archetype: string | null;
    exit_type: string | null;
    source_count: number;
    distinct_providers: number;
    layer_coverage_json: any;
  }>>`
    SELECT id::text, concept_name, market, entry_archetype, exit_type,
           source_count, distinct_providers, layer_coverage_json
    FROM strategy_pending_buckets
    WHERE status='graduated' AND graduated_strategy_id IS NULL
    ORDER BY last_seen_at DESC
  `;
  console.log(`Found ${stuck.length} silver-graduated buckets without strategies`);

  let landed = 0;
  for (const b of stuck) {
    const mentions = await sql<Array<{
      source_url: string;
      source_provider: string;
      scout_layer: string | null;
      extracted_idea: any;
    }>>`
      SELECT source_url, source_provider, scout_layer, extracted_idea
      FROM strategy_pending_mentions
      WHERE bucket_id = ${b.id}
      ORDER BY (extracted_idea IS NULL), created_at ASC
    `;
    if (mentions.length === 0) {
      console.log(`  skip ${b.id.slice(0, 8)}: no mentions`);
      continue;
    }
    const best = mentions.find((m) => m.extracted_idea) ?? mentions[0];

    const lc = b.layer_coverage_json || {};
    const layersCovered = (lc.web ? 1 : 0) + (lc.youtube ? 1 : 0) + (lc.reddit ? 1 : 0);
    const webUrls = mentions.filter((m) => m.scout_layer === "web").map((m) => m.source_url);
    const youtubeUrls = mentions.filter((m) => m.scout_layer === "youtube").map((m) => m.source_url);
    const redditUrls = mentions.filter((m) => m.scout_layer === "reddit").map((m) => m.source_url);
    const layerTags = ["cross-validated"];
    if (webUrls.length > 0) layerTags.push("web-confirmed");
    if (youtubeUrls.length > 0) layerTags.push("youtube-confirmed");
    if (redditUrls.length > 0) layerTags.push("reddit-confirmed");

    const r = await graduateBucketDirectly({
      bucketId: b.id,
      bestMention: {
        sourceUrl: best.source_url,
        sourceProvider: best.source_provider,
        scoutLayer: best.scout_layer,
        extractedIdea: best.extracted_idea ?? {},
      },
      bucketMeta: {
        conceptName: b.concept_name,
        market: b.market,
        entryArchetype: b.entry_archetype,
        exitType: b.exit_type,
      },
      sourceCount: b.source_count,
      distinctProviders: b.distinct_providers,
      layersCovered,
      layerTags,
      webUrls,
      youtubeUrls,
      redditUrls,
    });
    if (r.strategyId && !r.skipped) {
      landed++;
      console.log(`  LANDED ${b.id.slice(0, 8)} → strategy ${r.strategyId.slice(0, 8)} ${r.strategyName}`);
    } else if (r.skipped) {
      console.log(`  skip   ${b.id.slice(0, 8)}: ${r.reason} (existing strat ${r.strategyId?.slice(0, 8)})`);
    } else {
      console.log(`  FAIL   ${b.id.slice(0, 8)}: ${r.reason}`);
    }
  }
  console.log(`\nLanded ${landed} new strategies via direct graduator`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
