# Risk Management / Kill-Switch / Position Sizing — Institutional Reference Evidence

## TL;DR (Trading Forge gap assessment)

- Topstep Combine uses INTRADAY trailing MLL (not EOD) — bot must treat unrealized equity peak as the floor-ratchet trigger, not realized P&L
- DLL on $50K Topstep is $1,000/session; sizing must derive from SMALLER of MLL-buffer and DLL, not headline account size
- Kill-switch architecture requires 4 independent layers (code → platform → broker → exchange); single-layer is institutionally unacceptable
- Position sizing anchor must be the trailing drawdown buffer (effective account = $2,000–$3,000), not the $50K headline
- Fractional Kelly (1/8 Kelly ≈ 1–2% of risk buffer per trade) is the practitioner consensus; full Kelly destroys prop accounts
- Topstep 50% consistency rule is a PAYOUT GATE, not just a DLL clone — best-day must stay under 50% of cumulative cycle P&L
- MFFU has NO daily loss limit on any plan (2026 differentiator); only drawdown rule governs; Core/Pro use 3% EOD trailing
- TopstepX: VPS/VPN PROHIBITED; bot must run on local machine or approved SaaS (Sentinel); CME Rule 575 isAutomated flag mandatory
- Heartbeat monitoring alone is insufficient — orphan-position detection (position-state vs process-state reconciliation) is the 2026 standard
- Automatic circuit breaker should fire at 60–80% of DLL (warning threshold), NOT at 100% (to account for slippage overshoot)

---

## Sources (all >= 2025-01-01)

| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2026-04-28 | PropTradingVibes — Topstep Rules 2026 | practitioner-interview | https://proptradingvibes.com/blog/topstep-rules-overview | "Combine uses intraday-trailing MLL; XFA uses EOD-trailing locking at $0; DLL $1K/$2K/$3K resets 5 PM CT" |
| 2026-04-19 | CrossTrade — Trailing DD Survival Guide | practitioner-interview | https://crosstrade.io/learn/risk-management/trailing-drawdown-survival-guide | "Topstep Combine/XFA = EOD trailing, locks at starting balance; intraday trailing kills accounts on winning trades" |
| 2026-05-22 | TrailingStopLoss — Prop Firm Position Sizing | practitioner-interview | https://trailingstoploss.com/prop-firm-position-sizing-apex-topstep/ | "Effective account size = distance to trailing floor, not headline; $50K Topstep buffer = $2,000 MLL + $1,000 DLL dual ceiling" |
| 2026-06-04 | NexusFi — Funded Trader Operations Manual | community-expert | https://nexusfi.com/a/prop-firms/funded-trader-operations-manual | "4-band risk escalation; per-trade risk = 20-30% of DLL; platform alerts at 60/80/90% of DLL before breach" |
| 2026-05-24 | NexusFi — Automated Trading Emergency Protocols | community-expert | https://nexusfi.com/a/automation/automated-trading-emergency-protocols | "4-layer kill-switch stack (code/platform/broker/exchange); heartbeat insufficient; resting stop orders at exchange survive CME reserved state" |
| 2026-03-01 | Copilink — Kill Switch Flatten All Prop Accounts | practitioner-interview | https://copilink.com/articles/automate-kill-switch-flatten-all-prop-accounts | "Portfolio-level auto-trigger at 60-70% of combined DLL; parallel (not sequential) flatten across all accounts; <5 second target" |
| 2026-03-02 | TradeDupe — Consistency Rule Guide | practitioner-interview | https://tradedupe.com/blog/prop-firm-consistency-rule-guide | "Topstep 50% consistency: best day <= 50% of total cycle profit; Apex 30% Windfall at every payout request; MFFU 35% soft target" |
| 2026-03-01 | Copilink — Kelly Criterion Prop Firm Traders | practitioner-interview | https://copilink.com/articles/kelly-criterion-prop-firm-traders | "Full Kelly destroys prop accounts; 1/8 Kelly (~3% risk) = conservative viable; 1/4 Kelly = minimum viable; trailing floor makes losses non-recoverable" |
| 2026-04-09 | Dovar Labs — Prop Risk Management Framework | practitioner-interview | https://dovarlabs.com/insights/prop-risk-management/ | "Circuit breaker must fire at 80% of DLL, not 100%; equity-based (not balance-based) calculation; slippage buffer 3-5 pts on top" |
| 2026-05-10 | PropTradingVibes — MFFU Rules 2026 | practitioner-interview | https://proptradingvibes.com/blog/myfundedfutures-rules-overview | "No daily loss limit on any MFFU plan; Core/Pro = 3% EOD trailing; Rapid = 4% intraday trailing; consistency rule eval-only (50% Core)" |
| 2026-03-23 | Sentinel — Bot Policies 2026 | practitioner-interview | https://sentinel.redclawey.com/blog/automated-trading-allowed-prop-firms-policy-guide-2026 | "TopstepX allows full automation; VPS/VPN prohibited; CME Rule 575 isAutomated flag mandatory; Apex prohibits full algos" |
| 2026-06-04 | Jeremy Knox — Position-Level Orphan Detection | community-expert | https://www.jeremyknox.ai/blog/position-level-orphan-detection-why-heartbeat-monitoring-isnt-enough/ | "Heartbeat = process-level assertion; position safety = data-level assertion; orphan reconciliation must run every 30s; custody gap alert = distinct from bot-down alert" |
| 2026-03-21 | Vigil Drawdown Recovery Calculator | practitioner-interview | https://runvigil.app/calculators/drawdown-recovery/topstep | "Topstep drawdown type = Trailing EOD; daily limit 2% of account balance" |
| 2026-03-19 | QuantVPS — Prop Firm Statistics 2026 | blog-general | https://www.quantvps.com/blog/prop-firm-statistics | "Most firms set DLL at 4-5% of account balance; Topstep uses 2% DLL on $50K ($1,000)" |

---

## Trading Forge vs Institutional Comparison

| Dimension | Topstep/MFFU 2026 Rule | Institutional Practitioner Standard | Gap Assessment |
|---|---|---|---|
| **MLL trailing type (Combine)** | Intraday trailing (floor ratchets on every unrealized peak) | Must track unrealized equity high-water mark, not just closed P&L | CRITICAL if bot uses closed P&L only — account can breach on open winning position |
| **MLL trailing type (XFA/funded)** | EOD trailing, locks permanently at $0 starting balance | Only recalculate floor at session close; ignore intraday swings | Less dangerous but must verify bot's floor-tracker is session-close, not real-time |
| **DLL threshold** | $1K/$2K/$3K (Topstep 50K/100K/150K); MFFU = none | Practitioner soft limit: 50-67% of firm DLL as internal halt | If bot uses full $1,000 DLL as halt, no buffer for slippage — needs 60-80% internal threshold |
| **Position sizing anchor** | Buffer = $2,000 MLL + $1,000 DLL on $50K | Risk per trade = % of SMALLER of (MLL buffer, DLL remaining) | "1% of account" = 1% of $50K = $500 = 50% DLL — catastrophically oversized; must use buffer not headline |
| **Per-trade risk %** | Implicit from rule math | 5-10% of trailing buffer per trade (Kelly 1/8 to 1/4); equiv 1-2% "by feel" guidance | Standard 1-2% means $20-40 on $2,000 buffer = ~4 MES ticks — forces tight stops or micros only |
| **Max contracts (Topstep 50K)** | 5 minis OR 50 micros max | Stay well under contract cap; size from buffer math, not contract max | Contract cap is ceiling, not target; sized correctly the buffer constraint binds first |
| **Kill-switch layers** | Firm auto-flattens at DLL/MLL breach | 4 independent layers: code + platform + broker + exchange resting orders | Minimum viable: Layer 1 (code DLL monitor) + Layer 2 (platform DLL setting) + Layer 4 (exchange resting stops) |
| **Kill-switch trigger threshold** | Firm fires at 100% of DLL | Practitioners: internal halt at 60-80% of DLL to absorb slippage | Single-point firing at 100% risks overshoot; 80% internal threshold is the standard |
| **Kill-switch latency target** | Firm systems: several seconds | Operator-side target: <5 seconds parallel flatten across all accounts | Sequential flatten per account is not acceptable for multi-account setups |
| **Consistency rule** | 50% best-day / cycle-profit on Topstep Combine (payout gate); 30% Apex Windfall | Keep best-day under threshold from day 1; pacing is risk management | Consistency rule must be tracked live, not retroactively; oversized day can lock payout eligibility for weeks |
| **MFFU 2%-per-trade context** | No per-trade % rule; only total drawdown rule governs | MFFU drawdown = 3% EOD trailing ($1,500 on $50K); per-trade sizing from that buffer | The "2% MFFU rule" referenced in project context is likely internal self-imposed limit, not firm rule; firm has no DLL |
| **Heartbeat / unattended monitoring** | Firms do not specify; market orders may fail in CME reserved state | Position-level orphan detection: reconcile exchange position state vs managing process state every 30s | Heartbeat alone (process liveness) is insufficient; must also confirm open positions have active managing process |
| **Dead-man's switch / auto-flatten on disconnect** | TopstepX: VPS prohibited; bot must run locally | Industry: resting bracket orders at exchange survive connectivity loss; auto-flatten on timeout | Trading Forge must have resting stop orders at exchange for all open positions, independent of connectivity to the bot |
| **VPS/VPN restriction** | TopstepX: VPS+VPN = account suspension; MFFU = VPS allowed | TopstepX compliance requires local execution or approved SaaS; no cloud hosting | If Trading Forge runs on cloud/Railway for bot execution on Topstep accounts, that may violate VPS prohibition |
| **CME Rule 575** | CME requires isAutomated flag on all algo orders | Required for compliance; fine risk if missing | All automated order submissions must tag isAutomated: true |
| **Volatility / margin expansion** | CME raises initial margin 1x–2x during high-VIX events | Reduce position size proportionally when margin increases; effective risk doubles | Margin expansion not equivalent to drawdown buffer expansion; must reduce contracts |

---

## Recommended Changes (with citations)

### 1. Fix the sizing anchor — use drawdown buffer, not headline account size
The $50K headline is irrelevant to risk sizing. The effective risk capital on a fresh $50K Topstep Combine is $2,000 (MLL buffer). Risk per trade = 5-10% of the SMALLER of (remaining MLL buffer, remaining DLL for the session). At 8% of buffer = $160 per trade; on MES at a 10-pt stop = $50/trade = 3.2 MES contracts. On MNQ at 30-tick stop = $15/trade = 10 MNQ contracts.
Supported by: [TrailingStopLoss 2026-05-22], [Copilink Kelly 2026-03-01], [NexusFi Operations Manual 2026-06-04]

### 2. Implement 60-80% DLL internal halt threshold, not 100%
Fire the code-level kill-switch at 80% of firm DLL to buffer for slippage, open unrealized loss, and order confirmation latency. On $50K Topstep: internal halt at -$800 realized+unrealized, not -$1,000. Dovar Labs explicitly recommends 80% warning threshold as non-negotiable for serious prop trading.
Supported by: [Dovar Labs 2026-04-09], [NexusFi Operations Manual 2026-06-04], [Copilink Kill Switch 2026-03-01]

### 3. Build 4-layer kill-switch stack; require resting stop orders at exchange for all open positions
Layer 1: code checks before every new order. Layer 2: platform DLL setting (NinjaTrader account-level). Layer 3: broker daily loss rule. Layer 4: resting bracket stops submitted to CME before (or immediately after) entry. Layer 4 is the only layer that survives CME reserved state, data feed loss, and platform crash simultaneously.
Supported by: [NexusFi Emergency Protocols 2026-05-24], [CrossTrade Survival Guide 2026-04-19], [Copilink Kill Switch 2026-03-01]

### 4. Track unrealized equity peak for Combine accounts (intraday trailing floor)
The Topstep Combine MLL trails the highest unrealized equity during the session. A bot that only tracks closed P&L will not detect that the floor has ratcheted up on a winning open trade. The floor can hit starting-balance before any trade is closed. Bot must poll open-position unrealized P&L at every bar and maintain intraday high-water mark for floor calculation.
Supported by: [PropTradingVibes Topstep Rules 2026-04-28], [TrailingStopLoss Position Sizing 2026-05-22], [CrossTrade Survival Guide 2026-04-19]

### 5. Add position-level orphan detection — not just process heartbeat
Heartbeat = process is running. Orphan detection = every open position maps to exactly one healthy managing process. Cross-reference exchange-reported open positions against bot process state every 30 seconds. Any divergence triggers "custody gap alert" with immediate forced review, separate from bot-restart procedures.
Supported by: [Jeremy Knox Orphan Detection 2026-06-04], [NexusFi Emergency Protocols 2026-05-24], [CrossTrade Survival Guide 2026-04-19]

### 6. Live-track consistency rule from first trade of each Combine cycle
Topstep 50% consistency rule: best single day must not exceed 50% of cumulative cycle profit at payout request. If day 1 profit = $1,200 and profit target = $3,000, the bot must flag that a $1,200 day now requires $1,200 more total profit before payout eligibility (not just reaching the $3,000 target). Oversized days lock payout for multiple sessions.
Supported by: [TradeDupe Consistency Guide 2026-03-02], [PropTradingVibes Topstep Rules 2026-04-28], [NexusFi Operations Manual 2026-06-04]

### 7. Confirm TopstepX VPS compliance — bot execution must be local or approved SaaS
Topstep prohibits VPS/VPN. If Trading Forge n8n or trade execution layer runs on Railway/cloud, that execution path may violate the VPS prohibition for Topstep accounts. Signal generation on cloud is acceptable; order submission must originate from local machine. CME Rule 575 isAutomated flag must be set on all bot orders.
Supported by: [Sentinel Bot Policy 2026-03-23], [PropTradingVibes Topstep Rules 2026-04-28], [h2tfunding 2025-09-26]

---

## Scale Translation (required vs over-engineered for solo operator + family distribution)

| Recommendation | Solo Operator Verdict | Rationale |
|---|---|---|
| 80% DLL internal halt threshold | REQUIRED | Slippage at DLL boundary can overshoot; no buffer = guaranteed occasional breach |
| 4-layer kill-switch | REQUIRED (Layers 1+2+4 minimum) | Layer 3 (broker DLL) is passive; Layers 1+2+4 are active and achievable solo |
| Intraday high-water mark tracking (Combine) | REQUIRED | Accounts blow on open winning trades if this is missing; direct Topstep rule |
| Position-level orphan detection (30s) | REQUIRED for unattended | If bot runs overnight or during operator absence, position orphan is existential risk |
| Parallel flush (<5 seconds) | BENEFICIAL | Solo typically runs 1-3 accounts; sequential is slower but manageable; for family distribution it becomes REQUIRED |
| Consistency rule live tracking | REQUIRED | Missing this costs payout eligibility, not account; but still operationally critical |
| VPS compliance audit | REQUIRED | Topstep account suspension risk if violated |
| Kelly fraction enforcement (code) | BENEFICIAL | Psychologically useful hard cap; math validates the 1-2% "feel" guideline |
| CME Rule 575 isAutomated flag | REQUIRED | Regulatory compliance; CME can fine for missing |
| Margin expansion position scaling | BENEFICIAL | CME doesn't continuously hike micros in normal regimes; check at session open |
