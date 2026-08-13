"""SPINE-A guards — AR-1121 §4.A: the thin compile entry point stays THIN and stays REACHABLE.

Each test here is red-proofable and was red-proofed at birth (AR-1122 §3):

  * `test_entry_point_output_equals_canonical_producer` — RED if the wrapper
    reimplements any part of the compile (a copy drifts from the canonical
    `spec_hash` immediately).
  * `test_package_json_declares_the_entry_point` — RED if the `package.json`
    declaration is deleted. It is the explicit operator command for this compile
    lane (AR-1123 §3 directs it stay). ⚠️ **It is NOT the reachability carrier, and I
    reported that it was.** While inventory rule (c) was dead, ablating it returned
    `src/engine/extraction` to `0 WIRED / 272`; after rule (c) was repaired the SAME
    ablation changes nothing (`241 WIRED / 33`, producer still reachable), because 81
    other runnable modules became visible. The flip was an instrument artifact.
    **What survives, measured by grep and not by the inventory: this module is the
    producer's ONLY non-test caller, where before there were zero.**
  * `test_wrapper_holds_no_semantic_authority` — RED if the wrapper grows a second
    authority for hashing / lowering / timeframe selection.

🛑 THE INSTRUMENT WAS BROKEN, AND IT COST A FAILED PROOF AND A WRONG CLAIM (AR-1122 §3)
----------------------------------------------------------------------------------------
**HISTORICAL — the defect described here is REPAIRED in the current tree.**
`scripts/system_inventory.py::discover_entry_points` rule (c) advertised
*"Python modules with an `if __name__ == \"__main__\"` block"* and tested
`f.refs.get("__main__")`. `refs` is built only from `ast.Name`/`ast.Attribute` nodes and
`"__main__"` is an `ast.Constant`, so the rule **then** fired 0 times repo-wide. It is
now structural (`py_has_main_guard`, AR-1123 §3) and discovers 81 modules.

I built this entry point on that rule and the reachability proof FAILED — the module was
added as 3 MORE unreachable symbols (269 -> 272) while advertising itself as an entry
point. I then declared it via rule (a) and reported a `0 -> 24 WIRED` flip.

**AR-1123 §3 authorized repairing rule (c), and the repair invalidated that report:** it
revealed **81** runnable modules and moved **~354** symbols out of BUILT-UNREACHABLE, and
re-running my own ablation against the corrected instrument changes **nothing**. The flip
was a property of the defect, not of this file.

    ★★★★★ `A DISCOVERY RULE THAT HAS NEVER DISCOVERED ANYTHING IS INDISTINGUISHABLE
       FROM ONE THAT WORKS, UNTIL YOU ASK IT TO FIND SOMETHING YOU KNOW IS THERE.`
    ★★★★★ `AND WHEN YOU REPAIR THE INSTRUMENT, RE-RUN EVERY MEASUREMENT IT PRODUCED —
       INCLUDING THE ONES THAT FLATTERED YOU.`

The `__main__` guard is still required for `python -m` to execute the module. The
package.json line stays as the explicit operator command for this lane (AR-1123 §3).
Neither is now the sole reason the producer is reachable.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from src.engine.extraction.compile_certified_record import (
    SpecIdentityError,
    compile_record_to_artifact,
    parse_spec_id,
)
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
        str(RECORD), spec_id=GOLDEN_STUB, strategy_index=0, out_dir=str(tmp_path)
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
        str(RECORD), spec_id=GOLDEN_STUB, strategy_index=0, out_dir=str(tmp_path)
    )
    stem = pathlib.Path(written_path).name[: -len(".spec.json")]
    written = json.loads(pathlib.Path(written_path).read_text(encoding="utf-8"))
    assert stem == GOLDEN_STUB
    assert stem == written["video"]


# ─── AR-1123 §2 ORDER A2 — THE IDENTITY CONTRACT, RED PROOFS 1-4 ────────────────────
#
# GPT caught this before any real sVkm compile: the parameter was `--video`, its help
# said "the source video id", and the producer copies it straight into
# `artifact["video"]` — which every committed artifact holds as the STRATEGY STUB.
# Following the old help for sVkm would have emitted `sVkmZklJDHI.spec.json` with
# `artifact.video == "sVkmZklJDHI"`, minting a second identity convention at the exact
# key the portable contract is keyed on. These use GPT's own named strings.

SVKM = "sVkmZklJDHI"


def test_red_proof_1_bare_source_video_id_is_refused():
    """AR-1123 §2 red proof 1: bare `sVkmZklJDHI` + index 0 => REFUSE."""
    with pytest.raises(SpecIdentityError) as excinfo:
        parse_spec_id(SVKM, 0)
    assert "canonical spec stub" in str(excinfo.value)


def test_red_proof_2_index_disagreement_is_refused():
    """AR-1123 §2 red proof 2: `sVkmZklJDHI__s1` + index 0 => REFUSE.

    Refusing rather than picking: a stub that disagrees with the index it is compiled
    at would publish one strategy's output under another strategy's identity.
    """
    with pytest.raises(SpecIdentityError) as excinfo:
        parse_spec_id(f"{SVKM}__s1", 0)
    assert "declares strategy index 1" in str(excinfo.value)


def test_red_proof_3_canonical_stub_is_accepted_unchanged():
    """AR-1123 §2 red proof 3 (identity half): the canonical stub passes and is
    returned UNCHANGED — not normalised, padded or rewritten."""
    assert parse_spec_id(f"{SVKM}__s0", 0) == f"{SVKM}__s0"
    assert parse_spec_id(f"{SVKM}__s2", 2) == f"{SVKM}__s2"
    # A real video id containing '-' and '_' must survive (control: the golden stub).
    assert parse_spec_id(GOLDEN_STUB, 0) == GOLDEN_STUB


def test_red_proof_3_artifact_identity_invariant(tmp_path):
    """AR-1123 §2 red proof 3 (artifact half), on a record that exists:

        filename stem == artifact["video"] == the validated canonical spec id.
    """
    written_path = compile_record_to_artifact(
        str(RECORD), spec_id=GOLDEN_STUB, strategy_index=0, out_dir=str(tmp_path)
    )
    stem = pathlib.Path(written_path).name[: -len(".spec.json")]
    written = json.loads(pathlib.Path(written_path).read_text(encoding="utf-8"))
    assert stem == GOLDEN_STUB == written["video"]


def test_identity_is_refused_before_any_artifact_is_written(tmp_path):
    """A refusal must leave NO file behind under a name we would have to retract."""
    with pytest.raises(SpecIdentityError):
        compile_record_to_artifact(
            str(RECORD), spec_id=SVKM, strategy_index=0, out_dir=str(tmp_path)
        )
    assert list(tmp_path.glob("*.spec.json")) == []


def test_cli_exposes_spec_id_and_not_video():
    """The old `--video` name is GONE, so no caller can follow the false help text."""
    source = ENTRY_MODULE.read_text(encoding="utf-8")
    assert '"--spec-id"' in source
    assert '"--video"' not in source


def test_package_json_declares_the_entry_point():
    """The explicit operator command for this compile lane (AR-1123 §3 directs it stay).

    🛑 NOT a reachability carrier. The AR-1122 claim that deleting this line reverts
    `src/engine/extraction` to BUILT-UNREACHABLE is RETRACTED (AR-1125 §4): re-run
    against the repaired inventory, the same ablation changes nothing.
    """
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    scripts = pkg.get("scripts") or {}
    assert ENTRY_SCRIPT_NAME in scripts, (
        f"package.json no longer declares `{ENTRY_SCRIPT_NAME}`. AR-1123 §3 directs that "
        "this stay as the explicit operator command for the compile lane, even now that "
        "the repaired inventory can also see the `__main__` guard."
    )
    assert f"python -m {ENTRY_MODULE_SPEC}" in scripts[ENTRY_SCRIPT_NAME]


def test_entry_module_keeps_its_main_guard():
    """`python -m` needs it to execute the module; the repaired inventory rule (c) can
    now discover it too (AR-1123 §3)."""
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
