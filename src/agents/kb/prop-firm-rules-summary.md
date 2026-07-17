# Prop Firm Rules Summary — Trading Forge KB Card

> **Loaded by:** `critic_evaluator`, `tournament_prosecutor`, `tournament_promoter`.
> **Purpose:** Compliance-aware critique. When a strategy is evaluated, the critic must ask "would this strategy survive each firm's rules?" without consulting a long full-text reference.
> **Source-of-truth:** `docs/prop-firm-rules.md`. This card is a SHORT digest tuned for prompt context. If a value here conflicts with `docs/prop-firm-rules.md`, the docs file wins.
> **Last updated:** 2026-07-17 (W3B firm-rule truth sweep — values re-synced to canonical `src/engine/firm_config.py` / `src/shared/firm-config.ts`: Topstep commission $0.37→$0.62, contract caps →50 micros Topstep / 40 micros MFFU Builder, Topstep consistency None→50% at Combine pass-request, MFFU re-based on the operator's BUILDER plan chosen 2026-06-23). SUPPORTED FIRMS: MFFU + Topstep ONLY.

## How `critic_evaluator` should use this

1. Read the strategy's reported metrics (max drawdown, max consecutive losers, single-day-pnl-as-percent-of-total, position size in contracts, overnight hold).
2. For each firm below, check whether the strategy violates any hard rule.
3. Surface the firm-specific violations in `risk_flags` (e.g. `"violates_topstep_drawdown:max_dd_2400_exceeds_2000_limit"`).
4. Recommend the best-fit firm in `reasoning` if the strategy passes some firms but not others.
5. **Never approve a strategy as PASS if it fails the universal performance gate** (avg_daily_pnl ≥ $250, win_rate_by_days ≥ 60%, profit_factor ≥ 1.75, max_drawdown ≤ $2,000) — those are hardcoded in `docs/prop-firm-rules.md` and apply BEFORE per-firm checks.

---

## Topstep

- **50K eval:** $49/mo fee, $3,000 target, $2,000 EOD trailing drawdown, 50 micros max (5 minis × 10:1)
- **Funded:** $0 activation, $0 monthly, 90% split from dollar one, $200 min payout; XFA per-request payout caps (standard $2K / $4K with-DLL, consistency $3K / $6K); LFA uncapped
- **Drawdown style:** EOD trailing
- **Consistency rule:** 50% best-day cap at Combine pass-request (canonical `topstep_50pct`)
- **Min trading days:** 5
- **Daily loss limit:** $1,000 (voluntary-DLL opt-in doubles XFA payout caps per Jun 2 2026 promo)
- **Automation policy:** TopstepX API allowed, webhooks allowed, bots allowed; **VPS/VPN/remote BANNED** — must run on personal device (Skytech tower per Trading Forge ATS)
- **Platform:** TopstepX-only (as of Jan 12 2026 platform lockdown; NinjaTrader/Tradovate banned for new accounts)
- **Multi-account within one user:** Allowed (single Topstep subscription)
- **Copy trades within Topstep accounts:** Allowed (does NOT trigger collaborative-trading flag)
- **Overnight:** Not allowed (user constraint applies anyway)
- **Commission:** $0.62/side MES/MNQ, $0.77 MCL (TopstepX all-in RT ÷ 2 — corrected 2026-06-23; $0.37 was stale)
- **Best for:** Cheapest eval, no consistency rule, fully automatable from local. **Trading Forge's primary ATS deployment.**
- **Avoid if:** Strategy needs > $2K drawdown; strategy routes through VPS/VPN
- **Automation friendliness:** 1.0 (most algo-permissive of any firm)

## MFFU (My Funded Futures)

- **Operator plan: BUILDER 50K (chosen 2026-06-23):** $77/mo, $3,000 target, $2,000 EOD trailing drawdown (Max EOD Drawdown / MLL; eval floor $48,000; MLL goes STATIC at $0 on live), **40 micros max** (4 minis / 40 micros), 80/20 split
- **Funded:** $0 activation, $0 monthly, $500 min payout, $2,000 per-request payout cap, bi-weekly payouts (Builder pays every 48h after the $2,100 buffer clears)
- **Drawdown style:** EOD trailing, locks at starting balance
- **Consistency rule:** 50% at the SIM-FUNDED payout stage only (canonical `mffu_50pct_sim_payout` — none at eval, none live)
- **Min trading days:** 1 (Builder eval)
- **Daily loss limit:** $1,000 (Builder — SOFT pause, account survives; not a breach)
- **Commission:** $0.95/side MES/MNQ, $0.58 MCL (MFFU all-in RT ÷ 2 — corrected 2026-06-29; the old flat $0.62 was TopstepX's value)
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

- `max_drawdown ≤ $2,000` for 50K accounts (Topstep is the binding constraint)
- `max_consecutive_losers ≤ 4` (mental + drawdown survival)
- `avg_daily_pnl ≥ $250` (universal performance gate, see `docs/prop-firm-rules.md`)
- `profit_factor ≥ 1.75` on out-of-sample data
- `sharpe_ratio ≥ 1.5`
- `winning_days_per_month ≥ 12 of 20`
- Overnight positions: **not allowed for any Trading Forge strategy** (user constraint, applies firm-wide)
- Weekend positions: not allowed

## Buffer phase math (both firms — $0 activation)

`buffer_required = profit_target + max_drawdown` — the total profit needed before first payout.

| Firm (50K) | Profit Target | Buffer | Total Before 1st Payout | Split |
|---|---|---|---|---|
| Topstep 50K | $3,000 | $2,000 (= maxDD) | **$5,000** | 90% |
| MFFU 50K Builder | $3,000 | $2,100 (canonical `payout_buffer`) | **$5,100** | 80% |

Days to first payout: at $500/day → 10 trading days. At $1,000/day → 5 days.

## Automation friendliness ranking

For Trading Forge's autonomous-execution-preferred posture:

1. **Topstep** (1.0) — primary ATS, local-only, TopstepX API
2. **MFFU** (0.95) — TradersPost / PickMyTrade, fully permissive

## Sources

- `docs/prop-firm-rules.md` — full per-firm rule reference
- Topstep Apr 14 2026 daily-loss-limit + drawdown locks update
- Topstep Jan 12 2026 platform lockdown (TopstepX-only)
- MFFU 2026 Core/Rapid/Pro restructure + collaborative-trading/same-device/hedging bans
- Trading Forge `src/engine/compliance/compliance_gate.py` — runtime enforcement
- Trading Forge `src/shared/firm-config.ts` — per-firm config (single source of truth)
