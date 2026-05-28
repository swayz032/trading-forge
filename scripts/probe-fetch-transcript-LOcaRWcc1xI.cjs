const { YoutubeTranscript } = require('youtube-transcript');
const fs = require('fs');
const path = require('path');
(async () => {
  const items = await YoutubeTranscript.fetchTranscript('LOcaRWcc1xI');
  const text = items.map(i => i.text).join(' ');
  const out = path.join(process.cwd(), 'tmp/gemma-diag/transcript-LOcaRWcc1xI-ict_power_of_3.txt');
  fs.writeFileSync(out, text);
  console.log(`${text.length} chars → ${out}`);
})();
