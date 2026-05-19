/**
 * Pass 21 — sweep pending buckets that now qualify under the silver-path
 * graduation gate (source_count ≥3, distinct_providers ≥2, layers ≥2).
 *
 * Buckets that accumulated their mentions before the silver-path code shipped
 * never got the new check fired. This script re-evaluates them all and flips
 * those that qualify to status='graduating' so the rest of the graduation
 * pipeline (journal insert → drain → strategy compile) runs.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const cands = await sql<Array<{
    id: string;
    concept_name: string;
    source_count: number;
    distinct_providers: number;
    layer_coverage_json: Record<string, boolean> | null;
  }>>`
    SELECT id::text, concept_name, source_count, distinct_providers, layer_coverage_json
    FROM strategy_pending_buckets
    WHERE status='pending' AND source_count >= 3 AND distinct_providers >= 2
  `;
  console.log(`Found ${cands.length} candidates with src≥3 & prov≥2`);

  let promoted = 0;
  for (const b of cands) {
    const lc = b.layer_coverage_json || {};
    const layersCovered = (lc.web ? 1 : 0) + (lc.youtube ? 1 : 0) + (lc.reddit ? 1 : 0);
    if (layersCovered < 2) {
      console.log(`  skip ${b.id.slice(0, 8)} ${b.concept_name.slice(0, 40)}: only ${layersCovered} layer(s)`);
      continue;
    }
    // Pick the best mention (highest extraction confidence or first cross-validated)
    const best = await sql<Array<{ extracted_idea: any }>>`
      SELECT extracted_idea
      FROM strategy_pending_mentions
      WHERE bucket_id=${b.id} AND extracted_idea IS NOT NULL
      ORDER BY (CASE WHEN is_cross_validation_result THEN 0 ELSE 1 END), created_at ASC
      LIMIT 1
    `;
    if (best.length === 0) {
      console.log(`  skip ${b.id.slice(0, 8)} ${b.concept_name.slice(0, 40)}: no mention with extracted_idea`);
      continue;
    }
    const ideaPayload = { ...best[0].extracted_idea, source_provider: "graduated_bucket", bucket_id: b.id };

    // POST to /scout-ideas/strict so the rest of the graduation chain runs.
    // Strict rate-limit on /api/agent is 30/min; we space POSTs by 3s + retry on 429.
    const port = process.env.PORT ?? "4000";
    const apiKey = process.env.INTERNAL_API_KEY ?? process.env.API_KEY ?? "";
    let strictOk = false;
    for (let attempt = 0; attempt < 3 && !strictOk; attempt++) {
      try {
        const res = await fetch(`http://localhost:${port}/api/agent/scout-ideas/strict`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ ideas: [ideaPayload] }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) { strictOk = true; break; }
        if (res.status === 429) {
          const body = await res.text().catch(() => "");
          const m = body.match(/retryAfterSec":(\d+)/);
          const wait = m ? Number(m[1]) * 1000 : 5000;
          console.log(`  rate-limited on ${b.id.slice(0, 8)}, retrying after ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        console.log(`  strict POST failed for ${b.id.slice(0, 8)}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        break;
      } catch (e: any) {
        console.log(`  strict POST error for ${b.id.slice(0, 8)}: ${e.message}`);
        break;
      }
    }
    // Space subsequent POSTs by 3s to stay under 30/min cap
    await new Promise((r) => setTimeout(r, 3000));

    if (strictOk) {
      // Now flip bucket to graduated
      const r = await sql`
        UPDATE strategy_pending_buckets
        SET status='graduated', graduated_at=NOW()
        WHERE id=${b.id} AND status='pending'
        RETURNING id::text
      `;
      if (r.length > 0) {
        promoted++;
        console.log(`  GRADUATED ${b.id.slice(0, 8)} ${b.concept_name.slice(0, 50)} (src=${b.source_count} prov=${b.distinct_providers} layers=${layersCovered})`);
      }
    }
  }
  console.log(`\nSilver-path graduated: ${promoted} buckets`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
