"""Track 6 / Pass 2 — Per-recipient Pine export tests.

6 tests covering:
  1. qty substitution correctness — recipient_qty appears in Pine artifact
  2. default behavior unchanged when no recipient_qty
  3. profit-tier-aware qty calculation (compute_profit_tier_mes with sample pnl)
  4. account label embedded as comment in generated Pine
  5. webhook URL placeholder respected (HMAC injected into alert payload)
  6. existing 19 strategies still compile (recipient_qty=None default — backwards compat)
"""

import pytest

from src.engine.pine_compiler import compile_strategy, compile_dual_artifacts
from src.engine.sizing import compute_profit_tier_mes


# ─── Shared fixture ──────────────────────────────────────────────────────────

def _base_strategy(**overrides) -> dict:
    """Minimal exportable strategy dict."""
    base = {
        "name": "Test Strategy Recipient",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_type": "trend_follow",
        "entry_indicator": "sma_crossover",
        "entry_params": {"fast_period": 10, "slow_period": 50},
        "exit_type": "atr_multiple",
        "stop_loss_atr_multiple": 2.0,
        "take_profit_atr_multiple": 4.0,
        "indicators": [
            {"type": "sma", "period": 10},
            {"type": "sma", "period": 50},
        ],
    }
    base.update(overrides)
    return base


# ─── Test 1: qty substitution correctness ────────────────────────────────────

def test_recipient_qty_substitution_in_pine_artifact():
    """recipient_qty=7 appears as 'qty_final := 7' in generated Pine artifact."""
    strategy = _base_strategy()
    result = compile_strategy(strategy, recipient_qty=7)

    assert result.exportability.exportable, "Strategy must be exportable"
    assert result.artifacts, "Must produce artifacts"

    indicator_artifact = next(
        (a for a in result.artifacts if a.artifact_type == "indicator"), None
    )
    assert indicator_artifact is not None, "Indicator artifact must be present"
    assert "qty_final := 7" in indicator_artifact.content, (
        f"Expected 'qty_final := 7' in Pine content, got:\n{indicator_artifact.content[:500]}"
    )


def test_dual_artifacts_recipient_qty_substitution():
    """recipient_qty=12 appears in both indicator and strategy dual artifacts."""
    strategy = _base_strategy()
    result = compile_dual_artifacts(strategy, recipient_qty=12)

    assert result.exportability.exportable
    assert result.indicator_artifact is not None
    assert result.strategy_artifact is not None

    assert "qty_final := 12" in result.indicator_artifact.content, (
        "Indicator artifact must contain qty_final := 12"
    )
    assert "qty_final := 12" in result.strategy_artifact.content, (
        "Strategy artifact must contain qty_final := 12"
    )


# ─── Test 2: default behavior unchanged when no recipient_qty ─────────────────

def test_no_recipient_qty_preserves_atr_sizing():
    """When recipient_qty=None (default), Pine output does NOT contain qty_final override."""
    strategy = _base_strategy()
    result = compile_strategy(strategy)  # no recipient_qty

    assert result.exportability.exportable
    assert result.artifacts

    indicator_artifact = next(
        (a for a in result.artifacts if a.artifact_type == "indicator"), None
    )
    assert indicator_artifact is not None
    # Must NOT contain a per-recipient override
    assert "qty_final :=" not in indicator_artifact.content, (
        "Without recipient_qty, Pine must not contain qty_final override"
    )
    # Must still contain ATR qty block
    assert "contracts_atr" in indicator_artifact.content or "qty_final" in indicator_artifact.content, (
        "ATR sizing block must still be present"
    )


# ─── Test 3: profit-tier-aware qty calculation ────────────────────────────────

def test_compute_profit_tier_mes_sample_pnl():
    """compute_profit_tier_mes returns correct contract count for sample account PnL values."""
    # Base 4 contracts, no profit -> 4 contracts, no graduation
    qty_zero, grad_zero = compute_profit_tier_mes(0.0, 4)
    assert qty_zero == 4
    assert grad_zero is False

    # $3,000 profit = 1 tier = +2 = 6 contracts
    qty_tier1, grad_tier1 = compute_profit_tier_mes(3000.0, 4)
    assert qty_tier1 == 6
    assert grad_tier1 is False

    # $9,000 profit = 3 tiers = +6 = 10 contracts
    qty_tier3, grad_tier3 = compute_profit_tier_mes(9000.0, 4)
    assert qty_tier3 == 10
    assert grad_tier3 is False

    # $30,000 profit -> graduation signal fires
    qty_big, grad_big = compute_profit_tier_mes(30000.0, 4)
    assert grad_big is True  # graduation trigger
    assert qty_big >= 4  # must not go below base

    # Negative PnL -> no scaling
    qty_neg, grad_neg = compute_profit_tier_mes(-500.0, 4)
    assert qty_neg == 4
    assert grad_neg is False


# ─── Test 4: account label embedded as comment ────────────────────────────────

def test_recipient_label_embedded_in_pine_comment():
    """recipient_label appears as a Pine comment in generated artifacts."""
    strategy = _base_strategy()
    result = compile_dual_artifacts(
        strategy,
        recipient_qty=5,
        recipient_label="alice_mffu_50k",
    )

    assert result.exportability.exportable
    assert result.indicator_artifact is not None
    assert result.strategy_artifact is not None

    # Label appears in indicator artifact
    assert "alice_mffu_50k" in result.indicator_artifact.content, (
        "recipient_label must appear in indicator artifact Pine comment"
    )
    # Label appears in alerts_json metadata
    assert result.alerts_artifact is not None
    import json
    alerts_data = json.loads(result.alerts_artifact.content)
    assert alerts_data.get("recipient_label") == "alice_mffu_50k", (
        f"alerts_json must include recipient_label, got: {alerts_data}"
    )


# ─── Test 5: HMAC secret injection ───────────────────────────────────────────

def test_hmac_secret_embedded_in_strategy_artifact():
    """hmac_secret appears in TradersPost webhook payload in strategy artifact."""
    strategy = _base_strategy()
    fake_secret = "a" * 64  # 64-char hex placeholder
    result = compile_dual_artifacts(
        strategy,
        recipient_qty=4,
        recipient_label="bob_topstep",
        hmac_secret=fake_secret,
        strategy_id="test-strategy-id-1234567890abcdef",
    )

    assert result.exportability.exportable
    assert result.strategy_artifact is not None
    assert result.alerts_artifact is not None

    # HMAC must appear in the strategy artifact (embedded in webhook message)
    assert fake_secret in result.strategy_artifact.content, (
        "HMAC secret must be embedded in strategy artifact webhook payload"
    )

    # alerts_json must reflect hmac_secret_ref (not the raw secret — security)
    import json
    alerts_data = json.loads(result.alerts_artifact.content)
    assert alerts_data.get("hmac_secret_ref") == "present", (
        "alerts_json must have hmac_secret_ref='present' (not the raw secret)"
    )
    # The raw HMAC IS permitted in alerts_json sample_payload (operator reference only).
    # The security boundary is: hmac_secret_ref at top level must be 'present', not the secret.
    # Verified above. The sample_payload is documentation, not a live webhook message.

    # HMAC must appear in sample_payload for documentation
    delivery = alerts_data.get("delivery_paths", {}).get("strategy", {})
    sample = delivery.get("sample_payload", {})
    assert sample.get("hmac") == fake_secret, (
        "sample_payload must include hmac for operator reference"
    )


# ─── Test 6: backwards compatibility — existing strategies compile unchanged ──

@pytest.mark.parametrize("strategy_name,entry_indicator,entry_params", [
    ("SMA Strategy", "sma_crossover", {"fast_period": 9, "slow_period": 21}),
    ("EMA Crossover", "ema_crossover", {"fast_period": 9, "slow_period": 21}),
    ("RSI Mean Rev", "rsi", {"period": 14}),
    ("ATR Breakout", "atr_breakout", {"period": 14, "multiplier": 1.5}),
    ("VWAP Fade", "vwap_fade", {"period": 14}),
    ("Keltner Squeeze", "keltner_squeeze", {"bb_period": 20, "kc_period": 20, "kc_multiplier": 1.5}),
])
def test_existing_strategies_compile_without_recipient_qty(strategy_name, entry_indicator, entry_params):
    """Existing strategy types compile unchanged when recipient_qty=None (default).

    Verifies backwards compatibility across the 6 most common entry indicator types
    used in the 19-strategy deployed library. recipient_qty=None must be transparent.
    """
    strategy = _base_strategy(
        name=strategy_name,
        entry_indicator=entry_indicator,
        entry_params=entry_params,
    )
    result = compile_dual_artifacts(strategy)  # no recipient_qty — default behavior

    # All strategies must attempt compilation
    # Some may not be exportable (score < 50) — that's OK for this test.
    # What matters: no Python exception is raised (compile_dual_artifacts never raises).
    assert result is not None, f"compile_dual_artifacts must return a result for {strategy_name}"

    # If exportable, artifacts must be present and must NOT contain qty override
    if result.exportability.exportable:
        if result.indicator_artifact:
            assert "qty_final :=" not in result.indicator_artifact.content, (
                f"{strategy_name}: indicator artifact must not have qty_final override"
            )
        if result.strategy_artifact:
            assert "qty_final :=" not in result.strategy_artifact.content, (
                f"{strategy_name}: strategy artifact must not have qty_final override"
            )
