"""sVkm LANE A — locator-binding diagnostic (AR-1200 §5). READ-ONLY.

QUESTION (AR-1200 §3): for each of AR-1199's five `unanchored` conditions, does a REAL
LITERAL supporting span exist in the pinned transcript that the EXISTING mechanical
verifier accepts? If yes, that condition's unanchored result was a LOCATOR PROPOSAL /
BINDING false negative, not source absence.

METHOD — no instrument edit, no fuzzy acceptance:
  * candidates are produced by SLICING the pinned transcript between two literal markers,
    so a candidate is a real transcript span BY CONSTRUCTION (this also removes any chance
    that I introduce a paraphrase by retyping);
  * each candidate is injected through `anchor_locator.locate_anchor`'s documented
    `propose_fn` seam — the SAME entry point production uses;
  * `_verify_and_locate` (unchanged) owns the verdict. Nothing here relaxes it.

🛑 WHAT THIS SCRIPT DOES NOT DO — AR-1200 §5 step 5, verbatim: "Do not let the worker
decide semantic support." This script emits NO support verdict. Whether a mechanically
valid quote actually EXPRESSES the condition is a blind-rater judgment and is left
`UNADJUDICATED`. The doer produces the frozen input; it does not score it.

Run from repo root:
  python scripts/svkm_laneA_locator_binding_diagnostic.py --transcript <pinned.txt>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from src.engine.extraction import anchor_locator as al  # noqa: E402

TRANSCRIPT_PIN = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
POP_DIR = os.path.join(ROOT, "docs", "replay-results", "svkm-extraction-certified")
GRADE_DIR = os.path.join(POP_DIR, "grade")

# (condition_ref, condition_text, [(start_marker, end_marker), ...])
# Markers are literal transcript text; the slice between them (inclusive of the end
# marker) is the candidate. Multiple candidates per condition are allowed (AR-1200 §9
# asks for "candidate literal span(s)").
CASES = [
    (
        "entry_sequence[0].action",
        "At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.",
        [
            ("So again, 9:30 a.m. Eastern time, go on the 5-minute candle.",
             "this is your 5minute candle"),
            ("And what that now gives me is a range on the five minute.",
             "that's how low it went."),
        ],
    ),
    (
        "entry_sequence[1].rationale",
        "The breakout confirms the market direction (up or down) for the trade.",
        [
            ("That gives us an idea of the direction in which the market wants to go for the day.",
             "That gives us an idea of the direction in which the market wants to go for the day."),
        ],
    ),
    (
        "entry_sequence[2].rationale",
        "The FVG provides a high-probability entry point after the initial directional breakout.",
        [
            ("As soon as we see this gap being printed outside of the range and confirming,",
             "then we can enter the trade."),
        ],
    ),
    (
        "confluences[0].description",
        "The trade must be initiated during the 9:30 AM ET New York session.",
        [
            ("So, this strategy needs to be traded at 9:30 a.m. Eastern time, New York time.",
             "So, this strategy needs to be traded at 9:30 a.m. Eastern time, New York time."),
        ],
    ),
    (
        "confluences[1].description",
        "The 1m candle must close outside of the initial 5m range.",
        [
            ("What has to happen is the candles need to close outside of this 5m minute range.",
             "What has to happen is the candles need to close outside of this 5m minute range."),
        ],
    ),
]

# A deliberately NON-literal paraphrase of a real teaching. The verifier MUST reject it.
# Without this, a run where everything passes cannot be told from a verifier that always passes.
NEGATIVE_CONTROL = (
    "NEGATIVE-CONTROL/paraphrase",
    "The 1m candle must close outside of the initial 5m range.",
    "The candles have to finish beyond the five minute range boundary.",
)


def slice_between(transcript: str, start_marker: str, end_marker: str):
    i = transcript.find(start_marker)
    if i < 0:
        return None, f"start marker not found: {start_marker[:50]!r}"
    j = transcript.find(end_marker, i)
    if j < 0:
        return None, f"end marker not found after start: {end_marker[:50]!r}"
    return (i, j + len(end_marker)), None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True)
    args = ap.parse_args()

    transcript = open(args.transcript, encoding="utf-8", newline="").read()
    tsha = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    print(f"[laneA] transcript chars={len(transcript)} sha256={tsha}")
    if tsha != TRANSCRIPT_PIN:
        print("[laneA] ABORT: transcript differs from the pin — REFUSING.")
        return 2

    results = []
    for ref, cond_text, markers in CASES:
        print("=" * 78)
        print(f"[laneA] {ref}")
        print(f"[laneA]   condition: {cond_text}")
        cands = []
        for k, (sm, em) in enumerate(markers):
            span, err = slice_between(transcript, sm, em)
            if span is None:
                print(f"[laneA]   candidate[{k}] MARKER FAILURE: {err}")
                cands.append({"candidate_index": k, "marker_error": err,
                              "mechanical_verifier": "NOT_RUN"})
                continue
            candidate = transcript[span[0]:span[1]]
            # INJECT through the production seam. The verifier is untouched.
            res = al.locate_anchor(transcript, cond_text, propose_fn=lambda *_a, _c=candidate: _c)
            verdict = "PASS" if res.located else "FAIL"
            print(f"[laneA]   candidate[{k}] chars={span[0]}..{span[1]} -> verifier={verdict}"
                  + ("" if res.located else f" reason={res.reason}"))
            print(f"[laneA]     quote: {candidate[:150]}")
            cands.append({
                "candidate_index": k,
                "proposed_char_span": list(span),
                "proposed_quote": candidate,
                "mechanical_verifier": verdict,
                "verifier_reason": None if res.located else res.reason,
                "located_char_span": list(res.char_span) if res.located else None,
                "located_quote": res.quote if res.located else None,
                # AR-1200 §5.5 / §9: the worker does NOT decide this.
                "blind_support_disposition": "UNADJUDICATED — requires blind rater (worker may not decide)",
            })
        any_pass = any(c.get("mechanical_verifier") == "PASS" for c in cands)
        classification = (
            "LOCATOR_BINDING_FALSE_NEGATIVE_CANDIDATE — mechanically valid literal span EXISTS; "
            "final classification pending blind support"
            if any_pass else
            "SOURCE_UNGROUNDED_OR_UNRESOLVED — no mechanically valid candidate located"
        )
        print(f"[laneA]   => {classification}")
        results.append({
            "condition_ref": ref,
            "condition_text": cond_text,
            "ar1199_reason": "proposed_quote_not_literal_substring",
            "candidates": cands,
            "classification": classification,
        })

    # ---- NEGATIVE CONTROL: the verifier must REJECT a paraphrase ----
    print("=" * 78)
    ncref, nccond, ncquote = NEGATIVE_CONTROL
    nres = al.locate_anchor(transcript, nccond, propose_fn=lambda *_a: ncquote)
    nc_verdict = "PASS" if nres.located else "FAIL"
    print(f"[laneA] {ncref}: paraphrase -> verifier={nc_verdict} "
          f"(MUST be FAIL; reason={None if nres.located else nres.reason})")
    control_ok = not nres.located

    artifact = {
        "artifact": "svkm-laneA-locator-binding-diagnostic",
        "ruling": "AR-1200 §5 LANE A",
        "transcript_sha256": tsha,
        "instrument": "src/engine/extraction/anchor_locator.py (UNMODIFIED; injected via propose_fn seam)",
        "worker_decided_semantic_support": False,
        "results": results,
        "negative_control": {
            "description": "non-literal paraphrase of a real teaching, injected as a proposal",
            "quote": ncquote,
            "verifier": nc_verdict,
            "reason": None if nres.located else nres.reason,
            "control_discriminates": control_ok,
        },
        "summary": {
            "conditions_examined": len(results),
            "with_mechanically_valid_candidate": sum(
                1 for r in results if "FALSE_NEGATIVE_CANDIDATE" in r["classification"]),
            "source_ungrounded_or_unresolved": sum(
                1 for r in results if r["classification"].startswith("SOURCE_UNGROUNDED")),
        },
    }
    os.makedirs(GRADE_DIR, exist_ok=True)
    path = os.path.join(GRADE_DIR, "laneA_locator_binding_diagnostic.json")
    tmp = path + f".{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(artifact, fh, indent=2, default=str)
    os.replace(tmp, path)
    print(f"\n[laneA] wrote {path}")
    print(f"[laneA] SUMMARY: {json.dumps(artifact['summary'])}")
    if not control_ok:
        print("[laneA] 🛑 NEGATIVE CONTROL DID NOT BITE — the verifier accepted a paraphrase. "
              "Every PASS above is untrustworthy.")
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
