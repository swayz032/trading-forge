// Direct gemma invocation USING THE MODEL-ROUTER'S EXACT PREAMBLE + SAMPLING.
// Mirrors src/server/services/model-router.ts:2382-2393 to reproduce live behavior.
const fs = require('fs');

const PROMPT_PATH = 'src/agents/transcript-extractor.md';
const SCHEMA_PATH = 'src/agents/kb/transcript-extractor-output-schema.json';
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, 'utf-8');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));

// Real transcript from R2X7AgWI4QQ — "1H Pattern Nobody Talks About" (~22951 chars condensed)
const TRANSCRIPT = `This 1 hour pattern has made trading so simple for me. I know exactly when to trade and which direction to trade in. So this is the hourly chart here on Great British pound US dollar. And what I want you to look at is how often one candle closes in one direction and then the following candle also closes in that same direction. I am a continuation trader. So what I'm looking for is an hourly candle to close bullish or bearish and then from there I am taking a trade expecting price to go in the same direction. So look at all these bearish candles for instance. I could have been taking sells during that time. Obviously, this does happen better when markets are trending. However, I will show you a pattern on the one minute chart that will help avoid getting to bad trades. The reason I like trading this way is because it is so simple. So let's have a look at some of these candles. Wednesday the 20th of August 1 till 2 we have closed bearish. So you can see there price has opened at that point at 1:00 and then has closed there at 2:00. So it's closed lower than it has opened. Therefore, it is a bearish candle. Price opens there, closes there, bearish candle. After that, I will be looking for sells. So, when we're on the new hourly candle, which is the 2 till 3. Obviously, the previous hourly candle was the 1 till 2. We're then on 2 till 3, I will be looking for sells. We close bearish there as well. So, after the 2 till 3, I will be looking for sells on the 3 till 4. Another bearish close. After we've closed bearish and 3 till 4, the four to five candle actually closes bullish. So price opens there closes there. I actually look at the one minute for my entries because there's a certain pattern on the one minute chart and when we see that pattern we are able to get into trades. There is no trade management apart from stop loss to break even at 1.5. The rest of the time, I just let the trade play out cuz I'm only holding it for on average 20 minutes. Average whole time of the trades is just 20 minutes. So, I like the fact that we are in and out of trades. We have a 67% win rate. 247 lost. 67 break even.`;

// Same user payload format the route uses
const userPayload = JSON.stringify({
  youtube_url: 'https://youtube.com/watch?v=R2X7AgWI4QQ',
  title: 'The 1H Pattern Nobody Talks About — 1H, 1M Strategy',
  channel: 'youtube',
  transcript_text: TRANSCRIPT,
});

// Model-router preamble (verbatim from model-router.ts:2385)
const PREAMBLE = "STEP 1 — THINK FIRST (do not skip this):\nBefore emitting JSON, write a brief 'reasoning_notes' section enumerating the speaker's proprietary vocabulary you noticed in the transcript. Look for:\n- Named tools/zones (e.g. 'the X Box', 'the Hidden Level', 'the Optimum Zone')\n- Named models/frameworks (e.g. 'IRS Model', 'Power of 3', 'CRT', 'the Box system')\n- Named entry steps (e.g. 'Change of State', 'Rebalance', 'Sweep')\n- Named filters (e.g. 'avoid skinny candles', 'no equal liquidity')\nEmit this reasoning AT THE TOP of your output as a JSON comment-like string `\"reasoning_notes\": \"<2-3 sentences listing speaker terms you found>\"` ABOVE the strategies array.\n\nSTEP 2 — EXTRACT TO JSON using those speaker terms in speaker_concepts.\n\n---\n\n";

(async () => {
  const body = {
    model: 'gemma4:e2b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: PREAMBLE + userPayload + '\n\nReturn JSON matching the schema.' },
    ],
    stream: false,
    format: SCHEMA,
    options: { temperature: 0.1, top_p: 0.95, top_k: 64, num_ctx: 12288, num_predict: 4096, seed: 42 },
    keep_alive: '30m',
  };

  console.log('Calling Ollama gemma4:e2b with model-router preamble+config...');
  const t0 = Date.now();
  const resp = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const j = await resp.json();
  const content = j?.message?.content ?? '';
  console.log(`Done in ${dt}s. status=${resp.status}, content length=${content.length}`);
  console.log('=== RAW GEMMA OUTPUT (first 5000 chars) ===');
  console.log(content.slice(0, 5000));
  console.log('\n=== Parsed strategies[0] ===');
  try {
    const parsed = JSON.parse(content);
    console.log(JSON.stringify(parsed.strategies?.[0] ?? parsed, null, 2).slice(0, 5000));
  } catch (e) {
    console.log('PARSE-FAIL:', e.message);
  }
})().catch(e => console.error('FATAL', e.message));
