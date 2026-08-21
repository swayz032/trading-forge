"""Replay AR-1387A's three executable counterexamples and report COMPILED / REFUSED for each.

AR-1398 red-proof. This ONE file is designed to run UNMODIFIED in two trees:

    the pre-repair head `860525ce`  -> the attacks must COMPILE   (the defect reproduces)
    the AR-1398 delivery head       -> the attacks must be REFUSED (the repair bites)

That symmetry is the point. A repair proven only on the tree that contains it is a claim about one
measurement; running the identical instrument on both heads is a claim about the DIFFERENCE, and
the difference is what was actually fixed.

`build_certified_record` gained a required `authority` parameter in AR-1398, so this probe INSPECTS
the signature rather than assuming either shape. Hard-coding one calling convention would make the
probe fail on the other tree for a reason that has nothing to do with the attack -- an error that
reads exactly like a refusal and would manufacture a false GREEN on the old head.

Usage:  python scripts/ar1398_attack_replay.py
Prints one `ATTACK <n> <name> : COMPILED|REFUSED[: reason]` line per attack, then a SUMMARY line.
"""
from __future__ import annotations

import inspect
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.getcwd())

os.environ.setdefault("TF_MOCK_VBT", "1")

FIXTURE_PATH = Path(
    "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
    "e8-calibration/external_dependency_calibration_fixture.json"
)


def _compile(record, authority_factory):
    """Call the compile entry point with whatever signature this tree's version declares."""
    from src.engine.extraction.svkm_v2_1_compile import build_certified_record

    params = inspect.signature(build_certified_record).parameters
    if len(params) == 1:
        return build_certified_record(record)  # pre-AR-1398 shape
    return build_certified_record(record, authority_factory())


def _outcome(fn) -> str:
    try:
        result = fn()
    except Exception as exc:  # noqa: BLE001 - the refusal type differs between the two heads
        return f"REFUSED: {type(exc).__name__}: {str(exc)[:150]}"
    n = len(result["strategies"]) if isinstance(result, dict) and "strategies" in result else "?"
    return f"COMPILED {n} strategy"


def main() -> int:
    from src.engine.extraction.source_graph_projection import ExternalDependencySpec
    from src.engine.extraction.svkm_v2_1_compile import (
        run_certified_projection,
        stamp_receipt,
    )

    fx = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    dep_spec = ExternalDependencySpec(**fx["external_dependency"])

    def _fresh_receipt():
        record, _ = run_certified_projection()
        return record

    def _e8_records():
        """Build the emitted dependency record via the projection, exactly as production does."""
        import importlib

        t = importlib.import_module("src.engine.tests.test_external_dependency_projection")
        return t._run(external_dependencies=(dep_spec,))["external_dependencies"]

    def _e8_authority():
        from src.engine.extraction.compile_authority import (
            COMPILE_AUTHORITY_VERSION,
            CompileAuthority,
            RequiredDependency,
        )
        from src.engine.extraction.source_graph_projection import (
            external_dependency_contract_hash,
        )

        return CompileAuthority(
            version=COMPILE_AUTHORITY_VERSION,
            entries=(
                RequiredDependency(
                    dependency_id=dep_spec.dependency_id,
                    contract_sha256=external_dependency_contract_hash(dep_spec),
                ),
            ),
        )

    def _empty_authority():
        from src.engine.extraction.compile_authority import EMPTY_COMPILE_AUTHORITY

        return EMPTY_COMPILE_AUTHORITY

    outcomes: dict[str, str] = {}

    # ------------------------------------------------------------------ #
    # ATTACK 1 (AR-1387A section 2, CRITICAL)
    # Delete the required dependency + readiness + blocker, then RE-STAMP so the
    # digest is genuinely valid again. The result is indistinguishable from a
    # legitimate legacy receipt -- which is exactly why no field-level rule sees it.
    # ------------------------------------------------------------------ #
    a1 = _fresh_receipt()
    a1["external_dependencies"] = _e8_records()
    a1["grade"] = "RED"
    a1["compile_readiness"] = "BLOCKED_EXTERNAL_DEPENDENCY"
    stamp_receipt(a1)
    a1.pop("external_dependencies", None)
    a1.pop("compile_readiness", None)
    a1.pop("structured_blocker", None)
    stamp_receipt(a1)
    assert "external_dependencies" not in a1 and "compile_readiness" not in a1
    outcomes["1_delete_required_dependency_and_restamp"] = _outcome(
        lambda: _compile(a1, _e8_authority)
    )

    # ------------------------------------------------------------------ #
    # ATTACK 2 (AR-1387A section 3, HIGH)
    # A "dependency record" consisting of an id plus the six words that satisfy
    # every readiness axis, and nothing else.
    # ------------------------------------------------------------------ #
    a2 = _fresh_receipt()
    a2["external_dependencies"] = [{
        "dependency_id": "forged.minimum-record",
        "access_status": "VERIFIED",
        "live_delivery": "VERIFIED",
        "historical_replay": "VERIFIED",
        "update_policy": "VERIFIED",
        "implementation_status": "VALIDATED",
        "semantic_status": "MULTIMODAL_RESOLVED",
    }]
    a2["compile_readiness"] = "READY_PENDING_CERTIFICATION"
    stamp_receipt(a2)
    outcomes["2_six_ready_words_as_a_record"] = _outcome(lambda: _compile(a2, _empty_authority))

    # ------------------------------------------------------------------ #
    # ATTACK 3 (AR-1387A section 5, MEDIUM)
    # Empty the shared gate map at runtime, then ask the projection whether the
    # blocked E8 dependency is ready.
    # ------------------------------------------------------------------ #
    import importlib

    from src.engine.extraction.source_graph_projection import GATING_AXES

    tests = importlib.import_module("src.engine.tests.test_external_dependency_projection")
    try:
        GATING_AXES.clear()
        cleared = f"CLEARED (len now {len(GATING_AXES)})"
    except Exception as exc:  # noqa: BLE001
        cleared = f"REFUSED: {type(exc).__name__}"
    if cleared.startswith("CLEARED"):
        run = tests._run(external_dependencies=(dep_spec,))
        outcomes["3_gating_axes_clear"] = (
            f"{cleared} -- grade={run['grade']} "
            f"compile_readiness={run.get('compile_readiness')}"
        )
    else:
        outcomes["3_gating_axes_clear"] = cleared

    for name, outcome in outcomes.items():
        print(f"ATTACK {name} : {outcome}")

    compiled = [k for k, v in outcomes.items() if v.startswith("COMPILED") or "GREEN" in v]
    print(f"SUMMARY compiled_or_green={len(compiled)} of {len(outcomes)} :: {sorted(compiled)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
