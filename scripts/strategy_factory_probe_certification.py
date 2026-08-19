#!/usr/bin/env python3
"""AR-1338A investigation-only probe: run pilot_conveyor.prepare_strategy (anchor-location +
tier-1 classification, the EXISTING minimum-call machinery, real anchor_locator gemma calls)
against one already-vaulted extraction, and report the condition-outcome breakdown. Does NOT
dispatch tier-3 adjudication (that requires a human/AI rater reading the built packet -- a
separate, explicitly out-of-scope-for-this-probe step). Read-only investigation to inform
whether AR-1338A's "source-graph certification machinery" can be reused mechanically as-is, or
requires the same multi-round G2D-style campaign sVkm's own history shows it took.
"""
from __future__ import annotations

import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main() -> int:
    video_id = sys.argv[1] if len(sys.argv) > 1 else "75DJN5UVQnw"
    vault_path = os.path.join(
        REPO_ROOT, "docs/replay-results/strategy-factory-census/extraction-vault", f"{video_id}.json"
    )
    transcript_path = os.path.join(
        REPO_ROOT, "src/engine/extraction/fixtures/source-evidence", f"{video_id}.transcript.txt"
    )
    with open(vault_path, "r", encoding="utf-8") as f:
        vault_record = json.load(f)
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = f.read()

    sys.path.insert(0, REPO_ROOT)
    from src.engine.extraction.pilot_conveyor import prepare_strategy

    strategy = vault_record["extraction"]["strategies"][0]
    result = prepare_strategy(
        strategy,
        transcript,
        video_id,
        extractor_version="minimal-8field-pass-l",
        taxonomy_version="v1",
        strategy_index=0,
    )

    outcome_counts: dict[str, int] = {}
    for co in result["condition_outcomes"]:
        outcome_counts[co["outcome"]] = outcome_counts.get(co["outcome"], 0) + 1

    summary = {
        "video_id": video_id,
        "spine_condition_count": result["spine_condition_count"],
        "unanchored_count": len(result["unanchored_conditions"]),
        "condition_outcome_counts": outcome_counts,
        "tier1_classified_count": len(result["tier1_detections"]),
        "tier1_fallthrough_count": len(result["tier1_fallthroughs"]),
        "tier3_packet_set_b_items": len(
            [it for s in result["tier3_packet"]["sections"] if s.get("section_id") == "SET-B" for it in s.get("items", [])]
        ),
        "leak_scan_clean": result["leak_scan"].clean,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
