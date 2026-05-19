// Manual cross-validation drill: act as the scouts, prove the full chain
// works on REAL web content. If this succeeds, the n8n workflows must
// produce equivalent results.

import 'dotenv/config';
import postgres from 'postgres';

const TAVILY_KEY  = process.env.TAVILY_API_KEY;
const TF_BACKEND  = 'http://localhost:4000';

if (!TAVILY_KEY) { console.error('TAVILY_API_KEY missing'); process.exit(1); }

// 3 different search queries targeting the SAME strategy archetype.
// Each query simulates a different "scout" (different source_provider).
// We want 3+ URLs that all discuss the same setup → cross-validates organically.
const QUERIES = [
  { provider: 'tavily',   query: 'MES futures opening range breakout strategy entry exit rules' },
  { provider: 'brave',    query: 'micro e-mini S&P opening range breakout setup ATR stop' },
  { provider: 'parallel', query: 'opening range breakout intraday futures strategy backtest' },
];

async function tavilySearch(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TAVILY_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      max_results: 4,
      include_raw_content: 'markdown',  // INLINE bodies — saves a separate /extract call
    }),
  });
  const j = await res.json();
  return j.results || [];
}

async function scoutExtract({ sourceUrl, markdown, title, sourceProvider }) {
  const res = await fetch(`${TF_BACKEND}/api/agent/scout-extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `xval-${Date.now()}-${Math.random().toString(36).slice(2,8)}` },
    body: JSON.stringify({ sourceUrl, markdown: markdown.slice(0, 50_000), title, sourceProvider }),
  });
  return res.json();
}

async function postPending(idea) {
  const res = await fetch(`${TF_BACKEND}/api/agent/scout-ideas/pending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `xval-pending-${Date.now()}-${Math.random().toString(36).slice(2,8)}` },
    body: JSON.stringify({ ...idea, is_cross_validation_result: false }),
  });
  const txt = await res.text();
  return { status: res.status, body: txt };
}

console.log('=== STEP 1: Broad-web Tavily search for opening range breakout strategies ===\n');
const allResults = [];
for (const q of QUERIES) {
  console.log(`Query (as ${q.provider}): "${q.query}"`);
  const results = await tavilySearch(q.query);
  console.log(`  ↳ ${results.length} URLs returned`);
  for (const r of results) console.log(`    - ${r.url}  (${(r.raw_content || '').length} chars)`);
  allResults.push({ provider: q.provider, results });
}

console.log('\n=== STEP 2: Extract structured strategies from each result via scout-extract ===\n');
const allIdeas = [];
for (const branch of allResults) {
  for (const r of branch.results.slice(0, 2)) {  // top 2 per branch
    const body = r.raw_content || '';
    if (body.length < 400) { console.log(`SKIP ${r.url} — body too thin (${body.length} chars)`); continue; }
    const extract = await scoutExtract({ sourceUrl: r.url, markdown: body, title: r.title || r.url, sourceProvider: branch.provider });
    if (extract.extracted && extract.ideas?.length) {
      console.log(`✅ ${branch.provider} ${r.url} → ${extract.ideas.length} idea(s) extracted`);
      for (const idea of extract.ideas) {
        allIdeas.push({ ...idea, source_provider: branch.provider });
        console.log(`   ↳ ${idea.market} ${idea.timeframe} ${idea.concept_name} (regime: ${idea.regime})`);
      }
    } else {
      console.log(`❌ ${branch.provider} ${r.url} → ${extract.reason || 'no ideas'}`);
    }
  }
}

if (allIdeas.length === 0) {
  console.log('\n=== NO IDEAS EXTRACTED. Real web content today did not yield extractable strategies. ===');
  process.exit(0);
}

console.log(`\n=== STEP 3: POST ${allIdeas.length} extracted ideas to /scout-ideas/pending ===\n`);
for (let i = 0; i < allIdeas.length; i++) {
  const r = await postPending(allIdeas[i]);
  console.log(`POST ${i+1} (${allIdeas[i].source_provider} ${allIdeas[i].market} ${allIdeas[i].concept_name}): HTTP ${r.status}`);
  console.log(`  ${r.body.slice(0, 250)}`);
}

console.log('\n=== STEP 4: Wait 15s, check DB state ===\n');
await new Promise(r => setTimeout(r, 15000));
const sql = postgres(process.env.DATABASE_URL);
const buckets = await sql`SELECT id, market, entry_archetype, exit_type, source_count, distinct_providers, status, graduated_strategy_id FROM strategy_pending_buckets WHERE first_seen_at > NOW() - INTERVAL '5 minutes' ORDER BY first_seen_at DESC`;
console.log('NEW BUCKETS:'); console.log(JSON.stringify(buckets, null, 2));
const strats = await sql`SELECT id, name, symbol, lifecycle_state, source, tags FROM strategies WHERE created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT 5`;
console.log('\nNEW STRATEGIES:', strats.length);
console.log(JSON.stringify(strats, null, 2));
await sql.end();
