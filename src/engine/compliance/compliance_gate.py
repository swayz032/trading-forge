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
    max_age = RULESET_MAX_AGE_HOURS.get(context, 24)
    try:
        retrieved_at = datetime.fromisoformat(ruleset["retrieved_at"])
    except (ValueError, TypeError) as exc:
        return {
            "fresh": False,
            "age_hours": float("inf"),
            "max_age_hours": max_age,
            "drift_detected": False,
            "status": "stale",
            "message": f"Invalid retrieved_at timestamp: {exc}",
        }
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


# ─── Violation Check (per-firm, per-strategy) ───────────────────


def check_violation(
    firm: str,
    ruleset: dict[str, Any],
    strategy_state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Pre-order violation check.  Distinct from check_freshness:
    freshness asks "are the rules still trustworthy?"; violation asks
    "given the (assumed-fresh) rules, is the strategy currently in
    violation of any hard prohibition?"

    Hard prohibitions checked:
      - automation banned on PA/Live (Apex 4.0, Tradeify, FundingPips)
      - VPS/VPN/remote-access prohibited (Topstep)
      - household account cap exceeded (Apex 20-account cap)

    Args:
        firm: firm key ("apex_trader_funding", "topstep", etc.)
        ruleset: parsed ruleset dict (typically from compliance_rulesets row)
        strategy_state: optional runtime context — { automated: bool,
            account_phase: 'eval'|'pa'|'live', host: str, pa_account_count: int }

    Returns:
        {
            "violation": bool,
            "firm": str,
            "violations": [...],
            "status": "ok" | "blocked",
            "message": str,
        }
    """
    state = strategy_state or {}
    rules = ruleset.get("parsed_rules") or ruleset.get("rules") or ruleset
    violations: list[str] = []

    is_automated = bool(state.get("automated", False))
    account_phase = state.get("account_phase", "pa")  # default: pa/live (strictest)
    host = str(state.get("host", "unknown"))
    pa_account_count = int(state.get("pa_account_count", 0))

    # ── Automation policy (Apex 4.0, Tradeify, FundingPips) ──────
    automation_banned = bool(rules.get("automation_banned", False))
    automation_banned_pa = bool(rules.get("automation_banned_pa_live", False))
    if is_automated and automation_banned:
        violations.append(
            f"{firm}: full automation prohibited — strategy must route "
            f"through indicator + manual approval."
        )
    if is_automated and automation_banned_pa and account_phase in ("pa", "live"):
        violations.append(
            f"{firm}: full automation prohibited on {account_phase} accounts "
            f"(eval allowed). Use semi-auto with manual approval."
        )

    # ── Topstep: no VPS / VPN / remote ───────────────────────────
    vps_banned = bool(rules.get("vps_prohibited", False))
    if vps_banned and host not in ("local", "skytech-tower", "personal-device"):
        violations.append(
            f"{firm}: VPS/VPN/remote-access prohibited — orders must "
            f"originate from personal device (got host={host!r})."
        )

    # ── Apex household 20-account cap ────────────────────────────
    account_cap = rules.get("household_max_pa_accounts")
    if account_cap is not None and pa_account_count > int(account_cap):
        violations.append(
            f"{firm}: household has {pa_account_count} PA accounts, "
            f"exceeds cap of {account_cap}."
        )

    if violations:
        return {
            "violation": True,
            "firm": firm,
            "violations": violations,
            "status": "blocked",
            "message": "; ".join(violations),
        }

    return {
        "violation": False,
        "firm": firm,
        "violations": [],
        "status": "ok",
        "message": f"{firm}: no hard violations against current ruleset.",
    }


# ─── Kill Switch (D6) ───────────────────────────────────────────

# Kill switch reasons (enumerated — queryable, not free-text)
KILL_REASON_APPROACHING_DAILY_LOSS = "approaching_daily_loss_limit"
KILL_REASON_DAILY_LOSS_BREACHED    = "daily_loss_limit_breached"
KILL_REASON_MAX_TRADES             = "max_trades_per_session"
KILL_REASON_CONSECUTIVE_LOSSES     = "consecutive_loss_limit"

# Default limits
DEFAULT_CONSECUTIVE_LOSS_LIMIT = 4


def check_kill_switch(
    session_id: str,
    firm_key: str,
    current_daily_pnl: float,
    daily_loss_limit: float,
    max_trades_per_session: int | None = None,
    trades_today: int = 0,
    consecutive_losses: int = 0,
    consecutive_loss_limit: int = DEFAULT_CONSECUTIVE_LOSS_LIMIT,
) -> dict[str, Any]:
    """
    Pre-order kill switch — runs BEFORE every order entry.

    Conditions evaluated in priority order (cheapest/most critical first):
      1. daily_loss_limit_breached  — actual breach (force_close=True)
      2. approaching_daily_loss_limit — within 5% of breach
      3. max_trades_per_session — hard trade count cap
      4. consecutive_loss_limit — 4+ consecutive losses

    Fail-CLOSED by design: any missing or invalid numeric inputs result
    in tripped=True rather than letting a potentially blown account trade.
    Callers must pass valid floats; never supply None for P&L fields.

    Args:
        session_id:             paper session UUID (for structured logging)
        firm_key:               firm identifier (for structured logging)
        current_daily_pnl:      session's running daily P&L ($, negative = loss)
        daily_loss_limit:       firm's daily loss limit ($, positive value)
        max_trades_per_session: optional hard cap on trades per session-day
        trades_today:           number of trades taken today
        consecutive_losses:     number of consecutive losing trades this session
        consecutive_loss_limit: threshold before kill trips (default 4)

    Returns:
        {
            "tripped": bool,
            "reason": str | None,       # KILL_REASON_* constant or None
            "force_close": bool,        # True only on actual breach
            "session_id": str,
            "firm_key": str,
            "daily_pnl_pct": float,     # current_daily_pnl / daily_loss_limit
        }
    """
    # Guard: invalid daily_loss_limit makes the P&L check meaningless — fail closed
    if not isinstance(daily_loss_limit, (int, float)) or daily_loss_limit <= 0:
        return {
            "tripped": True,
            "reason": "invalid_daily_loss_limit",
            "force_close": False,
            "session_id": session_id,
            "firm_key": firm_key,
            "daily_pnl_pct": float("nan"),
        }

    daily_pnl_pct = current_daily_pnl / daily_loss_limit  # negative when losing

    # 1. Actual breach — force close existing positions
    if daily_pnl_pct <= -1.00:
        return {
            "tripped": True,
            "reason": KILL_REASON_DAILY_LOSS_BREACHED,
            "force_close": True,
            "session_id": session_id,
            "firm_key": firm_key,
            "daily_pnl_pct": round(daily_pnl_pct, 4),
        }

    # 2. Approaching breach (within 5%) — stop new orders, don't force close
    if daily_pnl_pct <= -0.95:
        return {
            "tripped": True,
            "reason": KILL_REASON_APPROACHING_DAILY_LOSS,
            "force_close": False,
            "session_id": session_id,
            "firm_key": firm_key,
            "daily_pnl_pct": round(daily_pnl_pct, 4),
        }

    # 3. Max trades per session-day
    if max_trades_per_session is not None and trades_today >= max_trades_per_session:
        return {
            "tripped": True,
            "reason": KILL_REASON_MAX_TRADES,
            "force_close": False,
            "session_id": session_id,
            "firm_key": firm_key,
            "daily_pnl_pct": round(daily_pnl_pct, 4),
        }

    # 4. Consecutive loss limit
    if consecutive_losses >= consecutive_loss_limit:
        return {
            "tripped": True,
            "reason": KILL_REASON_CONSECUTIVE_LOSSES,
            "force_close": False,
            "session_id": session_id,
            "firm_key": firm_key,
            "daily_pnl_pct": round(daily_pnl_pct, 4),
        }

    return {
        "tripped": False,
        "reason": None,
        "force_close": False,
        "session_id": session_id,
        "firm_key": firm_key,
        "daily_pnl_pct": round(daily_pnl_pct, 4),
    }


# ─── CLI Entry Point (for Node python-runner bridge) ────────────


if __name__ == "__main__":
    import json
    import os
    import sys

    # Accept config via --config file path or stdin (matches calendar_filter.py)
    config_path: str | None = None
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--config" and i + 1 < len(argv):
            config_path = argv[i + 1]
            break
        if os.path.isfile(arg):
            config_path = arg
            break

    if config_path:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
    else:
        config = json.load(sys.stdin)

    action = config.get("action", "check_freshness")
    firm = config.get("firm", "unknown")
    ruleset = config.get("ruleset") or {}
    context = config.get("context", "active_trading")

    # If ruleset is empty but session_id is provided, fall back to a
    # synthetic "stale" response so the Node-side guard fails open
    # (we log the gap but don't block trading on missing rule data).
    if not ruleset and not config.get("ruleset"):
        # Without a ruleset we can't run a real check — emit a structured
        # "unknown" response.  The Node guard treats fresh=false as block,
        # so this is conservative-by-default.  Caller is expected to pass
        # the ruleset dict directly when it's hot-cached.
        result = {
            "fresh": False,
            "firm": firm,
            "age_hours": float("inf"),
            "max_age_hours": RULESET_MAX_AGE_HOURS.get(context, 24),
            "drift_detected": False,
            "status": "no_ruleset",
            "message": (
                f"{firm}: no ruleset payload provided to compliance_gate "
                f"(action={action}). Provide config.ruleset to evaluate."
            ),
        }
        print(json.dumps(result))
        sys.exit(0)

    if action == "check_freshness":
        result = check_freshness(firm, ruleset, context)
    elif action == "check_violation":
        strategy_state = config.get("strategy_state") or {}
        result = check_violation(firm, ruleset, strategy_state)
    elif action == "pre_session_gate":
        strategies = config.get("strategies") or []
        rulesets = config.get("rulesets") or [ruleset] if ruleset else []
        result = pre_session_gate(strategies, rulesets, context)
    elif action == "detect_drift":
        stored_hash = config.get("stored_hash", "")
        new_content = config.get("new_content", "")
        result = detect_drift(stored_hash, new_content)
    elif action == "check_kill_switch":
        result = check_kill_switch(
            session_id=config.get("sessionId", "unknown"),
            firm_key=config.get("firmKey", firm),
            current_daily_pnl=float(config.get("currentDailyPnl", 0)),
            daily_loss_limit=float(config.get("dailyLossLimit", 0)),
            max_trades_per_session=config.get("maxTradesPerSession"),
            trades_today=int(config.get("tradesToday", 0)),
            consecutive_losses=int(config.get("consecutiveLosses", 0)),
            consecutive_loss_limit=int(config.get("consecutiveLossLimit", DEFAULT_CONSECUTIVE_LOSS_LIMIT)),
        )
    else:
        result = {
            "error": f"Unknown action: {action}",
            "supported_actions": [
                "check_freshness",
                "check_violation",
                "pre_session_gate",
                "detect_drift",
                "check_kill_switch",
            ],
        }

    print(json.dumps(result))
