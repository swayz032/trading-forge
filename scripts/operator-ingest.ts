/**
 * Operator video ingest — submit one or more YouTube URLs to the strategy factory.
 *
 * Usage:
 *   npx tsx scripts/operator-ingest.ts <url1> [<url2> ...]
 *   npx tsx scripts/operator-ingest.ts --file urls.txt
 *
 * URLs go through the FULL Wave 23H factory:
 *   1. youtube-transcript fetch (no YouTube Data API quota burn)
 *   2. scout-extract LLM (v9 prompt + 4 postmortem fix waves)
 *   3. pending_mention write × 3 layers (operator IS the cross-validator)
 *   4. Graduator drain → strategies bucket entry (CANDIDATE state)
 *   5. Existing lifecycle gates still validate the strategy
 *
 * The operator's curation does NOT bypass quality gates — it bypasses ONLY
 * the keyword-based discovery layer. The strategy still has to backtest
 * profitably, pass A4 Frankenstein, A7 signal correlation, etc.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const API = process.env.TRADING_FORGE_API_URL ?? "http://127.0.0.1:4000";

function parseArgs(): { urls: string[]; file: string | null } {
  const argv = process.argv.slice(2);
  const urls: string[] = [];
  let file: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--file" || a === "-f") {
      file = argv[++i] ?? null;
    } else if (a.startsWith("http")) {
      urls.push(a);
    }
  }
  return { urls, file };
}

async function main() {
  const { urls: cliUrls, file } = parseArgs();
  let urls = cliUrls;

  if (file) {
    const content = readFileSync(file, "utf8");
    const fileUrls = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("http"));
    urls = [...urls, ...fileUrls];
  }

  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/operator-ingest.ts <url1> [<url2> ...]");
    console.error("       npx tsx scripts/operator-ingest.ts --file urls.txt");
    process.exit(1);
  }
  if (urls.length > 20) {
    console.error(`REFUSING: ${urls.length} URLs exceeds 20-URL token-budget cap. Split into batches.`);
    process.exit(1);
  }

  console.log(`Submitting ${urls.length} URL(s) to operator-ingest...\n`);

  const resp = await fetch(`${API}/api/admin/scout/operator-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
    signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min ceiling — full extraction is ~30s/video
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`API error HTTP ${resp.status}: ${err.slice(0, 300)}`);
    process.exit(1);
  }

  const body = await resp.json() as {
    correlation_id: string;
    total: number;
    ingested: number;
    results: Array<{
      url: string;
      video_id?: string;
      title?: string;
      status: string;
      idea_count?: number;
      reason?: string;
      error?: string;
      ideas?: Array<{ idea_name: string; entry_indicator: string; direction: string; layers: Record<string, { accepted: boolean; bucket_id?: string }> }>;
    }>;
    note: string;
  };

  console.log("=".repeat(78));
  console.log(`Correlation: ${body.correlation_id}`);
  console.log(`Ingested: ${body.ingested}/${body.total}`);
  console.log("=".repeat(78));

  for (const r of body.results) {
    const tag = r.status === "ingested" ? "✅" : "❌";
    console.log(`\n${tag} ${r.url}`);
    console.log(`   video_id: ${r.video_id ?? "—"}`);
    console.log(`   title: ${(r.title ?? "—").slice(0, 70)}`);
    console.log(`   status: ${r.status}${r.reason ? ` (${r.reason})` : ""}${r.error ? ` — ${r.error}` : ""}`);
    if (r.ideas?.length) {
      r.ideas.forEach((idea, i) => {
        const buckets = Object.values(idea.layers ?? {})
          .map((l: { bucket_id?: string }) => l.bucket_id?.slice(0, 8))
          .filter(Boolean);
        console.log(`     [${i}] ${idea.entry_indicator} dir=${idea.direction} → bucket ${buckets[0] ?? "—"}`);
      });
    }
  }

  console.log("\n" + body.note);
  console.log("\nWatch the bucket fill:");
  console.log("  npx tsx scripts/audit-graduated-strategy-dsls.ts");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
