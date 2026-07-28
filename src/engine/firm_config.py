"""Per-firm commission and contract cap data — Topstep + MFFU only.

Per CLAUDE.md §6: Only Topstep (PRIMARY) and MFFU (secondary) are in scope.
Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade, Top One, YRM Prop,
FundingPips) were removed from production scope on 2026-05-10 (DB migration
0097) and stripped from runtime config on 2026-05-19.

Don't use gross P&L for performance gates — use net P&L per firm.
Don't ignore firm contract caps in backtests.

VALUES ARE ALL-IN PER-SIDE (commission + exchange + NFA regulatory) = round-turn ÷ 2.
The backtester applies `commission_per_side × size × 2` with NO separate exchange/NFA add —
so these MUST be the full all-in per-side cost, not the commission component alone.
"""

from __future__ import annotations

# ─── Per-Firm Commissions (ALL-IN per side, per contract) ───────────────
# Source: each firm's official 2026 fee schedule (all-in round-turn ÷ 2).

FIRM_COMMISSIONS: dict[str, dict[str, float]] = {
    # 2026-06-23 CORRECTION: Topstep rates were $0.37/side (too low — under-costed every
    # Topstep backtest). Replaced with the AUTHORITATIVE TopstepX/ProjectX fee schedule
    # (all-in round-turn ÷ 2). Micros (MES/MNQ/MCL) are active. Minis (ES/NQ/CL) are Phase 5
    # (≥$200K, CLAUDE.md §5) — note minis are ~3× micros, NOT 10× (commissions don't scale
    # with notional; the old 10×-micro assumption was wrong).
    # TopstepX round-turn (RT): MES/MNQ $1.24, MCL $1.54, ES/NQ $3.80, CL $4.04.
    "topstep_50k": {
        # Micros (RT ÷ 2)
        "MES": 0.62, "MNQ": 0.62, "MCL": 0.77,
        # Minis (Phase 5) — ES/NQ $3.80 RT, CL $4.04 RT
        "ES": 1.90, "NQ": 1.90, "CL": 2.02,
    },
    "mffu_50k": {
        # 2026-06-23 CORRECTION: MFFU rates were a flat $0.62 (wrong — that's TopstepX's MES
        # value, not MFFU's). Replaced with MFFU's authoritative instrument list (all-in
        # round-turn ÷ 2): MES/MNQ $1.90 RT, MCL $1.16 RT, ES/NQ $4.68 RT, CL $4.92 RT.
        # Note MFFU MES/MNQ ($0.95) are PRICIER than TopstepX ($0.62) but MCL ($0.58) is cheaper.
        # Micros (RT ÷ 2)
        "MES": 0.95, "MNQ": 0.95, "MCL": 0.58,
        # Minis (Phase 5) — ES/NQ $4.68 RT, CL $4.92 RT
        "ES": 2.34, "NQ": 2.34, "CL": 2.46,
    },
}


# ─── Per-Firm Contract Caps (max simultaneous MICRO contracts) ───
# 2026 actual published rules (verified 2026-05-19 against Topstep + MFFU
# help center pages, not stale internal docs):
#
#   Topstep $50K Combine + Funded:  5 minis OR 50 micros (10:1 ratio)
#   MFFU $50K (Core / Flex / Rapid): 5 minis OR 50 micros
#   MFFU $50K Pro:                   6 minis OR 60 micros
#
# We run MICRO contracts (MES/MNQ/MCL) only — the mini equivalents
# (ES/NQ/CL) are deferred until single-account balance ≥ $200K per
# CLAUDE.md §5 Phase 5. So the per-symbol cap is the micro cap.

FIRM_CONTRACT_CAPS: dict[str, dict[str, int]] = {
    "topstep_50k": {"MES": 50, "MNQ": 50, "MCL": 50},
    # MFFU BUILDER 50K = 40 micros (4 minis / 40 micros). Room for our pyramid base (6/6/18).
    "mffu_50k":    {"MES": 40, "MNQ": 40, "MCL": 40},
}

# Hard bounds: min 0, max 60 (MFFU Pro). ATR sizing is clamped to this range.
CONTRACT_CAP_MIN = 0
CONTRACT_CAP_MAX = 60


# ─── Scaling Doctrine (R-059, 2026-07-19) — size-upgrade ladder is FICTION ────
#
# The former SCALING_PLANS (50K→100K@$5K profit, 100K→150K@$10K, MFFU→200K@$15K)
# described a mechanism where ONE funded account grows in SIZE as cumulative
# profit crosses dollar thresholds. **This does not exist at Topstep.** Verified
# against Topstep's own "Express Funded Account Parameters" help page (primary,
# fetched 2026-07-19): *"No. Your size matches the Trading Combine you passed and
# is locked before and after activation."* Account size is LOCKED to the Combine
# passed — to trade a bigger account you must pass a separate, larger Combine.
# Corroborated independently by h2tfunding (2025-11-10). One contradicting source
# (Futureshive, claiming auto-upgrade to a $250K size) is REJECTED — Topstep
# publishes exactly 3 sizes ($50K/$100K/$150K), never $250K.
#
# The REAL scaling model (canonical — CLAUDE.md §1/§4/§5):
#   • Within-account: the micro-contract PYRAMID (base 9 MES / 9 MNQ / 18 MCL,
#     +3 per proven-trades tier, risk-bounded, 50-micro ceiling). Position size
#     grows; account SIZE does not.
#   • Cross-account (HORIZONTAL): up to ~5 active funded accounts per trader
#     (pass a Combine per account), copy-scaled — this is the income growth path.
#   • LFA stage only: Dynamic Live Risk Expansion (6 cumulative-profit tiers,
#     $20K–$1M, 10 Active Trading Days each) — a DLL/position ladder, not an
#     account-size upgrade, and only after going live-funded.
#
# The fictional dict is REMOVED (it was unconsumed anywhere in code — only its
# own definition; verified by repo-wide grep 2026-07-19). Kept as an empty dict
# so any lingering `from firm_config import SCALING_PLANS` import does not break.
# Do NOT repopulate with size-upgrade tiers — that regresses R-059.
SCALING_PLANS: dict[str, list[dict]] = {}


# ─── Initial Contract Caps (starting limits before scaling) ──────
INITIAL_CONTRACT_CAPS: dict[str, int] = {
    "topstep_50k": 50,  # 50 micros at $50K Combine + Funded
    "mffu_50k": 40,     # MFFU BUILDER 50K = 40 micros (4 minis / 40 micros)
}


# ─── Full Firm Rules (mirrors src/shared/firm-config.ts) ─────────
# ★ NOT a single source of truth, and the two lines that follow always said so -- the
# headline claimed more than its own footnote allowed, so the headline is corrected rather
# than the footnote deleted (R-306 §5 false-safeguard class sweep; this read "Single source
# of truth for Python code"). WHAT IS TRUE: this is the RICHEST Python table and the one to
# prefer. WHAT IS NOT: prop_compliance.py::FIRM_CONFIGS re-types a subset of the same rules
# (monthly_fee 85, profit_target 3000, max_drawdown 2000, trailing, payout_split, ...) and
# imports only FIRM_COMMISSIONS from here -- so those values live in two Python literals and
# nothing enforces agreement. Keep in sync with TypeScript shared config AND with
# prop_compliance.py; all three are hand-synced.

FIRM_RULES: dict[str, dict] = {
    "topstep_50k": {
        "account_size": 50_000,
        # 2026-07-19 (R-054/R-056 compliance refresh): Combine monthly fee corrected
        # $49 -> $85 (operator live-page primary source; 100K=$129, 150K=$199).
        "monthly_fee": 85,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        "max_contracts": 50,  # 50 micros (10:1 mini ratio) at $50K
        "trailing": "eod",
        "payout_split": 0.90,
        "min_payout_days": 5,
        "min_trading_days": 5,
        "consistency_rule": "topstep_50pct",   # 50% best-day cap at Combine pass-request; same threshold as MFFU eval
        "daily_loss_limit": 1000,
        "overnight_ok": False,
        "weekend_ok": False,
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-topstep.md)
        "platform_lockdown_date": "2026-01-12",   # NinjaTrader/Tradovate banned
        "required_platform": "topstepx",           # TopstepX API only
        "allows_vps": False,                        # Personal device only
        "allows_vpn": False,
        "allows_remote_desktop": False,
        "multi_account_within_user_allowed": True,  # Multiple accounts under one user_id
        "copy_trades_within_user_allowed": True,    # Same strategy across own accounts OK
    },
    "mffu_50k": {
        "account_size": 50_000,
        "monthly_fee": 77,
        "activation_fee": 0,
        "ongoing_monthly_fee": 0,
        "profit_target": 3000,
        "max_drawdown": 2000,
        # 2026-06-23: operator chose the MFFU BUILDER plan. Builder = EOD trailing + 40 micros
        # (room for our pyramid, unlike Pro's 5) — best fit for the micro bot.
        "max_contracts": 40,  # Builder: 4 minis / 40 micros (eval + sim funded)
        # Builder Sim Funded = EOD trailing drawdown (Max EOD Drawdown / MLL $2,000; eval starting
        # floor $48,000) — matches Topstep basis + our realizedPeakEquity model (NO intraday build).
        # LIVE account: $2,000 EOD trailing, MLL STATIC once it reaches $0. NEWS TRADING ALLOWED.
        "trailing": "eod",
        "starting_floor": 48_000,      # Builder eval starting floor ($50K − $2K)
        "payout_split": 0.80,          # Builder 80/20 (eval + sim + live)
        "min_payout_days": 2,          # Builder: 2 qualifying days/cycle; pays every 48h after buffer
        "payout_buffer": 2100,         # $2,100 buffer cleared before first payout
        "min_payout": 500,             # Builder min payout $500 (max $2,000/cycle, 5 sim payouts → live)
        "min_trading_days": 1,         # Builder eval 1-day minimum
        "consistency_rule": "mffu_50pct_sim_payout",  # 50% at the SIM-FUNDED payout stage only; NONE eval, NONE live
        "daily_loss_limit": 1000,      # Builder $1,000 DLL — SOFT pause (account survives, not a breach)
        "overnight_ok": False,
        "weekend_ok": False,
        # Builder: news trading ALLOWED (eval + sim funded) — news-policy MFFU should NOT hard-block.
        # 2026-compliance (canonical: docs/prop-firm-rules-2026-mffu.md)
        "payout_cycle_days": 2,  # Builder: every 48h after buffer cleared (5 sim payouts → live)
        # consistency_window_days=None. NOTE (deepscan5 2026-06-29): MFFU consistency
        # (mffu_50pct_sim_payout) applies ONLY at the discrete sim-funded payout stage — NONE at
        # eval, NONE live. The B14 eval+funded survival sim does NOT model that discrete payout
        # gate, so monte_carlo.simulate_firm_survival EXPLICITLY SKIPS MFFU consistency (see the
        # `firm_key == "mffu_50k"` skip there, mirroring the Topstep standard-lane skip). This
        # window value is therefore inert for mffu_50k today; it is retained for the day the
        # sim-payout stage is modeled as a distinct event. (Prior comment wrongly claimed a
        # full-path fallback runs — it does not, because the rule is skipped upstream.)
        "consistency_window_days": None,
    },
}


# ─── Payout Caps (XFA / per-request withdrawal limits) ──────────
#
# Topstep XFA per-request payout election — TWO options, caps by account size.
# Source reconciliation (R-056/R-057/R-058.2 — files lead, web confirms):
#
#   GOVERNING (operator live-page primary, 2026-07-19) = the WITH voluntary-DLL
#   caps below (`with_dll`). The operator has opted into the voluntary Daily Loss
#   Limit at Combine checkout, so their live page shows the doubled caps:
#       Standard:    $4,000 / $6,000 / $10,000   ($50K / $100K / $150K)
#       Consistency: $6,000 / $8,000 / $12,000
#
#   BASE (voluntary DLL toggle NOT added), Topstep Help-Center Payout Policy page
#   (primary, fetched 2026-07-19, help.topstep.com/en/articles/8284233):
#       Standard:    $2,000 / $3,000 / $5,000
#       Consistency: $3,000 / $4,000 / $6,000
#
# The voluntary Daily Loss Limit is a SEPARATE, limited-time checkout add-on — it
# is NOT a prerequisite for the Consistency election (Topstep Payout Policy page,
# fetched 2026-07-19 — PARAPHRASE, not a verbatim quote: the DLL is a separate
# add-on, not required for the Consistency option, that raises payout caps when
# added at Combine purchase). It DOUBLES the base cap — a claim independently
# proven by the exact-2× cap table above. See docs/prop-firm-rules-2026-topstep.md §10.
#
# NOTE: the R-054 order-text aggregator's "$2K/$3K cut" figure coincides with the
# $50K BASE row here; it is NOT the operator's plan value (operator is DLL-opted =
# the with_dll/governing caps). Per-request withdrawal is additionally capped at
# 50% of account balance (Topstep help page), applied downstream, not modeled here.
#
# Live Funded Account (LFA) is uncapped — sentinel None. MFFU: flat $2,000.
# Conservative default: dll_opted_in=False → base cap (never assume doubled cap).

# size → payout election → {base (no DLL toggle), with_dll (governing, DLL added)}
TOPSTEP_XFA_PAYOUT_CAPS: dict[str, dict[str, dict[str, int]]] = {
    "50k":  {"standard": {"base": 2000, "with_dll": 4000},
             "consistency": {"base": 3000, "with_dll": 6000}},
    "100k": {"standard": {"base": 3000, "with_dll": 6000},
             "consistency": {"base": 4000, "with_dll": 8000}},
    "150k": {"standard": {"base": 5000, "with_dll": 10000},
             "consistency": {"base": 6000, "with_dll": 12000}},
}

# LFA is uncapped; use None as the sentinel for "no cap enforced".
TOPSTEP_LFA_PAYOUT_CAP: None = None

# MFFU: single flat cap, no promo.
MFFU_PAYOUT_CAP: int = 2000

# Minimum withdrawal per payout request (Topstep help-center, 2026-07-19).
TOPSTEP_MIN_PAYOUT_USD: int = 125

# "Minimum Payout Balance" — SECOND payout condition, effective 2025-12-30.
# Every payout AFTER the first requires BOTH (1) the path's winning-days count
# (5 Standard / 3 Consistency) AND (2) the account remained net-profitable since
# the last payout. The first payout still needs only condition (1). Represented
# here for documentation/analytics — not a signal-time gate. See doc §12.
TOPSTEP_MIN_PAYOUT_BALANCE_RULE: dict = {
    "effective_date": "2025-12-30",
    "applies_to": "every payout after the first",
    "conditions": (
        "winning-days requirement AND net-profitable-since-last-payout",
    ),
}

# ─── LFA 20%/80% Reserve System (ADD; effective 2026-02-10; Live-Funded stage) ──
# A freshly-activated Live Funded Account starts with only 20% of its nominal
# balance TRADEABLE; 80% is held in Reserve, released in 4 equal 25% increments.
# Each unlock is gated on NET PROFIT SINCE THE LAST UNLOCK (not cumulative from
# zero): $3,000 per unlock on $50K, $6,000 on $100K, $9,000 on $150K (mirrors the
# Combine profit-target ladder). Unlocks reviewed ≤ once/calendar week. Minimum
# starting LFA balance $10,000. Source: Topstep Live Funded Account Parameters +
# Live Funded Account Rules (primary, 2026-07-19). See doc §11.
#
# ⚠ DRAWDOWN_ROOM sizing implication (pre-live — NO live default changed here):
# a "$50K LFA" is NOT a $50K risk base on day one — it is a $10K tradeable base
# with $40K locked. Any DRAWDOWN_ROOM / contract-count sizing that assumes the
# full LFA balance will OVERSIZE a freshly-live account. The bot is Combine/XFA
# stage today (not LFA), so this is represented but does not alter live sizing.
TOPSTEP_LFA_RESERVE: dict = {
    "effective_date": "2026-02-10",
    "tradeable_pct_at_activation": 0.20,
    "reserve_pct_at_activation": 0.80,
    "unlock_increments": 4,
    "unlock_pct_each": 0.25,
    "net_profit_per_unlock_by_size": {"50k": 3000, "100k": 6000, "150k": 9000},
    "unlock_review_cadence": "at most once per calendar week",
    "min_starting_balance": 10000,
}


def get_payout_cap(
    firm_key: str,
    account_stage: str,       # "xfa" | "lfa"
    payout_path: str = "standard",   # "standard" | "consistency"
    dll_opted_in: bool = False,
    account_size: str = "50k",       # "50k" | "100k" | "150k"
) -> int | None:
    """Return the max payout per withdrawal request for a given account/path combination.

    Args:
        firm_key:      Firm identifier ("topstep_50k" or "mffu_50k").
        account_stage: "xfa" (Express Funded Account) or "lfa" (Live Funded Account).
        payout_path:   "standard" or "consistency" (Topstep XFA election options).
        dll_opted_in:  Whether the account holder added the voluntary Daily Loss
                       Limit at Combine checkout. Only affects Topstep XFA. Default
                       False = base cap (conservative — never assume the doubled cap).
                       The operator's GOVERNING live-page caps correspond to
                       dll_opted_in=True.
        account_size:  "50k" | "100k" | "150k" (Topstep XFA). Default "50k".

    Returns:
        Maximum payout in USD, or None for "uncapped" (Topstep LFA).

    Raises:
        ValueError: Unknown firm_key, account_stage, payout_path, or account_size.
    """
    if firm_key == "topstep_50k":
        if account_stage == "lfa":
            return TOPSTEP_LFA_PAYOUT_CAP  # None — uncapped
        if account_stage == "xfa":
            size_caps = TOPSTEP_XFA_PAYOUT_CAPS.get(account_size)
            if size_caps is None:
                raise ValueError(
                    f"Unknown account_size '{account_size}' for Topstep XFA. "
                    f"Valid: {sorted(TOPSTEP_XFA_PAYOUT_CAPS.keys())}"
                )
            caps = size_caps.get(payout_path)
            if caps is None:
                raise ValueError(
                    f"Unknown payout_path '{payout_path}' for Topstep XFA. "
                    f"Valid: {sorted(size_caps.keys())}"
                )
            return caps["with_dll"] if dll_opted_in else caps["base"]
        raise ValueError(
            f"Unknown account_stage '{account_stage}'. Valid: 'xfa', 'lfa'."
        )

    if firm_key == "mffu_50k":
        # MFFU has no voluntary-DLL promo; dll_opted_in is ignored.
        return MFFU_PAYOUT_CAP

    raise ValueError(
        f"Unknown firm_key '{firm_key}'. Valid: 'topstep_50k', 'mffu_50k'."
    )


# ─── Public helpers (consumed by backtester.py and others) ────────

def get_commission_per_side(firm_key: str, symbol: str) -> float:
    """Get per-side commission for a firm and symbol.

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k', 'mffu_50k')
        symbol: Micro contract symbol (e.g., 'MES', 'MNQ', 'MCL')

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
    """Get max simultaneous MICRO contracts for a firm and symbol.

    Returns the firm's per-symbol cap, clamped to
    [CONTRACT_CAP_MIN, CONTRACT_CAP_MAX] = [0, 60] (Topstep + MFFU
    micro range — MFFU Pro is the max at 60).

    Args:
        firm_key: Firm identifier (e.g., 'topstep_50k', 'mffu_50k')
        symbol: Micro contract symbol (e.g., 'MES', 'MNQ', 'MCL')

    Returns:
        Max contracts allowed (clamped to CONTRACT_CAP_MIN..CONTRACT_CAP_MAX)

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
    raw = caps[symbol]
    return max(CONTRACT_CAP_MIN, min(raw, CONTRACT_CAP_MAX))
