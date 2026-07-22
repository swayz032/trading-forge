"""Shared fixtures for the survivor-forensics Leg A + §4 battery tests.

NOT a test module (leading underscore → pytest does not collect it). It builds:
  - a SYNTHETIC KNOWN-GOOD SpecArtifact that PASSES Leg A whole (needed by §4 — no real corpus
    spec passes Leg A(ii) today, so the battery's clean baseline is synthetic by necessity);
  - a matching certificate + clean fresh-reader countersignatures;
  - FRAMEWORK_DEMONSTRATION_PLACEHOLDER mutation builders (m1..m7) that EXERCISE the harness.

★ These placeholders are NOT the live m1..m7 calibration mutations. Per the frozen pre-reg §4
(doer != grader), the live seven are authored by an INDEPENDENT grader. Every placeholder is
labelled PLACEHOLDER_LABEL and can never yield battery status CALIBRATED.
"""

from __future__ import annotations

from src.engine.extraction.spec_producer import _HOUSE_DEFAULT_EXIT, _spec_hash
from src.engine.forensics.calibration_battery import PLACEHOLDER_LABEL, LegAInputs, MutationCase
from src.engine.forensics.compile_fidelity import HOUSE_EXIT_SOURCE, run_leg_a_phase1

VIDEO = "SYNTH_KNOWN_GOOD_0001"


def _rehash(artifact: dict) -> dict:
    """Recompute spec_hash over the (possibly mutated) spec body so provenance check (vi)
    reflects the CURRENT body — used by every mutant that legitimately edits the spec and does
    NOT intend to break the hash chain."""
    artifact["spec_hash"] = _spec_hash(artifact["spec"])
    return artifact


def clean_spec_body() -> dict:
    """The honest-good known-good spec: its LOAD-BEARING (ii)-applicable conditions are two
    WAIT_SESSION spine conditions on distinct real killzones, which are GENUINELY honest-bound
    (approximation=False under the enforced honest accounting) — the RIGHT reason it passes
    Leg A(ii), never a convenience label (R-260 §1).

    The ENABLE_ENTRY entry trigger is dispositioned NON-load-bearing: by its family declaration
    it is `gates=False` — it computes no independent per-bar signal, the trigger IS the
    conjunction of the spine conditions, each of which is load-bearing and audited under (ii).
    So it carries no independent binding to audit; the disposition states exactly that. (A
    LOAD-BEARING ENABLE_ENTRY/ENTER or INVALIDATE now honestly FAILS (ii) — enforced
    approximation=True — so none may appear load-bearing in a whole-passing fixture; the
    INVALIDATE-leaning and ENABLE_ENTRY-leaning BLOCK cases are exercised by dedicated
    red-proofs.)"""
    entry = [
        {
            "id": "WAIT_SESSION:london#0", "type": "WAIT_SESSION",
            "object": "wait for the london killzone session", "role": "spine",
            "span": {"start": 0, "end": 0}, "evidence": "london killzone", "type_confidence": "confident",
        },
        {
            "id": "WAIT_SESSION:am#1", "type": "WAIT_SESSION",
            "object": "only trade during the am session", "role": "spine",
            "span": {"start": 0, "end": 0}, "evidence": "am session", "type_confidence": "confident",
        },
        {
            "id": "ENABLE_ENTRY:t#2", "type": "ENABLE_ENTRY", "object": "spine completion",
            "role": "trigger", "span": {"start": 0, "end": 0}, "evidence": "trigger",
            "type_confidence": "confident",
            "load_bearing": False,
            "non_lb_disposition": (
                "structural entry trigger (role=trigger); gates=False by family — the trigger is "
                "the spine conjunction, whose members are load-bearing and audited under (ii)"
            ),
        },
    ]
    return {
        "direction": "long",
        "entry_conditions": entry,
        "and_groups": [[c["id"] for c in entry]],
        "or_branches": [],
        "invalidations": [],
        "entry_trigger_id": "ENABLE_ENTRY:t#2",
        "framework_overlay": {"exit": _HOUSE_DEFAULT_EXIT, "exit_source": HOUSE_EXIT_SOURCE},
    }


def clean_artifact() -> dict:
    body = clean_spec_body()
    return {
        "video": VIDEO,
        "spec_hash": _spec_hash(body),
        "graph_canonical_hash": "",
        "ledger_d": "UNKNOWN",
        "transcript_chars": 0,
        "spec": body,
    }


def clean_certificate(body: dict | None = None) -> dict:
    body = body or clean_spec_body()
    conds = (body.get("entry_conditions") or []) + (body.get("invalidations") or [])
    return {
        "video": VIDEO,
        "conditions": [{"quote_anchor": c["object"], "char_span": [0, 0]} for c in conds],
    }


def clean_countersignatures(artifact: dict | None = None) -> dict:
    """A clean fresh-reader countersign for every row Phase 1 requires. (In production these are
    supplied by an independent fresh reader — here they stand in for that channel.)"""
    artifact = artifact or clean_artifact()
    seal = run_leg_a_phase1(artifact, certificate=clean_certificate(artifact["spec"]))
    return {
        cid: {"reader_id": "fresh-reader-1", "reader_vintage": "v1", "typing": True, "polarity": True, "drops": True}
        for cid in seal.countersign_required_ids
    }


def clean_inputs() -> LegAInputs:
    art = clean_artifact()
    return LegAInputs(
        artifact=art,
        certificate=clean_certificate(art["spec"]),
        countersignatures=clean_countersignatures(art),
    )


# --------------------------------------------------------------------------- #
# PLACEHOLDER mutations — one worked example per class, each labelled a placeholder.
# --------------------------------------------------------------------------- #
def _mutant_inputs(artifact: dict, *, cert: dict | None = None, countersigns: dict | None = None) -> LegAInputs:
    art = artifact
    cert = cert if cert is not None else clean_certificate(art["spec"])
    countersigns = countersigns if countersigns is not None else clean_countersignatures(art)
    return LegAInputs(artifact=art, certificate=cert, countersignatures=countersigns)


def placeholder_cases() -> dict[str, MutationCase]:
    cases: dict[str, MutationCase] = {}

    # m1 — mis-typed family: a WAIT_SESSION (approx=False) retyped FILTER (approx=True) → (ii).
    a = clean_artifact()
    a["spec"]["entry_conditions"][0]["type"] = "FILTER"
    _rehash(a)
    cases["m1"] = MutationCase("m1", PLACEHOLDER_LABEL, "ii", _mutant_inputs(a), is_placeholder=True)

    # m2 — silently-dropped taught condition: drop a spine condition from the spec but keep it
    # in the certificate → certificate-drop audit (v). (Was the INVALIDATE, removed from the
    # honest-good fixture because a load-bearing INVALIDATE now honestly fails (ii); a dropped
    # spine exercises the same (v) drop-audit.)
    a = clean_artifact()
    dropped = a["spec"]["entry_conditions"][1]  # the am-session spine
    a["spec"]["entry_conditions"] = [c for c in a["spec"]["entry_conditions"] if c["id"] != dropped["id"]]
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    _rehash(a)
    cert = clean_certificate(a["spec"])
    cert["conditions"].append({"quote_anchor": dropped["object"], "char_span": [0, 0]})
    cases["m2"] = MutationCase("m2", PLACEHOLDER_LABEL, "v", _mutant_inputs(a, cert=cert), is_placeholder=True)

    # m3 — flipped polarity: artifact clean, but the fresh reader DISSENTS on polarity for one
    # condition → the Phase-2 countersign channel (targeted check 'countersign').
    a = clean_artifact()
    cs = clean_countersignatures(a)
    first_id = next(iter(cs))
    cs[first_id] = {**cs[first_id], "polarity": False}
    cases["m3"] = MutationCase("m3", PLACEHOLDER_LABEL, "countersign", _mutant_inputs(a, countersigns=cs), is_placeholder=True)

    # m4 — false-flag: a proxy-bound (approx=True live) condition whose RECORD claims
    # approximation=False → m4_false_flag (re-derivation catches the lie).
    a = clean_artifact()
    a["spec"]["entry_conditions"].append({
        "id": "WAIT_STRUCTURE:x#9", "type": "WAIT_STRUCTURE",
        "object": "wait for a break of structure", "role": "spine",
        "span": {"start": 0, "end": 0}, "evidence": "bos", "type_confidence": "confident",
        "approximation": False,  # the false flag
    })
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    _rehash(a)
    cert = clean_certificate(a["spec"])
    cases["m4"] = MutationCase("m4", PLACEHOLDER_LABEL, "m4_false_flag", _mutant_inputs(a, cert=cert), is_placeholder=True)

    # m5 — house-default exit missing its provenance stamp.
    a = clean_artifact()
    a["spec"]["framework_overlay"] = {"exit": "style_c", "exit_source": HOUSE_EXIT_SOURCE}
    _rehash(a)
    cases["m5"] = MutationCase("m5", PLACEHOLDER_LABEL, "iv", _mutant_inputs(a), is_placeholder=True)

    # m6 — broken spec<->certificate chain: certificate names a different extraction.
    a = clean_artifact()
    cert = clean_certificate(a["spec"])
    cert["video"] = "SOME_OTHER_VIDEO_9999"
    cases["m6"] = MutationCase("m6", PLACEHOLDER_LABEL, "vi_cert", _mutant_inputs(a, cert=cert), is_placeholder=True)

    # m7 — taught condition mislabeled non-load-bearing WITHOUT a disposition.
    a = clean_artifact()
    a["spec"]["entry_conditions"][0]["load_bearing"] = False  # no non_lb_disposition
    _rehash(a)
    cases["m7"] = MutationCase("m7", PLACEHOLDER_LABEL, "v_nonlb", _mutant_inputs(a), is_placeholder=True)

    return cases


# --------------------------------------------------------------------------- #
# m2 BOTH-FORMS — REAL (non-placeholder) grader-authored cases (R-268 §3 / R-267 §1).
#
# These are the FIRST live, non-placeholder m2 cases: the m2 slot must convict BOTH the
# naive drop (orphan certificate entry → cardinality mismatch) AND the laundered drop
# (drop a condition, refill its cert slot with a DUPLICATE of a kept anchor → distinctness/
# unmatched), each with its OWN anti-vacuity companion on check (v). Authored in the
# test/fixtures layer by the INDEPENDENT grader; the detector code is untouched.
# --------------------------------------------------------------------------- #
def m2_naive_drop_inputs() -> LegAInputs:
    """m2-naive: drop the am-session spine from the spec but leave its ORPHAN entry in the
    certificate. Taught count drops to 2 while the certificate keeps 3 anchors → the (v) 1:1
    reconciliation fails on cardinality (n_cert != n_taught) AND the orphan is unmatched → BLOCK
    on (v)."""
    a = clean_artifact()
    dropped = a["spec"]["entry_conditions"][1]  # the am-session spine
    a["spec"]["entry_conditions"] = [c for c in a["spec"]["entry_conditions"] if c["id"] != dropped["id"]]
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    _rehash(a)
    cert = clean_certificate(a["spec"])  # london + ENABLE_ENTRY anchors (matches the 2 kept conds)
    cert["conditions"].append({"quote_anchor": dropped["object"], "char_span": [0, 0]})  # ORPHAN
    return _mutant_inputs(a, cert=cert)


def m2_launder_drop_inputs() -> LegAInputs:
    """m2-launder: drop the am-session spine, then REFILL its certificate slot with a DUPLICATE
    of a KEPT condition's anchor (london's) so cardinality is PRESERVED (n_cert == n_taught == 2).
    Cardinality no longer betrays the drop — but the 1:1 bipartite matching does: the duplicated
    london anchor can only claim ONE taught condition, leaving the second cert entry unmatched
    (laundered anchor) and the ENABLE_ENTRY taught condition with no matching cert entry (silent
    drop). BLOCK on (v) via the distinctness constraint, NOT cardinality."""
    a = clean_artifact()
    dropped = a["spec"]["entry_conditions"][1]  # am-session spine
    kept = a["spec"]["entry_conditions"][0]     # london spine (its anchor is duplicated)
    a["spec"]["entry_conditions"] = [c for c in a["spec"]["entry_conditions"] if c["id"] != dropped["id"]]
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    _rehash(a)
    cert = clean_certificate(a["spec"])
    cert["conditions"] = [
        {"quote_anchor": kept["object"], "char_span": [0, 0]},
        {"quote_anchor": kept["object"], "char_span": [0, 0]},  # DUPLICATE of a kept anchor
    ]
    return _mutant_inputs(a, cert=cert)


def shared_anchor_legit_companion() -> LegAInputs:
    """The launder case's PURPOSE-BUILT anti-vacuity companion: an ALL-PRESENT control in which
    two DISTINCT present spine conditions are each grounded ONCE by a SHARED 2-token anchor
    ("london session"), cardinality-matched. The 1:1 matching still succeeds (each cert entry is
    assigned to a distinct present condition), so it PASSES (v) — proving the launder detector
    fires on the DROP, not on any duplicate-looking anchor. (The stock clean fixture uses DISTINCT
    anchors and never exercises the shared-anchor-legit property, so this must be purpose-built.)
    Both conditions bind honestly to the recognized 'london session' keyword, so the control also
    passes Leg A whole — the (v) pass is genuine, not a vacuous fail-closed skip."""
    a = clean_artifact()
    conds = a["spec"]["entry_conditions"]
    conds[0]["object"] = "wait for the london session to open"
    conds[0]["evidence"] = "london session"
    conds[1]["object"] = "trade only in the london session"
    conds[1]["evidence"] = "london session"
    _rehash(a)
    shared = "london session"
    cert = {
        "video": VIDEO,
        "conditions": [
            {"quote_anchor": shared, "char_span": [0, 0]},              # grounds spine cond 0
            {"quote_anchor": shared, "char_span": [0, 0]},              # grounds spine cond 1 (SHARED)
            {"quote_anchor": conds[2]["object"], "char_span": [0, 0]},  # ENABLE_ENTRY trigger
        ],
    }
    return _mutant_inputs(a, cert=cert)


def m2_both_forms_cases() -> list[MutationCase]:
    """The two REAL (non-placeholder) m2 cases as a LIST for the m2 slot — naive drop + laundered
    drop, each targeting (v), each with its OWN distinguishing anti-vacuity companion."""
    return [
        MutationCase(
            "m2", "m2-naive-drop-orphan-cert", "v", m2_naive_drop_inputs(),
            is_placeholder=False, companion=clean_inputs(),
        ),
        MutationCase(
            "m2", "m2-launder-duplicate-anchor", "v", m2_launder_drop_inputs(),
            is_placeholder=False, companion=shared_anchor_legit_companion(),
        ),
    ]


# --------------------------------------------------------------------------- #
# R-272 SIX-SLOT WAVE — REAL (non-placeholder) grader-authored cases for the remaining
# slots whose class survived an adversarial evasion probe. m6 and m7 are DELIBERATELY
# ABSENT here: their adversarial sub-cases DEFEATED the detector (fail-open holes — see the
# TRIPWIRE tests in test_calibration_battery_framework.py), so per R-272 §2 their "pass" is
# withheld pending a doer's fix. Detector code is untouched by all of this.
# --------------------------------------------------------------------------- #
def m1_mistyped_family_inputs() -> LegAInputs:
    """m1: a load-bearing structural spine (WAIT_SESSION, honest approximation=False) is
    mis-typed as FILTER (a proxy/pass-through family whose enforced-honest approximation is
    True). The live re-derived binding makes (ii) categorical: a load-bearing proxy is an
    approximation → BLOCK on (ii). (Every non-session family is honest-approx=True, so there is
    NO honest family to hide a mistyped structural spine in — the class has no (ii)-evasion.)"""
    a = clean_artifact()
    a["spec"]["entry_conditions"][0]["type"] = "FILTER"
    _rehash(a)
    return _mutant_inputs(a)


def m3_polarity_dissent_inputs() -> LegAInputs:
    """m3: the artifact is structurally clean, but the INDEPENDENT fresh reader DISSENTS on the
    polarity row for one condition (polarity=False). Polarity is a Phase-2 semantic judgement;
    a dissent fail-closes the countersign → BLOCK on 'countersign'."""
    a = clean_artifact()
    cs = clean_countersignatures(a)
    first_id = next(iter(cs))
    cs[first_id] = {**cs[first_id], "polarity": False}
    return _mutant_inputs(a, countersigns=cs)


def m3_polarity_clean_companion() -> LegAInputs:
    """m3 companion: the SAME artifact with a CLEAN (all-agree) fresh-reader countersign — the
    automated leg passes so Phase-2 actually runs and the countersign check is genuinely reached
    and PASSES (non-vacuous)."""
    return clean_inputs()


def m4_false_flag_inputs() -> LegAInputs:
    """m4: a proxy-bound LOAD-BEARING condition (WAIT_STRUCTURE, live honest approximation=True)
    whose stored record CLAIMS approximation=False. The m4 row re-derives the live flag and
    convicts the lie → BLOCK on 'm4_false_flag' (the row also fails (ii), as an honest proxy
    should)."""
    a = clean_artifact()
    a["spec"]["entry_conditions"].append({
        "id": "WAIT_STRUCTURE:x#9", "type": "WAIT_STRUCTURE",
        "object": "wait for a break of structure", "role": "spine",
        "span": {"start": 0, "end": 0}, "evidence": "bos", "type_confidence": "confident",
        "approximation": False,  # the false flag
    })
    a["spec"]["and_groups"] = [[c["id"] for c in a["spec"]["entry_conditions"]]]
    _rehash(a)
    return _mutant_inputs(a, cert=clean_certificate(a["spec"]))


def m4_matching_label_companion() -> LegAInputs:
    """m4 companion: a WAIT_SESSION (live honest approximation=False) whose stored record HONESTLY
    claims approximation=False — the m4 row is genuinely REACHED and evaluated as a MATCH (PASS),
    not merely absent. The spec is otherwise clean and passes Leg A whole (non-vacuous)."""
    a = clean_artifact()
    a["spec"]["entry_conditions"][0]["approximation"] = False  # matches the live binding
    _rehash(a)
    return _mutant_inputs(a)


def m5_unstamped_exit_inputs() -> LegAInputs:
    """m5: the house-default exit VALUE is present in the framework overlay but its provenance
    stamp (exit_source) is stripped (None). A present-but-unstamped house exit → BLOCK on (iv)."""
    a = clean_artifact()
    a["spec"]["framework_overlay"] = {"exit": _HOUSE_DEFAULT_EXIT, "exit_source": None}
    _rehash(a)
    return _mutant_inputs(a)


def robust_six_real_cases() -> dict[str, MutationCase]:
    """The FOUR slots whose class survived the adversarial probe (m1, m3, m4, m5), each a REAL
    (non-placeholder) case with its own anti-vacuity companion. m2 is authored separately
    (both-forms); m6 and m7 are withheld (detector holes)."""
    return {
        "m1": MutationCase("m1", "m1-mistyped-structure-as-filter", "ii",
                           m1_mistyped_family_inputs(), is_placeholder=False, companion=clean_inputs()),
        "m3": MutationCase("m3", "m3-fresh-reader-polarity-dissent", "countersign",
                           m3_polarity_dissent_inputs(), is_placeholder=False,
                           companion=m3_polarity_clean_companion()),
        "m4": MutationCase("m4", "m4-proxy-mislabeled-approx-false", "m4_false_flag",
                           m4_false_flag_inputs(), is_placeholder=False,
                           companion=m4_matching_label_companion()),
        "m5": MutationCase("m5", "m5-house-exit-unstamped", "iv",
                           m5_unstamped_exit_inputs(), is_placeholder=False, companion=clean_inputs()),
    }
