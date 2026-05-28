const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');
const path = require('path');

const VIDEOS = [
  { id: "1HFoStW_wsc", name: "vwap_institutional_anchor" },
  { id: "aHLIE_TXjpo", name: "4h_5m_bias_entry" },
  { id: "FqxEKDxemtI", name: "extreme_band_reversal" },
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
