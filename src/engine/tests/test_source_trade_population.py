"""F-4 — THE SOURCE TRADE POPULATION. AR-1092 §8's pre-registered proof matrix, P1–P6.

🛑 WHAT F-4 WAS. `[MEASURED]` occupancy is owned by `vbt.Portfolio.from_signals`, and the
source arm never sets `exit_long` (it is framework-owned; no source strategy writes it). So
vectorbt opened on the FIRST source entry, never saw a reason to close, and dropped every later
event — while `_apply_source_fixed_r_management` retrofitted the taught stop/target onto the one
record that survived. The independent grade measured it at scale: **40 events -> 1 trade.**

★ `THE SOURCE ENGINE WAS DOWNSTREAM OF THE DECISION IT NEEDED TO INFLUENCE.`

Every test here drives the REAL persisted Band C single-run route through `bt.main.callback`
(AR-1092 §8 P8) and reads the RETURNED TRADE RECORDS — never a spy, never a hand-built trade
list. The fixture helpers are imported from the vertical proof so both files describe the same
strategy, the same candidate receipt and the same shipped flag state.
"""

import io
import json
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
from unittest.mock import patch

import polars as pl
import pytest

import src.engine.backtester as bt
import src.engine.data_loader as dl
from src.engine.tests.test_source_band_c_vertical import (
    ET,
    UTC,
    _config,
    _production_flag_state,  # noqa: F401 — autouse fixture, imported for its side effect
)
from src.engine.tests.test_source_vertical_join import (
    _SESSION,
    ENTRY_PRICE,
    RISK_POINTS,
    TARGET_2R,
    _compiled_spec,
)

DECISION_BAR_LOCAL = 8
BARS_PER_SESSION = len(_SESSION)


def _bars_sessions(session_tables) -> pl.DataFrame:
    """A frame built from an EXPLICIT PER-SESSION bar table.

    The vertical file's `_bars_from` repeats ONE table across all three sessions, which cannot
    express "session 2 differs from sessions 1 and 3" — and that difference is exactly what
    P3 needs. `A FIXTURE THAT CANNOT VARY ONE MEMBER CANNOT WITNESS PER-MEMBER IDENTITY.`
    """
    out = []
    for s, rows in enumerate(session_tables):
        start = datetime(2024, 1, 2 + s, 9, 30, tzinfo=ET)
        for i, (o, h, low_, c) in enumerate(rows):
            out.append({
                "ts_event": (start + timedelta(minutes=5 * i)).astimezone(UTC),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })
    return pl.DataFrame(out)


def _run_bars(df: pl.DataFrame, config: dict | None = None) -> tuple[dict, str]:
    """The real Band C route. Both streams captured — `main()` prints the result envelope to
    stdout and the pipeline/occupancy diagnostics to stderr."""
    def _fake_load(*_a, **_k):
        return df

    out_buf, err_buf = io.StringIO(), io.StringIO()
    with patch.object(bt, "load_ohlcv", _fake_load), patch.object(dl, "load_ohlcv", _fake_load):
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            bt.main.callback(
                json.dumps(config if config is not None else _config()),
                None, "single", None, False, "static_styleC",
            )
    out = out_buf.getvalue()
    return json.loads(out.strip().splitlines()[-1]), out + err_buf.getvalue()


def _normal() -> list:
    return [tuple(r) for r in _SESSION]


def _second_event_while_open() -> list:
    """A session that emits a SECOND source event while the first trade is still open.

    🛑 THIS FIXTURE IS NOT WHAT I FIRST WROTE, AND THE CORRECTION IS THE INTERESTING PART.
    I built it to make the first trade reach NEITHER level ("never resolves") by flattening
    every bar after the decision candle into a band between the stop and the target. Measured,
    it did something better and different: the flat band is itself a displacement-and-gap
    shape, so the session emits a FOURTH source event (`raw=4`, not `raw=3`), and the first
    trade does resolve — it carries into the next session and hits its taught stop there,
    because the source contract has no time stop and no 15:55 flatten.

    ★ `A FIXTURE IS WHAT IT MEASURES, NOT WHAT I NAMED IT.` The renamed fixture is the
    STRONGER P2 witness: AR-1092 §8 P2 asks for "a second valid source event while the first
    source trade remains open", and this produces exactly that WITHIN one session, rather than
    the cross-session approximation I originally intended.
    """
    rows = [list(r) for r in _SESSION]
    for b in range(DECISION_BAR_LOCAL + 1, len(rows)):
        rows[b] = [120.0, 121.0, 119.5, 120.0]
    return [tuple(r) for r in rows]


def _tighter_stop() -> list:
    """Session with a DIFFERENT displacement wick -> different taught risk and target.

    Bar 7 is the displacement candle and its LOW is the taught stop. Raising it 111.5 -> 112.0
    moves risk 7.5 -> 7.0 and the 2R target 134.0 -> 133.0. The FVG itself is untouched: the
    gap is between bar 6's high and bar 8's low, so bar 7's low cannot destroy it — the trap
    that invalidated discriminator 16's first fixture.
    """
    rows = [list(r) for r in _SESSION]
    rows[7] = [112.5, 119.0, 112.0, 118.5]
    return [tuple(r) for r in rows]


class TestP1SeparatedEventsReproduceThePopulation:
    """AR-1092 §8 P1 — N separated source events -> N executed source trades, N >= 3."""

    def test_three_separated_source_events_become_three_trades(self):
        result, out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        trades = result.get("trades") or []
        assert len(trades) == 3, (
            f"expected 3 source trades, got {len(trades)}; error={result.get('error')!r}"
        )
        assert result["total_trades"] == 3
        assert "raw=3 (L:3 S:0)" in out, "the event population itself changed"

    def test_each_trade_sits_in_its_own_session_and_closes_before_the_next(self):
        """The 'separated' precondition is ASSERTED, not assumed — if the trades overlapped,
        P1 would be measuring something else entirely."""
        result, _out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        trades = result["trades"]
        spans = [(int(t["entry_idx"]), int(t["Exit Idx"])) for t in trades]
        assert spans == sorted(spans), "trades are not in chronological order"
        for (e, x) in spans:
            assert e < x, "a trade exited at or before its own entry bar"
        for i in range(len(spans) - 1):
            assert spans[i][1] < spans[i + 1][0], (
                f"trade {i} exits at {spans[i][1]} but trade {i+1} enters at {spans[i+1][0]} — "
                "these events are NOT separated, so this fixture cannot witness P1"
            )
        assert [e // BARS_PER_SESSION for (e, _x) in spans] == [0, 1, 2], (
            "the three trades are not one per session"
        )


class TestP2OverlappingEventPolicy:
    """AR-1092 §8 P2 — a second valid source event while the first trade is OPEN follows one
    explicit, stable, DISCLOSED policy. Not accidental suppression by vectorbt internals."""

    def test_an_event_arriving_while_a_source_trade_is_open_is_REJECTED_and_COUNTED(self):
        result, out = _run_bars(
            _bars_sessions([_second_event_while_open(), _normal(), _normal()])
        )
        trades = result.get("trades") or []
        assert "raw=4 (L:4 S:0)" in out, (
            "POSITIVE WITNESS FAILED: the fixture did not emit a FOURTH source event, so there "
            "was no overlapping event and nothing about the policy was measured"
        )
        assert "overlap_suppressed=1" in out, "the overlapping event was not counted"
        assert "policy=reject_while_occupied" in out, "the policy is not disclosed"
        assert len(trades) == 3, (
            f"4 events with 1 rejected must leave 3 trades, got {len(trades)}"
        )

    def test_the_rejected_event_lies_INSIDE_the_open_trades_interval(self):
        """🛑 THE CLAIM THAT MATTERS. A count proves an event vanished; only the BAR proves it
        vanished BECAUSE A TRADE WAS OPEN. Without this, the same green would be produced by a
        pass that dropped an arbitrary event for an unrelated reason."""
        result, out = _run_bars(
            _bars_sessions([_second_event_while_open(), _normal(), _normal()])
        )
        line = next(ln for ln in out.splitlines() if "[Source occupancy]" in ln)
        bars_txt = line.split("suppressed_bars=")[1].split(" policy=")[0]
        suppressed = json.loads(bars_txt)
        assert len(suppressed) == 1, f"expected exactly one rejected event, got {suppressed}"

        first = result["trades"][0]
        entry, exit_ = int(first["entry_idx"]), int(first["Exit Idx"])
        assert entry < suppressed[0] <= exit_, (
            f"the rejected event at bar {suppressed[0]} is NOT inside the first trade's open "
            f"interval ({entry}, {exit_}] — so occupancy is not the reason it was rejected"
        )

    def test_the_surviving_trade_is_the_FIRST_event_not_an_arbitrary_one(self):
        """A policy that kept the LAST event would produce the same count. The count alone
        does not identify the policy."""
        result, _out = _run_bars(
            _bars_sessions([_second_event_while_open(), _normal(), _normal()])
        )
        t = result["trades"][0]
        assert int(t["entry_idx"]) == DECISION_BAR_LOCAL, (
            "the surviving trade is not the first session's event"
        )


class TestP3PerTradeSourceIdentity:
    """AR-1092 §8 P3 — 'Changing trade 2's wick must move trade 2's stop and target without
    moving trade 1 or trade 3.'"""

    @pytest.fixture()
    def _varied(self):
        return _run_bars(_bars_sessions([_normal(), _tighter_stop(), _normal()]))[0]

    def test_all_three_still_execute(self, _varied):
        assert len(_varied.get("trades") or []) == 3, (
            f"the varied session broke the population; error={_varied.get('error')!r}"
        )

    def test_only_the_MUTATED_session_moves(self, _varied):
        t1, t2, t3 = _varied["trades"]

        # Trade 2 carries ITS OWN taught risk and target.
        assert t2["risk_points"] == pytest.approx(7.0), (
            "trade 2 did not pick up the displacement wick of its own session"
        )
        assert t2["Avg Exit Price"] == pytest.approx(133.0), (
            "trade 2's fixed-R target was not recomputed off its own stop"
        )

        # Trades 1 and 3 are untouched — this is the half that makes it a discriminator
        # rather than a global change.
        for label, t in (("1", t1), ("3", t3)):
            assert t["risk_points"] == pytest.approx(RISK_POINTS), (
                f"trade {label}'s risk moved when only session 2 was mutated"
            )
            assert t["Avg Exit Price"] == TARGET_2R, (
                f"trade {label}'s target moved when only session 2 was mutated"
            )

    def test_every_trade_keeps_the_taught_entry_and_source_owned_exit_reason(self, _varied):
        for t in _varied["trades"]:
            assert t["Avg Entry Price"] == ENTRY_PRICE, "entry is not the decision candle close"
            assert t["stop_basis"] == "source_exact", "a house stop reached a source trade"
            assert t["exit_reason"] == "source_fixed_r_target"
            assert t["Size"] == t["Size"]  # present
            assert t["Avg Exit Price"] == pytest.approx(
                t["Avg Entry Price"] + 2 * t["risk_points"]
            ), "the exit is not exactly 2R off THIS trade's own stop"


class TestP4NoEventDuplication:
    """AR-1092 §8 P4 — no entry event becomes two trades; no trade exists without an event."""

    def test_entry_bars_are_unique_and_match_the_event_count(self):
        result, out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        trades = result["trades"]
        entry_bars = [int(t["entry_idx"]) for t in trades]
        assert len(set(entry_bars)) == len(entry_bars), (
            f"an entry event produced more than one trade: {entry_bars}"
        )
        assert "events=3" in out and "trades_opened=3" in out
        assert len(trades) == 3, "trade count and opened count disagree"

    def test_the_trade_count_never_exceeds_the_raw_event_count(self):
        """The repair may only let PREVIOUSLY SUPPRESSED events execute. It may never
        manufacture an entry the strategy did not emit.

        The bound is read from the engine's OWN `raw=` diagnostic on each fixture rather than
        hard-coded, so a fixture that changes its event count (as `_second_event_while_open`
        did) cannot silently make this test vacuous."""
        import re
        for tables in (
            [_normal(), _normal(), _normal()],
            [_second_event_while_open(), _normal(), _normal()],
            [_normal(), _tighter_stop(), _normal()],
        ):
            result, out = _run_bars(_bars_sessions(tables))
            raw = int(re.search(r"Signal pipeline: raw=(\d+)", out).group(1))
            n_trades = len(result.get("trades") or [])
            assert n_trades <= raw, f"{n_trades} trades from only {raw} source events"


class TestP5TheOldCollapseMutationGoesRed:
    """AR-1092 §8 P5 — 'A controlled mutation that restores the old always-open occupancy shape
    must collapse the N-trade fixture back toward one trade and make the test red.'

    🛑 THIS IS THE RED-PROOF. Without it, P1's green is compatible with a fixture that would
    have produced three trades anyway, and the whole unit would be unfalsifiable.
    """

    def test_disabling_the_occupancy_pass_collapses_the_population_to_one(self, monkeypatch):
        def _old_shape(entry_long, exit_long, entry_short, exit_short, **_kw):
            """The pre-F-4 behaviour: no exit is ever written, so vectorbt stays open."""
            return entry_long, exit_long, entry_short, exit_short, {
                "source_events_long": 0, "source_events_short": 0,
                "source_trades_opened": 0, "source_overlap_suppressed": 0,
                "source_same_bar_conflicts": 0, "source_unresolved_open": 0,
                "source_trade_plan": [], "source_overlap_suppressed_bars": [],
                "overlap_policy": "ABLATED",
            }

        monkeypatch.setattr(bt, "_apply_source_faithful_occupancy", _old_shape)
        result, out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        trades = result.get("trades") or []
        assert len(trades) == 1, (
            f"the ablation did not restore the collapse (got {len(trades)} trades) — so the "
            "green above is NOT attributable to the occupancy pass"
        )
        assert "vectorbt drop: 67%" in out, (
            "the ablated arm does not reproduce the originally measured 67% drop"
        )

    def test_the_UNABLATED_arm_on_the_same_fixture_gives_three(self):
        """The positive half of the ablation. Both arms in one file so nobody has to trust a
        number carried from another run."""
        result, _out = _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        assert len(result["trades"]) == 3


class TestP6LegacyAndOverlayAreNotTouched:
    """AR-1092 §8 P6 — legacy and TF_OVERLAY_VARIANT keep their behaviour.

    ⚠️ HONEST SCOPE, STATED RATHER THAN IMPLIED. AR-1092 §8 P6 asks for DETERMINISTIC EXECUTING
    controls and forbids skip-only evidence. On THIS fixture the legacy arm produces no trades
    (`[MEASURED, AR-1087]` raw=0 on identical price action), so a legacy trade-population
    assertion here would be vacuous. What this class proves instead is the STRUCTURAL claim —
    the new pass is unreachable from both non-source arms — with a positive witness that the
    spy fires at all. The executing legacy/overlay evidence is the committed canonical
    regression population, run separately and reported with this unit.
    """

    def _spy(self, monkeypatch):
        calls = []
        real = bt._apply_source_faithful_occupancy

        def _wrapped(*a, **kw):
            calls.append(1)
            return real(*a, **kw)

        monkeypatch.setattr(bt, "_apply_source_faithful_occupancy", _wrapped)
        return calls

    def test_POSITIVE_WITNESS_the_spy_fires_on_the_source_arm(self, monkeypatch):
        """Without this, every 'not called' assertion below would also pass on a spy that was
        never wired up. `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`"""
        calls = self._spy(monkeypatch)
        _run_bars(_bars_sessions([_normal(), _normal(), _normal()]))
        assert len(calls) == 1, "the spy never fired on the source arm — it proves nothing"

    def test_the_occupancy_pass_is_UNREACHABLE_on_the_legacy_arm(self, monkeypatch):
        calls = self._spy(monkeypatch)
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), _normal()]),
            config=_config(_compiled_spec(source_risk=None)),
        )
        assert result.get("source_risk_mode") != "SOURCE_FAITHFUL"
        assert calls == [], "the source occupancy pass ran on a LEGACY artifact"

    def test_the_occupancy_pass_is_UNREACHABLE_on_TF_OVERLAY_VARIANT(self, monkeypatch):
        calls = self._spy(monkeypatch)
        result, _out = _run_bars(
            _bars_sessions([_normal(), _normal(), _normal()]),
            config=_config(_compiled_spec(source_risk={"mode": "TF_OVERLAY_VARIANT"})),
        )
        assert result.get("source_risk_mode") != "SOURCE_FAITHFUL"
        assert calls == [], "the source occupancy pass ran on a TF_OVERLAY_VARIANT artifact"
