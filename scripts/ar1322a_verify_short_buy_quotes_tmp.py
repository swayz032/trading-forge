t = open(
    "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt",
    encoding="utf-8",
).read()

downside_short = (
    "if we have traded into the downside of this range, it means that the price is going "
    "down. So, we want to be taking a short"
)
upside_buy = "So we can go ahead and get this one ready for a buy."

for label, q in [("downside_short", downside_short), ("upside_buy", upside_buy)]:
    ok = q in t
    print(label, "literal:", ok, "offset:", t.index(q) if ok else None)
