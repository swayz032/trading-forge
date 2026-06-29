# Quant Validation Methods — the science behind Trading Forge's gates

Trading Forge's whole edge is that it **refuses to fool itself**. A strategy that looks
great on a backtest is usually curve-fit; these methods + gates exist to separate real
edge from luck. Plain-English meaning first, then the gate it maps to.

## The core problem: multiple-testing / selection bias
When you try thousands of strategy variants and keep the best, the "best" is mostly luck —
its in-sample Sharpe is inflated. Every method below is a defense against that inflation.
(Foundational sources: López de Prado *Advances in Financial ML*; Bailey & López de Prado on
PBO and the Deflated Sharpe Ratio.)

## Walk-Forward + WFE (Walk-Forward Efficiency)
Optimize on a window, test on the NEXT unseen window, roll forward. **WFE = out-of-sample
Sharpe ÷ in-sample Sharpe.** ~1.0 means the edge held out of sample; low means it was
fitted. → **Gate: WFE ≥ 0.70 hard floor** (0.50–0.70 also blocks), at PAPER→DEPLOY_READY.

## CPCV (Combinatorial Purged Cross-Validation)
Instead of one walk-forward path, test many train/test splits, **purging** any overlap so the
test set never leaks into training. Gives a distribution of out-of-sample results, not one
lucky path. It's the default WF mode and the basis for PBO.

## PBO (Probability of Backtest Overfitting)
Across the CPCV splits, **how often does the in-sample best rank poorly out of sample?** High
PBO = the selection process is overfitting. → **Gate: PBO < 15%** at TESTING→SHADOW/PAPER
(institutional 2026 strictness; Bailey et al. rank-logit method).

## DSR (Deflated Sharpe Ratio)
A Sharpe ratio **discounted for how many trials you ran** and for non-normal returns (skew/
kurtosis). Answers "is this Sharpe real after accounting for the search?" → used in the RL/
challenger DSR floor (≥ 0.5) and as a deflation lens generally.

## Monte Carlo survival + ruin CI (B14 "Survival Twin")
Resample the trade/return sequence thousands of times to simulate alternate futures, then run
each path through the **prop firm's real rules** (trailing DD, daily-loss-limit, consistency).
**Probability of ruin = the chance the account gets shut down or a payout denied.** We read the
**conservative upper bound** of a BCa bootstrap CI (`probability_of_ruin_ci.ci_high`), never the
optimistic point estimate. → **Gate: B14 ci_high ≤ 0.20** at PAPER→DEPLOY_READY. (Block-bootstrap
when returns are autocorrelated; hard-fail on >2× history extrapolation.)

## BIF (Backtest Inflation Factor)
**Optimized in-sample Sharpe ÷ walk-forward Sharpe** — the selection-inflation ratio. Expected
inflation ≈ √(2·ln K_eff) for K_eff effective trials (Bailey & López de Prado 2014). → **Gate:
BIF ≤ 4.0 block** (warn 2.0–4.0). Guards the autonomous scout (hundreds of variants) from
promoting selection-inflated strategies.

## B15 Parameter Robustness Battery
Jitter every parameter ±20% and check the strategy survives: **SDR ≥ 0.85** (Sharpe degradation),
**PSI ≤ 0.05** (distribution stability), **RWS ≤ 0.20** (rank-weighted stability). Perturbation
fragility kills strategies that pass WF/CPCV/PBO/DSR but sit on a knife-edge of parameters.

## Frozen-policy hash + regime-drift
On full pass, the 5-field policy slice {entry_quality, position_size, stop_loss, take_profit,
exit_plan_config} is **SHA-256 frozen**. Re-promoting a mutated policy is blocked without an
HMAC override + rationale. A daily detector demotes DEPLOYED strategies whose live regime drifts
from the regime they were trained on (5 consecutive days → DEPLOYED→DECLINING→TESTING).

## Shadow stage + training-serving skew
New strategies go TESTING → **SHADOW** (logs signals, **no broker contact**) → PAPER. A ≥5%
divergence between shadow-logged signals and backtest expectations BLOCKS promotion — catches
training-serving skew, the #1 institutional model-failure mode.

## How to reason about these as Carter
- Win rate is an **observed output**, never a target or a gate. Gates measure expectancy, PF,
  Sharpe/DSR, regime survival, ruin — all hit-rate-agnostic.
- A blocked promotion is usually CORRECT. But gates can also be **too strict** and strangle a
  real edge ("death by a thousand filters"). The `gate_block_analyzer.py` replays blocked signals
  to verdict each gate as costing (blocked winners) vs saving (blocked losers) — loosen only what
  the DATA shows is blocking winners, never out of fear.
