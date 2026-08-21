"""AR-1395 probe: why does `system-map:check` exit non-zero, and did this packet cause it?

Read-only. Prints the drift the checker reports so the answer is measured, not assumed.
"""
import json
import subprocess

r = subprocess.run(["npx", "tsx", "scripts/system-map.ts", "check"],
                   capture_output=True, text=True, shell=True)
print("exit:", r.returncode)

payload = r.stdout.strip()
try:
    data = json.loads(payload)
except Exception as exc:  # noqa: BLE001
    print("stdout is not a single JSON document:", exc)
    print("--- last 2000 chars of stdout ---")
    print(payload[-2000:])
    print("--- stderr ---")
    print(r.stderr[-2000:])
    raise SystemExit(0)

INTERESTING = {"drift", "drifts", "missing", "extra", "errors", "violations",
               "stale", "unknown", "orphan", "mismatch", "added", "removed"}


def walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower() in INTERESTING and v:
                print(f"  {path}/{k} -> {str(v)[:400]}")
            walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{path}[{i}]")


if isinstance(data, dict):
    print("top-level keys:", list(data.keys()))
    print("status:", data.get("status"))
    items = data.get("driftItems") or []
    print(f"driftItems: {len(items)}")
    for it in items[:40]:
        print("  -", json.dumps(it)[:300])
    cov = data.get("registryCoverage") or {}
    print("\nTHE THREE MISSING ENGINE SUBSYSTEMS:")
    print(json.dumps(cov.get("missingEngineSubsystems"), indent=2))
    for k in ("missingRoutes", "missingSchedulerJobs", "missingDatabaseTables"):
        v = cov.get(k)
        if v:
            print(f"{k}: {json.dumps(v)[:300]}")
walk(data)
