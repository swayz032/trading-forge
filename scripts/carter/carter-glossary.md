# Carter — Plain-English Glossary

Carter's reference for translating Trading Forge's technical vocabulary into plain
English. Definitions are sourced from CLAUDE.md (§4 Trading Framework, §12 Hard Gates),
the Trading Forge System Map, and the 2026 prop-firm rule docs. When Carter uses any of
these terms by voice, he pairs the term with its plain-English meaning and, where
relevant, leads with a good / borderline / bad verdict.

---

## Naming taxonomy (don't confuse these)

- **Trading Forge** — the BACKEND systems: the backtest engine, the validation
  gates, the lifecycle pipeline, the scout/graduator. Plain English: "the
  machinery under the hood."
- **Slumhouse** — the FRONTEND / clubhouse portal. Carter lives in its Office.
  Plain English: "the website / control room you log into."
- **Slumdawg** — the trading BOT itself. Plain English: "the bot that trades."
- **Slumdawg traders** — the trading MEMBERS (the operator and family members
  each running their own bot/account). Plain English: "the people running bots."

## Research boundary (strategies have ONE door)

- **Strategies enter ONLY through YouTube extraction.** A trading strategy
  becomes a CANDIDATE only by extracting it from a YouTube video's transcript
  through the existing extraction pipeline (`extract_youtube_strategy`), which
  deposits it into the pending scout bucket. Plain English: "new strategies only
  ever come from YouTube videos we extract."
- **Web search, Reddit, and research papers are for NON-strategy research only**
  — institutional/market/trading/bot/growth questions, sentiment, "how do desks
  do X." They NEVER source a strategy. Plain English: "the web and Reddit are
  for answering questions, never for finding strategies to trade."

---

## Strategy lifecycle states

A strategy climbs a ladder of validation stages. Each promotion is gated; nothing skips
ahead. The full ladder is:

`CANDIDATE → TESTING → SHADOW → PAPER → DEPLOY_READY → PILOT → DEPLOYED`

- **CANDIDATE** — A freshly discovered idea (from a YouTube transcript, a Reddit post,
  or a web article). Not yet proven. Plain English: "an idea we found, not tested yet."
- **TESTING** — Being backtested and run through the early statistical gates. Plain
  English: "we're checking whether the idea actually held up on historical data."
- **SHADOW** — Generates signals but contacts NO broker — signals are logged only and
  compared against what the backtest expected. Catches "training-serving skew" (the
  strategy behaving differently live than in testing). Plain English: "running silently
  to make sure it behaves the same way live as it did in testing — no real or paper
  orders yet."
- **PAPER** — Paper-trades on a simulated/broker-paper account for several days to prove
  it works in real time. Plain English: "trading on a practice account with fake money."
- **DEPLOY_READY** — Passed every hard gate; waiting for the operator to approve it.
  Plain English: "it passed everything and is waiting for your go-ahead."
- **PILOT** — Approved and running live at small size, watched closely. Plain English:
  "live with real money, small size, on probation."
- **DEPLOYED** — Fully live and trusted. Plain English: "live and trusted, running at
  normal size."
- **DECLINING** — A live strategy whose edge is fading or whose market regime has
  drifted; auto-demoted toward retraining. Plain English: "this one's losing its edge,
  we're pulling it back to re-check it."
- **GRAVEYARD** — Retired/killed. Plain English: "shelved — it didn't work or stopped
  working."

---

## Validation gates and statistics (the hard gates)

- **B14 Survival Twin / probability-of-ruin CI** — A Monte Carlo simulation that asks:
  across thousands of simulated futures, how often does this strategy breach a prop
  firm's rules — trailing-drawdown blow-up, daily-loss-limit hit, or payout denial?
  "Ruin" here means the account gets shut down or a payout is denied, NOT just a losing
  day. The gate reads the **conservative upper bound** of the confidence interval
  (`ci_high`) and **blocks promotion when that upper bound is above 0.20 (20 percent).**
  Plain English: "the chance this account gets shut down or a payout denied — and we use
  the worst-case end of that estimate. Above 20 percent, it's blocked."
- **WFE — Walk-Forward Efficiency** — How well the strategy held up on data it was NOT
  tuned on, versus the data it WAS tuned on. **Floor is 0.70**; below that it's blocked.
  Plain English: "how much of the backtest profit survives on fresh, unseen data — we
  need at least 70 percent."
- **PBO — Probability of Backtest Overfitting** — The chance the strategy only looked
  good because we tried many variations and got lucky (curve-fitting). **Must be under
  15 percent** at the TESTING-to-SHADOW/PAPER gate. Plain English: "the chance this
  result was just luck from testing too many versions — we need it under 15 percent."
- **BIF — Backtest Inflation Factor** — How much the best-looking in-sample result was
  inflated by selection (picking the winner out of many tries). Optimized Sharpe divided
  by walk-forward Sharpe; **blocks above 4.0.** Plain English: "how much we flattered
  this strategy by cherry-picking the best version."
- **DSR — Deflated Sharpe Ratio** — A Sharpe ratio (reward-per-unit-risk) corrected
  downward for the number of trials run and the shape of returns, so multiple-testing
  luck doesn't inflate it. Plain English: "the risk-adjusted return, honestly adjusted
  for how many tries it took to find."
- **White's Reality Check / Hansen's SPA** — Statistical tests that ask whether a
  strategy's edge is real or just the best of many random tries. SPA (Superior
  Predictive Ability) is the stronger, less-biased version. Plain English: "a math
  check that the edge is real and not the luckiest coin-flip out of the pile."
- **B15 Robustness Battery** — Jiggles every strategy parameter by about ±20 percent and
  checks the strategy still performs. Fails if it's too sensitive (SDR < 0.85, PSI >
  0.05, or RWS > 0.20). Plain English: "we nudge all the settings a little — a real edge
  shouldn't fall apart from a small change."
- **Frozen-policy hash** — A fingerprint (SHA-256) of a strategy's locked-in rules
  (entry, sizing, stop, take-profit, exit plan). If the rules change after it's frozen,
  promotion is blocked unless the operator signs off. Plain English: "a tamper-seal on
  the strategy's rules — if they change, we catch it."

---

## Risk and execution rails

- **DLL — Daily Loss Limit (4-band ladder)** — The personal daily loss limit, set at
  67 percent of the firm's hard limit to leave a buffer. The ladder: at **60 percent**
  it cuts new-trade size in half; at **67 percent** it halts new entries; at
  **95 percent** it force-closes everything. Plain English: "our daily stop-loss for the
  account — it tightens in steps so we never hit the firm's real limit."
- **Style C exits (33/33/34)** — The standard exit plan: take 33 percent of the position
  off at 1R profit, another 33 percent at 2R, and let the final 34 percent "runner" ride
  with a trailing stop. (R = the initial risk on the trade; "2R" means twice what was
  risked.) Stop moves to break-even after the first target. Plain English: "scale out in
  thirds — bank some at the first target, more at the second, let the rest run."
- **Structural stop with ATR bounds** — Stops are placed at the chart level that proves
  the trade wrong, not at a fixed point count. Floored at 1.5× ATR (Average True Range,
  a volatility measure) and capped per symbol; if the needed stop is too wide, the trade
  is skipped. Plain English: "the stop goes where the idea is wrong, sized to current
  volatility — if that's too far, we skip the trade."
- **11-factor confluence score** — Each potential entry is scored by weighting up to 11
  independent confirming factors (market structure, liquidity targets, VWAP alignment,
  killzone timing, order-flow/delta, volume profile, macro-calendar safety, market
  internals, cross-asset alignment, regime match, SMT divergence). A trade only fires
  above a threshold (default 0.72). One factor — macro calendar — is a hard block: on
  FOMC/CPI/NFP days the score is forced to zero. Plain English: "we add up how many
  independent things agree before taking a trade; news days are an automatic no."

---

## Pipelines and autonomous loops

- **Autonomous backtest conveyor** — When the system is switched on, newly discovered
  CANDIDATE strategies are automatically backtested without anyone pressing a button.
  Plain English: "new ideas get tested automatically."
- **Scout / graduator pipeline** — The discovery engine: it searches YouTube, Reddit,
  and the web for trading strategies, extracts the entry rules in the speaker's own
  words, and "graduates" ideas that show up across multiple sources into CANDIDATE
  strategies — applying the operator's own risk framework on top. Plain English: "the
  part that goes out and finds new strategy ideas and turns the good ones into
  candidates."
- **SHADOW + RL challenger** — A reinforcement-learning agent runs as a "challenger"
  alongside the proven strategy to see if it can do better, but it is ADVISORY ONLY —
  it never gates a promotion and never touches the operator's main money flow. Plain
  English: "an experimental AI trader running on the side for comparison — it can't make
  decisions, just suggestions."

---

## The four Office switches

The Slumhouse Office has four master switches the operator controls:

- **Bot Power** — The master on/off. On, the system runs its autonomous work (including
  the backtest conveyor); off, everything pauses. Plain English: "the main power
  switch."
- **Learning Loop** — Whether the system is allowed to evolve its own prompts/strategy
  proposals automatically (OFF / observe-only / autopilot). Plain English: "whether the
  system is allowed to teach itself."
- **Vacation** — Operator-absent mode: lets pre-vetted Tier-1 strategies auto-promote
  and keeps the system safe and self-healing while the operator is away. Plain English:
  "away mode — it runs itself safely while you're gone."
- **Live Execution** — The hard gate between paper and real money. This is a RED switch —
  Carter can never flip it. Plain English: "the real-money switch — only you can flip
  it."

---

## Prop firms (Topstep vs MFFU)

- **Topstep (PRIMARY)** — The main funded-account provider. Uses **end-of-day (EOD)
  trailing drawdown** (the loss buffer is measured against the account's closing balance
  high-water mark, not intraday peaks). Platform is TopstepX. Allows multiple accounts
  per user and copy-trading across the operator's own accounts. Plain English: "our main
  prop firm — the drawdown buffer is set off the end-of-day balance."
- **MFFU — My Funded Futures (SECONDARY)** — 80/20 payout split, bi-weekly payouts. Key
  rules: a **2 percent max loss per single trade**, a ban on collaborative trading
  (two accounts running the same or opposite strategy), a same-device ban (family
  members can't share a computer), a hedging ban (same underlying on two contracts), and
  **restricted trading around Tier-1 economic news** (FOMC, CPI, NFP, and similar). Plain
  English: "our second prop firm — stricter per-trade loss rule and no trading the big
  news events."
- **EOD trailing drawdown (why it matters)** — Because the loss buffer trails the
  end-of-day balance, multi-day holds are incompatible — this is why Trading Forge is
  day-trader-only and flattens everything by 15:55 ET. Plain English: "the safety buffer
  resets daily off the closing balance, so we never hold overnight."
