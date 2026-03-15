"""
Prop Firm Compliance Gate — Deterministic Rule Engine
Layer 2 of the three-layer compliance architecture.
No AI judgment. Pure rule matching against verified rulesets.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any


# ─── Freshness Thresholds ────────────────────────────────────────

RULESET_MAX_AGE_HOURS = {
    "active_trading": 24,
    "research_only": 72,
    "after_drift_detected": 0,
}


# ─── Freshness Gate ─────────────────────────────────────────────


def check_freshness(
    firm: str,
    ruleset: dict[str, Any],
    context: str = "active_trading",
) -> dict[str, Any]:
    """
    Check if a firm's ruleset is fresh enough for the given context.

    Returns:
        {
            "fresh": bool,
            "firm": str,
            "age_hours": float,
            "max_age_hours": int,
            "drift_detected": bool,
            "status": str,  # "verified" | "stale" | "blocked_drift"
            "message": str,
        }
    """
    retrieved_at = datetime.fromisoformat(ruleset["retrieved_at"])
    # Ensure timezone-aware comparison
    if retrieved_at.tzinfo is None:
        retrieved_at = retrieved_at.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    age_hours = (now - retrieved_at).total_seconds() / 3600.0

    drift_detected = bool(ruleset.get("drift_detected", False))

    # Drift overrides everything — max_age is 0
    if drift_detected:
        return {
            "fresh": False,
            "firm": firm,
            "age_hours": round(age_hours, 2),
            "max_age_hours": 0,
            "drift_detected": True,
            "status": "blocked_drift",
            "message": (
                f"{firm}: Drift detected — ruleset blocked until human "
                f"revalidation. Age: {age_hours:.1f}h."
            ),
        }

    max_age = RULESET_MAX_AGE_HOURS.get(context, 24)
    fresh = age_hours <= max_age

    if fresh:
        status = "verified"
        message = (
            f"{firm}: Ruleset verified — {age_hours:.1f}h old "
            f"(limit {max_age}h for {context})."
        )
    else:
        status = "stale"
        message = (
            f"{firm}: Ruleset STALE — {age_hours:.1f}h old "
            f"(limit {max_age}h for {context}). Re-fetch required."
        )

    return {
        "fresh": fresh,
        "firm": firm,
        "age_hours": round(age_hours, 2),
        "max_age_hours": max_age,
        "drift_detected": False,
        "status": status,
        "message": message,
    }


# ─── Strategy Compliance Check ───────────────────────────────────


def check_strategy_compliance(
    strategy: dict[str, Any],
    firm_rules: dict[str, Any],
) -> dict[str, Any]:
    """
    Check a strategy's backtest results against a firm's normalized rules.

    Checks:
    - max_drawdown vs firm's drawdown limit (trailing vs EOD vs intraday)
    - daily_loss vs firm's daily loss limit (if applicable)
    - consistency: best_day_pct vs firm's consistency threshold
    - overnight_holding vs firm's overnight policy
    - contract_limits vs firm's max contracts per symbol
    - automation_policy: flag if firm bans bots

    Returns:
        {
            "result": "pass" | "fail" | "needs_review",
            "violations": [...],
            "warnings": [...],
            "risk_score": int,  # 0-100
            "details": {...},
        }
    """
    violations: list[str] = []
    warnings: list[str] = []
    details: dict[str, Any] = {}
    risk_score = 0

    # ── Drawdown check ────────────────────────────────────────
    max_dd = strategy.get("max_drawdown", 0)
    dd_limit = firm_rules.get("max_drawdown_limit")
    if dd_limit is not None:
        details["drawdown"] = {
            "strategy_max_dd": max_dd,
            "firm_limit": dd_limit,
        }
        if max_dd > dd_limit:
            violations.append(
                f"Max drawdown ${max_dd:,.0f} exceeds firm limit "
                f"${dd_limit:,.0f}."
            )
            risk_score += 40
        elif max_dd > dd_limit * 0.80:
            warnings.append(
                f"Max drawdown ${max_dd:,.0f} is within 20% of firm limit "
                f"${dd_limit:,.0f}."
            )
            risk_score += 15

    # ── Daily loss check ──────────────────────────────────────
    daily_loss = strategy.get("daily_loss")
    daily_loss_limit = firm_rules.get("daily_loss_limit")
    if daily_loss is not None and daily_loss_limit is not None:
        details["daily_loss"] = {
            "strategy_daily_loss": daily_loss,
            "firm_limit": daily_loss_limit,
        }
        if daily_loss > daily_loss_limit:
            violations.append(
                f"Daily loss ${daily_loss:,.0f} exceeds firm limit "
                f"${daily_loss_limit:,.0f}."
            )
            risk_score += 30
        elif daily_loss > daily_loss_limit * 0.80:
            warnings.append(
                f"Daily loss ${daily_loss:,.0f} is within 20% of firm limit "
                f"${daily_loss_limit:,.0f}."
            )
            risk_score += 10

    # ── Consistency check (best-day concentration) ────────────
    best_day_pnl = strategy.get("best_day_pnl")
    total_pnl = strategy.get("total_pnl")
    consistency_threshold = firm_rules.get("consistency_threshold")
    if (
        best_day_pnl is not None
        and total_pnl is not None
        and total_pnl > 0
        and consistency_threshold is not None
    ):
        best_day_pct = best_day_pnl / total_pnl
        details["consistency"] = {
            "best_day_pct": round(best_day_pct, 4),
            "firm_threshold": consistency_threshold,
        }
        if best_day_pct > consistency_threshold:
            violations.append(
                f"Best day is {best_day_pct:.0%} of total P&L — exceeds "
                f"firm threshold of {consistency_threshold:.0%}."
            )
            risk_score += 25
        elif best_day_pct > consistency_threshold * 0.80:
            warnings.append(
                f"Best day is {best_day_pct:.0%} of total P&L — within 20% "
                f"of firm threshold {consistency_threshold:.0%}."
            )
            risk_score += 10

    # ── Overnight holding check ───────────────────────────────
    holds_overnight = strategy.get("overnight_holding", False)
    overnight_allowed = firm_rules.get("overnight_allowed", True)
    details["overnight"] = {
        "strategy_holds": holds_overnight,
        "firm_allows": overnight_allowed,
    }
    if holds_overnight and not overnight_allowed:
        violations.append("Strategy holds overnight but firm prohibits it.")
        risk_score += 20

    # ── Contract limits check ─────────────────────────────────
    strategy_contracts = strategy.get("contracts_per_symbol", {})
    firm_contract_limits = firm_rules.get("contract_limits", {})
    contract_violations: list[str] = []
    for symbol, count in strategy_contracts.items():
        limit = firm_contract_limits.get(symbol)
        if limit is not None and count > limit:
            contract_violations.append(
                f"{symbol}: {count} contracts exceeds firm limit of {limit}."
            )
    if contract_violations:
        violations.extend(contract_violations)
        risk_score += 15
        details["contract_limits"] = contract_violations

    # ── Automation policy check ───────────────────────────────
    is_automated = strategy.get("automated", False)
    automation_banned = firm_rules.get("automation_banned", False)
    if is_automated and automation_banned:
        violations.append(
            "Strategy is automated but firm prohibits bots/automation."
        )
        risk_score += 30

    # ── Determine result ──────────────────────────────────────
    risk_score = min(risk_score, 100)

    if violations:
        result = "fail"
    elif warnings:
        result = "needs_review"
    else:
        result = "pass"

    return {
        "result": result,
        "violations": violations,
        "warnings": warnings,
        "risk_score": risk_score,
        "details": details,
    }


# ─── Pre-Session Gate ────────────────────────────────────────────


def pre_session_gate(
    strategies: list[dict[str, Any]],
    rulesets: list[dict[str, Any]],
    context: str = "active_trading",
) -> dict[str, Any]:
    """
    Run the pre-session gate for all active strategies.
    Called daily at 9:15 AM ET before trading begins.

    For each strategy:
    1. Find the matching firm ruleset
    2. Check freshness
    3. Check compliance
    4. Return gate decision: APPROVED | BLOCKED | RESTRICTED

    Returns:
        {
            "date": str,
            "decisions": [...],
            "summary": {"approved": int, "blocked": int, "restricted": int},
        }
    """
    # Index rulesets by firm name for fast lookup
    ruleset_by_firm: dict[str, dict[str, Any]] = {
        rs["firm"]: rs for rs in rulesets
    }

    decisions: list[dict[str, Any]] = []
    summary = {"approved": 0, "blocked": 0, "restricted": 0}

    for strat in strategies:
        firm = strat["firm"]
        strategy_id = strat.get("strategy_id", "unknown")
        strategy_name = strat.get("strategy_name", "unnamed")

        ruleset = ruleset_by_firm.get(firm)

        # No ruleset found → blocked
        if ruleset is None:
            decisions.append({
                "strategy_id": strategy_id,
                "strategy_name": strategy_name,
                "firm": firm,
                "gate": "BLOCKED",
                "reason": f"No ruleset found for firm '{firm}'.",
                "freshness": None,
                "compliance": None,
            })
            summary["blocked"] += 1
            continue

        # Check freshness
        freshness = check_freshness(firm, ruleset, context)

        if not freshness["fresh"]:
            decisions.append({
                "strategy_id": strategy_id,
                "strategy_name": strategy_name,
                "firm": firm,
                "gate": "BLOCKED",
                "reason": freshness["message"],
                "freshness": freshness,
                "compliance": None,
            })
            summary["blocked"] += 1
            continue

        # Check compliance against firm rules
        firm_rules = ruleset.get("rules", {})
        compliance = check_strategy_compliance(strat, firm_rules)

        if compliance["result"] == "fail":
            gate = "BLOCKED"
            reason = "; ".join(compliance["violations"])
            summary["blocked"] += 1
        elif compliance["result"] == "needs_review":
            gate = "RESTRICTED"
            reason = "; ".join(compliance["warnings"])
            summary["restricted"] += 1
        else:
            gate = "APPROVED"
            reason = None
            summary["approved"] += 1

        decisions.append({
            "strategy_id": strategy_id,
            "strategy_name": strategy_name,
            "firm": firm,
            "gate": gate,
            "reason": reason,
            "freshness": freshness,
            "compliance": compliance,
        })

    return {
        "date": datetime.now(timezone.utc).date().isoformat(),
        "decisions": decisions,
        "summary": summary,
    }


# ─── Drift Detection ────────────────────────────────────────────


def compute_content_hash(content: str) -> str:
    """SHA-256 hash of raw content for drift detection."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def detect_drift(
    stored_hash: str,
    new_content: str,
) -> dict[str, Any]:
    """
    Compare stored content hash against new content.

    Returns:
        {
            "drift_detected": bool,
            "old_hash": str,
            "new_hash": str,
        }
    """
    new_hash = compute_content_hash(new_content)
    return {
        "drift_detected": stored_hash != new_hash,
        "old_hash": stored_hash,
        "new_hash": new_hash,
    }
