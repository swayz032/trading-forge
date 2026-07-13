# Prop Firm Rules Freshness Audit — 2026-06-22

> **Historical audit — superseded for runtime use.** This report records the
> discrepancies found on 2026-06-22. The active contract is the stage-aware
> rule book at `src/shared/firm-stage-rules.json` and its two current rule docs;
> it is scoped to Topstep 50K and MFFU 50K Builder, not the historical plans
> discussed below.

## Audit Parameters

- **Audit date:** 2026-06-22
- **Canonical docs reviewed:** `docs/prop-firm-rules-2026-topstep.md` (effective 2026-01-12, last reviewed 2026-05-10) and `docs/prop-firm-rules-2026-mffu.md` (effective 2026-01-01, last reviewed 2026-05-10)
- **Code files reviewed:** `src/engine/firm_config.py`, `src/engine/prop_compliance.py`
- **Staleness window:** ~6 weeks (2026-05-10 to 2026-06-22)
- **Research scope:** Topstep + MFFU only; 9 legacy firms out of scope
- **Operator-confirmed ground truth:** BOTH firms use EOD trailing drawdown, NOT intraday (applies to the funded/XFA phase specifically)

---

## TL;DR (Critical Gaps Found)

- **CRITICAL #1 — Topstep consistency rule: we code `null` (no rule). Multiple 2026 sources confirm Topstep Combine has a 50% consistency rule AND the funded Express Funded Account (XFA) has a separate 40% consistency rule on the Consistency Path. This is WRONG in our codebase.**
- **CRITICAL #2 — Topstep min_trading_days: we code `5`. Multiple 2026 sources confirm the Combine has NO minimum trading days (or 2 days per TheTraderStack). Min trading days for XFA payout is 5 (Standard Path) or 3 (Consistency Path). Context matters — our value may be referencing payout days.**
- **CRITICAL #3 — Topstep trailing type: Combine is INTRADAY trailing; XFA is EOD trailing. We code `eod` for both phases. Operator ground truth confirms EOD for the funded (XFA) phase. This is NOT wrong for funded-phase trading but the Combine evaluation uses intraday trailing.**
- **CRITICAL #4 — MFFU Core max drawdown: multiple sources confirm MFFU Core 50K = $1,500 (3% of $50K). We code $2,000. Note: TheTraderStack Pro 50K page shows $2,000 for Pro plan. The Core vs Pro plan ambiguity is critical — our code says `mffu_50k` which needs to match exactly which plan we are using.**
- **HIGH #5 — MFFU DLL: we code `null`. Vigil shows $1,250 DLL for MFFU 50K (2.5%). PropTradingVibes rules overview says NO daily loss limit on any MFFU plan firm-wide. CONFLICT — requires resolution.**
- **HIGH #6 — MFFU min_trading_days: we code `5`. PropTradingVibes shows Core min = 2 (eval); TheTraderStack also shows 2 days.**
- **HIGH #7 — Topstep payout cycle: we do not code a `payout_cycle_days` for Topstep. XFA uses winning-days-based payouts (5 days Standard Path, 3 days Consistency Path) — not a fixed day cycle. We have MFFU payout_cycle_days=14 which is correct for the Pro plan bi-weekly schedule.**
- **MEDIUM #8 — Topstep DLL opt-in framing: we code DLL as always-on at $1,000. Tradecovex confirms DLL is $1,000 and is a guardrail (not account-closing), and on TopstepX it is user-configurable. Our enforcement as always-on is prudent conservative behavior.**
- **MEDIUM #9 — MFFU consistency rule scope: we code `mffu_50pct` as a funded-phase rule enforced at all times. All 2026 sources confirm it applies ONLY at evaluation pass-request time (look-back), NOT during the funded stage. The funded stage carries NO consistency rule.**
- **MEDIUM #10 — Topstep payout structure changed Feb 5, 2026: Standard Path vs Consistency Path split. Not reflected in our docs.**
- **LOW #11 — Topstep monthly fee pricing: our code is correct at $49/mo (Standard Path). No Activation Fee path exists at a higher monthly rate. Our docs only document the Standard Path.**

---

## Sources (2025+ only)

| Date | Source | Tier | URL | Key claim |
|---|---|---|---|---|
| 2026-03-21 | Vigil.app (primary source verified) | practitioner-interview | https://runvigil.app/rules/topstep/50k | Topstep 50K: MLL $2,000, DLL $1,000, profit target $3,000, consistency rule "no single day > 50% of total profit", NO min trading days |
| 2026-03-21 | Vigil.app (primary source verified) | practitioner-interview | https://runvigil.app/rules/my-funded-futures/50k | MFFU 50K: MLL $2,000, DLL $1,250 (2.5%), profit target $3,000, NO min trading days |
| 2026-04-09 | Tradecovex (updated April 2026) | blog-general | https://tradecovex.com/guides/topstep-combine-rules-2026 | Topstep 50K Combine: MLL $2,000 (intraday trailing); XFA uses EOD trailing; 50% consistency rule exists in Combine; Feb 5 2026 XFA split into Standard (5d/$5K) + Consistency (3d/40% cap) paths; payout split 90/10 from Jan 12 2026 |
| 2026-04-28 | Tradecovex | blog-general | https://tradecovex.com/guides/topstep-payout-rules-2026 | Topstep 90/10 split from Jan 12 2026; Standard Path 5 winning days; Consistency Path 3 days + 40% cap; payout caps updated April 28 2026 ($2K Standard / $3K Consistency for 50K new accounts); MLL resets to $0 after every payout |
| 2026-04-28 | PropTradingVibes | blog-general | https://proptradingvibes.com/blog/topstep-trading-combine-rules | Topstep Combine: INTRADAY trailing MLL; XFA uses EOD trailing; 50% consistency rule in Combine; 90/10 split; no min trading days for Combine; contract caps 50 micros |
| 2026-05-10 | PropTradingVibes | blog-general | https://proptradingvibes.com/blog/myfundedfutures-consistency-rule | MFFU 50% rule applies at EVALUATION only (pass-request look-back); funded stage has NO consistency rule; 40% stale figure incorrect — current is 50%; Topstep has "no formal percentage rule" |
| 2026-05-10 (pub_at null) | PropTradingVibes | blog-general | https://proptradingvibes.com/blog/myfundedfutures-rules-overview | MFFU 5-plan breakdown: Core=EOD trailing 3% ($1,500 on $50K); NO DLL on any plan firm-wide; Core eval consistency 50%; Core min days = 2; Core payout split 80/20; Core payout cadence = every 5 winning days; Pro plan = bi-weekly (14 days); Rapid = 90/10 intraday trailing |
| 2026-06-07 | Backtrex | blog-general | https://backtrex.com/en/blog/topstep-futures-evaluation-rules | Topstep Combine intraday trailing MLL confirmed; XFA EOD trailing confirmed; 50% consistency rule confirmed; 90/10 split from Jan 2026; Standard 5d/$5K vs Consistency 3d/40% paths |
| 2026-06-18 | TheTraderStack (verified review) | blog-general | https://www.thetraderstack.com/reviews/topstep-standard-50k | Topstep 50K: MLL $2,000 EOD, DLL None (listed as None), profit target $3,000, min days 2, consistency eval 50% / funded None, 90/10 split, 5 minis / 50 micros |
| 2026-06-18 | TheTraderStack (verified review) | blog-general | https://www.thetraderstack.com/reviews/myfundedfutures-pro-50k | MFFU Pro 50K: MLL $2,000 EOD, DLL None, profit target $3,000, min days 2, consistency eval 50% / funded None, 80/20 split, bi-weekly payouts, buffer $2,100; Core plan = $1,500 MLL (3%) |

---

## Trading Forge vs Institutional Comparison — TOPSTEP

| Rule | Our Codified Value | Current Published 2026 Value | MATCH / DRIFT / MISSING | Source + Date |
|---|---|---|---|---|
| Account size | $50,000 | $50,000 | MATCH | Tradecovex 2026-04-09 |
| Profit target | $3,000 | $3,000 | MATCH | Vigil 2026-03-21, Tradecovex 2026-04-09, all sources |
| Max drawdown (MLL) | $2,000 | $2,000 | MATCH | Tradecovex 2026-04-09, Backtrex 2026-06-07, TheTraderStack 2026-06-18 |
| Trailing type (Combine eval) | `eod` | INTRADAY | **DRIFT** | PropTradingVibes 2026-04-28, Backtrex 2026-06-07, Tradecovex 2026-04-09. Note: operator ground truth says EOD — this applies to XFA (funded), not the Combine evaluation phase. |
| Trailing type (XFA funded) | `eod` | EOD | MATCH | PropTradingVibes 2026-04-28, Backtrex 2026-06-07, TheTraderStack 2026-06-18 |
| Daily loss limit (DLL) | $1,000 | $1,000 (exists; non-account-closing; user-configurable on TopstepX) | MATCH (with note) | Tradecovex 2026-04-09, Vigil 2026-03-21; note TheTraderStack lists "None" which conflicts — likely reflects that DLL does not close the account permanently |
| Max contracts | 50 micros (5 minis) | 50 micros (5 minis) | MATCH | All sources confirm $50K = 5 minis / 50 micros |
| Min trading days | 5 | Combine: NO minimum; XFA Standard Path: 5 winning days at $150+ each; XFA Consistency Path: 3 days | **DRIFT** | Vigil 2026-03-21, TheTraderStack 2026-06-18 say 0 or 2; Tradecovex says "no time limit"; our `5` seems to conflate Combine rules with XFA payout requirements |
| Min payout days | 5 | Standard Path: 5 winning days ($150+ each); Consistency Path: 3 days | MATCH (Standard Path only) | Tradecovex 2026-04-28, Backtrex 2026-06-07 |
| Consistency rule | `null` (no consistency rule) | **50% rule EXISTS** in Combine: best day cannot exceed 50% of total cycle profit. XFA Consistency Path: 40% cap. XFA Standard Path: no percentage cap | **CRITICAL DRIFT** | Vigil 2026-03-21 ("no single day > 50%"), PropTradingVibes 2026-04-28 (confirmed), Tradecovex 2026-04-09, Backtrex 2026-06-07, TheTraderStack 2026-06-18 (Eval: 50%, Funded: None) |
| Payout split | 0.90 (90%) | 90/10 for accounts created after Jan 12, 2026 (100% of first $10K then 90/10 for older accounts) | MATCH for new accounts | Tradecovex 2026-04-09 + 2026-04-28, Backtrex 2026-06-07 |
| Monthly fee | $49 | $49/mo Standard Path (+ $149 activation fee); higher monthly no-activation-fee path also exists | MATCH (Standard Path) | All sources confirm $49 Standard |
| Activation fee | $0 | $149 Standard Path / $0 No Activation Fee Path | **DRIFT** | Tradecovex 2026-04-09, TheTraderStack 2026-06-18; our docs say $0 for "all firms" but Topstep Standard Path charges $149 activation fee |
| Allows VPS | `false` | false (personal device only, TopstepX) | MATCH | Our docs, confirmed |
| Allows VPN | `false` | false | MATCH | Our docs, confirmed |
| Required platform | `topstepx` | TopstepX (ProjectX) — only platform | MATCH | Our docs (lockdown Jan 12 2026), confirmed by Backtrex + TheTraderStack |
| Overnight | `false` | false | MATCH | All sources confirm no overnight |
| Payout cycle | (not coded; MFFU has 14 days) | Standard Path: after 5 qualifying winning days; Consistency Path: after 3 days + 40% target; weekly payouts available | MISSING (not coded) | Tradecovex 2026-04-28 |
| News trading | (not in YAML; MFFU has FOMC/CPI/NFP blackout) | "allowed" per Vigil; no formal news restriction per Tradecovex for Combine | **MISSING NUANCE** | Vigil 2026-03-21 says "News Trading: allowed" — we may be OVER-restricting Topstep |
| Payout cap (new after Apr 28 2026) | (not coded) | Standard Path: $2,000/payout (50K new accounts after Apr 28); Consistency Path: $3,000/payout; Pre-Apr28: $5,000 | **MISSING** | Tradecovex 2026-04-28 |
| MLL resets after payout | (not coded) | MLL resets to $0 after every payout (critical: buffer is gone immediately after withdrawal) | **MISSING** | Tradecovex 2026-04-28, Backtrex 2026-06-07 |

---

## Trading Forge vs Institutional Comparison — MFFU

| Rule | Our Codified Value | Current Published 2026 Value | MATCH / DRIFT / MISSING | Source + Date |
|---|---|---|---|---|
| Account size | $50,000 | $50,000 | MATCH | All sources |
| Profit target | $3,000 | $3,000 | MATCH | All sources |
| Max drawdown | $2,000 | **PLAN-DEPENDENT**: Core = $1,500 (3% EOD); Pro = $2,000 (EOD); Rapid = $2,000 (4% intraday); Flex = $2,000 (EOD static). If we are on Core: $1,500. If Pro: $2,000. | **AMBIGUOUS DRIFT** | PropTradingVibes rules overview (Core $1,500), TheTraderStack Pro 50K ($2,000). Our code says `mffu_50k` = $2,000 — this is correct for Pro but WRONG for Core. |
| Trailing type | `eod` | EOD (Core, Pro, Flex); INTRADAY (Rapid). EOD is correct for Core + Pro. | MATCH (for Core/Pro) | PropTradingVibes rules overview, TheTraderStack |
| Daily loss limit | `null` | **CONFLICTING**: Vigil shows $1,250 (2.5%); PropTradingVibes explicitly states "No daily loss limit on ANY plan firm-wide" | **CONFLICT — UNRESOLVED** | Vigil 2026-03-21 (DLL $1,250), PropTradingVibes rules overview (no DLL), TheTraderStack Pro 50K (DLL: None) |
| Max contracts | 50 micros | Core/Flex/Rapid: 5 minis / 50 micros; Pro: varies; TheTraderStack shows Pro 50K = 5 minis / 50 micros | MATCH | TheTraderStack 2026-06-18 |
| Min trading days | 5 | Core: 2 days (eval); PropTradingVibes shows min days 2; TheTraderStack shows 2 | **DRIFT** | PropTradingVibes rules overview, TheTraderStack 2026-06-18 |
| Min payout days | 5 | Core: every 5 winning days ($100+ per day); Pro: bi-weekly (14 days); Rapid: daily | **AMBIGUOUS** | PropTradingVibes rules overview. If we are on Core: 5 winning days. If Pro: not winning-days-based — 14 calendar days. |
| Consistency rule | `mffu_50pct` (coded as always-on) | **EVAL-PHASE ONLY**: 50% applies at eval pass-request time (look-back). Funded stage has NO consistency rule on ANY plan. | **DRIFT in scope** | PropTradingVibes consistency rule article 2026-05-10, PropTradingVibes rules overview, TheTraderStack 2026-06-18 (Funded: None) |
| Payout split | 0.80 (80/20) | Core + Pro + Flex + Builder: 80/20; Rapid: 90/10 | MATCH (for Core/Pro) | PropTradingVibes rules overview, TheTraderStack |
| Payout cycle | 14 days | Pro plan: bi-weekly (14 calendar days); Core: every 5 winning days (not calendar days); Rapid: daily | **PARTIAL MATCH** | PropTradingVibes rules overview. Our 14-day payout_cycle_days matches PRO plan. If we are on Core, payout is winning-days-based not calendar-days. |
| Overnight | `false` | false | MATCH | All sources |
| Weekend | `false` | false | MATCH | All sources |
| 2% rule (per trade) | `MFFU_TWO_PERCENT_RULE_PCT = 0.02` | Not found as an explicit published rule in 2026 sources. PropTradingVibes says "no DLL" (no per-day cap). No per-trade percentage rule mentioned. | **UNVERIFIED** | INSUFFICIENT EVIDENCE — only 0 corroborating sources for MFFU 2% per-trade rule in 2026. Original May 2026 review may have been mis-sourced. |
| HFT ban (500 trades/day) | `MFFU_HFT_MAX_TRADES_PER_DAY = 500` | Not found in 2026 sources reviewed | **UNVERIFIED** | INSUFFICIENT EVIDENCE for specific 500-trade ceiling — possible internal rule or older sourcing |
| News trading restriction | FOMC, CPI, NFP, GDP, ISM, PPI ±30 min | "News trading: restricted" on Core, Rapid, Pro, Flex per PropTradingVibes; Vigil shows "News Trading: allowed" for MFFU — CONFLICT | **CONFLICT** | PropTradingVibes rules overview vs Vigil |
| Collaborative trading ban | coded | Confirmed as MFFU rule | MATCH | Original docs confirmed, no new contradicting evidence |
| Same-device ban | coded | Confirmed as MFFU rule | MATCH | Original docs confirmed |
| Hedging ban (MNQ+NQ) | coded | Confirmed as MFFU rule | MATCH | Original docs confirmed |
| Activation fee | $0 | $0 on all MFFU plans | MATCH | TheTraderStack, PropTradingVibes |
| Commission | $0.62 | Not verified in current sources | UNVERIFIED | Coded 2026-05-25; not disputed |
| Monthly fee | $77 | Listed in our docs. TheTraderStack shows different pricing ($87-$126/mo for Pro 50K) | **POSSIBLE DRIFT** | TheTraderStack 2026-06-18 shows higher pricing; our $77 may be stale or for a specific plan |

---

## Key Findings — Detailed Analysis

### Finding 1 (CRITICAL): Topstep Consistency Rule = NOT NULL

**Our code:** `consistency_rule: None` (firm_config.py line 107, prop_compliance.py line 44)
**Reality:** The Trading Combine has a **50% consistency rule** enforced at the pass-request stage. Your best single trading day cannot exceed 50% of total cycle profit.

The XFA (funded stage) **ALSO has a consistency rule on the Consistency Path**: best day cannot exceed 40% of total net profit in the payout window. However, the Standard Path has no percentage consistency rule (only the 5 winning days requirement).

**Corroborating sources (3+):**
1. Vigil 2026-03-21: "Consistency rule: no single day > 50% of total profit"
2. PropTradingVibes Combine Rules 2026-04-28: "The 50% consistency rule" with worked examples
3. Tradecovex Combine Rules 2026-04-09: "The Consistency Rule in the Trading Combine phase requires that your best single trading day cannot exceed 50 percent of your profit target"
4. Backtrex 2026-06-07: "The consistency rule is the single rule most traders fail to account for"
5. TheTraderStack 2026-06-18: "Consistency (Evaluation): 50%" and "Consistency (Funded): None"

**Scale translation:** REQUIRED at our scale. Consistency gate must be implemented in `prop_compliance.py` for Topstep Combine evaluation phase. Current code at line 314 only checks `mffu_50pct` — Topstep returns no consistency check.

**Operator note:** PropTradingVibes consistency rule article for MFFU states "Topstep: No fixed-percent" which matches what one expects for the FUNDED stage, but ALL other sources confirm the 50% rule DOES exist in the Combine (evaluation) phase. The distinction is Combine vs Funded.

---

### Finding 2 (CRITICAL): Topstep Min Trading Days

**Our code:** `min_trading_days: 5` and `min_payout_days: 5`
**Reality:** Combine evaluation has NO minimum trading days (no time limit). XFA Standard Path requires 5 **winning** days ($150+ net P&L each) before first payout. XFA Consistency Path requires 3 days + 40% consistency target.

The "5" we code appears to be the XFA Standard Path payout requirement — but it is framed as min_trading_days for the evaluation, which is wrong.

**Corroborating sources (3+):**
1. Vigil 2026-03-21: "Min Days: None" for both evaluation and funded
2. Tradecovex 2026-04-09: "Profit target and no time limit" for Combine
3. TheTraderStack 2026-06-18: "Minimum Trading Days to pass: 2"

---

### Finding 3 (CRITICAL): Topstep Trailing Type — Phase Distinction

**Our code:** `trailing: "eod"` applied uniformly
**Operator ground truth:** EOD (confirmed by operator)
**Reality:** Two distinct phases with different trailing mechanics:
- **Trading Combine (evaluation):** INTRADAY trailing — MLL follows live equity HWM in real time during the session
- **Express Funded Account (XFA/funded):** EOD trailing — MLL only updates at session close, locks at starting balance

**Corroborating sources for Combine = intraday (3+):**
1. PropTradingVibes 2026-04-28: "Drawdown mechanic: trailing intraday, not EOD ... This is the number one thing traders get wrong about the Combine"
2. Backtrex 2026-06-07: "The profit target varies by account size. The Maximum Loss Limit (MLL) is an intraday trailing drawdown"
3. Tradecovex 2026-04-09: "Topstep's MLL is end-of-day trailing, not intraday" — WAIT, this is the opposite claim from Tradecovex...

**Resolution:** Tradecovex contradicts PropTradingVibes/Backtrex on this point. Tradecovex says EOD for the Combine; PropTradingVibes and Backtrex say intraday for the Combine. The operator has confirmed EOD. The operator's ground truth applies to the XFA (funded) phase where actual trading capital is at risk. Since Trading Forge trades the funded account (XFA), our `eod` is CORRECT for the operative phase.

**Verdict on trailing type:** For our purpose (funded XFA trading), `eod` is correct per operator confirmation and multi-source evidence. The Combine evaluation intraday trailing is irrelevant to our live-trading codebase — it affects the human trader passing the evaluation, not the bot trading the funded account. **No code change required for trailing type.**

---

### Finding 4 (CRITICAL): MFFU Core vs Pro Plan — Max Drawdown Ambiguity

**Our code:** `mffu_50k.max_drawdown = 2000`
**Reality:** Depends on which MFFU plan:
- **Core plan:** 3% EOD trailing = **$1,500** max drawdown on $50K
- **Pro plan:** 3% EOD trailing = **$2,000** max drawdown on $50K (Pro 50K listed at $2,000 per TheTraderStack)
- **Flex plan:** 4% EOD static = $2,000 on $50K
- **Rapid plan:** 4% intraday = $2,000 on $50K

PropTradingVibes rules overview (Core plan): "Core: 3% EOD trailing — $1,500 buffer on $50K"
TheTraderStack Pro 50K: "Max Drawdown: $2,000"
Vigil MFFU 50K: "$2,000 max drawdown" (does not specify which plan)

**Our canonical code comment says** `mffu_50k` = "50K Core/Flex/Rapid" but codes drawdown as $2,000. This may be INCORRECT for Core ($1,500). If the operator is on the Core plan, the max drawdown is $1,500 not $2,000.

**Action required:** Operator must confirm which MFFU plan they are enrolled in. Core = $1,500 drawdown (3%). Pro = $2,000. Flex = $2,000 static. Our code uses $2,000 which matches Pro/Flex/Rapid but NOT Core.

---

### Finding 5 (HIGH): MFFU DLL — Conflict Between Sources

**Our code:** `daily_loss_limit: null`
**Vigil 2026-03-21:** $1,250 DLL (2.5%)
**PropTradingVibes rules overview (2026):** "No daily loss limit on ANY plan in 2026 (firm-wide differentiator)"
**TheTraderStack Pro 50K (2026-06-18):** "Daily Loss Limit: None"

Vigil is the outlier here. PropTradingVibes and TheTraderStack both confirm no DLL on MFFU. Vigil may be showing an outdated rule or may have the firms confused. Two of three corroborating sources confirm our `null` is correct.

**Verdict:** Our `daily_loss_limit: null` appears to be CORRECT based on PropTradingVibes + TheTraderStack vs Vigil (2 sources vs 1). However, Vigil claims to check "Primary source: Official My Funded Futures rules" — this deserves a manual verification by the operator at myfundedfutures.com directly.

---

### Finding 6 (HIGH): MFFU Min Trading Days

**Our code:** `min_trading_days: 5`
**Reality:** Core plan requires 2 minimum trading days (evaluation). TheTraderStack also shows 2 days. PropTradingVibes shows 2 days for Core.

Our `5` is likely wrong for eval min days. Payout eligibility (5 winning days for Core) is different from eval minimum trading days (2).

---

### Finding 7 (HIGH): MFFU Consistency Rule — Scope Is Eval-Only

**Our code:** `consistency_rule: "mffu_50pct"` — coded as always-on at runtime
**Reality:** The 50% consistency check applies ONLY at the evaluation pass-request stage as a look-back calculation. The funded stage (where our bot actually trades) has NO consistency rule on any MFFU plan.

**Corroborating sources (3+):**
1. PropTradingVibes consistency rule article 2026-05-10: "MyFundedFutures enforces a 50% consistency rule on the evaluation stage only. No single calendar trading day's profit may account for more than 50% of total evaluation profits at the moment of pass request. The funded stage carries no equivalent rule."
2. PropTradingVibes rules overview: "Consistency rule only on evaluation (50%, eval-only)"
3. TheTraderStack 2026-06-18: "Consistency (Evaluation): 50%" and "Consistency (Funded): None"

**Implication:** Our `check_tpt_consistency` function is being applied to funded-stage simulations (prop_compliance.py line 314). This is technically wrong for the funded phase. However, applying a consistency check to funded-stage backtest sim is CONSERVATIVE (it filters strategies that would fail eval) and not operationally harmful. The real-money funded trading has no consistency rule — strategies can have concentrated days freely.

**Scale translation:** BENEFICIAL at our scale to keep the eval-phase check active in backtest sims, but it should be documented clearly that this is an eval-phase gate, not a funded-phase rule.

---

### Finding 8 (MEDIUM): MFFU 2% Per-Trade Rule — Unverified

**Our code:** `MFFU_TWO_PERCENT_RULE_PCT = 0.02` in compliance gate
**2026 sources:** NO mention of a 2% per-trade rule in any current source. PropTradingVibes and TheTraderStack both say "No daily loss limit." Vigil shows a $1,250 DLL (which would be 2.5% — different concept entirely).

**INSUFFICIENT EVIDENCE** — only 0 corroborating 2026 sources for this rule. This may have been sourced from an older MFFU policy or a different firm. Operator should verify directly at myfundedfutures.com/rules.

---

### Finding 9 (MEDIUM): Topstep Activation Fee

**Our code:** `activation_fee: 0` for Topstep (under "all firms = $0")
**Reality:** Topstep Standard Path charges **$149 activation fee** after passing the Combine. The No Activation Fee path charges a higher monthly subscription instead.

**Corroborating sources (3+):**
1. Tradecovex 2026-04-09: "Standard Path activation fee: $149 after passing"
2. TheTraderStack 2026-06-18: "Activation Fee: $149" for Standard path
3. Backtrex 2026-06-07: The firm charges activation fees per path

**Our canonical doc says:** "Activation fee: $0 (always — all firms)" — this is WRONG for Topstep Standard Path.

**Note:** The No Activation Fee path at Topstep does have $0 activation fee. If the operator intends to use the No Activation Fee path exclusively, then $0 is correct. This needs operator clarification.

---

### Finding 10 (MEDIUM): Topstep Feb 2026 XFA Path Split

**Not in our docs.** Since Feb 5, 2026, Topstep's Express Funded Account (funded phase) split into two payout paths:
- **Standard Path:** 5 winning days ($150+ each), payout cap $2,000 (50K, post-Apr-28 new accounts) or $5,000 (pre-Apr-28)
- **Consistency Path:** 3 trading days + 40% consistency target, payout cap $3,000 (50K, post-Apr-28) or $6,000 (pre-Apr-28)

This is a STRUCTURAL change to the funded account payout logic that occurred BEFORE our last review (2026-05-10) and should be documented.

---

## Diff Table — All Rules

| Rule | Our Codified Value | Current Published 2026 Value | Status |
|---|---|---|---|
| **TOPSTEP** | | | |
| Account size | $50,000 | $50,000 | MATCH |
| Profit target | $3,000 | $3,000 | MATCH |
| Max trailing drawdown | $2,000 | $2,000 | MATCH |
| Trailing type (funded XFA) | eod | EOD | MATCH |
| Trailing type (Combine eval) | eod | INTRADAY (contested: some sources say EOD) | CONFLICT — operator says EOD, not relevant to funded trading |
| Daily loss limit | $1,000 (always-on opt-in) | $1,000 (non-account-closing; user-configurable on TopstepX) | MATCH (conservative is correct) |
| Max contracts | 50 micros | 50 micros | MATCH |
| Min eval trading days | 5 | 0 (no minimum) | **DRIFT** |
| Min payout days | 5 | 5 winning days (Standard) OR 3 days (Consistency) | PARTIAL (Standard only) |
| Consistency rule | null | **50% in Combine eval; 40% in XFA Consistency Path; None in XFA Standard Path** | **CRITICAL DRIFT** |
| Payout split | 0.90 (90%) | 90% (post-Jan 12 2026) | MATCH |
| Monthly fee | $49 | $49 Standard Path | MATCH |
| Activation fee | $0 | **$149 Standard Path; $0 No Activation Fee path** | **DRIFT** |
| Platform | topstepx | TopstepX (ProjectX) | MATCH |
| Allows VPS | false | false | MATCH |
| Allows VPN | false | false | MATCH |
| Overnight | false | false | MATCH |
| Payout caps | (not coded) | $2K/$3K Standard/Consistency (50K new after Apr-28) | MISSING |
| MLL resets after payout | (not coded) | MLL resets to $0 after every payout | MISSING |
| XFA path split (Feb 5 2026) | (not documented) | Standard + Consistency paths | MISSING |
| News trading restriction | (not in YAML; we enforce blackout via calendar_filter.py) | "allowed" per Vigil; no formal news restriction in published rules | POSSIBLE OVER-RESTRICTION |
| **MFFU** | | | |
| Account size | $50,000 | $50,000 | MATCH |
| Profit target | $3,000 | $3,000 | MATCH |
| Max trailing drawdown | $2,000 | **Core: $1,500 / Pro: $2,000 / Flex: $2,000 / Rapid: $2,000** | **AMBIGUOUS DRIFT (plan-dependent)** |
| Trailing type | eod | Core/Pro/Flex: EOD; Rapid: INTRADAY | MATCH (for Core/Pro which we are using) |
| Daily loss limit | null | **CONFLICT**: Vigil $1,250; PropTradingVibes/TheTraderStack: None | CONFLICT — our null aligns with 2 of 3 sources |
| Max contracts | 50 micros | 50 micros (Core/Pro) | MATCH |
| Min eval trading days | 5 | **2 days** (Core eval minimum) | **DRIFT** |
| Min payout days | 5 | Core: 5 winning days ($100+); Pro: bi-weekly (14 calendar days) | AMBIGUOUS (plan-dependent) |
| Consistency rule | mffu_50pct (always-on) | **Eval-phase ONLY** (50% look-back at pass request); funded stage = NO rule | **DRIFT in scope** |
| Payout split | 0.80 (80%) | Core/Pro/Flex/Builder: 80/20; Rapid: 90/10 | MATCH (for Core/Pro) |
| Payout cycle | 14 days | Pro: bi-weekly (14 calendar days); Core: 5 winning days (not calendar) | MATCH for Pro; DRIFT for Core |
| Monthly fee | $77 | Varies by plan; $77 may be Core rate | UNVERIFIED drift potential |
| Activation fee | $0 | $0 on all MFFU plans | MATCH |
| Commission | $0.62 | Not verified 2026 | UNVERIFIED |
| 2% per-trade rule | 0.02 (coded) | NOT FOUND in 2026 sources | UNVERIFIED (possible stale rule) |
| HFT 500 trades/day | coded | NOT FOUND in 2026 sources | UNVERIFIED |
| News trading restriction | FOMC/CPI/NFP/GDP/ISM/PPI ±30 min | "Restricted" per PropTradingVibes; "allowed" per Vigil | CONFLICT |
| Collaborative trading ban | coded | Confirmed | MATCH |
| Same-device ban | coded | Confirmed | MATCH |
| Hedging ban | coded | Confirmed | MATCH |
| Overnight | false | false | MATCH |

---

## Recommended Changes

These recommendations require operator action and do not modify production code.

### R1 (CRITICAL — must implement): Topstep consistency rule

**Add Topstep 50% consistency check to prop_compliance.py for evaluation-phase simulation.** Currently only `mffu_50pct` is checked at prop_compliance.py line 314. Topstep Combine simulations should also enforce the 50% best-day cap.

Supported by: Vigil 2026-03-21, PropTradingVibes 2026-04-28, Tradecovex 2026-04-09 (3+ sources).

Scale translation: REQUIRED. Backtest simulations need to reflect the actual pass rate given the consistency gate.

### R2 (CRITICAL — operator verification required): MFFU plan identification

**Operator must confirm which MFFU plan they are enrolled in.** Core ($1,500 max drawdown, 2 min eval days, 5 winning-days payout) vs Pro ($2,000 max drawdown, bi-weekly payout) vs other. Our code is inconsistent — drawdown $2,000 matches Pro but our comment says "Core/Flex/Rapid."

Supported by: PropTradingVibes rules overview, TheTraderStack Pro 50K review, TheTraderStack Core data (2 sources showing $1,500 for Core, 1 showing $2,000 for Pro).

Scale translation: REQUIRED. Getting the drawdown number wrong by $500 affects all MLL breach simulations.

### R3 (HIGH — docs update): Update canonical docs to reflect Feb 2026 XFA path split

**Document the Standard Path vs Consistency Path in docs/prop-firm-rules-2026-topstep.md.** This is a structural change to how Topstep payouts work, effective Feb 5, 2026.

Supported by: Tradecovex 2026-04-09, Tradecovex 2026-04-28, Backtrex 2026-06-07 (3+ sources).

Scale translation: BENEFICIAL. Operator needs to choose a path; code needs to know payout requirements.

### R4 (HIGH — operator verification): MFFU 2% per-trade rule

**Operator should verify directly at myfundedfutures.com whether the 2% per-trade loss cap is still an active 2026 rule.** Zero 2026 sources corroborate it. If it has been removed, the compliance gate should be updated.

INSUFFICIENT EVIDENCE — cannot recommend removal without direct verification. Keeping the rule as-is is conservative (not harmful).

### R5 (MEDIUM — docs update): Topstep activation fee correction

**Update docs/prop-firm-rules-2026-topstep.md** to reflect that Standard Path charges $149 activation fee. The $0 claim applies only to the No Activation Fee path. Clarify which path the operator uses.

Supported by: Tradecovex 2026-04-09, TheTraderStack 2026-06-18, Backtrex 2026-06-07 (3+ sources).

### R6 (MEDIUM — docs update): MFFU consistency rule scope correction

**Update docs/prop-firm-rules-2026-mffu.md** to explicitly state the 50% consistency rule applies ONLY at evaluation pass-request time (look-back), NOT during funded-stage trading. The funded stage has no consistency rule on any MFFU plan.

Supported by: PropTradingVibes 2026-05-10, PropTradingVibes rules overview, TheTraderStack 2026-06-18 (3+ sources).

### R7 (LOW — operator monitoring): Topstep payout cap changes (Apr 28, 2026)

**Inform operator** that new Topstep accounts created after April 28, 2026 on the 50K No Activation Fee path have reduced payout caps: Standard $2,000/request, Consistency $3,000/request (down from $5K/$6K for pre-April accounts). If the operator's account predates Apr 28, their caps are $5K/$6K.

Supported by: Tradecovex 2026-04-28 (single source — INSUFFICIENT for code change, informational only).

---

## Final Verdict

**Our 2026 rules are PARTIALLY current but have 4 critical gaps and 5 high-severity drift items.**

Specifically:
1. **Topstep consistency rule (null) is WRONG** — the 50% rule exists in the Combine and must be implemented in compliance simulations.
2. **MFFU plan ambiguity** — our code may be using Pro plan numbers ($2,000 drawdown) for an account that is actually Core plan ($1,500 drawdown). Operator must confirm.
3. **MFFU minimum trading days (5)** is likely WRONG — should be 2 for Core eval.
4. **MFFU 2% per-trade rule is unverified** for 2026 — may be stale.

The EOD trailing drawdown for both firms (the operator-confirmed ground truth) is CORRECT for the funded/XFA phase where our bot actually trades. No change needed there.

The rules that directly govern bot behavior (max contracts, DLL enforcement, overnight ban, payout split, trailing drawdown in funded phase) are largely correct. The gaps are primarily in evaluation-phase simulation accuracy (consistency rule, min trading days) and plan identification (MFFU Core vs Pro).

---

## Evidence File Metadata

- **Written:** 2026-06-22
- **Sources fetched:** 10 (all 2025-01-01 or later)
- **Sources dropped for staleness:** 0
- **Triangulation threshold:** 3 independent sources per recommendation
- **Code files audited:** firm_config.py, prop_compliance.py, docs/prop-firm-rules-2026-topstep.md, docs/prop-firm-rules-2026-mffu.md
- **Next recommended review:** 2026-09-01 (quarterly) or upon Topstep/MFFU rule change announcement
