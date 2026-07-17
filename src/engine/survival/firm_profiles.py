"""
Prop firm survival profiles — Topstep (PRIMARY) + MFFU (secondary).

Per CLAUDE.md §6: only these two firms are in production scope.
Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade) removed
2026-05-19.

DERIVED VIEW — drift-impossible by construction (W3B 2026-07-17).
FIRM_PROFILES is no longer a hand-maintained copy of firm rules. Every
firm-rule value is DERIVED at import time from the canonical, hash-versioned
structs in ``src/engine/firm_config.py`` (FIRM_RULES / FIRM_CONTRACT_CAPS /
FIRM_COMMISSIONS — the same structs covered by ``computeFirmRulesVersion``
drift detection). Editing firm rules HERE is impossible; edit firm_config.py
and this view follows automatically. This replaces the pre-W3B hand-typed
profile ("verified 2026-05-19") that had silently drifted from canonical:

  - MFFU max_contracts 50 → 40   (operator runs the MFFU BUILDER plan: 4 minis / 40 micros)
  - MFFU commission 0.62 → 0.95  (MFFU MES/MNQ $1.90 RT ÷ 2; 0.62 was TopstepX's value)
  - MFFU daily_loss_limit None → 1000 (Builder $1,000 DLL; canonically a SOFT pause —
    scoring it as a breach-able limit is the conservative direction)
  - Topstep commission 0.37 → 0.62 (stale pre-2026-06-23 rate)
  - Topstep consistency None → 0.50 (canonical "topstep_50pct" best-day rule)

The only literals left are PROFILE-LOCAL data (not firm-rule data) that has
no canonical source in firm_config.py — each is marked inline.

Dict SHAPE is unchanged — consumers (survival_scorer.py, survival_comparator.py,
survival_twin_replay.py, routes/survival.ts) read the same keys as before.
"""

from __future__ import annotations

import json
import sys

from ..firm_config import (
    FIRM_COMMISSIONS,
    FIRM_CONTRACT_CAPS,
    FIRM_RULES,
)

# Profile firm name → canonical firm_config key. 50K accounts only (the only
# account tier firm_config models — matches CLAUDE.md §6 production scope).
_CANONICAL_FIRM_KEYS: dict[str, str] = {
    "MFFU": "mffu_50k",
    "Topstep": "topstep_50k",
}

# Canonical consistency_rule string → best-day concentration threshold used by
# the survival scorer's concentration_analysis. Both 2026 rules are 50%.
# A new/unknown rule string fails LOUDLY at import (fail-closed) rather than
# silently scoring with no consistency check.
_CONSISTENCY_RULE_THRESHOLDS: dict[str, float] = {
    "topstep_50pct": 0.50,
    "mffu_50pct_sim_payout": 0.50,
}

# ── PROFILE-LOCAL (not firm-rule) data — no canonical source in firm_config.py ──
# Display names and drawdown-lock semantics are survival-profile presentation
# fields; they do not feed breach math and are not covered by the firm-rules
# version hash.
_PROFILE_LOCAL: dict[str, dict] = {
    "MFFU": {
        "name": "My Funded Futures",       # profile-local (not firm-rule) data
        # Builder MLL goes STATIC once it trails up to $0 vs starting balance
        # (canonical FIRM_RULES only carries the numeric starting_floor).
        "drawdown_locks_at": "starting_balance",  # profile-local (not firm-rule) data
    },
    "Topstep": {
        "name": "Topstep",                 # profile-local (not firm-rule) data
        "drawdown_locks_at": None,         # profile-local (not firm-rule) data
    },
}


def _derive_account_profile(firm: str, canonical_key: str) -> dict:
    """Derive one 50K account profile from the canonical firm_config structs."""
    rules = FIRM_RULES[canonical_key]

    consistency_rule = rules["consistency_rule"]
    if consistency_rule is not None and consistency_rule not in _CONSISTENCY_RULE_THRESHOLDS:
        raise KeyError(
            f"firm_profiles: unmapped canonical consistency_rule '{consistency_rule}' "
            f"for {canonical_key}. Add it to _CONSISTENCY_RULE_THRESHOLDS."
        )

    return {
        # ← FIRM_RULES (canonical)
        "max_drawdown": rules["max_drawdown"],
        "drawdown_type": rules["trailing"].upper(),  # "eod" → "EOD"
        "daily_loss_limit": rules["daily_loss_limit"],
        "consistency_threshold": (
            _CONSISTENCY_RULE_THRESHOLDS[consistency_rule]
            if consistency_rule is not None
            else None
        ),
        "payout_split": rules["payout_split"],
        "eval_cost_monthly": rules["monthly_fee"],
        # ← FIRM_CONTRACT_CAPS (canonical per-symbol micro caps)
        "max_contracts": dict(FIRM_CONTRACT_CAPS[canonical_key]),
        # ← FIRM_COMMISSIONS (canonical all-in per-side). The profile carries a
        # single scalar; MES is the representative symbol (MES == MNQ at both
        # firms; MCL differs — use get_commission_per_side() for per-symbol).
        "commission_per_side": FIRM_COMMISSIONS[canonical_key]["MES"],
        # profile-local (not firm-rule) data
        "drawdown_locks_at": _PROFILE_LOCAL[firm]["drawdown_locks_at"],
    }


def _build_firm_profiles() -> dict[str, dict]:
    return {
        firm: {
            "name": _PROFILE_LOCAL[firm]["name"],
            "accounts": {
                "50K": _derive_account_profile(firm, canonical_key),
            },
        }
        for firm, canonical_key in _CANONICAL_FIRM_KEYS.items()
    }


FIRM_PROFILES: dict[str, dict] = _build_firm_profiles()

# Required fields every account profile must have
REQUIRED_FIELDS = [
    "max_drawdown",
    "drawdown_type",
    "daily_loss_limit",
    "consistency_threshold",
    "max_contracts",
    "payout_split",
    "eval_cost_monthly",
    "commission_per_side",
]


def get_firm_profile(firm: str, account_type: str = "50K") -> dict | None:
    """Get firm profile for a specific account type."""
    firm_data = FIRM_PROFILES.get(firm)
    if not firm_data:
        return None
    return firm_data["accounts"].get(account_type)


def list_firms() -> list[str]:
    return list(FIRM_PROFILES.keys())


# ─── CLI Entry Point (consumed by routes/survival.ts GET /firm-profiles) ──

def main():
    """CLI: python -m src.engine.survival.firm_profiles --config <json|path>

    Supported actions:
      {"action": "list"} (default) → {"firms": [...], "profiles": {...}}
    """
    import argparse
    import os

    parser = argparse.ArgumentParser(description="Firm survival profiles")
    parser.add_argument("--config", default="{}", help="JSON config string or file path")
    args = parser.parse_args()

    config_input = args.config
    if os.path.isfile(config_input):
        with open(config_input) as f:
            config = json.load(f)
    else:
        config = json.loads(config_input)

    action = config.get("action", "list")
    if action != "list":
        json.dump({"error": f"Unknown action '{action}'. Valid: 'list'."}, sys.stdout)
        return

    json.dump({"firms": list_firms(), "profiles": FIRM_PROFILES}, sys.stdout)


if __name__ == "__main__":
    main()
