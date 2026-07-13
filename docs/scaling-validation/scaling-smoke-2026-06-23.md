# Scaling-Schedule Survival Validation Report

> **Historical simulation artifact.** Its former consistency field is
> deprecated: payout eligibility is a separate recoverable funded-stage result,
> never a survival breach. Regenerate with the current harness for stage-aware
> output.

**Overall verdict:** ONE OR MORE TIERS UNSAFE

## Configuration

| Parameter | Value |
|---|---|
| Symbol | MES |
| Firm | topstep_50k |
| Account size | $50,000 |
| Breach gate (SCALING_BREACH_GATE_PCT) | 5% |
| MC simulations (SCALING_N_SIMS) | 5,000 |
| Block-bootstrap block size | 10 days |
| Simulation steps per path | 252 trading days |
| Observation count (daily P&L inputs) | 252 days |
| Per-contract daily P&L mean | $36.13 |
| Per-contract daily P&L std dev | $75.01 |
| RNG seed (SCALING_SEED) | 42 |
| Data source | synthetic:mean=40.00,std=80.00,n=252 |

## Tier Verdict Table

| Tier (contracts) | Breach % | Gate | Verdict | Eval pass rate | 6-mo survival | Deprecated consistency telemetry |
|---|---|---|---|---|---|---|
| 9 | 88.56% | 5% | UNSAFE (88.6% breach >= 5% gate) | 11.4% | 11.4% | 0.0% |
| 12 | 95.76% | 5% | UNSAFE (95.8% breach >= 5% gate) | 4.2% | 4.2% | 0.0% |
| 18 | 100.00% | 5% | UNSAFE (100.0% breach >= 5% gate) | 0.0% | 0.0% | 0.0% |
| 24 | 100.00% | 5% | UNSAFE (100.0% breach >= 5% gate) | 0.0% | 0.0% | 0.0% |
| 33 | 100.00% | 5% | UNSAFE (100.0% breach >= 5% gate) | 0.0% | 0.0% | 0.0% |
| 50 | 100.00% | 5% | UNSAFE (100.0% breach >= 5% gate) | 0.0% | 0.0% | 0.0% |

## Plain-English Verdict Per Tier

### Tier 9 contracts — UNSAFE

About 88.6% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 4,205 sims (84.1%)
- Hit daily loss limit: 223 sims (4.5%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2129 | $2235 | $2367 | $2498 | $2665 |

### Tier 12 contracts — UNSAFE

About 95.8% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 3,722 sims (74.4%)
- Hit daily loss limit: 1,066 sims (21.3%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2425 | $2699 | $2699 | $2699 | $2874 |

### Tier 18 contracts — UNSAFE

About 100.0% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 1,613 sims (32.3%)
- Hit daily loss limit: 3,387 sims (67.7%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2042 | $2516 | $2649 | $2705 | $2912 |

### Tier 24 contracts — UNSAFE

About 100.0% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 1,464 sims (29.3%)
- Hit daily loss limit: 3,536 sims (70.7%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2000 | $2088 | $2428 | $2519 | $2779 |

### Tier 33 contracts — UNSAFE

About 100.0% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 491 sims (9.8%)
- Hit daily loss limit: 4,509 sims (90.2%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2000 | $2012 | $2369 | $2904 | $2904 |

### Tier 50 contracts — UNSAFE

About 100.0% of simulated runs ended in a breach — more than 1 in 5. Trading at this contract size on this strategy's P&L distribution is high-risk. Do not advance to this tier without substantially better per-trade P&L or a much larger buffer.

**Breach reason breakdown:**

- Hit EOD trailing drawdown floor: 11 sims (0.2%)
- Hit daily loss limit: 4,989 sims (99.8%)

**Simulated max-drawdown percentiles (from account peak):**

| P50 | P75 | P90 | P95 | P99 |
|---|---|---|---|---|
| $2000 | $2000 | $2533 | $2559 | $2559 |

## Honest Scope Disclosure

### What this harness VALIDATES

- Per-tier firm-breach probability on this strategy's historical P&L distribution
- Topstep EOD trailing-DD + hard daily-loss limit; dynamic Combine target and funded payout eligibility are separate
- Block-bootstrap MC paths preserve short-run autocorrelation
- Gate logic: breach rate < SCALING_BREACH_GATE_PCT (default 5%)
- Fail-CLOSED: any data-missing or sim-error case exits non-zero
- Deterministic: same inputs + seed → same outputs

### What this harness does NOT validate (documented follow-up)

- **Bar-by-bar pyramid replay across walk-forward folds** — the backtester sizes
  STATICALLY from a scalar `account_pnl_total` snapshot.  A full sequential
  walk-forward replay that threads fold-exit balance into fold-entry state is
  Step 1 of the validation plan in docs/scaling-plan-baby-mode.md and is a
  ~2 dev-day Wave 30 follow-up.  The per-tier proof here is the institutional
  *core* of that plan.
- **Regime-conditioned paths** — block-bootstrap preserves autocorrelation but
  does not condition on market regime.  MC regime resampling (Wave 27.5 Pass D)
  would give regime-specific breach rates per tier.
- **Strategy-specific daily P&L from the database** — this run used the
  `synthetic:mean=40.00,std=80.00,n=252` source.  For production validation, feed real backtest
  daily_pnls from the `backtests` table (field: `daily_pnls`) for a given
  strategy_id.  See scripts/validate-scaling-schedule.py --help.

---

*Generated by scripts/validate-scaling-schedule.py.*
*Seed: 42 | Sims: 5,000 | Block size: 10*
