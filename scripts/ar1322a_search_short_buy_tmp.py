t = open(
    "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt",
    encoding="utf-8",
).read()

for label, idx in [("short area", 10850), ("buy area", 18850)]:
    print("====", label, "====")
    print(repr(t[idx:idx + 250]))
    print()
