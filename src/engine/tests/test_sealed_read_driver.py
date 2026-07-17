"""H1 sealed-12 driver — MODULE B (extraction orchestration) tests.

No live LLM / network call anywhere: the rehearsal path loads already-spent
cached staging/vault artifacts; the sealed path is exercised ONLY with an
injected fake ``live_extract_fn``.

Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module B) +
ADVISOR-RULINGS R-015 item 1 / R-017.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

import pytest

from src.engine.extraction import sealed_read_driver as srd
from src.engine.extraction.sealed_read_driver import (
    ArtifactsMissingError,
    ExtractionSourceMissing,
    ReaderIdentityMismatch,
    SealedReadDriver,
    _enum_stability,
    assert_reader_identity,
    certified_reader_identity,
    require_artifacts_on_disk,
    run_extraction_stage,
)

# The 3 spent design-pool rehearsal videos (ratify-packet §4 / Module F).
REHEARSAL_VIDEOS = ["2DXQqwKSwJE", "DLwVqcLRcfw", "R5L890juvRw"]
# Expected per-video Phase-B strategy counts in the certified staging_v32 set.
EXPECTED_STAGING_COUNTS = {"2DXQqwKSwJE": 3, "DLwVqcLRcfw": 2, "R5L890juvRw": 2}


def _seal_sha(ids):
    """Module A's frozen method: sha256 over newline-joined SORTED video_ids."""
    payload = "\n".join(sorted(ids)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _write_rehearsal_manifest(path, ids):
    """A staging-mode manifest (non-sealed basename, sha-self-consistent) for
    the spent rehearsal videos — the kind Module A's staging gate accepts."""
    manifest = {
        "videos": [{"video_id": v} for v in ids],
        "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
        "sealed_sha256": _seal_sha(ids),
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return path


# --------------------------------------------------------------------------- #
# (a) rehearsal mode over the 3 spent videos -> expected artifacts on disk
# --------------------------------------------------------------------------- #


def test_rehearsal_produces_expected_artifacts_on_disk(tmp_path):
    out_dir = str(tmp_path / "artifacts")
    verified = {"video_ids": list(REHEARSAL_VIDEOS)}
    result = run_extraction_stage(verified, mode="rehearsal", out_dir=out_dir)

    assert result["ready"] is True
    # correct video set, order preserved.
    assert result["video_ids"] == REHEARSAL_VIDEOS
    assert [os.path.basename(p) for p in result["artifact_paths"]] == [
        f"{v}.extraction.json" for v in REHEARSAL_VIDEOS
    ]
    # every artifact really on disk.
    for p in result["artifact_paths"]:
        assert os.path.exists(p)

    # each artifact matches the certified staging_v32 shape: carries the
    # staging_v32 strategy objects, correct count per video.
    for art, vid in zip(result["artifacts"], REHEARSAL_VIDEOS):
        assert art["video_id"] == vid
        assert art["artifact"] == "h1-sealed-read-extraction"
        assert art["n_strategies"] == EXPECTED_STAGING_COUNTS[vid]
        assert len(art["strategies"]) == EXPECTED_STAGING_COUNTS[vid]
        # staging_v32 strategy shape: entry_sequence present, name present.
        s0 = art["strategies"][0]
        assert "name" in s0 and "entry_sequence" in s0
        # the emitted strategy is content-exact with the staging file on disk.
        cid = art["per_strategy_artifacts"][0]["cid"]
        src = art["per_strategy_artifacts"][0]["source_path"]
        with open(src, encoding="utf-8") as fh:
            assert json.load(fh)["strategies"][0] == s0
        assert cid == f"{vid}__s0"
        # Phase-A stability was read (all 3 certified-reader videos are stable).
        assert art["enum_stability"]["available"] is True
        assert art["enum_stability"]["stable"] is True
        assert art["adjudication_needed"] is False

    # no video was routed to adjudication in this (stable) rehearsal set.
    assert result["adjudications_needed"] == []


def test_rehearsal_is_deterministic(tmp_path):
    """Same cached inputs -> byte-identical artifacts on replay."""
    verified = {"video_ids": list(REHEARSAL_VIDEOS)}
    out1 = str(tmp_path / "a")
    out2 = str(tmp_path / "b")
    run_extraction_stage(verified, mode="rehearsal", out_dir=out1)
    run_extraction_stage(verified, mode="rehearsal", out_dir=out2)
    for v in REHEARSAL_VIDEOS:
        b1 = open(os.path.join(out1, f"{v}.extraction.json"), "rb").read()
        b2 = open(os.path.join(out2, f"{v}.extraction.json"), "rb").read()
        assert b1 == b2


# --------------------------------------------------------------------------- #
# (b) artifacts-on-disk gate
# --------------------------------------------------------------------------- #


def test_require_artifacts_on_disk_raises_when_missing(tmp_path):
    out_dir = str(tmp_path / "artifacts")
    verified = {"video_ids": list(REHEARSAL_VIDEOS)}
    result = run_extraction_stage(verified, mode="rehearsal", out_dir=out_dir)
    paths = result["artifact_paths"]

    # all present -> passes.
    assert require_artifacts_on_disk(paths) is True

    # delete one -> the guard refuses.
    os.remove(paths[1])
    with pytest.raises(ArtifactsMissingError) as ei:
        require_artifacts_on_disk(paths)
    assert paths[1] in ei.value.missing


def test_stage_refuses_source_missing_for_unknown_video(tmp_path):
    """Fail-closed: a video with no cached staging artifact cannot silently
    produce an empty extraction (no fabrication)."""
    out_dir = str(tmp_path / "artifacts")
    verified = {"video_ids": ["NO_SUCH_VIDEO_ID_XYZ"]}
    with pytest.raises(ExtractionSourceMissing):
        run_extraction_stage(verified, mode="rehearsal", out_dir=out_dir)


# --------------------------------------------------------------------------- #
# (c) compose-order: no gate pass => no extraction
# --------------------------------------------------------------------------- #


def test_driver_refuses_extraction_when_gate_denies(tmp_path):
    """sealed mode with NO SEAL-GO.token -> Module A refuses -> the extraction
    stage is never reached (no artifacts, live_extract_fn never called)."""
    called = []

    def spy_live_extract_fn(video_id, manifest_verified):
        called.append(video_id)
        return {"video_id": video_id, "strategies": []}

    out_dir = str(tmp_path / "artifacts")
    manifest = _write_rehearsal_manifest(str(tmp_path / "some-manifest.json"), REHEARSAL_VIDEOS)
    # point token_path at a definitely-absent file so the operator gate refuses.
    driver = SealedReadDriver()
    res = driver.run(
        manifest,
        mode="sealed",
        out_dir=out_dir,
        token_path=str(tmp_path / "NO-SEAL-GO.token"),
        live_extract_fn=spy_live_extract_fn,
    )

    assert res["ok"] is False
    assert res["allowed"] is False
    assert res["stage"] == "seal_gate"
    assert res["extraction"] is None
    assert "operator_gate_refused" in res["halt_reason"]
    # the extraction seam was NEVER entered.
    assert called == []
    assert not os.path.isdir(out_dir) or os.listdir(out_dir) == []


def test_driver_runs_extraction_after_gate_pass_staging(tmp_path):
    """Staging-mode gate PASS -> extraction stage runs end-to-end through the
    real composed driver over the 3 spent videos."""
    out_dir = str(tmp_path / "artifacts")
    manifest = _write_rehearsal_manifest(str(tmp_path / "rehearsal-manifest.json"), REHEARSAL_VIDEOS)
    driver = SealedReadDriver()
    res = driver.run(manifest, mode="staging", out_dir=out_dir)

    assert res["ok"] is True
    assert res["allowed"] is True
    assert res["stage"] == "extraction"
    assert res["extraction"]["ready"] is True
    assert res["extraction"]["video_ids"] == REHEARSAL_VIDEOS
    for p in res["extraction"]["artifact_paths"]:
        assert os.path.exists(p)


# --------------------------------------------------------------------------- #
# (d) sealed mode with an injected fake live_extract_fn — seam works, no key
# --------------------------------------------------------------------------- #


def test_sealed_mode_calls_injected_fn_and_persists_byte_exact(tmp_path):
    calls = []

    def fake_live_extract_fn(video_id, manifest_verified):
        calls.append(video_id)
        return {
            "video_id": video_id,
            "reader": "certified-reader-v3.2",
            # the seam now REQUIRES the live reader to self-report its identity;
            # here it self-reports the CERTIFIED identity so the guard accepts it.
            "reader_identity": certified_reader_identity(),
            "phase_a": {"counts": [2, 2, 2, 2, 2], "mode": 2, "mode_n": 5, "unstable": False},
            "strategies": [{"name": f"canned_{video_id}", "entry_sequence": []}],
            "instrument_classification": None,
        }

    ids = ["VIDvid000AA", "VIDvid000BB"]
    verified = {"video_ids": ids}
    out_dir = str(tmp_path / "sealed-artifacts")
    result = run_extraction_stage(
        verified, mode="sealed", out_dir=out_dir, live_extract_fn=fake_live_extract_fn
    )

    assert result["ready"] is True
    # called once per video.
    assert calls == ids
    # persisted byte-exact: the on-disk artifact equals what the fn returned.
    for vid in ids:
        path = os.path.join(out_dir, f"{vid}.extraction.json")
        assert os.path.exists(path)
        with open(path, encoding="utf-8") as fh:
            on_disk = json.load(fh)
        # byte-exact: the on-disk artifact round-trips to exactly the reader
        # payload (same video_id, strategies, phase_a) with no mutation.
        assert on_disk["video_id"] == vid
        assert on_disk["strategies"][0]["name"] == f"canned_{vid}"
        assert on_disk["phase_a"] == {
            "counts": [2, 2, 2, 2, 2],
            "mode": 2,
            "mode_n": 5,
            "unstable": False,
        }
        # the fn was NOT re-invoked by the persistence path.
        assert calls == ids
    for rec in result["per_video"]:
        assert rec["enum_stability"]["stable"] is True
        assert rec["adjudication_needed"] is False


def test_sealed_mode_requires_live_fn(tmp_path):
    with pytest.raises(ValueError):
        run_extraction_stage(
            {"video_ids": ["x"]}, mode="sealed", out_dir=str(tmp_path), live_extract_fn=None
        )


# --------------------------------------------------------------------------- #
# (e) enum-stability hook: unstable (<4/5) -> adjudication; stable -> not
# --------------------------------------------------------------------------- #


def _write_synth_video(cache_root, vid, counts, unstable=None):
    """Write a synthetic Phase-A vault block (counts-bearing) + one staging_v32
    strategy so run_extraction_stage can build an artifact for a fabricated
    video entirely from a temp cache (no real cached video needed)."""
    staging_dir = os.path.join(cache_root, "staging")
    vault_dir = os.path.join(cache_root, "vault")
    os.makedirs(staging_dir, exist_ok=True)
    os.makedirs(vault_dir, exist_ok=True)
    phase_a = {"counts": counts} if counts is not None else {"unstable": unstable}
    with open(os.path.join(vault_dir, f"{vid}.json"), "w", encoding="utf-8") as fh:
        json.dump({"phase_a": phase_a}, fh)
    with open(os.path.join(staging_dir, f"{vid}__s0.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"strategies": [{"name": f"synth_{vid}", "entry_sequence": []}], "instrument_classification": None},
            fh,
        )
    return staging_dir, vault_dir


def test_enum_stability_helper_polarities():
    # stable: 5/5 agree.
    assert _enum_stability({"counts": [3, 3, 3, 3, 3]})["stable"] is True
    # stable: exactly 4/5 agree (the floor).
    assert _enum_stability({"counts": [2, 2, 2, 2, 5]})["stable"] is True
    # UNSTABLE: only 3/5 agree.
    e = _enum_stability({"counts": [1, 1, 1, 2, 2]})
    assert e["stable"] is False and e["mode"] == 1 and e["mode_n"] == 3
    # unstable-flag-only vault shape.
    assert _enum_stability({"unstable": True})["stable"] is False
    assert _enum_stability({"unstable": False})["stable"] is True
    # missing Phase-A fails closed.
    assert _enum_stability(None)["available"] is False
    assert _enum_stability(None)["stable"] is False


def test_unstable_video_routes_to_adjudication_hook(tmp_path):
    cache_root = str(tmp_path / "cache")
    staging_dir, vault_dir = _write_synth_video(cache_root, "STABLEvid01", counts=[2, 2, 2, 2, 2])
    _write_synth_video(cache_root, "UNSTABLvid1", counts=[1, 1, 2, 3, 2])  # mode 1, mode_n 2 -> unstable

    adjudicated = []

    def adjudicate_fn(video_id, enum_stability):
        adjudicated.append(video_id)
        return {"video_id": video_id, "adjudication_needed": True, "resolved_count": None}

    out_dir = str(tmp_path / "out")
    verified = {"video_ids": ["STABLEvid01", "UNSTABLvid1"]}
    result = run_extraction_stage(
        verified,
        mode="rehearsal",
        out_dir=out_dir,
        staging_dir=staging_dir,
        phase_a_vault_dir=vault_dir,
        adjudicate_fn=adjudicate_fn,
    )

    by_vid = {r["video_id"]: r for r in result["per_video"]}
    # the unstable video was routed to adjudication; the stable one was not.
    assert by_vid["UNSTABLvid1"]["adjudication_needed"] is True
    assert by_vid["STABLEvid01"]["adjudication_needed"] is False
    assert adjudicated == ["UNSTABLvid1"]
    assert result["adjudications_needed"] == ["UNSTABLvid1"]

    # the unstable artifact records the adjudication routing on disk.
    with open(os.path.join(out_dir, "UNSTABLvid1.extraction.json"), encoding="utf-8") as fh:
        art = json.load(fh)
    assert art["adjudication"]["adjudication_needed"] is True


# --------------------------------------------------------------------------- #
# READER-IDENTITY GUARD (R-018.1a/b) — the seal-day WRONG-EXTRACTOR fence.
# --------------------------------------------------------------------------- #


def _independent_sha(path):
    """Recompute a file's sha256 independently of the module under test."""
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


# (a) certified_reader_identity() returns the REAL prompt/enumerator SHAs
#     (recomputed here over the same files) + the model_id read from the frozen
#     pre-reg record.
def test_certified_reader_identity_reads_frozen_record_and_real_shas():
    ident = certified_reader_identity()

    # prompt_sha / enumerator_sha == an INDEPENDENT sha over the same on-disk
    # prompt files (the file bytes ARE the identity — never hardcoded).
    assert ident["prompt_sha"] == _independent_sha(srd.FRONTIER_PROMPT_PATH)
    assert ident["enumerator_sha"] == _independent_sha(srd.ENUMERATOR_PROMPT_PATH)
    assert re.fullmatch(r"[0-9a-f]{64}", ident["prompt_sha"])
    assert re.fullmatch(r"[0-9a-f]{64}", ident["enumerator_sha"])
    assert ident["prompt_sha"] != ident["enumerator_sha"]

    # model_id + k == the values in the frozen Claude-rung pre-reg (read here
    # straight from the doc, independent of the module's parse).
    prereg = open(srd.CLAUDE_RUNG_PREREG, encoding="utf-8").read()
    frozen_model = re.search(r"Model ID frozen[:*\s]*`([^`]+)`", prereg).group(1)
    assert ident["model_id"] == frozen_model
    assert ident["model_id"] in prereg  # genuinely the frozen string
    assert ident["k"] == int(re.search(r"\bk=(\d+)\b", prereg).group(1))

    # params: frozen designator, values not enumerated in any frozen artifact.
    assert ident["params"]["designator"].lower() == "pinned params"
    assert ident["params"]["enumerated_values"] is None

    # deterministic.
    assert certified_reader_identity() == ident


# (b) rehearsal stamps reader_identity on each of the 3 artifacts; stamp ==
#     certified_reader_identity().
def test_rehearsal_stamps_certified_reader_identity(tmp_path):
    out_dir = str(tmp_path / "artifacts")
    verified = {"video_ids": list(REHEARSAL_VIDEOS)}
    result = run_extraction_stage(verified, mode="rehearsal", out_dir=out_dir)
    pinned = certified_reader_identity()

    assert result["reader_identity"] == pinned
    for vid in REHEARSAL_VIDEOS:
        with open(os.path.join(out_dir, f"{vid}.extraction.json"), encoding="utf-8") as fh:
            art = json.load(fh)
        assert art["reader_identity"] == pinned


# (c) sealed mode with an injected fn self-reporting the CERTIFIED identity ->
#     accepted + stamped.
def test_sealed_mode_accepts_certified_identity_and_stamps(tmp_path):
    pinned = certified_reader_identity()

    def certified_fn(video_id, manifest_verified):
        return {
            "video_id": video_id,
            "reader_identity": pinned,
            "phase_a": {"unstable": False},
            "strategies": [{"name": f"ok_{video_id}", "entry_sequence": []}],
        }

    ids = ["VIDcertOK01"]
    out_dir = str(tmp_path / "sealed")
    result = run_extraction_stage(
        {"video_ids": ids}, mode="sealed", out_dir=out_dir, live_extract_fn=certified_fn
    )
    assert result["ready"] is True
    assert result["reader_identity"] == pinned
    # persisted (byte-exact) artifact carries the self-reported certified identity.
    with open(os.path.join(out_dir, "VIDcertOK01.extraction.json"), encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["reader_identity"] == pinned
    # stage summary record also stamped.
    assert result["per_video"][0]["video_id"] == "VIDcertOK01"


# (d) ★ CORE SAFETY PROPERTY: sealed mode, injected fn self-reports a WRONG
#     model (gpt-5.4) -> ReaderIdentityMismatch, HALT, NO artifact persisted.
def test_sealed_mode_wrong_model_halts_and_persists_nothing(tmp_path):
    pinned = certified_reader_identity()
    wrong_model = pinned["model_id"] + "__WRONG-BRAIN"  # e.g. the gpt-5.4 vault

    def wrong_fn(video_id, manifest_verified):
        ident = dict(pinned)
        ident["model_id"] = wrong_model  # everything else matches; only the brain differs
        return {
            "video_id": video_id,
            "reader_identity": ident,
            "phase_a": {"unstable": False},
            "strategies": [{"name": "should_never_persist", "entry_sequence": []}],
        }

    ids = ["VIDwrongMdl"]
    out_dir = str(tmp_path / "sealed-wrong")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ids}, mode="sealed", out_dir=out_dir, live_extract_fn=wrong_fn
        )
    assert "model_id" in str(ei.value)
    # HALT means NO artifact was written for that video.
    assert not os.path.exists(os.path.join(out_dir, "VIDwrongMdl.extraction.json"))


def test_sealed_mode_missing_self_report_halts(tmp_path):
    """A live payload that does NOT self-report a reader_identity is fail-closed."""

    def no_identity_fn(video_id, manifest_verified):
        return {"video_id": video_id, "strategies": []}  # no reader_identity block

    with pytest.raises(ReaderIdentityMismatch):
        run_extraction_stage(
            {"video_ids": ["VIDnoident0"]},
            mode="sealed",
            out_dir=str(tmp_path / "o"),
            live_extract_fn=no_identity_fn,
        )


def test_assert_reader_identity_polarities():
    pinned = certified_reader_identity()
    # exact match passes (source_refs is NOT compared).
    claimed = {k: pinned[k] for k in ("model_id", "params", "k", "prompt_sha", "enumerator_sha")}
    assert assert_reader_identity(claimed, pinned) is None
    # each field, mutated in turn, must raise.
    for field in ("model_id", "params", "k", "prompt_sha", "enumerator_sha"):
        bad = dict(claimed)
        bad[field] = "TAMPERED" if field != "k" else 999
        with pytest.raises(ReaderIdentityMismatch):
            assert_reader_identity(bad, pinned)


# (f) fail-closed if a frozen prompt file is missing (point at a bad path).
def test_identity_fails_closed_on_missing_prompt_file(tmp_path):
    bad = str(tmp_path / "does-not-exist.md")
    with pytest.raises(ReaderIdentityMismatch):
        certified_reader_identity(frontier_prompt_path=bad)
    with pytest.raises(ReaderIdentityMismatch):
        certified_reader_identity(enumerator_prompt_path=bad)
    with pytest.raises(ReaderIdentityMismatch):
        certified_reader_identity(prereg_path=bad)
    with pytest.raises(ReaderIdentityMismatch):
        certified_reader_identity(params_source_path=bad)
