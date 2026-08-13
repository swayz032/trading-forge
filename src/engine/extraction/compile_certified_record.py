"""SPINE-A — the thin production compile entry point. I/O ONLY, NO SEMANTICS.

Authority: AR-1121 (gpt-rulings `2f497e5f`) §4.A "Thin reachable Python compile
entry", refining AR-1119 §3.1. The authorized shape, verbatim:

    certified record -> canonical Python producer -> .spec.json

WHY THIS MODULE EXISTS — THE DEFECT IT REMOVES
----------------------------------------------
`[MEASURED at d8fa1958]` `produce_spec_artifact_from_record()` calls itself *"the
public production compile boundary"* in its own docstring, and:

  * every one of its callers lives under `src/engine/tests/` — **zero non-test callers**;
  * SYSTEM-INVENTORY reports `src/engine/extraction` as **0 WIRED / 269 BUILT-UNREACHABLE**,
    reason *"defining module is not reachable from any measured entry point"*.

So the canonical producer was a compile boundary that **nothing in production could
invoke**. AR-1118 measured the consequence: the live onboarding route is TypeScript
(`spec-onboarding-service.ts`) reading already-produced `*.spec.json` files, and it
spawns no Python at all. Adding the timeframe-role carrier to the producer without
this module would have added correct code to a path no artifact ever travels.

    ★★★★★ `A DOCSTRING CLAIMING A FUNCTION IS THE PRODUCTION BOUNDARY IS A CLAIM
       ABOUT INTENT. REACHABILITY IS A CLAIM ABOUT THE TREE, AND ONLY ONE OF THEM
       DECIDES WHETHER YOUR CODE RUNS.`

🛑 WHAT THIS MODULE MAY NOT DO — AR-1121 §4.A / AR-1119 §3.1
------------------------------------------------------------
It *"may do I/O and argument parsing"*. It may **NOT** duplicate semantic
classification, opening-range lowering, timeframe-role extraction, hashing, or source
evidence logic. Concretely, this file contains:

  * **no** `spec_hash` computation — the hash is `_spec_hash(spec_body)` inside the
    producer, and re-deriving it here would create a second authority for the
    certified identity;
  * **no** opening-range lowering or candidate fan-out — those ride on the returned
    `RecordCompileResult`, and re-deriving them is exactly the "second calculator"
    R-736 §5-1 settled against;
  * **no** timeframe inference of any kind — not `strategy.timeframe`, not
    "lowest timeframe", not a confidence-0.4 backfill (AR-1121 §4.B's forbidden list
    binds the producer side too);
  * **no** identity invention — see `--video` below.

    `THE ONLY WAY A WRAPPER STAYS A WRAPPER IS IF IT CANNOT ANSWER ANY QUESTION THE
     THING IT WRAPS IS THERE TO ANSWER.`

🛑 IDENTITY IS SUPPLIED, NEVER DERIVED
--------------------------------------
`--video` and `--strategy-index` are REQUIRED and are never parsed out of the record
filename, even though the corpus convention is `<video>__s<index>.json` and doing so
would be convenient. The producer's own docstring pins the reason (R-776 §4): *"No
stub id, no video id and no duration appears in this function's logic — it reads the
record it is handed."* A wrapper that recovers identity from a filename re-introduces
precisely the inference the producer refuses, one layer up, where nothing audits it.

    `AN IDENTITY PARSED OUT OF A FILENAME IS A GUESS WEARING A PRIMARY KEY.`

WHAT MAKES THIS AN ENTRY POINT (the mechanism, not a hope)
----------------------------------------------------------
`[MEASURED]` `scripts/system_inventory.py::discover_entry_points` rule **(c)**:
a non-test `.py` file whose refs include `__main__` is recorded as
*"has `__main__` guard (runnable module)"*. The `if __name__ == "__main__"` block at
the foot of this file is therefore the load-bearing line for the §4.A reachability
proof — **it is not boilerplate, and deleting it silently reverts the repair.**
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

# THE CANONICAL PRODUCER. This import is the whole point of the module: it is the
# edge that makes `spec_producer` reachable from a measured entry point. The §4.A
# ablation proof deletes this call and requires the golden path to fail.
from src.engine.extraction.spec_producer import produce_spec_artifact_from_record

SPEC_ARTIFACT_SUFFIX = ".spec.json"


def _load_record(path: str) -> Dict[str, Any]:
    """Read the certified record JSON. Fail closed and by name."""
    if not os.path.isfile(path):
        raise FileNotFoundError(
            f"certified record not found: {path!r}. This entry point compiles a "
            "record that already exists; it does not extract, certify or author one."
        )
    with open(path, "r", encoding="utf-8") as handle:
        record = json.load(handle)
    if not isinstance(record, dict):
        raise ValueError(
            f"{path!r}: a certified record must be a JSON object, got "
            f"{type(record).__name__}"
        )
    return record


def compile_record_to_artifact(
    record_path: str,
    *,
    video: str,
    strategy_index: int = 0,
    out_dir: str,
) -> str:
    """Read a certified record, call the canonical producer, write the `.spec.json`.

    Returns the written artifact path.

    Every semantic decision in this function belongs to
    `produce_spec_artifact_from_record`. This function chooses the filename and
    nothing else.
    """
    record = _load_record(record_path)

    # ── THE CANONICAL PRODUCER. NOT A COPY, NOT A REIMPLEMENTATION. ──────────────
    result = produce_spec_artifact_from_record(
        record,
        video=video,
        strategy_index=strategy_index,
    )

    # The PORTABLE contract is the artifact alone (R-777 §4): the opening-range
    # lowering and the execution candidates ride on the envelope as in-process
    # state and are deliberately NOT serialized into the artifact. Writing them
    # here would put a typed lowering back inside the portable JSON — the exact
    # inconsistency `RecordCompileResult.__post_init__` exists to make
    # unconstructable.
    artifact = result.artifact

    # NAMING IS THE CORPUS CONVENTION, MEASURED — NOT INVENTED HERE.
    # `[MEASURED]` in every committed artifact the filename stem EQUALS
    # `artifact["video"]`, which is itself the STUB `<video_id>__s<index>`
    # (e.g. stem `-igpOZs8LsM__s0` / `artifact.video == '-igpOZs8LsM__s0'`).
    # So the stub is the whole name: appending `__s{strategy_index}` here would
    # emit `..._s0__s0.spec.json` and silently break every loader that recovers
    # the stub by stripping `.spec.json` (e.g. run_shakedown_wave1.py:96).
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{video}{SPEC_ARTIFACT_SUFFIX}")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write("\n")

    return out_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="compile_certified_record",
        description=(
            "SPINE-A (AR-1121 §4.A): compile ONE certified record into its portable "
            ".spec.json via the canonical Python producer. I/O only — this wrapper "
            "makes no semantic decision."
        ),
    )
    parser.add_argument(
        "--record",
        required=True,
        help="Path to the certified extraction record JSON.",
    )
    parser.add_argument(
        "--video",
        required=True,
        help=(
            "The source video id. REQUIRED and never derived from the filename — "
            "see the module docstring: identity is supplied, never inferred."
        ),
    )
    parser.add_argument(
        "--strategy-index",
        type=int,
        default=0,
        help="Which strategy within the record to compile (default 0).",
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="Directory the <video>__s<index>.spec.json is written into.",
    )
    args = parser.parse_args(argv)

    try:
        out_path = compile_record_to_artifact(
            args.record,
            video=args.video,
            strategy_index=args.strategy_index,
            out_dir=args.out_dir,
        )
    except Exception as exc:  # fail closed, and say which layer refused
        sys.stderr.write(f"COMPILE REFUSED: {type(exc).__name__}: {exc}\n")
        return 1

    sys.stdout.write(f"{out_path}\n")
    return 0


# 🛑 LOAD-BEARING: `discover_entry_points` rule (c) keys on this guard. Removing it
# reverts `src/engine/extraction` to BUILT-UNREACHABLE without changing a single
# line of compiler logic.
if __name__ == "__main__":
    raise SystemExit(main())
