#!/usr/bin/env python3
"""Fix Strategy Tournament: qwen3 (doesn't exist) → qwen3-coder:30b (actual installed model)."""
import json, urllib.request, re

KEY = open('.env', encoding='utf-8', errors='replace').read().split('N8N_API_KEY=')[1].split()[0].strip('"')
def req(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    headers = {"X-N8N-API-KEY": KEY}
    if body: headers["Content-Type"] = "application/json"
    r = urllib.request.Request(f"http://localhost:5678/api/v1{path}", data=data, method=method, headers=headers)
    return json.loads(urllib.request.urlopen(r, timeout=15).read())

# Patch Strategy Tournament Proposer + Promoter qwen3 references
w = req("GET", "/workflows/hPXhUaSC3ScznZE9")
fixed = []
for n in w["nodes"]:
    if n.get("type") == "n8n-nodes-base.httpRequest" and "qwen" in n["name"].lower():
        params = n.get("parameters", {})
        body = params.get("jsonBody", "")
        if isinstance(body, str):
            # Replace "qwen3" model references but NOT qwen3-coder
            new_body = re.sub(r'"model"\s*:\s*"qwen3"(?!-)', '"model": "qwen3-coder:30b"', body)
            new_body = re.sub(r"'model'\s*:\s*'qwen3'(?!-)", "'model': 'qwen3-coder:30b'", new_body)
            new_body = re.sub(r"model\s*:\s*'qwen3'(?!-)", "model: 'qwen3-coder:30b'", new_body)
            new_body = re.sub(r'model\s*:\s*"qwen3"(?!-)', 'model: "qwen3-coder:30b"', new_body)
            if new_body != body:
                params["jsonBody"] = new_body
                fixed.append(n["name"])

if fixed:
    payload = {
        "name": w["name"],
        "nodes": w["nodes"],
        "connections": w["connections"],
        "settings": w.get("settings", {}),
    }
    res = req("PUT", f"/workflows/{w['id']}", body=payload)
    print(f"OK fixed {len(fixed)} nodes: {fixed}")
else:
    # debug
    for n in w["nodes"]:
        if "qwen" in n["name"].lower():
            body = str(n.get("parameters",{}).get("jsonBody",""))
            for m in re.finditer(r'model[\'":\s]+([^,\s\}\']+)', body[:500]):
                print(f"  {n['name']} model ref: {m.group()}")
    print("No qwen3 refs matched the regex; printed actual matches above")
