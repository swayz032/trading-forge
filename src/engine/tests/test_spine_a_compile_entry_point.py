"""SPINE-A guards — AR-1121 §4.A: the thin compile entry point stays THIN and stays REACHABLE.

Each test here is red-proofable and was red-proofed at birth (AR-1122 §3):

  * `test_entry_point_output_equals_canonical_producer` — RED if the wrapper
    reimplements any part of the compile (a copy drifts from the canonical
    `spec_hash` immediately).
  * `test_package_json_declares_the_entry_point` — RED if the `package.json`
    declaration is deleted. **This is the load-bearing reachability carrier**, and
    an ablation MEASURED it: removing that one line returns
    `src/engine/extraction` to `0 WIRED / 272 BUILT-UNREACHABLE` and puts
    `produce_spec_artifact_from_record` back in the "defining module is not
    reachable from any measured entry point" table.
  * `test_wrapper_holds_no_semantic_authority` — RED if the wrapper grows a second
    authority for hashing / lowering / timeframe selection.

🛑 WHY THE `__main__` GUARD IS **NOT** WHAT MAKES THIS REACHABLE — MEASURED, AND IT
COST A FAILED PROOF FIRST (AR-1122 §2)
--------------------------------------------------------------------------------
`scripts/system_inventory.py::discover_entry_points` rule (c) advertises
*"Python modules with an `if __name__ == \"__main__\"` block"*. **That rule is DEAD.**
`refs` is built only from `ast.Name` and `ast.Attribute` nodes (system_inventory.py:441-444),
and `"__main__"` is a string CONSTANT — so `f.refs.get("__main__")` is never truthy and
the reason string *"has `__main__` guard (runnable module)"* appears **0 times** across
the whole generated inventory.

I built the entry point on that rule first and the reachability proof FAILED: the
module was added as 3 MORE unreachable symbols (269 -> 272) while advertising itself
as an entry point. The live routes are rule (a) `package.json` script and rule (b) a
TS subprocess literal; rule (b) is forbidden for this unit (AR-1119 §3.1: no TS
spawning Python during onboarding), which leaves (a).

    ★★★★★ `A DISCOVERY RULE THAT HAS NEVER DISCOVERED ANYTHING IS INDISTINGUISHABLE
       FROM ONE THAT WORKS, UNTIL YOU ASK IT TO FIND SOMETHING YOU KNOW IS THERE.`

The `__main__` guard in the module is still required — it is what makes `python -m`
execute — but it proves nothing to the inventory. Do not delete the package.json line
believing the guard covers it.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from src.engine.extraction.compile_certified_record import compile_record_to_artifact
from src.engine.extraction.spec_producer import produce_spec_artifact_from_record

REPO = pathlib.Path(__file__).resolve().parents[3]
GOLDEN_STUB = "st5e-YJRfKc__s0"
RECORD = REPO / "docs/replay-results/h1-battery/tier-a-extraction-provenance" / f"{GOLDEN_STUB}.json"
ENTRY_MODULE = REPO / "src/engine/extraction/compile_certified_record.py"
PACKAGE_JSON = REPO / "package.json"

#: The exact declaration `discover_entry_points` rule (a) keys on. Rule (a) matches
#: `python\s+-m\s+([A-Za-z0-9_.]+)` and resolves the dotted spec to a repo path.
ENTRY_SCRIPT_NAME = "compile:certified-record"
ENTRY_MODULE_SPEC = "src.engine.extraction.compile_certified_record"


def test_entry_point_output_equals_canonical_producer(tmp_path):
    """POSITIVE CONTROL: the wrapper calls the canonical producer, not a copy.

    A reimplementation would have to reproduce `_spec_hash(spec_body)` over a
    byte-identical canonical body to pass this — which is the same thing as not
    being a reimplementation.
    """
    assert RECORD.is_file(), f"fixture record missing: {RECORD}"
    record = json.loads(RECORD.read_text(encoding="utf-8"))

    canonical = produce_spec_artifact_from_record(record, video=GOLDEN_STUB, strategy_index=0).artifact

    written_path = compile_record_to_artifact(
        str(RECORD), video=GOLDEN_STUB, strategy_index=0, out_dir=str(tmp_path)
    )
    written = json.loads(pathlib.Path(written_path).read_text(encoding="utf-8"))

    # POSITIVE WITNESS that the comparison is looking at real content, so that
    # `==` passing cannot be an artefact of two empty objects.
    assert canonical.get("spec_hash"), "canonical artifact carries no spec_hash"
    assert canonical["spec"]["entry_conditions"], "canonical artifact has no entry conditions"

    assert written["spec_hash"] == canonical["spec_hash"]
    assert written == canonical


def test_entry_point_filename_is_the_stub(tmp_path):
    """The stem MUST equal `artifact["video"]` — every loader recovers the stub by
    stripping `.spec.json` (e.g. run_shakedown_wave1.py:96). An extra `__s{index}`
    here silently breaks them."""
    written_path = compile_record_to_artifact(
        str(RECORD), video=GOLDEN_STUB, strategy_index=0, out_dir=str(tmp_path)
    )
    stem = pathlib.Path(written_path).name[: -len(".spec.json")]
    written = json.loads(pathlib.Path(written_path).read_text(encoding="utf-8"))
    assert stem == GOLDEN_STUB
    assert stem == written["video"]


def test_package_json_declares_the_entry_point():
    """THE REACHABILITY CARRIER. Deleting this declaration is what actually reverts
    `src/engine/extraction` to BUILT-UNREACHABLE — proven by ablation, not assumed."""
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    scripts = pkg.get("scripts") or {}
    assert ENTRY_SCRIPT_NAME in scripts, (
        f"package.json no longer declares `{ENTRY_SCRIPT_NAME}`. This is the ONLY live "
        "entry-point route for this module: inventory rule (c) (`__main__` guard) is "
        "dead code and rule (b) (TS subprocess) is forbidden for this unit."
    )
    assert f"python -m {ENTRY_MODULE_SPEC}" in scripts[ENTRY_SCRIPT_NAME]


def test_entry_module_keeps_its_main_guard():
    """`python -m` needs it even though the inventory cannot see it."""
    assert '__name__ == "__main__"' in ENTRY_MODULE.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "forbidden",
    [
        "_spec_hash",              # hashing authority belongs to the producer
        "lower_opening_range",     # lowering authority belongs to the producer
        "expand_execution_candidates",
        "recoverSpecTimeframe",
        "trigger_tf",
        "lowest",                  # "lowest timeframe" backfill heuristics
    ],
)
def test_wrapper_holds_no_semantic_authority(forbidden):
    """The wrapper may do I/O and argument parsing and NOTHING ELSE (AR-1121 §4.A).

    Read as executable text, not as a promise: this reads the module SOURCE, so a
    semantic call added later fails here even if it is never exercised by a test.
    """
    source = ENTRY_MODULE.read_text(encoding="utf-8")
    # Strip the docstring/comment prose, which legitimately DISCUSSES these names.
    code = "\n".join(
        line for line in source.splitlines()
        if not line.lstrip().startswith("#")
    )
    code = code.split('"""')
    # keep only the non-docstring segments (even indices are outside triple quotes)
    executable = "".join(seg for i, seg in enumerate(code) if i % 2 == 0)
    assert forbidden not in executable, (
        f"the thin entry point gained semantic authority: {forbidden!r} appears in "
        "executable code. AR-1121 §4.A forbids duplicating classification, lowering, "
        "timeframe extraction or hashing here."
    )
