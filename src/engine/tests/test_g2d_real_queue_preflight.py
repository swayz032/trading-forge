"""AR-1260 §D — the read-only preflight, and proof that it can go RED.

★ A DETECTOR THAT HAS ONLY EVER REPORTED GREEN IS NOT YET AN INSTRUMENT.

The real run of this preflight reports all eight attempts unspent, which is the answer we want
and therefore the answer we must be most suspicious of: a script that returns "nothing is spent"
unconditionally would produce exactly that output. So every STOP path is fired here against a
THROWAWAY COPY of the real artifacts.

🛑 Nothing in this file touches the real receipt directory. The copy is made into pytest's
`tmp_path`; the frozen queue is read, never written.
"""
from __future__ import annotations

import json
import os
import shutil

import pytest

from scripts.g2d_real_queue_preflight import (
    DEFAULT_QUEUE,
    DEFAULT_RECEIPTS,
    main,
    preflight,
)

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
REAL_QUEUE = os.path.join(REPO, DEFAULT_QUEUE)
REAL_RECEIPTS = os.path.join(REPO, DEFAULT_RECEIPTS)

pytestmark = pytest.mark.skipif(
    not os.path.exists(REAL_QUEUE),
    reason="the frozen real G2-D queue artifact is not present at this pin",
)


@pytest.fixture
def sandbox(tmp_path):
    """A byte-copy of the real artifacts. The point of copying rather than synthesising is that
    the preflight is then exercised against the SAME queue it will meet in production — a
    hand-built fixture would test a queue that never existed (`worker-execution` §2a)."""
    q = tmp_path / "queue.json"
    shutil.copyfile(REAL_QUEUE, q)
    rd = tmp_path / "receipts"
    shutil.copytree(REAL_RECEIPTS, rd)
    return str(q), str(rd)


def _plant(rd, name, payload):
    p = os.path.join(rd, name)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return p


def test_POSITIVE_CONTROL_the_copied_artifacts_report_all_eight_unspent(sandbox):
    """The control. Without it, every STOP below proves only that the script can fail."""
    rep = preflight(*sandbox)
    assert rep["queue_count"] == 8
    assert rep["ready"] == 8
    assert rep["claimed"] == []
    assert rep["dispatched"] == []
    assert rep["completed"] == []
    assert rep["crash_shaped"] == []
    assert rep["stranded_incomplete"] == []
    assert rep["receipt_dir_non_readme"] == []
    assert main(["--queue", sandbox[0], "--receipts", sandbox[1]]) == 0


def test_a_planted_attempt_receipt_is_a_STOP_and_moves_the_ready_count(sandbox):
    """🛑 The RED path. An attempt receipt appearing in that directory means one of the eight
    one-shot Opus calls has been spent."""
    _q, rd = sandbox
    from src.engine.extraction.isolated_attempt_receipt import _safe_name

    ref = json.load(open(REAL_QUEUE, encoding="utf-8"))["queue"][0]["condition_ref"]
    _plant(rd, f"{_safe_name(ref)}.attempt.json", {"status": "ATTEMPT_CLAIMED_BEFORE_INVOCATION"})

    rep = preflight(*sandbox)
    assert rep["claimed"] == [ref]
    assert rep["ready"] == 7
    assert rep["receipt_dir_non_readme"] != []
    assert main(["--queue", sandbox[0], "--receipts", sandbox[1]]) == 2


def test_an_unrecognised_file_in_the_receipt_directory_is_a_STOP(sandbox):
    """The membership rule is 'README.md and nothing else'. Reading a blank as success requires
    knowing what the list admits (`absence from a list is not a pass`)."""
    _q, rd = sandbox
    _plant(rd, "something_someone_left_here.json", {"note": "?"})

    rep = preflight(*sandbox)
    assert rep["receipt_dir_non_readme"] == ["something_someone_left_here.json"]
    assert rep["ready"] == 8, "a stray file must not silently change the budget count"
    assert main(["--queue", sandbox[0], "--receipts", sandbox[1]]) == 2


def test_a_missing_receipt_directory_is_refused_not_created(sandbox):
    """The read-only property, proven by consequence rather than asserted in a docstring:
    `DurableAttemptLedger.load` would have created this directory."""
    q, rd = sandbox
    shutil.rmtree(rd)

    with pytest.raises(SystemExit, match="read-only"):
        preflight(q, rd)
    assert not os.path.exists(rd), "the preflight created the directory it was asked to read"


def test_the_preflight_creates_nothing_on_a_clean_run(sandbox):
    """Positive witness that the read path RAN, then the absence claim."""
    q, rd = sandbox
    before = sorted(os.listdir(rd))
    rep = preflight(q, rd)
    assert rep["queue_count"] == 8, "positive witness: the queue really was read"
    assert sorted(os.listdir(rd)) == before


def test_the_script_exposes_no_way_to_delete_a_receipt():
    """AR-1259 §8 D: 'do not delete it to regain green'. The tool that reports the budget must not
    also be the tool that can restore it."""
    import inspect

    import scripts.g2d_real_queue_preflight as m

    src = inspect.getsource(m)
    for banned in ("os.remove", "os.unlink", "shutil.rmtree", ".unlink("):
        assert banned not in src, f"the preflight can delete receipts: {banned}"
