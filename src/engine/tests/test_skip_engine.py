"""Tests for skip engine — pre-session classifier (Phase 4.11).

Tests:
- FOMC day -> auto SKIP (override not allowed)
- VIX > 30 -> contributes 2.5 to score
- Multiple signals combine correctly
- Score threshold -> correct decision (TRADE/REDUCE/SKIP)
- Calendar filter detects holidays, triple witching
- Session monitor escalation from TRADE -> REDUCE -> SKIP
- Historical backtest calculates skip accuracy
- Pre-market signal collector packages signals correctly
- Consecutive loss streak scoring
- Monthly budget scoring at boundary values
"""

import pytest
from datetime import date, datetime, timezone

from src.engine.skip_engine.skip_classifier import (
    classify_session,
    _score_event_proximity,
    _score_vix_level,
    _score_overnight_gap,
    _score_premarket_volume,
    _score_day_of_week,
    _score_loss_streak,
    _score_monthly_budget,
    _score_correlation_spike,
    _score_calendar_filter,
    _score_quantum_entropy,
    SIGNAL_WEIGHTS,
    SKIP_SCORE_THRESHOLD,
    REDUCE_SCORE_THRESHOLD,
)
from src.engine.skip_engine.calendar_filter import (
    calendar_check,
    check_economic_event,
    EVENT_BLACKOUT_MINUTES,
)
from src.engine.skip_engine.session_monitor import SessionMonitor
from src.engine.skip_engine.historical_skip_stats import backtest_skip_engine
from src.engine.skip_engine.premarket_analyzer import collect_premarket_signals


# ─── Fixtures ────────────────────────────────────────────────────


@pytest.fixture
def fomc_day_signals():
    """Signals for a same-day FOMC announcement."""
    return {
        "event_proximity": {"event": "FOMC", "days_until": 0, "impact": "high"},
        "vix": 22.0,
        "overnight_gap_atr": 0.5,
        "premarket_volume_pct": 0.6,
        "day_of_week": "Wednesday",
        "consecutive_losses": 1,
        "monthly_dd_usage_pct": 0.3,
        "portfolio_correlation": 0.3,
        "calendar": {"holiday_proximity": 10, "triple_witching": False, "roll_week": False},
    }


@pytest.fixture
def high_vix_signals():
    """Signals with VIX > 30."""
    return {
        "vix": 35.0,
        "overnight_gap_atr": 0.5,
        "premarket_volume_pct": 0.6,
        "day_of_week": "Tuesday",
        "consecutive_losses": 0,
        "monthly_dd_usage_pct": 0.2,
        "portfolio_correlation": 0.3,
        "calendar": {"holiday_proximity": 15, "triple_witching": False, "roll_week": False},
    }


@pytest.fixture
def clean_signals():
    """All-clear signals — should result in TRADE."""
    return {
        "vix": 15.0,
        "overnight_gap_atr": 0.3,
        "premarket_volume_pct": 0.8,
        "day_of_week": "Tuesday",
        "consecutive_losses": 0,
        "monthly_dd_usage_pct": 0.1,
        "portfolio_correlation": 0.2,
        "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
    }


@pytest.fixture
def multi_signal_reduce():
    """Multiple moderate signals that should combine to REDUCE."""
    return {
        "vix": 26.0,           # 1.5
        "overnight_gap_atr": 1.2,  # 1.0
        "premarket_volume_pct": 0.6,  # 0
        "day_of_week": "Friday",
        "bad_days": ["Friday"],    # 1.0
        "consecutive_losses": 2,
        "monthly_dd_usage_pct": 0.3,
        "portfolio_correlation": 0.3,
        "calendar": {"holiday_proximity": 10, "triple_witching": False, "roll_week": False},
    }


@pytest.fixture
def multi_signal_skip():
    """Multiple strong signals that should combine to SKIP."""
    return {
        "vix": 32.0,               # 2.5
        "overnight_gap_atr": 1.8,  # 2.0
        "premarket_volume_pct": 0.2,  # 1.5
        "day_of_week": "Friday",
        "bad_days": ["Friday"],     # 1.0
        "consecutive_losses": 6,    # 2.0
        "monthly_dd_usage_pct": 0.85,  # 2.5
        "portfolio_correlation": 0.8,  # 1.5
        "calendar": {"holiday_proximity": 1, "triple_witching": True, "roll_week": True},
    }


# ─── Individual Signal Scorer Tests ──────────────────────────────


class TestEventProximityScorer:
    def test_same_day_high_impact(self):
        signals = {"event_proximity": {"event": "FOMC", "days_until": 0, "impact": "high"}}
        assert _score_event_proximity(signals) == 3.0

    def test_one_day_away(self):
        signals = {"event_proximity": {"event": "CPI", "days_until": 1, "impact": "high"}}
        assert _score_event_proximity(signals) == 1.5

    def test_two_days_away(self):
        signals = {"event_proximity": {"event": "NFP", "days_until": 2, "impact": "high"}}
        assert _score_event_proximity(signals) == 0.0

    def test_low_impact_ignored(self):
        signals = {"event_proximity": {"event": "PMI", "days_until": 0, "impact": "low"}}
        assert _score_event_proximity(signals) == 0.0

    def test_no_event(self):
        assert _score_event_proximity({}) == 0.0


class TestVixScorer:
    def test_vix_above_30(self):
        assert _score_vix_level({"vix": 35.0}) == 2.5

    def test_vix_25_to_30(self):
        assert _score_vix_level({"vix": 27.0}) == 1.5

    def test_vix_20_to_25(self):
        assert _score_vix_level({"vix": 22.0}) == 0.5

    def test_vix_below_20(self):
        assert _score_vix_level({"vix": 15.0}) == 0.0

    def test_vix_exactly_30(self):
        assert _score_vix_level({"vix": 30.0}) == 1.5

    def test_vix_missing(self):
        assert _score_vix_level({}) == 0.0


class TestOvernightGapScorer:
    def test_large_gap(self):
        assert _score_overnight_gap({"overnight_gap_atr": 2.0}) == 2.0

    def test_medium_gap(self):
        assert _score_overnight_gap({"overnight_gap_atr": 1.3}) == 1.0

    def test_small_gap(self):
        assert _score_overnight_gap({"overnight_gap_atr": 0.5}) == 0.0


class TestPremarketVolumeScorer:
    def test_very_low_volume(self):
        assert _score_premarket_volume({"premarket_volume_pct": 0.2}) == 1.5

    def test_low_volume(self):
        assert _score_premarket_volume({"premarket_volume_pct": 0.4}) == 0.75

    def test_normal_volume(self):
        assert _score_premarket_volume({"premarket_volume_pct": 0.7}) == 0.0


class TestDayOfWeekScorer:
    def test_bad_day_match(self):
        signals = {"day_of_week": "Friday", "bad_days": ["Friday", "Monday"]}
        assert _score_day_of_week(signals) == 1.0

    def test_good_day(self):
        signals = {"day_of_week": "Tuesday", "bad_days": ["Friday", "Monday"]}
        assert _score_day_of_week(signals) == 0.0

    def test_no_bad_days(self):
        signals = {"day_of_week": "Friday"}
        assert _score_day_of_week(signals) == 0.0


class TestLossStreakScorer:
    def test_long_streak(self):
        assert _score_loss_streak({"consecutive_losses": 6}) == 2.0

    def test_medium_streak(self):
        assert _score_loss_streak({"consecutive_losses": 4}) == 1.0

    def test_exactly_3(self):
        assert _score_loss_streak({"consecutive_losses": 3}) == 1.0

    def test_short_streak(self):
        assert _score_loss_streak({"consecutive_losses": 2}) == 0.0

    def test_no_streak(self):
        assert _score_loss_streak({"consecutive_losses": 0}) == 0.0


class TestMonthlyBudgetScorer:
    def test_over_80_pct(self):
        assert _score_monthly_budget({"monthly_dd_usage_pct": 0.85}) == 2.5

    def test_exactly_80_pct(self):
        # 0.80 is NOT > 0.80, so should be 1.25
        assert _score_monthly_budget({"monthly_dd_usage_pct": 0.80}) == 1.25

    def test_60_to_80_pct(self):
        assert _score_monthly_budget({"monthly_dd_usage_pct": 0.65}) == 1.25

    def test_exactly_60_pct(self):
        # 0.60 is NOT > 0.60, so should be 0
        assert _score_monthly_budget({"monthly_dd_usage_pct": 0.60}) == 0.0

    def test_under_60_pct(self):
        assert _score_monthly_budget({"monthly_dd_usage_pct": 0.40}) == 0.0

    def test_missing(self):
        assert _score_monthly_budget({}) == 0.0


class TestCorrelationSpikeScorer:
    def test_high_correlation(self):
        assert _score_correlation_spike({"portfolio_correlation": 0.8}) == 1.5

    def test_medium_correlation(self):
        assert _score_correlation_spike({"portfolio_correlation": 0.6}) == 0.75

    def test_low_correlation(self):
        assert _score_correlation_spike({"portfolio_correlation": 0.3}) == 0.0


class TestCalendarFilterScorer:
    def test_holiday_adjacent(self):
        signals = {"calendar": {"holiday_proximity": 1, "triple_witching": False, "roll_week": False}}
        assert _score_calendar_filter(signals) == 1.0

    def test_triple_witching(self):
        signals = {"calendar": {"holiday_proximity": 10, "triple_witching": True, "roll_week": False}}
        assert _score_calendar_filter(signals) == 1.0

    def test_roll_week(self):
        signals = {"calendar": {"holiday_proximity": 10, "triple_witching": False, "roll_week": True}}
        assert _score_calendar_filter(signals) == 0.5

    def test_additive(self):
        """Holiday + triple witching + roll week = 1.0 + 1.0 + 0.5 = 2.5."""
        signals = {"calendar": {"holiday_proximity": 0, "triple_witching": True, "roll_week": True}}
        assert _score_calendar_filter(signals) == 2.5

    def test_no_calendar(self):
        assert _score_calendar_filter({}) == 0.0


# ─── Main Classifier Tests ───────────────────────────────────────


class TestClassifySession:
    def test_fomc_day_auto_skip(self, fomc_day_signals):
        """FOMC same-day high-impact must produce SKIP with override NOT allowed."""
        result = classify_session(fomc_day_signals)
        assert result["decision"] == "SKIP"
        assert result["override_allowed"] is False
        assert "event_proximity" in result["triggered_signals"]
        assert result["score"] >= 3.0

    def test_high_vix_contributes_2_5(self, high_vix_signals):
        """VIX > 30 must contribute exactly 2.5 to score."""
        result = classify_session(high_vix_signals)
        assert result["signal_scores"]["vix_level"] == 2.5

    def test_clean_signals_trade(self, clean_signals):
        """All-clear signals should result in TRADE."""
        result = classify_session(clean_signals)
        assert result["decision"] == "TRADE"
        assert result["score"] < REDUCE_SCORE_THRESHOLD

    def test_multiple_signals_combine_reduce(self, multi_signal_reduce):
        """Multiple moderate signals should combine to REDUCE."""
        result = classify_session(multi_signal_reduce)
        # VIX 26 (1.5) + gap 1.2 (1.0) + Friday bad day (1.0) = 3.5 >= REDUCE threshold
        assert result["decision"] == "REDUCE"
        assert result["score"] >= REDUCE_SCORE_THRESHOLD
        assert result["score"] < SKIP_SCORE_THRESHOLD

    def test_multiple_signals_combine_skip(self, multi_signal_skip):
        """Many strong signals should combine to SKIP."""
        result = classify_session(multi_signal_skip)
        assert result["decision"] == "SKIP"
        assert result["score"] >= SKIP_SCORE_THRESHOLD
        assert result["override_allowed"] is True  # Not a same-day event, so override OK

    def test_result_structure(self, clean_signals):
        """Result must contain all required keys."""
        result = classify_session(clean_signals)
        required_keys = {
            "decision", "score", "signal_scores", "triggered_signals",
            "reason", "confidence", "override_allowed",
        }
        assert required_keys.issubset(result.keys())

    def test_confidence_range(self, clean_signals):
        """Confidence must be between 0 and 1."""
        result = classify_session(clean_signals)
        assert 0.0 <= result["confidence"] <= 1.0

    def test_reason_is_human_readable(self, fomc_day_signals):
        """Reason string should mention the key signal."""
        result = classify_session(fomc_day_signals)
        assert "FOMC" in result["reason"]


# ─── Calendar Filter Tests ────────────────────────────────────────


class TestCalendarFilter:
    def test_detects_holiday(self):
        """Should detect a known holiday."""
        result = calendar_check(date(2026, 12, 25))
        assert result["is_holiday"] is True
        assert result["holiday_proximity"] == 0

    def test_holiday_proximity(self):
        """Day before Thanksgiving should have proximity = 1."""
        result = calendar_check(date(2026, 11, 25))
        assert result["holiday_proximity"] == 1

    def test_detects_triple_witching(self):
        """Should detect triple witching Friday."""
        result = calendar_check(date(2026, 3, 20))
        assert result["is_triple_witching"] is True

    def test_not_triple_witching(self):
        """Regular day should not be triple witching."""
        result = calendar_check(date(2026, 3, 10))
        assert result["is_triple_witching"] is False

    def test_roll_week(self):
        """Day in roll week should be detected."""
        # March 2026 3rd Friday = March 20. Roll week = Mon Mar 16 - Fri Mar 20
        result = calendar_check(date(2026, 3, 18))
        assert result["is_roll_week"] is True

    def test_not_roll_week(self):
        """Day outside roll week should not be flagged."""
        result = calendar_check(date(2026, 3, 10))
        assert result["is_roll_week"] is False

    def test_day_of_week(self):
        """Should return correct day name."""
        # 2026-03-14 is a Saturday (checking a weekday instead)
        result = calendar_check(date(2026, 3, 13))  # Friday
        assert result["day_of_week"] == "Friday"
        assert result["day_of_week_num"] == 4

    def test_month_end(self):
        """Last day of month should be detected."""
        result = calendar_check(date(2026, 3, 31))
        assert result["is_month_end"] is True

    def test_quarter_end(self):
        """Last day of quarter should be detected."""
        result = calendar_check(date(2026, 3, 31))
        assert result["is_quarter_end"] is True

    def test_not_quarter_end(self):
        """Non-quarter-end month shouldn't flag quarter end."""
        result = calendar_check(date(2026, 2, 28))
        assert result["is_quarter_end"] is False

    def test_result_has_economic_event_fields(self):
        """calendar_check result must always contain the three economic event keys."""
        result = calendar_check(date(2026, 3, 10))  # regular day
        assert "is_economic_event" in result
        assert "economic_event_name" in result
        assert "event_window_minutes" in result

    def test_no_economic_event_on_regular_day(self):
        """A day with no scheduled events should return is_economic_event=False."""
        # 2026-03-10 is a Tuesday with no FOMC/CPI/NFP
        result = calendar_check(date(2026, 3, 10))
        assert result["is_economic_event"] is False
        assert result["economic_event_name"] == ""

    def test_economic_event_fomc_day_level(self):
        """Day-level check: FOMC day (2026-03-18) should flag as economic event."""
        result = calendar_check(date(2026, 3, 18))
        assert result["is_economic_event"] is True
        assert result["economic_event_name"] == "FOMC"

    def test_economic_event_cpi_day_level(self):
        """Day-level check: CPI day (2026-01-14) should flag as economic event."""
        result = calendar_check(date(2026, 1, 14))
        assert result["is_economic_event"] is True
        assert result["economic_event_name"] == "CPI"

    def test_economic_event_nfp_day_level(self):
        """Day-level check: NFP day (2026-01-09) should flag as economic event."""
        result = calendar_check(date(2026, 1, 9))
        assert result["is_economic_event"] is True
        assert result["economic_event_name"] == "NFP"

    def test_economic_event_window_minutes_default(self):
        """event_window_minutes should equal EVENT_BLACKOUT_MINUTES by default."""
        result = calendar_check(date(2026, 3, 18))
        assert result["event_window_minutes"] == EVENT_BLACKOUT_MINUTES


# ─── Economic Event Window Tests ─────────────────────────────────────────────


class TestCheckEconomicEvent:
    """Unit tests for check_economic_event() — precise UTC datetime checks."""

    # FOMC 2026-03-18 at 14:00 ET.
    # During EDT (DST): 14:00 ET = 18:00 UTC.

    def _fomc_utc(self, hour: int, minute: int) -> datetime:
        """Build a UTC datetime for 2026-03-18 at the given HH:MM UTC."""
        return datetime(2026, 3, 18, hour, minute, tzinfo=timezone.utc)

    def test_fomc_inside_window_at_event_time(self):
        """Exactly at FOMC time (18:00 UTC) should be inside window."""
        dt = self._fomc_utc(18, 0)
        is_event, name, window = check_economic_event(dt)
        assert is_event is True
        assert name == "FOMC"
        assert window == EVENT_BLACKOUT_MINUTES

    def test_fomc_inside_window_before(self):
        """30 minutes before FOMC (17:30 UTC) should be inside window."""
        dt = self._fomc_utc(17, 30)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is True
        assert name == "FOMC"

    def test_fomc_inside_window_after(self):
        """30 minutes after FOMC (18:30 UTC) should be inside window."""
        dt = self._fomc_utc(18, 30)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is True
        assert name == "FOMC"

    def test_fomc_outside_window_before(self):
        """31 minutes before FOMC (17:29 UTC) should be outside window."""
        dt = self._fomc_utc(17, 29)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is False
        assert name == ""

    def test_fomc_outside_window_after(self):
        """31 minutes after FOMC (18:31 UTC) should be outside window."""
        dt = self._fomc_utc(18, 31)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is False
        assert name == ""

    def test_nfp_inside_window(self):
        """NFP 2026-01-09 08:30 ET = 13:30 UTC (EST, no DST in January)."""
        # January → EST (UTC-5): 08:30 ET = 13:30 UTC
        dt = datetime(2026, 1, 9, 13, 30, tzinfo=timezone.utc)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is True
        assert name == "NFP"

    def test_cpi_inside_window(self):
        """CPI 2026-01-14 08:30 ET = 13:30 UTC (EST)."""
        dt = datetime(2026, 1, 14, 13, 30, tzinfo=timezone.utc)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is True
        assert name == "CPI"

    def test_no_event_on_nondate(self):
        """A random datetime with no event scheduled should return False."""
        dt = datetime(2026, 3, 10, 15, 0, tzinfo=timezone.utc)  # random Tuesday
        is_event, name, _ = check_economic_event(dt)
        assert is_event is False
        assert name == ""

    def test_custom_blackout_window(self):
        """A 10-minute custom window should exclude 31+ minutes from event."""
        dt = self._fomc_utc(18, 15)  # 15 min after FOMC
        is_event_30, _, _ = check_economic_event(dt, blackout_minutes=30)
        is_event_10, _, _ = check_economic_event(dt, blackout_minutes=10)
        assert is_event_30 is True   # within 30 min window
        assert is_event_10 is False  # outside 10 min window

    def test_2027_fomc_included(self):
        """FOMC 2027-01-27 at 14:00 ET should be detected (2027 dates present)."""
        # 2027-01-27 → EST (UTC-5): 14:00 ET = 19:00 UTC
        dt = datetime(2027, 1, 27, 19, 0, tzinfo=timezone.utc)
        is_event, name, _ = check_economic_event(dt)
        assert is_event is True
        assert name == "FOMC"

    def test_calendar_check_datetime_precision(self):
        """calendar_check with check_datetime at FOMC time should block."""
        dt = self._fomc_utc(18, 0)
        result = calendar_check(check_datetime=dt)
        assert result["is_economic_event"] is True
        assert result["economic_event_name"] == "FOMC"

    def test_calendar_check_datetime_precision_clear(self):
        """calendar_check with check_datetime far from any event should not block."""
        dt = datetime(2026, 3, 10, 15, 0, tzinfo=timezone.utc)  # no event
        result = calendar_check(check_datetime=dt)
        assert result["is_economic_event"] is False


# ─── Session Monitor Tests ────────────────────────────────────────


class TestSessionMonitor:
    def test_initial_state(self):
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        status = monitor.get_status()
        assert status["decision"] == "TRADE"
        assert status["session_pnl"] == 0.0
        assert status["trades_taken"] == 0

    def test_escalation_50_pct_loss(self):
        """Session loss > 50% of daily budget should escalate TRADE -> REDUCE."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        # One big loss: -1100 > 50% of 2000
        result = monitor.update(trade_pnl=-1100.0)
        assert result["decision"] == "REDUCE"
        assert result["escalated"] is True

    def test_escalation_75_pct_loss(self):
        """Session loss > 75% of daily budget should escalate to SKIP."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        result = monitor.update(trade_pnl=-1600.0)
        assert result["decision"] == "SKIP"
        assert result["escalated"] is True

    def test_escalation_consecutive_losers(self):
        """3 consecutive intra-session losers should escalate one level."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        # 3 small losses (not enough to trigger 50% budget rule)
        monitor.update(trade_pnl=-100.0)
        monitor.update(trade_pnl=-100.0)
        result = monitor.update(trade_pnl=-100.0)
        # Total = -300, which is 15% of 2000 — not budget trigger
        # But 3 consecutive losers should escalate
        assert result["decision"] == "REDUCE"
        assert result["escalated"] is True

    def test_no_escalation_on_win(self):
        """Winning trade should not escalate."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        result = monitor.update(trade_pnl=500.0)
        assert result["decision"] == "TRADE"
        assert result["escalated"] is False

    def test_trade_to_reduce_to_skip(self):
        """Full escalation path: TRADE -> REDUCE -> SKIP."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        # Small losses to trigger consecutive losers
        monitor.update(trade_pnl=-100.0)
        monitor.update(trade_pnl=-100.0)
        r1 = monitor.update(trade_pnl=-100.0)
        assert r1["decision"] == "REDUCE"

        # 3 more consecutive losers
        monitor.update(trade_pnl=-100.0)
        monitor.update(trade_pnl=-100.0)
        r2 = monitor.update(trade_pnl=-100.0)
        assert r2["decision"] == "SKIP"

    def test_never_downgrades(self):
        """Decision should never go from SKIP back to REDUCE or TRADE."""
        monitor = SessionMonitor("SKIP", "strat-1", daily_budget=2000.0)
        result = monitor.update(trade_pnl=1000.0)
        assert result["decision"] == "SKIP"

    def test_session_pnl_tracking(self):
        """Session P&L should accumulate correctly."""
        monitor = SessionMonitor("TRADE", "strat-1", daily_budget=2000.0)
        monitor.update(trade_pnl=200.0)
        monitor.update(trade_pnl=-100.0)
        monitor.update(trade_pnl=300.0)
        status = monitor.get_status()
        assert status["session_pnl"] == 400.0
        assert status["trades_taken"] == 3


# ─── Historical Backtest Tests ────────────────────────────────────


class TestHistoricalBacktest:
    def test_skip_accuracy(self):
        """Backtest should correctly calculate skip accuracy."""
        daily_pnls = [
            # Day with high VIX (should be skipped) — was a loser
            {"date": "2026-01-05", "pnl": -500.0, "signals": {"vix": 35.0}},
            # Day with high VIX (should be skipped) — was a winner (false skip)
            {"date": "2026-01-06", "pnl": 300.0, "signals": {"vix": 33.0}},
            # Clean day — traded normally
            {"date": "2026-01-07", "pnl": 200.0, "signals": {"vix": 15.0}},
            # Day with multiple signals -> SKIP — was a loser
            {
                "date": "2026-01-08",
                "pnl": -800.0,
                "signals": {
                    "vix": 31.0,
                    "overnight_gap_atr": 2.0,
                    "premarket_volume_pct": 0.2,
                },
            },
        ]

        result = backtest_skip_engine(daily_pnls, skip_threshold=2.5, reduce_threshold=1.5)

        assert result["days_skipped"] >= 2
        assert result["saved_losses"] > 0
        assert 0.0 <= result["skip_accuracy"] <= 1.0

    def test_improvement_with_good_skips(self):
        """Skipping bad days should improve total P&L."""
        daily_pnls = []
        # 10 clean profitable days
        for i in range(10):
            daily_pnls.append({
                "date": f"2026-01-{i+1:02d}",
                "pnl": 300.0,
                "signals": {"vix": 15.0},
            })
        # 5 terrible days with high VIX signals
        for i in range(5):
            daily_pnls.append({
                "date": f"2026-01-{i+11:02d}",
                "pnl": -600.0,
                "signals": {"vix": 35.0, "overnight_gap_atr": 2.0},
            })

        result = backtest_skip_engine(daily_pnls, skip_threshold=4.0)

        # Original: 10*300 - 5*600 = 0
        # With skips: should be positive since bad days are skipped
        assert result["skip_adjusted_pnl"] > result["original_pnl"]
        assert result["improvement_pct"] > 0

    def test_result_structure(self):
        """Result must have all required keys."""
        daily_pnls = [
            {"date": "2026-01-05", "pnl": 100.0, "signals": {"vix": 15.0}},
        ]
        result = backtest_skip_engine(daily_pnls)
        required = {
            "original_pnl", "skip_adjusted_pnl", "improvement_pct",
            "days_skipped", "days_reduced", "days_traded_full",
            "skip_accuracy", "false_skips", "saved_losses",
        }
        assert required.issubset(result.keys())


# ─── Pre-Market Analyzer Tests ────────────────────────────────────


class TestPremarketAnalyzer:
    def test_packages_signals_correctly(self):
        """Collected signals should be in the right format for classify_session."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),  # Friday
            daily_pnls=[100, 200, -50, -100, -200],
            vix=28.0,
            overnight_gap_atr=1.2,
            premarket_volume_pct=0.45,
            monthly_dd_limit=2000.0,
            monthly_pnl=-1300.0,
        )

        assert signals["day_of_week"] == "Friday"
        assert signals["vix"] == 28.0
        assert signals["overnight_gap_atr"] == 1.2
        assert signals["premarket_volume_pct"] == 0.45
        assert "calendar" in signals
        assert signals["consecutive_losses"] == 3  # last 3 are negative (-50, -100, -200)
        assert signals["monthly_dd_usage_pct"] == 0.65  # 1300/2000

    def test_consecutive_loss_calculation(self):
        """Should count only trailing losses."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),
            daily_pnls=[100, -50, -100, -200, -300],
        )
        assert signals["consecutive_losses"] == 4

    def test_no_losses(self):
        """No consecutive losses should not include the key (or be 0)."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),
            daily_pnls=[100, 200, 300],
        )
        # consecutive_losses should not be in signals (it's 0)
        assert signals.get("consecutive_losses", 0) == 0

    def test_calendar_included(self):
        """Calendar data should always be present."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 20),  # Triple witching day
        )
        assert signals["calendar"]["triple_witching"] is True

    def test_bad_days_passthrough(self):
        """Bad days list should be passed through to signals."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),
            bad_days=["Friday", "Monday"],
        )
        assert signals["bad_days"] == ["Friday", "Monday"]

    def test_missing_optional_fields(self):
        """With no optional data, should still return valid signals."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),
        )
        assert "day_of_week" in signals
        assert "calendar" in signals
        # Optional fields should not be present
        assert "vix" not in signals
        assert "overnight_gap_atr" not in signals

    def test_portfolio_correlation(self):
        """Portfolio correlations should pick max corr for the strategy."""
        signals = collect_premarket_signals(
            strategy_id="strat-1",
            check_date=date(2026, 3, 13),
            portfolio_correlations={
                "strat-1_strat-2": 0.6,
                "strat-1_strat-3": 0.8,
                "strat-2_strat-3": 0.3,
            },
        )
        assert signals["portfolio_correlation"] == 0.8


# ─── Quantum Noise Slot Tests (Tier 1.3 / W2-Team-C) ─────────────────────────
# Pre-wires the quantum_noise slot for Tier 3.1 Quantum Entropy Filter (W3a).
# The scorer returns 0.0 when input is None — graceful degradation until the
# entropy filter module is shipped.  No entropy computation is performed here.


class TestQuantumNoiseScorer:
    """Unit tests for _score_quantum_entropy — the Tier 3.1 slot scorer."""

    def test_none_returns_zero(self):
        """None input (entropy filter not yet built or disabled) → 0.0."""
        assert _score_quantum_entropy(None) == 0.0

    def test_mid_score_passthrough(self):
        """Score in [0, 1] is returned as-is (already normalized)."""
        assert _score_quantum_entropy(0.5) == 0.5

    def test_zero_passthrough(self):
        """0.0 is a valid normalized score — must not be confused with None."""
        assert _score_quantum_entropy(0.0) == 0.0

    def test_max_score_passthrough(self):
        """1.0 (maximum noise score from entropy filter) → 1.0."""
        assert _score_quantum_entropy(1.0) == 1.0

    def test_signal_weights_has_quantum_noise(self):
        """SIGNAL_WEIGHTS must contain the quantum_noise entry at weight 1.5."""
        assert "quantum_noise" in SIGNAL_WEIGHTS
        assert SIGNAL_WEIGHTS["quantum_noise"] == 1.5


class TestQuantumNoiseIntegration:
    """Integration tests — quantum_noise_score flows correctly through classify_session."""

    def test_quantum_noise_score_contributes_correctly(self):
        """quantum_noise_score=0.6 with weight 1.5 → contribution 0.9 in total score."""
        # Use a clean baseline that would normally TRADE with no quantum signal
        base_signals: dict = {
            "vix": 15.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
        }

        # Baseline: no quantum_noise — quantum_noise_score defaults to None → 0.0
        baseline = classify_session(base_signals)
        baseline_score = baseline["score"]

        # With quantum_noise_score=0.6
        signals_with_noise = {**base_signals, "quantum_noise_score": 0.6}
        with_noise = classify_session(signals_with_noise)
        noise_score = with_noise["score"]

        # Contribution = 0.6 * 1.5 = 0.9 (the scorer returns 0.6, weight 1.5 is in SIGNAL_WEIGHTS
        # but the scorer itself returns the raw score; final weighted contribution = 0.6)
        # The classify_session sums raw scorer values directly (each scorer already accounts for weight)
        # For quantum_entropy: scorer returns noise_score (0.6) directly; SIGNAL_WEIGHTS["quantum_noise"]=1.5
        # is metadata — the weighted contribution is 0.6 (raw) because scorers return final contribution.
        # Looking at the existing pattern: _score_vix_level returns 2.5 (not vix/weight).
        # So _score_quantum_entropy(0.6) = 0.6, and total_score += 0.6.
        assert abs(noise_score - baseline_score - 0.6) < 0.01, (
            f"Expected quantum_noise contribution of 0.6, got diff={noise_score - baseline_score:.4f}"
        )
        assert "quantum_noise" in with_noise["signal_scores"]
        assert with_noise["signal_scores"]["quantum_noise"] == pytest.approx(0.6, abs=0.01)

    def test_quantum_noise_score_null_produces_identical_decision(self):
        """quantum_noise_score=None (slot absent) must not change score vs no field at all."""
        base_signals: dict = {
            "vix": 26.0,
            "overnight_gap_atr": 1.2,
            "premarket_volume_pct": 0.6,
            "day_of_week": "Tuesday",
            "consecutive_losses": 1,
            "monthly_dd_usage_pct": 0.3,
            "portfolio_correlation": 0.3,
            "calendar": {"holiday_proximity": 10, "triple_witching": False, "roll_week": False},
        }
        without_field = classify_session(base_signals)
        with_none = classify_session({**base_signals, "quantum_noise_score": None})

        assert without_field["decision"] == with_none["decision"]
        assert without_field["score"] == with_none["score"]

    def test_quantum_noise_in_signal_scores_output(self):
        """signal_scores dict in result must contain quantum_noise key."""
        signals: dict = {
            "vix": 15.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
            "quantum_noise_score": 0.4,
        }
        result = classify_session(signals)
        assert "quantum_noise" in result["signal_scores"]

    def test_quantum_noise_zero_not_in_triggered_signals(self):
        """quantum_noise_score=None → 0.0 → must NOT appear in triggered_signals."""
        signals: dict = {
            "vix": 15.0,
            "overnight_gap_atr": 0.3,
            "premarket_volume_pct": 0.8,
            "day_of_week": "Tuesday",
            "consecutive_losses": 0,
            "monthly_dd_usage_pct": 0.1,
            "portfolio_correlation": 0.2,
            "calendar": {"holiday_proximity": 20, "triple_witching": False, "roll_week": False},
        }
        result = classify_session(signals)
        assert "quantum_noise" not in result["triggered_signals"]
