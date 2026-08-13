# BLUEPRINT V4 — REVISION 5 RESEARCH + PAPER ADDENDUM

**Status:** FROZEN ENGINEERING SEQUENCE  
**Date:** 2026-08-13  
**Companion design:** `docs/designs/CONTEXT-EDGE-LAB-V1-FREEZE-2026-08-13.md`

This addendum updates the V4 engineering order without weakening source-fidelity, research-validity, replay, PAPER, or safety gates. It does not replace historical V4 evidence; it governs the current sequencing where older planning text conflicts.

## MASTER ARCHITECTURE — AUTHORITATIVE SIX-STAGE CHAIN

The V4 system is organized as one ordered architecture:

```text
GRAPH ENGINEERING
-> COMPILER
-> STRATEGY FACTORY
-> CONTEXT OBSERVER
-> QUALIFICATION
-> AUTONOMOUS RUNTIME
```

This six-stage chain is the authoritative organizing model for current engineering and future advisor/worker decisions.

### Stage 1 — Graph Engineering

Graph Engineering represents the source strategy as exact decisions, dependencies, ordering, state transitions, invalidations, entry requirements and source-owned exits. Existing DecisionAtom/state-machine/decision-closure/dependency-graph machinery is the backbone. Do not create a competing graph architecture unless measured evidence proves the current representation cannot carry a required source decision.

### Stage 2 — Compiler

The compiler lowers a certified source graph into deterministic executable strategy logic while preserving source semantics and provenance across the production boundaries. It must refuse unsupported or ambiguous source decisions rather than silently substitute nearby logic.

### Stage 3 — Strategy Factory

The Strategy Factory processes the source library at scale. Each source strategy receives either a faithful executable compile or an exact measured refusal. Faithful compiles move into source-faithful backtesting and candidate screening immediately; the factory does not wait for every refusal in the library to be repaired.

### Stage 4 — Context Observer

The Context Observer records deterministic decision-time market context around source-faithful signals/trades. It is read-only with respect to the source strategy. It cannot veto a source trade, move source exits, change size, or silently mutate strategy state. Cheap context observation should piggyback on existing historical passes where practical.

### Stage 5 — Qualification

Qualification determines whether a faithfully compiled candidate deserves promotion. This includes source-faithful edge screening, bounded Context Edge challengers where justified, untouched OOS, walk-forward/robustness methods, execution stress, deterministic replay parity and the required 3–5 day PAPER qualification window. Discovery is never treated as proof.

### Stage 6 — Autonomous Runtime

Only qualified artifacts may enter the autonomous runtime. The runtime includes the deployed bot/services, risk/control enforcement, strategy lifecycle state, decay/health monitoring, restart/recovery, durable logging, alerts and the proven 3AM n8n advisory/reporting loop. Claude Code is an engineering/build dependency before deployment, not a required runtime dependency for ordinary operation.

### Supporting capability — Visual Intelligence

Visual Intelligence is not a seventh competing stage. It supports the six-stage chain when measured evidence requires it:

- **Source Visual Intelligence** supports Graph Engineering / compiler fidelity when transcript text alone cannot establish what the teacher visually demonstrated.
- **Market Visual Intelligence** supports Context Observer / qualification when genuinely visual information cannot be recovered faithfully from deterministic structured market data.

Prefer existing deterministic graph and market primitives whenever they can express the required fact. Do not rebuild Graph Engineering, create a second context brain, or insert broad visual-model work ahead of the critical path without a measured blocker.

### Fast-engineering law

Every new proposal must map to one of the six stages or to an explicitly supporting capability. If it does not remove a measured blocker, increase faithful throughput, strengthen qualification evidence, or harden autonomous operation, defer it. Reuse existing machinery before adding new architecture.

## 1. Current critical path

The active worker order remains AR-1138, as clarified by AR-1140.

1. Resume the worker's existing local state after quota reset; do not restart from scratch.
2. Run the real `pilot_conveyor` grounding/tiering/certification grade on the pinned sVkm extraction.
3. Treat pinned transcript spans as authority, not extractor paraphrases.
4. Resolve source stop geometry from evidence; do not silently map coarse extractor labels into a different executable geometry.
5. If grading fails or remains ambiguous, stop and report the exact failed condition/span/axis.
6. If grading passes, persist the real certificate and proceed directly to the existing compiler and §9.2 one-piece production vertical.
7. Do not repeat extraction, hand-edit source semantics, or open a generic infrastructure detour before this gate.

## 2. Breakthrough definition

The current breakthrough is useful when one real certified source strategy traverses the actual production compiler path with source semantics preserved across the relevant boundaries.

The real vertical remains:

```text
pinned source
-> production extraction
-> real grounding/grading
-> certified record
-> production compiler/spec producer
-> typed source roles + source risk in hashed spec
-> TypeScript parse/onboarding
-> DB persistence + reload
-> actual production cross-language bridge
-> actual Python strategy instance
-> required source/execution frames
-> exact source entry/stop/target semantics
```

No manual carrier injection may satisfy the final witness.

## 3. Full-library batch after breakthrough

Once the compiler vertical is trustworthy, run the existing strategy library through deterministic disposition.

Each member receives either:

- a faithful executable compile; or
- an exact measured refusal identifying the failed source condition / handoff / reusable capability cluster.

The research path does not wait for every refusal to be repaired. Faithful compiles move immediately into edge qualification while refusal clusters inform later capability work.

## 4. Source-faithful edge screening first

Every executable strategy begins as `SOURCE_FAITHFUL`.

The first pass is intentionally cheap and honest. It measures whether the faithfully compiled strategy shows enough credible behavior to justify deeper work.

Useful initial evidence includes distributional trade behavior, drawdown, MAE/MFE, effective sample, execution sensitivity, regime concentration and deterministic replay parity where applicable.

Obviously weak or under-evidenced candidates are parked before expensive research.

## 5. Context Edge Lab placement

The Context Edge Lab is now a formal qualification component governed by `CONTEXT-EDGE-LAB-V1-FREEZE-2026-08-13.md`.

For speed, cheap deterministic context snapshots may be recorded during the same source-faithful historical pass. The observer is read-only: it cannot veto or modify the source trade.

Deep context analysis runs primarily on surviving candidates.

A discovered relationship is a hypothesis, not proof. Any promoted context rule becomes a separately identified challenger with independent confirmation and robustness evidence.

## 6. Visual Intelligence placement

V4 retains both multi-timeframe context and chart-and-transcript reconciliation.

Visual intelligence has two distinct jobs:

- **Source Visual Intelligence:** reconcile transcript text with chart/video evidence when source meaning is incomplete or ambiguous. This belongs to compiler/source understanding.
- **Market Visual Intelligence:** describe market context around a strategy signal. For historical research, deterministic structured market-data calculations are preferred whenever they can express the same fact reliably.

Broad visual-model expansion is not a prerequisite to the current compiler breakthrough. Build a visual capability when measured compiler failures or survivor research proves that capability is required.

## 7. Robustness funnel

Heavy validation is reserved for finalists and bounded context challengers.

Applicable methods include untouched OOS, chronological walk-forward, CPCV where appropriate, Monte Carlo/bootstrap, trial-aware overfit controls, selection-aware Sharpe assessment, parameter sensitivity, regime stability, execution-cost stress and deterministic replay parity.

No candidate is promoted merely because one optimized historical configuration looks best.

## 8. PAPER is a required qualification stage

The project reserves **3–5 completed qualifying trading days** for custom PAPER before the downstream venue-readiness decision.

For the operator's August 27 technical-readiness target, the preferred five-day PAPER window is:

- Aug 20
- Aug 21
- Aug 24
- Aug 25
- Aug 26

The latest intended three-day start is Aug 24.

During official PAPER:

- strategy/config/risk/execution versions remain frozen;
- context observation may continue as read-only telemetry;
- expected decisions/events are evaluated or formally excluded;
- replay parity, data quality, restart/recovery and control health are evidence requirements;
- a material semantic change creates a new candidate version and restarts qualification for that changed version.

Short-window profitability alone is not the qualification criterion.

## 9. 3AM n8n learning/intelligence loop during PAPER

Before or at PAPER entry, prove the nightly workflow live end-to-end:

```text
schedule fires
-> advisory/learning mode resolves correctly
-> nightly analyses run or surface explicit failure
-> report/fallback is produced
-> correlation/idempotency metadata remains traceable
-> report is durably posted/persisted
-> retry/fallback behavior is observable
-> off/kill state is respected
```

During official PAPER the nightly loop is advisory/evidence-producing. It may identify anomalies, regime changes, leak concerns, edge-decay signals and future improvement hypotheses, but it must not silently mutate the frozen strategy under qualification.

Any learning-driven semantic change belongs to a new candidate/version and requires fresh qualification evidence.

## 10. Fast-engineering priority rule

Until the August 27 technical-readiness decision, classify new work as follows.

### P0

- current AR-1138 grade/certification;
- required compiler/§9.2 joins;
- deterministic library disposition;
- source-faithful edge screening;
- finalist robustness/correctness;
- PAPER readiness and PAPER defects;
- required 3AM loop readiness evidence;
- no-Claude autonomous-runtime readiness blockers.

### P1 if it does not delay P0

- cheap context snapshot plumbing reused during existing backtests;
- bounded Context Edge analysis on survivors;
- measured capability repair that unlocks a high-value candidate;
- parallel pre-audit of downstream technical blockers.

### Defer

- broad Visual Intelligence expansion without a measured blocker;
- repairing every library refusal before testing faithful survivors;
- giant context optimizer / combinatorial filter search;
- cosmetic UI work;
- noncritical refactors;
- speculative architecture projects.

Speed comes from dependency order, reuse and evidence — never from weakening correctness.

## 11. Immediate execution order

### While the worker quota is paused

The external advisor may work only in non-conflicting lanes:

1. freeze this V4 addendum and the Context Edge design;
2. pre-audit the grading/compiler joins ahead of the worker;
3. pre-audit PAPER readiness;
4. pre-audit the 3AM n8n live-evidence requirements;
5. pre-audit no-Claude autonomous-runtime readiness;
6. do not modify the worker's unfinished engineering files or create a competing implementation.

### When the worker quota returns

1. inspect and preserve local in-progress AR-1138 state;
2. continue the real grading task exactly where it stopped;
3. push/report the completed decision point;
4. external advisor independently inspects and rules immediately;
5. if grade passes, proceed directly toward §9.2;
6. after breakthrough, batch faithful compiles/refusals;
7. run source-faithful edge screening with cheap context observations where available;
8. shortlist and validate finalists;
9. begin PAPER as early as safely possible, targeting Aug 20 for the five-day window;
10. run the proven 3AM advisory loop each PAPER night;
11. prove the no-Claude autonomy drill before treating the downstream runtime as self-sufficient;
12. make the downstream venue-readiness decision only after the required technical/research/PAPER/autonomy gates are green.

## 12. Freeze statement

No Context Edge, Visual Intelligence, full-library repair or optimization project may be inserted in front of the current compiler breakthrough unless a newly measured blocker proves that specific capability is required.

**Authoritative architecture:** Graph Engineering -> Compiler -> Strategy Factory -> Context Observer -> Qualification -> Autonomous Runtime.

**Frozen fast path:** finish the real compiler proof -> disposition the library -> find credible source edge -> deepen context only on survivors -> validate finalists -> 3–5 day PAPER with a frozen candidate and proven nightly advisory evidence -> prove no-Claude autonomy -> downstream readiness decision.
