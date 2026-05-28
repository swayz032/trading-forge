// Bypass model-router. Call Ollama /api/chat directly with the SAME minimal
// prompt + schema, dump RAW response to disk — no parsing, no fallback.
const fs = require('fs');
const path = require('path');
const { YoutubeTranscript } = require('youtube-transcript');

(async () => {
  const VIDEO_ID = process.argv[2] || "iU8ww5MC2FQ";
  const ROOT = process.cwd();

  // Load the same prompt + schema the production extractor uses
  const systemPrompt = fs.readFileSync(path.join(ROOT, "src/agents/transcript-extractor-minimal.md"), "utf-8");
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "src/agents/kb/transcript-extractor-minimal-schema.json"), "utf-8"));

  console.log(`[1/3] Fetching transcript for ${VIDEO_ID}...`);
  const items = await YoutubeTranscript.fetchTranscript(VIDEO_ID);
  const transcript = items.map(i => i.text).join(' ').slice(0, 32_000);
  console.log(`      ${transcript.length} chars (capped at 32K)`);

  const userPayload = JSON.stringify({
    youtube_url: `https://youtube.com/watch?v=${VIDEO_ID}`,
    title: "test",
    channel: "youtube",
    transcript_text: transcript,
  });

  // Build the same Gemma-style request the model-router builds.
  const rulesBlock = `${systemPrompt}\n\n## Output JSON Schema\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``;
  const messages = [
    { role: "user", content: `${rulesBlock}\n\nNow extract from this transcript. Return ONLY JSON matching the schema above.\n\nTranscript:\n${userPayload}` }
  ];

  const body = {
    model: "gemma4:e2b",
    messages,
    stream: false,
    format: schema,
    options: {
      temperature: 0.1,
      top_p: 0.95,
      top_k: 64,
      min_p: 0.0,
      repeat_penalty: 1.0,
      num_predict: 4096,
      num_ctx: 32768,
    },
  };

  console.log(`[2/3] POST /api/chat to Ollama (system+schema=${rulesBlock.length} chars, transcript=${transcript.length} chars)...`);
  const t0 = Date.now();
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`      HTTP ${res.status} in ${elapsed.toFixed(1)}s`);

  const responseText = await res.text();
  const rawPath = path.join(ROOT, "tmp/gemma-diag/iU8ww5MC2FQ-OLLAMA-RAW.txt");
  fs.writeFileSync(rawPath, responseText);
  console.log(`[3/3] Saved raw → ${rawPath}\n`);

  // Try to parse and show summary
  try {
    const obj = JSON.parse(responseText);
    console.log(`Top-level Ollama keys: ${Object.keys(obj).join(", ")}`);
    if (obj.message?.content) {
      const content = obj.message.content;
      console.log(`message.content length: ${content.length}`);
      console.log(`message.content first 800 chars:\n${content.slice(0, 800)}`);
      console.log(`\n...message.content last 600 chars:\n${content.slice(-600)}`);

      // Try to parse the inner content as JSON
      try {
        const inner = JSON.parse(content);
        console.log(`\n✓ Inner content IS valid JSON. Top-level keys: ${Object.keys(inner).join(", ")}`);
      } catch (e) {
        console.log(`\n✗ Inner content NOT valid JSON: ${e.message}`);
        // Show where it likely truncated
        const lastBrace = content.lastIndexOf("}");
        const lastQuote = content.lastIndexOf('"');
        console.log(`Last } at pos ${lastBrace} / Last " at pos ${lastQuote} / total ${content.length}`);
      }
    }
    if (obj.done_reason) console.log(`done_reason: ${obj.done_reason}`);
    if (obj.eval_count) console.log(`eval_count (output tokens): ${obj.eval_count}`);
    if (obj.prompt_eval_count) console.log(`prompt_eval_count (input tokens): ${obj.prompt_eval_count}`);
  } catch (e) {
    console.log(`Could not parse Ollama envelope: ${e.message}`);
    console.log(`First 800 of raw response:\n${responseText.slice(0, 800)}`);
  }
})().catch(e => console.error("FATAL", e));
