"""DS22 Track X4 — static Pine-vs-engine result-equivalence test.

Closes the documented gap in CLAUDE.md §7 ("The Pine parity wall"):

    "Still open: no static Pine-vs-engine result-equivalence test — the
    runtime reconciliation harness is the operating control for deployed
    bots."

Scope — deliberately bounded, not a general Pine interpreter
--------------------------------------------------------------
Archetype under test: SMA(3)/SMA(6) crossover entry + ATR(14)*2.0 fixed
stop-only exit, direction=both, no target, no session filter, no
regime/confluence/multi-TF gating. This is exactly the class of strategy
`src.engine.exportability.score_exportability()` scores exportable=True AND
faithful=True (asserted below, not assumed) — the class CLAUDE.md §7 calls
"faithful": Pine can fully represent it (a single strategy.exit(), the raw
indicator signal, one chart timeframe). Full Slumdawg (Style C partials,
11-factor confluence, multi-TF bias) is NOT this class — exportability.py
HARD-BLOCKS that class (faithful=False, exportable=False) and this test does
not attempt to cover it; that refusal is the correct, already-tested behavior
(see test_exportability_faithful_adversarial.py). This test targets the
strategy class Pine *can* legitimately claim to represent, and asks whether
what actually gets emitted is trustworthy.

Two INDEPENDENT oracles evaluate the SAME synthetic 5-minute MES bar series:

  (a) ENGINE oracle — calls real, UNMODIFIED production functions:
        - src.engine.signals.generate_signals() for entry-signal timing
          (the actual expression evaluator used by run_backtest()).
        - src.engine.backtester._apply_stop_only_management() for the
          stop-hit exit walk (gap-fill-on-open included). This is the
          production function backtester.py itself calls when
          exit_policy="stop_only" (the fixed-stop, no-partials, no-TP
          policy — the correct analog of a Pine strategy.exit() with a
          single stop and no target).
      Nothing in this file reimplements or monkeypatches these functions.

  (b) PINE oracle — compiles the SAME StrategyDSL via the real, live
      production entry point src.engine.pine_compiler.compile_dual_artifacts()
      (verified to be what src/server/services/pine-export-service.ts
      actually invokes — grep confirms compile_strategy() is legacy/unused
      by the service). The emitted STRATEGY artifact's Pine TEXT is then
      parsed via regex to extract the actual numbers the compiler chose to
      emit (SMA periods, ATR stop multiplier, use_target, the FOMC/CPI/NFP
      blackout expressions, the anti-setup expression, the daily loss /
      max-drawdown thresholds) and a from-scratch bar-by-bar walk
      (independent of _apply_stop_only_management — see _pine_stop_walk)
      evaluates ta.crossover / ta.crossunder + the fixed-stop rule directly
      from those EXTRACTED values. A compiler bug that silently emitted the
      wrong period or multiplier would show up ONLY on this side, which is
      what makes comparing it against (a) meaningful instead of circular.

Assertion: entry bar index, exit bar index, and exit price (2-tick MES
tolerance per CLAUDE.md §8: 2 * 0.25 = 0.5) must match between oracles.

RED-then-GREEN proof (mutation tests at the bottom of this file):
  A deliberate divergence is injected directly into the compiled Pine TEXT
  (raising the crossover threshold for entry; loosening the stop multiplier
  for exit) and the SAME extraction+evaluation path is re-run. Both mutations
  are verified to break the equivalence assertion (RED), demonstrating the
  checker is non-vacuous. The unmutated path (GREEN) is the permanent,
  CI-safe regression test — the RED path is a meta-test asserting the checker
  itself catches injected divergence, not a permanently-failing test.

Disclosed scope boundaries (see final report to the operator for detail):
  - Bars are constructed to fall outside the 15:55 ET flatten, the FOMC/CPI
    hardcoded date tables, the NFP first-Friday window, and the 9:00-9:45
    anti-setup window. This is VERIFIED below (test_blackout_and_risk_gates_
    are_structurally_inert), not assumed.
  - risk_lockout is verified inert via explicit dollar P&L computed from the
    extracted daily_loss_limit / max_drawdown_limit thresholds, not assumed.
  - ATR(14) is computed ONCE (Wilder RMA, the textbook ta.atr semantic) and
    fed identically to both oracles. This test does not re-verify that a live
    TradingView chart's ta.atr(14) numerically equals this implementation for
    real market data — that numerical-parity concern is already covered by
    the runtime reconciliation harness (scripts/pine-broker-reconcile.ts,
    CLAUDE.md §7/§8), which remains the operating control for LIVE numerical
    parity. This test closes the STATIC translation-equivalence gap, not the
    live-numerical-parity gap — those are two different, both-necessary
    controls.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import polars as pl

from src.engine.backtester import _apply_stop_only_management
from src.engine.config import (
    CONTRACT_SPECS,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.exportability import score_exportability
from src.engine.pine_compiler import compile_dual_artifacts
from src.engine.signals import generate_signals

ET = ZoneInfo("America/New_York")
MES_TICK = 0.25
TWO_TICK_TOLERANCE = 2 * MES_TICK  # CLAUDE.md §8 reconciliation tolerance

FAST_PERIOD = 3
SLOW_PERIOD = 6
ATR_PERIOD = 14
STOP_MULT = 2.0


# ─────────────────────────────────────────────────────────────────────────────
# Synthetic bar series — verified (not just asserted) to produce exactly one
# clean long entry (SMA3/SMA6 crossover) followed by a clean stop-loss exit,
# with no interfering signals and every prop-risk/time-based gate inert.
# ─────────────────────────────────────────────────────────────────────────────

def _build_bars(n_tail_flat: int = 6) -> dict:
    """Deterministic 5m MES bar series.

    Bars 0-19: flat close (4000.0), constant +-1.0 high/low band -> quiet ATR
      seed, zero SMA(3)/SMA(6) divergence (no spurious crossovers).
    Bars 20-22: a one-bar jump to 4010/4011/4012 -> SMA(3) crosses above
      SMA(6) at bar 20 exactly once (verified below).
    Bar 23: a sharp drop to 3980.0 -> breaches the ATR*2.0 stop opened at
      bar 20 (verified below), with NO gap-through (prior close 4012 stays
      above the stop price, so the stop fills at the exact stop price).
    Bars 24+: flat tail so the walk always terminates inside the array.

    All timestamps: 2030-06-18 (Tuesday), 10:00 ET onward, 5-minute bars.
    2030 is chosen because it falls outside every FOMC/CPI hardcoded date in
    pine_compiler.py's event-blackout tables (2025-2027 only) -- verified
    structurally in test_blackout_and_risk_gates_are_structurally_inert, not
    assumed here.
    """
    base = 4000.0
    closes = [base] * 20
    closes += [base + 10.0, base + 11.0, base + 12.0]
    closes += [base - 20.0]
    closes += [base - 20.0] * n_tail_flat
    closes = np.array(closes, dtype=float)
    n = len(closes)

    highs = closes + 1.0
    lows = closes - 1.0
    opens = np.empty(n)
    opens[0] = closes[0]
    opens[1:] = closes[:-1]

    # Wilder RMA ATR(14) -- ta.atr(14)'s documented semantic. Computed ONCE and
    # shared by both oracles (see module docstring: ATR-formula parity is a
    # separate, already-covered concern).
    tr = np.empty(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    atr = np.full(n, np.nan)
    atr[ATR_PERIOD - 1] = tr[:ATR_PERIOD].mean()
    for i in range(ATR_PERIOD, n):
        atr[i] = (atr[i - 1] * (ATR_PERIOD - 1) + tr[i]) / ATR_PERIOD

    start_et = datetime(2030, 6, 18, 10, 0, 0, tzinfo=ET)
    et_datetimes = [start_et + timedelta(minutes=5 * i) for i in range(n)]
    ts_event_utc = [dt.astimezone(timezone.utc) for dt in et_datetimes]

    return {
        "n": n, "opens": opens, "highs": highs, "lows": lows, "closes": closes,
        "atr": atr, "et_datetimes": et_datetimes, "ts_event_utc": ts_event_utc,
    }


def _pine_sma(closes: np.ndarray, period: int) -> np.ndarray:
    """ta.sma(close, period) -- simple trailing mean, textbook / unambiguous."""
    n = len(closes)
    out = np.full(n, np.nan)
    for i in range(n):
        if i + 1 >= period:
            out[i] = closes[i - period + 1:i + 1].mean()
    return out


class TestSyntheticSeriesSanity:
    """The bar series is engineered, not organic -- verify the engineering
    actually did what it claims before trusting any equivalence result built
    on top of it."""

    def test_exactly_one_crossover_and_it_is_at_bar_20(self):
        bars = _build_bars()
        fast = _pine_sma(bars["closes"], FAST_PERIOD)
        slow = _pine_sma(bars["closes"], SLOW_PERIOD)
        crossovers = [
            i for i in range(1, bars["n"])
            if not np.isnan(fast[i]) and not np.isnan(slow[i])
            and not np.isnan(fast[i - 1]) and not np.isnan(slow[i - 1])
            and fast[i] > slow[i] and fast[i - 1] <= slow[i - 1]
        ]
        assert crossovers == [20]

    def test_stop_breach_after_entry_is_at_bar_23_no_gap(self):
        bars = _build_bars()
        entry_idx = 20
        entry_price = bars["closes"][entry_idx]
        stop_price = entry_price - bars["atr"][entry_idx] * STOP_MULT
        # No premature breach on bars 21-22 (still above the stop).
        for i in (21, 22):
            assert bars["lows"][i] > stop_price
        assert bars["lows"][23] <= stop_price
        assert bars["opens"][23] > stop_price  # confirms exact-stop fill, not gap-fill


# ─────────────────────────────────────────────────────────────────────────────
# ENGINE oracle -- real, unmodified production functions.
# ─────────────────────────────────────────────────────────────────────────────

def _make_dsl_strategy() -> dict:
    return {
        "name": "DS22 X4 SMA Cross Equivalence",
        "description": "SMA(3)/SMA(6) crossover, ATR(14)*2.0 stop-only exit",
        "symbol": "MES",
        "timeframe": "5m",
        "direction": "both",
        "entry_type": "trend_follow",
        "entry_indicator": "sma_crossover",
        "entry_params": {"fast": FAST_PERIOD, "slow": SLOW_PERIOD},
        "exit_type": "atr_multiple",
        "exit_params": {},
        "stop_loss_atr_multiple": STOP_MULT,
        "indicators": [
            {"type": "sma", "period": FAST_PERIOD},
            {"type": "sma", "period": SLOW_PERIOD},
        ],
    }


def _engine_entry_idx(bars: dict) -> int:
    """Real production entry-signal path: StrategyConfig + generate_signals()."""
    config = StrategyConfig(
        name="engine-oracle",
        symbol="MES",
        timeframe="5m",
        indicators=[
            IndicatorConfig(type="sma", period=FAST_PERIOD),
            IndicatorConfig(type="sma", period=SLOW_PERIOD),
        ],
        entry_long=f"sma_{FAST_PERIOD} crosses_above sma_{SLOW_PERIOD}",
        entry_short=f"sma_{FAST_PERIOD} crosses_below sma_{SLOW_PERIOD}",
        exit="close crosses_below 0",  # always-false: exit_type=atr_multiple has no signal exit
        stop_loss=StopConfig(type="atr", multiplier=STOP_MULT),
        position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
    )
    df = pl.DataFrame({
        "close": bars["closes"],
        f"sma_{FAST_PERIOD}": _pine_sma(bars["closes"], FAST_PERIOD),
        f"sma_{SLOW_PERIOD}": _pine_sma(bars["closes"], SLOW_PERIOD),
    })
    out = generate_signals(df, config)
    entry_long = out["entry_long"].to_list()
    idxs = [i for i, v in enumerate(entry_long) if v]
    assert idxs, "engine oracle produced zero entries -- synthetic series is broken"
    return idxs[0]


def _engine_exit(bars: dict, entry_idx: int) -> dict:
    """Real production exit path: _apply_stop_only_management(), unmodified."""
    trades_records = pd.DataFrame({
        "Avg Entry Price": [bars["closes"][entry_idx]],
        "Avg Exit Price": [bars["closes"][-1]],  # fallback if stop never fires
        "Size": [1.0],
        "Direction": ["Long"],
        "Entry Idx": [entry_idx],
        "Exit Idx": [bars["n"] - 1],
    })
    pl_df = pl.DataFrame({
        "close": bars["closes"], "open": bars["opens"],
        "high": bars["highs"], "low": bars["lows"],
        "ts_event": bars["ts_event_utc"],
    })
    managed = _apply_stop_only_management(
        trades_records,
        high_np=bars["highs"], low_np=bars["lows"], close_np=bars["closes"],
        atr_np=bars["atr"], spec=CONTRACT_SPECS["MES"], df=pl_df,
        open_np=bars["opens"], atr_stop_multiplier=STOP_MULT,
    )
    assert len(managed) == 1
    return managed[0]


# ─────────────────────────────────────────────────────────────────────────────
# PINE oracle -- extraction from the REAL compiled Pine text + an independent
# bar-by-bar evaluator (does NOT call _apply_stop_only_management).
# ─────────────────────────────────────────────────────────────────────────────

_SAFE_BOOL_EXPR_RE = re.compile(r"^[\s0-9()<>=!andor]+$")


def _eval_pine_time_bool(expr: str, dt_et: datetime) -> bool:
    """Evaluate one of the compiler's hardcoded timestamp boolean expressions
    (fomc_blackout / cpi_blackout / nfp_blackout / anti_setup_blocked) against
    a real ET-local datetime, by substituting Pine's built-in identifiers with
    the bar's actual values and evaluating the resulting Python expression.
    `dayofweek.friday` is replaced with `4` (Python .weekday(): Mon=0..Sun=6,
    Fri=4) BEFORE the bare `dayofweek` identifier is replaced with the bar's
    actual weekday, so the two substitutions cannot collide.

    Security note on eval(): after substitution every Pine identifier
    (year/month/dayofmonth/hour/minute/dayofweek) has been replaced with a
    plain integer, so the string can only contain digits, whitespace, the
    comparison operators (<, >, <=, >=, ==, !=), parentheses, and the boolean
    keywords and/or -- never a free identifier, attribute access, call, or
    string literal. _SAFE_BOOL_EXPR_RE enforces exactly that character
    whitelist and is checked BEFORE eval() runs (fail-closed: raises rather
    than evaluates on any unexpected content, e.g. a future compiler template
    change that adds a new identifier this test doesn't yet substitute).
    __builtins__ is also stripped from eval's globals as defense in depth.
    Input is the compiler's own generated text, not external/untrusted data.
    """
    e = expr.replace("\n", " ")  # OR-chains span lines without enclosing brackets; eval() needs one logical line
    e = e.replace("dayofweek.friday", "4")
    e = re.sub(r"\bdayofweek\b", str(dt_et.weekday()), e)
    e = re.sub(r"\byear\b", str(dt_et.year), e)
    e = re.sub(r"\bmonth\b", str(dt_et.month), e)
    e = re.sub(r"\bdayofmonth\b", str(dt_et.day), e)
    e = re.sub(r"\bhour\b", str(dt_et.hour), e)
    e = re.sub(r"\bminute\b", str(dt_et.minute), e)
    if not _SAFE_BOOL_EXPR_RE.match(e):
        raise ValueError(
            f"Refusing to evaluate expression outside the numeric-boolean whitelist: {e!r} "
            f"(original: {expr!r}) -- pine_compiler.py's blackout-expression template may "
            "have changed; update the identifier substitutions in _eval_pine_time_bool."
        )
    return bool(eval(e, {"__builtins__": {}}, {}))  # noqa: S307 -- whitelisted to digits/parens/cmp/and/or above


def _eval_arith_token(token: str, series_map: dict, i: int) -> float:
    """Evaluate a crossover argument token ('ind_sma_1' or 'ind_sma_1 + 5.0')
    against the per-bar series map. Handles the bounded '<ident> +/- <float>'
    grammar this compiler's templates and the RED-proof mutation both use."""
    token = token.strip()
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*([0-9.]+)$", token)
    if m:
        ident, sign, val = m.group(1), m.group(2), float(m.group(3))
        base = series_map[ident][i]
        return base + val if sign == "+" else base - val
    if token in series_map:
        return series_map[token][i]
    return float(token)


class PineExtraction:
    """Parses the fields this test needs out of a compiled STRATEGY artifact.
    Bounded to the exact templates pine_compiler.py emits for this archetype
    class -- not a general Pine parser."""

    def __init__(self, pine_text: str):
        self.text = pine_text
        self.atr_period = int(self._one(r"atr_val = ta\.atr\((\d+)\)"))
        self.fast_period = float(self._one(r"ind_sma_0 = ta\.sma\(close,\s*([0-9.]+)\)"))
        self.slow_period = float(self._one(r"ind_sma_1 = ta\.sma\(close,\s*([0-9.]+)\)"))
        self.stop_mult = float(self._one(r"stop_distance = atr_val \* ([0-9.]+)"))
        self.use_target = self._one(r"use_target = (true|false)") == "true"
        self.in_session = self._one(r"in_session = (true|false)") == "true"
        self.regime_match_literal = self._one(r"regime_match = (\S+)")
        long_line = self._one(r"long_signal = (.+)")
        m = re.search(r"ta\.crossover\((.+?),\s*(.+?)\)\)?$", long_line)
        assert m, f"could not find ta.crossover(...) in long_signal line: {long_line!r}"
        self.crossover_arg_a, self.crossover_arg_b = m.group(1), m.group(2)
        # Non-greedy up to the next field's literal assignment, then cut at the
        # first blank line: a "// CPI blackout: ..." comment block sits between
        # the fomc OR-chain and the cpi_blackout assignment (blank line, then
        # comment lines, then the assignment) -- the non-greedy match alone
        # would swallow that trailing comment block into the captured group.
        self.fomc_expr = self._one(r"fomc_blackout = (.*?)\ncpi_blackout = ", dotall=True).split("\n\n")[0].strip()
        self.cpi_expr = self._one(r"cpi_blackout = (.*?)\nnfp_blackout = ", dotall=True).split("\n\n")[0].strip()
        self.nfp_expr = self._one(r"nfp_blackout = (.+)")
        self.anti_setup_expr = self._one(r"anti_setup_blocked = (.+)")
        self.entry_allowed_line = self._one(r"entry_allowed = (.+)")
        self.daily_loss_limit = self._one(r"var float daily_loss_limit = ([0-9.]+|na)")
        self.max_drawdown_limit = float(self._one(r"var float max_drawdown_limit = ([0-9.]+)"))
        # F-1 invariant presence check (not evaluated numerically -- see module docstring).
        assert '"1555-1600"' in pine_text, "expected 15:55 ET time-stop invariant not found in emitted Pine"

    def _one(self, pattern: str, dotall: bool = False) -> str:
        flags = re.MULTILINE | (re.DOTALL if dotall else 0)
        m = re.search(pattern, self.text, flags)
        assert m, f"pattern not found in compiled Pine: {pattern!r}"
        return m.group(1).strip()

    def entry_allowed_at(self, dt_et: datetime, position_open: bool, risk_lockout: bool) -> bool:
        if position_open or risk_lockout:
            return False
        if _eval_pine_time_bool(self.fomc_expr, dt_et):
            return False
        if _eval_pine_time_bool(self.cpi_expr, dt_et):
            return False
        if _eval_pine_time_bool(self.nfp_expr, dt_et):
            return False
        if _eval_pine_time_bool(self.anti_setup_expr, dt_et):
            return False
        # regime_match: constant "true" literal verified by the extraction
        # (no preferred_regime configured on this archetype).
        return self.regime_match_literal == "true"


def _pine_find_entry(extraction: PineExtraction, bars: dict) -> int | None:
    fast = _pine_sma(bars["closes"], int(extraction.fast_period))
    slow = _pine_sma(bars["closes"], int(extraction.slow_period))
    series_map = {"ind_sma_0": fast, "ind_sma_1": slow, "close": bars["closes"]}
    n = bars["n"]
    a_vals = np.array([_eval_arith_token(extraction.crossover_arg_a, series_map, i) for i in range(n)])
    b_vals = np.array([_eval_arith_token(extraction.crossover_arg_b, series_map, i) for i in range(n)])
    for i in range(1, n):
        if np.isnan(a_vals[i]) or np.isnan(b_vals[i]) or np.isnan(a_vals[i - 1]) or np.isnan(b_vals[i - 1]):
            continue
        crossover = a_vals[i] > b_vals[i] and a_vals[i - 1] <= b_vals[i - 1]
        if crossover and extraction.in_session and extraction.entry_allowed_at(
            bars["et_datetimes"][i], position_open=False, risk_lockout=False,
        ):
            return i
    return None


def _pine_stop_walk(extraction: PineExtraction, bars: dict, entry_idx: int) -> dict:
    """Independent (does not call _apply_stop_only_management) re-implementation
    of what the compiled Pine's strategy.exit(stop=close-stop_distance) does on
    a bar-by-bar basis: fixed stop set at entry, no target, gap-fill-on-open."""
    entry_price = bars["closes"][entry_idx]
    stop_price = entry_price - bars["atr"][entry_idx] * extraction.stop_mult
    n = bars["n"]
    for bar in range(entry_idx + 1, n):
        bar_open = bars["opens"][bar]
        bar_low = bars["lows"][bar]
        if bar_low <= stop_price:
            if bar_open < stop_price:
                return {"exit_idx": bar, "exit_price": bar_open, "exit_reason": "stop_loss", "gap": True}
            return {"exit_idx": bar, "exit_price": stop_price, "exit_reason": "stop_loss", "gap": False}
    return {"exit_idx": n - 1, "exit_price": bars["closes"][n - 1], "exit_reason": "signal", "gap": False}


# ─────────────────────────────────────────────────────────────────────────────
# Archetype-class precondition: this strategy IS the "faithful" Pine class.
# ─────────────────────────────────────────────────────────────────────────────

class TestArchetypeIsFaithfulExportable:
    def test_faithful_and_exportable(self):
        result = score_exportability(_make_dsl_strategy())
        assert result.exportable is True
        assert result.faithful is True
        assert result.band in ("clean", "reducible")


# ─────────────────────────────────────────────────────────────────────────────
# GREEN: main static equivalence assertion.
# ─────────────────────────────────────────────────────────────────────────────

class TestPineEngineStaticEquivalence:
    def test_entry_exit_equivalence(self):
        bars = _build_bars()

        engine_entry_idx = _engine_entry_idx(bars)
        engine_exit = _engine_exit(bars, engine_entry_idx)

        dsl = _make_dsl_strategy()
        dual = compile_dual_artifacts(dsl)
        assert dual.exportable, dual.degradation_notes
        pine_text = dual.strategy_artifact.content
        extraction = PineExtraction(pine_text)

        pine_entry_idx = _pine_find_entry(extraction, bars)
        assert pine_entry_idx is not None
        pine_exit = _pine_stop_walk(extraction, bars, pine_entry_idx)

        # ── The equivalence assertion ──
        assert pine_entry_idx == engine_entry_idx, (
            f"entry bar mismatch: pine={pine_entry_idx} engine={engine_entry_idx}"
        )
        assert pine_exit["exit_idx"] == engine_exit["exit_idx"], (
            f"exit bar mismatch: pine={pine_exit['exit_idx']} engine={engine_exit['exit_idx']}"
        )
        assert pine_exit["exit_reason"] == engine_exit["exit_reason"]
        assert abs(pine_exit["exit_price"] - engine_exit["exit_price"]) <= TWO_TICK_TOLERANCE, (
            f"exit price mismatch beyond 2-tick tolerance: "
            f"pine={pine_exit['exit_price']} engine={engine_exit['exit_price']}"
        )

    def test_blackout_and_risk_gates_are_structurally_inert(self):
        """Verifies (does not assume) that every prop-risk / time-based gate
        stays False for the whole bar series, so the equivalence result above
        is not accidentally hiding a gate divergence."""
        bars = _build_bars()
        dual = compile_dual_artifacts(_make_dsl_strategy())
        extraction = PineExtraction(dual.strategy_artifact.content)

        for dt_et in bars["et_datetimes"]:
            assert not _eval_pine_time_bool(extraction.fomc_expr, dt_et)
            assert not _eval_pine_time_bool(extraction.cpi_expr, dt_et)
            assert not _eval_pine_time_bool(extraction.nfp_expr, dt_et)
            assert not _eval_pine_time_bool(extraction.anti_setup_expr, dt_et)
            # All bars sit at 10:00-11:15 ET -- nowhere near the 15:55-16:00 flatten.
            assert not (dt_et.hour == 15 and dt_et.minute >= 55)
            assert dt_et.hour < 15

        # risk_lockout: verify the realized P&L on the one trade in this series
        # never approaches daily_loss_limit / max_drawdown_limit.
        entry_idx = _engine_entry_idx(bars)
        exit_info = _engine_exit(bars, entry_idx)
        point_value = CONTRACT_SPECS["MES"].point_value
        realized_pnl = (exit_info["exit_price"] - bars["closes"][entry_idx]) * point_value * 1
        assert extraction.daily_loss_limit != "na"
        assert abs(realized_pnl) < float(extraction.daily_loss_limit)
        assert abs(realized_pnl) < extraction.max_drawdown_limit


# ─────────────────────────────────────────────────────────────────────────────
# RED-then-GREEN: prove the checker is non-vacuous by injecting a deliberate
# divergence directly into the compiled Pine TEXT (simulating a compiler
# translation bug) and confirming the SAME extraction+evaluation path detects
# it. These are meta-tests about the checker, not permanently-red CI tests --
# each asserts the mutated path diverges, so the assertion itself passes.
# ─────────────────────────────────────────────────────────────────────────────

class TestRedProofDivergenceIsCaught:
    def test_mutated_entry_threshold_diverges_from_engine(self):
        """Mutates the emitted crossover threshold (ind_sma_1 -> ind_sma_1 + 5.0),
        simulating a compiler bug that requires a 5-point margin before firing.
        The engine oracle is untouched (still fires at bar 20); the mutated
        Pine oracle must now fire at a DIFFERENT bar (or not at all) -- proving
        the equivalence checker actually distinguishes divergence from parity."""
        bars = _build_bars()
        engine_entry_idx = _engine_entry_idx(bars)

        dual = compile_dual_artifacts(_make_dsl_strategy())
        pine_text = dual.strategy_artifact.content
        mutated_text = pine_text.replace(
            "ta.crossover(ind_sma_0, ind_sma_1)",
            "ta.crossover(ind_sma_0, ind_sma_1 + 5.0)",
        )
        assert mutated_text != pine_text, "mutation did not match any text -- test is vacuous"

        extraction = PineExtraction(mutated_text)
        mutated_entry_idx = _pine_find_entry(extraction, bars)

        assert mutated_entry_idx != engine_entry_idx, (
            "RED-PROOF FAILED: mutated Pine entry threshold did not diverge from the "
            "engine oracle -- the equivalence checker would silently pass a real bug"
        )

    def test_mutated_stop_multiplier_diverges_from_engine(self):
        """Mutates the emitted stop multiplier (atr_val * 2.0 -> atr_val * 1.0),
        simulating a compiler bug that emits the wrong ATR multiplier. The
        engine oracle is untouched (still uses multiplier=2.0); the mutated
        Pine oracle's exit price must diverge beyond the 2-tick tolerance."""
        bars = _build_bars()
        engine_entry_idx = _engine_entry_idx(bars)
        engine_exit = _engine_exit(bars, engine_entry_idx)

        dual = compile_dual_artifacts(_make_dsl_strategy())
        pine_text = dual.strategy_artifact.content
        mutated_text = pine_text.replace(
            "stop_distance = atr_val * 2.0",
            "stop_distance = atr_val * 1.0",
        )
        assert mutated_text != pine_text, "mutation did not match any text -- test is vacuous"

        extraction = PineExtraction(mutated_text)
        pine_entry_idx = _pine_find_entry(extraction, bars)
        assert pine_entry_idx == engine_entry_idx  # entry side unaffected by this mutation
        mutated_exit = _pine_stop_walk(extraction, bars, pine_entry_idx)

        price_delta = abs(mutated_exit["exit_price"] - engine_exit["exit_price"])
        assert price_delta > TWO_TICK_TOLERANCE, (
            "RED-PROOF FAILED: mutated stop multiplier did not diverge beyond tolerance -- "
            "the equivalence checker would silently pass a real bug"
        )
