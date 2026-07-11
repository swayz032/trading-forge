# Ratify-Packet Ledger — /goal deep-scan 2026-07-11 (instrument findings)

**STATUS: STAGED, NOT STARTED. Zero code written. Packet landing is NOT authorization.**

Base: hardening/phase-0 @ f8d5855d. 19 instrument-touching findings from the 16-charter
adversarial scan (each independently CONFIRMED by accuracy-validator). These touch measurement /
gate / sizing / fill / P&L / classifier / MC-WF-statistics surfaces, so per the standing launch
protocol each requires EXPLICIT per-item operator ratification before any edit. The /goal directive
("bring everything to a 9") authorizes facts + non-instrument fixes; it does NOT ratify these.

Full 5-part packet authorship per item is itself a carry-forward — below is the staged evidence
bundle (what/why+repro, blast radius, scope-locked change, verification plan, rollback) per finding.

| # | ID | Sev | File:line | One-line |
|---|----|-----|-----------|----------|
| 1 | CAP-1 | CRIT | src/server/production/kill-switch.ts:693 | Kill-switch Layer 3 trailing-DD breach only HALTS new entries — it never force-closes the  |
| 2 | F1 | CRIT | src/server/services/paper-execution-service.ts:4406 | Adaptive runner trail engages from bar 1 (no TP2 gate) and its null-ratchet is not floored |
| 3 | FG-1 | HIGH | src/server/services/regime-drift-detector-service.ts:429 | Regime-drift detector reads 5 most-recent bias_state ROWS, not 5 distinct trading days — v |
| 4 | FG-3 | HIGH | src/server/services/paper-signal-service.ts:4153 | Anti-setup gate feeds JS getDay() (Sun=0) into day_of_week rules mined with Python weekday |
| 5 | SDL-1 | HIGH | src/server/services/paper-execution-service.ts:4256 | Non-finite bar price silently poisons unrealized P&L, corrupts currentEquity to NaN, and f |
| 6 | BC-1 | HIGH | src/engine/backtester.py:4473 | DSL backtest path (run_backtest) never threads `spec` into apply_eligibility_gate — MCL/MN |
| 7 | VI-1 | HIGH | src/engine/walk_forward.py:636 | CPCV pools overlapping OOS folds into one series, inflating DSR n_observations ~5x → false |
| 8 | PINE-1 | HIGH | src/engine/exportability.py:305 | exit_type='trailing_stop' silently degrades to a static ATR stop in BOTH Pine artifacts (n |
| 9 | CMP-1 | HIGH | src/engine/monte_carlo.py:1045 | Topstep EOD trailing-DD 'lock at starting balance' is never modeled — floor trails HWM for |
| 10 | WIRE-1 | HIGH | src/server/routes/live-order.ts:660 | archetype_signal live-order path is dead: runPythonModule injects unrecognized --config fl |
| 11 | CAP-2 | MED | src/engine/sizing.py:498 | Python sizing.py pyramid-floor early-return (risk_cap<=0, healthy account) ignores drawdow |
| 12 | CAP-3 | MED | src/server/services/consistency-tracker-service.ts:202 | Consistency-tracker computes the prop-firm 50% single-day rule across BOTH firms and ALL a |
| 13 | FG-2 | MED | src/server/services/regime-drift-detector-service.ts:402 | Regime-drift detector treats regime_trained_on='UNKNOWN' as a real regime, guaranteeing fa |
| 14 | SDL-2 | MED | src/server/services/fill-reconciliation-service.ts:201 | Broker fill payload coerced with Number() yields NaN on malformed price, producing a silen |
| 15 | VI-2 | MED | src/engine/walk_forward.py:598 | CPCV reports total_trades and total_return summed across overlapping paths (~5x inflated)  |
| 16 | VI-3 | MED | src/engine/walk_forward.py:721 | CPCV PBO overfit hard-gate silently fails OPEN when a single per-path IS backtest raises a |
| 17 | F2 | MED | src/server/services/paper-execution-service.ts:4433 | Anchored-VWAP runner trail uses close price in paper but typical price (H+L+C)/3 in backte |
| 18 | CMP-2 | MED | src/engine/governor/state_machine.py:122 | Governor escalates only one state per trade, so a single catastrophic loss that breaches t |
| 19 | WIRE-2 | MED | src/server/routes/fill-callback.ts:91 | fill-callback HMAC signs only source|timestamp|fill_id|symbol — the P&L-determining filled |

---

## CAP-1 — CRIT (instrument)

**File:** `src/server/production/kill-switch.ts:693` — subsystem: capital-safety-sizing

**1. What & why (defect + receipt):** Kill-switch Layer 3 trailing-DD breach only HALTS new entries — it never force-closes the open position it claims to (documented "force_close" is absent)

> Failure scenario: Multi-day Topstep session: realizedPeakEquity=$52,000 from prior-day profit; today's realized P&L is small so Layer 2 (DLL, today-scoped, personal DLL $2,000, force-close at 95%=$1,900) never fires. An open MES position bleeds; updatePositionPrices (paper-execution-service.ts:4677) subtracts unrealized MTM from currentEquity in real time. When currentEquity falls to ~$50,200, drawdown = peakEquity - currentEquity = $1,800 >= maxDrawdown($2,000) - TRAILING_DD_BUFFER_DOLLARS($200). checkLayer3TrailingDD returns {halted:true, reason:'trailing_dd_force_close_at_95pct'} — but it NEVER calls _safeForceClose/forceCloseAllPositions (only Layer 2's force_close action and setMode('HALT') do). isHaltedForProduction returns true, blocking NEW entries only. The already-open position keeps bleeding through $50,000 → firm trailing max drawdown breached → account closed. Nothing flattens it on the trailing-DD axis.

> Evidence: checkLayer3TrailingDD (lines 646-724) computes drawdown = peakEquity - currentEquity (691) and on breach returns halted:true with reason 'trailing_dd_force_close_at_95pct' (694-705) with NO _safeForceClose call — contrast Layer 2 checkLayer2DailyLoss which calls await _safeForceClose(...) at 538. The module docstring and the Layer 2 inline comment ('Layer 3 force-closes on trailing-DD $200 buffer', 486-487) both assert Layer 3 force-closes, but the implementation does not. Grep confirms the ONLY peakEquity-currentEquity trailing-DD force-close trigger is this Layer 3 return (no other flatten path). live-fix-sweep.test.ts only asserts the reason STRING exists in source; no test asserts a close actually occurs.

**Independent verify (accuracy-validator):** Read checkLayer3TrailingDD (kill-switch.ts:646-724) in full. On breach it only builds `decision = {halted:true, layer:3, reason:'trailing_dd_force_close_at_95pct', detail:{...}}` and returns — no call to _safeForceClose/forceCloseAllPositions anywhere in the function or its callers. Traced every caller: evaluateAllKillSwitchLayers() (line 1128) just returns l3 to isHaltedForProduction(), a boolean gate consumed by signal-path callers to block NEW entries only — it never triggers a flatten. getKillSwitchStatus() (line 1439) calls checkLayer3TrailingDD() purely for dashboard reporting, again no close action. A repo-wide grep for 'trailing_dd_force_close_at_95pct' shows only 3 hits: the produce

**2. Blast radius:** touches capital-safety-sizing; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** In checkLayer3TrailingDD, on the breach branch call the same scoped force-close Layer 2 uses (await _safeForceClose(`trailing_dd_force_close:${accountKey}`, correlationId, { accountKey })) and emit the pending→completed/failed audit pattern — do not merely return halted:true. Thread scopeAccountKey through so the flatten is account-scoped like Layer 2.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## F1 — CRIT (instrument)

**File:** `src/server/services/paper-execution-service.ts:4406` — subsystem: exits-entries-antisetup

**1. What & why (defect + receipt):** Adaptive runner trail engages from bar 1 (no TP2 gate) and its null-ratchet is not floored at the structural stop — paper stop diverges from backtest, forcing premature break-even exits and (chandelier) widening risk beyond sized amount

> Failure scenario: An adaptive-exit strategy in a TRENDING regime (default runner_trail_method="anchored_vwap") opens a long at 5000, ATR=4, structural initial stop = 4994 (initialStopPrice). On the FIRST processSessionBar pass the Gap-C block (line 4406) runs with NO tp1_filled/tp2_filled guard: avwap = sum_pv/sum_v = currentPrice ≈ 5000 (only the entry bar accumulated), so computedTrail = avwap - tick ≈ 4999.75. trailHwm is null, so the ratchet at line 4520 (`currentTrailHwm == null || ...`) short-circuits to isTighter=true and writes trailHwm=4999.75 unconditionally. From the next bar the BL-1 stop-breach block (line 4335: `stopLevel = pos.trailHwm ?? pos.initialStopPrice`) uses 4999.75 instead of 4994, so any ~1-tick pullback below entry closes the FULL position at ~break-even long before TP1(1R)/TP2(2R) can fill. Meanwhile the Python backtester (_apply_adaptive_management, backtester.py:2088) only advances the runner trail `if tp2_filled:` and initializes `trail_stop = stop_p` (line 1988) ratcheting with `max(trail_stop, new_trail)` — it holds the structural stop until TP2. Result: every trending adaptive strategy shows near-zero/negative PAPER P&L that has no relation to its backtest, and PAPER is the canonical promotion journal (CLAUDE.md §8). For chandelier (HIGH_VOL_MACRO) the same null-branch can instead write trailHwm=highSince-2×ATR LOOSER than initialStopPrice, so the effective stop widens beyond the structural stop the position was sized against (over-risk beyond the 2%/drawdown-room bound).

> Evidence: paper-execution-service.ts Gap-C block (4406-4515) has no tp1/tp2 fill guard; ratchet line 4520 `const isTighter = currentTrailHwm == null || (...)` lets the first write bypass any comparison to initialStopPrice; stop-breach precedence line 4335-4338 uses `trailHwm ?? initialStopPrice` (trailHwm wins even when looser). Backtester parity oracle: _apply_adaptive_management gates runner trail on `if tp2_filled:` (backtester.py:2088), floors at `trail_stop = stop_p` (1988) and BE only after TP1 (2046); _apply_static_styleC_management gates the Chandelier runner on `if tp2_filled_p:` (backtester.py:1567) with `trail_stop_p = max(trail_stop_p, new_trail)` (1575). The two engines therefore disagree on the runner-trail activation condition and the stop floor.

**Independent verify (accuracy-validator):** Read paper-execution-service.ts lines 4300-4540 directly. Confirmed every load-bearing claim:
(1) Position-open code (line 2264) inserts `initialStopPrice` but never initializes `trailHwm` — it starts NULL.
(2) The BL-1 stop-breach block (line 4335-4338) resolves `stopLevel = pos.trailHwm ?? pos.initialStopPrice`, i.e. once trailHwm is non-null it unconditionally wins over the structural stop, with no tp1Filled/tp2Filled check anywhere in that block.
(3) Gap-C (line 4406-4515) runs whenever `exitBarContext && pos.exitPlan != null` — no tp1_filled/tp2_filled guard exists in the switch or its wrapper, contradicting the Python engine's `if tp2_filled:` gate.
(4) The ratchet at line 4517-4524: `

**2. Blast radius:** touches exits-entries-antisetup; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Gate the Gap-C adaptive trail block on tp1_filled && tp2_filled (mirror backtester `if tp2_filled`), and floor the ratchet against the structural stop: initialize/clamp so `isTighter` also requires computedTrail to be tighter than initialStopPrice (never write a trailHwm looser than initialStopPrice, and treat null trailHwm as initialStopPrice for the comparison rather than an unconditional accept).

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## FG-1 — HIGH (instrument)

**File:** `src/server/services/regime-drift-detector-service.ts:429` — subsystem: gate-false-greens

**1. What & why (defect + receipt):** Regime-drift detector reads 5 most-recent bias_state ROWS, not 5 distinct trading days — violates its own '5 consecutive days' contract and includes superseded rows

> Failure scenario: bias_state gets >=2 rows per (session_date, symbol) every normal day: a 9:30 session-start INSERT plus a 10:00 ET refresh INSERT (bias-state-service.ts:1064 explicitly notes 'Readers pick MAX(computed_at) per (session_date, symbol)'), plus W23H.E position-lock rows. The detector query selects regimeLabel ORDER BY sessionDate DESC LIMIT 5 with NO dedup to distinct session_dates and NO MAX(computed_at) filter. On a normal week the 5-row window spans only ~2-3 calendar days and mixes superseded 9:30 rows with authoritative 10:00 rows. Scenario A (false-positive demotion): a MES strategy whose 10:00 refresh regime differs from its trained regime on Tue+Wed yields >=4 differing rows across just 2 days; recentRegimes.every(differ) at line 456 is satisfied on <5 real days, so the DEPLOYED (live) strategy is auto-demoted DEPLOYED->DECLINING->TESTING (halts live trading) on 2 days of intraday regime noise instead of the required 5 consecutive days (docstring line 11). Scenario B (false-green): a stale 9:30 row equal to the trained regime sits inside the window and makes every() false, masking a genuine 5-day drift so a truly drifted strategy is never demoted.

> Evidence: Query at lines 429-434 (.select regimeLabel/sessionDate .where symbol .orderBy desc(sessionDate) .limit(DRIFT_CONSECUTIVE_DAYS)); drift test recentRegimes.every(r=>r!==regimeTrainedOn) at line 456; docstring line 11 'Must be ALL 5 consecutive days (not 5-of-7-day average)'. bias-state-service.ts:1064 confirms multiple INSERTs per (session_date,symbol) and the canonical MAX(computed_at) read pattern the detector ignores; schema.ts:2331-2334 documents the same.

**Independent verify (accuracy-validator):** Verified by direct code read. The query at regime-drift-detector-service.ts:429-434 selects regimeLabel/sessionDate WHERE symbol=X ORDER BY sessionDate DESC LIMIT 5 with no GROUP BY / no MAX(computed_at) filter. schema.ts:2331-2334 explicitly documents that bias_state has no unique constraint on (session_date,symbol) and that "readers use MAX(computed_at) per (session_date, symbol)" — confirming multiple rows per day are the documented norm (session-start row + 10:00 ET refresh row, per bias-state-service.ts:1064's own comment, plus W23H.E position-lock rows). The canonical reader elsewhere in the same codebase (bias-state-service.ts:378-393, getOrComputeBiasStateForDay) correctly filters WH

**2. Blast radius:** touches gate-false-greens; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Collapse to one authoritative regime per session_date before windowing: SELECT DISTINCT ON (session_date) regime_label ... ORDER BY session_date DESC, computed_at DESC, then take 5 distinct session_dates. Optionally assert the 5 dates are actually consecutive CME trading days before demoting.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## FG-3 — HIGH (instrument)

**File:** `src/server/services/paper-signal-service.ts:4153` — subsystem: gate-false-greens

**1. What & why (defect + receipt):** Anti-setup gate feeds JS getDay() (Sun=0) into day_of_week rules mined with Python weekday() (Mon=0) — every day-of-week anti-setup blocks the wrong weekday

> Failure scenario: The weekly anti-setup miner derives day_of_week filters from Python datetime.weekday() (Mon=0..Sun=6; miner.py:142,153 and day_names {4:'Friday'} at miner.py:306) and stores filter={"day": <0=Mon..>}. At runtime the anti-setup gate builds its context with day_of_week: new Date(bar.timestamp).getDay() (JS: Sun=0..Sat=6) and compares for equality (anti-setup-gate-service.ts:108 `dow === filt.day`). A Friday anti-setup is stored as day=4, but getDay()==4 is THURSDAY; the real Friday is getDay()==5, which matches no mined rule (Python day=5 is Saturday, never traded during RTH). Net effect: every day_of_week anti-setup blocks the day BEFORE the mined bad day and never blocks the actual bad day — the gate silently blocks good-day A+ trades and lets the real bad-day losers through, and the weekly effectiveness analysis grades the wrong weekday. The bug is confined to the anti-setup wiring: the adjacent skip-engine context builder at paper-signal-service.ts:286 DOES convert getUTCDay()->Monday-first, proving the convention gap was known and just missed here.

> Evidence: paper-signal-service.ts:4153 `day_of_week: new Date(bar.timestamp).getDay()` (no convention conversion); comparison at anti-setup-gate-service.ts:105-109; miner convention at miner.py:141-158 (`return dt.weekday()`) and miner.py:306 day_names {0:Monday..4:Friday}; correct conversion on the sibling skip path at paper-signal-service.ts:286 (`getUTCDay()===0?6:getUTCDay()-1`).

**Independent verify (accuracy-validator):** Independently re-read every cited site. (1) paper-signal-service.ts:4153 builds the anti-setup gate context with `day_of_week: new Date(bar.timestamp).getDay()` — JS convention Sun=0..Sat=6 — with zero conversion. (2) anti-setup-gate-service.ts:105-109 does a bare `dow === (filt.day as number)` equality check, no remapping. (3) miner.py:141-158 `_get_day_of_week()` returns `dt.weekday()` (Python: Mon=0..Sun=6), and `_mine_day_of_week()` at line 306/321 stores `filter={"day": day, ...}` using that Python convention, with `day_names={0:"Monday",...,4:"Friday",...}` confirming the mapping. (4) The sibling skip-engine context builder at paper-signal-service.ts:286 explicitly converts `getUTCDay(

**2. Blast radius:** touches gate-false-greens; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Convert to Python-weekday convention before calling checkAntiSetupGate, e.g. day_of_week: (new Date(bar.timestamp).getUTCDay()+6)%7, matching the miner and the Python filter_gate; add a unit test asserting Friday maps to 4 on both sides.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## SDL-1 — HIGH (instrument)

**File:** `src/server/services/paper-execution-service.ts:4256` — subsystem: services-contracts-nulls

**1. What & why (defect + receipt):** Non-finite bar price silently poisons unrealized P&L, corrupts currentEquity to NaN, and fails the cross-symbol DLL + drawdown capital-safety gates OPEN

> Failure scenario: A single open position receives a bar whose close is not a finite number — reachable via POST /api/paper/prices (routes/paper.ts:552-565 passes req.body.prices straight into updatePositionPrices with NO numeric validation; e.g. prices:{"MES":"x"} or {"MES":{"close":"x"}}), or any WS/backfill bar with a bad close. normalizePriceUpdate (line 633) does no finite check, so currentPrice = NaN → unrealizedPnl = direction*(NaN-entry)*pv*qty = NaN. It is persisted as String(NaN) → the Postgres numeric column accepts 'NaN' (line 4309). totalUnrealizedDelta becomes NaN; the guard at line 4675 is `!== 0` (NaN !== 0 is TRUE) so line 4677 runs `currentEquity::numeric + NaN` = NaN, permanently corrupting currentEquity for that session. Downstream: (a) cross-symbol-pnl.ts:245 parseFloat('NaN')=NaN → totalPnL=NaN → evaluateCrossSymbolDll drawdown = (NaN<0 ? .. : 0) = 0 → the 67% HALT and 95% FORCE-CLOSE bands NEVER fire for the WHOLE account, even if sibling symbols hold a real large loss; (b) paper-risk-gate.ts:230 Number(NaN currentEquity) → sessionLoss = peak-NaN = NaN → `NaN >= drawdownLimit` is false → session-drawdown gate passes. Two independent capital-safety gates fail OPEN from one bad price tick.

> Evidence: paper-execution-service.ts:4256 (unrealizedPnl compute, no guard), :4309 (String(unrealizedPnl) stored), :4675-4678 (NaN!==0 passes guard, currentEquity+NaN); normalizePriceUpdate :633-645 (no Number.isFinite on close — contrast buildExitBarContext in paper-trading-stream.ts:225 which DOES guard ATR with Number.isFinite); cross-symbol-pnl.ts:245,353 (parseFloat then NaN<0 short-circuits drawdown to 0); paper-risk-gate.ts:230,235,237; routes/paper.ts:552-565 (prices unvalidated).

**Independent verify (accuracy-validator):** Verified against live code on disk, not just the finder's citations.

1. paper-execution-service.ts:4256 unrealizedPnl = direction*(currentPrice-entryPrice)*pointValue*contracts has no Number.isFinite guard on currentPrice — confirmed at lines 4244-4256.
2. normalizePriceUpdate (lines 633-645) passes `close` straight through with no finite check, in contrast to paper-trading-stream.ts:225 which DOES guard ATR via `Number.isFinite(atr) ? atr : 0` — confirming the asymmetric-guard pattern the finder cited.
3. routes/paper.ts:552-565 POST /api/paper/prices destructures `req.body.prices` with zero schema validation (no Zod, unlike the sibling /start route which does use `paperStartSchema`) and p

**2. Blast radius:** touches services-contracts-nulls; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Guard at the source: in normalizePriceUpdate / at the top of the updatePositionPrices per-position loop, reject or skip any position whose currentPrice (and entryPrice) is not Number.isFinite, logging a warn + audit rather than computing P&L. Additionally clamp totalUnrealizedDelta with Number.isFinite before the currentEquity SQL add, and have evaluateCrossSymbolDll / paper-risk-gate treat a non-finite equity/PnL as fail-CLOSED (block) not fail-open. Validate prices numerically in the POST /api/paper/prices route.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## BC-1 — HIGH (instrument)

**File:** `src/engine/backtester.py:4473` — subsystem: backtest-correctness

**1. What & why (defect + receipt):** DSL backtest path (run_backtest) never threads `spec` into apply_eligibility_gate — MCL/MNQ admission gate silently uses MES point_value/tick_size

> Failure scenario: Run any DSL-compiled strategy (the scout/graduator's default output path, use_eligibility_gate=True by default and explicitly re-asserted at backtester.py:8333) on symbol=MCL. `apply_eligibility_gate()` (defined at backtester.py:246-254, default `spec=None`) is called at backtester.py:4473 (long) and 4491 (short) WITHOUT a `spec=` kwarg, so inside the function `point_value = spec.point_value if spec else 5.0` and `tick_size = spec.tick_size if spec else 0.25` (backtester.py:364-365) always fall through to the MES defaults (5.0 / 0.25) — even though `spec = CONTRACT_SPECS[config.symbol]` is already correctly resolved in scope at backtester.py:3664, just never passed through. For MCL the correct values are point_value=100.00, tick_size=0.01 (src/engine/config.py:85-86). This wrong tick_size feeds `compute_structural_stop(..., point_value=point_value, tick_size=tick_size, symbol=symbol, ...)` (backtester.py:437-445) -> `structural_stops.py::_compute_buffer()` -> `get_sweep_buffer_points(symbol, tick_size)` (structural_stops.py:152-157), which computes `buffer = sweep_ticks(symbol) * tick_size`. For MCL sweep_ticks=2 (correct), but tick_size=0.25 (wrong) instead of 0.01 (correct) — buffer becomes 0.50pt instead of the documented 0.02pt (structural_stops.py:12), a 25x inflation. That inflated buffer is added directly onto the structural stop_price for any sweep_wick/order_block/FVG/swing-point-based stop, so `distance = abs(entry_price - stop_price)` (structural_stops.py:277) is inflated by ~0.48pt against MCL's 1.00pt ceiling (structural_stops.py:117, `_get_effective_ceiling`) — consuming nearly half the entire ceiling budget on a buffer-computation bug alone. A signal whose true structural distance is e.g. 0.60pt (well inside ceiling) computes as 1.08pt, crosses the ceiling, and is silently SKIPped (structural_stops.py:279-281, `skip_trade=True` -> eligibility_gate.py:139-140 rejects with `SKIP_TRADE:` reason) even though it should have been TAKEn. This systematically and silently under-trades MCL through the DSL path (fewer/zero MCL trades reach the P&L engine than a correct run would produce), corrupting MCL backtest results with no exception, warning, or visible flag — the run just looks like a strategy with fewer/no valid MCL setups. The class path (`run_class_backtest`, backtester.py:6899/6904) correctly passes `spec=spec`, so this is a DSL-path-only regression versus its sibling — the same 'one path fixed, one path missed' pattern already documented elsewhere in this codebase's memory (fill_model class-path wiring gap).

> Evidence: backtester.py:254 `spec=None` default param; backtester.py:364-365 `point_value = spec.point_value if spec else 5.0` / `tick_size = spec.tick_size if spec else 0.25`; backtester.py:3664 `spec = CONTRACT_SPECS[config.symbol]` (in-scope, correctly resolved, but never passed); backtester.py:4473-4480 and 4491-4498 call `apply_eligibility_gate(...)` with no `spec=` kwarg; backtester.py:6899 and 6904 (class path) DO pass `spec=spec`; src/engine/config.py:85-86 MCL point_value=100.00/tick_size=0.01 vs MES 5.00/0.25; src/engine/context/structural_stops.py:152-157 `get_sweep_buffer_points` = ticks*tick_size, :277-281 ceiling-vs-distance skip_trade logic; no test in src/engine/tests passes `spec=` to `apply_eligibility_gate` (grep confirmed zero matches), so this gap is untested.

**Independent verify (accuracy-validator):** Independently re-read the code. apply_eligibility_gate (backtester.py:246-256) defaults spec=None, and at 364-365 falls through to point_value=5.0/tick_size=0.25 (MES values) whenever spec is not passed. The DSL path (run_backtest, same function scope) resolves spec = CONTRACT_SPECS[config.symbol] at line 3664, but the two call sites at 4473 and 4491 (long/short) omit spec= entirely — confirmed by direct read of the call arguments (direction, symbol, firm_key, htf_cache, strategy_name, passthrough_reason — no spec kwarg). The sibling class path (run_class_backtest) at 6897 and 6902 DOES pass spec=spec, confirming this is a path-specific omission, not universal/intentional design. Verified co

**2. Blast radius:** touches backtest-correctness; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Add `spec=spec` to both `apply_eligibility_gate(...)` call sites in run_backtest() (backtester.py:4473 and 4491), mirroring the class path's existing `spec=spec` (backtester.py:6899/6904). This is instrument-touching (changes admission-gate SKIP/TAKE outcomes and structural stop distances for MCL, and MNQ's risk_dollars reporting) and needs a ratify packet before landing per CLAUDE.md's instrument-touching change protocol — flag, do not silently fix.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## VI-1 — HIGH (instrument)

**File:** `src/engine/walk_forward.py:636` — subsystem: walkforward-mc-validation

**1. What & why (defect + receipt):** CPCV pools overlapping OOS folds into one series, inflating DSR n_observations ~5x → false-green overfit pass

> Failure scenario: With the default CPCV config (n_splits=6, k_test_groups=2 → C(6,2)=15 paths), each of the 6 data folds is used as an OOS test fold in C(5,1)=5 different paths. The loop at lines 533-534 does all_oos_pnls.extend(_path_daily_pnls) for every path, so each calendar day's OOS P&L is appended ~5 times. At line 636 `_n_obs = len(all_oos_pnls)` is therefore ~5x the true number of independent OOS observations, and it is passed as n_observations to compute_deflated_sharpe_ratio (line 640). In risk_metrics.py the Sharpe standard error is sharpe_std = sqrt(numer/(n_observations-1)) (risk_metrics.py:560-563) and the test statistic reduces to dsr = observed_sharpe/sharpe_std - sr_expected_max, i.e. dsr ∝ sqrt(n_observations-1). A 5x inflation of n_observations inflates the DSR statistic by ~sqrt(5)≈2.24x and collapses its p-value. Concrete: a strategy whose true independent OOS sample yields DSR≈1.0 / p≈0.16 (fails p<0.05) is reported at DSR≈2.24 / p≈0.01 and PASSES. agg_sharpe itself is unaffected (mean/std are ~invariant to exact duplication), so only the multiple-testing/short-track deflation is corrupted — the exact protection DSR exists to provide. The inflated DSR flows to wf_metadata.dsr_pass (gate) and per CLAUDE.md to picker-metrics (25% of live selection score) and deploy-approvals.

> Evidence: Line 636 `_n_obs = len(all_oos_pnls)`; line 640 `n_observations=max(_n_obs, 2)`. all_oos_pnls is built by extend() per path at lines 533-534 across the C(6,2)=15-path combinations loop (line 407), where each fold recurs in 5 paths. Contrast the plain-WF path (line 2321) whose OOS chunks come from split_walk_forward_windows() (disjoint, non-overlapping) so its n_observations is correct — the defect is CPCV-specific pooling of reused folds. risk_metrics.py:560-563 confirms sharpe_std ∝ 1/sqrt(n_observations).

**Independent verify (accuracy-validator):** Read walk_forward.py:380-660 directly. Confirmed: (1) the CPCV path loop at line 407 iterates C(n_splits, k_test_groups) combos; for default n_splits=6, k_test_groups=2, each of the 6 folds appears as an OOS test fold in exactly C(5,1)=5 of the 15 paths. (2) line 534 `all_oos_pnls.extend(_path_daily_pnls)` unconditionally pools every path's OOS daily P&L with no dedup — each fold's calendar days are appended ~5x. (3) line 636 `_n_obs = len(all_oos_pnls)` and line 640 feeds this as `n_observations` into compute_deflated_sharpe_ratio with the default `sharpe_std=0.0` (never explicitly passed), which forces risk_metrics.py:557-563 to compute `sharpe_std = sqrt((1-skew*sr+((kurt-1)/4)*sr^2)/(n_o

**2. Blast radius:** touches walkforward-mc-validation; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** For the CPCV DSR, pass the count of UNIQUE OOS observations (≈ total_bars, or per-path daily-P&L length averaged, not the pooled concatenation length). Equivalently compute DSR from the distribution of per-path OOS Sharpes with n_observations set to a single path's OOS length, or deduplicate by fold before measuring n. Do not feed len(all_oos_pnls) (which counts each fold k_test_groups*C(N-1,k-1) times) as an independent-observation count.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## PINE-1 — HIGH (instrument)

**File:** `src/engine/exportability.py:305` — subsystem: compiler-pine-parity

**1. What & why (defect + receipt):** exit_type='trailing_stop' silently degrades to a static ATR stop in BOTH Pine artifacts (never a real trailing stop), but the `faithful` flag stays True and the remediation message actively misdirects the operator

> Failure scenario: Operator has an internal strategy with exit_type='trailing_stop' (internal backtester genuinely trails the stop as price advances — confirmed via distinct 'trailing_stop' vs 'stop_loss' exit_reason branches in src/engine/backtester.py:1525,1536,1749,1759,2027,2034). score_exportability() only applies a -20 score deduction for this exit_type (exportability.py:301-314); it is NOT one of the section-6 semantic-fidelity checks (lines 342-459) that set faithful=False. Result: score≈80 (band='reducible'), exportable=True, faithful=True. checkExportability() in pine-export-service.ts then computes gateOk = exportable && faithful = True, so this strategy passes the TESTING→PAPER promotion gate that CLAUDE.md section 7 says the faithful flag 'HARD-blocks any Pine that would misrepresent the strategy.' The deduction message itself (exportability.py:311-313) tells the operator 'INDICATOR artifact degrades to fixed ATR stop... Use STRATEGY artifact for trailing stop export' — implying the STRATEGY artifact solves it. It does not: pine_compiler.py's _build_exit_condition() (line 525-538) ALWAYS returns a static atr_val*stop_loss_atr_multiple distance regardless of exit_type, and both the legacy strategy_shell (compile_strategy(), lines 1508-1519 — documented at lines 1479-1489 as the DEFAULT live path used by monte-carlo-service.ts, quantum-mc-service.ts, scheduler.ts, strategies.ts, and pine-export.ts's default branch) and the dual STRATEGY artifact (compile_dual_artifacts(), lines 2274-2296) call strategy.exit(..., stop=close - stop_distance, ...) once at entry with NO trail_offset/trail_points parameter anywhere in the 2972-line file (verified via full-file grep — zero matches). An operator or family member (CLAUDE.md section 9) who deploys the STRATEGY artifact believing it faithfully reproduces the internal trailing-stop management will hold a FIXED stop through a trending move where the internal engine would have locked in profit by trailing — silently giving back gains or eating a stop-out the internal strategy would have avoided, with the exportability score's own faithful=True and remediation text actively vouching for correctness.

> Evidence: src/engine/exportability.py:301-329 (trailing_stop deduction, no faithful mutation) vs lines 342-459 (section-6 checks that DO set faithful=False — trailing_stop is absent from this list); src/engine/pine_compiler.py:525-538 (_build_exit_condition — always static ATR distance); :1508-1519 and :2274-2296 (both strategy.exit() call sites use fixed stop=/limit=, never trail_offset/trail_points — confirmed zero occurrences of 'trail_offset'/'trail_points' repo-wide in this file); src/engine/backtester.py:1525,1536,1749,1759,2027,2034 (internal engine's real trailing_stop vs stop_loss exit-reason branching, proving genuine internal divergence); no adversarial test (src/engine/tests/test_exportability_faithful_adversarial.py) covers exit_type='trailing_stop'.

**Independent verify (accuracy-validator):** Independently re-read exportability.py:301-329 (trailing_stop only deducts score -20, no _faithful mutation) vs the section-6 fidelity block at 342-459 (the ONLY place _faithful is set False - covers Style C partials/runner-trail/BE+1/adaptive, confluence weighted-scoring, and multi-TF gating, but NOT exit_type=='trailing_stop'). A -20 deduction typically leaves score in the 60-89 'reducible' band (>=50), so exportable=(score>=50 and faithful) evaluates True, and faithful stays True. Verified pine_compiler.py: _build_exit_condition() (525-538) always returns a static ATR distance with no branching on exit_type, and both cited call sites - strategy_shell in compile_strategy() (the file's own 

**2. Blast radius:** touches compiler-pine-parity; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Either (a) implement a genuine Pine trailing stop via strategy.exit(trail_points=, trail_offset=) in the STRATEGY artifact so the remediation message becomes true, or (b) if that is out of scope, add exit_type=='trailing_stop' to the section-6a semantic-fidelity check in score_exportability() so faithful is honestly set False (forcing score=0/exportable=False, consistent with how Style-C/confluence/multi-TF are handled) and correct the deduction message to state that NEITHER artifact implements real Pine trailing stops today.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## CMP-1 — HIGH (instrument)

**File:** `src/engine/monte_carlo.py:1045` — subsystem: compliance-governor-firm

**1. What & why (defect + receipt):** Topstep EOD trailing-DD 'lock at starting balance' is never modeled — floor trails HWM forever across B14 survival gate, prop_compliance and prop_sim

> Failure scenario: A Topstep $50K strategy runs its equity up to a high-water mark of $55K then pulls back to $50.5K. Real Topstep: the Maximum Loss Limit trails the EOD HWM by $2K but LOCKS at the starting balance ($50,000) once HWM reaches $52K, so at $50.5K the account SURVIVES. The code computes floor = max(peak_equity - max_dd, account_size - max_dd) = max($55K-$2K, $50K-$2K) = $53,000 and reports balance $50.5K <= $53K as a trailing_dd BREACH. simulate_firm_survival therefore sets breach_mask=1 for paths the real firm would never close, inflating probability_of_ruin_ci.ci_high — the exact value the B14 hard gate (lifecycle PAPER->DEPLOY_READY, blocks at ci_high>0.20) reads. Profitable/compounding strategies are systematically over-flagged as ruined and blocked from promotion.

> Evidence: peak_equity is initialized to account_size and only ever ratcheted upward (peak_equity = max(peak_equity, balance)), so peak_equity >= account_size is an invariant. Therefore peak_equity - max_dd >= account_size - max_dd is ALWAYS true and the max(...) clamp is a no-op — the branch reduces to floor = peak_equity - max_dd, identical to the locks_at_start=False branch (line 1047). The genuine Topstep lock (floor caps at account_size, i.e. floor = min(peak_equity - max_dd, account_size)) is never implemented. The identical inverted-clamp bug is duplicated verbatim at src/engine/prop_compliance.py:103-104 (max(floor, starting - max_dd)) and src/engine/prop_sim.py:208-212 (whose comment even mislabels it 'Floor locks at starting_balance - max_dd' — the lock is at starting_balance, not starting_balance - max_dd). test_audit_a12.py:939-944 gives false confidence: it only asserts the literal string '"locks_at_start": True' is present in the source, never that the clamp behaves as a lock.

**Independent verify (accuracy-validator):** Independently re-derived the math from the code on disk (not from the claim's evidence text). In monte_carlo.py: peak_equity is initialized to account_size (line 997) and updated only via peak_equity = max(peak_equity, balance) (lines 1057, 1060) — a monotonic ratchet, so peak_equity >= account_size is an invariant for the life of the simulation. At line 1045 (and again at 1064), floor = max(peak_equity - max_dd, account_size - max_dd) therefore always reduces to peak_equity - max_dd, identical to the locks_at_start=False branch one line below. The genuine Topstep "floor caps at account_size" rule (floor = min(peak_equity - max_dd, account_size)) is never implemented in either branch. This i

**2. Blast radius:** touches compliance-governor-firm; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Model the real Topstep MLL: floor = min(peak_equity - max_dd, account_size) (cap the trailing floor at the starting balance once it reaches it), applied in all three sites (monte_carlo.py:1044-1047 and 1063-1066, prop_compliance.py:103-104 & 135-136, prop_sim.py:208-212). Fix the prop_sim comment. Replace the string-presence assertion in test_audit_a12 with a behavioral test (HWM=start+2*max_dd, pullback to start+small -> expect NO breach).

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## WIRE-1 — HIGH (instrument)

**File:** `src/server/routes/live-order.ts:660` — subsystem: wiring-contract-drift

**1. What & why (defect + receipt):** archetype_signal live-order path is dead: runPythonModule injects unrecognized --config flag + never sends the required stdin JSON, so every archetype signal 503s

> Failure scenario: A Pine/TF-Gateway alert POSTs /api/live-order with action:"archetype_signal" (e.g. {archetype:"silver_bullet", ticker:"MES1!", strategy_id, bar_timestamp}). live-order.ts calls runPythonModule({module:"src.engine.archetype_evaluator", args:[--archetype,...], correlationId}). Because a correlationId is always present (live-order.ts:332 correlationId = correlation_id ?? randomUUID()), python-runner.ts (lines 329-341, `if (config || correlationId)`) unconditionally appends `--config <tmpfile>` to the subprocess argv. But archetype_evaluator.py::main() calls `parser.parse_args()` (line 392) and defines NO `--config` argument → argparse raises SystemExit(2) with 'unrecognized arguments: --config ...' BEFORE any evaluation. runPythonModule sees exit code != 0 and rejects; live-order.ts catches and returns 503 archetype_evaluator_failed + emits archetype:evaluator_failed. Even if --config were tolerated, the module's documented contract (archetype_evaluator.py lines 10-35, 396 `raw = sys.stdin.read()`; empty stdin → _emit_error+exit 1) REQUIRES a stdin JSON payload carrying bar OHLCV, position.side, and bias_state — none of which live-order.ts ever pipes (runPythonModule never writes proc.stdin). Net: the entire archetype-signal execution path can NEVER resolve a direction or route an order; 100% of archetype_signal requests fail closed with 503.

> Evidence: python-runner.ts:340 always pushes `--config` when correlationId set; the spawn() (line 388) uses default stdio and never writes/ends proc.stdin. archetype_evaluator.py:382-392 declares only --archetype/--strategy-id/--bar-timestamp/--symbol/--account-id/--correlation-id/--current-position/--current-position-size and calls parse_args() (errors on --config); line 396 reads stdin and line 401-403 hard-exits on empty stdin. live-order.ts:660-673 passes args-only + correlationId, no config with bar/position/bias and no stdin. The integration test live-order-archetype-signal.test.ts:211 mocks runPythonModule (asserts callArg.module only), so the real --config injection + stdin contract are never exercised — a false green.

**Independent verify (accuracy-validator):** Independently traced the full path. (1) live-order.ts:332 unconditionally sets `correlationId = correlation_id ?? randomUUID()` — always truthy. (2) live-order.ts:660-673 calls runPythonModule with module "src.engine.archetype_evaluator", args-only (--archetype/--strategy-id/--bar-timestamp/--symbol/--account-id/--correlation-id), NO `config` field, but correlationId IS passed. (3) python-runner.ts:329 gate is `if (config || correlationId)` — correlationId alone trips it, so a --config <tmpfile> flag is ALWAYS appended (line 340), for every archetype_signal call, regardless of whether config was ever intended to be used here. (4) archetype_evaluator.py:376-392 declares only 8 named flags (--

**2. Blast radius:** touches wiring-contract-drift; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Make live-order.ts build the full stdin payload {archetype, strategy_id, bar:{timestamp,symbol,close,high,low,open,volume}, position:{side,size}, bias_state:{...}} and deliver it to the evaluator. Either (a) add a runPythonModule option that writes JSON to proc.stdin (and closes it), and have live-order pass the real bar/position/bias — currently it passes none, so even a fixed transport would evaluate a synthetic default 5000-price flat-position bar (garbage direction); or (b) add `parser.add_argument('--config')` (parse_known_args) to archetype_evaluator.py AND route the payload through config instead of stdin. Also stop mocking runPythonModule in the integration test so the argv/stdin contract is covered.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## CAP-2 — MED (instrument)

**File:** `src/engine/sizing.py:498` — subsystem: capital-safety-sizing

**1. What & why (defect + receipt):** Python sizing.py pyramid-floor early-return (risk_cap<=0, healthy account) ignores drawdown_room_cap that the TS live path enforces — TS↔Python sizing parity break / over-size

> Failure scenario: Topstep account healthy (balance $50,000 >= 85% of $50,000 floor) but with a thin drawdown buffer because HWM trailed the floor up close to balance (e.g. HWM=$51,900 → trailing_floor=min(49,900,50,000)=49,900, buffer=$100). With extreme ATR, risk_derived_cap = floor(100*0.02/30) = 0. The account_is_healthy branch (line 499) returns floored_contracts = base_contracts (9 MES), clamped ONLY by firm cap and liquidity cap — it never applies drawdown_room_cap (computed at line 474 but unused on this path). 9 contracts x $30 stop = $270 potential loss on a $100 drawdown buffer → trailing-DD breach. The TS live twin risk-sizing.ts:794-802 (F-4 fix) explicitly adds drawdownRoomCap to this same early-return floor min(); the Python 'exact port' was never patched, so paper (TS) and backtest (Python) diverge on the very safety cap that prevents this.

> Evidence: sizing.py lines 498-560: `if risk_derived_cap <= 0:` → `if account_is_healthy and base_contracts > 0:` builds floored_contracts from base_contracts, effective_firm_cap, liquidity_cap only — drawdown_room_cap (computed 469-482) is absent. risk-sizing.ts:799-802 flooredCandidates includes drawdownRoomCap with comment 'F-4 Fix: include drawdownRoomCap in the early-return floor min()... this early-return path previously omitted it'. Impact is dormant in current backtests because compute_position_sizes (sizing.py:1115-1134) never passes current_drawdown_room, but the divergence is a real parity break the moment any Python caller supplies it (documented byte-identical-port contract).

**Independent verify (accuracy-validator):** Verified directly against src/engine/sizing.py lines 461-560 and src/server/lib/risk-sizing.ts lines 772-822. Python's compute_risk_derived_contracts computes drawdown_room_cap at lines 465-482 (Topstep-only, when current_drawdown_room supplied), but the `if risk_derived_cap <= 0: if account_is_healthy and base_contracts > 0:` early-return floor branch (lines 498-560) builds floored_contracts from base_contracts clamped only by effective_firm_cap (line 503-507) and liquidity_cap (508-509) — drawdown_room_cap is never referenced in this branch, confirmed by direct read. The TS twin risk-sizing.ts explicitly includes drawdownRoomCap in the analogous early-return floor's flooredCandidates array

**2. Blast radius:** touches capital-safety-sizing; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Mirror the TS F-4 fix: in the risk_derived_cap<=0 healthy branch, include drawdown_room_cap in the floor min() when has_drawdown_room_input, and set drawdown_room_cap_binding/binding_cap accordingly — making Python byte-identical to risk-sizing.ts.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## CAP-3 — MED (instrument)

**File:** `src/server/services/consistency-tracker-service.ts:202` — subsystem: capital-safety-sizing

**1. What & why (defect + receipt):** Consistency-tracker computes the prop-firm 50% single-day rule across BOTH firms and ALL accounts — the accountId parameter is never used to scope the P&L query

> Failure scenario: getConsistencyState(accountId) is called per account, but the realized-P&L query (194-207) and the open-MTM query (213-223) filter only by ps.firm_id IN ('topstep','mffu') with NO accountId/session scoping. So every account on either firm receives the SAME concentration number, computed by summing profit days across Topstep AND MFFU AND every session combined. Two independent firms' P&L are netted into one cycleCumulativeProfit and one highestDayProfit. When shouldBlockNewEntry() is enabled (opt-in gate, currently default-off/unwired), a Topstep account whose OWN best day is 60% of its OWN cycle can be diluted below 50% by unrelated MFFU/other-account profit days → the gate passes it → the firm denies the payout for real single-day-concentration violation. Conversely one account's spike wrongly blocks a sibling account. Either direction is a prop-firm-rule miscalculation.

> Evidence: Grep of the file shows accountId is used ONLY for the cache key (105-116), audit entityId, and Discord message text — never in any SQL WHERE. The daily query WHERE clause is `ps.firm_id IN (${firmList})` where firmList = both CONSISTENCY_RULE_FIRMS (line 193), with no `AND ps.id = ...` or account filter; the open-MTM query (217-222) is identically firm-wide. The result is cached per accountId (337) but is byte-identical for every accountId.

**Independent verify (accuracy-validator):** Read consistency-tracker-service.ts lines 154-339 directly. Both SQL queries (dailyRows at 194-207, unrealizedRow at 213-223) filter exclusively on `ps.firm_id IN (${firmList})` where firmList = CONSISTENCY_RULE_FIRMS = ['topstep','mffu'] (a firm-level constant, not account-scoped). accountId (the function parameter, actually populated with sessionId by the real caller at paper-signal-service.ts:3813-3814, or a firm-composite string 'paper-close:${firmId}' by paper-execution-service.ts:2929) is used ONLY as the cache key (_getCached/_setCache, lines 105-116) and audit entityId — never appears in either SQL WHERE clause. paper_sessions rows are joined via ps.id = pt.session_id but the WHERE n

**2. Blast radius:** touches capital-safety-sizing; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Scope both queries to the specific account: resolve accountId → its session(s)/firm and add the account/session filter (and restrict firm_id to that account's own firm, not the union of both), so concentration is computed per funded account as the Topstep/MFFU rule actually applies. Add a RED-proof test with two accounts having different concentration profiles.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## FG-2 — MED (instrument)

**File:** `src/server/services/regime-drift-detector-service.ts:402` — subsystem: gate-false-greens

**1. What & why (defect + receipt):** Regime-drift detector treats regime_trained_on='UNKNOWN' as a real regime, guaranteeing false demotion of any strategy frozen while bias data was unavailable

> Failure scenario: The frozen-policy freeze path stamps regime_trained_on from the latest bias_state.regimeLabel but falls back to the literal string 'UNKNOWN' when bias_state is empty or the lookup errors (lifecycle-service.ts:1154 `let currentRegime = "UNKNOWN"`, comment 'UNKNOWN is a valid regime label'). The detector's skip guard at line 402 only skips null/empty-string (`if (!regimeTrainedOn)`), NOT 'UNKNOWN'. Real bias_state.regimeLabel values (TRENDING/COMPRESSION/HIGH_VOL_MACRO/etc.) are never literally 'UNKNOWN', so recentRegimes.every(r => r !== 'UNKNOWN') at line 456 is unconditionally true. Result: any DEPLOYED strategy that was frozen while the bias engine was down is auto-demoted DEPLOYED->DECLINING->TESTING on the first detector run with >=5 bias rows, and emits a strategy.regime_drift_detected WARN that misrepresents a freeze-time data-provenance gap as genuine regime drift.

> Evidence: Null-only guard at line 402 (`if (!regimeTrainedOn)`); unconditional-difference test at line 456; UNKNOWN freeze fallback at lifecycle-service.ts:1154-1163 and 2549-2553; bias-state-service.ts:204 sets regimeLabel:'UNKNOWN' only as an empty-state sentinel, so healthy symbols never emit it.

**Independent verify (accuracy-validator):** Verified all cited code directly. regime-drift-detector-service.ts:402 guard is `if (!regimeTrainedOn)` — a truthy check that only catches null/empty string, not the literal string "UNKNOWN". lifecycle-service.ts:1154 confirms the freeze path defaults `let currentRegime = "UNKNOWN"` and only overwrites it if a bias_state row exists AND `regimeLabel` is a string (lines 1157-1167); on an empty table read or a caught lookup error, "UNKNOWN" is passed straight into `freezePolicyForStrategy(id, currentRegime)`, which stamps `strategies.regime_trained_on` (per §12 Pass B.2 frozen-policy contract). The same UNKNOWN-fallback pattern recurs at 4 other call sites (2544, 4236, 5006, 6857), so this isn'

**2. Blast radius:** touches gate-false-greens; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Treat regimeTrainedOn === 'UNKNOWN' the same as null (skip with legacy_strategy_skipped/insufficient audit), or require the trained regime to be a member of the known institutional-regime vocabulary before running the every()-differ demotion.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## SDL-2 — MED (instrument)

**File:** `src/server/services/fill-reconciliation-service.ts:201` — subsystem: services-contracts-nulls

**1. What & why (defect + receipt):** Broker fill payload coerced with Number() yields NaN on malformed price, producing a silent false-green in position-drift reconciliation

> Failure scenario: TradersPostFillSource.normalizeFillEvent builds filled_avg_price = Number(p['avgFillPrice'] ?? p['avg_fill_price'] ?? 0). The `?? 0` only guards null/undefined, not an unparseable string. If the broker webhook sends a formatted price ('5,001.25' with a thousands separator, a currency-prefixed string, or any non-numeric token) Number() returns NaN. That NaN is stored into the filled_avg_price numeric column (Postgres numeric accepts 'NaN'). Later checkPositionDrift (line 871) reads Number(row.filledAvgPrice)=NaN → serverWeightedPrice=NaN → priceDrift = Math.abs(NaN - brokerAvgPrice) = NaN → `NaN > DRIFT_TOLERANCE_PRICE_POINTS` is false → priceDrifted=false → driftDetected returns false. A genuine price divergence between the server's cost basis and the broker's is silently reported as no-drift, so the account is never marked needs_reconcile. (Server-mediated execution is behind isServerMediatedExecutionEnabled, off today — this is the exact go-live path, hence MED.)

> Evidence: fill-reconciliation-service.ts:200-201 (Number() coercion, comment at :172-175 admits the TradersPost schema is unverified), :871 (Number(row.filledAvgPrice ?? 0)), :886 (priceDrift = Math.abs(serverWeightedPrice - brokerAvgPrice)), :890-891 (priceDrift > tol → false for NaN → driftDetected=false false-green).

**Independent verify (accuracy-validator):** Traced the full chain on disk. (1) TradersPostFillSource.normalizeFillEvent (line 201) coerces filled_avg_price via bare Number(...) with no isFinite/isNaN guard — a malformed price string ('5,001.25', '$5001.25', etc.) yields NaN. (2) ingestFillEvent's write path (line 674-701) propagates that NaN through the weighted-average formula (newAvgPrice stays NaN once one fill is NaN) and persists via filledAvgPrice: String(newAvgPrice) → the literal string "NaN" — confirmed the numeric column (schema.ts:2584 `numeric("filled_avg_price")`) has no CHECK constraint, and Postgres numeric legitimately accepts the 'NaN' literal, so this write succeeds silently (no DB error, no audit flag). Notably, a s

**2. Blast radius:** touches services-contracts-nulls; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Parse broker numeric fields defensively: strip separators then validate with Number.isFinite; if the fill price/qty is not finite, reject the fill event (return null / record fill_reconciliation.malformed_payload) rather than persisting NaN. In checkPositionDrift, treat any non-finite serverWeightedPrice/brokerAvgPrice as drift-detected (fail-CLOSED), never as within-tolerance.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## VI-2 — MED (instrument)

**File:** `src/engine/walk_forward.py:598` — subsystem: walkforward-mc-validation

**1. What & why (defect + receipt):** CPCV reports total_trades and total_return summed across overlapping paths (~5x inflated) → MIN_OOS_TRADES confidence gate false-OK

> Failure scenario: In the same CPCV overlap structure, line 598 `total_trades = len(all_oos_trades)` counts every OOS trade once per path it appears in — each fold's trades recur in ~5 paths, so total_trades ≈ 5x the real distinct OOS trade count. At line 1046 the result's confidence flag is `"OK" if total_trades >= MIN_OOS_TRADES (30) else "LOW"`. A strategy with only ~6 genuine OOS trades reports ~30 and is stamped confidence=OK, defeating the statistical-reliability guard that is supposed to flag thin-sample OOS results. Separately, line 599 `total_return = sum(path_returns)` sums the per-path total_return across all 15 paths, so each fold's return is counted ~5x — the headline oos_metrics.total_return (line 1049) is ~5x the true combined OOS return, a misleading number surfaced to the operator/picker.

> Evidence: Line 598 `total_trades = len(all_oos_trades)`; line 599 `total_return = sum(path_returns)`; line 615-618 gross_wins/losses/win_rate also aggregate the reused-fold trade set (PF/win_rate are ratios so invariant, but counts are not); line 1046 confidence gate keys on the inflated total_trades; line 1049 emits the inflated total_return. all_oos_trades is extended per path at line 532 inside the 15-path combinations loop.

**Independent verify (accuracy-validator):** Verified against src/engine/walk_forward.py on disk. Lines 598-599 confirm `total_trades = len(all_oos_trades)` and `total_return = sum(path_returns)`, aggregated inside `_run_walk_forward_cpcv` (default n_splits=6, k_test_groups=2 → C(6,2)=15 paths, line 322-324/407). `all_oos_trades` is extended per-path at line 532 inside the `for test_fold_indices in _combos(...)` loop (line 407), and each fold serves as an OOS test fold in C(n_splits-1, k_test_groups-1) = C(5,1) = 5 of the 15 paths — the same underlying fold's trades are backtested and appended multiple times. This exact overlap fact is independently corroborated by the codebase's own FIX 6 comment at lines 736-743: "The 15 combinatoria

**2. Blast radius:** touches walkforward-mc-validation; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Report CPCV headline counts/returns as per-path means (or dedupe by fold) rather than sums over overlapping paths, and base the MIN_OOS_TRADES confidence check on distinct-OOS-trade count (e.g. average trades per path, or unique-fold trade count), not the pooled concatenation length.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## VI-3 — MED (instrument)

**File:** `src/engine/walk_forward.py:721` — subsystem: walkforward-mc-validation

**1. What & why (defect + receipt):** CPCV PBO overfit hard-gate silently fails OPEN when a single per-path IS backtest raises an exception

> Failure scenario: per_path_is_sharpes is appended only when a path's lightweight IS backtest succeeds (line 545); on any exception it is caught and skipped (lines 549-554) while path_sharpes still has the OOS entry (line 530). _has_full_is at line 721 requires len(per_path_is_sharpes) == len(path_sharpes), so a SINGLE transient IS-backtest failure among the 15 paths (OOM, data hiccup, subprocess error) makes _has_full_is=False. The PBO builder then falls to the else branch (lines 803-807) that sets is_sharpe==oos_sharpe for every path → pbo_gate.compute_pbo_from_cpcv_paths fires its degenerate guard → pbo=None → degenerate_reason='cpcv_is_sharpe_unavailable' (line 815) → the TESTING→SHADOW/PAPER PBO hard gate treats it as cpcv_exempt and PROCEEDS (lines 829-844). A genuinely overfit strategy (true PBO > the 0.15 threshold) is thus promoted past the overfit gate because of an unrelated transient failure in one of 15 IS runs, with no block — a false-green on a documented HARD gate.

> Evidence: Lines 543-554 (IS backtest try/except, per_path_is_sharpes appended only on success); line 721-724 `_has_full_is = len(per_path_is_sharpes) > 0 and len(per_path_is_sharpes) == len(path_sharpes)`; lines 797-807 (PBO uses IS==OOS degenerate fallback when not full IS); lines 814-816 relabel to cpcv_is_sharpe_unavailable; lines 829-844 emit walk_forward.pbo_cpcv_degenerate and PROCEED. The proceed-on-degenerate choice is documented for by-design IS-unavailability, but here it is triggered by a catchable runtime exception, converting a partial failure into a silent gate bypass.

**Independent verify (accuracy-validator):** Independently re-read src/engine/walk_forward.py lines 500-844 and src/server/lib/pbo-gate.ts lines 1-200. The mechanics claimed are accurate: (1) path_sharpes.append() at line 530 runs unconditionally per CPCV path after the OOS backtest succeeds; (2) per_path_is_sharpes.append() at line 545 is inside a try block (543-554) and only appends on success — the except clause (549-554) merely logs to stderr and continues, leaving per_path_is_sharpes short by one entry relative to path_sharpes; (3) _has_full_is at 721-724 requires exact length equality, so ANY single IS-backtest exception among the (default 15) CPCV paths flips it False; (4) at 797-807, when not _has_full_is, the PBO path-dict bui

**2. Blast radius:** touches walkforward-mc-validation; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Distinguish 'IS genuinely unavailable by design' from 'IS backtest raised': if per_path_is_sharpes is only partially populated due to caught exceptions, either re-run/repair the failed path, drop that path from BOTH path_sharpes and OOS aggregates so counts stay aligned, or route to a BLOCK/needs-review disposition rather than the cpcv_exempt PROCEED path. A transient failure must not silently disable a hard overfit gate.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## F2 — MED (instrument)

**File:** `src/server/services/paper-execution-service.ts:4433` — subsystem: exits-entries-antisetup

**1. What & why (defect + receipt):** Anchored-VWAP runner trail uses close price in paper but typical price (H+L+C)/3 in backtest — divergent AVWAP → divergent trail stop and exit price

> Failure scenario: For a runner using anchored_vwap, paper accumulates AVWAP as `barMid = currentPrice` (close) → `newSumPv = prevSumPv + barMid * barVol` (lines 4433-4436). The Python backtester accumulates `typical_price = (bar_high + bar_low + close)/3` → `_avwap_cum_tpv += typical_price * bar_vol` (backtester.py:2083-2084). On any bar whose range is non-trivial and close is skewed to one end (e.g. a long green bar closing near the high), the two AVWAP values differ, so the trail stop (avwap ± tick) differs, so the runner exit price and the whole-trade P&L differ between the two engines that are contractually required to be parity-equivalent (CLAUDE.md 'TS↔Python Exit Engine Parity' hard gate).

> Evidence: paper line 4433 `const barMid = currentPrice;` then 4434 `newSumPv = prevSumPv + barMid * barVol;` vs backtester.py line 2083 `typical_price = (bar_high + bar_low + float(close_np[bar])) / 3.0`. Both are labelled as computing the anchored VWAP for the same runner method.

**Independent verify (accuracy-validator):** Read paper-execution-service.ts:4425-4436 directly: barMid = currentPrice (the bar's close price), then newSumPv = prevSumPv + barMid * barVol — a close-weighted VWAP. Read backtester.py:2081-2085 directly: typical_price = (bar_high + bar_low + close)/3.0, then _avwap_cum_tpv += typical_price * bar_vol — a typical-price-weighted VWAP. Both accumulate over the same volume series (barVol/vol_np wired from Wave 26) and both apply an identical ±1 tick cushion to the resulting average as the trail stop (paper line ~4436; backtester lines 2094-2100). The comment block in paper-execution-service.ts even claims parity with backtester.py lines 1568/1571 ('Matches backtester.py... avwap_price - tick /

**2. Blast radius:** touches exits-entries-antisetup; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Use the same price basis on both sides — feed the paper AVWAP accumulator (bar_high+bar_low+close)/3 (thread bar high/low, already available as exitBarContext.barHigh/barLow) instead of close, or change the backtester to close-basis; then extend the parity harness to cover a non-empty-liquidity, multi-bar AVWAP runner fixture.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## CMP-2 — MED (instrument)

**File:** `src/engine/governor/state_machine.py:122` — subsystem: compliance-governor-firm

**1. What & why (defect + receipt):** Governor escalates only one state per trade, so a single catastrophic loss that breaches the 80%-of-budget LOCKOUT threshold only reaches ALERT (full size)

> Failure scenario: From NORMAL, one trade loses 90% of the daily loss budget in a single fill (session_loss_pct=0.90, above the 0.80 LOCKOUT threshold). on_trade evaluates only the NORMAL->ALERT branch (consecutive_losses>=2 OR session_loss_pct>=0.30) and moves to ALERT, whose SIZE_MULTIPLIER is 1.0 — no size reduction and can_trade=True. The next trade is taken at FULL size despite the session already being ~90% of budget in the red. It takes four more trades to walk NORMAL->ALERT->CAUTIOUS->DEFENSIVE->LOCKOUT, so the 'or_session_loss_pct' fast-path (0.50/0.65/0.80) is defeated by the one-step-per-call escalation. governor_backtest then reports understated trades_blocked / dd_reduction, i.e. the drawdown-protection metric consumed from backtester output (backtester.py:5811, 7941) overstates how well the governor would have contained the loss.

> Evidence: Each state branch (lines 122-159) only tests the transition to the NEXT adjacent state; the higher thresholds (DEFENSIVE->LOCKOUT at session_loss_pct>=0.80, line 144) are unreachable in a single on_trade call from NORMAL/ALERT/CAUTIOUS even when session_loss_pct already exceeds them. _session_loss_pct (line 241) applies no cap, so the pct can be >=0.80 on the very first trade yet still yield only ALERT. SIZE_MULTIPLIERS['alert']=1.0 (line 58) confirms ALERT applies no throttle.

**Independent verify (accuracy-validator):** Read src/engine/governor/state_machine.py:89-174 directly. Each state branch (NORMAL/ALERT/CAUTIOUS/DEFENSIVE, lines 122-149) tests only its own adjacent-state thresholds and does NOT re-check against later thresholds even though session_loss_pct (computed once per call at line 116 via _session_loss_pct(), line 241-245, which applies no ceiling/cap) can already exceed them. Traced the caller invariant in governor_backtest.py: line 86 sizes the CURRENT trade using gov.state.value (state BEFORE this trade's on_trade call), then line 120 calls gov.on_trade(adj_pnl, mae) which updates state for the NEXT trade. This confirms the exact mechanism the finder describes: a single catastrophic trade (s

**2. Blast radius:** touches compliance-governor-firm; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Compute the target state from the WORST breached threshold in a single call (map session_loss_pct/consecutive_losses to the highest matching state: 0.80->lockout, 0.65->defensive, 0.50->cautious, 0.30->alert) and jump directly, rather than advancing one enum step per trade. Keep win-based de-escalation gradual.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

## WIRE-2 — MED (instrument)

**File:** `src/server/routes/fill-callback.ts:91` — subsystem: wiring-contract-drift

**1. What & why (defect + receipt):** fill-callback HMAC signs only source|timestamp|fill_id|symbol — the P&L-determining filled_qty / filled_avg_price / status are unsigned, so corrupted fill economics still authenticate and flow into actual_pnl

> Failure scenario: With SERVER_MEDIATED_EXECUTION_ENABLED=true, a broker/relay POSTs a fill to /api/broker/fill-callback. The HMAC canonical message is `${broker_source}|${timestamp_ms}|${broker_fill_id}|${symbol}` (line 91) — it does NOT include filled_qty, filled_avg_price, or status. If any intermediary (relay, proxy, or a signer bug that signs before the price field is populated) mangles filled_avg_price or filled_qty while leaving the four signed fields intact, verifyFillCallbackHmac() still returns true and the payload is ingested as authoritative. fill-reconciliation-service.ts then computes realized P&L directly from these unsigned numbers: newAvgPrice = fillEvent.filled_avg_price (line 676/680) and actual_pnl = direction*(newAvgPrice - entryPrice)*newFilledQty*pointValue (line 514), persisting a wrong actual_pnl to production_trades and mis-driving needs_reconcile drift detection. The signature that is meant to authenticate the fill does not extend integrity to the exact numbers that feed P&L.

> Evidence: fill-callback.ts:79-91 canonical string excludes filled_qty/filled_avg_price/status; verifyFillCallbackHmac validates only that subset. fill-reconciliation-service.ts:514 computes pnl from filled_avg_price+filled_qty; :676/:680 set newAvgPrice from fillEvent.filled_avg_price; :716-721 writes actual_pnl into production_trades. So the economic fields are consumed for money math but never covered by the auth signature.

**Independent verify (accuracy-validator):** Verified the exact code on disk. fill-callback.ts:91 canonical HMAC message is `${brokerSource}|${timestampMs}|${brokerFillId}|${symbol}` — filled_qty, filled_avg_price, and status are never included in the signed bytes (confirmed lines 79-103). fill-reconciliation-service.ts:659-681 computes newFilledQty/newAvgPrice directly from fillEvent.filled_qty/fillEvent.filled_avg_price with no plausibility check against the order's intended price/qty, then computeActualPnlForFullExit() (called ~727, math at line 514: `direction*(newAvgPrice-entryPrice)*newFilledQty*pointValue`) persists actual_pnl straight from these unsigned fields to production_trades — no cross-check exists in ingestFillEvent bet

**2. Blast radius:** touches wiring-contract-drift; any fix re-baselines dependent backtests/gate outcomes — recertify affected strategies before trusting metrics.

**3. Scope-locked change (PROPOSED — do not implement until ratified):** Extend the HMAC canonical message to cover the economic fields, e.g. `${broker_source}|${timestamp_ms}|${broker_fill_id}|${symbol}|${filled_qty}|${filled_avg_price}|${status}`, and update the matching signer(s). This binds the signature to the numbers reconciliation trusts, closing the silent wrong-P&L path when a signed-but-numerically-corrupted fill is ingested.

**4. Verification plan:** parity/flip-enumeration + targeted test proving the failure scenario is closed and no adjacent metric moved; ships with its own receipt; independent grade (doer!=grader).

**5. Rollback:** single-commit revert on the fix branch; behavior is env/flag-gated where the change alters a live default.

---

