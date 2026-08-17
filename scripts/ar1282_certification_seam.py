"""AR-1282 -- CERTIFICATION-SEAM MEASUREMENT (ZERO MODEL CALLS).

Ruling: AR-1281A section 4. Measures how a final Opus route's ACCEPTED evidence
is supposed to become certificate input, and exercises ONLY the four rows the
sVkm route already dispositioned `ACCEPTED_PENDING_CERTIFICATION`.

THE SEAM, reconstructed from production code (not prose):

    opus_phase1_route outcome (disposition + quote + char_span)
      -> propose_fn seam of anchor_locator.locate_anchor
         (PROPOSE may be any callable; the mechanical literal-substring
          VERIFY owns the truth -- anchor_locator.py:259-278)
      -> pilot_conveyor.prepare_strategy
         (spine texts -> locate_condition_anchors -> run_tier1 dual read)
      -> tier1_detections  XOR  tier1_fallthroughs
      -> pilot_conveyor.finalize_certificate
      -> cert_assembler.assemble_certificate
         (classifying_tier in {1,3} ONLY; every_condition_classified)

ZERO MODEL CALLS: the route already carries a verbatim `quote` per condition,
so PROPOSE is a dict lookup. `run_tier1` is pure regex. `finalize_certificate`
consumes tier-3 verdicts as DATA. Nothing here touches the network.

WHAT THIS DELIBERATELY DOES NOT DO (AR-1281A section 3 / 4B / 4C):
  * it does NOT stamp ACCEPTED_PENDING_CERTIFICATION as classifying_tier=3;
  * it does NOT feed the eight held/refused/red rows' evidence as accepted --
    the adapter ABSTAINS on them, so they stay honestly unresolved;
  * it does NOT fabricate a Tier3Verdict.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Optional

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.engine.extraction.pilot_conveyor import (  # noqa: E402
    extract_spine_condition_texts,
    finalize_certificate,
    prepare_strategy,
)

# ---------------------------------------------------------------- pins
STRATEGY_JSON = REPO / "docs/replay-results/svkm-extraction-certified/sVkmZklJDHI.json"
TRANSCRIPT = REPO / "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt"
ROUTE = REPO / "docs/replay-results/svkm-extraction-certified/grade/opus-v2/opus_phase1_route_t1.json"

PIN_TRANSCRIPT_SHA = "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc"
PIN_EXTRACTION_SHA = "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823"
VIDEO_ID = "sVkmZklJDHI"
STRATEGY_INDEX = 0

ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"


class PinMismatch(RuntimeError):
    pass


def _sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_pinned() -> tuple[dict, str, dict]:
    """Load strategy/transcript/route and FAIL CLOSED on any pin mismatch."""
    doc = json.loads(STRATEGY_JSON.read_text(encoding="utf-8"))
    if doc.get("extraction_sha256") != PIN_EXTRACTION_SHA:
        raise PinMismatch(f"extraction sha {doc.get('extraction_sha256')} != {PIN_EXTRACTION_SHA}")

    tsha = _sha256_file(TRANSCRIPT)
    if tsha != PIN_TRANSCRIPT_SHA:
        raise PinMismatch(f"transcript sha {tsha} != {PIN_TRANSCRIPT_SHA}")
    transcript = TRANSCRIPT.read_text(encoding="utf-8")

    route = json.loads(ROUTE.read_text(encoding="utf-8"))
    strategy = doc["extraction"]["strategies"][STRATEGY_INDEX]
    return strategy, transcript, route


def build_accepted_proposal_map(strategy: dict, route: dict) -> tuple[dict[str, str], list[str], list[str]]:
    """Map spine-condition TEXT -> the route's accepted verbatim quote.

    Keyed by condition text because that is all `propose_fn(transcript,
    condition_text)` receives. Only ACCEPTED rows enter the map; every other
    row is absent, which makes the adapter abstain (locate_anchor treats a
    None/empty proposal as LOCATOR_DECLINED).
    """
    text_by_ref = {c.condition_ref: c.text for c in extract_spine_condition_texts(strategy, STRATEGY_INDEX)}
    proposal_by_text: dict[str, str] = {}
    accepted_refs: list[str] = []
    withheld_refs: list[str] = []

    for outcome in route["outcomes"]:
        ref = outcome["condition_ref"]
        if outcome.get("disposition") != ACCEPTED:
            withheld_refs.append(ref)
            continue
        accepted_refs.append(ref)
        text = text_by_ref.get(ref)
        if text is None:
            raise PinMismatch(f"route row {ref!r} has no matching spine condition")
        proposal_by_text[text] = outcome["quote"]

    return proposal_by_text, accepted_refs, withheld_refs


def make_adapter(proposal_by_text: dict[str, str]):
    """The zero-model PROPOSE seam. Returns the accepted route quote, or None
    (abstain) for every row the route did not accept."""
    calls: list[dict] = []

    def propose(_transcript: str, condition_text: str) -> Optional[str]:
        quote = proposal_by_text.get(condition_text)
        calls.append({"condition_text": condition_text[:80], "proposed": quote is not None})
        return quote

    return propose, calls


def measure() -> dict:
    strategy, transcript, route = load_pinned()
    proposal_by_text, accepted_refs, withheld_refs = build_accepted_proposal_map(strategy, route)

    propose, calls = make_adapter(proposal_by_text)
    prep = prepare_strategy(
        strategy,
        transcript,
        VIDEO_ID,
        extractor_version="ar1282-seam-measurement",
        taxonomy_version="ar1282-seam-measurement",
        strategy_index=STRATEGY_INDEX,
        full_transcript_sha256=PIN_TRANSCRIPT_SHA,
        propose_fn=propose,
    )

    # No fabricated tier-3 verdicts: the residual stays residual.
    cert = finalize_certificate(prep, tier3_verdicts=[], conflation_verdict="PASS")

    outcome_by_ref = {o["condition_ref"]: o for o in prep["condition_outcomes"]}
    unanchored_refs = {u.condition_ref for u in prep["unanchored_conditions"]}

    per_row = []
    classified = 0
    residual = 0
    for ref in accepted_refs:
        oc = outcome_by_ref.get(ref)
        if ref in unanchored_refs:
            row = {"condition_ref": ref, "anchored": False, "tier1_classified": False,
                   "outcome": "unanchored", "residual_tier3_item": None}
        else:
            is_classified = oc is not None and oc["outcome"] == "classified_tier1"
            row = {
                "condition_ref": ref,
                "anchored": True,
                "tier1_classified": is_classified,
                "outcome": oc["outcome"] if oc else "MISSING",
                "char_span": oc["char_span"] if oc else None,
                "residual_tier3_item": None,
            }
            if is_classified:
                classified += 1
            else:
                residual += 1
                span = tuple(oc["char_span"]) if oc else None
                for item_id, item_span in (prep["item_span_map"] or {}).items():
                    if tuple(item_span) == span:
                        row["residual_tier3_item"] = item_id
                        break
        per_row.append(row)

    cert_conditions = cert.get("conditions", [])
    tiers = [c.get("classifying_tier") for c in cert_conditions]

    return {
        "packet": "AR-1282",
        "ruling": "AR-1281A section 4",
        "model_calls": 0,
        "pins": {
            "video_id": VIDEO_ID,
            "strategy_index": STRATEGY_INDEX,
            "transcript_sha256": PIN_TRANSCRIPT_SHA,
            "extraction_sha256": PIN_EXTRACTION_SHA,
            "route_artifact": str(ROUTE.relative_to(REPO)).replace("\\", "/"),
            "route_grade": route.get("grade"),
        },
        "headline_counts": {
            "accepted_route_rows": len(accepted_refs),
            "accepted_rows_classified_at_tier1": classified,
            "accepted_rows_residual_tier3": residual,
            "frozen_route_rows_unresolved": len(withheld_refs),
        },
        "per_accepted_row": per_row,
        "withheld_refs": withheld_refs,
        "adapter_calls": {
            "total": len(calls),
            "proposed": sum(1 for c in calls if c["proposed"]),
            "abstained": sum(1 for c in calls if not c["proposed"]),
        },
        "certificate_state": {
            "condition_count": len(cert_conditions),
            "classifying_tiers": tiers,
            "tier1_count": sum(1 for t in tiers if t == 1),
            "tier3_count": sum(1 for t in tiers if t == 3),
            "unclassified_count": sum(1 for t in tiers if t not in (1, 3)),
            "every_condition_classified": all(t in (1, 3) for t in tiers) if tiers else False,
            "pilot_grade": cert.get("pilot_grade"),
            "certificate_grade": cert.get("certificate_grade"),
            # NOTE: the certificate exposes THREE flat keys, not a nested
            # `terminal_read` object. Reading `cert["terminal_read"]` silently
            # yields None and reads as "axis absent" -- caught in AR-1282.
            "terminal_read_grade": cert.get("terminal_read_grade"),
            "terminal_read_clean": cert.get("terminal_read_clean"),
            "terminal_read_disposition": cert.get("terminal_read_disposition"),
        },
    }


def main() -> int:
    result = measure()
    print(json.dumps(result, indent=2))
    h = result["headline_counts"]
    print("\n--- AR-1282 HEADLINE ---")
    print(f"accepted_route_rows               = {h['accepted_route_rows']}")
    print(f"accepted_rows_classified_at_tier1 = {h['accepted_rows_classified_at_tier1']}")
    print(f"accepted_rows_residual_tier3      = {h['accepted_rows_residual_tier3']}")
    print(f"frozen_route_rows_unresolved      = {h['frozen_route_rows_unresolved']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
