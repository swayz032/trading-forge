# GPT EXTERNAL ADVISOR RULING — AR-1197

**Date:** 2026-08-15  
**Type:** FAST ENGINEERING / EXISTING ROBUSTNESS ARSENAL REUSE AUDIT  
**Status:** EXECUTED / NO-DUPLICATE-SUBSYSTEM RULING / CLAUDE INDEX UPDATED  
**Source of truth:** `swayz032/trading-forge`

## DECISION

Trading Forge already contains substantial stress, simulation, statistical robustness, failure-injection, and adversarial-testing machinery. The correct fast-engineering move is **reuse + staged dispatch**, not another Monte Carlo/walk-forward/CPCV/synthetic/fault framework.

A concrete support gap was found: the existing Claude `TEST-COMMAND-INDEX.md` exposed AR-specific focused tests and load/golden-run guidance, but did not surface the existing robustness arsenal or define when Claude should escalate from cheap coding-loop tests to expensive research/runtime stress.

That gap is now closed on `external-advisor/gpt-rulings` by commit:

`077839859fc0e88ceae2d4744b69a1f5895b2910`

No production code, compiler semantics, Strategy Factory semantics, PAPER authority, broker behavior, Topstep network path, or AR-1138 state changed.

---

## 1. EXISTING SYSTEMS VERIFIED — DO NOT REBUILD

### Monte Carlo / firm survival

Existing authorities include:
- `src/engine/monte_carlo.py`
- `src/server/services/monte-carlo-service.ts`
- `src/engine/mc_regime_resampling.py`
- `src/engine/mc_multi_asset.py`

`backtest-service.ts` already imports and invokes the Monte Carlo service on production backtest flows, with pending-row/idempotency/circuit-breaker hardening in existing paths.

### Walk-forward / CPCV / statistical anti-overfit

Existing authorities include:
- `src/engine/walk_forward.py`
- `src/shared/walk-forward-schema.ts`
- `src/server/lib/wfe-gate.ts`
- `src/engine/pbo_gate.py`
- `src/server/lib/pbo-gate.ts`
- WRC/SPA emission and gate tests
- CPCV purge/path tests
- DSR and risk-metric property tests
- parameter-drift gate
- ablation tooling

### Promotion gate authority

`src/server/lib/promotion-gate-orchestrator.ts` already owns PAPER -> DEPLOY_READY evaluation for persisted evidence including B14/WFE/CPCV/WRC/SPA.

Important distinction:

**promotion-gate-orchestrator evaluates evidence; it does not replace or reimplement the research engines that produce the evidence.**

Do not create a second promotion/statistics authority.

### Full battery orchestration pattern already exists

`scripts/full-battery-mode-ab.py` is a real existing orchestration harness for overlay A/B research. It explicitly reuses production walk-forward and Monte Carlo engine functions rather than reimplementing gate math.

It already encodes the desired fast-engineering staging pattern:
- fast WF/CPCV-style pass first;
- expensive B14 Monte Carlo only with `--include-mc`;
- bounded concurrency;
- resumable manifest;
- advisory/file-only governance;
- no production persistence.

Its documented MC cost is approximately five minutes per mode per strategy, which is exactly why heavy MC must not run after every small edit.

The harness is overlay-specific and must not be falsely relabeled as the generic candidate runner. Reuse the pattern and underlying authorities, not the overlay-specific semantics.

### Gate battery noise calibration already exists

`scripts/null_gate_calibration.py` + `docs/gate-battery-calibration.md` already define population-scale null calibration for the WF/CPCV + DSR + PBO + WRC/SPA + optional B14 battery.

The document explicitly says the battery is intended to evaluate roughly 200 compiled strategies and that population-scale passes only count above the measured null-strategy noise floor.

It also already distinguishes:
- smoke calibration;
- full N=100 calibration;
- resumable batches;
- optional expensive MC.

Do not misuse null calibration as a candidate profitability run.

### Synthetic regime / black-swan systems already exist

Existing authorities include:
- `src/engine/synthetic_market_simulator.py`
- `src/engine/synthetic/stochastic_regime_generator.py`
- `src/server/services/synthetic-regime-bank-service.ts`
- `src/server/services/synthetic-black-swan-service.ts`
- `src/engine/black_swan_evaluator.py`
- associated engine/server tests.

No new synthetic crisis framework is justified without a measured capability gap.

### Failure injection already exists broadly

The repository contains existing failure/fault-injection coverage across, among others:
- daily trade cap;
- frozen-policy drift;
- DLL escalation;
- boot migration fail-closed behavior;
- dead-man heartbeat recovery/escalation;
- kill-switch force close;
- compiler/factory registry faults;
- gate faults;
- CPCV/MC wiring faults.

Earlier repo history also records an existing 42-test failure-injection foundation for major safety/recovery states.

No generic failure-injection framework rebuild is authorized.

---

## 2. DEEP ARCHITECTURAL FINDING

The repo does **not** have one universal tool that should run every robustness mechanism on every code change—and it should not.

That would be slower and less correct.

There are two different concerns:

### Engineering correctness loop

Purpose:
prove Claude's current code change is correct.

Best path:

```text
focused RED
-> smallest repair
-> focused GREEN
-> mutation/negative control
-> affected subsystem regression
-> GPT grade
```

### Strategy/runtime robustness loop

Purpose:
attack a strategy or runtime milestone after it has earned the cost of deeper testing.

Best path:

```text
survivor/finalist
-> WF/CPCV + DSR/PBO/WRC/SPA
-> Monte Carlo / firm survival
-> slippage/parameter/regime stress
-> synthetic/black-swan stress where applicable
-> PAPER
```

or for runtime:

```text
runtime milestone
-> existing failure injection
-> restart/reconciliation/race proof
-> bounded load proof
-> deployment-specific evidence later
```

Trying to collapse both loops into one always-on mega-harness would make Claude slower and increase noisy/flaky proof.

---

## 3. MOCKING RULING

Mocking remains useful when it controls a dependency outside the behavior under proof.

Acceptable example:

```text
real reconciliation logic
+ simulated broker timeout
```

Unacceptable example:

```text
mock reconciliation logic
-> claim reconciliation passed
```

Critical mocked tests should be backed by a real-path/integration witness or a mutation/negative control when practical.

The new GPT test-theater detector remains a support screen; it does not replace semantic inspection.

---

## 4. CLAUDE FAST TEST INDEX UPDATE

`advisor-prepared/two-worker-claude/TEST-COMMAND-INDEX.md` now includes:
- existing walk-forward/WRC/SPA/slippage/property test commands;
- existing capital-safety/runtime failure-injection commands;
- compiler/factory fault-injection commands;
- CPCV + Monte Carlo wiring checks;
- the existing overlay full-battery fast-vs-MC invocation pattern;
- null calibration smoke/full/MC commands with correct calibration-only warning;
- synthetic market / black-swan test commands;
- mocking law;
- one FAST + ROBUST routing law.

This is a direct Claude quota-saving change: the worker no longer needs to rediscover these systems from the repo before using them.

---

## 5. FAST ENGINEERING RULING

The current fast-engineering architecture is stronger when it **dispatches existing heavy systems selectively** rather than treating stress testing as an always-on tax.

Correct optimization target:

**minimum total time to a correct, independently proven result.**

Not:

**minimum runtime of one command.**

A five-minute stress run can be fast engineering if it prevents hours of rework at the correct milestone. The same five-minute run is waste if repeated after every tiny edit before the artifact has survived cheaper falsification.

---

## 6. PRESERVED GATES

Unchanged:
- AR-1138 remains first Worker 1 order;
- single-strategy compiler harness remains gated by `AR_1138_GPT_PASS`;
- runtime fault harness remains gated by `WORKER_2_ACTIVATION`;
- Worker 2 activation remains gated;
- PAPER activation remains controlled;
- broker egress remains OFF;
- Topstep network path remains OFF.

---

# FINAL RULING

**EXISTING ROBUSTNESS ARSENAL: SUBSTANTIAL AND REUSABLE.**

**DO NOT BUILD ANOTHER GENERIC STRESS/SIMULATION/MONTE-CARLO/WALK-FORWARD FRAMEWORK.**

**FAST ENGINEERING SHOULD NOW ROUTE CLAUDE INTO THE EXISTING SYSTEMS AT THE CHEAPEST CORRECT STAGE, ESCALATING TO HEAVY PROOF ONLY AFTER THE ARTIFACT SURVIVES CHEAPER TESTS.**

**CLAUDE TEST-COMMAND INDEX: UPDATED TO MAKE THAT REUSE IMMEDIATE.**