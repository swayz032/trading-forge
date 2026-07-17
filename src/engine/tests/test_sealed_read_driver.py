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
    ExtractionNotReady,
    ExtractionSourceMissing,
    ReaderIdentityMismatch,
    SealedReadDriver,
    _enum_stability,
    assert_dispatch_identity,
    assert_reader_identity,
    certified_reader_identity,
    require_artifacts_on_disk,
    run_extraction_stage,
    run_panels_and_certify_stage,
)


def _certified_dispatch_record():
    """A seal-day DISPATCH record matching the certified pinned identity:
    requested + resolved model == the pinned model_id, channel_class == the
    pinned channel-class (both derived from the frozen record via
    ``certified_reader_identity()`` — NOT hardcoded), headless dispatch."""
    pinned = certified_reader_identity()
    return {
        "requested_model": pinned["model_id"],
        "resolved_model": pinned["model_id"],
        "channel_class": pinned["channel_class"],
        "dispatch_mode": "headless",
    }

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
    for art, vid in zip(result["artifacts"], REHEARSAL_VIDEOS, strict=False):
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
        verified,
        mode="sealed",
        out_dir=out_dir,
        live_extract_fn=fake_live_extract_fn,
        dispatch_record=_certified_dispatch_record(),
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
        {"video_ids": ids},
        mode="sealed",
        out_dir=out_dir,
        live_extract_fn=certified_fn,
        dispatch_record=_certified_dispatch_record(),
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
    # a certified dispatch_record is supplied; the WRONG identity is in the
    # SELF-REPORT, so the self-report guard (assert_reader_identity) catches it.
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ids},
            mode="sealed",
            out_dir=out_dir,
            live_extract_fn=wrong_fn,
            dispatch_record=_certified_dispatch_record(),
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
            dispatch_record=_certified_dispatch_record(),
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
    # channel-class source record missing -> fail-closed too.
    with pytest.raises(ReaderIdentityMismatch):
        certified_reader_identity(channel_source_path=bad)


# =========================================================================== #
# CHANNEL-CLASS + DISPATCH-RECORD GUARD (R-020.3 + R-021.2) — channel-class is
# asserted from the seal-day DISPATCH RECORD (how the conductor dispatched), with
# the artifact self-report as CORROBORATION ONLY, never the sole source.
# =========================================================================== #


def _parse_channel_class_from_record():
    """Independently parse the pinned channel-class from the frozen effective-
    params record (same pin the module reads, but a SEPARATE parse here so the
    test does not trust the module's own resolution)."""
    text = open(srd.CERTIFIED_READER_EFFECTIVE_PARAMS, encoding="utf-8").read()
    m = re.search(r"channel[-\s]?class\s*=\s*\*{0,2}\s*([A-Za-z]+)", text, re.IGNORECASE)
    return m.group(1).strip().lower()


# (a) certified_reader_identity() carries channel_class read from the frozen
#     record — independently parsed here and asserted equal.
def test_certified_identity_carries_channel_class_from_frozen_record():
    ident = certified_reader_identity()
    independent = _parse_channel_class_from_record()
    assert ident["channel_class"] == independent
    # the frozen record pins the subscription channel (not the API).
    assert ident["channel_class"] != srd.FORBIDDEN_API_CHANNEL
    # provenance source_ref points at the effective-params record.
    assert ident["source_refs"]["channel_class"].endswith(
        "h1-certified-reader-effective-params-2026-07-16.md"
    )
    # channel_class is NOT part of the self-report identity fields (R-021.2:
    # asserted from the dispatch record, never from a self-report).
    assert "channel_class" not in srd._IDENTITY_FIELDS


def test_assert_dispatch_identity_accepts_certified_and_polarities():
    pinned = certified_reader_identity()
    good = _certified_dispatch_record()
    # accepted: correct dispatch, no self-report -> dispatch record governs.
    assert assert_dispatch_identity(good, pinned) is None
    # accepted: correct dispatch + AGREEING self-report (corroboration).
    assert assert_dispatch_identity(good, pinned, self_report=pinned) is None

    # non-dict dispatch record -> HALT.
    with pytest.raises(ReaderIdentityMismatch):
        assert_dispatch_identity(None, pinned)
    # unknown dispatch_mode -> HALT (fail-closed).
    bad_mode = dict(good, dispatch_mode="api-console")
    with pytest.raises(ReaderIdentityMismatch):
        assert_dispatch_identity(bad_mode, pinned)
    # interactive is the other certified subscription-runtime mode -> accepted.
    assert assert_dispatch_identity(dict(good, dispatch_mode="interactive"), pinned) is None


# (b) ★ sealed dispatch channel_class == api (everything else matching) -> HALT,
#     NO artifact persisted.
def test_sealed_dispatch_api_channel_halts_and_persists_nothing(tmp_path):
    pinned = certified_reader_identity()

    def certified_fn(video_id, manifest_verified):
        return {
            "video_id": video_id,
            "reader_identity": pinned,  # self-report is certified/clean...
            "phase_a": {"unstable": False},
            "strategies": [{"name": "should_never_persist", "entry_sequence": []}],
        }

    # ...but the DISPATCH was made on the forbidden api channel.
    api_dispatch = dict(_certified_dispatch_record(), channel_class=srd.FORBIDDEN_API_CHANNEL)
    out_dir = str(tmp_path / "sealed-api")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ["VIDapiChan0"]},
            mode="sealed",
            out_dir=out_dir,
            live_extract_fn=certified_fn,
            dispatch_record=api_dispatch,
        )
    assert "api" in str(ei.value).lower()
    assert not os.path.exists(os.path.join(out_dir, "VIDapiChan0.extraction.json"))


# (c) ★ dispatch requested_model OR resolved_model wrong -> HALT (self-report
#     clean, so the DISPATCH RECORD leg is what fails).
def test_sealed_dispatch_wrong_model_halts(tmp_path):
    pinned = certified_reader_identity()
    wrong = pinned["model_id"] + "__gpt-5.4-WRONG"

    def certified_fn(video_id, manifest_verified):
        return {
            "video_id": video_id,
            "reader_identity": pinned,  # self-report matches the certified identity
            "phase_a": {"unstable": False},
            "strategies": [{"name": "should_never_persist", "entry_sequence": []}],
        }

    for leg in ("requested_model", "resolved_model"):
        bad_dispatch = dict(_certified_dispatch_record(), **{leg: wrong})
        out_dir = str(tmp_path / f"sealed-{leg}")
        with pytest.raises(ReaderIdentityMismatch) as ei:
            run_extraction_stage(
                {"video_ids": ["VIDwrongDsp"]},
                mode="sealed",
                out_dir=out_dir,
                live_extract_fn=certified_fn,
                dispatch_record=bad_dispatch,
            )
        assert leg in str(ei.value)
        assert not os.path.exists(os.path.join(out_dir, "VIDwrongDsp.extraction.json"))


# (d) ★ CONFLICTING EVIDENCE: dispatch record = certified model, artifact
#     self-report claims a DIFFERENT model -> HALT (self-report may contradict-
#     halt, never override the authoritative dispatch record).
def test_dispatch_conflicting_self_report_halts():
    pinned = certified_reader_identity()
    good = _certified_dispatch_record()
    contradicting = dict(pinned, model_id=pinned["model_id"] + "__DIFFERENT")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        assert_dispatch_identity(good, pinned, self_report=contradicting)
    assert "conflicting evidence" in str(ei.value).lower()


# (e) dispatch_record correct + self-report agrees -> accepted + stamped
#     (the certified channel-class rides on the stamped reader_identity).
def test_sealed_dispatch_correct_accepts_and_stamps(tmp_path):
    pinned = certified_reader_identity()

    def certified_fn(video_id, manifest_verified):
        return {
            "video_id": video_id,
            "reader_identity": pinned,
            "phase_a": {"unstable": False},
            "strategies": [{"name": f"ok_{video_id}", "entry_sequence": []}],
        }

    out_dir = str(tmp_path / "sealed-ok")
    result = run_extraction_stage(
        {"video_ids": ["VIDdspOK001"]},
        mode="sealed",
        out_dir=out_dir,
        live_extract_fn=certified_fn,
        dispatch_record=_certified_dispatch_record(),
    )
    assert result["ready"] is True
    assert result["reader_identity"]["channel_class"] == _parse_channel_class_from_record()
    assert os.path.exists(os.path.join(out_dir, "VIDdspOK001.extraction.json"))


# (f) missing dispatch_record in sealed mode -> fail-closed HALT.
def test_sealed_missing_dispatch_record_halts(tmp_path):
    def certified_fn(video_id, manifest_verified):
        return {
            "video_id": video_id,
            "reader_identity": certified_reader_identity(),
            "strategies": [{"name": "x", "entry_sequence": []}],
        }

    out_dir = str(tmp_path / "sealed-nodsp")
    with pytest.raises(ReaderIdentityMismatch):
        run_extraction_stage(
            {"video_ids": ["VIDnoDsp001"]},
            mode="sealed",
            out_dir=out_dir,
            live_extract_fn=certified_fn,
            dispatch_record=None,
        )
    assert not os.path.exists(os.path.join(out_dir, "VIDnoDsp001.extraction.json"))


# (g) rehearsal mode still works with NO dispatch_record; the certified channel-
#     class is stamped on every artifact (cached staging_v32 IS the certified
#     rung by construction, so no live dispatch to assert).
def test_rehearsal_stamps_channel_class_without_dispatch_record(tmp_path):
    out_dir = str(tmp_path / "artifacts")
    verified = {"video_ids": list(REHEARSAL_VIDEOS)}
    result = run_extraction_stage(verified, mode="rehearsal", out_dir=out_dir)
    channel = _parse_channel_class_from_record()
    assert result["reader_identity"]["channel_class"] == channel
    for vid in REHEARSAL_VIDEOS:
        with open(os.path.join(out_dir, f"{vid}.extraction.json"), encoding="utf-8") as fh:
            art = json.load(fh)
        assert art["reader_identity"]["channel_class"] == channel


# (h) grep: NO hardcoded model / channel-class / sha256 literals in the module
#     (all read from frozen files at runtime — R-016 no-transcription law).
def test_no_hardcoded_identity_literals_in_module():
    src = open(srd.__file__, encoding="utf-8").read()
    ident = certified_reader_identity()
    # the certified model id is NOT baked into code (parsed from the frozen pre-reg).
    assert ident["model_id"] not in src
    # the certified channel-class VALUE is NOT baked into code (parsed from the
    # frozen effective-params record).
    assert ident["channel_class"] not in src
    # neither prompt sha is baked in (computed from the on-disk prompt bytes).
    assert ident["prompt_sha"] not in src
    assert ident["enumerator_sha"] not in src
    # no full sha256 (64-hex) literal anywhere in the module source.
    assert re.search(r"(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])", src) is None


# =========================================================================== #
# MODULE C — mechanical floor + panels + certificate (ratify-packet items 2-4).
#
# No live LLM / network anywhere: the rehearsal/staging path loads the cached
# CERTIFIED panel verdicts; the sealed path is exercised ONLY with an injected
# fake live_panel_fn. The witnesses reproduce EXACTLY what run_dress_rehearsal.py
# already proves (the committed, graded path).
# =========================================================================== #


def _real_strategy(cid: str = "2DXQqwKSwJE__s0") -> dict:
    """Load a real staging_v32 strategy (staging_v32 shape build_inputs consumes)."""
    with open(os.path.join(srd.DEFAULT_STAGING_DIR, f"{cid}.json"), encoding="utf-8") as fh:
        return json.load(fh)["strategies"][0]


def _fused_strategy() -> dict:
    """The R5L890-FUSED merge-silencing adversarial fixture (conflation REJECT)."""
    path = os.path.join(srd.DEFAULT_PANEL_CACHE_DIR, "conflation_fixtures", "R5L890_FUSED_reject.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["strategies"][0]


def _write_extraction_artifact(out_dir, video_id, pairs):
    """Write a minimal Module-B on-disk extraction artifact (per_strategy_artifacts
    shape) so run_panels_and_certify_stage can consume it exactly as it consumes a
    real Module-B artifact. `pairs` = list of (cid, strategy)."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{video_id}.extraction.json")
    art = {
        "artifact": "h1-sealed-read-extraction",
        "video_id": video_id,
        "per_strategy_artifacts": [
            {"cid": cid, "extraction": {"strategies": [strat]}} for cid, strat in pairs
        ],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(art, fh)
    return path


def _extraction_result(paths):
    return {"ready": True, "artifact_paths": list(paths)}


def _write_panel_cache(root, cid, *, conflation=None, enum_consistent=None, content_clean=None):
    """Write selected panel-grade files into a temp cache root (subdir layout
    identical to the certified claude-rung-v32 tree), to control per-axis
    presence/verdicts deterministically."""
    if conflation is not None:
        d = os.path.join(root, "conflation_grades")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{cid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"verdict": {"verdict": conflation}}, fh)
    if enum_consistent is not None:
        d = os.path.join(root, "enum_semantic_grades")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{cid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"verdict": {"enumeration_consistent": enum_consistent}}, fh)
    if content_clean is not None:
        d = os.path.join(root, "flex_grades_v32")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{cid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"grade": {"content_clean": content_clean}}, fh)


# --------------------------------------------------------------------------- #
# (a) rehearsal over the 3 spent videos through the FULL composed driver:
#     every strategy gets a certificate w/ terminal_read_grade; the 7 CLEAN spent
#     strategies grade CLEAN (matches run_dress_rehearsal's 7/7 all-clean).
# --------------------------------------------------------------------------- #


def test_module_c_rehearsal_three_videos_all_clean(tmp_path):
    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS)
    res = SealedReadDriver().run_full(manifest, "staging", str(tmp_path / "out"))

    assert res["ok"] is True
    assert res["stage"] == "panels_and_certificate"
    panels = res["panels"]
    assert panels["n_strategies"] == 7
    assert panels["module"] == "C"
    # every strategy certified through the frozen fence, both structural axes live.
    for row in panels["certificates"]:
        assert row["terminal_read_grade"] == "CLEAN"
        assert row["terminal_read_clean"] is True
        disp = row["terminal_read_disposition"]
        assert disp["conflation_check"] == "PASS"
        assert disp["enumeration_consistency"] == "PASS"  # enum axis THREADED, not AXIS_ABSENT
        # mechanical floor: F-2 content floor PASS by construction.
        assert row["mechanical_floor"]["f2_content_floor"] == "PASS"
        # all three panels recorded (completeness is evidence, not a gate).
        assert row["panels"]["completeness_grader_v3"]["evaluated"] is True
        assert row["panels"]["conflation_verdict"] == "PASS"
        assert row["panels"]["enumeration_consistency_verdict"] == "PASS"
        assert row["panels"]["source"] == "cached-certified-panel-verdicts"
    # Module C leaves D/E/F seams clean: no rollup / fraction / >=60% bar here.
    assert "terminal_read_clean_fraction" not in panels
    assert "meets_bar" not in panels


def test_module_c_completeness_false_does_not_gate(tmp_path):
    """2DXQqwKSwJE__s2 has content_clean=False in the certified flex grade yet
    grades CLEAN — completeness is RECORDED evidence, never a terminal_read_grade
    axis (exactly run_dress_rehearsal's 7/7 all-clean behavior)."""
    ext = run_extraction_stage(
        {"video_ids": ["2DXQqwKSwJE"]}, mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    res = run_panels_and_certify_stage(ext, mode="rehearsal")
    s2 = next(r for r in res["certificates"] if r["cid"] == "2DXQqwKSwJE__s2")
    assert s2["panels"]["completeness_grader_v3"]["content_clean"] is False
    assert s2["terminal_read_grade"] == "CLEAN"
    assert s2["terminal_read_clean"] is True


# --------------------------------------------------------------------------- #
# (a-witness) the known fence catches reproduce through the driver stage.
# --------------------------------------------------------------------------- #


def test_module_c_iyf_reproduces_enum_axis_reject(tmp_path):
    """IyFioFkRgWo__s0: conflation PASS but SEMANTIC enum FAIL -> REJECTED on the
    ENUM axis ALONE (proves the enum axis is independently load-bearing through
    Module C), exactly as run_dress_rehearsal proves."""
    ext = run_extraction_stage(
        {"video_ids": ["IyFioFkRgWo"]}, mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    res = run_panels_and_certify_stage(ext, mode="rehearsal")
    row = next(r for r in res["certificates"] if r["cid"] == "IyFioFkRgWo__s0")
    assert row["panels"]["conflation_verdict"] == "PASS"
    assert row["panels"]["enumeration_consistency_verdict"] == "FAIL"
    disp = row["terminal_read_disposition"]
    assert disp["conflation_check"] == "PASS"  # conflation axis isolated (PASS)
    assert disp["enumeration_consistency"] == "FAIL"  # enum axis alone fails
    assert row["terminal_read_grade"] == "REJECTED"
    assert row["terminal_read_clean"] is False


def test_module_c_fused_reproduces_conflation_axis_reject(tmp_path):
    """R5L890-FUSED merge-silencing fixture: conflation REJECT -> REJECTED through
    the driver stage (SAME path as run_dress_rehearsal's adversarial)."""
    path = _write_extraction_artifact(
        str(tmp_path / "out"), "CAL_R5L890_FUSED", [("CAL_R5L890_FUSED", _fused_strategy())]
    )
    res = run_panels_and_certify_stage(_extraction_result([path]), mode="rehearsal")
    row = res["certificates"][0]
    assert row["cid"] == "CAL_R5L890_FUSED"
    assert row["panels"]["conflation_verdict"] == "REJECT"
    assert row["terminal_read_disposition"]["conflation_check"] == "REJECT"
    assert row["terminal_read_grade"] == "REJECTED"
    assert row["terminal_read_clean"] is False


# --------------------------------------------------------------------------- #
# (b) fail-closed: a strategy missing its enum OR conflation verdict is
#     INDETERMINATE / not-clean, NEVER silently CLEAN.
# --------------------------------------------------------------------------- #


def test_module_c_missing_conflation_verdict_fails_closed(tmp_path):
    cache = str(tmp_path / "cache")
    _write_panel_cache(cache, "vidX__s0", enum_consistent=True, content_clean=True)  # conflation ABSENT
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidX", [("vidX__s0", _real_strategy())])
    res = run_panels_and_certify_stage(_extraction_result([path]), mode="staging", cache_dir=cache)
    row = res["certificates"][0]
    assert row["panels"]["conflation_verdict"] is None
    assert row["terminal_read_disposition"]["conflation_check"] == "NOT_EVALUATED"
    assert row["terminal_read_grade"] == "INDETERMINATE"
    assert row["terminal_read_clean"] is False


def test_module_c_missing_enum_verdict_fails_closed(tmp_path):
    cache = str(tmp_path / "cache")
    _write_panel_cache(cache, "vidY__s0", conflation="PASS", content_clean=True)  # enum ABSENT
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidY", [("vidY__s0", _real_strategy())])
    res = run_panels_and_certify_stage(_extraction_result([path]), mode="staging", cache_dir=cache)
    row = res["certificates"][0]
    # in-scope enum axis fails CLOSED to NOT_EVALUATED, NEVER bare None / AXIS_ABSENT.
    assert row["panels"]["enumeration_consistency_verdict"] == "NOT_EVALUATED"
    assert row["terminal_read_disposition"]["enumeration_consistency"] == "NOT_EVALUATED"
    assert row["terminal_read_grade"] == "INDETERMINATE"
    assert row["terminal_read_clean"] is False


# --------------------------------------------------------------------------- #
# (c) per-axis gating: conflation PASS + enum FAIL -> not-clean, and vice-versa.
# --------------------------------------------------------------------------- #


def test_module_c_per_axis_conflation_pass_enum_fail(tmp_path):
    cache = str(tmp_path / "cache")
    _write_panel_cache(cache, "vidP__s0", conflation="PASS", enum_consistent=False, content_clean=True)
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidP", [("vidP__s0", _real_strategy())])
    res = run_panels_and_certify_stage(_extraction_result([path]), mode="staging", cache_dir=cache)
    disp = res["certificates"][0]["terminal_read_disposition"]
    assert disp["conflation_check"] == "PASS"
    assert disp["enumeration_consistency"] == "FAIL"
    assert res["certificates"][0]["terminal_read_grade"] == "REJECTED"
    assert res["certificates"][0]["terminal_read_clean"] is False


def test_module_c_per_axis_conflation_reject_enum_pass(tmp_path):
    cache = str(tmp_path / "cache")
    _write_panel_cache(cache, "vidR__s0", conflation="REJECT", enum_consistent=True, content_clean=True)
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidR", [("vidR__s0", _real_strategy())])
    res = run_panels_and_certify_stage(_extraction_result([path]), mode="staging", cache_dir=cache)
    disp = res["certificates"][0]["terminal_read_disposition"]
    assert disp["conflation_check"] == "REJECT"
    assert disp["enumeration_consistency"] == "PASS"
    assert res["certificates"][0]["terminal_read_grade"] == "REJECTED"
    assert res["certificates"][0]["terminal_read_clean"] is False


# --------------------------------------------------------------------------- #
# (d) compose-order: Module C is UNREACHABLE unless Module B produced artifacts
#     on disk (and gate refusal short-circuits the panels stage entirely).
# --------------------------------------------------------------------------- #


def test_module_c_unreachable_when_extraction_artifact_missing_on_disk(tmp_path):
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidD", [("vidD__s0", _real_strategy())])
    ext = _extraction_result([path])
    os.remove(path)  # the extraction artifact is gone from disk
    with pytest.raises(ArtifactsMissingError):
        run_panels_and_certify_stage(ext, mode="staging", cache_dir=str(tmp_path / "cache"))


def test_module_c_not_ready_extraction_fails_closed(tmp_path):
    with pytest.raises(ExtractionNotReady):
        run_panels_and_certify_stage({"ready": False, "artifact_paths": []}, mode="staging")
    with pytest.raises(ExtractionNotReady):
        run_panels_and_certify_stage({"ready": True, "artifact_paths": []}, mode="staging")


def test_module_c_gate_deny_short_circuits_panels_stage(tmp_path):
    """run_full in sealed mode with NO SEAL-GO.token: gate refuses -> panels=None,
    live_panel_fn NEVER called (Module C structurally unreachable)."""
    panel_calls = []
    extract_calls = []

    def spy_panel_fn(cid, strategy, video_id):
        panel_calls.append(cid)
        return {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True}

    def spy_extract_fn(video_id, manifest_verified):
        extract_calls.append(video_id)
        return {"video_id": video_id, "reader_identity": certified_reader_identity(), "strategies": []}

    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS)
    res = SealedReadDriver().run_full(
        manifest,
        "sealed",
        str(tmp_path / "out"),
        token_path=str(tmp_path / "NO-SEAL-GO.token"),
        live_extract_fn=spy_extract_fn,
        live_panel_fn=spy_panel_fn,
    )
    assert res["ok"] is False
    assert res["panels"] is None
    assert res["stage"] == "seal_gate"
    assert panel_calls == []  # Module C never reached
    assert extract_calls == []  # extraction never reached either


# --------------------------------------------------------------------------- #
# (e) sealed mode with an injected fake live_panel_fn — seam works, no real key.
# --------------------------------------------------------------------------- #


def test_module_c_sealed_calls_injected_panel_fn_no_cache(tmp_path):
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidS", [("vidS__s0", _real_strategy())])
    calls = []

    def fake_panel_fn(cid, strategy, video_id):
        calls.append((cid, video_id))
        # merged panel call (all three axes in one return) — permitted.
        return {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True}

    res = run_panels_and_certify_stage(
        _extraction_result([path]), mode="sealed", live_panel_fn=fake_panel_fn
    )
    row = res["certificates"][0]
    assert calls == [("vidS__s0", "vidS")]
    assert row["panels"]["source"] == "live_panel_fn"
    assert row["terminal_read_grade"] == "CLEAN"
    assert res["panel_cache_dir"] is None  # sealed reads no disk cache


def test_module_c_sealed_per_axis_fail_closed_on_partial_panel(tmp_path):
    """A merged sealed panel call that OMITS the enum axis fails CLOSED per-axis:
    enum -> NOT_EVALUATED -> INDETERMINATE (even though conflation PASSed)."""
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidM", [("vidM__s0", _real_strategy())])

    def partial_panel_fn(cid, strategy, video_id):
        return {"conflation": "PASS", "completeness": True}  # enum omitted

    res = run_panels_and_certify_stage(
        _extraction_result([path]), mode="sealed", live_panel_fn=partial_panel_fn
    )
    row = res["certificates"][0]
    assert row["panels"]["enumeration_consistency_verdict"] == "NOT_EVALUATED"
    assert row["terminal_read_grade"] == "INDETERMINATE"
    assert row["terminal_read_clean"] is False


def test_module_c_sealed_requires_panel_fn():
    with pytest.raises(ValueError):
        run_panels_and_certify_stage(
            {"ready": True, "artifact_paths": ["x"]}, mode="sealed", live_panel_fn=None
        )


# --------------------------------------------------------------------------- #
# (f) determinism: same cached inputs -> identical certificates + grades.
# --------------------------------------------------------------------------- #


def test_module_c_deterministic(tmp_path):
    ext1 = run_extraction_stage(
        {"video_ids": list(REHEARSAL_VIDEOS)}, mode="rehearsal", out_dir=str(tmp_path / "o1")
    )
    ext2 = run_extraction_stage(
        {"video_ids": list(REHEARSAL_VIDEOS)}, mode="rehearsal", out_dir=str(tmp_path / "o2")
    )
    r1 = run_panels_and_certify_stage(ext1, mode="rehearsal")
    r2 = run_panels_and_certify_stage(ext2, mode="rehearsal")

    def _grades(r):
        return [(c["cid"], c["terminal_read_grade"], c["terminal_read_clean"]) for c in r["certificates"]]

    assert _grades(r1) == _grades(r2)
    # the full certificate bodies are byte-identical on replay.
    assert json.dumps([c["certificate"] for c in r1["certificates"]], sort_keys=True) == json.dumps(
        [c["certificate"] for c in r2["certificates"]], sort_keys=True
    )
