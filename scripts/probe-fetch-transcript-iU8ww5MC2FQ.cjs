const { YoutubeTranscript } = require('youtube-transcript');
(async () => {
  const items = await YoutubeTranscript.fetchTranscript('iU8ww5MC2FQ');
  const text = items.map(i => i.text).join(' ');
  console.log(`=== iU8ww5MC2FQ transcript (${text.length} chars) ===\n`);
  console.log(text);
})().catch(e => console.error('ERR', e.message));
