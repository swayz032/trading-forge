"""sVkm LANE B — stop-geometry context proof (AR-1200 §6). READ-ONLY.

AR-1200 refuses to authorize a geometry guess from two isolated phrases and asks for a
tiny source-context artifact: >=±300 chars around each of the two stop statements, plus
the preceding trade-direction / example context, plus whether the two statements belong
to the same example, opposite-direction examples, or different teaching passes.

🛑 NO SEMANTIC REWRITE, NO CODE CHANGE, NO GEOMETRY DECISION. This script emits transcript
context and mechanically-derived direction markers only. Whether the two statements are
contradictory is left to GPT (§6).

Run from repo root:
  python scripts/svkm_laneB_stop_geometry_context.py --transcript <pinned.txt>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
GRADE_DIR = os.path.join(POP_DIR, "grade")
WINDOW = 400  # >= the ±300 AR-1200 §6 requires

STATEMENTS = [
    ("STOP-A / fair value CANDLE",
     "what I want you to do for the stop loss is we're just going to put it at the bottom of the fair value candle"),
    ("STOP-B / fair value GAP",
     "We would put our stop to the low of the fair value gap would be just there including the wick."),
]

# Mechanical direction markers only — no interpretation.
DIRECTION_TOKENS = ["short tool", "long tool", "short", "long", "downside", "upside",
                    "sell", "buy", "another example", "next example"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True)
    args = ap.parse_args()

    transcript = open(args.transcript, encoding="utf-8", newline="").read()
    tsha = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    print(f"[laneB] transcript chars={len(transcript)} sha256={tsha}")
    if tsha != TRANSCRIPT_PIN:
        print("[laneB] ABORT: transcript differs from the pin — REFUSING.")
        return 2

    # Where does the teacher start a NEW example? Mechanical boundary markers.
    example_starts = [(m.start(), transcript[m.start():m.start() + 90])
                      for m in re.finditer(r"take a look at another example|another example", transcript)]
    print(f"[laneB] example-boundary markers: {[s for s, _ in example_starts]}")

    out = []
    for label, marker in STATEMENTS:
        i = transcript.find(marker)
        if i < 0:
            print(f"[laneB] MARKER NOT FOUND for {label}")
            out.append({"label": label, "error": "marker not found"})
            continue
        s = max(0, i - WINDOW)
        e = min(len(transcript), i + len(marker) + WINDOW)
        ctx = transcript[s:e]

        # which example does this statement fall in?
        prior = [p for p, _ in example_starts if p < i]
        example_index = len(prior)  # 0 = before any "another example" marker

        preceding = transcript[max(0, i - 1200):i]
        found_dirs = []
        for tok in DIRECTION_TOKENS:
            for m in re.finditer(re.escape(tok), preceding):
                found_dirs.append({"token": tok, "char": max(0, i - 1200) + m.start()})
        found_dirs.sort(key=lambda d: d["char"])

        print("=" * 78)
        print(f"[laneB] {label}  @char {i}   example_index={example_index}")
        print(f"[laneB] direction markers in the preceding 1200 chars: "
              f"{[d['token'] for d in found_dirs]}")
        print(f"[laneB] CONTEXT [{s}..{e}]:")
        print("  " + ctx.replace("\n", " "))
        out.append({
            "label": label,
            "statement": marker,
            "char": i,
            "context_char_span": [s, e],
            "context": ctx,
            "example_index": example_index,
            "preceding_direction_markers": found_dirs,
        })

    same_example = None
    if len(out) == 2 and all("error" not in o for o in out):
        same_example = out[0]["example_index"] == out[1]["example_index"]
        print("=" * 78)
        print(f"[laneB] STOP-A example_index={out[0]['example_index']}  "
              f"STOP-B example_index={out[1]['example_index']}  same_example={same_example}")

    artifact = {
        "artifact": "svkm-laneB-stop-geometry-context",
        "ruling": "AR-1200 §6 LANE B",
        "transcript_sha256": tsha,
        "window_chars": WINDOW,
        "example_boundary_markers": [{"char": s, "text": t} for s, t in example_starts],
        "statements": out,
        "same_example": same_example,
        "worker_resolved_geometry": False,
        "note": ("Direction markers are MECHANICAL token hits in the preceding 1200 chars, not an "
                 "interpretation. Whether the two statements are contradictory after context is "
                 "left to GPT per AR-1200 §6. No geometry decision was made here."),
    }
    os.makedirs(GRADE_DIR, exist_ok=True)
    path = os.path.join(GRADE_DIR, "laneB_stop_geometry_context.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, path)
    print(f"\n[laneB] wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
