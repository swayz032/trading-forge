"""sVkm GRADE — PHASE 1 driver (conductor-authored; consumes the FROZEN instrument, does NOT modify it).

Authority: AR-1138 §4/§5 + AR-1140 §3 — run the real `pilot_conveyor` grounding/tiering
path against the EXACT pinned sVkm extraction.

Why this exists instead of `scripts/h1_pilot_phase1.py`: that driver iterates the SEALED
Tier-A set (`docs/designs/h1-sealed-fresh-set-2026-07-12.json`) and writes into the frozen
`pilot-run/` population. AR-1138 forbids touching that population or spending the SEAL-GO
token. This driver runs the SAME instrument functions over the ONE pinned sVkm extraction
and writes only into the sVkm population. It re-uses phase 1's own `robust_propose` seam
and its own `prep_json_view`/`jsonable` helpers BY IMPORT — no re-authored instrument.

Hard refusals (any one aborts before the extractor output is touched):
  * transcript bytes whose sha256 != the pin;
  * extraction record whose `extraction_sha256` != the pin.

This is the GROUNDING/TIERING stage. It does NOT emit a certificate: tier-3 items require a
real blind rater (phase 2/3), and `finalize_certificate` is a separate step.

Run from repo root:
  python scripts/svkm_grade_phase1.py --transcript <path-to-pinned-transcript.txt>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pickle
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import pilot_conveyor as pc  # noqa: E402

# Re-use phase 1's OWN seam + views rather than re-authoring them (AR-1138: adapt, do not author).
import h1_pilot_phase1 as p1  # noqa: E402

VIDEO_ID = "sVkmZklJDHI"
TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
EXTRACTION_PIN = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"

POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
EXTRACTION_PATH = os.path.join(POP_DIR, f"{VIDEO_ID}.json")
GRADE_DIR = os.path.join(POP_DIR, "grade")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True, help="path to the pinned transcript bytes (utf-8)")
    args = ap.parse_args()

    os.makedirs(GRADE_DIR, exist_ok=True)

    # ---- REFUSAL GATE 1: transcript identity -------------------------------
    transcript = open(args.transcript, encoding="utf-8", newline="").read()
    tsha = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    print(f"[svkm] transcript chars={len(transcript)} sha256={tsha}", flush=True)
    if tsha != TRANSCRIPT_PIN:
        print("[svkm] ABORT: transcript bytes differ from the pin — REFUSING (AR-1138 §5).")
        return 2

    # ---- REFUSAL GATE 2: extraction identity -------------------------------
    record = json.loads(open(EXTRACTION_PATH, encoding="utf-8").read())
    esha = record.get("extraction_sha256")
    print(f"[svkm] extraction_sha256={esha}", flush=True)
    if esha != EXTRACTION_PIN:
        print("[svkm] ABORT: extraction record differs from the pin — REFUSING (AR-1138 §5).")
        return 2
    extraction = record["extraction"]
    strategies = extraction.get("strategies") or []
    print(f"[svkm] strategies={len(strategies)} "
          f"instrument_classification={extraction.get('instrument_classification')}", flush=True)

    extractor_version = pc.extractor_version_pin(ROOT)
    print(f"[svkm] extractor_version={extractor_version}", flush=True)
    print(f"[svkm] taxonomy_version={p1.TAXONOMY_VERSION}", flush=True)
    print("[svkm] running REAL anchor-locator (gemma) + tier-1 + 3-axis dual-read …", flush=True)

    preps = pc.prepare_video(
        extraction,
        transcript,
        VIDEO_ID,
        extractor_version,
        p1.TAXONOMY_VERSION,
        full_transcript_sha256=tsha,
        propose_fn=p1.robust_propose,
    )

    views = [p1.prep_json_view(p) for p in preps]
    rollup = {
        "spine_conditions": sum(v["spine_condition_count"] for v in views),
        "anchored": sum(v["anchor_report"]["anchored_count"] for v in views),
        "unanchored": sum(v["anchor_report"]["unanchored_count"] for v in views),
        "tier1_classified": sum(v["tier1_classified_count"] for v in views),
        "tier1_fallthrough": sum(v["tier1_fallthrough_count"] for v in views),
        "axis2_zero_content_overlap": sum(
            v["outcome_counts"].get("fallthrough_axis2_zero_content_overlap", 0) for v in views
        ),
        "axis3_audit_items": sum(1 for v in views if v["axis3_audit"] and v["axis3_audit"].get("char_span")),
        "leak_scan_clean_all": all(v["leak_scan_clean"] for v in views),
        "propose_abstain_by_parse_failure": p1.PROPOSE_ABSTAIN_BY_PARSE_FAILURE[0],
    }
    rollup["tier3_targets"] = rollup["tier1_fallthrough"] + rollup["axis3_audit_items"]

    artifact = {
        "artifact": "svkm-grade-phase1",
        "video_id": VIDEO_ID,
        "transcript_sha256": tsha,
        "transcript_char_count": len(transcript),
        "extraction_sha256": esha,
        "extractor_version": extractor_version,
        "taxonomy_version": p1.TAXONOMY_VERSION,
        "strategies_extracted": len(strategies),
        "strategies": views,
        "rollup": rollup,
        "stage": "GROUNDING_TIERING_ONLY — no certificate emitted here",
    }

    out_json = os.path.join(GRADE_DIR, "phase1.json")
    tmp = out_json + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, out_json)

    out_pkl = os.path.join(GRADE_DIR, "phase1_preps.pkl")
    tmp = out_pkl + f".{os.getpid()}.tmp"
    with open(tmp, "wb") as fh:
        pickle.dump({"extractor_version": extractor_version,
                     "taxonomy_version": p1.TAXONOMY_VERSION,
                     "preps": preps}, fh)
    os.replace(tmp, out_pkl)

    print(f"[svkm] wrote {out_json}", flush=True)
    print(f"[svkm] ROLLUP: {json.dumps(rollup)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
