"""THE one definition of "was this position ever closed?" — F-3 / AR-1101 §4.

This module exists for a specific reason. The realized-metric defect F-3 repaired was able
to exist in FOUR places at once (`win_rate` and `win_rate_per_trade`, in each of
`run_backtest` and `run_class_backtest`) because the formula was copied instead of shared.
Repairing it by copying a new predicate four times would have rebuilt the same trap.

It lives in its own module rather than in `backtester` because `cross_validation` — which
INDEPENDENTLY recomputes win rate and profit factor to verify the engine's own numbers —
must use the identical predicate, and `backtester` already imports `cross_validation`.
Importing the other way would close a cycle.

★ `A VERIFIER THAT DEFINES THE POPULATION DIFFERENTLY FROM THE THING IT VERIFIES IS NOT A
   CHECK — IT IS A SECOND OPINION FROM A DIFFERENT QUESTION.`
"""

from __future__ import annotations


def is_open_at_frame_end(trade: dict) -> bool:
    """True when NO exit authority ever closed this position inside the measurement frame.

    A trade is OPEN only when BOTH hold:

      * vectorbt never closed it       -> ``Status == "Open"``, and
      * no exit layer ever closed it   -> ``exit_reason == "signal"``

    ``"signal"`` is the INITIAL value of ``exit_reason`` in the managed pass
    (``backtester.py:1918``) and is overwritten the moment a stop, trailing stop, target,
    time stop or source-owned exit fires. The pair therefore means "no authority produced
    an exit".

    🛑 EITHER LEG ALONE IS WRONG, AND ONE OF THEM IS DANGEROUS. ``Status`` alone would
    classify as OPEN a legacy trade that vectorbt left open but the MANAGED STOP DID CLOSE
    — silently deleting real realized losses from the denominator and inflating every
    legacy win rate. That would be a worse defect than the one being repaired. The
    conjunction can only exclude a trade that genuinely has no exit event.
    """
    return (
        str(trade.get("Status", "")) == "Open"
        and str(trade.get("exit_reason", "")) == "signal"
    )


def split_closed_open(trades: list[dict]) -> tuple[list[dict], list[dict]]:
    """Partition trade records into (closed, open) by :func:`is_open_at_frame_end`."""
    closed = [t for t in trades if not is_open_at_frame_end(t)]
    open_ = [t for t in trades if is_open_at_frame_end(t)]
    return closed, open_
