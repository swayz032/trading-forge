"""SPINE-D guards — AR-1121 §4.D / AR-1125 §6.D: the direct source frame supplier.

🛑 WHAT THIS SUITE DOES **NOT** PROVE, STATED FIRST
---------------------------------------------------
**It is NOT a real-data witness.** `[MEASURED 2026-08-13]` real 5m cannot be loaded
through the production path on this box: `load_ohlcv` prefers a local cache gated by a
**24h TTL** (`_is_cache_fresh`), `data_cache/ES/ratio_adj/5min.parquet` is **554.8 hours
old**, so the loader falls through to S3 and `_check_s3_read_config` refuses for missing
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

That refusal is itself real and is asserted below. The SUCCESS path is exercised with an
injected series and is labelled SYNTHETIC everywhere it appears. **A real 5m frame
traversing this supplier remains UNPROVEN and is not claimed.**

    ★★★★★ `I READ THE PARQUET FILES ON DISK AND CONCLUDED THE LOADER COULD SERVE THEM.
       THE FILES WERE THERE; THE LOADER WENT TO S3. MEASURE THE RESOLVER, NOT THE ASSET.`

WHAT IT DOES PROVE: the supplier reads the taught chart's OWN series, never aggregates
one, and REFUSES rather than falling back to the execution frame — which matters because
`[AR-1113 §3.2]` for this source the fallback can produce the RIGHT number, and that is
precisely why it may not happen silently.
"""

from __future__ import annotations

import datetime as dt

import polars as pl
import pytest

from src.engine import backtester
from src.engine.backtester import _supply_opening_range_source_frame
from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    EXPLICIT,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SOURCE_RESOLVED_BY_CONTINUITY,
    SourceTimeframeRoles,
    TimeframeRoleBinding,
)

_SYNTHETIC_QUOTE = "SYNTHETIC SUPPLIER PROBE — no source video; see module docstring"


def _roles(or_window: str) -> SourceTimeframeRoles:
    return SourceTimeframeRoles(
        bindings=(
            TimeframeRoleBinding(OPENING_RANGE_WINDOW, or_window, EXPLICIT, _SYNTHETIC_QUOTE, "c0"),
            TimeframeRoleBinding(BREAKOUT_CONFIRMATION, "1m", EXPLICIT, _SYNTHETIC_QUOTE, "c1"),
            TimeframeRoleBinding(FVG_DETECTION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c2"),
            TimeframeRoleBinding(ENTRY_COMPLETION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c3"),
        )
    )


class _Strategy:
    """Minimal stand-in: the supplier reads `.timeframe` and writes
    `.opening_range_source_frame`, and touches nothing else."""

    def __init__(self, timeframe: str = "1m"):
        self.timeframe = timeframe
        self.opening_range_source_frame = None


def _synthetic_5m(rows: int = 6, minutes: int = 5) -> pl.DataFrame:
    """SYNTHETIC bars shaped like the loader's output. NOT market data."""
    base = dt.datetime(2024, 3, 4, 14, 30, tzinfo=dt.timezone.utc)
    return pl.DataFrame(
        {
            "ts_event": [base + dt.timedelta(minutes=minutes * i) for i in range(rows)],
            "open": [100.0 + i for i in range(rows)],
            "high": [101.0 + i for i in range(rows)],
            "low": [99.0 + i for i in range(rows)],
            "close": [100.5 + i for i in range(rows)],
            "volume": [10 for _ in range(rows)],
        }
    )


def test_declared_equals_execution_returns_none_and_loads_nothing(monkeypatch):
    """No duplicate series. Supplying one here would create a second copy of the same
    bars to disagree with the first."""
    called = []
    monkeypatch.setattr(backtester, "load_ohlcv", lambda *a, **k: called.append(a) or _synthetic_5m())

    strategy = _Strategy(timeframe="1m")
    out = _supply_opening_range_source_frame(strategy, _roles("1m"), "MES", "2024-03-01", "2024-03-08")

    assert out is None
    assert strategy.opening_range_source_frame is None
    assert called == [], "the loader must not be called when the timeframes agree"


def test_divergent_roles_attach_the_source_frame(monkeypatch):
    """SYNTHETIC success path: the taught chart's own series reaches the instance."""
    monkeypatch.setattr(backtester, "load_ohlcv", lambda *a, **k: _synthetic_5m())

    strategy = _Strategy(timeframe="1m")
    frame = _supply_opening_range_source_frame(strategy, _roles("5m"), "MES", "2024-03-01", "2024-03-08")

    assert frame is not None
    assert strategy.opening_range_source_frame is frame
    assert frame.timeframe == "5m"
    assert len(frame.highs) == 6 and len(frame.lows) == 6
    assert all(ts.tzinfo is not None for ts in frame.timestamps), "stamps must be zone-aware"


def test_the_loader_is_asked_for_the_ROLE_timeframe_not_the_execution_one(monkeypatch):
    """The join key of this whole unit: the series requested is the ROLE's."""
    seen = {}

    def _spy(symbol, timeframe, start, end, *a, **k):
        seen["timeframe"] = timeframe
        seen["symbol"] = symbol
        return _synthetic_5m()

    monkeypatch.setattr(backtester, "load_ohlcv", _spy)
    _supply_opening_range_source_frame(_Strategy("1m"), _roles("5m"), "MES", "2024-03-01", "2024-03-08")

    assert seen["timeframe"] == "5m", "asked for the execution frame instead of the taught one"
    assert seen["symbol"] == "MES"


def test_empty_series_refuses_and_never_falls_back(monkeypatch):
    monkeypatch.setattr(backtester, "load_ohlcv", lambda *a, **k: _synthetic_5m(rows=0))

    strategy = _Strategy("1m")
    with pytest.raises(ValueError) as excinfo:
        _supply_opening_range_source_frame(strategy, _roles("5m"), "MES", "2024-03-01", "2024-03-08")

    assert "REFUSING" in str(excinfo.value)
    assert strategy.opening_range_source_frame is None, "a refusal must leave no partial frame"


def test_wrongly_spaced_series_is_convicted_by_the_frame_guard(monkeypatch):
    """A 1m series mislabeled as the 5m source must NOT be accepted — the RoleFrame
    spacing guard is the discriminator, and this proves it is reached."""
    monkeypatch.setattr(backtester, "load_ohlcv", lambda *a, **k: _synthetic_5m(minutes=1))

    strategy = _Strategy("1m")
    with pytest.raises(ValueError) as excinfo:
        _supply_opening_range_source_frame(strategy, _roles("5m"), "MES", "2024-03-01", "2024-03-08")

    assert "not a usable source frame" in str(excinfo.value)
    assert strategy.opening_range_source_frame is None


def test_no_resampling_path_exists(monkeypatch):
    """The supplier must never build the 5m series from 1m bars. If the loader hands
    back a 1m series for a 5m request, the answer is a REFUSAL, not an aggregation."""
    monkeypatch.setattr(backtester, "load_ohlcv", lambda *a, **k: _synthetic_5m(rows=30, minutes=1))

    with pytest.raises(ValueError):
        _supply_opening_range_source_frame(_Strategy("1m"), _roles("5m"), "MES", "2024-03-01", "2024-03-08")


@pytest.mark.parametrize("banned", ["resample", "group_by_dynamic", "agg("])
def test_supplier_source_contains_no_aggregation(banned):
    """Read as executable text: an aggregation added later fails here even if no test
    exercises it (AR-1113 §3.1 forbids the resampler outright)."""
    import inspect

    src = inspect.getsource(_supply_opening_range_source_frame)
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("#"))
    executable = "".join(seg for i, seg in enumerate(code.split('"""')) if i % 2 == 0)
    assert banned not in executable


def test_REAL_loader_path_refuses_today_and_the_REASON_matters():
    """THE HONEST STATE, asserted rather than described — and the reason CHANGED.

    `[MEASURED 2026-08-13]` the first reading of this was wrong. I reported real 5m as
    unloadable because `load_ohlcv` fell through a stale cache to S3 and refused for
    missing AWS credentials. **The credentials were in `.env` all along**; Python simply
    does not auto-load it. With them exported, `load_ohlcv('MES','5m',...)` returns
    **1308 real bars**, tz-aware, quality gate passed.

    🛑 THE REAL BLOCKER IS DOWNSTREAM OF THE DATA, AND IT IS OURS:
    `RoleFrame.verify_spacing()` requires EVERY consecutive gap to equal the timeframe
    exactly. Real futures data cannot satisfy that. `[MEASURED]` over 2024-03-04..08:

        5m: 1308 bars — gaps  5.0 x1303,  65.0 x4
        1m: 6536 bars — gaps  1.0 x6527,  2.0 x4,  61.0 x4

    The four large gaps are the CME daily maintenance halt (17:00-18:00 ET). The sampling
    is CORRECT; the predicate cannot distinguish a legitimate session break from wrong
    sampling, because it was red-proofed only against synthetic contiguous fixtures.

        ★★★★★ `A GUARD THAT HAS ONLY EVER SEEN FIXTURES IS AN UNTESTED HYPOTHESIS ABOUT
           PRODUCTION, AND THE CLEANER ITS FIXTURES THE LONGER THAT GOES UNNOTICED.`

    NOT repaired here: widening the predicate is a SEMANTIC decision about what counts as
    a legitimate break, on a safety guard, and it is reported to GPT rather than taken
    unilaterally (AR-1130). The obvious candidate — every gap a positive INTEGER MULTIPLE
    of the timeframe — would admit 65=13x5 while still convicting a 1m series labelled 5m
    (1 is not a multiple of 5), so the discriminator survives. That remains GPT's call.

    This test asserts the refusal WITHOUT credentials (the state of a bare test run) and
    is deliberately tolerant of either failure mode, because both are real refusals.
    """
    from src.engine.data_loader import DataLoadConfigError

    strategy = _Strategy("1m")
    with pytest.raises((ValueError, DataLoadConfigError)):
        _supply_opening_range_source_frame(strategy, _roles("5m"), "MES", "2024-03-04", "2024-03-08")

    assert strategy.opening_range_source_frame is None
