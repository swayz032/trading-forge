/**
 * Discover FRESH trading-strategy YouTube videos via the scout's Layer-2 path (Google YT Data API),
 * excluding the 10-video benchmark. Generalization test: prove extraction works on UNSAMPLED videos.
 * Applies the scout's title-scoring (+2 tutorial keywords, -3 critique/news/vlog) so we feed the
 * extractor the same quality of video the live pipeline would.
 */
import "dotenv/config";

const KEY = process.env.YOUTUBE_DATA_API_KEY!;
const BENCH = new Set(["rf_EQvubKlk","FqxEKDxemtI","UBvfsImdI2U","z3Qn3fBoe2I","iU8ww5MC2FQ","SY2jXlW9bt4","gddYspvW0_w","ktkqq7QsN9Q","N7uP9V0Iktc","75DJN5UVQnw"]);

const QUERIES = [
  "day trading strategy futures tutorial",
  "ICT order block entry strategy explained",
  "opening range breakout strategy day trading",
  "liquidity sweep trading strategy tutorial",
];

const POS = /(strategy|setup|how to|tutorial|explained|step by step|guide|entry|system)/i;
const NEG = /(news|recap|vlog|podcast|reaction|q&a|live stream|prop firm review|got funded|payout)/i;

function scoreTitle(t: string): number {
  let s = 0;
  if (POS.test(t)) s += 2;
  if (NEG.test(t)) s -= 3;
  return s;
}

const found = new Map<string, { title: string; score: number }>();
for (const q of QUERIES) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`search failed for "${q}": ${res.status}`); continue; }
  const data = (await res.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }> };
  for (const it of data.items ?? []) {
    const id = it.id?.videoId;
    const title = it.snippet?.title ?? "";
    if (!id || BENCH.has(id) || found.has(id)) continue;
    const sc = scoreTitle(title);
    if (sc < 1) continue; // scout floor: only tutorial-positive titles
    found.set(id, { title, score: sc });
  }
}

const ranked = [...found.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 8);
console.log(`FRESH_FOUND\t${found.size}`);
for (const [id, info] of ranked) console.log(`PICK\t${id}\t${info.score}\t${info.title}`);
process.exit(0);
