"""AR-1082 §5.4/§5.5 — THE LOAD-BEARING GREEN: one auditable trade through the real route.

Authority: AR-1082 (gpt-rulings `3645650f`) §5 items 4 and 5; AR-1079 §10.

WHY THIS FILE EXISTS AND `test_source_vertical_join.py` IS NOT ENOUGH
---------------------------------------------------------------------
AR-1079 §10: "A test that directly constructs the final source map or final trade object is
not the load-bearing GREEN. At least one proof must drive the real Band C persisted
configuration and let production code produce every object above."

So nothing here is constructed. The persisted config carries a `compiled_spec` and a real
execution-candidate receipt; `bt.main.callback` runs the actual Band C dispatch; and every
value asserted below is READ OFF THE RETURNED TRADE RECORD — not off a spy, not off a
strategy attribute, not off an intermediate the test placed there itself.

    `A SPY MEASURES THAT CODE RAN. THE RETURNED TRADE MEASURES WHAT IT DECIDED.`

THE ONLY THING PATCHED IS THE MARKET
------------------------------------
`load_ohlcv` is patched on BOTH `src.engine.backtester` and `src.engine.data_loader`.
⚠️ BOTH IS LOAD-BEARING: `backtester.py:54` binds `load_ohlcv` at MODULE level, so the class
path resolves the backtester's own global. The nearest prior art patches only
`data_loader` — correct for walk-forward, WRONG here, and a run that silently loaded nothing
would look like a clean refusal (AR-1076).

WHAT THIS PROVES, AND THE TWO THINGS IT DOES NOT
-------------------------------------------------
  ✅ the taught entry bar, entry price, direction, exact stop, exact 2R target and the whole-
     position exit, all off the returned trade;
  🛑 NOT a performance or edge result. Three sessions is not a sample and the engine's own
     performance gate correctly REJECTS it ("only 3 OOS trading days"). AR-1082 §7: no
     source-faithful performance backtest is authorized;
  🛑 NOT a claim about multi-signal behaviour — see `test_only_one_of_three_signals_becomes
     _a_trade_and_that_is_DISCLOSED`, which pins a real limitation rather than hiding it.
"""

from __future__ import annotations

import io
import json
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import polars as pl
import pytest

import src.engine.backtester as bt
import src.engine.data_loader as dl
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_candidate_receipt import ExecutionCandidateReceipt
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)
from src.engine.tests.test_source_vertical_join import (
    _SESSION,
    ENTRY_PRICE,
    OR_CONDITION_ID,
    RISK_POINTS,
    TARGET_2R,
    TAUGHT_STOP,
    _compiled_spec,
)

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")
SPEC_HASH = "svkm-vertical-fixture"
DECISION_TS = datetime(2024, 1, 2, 10, 10, tzinfo=ET).astimezone(UTC)


@pytest.fixture(autouse=True)
def _production_flag_state(monkeypatch):
    """The whole point of AR-1082 §3: this runs at the SHIPPED default. If the FVG-identity
    bypass regressed, the taught gap would never be detected and this file would go red."""
    monkeypatch.delenv("TF_FVG_IDENTITY_ENABLED", raising=False)
    monkeypatch.setenv("TF_ALLOW_FIXED_1", "true")


def _candidate() -> OpeningRangeExecutionCandidate:
    variant = OpeningRangeVariant(
        variant_label="15m", duration_minutes=15, source_quote="the first 15 minute range",
    )
    definition = OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=(variant,),
        market_scope="US equities / S&P 500 example, regular-session opening",
        trading_day_rule="relative for every single trading day",
        provenance=OpeningRangeProvenance(
            source_quote="the first 15 minute range", condition_id=OR_CONDITION_ID,
        ),
    )
    return OpeningRangeExecutionCandidate(
        source_spec_id="svkm-source-vertical__s0",
        source_condition_id=OR_CONDITION_ID,
        definition=definition,
        variant=variant,
    )


def _bars(sessions: int = 3) -> pl.DataFrame:
    rows = []
    for s in range(sessions):
        start = datetime(2024, 1, 2 + s, 9, 30, tzinfo=ET)
        for i, (o, h, low_, c) in enumerate(_SESSION):
            rows.append({
                "ts_event": (start + timedelta(minutes=5 * i)).astimezone(UTC),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })
    return pl.DataFrame(rows)


DECISION_BAR_LOCAL = 8


def _bars_from(rows) -> pl.DataFrame:
    """One 3-session frame built from an explicit bar table."""
    out = []
    for s in range(3):
        start = datetime(2024, 1, 2 + s, 9, 30, tzinfo=ET)
        for i, (o, h, low_, c) in enumerate(rows):
            out.append({
                "ts_event": (start + timedelta(minutes=5 * i)).astimezone(UTC),
                "open": o, "high": h, "low": low_, "close": c, "volume": 100,
            })
    return pl.DataFrame(out)


def _mutate_bar(bar: int, *, o=None, h=None, low=None, c=None):
    rows = [list(r) for r in _SESSION]
    for pos, val in ((0, o), (1, h), (2, low), (3, c)):
        if val is not None:
            rows[bar][pos] = val
    return [tuple(r) for r in rows]


def _config(compiled_spec: dict | None = None) -> dict:
    """A PERSISTED Band C configuration — including the real execution-candidate receipt.

    The four `execution_candidate_*` keys are `backtester._CANDIDATE_KEYS`, and
    `resolve_candidate_authority` proves them through the SAME three anchors production
    uses. A test that skipped them would be driving a route production does not have.
    """
    cand = _candidate()
    return {
        "symbol": "MES",
        "timeframe": "5m",
        "start_date": "2024-01-02",
        "end_date": "2024-01-05",
        "strategy": {
            "name": "svkm-source-vertical", "symbol": "MES", "timeframe": "5m",
            "fixed_contracts": 1,
        },
        "compiled_spec": compiled_spec if compiled_spec is not None else _compiled_spec(),
        "execution_candidate_id": cand.candidate_id,
        "execution_candidate_cache_identity": cand.cache_identity,
        "execution_candidate_receipt": ExecutionCandidateReceipt(
            parent_spec_hash=SPEC_HASH,
            candidate_id=cand.candidate_id,
            cache_identity=cand.cache_identity,
            payload=cand.canonical_payload(),
        ).to_payload(),
        "execution_candidate_parent_spec_hash": SPEC_HASH,
    }


def _run(config: dict | None = None, bars: pl.DataFrame | None = None) -> tuple[dict, str]:
    df = bars if bars is not None else _bars()

    def _fake_load(*_a, **_k):
        return df

    # ⚠️ BOTH STREAMS, AND THAT WAS A REAL MISS. `main()` prints its RESULT ENVELOPE to
    # stdout and its PIPELINE DIAGNOSTICS to stderr. My first version captured stdout only
    # and then asserted against pipeline lines that had never been in it — two red tests
    # accusing production code of a change it had not made. `THE STREAM YOU CAPTURED IS PART
    # OF THE CLAIM YOU ARE MAKING.`
    out_buf, err_buf = io.StringIO(), io.StringIO()
    with patch.object(bt, "load_ohlcv", _fake_load), patch.object(dl, "load_ohlcv", _fake_load):
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            bt.main.callback(
                json.dumps(config if config is not None else _config()),
                None, "single", None, False, "static_styleC",
            )
    out = out_buf.getvalue()
    return json.loads(out.strip().splitlines()[-1]), out + err_buf.getvalue()


def _run_mode(config: dict, mode: str):
    """Same dispatch, arbitrary `mode` — the walkforward arm needs this and `_run` hardcodes
    "single". Kept separate so the vertical proof's invocation stays byte-identical."""
    df = _bars()

    def _fake_load(*_a, **_k):
        return df

    out_buf, err_buf = io.StringIO(), io.StringIO()
    with patch.object(bt, "load_ohlcv", _fake_load), patch.object(dl, "load_ohlcv", _fake_load):
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            bt.main.callback(json.dumps(config), None, mode, None, False, "static_styleC")
    return out_buf.getvalue() + err_buf.getvalue()


class TestTheVerticalTrade:
    """AR-1082 §5.5 — "Prove the load-bearing values from the returned trade/result, not
    spies alone." Every assertion below reads the returned record."""

    @pytest.fixture(autouse=True)
    def _result(self, _production_flag_state):
        self.result, self.stdout = _run()
        trades = self.result.get("trades") or []
        assert len(trades) == 1, (
            f"expected exactly one auditable trade, got {len(trades)}; "
            f"error={self.result.get('error')!r}"
        )
        self.trade = trades[0]

    def test_the_route_ran_as_SOURCE_FAITHFUL(self):
        """Read BY KEY off the parsed result, never by the grep that selected it."""
        assert self.result["source_risk_mode"] == "SOURCE_FAITHFUL"
        assert self.result["total_trades"] == 1

    def test_1_entry_is_the_taught_THIRD_FVG_CANDLE_at_its_CLOSE(self):
        """AR-1079 §7: "entry bar = that same third candle; entry price = that candle's
        CLOSE." The timestamp is asserted too, because a bar INDEX alone would still be
        satisfied if the frame had shifted underneath it."""
        assert self.trade["entry_idx"] == 8
        assert datetime.fromisoformat(self.trade["entry_timestamp"]) == DECISION_TS
        assert self.trade["Avg Entry Price"] == ENTRY_PRICE == 119.0

    def test_2_direction_comes_from_the_OR_BREAKOUT_SIDE(self):
        assert self.trade["Direction"] == "Long"

    def test_3_the_stop_is_the_EXACT_displacement_wick_of_the_same_qualifying_FVG(self):
        assert self.trade["risk_points"] == pytest.approx(RISK_POINTS) == pytest.approx(7.5)
        assert self.trade["stop_basis"] == "source_exact"
        assert ENTRY_PRICE - self.trade["risk_points"] == TAUGHT_STOP == 111.5

    def test_4_the_target_is_WHOLE_POSITION_FIXED_2R_off_that_stop(self):
        assert self.trade["Avg Exit Price"] == TARGET_2R == 134.0
        assert self.trade["exit_reason"] == "source_fixed_r_target"
        assert self.trade["Size"] == 1.0, "a partial fill would mean the position was laddered"
        # The arithmetic, restated from the trade's OWN numbers rather than from the fixture:
        move = self.trade["Avg Exit Price"] - self.trade["Avg Entry Price"]
        assert move == pytest.approx(2.0 * self.trade["risk_points"])

    def test_5_no_house_mutation_reached_the_taught_numbers(self):
        """AR-1082 §5.5: "no ATR / ceiling / floor / Style-C / DLL / daily-cap / rollover /
        +1-bar mutation changes it." Each is checked by its OWN observable consequence, not
        by asserting a flag was off somewhere:

          ATR fallback      -> would set stop_basis='atr_fallback'
          ceiling clamp     -> MES ceiling is below 7.5, so a clamp would shrink risk_points
          6pt MES floor     -> would widen risk_points to >= 6.0 only if it were below it;
                               7.5 is above the floor, so the floor is NOT discriminating
                               here and this test does not claim it — stated, not implied
          Style-C ladder    -> would leave exit_reason in {tp1, tp2, trail, runner}
          +1-bar roll       -> would move entry_idx to 9 and the price off 119.0
        """
        assert self.trade["stop_basis"] != "atr_fallback"
        assert self.trade["risk_points"] == pytest.approx(7.5), "the taught distance survived"
        assert self.trade["exit_reason"] not in {"tp1", "tp2", "trail", "runner", "time_stop"}
        assert self.trade["entry_idx"] == 8, "a +1 roll would have moved this to 9"

    def test_the_engine_still_REFUSES_to_call_this_a_performance_result(self):
        """POSITIVE CONTROL AGAINST OVER-READING THIS FILE. AR-1082 §7 authorizes no
        source-faithful performance backtest, and the engine agrees on its own: three
        sessions cannot clear the OOS-days gate. If this ever went green, someone had
        widened the fixture into a backtest."""
        assert "minimum 60 required" in self.stdout


class TestWhatThisRunDOESNOTProve:
    """🛑 LIMITATIONS AS TESTS, so they cannot quietly stop being true."""

    def test_only_one_of_three_signals_becomes_a_trade_and_that_is_DISCLOSED(self):
        """MEASURED: the strategy emits THREE source entries (one per session, `raw=3 (L:3
        S:0)`) and exactly ONE becomes a trade — the engine's own line says
        `vectorbt drop: 67%`.

        This is pre-existing position-model behaviour, not something the source join
        introduced: `exit_long` is framework-owned and never set by the strategy, so the
        position opened at the first entry is still open when the later entries fire and
        vectorbt ignores them. The retro-fitted exit is applied afterwards by trade
        management.

        ⚠️ IT IS PINNED HERE BECAUSE IT IS A TRAP FOR THE NEXT READER: any future
        source-faithful trade-count or performance claim must account for it, and
        `raw=3 -> trades=1` is invisible unless someone reads the pipeline line.
        `A SIGNAL THAT NEVER BECAME A TRADE IS NOT A REFUSAL, AND IT IS NOT AN ENTRY EITHER.`
        """
        _result, out = _run()
        assert "raw=3 (L:3 S:0)" in out, "the source arm no longer emits one event per session"
        assert "trades=1" in out
        assert "vectorbt drop: 67%" in out

    def test_the_exit_reason_COUNTER_does_not_yet_know_about_source_exits(self):
        """🛑 A DISCLOSURE DEFECT I INTRODUCED, PINNED RATHER THAN LEFT TO BE DISCOVERED.

        The trade record correctly says `exit_reason='source_fixed_r_target'`, but the
        engine's summary line counts it under `signal exits` — that counter's categories
        predate this exit engine and do not include its reasons. So the human-readable
        summary UNDERSTATES source target hits as generic signal exits.

        It affects a printed counter only; no trade, price or metric is wrong. Pinning it
        keeps the discrepancy visible until the counter is taught the new reasons.
        `A COUNTER THAT SILENTLY RECLASSIFIES AN EXIT IS A REPORT THAT DISAGREES WITH ITS
         OWN DATA.`
        """
        result, out = _run()
        assert result["trades"][0]["exit_reason"] == "source_fixed_r_target"
        assert "1 signal exits" in out, (
            "the counter changed — if it now names source exits, delete this test and say so"
        )


class TestTheRouteRefusesWhenTheContractIsBroken:
    """The negative half. Without these, a run that produced a trade for the WRONG reason
    would be indistinguishable from the green above."""

    def test_a_missing_source_target_contract_REFUSES_before_any_trade(self):
        spec = _compiled_spec()
        del spec["spec"]["source_risk"]["target"]
        with pytest.raises(ValueError, match="carries no `spec.source_risk.target`"):
            _run(_config(spec))

    def test_removing_SOURCE_FAITHFUL_changes_the_trade_population(self):
        """AR-1079 §10 discriminator 1 in its observable form: with the mode absent, the
        artifact takes the LEGACY route — and must NOT produce the same trade. Without this
        the whole file could be green on an engine that ignored the mode entirely."""
        legacy_result, _out = _run(_config(_compiled_spec(source_risk=None)))
        legacy_trades = legacy_result.get("trades") or []
        assert legacy_result.get("source_risk_mode") != "SOURCE_FAITHFUL"
        if legacy_trades:
            t = legacy_trades[0]
            assert not (
                t.get("entry_idx") == 8
                and t.get("Avg Entry Price") == ENTRY_PRICE
                and t.get("stop_basis") == "source_exact"
            ), "the legacy arm reproduced the source trade exactly — the mode changed nothing"


class TestTheWalkforwardArmRefuses:
    """GRADE F-1 (HIGH) — found by the independent grader on the unit I had declared green.

    `main()`'s `mode="walkforward"` branch calls `run_walk_forward_class()` WITHOUT
    `source_risk_mode`, and `walk_forward.py` contains zero occurrences of `source_risk`.
    A SOURCE_FAITHFUL artifact therefore took the full legacy execution path — +1 roll,
    house stop map at `entry_idx-1`, ATR fallback, ceiling clamp, Style C, DLL halt, daily
    cap — while the compiler, which reads the mode off the artifact itself, still built
    source events. **No refusal and no red.** The grader measured it two ways: the call
    signature, and running both modes on one config (`single: mode='SOURCE_FAITHFUL'` vs
    `walkforward: mode=None`).

    ★ `THE OFF BRANCH IS WHERE THE DEFECT LIVES — OFF MUST REFUSE, NEVER FALL BACK.`

    🛑 THE REPAIR IS A REFUSAL, NOT AN IMPLEMENTATION. AR-1079 §9: "Walk-forward source-risk
    transport is NOT certified by this ruling. Do not widen B/C/D/F into walk-forward work."
    Threading the mode through would be that widening AND would enable an unproven execution
    path. `AN UNCERTIFIED PATH THAT STILL EXECUTES IS NOT AN OPEN QUESTION, IT IS AN ANSWER
    NOBODY CHECKED.`
    """

    def test_a_SOURCE_FAITHFUL_artifact_REFUSES_walkforward(self):
        with pytest.raises(ValueError, match="NOT certified"):
            _run_mode(_config(), "walkforward")

    def test_the_refusal_names_what_would_have_been_applied(self):
        """A refusal nobody can act on is a crash with better manners."""
        with pytest.raises(ValueError) as exc:
            _run_mode(_config(), "walkforward")
        msg = str(exc.value)
        assert "walk_forward.py does not read it" in msg
        assert "Style C" in msg and "ATR fallback" in msg

    def test_LEGACY_still_reaches_walkforward_and_is_not_collaterally_blocked(self):
        """🛑 THE POSITIVE WITNESS THE TWO REFUSALS ABOVE ARE WORTHLESS WITHOUT. A guard that
        refused EVERY walkforward run would satisfy both of them while breaking every
        existing artifact in the library. A legacy spec must get PAST this guard — it may
        fail later, for some other reason, but never with this message."""
        try:
            _run_mode(_config(_compiled_spec(source_risk=None)), "walkforward")
        except Exception as exc:  # noqa: BLE001 — any later failure is fine; this one is not
            assert "NOT certified" not in str(exc), (
                "the guard blocked a LEGACY walkforward run — it is not scoped to the mode"
            )

    def test_TF_OVERLAY_VARIANT_also_reaches_walkforward(self):
        """The other declared mode is not source-owned and this guard must not catch it."""
        try:
            _run_mode(_config(_compiled_spec(source_risk={"mode": "TF_OVERLAY_VARIANT"})),
                      "walkforward")
        except Exception as exc:  # noqa: BLE001
            assert "NOT certified" not in str(exc)


class TestTheRemainingDiscriminators:
    """AR-1079 §10 items 13 and 16, at the Band C layer.

    🛑 WHY ONLY THESE TWO. Items 11, 14 and 15 ("reintroduce the house buffer/ceiling",
    "reintroduce Style-C partials", "reintroduce the +1 roll") are ABLATION-SHAPED: they ask
    for production code to be mutated, which a committed test cannot do to itself. They are
    covered by the ablation matrix in the commit record (V1, V3) and are honestly NOT
    committed tests. Item 12 needs a frame where the taught anchor is absent, which this
    fixture's geometry cannot produce without also destroying the event that needs it.

    13 and 16 are different: both are driven entirely by the ARTIFACT or the PRICE, so both
    can be real tests. `AN ABLATION IS EVIDENCE; IT IS NOT A GUARD.`
    """

    def test_13_changing_the_taught_r_multiple_moves_the_executable_target_EXACTLY(self):
        """§10 discriminator 13: "Change `r_multiple` 2 -> 3 -> executable target moves from
        exact 2R to exact 3R."

        🛑 THE ARTIFACT IS THE ONLY THING THAT CHANGES. No production code, no env, no engine
        argument — just the persisted `spec.source_risk.target.r_multiple`. That is what makes
        this a proof that the TAUGHT number is consumed rather than a house constant that
        happens to equal 2.

        The 3R fixture needs headroom, so the frame is extended with bars that reach 141.5 and
        create no new gap; the 2R arm is re-run on that SAME frame so the only difference
        between the two arms is the artifact.
        """
        rows = list(_SESSION)
        # Reaches 3R (119.0 + 3 x 7.5 = 141.5) without minting a gap: each added bar's low
        # stays at or below the high two bars back.
        rows = rows[:13] + [(133.5, 142.0, 120.5, 141.0)] + list(rows[13:])
        frame = _bars_from(rows)

        two_r, _ = _run(_config(_compiled_spec()), bars=frame)
        spec3 = _compiled_spec()
        spec3["spec"]["source_risk"]["target"]["r_multiple"] = 3.0
        three_r, _ = _run(_config(spec3), bars=frame)

        t2, t3 = two_r["trades"][0], three_r["trades"][0]
        assert t2["Avg Entry Price"] == t3["Avg Entry Price"] == ENTRY_PRICE, (
            "the entry moved between arms — then the target difference proves nothing"
        )
        assert t2["risk_points"] == t3["risk_points"] == pytest.approx(RISK_POINTS), (
            "the STOP moved with the target — R must be measured off an unchanged stop"
        )
        assert t2["Avg Exit Price"] == pytest.approx(ENTRY_PRICE + 2.0 * RISK_POINTS)
        assert t3["Avg Exit Price"] == pytest.approx(ENTRY_PRICE + 3.0 * RISK_POINTS)
        assert t3["Avg Exit Price"] != t2["Avg Exit Price"], (
            "a hard-coded 2R would satisfy every other assertion in this file"
        )

    def test_16_a_pre_entry_touch_INSIDE_the_decision_candle_cannot_exit_the_trade(self):
        """§10 discriminator 16: "Same-candle pre-entry high/low cannot trigger a retroactive
        source exit." Entering at the third candle's CLOSE does not authorise treating that
        candle's own earlier ticks as if they happened after the entry.

        🛑 MY FIRST FIXTURE WAS GEOMETRICALLY IMPOSSIBLE AND I AM LEAVING THE REASON HERE.
        I simply pushed bar 8's low to 111.0, below the 111.5 stop — and got ZERO trades,
        because a bullish FVG at bar 8 REQUIRES `low[8] > high[6]`, and `high[6]` was 113.0.
        Lowering the decision candle's low destroys the very gap that makes it the decision
        candle. `A MUTATION THAT DESTROYS ITS OWN SUBJECT IS NOT A DISCRIMINATOR.`

        THE CONSTRAINT, SOLVED RATHER THAN GUESSED. For the entry bar's low to sit below the
        stop while the event still exists, all three must hold:

            high[6] < low[8] < low[7]      and      high[6] > ORH

        so the gap survives, the zone stays outside the range, and the decision candle still
        trades through the taught stop. Setting `high[6]=110.5`, `low[8]=111.0`,
        `low[7]=111.5` satisfies all three — and keeps the stop and risk IDENTICAL to the
        canonical fixture (111.5 and 7.5), so the two runs are directly comparable.

        If the exit scan included the entry bar, this trade would stop out at 111.5 for a
        loss. It must reach the 2R target instead.
        """
        rows = [list(r) for r in _SESSION]
        rows[6] = [110.3, 110.5, 109.0, 110.2]   # gap's lower edge, still above ORH=110.0
        rows[7] = [111.6, 119.0, 111.5, 118.5]   # displacement candle -> THE STOP, unchanged
        rows[8] = [118.5, 120.0, 111.0, 119.0]   # decision candle trades BELOW the stop
        result, _out = _run(_config(), bars=_bars_from([tuple(r) for r in rows]))
        trades = result.get("trades") or []
        assert len(trades) == 1, (
            "POSITIVE WITNESS FAILED: the event did not survive the fixture, so nothing about "
            "the entry-bar boundary was measured"
        )
        t = trades[0]
        assert t["risk_points"] == pytest.approx(RISK_POINTS), (
            "the stop moved with bar 8's low — it must come from bar 7, a different candle"
        )
        assert t["entry_idx"] == 8 and t["Avg Entry Price"] == ENTRY_PRICE
        assert t["exit_reason"] == "source_fixed_r_target", (
            f"the trade exited via {t['exit_reason']!r} — a touch inside the decision candle "
            "reached back and closed a position that did not exist until its close"
        )
        assert t["Avg Exit Price"] == TARGET_2R
