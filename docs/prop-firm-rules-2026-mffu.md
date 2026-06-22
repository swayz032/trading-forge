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
| Trailing type | `eod` |
| Daily loss limit | `null` (no separate DLL — drawdown is the cap) |
| Max contracts | `50` micros (or 5 minis — Core/Flex/Rapid plans; Pro plan is 60 micros) |
| Min trading days | `5` |
| Min payout days | `5` |
| Consistency rule | `mffu_50pct` (best-day cannot exceed 50% of total P&L) |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | `$0.62` |
| Payout split (initial) | `0.80` (80% to trader) |
| Payout schedule | bi-weekly (every 14 days) |

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
max_contracts: 50  # micros at $50K Core/Flex/Rapid (5 minis × 10:1)
trailing: eod
payout_split: 0.80
min_payout_days: 5
min_trading_days: 5
consistency_rule_pct: 0.50
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

### 5. Tier-1 Economic Data Trading — Restricted

MFFU's tier-1 events are FOMC, CPI, NFP, GDP, Retail Sales, ISM, PPI.
Trading during the ±30-minute blackout around these events is restricted.

- **Enforcement:** `calendar_filter.py:check_economic_event` — already
  covers FOMC, CPI, NFP. **Extension required:** GDP, Retail Sales, ISM,
  PPI added to `_ECONOMIC_EVENTS` for 2026-2027.
- **Override:** strategies may set `bypass_news_blackout: true` (W14 / B11)
  to opt into trading during the window. Holidays still block.

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
