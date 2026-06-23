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
> **The operator's MFFU account is the PRO plan** (chosen 2026-06-23 — EOD trailing matches our
> risk model + no funded consistency). The values below are MFFU **PRO 50K**.

| Trailing type | `eod` — **PRO Sim Funded** EOD trailing (Max Loss EOD $2,000). After the FIRST payout the MLL moves to **$50,100 and stays STATIC** (stops trailing). Matches Topstep basis + our `realizedPeakEquity` model — no intraday build needed. |
| Daily loss limit | `null` (no DLL in Pro eval or sim funded) |
| Max contracts | ⚠️ `5` micros (Pro is `5 mini / 5 micro` — mini-oriented; **10× tighter than Rapid's 50**, BELOW our base 6 MES / 18 MCL). Pending operator confirm it's not a typo. |
| Min trading days | `2` (Pro eval, passable in as little as 2 days) |
| Min payout days | `14` (Pro: 14 calendar days from first trade + buffer cleared) |
| Payout buffer | `$2,100` realized profit (50K) before first payout. One-time pre-buffer withdrawal: up to 60% of profit, min $1,000. |
| Min payout request | `$1,000` (Pro); Max payout `$100,000`/user |
| Consistency rule | `50%` best-day cap — **EVAL ONLY** (none in Pro Sim Funded) |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | `$0.62` |
| Payout split | `0.80` (80/20 — Pro) |
| Payout schedule | after 14 days + $2,100 buffer cleared |
| T1 news trading | **NOT allowed** on Pro Sim Funded (news-policy MFFU hard-block enforces) |

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
max_contracts: 5  # ⚠️ PRO 50K = 5 micros (5 mini / 5 micro — mini-oriented; 10x tighter than Rapid). Pending operator confirm (not a typo). Binds micro sizing.
trailing: eod  # PRO Sim Funded = EOD trailing (Max Loss EOD $2,000); after first payout MLL static at $50,100
payout_split: 0.80  # Pro is 80/20 (Rapid is 90/10)
min_payout_days: 14  # Pro: 14 calendar days from first trade + $2,100 buffer cleared
min_trading_days: 2  # Pro eval passable in as little as 2 days
consistency_rule_pct: 0.50  # EVAL ONLY — none in Pro Sim Funded
daily_loss_limit: null
overnight_ok: false
weekend_ok: false
commission_per_side: 0.62
payout_cycle_days: 14
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
