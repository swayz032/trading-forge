# Exit Policy Replay — Operator Runbook

**Layer 4 Research Conveyor, Item 1: Counterfactual Exit Axis**
**Date:** 2026-07-02
**Status:** PRODUCTION-READY (measurement instrument only — overlay is FROZEN)

---

## Purpose

Answers: **"Does OUR exit/trade-management overlay actually help OUR strategies?"**

Replays identical entry signals under three exit policies and compares outcomes. The overlay is frozen — this is a measurement instrument, not parameter tuning.

---

## Exit Policies

| Policy | Label | What it does |
|--------|-------|-------------|
| A | `naked` | Entry + 15:55 ET hard flatten ONLY. No stop, no TP. |
| B | `stop_only` | Initial ATR stop + 15:55 ET flatten. No TP, no partials, no trailing. |
| C | `full_overlay` | Current frozen production overlay (Style C 33/33/34). **DEFAULT.** |

**What stays active in ALL policies:**
- 15:55 ET hard flatten (session EOD — this is infrastructure, not overlay)
- DLL circuit breaker and firm kill-switch (operate at entry-signal layer, not management)
- Rollover day suppression
- MAX_HOLD_BARS=200 cap

**What changes per policy:**
- Policy A: No stop-loss at all. Trade holds until 15:55 ET or original vectorbt signal exit.
- Policy B: Fixed initial stop only. No TP advancement, no BE move, no trailing.
- Policy C: Full production overlay including BE+1 on TP1, Chandelier trail, TP1/TP2/runner blending.

---

## Prerequisites

```bash
# Tower environment (not dev sandbox — vectorbt JIT required)
export TF_ALLOW_FIXED_1=true
export DATA_CACHE_TTL_SECONDS=86400
export PYTHONPATH=.
export DETERMINISM_MODE=true   # recommended for reproducible output
# AWS creds must be set (data loading)
```

---

## Run: Single Strategy

```bash
PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \
  python scripts/exit-policy-replay.py \
    --strategy-class src.engine.strategies.mitigation.MitigationStrategy \
    --start 2023-01-01 --end 2025-12-01

# JSON output (for piping):
python scripts/exit-policy-replay.py \
  --strategy-class src.engine.strategies.mitigation.MitigationStrategy \
  --start 2023-01-01 --end 2025-12-01 \
  --json | jq '.comparison'
```

Output file saved to: `docs/designs/exit-policy-replay-mitigation.json`

---

## Run: Full Corpus Sweep (All 15 ROSTER Strategies)

```bash
PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \
  python scripts/exit-policy-replay.py \
    --corpus \
    --start 2023-01-01 --end 2025-12-01 \
    --corpus-out docs/designs/exit-policy-corpus-2026-07-02.json
```

Each strategy runs as an isolated subprocess. Expect ~3-5 min per strategy on tower (vectorbt JIT warm after first strategy).

---

## Output Schema

```json
{
  "strategy": "src.engine.strategies.mitigation.MitigationStrategy",
  "archetype": "mean_reversion",
  "window": "2023-01-01..2025-12-01",
  "status": "OK",
  "governance_labels": {
    "replay_mode": true,
    "exit_policy_replay": true,
    "layer": "layer4",
    "instrument": "counterfactual_exit_axis"
  },
  "verdict": "KEEP",
  "per_policy": {
    "naked":        { "sharpe": 0.8, "profit_factor": 1.3, "capture_ratio_mean": null, ... },
    "stop_only":    { "sharpe": 1.1, "profit_factor": 1.5, "capture_ratio_mean": 0.42, ... },
    "full_overlay": { "sharpe": 1.4, "profit_factor": 1.8, "capture_ratio_mean": 0.61, ... }
  },
  "comparison": {
    "naked_vs_full":    { "sharpe_delta": -0.6, "pf_delta": -0.5, ... },
    "stop_only_vs_full": { "sharpe_delta": -0.3, "pf_delta": -0.3, ... }
  },
  "low_n": false
}
```

### Key Metrics

| Metric | Description |
|--------|-------------|
| `capture_ratio_mean` | `realized_pnl / mfe` per trade, averaged. 1.0 = perfect capture. N/A for naked (no TP logic). |
| `stop_out_of_winners_rate` | Fraction of stopped trades where price later reached ≥1R favorable. High = overlay is stopping winners. |
| `sharpe_delta` | Negative = other policy is worse than full_overlay (positive evidence for overlay). |
| `pf_delta` | Negative = other policy is worse profit factor (positive evidence). |
| `daily_pnls` | Per-policy daily P&L stream — use to feed B14 firm-survival MC for each policy. |

---

## KEEP / LOOSEN / REMOVE Decision Rules

Derived from `docs/institutional-evidence/trade-management-overlays.md` (deepscan methodology).

### KEEP the full overlay if:

1. **Sharpe: full_overlay > naked** (overlay improves risk-adjusted return vs no management)
2. **PF: full_overlay > stop_only** (overlay improves profit factor vs basic stop)
3. **capture_ratio_mean > 0.50** (overlay captures more than half of favorable excursion on average)
4. **stop_out_of_winners_rate < 0.30** (less than 30% of stopped trades were subsequently winners)

All four conditions should hold. If ≥3 hold, verdict is KEEP.

### LOOSEN if:

1. **Sharpe: full_overlay < naked** (management is destroying return vs holding until EOD)
2. **OR: capture_ratio_mean < 0.35** (overlay is exiting too early, leaving >65% of favorable move on the table)
3. **OR: stop_out_of_winners_rate > 0.50** (majority of stopped trades go on to be profitable — stop is too tight)

LOOSEN means: widen the stop, reduce the early exit pressure, or increase TP targets — but do NOT turn off the overlay entirely without full WF/CPCV/PBO/DSR evidence.

### REMOVE if:

1. **Sharpe: full_overlay < naked AND full_overlay < stop_only** (overlay is worse than BOTH counterfactuals)
2. **AND low_n=false** (sufficient sample for conclusion)
3. **AND result is robust across at least 2 years of data**

REMOVE requires an architectural review (not just operator action). Write findings to `docs/designs/overlay-review-YYYY-MM-DD.md` with evidence.

### INDETERMINATE:

- Any policy errored
- `low_n=true` (fewer than 20 trades in full_overlay run — not statistically meaningful)
- Mixed signals (e.g., naked Sharpe > full but stop_only PF < full) — gather more data

---

## Governance: Results Are Advisory Only

**Results carry `governance_labels.replay_mode=true` and are NOT written to production backtest tables.**

- Do not use these results to block or accelerate strategy promotions
- Do not use `win_rate` as a target metric — it is reported for observation only
- `full_overlay` results in this script are equivalent to a normal backtest (zero behavior change)
- `naked` and `stop_only` results are COUNTERFACTUAL — they represent an alternate history, not a viable trading mode

---

## Archetype Interpretation

| Archetype | Overlay expectation |
|-----------|---------------------|
| `mean_reversion` | Overlay should show higher capture_ratio (reversals have a natural target) |
| `momentum` | stop_out_of_winners_rate matters most (momentum needs room to run) |
| `other` | Evaluate both metrics with equal weight |

---

## Feeding B14 Firm-Survival MC

The `daily_pnls` field in each policy's output is a list of daily P&L in dollars at 1 contract. To run B14 firm-survival Monte Carlo on each policy:

```python
import json
from src.engine.b14_survival import simulate_firm_survival

report = json.load(open("docs/designs/exit-policy-replay-mitigation.json"))
for policy, data in report["per_policy"].items():
    result = simulate_firm_survival(
        daily_pnls=data["daily_pnls"],
        firm_key="topstep_50k",
        n_paths=10000,
        seed=42,
    )
    print(f"{policy}: ruin_pct={result['ruin_pct']:.1%}")
```

---

## Common Issues

**"No trades" in Policy A/B but not full_overlay:**
Normal — the vectorbt entry signals are identical across policies. If full_overlay has trades but naked does not, check that MAX_HOLD_BARS is not too small and that the 15:55 ET time-stop is functioning (check ts_event column is present in the data).

**Strategies not in ROSTER:**
Unregistered strategies bypass the eligibility gate and produce void A/B comparisons (documented bypass in apply_eligibility_gate). The corpus sweep silently skips NO_CLASS entries.

**`low_n=true`:**
Fewer than 20 trades in the full_overlay run. Results are advisory only. Widen the date range or skip this strategy.

**Capture ratio=None for naked:**
Expected — Policy A has no TP management, so exit reason is always "signal" or "time_stop". MFE is still computed but capture_ratio requires a defined exit price from management logic.
