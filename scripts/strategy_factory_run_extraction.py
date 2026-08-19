#!/usr/bin/env python3
"""AR-1338A -- run the real production extractor (extractor_bridge.get_or_extract) once per
source video, vaulted (clause 2: one pass per video, read-once, crash-replaces-whole-video).

Reuses the EXISTING extraction seam byte-for-byte (extractor_bridge.py, unchanged) -- never a
second extractor. `DATABASE_URL` must be present in the environment (the extractor CLI wrapper's
own import chain requires it for a fire-and-forget audit_log telemetry insert, which no-ops
silently if the DB is actually unreachable at call time -- see scripts/h1-extract-one.ts's own
docstring; only the import-time requirement is hard).

Usage:
    DATABASE_URL=<url> python scripts/strategy_factory_run_extraction.py <video_id> [video_id ...]
"""
from __future__ import annotations

import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TRANSCRIPT_DIR = "src/engine/extraction/fixtures/source-evidence"
VAULT_DIR = "docs/replay-results/strategy-factory-census/extraction-vault"


def main() -> int:
    if not os.environ.get("DATABASE_URL"):
        sys.stderr.write(
            "EXTRACTION_BLOCKED: DATABASE_URL not present in environment -- the extractor CLI "
            "wrapper's import chain requires it. Never sourced from .env/vault by this script.\n"
        )
        return 2

    video_ids = sys.argv[1:]
    if not video_ids:
        sys.stderr.write("usage: python scripts/strategy_factory_run_extraction.py <video_id> ...\n")
        return 2

    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.extractor_bridge import get_or_extract, RealExtractorError

    vault_dir_abs = os.path.join(REPO_ROOT, VAULT_DIR)
    results = []
    for video_id in video_ids:
        transcript_path = os.path.join(REPO_ROOT, TRANSCRIPT_DIR, f"{video_id}.transcript.txt")
        if not os.path.exists(transcript_path):
            results.append({"video_id": video_id, "status": "TRANSCRIPT_MISSING"})
            continue
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript_text = f.read()
        try:
            extraction = get_or_extract(vault_dir_abs, video_id, transcript_text)
            strategy_names = [
                s.get("name") for s in (extraction.get("strategies") or []) if isinstance(s, dict)
            ]
            results.append(
                {
                    "video_id": video_id,
                    "status": "EXTRACTED",
                    "strategy_names": strategy_names,
                    "rejected_count": len(extraction.get("rejected_strategies") or []),
                    "empty_reason": extraction.get("empty_reason"),
                }
            )
        except RealExtractorError as exc:
            results.append({"video_id": video_id, "status": "EXTRACTOR_ERROR", "error": str(exc)})

    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0 if all(r["status"] == "EXTRACTED" for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
