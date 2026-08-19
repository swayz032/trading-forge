import json, subprocess, sys
from pathlib import Path

REPO = Path(r"C:\Users\tonio\Projects\wt-gpt-engineering-diag")
OUT = Path(r"C:\Users\tonio\Projects\wt-claude-worker1-20260815\docs\replay-results\gpt-engineering\opus-transcript-first-diagnostic\_worker1-novel-attack-scratch-runs")
VIDEO = "1HFoStW_wsc"

subprocess.run([sys.executable, "scripts/strategy_factory_opus_transcript_first_diagnostic.py",
                 "--out-dir", str(OUT), "emit", "--video-id", VIDEO], check=True, cwd=REPO)

index = json.loads((OUT / VIDEO / "task_index.json").read_text())

candidate = {
    "video_id": VIDEO,
    "reader_role": "OPUS_LEAD_SOURCE_READER",
    "instrument_classification": None,
    "strategies": [],
    "top_level_source_gaps": [
        {"field": "strategy", "reason": "novel-attack synthetic candidate, not a real Opus read"}
    ],
}
(OUT / VIDEO / "raw_response.json").write_text(json.dumps(candidate))

receipt = {
    "video_id": VIDEO,
    "task_sha256": index["task_sha256"],
    "transcript_sha256": index["transcript_sha256"],
    "model_override": "opus",
    "actual_model_identity": "NOVEL-ATTACK: not a real model call",
    "subagent_type": "general-purpose",
    "reader_role": "OPUS_LEAD_SOURCE_READER",
    "fresh_reader": True,
    "prompt_source": "task_file_only",
    "legacy_semantics_visible": False,
}
(OUT / VIDEO / "invocation_receipt.json").write_text(json.dumps(receipt))
print("SETUP DONE")
print(json.dumps(index, indent=2))
