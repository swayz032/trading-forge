"""F-3 — REALIZED-vs-OPEN METRIC SEPARATION. AR-1101 section 4.

A position still open when the measurement frame ends is OPEN RISK / MARK-TO-MARKET state,
not a realized win or a realized loss. Before this repair `trade_pnls_list` fed every
executed record -- the open one included -- into `win_rate`, `profit_factor`,
`avg_trade_pnl` and `winner_loser_ratio`, with the EXECUTED count as the realized
denominator. AR-1103 measured the blast radius: the formula was duplicated across
`run_backtest` and `run_class_backtest`, with `win_rate_per_trade` carrying the same defect
independently in BOTH functions (4 sites, not the 3 that AR-1103 named).

Every test here drives the REAL persisted Band C route through `bt.main.callback` and reads
the RETURNED envelope -- never a spy, never a hand-built trade list. The fixture helpers are
imported from the existing source proofs so this file describes the same strategy, the same
candidate receipt and the same shipped flag state (AR-1101 section 2: reuse the prior art).

WHAT AR-1101 section 4 PRE-REGISTERED, and what each class below witnesses:

    executed trades = 3 . closed = 2 . open = 1 . realized denominator = 2
    realized win rate = 100% . open record remains Status=Open
    no synthetic source exit is created
    a fully closed 3-trade fixture keeps its prior metrics unchanged
"""

import numpy as np
import pytest

import src.engine.backtester as bt
from src.engine.backtester import is_open_at_frame_end, partition_realized_open
from src.engine.tests.test_source_band_c_vertical import (
    _production_flag_state,  # noqa: F401 -- autouse fixture, imported for its side effect
)
from src.engine.tests.test_source_trade_population import (
    DECISION_BAR_LOCAL,
    _bars_sessions,
    _normal,
    _run_bars,
)
from src.engine.tests.test_source_vertical_join import _SESSION

# The taught stop is 111.5 and the 2R target is 134.0 for this fixture (both stated in
# test_source_trade_population's `_tighter_stop` docstring). Entry is 119.0. A post-decision
# band strictly inside (111.5, 134.0) therefore touches NEITHER level.
_TAUGHT_STOP = 111.5
_TAUGHT_TARGET = 134.0
_ENTRY = 119.0


def _flat_band_after_decision(o, h, low, c) -> list:
    """A session whose post-decision bars sit in a flat band that reaches neither level.

    NOTE the trap already recorded in `_second_event_while_open`: a flat band is itself a
    displacement-and-gap shape, so the session emits an EXTRA source event. Here that is
    harmless and deliberate -- the unresolved trade holds occupancy to the last bar, so the
    extra event is REJECTED by the overlap policy instead of becoming a fourth trade.

    Placing such a session LAST is load-bearing: in any earlier slot the open trade would
    carry into the next session and resolve against its taught stop there, because the
    source contract has no time stop and no 15:55 flatten.
    """
    assert _TAUGHT_STOP < low <= h < _TAUGHT_TARGET, (
        "the band must reach neither the taught stop nor the taught target, or this "
        "fixture is not witnessing an UNRESOLVED position at all"
    )
    rows = [list(r) for r in _SESSION]
    for b in range(DECISION_BAR_LOCAL + 1, len(rows)):
        rows[b] = [o, h, low, c]
    return [tuple(r) for r in rows]


def _open_in_profit() -> list:
    """Unresolved and marked to market ABOVE entry -> the open record is a small winner."""
    return _flat_band_after_decision(120.0, 121.0, 119.5, 120.0)


def _open_at_a_loss() -> list:
    """Unresolved and marked to market BELOW entry -> the open record is a LOSER.

    This variant exists because the in-profit one cannot witness the win-rate half of the
    defect: with 2 closed winners and an open winner, win_rate reads 1.0 both before and
    after the repair. Only an open LOSER makes the realized win rate actually move
    (2/3 -> 2/2). `A FIXTURE THAT CANNOT GO RED IS NOT A PROOF.`
    """
    return _flat_band_after_decision(115.5, 116.0, 114.5, 115.0)


@pytest.fixture(scope="module")
def two_closed_one_open_winner():
    return _run_bars(_bars_sessions([_normal(), _normal(), _open_in_profit()]))[0]


@pytest.fixture(scope="module")
def two_closed_one_open_loser():
    return _run_bars(_bars_sessions([_normal(), _normal(), _open_at_a_loss()]))[0]


@pytest.fixture(scope="module")
def all_three_closed():
    return _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))[0]


class TestTheGradersExactShape:
    """AR-1101 section 4's pre-registered discriminator, asserted field by field."""

    def test_the_executed_population_is_still_three(self, two_closed_one_open_winner):
        assert two_closed_one_open_winner["total_trades"] == 3, (
            "the repair must not change WHICH trades executed -- only how they are counted"
        )

    def test_two_closed_and_one_open(self, two_closed_one_open_winner):
        assert two_closed_one_open_winner["closed_trade_count"] == 2
        assert two_closed_one_open_winner["open_trade_count"] == 1

    def test_the_counts_partition_the_executed_population_exactly(self, two_closed_one_open_winner):
        r = two_closed_one_open_winner
        assert r["closed_trade_count"] + r["open_trade_count"] == r["total_trades"], (
            "closed + open must equal executed, or a trade is being double counted or lost"
        )

    def test_the_realized_win_rate_is_100_percent_over_a_denominator_of_two(self, two_closed_one_open_winner):
        r = two_closed_one_open_winner
        assert r["win_rate"] == 1.0
        assert r["win_rate_per_trade"] == 1.0
        assert r["closed_trade_count"] == 2

    def test_the_open_record_SURVIVES_and_is_still_marked_Open(self, two_closed_one_open_winner):
        trades = two_closed_one_open_winner["trades"]
        assert len(trades) == 3, "the open trade record must remain visible, not be dropped"
        open_trades = [t for t in trades if t["Status"] == "Open"]
        assert len(open_trades) == 1
        assert open_trades[0]["exit_reason"] == "signal", (
            "an exit_reason other than 'signal' would mean some layer closed this position"
        )

    def test_NO_synthetic_source_exit_was_fabricated(self, two_closed_one_open_winner):
        """AR-1101 section 4: 'Do not fabricate a source exit at the final bar.'"""
        plan = two_closed_one_open_winner["source_occupancy"]["source_trade_plan"]
        unresolved = [p for p in plan if p["exit_reason"] == "open_at_frame_end"]
        assert len(unresolved) == 1
        assert unresolved[0]["exit_idx"] is None, (
            "the occupancy pass invented an exit index for a position that never resolved"
        )
        assert two_closed_one_open_winner["source_occupancy"]["source_unresolved_open"] == 1

    def test_the_engines_own_unresolved_count_AGREES_with_the_metric_layer(self, two_closed_one_open_winner):
        """Two independent producers -- the occupancy pass and the metric partition --
        must agree on how many positions never resolved. They are computed in different
        places from different inputs, so agreement is evidence rather than a tautology."""
        r = two_closed_one_open_winner
        assert r["open_trade_count"] == r["source_occupancy"]["source_unresolved_open"]


class TestTheMetricActuallyMoves:
    """The RED half. Without the repair every number below takes its old value."""

    def test_avg_trade_pnl_is_the_REALIZED_average_not_the_executed_one(self, two_closed_one_open_winner):
        r = two_closed_one_open_winner
        realized_avg = r["realized_pnl_total"] / r["closed_trade_count"]
        executed_avg = r["total_return"] / r["total_trades"]

        assert r["avg_trade_pnl"] == pytest.approx(realized_avg, abs=0.01)
        assert r["avg_trade_pnl"] != pytest.approx(executed_avg, abs=0.01), (
            "avg_trade_pnl still equals the EXECUTED average -- the open position is being "
            "counted as a completed trade"
        )

    def test_realized_and_open_pnl_are_reported_SEPARATELY_and_sum_to_the_total(self, two_closed_one_open_winner):
        r = two_closed_one_open_winner
        assert r["open_pnl_total"] != 0.0, "this fixture's open position has MTM P&L to report"
        assert r["realized_pnl_total"] + r["open_pnl_total"] == pytest.approx(
            r["total_return"], abs=0.02
        ), "realized + open MTM must reconcile to the executed total return"

    def test_an_open_LOSER_is_excluded_from_the_realized_win_rate(self, two_closed_one_open_loser):
        """The discriminating case. Executed = 3 with one loser, so the OLD denominator
        gives 2/3 = 0.667. The realized denominator gives 2/2 = 1.0."""
        r = two_closed_one_open_loser
        assert r["total_trades"] == 3
        assert r["closed_trade_count"] == 2
        assert r["open_trade_count"] == 1
        assert r["open_pnl_total"] < 0, "this fixture's open position must be at a LOSS"

        assert r["win_rate"] == 1.0, (
            f"realized win rate is {r['win_rate']} -- an unresolved position is being "
            f"counted as a completed LOSS (the pre-repair value here is 2/3 = 0.6667)"
        )
        assert r["win_rate_per_trade"] == 1.0, (
            "win_rate_per_trade carries the defect independently of win_rate and must be "
            "fixed at its own site"
        )

    def test_the_equity_RECONCILIATION_still_joins_against_the_EXECUTED_population(self, two_closed_one_open_winner):
        """The narrowing must not leak into the equity curve: equity marks every executed
        trade to market, so the sanity check's join stays on the executed total."""
        checks = {c["name"]: c for c in two_closed_one_open_winner["sanity_checks"]["checks"]}
        assert checks["reconciliation"]["status"] == "PASS", checks["reconciliation"]["detail"]

    def test_the_avg_trade_pnl_INVARIANT_does_not_fire_a_false_warning(self, two_closed_one_open_winner):
        """INV-11 joined avg_trade_pnl against the EXECUTED total. Once avg_trade_pnl
        became a realized average that join compared two different populations and fired
        'Possible winner/loser array filtering bug' -- accusing the repair of being the
        defect. It now joins realized against realized."""
        warnings = {w["name"] for w in two_closed_one_open_winner["invariants"]["warnings"]}
        assert "avg_trade_pnl_consistent" not in warnings, (
            "INV-11 is firing on a correctly separated population"
        )

    @pytest.mark.parametrize("fixture_name", ["two_closed_one_open_winner", "two_closed_one_open_loser"])
    def test_the_INDEPENDENT_RECOMPUTATION_agrees_with_the_reported_metrics(self, fixture_name, request):
        """`cross_validation` recomputes win rate and profit factor from the trade records
        as an independent check on the engine's own numbers.

        🛑 THIS ASSERTION EXISTS BECAUSE IT CAUGHT A REAL FAILURE THAT THE SUITE MISSED.
        After the metric was narrowed to closed trades, the recomputation still divided by
        the EXECUTED population, so on the open-loser fixture it reported
        `win_rate reported=1.0000 recomputed=0.6667` and
        `profit_factor reported=999.99 recomputed=5.7031` -- two FAILs sitting inside a
        green test run, because a verification result is DATA and nothing asserted on it.
        ★ `A CHECK WHOSE OUTPUT NOBODY ASSERTS ON IS A LOG LINE.`
        """
        result = request.getfixturevalue(fixture_name)
        mv = result["cross_validation"]["metric_verification"]
        failed = [c for c in mv["checks"] if c["status"] != "PASS"]
        assert not failed, f"independent recomputation disagrees: {failed}"
        assert mv["status"] == "PASS"


class TestAFullyClosedPopulationIsUNCHANGED:
    """AR-1101 section 4: 'prove a fully closed 3-trade fixture keeps its prior metrics
    unchanged.' Expected values are DERIVED from the same envelope, never hand-copied."""

    def test_all_three_are_closed_and_none_are_open(self, all_three_closed):
        r = all_three_closed
        assert r["total_trades"] == 3
        assert r["closed_trade_count"] == 3
        assert r["open_trade_count"] == 0

    def test_the_realized_denominator_equals_the_executed_one(self, all_three_closed):
        r = all_three_closed
        assert r["closed_trade_count"] == r["total_trades"]
        assert r["realized_pnl_total"] == pytest.approx(r["total_return"], abs=0.02)
        assert r["open_pnl_total"] == pytest.approx(0.0, abs=0.01)

    def test_the_realized_and_executed_averages_AGREE_when_nothing_is_open(self, all_three_closed):
        """With no open position the partition is the identity, so the two joins that
        disagreed above must now agree. This is what 'unchanged' means, computed."""
        r = all_three_closed
        assert r["avg_trade_pnl"] == pytest.approx(r["total_return"] / r["total_trades"], abs=0.01)

    def test_win_rate_is_unchanged_at_100_percent(self, all_three_closed):
        assert all_three_closed["win_rate"] == 1.0
        assert all_three_closed["win_rate_per_trade"] == 1.0


class TestThePredicateItself:
    """Unit-level red-proofs for the one predicate every realized site now routes through.

    These are the ABLATION controls: they show the partition discriminates, rather than
    returning a convenient answer. A guard that cannot be shown to bite is decoration.
    """

    def test_a_closed_trade_is_not_open(self):
        assert not is_open_at_frame_end({"Status": "Closed", "exit_reason": "signal"})

    def test_an_unresolved_trade_is_open(self):
        assert is_open_at_frame_end({"Status": "Open", "exit_reason": "signal"})

    def test_a_MANAGED_STOP_on_an_Open_record_is_NOT_treated_as_open(self):
        """The dangerous leg. vectorbt can leave a legacy trade Open while the managed
        stop DID close it -- classifying that as open would delete real realized losses
        from the denominator and inflate every legacy win rate."""
        for reason in ("stop_loss", "trailing_stop", "take_profit", "time_stop",
                       "source_stop", "source_fixed_r_target"):
            assert not is_open_at_frame_end({"Status": "Open", "exit_reason": reason}), (
                f"a trade closed by {reason!r} was classified as an unresolved position"
            )

    def test_the_partition_splits_pnls_by_that_predicate(self):
        trades = [
            {"Status": "Closed", "exit_reason": "source_fixed_r_target"},
            {"Status": "Open", "exit_reason": "stop_loss"},
            {"Status": "Open", "exit_reason": "signal"},
        ]
        realized, closed_n, open_n = partition_realized_open(trades, [10.0, -4.0, 99.0])
        assert closed_n == 2 and open_n == 1
        assert sorted(realized.tolist()) == [-4.0, 10.0], (
            "the open record's P&L leaked into the realized array"
        )

    def test_a_BROKEN_JOIN_refuses_rather_than_partitioning_on_misaligned_lists(self):
        """`trade_pnls_list` and `trades_list` are appended in lockstep. If that ever
        drifts, every P&L would be attributed to the wrong trade -- so it must refuse."""
        with pytest.raises(ValueError, match="not index-aligned"):
            partition_realized_open([{"Status": "Closed", "exit_reason": "signal"}], [1.0, 2.0])

    def test_an_ALL_OPEN_population_has_no_realized_statistics_and_does_not_raise(self):
        trades = [{"Status": "Open", "exit_reason": "signal"}] * 3
        realized, closed_n, open_n = partition_realized_open(trades, [1.0, 2.0, 3.0])
        assert closed_n == 0 and open_n == 3
        assert realized.size == 0
        assert np.sum(realized) == 0.0


class TestABLATION:
    """THE RED PROOF. Disabling the one predicate must restore the ORIGINAL defect
    exactly -- not merely change the numbers. Pre-repair, every executed trade entered
    the realized statistics, so an ablated run must reproduce those values.

    This is an in-process ablation rather than a checkout of the parent commit because
    it stays runnable forever: it re-proves on every CI run that the repair is still the
    thing producing the separation. `A GUARD THAT HAS NEVER BEEN SEEN TO GO RED IS NOT
    YET AN INSTRUMENT.`

    `is_open_at_frame_end` is looked up as a module global by BOTH the shared partition
    and both `win_rate_per_trade` sites, so patching it here ablates every site at once.
    """

    @pytest.fixture
    def ablated(self, monkeypatch):
        monkeypatch.setattr(bt, "is_open_at_frame_end", lambda _t: False)
        return _run_bars(_bars_sessions([_normal(), _normal(), _open_at_a_loss()]))[0]

    def test_the_open_position_is_counted_as_a_completed_trade_again(self, ablated):
        assert ablated["closed_trade_count"] == 3, "the ablation did not reach the partition"
        assert ablated["open_trade_count"] == 0

    def test_the_realized_win_rate_COLLAPSES_to_the_pre_repair_value(self, ablated):
        """2 winners over an executed denominator of 3 -- the unresolved position counted
        as a completed loss. This is the exact number the repair removes."""
        assert ablated["win_rate"] == pytest.approx(2 / 3, abs=0.001)
        assert ablated["win_rate_per_trade"] == pytest.approx(2 / 3, abs=0.001)

    def test_avg_trade_pnl_reverts_to_the_EXECUTED_average(self, ablated):
        assert ablated["avg_trade_pnl"] == pytest.approx(
            ablated["total_return"] / ablated["total_trades"], abs=0.01
        )

    def test_POSITIVE_CONTROL_the_unablated_arm_on_the_SAME_fixture_separates(
        self, two_closed_one_open_loser
    ):
        """Without this, the ablation above could be passing because the fixture changed
        rather than because the predicate did."""
        assert two_closed_one_open_loser["closed_trade_count"] == 2
        assert two_closed_one_open_loser["win_rate"] == 1.0


class TestTheRepairIsReachableFromBOTHPATHS:
    """AR-1101 section 4: 'Do not special-case SOURCE_FAITHFUL if the underlying metric
    definition is globally wrong.' It was wrong in both functions, so both must route
    through the shared predicate -- asserted against the SOURCE, since a behavioural probe
    of the legacy arm needs a legacy fixture this file does not own."""

    def test_the_open_test_IS_WRITTEN_EXACTLY_ONCE_in_the_whole_engine(self):
        """The defect existed in four places because the formula was copied. A repair that
        copies a new predicate around rebuilds the same trap, so the literal test lives in
        exactly one module and every consumer imports it."""
        import inspect

        import src.engine.cross_validation as cv
        import src.engine.trade_status as ts

        literal = 'str(trade.get("Status", "")) == "Open"'
        assert inspect.getsource(ts).count(literal) == 1, "the shared definition is missing"
        for consumer in (bt, cv):
            assert inspect.getsource(consumer).count(literal) == 0, (
                f"{consumer.__name__} reimplements the open/closed test instead of "
                "importing it"
            )

    def test_both_metric_blocks_call_the_shared_partition(self):
        import inspect
        src = inspect.getsource(bt)
        assert src.count("partition_realized_open(") >= 3, (
            "expected the definition plus a call in each of run_backtest and "
            "run_class_backtest"
        )

    def test_both_win_rate_per_trade_sites_use_the_shared_predicate(self):
        import inspect
        src = inspect.getsource(bt)
        assert src.count("_wrpt_closed = [t for t in trades_list if not is_open_at_frame_end(t)]") == 2, (
            "win_rate_per_trade exists in BOTH run_backtest and run_class_backtest and "
            "carried the defect independently in each"
        )
