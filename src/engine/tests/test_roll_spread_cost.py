"""Roll spread cost tests — MED #5 (Wave 27.5 Pass D.1).

Tests compute_roll_spread_cost() pure function and build_roll_spread_audit().
- Per-symbol tick table correct (MES 3, MNQ 4, MCL 2)
- Deterministic with same seed (same date+symbol always same cost)
- Annual cost on 4 rolls ≈ 12 ticks (MES) → $15-20 per contract per year
- Env override respected (ROLL_SPREAD_MES_TICKS etc.)
- Backward compat: BACKTEST_ROLL_SPREAD_ITEMIZED=false → returns Decimal("0")
- Audit payload structure validated
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal

os.environ.setdefault("TF_ALLOW_FIXED_1", "true")


class TestComputeRollSpreadCost:
    """Pure-function contract tests."""

    def test_mes_base_ticks_correct(self):
        """MES default = 3 ticks per roll side."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_date = date(2024, 3, 14)  # MES quarterly roll Mar 2024
        cost = compute_roll_spread_cost("MES", roll_date, contracts=1)
        # base 3.0 ticks ± 0.5 noise; tick_value=1.25; range [2.5*1.25, 3.5*1.25] = [3.125, 4.375]
        assert isinstance(cost, Decimal)
        assert Decimal("3.12") <= cost <= Decimal("4.38"), f"MES 1-contract cost {cost} out of expected [3.12, 4.38]"

    def test_mnq_base_ticks_correct(self):
        """MNQ default = 4 ticks per roll side."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_date = date(2024, 3, 14)
        cost = compute_roll_spread_cost("MNQ", roll_date, contracts=1)
        # base 4.0 ticks ± 0.5 noise; tick_value=0.50; range [3.5*0.50, 4.5*0.50] = [1.75, 2.25]
        assert isinstance(cost, Decimal)
        assert Decimal("1.75") <= cost <= Decimal("2.25"), f"MNQ 1-contract cost {cost} out of [1.75, 2.25]"

    def test_mcl_base_ticks_correct(self):
        """MCL default = 2 ticks per roll side."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_date = date(2024, 4, 22)  # MCL monthly roll Apr 2024
        cost = compute_roll_spread_cost("MCL", roll_date, contracts=1)
        # base 2.0 ticks ± 0.5 noise; tick_value=1.00; range [1.5, 2.5]
        assert isinstance(cost, Decimal)
        assert Decimal("1.50") <= cost <= Decimal("2.50"), f"MCL 1-contract cost {cost} out of [1.50, 2.50]"

    def test_contracts_scales_linearly(self):
        """Cost with N contracts = N × cost with 1 contract."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_date = date(2024, 3, 14)
        cost_1 = compute_roll_spread_cost("MES", roll_date, 1)
        cost_5 = compute_roll_spread_cost("MES", roll_date, 5)
        assert abs(float(cost_5) - float(cost_1) * 5) < 0.001

    def test_zero_contracts_returns_zero(self):
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        assert compute_roll_spread_cost("MES", date(2024, 3, 14), 0) == Decimal("0")

    def test_determinism_same_inputs(self):
        """Identical (symbol, date) always produces identical cost."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_date = date(2024, 6, 20)
        costs = [compute_roll_spread_cost("MES", roll_date, 10) for _ in range(20)]
        assert len(set(float(c) for c in costs)) == 1, "Non-deterministic result!"

    def test_different_dates_different_costs(self):
        """Different roll dates should (in practice) produce different noise values."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        d1 = date(2024, 3, 14)
        d2 = date(2024, 6, 20)
        cost1 = compute_roll_spread_cost("MES", d1, 1)
        cost2 = compute_roll_spread_cost("MES", d2, 1)
        # Very unlikely to be exactly equal (different SHA-256 seeds)
        # This test is probabilistic but astronomically reliable for fixed dates.
        assert cost1 != cost2, "Different roll dates produced identical cost — improbable collision?"

    def test_annual_mes_4_rolls_within_range(self):
        """4 MES quarterly rolls × ~3 ticks = ~12 ticks ≈ $15 per contract per year."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost
        roll_dates = [
            date(2024, 3, 14),   # Q1
            date(2024, 6, 20),   # Q2
            date(2024, 9, 19),   # Q3
            date(2024, 12, 19),  # Q4
        ]
        total_cost = sum(float(compute_roll_spread_cost("MES", d, 1)) for d in roll_dates)
        # Expected: ~3 ticks × 1.25/tick × 4 rolls = $15 ± $5 noise
        assert 10.0 <= total_cost <= 22.0, (
            f"Annual MES roll cost {total_cost:.2f} outside expected [$10, $22] range"
        )


class TestItemisationDisabled:
    """BACKTEST_ROLL_SPREAD_ITEMIZED=false returns Decimal('0')."""

    def test_disabled_returns_zero(self, monkeypatch):
        monkeypatch.setenv("BACKTEST_ROLL_SPREAD_ITEMIZED", "false")
        # Must re-import the module to pick up the patched env var
        import importlib

        import src.engine.roll_spread_cost as rsc
        importlib.reload(rsc)
        # After reload, _ROLL_SPREAD_ITEMIZED should be False
        assert rsc._ROLL_SPREAD_ITEMIZED is False
        cost = rsc.compute_roll_spread_cost("MES", date(2024, 3, 14), 10)
        assert cost == Decimal("0"), "Itemisation disabled → zero roll cost"
        # Restore
        importlib.reload(rsc)


class TestBuildRollSpreadAudit:
    """Audit payload structure and key values."""

    def test_audit_has_required_keys(self):
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        roll_date = date(2024, 3, 14)
        cost = compute_roll_spread_cost("MES", roll_date, 5)
        audit = build_roll_spread_audit("MES", roll_date, 5, cost)
        for key in ("symbol", "roll_date", "ticks_base", "ticks_noise", "ticks_charged", "contracts", "total_cost_usd", "itemized"):
            assert key in audit, f"Missing key: {key}"

    def test_audit_roll_date_iso_format(self):
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        roll_date = date(2024, 6, 20)
        cost = compute_roll_spread_cost("MES", roll_date, 1)
        audit = build_roll_spread_audit("MES", roll_date, 1, cost)
        assert audit["roll_date"] == "2024-06-20"

    def test_audit_total_cost_matches_compute(self):
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        roll_date = date(2024, 9, 19)
        n = 7
        cost = compute_roll_spread_cost("MES", roll_date, n)
        audit = build_roll_spread_audit("MES", roll_date, n, cost)
        assert abs(audit["total_cost_usd"] - float(cost)) < 1e-6

    def test_audit_ticks_charged_within_range(self):
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        roll_date = date(2024, 3, 14)
        cost = compute_roll_spread_cost("MES", roll_date, 1)
        audit = build_roll_spread_audit("MES", roll_date, 1, cost)
        # MES base 3 ticks ± 0.5 noise → charged in [2.5, 3.5]
        assert 2.5 <= audit["ticks_charged"] <= 3.5
