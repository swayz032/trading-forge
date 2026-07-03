"""Slippage-Survival Gate — engine producer (Wave A).

Design spec: docs/superpowers/specs/2026-07-03-slippage-survival-gate-design.md

Proves a strategy's edge survives elevated slippage before it reaches live
capital. Method = FIXED-SIGNAL RE-PRICE (cost-sensitivity analysis holding
signals fixed — standard institutional technique):

    net_pnl_M[trade] = gross_pnl[trade] - commission[trade] - roll[trade]
                       - M * slippage_dollars[trade]

for each stress multiple M in `multiples` (default 1x / 2x / 3x). ONLY
slippage is scaled by M — commission and roll-spread cost are held FIXED at
their actual realized values, matching the backtester's real per-trade
friction split (`net_pnl = gross - slip - comm - roll`, see
backtester.py's trade-construction loops). This means at M=1.0 the sweep's
net series is BYTE-IDENTICAL to the trade's actual realized net P&L
(`trade["PnL"]`) — a REQUIRED invariant (review-pass fix, 2026-07-03):
the prior v1 formula (`gross - M*slippage`, omitting commission/roll
entirely) inflated the 1x baseline relative to the strategy's TRUE realized
net, letting a fee-heavy net-loser show "alive at 1x" and grandfather past
the gate. Holding non-slippage frictions fixed and stressing ONLY the
slippage term isolates exactly the variable the gate is named for.

PF and expectancy (in R-multiples) are recomputed on each stressed net-P&L
series, holding the ORIGINAL trades/signals fixed — this isolates the
slippage variable precisely but does NOT model the 2nd-order effect where
higher slippage could trip a stop (documented v1 limitation; full re-run is
the v2 upgrade, rejected for v1 due to 2x compute cost + signal/slippage
conflation).

Pure-functional contract:
  - No I/O, no DB access, no `datetime.now()`-equivalent, no randomness.
  - Caller (src/engine/backtester.py) passes every input explicitly and is
    responsible for adding any wall-clock `computed_at` stamp AFTER calling
    this module — keeping this module itself trivially deterministic
    (same input -> byte-identical output), which is required for the
    replay-determinism contract every backtest-core module must uphold.

R-unit design decision (not fully pinned by the design spec — documented
here for the adversarial review pass):
  The design spec enumerates the helper's inputs as per-trade gross P&L +
  per-trade slippage-dollars + multiples + config (min_pf, min_trades) —
  it does NOT pass a per-trade risk/stop-distance array. Absent that, this
  module derives a single "1R" dollar unit from the trade data itself:
  the mean ABSOLUTE loss magnitude across the UNSTRESSED (1.0x) net-P&L
  series. This mirrors the codebase's existing `avg_trade_risk` R-multiple
  convention in `performance_gate.py` (mean dollar risk per trade) but is
  self-contained — it needs no external stop-distance/ATR wiring, at the
  cost of being a proxy (avg loss) rather than the true initial risk.
  The R-unit is computed ONCE at 1.0x and held constant across the sweep
  so `retention_2x` compares like-for-like scale. When there are no losing
  trades at 1.0x, the R-unit falls back to the mean absolute P&L across all
  trades; when every trade is exactly break-even, R-unit is undefined and
  expectancy_r is reported as 0.0 for every multiple (documented fallback,
  not a fabricated value).

JSON-safety note: this module NEVER emits `inf`/`nan` — Python's
`json.dumps` will happily emit a bare `Infinity` token for `float("inf")`
(as the pre-existing top-level `profit_factor` field in backtester.py
does), but that is not valid JSON and can break strict JS `JSON.parse` on
the TS gate side. Where profit factor is undefined because there are no
losing trades, this module returns the finite sentinel `_PF_SENTINEL_NO_LOSSES`
instead (mirrors the fail-closed-sentinel philosophy already used in
`backtest_inflation_factor.py`).
"""

from __future__ import annotations

from collections.abc import Sequence
from statistics import fmean

__all__ = ["compute_slippage_survival"]

# ── Module constants ──────────────────────────────────────────────────────

SCHEMA_VERSION: int = 1

_DEFAULT_MULTIPLES: tuple[float, ...] = (1.0, 2.0, 3.0)
_DEFAULT_MIN_PF: float = 1.0
_DEFAULT_MIN_TRADES: int = 20

# Finite stand-in for "infinite" profit factor (no losing trades at this
# multiple). Large enough to always clear any realistic min_pf threshold,
# small enough to stay unambiguously a sentinel rather than a real PF.
_PF_SENTINEL_NO_LOSSES: float = 99.0


def _format_multiple_key(multiple: float) -> str:
    """Format a stress multiple as the JSONB dict key, e.g. 1.0 -> "1x", 1.5 -> "1.5x"."""
    if float(multiple).is_integer():
        return f"{int(multiple)}x"
    # Trim to the shortest unambiguous representation (e.g. 1.50 -> "1.5").
    return f"{multiple:g}x"


def _derive_r_unit(net_pnl_1x: list[float]) -> float | None:
    """Derive the 1R dollar unit from the unstressed (1.0x) net-P&L series.

    Primary definition: mean absolute value of LOSING trades at 1.0x.
    Fallback (no losers): mean absolute value of ALL trades at 1.0x.
    Degenerate (every trade exactly 0.0): returns None — caller must treat
    expectancy_r as 0.0 in that case rather than dividing by zero.
    """
    losers = [abs(p) for p in net_pnl_1x if p < 0]
    if losers:
        return fmean(losers)
    nonzero = [abs(p) for p in net_pnl_1x if p != 0]
    if nonzero:
        return fmean(nonzero)
    return None


def _empty_result(
    multiples_list: list[float],
    min_trades: int,
) -> dict:
    """Degenerate zero-trades result — every metric is undefined (None)."""
    pf = {_format_multiple_key(m): None for m in multiples_list}
    expectancy_r = {_format_multiple_key(m): None for m in multiples_list}
    return {
        "schema_version": SCHEMA_VERSION,
        "multiples": multiples_list,
        "pf": pf,
        "expectancy_r": expectancy_r,
        "breaks_at": None,
        "retention_2x": None,
        "n_trades": 0,
        "insufficient_sample": 0 < min_trades,
    }


def compute_slippage_survival(
    gross_pnls: Sequence[float],
    slippage_dollars: Sequence[float],
    commission_dollars: Sequence[float],
    roll_dollars: Sequence[float],
    multiples: Sequence[float] = _DEFAULT_MULTIPLES,
    min_pf: float = _DEFAULT_MIN_PF,
    min_trades: int = _DEFAULT_MIN_TRADES,
) -> dict:
    """Compute the Slippage-Survival sweep for a fixed set of realized trades.

    Args:
        gross_pnls: per-trade gross P&L in dollars (pre-friction — the same
            "GrossPnL" value backtester.py already computes per trade:
            `(exit - entry) * size * point_value`, direction-adjusted).
        slippage_dollars: per-trade dollar slippage cost the backtester
            already deducts per fill — the same "SlippageCost" value
            (`(entry_slip + exit_slip) * size`). THIS is the only friction
            scaled by the stress multiple M.
        commission_dollars: per-trade dollar commission cost (the same
            "CommissionCost" value). Held FIXED at its real value at every
            multiple — never scaled by M (review-pass fix, 2026-07-03: the
            v1 formula omitted this entirely, inflating the 1x baseline).
        roll_dollars: per-trade dollar roll-spread cost (the same
            "RollSpreadCost" value, 0.0 on non-roll-day trades). Held FIXED
            at every multiple, same rationale as `commission_dollars`.
            All four arrays must be the SAME length and SAME trade order.
        multiples: stress multiples to sweep, e.g. (1.0, 2.0, 3.0). Order
            matters for `breaks_at` (assumed ascending; the function does
            not sort — callers must pass an ascending sequence).
        min_pf: survival PF floor. Edge "alive" at multiple M requires
            `pf[Mx] >= min_pf`, evaluated on the RAW (unrounded) PF value —
            not the 4dp-rounded display value (review-pass fix, 2026-07-03:
            a raw PF of 0.99996 previously rounded to 1.0 and incorrectly
            counted as alive at the default min_pf=1.0 boundary).
        min_trades: sample-size guard. When `n_trades < min_trades`,
            `breaks_at` is forced to `None` and `insufficient_sample=True`
            regardless of the underlying math, so a promotion gate can
            PASS-with-warn rather than block on statistical noise.

    Returns:
        dict matching the exact `backtests.slippage_survival` JSONB
        contract (see design spec):
            schema_version, multiples, pf, expectancy_r, breaks_at,
            retention_2x, n_trades, insufficient_sample.
        Does NOT include `computed_at` — the caller stamps that
        additively (this module has no clock access by design).
        `pf` / `expectancy_r` values are rounded to 4dp for display; the
        `breaks_at` decision is computed on the RAW unrounded values (see
        `min_pf` docstring above).

    Raises:
        ValueError: `gross_pnls` / `slippage_dollars` / `commission_dollars`
            / `roll_dollars` differ in length, or `multiples` is empty.
    """
    if not (len(gross_pnls) == len(slippage_dollars) == len(commission_dollars) == len(roll_dollars)):
        raise ValueError(
            f"gross_pnls (len={len(gross_pnls)}), slippage_dollars "
            f"(len={len(slippage_dollars)}), commission_dollars "
            f"(len={len(commission_dollars)}), and roll_dollars "
            f"(len={len(roll_dollars)}) must all be the same length — "
            "one entry per trade, same trade order."
        )

    multiples_list = [float(m) for m in multiples]
    if not multiples_list:
        raise ValueError("multiples must be a non-empty sequence")

    n_trades = len(gross_pnls)

    if n_trades == 0:
        return _empty_result(multiples_list, min_trades)

    gross_arr = [float(g) for g in gross_pnls]
    slip_arr = [float(s) for s in slippage_dollars]
    comm_arr = [float(c) for c in commission_dollars]
    roll_arr = [float(r) for r in roll_dollars]
    # Non-slippage friction held FIXED at every multiple — only slippage
    # is stressed. At M=1.0 this makes net_pnl_m[i] == gross - comm - roll -
    # slip, i.e. byte-identical to the trade's actual realized net P&L.
    fixed_friction = [c + r for c, r in zip(comm_arr, roll_arr, strict=True)]

    # R-unit derived ONCE from the unstressed (1.0x) series — held constant
    # across the whole sweep so retention_2x compares like-for-like scale.
    net_pnl_1x = [g - f - 1.0 * s for g, f, s in zip(gross_arr, fixed_friction, slip_arr, strict=True)]
    r_unit = _derive_r_unit(net_pnl_1x)

    # RAW (unrounded) pf/expectancy — used for the breaks_at alive-check so
    # a boundary value like pf=0.99996 is never misclassified as alive by
    # the 4dp display rounding. `pf`/`expectancy_r` (rounded) are the
    # display/JSONB-contract values; `_raw` dicts never leave this function.
    pf_raw: dict[str, float] = {}
    expectancy_r_raw: dict[str, float] = {}
    pf: dict[str, float] = {}
    expectancy_r: dict[str, float] = {}

    for m in multiples_list:
        key = _format_multiple_key(m)
        net_pnl_m = [g - f - m * s for g, f, s in zip(gross_arr, fixed_friction, slip_arr, strict=True)]

        gross_profit = sum(p for p in net_pnl_m if p > 0)
        gross_loss = abs(sum(p for p in net_pnl_m if p < 0))

        if gross_loss > 0:
            pf_m = gross_profit / gross_loss
        elif gross_profit > 0:
            # No losing trades under this stress level — PF is unboundedly
            # good. Use the finite sentinel, never `float("inf")` (JSON safety).
            pf_m = _PF_SENTINEL_NO_LOSSES
        else:
            # No winners AND no losers (every trade exactly break-even).
            pf_m = 0.0

        mean_pnl_m = fmean(net_pnl_m)
        expectancy_r_m = (mean_pnl_m / r_unit) if r_unit else 0.0

        pf_raw[key] = pf_m
        expectancy_r_raw[key] = expectancy_r_m
        pf[key] = round(pf_m, 4)
        expectancy_r[key] = round(expectancy_r_m, 4)

    # breaks_at = smallest M (in the order given) where the edge is not
    # alive: pf[Mx] < min_pf OR expectancy_r[Mx] <= 0. None if it survives
    # every multiple in the sweep. Decided on RAW values (see docstring).
    breaks_at: float | None = None
    for m in multiples_list:
        key = _format_multiple_key(m)
        alive = pf_raw[key] >= min_pf and expectancy_r_raw[key] > 0
        if not alive:
            breaks_at = m
            break

    # retention_2x = expectancy_r_raw.2x / expectancy_r_raw.1x — fragility
    # telemetry. Only computable when both 1.0x and 2.0x are present in the sweep.
    #
    # Two review-pass fixes (2026-07-03):
    #   1. RAW not rounded — uses `expectancy_r_raw` (the same unrounded values
    #      `breaks_at` decides on above), not the 4dp-rounded `expectancy_r`
    #      display dict. A tiny positive raw expectancy that rounds to 0.0000
    #      at display precision must not be treated as zero here (same
    #      raw-vs-rounded rationale as the min_pf boundary fix documented in
    #      the module docstring / min_pf param doc).
    #   2. Sign guard — retention_2x is only meaningful as a "how much of the
    #      edge survived" ratio when there WAS an edge (positive expectancy) at
    #      1x. A non-positive e1x_raw means the strategy is already dead (or
    #      exactly break-even) at baseline slippage; e2x/e1x on two negative
    #      numbers can produce a misleadingly POSITIVE ratio (e.g. e1x=-0.10,
    #      e2x=-0.05 -> 0.5, reading as "retained 50% of edge" when there was no
    #      edge to retain). Report None instead of fabricating a ratio with no
    #      coherent slippage-fragility meaning. Does NOT change the `breaks_at`
    #      block decision above, which is independently computed on raw values.
    retention_2x: float | None = None
    if 1.0 in multiples_list and 2.0 in multiples_list:
        e1x_raw = expectancy_r_raw[_format_multiple_key(1.0)]
        e2x_raw = expectancy_r_raw[_format_multiple_key(2.0)]
        if e1x_raw > 0:
            retention_2x = round(e2x_raw / e1x_raw, 4)

    insufficient_sample = n_trades < min_trades
    if insufficient_sample:
        # Gate should PASS-with-warn on noise, not act on a breaks_at
        # computed from too few trades — force null regardless of the
        # underlying math (which is still reported above for visibility).
        breaks_at = None

    return {
        "schema_version": SCHEMA_VERSION,
        "multiples": multiples_list,
        "pf": pf,
        "expectancy_r": expectancy_r,
        "breaks_at": breaks_at,
        "retention_2x": retention_2x,
        "n_trades": n_trades,
        "insufficient_sample": insufficient_sample,
    }
