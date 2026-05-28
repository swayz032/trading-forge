const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');
const path = require('path');
const VIDEOS = [
  { id: "75DJN5UVQnw", name: "master_supply_demand" },
  { id: "mNcoaNdAyIE", name: "break_and_retest" },
  { id: "xTTDH5iRhJc", name: "break_and_bounce" },
];
(async () => {
  for (const v of VIDEOS) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(v.id);
      const text = items.map(i => i.text).join(' ');
      const f = path.join(process.cwd(), 'tmp/gemma-diag', `transcript-${v.id}-${v.name}.txt`);
      fs.writeFileSync(f, text);
      console.log(`${v.id} → ${text.length} chars`);
    } catch (e) { console.log(`${v.id} FAIL: ${e.message}`); }
  }
})();
