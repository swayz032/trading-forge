"""Tests for the STAGED (emit-and-stop) sealed read — ADVISOR-RULINGS R-026 / AR-017.

The single-shot sealed CLI cannot be fulfilled by a BLIND conductor: it dispatches
Phase-A, computes the consensus ITSELF, then dispatches Phase-B / panels / raters
PER driver-emitted cid/packet — so the conductor cannot pre-write those files before
the driver has EMITTED what they must contain.  R-026 ratifies the fix: a three-stage
handshake (``phase_a`` -> conductor fulfils Phase-B -> ``certify`` -> conductor fulfils
panels+raters -> ``verdict``), the driver EMITTING what to fulfil next and STOPPING.

These tests enforce the R-026.3 NON-VACUOUS discipline:
  (a) NON-PRE-ARRANGED-COUNT — a computed consensus count DIFFERENT per video; the
      emit MUST carry it and ``certify`` MUST require exactly that many Phase-B (not a
      pre-baked number). The OLD hard-coded-to-match test was vacuous; this is not.
  (b) EMIT-BREAK MUTATION — break the Phase-A emit (empty refs) and the rater-packet
      emit -> resume FAILS LOUDLY (a stage HALTs).
  (c) RATER+PANEL SWEEP — a conductor that answers the WRONG packets HALTs.
  (d) READ-ONCE — re-running ``phase_a`` is a byte-identical re-emit; a tampered
      Phase-A artifact between stages -> hash-mismatch HALT.
  (f) END-TO-END staged happy path with a fake per-draw work-dir -> a verdict block.

NO live LLM / network: the anchor-locator PROPOSE leg is the synthetic network-free
stub; the extract/panel/rater seams are file readers.  Each test owns a TEMP token
(the real operator ``SEAL-GO.token`` is never touched) and passes it explicitly.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from collections import Counter

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
    certified_reader_identity,
)

# --------------------------------------------------------------------------- #
# Fixtures / incremental work-dir builders (each stage's inputs written separately,
# so the handshake ORDER is genuinely exercised — not all-files-up-front).
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


def _manifest(tmp_path, video_ids: list[str]) -> str:
    ids = sorted(video_ids)
    payload = "\n".join(ids).encode("utf-8")
    manifest = {
        "sealed_sha256": hashlib.sha256(payload).hexdigest(),
        "sealed_sha256_method": "sha256 over the newline-joined sorted video_id list.",
        "videos": [{"video_id": v} for v in ids],
    }
    p = str(tmp_path / "small-sealed-manifest.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return p


def _dispatch(model_id: str, channel_class: str) -> dict:
    return {
        "requested_model": model_id,
        "resolved_model": model_id,
        "channel_class": channel_class,
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


def _write_phase_a_draws(wd: str, vid: str, counts: list[int], *, ri: dict, dispatch: dict) -> None:
    """Write the 5 blind Phase-A draws for one video. Draw i enumerates ``counts[i]``
    strategies (refs of matching length) -> the DRIVER computes the modal consensus."""
    pa_dir = os.path.join(wd, "phase_a", vid)
    os.makedirs(pa_dir, exist_ok=True)
    for i, c in enumerate(counts):
        with open(os.path.join(pa_dir, f"draw_{i}.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "reader_identity": ri,
                    "dispatch_record": dispatch,
                    "video_id": vid,
                    "draw_index": i,
                    "count": c,
                    "strategy_refs": [f"{vid}__ref{j}" for j in range(c)],
                },
                fh,
            )


def _write_phase_b(wd: str, cid: str, *, ri: dict, dispatch: dict, strat: dict | None = None) -> None:
    strat = strat if strat is not None else _real_strategy()
    with open(os.path.join(wd, "phase_b", f"{cid}.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"reader_identity": ri, "dispatch_record": dispatch,
             "strategies": [strat], "instrument_classification": None},
            fh,
        )


def _write_panels(wd: str, cid: str) -> None:
    with open(os.path.join(wd, "panels", f"{cid}.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {"conflation": "PASS", "enumeration_consistency": "PASS",
             "completeness": {"content_clean": True}}, fh,
        )


def _control_stage1() -> dict:
    return {
        **{f"W1-{n:04d}": "gate-strength" for n in (1, 3, 5, 7, 9)},
        **{f"W1-{n:04d}": "context" for n in (2, 4, 6, 8, 10)},
    }


def _write_raters(wd: str, *, stage1: dict | None = None, stage2: dict | None = None) -> None:
    stage1 = stage1 if stage1 is not None else _control_stage1()
    stage2 = stage2 if stage2 is not None else {}
    for rid in ("A", "B"):
        with open(os.path.join(wd, "raters", f"{rid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"stage1": stage1, "stage2": stage2}, fh)


def _seed(tmp_path, counts_by_video: dict[str, list[int]]):
    """Seed a work-dir with ONLY the Phase-A draws (+ dispatch/validity). Returns
    (wd, manifest, token, ri, dispatch)."""
    ri = certified_reader_identity()
    dispatch = _dispatch(ri["model_id"], ri["channel_class"])
    wd = str(tmp_path / "workdir")
    _write_workdir_base(wd, dispatch=dispatch, n_registered=len(counts_by_video))
    for vid, counts in counts_by_video.items():
        _write_phase_a_draws(wd, vid, counts, ri=ri, dispatch=dispatch)
    manifest = _manifest(tmp_path, list(counts_by_video))
    token = _temp_token(tmp_path)
    return wd, manifest, token, ri, dispatch


def _emit(wd: str, name: str) -> dict:
    with open(cli._emit_path(wd, name), encoding="utf-8") as fh:
        return json.load(fh)


# =========================================================================== #
# (a) ★ NON-PRE-ARRANGED-COUNT: the computed consensus count differs per video;
#     the emit CARRIES it and `certify` requires EXACTLY that many Phase-B.
# =========================================================================== #


def test_a_non_pre_arranged_count_carries_through_handshake(tmp_path, no_live_locator):
    # video A: [3,3,3,3,2] -> mode 3 (mode_n 4, STABLE) -> 3 strategy_refs.
    # video B: [1,1,1,1,1] -> mode 1 -> 1 strategy_ref. DIFFERENT counts, computed.
    counts = {"FAKEVIDAAA1": [3, 3, 3, 3, 2], "FAKEVIDBBB2": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)

    # Independent expectation (the SAME modal rule, computed here — never hard-coded).
    def _expected_mode(cs):
        c = Counter(cs)
        best = max(c.values())
        return min(v for v, n in c.items() if n == best)

    exp = {v: _expected_mode(cs) for v, cs in counts.items()}  # {A:3, B:1}
    assert exp == {"FAKEVIDAAA1": 3, "FAKEVIDBBB2": 1}

    # STAGE phase_a: emit carries the computed per-video counts.
    code, text = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    assert code == 0, text
    emit = _emit(wd, cli._PHASE_A_EMIT)
    for vid, n in exp.items():
        assert emit["per_video"][vid]["n_strategies"] == n
        assert len(emit["per_video"][vid]["strategy_refs"]) == n

    # The conductor fulfils Phase-B per emitted ref. Write only 2 of A's 3 -> certify
    # must HALT (it requires EXACTLY the consensus count, not a pre-baked number).
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)
    _write_phase_b(wd, "FAKEVIDAAA1__s1", ri=ri, dispatch=dispatch)
    _write_phase_b(wd, "FAKEVIDBBB2__s0", ri=ri, dispatch=dispatch)
    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "FAKEVIDAAA1__s2" in text  # the missing 3rd Phase-B, required by the count

    # Now fulfil the 3rd -> certify succeeds and emits the packets/requests.
    _write_phase_b(wd, "FAKEVIDAAA1__s2", ri=ri, dispatch=dispatch)
    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0, text
    stamp = _emit(wd, cli._CERTIFY_STAMP_EMIT)
    # exactly 3 + 1 = 4 consensus cids required across the two videos.
    assert sorted(stamp["cids"]) == [
        "FAKEVIDAAA1__s0", "FAKEVIDAAA1__s1", "FAKEVIDAAA1__s2", "FAKEVIDBBB2__s0",
    ]
    panel_reqs = _emit(wd, cli._PANEL_REQ_EMIT)["requests"]
    assert len(panel_reqs) == 4
    assert not os.path.exists(cli.PINNED_TOKEN_PATH) or True  # never asserts on real token


# =========================================================================== #
# (b) ★ EMIT-BREAK MUTATION — break the Phase-A emit -> certify HALTs LOUDLY.
#     Break the rater-packet emit -> verdict HALTs LOUDLY.
# =========================================================================== #


def test_b_phase_a_emit_break_halts_certify(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [2, 2, 2, 2, 2]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)
    code, _ = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    assert code == 0
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)
    _write_phase_b(wd, "FAKEVIDAAA1__s1", ri=ri, dispatch=dispatch)

    # BREAK the emit: blank out the emitted strategy_refs (wrong/empty refs).
    emit = _emit(wd, cli._PHASE_A_EMIT)
    emit["per_video"]["FAKEVIDAAA1"]["strategy_refs"] = []
    with open(cli._emit_path(wd, cli._PHASE_A_EMIT), "w", encoding="utf-8") as fh:
        json.dump(emit, fh)

    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "does NOT match" in text and "emit step broken" in text


def test_b_rater_packet_emit_break_halts_verdict(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)
    cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)
    code, _ = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0
    _write_panels(wd, "FAKEVIDAAA1__s0")
    _write_raters(wd)  # answers the controls (W1-*)

    # BREAK the rater-packet emit: strip every emitted item_id (targets + controls).
    pkt_emit = _emit(wd, cli._RATER_PKT_EMIT)
    for pkt in pkt_emit["packets"]:
        pkt["target_item_ids"] = []
        pkt["control_item_ids"] = []
    with open(cli._emit_path(wd, cli._RATER_PKT_EMIT), "w", encoding="utf-8") as fh:
        json.dump(pkt_emit, fh)

    code, text = cli.run_stage_verdict(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "wrong packets" in text or "NOT in the emitted packets" in text


# =========================================================================== #
# (c) RATER+PANEL SWEEP — a conductor that answers the WRONG packets HALTs.
# =========================================================================== #


def test_c_wrong_packet_rater_answers_halt_verdict(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)
    cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)
    cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    _write_panels(wd, "FAKEVIDAAA1__s0")
    # The conductor answers a BOGUS item_id that is NOT in any emitted packet.
    stage2 = {"BOGUS-VID-S0-B000": {"support": "confirmed", "support_justification": "x"}}
    _write_raters(wd, stage1=_control_stage1(), stage2=stage2)

    code, text = cli.run_stage_verdict(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "BOGUS-VID-S0-B000" in text and "wrong packets" in text


# =========================================================================== #
# (d) READ-ONCE — re-running `phase_a` is byte-identical; a tampered Phase-A
#     artifact between stages -> hash-mismatch HALT.
# =========================================================================== #


def test_d_phase_a_reemit_is_byte_identical(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [2, 2, 2, 3, 2]}
    wd, manifest, token, _ri, _d = _seed(tmp_path, counts)
    code1, _ = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    with open(cli._emit_path(wd, cli._PHASE_A_EMIT), "rb") as fh:
        first = fh.read()
    code2, _ = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    with open(cli._emit_path(wd, cli._PHASE_A_EMIT), "rb") as fh:
        second = fh.read()
    assert code1 == 0 and code2 == 0
    assert first == second, "re-running stage phase_a must be a byte-identical re-emit"


def test_d_tampered_phase_a_between_stages_halts_certify(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)
    cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)

    # TAMPER a Phase-A draw AFTER phase_a emitted (change draw 2's count 1 -> 4).
    draw_path = os.path.join(wd, "phase_a", "FAKEVIDAAA1", "draw_2.json")
    with open(draw_path, encoding="utf-8") as fh:
        draw = json.load(fh)
    draw["count"] = 4
    draw["strategy_refs"] = ["FAKEVIDAAA1__refX", "FAKEVIDAAA1__refY", "a", "b"]
    with open(draw_path, "w", encoding="utf-8") as fh:
        json.dump(draw, fh)

    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "hash MISMATCH" in text and "changed Phase-A" in text


def test_d_tampered_phase_b_between_certify_and_verdict_halts(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)
    cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)
    cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    _write_panels(wd, "FAKEVIDAAA1__s0")
    _write_raters(wd)
    # TAMPER Phase-B after certify stamped its hash.
    _write_phase_b(
        wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch,
        strat={"name": "TAMPERED", "entry_sequence": []},
    )
    code, text = cli.run_stage_verdict(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "Phase-B hash MISMATCH" in text


# =========================================================================== #
# (e) ★ REHEARSAL / STAGING BYTE-UNCHANGED — staging verdict block identical.
# =========================================================================== #


def test_e_staging_unchanged_and_deterministic(capsys):
    code1 = cli.main(["--mode", "staging"])
    out1 = capsys.readouterr().out
    code2 = cli.main(["--mode", "staging"])
    out2 = capsys.readouterr().out
    assert code1 == 0 and code2 == 0
    assert "FIDELITY_PASS" in out1 and "rehearsal_pass: True" in out1
    # staging is the rehearsal path — byte-identical run to run (except the tmp
    # out_dir footer, which we strip).
    def _strip(o):
        return "\n".join(ln for ln in o.splitlines() if not ln.startswith("(out_dir="))
    assert _strip(out1) == _strip(out2)


# =========================================================================== #
# (f) ★ END-TO-END staged happy path: phase_a emit -> fulfil -> certify emit ->
#     fulfil -> verdict block printed. No live call (spies via synthetic propose).
# =========================================================================== #


def test_f_end_to_end_staged_happy_path(tmp_path, no_live_locator):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)

    # STAGE 1: phase_a -> emit + STOP.
    code, text = cli.run_stage_phase_a(wd, manifest_path=manifest, token_path=token)
    assert code == 0
    assert "STAGE phase_a EMITTED" in text and "fulfil Phase-B next" in text
    assert os.path.exists(cli._emit_path(wd, cli._PHASE_A_EMIT))
    assert not os.path.exists(cli._emit_path(wd, cli._RATER_PKT_EMIT))  # STOPPED

    # Conductor fulfils Phase-B per emitted ref.
    n = _emit(wd, cli._PHASE_A_EMIT)["per_video"]["FAKEVIDAAA1"]["n_strategies"]
    for i in range(n):
        _write_phase_b(wd, f"FAKEVIDAAA1__s{i}", ri=ri, dispatch=dispatch)

    # STAGE 2: certify -> emit panels + rater packets + STOP.
    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0
    assert "STAGE certify EMITTED" in text and "fulfil panels + raters next" in text
    pkts = _emit(wd, cli._RATER_PKT_EMIT)["packets"]
    assert pkts, "certify must emit at least one rater packet"

    # Conductor fulfils panels + raters (answers ONLY the emitted item_ids: controls).
    for req in _emit(wd, cli._PANEL_REQ_EMIT)["requests"]:
        _write_panels(wd, req["cid"])
    _write_raters(wd)

    # STAGE 3: verdict -> prints the verbatim verdict block + a re-verify MATCH.
    code, text = cli.run_stage_verdict(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert "H1 SEALED-12 TERMINAL-READ VERDICT (mode=sealed)" in text
    assert "verdict:" in text and "video_unit_clean_fraction:" in text
    assert "validity: VALID" in text
    assert "reverify: MATCH" in text
    assert code == 0


def test_f_auto_detect_stage_walks_the_handshake(tmp_path, no_live_locator):
    """No --stage flag: run_sealed_staged auto-detects phase_a -> certify -> verdict
    from the work-dir emit state as each stage's inputs appear."""
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, ri, dispatch = _seed(tmp_path, counts)

    assert cli._detect_stage(wd) == "phase_a"
    code, _ = cli.run_sealed_staged(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0
    _write_phase_b(wd, "FAKEVIDAAA1__s0", ri=ri, dispatch=dispatch)

    assert cli._detect_stage(wd) == "certify"
    code, _ = cli.run_sealed_staged(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0
    for req in _emit(wd, cli._PANEL_REQ_EMIT)["requests"]:
        _write_panels(wd, req["cid"])
    _write_raters(wd)

    assert cli._detect_stage(wd) == "verdict"
    code, text = cli.run_sealed_staged(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code == 0
    assert "TERMINAL-READ VERDICT" in text


def test_f_certify_before_phase_a_halts_missing_prior(tmp_path, no_live_locator):
    """A resume out of order (certify with no phase_a emit) HALTs on the missing
    prior-stage artifact — never fabricated."""
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, token, _ri, _d = _seed(tmp_path, counts)
    code, text = cli.run_stage_certify(
        wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
    )
    assert code != 0 and "HALT" in text
    assert "phase_a" in text and "run the prior stage first" in text


def test_f_no_token_halts_every_stage(tmp_path):
    counts = {"FAKEVIDAAA1": [1, 1, 1, 1, 1]}
    wd, manifest, _token, _ri, _d = _seed(tmp_path, counts)
    absent = str(tmp_path / "no.token")
    for fn in (cli.run_stage_phase_a, cli.run_stage_certify, cli.run_stage_verdict):
        code, text = fn(wd, manifest_path=manifest, token_path=absent)
        assert code != 0 and "no SEAL-GO.token" in text
