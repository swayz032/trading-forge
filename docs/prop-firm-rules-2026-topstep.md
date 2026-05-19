# Topstep 2026 Rules — Canonical Reference

> **Source of truth.** This document is parsed by `scripts/verify-2026-rules-compliance.mjs`.
> Code in `src/engine/firm_config.py`, `src/shared/firm-config.ts`,
> `network-failover.ts`, and the compliance gates must match the values in
> the `## Canonical Values` block below. Drift triggers CI failure.
>
> Effective: 2026-01-12 (TopstepX-only platform lockdown).
> Last reviewed: 2026-05-10.

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
| Consistency rule | `null` (no consistency rule) |
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
consistency_rule_pct: null
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
