"""Signal generation — expression evaluator for strategy entry/exit rules.

Supports: AND, OR, NOT, comparisons (<, >, <=, >=, ==),
crosses_above, crosses_below, numeric literals.
"""

from __future__ import annotations

import re
from typing import Optional

import polars as pl

from src.engine.config import StrategyConfig


def _resolve_operand(df: pl.DataFrame, token: str) -> pl.Series:
    """Resolve a token to a Polars Series — either a column name or numeric literal."""
    # Try numeric literal first
    try:
        val = float(token)
        return pl.Series("literal", [val] * len(df))
    except ValueError:
        pass

    if token in df.columns:
        return df[token]

    raise ValueError(
        f"Unknown column '{token}'. Available: {sorted(df.columns)}"
    )


def _crosses_above(a: pl.Series, b: pl.Series) -> pl.Series:
    """True where a crosses above b: (a > b) & (a.shift(1) <= b.shift(1))."""
    current = a > b
    previous = a.shift(1) <= b.shift(1)
    result = current & previous
    # First bar can't cross
    return result.fill_null(False)


def _crosses_below(a: pl.Series, b: pl.Series) -> pl.Series:
    """True where a crosses below b: (a < b) & (a.shift(1) >= b.shift(1))."""
    current = a < b
    previous = a.shift(1) >= b.shift(1)
    result = current & previous
    return result.fill_null(False)


_COMPARISON_OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a > b,
    "<":  lambda a, b: a < b,
    "==": lambda a, b: a == b,
}


def _eval_simple_expr(df: pl.DataFrame, expr: str) -> pl.Series:
    """Evaluate a single comparison expression (no AND/OR/NOT)."""
    expr = expr.strip()

    # Check for crosses_above / crosses_below
    if "crosses_above" in expr:
        parts = expr.split("crosses_above")
        a = _resolve_operand(df, parts[0].strip())
        b = _resolve_operand(df, parts[1].strip())
        return _crosses_above(a, b)

    if "crosses_below" in expr:
        parts = expr.split("crosses_below")
        a = _resolve_operand(df, parts[0].strip())
        b = _resolve_operand(df, parts[1].strip())
        return _crosses_below(a, b)

    # Standard comparisons — try longest operators first
    for op_str, op_fn in _COMPARISON_OPS.items():
        if op_str in expr:
            parts = expr.split(op_str, 1)
            a = _resolve_operand(df, parts[0].strip())
            b = _resolve_operand(df, parts[1].strip())
            result = op_fn(a, b)
            return result.fill_null(False)

    raise ValueError(f"Cannot parse expression: '{expr}'")


def evaluate_expression(df: pl.DataFrame, expression: str) -> pl.Series:
    """Evaluate a boolean expression against DataFrame columns.

    Supports: AND, OR, NOT, comparisons, crosses_above, crosses_below.
    """
    expression = expression.strip()

    # Handle NOT
    if expression.startswith("NOT "):
        inner = expression[4:]
        return ~evaluate_expression(df, inner)

    # Split on AND/OR (respecting precedence: AND binds tighter)
    # Process OR first (lower precedence)
    or_parts = re.split(r'\s+OR\s+', expression)
    if len(or_parts) > 1:
        result = evaluate_expression(df, or_parts[0])
        for part in or_parts[1:]:
            result = result | evaluate_expression(df, part)
        return result

    # Then AND
    and_parts = re.split(r'\s+AND\s+', expression)
    if len(and_parts) > 1:
        result = evaluate_expression(df, and_parts[0])
        for part in and_parts[1:]:
            result = result & evaluate_expression(df, part)
        return result

    # Base case: simple comparison
    return _eval_simple_expr(df, expression)


def generate_signals(
    df: pl.DataFrame,
    config: StrategyConfig,
    fill_rate: float = 1.0,
    fill_rate_seed: int | None = None,
    event_mask: "np.ndarray | None" = None,
) -> pl.DataFrame:
    """Generate entry/exit boolean signal columns from strategy config.

    Args:
        df: DataFrame with indicator columns
        config: Strategy configuration
        fill_rate: Fraction of entry signals to keep (0.0-1.0). Used for
            crisis stress testing to simulate partial fills.
        fill_rate_seed: Random seed for fill rate masking (reproducibility)
        event_mask: Optional boolean numpy array from economic calendar.
            When provided, True values block entry signals (SIT_OUT).

    Returns DataFrame with added columns:
        entry_long, entry_short, exit_long, exit_short
    """
    import numpy as np

    entry_long = evaluate_expression(df, config.entry_long)
    entry_short = evaluate_expression(df, config.entry_short)
    exit_expr = evaluate_expression(df, config.exit)

    # Apply economic event mask (SIT_OUT blocks entries)
    if event_mask is not None:
        block = pl.Series("event_block", ~event_mask.astype(bool))
        entry_long = entry_long & block
        entry_short = entry_short & block

    # Apply fill rate mask to entry signals (crisis stress simulation)
    if fill_rate < 1.0:
        rng = np.random.default_rng(fill_rate_seed)
        n = len(df)
        mask_long = pl.Series("mask", rng.random(n) < fill_rate)
        mask_short = pl.Series("mask", rng.random(n) < fill_rate)
        entry_long = entry_long & mask_long
        entry_short = entry_short & mask_short

    return df.with_columns([
        entry_long.alias("entry_long"),
        entry_short.alias("entry_short"),
        exit_expr.alias("exit_long"),
        exit_expr.alias("exit_short"),
    ])
