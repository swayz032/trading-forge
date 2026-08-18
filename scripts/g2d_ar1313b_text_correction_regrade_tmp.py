"""AR-1314A Lane B -- apply the source-truth condition-TEXT corrections GPT already named
(F38, F39 x2, CERTAINTY_INFLATION) through the unmodified finalize()/run_route() path, on top
of the AR-1313 evidence-quote correction it depends on. Zero new Agent/Task/model calls.

Scope discipline: only the four rows GPT explicitly proved as source overclaims are edited.
`entry_sequence[0].rationale` (OTHER_EXPLICIT_BLOCKER, unproven) and F37 upstream duplication
(no existing role-link seam -- reported, not architected around, per AR-1313) are left untouched.

Preserve-and-strike: this does NOT edit sVkmZklJDHI.json, batch_task_index.json, or any AR-1313
artifact in place. It emits a new revision artifact only.

Corrections, each supported directly by transcript evidence already on record in
docs/replay-results/svkm-extraction-certified/grade/opus-v2/G2D-AR1313-ATTRIBUTION-AND-REGRADE.md:

  F38  confluences[0].description
       source: "This strategy needs to be traded at 9:30 a.m. Eastern time, New York time."
       -- a point in time, not a session window. "during the ... session" widened it; corrected
       to name the point in time directly.

  F39a entry_sequence[2].rationale
       "high-probability" has no transcript support (trader: "this model is not perfect ...
       You are going to lose on this model"). Removed; grounded mechanical claim kept.

  F39b entry_sequence[3].rationale
       "minimizes entry risk" has no transcript support. Removed; the grounded
       "confirms the FVG structure" clause (not flagged by GPT) is kept unchanged.

  CERTAINTY_INFLATION entry_sequence[1].rationale
       source (the AR-1313-recovered secondary quote): "That gives us an idea of the direction
       in which the market wants to go for the day." -- a hedge, not a confirmation. "confirms"
       replaced with the source's own hedge framing. This pairs with the AR-1313 evidence
       correction for the same row (CORRECTED_EVIDENCE below), which is unchanged from AR-1313.
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


# Unchanged from AR-1313 -- same proven evidence-packaging fix, same row.
CORRECTED_EVIDENCE = {
    "entry_sequence[1].rationale": (
        "That gives us an idea of the direction in which the market wants to go for the day."
    ),
}

# New this pass -- condition TEXT corrections, one per GPT-proven overclaim.
CORRECTED_CONDITION_TEXT = {
    "confluences[0].description": (
        "The trade must be initiated at 9:30 AM ET New York time."
    ),
    "entry_sequence[2].rationale": (
        "The FVG provides an entry point after the initial directional breakout."
    ),
    "entry_sequence[3].rationale": (
        "Entering on the closure confirms the FVG structure."
    ),
    "entry_sequence[1].rationale": (
        "The breakout gives an indication of the market direction (up or down) for the trade."
    ),
}


def main() -> int:
    from src.engine.extraction import g2d_finalizer as fin

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(1), encoding="utf-8").read())
    if answers["task_sha256"] != index["task_sha256"]:
        raise SystemExit("ABORT: trial 1 answers bound to a different task than the index.")

    queue_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json"
    queue = json.loads(open(queue_path, encoding="utf-8").read())

    recovery_dir = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1"
    isolated_results: dict[str, str] = {}
    for fn in sorted(os.listdir(recovery_dir)):
        if not fn.endswith(".recovered.json"):
            continue
        obj = json.loads(open(os.path.join(recovery_dir, fn), encoding="utf-8").read())
        ref = obj["condition_ref"]
        if ref in CORRECTED_EVIDENCE:
            isolated_results[ref] = CORRECTED_EVIDENCE[ref]
        else:
            isolated_results[ref] = _extract_quote(obj["recovered_raw_text"])

    conditions = copy.deepcopy(index["conditions"])
    changed = []
    for cond in conditions:
        ref = cond["condition_ref"]
        if ref in CORRECTED_CONDITION_TEXT:
            before = cond["condition_text"]
            after = CORRECTED_CONDITION_TEXT[ref]
            cond["condition_text"] = after
            cond["condition_text_sha256"] = hashlib.sha256(after.encode("utf-8")).hexdigest()
            changed.append((ref, before, after))

    missing = set(CORRECTED_CONDITION_TEXT) - {c[0] for c in changed}
    if missing:
        raise SystemExit(f"ABORT: expected condition_refs not found in index: {sorted(missing)}")

    record = fin.finalize(
        transcript=transcript,
        conditions=conditions,
        batch_answers=answers["answers"],
        queue=queue,
        isolated_results=isolated_results,
    )

    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/opus_phase1_route_t1_g2d_final_ar1314b.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)

    print("condition-text corrections applied:")
    for ref, before, after in changed:
        print(f"  {ref}:")
        print(f"    before: {before}")
        print(f"    after:  {after}")
    print()
    print(f"grade: {record['grade']}")
    print(f"accepted {record['accepted_count']}/{record['condition_count']}")
    print("disposition_counts:", record["disposition_counts"])
    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    for ref in sorted(outcome_by_ref):
        o = outcome_by_ref[ref]
        print(f"  {ref}: {o['disposition']} ({o['gate']}) — {o['reason'][:140]}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
