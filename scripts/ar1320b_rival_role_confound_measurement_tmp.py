"""AR-1320B section 4 -- rival-role comparator confound measurement.

Read-only / derived-artifact measurement. Does NOT edit evidence_relevance.py,
g2d_finalizer.py, opus_phase1_route.py, term_equivalence.py, the 0.10 floor, or any
frozen historical artifact. Zero new Agent/Task/model calls. No synonym/alias added.

For every currently REFUSED_RELEVANCE row in the committed 6/12 route
(opus_phase1_route_t1_g2d_final_ar1314b.json), emits:
  (B) a deterministic table: role, current own score, current best rival (ref/text/role/score),
      mechanical relationship to that rival, evidence package tested.
  (C) the SAME production evaluate_evidence_relevance() function run under 3 counterfactual
      rival-set variants (control / same-field-role-only / exclude-same-step-sibling-only),
      as a MEASUREMENT, not a proposed production change.
  Safety controls required by the ruling:
    - the RED-A char-19546 disclaimer span (src/engine/tests/test_evidence_relevance.py) must
      still MISGROUND against every one of the 12 real conditions under every variant;
    - the 6 currently ACCEPTED rows must remain grounded, using their own current evidence,
      under every variant.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import re
import sys

sys.path.insert(0, os.getcwd())


def _driver():
    spec = importlib.util.spec_from_file_location(
        "_svkm_driver", os.path.join("scripts", "svkm_opus_batch_locator.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _extract_quote(recovered_raw_text: str) -> str | None:
    m = re.search(r"```json\s*(\{.*?\})\s*```", recovered_raw_text, re.DOTALL)
    blob = m.group(1) if m else None
    if blob is None:
        m2 = re.search(r"\{[^{}]*\"quote\"[^{}]*\}", recovered_raw_text, re.DOTALL)
        blob = m2.group(0) if m2 else None
    if blob is None:
        return None
    return json.loads(blob).get("quote")


CORRECTED_EVIDENCE = {
    "entry_sequence[1].rationale": (
        "That gives us an idea of the direction in which the market wants to go for the day."
    ),
}

CORRECTED_CONDITION_TEXT = {
    "confluences[0].description": "The trade must be initiated at 9:30 AM ET New York time.",
    "entry_sequence[2].rationale": "The FVG provides an entry point after the initial directional breakout.",
    "entry_sequence[3].rationale": "Entering on the closure confirms the FVG structure.",
    "entry_sequence[1].rationale": "The breakout gives an indication of the market direction (up or down) for the trade.",
}

_STEP_RE = re.compile(r"^(entry_sequence|confluences|targets)\[(\d+)\]\.(\w+)$")


def _role_and_group(ref: str) -> tuple[str, str]:
    """Return (role, group) where group identifies "same step" membership."""
    m = _STEP_RE.match(ref)
    if m:
        family, idx, role = m.groups()
        if family == "entry_sequence":
            return role, f"entry_step_{idx}"
        if family == "confluences":
            return role, f"confluence_{idx}"
        return role, f"target_{idx}"
    if ref.startswith("stop."):
        return ref.split(".", 1)[1], "stop"
    return ref, ref


def _relationship(own_ref: str, rival_ref: str) -> str:
    own_role, own_group = _role_and_group(own_ref)
    rival_role, rival_group = _role_and_group(rival_ref)
    if own_group == rival_group:
        return "SAME_ENTRY_STEP" if own_group.startswith("entry_step_") else "SAME_GROUP_OTHER_ROLE"
    om = _STEP_RE.match(own_ref)
    rm = _STEP_RE.match(rival_ref)
    if om and rm and om.group(1) == "entry_sequence" and rm.group(1) == "entry_sequence":
        if abs(int(om.group(2)) - int(rm.group(2))) == 1:
            return "ADJACENT_ENTRY_STEP"
    known_dup_pairs = {
        frozenset({"entry_sequence[1].action", "confluences[1].description"}),
    }
    if frozenset({own_ref, rival_ref}) in known_dup_pairs:
        return "KNOWN_DUPLICATE_ROLE_PAIR"
    return "UNRELATED"


def main() -> int:
    from src.engine.extraction import evidence_relevance as er
    from src.engine.extraction import g2d_finalizer as fin

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(1), encoding="utf-8").read())
    queue_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json"
    queue = json.loads(open(queue_path, encoding="utf-8").read())

    recovery_dir = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1"
    isolated_results: dict[str, str] = {}
    for fn in sorted(os.listdir(recovery_dir)):
        if not fn.endswith(".recovered.json"):
            continue
        obj = json.loads(open(os.path.join(recovery_dir, fn), encoding="utf-8").read())
        ref = obj["condition_ref"]
        isolated_results[ref] = CORRECTED_EVIDENCE.get(ref) or _extract_quote(obj["recovered_raw_text"])

    conditions = copy.deepcopy(index["conditions"])
    for cond in conditions:
        ref = cond["condition_ref"]
        if ref in CORRECTED_CONDITION_TEXT:
            cond["condition_text"] = CORRECTED_CONDITION_TEXT[ref]
            cond["condition_text_sha256"] = hashlib.sha256(
                CORRECTED_CONDITION_TEXT[ref].encode("utf-8")
            ).hexdigest()

    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in conditions}
    all_refs = list(text_by_ref)

    # --- reproduce the committed 6/12 route to find current REFUSED_RELEVANCE + ACCEPTED sets ---
    record = fin.finalize(
        transcript=transcript,
        conditions=conditions,
        batch_answers=answers["answers"],
        queue=queue,
        isolated_results=isolated_results,
    )
    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    refused_relevance = [
        ref for ref, o in outcome_by_ref.items()
        if o["disposition"] == "REFUSED_RELEVANCE"
    ]
    accepted = [
        ref for ref, o in outcome_by_ref.items()
        if o["disposition"] == "ACCEPTED_PENDING_CERTIFICATION"
    ]
    assert record["grade"] == "RED" and record["accepted_count"] == 6, (
        "PRECONDITION FAILED: committed 6/12 route did not reproduce byte-identically -- STOP"
    )

    def rival_texts(own_ref: str, mode: str) -> list[str]:
        own_role, _ = _role_and_group(own_ref)
        if mode == "control":
            refs = [r for r in all_refs if r != own_ref]
        elif mode == "same_field_role":
            refs = [r for r in all_refs if r != own_ref and _role_and_group(r)[0] == own_role]
        elif mode == "exclude_same_step_sibling":
            own_m = _STEP_RE.match(own_ref)
            sibling = None
            if own_m and own_m.group(1) == "entry_sequence":
                other_role = "rationale" if own_role == "action" else "action"
                sibling = f"entry_sequence[{own_m.group(2)}].{other_role}"
            refs = [r for r in all_refs if r != own_ref and r != sibling]
        else:
            raise ValueError(mode)
        return [text_by_ref[r] for r in refs]

    print("=" * 100)
    print("PART B -- deterministic table for currently REFUSED_RELEVANCE rows (control rival set)")
    print("=" * 100)
    table_b = []
    for ref in sorted(refused_relevance):
        role, group = _role_and_group(ref)
        quote = isolated_results.get(ref, "")
        v = er.evaluate_evidence_relevance(
            text_by_ref[ref], quote, rival_conditions=rival_texts(ref, "control"),
            source_document=transcript,
        )
        rival_ref = next((r for r in all_refs if r != ref and text_by_ref[r] == v.rival), None)
        rival_role, _ = _role_and_group(rival_ref) if rival_ref else (None, None)
        rel = _relationship(ref, rival_ref) if rival_ref else "NO_RIVAL"
        row = {
            "condition_ref": ref,
            "role": role,
            "own_score": v.own_score,
            "best_rival_ref": rival_ref,
            "best_rival_role": rival_role,
            "best_rival_score": v.best_rival_score,
            "relationship_to_rival": rel,
            "evidence_package_tested": quote,
        }
        table_b.append(row)
        print(json.dumps(row, indent=2))

    print()
    print("=" * 100)
    print("PART C -- counterfactual rival-set variants (MEASUREMENT ONLY, not production behavior)")
    print("=" * 100)
    variants = ["control", "same_field_role", "exclude_same_step_sibling"]
    table_c = []
    for ref in sorted(refused_relevance):
        quote = isolated_results.get(ref, "")
        for variant in variants:
            rivals = rival_texts(ref, variant)
            v = er.evaluate_evidence_relevance(
                text_by_ref[ref], quote, rival_conditions=rivals, source_document=transcript,
            )
            row = {
                "condition_ref": ref,
                "variant": variant,
                "n_rivals": len(rivals),
                "grounded": v.grounded,
                "own_score": v.own_score,
                "best_rival_score": v.best_rival_score,
                "reason": v.reason,
            }
            table_c.append(row)
            print(json.dumps(row))

    print()
    print("=" * 100)
    print("SAFETY CONTROL 1 -- the 6 currently ACCEPTED rows must remain grounded under every variant")
    print("=" * 100)
    control1_ok = True
    for ref in sorted(accepted):
        # BUG FIX (this pass): the accepted rows' real evidence is whatever finalize() actually
        # used (batch answer OR isolated fallback) -- read it from the outcome record itself,
        # not from the isolated-fallback-only `isolated_results` dict, which is empty for any
        # row that was accepted via the original batch answers rather than escalated to isolated.
        quote = outcome_by_ref[ref].get("quote") or isolated_results.get(ref, "")
        for variant in variants:
            v = er.evaluate_evidence_relevance(
                text_by_ref[ref], quote, rival_conditions=rival_texts(ref, variant),
                source_document=transcript,
            )
            status = "OK" if v.grounded else "FAIL"
            if not v.grounded:
                control1_ok = False
            print(f"  {status}  {ref}  variant={variant}  grounded={v.grounded}  own={v.own_score:.3f}")
    print(f"CONTROL 1 RESULT: {'PASS' if control1_ok else 'FAIL'}")

    print()
    print("=" * 100)
    print("SAFETY CONTROL 2 -- RED-A disclaimer span must MISGROUND every one of the 12 real")
    print("conditions under every variant (transcript[19546:19757])")
    print("=" * 100)
    disclaimer = transcript[19546:19757]
    assert "not perfect" in disclaimer, "fixture drift: this is not the disclaimer span"
    control2_ok = True
    for ref in sorted(all_refs):
        for variant in variants:
            v = er.evaluate_evidence_relevance(
                text_by_ref[ref], disclaimer, rival_conditions=rival_texts(ref, variant),
                source_document=transcript,
            )
            if v.grounded:
                control2_ok = False
                print(f"  FAIL  {ref}  variant={variant}  disclaimer INCORRECTLY grounded: {v.reason}")
    print(f"CONTROL 2 RESULT: {'PASS -- disclaimer misgrounded in all cases' if control2_ok else 'FAIL'}")

    out = {
        "table_b_refused_rows": table_b,
        "table_c_counterfactuals": table_c,
        "control_1_accepted_rows_stay_grounded": control1_ok,
        "control_2_disclaimer_stays_misgrounded": control2_ok,
    }
    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/ar1320b_rival_role_confound_measurement.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print()
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
