# Requirement Traceability Matrix

Status: living verification matrix. A requirement is not considered implemented until its code location and at least one independent test/fixture are linked.

| ID | Requirement | Primary implementation | Current verification | Release blocker |
|---|---|---|---|---|
| IND-SEM-001 | Red trendline supplies overall-direction context only; crossing it cannot flip intraday direction. | `V1_RULEBOOK.md`; future platform layer | mutation/golden fixture required | Yes |
| IND-SEM-002 | Human-facing Liquidity Pool is internal `REACTION_ZONE`, not a claim of current resting orders. | `market_structure.py` + spec | zone tests + research control study pending | Yes for edge claim |
| IND-SEM-003 | Yellow line is `PROOF_LEVEL`; it is separate from blue reaction/key levels. | `market_structure.py` + rulebook | selector tests | Yes |
| IND-DATA-001 | Delayed data cannot be live-decision-support timing data. | `runtime_guard.py` | `test_runtime_guard.py` | Yes |
| IND-DATA-002 | Stale/gapped/unknown feeds fail closed. | `runtime_guard.py` | `test_runtime_guard.py` | Yes |
| IND-DATA-003 | Duplicate/out-of-order/malformed events fail closed. | `momentum_engine.py` | momentum + hardening tests | Yes |
| IND-DATA-004 | Symbol/contract change clears active setup state. | `momentum_engine.py` | momentum tests | Yes |
| IND-NUM-001 | NQ/MNQ price levels use explicit 0.25-point price grid. | `price_grid.py` | `test_price_grid.py` | Yes |
| IND-NUM-002 | Off-grid prices are rejected by default; snapping must be explicit. | `price_grid.py` | `test_price_grid.py` | Yes |
| IND-NUM-003 | NaN/Inf scores/distances/configs cannot enter selection logic. | `market_structure.py`, `momentum_engine.py` | `test_numeric_fail_closed.py`, `test_hardening.py` | Yes |
| IND-TIME-001 | Execution timeframe is 5m. | `runtime_guard.py`, rulebook | runtime tests | Yes |
| IND-TIME-002 | PDH/PDL come from prior completed platform-native Daily candle. | rulebook | platform parity fixtures pending | Yes |
| IND-TIME-003 | PWH/PWL come from prior completed platform-native Weekly candle. | rulebook | platform parity fixtures pending | Yes |
| IND-TIME-004 | America/New_York user-time handling must survive DST. | platform layer pending | DST fixture pending | Yes |
| IND-MOM-001 | One market update advances at most one momentum stage. | `momentum_engine.py` | unit + fuzz | Yes |
| IND-MOM-002 | Equal-price updates do not count as fresh pushes. | `momentum_engine.py` | unit | Yes |
| IND-MOM-003 | Hard recoil invalidates stale push chain. | `momentum_engine.py` | unit + fuzz | Yes |
| IND-MOM-004 | Slow second push cannot qualify solely because price eventually travels far enough. | `momentum_engine.py` | unit | Yes |
| IND-MOM-005 | Failed Candle 2 -> Candle 3 promotes completed Candle-2 extreme and resets state. | `momentum_engine.py` | unit + fuzz | Yes |
| IND-MOM-006 | Crash/restart state continuation is deterministic. | snapshot/restore | unit + random cut tests | Yes |
| IND-MOM-007 | LONG/SHORT logic is mirror symmetric unless a documented market rule intentionally differs. | reference engine | 20k mirror property | Yes |
| IND-CND-001 | Doji is parameterized, not a hidden visual guess. | `candle_features.py` | candle tests | Yes |
| IND-CND-002 | Momentum quality logs component measurements separately. | `candle_features.py` | candle tests | Yes |
| IND-SWG-001 | Swing cannot be used before confirmation time. | `swing_detector.py` | swing tests | Yes |
| IND-SWG-002 | Equal-high/equal-low ambiguity has deterministic policy. | `swing_detector.py` | swing tests | Yes |
| IND-ZONE-001 | Single wick is not automatically a reaction pool. | `swing_detector.py` / cluster logic | zone/swing tests | Yes |
| IND-ZONE-002 | Reaction-zone clustering is input-order deterministic. | `swing_detector.py` / cluster logic | zone/swing tests | Yes |
| IND-ENT-001 | Countertrend proof selector rejects noise-close candidates. | `market_structure.py` | selector tests | Yes |
| IND-ENT-002 | Countertrend proof selector rejects impractically far candidates. | `market_structure.py` | selector tests | Yes |
| IND-ENT-003 | Countertrend candidate requires stronger structural evidence than with-trend candidate. | `market_structure.py` | selector tests | Yes |
| IND-ENT-004 | Calibrated selection score wins; deterministic tie-breakers apply only to true ties. | `market_structure.py` | selector tests | Yes |
| IND-TP-001 | Conservative LONG TP is inside near/lower side of upper zone, not far wick. | `market_structure.py` | target tests | Yes |
| IND-TP-002 | Conservative SHORT TP is inside near/upper side of lower zone, not far wick. | `market_structure.py` | target tests | Yes |
| IND-TP-003 | Weak/countertrend move favors closer qualified pool. | `market_structure.py` | target tests | Yes |
| IND-TP-004 | Strong with-trend move may skip a close minor pool only under explicit calibrated rule. | `market_structure.py` | target tests | Yes |
| IND-PAR-001 | Python/Pine/FXR state/reason parity must hold on golden fixtures. | platform implementations pending | parity harness pending | Yes |
| IND-REP-001 | Realtime state vs post-reload state must be classified and compared. | Pine/FXR pending | live-shadow harness pending | Yes |
| IND-EDGE-001 | No edge claim from synthetic/fuzz P&L. | research plan | policy | Yes |
| IND-EDGE-002 | 69-tick stop-first vs target-first path ordering must use real lower-timeframe data. | research harness pending | real-data study pending | Yes |
| IND-EDGE-003 | Final holdout cannot be used for threshold selection. | research plan | preregistration manifest pending | Yes |
| IND-OPS-001 | `NO_SIGNAL` is a first-class state for unresolved or unsafe context. | runtime/selector layers | runtime/selector tests | Yes |
| IND-OPS-002 | Every rejection/arming/entry state has reason codes. | reference layers | tests + ledger schema pending | Yes |
| IND-REL-001 | Snapshot schema version mismatch fails closed. | `momentum_engine.py` | hardening tests | Yes |
| IND-REL-002 | Every production bug becomes a permanent regression fixture. | master plan | process requirement | Yes |
| IND-SEC-001 | CI uses least privileges and no indicator secrets. | workflow | workflow review | Yes |

## Traceability rules

- No requirement may be marked PASS using a test that does not execute its production implementation path.
- A screenshot is supporting evidence, not a passing test, unless paired with exact market data and expected machine outputs.
- One test can cover multiple requirements, but each P0/P1 requirement must have at least one direct assertion.
- Mutation tests must reference the requirement ID they are intended to defend.
- Every platform-specific implementation must map back to these same requirement IDs.
