/**
 * W23F.O — Bucket Graduation Sweep
 *
 * Discovered 2026-05-19: 173 buckets at ≥3 sources with full layer coverage are
 * sitting in queue, never graduated. Root cause: graduation is event-triggered
 * only on `pending_bucket.mention_added` crossing the threshold. Buckets that
 * crossed during corruption/recovery or before the W23F factory shipped never
 * got re-triggered. No sweep job existed.
 *
 * This sweep:
 *   1. Finds all eligible-but-not-graduated buckets
 *   2. Invokes runGraduation() on each (gates still apply — sweep doesn't bypass)
 *   3. Logs results
 *
 * Run once via: npx tsx scripts/w23f-bucket-graduation-sweep.ts
 * Or wire into scheduler as a daily cron (see scheduler.ts addition).
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { ssl: { rejectUnauthorized: false } });
const API = process.env.TF_API_URL ?? "http://127.0.0.1:4000";

interface StuckBucket {
  id: string;
  market: string;
  concept_name: string;
  source_count: number;
  distinct_providers: number;
  layer_coverage_json: { web?: boolean; reddit?: boolean; youtube?: boolean };
}

async function main() {
  console.log("=== W23F.O Bucket Graduation Sweep ===\n");

  // Find buckets eligible per the graduator's fast-graduation path:
  //   source_count >= 3 AND distinct_providers >= 2 AND >= 2 layers confirmed
  //   AND graduated_strategy_id IS NULL AND lifecycle not killed
  const rows = await sql<StuckBucket[]>`
    SELECT id::text, market, concept_name, source_count, distinct_providers, layer_coverage_json
    FROM strategy_pending_buckets
    WHERE graduated_strategy_id IS NULL
      AND source_count >= 3
      AND distinct_providers >= 2
      AND (
        (layer_coverage_json->>'web' = 'true' AND layer_coverage_json->>'reddit' = 'true') OR
        (layer_coverage_json->>'web' = 'true' AND layer_coverage_json->>'youtube' = 'true') OR
        (layer_coverage_json->>'reddit' = 'true' AND layer_coverage_json->>'youtube' = 'true')
      )
      AND last_seen_at > NOW() - INTERVAL '30 days'
    ORDER BY source_count DESC, last_seen_at DESC
  `;

  console.log(`Found ${rows.length} stuck buckets ready to graduate.\n`);
  if (rows.length === 0) { await sql.end(); return; }

  // Trigger graduation via the admin route — the same code path mention-added uses
  let attempted = 0, errored = 0;
  for (const b of rows) {
    attempted++;
    try {
      // Use the graduator's HTTP endpoint to trigger — bypasses needing direct import
      const res = await fetch(`${API}/api/agent/pending-buckets/${b.id}/graduate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "W23F.O sweep — backlog cleanup" }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; strategy_id?: string; reason?: string; skipped?: boolean };
      const tag = res.status === 200 ? (body.skipped ? "SKIP" : "OK") : "FAIL";
      console.log(`  ${tag.padEnd(4)} ${b.market} | ${b.concept_name.slice(0, 42).padEnd(42)} | src=${b.source_count} | ${body.status ?? body.reason ?? `HTTP ${res.status}`}`);
    } catch (e) {
      errored++;
      console.log(`  ERR  ${b.market} | ${b.concept_name.slice(0, 42).padEnd(42)} | ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 250)); // 250ms throttle to avoid LLM rate-limit
  }

  console.log(`\n=== Summary ===`);
  console.log(`Attempted : ${attempted}`);
  console.log(`Errored   : ${errored}`);
  console.log(`Run again after a few minutes to see how many graduated cleanly.`);

  await sql.end();
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
