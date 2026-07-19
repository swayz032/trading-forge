"""H1 A-packet topology-producer engagement tests (ratify
`docs/designs/h1-a-packet-topology-producer-ratify-2026-07-15.md`, pins 2 + 3).

Every assertion below runs through the REAL harness: `produce_topology` ->
`assemble_certificate` (UNMODIFIED). Nothing here hand-builds a
`ConditionTopology` -- the point the fence build could only simulate is now
DERIVED by the producer and observed on a real certificate.

★ R-039 RE-LABEL (2026-07-18) -- READ FIRST. These are SYNTHETIC UNIT PROBES of
the 3 MECHANICAL structural lints' REACHABILITY and internal logic. They are
NOT, and must never be cited as, `full_grade`/merge-silencing SAFETY evidence.
Per R-039 (AR-030 finding) the mechanical lints are calibration-BLIND on prose
(a real `direction:"both"` object has no per-condition long/short, so
direction_conflation vacuously PASSes) and are DEMOTED to reachability
diagnostics at the cert layer; the load-bearing full_grade merge-silencing gate
is the calibrated SEMANTIC conflation verdict, proven on REAL fixtures in
`test_cert_assembler.py::test_full_grade_semantic_gate_*`. The hand-injected
per-condition `direction`/`or_group`/comparator fields below EXIST NOWHERE in
the real corpus -- they are legitimate ONLY as explicitly-labeled synthetic
probes of the lint machinery, per R-039 pin 4.

TERMINAL-READ RE-BASE (ratify-packet h1-conflation-wiring-ratify-2026-07-15.md):
the 3 structural lints do not gate `terminal_read_grade` (semantic conflation
does); this harness supplies no conflation verdict, so `certificate_for_strategy`
yields `terminal_read_grade == INDETERMINATE` (fail-closed). Assertions are at
the COMPILE-INTEGRITY level -- the mechanical lints' EVALUATE/PASS/FAIL
reachability, exactly what the producer is responsible for -- a DIAGNOSTIC
property, not a safety gate.

PROBE 2 (mechanical-lint reachability, both polarities, per-lint, all 3, never
NOT_EVALUATED on real topology -- the producer's salvaged DoD work):
  * merge-silenced R5L890 SYNTHETIC (2 opposite-direction setups with injected
                         per-condition direction) -> direction_conflation FAIL
                         (mechanical reachability only; the REAL R5L890-FUSED is
                         caught by the SEMANTIC gate, test_cert_assembler.py).
  * clean witness     -- clean directional split -> all 3 structural lints PASS.
  * unsat_sat         -- FAIL on "5-SMA > 50-SMA" AND "5-SMA < 50-SMA"; PASS on
                         the clean witness (no comparator to contradict).
  * or_alternatives   -- FAIL (flag off) / PASS (flag on) on an or_branches
                         fixture; PASS on the clean witness (nothing to honor).
  Each mechanical lint observed at PASS AND FAIL, never NOT_EVALUATED, on real
  topology -- reachability, not a safety claim.

PROBE 3 (null invariant): the real `_LS6` staging_v32 strategy (gestural exit,
null stop) -> topology_present=True -> all 3 structural lints EVALUATE (PASS).
An honest null is never punished with a compile failure or a NOT_EVALUATED.
"""

from __future__ import annotations

import json
import os

from src.engine.extraction import compile_lints as cl
from src.engine.extraction.topology_producer import produce_topology
from src.engine.tests._a_packet_harness import certificate_for_strategy

_STRUCTURAL = ("direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored")

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_STAGING = os.path.join(
    _ROOT, "docs", "replay-results", "h1-scripts", "claude-rung-designpool", "staging_v32"
)


def _status(cert: dict, lint: str) -> str:
    return cert["compile_integrity"][lint]["status"]


def _assert_all_structural_evaluate(cert: dict) -> None:
    """No structural lint may ever be NOT_EVALUATED on real topology (pin 2)."""
    for name in _STRUCTURAL:
        assert _status(cert, name) != cl.STATUS_NOT_EVALUATED, (
            f"{name} was NOT_EVALUATED on real topology -- the A-packet forcing "
            f"function did not fire (topology overlay missing?)"
        )


# --------------------------------------------------------------------------- #
# Fixtures (strategy dicts -> produce_topology -> assemble_certificate)
# --------------------------------------------------------------------------- #

# The merge-silencing type-specimen (R5L890, the 3rd disease): ONE strategy
# object fuses two OPPOSITE-direction setups with no OR routing -> both land in
# and_group=0 -> direction_conflation FIRES.
_MERGE_SILENCED = {
    "name": "merge_silenced_r5l890_adversarial",
    "direction": "both",
    "entry_sequence": [
        {"action": "go long when the 5-SMA crosses above the 50-SMA", "direction": "long"},
        {"action": "go short when the 5-SMA crosses below the 50-SMA", "direction": "short"},
    ],
}

# A correctly-split single-direction strategy: no opposite directions, no
# symbolic comparators, no OR-alternatives -> all 3 structural lints PASS.
_CLEAN_SPLIT = {
    "name": "clean_long_pullback",
    "direction": "long",
    "entry_sequence": [
        {"action": "buy the pullback into the reclaimed vwap support"},
        {"action": "add on the retest of the whole-dollar level as it holds"},
    ],
    "confluences": [
        {"description": "a run of green candles as volume comes back in"},
    ],
    "stop": None,
    "targets": [],
}

# unsatisfiable AND: 5-SMA cannot be simultaneously above and below the 50-SMA.
_UNSAT = {
    "name": "unsat_sma_contradiction",
    "direction": "long",
    "entry_sequence": [
        {"action": "requires 5-SMA > 50-SMA to confirm the uptrend"},
        {"action": "and simultaneously requires 5-SMA < 50-SMA for the pullback"},
    ],
}

# genuine OR-alternatives the extraction marked mutually-substitutable (shared
# or_group tag), both spine-role. With the engine's or-honoring flag OFF the
# alternation is strictly ANDed -> or_alternatives_honored FIRES.
_OR_ALTERNATIVES = {
    "name": "or_variant_entries",
    "direction": "long",
    "entry_sequence": [
        {"action": "take the entry on a vwap retest", "or_group": "entry_variant"},
        {"action": "or take the entry on a pre-market-low retest", "or_group": "entry_variant"},
    ],
}


# --------------------------------------------------------------------------- #
# REJECTED witness + CLEAN witness (pin 2 headline pair)
# --------------------------------------------------------------------------- #


def test_merge_silenced_r5l890_synthetic_direction_conflation_mechanical_fail():
    """SYNTHETIC PROBE (R-039 pin 4): the producer derives and_group=0 + opposite
    directions FROM INJECTED per-condition direction fields, so the mechanical
    direction_conflation_lint FIRES. This proves the lint's reachability/logic on
    structured input -- NOT that merge-silencing is caught in production (real
    prose has no such fields; the SEMANTIC gate catches it, test_cert_assembler)."""
    cert = certificate_for_strategy(_MERGE_SILENCED, source_video_id="R5L890juvRw")
    _assert_all_structural_evaluate(cert)
    assert _status(cert, "direction_conflation_lint") == cl.STATUS_FAIL
    # full_grade False here via fail-closed (no conflation verdict from this
    # harness), NOT because the mechanical lint gates it -- it no longer does.
    assert cert["full_grade"] is False
    # terminal read is now conflation-driven; this harness supplies no conflation
    # verdict -> INDETERMINATE (fail-closed), and the structural lints are marked
    # re-stationed, not gating.
    assert cert["terminal_read_grade"] == "INDETERMINATE"
    assert cert["terminal_read_clean"] is False
    assert cert["terminal_read_disposition"]["direction_conflation_lint"] == "RE_STATIONED_TO_H2"


def test_producer_itself_derives_the_conflation_not_the_harness():
    """Proves produce_topology DERIVES and_group=0 + opposite directions from
    the extraction (the fence build could only hand-simulate this)."""
    from src.engine.tests._a_packet_harness import build_inputs

    _t, _det, entries = build_inputs(_MERGE_SILENCED)
    topo, or_branches = produce_topology(_MERGE_SILENCED, entries)
    assert or_branches == []
    rows = list(topo.values())
    assert {r.and_group for r in rows} == {0}
    assert {r.direction for r in rows} == {"long", "short"}


def test_clean_split_all_structural_pass():
    cert = certificate_for_strategy(_CLEAN_SPLIT)
    _assert_all_structural_evaluate(cert)
    for name in _STRUCTURAL:
        assert _status(cert, name) == cl.STATUS_PASS, name
    # structurally clean; terminal read is conflation-driven -> INDETERMINATE
    # here (no conflation verdict from this harness), never falsely CLEAN.
    assert cert["terminal_read_grade"] == "INDETERMINATE"
    assert cert["terminal_read_clean"] is False


# --------------------------------------------------------------------------- #
# Per-lint FAIL polarity (each EVALUATE, never NOT_EVALUATED)
# --------------------------------------------------------------------------- #


def test_unsat_sat_check_fires_on_contradictory_comparators():
    cert = certificate_for_strategy(_UNSAT)
    _assert_all_structural_evaluate(cert)
    assert _status(cert, "unsat_sat_check") == cl.STATUS_FAIL
    # isolates unsat_sat as the sole mechanical structural failure (reachability
    # probe; full_grade False via fail-closed, not because this lint gates it)
    assert _status(cert, "direction_conflation_lint") == cl.STATUS_PASS
    assert _status(cert, "or_alternatives_honored") == cl.STATUS_PASS
    assert cert["full_grade"] is False
    # terminal read conflation-driven -> INDETERMINATE (no verdict from harness)
    assert cert["terminal_read_grade"] == "INDETERMINATE"


def test_or_alternatives_honored_both_polarities(monkeypatch):
    # FAIL polarity: engine or-honoring flag OFF -> alternatives strictly ANDed.
    monkeypatch.delenv("TF_OR_BRANCHES_ENABLED", raising=False)
    cert_off = certificate_for_strategy(_OR_ALTERNATIVES)
    _assert_all_structural_evaluate(cert_off)
    assert _status(cert_off, "or_alternatives_honored") == cl.STATUS_FAIL
    assert _status(cert_off, "direction_conflation_lint") == cl.STATUS_PASS
    assert _status(cert_off, "unsat_sat_check") == cl.STATUS_PASS
    # mechanical FAIL is a reachability probe; full_grade False via fail-closed.
    assert cert_off["full_grade"] is False

    # PASS polarity: flag ON -> the alternation is honored -> structural PASS.
    monkeypatch.setenv("TF_OR_BRANCHES_ENABLED", "true")
    cert_on = certificate_for_strategy(_OR_ALTERNATIVES)
    _assert_all_structural_evaluate(cert_on)
    assert _status(cert_on, "or_alternatives_honored") == cl.STATUS_PASS


# --------------------------------------------------------------------------- #
# Both-polarity coverage matrix (pin 2 explicit): every structural lint at a
# PASS AND a FAIL, all EVALUATE, on real topology.
# --------------------------------------------------------------------------- #


def test_every_structural_lint_seen_at_pass_and_fail_on_real_topology(monkeypatch):
    monkeypatch.delenv("TF_OR_BRANCHES_ENABLED", raising=False)
    clean = certificate_for_strategy(_CLEAN_SPLIT)
    merge = certificate_for_strategy(_MERGE_SILENCED)
    unsat = certificate_for_strategy(_UNSAT)
    or_fail = certificate_for_strategy(_OR_ALTERNATIVES)

    observed = {name: set() for name in _STRUCTURAL}
    for cert in (clean, merge, unsat, or_fail):
        _assert_all_structural_evaluate(cert)
        for name in _STRUCTURAL:
            observed[name].add(_status(cert, name))

    for name in _STRUCTURAL:
        assert cl.STATUS_PASS in observed[name], f"{name} never observed PASS"
        assert cl.STATUS_FAIL in observed[name], f"{name} never observed FAIL"
        assert cl.STATUS_NOT_EVALUATED not in observed[name], f"{name} was NOT_EVALUATED"


# --------------------------------------------------------------------------- #
# PIN 3 -- the null invariant on the REAL _LS6 staging_v32 strategy
# --------------------------------------------------------------------------- #


def _load_staging(video_stub: str) -> dict:
    path = os.path.join(_STAGING, f"{video_stub}.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def test_LS6_gestural_exit_null_stop_structural_clean():
    """_LS6 dip-buy: gestural exit, null stop -> topology over PRESENT
    conditions only -> topology_present=True -> all 3 structural lints PASS.
    The honest null is not punished (no fabricated condition, no compile
    failure). Terminal read is conflation-driven (INDETERMINATE here, no
    verdict), so the null invariant is asserted at the structural-lint level."""
    doc = _load_staging("_LS6qcSlDCs__s0")
    strategy = doc["strategies"][0]
    assert strategy["stop"] is None  # the honest null we must not punish
    cert = certificate_for_strategy(strategy, source_video_id="_LS6qcSlDCs")
    _assert_all_structural_evaluate(cert)
    for name in _STRUCTURAL:
        assert _status(cert, name) == cl.STATUS_PASS, name
    assert cert["compile_integrity"]["f2_coverage_gate"]["status"] == cl.STATUS_PASS
    # terminal read conflation-driven -> INDETERMINATE (no verdict), not falsely CLEAN
    assert cert["terminal_read_grade"] == "INDETERMINATE"


def test_null_stop_and_empty_targets_contribute_no_condition():
    """Structural proof of the null design: an absent stop / empty targets add
    NO ConditionTopology row (never a fabricated condition, never a compile
    failure)."""
    from src.engine.tests._a_packet_harness import build_inputs

    doc = _load_staging("_LS6qcSlDCs__s0")
    strategy = doc["strategies"][0]
    _t, _det, entries = build_inputs(strategy)
    kinds = {e.field_kind for e in entries}
    assert "stop" not in kinds  # null stop contributed nothing
    assert "target" not in kinds  # empty targets contributed nothing
    assert entries  # but the present entry/confluence conditions DID produce rows
    topo, _or = produce_topology(strategy, entries)
    assert len(topo) == len(entries)
