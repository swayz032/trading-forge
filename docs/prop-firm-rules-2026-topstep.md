# Topstep 2026 Rules — Canonical Reference

> **Source of truth.** This document is parsed by `scripts/verify-2026-rules-compliance.mjs`.
> Code reads `src/shared/firm-stage-rules.json` through the Python and
> TypeScript stage-rule loaders. The `## Canonical Values` block below is
> checked against that rule book; evaluation, funded, payout, and live rules
> must not be flattened into one gate.
>
> Effective: 2026-01-12 (TopstepX-only platform lockdown).
> Last reviewed: 2026-07-12.
> Promo added: 2026-06-02 (voluntary-DLL doubles XFA payout cap).
> Evidence source: official [Topstep payout policy](https://help.topstep.com/en/articles/8284233-topstep-payout-policy), reviewed 2026-07-12.

---

## Stage Profile (50K)

| Field | Value |
|---|---|
| Account size | `$50,000` |
| Activation fee | `$0` (always — all firms) |
| Combine monthly fee | `$49` |
| Combine base profit target | `$3,000` |
| Combine minimum trading days | `2` |
| Combine best-day rule | Best day must be ≤50% of total profit at pass; otherwise the **effective target rises** to `max($3,000, 2 × best-day profit)`. This is recoverable, not an account breach. |
| Combine / XFA drawdown | `$2,000` EOD trailing; locks at the starting balance |
| Combine / XFA daily loss limit | `$1,000` hard limit |
| Combine / XFA max contracts | `50` micros (or 5 minis — TopstepX 10:1 ratio per scaling plan) |
| XFA Standard payout | `5` winning days at `$150+`; the first payout is exempt from the since-last-payout profit test, later payouts require positive balance growth since the last approved payout |
| XFA Consistency payout | `3` days with at least one trade and best day ≤`40%` of net payout-window profit; resets after payout |
| XFA payout split | `0.90` (90% to trader) |
| XFA request bound | Minimum `$125`; each request is capped at `50%` of current account balance and then by the path/DLL dollar cap |
| Overnight allowed | `false` |
| Weekend allowed | `false` |
| Commission per side per contract | `$0.62` |
| Payout split | `0.90` (90% to trader) |

## Canonical Values

This block is parsed verbatim by the lint script. Keys map to the canonical
stage rule book, not to a flattened legacy projection.

```yaml
firm_id: topstep
evaluation_account_size: 50000
evaluation_monthly_fee: 49
evaluation_activation_fee: 0
evaluation_profit_target: 3000
evaluation_max_drawdown: 2000
evaluation_trailing: eod
evaluation_locks_at_start: true
evaluation_trailing_lock_floor_offset: 0
evaluation_daily_loss_limit: 1000
evaluation_max_contracts: 50
evaluation_min_trading_days: 2
evaluation_consistency_mode: dynamic_profit_target
evaluation_consistency_ratio: 0.50
evaluation_best_day_persists_after_loss: true
funded_account_type: xfa
funded_starting_balance: 0
funded_max_drawdown: 2000
funded_trailing: eod
funded_locks_at_start: true
funded_trailing_lock_floor_offset: 0
funded_daily_loss_limit: 1000
funded_daily_loss_behavior: hard_limit
funded_max_contracts: 50
funded_overnight_ok: false
funded_weekend_ok: false
payout_split: 0.90
payout_minimum_request: 125
payout_account_balance_fraction: 0.50
standard_minimum_winning_days: 5
standard_minimum_winning_day_profit: 150
standard_positive_net_profit_since_last_payout_required: true
standard_first_payout_exempt: true
standard_payout_cap_base: 2000
standard_payout_cap_with_dll: 4000
consistency_minimum_trading_days: 3
consistency_minimum_trades_per_day: 1
consistency_maximum_ratio: 0.40
consistency_resets_after_payout: true
consistency_payout_cap_base: 3000
consistency_payout_cap_with_dll: 6000
live_payout_cap: null
commission_per_side: 0.62
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

**Integration spec for the direct-execution connector (DEFERRED until operator opens
account; this is the build sheet for `broker-router.ts` TopstepX path, currently a stub):**
- **Powered by ProjectX.** API Access is provisioned via ProjectX (dashboard.projectx.com),
  billed separately from the Topstep subscription. Billing appears as **"Sim2Funded Solutions"**.
- **Auth = OAuth with API key + username.** Generate the API key inside TopstepX (Settings ⚙️ →
  API tab → Add API Key, which routes through ProjectX). Authenticate every request with the
  **API key + your TopstepX username** (both required). Store the key in the Bitwarden vault
  (`broker_accounts.api_key_vault_ref`), NEVER in code/.env-plaintext.
- **Transport:** REST + WebSocket. Pull live + historical market data; place/execute orders.
- **⚠️ Orders are FINAL** — no review, adjustment, or reversal. Reinforces our existing
  contract: every order MUST flow through `routeOrder()` with the `killSwitch.isHaltedForProduction()`
  FIRST-gate + idempotency (no duplicate sends) + the compliance gates already in this doc. A
  buggy send is irreversible capital loss — fail-CLOSED on any uncertainty.
- **No Topstep support** for API/coding/troubleshooting — refs: ProjectX Developer Docs,
  Topstep Discord `#api-trading`, `dashboardapi@topstep.com`.
- **Hedging note:** Topstep flags that API access affects hedging potential — our
  `cross-account-hedge-gate.ts` (Tier 5.3.2) is the enforcement for the single-user
  cross-account hedging prohibition this raises.

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

### 8. Combine Best-Day Rule — Dynamic Profit Target (Evaluation Only)

**Effective: 2026 (confirmed by 5 independent sources as of 2026-06-22).**

In the Trading Combine, you may pass in as few as **two trading days**. At the
pass check, the best day must be no more than 50% of total profit. A large day
does **not** fail or close the account: it raises the required total profit to
`max($3,000, 2 × best-day profit)`. The trader can continue trading until that
effective target and the two-day minimum are satisfied. A later loss does not
erase the recorded best day.

The XFA (funded account) has a SEPARATE consistency rule only on the
**Consistency Path**: best day cannot exceed 40% of total payout-window profit.
The **Standard Path** has no percentage consistency rule, but it requires five
winning days. Its first payout is exempt from the since-last-payout profit
test; later requests require positive account-balance growth since the prior
approved payout. The funded stage has no consistency rule on the Standard Path.

- **Modeling:** `evaluate_topstep_combine()` / `evaluateTopstepCombine()` and the
  Monte Carlo survival model use the dynamic target. They do not place this
  condition in `breach_mask` or funded-survival failures.
- **Execution scope:** TradingView paper trading is not part of this engine.
  Custom API paper execution remains separate from research validation; no
  broker, paper-routing, or live-trading behavior changes in this hardening.

### 9. XFA Two-Path Split — Effective 2026-02-05

Since February 5, 2026, the Express Funded Account (XFA — the funded stage after
passing the Combine) offers two payout paths. Operators choose at account activation.
The funded ledger starts at $0 P&L and applies its own $2,000 EOD drawdown,
$1,000 daily-loss limit, contract cap, and flat-session requirements; it is not
the successful Combine balance carried forward.

| Path | Winning Days Required | Min P&L per Day | Consistency Cap |
|---|---|---|---|
| **Standard Path** | 5 winning days | $150 per day | None |
| **Consistency Path** | 3 trading days | (any) | ≤ 40% single-day cap |

**Trading Forge default:** Standard Path (5 winning days at $150+). The path is
stored independently under the `payout` stage. Selecting the Consistency Path
changes only payout eligibility; it must never become an evaluation or
survival breach.

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

- **Modeled as payout context, never a trading gate** — `evaluatePayoutEligibility()`
  / `evaluate_payout_eligibility()` select the base or voluntary-DLL cap from
  the per-account opt-in and refuse a request above available net profit. The
  per-account opt-in is stored in `broker_accounts.dll_opted_in` (migration 0167).
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

## Prohibited Conduct (2026 — coverage map)

Topstep's Prohibited Conduct list applies at every level. Responses range from a warning to
permanent account closure / payout denial, case-by-case on severity + history. Below is each
item mapped to how Trading Forge handles it. Two new enforced gates were added 2026-06-23.

| Prohibited conduct | Bot handling |
|---|---|
| **Cross-account hedging (single-user)** — opposite positions across your accounts | **ENFORCED (2026-06-23):** `cross-account-hedge-gate.ts` blocks an entry that would be opposite to an open position on the same underlying in another account of this firm. Wired at the paper-signal entry cluster (Tier 5.3.2). `compliance.cross_account_hedge_blocked`. Critical on the multi-account scaling path (§5 lever 3). |
| **Holding within 2% of a product's price-lock limit** | **ENFORCED (2026-06-23):** `price-lock-limit-gate.ts` blocks an entry within 2% of the ±7% daily limit (Tier 5.3.3). Distinct from the MFFU "2% account loss" rule. Reference = prior settlement; FAIL-OPEN when unavailable (intraday structural trades are never near ±7%). `compliance.price_lock_limit_blocked`. TODO: wire the daily settlement feed for full enforcement. |
| **Coordinated trading** — same/opposite strategy in concert with others | Covered by family distribution rules: each member runs a DIFFERENT strategy (`account_strategy_assignments` UNIQUE), separate device + instance (§9). |
| **Use of VPN / proxy / TOR / geo-obfuscation** | ENFORCED: `vps_prohibited` compliance rule (§2 above) — host must be `local`. Both firms ban it. |
| **Circumventing geographical/technical restrictions** | Same as VPN ban — local host only, no obfuscation. |
| **Account stacking** (repeat max-loss then switch accounts) | The 67% personal DLL halt + 95% force-close (CLAUDE.md §4) prevents the high-risk-blowup mechanic; the rest is account-management behavior, not bot logic. |
| **Trading outside best bid/offer** | Posture: orders are stop-LIMIT (CLAUDE.md "Don't use stop-market"), placed at structural levels — never outside BBO by design. |
| **Unfair tech / AI / ultra-high-speed / mass data entry** | Posture: the bot is **1–2 A+ trades/day** (`TF_MAX_TRADES_PER_DAY=2`), standard automation via TradersPost (Topstep-sanctioned) — NOT HFT, NOT mass-entry. |
| **Disruptive practices / spoofing** | Posture: the bot never places-and-cancels to manipulate; it sends a single entry + bracket. |
| **Price exploitation / external or slow data feed** | Posture: trades fire on standard closed-bar signals; no latency-arbitrage, no exploiting feed delays. |
| **Trading on behalf of others / sharing incentives** | N/A: operator trades own accounts; family run their own independent stacks (§9). |
| **Excessive Combine/Reset purchases** | Operator/account-level, not bot logic. |

**Enforcement code:** `src/server/lib/cross-account-hedge-gate.ts`, `src/server/lib/price-lock-limit-gate.ts`,
wired in `paper-signal-service.ts` (Tier 5.3.2 / 5.3.3). New env: `NEWS_REDUCE_SIZE_FACTOR` (unrelated),
`PRICE_LOCK_LIMIT_PCT_<UNDERLYING>` (per-underlying limit % override, default 0.07).

### Prohibited Trading Strategies (SIM exploitation + news) — coverage

Topstep's "Prohibited Trading Strategies" doc targets SIM-fill abuse and full-size news trades.
**Trading Forge is on the right side of all of these BY DESIGN** — the abuse pattern Topstep
describes ("hundreds or thousands of trades per day, durations in seconds") is the polar
opposite of our **1–2 A+ trades/day, structural holds (minutes–hours)** architecture.

| Prohibited strategy | Bot handling |
|---|---|
| **Scalping algos / hundreds of rapid trades for SIM queue position** | ENFORCED: `daily-trade-cap.ts` HARD-caps `TF_MAX_TRADES_PER_DAY=2` per account (all firms). The 3rd signal of the day is rejected. We are structurally incapable of the "hundreds of trades/day" pattern. |
| **Durations in seconds / scalping** | By design: structural entries with Style C / adaptive exits hold for the move (minutes–hours), not seconds. No sub-minute scalping. |
| **Reckless trades in gapped markets for stray fills** | Guarded: `check_zero_volume_trade_critical()` (holiday/gap bars fail loud), backtest partial-fill + vol-scaled slippage models — fills are modeled realistically, not idealized. |
| **Exploiting SIM lack-of-slippage for impossible stop execution** | By design: backtest computes P&L manually with vol/session-dependent slippage (never idealized); stop-LIMIT orders, structural stops. |
| **Tight brackets / auto-breakeven to farm favorable SIM fills** | Legitimate use only: BE+1 stop fires AFTER a real +1R move (TP1 fill over minutes) — risk management, not a sub-second SIM-fill farm. |
| **Trading MAXIMUM position size into a scheduled major news event** | ENFORCED for NEW entries: the firm-aware news gate reduces Topstep size to `NEWS_REDUCE_SIZE_FACTOR=0.5` (never max) in the T−5/+2 window (`news-policy.ts` + `economic-calendar-loader.ts`). **Residual:** a position OPENED before the window and HELD into the event stays at full size — narrow (only EIA/MCL lands in the 9:30–11:30 window; FOMC/CPI/NFP are outside it). Candidate refinement: taper/flag open positions held into a major event. |
| **Intentionally depleting a Live Funded Account** | N/A: the bot maximizes risk-adjusted return; it never intentionally draws down. The 67% DLL halt + 95% force-close are the only loss mechanics. |
| **Account stacking** | The 67% personal DLL halt prevents the high-risk-blowup mechanic; switching accounts to repeat is operator behavior, not bot logic. |

**Net:** no new enforcement code required — the daily-trade-cap (2/day) + structural-hold
architecture + realistic fill modeling + news size-reduction already satisfy this list. The
single narrow residual is full-size positions HELD into a major news event (vs new entries).

---

## Risk Adjustments — Volatility Position Limits + Restricted-Symbol Scaling (ProjectX)

During extreme volatility (expanding price limits, Velocity Logic halts, historic ranges,
rapid sustained moves), Topstep **temporarily tightens position limits** on affected products
(or halts mini+ contracts). Temporary, product-specific, Risk-Team-monitored; notified via
email + dashboard banner + @AskTopstep on X. Lifted when volatility normalizes.

**Current restricted limits** (by account size 50K / 100K / 150K):

| Product | Combine / Express Funded / Pro | Live Funded (LFA) |
|---|---|---|
| Crude Oil (CL), QM, RB, HO | 3 / 6 / 9 | 3 / 6 / 9 |
| **Micro Crude (MCL)** | **30 / 60 / 90** | **3 / 6 / 9** ← LFA much tighter |
| Gold (GC) | 3 / 6 / 9 | 3 / 6 / 9 |
| Micro Gold (MGC) | 30 / 60 / 90 | 5 / 10 / 15 |
| Micro Silver (SIL), Micro Copper (MHG) | 2 / 4 / 6 | 2 / 4 / 6 |
| Silver (SI), Copper (HG), Platinum (PL) | 0 (no trade) | 0 (no trade) |

**Express Funded Scaling Plan (applies INDEPENDENTLY — actual limit = MIN(ceiling, balance tier))**
for restricted symbols CL / QM / MCL / HO / RB / GC / MGC:

| Account | Balance → contracts |
|---|---|
| 50K XFA | <$1,500 = 1 · $1,500 = 1 · $2,000 = 3 · $3,000 = 6 · $4,500 = 9 |
| 100K XFA | <$1,500 = 1 · $1,500 = 2 · $2,000 = 3 · $3,000 = 6 |
| 150K XFA | <$1,500 = 1 · $1,500 = 2 · $2,000 = 3 · $3,000 = 6 · $4,500 = 9 |

**★ IMPACT ON OUR SIZING:** **MCL is the operator's only product on this restricted list**
(MES/MNQ are equity-index — not restricted). Our pyramid base is **18 MCL** (CLAUDE.md §4),
but on a Topstep XFA the restricted MCL cap + balance-scaling can be far lower — e.g. a fresh
50K XFA below $1,500 balance is capped at **1 MCL**, and an LFA is capped at **3/6/9**. When
the operator goes live on Topstep, `computeRiskDerivedContracts()` must add a Topstep
restricted-symbol cap: `min(existing sizing, restricted_ceiling[symbol][accountSize],
xfa_scaling_tier(balance))`. NOT needed on MFFU (different rules) and NOT for MES/MNQ.
**Carry-forward — wire when the Topstep account opens** (deferred with the TopstepX connector).

---

## Commissions & Fees (TopstepX / ProjectX — authoritative 2026-06-23)

Round-turn (RT) cost = both sides; per-side = RT ÷ 2. Each RT = exchange fee + NFA regulatory
($0.04) + commission. Auto-deducted per trade. **These are all-in** (the backtester applies
`commission_per_side × size × 2` with NO separate exchange/NFA add — `firm_config.py` values
MUST be the full per-side cost).

| Product | RT | Per-side (used in `firm_config.py`) |
|---|---|---|
| **MES / MNQ** (our micros) | **$1.24** | **$0.62** |
| **MCL** (our micro crude) | **$1.54** | **$0.77** |
| M2K / MYM | $1.24 | $0.62 |
| MGC (micro gold) | $1.74 | $0.87 |
| MNG (micro nat gas) | $1.74 | $0.87 |
| ES / NQ / RTY / YM (minis, Phase 5) | $3.80 | $1.90 |
| CL (mini crude, Phase 5) | $4.04 | $2.02 |
| QM | $3.44 | $1.72 |
| GC (gold) | $4.24 | $2.12 |

**★ CORRECTION 2026-06-23:** `firm_config.py::FIRM_COMMISSIONS["topstep_50k"]` previously had
**$0.37/side** for all micros — too LOW, which UNDER-COSTED every Topstep backtest (strategies
looked more profitable than reality). Fixed to the authoritative TopstepX schedule: MES/MNQ
$0.62, MCL $0.77; minis ES/NQ $1.90, CL $2.02 (minis are ~3× micros, NOT the old 10× assumption).
The TS `contract-class.ts` mirror was fixed too (class-based, so MCL is slightly under-estimated
live-side; the backtest is exact per-symbol). Changing `FIRM_COMMISSIONS` re-hashes
`firm_rules_version` — old backtests will trip `monte_carlo.firm_rule_version_mismatch` on MC
re-run (correct: they were graded against wrong fees; re-run them). MFFU rates unchanged
(separate schedule). Source: operator-provided TopstepX Commissions & Fees doc.

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
