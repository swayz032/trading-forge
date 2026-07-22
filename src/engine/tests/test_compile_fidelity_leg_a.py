"""Red-proofs for LEG A (Tooth-1 compile-fidelity), frozen pre-reg §1-A / §0 / §6a.

These are REVIVAL PROBES: the corpus test asserts the correct INERT state (every currently-
known spec fails Leg A(ii) categorically → BLOCK). If a corpus spec ever starts passing
Leg A(ii), this test fails loudly — a real state change to surface, never silence.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path

import pytest

from src.engine.extraction.spec_producer import _spec_hash
from src.engine.forensics.compile_fidelity import (
    BLOCK,
    PASS,
    countersign_phase2,
    run_leg_a,
    run_leg_a_phase1,
)
from src.engine.spec_family_bindings import FAMILY_META
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


# =========================================================================== #
# R-260 FIX PACKET — founding red-proofs (REVIVAL PROBES). Each re-runs, so it
# is a CONTROL, not a one-shot birth claim. F-1 (false positive) + F-2 (fail-
# open) + the binding_plan bypass removal. The grader's exact repros must BLOCK.
# =========================================================================== #

# --------------------------------------------------------------------------- #
# F-1 — Leg A(ii) anchors to the ENFORCED HONEST accounting, flag-independent.
# --------------------------------------------------------------------------- #
def test_f1_honest_anchor_is_flag_independent_and_disagrees_with_convenience_label():
    """The essence of F-1: with TF_FAMILY_META_ENFORCED OFF (default), the flag-gated
    convenience label and the honest enforced value DISAGREE for the self-convicted families.
    The gate must anchor to the honest value — and read it WITHOUT flipping any flag."""
    for fam in ("ENABLE_ENTRY", "ENTER", "INVALIDATE"):
        meta = FAMILY_META[fam]
        assert meta.effective_approximation() is False  # convenience label (flag OFF)
        assert meta.enforced_honest_approximation() is True  # honest value the gate anchors to


def test_f1_retype_to_enable_entry_blocks_on_ii():
    """Grader's founding repro: retyping a load-bearing spine condition to ENABLE_ENTRY must
    BLOCK on (ii). Under the old flag-gated read it returned PASS with zero failed checks."""
    art = clean_artifact()
    art["spec"]["entry_conditions"][0]["type"] = "ENABLE_ENTRY"
    art["spec_hash"] = _spec_hash(art["spec"])
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    row = seal.rows[0]
    ii = [c for c in row.checks if c.code == "ii"][0]
    assert row.ii_applicable and not ii.passed, (row.condition_id, ii.reason)
    assert "ii" in seal.checks_failed
    full = run_leg_a(art, certificate=clean_certificate(art["spec"]), countersignatures=clean_countersignatures(art))
    assert full.verdict == BLOCK


def test_f1_invalidate_leaning_spec_blocks_on_ii():
    """A spec leaning on a LOAD-BEARING INVALIDATE (honest enforced approximation=True,
    production_executed=False) BLOCKs on (ii)."""
    art = clean_artifact()
    art["spec"]["invalidations"] = [{
        "id": "INVALIDATE:s#9", "type": "INVALIDATE", "object": "stop below the swing low",
        "role": "invalidation", "span": {"start": 0, "end": 0}, "evidence": "stop",
        "type_confidence": "confident",
    }]
    art["spec_hash"] = _spec_hash(art["spec"])
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    inv = [r for r in seal.rows if r.type == "INVALIDATE"][0]
    ii = [c for c in inv.checks if c.code == "ii"][0]
    assert inv.ii_applicable and not ii.passed, ii.reason
    assert "ii" in seal.checks_failed
    assert run_leg_a(art, certificate=clean_certificate(art["spec"])).verdict == BLOCK


def test_f1_load_bearing_enable_entry_spine_blocks_on_ii():
    """A spec leaning on a LOAD-BEARING (role=spine) ENABLE_ENTRY (honest enforced
    approximation=True — the spine-conjunction mechanism, not a bound gating primitive)
    BLOCKs on (ii)."""
    art = clean_artifact()
    art["spec"]["entry_conditions"].append({
        "id": "ENABLE_ENTRY:spine#9", "type": "ENABLE_ENTRY", "object": "confluence present",
        "role": "spine", "span": {"start": 0, "end": 0}, "evidence": "x", "type_confidence": "confident",
    })
    art["spec"]["and_groups"] = [[c["id"] for c in art["spec"]["entry_conditions"]]]
    art["spec_hash"] = _spec_hash(art["spec"])
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    ee = [r for r in seal.rows if r.condition_id == "ENABLE_ENTRY:spine#9"][0]
    ii = [c for c in ee.checks if c.code == "ii"][0]
    assert ee.ii_applicable and not ii.passed, ii.reason
    assert "ii" in seal.checks_failed


def test_f1_honest_good_fixture_passes_for_the_right_reason():
    """The clean fixture passes whole because its (ii)-applicable LOAD-BEARING conditions are
    exactly the genuinely honest-bound WAIT_SESSION spine — NOT because a convenience label let
    ENABLE_ENTRY/INVALIDATE slip through (the F-1 hole). The ENABLE_ENTRY trigger is present but
    dispositioned non-load-bearing (structural spine-conjunction trigger), so (ii) is n/a."""
    art = clean_artifact()
    seal = run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]))
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    ii_rows = [r for r in seal.rows if r.ii_applicable]
    assert ii_rows, "fixture must have (ii)-applicable load-bearing rows"
    assert {r.type for r in ii_rows} == {"WAIT_SESSION"}, [(r.condition_id, r.type) for r in ii_rows]
    for r in ii_rows:
        assert [c for c in r.checks if c.code == "ii"][0].passed, r.condition_id
    trig = [r for r in seal.rows if r.type == "ENABLE_ENTRY"][0]
    assert not trig.ii_applicable and trig.row_verdict == PASS


# --------------------------------------------------------------------------- #
# F-2 — an empty / malformed certificate BLOCKs (fail-CLOSED), never certifies
# clean; a malformed countersignatures object is a graceful BLOCK, not a crash.
# --------------------------------------------------------------------------- #
def test_f2_empty_certificate_blocks_with_named_reason():
    """The founding fixture: certificate={} → BLOCK on the NAMED provenance check (vi_cert),
    never PASS with an empty checks_failed set."""
    art = clean_artifact()
    seal = run_leg_a_phase1(art, certificate={})
    assert seal.automated_verdict == BLOCK
    assert "vi_cert" in seal.checks_failed
    assert run_leg_a(art, certificate={}, countersignatures=clean_countersignatures(art)).verdict == BLOCK


def test_f2_nondict_certificate_blocks():
    """Any non-dict certificate (list, str, int) is zero provenance → BLOCK, never a vacuous
    PASS through the isinstance-guarded skip."""
    art = clean_artifact()
    for bad in ([], ["x"], "cert", 7):
        seal = run_leg_a_phase1(art, certificate=bad)
        assert seal.automated_verdict == BLOCK, bad
        assert "vi_cert" in seal.checks_failed, bad


def test_f2_certificate_missing_required_key_blocks():
    art = clean_artifact()
    seal = run_leg_a_phase1(art, certificate={"video": art["video"]})  # no 'conditions'
    assert seal.automated_verdict == BLOCK
    assert "vi_cert" in seal.checks_failed


def test_f2_null_valued_certificate_keys_block():
    """Re-grade residual (a fix is a new surface): a certificate whose required keys are PRESENT
    but null/empty carries zero provenance and must BLOCK — key presence is not validity. Under
    the presence-only guard `{'video':None,'conditions':None}` slipped through to a clean pass."""
    art = clean_artifact()
    vid = art["video"]
    residuals = [
        {"video": None, "conditions": None},
        {"video": None, "conditions": []},
        {"video": vid, "conditions": None},
        {"video": vid, "conditions": []},
        {"video": vid, "conditions": [{"char_span": [0, 0]}]},  # anchorless ledger
        {"video": "   ", "conditions": [{"quote_anchor": "x"}]},  # whitespace-only link
    ]
    for cert in residuals:
        seal = run_leg_a_phase1(art, certificate=cert)
        assert seal.automated_verdict == BLOCK, cert
        assert "vi_cert" in seal.checks_failed, cert
    # end-to-end: the null-provenance certificate must NOT certify a clean ROBUST-SURVIVOR pass
    full = run_leg_a(art, certificate={"video": None, "conditions": None},
                     countersignatures=clean_countersignatures(art))
    assert full.verdict == BLOCK


def test_f2_honest_good_certificate_passes_for_the_right_reason():
    """Anti-vacuity for the validity guard: the honest-good fixture's REAL certificate PASSes
    (vi_cert) precisely because its video AND conditions are genuinely populated (a non-empty
    ledger of anchor-bearing conditions) — not a present-but-null shell."""
    art = clean_artifact()
    cert = clean_certificate(art["spec"])
    assert cert["video"] and cert["conditions"] and all(c.get("quote_anchor") for c in cert["conditions"])
    seal = run_leg_a_phase1(art, certificate=cert)
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    assert "vi_cert" not in seal.checks_failed


def test_f2b_nondict_countersignatures_is_graceful_block_not_crash():
    """A malformed (non-dict) countersignatures object must fail-closed BLOCK, never raise an
    uncaught AttributeError (a crash is not a fail-closed refusal)."""
    art = clean_artifact()
    cert = clean_certificate(art["spec"])
    r = run_leg_a(art, certificate=cert, countersignatures=["not", "a", "dict"])  # must not raise
    assert r.verdict == BLOCK
    assert "countersign" in r.checks_failed
    seal = run_leg_a_phase1(art, certificate=cert)
    assert countersign_phase2(seal, ["not", "a", "dict"]).verdict == BLOCK


# --------------------------------------------------------------------------- #
# #3 — the ungated caller-supplied binding_plan bypass is REMOVED.
# --------------------------------------------------------------------------- #
def test_binding_plan_override_bypass_removed():
    """(ii) always re-derives the plan fresh from the live code path; a caller can no longer
    inject one to subvert the re-derivation."""
    art = clean_artifact()
    with pytest.raises(TypeError):
        run_leg_a_phase1(art, certificate=clean_certificate(art["spec"]), binding_plan=object())
    with pytest.raises(TypeError):
        run_leg_a(art, binding_plan=object())
