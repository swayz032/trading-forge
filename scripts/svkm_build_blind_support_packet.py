"""sVkm — build the FIVE-ITEM BLIND ANCHOR-SUPPORT PACKET (AR-1202 §3/§4). READ-ONLY.

The rater must see ONLY: condition reference, condition text, the exact candidate quote(s),
and transcript SHA/offsets as identity metadata (AR-1202 §3).

🛑 BLINDING RULES ENFORCED HERE BY CONSTRUCTION:
  * no expected answer, no confidence column, no risk ranking, no worker commentary;
  * no `classification` field from the Lane A artifact (it names the hypothesis under test);
  * no `mechanical_verifier` result (a PASS would read as "the answer is yes");
  * items are emitted in a fixed order that carries no ranking signal, and the packet asserts
    that no forbidden key survived.

Built from the committed Lane A artifact so the quotes are byte-identical to what the
mechanical verifier accepted — not retyped.

Run from repo root:
  python scripts/svkm_build_blind_support_packet.py
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GRADE_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified", "grade")
LANE_A = os.path.join(GRADE_DIR, "laneA_locator_binding_diagnostic.json")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Keys that would leak the hypothesis or the worker's expectation.
FORBIDDEN = {
    "classification", "mechanical_verifier", "verifier_reason", "ar1199_reason",
    "blind_support_disposition", "summary", "negative_control", "worker_decided_semantic_support",
}


def main() -> int:
    lane_a = json.loads(open(LANE_A, encoding="utf-8").read())
    tsha = lane_a["transcript_sha256"]

    items = []
    for r in lane_a["results"]:
        quotes = []
        for c in r["candidates"]:
            if not c.get("proposed_quote"):
                continue
            quotes.append({
                "candidate_id": f"{r['condition_ref']}#{c['candidate_index']}",
                "quote": c["proposed_quote"],
                "char_span": c["proposed_char_span"],
            })
        if not quotes:
            continue
        items.append({
            "item_id": r["condition_ref"],
            "extracted_condition_text": r["condition_text"],
            "candidate_quotes": quotes,
        })

    packet = {
        "artifact": "svkm-blind-anchor-support-packet",
        "ruling": "AR-1202 §4 — five narrow blind anchor-support judgments",
        "transcript_sha256": tsha,
        "task": (
            "For EACH item below answer ONE question: does the candidate quote (or, where two "
            "quotes are given, the MINIMAL set of them needed) actually EXPRESS the extracted "
            "condition text? Judge from the quoted words themselves. Do not assume the extracted "
            "condition is correct — it is the thing under test. Every clause of the condition must "
            "be supported for CONFIRMED; if the quote supports part of the condition but not all "
            "of it, that is PARTIAL, and you must name the unsupported clause."
        ),
        "dispositions": {
            "CONFIRMED": "the quote(s) express the whole condition, every clause",
            "PARTIAL": "the quote(s) support some clause(s) but not all — name which are unsupported",
            "DENIED": "the quote(s) are real text but do not support the condition",
            "UNRESOLVED": "cannot be decided from the quoted words alone",
        },
        "candidate_set_rule": (
            "Judge the MINIMAL candidate set required. Where an item carries two quotes they may be "
            "used together if the condition genuinely combines adjacent facts; say which you used."
        ),
        "answer_format": (
            "Return JSON: {\"<item_id>\": {\"support\": \"CONFIRMED\"|\"PARTIAL\"|\"DENIED\"|\"UNRESOLVED\", "
            "\"candidates_used\": [\"<candidate_id>\", ...], \"unsupported_clauses\": [\"...\"], "
            "\"justification\": \"one or two lines\"}, ...} for EVERY item."
        ),
        "items": items,
        "counts": {"items": len(items),
                   "candidate_quotes": sum(len(i["candidate_quotes"]) for i in items)},
    }

    # BLINDING ASSERTION — no forbidden key anywhere in the emitted structure.
    blob = json.dumps(packet)
    leaked = sorted(k for k in FORBIDDEN if f'"{k}"' in blob)
    assert not leaked, f"BLINDING VIOLATION — packet leaked: {leaked}"
    # And no item may carry anything beyond the three permitted fields.
    for it in items:
        assert set(it.keys()) == {"item_id", "extracted_condition_text", "candidate_quotes"}, it.keys()
        for q in it["candidate_quotes"]:
            assert set(q.keys()) == {"candidate_id", "quote", "char_span"}, q.keys()

    path = os.path.join(GRADE_DIR, "blind_support_packet.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(packet, fh, indent=2, default=str)
    os.replace(tmp, path)
    print(f"[packet] items={len(items)} quotes={packet['counts']['candidate_quotes']}")
    print(f"[packet] blinding assertion PASSED (no forbidden key, no extra item field)")
    print(f"[packet] wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
