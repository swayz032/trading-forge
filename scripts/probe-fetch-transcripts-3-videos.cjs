const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');
const path = require('path');

const VIDEOS = [
  { id: "iU8ww5MC2FQ", name: "4h_candle_box_continuation" },
  { id: "N7uP9V0Iktc", name: "bounce_off_level" },
  { id: "UBvfsImdI2U", name: "candle_range_theory" },
];

(async () => {
  const outDir = path.join(process.cwd(), "tmp", "gemma-diag");
  fs.mkdirSync(outDir, { recursive: true });
  for (const v of VIDEOS) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(v.id);
      const text = items.map(i => i.text).join(' ');
      const f = path.join(outDir, `transcript-${v.id}-${v.name}.txt`);
      fs.writeFileSync(f, text);
      console.log(`${v.id} → ${text.length} chars → ${f}`);
    } catch (e) {
      console.log(`${v.id} FAIL: ${e.message}`);
    }
  }
})();
