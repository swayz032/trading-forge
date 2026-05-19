/**
 * Cross-validate graduated strategies against current (2026) discussion on
 * the SAME sources the scout pipeline uses: Brave Search + Reddit JSON +
 * YouTube Data API. If a strategy's concept doesn't surface ANY current
 * 2026 mentions across all three sources, it's stale / SEO-orphan / false
 * positive. If it surfaces in 2+ sources → real, currently-discussed strategy.
 *
 * Wave 9 (2026-05-17) — ScrapingBee path removed; YouTube Data API v3 used.
 * If YOUTUBE_DATA_API_KEY missing, YouTube source reports zero (other sources
 * still cross-validate).
 *
 * Usage: node scripts/cross-validate-graduated-2026.cjs
 */
require("dotenv/config");
const postgres = require("postgres");

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY;
const YOUTUBE_KEY = process.env.YOUTUBE_DATA_API_KEY;
const UA = "Mozilla/5.0 (Trading Forge cross-validator/1.0)";

if (!BRAVE_KEY) { console.error("FATAL: BRAVE_SEARCH_API_KEY missing"); process.exit(1); }

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

// Map archetype → search query (broader than strategy name for better recall)
function queryFor(conceptName) {
  const cn = conceptName.toLowerCase();
  if (/orb|opening.range/.test(cn)) return "opening range breakout ORB futures 2026";
  if (/9.21.ema|ema.*pullback|ema.*cross/.test(cn)) return "EMA pullback futures day trading 2026";
  if (/rsi.2|connors.*rsi/.test(cn)) return "Connors RSI 2 futures backtest 2026";
  if (/rsi/.test(cn)) return "RSI day trading futures 2026";
  if (/macd/.test(cn)) return "MACD futures day trading 2026";
  if (/bollinger.*squeeze/.test(cn)) return "Bollinger Band squeeze breakout 2026";
  if (/bollinger/.test(cn)) return "Bollinger Bands futures 2026";
  if (/supertrend/.test(cn)) return "Supertrend indicator strategy 2026";
  if (/stochastic/.test(cn)) return "stochastic RSI futures 2026";
  if (/ict|smc|smart.money|choch/.test(cn)) return "ICT smart money concepts 2026 day trading";
  if (/fvg|fair.value.gap/.test(cn)) return "fair value gap FVG futures 2026";
  if (/liquidity.sweep/.test(cn)) return "liquidity sweep ICT 2026 futures";
  if (/vwap/.test(cn)) return "VWAP day trading futures 2026";
  if (/volume.profile|poc|vah|val/.test(cn)) return "volume profile POC VAH VAL futures 2026";
  if (/inside.bar|nr4|nr7/.test(cn)) return "inside bar breakout futures 2026";
  if (/breakout/.test(cn)) return "breakout strategy futures 2026";
  if (/asian.session|asian.range/.test(cn)) return "Asian session range futures 2026";
  if (/session/.test(cn)) return "session breakout futures 2026";
  if (/pivot/.test(cn)) return "pivot point day trading futures 2026";
  if (/keltner|donchian/.test(cn)) return "Keltner channel breakout 2026";
  if (/holy.grail|raschke/.test(cn)) return "Linda Raschke holy grail setup 2026";
  if (/connors.*short|short.term.strategies/.test(cn)) return "Connors short-term strategies 2026";
  if (/squeeze.pro|john.carter/.test(cn)) return "John Carter squeeze pro futures 2026";
  if (/order.flow|imbalance|footprint/.test(cn)) return "order flow imbalance futures 2026";
  if (/news|fomc|cpi|nfp|inventory|earnings/.test(cn)) return "futures news trading 2026";
  if (/mean.reversion/.test(cn)) return "mean reversion day trading futures 2026";
  if (/accumulation.*distribution/.test(cn)) return "accumulation distribution Wyckoff 2026";
  if (/moving.average.*cross/.test(cn)) return "moving average crossover futures 2026";
  if (/magic.hours|hourly.range/.test(cn)) return "hourly range reversion futures 2026";
  return cn.replace(/^mes_|_5m$/g, "").replace(/_/g, " ").slice(0, 80) + " futures 2026";
}

async function braveSearch(q) {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5&freshness=py`;
    const r = await fetch(url, { headers: { "X-Subscription-Token": BRAVE_KEY, "Accept": "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { error: `HTTP ${r.status}`, count: 0 };
    const j = await r.json();
    const results = (j.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, age: x.age, snippet: (x.description ?? "").slice(0, 120) }));
    // Count results that look 2025/2026-current (have recent freshness OR explicit year in title/desc)
    const fresh = results.filter((x) => /2025|2026/.test(x.title + " " + x.snippet) || (x.age && /day|week|month/.test(x.age)));
    return { count: results.length, fresh: fresh.length, top: results.slice(0, 2) };
  } catch (e) { return { error: e.message, count: 0 }; }
}

async function redditSearch(q) {
  try {
    const subs = ["FuturesTrading", "Daytrading", "algotrading"];
    let total = 0; let fresh = 0; const top = [];
    for (const sub of subs) {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=1&sort=relevance&t=year&limit=5`;
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const j = await r.json();
      const posts = (j.data?.children ?? []).map((c) => c.data);
      total += posts.length;
      const now = Date.now() / 1000;
      for (const p of posts) {
        if (p.created_utc && (now - p.created_utc) < 365 * 24 * 3600) {
          fresh++;
          if (top.length < 2) top.push({ sub, title: p.title.slice(0, 100), score: p.score });
        }
      }
    }
    return { count: total, fresh, top };
  } catch (e) { return { error: e.message, count: 0 }; }
}

async function youtubeSearch(q) {
  if (!YOUTUBE_KEY) return { count: 0, error: "no youtube data api key" };
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=10&order=relevance&key=${YOUTUBE_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { error: `HTTP ${r.status}`, count: 0 };
    const j = await r.json();
    const items = (j.items ?? []);
    const titles = items.map((it) => it?.snippet?.title ?? "").filter(Boolean);
    return { count: titles.length, top: titles.slice(0, 2) };
  } catch (e) { return { error: e.message, count: 0 }; }
}

async function main() {
  try {
    const strategies = await sql`
      SELECT s.id, s.name, s.symbol, b.concept_name, b.distinct_providers, b.source_count
      FROM strategies s
      LEFT JOIN strategy_pending_buckets b ON b.graduated_strategy_id = s.id
      WHERE s.config->'metadata'->>'source' = 'graduated_bucket'
      ORDER BY s.created_at DESC
    `;
    console.log(`Cross-validating ${strategies.length} graduated strategies against 2026 Brave+Reddit+YouTube...`);
    console.log("");

    const results = [];
    let i = 0;
    for (const s of strategies) {
      i++;
      const concept = s.concept_name || s.name;
      const q = queryFor(concept);
      const [brave, reddit, yt] = await Promise.all([braveSearch(q), redditSearch(q), youtubeSearch(q)]);
      const sourceScore = (brave.count > 0 ? 1 : 0) + (reddit.fresh > 0 ? 1 : 0) + (yt.count > 0 ? 1 : 0);
      const freshScore = (brave.fresh ?? 0) + (reddit.fresh ?? 0) + (yt.count ?? 0);
      results.push({
        name: s.name, concept, query: q,
        brave: brave.count, braveFresh: brave.fresh,
        reddit: reddit.count, redditFresh: reddit.fresh,
        yt: yt.count,
        sourceScore, freshScore,
      });
      const verdict = sourceScore >= 2 ? "✓ REAL" : sourceScore === 1 ? "⚠ THIN" : "✗ FALSE POSITIVE?";
      console.log(`[${String(i).padStart(2)}/${strategies.length}] ${verdict.padEnd(20)}  brave=${brave.count}(f${brave.fresh}) reddit=${reddit.fresh} yt=${yt.count}  ${concept.slice(0, 50)}`);
      // Throttle to avoid rate limits
      await new Promise((r) => setTimeout(r, 800));
    }

    console.log("");
    console.log("══════════════════════════════════════════════════════");
    console.log("SUMMARY");
    console.log("══════════════════════════════════════════════════════");
    const real = results.filter((r) => r.sourceScore >= 2).length;
    const thin = results.filter((r) => r.sourceScore === 1).length;
    const suspect = results.filter((r) => r.sourceScore === 0).length;
    console.log(`  REAL (2+ sources currently discuss):  ${real} / ${results.length}`);
    console.log(`  THIN (only 1 source):                 ${thin} / ${results.length}`);
    console.log(`  FALSE POSITIVE? (0 sources):          ${suspect} / ${results.length}`);
    console.log("");
    if (suspect > 0) {
      console.log("── Suspect strategies (0 cross-source hits) ──");
      for (const r of results.filter((x) => x.sourceScore === 0)) {
        console.log(`  ✗ ${r.name}  query="${r.query}"`);
      }
    }
    if (thin > 0) {
      console.log("");
      console.log("── Thin strategies (only 1 source hit) ──");
      for (const r of results.filter((x) => x.sourceScore === 1)) {
        const which = r.brave > 0 ? "brave" : r.redditFresh > 0 ? "reddit" : "yt";
        console.log(`  ⚠ ${r.name}  only on ${which}`);
      }
    }

    // Write full report
    const fs = require("node:fs");
    const reportPath = "C:\\Users\\tonio\\bin\\graduated-cross-validation-2026.json";
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf-8");
    console.log("");
    console.log(`Full report: ${reportPath}`);
  } finally {
    await sql.end();
  }
}

main();
