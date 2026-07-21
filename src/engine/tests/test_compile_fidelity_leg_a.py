"""Red-proofs for LEG A (Tooth-1 compile-fidelity), frozen pre-reg §1-A / §0 / §6a.

These are REVIVAL PROBES: the corpus test asserts the correct INERT state (every currently-
known spec fails Leg A(ii) categorically → BLOCK). If a corpus spec ever starts passing
Leg A(ii), this test fails loudly — a real state change to surface, never silence.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path

from src.engine.forensics.compile_fidelity import (
    BLOCK,
    PASS,
    countersign_phase2,
    run_leg_a,
    run_leg_a_phase1,
)
from src.engine.tests._forensics_fixtures import (
    clean_artifact,
    clean_certificate,
    clean_countersignatures,
    clean_inputs,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CORPUS_DIR = _REPO_ROOT / "docs" / "replay-results" / "h1-scripts" / "claude-rung-v32" / "shakedown_specs"


def _corpus_specs() -> list[Path]:
    return sorted(Path(p) for p in glob.glob(str(_CORPUS_DIR / "*.spec.json")))


# --------------------------------------------------------------------------- #
# R2 — ANTI-VACUITY FOR THE DETECTOR ITSELF: a known-good spec PASSES whole.
# (A detector that always BLOCKed would trivially "pass" the corpus red-proof.)
# --------------------------------------------------------------------------- #
def test_known_good_synthetic_spec_passes_leg_a_whole():
    result = clean_inputs().run()
    assert result.verdict == PASS, (result.verdict, sorted(result.checks_failed), result.summary)
    assert not result.checks_failed


def test_known_good_passes_each_check_category():
    art = clean_artifact()
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    # every per-condition row passes its automated checks
    for row in seal.rows:
        assert row.row_verdict == PASS, (row.condition_id, row.fail_codes)
    # (ii) applies to the load-bearing gating conditions and passes for all of them
    ii_rows = [r for r in seal.rows if r.ii_applicable]
    assert ii_rows, "fixture must have load-bearing conditions subject to (ii)"


# --------------------------------------------------------------------------- #
# R1 — INERT STATE: every corpus spec fails Leg A(ii) → categorical BLOCK.
# --------------------------------------------------------------------------- #
def test_corpus_exists():
    specs = _corpus_specs()
    assert specs, f"no corpus specs under {_CORPUS_DIR}"


def test_every_corpus_spec_blocks_leg_a():
    specs = _corpus_specs()
    n_pass_ii = 0
    blocked = 0
    for p in specs:
        artifact = json.loads(p.read_text(encoding="utf-8"))
        seal = run_leg_a_phase1(artifact)  # no certificate → (vi) also fail-closed, but (ii) is the headline
        result = run_leg_a(artifact)
        assert result.verdict == BLOCK, (p.name, result.summary)
        blocked += 1
        if "ii" not in seal.checks_failed:
            n_pass_ii += 1
    # THE MEASURED INERT STATE: 0 corpus specs bind all load-bearing conditions (Leg A(ii)).
    assert n_pass_ii == 0, f"{n_pass_ii} corpus spec(s) unexpectedly PASS Leg A(ii) — investigate"
    assert blocked == len(specs)


# --------------------------------------------------------------------------- #
# R3 — FAIL-CLOSED on missing inputs (BLOCK, never skip / never exception-as-pass).
# --------------------------------------------------------------------------- #
def test_missing_spec_blocks():
    assert run_leg_a({}).verdict == BLOCK
    assert run_leg_a({"spec": {}}).verdict == BLOCK  # zero conditions
    assert run_leg_a({"spec": {"entry_conditions": []}}).verdict == BLOCK


def test_missing_certificate_blocks_on_provenance():
    art = clean_artifact()
    # clean artifact + countersign but NO certificate → (vi) fail-closed BLOCK
    result = run_leg_a(art, certificate=None, countersignatures=clean_countersignatures(art))
    assert result.verdict == BLOCK
    assert "vi_cert" in result.checks_failed


def test_missing_countersign_blocks_even_when_automated_passes():
    art = clean_artifact()
    result = run_leg_a(art, certificate=clean_certificate(art["spec"]), countersignatures=None)
    assert result.verdict == BLOCK
    assert "countersign" in result.checks_failed


def test_dissenting_countersign_blocks():
    art = clean_artifact()
    cs = clean_countersignatures(art)
    first = next(iter(cs))
    cs[first] = {**cs[first], "typing": False}
    result = run_leg_a(art, certificate=clean_certificate(art["spec"]), countersignatures=cs)
    assert result.verdict == BLOCK
    assert "countersign" in result.checks_failed


# --------------------------------------------------------------------------- #
# R4 — Phase-1 seal is deterministic (same artifact → same seal hash).
# --------------------------------------------------------------------------- #
def test_phase1_seal_is_deterministic():
    art = clean_artifact()
    cert = clean_certificate(art["spec"])
    h1 = run_leg_a_phase1(art, certificate=cert).seal_hash
    h2 = run_leg_a_phase1(clean_artifact(), certificate=clean_certificate(clean_artifact()["spec"])).seal_hash
    assert h1 == h2 and len(h1) == 64


def test_phase2_no_required_rows_passes_vacuously():
    # A seal with no countersign-required rows passes Phase 2 without countersignatures.
    from src.engine.forensics.compile_fidelity import Phase1Seal

    empty = Phase1Seal("h", [], [], PASS, set(), [], "seal")
    assert countersign_phase2(empty, None).verdict == PASS
