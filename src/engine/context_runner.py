"""Context engine CLI runner — JSON in, JSON out.

Called by the Node.js server via child_process.spawn.
Two modes:
  --mode bias     : compute HTF + Session + Bias + Playbook
  --mode evaluate : full signal evaluation (all layers)

Usage:
  python -m src.engine.context_runner --mode bias --config '{"symbol":"MES",...}'
  python -m src.engine.context_runner --mode evaluate --config '{"signal":{...},...}'
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from dataclasses import asdict
from pathlib import Path

import polars as pl


def _load_bars(bars_raw: list[dict]) -> pl.DataFrame:
    """Convert raw bar dicts to a Polars DataFrame."""
    if not bars_raw:
        return pl.DataFrame(schema={
            "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
            "close": pl.Float64, "volume": pl.Float64,
        })
    return pl.DataFrame(bars_raw)


def run_bias(config: dict) -> dict:
    """Mode: bias — compute market context + bias + playbook."""
    from src.engine.context.htf_context import compute_htf_context
    from src.engine.context.session_context import compute_session_context
    from src.engine.context.bias_engine import compute_bias
    from src.engine.context.playbook_router import route_playbook

    current_price = config["current_price"]
    vwap = config.get("vwap", 0.0)
    event_active = config.get("event_active", False)
    event_minutes = config.get("event_minutes", 999)
    daily_loss_cap_near = config.get("daily_loss_cap_near", False)
    max_trades_hit = config.get("max_trades_hit", False)

    # Load bar data
    daily_df = _load_bars(config.get("daily_bars", []))
    four_h_df = _load_bars(config.get("four_h_bars", [])) if config.get("four_h_bars") else None
    one_h_df = _load_bars(config.get("one_h_bars", [])) if config.get("one_h_bars") else None

    # Layer 0: HTF Context
    htf = compute_htf_context(
        daily_df=daily_df,
        four_h_df=four_h_df,
        one_h_df=one_h_df,
        current_price=current_price,
    )

    # Layer 0: Session Context
    intraday_bars_raw = config.get("intraday_bars", [])
    intraday_df = _load_bars(intraday_bars_raw)

    # Session context needs timestamp column — provide defaults if no intraday data
    if len(intraday_df) == 0 or ("ts_et" not in intraday_df.columns and "ts_event" not in intraday_df.columns):
        from src.engine.context.session_context import SessionContext
        session = SessionContext(
            overnight_range=(htf.prev_day_high, htf.prev_day_low),
            overnight_bias="neutral",
            london_high=htf.prev_day_high,
            london_low=htf.prev_day_low,
            london_swept_pdh=False,
            london_swept_pdl=False,
            ny_killzone_active=False,
            london_killzone_active=False,
            asian_killzone_active=False,
            current_session="overnight",
            opening_range=(htf.prev_day_high, htf.prev_day_low),
            or_broken=None,
            macro_time_active=False,
        )
    else:
        bar_idx = config.get("bar_idx", len(intraday_df) - 1)
        session = compute_session_context(
            df=intraday_df,
            bar_idx=bar_idx,
            prev_day_high=htf.prev_day_high,
            prev_day_low=htf.prev_day_low,
        )

    # Layer 1: Bias Engine — pass intraday OHLCV for synthetic order flow signals
    # when available. compute_bias() defaults bars=None, so callers without
    # intraday data still get neutral order-flow output (no behavior change).
    of_bars = intraday_df if len(intraday_df) > 0 and "high" in intraday_df.columns else None
    bias = compute_bias(
        htf=htf,
        session=session,
        current_price=current_price,
        vwap=vwap,
        event_active=event_active,
        event_minutes=event_minutes,
        bars=of_bars,
    )

    # Layer 2: Playbook Router
    playbook = route_playbook(
        bias=bias,
        daily_loss_cap_near=daily_loss_cap_near,
        max_trades_hit=max_trades_hit,
    )

    return {
        "htf_context": asdict(htf),
        "session_context": asdict(session),
        "bias": {
            "net_bias": bias.net_bias,
            "bias_confidence": bias.bias_confidence,
            "playbook": bias.playbook,
            "no_trade_reasons": bias.no_trade_reasons,
            "htf_trend_score": bias.htf_trend_score,
            "pd_location_score": bias.pd_location_score,
            "overnight_score": bias.overnight_score,
            "liquidity_context_score": bias.liquidity_context_score,
            "vwap_state_score": bias.vwap_state_score,
            "event_risk_score": bias.event_risk_score,
            "session_regime_score": bias.session_regime_score,
            # Synthetic order flow features (Wave F2)
            "cvd_zscore": bias.cvd_zscore,
            "absorption_active": bias.absorption_active,
            "exhaustion_active": bias.exhaustion_active,
            "sweep_delta_confirmed": bias.sweep_delta_confirmed,
            "order_flow_score": bias.order_flow_score,
        },
        "playbook": {
            "playbook": playbook.playbook,
            "allowed_strategies": playbook.allowed_strategies,
            "allowed_setups": playbook.allowed_setups,
            "confidence_modifier": playbook.confidence_modifier,
        },
    }


def run_evaluate(config: dict) -> dict:
    """Mode: evaluate — full signal evaluation through all 4 layers."""
    from src.engine.context.htf_context import compute_htf_context
    from src.engine.context.session_context import compute_session_context
    from src.engine.context.bias_engine import compute_bias
    from src.engine.context.playbook_router import route_playbook
    from src.engine.context.location_score import compute_location_score
    from src.engine.context.structural_stops import compute_structural_stop
    from src.engine.context.structural_targets import compute_targets
    from src.engine.context.eligibility_gate import evaluate_signal

    # First compute bias (same as bias mode)
    bias_result = run_bias(config)

    # Re-compute objects (not just dicts) for eligibility gate
    daily_df = _load_bars(config.get("daily_bars", []))
    four_h_df = _load_bars(config.get("four_h_bars", [])) if config.get("four_h_bars") else None
    one_h_df = _load_bars(config.get("one_h_bars", [])) if config.get("one_h_bars") else None
    current_price = config["current_price"]

    htf = compute_htf_context(daily_df, four_h_df, one_h_df, current_price)

    intraday_bars_raw = config.get("intraday_bars", [])
    intraday_df = _load_bars(intraday_bars_raw)

    if len(intraday_df) == 0 or ("ts_et" not in intraday_df.columns and "ts_event" not in intraday_df.columns):
        from src.engine.context.session_context import SessionContext as _SC
        session = _SC(
            overnight_range=(htf.prev_day_high, htf.prev_day_low),
            overnight_bias="neutral",
            london_high=htf.prev_day_high, london_low=htf.prev_day_low,
            london_swept_pdh=False, london_swept_pdl=False,
            ny_killzone_active=False, london_killzone_active=False,
            asian_killzone_active=False, current_session="overnight",
            opening_range=(htf.prev_day_high, htf.prev_day_low),
            or_broken=None, macro_time_active=False,
        )
    else:
        bar_idx = config.get("bar_idx", len(intraday_df) - 1)
        session = compute_session_context(intraday_df, bar_idx, htf.prev_day_high, htf.prev_day_low)

    of_bars = intraday_df if len(intraday_df) > 0 and "high" in intraday_df.columns else None
    bias = compute_bias(
        htf=htf, session=session,
        current_price=current_price,
        vwap=config.get("vwap", 0.0),
        event_active=config.get("event_active", False),
        event_minutes=config.get("event_minutes", 999),
        bars=of_bars,
    )

    playbook = route_playbook(
        bias=bias,
        daily_loss_cap_near=config.get("daily_loss_cap_near", False),
        max_trades_hit=config.get("max_trades_hit", False),
    )

    # Extract signal details
    signal = config["signal"]
    direction = signal["direction"]
    entry_price = signal["entry_price"]
    strategy_name = signal["strategy_name"]

    # Structural levels (optional — caller provides from indicators)
    struct = config.get("structural_levels", {})

    # Layer 2.5: Location Score
    location = compute_location_score(
        entry_price=entry_price,
        direction=direction,
        htf=htf,
        session=session,
        vwap=config.get("vwap", 0.0),
        at_order_block=struct.get("at_order_block", False),
        at_fvg=struct.get("at_fvg", False),
        after_sweep=struct.get("after_sweep", False),
        at_value_area_edge=struct.get("at_value_area_edge", False),
        in_killzone=session.ny_killzone_active or session.london_killzone_active,
        has_mss=struct.get("has_mss", False),
    )

    # Layer: Structural Stops
    atr = config.get("atr", 2.0)
    point_value = config.get("point_value", 5.0)  # MES default
    tick_size = config.get("tick_size", 0.25)

    stop_plan = compute_structural_stop(
        direction=direction,
        entry_price=entry_price,
        point_value=point_value,
        atr=atr,
        tick_size=tick_size,
        nearest_ob_below=struct.get("nearest_ob_below"),
        nearest_ob_above=struct.get("nearest_ob_above"),
        nearest_fvg_below=struct.get("nearest_fvg_below"),
        nearest_fvg_above=struct.get("nearest_fvg_above"),
        nearest_swing_low=struct.get("nearest_swing_low"),
        nearest_swing_high=struct.get("nearest_swing_high"),
        sweep_wick_low=struct.get("sweep_wick_low"),
        sweep_wick_high=struct.get("sweep_wick_high"),
        session_transition=struct.get("session_transition", False),
    )

    # Layer: Structural Targets
    target_plan = compute_targets(
        direction=direction,
        entry_price=entry_price,
        stop_price=stop_plan.stop_price,
        nearest_bsl=struct.get("nearest_bsl"),
        nearest_ssl=struct.get("nearest_ssl"),
        nearest_old_high=struct.get("nearest_old_high"),
        nearest_old_low=struct.get("nearest_old_low"),
        nearest_untested_ob=struct.get("nearest_untested_ob"),
        nearest_unfilled_fvg=struct.get("nearest_unfilled_fvg"),
        vwap=config.get("vwap", 0.0),
        vwap_std=config.get("vwap_std", 0.0),
        regime=config.get("regime", "normal"),
    )

    # Layer 3: Eligibility Gate
    eligibility = evaluate_signal(
        signal={"direction": direction, "strategy_name": strategy_name, "entry_price": entry_price},
        bias_state=bias,
        playbook=playbook,
        location=location,
        stop_plan=stop_plan,
        target_plan=target_plan,
        session=session,
        daily_loss_used_pct=config.get("daily_loss_used_pct", 0.0),
        max_trades_hit=config.get("max_trades_hit", False),
    )

    return {
        **bias_result,
        "location": {
            "score": location.score,
            "grade": location.grade,
            "factors": location.factors,
            "sweep_present": location.sweep_present,
            "ob_fvg_overlap": location.ob_fvg_overlap,
            "in_ote_zone": location.in_ote_zone,
            "confluence_count": location.confluence_count,
            "in_killzone": location.in_killzone,
        },
        "stop_plan": asdict(stop_plan),
        "target_plan": {
            "tp1": target_plan.tp1,
            "tp1_reason": target_plan.tp1_reason,
            "tp2": target_plan.tp2,
            "tp2_reason": target_plan.tp2_reason,
            "tp3_mode": target_plan.tp3_mode,
            "tp3_trail_structure": target_plan.tp3_trail_structure,
            "regime_adjustment": target_plan.regime_adjustment,
            "partial_sizes": list(target_plan.partial_sizes),
            "min_rr_ratio": target_plan.min_rr_ratio,
            "rr_achieved": target_plan.rr_achieved,
        },
        "eligibility": {
            "action": eligibility.action,
            "confidence": eligibility.confidence,
            "reasoning": eligibility.reasoning,
            "location_score": eligibility.location_score,
            "playbook": eligibility.playbook,
            "override_stop": eligibility.override_stop,
            "override_targets": eligibility.override_targets,
            "partial_sizes": list(eligibility.partial_sizes),
            "position_size_adjustment": eligibility.position_size_adjustment,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Context engine runner")
    parser.add_argument("--mode", choices=["bias", "evaluate"], required=True)
    parser.add_argument("--config", required=False, help="JSON config string (optional, defaults to stdin)")
    args = parser.parse_args()

    try:
        if args.config:
            config = json.loads(args.config)
        else:
            config = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON config: {e}"}), file=sys.stdout)
        sys.exit(1)

    try:
        if args.mode == "bias":
            result = run_bias(config)
        else:
            result = run_evaluate(config)
        print(json.dumps(result))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
