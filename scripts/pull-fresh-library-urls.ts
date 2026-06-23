/**
 * Pull FRESH YouTube video IDs from the library — strategies whose source video is NOT in the
 * curated 10-video benchmark. Generalization test: prove extraction works on unsampled videos,
 * not just the benchmark (operator: "general 100% extraction capability is not established by a
 * 10-video benchmark alone").
 */
import "dotenv/config";
import { getAllStrategiesWithUrls } from "../src/server/lib/strategy-source-resolver.js";

const BENCHMARK = new Set([
  "rf_EQvubKlk", "FqxEKDxemtI", "UBvfsImdI2U", "z3Qn3fBoe2I", "iU8ww5MC2FQ",
  "SY2jXlW9bt4", "gddYspvW0_w", "ktkqq7QsN9Q", "N7uP9V0Iktc", "75DJN5UVQnw",
]);

function ytId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|watch\?v=|\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const all = await getAllStrategiesWithUrls();
const seen = new Map<string, { name: string; url: string }>();
for (const s of all as Array<{ name?: string; sourceUrl?: string; source_url?: string; url?: string }>) {
  const url = s.sourceUrl || s.source_url || s.url || "";
  const id = ytId(url);
  if (!id || BENCHMARK.has(id) || seen.has(id)) continue;
  seen.set(id, { name: s.name ?? "?", url });
}

const fresh = [...seen.entries()];
console.error(`Total strategies: ${all.length} | distinct YouTube source videos: ${seen.size + BENCHMARK.size} | FRESH (non-benchmark): ${fresh.length}`);
for (const [id, info] of fresh) {
  console.log(`${id}\t${info.name}\t${info.url}`);
}
process.exit(0);
