"""Pass 4 Track A — Tests for gateway_mode switch in _build_strategy_webhook_alerts.

Covers:
  - tf_gateway mode: emits TF-gateway payload fields, no direct-TradersPost keys.
  - direct mode: emits unchanged direct-TradersPost payload (backward-compat).
  - None (unset): defaults to direct (backward-compat).
  - invalid gateway_mode: raises ValueError immediately.
  - TF_GATEWAY_PAYLOAD_FIELDS constant: correct canonical field order.
  - compile_dual_artifacts: routes gateway_mode from strategy.config through to artifact.
  - Archetype path: does NOT flow through _build_strategy_webhook_alerts (separate
    alertcondition contract — coordination gap documented below).

Live-order.ts contract alignment:
  The TF-gateway payload fields are validated against live-order.ts
  liveOrderPayloadSchema §Static-token mode.  Field names here MUST match the TS schema.
  Any TS schema change requires a corresponding update to TF_GATEWAY_PAYLOAD_FIELDS
  and these tests.

Archetype coordination note (Pass 4 Track A):
  Archetype strategies (entry_indicator='archetype:<key>') emit alert payloads
  via _build_archetype_alert_pine(), NOT via _build_strategy_webhook_alerts().
  The archetype alertcondition() carries {strategyId, archetype, bar_timestamp, action}
  which is a DIFFERENT contract from both TradersPost-direct and TF-gateway.
  Pass 4 Track B (pine-export-service.ts) must handle gateway_mode wiring for
  the archetype compile path separately — the Python compiler does not own that branch.
  See: src/engine/pine_compiler.py::_build_archetype_alert_pine docstring.
"""
import pytest

from src.engine.pine_compiler import (
    TF_GATEWAY_PAYLOAD_FIELDS,
    _build_strategy_webhook_alerts,
    compile_dual_artifacts,
)

# ─── Minimal strategy fixtures ─────────────────────────────────────────────────

def _make_strategy(
    gateway_mode: str | None = None,
    name: str = "Test SMA Cross",
    symbol: str = "MES",
    entry_indicator: str = "sma_crossover",
    take_profit_atr_multiple: float | None = 2.0,
    **extra_config,
) -> dict:
    """Build a minimal StrategyDSL dict for compiler tests."""
    config: dict = {}
    if gateway_mode is not None:
        config["gateway_mode"] = gateway_mode
    config.update(extra_config)
    return {
        "name": name,
        "symbol": symbol,
        "entry_indicator": entry_indicator,
        "entry_long": "close > ind_sma_0",
        "entry_short": "close < ind_sma_0",
        "stop_loss_atr_multiple": 1.5,
        "take_profit_atr_multiple": take_profit_atr_multiple,
        "indicators": [{"type": "sma", "period": 20}],
        "config": config,
    }


# ─── TF_GATEWAY_PAYLOAD_FIELDS constant ───────────────────────────────────────


class TestTfGatewayPayloadFields:
    """TF_GATEWAY_PAYLOAD_FIELDS must declare the canonical field order in sync
    with live-order.ts liveOrderPayloadSchema (static-token mode)."""

    def test_is_tuple(self):
        assert isinstance(TF_GATEWAY_PAYLOAD_FIELDS, tuple)

    def test_all_required_fields_present(self):
        """Must contain every field that live-order.ts validates."""
        required = {
            "account_id",
            "strategy_id",
            "live_order_token",
            "timestamp_ms",
            "bar_timestamp",
            "action",
            "ticker",
        }
        assert required == set(TF_GATEWAY_PAYLOAD_FIELDS), (
            "TF_GATEWAY_PAYLOAD_FIELDS is out of sync with live-order.ts "
            f"liveOrderPayloadSchema. Missing: {required - set(TF_GATEWAY_PAYLOAD_FIELDS)}, "
            f"Extra: {set(TF_GATEWAY_PAYLOAD_FIELDS) - required}"
        )

    def test_field_order_canonical(self):
        """Canonical order must match live-order.ts documentation (static-token mode)."""
        expected_order = (
            "account_id",
            "strategy_id",
            "live_order_token",
            "timestamp_ms",
            "bar_timestamp",
            "action",
            "ticker",
        )
        assert TF_GATEWAY_PAYLOAD_FIELDS == expected_order, (
            "TF_GATEWAY_PAYLOAD_FIELDS order changed — update live-order.ts "
            "static-token docs if intentional."
        )

    def test_no_direct_traderspost_keys(self):
        """Direct-TradersPost-specific keys must NOT appear in the TF-gateway field list."""
        direct_only_keys = {"action_buy_sell", "stopLoss", "takeProfit", "quantity", "hmac"}
        overlap = direct_only_keys & set(TF_GATEWAY_PAYLOAD_FIELDS)
        assert not overlap, f"Direct-TradersPost keys found in TF_GATEWAY_PAYLOAD_FIELDS: {overlap}"


# ─── _build_strategy_webhook_alerts unit tests ────────────────────────────────


class TestBuildStrategyWebhookAlertsTfGateway:
    """gateway_mode='tf_gateway' → TF-gateway payload, no direct-TradersPost keys."""

    def _build(self, **kwargs) -> str:
        return _build_strategy_webhook_alerts(
            strategy_name="My Strategy",
            symbol="MES",
            strategy_id="test-uuid-1234",
            gateway_mode="tf_gateway",
            **kwargs,
        )

    def test_contains_all_tf_gateway_field_names(self):
        output = self._build()
        for field in TF_GATEWAY_PAYLOAD_FIELDS:
            assert f'"{field}"' in output, (
                f"TF-gateway field '{field}' missing from generated Pine output."
            )

    def test_contains_strategy_id_value(self):
        output = self._build()
        assert "test-uuid-1234" in output

    def test_contains_tv_symbol(self):
        output = self._build()
        assert "MES1!" in output

    def test_contains_enter_long_action(self):
        output = self._build()
        assert "enter_long" in output

    def test_contains_enter_short_action(self):
        output = self._build()
        assert "enter_short" in output

    def test_contains_exit_long_action(self):
        output = self._build()
        assert "exit_long" in output

    def test_contains_exit_short_action(self):
        output = self._build()
        assert "exit_short" in output

    def test_no_direct_traderspost_buy_action(self):
        """TF-gateway path must NOT emit 'action':'buy' (TradersPost-specific)."""
        output = self._build()
        assert '"action":"buy"' not in output
        assert '"action":"sell"' not in output
        assert '"action":"exit"' not in output
        assert '"action":"cancel"' not in output

    def test_no_direct_traderspost_quantity_field(self):
        """TF-gateway payload does not carry a 'quantity' field (server resolves from strategy)."""
        output = self._build()
        assert '"quantity"' not in output

    def test_no_stop_loss_take_profit_keys(self):
        """TF-gateway payload does not carry stopLoss/takeProfit (server resolves from strategy)."""
        output = self._build()
        assert '"stopLoss"' not in output
        assert '"takeProfit"' not in output

    def test_timenow_placeholder_present_for_timestamp_ms(self):
        """Pine {{timenow}} placeholder must appear (TradingView resolves at fire time)."""
        output = self._build()
        assert "{{timenow}}" in output

    def test_time_placeholder_present_for_bar_timestamp(self):
        """Pine {{time}} placeholder must appear (bar-close dedup key)."""
        output = self._build()
        assert "{{time}}" in output

    def test_input_string_for_account_id(self):
        """account_id must be an operator-supplied input, not embedded static string."""
        output = self._build()
        assert "account_id_input" in output
        assert "input.string" in output

    def test_input_string_for_live_order_token(self):
        """live_order_token must be an operator-supplied input, not embedded static string."""
        output = self._build()
        assert "live_order_token_input" in output

    def test_tfg_alert_title_prefix(self):
        """Alert titles must use 'TFG' prefix (distinguishes from direct-TradersPost 'TP' prefix)."""
        output = self._build()
        assert 'title="TFG Long Entry"' in output
        assert 'title="TFG Short Entry"' in output

    def test_contains_barstate_isconfirmed_on_exit(self):
        """Exit alertconditions must be guarded by barstate.isconfirmed (bar-close parity)."""
        output = self._build()
        assert "barstate.isconfirmed" in output

    def test_contains_time_to_close_alert(self):
        """15:55 ET time-stop alertcondition must be present."""
        output = self._build()
        assert "time_to_close" in output
        assert "TFG Time Stop 15:55 ET" in output

    def test_contains_risk_lockout_alert(self):
        """Risk lockout alertcondition must be present."""
        output = self._build()
        assert "risk_lockout" in output
        assert "TFG Risk Lockout" in output


class TestBuildStrategyWebhookAlertsDirectMode:
    """gateway_mode='direct' → unchanged direct-TradersPost payload (backward-compat)."""

    def _build(self, gateway_mode: str | None = "direct") -> str:
        return _build_strategy_webhook_alerts(
            strategy_name="Legacy Strategy",
            symbol="MNQ",
            strategy_id="legacy-uuid-5678",
            gateway_mode=gateway_mode,
        )

    def test_direct_mode_contains_buy_action(self):
        output = self._build(gateway_mode="direct")
        assert '"action":"buy"' in output

    def test_direct_mode_contains_sell_action(self):
        output = self._build(gateway_mode="direct")
        assert '"action":"sell"' in output

    def test_direct_mode_contains_exit_action(self):
        output = self._build(gateway_mode="direct")
        assert '"action":"exit"' in output

    def test_direct_mode_contains_quantity_field(self):
        output = self._build(gateway_mode="direct")
        assert '"quantity"' in output or "quantity" in output

    def test_direct_mode_no_tf_gateway_fields(self):
        """Direct path must NOT emit TF-gateway-specific fields."""
        output = self._build(gateway_mode="direct")
        assert "enter_long" not in output
        assert "enter_short" not in output
        assert "live_order_token" not in output

    def test_direct_mode_tp_alert_title_prefix(self):
        """Direct path alerts must use 'TP' prefix (legacy TradersPost convention)."""
        output = self._build(gateway_mode="direct")
        assert 'title="TP Long Entry"' in output
        assert 'title="TP Short Entry"' in output

    def test_direct_mode_contains_strategy_id(self):
        output = self._build(gateway_mode="direct")
        assert "legacy-uuid-5678" in output


class TestBuildStrategyWebhookAlertsNoneMode:
    """gateway_mode=None (unset) → same as 'direct' (backward-compat default)."""

    def test_none_defaults_to_direct_payload(self):
        output = _build_strategy_webhook_alerts(
            strategy_name="Unset Strategy",
            symbol="MES",
            strategy_id="none-uuid-9012",
            gateway_mode=None,
        )
        # Should see direct-TradersPost payload fields
        assert '"action":"buy"' in output
        # Should NOT see TF-gateway entry_long
        assert "enter_long" not in output

    def test_none_and_direct_produce_identical_output(self):
        """Omitting gateway_mode must produce identical output to gateway_mode='direct'."""
        base_kwargs = dict(
            strategy_name="Parity Strategy",
            symbol="MES",
            strategy_id="parity-uuid-0000",
        )
        out_none = _build_strategy_webhook_alerts(**base_kwargs, gateway_mode=None)
        out_direct = _build_strategy_webhook_alerts(**base_kwargs, gateway_mode="direct")
        assert out_none == out_direct, (
            "None and 'direct' gateway_mode produced different Pine output — "
            "backward-compat broken."
        )


class TestBuildStrategyWebhookAlertsInvalidMode:
    """Invalid gateway_mode → ValueError (no silent fall-through)."""

    @pytest.mark.parametrize("bad_mode", [
        "traderspost",
        "gateway",
        "tf",
        "TF_GATEWAY",
        "tf-gateway",
        "",
        "   ",
        "None",
        "null",
    ])
    def test_invalid_mode_raises_value_error(self, bad_mode: str):
        with pytest.raises(ValueError, match="Invalid gateway_mode"):
            _build_strategy_webhook_alerts(
                strategy_name="Bad Strategy",
                symbol="MES",
                strategy_id="bad-uuid-0000",
                gateway_mode=bad_mode,
            )

    def test_error_message_includes_valid_modes(self):
        with pytest.raises(ValueError) as exc_info:
            _build_strategy_webhook_alerts(
                strategy_name="Bad Strategy",
                symbol="MES",
                strategy_id="bad-uuid-0000",
                gateway_mode="invalid",
            )
        msg = str(exc_info.value)
        assert "tf_gateway" in msg
        assert "direct" in msg


# ─── compile_dual_artifacts integration tests ─────────────────────────────────


class TestCompileDualArtifactsGatewayMode:
    """compile_dual_artifacts routes strategy.config.gateway_mode through to Pine artifact."""

    def test_tf_gateway_mode_propagates_to_strategy_artifact(self):
        strategy = _make_strategy(gateway_mode="tf_gateway")
        result = compile_dual_artifacts(
            strategy=strategy,
            firm_key="topstep_50k",
            strategy_id="dual-uuid-1111",
        )
        assert result.exportable, f"Strategy should be exportable. Notes: {result.degradation_notes}"
        assert result.strategy_artifact is not None
        pine = result.strategy_artifact.content
        # TF-gateway specific markers
        assert "enter_long" in pine, "TF-gateway enter_long action missing from strategy artifact"
        assert "live_order_token" in pine
        assert '"action":"buy"' not in pine, "Direct-TradersPost buy must NOT appear in tf_gateway artifact"

    def test_direct_mode_propagates_unchanged(self):
        strategy = _make_strategy(gateway_mode="direct")
        result = compile_dual_artifacts(
            strategy=strategy,
            firm_key="topstep_50k",
            strategy_id="dual-uuid-2222",
        )
        assert result.exportable
        assert result.strategy_artifact is not None
        pine = result.strategy_artifact.content
        assert '"action":"buy"' in pine
        assert "enter_long" not in pine

    def test_no_config_defaults_to_direct(self):
        """Strategy with no config key → direct path (backward-compat)."""
        strategy = {
            "name": "No Config Strategy",
            "symbol": "MES",
            "entry_indicator": "sma_crossover",
            "entry_long": "close > ind_sma_0",
            "entry_short": "close < ind_sma_0",
            "stop_loss_atr_multiple": 1.5,
            "take_profit_atr_multiple": 2.0,
            "indicators": [{"type": "sma", "period": 20}],
            # NO 'config' key at all
        }
        result = compile_dual_artifacts(
            strategy=strategy,
            firm_key="topstep_50k",
            strategy_id="dual-uuid-3333",
        )
        assert result.exportable
        assert result.strategy_artifact is not None
        pine = result.strategy_artifact.content
        assert '"action":"buy"' in pine
        assert "enter_long" not in pine

    def test_config_without_gateway_mode_defaults_to_direct(self):
        """Config dict present but no gateway_mode key → direct path."""
        strategy = _make_strategy()  # config={} by default (gateway_mode=None not set)
        result = compile_dual_artifacts(
            strategy=strategy,
            firm_key="topstep_50k",
            strategy_id="dual-uuid-4444",
        )
        assert result.exportable
        assert result.strategy_artifact is not None
        pine = result.strategy_artifact.content
        assert '"action":"buy"' in pine
        assert "enter_long" not in pine

    def test_invalid_gateway_mode_raises_on_compile(self):
        """Invalid gateway_mode must propagate as ValueError from compile_dual_artifacts."""
        strategy = _make_strategy(gateway_mode="invalid_mode")
        with pytest.raises(ValueError, match="Invalid gateway_mode"):
            compile_dual_artifacts(
                strategy=strategy,
                firm_key="topstep_50k",
                strategy_id="dual-uuid-5555",
            )

    def test_indicator_artifact_unaffected_by_gateway_mode(self):
        """gateway_mode='tf_gateway' must NOT alter the INDICATOR artifact alert contract."""
        strategy_gw = _make_strategy(gateway_mode="tf_gateway")
        strategy_di = _make_strategy(gateway_mode="direct")

        result_gw = compile_dual_artifacts(strategy=strategy_gw, firm_key="topstep_50k",
                                           strategy_id="ind-uuid-gw")
        result_di = compile_dual_artifacts(strategy=strategy_di, firm_key="topstep_50k",
                                           strategy_id="ind-uuid-di")

        assert result_gw.indicator_artifact is not None
        assert result_di.indicator_artifact is not None

        ind_gw = result_gw.indicator_artifact.content
        ind_di = result_di.indicator_artifact.content

        # Both indicator artifacts should use the same manual-approval alertcondition contract
        assert "MANUAL_APPROVAL_REQUIRED" in ind_gw
        assert "MANUAL_APPROVAL_REQUIRED" in ind_di
        # Indicator path must NOT contain TradersPost-ATS or TF-gateway action fields
        assert '"action":"buy"' not in ind_gw
        assert "enter_long" not in ind_gw


# ─── Archetype path coordination gap test ─────────────────────────────────────


class TestArchetypeGatewayModeCoordinationGap:
    """
    Archetype strategies do NOT flow through _build_strategy_webhook_alerts.

    _build_archetype_alert_pine produces a standalone Pine script with its own
    alertcondition() that carries {strategyId, archetype, bar_timestamp, action="signal"}.
    This is NEITHER the TradersPost-direct format NOR the TF-gateway format.

    Pass 4 Track B (pine-export-service.ts) must handle gateway_mode wiring
    for the archetype path at the TS service layer.  The Python compiler is
    NOT the coordination point for archetype + gateway_mode.

    This test class documents that gap so it is not re-discovered later.
    """

    def test_archetype_alert_does_not_contain_tf_gateway_fields(self):
        """Archetype alert-only Pine has its own contract — different from TF-gateway."""
        from src.engine.pine_compiler import _build_archetype_alert_pine
        pine = _build_archetype_alert_pine("silver_bullet", "Silver Bullet")
        # Archetype contract: strategyId, archetype, bar_timestamp, action="signal"
        assert "strategyId" in pine
        assert "archetype" in pine
        # Must NOT accidentally contain TF-gateway field names
        assert "live_order_token" not in pine
        assert "enter_long" not in pine
        assert "account_id" not in pine

    def test_archetype_alert_does_not_contain_direct_traderspost_fields(self):
        """Archetype alert-only Pine is ALSO not the TradersPost-direct format."""
        from src.engine.pine_compiler import _build_archetype_alert_pine
        pine = _build_archetype_alert_pine("ict_judas_swing", "Ict Judas Swing")
        assert '"action":"buy"' not in pine
        assert '"action":"sell"' not in pine
        assert '"quantity"' not in pine
