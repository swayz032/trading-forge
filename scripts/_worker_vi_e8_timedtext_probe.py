"""Diagnostic probe (AR-1391): fetch E8Wg6tFPYjo's timed captions via youtube-transcript-api so
the Visual Intelligence task can cite exact timestamp windows instead of narrative position only.
Not a production script -- disposable once the timestamps are recovered or the attempt is
exhausted."""

import json

from youtube_transcript_api import YouTubeTranscriptApi

VIDEO_ID = "E8Wg6tFPYjo"

api = YouTubeTranscriptApi()
transcript = api.fetch(VIDEO_ID)
snippets = transcript.to_raw_data()
print("SNIPPET COUNT", len(snippets))
print("FIRST", json.dumps(snippets[0]))
print("LAST", json.dumps(snippets[-1]))
total_text = " ".join(s["text"] for s in snippets)
print("TOTAL TEXT LEN", len(total_text))

with open("scripts/_worker_vi_e8_timedtext_raw.json", "w", encoding="utf-8") as f:
    json.dump(snippets, f, ensure_ascii=False, indent=None)
print("WROTE scripts/_worker_vi_e8_timedtext_raw.json")
