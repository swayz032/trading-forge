#!/usr/bin/env python3
"""
Three surgical fixes for production bugs found during workflow execution:
1. 5N Trigger 5O — executeWorkflow node workflowId schema (current: bare string, needs: {value, mode})
2. Strategy Tournament Proposer + Promoter — localhost:11434 → host.docker.internal:11434
3. 5K POST Parallel Task — JSON schema for entry_params/exit_params missing additionalProperties
"""
import json
import urllib.request

def load_env():
    env = {}
    with open(".env", encoding="utf-8", errors="replace") as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, _, v = line.strip().partition("=")
                env[k] = v.strip().strip('"')
    return env

ENV = load_env()
N8N = "http://localhost:5678/api/v1"
KEY = ENV["N8N_API_KEY"]

def req(method, path, body=None):
    url = f"{N8N}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    headers = {"X-N8N-API-KEY": KEY}
    if body: headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(r, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

def put_workflow(w, msg):
    payload = {
        "name": w["name"],
        "nodes": w["nodes"],
        "connections": w["connections"],
        "settings": w.get("settings", {}),
    }
    res = req("PUT", f"/workflows/{w['id']}", body=payload)
    if "id" in res:
        print(f"[{w['name']}] OK — {msg}")
    else:
        print(f"[{w['name']}] FAILED: {res}")

# === Bug #1: 5N Trigger 5O ===
w = req("GET", "/workflows/4qVyxZd29pQkGn9p")
fixed_b1 = []
for n in w["nodes"]:
    if n.get("type") == "n8n-nodes-base.executeWorkflow":
        params = n.setdefault("parameters", {})
        wid = params.get("workflowId")
        # if it's a bare string, wrap it
        if isinstance(wid, str):
            params["workflowId"] = {"value": wid, "mode": "list", "cachedResultName": "5O-supadata-transcript-pipeline"}
            fixed_b1.append(n["name"])
        # ensure source is set
        if "source" not in params:
            params["source"] = "database"
            fixed_b1.append(f"{n['name']}:source")
if fixed_b1:
    put_workflow(w, f"executeWorkflow nodes fixed: {fixed_b1}")
else:
    print(f"[5N] no executeWorkflow nodes to fix")

# === Bug #2: Strategy Tournament localhost → host.docker.internal ===
w = req("GET", "/workflows/hPXhUaSC3ScznZE9")
fixed_b2 = []
for n in w["nodes"]:
    if n.get("type") == "n8n-nodes-base.httpRequest":
        params = n.get("parameters", {})
        url = params.get("url", "")
        if "localhost" in url:
            params["url"] = url.replace("localhost", "host.docker.internal")
            fixed_b2.append(f"{n['name']}: {url} → {params['url']}")
if fixed_b2:
    put_workflow(w, f"localhost->host.docker.internal: {len(fixed_b2)} nodes")
    for f in fixed_b2: print(f"  - {f.replace(chr(0x2192), '->')}")
else:
    print(f"[Strategy Tournament] no localhost URLs found")

# === Bug #3: 5K Parallel — fix entry_params/exit_params schema ===
w = req("GET", "/workflows/lUenVARPUG1uz4OE")
fixed_b3 = []
for n in w["nodes"]:
    if "Parallel" in n["name"] and n.get("type") == "n8n-nodes-base.httpRequest":
        params = n.get("parameters", {})
        body = params.get("jsonBody", "")
        if isinstance(body, str) and "entry_params" in body:
            new_body = body
            # Replace `entry_params: { type: 'object' }` → `entry_params: { type: 'object', additionalProperties: true }`
            new_body = new_body.replace(
                "entry_params: { type: 'object' }",
                "entry_params: { type: 'object', additionalProperties: true }",
            )
            new_body = new_body.replace(
                "exit_params: { type: 'object' }",
                "exit_params: { type: 'object', additionalProperties: true }",
            )
            if new_body != body:
                params["jsonBody"] = new_body
                fixed_b3.append(f"{n['name']}: added additionalProperties to entry_params/exit_params")
if fixed_b3:
    put_workflow(w, "JSON schema fixed")
    for f in fixed_b3: print(f"  - {f}")
else:
    print(f"[5K] no Parallel JSON body matches found — body shape may have changed")
    # debug: print body snippet
    for n in w["nodes"]:
        if "Parallel" in n["name"]:
            body = n.get("parameters", {}).get("jsonBody", "")[:600]
            print(f"  body snippet: {body}")
