#!/usr/bin/env python3
"""§2 WIRING-VERIFY (claimed-safeguards law, H1 catch #4): does the downstream
cert path actually REJECT R5L890's real merged (merge-silenced) object?

The CLAIM under test: "likely self-fails cert on contradictory entries."
ORDER (operator): feed R5L890's ACTUAL merged object (real vault artifact +
real transcript) through the path claimed to catch it (cert compile /
direction_conflation_lint / pilot_grade) and OBSERVE. Do not infer.

Two observations:
  CASE A -- terminal-read reality: no compile-stage topology overlay (the
    unwired A-packet). This is exactly what the sealed-12 terminal read uses.
  CASE B -- counterfactual: the A-packet IS wired (topology overlay assigns the
    two real opposite-direction entries to one and_group). Shows the lint WOULD
    fire -- proving the gap is the WIRING, not the lint logic -- and whether
    pilot_grade gates on it even then.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from src.engine.extraction import cert_assembler as ca
from src.engine.extraction.cert_assembler import (
    assemble_certificate, ConditionTopology, Tier1Detection,
)

TDIR = os.path.join(ROOT, "docs", "replay-results", "h1-scripts", "pilot-run", "transcripts")


def load_transcript(vid):
    d = json.load(open(os.path.join(TDIR, f"{vid}.json"), encoding="utf-8"))
    if isinstance(d, dict) and isinstance(d.get("text"), str):
        return d["text"]
    if isinstance(d, dict):
        for k in ("transcript", "segments", "content"):
            v = d.get(k)
            if isinstance(v, str):
                return v
            if isinstance(v, list):
                return " ".join(s.get("text", "") if isinstance(s, dict) else str(s) for s in v)
    if isinstance(d, list):
        return " ".join(s.get("text", "") if isinstance(s, dict) else str(s) for s in d)
    return json.dumps(d)


def find_span(tx, needle):
    i = tx.find(needle)
    if i < 0:
        raise SystemExit(f"anchor not found verbatim in transcript: {needle!r}")
    return (i, i + len(needle))


def main():
    tx = load_transcript("R5L890juvRw")
    sha = "R5L890-real"

    # Two REAL opposite-direction entries from R5L890's transcript (verbatim
    # substrings). One = trend-continuation LONG; the other = mean-reversion
    # from the outer band back to central VWAP (a SHORT/reversal in an uptrend).
    # These are the two setups the blind adjudicator found fused into one object.
    long_anchor = "after we broke it and tested it we can try our long trade"
    revert_anchor = "use the central vwap as a target for"

    # fall back to shorter faithful fragments if the exact phrase differs
    def anchor_or_fragment(candidates):
        for c in candidates:
            if tx.find(c) >= 0:
                return c
        raise SystemExit(f"none of these anchors present: {candidates}")

    long_anchor = anchor_or_fragment([
        long_anchor, "we can try our long trade", "try our long trade"])
    revert_anchor = anchor_or_fragment([
        revert_anchor, "use the central vwap as a target",
        "central vwap as a target"])

    long_span = find_span(tx, long_anchor)
    revert_span = find_span(tx, revert_anchor)

    dets = [
        Tier1Detection(surface_class="entry_trigger", quote_anchor=long_anchor, char_span=long_span),
        Tier1Detection(surface_class="entry_trigger", quote_anchor=revert_anchor, char_span=revert_span),
    ]

    common = dict(
        full_transcript=tx, full_transcript_sha256=sha, source_video_id="R5L890juvRw",
        extractor_version="wave6-pass2", taxonomy_version="h1", tier1_detections=dets,
        tier1_fallthroughs=[], tier3_verdicts=[],
    )

    # CASE A: terminal-read reality -- NO topology overlay.
    certA = assemble_certificate(**common, topology=None, or_branches=None)
    dcA = certA["compile_integrity"]["direction_conflation_lint"]

    # CASE B: A-packet wired -- opposite directions, SAME and_group, no or_branch.
    topo = [
        ConditionTopology(char_span=long_span, direction="long", and_group=0, role="spine"),
        ConditionTopology(char_span=revert_span, direction="short", and_group=0, role="spine"),
    ]
    certB = assemble_certificate(**common, topology=topo, or_branches=None)
    dcB = certB["compile_integrity"]["direction_conflation_lint"]

    # THE FENCE grade (ratify-packet) -- the CLOSURE witness.
    trA = certA["terminal_read_grade"]; trA_clean = certA["terminal_read_clean"]
    trB = certB["terminal_read_grade"]; trB_clean = certB["terminal_read_clean"]

    print("=" * 72)
    print("§2 WIRING-VERIFY + CLOSURE -- R5L890 real merged (merge-silenced) object")
    print("=" * 72)
    print(f"anchors: LONG={long_anchor!r}")
    print(f"         REVERT={revert_anchor!r}")
    print("-" * 72)
    print("CASE A  (terminal-read reality -- no topology / unwired A-packet):")
    print(f"   direction_conflation_lint.status = {dcA['status']}  reason={dcA.get('reason')}")
    print(f"   pilot_grade (OLD, ungated)       = {certA['pilot_grade']}   <-- the hole")
    print(f"   terminal_read_grade (FENCE)      = {trA}  clean={trA_clean}   <-- the fix")
    print("-" * 72)
    print("CASE B  (counterfactual -- A-packet WIRED, opposite dirs in one and_group):")
    print(f"   direction_conflation_lint.status = {dcB['status']}  offending={dcB.get('offending_anchor')}")
    print(f"   pilot_grade (OLD, ungated)       = {certB['pilot_grade']}   <-- STILL blind (CASE B)")
    print(f"   terminal_read_grade (FENCE)      = {trB}  clean={trB_clean}   <-- the fix")
    print("=" * 72)

    # ORIGINAL CRIT (pilot_grade blindness, for the before/after record)
    sails_through_terminal = bool(certA["pilot_grade"])
    lint_would_catch_if_wired = (dcB["status"] == "FAIL")
    pilot_grade_blind_even_if_wired = bool(certB["pilot_grade"]) and lint_would_catch_if_wired

    # CLOSURE: fence must catch (NOT clean) in BOTH configs.
    fence_catches_A = not trA_clean          # topology ABSENT  -> INDETERMINATE expected
    fence_catches_B = not trB_clean          # topology PRESENT -> REJECTED expected
    fence_closed = fence_catches_A and fence_catches_B

    print("BEFORE (the CRIT):")
    print(f"  pilot_grade sails through (A)?               {sails_through_terminal}")
    print(f"  pilot_grade blind even if A-packet wired (B)? {pilot_grade_blind_even_if_wired}")
    print("AFTER (the FENCE) -- CLOSURE CRITERION:")
    print(f"  fence catches topology-ABSENT  (A not clean)? {fence_catches_A}  [{trA}]")
    print(f"  fence catches topology-PRESENT (B not clean)? {fence_catches_B}  [{trB}]")
    print(f"  => FENCE CLOSED (catches in BOTH configs)?    {fence_closed}")
    if fence_closed:
        print("     CERTIFIED: the witness that exposed the hole observes the catch.")
    else:
        print("     NOT CLOSED: fence does not catch in both configs -- do not ship.")

    out = {
        "before_crit": {
            "case_A": {"direction_conflation": dcA, "pilot_grade": certA["pilot_grade"]},
            "case_B": {"direction_conflation": dcB, "pilot_grade": certB["pilot_grade"]},
            "sails_through_terminal_read": sails_through_terminal,
            "pilot_grade_blind_even_if_wired": pilot_grade_blind_even_if_wired,
        },
        "after_fence": {
            "case_A": {"terminal_read_grade": trA, "clean": trA_clean},
            "case_B": {"terminal_read_grade": trB, "clean": trB_clean},
            "fence_catches_topology_absent": fence_catches_A,
            "fence_catches_topology_present": fence_catches_B,
            "fence_closed": fence_closed,
        },
        "conclusion": "FENCE_CLOSED_CERTIFIED" if fence_closed else "FENCE_NOT_CLOSED",
    }
    outp = os.path.join(ROOT, "docs", "replay-results", "h1-scripts",
                        "optionR-locator-support", "R5L890_wiring_verify.json")
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    json.dump(out, open(outp, "w", encoding="utf-8"), indent=1)
    print(f"\nreport: {outp}")


if __name__ == "__main__":
    main()
