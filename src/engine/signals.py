"""Signal generation -- expression evaluator for strategy entry/exit rules.

Supports: AND, OR, NOT, comparisons (<, >, <=, >=, ==),
crosses_above, crosses_below, numeric literals.

F-4 fix (2026-05-20): Chained comparisons (a > b > c) now raise ValueError.
F-5 fix (2026-05-20): AND/OR splitting is paren-depth-aware (_split_at_depth0).
"""

from __future__ import annotations

import re
from typing import Optional

import polars as pl

from src.engine.config import StrategyConfig

# Token-aware regex: longest operators first.
_CMP_PATTERN = re.compile(r'\s*(>=|<=|==|!=|>|<)\s*')

# Token-aware comparison operator regex: matches operator with surrounding context.
# Longest operators listed first (>= before >, <= before <).
_CMP_PATTERN = re.compile(r'\s*(>=|<=|==|!=|>|<)\s*')


def _resolve_operand(df: pl.DataFrame, token: str) -> pl.Series:
    """Resolve a token to a Polars Series -- either a column name or numeric literal."""
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
    # Float tolerance: exact == fails for e.g. 5000.4999999999 vs 5000.50
    "==": lambda a, b: (a - b).abs() < 1e-9,
}


def _count_cmp_operators_at_depth0(expr: str) -> int:
    """Count comparison operators at paren-depth-0 in expr.

    F-4 helper: detects chained comparisons like 'a > b > c'.
    crosses_above / crosses_below are NOT comparison operators for this purpose.
    """
    depth = 0
    count = 0
    i = 0
    while i < len(expr):
        ch = expr[i]
        if ch == "(":
            depth += 1
            i += 1
        elif ch == ")":
            depth -= 1
            i += 1
        elif depth == 0:
            # Try two-char operators first (>=, <=, ==, !=)
            matched = False
            for op in (">=", "<=", "==", "!="):
                if expr[i:i + 2] == op:
                    count += 1
                    i += 2
                    matched = True
                    break
            if not matched and ch in (">", "<") and expr[i:i + 2] not in (">=", "<="):
                count += 1
                i += 1
            else:
                if not matched:
                    i += 1
        else:
            i += 1
    return count


def _eval_simple_expr(df: pl.DataFrame, expr: str) -> pl.Series:
    """Evaluate a single comparison expression (no AND/OR/NOT).

    F-4 fix (2026-05-20): Added arity validation that counts comparison operators
    at paren-depth-0 before splitting. If >1 operator is found, raises ValueError
    with a clear message rather than silently producing a wrong result.
    """
    expr = expr.strip()

    # Check for crosses_above / crosses_below first (not subject to arity check)
    if "crosses_above" in expr:
        parts = expr.split("crosses_above")
        if len(parts) != 2:
            raise ValueError(f"Expected exactly one 'crosses_above' in: '{expr}'")
        a = _resolve_operand(df, parts[0].strip())
        b = _resolve_operand(df, parts[1].strip())
        return _crosses_above(a, b)

    if "crosses_below" in expr:
        parts = expr.split("crosses_below")
        if len(parts) != 2:
            raise ValueError(f"Expected exactly one 'crosses_below' in: '{expr}'")
        a = _resolve_operand(df, parts[0].strip())
        b = _resolve_operand(df, parts[1].strip())
        return _crosses_below(a, b)

    # F-4: Arity check -- chained comparisons like 'a > b > c' must be rejected.
    op_count = _count_cmp_operators_at_depth0(expr)
    if op_count > 1:
        raise ValueError(
            f"Chained comparisons not supported: '{expr}'. "
            f"Found {op_count} comparison operators at depth-0. "
            f"Use AND/OR to combine conditions: e.g. 'a > b AND b > c'."
        )

    # Standard comparisons -- use token-aware regex (longest operators first).
    match = _CMP_PATTERN.search(expr)
    if match:
        op_str = match.group(1)
        op_fn = _COMPARISON_OPS.get(op_str)
        if op_fn is None:
            raise ValueError(f"Unknown comparison operator '{op_str}' in: '{expr}'")
        left = expr[:match.start()].strip()
        right = expr[match.end():].strip()
        a = _resolve_operand(df, left)
        b = _resolve_operand(df, right)
        result = op_fn(a, b)
        return result.fill_null(False)

    raise ValueError(f"Cannot parse expression: '{expr}'")


def _split_at_depth0(expression: str, keyword: str) -> list[str]:
    """Split `expression` on ` keyword ` tokens that are at paren-depth 0.

    F-5 fix (2026-05-20): replaces re.split() which was not paren-depth-aware.

    Algorithm: walk the string char-by-char, tracking paren depth.
    Split only when ' keyword ' is matched at depth == 0.

    Examples:
      _split_at_depth0('a AND b', 'AND') -> ['a', 'b']
      _split_at_depth0('(a OR b) AND c', 'OR') -> ['(a OR b) AND c']  (no depth-0 OR)
      _split_at_depth0('(a OR b) AND c', 'AND') -> ['(a OR b)', 'c']
      _split_at_depth0('(a crosses_above b) AND (c > d OR c > e)', 'AND')
          -> ['(a crosses_above b)', '(c > d OR c > e)']
    """
    kw = f" {keyword} "
    kw_len = len(kw)
    parts: list[str] = []
    depth = 0
    last_cut = 0
    i = 0
    n = len(expression)

    while i < n:
        ch = expression[i]
        if ch == "(":
            depth += 1
            i += 1
        elif ch == ")":
            depth -= 1
            i += 1
        elif depth == 0 and expression[i:i + kw_len] == kw:
            parts.append(expression[last_cut:i].strip())
            i += kw_len
            last_cut = i
        else:
            i += 1

    parts.append(expression[last_cut:].strip())
    return parts if len(parts) > 1 else [expression]


def _split_at_depth0(expression, keyword):
    """Split on ' keyword ' at paren-depth 0 only. F-5 fix 2026-05-20."""
    kw = f' {keyword} '
    kw_len = len(kw)
    parts = []
    depth = 0
    last_cut = 0
    i = 0
    n = len(expression)
    while i < n:
        ch = expression[i]
        if ch == '(':
            depth += 1; i += 1
        elif ch == ')':
            depth -= 1; i += 1
        elif depth == 0 and expression[i:i + kw_len] == kw:
            parts.append(expression[last_cut:i].strip())
            i += kw_len
            last_cut = i
        else:
            i += 1
    parts.append(expression[last_cut:].strip())
    return parts if len(parts) > 1 else [expression]


def evaluate_expression(df: pl.DataFrame, expression: str) -> pl.Series:
    """Evaluate a boolean expression against DataFrame columns.

    Supports: AND, OR, NOT, comparisons, crosses_above, crosses_below.

    Parentheses: outer parentheses around the entire expression are stripped before
    evaluation. This enables grammar strings like '(ema_9 crosses_above ema_21) AND
    (ema_50_4h > ema_200_4h)' produced by W23H.1 DSL compiler MTF AND-gate.
    Inner parentheses within subexpressions are stripped recursively via the same
    mechanism. Complex nested parentheses (e.g. NOT (A AND B)) are handled by the
    NOT prefix stripping below, which recurses on the inner expression.

    F-5 fix (2026-05-20): AND/OR splitting is now paren-depth-aware via
    _split_at_depth0(), replacing the previous re.split() that was not.
    """
    expression = expression.strip()

    # W23H.1: Strip outer parentheses if the entire expression is wrapped.
    # e.g. '(ema_9 crosses_above ema_21)' -> 'ema_9 crosses_above ema_21'
    # Guard: only strip if the opening '(' matches the closing ')' at the very end.
    if expression.startswith("(") and expression.endswith(")"):
        depth = 0
        for i, ch in enumerate(expression):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if depth == 0:
                if i == len(expression) - 1:
                    expression = expression[1:-1].strip()
                break

    # Handle NOT
    if expression.startswith("NOT "):
        inner = expression[4:]
        return ~evaluate_expression(df, inner)

    # F-5 fix: split on AND/OR using paren-depth-aware scanner.
    # OR has lower precedence than AND, so check OR first (outer), AND second (inner).
    or_parts = _split_at_depth0(expression, "OR")
    if len(or_parts) > 1:
        result = evaluate_expression(df, or_parts[0])
        for part in or_parts[1:]:
            result = result | evaluate_expression(df, part)
        return result

    and_parts = _split_at_depth0(expression, "AND")
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
