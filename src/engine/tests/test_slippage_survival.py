"""Tests for the Slippage-Survival Gate engine producer — slippage_survival.py.

Design spec: docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md

Covers:
  - Known-answer sweep math (hand-computed PF / expectancy_r at each multiple)
  - breaks_at at each boundary (survives all / breaks at 2x / breaks at 3x /
    breaks immediately at 1x)
  - min_trades sample-size guard (insufficient_sample forces breaks_at=None)
  - retention_2x calculation
  - Edge cases: empty trades, all-losing trades, all-winning trades,
    break-even trades
  - Determinism: same input -> byte-identical output (no clock, no I/O,
    no randomness — required for the replay-determinism contract)
  - Input validation: mismatched array lengths, empty multiples
  - Output key completeness (TS gate contract)
  - REVIEW-PASS FIXES (2026-07-03):
      FIX 1 — commission + roll held FIXED at every multiple (only slippage
              scales); at M=1 the sweep equals the trade's actual realized
              net P&L; a fee-heavy net-loser no longer grandfathers at 1x.
      FIX 2 — `_parse_slippage_survival_multiples` (backtester.py) sorts
              ascending + drops non-positive values; min_pf/min_trades
              parsers reject negative overrides.
      FIX 3 — `breaks_at` alive-check uses RAW (unrounded) pf/expectancy,
              not the 4dp display-rounded values.
"""

from __future__ import annotations

import math

import pytest

from src.engine.statistics.slippage_survival import (
    _PF_SENTINEL_NO_LOSSES,
    SCHEMA_VERSION,
    compute_slippage_survival,
)

_REQUIRED_KEYS = frozenset({
    "schema_version", "multiples", "pf", "expectancy_r",
    "breaks_at", "retention_2x", "n_trades", "insufficient_sample",
})


def _css(gross, slip, comm=None, roll=None, **kwargs):
    """Thin wrapper: defaults commission/roll to zero-arrays matching length
    so most tests (which are about slippage/PF/breaks_at math, not the
    commission/roll fix specifically) don't need to spell out four parallel
    lists of zeros. Tests that ARE about FIX 1 pass comm/roll explicitly.
    """
    n = len(gross)
    commission_dollars = comm if comm is not None else [0.0] * n
    roll_dollars = roll if roll is not None else [0.0] * n
    return compute_slippage_survival(
        gross_pnls=gross,
        slippage_dollars=slip,
        commission_dollars=commission_dollars,
        roll_dollars=roll_dollars,
        **kwargs,
    )


# ── Output contract ─────────────────────────────────────────────────────────

class TestOutputContract:
    def test_output_keys_complete(self):
        """Every TS-gate contract key is present (no key-name drift)."""
        result = _css([100.0] * 25, [5.0] * 25)
        assert _REQUIRED_KEYS.issubset(set(result.keys()))

    def test_schema_version_is_1(self):
        result = _css([100.0] * 25, [5.0] * 25)
        assert result["schema_version"] == 1
        assert result["schema_version"] == SCHEMA_VERSION

    def test_default_multiples_are_1_2_3(self):
        result = _css([100.0] * 25, [5.0] * 25)
        assert result["multiples"] == [1.0, 2.0, 3.0]
        assert set(result["pf"].keys()) == {"1x", "2x", "3x"}
        assert set(result["expectancy_r"].keys()) == {"1x", "2x", "3x"}

    def test_no_computed_at_key(self):
        """Pure helper never stamps a clock — caller (backtester.py) adds it."""
        result = _css([100.0] * 25, [5.0] * 25)
        assert "computed_at" not in result


# ── Known-answer sweep math (zero commission/roll baseline) ─────────────────

class TestSweepMath:
    def test_hand_computed_pf_and_expectancy(self):
        """4 trades, hand-computed at each multiple (zero commission/roll).

        gross = [100, -50, 200, -30]   slippage = [5, 5, 5, 5]  (all same)
        net_1x = [95, -55, 195, -35]
        net_2x = [90, -60, 190, -40]
        net_3x = [85, -65, 185, -45]

        PF_1x = (95+195) / (55+35) = 290/90 = 3.2222
        PF_2x = (90+190) / (60+40) = 280/100 = 2.8
        PF_3x = (85+185) / (65+45) = 270/110 = 2.4545

        R-unit = mean(abs(losers at 1x)) = mean(55, 35) = 45
        expectancy_r_1x = mean(net_1x)/45 = (95-55+195-35)/4/45 = 50/45 = 1.1111
        expectancy_r_2x = mean(net_2x)/45 = 45/45 = 1.0
        expectancy_r_3x = mean(net_3x)/45 = 40/45 = 0.8889
        """
        result = _css(
            gross=[100.0, -50.0, 200.0, -30.0],
            slip=[5.0, 5.0, 5.0, 5.0],
            min_trades=1,
        )
        assert result["pf"]["1x"] == pytest.approx(3.2222, abs=1e-3)
        assert result["pf"]["2x"] == pytest.approx(2.8, abs=1e-3)
        assert result["pf"]["3x"] == pytest.approx(2.4545, abs=1e-3)
        assert result["expectancy_r"]["1x"] == pytest.approx(1.1111, abs=1e-3)
        assert result["expectancy_r"]["2x"] == pytest.approx(1.0, abs=1e-3)
        assert result["expectancy_r"]["3x"] == pytest.approx(0.8889, abs=1e-3)
        assert result["n_trades"] == 4
        assert result["insufficient_sample"] is False

    def test_retention_2x_ratio(self):
        """retention_2x = expectancy_r.2x / expectancy_r.1x."""
        result = _css(
            gross=[100.0, -50.0, 200.0, -30.0],
            slip=[5.0, 5.0, 5.0, 5.0],
            min_trades=1,
        )
        expected = result["expectancy_r"]["2x"] / result["expectancy_r"]["1x"]
        assert result["retention_2x"] == pytest.approx(expected, abs=1e-4)
        assert result["retention_2x"] == pytest.approx(1.0 / 1.1111, abs=1e-3)

    def test_custom_multiples_sweep(self):
        """Non-default multiples list (e.g. [1.0, 1.5, 2.5]) formats keys correctly."""
        result = _css(
            gross=[100.0, -50.0],
            slip=[5.0, 5.0],
            multiples=[1.0, 1.5, 2.5],
            min_trades=1,
        )
        assert result["multiples"] == [1.0, 1.5, 2.5]
        assert set(result["pf"].keys()) == {"1x", "1.5x", "2.5x"}
        # retention_2x undefined when 2.0x is not in the swept multiples.
        assert result["retention_2x"] is None


# ── FIX 1 — commission + roll held FIXED, only slippage scaled ─────────────

class TestFix1CommissionAndRollHeldFixed:
    def test_hand_computed_with_commission_and_roll(self):
        """gross=[100,-40], slip=[30,5], commission=[4,4], roll=[0,2].

        1x: net=[100-4-0-30, -40-4-2-5] = [66, -51] -> PF=66/51=1.2941
        2x: net=[100-4-0-60, -40-4-2-10] = [36, -56] -> PF=36/56=0.6429
        3x: net=[100-4-0-90, -40-4-2-15] = [6, -61]  -> PF=6/61=0.0984

        Commission (4,4) and roll (0,2) are IDENTICAL at every multiple —
        only the slippage term (30,5) is scaled by M. breaks_at=2.0 since
        PF drops below min_pf=1.0 at 2x.
        """
        result = _css(
            gross=[100.0, -40.0], slip=[30.0, 5.0],
            comm=[4.0, 4.0], roll=[0.0, 2.0],
            min_trades=1, min_pf=1.0,
        )
        assert result["pf"]["1x"] == pytest.approx(1.2941, abs=1e-3)
        assert result["pf"]["2x"] == pytest.approx(0.6429, abs=1e-3)
        assert result["pf"]["3x"] == pytest.approx(0.0984, abs=1e-3)
        assert result["breaks_at"] == 2.0

    def test_m1_net_equals_trade_realized_net(self):
        """At M=1.0 the sweep's net series must be BYTE-IDENTICAL to the
        trade's actual realized net P&L (gross - slip - comm - roll) — the
        exact formula backtester.py uses per trade. This is the core
        invariant the review-pass fix restores."""
        gross = [237.5, -88.25, 412.0, -19.75]
        slip = [12.5, 3.75, 20.0, 2.25]
        comm = [4.5, 4.5, 4.5, 4.5]
        roll = [0.0, 18.3, 0.0, 0.0]
        realized_net = [
            g - s - c - r for g, s, c, r in zip(gross, slip, comm, roll, strict=True)
        ]

        # Isolate net_pnl_1x indirectly: PF/expectancy at 1x must match what
        # you'd get computing PF/expectancy directly from realized_net.
        result = _css(
            gross=gross, slip=slip, comm=comm, roll=roll,
            multiples=[1.0], min_trades=1,
        )
        winners = [p for p in realized_net if p > 0]
        losers = [p for p in realized_net if p < 0]
        expected_pf = sum(winners) / abs(sum(losers))
        assert result["pf"]["1x"] == pytest.approx(round(expected_pf, 4), abs=1e-4)

    def test_fee_heavy_net_loser_no_longer_grandfathers_at_1x(self):
        """Regression test for the exact bug FIX 1 closes.

        gross=[20, 15], slip=[2, 2], commission=[25, 25], roll=[0, 0]:
          OLD (buggy) formula ignored commission entirely:
            net_old = gross - slip = [18, 13] -> both WINNERS, zero losers
            -> PF_old = sentinel 99.0 -> "always alive" -> WRONG.
          NEW (fixed) formula: net = gross - slip - comm - roll:
            net_new = [20-2-25-0, 15-2-25-0] = [-7, -12] -> both LOSERS
            -> PF_new = 0.0 -> NOT alive at 1x -> breaks_at == 1.0.
        A fee-heavy net-loser must not grandfather past the gate just
        because slippage alone looked survivable.
        """
        result = _css(
            gross=[20.0, 15.0], slip=[2.0, 2.0],
            comm=[25.0, 25.0], roll=[0.0, 0.0],
            multiples=[1.0], min_trades=1,
        )
        assert result["pf"]["1x"] == 0.0
        assert result["expectancy_r"]["1x"] < 0
        assert result["breaks_at"] == 1.0

    def test_missing_roll_defaults_to_zero_is_caller_responsibility(self):
        """The pure helper itself has no notion of 'missing' — callers
        (backtester.py / walk_forward.py) are responsible for defaulting
        absent RollSpreadCost/CommissionCost keys to 0.0 before calling.
        This test documents the commission-only case (no roll-day trades
        in the window): net = [100-4-30, -40-4-5] = [66, -49] -> PF=66/49.
        """
        with_zero_roll = _css(
            gross=[100.0, -40.0], slip=[30.0, 5.0],
            comm=[4.0, 4.0], roll=[0.0, 0.0],
            multiples=[1.0], min_trades=1,
        )
        assert with_zero_roll["pf"]["1x"] == pytest.approx(66 / 49, abs=1e-3)
        assert with_zero_roll["pf"]["1x"] == pytest.approx(1.3469, abs=1e-3)


# ── breaks_at boundaries ─────────────────────────────────────────────────────

class TestBreaksAt:
    def test_survives_all_multiples(self):
        """Strong edge with tiny slippage relative to gross P&L never breaks."""
        gross = [500.0, -100.0] * 15  # 30 trades, PF healthy at every multiple
        slip = [1.0, 1.0] * 15
        result = _css(gross, slip, min_trades=1)
        assert result["breaks_at"] is None

    def test_breaks_at_first_multiple_when_already_fragile(self):
        """Edge dies immediately at 1x (PF < min_pf even unstressed)."""
        gross = [10.0, -20.0] * 15  # weak/negative edge even before stress
        slip = [1.0, 1.0] * 15
        result = _css(gross, slip, min_trades=1)
        assert result["breaks_at"] == 1.0

    def test_breaks_at_2x_when_fragile_but_not_immediately(self):
        """Edge survives 1x but PF collapses at 2x due to large per-trade slippage.

        gross=[100,-40], slip=[30,5], zero commission/roll:
          1x: net=[70,-45]  -> PF=70/45=1.5556 (>=1.0)  -> alive
          2x: net=[40,-50]  -> PF=40/50=0.8    (<1.0)   -> NOT alive -> breaks here
        """
        result = _css(
            gross=[100.0, -40.0], slip=[30.0, 5.0],
            min_trades=1, min_pf=1.0,
        )
        assert result["pf"]["1x"] == pytest.approx(1.5556, abs=1e-3)
        assert result["pf"]["2x"] == pytest.approx(0.8, abs=1e-3)
        assert result["breaks_at"] == 2.0

    def test_breaks_at_3x_survives_2x(self):
        """Edge survives 1x and 2x, dies at 3x.

        gross=[100,-40], slip=[16,5], zero commission/roll:
          1x: net=[84,-45]  -> PF=84/45=1.8667  -> alive
          2x: net=[68,-50]  -> PF=68/50=1.36    -> alive
          3x: net=[52,-55]  -> PF=52/55=0.9455 (<1.0) -> NOT alive -> breaks here
        """
        result = _css(
            gross=[100.0, -40.0], slip=[16.0, 5.0],
            min_trades=1, min_pf=1.0,
        )
        assert result["pf"]["1x"] == pytest.approx(1.8667, abs=1e-3)
        assert result["pf"]["2x"] == pytest.approx(1.36, abs=1e-3)
        assert result["pf"]["3x"] == pytest.approx(0.9455, abs=1e-3)
        assert result["breaks_at"] == 3.0

    def test_alive_requires_expectancy_positive_even_with_high_pf(self):
        """A degenerate all-zero-pnl slice reports expectancy_r <= 0 -> breaks at first multiple."""
        gross = [0.0] * 25
        slip = [0.0] * 25
        result = _css(gross, slip, min_trades=1)
        assert result["breaks_at"] == 1.0
        assert result["expectancy_r"]["1x"] == 0.0


# ── FIX 3 — breaks_at decided on RAW (unrounded) values ─────────────────────

class TestFix3RawBoundaryPrecision:
    def test_pf_just_under_threshold_rounds_up_but_stays_not_alive(self):
        """gross=[119996, -100000] -> raw PF = 119996/100000 = 1.19996.

        round(1.19996, 4) == 1.2 exactly (the DISPLAY value). With min_pf=1.2,
        the OLD (buggy) code compared the ROUNDED pf (1.2) >= min_pf (1.2) ->
        True -> incorrectly "alive". The FIX evaluates the RAW pf (1.19996)
        >= 1.2 -> False -> correctly "not alive" -> breaks_at == 1.0.

        Mean P&L here is strongly positive (+9998/trade), so expectancy_r
        is comfortably > 0 at both raw and rounded precision — this isolates
        the PF-rounding leg specifically (the two legs cannot both diverge
        from rounding when min_pf=1.0 exactly, since PF<1 implies mean<0;
        using min_pf=1.2 here decouples them, per the design spec's PF
        floor being operator-configurable, not hardcoded to 1.0).
        """
        assert round(1.19996, 4) == 1.2  # sanity: confirms the display value
        result = _css(
            gross=[119996.0, -100000.0], slip=[0.0, 0.0],
            multiples=[1.0], min_pf=1.2, min_trades=1,
        )
        assert result["pf"]["1x"] == 1.2  # display value rounds to the threshold
        assert result["expectancy_r"]["1x"] > 0  # not the discriminator here
        assert result["breaks_at"] == 1.0, (
            "raw PF 1.19996 < min_pf 1.2 must break even though the "
            "DISPLAYED (rounded) pf shows exactly 1.2"
        )

    def test_pf_just_over_threshold_stays_alive(self):
        """Sanity companion: a PF just ABOVE the raw threshold (not a
        rounding artifact) must correctly survive."""
        result = _css(
            gross=[120004.0, -100000.0], slip=[0.0, 0.0],
            multiples=[1.0], min_pf=1.2, min_trades=1,
        )
        assert result["breaks_at"] is None


# ── min_trades sample-size guard ─────────────────────────────────────────────

class TestMinTradesGuard:
    def test_insufficient_sample_forces_breaks_at_null(self):
        """Below min_trades: insufficient_sample=True and breaks_at forced None,
        even when the underlying math would otherwise report a break."""
        gross = [10.0, -20.0]  # fragile edge, would break at 1x
        slip = [1.0, 1.0]
        result = _css(gross, slip, min_trades=20)
        assert result["n_trades"] == 2
        assert result["insufficient_sample"] is True
        assert result["breaks_at"] is None
        # pf/expectancy_r are still reported for visibility.
        assert result["pf"]["1x"] is not None

    def test_sufficient_sample_flag_false(self):
        result = _css([100.0] * 25, [5.0] * 25, min_trades=20)
        assert result["insufficient_sample"] is False

    def test_exactly_at_min_trades_boundary_is_sufficient(self):
        """n_trades == min_trades is sufficient (>= not >)."""
        result = _css([100.0] * 20, [5.0] * 20, min_trades=20)
        assert result["insufficient_sample"] is False

    def test_one_below_min_trades_boundary_is_insufficient(self):
        result = _css([100.0] * 19, [5.0] * 19, min_trades=20)
        assert result["insufficient_sample"] is True


# ── Edge cases ────────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_empty_trades(self):
        result = _css([], [])
        assert result["n_trades"] == 0
        assert result["insufficient_sample"] is True
        assert result["breaks_at"] is None
        assert result["retention_2x"] is None
        assert result["pf"] == {"1x": None, "2x": None, "3x": None}
        assert result["expectancy_r"] == {"1x": None, "2x": None, "3x": None}

    def test_all_winning_trades_uses_pf_sentinel_not_inf(self):
        """No losing trades -> PF sentinel (finite), never float('inf')."""
        result = _css(
            gross=[100.0, 150.0, 200.0], slip=[1.0, 1.0, 1.0],
            min_trades=1,
        )
        assert result["pf"]["1x"] == _PF_SENTINEL_NO_LOSSES
        assert math.isfinite(result["pf"]["1x"])
        assert result["breaks_at"] is None  # all winners -> never breaks

    def test_all_losing_trades(self):
        """All losing trades -> PF=0.0, expectancy negative, breaks at 1x."""
        result = _css(
            gross=[-50.0, -30.0, -80.0], slip=[1.0, 1.0, 1.0],
            min_trades=1,
        )
        assert result["pf"]["1x"] == 0.0
        assert result["expectancy_r"]["1x"] < 0
        assert result["breaks_at"] == 1.0

    def test_all_breakeven_trades(self):
        """Every trade exactly 0 net P&L at 1x -> R-unit undefined -> expectancy_r=0.0."""
        result = _css(
            gross=[5.0, 5.0], slip=[5.0, 5.0], min_trades=1,
        )
        assert result["expectancy_r"]["1x"] == 0.0
        assert result["breaks_at"] == 1.0  # expectancy_r <= 0 -> not alive


# ── Determinism ──────────────────────────────────────────────────────────────

class TestDeterminism:
    def test_same_input_same_output(self):
        """Pure function: identical inputs must produce byte-identical output
        across repeated calls (no clock, no I/O, no randomness)."""
        gross = [123.45, -67.89, 200.01, -15.5, 88.0]
        slip = [3.3, 4.1, 2.9, 5.0, 3.7]
        comm = [4.5] * 5
        roll = [0.0, 1.2, 0.0, 0.0, 3.4]
        r1 = _css(gross, slip, comm=comm, roll=roll, min_trades=1)
        r2 = _css(gross, slip, comm=comm, roll=roll, min_trades=1)
        r3 = _css(list(gross), list(slip), comm=list(comm), roll=list(roll), min_trades=1)
        assert r1 == r2 == r3

    def test_determinism_across_multiple_multiples_configs(self):
        gross = [40.0, -20.0, 60.0, -10.0]
        slip = [2.0, 2.0, 2.0, 2.0]
        r1 = _css(gross, slip, multiples=[1.0, 2.0, 3.0, 4.0], min_trades=1)
        r2 = _css(gross, slip, multiples=[1.0, 2.0, 3.0, 4.0], min_trades=1)
        assert r1 == r2


# ── Input validation ─────────────────────────────────────────────────────────

class TestInputValidation:
    def test_mismatched_gross_slip_lengths_raises(self):
        with pytest.raises(ValueError):
            compute_slippage_survival(
                gross_pnls=[100.0, 200.0], slippage_dollars=[5.0],
                commission_dollars=[0.0, 0.0], roll_dollars=[0.0, 0.0],
            )

    def test_mismatched_commission_length_raises(self):
        with pytest.raises(ValueError):
            compute_slippage_survival(
                gross_pnls=[100.0, 200.0], slippage_dollars=[5.0, 5.0],
                commission_dollars=[0.0], roll_dollars=[0.0, 0.0],
            )

    def test_mismatched_roll_length_raises(self):
        with pytest.raises(ValueError):
            compute_slippage_survival(
                gross_pnls=[100.0, 200.0], slippage_dollars=[5.0, 5.0],
                commission_dollars=[0.0, 0.0], roll_dollars=[0.0, 0.0, 0.0],
            )

    def test_empty_multiples_raises(self):
        with pytest.raises(ValueError):
            _css([100.0], [5.0], multiples=[])


# ── FIX 2 — env-var parser defensiveness (backtester.py) ────────────────────

class TestFix2EnvParserDefensiveness:
    """`_parse_slippage_survival_multiples/_min_pf/_min_trades` live in
    backtester.py (they read env vars, which the pure statistics module
    must never do) but are the direct config-shape companion to
    compute_slippage_survival() — tested here alongside the sweep math.
    """

    def test_multiples_sorted_ascending_regardless_of_env_order(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_multiples

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MULTIPLES", "3,1,2")
        assert _parse_slippage_survival_multiples() == [1.0, 2.0, 3.0]

    def test_multiples_drops_non_positive_values(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_multiples

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MULTIPLES", "0,-1,2,1,3")
        assert _parse_slippage_survival_multiples() == [1.0, 2.0, 3.0]

    def test_multiples_all_non_positive_falls_back_to_default(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_multiples

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MULTIPLES", "0,-1,-2")
        assert _parse_slippage_survival_multiples() == [1.0, 2.0, 3.0]

    def test_multiples_misconfigured_descending_env_no_longer_misorders_breaks_at(self, monkeypatch):
        """End-to-end regression: the exact scenario the fix note calls out
        ('a misconfigured SLIPPAGE_SURVIVAL_MULTIPLES="3,2,1" yields a wrong
        breaks_at') must now sweep in ascending order regardless of env
        ordering, so breaks_at reflects the SMALLEST breaking multiple."""
        from src.engine.backtester import _parse_slippage_survival_multiples

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MULTIPLES", "3,2,1")
        multiples = _parse_slippage_survival_multiples()
        assert multiples == [1.0, 2.0, 3.0]
        # Same fragile-at-2x fixture as TestBreaksAt.test_breaks_at_2x_...
        result = _css(
            gross=[100.0, -40.0], slip=[30.0, 5.0],
            multiples=multiples, min_trades=1, min_pf=1.0,
        )
        assert result["breaks_at"] == 2.0

    def test_min_pf_negative_override_falls_back_to_default(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_min_pf

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_PF", "-0.5")
        assert _parse_slippage_survival_min_pf() == 1.0

    def test_min_pf_valid_override_is_respected(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_min_pf

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_PF", "1.5")
        assert _parse_slippage_survival_min_pf() == 1.5

    def test_min_trades_negative_override_falls_back_to_default(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_min_trades

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_TRADES", "-5")
        assert _parse_slippage_survival_min_trades() == 20

    def test_min_trades_valid_override_is_respected(self, monkeypatch):
        from src.engine.backtester import _parse_slippage_survival_min_trades

        monkeypatch.setenv("SLIPPAGE_SURVIVAL_MIN_TRADES", "50")
        assert _parse_slippage_survival_min_trades() == 50
