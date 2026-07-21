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
    """Every condition binds approximation=False (two WAIT_SESSION spine conditions on distinct
    real killzones, an ENABLE_ENTRY trigger, an INVALIDATE) + a correctly-stamped house exit."""
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
        },
    ]
    inval = [
        {
            "id": "INVALIDATE:s#3", "type": "INVALIDATE", "object": "stop below the swing low",
            "role": "invalidation", "span": {"start": 0, "end": 0}, "evidence": "swing low stop",
            "type_confidence": "confident",
        },
    ]
    return {
        "direction": "long",
        "entry_conditions": entry,
        "and_groups": [[c["id"] for c in entry]],
        "or_branches": [],
        "invalidations": inval,
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

    # m2 — silently-dropped taught condition: drop the INVALIDATE from the spec but keep it in
    # the certificate → certificate-drop audit (v).
    a = clean_artifact()
    dropped = a["spec"]["invalidations"][0]
    a["spec"]["invalidations"] = []
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
