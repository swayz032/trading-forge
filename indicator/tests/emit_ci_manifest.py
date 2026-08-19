"""Emit machine-readable verification provenance after a successful CI step."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TRACKED_ROOTS = [ROOT / "indicator" / "reference", ROOT / "indicator" / "spec", ROOT / "indicator" / "tests"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_fingerprint() -> tuple[str, list[dict[str, str]]]:
    files = []
    for base in TRACKED_ROOTS:
        if not base.exists():
            continue
        for path in sorted(p for p in base.rglob("*") if p.is_file() and "__pycache__" not in p.parts):
            rel = path.relative_to(ROOT).as_posix()
            digest = sha256_file(path)
            files.append({"path": rel, "sha256": digest})
    joined = "\n".join(f"{x['path']}:{x['sha256']}" for x in files).encode()
    return hashlib.sha256(joined).hexdigest(), files


def main() -> None:
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "indicator-verification-manifest.json")
    suite = os.environ.get("INDICATOR_VERIFICATION_SUITE", "unknown")
    fingerprint, files = tree_fingerprint()
    manifest = {
        "schema_version": 1,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "suite": suite,
        "result": "PASS_REACHED_MANIFEST_STEP",
        "git_sha": os.environ.get("GITHUB_SHA", "local"),
        "git_ref": os.environ.get("GITHUB_REF", "local"),
        "github_run_id": os.environ.get("GITHUB_RUN_ID"),
        "github_run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "os": platform.platform(),
        "python_hash_seed": os.environ.get("PYTHONHASHSEED"),
        "indicator_tree_sha256": fingerprint,
        "tracked_files": files,
    }
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(output)
    print(f"indicator_tree_sha256={fingerprint}")


if __name__ == "__main__":
    main()
