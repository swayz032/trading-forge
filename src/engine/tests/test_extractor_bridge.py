"""H1 pilot extractor_bridge.py tests (Wave-4 ADDENDUM 2 rework, 2026-07-12).

Covers: (a) the ExtractionVault (clause 2) — save/load roundtrip, atomic
crash-replaces-whole-video semantics, read-once caching (get_or_extract
never re-invokes the extractor on a cache hit); (b) invoke_real_extractor's
error handling (missing wrapper script, non-zero exit, non-JSON stdout,
reported error field) — all via `monkeypatch` on `subprocess.run`, NO real
subprocess / Ollama call in this file (that proof lives in the standalone
dry-run script run separately, since it needs a live Ollama + ~30-60s).

No sealed-set access anywhere in this file.
"""

from __future__ import annotations

import json
import subprocess

import pytest

from src.engine.extraction import extractor_bridge as eb

# --------------------------------------------------------------------------- #
# (a) ExtractionVault
# --------------------------------------------------------------------------- #


def test_save_and_load_extraction_roundtrip(tmp_path):
    vault_dir = str(tmp_path / "vault")
    extraction = {"strategies": [{"name": "x"}], "instrument_classification": "futures_primary"}
    path = eb.save_extraction(vault_dir, "video-1", extraction, {"seed": 42})
    assert "video-1" in path

    loaded = eb.load_cached_extraction(vault_dir, "video-1")
    assert loaded is not None
    assert loaded["extraction"] == extraction
    assert loaded["seed_params"] == {"seed": 42}
    assert "extraction_sha256" in loaded
    assert "extracted_at" in loaded


def test_load_cached_extraction_returns_none_when_absent(tmp_path):
    assert eb.load_cached_extraction(str(tmp_path / "vault"), "never-extracted") is None


def test_save_extraction_replaces_whole_video_no_cherry_pick(tmp_path):
    vault_dir = str(tmp_path / "vault")
    eb.save_extraction(vault_dir, "video-1", {"strategies": [{"name": "first-pass"}]}, {"seed": 1})
    eb.save_extraction(vault_dir, "video-1", {"strategies": [{"name": "second-pass"}]}, {"seed": 2})

    loaded = eb.load_cached_extraction(vault_dir, "video-1")
    # the SECOND save fully replaced the first — no merge of the two passes'
    # strategies, no leftover seed_params from pass 1.
    assert loaded["extraction"]["strategies"] == [{"name": "second-pass"}]
    assert loaded["seed_params"] == {"seed": 2}


def test_save_extraction_leaves_no_tmp_file_on_disk(tmp_path):
    vault_dir = str(tmp_path / "vault")
    eb.save_extraction(vault_dir, "video-1", {"strategies": []}, {"seed": 42})
    import os

    names = os.listdir(vault_dir)
    assert all(not n.endswith(".tmp") for n in names)


def test_vault_path_sanitizes_video_id(tmp_path):
    vault_dir = str(tmp_path / "vault")
    weird_id = "https://youtu.be/abc?x=1"
    eb.save_extraction(vault_dir, weird_id, {"strategies": []}, {"seed": 42})
    loaded = eb.load_cached_extraction(vault_dir, weird_id)
    assert loaded is not None


def test_get_or_extract_cache_hit_never_calls_invoke_real_extractor(tmp_path, monkeypatch):
    vault_dir = str(tmp_path / "vault")
    eb.save_extraction(vault_dir, "video-cached", {"strategies": [{"name": "cached"}]}, {"seed": 42})

    def _boom(*args, **kwargs):
        raise AssertionError("invoke_real_extractor must NOT be called on a cache hit")

    monkeypatch.setattr(eb, "invoke_real_extractor", _boom)
    result = eb.get_or_extract(vault_dir, "video-cached", "irrelevant transcript text")
    assert result == {"strategies": [{"name": "cached"}]}


def test_get_or_extract_cache_miss_invokes_and_vaults(tmp_path, monkeypatch):
    vault_dir = str(tmp_path / "vault")
    calls = []

    def _fake_invoke(transcript_text, video_id, timeout_s=240.0):
        calls.append((transcript_text, video_id))
        return {"strategies": [{"name": "fresh"}]}

    monkeypatch.setattr(eb, "invoke_real_extractor", _fake_invoke)
    result = eb.get_or_extract(vault_dir, "video-fresh", "some transcript")
    assert result == {"strategies": [{"name": "fresh"}]}
    assert calls == [("some transcript", "video-fresh")]

    # second call is now a cache hit — must not invoke again
    monkeypatch.setattr(eb, "invoke_real_extractor", lambda *a, **k: (_ for _ in ()).throw(AssertionError("re-invoked")))
    result2 = eb.get_or_extract(vault_dir, "video-fresh", "some transcript")
    assert result2 == {"strategies": [{"name": "fresh"}]}


# --------------------------------------------------------------------------- #
# (b) invoke_real_extractor error handling (mocked subprocess only)
# --------------------------------------------------------------------------- #


class _FakeCompletedProcess:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_invoke_real_extractor_missing_wrapper_script_raises(monkeypatch):
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", "/definitely/does/not/exist.ts")
    with pytest.raises(eb.RealExtractorError, match="wrapper not found"):
        eb.invoke_real_extractor("transcript", "video-1")


def test_invoke_real_extractor_nonzero_exit_raises(monkeypatch, tmp_path):
    fake_script = tmp_path / "fake.ts"
    fake_script.write_text("// stub")
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", str(fake_script))

    def _fake_run(*args, **kwargs):
        return _FakeCompletedProcess(returncode=1, stdout="", stderr="boom")

    monkeypatch.setattr(subprocess, "run", _fake_run)
    with pytest.raises(eb.RealExtractorError, match="exited 1"):
        eb.invoke_real_extractor("transcript", "video-1")


def test_invoke_real_extractor_non_json_stdout_raises(monkeypatch, tmp_path):
    fake_script = tmp_path / "fake.ts"
    fake_script.write_text("// stub")
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", str(fake_script))

    def _fake_run(*args, **kwargs):
        return _FakeCompletedProcess(returncode=0, stdout="not json at all", stderr="")

    monkeypatch.setattr(subprocess, "run", _fake_run)
    with pytest.raises(eb.RealExtractorError, match="non-JSON"):
        eb.invoke_real_extractor("transcript", "video-1")


def test_invoke_real_extractor_reported_error_field_raises(monkeypatch, tmp_path):
    fake_script = tmp_path / "fake.ts"
    fake_script.write_text("// stub")
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", str(fake_script))

    def _fake_run(*args, **kwargs):
        return _FakeCompletedProcess(returncode=0, stdout=json.dumps({"error": "callScoutExtractLlm returned null"}), stderr="")

    monkeypatch.setattr(subprocess, "run", _fake_run)
    with pytest.raises(eb.RealExtractorError, match="callScoutExtractLlm returned null"):
        eb.invoke_real_extractor("transcript", "video-1")


def test_invoke_real_extractor_success_returns_parsed_dict(monkeypatch, tmp_path):
    fake_script = tmp_path / "fake.ts"
    fake_script.write_text("// stub")
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", str(fake_script))
    payload = {"video_id": "video-1", "strategies": [{"name": "x"}], "instrument_classification": "futures_primary"}

    def _fake_run(*args, **kwargs):
        # simulate npm notices printed AFTER the JSON line, per the
        # "take the last JSON-parseable line" tolerance in invoke_real_extractor
        return _FakeCompletedProcess(returncode=0, stdout=json.dumps(payload) + "\nnpm notice\n", stderr="")

    monkeypatch.setattr(subprocess, "run", _fake_run)
    result = eb.invoke_real_extractor("transcript", "video-1")
    assert result == payload


def test_invoke_real_extractor_timeout_raises(monkeypatch, tmp_path):
    fake_script = tmp_path / "fake.ts"
    fake_script.write_text("// stub")
    monkeypatch.setattr(eb, "_EXTRACT_ONE_SCRIPT", str(fake_script))

    def _fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="npx tsx", timeout=1)

    monkeypatch.setattr(subprocess, "run", _fake_run)
    with pytest.raises(eb.RealExtractorError, match="timed out"):
        eb.invoke_real_extractor("transcript", "video-1", timeout_s=1)


def test_module_never_references_sealed_set_artifacts():
    import inspect

    src = inspect.getsource(eb)
    forbidden = ("h1-sealed-fresh-set", "sealed-16", "sealed_eval")
    for tok in forbidden:
        assert tok not in src, f"module source references a sealed-set artifact: {tok}"
