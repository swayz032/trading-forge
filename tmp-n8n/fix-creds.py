#!/usr/bin/env python3
"""
Wire inline auth headers on the 5 nodes failing with credential errors.
- 0Z POST Daily Report → authentication: none (local endpoint, no auth needed)
- 5L Tavily /crawl → Authorization: Bearer TAVILY_API_KEY
- 5N Brave Video → X-Subscription-Token: BRAVE_API_KEY
- 5M Brave News → X-Subscription-Token: BRAVE_API_KEY
- 5K POST Parallel Task → x-api-key: PARALLEL_API_KEY
"""
import json
import urllib.request

def load_env():
    env = {}
    with open(".env", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k] = v.strip().strip('"')
    return env

ENV = load_env()
N8N_KEY = ENV["N8N_API_KEY"]
N8N = "http://localhost:5678/api/v1"

def req(method, path, body=None):
    url = f"{N8N}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    headers = {"X-N8N-API-KEY": N8N_KEY}
    if body: headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def add_header(node, name, value):
    """Add an inline header parameter to an httpRequest node."""
    params = node.setdefault("parameters", {})
    params["sendHeaders"] = True
    headers = params.setdefault("headerParameters", {})
    plist = headers.setdefault("parameters", [])
    # remove any existing entry for this header name
    plist = [h for h in plist if h.get("name") != name]
    plist.append({"name": name, "value": value})
    headers["parameters"] = plist

# (workflow_id, node_name, action, ...)
PATCHES = [
    ("v4eSeAoaEErYp472", "POST Daily Report", "auth_none"),
    ("F6i4JoTdxgiyjHhM", "Tavily /crawl", "header", "Authorization", f"Bearer {ENV['TAVILY_API_KEY']}"),
    ("4qVyxZd29pQkGn9p", "Brave Video (past week)", "header", "X-Subscription-Token", ENV["BRAVE_API_KEY"]),
    ("7PgUY6Wa07aZbAPX", "Brave News (past day)", "header", "X-Subscription-Token", ENV["BRAVE_API_KEY"]),
    ("lUenVARPUG1uz4OE", "POST Parallel Task (core processor)", "header", "x-api-key", ENV["PARALLEL_API_KEY"]),
]

# group by workflow
by_wf = {}
for p in PATCHES:
    by_wf.setdefault(p[0], []).append(p)

for wid, patches in by_wf.items():
    w = req("GET", f"/workflows/{wid}")
    name = w.get("name", wid)
    changed = []
    for n in w["nodes"]:
        for p in patches:
            if n["name"] == p[1]:
                if p[2] == "auth_none":
                    n.setdefault("parameters", {})["authentication"] = "none"
                    changed.append(f"{n['name']}: auth=none")
                elif p[2] == "header":
                    add_header(n, p[3], p[4])
                    # CRITICAL: also set authentication to none so n8n uses only the inline header
                    # instead of requiring a separate credential reference
                    n.setdefault("parameters", {})["authentication"] = "none"
                    changed.append(f"{n['name']}: +{p[3]} (auth=none)")

    if not changed:
        print(f"[{name}] no matches found")
        continue

    payload = {
        "name": w["name"],
        "nodes": w["nodes"],
        "connections": w["connections"],
        "settings": w.get("settings", {}),
    }
    res = req("PUT", f"/workflows/{wid}", body=payload)
    print(f"[{name}] OK — {', '.join(changed)}")

print("\n=== Credential wiring complete ===")
