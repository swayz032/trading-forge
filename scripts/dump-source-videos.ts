/**
 * dump-source-videos.ts (2026-07-02) — resolve the library's UNIQUE YouTube source videos for re-extraction.
 *
 * The 117 strategies are THIN old-extractor outputs of ~40 unique videos (split ×3 symbols MCL/MES/MNQ for
 * testing). The re-extraction corpus is the UNIQUE VIDEO list, not the strategy list. Uses the Wave-26
 * strategy-source-resolver (4-path resolution) and dedupes to video IDs.
 *
 * Usage: npx tsx scripts/dump-source-videos.ts > docs/designs/source-videos-2026-07-02.json
 */
import { getAllStrategiesWithUrls } from "../src/server/lib/strategy-source-resolver.js";

const YT = /(?:v=|youtu\.be\/|\/watch\?v=|embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/;

async function main(): Promise<void> {
  const rows = await getAllStrategiesWithUrls();
  const videos = new Map<string, string[]>(); // videoId -> strategy names
  let unresolved: string[] = [];
  for (const r of rows) {
    let hit = false;
    for (const u of r.urls) {
      const m = (u || "").match(YT);
      if (m) {
        const list = videos.get(m[1]) ?? [];
        list.push(r.name);
        videos.set(m[1], list);
        hit = true;
      }
    }
    if (!hit) unresolved.push(r.name);
  }
  const out = {
    strategies: rows.length,
    unique_videos: videos.size,
    unresolved_strategies: unresolved,
    videos: Object.fromEntries([...videos.entries()].map(([id, names]) => [id, { strategies: names }])),
  };
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
