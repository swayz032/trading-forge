# MFFU 2026 Rules — Canonical Reference

> **Source of truth.** This document is parsed by `scripts/verify-2026-rules-compliance.mjs`.
> Code reads `src/shared/firm-stage-rules.json` through the Python and
> TypeScript stage-rule loaders. The `## Canonical Values` block below is
> checked against that rule book; evaluation, sim-funded, payout, and live
> rules must remain separate.
>
> Effective: 2026-01-01.
> Last reviewed: 2026-07-12.
> Evidence source: official [MFFU Builder 50K guide](https://help.myfundedfutures.com/en/articles/14290805-builder-plan-50k-a-comprehensive-guide), reviewed 2026-07-12.

---

## Account Profile (50K Standard)

| Field | Value |
|---|---|
| Account size | `$50,000` |
| Activation fee | `$0` (always — all firms) |
| Monthly fee | `$77` |
| Ongoing monthly fee (post-funded) | `$0` |
| Profit target | `$3,000` |
| Evaluation / sim-funded max drawdown | `$2,000` |
> **The operator's MFFU account is the BUILDER plan** (chosen 2026-06-23 — EOD trailing matches
> our risk model + 40-micro room (vs Pro's 5) + cheapest + path to a real live broker). Values
> below are MFFU **BUILDER 50K (Default)**.

| Trailing type | `eod` — **Builder** EOD trailing (Max EOD Drawdown / MLL $2,000; eval starting floor $48,000). The MLL locks permanently once it reaches **$100 above that stage's starting balance**: $50,100 in evaluation and $100 in sim-funded/live ledgers. |
| Daily loss limit | `$1,000` — **SOFT pause** (hit it and trading pauses for the day; the account SURVIVES, not a hard breach). |
| Max contracts | `40` micros (Builder = `4 mini / 40 micro`) — room for our pyramid base (6 MES / 6 MNQ / 18 MCL). |
| Min trading days | `1` (Builder eval 1-day minimum) |
| Min payout days | `2` qualifying days/cycle; Builder pays **every 48h** after buffer cleared |
| Payout buffer | `$2,100` (Default) / `$1,600` (Add-On); first payout needs `$500` above the buffer and the buffer must remain after the request; later payouts need `$500` net profit since the prior approved payout |
| Payout amounts | min `$500`, **max $2,000/cycle**, **5 sim payouts** then → live transition |
| Consistency rule | `50%` — **SIM-FUNDED payout stage ONLY** (NONE in eval, NONE on the live account) |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | MES/MNQ `$0.95` ($1.90 RT) · MCL `$0.58` ($1.16 RT) — per-symbol exact in `firm_config.py`; single firm value `$0.95` |
| Payout split | `0.80` (80/20 — eval + sim + live) |
| Live transition | after the **5th approved sim payout** → real brokerage account (Blue Row Capital), daily payouts, no consistency |
| News trading | **ALLOWED** (eval + sim funded) — Builder is NOT a T1-restricted plan |
| Active accounts | `1` Builder account per user |

## Canonical Values

This block is parsed verbatim by the lint script. Keys map to the canonical
stage rule book, not to a flattened legacy projection.

```yaml
firm_id: mffu
evaluation_account_size: 50000
evaluation_monthly_fee: 77
evaluation_activation_fee: 0
evaluation_profit_target: 3000
evaluation_max_drawdown: 2000
evaluation_trailing: eod
evaluation_locks_at_start: false
evaluation_trailing_lock_floor_offset: 100
evaluation_starting_floor: 48000
evaluation_daily_loss_limit: 1000
evaluation_daily_loss_behavior: soft_pause
evaluation_max_contracts: 40
evaluation_min_trading_days: 1
funded_account_type: sim_funded
funded_starting_balance: 0
funded_max_drawdown: 2000
funded_trailing: eod
funded_locks_at_start: false
funded_trailing_lock_floor_offset: 100
funded_daily_loss_limit: 1000
funded_daily_loss_behavior: soft_pause
funded_max_contracts: 40
funded_overnight_ok: false
funded_weekend_ok: false
payout_split: 0.80
payout_minimum_qualifying_days: 2
payout_buffer: 2100
payout_buffer_must_remain_after_request: true
payout_first_payout_profit_above_buffer: 500
payout_subsequent_minimum_profit_since_last_payout: 500
payout_minimum_hours_since_cycle_start: 48
payout_minimum_request: 500
payout_maximum_request: 2000
payout_cycle_days: 2
payout_maximum_consistency_ratio: 0.50
payout_resets_after_payout: true
payout_sim_payouts_to_live: 5
live_max_drawdown: 2000
live_trailing: eod
live_starting_balance: 0
live_locks_at_start: false
live_trailing_lock_floor_offset: 100
live_daily_loss_limit: 1000
live_daily_loss_behavior: soft_pause
live_max_contracts: 40
live_overnight_ok: false
live_weekend_ok: false
live_payout_split: 0.80
live_payout_minimum_request: 250
live_payout_cycle_days: 1
live_payout_cap: null
live_maximum_active_accounts: 1
live_post_breach_cooldown_days: 21
commission_per_side: 0.95
hft_max_trades_per_day: 500
two_percent_rule_pct: 0.02
baseline_slippage_ticks_mes: 2
```

---

## Hard 2026 Rules

These rules are enforced by code paths in `compliance_gate.py`,
`paper-signal-service.ts`, `paper-execution-service.ts`,
`correlated-position-guard.ts`, `calendar_filter.py`, and `slippage.py`.

### 1. High-Frequency Trading (HFT) — Not Allowed

MFFU prohibits sub-second order frenzies. The compliance gate enforces a
**hard cap** on `max_trades_per_session` (already wired through
`check_kill_switch`'s `MAX_TRADES` reason).

- **Enforcement:** `compliance_gate.check_kill_switch` with
  `max_trades_per_session` set per session; default cap is the firm's HFT
  ceiling.
- **Documented MFFU ceiling:** **500 trades/day** (any beyond classifies as HFT).
  Configured in `MFFU_HFT_MAX_TRADES_PER_DAY` constant.

### 2. Collaborative Trading — Banned

MFFU bans identical or opposite strategies across multiple unconnected accounts.

- **Detection:** When the same DSL fingerprint (sha256 of canonical DSL JSON,
  C9 W17 mechanism) is observed running on more than one MFFU account_id, the
  B14 `payout_denial` prior is elevated.
- **Enforcement layer:** B14 priors (advisory in Phase 0; hard tiebreaker in
  Phase 1).

### 3. Same-Device — Banned (⚠ RULE ONLY — no enforcement code exists yet)

Trading from a shared computer/tablet/phone is banned. Each MFFU account
must originate from a unique `instance_id`.

- **Current state (verified 2026-07-10, deep-scan #23):** there is no
  `instance_id` collision check anywhere in the codebase — `compliance_gate.py`'s
  `check_violation()` (the function this section used to claim owns the check)
  implements `vps_prohibited` (a real, separate rule — see §check below) but has
  no device/instance logic at all, and no route emits `compliance.same_device_violation`.
  This rule is currently enforced by operator process only (one MFFU account per
  physical device, by convention) — not by code.
- **Low exposure today:** the operator runs a single MFFU account, so no
  collision is possible yet. This becomes a real, unenforced risk the moment
  a second MFFU account (e.g. a family member's) is added on a shared or
  nearby device — implement the `instance_id` collision check before that
  rollout, don't rely on this doc's prior (inaccurate) claim.

### 4. Hedging Same Underlying — Banned

A position in MNQ + NQ at the same time = the same underlying = treated as
NQ. Same applies to MES↔ES and MCL↔CL.

- **Enforcement:** `correlation_matrix.yaml` includes pairs MNQ↔NQ,
  MES↔ES, MCL↔CL with correlation `1.00` (identical underlying).
  `correlated-position-guard.ts` blocks the second entry.
- **Defense-in-depth:** even though the operator currently trades only
  micros (NQ/ES/CL minis are deferred), the matrix is pre-loaded with
  these pairs so future graduation does not require a code change.

### 5. News Trading — Builder Plan Allowed

The selected account is **MFFU Builder 50K**, not Rapid. Builder permits news
trading during both evaluation and sim-funded stages; it is not a firm-level
Tier-1 hard-block. This reference must not use Rapid or Pro restrictions to
score Builder research, evaluation, funded survival, or payout eligibility.

The application may still impose calendar filters as its own risk-management
policy. Those filters are an operator safety choice, not a claim about a
Builder plan restriction. News-related manipulation strategies remain
prohibited by the firm's fair-play policy.

### 6. Simultaneous Limits at Same Price — Prohibited

Submitting two limit orders at identical price levels is prohibited
(treated as order-stuffing / spoofing).

- **Enforcement:** `paper-execution-service.ts` order submission checks
  for any open limit order at the same `(symbol, side, price)` and rejects
  the duplicate at submission time.

### 7. Slippage / Bracket Exploitation — Prohibited

Strategies may not assume zero slippage on MES (or any symbol).

- **Enforcement:** `slippage.py:compute_slippage` uses a 2-tick MES
  baseline (`MFFU_BASELINE_SLIPPAGE_TICKS_MES = 2`). The base_ticks
  parameter cannot be passed below this floor for MFFU code paths.

### 8. 2% Price Limit Rule

A bot must not breach 2% of account balance ($1,000 on a 50K account) in a
single trade.

- **Enforcement:** new gate in `compliance_gate.py:check_two_percent_rule`.
  Pre-order check; fails closed if intended max loss on the entry exceeds
  `MFFU_TWO_PERCENT_RULE_PCT * account_balance`.

### 9. Builder Payout Cycle + 80/20 Split

The selected MFFU **Builder** plan evaluates payout eligibility every **2 days
(48 hours)** after its two qualifying days are met. The first request needs
$500 above the $2,100 buffer and must leave that buffer intact; each later
cycle needs $500 net profit since the prior approved payout. The split is
80% / 20% (operator / firm). Its 50% best-day condition is a recoverable
**sim-funded payout** requirement only; it is not an evaluation, survival, or
live-account breach.

- **Modeling:** the canonical `payout` stage defines the two-day cycle, buffer,
  request range, consistency rule, reset behavior, and five-sim-payout live
  transition independently from evaluation and live rules.

### 10. Hedging Same Underlying (Reaffirmation)

Same as Rule 4 — listed twice in MFFU's policy text. The
`correlation_matrix.yaml` enforcement is the single source of truth.

---

## Fair Play & Prohibited Trading Practices (MFFU, 2025-11-24) — Coverage Map

How each MFFU prohibited practice maps to our enforcement. Most are compliant-by-design (we
model realistic execution and don't exploit the sim fill engine).

| MFFU rule | Our coverage |
|---|---|
| **§1 No HFT** | `hftMaxTradesPerDay` cap (firm-config) + operator's **1-2 A+ trades/day** mandate (`TF_MAX_TRADES_PER_DAY`) — orders of magnitude under any HFT threshold. ✅ |
| **§1 Automation allowed (no sim-fill exploit)** | The whole system is automated; we **model** realistic fills (slippage as f(vol, session); partial fills `fill_model.py`; commissions) — we do NOT exploit favorable sim fills. ✅ compliant-by-design |
| **§2 No multi-limit-at-same-price fill manipulation** | We place single structural entries (stop-limit), never stacked limits at one price to game fills. ✅ by-design |
| **§2 No gapped/illiquid isolated-fill profiteering** | Zero-volume / trade-critical-bar guard (`BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD`); per-symbol liquidity caps; partial-fill model on thin bars. ✅ |
| **§2 No slippage-absence / tight-bracket exploit** | We compute P&L manually with modeled slippage + symmetric exit slippage (never the sim's zero-slippage); structural stops, not tight brackets. ✅ by-design |
| **§2 T1 economic data** (firm-wide Fair Play) | **OVERRIDDEN on Builder** — the Builder Plan doc makes news FULLY UNRESTRICTED (see note below). Our T−5/+2 window + `macro_alignment` hard-block + news-policy `reduce_size` are kept as a **prudent risk default of ours**, not an MFFU requirement. ✅ |
| **§2 / §4 Collaborative trading ban** | `correlation_matrix.yaml` + collaborative-trading compliance; family runs DIFFERENT strategies per firm; per-account strategy assignment unique. ✅ |
| **§4 Own device / no copy-trading** | `compliance_gate` `vps_prohibited` ✅ operational. Same-device ban: ⚠ operator-process only today (single MFFU account, no collision possible yet) — no `instance_id` collision check exists in code; see §3 above. Must be implemented before a 2nd MFFU account (e.g. family) shares proximity to this one. |
| **§5 Hedging ban (same underlying, opposite side, same time — incl. MNQ+NQ)** | **NOW ENFORCED both ways:** cross-account (`checkCrossAccountHedge`) + **intra-account** (`checkIntraAccountHedge`, NEW 2026-06-23 — `hedgingSameUnderlyingBanned` flag now has teeth) via `symbolToUnderlying` collision at the entry gate (`paper-signal-service.ts` Tier 5.3.2 / 5.3.2b). Audit `compliance.intra_account_hedge_blocked`. ✅ |
| **§3 Termination / profit confiscation** | Consequence policy (informational) — our job is to never trigger §1-§5. |

**Note on §2 T1 + Builder (CORRECTED 2026-06-23):** the **Builder Plan doc explicitly OVERRIDES**
the firm-wide Fair Play "T1 restricted" line — for Builder, **news trading is FULLY UNRESTRICTED**
(eval + sim funded): "You may open and hold positions through any scheduled news event without
limitation." So T1 is **NOT a compliance restriction on Builder.** Our bot's news caution
(news-policy MFFU = `reduce_size`; `macro_alignment` hard-block; T−5/+2 entry window) is therefore
a **prudent RISK-MANAGEMENT default of OURS, not an MFFU requirement** — institutional desks avoid
FOMC, and the operator's 09:30–11:30 window dodges most T1 anyway. A strategy may opt into full
news trading on Builder via per-strategy `bypass_news_blackout=true`.

---

## Builder Operational Rules (2026-06-23 comprehensive guide)

| Rule | Detail / our handling |
|---|---|
| **EOD trailing lock** | MLL trails EOD highs ($2,000 distance), never moves down, and **locks permanently once it reaches $100 above the starting balance** in each stage (evaluation: $50,100; sim/live P&L ledgers: $100). Our `realizedPeakEquity` EOD model + floor-lock. Open-equity losses count at session close. |
| **Two MLL options** | **Default = $2,000 MLL / $48,000 floor** (configured) · Add-On = $1,500 MLL / $48,500 floor (cheaper, tighter). Everything else identical. ⚠️ confirm operator uses Default. |
| **$1,000 soft-pause DLL** | All 3 stages (eval/sim/live). Soft = pause for the day, account survives (not a breach). `daily_loss_limit=1000`. |
| **No overnight** | All positions auto-closed at session end (platform-enforced). Matches our **15:55 ET hard flatten**. `overnight_ok=false`. |
| **7-day inactivity (sim funded)** | No trade in 7 consecutive calendar days → sim account CLOSED. ⚠️ **Vacation-mode note:** autopilot must place ≥1 MFFU trade per 7 days, else the sim account closes. (Bot trades 1-2/day, so safe while running.) |
| **Live post-breach 21-day cooldown** | A LIVE breach → 21 calendar days: no sim trading, no new evals/resets. Our kill-switch (67% DLL halt / 95% force-close) exists to never breach. |
| **1 sim account per user** | Only one active Builder sim account; after a breach, a new one only the following trading day. |
| **50% consistency @ payout** | Single largest profit day ≤ 50% of cycle total, checked AT payout request, **resets after each approved payout**. Sim-funded stage only (none eval, none live). Opt-in lane during sim-funded phase. |
| **Trading hours** | MFFU: **18:00 → 16:10 ET** (6:00pm–4:10pm EST). Our RTH window (09:30–11:30) + 15:55 ET flatten sit well inside. |
| **Restricted products (temp, Feb 7)** | GC, SI, HG, PL, NG, QG (metals + nat gas) restricted; metals micros capped (50K → 5). **Our products MES/MNQ/MCL are NOT restricted** — no impact. |
| **Commissions (all-in RT ÷ 2)** | MES/MNQ **$0.95** ($1.90 RT) · MCL **$0.58** ($1.16 RT). Per-symbol exact in `firm_config.py` (was wrongly a flat $0.62). |

---

## Constants Used By Code

These names are referenced from `compliance_gate.py` and the lint script.
Do not rename without updating both.

```
MFFU_HFT_MAX_TRADES_PER_DAY        = 500
MFFU_TWO_PERCENT_RULE_PCT          = 0.02
MFFU_BASELINE_SLIPPAGE_TICKS_MES   = 2
MFFU_PAYOUT_CYCLE_DAYS             = 2
MFFU_PAYOUT_SPLIT                  = 0.80
```

---

## Tier-1 Event Coverage (For `calendar_filter.py`)

| Event | Time (ET) | Frequency |
|---|---|---|
| FOMC | 14:00 | 8/year |
| CPI | 08:30 | monthly (2nd Tue/Wed) |
| NFP | 08:30 | first Friday |
| GDP | 08:30 | quarterly (4 advance, 4 second, 4 third) |
| Retail Sales | 08:30 | monthly |
| ISM Manufacturing PMI | 10:00 | monthly (1st business day) |
| PPI | 08:30 | monthly |

---

## Out of Scope (Documented Elsewhere)

- TopstepX API integration (Topstep-only) — see
  `docs/prop-firm-rules-2026-topstep.md`.
- 9 legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade, Top One,
  YRM, FundingPips) — being removed in this Pass 1 by Track 2 agents.
  This document covers MFFU only.
