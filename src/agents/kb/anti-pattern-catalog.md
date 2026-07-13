# Anti-Pattern Catalog — Trading Forge KB Card

> **Loaded by:** `strategy_proposer`, `nightly_review`, and `dsl_quality_critic`.
> **Purpose:** Each anti-pattern below is a known way that a strategy LOOKS great but FAILS in production. Use these patterns as the first checklist before approving any synthesized DSL.
> **Authority:** The patterns are advisory for the proposer (use to AVOID generating them) and DETECTIVE for the critic (use to REJECT). When the critic flags any of these, lifecycle promotion is blocked.
> **Last updated:** 2026-05-04. Sourced from arXiv 2025–2026 quant safety papers, alphaarchitect, robotwealth, dev.to LLM-loop post, and the Trading Forge graveyard.

## How to use this catalog

Each entry has:
- **Pattern name** (canonical, lowercase-snake-case for tagging)
- **Description** (one or two sentences — what does the failure mode look like?)
- **Why it fails** (the root cause — usually a specific cognitive or statistical bug)
- **How to detect** (concrete checks — regex, numeric ranges, structural rules — that the proposer or critic can run)
- **Source citation**

When emitting an `audit_log` rejection row, use the snake-case pattern name in `result.reason`, e.g. `result.reason: "anti_pattern_detected:tight_parameter_overfitting"`.

---

## 1. `tight_parameter_overfitting`

**Description.** The strategy proposes parameters at unusual decimal precision (RSI period = 13.7, EMA fast = 9.3, ATR multiplier = 1.842) — values that suggest an Optuna run picked the single highest-Sharpe combination on in-sample data without testing robustness.

**Why it fails.** A genuine edge works across a parameter range. If the strategy needs `period=13.7` to be profitable, it's exploiting an in-sample idiosyncrasy that won't survive walk-forward.

**How to detect.**
- Any numeric param with > 1 decimal places of precision (regex on `entry_params` values: `\d+\.\d{2,}`).
- Any param value sitting at an unusual non-canonical value relative to the indicator catalog defaults (e.g. RSI period = 11 or 17 — neither in canonical 7/14/21 set).
- Optuna seed annotation in description naming a single best trial without parameter-range robustness language.

**Detection rule (DSL JSON):**
```js
function detectTightParamOverfit(dsl) {
  const params = Object.values(dsl.entry_params || {}).concat(Object.values(dsl.exit_params || {}));
  return params.some(p =>
    typeof p === 'number' && /\d+\.\d{2,}/.test(String(p))
  );
}
```

**Source.** RobotWealth 2026 — robust parameter selection. AlphaArchitect — overfitting in machine-learning strategies.

---

## 2. `regime_fragile_setup`

**Description.** The strategy works only within a narrow historical window (e.g. 2010–2019 calibration with no validation on COVID 2020 or rate-shock 2022 data). When the market exits the calibration regime, performance collapses.

**Why it fails.** Strategies need to survive `TRENDING_UP`, `TRENDING_DOWN`, `RANGE_BOUND`, `HIGH_VOL`, and `LOW_VOL` at minimum. A regime-fragile strategy is implicitly assuming the next 12 months will look like the calibration window — a bet against history.

**How to detect.**
- Backtest window narrower than 5 years.
- No A4 Frankenstein test result attached.
- No mention of out-of-sample regime testing in description.
- Missing `preferred_regime` or `preferred_regime` set to a single regime AND `bypass_news_blackout` is false (the strategy claims it works only in one regime AND has no event override).

**Detection rule (DSL):**
```js
function detectRegimeFragile(dsl, evidence) {
  if (!dsl.preferred_regime) return true;  // missing tag is fragile
  if (!evidence.frankenstein_test_passed) return true;  // no A4 evidence
  if (evidence.backtest_window_years < 5) return true;
  return false;
}
```

**Source.** Marcos López de Prado, "Advances in Financial Machine Learning". arXiv:2510.05533. Trading Forge `src/engine/frankenstein_test.py`.

---

## 3. `look_ahead_close_bias`

**Engine contract (W23F live-fix 2026-05-19).** The Trading Forge backtest engine (`src/engine/backtester.py:70-83`) **already shifts all entry signals +1 bar via `np.roll()` before passing them to vectorbt**. A signal generated from bar N's data fills at bar N+1's close price. This is engine-level next-bar enforcement — DSL authors do NOT need to write explicit "next bar" qualifiers. Bare `close > orh_15m` or `high > prev_swing_high` is SAFE.

**Description.** True look-ahead bias is when the DSL references **values the engine cannot shift away** — values that are functions of *future* bars, not the current evaluated bar. The engine's shift only protects against same-bar fills; it cannot rescue references to bars that don't exist yet.

**Why it still matters.** A DSL field like `entry_long: "tomorrow.high > today.high"` or `indicator: "rsi_centered_window_5"` (a 5-bar centered window includes future bars) bypasses the engine's shift because the value itself is contaminated. No amount of next-bar shifting fixes a forward-looking indicator.

**How to detect (narrow rule — engine-aware).**
- DSL field text contains `tomorrow`, `future_`, `next_`, or `bar_+N` where N > 0 (impossible references).
- Indicator name contains `centered_window`, `lookahead`, `future_`, or any window function with `center=True`.
- Strategy config has `same_bar_fill: true` or `signal_lag: 0` (explicit opt-out of engine's auto-shift).
- Backtest results show **100% fill rate combined with zero slippage** — empirical signal of same-bar fills even if DSL text doesn't reveal it.

**Detection rule (DSL) — narrow, engine-aware:**
```js
function detectLookAheadBias(dsl) {
  const cond = JSON.stringify(dsl).toLowerCase();
  // Bare close/high/low/open references are SAFE — engine auto-shifts via np.roll().
  // Only flag DSL that references values the engine cannot shift:
  const impossibleRefs = /tomorrow|future_|next_close|next_high|bar_\+\d+|centered_window|lookahead/.test(cond);
  const sameBarOptOut = dsl.signal_lag === 0 || dsl.same_bar_fill === true || dsl.fill_on === "close";
  return impossibleRefs || sameBarOptOut;
}
```

**What changed (W23F live-fix 2026-05-19).** The previous detection rule flagged any entry condition containing the words "close", "high", or "low" without a "next bar" qualifier. This was a false positive: faithful extraction of "buy on close above ORH" from a YouTube tutorial got rejected even though the engine handles next-bar shift automatically. Cycle 1 of the W23F live test (2026-05-19 09:22 UTC) was the trigger — a clean ORB extract got killed and zero strategies graduated. The fix narrows the rule to actual impossible references, leaving the engine to do its job.

**Pinned engine contract.** `src/engine/backtester.py` shifts entries +1 bar. Any future critic (LLM or static analysis) MUST NOT re-introduce a bare-close-reference rejection. If you find yourself writing one, you're double-shifting — read the backtester.py comment block at line 70-83 first.

**Source.** Trading Forge backtester `src/engine/backtester.py` — fill-model invariants. arXiv 2025 backtest-bias survey.

---

## 3b. Factory conventions critics MUST NOT flag as incoherence

W23F live-fix 2026-05-19 — cycle 3 produced a clean ORB DSL that the critic rejected on 7 concerns, of which 3 were the critic misreading deliberate factory conventions. Future critics MUST recognize these patterns and skip them:

### `high < low` is a deliberate never-true sentinel

When a strategy has `direction: "long"`, the compiler writes `entry_short: "high < low"` (and vice versa for short-only). This is a **never-true grammar marker** that tells the engine "this direction is intentionally disabled, never generate a signal." It is NOT nonsensical literal logic.

**Critic instruction:** if `entry_short === "high < low"` AND `direction === "long"`, treat the field as DISABLED, not incoherent. Same for `entry_long === "high < low"` AND `direction === "short"`. Do not raise a concern.

**Source.** `src/server/lib/dsl-compiler.ts` lines 84-202 — every primitive uses this sentinel pattern.

### `entry_indicator` (canonical) ↔ `indicators[].type` (compiler-internal) naming layers

The DSL has two indicator-name layers:
- `entry_indicator` — graduator's CANONICAL name (e.g., `session_open_breakout`, `ema_crossover`, `rsi_reversal`). This is the human-facing label.
- `indicators[].type` — DSL compiler's INTERNAL primitive type (e.g., `opening_range_breakout`, `ema`, `rsi`). This is the engine's lookup key.

These two layers can use **different strings for the same concept** and that's intentional. `session_open_breakout` (canonical) maps to `opening_range_breakout` (compiler primitive). The compiler maintains this mapping in `dsl-compiler.ts:174`.

**Critic instruction:** when `entry_indicator` and `indicators[N].type` use different but compatible names, do NOT flag as mismatch. Check the canonical→primitive mapping in `dsl-compiler.ts` for the allowed pairs. The relevant pairs as of W23F:
- `session_open_breakout` ↔ `opening_range_breakout`
- (all other indicators use the same name at both layers)

### Prose fields (`entry_long_prose`, `exit_prose`) vs compiled struct

Prose fields contain the **original scout-extracted text** (verbatim from YouTube/Reddit/web source). Compiled struct fields contain the **engine-canonical form** after the DSL compiler + framework-overlay rewrite. These can and SHOULD diverge when:
- Scout extracted "buy on momentum candle close" → compiler emits `entry_long: "close > orh_15m"` (compiled is more specific)
- Framework-overlay rewrites exit to Style D 50%@1R → original prose said "1.5R target" (overlay overrides)

**Critic instruction:** compiled struct is the SOURCE OF TRUTH. Prose is preserved for human readability + audit trail. Do NOT flag prose ↔ struct divergence as incoherence. Only flag if compiled struct itself is wrong (e.g., `entry_long: "close > orh_15m"` but `entry_indicator: "rsi_reversal"` — that's a real struct-internal mismatch).

**Source.** `src/server/services/framework-overlay.ts` writes canonical struct + preserves prose. `src/server/services/direct-bucket-graduator.ts:1261` originates prose from scout text.

---

## 4. `llm_hallucination_loop`

**Description.** The LLM proposes a strategy that is structurally identical to N existing strategies in the journal — same indicator, same params, same regime — just renamed. Mode-collapse failure mode where the proposer keeps producing the same template.

**Why it fails.** Wastes backtest compute. Creates fake portfolio diversity at the lifecycle layer. Is the canonical failure mode of using single-LLM strategy generation without diversity gates (StockBench 2025).

**How to detect.**
- Cosine similarity > 0.85 against existing accepted strategies' DSL feature vectors (`strategy_dsl_features` table — see W17 / C9).
- Exact match on `dsl_fingerprint = sha256(canonicalJson(dsl))`.
- Inline batch check: > 3 proposals in same call referencing the same `entry_indicator` with similar params.

**Detection rule:** delegate to `dsl-diversity-service.ts:checkDslDiversity()`. The proposer must NOT attempt to detect this itself — the C9 service is the canonical gate. Proposer's role is to AVOID generating mode-collapsed proposals; if a candidate is similar to a recent proposal, regenerate with different parameters or a different indicator.

**Source.** dev.to/whetlan LLM-loop post 2026. StockBench 2025. Trading Forge `src/server/services/dsl-diversity-service.ts`.

---

## 5. `survivorship_bias_dataset`

**Description.** Strategy backtested only on currently-listed contracts (current MES, MNQ, MCL) without accounting for delisted or migrated contracts. For futures this is less acute than equities but still bites on commodity rolls.

**Why it fails.** A dataset that omits failed/delisted instruments overstates returns. For Trading Forge specifically: any strategy backtested on raw (non-ratio-adjusted) continuous contracts is technically survivorship-biased on the roll boundaries.

**How to detect.**
- DSL sources reference raw continuous contracts (no `ratio_adj/` prefix in source path).
- No mention of Databento ratio-adjusted data.
- Description references "continuous contract" without "ratio-adjusted" qualifier.

**Detection rule:** primarily audited at backtest-service level, but the proposer should reject any research-find that proposes raw-contract backtesting.

**Source.** AlphaArchitect 2026 — survivorship in commodities futures. Trading Forge CLAUDE.md "ALWAYS use ratio-adjusted continuous contracts for backtesting".

---

## 6. `prop_firm_drawdown_trap`

**Description.** Strategy passes the Trading Forge backtest performance gate ($250/day, $2,000 max DD) but its in-bar drawdown profile is too tight for a real prop firm — even though end-of-day max DD looks fine, the strategy spends time at $1,950 unrealized DD that triggers liquidation on the EOD trailing.

**Why it fails.** Trading Forge backtester reports `max_drawdown` at end-of-day. Topstep 50K's $2,000 trailing drawdown is checked at the CLOSE of every day. A strategy that closes at –$1,800 on day 1 then has an open intraday DD of $2,100 on day 2 (closing back to –$1,500) blows the account on day 2 even though the daily-close DD looks fine.

**How to detect.**
- `max_intraday_drawdown` (if reported) > $1,800 for any 50K-targeted strategy.
- Stop-loss ATR multiple > 2.0 + position size = max contracts → potential single-trade DD > $1,500.
- Strategy holds across a planned macro release without `bypass_news_blackout: true`.

**Detection rule:**
```js
function detectPropDDTrap(dsl, evidence) {
  const maxRiskPerTrade = (dsl.stop_loss_atr_multiple || 1.5)
                       * (dsl.max_contracts || 1)
                       * estimateAtrDollarValue(dsl.symbol, dsl.timeframe);
  return maxRiskPerTrade > 1500; // single-trade risk > 75% of $2K limit
}
```

**Source.** Trading Forge `src/shared/firm-stage-rules.json` and
`docs/prop-firm-rules-2026-topstep.md`. Real-world Apex 2025 funded-trader bans
remain historical context only.

---

## 7. `high_performance_ratio_mirage`

**Description.** Strategy reports Sharpe > 2.5, win-rate > 75%, profit factor > 3.0 — performance numbers so good they almost certainly result from in-sample overfitting, lookahead bias, or insufficient slippage.

**Why it fails.** Real intraday futures strategies on micros (MES/MNQ/MCL) plateau around Sharpe 1.5–2.0, profit factor 1.7–2.2, win rate 50–60% (with 1:2 R:R). Numbers above this band are almost always artifacts.

**How to detect.**
- Reported Sharpe > 2.5 OR win_rate > 0.75 OR profit_factor > 3.0
- AND OOS sample size < 100 trades
- AND no walk-forward result attached

**Detection rule:**
```js
function detectPerformanceMirage(metrics) {
  const tooGood = (
    metrics.sharpe_ratio > 2.5 ||
    metrics.win_rate > 0.75 ||
    metrics.profit_factor > 3.0
  );
  const insufficientEvidence = (
    !metrics.walk_forward_passed ||
    metrics.oos_trade_count < 100
  );
  return tooGood && insufficientEvidence;
}
```

**Source.** AlphaArchitect 2026 — too-good-to-be-true backtest patterns. arXiv:2510.09312 (CoT controllability and quant integrity).

---

## 8. `news_headline_as_strategy` (Trading Forge specific)

**Description.** Scout returns a news headline like "S&P 500 Risk-On Rotation Continues as Tech Leads" or "Apple Reports Strong Q1 Earnings" and the proposer treats it as a strategy candidate. The article is market commentary, not a systematic strategy with extractable entry/exit rules.

**Why it fails.** News articles describe what already happened. A strategy needs forward-looking conditional logic — "WHEN X HAPPENS, ENTER Y, EXIT AT Z". A headline describes X happening but tells the trader nothing about Y or Z.

**This is the user's stated pet peeve.** "The scout is not supposed to bring back raw data." News belongs in the `market_news_intel` signal-type stream, NOT the `strategy_candidate` stream.

**How to detect.**
- Source URL contains news domains: `bloomberg.com`, `reuters.com`, `cnbc.com`, `marketwatch.com`, `wsj.com`, `ft.com`, `seekingalpha.com/news`, `forbes.com/markets`
- Title contains commentary patterns: `/breaks?\s*new\s*high/i`, `/closes?\s*at/i`, `/falls?\s*amid/i`, `/rally|rotation|surge/i`
- Description contains < 2 of: `entry_condition`, `exit`, `stop`, `target`, indicator name from indicator-catalog
- Description references specific dollar prices ("S&P at 5,847") rather than relative levels ("breakout above prior day high")

**Detection rule:**
```js
function detectNewsHeadline(scoutFind) {
  const newsDomains = /bloomberg\.com|reuters\.com|cnbc\.com|marketwatch\.com|wsj\.com|ft\.com|seekingalpha\.com\/news|forbes\.com\/markets/i;
  if (newsDomains.test(scoutFind.url || '')) return true;
  const commentary = /breaks?\s*new\s*high|closes?\s*at|falls?\s*amid|rally|rotation|surge|risk-on|risk-off/i;
  if (commentary.test(scoutFind.title || '')) {
    const desc = (scoutFind.description || '').toLowerCase();
    const strategyTerms = ['entry', 'exit', 'stop', 'target', 'rsi', 'ema', 'macd', 'atr', 'vwap'];
    const matches = strategyTerms.filter(t => desc.includes(t)).length;
    return matches < 2;
  }
  return false;
}
```

**The pattern is so important that it has its own rejected-route.** When `scout_auditor` detects this pattern, it MUST return `{ reject: true, reason: "news_headline_not_strategy", score: <=2 }`. The article should be re-routed to the `market_news_intel` signal-type stream (handled by 5M-brave-news-watcher), NOT discarded.

**Source.** User's stated principle from Pass 1 plan: *"The scout is not supposed to bring back raw data."* Trading Forge plan `image-72-i-want-greedy-wigderson.md` — Problem B.

---

## Cross-cutting rules

- **An anti-pattern hit blocks promotion.** When ANY of these patterns is detected and `decisionAuthority="gate"`, the strategy is rejected (not just warned).
- **Multiple anti-pattern hits compound.** When 2+ patterns hit, the rejection severity escalates — proposer must regenerate from scratch, not edit the existing proposal.
- **Audit log every detection.** Even a warning-only detection writes `audit_log` row with `result.reason: "anti_pattern_detected:<name>"`. Forensics matter.
- **Patterns evolve.** When a strategy that PASSED all anti-patterns later fails in production, the post-mortem should propose a NEW pattern. Add it here.

---

## Sources

- arXiv:2412.20138 (TradingAgents 2025) — multi-LLM consensus and hallucination prevention
- arXiv:2510.05533 (Columbia 2026 quant survey) — overfitting and regime fragility
- arXiv:2510.09312 — CoT controllability and quant strategy integrity
- AlphaArchitect — survivorship bias and overfitting in backtests
- RobotWealth — robust parameter selection
- dev.to/whetlan — LLM mode-collapse loop
- StockBench 2025 — LLM agent failure to outperform passive benchmarks
- Trading Forge `src/server/services/dsl-diversity-service.ts` — C9 implementation
- Trading Forge `src/engine/frankenstein_test.py` — A4 implementation
- Trading Forge `src/shared/firm-stage-rules.json` — active drawdown gate source
- Trading Forge graveyard (`strategy_signal_vectors` cosine clusters) — empirical pattern library
