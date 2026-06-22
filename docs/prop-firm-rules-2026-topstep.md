# Topstep 2026 Rules — Canonical Reference

> **Source of truth.** This document is parsed by `scripts/verify-2026-rules-compliance.mjs`.
> Code in `src/engine/firm_config.py`, `src/shared/firm-config.ts`,
> `network-failover.ts`, and the compliance gates must match the values in
> the `## Canonical Values` block below. Drift triggers CI failure.
>
> Effective: 2026-01-12 (TopstepX-only platform lockdown).
> Last reviewed: 2026-06-22.
> Promo added: 2026-06-02 (voluntary-DLL doubles XFA payout cap).
> Evidence source: docs/institutional-evidence/firm-rules-freshness-2026-06-22.md

---

## Account Profile (50K Combine + Funded)

| Field | Value |
|---|---|
| Account size | `$50,000` |
| Activation fee | `$0` (always — all firms) |
| Monthly fee (Combine) | `$49` |
| Ongoing monthly fee (post-funded) | `$0` |
| Profit target | `$3,000` |
| Max drawdown (trailing) | `$2,000` |
| Trailing type | `eod` (locks at HWM = starting balance) |
| Daily loss limit | `$1,000` (opt-in at checkout per April 2026 update) |
| Max contracts | `50` micros (or 5 minis — TopstepX 10:1 ratio per scaling plan) |
| Min trading days | `5` |
| Min payout days | `5` |
| Consistency rule | `0.50` (50% best-day cap at Combine pass-request; XFA Consistency Path uses 40% cap) |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | `$0.37` |
| Payout split | `0.90` (90% to trader) |

## Canonical Values

This block is parsed verbatim by the lint script. Keys mirror the field
names in `firm_config.py:FIRM_RULES["topstep_50k"]` and
`firm-config.ts:FIRMS.topstep.accountTypes["50k"]`.

```yaml
firm_id: topstep
account_size: 50000
monthly_fee: 49
activation_fee: 0
ongoing_monthly_fee: 0
profit_target: 3000
max_drawdown: 2000
max_contracts: 50  # micros at $50K Combine + Funded (5 minis × 10:1)
trailing: eod
payout_split: 0.90
min_payout_days: 5
min_trading_days: 5
consistency_rule_pct: 0.50  # 50% best-day cap enforced at Combine pass-request (eval phase); XFA Consistency Path uses 40%
daily_loss_limit: 1000
overnight_ok: false
weekend_ok: false
commission_per_side: 0.37
platform_lockdown_date: "2026-01-12"
required_platform: topstepx
allows_vps: false
allows_vpn: false
allows_remote_desktop: false
multi_account_within_user_allowed: true
copy_trades_within_user_allowed: true
```

---

## Hard 2026 Rules

### 1. TopstepX API — Single Allowed Platform

Effective **January 12, 2026**, Topstep banned NinjaTrader and Tradovate
execution paths. **TopstepX API is the only permitted execution platform.**

- **Pricing:** $14.50/month (use promo code "topstep" for the discount).
- **Enforcement:** `firm_config.py` Topstep entry has
  `required_platform = "topstepx"`. The broker router (B6 in Pass 2 Track 4)
  rejects any non-TopstepX execution attempt for Topstep accounts.

### 2. Personal Device Only — No VPS / VPN / Remote Desktop

Topstep prohibits orders originating from cloud or remote infrastructure.
**No Railway cloud failover for Topstep code paths.**

- **Enforcement:** `network-failover.ts` — Topstep sessions must NOT use
  the B6 cloud failover. The `failoverAllowedForFirm(firmId)` helper
  returns `false` for Topstep. Existing C6/C7/C8 safety probes still run
  (those don't execute orders).
- **Compliance gate:** `compliance_gate.check_violation` already enforces
  `vps_prohibited` for Topstep; the `host` must be `local`,
  `skytech-tower`, or `personal-device`.

### 3. Multi-Account Within One User — Allowed

A single Topstep subscription covers multiple accounts under the same
user_id. The B5 multi-firm eligibility logic must allow multiple Topstep
account_ids under a single operator's user_id.

- **Enforcement:** `multi-firm-promotion-service.ts` — when computing
  eligibility, multiple Topstep account_ids under the same operator
  user_id are NOT counted as separate firms; they share the firm-level
  rule set.

### 4. Copy Trades Across Accounts — Allowed (within Topstep)

The operator may copy the same strategy across all of their own Topstep
accounts. **The correlated-position guard MUST NOT block** when the open
position is on a different Topstep account_id under the same user_id but
the same strategy.

- **Enforcement:** `correlated-position-guard.ts` checks position uniqueness
  by `(symbol, account_id)`; same-strategy across multiple Topstep
  accounts under the operator's user_id passes through.

### 5. January 12, 2026 — Platform Lockdown

Pre-2026-01-12 NinjaTrader/Tradovate execution paths must NOT be assumed
in any Topstep code path. The B14 prior `platform_unavailable` is elevated
for Topstep accounts that attempted non-TopstepX execution before the
lockdown date (historical only — not relevant for forward operation).

### 6. Trailing Drawdown — EOD, Locks At Starting Balance

Topstep's trailing drawdown locks at the original starting balance once
HWM reaches it. For 50K: floor starts at $48K, trails up with HWM, **locks
at $50K** once HWM ≥ $50K.

- **Enforcement:** existing `paper-execution-service.ts` trailing-drawdown
  computation uses `trailing="eod"` and respects the lock.

### 7. Daily Loss Limit — Opt-In At Checkout

Per April 2026 update: DLL is no longer always-on; selected at purchase.
**Trading Forge always opts into DLL** for prudent risk control; treats
it as enabled by default.

- **Enforcement:** `firm_config.py` `topstep_50k.daily_loss_limit = 1000`
  (always-on Trading Forge default).

### 8. Consistency Rule — 50% Best-Day Cap (Combine Evaluation)

**Effective: 2026 (confirmed by 5 independent sources as of 2026-06-22).**

In the Trading Combine (evaluation phase), no single trading day's profit may
exceed 50% of total cycle profit. Evaluated at pass-request time as a look-back
across the full evaluation window.

The XFA (funded account) has a SEPARATE consistency rule only on the
**Consistency Path**: best day cannot exceed 40% of total payout-window profit.
The **Standard Path** has no percentage consistency rule (only the 5 winning days
requirement). The funded stage has no consistency rule on the Standard Path.

- **Enforcement:** `firm_config.py` `topstep_50k.consistency_rule = "topstep_50pct"`.
  `prop_compliance.py:run_prop_compliance()` now applies `check_tpt_consistency()`
  to Topstep simulations identically to MFFU (generalized `"50pct"` string match).
- **Sources:** Vigil 2026-03-21, PropTradingVibes 2026-04-28, Tradecovex 2026-04-09,
  Backtrex 2026-06-07, TheTraderStack 2026-06-18 (5 corroborating sources).

### 9. XFA Two-Path Split — Effective 2026-02-05

Since February 5, 2026, the Express Funded Account (XFA — the funded stage after
passing the Combine) offers two payout paths. Operators choose at account activation.

| Path | Winning Days Required | Min P&L per Day | Consistency Cap |
|---|---|---|---|
| **Standard Path** | 5 winning days | $150 per day | None |
| **Consistency Path** | 3 trading days | (any) | ≤ 40% single-day cap |

**Trading Forge default:** Standard Path (5 winning days at $150+). `min_payout_days = 5`
reflects Standard Path. If operator switches to Consistency Path, update
`min_payout_days = 3` in `firm_config.py` + `prop_compliance.py` + `firm-config.ts`.

- **Sources:** Tradecovex 2026-04-09 + 2026-04-28, Backtrex 2026-06-07.

### 10. Payout Caps — Base Caps (Reduced April 28, 2026) + Voluntary-DLL Doubled Caps (June 2, 2026)

For accounts created **after April 28, 2026**, the **base** payout caps on the $50K plan are:

| Path | Base Cap | With Voluntary DLL (effective 2026-06-02) |
|---|---|---|
| Standard Path | **$2,000** | **$4,000** |
| Consistency Path | **$3,000** | **$6,000** |

The doubled cap applies when the account holder elected the voluntary Daily Loss
Limit (DLL) at Combine checkout **before** June 2, 2026 promo effective date or
any subsequent re-purchase. Accounts created before April 28, 2026 retain the
higher pre-Apr-28 base caps ($5,000/$6,000) — the doubling promo applies on top
of whichever base cap applies to the account's creation date.

**Live Funded Account (LFA): uncapped** regardless of DLL opt-in or account tier.

**MFFU payout cap: $2,000 flat** — this is a Topstep-only promo; MFFU is NOT
affected and its cap does not double.

**Operator status:** operator IS opting into the voluntary DLL for their Topstep
account(s). The `dll_opted_in` flag on `broker_accounts` drives which cap the
system models per account.

**Safety note:** the voluntary DLL dollar amount elected at checkout must be
**at or above the firm DLL we model** ($1,000 on a $50K account) so that our
67% halt threshold ($670) fires before Topstep's voluntary DLL. Operator must
confirm the exact $ amount chosen at Combine checkout.

- **Not codified in CI-checked fields** — payout cap is a withdrawal policy, not
  a gate enforced at signal time. Modeled via `getPayoutCap()` in `firm-config.ts`
  and `get_payout_cap()` in `firm_config.py` for analytics/reporting. The per-account
  opt-in is stored in `broker_accounts.dll_opted_in` (migration 0167).
- **Sources (base cap reduction):** Tradecovex 2026-04-28 (single source; treat as
  informational until a second source corroborates).
- **Sources (voluntary-DLL promo):** Operator-authoritative, effective 2026-06-02.

### 11. MLL Resets to $0 After Every Payout — CRITICAL Post-Payout Sizing Note

**Effective: current Topstep policy (confirmed 2026-06-22).**

After every payout withdrawal, the Maximum Loss Limit (MLL = trailing drawdown
floor) **resets to the account starting balance ($0 net profit, i.e. the
starting account balance** — same as first day of funded trading). The buffer
earned during the payout window is gone immediately after withdrawal.

**Practical impact on sizing:** immediately after a payout, the bot's effective
drawdown room is $2,000 (the full MLL). Do NOT assume the pre-payout equity HWM
is still the drawdown anchor — it resets. The paper engine's `realizedPeakEquity`
HWM (migration 0075) must be reset to the current account balance after any
payout event to prevent oversizing in the first session post-payout.

- **Not yet auto-reset in paper engine** — carry-forward. Operator must manually
  reset `realizedPeakEquity` via `UPDATE paper_sessions SET ...` after each
  payout until an automated payout-detection hook is wired.
- **Sources:** Tradecovex 2026-04-28, Backtrex 2026-06-07 (2 corroborating sources).

---

## Constants Used By Code

```
TOPSTEP_PLATFORM_LOCKDOWN_DATE     = "2026-01-12"
TOPSTEP_REQUIRED_PLATFORM          = "topstepx"
TOPSTEP_ALLOWS_CLOUD_FAILOVER      = false
TOPSTEPX_API_MONTHLY_FEE_USD       = 14.50
TOPSTEPX_PROMO_CODE                = "topstep"
```

---

## Defense-in-Depth Notes

| Concern | Trading Forge defense |
|---|---|
| Cloud failover firing on Topstep session | `network-failover.ts` rejects cloud failover for Topstep |
| Non-TopstepX broker selected | `broker_router.ts` (Pass 2 Track 4) — TopstepX-only path |
| VPN/VPS detection | `compliance_gate.check_violation` `vps_prohibited` rule |
| Same strategy on operator's multiple Topstep accounts | `correlated-position-guard.ts` does NOT block (same user_id, intra-firm) |

---

## Out of Scope (Documented Elsewhere)

- MFFU 2026 rules — see `docs/prop-firm-rules-2026-mffu.md`.
- TopstepX API broker integration — Pass 2 Track 4 owns. This document
  documents the rule, not the integration code.
- 9 legacy firms — being removed in this Pass 1 by Track 2 agents.
