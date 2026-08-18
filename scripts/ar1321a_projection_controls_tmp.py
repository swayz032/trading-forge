"""AR-1321A section 7, items 5-8 and 11 -- required proof controls for the source-graph
projection. Zero new Agent/Task/model calls. Reuses run_projection() exactly as the real
driver does; only the projection spec / evidence differ per control.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys

sys.path.insert(0, os.getcwd())


def _driver():
    spec = importlib.util.spec_from_file_location(
        "_svkm_driver", os.path.join("scripts", "svkm_opus_batch_locator.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    from src.engine.extraction.source_graph_projection import (
        AliasSpec, ProjectionSpec, run_projection,
    )
    from src.engine.extraction import batch_locator as bl

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(1), encoding="utf-8").read())
    batch_by_ref = {a["condition_ref"]: a["raw_output"] for a in answers["answers"]}

    results = {}

    # ------------------------------------------------------------------ #
    # Item 5 -- negative control: an alias between GENUINELY DIFFERENT requirements
    # (stop.rationale vs targets[0].rationale) must be REFUSED, not silently honoured.
    # ------------------------------------------------------------------ #
    conditions = [{"condition_ref": c["condition_ref"], "condition_text": c["condition_text"]}
                  for c in index["conditions"]]
    bad_alias_projection = ProjectionSpec(
        canonical_refs=tuple(
            r for r in [c["condition_ref"] for c in conditions]
            if r not in ("targets[0].rationale",
                         "entry_sequence[0].rationale", "entry_sequence[2].rationale")
        ),
        alias_specs=(
            AliasSpec("targets[0].rationale", "stop.rationale", "MUTATION TEST -- must refuse"),
        ),
        preserved_metadata_refs=("entry_sequence[0].rationale", "entry_sequence[2].rationale"),
        preserved_metadata_records={
            "entry_sequence[0].rationale": {"reason": "control scaffolding"},
            "entry_sequence[2].rationale": {"reason": "control scaffolding"},
        },
    )
    try:
        run_projection(transcript, conditions, answers["answers"], bad_alias_projection)
        results["item5_bad_alias_refused"] = False
        print("ITEM 5 FAIL: bad alias was NOT refused")
    except ValueError as e:
        ok = "ALIAS_REFUSED" in str(e)
        results["item5_bad_alias_refused"] = ok
        print(f"ITEM 5 {'PASS' if ok else 'FAIL (wrong error)'}: {e}")

    # ------------------------------------------------------------------ #
    # Item 6 -- mutation control: excluding an ACTION as "preserved non-executable metadata"
    # must be REFUSED.
    # ------------------------------------------------------------------ #
    bad_preserved_projection = ProjectionSpec(
        canonical_refs=tuple(
            r for r in [c["condition_ref"] for c in conditions]
            if r not in ("entry_sequence[0].action", "entry_sequence[2].rationale",
                         "confluences[1].description")
        ),
        alias_specs=(),
        preserved_metadata_refs=("entry_sequence[0].action", "entry_sequence[2].rationale",
                                  "confluences[1].description"),
        preserved_metadata_records={
            "entry_sequence[0].action": {"reason": "MUTATION TEST -- must refuse, this is an action"},
            "entry_sequence[2].rationale": {"reason": "control scaffolding"},
            "confluences[1].description": {"reason": "MUTATION TEST -- must refuse, this is a description"},
        },
    )
    try:
        run_projection(transcript, conditions, answers["answers"], bad_preserved_projection)
        results["item6_bad_preserved_refused"] = False
        print("ITEM 6 FAIL: excluding an action/description as metadata was NOT refused")
    except ValueError as e:
        ok = "PRESERVED_METADATA_REFUSED" in str(e)
        results["item6_bad_preserved_refused"] = ok
        print(f"ITEM 6 {'PASS' if ok else 'FAIL (wrong error)'}: {e}")

    # ------------------------------------------------------------------ #
    # Item 7 -- the char-19546 disclaimer must be rejected for EVERY canonical node under the
    # NEW role-bounded relevance rival pool (not just the flat pool AR-1320B already checked).
    # ------------------------------------------------------------------ #
    from src.engine.extraction import evidence_relevance as er
    from src.engine.extraction.source_graph_projection import _claim_role

    disclaimer = transcript[19546:19757]
    assert "not perfect" in disclaimer

    real_canonical_texts = {
        "entry_sequence[0].action": "At 9:30 AM ET, define the initial range by marking the high and low of the first 5-minute candle.",
        "entry_sequence[1].action": "Wait for the 1-minute candle to close outside of the 5-minute range (breakout).",
        "entry_sequence[1].rationale": "The breakout gives an idea of the direction the market wants to go: a downside break is taken short, an upside break is taken long.",
        "entry_sequence[2].action": "Wait for a fair value gap sequence to print outside the range.",
        "entry_sequence[3].rationale": "The fair value gap sequence is valid once its third candle has been printed.",
        "entry_sequence[3].action": "Enter the trade (long or short) on the closure of the third candle of the FVG sequence.",
        "confluences[0].description": "The trade must be initiated at 9:30 AM ET New York time.",
        "stop.rationale": "The stop is placed at the bottom of the FVG candle, including the wick, to allow room for breathing.",
        "targets[0].rationale": "The strategy uses a fixed mechanical target based on a 2R risk-to-reward ratio.",
    }
    role_pool = {}
    for ref in real_canonical_texts:
        role_pool.setdefault(_claim_role(ref), []).append(ref)

    item7_ok = True
    for ref, text in real_canonical_texts.items():
        rivals = [real_canonical_texts[r] for r in role_pool[_claim_role(ref)] if r != ref]
        v = er.evaluate_evidence_relevance(text, disclaimer, rival_conditions=rivals, source_document=transcript)
        if v.grounded:
            item7_ok = False
            print(f"ITEM 7 FAIL: disclaimer grounded against {ref!r}: {v.reason}")
    results["item7_disclaimer_rejected_role_bounded"] = item7_ok
    print(f"ITEM 7 {'PASS' if item7_ok else 'FAIL'}: disclaimer rejected against all 9 canonical nodes, role-bounded rivals")

    # ------------------------------------------------------------------ #
    # Item 8 -- a generic same-role quote reused across two different actions must remain
    # rejected/held, not silently accepted, under role-bounded (actions-only) rivals.
    # ------------------------------------------------------------------ #
    action_texts = [real_canonical_texts[r] for r in role_pool["action"]]
    generic_action_quote = "Okay, let's go ahead and take a look at the chart here."
    item8_ok = True
    for ref in role_pool["action"]:
        own_rivals = [t for r, t in zip(role_pool["action"], action_texts) if r != ref]
        v = er.evaluate_evidence_relevance(
            real_canonical_texts[ref], generic_action_quote, rival_conditions=own_rivals,
            source_document=transcript,
        )
        if v.grounded:
            item8_ok = False
            print(f"ITEM 8 FAIL: generic action-quote grounded against {ref!r}: {v.reason}")
    results["item8_generic_reused_quote_rejected"] = item8_ok
    print(f"ITEM 8 {'PASS' if item8_ok else 'FAIL'}: generic reused quote rejected across all same-role actions")

    print()
    print(json.dumps(results, indent=2))
    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/ar1321a_projection_controls.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"wrote {out_path}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
