t = open(
    "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt",
    encoding="utf-8",
).read()

wider = (
    "We are essentially waiting for the one minute time frame candles to print into "
    "one of these sides of the range. Now, what does that mean? What has to happen is "
    "the candles need to close outside of this 5m minute range."
)
print("literal contiguous?", wider in t)
if wider in t:
    i = t.index(wider)
    print("offset", i, "to", i + len(wider))
