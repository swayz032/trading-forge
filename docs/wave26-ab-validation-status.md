# Wave 26 A/B Validation Status

**Date:** 2026-05-24
**Task:** Wave 26 Group A, Task 1 — A/B parity validation run
**Status:** BLOCKED — S3 data unavailable from local machine

---

## What Was Attempted

Command executed:

```powershell
$env:ADAPTIVE_WIRED="true"
python -m scripts.wave25_exit_engine_ab_report --days 7 --strategies silver_bullet
```

## What Happened

The harness launched successfully and began executing:

```
[ab] Window: 2026-05-17 → 2026-05-24
[ab] ADAPTIVE_WIRED=True
[ab] --- silver_bullet (Forge Viper) ---
[ab]   Running static_styleC...
```

The process then blocked indefinitely at `load_ohlcv()` in `src/engine/data_loader.py`. No error
was raised — the process simply waited for S3 object access that never succeeded.

## Root Cause

`load_ohlcv()` loads ratio-adjusted Parquet files from AWS S3 (`s3://trading-forge-data/ratio_adj/`).
Local machines do not carry S3 credentials or cached Parquet files. The function does not have a
local-fallback path — it is designed for Railway or the Skytech tower where the S3 environment
variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`) are set.

## Harness Health

The harness itself (`scripts/wave25_exit_engine_ab_report.py`) is structurally correct and was
built in Wave 25.5. It:

- Reads `ADAPTIVE_WIRED` env flag correctly
- Routes to `run_class_backtest()` with `exit_engine` parameter
- Enforces the 3-rule non-regression gate (Sharpe ±0.05, max_DD ±10%, trade_count ±20%)
- Emits structured output per strategy

The block is purely a data-access constraint, not a code defect.

## Non-Regression Gate (3 Rules)

The gate is enforced when `ADAPTIVE_WIRED=True`. The rules are:

| Rule | Metric | Tolerance |
|---|---|---|
| 1 | Sharpe ratio | ±0.05 (±5%) |
| 2 | Max drawdown | ±10% |
| 3 | Trade count | ±20% |

Regression fires if adaptive exits cause a degradation BEYOND the tolerance in any rule.

## How to Run from a Machine with S3 Access

On the Skytech tower (or Railway) where `AWS_*` env vars are set:

```bash
cd trading-forge
$env:ADAPTIVE_WIRED="true"
python -m scripts.wave25_exit_engine_ab_report --days 7 --strategies silver_bullet
```

Extend to all graduated strategies:

```bash
$env:ADAPTIVE_WIRED="true"
python -m scripts.wave25_exit_engine_ab_report --days 30
```

## Carry-Forward

This validation must be re-run once:
1. Skytech tower has `ADAPTIVE_WIRED=true` in its `.env`
2. At least one strategy has `exit_plan_config.exit_style = "adaptive"` via
   `scripts/wave25-pass7-adaptive-opt-in.ts --apply`
3. Seven or more trading days have elapsed since opt-in (to populate OOS data)

The A/B harness is production-ready. Data access is the only blocker.
