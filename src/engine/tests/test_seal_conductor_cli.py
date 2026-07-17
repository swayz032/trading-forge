"""Tests for the H1 sealed-12 terminal-read CONDUCTOR CLI
(``scripts/h1_seal_conductor_cli.py``).

The CLI is a THIN PROCESS WRAPPER around the built driver
(``src/engine/extraction/sealed_read_driver.py``). These tests prove the WRAPPER's
contract — staging rehearsal end-to-end, the token gate, the manifest pin +
spent-16 rejection, the conductor-artifact wiring into the sealed seams, the
identity-guard HALT, that NO SEAL-GO.token is ever created, and that no sealed
sha/model literal is hardcoded — with NO live LLM / network (the anchor-locator
PROPOSE leg is stubbed network-free; the extract/panel/rater seams are file
readers).
"""

from __future__ import annotations

import glob
import hashlib
import importlib.util
import json
import os
import subprocess
import sys

import pytest

# Import the CLI module by path (it lives under scripts/, not an importable pkg).
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
from src.engine.extraction.sealed_read_gate import (  # noqa: E402
    SPENT_16_MANIFEST_BASENAME,
    verify_sealed_manifest,
)

# --------------------------------------------------------------------------- #
# Fixtures / builders for a FAKE conductor work-dir (no live call).
# --------------------------------------------------------------------------- #


def _real_strategy() -> dict:
    """A real spent staging_v32 strategy to embed in the fake extraction, so the
    downstream Module C/D path processes a well-formed strategy."""
    files = sorted(
        glob.glob(
            os.path.join(
                _ROOT,
                "docs",
                "replay-results",
                "h1-scripts",
                "claude-rung-designpool",
                "staging_v32",
                "*__s0.json",
            )
        )
    )
    with open(files[0], encoding="utf-8") as fh:
        return json.load(fh)["strategies"][0]


def _small_sealed_manifest(tmp_path, video_ids: list[str]) -> str:
    """A NON-spent, sha-self-consistent manifest with a tiny video set — a fast
    stand-in for the 12 so the wiring proof does not iterate 12 videos. (The pinned
    default manifest IS the real sealed-12; see test_manifest_pin.)"""
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


def _build_fake_workdir(tmp_path, video_ids: list[str], *, dispatch_model: str) -> str:
    """Write a complete fake conductor work-dir in the PER-DRAW / PER-STRATEGY
    layout (R-024.1): per video FIVE blind Phase-A enumeration draws
    (phase_a/<vid>/draw_<0..4>.json, each self-reporting the CERTIFIED identity +
    its own dispatch_record) + ONE Phase-B strategy extraction (phase_b/<cid>.json),
    PASS/PASS panels, control-correct rater answers, a whole-run dispatch_record
    (CERTIFIED unless overridden), and the seal-day validity inputs."""
    ri = certified_reader_identity()
    strat = _real_strategy()
    dispatch = {
        "requested_model": dispatch_model,
        "resolved_model": dispatch_model,
        "channel_class": ri["channel_class"],
        "dispatch_mode": "interactive",
    }
    wd = str(tmp_path / "workdir")
    for sub in ("phase_a", "phase_b", "panels", "raters"):
        os.makedirs(os.path.join(wd, sub), exist_ok=True)
    for vid in video_ids:
        # FIVE independent Phase-A enumeration draws, each its OWN blind dispatch.
        pa_vid_dir = os.path.join(wd, "phase_a", vid)
        os.makedirs(pa_vid_dir, exist_ok=True)
        for draw_index in range(5):
            with open(os.path.join(pa_vid_dir, f"draw_{draw_index}.json"), "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "reader_identity": ri,
                        "dispatch_record": dispatch,
                        "video_id": vid,
                        "draw_index": draw_index,
                        "count": 1,  # all 5 draws enumerate 1 strategy -> stable mode 1
                        "strategy_refs": [f"{vid}__ref0"],
                    },
                    fh,
                )
        cid = f"{vid}__s0"
        # ONE Phase-B single-draw extraction per consensus strategy.
        with open(os.path.join(wd, "phase_b", f"{cid}.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "reader_identity": ri,
                    "dispatch_record": dispatch,
                    "strategies": [strat],
                    "instrument_classification": None,
                },
                fh,
            )
        with open(os.path.join(wd, "panels", f"{cid}.json"), "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "conflation": "PASS",
                    "enumeration_consistency": "PASS",
                    "completeness": {"content_clean": True},
                },
                fh,
            )
    stage1 = {
        **{f"W1-{n:04d}": "gate-strength" for n in (1, 3, 5, 7, 9)},
        **{f"W1-{n:04d}": "context" for n in (2, 4, 6, 8, 10)},
    }
    for rid in ("A", "B"):
        with open(os.path.join(wd, "raters", f"{rid}.json"), "w", encoding="utf-8") as fh:
            json.dump({"stage1": stage1, "stage2": {}}, fh)
    with open(os.path.join(wd, "dispatch_record.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "requested_model": dispatch_model,
                "resolved_model": dispatch_model,
                "channel_class": ri["channel_class"],
                "dispatch_mode": "interactive",
            },
            fh,
        )
    with open(os.path.join(wd, "validity_inputs.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "registration_pre_check": {"ok": True, "n_registered": len(video_ids)},
                "engagement_pre_check": {"ok": True},
                "frozen_scan_commit": "seal-frozen-scan",
                "driver_commit": "seal-driver",
                "epoch": "seal-epoch-0",
            },
            fh,
        )
    return wd


@pytest.fixture
def no_live_locator(monkeypatch):
    """Belt-and-suspenders NO-LIVE-CALL guard: the real anchor-locator PROPOSE leg
    (local gemma) RAISES if ever reached. The sealed tests inject the synthetic
    network-free stub, so this must never fire."""

    def _boom(*_a, **_k):  # pragma: no cover - firing IS the failure
        raise AssertionError("LIVE-CALL VIOLATION: real gemma locator reached in a test")

    monkeypatch.setattr(anchor_locator, "_default_propose_fn", _boom)


def _token_state():
    """Existence+content fingerprint of the real SEAL-GO.token (None if absent)."""
    p = cli.PINNED_TOKEN_PATH
    if not os.path.exists(p):
        return None
    with open(p, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


# Snapshot at IMPORT (before any test/CLI runs). Robust to a legitimate
# operator-created token already existing in the worktree (R-025): the assertion
# below is UNCHANGED-since-import, not absent.
_TOKEN_STATE_AT_IMPORT = _token_state()


def _assert_no_token_created():
    # The CLI must NEVER create OR modify SEAL-GO.token. Whether the token was
    # absent (must stay absent) or already present by the operator's hand (must
    # stay the operator's exact bytes), the CLI must leave it UNCHANGED.
    assert _token_state() == _TOKEN_STATE_AT_IMPORT, (
        "CLI must NEVER create or modify SEAL-GO.token (state changed since import)"
    )


# --------------------------------------------------------------------------- #
# (a) ★ staging end-to-end: exit 0, verdict block has FIDELITY_PASS + scope lines
#     + both witness dispositions + rehearsal_pass. (main() AND subprocess.)
# --------------------------------------------------------------------------- #


def test_a_staging_end_to_end_main(capsys):
    code = cli.main(["--mode", "staging"])
    out = capsys.readouterr().out
    assert code == 0
    assert "FIDELITY_PASS" in out
    assert "rehearsal_pass: True" in out
    # both witness dispositions present.
    assert "witness[IyF enumeration_consistency]" in out
    assert "enum_disposition=FAIL" in out
    assert "witness[R5L890-FUSED conflation]" in out
    assert "conflation_disposition=REJECT" in out
    # all four verbatim scope lines.
    for scope in (
        "enumeration mis-packaging lower-bound 1/16 (design pool)",
        "variant re-promotion lower-bound 1/22 (axis armed at read)",
        "content axis measured at design-pool layer, RECORDED not gated on the twelve",
        "result scoped to corpus + instrument SHAs + snapshot",
    ):
        assert scope in out
    _assert_no_token_created()


def test_a_staging_end_to_end_subprocess():
    env = dict(os.environ)
    env["NODE_OPTIONS"] = ""
    proc = subprocess.run(
        [sys.executable, _CLI_PATH, "--mode", "staging"],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stderr
    assert "FIDELITY_PASS" in proc.stdout
    assert "rehearsal_pass: True" in proc.stdout
    _assert_no_token_created()


# --------------------------------------------------------------------------- #
# (b) sealed, NO token -> HALT "not authorized", non-zero, driver NEVER invoked.
# --------------------------------------------------------------------------- #


def test_b_sealed_no_token_halts_driver_never_invoked(tmp_path, monkeypatch):
    invoked = {"run_verdict": 0}

    class _SpyDriver:
        def __init__(self, *a, **k):
            pass

        def run_verdict(self, *a, **k):  # pragma: no cover - must never run
            invoked["run_verdict"] += 1
            raise AssertionError("driver.run_verdict invoked despite missing token")

    monkeypatch.setattr(cli, "SealedReadDriver", _SpyDriver)

    absent_token = str(tmp_path / "does-not-exist.token")
    code, text = cli.run_sealed(
        str(tmp_path / "wd"), manifest_path=str(tmp_path / "m.json"), token_path=absent_token
    )
    assert code != 0
    assert "HALT: no SEAL-GO.token" in text
    assert "not authorized" in text
    assert invoked["run_verdict"] == 0
    _assert_no_token_created()


# --------------------------------------------------------------------------- #
# (c) sealed + temp token + SPENT-16 manifest -> Module A rejects (HALT).
# --------------------------------------------------------------------------- #


def test_c_sealed_spent16_manifest_rejected(tmp_path, no_live_locator):
    ri = certified_reader_identity()
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO (temp, test-owned)")
    try:
        # Populate a COMPLETE work-dir so the CLI gets PAST the conductor-artifact
        # loads and genuinely reaches Module A's spent-16 gate (which fires inside
        # run_verdict BEFORE any extraction). Without a real work-dir the CLI would
        # HALT earlier on a missing artifact and never exercise the spent-16 gate.
        wd = _build_fake_workdir(tmp_path, ["FAKEVID0001"], dispatch_model=ri["model_id"])
        spent16 = os.path.join(_ROOT, "docs", "designs", SPENT_16_MANIFEST_BASENAME)
        code, text = cli.run_sealed(
            wd,
            manifest_path=spent16,
            token_path=token,
            propose_fn=_synthetic_dry_run_propose_fn,
        )
        assert code != 0
        # Assert on the GATE'S OWN reason string, never a tmp-path-name-derived
        # substring: the spent-16 rejection must be what fired.
        assert ("SpentManifestRejected" in text) or ("spent16_rejected" in text), text
        assert "FAKEVID" not in text or "extraction" not in text.lower(), (
            "gate must reject BEFORE any extraction is read"
        )
    finally:
        os.remove(token)  # NEVER leave a real token behind
    _assert_no_token_created()


# --------------------------------------------------------------------------- #
# (d) sealed + temp token + FAKE work-dir -> drives A->E, prints a verdict;
#     a WRONG-model dispatch_record -> identity-guard HALT. No live call.
# --------------------------------------------------------------------------- #


def test_d_sealed_fake_workdir_drives_verdict(tmp_path, no_live_locator):
    ri = certified_reader_identity()
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO (temp, test-owned)")
    try:
        manifest = _small_sealed_manifest(tmp_path, ["FAKEVID0001"])
        wd = _build_fake_workdir(tmp_path, ["FAKEVID0001"], dispatch_model=ri["model_id"])
        code, text = cli.run_sealed(
            wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
        )
        # A->E ran and a verdict block printed (same block shape as staging).
        assert "H1 SEALED-12 TERMINAL-READ VERDICT (mode=sealed)" in text
        assert "verdict:" in text and "video_unit_clean_fraction:" in text
        assert "validity: VALID" in text
        assert code == 0  # a VALID FIDELITY verdict was produced
    finally:
        os.remove(token)
    _assert_no_token_created()


def test_d_sealed_missing_phase_a_draw_halts(tmp_path, no_live_locator):
    """A missing Phase-A draw artifact under the per-draw work-dir -> HALT (the CLI
    never fabricates a missing draw; R-024.1 per-draw dispatch is mandatory)."""
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO (temp, test-owned)")
    try:
        ri = certified_reader_identity()
        manifest = _small_sealed_manifest(tmp_path, ["FAKEVID0001"])
        wd = _build_fake_workdir(tmp_path, ["FAKEVID0001"], dispatch_model=ri["model_id"])
        # delete draw 3 of 5 -> the driver's per-draw request for it must HALT.
        os.remove(os.path.join(wd, "phase_a", "FAKEVID0001", "draw_3.json"))
        code, text = cli.run_sealed(
            wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
        )
        assert code != 0
        assert "HALT" in text
        assert "ConductorArtifactMissing" in text
        assert "Phase-A draw 3" in text
        assert "TERMINAL-READ VERDICT" not in text
    finally:
        os.remove(token)
    _assert_no_token_created()


def test_d_sealed_wrong_model_dispatch_halts(tmp_path, no_live_locator):
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO (temp, test-owned)")
    try:
        manifest = _small_sealed_manifest(tmp_path, ["FAKEVID0001"])
        # dispatch record self-reports a DIFFERENT (uncertified) model than the
        # extraction's self-report -> the dispatch identity guard HALTs.
        wd = _build_fake_workdir(
            tmp_path, ["FAKEVID0001"], dispatch_model="uncertified-wrong-brain-x"
        )
        code, text = cli.run_sealed(
            wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
        )
        assert code != 0
        assert "HALT" in text
        assert "ReaderIdentityMismatch" in text
        assert "model_id" in text  # the guard names the mismatched model legs
        # no verdict block was printed.
        assert "TERMINAL-READ VERDICT" not in text
    finally:
        os.remove(token)
    _assert_no_token_created()


# --------------------------------------------------------------------------- #
# (e) the CLI creates NO SEAL-GO.token on ANY path.
# --------------------------------------------------------------------------- #


def test_e_cli_never_creates_seal_go_token(tmp_path, capsys, no_live_locator):
    # The pinned token may legitimately already exist by the operator's hand (R-025);
    # the invariant is that the CLI never CREATES or MODIFIES it.
    before = _token_state()
    # staging path
    cli.main(["--mode", "staging"])
    capsys.readouterr()
    # sealed no-token path
    cli.run_sealed(str(tmp_path / "wd"), token_path=str(tmp_path / "absent.token"))
    # sealed with temp token + fake work-dir path
    token = str(tmp_path / "SEAL-GO.token")
    with open(token, "w", encoding="utf-8") as fh:
        fh.write("GO")
    try:
        ri = certified_reader_identity()
        manifest = _small_sealed_manifest(tmp_path, ["FAKEVID0001"])
        wd = _build_fake_workdir(tmp_path, ["FAKEVID0001"], dispatch_model=ri["model_id"])
        cli.run_sealed(
            wd, manifest_path=manifest, token_path=token, propose_fn=_synthetic_dry_run_propose_fn
        )
    finally:
        os.remove(token)
    # the pinned operator-token path was NEVER created OR modified by the CLI.
    assert _token_state() == before, "CLI created or modified the pinned SEAL-GO.token"


# --------------------------------------------------------------------------- #
# (f) no hardcoded sealed sha / model literals in the CLI source.
# --------------------------------------------------------------------------- #


def test_f_no_hardcoded_sealed_literals():
    with open(_CLI_PATH, encoding="utf-8") as fh:
        source = fh.read()
    ri = certified_reader_identity()
    # the frozen model id + prompt/enumerator SHAs must be READ at runtime, never
    # transcribed into the CLI.
    assert ri["model_id"] not in source
    assert ri["prompt_sha"] not in source
    assert ri["enumerator_sha"] not in source
    # the sealed-12 sha must be recomputed from the frozen manifest, never hardcoded.
    v = verify_sealed_manifest(cli.PINNED_SEALED12_MANIFEST)
    assert v["declared_sha"] not in source
    assert v["computed_sha"] not in source
    for vid in v["video_ids"]:
        assert vid not in source


# --------------------------------------------------------------------------- #
# manifest pin: the CLI default IS the frozen sealed-12 (read from disk, n=12).
# --------------------------------------------------------------------------- #


def test_manifest_pin_is_sealed12():
    assert os.path.basename(cli.PINNED_SEALED12_MANIFEST) == "h1-wave6-sealed-fresh-set-2026-07-12.json"
    v = verify_sealed_manifest(cli.PINNED_SEALED12_MANIFEST)
    assert v["ok"] is True
    assert v["n"] == 12
