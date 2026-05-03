"""Backtrader adapter — translates Trading Forge DSL fixtures into backtrader
strategy classes and returns a normalised trade list.

Design constraints:
- TEST-ONLY: never imported by any production module.
- P&L computed manually (futures math) — never delegated to backtrader's
  built-in commission/slippage framework. Keeps parity with backtester.py.
- Supports exactly the two DSL fixtures used by CI parity tests:
    * EMA crossover  (trend_mnq — entry_indicator="ema_crossover")
    * ATR breakout   (scalper_mes — entry_indicator="atr_breakout")
- "next-bar fill" convention: signal fires on bar N, fills on bar N+1 open.
  This matches backtester.py's np.roll() shift.
- Commission and slippage are computed per-trade post-hoc and returned in
  the trade list; backtrader's built-in Broker commission is set to 0.
- Direction "both" is handled by running two independent cerebro instances
  (one long, one short) over the same data feed.

Note on backtrader params inheritance:
  backtrader uses a custom metaclass for params. Subclasses must declare ALL
  their params in a single flat tuple — they cannot concatenate with the base
  class params tuple using Python's + operator. The correct pattern is to
  redeclare shared params in each subclass (or use a helper dataclass for
  strategy config, which we pass as a single opaque object).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

import backtrader as bt
import numpy as np
import pandas as pd


# ─── Public trade record ──────────────────────────────────────────────

@dataclass
class BTTrade:
    """Normalised trade record returned by the backtrader adapter."""
    entry_bar: int
    exit_bar: int
    entry_price: float
    exit_price: float
    direction: str          # "Long" or "Short"
    contracts: int
    gross_pnl: float        # price_diff * contracts * point_value
    slip_cost: float        # (entry_slip + exit_slip) * contracts
    comm_cost: float        # commission_per_side * contracts * 2
    net_pnl: float          # gross - slip_cost - comm_cost
    exit_reason: str        # "signal" | "stop" | "target" | "eod"


# ─── Strategy config (passed as a single param to avoid metaclass issues) ─

@dataclass
class _StratCfg:
    """All per-strategy config, bundled into a single object passed as one param."""
    point_value: float
    slippage_arr: Optional[np.ndarray]
    commission_per_side: float
    contracts: int
    side: str               # "long" | "short"
    stop_atr_mult: float
    tp_atr_mult: float      # 0 = disabled (no fixed TP; exit only on stop/signal)


# ─── Supported entry indicators ───────────────────────────────────────

SUPPORTED_INDICATORS = {"ema_crossover", "atr_breakout"}


def _validate_dsl(dsl: dict) -> None:
    ind = dsl.get("entry_indicator", "")
    if ind not in SUPPORTED_INDICATORS:
        raise NotImplementedError(
            f"backtrader_adapter only supports {sorted(SUPPORTED_INDICATORS)}; "
            f"got '{ind}'.  Add a new strategy class to support more indicators."
        )


# ─── Mixin for shared trade accounting ───────────────────────────────

class _TradeMixin:
    """Shared P&L accounting logic.  Not a bt.Strategy — injected via mixin."""

    def _init_mixin(self, cfg: _StratCfg) -> None:
        self._cfg = cfg
        self._trades: list[BTTrade] = []
        self._entry_bar: int = -1
        self._entry_price: float = 0.0
        self._stop_price: float = 0.0
        self._tp_price: float = 0.0
        self._in_trade: bool = False

    def _bar_idx(self) -> int:
        return len(self.data) - 1  # type: ignore[attr-defined]

    def _get_slip(self, bar: int) -> float:
        arr = self._cfg.slippage_arr
        if arr is None or bar >= len(arr):
            return 0.0
        v = float(arr[bar])
        return 0.0 if math.isnan(v) else v

    def _record_trade(self, exit_bar: int, exit_price: float, exit_reason: str) -> None:
        cfg = self._cfg
        n = cfg.contracts
        pv = cfg.point_value
        entry_p = self._entry_price
        entry_b = self._entry_bar

        if cfg.side == "long":
            gross = (exit_price - entry_p) * n * pv
        else:
            gross = (entry_p - exit_price) * n * pv

        slip_cost = (self._get_slip(entry_b) + self._get_slip(exit_bar)) * n
        comm_cost = cfg.commission_per_side * n * 2
        net = gross - slip_cost - comm_cost

        self._trades.append(BTTrade(
            entry_bar=entry_b,
            exit_bar=exit_bar,
            entry_price=entry_p,
            exit_price=exit_price,
            direction="Long" if cfg.side == "long" else "Short",
            contracts=n,
            gross_pnl=round(gross, 2),
            slip_cost=round(slip_cost, 2),
            comm_cost=round(comm_cost, 2),
            net_pnl=round(net, 2),
            exit_reason=exit_reason,
        ))
        self._in_trade = False
        self._entry_bar = -1

    def _enter(self, bar: int, price: float, atr: float) -> None:
        cfg = self._cfg
        self._in_trade = True
        self._entry_bar = bar
        self._entry_price = price
        mult = cfg.stop_atr_mult
        if cfg.side == "long":
            self._stop_price = price - atr * mult
            self._tp_price = (
                price + atr * cfg.tp_atr_mult
                if cfg.tp_atr_mult > 0 else float("inf")
            )
        else:
            self._stop_price = price + atr * mult
            self._tp_price = (
                price - atr * cfg.tp_atr_mult
                if cfg.tp_atr_mult > 0 else float("-inf")
            )

    def _check_exit(self, bar: int) -> bool:
        """Check stop/target on current bar.  Returns True if exited."""
        if not self._in_trade:
            return False
        hi = float(self.data.high[0])  # type: ignore[attr-defined]
        lo = float(self.data.low[0])   # type: ignore[attr-defined]
        side = self._cfg.side
        if side == "long":
            if lo <= self._stop_price:
                self._record_trade(bar, self._stop_price, "stop")
                return True
            if hi >= self._tp_price:
                self._record_trade(bar, self._tp_price, "target")
                return True
        else:
            if hi >= self._stop_price:
                self._record_trade(bar, self._stop_price, "stop")
                return True
            if lo <= self._tp_price:
                self._record_trade(bar, self._tp_price, "target")
                return True
        return False


# ─── EMA Crossover Strategy ───────────────────────────────────────────

class EMACrossoverStrategy(_TradeMixin, bt.Strategy):
    """EMA crossover: fast EMA crosses slow EMA → enter next-bar open.

    Matches trend_mnq fixture:
        fast_period=9, slow_period=21, confirmation_bars=2
    """

    params = (
        ("cfg", None),              # _StratCfg instance
        ("fast_period", 9),
        ("slow_period", 21),
        ("confirmation_bars", 2),
    )

    def __init__(self):
        self._init_mixin(self.params.cfg)
        self.ema_fast = bt.indicators.ExponentialMovingAverage(
            self.data.close, period=self.params.fast_period
        )
        self.ema_slow = bt.indicators.ExponentialMovingAverage(
            self.data.close, period=self.params.slow_period
        )
        self.crossover = bt.indicators.CrossOver(self.ema_fast, self.ema_slow)
        self.atr_ind = bt.indicators.ATR(self.data, period=14)
        self._bars_since_cross: int = 0
        self._pending_signal: int = 0  # +1 long, -1 short, 0 none

    def next(self):
        bar = self._bar_idx()
        side = self._cfg.side

        # 1. Check stops/targets on open trade first
        if self._in_trade:
            if self._check_exit(bar):
                return

        # 2. Detect new crossover
        co = self.crossover[0]
        if co > 0 and side == "long":
            self._pending_signal = 1
            self._bars_since_cross = 0
        elif co < 0 and side == "short":
            self._pending_signal = -1
            self._bars_since_cross = 0

        if self._pending_signal != 0:
            self._bars_since_cross += 1

        # 3. After confirmation_bars, enter on this bar's open
        #    (because we saw the signal conf_bars bars ago, this bar is the fill bar)
        conf = self.params.confirmation_bars
        if (
            self._pending_signal != 0
            and self._bars_since_cross > conf
            and not self._in_trade
        ):
            entry_price = float(self.data.open[0])
            atr_val_raw = float(self.atr_ind[0])
            atr_val = atr_val_raw if not math.isnan(atr_val_raw) else 1.0
            self._enter(bar, entry_price, atr_val)
            self._pending_signal = 0
            self._bars_since_cross = 0

    def stop(self):
        if self._in_trade:
            bar = self._bar_idx()
            self._record_trade(bar, float(self.data.close[0]), "eod")


# ─── ATR Breakout Strategy ────────────────────────────────────────────

class ATRBreakoutStrategy(_TradeMixin, bt.Strategy):
    """ATR breakout: close breaks period high/low + channel → enter next-bar open.

    Matches scalper_mes fixture:
        period=14, multiplier=1.5, stop=1.2x ATR, tp=2.0x ATR
    """

    params = (
        ("cfg", None),              # _StratCfg instance
        ("atr_period", 14),
        ("atr_multiplier", 1.5),
    )

    def __init__(self):
        self._init_mixin(self.params.cfg)
        self.atr_ind = bt.indicators.ATR(self.data, period=self.params.atr_period)
        self.period_high = bt.indicators.Highest(
            self.data.high, period=self.params.atr_period
        )
        self.period_low = bt.indicators.Lowest(
            self.data.low, period=self.params.atr_period
        )
        self._signal_pending: int = 0  # +1 long, -1 short, 0 none

    def next(self):
        bar = self._bar_idx()
        side = self._cfg.side

        # 1. Check stops/targets first
        if self._in_trade:
            if self._check_exit(bar):
                return

        # 2. If we have a pending signal from last bar, execute fill now (next-bar)
        if self._signal_pending != 0 and not self._in_trade:
            entry_price = float(self.data.open[0])
            atr_val_raw = float(self.atr_ind[0])
            atr_val = atr_val_raw if not math.isnan(atr_val_raw) else 1.0
            self._enter(bar, entry_price, atr_val)
            self._signal_pending = 0
            return

        # 3. Detect breakout signal on this bar's close vs PRIOR period high/low
        atr_val_raw = float(self.atr_ind[0])
        atr_val = atr_val_raw if not math.isnan(atr_val_raw) else 1.0
        close = float(self.data.close[0])
        # period_high[-1] = prior bar's rolling period high
        ph_raw = float(self.period_high[-1])
        pl_raw = float(self.period_low[-1])
        ph = ph_raw if not math.isnan(ph_raw) else close
        pl_ = pl_raw if not math.isnan(pl_raw) else close
        channel = atr_val * self.params.atr_multiplier

        if side == "long" and close > ph + channel and not self._in_trade:
            self._signal_pending = 1
        elif side == "short" and close < pl_ - channel and not self._in_trade:
            self._signal_pending = -1

    def stop(self):
        if self._in_trade:
            bar = self._bar_idx()
            self._record_trade(bar, float(self.data.close[0]), "eod")


# ─── Adapter entrypoint ───────────────────────────────────────────────

def run_backtrader(
    dsl: dict,
    df_pd: pd.DataFrame,
    slippage_arr: np.ndarray,
    commission_per_side: float,
    point_value: float,
    contracts: int,
) -> list[BTTrade]:
    """Run a DSL fixture through backtrader and return normalised trade list.

    Args:
        dsl: parsed DSL fixture dict.
        df_pd: OHLCV DataFrame with DatetimeIndex, columns [open, high, low, close, volume].
        slippage_arr: per-bar dollar slippage (one entry per bar, same alignment as df_pd).
        commission_per_side: dollars per side per contract.
        point_value: futures point value (e.g. 2.0 for MNQ, 5.0 for MES).
        contracts: fixed contract size for parity test.

    Returns:
        List of BTTrade records.
    """
    _validate_dsl(dsl)
    direction = dsl.get("direction", "both")
    sides = ["long", "short"] if direction == "both" else [direction]

    stop_atr_mult = float(dsl.get("stop_loss_atr_multiple", 2.0))
    tp_atr_mult = float(dsl.get("take_profit_atr_multiple") or 0.0)

    ind = dsl["entry_indicator"]
    ep = dsl.get("entry_params", {})

    all_trades: list[BTTrade] = []

    for side in sides:
        cfg = _StratCfg(
            point_value=point_value,
            slippage_arr=slippage_arr,
            commission_per_side=commission_per_side,
            contracts=contracts,
            side=side,
            stop_atr_mult=stop_atr_mult,
            tp_atr_mult=tp_atr_mult,
        )

        cerebro = bt.Cerebro()
        cerebro.broker.setcash(1_000_000)
        # Commission is 0 — we compute P&L ourselves post-trade.
        cerebro.broker.setcommission(commission=0.0)

        data_feed = bt.feeds.PandasData(dataname=df_pd)
        cerebro.adddata(data_feed)

        if ind == "ema_crossover":
            cerebro.addstrategy(
                EMACrossoverStrategy,
                cfg=cfg,
                fast_period=int(ep.get("fast_period", 9)),
                slow_period=int(ep.get("slow_period", 21)),
                confirmation_bars=int(ep.get("confirmation_bars", 2)),
            )
        elif ind == "atr_breakout":
            cerebro.addstrategy(
                ATRBreakoutStrategy,
                cfg=cfg,
                atr_period=int(ep.get("period", 14)),
                atr_multiplier=float(ep.get("multiplier", 1.5)),
            )

        results = cerebro.run()
        strat = results[0]
        all_trades.extend(strat._trades)

    return all_trades
