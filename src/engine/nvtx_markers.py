"""NVTX annotation helpers for GPU profiling with Nsight Systems.

Usage:
    from src.engine.nvtx_markers import annotate, range_push, range_pop

    @annotate("forge/my_function")
    def my_function():
        ...

    range_push("forge/custom_block")
    # ... work ...
    range_pop()

Profile from WSL2:
    nsys profile --trace=cuda,nvtx,osrt --output=forge_profile \
      python -m src.engine.backtester --backtest-id <uuid> --mode walkforward
"""

from __future__ import annotations

import functools
from typing import Callable, TypeVar

F = TypeVar("F", bound=Callable)

try:
    import nvtx as _nvtx

    NVTX_AVAILABLE = True
except ImportError:
    _nvtx = None  # type: ignore[assignment]
    NVTX_AVAILABLE = False


def annotate(name: str) -> Callable[[F], F]:
    """Decorator: wraps function in an NVTX range. No-op if nvtx unavailable."""
    if NVTX_AVAILABLE:
        return _nvtx.annotate(name)  # type: ignore[return-value]

    def _passthrough(fn: F) -> F:
        return fn

    return _passthrough  # type: ignore[return-value]


def range_push(name: str) -> None:
    """Push an NVTX range onto the stack. No-op if nvtx unavailable."""
    if NVTX_AVAILABLE:
        _nvtx.push_range(name)


def range_pop() -> None:
    """Pop the current NVTX range. No-op if nvtx unavailable."""
    if NVTX_AVAILABLE:
        _nvtx.pop_range()


def timed_range(name: str):
    """Context manager for NVTX range. No-op if nvtx unavailable.

    Usage:
        with timed_range("forge/mc_resample"):
            paths = trade_resample(...)
    """
    if NVTX_AVAILABLE:
        return _nvtx.annotate(name)

    class _NoOp:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    return _NoOp()
