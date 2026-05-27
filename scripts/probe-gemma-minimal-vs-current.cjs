// Pass L #3 — A/B probe: gemma minimal prompt vs current v12 prompt.
// Verifies the minimal prompt (1) doesn't trigger the recursive-loop bug
// and (2) extracts the 8 fields cleanly for a real strategy video.
//
// Usage: node scripts/probe-gemma-minimal-vs-current.cjs

const fs = require('fs');

const MINIMAL_PROMPT = fs.readFileSync('src/agents/transcript-extractor-minimal.md', 'utf-8');
const MINIMAL_SCHEMA = JSON.parse(fs.readFileSync('src/agents/kb/transcript-extractor-minimal-schema.json', 'utf-8'));

// Real transcript from R2X7AgWI4QQ — "1H Pattern Nobody Talks About" (condensed key segments)
const TRANSCRIPT_1H_PATTERN = `This 1 hour pattern has made trading so simple for me. I know exactly when to trade and which direction to trade in. So this is the hourly chart here on Great British pound US dollar. And what I want you to look at is how often one candle closes in one direction and then the following candle also closes in that same direction. I am a continuation trader. So what I'm looking for is an hourly candle to close bullish or bearish and then from there I am taking a trade expecting price to go in the same direction. Obviously, this does happen better when markets are trending. However, I will show you a pattern on the one minute chart that will help avoid getting to bad trades. The reason I like trading this way is because it is so simple. Wednesday the 20th of August 1 till 2 we have closed bearish. So you can see there price has opened at that point at 1:00 and then has closed there at 2:00. So it's closed lower than it has opened. Therefore, it is a bearish candle. After that, I will be looking for sells. So, when we're on the new hourly candle, which is the 2 till 3 I will be looking for sells. After we've closed bearish and 3 till 4, the four to five candle actually closes bullish. So price opens there closes there. I actually look at the one minute for my entries because there's a certain pattern on the one minute chart and when we see that pattern we are able to get into trades. There is no trade management apart from stop loss to break even at 1.5. The rest of the time, I just let the trade play out cuz I'm only holding it for on average 20 minutes. Average whole time of the trades is just 20 minutes. We have a 67% win rate. 247 lost. 67 break even.`;

async function runProbe(label, transcript, title) {
  console.log(`\n========================================`);
  console.log(`PROBE: ${label}`);
  console.log(`========================================`);

  const userPayload = JSON.stringify({
    youtube_url: 'https://youtube.com/watch?v=R2X7AgWI4QQ',
    title,
    channel: 'youtube',
    transcript_text: transcript,
  });

  const body = {
    model: 'gemma4:e2b',
    messages: [
      { role: 'system', content: MINIMAL_PROMPT },
      { role: 'user', content: userPayload + '\n\nReturn JSON matching the schema.' },
    ],
    stream: false,
    format: MINIMAL_SCHEMA,
    options: {
      temperature: 0.1,
      top_p: 0.95,
      top_k: 64,
      num_ctx: 12288,
      num_predict: 4096,
      seed: 42,
    },
    keep_alive: '30m',
  };

  const t0 = Date.now();
  let resp;
  try {
    resp = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    });
  } catch (e) {
    console.error('FETCH-FAIL:', e.message);
    return null;
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const j = await resp.json();
  const content = j?.message?.content ?? '';

  // Detect recursive-loop bug — content is mostly "results": [{"results": [...
  const recursionScore = (content.match(/"results":\s*\[/g) ?? []).length;
  const recursionDetected = recursionScore > 5;

  console.log(`  duration:  ${dt}s`);
  console.log(`  http:      ${resp.status}`);
  console.log(`  length:    ${content.length} chars`);
  console.log(`  recursion: ${recursionDetected ? '❌ RECURSIVE LOOP DETECTED' : '✓ clean'}`);

  if (recursionDetected) {
    console.log(`  first 500 chars: ${content.slice(0, 500)}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    console.log(`  ❌ JSON PARSE FAILED: ${e.message}`);
    console.log(`  first 800 chars: ${content.slice(0, 800)}`);
    return null;
  }

  console.log(`  strategies count: ${parsed.strategies?.length ?? 0}`);
  console.log(`  rejected count:   ${parsed.rejected_strategies?.length ?? 0}`);
  console.log(`  instrument:       ${parsed.instrument_classification}`);

  if (parsed.strategies?.[0]) {
    const s = parsed.strategies[0];
    console.log(`\n  --- strategies[0] ---`);
    console.log(`  name:            ${s.name}`);
    console.log(`  higher_tf:       ${s.higher_timeframe}`);
    console.log(`  lower_tf:        ${s.lower_timeframe}`);
    console.log(`  preferred:       ${s.preferred_regime}`);
    console.log(`  entry_rule:      ${s.entry_rule}`);
    console.log(`  stop.anchor:     ${s.stop?.anchor}`);
    console.log(`  stop.rationale:  ${s.stop?.rationale}`);
    console.log(`  stop_management: ${s.stop_management}`);
    console.log(`  targets:         ${JSON.stringify(s.targets)}`);
    console.log(`  confluences (${s.confluences?.length ?? 0}):`);
    for (const c of s.confluences ?? []) {
      console.log(`    • ${c.name} → ${c.canonical_match ?? 'speaker-unique'}`);
      console.log(`      "${c.description?.slice(0, 100)}"`);
    }
  }
  return parsed;
}

(async () => {
  await runProbe('R2X7AgWI4QQ — 1H pattern (real strategy)', TRANSCRIPT_1H_PATTERN, 'The 1H Pattern Nobody Talks About — 1H, 1M Strategy');
  console.log('\n\nAll probes complete.');
})().catch(e => console.error('FATAL', e));
