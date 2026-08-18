"""AR-1312A Lane 1 — deterministic substitution/grading over the 8 RECOVERED_SINGLE_SOURCE
answers. Zero new Agent/Task/model calls. Reuses g2d_finalizer.finalize() / opus_phase1_route.py
by import, exactly as svkm_freeze_isolated_queue.py reuses the same driver to build conditions
and batch_answers. Writes a NEW artifact; does not touch opus_phase1_route_t1.json history.
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
    """Pull the `quote` field out of the recovered agent's markdown-wrapped JSON response.
    Tries a fenced ```json block first, falls back to the first bare {...} object."""
    m = re.search(r"```json\s*(\{.*?\})\s*```", recovered_raw_text, re.DOTALL)
    blob = m.group(1) if m else None
    if blob is None:
        m2 = re.search(r"\{[^{}]*\"quote\"[^{}]*\}", recovered_raw_text, re.DOTALL)
        blob = m2.group(0) if m2 else None
    if blob is None:
        return None
    obj = json.loads(blob)
    return obj.get("quote")


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
    quote_extraction_report = []
    for fn in sorted(os.listdir(recovery_dir)):
        if not fn.endswith(".recovered.json"):
            continue
        obj = json.loads(open(os.path.join(recovery_dir, fn), encoding="utf-8").read())
        ref = obj["condition_ref"]
        quote = _extract_quote(obj["recovered_raw_text"])
        isolated_results[ref] = quote
        quote_extraction_report.append({
            "condition_ref": ref,
            "agent_id": obj["agent_id"],
            "extracted_quote": quote,
        })

    print("[lane1] quote extraction from recovered artifacts:")
    for r in quote_extraction_report:
        print(f"  {r['condition_ref']:34s} agent={r['agent_id']}  quote={r['extracted_quote']!r}")

    record = fin.finalize(
        transcript=transcript,
        conditions=index["conditions"],
        batch_answers=answers["answers"],
        queue=queue,
        isolated_results=isolated_results,
    )

    out_path = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/opus_phase1_route_t1_g2d_final.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)

    print(f"\n[lane1] grade: {record['grade']}")
    print(f"[lane1] accepted {record['accepted_count']}/{record['condition_count']}")
    print(f"[lane1] provenance_counts: {record['provenance_counts']}")
    print("[lane1] disposition_counts:", record["disposition_counts"])
    print(f"[lane1] wrote {out_path}")

    print("\n[lane1] the 8 rows, old disposition -> final disposition:")
    old_by_ref = {e["condition_ref"]: e for e in queue["queue"]}
    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    for ref in isolated_results:
        old = old_by_ref[ref]
        new = outcome_by_ref[ref]
        print(f"  {ref}")
        print(f"    old: {old['disposition']} ({old['gate']})")
        print(f"    new: {new['disposition']} ({new['gate']}) reason={new['reason'][:160]!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
