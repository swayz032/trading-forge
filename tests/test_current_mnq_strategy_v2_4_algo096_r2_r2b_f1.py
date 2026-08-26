"""ALGO-096 §5 red-proofs — R2 · R2b · F1. Written BEFORE the change, RED at `6d22524c`.

Every test here encodes the OPERATOR's own definition, cited, and is built so that the
frozen magnitude and the taught definition DISAGREE on the fixture. A fixture both rules
already agree on proves nothing about the change and is labelled as a regression assert,
not counted as a red-proof.

THE CITED DEFINITIONS
---------------------
ALGO-071 §3 (the operator's answer, ruled): a rejection is BINARY and geometric — *"price
trades into the key zone and the candle closes back without breaking it"*. Therefore
`_control()`'s `body_frac >= 0.62` / `close_loc >= 0.78` are RETIRED from the rejection test,
*"no replacement magnitude is invented"*: **"does not break the level"** is decided by the
close against the band (the geometry `zone_lifecycle._breaks` already uses, WITHOUT the ATR
clearance he did not teach), and **"rejection wick"** by *"the candle having traded into the
band and closed out of it on the near side — OHLC against the band, no fraction"*.

ALGO-071 §5.3 names the three fixtures: a wick into the band with a close back = rejection ·
a close beyond the band = NOT a rejection · a candle that never entered the band = NOT a
rejection.

ALGO-096 §5 R2b: `two_sided_wick_conflict`'s `0.30`/`0.40` are constructions. Re-expressed in
his terms — a completed bar that closed INSIDE the band decided nothing (indecision, still
refused); a bar that traded into the band and closed back out on the near side IS a rejection
whatever its opposite wick measures.

ALGO-096 §5 F1: at the FORCE site only, the `PARTIAL_MOMENTUM_GEOMETRY` clause becomes the
taught shape — a directional body on the forming candle. "Control" is already carried by
`LATEST_CLOSE_AT_DIRECTIONAL_EXTREME`. The efficiency clause (`force.py:123`) is NOT touched.

GEOMETRY OF THE FIXTURES. The band is [100, 102]. For a LONG the zone is SUPPORT and price
approaches from ABOVE, so the NEAR side is above `hi` and "beyond" is below `lo`.

No PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.

REVERT NOTE (ALGO-100 §2, executed 2026-08-25). The §5 batch (R2 + R2b + F1) was REVERTED
after failing its own conjunctive pre-registration, so the FOUR red-proofs in this file that
asserted the reverted behaviour were removed BY NAME rather than left red or silently dropped:

    test_R2_a_wick_into_the_band_that_closes_back_IS_a_rejection_even_with_a_thin_wick
    test_R2_a_close_BEYOND_the_band_is_NOT_a_rejection_however_fat_the_wick
    test_R2b_a_two_sided_bar_that_closed_back_OUT_on_the_near_side_is_a_rejection
    test_F1_monotone_progress_closing_at_the_extreme_is_force_even_below_body_frac

They are preserved verbatim in history at `46b21920` / `62722a2a` and on the R2c branch
`7d42d121`; ALGO-100 §4's combined re-land restores them with the code they prove.

WHAT REMAINS IS STILL LOAD-BEARING against the PRE-BATCH code: the taught negatives that hold
either way (never entered the band; a two-sided bar closing INSIDE it; a giveback is not force),
the mirror-parity check between the two force derivations, and ALGO-096A's UNFROZEN_CHOICES
declaration tests - which is why that declaration was KEPT while the semantics went back.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_4_derivation as D
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_force as F

TZ = "America/New_York"
LO, HI = 100.0, 102.0
BODY, CLOSE_LOC, WICK = 0.62, 0.78, 0.35


def bars(rows):
    """rows: list of (open, high, low, close), oldest first."""
    idx = pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)


#: A bar wholly ABOVE the band, so `derive_approach` sees a real approach from outside.
AWAY = (110.0, 111.0, 109.0, 110.0)


def _classify(rows, direction="L"):
    return D.classify_interaction(bars(rows), direction, LO, HI, BODY, CLOSE_LOC, WICK)


# ─────────────────────────────────────────────────────────────────────────────────────────
# R2 — the three ALGO-071 §5.3 fixtures
# ─────────────────────────────────────────────────────────────────────────────────────────

#: Traded INTO the band (low 101.5 <= hi) and closed back out on the NEAR side (103.2 > hi),
#: so it IS a rejection under his definition. Its LOWER WICK FRACTION IS 0.05 — far under the
#: frozen `reject_wick 0.35`, so the magnitude rule and the taught rule DISAGREE here. That
#: disagreement is the whole point: this test is RED before the change.
REJECTION_THIN_WICK = (101.6, 103.5, 101.5, 103.2)

#: A big lower wick (fraction 0.50, clears 0.35) but the close is BELOW `lo` — the level
#: BROKE. His definition refuses it; the fraction rule accepts it. RED before the change.
BROKE_THE_LEVEL_FAT_WICK = (100.5, 101.0, 98.0, 99.5)




def test_R2_a_candle_that_never_entered_the_band_is_NOT_a_rejection():
    """ALGO-071 §5.3 fixture 3.

    REGRESSION ASSERT, NOT A RED-PROOF: the `_touches` guard already refuses this, so it is
    GREEN both before and after. It is kept to pin that the guard survives the change; it is
    NOT counted among the red-proofs and is labelled so nobody reads it as one.
    """
    never = (109.0, 110.0, 103.0, 109.5)          # low 103 > hi 102: never entered
    it = _classify([AWAY, (112, 113, 111, 112), never])
    assert D.TOUCH_AND_REJECT not in it.all_kinds


# ─────────────────────────────────────────────────────────────────────────────────────────
# R2b — the two-sided conflict test, re-expressed in his terms
# ─────────────────────────────────────────────────────────────────────────────────────────

#: Both wicks substantial and the body small, so `two_sided_wick_conflict(0.30, 0.40)` FIRES —
#: but it traded into the band (low 101) and closed back out on the near side (102.8 > hi).
#: Under his definition that is a rejection, whatever the opposite wick measures.
TWO_SIDED_CLOSED_BACK_OUT = (102.5, 104.0, 101.0, 102.8)

#: Two-sided AND the close is INSIDE the band: it decided nothing. Refused before and after.
TWO_SIDED_CLOSED_INSIDE = (102.5, 104.0, 99.0, 101.0)



def test_R2b_a_two_sided_bar_that_closed_INSIDE_the_band_is_still_refused():
    """ALGO-096 §5 R2b, the other half.

    REGRESSION ASSERT, NOT A RED-PROOF: refused before and after (the reason may change).
    It exists so R2b cannot be 'satisfied' by deleting the indecision refusal outright.
    """
    b = bars([AWAY, (109, 110, 103, 104), TWO_SIDED_CLOSED_INSIDE, (101, 102, 100.5, 101.5)])
    s = D.derive_story(b, "L", LO, HI, BODY, CLOSE_LOC, WICK)
    assert s.complete is False and s.refusal, f"indecision inside the band must refuse: {s}"


# ─────────────────────────────────────────────────────────────────────────────────────────
# F1 — force geometry becomes the taught shape, at the force site only
# ─────────────────────────────────────────────────────────────────────────────────────────

def _one_minute(rows, start="2026-04-09 10:00"):
    idx = pd.date_range(start, periods=len(rows), freq="1min", tz=TZ)
    return pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]}, index=idx)



def test_F1_a_candle_that_gave_the_move_back_is_still_refused():
    """The other side of F1, so it cannot be 'passed' by confirming everything.

    REGRESSION ASSERT, NOT A RED-PROOF: refused before and after. Closes rise then fall, so
    the aggregate close is NOT at the extreme and the path is inefficient — both taught
    clauses, both untouched by F1.
    """
    one = _one_minute([(100.0, 101.0, 99.0, 100.8), (100.8, 101.0, 99.5, 99.8)])
    parent_start = pd.Timestamp("2026-04-09 10:00", tz=TZ)
    snap = F.force_snapshot(one, parent_start, 5, "L",
                            parent_start + pd.Timedelta(minutes=2), eng.Params())
    assert snap.confirmed is False, f"a giveback is not sustained force: {snap.reason}"


def test_F1_force_derivations_stay_identical_between_the_two_implementations():
    """The mutation arm must remain a WITNESS: `independent_force` mirrors `force`.

    If F1 changes one and not the other, the mutation arms of ALGO-043/055 stop testing
    anything — they would agree by construction only where the bug is not.
    """
    import inspect
    from research import current_mnq_strategy_v2_4_independent_force as IF
    src_f = inspect.getsource(F)
    src_i = inspect.getsource(IF)
    for token in ("PARTIAL_MOMENTUM_GEOMETRY", "latest_close_at_directional_extreme"):
        assert (token in src_f) == (token in src_i), (
            f"{token!r} present in only one force derivation — the mirror has drifted")


# ─────────────────────────────────────────────────────────────────────────────────────────
# ALGO-096A — the efficiency clause is DECLARED at its own module, not buried in a default
# ─────────────────────────────────────────────────────────────────────────────────────────

def test_F1_the_untouched_efficiency_clause_is_declared_in_force_UNFROZEN_CHOICES():
    """ALGO-096A. Same shape as `test_..._breakout_derivation.py:421-430`.

    F1 leaves the path-efficiency clause exactly as it is. ALGO-096 §5 requires that an
    untaught-but-unbinding number be DECLARED rather than left implicit, and ALGO-096A ruled
    the declaration belongs in this module's own registry — `UNFROZEN_CHOICES` is a
    per-module convention, not a shared table, and the seals on `breakout_derivation.py` and
    `target_policy.py` stand.
    """
    import inspect
    import re

    assert "path_efficiency_threshold" in F.UNFROZEN_CHOICES
    text = F.UNFROZEN_CHOICES["path_efficiency_threshold"]
    assert "not a frozen value" in text

    # DERIVED FROM THE DECLARATION, NOT TYPED — the same property the breakout-derivation
    # test pins: the DECLARED number and the ACTUAL one must be the same number, whatever
    # that number currently is. A hand-typed copy is what the declaration exists to prevent.
    declared = re.search(r"Params\.body_frac \((\d+\.\d+)\)", text)
    assert declared, "the declaration must state the value it is declaring"
    assert float(declared.group(1)) == float(eng.Params().body_frac), (
        f"declared {declared.group(1)} but Params.body_frac is {eng.Params().body_frac}")

    # And the clause it describes must still be the one in the code, unmodified by F1.
    src = inspect.getsource(F.force_snapshot)
    assert "efficiency >= float(p.body_frac)" in src, (
        "F1 must not touch the efficiency clause; the declaration would then describe "
        "something that no longer exists")


def test_F1_the_mirror_gets_no_second_registry():
    """ALGO-096A: `independent_force.py` is documentation of the clause, not the clause.

    A second dict with the same name in the witness module would be a shared-name registry
    by the back door — exactly what the per-module ruling refused.
    """
    from research import current_mnq_strategy_v2_4_independent_force as IF
    assert not hasattr(IF, "UNFROZEN_CHOICES"), (
        "the mirror must not carry its own UNFROZEN_CHOICES")


def test_F1_a_non_directional_forming_candle_is_refused_BY_THE_GEOMETRY_CLAUSE():
    """Closes the gap a mutation battery found: F1 alone was unguarded against loosening.

    MEASURED during the batch: planting `geometry = True` in `force.py` was caught ONLY by
    `test_the_two_derivations_agree_across_the_frozen_corpus`, i.e. by the mirror disagreeing.
    Planting it in BOTH derivations identically turned the whole v2.4 suite green — a
    same-layer defect that no assertion could see.

    WHY, stated rather than papered over: after F1 the geometry clause is
    `close beyond open in the direction`, which for a LONG is exactly `progress > 0` — and
    `efficient` already requires `progress > 0`. The two clauses became logically equivalent,
    so NO INPUT can separate them and no test comparing verdicts can go red.

    What is still observable is WHICH CLAUSE REFUSES. `geometry` is checked BEFORE `efficient`
    in the reason chain, so a candle with no net directional progress must be refused by name
    as PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN. Loosen geometry and that same candle comes back
    as TUG_OF_WAR_PATH_TOO_INEFFICIENT instead — a different token, and this test goes RED.
    """
    # Two completed 1m bars whose aggregate close is BELOW its open: no directional body.
    one = _one_minute([(101.0, 101.2, 99.0, 99.5), (99.5, 99.8, 98.0, 98.5)])
    parent_start = pd.Timestamp("2026-04-09 10:00", tz=TZ)
    p = eng.Params()
    snap = F.force_snapshot(one, parent_start, 5, "L",
                            parent_start + pd.Timedelta(minutes=2), p)

    assert snap.confirmed is False
    assert snap.partial_momentum_geometry is False, "the fixture must fail the geometry clause"
    assert snap.reason == "PARTIAL_MOMENTUM_GEOMETRY_NOT_PROVEN", (
        "a candle with no directional body must be refused BY THE GEOMETRY CLAUSE, not by a "
        f"later one; got {snap.reason}")
