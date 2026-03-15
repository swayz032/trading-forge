"""Per-firm commission and contract cap data.

Per CLAUDE.md: Don't use gross P&L for performance gates — use net P&L
per firm (commissions differ: MFFU $1.58/side vs Apex $2.64/side).
Don't ignore firm contract caps in backtests.
"""

from __future__ import annotations


# ─── Per-Firm Commissions (per side, per contract) ───────────────
# Source: each firm's fee schedule for 50K accounts

FIRM_COMMISSIONS: dict[str, dict[str, float]] = {
    "topstep_50k": {
        "ES": 2.52, "NQ": 2.52, "CL": 2.52, "YM": 2.52,
        "RTY": 2.52, "GC": 2.52, "MES": 0.62, "MNQ": 0.62,
    },
    "mffu_50k": {
        "ES": 1.58, "NQ": 1.58, "CL": 1.58, "YM": 1.58,
        "RTY": 1.58, "GC": 1.58, "MES": 0.62, "MNQ": 0.62,
    },
    "tpt_50k": {
        "ES": 2.04, "NQ": 2.04, "CL": 2.04, "YM": 2.04,
        "RTY": 2.04, "GC": 2.04, "MES": 0.62, "MNQ": 0.62,
    },
    "apex_50k": {
        "ES": 2.64, "NQ": 2.64, "CL": 2.64, "YM": 2.64,
        "RTY": 2.64, "GC": 2.64, "MES": 0.62, "MNQ": 0.62,
    },
    "tradeify_50k": {
        "ES": 2.52, "NQ": 2.52, "CL": 2.52, "YM": 2.52,
        "RTY": 2.52, "GC": 2.52, "MES": 0.62, "MNQ": 0.62,
    },
    "alpha_50k": {
        "ES": 2.04, "NQ": 2.04, "CL": 2.04, "YM": 2.04,
        "RTY": 2.04, "GC": 2.04, "MES": 0.62, "MNQ": 0.62,
    },
    "ffn_50k": {
        "ES": 2.52, "NQ": 2.52, "CL": 2.52, "YM": 2.52,
        "RTY": 2.52, "GC": 2.52, "MES": 0.62, "MNQ": 0.62,
    },
}


# ─── Per-Firm Contract Caps (max simultaneous contracts) ─────────

FIRM_CONTRACT_CAPS: dict[str, dict[str, int]] = {
    "topstep_50k":   {"ES": 5,  "NQ": 5,  "CL": 10, "YM": 5,  "RTY": 5,  "GC": 5,  "MES": 50, "MNQ": 50},
    "mffu_50k":      {"ES": 5,  "NQ": 5,  "CL": 10, "YM": 5,  "RTY": 5,  "GC": 5,  "MES": 50, "MNQ": 50},
    "tpt_50k":       {"ES": 3,  "NQ": 3,  "CL": 5,  "YM": 3,  "RTY": 3,  "GC": 3,  "MES": 30, "MNQ": 30},
    "apex_50k":      {"ES": 4,  "NQ": 4,  "CL": 10, "YM": 4,  "RTY": 4,  "GC": 4,  "MES": 40, "MNQ": 40},
    "tradeify_50k":  {"ES": 5,  "NQ": 5,  "CL": 10, "YM": 5,  "RTY": 5,  "GC": 5,  "MES": 50, "MNQ": 50},
}


def get_commission_per_side(firm_key: str, symbol: str) -> float:
    """Get per-side commission for a firm and symbol.

    Args:
        firm_key: Firm identifier (e.g., 'mffu_50k')
        symbol: Contract symbol (e.g., 'ES')

    Returns:
        Commission in dollars per side per contract

    Raises:
        ValueError: If firm_key or symbol is not found
    """
    if firm_key not in FIRM_COMMISSIONS:
        raise ValueError(
            f"Unknown firm '{firm_key}'. Valid: {sorted(FIRM_COMMISSIONS.keys())}"
        )
    commissions = FIRM_COMMISSIONS[firm_key]
    if symbol not in commissions:
        raise ValueError(
            f"Unknown symbol '{symbol}' for firm '{firm_key}'. "
            f"Valid: {sorted(commissions.keys())}"
        )
    return commissions[symbol]


def get_contract_cap(firm_key: str, symbol: str) -> int:
    """Get maximum simultaneous contracts for a firm and symbol.

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k')
        symbol: Contract symbol (e.g., 'ES')

    Returns:
        Max contracts allowed

    Raises:
        ValueError: If firm_key not found or no cap data
    """
    if firm_key not in FIRM_CONTRACT_CAPS:
        raise ValueError(
            f"No contract cap data for firm '{firm_key}'. "
            f"Available: {sorted(FIRM_CONTRACT_CAPS.keys())}"
        )
    caps = FIRM_CONTRACT_CAPS[firm_key]
    if symbol not in caps:
        raise ValueError(
            f"No contract cap for symbol '{symbol}' at firm '{firm_key}'. "
            f"Available: {sorted(caps.keys())}"
        )
    return caps[symbol]
