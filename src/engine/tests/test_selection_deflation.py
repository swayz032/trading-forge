"""Selection-side deflation-check red-proofs (gate-recalibration pre-reg §2/§3,
`docs/designs/gate-recalibration-checkpoints-preregistration-2026-07-19.md`).

Red-proofs BOTH poles, registered as REVIVAL PROBES (they stay in the suite):
  * POLE A (engage): a synthetic counter with effective-N >= 200 makes the check
    ENGAGE and LATCH; the latch is PERSISTENT (F3) — it survives a re-run and does
    NOT un-cross when a later effective-N drops below the checkpoint.
  * POLE B (inert TODAY): the REAL canonical counter (effective-N = 32) leaves the
    check correctly INERT — no fire, no latch. This is also a TRIPWIRE: it asserts
    the real effective-N is still < 200, so the day the campaign crosses 200 this
    probe goes RED = "candidacy scale reached; wire the selection-deflation check
    into the real candidacy path."

The boundary (distance to next checkpoint) is printed beside every verdict.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.engine.battery.selection_deflation import (
    _print_boundary,
    run_selection_deflation_check,
)
from src.engine.battery.trial_counter import TrialCounter

# Repo root = three parents up from src/engine/tests/this_file.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_CANONICAL_COUNTER = _REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "trial-counter.json"


def _counter_with_effective_n(tmp_path, n: int, *, tag: str = "syn") -> TrialCounter:
    """Build a counter with exactly `n` distinct executed groups (each a unique,
    complete dedup tuple), so effective_n == n. Uses the real allocate/finalize
    path — no hand-built rows."""
    tc = TrialCounter(str(tmp_path / f"{tag}-counter.json"), engine_sha_at_zero="SYN")
    for i in range(n):
        tid = tc.allocate(
            wave="syn-wave",
            strategy_ref=f"{tag}_{i}",
            spec_hash=f"spec{i:04d}",       # unique per trial -> unique group
            engine_sha="SYN",
            binding_approximation_rate=0.99,
            survivor_eligible=True,
            dataset_hash="ds0",             # complete tuple (non-null) so it dedups honestly
            config_hash="cfg0",
        )
        tc.finalize(tid, "PASS", summary_sharpe=0.5)
    return tc


# ─────────────────────────── POLE A: ENGAGE + LATCH ──────────────────────────
def test_pole_a_engages_and_latches_at_200(tmp_path, capsys):
    tc = _counter_with_effective_n(tmp_path, 200)
    assert tc.effective_n(wave=None)["effective_n"] == 200, "synthetic pole must be exactly at the 200 mark"

    log = tmp_path / "check-log.json"
    v = run_selection_deflation_check(tc, log_path=str(log))
    _print_boundary(v)

    assert v["verdict"] == "ENGAGED"
    assert v["engaged"] is True
    assert v["crossed"] == [200]           # 200 crossed, 500 not
    assert v["newly_latched"] == [200]     # first observation -> latched (F3)
    assert v["latched"] == [200]
    assert v["next_checkpoint"] == 500 and v["distance_to_next_checkpoint"] == 300
    # the audit record persisted the §3 companions
    doc = json.load(open(log, encoding="utf-8"))
    assert doc["latched"] == [200]
    assert doc["checks"][0]["raw_n"] == 200 and doc["checks"][0]["effective_n"] == 200


def test_pole_a_latch_is_persistent_and_idempotent_and_does_not_uncross(tmp_path):
    """F3: a re-run does not re-latch; and a LATER lower effective-N does NOT
    un-cross the obligation."""
    log = tmp_path / "check-log.json"

    # First: at 200 -> latches.
    tc_hi = _counter_with_effective_n(tmp_path, 200, tag="hi")
    v1 = run_selection_deflation_check(tc_hi, log_path=str(log))
    assert v1["newly_latched"] == [200] and v1["latched"] == [200]

    # Re-run the SAME high counter -> already latched, no new latch, still latched.
    v2 = run_selection_deflation_check(tc_hi, log_path=str(log))
    assert v2["newly_latched"] == [], "idempotent — an already-latched checkpoint never re-latches"
    assert v2["latched"] == [200]

    # Now a DIFFERENT counter whose effective-N is BELOW 200 (simulating a
    # backfill-collapse decrease) runs against the SAME log -> crossed empty this
    # check, but the persistent latch STAYS (F3 — decreases never un-cross).
    tc_lo = _counter_with_effective_n(tmp_path, 150, tag="lo")
    v3 = run_selection_deflation_check(tc_lo, log_path=str(log))
    assert v3["crossed"] == [], "this observation is below the mark"
    assert v3["engaged"] is False, "this single observation does not itself engage"
    assert v3["latched"] == [200], "F3: the latched obligation is NOT un-crossed by a later decrease"


def test_pole_a_crosses_both_checkpoints_at_500(tmp_path):
    tc = _counter_with_effective_n(tmp_path, 500, tag="big")
    v = run_selection_deflation_check(tc, log_path=str(tmp_path / "log.json"))
    assert v["crossed"] == [200, 500]
    assert v["newly_latched"] == [200, 500]
    assert v["latched"] == [200, 500]
    assert v["next_checkpoint"] is None and v["distance_to_next_checkpoint"] is None


# ─────────────────────── POLE B: INERT TODAY (real counter) ──────────────────
def test_pole_b_real_counter_is_inert_today_and_is_a_tripwire(capsys):
    """The real canonical counter (effective-N = 32) leaves the check INERT. Also
    a TRIPWIRE: if the campaign ever crosses 200 this flips RED, signalling the
    selection-deflation check must be wired into the real candidacy path."""
    assert _CANONICAL_COUNTER.exists(), (
        f"canonical counter not found at {_CANONICAL_COUNTER} — this probe reads the "
        f"tracked artifact, not market data"
    )
    tc = TrialCounter(path=str(_CANONICAL_COUNTER))
    real_n = tc.effective_n(wave=None)["effective_n"]

    # TRIPWIRE: the premise this whole build rests on. Flips at candidacy scale.
    assert real_n < 200, (
        f"real lifetime effective-N is {real_n} >= 200 — CANDIDACY SCALE REACHED. "
        f"The selection-deflation check must now be wired into the real candidacy/"
        f"survivor-registration path and this inert-today probe retired."
    )

    # log_path=None -> pure computation, nothing written.
    v = run_selection_deflation_check(tc, log_path=None)
    _print_boundary(v)

    assert v["verdict"] == "INERT"
    assert v["engaged"] is False
    assert v["crossed"] == []
    assert v["latched"] == []
    assert v["next_checkpoint"] == 200
    assert v["distance_to_next_checkpoint"] == 200 - real_n


# ─────────────────────────── fail-closed contract ───────────────────────────
def test_fails_closed_on_a_counter_without_effective_n():
    class NotACounter:
        pass

    with pytest.raises(TypeError):
        run_selection_deflation_check(NotACounter())


def test_empty_checkpoints_refused(tmp_path):
    tc = _counter_with_effective_n(tmp_path, 1, tag="one")
    with pytest.raises(ValueError):
        run_selection_deflation_check(tc, checkpoints=())
