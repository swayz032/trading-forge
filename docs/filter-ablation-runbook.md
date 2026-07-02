# Filter Ablation Runbook

**Layer 4 research conveyor, item 4. Layer4-ablation 2026-07-02.**

## Purpose

Measures the marginal out-of-sample DSR contribution of each eligibility gate layer via a leave-one-filter-out grid. For each layer, the full overlay runs with exactly that layer's veto suppressed. The delta OOS DSR answers: does this layer earn its place or is it curve-fit noise?

The overlay remains FROZEN throughout. This is measurement only, not tuning.

---

## What the Harness Does

```
Baseline: all 10 gate layers ON  ->  OOS DSR_baseline
Layer L:  all layers ON except L  ->  OOS DSR_L

DELTA_DSR = DSR_L - DSR_baseline

Verdict (threshold 0.05):
  CONTRIBUTING  DELTA_DSR <= -0.05   removing L degraded OOS DSR; layer earns its place
  DEAD_WEIGHT   |DELTA_DSR| < 0.05   marginal contribution; curve-fit candidate
  HARMFUL       DELTA_DSR >= +0.05   removing L improved OOS DSR; layer may hurt
  INDETERMINATE error or insufficient data
```

Each run is a 5-window walk-forward over the date range. OOS daily P&Ls are pooled across windows, then DSR is computed via `cross_validation.deflated_sharpe_ratio`. Minimum 5 OOS trades required; runs below this threshold produce INDETERMINATE.

---

## Run Recipe

### Single strategy, all layers

```bash
# On the tower with AWS creds and data cache configured:
PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \
  python scripts/filter-ablation-cpcv.py \
    --strategy-class src.engine.strategies.ote.OTEStrategy \
    --start 2023-01-01 --end 2025-12-01 \
    --firm topstep_50k \
    --out docs/designs/filter-ablation-ote-2026-07-02.json
```

### Resume a partial run (resumable manifest)

```bash
PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \
  python scripts/filter-ablation-cpcv.py \
    --strategy-class src.engine.strategies.ote.OTEStrategy \
    --start 2023-01-01 --end 2025-12-01 \
    --resume \
    --manifest docs/designs/filter-ablation-ote-manifest.json
```

The manifest saves after every completed run. If the process dies mid-grid, `--resume` skips already-completed layers.

### Test a subset of layers

```bash
PYTHONPATH=. TF_ALLOW_FIXED_1=true DATA_CACHE_TTL_SECONDS=86400 \
  python scripts/filter-ablation-cpcv.py \
    --strategy-class src.engine.strategies.ote.OTEStrategy \
    --start 2023-01-01 --end 2025-12-01 \
    --layers no_trade,kill_zone,sweep
```

---

## Canonical Layer Names

These are the 10 gate layers (matching hard-SKIP checks 0-9 in `eligibility_gate.py`):

| Canonical name       | Detection prefix                          | Gate check |
|----------------------|-------------------------------------------|------------|
| `stop_ceiling`       | `SKIP_TRADE:`                             | Check 0: structural stop exceeds per-symbol ceiling |
| `no_trade`           | `NO_TRADE playbook active`                | Check 1: NO_TRADE regime from bias engine |
| `strategy_allowlist` | `Strategy '`                              | Check 2: strategy not in playbook's allowed list |
| `direction_bias`     | `Direction '`                             | Check 3: trade direction opposes daily bias |
| `kill_zone`          | `Not in kill zone`                        | Check 4: signal outside NY/London kill zones |
| `sweep`              | `No liquidity sweep present`              | Check 5: no liquidity sweep on entry bar |
| `location_score`     | `Location score`                          | Check 6: location score < 60 |
| `rr_ratio`           | `TP2 R:R`                                 | Check 7: TP2 R:R below regime minimum |
| `daily_limit`        | `Daily trade limit reached`               | Check 8: max trades per day hit |
| `bias_confidence`    | `Bias confidence`                         | Check 9: bias confidence < 0.4 |

To add a new gate layer: (1) add the hard-SKIP check in `eligibility_gate.py`, (2) add the canonical entry to `ABLATION_LAYER_MAP` in `src/engine/ablation_layers.py`, (3) the test `TestLayerRegistryMatchesGateChecks` will verify consistency.

---

## Reading the Output

The output JSON has this structure:

```json
{
  "governance_advisory": true,
  "ablation_marker": true,
  "persist_to_production": false,
  "authority": "research_only -- verdicts inform UNFREEZING...",
  "summary": {
    "baseline_dsr": 0.72,
    "baseline_dsr_pass": true,
    "baseline_trades": 147,
    "verdict_counts": {"CONTRIBUTING": 3, "DEAD_WEIGHT": 6, "HARMFUL": 1},
    "no_trade_hypothesis": {
      "confirmed": true,
      "no_trade_pct": 94.2,
      "note": "CONFIRMED: NO_TRADE accounts for 94.2% of rejections"
    }
  },
  "layer_ablations": [
    {
      "layer": "no_trade",
      "verdict": "DEAD_WEIGHT",
      "delta_dsr": 0.01,
      "delta_trades": 312,
      "reason": "|DELTA_DSR|=0.01 < 0.05 threshold -- ..."
    }
  ]
}
```

### Verdict interpretation

**CONTRIBUTING** — this layer is doing real work. Removing it hurts OOS DSR by >= 0.05. Keep it.

**DEAD_WEIGHT** — |DELTA_DSR| < 0.05. Marginal OOS contribution. This layer is a candidate for relaxation or removal after a profitable baseline exists. Do not act on this alone — see the standing rule below.

**HARMFUL** — removing this layer improved OOS DSR by >= 0.05. The layer as configured may be hurting the strategy. Flag for review. Check whether it over-filters A+ setups.

**INDETERMINATE** — insufficient OOS trades (< 5) or backtest error. Cannot make a verdict. Re-run with a longer date window or inspect the error field.

### NO_TRADE hypothesis

The starting hypothesis is that the NO_TRADE playbook layer does ~99% of signal cutting. The report's `no_trade_hypothesis.confirmed` field shows whether this holds (threshold: NO_TRADE >= 90% of all rejections). If refuted, other layers are cutting more signal than expected — investigate whether they are working as intended.

---

## Standing Rule

> Ablation verdicts only inform UNFREEZING decisions **after profitable baselines exist**.
> 
> DEAD_WEIGHT or HARMFUL verdicts do not authorize removing a filter. They flag it for human review once there is a profitable, peer-reviewed baseline to compare against. Do not loosen any filter autonomously based solely on this report.

This rule is embedded in every output file's `authority` field.

---

## Governance

Every output file carries:

```json
{
  "governance_advisory": true,
  "ablation_marker": true,
  "persist_to_production": false,
  "authority": "research_only -- verdicts inform UNFREEZING decisions after profitable baselines exist; never auto-applied; overlay remains FROZEN"
}
```

Results must never be persisted to production tables (`backtests`, `walk_forward_results`, `strategy_candidates`, etc.). They are file-only research artifacts.

---

## What This Is Not

- This is NOT a layer removal recommendation tool.
- This is NOT a tuning harness (overlay is frozen).
- This is NOT a replacement for full CPCV + PBO + DSR evaluation of a candidate strategy.
- Results from this harness do NOT authorize any gate change without independent profitable-baseline confirmation.

---

## Maintenance

The layer registry (`src/engine/ablation_layers.py`) must stay synchronized with the gate checks in `src/engine/context/eligibility_gate.py`. The test `tests/test_filter_ablation.py::TestLayerRegistryMatchesGateChecks` enforces this. If the test fails after a gate change, update `ABLATION_LAYER_MAP`.

The per-layer disable mechanism is purely additive to `apply_eligibility_gate` in `backtester.py`. When `TF_OVERLAY_DISABLE_LAYERS` is empty or unset (the production default), behavior is byte-identical to baseline. The mechanism only activates when the ablation harness sets it.
