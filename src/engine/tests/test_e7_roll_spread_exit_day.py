"""E7 (deep-scan #7 2026-07-02) — Roll spread deducted at both entry AND exit roll days.

Previous behavior: roll spread cost was deducted ONLY when the entry bar landed on
a rollover day.  When a trade's exit bar coincides with a quarterly CME roll, no spread
cost was charged on that side, systematically underestimating the P&L haircut by
~3-4 ticks × contracts for every exit-day roll event.

New behavior (E7): also deduct roll spread when exit_idx lands on a roll day,
BUT apply the same-day guard:
  - entry_idx == exit_idx → only ONE deduction (entry side); exit-side is skipped
  - entry_idx != exit_idx and exit bar is roll day → second deduction (exit side)

The fix lives in backtester.py (two sites: function-path and class-path).  We CANNOT
import backtester.py here because it transitively triggers vectorbt JIT collection
which hangs pytest on this tower.  Instead we test:
  1. compute_roll_spread_cost() directly (pure function, roll_spread_cost.py)
  2. A standalone helper _apply_roll_deductions() that mirrors the E7 guard logic

Four canonical scenarios:
  A. Entry-day-roll only  → 1 deduction (entry side)
  B. Exit-day-roll only   → 1 deduction (exit side, via E7 new path)
  C. Same-day both        → 1 deduction only (same-day guard fires)
  D. Different roll days  → 2 deductions total (both sides charged)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest


# ─── Helper: mirrors E7 guard logic in backtester.py ────────────────────────


def _apply_roll_deductions(
    symbol: str,
    entry_idx: int,
    exit_idx: int,
    contracts: int,
    roll_days_by_idx: dict[int, date],
) -> tuple[Decimal, int]:
    """Mirror the E7 backtester.py roll-deduction guard logic.

    Guard:
      - Entry-side: always deduct when entry_idx is a roll day.
      - Exit-side (E7 new): deduct when exit_idx is a roll day AND
        exit_idx != entry_idx (same-day guard).

    Args:
        symbol:          Futures symbol.
        entry_idx:       Bar index of trade entry.
        exit_idx:        Bar index of trade exit.
        contracts:       Number of contracts.
        roll_days_by_idx: Mapping of bar_idx → roll_date for any bars that
                          coincide with a CME quarterly roll.

    Returns:
        (total_deduction_usd, n_deductions) tuple.
    """
    from src.engine.roll_spread_cost import compute_roll_spread_cost

    total = Decimal("0")
    n_deductions = 0

    # Entry-side deduction (unchanged pre-E7 logic)
    if entry_idx in roll_days_by_idx:
        roll_dt = roll_days_by_idx[entry_idx]
        cost = compute_roll_spread_cost(symbol, roll_dt, contracts)
        total += cost
        n_deductions += 1

    # Exit-side deduction — E7 new path, with same-day guard
    if exit_idx in roll_days_by_idx and exit_idx != entry_idx:
        roll_dt = roll_days_by_idx[exit_idx]
        cost = compute_roll_spread_cost(symbol, roll_dt, contracts)
        total += cost
        n_deductions += 1

    return total, n_deductions


# Shared roll dates for tests
_ENTRY_ROLL_DATE = date(2024, 3, 14)   # Q1 MES quarterly roll
_EXIT_ROLL_DATE = date(2024, 6, 20)    # Q2 MES quarterly roll
_SYMBOL = "MES"
_CONTRACTS = 2


# ─── Scenario A: entry-day roll only ─────────────────────────────────────────


class TestScenarioA_EntryDayRollOnly:
    """Trade enters on a roll day; exits on a non-roll day.

    Expected: 1 deduction (entry side only).
    E7 exit-side path does not fire.
    """

    def test_single_deduction_entry_side(self):
        """Entry on roll day, exit on non-roll day → exactly 1 deduction."""
        entry_idx = 10
        exit_idx = 15  # not in roll_days_by_idx
        roll_days = {entry_idx: _ENTRY_ROLL_DATE}

        _, n = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert n == 1, (
            f"Scenario A: expected 1 deduction (entry side), got {n}"
        )

    def test_cost_is_nonzero_entry_side(self):
        """Entry-side deduction produces a non-zero USD cost."""
        entry_idx = 10
        exit_idx = 15
        roll_days = {entry_idx: _ENTRY_ROLL_DATE}

        total, _ = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert total > Decimal("0"), (
            f"Scenario A: entry-side deduction should be > 0, got {total}"
        )

    def test_cost_range_correct_mes(self):
        """MES 2-contract entry deduction in expected range [6.25, 8.75]."""
        # MES: 3 ticks ± 0.5 noise; tick_value=1.25; 2 contracts
        # range: [(3-0.5)*1.25*2, (3+0.5)*1.25*2] = [6.25, 8.75]
        entry_idx = 10
        exit_idx = 20
        roll_days = {entry_idx: _ENTRY_ROLL_DATE}

        total, _ = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert Decimal("6.25") <= total <= Decimal("8.75"), (
            f"Scenario A: MES 2-contract entry deduction {total} outside [6.25, 8.75]"
        )

    def test_no_deduction_when_no_rolls(self):
        """Neither bar is a roll day → zero deductions, zero cost."""
        roll_days: dict[int, date] = {}
        total, n = _apply_roll_deductions(_SYMBOL, 5, 10, _CONTRACTS, roll_days)
        assert n == 0
        assert total == Decimal("0")


# ─── Scenario B: exit-day roll only (E7 new path) ────────────────────────────


class TestScenarioB_ExitDayRollOnly:
    """Trade enters on non-roll day; exits on a different roll day.

    Expected: 1 deduction (exit side only via E7 new path).
    This is the core E7 new behavior that was DARK before the fix.
    """

    def test_single_deduction_exit_side(self):
        """Exit on roll day, entry on non-roll day → exactly 1 deduction."""
        entry_idx = 5   # not a roll day
        exit_idx = 20   # IS a roll day
        roll_days = {exit_idx: _EXIT_ROLL_DATE}

        _, n = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert n == 1, (
            f"Scenario B: expected 1 deduction (exit side via E7), got {n}"
        )

    def test_cost_is_nonzero_exit_side(self):
        """E7 exit-side deduction produces a non-zero USD cost."""
        entry_idx = 5
        exit_idx = 20
        roll_days = {exit_idx: _EXIT_ROLL_DATE}

        total, _ = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert total > Decimal("0"), (
            f"Scenario B: exit-side deduction should be > 0, got {total}"
        )

    def test_exit_deduction_matches_entry_deduction_same_symbol(self):
        """Exit-side deduction uses the SAME compute_roll_spread_cost function.

        Calling it with the same symbol + date should give the same cost
        as an entry-side call with the same parameters (determinism).
        """
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        roll_dt = date(2024, 6, 20)
        entry_idx = 5
        exit_idx = 20
        roll_days = {exit_idx: roll_dt}

        total, _ = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        direct_cost = compute_roll_spread_cost(_SYMBOL, roll_dt, _CONTRACTS)
        assert total == direct_cost, (
            f"Scenario B: exit-side total {total} != direct compute {direct_cost}"
        )

    def test_pre_e7_logic_would_miss_exit_deduction(self):
        """Demonstrate that pre-E7 logic (entry-only) would return 0 for exit-only roll.

        This documents the regression that E7 fixes: pre-fix code deducted
        roll spread only at entry; exit-day rolls were silently skipped.
        """
        entry_idx = 5   # NOT in roll_days
        exit_idx = 20   # IS in roll_days
        roll_days = {exit_idx: _EXIT_ROLL_DATE}

        # Pre-E7 logic: only check entry_idx
        pre_e7_cost = Decimal("0")
        pre_e7_n = 0
        if entry_idx in roll_days:
            from src.engine.roll_spread_cost import compute_roll_spread_cost
            pre_e7_cost = compute_roll_spread_cost(_SYMBOL, roll_days[entry_idx], _CONTRACTS)
            pre_e7_n = 1

        # Post-E7 logic (the full guard)
        post_e7_cost, post_e7_n = _apply_roll_deductions(
            _SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days
        )

        # Pre-E7 silently dropped the cost; post-E7 correctly charges it
        assert pre_e7_n == 0, "Pre-E7 logic should yield 0 deductions for exit-only roll"
        assert pre_e7_cost == Decimal("0"), "Pre-E7 cost should be 0 for exit-only roll"
        assert post_e7_n == 1, "Post-E7 should yield 1 deduction (exit side)"
        assert post_e7_cost > Decimal("0"), "Post-E7 cost should be > 0 (E7 fix charges exit roll)"


# ─── Scenario C: same-day entry and exit on a roll day ───────────────────────


class TestScenarioC_SameDayGuard:
    """Entry AND exit happen on the same bar, which is also a roll day.

    Expected: exactly 1 deduction (entry side only).
    The same-day guard (exit_idx == entry_idx) prevents double-deduction.

    This is a critical correctness guard: a bar-by-bar flatten that closes
    the same bar it opened must never charge the roll spread twice.
    """

    def test_same_day_exactly_one_deduction(self):
        """entry_idx == exit_idx and bar is a roll day → 1 deduction (not 2)."""
        idx = 10  # both entry and exit on same bar
        roll_days = {idx: _ENTRY_ROLL_DATE}

        _, n = _apply_roll_deductions(_SYMBOL, entry_idx=idx, exit_idx=idx,
                                      contracts=_CONTRACTS, roll_days_by_idx=roll_days)
        assert n == 1, (
            f"Scenario C (same-day guard): expected 1 deduction, got {n}. "
            "Same-day guard must prevent double-deduction."
        )

    def test_same_day_cost_equals_single_deduction(self):
        """Same-day cost equals single compute_roll_spread_cost call."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        idx = 10
        roll_days = {idx: _ENTRY_ROLL_DATE}

        total, _ = _apply_roll_deductions(_SYMBOL, idx, idx, _CONTRACTS, roll_days)
        expected = compute_roll_spread_cost(_SYMBOL, _ENTRY_ROLL_DATE, _CONTRACTS)
        assert total == expected, (
            f"Same-day total {total} != single deduction {expected}"
        )

    def test_same_day_not_double(self):
        """Explicitly verify cost is NOT doubled on same-day entry+exit."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        idx = 10
        roll_days = {idx: _ENTRY_ROLL_DATE}
        single = compute_roll_spread_cost(_SYMBOL, _ENTRY_ROLL_DATE, _CONTRACTS)

        total, n = _apply_roll_deductions(_SYMBOL, idx, idx, _CONTRACTS, roll_days)

        assert n == 1, f"Must be 1 deduction; got {n}"
        assert total != single * 2, (
            f"Cost must NOT be doubled on same-day guard: got {total}, single={single}"
        )
        assert abs(float(total) - float(single)) < 0.001, (
            f"Same-day cost {total} should equal exactly one deduction {single}"
        )


# ─── Scenario D: both entry AND exit on different roll days ──────────────────


class TestScenarioD_BothRollDays:
    """Trade enters on one roll day and exits on a DIFFERENT roll day.

    Expected: 2 deductions (one entry side, one exit side).
    This is the maximum cost case — both sides of a cross-roll trade are charged.
    """

    def test_two_deductions_different_roll_days(self):
        """Different roll days on entry + exit → 2 deductions."""
        entry_idx = 10
        exit_idx = 65  # different bar = different date
        roll_days = {
            entry_idx: _ENTRY_ROLL_DATE,   # Q1 roll
            exit_idx: _EXIT_ROLL_DATE,     # Q2 roll
        }

        _, n = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        assert n == 2, (
            f"Scenario D: expected 2 deductions (entry + exit roll days), got {n}"
        )

    def test_total_cost_is_sum_of_both_sides(self):
        """Total cost equals entry-side cost + exit-side cost independently."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        entry_idx = 10
        exit_idx = 65
        roll_days = {
            entry_idx: _ENTRY_ROLL_DATE,
            exit_idx: _EXIT_ROLL_DATE,
        }

        total, _ = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)
        entry_cost = compute_roll_spread_cost(_SYMBOL, _ENTRY_ROLL_DATE, _CONTRACTS)
        exit_cost = compute_roll_spread_cost(_SYMBOL, _EXIT_ROLL_DATE, _CONTRACTS)
        expected = entry_cost + exit_cost

        assert total == expected, (
            f"Scenario D: total {total} != entry_cost({entry_cost}) + exit_cost({exit_cost})"
        )

    def test_both_deductions_are_positive(self):
        """Both entry and exit deductions are individually positive."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        entry_cost = compute_roll_spread_cost(_SYMBOL, _ENTRY_ROLL_DATE, _CONTRACTS)
        exit_cost = compute_roll_spread_cost(_SYMBOL, _EXIT_ROLL_DATE, _CONTRACTS)
        assert entry_cost > Decimal("0"), f"Entry deduction should be positive, got {entry_cost}"
        assert exit_cost > Decimal("0"), f"Exit deduction should be positive, got {exit_cost}"

    def test_two_deductions_not_same_as_one(self):
        """Two-deduction total is strictly greater than single-deduction."""
        from src.engine.roll_spread_cost import compute_roll_spread_cost

        entry_idx = 10
        exit_idx = 65
        roll_days_both = {entry_idx: _ENTRY_ROLL_DATE, exit_idx: _EXIT_ROLL_DATE}
        roll_days_entry_only = {entry_idx: _ENTRY_ROLL_DATE}

        total_both, n_both = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx,
                                                    _CONTRACTS, roll_days_both)
        total_entry, n_entry = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx,
                                                      _CONTRACTS, roll_days_entry_only)

        assert n_both == 2
        assert n_entry == 1
        assert total_both > total_entry, (
            f"Two-deduction total {total_both} should exceed one-deduction total {total_entry}"
        )


# ─── Guard combinatorics ─────────────────────────────────────────────────────


class TestE7GuardCombinatorics:
    """Exhaustive guard-condition table across idx and roll_days membership."""

    @pytest.mark.parametrize("entry_is_roll,exit_is_roll,same_day,expected_n", [
        (False, False, False, 0),  # no rolls → 0 deductions
        (True,  False, False, 1),  # Scenario A: entry roll only
        (False, True,  False, 1),  # Scenario B: exit roll only (E7)
        (True,  True,  True,  1),  # Scenario C: same-day → 1 (guard)
        (True,  True,  False, 2),  # Scenario D: different roll days → 2
    ])
    def test_deduction_count(
        self, entry_is_roll: bool, exit_is_roll: bool, same_day: bool, expected_n: int
    ):
        """Guard produces exactly expected_n deductions across all combinations."""
        entry_idx = 10
        exit_idx = 10 if same_day else 20

        roll_days: dict[int, date] = {}
        if entry_is_roll:
            roll_days[entry_idx] = _ENTRY_ROLL_DATE
        if exit_is_roll:
            roll_days[exit_idx] = _EXIT_ROLL_DATE

        _, n = _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, 1, roll_days)
        assert n == expected_n, (
            f"entry_is_roll={entry_is_roll}, exit_is_roll={exit_is_roll}, "
            f"same_day={same_day} → expected {expected_n} deductions, got {n}"
        )

    def test_mnq_same_guard_applies(self):
        """Same-day guard works for MNQ (not just MES)."""
        idx = 5
        roll_days = {idx: date(2024, 3, 14)}
        _, n = _apply_roll_deductions("MNQ", idx, idx, 1, roll_days)
        assert n == 1, "Same-day guard must fire for MNQ too"

    def test_mcl_exit_roll_charged(self):
        """MCL exit-day roll is charged (E7 new path)."""
        entry_idx = 3
        exit_idx = 8
        roll_days = {exit_idx: date(2024, 4, 22)}
        total, n = _apply_roll_deductions("MCL", entry_idx, exit_idx, 1, roll_days)
        assert n == 1
        assert total > Decimal("0")


# ─── Determinism ─────────────────────────────────────────────────────────────


class TestE7Determinism:
    """Roll deduction computations are deterministic (replay-safe)."""

    def test_entry_deduction_deterministic(self):
        """Entry-side deduction: same inputs → same cost every call."""
        entry_idx = 10
        roll_days = {entry_idx: _ENTRY_ROLL_DATE}
        results = [
            _apply_roll_deductions(_SYMBOL, entry_idx, 20, _CONTRACTS, roll_days)[0]
            for _ in range(10)
        ]
        assert len(set(float(r) for r in results)) == 1, "Entry deduction non-deterministic"

    def test_exit_deduction_deterministic(self):
        """Exit-side deduction (E7): same inputs → same cost every call."""
        exit_idx = 20
        roll_days = {exit_idx: _EXIT_ROLL_DATE}
        results = [
            _apply_roll_deductions(_SYMBOL, 5, exit_idx, _CONTRACTS, roll_days)[0]
            for _ in range(10)
        ]
        assert len(set(float(r) for r in results)) == 1, "E7 exit deduction non-deterministic"

    def test_two_deduction_total_deterministic(self):
        """Two-deduction total is fully deterministic (Scenario D)."""
        entry_idx, exit_idx = 10, 65
        roll_days = {entry_idx: _ENTRY_ROLL_DATE, exit_idx: _EXIT_ROLL_DATE}
        results = [
            _apply_roll_deductions(_SYMBOL, entry_idx, exit_idx, _CONTRACTS, roll_days)[0]
            for _ in range(10)
        ]
        assert len(set(float(r) for r in results)) == 1, "Two-deduction total non-deterministic"
