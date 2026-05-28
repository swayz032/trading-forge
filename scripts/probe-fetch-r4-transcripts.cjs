const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');
const path = require('path');
const VIDEOS = [
  { id: "KXWRtV2LOVc", name: "four_h_crt_timed" },
  { id: "nV9gknhy2Ew", name: "ict_po3_4h" },
  { id: "dHmOosYof48", name: "oil_top_down" },
];
(async () => {
  for (const v of VIDEOS) {
    const items = await YoutubeTranscript.fetchTranscript(v.id);
    const text = items.map(i => i.text).join(' ');
    fs.writeFileSync(path.join(process.cwd(), 'tmp/gemma-diag', `transcript-${v.id}-${v.name}.txt`), text);
    console.log(`${v.id} → ${text.length}`);
  }
})();
