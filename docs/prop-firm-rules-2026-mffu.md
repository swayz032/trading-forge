# MFFU 2026 Rules — Canonical Reference

> **Source of truth.** This document is parsed by `scripts/verify-2026-rules-compliance.mjs`.
> Code in `src/engine/firm_config.py`, `src/shared/firm-config.ts`, and the
> compliance gates must match the values in the `## Canonical Values` block
> below. Drift triggers CI failure.
>
> Effective: 2026-01-01.
> Last reviewed: 2026-06-22.
> Evidence source: docs/institutional-evidence/firm-rules-freshness-2026-06-22.md

---

## Account Profile (50K Standard)

| Field | Value |
|---|---|
| Account size | `$50,000` |
| Activation fee | `$0` (always — all firms) |
| Monthly fee | `$77` |
| Ongoing monthly fee (post-funded) | `$0` |
| Profit target | `$3,000` |
| Max drawdown (also serves as buffer) | `$2,000` |
> **The operator's MFFU account is the BUILDER plan** (chosen 2026-06-23 — EOD trailing matches
> our risk model + 40-micro room (vs Pro's 5) + cheapest + path to a real live broker). Values
> below are MFFU **BUILDER 50K (Default)**.

| Trailing type | `eod` — **Builder** EOD trailing (Max EOD Drawdown / MLL $2,000; eval starting floor $48,000). **LIVE** account: $2,000 EOD trailing, MLL **static once it reaches $0**. Matches Topstep basis + our `realizedPeakEquity` model — no intraday build. |
| Daily loss limit | `$1,000` — **SOFT pause** (hit it and trading pauses for the day; the account SURVIVES, not a hard breach). |
| Max contracts | `40` micros (Builder = `4 mini / 40 micro`) — room for our pyramid base (6 MES / 6 MNQ / 18 MCL). |
| Min trading days | `1` (Builder eval 1-day minimum) |
| Min payout days | `2` qualifying days/cycle; Builder pays **every 48h** after buffer cleared |
| Payout buffer | `$2,100` (Default) / `$1,600` (Add-On) cleared before first payout |
| Payout amounts | min `$500`, **max $2,000/cycle**, **5 sim payouts** then → live transition |
| Consistency rule | `50%` — **SIM-FUNDED payout stage ONLY** (NONE in eval, NONE on the live account) |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | `$0.62` |
| Payout split | `0.80` (80/20 — eval + sim + live) |
| Live transition | after the **5th approved sim payout** → real brokerage account (Blue Row Capital), daily payouts, no consistency |
| News trading | **ALLOWED** (eval + sim funded) — Builder is NOT a T1-restricted plan |
| Active accounts | `1` Builder account per user |

## Canonical Values

This block is parsed verbatim by the lint script. Keys mirror the field names
in `firm_config.py:FIRM_RULES["mffu_50k"]` and
`firm-config.ts:FIRMS.mffu.accountTypes["50k"]`.

```yaml
firm_id: mffu
account_size: 50000
monthly_fee: 77
activation_fee: 0
ongoing_monthly_fee: 0
profit_target: 3000
max_drawdown: 2000
max_contracts: 40  # BUILDER 50K = 40 micros (4 mini / 40 micro) — room for our pyramid base
trailing: eod  # BUILDER = EOD trailing (Max EOD Drawdown $2,000; eval floor $48,000); LIVE MLL static once it reaches $0
payout_split: 0.80  # Builder 80/20 (eval + sim + live)
min_payout_days: 2  # Builder: 2 qualifying days/cycle; pays every 48h after buffer
min_trading_days: 1  # Builder eval 1-day minimum
consistency_rule_pct: 0.50  # 50% at the SIM-FUNDED payout stage only — NONE eval, NONE live
daily_loss_limit: 1000  # Builder $1,000 DLL — SOFT pause (account survives, not a breach)
overnight_ok: false
weekend_ok: false
commission_per_side: 0.62
payout_cycle_days: 2
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

### 3. Same-Device — Banned

Trading from a shared computer/tablet/phone is banned. Each MFFU account
must originate from a unique `instance_id`.

- **Surface:** compliance gate emits a warning in `check_violation()` when
  the runtime `instance_id` matches another active MFFU session.
- **Block path:** if `instance_id` collision is detected at `openPosition`,
  emit `compliance.same_device_violation` and block the order.

### 4. Hedging Same Underlying — Banned

A position in MNQ + NQ at the same time = the same underlying = treated as
NQ. Same applies to MES↔ES and MCL↔CL.

- **Enforcement:** `correlation_matrix.yaml` includes pairs MNQ↔NQ,
  MES↔ES, MCL↔CL with correlation `1.00` (identical underlying).
  `correlated-position-guard.ts` blocks the second entry.
- **Defense-in-depth:** even though the operator currently trades only
  micros (NQ/ES/CL minis are deferred), the matrix is pre-loaded with
  these pairs so future graduation does not require a code change.

### 5. Tier-1 News Trading — Restricted (current policy: MFFU Feb-2026)

> CORRECTION 2026-06-22: this section previously listed the T1 set as
> "FOMC, CPI, NFP, GDP, Retail Sales, ISM, PPI" with a ±30-min window. That was
> STALE and caused an over-block (GDP/ISM/PPI are NOT T1). The current MFFU News
> Policy (Feb 22, 2026) is below.

**Tier-1 (T1) events:**
- **All traders:** FOMC Meetings, **FOMC Minutes**, Employment Report (NFP), CPI
- **Energy traders:** **EIA** (Crude Oil Inventories — Wed 10:30 ET, holiday-adjusted;
  shifts to Thu 11:00 ET on Monday-holiday weeks). Affects CL/MCL only.
- **Agricultural traders:** Agricultural Reports (not our products — skip)

**Window:** **±2 minutes** flatten (NOT ±30). No position/order open T−2:00 → T+2:00
(e.g. news at 8:30 → flat by 8:28:00, may reopen after 8:32:00). The bot uses a safety
buffer: no NEW entry T−5 → T+2, flatten by T−2.

**Account types:**
- **Restricted (T1 trading PROHIBITED):** Rapid Sim Funded, Pro Sim Funded.
  *(The operator's MFFU account is a 50k Rapid plan → T1 hard-block.)*
- **Unrestricted (T1 allowed with ±2min flatten):** all evaluations, 25k/50k Flex Plans.

**NOT T1 (removed from blackout):** GDP, ISM, PPI, Retail Sales (no confirmed dates),
PCE. These trade normally.

- **Enforcement (Phase 1, 2026-06-22):** `calendar_filter.py` universal blackout =
  FOMC, FOMC_MINUTES, CPI, NFP (GDP/ISM/PPI removed). EIA staged in
  `economic_calendar.py::STATIC_EVENTS["EIA"]`, product-scoped (MCL) + firm-aware in
  Phase 2. Parity enforced by `npm run check:ts-python-tier1-parity`.
- **Phase 2 (pending):** firm-aware behavior — Topstep (PRIMARY/first-choice) =
  auto-reduce size (caution); MFFU Rapid (restricted) = hard-block T1. EIA product-scoped
  to MCL. Asymmetric T−5/−2/+2 window.
- **Override:** strategies may set `bypass_news_blackout: true` (W14 / B11). Holidays
  still block.
- **Prohibited (all news, all accounts):** straddles/strangles exploiting news bursts;
  masking news trades as standard strategies.

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

### 9. Bi-Weekly Payouts + 80/20 Split

MFFU pays out every 14 days at an 80% / 20% split (operator / firm).

- **Enforcement:** `firm_config.py` `mffu_50k.payout_split = 0.80`,
  `payout_cycle_days = 14`. `firm-config.ts` mirror.

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
| **§4 Own device / no copy-trading** | `compliance_gate` `vps_prohibited` + same-device ban (host must be local/personal-device); family onboarding = own device each. ✅ operational |
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
| **EOD trailing lock** | MLL trails EOD highs ($2,000 distance), never moves down, **locks permanently once it reaches $100 above the starting balance** (sim funded: locks at breakeven). Our `realizedPeakEquity` EOD model + floor-lock. Open-equity losses count at session close. |
| **Two MLL options** | **Default = $2,000 MLL / $48,000 floor** (configured) · Add-On = $1,500 MLL / $48,500 floor (cheaper, tighter). Everything else identical. ⚠️ confirm operator uses Default. |
| **$1,000 soft-pause DLL** | All 3 stages (eval/sim/live). Soft = pause for the day, account survives (not a breach). `daily_loss_limit=1000`. |
| **No overnight** | All positions auto-closed at session end (platform-enforced). Matches our **15:55 ET hard flatten**. `overnight_ok=false`. |
| **7-day inactivity (sim funded)** | No trade in 7 consecutive calendar days → sim account CLOSED. ⚠️ **Vacation-mode note:** autopilot must place ≥1 MFFU trade per 7 days, else the sim account closes. (Bot trades 1-2/day, so safe while running.) |
| **Live post-breach 21-day cooldown** | A LIVE breach → 21 calendar days: no sim trading, no new evals/resets. Our kill-switch (67% DLL halt / 95% force-close) exists to never breach. |
| **1 sim account per user** | Only one active Builder sim account; after a breach, a new one only the following trading day. |
| **50% consistency @ payout** | Single largest profit day ≤ 50% of cycle total, checked AT payout request, **resets after each approved payout**. Sim-funded stage only (none eval, none live). Opt-in lane during sim-funded phase. |

---

## Constants Used By Code

These names are referenced from `compliance_gate.py` and the lint script.
Do not rename without updating both.

```
MFFU_HFT_MAX_TRADES_PER_DAY        = 500
MFFU_TWO_PERCENT_RULE_PCT          = 0.02
MFFU_BASELINE_SLIPPAGE_TICKS_MES   = 2
MFFU_PAYOUT_CYCLE_DAYS             = 14
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
