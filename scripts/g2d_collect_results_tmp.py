import json, hashlib, os

base = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1"

with open("docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json", "r", encoding="utf-8") as f:
    queue = json.load(f)

rows = []
for row in queue["queue"]:
    ref = row["condition_ref"]
    # find the matching permit file to get the id suffix
    matches = [fn for fn in os.listdir(base) if fn.startswith(ref.replace("[", "_").replace("]", "_")) is False]
for fn in sorted(os.listdir(base)):
    pass

# simpler: glob by condition_ref safe-name prefix used when writing prompt files earlier
q_by_ref = {r["condition_ref"]: r for r in queue["queue"]}

results = []
for fn in sorted(os.listdir(base)):
    if fn.endswith(".raw.json"):
        stem = fn[: -len(".raw.json")]
        raw_path = os.path.join(base, fn)
        completion_path = os.path.join(base, stem + ".completion.json")
        attempt_path = os.path.join(base, stem + ".attempt.json")
        dispatch_path = os.path.join(base, stem + ".dispatch.json")

        raw_bytes = open(raw_path, "rb").read()
        raw_sha = hashlib.sha256(raw_bytes).hexdigest()

        with open(attempt_path, "r", encoding="utf-8") as f:
            attempt = json.load(f)
        with open(completion_path, "r", encoding="utf-8") as f:
            completion = json.load(f)

        results.append({
            "stem": stem,
            "condition_ref": attempt.get("condition_ref"),
            "attempt_number": attempt.get("attempt_number"),
            "raw_sha256": raw_sha,
            "raw_bytes": len(raw_bytes),
            "completion_keys": sorted(completion.keys()) if isinstance(completion, dict) else None,
        })

print(json.dumps(results, indent=2))
