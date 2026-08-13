"""BAND-C-SIZING-INGRESS-1 — AR-1095 §5's six pre-registered proof points.

🛑 THE DEFECT. The persisted artifact carries `strategy.fixed_contracts = 1`.
`run_class_backtest` has always been able to consume it (`fixed_contracts: Optional[int]`).
**Band C never passed it**, so the parameter defaulted to `None` and
`PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)` ran in its place. Three
trades with IDENTICAL taught entry/stop/target came back sized 1, 15, 15.

★ `A DEFAULT THAT RUNS BECAUSE AN INSTRUCTION WAS DROPPED IS INDISTINGUISHABLE, AT THE RESULT,
   FROM A DEFAULT THAT RUNS BECAUSE IT WAS CHOSEN.`

⚠️ AND IT SILENCED ITS OWN GUARD. `config.py`'s H7 validator exists to fail-fast on a silent
`fixed_contracts=1`, but it lives on the `type="fixed"` branch — unreachable while the value is
dropped at the ingress. The fixture even sets `TF_ALLOW_FIXED_1=true` to permit a mode that
never ran. `A GUARD ON THE BRANCH NOT TAKEN IS NOT A GUARD.`

This is the SECOND instance of one class at one call site: `SOURCE_FAITHFUL_EXECUTION_JOIN-1`
(AR-1074 §3) was the same "persisted OK / consumer OK / Band C joins the two MISSING" shape, and
its comment sits directly beside the argument that was missing here.
"""

import copy

import pytest

from src.engine.tests.test_source_band_c_vertical import (
    ENTRY_PRICE,
    RISK_POINTS,
    TARGET_2R,
    _config,
    _production_flag_state,  # noqa: F401 — autouse fixture, imported for its side effect
)
from src.engine.tests.test_source_trade_population import (
    _bars_sessions,
    _normal,
    _run_bars,
)
from src.engine.tests.test_source_vertical_join import _compiled_spec

THREE_SESSIONS = None  # built per-test; polars frames are not shared between runs


def _bars3():
    return _bars_sessions([_normal(), _normal(), _normal()])


def _config_sized(contracts):
    """The persisted config with an explicit fixed size, or with the command REMOVED."""
    cfg = copy.deepcopy(_config())
    if contracts is None:
        cfg["strategy"].pop("fixed_contracts", None)
    else:
        cfg["strategy"]["fixed_contracts"] = contracts
    return cfg


class TestP1ThePersistedSizeReachesTheEngine:
    """AR-1095 §5.1 — persisted `strategy.fixed_contracts=1` reaches the real Band C call."""

    def test_the_engine_reports_the_persisted_value_as_the_REQUESTED_size(self):
        result, _out = _run_bars(_bars3(), config=_config_sized(1))
        sizing = result["sizing"]
        assert sizing["requested_contracts"] == 1
        assert sizing["sizing_owner"] == "FIXED_RESEARCH"
        assert sizing["sizing_mode"] == "fixed"
        assert sizing["sizing_source"] == "persisted_strategy.fixed_contracts"


class TestP2EveryTradeCarriesTheRequestedSize:
    """AR-1095 §5.2 — returned trades are all size 1 on the 3-session source fixture."""

    def test_all_three_trades_are_size_one(self):
        result, _out = _run_bars(_bars3(), config=_config_sized(1))
        trades = result["trades"]
        assert len(trades) == 3
        assert [t["Size"] for t in trades] == [1.0, 1.0, 1.0]
        assert result["sizing"]["executed_contracts"] == [1.0]

    def test_the_population_is_now_SIZE_NORMALISED_so_the_trades_are_comparable(self):
        """The point of AR-1095 §4 Surface 1: identical taught geometry must produce identical
        gross P&L, or an expectancy number is measuring the sizer, not the teacher."""
        result, _out = _run_bars(_bars3(), config=_config_sized(1))
        assert {t["GrossPnL"] for t in result["trades"]} == {75.0}
        assert {t["risk_points"] for t in result["trades"]} == {RISK_POINTS}


class TestP3ChangingTheSizeMovesQUANTITYONLY:
    """AR-1095 §5.3 — 1 -> 2 moves only quantity/P&L, never entry, stop, target, event count
    or exit reason. This is the test that proves sizing and strategy semantics are orthogonal
    axes rather than one knob."""

    @pytest.fixture()
    def _pair(self):
        one, _o1 = _run_bars(_bars3(), config=_config_sized(1))
        two, _o2 = _run_bars(_bars3(), config=_config_sized(2))
        return one, two

    def test_quantity_and_pnl_scale(self, _pair):
        one, two = _pair
        assert [t["Size"] for t in two["trades"]] == [2.0, 2.0, 2.0]
        assert two["sizing"]["requested_contracts"] == 2
        for a, b in zip(one["trades"], two["trades"]):
            assert b["GrossPnL"] == pytest.approx(a["GrossPnL"] * 2), (
                "gross P&L did not scale with contract count"
            )

    def test_the_STRATEGY_semantics_are_byte_identical(self, _pair):
        one, two = _pair
        assert len(one["trades"]) == len(two["trades"]) == 3, "the event count moved with size"
        for a, b in zip(one["trades"], two["trades"]):
            assert a["entry_idx"] == b["entry_idx"]
            assert a["Avg Entry Price"] == b["Avg Entry Price"] == ENTRY_PRICE
            assert a["Exit Idx"] == b["Exit Idx"]
            assert a["Avg Exit Price"] == b["Avg Exit Price"] == TARGET_2R
            assert a["risk_points"] == b["risk_points"] == RISK_POINTS
            assert a["exit_reason"] == b["exit_reason"] == "source_fixed_r_target"
            assert a["stop_basis"] == b["stop_basis"] == "source_exact"

    def test_the_occupancy_population_is_unchanged_by_size(self, _pair):
        one, two = _pair
        for key in ("source_events_long", "source_trades_opened", "source_overlap_suppressed"):
            assert one["source_occupancy"][key] == two["source_occupancy"][key], (
                f"{key} moved when only the contract count changed"
            )


class TestP4RemovingTheCommandNAMESTheFallback:
    """AR-1095 §5.4 — removing the fixed-size command must invoke the EXPLICITLY DOCUMENTED
    fallback, not silently pretend a scaling plan was supplied.

    🛑 THIS IS THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. Before the repair, the
    engine ran this fallback while the artifact was ASKING for fixed sizing, and nothing in the
    result distinguished the two situations. Now `requested_contracts=None` and
    `sizing_source` say plainly that no command was supplied.
    """

    def test_the_fallback_declares_itself_as_a_DEFAULT_not_as_a_plan(self):
        result, _out = _run_bars(_bars3(), config=_config_sized(None))
        sizing = result["sizing"]
        assert sizing["requested_contracts"] is None
        assert sizing["sizing_owner"] == "TRADING_FORGE"
        assert sizing["sizing_mode"] == "dynamic_atr"
        assert sizing["sizing_source"] == "engine_default_no_sizing_command_supplied"
        assert sizing["target_risk_dollars"] == 500.0

    def test_the_fallback_claims_NO_scaling_plan_id(self):
        """`firm_config.SCALING_PLANS` is deliberately EMPTY (R-059 — size-upgrade ladders are
        fiction at Topstep), so no plan id can honestly be claimed. Asserting `None` keeps a
        future seat from inventing one to fill the field."""
        result, _out = _run_bars(_bars3(), config=_config_sized(None))
        assert result["sizing"]["sizing_plan_id"] is None

    def test_POSITIVE_CONTROL_the_fallback_really_does_produce_the_old_RAMP(self):
        """Proves the two arms are genuinely different engines rather than the same numbers
        under two labels — the ramp is exactly what the dropped instruction was hiding."""
        result, _out = _run_bars(_bars3(), config=_config_sized(None))
        assert [t["Size"] for t in result["trades"]] == [1.0, 15.0, 15.0]


class TestP5LegacyAndOverlayDisclosureIsIntentional:
    """AR-1095 §5.5 — legacy/overlay unchanged EXCEPT where the same previously-ignored
    persisted command is intentionally corrected and disclosed.

    ⚠️ HONEST SCOPE, STATED. This ingress serves every Band C artifact, not only the source
    arm, so a LEGACY artifact that persists `fixed_contracts` now gets the size it asked for
    too. That is the deliberate correction AR-1095 §5.5 permits, and it is disclosed here
    rather than buried. The executing evidence that nothing else moved is the committed
    canonical regression population, run at both pins and reported with this unit.
    """

    def test_the_legacy_arm_also_reports_a_sizing_owner(self):
        result, _out = _run_bars(
            _bars3(), config={**_config_sized(1),
                              "compiled_spec": _compiled_spec(source_risk=None)},
        )
        assert result.get("source_risk_mode") != "SOURCE_FAITHFUL"
        assert result["sizing"]["sizing_owner"] == "FIXED_RESEARCH"
        assert result["sizing"]["requested_contracts"] == 1

    def test_TF_OVERLAY_VARIANT_also_reports_a_sizing_owner(self):
        result, _out = _run_bars(
            _bars3(), config={**_config_sized(1),
                              "compiled_spec": _compiled_spec(
                                  source_risk={"mode": "TF_OVERLAY_VARIANT"})},
        )
        assert result.get("source_risk_mode") != "SOURCE_FAITHFUL"
        assert result["sizing"]["sizing_owner"] == "FIXED_RESEARCH"


class TestP6TheResultExposesWhoOwnedTheSize:
    """AR-1095 §5.6 / §3 — the returned result exposes which sizing owner/mode actually ran."""

    def test_the_sizing_contract_is_present_and_complete(self):
        result, _out = _run_bars(_bars3(), config=_config_sized(1))
        sizing = result.get("sizing")
        assert isinstance(sizing, dict) and sizing
        for key in (
            "sizing_owner", "sizing_mode", "sizing_plan_id", "requested_contracts",
            "target_risk_dollars", "sizing_source", "executed_contracts",
        ):
            assert key in sizing, f"{key} missing from the sizing contract"

    def test_executed_contracts_is_read_from_the_TRADES_not_from_the_request(self):
        """The lesson GRADE finding F-2 taught about `trades_opened`: a requested size is an
        instruction, an executed size is an outcome, and only the second one is evidence. If
        these were the same field, a dropped instruction would be invisible again."""
        result, _out = _run_bars(_bars3(), config=_config_sized(2))
        assert result["sizing"]["requested_contracts"] == 2
        assert result["sizing"]["executed_contracts"] == [2.0]
        assert sorted({float(t["Size"]) for t in result["trades"]}) == [2.0]
