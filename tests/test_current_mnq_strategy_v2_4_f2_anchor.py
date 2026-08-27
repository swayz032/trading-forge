"""The F2 anchor must be immutable, self-verifying, and NOT the file every run rewrites.

ALGO-060 §2. The comparator the freeze decision turns on was, until this landed, either a
command-line ARGUMENT pointing at a transient scratchpad arena or a set TYPED into a module.
The file actually named "frozen" is rewritten by every canonical run and holds 1/8 at head.
"""
from __future__ import annotations

import hashlib
import json

import pytest

from research import current_mnq_strategy_v2_4_f2_anchor as A


def test_the_anchor_exists_and_hashes_to_its_pinned_sha():
    assert A.ANCHOR.exists(), A.ANCHOR
    got = hashlib.sha256(A.ANCHOR.read_bytes()).hexdigest()
    assert got == A.ANCHOR_SHA256, "the anchor has moved - the F2 comparator is not trustworthy"


def test_the_anchor_is_NOT_the_file_every_canonical_run_rewrites():
    """The whole point. A comparator that a run can overwrite is not a comparator."""
    assert A.ANCHOR != A.LIVE_SCORECARD_NOT_THE_ANCHOR
    assert A.ANCHOR.name != A.LIVE_SCORECARD_NOT_THE_ANCHOR.name


def test_NO_RUNNER_WRITES_THE_ANCHORS_PATH():
    """Derived from the runners' own source: nothing may name the anchor as an output.

    Checked structurally over every `run_*.py`, because "we would never do that" is exactly how
    the live scorecard came to be the thing it is.
    """
    import ast
    import io
    import pathlib

    offenders = []
    for path in sorted(pathlib.Path("research").glob("run_*.py")):
        tree = ast.parse(io.open(path, encoding="utf-8").read())
        for node in ast.walk(tree):
            # An assignment whose target is named OUT and whose text mentions the anchor.
            if isinstance(node, ast.Assign):
                names = {t.id for t in node.targets if isinstance(t, ast.Name)}
                if not ({"OUT", "ARM_OUT"} & names):
                    continue
                if "F2_ANCHOR" in ast.unparse(node.value):
                    offenders.append(f"{path}:{node.lineno}")
    assert not offenders, f"these runners declare the anchor as an OUTPUT: {offenders}"


def test_the_agreeing_set_is_RE_DERIVED_from_rows_not_read_from_the_headline():
    """A summary field checked against another summary field pins nothing."""
    doc = A.load()
    rows = {c["session"] for c in doc["cases"]
            if c["mismatch_class"] in A.AGREEMENT_CLASSES}
    assert A.agreeing_sessions() == rows
    # And the summary field must AGREE with the rows - if it ever does not, the anchor is lying
    # to itself and we would rather know.
    assert doc["aggregates"]["agreement_decided_cases"] == A.headline()


def test_the_anchor_really_is_the_frozen_5_of_8():
    assert A.headline() == "5/8"
    assert A.agreeing_sessions() == {
        "2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14"}


def test_a_TAMPERED_anchor_is_REFUSED_not_silently_used(tmp_path, monkeypatch):
    """RED-PROOF of the custody check, on a copy - the anchor itself is never touched."""
    doc = A.load()
    doc["cases"][0]["mismatch_class"] = "AGREE"          # a flattering edit
    bad = tmp_path / "tampered.json"
    bad.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(A, "ANCHOR", bad)
    with pytest.raises(A.AnchorCustodyError, match="CUSTODY FAILURE"):
        A.load()


def test_a_MISSING_anchor_names_the_blob_it_can_be_restored_from(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "ANCHOR", tmp_path / "absent.json")
    with pytest.raises(A.AnchorCustodyError, match=A.ANCHOR_BLOB):
        A.load()


def test_lost_against_anchor_is_MEMBERSHIP_not_count():
    """A swap - same count, different sessions - must still report a loss."""
    swapped = (A.agreeing_sessions() - {"2026-03-24"}) | {"2026-04-02"}
    assert len(swapped) == len(A.agreeing_sessions())
    assert A.lost_against_anchor(swapped) == ["2026-03-24"]
    assert A.lost_against_anchor(A.agreeing_sessions()) == []


def test_each_wired_arm_loses_EXACTLY_its_own_sessions_against_the_anchor():
    """The exam's F2 result, re-derived through the ANCHOR rather than through an argument.

    PINNED PER ARM, and it did not always need to be. Until T3'' landed (`da7f9d3d`) both arms
    lost the SAME four and this test asserted one shared list. Re-exam #3 (`99901945`)
    regenerated the arm artifacts against the landed head and the 09:30 arm CAME BACK to
    `2026-03-24` and `2026-03-30`, so it now loses two, not four.

    The stale shared pin then failed on the head - correctly. **The ANCHOR did not move**
    (`test_the_anchor_really_is_the_frozen_5_of_8` still pins the same five sessions and the
    same sha256); what moved is one ARM, in the direction F2 measures, and that is a result
    already published as re-exam #3 rather than something discovered here.

    Each arm is pinned SEPARATELY and EXACTLY so any drift in either one goes red - a single
    shared list could be satisfied by the two arms swapping which sessions they lose.
    """
    import io as _io
    import pathlib

    #: MEMBERSHIP per arm, not a shared list and never a count.
    LOST = {
        # T3'' restored 03-24 and 03-30 to this arm; it loses the other two.
        "baseline_0930": ["2026-03-31", "2026-04-06"],
        # unchanged by T3'' - nothing left this arm, and nothing returned to it.
        "taught_0800": ["2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06"],
    }
    for arm in ("baseline_0930", "taught_0800"):
        p = pathlib.Path(
            f"research/current_mnq_strategy_v2_4_exam_arm_{arm}_2026_08_23.json")
        if not p.exists():
            pytest.skip(f"{p} not present - run the dual-window exam first")
        doc = json.load(_io.open(p, encoding="utf-8"))
        agreeing = {c["session"] for c in doc["cases"]
                    if c["mismatch_class"] in A.AGREEMENT_CLASSES}
        # 04-14 - the F2 control - is the one session BOTH arms hold, so it appears in
        # NEITHER list below. It needs no separate assert: these are EXACT equalities, so a
        # lost control changes the list and this line is already red. (I wrote that separate
        # assert, measured it RED, then found the equality had fired first - it could never
        # be the failing line. A guard that cannot fire alone is decoration; deleted.)
        assert A.lost_against_anchor(agreeing) == LOST[arm], arm
