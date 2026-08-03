# SCOPING — Battery-rig NULL-CALIBRATION (fault-injection) · 2026-08-03

> **Provenance:** read-only Explore scout dispatched 2026-08-03 ~02:08Z by an OUTSIDE-CONSULTANT session the operator asked for speed advice — NOT a campaign seat; it wrote nothing to the relay files and holds no authority. This file is an ADVISORY INPUT for the seated advisor to adopt, re-verify, or ignore. Surveyed `C:/Users/tonio/Projects/trading-forge/trading-forge` @ `c766f468` (branch `hardening/phase-0`), reads only, nothing executed. **Every claim below is [MEASURED BY SCOUT] at that pin — file:line cites included; nothing here has been executed or independently re-derived by any desk.** Uncommitted deliberately: lands with the charter ruling that consumes it.
>
> **Purpose:** pull the Phase-2 ENTRY checklist item "BATTERY-RIG NULL-CALIBRATION — the rig must go RED on a planted defect before the first real wave" (BLUEPRINT v4 §4) forward into a parallel lane. **This is FAULT-INJECTION calibration — distinct from `scripts/null_gate_calibration.py`'s H₀ false-pass-rate experiment, which shares the name but answers a different question.** The scout flagged the conflation risk explicitly.

## Headline findings

1. **[GATE-ARTIFACT CLASS, in the MAIN repo] `npm run test:metrics` cannot catch a defect planted in `backtester.py`'s metric math.** `src/engine/tests/test_metric_snapshot.py:50-52` re-implements PF/Sharpe/max-DD ("copied ... no circular import ... without importing the full engine"); `test_golden_fixtures.py` imports only `risk_metrics` (:159,:176) and `monte_carlo.trade_resample` (:359), never `backtester.py`. A wrong-but-finite Sharpe at `backtester.py:5499`/`:7747` or PF at `:5371`/`:7592` likely passes the whole metrics gate GREEN. The null-cal must therefore drive the BATTERY, not the test suite.
2. **A DB-free, S3-free, service-free vehicle already exists:** `scripts/null_gate_calibration.py --smoke` — synthetic OHLCV in-process (`_make_synthetic_ohlcv()` @ :127), zero `psycopg2`/`DATABASE_URL` references in `backtester.py`/`walk_forward.py`/`monte_carlo.py`. Ideal end-to-end driver for planted-defect runs.
3. **Step zero before anything runs:** dual-numpy hazard — user-site numpy 2.3.5 vs system 2.4.5 with vectorbt/numba/scipy installed against the system tree; `python-runner.ts:374-378` puts user-site first. One import-check command decides feasibility. Interpreter is hardcoded `C:\Program Files\Python313\python.exe` (`python-runner.ts:311`); do NOT route via `.venv` (documented broken stub).
4. **Node lane is NOT isolatable** (live Railway Postgres via shared `.env`, port 4000 NSSM collision, crons incl. the candidate-backtest conveyor start on boot). Python lane in a worktree pinned to an explicit SHA is fully isolated. `git stash` banned (shared refs). Report files default to CWD — use `--report-out`/`--manifest` absolute scratch paths.
5. **Env for a smoke run:** `TF_ALLOW_FIXED_1=true` (hard-required, `config.py:419-432`), `DETERMINISM_MODE=true`, `TF_MOCK_VBT=1` only under pytest (vectorbt collection hang — but mocking skips the real vectorbt path), WF default mode `cpcv` (`walk_forward.py:1262`), synthetic 19,656 bars clears `MIN_CPCV_FOLD_BARS=60`.

## Plant-point catalog (defect → expected detector; "detector fires" is exactly what the null-cal must prove, not assume)

**A. Metrics** — A1 PF numerator/denominator swap `backtester.py:5371`/`:7592` (invariant `_check_profit_factor_finite` :456 + perf-gate PF≥1.7 :127; NOT the metrics tests). A2 Sharpe `sqrt(252)→sqrt(12)` or ddof flip `:5499`/`:7747` — **likely SILENT-PASS today** (only non-finite is checked) → highest-value plant. A3 max-DD sign flip `:5494`/`:7741` → `_check_max_drawdown_non_negative` :363, cleanest certain RED. A4 DSR benchmark scale `risk_metrics.py:582` (file's own comment documents this exact bug class as previously live).

**B. Walk-forward** — B1 off-by-one OOS boundary `walk_forward.py:223`. B2 embargo neutralized `:230` (historical precedent: `backtester.py:8204-8207` records embargo_bars=0 production bug on class paths). B3 CPCV strip-side inversion `:270-294` (pure function, dedicated tests — lowest blast radius). B4 WFE denominator swap `cross_validation.py:78`.

**C. Gates** — C1 PF comparator flip `performance_gate.py:127`. C2 delete 60-OOS-days floor `:84-88`. C3 TS-gate threshold flips (`b14-ci-gate.ts:342` / `pbo-gate.ts:119` / `wfe-gate.ts:130`). C4 PBO threshold 0.15→0.95 `pbo-gate.ts:34` — **may move NOTHING** (PBO is a documented NO-OP for most CPCV runs via `wfe_status="cpcv_not_applicable"`, `docs/gate-battery-calibration.md:107-130`) — pre-registered so a null result is not misread as a rig failure.

**D. Prop rules** — D1 trailing-DD breach comparator `prop_compliance.py:117`/`:149`. D2 HWM frozen `:108`/`:140`. D3 consistency 0.50→1.01 `:172`.

**E. Fill/cost realism** — E1 partial-fill force-disabled `fill_model.py:59-63` (precedent: fill model silently dormant a full wave, `backtest-service.ts:785-801`). E2 slippage rounds to zero `slippage.py:70-87` → slippage-survival block `backtester.py:3118` + `slippage-survival-gate.ts:248`. E3 zero-volume guard silenced (`data_loader.py::check_zero_volume_trade_critical`).

## Known-lenient (pre-existing, must not be counted as detections)
DSR reduces to `sqrt(2 ln N)` (`risk_metrics.py:539-544`) · PBO/WFE/BIF jointly exempted under CPCV · DLL enforcement dead in `granularity=="both"` (`monte_carlo.py`) · `raw_survival_score` hardcoded 0.0 (dormant).

## Reusable fault-injection precedent (do not rebuild)
`npm run check:gate-fault-injection` → `src/server/__tests__/ds22-x1-other-gates-fault-injection.test.ts` (+2 siblings; copy-gate-to-fixture-tree, prove exit 0 clean → exit 1 planted) · `test_failure_injection_compliance_enforce_default_path.py` · `test_ds22_y6_registry_completeness_real_scanner_fault_injection.py` · `test_r2fix_regime_grouping_false_green.py`.

## Scout's declared unknowns (charter's first acceptance items)
(1) whether the engine imports cleanly under the dual-numpy mix — step zero; (2) whether `--smoke` currently runs green; (3) live DB row counts ("0 backtests" is doc-sourced, 2026-07-18); (4) current test-suite baseline is NOT green (~53 vitest + ~100 pytest pre-campaign failures) — a plant-then-diff needs a trusted pre-plant baseline first; (5) per-plant detector-fires — the experiment itself; (6) live n8n drift vs committed JSON. Only two live n8n workflows touch `/api/backtests` and both are read-only consumers; the only automated launcher is the in-process conveyor cron.

## Data/fixtures on hand
`data_cache/{MES,MNQ,ES,NQ,CL}/*` parquet + ratio_adj + provenance sidecars (24h TTL → stale triggers S3) · golden fixtures `src/engine/tests/fixtures/golden/*` with hand-computed `expected_results.json` v1.0 · snapshots `src/engine/tests/snapshots/*.json`.
