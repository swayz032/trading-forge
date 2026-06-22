/**
 * Pass 21 Fix #3 — re-canonicalize existing pending buckets.
 *
 * Track M's canonicalConceptName() only applies to NEW buckets. Pre-Track-M
 * buckets have fragmented names (opening_range_breakout_orb, orb_open_range_breakout,
 * etc.) that never converge. This script:
 *
 *   1. For each pending bucket, compute new canonical concept_name.
 *   2. Group by (market, new_canonical).
 *   3. For each group with >1 bucket: pick winner (oldest), merge layer_coverage_json
 *      (OR), sum source_count, union distinct_providers, repoint mentions to winner,
 *      DELETE loser buckets.
 *   4. Update winner's concept_name and fingerprint_hash to canonical form.
 *
 * Idempotent — safe to re-run. Wrapped in a transaction per group.
 *
 * Usage: npx tsx scripts/recanonicalize-pending-buckets.ts
 */
import "dotenv/config";
import postgres from "postgres";
import { canonicalConceptName, computeConceptFingerprintHash } from "../src/server/services/strategy-fingerprint.js";

const sql = postgres(process.env.DATABASE_URL!);

interface Bucket {
  id: string;
  market: string;
  concept_name: string | null;
  fingerprint_hash: string;
  source_count: number;
  distinct_providers: number;
  layer_coverage_json: Record<string, boolean> | null;
  first_seen_at: Date;
  status: string;
}

async function main() {
  const rows = await sql<Bucket[]>`
    SELECT id, market, concept_name, fingerprint_hash, source_count, distinct_providers,
           layer_coverage_json, first_seen_at, status
    FROM strategy_pending_buckets
    WHERE status = 'pending' AND concept_name IS NOT NULL
    ORDER BY first_seen_at ASC
  `;
  console.log(`Loaded ${rows.length} pending buckets`);

  const groups = new Map<string, Bucket[]>();
  for (const b of rows) {
    if (!b.concept_name) continue;
    const canonical = canonicalConceptName(b.concept_name);
    if (!canonical) continue;
    const key = `${b.market}|${canonical}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }

  let merged = 0;
  let renamed = 0;
  for (const [key, members] of groups) {
    const [, canonical] = key.split("|");
    if (!canonical) continue;
    members.sort((a, b) => a.first_seen_at.getTime() - b.first_seen_at.getTime());
    const winner = members[0];
    const losers = members.slice(1);

    if (losers.length === 0) {
      if (winner.concept_name !== canonical) {
        const newHash = computeConceptFingerprintHash({ market: winner.market, concept_name: canonical });
        await sql`UPDATE strategy_pending_buckets SET concept_name = ${canonical}, fingerprint_hash = ${newHash} WHERE id = ${winner.id}`;
        renamed++;
      }
      continue;
    }

    const mergedLayers = { web: false, youtube: false, reddit: false };
    let totalSourceCount = 0;
    const providerSet = new Set<string>();
    for (const m of members) {
      const lc = m.layer_coverage_json || {};
      if (lc.web) mergedLayers.web = true;
      if (lc.youtube) mergedLayers.youtube = true;
      if (lc.reddit) mergedLayers.reddit = true;
      totalSourceCount += m.source_count || 0;
      const provRows = await sql<{ source_provider: string }[]>`
        SELECT DISTINCT source_provider FROM strategy_pending_mentions WHERE bucket_id = ${m.id}
      `;
      for (const r of provRows) providerSet.add(r.source_provider);
    }
    const newHash = computeConceptFingerprintHash({ market: winner.market, concept_name: canonical });

    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as typeof sql;
      for (const loser of losers) {
        await tx`UPDATE strategy_pending_mentions SET bucket_id = ${winner.id} WHERE bucket_id = ${loser.id}`;
        await tx`DELETE FROM strategy_pending_buckets WHERE id = ${loser.id}`;
      }
      await tx`
        UPDATE strategy_pending_buckets
        SET concept_name = ${canonical},
            fingerprint_hash = ${newHash},
            source_count = ${totalSourceCount},
            distinct_providers = ${providerSet.size},
            layer_coverage_json = ${sql.json(mergedLayers)},
            last_seen_at = NOW()
        WHERE id = ${winner.id}
      `;
    });
    merged++;
    console.log(`  merged ${losers.length} → ${canonical} (winner ${winner.id.slice(0, 8)}, layers=${JSON.stringify(mergedLayers)})`);
  }

  console.log(`\nDone. ${merged} groups merged, ${renamed} solo buckets renamed.`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
