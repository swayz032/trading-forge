import re

t = open(
    "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt",
    encoding="utf-8",
).read()

for needle in ["upside", "to the upside", "buy", "long", "downside", "bullish", "bearish"]:
    idxs = [m.start() for m in re.finditer(re.escape(needle), t, re.IGNORECASE)]
    print(needle, "count", len(idxs), "at", idxs[:8])
