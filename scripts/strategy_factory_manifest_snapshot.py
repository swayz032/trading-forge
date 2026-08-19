#!/usr/bin/env python3
"""AR-1328A / AR-1333A Packet A -- freeze the live strategy-library manifest.

A COMMITTED GENERATOR REPRODUCES THE RULE, NOT THE ANSWER (R-710 precedent,
canonical_regression_population.txt): this script is the durable, re-runnable
definition of "how the Strategy Factory manifest is derived from the live
library", so a future session (or GPT) can regenerate and byte-verify it
rather than trust a hand-transcribed copy.

Per AR-1333A S2: uses the already-deployed read-only strategies endpoint
(GET /api/strategies?includeArchived=true), never a raw DB credential. Fails
closed and loudly if API_KEY is not already present in the environment --
never reads .env/vault itself.

Membership identity is strategy.id (AR-1333A S1); name is descriptive only,
never a dedupe key. Ordering is deterministic: (name, strategy_id).

Usage:
    API_KEY=<key> python scripts/strategy_factory_manifest_snapshot.py
Optional:
    TF_API_BASE_URL (default http://localhost:4000)
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

OUT_DIR = "docs/replay-results/strategy-factory-census"
HISTORICAL_POP_120_LIVE = 120  # R-418/R-422 measured 2026-07-28; NOT forced (AR-1333A S1)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_raw_snapshot() -> bytes:
    api_key = os.environ.get("API_KEY")
    if not api_key:
        sys.stderr.write(
            "POPULATION_SNAPSHOT_ACCESS_BLOCKED: API_KEY not present in environment. "
            "This script never reads .env/vault itself -- set API_KEY before running.\n"
        )
        sys.exit(2)
    base_url = os.environ.get("TF_API_BASE_URL", "http://localhost:4000")
    req = urllib.request.Request(
        f"{base_url}/api/strategies?includeArchived=true",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def derive_manifest(rows: list[dict]) -> list[dict]:
    def row_source(row: dict) -> dict:
        meta = (row.get("config") or {}).get("metadata") or {}
        return {
            "source_url": meta.get("source_url"),
            "extraction_provenance": meta.get("extraction_provenance"),
            "spec_hash": meta.get("spec_hash"),
            "graph_canonical_hash": meta.get("graph_canonical_hash"),
            "corpus_version": meta.get("corpus_version"),
            "pipeline_version": meta.get("pipeline_version"),
            "metadata_source": meta.get("source"),
        }

    members = [
        {
            "strategy_id": row["id"],
            "name": row["name"],
            "symbol": row.get("symbol"),
            "symbols": row.get("symbols"),
            "timeframe": row.get("timeframe"),
            "lifecycle_state": row.get("lifecycleState"),
            "tags": row.get("tags"),
            "generation": row.get("generation"),
            "parent_strategy_id": row.get("parentStrategyId"),
            "source": row_source(row),
            "created_at": row.get("createdAt"),
        }
        for row in rows
    ]
    members.sort(key=lambda m: (m["name"], m["strategy_id"]))
    return members


def compute_stats(rows: list[dict], manifest: list[dict]) -> dict:
    ids = [r["id"] for r in rows]
    names = [r["name"] for r in rows]
    name_groups: dict[str, int] = {}
    for n in names:
        name_groups[n] = name_groups.get(n, 0) + 1
    dup_names = {n: c for n, c in name_groups.items() if c != 1}
    lifecycle: dict[str, int] = {}
    for r in rows:
        state = r.get("lifecycleState")
        lifecycle[state] = lifecycle.get(state, 0) + 1
    archived_duplicate = sum(
        1 for r in rows if r.get("tags") and "archived_duplicate" in r["tags"]
    )
    missing_source_url = sum(1 for m in manifest if not m["source"]["source_url"])
    return {
        "total_rows": len(rows),
        "unique_ids": len(set(ids)),
        "unique_names": len(set(names)),
        "duplicate_name_groups": dup_names,
        "lifecycle_distribution": lifecycle,
        "archived_duplicate_tagged": archived_duplicate,
        "missing_source_url": missing_source_url,
        "historical_pop_120_live_delta": len(rows) - HISTORICAL_POP_120_LIVE,
    }


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    raw_bytes = fetch_raw_snapshot()
    raw_hash = _sha256(raw_bytes)
    rows = json.loads(raw_bytes)

    manifest = derive_manifest(rows)
    manifest_bytes = json.dumps(manifest, indent=2, sort_keys=False, ensure_ascii=False).encode(
        "utf-8"
    )
    manifest_hash = _sha256(manifest_bytes)

    stats = compute_stats(rows, manifest)
    fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    raw_path = os.path.join(OUT_DIR, "raw-snapshot-v1.1.json")
    manifest_path = os.path.join(OUT_DIR, "library-manifest-v1.1.json")
    receipt_path = os.path.join(OUT_DIR, "manifest-receipt-v1.1.json")

    with open(raw_path, "wb") as f:
        f.write(raw_bytes)
    with open(manifest_path, "wb") as f:
        f.write(manifest_bytes)

    receipt = {
        "artifact": "strategy-factory-library-manifest-v1.1",
        "fetched_at_utc": fetched_at,
        "endpoint": "GET /api/strategies?includeArchived=true",
        "authority": "AR-1333A S1 -- live strategies DB table, membership identity = strategy.id",
        "raw_snapshot_path": raw_path,
        "raw_snapshot_sha256": raw_hash,
        "raw_snapshot_bytes": len(raw_bytes),
        "manifest_path": manifest_path,
        "manifest_sha256": manifest_hash,
        "manifest_member_count": len(manifest),
        "ordering": "(name, strategy_id) ascending",
        "stats": stats,
    }
    with open(receipt_path, "w", encoding="utf-8") as f:
        json.dump(receipt, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(json.dumps(receipt, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
