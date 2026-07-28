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
    CLEAN_TRANSCRIPT,
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
    seal = run_leg_a_phase1(art, certificate=clean_certificate())
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
    result = run_leg_a(art, certificate=clean_certificate(), countersignatures=None)
    assert result.verdict == BLOCK
    assert "countersign" in result.checks_failed


def test_dissenting_countersign_blocks():
    art = clean_artifact()
    cs = clean_countersignatures(art)
    first = next(iter(cs))
    cs[first] = {**cs[first], "typing": False}
    result = run_leg_a(art, certificate=clean_certificate(), countersignatures=cs)
    assert result.verdict == BLOCK
    assert "countersign" in result.checks_failed


# --------------------------------------------------------------------------- #
# R4 — Phase-1 seal is deterministic (same artifact → same seal hash).
# --------------------------------------------------------------------------- #
def test_phase1_seal_is_deterministic():
    art = clean_artifact()
    cert = clean_certificate()
    h1 = run_leg_a_phase1(art, certificate=cert).seal_hash
    h2 = run_leg_a_phase1(clean_artifact(), certificate=clean_certificate()).seal_hash
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
    seal = run_leg_a_phase1(art, certificate=clean_certificate())
    row = seal.rows[0]
    ii = [c for c in row.checks if c.code == "ii"][0]
    assert row.ii_applicable and not ii.passed, (row.condition_id, ii.reason)
    assert "ii" in seal.checks_failed
    full = run_leg_a(art, certificate=clean_certificate(), countersignatures=clean_countersignatures(art))
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
    seal = run_leg_a_phase1(art, certificate=clean_certificate())
    inv = [r for r in seal.rows if r.type == "INVALIDATE"][0]
    ii = [c for c in inv.checks if c.code == "ii"][0]
    assert inv.ii_applicable and not ii.passed, ii.reason
    assert "ii" in seal.checks_failed
    assert run_leg_a(art, certificate=clean_certificate()).verdict == BLOCK


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
    seal = run_leg_a_phase1(art, certificate=clean_certificate())
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
    seal = run_leg_a_phase1(art, certificate=clean_certificate())
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
    cert = clean_certificate()
    assert cert["video"] and cert["conditions"] and all(c.get("quote_anchor") for c in cert["conditions"])
    seal = run_leg_a_phase1(art, certificate=cert)
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    assert "vi_cert" not in seal.checks_failed


def test_f2_a2_any_not_all_and_anchor_specificity_block():
    """Amendment A2 (a fix is a new surface): two compounding weaknesses on the validity gate.
    Attack A — a conditions list where MOST entries are anchorless rode ONE valid anchor
    (aggregate `any` blindness) → now BLOCK (per-entry `all`). Attack B — a single meaningless
    one-char anchor 'a' reconciled against every spec text via unbounded substring → now BLOCK
    (min-token specificity + token-boundary). Plus whitespace-only, punctuation, single-word."""
    art = clean_artifact()
    cs = clean_countersignatures(art)

    def verdict(conditions):
        cert = clean_certificate()
        cert["conditions"] = conditions
        return run_leg_a(art, certificate=cert, countersignatures=cs).verdict

    # Attack A: 5 anchorless entries riding 1 valid anchor
    assert verdict(
        [{"quote_anchor": "", "char_span": [0, 0]} for _ in range(5)]
        + [{"quote_anchor": "wait for the london killzone session", "char_span": [0, 0]}]
    ) == BLOCK
    # Attack B: a single meaningless one-character anchor
    assert verdict([{"quote_anchor": "a", "char_span": [0, 0]}]) == BLOCK
    # whitespace-only, pure-punctuation, and a single real word are all sub-specificity → BLOCK
    assert verdict([{"quote_anchor": "   ", "char_span": [0, 0]}]) == BLOCK
    assert verdict([{"quote_anchor": "!!!", "char_span": [0, 0]}]) == BLOCK
    assert verdict([{"quote_anchor": "the", "char_span": [0, 0]}]) == BLOCK


def test_f2_a2_honest_certificate_anchors_clear_the_specificity_floor():
    """Anti-vacuity for the A2 threshold: the honest fixture's REAL cert PASSes because every
    anchor is present AND clears the measured 2-token floor (its shortest, 'spine completion',
    is exactly 2 tokens — the honest-corpus minimum the threshold is derived from)."""
    from src.engine.forensics.compile_fidelity import MIN_ANCHOR_TOKENS, _norm

    art = clean_artifact()
    cert = clean_certificate()
    for c in cert["conditions"]:
        anchor = _norm(str(c.get("quote_anchor", "")))
        assert anchor and len(anchor.split()) >= MIN_ANCHOR_TOKENS, c
    seal = run_leg_a_phase1(art, certificate=cert)
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    assert "v" not in seal.checks_failed and "vi_cert" not in seal.checks_failed


def test_f2_a3_drop_audit_is_a_bijection_launder_and_cardinality_block():
    """Amendment A3 (structural — defeats the canonical m2 class). The drop-audit was never a
    bijection: a flattened pool + `any(anchor matches somewhere)` had no distinctness, so a
    dropped taught condition could be LAUNDERED behind a duplicate of a kept condition's anchor.
    Now it is a 1:1 reconciliation (maximum matching): each certificate entry must claim a
    DISTINCT taught condition."""
    london = "wait for the london killzone session"

    # Laundered drop: drop WAIT_SESSION:am#1, refill its slot with a DUPLICATE london anchor.
    a = clean_artifact()
    a["spec"]["entry_conditions"] = [c for c in a["spec"]["entry_conditions"] if c["id"] != "WAIT_SESSION:am#1"]
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    a["spec_hash"] = _spec_hash(a["spec"])
    laundered = {"video": a["video"], "conditions": [
        {"quote_anchor": london, "char_span": [0, 0]},
        {"quote_anchor": london, "char_span": [0, 0]},   # laundered am slot
        {"quote_anchor": "spine completion", "char_span": [0, 0]},
    ]}
    res = run_leg_a(a, certificate=laundered, countersignatures=clean_countersignatures(a))
    assert res.verdict == BLOCK
    assert "v" in res.checks_failed

    art = clean_artifact()
    cs = clean_countersignatures(art)

    def verdict(conditions, artifact=art):
        cert = {"video": artifact["video"], "conditions": conditions}
        return run_leg_a(artifact, certificate=cert, countersignatures=cs).verdict

    # 6 entries all one anchor vs 3 real conditions → cardinality + duplication → BLOCK.
    assert verdict([{"quote_anchor": london, "char_span": [0, 0]} for _ in range(6)]) == BLOCK
    # 3 entries, only 2 distinct anchors (one duplicated) vs 3 conditions → BLOCK (dup can't
    # cover two slots, and the third condition is left unmatched).
    assert verdict([
        {"quote_anchor": london, "char_span": [0, 0]},
        {"quote_anchor": london, "char_span": [0, 0]},
        {"quote_anchor": "spine completion", "char_span": [0, 0]},
    ]) == BLOCK


def test_f2_a3_honest_certificate_reconciles_1to1():
    """Anti-vacuity for the bijection: the honest fixture's REAL cert PASSes because it is a
    genuine 1:1 ledger — one distinct anchor per taught condition (measured: zero cross-condition
    phrasing overlap, so the strict matching forces nothing)."""
    art = clean_artifact()
    cert = clean_certificate()
    n_taught = len(art["spec"]["entry_conditions"]) + len(art["spec"].get("invalidations") or [])
    assert len(cert["conditions"]) == n_taught  # 1:1 cardinality
    seal = run_leg_a_phase1(art, certificate=cert)
    assert seal.automated_verdict == PASS, sorted(seal.checks_failed)
    assert "v" not in seal.checks_failed


def test_f2b_nondict_countersignatures_is_graceful_block_not_crash():
    """A malformed (non-dict) countersignatures object must fail-closed BLOCK, never raise an
    uncaught AttributeError (a crash is not a fail-closed refusal)."""
    art = clean_artifact()
    cert = clean_certificate()
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
        run_leg_a_phase1(art, certificate=clean_certificate(), binding_plan=object())
    with pytest.raises(TypeError):
        run_leg_a(art, binding_plan=object())


# --------------------------------------------------------------------------- #
# ★ FIRST-ELIGIBLE RECEIPT (REDESIGN sub-packet 1, R-284 §1 pin (vi)) —
# the end-to-end proof this whole campaign was building toward: a spec whose
# load-bearing WAIT_SESSION condition is bound BY NAME reaches Leg A(ii) PASS,
# and the (ii) scope line names its PATH (name-route | zone | exact window).
# --------------------------------------------------------------------------- #
def test_first_eligible_receipt_name_bound_wait_session_passes_ii_with_scope_path():
    """A WAIT_SESSION condition whose object is an unambiguous CLOSED-ENUM session
    NAME ("london killzone session") binds to the EXACT killzone window —
    approximation=False, the enforced primitive is_in_killzone evaluates that
    window — so it is (ii)-ELIGIBLE and PASSES. Decision A §1(a) made honest, and
    the scope line carries the name-route path.

    ★ THE APPROXIMATION CAVEAT (stated, not hidden): static approximation=False is
    NECESSARY, not SUFFICIENT. This receipt is the STATIC compile-fidelity half —
    it proves no clock derivation is in the path. The RUNTIME companion (R-284 §1
    pin (v): the candidate's verdict window must show the family ran REAL at the
    T1 engagement bar) is OUT OF THIS SUB-PACKET'S SCOPE and is not asserted here.
    """
    art = clean_artifact()  # its load-bearing (ii) rows are name-bound WAIT_SESSION spine
    seal = run_leg_a_phase1(art, certificate=clean_certificate())

    ii_rows = [r for r in seal.rows if r.ii_applicable]
    assert ii_rows, "receipt requires a load-bearing (ii)-applicable condition"
    assert {r.type for r in ii_rows} == {"WAIT_SESSION"}

    saw_path = False
    for r in ii_rows:
        ii = [c for c in r.checks if c.code == "ii"][0]
        assert ii.passed, (r.condition_id, ii.reason)
        # (vi) the scope line names route + zone + exact window.
        assert "name-route|zone=" in ii.reason and "|window=[" in ii.reason, ii.reason
        saw_path = True
    assert saw_path

    # End-to-end: the whole Leg A PASSes (not just the (ii) row in isolation).
    full = run_leg_a(
        art,
        certificate=clean_certificate(),
        countersignatures=clean_countersignatures(art),
    )
    assert full.verdict == PASS, (sorted(full.checks_failed), full.summary)


def test_first_eligible_receipt_clock_derived_peer_is_refused_not_eligible():
    """The other half of the receipt — the discriminator. Swap the honest name for
    a clock-derived coarse teaching (same WAIT_SESSION family, flag ON) and the
    condition is REFUSED at the bind (bindable=False) → (ii) BLOCKs. The eligible
    row is eligible for the RIGHT reason (a name→exact-window), never a coarse
    proxy that the family-level honest read used to wave through."""
    import os

    from src.engine.spec_family_bindings import bind_condition

    prev = os.environ.get("TF_SESSION_ROLE_RESOLVER_ENABLED")
    os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = "true"
    try:
        name_bound = bind_condition(
            {"id": "r:name", "type": "WAIT_SESSION", "object": "the london killzone session", "role": "spine"}
        )
        clock_coarse = bind_condition(
            {"id": "r:clock", "type": "WAIT_SESSION", "object": "wait until 14:30 EST for the afternoon candle", "role": "spine"}
        )
    finally:
        if prev is None:
            os.environ.pop("TF_SESSION_ROLE_RESOLVER_ENABLED", None)
        else:
            os.environ["TF_SESSION_ROLE_RESOLVER_ENABLED"] = prev

    assert name_bound.bindable is True and name_bound.approximation is False
    assert name_bound.primitive == "session_windows.is_in_killzone"
    assert clock_coarse.bindable is False, "clock-derived coarse must refuse, never bind approximation=True"
    assert clock_coarse.reason == "session_teaching_recognized_no_computable_window"


# --------------------------------------------------------------------------- #
# R-291 §1 — CERTIFICATE INDEPENDENCE + OBJECT-ONLY (v) RECONCILIATION.
#
# The (v) drop-audit is only an audit if the certificate is INDEPENDENT of the spec it
# audits. Two circularity routes were live and are closed here:
#   (a) the FIXTURE route — `clean_certificate` built `{"quote_anchor": c["object"]}`, so the
#       calibrated baseline's certificate WAS the spec, verbatim;
#   (b) the PRODUCER route — `spec_producer._cert_span_for` stamped the certificate's own
#       quote_anchor into the condition's `evidence`, and (v) reconciled anchors against
#       [object, evidence] — i.e. against a copy of the certificate itself.
# --------------------------------------------------------------------------- #
def test_clean_certificate_is_transcript_derived_never_spec_derived():
    """STRUCTURAL GUARD on route (a). Every clean-certificate anchor must be a LITERAL quote of
    the independent transcript, carry that quote's REAL char_span, and be a DISTINCT string from
    every spec `object`. Re-couple the fixture to the spec (`quote_anchor: c["object"]`) and the
    identity assert below goes red."""
    cert = clean_certificate()
    objects = {c["object"] for c in clean_artifact()["spec"]["entry_conditions"]}
    assert cert["conditions"], "fixture certificate must not be empty"
    for entry in cert["conditions"]:
        anchor = entry["quote_anchor"]
        start, end = entry["char_span"]
        assert anchor in CLEAN_TRANSCRIPT, f"anchor {anchor!r} is not a transcript quote"
        assert CLEAN_TRANSCRIPT[start:end] == anchor, f"char_span {[start, end]} does not locate {anchor!r}"
        assert anchor not in objects, (
            f"anchor {anchor!r} is verbatim a spec object — the certificate is spec-DERIVED again "
            "and the (v) drop-audit is circular")


def test_synchronized_drop_is_convicted_because_the_certificate_is_independent():
    """★ THE FOUNDING SYNCHRONIZED-DROP RED-PROOF (R-291 §4). Drop a taught condition from the
    spec and rebuild the certificate the ORDINARY fixture way. Under the old spec-derived
    fixture the rebuilt certificate silently forgot the dropped condition, cardinality still
    matched, and Leg A PASSed — the drop was INVISIBLE. With a transcript-independent
    certificate the dropped condition's quote survives the drop, so the ledger is no longer 1:1
    → BLOCK on (v).

    ═══ ★★ LABEL — RED-PROOF **OF RECORD**, NOT A TRIPWIRE (R-302 §4). READ BEFORE COUNTING ═══
    THIS TEST DOES NOT BITE. It is the headline demonstration that the R-291 §1 close WORKS; it
    is NOT a guard that goes red if that close is undone. MEASURED, both applicable reversions,
    this file + test_calibration_battery_framework.py:
      · reversion (a) — re-couple `clean_certificate` to the spec (`{"quote_anchor": c["object"]}`):
        this test stays GREEN. 1 test bites, and it is a sibling:
        `test_clean_certificate_is_transcript_derived_never_spec_derived`.
      · reversion (b) — restore `evidence` to `cond_texts` in `_check_no_certificate_drops`:
        this test stays GREEN. 1 test bites, and it is a sibling:
        `test_v_reconciles_against_object_only_never_evidence`.
    It survives (a) because it rebuilds the certificate from the transcript through the fixture
    it is testing — re-couple the fixture and the ASSERTION MOVES WITH IT; it survives (b)
    because its anchors ground in `object` either way, so widening the match pool cannot break a
    match that already held.

    ★ WHY THE LABEL, AND WHY IT MUST NOT BE DELETED OR "STRENGTHENED" INTO A TRIPWIRE: an
    UNLABELLED NON-BITER IS THE SEED OF THE GUARD-THAT-SILENTLY-STOPPED-GUARDING SPECIES. A
    future census counting the R-291 §1 guards would read this one's name and headline star and
    score it among the biters, inflating the protection the close is believed to have. It is
    kept — a worked, readable exhibit of the defect and its cure is worth having — but it is
    counted as an EXHIBIT, never as an alarm.

    ★ WHERE THE BITE ACTUALLY LIVES — three siblings, each with its own reversion:
      1. `test_clean_certificate_is_transcript_derived_never_spec_derived`  → bites reversion (a)
      2. `test_v_reconciles_against_object_only_never_evidence`             → bites reversion (b)
      3. `test_calibration_battery_framework.py::
          test_r291_recoupling_the_fixture_certificate_drops_the_battery_out_of_CALIBRATED`
         → the CONTAINMENT alarm: proves m2's conviction is CONDITIONAL on the certificate's
           independence (re-coupled ⇒ battery falls CALIBRATED → FAILED), and red-proves at
           birth against the hand-planted-orphan restoration.
    If this test is ever made to bite, DELETE THIS LABEL in the same commit — a label that has
    stopped being true is worse than none.
    ═══════════════════════════════════════════════════════════════════════════════════════════
    """
    art = clean_artifact()
    dropped = art["spec"]["entry_conditions"][1]
    art["spec"]["entry_conditions"] = [
        c for c in art["spec"]["entry_conditions"] if c["id"] != dropped["id"]
    ]
    art["spec"]["and_groups"] = [[c["id"] for c in art["spec"]["entry_conditions"]]]
    art["spec_hash"] = _spec_hash(art["spec"])
    cert = clean_certificate()  # rebuilt AFTER the drop — and it still quotes the dropped condition
    assert any("am session" in c["quote_anchor"] for c in cert["conditions"]), (
        "the certificate stopped quoting the dropped condition — it is spec-derived again")
    result = run_leg_a(art, certificate=cert, countersignatures=clean_countersignatures(art))
    assert result.verdict == BLOCK and "v" in result.checks_failed, (
        f"synchronized drop was NOT surfaced: verdict={result.verdict} "
        f"checks_failed={sorted(result.checks_failed)}")


def test_v_reconciles_against_object_only_never_evidence():
    """★ OBJECT-ONLY BITE (route (b)). A certificate anchor that grounds ONLY in a condition's
    `evidence` and NOT in its `object` must not reconcile: `evidence` is a field the certificate
    itself used to author, so matching it is the audit checking the certificate against a copy
    of itself. Restore `evidence` to `cond_texts` in `_check_no_certificate_drops` and this goes
    green again (it PASSed before the change) — the assert is the reversion tripwire."""
    body = {
        "direction": "long",
        "entry_conditions": [
            {"id": "WAIT_SESSION:london#0", "type": "WAIT_SESSION",
             "object": "wait for the london killzone session", "role": "spine",
             "span": {"start": 0, "end": 0}, "evidence": "london killzone",
             "type_confidence": "confident"},
            {"id": "WAIT_SESSION:am#1", "type": "WAIT_SESSION",
             "object": "only trade during the am session", "role": "spine",
             "span": {"start": 0, "end": 0}, "evidence": "bos confirmation candle",
             "type_confidence": "confident"},
        ],
        "or_branches": [], "invalidations": [], "entry_trigger_id": None,
        "framework_overlay": clean_artifact()["spec"]["framework_overlay"],
    }
    body["and_groups"] = [[c["id"] for c in body["entry_conditions"]]]
    art = {"video": "OBJONLY", "spec_hash": _spec_hash(body), "graph_canonical_hash": "",
           "ledger_d": "UNKNOWN", "transcript_chars": 0, "spec": body}
    # anchor #2 token-matches ONLY cond #1's `evidence`, never its `object`.
    cert = {"video": "OBJONLY", "conditions": [
        {"quote_anchor": "wait for the london killzone session", "char_span": [0, 0]},
        {"quote_anchor": "bos confirmation candle", "char_span": [0, 0]},
    ]}
    result = run_leg_a(art, certificate=cert, countersignatures=clean_countersignatures(art))
    assert result.verdict == BLOCK and "v" in result.checks_failed, (
        f"an evidence-only anchor still reconciled: verdict={result.verdict} "
        f"checks_failed={sorted(result.checks_failed)} — (v) is reading `evidence` again")

    # DISCRIMINATING CONTROL: the same shape with an anchor that grounds in the OBJECT passes,
    # so the BLOCK above is about WHERE the anchor grounded, not a blanket refusal.
    cert_ok = {"video": "OBJONLY", "conditions": [
        {"quote_anchor": "wait for the london killzone session", "char_span": [0, 0]},
        {"quote_anchor": "only trade during the am session", "char_span": [0, 0]},
    ]}
    ok = run_leg_a(art, certificate=cert_ok, countersignatures=clean_countersignatures(art))
    assert "v" not in ok.checks_failed, (
        f"object-grounded control failed (v): {sorted(ok.checks_failed)} — (v) is vacuously blocking")
