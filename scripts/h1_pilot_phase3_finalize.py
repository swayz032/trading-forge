"""H1 pilot — PHASE 3 finalize + read (conductor-authored). Consumes the frozen instrument
(finalize_certificate/aggregate) as data; does NOT modify it.

Inputs (all under pilot-run/):
  phase1_preps.pkl                     — exact dataclass preps (TRUSTED-LOCAL: this driver's own Phase-1
                                         output, never an external source; needed for exact Tier1* objects).
  rater-packets/manifest.json          — item_id -> span/kind/video/strategy.
  rater-answers/raterA_stage1.json, raterB_stage1.json   — {item_id: role}
  rater-answers/raterA_stage2.json, raterB_stage2.json   — {item_id: {support, justification}}

Applies CONDUCTOR-PRECOMMIT-RULES-2026-07-12.md (R1-R7) mechanically. Writes pilot-run/FINAL-READ.json.
Run from repo root AFTER the two blind raters have returned.
"""
from __future__ import annotations

import json
import os
import pickle
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from src.engine.extraction import pilot_conveyor as pc  # noqa: E402

OUT_DIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run")
ANS_DIR = os.path.join(OUT_DIR, "rater-answers")

GATE_CONTROLS = {"W1-0001", "W1-0003", "W1-0005", "W1-0007", "W1-0009"}
CONTEXT_CONTROLS = {"W1-0002", "W1-0004", "W1-0006", "W1-0008", "W1-0010"}
CEILING = 15


def load(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def control_gate(stage1: dict) -> dict:
    gate_ok = sum(1 for i in GATE_CONTROLS if stage1.get(i) == "gate-strength")
    ctx_ok = sum(1 for i in CONTEXT_CONTROLS if stage1.get(i) == "context")
    return {"gate_ok": gate_ok, "context_ok": ctx_ok, "passed": gate_ok >= 4 and ctx_ok >= 4}


def agreed_role(a, b):
    # R2: determinate agreement only.
    if a == b and a in ("gate-strength", "context"):
        return a
    return None  # cannot-determine agreement OR disagreement -> unresolved


def agreed_support(a, b):
    # R3: confirmed iff both confirmed; else non-confirmed downgrade (contested -> partial).
    sa = (a or {}).get("support")
    sb = (b or {}).get("support")
    if sa == "confirmed" and sb == "confirmed":
        return "confirmed", "both raters confirmed"
    if sa == sb and sa in ("denied", "partial"):
        return sa, f"both raters {sa}"
    return "partial", f"contested support (raterA={sa}, raterB={sb})"


def run() -> None:
    blob = pickle.load(open(os.path.join(OUT_DIR, "phase1_preps.pkl"), "rb"))
    all_preps = blob["all_preps"]
    manifest = load(os.path.join(OUT_DIR, "rater-packets", "manifest.json"))
    a1 = load(os.path.join(ANS_DIR, "raterA_stage1.json"))
    b1 = load(os.path.join(ANS_DIR, "raterB_stage1.json"))
    a2 = load(os.path.join(ANS_DIR, "raterA_stage2.json"))
    b2 = load(os.path.join(ANS_DIR, "raterB_stage2.json"))

    cg_a, cg_b = control_gate(a1), control_gate(b1)
    both_pass = cg_a["passed"] and cg_b["passed"]

    # item_id -> (video, strategy, span, kind)
    m = {t["item_id"]: t for t in manifest["targets"]}

    # Contested / signal tracking
    role_contested = []
    role_cannot_determine = []
    support_contested = []

    per_strategy_rows = []
    certs_by_video = {}   # video_id -> list of (strategy_index, cert)

    for meta, preps in all_preps:
        for prep in preps:
            vid = prep["video_id"]
            si = prep["strategy_index"]
            span_map = prep["item_span_map"]
            audit_item_id = prep["axis3_audit"].get("item_id")

            tier3_verdicts = []
            tier3_support = []
            for item_id, span in span_map.items():
                s, e = span
                quote = prep["full_transcript"][s:e]
                is_audit = (item_id == audit_item_id)
                role = agreed_role(a1.get(item_id), b1.get(item_id))
                if not is_audit:
                    if role is None:
                        if a1.get(item_id) == b1.get(item_id) == "cannot-determine":
                            role_cannot_determine.append(item_id)
                        elif a1.get(item_id) != b1.get(item_id):
                            role_contested.append({"item_id": item_id, "A": a1.get(item_id), "B": b1.get(item_id)})
                    else:
                        # determinate agreed role -> classifies tier-3
                        tier3_verdicts.append(pc.verdict_from_rater_response(
                            char_span=(s, e), quote_anchor=quote, role=role, control_gate_passed=both_pass))
                        sup, just = agreed_support(a2.get(item_id), b2.get(item_id))
                        if (a2.get(item_id) or {}).get("support") != (b2.get(item_id) or {}).get("support"):
                            support_contested.append({"item_id": item_id, "A": (a2.get(item_id) or {}).get("support"), "B": (b2.get(item_id) or {}).get("support")})
                        tier3_support.append(pc.support_verdict_from_stage2_response(
                            char_span=(s, e), support=sup, support_justification=just))
                else:
                    # R4: audit item — support recorded for cert["axis3_audit"], role unused.
                    sup, just = agreed_support(a2.get(item_id), b2.get(item_id))
                    tier3_support.append(pc.support_verdict_from_stage2_response(
                        char_span=(s, e), support=sup, support_justification=just))

            cert = pc.finalize_certificate(prep, tier3_verdicts, tier3_support=tier3_support)
            certs_by_video.setdefault(vid, []).append((si, cert))

            n_fallthrough = sum(1 for iid in span_map if iid != audit_item_id)
            n_audit = 1 if audit_item_id else 0
            per_strategy_rows.append({
                "video_id": vid, "strategy_index": si,
                "spine_conditions": prep["spine_condition_count"],
                "unanchored": cert["unanchored_condition_count"],
                "tier1_classified": len(prep["tier1_detections"]),
                "tier3_fallthroughs": n_fallthrough,
                "axis3_audit": n_audit,
                "adjudications": n_fallthrough + n_audit,
                "pilot_grade": cert["pilot_grade"],
                "full_grade": cert["full_grade"],
                "diagnosis": cert["diagnosis"],
                "axis3_audit_support": (cert.get("axis3_audit") or {}).get("support"),
            })

    # R6: video cert-grade iff any strategy pilot_grade
    video_rows = []
    for vid, lst in certs_by_video.items():
        cert_grade = any(c["pilot_grade"] for _, c in lst)
        adj = sum(r["adjudications"] for r in per_strategy_rows if r["video_id"] == vid)
        video_rows.append({"video_id": vid, "strategies": len(lst),
                           "certificate_grade": cert_grade, "adjudications_aggregate": adj})

    n_videos = len(video_rows)
    cert_videos = sum(1 for v in video_rows if v["certificate_grade"])
    fidelity_fraction = round(cert_videos / n_videos, 4) if n_videos else None
    adj_list = [v["adjudications_aggregate"] for v in video_rows]
    mean_adj = round(sum(adj_list) / n_videos, 4) if n_videos else None
    # per-strategy normalization (annotation)
    n_strats = len(per_strategy_rows)
    mean_adj_per_strategy = round(sum(r["adjudications"] for r in per_strategy_rows) / n_strats, 4) if n_strats else None

    final = {
        "artifact": "h1-pilot-FINAL-READ",
        "control_gates": {"raterA": cg_a, "raterB": cg_b, "both_pass": both_pass},
        "fidelity": {
            "n_videos": n_videos,
            "certificate_grade_videos": cert_videos,
            "fidelity_fraction": fidelity_fraction,
            "bar": 0.60,
            "verdict": ("FIDELITY_PASS (>=60%)" if (fidelity_fraction or 0) >= 0.60 else "FIDELITY_MISS (<60%)"),
        },
        "economics": {
            "STATISTIC": "verdict reads the MEAN per-video-aggregate adjudications vs ~15 (operator Addendum 8 §3; distribution is annotation)",
            "mean_adjudications_per_video_aggregate": mean_adj,
            "ceiling": CEILING,
            "verdict": ("ECON_WITHIN_CEILING (mean<=~15)" if (mean_adj or 0) <= CEILING else "ECON_MISS (mean>~15)"),
            "per_video_adjudications": {v["video_id"]: v["adjudications_aggregate"] for v in video_rows},
            "annotation_videos_over_ceiling": sum(1 for v in video_rows if v["adjudications_aggregate"] > CEILING),
            "annotation_max_video_aggregate": max(adj_list) if adj_list else None,
            "annotation_mean_adjudications_per_strategy": mean_adj_per_strategy,
        },
        "recorded_signals": {
            "role_contested_count": len(role_contested),
            "role_contested": role_contested,
            "role_agreed_cannot_determine_count": len(role_cannot_determine),
            "support_contested_count": len(support_contested),
            "support_contested": support_contested,
        },
        "video_table": sorted(video_rows, key=lambda r: r["video_id"]),
        "per_strategy_table": per_strategy_rows,
    }
    with open(os.path.join(OUT_DIR, "FINAL-READ.json"), "w", encoding="utf-8") as fh:
        json.dump(final, fh, indent=2, default=str)
    print(json.dumps({k: final[k] for k in ("control_gates", "fidelity", "economics", "recorded_signals")}, indent=2))


if __name__ == "__main__":
    run()
