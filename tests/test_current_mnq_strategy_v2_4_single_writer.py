"""One writer per artifact — and the guard must survive the way the incident actually happened.

ALGO-057 §4.1. The incident was NOT "someone ran the job twice on purpose". A background
wrapper was stopped, the harness reported the task stopped, and the PYTHON CHILD KEPT RUNNING;
a second run was then launched against the same artifact. So the cases that matter are: a LIVE
owner must be refused, a DEAD owner must not block forever, and an overrun run must not delete
a later owner's claim on its way out.
"""
from __future__ import annotations

import json
import os

import pytest

from research.current_mnq_strategy_v2_4_single_writer import (
    ArtifactLocked,
    lock_path,
    single_writer,
)


def test_a_second_writer_is_REFUSED_while_the_first_holds_it(tmp_path):
    art = tmp_path / "artifact.json"
    with single_writer(art, purpose="first"):
        with pytest.raises(ArtifactLocked, match="ANOTHER LIVE WRITER"):
            with single_writer(art, purpose="second"):
                pytest.fail("the second writer was allowed in")


def test_the_refusal_NAMES_the_owner_and_does_not_kill_it(tmp_path):
    """You never kill a process you did not arm - so the guard hands over evidence, not a kill.

    The message must carry the PID and tell the reader to verify by command line and birth
    time, because a task-completion notification describes the LAUNCHER, not the work.
    """
    art = tmp_path / "artifact.json"
    with single_writer(art, purpose="the-first-run"):
        with pytest.raises(ArtifactLocked) as exc:
            with single_writer(art):
                pass
    msg = str(exc.value)
    assert f"pid={os.getpid()}" in msg
    assert "the-first-run" in msg, "the refusal should say what the holder is doing"
    low = msg.lower()
    assert "command line and birth time" in low
    assert "stopped wrapper is not a stopped child" in low


def test_the_lock_is_released_on_a_clean_exit(tmp_path):
    art = tmp_path / "artifact.json"
    with single_writer(art):
        assert lock_path(art).exists()
    assert not lock_path(art).exists()
    with single_writer(art):          # and the next run can take it
        pass


def test_the_lock_is_released_even_when_the_writer_RAISES(tmp_path):
    art = tmp_path / "artifact.json"
    with pytest.raises(ValueError):
        with single_writer(art):
            raise ValueError("the run blew up")
    assert not lock_path(art).exists(), "a crashed run left a lock nobody can clear"


def test_a_STALE_lock_from_a_dead_pid_does_not_block_forever(tmp_path, capsys):
    """A lock that outlives its process must be taken over, and the takeover must be VISIBLE.

    A stale lock everyone learns to delete by hand is not a lock at all.
    """
    art = tmp_path / "artifact.json"
    dead = 999_999_999                      # not a live pid on this machine
    lock_path(art).write_text(json.dumps({"pid": dead, "purpose": "crashed"}) + "\n",
                              encoding="utf-8")
    with single_writer(art, purpose="new owner"):
        held = json.loads(lock_path(art).read_text(encoding="utf-8"))
        assert held["pid"] == os.getpid(), "the stale lock was not taken over"
    assert "stale lock" in capsys.readouterr().out


def test_an_UNPARSEABLE_lock_is_treated_as_stale_not_as_a_crash(tmp_path):
    art = tmp_path / "artifact.json"
    lock_path(art).write_text("{not json", encoding="utf-8")
    with single_writer(art):
        pass
    assert not lock_path(art).exists()


def test_an_overrun_writer_does_not_delete_a_LATER_owners_lock(tmp_path):
    """The subtle one. Run A overruns, run B takes the stale lock, then A exits.

    If A's `finally` deleted whatever lock it found, it would strip B's live claim and the
    next process would walk straight in - reintroducing two writers by way of the guard.
    """
    art = tmp_path / "artifact.json"
    with single_writer(art, purpose="A"):
        lock_path(art).write_text(json.dumps({"pid": 4242, "purpose": "B"}) + "\n",
                                  encoding="utf-8")
    held = json.loads(lock_path(art).read_text(encoding="utf-8"))
    assert held["pid"] == 4242, "the overrun writer deleted a later owner's lock"


def test_a_live_owner_is_detected_even_when_the_pid_is_not_ours(tmp_path):
    """`_alive` must answer for processes we do not own; unknown must mean ALIVE.

    A guard that guessed "probably dead" on a permission error would hand the artifact to a
    second writer, which is the exact failure it exists to prevent.
    """
    from research.current_mnq_strategy_v2_4_single_writer import _alive
    assert _alive(os.getpid()) is True
    assert _alive(999_999_999) is False
    assert _alive(0) is False
    assert _alive(-1) is False
