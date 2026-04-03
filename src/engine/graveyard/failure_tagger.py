"""Auto-tag failure modes for dead strategies."""

from dataclasses import dataclass, field
from typing import Any

# 10 canonical failure modes
FAILURE_MODES = {
    "OVERFIT": "Strategy only works on specific parameter values",
    "REGIME_DEPENDENT": "Strategy only works in one market regime",
    "COMMISSION_DEATH": "Gross profitable but net negative after commissions",
    "DRAWDOWN_EXCEEDED": "Max drawdown exceeds prop firm limits",
    "INCONSISTENT": "Too few winning days, violates consistency rules",
    "CURVE_FIT": "Great in-sample, fails walk-forward validation",
    "DECAY": "Initially profitable but alpha decayed over time",
    "LIQUIDITY_DEPENDENT": "Requires fills that aren't realistic",
    "COMPLEXITY_EXCESS": "Too many parameters (>5), hard to maintain",
    "CORRELATION_DUPLICATE": "Too similar to an existing live strategy",
}


@dataclass
class FailureTag:
    """Enriched failure tag for a dead strategy.

    Extends the raw {mode, confidence, evidence} dict with structured
    category and severity fields so downstream consumers (graveyard gate,
    critic, search) can filter and rank without parsing free-text evidence.
    """
    mode: str
    confidence: float
    evidence: str
    category: str
    severity: float
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "category": self.category,
            "severity": self.severity,
            "metrics": self.metrics,
        }


# Maps each failure mode to a structural category for graveyard querying.
MODE_TO_CATEGORY: dict[str, str] = {
    "OVERFIT": "robustness",
    "REGIME_DEPENDENT": "regime",
    "COMMISSION_DEATH": "execution",
    "DRAWDOWN_EXCEEDED": "compliance",
    "INCONSISTENT": "compliance",
    "CURVE_FIT": "robustness",
    "DECAY": "performance",
    "LIQUIDITY_DEPENDENT": "execution",
    "COMPLEXITY_EXCESS": "structural",
    "CORRELATION_DUPLICATE": "structural",
}

# Base severity scores per failure mode (0.0–1.0).
# Severity represents the absolute badness of the failure — independent of how
# confident we are that the mode applies. Confidence is evidence strength;
# severity is how bad it is when true.  _enrich_tag blends both: a high-severity
# but low-confidence tag stays in the graveyard for pattern matching, but does
# not automatically block a candidate strategy at the gate.
MODE_TO_SEVERITY: dict[str, float] = {
    "DRAWDOWN_EXCEEDED": 0.95,
    "COMMISSION_DEATH": 0.85,
    "OVERFIT": 0.80,
    "CURVE_FIT": 0.80,
    "INCONSISTENT": 0.70,
    "DECAY": 0.65,
    "REGIME_DEPENDENT": 0.60,
    "LIQUIDITY_DEPENDENT": 0.55,
    "COMPLEXITY_EXCESS": 0.40,
    "CORRELATION_DUPLICATE": 0.35,
}


def _enrich_tag(raw: dict) -> dict:
    """Convert a raw {mode, confidence, evidence} dict into an enriched tag dict.

    Severity comes from MODE_TO_SEVERITY (static per-mode score) rather than
    mirroring confidence.  Confidence reflects how strongly the evidence
    supports the failure mode; severity reflects how bad that mode is when
    present. They are orthogonal: a well-evidenced COMPLEXITY_EXCESS tag
    (high confidence, low severity) should not block a candidate as aggressively
    as a low-confidence DRAWDOWN_EXCEEDED tag.
    """
    mode = raw["mode"]
    tag = FailureTag(
        mode=mode,
        confidence=raw["confidence"],
        evidence=raw["evidence"],
        category=MODE_TO_CATEGORY.get(mode, "unknown"),
        severity=MODE_TO_SEVERITY.get(mode, raw["confidence"]),
        metrics=raw.get("metrics", {}),
    )
    return tag.to_dict()


def tag_failure(
    backtest_results: dict,
    walk_forward_results: dict | None = None,
    robustness_results: dict | None = None,
) -> list[dict]:
    """
    Analyze why a strategy failed and assign failure tags.

    Returns list of {mode, confidence, evidence} sorted by confidence desc.

    Rules:
    - If walk_forward sharpe < 0.5 * in_sample sharpe -> CURVE_FIT
    - If max_drawdown > 2500 -> DRAWDOWN_EXCEEDED
    - If profit_factor < 1.0 after commissions -> COMMISSION_DEATH
    - If best_day_pct > 40% -> INCONSISTENT
    - If win_days_per_month < 10 -> INCONSISTENT
    - If only profitable in 1 regime -> REGIME_DEPENDENT
    - If robustness std > 0.5 * mean -> OVERFIT
    - If param count > 5 -> COMPLEXITY_EXCESS
    """
    tags: list[dict] = []

    # --- DRAWDOWN_EXCEEDED ---
    max_dd = abs(backtest_results.get("max_drawdown", 0))
    if max_dd > 2500:
        tags.append(
            {
                "mode": "DRAWDOWN_EXCEEDED",
                "confidence": min(1.0, max_dd / 5000),
                "evidence": f"Max drawdown ${max_dd:.0f} exceeds $2,500 prop firm limit",
            }
        )

    # --- COMMISSION_DEATH ---
    gross_pf = backtest_results.get("gross_profit_factor", None)
    net_pf = backtest_results.get("profit_factor", 0)
    if net_pf < 1.0:
        confidence = 0.9 if (gross_pf is not None and gross_pf >= 1.0) else 0.6
        tags.append(
            {
                "mode": "COMMISSION_DEATH",
                "confidence": confidence,
                "evidence": f"Net profit factor {net_pf:.2f} < 1.0"
                + (f" (gross PF {gross_pf:.2f})" if gross_pf is not None else ""),
            }
        )

    # --- INCONSISTENT (best_day_pct) ---
    best_day_pct = backtest_results.get("best_day_pct", 0)
    if best_day_pct > 40:
        tags.append(
            {
                "mode": "INCONSISTENT",
                "confidence": min(1.0, best_day_pct / 80),
                "evidence": f"Best day accounts for {best_day_pct:.1f}% of total profit",
            }
        )

    # --- INCONSISTENT (win_days_per_month) ---
    win_days = backtest_results.get("win_days_per_month", 20)
    if win_days < 10:
        tags.append(
            {
                "mode": "INCONSISTENT",
                "confidence": max(0.5, 1.0 - win_days / 10),
                "evidence": f"Only {win_days} winning days/month (need 10+)",
            }
        )

    # --- CURVE_FIT (walk-forward degradation) ---
    if walk_forward_results is not None:
        is_sharpe = backtest_results.get("sharpe_ratio", 0)
        wf_sharpe = walk_forward_results.get("sharpe_ratio", 0)
        if is_sharpe > 0 and wf_sharpe < 0.5 * is_sharpe:
            ratio = wf_sharpe / is_sharpe if is_sharpe != 0 else 0
            tags.append(
                {
                    "mode": "CURVE_FIT",
                    "confidence": min(1.0, 1.0 - ratio),
                    "evidence": (
                        f"Walk-forward Sharpe {wf_sharpe:.2f} is "
                        f"{ratio:.0%} of in-sample {is_sharpe:.2f}"
                    ),
                }
            )

    # --- REGIME_DEPENDENT ---
    regime_pnls = backtest_results.get("regime_pnls", {})
    if regime_pnls:
        profitable_regimes = [r for r, pnl in regime_pnls.items() if pnl > 0]
        total_regimes = len(regime_pnls)
        if total_regimes >= 2 and len(profitable_regimes) <= 1:
            tags.append(
                {
                    "mode": "REGIME_DEPENDENT",
                    "confidence": 0.85,
                    "evidence": (
                        f"Profitable in {len(profitable_regimes)}/{total_regimes} regimes"
                        + (f" ({profitable_regimes[0]})" if profitable_regimes else "")
                    ),
                }
            )

    # --- OVERFIT (robustness) ---
    if robustness_results is not None:
        rob_mean = robustness_results.get("mean_sharpe", 0)
        rob_std = robustness_results.get("std_sharpe", 0)
        if rob_mean > 0 and rob_std > 0.5 * rob_mean:
            tags.append(
                {
                    "mode": "OVERFIT",
                    "confidence": min(1.0, rob_std / rob_mean),
                    "evidence": (
                        f"Robustness Sharpe std {rob_std:.2f} is "
                        f"{rob_std / rob_mean:.0%} of mean {rob_mean:.2f}"
                    ),
                }
            )

    # --- COMPLEXITY_EXCESS ---
    param_count = backtest_results.get("param_count", 0)
    if param_count > 5:
        tags.append(
            {
                "mode": "COMPLEXITY_EXCESS",
                "confidence": min(1.0, param_count / 10),
                "evidence": f"Strategy has {param_count} parameters (max 5)",
            }
        )

    # --- DECAY ---
    rolling_sharpe = backtest_results.get("rolling_sharpe_trend", None)
    if rolling_sharpe is not None and rolling_sharpe < -0.3:
        tags.append(
            {
                "mode": "DECAY",
                "confidence": min(1.0, abs(rolling_sharpe)),
                "evidence": f"Rolling Sharpe trend slope: {rolling_sharpe:.3f}",
            }
        )

    # --- LIQUIDITY_DEPENDENT ---
    fill_rate = backtest_results.get("limit_fill_rate", None)
    if fill_rate is not None and fill_rate < 0.5:
        tags.append(
            {
                "mode": "LIQUIDITY_DEPENDENT",
                "confidence": 1.0 - fill_rate,
                "evidence": f"Limit order fill rate {fill_rate:.0%} (below 50%)",
            }
        )

    # Sort by confidence descending, then enrich each tag with category/severity
    tags.sort(key=lambda t: t["confidence"], reverse=True)
    return [_enrich_tag(t) for t in tags]
