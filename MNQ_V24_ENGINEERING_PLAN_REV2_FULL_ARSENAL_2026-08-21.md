# MNQ v2.4 — Engineering Plan Rev 2: Full Trading Forge Arsenal (2026-08-21)

**Status:** AUTHORITATIVE AMENDMENT / SUPERSEDES THE ORIGINAL PLAN WHERE THIS FILE DIFFERS  
**Strategy:** `MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`  
**Branch:** `research/current-mnq-strategy-v2-4-zone-first-candles`  
**PR:** #38 — **DRAFT / DO NOT MERGE**  
**Advisor lane:** `external-advisor/gpt-rulings-algo` → `algo-reports/ALGO-NNN`  

This revision preserves the locked strategy-development order while expanding the post-freeze research and survival plan to use the actual Trading Forge estate rather than a small subset of it.

The governing order remains:

`FIDELITY -> FREEZE -> CLEAN_EDGE -> ROBUSTNESS -> EXECUTION -> SHADOW -> PRODUCTION`

The full Trading Forge arsenal is available, but it is phase-gated. A tool being present is not permission to let it change trader semantics during FIDELITY.

---

## 1. Objective

Layer 1 — faithfully translate the operator's discretionary MNQ strategy.

Layer 2 — execute those same rules with machine consistency, causal memory, deterministic state, and no human execution leaks.

Layer 3 — only after v2.4 is frozen and objectively tested, allow challenger systems to propose improvements. Challengers never rewrite the frozen baseline merely because historical PnL improves.

**Core principle:** copy the trader first; prove edge second; attack the edge third; prove prop survival fourth; prove execution parity fifth.

---

## 2. Current measured state and corrections

Last independently verified strategy head before this plan-only amendment:

`27854bac8d7e91ffb3d04f1dc3bfb1a06541daaa`

At that SHA, all seven PR workflows completed **SUCCESS**:

- CI
- Current MNQ Strategy v2.3 Production Gates
- Current MNQ Strategy v2.4 Zone + Candle Production Gates
- Current MNQ Strategy v2.4 Human-Bot Replay Lab
- Current MNQ Strategy v2.4 5m Fidelity Calibration
- Current MNQ Strategy v2.4 Development Diagnostic
- Metric Snapshot Regression

Any commit after that SHA, including this plan-only commit, must regain exact-head green before a phase is declared closed.

ALGO-003 custody corrections are accepted in substance:

- the historical `11d8dec0...` label value is a self-declared field in the surviving labels file, not a proven dead-sandbox byte hash;
- the independently reproducible surviving label-file byte SHA is `1b20b0a8...` and its 14 case IDs/action census join the frozen manifest;
- the 13 screenshots added on 2026-08-21 are a mixed set and must stay split: 8 ledger pages (DIAGNOSTIC_ONLY) + 5 1m-vs-5m timeframe-comparison pages;
- the 74-row CSV is DIAGNOSTIC_ONLY and may never select a fidelity rule or threshold;
- measured ledger census is 74 rows, 28 buy / 46 sell, 61 target-side exits, 8 other, 5 scratches;
- four rows realize exactly the frozen 17.25-point loss geometry at 15 contracts / $2 per MNQ point. Because `initialSL` is N/A, this proves exact frozen-stop-distance realized losses, not the order-type mechanics of the exit.

### Two cheap custody gaps remain before a new canonical 14-case score is published

1. **Closed-world screenshot wording is internally inconsistent.** The unified registry still carries a statement equivalent to "all authoritative screenshot examples must be members of the sealed 65-file parent corpus" while the same registry contains separately authorized hash-bound examples/additions outside that archive. Repair the model, not the evidence:
   - keep the 65-file archive as a sealed parent snapshot;
   - model separately hash-bound pre-parent examples and post-parent operator-authorized additions explicitly;
   - prove the sets are disjoint by name/hash where they are claimed disjoint;
   - never call an outside item a member of the 65-file archive.

2. **`research/current_mnq_strategy_v2_4_user_fidelity_gold.json` is immutable trader-fidelity evidence but is not directly present in `build_contract.contract_files`.** Bind it directly into the release fingerprint and add a regression so changing that gold file invalidates the build identity.

These are pre-baseline evidence-identity fixes. They do not authorize strategy-semantic changes.

### Non-blocking custody items that must close before FREEZE

- bounded disposition of the 3h53m48s video: enumerate with a declared bounded method or mark custody-only/no semantic authority;
- reconcile any load-bearing sealed video role whose derivation method is not recorded;
- strengthen the ledger screenshot reconciliation receipt before using it as a load-bearing TP oracle: record matched-row count / mismatch count rather than only representative spot checks.

---

## 3. Data estate and chronology wall

Operator reports Nasdaq/MNQ historical data spanning **2015-2026**. This is a major research asset, but date coverage alone does not make all years clean OOS.

Before any new data slice is used, create a data-custody receipt containing:

- source/vendor and local/S3 object identity;
- symbol/contract family and whether the data are MNQ, NQ, or derived continuous futures;
- raw and derived SHA256 identities;
- bar resolution(s);
- timezone/session convention;
- roll calendar and adjustment method;
- first/last timestamps and session count;
- missing/duplicate/zero-volume/quarantine findings;
- exact contamination class.

### Contamination classes

`FIDELITY_ONLY` — screenshots, videos, labels, replay windows, trader corrections. Never edge evidence.

`DEVELOPMENT_CONTAMINATED` — any market period already inspected or used during strategy repair. May be used for diagnostics/robustness but never relabeled as unseen.

`SEALED_CLEAN_EXAM` — pre-registered untouched exam data. Existing sealed exam remains MNQ 2019-05-06..2021-12-31 with its existing dataset hash/charter.

`ROBUSTNESS_ONLY` — historical periods allowed for attack/regime analysis after freeze but not advertised as pristine OOS if previously seen.

`FORWARD_ESCROW` — sessions accumulated after the declared contamination cutoff and never used to rescue strategy semantics.

The newly available 2015-2026 estate must be partitioned before edge results are opened. No retroactive "clean" designation after looking at PnL.

---

## 4. Phase plan

### Phase 0 — exact-head integrity + evidence custody

Required:

- exact-head PR workflows green;
- fix the two cheap custody gaps in §2;
- no unresolved identity contradiction in the oracle chain;
- no new manual replay collection.

Exit: exact-head engineering green and the evidence identity consumed by the scorer is reproducible.

### Phase 1 — FIDELITY

Goal: make the bot reach the trader's state for the same causal reason.

Decision states remain:

`WAIT / ENTER_LONG / ENTER_SHORT / NO_TRADE`

The grader compares at minimum:

- action/state;
- direction;
- exact causal decision clock;
- selected S/R or active FVG interaction geometry;
- entry/story family;
- force receipt;
- first meaningful TP destination and reason;
- whether an earlier signal consumed the one-session bullet;
- mismatch class.

Run the frozen 14-case baseline after §2's two cheap custody fixes. The relayed historical score is not current truth until reproduced.

Repair order unless the new baseline disproves the dependency:

A. decision-time target map;  
B. Mar 31 reclaim lifecycle;  
C. six early-session one-bullet hazards;  
D. WAIT vs NO_TRADE predicates;  
E. timing/latency parity.

Every accepted semantic repair requires a red-proofed regression and full frozen-set rerun. PnL, winner/loser status and later-session information may not choose the repair.

Independent grading remains mandatory: doer != grader.

### Phase 2 — FREEZE

Freeze one exact strategy SHA and one complete evidence/build fingerprint.

Before exit:

- all material trader-vs-bot disagreements resolved or explicitly classified as source ambiguity;
- user fidelity gold bound;
- screenshot evidence-union semantics coherent;
- long-video disposition complete;
- inline CI gate contract extracted/parsed robustly enough to fail closed on unsupported assertion syntax;
- architecture/parity receipts refreshed;
- no post-freeze semantic rescue allowed from edge results.

### Phase 3 — CLEAN_EDGE

Run the pre-registered sealed exam exactly as chartered. First remove the prior `ArrayMemoryError` as an infrastructure-only repair with bounded-memory/chunked execution; do not touch strategy semantics.

Required edge evaluation includes the already sealed charter plus the Trading Forge statistical stack where compatible with the charter:

- standard historical backtest;
- chronological folds / walk-forward;
- CPCV/cross-validation where pre-registered and non-contaminating;
- WFE;
- PBO / overfit diagnostics;
- bootstrap confidence bounds;
- realistic commissions/slippage/fill assumptions;
- top-winner removal;
- leave-best-month-out;
- break-even cost margin;
- weakest-link analysis.

One-shot rule: no variant shopping after clean results are opened.

### Phase 4 — ROBUSTNESS: unleash Trading Forge

Only the frozen strategy enters this phase.

#### 4A. Statistical / sequence attacks

- classical Monte Carlo;
- MC confidence intervals;
- moving/block bootstrap;
- regime-resampled MC;
- adverse trade sequencing;
- drawdown and losing-streak distribution;
- tail/EVT analysis;
- best-day / best-month / top-winner removal;
- weakest-regime isolation.

#### 4B. Parameter / logic fragility attacks

- B15 parameter-jitter battery;
- parameter-neighborhood stability without re-optimizing the frozen stop;
- Frankenstein randomized/shuffled-market test;
- synthetic/GBM null controls;
- signal-correlation checks where relevant;
- deterministic replay / causal audit;
- future-leak and parity invariants.

#### 4C. Execution realism attacks

- worse slippage;
- commissions/fees;
- entry-delay sensitivity;
- partial-fill model;
- zero-volume critical-bar refusal;
- roll spread / contract transition effects;
- stale/missing-data refusal;
- latency budget and duplicate-order defenses.

#### 4D. Regime / black-swan challengers

- regime survival;
- historical high-vol, low-vol, trend, chop, crisis and transition slices;
- synthetic black-swan challenger;
- NEMO/synthetic scenario challengers where available.

Experimental systems provide advisory evidence unless separately pre-registered for authority.

Exit: edge remains defensible under every required weakest-link attack. A strategy that fails is reported as failed; the test is not weakened to save it.

### Phase 4P — PROP SURVIVAL (inside ROBUSTNESS, separate evidence packet)

Use the real prop-firm stack rather than only a simple drawdown calculator:

- `prop_sim.py`;
- `prop_compliance.py`;
- `prop_survival_model.py`;
- survival drawdown simulator;
- daily breach model;
- concentration analyzer;
- firm profiles / survival scorer / comparator;
- Topstep consistency and rule-version logic;
- Monte Carlo challenge paths;
- Survival Twin as an advisory challenger while its registry state is experimental/challenger.

At frozen risk inputs, publish at minimum:

- P(pass evaluation);
- P(trailing-drawdown breach);
- P(daily-rule breach);
- time-to-pass distribution;
- worst losing-streak / cushion distribution;
- consistency/concentration failure probability;
- payout-eligibility path metrics when the rule model supports them;
- uncertainty/confidence intervals where available.

The frozen 17.25-point stop is never tuned. Any sizing change requires an explicit operator decision and a new pre-registered experiment; it is not an automatic optimizer output.

### Phase 5 — EXECUTION

Bring the certified kernel into the shared execution path.

Required:

- same decision kernel historical/paper/shadow;
- paper-vs-backtest parity;
- broker abstraction only through authorized router;
- Topstep/prop compliance checks;
- stale-data refusal;
- contract/tick identity checks;
- duplicate-order/idempotency protection;
- server-side stop/TP and emergency flatten drills;
- reconciliation and latency instrumentation.

The generic Trading Forge TopstepX live-order path must not be called production-ready merely because prop simulation exists; execution certification is its own gate.

### Phase 6 — SHADOW

Run the exact frozen/certified build beside live NY-session markets with no real order authority.

Measure:

- signal parity;
- WAIT/NO_TRADE parity;
- decision-clock latency;
- first-A+ / one-bullet behavior;
- target-map parity;
- missed/extra signal rate;
- state/reconciliation drift.

No strategy changes are allowed to rescue shadow performance without reopening the research lifecycle under a new version.

### Phase 7 — PRODUCTION

Production eligibility requires:

- explicit operator release decision;
- device/account-bound release identity;
- runtime fingerprint verification;
- kill switch / dead-man heartbeat;
- daily reconciliation;
- drift detection / automatic halt policy;
- prop-rule compliance;
- audit trail and incident reconstruction.

PR #38 remains DRAFT / DO NOT MERGE until separately authorized.

---

## 5. MNQ v2.4 Trading Forge Arsenal Matrix

Every subsystem used or skipped must receive one of these statuses for this strategy:

`REQUIRED_NOW / REQUIRED_POST_FREEZE / ADVISORY_CHALLENGER / EXPERIMENTAL / NOT_APPLICABLE / BLOCKED`

Initial classification:

| Arsenal family | v2.4 status | Use |
|---|---|---|
| frozen replay / deterministic replay / fidelity grader | REQUIRED_NOW | trader-fidelity oracle and causal reconstruction |
| build fingerprint / invariant harness / parity engine / data-quality guards | REQUIRED_NOW | evidence identity, leak prevention, deterministic parity |
| backtester / analytics / risk metrics | REQUIRED_POST_FREEZE | clean edge and diagnostics |
| walk-forward / cross-validation / CPCV / WFE / PBO | REQUIRED_POST_FREEZE | generalization and overfit resistance |
| Monte Carlo / MC confidence / regime resampling / stress tests | REQUIRED_POST_FREEZE | sequence and uncertainty attacks |
| B15 parameter jitter | REQUIRED_POST_FREEZE | parameter fragility |
| Frankenstein randomization | REQUIRED_POST_FREEZE | lookahead / fake-edge null test |
| slippage / fill / partial-fill / roll-cost / entry-delay stress | REQUIRED_POST_FREEZE | execution realism |
| regime survival / EVT / tail-risk tools | REQUIRED_POST_FREEZE | weakest-regime and tail attacks |
| prop_sim / prop_compliance / prop_survival / survival package | REQUIRED_POST_FREEZE | Topstep/prop survival |
| paper / context_execution / shadow / reconciliation | REQUIRED_POST_FREEZE | execution and shadow parity |
| production hardening / observability / kill switch | REQUIRED_POST_FREEZE | release safety |
| synthetic black-swan / NEMO | ADVISORY_CHALLENGER until governance says otherwise | unseen-regime challenge |
| Prop-Firm Survival Twin | ADVISORY_CHALLENGER while registry marks experimental/challenger | secondary survival evidence |
| quantum MC / QMC / quantum adversarial / QUBO / quantum RL / cloud QMC | EXPERIMENTAL/ADVISORY unless separately pre-registered | challenger evidence only; no fidelity authority |
| critic optimizer / parameter evolver / mutation loop | BLOCKED DURING V2.4 FIDELITY; challenger-only after frozen baseline is decided | must never mutate trader semantics from PnL |
| generic 11-factor confluence / SMT / regime/narrative features not present in trader rules | NOT_APPLICABLE AS V2.4 INPUT; may be post-freeze diagnostic challenger only | no indicator creep |
| PDH / PDL / PWH / PWL strategy inputs | NOT_APPLICABLE / FORBIDDEN | explicitly outside current strategy |

Before ROBUSTNESS begins, turn this initial matrix into a machine-readable manifest that names the concrete subsystem/file/route, registry state, test command, required evidence output, and whether omission is allowed.

No report may say "full arsenal used" without that manifest and per-tool receipts.

---

## 6. Reproducible experiment receipt — mandatory for every major run

Every clean-edge, robustness, prop-survival, execution or shadow result must bind:

- exact strategy SHA;
- build/rules fingerprint;
- evidence-registry fingerprint where relevant;
- data source + SHA + date range + contamination class;
- engine/module version or file SHA;
- parameters/config;
- random seed(s);
- fees/slippage/fill assumptions;
- firm rules version when applicable;
- run start/end and runtime;
- raw output artifact identity;
- pass/fail decision and reason;
- grader identity / independent validation status.

A result without this receipt is diagnostic chatter, not promotion evidence.

---

## 7. Standing prohibitions

- No new manual replay/label collection.
- No PnL-selected fidelity rule.
- No post-clean threshold rescue.
- No 17.25-stop optimization.
- No invented third pre-break exception.
- No PDH/PDL/PWH/PWL strategy authority.
- No final 5m OHLC used to backdate a forming-5m entry.
- No experimental/quantum/critic system gets automatic strategy authority.
- No claim that a subsystem is production-ready because it exists in the repo.
- No claim that a test was run without an artifact/receipt.
- Doer != grader for promotion evidence.

---

## 8. Immediate execution order from this revision

1. Repair the unified screenshot-corpus membership contradiction.
2. Bind `current_mnq_strategy_v2_4_user_fidelity_gold.json` directly into the build fingerprint and regression.
3. Regain exact-head green after those evidence-only changes.
4. Run the frozen 14-case regrade and commit the full per-case scorecard with no PnL fields used for decision comparison.
5. Independent `accuracy-validator` grade.
6. Attack the measured mismatch clusters in the established order: decision-time TP map -> Mar 31 reclaim -> early-session bullet hazards -> WAIT/NO_TRADE -> latency.
7. Repeat until FIDELITY exit is legitimately met.
8. FREEZE one exact SHA.
9. Inventory/hash/partition the 2015-2026 Nasdaq/MNQ data estate before any new research use.
10. Run CLEAN_EDGE exactly as sealed.
11. If CLEAN_EDGE passes, execute the machine-readable full Arsenal Matrix through ROBUSTNESS + PROP SURVIVAL.
12. Only after survival: EXECUTION -> SHADOW -> operator-controlled PRODUCTION release.

This revision is designed so Claude Code can use all of Trading Forge without letting Trading Forge change what the trader actually taught before fidelity is frozen.
