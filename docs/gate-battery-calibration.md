# Gate Battery Calibration — Noise Floor

**System:** Trading Forge backtesting engine  
**Layer:** Layer 4 research conveyor, item 2  
**Status:** HARNESS BUILT — full calibration pending operator-scheduled batch run  
**Battery version:** 2026-07-02 (bump `gate_battery_version` in `null_gate_calibration.py` when gates change)

---

## Purpose

The validation battery (WF/CPCV + DSR + PBO + WRC/SPA + B14) will evaluate ~200 compiled
strategies. A gate "pass" is only meaningful if we know the battery's **false-pass rate**:
how many zero-edge strategies pass by chance.

This document records the noise floor measurement procedure and the standing rule
for interpreting population-scale evaluation results.

---

## Standing Rule

> **Population-scale passes only count above the noise floor.**
>
> If the full-battery false-pass rate is P, then in a population of N strategies,
> approximately N × P passes are expected by chance. Only strategies beyond that
> count carry evidence of a genuine edge.
>
> **Re-run calibration whenever the gate battery version changes** (gate thresholds,
> DSR formula, PBO logic, or WRC/SPA parameters are modified).

---

## How to Run Calibration

```bash
# Smoke test (2-3 nulls, no S3, proves pipeline):
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --smoke --n-smoke 3

# Full calibration (N=100 nulls, real S3 data, ~2-3 hours):
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42

# Resume an interrupted batch:
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py \
    --n 100 --manifest null_manifest.jsonl

# With Monte Carlo B14 gate (adds ~5min per null):
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py \
    --n 100 --include-mc --mc-sims 10000

# Outputs:
#   null_calibration_report.json  — per-gate false-pass rates + binomial CI
#   null_manifest.jsonl           — per-null results (resumable)
```

**N = 100 is the recommended minimum** for a meaningful 95% CI on the full-battery
false-pass rate. At N = 100:
- If 0 nulls pass: 95% CI upper bound = 3.6% (Wilson)
- If 5 nulls pass: 95% CI = [1.6%, 11.3%] — rate ≈ 5%
- If 15 nulls pass: 95% CI = [8.4%, 24.1%] — rate ≈ 15%

For N = 200, the CI narrows to roughly ±3 percentage points around the observed rate.

---

## Null Strategy Design

Null strategies have zero predictive content by construction:

- **Entry (long):** `close > open` — intrabar bullish bar condition  
- **Entry (short):** `open > close` — complement (intrabar bearish)  
- **Why zero edge:** Under H₀, the intrabar direction at bar t is uncorrelated with
  the future return over the Style C TP1/TP2/runner horizon (1R, 2R, 3R targets).
  Even with market autocorrelation, `close > open` has ~50% firing probability
  and no directional prediction at the multi-bar R-multiple targets.
- **Exit:** Style C static (Mode B frozen overlay) — TP1@1R (33%), TP2@2R (33%), runner@3R (34%)
  Identical to real strategies; only the entry has no edge.
- **Stop:** Fixed points (symbol-appropriate; MES=4pt, MNQ=6pt, MCL=0.15pt)
- **Variation across nulls:** Symbol (MES/MNQ/MCL), timeframe (5m/15m),
  stop multiplier, entry window (AM/PM/full RTH)
- **Reproducibility:** Same (N, seed) always produces same specs. PCG64DXSM RNG.

---

## Gate Battery Gates Evaluated

| Gate | Metric | Pass Condition |
|------|--------|----------------|
| WF/CPCV | OOS trades from ≥1 path | total_trades > 0 |
| DSR | Deflated Sharpe Ratio | dsr_pass == True (p < 0.05) |
| PBO | Probability of Backtest Overfitting | pbo_overall ≤ 0.5 |
| WRC | White's Reality Check | wrc_result.passed == True |
| SPA | Hansen's SPA | spa_result.passed == True |
| Full Battery | All above simultaneously | all 5 pass |
| B14 (optional) | Monte Carlo survival ci_high | ci_high ≥ 0 |

**Degenerate cases:**
- PBO may report `pbo_degenerate_reason = "cpcv_is_sharpe_unavailable"` when
  per-path IS Sharpes are unavailable (Wave 30 carry-forward). The lifecycle gate
  proceeds with a `cpcv_exempt` audit. Calibration counts these as `degenerate`
  (separate from pass/fail).
- WRC/SPA skip when fewer than 20 OOS observations per path.
- B14 skips when total OOS trades < 30.

---

## Known Gate Battery Weaknesses (from deepscan9 2026-07-02)

These findings mean the calibration may show a **higher false-pass rate** than the
theoretical ideal. They are documented here so the calibration result is interpreted
correctly — not as a reason to change the gates before calibration.

1. **DSR formula reduces to `sqrt(2 ln N)` (risk_metrics.py:539-544)**  
   The Euler-Mascheroni γ correction terms cancel exactly, slightly understating
   E[maxSR]. This makes the DSR test statistic slightly inflated → DSR passes more
   often than correct Bailey 2014 Eq.2 would allow. Direction: LENIENT.

2. **WFE unenforced on default CPCV mode**  
   When `wfe_status="cpcv_not_applicable"`, WFE+PBO+BIF all exempt simultaneously.
   In default CPCV mode, PBO is degenerate (IS==OOS). The lifecycle gate uses a
   `cpcv_exempt` path (Wave 30 carry-forward for per-path IS Sharpes).
   Direction: PBO gate is a NO-OP for most CPCV runs.

3. **DLL enforcement dead in "both" granularity mode (monte_carlo.py)**  
   `simulate_firm_survival` gates on `granularity == "day"` but "both" mode passes
   trade-granularity paths. B14 may be softer than expected.

The calibration harness runs the battery AS-IS and measures the actual false-pass rate
including these weaknesses. The measured rate IS the correct noise floor for the
current battery version.

---

## Calibration Results (to be filled after operator runs full batch)

**Run date:** PENDING  
**N nulls:** PENDING  
**Seed:** 42  

| Gate | False-Pass Rate | 95% CI | N trials |
|------|-----------------|--------|----------|
| WF/CPCV paths | ? | ? | ? |
| DSR | ? | ? | ? |
| PBO | ? | ? | ? |
| WRC | ? | ? | ? |
| SPA | ? | ? | ? |
| **Full Battery** | **?** | **?** | **?** |
| B14 (optional) | ? | ? | ? |

**Noise floor projection (N = 200 strategies):**

| Metric | Value |
|--------|-------|
| Expected chance passes (full battery) | ? |
| 95% CI upper bound | ? |
| Threshold: only passes above | ? |

---

## When to Re-Calibrate

Re-run calibration when **any** of the following change:

1. DSR formula is corrected (risk_metrics.py compute_deflated_sharpe_ratio)
2. PBO threshold changes (PBO_OVERFIT_THRESHOLD env var or pbo_gate.py)
3. CPCV per-path IS Sharpes become available (Wave 30 carry-forward)
4. WRC/SPA minimum observation threshold changes
5. B14 granularity bug is fixed in monte_carlo.py
6. Gate chain logic changes in backtest-service.ts

Bump `gate_battery_version` in `null_gate_calibration.py` and re-run with a fresh manifest.

---

## Isolation Guarantee

All null calibration rows are tagged with `governance_labels["null_calibration"]=True`
following the `replay_mode` precedent (Wave 27 Pass 1). The guard in
`src/engine/null_calibration_guard.py` enforces this marker before any DB persistence.

Null calibration rows MUST NEVER appear in:
- `backtests` table alongside real strategy rows  
- Lifecycle promotion evaluation queries
- Critic optimizer inputs
- Population statistics used to define "good" strategies

Query to exclude from production tables:
```sql
WHERE (governance_labels->>'null_calibration' IS NULL
   OR governance_labels->>'null_calibration' != 'true')
```
