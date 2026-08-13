"""LANE C / C-a — the real production extraction of the PINNED sVkm transcript bytes.

Authority: AR-1133 §6 (C-a approved; SEAL-GO token NOT to be spent).

Hard rules this script holds to, from that ruling:
  * transcript identity stays pinned to sha256 df72444f…ce99cc — a differing byte string
    REFUSES rather than certifying a different source version;
  * no hand-authored strategy JSON — the extractor's own output is what is saved;
  * output goes to a NEW extraction-certified population, never the frozen Tier-A dir;
  * provenance retained: transcript sha, extraction sha, extractor version pin.

This script performs the EXTRACTION stage only. Grading/certification (pilot_conveyor)
is a separate step, so a failure here cannot be mistaken for a certified record.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3]))

from src.engine.extraction.extractor_bridge import (  # noqa: E402
    RealExtractorError,
    invoke_real_extractor,
    save_extraction,
)

PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
VIDEO_ID = "sVkmZklJDHI"
HERE = pathlib.Path(__file__).resolve().parent


def main() -> int:
    text = (HERE / f"{VIDEO_ID}.transcript.txt").read_text(encoding="utf-8")
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    print(f"transcript chars={len(text)} sha256={h}", flush=True)
    if h != PIN:
        print("ABORT: transcript bytes differ from the pin — REFUSING (AR-1133 §6)", flush=True)
        return 2

    print("invoking the REAL production extractor (gemma via h1-extract-one.ts)…", flush=True)
    t0 = time.time()
    try:
        extraction = invoke_real_extractor(text, VIDEO_ID, timeout_s=1800.0)
    except RealExtractorError as err:
        print(f"EXTRACTOR REFUSED: {err}", flush=True)
        return 3
    elapsed = time.time() - t0

    strategies = extraction.get("strategies") or []
    rejected = extraction.get("rejected_strategies") or []
    print(f"extractor returned in {elapsed:.0f}s", flush=True)
    print(f"  strategies          : {len(strategies)}", flush=True)
    print(f"  rejected_strategies : {len(rejected)}", flush=True)
    print(f"  instrument_class    : {extraction.get('instrument_classification')}", flush=True)
    for i, s in enumerate(strategies):
        name = s.get("strategy_name") or s.get("name") or "<unnamed>"
        conds = s.get("entry_conditions") or s.get("conditions") or []
        print(f"   [{i}] {name} — {len(conds)} conditions", flush=True)

    vault_path = save_extraction(
        str(HERE),
        VIDEO_ID,
        extraction,
        {"transcript_sha256": h, "provenance_class": "EXTRACTION_CERTIFIED_PENDING_GRADING"},
    )
    print(f"vaulted -> {vault_path}", flush=True)

    rec = json.loads(pathlib.Path(vault_path).read_text(encoding="utf-8"))
    print(f"extraction_sha256   : {rec.get('extraction_sha256')}", flush=True)
    print("DONE — extraction stage only. NOT yet certified; grading is a separate step.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
