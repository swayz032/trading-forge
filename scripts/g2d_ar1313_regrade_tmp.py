"""AR-1313 -- rerun the exact existing finalize()/run_route() path with ONE bounded correction:
entry_sequence[1].rationale's isolated_results value is corrected from the narrowly-parsed
`quote` JSON field to the secondary literal span the SAME already-recovered agent response
explicitly named in its grounding notes (EVIDENCE_PACKAGING_TOO_NARROW, proven grounded standalone
by g2d_ar1313_attribution_tmp.py -- own=0.247, rival=0.000, no composition needed).

All 7 other rows are UNCHANGED from the Lane-1 run (no synonym/alias added, no gate touched,
no new architecture). Zero new Agent/Task/model calls.
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


CORRECTED_EVIDENCE = {
    "entry_sequence[1].rationale": (
        "That gives us an idea of the direction in which the market wants to go for the day."
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

    record = fin.finalize(
        transcript=transcript,
        conditions=index["conditions"],
        batch_answers=answers["answers"],
        queue=queue,
        isolated_results=isolated_results,
    )

    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/opus_phase1_route_t1_g2d_final_ar1313.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)

    print(f"grade: {record['grade']}")
    print(f"accepted {record['accepted_count']}/{record['condition_count']}")
    print("disposition_counts:", record["disposition_counts"])
    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    for ref in isolated_results:
        o = outcome_by_ref[ref]
        print(f"  {ref}: {o['disposition']} ({o['gate']}) — {o['reason'][:140]}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
