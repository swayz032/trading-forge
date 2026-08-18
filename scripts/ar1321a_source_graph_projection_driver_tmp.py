"""AR-1321A sections 4-7 -- sVkm-specific driver for source_graph_projection.run_projection().

Fixture-specific adjudications live HERE, not in the generic module (AR-1321A section 6.3).
Zero new Agent/Task/model calls. Original pinned extraction/transcript/frozen-queue/receipts
are read-only inputs, never modified.
"""
from __future__ import annotations

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


def main() -> int:
    from src.engine.extraction.source_graph_projection import (
        AliasSpec, ProjectionSpec, run_projection,
    )

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(1), encoding="utf-8").read())

    recovery_dir = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1"
    isolated_primary: dict[str, str] = {}
    for fn in sorted(os.listdir(recovery_dir)):
        if not fn.endswith(".recovered.json"):
            continue
        obj = json.loads(open(os.path.join(recovery_dir, fn), encoding="utf-8").read())
        isolated_primary[obj["condition_ref"]] = _extract_quote(obj["recovered_raw_text"])

    # ------------------------------------------------------------------ #
    # Fixture-specific condition-text corrections/retypings (AR-1321A §4.A, §6)
    # ------------------------------------------------------------------ #
    CONDITION_TEXT_OVERRIDE = {
        # AR-1314B, unchanged by this pass:
        "confluences[0].description": "The trade must be initiated at 9:30 AM ET New York time.",
        # entry_sequence[1].action: "established" is an unsupported certainty claim the
        # fidelity guard correctly caught (source only says "we are waiting for... candles to
        # print into one of these sides of the range" -- no claim that the range was
        # established/settled). Drop it; the mechanical requirement is unchanged.
        "entry_sequence[1].action": (
            "Wait for the 1-minute candle to close outside of the 5-minute range (breakout)."
        ),
        # RETYPED per AR-1321A §4.A.3: direction selector, not "confirms" prose. Keeps the
        # source's own hedge phrasing ("gives us an idea of the direction") rather than
        # asserting certainty, and states the mechanical short/long mapping the two worked
        # examples (downside break -> short at transcript offset ~10059; upside break -> buy
        # at offset ~18173) both demonstrate -- carried via extra_evidence_by_ref for fidelity,
        # not claimed by the relevance-scored primary span alone.
        "entry_sequence[1].rationale": (
            "The breakout gives an idea of the direction the market wants to go: a downside "
            "break is taken short, an upside break is taken long."
        ),
        # near-literal per AR-1321A §6.7, antecedent-bound to entry_sequence[0].action for "the range".
        "entry_sequence[2].action": (
            "Wait for a fair value gap sequence to print outside the range."
        ),
        # RETYPED per AR-1321A §4.A.5 / §6.8: FVG-validity prerequisite, not "confirms ... minimizes ...".
        "entry_sequence[3].rationale": (
            "The fair value gap sequence is valid once its third candle has been printed."
        ),
    }

    # ------------------------------------------------------------------ #
    # Evidence (raw_output fed to bl.verify_answer -- plain literal quote strings, same
    # substitution pattern g2d_finalizer.finalize() uses for isolated-fallback refs).
    # ------------------------------------------------------------------ #
    ENTRY_SEQ_1_ACTION_WIDER_QUOTE = (
        "We are essentially waiting for the one minute time frame candles to print into "
        "one of these sides of the range. Now, what does that mean? What has to happen is "
        "the candles need to close outside of this 5m minute range."
    )
    ENTRY_SEQ_1_RATIONALE_DOWNSIDE_QUOTE = (
        "That gives us an idea of the direction in which the market wants to go for the day."
    )
    ENTRY_SEQ_1_RATIONALE_UPSIDE_QUOTE = (
        "So it looks like price is moving to the upside here. And let's just play and see "
        "if we get a break. Great. So we have our break to the upside."
    )
    ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE = (
        "in order for this fair value gap to be a valid fair value gap, the fair value gap "
        "has to actually be formed. And the way that happens is when the third candle of "
        "the sequence has been printed"
    )

    assert ENTRY_SEQ_1_RATIONALE_UPSIDE_QUOTE in transcript, "upside quote not literal"
    assert ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE in transcript, "validity quote not literal"

    RAW_OUTPUT_OVERRIDE = {
        "entry_sequence[1].action": ENTRY_SEQ_1_ACTION_WIDER_QUOTE,
        "entry_sequence[1].rationale": ENTRY_SEQ_1_RATIONALE_DOWNSIDE_QUOTE,
        "entry_sequence[2].action": isolated_primary["entry_sequence[2].action"],
        "entry_sequence[3].rationale": ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE,
    }

    EXTRA_EVIDENCE = {
        "entry_sequence[1].rationale": (ENTRY_SEQ_1_RATIONALE_UPSIDE_QUOTE,),
    }

    conditions = []
    for c in index["conditions"]:
        ref = c["condition_ref"]
        text = CONDITION_TEXT_OVERRIDE.get(ref, c["condition_text"])
        conditions.append({"condition_ref": ref, "condition_text": text})

    # Build the same "final_answers" shape g2d_finalizer.finalize() builds: batch by default,
    # overridden per-ref for the frozen isolated-fallback refs and the two retyped refs.
    batch_by_ref = {a["condition_ref"]: a["raw_output"] for a in answers["answers"]}
    final_answers = []
    for c in conditions:
        ref = c["condition_ref"]
        if ref in RAW_OUTPUT_OVERRIDE:
            raw = RAW_OUTPUT_OVERRIDE[ref]
        elif ref in isolated_primary and isolated_primary[ref] is not None:
            raw = isolated_primary[ref]
        else:
            raw = batch_by_ref[ref]
        final_answers.append({"condition_ref": ref, "raw_output": raw})

    # ------------------------------------------------------------------ #
    # Antecedent composition: entry_sequence[2].action's "the range" -> entry_sequence[0].action
    # ------------------------------------------------------------------ #
    import src.engine.extraction.batch_locator as bl

    verified_es0 = bl.verify_answer(transcript, batch_by_ref["entry_sequence[0].action"])
    assert verified_es0["outcome"] == bl.OUTCOME_LITERAL, "entry_sequence[0].action must locate"
    es0_span = verified_es0["char_span"]

    composition_specs = [
        {
            "condition_ref": "entry_sequence[2].action",
            "qualifier": "the range",
            "qualifier_synonyms": ("range",),
            "entity_terms": ("range",),
            "definitional_markers": ("gives",),
            "antecedent_span": es0_span,
            "authority": (
                "AR-1321A section 6.7: 'the FVG-outside-range node must bind range to the "
                "certified five-minute range.' Antecedent = entry_sequence[0].action's own "
                "literal span, which defines the range via '...that now gives me is a range "
                "on the five minute.'"
            ),
        },
    ]

    # ------------------------------------------------------------------ #
    # Projection bucket assignment (AR-1321A §4.A/B/C -- exact 9 + 1 + 2 conservation)
    # ------------------------------------------------------------------ #
    canonical_refs = (
        "entry_sequence[0].action",
        "entry_sequence[1].action",
        "entry_sequence[1].rationale",
        "entry_sequence[2].action",
        "entry_sequence[3].rationale",
        "entry_sequence[3].action",
        "confluences[0].description",
        "stop.rationale",
        "targets[0].rationale",
    )
    alias_specs = (
        AliasSpec(
            alias_ref="confluences[1].description",
            canonical_ref="entry_sequence[1].action",
            authority=(
                "AR-1321A section 4.B: explicit external adjudication that "
                "confluences[1].description aliases the same canonical breakout-close "
                "predicate as entry_sequence[1].action. Both isolated-recovery agents "
                "independently located the identical literal span "
                "'the candles need to close outside of this 5m minute range' -- not a "
                "coincidence, the F37 collision pair AR-1312B named."
            ),
        ),
    )
    preserved_metadata_refs = (
        "entry_sequence[0].rationale",
        "entry_sequence[2].rationale",
    )
    preserved_metadata_records = {
        "entry_sequence[0].rationale": {
            "original_condition_text": index["conditions"][1]["condition_text"],
            "history": (
                "AR-1313: classified OTHER_EXPLICIT_BLOCKER -- condition text conflates the "
                "mechanical range-marking action with a separate, later trader remark about "
                "why 9:30 is volatile; own=0.016 (primary) / 0.097 (best available secondary, "
                "still below the 0.10 floor). No further evidence exists to resolve this. "
                "AR-1320B section 2 F41 (via the AR-1314D correction): this is EVIDENCE_SET_"
                "EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED, not a proven gate limitation."
            ),
            "reason": (
                "does not add a distinct source-owned executable decision beyond the "
                "canonical range-definition node (entry_sequence[0].action); preserved as "
                "non-executable extractor commentary"
            ),
        },
        "entry_sequence[2].rationale": {
            "original_condition_text": index["conditions"][5]["condition_text"],
            "history": (
                "AR-1313 (F39): removed unsupported 'high-probability' claim (confirmed absent "
                "from the full transcript by exhaustive search, AR-1314B). AR-1320B section 2 "
                "F41 (via AR-1314D): its only recovered quote has no alternate span offered; "
                "EVIDENCE_SET_EXHAUSTED / CAUSE_NOT_YET_DISCRIMINATED, not a proven gate "
                "limitation, under the flat all-role rival pool. Not re-tested under the "
                "role-bounded pool in this pass (AR-1321A did not name it as in-scope for "
                "role-bounded retesting; only entry_sequence[2].action and "
                "entry_sequence[3].rationale were)."
            ),
            "reason": (
                "explains why the FVG matters (entry point after breakout) without adding a "
                "distinct source-owned mechanical requirement beyond entry_sequence[2].action "
                "(FVG must print outside the range) and entry_sequence[3].rationale (FVG "
                "validity via third-candle printing); preserved as non-executable extractor "
                "commentary"
            ),
        },
    }

    projection = ProjectionSpec(
        canonical_refs=canonical_refs,
        alias_specs=alias_specs,
        preserved_metadata_refs=preserved_metadata_refs,
        preserved_metadata_records=preserved_metadata_records,
    )

    record = run_projection(
        transcript=transcript,
        conditions=conditions,
        batch_answers=final_answers,
        projection=projection,
        composition_specs=composition_specs,
        extra_evidence_by_ref=EXTRA_EVIDENCE,
    )

    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v1.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)

    print(f"grade: {record['grade']}")
    print("conservation:", record["conservation"])
    print(f"canonical accepted {record['canonical_accepted_count']}/{len(canonical_refs)}")
    for o in record["outcomes"]:
        print(f"  {o['condition_ref']}: {o['disposition']} ({o.get('gate')})")
        if o["disposition"] not in (
            "ACCEPTED_PENDING_CERTIFICATION", "ALIAS_OF_CANONICAL",
            "PRESERVED_NON_EXECUTABLE_METADATA",
        ):
            print(f"      reason: {o.get('reason', '')[:200]}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
