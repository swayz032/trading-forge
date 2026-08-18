import json

d = json.load(open(
    "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2.json",
    encoding="utf-8",
))
for o in d["outcomes"]:
    if o["condition_ref"] in ("entry_sequence[1].rationale", "entry_sequence[2].action"):
        print(o["condition_ref"], "own=", o["relevance"]["own_score"], "best_rival=", o["relevance"]["best_rival_score"])
        print("  text_changed:", o["provenance"]["text_changed"])
        print("  original_condition_text_sha256:", o["provenance"]["original_condition_text_sha256"])
        print("  projected_condition_text_sha256:", o["provenance"]["projected_condition_text_sha256"])
