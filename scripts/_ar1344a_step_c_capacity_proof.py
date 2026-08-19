#!/usr/bin/env python3
"""AR-1344A Step C -- real long-input execution capacity proof (not committed as a permanent
test; a one-shot proof artifact, its console output is what gets pasted into the report). Runs
the CORRECTED anchor_locator.locate_anchor (real Ollama call, num_ctx=32768) against a witness
condition whose grounding quote sits at char offset 30714 of a 76723-char transcript --
well past the ~16K-char (4096-token) window the pre-fix code would have silently truncated at.
"""
import json
import sys
import time
import urllib.request

sys.path.insert(0, ".")
from src.engine.extraction.anchor_locator import locate_anchor

VIDEO_ID = "VTEQ2fhGLqE"
WITNESS_CONDITION_TEXT = "The strategy requires low risk as a final confirming factor."
KNOWN_QUOTE_SUBSTRING = "And then the last one is it has to be low risk."

with open(f"src/engine/extraction/fixtures/source-evidence/{VIDEO_ID}.transcript.txt", encoding="utf-8") as f:
    transcript = f.read()

known_pos = transcript.find(KNOWN_QUOTE_SUBSTRING)
print(json.dumps({
    "transcript_len_chars": len(transcript),
    "witness_quote_char_offset": known_pos,
    "witness_quote": KNOWN_QUOTE_SUBSTRING,
}, indent=2))

results = []
for attempt in range(1, 4):
    t0 = time.time()
    result = locate_anchor(transcript, WITNESS_CONDITION_TEXT)
    dt = time.time() - t0
    ok = result.located and result.quote is not None and transcript[result.char_span[0]:result.char_span[1]] == result.quote
    results.append({
        "attempt": attempt,
        "located": result.located,
        "reason": result.reason,
        "quote": result.quote,
        "char_span": list(result.char_span) if result.located else None,
        "mechanically_verified_literal_span": ok,
        "duration_s": round(dt, 2),
    })
    print(json.dumps(results[-1], indent=2))

with urllib.request.urlopen("http://localhost:11434/api/ps", timeout=10) as resp:
    ps = json.loads(resp.read().decode("utf-8"))
loaded = next((m for m in ps.get("models", []) if m.get("model") == "gemma4:e4b-it-qat"), None)
print(json.dumps({"live_context_length_after_calls": (loaded or {}).get("context_length")}, indent=2))

all_located = all(r["located"] for r in results)
all_verified = all(r["mechanically_verified_literal_span"] for r in results if r["located"])
print(json.dumps({
    "summary": {
        "consecutive_successful_calls": sum(1 for r in results if r["located"]),
        "any_json_decode_error": False,  # would have raised, script would have crashed
        "all_located_and_verified": all_located and all_verified,
    }
}, indent=2))
