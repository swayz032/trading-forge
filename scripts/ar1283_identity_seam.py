"""AR-1283 -- IDENTITY-PRESERVING CERTIFICATION SEAM (ZERO MODEL CALLS).

Ruling: AR-1282A section 7 (A-F).

AR-1282 established the real result -- the four currently accepted sVkm rows
are 0/4 at tier 1 and 4/4 true tier-3 residuals -- and that result STANDS.
What AR-1282A rejected was its SYNTHETIC full-path control, which built the
future fall-through population with

    uniq_spans = list(dict.fromkeys(all_spans))     # 12 identities -> 11 spans

and therefore proved a green certificate for a POPULATION THAT HAD ALREADY
LOST AN IDENTITY. This packet repairs that without deduplication, and pins
the exact quote/span identity the permanent seam needs.

MEASURED HERE, and it is the load-bearing fact:

    the shared span (9432, 9512) belongs to entry_sequence[1].action and
    confluences[1].description -- and production ALREADY HOLDS BOTH
    (HELD_DUPLICATE_ROLE_AMBIGUITY, severity HIGH, emitted by
    span_collision.adjudicate_locations BEFORE acceptance).

So the aliasing state cannot reach a GREEN route; the seam's job is to make
that precondition MECHANICAL rather than incidental.

ZERO MODEL CALLS: every proposal is a dict lookup over quotes the route
already carries, `run_tier1` is pure regex, and tier-3 verdicts are consumed
as DATA. Nothing here touches the network and nothing dispatches a rater.
"""

from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from src.engine.extraction import anchor_locator as al  # noqa: E402
from src.engine.extraction.cert_assembler import Tier3Verdict  # noqa: E402
from src.engine.extraction.cert_identity_seam import (  # noqa: E402
    ACCEPTED,
    GREEN,
    REASON_AMBIGUOUS_CONDITION_TEXT,
    REASON_CONDITION_TEXT_MISMATCH,
    REASON_IDENTITY_COLLISION,
    REASON_REF_SET_MISMATCH,
    REASON_ROUTE_NOT_GREEN,
    REASON_ROUTE_ROW_NOT_ACCEPTED,
    REASON_SPAN_MISMATCH,
    REASON_UNKNOWN_CONDITION_REF,
    SeamRefusal,
    assert_certifiable_final_route,
    assert_identity_preserved,
    bind_route_identities,
    make_identity_propose_fn,
    verify_anchor_identity,
)
from src.engine.extraction.pilot_conveyor import finalize_certificate, prepare_strategy  # noqa: E402
from src.engine.extraction.span_collision import detect_span_collisions  # noqa: E402

from ar1282_certification_seam import (  # noqa: E402
    PIN_TRANSCRIPT_SHA,
    STRATEGY_INDEX,
    VIDEO_ID,
    load_pinned,
)

RESULTS: list[dict] = []


def record(cid: str, claim: str, passed: bool, evidence: str) -> None:
    RESULTS.append({"check": cid, "claim": claim, "passed": bool(passed), "evidence": evidence})


def _refusal(fn, *args, **kwargs) -> str | None:
    """Run `fn`; return the SeamRefusal reason, or None if it did not refuse."""
    try:
        fn(*args, **kwargs)
    except SeamRefusal as exc:
        return exc.reason
    return None


def _prepare(strategy, transcript, propose):
    return prepare_strategy(
        strategy,
        transcript,
        VIDEO_ID,
        extractor_version="ar1283-identity-seam",
        taxonomy_version="ar1283-identity-seam",
        strategy_index=STRATEGY_INDEX,
        full_transcript_sha256=PIN_TRANSCRIPT_SHA,
        propose_fn=propose,
    )


# --------------------------------------------------------------------------- #
# SECTION B -- final-route GREEN is a HARD precondition (AR-1282A section 7B)
# --------------------------------------------------------------------------- #
def section_b(strategy, route) -> dict:
    """Three LAYERED refusals. Each layer must fire on its own, because an
    earlier gate short-circuiting the later ones would leave the later ones
    dead code wearing the word 'enforced'."""
    ids = bind_route_identities(strategy, route)

    l1 = _refusal(assert_certifiable_final_route, ids, route.get("grade"), strategy)

    green = copy.deepcopy(route)
    l2 = _refusal(assert_certifiable_final_route, bind_route_identities(strategy, green), GREEN, strategy)

    all_acc = copy.deepcopy(route)
    for o in all_acc["outcomes"]:
        o["disposition"] = ACCEPTED
    l3 = _refusal(assert_certifiable_final_route, bind_route_identities(strategy, all_acc), GREEN, strategy)

    record(
        "B1", "the historical RED route cannot be read as a certifiable final route",
        l1 == REASON_ROUTE_NOT_GREEN,
        f"grade={route.get('grade')!r} -> refusal={l1}",
    )
    record(
        "B2", "GREEN alone is not enough -- every row must be accepted",
        l2 == REASON_ROUTE_ROW_NOT_ACCEPTED,
        f"grade forced GREEN, 8 rows still unaccepted -> refusal={l2}  "
        "(proves the acceptance leg is live, not shadowed by the grade leg)",
    )
    record(
        "B3", "an unresolved span alias cannot be hidden -- collision leg is live",
        l3 == REASON_IDENTITY_COLLISION,
        f"grade GREEN + all 12 forced accepted -> refusal={l3}  "
        "(the (9432,9512) pair is caught by production detect_span_collisions)",
    )
    return {"layer1": l1, "layer2": l2, "layer3": l3}


# --------------------------------------------------------------------------- #
# SECTION C -- the seven negative controls (AR-1282A section 7C)
# --------------------------------------------------------------------------- #
def section_c(strategy, transcript, route) -> dict:
    ids = bind_route_identities(strategy, route)

    # POSITIVE WITNESS FIRST -- without it, seven refusals prove only that the
    # path is broken for every input.
    propose, calls = make_identity_propose_fn(ids)
    prep = _prepare(strategy, transcript, propose)
    verified = verify_anchor_identity(prep, ids)
    record(
        "C0-positive", "POSITIVE WITNESS: the real accepted rows bind, anchor and pin their exact spans",
        len(verified) == 4 and all(v["span_pinned"] for v in verified),
        f"{len(verified)}/4 accepted identities pinned; adapter proposed "
        f"{sum(1 for c in calls if c['proposed'])}/{len(calls)} (abstained on the 8 non-accepted)",
    )

    # C1 -- wrong condition_ref refuses
    r = copy.deepcopy(route)
    r["outcomes"][0]["condition_ref"] = "entry_sequence[99].action"
    c1 = _refusal(bind_route_identities, strategy, r)
    record("C1", "wrong condition_ref refuses", c1 == REASON_UNKNOWN_CONDITION_REF, f"refusal={c1}")

    # C2 -- wrong condition text refuses
    r = copy.deepcopy(route)
    r["outcomes"][0]["condition_text"] = "a condition text the spine does not carry"
    c2 = _refusal(bind_route_identities, strategy, r)
    record("C2", "wrong condition text refuses", c2 == REASON_CONDITION_TEXT_MISMATCH, f"refusal={c2}")

    # C3 -- a LITERAL quote at the WRONG span refuses. The quote is untouched
    # and still resolves; only the route's claimed span is moved. This is the
    # `_verify_and_locate` leftmost-occurrence hazard, made concrete.
    r = copy.deepcopy(route)
    victim = next(o for o in r["outcomes"] if o["disposition"] == ACCEPTED)
    true_span = tuple(victim["char_span"])
    victim["char_span"] = [true_span[0] + 1000, true_span[1] + 1000]
    ids_bad = bind_route_identities(strategy, r)
    c3 = _refusal(verify_anchor_identity, prep, ids_bad)
    record(
        "C3", "a literal quote that resolves to a different span than the route row refuses",
        c3 == REASON_SPAN_MISMATCH,
        f"quote unchanged, claimed span moved {true_span} -> {tuple(victim['char_span'])}; refusal={c3}",
    )

    # C4 -- a missing row refuses
    r = copy.deepcopy(route)
    dropped = r["outcomes"].pop(3)["condition_ref"]
    c4 = _refusal(assert_certifiable_final_route, bind_route_identities(strategy, r), GREEN, strategy)
    record("C4", "a missing condition identity refuses", c4 == REASON_REF_SET_MISMATCH,
           f"dropped {dropped!r}; refusal={c4}")

    # C5 -- a DUPLICATED identity refuses (the other half of C4)
    r = copy.deepcopy(route)
    r["outcomes"].append(copy.deepcopy(r["outcomes"][0]))
    c5 = _refusal(assert_certifiable_final_route, bind_route_identities(strategy, r), GREEN, strategy)
    record("C5", "a duplicated condition identity refuses", c5 == REASON_REF_SET_MISMATCH,
           f"13 rows for 12 spine refs; refusal={c5}")

    # C6 -- final route RED refuses certification (restated at control strength)
    c6 = _refusal(assert_certifiable_final_route, ids, route.get("grade"), strategy)
    record("C6", "final route RED refuses certification", c6 == REASON_ROUTE_NOT_GREEN, f"refusal={c6}")

    # C7 -- an unresolved collision cannot be hidden by span deduplication.
    # Two legs: the seam refuses (B3), AND a dedup would have silently
    # "fixed" it -- shown by measuring what set() does to the population.
    r = copy.deepcopy(route)
    for o in r["outcomes"]:
        o["disposition"] = ACCEPTED
    ids_all = bind_route_identities(strategy, r)
    c7 = _refusal(assert_certifiable_final_route, ids_all, GREEN, strategy)
    spans = [i.char_span for i in ids_all]
    record(
        "C7", "an unresolved collision cannot be hidden by span deduplication",
        c7 == REASON_IDENTITY_COLLISION and len(spans) == 12 and len(set(spans)) == 11,
        f"refusal={c7}; identities={len(spans)} but set(spans)={len(set(spans))} -- "
        "the AR-1282 control's dedup would have silently dropped one identity here",
    )

    # C8 -- two identities sharing condition TEXT refuse (the text-keyed
    # proposal seam cannot name one of them).
    r = copy.deepcopy(route)
    strat2 = copy.deepcopy(strategy)
    strat2["entry_sequence"][1]["action"] = strat2["entry_sequence"][0]["action"]
    c8 = _refusal(make_identity_propose_fn, bind_route_identities(strat2, _all_accepted(r)))
    record(
        "C8", "two identities sharing condition text refuse rather than merge",
        c8 == REASON_AMBIGUOUS_CONDITION_TEXT,
        f"entry_sequence[1].action text set equal to entry_sequence[0].action; refusal={c8}",
    )

    return {"positive_witness_pinned": len(verified)}


def _all_accepted(route: dict) -> dict:
    for o in route["outcomes"]:
        o["disposition"] = ACCEPTED
    return route


# --------------------------------------------------------------------------- #
# SECTION D -- the four-residual tier-3 packet shape, WITHOUT dispatch
# --------------------------------------------------------------------------- #
def section_d(strategy, transcript, route) -> dict:
    ids = bind_route_identities(strategy, route)
    propose, _ = make_identity_propose_fn(ids)
    prep = _prepare(strategy, transcript, propose)
    verify_anchor_identity(prep, ids)

    accepted = [i for i in ids if i.accepted]
    item_span_map = prep["item_span_map"] or {}
    span_to_item = {tuple(v): k for k, v in item_span_map.items()}

    set_b = next(s for s in prep["tier3_packet"]["sections"] if s.get("section_id") == "SET-B")
    stage2 = prep["tier3_packet"]["stage2"]
    stage1_by_id = {it["item_id"]: it for it in set_b["items"]}
    stage2_by_id = {it["item_id"]: it for it in stage2["items"]}

    residuals = []
    for i in accepted:
        oc = next(o for o in prep["condition_outcomes"] if o["condition_ref"] == i.condition_ref)
        span = tuple(oc["char_span"])
        item_id = span_to_item.get(span)
        s1 = stage1_by_id.get(item_id)
        s2 = stage2_by_id.get(item_id)
        residuals.append({
            "condition_ref": i.condition_ref,
            "tier1_outcome": oc["outcome"],
            "char_span": list(span),
            "stage1_item": item_id,
            "stage1_is_quote_alone": bool(
                s1 and s1["extracted_condition_type"] is None and s1["extracted_object"] is None
            ),
            "stage1_quote_matches_span": bool(s1 and s1["quote_anchor"]["verbatim"] == transcript[span[0]:span[1]]),
            "stage2_item": item_id if s2 else None,
            "stage2_reveals_condition_text": bool(s2 and s2["extracted_condition_text"] == i.condition_text),
            "stage2_unanswered": bool(s2 and s2["adjudication_response"]["support"] is None),
        })

    one_to_one = (
        len(residuals) == 4
        and len({r["stage1_item"] for r in residuals}) == 4
        and all(r["stage1_item"] is not None and r["stage2_item"] is not None for r in residuals)
        and all(r["stage1_is_quote_alone"] and r["stage1_quote_matches_span"] for r in residuals)
        and all(r["stage2_reveals_condition_text"] and r["stage2_unanswered"] for r in residuals)
    )
    record(
        "D1", "each of the four residuals has exactly one identity, one span, one Stage-1 item and one Stage-2 item",
        one_to_one,
        f"residuals={len(residuals)}, distinct Stage-1 items={len({r['stage1_item'] for r in residuals})}, "
        f"all Stage-1 blind (type/object None) and Stage-2 unanswered",
    )
    record(
        "D2", "the read-order/blinding contract is intact and Stage 2 is structurally outside `sections`",
        bool(stage2.get("read_order_lock")) and prep["leak_scan"].clean,
        f"read_order_lock present; blinding_leak_scan.clean={prep['leak_scan'].clean}; "
        f"Set-B item_count={set_b['item_count']}",
    )
    record(
        "D3", "ZERO dispatch: no rater was invoked and no verdict was fabricated",
        all(it["rater_response"]["role"] is None for it in set_b["items"])
        and all(it["adjudication_response"]["support"] is None for it in stage2["items"]),
        "every Stage-1 rater_response.role is None and every Stage-2 support is None",
    )
    return {
        "residuals": residuals,
        # The lawful tier-3 path, IDENTIFIED from repository authority, not invented:
        "tier3_authority": {
            "stage1_verdict_constructor": "pilot_conveyor.verdict_from_rater_response",
            "stage2_support_constructor": "pilot_conveyor.support_verdict_from_stage2_response",
            "control_gate_field": "cert_assembler.Tier3Verdict.control_gate_passed",
            "control_gate_semantics": (
                "pre-reg section 3 blind protocol: the rater must clear the 5/5 gate + 5/5 context "
                "control set (Set-A) before any Set-B verdict may enter a certificate; "
                "assemble_certificate drops every verdict whose control_gate_passed is False"
            ),
            "blinding_gate": "pilot_conveyor.blinding_leak_scan (must be clean before a packet may ship)",
        },
    }


# --------------------------------------------------------------------------- #
# SECTION A/E -- identity-preserving SYNTHETIC reachability control
# --------------------------------------------------------------------------- #
def _pick_noncolliding_span(transcript: str, used: dict) -> tuple[tuple[int, int], str]:
    """Deterministic first-fit: the earliest sentence-ish chunk that resolves
    as a real anchor and collides with none of the other identities."""
    for m in re.finditer(r"[^.!?]{80,300}[.!?]", transcript):
        quote = m.group(0).strip()
        res = al.locate_anchor(transcript, "x", propose_fn=lambda _t, _c, q=quote: q)
        if not res.located:
            continue
        trial = dict(used)
        trial["__candidate__"] = res.char_span
        if not detect_span_collisions(trial):
            return res.char_span, quote
    raise RuntimeError("no non-colliding resolvable span found")


def section_ae(strategy, transcript, route) -> dict:
    """SYNTHETIC. Constructs the FUTURE final route this campaign is working
    toward -- GREEN, all 12 accepted, collision RESOLVED -- and proves the
    certificate can reach every_condition_classified while carrying all 12
    condition identities.

    NOT EVIDENCE OF A REAL PASS. No semantic verdict here is real: the tier-3
    verdicts are synthesised so the PATHWAY can be measured. The one route
    edit is loudly recorded below.
    """
    syn = copy.deepcopy(route)
    syn["grade"] = GREEN
    forced = [o["condition_ref"] for o in syn["outcomes"] if o.get("disposition") != ACCEPTED]
    for o in syn["outcomes"]:
        o["disposition"] = ACCEPTED

    # Resolve the ONE real collision by re-grounding confluences[1].description
    # on a different, genuinely resolvable span. This models what a future
    # final route must do to be GREEN at all -- production HOLDS the pair today.
    others = {
        o["condition_ref"]: tuple(o["char_span"])
        for o in syn["outcomes"]
        if o["condition_ref"] != "confluences[1].description"
    }
    new_span, new_quote = _pick_noncolliding_span(transcript, others)
    target = next(o for o in syn["outcomes"] if o["condition_ref"] == "confluences[1].description")
    synthetic_edit = {
        "condition_ref": target["condition_ref"],
        "was_span": list(target["char_span"]),
        "now_span": list(new_span),
        "reason": "SYNTHETIC: collision resolved so the route could be GREEN at all",
    }
    target["char_span"] = list(new_span)
    target["quote"] = new_quote

    ids = bind_route_identities(strategy, syn)
    summary = assert_certifiable_final_route(ids, syn["grade"], strategy)

    propose, calls = make_identity_propose_fn(ids)
    prep = _prepare(strategy, transcript, propose)
    pinned = verify_anchor_identity(prep, ids)

    # One synthetic control-gate-passing verdict PER FALL-THROUGH, built from
    # the fall-through list (a LIST, one entry per identity) -- never from a
    # deduplicated span set. That distinction is the whole repair.
    verdicts = [
        Tier3Verdict(
            char_span=ft.char_span,
            quote_anchor=transcript[ft.char_span[0]:ft.char_span[1]],
            surface_class="gate-strength",
            verdict="gate-strength",
            control_gate_passed=True,
        )
        for ft in prep["tier1_fallthroughs"]
    ]
    cert = finalize_certificate(prep, tier3_verdicts=verdicts, conflation_verdict="PASS")
    invariants = assert_identity_preserved(ids, prep, cert)

    tiers = [c["classifying_tier"] for c in cert["conditions"]]
    fallthrough_spans = [ft.char_span for ft in prep["tier1_fallthroughs"]]

    record(
        "A1", "the synthetic final route carries 12 condition identities with 12 distinct join spans",
        summary["identity_count"] == 12 and summary["collisions"] == 0,
        f"identity_count={summary['identity_count']}, collisions={summary['collisions']}, "
        f"distinct spans={len({i.char_span for i in ids})}",
    )
    record(
        "A2", "input identities == adapter identities == certificate condition rows (no set/dict.fromkeys anywhere)",
        invariants["input_condition_identities"] == 12
        and invariants["adapter_condition_identities"] == 12
        and invariants["certificate_condition_rows"] == 12,
        json.dumps(invariants),
    )
    record(
        "A3", "every one of the 12 identities pinned its EXACT route span through the conveyor",
        len(pinned) == 12,
        f"pinned={len(pinned)}/12; adapter proposed {sum(1 for c in calls if c['proposed'])}/{len(calls)}",
    )
    record(
        "E1", "SYNTHETIC CONTROL (not a real verdict): the 12-identity path reaches "
              "every_condition_classified through the legal Tier-1/Tier-3 interfaces",
        all(t in (1, 3) for t in tiers) and cert["pilot_grade"] is True,
        f"classifying_tiers={tiers}; fallthroughs={len(fallthrough_spans)} "
        f"(distinct spans={len(set(fallthrough_spans))}); pilot_grade={cert['pilot_grade']}; "
        f"terminal_read_grade={cert['terminal_read_grade']}  [SYNTHETIC -- NOT A REAL PASS]",
    )
    n_tier1 = sum(1 for t in tiers if t == 1)
    n_tier3 = sum(1 for t in tiers if t == 3)

    return {
        "SYNTHETIC": True,
        "SYNTHETIC_WARNING": (
            "This control forced 8 held/refused/red rows to ACCEPTED and re-grounded one "
            "colliding row. It asserts NOTHING about whether that evidence is acceptable -- "
            "those rows' real dispositions stand, and only a real G2 route may change them. "
            "Its ONLY claim is that the PATHWAY preserves 12 identities end to end."
        ),
        "dispositions_forced_to_accepted": forced,
        "synthetic_edit": synthetic_edit,
        "identity_invariants": invariants,
        "classifying_tiers": tiers,
        "pilot_grade": cert["pilot_grade"],
        "terminal_read_grade": cert["terminal_read_grade"],
        # AR-1282A section 7F -- what remains AFTER the frozen eight turn the
        # final route green. The tier-1 count is MEASURED on this synthetic
        # route; the residual count for the REAL future route is an ESTIMATE,
        # because the final G2 evidence may carry different quotes/spans than
        # the current rows do, and tier-1 fires on the LOCATED QUOTE.
        "post_g2_projection": {
            "measured_on_synthetic_route": {
                "tier1_classified": n_tier1,
                "residual_tier3": n_tier3,
                "basis": "executable -- this run",
            },
            "estimated_for_real_final_route": {
                "expected_tier1_classified": n_tier1,
                "expected_residual_tier3_adjudications": n_tier3,
                "confidence": "ESTIMATE, NOT MEASURED",
                "why_estimate": (
                    "tier-1 fires on the located quote, so a final G2 route that grounds the "
                    "eight on DIFFERENT spans could classify some at tier 1 and reduce the "
                    "residual count. The four currently-accepted rows are the only ones with "
                    "executable evidence, and they are 0/4 at tier 1 (AR-1282, re-measured here)."
                ),
            },
        },
    }


# --------------------------------------------------------------------------- #
def main() -> int:
    strategy, transcript, route = load_pinned()

    b = section_b(strategy, route)
    c = section_c(strategy, transcript, route)
    d = section_d(strategy, transcript, route)
    ae = section_ae(strategy, transcript, route)

    failed = [r["check"] for r in RESULTS if not r["passed"]]

    # SECTION F -- the release-readiness token.
    token = "G2_RELEASE_READY_AFTER_IDENTITY_SEAM" if not failed else "CERTIFICATION_IDENTITY_CONTRACT_DEFECT"

    out = {
        "packet": "AR-1283",
        "ruling": "AR-1282A section 7",
        "model_calls": 0,
        "dispatches": 0,
        "frozen_g2_calls": 0,
        "pins": {"video_id": VIDEO_ID, "strategy_index": STRATEGY_INDEX,
                 "transcript_sha256": PIN_TRANSCRIPT_SHA, "route_grade": route.get("grade")},
        "section_b_precondition": b,
        "section_c_controls": c,
        "section_d_residual_packet": d,
        "section_ae_synthetic": ae,
        "checks": RESULTS,
        "release_readiness_token": token,
    }
    print(json.dumps(out, indent=2))

    print("\n--- AR-1283 CHECKS ---")
    for r in RESULTS:
        print(f"  {'PASS' if r['passed'] else 'FAIL'}  {r['check']:<12} {r['claim']}")
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    print(f"\nRELEASE READINESS: {token}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
