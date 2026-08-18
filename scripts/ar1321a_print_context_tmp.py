t = open(
    "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt",
    encoding="utf-8",
).read()

for label, idx in [
    ("downside area", 9900),
    ("idea-of-direction area", 10450),
    ("upside area", 18100),
    ("buy area", 18900),
]:
    print("====", label, "====")
    print(repr(t[idx:idx + 600]))
    print()
