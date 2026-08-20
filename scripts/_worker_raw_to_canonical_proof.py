#!/usr/bin/env python3
"""AR-1376A Sec4 provenance hardening proof, for the three round-2 fresh-Opus candidates.

Proves, per case:
  1. the raw Opus JSON contains no duplicate object keys;
  2. parsing the raw artifact with duplicate-key rejection succeeds;
  3. deterministic canonical re-serialization of that parsed object exactly equals the frozen
     candidate bytes;
  4. both the raw SHA and frozen-candidate SHA are recorded.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

REPO_ROOT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815")
RUNS_ROOT = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus"
VIDEO_IDS = ["E8Wg6tFPYjo", "7ieYBa7Z-Hg", "1HFoStW_wsc"]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def reject_duplicate_keys(pairs):
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"duplicate object key: {key!r}")
        seen[key] = value
    return seen


def main() -> None:
    results = {}
    for video_id in VIDEO_IDS:
        out_dir = RUNS_ROOT / video_id
        raw_path = out_dir / "raw_opus_response.txt"
        candidate_path = out_dir / "fresh_source_candidate.json"

        raw_bytes = raw_path.read_bytes()
        raw_sha = sha256_bytes(raw_bytes)

        # Step 1+2: parse with duplicate-key rejection.
        parsed = json.loads(raw_bytes.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
        no_duplicate_keys = True  # json.loads would have raised ValueError above otherwise

        # Step 3: canonical re-serialization must exactly equal the frozen candidate bytes.
        # This is the EXACT transformation the freeze script (_worker_freeze_fresh_opus_file_first.py)
        # applies: json.dumps(candidate, indent=2, ensure_ascii=False) + "\n".
        canonical_bytes = (json.dumps(parsed, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        canonical_sha = sha256_bytes(canonical_bytes)

        frozen_bytes = candidate_path.read_bytes()
        frozen_sha = sha256_bytes(frozen_bytes)

        canonical_matches_frozen = (canonical_bytes == frozen_bytes)

        results[video_id] = {
            "video_id": video_id,
            "no_duplicate_object_keys": no_duplicate_keys,
            "duplicate_key_rejecting_parse_succeeded": True,
            "raw_response_sha256": raw_sha,
            "canonical_reserialization_sha256": canonical_sha,
            "frozen_candidate_sha256": frozen_sha,
            "canonical_reserialization_exactly_equals_frozen_candidate": canonical_matches_frozen,
            "raw_sha_equals_frozen_sha": raw_sha == frozen_sha,
        }
        status = "PASS" if canonical_matches_frozen else "FAIL"
        print(f"[{video_id}] {status}  raw={raw_sha[:16]}...  canonical_reser={canonical_sha[:16]}...  "
              f"frozen={frozen_sha[:16]}...  raw==frozen={raw_sha == frozen_sha}")
        if not canonical_matches_frozen:
            raise SystemExit(f"[{video_id}] canonical re-serialization does NOT match frozen candidate bytes")

    proof_path = REPO_ROOT / "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus/raw-to-canonical-provenance-proof.json"
    proof_path.write_text(json.dumps({
        "artifact": "raw-to-canonical-provenance-hardening-proof-v1",
        "ruling": "AR-1376A Sec4",
        "cases": results,
        "conclusion": (
            "For all three round-2 fresh-Opus candidates: the raw Opus response contains no "
            "duplicate object keys, a duplicate-key-rejecting parse succeeds, and canonical "
            "re-serialization of the parsed object exactly equals the frozen "
            "fresh_source_candidate.json bytes. The freeze script's implicit "
            "json.loads -> json.dumps(indent=2, ensure_ascii=False) transformation is a pure "
            "deterministic formatting normalization (re-serialization), not a semantic alteration -- "
            "proven, not merely asserted."
        ),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"\nPROOF WRITTEN: {proof_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
