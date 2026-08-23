#!/usr/bin/env python3
"""ONE WRITER PER ARTIFACT. ALGO-057 §4.1. Lane law, earned the hard way.

THE INCIDENT. A long backtest was launched in the background; its wrapper shell was later
stopped and the harness reported the task as `stopped`. The PYTHON CHILD KEPT RUNNING. Twenty
minutes later a second run of the same job was launched against the same output artifact, and
for a while TWO PROCESSES WERE WRITING ONE FILE. Nothing detected it — it surfaced only because
a process listing was read for an unrelated reason, and the artifact happened to be written by
the older run at a moment the newer one had not reached. A corrupted exam record was one
verification away.

    ★ A STOPPED WRAPPER IS NOT A STOPPED CHILD. The same shape had already been ruled on this
      lane for the branch ear: killing the shell that launched a poller leaves the poller alive.
      A task-completion notification describes the LAUNCHER, not the work.

SO THE GUARD IS A PID-VERIFIED LOCK, NOT A LOCK FILE. A bare lock file gets stale the first time
a run is killed, and a stale lock that everyone learns to delete is not a lock at all. This
records the OWNING PID and checks whether that process is still alive:

    * live owner  -> REFUSE, and name the PID so it can be inspected before anything is killed
    * dead owner  -> a stale lock from a crashed run; say so, take ownership, continue
    * released    -> removed in a `finally`, so a clean exit never leaves one behind

It deliberately does NOT kill the other writer. On this lane you never kill a process you did
not arm; identity is verified by command line and birth time first, by a human decision.

Usage:

    from research.current_mnq_strategy_v2_4_single_writer import single_writer

    with single_writer(OUT):
        ...                      # everything that writes OUT
"""
from __future__ import annotations

import io
import json
import os
from contextlib import contextmanager
from pathlib import Path


def _alive(pid: int) -> bool:
    """Is this PID a live process? Conservative: UNKNOWN means TREAT AS ALIVE.

    A guard that guessed "probably dead" would hand the artifact to a second writer, which is
    the exact failure it exists to prevent.

    WINDOWS NEEDS ITS OWN ANSWER, AND THE FIRST VERSION OF THIS FUNCTION GOT IT WRONG.
    `os.kill(pid, 0)` does not raise `ProcessLookupError` for a non-existent pid on Windows; it
    raises a generic `OSError`, which the conservative branch then read as "still there". Every
    stale lock would have blocked forever, and a lock nobody can clear is a lock everyone
    learns to delete by hand - which is not a lock. Caught by the dead-pid test on this machine.
    """
    if pid <= 0:
        return False

    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        SYNCHRONIZE = 0x00100000
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        ERROR_INVALID_PARAMETER = 87        # no such process
        ERROR_ACCESS_DENIED = 5             # it exists, we just cannot look closely
        STILL_ACTIVE = 259

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = k32.OpenProcess(
            SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            err = ctypes.get_last_error()
            if err == ERROR_INVALID_PARAMETER:
                return False
            if err == ERROR_ACCESS_DENIED:
                return True
            return True                     # unknown -> the safe answer
        try:
            # A handle can outlive the process. Ask whether it is STILL RUNNING, because a
            # finished-but-not-yet-closed process would otherwise read as a live writer.
            code = wintypes.DWORD()
            if k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return code.value == STILL_ACTIVE
            return True
        finally:
            k32.CloseHandle(handle)

    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True                         # exists, owned by someone else
    except OSError:
        return True                         # unknown -> the safe answer


def lock_path(artifact) -> Path:
    return Path(str(artifact) + ".writer.lock")


class ArtifactLocked(RuntimeError):
    """Raised instead of writing. Never downgraded to a warning."""


@contextmanager
def single_writer(artifact, *, purpose: str = ""):
    """Refuse to write `artifact` while another LIVE process holds it."""
    lock = lock_path(artifact)
    if lock.exists():
        try:
            held = json.loads(lock.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            held = {}
        owner = int(held.get("pid", -1) or -1)
        if _alive(owner):
            raise ArtifactLocked(
                f"ANOTHER LIVE WRITER HOLDS {artifact}: pid={owner} "
                f"purpose={held.get('purpose') or 'unstated'} started={held.get('started')}. "
                f"Refusing to write. VERIFY THAT PROCESS BY COMMAND LINE AND BIRTH TIME before "
                f"doing anything to it - a stopped wrapper is not a stopped child, and you do "
                f"not kill a process you did not arm. If it is genuinely dead, delete {lock}.")
        print(f"[single_writer] stale lock from dead pid {owner} - taking ownership of "
              f"{artifact}")

    lock.write_text(json.dumps({
        "pid": os.getpid(),
        "purpose": purpose,
        "artifact": str(artifact),
        "started": None,      # deliberately not a wall clock: identity here is the PID
        "note": "PID-verified. A stopped wrapper is not a stopped child (ALGO-057 4.1).",
    }, indent=2) + "\n", encoding="utf-8")
    try:
        yield lock
    finally:
        # Only release OUR lock. A run that overran and lost its lock to a later owner must not
        # delete that owner's claim on its way out.
        try:
            held = json.loads(io.open(lock, encoding="utf-8").read())
            if int(held.get("pid", -1)) == os.getpid():
                lock.unlink()
        except (ValueError, OSError):
            pass


__all__ = ["ArtifactLocked", "lock_path", "single_writer"]
