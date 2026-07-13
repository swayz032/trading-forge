# Prop Firm Rules Summary — Trading Forge KB Card

> **Loaded by:** `critic_evaluator`, `tournament_prosecutor`, `tournament_promoter`.
> **Purpose:** Compliance-aware critique. When a strategy is evaluated, the critic must ask "would this strategy survive each firm's rules?" without consulting a long full-text reference.
> **Source-of-truth:** `src/shared/firm-stage-rules.json`. This card is a SHORT
> digest tuned for prompt context. If a value conflicts with the JSON rule book,
> the JSON wins; use the two 2026 firm documents only for explanatory context.
> **Last updated:** 2026-07-12. SUPPORTED FIRMS: MFFU Builder + Topstep 50K ONLY.

## How `critic_evaluator` should use this

1. Read the strategy's reported metrics (max drawdown, max consecutive losers, single-day-pnl-as-percent-of-total, position size in contracts, overnight hold).
2. For each firm below, check evaluation and account-survival hard rules separately from payout eligibility.
3. Surface the firm-specific violations in `risk_flags` (e.g. `"violates_topstep_drawdown:max_dd_2400_exceeds_2000_limit"`).
4. Recommend the best-fit firm in `reasoning` if the strategy passes some firms but not others.
5. **Never approve a strategy as PASS if it fails the deterministic performance gates.**
   Payout eligibility can be not-yet-eligible without failing evaluation or account survival.

---

## Topstep

- **50K Combine:** $49/mo, $3,000 base target, $2,000 EOD trailing drawdown, 50 micros max, at least 2 trading days.
- **Best-day rule:** `effective_target = max($3,000, 2 × best_day_profit)`. A spike raises the target; it is recoverable and does not breach the account.
- **Funded / XFA:** $0 activation, $0 monthly, 90% split. Standard path (default): 5 winning days at $150+; Consistency path: 3 trade days with a 40% payout-window cap.
- **Drawdown style:** EOD trailing — locks at starting balance once HWM reaches it
- **Consistency rule:** dynamic Combine target; payout path requirements are separate from survival.
- **Min trading days:** 2
- **Daily loss limit:** $1,000 hard limit
- **Automation policy:** TopstepX API allowed, webhooks allowed, bots allowed; **VPS/VPN/remote BANNED** — must run on personal device (Skytech tower per Trading Forge ATS)
- **Platform:** TopstepX-only (as of Jan 12 2026 platform lockdown; NinjaTrader/Tradovate banned for new accounts)
- **Multi-account within one user:** Allowed (single Topstep subscription)
- **Copy trades within Topstep accounts:** Allowed (does NOT trigger collaborative-trading flag)
- **Overnight:** Not allowed (user constraint applies anyway)
- **Commission:** $0.62/side for MES/MNQ
- **Best for:** local TopstepX execution with a dynamic Combine target.
- **Avoid if:** Strategy needs > $2K drawdown; strategy routes through VPS/VPN
- **Automation friendliness:** 1.0 (most algo-permissive of any firm)

## MFFU (My Funded Futures)

- **50K Builder eval:** $77/mo, $3,000 target, $2,000 EOD drawdown with a $48,000 starting floor, 40 micros, minimum 1 day.
- **Sim-funded payout:** 80% split; $2,100 buffer; 2 qualifying days; 50% best-day condition; $500–$2,000 request range; 2-day cycle.
- **Drawdown / DLL:** EOD drawdown; $1,000 soft daily pause.
- **Consistency rule:** no evaluation or account-survival cap. The 50% condition is payout-only and recoverable.
- **Commission:** $0.95/side for MES/MNQ
- **Automation policy:** ATS via TradersPost / PickMyTrade — fully permissive
- **2026 MFFU-specific rules (enforced in code):**
  - **Collaborative trading BANNED:** identical or opposite strategies across unconnected accounts triggers compliance flag
  - **Same-device BANNED:** no shared computer/tablet/phone across multiple operator accounts — ⚠ CONFIG-FLAG / ADVISORY ONLY (firm-config `sameDeviceBanned:true`); there is NO runtime `instance_id`/device-collision check in code yet (single MFFU account today = no collision possible). Must be implemented before a 2nd MFFU account shares device proximity. See `docs/prop-firm-rules-2026-mffu.md` §4.
  - **Hedging same underlying BANNED:** MNQ+NQ, MES+ES, MCL+CL simultaneously is a violation
  - **Tier 1 economic data trading restricted:** FOMC/CPI/NFP ±30 min blackout enforced by default
  - **Simultaneous limits at same price BANNED:** paper engine must not fire duplicate limits at identical prices
  - **2% price limit rule:** single trade must not risk > 2% of account balance
  - **HFT cap:** max ~500 trades/day
  - **Slippage requirement:** minimum 2-tick MES slippage in simulation (no zero-slippage exploitation)
- **Best for:** Best ROI ($77/mo, $0 activation, 80% split). **Trading Forge's first-stop eval.**
- **Avoid if:** Strategy requires collaborative-trading, same-device shared infrastructure, or hedging same underlying
- **Automation friendliness:** 0.95

---

## Universal hard rules across both firms

These apply regardless of firm choice:

- `max_drawdown ≤ $2,000` for the active 50K evaluation accounts
- `max_consecutive_losers ≤ 4` (mental + drawdown survival)
- `avg_daily_pnl ≥ $250` where the deterministic performance gate applies
- `profit_factor ≥ 1.75` on out-of-sample data
- `sharpe_ratio ≥ 1.5`
- `winning_days_per_month ≥ 12 of 20`
- Overnight positions: **not allowed for any Trading Forge strategy** (user constraint, applies firm-wide)
- Weekend positions: not allowed

## Payout-stage conditions

Do not use a generic `profit_target + max_drawdown` buffer formula.

| Firm (50K) | Evaluation condition | Separate payout condition |
|---|---|---|
| Topstep | Dynamic Combine target + 2 days | Standard: 5 winning $150+ days; Consistency: 3 trade days + 40% cap |
| MFFU Builder | $3,000 target + 1 day | $2,100 buffer + 2 qualifying days + 50% best-day condition |

## Automation friendliness ranking

For Trading Forge's autonomous-execution-preferred posture:

1. **Topstep** (1.0) — primary ATS, local-only, TopstepX API
2. **MFFU** (0.95) — TradersPost / PickMyTrade, fully permissive

## Sources

- `src/shared/firm-stage-rules.json` — canonical active stage contract
- `docs/prop-firm-rules-2026-topstep.md` — Topstep explanatory reference
- `docs/prop-firm-rules-2026-mffu.md` — MFFU Builder explanatory reference
- `src/engine/firm_stage_rules.py` and `src/shared/firm-stage-rules.ts` — canonical evaluators
