#!/usr/bin/env python3
"""Diagnose latest failure for every workflow that has had any error in the last 7 days."""
import json
import urllib.request
from collections import defaultdict

N8N = "http://localhost:5678/api/v1"

def load_key():
    with open(".env", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("N8N_API_KEY="):
                return line.split("=",1)[1].strip().strip('"')

KEY = load_key()

def get(path):
    r = urllib.request.Request(f"{N8N}{path}", headers={"X-N8N-API-KEY": KEY})
    with urllib.request.urlopen(r, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))

# 1. Get all active workflows
wfs = get("/workflows?active=true")["data"]
wf_names = {w["id"]: w["name"] for w in wfs}

# 2. Get last 200 executions to find failing workflows
execs = get("/executions?limit=200")["data"]

# 3. Latest failure per workflow
latest_fail_per_wf = {}
for e in execs:
    if e.get("status") in ("error", "crashed", "failed") and e.get("mode") == "trigger":
        wid = e["workflowId"]
        if wid not in latest_fail_per_wf or e["startedAt"] > latest_fail_per_wf[wid]["startedAt"]:
            latest_fail_per_wf[wid] = e

print(f"Workflows with any failed trigger execution in last 200 runs: {len(latest_fail_per_wf)}\n")

# 4. For each, fetch full execution and extract root cause
for wid, e in sorted(latest_fail_per_wf.items(), key=lambda x: x[1]["startedAt"], reverse=True):
    name = wf_names.get(wid, wid)
    eid = e["id"]
    try:
        full = get(f"/executions/{eid}?includeData=true")
    except Exception as exc:
        print(f"[{name[:35]:<35}] {e['startedAt'][:19]} | could not fetch: {exc}")
        continue
    data = full.get("data") or {}
    rd = data.get("resultData") if isinstance(data, dict) else None
    err = rd.get("error") if isinstance(rd, dict) else None
    last_node = rd.get("lastNodeExecuted") if isinstance(rd, dict) else None
    if err:
        msg = err.get("message", "")[:160]
        ename = err.get("name", "")
        node = err.get("node")
        node_name = node.get("name") if isinstance(node, dict) else node or last_node
        print(f"[{name[:35]:<35}] {e['startedAt'][:19]} | {ename} @ {node_name}")
        print(f"    msg: {msg}")
    else:
        print(f"[{name[:35]:<35}] {e['startedAt'][:19]} | unknown error (no resultData.error); lastNode={last_node}")
