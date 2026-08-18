"""AR-1322A section 3 -- source-graph-projection-v2 repair driver.

Supersedes (does NOT delete or silently rewrite) `ar1321a_source_graph_projection_driver_tmp.py`
per AR-1322A: "Do not rewrite the rejected v1 artifact as if it never existed." The v1 driver and
its output (`source_graph_projection_v1.json`) remain committed history.

Fixes applied over v1, each tied to its AR-1322A finding:

  F48  entry_sequence[1].rationale's governed evidence now includes the literal spans containing
       the actual words "short" and "buy" (not a vague "break to the upside" paraphrase).
  F49  (module-level fix, not driver) preserved-metadata eligibility narrowed to exactly
       `entry_sequence[N].rationale`; stop.rationale/targets[N].rationale can no longer pass.
  F50  every ref now carries a `correction_ledger` ENTRY (original text + authority) so the
       module can compute and embed self-verifying original/projected text hashes; the receipt
       is self-contained, not reconstructible only by reading this script.
  F51  explicit `graph_edges` + `graph_roots` declare the dependency order among all 9 canonical
       nodes plus the F37 alias; `run_projection` validates DAG-ness and full reachability.
  F52  score/hash claims in the accompanying report are pulled from the actual committed output,
       not from a standalone probe run with different (unweighted) parameters.
  F53  (separate) permanent pytest module + RED-witness freeze + hermetic preflight-test fix are
       committed alongside this driver, not only as `_tmp.py` scripts.
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


def build_record():
    """Returns the run_projection() record. Factored out so the permanent test module and the
    __main__ CLI both call the exact same construction path -- no drift between what gets tested
    and what gets committed."""
    from src.engine.extraction.source_graph_projection import (
        AliasSpec, GraphEdge, ProjectionSpec, run_projection,
    )

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(1), encoding="utf-8").read())

    original_text_by_ref = {c["condition_ref"]: c["condition_text"] for c in index["conditions"]}

    recovery_dir = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1"
    isolated_primary: dict[str, str] = {}
    for fn in sorted(os.listdir(recovery_dir)):
        if not fn.endswith(".recovered.json"):
            continue
        obj = json.loads(open(os.path.join(recovery_dir, fn), encoding="utf-8").read())
        isolated_primary[obj["condition_ref"]] = _extract_quote(obj["recovered_raw_text"])

    CONDITION_TEXT_OVERRIDE = {
        "confluences[0].description": "The trade must be initiated at 9:30 AM ET New York time.",
        "entry_sequence[1].action": (
            "Wait for the 1-minute candle to close outside of the 5-minute range (breakout)."
        ),
        "entry_sequence[1].rationale": (
            "The breakout gives an idea of the direction the market wants to go: a downside "
            "break is taken short, an upside break is taken as a buy."
        ),
        "entry_sequence[2].action": "Wait for a fair value gap sequence to print outside the range.",
        "entry_sequence[3].rationale": (
            "The fair value gap sequence is valid once its third candle has been printed."
        ),
    }

    CORRECTION_LEDGER = {
        "confluences[0].description": {
            "original_condition_text": original_text_by_ref["confluences[0].description"],
            "authority": (
                "AR-1314B F38: TIMING_WINDOW_WIDENING repair -- source names a point in time "
                "('at 9:30 a.m. Eastern time'), not a session window."
            ),
        },
        "entry_sequence[1].action": {
            "original_condition_text": original_text_by_ref["entry_sequence[1].action"],
            "authority": (
                "AR-1322A: source_fidelity_guard raised UNSUPPORTED_CERTAINTY on 'established' "
                "against the corrected wider evidence span -- the source only says the trader "
                "is waiting for candles to print outside the range, never that the range was "
                "'established' in that stronger sense. Found by running the real pipeline, not "
                "pre-planned by any ruling."
            ),
        },
        "entry_sequence[1].rationale": {
            "original_condition_text": original_text_by_ref["entry_sequence[1].rationale"],
            "authority": (
                "AR-1321A section 4.A.3: RETYPED into a direction selector (was 'confirms' "
                "prose). AR-1322A F48 repair: the governed evidence package now includes the "
                "literal spans naming 'short' and 'buy', not a paraphrase lacking those words."
            ),
        },
        "entry_sequence[2].action": {
            "original_condition_text": original_text_by_ref["entry_sequence[2].action"],
            "authority": (
                "AR-1321A section 6.7: near-literal correction + antecedent-bound to "
                "entry_sequence[0].action for 'the range' via evidence_antecedent."
            ),
        },
        "entry_sequence[3].rationale": {
            "original_condition_text": original_text_by_ref["entry_sequence[3].rationale"],
            "authority": (
                "AR-1321A section 4.A.5 / 6.8: RETYPED into the FVG-validity prerequisite (was "
                "'confirms the FVG structure and minimizes entry risk' -- 'minimizes entry "
                "risk' was AR-1313's F39 finding, unsupported anywhere in the transcript)."
            ),
        },
    }

    ENTRY_SEQ_1_ACTION_WIDER_QUOTE = (
        "We are essentially waiting for the one minute time frame candles to print into "
        "one of these sides of the range. Now, what does that mean? What has to happen is "
        "the candles need to close outside of this 5m minute range."
    )
    ENTRY_SEQ_1_RATIONALE_DOWNSIDE_QUOTE = (
        "That gives us an idea of the direction in which the market wants to go for the day."
    )
    ENTRY_SEQ_1_RATIONALE_DOWNSIDE_SHORT_QUOTE = (
        "if we have traded into the downside of this range, it means that the price is going "
        "down. So, we want to be taking a short"
    )
    ENTRY_SEQ_1_RATIONALE_UPSIDE_BUY_QUOTE = (
        "So we can go ahead and get this one ready for a buy."
    )
    ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE = (
        "in order for this fair value gap to be a valid fair value gap, the fair value gap "
        "has to actually be formed. And the way that happens is when the third candle of "
        "the sequence has been printed"
    )

    for label, q in [
        ("ENTRY_SEQ_1_ACTION_WIDER_QUOTE", ENTRY_SEQ_1_ACTION_WIDER_QUOTE),
        ("ENTRY_SEQ_1_RATIONALE_DOWNSIDE_SHORT_QUOTE", ENTRY_SEQ_1_RATIONALE_DOWNSIDE_SHORT_QUOTE),
        ("ENTRY_SEQ_1_RATIONALE_UPSIDE_BUY_QUOTE", ENTRY_SEQ_1_RATIONALE_UPSIDE_BUY_QUOTE),
        ("ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE", ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE),
    ]:
        if q not in transcript:
            raise AssertionError(f"{label} is not a literal substring of the pinned transcript")

    RAW_OUTPUT_OVERRIDE = {
        "entry_sequence[1].action": ENTRY_SEQ_1_ACTION_WIDER_QUOTE,
        "entry_sequence[1].rationale": ENTRY_SEQ_1_RATIONALE_DOWNSIDE_QUOTE,
        "entry_sequence[2].action": isolated_primary["entry_sequence[2].action"],
        "entry_sequence[3].rationale": ENTRY_SEQ_3_RATIONALE_VALIDITY_QUOTE,
    }
    EXTRA_EVIDENCE = {
        "entry_sequence[1].rationale": (
            ENTRY_SEQ_1_RATIONALE_DOWNSIDE_SHORT_QUOTE,
            ENTRY_SEQ_1_RATIONALE_UPSIDE_BUY_QUOTE,
        ),
    }

    conditions = []
    for c in index["conditions"]:
        ref = c["condition_ref"]
        text = CONDITION_TEXT_OVERRIDE.get(ref, c["condition_text"])
        conditions.append({"condition_ref": ref, "condition_text": text})

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
                "'the candles need to close outside of this 5m minute range' -- the F37 "
                "collision pair AR-1312B named."
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
                "still below the 0.10 floor). AR-1320B/AR-1314D: EVIDENCE_SET_EXHAUSTED / "
                "CAUSE_NOT_YET_DISCRIMINATED, not a proven gate limitation."
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
                "from the full transcript by exhaustive search, AR-1314B). AR-1320B/AR-1314D: "
                "its only recovered quote has no alternate span offered; EVIDENCE_SET_EXHAUSTED "
                "/ CAUSE_NOT_YET_DISCRIMINATED, not a proven gate limitation, under the flat "
                "all-role rival pool. Not re-tested under the role-bounded pool -- AR-1321A did "
                "not name it as in-scope for role-bounded retesting; only "
                "entry_sequence[2].action and entry_sequence[3].rationale were."
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

    # AR-1322A F51 -- explicit dependency graph over the 9 canonical nodes + the F37 alias.
    # Edge types are fixture vocabulary (opaque to the generic module); the module only checks
    # ref existence, acyclicity, and reachability of every canonical ref from the declared root.
    graph_edges = (
        GraphEdge("confluences[0].description", "entry_sequence[0].action", "timing_applies_to_range_definition"),
        GraphEdge("entry_sequence[0].action", "entry_sequence[1].action", "range_enables_breakout_close"),
        GraphEdge("entry_sequence[1].action", "entry_sequence[1].rationale", "breakout_side_selects_direction"),
        GraphEdge("entry_sequence[0].action", "entry_sequence[2].action", "range_bounds_fvg_outside"),
        GraphEdge("entry_sequence[2].action", "entry_sequence[3].rationale", "fvg_outside_requires_validity"),
        GraphEdge("entry_sequence[3].rationale", "entry_sequence[3].action", "validity_enables_entry_close"),
        GraphEdge("entry_sequence[3].action", "stop.rationale", "trade_attaches_stop"),
        GraphEdge("entry_sequence[3].action", "targets[0].rationale", "trade_attaches_target"),
        GraphEdge("confluences[1].description", "entry_sequence[1].action", "alias_of_canonical_breakout"),
    )
    graph_roots = ("confluences[0].description",)

    projection = ProjectionSpec(
        canonical_refs=canonical_refs,
        alias_specs=alias_specs,
        preserved_metadata_refs=preserved_metadata_refs,
        preserved_metadata_records=preserved_metadata_records,
        correction_ledger=CORRECTION_LEDGER,
        graph_edges=graph_edges,
        graph_roots=graph_roots,
    )

    return run_projection(
        transcript=transcript,
        conditions=conditions,
        batch_answers=final_answers,
        projection=projection,
        composition_specs=composition_specs,
        extra_evidence_by_ref=EXTRA_EVIDENCE,
    )


def main() -> int:
    record = build_record()
    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2.json"
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"grade: {record['grade']}")
    print("conservation:", record["conservation"])
    print(f"canonical accepted {record['canonical_accepted_count']}/{len(record['canonical_refs'])}")
    print("graph:", {k: v for k, v in record["graph"].items() if k != "edges"})
    for o in record["outcomes"]:
        print(f"  {o['condition_ref']}: {o['disposition']} ({o.get('gate')})")
        if o["disposition"] not in (
            "ACCEPTED_PENDING_CERTIFICATION", "ALIAS_OF_CANONICAL",
            "PRESERVED_NON_EXECUTABLE_METADATA",
        ):
            print(f"      reason: {o.get('reason', '')[:200]}")
    print(f"wrote {out_path}")
    return 0 if record["grade"] == "GREEN_PENDING_CERTIFICATION" else 1


if __name__ == "__main__":
    raise SystemExit(main())
