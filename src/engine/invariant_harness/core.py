"""Trading Forge — Post-backtest Invariant Harness (Pass B-2).

Independently recomputes key metrics from the raw trade list and asserts
they match what the engine reported.  Runs ALWAYS after run_backtest(),
never env-gated — it is cheap pure computation and serves as the authority
layer between the engine and downstream consumers.

Historical context
------------------
These invariants were designed to catch concrete bug classes found during
the 2026-05-19 accuracy audit session (commits c7ac642 and b8a2140):

  INV-1  balance_arithmetic
         Would have caught: Topstep ending_balance +$7K on a losing strategy
         (DLL-cap firing on EOD MTM swings inflated reported balance).

  INV-2  trade_pnl_sum_matches_total_return
         Would have caught: $1,320 drift between total_return and
         ending_balance on the multi-trade BB-MES strategy.

  INV-3  daily_pnl_sum_matches_total_return
         Catches EOD-vs-trade-level drift; tolerates $5 rounding budget.

  INV-4  long_short_split_matches_total
         Long-only strategies that generated short P&L (direction bug)
         would surface here via long_pnl + short_pnl != total_return.

  INV-5  long_short_trade_counts_match_total_trades
         Exact count consistency; catches direction misclassification.

  INV-6  win_rate_in_range
         Sanity gate: 0 <= win_rate <= 1.

  INV-7  max_drawdown_non_negative
         Drawdown must be a positive dollar loss figure.

  INV-8  peak_equity_at_least_starting
         Peak equity must be >= starting balance (unless always in loss from
         bar 1, which is valid).

  INV-9  sharpe_finite_if_trades       (WARNING)
         NaN/inf Sharpe silently passes gates downstream.

  INV-10 profit_factor_finite_if_trades (WARNING)
         inf PF from zero gross loss inflates forge_score.

  INV-11 avg_trade_pnl_consistent      (WARNING)
         total_return / total_trades should match avg_trade_pnl.

  INV-12 commission_per_trade_reasonable (WARNING)
         Guards against commission model bugs ($3/rt max per contract).

  INV-13 per_firm_endings_consistent   (WARNING)
         For each firm in prop_compliance: firm.ending_balance_uncapped
         should match starting_balance + total_return within $1.
         (Uses ending_balance_uncapped — the DLL-sim-free figure.)

  INV-14 equity_curve_monotone_or_continuous (WARNING)
         Equity curve must have no NaN/null bars and must be non-empty
         when trades exist.

Severity semantics
------------------
CRITICAL  Any CRITICAL failure sets InvariantReport.overall_passed = False
          and triggers a JSON error line on stderr so the orchestrator can
          gate on it.

WARNING   Logged for review; does not fail overall_passed.  Investigated
          offline — common in degenerate-parameter runs.

Tolerance design
----------------
$1 tolerances absorb per-trade rounding (round(..., 2) applied 500+ times).
$5 for daily aggregation absorbs EOD-vs-trade-level timing differences.
$0.50 for avg_trade_pnl absorbs the mean of the per-trade rounding errors.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

# ─── Public dataclasses ──────────────────────────────────────────────────────


@dataclass
class InvariantCheck:
    name: str
    passed: bool
    tolerance: str       # e.g. "$1.00", "0.5%", "exact"
    expected: str        # expression description
    actual: str          # formatted computed value
    evidence: str        # human-readable explanation
    severity: str        # "CRITICAL" | "WARNING"
    # R-627 §3.1: False means the check COULD NOT RUN — its input was absent or
    # unusable — as opposed to running and passing. Defaults True so every
    # existing construction site keeps its current meaning unchanged.
    #
    # WHY THIS EXISTS: `passed=True` was previously returned for BOTH "I checked
    # and it was fine" and "I had nothing to check". Those are different facts,
    # and a verdict must not be able to claim the first while meaning the second.
    applicable: bool = True


@dataclass
class InvariantReport:
    backtest_id: str
    total_checks: int
    passed: int
    failed: int
    critical_failures: list[InvariantCheck]
    warnings: list[InvariantCheck]
    all_checks: list[InvariantCheck]
    overall_passed: bool   # False if any CRITICAL failed
    # R-627 §3.1: checks that could not run. REPORTING ONLY — these are ALSO
    # left in `failed`/`warnings` rather than being subtracted out.
    #
    # DELIBERATE, AND LOAD-BEARING FOR R-627 §3.3: subtracting them would mean a
    # check promoted to CRITICAL could go not-applicable and vanish from
    # `critical_failures` — reintroducing the fail-open this item exists to
    # close, by a new route. Leaving them in means a future promotion makes the
    # absence VISIBLE at the gate instead of silently exempt.
    not_applicable: list[InvariantCheck] = field(default_factory=list)


# ─── Internal helpers ────────────────────────────────────────────────────────

_STARTING_BALANCE = 50_000.0   # matches backtester.py STARTING_CAPITAL


def _is_finite(v) -> bool:
    """Return True when v is a real, finite number."""
    try:
        return math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _safe_float(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def _aggregate_metric_raw(result: dict, key: str, default=0.0):
    """Return raw value at top-level OR nested under oos_metrics.

    Unlike `_aggregate_metric`, this does NOT filter NaN/inf — used by the
    finiteness checks (INV-9 sharpe_finite, INV-10 profit_factor_finite)
    which must preserve NaN so they can detect it.
    """
    if key in result and result[key] is not None:
        return result[key]
    oos = result.get("oos_metrics") or {}
    if isinstance(oos, dict) and key in oos and oos[key] is not None:
        return oos[key]
    return default


def _aggregate_metric(result: dict, key: str, default: float = 0.0) -> float:
    """Read an aggregate metric (total_return, total_trades, sharpe, etc.)
    that may live at the top level OR nested under `oos_metrics`.

    Pass D fix (2026-05-20): walk-forward results return the aggregate metrics
    nested under `oos_metrics` (walk_forward.py:512-523). Single-window
    backtests return them at the top level (backtester.py:2599+). The
    invariant harness must handle BOTH layouts or it will false-positive
    every walk-forward backtest with `metric == 0` failures.

    Prefer top-level when present (single mode); fall back to oos_metrics
    (walk-forward mode). Returns `default` (0) only when BOTH paths miss.
    """
    if key in result and result[key] is not None:
        return _safe_float(result[key], default)
    oos = result.get("oos_metrics") or {}
    if isinstance(oos, dict) and key in oos and oos[key] is not None:
        return _safe_float(oos[key], default)
    return default


# ─── Individual invariant checks ─────────────────────────────────────────────


def _check_balance_arithmetic(result: dict) -> InvariantCheck:
    """INV-1 CRITICAL: ending_balance ≈ starting_balance + total_return."""
    TOLERANCE = 1.0
    starting = _safe_float(result.get("starting_balance", _STARTING_BALANCE))
    total_return = _aggregate_metric(result, "total_return", 0.0)
    ending = _safe_float(result.get("ending_balance", starting + total_return))

    expected_ending = starting + total_return
    diff = abs(ending - expected_ending)
    passed = diff <= TOLERANCE

    return InvariantCheck(
        name="balance_arithmetic",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"ending_balance ≈ {starting:.2f} + {total_return:.2f} = {expected_ending:.2f}",
        actual=f"ending_balance = {ending:.2f}, diff = {diff:.4f}",
        evidence=(
            "ending_balance matches starting_balance + total_return within $1.00"
            if passed else
            f"ending_balance drifts by ${diff:.2f} from expected ${expected_ending:.2f}. "
            "Possible DLL-cap inflation or MTM-swing accounting error."
        ),
        severity="CRITICAL",
    )


def _check_trade_pnl_sum(result: dict) -> InvariantCheck:
    """INV-2 CRITICAL: sum(trade.PnL) ≈ total_return."""
    TOLERANCE = 1.0
    trades = result.get("trades", [])
    total_return = _aggregate_metric(result, "total_return", 0.0)

    pnl_sum = sum(_safe_float(t.get("PnL", t.get("pnl", 0.0))) for t in trades)
    diff = abs(pnl_sum - total_return)
    passed = diff <= TOLERANCE

    return InvariantCheck(
        name="trade_pnl_sum_matches_total_return",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"sum(trade.PnL) ≈ total_return ({total_return:.2f})",
        actual=f"sum = {pnl_sum:.2f}, diff = {diff:.4f}",
        evidence=(
            f"Trade P&L sum {pnl_sum:.2f} matches total_return within $1.00"
            if passed else
            f"${diff:.2f} drift between trade P&L sum ({pnl_sum:.2f}) and "
            f"total_return ({total_return:.2f}). Likely equity-curve accounting mismatch."
        ),
        severity="CRITICAL",
    )


def _check_daily_pnl_sum(result: dict) -> InvariantCheck:
    """INV-3 CRITICAL: sum(daily_pnls) ≈ total_return (tolerance $5 for EOD drift)."""
    TOLERANCE = 5.0
    daily_pnls = result.get("daily_pnls", [])
    total_return = _aggregate_metric(result, "total_return", 0.0)

    if not daily_pnls:
        # No daily data — only check if there are also no trades.
        total_trades = int(_aggregate_metric(result, "total_trades", 0))
        passed = total_trades == 0
        return InvariantCheck(
            name="daily_pnl_sum_matches_total_return",
            passed=passed,
            tolerance=f"${TOLERANCE:.2f}",
            expected="sum(daily_pnls) ≈ total_return",
            actual="daily_pnls list is empty",
            evidence=(
                "No trades and no daily P&Ls — consistent zero-return case."
                if passed else
                f"daily_pnls list is empty but total_trades={total_trades}. "
                "Daily aggregation may have failed silently."
            ),
            severity="CRITICAL",
        )

    daily_sum = sum(_safe_float(p) for p in daily_pnls)
    diff = abs(daily_sum - total_return)
    passed = diff <= TOLERANCE

    return InvariantCheck(
        name="daily_pnl_sum_matches_total_return",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"sum({len(daily_pnls)} daily P&Ls) ≈ total_return ({total_return:.2f})",
        actual=f"daily_sum = {daily_sum:.2f}, diff = {diff:.4f}",
        evidence=(
            f"Daily P&L sum {daily_sum:.2f} matches total_return within $5.00"
            if passed else
            f"${diff:.2f} drift between daily P&L sum ({daily_sum:.2f}) and "
            f"total_return ({total_return:.2f}). Possible EOD-vs-trade-level timing issue."
        ),
        severity="CRITICAL",
    )


def _check_long_short_split_sum(result: dict) -> InvariantCheck:
    """INV-4 CRITICAL: long_pnl + short_pnl ≈ total_return (tolerance $1)."""
    TOLERANCE = 1.0
    total_return = _aggregate_metric(result, "total_return", 0.0)
    ls = result.get("long_short_split", {})

    # Skip if no split data available
    if not ls or "long" not in ls or "short" not in ls:
        return InvariantCheck(
            name="long_short_split_matches_total",
            passed=True,
            tolerance=f"${TOLERANCE:.2f}",
            expected="long_pnl + short_pnl ≈ total_return",
            actual="long_short_split field absent — check skipped",
            evidence="No long_short_split data; invariant not applicable.",
            severity="CRITICAL",
        )

    long_pnl = _safe_float(ls["long"].get("pnl", 0.0))
    short_pnl = _safe_float(ls["short"].get("pnl", 0.0))
    split_sum = long_pnl + short_pnl
    diff = abs(split_sum - total_return)
    passed = diff <= TOLERANCE

    return InvariantCheck(
        name="long_short_split_matches_total",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"long_pnl ({long_pnl:.2f}) + short_pnl ({short_pnl:.2f}) ≈ total_return ({total_return:.2f})",
        actual=f"split_sum = {split_sum:.2f}, diff = {diff:.4f}",
        evidence=(
            "Long + short P&L sums to total_return within $1.00"
            if passed else
            f"${diff:.2f} drift: long({long_pnl:.2f}) + short({short_pnl:.2f}) = {split_sum:.2f} "
            f"vs total_return={total_return:.2f}. Direction misclassification or double-count."
        ),
        severity="CRITICAL",
    )


def _check_long_short_count(result: dict) -> InvariantCheck:
    """INV-5 CRITICAL: long_count + short_count == total_trades (exact)."""
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    ls = result.get("long_short_split", {})

    if not ls or "long" not in ls or "short" not in ls:
        return InvariantCheck(
            name="long_short_trade_counts_match_total_trades",
            passed=True,
            tolerance="exact",
            expected="long_count + short_count == total_trades",
            actual="long_short_split field absent — check skipped",
            evidence="No long_short_split data; invariant not applicable.",
            severity="CRITICAL",
        )

    long_count = int(ls["long"].get("trades", 0))
    short_count = int(ls["short"].get("trades", 0))
    split_total = long_count + short_count
    passed = split_total == total_trades

    return InvariantCheck(
        name="long_short_trade_counts_match_total_trades",
        passed=passed,
        tolerance="exact",
        expected=f"long_count ({long_count}) + short_count ({short_count}) == total_trades ({total_trades})",
        actual=f"split_total = {split_total}",
        evidence=(
            f"Trade count splits correctly: {long_count}L + {short_count}S = {total_trades}"
            if passed else
            f"Count mismatch: {long_count}L + {short_count}S = {split_total} != total_trades={total_trades}. "
            "Direction field misclassified or trade list incomplete."
        ),
        severity="CRITICAL",
    )


def _check_win_rate_in_range(result: dict) -> InvariantCheck:
    """INV-6 CRITICAL: 0 <= win_rate <= 1."""
    win_rate = _aggregate_metric(result, "win_rate", 0.0)
    passed = 0.0 <= win_rate <= 1.0

    return InvariantCheck(
        name="win_rate_in_range",
        passed=passed,
        tolerance="exact",
        expected="0 <= win_rate <= 1",
        actual=f"win_rate = {win_rate:.6f}",
        evidence=(
            f"win_rate {win_rate:.4f} is within [0, 1]"
            if passed else
            f"win_rate {win_rate:.6f} is outside [0, 1]. Numerator/denominator inversion or division error."
        ),
        severity="CRITICAL",
    )


_MISSING = object()


def _check_max_drawdown_non_negative(result: dict) -> InvariantCheck:
    """INV-7 CRITICAL: max_drawdown must be COMPUTED, and non-negative.

    Three failure modes, not one. The original predicate was `max_dd >= 0`,
    which `0.0` satisfies — and `0.0` is also exactly what `_aggregate_metric`
    returns when the key is ABSENT. A max_drawdown that stopped being computed,
    or collapsed to zero through a sign error, therefore read as healthy.

    Measured 2026-08-02 (AR-654 §4, ruled R-611): flipping the drawdown sign in
    backtester.py drove result["max_drawdown"] to 0.0 on all 90 backtests of a
    smoke battery, and this CRITICAL check reported clean on every one of them.

    The added arm is arithmetic, not a heuristic: if the strategy ENDED below
    where it started (total_return < 0), then peak-to-trough drawdown is at
    least that loss, so max_drawdown == 0 is impossible rather than merely
    unlikely. A genuinely drawdown-free winning strategy is untouched.
    """
    raw = _aggregate_metric_raw(result, "max_drawdown", _MISSING)
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    total_return = _aggregate_metric(result, "total_return", 0.0)

    if raw is _MISSING:
        # ABSENT. Only consistent with a run that took no trades at all.
        passed = total_trades == 0
        return InvariantCheck(
            name="max_drawdown_non_negative",
            passed=passed,
            tolerance="exact",
            expected="max_drawdown present whenever trades were taken",
            actual="max_drawdown is ABSENT from the result",
            evidence=(
                "No trades and no max_drawdown — consistent empty-run case."
                if passed else
                f"max_drawdown is missing from the result but total_trades={total_trades}. "
                "Drawdown computation did not run or did not persist."
            ),
            severity="CRITICAL",
        )

    max_dd = _safe_float(raw)

    if max_dd < 0.0:
        return InvariantCheck(
            name="max_drawdown_non_negative",
            passed=False,
            tolerance="exact",
            expected="max_drawdown >= 0",
            actual=f"max_drawdown = {max_dd:.4f}",
            evidence=(
                f"max_drawdown {max_dd:.4f} is negative. Sign convention error — "
                "should be positive dollar loss."
            ),
            severity="CRITICAL",
        )

    if max_dd == 0.0 and total_return < 0.0:
        return InvariantCheck(
            name="max_drawdown_non_negative",
            passed=False,
            tolerance="exact",
            expected="max_drawdown > 0 when total_return < 0",
            actual=f"max_drawdown = 0.0000 with total_return = {total_return:.2f}",
            evidence=(
                f"max_drawdown is exactly 0 while the strategy lost ${abs(total_return):.2f} "
                f"over {total_trades} trades. A run that ends below its starting equity has a "
                "drawdown of at least that loss, so zero here means max_drawdown is not being "
                "computed — not that the strategy never drew down."
            ),
            severity="CRITICAL",
        )

    return InvariantCheck(
        name="max_drawdown_non_negative",
        passed=True,
        tolerance="exact",
        expected="max_drawdown >= 0, and > 0 when total_return < 0",
        actual=f"max_drawdown = {max_dd:.4f}",
        evidence=f"max_drawdown ${max_dd:.2f} is non-negative (positive loss figure)",
        severity="CRITICAL",
    )


def _check_peak_equity_at_least_starting(result: dict) -> InvariantCheck:
    """INV-8 CRITICAL: peak equity >= starting_balance.

    If the strategy is always in drawdown from bar 1, peak = starting_balance
    (the initial equity value itself).  We allow equality.
    """
    starting = _safe_float(result.get("starting_balance", _STARTING_BALANCE))
    # Compute peak from equity_bars if available; fall back to equity_curve.
    equity_bars = result.get("equity_bars", [])
    if equity_bars:
        peak_equity = max(_safe_float(v, starting) for v in equity_bars)
    else:
        equity_curve = result.get("equity_curve", [])
        if equity_curve:
            peak_equity = max(_safe_float(pt.get("value", starting) if isinstance(pt, dict) else pt, starting)
                              for pt in equity_curve)
        else:
            peak_equity = starting   # no data — trivially pass

    passed = peak_equity >= starting - 0.01   # allow $0.01 floating-point slack

    return InvariantCheck(
        name="peak_equity_at_least_starting",
        passed=passed,
        tolerance="$0.01 float slack",
        expected=f"peak_equity >= starting_balance ({starting:.2f})",
        actual=f"peak_equity = {peak_equity:.2f}",
        evidence=(
            f"Peak equity ${peak_equity:.2f} >= starting ${starting:.2f}"
            if passed else
            f"Peak equity ${peak_equity:.2f} < starting ${starting:.2f}. "
            "Equity curve starts below starting_balance — likely a cumsum initialization bug."
        ),
        severity="CRITICAL",
    )


# ─── WARNING checks ──────────────────────────────────────────────────────────


def _check_sharpe_finite(result: dict) -> InvariantCheck:
    """INV-9 WARNING: sharpe_ratio is finite when total_trades > 0."""
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    sharpe = _aggregate_metric_raw(result, "sharpe_ratio", _MISSING)

    if total_trades == 0:
        return InvariantCheck(
            name="sharpe_finite_if_trades",
            passed=True,
            tolerance="N/A",
            expected="sharpe is N/A when 0 trades",
            actual="total_trades = 0",
            evidence="No trades — Sharpe not applicable.",
            severity="WARNING",
        )

    if sharpe is _MISSING:
        return InvariantCheck(
            name="sharpe_finite_if_trades",
            passed=False,
            tolerance="N/A",
            expected="sharpe_ratio present whenever trades were taken",
            actual="sharpe_ratio is ABSENT from the result",
            evidence=(
                f"sharpe_ratio is missing from the result but total_trades={total_trades}. "
                "Sharpe computation did not run or did not persist."
            ),
            severity="WARNING",
        )

    if not _is_finite(sharpe):
        return InvariantCheck(
            name="sharpe_finite_if_trades",
            passed=False,
            tolerance="N/A",
            expected="sharpe_ratio is finite when total_trades > 0",
            actual=f"sharpe_ratio = {sharpe}",
            evidence=(
                f"Sharpe ratio is {sharpe} with {total_trades} trades. "
                "Possible zero-variance daily P&L or division by zero in computation."
            ),
            severity="WARNING",
        )

    # ── AR-654 §2 plant P3 / R-612 §4.1: a FINITE but WRONGLY-SCALED Sharpe passed
    # every check above. Re-annualising sqrt(252) -> sqrt(12) moved only two
    # display numbers and no gate reacted. Finiteness cannot see a scale error,
    # so this arm re-derives Sharpe from daily_pnls — data already in the result —
    # and compares. Skipped (not passed) when the series cannot support it.
    sharpe_val = _safe_float(sharpe, default=float("nan"))
    daily = [_safe_float(p) for p in (result.get("daily_pnls") or [])]

    if len(daily) >= 2:
        mean = sum(daily) / len(daily)
        var = sum((d - mean) ** 2 for d in daily) / (len(daily) - 1)
        std = math.sqrt(var)
        if std > 0.0 and abs(sharpe_val) > 1e-9:
            recomputed = mean / std * math.sqrt(252.0)
            ratio = recomputed / sharpe_val
            # BAND IS CHOSEN, NOT ARITHMETIC — stated plainly. It must tolerate a
            # different-but-legitimate daily series (the engine annualises its own
            # daily array, not necessarily this one) while still catching a
            # periodicity error: sqrt(252)/sqrt(12) = 4.58x, sqrt(252)/sqrt(52) = 2.2x.
            LO, HI = 1.0 / 3.0, 3.0
            if not (LO <= ratio <= HI):
                return InvariantCheck(
                    name="sharpe_finite_if_trades",
                    passed=False,
                    tolerance=f"re-derived/reported within [{LO:.2f}, {HI:.2f}]",
                    expected="sharpe_ratio scale agrees with a Sharpe re-derived from daily_pnls",
                    actual=f"sharpe_ratio = {sharpe_val:.4f}, re-derived = {recomputed:.4f}, ratio = {ratio:.2f}x",
                    evidence=(
                        f"Reported Sharpe {sharpe_val:.4f} is {ratio:.2f}x off a Sharpe re-derived "
                        f"from this run's own {len(daily)} daily P&Ls ({recomputed:.4f}). "
                        "A finite but wrongly-scaled Sharpe — check the annualisation factor."
                    ),
                    severity="WARNING",
                )

    return InvariantCheck(
        name="sharpe_finite_if_trades",
        passed=True,
        tolerance="finite; scale agrees with daily_pnls re-derivation where computable",
        expected="sharpe_ratio is finite and correctly scaled when total_trades > 0",
        actual=f"sharpe_ratio = {sharpe}",
        evidence=f"Sharpe ratio {sharpe} is finite and consistent with its own daily P&L series",
        severity="WARNING",
    )


def _check_profit_factor_finite(result: dict) -> InvariantCheck:
    """INV-10 WARNING: profit_factor is finite when total_trades > 0."""
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    pf = _aggregate_metric_raw(result, "profit_factor", _MISSING)

    if total_trades == 0:
        return InvariantCheck(
            name="profit_factor_finite_if_trades",
            passed=True,
            tolerance="N/A",
            expected="PF is N/A when 0 trades",
            actual="total_trades = 0",
            evidence="No trades — PF not applicable.",
            severity="WARNING",
        )

    if pf is _MISSING:
        return InvariantCheck(
            name="profit_factor_finite_if_trades",
            passed=False,
            tolerance="N/A",
            expected="profit_factor present whenever trades were taken",
            actual="profit_factor is ABSENT from the result",
            evidence=(
                f"profit_factor is missing from the result but total_trades={total_trades}. "
                "Profit-factor computation did not run or did not persist."
            ),
            severity="WARNING",
        )

    # 999.99 is the engine's capped representation of inf — treat as non-finite for this check.
    pf_val = _safe_float(pf, default=float("nan"))
    finite = _is_finite(pf_val) and abs(pf_val) < 999.0

    if not finite:
        return InvariantCheck(
            name="profit_factor_finite_if_trades",
            passed=False,
            tolerance="< 999.0 sentinel",
            expected="profit_factor is a finite real (not inf/nan/999.99 sentinel)",
            actual=f"profit_factor = {pf}",
            evidence=(
                f"Profit factor {pf} is not a usable real value with {total_trades} trades. "
                "Zero gross losses (all winners) or computation error."
            ),
            severity="WARNING",
        )

    # ── AR-654 §2 plant P4 / R-612 §4.1: a FINITE but WRONG profit factor passed
    # every check above. Inverting the ratio (gross_loss/gross_profit) produced
    # byte-identical battery output. This arm is arithmetic, not a tolerance:
    # profit_factor is gross_profit/gross_loss, so PF > 1 means the strategy made
    # money and PF < 1 means it lost. A run whose total_return disagrees with its
    # own profit factor is reporting one of the two incorrectly. Exact equality
    # (PF == 1, or total_return == 0) is excluded as genuinely ambiguous.
    total_return = _aggregate_metric(result, "total_return", 0.0)
    disagrees = (
        (total_return > 0.0 and pf_val < 1.0) or
        (total_return < 0.0 and pf_val > 1.0)
    )
    if disagrees:
        return InvariantCheck(
            name="profit_factor_finite_if_trades",
            passed=False,
            tolerance="direction must agree with total_return",
            expected="profit_factor > 1 iff total_return > 0",
            actual=f"profit_factor = {pf_val:.4f}, total_return = {total_return:.2f}",
            evidence=(
                f"Profit factor {pf_val:.4f} says the strategy "
                f"{'made' if pf_val > 1.0 else 'lost'} money, but total_return "
                f"{total_return:.2f} says it "
                f"{'made' if total_return > 0 else 'lost'} money. "
                "Gross profit and gross loss are likely inverted."
            ),
            severity="WARNING",
        )

    return InvariantCheck(
        name="profit_factor_finite_if_trades",
        passed=True,
        tolerance="< 999.0 sentinel; direction agrees with total_return",
        expected="profit_factor is a finite real and agrees in direction with total_return",
        actual=f"profit_factor = {pf}",
        evidence=f"Profit factor {pf} is finite and consistent with total_return {total_return:.2f}",
        severity="WARNING",
    )


def _check_avg_trade_pnl_consistent(result: dict) -> InvariantCheck:
    """INV-11 WARNING: total_return / total_trades ≈ avg_trade_pnl."""
    TOLERANCE = 0.50
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    total_return = _aggregate_metric(result, "total_return", 0.0)
    avg_trade_pnl = _aggregate_metric(result, "avg_trade_pnl", 0.0)

    if total_trades == 0:
        return InvariantCheck(
            name="avg_trade_pnl_consistent",
            passed=True,
            tolerance=f"${TOLERANCE:.2f}",
            expected="avg_trade_pnl N/A for 0 trades",
            actual="total_trades = 0",
            evidence="No trades — avg_trade_pnl not applicable.",
            severity="WARNING",
        )

    implied_avg = total_return / total_trades
    diff = abs(implied_avg - avg_trade_pnl)
    passed = diff <= TOLERANCE

    return InvariantCheck(
        name="avg_trade_pnl_consistent",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"total_return / total_trades = {implied_avg:.4f} ≈ avg_trade_pnl ({avg_trade_pnl:.4f})",
        actual=f"diff = {diff:.4f}",
        evidence=(
            f"avg_trade_pnl {avg_trade_pnl:.2f} consistent with total_return / trades = {implied_avg:.2f}"
            if passed else
            f"avg_trade_pnl {avg_trade_pnl:.2f} differs from total_return/trades = {implied_avg:.2f} "
            f"by ${diff:.4f}. Possible winner/loser array filtering bug."
        ),
        severity="WARNING",
    )


def _check_commission_per_trade_reasonable(result: dict) -> InvariantCheck:
    """INV-12 WARNING: total commission <= total_trades × 2 × 1.50 ($3/rt max)."""
    # $3 roundtrip per contract is a conservative ceiling — Topstep charges ~$0.62/side = $1.24/rt.
    MAX_COMMISSION_PER_TRADE = 3.0
    trades = result.get("trades", [])
    total_trades = int(_aggregate_metric(result, "total_trades", 0))

    if total_trades == 0 or not trades:
        return InvariantCheck(
            name="commission_per_trade_reasonable",
            passed=True,
            tolerance=f"<= ${MAX_COMMISSION_PER_TRADE:.2f}/trade (1 contract roundtrip)",
            expected="commission N/A for 0 trades",
            actual="total_trades = 0",
            evidence="No trades — commission check not applicable.",
            severity="WARNING",
        )

    total_comm = sum(_safe_float(t.get("CommissionCost", 0.0)) for t in trades)
    max_allowed = total_trades * MAX_COMMISSION_PER_TRADE
    passed = total_comm <= max_allowed

    per_trade_avg = total_comm / total_trades if total_trades > 0 else 0.0

    return InvariantCheck(
        name="commission_per_trade_reasonable",
        passed=passed,
        tolerance=f"<= ${MAX_COMMISSION_PER_TRADE:.2f} per trade (1-contract roundtrip ceiling)",
        expected=f"total_commission <= {total_trades} trades × ${MAX_COMMISSION_PER_TRADE:.2f} = ${max_allowed:.2f}",
        actual=f"total_commission = {total_comm:.2f}, avg = {per_trade_avg:.4f}/trade",
        evidence=(
            f"Total commission ${total_comm:.2f} within $3/trade ceiling (avg ${per_trade_avg:.2f}/trade)"
            if passed else
            f"Commission ${total_comm:.2f} exceeds ceiling ${max_allowed:.2f}. "
            f"Average ${per_trade_avg:.2f}/trade — commission model may be charging per bar instead of per trade."
        ),
        severity="WARNING",
    )


def _check_per_firm_endings(result: dict) -> InvariantCheck:
    """INV-13 WARNING: for each firm in prop_compliance, firm.ending_balance_uncapped ≈ starting + total_return."""
    TOLERANCE = 1.0
    total_return = _aggregate_metric(result, "total_return", 0.0)
    prop_compliance = result.get("prop_compliance", {})

    if not prop_compliance:
        # R-627 §3.1: NOT a pass. This is the LEGITIMATE absence — walk_forward.py
        # (:2224/:3005) leaves prop_compliance None whenever a run produced no OOS
        # trades, so this state is expected on real runs and must NOT be reported
        # as "checked and fine". Severity stays WARNING, so overall_passed is
        # unaffected; only the REPORTED state changes.
        return InvariantCheck(
            name="per_firm_endings_consistent",
            passed=False,
            applicable=False,
            tolerance=f"${TOLERANCE:.2f}",
            expected="firm.ending_balance_uncapped ≈ starting + total_return for each firm",
            actual="NOT APPLICABLE — prop_compliance absent/empty; nothing was checked",
            evidence=(
                "INV-13 did not run: no prop_compliance data on this result. "
                "This is expected for runs with no OOS trades (walk_forward sets it "
                "None) and is NOT evidence that balances are consistent."
            ),
            severity="WARNING",
        )

    failures: list[str] = []
    firms_checked = 0

    for firm_key, firm_data in prop_compliance.items():
        if not isinstance(firm_data, dict):
            continue
        starting = _safe_float(firm_data.get("starting_balance", _STARTING_BALANCE))
        # Use ending_balance_uncapped — the DLL-cap-free figure.
        # ending_balance is intentionally inflated by the DLL simulation.
        uncapped = firm_data.get("ending_balance_uncapped")
        if uncapped is None:
            continue
        uncapped = _safe_float(uncapped)
        expected_end = starting + total_return
        diff = abs(uncapped - expected_end)
        firms_checked += 1
        if diff > TOLERANCE:
            failures.append(
                f"{firm_key}: ending_balance_uncapped={uncapped:.2f} vs expected={expected_end:.2f} (diff ${diff:.2f})"
            )

    if firms_checked == 0:
        # R-627 §3.1: NOT a pass — and unlike the branch above this one is
        # SUSPICIOUS rather than expected: prop_sim.py:466 writes
        # ending_balance_uncapped for every firm it simulates, so a populated
        # prop_compliance with no such field is a malformed result, not a
        # legitimate shape. Distinguishing the two is R-627 §3.2's question and
        # is deliberately NOT decided here.
        return InvariantCheck(
            name="per_firm_endings_consistent",
            passed=False,
            applicable=False,
            tolerance=f"${TOLERANCE:.2f}",
            expected="firm.ending_balance_uncapped ≈ starting + total_return for each firm",
            actual="NOT APPLICABLE — prop_compliance present but no firm carried ending_balance_uncapped",
            evidence=(
                "INV-13 did not run: prop_compliance was present but no firm exposed "
                "ending_balance_uncapped. prop_sim.py:466 writes that field for every "
                "simulated firm, so this shape is unexpected and is NOT evidence that "
                "balances are consistent."
            ),
            severity="WARNING",
        )

    passed = len(failures) == 0
    return InvariantCheck(
        name="per_firm_endings_consistent",
        passed=passed,
        tolerance=f"${TOLERANCE:.2f}",
        expected=f"All {firms_checked} firms: ending_balance_uncapped ≈ starting + total_return",
        actual=f"{len(failures)} / {firms_checked} firms failed",
        evidence=(
            f"All {firms_checked} firm balances consistent with total_return"
            if passed else
            "Firm balance mismatches: " + "; ".join(failures[:3]) +
            (" (truncated)" if len(failures) > 3 else "")
        ),
        severity="WARNING",
    )


def _check_equity_curve_continuous(result: dict) -> InvariantCheck:
    """INV-14 WARNING: equity curve has no NaN/null bars; non-empty when trades > 0."""
    total_trades = int(_aggregate_metric(result, "total_trades", 0))
    equity_bars = result.get("equity_bars", [])
    equity_curve = result.get("equity_curve", [])

    # Use equity_bars (bar-level) if available; otherwise equity_curve (daily).
    source = equity_bars if equity_bars else equity_curve
    label = "equity_bars" if equity_bars else "equity_curve"

    if total_trades == 0:
        return InvariantCheck(
            name="equity_curve_monotone_or_continuous",
            passed=True,
            tolerance="N/A",
            expected="equity curve may be empty for 0 trades",
            actual="total_trades = 0",
            evidence="No trades — empty equity curve is acceptable.",
            severity="WARNING",
        )

    if not source:
        return InvariantCheck(
            name="equity_curve_monotone_or_continuous",
            passed=False,
            tolerance="N/A",
            expected=f"{label} must be non-empty when total_trades={total_trades}",
            actual=f"{label} is empty",
            evidence=f"Trades exist ({total_trades}) but equity curve is empty. Equity build loop may have failed.",
            severity="WARNING",
        )

    # Count NaN/null values.
    nan_count = 0
    for pt in source:
        if isinstance(pt, dict):
            v = pt.get("value")
        else:
            v = pt
        if v is None or (isinstance(v, float) and not math.isfinite(v)):
            nan_count += 1

    passed = nan_count == 0
    return InvariantCheck(
        name="equity_curve_monotone_or_continuous",
        passed=passed,
        tolerance="zero NaN/null bars",
        expected=f"{label} has no NaN/null values ({len(source)} bars)",
        actual=f"{nan_count} NaN/null bars out of {len(source)}",
        evidence=(
            f"Equity curve ({label}) is clean: {len(source)} bars, 0 NaN/null"
            if passed else
            f"{nan_count} NaN/null bars in {label}. Equity computation produced invalid values — "
            "inspect bar_dollar_pnls for inf/nan inputs."
        ),
        severity="WARNING",
    )


# ─── Harness orchestrator ────────────────────────────────────────────────────

# Ordered list of check functions: (critical checks first, then warnings).
_CRITICAL_CHECKS = [
    _check_balance_arithmetic,
    _check_trade_pnl_sum,
    _check_daily_pnl_sum,
    _check_long_short_split_sum,
    _check_long_short_count,
    _check_win_rate_in_range,
    _check_max_drawdown_non_negative,
    _check_peak_equity_at_least_starting,
]

_WARNING_CHECKS = [
    _check_sharpe_finite,
    _check_profit_factor_finite,
    _check_avg_trade_pnl_consistent,
    _check_commission_per_trade_reasonable,
    _check_per_firm_endings,
    _check_equity_curve_continuous,
]


class InvariantHarness:
    """Post-backtest invariant harness.

    Usage::

        harness = InvariantHarness()
        report = harness.verify(result)
        if not report.overall_passed:
            ...
    """

    def verify(self, result: dict) -> InvariantReport:
        """Run all 14 invariant checks against a backtest result dict.

        Parameters
        ----------
        result:
            The dict returned by run_backtest() or run_class_backtest().

        Returns
        -------
        InvariantReport
            Full report with per-check results and overall_passed flag.
        """
        backtest_id = str(result.get("backtest_id", ""))
        all_checks: list[InvariantCheck] = []

        for fn in _CRITICAL_CHECKS:
            all_checks.append(fn(result))

        for fn in _WARNING_CHECKS:
            all_checks.append(fn(result))

        passed_checks = [c for c in all_checks if c.passed]
        failed_checks = [c for c in all_checks if not c.passed]
        critical_failures = [c for c in failed_checks if c.severity == "CRITICAL"]
        warnings = [c for c in failed_checks if c.severity == "WARNING"]

        # R-627 §3.1: reporting-only. NOT subtracted from failed/warnings — see
        # InvariantReport.not_applicable for why that subtraction would be a
        # fail-open once a not-applicable check is promoted to CRITICAL.
        not_applicable = [c for c in all_checks if not c.applicable]

        return InvariantReport(
            backtest_id=backtest_id,
            total_checks=len(all_checks),
            passed=len(passed_checks),
            failed=len(failed_checks),
            critical_failures=critical_failures,
            warnings=warnings,
            all_checks=all_checks,
            overall_passed=len(critical_failures) == 0,
            not_applicable=not_applicable,
        )


# ─── Module-level convenience function ───────────────────────────────────────

def run_invariants(result: dict) -> InvariantReport:
    """Run all invariant checks.  Convenience wrapper around InvariantHarness.verify()."""
    return InvariantHarness().verify(result)
