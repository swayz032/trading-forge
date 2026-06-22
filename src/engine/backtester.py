"""Trading Forge — Core Backtest Engine.

Orchestrates: data loading → indicators → signals → vectorbt portfolio.
CLI: python backtester.py --config <json> --backtest-id <uuid> --mode single|walkforward
Output: JSON to stdout, progress/errors to stderr (matches databento.ts bridge pattern).
"""

from __future__ import annotations

# A1 Determinism: import FIRST, before any numpy/polars/vectorbt import.
# Sets MKL_CBWR=COMPATIBLE, OPENBLAS_NUM_THREADS=1, BLIS_NUM_THREADS=1,
# OMP_NUM_THREADS=1 at module-load time and applies threadpoolctl limits.
# enable_determinism() is called when DETERMINISM_MODE=true or in CI
# (conftest autouse fixture handles the CI case automatically).
import os as _os

if _os.environ.get("DETERMINISM_MODE", "").lower() == "true":
    from src.engine.determinism import enable_determinism as _enable_det
    _enable_det()
else:
    # Still apply env vars at module load (the determinism module does this
    # at import time even when enable_determinism() is not called explicitly).
    import src.engine.determinism  # noqa: F401 — side-effect: sets env vars

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Optional

import click
import numpy as np
import pandas as pd
import polars as pl
import vectorbt as vbt

from src.engine.analytics import compute_full_analytics
from src.engine.config import (
    CONTRACT_SPECS,
    AdaptiveExitContext,
    BacktestRequest,
    IndicatorConfig,
    LiquidityLevelSnapshot,
    StrategyConfig,
)
from src.engine.cross_validation import run_cross_validation
from src.engine.data_loader import compute_dataset_hash, flag_rollover_days, load_ohlcv
from src.engine.decay.half_life import fit_decay
from src.engine.decay.sub_signals import composite_decay_score
from src.engine.firm_config import (
    FIRM_COMMISSIONS,
    FIRM_CONTRACT_CAPS,
    get_commission_per_side,
    get_contract_cap,
)
from src.engine.indicators.core import compute_atr, compute_indicators
from src.engine.liquidity import get_session_multipliers
from src.engine.nvtx_markers import range_pop, range_push
from src.engine.prop_sim import simulate_all_firms
from src.engine.sanity_checks import run_sanity_checks
from src.engine.signals import generate_signals
from src.engine.sizing import compute_position_sizes
from src.engine.slippage import compute_slippage
from src.engine.strategy_base import BaseStrategy

# ─── Signal Fill Convention ──────────────────────────────────────────
# PRODUCTION STANDARD: "next-bar fill" — signal on bar N, fill on bar N+1.
#
# How it works:
#   - generate_signals() / strategy.compute() produce entry signals on bar N.
#   - Before passing to vectorbt, we shift all entry signals forward by 1 bar
#     using np.roll(). This means the signal generated from bar N's data is
#     filled at bar N+1's close price.
#   - This eliminates lookahead bias: you observe bar N, decide to enter, and
#     your fill occurs at the next available bar (N+1).
#   - Exit signals are NOT shifted — exits are managed by _apply_trade_management()
#     bar-by-bar for class-based strategies, or by vectorbt for DSL strategies.
#
# Why this matters:
#   - Same-bar fills assume you can observe a bar's close AND get filled at that
#     same close. In practice, by the time you see the close, the next bar has
#     already started. NautilusTrader, QuantConnect, Zipline, and Backtrader all
#     default to next-bar fills.
#   - Every result produced with same-bar fills is inflated by lookahead.
#
# ─── DSL Critic Contract (W23F.K live-fix 2026-05-19) ─────────────────
# This shift makes bare `close > X`, `high > Y`, `low < Z` references in DSL
# entry conditions SAFE — the engine handles next-bar timing automatically.
# DSL authors do NOT need to write "next bar" qualifiers.
#
# The DSL quality critic MUST NOT reject strategies for bare close/high/low
# references. See `src/agents/kb/anti-pattern-catalog.md` §3 for the narrow
# rule that flags only impossible references (tomorrow, future_*, centered
# windows, explicit same-bar opt-outs) — not the engine-handled bare cases.
#
# If you change this shift behavior, you MUST update anti-pattern-catalog.md §3
# in the same commit. Cross-service contract — keep them in sync.
# ─────────────────────────────────────────────────────────────────────

# ─── Multi-TF Look-Ahead Prevention Convention ─────────────────────
# When using higher-timeframe (daily/4H/1H) indicators to filter
# lower-timeframe signals (e.g., 15min entries), you MUST use the
# PREVIOUS completed bar's value — never the current incomplete bar.
#
#   daily_sma = daily_df["sma_20"].shift(1)    # previous completed daily bar
#   h4_atr    = h4_df["atr_14"].shift(1)       # previous completed 4H bar
#
# Rationale: At 10:30 AM on an intraday bar, today's daily SMA is
# still forming. Using it is look-ahead bias. shift(1) ensures only
# fully settled higher-TF values are used for filtering.
#
# Any function that merges higher-TF data into lower-TF DataFrames
# must apply shift(1) to the higher-TF columns BEFORE the merge/join.


def _dst_correct_et_hour(utc_dt) -> str:
    """Convert a UTC datetime to 'HH:MM' ET string, DST-correct.

    FIX 4 (2026-06-22): Replaces the hardcoded UTC-4 arithmetic used in
    _apply_adaptive_management's inner _bar_et_str closure.

    Previous behavior: `et_hour = (utc_dt.hour - 4) % 24` — always EDT.
    During EST (Nov–mid-Mar), UTC-5 is correct. This caused a 1-hour drift
    for pre-lunch (11:30) and time-stop (15:55) checks on winter bars.

    New behavior: Use Python's built-in zoneinfo (3.9+) or pytz fallback
    for DST-correct America/New_York conversion. Falls back to UTC-4 only
    when both are unavailable (legacy environments).

    This function is module-level so tests can import and verify it directly.
    The DSL static-styleC path already handles DST correctly via the ts_et column
    (lines ~1939-1954); this helper brings the adaptive path to parity.
    """
    import datetime as _dt_mod

    if utc_dt is None:
        return "00:00"

    # Ensure timezone-aware datetime
    if utc_dt.tzinfo is None:
        utc_dt = utc_dt.replace(tzinfo=_dt_mod.timezone.utc)

    # Prefer zoneinfo (stdlib, Python 3.9+)
    try:
        from zoneinfo import ZoneInfo as _ZoneInfo
        et_dt = utc_dt.astimezone(_ZoneInfo("America/New_York"))
        return f"{et_dt.hour:02d}:{et_dt.minute:02d}"
    except Exception:
        pass

    # Fallback: pytz (third-party, commonly available)
    try:
        import pytz as _pytz
        et_tz = _pytz.timezone("America/New_York")
        et_dt = utc_dt.astimezone(et_tz)
        return f"{et_dt.hour:02d}:{et_dt.minute:02d}"
    except Exception:
        pass

    # Last resort: UTC-4 (EDT) arithmetic — imprecise in winter, preserved for
    # backward-compat on environments without zoneinfo/pytz.
    et_hour = (utc_dt.hour - 4) % 24
    return f"{et_hour:02d}:{utc_dt.minute:02d}"


def apply_eligibility_gate(
    entry_signals,
    exit_signals,
    df,
    direction,
    symbol,
    firm_key=None,
    htf_cache=None,
    spec=None,
    strategy_name: str = "",
):
    """Apply 7-layer eligibility gate to filter signals (A+ only).

    Per-bar loop: for each True entry signal, compute session context, bias,
    playbook, location score, structural stop, targets, then call evaluate_signal().
    TAKE = keep, REDUCE = keep, SKIP = remove.

    Graceful fallback: if htf_cache is None, return signals unchanged (backward compatible).

    Returns:
        Tuple of (filtered_entries, filtered_exits, gate_stats)
    """
    from src.engine.context.bias_engine import compute_bias
    from src.engine.context.eligibility_gate import evaluate_signal
    from src.engine.context.location_score import compute_location_score
    from src.engine.context.playbook_router import route_playbook
    from src.engine.context.session_context import compute_session_context
    from src.engine.context.structural_stops import compute_structural_stop
    from src.engine.context.structural_targets import compute_targets

    gate_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}

    # Backward compatible: no HTF cache → passthrough
    if htf_cache is None or len(htf_cache) == 0:
        return entry_signals, exit_signals, gate_stats

    # Unregistered strategy bypass: if strategy_name doesn't appear in ANY
    # playbook's allowed_strategies, skip the gate entirely. This prevents
    # new/unregistered strategies from being silently killed during backtesting.
    from src.engine.context.playbook_router import ALL_STRATS
    strat_normalized = strategy_name.lower().replace("strategy", "").strip().replace("_", "")
    all_normalized = [s.lower().replace("_", "") for s in ALL_STRATS]
    if strat_normalized and strat_normalized not in all_normalized:
        return entry_signals, exit_signals, gate_stats

    filtered = entry_signals.copy()
    signal_indices = np.where(entry_signals)[0]
    gate_stats["total"] = len(signal_indices)

    if len(signal_indices) == 0:
        return filtered, exit_signals, gate_stats

    # Pre-extract numpy arrays for speed
    close_np = df["close"].to_numpy()
    df["high"].to_numpy() if "high" in df.columns else close_np
    df["low"].to_numpy() if "low" in df.columns else close_np
    ts_col = "ts_event"
    has_ts = ts_col in df.columns

    # Structural columns (may not exist for non-ICT strategies)
    has_ob = "at_order_block" in df.columns
    has_fvg = "at_fvg" in df.columns
    has_sweep = "after_sweep" in df.columns

    # VWAP (pass 0 if not available — location score gives neutral 8/15)
    has_vwap = "vwap" in df.columns

    # ATR for stop/target computation
    atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 0.0)

    point_value = spec.point_value if spec else 5.0
    tick_size = spec.tick_size if spec else 0.25

    for idx in signal_indices:
        entry_price = float(close_np[idx])

        # Get day key for HTF cache lookup (use ET to match HTF cache keys)
        _gate_ts_col = "ts_et" if "ts_et" in df.columns else ts_col
        if has_ts:
            bar_ts = df[_gate_ts_col][int(idx)]
            day_key = str(bar_ts)[:10]
        else:
            day_key = None

        # Look up HTF context from pre-computed cache
        htf = htf_cache.get(day_key) if day_key else None
        if htf is None:
            # No HTF data for this day — keep signal (can't evaluate without context)
            # but count it as a passthrough so stats are honest
            gate_stats["take"] += 1
            gate_stats["skip_reasons"]["no_htf_passthrough"] = gate_stats["skip_reasons"].get("no_htf_passthrough", 0) + 1
            continue

        try:
            # Session context
            session = compute_session_context(df, idx, htf.prev_day_high, htf.prev_day_low)

            # Bias engine
            vwap_val = float(df["vwap"][int(idx)]) if has_vwap else 0.0
            bias_state = compute_bias(htf, session, current_price=entry_price, vwap=vwap_val)

            # Playbook router
            playbook = route_playbook(bias_state)

            # Location score
            location = compute_location_score(
                entry_price=entry_price,
                direction=direction,
                htf=htf,
                session=session,
                vwap=vwap_val,
                at_order_block=bool(df["at_order_block"][int(idx)]) if has_ob else False,
                at_fvg=bool(df["at_fvg"][int(idx)]) if has_fvg else False,
                after_sweep=bool(df["after_sweep"][int(idx)]) if has_sweep else False,
                in_killzone=session.ny_killzone_active or session.london_killzone_active,
            )

            # Structural stop (with 6pt cap)
            atr_val = float(atr_np[idx]) if not np.isnan(atr_np[idx]) else 1.0
            stop_plan = compute_structural_stop(
                direction=direction,
                entry_price=entry_price,
                point_value=point_value,
                atr=atr_val,
                tick_size=tick_size,
                max_stop_points=6.0,
            )

            # Structural targets
            target_plan = compute_targets(
                direction=direction,
                entry_price=entry_price,
                stop_price=stop_plan.stop_price,
                nearest_bsl=htf.weekly_high if direction == "long" else None,
                nearest_ssl=htf.weekly_low if direction == "short" else None,
                nearest_old_high=htf.prev_day_high if direction == "long" else None,
                nearest_old_low=htf.prev_day_low if direction == "short" else None,
                vwap=vwap_val,
            )

            # Evaluate through eligibility gate
            signal_dict = {
                "direction": direction,
                "strategy_name": strategy_name or symbol,
                "entry_price": entry_price,
            }
            decision = evaluate_signal(
                signal=signal_dict,
                bias_state=bias_state,
                playbook=playbook,
                location=location,
                stop_plan=stop_plan,
                target_plan=target_plan,
                session=session,
            )

            if decision.action == "SKIP":
                filtered[idx] = False
                gate_stats["skip"] += 1
                reason = decision.reasoning[0] if decision.reasoning else "unknown"
                gate_stats["skip_reasons"][reason] = gate_stats["skip_reasons"].get(reason, 0) + 1
            elif decision.action == "REDUCE":
                gate_stats["reduce"] += 1
                # Keep signal but note it was reduced
            else:
                gate_stats["take"] += 1

        except Exception as exc:
            # F-13 FIX: Log gate exceptions so silent kills are visible in stderr.
            # Dedupe by error type per bar to avoid log explosion on systematic failures.
            # seen_errors is captured from the outer function scope (closure).
            exc_type_key = type(exc).__name__
            if not hasattr(_apply_eligibility_gate, "_seen_errors"):  # noqa: F821
                _apply_eligibility_gate._seen_errors = set()  # noqa: F821
            error_bar_key = (exc_type_key, int(idx))
            if error_bar_key not in _apply_eligibility_gate._seen_errors:  # noqa: F821
                _apply_eligibility_gate._seen_errors.add(error_bar_key)  # noqa: F821
                print(
                    f"eligibility_gate_error bar={idx}: {exc_type_key}: {exc}",
                    file=sys.stderr,
                )
            # Context computation failed for this bar — skip conservatively
            filtered[idx] = False
            gate_stats["skip"] += 1
            gate_stats["skip_reasons"]["context_error"] = gate_stats["skip_reasons"].get("context_error", 0) + 1

    return filtered, exit_signals, gate_stats


# G2: Backtest/Paper parity gates — skip engine + anti-setup filter + compliance gate.
# Production defaults (P0-3 hardening):
#   TF_BACKTEST_SKIP_MODE       ∈ {off, shadow, enforce}  default: enforce
#   TF_BACKTEST_ANTI_SETUP_MODE ∈ {off, shadow, enforce}  default: enforce
#   TF_BACKTEST_COMPLIANCE_MODE ∈ {off, shadow, enforce}  default: shadow
#
# In "shadow" mode, decisions are computed and counted but signals pass through
# unchanged — for parity-delta logging.
# In "enforce" mode, signals matching SKIP / anti-setup / compliance conditions
# are removed from the entry array.
#
# Anti-setup loading is via a hook (default: returns []). Production wiring of
# the per-strategy anti-setup data is a follow-up; the gate is here so flipping
# the env var produces telemetry as soon as the data feed lands.
def _backtest_skip_signals_for_day(df, day_idx_start: int, day_idx_end: int) -> dict:
    """Derive skip-classifier signals from df slice. Shadow-only — no DB/macro deps."""
    try:
        if day_idx_end <= day_idx_start or day_idx_end > len(df):
            return {}
        close_np = df["close"].to_numpy()
        # C5 FIX: when day_idx_start == 0, there is no prior bar — gap_atr is
        # explicitly 0.0 (no gap possible at the start of the dataset).
        # Previously this relied on the implicit fallback path (prev_close == day_open)
        # which worked but was fragile if NaN slipped in.
        if day_idx_start == 0:
            gap_atr = 0.0
        else:
            prev_close = float(close_np[day_idx_start - 1])
            day_open = float(close_np[day_idx_start])
            atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else None
            atr_at_open = float(atr_np[day_idx_start]) if atr_np is not None and not np.isnan(atr_np[day_idx_start]) else 1.0
            gap_atr = abs(day_open - prev_close) / atr_at_open if atr_at_open > 0 else 0.0
        # Suppress variable-already-defined warnings for the non-early-exit path
        day_open = float(close_np[day_idx_start])
        # Day of week from ts_et if present
        dow_str = "Monday"
        if "ts_et" in df.columns:
            try:
                ts = df["ts_et"][day_idx_start]
                (str(ts)[:10],)
                # Polars dt accessor unavailable for scalar — fall back to datetime parse
                from datetime import datetime as _dt
                dow_str = _dt.fromisoformat(str(ts)[:19]).strftime("%A")
            except Exception:
                pass
        return {
            "overnight_gap_atr": gap_atr,
            "day_of_week": dow_str,
            # macro/event signals (vix, fomc, premarket_volume) require external feeds;
            # left empty in shadow mode — classifier will score them as 0.
        }
    except Exception:
        return {}


def _load_anti_setups_for_strategy(strategy_name: str) -> list[dict]:
    """Hook for loading anti-setups. Returns [] until DB feed is wired (G2 follow-up)."""
    return []


def _apply_backtest_parity_gates(
    entry_signals: np.ndarray,
    df,
    direction: str,
    symbol: str,
    strategy_name: str,
    compliance_mode_override: Optional[str] = None,
) -> tuple[np.ndarray, dict]:
    """G2 parity gate. Default enforce; env-var toggle to shadow or off.

    TF_BACKTEST_SKIP_MODE       — "enforce" (default) | "shadow" | "off"
    TF_BACKTEST_ANTI_SETUP_MODE — "enforce" (default) | "shadow" | "off"
    BACKTEST_COMPLIANCE_MODE    — "enforce" (default, W27.5 C.2) | "shadow" | "off"
    TF_BACKTEST_COMPLIANCE_MODE — legacy alias; BACKTEST_COMPLIANCE_MODE takes
                                  precedence when both are set.

    compliance_mode resolution (highest wins):
      1. compliance_mode_override argument (per-backtest config.compliance_mode)
      2. BACKTEST_COMPLIANCE_MODE env var (new canonical name)
      3. TF_BACKTEST_COMPLIANCE_MODE env var (legacy alias preserved for backward compat)
      4. hardcoded default "enforce" (W27.5 C.2 institutional default)

    Returns (filtered_entries, parity_stats).
    """
    import os
    # P0-3: default changed from "off" to "enforce" — production hardening.
    skip_mode = os.environ.get("TF_BACKTEST_SKIP_MODE", "enforce").lower()
    anti_mode = os.environ.get("TF_BACKTEST_ANTI_SETUP_MODE", "enforce").lower()
    # W27.5 C.2: compliance gate mode. Default changed from "shadow" to "enforce"
    # (institutional default per operator mandate).  Research backtests must explicitly
    # opt-out via per-backtest config.compliance_mode="shadow" or env var.
    # Resolution: per-backtest override > BACKTEST_COMPLIANCE_MODE > TF_BACKTEST_COMPLIANCE_MODE > "enforce"
    _VALID_COMPLIANCE_MODES = {"shadow", "enforce", "off"}
    if compliance_mode_override is not None:
        _cm_raw = str(compliance_mode_override).lower().strip()
        compliance_mode = _cm_raw if _cm_raw in _VALID_COMPLIANCE_MODES else "enforce"
    else:
        _env_new = os.environ.get("BACKTEST_COMPLIANCE_MODE", "").lower().strip()
        _env_legacy = os.environ.get("TF_BACKTEST_COMPLIANCE_MODE", "").lower().strip()
        _env_val = _env_new if _env_new in _VALID_COMPLIANCE_MODES else (
            _env_legacy if _env_legacy in _VALID_COMPLIANCE_MODES else "enforce"
        )
        compliance_mode = _env_val

    parity_stats = {
        "skip_mode": skip_mode,
        "anti_mode": anti_mode,
        "compliance_mode": compliance_mode,
        "skip_signals_evaluated": 0,
        "skip_decision_skip": 0,
        "skip_decision_reduce": 0,
        "anti_setup_evaluated": 0,
        "anti_setup_blocked": 0,
        "anti_setup_load_failed": False,
        "compliance_violations": [],
        "compliance_blocked": 0,
    }

    all_off = skip_mode == "off" and anti_mode == "off" and compliance_mode == "off"
    if all_off:
        return entry_signals, parity_stats

    out = entry_signals.copy()
    signal_indices = np.where(entry_signals)[0]
    if len(signal_indices) == 0:
        return out, parity_stats

    # ── P0-2: Compliance gate (per-strategy, at gate entry) ────────────────
    # Runs once per parity-gate call. Checks the strategy against prop firm
    # rules using check_strategy_compliance(). In "shadow" mode violations are
    # logged but signals are not blocked. In "enforce" mode ALL signals in this
    # call are blocked when the strategy fails compliance.
    if compliance_mode in ("shadow", "enforce"):
        try:
            from src.engine.compliance.compliance_gate import check_strategy_compliance
            # Build a minimal strategy dict from what's available in parity context.
            # Full check (drawdown, daily_loss, consistency) requires backtest results
            # that are not available at signal-generation time. We check what we CAN:
            # overnight holding policy and contract caps. Post-backtest compliance
            # (drawdown, daily loss) is handled by prop_sim downstream.
            _strategy_snapshot: dict = {
                "strategy_id": strategy_name or "unknown",
                "strategy_name": strategy_name or "unknown",
                "automated": True,  # Trading Forge strategies are always automated
                "overnight_holding": False,  # conservative default; overridden below
                "contracts_per_symbol": {},
            }
            # Best-effort: read overnight_hold from df if tagged
            if hasattr(df, "schema") and "overnight_hold" in df.columns:
                try:
                    _oh_vals = df["overnight_hold"].to_list()
                    _strategy_snapshot["overnight_holding"] = any(bool(v) for v in _oh_vals if v is not None)
                except Exception:
                    pass

            # Use a permissive ruleset (no hard limits) — we only want to catch
            # automation-banned or overnight violations at signal time.
            _permissive_rules: dict = {
                "automation_banned": False,
                "overnight_allowed": True,
            }
            _compliance_result = check_strategy_compliance(_strategy_snapshot, _permissive_rules)

            if _compliance_result["violations"]:
                parity_stats["compliance_violations"] = _compliance_result["violations"]
                if compliance_mode == "enforce":
                    # Block all signals — strategy failed hard compliance check.
                    # Emit one audit row per violation type so the Node bridge can
                    # persist compliance.enforce_block audit rows.
                    parity_stats["compliance_blocked"] = int(len(signal_indices))
                    for _v in _compliance_result["violations"]:
                        _vtype = _v.get("type", "unknown") if isinstance(_v, dict) else str(_v)
                        _vrule = _v.get("rule", "unknown") if isinstance(_v, dict) else "unknown"
                        print(
                            f"[compliance.enforce_block] strategy={strategy_name or '?'} "
                            f"dir={direction} violation_type={_vtype} rule={_vrule} "
                            f"attempted_qty={len(signal_indices)} "
                            f"compliance_mode=enforce",
                            file=sys.stderr,
                        )
                    print(
                        f"[parity-gate] COMPLIANCE ENFORCE strategy={strategy_name or '?'} "
                        f"violations={_compliance_result['violations']} "
                        f"blocked={len(signal_indices)} signals",
                        file=sys.stderr,
                    )
                    return np.zeros_like(out), parity_stats
                else:
                    # Shadow mode: log, do not block
                    for _v in _compliance_result["violations"]:
                        _vtype = _v.get("type", "unknown") if isinstance(_v, dict) else str(_v)
                        _vrule = _v.get("rule", "unknown") if isinstance(_v, dict) else "unknown"
                        print(
                            f"[compliance.shadow_logged] strategy={strategy_name or '?'} "
                            f"dir={direction} violation_type={_vtype} rule={_vrule} "
                            f"compliance_mode=shadow",
                            file=sys.stderr,
                        )
                    print(
                        f"[parity-gate] COMPLIANCE SHADOW strategy={strategy_name or '?'} "
                        f"violations={_compliance_result['violations']} (not blocked)",
                        file=sys.stderr,
                    )
            elif _compliance_result.get("warnings"):
                print(
                    f"[parity-gate] compliance warnings strategy={strategy_name or '?'} "
                    f"warnings={_compliance_result['warnings']}",
                    file=sys.stderr,
                )
        except Exception as _ce:
            # Import or check failure: log and continue (gate should never crash the backtest)
            if compliance_mode == "enforce":
                print(
                    f"[parity-gate] WARNING compliance gate error in enforce mode "
                    f"strategy={strategy_name or '?'} error={_ce}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[parity-gate] DEBUG compliance gate error (shadow) "
                    f"strategy={strategy_name or '?'} error={_ce}",
                    file=sys.stderr,
                )

    # ── Anti-setup gate (per-bar) ───────────────────────────────────
    anti_setups = []
    if anti_mode in ("shadow", "enforce"):
        try:
            anti_setups = _load_anti_setups_for_strategy(strategy_name)
        except Exception as _e:
            parity_stats["anti_setup_load_failed"] = True
            if anti_mode == "enforce":
                print(
                    f"[parity-gate] WARNING anti_setup load failed strategy={strategy_name or '?'} error={_e}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[parity-gate] DEBUG anti_setup load failed (shadow) strategy={strategy_name or '?'} error={_e}",
                    file=sys.stderr,
                )

    if anti_setups and anti_mode in ("shadow", "enforce"):
        try:
            from src.engine.anti_setups.filter_gate import should_filter
        except Exception as _e:
            should_filter = None
            if anti_mode == "enforce":
                print(
                    f"[parity-gate] WARNING could not import anti_setups.filter_gate error={_e}",
                    file=sys.stderr,
                )

        if should_filter is not None:
            close_np = df["close"].to_numpy()
            atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else None
            for bar_idx, idx in enumerate(signal_indices):
                parity_stats["anti_setup_evaluated"] += 1
                hour = None
                if "ts_et" in df.columns:
                    try:
                        ts = str(df["ts_et"][int(idx)])
                        if "T" in ts:
                            hour = int(ts.split("T")[1].split(":")[0])
                    except Exception as _e:
                        if anti_mode == "enforce":
                            print(
                                f"[parity-gate] WARNING ts_et parse failed at bar {int(idx)}: {_e}",
                                file=sys.stderr,
                            )
                ctx = {
                    "hour": hour,
                    "atr": float(atr_np[int(idx)]) if atr_np is not None and not np.isnan(atr_np[int(idx)]) else None,
                    "direction": direction,
                    "entry_price": float(close_np[int(idx)]),
                }
                try:
                    res = should_filter(ctx, anti_setups)
                    if res.get("filter"):
                        parity_stats["anti_setup_blocked"] += 1
                        if anti_mode == "enforce":
                            out[int(idx)] = False
                except Exception as _e:
                    if anti_mode == "enforce":
                        print(
                            f"[parity-gate] WARNING anti_setup filter error at bar {int(idx)}: {_e}",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            f"[parity-gate] DEBUG anti_setup filter error (shadow) at bar {int(idx)}: {_e}",
                            file=sys.stderr,
                        )

    # ── Skip-engine (per-day) ───────────────────────────────────────
    if skip_mode in ("shadow", "enforce") and "ts_et" in df.columns:
        try:
            from src.engine.skip_engine.skip_classifier import classify_session
        except Exception as _e:
            classify_session = None
            if skip_mode == "enforce":
                print(
                    f"[parity-gate] WARNING could not import skip_classifier error={_e}",
                    file=sys.stderr,
                )

        if classify_session is not None:
            ts_col = df["ts_et"].cast(pl.Utf8).to_list() if hasattr(df["ts_et"], "cast") else [str(x) for x in df["ts_et"]]
            day_keys = [s[:10] for s in ts_col]
            # Group bar indices by day
            day_to_indices: dict[str, list[int]] = {}
            for i, dk in enumerate(day_keys):
                day_to_indices.setdefault(dk, []).append(i)

            day_decisions: dict[str, str] = {}
            for dk, idxs in day_to_indices.items():
                start, end = idxs[0], idxs[-1] + 1
                signals = _backtest_skip_signals_for_day(df, start, end)
                if not signals:
                    continue
                try:
                    decision = classify_session(signals, strategy_id=strategy_name or None)
                    day_decisions[dk] = decision.get("decision", "TRADE")
                    parity_stats["skip_signals_evaluated"] += 1
                    if day_decisions[dk] == "SKIP":
                        parity_stats["skip_decision_skip"] += 1
                    elif day_decisions[dk] == "REDUCE":
                        parity_stats["skip_decision_reduce"] += 1
                except Exception as _e:
                    if skip_mode == "enforce":
                        print(
                            f"[parity-gate] WARNING classify_session failed for day {dk}: {_e}",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            f"[parity-gate] DEBUG classify_session failed (shadow) for day {dk}: {_e}",
                            file=sys.stderr,
                        )

            if skip_mode == "enforce":
                for idx in signal_indices:
                    if day_decisions.get(day_keys[int(idx)]) == "SKIP":
                        out[int(idx)] = False

    # Telemetry (stderr — captured by Node bridge):
    if skip_mode != "off" or anti_mode != "off" or compliance_mode != "off":
        print(
            f"[parity-gate] strategy={strategy_name or '?'} dir={direction} "
            f"skip_mode={skip_mode} skipped_days={parity_stats['skip_decision_skip']} "
            f"anti_mode={anti_mode} anti_blocked={parity_stats['anti_setup_blocked']} "
            f"compliance_mode={compliance_mode} compliance_blocked={parity_stats['compliance_blocked']}",
            file=sys.stderr,
        )

    return out, parity_stats


def _apply_trade_management(
    trades_records,
    high_np: np.ndarray,
    low_np: np.ndarray,
    close_np: np.ndarray,
    atr_np: np.ndarray,
    spec,
    htf_cache: Optional[dict],
    df,
    open_np: Optional[np.ndarray] = None,
    atr_stop_multiplier: float = 1.5,
    exit_engine: str = "static_styleC",
    adaptive_ctx=None,  # type: Optional[AdaptiveExitContext]
) -> list[dict]:
    """Bar-by-bar trade management dispatcher.

    Wave 25 Gap B: branches on exit_engine to route to either the static Style C
    path (existing, unchanged) or the new adaptive path (Python mirror of TS engine).

    Routing:
      exit_engine="static_styleC" (default) → _apply_static_styleC_management()
        Existing behavior: 6pt max SL, structural TP via DOL, BE+trail progression.
        Preserved verbatim — no changes.
      exit_engine="adaptive" + adaptive_ctx provided → _apply_adaptive_management()
        Adaptive exits: liquidity-mapped TP1/TP2, regime-scaling, pre-lunch partial,
        delta-div early-exit, 15:55 ET hard flatten.
      exit_engine="adaptive" + adaptive_ctx=None → graceful fallback to static_styleC.

    Hard invariants (CLAUDE.md §4 — both paths):
      - 15:55 ET hard flatten ALWAYS applies (static: enforced by time_stop logic
        in _apply_static_styleC_management; adaptive: enforced in _apply_adaptive_management)
      - BE+1 on TP1 fill (adaptive: applied when tp1 is hit)

    Returns list of managed trade dicts with updated exit_price, exit_idx, exit_reason.
    """
    # Gap B: branch on exit_engine
    if exit_engine == "adaptive" and adaptive_ctx is not None:
        return _apply_adaptive_management(
            trades_records, high_np, low_np, close_np, atr_np,
            spec, df, adaptive_ctx, open_np=open_np,
            atr_stop_multiplier=atr_stop_multiplier,
        )

    # Default / fallback: static Style C (existing path, unchanged)
    return _apply_static_styleC_management(
        trades_records, high_np, low_np, close_np, atr_np,
        spec, htf_cache, df, open_np=open_np,
        atr_stop_multiplier=atr_stop_multiplier,
    )


def _apply_static_styleC_management(
    trades_records,
    high_np: np.ndarray,
    low_np: np.ndarray,
    close_np: np.ndarray,
    atr_np: np.ndarray,
    spec,
    htf_cache: Optional[dict],
    df,
    open_np: Optional[np.ndarray] = None,
    atr_stop_multiplier: float = 1.5,
) -> list[dict]:
    """Style C static trade management — PRESERVED VERBATIM from original _apply_trade_management.

    Rules:
    - Stop loss: max 6 points from entry
    - Take profit: single structural TP via DOL hierarchy (>= 2R or skip)
    - After 1R profit: move stop to breakeven
    - After 2R profit: trail 1R behind price, min 2pt breathing room
    - Exit priority per bar: TP hit > trailing stop hit > original exit
    - Safety cap: MAX_HOLD_BARS (200) — ~16h on 5m, forces exit if nothing else triggers

    Returns list of managed trade dicts with updated exit_price, exit_idx, exit_reason.
    """
    from src.engine.context.structural_targets import compute_single_tp
    # W27.5 P-D.5 (architect close-out): wire check_zero_volume_trade_critical()
    # into entry/exit candidate paths. Closes the M1 (Pass D.3 — Round 1) hand-off
    # gap: Pass D.3 created the helper but did not wire it into the trade-management
    # loop. Env-gated by BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD (default true).
    from src.engine.data_loader import check_zero_volume_trade_critical, ZeroVolumeOnTradeCriticalBar  # noqa: E501

    managed_trades = []
    ts_col = "ts_event"
    has_ts = ts_col in df.columns
    # W27.5 P-D.5: extract volume once per call; None when column absent (legacy fixtures).
    _vol_np_static: Optional[np.ndarray] = (
        df["volume"].to_numpy() if "volume" in df.columns else None
    )
    _symbol_static: str = getattr(spec, "symbol", None) or "UNKNOWN"

    for _, row in trades_records.iterrows():
        entry_p = float(row["Avg Entry Price"])
        original_exit_p = float(row["Avg Exit Price"])
        size = float(row["Size"])
        direction_str = str(row["Direction"])
        entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0
        original_exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(high_np) - 1)
        # Safety cap: no trade held longer than MAX_HOLD_BARS (~16h on 5m)
        MAX_HOLD_BARS = 200
        if original_exit_idx - entry_idx > MAX_HOLD_BARS:
            original_exit_idx = entry_idx + MAX_HOLD_BARS
        is_short = "Short" in direction_str

        atr_at_entry = float(atr_np[entry_idx]) if entry_idx < len(atr_np) and not np.isnan(atr_np[entry_idx]) else 1.0
        # L3 FIX: Use atr_stop_multiplier from config rather than hardcoded 2.0.
        # The W23-D R-multiple gate depends on this matching the strategy's actual stop multiplier.
        risk_points = min(6.0, atr_at_entry * atr_stop_multiplier)
        # Min breathing room: 2pt for MES/ES (tick_size=0.25), scaled for other instruments
        tick = spec.tick_size if spec else 0.25
        min_trail = max(2.0, tick * 8)  # 8 ticks minimum breathing room

        if is_short:
            initial_stop = entry_p + risk_points
        else:
            initial_stop = entry_p - risk_points

        # Compute structural TP via DOL hierarchy
        # Get HTF data for weekly high/low as BSL/SSL
        htf = None
        if htf_cache and has_ts:
            day_key = str(df[ts_col][entry_idx])[:10]
            htf = htf_cache.get(day_key)

        tp_price = compute_single_tp(
            direction="short" if is_short else "long",
            entry_price=entry_p,
            stop_price=initial_stop,
            nearest_bsl=htf.weekly_high if htf and not is_short else None,
            nearest_ssl=htf.weekly_low if htf and is_short else None,
            nearest_old_high=htf.prev_day_high if htf and not is_short else None,
            nearest_old_low=htf.prev_day_low if htf and is_short else None,
            atr=atr_at_entry,
        )

        # Build managed trade record
        managed = {
            "entry_idx": entry_idx,
            "entry_price": entry_p,
            "original_exit_idx": original_exit_idx,
            "original_exit_price": original_exit_p,
            "size": size,
            "direction": direction_str,
            "risk_points": round(risk_points, 2),
        }

        # If no structural TP gives >= 2R, use original exit (no TP enforcement
        # during backtest — the gate already filtered for quality, and not all
        # strategies have structural data for DOL targets)
        if tp_price is None:
            tp_price = float("inf") if not is_short else float("-inf")
            managed["tp_source"] = "none"
        else:
            managed["tp_source"] = "structural"

        trail_stop = initial_stop
        exit_price = original_exit_p
        exit_idx = original_exit_idx
        exit_reason = "signal"

        # Bar-by-bar simulation
        # F-3 FIX: loop is exclusive of original_exit_idx.
        # On the final bar vectorbt already recorded an exit by signal; if we
        # checked the stop there and it fired we would override a clean signal
        # exit with a stop price — but the position is gone by signal. Use
        # range(..., original_exit_idx) so the last bar is accepted as-is from
        # vectorbt (signal exit price), which is always at the bar close.
        gap_through_stop_count = 0
        for bar in range(entry_idx + 1, original_exit_idx):
            if bar >= len(high_np):
                break

            bar_high = float(high_np[bar])
            bar_low = float(low_np[bar])
            bar_open = float(open_np[bar]) if open_np is not None and bar < len(open_np) else bar_low

            # W27.5 P-D.5: zero-volume trade-critical guard. Holiday/data-gap bars
            # with volume=0 must not produce stop/TP fills. When fail-loud is enabled
            # (default true), raises ZeroVolumeOnTradeCriticalBar; when disabled,
            # caller skips this bar (legacy silent-skip preserved for backward-compat).
            # Pre-checks whether this bar would trigger stop or TP before evaluating.
            if _vol_np_static is not None and bar < len(_vol_np_static):
                _stop_or_tp_candidate = (
                    (not is_short and (bar_low <= trail_stop or bar_high >= tp_price)) or
                    (is_short and (bar_high >= trail_stop or bar_low <= tp_price))
                )
                if _stop_or_tp_candidate:
                    try:
                        _bar_ts = str(df[ts_col][bar]) if has_ts else f"idx={bar}"
                        _skip = check_zero_volume_trade_critical(
                            bar_volume=float(_vol_np_static[bar]),
                            bar_timestamp=_bar_ts,
                            symbol=_symbol_static,
                            attempted_action="stop_or_tp_trigger",
                        )
                        if _skip:
                            # fail-loud disabled — skip this bar's stop/TP eval
                            continue
                    except ZeroVolumeOnTradeCriticalBar:
                        # fail-loud raised — propagate up to backtester caller
                        raise

            # Conservative intra-bar ordering: check stop BEFORE advancing trail.
            # We cannot know if the high or low came first within a bar, so we
            # check stops against the CURRENT trail (not an advanced one).

            # 1. Check trailing/initial stop hit first (conservative)
            # C2 FIX: If bar gapped through the stop (bar_open already past stop),
            # fill at bar_open (worse for trader) rather than the stop price.
            # This prevents silent P&L inflation on gap-down/gap-up bars.
            if not is_short and bar_low <= trail_stop:
                if bar_open < trail_stop:
                    # Gap-down: opened below stop — fill at open (worse)
                    exit_price = bar_open
                    gap_through_stop_count += 1
                else:
                    exit_price = trail_stop
                exit_reason = "trailing_stop" if trail_stop > initial_stop else "stop_loss"
                exit_idx = bar
                break
            elif is_short and bar_high >= trail_stop:
                if bar_open > trail_stop:
                    # Gap-up: opened above stop — fill at open (worse)
                    exit_price = bar_open
                    gap_through_stop_count += 1
                else:
                    exit_price = trail_stop
                exit_reason = "trailing_stop" if trail_stop < initial_stop else "stop_loss"
                exit_idx = bar
                break

            # 2. Check TP hit (full exit)
            if not is_short and bar_high >= tp_price:
                exit_price = tp_price
                exit_reason = "take_profit"
                exit_idx = bar
                break
            elif is_short and bar_low <= tp_price:
                exit_price = tp_price
                exit_reason = "take_profit"
                exit_idx = bar
                break

            # 3. Advance trailing stop for NEXT bar (only after confirming
            #    no stop was hit on this bar)
            if not is_short:
                pnl_points = bar_high - entry_p
            else:
                pnl_points = entry_p - bar_low

            # After 1R: move to breakeven
            if pnl_points >= risk_points:
                be_stop = entry_p
                if not is_short:
                    trail_stop = max(trail_stop, be_stop)
                else:
                    trail_stop = min(trail_stop, be_stop)

            # After 2R: trail 1R behind, min breathing room
            if pnl_points >= risk_points * 2:
                if not is_short:
                    new_stop = bar_high - max(risk_points, min_trail)
                    trail_stop = max(trail_stop, new_stop)
                else:
                    new_stop = bar_low + max(risk_points, min_trail)
                    trail_stop = min(trail_stop, new_stop)

        managed["exit_price"] = exit_price
        managed["exit_idx"] = exit_idx
        managed["exit_reason"] = exit_reason
        managed["trail_stop_final"] = round(trail_stop, 4)
        # C2: track how many times gap-through-stop fired for this trade
        managed["gap_through_stop_count"] = gap_through_stop_count
        managed_trades.append(managed)

    return managed_trades


# ─── Adaptive management helper (Wave 25 Gap B) ───────────────────────────────

def _apply_adaptive_management(
    trades_records,
    high_np: np.ndarray,
    low_np: np.ndarray,
    close_np: np.ndarray,
    atr_np: np.ndarray,
    spec,
    df,
    adaptive_ctx,   # AdaptiveExitContext — required (caller already checked not None)
    open_np: Optional[np.ndarray] = None,
    atr_stop_multiplier: float = 1.5,
) -> list[dict]:
    """Adaptive exit management — Wave 25 Gap B Python implementation.

    Mirrors the TS adaptive-exit-engine.ts semantics for the backtest path.
    Reads exit plans from compute_exit_plan_python() (pure function, no I/O).
    Applies TP1/TP2/runner logic per-bar from the pre-computed ExitPlan.

    Sub-tracks applied:
      W25.12: Liquidity-mapped TP1/TP2 (or R-multiple fallback)
      W25.13: Regime-dependent scaling schedule
      W25.15: Runner trail method from regime (anchored_vwap/developing_poc/chandelier/structure_trail)
      W25.14: Delta-divergence early-exit (25% partial close) — not per-bar in backtest;
              delta feed not available; recorded as delta_div_skipped in managed trade.
      W25.16: Pre-lunch partial (50% at 11:30 ET on RANGE/LOW_LIQ_CHOP/COMPRESSION
              if profit >= threshold_r)

    Hard invariants (CLAUDE.md §4):
      - 15:55 ET hard flatten ALWAYS applies (checked per bar via _is_time_stop)
      - BE+1 tick on TP1 fill ALWAYS applies

    Backtest simplifications vs paper path:
      - Delta-divergence: not computable without live delta feed; always skipped.
        Recorded as delta_div_skipped=True in managed trade audit.
      - anchored_vwap: uses true bar volume from df["volume"] (Wave 26 barVol wiring).
        Cumulative VWAP is anchored from the entry bar using (typical_price * volume) / sum(volume).
        Fallback to structure trail only when volume column absent.
        adaptive_runner_fallback records whether true-volume AVWAP was active.
      - developing_poc: still falls back to structure trail (no intraday VP per bar).
        Recorded as adaptive_runner_fallback=True.
      - chandelier: ATR-based trail, fully wired (no fallback needed).
      - Multi-leg P&L: blended into a single synthetic exit price for metric
        accuracy (tp1_pct @ tp1_price + tp2_pct @ tp2_price + runner_pct @ trail).

    Returns list of managed trade dicts matching _apply_static_styleC_management schema.
    """
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    from src.engine.exits.adaptive_exits import (
        PRE_LUNCH_TRIGGER_REGIMES,
        _is_at_or_after_pre_lunch_et,
        compute_exit_plan_python,
    )
    from src.engine.exits.style_d_handler import _is_time_stop

    managed_trades = []
    ts_col = "ts_event"
    has_ts = ts_col in df.columns

    # Wave 26 barVol wiring: extract volume array for true AVWAP computation.
    # df may be Polars or pandas depending on the caller path.
    try:
        if "volume" in df.columns:
            vol_np: Optional[np.ndarray] = df["volume"].to_numpy()
        else:
            vol_np = None
    except Exception:
        vol_np = None

    liquidity_snapshot = list(adaptive_ctx.liquidity_snapshot) if adaptive_ctx.liquidity_snapshot else []
    regime_default = (adaptive_ctx.regime_at_entry or "UNKNOWN")
    pre_lunch_threshold_r = adaptive_ctx.pre_lunch_threshold_r
    delta_div_threshold = adaptive_ctx.delta_div_threshold

    def _get_bar_ts(bar: int):
        """Return bar timestamp as datetime (UTC) or None."""
        if not has_ts or bar >= len(df):
            return None
        try:
            raw = df[ts_col][bar]
            if isinstance(raw, _dt):
                return raw
            return _dt.fromisoformat(str(raw))
        except Exception:
            return None

    def _bar_et_str(bar_ts_val: _dt) -> str:
        """Convert UTC datetime to 'HH:MM' ET string for _is_time_stop().

        FIX 4 (2026-06-22): Replaced hardcoded UTC-4 arithmetic with the
        DST-correct _dst_correct_et_hour() module-level helper.
        Previous: et_hour = (utc_dt.hour - 4) % 24 → always EDT, wrong in EST.
        New: zoneinfo/pytz America/New_York → correct in both EDT and EST.
        """
        try:
            if bar_ts_val.tzinfo is not None:
                utc_dt = bar_ts_val.astimezone(_tz.utc)
            else:
                utc_dt = bar_ts_val.replace(tzinfo=_tz.utc)
            return _dst_correct_et_hour(utc_dt)
        except Exception:
            return "00:00"

    for _, row in trades_records.iterrows():
        entry_p = float(row["Avg Entry Price"])
        original_exit_p = float(row["Avg Exit Price"])
        size = float(row["Size"])
        direction_str = str(row["Direction"])
        entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0
        original_exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(high_np) - 1)

        # Safety cap (same as static_styleC)
        MAX_HOLD_BARS = 200
        if original_exit_idx - entry_idx > MAX_HOLD_BARS:
            original_exit_idx = entry_idx + MAX_HOLD_BARS
        is_short = "Short" in direction_str
        direction = "short" if is_short else "long"

        atr_at_entry = float(atr_np[entry_idx]) if entry_idx < len(atr_np) and not np.isnan(atr_np[entry_idx]) else 1.0
        risk_points = min(6.0, atr_at_entry * atr_stop_multiplier)
        tick = spec.tick_size if spec else 0.25

        # Initial stop price
        stop_p = entry_p + risk_points if is_short else entry_p - risk_points

        # ── Compute exit plan once at position open ─────────────────────
        # FIX 4 (2026-06-22): Pass the strategy's real symbol from spec instead of
        # hardcoding "MES". MNQ/MCL adaptive strategies were getting MES exit targets
        # (wrong DOL/TP targets). getattr fallback preserves backward-compat when
        # spec is None or doesn't have a symbol attribute.
        _adaptive_symbol = getattr(spec, "symbol", None) or "MES"
        entry_ts = _get_bar_ts(entry_idx) or _dt(2025, 1, 1)
        exit_plan = compute_exit_plan_python(
            entry_price=entry_p,
            stop_price=stop_p,
            direction=direction,
            symbol=_adaptive_symbol,
            bar_ts=entry_ts,
            atr=atr_at_entry,
            regime=regime_default,
            liquidity_snapshot=liquidity_snapshot,
            pre_lunch_threshold_r=pre_lunch_threshold_r,
            delta_div_threshold=delta_div_threshold,
        )

        tp1_price = exit_plan.tp1.price
        tp2_price = exit_plan.tp2.price
        scaling = exit_plan.scaling

        # Simulation state
        tp1_filled = False
        tp2_filled = False
        pre_lunch_fired = False
        exit_price = original_exit_p
        exit_idx = original_exit_idx
        exit_reason = "signal"
        trail_stop = stop_p
        gap_through_stop_count = 0
        min_trail = max(2.0, tick * 8)

        # Wave 26 barVol wiring: AVWAP accumulators anchored at entry bar.
        # Anchored VWAP = sum(typical_price * volume, entry→bar) / sum(volume, entry→bar).
        # Only activated when runner_trail_method == "anchored_vwap" AND vol_np is present.
        avwap_use_true_vol = (
            exit_plan.runner_trail_method == "anchored_vwap"
            and vol_np is not None
            and entry_idx < len(vol_np)
        )
        _avwap_cum_tpv: float = 0.0   # sum(typical_price * volume) since entry
        _avwap_cum_vol: float = 0.0   # sum(volume) since entry

        # ── Bar-by-bar simulation ───────────────────────────────────────
        for bar in range(entry_idx + 1, original_exit_idx):
            if bar >= len(high_np):
                break

            bar_high = float(high_np[bar])
            bar_low = float(low_np[bar])
            bar_open = float(open_np[bar]) if open_np is not None and bar < len(open_np) else (
                bar_low if not is_short else bar_high
            )
            bar_ts_val = _get_bar_ts(bar)

            # ── INVARIANT: 15:55 ET hard flatten ──────────────────────
            if bar_ts_val is not None and _is_time_stop(_bar_et_str(bar_ts_val)):
                exit_price = float(close_np[bar]) if bar < len(close_np) else bar_open
                exit_reason = "time_stop"
                exit_idx = bar
                break

            # ── Stop loss / trailing stop ──────────────────────────────
            if not is_short and bar_low <= trail_stop:
                exit_price = bar_open if bar_open < trail_stop else trail_stop
                if bar_open < trail_stop:
                    gap_through_stop_count += 1
                exit_reason = "trailing_stop" if trail_stop > stop_p else "stop_loss"
                exit_idx = bar
                break
            elif is_short and bar_high >= trail_stop:
                exit_price = bar_open if bar_open > trail_stop else trail_stop
                if bar_open > trail_stop:
                    gap_through_stop_count += 1
                exit_reason = "trailing_stop" if trail_stop < stop_p else "stop_loss"
                exit_idx = bar
                break

            # ── TP1 fill ───────────────────────────────────────────────
            if not tp1_filled:
                tp1_hit = (not is_short and bar_high >= tp1_price) or (is_short and bar_low <= tp1_price)
                if tp1_hit:
                    tp1_filled = True
                    # INVARIANT: BE+1 tick on TP1 fill
                    be_offset = tick
                    if not is_short:
                        trail_stop = max(trail_stop, entry_p + be_offset)
                    else:
                        trail_stop = min(trail_stop, entry_p - be_offset)

            # ── TP2 fill ───────────────────────────────────────────────
            if tp1_filled and not tp2_filled:
                tp2_hit = (not is_short and bar_high >= tp2_price) or (is_short and bar_low <= tp2_price)
                if tp2_hit:
                    tp2_filled = True

            # ── Pre-lunch partial (W25.16) ─────────────────────────────
            if (
                not pre_lunch_fired
                and bar_ts_val is not None
                and regime_default in PRE_LUNCH_TRIGGER_REGIMES
                and _is_at_or_after_pre_lunch_et(bar_ts_val)
            ):
                # Measure current max favorable excursion for this bar
                mfe_points = (bar_high - entry_p) if not is_short else (entry_p - bar_low)
                pnl_r = mfe_points / max(risk_points, 0.01)
                if pnl_r >= pre_lunch_threshold_r:
                    pre_lunch_fired = True
                    # In backtest: 50% partial is approximated; position continues
                    # trailing with tighter stop (BE + 0.5R per W25.16)
                    half_r_offset = risk_points * 0.5
                    if not is_short:
                        new_trail = entry_p + half_r_offset
                        trail_stop = max(trail_stop, new_trail)
                    else:
                        new_trail = entry_p - half_r_offset
                        trail_stop = min(trail_stop, new_trail)

            # ── Accumulate AVWAP state (Wave 26 barVol wiring) ────────────
            # Update cumulative VWAP accumulators every bar from entry onward,
            # so that when TP2 fills we already have the anchored VWAP ready.
            if avwap_use_true_vol and bar < len(vol_np):  # type: ignore[index]
                bar_vol = float(vol_np[bar])  # type: ignore[index]
                typical_price = (bar_high + bar_low + float(close_np[bar])) / 3.0
                _avwap_cum_tpv += typical_price * bar_vol
                _avwap_cum_vol += bar_vol

            # ── Advance runner trail after TP2 ─────────────────────────
            if tp2_filled:
                runner_method = exit_plan.runner_trail_method

                if runner_method == "anchored_vwap" and avwap_use_true_vol and _avwap_cum_vol > 0:
                    # True AVWAP trail: price must stay on correct side of the
                    # volume-weighted average anchored at the entry bar.
                    avwap_price = _avwap_cum_tpv / _avwap_cum_vol
                    # Stop trails to AVWAP (with tick offset so we don't exit at exact AVWAP).
                    if not is_short:
                        new_trail = avwap_price - tick
                        trail_stop = max(trail_stop, new_trail)
                    else:
                        new_trail = avwap_price + tick
                        trail_stop = min(trail_stop, new_trail)

                elif runner_method == "chandelier":
                    # Chandelier: ATR-based trail below the most recent bar high (longs).
                    atr_at_bar = float(atr_np[bar]) if bar < len(atr_np) and not np.isnan(atr_np[bar]) else atr_at_entry
                    if not is_short:
                        new_trail = bar_high - (2.0 * atr_at_bar)
                        trail_stop = max(trail_stop, new_trail)
                    else:
                        new_trail = bar_low + (2.0 * atr_at_bar)
                        trail_stop = min(trail_stop, new_trail)

                else:
                    # structure_trail / developing_poc / fallback:
                    # Use bar_low/bar_high as proxy for swing level (developing_poc not
                    # computable per-bar in backtest — recorded as fallback in audit).
                    if not is_short:
                        new_trail = bar_high - max(risk_points, min_trail)
                        trail_stop = max(trail_stop, new_trail)
                    else:
                        new_trail = bar_low + max(risk_points, min_trail)
                        trail_stop = min(trail_stop, new_trail)

        # ── Blended exit price ──────────────────────────────────────────
        # Multi-leg scaling: approximate P&L from separate lot fills.
        if exit_reason in ("stop_loss", "trailing_stop", "time_stop"):
            # Stop / time-stop always overrides scale-out — single price
            final_exit = exit_price
        elif tp1_filled and tp2_filled:
            runner_exit = float(close_np[exit_idx]) if exit_idx < len(close_np) else tp2_price
            final_exit = (
                scaling.tp1_pct * tp1_price
                + scaling.tp2_pct * tp2_price
                + scaling.runner_pct * runner_exit
            )
            exit_reason = "take_profit"
        elif tp1_filled:
            runner_exit = float(close_np[exit_idx]) if exit_idx < len(close_np) else exit_price
            final_exit = (
                scaling.tp1_pct * tp1_price
                + (scaling.tp2_pct + scaling.runner_pct) * runner_exit
            )
            exit_reason = "take_profit"
        else:
            final_exit = exit_price

        managed = {
            "entry_idx": entry_idx,
            "entry_price": entry_p,
            "original_exit_idx": original_exit_idx,
            "original_exit_price": original_exit_p,
            "size": size,
            "direction": direction_str,
            "risk_points": round(risk_points, 2),
            "exit_price": final_exit,
            "exit_idx": exit_idx,
            "exit_reason": exit_reason,
            "trail_stop_final": round(trail_stop, 4),
            "gap_through_stop_count": gap_through_stop_count,
            # Adaptive-specific metadata (audit trail)
            "adaptive_exit_engine": True,
            "adaptive_tp1_price": tp1_price,
            "adaptive_tp2_price": tp2_price,
            "adaptive_tp1_source": exit_plan.tp1.source,
            "adaptive_tp2_source": exit_plan.tp2.source,
            "adaptive_tp1_filled": tp1_filled,
            "adaptive_tp2_filled": tp2_filled,
            "adaptive_regime": regime_default,
            "adaptive_scaling": f"{scaling.tp1_pct:.0%}/{scaling.tp2_pct:.0%}/{scaling.runner_pct:.0%}",
            "adaptive_runner_method": exit_plan.runner_trail_method,
            # Wave 26 barVol: avwap_use_true_vol=True means real AVWAP was computed.
            # False means fallback (developing_poc or missing volume column).
            "adaptive_runner_fallback": not avwap_use_true_vol,
            "adaptive_avwap_true_vol": avwap_use_true_vol,
            "adaptive_pre_lunch_fired": pre_lunch_fired,
            "delta_div_skipped": True,   # delta-divergence requires live delta feed
        }
        managed_trades.append(managed)

    return managed_trades


def shift_higher_tf_columns(
    df: pl.DataFrame,
    higher_tf_columns: list[str],
) -> pl.DataFrame:
    """Apply shift(1) to higher-TF indicator columns to prevent look-ahead bias.

    When higher-TF indicators (daily SMA, 4H ATR, etc.) are merged into a
    lower-TF DataFrame for signal filtering, those columns must reflect the
    PREVIOUS completed higher-TF bar, not the current incomplete one.

    Args:
        df: DataFrame containing merged higher-TF columns
        higher_tf_columns: List of column names from the higher timeframe

    Returns:
        DataFrame with specified columns shifted forward by 1 row
    """
    shift_exprs = [
        pl.col(col).shift(1).alias(col) for col in higher_tf_columns
        if col in df.columns
    ]
    if shift_exprs:
        df = df.with_columns(shift_exprs)
    return df

# ─── Timeframe → pandas freq mapping ────────────────────────────────
# vectorbt uses freq to annualize Sharpe. Hardcoding "1D" deflates
# Sharpe ~5x for intraday data because it assumes 1 bar = 1 day.
FREQ_MAP = {
    # Engine-native names
    "1min": "1min",
    "5min": "5min",
    "15min": "15min",
    "30min": "30min",
    "1hour": "1h",
    "1h": "1h",
    "4hour": "4h",
    "4h": "4h",
    "daily": "1D",
    "1D": "1D",
    # DSL Timeframe enum aliases (M2 fix — strategy_schema.py uses these)
    # Without these, intraday strategies fall back to "1D" which deflates Sharpe ~5x
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1d": "1D",
}


def _resolve_freq(timeframe: str) -> str:
    """Resolve strategy timeframe to pandas freq alias for vectorbt."""
    return FREQ_MAP.get(timeframe, "1D")


def _extract_atr_period(config: StrategyConfig) -> int:
    """Find ATR period from strategy indicators, default 14."""
    for ind in config.indicators:
        if ind.type == "atr":
            return ind.period
    return 14


def _compute_daily_pnls(
    equity: np.ndarray,
    index=None,
    starting_capital: float = 50_000.0,
    ts_et_index=None,
) -> list[dict]:
    """Compute daily P&L from equity curve, aggregated by calendar day.

    For intraday data (e.g. 15min), multiple bars share the same calendar
    date. We take the last equity value per day and diff between consecutive
    days to get true daily P&L.

    F-11 FIX: The original loop started at range(1, ...) which dropped the first
    day's P&L entirely. For a 1-year backtest, day 0 P&L was always zero in the
    records even if trades fired. Fix: prepend the first day's P&L computed as
    (first_day_equity - starting_capital), where starting_capital is the equity
    value before any bar touches the equity curve.

    MED #2 (Wave 27.5 Pass D.1) — DST-aware aggregation:
    When ts_et_index is provided (Eastern Time strings from the ts_et column),
    date strings are read directly from it — no UTC+offset arithmetic needed,
    so DST spring-forward and fall-back transitions are handled correctly.
    ts_et is set by data_loader.py and is always in ET regardless of season.

    Args:
        equity:           Cumulative equity curve (one value per bar).
        index:            Bar timestamps (pandas DatetimeIndex or similar).
                          Used when ts_et_index is None.
        starting_capital: Equity baseline before any trades.
        ts_et_index:      Optional list/array of Eastern Time strings
                          (length must match equity).  When present, takes
                          priority over index for date grouping.

    Returns:
        list of {"date": "YYYY-MM-DD", "pnl": float} dicts
    """
    if len(equity) < 2:
        return []

    # If no datetime index, fall back to per-bar diff (daily data)
    if (ts_et_index is None) and (index is None or len(index) == 0 or not hasattr(index[0], "date")):
        pnls = np.diff(equity)
        return [{"date": None, "pnl": round(float(p), 2)} for p in pnls]

    # MED #2: Prefer ts_et (Eastern Time) for date grouping — zero DST ambiguity.
    # ts_et strings are already in ET format ("YYYY-MM-DDTHH:MM:SS" or similar),
    # so slicing [:10] gives the ET calendar date directly.
    if ts_et_index is not None and len(ts_et_index) == len(equity):
        daily: dict[str, float] = {}
        for i, v in enumerate(equity):
            ts_str = str(ts_et_index[i])
            day_str = ts_str[:10] if len(ts_str) >= 10 else ts_str
            daily[day_str] = float(v)
    else:
        # Group equity by CME trading day — take last value per trading day.
        # C-7 FIX: CME futures trade on a 5 PM ET → 5 PM ET cycle. Using UTC calendar
        # date misattributes bars timestamped 5 PM–midnight ET to the wrong session date.
        # For example, a 5:30 PM ET bar belongs to the NEXT CME trading day, not today.
        #
        # Rule: if bar's ET hour >= 17, it belongs to the NEXT calendar day's session.
        # Implementation: try to use pandas tz_convert("America/New_York") when the
        # index has timezone info. Fall back to UTC calendar date when tz info is absent
        # (e.g. daily data, synthetic test data) to preserve backward compatibility.
        from datetime import timedelta as _td
        daily = {}
        for i, v in enumerate(equity):
            ts = index[i]
            try:
                # Attempt CME trading-day calculation using ET timezone.
                if hasattr(ts, "tz_convert") and ts.tzinfo is not None:
                    et_ts = ts.tz_convert("America/New_York")
                    if et_ts.hour >= 17:
                        trading_day = (et_ts + _td(days=1)).date()
                    else:
                        trading_day = et_ts.date()
                    day_str = str(trading_day)
                elif hasattr(ts, "date"):
                    # No timezone info — fall back to UTC calendar date (daily data path).
                    day_str = str(ts.date())
                else:
                    day_str = str(ts)
            except Exception:
                # Defensive fallback: any conversion failure reverts to UTC string slice.
                day_str = str(ts)[:10] if len(str(ts)) >= 10 else str(ts)
            daily[day_str] = float(v)

    sorted_days = sorted(daily.items())
    if len(sorted_days) < 1:
        return []

    pnls = []
    # F-11 FIX: Prepend first day's P&L anchored to starting_capital baseline.
    # Previously range(1, ...) silently dropped this entry; day 0 trades were invisible
    # in daily analytics, Sharpe, and recency scoring.
    first_date_str = sorted_days[0][0]
    first_day_pnl = sorted_days[0][1] - starting_capital
    pnls.append({"date": first_date_str, "pnl": round(first_day_pnl, 2)})

    for i in range(1, len(sorted_days)):
        date_str = sorted_days[i][0]
        pnl = sorted_days[i][1] - sorted_days[i - 1][1]
        pnls.append({"date": date_str, "pnl": round(pnl, 2)})
    return pnls


def _compute_monthly_returns(equity: np.ndarray, index) -> list[dict]:
    """Compute monthly P&L from equity curve for heatmap chart.

    Returns list of {year, month, pnl} entries.
    """
    if len(equity) < 2:
        return []

    # Group equity by (year, month), take first and last value per month
    monthly: dict[tuple[int, int], list[float]] = {}
    for i, v in enumerate(equity):
        if hasattr(index[i], "year"):
            key = (index[i].year, index[i].month)  # 1-indexed month (1-12)
        else:
            continue
        if key not in monthly:
            monthly[key] = [float(v), float(v)]
        else:
            monthly[key][1] = float(v)  # keep updating last value

    results = []
    for (year, month), (first, last) in sorted(monthly.items()):
        pnl = last - first
        results.append({"year": year, "month": month, "pnl": round(pnl, 2)})
    return results


def _aggregate_equity_daily(equity: np.ndarray, index, ts_et_index=None) -> list[dict]:
    """Aggregate intraday equity to one point per calendar day (last value).

    For 15-min data, multiple bars share the same date. Lightweight-charts
    requires unique, ascending time values. Take the last (closing) value
    per calendar day.

    MED #2 (Wave 27.5 Pass D.1) — DST-aware aggregation:
    When ts_et_index is provided, date strings are read directly from Eastern
    Time strings — no UTC arithmetic, no DST off-by-one on transition days.
    """
    if len(equity) == 0:
        return []

    daily: dict[str, float] = {}
    if ts_et_index is not None and len(ts_et_index) == len(equity):
        # DST-safe path: ts_et already in Eastern Time.
        for i, v in enumerate(equity):
            ts_str = str(ts_et_index[i])
            day_str = ts_str[:10] if len(ts_str) >= 10 else ts_str
            daily[day_str] = round(float(v), 2)
    else:
        for i, v in enumerate(equity):
            if hasattr(index[i], "date"):
                day_str = str(index[i].date())
            else:
                day_str = str(index[i])
            daily[day_str] = round(float(v), 2)  # last value wins

    return [{"time": k, "value": v} for k, v in daily.items()]


# ─── DST Boundary Detection (MED #2, Wave 27.5 Pass D.1) ──────────────────
# 2 days per year, DST transitions may shift ET offsets (UTC-5 ↔ UTC-4).
# Detect whether a backtest spans a spring-forward or fall-back boundary so
# the audit log can record which transition was encountered.
# All arithmetic is calendar-only — no tz libraries required.

_US_DST_TRANSITIONS: list[tuple[str, bool]] = [
    # (date_iso, spring_forward)
    # 2023
    ("2023-03-12", True),  ("2023-11-05", False),
    # 2024
    ("2024-03-10", True),  ("2024-11-03", False),
    # 2025
    ("2025-03-09", True),  ("2025-11-02", False),
    # 2026
    ("2026-03-08", True),  ("2026-11-01", False),
    # 2027
    ("2027-03-14", True),  ("2027-11-07", False),
    # 2028
    ("2028-03-12", True),  ("2028-11-05", False),
]


def _detect_dst_transitions(
    ts_et_list: list,
) -> list[dict]:
    """Return DST transitions that fall within the date range of ts_et_list.

    Args:
        ts_et_list: List of ET timestamp strings (from ts_et column).

    Returns:
        List of audit dicts, one per transition within the date range.
        Each dict: { transition_date, spring_forward, hour_skipped_or_repeated }
    """
    if not ts_et_list:
        return []
    try:
        first_date = str(ts_et_list[0])[:10]
        last_date = str(ts_et_list[-1])[:10]
    except Exception:
        return []

    result = []
    for date_iso, spring_forward in _US_DST_TRANSITIONS:
        if first_date <= date_iso <= last_date:
            result.append({
                "transition_date": date_iso,
                "spring_forward": spring_forward,
                # spring-forward skips 02:00–02:59 ET; fall-back repeats 01:00–01:59 ET
                "hour_skipped_or_repeated": "02:00-02:59 ET (skipped)" if spring_forward else "01:00-01:59 ET (repeated)",
            })
    return result


MINIMUM_TRADES = 500
MINIMUM_TRADES_PER_SIDE = 100


def _wilson_ci(wins: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score confidence interval for a proportion (no scipy needed)."""
    if total == 0:
        return (0.0, 0.0)
    p = wins / total
    denom = 1 + z ** 2 / total
    center = (p + z ** 2 / (2 * total)) / denom
    margin = z * ((p * (1 - p) / total + z ** 2 / (4 * total ** 2)) ** 0.5) / denom
    return (round(max(0.0, center - margin), 4), round(min(1.0, center + margin), 4))


def _compute_long_short_split(trades_list: list[dict]) -> dict:
    """Split metrics by direction -- catches bull-market bias."""
    longs = [t for t in trades_list if str(t.get("Direction", t.get("direction", ""))).lower().startswith("long")]
    shorts = [t for t in trades_list if str(t.get("Direction", t.get("direction", ""))).lower().startswith("short")]

    def _side_metrics(trades: list[dict]) -> dict:
        if not trades:
            return {"trades": 0, "win_rate": 0, "pnl": 0, "avg_winner": 0, "avg_loser": 0, "profit_factor": 0, "sharpe": 0}
        pnls = [float(t.get("PnL", t.get("pnl", 0))) for t in trades]
        winners = [p for p in pnls if p > 0]
        losers = [p for p in pnls if p < 0]
        pnl_arr = np.array(pnls)
        side_sharpe = float(np.mean(pnl_arr) / np.std(pnl_arr, ddof=1) * np.sqrt(252)) if len(pnl_arr) > 1 and np.std(pnl_arr, ddof=1) > 0 else 0.0
        return {
            "trades": len(trades),
            "win_rate": round(len(winners) / len(trades), 4),
            "pnl": round(sum(pnls), 2),
            "avg_winner": round(sum(winners) / len(winners), 2) if winners else 0,
            "avg_loser": round(sum(losers) / len(losers), 2) if losers else 0,
            "profit_factor": round(sum(winners) / abs(sum(losers)), 4) if losers and sum(losers) != 0 else 999.99,
            "sharpe": round(side_sharpe, 4),
        }

    long_metrics = _side_metrics(longs)
    short_metrics = _side_metrics(shorts)

    warnings: list[str] = []
    if short_metrics["trades"] > 20 and short_metrics["win_rate"] < 0.40:
        warnings.append("Long-biased strategy — short side win rate < 40%. May fail in bear markets.")
    if long_metrics["trades"] > 20 and short_metrics["trades"] > 20:
        if long_metrics["pnl"] > 0 and short_metrics["pnl"] < 0:
            warnings.append("Short side is net negative. Long side carrying the strategy.")

    # QuantVue-style bidirectional symmetry diagnostic. Per V2 deck page 10:
    # they prominently display long_wr (80.3%) vs short_wr (78.5%) as a portfolio
    # quality marker — within 2pp == genuine bidirectional alpha. > 10pp gap == directional
    # bias that may mask a long-only beta tilt.
    asymmetry_pp = round(abs(long_metrics["win_rate"] - short_metrics["win_rate"]) * 100, 2)
    if long_metrics["trades"] >= 30 and short_metrics["trades"] >= 30:
        if asymmetry_pp <= 5:
            asymmetry_flag = "BALANCED"
        elif asymmetry_pp <= 10:
            asymmetry_flag = "SLIGHT_TILT"
        else:
            asymmetry_flag = "BIASED"
    else:
        asymmetry_flag = "INSUFFICIENT_DATA"

    if asymmetry_flag == "BIASED":
        warnings.append(
            f"Directional asymmetry: long WR {long_metrics['win_rate']*100:.1f}% vs "
            f"short WR {short_metrics['win_rate']*100:.1f}% (gap {asymmetry_pp}pp). "
            f"Edge may not be bidirectional."
        )

    return {
        "long": long_metrics,
        "short": short_metrics,
        "directional_asymmetry_pp": asymmetry_pp,
        "asymmetry_flag": asymmetry_flag,
        "warnings": warnings,
    }


# ─── Bar Count Validation ─────────────────────────────────────────
# L1 FIX: Use Globex session bar counts (23h/day for E-mini futures).
# RTH-only figures (390min = 78 5min bars) are wrong for futures which trade
# nearly 24h. data_loader.py:323 uses 172 5min bars for Globex.
# Aligned here to eliminate false "too few bars" warnings.
BARS_PER_DAY = {
    "1min": 1380, "5min": 172, "15min": 92, "30min": 46,
    "1hour": 23, "1h": 23, "4hour": 6, "4h": 6,
    "daily": 1, "1D": 1,
}


def _validate_bar_count(
    df: pl.DataFrame,
    timeframe: str,
    start_date: str,
    end_date: str,
) -> None:
    """Warn if bar count deviates >10% from expected for date range + timeframe.

    Uses business-day estimate: calendar_days * 252/365.
    Issues warnings.warn (not raise) so backtests continue but anomalies are flagged.
    """
    import warnings
    from datetime import datetime as _dt

    if timeframe not in BARS_PER_DAY:
        return

    _start_dt = _dt.strptime(start_date, "%Y-%m-%d") if isinstance(start_date, str) else start_date
    _end_dt = _dt.strptime(end_date, "%Y-%m-%d") if isinstance(end_date, str) else end_date
    _calendar_days = (_end_dt - _start_dt).days
    _trading_days = int(_calendar_days * 252 / 365)
    expected = _trading_days * BARS_PER_DAY[timeframe]
    actual = len(df)

    if expected > 0 and abs(actual - expected) / expected > 0.10:
        warnings.warn(
            f"Bar count mismatch: expected ~{expected}, got {actual}. "
            f"Wrong timeframe data? (timeframe={timeframe})"
        )


def _build_run_receipt(config: "StrategyConfig", dataset_hash: str = "") -> dict:
    """Build a run receipt for reproducibility tracking."""
    import hashlib
    import subprocess

    # Git commit
    try:
        git_commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception as exc:
        print(f"WARNING: Failed to get git commit: {exc}", file=sys.stderr)
        git_commit = "unknown"

    # Config hash
    if hasattr(config, "model_dump_json"):
        config_hash = hashlib.sha256(config.model_dump_json().encode()).hexdigest()
    else:
        config_hash = hashlib.sha256(json.dumps(config, sort_keys=True, default=str).encode()).hexdigest()

    # Engine version
    engine_version = "unknown"
    try:
        from importlib.metadata import version as pkg_version
        engine_version = pkg_version("trading-forge")
    except Exception as exc:
        print(f"WARNING: Failed to get engine version: {exc}", file=sys.stderr)

    # Code hash: hash the backtester source for reproducibility
    try:
        source_path = Path(__file__).resolve()
        code_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()[:12]
    except Exception as exc:
        print(f"WARNING: Failed to compute code hash: {exc}", file=sys.stderr)
        code_hash = "unknown"

    # E7.3: determinism_verified was hardcoded False — meaningless and misleading.
    # New behavior: set True only when TF_VERIFY_DETERMINISM=1 env var is set AND
    # the caller has already run a second identical backtest and compared hashes.
    # At receipt-build time, we record whether determinism verification was requested.
    # The actual two-run comparison happens at the caller level when the env var is set.
    # Default: False (verification not run — second run is expensive, skip in production).
    # To enable: set TF_VERIFY_DETERMINISM=1 in env; the run_backtest() caller will
    # run the backtest twice, compare JSON output hashes, and set determinism_verified=True.
    import os
    determinism_requested = os.environ.get("TF_VERIFY_DETERMINISM", "0") == "1"

    return {
        "engine_version": engine_version,  # Fix 2: was hardcoded "2.0"; now uses importlib.metadata result
        "git_commit": git_commit,
        "code_hash": code_hash,
        "config_hash": config_hash,
        "dataset_hash": dataset_hash[:12] if len(dataset_hash) > 12 else dataset_hash,
        "random_seed": 42,
        "numpy_version": np.__version__,
        "polars_version": pl.__version__,
        "python_version": sys.version.split()[0],
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # determinism_verified=True is set by run_backtest() after second-run comparison
        # when TF_VERIFY_DETERMINISM=1. False = not verified this run (default).
        "determinism_verified": False,
        "determinism_verification_requested": determinism_requested,
    }


def _apply_max_trades_per_day(
    long_entries: np.ndarray,
    short_entries: np.ndarray,
    timestamps: np.ndarray,
    max_trades: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Suppress entries beyond max_trades per calendar day.

    Counts long + short entries combined per day. Once the daily limit is
    reached, all subsequent entries that day are masked out. Earlier entries
    within the day are kept (first-come, first-served).

    Args:
        long_entries: Boolean array of long entry signals (post-roll)
        short_entries: Boolean array of short entry signals (post-roll)
        timestamps: Array of datetime-like values (ts_event or ts_et)
        max_trades: Maximum entries per calendar day (0 = unlimited)

    Returns:
        (filtered_long, filtered_short) — modified copies
    """
    if max_trades <= 0:
        return long_entries, short_entries

    filtered_long = long_entries.copy()
    filtered_short = short_entries.copy()
    n = len(long_entries)

    # Extract date for each bar
    daily_counts: dict[str, int] = {}
    suppressed = 0

    for i in range(n):
        has_long = bool(filtered_long[i])
        has_short = bool(filtered_short[i])
        if not has_long and not has_short:
            continue

        # Get calendar date string from timestamp
        ts = timestamps[i]
        try:
            day_key = str(ts)[:10]  # "YYYY-MM-DD" from any datetime-like
        except Exception:
            continue

        count = daily_counts.get(day_key, 0)

        # F-9 FIX: Both long and short branches were writing daily_counts independently,
        # causing a double-write when both signals fire on the same bar (same-bar L+S).
        # Pattern before: long writes count+1, then short sees the old local `count`
        # and also writes count+1 — net result: two fills counted as one.
        # Fix: accumulate in local var and write ONCE after both branches.
        new_count = count

        if has_long:
            if new_count < max_trades:
                new_count += 1
            else:
                filtered_long[i] = False
                suppressed += 1

        if has_short:
            if new_count < max_trades:
                new_count += 1
            else:
                filtered_short[i] = False
                suppressed += 1

        # Single write after both branches so same-bar L+S is counted correctly.
        daily_counts[day_key] = new_count

    if suppressed > 0:
        print(
            f"max_trades_per_day={max_trades}: suppressed {suppressed} entries",
            file=sys.stderr,
        )

    return filtered_long, filtered_short


# ─── Wave 21 E.3 — Stop ceiling per symbol ───────────────────────────────────
# Per CLAUDE.md §4: structural stops have a CEILING per instrument.
# If stop_distance > ceiling → SKIP THE TRADE (never clamp).
# MCL ceiling is 0.25 points (25 ticks × $0.01/tick = $0.25/pt).
_STOP_CEILING_TABLE: dict[str, float] = {
    "MES": 14.0,
    "ES":  14.0,   # micro alias
    "MNQ": 40.0,
    "NQ":  40.0,   # micro alias
    "MCL": 0.25,
    "CL":  0.25,   # micro alias
}
_STOP_CEILING_DEFAULT: float = 14.0  # fallback to MES ceiling


def _get_stop_ceiling_for_symbol(symbol: str) -> float:
    """Return the maximum allowed stop distance (in points) for a given symbol.

    Per CLAUDE.md §4:
        MES / ES  → 14 points
        MNQ / NQ  → 40 points
        MCL / CL  → 0.25 points (25 ticks)

    Unknown symbols fall back to the MES default (14 points).
    """
    return _STOP_CEILING_TABLE.get(symbol.upper(), _STOP_CEILING_DEFAULT)


def _apply_dsl_stop_loss_and_time_stop(
    entry_long: np.ndarray,
    exit_long: np.ndarray,
    entry_short: np.ndarray,
    exit_short: np.ndarray,
    high_np: np.ndarray,
    low_np: np.ndarray,
    atr_np: np.ndarray,
    timestamps: list | np.ndarray,
    stop_multiplier: float = 1.5,
    symbol: str = "MES",
    close_np: Optional[np.ndarray] = None,
    ts_et_timestamps: Optional[list] = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict]:
    """Enforce ATR stop ceiling and 15:55 ET time-stop for DSL strategies.

    Wave 21 E.3/E.5 reconstruction.

    UNCONDITIONAL — always applied for ALL DSL strategies regardless of whether
    the exit expression is a sentinel or contains real signal values.
    (Pre-Wave-21 root cause: was gated by `if exit_long_is_sentinel`, allowing
    real-exit strategies to bypass the stop entirely.)

    E.3 — Stop ceiling enforcement:
        stop_distance = stop_multiplier × ATR[bar]
        If stop_distance > ceiling_for_symbol → SKIP entry (set to False).
        Never clamp — skipping is conservative and avoids oversizing.

    E.5 — 15:55 ET time-stop:
        Any open long/short position is closed at the 15:55 ET bar.
        Both long and short sides are handled.
        Fires unconditionally — no strategy config required.

    Returns:
        5-tuple (entry_long_out, exit_long_out, entry_short_out, exit_short_out, metadata)
        metadata keys:
            skipped_trades: list[dict] — each skip records {bar, direction, stop_dist, ceiling}
            atr_stop_exits: int — number of ATR-based exit signals set
            time_stop_exits: int — number of 15:55 ET time-stop exit signals set
    """
    ceiling = _get_stop_ceiling_for_symbol(symbol)

    entry_long_out = entry_long.copy()
    exit_long_out = exit_long.copy()
    entry_short_out = entry_short.copy()
    exit_short_out = exit_short.copy()

    n = len(entry_long)
    metadata: dict = {
        "skipped_trades": [],
        "atr_stop_exits": 0,
        "time_stop_exits": 0,
    }

    # Track position state for ATR stop and time-stop
    in_long = False
    long_entry_price: float = 0.0
    long_stop_price: float = 0.0
    in_short = False
    short_entry_price: float = 0.0
    short_stop_price: float = 0.0

    for i in range(n):
        ts_str = str(timestamps[i]) if timestamps is not None and i < len(timestamps) else ""
        atr = float(atr_np[i]) if not np.isnan(atr_np[i]) else 0.0
        stop_dist = stop_multiplier * atr

        # ── E.5: 15:55 ET time-stop ────────────────────────────────
        # H1 FIX: Use ts_et column for DST-safe time comparison when available.
        # Falling back to string-searching ts_event (UTC) is fragile — ET offsets
        # change between EST (UTC-5) and EDT (UTC-4), making "15:55" in UTC unreliable.
        # With ts_et, 15:55 ET is always 15:55 in the string regardless of DST.
        # HARD FAIL: if ts_et_timestamps was passed (signal that ts_et is available)
        # but ts_et value is absent for bar i, raise ValueError — caller bug.
        if ts_et_timestamps is not None:
            if i < len(ts_et_timestamps) and ts_et_timestamps[i] is not None:
                et_str = str(ts_et_timestamps[i])
                is_1555 = "15:55" in et_str
            elif i < len(ts_et_timestamps):
                raise ValueError(
                    f"H1: ts_et_timestamps was provided but bar {i} has None value. "
                    f"ts_et column must be fully populated when supplied."
                )
            else:
                # ts_et_timestamps shorter than signal array — defensive fallback
                is_1555 = "15:55" in ts_str
        else:
            # Legacy path: ts_et not available, fall back to UTC string search.
            # This is ambiguous across DST transitions but preserves backward compat.
            is_1555 = "15:55" in ts_str
        if is_1555:
            if in_long:
                exit_long_out[i] = True
                metadata["time_stop_exits"] += 1
                in_long = False
            if in_short:
                exit_short_out[i] = True
                metadata["time_stop_exits"] += 1
                in_short = False

        # ── E.3: stop ceiling enforcement on new entries ────────────
        # Check long entry
        if bool(entry_long_out[i]) and not in_long:
            if stop_dist > ceiling:
                # SKIP — stop too wide
                entry_long_out[i] = False
                metadata["skipped_trades"].append({
                    "bar": i,
                    "direction": "long",
                    "stop_dist": round(stop_dist, 4),
                    "ceiling": ceiling,
                    "reason": "stop_too_wide",
                    "ts": ts_str,
                })
            else:
                # Accept entry — record position state for ATR stop tracking.
                # C3 FIX: use close_np[i] (bar close) as the entry reference price,
                # NOT high_np[i]. The previous use of high_np inflated the stop price
                # for longs, making breaches look wider than they were.
                _long_ep = float(close_np[i]) if not np.isnan(close_np[i]) else 0.0
                _long_sp = _long_ep - stop_dist
                # C-6 FIX: gap-down bars can produce a phantom entry that immediately
                # stops out on the same bar. If the bar's low already violates the
                # computed stop level, skip the entry entirely — entering a position
                # that breaches its own stop on the entry bar is not a valid fill.
                _bar_low_l = float(low_np[i]) if not np.isnan(low_np[i]) else float("inf")
                if _bar_low_l < _long_sp:
                    entry_long_out[i] = False
                    metadata["skipped_trades"].append({
                        "bar": i,
                        "direction": "long",
                        "stop_dist": round(stop_dist, 4),
                        "ceiling": ceiling,
                        "reason": "entry_skipped_intrabar_stop_breach",
                        "entry_price": round(_long_ep, 4),
                        "stop_price": round(_long_sp, 4),
                        "bar_low": round(_bar_low_l, 4),
                        "ts": ts_str,
                    })
                    print(
                        f"AUDIT entry_skipped_intrabar_stop_breach bar={i} dir=long "
                        f"low={_bar_low_l:.4f} < stop={_long_sp:.4f} ts={ts_str}",
                        file=sys.stderr,
                    )
                else:
                    in_long = True
                    long_entry_price = _long_ep  # noqa: F841
                    long_stop_price = _long_sp

        # Check short entry
        if bool(entry_short_out[i]) and not in_short:
            if stop_dist > ceiling:
                entry_short_out[i] = False
                metadata["skipped_trades"].append({
                    "bar": i,
                    "direction": "short",
                    "stop_dist": round(stop_dist, 4),
                    "ceiling": ceiling,
                    "reason": "stop_too_wide",
                    "ts": ts_str,
                })
            else:
                # C3 FIX: use close_np[i] for short entry reference (mirror of long fix).
                _short_ep = float(close_np[i]) if not np.isnan(close_np[i]) else 0.0
                _short_sp = _short_ep + stop_dist
                # C-6 FIX: mirror of long phantom-entry guard.
                # Gap-up bars can fire a short entry that immediately stops out.
                _bar_high_s = float(high_np[i]) if not np.isnan(high_np[i]) else 0.0
                if _bar_high_s > _short_sp:
                    entry_short_out[i] = False
                    metadata["skipped_trades"].append({
                        "bar": i,
                        "direction": "short",
                        "stop_dist": round(stop_dist, 4),
                        "ceiling": ceiling,
                        "reason": "entry_skipped_intrabar_stop_breach",
                        "entry_price": round(_short_ep, 4),
                        "stop_price": round(_short_sp, 4),
                        "bar_high": round(_bar_high_s, 4),
                        "ts": ts_str,
                    })
                    print(
                        f"AUDIT entry_skipped_intrabar_stop_breach bar={i} dir=short "
                        f"high={_bar_high_s:.4f} > stop={_short_sp:.4f} ts={ts_str}",
                        file=sys.stderr,
                    )
                else:
                    in_short = True
                    short_entry_price = _short_ep  # noqa: F841
                    short_stop_price = _short_sp

        # ── ATR stop fires: track when stop price is breached ───────
        if in_long and not bool(exit_long_out[i]):
            bar_low = float(low_np[i]) if not np.isnan(low_np[i]) else float("inf")
            if bar_low < long_stop_price:
                exit_long_out[i] = True
                in_long = False
                metadata["atr_stop_exits"] += 1

        if in_short and not bool(exit_short_out[i]):
            bar_high = float(high_np[i]) if not np.isnan(high_np[i]) else 0.0
            if bar_high > short_stop_price:
                exit_short_out[i] = True
                in_short = False
                metadata["atr_stop_exits"] += 1

        # ── Track position exit via existing exit signals ────────────
        if in_long and bool(exit_long_out[i]):
            in_long = False
        if in_short and bool(exit_short_out[i]):
            in_short = False

    return entry_long_out, exit_long_out, entry_short_out, exit_short_out, metadata


# ─── Wave 21 E.4 — Account-ruin / DLL halt ──────────────────────────────────
# Per CLAUDE.md §4:
#   Personal DLL = 67% of firm DLL → HALT new entries for session
#   95% of firm DLL → FORCE CLOSE all positions
#
# Implementation uses conservative ATR-based P&L estimate per entry
# (worst-case: full stop hit at 1.5×ATR × contracts × point_value).
# This is fail-safe: fires earlier than actual DLL would.

def _apply_dll_halt_to_entries(
    long_entries: np.ndarray,
    short_entries: np.ndarray,
    exit_long: np.ndarray,
    exit_short: np.ndarray,
    high_np: np.ndarray,
    low_np: np.ndarray,
    close_np: np.ndarray,
    atr_np: np.ndarray,
    timestamps: np.ndarray,
    point_value: float,
    sizes: np.ndarray,
    commission_per_side: float,
    personal_dll_pct: float = 0.67,
    firm_dll: float = 1000.0,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Suppress entries and force-close positions when DLL thresholds are breached.

    Wave 21 E.4. Conservative ATR-based P&L estimate (not actual trade P&L).

    Args:
        long_entries, short_entries: Entry signal arrays (modified in-place copies returned).
        exit_long, exit_short: Exit signal arrays (modified in-place for force-close).
        high_np, low_np, close_np: OHLCV price arrays.
        atr_np: ATR array.
        timestamps: Bar timestamps (for session date grouping).
        point_value: Dollar value per 1-point move.
        sizes: Contract sizes per bar.
        commission_per_side: Commission per trade side.
        personal_dll_pct: Fraction of firm DLL that triggers entry halt (default 0.67).
        firm_dll: Firm daily loss limit in dollars (default $1,000 for MFFU 50K).

    Returns:
        (long_entries_out, short_entries_out, metadata)
        metadata keys:
            dll_halt_sessions: list[str] — session dates where entry halt fired
            dll_force_close_sessions: list[str] — session dates where force-close fired
            entries_suppressed: int
    """
    personal_dll = firm_dll * personal_dll_pct
    force_close_dll = firm_dll * 0.95

    long_out = long_entries.copy()
    short_out = short_entries.copy()
    exit_long_out = exit_long.copy()
    exit_short_out = exit_short.copy()

    metadata: dict = {
        "dll_halt_sessions": [],
        "dll_force_close_sessions": [],
        "entries_suppressed": 0,
        # L4: flag that DLL halt uses a conservative ATR-based estimate (not actual P&L).
        # Downstream audit tools can use this to understand that DLL halt counts are
        # conservative approximations — actual P&L-based DLL is enforced by paper/live engine.
        "dll_halt_used_estimate": True,
    }

    n = len(long_out)
    session_pnl: dict[str, float] = {}  # date → cumulative estimated P&L
    session_halted: set[str] = set()
    session_force_closed: set[str] = set()

    for i in range(n):
        ts_str = str(timestamps[i]) if i < len(timestamps) else ""
        day_key = ts_str[:10] if len(ts_str) >= 10 else ts_str

        cum_pnl = session_pnl.get(day_key, 0.0)

        # Estimate loss for a trade entered on this bar
        atr = float(atr_np[i]) if not np.isnan(atr_np[i]) else 0.0
        size = float(sizes[i]) if i < len(sizes) and not np.isnan(sizes[i]) else 1.0
        # Conservative: assume full stop distance hit (1.5×ATR) plus commission roundtrip
        est_loss = atr * 1.5 * size * point_value + commission_per_side * size * 2

        # Force-close threshold (95% DLL)
        if cum_pnl <= -force_close_dll:
            if day_key not in session_force_closed:
                session_force_closed.add(day_key)
                metadata["dll_force_close_sessions"].append(day_key)
                print(
                    f"[DLL] force_close FIRED session={day_key} cum_pnl={cum_pnl:.0f} "
                    f"force_close_dll={force_close_dll:.0f}",
                    file=sys.stderr,
                )
            # Suppress entry AND force-close any open position
            if bool(long_out[i]):
                long_out[i] = False
                metadata["entries_suppressed"] += 1
            if bool(short_out[i]):
                short_out[i] = False
                metadata["entries_suppressed"] += 1
            exit_long_out[i] = True
            exit_short_out[i] = True
            continue

        # Personal DLL halt threshold (67%)
        if cum_pnl <= -personal_dll or day_key in session_halted:
            if day_key not in session_halted:
                session_halted.add(day_key)
                metadata["dll_halt_sessions"].append(day_key)
                print(
                    f"[DLL] halt FIRED session={day_key} cum_pnl={cum_pnl:.0f} "
                    f"personal_dll={personal_dll:.0f}",
                    file=sys.stderr,
                )
            if bool(long_out[i]):
                long_out[i] = False
                metadata["entries_suppressed"] += 1
            if bool(short_out[i]):
                short_out[i] = False
                metadata["entries_suppressed"] += 1
            continue

        # Accumulate estimated P&L impact for entries this bar
        if bool(long_out[i]) or bool(short_out[i]):
            session_pnl[day_key] = cum_pnl - est_loss

    return long_out, short_out, metadata


def run_backtest(
    request: BacktestRequest,
    data: Optional[pl.DataFrame] = None,
    fill_rate: float = 1.0,
    use_eligibility_gate: bool = True,
    spread_multiplier: float = 1.0,
    warmup_data: Optional[pl.DataFrame] = None,
) -> dict:
    """Run a single backtest and return metrics dict.

    Args:
        request: Backtest configuration
        data: Optional pre-loaded data (for testing). If None, loads from S3.
        fill_rate: Fraction of entry signals to keep (0.0-1.0). Used for
            crisis stress testing to simulate reduced fill rates.
        use_eligibility_gate: When True, apply the eligibility gate post-filter
            to entry/exit signals. Default True (enabled for all backtests).
        warmup_data: E7.2 — Optional IS (in-sample) data to prepend for adaptive
            indicator computation. When provided, indicators are computed on
            warmup_data+data (full context), then the warmup rows are stripped
            before signal generation and trade execution. This prevents lookahead
            leakage in walk-forward windows where rolling quantiles or regime
            detectors would otherwise look forward into OOS data during indicator
            init. Only affects adaptive indicators (rolling quantiles, regime
            detection) — simple indicators (MA, ATR) are unaffected in practice
            but benefit from the warmer initialization.

    Returns:
        dict with metrics, equity_curve, trades, daily_pnls, execution_time_ms
    """
    start_time = time.time()
    config = request.strategy
    spec = CONTRACT_SPECS[config.symbol]
    atr_period = _extract_atr_period(config)

    # ─── Auto-wire fill_rate / spread_multiplier from StrategyConfig ─────
    # Caveat 2 hardening: BacktestConfig (TS) and StrategyConfig (Pydantic) both
    # carry optional fill_rate / spread_multiplier fields. Stress-test scenarios
    # pass these positionally; sensitivity analysis or runtime overrides can now
    # set them on the strategy config and have them auto-flow into signal masking
    # (fill_rate -> generate_signals) and slippage scaling (spread_multiplier ->
    # compute_slippage). Positional args remain authoritative when a caller
    # explicitly passes a non-default value, so stress_test.py overrides win.
    # Test coverage: stress_test.py scenarios already pass these values; sensitivity
    # analysis can now exercise non-default ranges via BacktestConfig fields.
    if fill_rate == 1.0:
        cfg_fill_rate = getattr(config, "fill_rate", None)
        if cfg_fill_rate is not None and 0.0 <= cfg_fill_rate <= 1.0:
            fill_rate = cfg_fill_rate
    if spread_multiplier == 1.0:
        cfg_spread = getattr(config, "spread_multiplier", None)
        if cfg_spread is not None and cfg_spread > 0:
            spread_multiplier = cfg_spread

    # ─── Load data ─────────────────────────────────────────────
    range_push("forge/data_load")
    if data is None:
        print(f"Loading {config.symbol} {config.timeframe} data...", file=sys.stderr)
        data = load_ohlcv(
            config.symbol, config.timeframe,
            request.start_date, request.end_date,
        )
    range_pop()

    # ─── Validate bar count ──────────────────────────────────
    _validate_bar_count(data, config.timeframe, request.start_date, request.end_date)

    # ─── Flag rollover days (Task 7.1) ───────────────────────
    data = flag_rollover_days(data, config.symbol)

    # ─── E7.2: IS warmup prepend for adaptive indicators ─────
    # When warmup_data is provided (walk-forward context), prepend IS bars so that
    # rolling indicators are properly initialized before the OOS window begins.
    # Without this, a rolling 60-bar quantile computed on just the OOS slice would
    # use future OOS bars during the first 60 bars — lookahead leakage.
    # The warmup_rows count is used to strip IS rows after indicator computation,
    # before signal generation and trade execution. Trade results are OOS-only.
    warmup_rows = 0
    if warmup_data is not None and len(warmup_data) > 0:
        warmup_data = flag_rollover_days(warmup_data, config.symbol)
        warmup_rows = len(warmup_data)
        data = pl.concat([warmup_data, data], how="vertical")
        print(
            f"  IS warmup: prepended {warmup_rows} IS bars for indicator initialization",
            file=sys.stderr,
        )

    # ─── W23H.1: Load HTF data and join into exec_df when bias_timeframe present ─
    # This block runs BEFORE compute_indicators so that HTF columns are present in
    # the exec_df when indicator and signal computation happens.
    #
    # No-look-ahead guarantee: forward_fill_htf_to_exec uses Polars join_asof with
    # strategy='backward'. Each exec bar gets the most recently CLOSED HTF bar value.
    # See src/engine/indicators/mtf_join.py module docstring for the invariant.
    mtf_join_meta: dict = {}
    if getattr(config, "bias_timeframe", None):
        htf_tf = config.bias_timeframe
        htf_suffix = f"_{htf_tf}"
        try:
            from src.engine.indicators.core import (
                compute_htf_indicators as _compute_htf_ind,
            )
            from src.engine.indicators.mtf_join import forward_fill_htf_to_exec

            print(
                f"  MTF: loading HTF {htf_tf} data for bias gating "
                f"(exec_tf={config.timeframe})",
                file=sys.stderr,
            )
            # F-14 FIX: When warmup_data is present, extend the HTF load start
            # to cover warmup bars so that HTF columns are non-null for IS rows.
            # Previously the HTF load used request.start_date which is the OOS window
            # start — warmup bars fell before that date and got null HTF columns.
            # Now: if warmup is provided, start HTF load from the earliest warmup bar.
            if warmup_data is not None and len(warmup_data) > 0:
                _wm_ts_col = "ts_event" if "ts_event" in warmup_data.columns else (
                    "ts_et" if "ts_et" in warmup_data.columns else None
                )
                if _wm_ts_col:
                    _wm_start = str(warmup_data[_wm_ts_col][0])[:10]
                else:
                    _wm_start = request.start_date
                mtf_start = _wm_start
            else:
                mtf_start = request.start_date
            htf_df_raw = load_ohlcv(
                config.symbol,
                htf_tf,
                mtf_start,
                request.end_date,
            )
            htf_bars_loaded = len(htf_df_raw)

            # Determine HTF indicator configs from bias_condition.
            # The bias_condition string (e.g. 'ema_50_4h > ema_200_4h') names the
            # HTF columns. We parse the indicator types from the suffixed col names.
            # Convention: '{indicator}_{period}_{tf}' or '{indicator}_{tf}'.
            # We compute the same indicators[] as the exec-TF plus any EMA/SMA periods
            # referenced by bias_condition.
            htf_indicator_configs: list[IndicatorConfig] = []
            bias_cond = getattr(config, "bias_condition", None) or ""

            # Parse indicator names from bias_condition (e.g. 'ema_50_4h > ema_200_4h')
            # Supports: ema_N, sma_N, rsi_N, atr_N referenced with suffix stripped
            import re as _re
            col_tokens = _re.findall(r'[a-z]+_\d+(?:_[a-z0-9]+)*', bias_cond)
            for token in col_tokens:
                # Strip the HTF suffix if present: 'ema_50_4h' → 'ema_50'
                base = token.replace(htf_suffix, "")
                parts = base.split("_")
                if len(parts) >= 2 and parts[-1].isdigit():
                    ind_type = parts[0]
                    period = int(parts[-1])
                    if ind_type in ("ema", "sma", "rsi", "atr", "adx"):
                        htf_indicator_configs.append(
                            IndicatorConfig(type=ind_type, period=period)
                        )

            # Deduplicate configs (same type+period might appear twice)
            seen_htf = set()
            deduped_htf_configs = []
            for ic in htf_indicator_configs:
                key = (ic.type, ic.period)
                if key not in seen_htf:
                    seen_htf.add(key)
                    deduped_htf_configs.append(ic)

            # Always include ATR on HTF for potential future slippage/stop use
            if not any(ic.type == "atr" for ic in deduped_htf_configs):
                deduped_htf_configs.append(IndicatorConfig(type="atr", period=atr_period))

            htf_df_with_ind = _compute_htf_ind(
                htf_df_raw, deduped_htf_configs, suffix=htf_suffix
            )
            htf_bars_loaded = len(htf_df_with_ind)

            # HTF value columns = all columns except ts_event and OHLCV base cols
            _ohlcv_base = {"ts_event", "ts_et", "open", "high", "low", "close", "volume",
                           "is_rollover_day"}
            htf_value_cols = [
                c for c in htf_df_with_ind.columns
                if c not in _ohlcv_base and c.endswith(htf_suffix)
            ]

            exec_bars_before = len(data)
            data = forward_fill_htf_to_exec(data, htf_df_with_ind, htf_value_cols)
            exec_bars_after = len(data)

            # Forward-fill percentage: how many exec bars have non-null HTF values
            if htf_value_cols:
                _first_htf_col = htf_value_cols[0]
                if _first_htf_col in data.columns:
                    non_null = data[_first_htf_col].is_not_null().sum()
                    forward_fill_pct = round(non_null / max(exec_bars_after, 1) * 100, 1)
                else:
                    forward_fill_pct = 0.0
            else:
                forward_fill_pct = 0.0

            mtf_join_meta = {
                "exec_tf": config.timeframe,
                "htf": htf_tf,
                "htf_bars_loaded": htf_bars_loaded,
                "exec_bars_loaded": exec_bars_before,
                "forward_fill_pct": forward_fill_pct,
                "htf_indicator_configs": [
                    {"type": ic.type, "period": ic.period} for ic in deduped_htf_configs
                ],
                "htf_value_cols_added": htf_value_cols,
            }

            print(
                f"  MTF: join complete — {htf_bars_loaded} HTF bars × {exec_bars_after} exec bars, "
                f"forward_fill={forward_fill_pct}%",
                file=sys.stderr,
            )

            # Emit audit event via JSON to stderr (server captures structured stderr)
            import json as _json_mtf
            print(
                f"AUDIT_EVENT_JSON {_json_mtf.dumps({'event': 'backtest.mtf_join_completed', **mtf_join_meta})}",
                file=sys.stderr,
            )

        except Exception as _mtf_err:
            # MTF load failure is non-fatal: log, strip HTF fields, proceed without bias gate.
            # Backtest runs on exec-TF only — same as pre-W23H.1 behavior.
            print(
                f"  MTF WARNING: HTF load failed ({_mtf_err!r}); "
                f"proceeding without bias gate (degraded mode)",
                file=sys.stderr,
            )
            mtf_join_meta = {"error": str(_mtf_err), "degraded": True}

    # ─── Compute indicators ───────────────────────────────────
    # Ensure ATR is included for sizing/slippage
    indicator_configs = list(config.indicators)
    if not any(ind.type == "atr" for ind in indicator_configs):
        indicator_configs.append(IndicatorConfig(type="atr", period=atr_period))

    range_push("forge/indicators")
    df = compute_indicators(data, indicator_configs)
    range_pop()

    # ─── E7.2: Strip IS warmup rows after indicator computation ──
    # Now that indicators have warm state (correct rolling windows), strip the
    # prepended IS rows so signal generation and trade replay run on OOS-only data.
    # This preserves indicator initialization correctness without executing IS trades.
    if warmup_rows > 0:
        df = df.slice(warmup_rows)
        print(
            f"  IS warmup: stripped {warmup_rows} IS rows — OOS-only data for trade execution",
            file=sys.stderr,
        )

    # ─── Economic event mask (Task 3.8) ─────────────────────
    event_mask = None
    event_slippage_mult = None
    if request.event_calendar and request.event_calendar.policies and "ts_event" in df.columns:
        from src.engine.economic_calendar import (
            generate_event_mask,
            get_event_slippage_multipliers,
        )
        policies = [p.model_dump() for p in request.event_calendar.policies]
        event_mask = generate_event_mask(df["ts_event"], policies)
        event_slippage_mult = get_event_slippage_multipliers(df["ts_event"], policies)
    elif "ts_event" in df.columns:
        # P1-D fix: CLAUDE.md mandates default SIT_OUT ±30 min for FOMC/CPI/NFP.
        # When no event_calendar is supplied, apply a conservative time-of-day blackout:
        #   - 8:30–9:00 AM ET: covers NFP (1st Fri), CPI/PPI releases (typically 8:30 ET)
        #   - 14:00–14:30 ET: covers FOMC rate decisions (2:00 PM ET)
        # This is a structural approximation — every bar in these windows is masked out.
        # Callers can disable this by passing event_calendar with an empty policies list
        # and setting event_blackout_default=False (not yet a field — use EventCalendarConfig
        # with an explicit IGNORE policy to override).
        # NOTE: this does NOT affect slippage multipliers (no event_slippage_mult set here).
        # The mask only suppresses entry signals during the high-risk windows.
        _ts_series = df["ts_event"]

        def _build_default_event_mask_et(ts_et_series: "pl.Series") -> "np.ndarray":
            """Return a bool mask: True = ALLOW trade, False = SIT_OUT.

            Blocks bars falling in 8:30-9:00 ET and 14:00-14:30 ET windows.
            M3 FIX: Uses ts_et directly (Eastern Time) — zero DST ambiguity.
            8:30 ET is ALWAYS 08:30 in the ts_et string regardless of EST/EDT season.
            """
            import numpy as _np_ev
            n = len(ts_et_series)
            mask = _np_ev.ones(n, dtype=bool)  # True = allow

            for i in range(n):
                ts_val = ts_et_series[i]
                if ts_val is None:
                    continue
                try:
                    ts_str = str(ts_val)
                    # ts_et is in ET so HH:MM is directly ET time
                    # Format: "YYYY-MM-DDTHH:MM:SS..." or "YYYY-MM-DD HH:MM:SS..."
                    time_part = ts_str[11:16] if len(ts_str) >= 16 else ""
                    if not time_part:
                        continue
                    h, m = int(time_part[:2]), int(time_part[3:5])
                    total_min = h * 60 + m

                    # 8:30-9:00 ET — NFP/CPI/PPI releases (always 8:30 ET)
                    in_morning_window = (8 * 60 + 30) <= total_min < (9 * 60 + 0)

                    # 14:00-14:30 ET — FOMC rate decisions (always 2:00 PM ET)
                    in_fomc_window = (14 * 60 + 0) <= total_min < (14 * 60 + 30)

                    if in_morning_window or in_fomc_window:
                        mask[i] = False
                except Exception:
                    continue
            return mask

        # M3: Use ts_et when available (DST-safe); fall back to ts_event UTC math.
        if "ts_et" in df.columns:
            event_mask = _build_default_event_mask_et(df["ts_et"])
        else:
            # Legacy fallback — ts_et not available (should be rare post-data-loader fix)
            def _build_default_event_mask_utc(ts_series: "pl.Series") -> "np.ndarray":
                import numpy as _np_ev
                n = len(ts_series)
                mask = _np_ev.ones(n, dtype=bool)
                for i in range(n):
                    ts_val = ts_series[i]
                    if ts_val is None:
                        continue
                    try:
                        ts_str = str(ts_val)
                        time_part = ts_str[11:16] if len(ts_str) >= 16 else ""
                        if not time_part:
                            continue
                        h, m = int(time_part[:2]), int(time_part[3:5])
                        total_min = h * 60 + m
                        in_morning_window = (12 * 60 + 30) <= total_min < (14 * 60 + 0)
                        in_fomc_window = (18 * 60 + 0) <= total_min < (19 * 60 + 30)
                        if in_morning_window or in_fomc_window:
                            mask[i] = False
                    except Exception:
                        continue
                return mask
            event_mask = _build_default_event_mask_utc(_ts_series)
        _masked_bars = int((~event_mask).sum())
        if _masked_bars > 0:
            print(
                f"Default event blackout: masking {_masked_bars} bars "
                f"(8:30-9:00 ET + 14:00-14:30 ET windows — FOMC/CPI/NFP SIT_OUT). "
                f"Pass event_calendar with explicit policies to override.",
                file=sys.stderr,
            )

    # ─── Generate signals ─────────────────────────────────────
    range_push("forge/signals")
    df = generate_signals(df, config, fill_rate=fill_rate, event_mask=event_mask)
    range_pop()

    # ─── W23H.3: Allowed entry windows mask ──────────────────
    # Apply AFTER generate_signals() so the window check runs on the same signal
    # population that the backtester will act on — identical to paper-signal-service
    # behavior (gate at entry evaluation time, not indicator computation time).
    # Empty list → no restriction (backward compatible).
    skipped_outside_window_count = 0
    _entry_windows_raw = getattr(config, "allowed_entry_windows", None)
    if _entry_windows_raw:
        import datetime as _dt

        from src.engine.entry_windows import is_bar_in_any_window, parse_entry_windows

        _entry_windows = parse_entry_windows(_entry_windows_raw)  # raises on malformed
        _ts_col_ew = "ts_event" if "ts_event" in df.columns else None

        if _ts_col_ew is None:
            # No timestamp column — cannot apply window mask; log and skip
            print(
                "W23H.3 WARNING: allowed_entry_windows specified but no ts_event column found "
                "— window mask skipped. Ensure data_loader provides ts_event.",
                file=sys.stderr,
            )
        else:
            _ts_series = df[_ts_col_ew].to_list()
            _entry_long_arr = df["entry_long"].to_list()
            _has_short = "entry_short" in df.columns
            _entry_short_arr = df["entry_short"].to_list() if _has_short else None

            _new_long: list[bool] = []
            _new_short: list[bool] | None = [] if _has_short else None

            for i, ts_val in enumerate(_ts_series):
                el = bool(_entry_long_arr[i])
                es = bool(_entry_short_arr[i]) if _has_short else False

                if not (el or es):
                    # No signal on this bar — no masking needed
                    _new_long.append(el)
                    if _new_short is not None:
                        _new_short.append(es)
                    continue

                # Convert ts to UTC-aware datetime for window check
                if isinstance(ts_val, str):
                    # ISO string — parse to datetime
                    ts_str = ts_val.replace("T", " ").replace("Z", "+00:00")
                    try:
                        bar_dt = _dt.datetime.fromisoformat(ts_str)
                        if bar_dt.tzinfo is None:
                            bar_dt = bar_dt.replace(tzinfo=_dt.timezone.utc)
                    except Exception:
                        # Unparseable timestamp — allow signal (fail-open)
                        _new_long.append(el)
                        if _new_short is not None:
                            _new_short.append(es)
                        continue
                elif isinstance(ts_val, _dt.datetime):
                    bar_dt = ts_val
                    if bar_dt.tzinfo is None:
                        bar_dt = bar_dt.replace(tzinfo=_dt.timezone.utc)
                else:
                    # Unknown type — allow signal (fail-open)
                    _new_long.append(el)
                    if _new_short is not None:
                        _new_short.append(es)
                    continue

                in_any_window = is_bar_in_any_window(bar_dt, _entry_windows)
                if not in_any_window:
                    skipped_outside_window_count += (1 if el else 0) + (1 if es else 0)
                    _new_long.append(False)
                    if _new_short is not None:
                        _new_short.append(False)
                else:
                    _new_long.append(el)
                    if _new_short is not None:
                        _new_short.append(es)

            # Write masked arrays back into df
            df = df.with_columns([pl.Series("entry_long", _new_long)])
            if _has_short and _new_short is not None:
                df = df.with_columns([pl.Series("entry_short", _new_short)])

            if skipped_outside_window_count > 0:
                print(
                    f"W23H.3 entry windows: masked {skipped_outside_window_count} entry signals "
                    f"outside windows {_entry_windows_raw}",
                    file=sys.stderr,
                )

    # ─── Suppress entries on rollover days (Task 7.1) ─────────
    if "is_rollover_day" in df.columns:
        rollover_mask = df["is_rollover_day"]
        suppressed = int(
            (df.filter(rollover_mask)["entry_long"].sum() or 0)
            + (df.filter(rollover_mask).get_column("entry_short").sum() or 0)
            if "entry_short" in df.columns
            else (df.filter(rollover_mask)["entry_long"].sum() or 0)
        )
        if suppressed > 0:
            print(
                f"Suppressing {suppressed} entry signals on rollover days",
                file=sys.stderr,
            )
        df = df.with_columns([
            pl.when(pl.col("is_rollover_day")).then(False).otherwise(pl.col("entry_long")).alias("entry_long"),
            pl.when(pl.col("is_rollover_day")).then(False).otherwise(
                pl.col("entry_short") if "entry_short" in df.columns else pl.lit(False)
            ).alias("entry_short"),
        ])

    # ─── Commission: firm override → request value → contract spec default ──
    # E7.1 fix: the previous `elif commission == 0.62` branch silently overrode
    # an explicit Tradeify $0.62 commission (which IS the correct Tradeify rate)
    # because 0.62 happened to equal the system default sentinel. This caused
    # Tradeify backtests to use the contract spec default instead of the $0.62
    # firm rate, making P&L wrong for that firm. The correct test is whether a
    # firm was specified at all — if no firm, use the contract spec default.
    commission = request.commission_per_side
    if request.firm_key and request.firm_key in FIRM_COMMISSIONS:
        commission = get_commission_per_side(request.firm_key, config.symbol)
    elif request.firm_key is None and request.commission_per_side == 0.62:
        # No firm specified and no explicit commission override — use contract spec default.
        # Only apply when commission equals the pydantic field default (0.62) to avoid
        # silently overriding an explicit commission_per_side value from the caller.
        commission = spec.default_commission

    # ─── Firm contract cap (Task 3.12) ────────────────────────
    max_contracts = None
    if request.firm_key and request.firm_key in FIRM_CONTRACT_CAPS:
        from src.engine.firm_config import get_contract_cap
        max_contracts = get_contract_cap(request.firm_key, config.symbol)

    # ─── MED #4 (Wave 27.5 Pass D.1) — VIX margin expansion ──────────────
    # CME doubles intraday margin when VIX > 30 (emergency tier: VIX > 50).
    # Apply expansion to the max_contracts cap BEFORE sizing so simulated
    # P&L reflects actual tradeable position limits in high-vol regimes.
    # Backward compat: when VIX column is absent, skip silently + emit audit.
    _margin_expansion_audit_dsl: dict = {}
    if "vix" in df.columns:
        from src.engine.margin_expansion import (
            apply_vix_margin_expansion,
            get_vix_expansion_audit,
        )
        # Use the peak VIX in the backtest window for a conservative cap.
        # Rationale: CME margin requirements are regime-level policy changes
        # (announced days ahead), not bar-by-bar — peak represents the worst
        # sustained regime the backtest faced.
        _vix_np = df["vix"].to_numpy()
        _vix_np_clean = _vix_np[~np.isnan(_vix_np)]
        _peak_vix = float(np.max(_vix_np_clean)) if len(_vix_np_clean) > 0 else 0.0
        _base_mc = max_contracts if max_contracts is not None else 100  # sentinel if no firm cap
        _expanded_mc = apply_vix_margin_expansion(_base_mc, _peak_vix)
        _margin_expansion_audit_dsl = get_vix_expansion_audit(_base_mc, _expanded_mc, _peak_vix)
        if _expanded_mc != _base_mc:
            # Only override if we have an actual firm cap to constrain.
            # If max_contracts was None (no firm cap), we don't impose one.
            if max_contracts is not None:
                max_contracts = _expanded_mc
                print(
                    f"[margin-expansion] VIX={_peak_vix:.1f} → max_contracts {_base_mc} → {_expanded_mc}",
                    file=sys.stderr,
                )
    else:
        _margin_expansion_audit_dsl = {
            "skipped": True,
            "reason": "backtest.margin_expansion_unavailable_no_vix",
            "vix_column_present": False,
        }
        print("[margin-expansion] VIX column absent — skipping margin expansion", file=sys.stderr)

    # ─── Position sizing — Wave 24 Pass 2: vol-scale + liquidity-haircut ─────
    # Mirror paper-engine parity: apply the same vol-scale and liquidity-haircut
    # that computeRiskDerivedContracts() applies on the paper side (risk-sizing.ts).
    # This closes the paper-vs-backtest sizing gap in high-VIX environments.
    from src.engine.sizing import compute_liquidity_haircut, compute_vol_scale

    _vol_scale = compute_vol_scale(getattr(request, "vix_now", None))
    # top3_depth_ratio is pre-computed by caller (currentTop3Depth / baseline20d).
    # Historical book-depth series are absent from Parquet — caller provides scalar or None.
    _depth_ratio = getattr(request, "top3_depth_ratio", None)
    # Synthesise two-argument form for compute_liquidity_haircut from ratio.
    # When caller passes top3_depth_ratio, treat it as current / baseline = ratio / 1.
    _liq_haircut = compute_liquidity_haircut(_depth_ratio, 1.0) if _depth_ratio is not None else 1.0

    # Parity metadata — what adjustments are active for this backtest run.
    _parity_metadata: dict = {
        "vol_scale_applied": _vol_scale != 1.0,
        "vol_scale": _vol_scale,
        "liquidity_haircut_applied": _liq_haircut != 1.0,
        "liquidity_haircut": _liq_haircut,
        "parity_warn": [],
    }
    if getattr(request, "vix_now", None) is None:
        _parity_metadata["parity_warn"].append("parity_warn.no_vix_in_backtest")
        print("[parity] vix_now absent — vol_scale=1.0 (no vol adjustment)", file=sys.stderr)
    if _depth_ratio is None:
        _parity_metadata["parity_warn"].append("parity_warn.no_depth_ratio_in_backtest")
        _parity_metadata["parity_warn"].append(
            "parity_note.depth_data_absent — historical book-depth not in Parquet; "
            "caller must provide top3_depth_ratio scalar for full parity"
        )

    # Apply vol-scale + liquidity-haircut to position_size config (immutable copy).
    _raw_max_risk = config.position_size.max_risk_pct_per_trade
    _raw_liq_cap  = config.position_size.liquidity_comfort_cap
    _sized_config  = config.position_size
    _size_adjusted = False
    if _raw_max_risk is not None and _vol_scale != 1.0:
        _new_risk_pct = max(1e-6, _raw_max_risk * _vol_scale)  # never drive to exactly 0
        _sized_config = _sized_config.model_copy(update={"max_risk_pct_per_trade": _new_risk_pct})
        _size_adjusted = True
    if _raw_liq_cap is not None and _liq_haircut != 1.0:
        _new_liq_cap = max(1, int(math.floor(_raw_liq_cap * _liq_haircut)))
        _sized_config = _sized_config.model_copy(update={"liquidity_comfort_cap": _new_liq_cap})
        _size_adjusted = True
    if _size_adjusted:
        _parity_metadata["adjusted_max_risk_pct"] = _sized_config.max_risk_pct_per_trade
        _parity_metadata["adjusted_liquidity_cap"] = _sized_config.liquidity_comfort_cap

    sizes, over_risk = compute_position_sizes(
        df, _sized_config, spec, atr_period,
        max_contracts=max_contracts,
    )
    # Defense-in-depth: replace any inf/nan sizes with 1 contract
    sizes = np.where(np.isfinite(sizes), sizes, 1.0)
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers (Task 3.7) ─────────────
    # Prefer ts_et (Eastern Time) for session filtering — all session logic
    # must use ET, not UTC. ts_et is added by data_loader at load time.
    session_mult = None
    _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if _ts_col in df.columns:
        session_mult = get_session_multipliers(df[_ts_col])

    # Combine session + event slippage multipliers
    combined_slippage_mult = session_mult
    if event_slippage_mult is not None:
        if combined_slippage_mult is not None:
            combined_slippage_mult = combined_slippage_mult * event_slippage_mult
        else:
            combined_slippage_mult = event_slippage_mult

    # ─── Slippage ─────────────────────────────────────────────
    # HIGH #5 — Symmetric exit slippage (Wave 27.5 Pass C.1).
    #
    # SYMMETRIC SLIPPAGE CONTRACT:
    # slippage_arr is computed bar-by-bar with session_multipliers applied to ALL bars.
    # Both entry and exit slippage are read from slippage_arr[bar_idx] — the session
    # multiplier at the exit bar is automatically applied to the exit, just as the
    # entry bar's multiplier is applied to the entry. Entries and exits always use
    # the SESSION MULTIPLIER OF THEIR OWN BAR (not the other side's bar).
    #
    # Example: entry at bar 100 (RTH core, mult=1.0); exit at bar 120 (overnight, mult=2.0).
    #   → entry_slip = slippage_arr[100] = ATR_scaled × 1.0
    #   → exit_slip  = slippage_arr[120] = ATR_scaled × 2.0   (CORRECT — crisis exit penalized)
    #
    # Opt-out: set BACKTEST_EXIT_SLIPPAGE_SYMMETRIC=false to fall back to flat overhead
    # (legacy behavior prior to Wave 27.5 — NOT recommended for institutional runs).
    _exit_slippage_symmetric = os.environ.get("BACKTEST_EXIT_SLIPPAGE_SYMMETRIC", "true").lower() in ("true", "1", "yes")

    _order_type = request.fill_model.order_type if request.fill_model else "market"
    slippage_arr = compute_slippage(
        df, spec, request.slippage_ticks, atr_period,
        session_multipliers=combined_slippage_mult if _exit_slippage_symmetric else None,
        order_type=_order_type,
    )
    # When symmetric mode is OFF, still apply session multipliers to entries only.
    # We track the non-session-multiplied exit slip for the audit delta.
    _slippage_arr_no_session: Optional[np.ndarray] = None
    if not _exit_slippage_symmetric and combined_slippage_mult is not None:
        # Re-compute WITH multipliers for entry-only tracking (for asymmetry_delta audit)
        _slippage_arr_session = compute_slippage(
            df, spec, request.slippage_ticks, atr_period,
            session_multipliers=combined_slippage_mult,
            order_type=_order_type,
        )
        _slippage_arr_no_session = slippage_arr  # flat, no multipliers

    # spread_multiplier scales slippage for crisis stress tests / sensitivity analysis.
    # fill_model.compute_fill_probabilities_v2 already consumes spread_multiplier for
    # limit-order fill probability — applying it here ensures market-order slippage
    # also reflects the wider spread regime in stress scenarios.
    if spread_multiplier != 1.0:
        slippage_arr = slippage_arr * spread_multiplier

    # ─── CRITICAL #4: Build HTF cache for eligibility gate + structural TP ───
    # Mirrors the pattern in run_class_backtest() / run_walk_forward_class().
    # Without this, apply_eligibility_gate() and _apply_trade_management() both
    # receive htf_cache=None — passthrough no-op mode.  With the cache, the gate
    # evaluates bias/playbook/location/structural-TP for every DSL signal.
    _dsl_htf_cache: Optional[dict] = None
    _dsl_strategy_name = getattr(config, "name", "") or ""
    try:
        _daily_data_for_htf = load_ohlcv(
            config.symbol, "daily",
            request.start_date, request.end_date,
        )
        if len(_daily_data_for_htf) >= 200:
            from src.engine.context.htf_context import compute_htf_context
            _dsl_htf_cache = {}
            _htf_ts_col = "ts_et" if "ts_et" in _daily_data_for_htf.columns else "ts_event"
            for _day_idx in range(200, len(_daily_data_for_htf)):
                _bar_date = _daily_data_for_htf[_htf_ts_col][_day_idx]
                _day_key = str(_bar_date)[:10]
                _dsl_htf_cache[_day_key] = compute_htf_context(
                    daily_df=_daily_data_for_htf.slice(0, _day_idx),
                    four_h_df=None,
                    one_h_df=None,
                    current_price=float(_daily_data_for_htf["close"][_day_idx - 1]),
                    bar_date=_bar_date,
                )
            print(
                f"  DSL backtest: built HTF cache {len(_dsl_htf_cache)} days "
                f"for eligibility gate + structural TP",
                file=sys.stderr,
            )
        else:
            print(
                f"  DSL backtest: daily bars={len(_daily_data_for_htf)} < 200 — "
                f"HTF cache skipped (passthrough mode)",
                file=sys.stderr,
            )
    except Exception as _htf_build_err:
        print(
            f"  DSL backtest: HTF cache build failed ({_htf_build_err!r}) — "
            f"eligibility gate + structural TP run in passthrough mode",
            file=sys.stderr,
        )
        _dsl_htf_cache = None

    # ─── Eligibility gate (Wave 2.8 integration point) ─────────
    entries_np = df["entry_long"].to_numpy()
    exits_np = df["exit_long"].to_numpy()
    if use_eligibility_gate:
        entries_np, exits_np, _ = apply_eligibility_gate(
            entries_np, exits_np, df,
            direction="long", symbol=config.symbol,
            firm_key=request.firm_key,
            htf_cache=_dsl_htf_cache,
            strategy_name=_dsl_strategy_name,
        )
        # Update DataFrame with filtered signals
        df = df.with_columns([
            pl.Series("entry_long", entries_np),
            pl.Series("exit_long", exits_np),
        ])
        # Apply gate to short side if present
        if "entry_short" in df.columns:
            short_entries_np = df["entry_short"].to_numpy()
            short_exits_np = df["exit_short"].to_numpy()
            short_entries_np, short_exits_np, _ = apply_eligibility_gate(
                short_entries_np, short_exits_np, df,
                direction="short", symbol=config.symbol,
                firm_key=request.firm_key,
                htf_cache=_dsl_htf_cache,
                strategy_name=_dsl_strategy_name,
            )
            df = df.with_columns([
                pl.Series("entry_short", short_entries_np),
                pl.Series("exit_short", short_exits_np),
            ])

    # ─── G2 parity gate (skip + anti-setup, default off) ────────
    # W27.5 C.2: per-backtest compliance_mode override wins over env var.
    # Reads from request config dict (BacktestRequest.strategy fields or raw config).
    _per_backtest_compliance_mode: Optional[str] = getattr(config, "compliance_mode", None)
    if _per_backtest_compliance_mode is None:
        # Also check the raw request-level config dict if strategy config doesn't have it
        _req_raw_config = getattr(request, "_raw_config", None)
        if isinstance(_req_raw_config, dict):
            _per_backtest_compliance_mode = _req_raw_config.get("compliance_mode")
    # W27.5 C.2: initialize _parity_short to empty dict so result dict can always
    # reference it even when no short signals exist.
    _parity_short: dict = {}
    entries_np, _parity_long = _apply_backtest_parity_gates(
        entries_np, df, "long", config.symbol, getattr(config, "name", ""),
        compliance_mode_override=_per_backtest_compliance_mode,
    )
    df = df.with_columns([pl.Series("entry_long", entries_np)])
    if "entry_short" in df.columns:
        short_entries_np = df["entry_short"].to_numpy()
        short_entries_np, _parity_short = _apply_backtest_parity_gates(
            short_entries_np, df, "short", config.symbol, getattr(config, "name", ""),
            compliance_mode_override=_per_backtest_compliance_mode,
        )
        df = df.with_columns([pl.Series("entry_short", short_entries_np)])

    # ─── Fill probability model (Task 3.10) ───────────────────
    # Stage 1: RSI/type-based fill probability gate (entry yes/no + size halving
    #          on low-probability fills).  Unchanged from pre-W27.5.
    # Stage 2: Volume-based partial fill ratio (HIGH #6, Wave 27.5 Pass C.1).
    #          Activated when BACKTEST_PARTIAL_FILL_ENABLED=true (default).
    #          Degrades sizes at entry bars where order_qty > volume_threshold × bar_volume.
    #          Uses BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD env var (default 0.1).
    #
    # P&L contract: both stages output integer contract sizes consumed by the
    # futures P&L formula in backtester.py.  NEVER passed to vectorbt slippage/fees.
    entries_np = df["entry_long"].to_numpy()
    _partial_fill_audit: dict = {}
    if request.fill_model:
        from src.engine.fill_model import (
            apply_fill_model,
            apply_volume_partial_fills,
            compute_fill_probabilities_v2,
        )
        fill_config = request.fill_model.model_dump()
        fill_probs = compute_fill_probabilities_v2(
            df, fill_config, entries_np,
            order_type=request.fill_model.order_type,
            symbol=config.symbol,
            spread_multiplier=spread_multiplier,
        )
        entries_np, sizes = apply_fill_model(entries_np, fill_probs, sizes, seed=42)

        # Stage 2: Volume-based partial fill (HIGH #6).
        # Apply AFTER the RSI gate so we only degrade fills that passed Stage 1.
        # Env var BACKTEST_PARTIAL_FILL_ENABLED controls activation (default: true).
        sizes, _vol_fill_ratios, _partial_fill_audit = apply_volume_partial_fills(
            entries_np, sizes, df,
        )

        long_adjusted_sizes = sizes.copy()  # Save before rolling for re-alignment

    # ─── A7: Capture pre-roll signal vector ──────────────────────
    # Capture the final filtered signal vector BEFORE the next-bar roll.
    # Vector convention: 1 = long entry, -1 = short entry, 0 = no signal.
    # Only entry signals are captured (not exits) — we want "when did the
    # strategy decide to enter?" not "when did it exit?".
    # Captured AFTER all gates (eligibility, parity, fill model, max_trades)
    # so it reflects the actual decisions the strategy would have made.
    # A7 determinism: signal arrays at this point are fully determined by
    # the same inputs as the rest of the backtest (no new randomness).
    _pre_roll_long_np = entries_np.copy()
    _pre_roll_short_np = (
        df["entry_short"].to_numpy().copy() if "entry_short" in df.columns
        else np.zeros(len(entries_np), dtype=bool)
    )

    # ─── Shift entry signals by 1 bar (next-bar fill) ──────────
    # Signal on bar N → fill on bar N+1. Eliminates lookahead bias.
    entries_np = np.roll(entries_np, 1)
    entries_np[0] = False

    # Re-align long-side fill model sizes with rolled entries
    if request.fill_model:
        shifted_long_mask = entries_np.astype(bool)
        long_pre_shift_indices = np.where(shifted_long_mask)[0] - 1
        long_valid = long_pre_shift_indices >= 0
        for idx, pre_idx in zip(np.where(shifted_long_mask)[0][long_valid], long_pre_shift_indices[long_valid]):
            sizes[idx] = long_adjusted_sizes[pre_idx]

    # ─── Convert to Pandas at vectorbt boundary (CLAUDE.md rule) ─
    # Use ts_event as index so equity curve has proper datetime indices
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
    # High/Low arrays for per-trade MAE/MFE computation
    high_np = df["high"].to_numpy() if "high" in df.columns else close_pd.to_numpy()
    low_np = df["low"].to_numpy() if "low" in df.columns else close_pd.to_numpy()
    if ts_index is not None:
        close_pd.index = ts_index
    entries_pd = pl.Series("entry_long", entries_np).to_pandas()
    if ts_index is not None:
        entries_pd.index = ts_index
    exits_pd = df["exit_long"].to_pandas()
    if ts_index is not None:
        exits_pd.index = ts_index

    # Short side signals (use proper boolean Series, not int * False)
    if "entry_short" in df.columns:
        short_entries_np = df["entry_short"].to_numpy()
        # Apply fill model to short entries too
        if request.fill_model:
            from src.engine.fill_model import (
                apply_fill_model,
                compute_fill_probabilities_v2,
            )
            fill_config = request.fill_model.model_dump()
            short_fill_probs = compute_fill_probabilities_v2(
                df, fill_config, short_entries_np,
                order_type=request.fill_model.order_type,
                symbol=config.symbol,
                spread_multiplier=spread_multiplier,
            )
            short_entries_np, short_adjusted_sizes = apply_fill_model(short_entries_np, short_fill_probs, sizes.copy(), seed=43)
            # Merge short partial fill adjustments into main sizes array
            # (safe: same bar can't have both long and short entry)
            short_fill_mask = short_entries_np.astype(bool)
            sizes[short_fill_mask] = short_adjusted_sizes[short_fill_mask]
        # Shift short entries by 1 bar (next-bar fill)
        # Also shift the short-side sizes to match — sizes[N] was set for a signal
        # on bar N, but after the roll the signal is at bar N+1. We need to shift
        # the short-adjusted sizes to bar N+1 as well.
        short_entries_np = np.roll(short_entries_np, 1)
        short_entries_np[0] = False
        if request.fill_model:
            # Re-align: for bars where short entry is now True (post-shift),
            # pull the adjusted size from the previous bar (pre-shift index)
            shifted_short_mask = short_entries_np.astype(bool)
            pre_shift_indices = np.where(shifted_short_mask)[0] - 1
            valid = pre_shift_indices >= 0
            for idx, pre_idx in zip(np.where(shifted_short_mask)[0][valid], pre_shift_indices[valid]):
                sizes[idx] = short_adjusted_sizes[pre_idx]
        short_entries_pd = pl.Series("entry_short", short_entries_np).to_pandas()
    else:
        short_entries_pd = pd.Series(False, index=close_pd.index)
    short_exits_pd = df["exit_short"].to_pandas() if "exit_short" in df.columns else pd.Series(False, index=close_pd.index)
    if ts_index is not None:
        short_entries_pd.index = ts_index
        short_exits_pd.index = ts_index

    # ─── Max trades per day filter ──────────────────────────────
    if request.max_trades_per_day > 0:
        ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if ts_col in df.columns:
            ts_arr = df[ts_col].to_numpy()
            entries_np, short_entries_np_filtered = _apply_max_trades_per_day(
                entries_np,
                short_entries_np if "entry_short" in df.columns else np.zeros(len(entries_np), dtype=bool),
                ts_arr,
                request.max_trades_per_day,
            )
            entries_pd = pd.Series(entries_np, index=entries_pd.index)
            if "entry_short" in df.columns:
                short_entries_pd = pd.Series(short_entries_np_filtered, index=short_entries_pd.index)

    # NaN sizes = position sizer couldn't compute → suppress those entries
    # Must update the pandas Series (not stale numpy arrays) since vectorbt reads from pandas
    nan_mask = np.isnan(sizes)
    if np.any(nan_mask):
        entries_pd[nan_mask] = False
        short_entries_pd[nan_mask] = False
    # Clean NaN values (safety — no NaNs remain after mask)
    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Wave 24 Pass 1 — Item 14: Blackout gate + cross-symbol DLL ─────────
    # Apply BEFORE the E.3/E.5/E.4 guards so that blackout-suppressed entries
    # don't waste cycles in the stop-ceiling check.
    #
    # Blackout gate: parity with paper-signal-service.ts blackout_windows.
    # Cross-symbol DLL: parity with cross-symbol-pnl.ts evaluateCrossSymbolDll().
    # Both are fail-safe: any error is logged and the run continues without them.
    _dsl_guards_meta: dict = {
        "stop_ceiling_skips": 0,
        "time_stop_exits": 0,
        "dll_halt_blocks": 0,
        "blackout_skips": 0,
        "cross_symbol_dll_halts": 0,
    }

    _guard_ts_list_early = (
        df["ts_et"].to_list() if "ts_et" in df.columns
        else (df["ts_event"].to_list() if "ts_event" in df.columns else [])
    )

    # ── Blackout gate ────────────────────────────────────────────────────────
    try:
        from src.engine.context.blackout_gate import (
            apply_blackout_mask_to_entries,
            load_blackouts_from_env_or_config,
        )
        _blackout_symbol = config.symbol if hasattr(config, "symbol") else "MES"
        _config_blackouts = (
            getattr(request, "blackout_windows", None)
            or getattr(config, "blackout_windows", None)
        )
        _blackout_windows = load_blackouts_from_env_or_config(
            symbol=_blackout_symbol,
            config_blackouts=_config_blackouts,
        )
        if _blackout_windows:
            _bl_el = entries_pd.to_numpy().astype(bool)
            _bl_es = short_entries_pd.to_numpy().astype(bool)
            _bl_el, _bl_es, _bl_skips = apply_blackout_mask_to_entries(
                _bl_el, _bl_es, _guard_ts_list_early, _blackout_windows,
            )
            entries_pd = pd.Series(_bl_el, index=entries_pd.index)
            short_entries_pd = pd.Series(_bl_es, index=short_entries_pd.index)
            _dsl_guards_meta["blackout_skips"] = _bl_skips
            if _bl_skips > 0:
                print(
                    f"[DSL guards] Item14 blackout_skips={_bl_skips} "
                    f"({len(_blackout_windows)} blackout windows active)",
                    file=sys.stderr,
                )
    except Exception as _bl_err:
        print(f"[DSL guards] blackout gate error (non-fatal): {_bl_err!r}", file=sys.stderr)

    # ── Cross-symbol DLL guard ────────────────────────────────────────────────
    # For single-symbol backtests this is the degenerate case (one symbol's P&L).
    # bar_dollar_pnls at this point is not yet computed — we proxy with zeros here
    # and let the existing per-bar DLL halt (E.4) handle intra-bar enforcement.
    # The cross-symbol DLL layer adds the MULTI-SYMBOL cross-aggregate enforcement
    # that the paper side computes from cross-symbol-pnl.ts. Since the Python
    # backtester currently runs one symbol at a time, we track the single-symbol
    # session P&L from sizes × close prices as an approximation. The guard fires
    # when this single symbol's session loss exceeds 67% of the firm DLL.
    try:
        from src.engine.context.cross_symbol_dll import (
            apply_cross_symbol_dll_to_entries,
        )
        _cs_firm_dll = 1000.0
        if request.firm_key:
            from src.engine.firm_config import FIRM_RULES as _cs_firm_rules
            _cs_firm_dll = float(_cs_firm_rules.get(request.firm_key, {}).get("daily_loss_limit") or 1000.0)
        # Build a per-bar estimated P&L from close price changes × contracts × point_value.
        # This is a rough proxy — bar-level P&L is not fully computed until after vectorbt.
        # We use ATR-scaled estimates for now; exact P&L enforcement is in E.4.
        # Wave 24: for multi-symbol runs the caller should concatenate P&L arrays before
        # passing here. For the single-symbol case, use a zero array (degenerate).
        _cs_bar_pnls = np.zeros(len(entries_pd), dtype=float)
        _cs_el = entries_pd.to_numpy().astype(bool)
        _cs_es = short_entries_pd.to_numpy().astype(bool)
        _cs_xl = exits_pd.to_numpy().astype(bool)
        _cs_xs = short_exits_pd.to_numpy().astype(bool) if "short_exits" in df.columns else np.zeros(len(_cs_el), dtype=bool)
        _cs_el, _cs_es, _cs_xl, _cs_xs, _cs_meta = apply_cross_symbol_dll_to_entries(
            _cs_el, _cs_es, _cs_xl, _cs_xs,
            _cs_bar_pnls, _guard_ts_list_early, _cs_firm_dll,
        )
        entries_pd = pd.Series(_cs_el, index=entries_pd.index)
        short_entries_pd = pd.Series(_cs_es, index=short_entries_pd.index)
        exits_pd = pd.Series(_cs_xl, index=exits_pd.index)
        if "entry_short" in df.columns:
            short_exits_pd = pd.Series(_cs_xs, index=short_exits_pd.index)
        _dsl_guards_meta["cross_symbol_dll_halts"] = _cs_meta["entries_suppressed"]
        if _cs_meta["entries_suppressed"] > 0:
            print(
                f"[DSL guards] Item14 cross_symbol_dll_halts={_cs_meta['entries_suppressed']} "
                f"force_close_events={_cs_meta['force_close_events']}",
                file=sys.stderr,
            )
    except Exception as _cs_err:
        print(f"[DSL guards] cross-symbol DLL error (non-fatal): {_cs_err!r}", file=sys.stderr)

    # ─── CRITICAL #1: Wire E.3/E.5/E.4 DSL guards ───────────────
    # These functions are defined in this module and tested individually but were
    # never called from run_backtest() — they fired in class-based paths only.
    # Fix: apply them here, just before the vectorbt call, so DSL backtests
    # honour CLAUDE.md §4:
    #   E.3 — ATR stop ceiling (14pt MES / 40pt MNQ / 25-tick MCL)
    #   E.5 — 15:55 ET hard time-stop
    #   E.4 — 67% personal DLL halt + 95% force-close
    #
    # Inputs at this point are fully rolled (next-bar fill applied) and sized.
    # We modify the pandas entry/exit Series in-place before vbt.Portfolio runs.
    try:
        _guard_atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 1.0)
        _guard_close_np = df["close"].to_numpy()
        _guard_high_np = df["high"].to_numpy() if "high" in df.columns else _guard_close_np
        _guard_low_np = df["low"].to_numpy() if "low" in df.columns else _guard_close_np

        # ts_et is preferred (DST-safe); fall back to ts_event UTC strings.
        _guard_ts = df["ts_et"].to_list() if "ts_et" in df.columns else (
            df["ts_event"].to_list() if "ts_event" in df.columns else None
        )
        _guard_ts_et = df["ts_et"].to_list() if "ts_et" in df.columns else None

        _guard_entry_long = entries_pd.to_numpy().astype(bool)
        _guard_exit_long = df["exit_long"].to_numpy().astype(bool)
        _guard_entry_short = short_entries_pd.to_numpy().astype(bool)
        _guard_exit_short = (
            df["exit_short"].to_numpy().astype(bool)
            if "exit_short" in df.columns
            else np.zeros(len(_guard_entry_long), dtype=bool)
        )

        _guard_stop_mult = float(getattr(config.stop_loss, "multiplier", 1.5)) if hasattr(config, "stop_loss") and config.stop_loss else 1.5

        # E.3 + E.5
        (
            _guard_entry_long,
            _guard_exit_long,
            _guard_entry_short,
            _guard_exit_short,
            _dsl_sl_meta,
        ) = _apply_dsl_stop_loss_and_time_stop(
            _guard_entry_long,
            _guard_exit_long,
            _guard_entry_short,
            _guard_exit_short,
            _guard_high_np,
            _guard_low_np,
            _guard_atr_np,
            _guard_ts,
            stop_multiplier=_guard_stop_mult,
            symbol=config.symbol,
            close_np=_guard_close_np,
            ts_et_timestamps=_guard_ts_et,
        )
        _dsl_guards_meta["stop_ceiling_skips"] = len(_dsl_sl_meta.get("skipped_trades", []))
        _dsl_guards_meta["time_stop_exits"] = _dsl_sl_meta.get("time_stop_exits", 0)

        if _dsl_guards_meta["stop_ceiling_skips"] > 0 or _dsl_guards_meta["time_stop_exits"] > 0:
            print(
                f"[DSL guards] E.3 stop_ceiling_skips={_dsl_guards_meta['stop_ceiling_skips']} "
                f"E.5 time_stop_exits={_dsl_guards_meta['time_stop_exits']}",
                file=sys.stderr,
            )

        # E.4 — DLL halt.  Firm DLL comes from firm_config; default $1000 (Topstep).
        _guard_firm_dll = 1000.0
        if request.firm_key:
            from src.engine.firm_config import FIRM_RULES as _guard_firm_rules
            _guard_firm_dll = _guard_firm_rules.get(request.firm_key, {}).get("daily_loss_limit") or 1000.0
        _guard_dll_pct = float(os.environ.get("DLL_HALT_PCT", "0.67"))

        _guard_ts_arr = np.array(_guard_ts if _guard_ts is not None else [""] * len(_guard_entry_long))

        _guard_entry_long, _guard_entry_short, _dll_meta = _apply_dll_halt_to_entries(
            _guard_entry_long,
            _guard_entry_short,
            _guard_exit_long,
            _guard_exit_short,
            _guard_high_np,
            _guard_low_np,
            _guard_close_np,
            _guard_atr_np,
            _guard_ts_arr,
            spec.point_value,
            sizes_clean,
            commission,
            personal_dll_pct=_guard_dll_pct,
            firm_dll=_guard_firm_dll,
        )
        _dsl_guards_meta["dll_halt_blocks"] = _dll_meta.get("entries_suppressed", 0)

        if _dsl_guards_meta["dll_halt_blocks"] > 0:
            print(
                f"[DSL guards] E.4 dll_halt_blocks={_dsl_guards_meta['dll_halt_blocks']} "
                f"(personal_dll={_guard_firm_dll * _guard_dll_pct:.0f})",
                file=sys.stderr,
            )

        # Write guard-modified arrays back into the pandas Series that vectorbt reads.
        entries_pd = pd.Series(_guard_entry_long, index=entries_pd.index)
        exits_pd = pd.Series(_guard_exit_long, index=exits_pd.index)
        if "entry_short" in df.columns:
            short_entries_pd = pd.Series(_guard_entry_short, index=short_entries_pd.index)
            short_exits_pd = pd.Series(_guard_exit_short, index=short_exits_pd.index)

    except Exception as _dsl_guard_err:
        # Guards are fail-safe: if anything goes wrong, log and continue without them.
        # The backtest still runs; it just won't have E.3/E.4/E.5 enforcement.
        print(
            f"[DSL guards] ERROR — guards skipped (non-fatal): {_dsl_guard_err!r}",
            file=sys.stderr,
        )

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math:
    #   dollar_pnl = price_diff × contracts × point_value - slippage - commission
    # This prevents: (1) equity ignoring slippage, (2) commission × point_value bug,
    # (3) fixed_fees treating per-contract fee as per-order.
    #
    # SAME-BAR STOP + SIGNAL EXIT CONVENTION (Task 5.8):
    #   Stops are encoded as exit signals in the signal arrays (exits_pd / short_exits_pd).
    #   When both a stop loss AND a signal-based exit trigger on the same bar, the exit
    #   signal is already True — vectorbt exits at the bar's close price. Because stops
    #   are evaluated first in generate_signals() and the stop price is always worse than
    #   or equal to the signal exit price, this is conservative by construction.
    #   The bar's close price used by vectorbt represents the WORST-CASE exit (the stop),
    #   not the better signal exit. This matches real trading: an intraday stop fires
    #   before an end-of-bar signal exit would.
    #   NOTE: We do NOT use vectorbt's sl_stop/tp_stop parameters. All stop logic is
    #   pre-computed in the signal arrays for full control over priority and pricing.
    try:
        pf = vbt.Portfolio.from_signals(
            close=close_pd,
            entries=entries_pd,
            exits=exits_pd,
            short_entries=short_entries_pd,
            short_exits=short_exits_pd,
            size=sizes_clean,
            freq=_resolve_freq(config.timeframe),
            init_cash=float("inf"),
        )
    except Exception as e:
        print(f"vectorbt error: {e}", file=sys.stderr)
        return _empty_result(str(e), time.time() - start_time)

    # ─── Extract metrics (futures P&L computed independently) ─
    STARTING_CAPITAL = 50_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None

    # ─── Add Entry/Exit Idx columns (VBT v2 uses timestamps, not indices) ──
    if trades_records is not None and "Entry Idx" not in trades_records.columns:
        ts_to_idx = {ts: i for i, ts in enumerate(close_pd.index)}
        if "Entry Timestamp" in trades_records.columns:
            trades_records = trades_records.copy()
            entry_idx_mapped = trades_records["Entry Timestamp"].map(ts_to_idx)
            exit_idx_mapped = trades_records["Exit Timestamp"].map(ts_to_idx)
            unmapped = int(entry_idx_mapped.isna().sum() + exit_idx_mapped.isna().sum())
            if unmapped > 0:
                raise ValueError(
                    f"CRITICAL: {unmapped} trade timestamps unmapped to bar indices. "
                    f"Data integrity compromised — timestamp mismatch between "
                    f"trades and price data."
                )
            trades_records["Entry Idx"] = entry_idx_mapped.astype(int)
            trades_records["Exit Idx"] = exit_idx_mapped.astype(int)

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []
    trade_pnls_arr = np.array([])
    # Default arrays for winners/losers/avg values — used in expectancy_per_trade calculation.
    # These are overwritten inside `if trades_records is not None:` when trades exist.
    winners = np.array([])
    losers = np.array([])
    avg_winner = 0.0
    avg_loser = 0.0

    # C4 FIX: Apply _apply_trade_management to vectorbt trades so that stop/TP
    # price overrides are used for P&L computation rather than vectorbt's bar-close
    # exit prices. vectorbt fills all exits at bar close; our managed exit prices
    # reflect the actual intraday stop/TP trigger price (or gap-open price for C2).
    # Approach: Option 1 (bypass vectorbt for stop/TP fills) — use the managed
    # exit_price for bar_dollar_pnls. This is cleaner than passing price= arrays
    # to vbt.Portfolio.from_signals because our stop logic is already pre-computed
    # in signal arrays and we own all P&L math.
    vbt_managed_trades: list[dict] = []
    vbt_open_np = df["open"].to_numpy() if "open" in df.columns else None
    vbt_close_np = df["close"].to_numpy()
    vbt_atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 1.0)
    vbt_gap_through_count = 0
    if trades_records is not None:
        try:
            vbt_managed_trades = _apply_trade_management(
                trades_records, high_np, low_np, vbt_close_np, vbt_atr_np,
                spec, _dsl_htf_cache, df, open_np=vbt_open_np,
            )
            vbt_gap_through_count = sum(m.get("gap_through_stop_count", 0) for m in vbt_managed_trades)
            if vbt_gap_through_count > 0:
                print(
                    f"[C4] vectorbt path: {vbt_gap_through_count} gap-through-stop fills overridden",
                    file=sys.stderr,
                )
        except Exception as _c4_err:
            print(f"[C4] _apply_trade_management failed (non-fatal, using vectorbt prices): {_c4_err}", file=sys.stderr)
            vbt_managed_trades = []

    if trades_records is not None:
        # Compute correct dollar P&L per trade:
        #   gross = (exit - entry) × size × point_value  (long)
        #   gross = (entry - exit) × size × point_value  (short)
        #   slippage = per-bar slippage at entry/exit bars (SYMMETRIC: both use
        #              slippage_arr[bar_idx] which includes the bar's session multiplier)
        #   commission = commission_per_side × size × 2  (roundtrip)
        #   net_pnl = gross - slippage - commission
        #
        # HIGH #5 — Symmetric exit slippage (Wave 27.5 Pass C.1):
        # slippage_arr[exit_idx] carries the exit bar's session multiplier automatically.
        # This means crisis-session exits (overnight, FOMC, etc.) are penalized at the
        # same session-multiplied rate as entries in that session.
        # See BACKTEST_EXIT_SLIPPAGE_SYMMETRIC env var in the slippage computation above.
        trade_pnls_list = []
        _h5_entry_slips: list[float] = []
        _h5_exit_slips: list[float] = []

        # MED #5 (Wave 27.5 Pass D.1) — Roll spread cost setup.
        # Import once, collect audit rows per roll day encountered.
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        _has_rollover_col = "is_rollover_day" in df.columns
        _ts_et_list_roll = df["ts_et"].to_list() if "ts_et" in df.columns else (
            df["ts_event"].to_list() if "ts_event" in df.columns else []
        )
        _roll_spread_audit_rows: list[dict] = []

        for trade_i, (_, row) in enumerate(trades_records.iterrows()):
            entry_p = float(row["Avg Entry Price"])
            size = float(row["Size"])
            direction = str(row["Direction"])
            entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0

            # C4: Use managed exit price (correct intraday stop/TP price) when
            # available; fall back to vectorbt's bar-close exit price otherwise.
            if trade_i < len(vbt_managed_trades):
                mgmt = vbt_managed_trades[trade_i]
                exit_p = mgmt["exit_price"]
                exit_idx = mgmt["exit_idx"]
                exit_reason = mgmt.get("exit_reason", "signal")
            else:
                exit_p = float(row["Avg Exit Price"])
                exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(slippage_clean) - 1)
                exit_reason = "signal"

            # H2 FIX: Real brokers charge per integer contract only.
            # Fractional sizes (e.g. 4.3) from risk-derived sizing must be floored
            # before computing both commission and P&L. Decision: FLOOR (not round)
            # because a partial contract cannot be executed — flooring is conservative.
            int_size = int(size)  # floor to tradeable contracts
            if int_size < 1:
                int_size = 1  # minimum 1 contract

            if "Short" in direction:
                gross = (entry_p - exit_p) * int_size * spec.point_value
            else:
                gross = (exit_p - entry_p) * int_size * spec.point_value

            # Per-trade friction: per-bar slippage at entry + exit bars.
            # HIGH #5: slippage_clean[exit_idx] automatically applies the exit bar's
            # session multiplier (slippage_arr was computed with session_multipliers
            # for all bars). Symmetric slippage is thus enforced by construction.
            entry_slip = float(slippage_clean[entry_idx]) if entry_idx < len(slippage_clean) else 0.0
            exit_slip = float(slippage_clean[exit_idx]) if exit_idx < len(slippage_clean) else 0.0
            slip_cost = (entry_slip + exit_slip) * int_size
            # H2 FIX: commission charged on integer contracts only.
            comm_cost = commission * int_size * 2

            # MED #5 (Wave 27.5 Pass D.1) — Itemised roll spread cost.
            # On rollover days the entry bar carries an extra spread cost (2-4 ticks)
            # that the generic 1.5-tick slippage model underestimates.
            # Deduct BEFORE generic slippage; generic slippage still applies on top.
            _roll_cost_usd = 0.0
            if _has_rollover_col and entry_idx < len(df):
                try:
                    _is_roll_day = bool(df["is_rollover_day"][entry_idx])
                except Exception:
                    _is_roll_day = False
                if _is_roll_day:
                    try:
                        _roll_ts_str = str(_ts_et_list_roll[entry_idx]) if entry_idx < len(_ts_et_list_roll) else ""
                        from datetime import date as _date_cls
                        _roll_date = _date_cls.fromisoformat(_roll_ts_str[:10])
                        _roll_cost = compute_roll_spread_cost(config.symbol, _roll_date, int_size)
                        _roll_cost_usd = float(_roll_cost)
                        _roll_spread_audit_rows.append(
                            build_roll_spread_audit(config.symbol, _roll_date, int_size, _roll_cost)
                        )
                    except Exception as _re:
                        print(
                            f"[roll-spread] Error computing roll cost at bar {entry_idx}: {_re}",
                            file=sys.stderr,
                        )

            net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd

            trade_pnls_list.append(net_pnl)
            _h5_entry_slips.append(entry_slip)
            _h5_exit_slips.append(exit_slip)

            trade: dict = {}
            for col in trades_records.columns:
                val = row[col]
                if hasattr(val, "isoformat"):
                    trade[col] = val.isoformat()
                elif isinstance(val, (np.integer, np.floating)):
                    trade[col] = round(float(val), 4)
                else:
                    trade[col] = val
            trade["Avg Exit Price"] = round(exit_p, 4)
            trade["exit_reason"] = exit_reason
            trade["PnL"] = round(net_pnl, 2)
            trade["GrossPnL"] = round(gross, 2)
            trade["SlippageCost"] = round(slip_cost, 2)
            trade["CommissionCost"] = round(comm_cost, 2)
            trade["RollSpreadCost"] = round(_roll_cost_usd, 4)

            # ─── Per-trade R:R (reward / risk) ─────────────────────
            # Risk = ATR at entry × atr_sl_mult × point_value (1R stop in $)
            # L3 FIX: Read atr_multiplier from config instead of hardcoded 2.0.
            # The W23-D R-multiple gate depends on this being correct.
            atr_col_name = "atr_14"
            atr_at_entry = float(df[atr_col_name][entry_idx]) if atr_col_name in df.columns and entry_idx < len(df) else 0.0
            sl_mult = float(config.stop_loss.multiplier) if hasattr(config, "stop_loss") and config.stop_loss else 1.5  # L3 fix: use config multiplier, fall back to 1.5
            risk_points = min(atr_at_entry * sl_mult, 6.0)  # 6pt max cap
            risk_dollars = risk_points * spec.point_value
            if risk_dollars > 0 and size > 0:
                reward_dollars = net_pnl / size
                trade["rr"] = round(reward_dollars / risk_dollars, 2)
            else:
                trade["rr"] = 0.0

            # ─── Per-trade MAE/MFE ($ excursion from entry) ───────
            # MAE = max adverse move in $ (always positive = how far against you)
            # MFE = max favorable move in $ (always positive = how far in your favor)
            try:
                ei = max(0, entry_idx + 1)
                xi = min(exit_idx + 1, len(high_np))
                if xi > ei:
                    bar_highs = high_np[ei:xi]
                    bar_lows = low_np[ei:xi]
                    if "Short" in direction:
                        trade_mae = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                        trade_mfe = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                    else:
                        trade_mae = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                        trade_mfe = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                    trade["mae"] = max(0.0, trade_mae)
                    trade["mfe"] = max(0.0, trade_mfe)
                else:
                    trade["mae"] = 0.0
                    trade["mfe"] = 0.0
            except Exception as exc:
                print(f"WARNING: MAE/MFE computation failed for trade {len(trades_list)}: {exc}", file=sys.stderr)
                trade["mae"] = None
                trade["mfe"] = None

            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 0.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve from per-trade data ─────────────────
    # Uses per-trade entry/exit data so equity matches per-trade P&L exactly.
    # Same approach as run_class_backtest(): mark-to-market bar-by-bar per
    # trade with friction deducted once on entry/exit bars.
    close_arr = close_pd.values
    n_bars = len(close_arr)
    bar_dollar_pnls = np.zeros(n_bars)

    if trades_list:
        for trade in trades_list:
            t_entry_idx = int(trade.get("Entry Idx", 0))
            t_exit_idx = int(trade.get("Exit Idx", t_entry_idx + 1))
            t_entry_p = float(trade.get("Avg Entry Price", 0))
            t_exit_p = float(trade.get("Avg Exit Price", 0))
            # F-6 FIX: Use int() to match the integer contract count used in P&L
            # computation. float(Size) was correct today (sizes are integer-valued
            # floats) but would silently misreconcile if fractional-Kelly sizing is
            # ever introduced. Both paths must agree: int(size) floors to tradeable
            # contracts, consistent with H2 FIX in the P&L loop above.
            t_size = int(trade.get("Size", 1))
            if t_size < 1:
                t_size = 1
            t_dir = str(trade.get("Direction", "Long"))
            is_short = "Short" in t_dir
            sign = -1.0 if is_short else 1.0

            # Entry bar mark-to-market: entry_price → bar close
            if t_entry_idx < n_bars:
                bar_close = float(close_arr[t_entry_idx])
                bar_dollar_pnls[t_entry_idx] += sign * (bar_close - t_entry_p) * t_size * spec.point_value

            # Intermediate bars: close-to-close mark-to-market
            prev_price = float(close_arr[t_entry_idx]) if t_entry_idx < n_bars else t_entry_p
            for bar in range(t_entry_idx + 1, min(t_exit_idx, n_bars)):
                bar_close = float(close_arr[bar])
                bar_dollar_pnls[bar] += sign * (bar_close - prev_price) * t_size * spec.point_value
                prev_price = bar_close

            # Exit bar: prev close → exit price
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] += sign * (t_exit_p - prev_price) * t_size * spec.point_value

            # Friction Fix 2: split friction across entry and exit bars for accurate daily metrics.
            # Previously all friction landed on the entry bar, biasing daily Sharpe and calendar
            # analytics (entry days too negative, exit days too positive). Total is unchanged so
            # the reconciliation check below still passes.
            slip_cost = float(trade.get("SlippageCost", 0))
            comm_cost = float(trade.get("CommissionCost", 0))
            entry_slip = float(trade.get("EntrySlipCost", slip_cost / 2.0))
            exit_slip = float(trade.get("ExitSlipCost", slip_cost / 2.0))
            half_comm = comm_cost / 2.0
            if t_entry_idx < n_bars:
                bar_dollar_pnls[t_entry_idx] -= (entry_slip + half_comm)
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] -= (exit_slip + half_comm)
            assert abs((entry_slip + half_comm) + (exit_slip + half_comm) - (slip_cost + comm_cost)) < 0.01, (
                f"Friction split invariant: entry_slip={entry_slip:.4f}, exit_slip={exit_slip:.4f}, "
                f"comm={comm_cost:.4f}, expected_total={slip_cost + comm_cost:.4f}"
            )

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

    # MED #2 (Wave 27.5 Pass D.1): extract ts_et list for DST-aware aggregation.
    # ts_et is Eastern Time (set by data_loader.py) — no UTC offset arithmetic needed.
    _ts_et_list_eq = df["ts_et"].to_list() if "ts_et" in df.columns else None
    _dst_transitions = _detect_dst_transitions(_ts_et_list_eq or [])

    # Reconciliation: equity total must match sum of per-trade P&Ls (Golden Rule)
    if len(trade_pnls_arr) > 0 and len(equity) > 0:
        equity_total = float(equity[-1] - STARTING_CAPITAL)
        trades_total = float(np.sum(trade_pnls_arr))
        reconciliation_error = abs(equity_total - trades_total)
        if reconciliation_error > 1.0:
            raise ValueError(
                f"RECONCILIATION FAILED: equity={equity_total:.2f}, "
                f"trades={trades_total:.2f}, diff={reconciliation_error:.2f}. "
                f"Results are untrustworthy."
            )

    # F-11 FIX: pass STARTING_CAPITAL so the first day's P&L is correctly anchored.
    # MED #2: pass ts_et_index for DST-safe daily grouping.
    daily_pnl_records = _compute_daily_pnls(
        equity, equity_index, starting_capital=STARTING_CAPITAL,
        ts_et_index=_ts_et_list_eq,
    )
    daily_pnl_values = [d["pnl"] for d in daily_pnl_records]

    winning_days = sum(1 for p in daily_pnl_values if p > 0)
    total_trading_days = len(daily_pnl_values)
    avg_daily_pnl = float(np.mean(daily_pnl_values)) if daily_pnl_values else 0.0

    max_consec_losers = 0
    streak = 0
    for p in daily_pnl_values:
        if p < 0:
            streak += 1
            max_consec_losers = max(max_consec_losers, streak)
        else:
            streak = 0

    total_pnl_dollars = float(equity[-1] - STARTING_CAPITAL)
    total_return = total_pnl_dollars  # Dollar P&L — futures are margin instruments, % is misleading
    peak = np.maximum.accumulate(equity)
    drawdown_dollars = peak - equity  # Dollar drawdown (positive = how much lost from peak)
    max_dd = float(np.max(drawdown_dollars)) if len(drawdown_dollars) > 0 else 0.0  # Max $ lost from peak

    if len(daily_pnl_values) > 1:
        daily_arr = np.array(daily_pnl_values)
        sharpe = float(np.mean(daily_arr) / np.std(daily_arr, ddof=1) * np.sqrt(252)) if np.std(daily_arr, ddof=1) > 0 else 0.0
    else:
        sharpe = 0.0

    # ─── A13: Information Ratio vs market benchmark ───────────────
    # Benchmark selection:
    #   ES, NQ, MES, MNQ → SPX (S&P 500 index daily price changes)
    #   MCL              → USO-proxy (crude oil spot daily price changes)
    # Both benchmark series are derived from the same OHLCV price data we
    # already have loaded (df).  We compute daily close-to-close returns
    # from the underlying price data for the same dates as our strategy's
    # daily P&L records.  This gives a buy-and-hold benchmark in the same
    # price space so IR is meaningful.
    #
    # Dollar-return scaling: benchmark daily $ move = price_change × 1 unit
    # Strategy daily P&L is already in dollars. To make them comparable we
    # convert benchmark to a dollar-normalised series with the same scale as
    # the strategy's per-day P&L so the active-return difference is in dollars
    # (same units → σ_diff is a $ std-dev, IR is dimensionless ratio).
    #
    # When the price data does not span enough dates, information_ratio = None.
    information_ratio: Optional[float] = None
    try:
        from src.engine.risk_metrics import compute_information_ratio as _compute_ir

        _BENCHMARK_SYMBOLS = {"ES", "NQ", "MES", "MNQ"}  # SPX proxy
        # For both SPX-proxy and USO-proxy we use the loaded futures close prices
        # as the benchmark: the underlying futures price series IS the index
        # (MES/MNQ track S&P 500 / Nasdaq 100 directly).
        # Close-to-close daily returns in price-point space:
        if "ts_event" in df.columns and len(daily_pnl_records) > 1:
            # Build a date-keyed lookup of daily close prices
            _close_np = df["close"].to_numpy()
            _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
            _dates_series = df[_ts_col]

            # Map each daily P&L record date to first bar's close in that day
            _date_to_close: dict[str, float] = {}
            for _i in range(len(df)):
                _day = str(_dates_series[_i])[:10]
                if _day not in _date_to_close:
                    _date_to_close[_day] = float(_close_np[_i])

            # Daily benchmark returns (close-to-close price change on trading days)
            _pnl_dates = [r["date"] for r in daily_pnl_records]
            _sorted_dates = sorted(_date_to_close.keys())
            _bench_by_date: dict[str, float] = {}
            for _di in range(1, len(_sorted_dates)):
                _d_curr = _sorted_dates[_di]
                _d_prev = _sorted_dates[_di - 1]
                if _d_prev in _date_to_close and _d_curr in _date_to_close:
                    _bench_by_date[_d_curr] = _date_to_close[_d_curr] - _date_to_close[_d_prev]

            # Align benchmark to the exact strategy trading dates
            # Strategy daily P&L is in dollars; benchmark is in price-point units.
            # Multiply benchmark point-move by spec.point_value so both series are
            # in dollars (1 contract buy-and-hold as the dollar benchmark).
            _bm_returns = np.array([
                _bench_by_date.get(r["date"], 0.0) * spec.point_value
                for r in daily_pnl_records
            ], dtype=np.float64)

            _strat_returns = np.array(daily_pnl_values, dtype=np.float64)

            if len(_strat_returns) > 1 and len(_bm_returns) > 1:
                information_ratio = round(
                    _compute_ir(_strat_returns, _bm_returns, periods_per_year=252.0), 4
                )
    except Exception as _ir_exc:
        print(f"WARNING: information_ratio computation failed: {_ir_exc}", file=sys.stderr)
        information_ratio = None
    # ─────────────────────────────────────────────────────────────

    # Cap infinite values for JSON
    if profit_factor == float("inf"):
        profit_factor = 999.99
    if winner_loser_ratio == float("inf"):
        winner_loser_ratio = 999.99

    # ─── Overnight gap risk (Task 3.9) ───────────────────────
    gap_adjusted_dd = None
    if config.overnight_hold and "ts_event" in df.columns and trades_list:
        from src.engine.gap_risk import (
            compute_gap_adjusted_drawdown,
            compute_gap_adjusted_mae,
            compute_overnight_gaps,
            tag_trades_overnight,
        )
        gaps = compute_overnight_gaps(df)
        trades_list = tag_trades_overnight(trades_list, df["ts_event"])
        trades_list = compute_gap_adjusted_mae(
            trades_list, gaps, symbol=config.symbol, seed=42,
        )
        gap_adjusted_dd = compute_gap_adjusted_drawdown(
            [round(float(v), 2) for v in equity],
            trades_list, gaps,
            symbol=config.symbol,
            point_value=spec.point_value,
            seed=42,
        )

    elapsed_ms = int((time.time() - start_time) * 1000)

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe, winner_loser_ratio=winner_loser_ratio)

    # ─── Performance gate (B-3) ───────────────────────────────
    from src.engine.performance_gate import check_performance_gate, classify_tier
    from src.engine.performance_gate import compute_forge_score as _pgate_forge_score
    _gate_stats = {
        "avg_daily_pnl": avg_daily_pnl,
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "total_trades": total_trades,
        "profit_factor": profit_factor,
        "sharpe_ratio": sharpe,
        "max_drawdown": max_dd,
        "max_consecutive_losing_days": max_consec_losers,
        "avg_winner_to_loser_ratio": winner_loser_ratio,
        "recovery_days_from_max_dd": _compute_recovery_days_from_max_dd(daily_pnl_records),
        **_compute_monthly_survival_stats(daily_pnl_records),
    }
    gate_passed, gate_rejections = check_performance_gate(_gate_stats)
    gate_tier = classify_tier(_gate_stats)
    # Fix 1 / P1-F: Replace private _compute_forge_score (no crisis veto, no survival) with the
    # authoritative performance_gate.compute_forge_score. MC/crisis/survival args are None
    # here — they are not computed yet at this point in run_backtest(). compute_forge_score
    # handles None gracefully (crisis_veto=False, survival_component=0).
    #
    # P1-F NOTE: Single (non-walk-forward) backtests compute forge_score WITHOUT MC or crisis
    # results because MC runs AFTER this point. The forge_score here will be lower than the
    # full score (no MC survival bonus, no crisis bonus). The CLI path (main()) recalculates
    # with full inputs after stress test. The API path (run_backtest() direct) returns the
    # partial score — this is intentional and documented. The lifecycle gate (forgeScore >= 50)
    # uses the PARTIAL score on first backtest; the full score is available after MC + stress test.
    # Gate safety: compute_forge_score() without MC/crisis will NOT produce false positives —
    # a strategy passing forgeScore >= 50 without MC bonus is genuinely strong on core metrics.
    # It may produce false negatives (strategies that would pass only WITH MC bonus are deferred).
    _full_forge_result = _pgate_forge_score(
        _gate_stats,
        mc_results=None,
        crisis_results=None,
        survival_results=None,
    )
    forge_score = _full_forge_result["score"]
    if not gate_passed:
        print(f"Performance gate REJECTED: {'; '.join(gate_rejections[:3])}", file=sys.stderr)

    # ─── Governor replay (B-4) ─────────────────────────────────
    from src.engine.governor.governor_backtest import backtest_governor
    _gov_trades = [
        {
            "pnl": float(t.get("PnL", 0)),
            "mae": float(t.get("mae", 0) or 0),
            "contracts": max(1, int(float(t.get("Size", 1)))),
            "entry_time": t.get("Entry Timestamp", t.get("Entry Idx", "")),
        }
        for t in trades_list
    ]
    # Pull daily_loss_limit from firm config (Topstep=$1K, Apex=$1K, Earn2Trade=$1.1K).
    # Firms without a daily loss limit (None) default to $500 as a conservative safety net.
    _gov_daily_budget = 500.0
    if request.firm_key:
        from src.engine.firm_config import FIRM_RULES
        _firm_rules = FIRM_RULES.get(request.firm_key, {})
        _gov_daily_budget = _firm_rules.get("daily_loss_limit") or 500.0
    governor_result = backtest_governor(_gov_trades, daily_loss_budget=_gov_daily_budget)
    if governor_result["governed"]["trades_blocked"] > 0:
        print(
            f"Governor: {governor_result['governed']['trades_blocked']} trades blocked, "
            f"DD reduced {governor_result['improvement']['dd_reduction_pct']:.0f}%",
            file=sys.stderr,
        )

    # ─── Fixed sizing warning (B-7) ──────────────────────────
    if config.position_size.type == "fixed":
        print("WARNING: Fixed position sizing detected. Use dynamic_atr for production.", file=sys.stderr)

    # ─── Sanity checks + cross-validation ─────────────────────
    _prelim = {
        "total_return": round(total_return, 6), "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6), "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4), "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2), "total_trading_days": total_trading_days,
        "trades": trades_list, "daily_pnls": daily_pnl_values,
        "equity_curve": _aggregate_equity_daily(equity, equity_index, ts_et_index=_ts_et_list_eq),
    }
    sanity = run_sanity_checks(_prelim, symbol=config.symbol, timeframe=config.timeframe)
    cross_val = run_cross_validation(_prelim)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=config.symbol, account_size=50_000,
        overnight_hold=config.overnight_hold,
    )

    # ─── Advanced analytics (calendar, session, MAE/MFE) ──
    analytics = compute_full_analytics(daily_pnl_records, trades_list)

    # ─── Task 3.5: Win rate per-trade AND per-day ────────────
    win_rate_per_trade = len([t for t in trades_list if float(t.get("PnL", t.get("pnl", 0))) > 0]) / max(total_trades, 1)
    win_rate_per_day = winning_days / max(total_trading_days, 1)

    # ─── Task 3.6: Long/short split metrics ──────────────────
    long_short_split = _compute_long_short_split(trades_list)

    # ─── Task 3.7: Minimum sample size & confidence intervals ─
    statistical_warnings: list[str] = []
    if total_trades < MINIMUM_TRADES:
        statistical_warnings.append(f"Only {total_trades} trades — statistically unreliable (need {MINIMUM_TRADES}+)")
    if long_short_split["long"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["long"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['long']['trades']} long trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")
    if long_short_split["short"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["short"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['short']['trades']} short trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")

    # Wilson score CI for win rate (no scipy)
    win_rate_ci = _wilson_ci(winning_days, total_trading_days)

    # Sharpe CI (approximate)
    if total_trading_days > 1:
        # Lo (2002) formula: SE(Sharpe) = sqrt((1 + sharpe^2/2) / n)
        sharpe_se = ((1 + sharpe ** 2 / 2) / total_trading_days) ** 0.5
        sharpe_ci = (round(sharpe - 1.96 * sharpe_se, 4), round(sharpe + 1.96 * sharpe_se, 4))
    else:
        sharpe_ci = (0.0, 0.0)

    sample_confidence = "HIGH" if total_trades >= 500 else "MEDIUM" if total_trades >= 200 else "LOW"

    # ─── A7: Build signal vector for correlation check ───────────
    # Combine pre-roll long/short entries into int8 signal vector:
    #   1 = long entry, -1 = short entry, 0 = no signal.
    # Where both long and short fire on the same bar (shouldn't happen in
    # practice but possible in rare edge cases), long takes priority.
    # Stored as Python list[int] for JSON serialization — TS side compresses
    # to gzip int8 bytes before DB storage (zlib.gzipSync).
    _signal_vector_np = np.zeros(len(_pre_roll_long_np), dtype=np.int8)
    _signal_vector_np[_pre_roll_long_np.astype(bool)] = 1
    # Apply short entries where not already long (long takes priority)
    _short_only_mask = _pre_roll_short_np.astype(bool) & (~_pre_roll_long_np.astype(bool))
    _signal_vector_np[_short_only_mask] = -1
    signal_vector = _signal_vector_np.tolist()

    # P1-B fix: assign to local variable FIRST, run determinism check, THEN return.
    # Previously `return {...}` at this point made the verification block (below) dead
    # code — the function exited before reaching it. Now `result` exists for the
    # verification block to reference (line ~1827), and the single `return result`
    # at the bottom is the only exit point.
    result = {
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "win_rate_per_trade": round(win_rate_per_trade, 4),
        "win_rate_per_day": round(win_rate_per_day, 4),
        "profit_factor": round(profit_factor, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2),
        "avg_daily_pnl": round(avg_daily_pnl, 2),
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "max_consecutive_losing_days": max_consec_losers,
        "expectancy_per_trade": round(
            (len(winners) / total_trades) * avg_winner - (len(losers) / total_trades) * avg_loser
            if len(winners) > 0 and len(losers) > 0 and total_trades > 0
            else avg_trade_pnl,
            2,
        ),
        "avg_winner_to_loser_ratio": round(winner_loser_ratio, 4),
        "avg_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None])), 2) if trades_list else 0.0,
        "avg_winner_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0])), 2) if any(t.get("rr", 0) > 0 for t in trades_list) else 0.0,
        "avg_loser_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] < 0])), 2) if any(t.get("rr", 0) < 0 for t in trades_list) else 0.0,
        # MED #2: pass ts_et_index for DST-safe daily aggregation.
        "equity_curve": _aggregate_equity_daily(equity, equity_index, ts_et_index=_ts_et_list_eq),
        # WF Fix 1: raw bar-level equity for intraday max DD calculation in walk_forward.py.
        # daily-aggregated equity_curve misses intraday swings — this field preserves them.
        # Downstream: walk_forward.py reads this to compute continuous bar-level max_dd.
        "equity_bars": equity.tolist(),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        # P0-1 fix: forge_score is the SCALAR float for the TS bridge.
        # The TS bridge persists String(result.forge_score) — if this were the full
        # compute_forge_score() dict, it would serialize as "[object Object]" and the
        # DB would store garbage. The scalar ensures forgeScore >= 50 lifecycle gate works.
        "forge_score": forge_score,
        # forge_score_components carries the full compute_forge_score() output dict
        # (score, passed, crisis_veto, crisis_veto_reason, components, tier).
        # Downstream analytics that need component breakdown should read this key,
        # not forge_score itself.
        "forge_score_components": _full_forge_result,
        "sanity_checks": sanity,
        # A13: Information Ratio (Sharpe vs market benchmark).
        # None when price data insufficient; downstream TS bridge writes to
        # backtests.information_ratio (migration 0083).
        "information_ratio": information_ratio,
        "cross_validation": cross_val,
        "sortino_ratio": cross_val.get("sortino_ratio", 0.0),
        "bootstrap_ci_95": cross_val.get("bootstrap_ci_95", [0, 0]),
        "deflated_sharpe": cross_val.get("deflated_sharpe", {}),
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
        "decay_analysis": _compute_decay_analysis(daily_pnl_values, trades_list),
        "over_risk_bars": over_risk_count,
        "over_risk_pct": round(over_risk_count / max(len(df), 1) * 100, 2),
        "prop_compliance": prop_compliance,
        "analytics": analytics,
        "long_short_split": long_short_split,
        "confidence_intervals": {
            "win_rate_95ci": win_rate_ci,
            "sharpe_95ci": sharpe_ci,
        },
        "statistical_warnings": statistical_warnings,
        "sample_confidence": sample_confidence,
        "run_receipt": _build_run_receipt(config, dataset_hash=compute_dataset_hash(df)),
        # Fix 1: gate_result now carries the full performance_gate.compute_forge_score() output.
        # Keys: score, passed, crisis_veto, crisis_veto_reason, components{...}.
        # tier and gate_rejections are also included for backward compat.
        # CONTRACT for downstream (backtest-service.ts): read result["gate_result"] to persist
        # to backtests.gateResult JSONB column. Required keys at that path:
        #   gate_result.score, gate_result.passed, gate_result.crisis_veto,
        #   gate_result.crisis_veto_reason, gate_result.components,
        #   gate_result.tier, gate_result.gate_rejections
        "gate_result": {
            **_full_forge_result,
            "tier": gate_tier,
            "gate_rejections": gate_rejections,
        },
        "gate_rejections": gate_rejections,
        "governor": {
            "governed_pnl": governor_result["governed"]["pnl"],
            "governed_max_dd": governor_result["governed"]["max_dd"],
            "trades_blocked": governor_result["governed"]["trades_blocked"],
            "trades_reduced": governor_result["governed"]["trades_reduced"],
            "dd_reduction_pct": governor_result["improvement"]["dd_reduction_pct"],
            "lockout_events": governor_result["lockout_events"],
        },
        # A7: Empirical signal vector for cross-correlation checks.
        # Array of int8 per bar: 1=long entry, -1=short entry, 0=no signal.
        # Captured AFTER all gates (eligibility, parity, fill model, max_trades)
        # but BEFORE the next-bar roll — represents "when the strategy decided to enter".
        # TS bridge: backtest-service.ts reads this field, gzips it, and persists
        # to strategy_signal_vectors (migration 0072). Non-empty only for completed
        # backtests. Empty list fallback if n_bars == 0.
        # Determinism: fully determined by the same input data + config as all other
        # result fields. DETERMINISM_MODE=true produces bit-identical vectors.
        "signal_vector": signal_vector,
        # Engine audit metadata — new fields from accuracy fix pass (2026-05-19).
        # These fields let the operator audit how often each defensive path fired.
        "engine_audit": {
            "gap_through_stop_count": vbt_gap_through_count,
            "tick_rounding_applied": True,  # C1: always applied post-fix
            "integer_size_applied": True,   # H2: always applied post-fix
            "dll_halt_used_estimate": True,  # L4: DLL halt uses ATR estimate
            "forge_score_version": _full_forge_result.get("forge_score_version", "unknown"),
            # W23H.3: count of entry signals masked by allowed_entry_windows (0 when no windows configured)
            "skipped_outside_window_count": skipped_outside_window_count,
            # HIGH #5 — Symmetric exit slippage audit (Wave 27.5 Pass C.1).
            # session_mult_avg: average session multiplier applied to entry/exit slips.
            # asymmetry_delta: difference between entry avg and exit avg — should be ~0
            #   in symmetric mode (both use their own bar's multiplier).
            #   Non-zero indicates a mixed-session run (entries in RTH, exits overnight, etc.)
            #   — this is EXPECTED and NOT a bug.  It reflects real-world conditions.
            "exit_slippage_session_applied": {
                "symmetric_mode": _exit_slippage_symmetric,
                "entries_session_mult_avg": round(
                    float(np.mean(_h5_entry_slips)) if _h5_entry_slips else 0.0, 4
                ),
                "exits_session_mult_avg": round(
                    float(np.mean(_h5_exit_slips)) if _h5_exit_slips else 0.0, 4
                ),
                "asymmetry_delta": round(
                    (float(np.mean(_h5_exit_slips)) - float(np.mean(_h5_entry_slips)))
                    if _h5_entry_slips and _h5_exit_slips else 0.0,
                    4,
                ),
                "n_trades": len(_h5_entry_slips),
            },
            # HIGH #6 — Partial fill model audit (Wave 27.5 Pass C.1).
            "partial_fill_modeled": _partial_fill_audit if _partial_fill_audit else {
                "enabled": False,
                "total_orders": 0,
                "partial_fills": 0,
                "avg_fill_ratio": 1.0,
                "avg_slippage_delta_per_partial": 0.0,
            },
        },
        # CRITICAL #1 — DSL guard summary (E.3/E.4/E.5 enforcement).
        # Additive field: downstream consumers that don't read it are unaffected.
        # - stop_ceiling_skips: entries killed by ATR stop > ceiling (E.3)
        # - time_stop_exits:    exits set by 15:55 ET hard-flat (E.5)
        # - dll_halt_blocks:    entries suppressed by personal-DLL breach (E.4)
        # - vol_scale_applied:  True when VIX-driven vol scale != 1.0 (Wave 24 Pass 2)
        # - liquidity_haircut_applied: True when depth-ratio haircut != 1.0 (Wave 24 Pass 2)
        # All counts are 0 when guards are not applicable (e.g. unit-test data
        # that has no 15:55 bar, or ATR always under ceiling).
        "dsl_guards": {
            **_dsl_guards_meta,
            "vol_scale_applied": _parity_metadata["vol_scale_applied"],
            "liquidity_haircut_applied": _parity_metadata["liquidity_haircut_applied"],
        },
        # Wave 24 Pass 2 — parity metadata: documents the adjustments applied
        # to align backtest sizing with paper-engine sizing. Enables operator to
        # see at a glance whether the backtest ran with or without VIX scaling.
        "parity_metadata": _parity_metadata,
        # W27.5 C.2 — parity gate stats: compliance gate enforcement summary.
        # TS side reads run_receipt.parity_long / run_receipt.parity_short to
        # compute compliance aggregation for Discord warning.
        "parity_gate": {
            "long": _parity_long,
            "short": _parity_short,
        },
    }
    # Also embed parity gate stats in run_receipt for backward-compat TS readers.
    # This is done after the result dict is built to avoid mutating run_receipt template.
    if isinstance(result.get("run_receipt"), dict):
        result["run_receipt"]["parity_long"] = _parity_long
        result["run_receipt"]["parity_short"] = _parity_short

    # ─── MED #2 (Wave 27.5 Pass D.1) — DST boundary audit ───────────────────────
    # Additive field: records which DST transitions fell within the backtest date
    # range.  Consumers may use this to flag drawdown values computed near the
    # transition as subject to the cosmetic off-by-1-hour edge case.
    if _dst_transitions:
        result["dst_boundary_processed"] = {
            "transitions": _dst_transitions,
            "ts_et_used": _ts_et_list_eq is not None,
            "count": len(_dst_transitions),
        }
    else:
        result["dst_boundary_processed"] = {
            "transitions": [],
            "ts_et_used": _ts_et_list_eq is not None,
            "count": 0,
        }

    # ─── MED #4 (Wave 27.5 Pass D.1) — VIX margin expansion audit ───────────────
    # Populated from _margin_expansion_audit_dsl set during sizing (see below).
    # Additive field: None when VIX data column absent or no expansion triggered.
    if "_margin_expansion_audit_dsl" in dir():
        result["margin_expansion_audit"] = _margin_expansion_audit_dsl  # noqa: F821

    # ─── MED #5 (Wave 27.5 Pass D.1) — Roll spread cost audit ───────────────────
    # Populated from _roll_spread_audit_rows set during P&L computation (see below).
    # Additive list: empty when no roll days in date range or itemisation disabled.
    if "_roll_spread_audit_rows" in dir():
        result["roll_spread_costs"] = _roll_spread_audit_rows  # noqa: F821

    # ─── Pass B-2: Invariant Harness (always runs — cheap pure validation) ───
    # Runs AFTER result dict is fully assembled, BEFORE determinism check.
    # Catches balance-arithmetic drift, P&L sum mismatches, metric corruption.
    # Never env-gated: pure dict computation, no I/O, no new dependencies.
    try:
        from src.engine.invariant_harness import run_invariants
        _inv_report = run_invariants(result)

        def _serialize_inv_check(c) -> dict:
            return {
                "name": c.name,
                "passed": c.passed,
                "tolerance": c.tolerance,
                "expected": c.expected,
                "actual": c.actual,
                "evidence": c.evidence,
                "severity": c.severity,
            }

        result["invariants"] = {
            "passed": _inv_report.passed,
            "failed": _inv_report.failed,
            "overall_passed": _inv_report.overall_passed,
            "critical_failures": [_serialize_inv_check(c) for c in _inv_report.critical_failures],
            "warnings": [_serialize_inv_check(c) for c in _inv_report.warnings],
        }

        # ── Wave 24 Pass 1 — Item 18: PBO in invariants ──────────────────────
        # Item 19: Honest-PSR DSR (multiple-testing corrected) ───────────────
        # Both are emitted into result["invariants"] after the harness checks.
        # They do NOT affect overall_passed — the promotion gate in TS reads them
        # separately. See lifecycle-service.ts wave24-pbo-promotion-gate checks.
        try:
            from src.engine.risk_metrics import (
                compute_deflated_sharpe_ratio as _compute_dsr_inv,
            )
            from src.engine.risk_metrics import compute_pbo as _compute_pbo_inv

            # ── PBO: computed from walk-forward windows if present ────────────
            _wf_windows = result.get("windows", [])
            _n_obs_inv = max(len(result.get("daily_pnls", [])), 2)
            _total_trades_inv = int(result.get("total_trades", 0))
            _observed_sharpe_inv = float(result.get("sharpe_ratio", 0.0))

            if len(_wf_windows) >= 4:
                _pbo_result = _compute_pbo_inv(_wf_windows, metric="sharpe_ratio")
                _pbo_val = _pbo_result.get("pbo")
                _pbo_threshold = float(os.environ.get("PBO_PROMOTION_THRESHOLD", "0.5"))
                _pbo_flag = (_pbo_val is not None and _pbo_val > _pbo_threshold)
                result["invariants"]["pbo"] = {
                    "value": _pbo_val,
                    "n_trials": _pbo_result.get("n_combinations", 0),
                    "interpretable": (
                        "high" if (_pbo_val is not None and _pbo_val >= 0.4) else
                        "med" if (_pbo_val is not None and _pbo_val >= 0.15) else
                        "low"
                    ),
                    "interpretation": _pbo_result.get("interpretation", ""),
                }
                result["invariants"]["pbo_flag"] = _pbo_flag
            else:
                result["invariants"]["pbo"] = {"not_applicable": True, "reason": "fewer than 4 walk-forward windows"}
                result["invariants"]["pbo_flag"] = False

            # ── Honest DSR: n_trials from WF fold count or MC trial count ────
            # n_trials = number of independent parameter configurations evaluated.
            # For a single-config backtest: n_trials=1 → DSR reduces to raw SR test.
            # For a walk-forward run: n_trials = number of OOS windows (each is a
            # distinct candidate evaluation in the IS optimization search space).
            # For an MC sweep: n_trials is passed via result["mc_n_trials"] if set.
            _n_trials_inv = int(
                result.get("mc_n_trials", 0)
                or len(_wf_windows)
                or 1
            )
            _dsr_threshold = float(os.environ.get("DSR_HONEST_THRESHOLD", "1.5"))

            if _total_trades_inv > 0 and _n_obs_inv > 1:
                _dsr_honest = _compute_dsr_inv(
                    observed_sharpe=_observed_sharpe_inv,
                    n_trials=_n_trials_inv,
                    n_observations=_n_obs_inv,
                )
                _dsr_passed_honest = (
                    _dsr_honest.get("dsr", 0.0) >= _dsr_threshold
                )
                result["invariants"]["dsr_honest"] = {
                    "sr_observed": round(_observed_sharpe_inv, 4),
                    "sr_threshold": _dsr_honest.get("sr_expected_max"),
                    "n_trials": _n_trials_inv,
                    "dsr": _dsr_honest.get("dsr"),
                    "dsr_passed": _dsr_passed_honest,
                    "p_value": _dsr_honest.get("p_value"),
                    "interpretation": _dsr_honest.get("interpretation", ""),
                }
            else:
                result["invariants"]["dsr_honest"] = {
                    "not_applicable": True,
                    "reason": "no trades or insufficient observations",
                }
        except Exception as _pbo_dsr_err:
            print(
                json.dumps({"event": "invariants.pbo_dsr_error", "error": str(_pbo_dsr_err)[:300]}),
                file=sys.stderr,
            )

        if not _inv_report.overall_passed:
            import json as _inv_json
            _inv_payload = {
                "event": "invariant_failure",
                "backtest_id": str(result.get("backtest_id", "")),
                "failed": _inv_report.failed,
                "critical_count": len(_inv_report.critical_failures),
                "critical_failures": [_serialize_inv_check(c) for c in _inv_report.critical_failures],
            }
            print(
                f"INVARIANT_FAILURE_JSON {_inv_json.dumps(_inv_payload)}",
                file=sys.stderr,
            )
    except Exception as _inv_err:
        print(
            json.dumps({"event": "invariants.error", "error": str(_inv_err)[:300]}),
            file=sys.stderr,
        )

    # E7.3 / P1-B: TF_VERIFY_DETERMINISM second-run check.
    # When TF_VERIFY_DETERMINISM=1, run the backtest a second time and compare
    # the JSON hash of both results (excluding timestamp_utc which varies by wall clock).
    # If hashes match, set run_receipt.determinism_verified = True.
    # Skip by default — second run doubles compute time and is expensive in production.
    if os.environ.get("TF_VERIFY_DETERMINISM", "0") == "1":
        try:
            import json as _json

            def _hash_result(r: dict) -> str:
                """Hash backtest result excluding wall-clock timestamp."""
                import copy
                import hashlib
                r_copy = copy.deepcopy(r)
                receipt = r_copy.get("run_receipt", {})
                receipt.pop("timestamp_utc", None)
                return hashlib.sha256(_json.dumps(r_copy, sort_keys=True, default=str).encode()).hexdigest()

            first_hash = _hash_result(result)
            second_run = run_backtest(request, data=data)
            second_hash = _hash_result(second_run)
            is_deterministic = first_hash == second_hash
            result["run_receipt"]["determinism_verified"] = is_deterministic
            if not is_deterministic:
                print(
                    "WARNING: determinism check FAILED — same inputs produced different outputs. "
                    f"first_hash={first_hash[:12]}, second_hash={second_hash[:12]}",
                    file=sys.stderr,
                )
        except Exception as _det_exc:
            print(f"WARNING: determinism verification failed: {_det_exc}", file=sys.stderr)

    # ─── Parity Shadow Pass ────────────────────────────────────────────
    # Non-blocking cross-engine verification. Runs only when
    # PARITY_SHADOW_ENABLED=true (default false). Never allowed to raise.
    # Emits PARITY_SHADOW_DRIFT_JSON to stderr when drift is detected so
    # server-side log capture picks it up for the observability layer.
    if os.environ.get("PARITY_SHADOW_ENABLED", "false").lower() == "true":
        try:
            from src.engine.parity_engine.shadow_runner import run_parity_shadow
            shadow_report = run_parity_shadow(request, result, df)
            result["parity_shadow"] = shadow_report
            if shadow_report.get("ran") and not shadow_report.get("passed", True):
                print(
                    f"PARITY_SHADOW_DRIFT_JSON {json.dumps(shadow_report)}",
                    file=sys.stderr,
                )
        except Exception as e:
            print(
                json.dumps({"event": "parity_shadow.error", "error": str(e)[:300]}),
                file=sys.stderr,
            )

    # C-1 FIX: validate result_extras on EVERY call path (WF workers call run_backtest()
    # directly — they never go through main() which had the only validation block before).
    # Calling _emit_validated_result() here ensures result_extras is stamped for all
    # WF windows, class backtests called from run_walk_forward_class, and CLI.
    if "error" not in result:
        _emit_validated_result(result)

    return result


def _emit_validated_result(result: dict) -> None:
    """Stamp result_extras with Pydantic-validated JSONB contract.

    Called from run_backtest() (all direct callers including WF workers) AND
    from main() after the truthiness/invariant hooks so that CLI output also
    validates. Idempotent: if result already has a non-None result_extras this
    is a no-op (avoids double-stamping on the CLI path).

    C-1 FIX: Previously this validation only ran inside main(), so the
    BacktestResultExtras B-2 truthiness gate was dead for every WF-promoted
    strategy (walk_forward.py workers call run_backtest() directly, never main()).
    """
    # Already stamped — skip (CLI path calls both run_backtest and main)
    if result.get("result_extras") is not None:
        return
    try:
        from src.engine.jsonb_contracts import (
            RESULT_EXTRAS_VERSION,
            BacktestResultExtras,
        )
        extras_raw = {
            "schema_version": RESULT_EXTRAS_VERSION,
            "invariants": result.get("invariants"),
            "parity_shadow": result.get("parity_shadow"),
            "metric_drift": result.get("metric_drift"),
        }
        extras_filtered = {k: v for k, v in extras_raw.items() if v is not None}
        if len(extras_filtered) > 1:  # >1 because schema_version is always present
            validated = BacktestResultExtras(**extras_filtered).model_dump(mode="json", exclude_none=True)
            result["result_extras"] = validated
    except ImportError:
        pass  # pydantic or jsonb_contracts not available in this env — skip
    except Exception as _validation_err:
        import json as _jc
        import sys as _sysc
        print(
            _jc.dumps({"event": "result_extras.validation_failed", "error": str(_validation_err)[:500]}),
            file=_sysc.stderr,
        )
        raise


def _compute_recovery_days_from_max_dd(daily_pnl_records: list[dict]) -> int:
    """Count trading days from max-drawdown trough until equity recovers to the peak level.

    Returns the number of days from trough to recovery (or trough to end-of-data if
    equity never recovers).  Returns 0 when there are fewer than 2 records.
    """
    if len(daily_pnl_records) < 2:
        return 0

    # Build cumulative equity curve
    equity = []
    cumulative = 0.0
    for rec in daily_pnl_records:
        cumulative += rec.get("pnl", 0.0)
        equity.append(cumulative)

    # Find peak-to-trough max drawdown
    peak = equity[0]
    peak_idx = 0
    max_dd = 0.0
    dd_peak_idx = 0
    dd_trough_idx = 0

    for i, eq in enumerate(equity):
        if eq >= peak:
            peak = eq
            peak_idx = i
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
            dd_peak_idx = peak_idx
            dd_trough_idx = i

    if max_dd == 0.0:
        return 0

    peak_level = equity[dd_peak_idx]

    # Count days from AFTER the trough until equity recovers to peak level
    recovery_days = 0
    for i in range(dd_trough_idx + 1, len(equity)):
        recovery_days += 1
        if equity[i] >= peak_level:
            break

    return recovery_days


def _compute_monthly_survival_stats(daily_pnl_records: list[dict]) -> dict:
    """Compute worst_month_win_days, avg_loss_on_red_days, avg_win_on_green_days from daily P&Ls."""
    if not daily_pnl_records:
        return {"worst_month_win_days": 0, "avg_loss_on_red_days": 0.0, "avg_win_on_green_days": 0.0}

    from collections import defaultdict
    monthly_wins: dict[str, int] = defaultdict(int)
    monthly_days: dict[str, int] = defaultdict(int)
    red_losses: list[float] = []
    green_wins: list[float] = []

    for rec in daily_pnl_records:
        date_str = rec.get("date")
        pnl = rec.get("pnl", 0.0)
        month_key = date_str[:7] if date_str and len(date_str) >= 7 else "unknown"
        monthly_days[month_key] += 1
        if pnl > 0:
            monthly_wins[month_key] += 1
            green_wins.append(pnl)
        elif pnl < 0:
            red_losses.append(pnl)

    # Only consider months with 10+ trading days (avoid partial months skewing)
    # Iterate monthly_days (not monthly_wins) to include months with 0 winning days
    full_months = [monthly_wins.get(month, 0) for month, days in monthly_days.items() if days >= 10]
    worst_month = min(full_months) if full_months else 0

    avg_loss_red = float(np.mean(red_losses)) if red_losses else 0.0
    avg_win_green = float(np.mean(green_wins)) if green_wins else 0.0

    return {
        "worst_month_win_days": worst_month,
        "avg_loss_on_red_days": round(avg_loss_red, 2),
        "avg_win_on_green_days": round(avg_win_green, 2),
    }


def _compute_tier(avg_daily_pnl: float, winning_days: int, total_trading_days: int,
                   max_dd: float, profit_factor: float, sharpe: float,
                   winner_loser_ratio: float = 0.0) -> str:
    """Classify strategy into TIER_1, TIER_2, TIER_3, or REJECTED per CLAUDE.md gates."""
    # max_dd is now in positive dollars (e.g. 1500 = $1500 max drawdown from peak)
    max_dd_dollars = abs(max_dd)
    win_days_per_20 = (winning_days / max(total_trading_days, 1)) * 20

    # Hard gate: minimum 1:2 R:R — avg win $ / avg loss $ must be >= 2.0
    if winner_loser_ratio < 2.0:
        return "REJECTED"

    if (avg_daily_pnl >= 500 and win_days_per_20 >= 14 and max_dd_dollars < 1500
            and profit_factor >= 2.5 and sharpe >= 2.0):
        return "TIER_1"
    if (avg_daily_pnl >= 350 and win_days_per_20 >= 13 and max_dd_dollars < 2000
            and profit_factor >= 2.0 and sharpe >= 1.75):
        return "TIER_2"
    if (avg_daily_pnl >= 250 and win_days_per_20 >= 12 and max_dd_dollars < 2500
            and profit_factor >= 1.75 and sharpe >= 1.5):
        return "TIER_3"
    return "REJECTED"


def _compute_forge_score(sharpe: float, max_dd: float, profit_factor: float,
                          win_rate: float, avg_daily_pnl: float) -> float:
    """Compute 0-100 Forge Score composite.

    Weights: Sharpe (30%), Drawdown (25%), Profit Factor (20%), Win Rate (15%), Avg Daily (10%)
    Each component scored 0-100 then weighted.
    """
    # Sharpe: 0 at 0, 100 at 3.0+
    sharpe_score = min(100, max(0, (sharpe / 3.0) * 100))

    # Max DD: 100 at $0, 0 at $2500+ (dollar drawdown on $50K account)
    dd_score = min(100, max(0, (1 - abs(max_dd) / 2500) * 100))

    # Profit Factor: 0 at 1.0, 100 at 4.0+
    pf_score = min(100, max(0, ((profit_factor - 1.0) / 3.0) * 100))

    # Win Rate: 0 at 40%, 100 at 80%+
    wr_score = min(100, max(0, ((win_rate - 0.4) / 0.4) * 100))

    # Avg Daily PnL: 0 at $0, 100 at $1000+
    daily_score = min(100, max(0, (avg_daily_pnl / 1000) * 100))

    score = (sharpe_score * 0.30 + dd_score * 0.25 + pf_score * 0.20
             + wr_score * 0.15 + daily_score * 0.10)
    return round(score, 1)


def compute_recency_weighted_score(
    daily_pnl_records: list[dict],
    sharpe: float,
    max_dd: float,
    profit_factor: float,
    win_rate: float,
    avg_daily_pnl: float,
) -> dict:
    """Compute Forge Score with recency weighting.

    Splits daily P&L records into time buckets:
      - Recent 2 years: 50% weight
      - Previous 3 years: 30% weight
      - Older than 5 years: 20% weight

    Also computes a "recent_score" (last 2 years only) to flag strategies
    that only worked historically but fail recently.
    """
    from datetime import datetime, timedelta

    full_score = _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl)

    # F-8 FIX: Anchor cutoff dates to the last date in daily_pnl_records so
    # recency scoring is deterministic and replay-stable across run times.
    # Falls back to datetime.now() only when records are empty (edge case).
    dated_records = [r for r in daily_pnl_records if r.get("date")]
    if dated_records:
        last_date_str = sorted(r["date"] for r in dated_records)[-1]
        now = datetime.strptime(last_date_str, "%Y-%m-%d")
    else:
        now = datetime.now()
    cutoff_2y = (now - timedelta(days=730)).strftime("%Y-%m-%d")
    cutoff_5y = (now - timedelta(days=1825)).strftime("%Y-%m-%d")

    recent = [r for r in daily_pnl_records if r.get("date") and r["date"] >= cutoff_2y]
    mid = [r for r in daily_pnl_records if r.get("date") and cutoff_5y <= r["date"] < cutoff_2y]
    old = [r for r in daily_pnl_records if r.get("date") and r["date"] < cutoff_5y]

    def _bucket_avg(records: list[dict]) -> float:
        if not records:
            return 0.0
        return sum(r["pnl"] for r in records) / len(records)

    recent_avg = _bucket_avg(recent)
    mid_avg = _bucket_avg(mid)
    old_avg = _bucket_avg(old)

    # Weighted average daily P&L
    total_weight = 0.0
    weighted_pnl = 0.0
    if recent:
        weighted_pnl += recent_avg * 0.50
        total_weight += 0.50
    if mid:
        weighted_pnl += mid_avg * 0.30
        total_weight += 0.30
    if old:
        weighted_pnl += old_avg * 0.20
        total_weight += 0.20

    if total_weight > 0:
        weighted_pnl /= total_weight

    # Recent-only score
    recent_win_rate = sum(1 for r in recent if r["pnl"] > 0) / len(recent) if recent else 0
    recent_score = _compute_forge_score(sharpe, max_dd, profit_factor, recent_win_rate, recent_avg)

    # Flag: strategy decaying if recent score < 60% of full score
    decaying = recent_score < (full_score * 0.60) if full_score > 0 else False
    decay_warning = "Edge may be decaying" if decaying else None

    return {
        "full_score": full_score,
        "recent_score": recent_score,
        "weighted_avg_daily_pnl": round(weighted_pnl, 2),
        "recent_avg_daily_pnl": round(recent_avg, 2),
        "mid_avg_daily_pnl": round(mid_avg, 2),
        "old_avg_daily_pnl": round(old_avg, 2),
        "recent_days": len(recent),
        "mid_days": len(mid),
        "old_days": len(old),
        "decaying": decaying,
        "warning": decay_warning,
    }


def _empty_result(error: str, elapsed: float) -> dict:
    """Return an empty result dict on failure."""
    return {
        "total_return": 0.0,
        "sharpe_ratio": 0.0,
        "max_drawdown": 0.0,
        "win_rate": 0.0,
        "win_rate_per_trade": 0.0,
        "win_rate_per_day": 0.0,
        "profit_factor": 0.0,
        "total_trades": 0,
        "avg_trade_pnl": 0.0,
        "avg_daily_pnl": 0.0,
        "winning_days": 0,
        "total_trading_days": 0,
        "max_consecutive_losing_days": 0,
        "expectancy_per_trade": 0.0,
        "avg_winner_to_loser_ratio": 0.0,
        "avg_rr": 0.0,
        "avg_winner_rr": 0.0,
        "avg_loser_rr": 0.0,
        "equity_curve": [],
        "trades": [],
        "daily_pnls": [],
        "daily_pnl_records": [],
        "execution_time_ms": int(elapsed * 1000),
        "error": error,
        "gate_stats": {"total_signals": 0, "total_taken": 0, "total_skipped": 0, "total_reduced": 0, "filter_rate": 0.0},
    }


def run_class_backtest(
    strategy: BaseStrategy,
    start_date: str,
    end_date: str,
    slippage_ticks: float = 1.0,
    commission_per_side: float = 0.62,
    firm_key: Optional[str] = None,
    data: Optional[pl.DataFrame] = None,
    fixed_contracts: Optional[int] = None,
    htf_cache: Optional[dict] = None,
    daily_data: Optional[pl.DataFrame] = None,
    skip_eligibility_gate: bool = False,
    max_trades_per_day: int = 2,
    use_performance_gate: bool = True,
    warmup_data: Optional[pl.DataFrame] = None,
    exit_engine: str = "static_styleC",
    adaptive_ctx=None,  # type: Optional[AdaptiveExitContext] — Wave 25 Gap B
) -> dict:
    """Run a backtest using a BaseStrategy class instance.

    This is the bridge for class-based strategies (ICT strategies in src/engine/strategies/).
    The strategy's compute() method produces entry/exit signals, then we feed those
    into the same vectorbt pipeline as the DSL backtester.

    Args:
        warmup_data: Optional IS (in-sample) data to prepend before running strategy.compute().
            This ensures rolling indicators (e.g., ATR, EMAs) are correctly initialized at
            the OOS boundary — mirrors the run_backtest() warmup_data parameter (E7.2).
            When provided: IS data is prepended to `data`, compute() runs on full IS+OOS
            context, then IS rows are stripped before signal execution. Signals and trades
            are OOS-only. Without this, indicators at the start of each OOS window are
            computed on a cold window (insufficient lookback), producing biased signals.
    """
    start_time = time.time()
    symbol = strategy.symbol
    timeframe = strategy.timeframe
    spec = CONTRACT_SPECS[symbol]

    # ─── P1-A: Warmup data prepend (IS context for indicator initialization) ──
    # Mirror run_backtest warmup_data logic. Prepend IS rows so strategy.compute()
    # has correct rolling window state at the OOS boundary, then strip IS rows
    # from the result before trade execution. Signals are evaluated on OOS only.
    warmup_rows = 0
    if warmup_data is not None and len(warmup_data) > 0:
        warmup_rows = len(warmup_data)
        if data is not None:
            data = pl.concat([warmup_data, data], how="vertical")
        else:
            data = warmup_data  # will be populated by load below; store for post-load prepend
        print(
            f"  Class backtest IS warmup: prepended {warmup_rows} IS bars for indicator init",
            file=sys.stderr,
        )

    # ─── Load data ─────────────────────────────────────────────
    if data is None:
        print(f"Loading {symbol} {timeframe} data...", file=sys.stderr)
        data = load_ohlcv(symbol, timeframe, start_date, end_date)
        # If warmup_data was provided but data was None, we stored warmup in `data` above
        # but then overwrote it — re-prepend warmup here.
        if warmup_data is not None and len(warmup_data) > 0:
            data = pl.concat([warmup_data, data], how="vertical")

    # ─── Load daily data for HTF context (needed by eligibility gate) ──
    if htf_cache is None and daily_data is None:
        try:
            daily_data = load_ohlcv(symbol, "daily", start_date, end_date)
            print(f"Loaded {len(daily_data)} daily bars for HTF context", file=sys.stderr)
        except Exception as e:
            print(f"WARNING: Could not load daily data for HTF gate: {e}", file=sys.stderr)
            daily_data = None

    # ─── W25.4: Load strategy-declared additional TFs (4H, 1H, trigger TF) ──
    # Strategies that declare htf_tf/itf_tf/trigger_tf have those TFs loaded here
    # and passed into compute_htf_context for richer context.
    # Strategies without these declarations get existing 2-TF behaviour (back-compat).
    _four_h_data: "pl.DataFrame | None" = None
    _one_h_data: "pl.DataFrame | None" = None
    if hasattr(strategy, "htf_tf") and strategy.htf_tf:
        _declared_htf_tf = strategy.htf_tf
    elif hasattr(strategy, "bias_timeframe") and strategy.bias_timeframe:
        _declared_htf_tf = strategy.bias_timeframe
    else:
        _declared_htf_tf = None

    if hasattr(strategy, "itf_tf") and strategy.itf_tf:
        _declared_itf_tf = strategy.itf_tf
    else:
        _declared_itf_tf = None

    if _declared_htf_tf and _declared_htf_tf not in ("daily", "1d"):
        try:
            from src.engine.data_loader import load_n_timeframes as _load_n_tfs
            _extra_tfs = [_declared_htf_tf]
            if _declared_itf_tf and _declared_itf_tf != _declared_htf_tf:
                _extra_tfs.append(_declared_itf_tf)
            _loaded = _load_n_tfs(symbol, _extra_tfs, start_date, end_date)
            _four_h_data = _loaded.get(_declared_htf_tf)
            if _declared_itf_tf:
                _one_h_data = _loaded.get(_declared_itf_tf)
            print(
                f"W25.4: loaded extra TFs {_extra_tfs} for {strategy.name}",
                file=sys.stderr,
            )
        except Exception as _e:
            print(
                f"WARNING W25.4: Could not load extra TFs ({_declared_htf_tf}, {_declared_itf_tf}): {_e}",
                file=sys.stderr,
            )

    if htf_cache is None and daily_data is not None and len(daily_data) >= 200:
        from src.engine.context.htf_context import compute_htf_context
        htf_cache = {}
        # Use ts_et for day keys to avoid UTC/ET date mismatch at midnight boundary
        _htf_ts_col = "ts_et" if "ts_et" in daily_data.columns else "ts_event"
        for day_idx in range(200, len(daily_data)):
            bar_date = daily_data[_htf_ts_col][day_idx]
            day_key = str(bar_date)[:10]
            htf_cache[day_key] = compute_htf_context(
                daily_df=daily_data.slice(0, day_idx),
                four_h_df=_four_h_data,
                one_h_df=_one_h_data,
                current_price=float(daily_data["close"][day_idx - 1]),
                bar_date=bar_date,
            )
        print(f"Built HTF cache: {len(htf_cache)} days", file=sys.stderr)

    # ─── Validate bar count ──────────────────────────────────
    _validate_bar_count(data, timeframe, start_date, end_date)

    # ─── Strategy validation gate (static) ───────────────────
    from src.engine.validation import STRATEGY_CONCEPT_MAP, load_spec, validate_static
    concept = STRATEGY_CONCEPT_MAP.get(strategy.name)
    validation_warnings = []
    val_spec = None
    if concept:
        try:
            val_spec = load_spec(concept)
            import inspect
            source_file = inspect.getfile(strategy.__class__)
            static_result = validate_static(source_file, val_spec)
            if not static_result.passed:
                print(f"WARNING: Static validation failed for {strategy.name}: {static_result.errors}", file=sys.stderr)
            validation_warnings.extend(static_result.warnings)
        except Exception as e:
            print(f"WARNING: Could not validate {strategy.name}: {e}", file=sys.stderr)

    # ─── Run strategy compute (produces entry/exit signal columns) ──
    print(f"Running {strategy.name} compute()...", file=sys.stderr)
    df = strategy.compute(data)

    # Verify required signal columns exist
    for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
        if col not in df.columns:
            return _empty_result(
                f"Strategy {strategy.name} compute() missing column: {col}",
                time.time() - start_time,
            )

    # ─── P1-A: Strip IS warmup rows after compute() ─────────────
    # compute() ran on full IS+OOS data for correct indicator init.
    # Now strip the prepended IS rows so signal execution and P&L
    # calculation are OOS-only. Mirrors run_backtest() E7.2 strip.
    if warmup_rows > 0 and len(df) > warmup_rows:
        df = df.slice(warmup_rows)
        print(
            f"  Class backtest IS warmup: stripped {warmup_rows} IS rows — OOS-only for trade execution",
            file=sys.stderr,
        )
    elif warmup_rows > 0:
        print(
            f"  WARNING: warmup_rows={warmup_rows} but df has only {len(df)} rows — skip strip",
            file=sys.stderr,
        )

    # Ensure ATR column exists for sizing/slippage.
    # C-4 VERIFIED: run_class_backtest routes through compute_atr() from
    # indicators/core.py, which applies the Wilder RMA fix (Pass 5 Track B).
    # The strategy.compute() call above may have already populated atr_14 via
    # compute_indicators(); if so, this block is a no-op. Both paths use the
    # same compute_atr() function — no independent ATR computation exists here.
    if "atr_14" not in df.columns:
        atr = compute_atr(df, 14)
        df = df.with_columns(atr.alias("atr_14"))

    # ─── Commission: firm override → explicit value → contract spec default ──
    # G2.3 fix: previous `elif commission == 0.62` branch silently overrode an
    # explicit Tradeify $0.62 fee because 0.62 happened to equal the parameter
    # default sentinel. Mirrors the run_backtest fix at line ~931 — only fall back
    # to the contract spec when no firm was specified.
    commission = commission_per_side
    if firm_key:
        commission = get_commission_per_side(firm_key, symbol)
    elif firm_key is None:  # No firm specified — use contract spec default
        commission = spec.default_commission

    # ─── Firm contract cap ─────────────────────────────────────
    max_contracts = None
    if firm_key and firm_key in FIRM_CONTRACT_CAPS:
        max_contracts = get_contract_cap(firm_key, symbol)

    # ─── Position sizing ────────────────────────────────────────
    from src.engine.config import PositionSizeConfig
    if fixed_contracts is not None:
        size_config = PositionSizeConfig(type="fixed", fixed_contracts=fixed_contracts)
    else:
        size_config = PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500.0)
    sizes, over_risk = compute_position_sizes(df, size_config, spec, 14, max_contracts=max_contracts)
    # Defense-in-depth: replace any inf/nan sizes with 1 contract
    sizes = np.where(np.isfinite(sizes), sizes, 1.0)
    over_risk_count = int(np.sum(over_risk))
    if over_risk_count > 0:
        print(
            f"WARNING: {over_risk_count} bars have ATR-implied risk > target "
            f"for 1 contract (over_risk). Trading 1 contract anyway.",
            file=sys.stderr,
        )

    # ─── Session liquidity multipliers ─────────────────────────
    # Prefer ts_et (Eastern Time) for session filtering — all session logic
    # must use ET, not UTC. ts_et is added by data_loader at load time.
    session_mult = None
    _ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if _ts_col in df.columns:
        session_mult = get_session_multipliers(df[_ts_col])

    # ─── Slippage ──────────────────────────────────────────────
    slippage_arr = compute_slippage(
        df, spec, slippage_ticks, 14,
        session_multipliers=session_mult,
    )

    # ─── Eligibility gate (A+ setup filter) ─────────────────────
    # In backtest mode, skip the gate to see raw strategy performance.
    # Gate is for live/paper A+ filtering, not for backtesting signal quality.
    long_entries_np = df["entry_long"].to_numpy()
    short_entries_np = df["entry_short"].to_numpy()
    long_exits_np = df["exit_long"].to_numpy()
    short_exits_np = df["exit_short"].to_numpy()

    # ─── Strategy validation gate (runtime) ──────────────────
    if concept and val_spec is not None:
        try:
            from src.engine.validation import validate_runtime
            rt_result = validate_runtime(df, val_spec)
            if not rt_result.passed:
                print(f"WARNING: Runtime validation failed for {strategy.name}: {rt_result.errors}", file=sys.stderr)
            validation_warnings.extend(rt_result.warnings)
        except Exception as e:
            print(f"WARNING: Runtime validation error for {strategy.name}: {e}", file=sys.stderr)

    # ─── Signal pipeline diagnostics ─────────────────────────
    diag_raw_long = int(np.sum(long_entries_np))
    diag_raw_short = int(np.sum(short_entries_np))
    diag_raw_exit_long = int(np.sum(long_exits_np))
    diag_raw_exit_short = int(np.sum(short_exits_np))

    # Count same-bar collisions (entry + exit both True on same bar)
    diag_collision_long = int(np.sum(long_entries_np & long_exits_np))
    diag_collision_short = int(np.sum(short_entries_np & short_exits_np))

    if skip_eligibility_gate:
        empty_stats = {"total": 0, "take": 0, "reduce": 0, "skip": 0, "skip_reasons": {}}
        long_gate_stats = empty_stats
        short_gate_stats = empty_stats.copy()
    else:
        long_entries_np, _, long_gate_stats = apply_eligibility_gate(
            long_entries_np, long_exits_np, df, "long", symbol,
            firm_key=firm_key, htf_cache=htf_cache, spec=spec,
            strategy_name=strategy.name,
        )
        short_entries_np, _, short_gate_stats = apply_eligibility_gate(
            short_entries_np, short_exits_np, df, "short", symbol,
            firm_key=firm_key, htf_cache=htf_cache, spec=spec,
            strategy_name=strategy.name,
        )
        # G2 parity gate (skip + anti-setup + compliance gate)
        # W27.5 C.2: read compliance_mode from strategy object if available.
        _cls_compliance_mode: Optional[str] = getattr(strategy, "compliance_mode", None)
        long_entries_np, _parity_long = _apply_backtest_parity_gates(
            long_entries_np, df, "long", symbol, strategy.name,
            compliance_mode_override=_cls_compliance_mode,
        )
        short_entries_np, _parity_short = _apply_backtest_parity_gates(
            short_entries_np, df, "short", symbol, strategy.name,
            compliance_mode_override=_cls_compliance_mode,
        )

    # Merge gate stats
    gate_stats = {
        "long": long_gate_stats,
        "short": short_gate_stats,
        "total_signals": long_gate_stats["total"] + short_gate_stats["total"],
        "total_taken": long_gate_stats["take"] + short_gate_stats["take"],
        "total_reduced": long_gate_stats["reduce"] + short_gate_stats["reduce"],
        "total_skipped": long_gate_stats["skip"] + short_gate_stats["skip"],
    }
    total_sigs = gate_stats["total_signals"]
    if total_sigs > 0:
        gate_stats["filter_rate"] = round(gate_stats["total_skipped"] / total_sigs * 100, 1)
        print(
            f"Gate: {gate_stats['total_taken']} TAKE, {gate_stats['total_reduced']} REDUCE, "
            f"{gate_stats['total_skipped']} SKIP out of {total_sigs} signals "
            f"({gate_stats['filter_rate']}% filtered)",
            file=sys.stderr,
        )
    else:
        gate_stats["filter_rate"] = 0.0

    diag_post_gate_long = int(np.sum(long_entries_np))
    diag_post_gate_short = int(np.sum(short_entries_np))

    # ─── Shift entry signals by 1 bar (next-bar fill) ──────────
    # Signal on bar N → fill on bar N+1. Eliminates lookahead bias.
    long_entries_np = np.roll(long_entries_np, 1)
    long_entries_np[0] = False
    short_entries_np = np.roll(short_entries_np, 1)
    short_entries_np[0] = False

    # ─── Max trades per day filter ──────────────────────────────
    # run_class_backtest doesn't have a BacktestRequest, so we accept max_trades_per_day
    # as a parameter defaulting to 2 (set below in function signature).
    if max_trades_per_day > 0:
        ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
        if ts_col in df.columns:
            ts_arr = df[ts_col].to_numpy()
            long_entries_np, short_entries_np = _apply_max_trades_per_day(
                long_entries_np, short_entries_np, ts_arr, max_trades_per_day,
            )

    # Replace signal columns with filtered+shifted versions
    df = df.with_columns([
        pl.Series("entry_long", long_entries_np),
        pl.Series("entry_short", short_entries_np),
    ])

    # ─── Convert to Pandas at vectorbt boundary ────────────────
    ts_index = df["ts_event"].to_pandas() if "ts_event" in df.columns else None
    close_pd = df["close"].to_pandas()
    # High/Low arrays for per-trade MAE/MFE computation
    high_np = df["high"].to_numpy() if "high" in df.columns else close_pd.to_numpy()
    low_np = df["low"].to_numpy() if "low" in df.columns else close_pd.to_numpy()
    entries_pd = df["entry_long"].to_pandas()
    exits_pd = df["exit_long"].to_pandas()
    short_entries_pd = df["entry_short"].to_pandas()
    short_exits_pd = df["exit_short"].to_pandas()
    if ts_index is not None:
        close_pd.index = ts_index
        entries_pd.index = ts_index
        exits_pd.index = ts_index
        short_entries_pd.index = ts_index
        short_exits_pd.index = ts_index

    # ─── Suppress entries on rollover days ────────────────────────
    if "is_rollover_day" not in df.columns:
        df = flag_rollover_days(df, symbol)
    if "is_rollover_day" in df.columns:
        rollover_mask = df["is_rollover_day"].to_numpy()
        suppressed = int(np.sum(entries_pd.values[rollover_mask]) + np.sum(short_entries_pd.values[rollover_mask]))
        if suppressed > 0:
            print(f"Suppressing {suppressed} entry signals on rollover days", file=sys.stderr)
            entries_pd[rollover_mask] = False
            short_entries_pd[rollover_mask] = False

    diag_post_rollover_long = int(np.sum(entries_pd.values))
    diag_post_rollover_short = int(np.sum(short_entries_pd.values))

    # ─── Signal pipeline diagnostic (stderr) ─────────────────
    print(
        f"Signal pipeline: raw={diag_raw_long+diag_raw_short} "
        f"(L:{diag_raw_long} S:{diag_raw_short}) "
        f"→ gate={diag_post_gate_long+diag_post_gate_short} "
        f"→ rollover={diag_post_rollover_long+diag_post_rollover_short} "
        f"| collisions: L={diag_collision_long} S={diag_collision_short} "
        f"| exits: L={diag_raw_exit_long} S={diag_raw_exit_short}",
        file=sys.stderr,
    )

    sizes_clean = np.nan_to_num(sizes, nan=1.0)
    slippage_clean = np.nan_to_num(slippage_arr, nan=0.0)

    # ─── Run vectorbt Portfolio (long + short) ────────────────
    # vectorbt handles SIGNAL TIMING only — no slippage/fees.
    # We compute all P&L ourselves with correct futures math.
    # Same-bar stop+signal exit convention applies here too — see run_backtest comment.
    try:
        pf = vbt.Portfolio.from_signals(
            close=close_pd,
            entries=entries_pd,
            exits=exits_pd,
            short_entries=short_entries_pd,
            short_exits=short_exits_pd,
            size=sizes_clean,
            freq=_resolve_freq(timeframe),
            init_cash=float("inf"),
        )
    except Exception as e:
        print(f"vectorbt error: {e}", file=sys.stderr)
        return _empty_result(str(e), time.time() - start_time)

    # ─── Extract metrics (futures P&L computed independently) ─
    STARTING_CAPITAL = 50_000.0

    total_trades = int(pf.trades.count())
    trades_records = pf.trades.records_readable if total_trades > 0 else None
    print(
        f"Signal pipeline → trades={total_trades} "
        f"(vectorbt drop: {100 - (total_trades / max(diag_post_rollover_long + diag_post_rollover_short, 1)) * 100:.0f}%)",
        file=sys.stderr,
    )

    # ─── Add Entry/Exit Idx columns (VBT v2 uses timestamps, not indices) ──
    if trades_records is not None and "Entry Idx" not in trades_records.columns:
        ts_to_idx = {ts: i for i, ts in enumerate(close_pd.index)}
        if "Entry Timestamp" in trades_records.columns:
            trades_records = trades_records.copy()
            entry_idx_mapped = trades_records["Entry Timestamp"].map(ts_to_idx)
            exit_idx_mapped = trades_records["Exit Timestamp"].map(ts_to_idx)
            unmapped = int(entry_idx_mapped.isna().sum() + exit_idx_mapped.isna().sum())
            if unmapped > 0:
                raise ValueError(
                    f"CRITICAL: {unmapped} trade timestamps unmapped to bar indices. "
                    f"Data integrity compromised — timestamp mismatch between "
                    f"trades and price data."
                )
            trades_records["Entry Idx"] = entry_idx_mapped.astype(int)
            trades_records["Exit Idx"] = exit_idx_mapped.astype(int)

    # ─── Trade management: SL/TP/trailing applied bar-by-bar ──
    close_np = df["close"].to_numpy()
    open_np_managed = df["open"].to_numpy() if "open" in df.columns else None
    atr_np = df["atr_14"].to_numpy() if "atr_14" in df.columns else np.full(len(df), 1.0)
    managed_trades = []
    # L3: pass strategy's actual stop multiplier so risk_points is accurate
    _cls_stop_mult = float(strategy.config.stop_loss.multiplier) if hasattr(strategy.config, "stop_loss") and strategy.config.stop_loss else 1.5
    if trades_records is not None:
        managed_trades = _apply_trade_management(
            trades_records, high_np, low_np, close_np, atr_np,
            spec, htf_cache, df, open_np=open_np_managed,
            atr_stop_multiplier=_cls_stop_mult,
            exit_engine=exit_engine,
            adaptive_ctx=adaptive_ctx,
        )
        {m["exit_reason"] for m in managed_trades}
        tp_count = sum(1 for m in managed_trades if m["exit_reason"] == "take_profit")
        sl_count = sum(1 for m in managed_trades if m["exit_reason"] == "stop_loss")
        trail_count = sum(1 for m in managed_trades if m["exit_reason"] == "trailing_stop")
        # C2: aggregate gap-through-stop count for metadata/audit
        total_gap_through = sum(m.get("gap_through_stop_count", 0) for m in managed_trades)
        print(
            f"Trade mgmt: {tp_count} TP, {sl_count} SL, {trail_count} trail, "
            f"{len(managed_trades) - tp_count - sl_count - trail_count} signal exits, "
            f"{total_gap_through} gap-through-stop fills",
            file=sys.stderr,
        )

    win_rate = 0.0
    profit_factor = 0.0
    avg_trade_pnl = 0.0
    winner_loser_ratio = 0.0
    trades_list: list[dict] = []
    trade_pnls_arr = np.array([])

    if trades_records is not None:
        trade_pnls_list = []

        # MED #5 (Wave 27.5 Pass D.1) — Roll spread cost setup (class backtest path).
        from src.engine.roll_spread_cost import (
            build_roll_spread_audit,
            compute_roll_spread_cost,
        )
        _has_rollover_col_cls = "is_rollover_day" in df.columns
        _ts_et_list_roll_cls = df["ts_et"].to_list() if "ts_et" in df.columns else (
            df["ts_event"].to_list() if "ts_event" in df.columns else []
        )
        _roll_spread_audit_rows_cls: list[dict] = []

        for trade_i, (_, row) in enumerate(trades_records.iterrows()):
            entry_p = float(row["Avg Entry Price"])
            size = float(row["Size"])
            direction = str(row["Direction"])
            entry_idx = int(row["Entry Idx"]) if "Entry Idx" in row.index else 0

            # Use managed exit if available, otherwise original
            if trade_i < len(managed_trades):
                mgmt = managed_trades[trade_i]
                exit_p = mgmt["exit_price"]
                exit_idx = mgmt["exit_idx"]
                exit_reason = mgmt["exit_reason"]
                risk_pts = mgmt["risk_points"]
            else:
                exit_p = float(row["Avg Exit Price"])
                exit_idx = int(row["Exit Idx"]) if "Exit Idx" in row.index else min(entry_idx + 1, len(slippage_clean) - 1)
                exit_reason = "signal"
                risk_pts = min(float(atr_np[entry_idx]) * 2.0, 6.0) if entry_idx < len(atr_np) else 6.0

            # H2 FIX (class path): Floor size to integer contracts — brokers charge
            # per integer contract only. FLOOR is conservative (can't trade 0.3 contracts).
            int_size = int(size)
            if int_size < 1:
                int_size = 1

            if "Short" in direction:
                gross = (entry_p - exit_p) * int_size * spec.point_value
            else:
                gross = (exit_p - entry_p) * int_size * spec.point_value

            # Per-trade friction: per-bar slippage at entry + exit bars
            entry_slip = float(slippage_clean[entry_idx]) if entry_idx < len(slippage_clean) else 0.0
            exit_slip = float(slippage_clean[exit_idx]) if exit_idx < len(slippage_clean) else 0.0
            slip_cost = (entry_slip + exit_slip) * int_size
            # H2 FIX: commission charged on integer contracts only.
            comm_cost = commission * int_size * 2

            # MED #5 (Wave 27.5 Pass D.1) — Itemised roll spread cost (class backtest path).
            _roll_cost_usd_cls = 0.0
            if _has_rollover_col_cls and entry_idx < len(df):
                try:
                    _is_roll_day_cls = bool(df["is_rollover_day"][entry_idx])
                except Exception:
                    _is_roll_day_cls = False
                if _is_roll_day_cls:
                    try:
                        _roll_ts_str_cls = str(_ts_et_list_roll_cls[entry_idx]) if entry_idx < len(_ts_et_list_roll_cls) else ""
                        from datetime import date as _date_cls2
                        _roll_date_cls = _date_cls2.fromisoformat(_roll_ts_str_cls[:10])
                        _roll_cost_cls = compute_roll_spread_cost(symbol, _roll_date_cls, int_size)
                        _roll_cost_usd_cls = float(_roll_cost_cls)
                        _roll_spread_audit_rows_cls.append(
                            build_roll_spread_audit(symbol, _roll_date_cls, int_size, _roll_cost_cls)
                        )
                    except Exception as _re_cls:
                        print(
                            f"[roll-spread] Error computing roll cost at bar {entry_idx}: {_re_cls}",
                            file=sys.stderr,
                        )

            net_pnl = gross - slip_cost - comm_cost - _roll_cost_usd_cls

            trade_pnls_list.append(net_pnl)

            trade: dict = {}
            for col in trades_records.columns:
                val = row[col]
                if hasattr(val, "isoformat"):
                    trade[col] = val.isoformat()
                elif isinstance(val, (np.integer, np.floating)):
                    trade[col] = round(float(val), 4)
                else:
                    trade[col] = val

            # Override with managed exit data
            trade["Avg Exit Price"] = round(exit_p, 4)
            trade["Exit Idx"] = exit_idx
            trade["exit_reason"] = exit_reason
            trade["PnL"] = round(net_pnl, 2)
            trade["GrossPnL"] = round(gross, 2)
            trade["SlippageCost"] = round(slip_cost, 2)
            trade["CommissionCost"] = round(comm_cost, 2)
            trade["RollSpreadCost"] = round(_roll_cost_usd_cls, 4)

            # ─── Per-trade R:R (using 6pt capped risk) ───────────────
            risk_dollars = risk_pts * spec.point_value
            if risk_dollars > 0 and size > 0:
                reward_dollars = net_pnl / size
                trade["rr"] = round(reward_dollars / risk_dollars, 2)
            else:
                trade["rr"] = 0.0
            trade["risk_points"] = round(risk_pts, 2)

            # ─── Per-trade MAE/MFE ($ excursion from entry) ───────
            try:
                ei = max(0, entry_idx + 1)
                xi = min(exit_idx + 1, len(high_np))
                if xi > ei:
                    bar_highs = high_np[ei:xi]
                    bar_lows = low_np[ei:xi]
                    if "Short" in direction:
                        trade_mae = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                        trade_mfe = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                    else:
                        trade_mae = round((entry_p - float(np.min(bar_lows))) * size * spec.point_value, 2)
                        trade_mfe = round((float(np.max(bar_highs)) - entry_p) * size * spec.point_value, 2)
                    trade["mae"] = max(0.0, trade_mae)
                    trade["mfe"] = max(0.0, trade_mfe)
                else:
                    trade["mae"] = 0.0
                    trade["mfe"] = 0.0
            except Exception as exc:
                print(f"WARNING: MAE/MFE computation failed for trade {len(trades_list)}: {exc}", file=sys.stderr)
                trade["mae"] = None
                trade["mfe"] = None

            trades_list.append(trade)

        trade_pnls_arr = np.array(trade_pnls_list)
        winners = trade_pnls_arr[trade_pnls_arr > 0]
        losers = trade_pnls_arr[trade_pnls_arr < 0]

        win_rate = float(len(winners) / total_trades)
        avg_winner = float(np.mean(winners)) if len(winners) > 0 else 0.0
        avg_loser = float(np.mean(np.abs(losers))) if len(losers) > 0 else 0.0
        gross_profit = float(np.sum(winners))
        gross_loss = float(np.abs(np.sum(losers)))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_trade_pnl = float(np.mean(trade_pnls_arr))
        winner_loser_ratio = avg_winner / avg_loser if avg_loser > 0 else float("inf")

    # ─── Build equity curve from managed trades ─────────────────
    # Uses managed entry/exit data so equity matches per-trade P&L exactly.
    # Each trade contributes mark-to-market P&L bar-by-bar, with the managed
    # exit price used on the exit bar instead of close.
    close_arr = close_pd.values
    n_bars = len(close_arr)
    bar_dollar_pnls = np.zeros(n_bars)

    if trades_list:
        for trade in trades_list:
            t_entry_idx = int(trade.get("Entry Idx", 0))
            t_exit_idx = int(trade.get("Exit Idx", t_entry_idx + 1))
            t_entry_p = float(trade.get("Avg Entry Price", 0))
            t_exit_p = float(trade.get("Avg Exit Price", 0))
            # F-6 FIX (class path): Use int() to match the P&L loop's int(size)
            # contract floor. float(Size) was a dormant mismatch — integer-valued
            # today but would break reconciliation if fractional-Kelly sizing lands.
            t_size = int(trade.get("Size", 1))
            if t_size < 1:
                t_size = 1
            t_dir = str(trade.get("Direction", "Long"))
            is_short = "Short" in t_dir
            sign = -1.0 if is_short else 1.0

            # Entry bar mark-to-market: entry_price → bar close
            if t_entry_idx < n_bars:
                bar_close = float(close_arr[t_entry_idx])
                bar_dollar_pnls[t_entry_idx] += sign * (bar_close - t_entry_p) * t_size * spec.point_value

            # Intermediate bars: close-to-close mark-to-market
            prev_price = float(close_arr[t_entry_idx]) if t_entry_idx < n_bars else t_entry_p
            for bar in range(t_entry_idx + 1, min(t_exit_idx, n_bars)):
                bar_close = float(close_arr[bar])
                bar_dollar_pnls[bar] += sign * (bar_close - prev_price) * t_size * spec.point_value
                prev_price = bar_close

            # Exit bar: prev close → managed exit price
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] += sign * (t_exit_p - prev_price) * t_size * spec.point_value

            # Friction Fix 2: split friction across entry and exit bars (run_class_backtest path).
            slip_cost = float(trade.get("SlippageCost", 0))
            comm_cost = float(trade.get("CommissionCost", 0))
            entry_slip = float(trade.get("EntrySlipCost", slip_cost / 2.0))
            exit_slip = float(trade.get("ExitSlipCost", slip_cost / 2.0))
            half_comm = comm_cost / 2.0
            if t_entry_idx < n_bars:
                bar_dollar_pnls[t_entry_idx] -= (entry_slip + half_comm)
            if t_exit_idx < n_bars:
                bar_dollar_pnls[t_exit_idx] -= (exit_slip + half_comm)
            assert abs((entry_slip + half_comm) + (exit_slip + half_comm) - (slip_cost + comm_cost)) < 0.01, (
                f"Friction split invariant: entry_slip={entry_slip:.4f}, exit_slip={exit_slip:.4f}, "
                f"comm={comm_cost:.4f}, expected_total={slip_cost + comm_cost:.4f}"
            )

    equity = STARTING_CAPITAL + np.cumsum(bar_dollar_pnls)
    equity_index = close_pd.index

    # MED #2 (Wave 27.5 Pass D.1): extract ts_et list for DST-aware aggregation (class path).
    _ts_et_list_eq_cls = df["ts_et"].to_list() if "ts_et" in df.columns else None
    _dst_transitions_cls = _detect_dst_transitions(_ts_et_list_eq_cls or [])

    # Reconciliation: managed equity total must match sum of per-trade P&Ls
    if len(trade_pnls_arr) > 0 and len(equity) > 0:
        equity_total = float(equity[-1] - STARTING_CAPITAL)
        trades_total = float(np.sum(trade_pnls_arr))
        reconciliation_error = abs(equity_total - trades_total)
        if reconciliation_error > 1.0:  # $1 tolerance for floating point
            raise ValueError(
                f"RECONCILIATION FAILED: equity={equity_total:.2f}, "
                f"trades={trades_total:.2f}, diff={reconciliation_error:.2f}. "
                f"Results are untrustworthy."
            )

    # F-11 FIX: pass STARTING_CAPITAL so the first day's P&L is correctly anchored.
    # MED #2: pass ts_et_index for DST-safe daily grouping.
    daily_pnl_records = _compute_daily_pnls(
        equity, equity_index, starting_capital=STARTING_CAPITAL,
        ts_et_index=_ts_et_list_eq_cls,
    )
    daily_pnl_values = [d["pnl"] for d in daily_pnl_records]

    winning_days = sum(1 for p in daily_pnl_values if p > 0)
    total_trading_days = len(daily_pnl_values)
    avg_daily_pnl = float(np.mean(daily_pnl_values)) if daily_pnl_values else 0.0

    max_consec_losers = 0
    streak = 0
    for p in daily_pnl_values:
        if p < 0:
            streak += 1
            max_consec_losers = max(max_consec_losers, streak)
        else:
            streak = 0

    # Compute return/drawdown/sharpe from the constructed equity curve
    total_pnl_dollars = float(equity[-1] - STARTING_CAPITAL)
    total_return = total_pnl_dollars  # Dollar P&L — futures are margin instruments, % is misleading
    peak = np.maximum.accumulate(equity)
    drawdown_dollars = peak - equity  # Dollar drawdown (positive = how much lost from peak)
    max_dd = float(np.max(drawdown_dollars)) if len(drawdown_dollars) > 0 else 0.0  # Max $ lost from peak

    # Sharpe from daily P&L (annualized)
    if len(daily_pnl_values) > 1:
        daily_arr = np.array(daily_pnl_values)
        sharpe = float(np.mean(daily_arr) / np.std(daily_arr, ddof=1) * np.sqrt(252)) if np.std(daily_arr, ddof=1) > 0 else 0.0
    else:
        sharpe = 0.0

    if profit_factor == float("inf"):
        profit_factor = 999.99
    if winner_loser_ratio == float("inf"):
        winner_loser_ratio = 999.99

    # ─── Overnight gap risk ───────────────────────────────────
    gap_adjusted_dd = None
    if "ts_event" in df.columns and trades_list:
        try:
            from src.engine.gap_risk import (
                compute_gap_adjusted_drawdown,
                compute_gap_adjusted_mae,
                compute_overnight_gaps,
                tag_trades_overnight,
            )
            gaps = compute_overnight_gaps(df)
            trades_list = tag_trades_overnight(trades_list, df["ts_event"])
            trades_list = compute_gap_adjusted_mae(
                trades_list, gaps, symbol=symbol, seed=42,
            )
            gap_adjusted_dd = compute_gap_adjusted_drawdown(
                [round(float(v), 2) for v in equity],
                trades_list, gaps,
                symbol=symbol,
                point_value=spec.point_value,
                seed=42,
            )
        except Exception as exc:
            print(f"WARNING: gap_risk computation failed: {exc}", file=sys.stderr)

    elapsed_ms = int((time.time() - start_time) * 1000)

    tier = _compute_tier(avg_daily_pnl, winning_days, total_trading_days,
                         max_dd, profit_factor, sharpe, winner_loser_ratio=winner_loser_ratio)

    # ─── Performance gate (B-3) ───────────────────────────────
    gate_passed = True
    gate_rejections: list[str] = []
    gate_tier = "REJECTED"
    governor_result = None
    _full_forge_result_class: dict = {}
    if use_performance_gate and total_trading_days > 0:
        from src.engine.performance_gate import check_performance_gate, classify_tier
        from src.engine.performance_gate import (
            compute_forge_score as _pgate_forge_score_class,
        )
        _gate_stats = {
            "avg_daily_pnl": avg_daily_pnl,
            "winning_days": winning_days,
            "total_trading_days": total_trading_days,
            "total_trades": total_trades,
            "profit_factor": profit_factor,
            "sharpe_ratio": sharpe,
            "max_drawdown": max_dd,
            "max_consecutive_losing_days": max_consec_losers,
            "avg_winner_to_loser_ratio": winner_loser_ratio,
            "recovery_days_from_max_dd": _compute_recovery_days_from_max_dd(daily_pnl_records),
            **_compute_monthly_survival_stats(daily_pnl_records),
        }
        gate_passed, gate_rejections = check_performance_gate(_gate_stats)
        gate_tier = classify_tier(_gate_stats)
        # Fix 1 (run_class_backtest path): use authoritative forge_score with crisis veto + survival
        _full_forge_result_class = _pgate_forge_score_class(
            _gate_stats,
            mc_results=None,
            crisis_results=None,
            survival_results=None,
        )
        if not gate_passed:
            print(f"Performance gate REJECTED: {'; '.join(gate_rejections[:3])}", file=sys.stderr)
    else:
        # No gate run: fall back to legacy private formula so forge_score is never missing
        _full_forge_result_class = {
            "score": _compute_forge_score(sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl),
            "passed": True,
            "crisis_veto": False,
            "crisis_veto_reason": "",
            "components": {},
        }
    forge_score = _full_forge_result_class["score"]

    # ─── Governor replay (B-4) ─────────────────────────────────
    if trades_list:
        from src.engine.governor.governor_backtest import backtest_governor
        _gov_trades = [
            {
                "pnl": float(t.get("PnL", 0)),
                "mae": float(t.get("mae", 0) or 0),
                "contracts": max(1, int(float(t.get("Size", 1)))),
                "entry_time": t.get("Entry Timestamp", t.get("Entry Idx", "")),
            }
            for t in trades_list
        ]
        _gov_daily_budget = 500.0
        if firm_key:
            from src.engine.firm_config import FIRM_RULES
            _firm_rules = FIRM_RULES.get(firm_key, {})
            _gov_daily_budget = _firm_rules.get("daily_loss_limit") or 500.0
        governor_result = backtest_governor(_gov_trades, daily_loss_budget=_gov_daily_budget)
        if governor_result["governed"]["trades_blocked"] > 0:
            print(
                f"Governor: {governor_result['governed']['trades_blocked']} trades blocked, "
                f"DD reduced {governor_result['improvement']['dd_reduction_pct']:.0f}%",
                file=sys.stderr,
            )

    # ─── Fixed sizing warning (B-7) ──────────────────────────
    if fixed_contracts is not None:
        print("WARNING: Fixed position sizing detected. Use dynamic_atr for production.", file=sys.stderr)

    # ─── Prop firm simulation (all 8 firms) ─────────────────
    # ─── Sanity checks + cross-validation ─────────────────────
    _prelim_class = {
        "total_return": round(total_return, 6), "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6), "win_rate": round(win_rate, 4),
        "profit_factor": round(profit_factor, 4), "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2), "total_trading_days": total_trading_days,
        "trades": trades_list, "daily_pnls": daily_pnl_values,
        "equity_curve": _aggregate_equity_daily(equity, equity_index, ts_et_index=_ts_et_list_eq_cls),
    }
    sanity = run_sanity_checks(_prelim_class, symbol=symbol, timeframe=timeframe)
    cross_val = run_cross_validation(_prelim_class)

    prop_compliance = simulate_all_firms(
        daily_pnl_records, trades_list,
        symbol=symbol, account_size=50_000,
        overnight_hold=getattr(strategy, "overnight_hold", False),
    )

    # ─── Advanced analytics (calendar, session, MAE/MFE) ──
    analytics = compute_full_analytics(daily_pnl_records, trades_list)

    # ─── Task 3.5: Win rate per-trade AND per-day ────────────
    win_rate_per_trade = len([t for t in trades_list if float(t.get("PnL", t.get("pnl", 0))) > 0]) / max(total_trades, 1)
    win_rate_per_day = winning_days / max(total_trading_days, 1)

    # ─── Task 3.6: Long/short split metrics ──────────────────
    long_short_split = _compute_long_short_split(trades_list)

    # ─── Task 3.7: Minimum sample size & confidence intervals ─
    statistical_warnings: list[str] = []
    if total_trades < MINIMUM_TRADES:
        statistical_warnings.append(f"Only {total_trades} trades — statistically unreliable (need {MINIMUM_TRADES}+)")
    if long_short_split["long"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["long"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['long']['trades']} long trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")
    if long_short_split["short"]["trades"] < MINIMUM_TRADES_PER_SIDE and long_short_split["short"]["trades"] > 0:
        statistical_warnings.append(f"Only {long_short_split['short']['trades']} short trades — need {MINIMUM_TRADES_PER_SIDE}+ per side")

    win_rate_ci = _wilson_ci(winning_days, total_trading_days)

    if total_trading_days > 1:
        # Lo (2002) formula: SE(Sharpe) = sqrt((1 + sharpe^2/2) / n)
        sharpe_se = ((1 + sharpe ** 2 / 2) / total_trading_days) ** 0.5
        sharpe_ci = (round(sharpe - 1.96 * sharpe_se, 4), round(sharpe + 1.96 * sharpe_se, 4))
    else:
        sharpe_ci = (0.0, 0.0)

    sample_confidence = "HIGH" if total_trades >= 500 else "MEDIUM" if total_trades >= 200 else "LOW"

    # ─── A13: Information Ratio (run_class_backtest path) ────────
    information_ratio_class: Optional[float] = None
    try:
        from src.engine.risk_metrics import (
            compute_information_ratio as _compute_ir_class,  # noqa: PLC0415
        )
        if "ts_event" in df.columns and len(daily_pnl_records) > 1:
            _close_np_c = df["close"].to_numpy()
            _ts_col_c = "ts_et" if "ts_et" in df.columns else "ts_event"
            _dates_series_c = df[_ts_col_c]
            _date_to_close_c: dict[str, float] = {}
            for _ic in range(len(df)):
                _day_c = str(_dates_series_c[_ic])[:10]
                if _day_c not in _date_to_close_c:
                    _date_to_close_c[_day_c] = float(_close_np_c[_ic])
            _sorted_dates_c = sorted(_date_to_close_c.keys())
            _bench_by_date_c: dict[str, float] = {}
            for _dic in range(1, len(_sorted_dates_c)):
                _dc_curr = _sorted_dates_c[_dic]
                _dc_prev = _sorted_dates_c[_dic - 1]
                if _dc_prev in _date_to_close_c and _dc_curr in _date_to_close_c:
                    _bench_by_date_c[_dc_curr] = (_date_to_close_c[_dc_curr] - _date_to_close_c[_dc_prev]) * spec.point_value
            _bm_returns_c = np.array(
                [_bench_by_date_c.get(r["date"], 0.0) for r in daily_pnl_records],
                dtype=np.float64,
            )
            _strat_returns_c = np.array(daily_pnl_values, dtype=np.float64)
            if len(_strat_returns_c) > 1:
                information_ratio_class = round(
                    _compute_ir_class(_strat_returns_c, _bm_returns_c, periods_per_year=252.0), 4
                )
    except Exception as _ir_exc_c:
        print(f"WARNING: information_ratio computation failed (class): {_ir_exc_c}", file=sys.stderr)
        information_ratio_class = None
    # ─────────────────────────────────────────────────────────────

    return {
        "total_return": round(total_return, 6),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_dd, 6),
        "win_rate": round(win_rate, 4),
        "win_rate_per_trade": round(win_rate_per_trade, 4),
        "win_rate_per_day": round(win_rate_per_day, 4),
        "profit_factor": round(profit_factor, 4),
        "total_trades": total_trades,
        "avg_trade_pnl": round(avg_trade_pnl, 2),
        "avg_daily_pnl": round(avg_daily_pnl, 2),
        "winning_days": winning_days,
        "total_trading_days": total_trading_days,
        "max_consecutive_losing_days": max_consec_losers,
        "expectancy_per_trade": round(
            (len(winners) / total_trades) * avg_winner - (len(losers) / total_trades) * avg_loser
            if len(winners) > 0 and len(losers) > 0 and total_trades > 0
            else avg_trade_pnl,
            2,
        ),
        "avg_winner_to_loser_ratio": round(winner_loser_ratio, 4),
        "avg_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None])), 2) if trades_list else 0.0,
        "avg_winner_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] > 0])), 2) if any(t.get("rr", 0) > 0 for t in trades_list) else 0.0,
        "avg_loser_rr": round(float(np.mean([t["rr"] for t in trades_list if t.get("rr") is not None and t["rr"] < 0])), 2) if any(t.get("rr", 0) < 0 for t in trades_list) else 0.0,
        # MED #2: pass ts_et_index for DST-safe daily aggregation (class path).
        "equity_curve": _aggregate_equity_daily(equity, equity_index, ts_et_index=_ts_et_list_eq_cls),
        # WF Fix 1: raw bar-level equity for intraday max DD calculation in walk_forward.py.
        "equity_bars": equity.tolist(),
        "monthly_returns": _compute_monthly_returns(equity, equity_index),
        "trades": trades_list,
        "daily_pnls": daily_pnl_values,
        "daily_pnl_records": daily_pnl_records,
        "execution_time_ms": elapsed_ms,
        "gap_adjusted_drawdown": gap_adjusted_dd,
        "tier": tier,
        "forge_score": forge_score,
        "sanity_checks": sanity,
        # A13: Information Ratio
        "information_ratio": information_ratio_class,
        "cross_validation": cross_val,
        "sortino_ratio": cross_val.get("sortino_ratio", 0.0),
        "bootstrap_ci_95": cross_val.get("bootstrap_ci_95", [0, 0]),
        "deflated_sharpe": cross_val.get("deflated_sharpe", {}),
        "recency_analysis": compute_recency_weighted_score(
            daily_pnl_records, sharpe, max_dd, profit_factor, win_rate, avg_daily_pnl,
        ),
        "decay_analysis": _compute_decay_analysis(daily_pnl_values, trades_list),
        "over_risk_bars": over_risk_count,
        "over_risk_pct": round(over_risk_count / max(len(df), 1) * 100, 2),
        "prop_compliance": prop_compliance,
        "analytics": analytics,
        "long_short_split": long_short_split,
        "confidence_intervals": {
            "win_rate_95ci": win_rate_ci,
            "sharpe_95ci": sharpe_ci,
        },
        "statistical_warnings": statistical_warnings,
        "sample_confidence": sample_confidence,
        "gate_stats": gate_stats,
        "signal_diagnostics": {
            "raw_long": diag_raw_long,
            "raw_short": diag_raw_short,
            "raw_total": diag_raw_long + diag_raw_short,
            "post_gate_long": diag_post_gate_long,
            "post_gate_short": diag_post_gate_short,
            "post_rollover_long": diag_post_rollover_long,
            "post_rollover_short": diag_post_rollover_short,
            "actual_trades": total_trades,
            "collision_long": diag_collision_long,
            "collision_short": diag_collision_short,
            "exit_long_count": diag_raw_exit_long,
            "exit_short_count": diag_raw_exit_short,
        },
        # Fix 1 (run_class_backtest): full forge score object, same contract as run_backtest
        "gate_result": {
            **_full_forge_result_class,
            "tier": gate_tier,
            "gate_rejections": gate_rejections,
        },
        "gate_rejections": gate_rejections,
        "governor": governor_result,
        # W25.17: echo which exit engine was used so A/B harness can tag results correctly.
        "exit_engine": exit_engine,
        "run_receipt": _build_run_receipt(strategy._config if hasattr(strategy, '_config') else StrategyConfig(
            name=strategy.name, symbol=strategy.symbol, timeframe=strategy.timeframe,
            indicators=[], entry_long="", entry_short="", exit="",
            stop_loss={"type": "atr"}, position_size={"type": "fixed"},
        ), dataset_hash=compute_dataset_hash(df)),
        # MED #2 (Wave 27.5 Pass D.1) — DST boundary audit (class backtest path).
        "dst_boundary_processed": {
            "transitions": _dst_transitions_cls,
            "ts_et_used": _ts_et_list_eq_cls is not None,
            "count": len(_dst_transitions_cls),
        },
        # MED #5 (Wave 27.5 Pass D.1) — Roll spread cost audit (class backtest path).
        "roll_spread_costs": _roll_spread_audit_rows_cls,
    }


def _compute_decay_analysis(daily_pnls: list[float], trades_list: list[dict]) -> dict:
    """Compute combined decay analysis from half-life fit + 6 sub-signals."""
    try:
        half_life_result = fit_decay(daily_pnls)
        composite_result = composite_decay_score(daily_pnls, trades_list)
        return {
            "half_life_days": half_life_result.get("half_life_days"),
            "decay_detected": half_life_result.get("decay_detected", False),
            "trend": half_life_result.get("trend", "stable"),
            "composite_score": composite_result.get("composite_score", 0.0),
            "decaying": composite_result.get("composite_score", 0.0) > 60,
            "signals": composite_result.get("signals", {}),
        }
    except Exception as exc:
        print(f"WARNING: Decay analysis failed: {exc}", file=sys.stderr)
        return {
            "half_life_days": None,
            "decay_detected": False,
            "trend": "stable",
            "composite_score": 0.0,
            "decaying": False,
            "signals": {},
        }


def _load_strategy_class(class_path: str) -> BaseStrategy:
    """Import and instantiate a strategy class from dotted module path.

    Example: 'src.engine.strategies.breaker.BreakerStrategy'
    """
    module_path, class_name = class_path.rsplit(".", 1)
    import importlib
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)
    return cls()


# ─── CLI Entry Point ──────────────────────────────────────────────

@click.command()
@click.option("--config", "config_input", required=True, help="JSON config string or file path")
@click.option("--backtest-id", default=None, help="UUID for this backtest run")
@click.option("--mode", default="single", type=click.Choice(["single", "walkforward"]))
@click.option("--strategy-class", default=None, help="Dotted path to BaseStrategy subclass (e.g. src.engine.strategies.breaker.BreakerStrategy)")
@click.option("--b15-battery", "run_b15_battery_flag", is_flag=True, default=False, help="Run B15 Parameter Robustness Battery after main backtest; emits B15_BATTERY_JSON sentinel to stderr")
@click.option(
    "--exit-engine",
    "exit_engine",
    default="static_styleC",
    type=click.Choice(["static_styleC", "adaptive"]),
    help=(
        "W25.17 A/B flag: which exit engine to use. "
        "'static_styleC' (default) = existing Style C 33/33/34 TP1/TP2/runner path — "
        "backward-compat; existing CI runs unchanged. "
        "'adaptive' = adaptive exit engine (P7.A1+A2 TS path); "
        "Python harness stubs until framework-overlay wiring lands in P7.A5."
    ),
)
def main(config_input: str, backtest_id: Optional[str], mode: str, strategy_class: Optional[str], run_b15_battery_flag: bool = False, exit_engine: str = "static_styleC"):
    """Run backtest engine. Outputs JSON to stdout, errors to stderr."""
    try:
        if os.path.isfile(config_input):
            with open(config_input, 'r') as f:
                config = json.load(f)
        else:
            config = json.loads(config_input)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON config: {e}"}))
        sys.exit(1)

    # W25.17: Inject --exit-engine flag into config dict so BacktestRequest.exit_engine
    # is populated correctly.  CLI flag takes precedence over anything in the JSON config,
    # preserving backward-compat: existing JSON configs that don't set exit_engine will get
    # the static_styleC default, CLI override is explicit opt-in.
    if exit_engine != "static_styleC" or "exit_engine" not in config:
        config["exit_engine"] = exit_engine

    print(f"[exit_engine] mode={exit_engine}", file=sys.stderr)

    if strategy_class:
        # Class-based strategy path
        try:
            strategy = _load_strategy_class(strategy_class)
        except Exception as e:
            print(json.dumps({"error": f"Failed to load strategy class '{strategy_class}': {e}"}))
            sys.exit(1)

        if mode == "walkforward":
            # Walk-forward for class-based strategies: run run_class_backtest per OOS window
            from src.engine.walk_forward import run_walk_forward_class
            result = run_walk_forward_class(
                strategy=strategy,
                start_date=config.get("start_date", "2010-01-01"),
                end_date=config.get("end_date", "2030-12-31"),
                slippage_ticks=config.get("slippage_ticks", 1.0),
                commission_per_side=config.get("commission_per_side", 0.62),
                firm_key=config.get("firm_key"),
                embargo_bars=config.get("embargo_bars", 0),
            )
            # Compute tier from OOS metrics (walk-forward doesn't do this itself)
            oos = result.get("oos_metrics", {})
            # Compute winner/loser ratio from aggregated OOS trades (avg win $ / avg loss $)
            wf_trades = result.get("trades", [])
            wf_winners = [t["pnl"] for t in wf_trades if isinstance(t, dict) and t.get("pnl", 0) > 0]
            wf_losers = [abs(t["pnl"]) for t in wf_trades if isinstance(t, dict) and t.get("pnl", 0) < 0]
            wf_avg_winner = float(np.mean(wf_winners)) if wf_winners else 0.0
            wf_avg_loser = float(np.mean(wf_losers)) if wf_losers else 0.0
            wf_winner_loser_ratio = wf_avg_winner / wf_avg_loser if wf_avg_loser > 0 else (999.99 if wf_avg_winner > 0 else 0.0)
            result["avg_winner_to_loser_ratio"] = round(wf_winner_loser_ratio, 4)
            result["tier"] = _compute_tier(
                oos.get("avg_daily_pnl", 0),
                oos.get("winning_days", 0),
                max(oos.get("total_trading_days", 1), 1),
                abs(oos.get("max_drawdown", 0)),
                oos.get("profit_factor", 0),
                oos.get("sharpe_ratio", 0),
                winner_loser_ratio=wf_winner_loser_ratio,
            )
            result["forge_score"] = _compute_forge_score(
                oos.get("sharpe_ratio", 0),
                abs(oos.get("max_drawdown", 0)),
                oos.get("profit_factor", 0),
                oos.get("win_rate", 0),
                oos.get("avg_daily_pnl", 0),
            )
            print(f"Walk-forward OOS: tier={result['tier']}, forge_score={result['forge_score']:.1f}", file=sys.stderr)
            # Attach run receipt for walk-forward (single backtests attach it themselves)
            result["run_receipt"] = _build_run_receipt(config, dataset_hash="wf-aggregate")
        else:
            # Wave 25 Gap B: deserialize adaptive_exit_context from JSON config
            _adaptive_ctx = None
            if exit_engine == "adaptive" and config.get("adaptive_exit_context"):
                _raw_ctx = config["adaptive_exit_context"]
                try:
                    _snapshots = [
                        LiquidityLevelSnapshot(
                            level_type=lvl.get("level_type", ""),
                            price=float(lvl.get("price", 0)),
                            htf_significance=int(lvl.get("htf_significance", 1)),
                            sweep_probability=lvl.get("sweep_probability"),
                        )
                        for lvl in _raw_ctx.get("liquidity_snapshot", [])
                        if isinstance(lvl, dict) and lvl.get("level_type") and lvl.get("price")
                    ]
                    _adaptive_ctx = AdaptiveExitContext(
                        liquidity_snapshot=_snapshots,
                        regime_at_entry=_raw_ctx.get("regime_at_entry"),
                        pre_lunch_threshold_r=float(_raw_ctx.get("pre_lunch_threshold_r", 0.3)),
                        delta_div_threshold=float(_raw_ctx.get("delta_div_threshold", 0.6)),
                    )
                    print(
                        f"[adaptive_exit] loaded {len(_snapshots)} liquidity levels, "
                        f"regime_at_entry={_adaptive_ctx.regime_at_entry}, "
                        f"pre_lunch_threshold_r={_adaptive_ctx.pre_lunch_threshold_r}",
                        file=sys.stderr,
                    )
                except Exception as _ctx_err:
                    print(f"[adaptive_exit] WARNING: could not parse adaptive_exit_context ({_ctx_err}); falling back to static_styleC", file=sys.stderr)
                    _adaptive_ctx = None
            result = run_class_backtest(
                strategy=strategy,
                start_date=config.get("start_date", "2010-01-01"),
                end_date=config.get("end_date", "2030-12-31"),
                slippage_ticks=config.get("slippage_ticks", 1.0),
                commission_per_side=config.get("commission_per_side", 0.62),
                firm_key=config.get("firm_key"),
                skip_eligibility_gate=False,
                exit_engine=exit_engine,
                adaptive_ctx=_adaptive_ctx,
            )
    else:
        # DSL expression-based strategy path (original)
        try:
            request = BacktestRequest.model_validate(config)
        except Exception as e:
            print(json.dumps({"error": f"Invalid config: {e}"}))
            sys.exit(1)

        # F-15 FIX: Initialize _preloaded_data to None so single-mode doesn't
        # NameError when the parity shadow block below reads it unconditionally.
        # WF mode sets this to the loaded DataFrame; single mode passes None to
        # run_parity_shadow() which treats None as "parity not supported → ran=False".
        _preloaded_data: Optional[pl.DataFrame] = None

        # ─── Phase 12: per-stage timing ──────────────────────────────
        _t0 = time.perf_counter()

        if mode == "walkforward":
            # Stage: data load (happens inside run_walk_forward on first call)
            _t_data_start = time.perf_counter()
            from src.engine.data_loader import load_ohlcv
            _preloaded_data = load_ohlcv(
                request.strategy.symbol,
                request.strategy.timeframe,
                request.start_date,
                request.end_date,
            )
            _t_data_end = time.perf_counter()
            print(
                f"[timing] data_load={_t_data_end - _t_data_start:.2f}s "
                f"({len(_preloaded_data)} bars, symbol={request.strategy.symbol} "
                f"tf={request.strategy.timeframe})",
                file=sys.stderr,
            )

            _t_wf_start = time.perf_counter()
            from src.engine.walk_forward import run_walk_forward
            result = run_walk_forward(request, data=_preloaded_data, embargo_bars=request.embargo_bars)
            _t_wf_end = time.perf_counter()
            print(
                f"[timing] walk_forward={_t_wf_end - _t_wf_start:.2f}s "
                f"(windows={result.get('n_splits', '?')}, "
                f"total_elapsed={_t_wf_end - _t0:.2f}s)",
                file=sys.stderr,
            )
        else:
            _t_single_start = time.perf_counter()
            result = run_backtest(request, use_eligibility_gate=True)
            _t_single_end = time.perf_counter()
            print(
                f"[timing] single_backtest={_t_single_end - _t_single_start:.2f}s",
                file=sys.stderr,
            )

    # ─── Chain stress testing (all modes, not just walk-forward) ────
    # Phase 12 perf fix: TF_STRESS_TEST_MODE=pipeline skips the 8-scenario stress
    # test for fast pipeline validation runs. The stress test runs 8 serial
    # run_backtest() calls on crisis date ranges (each ~5-15s with local cache) — that's
    # 40-120s extra per strategy. For daily library validation we don't need it.
    # Use TF_STRESS_TEST_MODE=full (default) for promotion-gate evaluations.
    _stress_mode = os.environ.get("TF_STRESS_TEST_MODE", "full").lower()
    _skip_stress = _stress_mode == "pipeline"
    if _skip_stress:
        result["crisis_results"] = None
        print("Stress test: skipped (TF_STRESS_TEST_MODE=pipeline)", file=sys.stderr)

    if "error" not in result and not _skip_stress:
        try:
            _t_stress_start = time.perf_counter()
            from src.engine.config import StrategyConfig, StressTestRequest
            from src.engine.stress_test import run_stress_test
            strategy_cfg = config.get("strategy", {})
            if strategy_class and hasattr(strategy, 'symbol'):
                # Class-based: build minimal StrategyConfig from the strategy instance
                strategy_cfg = {
                    "name": strategy.name,
                    "symbol": strategy.symbol,
                    "timeframe": strategy.timeframe,
                    "indicators": [],
                    "entry_long": "", "entry_short": "", "exit": "",
                    "stop_loss": {"type": "atr", "multiplier": 2.0},
                    "position_size": {"type": "dynamic_atr", "target_risk_dollars": 500},
                }
            stress_req = StressTestRequest(
                backtest_id=backtest_id or "cli",
                strategy=StrategyConfig(**strategy_cfg) if isinstance(strategy_cfg, dict) else strategy_cfg,
                prop_firm_max_dd=config.get("prop_firm_max_dd", 2000.0),
            )
            crisis = run_stress_test(stress_req)
            result["crisis_results"] = crisis
            # Recalculate Forge Score with crisis bonus using full formula
            from src.engine.performance_gate import (
                compute_forge_score as full_forge_score,
            )
            oos = result.get("oos_metrics", result)
            mc = result.get("mc_results") or result.get("monte_carlo")
            # P0-1 fix: full_forge_score returns a DICT. Storing it directly in
            # result["forge_score"] caused the TS bridge to serialize it as
            # "[object Object]" and persist garbage to the DB. Store the scalar
            # float in forge_score and the full dict in forge_score_components.
            _stress_forge_result = full_forge_score(
                {
                    "avg_daily_pnl": oos.get("avg_daily_pnl", 0),
                    "winning_days": oos.get("winning_days", 0),
                    "total_trading_days": max(oos.get("total_trading_days", 1), 1),
                    "max_drawdown": abs(oos.get("max_drawdown", 0)),  # Already in dollars
                    "sharpe_ratio": oos.get("sharpe_ratio", 0),
                    "profit_factor": oos.get("profit_factor", 0),
                },
                mc_results=mc,
                crisis_results=crisis,
            )
            result["forge_score"] = float(_stress_forge_result["score"])
            result["forge_score_components"] = _stress_forge_result
            _t_stress_end = time.perf_counter()
            print(
                f"[timing] stress_test={_t_stress_end - _t_stress_start:.2f}s "
                f"({len(crisis.get('scenarios', []))} scenarios, "
                f"passed={crisis.get('passed', False)}, "
                f"forge_score={result['forge_score']})",
                file=sys.stderr,
            )
        except Exception as e:
            print(f"Stress test skipped: {e}", file=sys.stderr)
            result["crisis_results"] = None

    if backtest_id:
        result["backtest_id"] = backtest_id

    # ─── Pass D fix (2026-05-20): truthiness stack hooks at CLI level ──
    # Hooks must fire for BOTH single and walk-forward modes. Previously
    # added to run_backtest() at line ~2657/2737 — but walk_forward.py
    # uses its own result-construction path and never returned through
    # run_backtest(). Default mode is walkforward → hooks never fired →
    # production resultExtras had no `invariants` / `parity_shadow` keys.
    # Moving to main() guarantees both code paths emit the truthiness blocks.
    if "error" not in result:
        # Invariant harness — always runs (cheap pure computation).
        try:
            from src.engine.invariant_harness import run_invariants
            _inv_report = run_invariants(result)
            crit_serial = [
                {"name": c.name, "expected": c.expected, "actual": c.actual,
                 "tolerance": c.tolerance, "severity": c.severity, "evidence": c.evidence}
                for c in _inv_report.critical_failures
            ]
            warn_serial = [
                {"name": w.name, "expected": w.expected, "actual": w.actual,
                 "tolerance": w.tolerance, "severity": w.severity, "evidence": w.evidence}
                for w in _inv_report.warnings
            ]
            result["invariants"] = {
                "passed": _inv_report.passed,
                "failed": _inv_report.failed,
                "overall_passed": _inv_report.overall_passed,
                "critical_failures": crit_serial,
                "warnings": warn_serial,
                "total_checks": _inv_report.total_checks,
            }
            if not _inv_report.overall_passed:
                _payload = {
                    "event": "invariant_failure",
                    "backtest_id": backtest_id or "cli",
                    "report": result["invariants"],
                }
                print(f"INVARIANT_FAILURE_JSON {json.dumps(_payload)}", file=sys.stderr)
        except Exception as _inv_err:
            print(
                json.dumps({"event": "invariants.error", "error": str(_inv_err)[:300]}),
                file=sys.stderr,
            )

        # Parity shadow — env-gated, only fires when PARITY_SHADOW_ENABLED=true.
        if os.environ.get("PARITY_SHADOW_ENABLED", "false").lower() == "true":
            try:
                from src.engine.parity_engine.shadow_runner import run_parity_shadow
                shadow_report = run_parity_shadow(request, result, _preloaded_data)
                result["parity_shadow"] = shadow_report
                if shadow_report.get("ran") and not shadow_report.get("passed", True):
                    _shadow_payload = {
                        "event": "parity_shadow_drift",
                        "backtest_id": backtest_id or "cli",
                        "report": shadow_report,
                    }
                    print(
                        f"PARITY_SHADOW_DRIFT_JSON {json.dumps(_shadow_payload)}",
                        file=sys.stderr,
                    )
            except Exception as _ps_err:
                print(
                    json.dumps({"event": "parity_shadow.error", "error": str(_ps_err)[:300]}),
                    file=sys.stderr,
                )

    # ─── B15 Parameter Robustness Battery (Wave 25 Item 5) ─────────────────────
    # Gated by --b15-battery CLI flag. When set, runs SDR/PSI/RWS after the main
    # backtest and emits B15_BATTERY_JSON sentinel to stderr (mirroring the
    # PARITY_SHADOW_DRIFT_JSON + INVARIANT_FAILURE_JSON pattern). The sentinel
    # is parsed by src/server/lib/python-runner.ts so the result lands in
    # backtests.b15_battery JSONB without altering stdout contract.
    if run_b15_battery_flag and "error" not in result:
        try:
            from src.engine.parameter_jitter_battery import run_b15_battery
            # strategy_dsl is the original config dict (not re-parsed — use raw config)
            strategy_dsl_for_battery = config if isinstance(config, dict) else {}
            b15_result = run_b15_battery(strategy_dsl_for_battery, result)
            result["b15_battery"] = b15_result
            _b15_payload = {
                "event": "b15_battery",
                "backtest_id": backtest_id or "cli",
                "result": b15_result,
            }
            print(f"B15_BATTERY_JSON {json.dumps(_b15_payload)}", file=sys.stderr)
            print(
                f"[b15] sdr={b15_result['sdr']} psi={b15_result['psi']} "
                f"rws={b15_result['rws']} passed={b15_result['passed']}",
                file=sys.stderr,
            )
        except Exception as _b15_err:
            print(
                json.dumps({"event": "b15_battery.error", "error": str(_b15_err)[:300]}),
                file=sys.stderr,
            )

    # C-1 FIX: Use shared _emit_validated_result() so main() and run_backtest()
    # both go through the same Pydantic validation path. The idempotency guard in
    # _emit_validated_result() prevents double-stamping when both paths run (CLI).
    _emit_validated_result(result)

    print(json.dumps(result))


if __name__ == "__main__":
    # ─── Context module integration test ────────────────────────
    # Verify all 7 context layers are importable and callable.
    # Run with: python -m src.engine.backtester --help
    try:
        from src.engine.context.bias_engine import compute_bias
        from src.engine.context.eligibility_gate import evaluate_signal
        from src.engine.context.htf_context import compute_htf_context
        from src.engine.context.location_score import compute_location_score
        from src.engine.context.playbook_router import route_playbook
        from src.engine.context.session_context import compute_session_context
        from src.engine.context.structural_stops import compute_structural_stop
        from src.engine.context.structural_targets import compute_targets

        assert callable(compute_htf_context), "compute_htf_context not callable"
        assert callable(compute_session_context), "compute_session_context not callable"
        assert callable(compute_bias), "compute_bias not callable"
        assert callable(route_playbook), "route_playbook not callable"
        assert callable(compute_location_score), "compute_location_score not callable"
        assert callable(compute_structural_stop), "compute_structural_stop not callable"
        assert callable(compute_targets), "compute_targets not callable"
        assert callable(evaluate_signal), "evaluate_signal not callable"
        print("All 7 context layers imported and callable.", file=sys.stderr)
    except ImportError as e:
        print(f"Context module import check failed: {e}", file=sys.stderr)

    main()
