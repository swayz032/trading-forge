"""Tests for the CLI `plan` stage (stage-0) + the SOURCE-ATTRITION rule — ADVISOR-
RULINGS R-028.1/.3.

The `plan` stage runs Module A first, FETCHES each transcript by video_id (via the
discovered production bridge — mocked network-free here), records per-video FETCH
EVIDENCE, partitions the sealed set into READABLE / UNREADABLE-AT-SOURCE / LOCAL-HALT
(attrition), and EMITS the complete per-dispatch instruction set (``dispatch_plan.json``
+ ``source_attrition.json``). The SOURCE-ATTRITION rule excludes an unreadable video
from BOTH numerator and denominator of the >=60% bar (Option-R), enforces the
readable-N >= 9 floor (else INDETERMINATE_SOURCE_ATTRITION -> escalate), and reports a
worst-case sensitivity line.

Coverage:
  (a) plan emits a well-formed dispatch_plan.json (per Phase-A draw: prompt/transcript/
      output paths + model-flagged `claude -p` template + schema; NO hardcoded model/sha).
  (b) ★ ATTRITION num+denom: 12-set, 2 unfetchable -> readable-N=10 (>=9) proceeds, bar
      on 10; 4 unfetchable -> readable-N=8 (<9) -> INDETERMINATE_SOURCE_ATTRITION escalate.
  (c) worst-case sensitivity: passes readable-only but FLIPS not-clean -> both lines; a
      robust case survives.
  (d) hash-mismatch: source-side evidence -> attrition (excluded); local-side -> HALT.
  (e) rehearsal/staging byte-unchanged (source_attrition None -> verdict dict identical).
  (f) end-to-end: plan -> fake-fulfilled phase_a -> certify -> verdict with the attrition-
      aware denominator (unreadable videos excluded from the read AND the bar).

NO live LLM / network: the transcript fetch is a stub; the anchor-locator PROPOSE leg is
the synthetic network-free stub; extract/panel/rater seams are file readers. Each test
owns a TEMP token (the real operator SEAL-GO.token is never touched).
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import sys

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_CLI_PATH = os.path.join(_ROOT, "scripts", "h1_seal_conductor_cli.py")
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
_spec = importlib.util.spec_from_file_location("h1_seal_conductor_cli", _CLI_PATH)
cli = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cli)

from src.engine.extraction import anchor_locator  # noqa: E402
from src.engine.extraction.pilot_conveyor import (  # noqa: E402
    _synthetic_dry_run_propose_fn,
)
from src.engine.extraction.sealed_read_driver import (  # noqa: E402
    INDETERMINATE_SOURCE_ATTRITION,
    READABLE_N_FLOOR,
    VIDEO_CLEAN_BAR,
    certified_reader_identity,
    classify_source_attrition,
    run_verdict_stage,
)

# --------------------------------------------------------------------------- #
# Fixtures.
# --------------------------------------------------------------------------- #


@pytest.fixture
def no_live_locator(monkeypatch):
    def _boom(*_a, **_k):  # pragma: no cover - firing IS the failure
        raise AssertionError("LIVE-CALL VIOLATION: real gemma locator reached in a test")

    monkeypatch.setattr(anchor_locator, "_default_propose_fn", _boom)


def _temp_token(tmp_path) -> str:
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO (temp, test-owned)")
    return token


def _manifest(tmp_path, video_ids: list[str], *, sealed_hashes: dict | None = None) -> str:
    ids = sorted(video_ids)
    payload = "\n".join(ids).encode("utf-8")
    videos = []
    for v in ids:
        rec = {"video_id": v}
        if sealed_hashes and v in sealed_hashes:
            rec["transcript_content_sha256"] = sealed_hashes[v]
        videos.append(rec)
    manifest = {
        "sealed_sha256": hashlib.sha256(payload).hexdigest(),
        "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
        "videos": videos,
    }
    p = str(tmp_path / "small-sealed-manifest.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return p


def _fake_fetch(fetchable: set, *, content: dict | None = None):
    """A network-free fetch stub. ``fetchable`` = ids that succeed; ``content`` maps a
    video_id -> transcript text (defaults to a per-id filler >200 chars)."""
    content = content or {}

    def fn(video_id):
        if video_id not in fetchable:
            return {"fetched": False, "char_count": None, "content_hash": None,
                    "transcript": None, "final_outcome": "all_failed", "error": "not found"}
        text = content.get(video_id) or (f"strategy transcript for {video_id}. " * 20)
        return {
            "fetched": True,
            "char_count": len(text),
            "content_hash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "transcript": text,
            "final_outcome": "captioned_succeeded",
            "error": None,
        }

    return fn


def _vids(n: int) -> list[str]:
    return [f"FAKEVID{i:02d}" for i in range(n)]


# =========================================================================== #
# (a) plan emits a well-formed dispatch_plan.json.
# =========================================================================== #


def test_a_plan_emits_wellformed_dispatch_plan(tmp_path):
    ids = _vids(12)
    manifest = _manifest(tmp_path, ids)
    token = _temp_token(tmp_path)
    wd = str(tmp_path / "workdir")
    os.makedirs(wd, exist_ok=True)

    code, text = cli.run_stage_plan(
        wd, manifest_path=manifest, token_path=token, fetch_fn=_fake_fetch(set(ids))
    )
    assert code == 0, text
    assert "STAGE plan EMITTED" in text

    plan = json.load(open(cli._emit_path(wd, cli._PLAN_EMIT), encoding="utf-8"))
    ri = certified_reader_identity()
    # reader identity threaded (values read from the frozen record, not invented).
    assert plan["reader_identity"]["model_id"] == ri["model_id"]
    assert plan["dispatch_record_template"]["requested_model"] == ri["model_id"]
    assert plan["dispatch_record_template"]["channel_class"] == ri["channel_class"]

    draws = plan["phase_a_dispatches"]
    assert len(draws) == 12 * ri["k"]  # k blind Phase-A draws per readable video
    d0 = next(d for d in draws if d["video_id"] == ids[0] and d["draw_index"] == 0)
    # R-028.4 finding #2: paths are OS-correct ABSOLUTE (never relative / `/tmp/…`).
    wd_abs = os.path.abspath(wd).replace(os.sep, "/")
    assert d0["output_path"] == f"{wd_abs}/phase_a/{ids[0]}/draw_0.json"
    assert os.path.isabs(d0["output_path"].replace("/", os.sep)) and "/tmp/" not in d0["output_path"]
    # R-030 §2/§3: the plan emits ONE dispatch command per draw — the CLI-OWNED blind
    # dispatch. NO conductor-run `claude -p`, NO `--allowedTools`, NO `> raw` redirect,
    # NO separate wrap step (all folded into the CLI). The subagent gets NO tools.
    cmd = d0["dispatch_command"]
    assert cmd.startswith("python ") and "--dispatch phase_a" in cmd
    assert f"--video-id {ids[0]}" in cmd and "--draw-index 0" in cmd
    assert f"--work-dir {wd_abs}" in cmd
    # the OLD leaky surfaces are GONE from the emitted plan (blindness fix, R-030 §3).
    assert "claude_p_template" not in d0 and "wrap_command" not in d0
    assert "--allowedTools" not in cmd and "allowedTools Read" not in json.dumps(plan)
    assert "raw_output_path" not in d0
    assert plan["wrapper_version"] == cli._WRAPPER_VERSION
    # the model emits the RAW extraction; the CLI-owned wrap produces the ingested draw.
    assert set(d0["expected_raw_schema"]) == {"strategies", "enumeration_note"}
    assert set(d0["expected_schema"]) == {"count", "strategy_refs", "reader_identity", "dispatch_record"}
    # Phase-B + rater later-seam shapes ALSO emit no-tools dispatch commands (swept).
    pb = plan["later_seam_instruction_shapes"]["phase_b"]
    assert "--dispatch phase_b" in pb["dispatch_command_template"]
    assert "claude_p_template" not in pb and "--allowedTools" not in pb["dispatch_command_template"]
    rt = plan["later_seam_instruction_shapes"]["rater"]
    # R-031 §2: TWO stage-scoped rater dispatch commands per rater (stage1 then stage2).
    rtc = rt["dispatch_command_templates"]
    assert "--dispatch rater" in rtc["stage1"] and "--rater-stage stage1" in rtc["stage1"]
    assert "--rater-stage stage2" in rtc["stage2"] and "--rater-id" in rtc["stage1"]
    assert "--allowedTools" not in rtc["stage1"]

    # later-seam instruction shapes present (single source of "how to dispatch").
    shapes = plan["later_seam_instruction_shapes"]
    assert set(shapes["phase_b"]["expected_raw_schema"]) == {
        "strategies", "instrument_classification", "rejected_strategies", "coaching_notes"
    }
    assert set(shapes) == {"phase_b", "panel", "rater"}
    # the panel seam is the cross-vendor gpt-5.4 path — explicitly NOT a no-tools claude seam.
    assert "dispatch_command_template" not in shapes["panel"]

    # transcripts fetched to disk (the CLI embeds them; conductor never opens them).
    assert os.path.exists(os.path.join(wd, "transcripts", f"{ids[0]}.txt"))

    # ★ NO hardcoded model id / prompt sha in the CLI or driver source.
    for src in (
        os.path.join(_ROOT, "scripts", "h1_seal_conductor_cli.py"),
        os.path.join(_ROOT, "src", "engine", "extraction", "sealed_read_driver.py"),
    ):
        body = open(src, encoding="utf-8").read()
        assert ri["model_id"] not in body, f"model id hardcoded in {src}"
        assert ri["prompt_sha"] not in body and ri["enumerator_sha"] not in body


def test_a_plan_rerun_reuses_fetched_transcripts_no_refetch(tmp_path):
    """Read-once: a second `plan` run REUSES the on-disk transcripts (a re-fetch must
    not silently change the readable set) — the second fetch_fn would explode if called."""
    ids = _vids(10)
    manifest = _manifest(tmp_path, ids)
    token = _temp_token(tmp_path)
    wd = str(tmp_path / "workdir")
    os.makedirs(wd, exist_ok=True)

    code, _ = cli.run_stage_plan(wd, manifest_path=manifest, token_path=token,
                                 fetch_fn=_fake_fetch(set(ids)))
    assert code == 0
    first = json.load(open(cli._emit_path(wd, cli._SOURCE_ATTRITION_EMIT), encoding="utf-8"))

    def _boom(_vid):  # pragma: no cover - firing IS the failure
        raise AssertionError("re-fetch VIOLATION: plan re-fetched an on-disk transcript")

    # _boom would explode if the second run re-fetched; it must reuse the on-disk files.
    code2, _ = cli.run_stage_plan(wd, manifest_path=manifest, token_path=token, fetch_fn=_boom)
    assert code2 == 0
    second = json.load(open(cli._emit_path(wd, cli._SOURCE_ATTRITION_EMIT), encoding="utf-8"))
    # The READABLE SET is identical across re-runs (a re-fetch never silently changes it).
    # (Only the per-video final_outcome label differs: fetched vs "reused_on_disk".)
    assert first["readable"] == second["readable"]
    assert first["readable_n"] == second["readable_n"] == 10
    assert first["unreadable_at_source"] == second["unreadable_at_source"] == []
    for vid in ids:
        assert second["fetch_evidence"][vid]["final_outcome"] == "reused_on_disk"


# =========================================================================== #
# (a2) R-028.4 — the RAW->DRAW wrap round-trips through the existing ingestion.
# =========================================================================== #


def _write_dispatch_record(wd: str) -> dict:
    ri = certified_reader_identity()
    dr = {
        "requested_model": ri["model_id"],
        "resolved_model": ri["model_id"],
        "channel_class": ri["channel_class"],
        "dispatch_mode": "headless",
    }
    with open(os.path.join(wd, "dispatch_record.json"), "w", encoding="utf-8") as fh:
        json.dump(dr, fh)
    return dr


def test_a2_wrap_phase_a_raw_ingests_and_identity_guard_passes(tmp_path):
    """A CANNED raw Phase-A extraction ({strategies, enumeration_note}) — WITHOUT the
    reader_identity/count/strategy_refs the ingestion asserts on — is WRAPPED by the
    CLI (adds reader_identity from the frozen record; synthesizes count/strategy_refs)
    into the draw artifact the EXISTING guard-bearing ingestion accepts with NO HALT."""
    from src.engine.extraction import sealed_read_driver as drv

    wd = str(tmp_path / "wd")
    vid = "FAKEVID00"
    os.makedirs(os.path.join(wd, "raw", "phase_a", vid), exist_ok=True)
    _write_dispatch_record(wd)
    # RAW model output — three strategies, NO identity/count/refs (what the model emits).
    raw = {"strategies": [{"name": "a"}, {"name": "b"}, {"name": "c"}],
           "enumeration_note": "three distinct skeletons"}
    raw_path = os.path.join(wd, "raw", "phase_a", vid, "draw_0.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        json.dump(raw, fh)

    code, msg = cli._wrap_dispatch_raw(wd, "phase_a", raw_path, vid, 0)
    assert code == 0, msg

    wrapped = json.load(open(os.path.join(wd, "phase_a", vid, "draw_0.json"), encoding="utf-8"))
    ri = certified_reader_identity()
    # identity ADDED from the frozen record (NOT invented / model self-reported).
    assert wrapped["reader_identity"]["model_id"] == ri["model_id"]
    assert wrapped["reader_identity"]["prompt_sha"] == ri["prompt_sha"]
    # count SYNTHESIZED from len(strategies); one deterministic ref per strategy.
    assert wrapped["count"] == 3
    assert wrapped["strategy_refs"] == [f"{vid}__s0", f"{vid}__s1", f"{vid}__s2"]
    # raw fields carried through; dispatch_record embedded from the conductor record.
    assert wrapped["enumeration_note"] == "three distinct skeletons"
    assert wrapped["dispatch_record"]["channel_class"] == ri["channel_class"]

    # The EXISTING guard-bearing ingestion accepts it — no ReaderIdentityMismatch HALT.
    pinned = ri
    dispatch_record = cli._load_dispatch_record(wd)
    draw_fn = cli._make_conductor_phase_a_draw_fn(wd)
    draws, counts = drv._collect_phase_a_draws(
        vid, {"video_ids": [vid]}, draw_fn, pinned, 1, dispatch_record
    )
    assert counts == [3]
    assert drv._draw_refs(draws[0]) == [f"{vid}__s0", f"{vid}__s1", f"{vid}__s2"]


def test_a2_wrap_phase_b_raw_ingests(tmp_path):
    """The Phase-B wrap carries the raw {strategies:[one], instrument_classification}
    through, adds reader_identity, and the per-strategy ingestion accepts it."""
    from src.engine.extraction import sealed_read_driver as drv

    wd = str(tmp_path / "wd")
    vid = "FAKEVID00"
    os.makedirs(os.path.join(wd, "raw", "phase_b"), exist_ok=True)
    _write_dispatch_record(wd)
    raw = {"strategies": [{"name": "only"}], "instrument_classification": {"kind": "futures"},
           "rejected_strategies": [], "coaching_notes": ["be patient"]}
    raw_path = os.path.join(wd, "raw", "phase_b", f"{vid}__s0.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        json.dump(raw, fh)

    code, msg = cli._wrap_dispatch_raw(wd, "phase_b", raw_path, vid, 0)
    assert code == 0, msg
    wrapped = json.load(open(os.path.join(wd, "phase_b", f"{vid}__s0.json"), encoding="utf-8"))
    assert wrapped["reader_identity"]["model_id"] == certified_reader_identity()["model_id"]
    assert wrapped["instrument_classification"] == {"kind": "futures"}

    pinned = certified_reader_identity()
    dispatch_record = cli._load_dispatch_record(wd)
    pb_fn = cli._make_conductor_phase_b_fn(wd)
    strategies, per_strategy, instrument = drv._dispatch_phase_b(
        vid, [f"{vid}__s0"], pb_fn, {"video_ids": [vid]}, pinned, dispatch_record
    )
    assert len(strategies) == 1 and instrument == {"kind": "futures"}


def test_a2_wrap_fence_wrapped_json_tolerated(tmp_path):
    """A raw the model wrapped in a ```json fence still parses + wraps (observed
    live: `claude -p` sometimes emits a code fence around the JSON)."""
    wd = str(tmp_path / "wd")
    vid = "FAKEVID00"
    os.makedirs(os.path.join(wd, "raw", "phase_a", vid), exist_ok=True)
    _write_dispatch_record(wd)
    raw_path = os.path.join(wd, "raw", "phase_a", vid, "draw_0.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        fh.write('```json\n{"strategies": [{"n": 1}], "enumeration_note": null}\n```\n')
    code, msg = cli._wrap_dispatch_raw(wd, "phase_a", raw_path, vid, 0)
    assert code == 0, msg
    wrapped = json.load(open(os.path.join(wd, "phase_a", vid, "draw_0.json"), encoding="utf-8"))
    assert wrapped["count"] == 1


def test_a2_wrap_raw_missing_strategies_halts(tmp_path):
    """A raw that is NOT the expected extraction schema (no `strategies` list) HALTs —
    the wrap never fabricates a draw."""
    wd = str(tmp_path / "wd")
    vid = "FAKEVID00"
    os.makedirs(os.path.join(wd, "raw", "phase_a", vid), exist_ok=True)
    raw_path = os.path.join(wd, "raw", "phase_a", vid, "draw_0.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        json.dump({"oops": "not an extraction"}, fh)
    code, msg = cli._wrap_dispatch_raw(wd, "phase_a", raw_path, vid, 0)
    assert code == 1 and "strategies" in msg
    assert not os.path.exists(os.path.join(wd, "phase_a", vid, "draw_0.json"))


# =========================================================================== #
# CRITICAL FIX (grader F-1): _load_raw_json must FAIL-CLOSED on prose-wrapped /
# ambiguous / example-bearing output — NEVER silently return a non-answer JSON.
# =========================================================================== #


def _write_raw(tmp_path, vid: str, text: str) -> str:
    wd = str(tmp_path / "wd")
    os.makedirs(os.path.join(wd, "raw", "phase_a", vid), exist_ok=True)
    raw_path = os.path.join(wd, "raw", "phase_a", vid, "draw_0.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return wd, raw_path


def test_f_example_in_preamble_then_prose_HALTS_not_silent_accept(tmp_path):
    """(f) The CRITICAL case: the model prints a schema EXAMPLE while EXPLAINING, with
    the real answer truncated/missing — a lone ``{…}`` wrapped in a "For example…"
    preamble + trailing prose. The old first-`{`…last-`}` slice would SILENTLY return
    the example; the strict parser HALTs (RawJsonNonCompliant), never silent-accepts."""
    vid = "FAKEVID00"
    raw = (
        "For example the format looks like "
        '{"strategies": [{"name": "EXAMPLE-not-the-answer"}], "enumeration_note": null}. '
        "Now I will re-read the transcript carefully and produce the real extraction."
    )
    wd, raw_path = _write_raw(tmp_path, vid, raw)
    # Direct parser: the non-compliant class, not a silent example return.
    with pytest.raises(cli.RawJsonNonCompliant):
        cli._load_raw_json(raw_path)
    # Through the wrap: HALT (code 1), distinct NON-COMPLIANT message, NO draw written.
    code, msg = cli._wrap_dispatch_raw(wd, "phase_a", raw_path, vid, 0)
    assert code == 1
    assert "NON-COMPLIANT" in msg and "clean JSON" in msg
    assert not os.path.exists(os.path.join(wd, "phase_a", vid, "draw_0.json"))


def test_f2_example_object_then_trailing_prose_HALTS(tmp_path):
    """(f2) A well-formed example object at the START, followed by prose (no preamble)
    — the trailing-prose guard REFUSES it (raw_decode leaves non-whitespace after the
    value). Never accept the leading span as the answer."""
    vid = "FAKEVID00"
    raw = (
        '{"strategies": [{"name": "EXAMPLE"}], "enumeration_note": null}\n\n'
        "That is just the schema shape — the real strategies follow once I finish reading."
    )
    wd, raw_path = _write_raw(tmp_path, vid, raw)
    with pytest.raises(cli.RawJsonNonCompliant):
        cli._load_raw_json(raw_path)
    code, msg = cli._wrap_dispatch_raw(wd, "phase_a", raw_path, vid, 0)
    assert code == 1 and "NON-COMPLIANT" in msg
    assert not os.path.exists(os.path.join(wd, "phase_a", vid, "draw_0.json"))


def test_f_clean_json_still_parses(tmp_path):
    """A strict, clean JSON object (the instructed output) parses with NO HALT."""
    vid = "FAKEVID00"
    _, raw_path = _write_raw(
        tmp_path, vid,
        '{"strategies": [{"name": "a"}, {"name": "b"}], "enumeration_note": null}\n',
    )
    parsed = cli._load_raw_json(raw_path)
    assert [s["name"] for s in parsed["strategies"]] == ["a", "b"]


def test_f_fenced_clean_json_still_parses(tmp_path):
    """A clean JSON wrapped in a ```json fence (the tiny tolerated budget) parses."""
    vid = "FAKEVID00"
    _, raw_path = _write_raw(
        tmp_path, vid,
        '```json\n{"strategies": [{"name": "only"}], "enumeration_note": null}\n```\n',
    )
    parsed = cli._load_raw_json(raw_path)
    assert parsed["strategies"] == [{"name": "only"}]


def test_f_prose_preamble_before_clean_json_HALTS_strict(tmp_path):
    """DECISION (explicit): a prose PREAMBLE before an otherwise-clean JSON HALTs —
    the parser is STRICT (no non-whitespace-prefix budget); the JSON must begin the
    output. This is what kills the (f) example-in-preamble class at the root."""
    vid = "FAKEVID00"
    _, raw_path = _write_raw(
        tmp_path, vid,
        'Here is the extraction you asked for:\n'
        '{"strategies": [{"name": "a"}], "enumeration_note": null}',
    )
    with pytest.raises(cli.RawJsonNonCompliant):
        cli._load_raw_json(raw_path)


def test_f_truly_malformed_HALTS(tmp_path):
    """A truly-malformed (unbalanced) raw still HALTs (RawJsonNonCompliant)."""
    vid = "FAKEVID00"
    _, raw_path = _write_raw(tmp_path, vid, '{"strategies": [ {"name": "a"} ')
    with pytest.raises(cli.RawJsonNonCompliant):
        cli._load_raw_json(raw_path)


def test_f_two_objects_ambiguous_HALTS(tmp_path):
    """Two concatenated JSON objects (ambiguous — which is the answer?) HALT rather
    than silently taking the first-`{`…last-`}` span."""
    vid = "FAKEVID00"
    _, raw_path = _write_raw(
        tmp_path, vid,
        '{"strategies": []}{"strategies": [{"name": "real"}]}',
    )
    with pytest.raises(cli.RawJsonNonCompliant):
        cli._load_raw_json(raw_path)


# =========================================================================== #
# Helpers for the verdict-math attrition tests (synthetic Module-D stage).
# =========================================================================== #


def _valid_instrument_stamps():
    ri = certified_reader_identity()
    return {
        "instrument_sha_stamps": {
            "reader_identity": ri,
            "frozen_scan_commit": "seal-frozen-scan",
            "driver_commit": "seal-driver",
        },
        "seal_verification": {"ok": True},
        "registration_pre_check": {"ok": True},
        "engagement_pre_check": {"ok": True},
        "epoch_read_once": {"epoch": "seal-epoch-0", "read_once": True},
    }


def _rows(vid: str, n_clean: int, n_total: int) -> list[dict]:
    return [
        {
            "cid": f"{vid}__s{j}",
            "terminal_read_grade": "CLEAN" if j < n_clean else "NOT_CLEAN",
            "rater_layer_halted": False,
        }
        for j in range(n_total)
    ]


def _stage(per_video: dict) -> dict:
    return {
        "module": "D",
        "stage": "rater_layer",
        "ready": True,
        "per_video_rater_verdicts": per_video,
    }


def _attrition(readable_n: int, unreadable_n: int):
    """Build a source_attrition record for (readable_n + unreadable_n) sealed videos and
    return (record, readable_ids)."""
    ids = _vids(readable_n + unreadable_n)
    fetchable = set(ids[:readable_n])
    ev = {}
    for vid in ids:
        if vid in fetchable:
            ev[vid] = {"fetched": True, "char_count": 100, "content_hash": None,
                       "sealed_content_hash": None, "anomaly_side": None}
        else:
            ev[vid] = {"fetched": False, "error": "not found"}
    return classify_source_attrition(ids, ev), ids[:readable_n]


# =========================================================================== #
# (b) ★ ATTRITION excludes from num+denom; readable-N floor.
# =========================================================================== #


def test_b_two_unfetchable_excluded_from_num_and_denom(tmp_path):
    # 10 readable + 2 unreadable = 12 sealed. 6 of 10 readable videos clean -> 0.6 >= bar.
    attrition, readable = _attrition(10, 2)
    assert attrition["readable_n"] == 10 and attrition["sealed_total"] == 12
    per_video = {}
    for i, vid in enumerate(readable):
        per_video[vid] = _rows(vid, n_clean=1 if i < 6 else 0, n_total=1)
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed",
                                source_attrition=attrition)
    # denominator is the READABLE 10 (unreadables never entered the pipeline / rollup).
    assert verdict["video_unit"]["n_videos"] == 10
    assert verdict["video_unit"]["clean_videos"] == 6
    assert verdict["verdict"] == "FIDELITY_PASS"
    block = verdict["source_attrition"]
    assert block["readable_n"] == 10 and block["sealed_total"] == 12
    assert block["adjusted_fraction"] == 0.6 and block["adjusted_meets_bar"] is True
    assert len(block["unreadable_at_source_ids"]) == 2
    assert any("UNREADABLE-AT-SOURCE excluded from num+denom" in s for s in verdict["scope_lines"])


def test_b_below_floor_is_indeterminate_escalate(tmp_path):
    # 8 readable + 4 unreadable = 12. readable-N 8 < floor 9 -> INDETERMINATE, no verdict.
    attrition, readable = _attrition(8, 4)
    assert attrition["readable_n"] == 8 and not attrition["meets_floor"]
    per_video = {vid: _rows(vid, n_clean=1, n_total=1) for vid in readable}  # all clean
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed",
                                source_attrition=attrition)
    assert verdict["verdict"] == INDETERMINATE_SOURCE_ATTRITION
    assert verdict["meets_bar"] is None and verdict["ready"] is False
    assert any("INDETERMINATE_SOURCE_ATTRITION" in s for s in verdict["scope_lines"])
    assert any(f"readable-N 8 < floor {READABLE_N_FLOOR}" in s for s in verdict["scope_lines"])


# =========================================================================== #
# (c) worst-case sensitivity: passes readable-only but FLIPS not-clean; robust case.
# =========================================================================== #


def test_c_worst_case_flips_reported(tmp_path):
    # 10 readable + 2 unreadable; 6/10 clean -> readable fraction 0.6 PASS, but worst-case
    # 6/12 = 0.5 < bar -> FLIPS. Both lines reported.
    attrition, readable = _attrition(10, 2)
    per_video = {vid: _rows(vid, n_clean=1 if i < 6 else 0, n_total=1)
                 for i, vid in enumerate(readable)}
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed",
                                source_attrition=attrition)
    block = verdict["source_attrition"]
    assert block["adjusted_meets_bar"] is True
    assert block["worst_case_fraction"] == 0.5
    assert block["worst_case_meets_bar"] is False and block["attrition_robust"] is False
    assert verdict["verdict"] == "FIDELITY_PASS"  # the read passes on the readable set
    assert any("FLIPS (fails under worst-case)" in s for s in verdict["scope_lines"])


def test_c_attrition_robust_survives(tmp_path):
    # 11 readable + 1 unreadable; 11/11 clean -> worst-case 11/12 = 0.9167 >= bar -> robust.
    attrition, readable = _attrition(11, 1)
    per_video = {vid: _rows(vid, n_clean=1, n_total=1) for vid in readable}
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed",
                                source_attrition=attrition)
    block = verdict["source_attrition"]
    assert block["worst_case_meets_bar"] is True and block["attrition_robust"] is True
    assert verdict["verdict"] == "FIDELITY_PASS"
    assert any("attrition-robust (still passes)" in s for s in verdict["scope_lines"])


# =========================================================================== #
# R-029 (grader item-3 coverage gap): the >=60% video-unit bar is an EXACT
# comparison — NO coarse rounding. A 5/9 boundary MISS must stay a MISS.
# =========================================================================== #


def test_r029_no_rounding_five_ninths_boundary_is_miss():
    """R-029 no-rounding regression: 5 of 9 videos clean -> 5/9 = 0.5556 EXACT, which
    is BELOW the 0.60 bar -> FIDELITY_MISS. Under a future COARSE-rounding regression
    (e.g. round(5/9, 1) == 0.6 >= 0.60) this would flip to FIDELITY_PASS — this test
    then goes RED. The bar must be an EXACT compare on the 4-dp fraction, never a
    coarse round that lifts a sub-60% read over the line. (No attrition -> the
    byte-unchanged verdict path; 9 videos, no unreadables.)"""
    per_video = {
        vid: _rows(vid, n_clean=1 if i < 5 else 0, n_total=1)
        for i, vid in enumerate(_vids(9))
    }
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed")
    vu = verdict["video_unit"]
    assert vu["clean_videos"] == 5 and vu["n_videos"] == 9
    # EXACT fraction — 5/9 to 4 dp, NEVER rounded up to the 0.60 bar.
    assert vu["video_clean_fraction"] == 0.5556
    assert vu["video_clean_fraction"] < VIDEO_CLEAN_BAR
    # Proof this guards a real regression: coarse rounding WOULD have crossed the bar.
    assert round(5 / 9, 1) >= VIDEO_CLEAN_BAR
    # ...but the exact read is a MISS, fail-closed on the sub-60% fraction.
    assert verdict["verdict"] == "FIDELITY_MISS"
    assert verdict["meets_bar"] is False
    assert verdict["measured_meets_bar"] is False


# =========================================================================== #
# (d) hash-mismatch: source-side -> attrition (excluded); local-side -> HALT.
# =========================================================================== #


def test_d_hash_mismatch_source_side_is_attrition(tmp_path):
    ids = _vids(12)
    ev = {}
    for i, vid in enumerate(ids):
        base = {"fetched": True, "char_count": 100, "sealed_content_hash": "SEALEDHASH"}
        if i == 0:
            # fetched but content hash != sealed AND source-side evidence -> attrition.
            ev[vid] = {**base, "content_hash": "DIFFERENTHASH", "anomaly_side": "source"}
        else:
            ev[vid] = {**base, "content_hash": "SEALEDHASH", "anomaly_side": None}
    attrition = classify_source_attrition(ids, ev)
    assert attrition["readable_n"] == 11
    assert not attrition["local_halt"]
    assert [u["video_id"] for u in attrition["unreadable_at_source"]] == [ids[0]]
    assert attrition["unreadable_at_source"][0]["reason"] == "hash_mismatch_source_side"


def test_d_hash_mismatch_local_side_is_halt(tmp_path):
    ids = _vids(12)
    ev = {}
    for i, vid in enumerate(ids):
        base = {"fetched": True, "char_count": 100, "sealed_content_hash": "SEALEDHASH"}
        if i == 0:
            # mismatch with NO source-side evidence (local anomaly) -> HALT, not attrition.
            ev[vid] = {**base, "content_hash": "DIFFERENTHASH", "anomaly_side": "local"}
        else:
            ev[vid] = {**base, "content_hash": "SEALEDHASH", "anomaly_side": None}
    attrition = classify_source_attrition(ids, ev)
    assert [h["video_id"] for h in attrition["local_halt"]] == [ids[0]]
    assert attrition["unreadable_at_source"] == []

    # a local_halt threaded into the verdict fails closed to INVALID (never attrition).
    readable = attrition["readable"]
    per_video = {vid: _rows(vid, 1, 1) for vid in readable}
    verdict = run_verdict_stage(_stage(per_video), _valid_instrument_stamps(), "sealed",
                                source_attrition=attrition)
    assert verdict["verdict"] == "INVALID" and verdict["meets_bar"] is None
    assert any("local-side anomaly" in s for s in verdict["scope_lines"])


def test_d_plan_stage_halts_on_local_anomaly(tmp_path):
    """Plan stage: a fetched transcript whose hash differs from the sealed record with
    NO source-side signal (default anomaly None) HALTs — never silently attrition."""
    ids = _vids(10)
    # sealed hash for id[0] that the fetched content will NOT match.
    manifest = _manifest(tmp_path, ids, sealed_hashes={ids[0]: "SEALED_HASH_DOES_NOT_MATCH"})
    token = _temp_token(tmp_path)
    wd = str(tmp_path / "workdir")
    os.makedirs(wd, exist_ok=True)
    code, text = cli.run_stage_plan(
        wd, manifest_path=manifest, token_path=token, fetch_fn=_fake_fetch(set(ids))
    )
    assert code != 0 and "HALT" in text
    assert "LOCAL anomaly" in text and ids[0] in text
    # fail-closed: no plan emitted.
    assert not os.path.exists(cli._emit_path(wd, cli._PLAN_EMIT))


# =========================================================================== #
# (e) rehearsal / staging byte-unchanged (source_attrition None).
# =========================================================================== #


def test_e_verdict_stage_none_attrition_is_byte_unchanged():
    per_video = {"V0": _rows("V0", 1, 1), "V1": _rows("V1", 0, 1)}
    stamps = _valid_instrument_stamps()
    with_none = run_verdict_stage(_stage(copy.deepcopy(per_video)), stamps, "sealed")
    # No attrition key, scope lines are exactly the frozen SCOPE_LINES (no extras).
    assert "source_attrition" not in with_none
    from src.engine.extraction.sealed_read_driver import SCOPE_LINES
    assert with_none["scope_lines"] == list(SCOPE_LINES)


def test_e_staging_cli_verdict_byte_identical(capsys):
    code1 = cli.main(["--mode", "staging"])
    out1 = capsys.readouterr().out
    code2 = cli.main(["--mode", "staging"])
    out2 = capsys.readouterr().out
    assert code1 == 0 and code2 == 0
    assert "FIDELITY_PASS" in out1

    def _strip(o):
        return "\n".join(ln for ln in o.splitlines() if not ln.startswith("(out_dir="))

    assert _strip(out1) == _strip(out2)


# =========================================================================== #
# (f) ★ END-TO-END: plan -> phase_a -> certify -> verdict with the attrition denom.
# =========================================================================== #


def _real_strategy() -> dict:
    import glob

    files = sorted(
        glob.glob(
            os.path.join(
                _ROOT, "docs", "replay-results", "h1-scripts",
                "claude-rung-designpool", "staging_v32", "*__s0.json",
            )
        )
    )
    with open(files[0], encoding="utf-8") as fh:
        return json.load(fh)["strategies"][0]


def _dispatch(ri: dict) -> dict:
    return {
        "requested_model": ri["model_id"],
        "resolved_model": ri["model_id"],
        "channel_class": ri["channel_class"],
        "dispatch_mode": "interactive",
    }


def _write_workdir_base(wd: str, *, dispatch: dict, n_registered: int) -> None:
    for sub in ("phase_a", "phase_b", "panels", "raters", "emit"):
        os.makedirs(os.path.join(wd, sub), exist_ok=True)
    with open(os.path.join(wd, "dispatch_record.json"), "w", encoding="utf-8") as fh:
        json.dump(dispatch, fh)
    with open(os.path.join(wd, "validity_inputs.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "registration_pre_check": {"ok": True, "n_registered": n_registered},
                "engagement_pre_check": {"ok": True},
                "frozen_scan_commit": "seal-frozen-scan",
                "driver_commit": "seal-driver",
                "epoch": "seal-epoch-0",
            },
            fh,
        )


def _write_phase_a_draws(wd, vid, *, ri, dispatch):
    pa_dir = os.path.join(wd, "phase_a", vid)
    os.makedirs(pa_dir, exist_ok=True)
    for i in range(ri["k"]):
        with open(os.path.join(pa_dir, f"draw_{i}.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {"reader_identity": ri, "dispatch_record": dispatch, "video_id": vid,
                 "draw_index": i, "count": 1, "strategy_refs": [f"{vid}__ref0"]},
                fh,
            )


def _write_phase_b(wd, cid, *, ri, dispatch):
    with open(os.path.join(wd, "phase_b", f"{cid}.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"reader_identity": ri, "dispatch_record": dispatch,
             "strategies": [_real_strategy()], "instrument_classification": None},
            fh,
        )


def _write_panels(wd, cid):
    with open(os.path.join(wd, "panels", f"{cid}.json"), "w", encoding="utf-8") as fh:
        json.dump({"conflation": "PASS", "enumeration_consistency": "PASS",
                   "completeness": {"content_clean": True}}, fh)


def _control_stage1():
    return {
        **{f"W1-{n:04d}": "gate-strength" for n in (1, 3, 5, 7, 9)},
        **{f"W1-{n:04d}": "context" for n in (2, 4, 6, 8, 10)},
    }


def _write_raters(wd, *, stage2=None):
    for rid in ("A", "B"):
        with open(os.path.join(wd, "raters", f"{rid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"stage1": _control_stage1(), "stage2": stage2 or {}}, fh)


def test_f_end_to_end_plan_to_verdict_attrition_denominator(tmp_path, no_live_locator):
    # 10 readable + 2 unreadable = 12 sealed. The pipeline reads ONLY the 10 readable;
    # the verdict denominator is 10, worst-case over 12.
    ids = _vids(12)
    readable = ids[:10]
    unreadable = ids[10:]
    manifest = _manifest(tmp_path, ids)
    token = _temp_token(tmp_path)
    ri = certified_reader_identity()
    dispatch = _dispatch(ri)
    wd = str(tmp_path / "workdir")
    _write_workdir_base(wd, dispatch=dispatch, n_registered=10)

    # STAGE plan: fetch (10 fetchable), emit attrition + dispatch plan.
    code, text = cli.run_stage_plan(
        wd, manifest_path=manifest, token_path=token, fetch_fn=_fake_fetch(set(readable))
    )
    assert code == 0, text
    sa = json.load(open(cli._emit_path(wd, cli._SOURCE_ATTRITION_EMIT), encoding="utf-8"))
    assert sa["readable_n"] == 10 and sorted(sa["readable"]) == sorted(readable)
    assert sorted(u["video_id"] for u in sa["unreadable_at_source"]) == sorted(unreadable)

    # Conductor fulfils Phase-A draws for the READABLE videos ONLY (unreadables have none).
    for vid in readable:
        _write_phase_a_draws(wd, vid, ri=ri, dispatch=dispatch)

    # STAGE phase_a: computes consensus over the readable set only (no HALT on the 2 unreadable).
    code, text = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    assert code == 0, text
    emit = json.load(open(cli._emit_path(wd, cli._PHASE_A_EMIT), encoding="utf-8"))
    assert sorted(emit["per_video"]) == sorted(readable)

    # Conductor fulfils one Phase-B per consensus strategy.
    for vid in readable:
        _write_phase_b(wd, f"{vid}__s0", ri=ri, dispatch=dispatch)

    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0, text
    for req in json.load(open(cli._emit_path(wd, cli._PANEL_REQ_EMIT), encoding="utf-8"))["requests"]:
        _write_panels(wd, req["cid"])
    _write_raters(wd)

    # STAGE verdict: attrition-aware denominator (10 readable), worst-case over 12.
    code, text = cli.run_stage_verdict(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert "TERMINAL-READ VERDICT" in text
    assert "reverify: MATCH" in text
    # the printed scope block carries the attrition + worst-case lines.
    assert "source-attrition: 10/12 videos readable" in text
    assert "worst-case sensitivity" in text
    # every readable video became a video-unit row (denominator = 10, not 12).
    assert "n_videos=10" in text

    # sanity: the driver read ONLY the readable set (no missing-artifact HALT despite 2 unreadable).
    assert "HALT" not in text
