# Metric Snapshot Workflow (A9 — W11)

## What this is

The snapshot regression system detects when code changes silently shift metric
calculations on golden fixtures (A5). Industry-standard 3-tier pattern.

## Architecture

```
Tier 1: pre-commit hook (< 5 sec)
  └── 3 fast fixtures: fixture_perfect, fixture_marginal, fixture_fees_killer
  └── Only runs when relevant files change (backtester.py, risk_metrics.py, etc.)

Tier 2: PR gate (.github/workflows/metric-snapshot.yml)
  ├── snapshot-regression: all 5 golden fixtures (A5)
  ├── frankenstein-gate: 100-shuffle randomization detection (A4)
  └── cross-engine-parity: VBT vs backtrader on 2 DSL fixtures (A3)

Tier 3: canary (future — paper engine live metric checks)
```

## Snapshot files

Stored in `src/engine/tests/snapshots/` — committed to git.

| File | What it captures |
|------|-----------------|
| `fixture_perfect.json` | PF, net PnL, Sharpe, max DD for perfect strategy |
| `fixture_losing.json` | PF, net PnL, win rate for losing strategy |
| `fixture_marginal.json` | PF, net PnL — must stay below 1.75 promotion gate |
| `fixture_fees_killer.json` | gross PF > 1.0, net PF < 1.0 (fee flip invariant) |
| `fixture_regime_shift.json` | epoch PF, degradation ratio |

## Updating snapshots (intentional changes)

When you change metric computation intentionally (e.g., fix a formula, change
a tolerance), update the snapshots:

```bash
# Update all snapshots
SNAPSHOT_UPDATE=1 python -m pytest src/engine/tests/test_metric_snapshot.py -v

# Or via npm
npm run test:metrics:update-snapshots
```

Then review the diff with `git diff src/engine/tests/snapshots/` to confirm
the changes are expected. Commit the snapshot files alongside the code change.

**Never manually edit snapshot JSON.** The values are computed from the fixture
data — editing them by hand creates drift between the fixture and the snapshot.

## Running the tests

```bash
# Fast subset (pre-commit tier — < 5 sec)
npm run test:metrics:fast

# Full metric gate (all A3 + A4 + A5)
npm run test:metrics

# All 5 snapshots only
python -m pytest src/engine/tests/test_metric_snapshot.py -v
```

## Failure messages

Snapshot drift produces a diagnostic message:

```
Snapshot drift detected on fixture 'fixture_perfect':
  net_pf: expected=3.393315, actual=3.394000, tolerance=0.005, drift=0.000685

If this change is intentional, run:
  pytest src/engine/tests/test_metric_snapshot.py --snapshot-update
and commit the updated snapshot files.
```

Each failure line shows: metric name, stored expected value, computed actual
value, tolerance, and drift amount. No ambiguity about what changed or by how much.

## Pre-commit hook

Install once:
```bash
pip install pre-commit
pre-commit install
```

The hook runs automatically on `git commit`. It only triggers when files that
affect metric computation are changed (backtester.py, risk_metrics.py, fixture
JSON files, snapshot JSON files).

## What drift means

A snapshot mismatch means one of:
1. A legitimate fix to metric computation — update snapshots and commit
2. An accidental regression — revert the code change
3. A fixture data change — investigate why fixture data changed

The git history of `src/engine/tests/snapshots/` is the audit trail of every
metric computation change that has been accepted. The PR reviewer can see
exactly which metrics changed and by how much.

## Tolerances

| Metric | Tolerance |
|--------|-----------|
| Profit Factor | 0.005 |
| Net PnL | $1.00 |
| Win Rate | 0.001 |
| Total Commission | $0.01 |
| Max Drawdown | $1.00 |
| Sharpe Ratio | 0.001 |
| Trade Count | exact (0.0) |

Tolerances match A5 golden fixture tolerances. They are tight enough to catch
a 0.001% metric drift but wide enough to not fail on floating-point rounding
across Python versions.
