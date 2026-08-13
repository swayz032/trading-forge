"""GRADE F-4 FINDINGS + AR-1095 §6 — closed as permanent tests.

The independent `accuracy-validator` graded the F-4 repair at pin `45e4ca84` on a DISPROVE
mandate: **Band 6 VERIFIED, claim PARTIALLY CONFIRMED**. It could not break the mechanism —
its own oracle, importing nothing from `src.engine`, agreed 14/14 end-to-end and 400/400 on
randomised unit cases — but it found real defects in how the repair REPORTED itself.

Full verdict: `docs/advisor-rulings/GRADE-F4-TRADE-POPULATION-2026-08-12.md` (published unedited).

This file closes F-1 (HIGH), F-2 (HIGH, novel), F-6 (LOW), and the AR-1095 §6 exit-bar
re-entry boundary. F-3 and F-4 are closed in `test_source_trade_population.py`.
"""

import numpy as np
import pytest

import src.engine.backtester as bt
from src.engine.tests.test_source_band_c_vertical import (
    _config,
    _production_flag_state,  # noqa: F401 — autouse fixture, imported for its side effect
)
from src.engine.tests.test_source_trade_population import (
    _bars_sessions,
    _normal,
    _run_bars,
    _second_event_while_open,
)
from src.engine.tests.test_source_vertical_join import _compiled_spec


class TestGradeF2ThePlanIsReconciledAgainstTheOutcome:
    """GRADE FINDING F-2 (HIGH, NOVEL — the grader found it, I did not name it).

    `source_trades_opened` is incremented BEFORE `from_signals` runs. Nothing reconciled it
    against `pf.trades.count()`; the two numbers sat ~55 lines apart in one function with no
    join. The grader forced `compute_position_sizes` to return 0.0 at the first planned entry
    bar: the executed population fell 3 -> 2 while the disclosure line still read
    `trades_opened=3 ... unresolved_open=0` — no exception, no `guards_failed`. SIX assertions
    across two test files string-matched that line, so the whole disclosure limb and its green
    were compatible with a population that never executed.

    ★ `A COUNT WRITTEN BY THE THING BEING MEASURED IS A CLAIM, NOT A MEASUREMENT. IT NEEDS A
       JOIN TO THE ARTIFACT, OR IT REPORTS INTENT WHILE READING LIKE OUTCOME.`

    Red-proofed below with the grader's OWN mutation.
    """

    def _zero_size_at(self, monkeypatch, bar):
        real = bt.compute_position_sizes

        def _wrapped(*a, **kw):
            sizes, over_risk = real(*a, **kw)
            sizes = sizes.copy()
            if bar < len(sizes):
                sizes[bar] = 0.0
            return sizes, over_risk

        monkeypatch.setattr(bt, "compute_position_sizes", _wrapped)

    def test_a_planned_trade_that_does_not_execute_now_REFUSES(self, monkeypatch):
        """THE RED-PROOF. This exact mutation produced a clean green before the repair."""
        self._zero_size_at(monkeypatch, 8)
        with pytest.raises(ValueError, match="population mismatch"):
            _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))

    def test_POSITIVE_CONTROL_the_same_route_unmutated_does_not_refuse(self):
        """Without this, the refusal above is indistinguishable from unrelated breakage."""
        result, _out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        assert len(result["trades"]) == 3

    def test_the_reconciliation_is_REPORTED_not_merely_performed(self):
        result, _out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        occ = result["source_occupancy"]
        assert occ["source_trades_opened"] == 3
        assert occ["source_trades_executed"] == 3
        assert occ["source_population_reconciled"] is True


class TestGradeF1ThePolicyLivesInTheArtifactNotOnlyInALogLine:
    """GRADE FINDING F-1 (HIGH). AR-1092 §8 P2 required the policy to be visible in
    audit/RESULT metadata. I built the metadata, printed it, and never returned it: the
    grader's repo-wide sweep of all eight keys found ZERO consumers, so the only way to read
    the policy was to scrape a stderr string — which is exactly what my own tests did.

    ⚠️ The sibling `dsl_guards` (carrying `source_faithful_bypassed`) WAS already in the
    envelope. The precedent was one line away.

    ★ `A LOG LINE IS EVIDENCE THAT SOMETHING RAN; ONLY THE RETURNED ARTIFACT IS SOMETHING A
       CONSUMER CAN CHECK.`
    """

    def test_the_returned_result_carries_the_occupancy_contract(self):
        result, _out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        occ = result.get("source_occupancy")
        assert isinstance(occ, dict) and occ, "source_occupancy is absent from the envelope"
        for key in (
            "source_events_long", "source_trades_opened", "source_overlap_suppressed",
            "source_overlap_suppressed_bars", "source_unresolved_open", "overlap_policy",
            "source_trades_executed", "source_population_reconciled",
        ):
            assert key in occ, f"{key} missing from the returned occupancy contract"
        assert occ["overlap_policy"] == "reject_while_occupied"

    def test_the_suppressed_BARS_are_read_from_the_artifact_not_scraped_from_stderr(self):
        """The P2 claim re-established on the RESULT. The stderr form is what the grader
        convicted, so the load-bearing version now reads the envelope."""
        result, _out = _run_bars(
            _bars_sessions([_second_event_while_open(), _normal(), _normal()])
        )
        occ = result["source_occupancy"]
        assert occ["source_overlap_suppressed"] == 1
        suppressed = occ["source_overlap_suppressed_bars"]
        assert len(suppressed) == 1
        first = result["trades"][0]
        assert int(first["entry_idx"]) < suppressed[0] <= int(first["Exit Idx"]), (
            "the rejected event is not inside the first trade's open interval"
        )

    def test_a_NON_SOURCE_run_carries_an_EMPTY_contract_never_a_missing_key(self):
        """So a reader never infers the mode from an absent key — the discipline
        `dsl_guards.source_faithful_bypassed` already follows."""
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), _normal()]),
            config=_config(_compiled_spec(source_risk=None)),
        )
        assert result.get("source_occupancy") == {}


class TestGradeF6TheEmptyExitAssumptionIsAsserted:
    """GRADE FINDING F-6 (LOW). The pass writes into arrays it assumes are empty. That
    guarantee lived in the producer, the dependency lived in the consumer, and nothing joined
    them — so the day the producer changed, exits would have been silently mis-paired.

    ★ `AN INVARIANT NOBODY ASSERTS IS A COMMENT, AND A COMMENT CANNOT GO RED.`
    """

    def _flat(self, n=6):
        return (
            np.zeros(n, dtype=bool), np.zeros(n, dtype=bool),
            np.zeros(n, dtype=bool), np.zeros(n, dtype=bool),
        )

    def test_a_strategy_supplied_exit_is_REFUSED_rather_than_merged(self):
        el, xl, es, xs = self._flat()
        xl[3] = True
        with pytest.raises(ValueError, match="incoming exit arrays are NOT empty"):
            bt._apply_source_faithful_occupancy(
                el, xl, es, xs,
                high_np=np.full(6, 100.0), low_np=np.full(6, 100.0),
                close_np=np.full(6, 100.0), open_np=None,
                structural_stop_map=None, r_multiple=2.0,
            )

    def test_POSITIVE_CONTROL_empty_exit_arrays_are_accepted(self):
        el, xl, es, xs = self._flat()
        out = bt._apply_source_faithful_occupancy(
            el, xl, es, xs,
            high_np=np.full(6, 100.0), low_np=np.full(6, 100.0),
            close_np=np.full(6, 100.0), open_np=None,
            structural_stop_map=None, r_multiple=2.0,
        )
        assert out[4]["overlap_policy"] == "reject_while_occupied"


class TestGradeF3AnUnresolvedSourceTradeContaminatesTheMetrics:
    """GRADE FINDING F-3 (MEDIUM, NOVEL). A source trade that reaches NEITHER its taught stop
    nor its taught target before the frame ends still enters the population.

    `[MEASURED HERE]` on a frame whose last session is truncated at the decision candle:

        [0] entry=8  exit=11 Closed source_fixed_r_target  exit_px=134.0  pnl=+73.76
        [1] entry=41 exit=44 Closed source_fixed_r_target  exit_px=134.0  pnl=+1031.40
        [2] entry=74 exit=74 OPEN   signal                 exit_px=119.0  pnl=-93.60

        total_trades=3   win_rate=0.6667   profit_factor=11.8073

    🛑 THE THIRD ROW IS NOT A TRADE THE TEACHER EVER CLOSED. It is marked to market at the
    last bar, its `exit_reason` is the generic `signal` rather than any source reason, its
    "loss" is exactly its costs — and it counts toward `total_trades`, `win_rate` and
    `profit_factor`, dragging the win rate from 100% to 66.67%.

    ★ `A POSITION THE FRAME ENDED ON IS AN OPEN RISK, NOT A RESULT — AND AVERAGING IT INTO A
       WIN RATE TURNS "WE DO NOT KNOW YET" INTO "WE LOST".`

    ⚠️ I AM PINNING THIS, NOT FIXING IT. Excluding open trades from performance metrics is a
    money-path semantics decision (it changes `win_rate`/`profit_factor` for LEGACY too), and
    AR-1095 §7 puts performance behind the sizing repair. Escalated in AR-1097; this test
    makes the contamination impossible to rediscover by accident.
    """

    def _truncated_last_session(self):
        from src.engine.tests.test_source_vertical_join import _SESSION
        return [tuple(r) for r in _SESSION][:9]  # ends ON the decision candle

    def test_an_unresolved_trade_is_DISCLOSED_in_the_occupancy_contract(self):
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), self._truncated_last_session()])
        )
        occ = result["source_occupancy"]
        assert occ["source_unresolved_open"] == 1, (
            "POSITIVE WITNESS FAILED: no trade was left unresolved, so this fixture measures "
            "nothing about the open-trade class"
        )
        plan = occ["source_trade_plan"][-1]
        assert plan["exit_idx"] is None
        assert plan["exit_reason"] == "open_at_frame_end", (
            "the unresolved trade is no longer named as such in the plan"
        )

    def test_the_unresolved_trade_still_COUNTS_toward_the_reported_metrics(self):
        """The contamination itself, pinned. If a later ruling excludes open trades from
        performance metrics, THIS test goes red — which is the correct signal, not a
        regression."""
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), self._truncated_last_session()])
        )
        trades = result["trades"]
        assert len(trades) == 3
        open_trade = trades[-1]
        assert open_trade["Status"] == "Open"
        assert open_trade["exit_reason"] == "signal", (
            "the open trade carries a SOURCE exit reason — it must not, because the source "
            "never closed it"
        )
        assert open_trade["PnL"] < 0, "the open trade is no longer booked as a loss"
        assert result["total_trades"] == 3
        assert result["win_rate"] == pytest.approx(0.6667, abs=1e-4), (
            "the win rate changed — if open trades are now excluded from metrics, delete this "
            "test and say so in the report"
        )

    def test_the_two_RESOLVED_trades_are_untouched_by_the_open_one(self):
        """The unresolved trade must contaminate the AGGREGATES only — never the source-owned
        values of the trades that did complete."""
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), self._truncated_last_session()])
        )
        for t in result["trades"][:2]:
            assert t["exit_reason"] == "source_fixed_r_target"
            assert t["Avg Exit Price"] == 134.0
            assert t["Status"] == "Closed"


class TestAR1095ExitBarReEntryBoundary:
    """AR-1095 §6 — the boundary GPT found that my P2 ENCODED rather than TESTED.

    `i <= occupied_until` also rejects an event on the EXACT bar the prior trade closes. My P2
    asserted the rejected bar lies in `(entry, exit]`, which restates the convention instead of
    proving the choice was deliberate.

    🛑 THE CONSERVATIVE POLICY IS THE HONEST ONE, AND IT IS STATED RATHER THAN INFERRED.
    Within one OHLC bar the tick order is unknown, so we cannot show the prior trade's
    stop/target was touched BEFORE the new decision candle's close. Accepting a same-bar
    re-entry would invent a favourable intrabar fill. It is REJECTED and COUNTED — matching
    `_apply_dsl_stop_loss_and_time_stop`'s own occupancy convention, which the grader
    independently confirmed as the house convention.
    """

    def _run_unit(self, entry_bars, target_bar):
        n = 6
        el = np.zeros(n, dtype=bool)
        for b in entry_bars:
            el[b] = True
        xl, es, xs = np.zeros(n, dtype=bool), np.zeros(n, dtype=bool), np.zeros(n, dtype=bool)
        close = np.full(n, 100.0)
        high = np.full(n, 101.0)
        low = np.full(n, 99.0)
        high[target_bar] = 125.0  # 2R off a 10-point stop = 120, so this bar hits the target
        stop_map = {"long": {b: {"distance": 10.0} for b in entry_bars}, "short": {}}
        return bt._apply_source_faithful_occupancy(
            el, xl, es, xs,
            high_np=high, low_np=low, close_np=close, open_np=None,
            structural_stop_map=stop_map, r_multiple=2.0,
        )

    def test_an_entry_ON_the_exit_bar_is_REJECTED_and_DISCLOSED(self):
        _el, xl, _es, _xs, meta = self._run_unit(entry_bars=[1, 3], target_bar=3)
        assert bool(xl[3]), (
            "POSITIVE WITNESS FAILED: the first trade did not exit on bar 3, so this fixture "
            "is not testing the exit-bar boundary at all"
        )
        assert meta["source_trades_opened"] == 1, "the same-bar re-entry was accepted"
        assert meta["source_overlap_suppressed"] == 1
        assert meta["source_overlap_suppressed_bars"] == [3]
        assert meta["source_trade_plan"][0]["exit_idx"] == 3
        assert meta["source_trade_plan"][0]["exit_reason"] == "source_fixed_r_target"

    def test_POSITIVE_WITNESS_an_entry_AFTER_the_exit_bar_is_ACCEPTED(self):
        """Without this, 'rejected' above is indistinguishable from a pass that rejects every
        second event regardless of where the prior trade closed."""
        _el, _xl, _es, _xs, meta = self._run_unit(entry_bars=[1, 4], target_bar=3)
        assert meta["source_trades_opened"] == 2, (
            "an event strictly AFTER the prior exit bar was rejected — the policy is not a "
            "boundary rule, it is suppressing everything"
        )
        assert meta["source_overlap_suppressed"] == 0
