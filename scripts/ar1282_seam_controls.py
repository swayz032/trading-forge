"""AR-1282 section C+D -- NEGATIVE / MUTATION CONTROLS FOR THE CERTIFICATION SEAM.

Ruling: AR-1281A section 4C (six controls) and 4D (post-G2 continuation shape).

Every control here is a DISCRIMINATING mutation: it must go RED without the
production guard and GREEN with it. Zero model calls -- `run_tier1` is pure
regex and `assemble_certificate` / `finalize_certificate` consume tier-3
verdicts as DATA.

C1  ACCEPTED_PENDING_CERTIFICATION alone cannot manufacture classifying_tier=3
C2  a held/refused/red route row cannot enter the accepted-proposal set
C3  a quote/span mismatch refuses (mechanical VERIFY owns the truth)
C4  a Tier-3 verdict with control_gate_passed=false cannot classify
C5  a missing Tier-3 verdict leaves the residual condition classifying_tier=None
C6  only the Tier-1/Tier-3 contracts can satisfy every_condition_classified

D   post-G2 continuation shape, SYNTHETIC reachability control (labeled)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction.cert_assembler import (  # noqa: E402
    Tier3Verdict,
    assemble_certificate,
)
from src.engine.extraction.tier1_detectors import Tier1Detection, Tier1FallThrough  # noqa: E402

from ar1282_certification_seam import (  # noqa: E402
    ACCEPTED,
    build_accepted_proposal_map,
    load_pinned,
)

RESULTS: list[dict] = []


def record(cid: str, claim: str, passed: bool, evidence: str) -> None:
    RESULTS.append({"control": cid, "claim": claim, "passed": bool(passed), "evidence": evidence})


def main() -> int:
    strategy, transcript, route = load_pinned()
    proposal_by_text, accepted_refs, withheld_refs = build_accepted_proposal_map(strategy, route)

    accepted_rows = [o for o in route["outcomes"] if o.get("disposition") == ACCEPTED]
    withheld_rows = [o for o in route["outcomes"] if o.get("disposition") != ACCEPTED]

    # ---------------------------------------------------------------- C1
    # Feed an ACCEPTED row as a fall-through with NO tier-3 verdict. If route
    # acceptance could manufacture tier 3, this would classify.
    row = accepted_rows[0]
    span = tuple(row["char_span"])
    cert = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="x" * 64,
        source_video_id="C1",
        extractor_version="c1",
        taxonomy_version="c1",
        tier1_detections=[],
        tier1_fallthroughs=[Tier1FallThrough(char_span=span)],
        tier3_verdicts=[],
    )
    tiers = [c["classifying_tier"] for c in cert["conditions"]]
    record(
        "C1", "ACCEPTED_PENDING_CERTIFICATION alone cannot manufacture classifying_tier=3",
        tiers == [None],
        f"classifying_tiers={tiers} (expected [None]); pilot_grade={cert['pilot_grade']}",
    )

    # ---------------------------------------------------------------- C2
    # No withheld row's condition text may appear in the accepted-proposal map.
    text_by_ref = {}
    from src.engine.extraction.pilot_conveyor import extract_spine_condition_texts
    for c in extract_spine_condition_texts(strategy, 0):
        text_by_ref[c.condition_ref] = c.text
    leaked = [o["condition_ref"] for o in withheld_rows
              if text_by_ref.get(o["condition_ref"]) in proposal_by_text]
    record(
        "C2", "a held/refused/red route row cannot enter the accepted-proposal set",
        not leaked,
        f"withheld_rows={len(withheld_rows)}, leaked_into_proposals={leaked}, "
        f"proposal_map_size={len(proposal_by_text)} (expected {len(accepted_rows)})",
    )

    # ---------------------------------------------------------------- C3
    # A proposal that is NOT a literal substring must refuse. Positive witness
    # first: the true quote DOES locate (proves the path runs at all).
    true_quote = accepted_rows[0]["quote"]
    ok = al.locate_anchor(transcript, "irrelevant", propose_fn=lambda _t, _c: true_quote)
    tampered = true_quote[:-5] + "ZZZZQ"
    bad = al.locate_anchor(transcript, "irrelevant", propose_fn=lambda _t, _c: tampered)
    record(
        "C3", "a quote/span mismatch refuses (mechanical VERIFY owns the truth)",
        ok.located and not bad.located and bad.reason == al.REASON_NOT_LITERAL_SUBSTRING,
        f"positive_witness located={ok.located} span={ok.char_span}; "
        f"tampered located={bad.located} reason={bad.reason}",
    )

    # ---------------------------------------------------------------- C4
    # Same span, a tier-3 verdict that FAILED its control gate.
    def cert_with(gate_passed: bool):
        return assemble_certificate(
            full_transcript=transcript,
            full_transcript_sha256="x" * 64,
            source_video_id="C4",
            extractor_version="c4",
            taxonomy_version="c4",
            tier1_detections=[],
            tier1_fallthroughs=[Tier1FallThrough(char_span=span)],
            tier3_verdicts=[Tier3Verdict(
                char_span=span,
                quote_anchor=transcript[span[0]:span[1]],
                surface_class="gate-strength",
                verdict="gate-strength",
                control_gate_passed=gate_passed,
            )],
        )

    failed_gate = [c["classifying_tier"] for c in cert_with(False)["conditions"]]
    passed_gate = [c["classifying_tier"] for c in cert_with(True)["conditions"]]
    record(
        "C4", "a Tier-3 verdict with control_gate_passed=false cannot classify",
        failed_gate == [None] and passed_gate == [3],
        f"control_gate_passed=False -> {failed_gate} (expected [None]); "
        f"control_gate_passed=True -> {passed_gate} (expected [3])  <- discriminating control",
    )

    # ---------------------------------------------------------------- C5
    record(
        "C5", "a missing Tier-3 verdict leaves the residual condition classifying_tier=None",
        tiers == [None],
        f"no tier3_verdicts supplied -> classifying_tiers={tiers}",
    )

    # ---------------------------------------------------------------- C6
    # every_condition_classified is satisfiable ONLY via tier-1 detection or a
    # control-gate-passing tier-3 verdict. Mixed cert: 1 tier-1 + 1 residual.
    det_span = (span[0], span[1])
    mixed = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="x" * 64,
        source_video_id="C6",
        extractor_version="c6",
        taxonomy_version="c6",
        tier1_detections=[Tier1Detection(
            char_span=det_span,
            quote_anchor=transcript[det_span[0]:det_span[1]],
            surface_class="gate-strength",
        )],
        tier1_fallthroughs=[Tier1FallThrough(char_span=(14368, 14516))],
        tier3_verdicts=[],
    )
    mixed_tiers = [c["classifying_tier"] for c in mixed["conditions"]]
    record(
        "C6", "only the Tier-1/Tier-3 contracts can satisfy every_condition_classified",
        mixed_tiers == [1, None] and mixed["pilot_grade"] is False,
        f"tier1+unresolved -> classifying_tiers={mixed_tiers}, pilot_grade={mixed['pilot_grade']} "
        f"(a residual with no control-gated tier-3 blocks the gate)",
    )

    # ---------------------------------------------------------------- D
    # SYNTHETIC reachability control, SCOPE-CORRECTED BY AR-1282A §3.
    #
    # WHAT THIS CONTROL DOES *NOT* PROVE (graded defect, retained honestly
    # rather than deleted): the `set(all_spans)` below DEDUPLICATES a
    # span-keyed population. The real route carries 12 condition IDENTITIES
    # but only 11 unique spans (entry_sequence[1].action and
    # confluences[1].description share (9432, 9512)), so this control proves
    # reachability for an 11-row population that has ALREADY LOST AN
    # IDENTITY. It is therefore NOT evidence that the full 12-condition
    # certificate path can turn green.
    #
    # The identity-preserving proof lives in AR-1283
    # (`scripts/ar1283_identity_seam.py`, checks A1/A2/A3/E1) and in
    # `src/engine/extraction/cert_identity_seam.py`, which refuses the
    # aliasing state instead of deduplicating it.
    all_spans = [tuple(o["char_span"]) for o in route["outcomes"]]
    uniq_spans = sorted(set(all_spans))
    synth = assemble_certificate(
        full_transcript=transcript,
        full_transcript_sha256="x" * 64,
        source_video_id="D-SYNTHETIC",
        extractor_version="d",
        taxonomy_version="d",
        tier1_detections=[],
        tier1_fallthroughs=[Tier1FallThrough(char_span=s) for s in uniq_spans],
        tier3_verdicts=[Tier3Verdict(
            char_span=s,
            quote_anchor=transcript[s[0]:s[1]],
            surface_class="gate-strength",
            verdict="gate-strength",
            control_gate_passed=True,
        ) for s in uniq_spans],
        conflation_verdict="PASS",
    )
    synth_tiers = [c["classifying_tier"] for c in synth["conditions"]]
    record(
        "D-SYNTHETIC", "SYNTHETIC CONTROL, SPAN-DEDUPLICATED (AR-1282A section 3): the pathway can "
                       "reach every_condition_classified for a DEDUPLICATED span population. This is "
                       "NOT an identity-preserving 12-condition proof -- see AR-1283.",
        all(t == 3 for t in synth_tiers) and synth["pilot_grade"] is True,
        f"identities={len(all_spans)} but unique spans={len(uniq_spans)} "
        f"(DEDUP LOSES {len(all_spans) - len(uniq_spans)} IDENTITY); all tier-3, "
        f"pilot_grade={synth['pilot_grade']}, terminal_read_grade={synth['terminal_read_grade']}, "
        f"certificate_grade={synth['certificate_grade']}  "
        "[SYNTHETIC -- NOT EVIDENCE OF A REAL PASS, AND NOT AN IDENTITY-PRESERVING PROOF]",
    )

    print(json.dumps({"controls": RESULTS}, indent=2))
    failed = [r["control"] for r in RESULTS if not r["passed"]]
    print("\n--- AR-1282 CONTROLS ---")
    for r in RESULTS:
        print(f"  {'PASS' if r['passed'] else 'FAIL'}  {r['control']}  {r['claim']}")
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} controls passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
