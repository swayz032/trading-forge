# MNQ v2.4 — GPT Engineer Onboarding

## Why this file exists

This is the zero-chat-history handoff for a new GPT engineer joining the current MNQ v2.4 strategy project. Do not ask the trader to reteach rules that are already frozen in repository evidence. Read the sources below, inspect the exact current branch head and CI state, then continue the critical path.

This project is not trying to make a backtest look profitable. It is trying to determine whether the trader's real discretionary MNQ process can be translated faithfully, tested causally, shown to have a robust clean edge, and executed safely. A negative edge result is an acceptable scientific result. Hindsight, parameter rescue, semantic drift and evidence relabeling are not.

## Repository coordinates

- Repository: `swayz032/trading-forge`
- Working branch: `research/current-mnq-strategy-v2-4-zone-first-candles`
- Pull request: `#38`
- PR policy during research: **DRAFT / DO NOT MERGE**
- Strategy release: `MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1`
- Instrument: MNQ
- New York execution window: 09:30–12:00 America/New_York
- Maximum strategy trades: 1 per session
- Frozen stop: 17.25 points

Never assume the SHA in this document is current. The first action of every handoff is to inspect PR #38 and the branch head, then inspect exact-head workflow status before writing code or issuing a completion claim.

## Read these sources first, in this order

1. `research/current_mnq_strategy_v2_4_roadmap.json` — locked fast/robust critical path and non-goals.
2. `research/current_mnq_strategy_v2_4_spec.json` — master strategy contract.
3. `research/current_mnq_strategy_v2_4_entry_semantics.json` — exact entry families and live FORCE1 semantics.
4. `research/current_mnq_strategy_v2_4_user_fidelity_gold.json` — trader-confirmed screenshot/video evidence labels.
5. `research/current_mnq_strategy_v2_4_key_level_semantics.json` — key-zone quality/lifecycle/range-room contract.
6. `research/current_mnq_strategy_v2_4_levels.py` — executable key-zone map.
7. `research/current_mnq_strategy_v2_4_force.py` — live-force equation.
8. `research/current_mnq_strategy_v2_4_kernel.py` — shared causal historical/live candidate path.
9. `research/current_mnq_strategy_v2_4_targets.py` — first-reaction TP engine.
10. `research/current_mnq_strategy_v2_4_policy.py` and `research/current_mnq_strategy_v2_4_edge.py` — evidence/promotion gates.
11. `research/current_mnq_strategy_v2_4_oos.py` — sealed runner.
12. `research/current_mnq_strategy_v2_4_replay_lab.py` — blind Human-vs-Bot fidelity laboratory.
13. PR #38 body and exact-head GitHub Actions results — current operational status, never a replacement for code/evidence inspection.

If prose disagrees with executable frozen contracts, stop and reconcile the contradiction explicitly. Do not silently choose whichever interpretation produces better performance.

## Master trading equation

`TRADE = SESSION ∧ PREMARKET_PRIOR ∧ VALID_KEY_LOCATION_OR_APPROVED_PREBREAK_EXCEPTION ∧ VALID_CANDLE_STORY ∧ SUSTAINED_INTRA_CANDLE_DIRECTIONAL_FORCE ∧ ROOM_TO_FIRST_REACTION ∧ FIRST_A_PLUS ∧ DAILY_BULLET_UNUSED`

Any required term false means **NO TRADE**.

Core trader phrase:

**Location gives permission. Candle sequence tells the story. Momentum/force pulls the trigger.**

A candlestick pattern name by itself never creates a trade.

## Key-level / location semantics

- Key levels are zones, not magic single prices.
- Primary evidence includes repeated independent rejection/wick events and repeated support/resistance behavior.
- Strong displacement away from a swing can support the exceptional single-swing path when the causal quality gate passes.
- PDH, PDL, PWH and PWL are part of context/key-map construction.
- A zone can reject, reclaim, break, accept, retest or flip role. A touch does not predict direction.
- A transient wick breach is not automatically a role flip.
- Reclaim requires hold/defense plus directional control; a doji reclaim alone is not A+.
- On a causal pre-open MIXED/ranging structure, preserve nearby meaningful structure as reaction/TP context but deny fresh-entry authorization when the zone crowds the active range and lacks the frozen breakout travel room.
- Never use a hindsight full-day range label to authorize the morning map.

## Entry families — exact authority

### 1. Rejection

Authorized key zone → completed rejection/control story → forming trigger candle proves sustained directional force → entry may occur before parent close.

Valid prior stories can include doji, pin/rejection wick, inside bar, shrinking-candle approach into rejection, repeated rejection/control geometry, or equivalent buyer/seller control transfer. Rejection without force is WAIT/NO TRADE.

### 2. Normal breakout

The first completed print beyond the zone is setup-only. The following forming 5m candle may trigger before close only after sustained force is proven while maintaining the break.

Do not auto-enter the first breakout candle.

### 3. Weak break → 15m three-bar continuation

- Bar 1: completed weak break establishes acceptance beyond the zone.
- Bar 2: completed controlled pullback without invalidation.
- Bar 3: while forming, sustained directional force may trigger before the 15m close.

### 4–5. The only two pre-break early-entry exceptions

There are exactly two:

1. `REPEAT_TEST_MOMENTUM_ATTACK`: prior level test → at least one completed reset-away bar → distinct return attack → sustained intra5 force.
2. `DISPLACEMENT_SEQUENCE_INTO_LEVEL`: genuine displacement drive toward the authorized key zone → THIRD candle is the timing candle → sustained force may trigger before close.

All other pre-break entries are NO TRADE.

## Momentum versus displacement

Do not collapse these concepts.

- Momentum = directional body/control geometry. Range expansion is not required.
- True displacement = momentum plus the frozen range-expansion requirement.
- Every strong green/red momentum candle is **not** displacement.
- FVG formation is irrelevant to displacement-entry authority and is not required.

## FORCE1 — live entry clock

The trader watches the forming trigger candle as a buyer/seller tug-of-war. Waiting for every 5m close can be materially late against the frozen 17.25-point stop and can consume normal pullback room.

Frozen force equation:

`FORCE = PARTIAL_MOMENTUM_GEOMETRY ∧ PATH_EFFICIENCY >= Params.body_frac ∧ LATEST_CLOSE_AT_DIRECTIONAL_EXTREME ∧ >=2_COMPLETED_1M_OBSERVATIONS ∧ PARENT_CANDLE_STILL_OPEN`

Historical parity uses completed 1-minute sub-bars only. The system must never:

- use the final 5m/15m OHLC to backdate an earlier entry;
- use the next candle to decide whether current force was real;
- invent tick order inside a 1-minute OHLC bar;
- grant intra-candle privilege when force only becomes visible at parent close.

Tug-of-war/giveback increases path travel without equivalent directional progress and lowers path efficiency.

## TP / first reaction semantics

Canonical contract label: `FIRST_MEANINGFUL_PHYSICAL_REACTION`.

The first meaningful physical reaction area in the trade direction owns the TP/room decision.

- Nearer meaningful liquidity/reaction cluster before farther FVG → nearer cluster wins.
- Nearer active FVG before farther cluster → nearer FVG wins.
- A farther prettier feature may never leapfrog a nearer meaningful reaction area.
- A 5m liquidity cluster or FVG internal to the winning broader area may refine TP only inside that area.
- FVG is reaction/TP context; it is not a hidden displacement-entry requirement.

## Human-vs-Bot fidelity lab

Before clean edge certification, the current fidelity stage includes a blind replay lab. The trader reviews frozen historical situations without future candles, PnL, bot decisions, bot key zones, bot TP or case-selection labels.

The trader independently provides:

- key support/resistance zones;
- TP / first-reaction area when trading;
- LONG / SHORT / WAIT / NO TRADE;
- FORCE REAL / TUG OF WAR;
- optional notes.

The bot answer key is physically separate until trader labels are frozen. Grade key/TP areas geometrically rather than demanding identical pixels: overlap, center/edge distance in MNQ ticks, width, missed zones, extra zones and first-reaction ordering. A disagreement is evidence to investigate, not automatic permission to change rules.

If the trader confirms the bot mistranslated the strategy, repair the smallest semantic defect and add a permanent regression. Do not change a rule because the revealed trade later won or lost.

## Locked fast/robust roadmap

The critical path is exactly:

**FIDELITY → FREEZE → CLEAN_EDGE → ROBUSTNESS → EXECUTION → SHADOW → PRODUCTION**

See `research/current_mnq_strategy_v2_4_roadmap.json` for exact stage exit contracts.

Parallel lanes are allowed where independent:

- A — Strategy fidelity: replay, disagreement mining, regression fixes.
- B — Infrastructure: memory/runtime performance, CI speed, deterministic replay/data loading.
- C — Evidence: causality, fingerprints, receipts, clean-exam readiness.
- D — Execution: shadow/runtime parity and broker safety, without changing trading semantics.

Fast engineering means parallelizing independent work and continuously repairing failures. It never means lowering proof standards.

## Hard non-goals before v2.4 is decided

Do not add or use these to rescue the current strategy:

- new indicators;
- new strategy families;
- PnL-selected parameter optimization;
- ML optimization;
- quantum optimization;
- large FORCE1 variant searches;
- widening the 17.25-point stop because results look bad;
- moving TP farther because historical PnL looks prettier;
- NQ substitution or synthetic pre-launch MNQ as clean MNQ evidence.

Do not perform exploratory clean PnL runs between semantic changes.

## Clean evidence chronology — do not rewrite history

Frozen clean dataset:

- genuine MNQ only;
- 2019-05-06..2021-12-31;
- dataset SHA256 `45c792819f1f4680a7d50051abda85a3c2e4ca617c749940a2aa4b7c88b6c4af`;
- 547 scoreable sessions after the predeclared quarantine.

The earlier PC2 clean runner **did begin processing this dataset**, so do not call the data literally untouched. That attempt aborted with NumPy/Pandas `ArrayMemoryError` before `run_backtest()` returned and before any ledger, report, fold result or edge certificate was observed.

Exact historical status:

`ABORTED_PRE_RESULT_ARRAY_MEMORY_ERROR_NO_LEDGER_OR_EDGE_RESULT_OBSERVED`

Preserve that evidence. Do not delete or relabel it. The later FORCE1 correction came from trader videos/direct labels before any clean performance result was observed, not from clean PnL selection.

The 2022-01-01..2026-08-17 era and Jan-Apr 2026 M26 sample are seen/development evidence only. They may diagnose mechanics and fidelity but may not certify or tune edge.

## Clean edge requirements

A frozen exact SHA must satisfy all preregistered requirements, including:

- >=500 clean score sessions;
- >=100 trades;
- exactly 4 chronological folds;
- >=3 positive folds;
- bootstrap LCB95 > 0;
- highest declared cost-stress expectancy > 0;
- top-5%-winners-removed expectancy > 0;
- leave-best-month-out expectancy > 0;
- break-even margin > 0;
- weakest-link robust expectancy > 0.

No parameter search, best-variant selection or threshold rescue after viewing clean performance.

## Engineering operating procedure

For every task:

1. Inspect PR #38 exact head and workflow state.
2. Read the governing contract/source for the affected behavior.
3. Reproduce the defect with the smallest causal test when possible.
4. Fix the real source, not the assertion, unless the assertion is demonstrably stale relative to an already-frozen contract.
5. Add/strengthen regression evidence.
6. Commit atomically when practical.
7. Run/inspect exact-head gates.
8. Continue diagnose → fix → commit → rerun → inspect until green or a genuine external/tool/permission blocker.
9. Never call an in-progress/queued/cancelled run a pass.
10. Never use a passing older SHA as proof that the current exact SHA is green; older strategy-identical results may be supporting diagnostics only.

When a test fails, distinguish:

- trading-semantic defect;
- implementation defect;
- stale migration/contract test;
- infrastructure/runtime problem;
- data-quality problem;
- external GitHub/broker/tool blocker.

Do not weaken the strategy equation to make CI green.

## Safety / production boundaries

- PR #38 remains DRAFT / DO NOT MERGE until explicitly authorized after required gates.
- No real-money promotion based on backtest alone.
- Credentialed broker/live operations belong on the user's authorized local environment under the existing runtime safety contract, not hosted CI.
- Missing/stale/ambiguous data, wrong contract identity, state mismatch, fingerprint mismatch or unreconciled broker state must fail closed.
- Strategy semantics and risk sizing are separate: execution risk may reduce/refuse size but must not silently alter the signal equation.

## Handoff format for the next engineer

A useful handoff should state, at minimum:

- exact PR/branch head SHA;
- current roadmap stage;
- exact strategy release;
- what was changed since previous SHA;
- exact tests/workflows and their real status;
- current blocker, if any;
- whether trading semantics changed;
- whether any clean performance result was observed;
- next smallest critical-path action;
- explicit `DO NOT MERGE` status until promotion gates pass.

Do not write a narrative that forces the next engineer to trust you. Point them to commits, tests, receipts, artifacts and exact repository evidence.
