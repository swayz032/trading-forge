import json, os, sys

path = sys.argv[1]
if not os.path.exists(path):
    print(json.dumps({"exists": False, "path": path}))
    sys.exit(0)

size = os.path.getsize(path)
lines = 0
last_result_snippet = None
with open(path, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        lines += 1
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        # look for a top-level "result" or nested content that looks like the final answer
        if isinstance(obj, dict):
            if "result" in obj:
                last_result_snippet = json.dumps(obj["result"])[:300]

print(json.dumps({
    "exists": True,
    "path": path,
    "size_bytes": size,
    "line_count": lines,
    "last_result_snippet": last_result_snippet,
}, indent=2))
