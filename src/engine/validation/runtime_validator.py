"""Runtime Validator — signal auditing against concept specs.

Checks computed signals after strategy.compute() returns:
1. Time window compliance — entries only in allowed windows
2. Signal reasonableness — not 0 signals, not every bar
3. Concept-specific checks from spec.runtime_assertions
"""

from __future__ import annotations

import polars as pl

from src.engine.validation import ConceptSpec, ValidationResult


def _check_entries_in_windows(
    df: pl.DataFrame, spec: ConceptSpec
) -> tuple[list[str], list[str]]:
    """Verify all entry signals fall within allowed time windows."""
    errors: list[str] = []
    warnings: list[str] = []

    if not spec.required_time_windows:
        return errors, warnings

    # Need timestamp column
    ts_col = "ts_et" if "ts_et" in df.columns else "ts_event"
    if ts_col not in df.columns:
        warnings.append("No timestamp column found — cannot validate time windows")
        return errors, warnings

    # Get entries
    entry_mask = pl.lit(False)
    if "entry_long" in df.columns:
        entry_mask = entry_mask | df["entry_long"]
    if "entry_short" in df.columns:
        entry_mask = entry_mask | df["entry_short"]

    entries = df.filter(entry_mask)
    if len(entries) == 0:
        return errors, warnings

    # Extract hour/minute from timestamps
    ts = entries[ts_col]
    hours = ts.dt.hour().to_list()
    minutes = ts.dt.minute().to_list()

    total_entries = len(entries)
    in_window_count = 0

    for h, m in zip(hours, minutes):
        t_minutes = h * 60 + m
        in_any_window = False
        for tw in spec.required_time_windows:
            if tw.start_minutes <= t_minutes < tw.end_minutes:
                in_any_window = True
                break
        if in_any_window:
            in_window_count += 1

    out_of_window = total_entries - in_window_count
    pct_outside = (out_of_window / total_entries * 100) if total_entries > 0 else 0

    if "all_entries_in_windows" in spec.runtime_assertions:
        if out_of_window > 0:
            errors.append(
                f"{out_of_window}/{total_entries} entries ({pct_outside:.1f}%) "
                f"outside allowed time windows for {spec.concept}"
            )
    elif pct_outside > 20:
        warnings.append(
            f"{pct_outside:.1f}% of entries outside expected time windows "
            f"for {spec.concept}"
        )

    return errors, warnings


def _check_signal_density(
    df: pl.DataFrame, spec: ConceptSpec
) -> tuple[list[str], list[str]]:
    """Check signal count is reasonable (not zero, not every bar)."""
    errors: list[str] = []
    warnings: list[str] = []

    n = len(df)
    if n == 0:
        return errors, warnings

    entry_count = 0
    if "entry_long" in df.columns:
        entry_count += df["entry_long"].sum()
    if "entry_short" in df.columns:
        entry_count += df["entry_short"].sum()

    # Check for zero signals
    if "signal_count_nonzero" in spec.runtime_assertions:
        if entry_count == 0:
            errors.append(f"Zero entry signals generated for {spec.concept}")

    # Check for unreasonable density (> 10% of bars)
    if "signal_density_reasonable" in spec.runtime_assertions:
        density = entry_count / n if n > 0 else 0
        if density > 0.10:
            errors.append(
                f"Signal density {density:.1%} is unreasonably high for {spec.concept} "
                f"({entry_count} entries in {n} bars)"
            )
        elif density > 0.05:
            warnings.append(
                f"Signal density {density:.1%} is high for {spec.concept} — "
                f"consider tighter filters"
            )

    return errors, warnings


def validate_runtime(df: pl.DataFrame, spec: ConceptSpec) -> ValidationResult:
    """Validate strategy signals against the concept spec.

    Run this after strategy.compute() returns.

    Args:
        df: DataFrame with entry_long, entry_short, exit_long, exit_short columns
        spec: The concept specification to validate against

    Returns:
        ValidationResult with pass/fail + error details
    """
    errors: list[str] = []
    warnings: list[str] = []

    # 1. Time window compliance
    tw_errors, tw_warnings = _check_entries_in_windows(df, spec)
    errors.extend(tw_errors)
    warnings.extend(tw_warnings)

    # 2. Signal density
    sd_errors, sd_warnings = _check_signal_density(df, spec)
    errors.extend(sd_errors)
    warnings.extend(sd_warnings)

    passed = len(errors) == 0
    return ValidationResult(passed=passed, errors=errors, warnings=warnings)
