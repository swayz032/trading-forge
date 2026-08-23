"""The custody check must discriminate OK / CHANGED / MISSING, and must not be self-certifying.

The failure this guards against is subtle: a check that hashes a file and compares it to that
same file's hash passes by construction and prints a reassurance anyway. The expectation has to
come from the committed artifact, and a test has to prove it does.
"""
from __future__ import annotations

import hashlib
import io
import json

import pytest

from research import current_mnq_strategy_v2_4_external_evidence_custody as C


def _pair(tmp_path, content=b"the trader labels", key="trader_labels_file_sha256"):
    live = tmp_path / "evidence.json"
    live.write_bytes(content)
    art = tmp_path / "artifact.json"
    art.write_text(json.dumps({key: hashlib.sha256(content).hexdigest()}), encoding="utf-8")
    return live, art


def _one(tmp_path, monkeypatch, live, art, key=("trader_labels_file_sha256",)):
    monkeypatch.setattr(C, "EXTERNAL_EVIDENCE",
                        (("probe", live, art, key, "a test fixture"),))
    return C.verify()[0]


def test_the_real_evidence_is_currently_intact():
    """The live measurement. Skips rather than lies when the files are on another machine."""
    rows = C.verify()
    present = [r for r in rows if r["status"] != C.MISSING]
    if not present:
        pytest.skip("neither external evidence file is on this machine")
    for r in present:
        assert r["status"] == C.OK, (
            f'{r["label"]} is {r["status"]}: expected {r["expected_sha256"]} '
            f'measured {r["measured_sha256"]}')


def test_an_edited_file_is_CHANGED_not_OK(tmp_path, monkeypatch):
    live, art = _pair(tmp_path)
    assert _one(tmp_path, monkeypatch, live, art)["status"] == C.OK  # positive witness first
    live.write_bytes(b"the trader labels, quietly edited")
    r = _one(tmp_path, monkeypatch, live, art)
    assert r["status"] == C.CHANGED
    assert r["measured_sha256"] != r["expected_sha256"]
    with pytest.raises(RuntimeError, match="EXTERNAL_EVIDENCE_NOT_INTACT"):
        C.assert_intact([r])


def test_a_deleted_file_is_MISSING_not_CHANGED(tmp_path, monkeypatch):
    live, art = _pair(tmp_path)
    live.unlink()
    r = _one(tmp_path, monkeypatch, live, art)
    assert r["status"] == C.MISSING and r["measured_sha256"] is None
    with pytest.raises(RuntimeError, match="EXTERNAL_EVIDENCE_NOT_INTACT"):
        C.assert_intact([r])


def test_a_missing_expectation_is_its_own_status(tmp_path, monkeypatch):
    """No recorded hash is not the same as a matching one, and must never read as OK."""
    live, art = _pair(tmp_path)
    art.write_text(json.dumps({"something_else": "x"}), encoding="utf-8")
    r = _one(tmp_path, monkeypatch, live, art)
    assert r["status"] == C.NO_EXPECTATION
    with pytest.raises(RuntimeError, match="EXTERNAL_EVIDENCE_NOT_INTACT"):
        C.assert_intact([r])


def test_the_expectation_comes_from_the_ARTIFACT_not_the_live_file(tmp_path, monkeypatch):
    """The anti-vacuity test. Change ONLY the artifact and the verdict must flip.

    If the module re-derived the expectation from the live file, this would stay OK forever.
    """
    live, art = _pair(tmp_path)
    assert _one(tmp_path, monkeypatch, live, art)["status"] == C.OK
    art.write_text(json.dumps({"trader_labels_file_sha256": "0" * 64}), encoding="utf-8")
    r = _one(tmp_path, monkeypatch, live, art)
    assert r["status"] == C.CHANGED, (
        "the live file is untouched and only the committed expectation moved - a module that "
        "still says OK is hashing the file against itself"
    )
    assert r["expected_sha256"] == "0" * 64


def test_it_copies_moves_and_commits_nothing():
    src = io.open(C.__file__, encoding="utf-8").read()
    for banned in ("shutil", "copyfile", "copy2", "os.rename", "subprocess", "git "):
        assert banned not in src, (
            f"custody checking must not move the operator's data: found {banned!r}")


def test_both_real_files_are_declared_outside_the_repository():
    for r in C.verify():
        assert r["in_repository"] is False
        assert "Downloads" in r["path"] or not r["path"].startswith("research")
