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
    ECONOMICS_CEILING,
    FUSED_WITNESS_CID,
    IYF_WITNESS_CID,
    REHEARSAL_SPENT_VIDEOS,
    SCOPE_LINES,
    VIDEO_CLEAN_BAR,
    ArtifactsMissingError,
    ExtractionNotReady,
    ExtractionSourceMissing,
    RaterLayerNotReady,
    ReaderIdentityMismatch,
    RehearsalManifestMismatch,
    SealedReadDriver,
    VerdictNotReady,
    _dispatch_two_stage_packet,
    _enum_stability,
    _stage1_view,
    _write_spent_rehearsal_manifest,
    assert_dispatch_identity,
    assert_reader_identity,
    certified_reader_identity,
    rehearsal_drift_guard,
    rehearsal_instrument_shas,
    require_artifacts_on_disk,
    run_extraction_stage,
    run_full_dress_rehearsal,
    run_panels_and_certify_stage,
    run_rater_layer_stage,
    run_verdict_stage,
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

def _phase_a_draw_fn(
    counts,
    *,
    identity=None,
    dispatch=None,
    per_draw_dispatch=None,
    per_draw_identity=None,
    refs_for=None,
    omit_dispatch=False,
    omit_identity=False,
    spy=None,
):
    """A PER-DRAW Phase-A enumeration seam (R-024.1). draw_index ``i`` returns
    ``counts[i]`` + ``strategy_refs``, self-reporting the certified reader_identity
    and a per-draw dispatch_record (certified unless overridden for that index).
    Every call is one SEPARATE dispatch — the driver combines the draws itself."""
    base_ident = identity or certified_reader_identity()
    base_dispatch = dispatch if dispatch is not None else _certified_dispatch_record()

    def fn(video_id, draw_index, _manifest_verified):
        if spy is not None:
            spy.append((video_id, draw_index))
        c = counts[draw_index]
        disp = (per_draw_dispatch or {}).get(draw_index, base_dispatch)
        ident = (per_draw_identity or {}).get(draw_index, base_ident)
        refs = refs_for(video_id, draw_index, c) if refs_for else [f"s{j}" for j in range(c)]
        payload = {"video_id": video_id, "draw_index": draw_index, "count": c, "strategy_refs": refs}
        if not omit_identity:
            payload["reader_identity"] = ident
        if not omit_dispatch:
            payload["dispatch_record"] = disp
        return payload

    return fn


def _phase_b_fn(*, identity=None, dispatch=None, strat_for=None, spy=None):
    """A PER-STRATEGY Phase-B single-draw extraction seam (R-024.1). Returns ONE
    staging_v32-shaped strategy per consensus ref, self-reporting the certified
    identity + a dispatch_record. Each call is one SEPARATE dispatch."""
    ident = identity or certified_reader_identity()
    disp = dispatch if dispatch is not None else _certified_dispatch_record()

    def fn(video_id, strategy_ref, strategy_index, _manifest_verified):
        if spy is not None:
            spy.append((video_id, strategy_ref, strategy_index))
        strat = (
            strat_for(video_id, strategy_ref, strategy_index)
            if strat_for
            else {"name": f"{video_id}__strat{strategy_index}", "entry_sequence": []}
        )
        return {
            "reader_identity": ident,
            "dispatch_record": disp,
            "strategies": [strat],
            "instrument_classification": None,
        }

    return fn


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
# (d) sealed mode PER-DRAW / PER-STRATEGY (R-024.1) — the driver dispatches FIVE
# independent Phase-A draws + one Phase-B dispatch per consensus strategy, no key.
# --------------------------------------------------------------------------- #


# (a) ★ R-024.1 REGRESSION: sealed asks EXACTLY 5 Phase-A draws per video (draw
#     indices 0..4), NOT one per-video call. Spy the per-draw seam.
def test_sealed_dispatches_exactly_five_phase_a_draws_per_video(tmp_path):
    pa_spy = []
    pb_spy = []
    ids = ["VIDvid000AA", "VIDvid000BB"]
    out_dir = str(tmp_path / "sealed-artifacts")
    result = run_extraction_stage(
        {"video_ids": ids},
        mode="sealed",
        out_dir=out_dir,
        live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2], spy=pa_spy),
        live_phase_b_fn=_phase_b_fn(spy=pb_spy),
    )
    assert result["ready"] is True
    # EXACTLY 5 Phase-A draws per video, draw_index 0..4 each (independent draws).
    for vid in ids:
        drawn = sorted(d for (v, d) in pa_spy if v == vid)
        assert drawn == [0, 1, 2, 3, 4], f"{vid}: expected 5 per-draw dispatches 0..4, got {drawn}"
    assert len(pa_spy) == 5 * len(ids)  # never one per-video call
    # persisted artifact records the driver-computed phase_a (counts from the 5 draws).
    for vid in ids:
        with open(os.path.join(out_dir, f"{vid}.extraction.json"), encoding="utf-8") as fh:
            art = json.load(fh)
        assert art["phase_a"]["counts"] == [2, 2, 2, 2, 2]
        assert art["phase_a"]["mode"] == 2 and art["phase_a"]["mode_n"] == 5
        assert art["phase_a"]["stable"] is True
        assert art["enum_stability"]["stable"] is True
        assert art["adjudication_needed"] is False


# (b) the DRIVER (not the conductor) computes consensus + stability from the 5
#     collected draws: [2,2,2,2,3] -> mode 2, mode_n 4 -> stable; [2,2,3,3,4] ->
#     mode_n 2 -> unstable -> exactly one adjudication dispatch requested.
def test_sealed_driver_computes_consensus_and_stability_from_five_draws(tmp_path):
    result = run_extraction_stage(
        {"video_ids": ["VIDstable01"]},
        mode="sealed",
        out_dir=str(tmp_path / "stable"),
        live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 3]),
        live_phase_b_fn=_phase_b_fn(),
    )
    rec = result["per_video"][0]
    assert rec["enum_stability"]["mode"] == 2
    assert rec["enum_stability"]["mode_n"] == 4  # 4/5 agree -> the floor
    assert rec["enum_stability"]["stable"] is True
    assert rec["adjudication_needed"] is False

    adjudicated = []

    def adjudicate_fn(video_id, enum_stability):
        adjudicated.append((video_id, enum_stability["mode_n"]))
        return {"video_id": video_id, "adjudication_needed": True, "resolved_count": None}

    result2 = run_extraction_stage(
        {"video_ids": ["VIDunstab01"]},
        mode="sealed",
        out_dir=str(tmp_path / "unstable"),
        live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 3, 3, 4]),
        live_phase_b_fn=_phase_b_fn(),
        adjudicate_fn=adjudicate_fn,
    )
    rec2 = result2["per_video"][0]
    assert rec2["enum_stability"]["mode_n"] == 2  # deterministic tie-break -> smallest
    assert rec2["enum_stability"]["stable"] is False
    assert rec2["adjudication_needed"] is True
    # exactly ONE adjudication dispatch was requested for the unstable video.
    assert adjudicated == [("VIDunstab01", 2)]
    assert result2["adjudications_needed"] == ["VIDunstab01"]


# (c) Phase-B: ONE dispatch PER CONSENSUS STRATEGY (spy the count). The modal draw
#     enumerates `mode` strategies -> `mode` Phase-B dispatches.
def test_sealed_phase_b_one_dispatch_per_consensus_strategy(tmp_path):
    pb_spy = []
    out_dir = str(tmp_path / "sealed")
    # all 5 draws enumerate 3 strategies -> stable mode 3 -> 3 Phase-B dispatches.
    result = run_extraction_stage(
        {"video_ids": ["VIDthree001"]},
        mode="sealed",
        out_dir=out_dir,
        live_phase_a_draw_fn=_phase_a_draw_fn([3, 3, 3, 3, 3]),
        live_phase_b_fn=_phase_b_fn(spy=pb_spy),
    )
    assert result["ready"] is True
    assert len(pb_spy) == 3  # one dispatch per consensus strategy
    assert [i for (_v, _r, i) in pb_spy] == [0, 1, 2]
    with open(os.path.join(out_dir, "VIDthree001.extraction.json"), encoding="utf-8") as fh:
        art = json.load(fh)
    assert art["n_strategies"] == 3
    assert len(art["strategies"]) == 3
    assert len(art["per_strategy_artifacts"]) == 3
    # cids are <video_id>__s<idx> (staging_v32 shape for downstream Module C).
    assert [e["cid"] for e in art["per_strategy_artifacts"]] == [f"VIDthree001__s{i}" for i in range(3)]


def test_sealed_mode_requires_per_draw_and_per_strategy_seams(tmp_path):
    # both seams missing -> ValueError.
    with pytest.raises(ValueError):
        run_extraction_stage({"video_ids": ["x"]}, mode="sealed", out_dir=str(tmp_path / "a"))
    # only Phase-A supplied -> still ValueError (Phase-B required).
    with pytest.raises(ValueError):
        run_extraction_stage(
            {"video_ids": ["x"]},
            mode="sealed",
            out_dir=str(tmp_path / "b"),
            live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2]),
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


# (c) sealed mode: each per-draw + per-strategy dispatch self-reports the CERTIFIED
#     identity -> accepted; the assembled artifact is stamped with the pinned id.
def test_sealed_mode_accepts_certified_identity_and_stamps(tmp_path):
    pinned = certified_reader_identity()
    out_dir = str(tmp_path / "sealed")
    result = run_extraction_stage(
        {"video_ids": ["VIDcertOK01"]},
        mode="sealed",
        out_dir=out_dir,
        live_phase_a_draw_fn=_phase_a_draw_fn([1, 1, 1, 1, 1]),
        live_phase_b_fn=_phase_b_fn(),
    )
    assert result["ready"] is True
    assert result["reader_identity"] == pinned
    with open(os.path.join(out_dir, "VIDcertOK01.extraction.json"), encoding="utf-8") as fh:
        on_disk = json.load(fh)
    assert on_disk["reader_identity"] == pinned
    assert result["per_video"][0]["video_id"] == "VIDcertOK01"


# (d) ★ CORE SAFETY PROPERTY (R-024.1 item 2): a wrong-model dispatch_record on
#     ONE of the 5 Phase-A draws -> ReaderIdentityMismatch, HALT (not silently
#     averaged into the consensus), NO artifact persisted for that video.
def test_sealed_wrong_model_on_one_of_five_draws_halts(tmp_path):
    pinned = certified_reader_identity()
    wrong_model = pinned["model_id"] + "__gpt-5.4-WRONG-BRAIN"
    # draw index 2 (of 0..4) carries a wrong-model dispatch_record; the other four
    # are certified. The per-DISPATCH guard must HALT on that single draw.
    bad_dispatch = dict(_certified_dispatch_record(), resolved_model=wrong_model)
    out_dir = str(tmp_path / "sealed-wrong-draw")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ["VIDwrongDrw"]},
            mode="sealed",
            out_dir=out_dir,
            live_phase_a_draw_fn=_phase_a_draw_fn(
                [2, 2, 2, 2, 2], per_draw_dispatch={2: bad_dispatch}
            ),
            live_phase_b_fn=_phase_b_fn(),
        )
    assert "resolved_model" in str(ei.value)
    assert not os.path.exists(os.path.join(out_dir, "VIDwrongDrw.extraction.json"))


# (d-ii) a wrong-model SELF-REPORT on one Phase-A draw -> HALT (self-report guard).
def test_sealed_wrong_self_report_on_one_draw_halts(tmp_path):
    pinned = certified_reader_identity()
    wrong_ident = dict(pinned, model_id=pinned["model_id"] + "__WRONG-BRAIN")
    out_dir = str(tmp_path / "sealed-wrong-selfreport")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ["VIDwrongSR0"]},
            mode="sealed",
            out_dir=out_dir,
            live_phase_a_draw_fn=_phase_a_draw_fn(
                [2, 2, 2, 2, 2], per_draw_identity={3: wrong_ident}
            ),
            live_phase_b_fn=_phase_b_fn(),
        )
    assert "model_id" in str(ei.value)
    assert not os.path.exists(os.path.join(out_dir, "VIDwrongSR0.extraction.json"))


# (d-iii) a wrong-model dispatch on a Phase-B strategy -> HALT (per-dispatch too).
def test_sealed_wrong_model_on_phase_b_dispatch_halts(tmp_path):
    pinned = certified_reader_identity()
    wrong = dict(_certified_dispatch_record(), requested_model=pinned["model_id"] + "__WRONG")
    out_dir = str(tmp_path / "sealed-wrong-b")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ["VIDwrongB01"]},
            mode="sealed",
            out_dir=out_dir,
            live_phase_a_draw_fn=_phase_a_draw_fn([1, 1, 1, 1, 1]),
            live_phase_b_fn=_phase_b_fn(dispatch=wrong),
        )
    assert "requested_model" in str(ei.value)
    assert not os.path.exists(os.path.join(out_dir, "VIDwrongB01.extraction.json"))


def test_sealed_mode_missing_self_report_halts(tmp_path):
    """A Phase-A draw payload that does NOT self-report a reader_identity is
    fail-closed (a live reader that will not name itself cannot read the twelve)."""
    with pytest.raises(ReaderIdentityMismatch):
        run_extraction_stage(
            {"video_ids": ["VIDnoident0"]},
            mode="sealed",
            out_dir=str(tmp_path / "o"),
            live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2], omit_identity=True),
            live_phase_b_fn=_phase_b_fn(),
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


# (b) ★ a sealed dispatch on the forbidden api channel (everything else matching)
#     -> HALT, NO artifact persisted (asserted per dispatch, on the first draw).
def test_sealed_dispatch_api_channel_halts_and_persists_nothing(tmp_path):
    api_dispatch = dict(_certified_dispatch_record(), channel_class=srd.FORBIDDEN_API_CHANNEL)
    out_dir = str(tmp_path / "sealed-api")
    with pytest.raises(ReaderIdentityMismatch) as ei:
        run_extraction_stage(
            {"video_ids": ["VIDapiChan0"]},
            mode="sealed",
            out_dir=out_dir,
            live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2], dispatch=api_dispatch),
            live_phase_b_fn=_phase_b_fn(),
        )
    assert "api" in str(ei.value).lower()
    assert not os.path.exists(os.path.join(out_dir, "VIDapiChan0.extraction.json"))


# (c) ★ dispatch requested_model OR resolved_model wrong -> HALT (self-report
#     clean, so the DISPATCH RECORD leg is what fails), asserted per dispatch.
def test_sealed_dispatch_wrong_model_halts(tmp_path):
    pinned = certified_reader_identity()
    wrong = pinned["model_id"] + "__gpt-5.4-WRONG"
    for leg in ("requested_model", "resolved_model"):
        bad_dispatch = dict(_certified_dispatch_record(), **{leg: wrong})
        out_dir = str(tmp_path / f"sealed-{leg}")
        with pytest.raises(ReaderIdentityMismatch) as ei:
            run_extraction_stage(
                {"video_ids": ["VIDwrongDsp"]},
                mode="sealed",
                out_dir=out_dir,
                live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2], dispatch=bad_dispatch),
                live_phase_b_fn=_phase_b_fn(),
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


# (e) per-dispatch dispatch_records correct + self-reports agree -> accepted +
#     stamped (the certified channel-class rides on the stamped reader_identity).
def test_sealed_dispatch_correct_accepts_and_stamps(tmp_path):
    out_dir = str(tmp_path / "sealed-ok")
    result = run_extraction_stage(
        {"video_ids": ["VIDdspOK001"]},
        mode="sealed",
        out_dir=out_dir,
        live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2]),
        live_phase_b_fn=_phase_b_fn(),
    )
    assert result["ready"] is True
    assert result["reader_identity"]["channel_class"] == _parse_channel_class_from_record()
    assert os.path.exists(os.path.join(out_dir, "VIDdspOK001.extraction.json"))


# (f) a dispatch with NEITHER its own dispatch_record NOR a whole-run fallback ->
#     fail-closed HALT (assert_dispatch_identity requires a dict).
def test_sealed_missing_dispatch_record_halts(tmp_path):
    out_dir = str(tmp_path / "sealed-nodsp")
    with pytest.raises(ReaderIdentityMismatch):
        run_extraction_stage(
            {"video_ids": ["VIDnoDsp001"]},
            mode="sealed",
            out_dir=out_dir,
            # per-draw payloads omit dispatch_record AND no top-level fallback given.
            live_phase_a_draw_fn=_phase_a_draw_fn([2, 2, 2, 2, 2], omit_dispatch=True),
            live_phase_b_fn=_phase_b_fn(),
            dispatch_record=None,
        )
    assert not os.path.exists(os.path.join(out_dir, "VIDnoDsp001.extraction.json"))


# (f-ii) a per-dispatch payload MAY omit its own dispatch_record and rely on the
#     whole-run fallback -> accepted (the fallback governs).
def test_sealed_dispatch_record_fallback_accepted(tmp_path):
    out_dir = str(tmp_path / "sealed-fallback")
    result = run_extraction_stage(
        {"video_ids": ["VIDfallbk01"]},
        mode="sealed",
        out_dir=out_dir,
        live_phase_a_draw_fn=_phase_a_draw_fn([1, 1, 1, 1, 1], omit_dispatch=True),
        live_phase_b_fn=_phase_b_fn(),
        dispatch_record=_certified_dispatch_record(),  # whole-run fallback
    )
    assert result["ready"] is True
    assert os.path.exists(os.path.join(out_dir, "VIDfallbk01.extraction.json"))


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


# =========================================================================== #
# MODULE D — HUMAN-BLIND TWO-STAGE RATER LAYER (ratify-packet item 5).
#
# No live LLM/network anywhere: the dual-read uses the frozen verbatim locator
# stub; raters are deterministic fakes / injected spies. Spec: pilot ADDENDUM 4
# (dual-read gate + two-stage tier-3 packet, read-order-locked, leak-scanned,
# controls-first).
# =========================================================================== #

import copy as _copy  # noqa: E402

from src.engine.extraction import pilot_conveyor as _pc  # noqa: E402
from src.engine.tests._a_packet_harness import build_inputs as _build_inputs  # noqa: E402

_GATE_CONTROLS = {"W1-0001", "W1-0003", "W1-0005", "W1-0007", "W1-0009"}
_CONTEXT_CONTROLS = {"W1-0002", "W1-0004", "W1-0006", "W1-0008", "W1-0010"}


def _prep_for(cid: str = "2DXQqwKSwJE__s0"):
    """Run the FROZEN dual-read gate on a real staging strategy (verbatim locator
    stub — no network) -> a prep dict carrying the two-stage tier-3 packet, the
    item_span_map, and the fall-through targets. 2DXQqwKSwJE__s0 yields 7 clean
    fall-throughs whose packet passes the frozen leak-scan."""
    strat = _real_strategy(cid)
    transcript, _t1, _e = _build_inputs(strat)
    return _pc.prepare_strategy(
        strat,
        transcript,
        cid.split("__")[0],
        extractor_version="certified-reader-v3.2",
        taxonomy_version="taxonomy-v2",
        strategy_index=0,
        propose_fn=_pc._synthetic_dry_run_propose_fn,
    )


def _controls_answers(*, pass_gate=True, pass_context=True):
    """Set-A control answers: correct in each direction unless told to fail it."""
    a = {}
    for i in _GATE_CONTROLS:
        a[i] = "gate-strength" if pass_gate else "context"
    for i in _CONTEXT_CONTROLS:
        a[i] = "context" if pass_context else "gate-strength"
    return a


def _make_rater(*, target_role="gate-strength", support="confirmed", pass_gate=True, pass_context=True, log=None):
    """A blind two-stage rater_fn: answers Set-A controls (correct unless told to
    fail), every target a fixed role, every Stage-2 a fixed support. Optionally
    logs each (rater_id, stage, view) it is handed — used to prove the read-order
    lock + rater independence."""

    def rater(rater_id, stage, view):
        if log is not None:
            log.append((rater_id, stage, _copy.deepcopy(view)))
        if stage == "stage1":
            out = {}
            for section in view.get("sections", []):
                for item in section.get("items", []):
                    iid = item["item_id"]
                    if iid in _GATE_CONTROLS:
                        out[iid] = "gate-strength" if pass_gate else "context"
                    elif iid in _CONTEXT_CONTROLS:
                        out[iid] = "context" if pass_context else "gate-strength"
                    else:
                        out[iid] = target_role
            return out
        return {
            item["item_id"]: {"support": support, "support_justification": "j"}
            for item in view.get("stage2", {}).get("items", [])
        }

    return rater


# --------------------------------------------------------------------------- #
# (a) two-stage read-order LOCK: the Stage-1 rater view provably lacks Stage-2
#     condition/support content.
# --------------------------------------------------------------------------- #


def test_d_read_order_lock_stage1_view_has_no_stage2_content():
    prep = _prep_for()
    packet = prep["tier3_packet"]
    stage2_items = packet["stage2"]["items"]
    assert stage2_items  # there ARE stage-2 items (7 fall-throughs)

    s1_view = _stage1_view(packet)
    # STRUCTURAL: the whole stage2 block is absent from the Stage-1 view.
    assert "stage2" not in s1_view
    # CONTENT: every Stage-2 field (revealed condition text + support slot) is
    # absent from the serialized Stage-1 view.
    serialized = json.dumps(s1_view, default=str)
    assert "adjudication_response" not in serialized
    assert "extracted_condition_text" not in serialized
    assert "support_justification" not in serialized
    # ...yet Stage-2 DOES carry the revealed condition text (it lives ONLY in the
    # separate stage2 block, read after Stage-1 commits).
    assert any(it.get("extracted_condition_text") for it in stage2_items)
    # read-order lock is stated on the packet for a human/dispatcher too.
    assert "read_order_lock" in packet["stage2"]


# --------------------------------------------------------------------------- #
# (b) ★ leak-scan fires on a leaky packet -> FAIL-CLOSED HALT, packet NOT
#     dispatched (raters never invoked).
# --------------------------------------------------------------------------- #


def test_d_leak_scan_halts_and_does_not_dispatch():
    prep = _prep_for()
    packet = _copy.deepcopy(prep["tier3_packet"])
    # Craft a Stage-2 leak: duplicate a Set-B item's OWN revealed condition text
    # into that SAME item OUTSIDE its quote_anchor (english_gloss) -> the frozen
    # scan's stage2 check fires (Stage-2 inferable from the Stage-1 item).
    leak_phrase = "ZZLEAKPHRASE_unique_condition_text"
    target = packet["sections"][-1]["items"][0]
    tid = target["item_id"]
    target["english_gloss"] = leak_phrase
    for s2 in packet["stage2"]["items"]:
        if s2["item_id"] == tid:
            s2["extracted_condition_text"] = leak_phrase

    # sanity: the frozen scan actually flags it.
    assert _pc.blinding_leak_scan(packet).clean is False

    rater_calls = []

    def spy_rater(rater_id, stage, view):
        rater_calls.append((rater_id, stage))
        return {}

    result = _dispatch_two_stage_packet(
        packet, prep["item_span_map"], prep["full_transcript"], spy_rater, None
    )
    assert result["halted"] is True
    assert result["dispatched"] is False
    assert result["leak_scan_clean"] is False
    assert any("stage2_leak" in v for v in result["leak_violations"])
    assert result["tier3_verdicts"] == []
    # ★ the raters were NEVER invoked on the leaky packet.
    assert rater_calls == []


def test_d_leak_scan_halt_propagates_through_stage_no_certificate(tmp_path, monkeypatch):
    """A GENUINELY leaky packet HALTs fail-closed through run_rater_layer_stage:
    the row is marked halted with NO adjudicated certificate, and the stage does
    not crash.

    R-022 NOTE: this test previously relied on the AR-011 FALSE-POSITIVE (the
    real 2DXQqwKSwJE quote contains the trader word "drift", which the 3-char
    "dri" fragment wrongly HALTed). That defect is now FIXED -- the spent set
    flows clean -- so the fail-closed PROPAGATION path is exercised here with a
    planted GENUINE machinery-key leak (Layer 1) instead, via a wrapped
    `_build_tier3_packet`. The production HALT path is unchanged; only its
    (bogus) former trigger is gone."""
    original_builder = _pc._build_tier3_packet

    def _leaky_builder(full_transcript, video_id, fallthroughs, strategy_index=0,
                       condition_text_by_span=None, audit_target=None):
        packet, span_map = original_builder(
            full_transcript, video_id, fallthroughs, strategy_index,
            condition_text_by_span=condition_text_by_span, audit_target=audit_target,
        )
        # Plant a real grade-machinery KEY spec-side -> Layer-1 leak (genuine).
        if packet["sections"][-1]["items"]:
            packet["sections"][-1]["items"][0]["extracted_object"] = "leaked ground_truth answer"
        return packet, span_map

    monkeypatch.setattr(_pc, "_build_tier3_packet", _leaky_builder)

    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), ["2DXQqwKSwJE"])
    full = SealedReadDriver().run_with_raters(manifest, "staging", str(tmp_path / "out"))
    rl = full["rater_layer"]
    halted = [r for r in rl["rater_verdicts"] if r["rater_layer_halted"]]
    assert halted, "expected the planted genuine leak to HALT fail-closed"
    for r in halted:
        assert r["dispatched"] is False
        assert r["adjudicated_certificate"] is None
        assert r["leak_scan_clean"] is False
        assert any(v == "machinery_key:ground_truth" for v in r["leak_violations"])


# --------------------------------------------------------------------------- #
# (c) control-gate: a rater whose controls score <4/5 -> its target judgments are
#     DISCARDED (contribute nothing); passing controls -> counted.
# --------------------------------------------------------------------------- #


def test_d_control_gate_failing_rater_discards_all_target_judgments():
    prep = _prep_for()
    packet = prep["tier3_packet"]
    # Rater A passes controls; rater B FAILS the gate-strength controls.
    rater_a = _make_rater(target_role="gate-strength", support="confirmed")
    rater_b_fail = _make_rater(target_role="gate-strength", support="confirmed", pass_gate=False)

    # Compose via the module's dispatch by alternating the two raters through one
    # rater_fn keyed on rater_id.
    def rater_fn(rid, stage, view):
        return (rater_a if rid == "A" else rater_b_fail)(rid, stage, view)

    res = _dispatch_two_stage_packet(
        packet, prep["item_span_map"], prep["full_transcript"], rater_fn, None
    )
    assert res["control_gates"]["A"]["passed"] is True
    assert res["control_gates"]["B"]["passed"] is False
    assert res["both_control_gates_passed"] is False
    # verdicts still ASSEMBLED but all carry control_gate_passed=False...
    assert res["tier3_verdicts"] and all(v.control_gate_passed is False for v in res["tier3_verdicts"])
    # ...so the frozen assembler DROPS them: every fall-through stays unresolved.
    cert = _pc.finalize_certificate(
        prep, res["tier3_verdicts"], tier3_support=res["tier3_support"],
        conflation_verdict="PASS", enumeration_consistency_verdict="PASS",
    )
    assert all(c.get("classifying_tier") != 3 for c in cert["conditions"])


def test_d_control_gate_passing_raters_classify_tier3():
    prep = _prep_for()
    rater_fn = _make_rater(target_role="gate-strength", support="confirmed")
    res = _dispatch_two_stage_packet(
        prep["tier3_packet"], prep["item_span_map"], prep["full_transcript"], rater_fn, None
    )
    assert res["both_control_gates_passed"] is True
    assert all(v.control_gate_passed is True for v in res["tier3_verdicts"])
    cert = _pc.finalize_certificate(
        prep, res["tier3_verdicts"], tier3_support=res["tier3_support"],
        conflation_verdict="PASS", enumeration_consistency_verdict="PASS",
    )
    tier3 = [c for c in cert["conditions"] if c.get("classifying_tier") == 3]
    assert len(tier3) == len(prep["item_span_map"])  # all fall-throughs classified


# --------------------------------------------------------------------------- #
# (d) a `denied` Stage-2 support verdict DOWNGRADES the condition through to the
#     certificate.
# --------------------------------------------------------------------------- #


def test_d_denied_support_downgrades_condition_through_certificate(tmp_path):
    """Full stage: raters pass controls + agree the role (classify tier-3) but
    DENY the Stage-2 support -> every classified condition is downgraded
    (classifying_tier None, adjudication_verdict.support 'denied') and the
    certificate's pilot/certificate grade -> False."""
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidDG", [("vidDG__s0", _real_strategy())])
    cert_stage = run_panels_and_certify_stage(
        _extraction_result([path]), mode="sealed",
        live_panel_fn=lambda cid, s, v: {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True},
    )
    deny_rater = _make_rater(target_role="gate-strength", support="denied")
    rl = run_rater_layer_stage(
        cert_stage, mode="sealed", rater_fn=deny_rater,
        propose_fn=_pc._synthetic_dry_run_propose_fn, extraction_result=_extraction_result([path]),
    )
    row = rl["rater_verdicts"][0]
    assert row["dispatched"] is True
    cert = row["adjudicated_certificate"]
    assert cert["pilot_grade"] is False
    assert cert["certificate_grade"] is False
    tier3 = [c for c in cert["conditions"] if c.get("classifying_tier") == 3]
    assert tier3 == []  # all downgraded off tier-3
    denied = [c for c in cert["conditions"] if (c.get("adjudication_verdict") or {}).get("support") == "denied"]
    assert denied, "denied support stamped on the certificate condition entries"


def test_d_confirmed_support_leaves_condition_classified(tmp_path):
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidOK", [("vidOK__s0", _real_strategy())])
    cert_stage = run_panels_and_certify_stage(
        _extraction_result([path]), mode="sealed",
        live_panel_fn=lambda cid, s, v: {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True},
    )
    ok_rater = _make_rater(target_role="gate-strength", support="confirmed")
    rl = run_rater_layer_stage(
        cert_stage, mode="sealed", rater_fn=ok_rater,
        propose_fn=_pc._synthetic_dry_run_propose_fn, extraction_result=_extraction_result([path]),
    )
    row = rl["rater_verdicts"][0]
    cert = row["adjudicated_certificate"]
    tier3 = [c for c in cert["conditions"] if c.get("classifying_tier") == 3]
    assert len(tier3) == row["n_fallthrough_targets"]
    assert tier3  # at least one fall-through classified + confirmed
    assert all((c.get("adjudication_verdict") or {}).get("support") == "confirmed" for c in tier3)


# --------------------------------------------------------------------------- #
# (e) compose-order: rater layer UNREACHABLE unless C produced certificates (and
#     A/B upstream).
# --------------------------------------------------------------------------- #


def test_d_unreachable_without_ready_certificates():
    # not-ready cert stage
    with pytest.raises(RaterLayerNotReady):
        run_rater_layer_stage(
            {"stage": "panels_and_certificate", "ready": False, "certificates": []},
            mode="staging", extraction_result={"ready": True, "artifact_paths": ["x"]},
        )
    # ready but ZERO certificates
    with pytest.raises(RaterLayerNotReady):
        run_rater_layer_stage(
            {"stage": "panels_and_certificate", "ready": True, "certificates": []},
            mode="staging", extraction_result={"ready": True, "artifact_paths": ["x"]},
        )
    # certificates present but the extraction (Module B) is missing.
    with pytest.raises(RaterLayerNotReady):
        run_rater_layer_stage(
            {"stage": "panels_and_certificate", "ready": True, "certificates": [{"cid": "z"}]},
            mode="staging", extraction_result=None,
        )


def test_d_gate_deny_short_circuits_rater_layer(tmp_path):
    """run_with_raters in sealed mode with NO SEAL-GO.token: gate refuses ->
    rater_layer None, rater_fn NEVER called (Module D structurally unreachable)."""
    rater_calls = []

    def spy_rater(rid, stage, view):
        rater_calls.append((rid, stage))
        return {}

    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS)
    res = SealedReadDriver().run_with_raters(
        manifest, "sealed", str(tmp_path / "out"),
        token_path=str(tmp_path / "NO-SEAL-GO.token"),
        live_extract_fn=lambda v, m: {"video_id": v, "reader_identity": certified_reader_identity(), "strategies": []},
        live_panel_fn=lambda cid, s, v: {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True},
        rater_fn=spy_rater,
    )
    assert res["ok"] is False
    assert res["rater_layer"] is None
    assert res["stage"] == "seal_gate"
    assert rater_calls == []


# --------------------------------------------------------------------------- #
# (f) sealed mode injected fake rater_fn -> called (no real key); rehearsal
#     deterministic (no rater_fn needed).
# --------------------------------------------------------------------------- #


def test_d_sealed_calls_injected_rater_fn_no_key(tmp_path):
    path = _write_extraction_artifact(str(tmp_path / "out"), "vidSR", [("vidSR__s0", _real_strategy())])
    cert_stage = run_panels_and_certify_stage(
        _extraction_result([path]), mode="sealed",
        live_panel_fn=lambda cid, s, v: {"conflation": "PASS", "enumeration_consistency": "PASS", "completeness": True},
    )
    calls = []
    rater = _make_rater(target_role="gate-strength", support="confirmed", log=calls)
    rl = run_rater_layer_stage(
        cert_stage, mode="sealed", rater_fn=rater,
        propose_fn=_pc._synthetic_dry_run_propose_fn, extraction_result=_extraction_result([path]),
    )
    # both raters, both stages, invoked.
    assert {(rid, stage) for rid, stage, _ in calls} == {("A", "stage1"), ("A", "stage2"), ("B", "stage1"), ("B", "stage2")}
    assert rl["rater_verdicts"][0]["dispatched"] is True


def test_d_sealed_requires_rater_fn():
    with pytest.raises(ValueError):
        run_rater_layer_stage(
            {"stage": "panels_and_certificate", "ready": True, "certificates": [{"cid": "z"}]},
            mode="sealed", rater_fn=None, extraction_result={"ready": True, "artifact_paths": ["x"]},
        )


def test_d_rehearsal_deterministic_no_rater_fn(tmp_path):
    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), ["2DXQqwKSwJE"])
    r1 = SealedReadDriver().run_with_raters(manifest, "staging", str(tmp_path / "o1"))
    r2 = SealedReadDriver().run_with_raters(manifest, "staging", str(tmp_path / "o2"))

    def _summary(res):
        return [
            (r["cid"], r["rater_layer_halted"], (r.get("adjudicated_certificate") or {}).get("pilot_grade"))
            for r in res["rater_layer"]["rater_verdicts"]
        ]

    assert _summary(r1) == _summary(r2)
    # dispatched rows carry an adjudicated certificate; halted rows do not.
    for r in r1["rater_layer"]["rater_verdicts"]:
        if r["rater_layer_halted"]:
            assert r["adjudicated_certificate"] is None
        else:
            assert r["adjudicated_certificate"] is not None
            assert r["both_control_gates_passed"] is True


# --------------------------------------------------------------------------- #
# (g) raters INDEPENDENT: rater A's answers do not influence rater B (no shared
#     mutable state; B's Stage-1 view carries none of A's answers).
# --------------------------------------------------------------------------- #


def test_d_raters_are_independent_no_shared_state():
    prep = _prep_for()
    calls = []
    rater = _make_rater(target_role="gate-strength", support="confirmed", log=calls)
    _dispatch_two_stage_packet(
        prep["tier3_packet"], prep["item_span_map"], prep["full_transcript"], rater, None
    )
    views = {(rid, stage): view for rid, stage, view in calls}
    a1 = views[("A", "stage1")]
    b1 = views[("B", "stage1")]
    # B's Stage-1 view is byte-identical to A's (the same blind packet) and
    # contains NEITHER 'rater_response' answers filled in NOR a stage2 block.
    assert json.dumps(a1, sort_keys=True, default=str) == json.dumps(b1, sort_keys=True, default=str)
    assert "stage2" not in b1
    # every rater_response in B's view is still the blank {role:None, notes:None}
    # -> A's committed roles never leaked into B's inputs.
    for section in b1.get("sections", []):
        for item in section.get("items", []):
            rr = item.get("rater_response")
            if isinstance(rr, dict):
                assert rr.get("role") is None and rr.get("notes") is None
    # A's Stage-2 view carries A's OWN committed stage1, never B's.
    a2 = views[("A", "stage2")]
    assert "committed_stage1" in a2 and "stage2" in a2


# =========================================================================== #
# MODULE E — VERDICT MATH (ratify-packet items 6-8) tests.
#
# Spec: docs/designs/h1-sealed12-driver-ratify-packet-2026-07-16.md (Module E) +
# ADVISOR-RULINGS R-015 items 6-8 / R-016.3 / R-021.3 / R-017 pin-2. No live
# LLM/network: verdict math is computed from Module D's persisted certificates.
# =========================================================================== #


def _d_row(cid, video_id, *, grade="CLEAN", halted=False, n_fallthrough=0, audit=False, content_clean=None):
    """A synthetic Module-D per-strategy rater-adjudicated row (the exact shape
    run_rater_layer_stage emits: terminal_read_grade + adjudication counts + the
    adjudicated certificate carrying the axis-3 audit monitor)."""
    row = {
        "cid": cid,
        "video_id": video_id,
        "strategy_index": int(cid.split("__s")[-1]) if "__s" in cid else 0,
        "rater_layer_halted": halted,
    }
    if halted:
        row["adjudicated_certificate"] = None
        return row
    row["dispatched"] = True
    row["n_fallthrough_targets"] = n_fallthrough
    row["terminal_read_grade"] = grade
    row["terminal_read_clean"] = grade == "CLEAN"
    row["adjudicated_certificate"] = {
        "terminal_read_grade": grade,
        "terminal_read_clean": grade == "CLEAN",
        "axis3_audit": {"item_id": f"{cid}-audit"} if audit else None,
    }
    if content_clean is not None:
        row["content_clean"] = content_clean
    return row


def _d_result(per_video, *, mode="rehearsal", ready=True):
    """A synthetic Module-D stage result carrying per-video rater verdicts —
    exactly what run_rater_layer_stage returns and run_verdict_stage consumes."""
    flat = [r for rows in per_video.values() for r in rows]
    return {
        "stage": "rater_layer",
        "module": "D",
        "mode": mode,
        "ready": ready,
        "n_strategies": len(flat),
        "rater_verdicts": flat,
        "per_video_rater_verdicts": per_video,
    }


def _valid_stamps():
    """A COMPLETE, verified validity-block instrument_stamps bundle: the certified
    reader identity (real prompt/enumerator SHAs + efa377d6 tag) from the frozen
    files, seal-verification ok, registration/engagement pre-checks ok, epoch."""
    ri = certified_reader_identity()
    return {
        "instrument_sha_stamps": {
            "reader_identity": ri,
            "frozen_scan_commit": "8a0fff65",
            "driver_commit": "8a0fff65",
        },
        "seal_verification": {"ok": True, "video_ids": ["a", "b"], "declared_sha256": "deadbeef"},
        "registration_pre_check": {"ok": True, "n_registered": 12},
        "engagement_pre_check": {"ok": True, "min_views": 1000},
        "epoch_read_once": {"epoch": "2026-07-16T00:00:00Z", "read_once": True},
    }


# --------------------------------------------------------------------------- #
# (a) ★ cert->video rollup: >=1 clean strategy => video CLEAN (R-017 pin-2).
# --------------------------------------------------------------------------- #


def test_e_rollup_mixed_video_one_clean_counts_clean():
    """A video with 2 strategies, EXACTLY ONE clean -> video CLEAN (>=1 rule);
    a video with 0 clean strategies -> NOT clean. Video-unit fraction correct."""
    per_video = {
        # exactly-one-clean video (R-017 pin-2): must roll up CLEAN.
        "VID_MIX": [
            _d_row("VID_MIX__s0", "VID_MIX", grade="CLEAN"),
            _d_row("VID_MIX__s1", "VID_MIX", grade="REJECTED"),
        ],
        # zero-clean video: must NOT be clean.
        "VID_BAD": [
            _d_row("VID_BAD__s0", "VID_BAD", grade="REJECTED"),
            _d_row("VID_BAD__s1", "VID_BAD", grade="INDETERMINATE"),
        ],
    }
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    vu = res["video_unit"]
    per = {v["video_id"]: v for v in vu["per_video"]}
    assert per["VID_MIX"]["clean"] is True
    assert per["VID_MIX"]["n_clean_strategies"] == 1
    assert per["VID_BAD"]["clean"] is False
    assert per["VID_BAD"]["n_clean_strategies"] == 0
    # video-unit fraction = 1 clean / 2 videos = 0.5 (NOT the per-cert 1/4).
    assert vu["n_videos"] == 2
    assert vu["clean_videos"] == 1
    assert vu["video_clean_fraction"] == 0.5


def test_e_rollup_gates_on_structural_fence_not_pilot_grade():
    """Regression witness (grader F-1): a MERGE-SILENCED strategy has
    pilot_grade=True but terminal_read_grade=REJECTED (aggregate's docstring:
    pilot_grade True + terminal_read_clean False is exactly the merge-silenced
    shape the fence exists to catch). The video-unit rollup MUST gate on the
    STRUCTURAL fence -> this video is NOT clean. If a refactor ever swaps
    _row_is_clean to read pilot_grade, this test goes RED."""
    row = _d_row("MS__s0", "VID_MS", grade="REJECTED")
    # Inject the merge-silenced divergence: pilot_grade True on a REJECTED cert.
    row["adjudicated_certificate"]["pilot_grade"] = True
    row["adjudicated_certificate"]["full_grade"] = True
    per_video = {"VID_MS": [row]}
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    per = {v["video_id"]: v for v in res["video_unit"]["per_video"]}
    assert per["VID_MS"]["clean"] is False, "pilot_grade=True must NOT count as clean"
    assert per["VID_MS"]["n_clean_strategies"] == 0
    assert res["video_unit"]["video_clean_fraction"] == 0.0


def test_e_halted_strategy_is_not_clean():
    """A leak-scan HALTED strategy is fail-closed not-clean; a video with only a
    halted strategy is NOT clean."""
    per_video = {"VID_H": [_d_row("VID_H__s0", "VID_H", halted=True)]}
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    per = {v["video_id"]: v for v in res["video_unit"]["per_video"]}
    assert per["VID_H"]["clean"] is False
    assert res["video_unit"]["clean_videos"] == 0


# --------------------------------------------------------------------------- #
# (b) >=60% bar on the video-unit STRUCTURAL fraction.
# --------------------------------------------------------------------------- #


def _n_clean_videos(n_clean, n_total):
    per_video = {}
    for i in range(n_total):
        vid = f"V{i:02d}"
        grade = "CLEAN" if i < n_clean else "REJECTED"
        per_video[vid] = [_d_row(f"{vid}__s0", vid, grade=grade)]
    return per_video


def test_e_bar_8_of_12_meets_7_of_12_misses():
    """8/12 clean videos -> meets_bar True (0.6667 >= 0.60); 7/12 -> False
    (0.5833 < 0.60). Gated on the video-unit STRUCTURAL fraction."""
    pass_res = run_verdict_stage(_d_result(_n_clean_videos(8, 12)), _valid_stamps(), "rehearsal")
    assert pass_res["video_unit"]["video_clean_fraction"] == 0.6667
    assert pass_res["meets_bar"] is True
    assert pass_res["verdict"] == "FIDELITY_PASS"

    miss_res = run_verdict_stage(_d_result(_n_clean_videos(7, 12)), _valid_stamps(), "rehearsal")
    assert miss_res["video_unit"]["video_clean_fraction"] == 0.5833
    assert miss_res["meets_bar"] is False
    assert miss_res["verdict"] == "FIDELITY_MISS"
    assert VIDEO_CLEAN_BAR == 0.60


def test_e_dispatch_health_additive_reported_never_gating():
    """R-030 §2(c): the run-total format-retry count is ADDITIVE to the verdict —
    None -> absent (byte-unchanged); an int -> a REPORTED dispatch_health block. It
    NEVER moves the bar (a format-retry is throughput, not the fidelity read)."""
    per_video = _n_clean_videos(8, 12)
    base = run_verdict_stage(_d_result(per_video), _valid_stamps(), "sealed")
    assert "dispatch_health" not in base  # None default keeps the dict byte-unchanged
    withn = run_verdict_stage(
        _d_result(per_video), _valid_stamps(), "sealed", dispatch_retry_total=7
    )
    assert withn["dispatch_health"]["total_format_retries"] == 7
    # a pervasive-retry run and a zero-retry run reach the SAME structural verdict.
    zero = run_verdict_stage(
        _d_result(per_video), _valid_stamps(), "sealed", dispatch_retry_total=0
    )
    assert withn["meets_bar"] == base["meets_bar"] == zero["meets_bar"]
    assert withn["verdict"] == base["verdict"]
    assert zero["dispatch_health"]["total_format_retries"] == 0


# --------------------------------------------------------------------------- #
# (c) content NOT gated (R-021.3): content_clean=False still counts CLEAN.
# --------------------------------------------------------------------------- #


def test_e_content_false_does_not_gate_still_clean():
    """A video whose strategy is structurally CLEAN but content_clean=False still
    counts CLEAN (R-021.3 — content recorded, never gated); content recorded."""
    per_video = {
        "VID_C": [_d_row("VID_C__s0", "VID_C", grade="CLEAN", content_clean=False)],
    }
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    per = {v["video_id"]: v for v in res["video_unit"]["per_video"]}
    # structurally CLEAN despite content_clean=False (content did NOT gate).
    assert per["VID_C"]["clean"] is True
    assert res["meets_bar"] is True
    # content is RECORDED, never gated.
    content = res["content_axis_recorded"]
    assert content["content_clean_false"] == 1
    assert content["gated"] is False
    # the content scope line is present verbatim.
    assert "content axis measured at design-pool layer, RECORDED not gated on the twelve" in res["scope_lines"]


# --------------------------------------------------------------------------- #
# (d) economics: mean per-video aggregate; >15 flags ceiling (NOT a gate).
# --------------------------------------------------------------------------- #


def test_e_economics_mean_and_ceiling_flag_does_not_flip_meets_bar():
    """Mean per-video AGGREGATE adjudications is summed across a video's
    strategies then meaned over videos; >15 flags the ceiling as a MEASUREMENT,
    never flipping meets_bar."""
    per_video = {
        # aggregate = 10 (fallthrough) + 1 (audit) + 9 = 20 for this 2-strategy video.
        "VID_HI": [
            _d_row("VID_HI__s0", "VID_HI", grade="CLEAN", n_fallthrough=10, audit=True),
            _d_row("VID_HI__s1", "VID_HI", grade="REJECTED", n_fallthrough=9),
        ],
        # aggregate = 12 for this single-strategy video.
        "VID_LO": [_d_row("VID_LO__s0", "VID_LO", grade="CLEAN", n_fallthrough=12)],
    }
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    econ = res["economics"]
    assert econ["per_video_adjudications"] == {"VID_HI": 20, "VID_LO": 12}
    # mean = (20 + 12) / 2 = 16.0 > 15 ceiling -> flagged.
    assert econ["mean_per_video_aggregate_adjudications"] == 16.0
    assert econ["ceiling"] == ECONOMICS_CEILING == 15
    assert econ["ceiling_flag"] is True
    assert econ["gates_verdict"] is False
    # both videos clean -> fraction 1.0 -> meets_bar True DESPITE the ceiling flag.
    assert res["video_unit"]["video_clean_fraction"] == 1.0
    assert res["meets_bar"] is True
    assert res["verdict"] == "FIDELITY_PASS"


def test_e_economics_within_ceiling_not_flagged():
    per_video = {"V0": [_d_row("V0__s0", "V0", grade="CLEAN", n_fallthrough=5)]}
    res = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    assert res["economics"]["mean_per_video_aggregate_adjudications"] == 5.0
    assert res["economics"]["ceiling_flag"] is False


# --------------------------------------------------------------------------- #
# (e) validity block fail-closed: missing SHA stamp / seal record => INVALID.
# --------------------------------------------------------------------------- #


def test_e_missing_instrument_sha_stamp_invalid():
    """A missing instrument SHA stamp (no prompt_sha) => verdict INVALID, meets_bar
    None — fail-closed, never a silent pass, even on an all-clean rollup."""
    stamps = _valid_stamps()
    stamps["instrument_sha_stamps"]["reader_identity"].pop("prompt_sha")
    per_video = _n_clean_videos(12, 12)  # would otherwise be a PASS.
    res = run_verdict_stage(_d_result(per_video), stamps, "rehearsal")
    assert res["verdict"] == "INVALID"
    assert res["meets_bar"] is None
    assert res["ready"] is False
    assert res["validity"]["valid"] is False
    assert "instrument_sha_stamps" in res["validity"]["missing_or_unverified"]
    # the structural read is still recorded (would-have-been), but NOT the verdict.
    assert res["measured_meets_bar"] is True


def test_e_missing_seal_verification_invalid():
    stamps = _valid_stamps()
    stamps["seal_verification"] = None
    res = run_verdict_stage(_d_result(_n_clean_videos(12, 12)), stamps, "rehearsal")
    assert res["verdict"] == "INVALID"
    assert res["meets_bar"] is None
    assert "seal_verification" in res["validity"]["missing_or_unverified"]


def test_e_seal_verification_not_ok_invalid():
    """A PRESENT but tamper-failed seal-verification record (ok=False) => INVALID."""
    stamps = _valid_stamps()
    stamps["seal_verification"] = {"ok": False, "mismatch_reason": "sha_mismatch"}
    res = run_verdict_stage(_d_result(_n_clean_videos(12, 12)), stamps, "rehearsal")
    assert res["verdict"] == "INVALID"
    assert "seal_verification" in res["validity"]["missing_or_unverified"]


def test_e_all_valid_elements_pass_validity():
    res = run_verdict_stage(_d_result(_n_clean_videos(12, 12)), _valid_stamps(), "rehearsal")
    assert res["validity"]["valid"] is True
    assert res["validity"]["missing_or_unverified"] == []
    assert res["ready"] is True


# --------------------------------------------------------------------------- #
# (f) read-once determinism: same persisted certs => identical verdict twice.
# --------------------------------------------------------------------------- #


def test_e_read_once_deterministic():
    per_video = {
        "V1": [_d_row("V1__s0", "V1", grade="CLEAN", n_fallthrough=4, audit=True)],
        "V0": [_d_row("V0__s0", "V0", grade="REJECTED", n_fallthrough=7)],
    }
    a = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    b = run_verdict_stage(_d_result(per_video), _valid_stamps(), "rehearsal")
    assert json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)
    assert a["read_once"] is True


# --------------------------------------------------------------------------- #
# (g) scope lines carried VERBATIM on the verdict (item 8).
# --------------------------------------------------------------------------- #


def test_e_scope_lines_present_verbatim():
    res = run_verdict_stage(_d_result(_n_clean_videos(8, 12)), _valid_stamps(), "rehearsal")
    assert res["scope_lines"] == list(SCOPE_LINES)
    assert res["scope_lines"] == [
        "enumeration mis-packaging lower-bound 1/16 (design pool)",
        "variant re-promotion lower-bound 1/22 (axis armed at read)",
        "content axis measured at design-pool layer, RECORDED not gated on the twelve",
        "result scoped to corpus + instrument SHAs + snapshot",
    ]


# --------------------------------------------------------------------------- #
# (h) compose-order: verdict stage unreachable without D's certificates.
# --------------------------------------------------------------------------- #


def test_e_unreachable_without_ready_module_d():
    # a Module-C stage (not the rater layer) is refused.
    module_c_shape = {"stage": "panels_and_certificate", "module": "C", "ready": True}
    with pytest.raises(VerdictNotReady):
        run_verdict_stage(module_c_shape, _valid_stamps(), "rehearsal")
    # a not-ready Module-D stage is refused.
    with pytest.raises(VerdictNotReady):
        run_verdict_stage(_d_result(_n_clean_videos(1, 1), ready=False), _valid_stamps(), "rehearsal")
    # an empty per-video map is refused.
    with pytest.raises(VerdictNotReady):
        run_verdict_stage(_d_result({}), _valid_stamps(), "rehearsal")


def test_e_gate_deny_short_circuits_verdict(tmp_path):
    """sealed with NO SEAL-GO.token -> gate refuses -> Module E never reached."""
    res = SealedReadDriver().run_verdict(
        _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS),
        mode="sealed",
        out_dir=str(tmp_path / "out"),
        token_path=str(tmp_path / "NO-SEAL-GO.token"),
        live_extract_fn=lambda v, m: {"video_id": v, "strategies": []},
    )
    assert res["ok"] is False
    assert res["stage"] == "seal_gate"
    assert res["verdict"] is None


# --------------------------------------------------------------------------- #
# (i) END-TO-END full-dress: A->E over the 3 spent rehearsal videos + the
#     mixed-video >=1 rollup, through the REAL composed driver (no network).
# --------------------------------------------------------------------------- #


def test_e_full_compose_over_three_spent_videos(tmp_path):
    """run_verdict A->E over the 3 spent videos: instrument stamps assembled from
    the composed result, validity valid, video-unit rollup + economics + scope
    lines produced. All 3 spent videos have >=1 clean strategy -> fraction 1.0."""
    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS)
    res = SealedReadDriver().run_verdict(
        manifest,
        mode="staging",
        out_dir=str(tmp_path / "out"),
        registration_pre_check={"ok": True, "n_registered": 3},
        engagement_pre_check={"ok": True},
        frozen_scan_commit="8a0fff65",
        driver_commit="8a0fff65",
        epoch="2026-07-16T00:00:00Z",
    )
    assert res["ok"] is True
    assert res["stage"] == "verdict"
    verdict = res["verdict"]
    assert verdict["module"] == "E"
    assert verdict["validity"]["valid"] is True
    # the 3 spent videos each yield >=1 CLEAN strategy -> all clean, fraction 1.0.
    assert verdict["video_unit"]["n_videos"] == 3
    assert verdict["video_unit"]["clean_videos"] == 3
    assert verdict["video_unit"]["video_clean_fraction"] == 1.0
    assert verdict["meets_bar"] is True
    assert verdict["verdict"] == "FIDELITY_PASS"
    # economics recorded within the ~15 ceiling for the clean spent set.
    assert verdict["economics"]["ceiling"] == 15
    assert verdict["economics"]["gates_verdict"] is False
    # scope lines verbatim; instrument stamps carried the certified reader tag.
    assert verdict["scope_lines"] == list(SCOPE_LINES)
    ri = verdict["validity"]["elements"]["instrument_sha_stamps"]["value"]["reader_identity"]
    assert ri["source_refs"]["certified_reader_tag"] == "efa377d6"


def test_e_full_compose_missing_validity_input_is_invalid(tmp_path):
    """run_verdict without the injected registration/epoch validity inputs =>
    verdict INVALID (fail-closed) even though the rollup would pass — the seal-day
    conductor MUST supply them; a silent pass is structurally impossible."""
    manifest = _write_rehearsal_manifest(str(tmp_path / "m.json"), REHEARSAL_VIDEOS)
    res = SealedReadDriver().run_verdict(
        manifest, mode="staging", out_dir=str(tmp_path / "out"),
        # no registration/engagement/epoch/commits injected.
    )
    assert res["ok"] is True
    assert res["verdict"]["verdict"] == "INVALID"
    assert res["verdict"]["meets_bar"] is None
    assert set(res["verdict"]["validity"]["missing_or_unverified"]) >= {
        "registration_pre_check", "engagement_pre_check", "epoch_read_once", "instrument_sha_stamps",
    }


# =========================================================================== #
# MODULE F — FULL-DRESS REHEARSAL + INDEPENDENT RE-VERIFY + DRIFT GUARD
#   (ratify-packet items 7/10/11). THE CAPSTONE. Drives the REAL A->E driver over
#   the 3 spent videos, threads BOTH witnesses BOTH axes through the pipeline,
#   demonstrates mixed-video rollup, re-verifies, and guards drift. No live call.
# =========================================================================== #


def _spent_manifest(tmp_path):
    """A spent-video manifest listing exactly the 3 design-pool videos (what
    run_full_dress_rehearsal drives A->E)."""
    return _write_spent_rehearsal_manifest(
        str(tmp_path / "spent-rehearsal.json"), list(REHEARSAL_SPENT_VIDEOS)
    )


# --------------------------------------------------------------------------- #
# (a) ★ full-dress rehearsal A->E over the 3 spent videos: every stage exercised,
#     a verdict produced, rehearsal_pass computed.
# --------------------------------------------------------------------------- #


def test_f_full_dress_rehearsal_exercises_every_stage(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    receipts = rep["stage_receipts"]
    # EVERY stage provably exercised (a missing stage would leave exercised=False).
    for stage in ("gate", "extraction", "panels_and_certificate", "rater_layer", "verdict"):
        assert receipts[stage]["exercised"] is True, f"stage {stage} not exercised"
    assert receipts["all_exercised"] is True
    # the real A->E verdict over the 3 spent videos (each yields >=1 CLEAN -> 3/3).
    v = rep["verdict"]
    assert v["validity_valid"] is True
    assert v["verdict"] == "FIDELITY_PASS"
    assert v["video_unit"]["n_videos"] == 3
    assert v["video_unit"]["clean_videos"] == 3
    assert v["video_unit"]["video_clean_fraction"] == 1.0
    assert v["meets_bar"] is True
    assert v["scope_lines"] == list(SCOPE_LINES)
    # extraction stamped the certified reader tag; C produced 7 certificates.
    assert receipts["extraction"]["evidence"]["reader_tag"] == "efa377d6"
    assert receipts["panels_and_certificate"]["evidence"]["n_certificates"] == 7
    assert rep["rehearsal_pass"] is True
    assert rep["failures"] == []


def test_f_rehearsal_rejects_wrong_manifest(tmp_path):
    """The capstone drives the 3 spent design-pool videos; a manifest that is not
    those 3 fails closed (never silently rehearsed)."""
    wrong = _write_spent_rehearsal_manifest(
        str(tmp_path / "wrong.json"), ["2DXQqwKSwJE", "DLwVqcLRcfw"]  # only 2
    )
    with pytest.raises(RehearsalManifestMismatch):
        run_full_dress_rehearsal(wrong, mode="rehearsal", out_dir=str(tmp_path / "out"))


# --------------------------------------------------------------------------- #
# (b) ★ R5L890-FUSED witness -> conflation REJECT, reaches verdict not-clean.
# --------------------------------------------------------------------------- #


def test_f_fused_witness_conflation_reject_reaches_verdict_not_clean(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    fused = rep["witnesses"]["fused_conflation_axis"]
    assert fused["cid"] == FUSED_WITNESS_CID
    assert fused["axis"] == "conflation"
    # certificate REJECTED on the CONFLATION axis through the real C->D->E path.
    assert fused["conflation_disposition"] == "REJECT"
    assert fused["terminal_read_grade"] == "REJECTED"
    # reaches the verdict stage as not-clean.
    assert fused["reached_verdict"] is True
    assert fused["reached_verdict_not_clean"] is True
    assert fused["rejected_on_axis"] is True


# --------------------------------------------------------------------------- #
# (c) ★ IyF witness -> enum FAIL, not-clean (conflation axis isolated PASS).
# --------------------------------------------------------------------------- #


def test_f_iyf_witness_enum_reject_reaches_verdict_not_clean(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    iyf = rep["witnesses"]["iyf_enum_axis"]
    assert iyf["cid"] == IYF_WITNESS_CID
    assert iyf["axis"] == "enumeration_consistency"
    # conflation axis ISOLATED (PASS) while the enum axis ALONE fails -> REJECTED,
    # through the FULL A->E pipeline (not just the fence).
    assert iyf["conflation_disposition"] == "PASS"
    assert iyf["enum_disposition"] == "FAIL"
    assert iyf["terminal_read_grade"] == "REJECTED"
    assert iyf["reached_verdict"] is True
    assert iyf["reached_verdict_not_clean"] is True
    assert iyf["rejected_on_axis"] is True


# --------------------------------------------------------------------------- #
# (d) ★ mixed-video rollup end-to-end: >=2 strategies, exactly one clean -> CLEAN.
# --------------------------------------------------------------------------- #


def test_f_mixed_video_rollup_exactly_one_clean_counts_clean(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    mixed = rep["mixed_video_rollup"]
    assert mixed["available"] is True
    # constructed from REAL spent certs: 2 strategies, exactly ONE clean.
    assert mixed["n_strategies"] == 2
    assert mixed["n_clean_strategies"] == 1
    # the >=1 rule (R-017 pin-2) -> the video rolls up CLEAN through run_verdict_stage.
    assert mixed["rolls_up_clean"] is True


# --------------------------------------------------------------------------- #
# (e) independent re-verify: recompute-from-artifacts == first verdict.
# --------------------------------------------------------------------------- #


def test_f_independent_reverify_matches_first_verdict(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    rv = rep["independent_reverify"]
    # a full REPLAY of A->E reproduces the verdict (determinism), AND an independent
    # recompute of the fraction/bar from the persisted per-video rows matches.
    assert rv["replay_match"] is True
    assert rv["independent_recompute_match"] is True
    assert rv["recomputed_video_clean_fraction"] == rep["verdict"]["video_unit"]["video_clean_fraction"]
    assert rv["ok"] is True


# --------------------------------------------------------------------------- #
# (f) drift guard: identical SHAs -> ok; a changed instrument SHA -> drifted=True.
# --------------------------------------------------------------------------- #


def test_f_drift_guard_identical_ok_changed_flags_drift():
    shas = rehearsal_instrument_shas(driver_commit="abc123", frozen_scan_commit="def456")
    # identical green vs read-day -> ok, no drift, witness re-run NOT required.
    same = rehearsal_drift_guard(shas, shas)
    assert same["ok"] is True
    assert same["drifted"] is False
    assert same["drifted_surfaces"] == []
    assert same["witness_rerun_required"] is False
    # flip ONE instrument-surface SHA (the certified reader prompt) -> drift flagged.
    mutated = dict(shas)
    mutated["frontier_prompt_sha"] = "CHANGED-" + str(mutated["frontier_prompt_sha"])
    changed = rehearsal_drift_guard(shas, mutated)
    assert changed["drifted"] is True
    assert changed["ok"] is False
    assert "frontier_prompt_sha" in changed["drifted_surfaces"]
    # a changed SHA MANDATES re-running the witness pair before the seal breaks.
    assert changed["witness_rerun_required"] is True


def test_f_drift_guard_dropped_surface_is_drift():
    """Fail-closed: a surface present at green but ABSENT at read-day (a dropped /
    renamed instrument) counts as drift, never a silent match."""
    shas = rehearsal_instrument_shas(driver_commit="abc123", frozen_scan_commit="def456")
    dropped = dict(shas)
    del dropped["enumerator_prompt_sha"]
    res = rehearsal_drift_guard(shas, dropped)
    assert res["drifted"] is True
    assert "enumerator_prompt_sha" in res["drifted_surfaces"]


def test_f_rehearsal_report_carries_both_drift_polarities(tmp_path):
    """The rehearsal report itself demonstrates BOTH drift polarities (non-vacuous):
    green==read-day is ok, and a changed-SHA negative probe flags drift."""
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    drift = rep["drift_guard"]
    assert drift["green_vs_read_day_identical"]["ok"] is True
    assert drift["green_vs_read_day_identical"]["drifted"] is False
    assert drift["negative_probe_changed_sha"]["drifted"] is True
    assert drift["negative_probe_changed_sha"]["ok"] is False
    assert drift["ok"] is True


# --------------------------------------------------------------------------- #
# (g) NO live call in the rehearsal path: spies threaded through every stage
#     must NEVER fire (the deterministic rehearsal uses cached inputs only).
# --------------------------------------------------------------------------- #


def test_f_no_live_call_in_rehearsal(tmp_path):
    rep = run_full_dress_rehearsal(
        _spent_manifest(tmp_path), mode="rehearsal", out_dir=str(tmp_path / "out")
    )
    guard = rep["live_call_guard"]
    assert guard["no_live_call"] is True
    assert guard["live_extract_calls"] == 0
    assert guard["live_panel_calls"] == 0
    assert guard["rater_calls"] == 0
    assert guard["violations"] == []


def test_f_rehearsal_refuses_sealed_mode(tmp_path):
    """A full-dress rehearsal is a rehearsal/staging run by construction — the
    sealed read is NEVER a rehearsal (fail-closed on mode='sealed')."""
    with pytest.raises(ValueError):
        run_full_dress_rehearsal(_spent_manifest(tmp_path), mode="sealed", out_dir=str(tmp_path / "o"))


def test_f_rehearsal_is_deterministic(tmp_path):
    """Two independent full-dress rehearsals produce the identical verdict + witness
    dispositions + mixed rollup (deterministic, replayable)."""
    a = run_full_dress_rehearsal(_spent_manifest(tmp_path), out_dir=str(tmp_path / "a"))
    b = run_full_dress_rehearsal(_spent_manifest(tmp_path), out_dir=str(tmp_path / "b"))
    assert a["verdict"]["video_unit"]["video_clean_fraction"] == b["verdict"]["video_unit"]["video_clean_fraction"]
    assert a["verdict"]["verdict"] == b["verdict"]["verdict"]
    assert a["witnesses"]["iyf_enum_axis"]["enum_disposition"] == b["witnesses"]["iyf_enum_axis"]["enum_disposition"]
    assert a["witnesses"]["fused_conflation_axis"]["conflation_disposition"] == b["witnesses"]["fused_conflation_axis"]["conflation_disposition"]
    assert a["mixed_video_rollup"]["rolls_up_clean"] == b["mixed_video_rollup"]["rolls_up_clean"]
    assert a["rehearsal_pass"] == b["rehearsal_pass"] is True


def test_f_stage_receipt_is_derived_not_hardcoded():
    """Regression witness (grader F-1, CRITICAL): the per-stage `exercised` receipt
    -- the mechanism proving 'no faked stage' -- MUST be derived from each stage's
    real output marker, never hardcoded. A composed A->E result MISSING a stage's
    marker => that stage exercised=False => all_exercised=False. If a refactor ever
    hardcodes exercised=True, this goes RED (the gap that shipped a false 'clean')."""
    from src.engine.extraction.sealed_read_driver import _stage_receipts

    valid = {
        "gate": {"allowed": True, "verified": True, "record": {"verify": {"video_ids": ["v1"]}}},
        "extraction": {
            "ready": True, "artifact_paths": ["a.json"],
            "reader_identity": {"source_refs": {"certified_reader_tag": "efa377d6"}},
        },
        "panels": {"module": "C", "certificates": [{}]},
        "rater_layer": {"module": "D", "rater_verdicts": [{}], "n_halted": 0},
        "verdict": {"module": "E", "verdict": "FIDELITY_PASS", "validity": {"valid": True}},
    }
    r = _stage_receipts(valid)
    assert r["all_exercised"] is True
    for s in r["stages"]:
        assert r[s]["exercised"] is True, s

    # Each stage's real marker removed in turn -> exercised False -> all_exercised False.
    negatives = {
        "gate": {**valid, "gate": {"allowed": False}},
        "extraction": {**valid, "extraction": {"ready": False, "artifact_paths": []}},
        "panels_and_certificate": {**valid, "panels": {"certificates": [{}]}},  # no module=="C"
        "rater_layer": {**valid, "rater_layer": {"rater_verdicts": [{}]}},       # no module=="D"
        "verdict": {**valid, "verdict": {"verdict": "FIDELITY_PASS"}},           # no module=="E"
    }
    for stage_key, composed in negatives.items():
        rr = _stage_receipts(composed)
        assert rr[stage_key]["exercised"] is False, f"{stage_key} should be un-exercised"
        assert rr["all_exercised"] is False, f"all_exercised must fail when {stage_key} is missing"
