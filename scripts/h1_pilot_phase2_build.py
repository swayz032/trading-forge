"""H1 pilot — PHASE 2 rater-packet builder (conductor-authored). Consolidates every per-strategy
two-stage tier-3 packet the instrument produced in Phase 1 into ONE blind rater dispatch:

  stage1_packet.json  — Set-A controls (10) + ALL Set-B fall-through + AUDIT target quotes, QUOTE ALONE
                        (no condition text). This is what a blind rater sees FIRST.
  stage2_packet.json  — per target item_id: the quote + the extractor's revealed condition text +
                        support taxonomy. Sent/read ONLY after stage-1 role calls are committed
                        (read-order lock, Addendum 4 FIX 2).

Re-runs the house leak-scan on every original per-strategy packet before emitting (pre-reg §3), and
asserts the consolidated stage-1 view carries no condition text by construction. Run from repo root.
"""
from __future__ import annotations

import glob
import json
import os
import pickle
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402

OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run")
PREP_DIR = os.path.join(OUT_DIR, "preps")
PKT_DIR = os.path.join(OUT_DIR, "rater-packets")
WAVE1 = os.path.join(ROOT, "docs", "designs", "h1-wave1-shakedown-packets-2026-07-12.json")
os.makedirs(PKT_DIR, exist_ok=True)


def load_all_preps():
    """Prefer per-video checkpoints under preps/ (works for partial or full runs); this is how the
    builder can package the cached videos for blind rating during a fetch-throttle wait (operator
    Addendum 8 §2 embargo: rate per-item now, aggregate NOTHING until all 16). Falls back to the
    combined phase1_preps.pkl if present."""
    per_video = sorted(glob.glob(os.path.join(PREP_DIR, "*.pkl")))
    if per_video:
        out = []
        for p in per_video:
            with open(p, "rb") as fh:
                rec = pickle.load(fh)
            out.append((rec["meta"], rec["preps"]))
        return out
    with open(os.path.join(OUT_DIR, "phase1_preps.pkl"), "rb") as fh:
        return pickle.load(fh)["all_preps"]


def run() -> None:
    all_preps = load_all_preps()
    print(f"[phase2] packaging {len(all_preps)} videos (from per-video checkpoints)")
    with open(WAVE1, encoding="utf-8") as fh:
        w1 = json.load(fh)
    set_a = next(s for s in w1["sections"] if s["section_id"] == "SET-A")
    closed_taxonomy = w1["closed_taxonomy"]

    set_a_controls = [
        {"item_id": it["item_id"], "quote": it["quote_anchor"]["verbatim"]}
        for it in set_a["items"]
    ]

    targets = []          # stage-1: quote alone
    stage2_items = []     # stage-2: quote + revealed condition text
    manifest = []         # bookkeeping: item_id -> {video_id, strategy_index, span, kind}
    leak_violations = []

    for meta, preps in all_preps:
        for prep in preps:
            packet = prep["tier3_packet"]
            scan = pc.blinding_leak_scan(packet)
            if not scan.clean:
                leak_violations.append({"video": prep["video_id"], "strategy": prep["strategy_index"], "violations": scan.violations})
            span_map = prep["item_span_map"]          # item_id -> (s,e)
            transcript = prep["full_transcript"]
            # Stage-2 condition text lives in packet["stage2"]["items"] keyed by item_id
            cond_by_id = {it["item_id"]: it.get("extracted_condition_text", "") for it in packet["stage2"]["items"]}
            audit_ids = {it["item_id"] for it in packet["stage2"]["items"] if it.get("audit")}
            for item_id, span in span_map.items():
                s, e = span
                quote = transcript[s:e]
                kind = "audit" if item_id in audit_ids else "fallthrough"
                targets.append({"item_id": item_id, "quote": quote})
                stage2_items.append({
                    "item_id": item_id, "quote": quote,
                    "extracted_condition_text": cond_by_id.get(item_id, ""),
                })
                manifest.append({
                    "item_id": item_id, "video_id": prep["video_id"],
                    "strategy_index": prep["strategy_index"], "span": [s, e], "kind": kind,
                })

    # Blinding assertion: no target (stage-1) item may carry condition text.
    assert all(set(t.keys()) == {"item_id", "quote"} for t in targets), "stage-1 target leaked a non-quote field"

    stage1_packet = {
        "artifact": "h1-pilot-rater-STAGE1",
        "task": ("For EACH quote below, assign exactly ONE role from the closed taxonomy, judging FROM THE "
                 "QUOTE ALONE (the trader's own words). You are NOT told any extractor label and there is no "
                 "answer key. Do Set A first (top to bottom), then the targets."),
        "closed_taxonomy": closed_taxonomy,
        "control_gate_rule": ("Your target calls count only if your Set A calls clear >= 4/5 in the gate "
                              "direction AND >= 4/5 in the context direction. Which Set A items are which is "
                              "not disclosed."),
        "answer_format": "Return JSON: {\"<item_id>\": \"gate-strength\"|\"context\"|\"cannot-determine\", ...} for EVERY Set A item and EVERY target.",
        "set_a_controls": set_a_controls,
        "targets": targets,
        "counts": {"set_a": len(set_a_controls), "targets": len(targets)},
    }
    stage2_packet = {
        "artifact": "h1-pilot-rater-STAGE2",
        "task": ("READ-ORDER LOCK: only after you have committed your Stage-1 role calls. For EACH item, "
                 "answer the SEPARATE question: does this QUOTE express THIS CONDITION? Choose support in "
                 "{confirmed, partial, denied} and give a REQUIRED one-line justification."),
        "support_taxonomy": pc._SUPPORT_TAXONOMY,
        "answer_format": "Return JSON: {\"<item_id>\": {\"support\": \"confirmed\"|\"partial\"|\"denied\", \"justification\": \"...\"}, ...} for EVERY item.",
        "items": stage2_items,
        "counts": {"items": len(stage2_items)},
    }

    with open(os.path.join(PKT_DIR, "stage1_packet.json"), "w", encoding="utf-8") as fh:
        json.dump(stage1_packet, fh, indent=2, default=str)
    with open(os.path.join(PKT_DIR, "stage2_packet.json"), "w", encoding="utf-8") as fh:
        json.dump(stage2_packet, fh, indent=2, default=str)
    with open(os.path.join(PKT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump({"targets": manifest, "leak_violations": leak_violations,
                   "n_targets": len(targets),
                   "n_fallthrough": sum(1 for m in manifest if m["kind"] == "fallthrough"),
                   "n_audit": sum(1 for m in manifest if m["kind"] == "audit")}, fh, indent=2)

    print(f"[phase2] set_a={len(set_a_controls)} targets={len(targets)} "
          f"(fallthrough={sum(1 for m in manifest if m['kind']=='fallthrough')} "
          f"audit={sum(1 for m in manifest if m['kind']=='audit')}) leak_violations={len(leak_violations)}")
    if leak_violations:
        print("[phase2] LEAK VIOLATIONS PRESENT — DO NOT DISPATCH:", json.dumps(leak_violations))


if __name__ == "__main__":
    run()
