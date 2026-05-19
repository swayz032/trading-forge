#!/usr/bin/env python3
"""
Bulk production-hardening pass on all active n8n workflows.

Three fixes applied per workflow:
  1. settings.errorWorkflow = ZZ-global-error-handler ID  (catches workflow-halt failures → Discord)
  2. IF nodes: typeValidation strict → loose                (the documented strict-mode bug)
  3. HTTP nodes: retryOnFail=true, maxTries=2, waitBetweenTries=1000 (transient resilience)

Skipped: HTTP onError modifications (some are intentional, e.g. quantum pre-flight cache).
"""
import json
import os
import sys
import urllib.request
import urllib.error

N8N_BASE = "http://localhost:5678/api/v1"
ERR_WF_ID = "BbCvlV1ARyyvY3NI"
SKIP_IDS = {ERR_WF_ID}  # don't touch the error handler itself

def load_api_key():
    with open(".env", encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("N8N_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("N8N_API_KEY not found in .env")

API_KEY = load_api_key()

def req(method, path, body=None):
    url = f"{N8N_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    headers = {"X-N8N-API-KEY": API_KEY}
    if body:
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode("utf-8", errors="replace")[:400]}

def fix_workflow(w):
    """Returns (updated_payload, changes_summary) or (None, 'no-op')."""
    if w["id"] in SKIP_IDS:
        return None, "skipped (error handler self)"

    changes = []
    # 1. errorWorkflow
    settings = dict(w.get("settings", {}))
    if settings.get("errorWorkflow") != ERR_WF_ID:
        settings["errorWorkflow"] = ERR_WF_ID
        changes.append("errorWf")

    # 2 & 3. node-level fixes
    nodes = []
    for n in w["nodes"]:
        n2 = dict(n)
        ntype = n2.get("type", "")
        # IF nodes — flip strict to loose
        if ntype.endswith(".if"):
            params = dict(n2.get("parameters", {}))
            opts = dict(params.get("options", {}))
            if opts.get("typeValidation", "strict") == "strict":
                opts["typeValidation"] = "loose"
                params["options"] = opts
                n2["parameters"] = params
                changes.append(f"IF:{n2['name']}")
        # HTTP nodes — add retry on transient failures
        if ntype.endswith(".httpRequest"):
            if not n2.get("retryOnFail"):
                n2["retryOnFail"] = True
                n2["maxTries"] = 2
                n2["waitBetweenTries"] = 1000
                changes.append(f"HTTP:{n2['name']}")
        nodes.append(n2)

    if not changes:
        return None, "no-op"

    payload = {
        "name": w["name"],
        "nodes": nodes,
        "connections": w["connections"],
        "settings": settings,
    }
    return payload, ", ".join(changes)

def main():
    res = req("GET", "/workflows?active=true")
    workflows = res.get("data", [])
    print(f"Auditing {len(workflows)} active workflows...\n")
    print(f"{'workflow_id':<22} | {'name':<38} | result")
    print("-" * 110)

    updated = 0
    skipped = 0
    failed = 0
    for w in workflows:
        payload, summary = fix_workflow(w)
        name = w.get("name", "")[:38]
        if payload is None:
            skipped += 1
            print(f"{w['id']:<22} | {name:<38} | {summary}")
            continue
        resp = req("PUT", f"/workflows/{w['id']}", body=payload)
        if "_http_error" in resp:
            failed += 1
            print(f"{w['id']:<22} | {name:<38} | FAILED {resp['_http_error']}: {resp['_body'][:200]}")
        else:
            updated += 1
            print(f"{w['id']:<22} | {name:<38} | OK [{summary[:80]}]")

    print()
    print(f"=== Summary: updated={updated}, skipped={skipped}, failed={failed} ===")

if __name__ == "__main__":
    main()
