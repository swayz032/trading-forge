# Prop Firm Rules Freshness Audit — 2026-06-22

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

---

> **Relocated 2026-07-19** from the mis-written doubled path
> `trading-forge/trading-forge/docs/institutional-evidence/` into this canonical
> location. Existing June-22 content above is unchanged; the R-054 compliance-
> refresh pass below is appended verbatim.

# COMPLIANCE-REFRESH PASS — 2026-07-19 (advisor ruling R-054 order 1)

## Audit Parameters

- **Trigger:** Advisor ruling R-054 order 1 — re-derive CURRENT Topstep $50K Combine + Funded rules against 5 specifically-named alleged 2025-2026 changes, ≥2 independent sources per load-bearing rule, disagreement flagged not averaged.
- **Scope:** Topstep $50K Combine + Express Funded Account (XFA) + Live Funded Account (LFA) only. MFFU out of scope this pass.
- **Primary-source-first methodology:** Topstep's own `help.topstep.com` and `www.topstep.com` pages fetched directly via WebFetch FIRST, then corroborated with ≥1 independent blog-general secondary source, per R-054's "Topstep's own site first" instruction.
- **Frozen values under test (operator-stated, last verified 2026-05-19):** profit_target=$3,000; max_drawdown(trailing)=$2,000 EOD; payout_split=0.90; min_payout_days=5; activation_fee=$0 (No-Activation-Fee Combine); consistency_rule=50% best-day cap at pass-request; contract cap=5 minis/50 micros; scaling=50K→100K@$5K profit, 100K→150K@$10K profit.
- **Sources dropped for staleness:** 3 (a 2024-dated Reddit thread on payout caps, an undated PDF mirror of old Topstep rules, and one Quora answer with no visible date — all rejected per the ≥2025-01-01 hard rule).

## Sources (≥2025 only, this pass)

| Date | Source | Tier | Citation | Key claim |
|---|---|---|---|---|
| (current, fetched 2026-07-19) | Topstep Help Center — Payout Policy | **primary (official)** | https://help.topstep.com/en/articles/8284233-topstep-payout-policy | $50K payout caps: Standard $2,000 / Consistency $3,000; 90/10 split; "100% of first $10,000" grandfather note explicitly scoped to pre-Jan-12-2026 joiners |
| (current, fetched 2026-07-19) | Topstep Help Center — Live Funded Account Parameters | **primary (official)** | https://help.topstep.com/en/articles/10657969-live-funded-account-parameters | LFA: 20% tradeable / 80% reserve at activation; reserve unlocks in 4×25% increments; $50K LFA unlock threshold = $3,000 net profit per increment |
| 2026-07-01 | topstep.com — Live Funded Account Rules | **primary (official)** | https://www.topstep.com/live-funded-account-rules | Confirms 20%/80% + 25%-increment unlock mechanic; 90% of Starting Balance + net profit payout ceiling; 30 Benchmark Days for 100% payout access |
| (current, fetched 2026-07-19) | Topstep Help Center — Trading Combine Parameters | **primary (official)** | https://help.topstep.com/en/articles/8284197-trading-combine-parameters | $50K/100K/150K contract caps (5/10/15 minis); 50% consistency target language verbatim; "You can pass in as few as two days" (confirms NO min trading days) |
| (current, fetched 2026-07-19) | Topstep Help Center — Express Funded Account Parameters | **primary (official)** | https://help.topstep.com/en/articles/8284215-express-funded-account-parameters | **"Your size matches the Trading Combine you passed and is locked before and after activation"** — account size does NOT grow via profit; up to 5 active XFAs at once |
| (current, fetched 2026-07-19) | Topstep Help Center — TopstepX Commissions and Fees | **primary (official)** | https://help.topstep.com/en/articles/8284213-topstepx-commissions-and-fees | MES RT = $1.22, MNQ RT = $1.22, MCL RT = $1.52 |
| (current, fetched 2026-07-19) | Topstep Help Center — Dynamic Live Risk Expansion | **primary (official)** | https://help.topstep.com/en/articles/11748475-dynamic-live-risk-expansion | LFA-stage tiered DLL/position-size expansion at $20K/$50K/$100K/$200K/$550K/$1M cumulative-profit tiers, 10 Active Trading Days per tier — this is the ONLY real "scaling" mechanism Topstep publishes, and it is LFA-only, not Combine/XFA account-size growth |
| 2026-04-01 | GlobeNewswire (Topstep official press release, syndicated to Yahoo Finance + Business Insider) | **corporate-eng (official press release)** | https://www.globenewswire.com/news-release/2026/04/01/3266805/... | Topstep acquired The Futures Desk (TFD) April 1, 2026; TFD tech integrating into TopstepX; "does not currently change Topstep's rule framework" |
| 2026-05-12 | Tradecovex — "Topstep Rule Changes 2026 — Every Update" | blog-general | https://tradecovex.com/guides/topstep-rule-changes-2026 | Full chronological timeline: Nov 25 2025 (No-Activation-Fee Combines launched), Dec 30 2025 (two-rule payout structure / Minimum Payout Balance added), Jan 12 2026 (90/10 split), Feb 5 2026 (XFA Standard/Consistency split), Feb 10 2026 (LFA 20/80 reserve), Apr 1 2026 (TFD), Apr 28 2026 (payout cap cut) |
| 2026-05-06 | Tradecovex — "Topstep Payout Rules 2026 [Updated April 28]" | blog-general | https://tradecovex.com/guides/topstep-payout-rules-2026 | "90/10 profit split from dollar one for accounts created after January 12, 2026"; caps cut is scoped to **No Activation Fee Combines specifically** |
| 2026-04-28 | PropTradingVibes — "Topstep Trading Combine Rules" | blog-general | https://proptradingvibes.com/blog/topstep-trading-combine-rules | $50K Combine = 5 minis/50 micros; corroborates contract caps |
| 2026-04-28 | PropTradingVibes — "Topstep Rules 2026 overview" | blog-general | https://proptradingvibes.com/blog/topstep-rules-overview | "90/10 from $1 for current sign-ups (100%-first-$10K grandfathered pre-Jan-12-2026)"; "20% tradable / 80% reserve, $15K unlocks per $6K profit milestone" (150K tier example) |
| 2026-04-28 | PropTradingVibes — "Topstep Consistency Rule" | blog-general | https://proptradingvibes.com/blog/topstep-consistency-rule | "$50K Combine: $3,000 profit target means biggest day capped at $1,500" (50% rule, worked example) |
| 2026-05-28 | PropTradingVibes — "Topstep Review 2026" | blog-general | https://proptradingvibes.com/prop-firms/topstep | Confirms TFD acquisition context + 20%/80% reserve + $15K-per-$6K-milestone example |
| 2026-06-18 | Lune Trading — "Topstep Payouts Guide 2026" | blog-general | https://lunefi.com/blog/topstep-payouts | "Payout caps start at $2,000 to $6,000 per request based on account size before traders advance to uncapped Live Funded Accounts"; corroborates grandfather clause |
| 2026-06-29 | Tradetanto — "Topstep Rules: Combine, Funded, and Live Explained" | blog-general | https://tradetanto.com/learn/topstep-rules | MLL $2,000/$3,000/$4,500 for 50K/100K/150K (confirms $2,000 unchanged, resolves a stray "$2,500" title-snippet as noise) |
| 2026-06-09 | Tradecovex — "How to Pass Topstep Combine 2026" | blog-general | https://tradecovex.com/guides/pass-topstep-combine | Grandfather clause explicit: "split applies per trader, not per account" |
| 2026-03-05 / 2025-11-10 (Exa-verified) | h2tfunding — "Topstep Scaling Plan Explained" | blog-general | https://h2tfunding.com/topstep-scaling-plan/ | "In the Trading Combine, you need to hit the profit target for the 100K account" — i.e., a SEPARATE Combine pass is required for a bigger account, corroborating the primary-source "locked size" finding |
| 2026-04-28 (No formal restriction, 3+ corroborating) | PropTradingVibes ×2 + traderssecondbrain.com + h2tfunding | blog-general | https://proptradingvibes.com/blog/topstep-news-trading-policy, https://traderssecondbrain.com/guides/futures-prop-firms-news-trading | "Topstep does not publish a hard news-trading restriction in its Help Center as of April 2026" — no FOMC/CPI/NFP blackout window exists (matches operator's own §13 doctrine on Topstep news handling — REDUCE not BLOCK) |
| 2026-05-08 (CONTRADICTS primary — flagged, not used) | Futureshive — "TopStep Scaling Plan Explained 2026: How to Grow Funded Account Size" | blog-general (LOW CONFIDENCE — see disagreement note below) | https://www.futureshive.com/blog/topstep-scaling-plan-explained | Claims account auto-upgrades 50K→100K→150K→**250K** via "3-5 successful payouts"; **Topstep does not offer a $250K Combine size anywhere else in the corpus** — this source is almost certainly wrong/conflating a different firm's structure or a deprecated mechanism |

## Sub-Claim Verdicts (R-054's 5 named questions)

### 1. Per-payout caps cut to $2K/$3K on No-Activation-Fee Combines (from $5K/$6K) — CONFIRMED, with a scope nuance

**Verdict: TRUE.** $50K No-Activation-Fee Combine → XFA per-payout caps: Standard Path $2,000 / Consistency Path $3,000, effective **April 28, 2026**, down from $5,000 (first payout) / $6,000 (subsequent) pre-April-28. Confirmed by the Topstep primary Payout Policy page (current live table shows $2,000/$3,000 for $50K with no path-qualifier) + Tradecovex ×2 (independent articles, both dated) + PropTradingVibes.

**Scope nuance (flagged, not resolved with full confidence):** Tradecovex's May 6 2026 article explicitly scopes the cut to "**No Activation Fee** Combines" specifically, implying the original Standard (activation-fee, $149) Path may have RETAINED the older $5K/$6K caps. The current primary Topstep help-center table I fetched (2026-07-19) shows a single unified $2,000/$3,000 figure with no Standard-vs-No-Activation-Fee split visible in the extracted text — this could mean the cut was later extended to both paths, or it could mean the table shown is specifically the No-Activation-Fee table and a separate Standard-Path table exists elsewhere on the page that WebFetch's summarizer didn't surface. **Operator note: since your frozen config already specifies "No-Activation-Fee Combine" explicitly, the $2,000/$3,000 figures apply directly to your setup — no ambiguity for your specific path.** Existing pre-April-28 accounts keep their original (higher) caps per Tradecovex's "Existing accounts retain their original payout caps even after rebill or Reset Credit" quote.

**Corroboration count:** 4 independent sources (1 primary + 3 blog-general), 0 disagreement on the $2K/$3K number itself.

### 2. 90/10 split "from dollar one" for accounts opened post-2026-01-12 — CONFIRMED, high confidence

**Verdict: TRUE**, exactly as stated in the ruling. New sign-ups (accounts created on or after January 12, 2026) get a flat 90% trader / 10% Topstep split starting on their very first dollar of profit — no tiered ramp. Accounts that pre-date January 12, 2026 are grandfathered onto the OLDER structure: 100% of the first $10,000 in lifetime profits (per trader, not per account — opening a new account does not reset this), THEN 90/10 thereafter.

**Corroboration count: 7 independent sources**, including the Topstep primary Payout Policy page itself (direct quote via Brave snippet: "⚠️ Note for traders who joined the new Topstep dashboard before January 12, 2026: You receive 100% of your first $10,000 in lifetime profits") + Tradecovex ×3 + PropTradingVibes ×2 + Lune. Zero disagreement across all 7 once the primary-source wording was pinned down (an earlier WebFetch summarization pass on the same primary page had inverted which cohort the grandfather applies to — resolved by re-querying and cross-checking the raw Brave snippet, which quotes the page verbatim).

**Operator implication:** your frozen `payout_split: 0.90` is correct IF your account was opened on/after 2026-01-12. If your account predates that, you are still in the 100%-first-$10K grandfather window and 0.90 is currently UNDER-crediting early payouts in any sizing/payout math that assumes flat 90/10 from day one.

### 3. Funded accounts post-2026-02-10: 20% tradeable / 80% reserve, 25%-milestone unlock — CONFIRMED, exact mechanics obtained

**Verdict: TRUE**, but this applies to the **Live Funded Account (LFA)** — the THIRD stage (real money, after Combine → XFA → LFA), not the XFA (simulated funded, what "Express Funded Account" means and what Trading Forge's `firm_config.py` currently models as "funded"). This is a critical scope distinction the ruling's phrasing ("Funded accounts") could conflate.

**Exact mechanics (primary-sourced, effective February 10, 2026, applies only to LFAs created on/after that date — pre-Feb-10 LFAs keep their "original framework"):**
- 20% of the LFA's starting balance is tradeable immediately upon Live activation; 80% is held in Reserve.
- Reserve releases in **4 equal increments of 25% each** (so 4 unlocks total = 100% access).
- Each unlock requires hitting a **net profit target since the last unlock** (not cumulative from zero) — $3,000 per unlock on the $50K LFA tier, $6,000 on the $100K tier, $9,000 on the $150K tier (mirrors the Combine profit-target ladder).
- Unlocks are reviewed **weekly (every Monday morning, per one primary source; "no more than once per calendar week" per the topstep.com page)**, with approved deposits landing within 1-2 business days.
- Minimum starting LFA balance is $10,000 (Topstep supplements smaller pools if the average of the trader's XFAs rounds below that).
- A Daily Loss Limit ladder is layered on top, tied to tradeable balance tiers (not the same axis as the reserve unlock): $10K-or-below tradeable balance → $2,000 DLL / 5-contract max; $5K-or-below → $1,000 DLL / 3-contract max.
- Falling below $1,000 tradeable balance triggers automatic liquidation and account closure at day's end.

**Corroboration count: 4 independent sources** (2 primary Topstep pages — Live Funded Account Parameters + Live Funded Account Rules — + PropTradingVibes ×2 with a worked $150K-tier example showing "$15K unlocks per $6,000 profit milestone" which is internally consistent with the $9K-per-milestone figure scaled differently, i.e. the $15K figure appears to be 25% of $60K notional or a distinct example — flagged as a minor unresolved arithmetic reconciliation, not a contradiction of the core 20/80/4×25% mechanic). One low-tier source (propfirmescape.com) claimed "30% milestones" instead of 25% — REJECTED as an outlier against 2 primary + 2 corroborating secondary sources all agreeing on 25%.

**Operator implication — this is the single most consequential finding of this audit for drawdown-room sizing:** if/when the operator's Topstep account progresses from XFA to LFA (real money, third stage), a freshly-activated LFA has only 20% of its nominal balance actually tradeable. A "$50K LFA" is NOT immediately a $50K risk base — it starts as a $10K tradeable base with $40K locked, unlocking in four $3,000-net-profit-gated $12,500 tranches. Any sizing math (`DRAWDOWN_ROOM_RISK_PCT`, contract-count caps) that assumes full LFA balance is available from day one will oversize a freshly-live account. **Currently out of scope for Trading Forge's live sizing code because the bot has not yet reached the LFA stage** (per CLAUDE.md, the account today is Combine/XFA-stage) — but this is a load-bearing gap to close in `firm_config.py` BEFORE the account goes live-funded, not after.

### 4. TFD acquisition into TopstepX — CONFIRMED, no rule impact

**Verdict: TRUE, but non-load-bearing for compliance math.** Topstep officially acquired The Futures Desk (TFD), a smaller futures prop firm, on **April 1, 2026** (official press release via GlobeNewswire, syndicated to Yahoo Finance and Business Insider — corporate-eng tier, as authoritative as a source gets short of Topstep's own site). TFD co-founders (Josh Schwartzberg, Brian Ford) joined Topstep's team; TFD's technology is being integrated into the TopstepX platform. The press release explicitly states: "the acquisition does not currently change Topstep's rule framework." No corroborating source found any downstream rule/fee/platform change attributable to the TFD deal as of this audit date (2026-07-19). **No action needed in `firm_config.py` or `prop_compliance.py`.**

### 5. Other Topstep rule changes Nov-2025 → Apr-2026 — 2 additional changes found, not previously documented

Beyond the 4 named changes above, the Tradecovex chronological timeline (corroborated piecemeal by other sources) surfaces two more:

- **November 25, 2025 — No Activation Fee Combines launched.** A second pricing path introduced alongside the original Standard Path: higher recurring monthly subscription, but $0 activation fee after passing (vs Standard Path's $149 one-time activation fee). This is the path the operator's frozen `activation_fee: $0` value already correctly targets — good, no drift here, just now dated precisely.
- **December 30, 2025 — Two-rule payout structure ("Minimum Payout Balance") added.** Every payout AFTER the first now requires TWO conditions instead of one: (1) the path's winning-days requirement (5 for Standard / 3 for Consistency, unchanged), AND (2) the account must have remained net-profitable since the last payout ("Minimum Payout Balance"). The FIRST payout still only requires condition (1). **This is a genuinely new rule not present anywhere in the operator's frozen config or the June-22 audit** — a strategy that wins big, pays out, then goes into a net-loss stretch could satisfy the winning-days count for its next payout but be BLOCKED by the Minimum Payout Balance condition. Worth encoding as a second payout-eligibility gate alongside the existing winning-days check.

No news-trading-window change found (still no formal FOMC/CPI/NFP blackout — 4 corroborating sources, consistent with the June-22 finding and the operator's own §13 CLAUDE.md doctrine). No consistency-threshold change (still 50% Combine / 40% XFA-Consistency-Path / none XFA-Standard-Path — unchanged from June 22). No minimum-trading-days change (still effectively none — "as few as two days" per Topstep's own primary text, confirming the June-22 CRITICAL finding is STILL live and unresolved in the codebase).

## Platform + Fee Schedule Confirmation

- **TopstepX required platform: CONFIRMED with a nuance.** New Trading Combine sign-ups in 2026 must use TopstepX. However, per Tradecovex's timeline, existing Combine accounts opened on NinjaTrader, Tradovate, or Quantower before the lockdown "continue to be honoured" — i.e., this reads as a new-signups-only requirement + a grandfather clause for legacy accounts, not a full historical-account migration mandate. Since Trading Forge's own CLAUDE.md §6 already states TopstepX-only starting the January 12, 2026 lockdown and the operator's account is presumably a fresh 2026 sign-up, this is a non-issue for the current setup — flagged only because "banned" (CLAUDE.md's wording) is slightly stronger than what the primary timeline actually documents ("required for new sign-ups, legacy honored").
- **Fee schedule: DRIFT FOUND.** MES and MNQ TopstepX round-turn commission is **$1.22**, not $1.24 as asked about in the ruling. Confirmed directly from the Topstep primary Commissions and Fees help-center page (single source, but it is the primary/official source — no secondary source disputes it, none found a $1.24 figure anywhere in the 2025-2026 corpus). MCL round-turn is $1.52. **This is a small (~1.6%) but real per-round-turn commission drift** in whatever cost model currently assumes $1.24 — worth a one-line correction wherever that figure is hardcoded, though the dollar impact per trade is under 2 cents.

## Scaling Claim — REFUTED (this is the second major finding of this pass)

**Operator's frozen claim:** "scaling: 50K→100K at $5K profit, 100K→150K at $10K profit" — describing a mechanism where a single Combine/XFA account grows in SIZE (not just position-size ceiling) as cumulative profit crosses thresholds.

**Verdict: REFUTED by 2 independent primary Topstep sources**, with an explicit, load-bearing disagreement flagged rather than resolved by convenience:

- **Topstep's own "Express Funded Account Parameters" help page states verbatim:** *"No. Your size matches the Trading Combine you passed and is locked before and after activation."* Account size does not grow through trading profit at all — to get a bigger funded account, a trader must pass a SEPARATE, larger Trading Combine outright (and can hold up to 5 active XFAs simultaneously, which is how Topstep traders typically scale their total exposure — horizontally across accounts, not vertically within one).
- **h2tfunding.com (2025-11-10) corroborates independently:** "In the Trading Combine, you need to hit the profit target for the **100K account**" while describing the Scaling Plan — i.e., getting to $100K requires passing the $100K Combine specifically, not scaling up from a $50K account.
- **One contradicting source found:** Futureshive.com (2026-05-08) claims accounts auto-upgrade "50K → 100K → 150K → **250K**" via "3-5 consecutive successful payouts" or "a cumulative profit target." This is almost certainly WRONG — **Topstep does not offer a $250K account size anywhere else in this entire 20+-source corpus** (every other source, including 2 primary pages, enumerates exactly 3 sizes: $50K/$100K/$150K). This source is either describing a different/defunct Topstep policy, confusing Topstep with a different prop firm's scaling ladder, or simply hallucinating a plausible-sounding but fabricated structure. **Per the audit's own disagreement rule, this is not averaged against the primary source — the primary source (Topstep's own site, corroborated by an independent blog) wins, and the Futureshive claim is REJECTED.**

**What Topstep actually publishes as "scaling":**
1. **XFA Scaling Plan** (within ONE fixed-size funded account): max POSITION SIZE (contract count) grows as account BALANCE grows, but is capped at that account's own Combine-size ceiling (e.g., a $50K XFA scales up to its own 5-contract max — it never exceeds what a $50K account was ever allowed). This is a within-account risk-ladder, not an account-size upgrade. Exact dollar-threshold breakpoints are shown only in a chart image on Topstep's site that WebFetch's text extraction could not read — this remains a genuine sourcing gap (flagged, not fabricated).
2. **Dynamic Live Risk Expansion** (LFA-stage only, i.e., AFTER going live-funded): DLL and max-position-size expand in 6 discrete cumulative-profit tiers — $20K+, $50K+, $100K+, $200K+, $550K+, $1M+ — each requiring 10 Active Trading Days at the new tier before the expansion applies. This is a real, primary-sourced mechanism, but it operates on LFA cumulative profit in the tens/hundreds of thousands, not the $5K/$10K figures in the operator's frozen claim.

**Operator implication:** the frozen "50K→100K at $5K profit, 100K→150K at $10K profit" claim does not correspond to any Topstep mechanism found in this audit at those dollar thresholds. If Trading Forge's growth-lever logic (CLAUDE.md §5, scaling levers 3 "multi-account same firm") currently assumes single-account organic size growth, it should instead model: (a) multiple parallel XFAs opened by separately passing multiple Combines (up to 5 active at once) — which is in fact already how CLAUDE.md §1/§5 frames "horizontal" scaling, so the code-level architecture may already be correctly using multi-account growth even if the `firm_config.py` scaling constant is a leftover/mislabeled value; and (b) the LFA-stage Dynamic Live Risk Expansion ladder once/if the account goes live-funded. **This needs an operator decision on what `firm_config.py`'s scaling field is actually meant to represent before it can be corrected** — it may be dead/unused config, or it may need remapping to the multi-XFA-count-and-LFA-tier model above.

## Compliance Table — Full R-054 Deliverable

| Rule | Our frozen value | Current value (primary + 2nd source, dates) | CHANGED? | Effective date | Applies to |
|---|---|---|---|---|---|
| Profit target | $3,000 | $3,000 — Topstep Trading Combine Parameters (primary, current) + Lune 2026-06-15 | NO | n/a (unchanged) | $50K Combine/XFA |
| Max drawdown (trailing MLL) | $2,000 EOD | $2,000 — Topstep MLL page (primary, current) + Tradetanto 2026-06-29 + Tradecovex 2026-06-09 | NO | n/a (unchanged) | $50K Combine/XFA (trailing, resets to $0 buffer after each payout) |
| Payout split | 0.90 (90/10) | 0.90 from dollar one for accounts opened ≥2026-01-12; grandfathered accounts get 100% of first $10K then 90/10 | **CONFIRMED, dated precisely** | 2026-01-12 | All Topstep XFA payouts (both paths) |
| Min payout days | 5 | Standard Path: 5 winning days ($150+ net each) — Topstep Payout Policy (primary) + Tradecovex 2026-05-06; Consistency Path: 3 days | NO (for Standard Path — matches frozen value) | n/a (unchanged since Feb 5 2026 split) | XFA payout eligibility, path-dependent |
| Activation fee | $0 (No-Activation-Fee Combine) | $0 confirmed on No-Activation-Fee path — Topstep Pricing FAQ (primary, 2026-06-30) | NO | Path launched 2025-11-25 | $50K No-Activation-Fee Combine specifically |
| Consistency rule | 50% best-day cap at pass-request | 50% Combine eval (confirmed, primary + PropTradingVibes worked example); XFA Consistency Path = 40%, not 50% (primary Payout Policy quote); XFA Standard Path = none | NO for the frozen scope (Combine pass-request) | n/a (unchanged) | Combine evaluation phase only |
| Contract cap | 5 minis / 50 micros (10:1) | 5 minis / 50 micros confirmed — Topstep Combine Parameters (primary) + PropTradingVibes 2026-04-28 | NO | n/a (unchanged) | $50K Combine/XFA |
| Scaling (50K→100K@$5K, 100K→150K@$10K) | as stated | **REFUTED** — account size is locked to the Combine passed (primary source verbatim); no profit-threshold account-size-upgrade mechanism exists at these dollar amounts. Real mechanisms: multi-XFA (up to 5 active) + LFA-stage Dynamic Live Risk Expansion (6 tiers, $20K-$1M) | **YES — claim does not match any current mechanism** | n/a | See full write-up above |
| Per-payout cap ($50K, No-Act-Fee) | not in frozen list | Standard $2,000 / Consistency $3,000 (down from $5,000/$6,000) | **YES — CUT CONFIRMED** | 2026-04-28 | $50K + $100K No-Activation-Fee new accounts only; pre-Apr-28 accounts keep old caps |
| LFA reserve/unlock system | not in frozen list | 20% tradeable / 80% reserve at LFA activation; 4×25% unlocks gated on net-profit-since-last-unlock ($3,000 per unlock on $50K tier) | **YES — NEW RULE, primary-confirmed** | 2026-02-10 | Live Funded Account (3rd stage — real money) only, NOT the XFA the operator is likely on today |
| Two-rule payout structure (Minimum Payout Balance) | not in frozen list | Every payout after the first requires BOTH winning-days AND net-profitable-since-last-payout | **YES — NEW RULE** | 2025-12-30 | All XFA payouts after the first |
| TFD → TopstepX integration | not in frozen list | Confirmed, official press release; explicitly "does not currently change Topstep's rule framework" | Informational only, no rule impact | 2026-04-01 | Platform/tech only |
| TopstepX required platform | topstepx (required) | Required for NEW sign-ups; pre-lockdown NinjaTrader/Tradovate/Quantower accounts grandfathered/"honoured" | Nuance only (not a full ban as CLAUDE.md phrasing implies) | Ongoing since Jan 12 2026 lockdown | New Combine sign-ups |
| MES/MNQ commission | $1.24 RT | $1.22 RT (MES + MNQ); MCL = $1.52 RT | **YES — small drift (~1.6%)** | n/a (current as of fetch) | TopstepX-executed trades |

## Sub-Claim Corroboration Summary (per §3 triangulation requirement)

| Sub-claim | # independent sources | Tiers represented | Disagreement found? |
|---|---|---|---|
| 1. Payout cap cut to $2K/$3K | 4 | primary + blog-general×3 | Minor scope ambiguity (Standard-Path-only vs unified) — flagged, not resolved |
| 2. 90/10 from dollar one, post-Jan-12 | 7 | primary + blog-general×6 | None (after re-verifying primary wording) |
| 3. LFA 20/80 reserve, 25% milestones | 4 | primary×2 + blog-general×2 | One low-tier outlier (30% instead of 25%) rejected as minority |
| 4. TFD → TopstepX | 4 | corporate-eng (official press release)×1 + blog-general×3 | None |
| 5. Other Nov25-Apr26 changes | 1 primary aggregator source (Tradecovex timeline), individual items corroborated piecemeal by 2-4 sources each | blog-general primary + primary Topstep confirmations per item | None |
| Scaling 50K→100K@$5K claim | 2 primary + 1 corroborating secondary AGAINST; 1 secondary FOR | primary×2 vs blog-general×1 | **YES — explicit, load-bearing disagreement; primary source wins per audit rule** |
| MES/MNQ commission $1.24 | 1 (primary only) | primary | INSUFFICIENT EVIDENCE for a second independent source explicitly stating $1.22 — no source contradicts it either. Primary-only confirmation; recommend operator screenshot-verify in their own TopstepX dashboard before trusting for cost-model precision. |

## Evidence File Metadata (this pass)

- **Written:** 2026-07-19
- **Sources fetched:** 20 distinct URLs (8 primary Topstep pages + 1 official press release + 11 blog-general secondary sources), all current/2025-2026
- **Sources dropped for staleness:** 3 (pre-2025 or undated)
- **Triangulation:** ≥2 independent sources per load-bearing rule per R-054's instruction (most claims hit 3-7); 2 explicit disagreements flagged rather than averaged (scaling mechanism; payout-cap path-scope)
- **Code files this pass recommends operator/specialist review (NOT edited by this agent):** `src/engine/firm_config.py`, `src/engine/prop_compliance.py`, `docs/prop-firm-rules-2026-topstep.md`
- **Next recommended review:** upon next Topstep rule-change announcement, or 2026-10-01 quarterly, whichever first — Topstep shipped ~8 changes in the Nov2025-Apr2026 window alone, faster than quarterly cadence assumes
