"""G2-D0 on real pinned data — freeze the isolated-fallback queue BEFORE any Opus call.

AR-1247 §9. Derives the queue from the route's own dispositions and writes ONE new artifact.

🛑 IT DOES NOT RE-EMIT THE ROUTE ARTIFACT. The route record is rebuilt IN MEMORY only, so the
existing `grade/opus-v2/opus_phase1_route_t*.json` history is not rewritten (AR-1243 §13 /
AR-1247 §8: preserve the opus-v2 history rather than rewriting it into green). The only file
this script creates is the frozen queue itself.

usage: python scripts/svkm_freeze_isolated_queue.py [--trial N]
"""
from __future__ import annotations

import argparse
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--trial", type=int, default=1)
    args = ap.parse_args()

    from src.engine.extraction import isolated_fallback_law as law
    from src.engine.extraction import opus_phase1_route as rt

    drv = _driver()
    transcript, _ = drv.bench._load_pinned()
    index = json.loads(open(drv.TASK_INDEX_PATH, encoding="utf-8").read())
    answers = json.loads(open(drv._answers_path(args.trial), encoding="utf-8").read())
    if answers["task_sha256"] != index["task_sha256"]:
        raise SystemExit(f"ABORT: trial {args.trial} is bound to a different task.")

    # IN MEMORY ONLY — no route artifact is written.
    record = rt.run_route(transcript, index["conditions"], answers["answers"])

    texts = {c["condition_ref"]: c["condition_text"] for c in index["conditions"]}
    pinned = {k: str(v) for k, v in sorted(index["input"].items())}
    pinned["task_sha256"] = index["task_sha256"]
    pinned["source_trial"] = str(args.trial)
    pinned["raw_return_sha256"] = str(answers.get("raw_return_sha256", ""))

    frozen = law.freeze_isolated_queue(record, pinned, texts)

    out = os.path.join(drv.ROUTE_DIR, f"isolated_fallback_queue_t{args.trial}.json")
    drv.bench._assert_not_frozen(out)
    payload = frozen.as_dict()
    payload["derived_from"] = {
        "route_grade": record["grade"],
        "accepted_count": record["accepted_count"],
        "condition_count": record["condition_count"],
        "disposition_counts": record["disposition_counts"],
        "route_artifact_rewritten": False,
    }
    drv.bench._write_json(out, payload)

    print(f"[freeze] route grade {record['grade']}  accepted "
          f"{record['accepted_count']}/{record['condition_count']}")
    print(f"[freeze] queued for isolated fallback: {len(frozen.queue)}")
    for e in frozen.queue:
        print(f"[freeze]   {e['condition_ref']:34s} {e['disposition']:32s} "
              f"{e['task_input_sha256'][:12]}")
    print(f"[freeze] excluded (ACCEPTED, never escalate): {len(frozen.excluded)}")
    print(f"[freeze] wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
