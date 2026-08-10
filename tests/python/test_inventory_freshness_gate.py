"""RED-PROOF for the pre-push SYSTEM-INVENTORY freshness gate (R-780 STEP 0).

WHAT THIS PROVES, AND WHY IT IS BUILT THIS WAY
----------------------------------------------
The gate used to regenerate the map and compare RAW BYTES.  Because the map
carries a provenance line derived from `git rev-parse HEAD`, every remedy commit
advanced HEAD, changed the stamp, and made the next comparison differ again --
a NON-TERMINATING DEADLOCK that blocked every push carrying a src/ change
(measured over two full cycles, AR-909).

Four arms, ordered by R-780 §6 STEP 0:

  A  provenance-only difference          -> PRE-REPAIR gate BLOCKS, repaired ALLOWS
  B  real semantic content drift         -> repaired gate STILL BLOCKS  (not blind)
  C  refreshed map + HEAD advanced again -> repaired ALLOWS, PRE-REPAIR still BLOCKS
                                            (TERMINATION: the property the old gate lacked)
  D  checker fails for a non-staleness   -> BLOCKS, and does NOT rewrite the map
     reason

Arms A and C run the ACTUAL PRE-REPAIR FILE, fetched from git by its pinned BLOB
hash, not a paraphrase of it.  `A FIX IS PROVEN BY THE UNCHANGED INSTRUMENT THAT
CONVICTED IT` -- a red-proof that re-implements the old behaviour proves only
that the author remembered it.

The generator is STUBBED so the arms are hermetic and fast (the real one takes
~13s and writes a repo-tracked file).  The stub models the two properties the
gate actually depends on: a provenance stamp that follows HEAD, and a `--check`
that compares content with that stamp ignored.  The real-world witness that the
stub is faithful is the push itself succeeding, recorded in the AR -- this file
proves the DECISION LOGIC, not the generator.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REAL_REPO = Path(__file__).resolve().parents[2]

# The pre-repair gate, pinned by content.  This blob IS the deadlocking version:
# it contains `if after == before:` over raw bytes.
PRE_REPAIR_BLOB = "43db7eabcc0df292fb5ef7c9e9ab6592e340b1bf"

STUB_GENERATOR = '''\
import os, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAP = ROOT / "docs" / "designs" / "SYSTEM-INVENTORY.md"
PROV_PREFIX = "> Generated at commit "


def _fresh_text():
    head = (ROOT / "head.txt").read_text().strip()
    body = (ROOT / "body.txt").read_text()
    return PROV_PREFIX + "`" + head + "`\\n" + body


def _content_only(text):
    return "".join(
        line for line in text.splitlines(keepends=True)
        if not line.startswith(PROV_PREFIX)
    )


if "--check" in sys.argv:
    forced = os.environ.get("STUB_CHECK_EXIT")
    if forced:
        print("stub checker exploded on purpose", file=sys.stderr)
        sys.exit(int(forced))
    on_disk = MAP.read_text() if MAP.exists() else ""
    sys.exit(0 if _content_only(on_disk) == _content_only(_fresh_text()) else 1)

MAP.parent.mkdir(parents=True, exist_ok=True)
MAP.write_text(_fresh_text())
'''

FRESH_BODY = "line one\nline two\nline three\n"


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader, f"could not load {path}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def fake_repo(tmp_path: Path) -> Path:
    (tmp_path / "scripts").mkdir()
    (tmp_path / "docs" / "designs").mkdir(parents=True)
    (tmp_path / "scripts" / "system_inventory.py").write_text(STUB_GENERATOR)
    (tmp_path / "body.txt").write_text(FRESH_BODY)
    (tmp_path / "head.txt").write_text("head-000")
    return tmp_path


def _map(repo: Path) -> Path:
    return repo / "docs" / "designs" / "SYSTEM-INVENTORY.md"


def _write_map(repo: Path, *, head: str, body: str) -> None:
    _map(repo).write_text("> Generated at commit `" + head + "`\n" + body)


def _gate(repo: Path, monkeypatch, *, source: str) -> object:
    """Load a gate implementation and point it at the fake repo.

    source: "repaired" (working tree) or "pre-repair" (the pinned blob).
    """
    if source == "repaired":
        path = REAL_REPO / "scripts" / "inventory_freshness_gate.py"
    else:
        blob = subprocess.run(
            ["git", "cat-file", "blob", PRE_REPAIR_BLOB],
            cwd=REAL_REPO, capture_output=True, text=True,
        )
        assert blob.returncode == 0, (
            f"pre-repair blob {PRE_REPAIR_BLOB} unreachable -- the convicting "
            f"instrument is missing, so arms A and C cannot discriminate: {blob.stderr}"
        )
        path = repo / "pre_repair_gate.py"
        path.write_text(blob.stdout)

    mod = _load_module(path, f"gate_{source.replace('-', '_')}_{repo.name}")
    monkeypatch.setattr(mod, "REPO", repo)
    monkeypatch.setattr(mod, "MAP", _map(repo))
    monkeypatch.setattr(mod, "GEN", repo / "scripts" / "system_inventory.py")
    monkeypatch.setattr(mod, "_code_changed_vs_upstream", lambda: True)
    return mod


# ---------------------------------------------------------------- control


def test_control_the_gate_skips_a_push_carrying_no_code_change(fake_repo, monkeypatch):
    """The one documented escape still works -- otherwise every arm below is
    measuring a gate that never runs, and 'allowed' would mean nothing."""
    gate = _gate(fake_repo, monkeypatch, source="repaired")
    monkeypatch.setattr(gate, "_code_changed_vs_upstream", lambda: False)
    _write_map(fake_repo, head="anything", body="totally wrong content\n")

    assert gate.main() == 0


# ---------------------------------------------------------------- arm A


def test_arm_a_provenance_only_difference_blocks_before_and_allows_after(
    fake_repo, monkeypatch
):
    """THE BUG. Content identical, stamp stale -> the old gate blocks forever."""
    _write_map(fake_repo, head="head-OLD", body=FRESH_BODY)
    (fake_repo / "head.txt").write_text("head-NEW")

    old = _gate(fake_repo, monkeypatch, source="pre-repair")
    assert old.main() == 1, "pre-repair gate must BLOCK on a provenance-only diff"

    # Restore the exact pre-arm state: the old gate rewrote the map as a side
    # effect, which is itself the defect arm D pins.
    _write_map(fake_repo, head="head-OLD", body=FRESH_BODY)

    new = _gate(fake_repo, monkeypatch, source="repaired")
    assert new.main() == 0, "repaired gate must ALLOW a provenance-only diff"


# ---------------------------------------------------------------- arm B


def test_arm_b_real_content_drift_still_blocks(fake_repo, monkeypatch):
    """NOT BLIND. The guard's whole purpose must survive the repair."""
    _write_map(fake_repo, head="head-000", body="stale body that no longer matches\n")

    gate = _gate(fake_repo, monkeypatch, source="repaired")
    assert gate.main() == 1, "repaired gate must BLOCK on genuine content drift"

    # And on the stale branch it DOES regenerate, which is what makes the
    # printed remedy actionable.
    assert FRESH_BODY in _map(fake_repo).read_text()


# ---------------------------------------------------------------- arm C


def test_arm_c_terminates_after_the_remedy_where_the_old_gate_never_did(
    fake_repo, monkeypatch
):
    """TERMINATION -- the property the old gate lacked and nobody named.

    Simulates the remedy: the refreshed map is committed, which advances HEAD,
    so the stamp on disk now lags again. That is exactly the state the old gate
    re-blocked on, cycle after cycle.
    """
    _write_map(fake_repo, head="head-000", body=FRESH_BODY)
    (fake_repo / "head.txt").write_text("head-001-after-the-remedy-commit")

    new = _gate(fake_repo, monkeypatch, source="repaired")
    assert new.main() == 0, "repaired gate must TERMINATE: the remedy is accepted"

    _write_map(fake_repo, head="head-000", body=FRESH_BODY)
    old = _gate(fake_repo, monkeypatch, source="pre-repair")
    assert old.main() == 1, (
        "pre-repair gate must still BLOCK here -- this is the non-termination, "
        "and without this assertion arm C cannot tell a fix from a coincidence"
    )


# ---------------------------------------------------------------- arm D


def test_arm_d_a_broken_checker_blocks_and_does_not_rewrite_the_map(
    fake_repo, monkeypatch
):
    """A gate that cannot answer must not guess -- and must not write."""
    _write_map(fake_repo, head="head-000", body=FRESH_BODY)
    before = _map(fake_repo).read_bytes()
    monkeypatch.setenv("STUB_CHECK_EXIT", "3")

    gate = _gate(fake_repo, monkeypatch, source="repaired")
    assert gate.main() == 1, "an unknown checker exit must never read as fresh"
    assert _map(fake_repo).read_bytes() == before, (
        "the gate regenerated over a checker reporting its own defect"
    )


def test_arm_d_positive_witness_the_same_state_allows_when_the_checker_works(
    fake_repo, monkeypatch
):
    """Positive control for arm D: without the forced failure, this very state
    is ALLOWED. Otherwise arm D's block proves nothing -- a gate that always
    blocks would pass it."""
    _write_map(fake_repo, head="head-000", body=FRESH_BODY)

    gate = _gate(fake_repo, monkeypatch, source="repaired")
    assert gate.main() == 0
