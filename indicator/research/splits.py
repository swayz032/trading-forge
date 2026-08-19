"""Chronological split utilities for edge research.

These helpers intentionally operate on trading-day identifiers so random row-level splitting
cannot leak adjacent intraday observations across train/test boundaries.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Tuple


@dataclass(frozen=True)
class DaySplit:
    train: Tuple[str, ...]
    validation: Tuple[str, ...]
    holdout: Tuple[str, ...]


@dataclass(frozen=True)
class WalkForwardFold:
    fold_id: int
    train: Tuple[str, ...]
    test: Tuple[str, ...]
    embargo: Tuple[str, ...]


def _clean_days(days: Iterable[str]) -> Tuple[str, ...]:
    ordered = tuple(days)
    if not ordered:
        raise ValueError("at least one trading day required")
    if any(not isinstance(d, str) or not d for d in ordered):
        raise ValueError("trading days must be nonempty strings")
    if tuple(sorted(ordered)) != ordered:
        raise ValueError("trading days must be chronological/sorted")
    if len(set(ordered)) != len(ordered):
        raise ValueError("duplicate trading day")
    return ordered


def fixed_chronological_split(
    days: Iterable[str],
    *,
    train_days: int,
    validation_days: int,
    holdout_days: int,
) -> DaySplit:
    ordered = _clean_days(days)
    for name, n in (("train_days", train_days), ("validation_days", validation_days), ("holdout_days", holdout_days)):
        if n <= 0:
            raise ValueError(f"{name} must be > 0")
    if train_days + validation_days + holdout_days != len(ordered):
        raise ValueError("split counts must consume dataset exactly")
    a = train_days
    b = a + validation_days
    return DaySplit(ordered[:a], ordered[a:b], ordered[b:])


def rolling_walk_forward(
    days: Iterable[str],
    *,
    train_window_days: int,
    test_window_days: int,
    step_days: int,
    embargo_days: int = 0,
) -> Tuple[WalkForwardFold, ...]:
    ordered = _clean_days(days)
    for name, n in (("train_window_days", train_window_days), ("test_window_days", test_window_days), ("step_days", step_days)):
        if n <= 0:
            raise ValueError(f"{name} must be > 0")
    if embargo_days < 0:
        raise ValueError("embargo_days must be >= 0")

    folds = []
    start = 0
    fold_id = 0
    while True:
        train_end = start + train_window_days
        embargo_end = train_end + embargo_days
        test_end = embargo_end + test_window_days
        if test_end > len(ordered):
            break
        folds.append(
            WalkForwardFold(
                fold_id=fold_id,
                train=ordered[start:train_end],
                embargo=ordered[train_end:embargo_end],
                test=ordered[embargo_end:test_end],
            )
        )
        fold_id += 1
        start += step_days

    if not folds:
        raise ValueError("insufficient days for one walk-forward fold")
    return tuple(folds)
