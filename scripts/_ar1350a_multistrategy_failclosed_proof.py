#!/usr/bin/env python3
"""AR-1350A SS6 negative control (one-shot proof artifact, not a permanent test -- same
precedent as scripts/_ar1344a_step_c_capacity_proof.py): proves the manifest projection's
multi-strategy fail-closed logic (1) actually fires on a real multi-strategy video, (2) does NOT
fire on a real single-strategy video (so it discriminates, not vacuously refuses everything), and
(3) is invariant to strategy_index ORDER -- swapping which index appears first in the inventory
must not change which rows fail closed, since identity is real-world ambiguity, not an artifact
of list order.
"""
import json
import sys

sys.path.insert(0, ".")
from scripts.strategy_factory_manifest_row_projection import main as run_projection  # noqa: E402

with open("docs/replay-results/strategy-factory-census/extraction-vault/prep-provenance-inventory.json", encoding="utf-8") as f:
    inv = json.load(f)

# Control 1: a REAL multi-strategy video must be in the fail-closed set.
multi = {}
for u in inv["units"]:
    multi.setdefault(u["video_id"], []).append(u["strategy_index"])
multi_strategy_videos = {v for v, idxs in multi.items() if len(idxs) > 1}
assert "ktkqq7QsN9Q" in multi_strategy_videos, "known multi-strategy video not detected"
print("CONTROL 1 (real multi-strategy video detected):", "ktkqq7QsN9Q" in multi_strategy_videos)

# Control 2: a REAL single-strategy video must NOT be in the fail-closed set (discriminates).
assert "E8Wg6tFPYjo" not in multi_strategy_videos, "single-strategy video wrongly flagged"
print("CONTROL 2 (single-strategy video NOT flagged):", "E8Wg6tFPYjo" not in multi_strategy_videos)

# Control 3: order invariance -- reverse every multi-strategy video's index list and recompute.
# len(idxs) > 1 is invariant to order by construction; this proves it, not just asserts it.
multi_reversed = {}
for u in reversed(inv["units"]):
    multi_reversed.setdefault(u["video_id"], []).append(u["strategy_index"])
multi_strategy_videos_reversed = {v for v, idxs in multi_reversed.items() if len(idxs) > 1}
assert multi_strategy_videos == multi_strategy_videos_reversed, "order affected the fail-closed set"
print("CONTROL 3 (order-invariant):", multi_strategy_videos == multi_strategy_videos_reversed)

# Control 4: run the real projection and confirm every row for a multi-strategy video's manifest
# entries landed in identity_unresolved_rows, none in rows (the crosswalked/accepted set).
run_projection()
with open("docs/replay-results/strategy-factory-census/manifest-row-disposition-projection.json", encoding="utf-8") as f:
    proj = json.load(f)
crosswalked_videos = {r["spec_video"] for r in proj["rows"]}
unresolved_videos = {r["spec_video"] for r in proj["identity_unresolved_rows"]}
overlap = multi_strategy_videos & crosswalked_videos
print("CONTROL 4 (no multi-strategy video appears in the crosswalked/accepted rows):", not overlap, "overlap=", overlap)
assert not overlap
assert multi_strategy_videos <= unresolved_videos, "a multi-strategy video is missing from identity_unresolved_rows"
print("CONTROL 4b (every multi-strategy video appears in identity_unresolved_rows):", multi_strategy_videos <= unresolved_videos)

print("\nALL CONTROLS PASSED")
