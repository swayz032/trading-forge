# CLAUDE FAST TEST-COMMAND INDEX

**Purpose:** stop re-discovering the first test command for every prepared packet.

These commands are starting points from the current repository. A worker still follows the packet's exact RED/GREEN evidence contract and adds the smallest new regression test required by the finding.

## Global health commands

```bash
npm run build
npm run test:full-fleet
npm run preflight:vacation
python -m pytest src/engine/ -q --tb=short
```

Do not treat `npm run build` or Fast Lane alone as launch proof. AR-1177 requires a full-lane receipt tied to the exact release SHA.

## AR-1178 — production dev-auth bypass

Existing focused tests:

```bash
npx vitest run src/server/__tests__/auth-middleware.test.ts
npx vitest run src/server/__tests__/deepscan16-a1-self-restart-auth-gate.test.ts
```

Required RED addition: production/preprod environment + `AUTH_DEV_BYPASS=true` must refuse/invalid-config rather than bypass auth.

## AR-1175 / AR-1176 — reconciliation boundaries

Existing focused tests:

```bash
npx vitest run src/server/__tests__/fill-reconciliation.test.ts
npx vitest run src/server/services/fill-reconciliation-service.drift-sweep.test.ts
```

Required RED additions:
- server qty 1 vs broker qty 0 is drift by default;
- clearing MES cannot clear unresolved MNQ on the same account;
- account-wide conservative entry block remains until all unresolved symbol problems are cleared.

## AR-1173 — unhandled rejection must enter fatal teardown

Start with:

```bash
npm run build
```

No existing dedicated test was found by the GPT audit. Add the smallest process/shutdown helper seam or isolated test necessary to prove an `unhandledRejection` reaches the same graceful-fatal teardown authority already used for fatal termination. Do not spawn a second shutdown architecture.

## AR-1184 — PAPER -> broker explicit account identity

Existing focused tests:

```bash
npx vitest run src/server/__tests__/server-mediated-executor.test.ts
npx vitest run src/server/__tests__/live-order-lifecycle-gate.test.ts
```

Required RED addition: with two enabled Topstep accounts on the same firm, PAPER entry must not choose arbitrary `LIMIT 1` account identity. Entry, persisted order, reconciliation, and every exit must conserve one explicit account ID. Zero/ambiguous identity fails closed. No broker network egress in this proof.

## AR-1174 — dormant network-failover honesty

Start with:

```bash
npm run preflight:vacation
npm run build
```

Add a focused regression proving an unstarted/unmeasured network monitor cannot report `PRIMARY_HEALTHY` as if a measurement occurred. Do not activate global network failover as part of this packet.

## AR-1177 — exact release-SHA launch authority

Required evidence is CI/workflow-level, not just a unit test:

```text
release_sha == full_lane_receipt_sha
Fast Lane green alone != launch authority
```

Run the repository's full required release lane on the exact candidate SHA. Any advisory/failing full Python engine state remains a blocker until AR-1171 closes the escape hatch.

## AR-1171 / AR-1172 — fake-green CI

Full Python engine command:

```bash
python -m pytest src/engine/ -q --tb=short
```

AR-1171 RED: intentionally failing an engine test outside the Fast Lane subset must make the blocking CI lane fail.

AR-1172 RED: a previously allowlisted failure that turns green must require baseline shrink/removal; re-breaking that same test later must not remain hidden by a stale allowlist.

## AR-1182 — 120-strategy load test

Do not create 120 fake WebSockets. Drive the real shared-feed -> PAPER-session fan-out.

Proof must include:

```text
120 active PAPER sessions
shared symbol sockets reused
no missing bars
no duplicate bars
per-session order preserved
one slow/failing session does not corrupt another
zero silently swallowed session failures
DB/audit failure counts exposed
latency/queue/resource headroom recorded
```

Run load proof separately from normal unit CI so timing noise does not make correctness tests flaky.

## AR-1183 — one-strategy golden run

Only after AR-1138 receives GPT semantic PASS.

The first golden candidate is the accepted AR-1138 strategy. Preserve machine-verifiable identity/hash across:

```text
source evidence
-> Graph Engineering
-> Compiler
-> Strategy Factory
-> backtest/replay
-> Context Observer (read-only)
-> Qualification
-> 3-5 day PAPER
-> no-egress execution intent
```

Any silent semantic delta is RED.

## EXISTING ROBUSTNESS ARSENAL — REUSE, DO NOT REBUILD

Trading Forge already contains the statistical/stress/simulation systems needed for heavy proof. These are **not** reasons to create a second Monte Carlo, walk-forward, CPCV, synthetic-market, black-swan, or failure-injection framework.

### Stage 1 — while coding: fast contract proof

Use the smallest tests that exercise the production seam being changed. Typical research-engine contract checks already in-tree include:

```bash
python -m pytest \
  src/engine/tests/test_walk_forward_wrc_spa_emission.py \
  src/engine/tests/test_walk_forward_slippage_survival.py \
  src/engine/tests/test_risk_metrics_properties.py \
  -q --tb=short
```

For compiler/factory work, use the packet-specific RED/GREEN test first. Do **not** run a multi-hour research battery after every small implementation edit.

### Stage 2 — packet finish: adversarial/failure proof where relevant

Existing runtime/capital-safety failure-injection tests include:

```bash
npx vitest run \
  src/server/__tests__/failure-injection-daily-trade-cap.test.ts \
  src/server/__tests__/failure-injection-frozen-policy-drift.test.ts \
  src/server/__tests__/failure-injection-dll-band-escalation.test.ts \
  src/server/__tests__/failure-injection-boot-migration-failclosed.test.ts \
  src/server/__tests__/failure-injection-dead-mans-heartbeat-kasa-escalation.test.ts \
  src/server/__tests__/failure-injection-kill-switch-l2-l3-force-close.test.ts
```

Factory/compiler registry fault proof already has dedicated paths such as:

```bash
npx vitest run src/server/__tests__/deepscan22-x6-factory-failure-injection.test.ts
python -m pytest \
  src/engine/tests/test_ds22_y6_registry_completeness_real_scanner_fault_injection.py \
  src/engine/tests/test_ds22_x6_archetype_registry_parity_injection.py \
  -q --tb=short
```

Use only the failure families touched by the packet, then run the broader regression required by that packet.

### Stage 3 — strategy survivor/finalist: heavy statistical battery

The existing engine already owns walk-forward/CPCV, DSR, PBO, WRC/SPA and Monte Carlo survival. Do not duplicate this math in an advisor/worker helper.

Useful wiring checks:

```bash
python -m pytest \
  src/engine/tests/test_ds22_x5_cpcv_purge_both_paths.py \
  src/engine/tests/test_ds22_x5_mc_ruin_ci_wiring.py \
  src/engine/tests/test_walk_forward_wrc_spa_emission.py \
  -q --tb=short
```

`src/server/lib/promotion-gate-orchestrator.ts` is the existing PAPER -> DEPLOY_READY gate authority for persisted B14/WFE/CPCV/WRC/SPA evidence. It **evaluates existing evidence**; it is not a replacement for running the underlying research engines.

### Existing full-battery A/B harness — overlay research only

`scripts/full-battery-mode-ab.py` is an existing orchestration harness that reuses the production walk-forward and Monte Carlo engines. Its own contract intentionally supports a fast pass before the expensive MC pass:

```bash
# Fast WF/CPCV-style A/B evidence first
PYTHONPATH=. python scripts/full-battery-mode-ab.py --spec-file <spec.json>

# Heavy B14 Monte Carlo only when the research question has survived the fast pass
PYTHONPATH=. python scripts/full-battery-mode-ab.py --spec-file <spec.json> --include-mc
```

Do not repurpose this as a generic candidate runner: it is specifically an overlay Mode A/B research harness. Reuse its staged pattern and underlying engine functions rather than copying its statistical logic.

### Population gate-noise calibration — calibration only

The repo already has a null-strategy calibration harness for measuring how often the full battery passes zero-edge strategies by chance:

```bash
# Smoke proof of the calibration conveyor
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --smoke --n-smoke 3

# Full population calibration when gate semantics/version changes
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42

# Add B14 MC only when the calibration needs the MC gate
TF_ALLOW_FIXED_1=true python scripts/null_gate_calibration.py --n 100 --seed 42 --include-mc --mc-sims 10000
```

This is **not** a candidate-profitability runner. It measures the battery noise floor. Do not run it for every worker packet. Re-run it when the gate battery itself changes or when population-scale interpretation requires a fresh calibration.

### Synthetic regimes / black-swan stress

Existing synthetic-market and black-swan systems already have direct engine/service tests:

```bash
python -m pytest \
  src/engine/tests/test_synthetic_market_simulator.py \
  src/engine/tests/test_black_swan_evaluator.py \
  -q --tb=short

npx vitest run \
  src/server/__tests__/synthetic-black-swan-service.test.ts \
  src/server/__tests__/synthetic-black-swan-lifecycle-advisory.test.ts
```

Use these systems when the packet/candidate needs regime or crisis robustness. Do not make synthetic stress part of every 5-line coding loop.

### Mocking law

Mocks are allowed to control a dependency **outside** the behavior being proved (for example network/database/provider failure while the production compiler/runtime/reconciliation function remains real).

Do not:

```text
mock the compiler -> claim compiler proof
mock reconciliation -> claim reconciliation proof
copy production logic into the test -> compare copy to copy
mock every production boundary -> call the route end-to-end
```

When a critical test depends heavily on mocks, require a real-path/integration witness or mutation/negative control before GPT PASS.

## FAST + ROBUST ROUTING LAW

Use the cheapest proof that can falsify the current change, then escalate only when the artifact survives:

```text
small code edit
-> focused production-seam RED/GREEN
-> relevant mutation/negative control
-> packet-specific adversarial/failure test
-> broader subsystem regression
-> GPT independent grade

strategy reaches survivor/finalist status
-> existing WF/CPCV + DSR/PBO/WRC/SPA
-> existing Monte Carlo / firm survival
-> parameter/slippage/regime sensitivity as applicable
-> existing synthetic/black-swan stress as applicable
-> PAPER qualification

runtime/execution milestone
-> existing failure injection
-> restart/reconciliation/race tests
-> bounded load/stress proof
-> no live broker/Topstep activation unless separately authorized
```

Fast engineering means minimizing **total time to a correct result**, not minimizing the runtime of one command. Heavy batteries are valuable when they prevent expensive rework, but running them indiscriminately on every edit is itself a performance bug.

## Final packet completion

A focused green is not enough when the change touches shared production authority. Before report/push, run the broader commands required by the packet, typically:

```bash
npm run build
npm run test:full-fleet
```

and Python engine coverage when the packet touches Python/compiler/backtest semantics.
