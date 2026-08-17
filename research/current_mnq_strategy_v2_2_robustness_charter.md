# Current MNQ Strategy v2.2 — Robustness Repair Charter

Status: PRE-PNL REPAIR SPECIFICATION
Purpose: correct fidelity/correctness/data/execution defects without optimizing for historical P&L.
Rule: no repair below may be promoted, removed, or altered because of Jan–Apr 2026 P&L. That period is development data only.

## P0 — Correctness defects (must fix before any new performance claim)

### F01 Breakout zone polarity is wrong
Current loop pairs LONG with support and SHORT with resistance for both reversals and breakouts. That is correct for reversals but wrong for zone-failure breakouts.

Required semantics:
- REV long: rejection of SUPPORT.
- REV short: rejection of RESISTANCE.
- BRK long: decisive break/acceptance ABOVE RESISTANCE.
- BRK short: decisive break/acceptance BELOW SUPPORT.

Acceptance: unit fixtures prove each of the four cases and reject the four opposite-polarity false cases.

### F02 Weak 15m breakout confirmation can use an older unrelated 15m close
The current BRK15 path asks whether the latest completed 15m bar is beyond the zone, but it does not bind that 15m close to the breakout attempt being evaluated.

Repair: record breakout-attempt timestamp and zone identity; weak breakout may qualify only after the 15m bar containing/after that attempt closes beyond the SAME zone. Entry occurs only after that confirming close is knowable.

Acceptance: an old 15m close beyond a level cannot confirm a later weak attempt; a newly completed 15m acceptance can.

### F03 Entry confluence gate is tautological
Zones are already created with `min_touch = ztouch`, then the entry gate accepts `conf >= 1 OR touches >= ztouch`; therefore every emitted zone passes through the touches clause. Confluence is not an actual gate.

Repair: separate `zone_exists`, `zone_quality`, and `confluence`. No boolean condition may restate the constructor condition. A+ location qualification must have independently testable components.

Acceptance: fixture with a valid repeated-wick zone but insufficient A+ location quality is refused; adding real confluence or quality can change the decision.

### F04 Counter-bias reversal passes a hardcoded story score
Current v2.1 calls soft-bias permission with constant story score 5 rather than the computed reversal score.

Repair: pass the actual immutable story result. Better: replace arbitrary score permission with named state completion (`approach`, `fight`, `decision`) plus location quality.

Acceptance: incomplete reversal cannot become counter-bias eligible merely because caller supplies a constant.

### F05 Target room logic can skip a close blocker and pretend there is room
Current selector discards targets closer than the minimum R distance, then may choose a farther target. A strong nearby reaction area can therefore disappear instead of blocking the trade.

Repair: separate BLOCKERS from DESTINATIONS. Scan the path in price order. If a meaningful opposing blocker occurs before minimum required room, reject the trade unless the strong-breakout pass-through rule independently classifies that blocker as weak enough to traverse.

Acceptance: strong blocker at 0.8R + destination at 3R => NO TRADE; weak shelf at 0.8R + proven strong displacement may permit the farther destination.

### F06 Order prices are not always on the MNQ tick grid
Zone interpolation produces targets such as x.125/x.375/x.625/x.875. These are not valid MNQ order prices.

Repair: all executable order prices must pass a central tick-normalization function. Round conservatively in a declared direction and record raw vs executable price.

Acceptance: every entry/stop/target/fill satisfies price % 0.25 == 0 (within integer tick arithmetic, not float tolerance).

### F07 Zone lifecycle/polarity is missing
Premarked zones stay support/resistance even after decisive acceptance through them. Stale/broken zones can still trigger later trades with the old role.

Repair: causal state machine per zone: ACTIVE_SUPPORT / ACTIVE_RESISTANCE -> TESTED -> BROKEN -> optional FLIPPED_RETEST -> RETIRED. Decisive acceptance invalidates old polarity. No hindsight state changes.

Acceptance: after confirmed support failure, the same object cannot later authorize a long support reversal unless a separately defined reclaim/revalidation sequence occurs.

### F08 Left-edge warmup is insufficient
The evaluated dataset starts 2026-01-20 while zone lookbacks reach 40 days and target/FVG lookbacks reach 25 days. Early trades are computed with incomplete history.

Repair: load >= 60 calendar days of pre-evaluation warmup; never score warmup trades. Report exact warmup coverage.

Acceptance: first scored session has full required historical coverage for every feature family.

### F09 Research data is mutable/unpinned
Scripts download raw files from upstream `main`. Same code can receive different bytes later.

Repair: pin source commit + exact file SHA256 in a data manifest. Prefer immutable local research snapshot. Refuse run on hash mismatch.

Acceptance: run records commit, file hashes, row counts, first/last timestamps; modified source refuses unless a new experiment ID is declared.

### F10 Futures contract identity/roll provenance is not encoded in rows
The source updater uses explicit contract IDs (e.g. MNQ.M26) and says IDs must change on roll; generic CSV rows do not identify the contract used. A multi-year backtest cannot assume a generic MNQ file is an active-front-month series.

Repair: contract-aware manifest per session. Use then-active MNQ contract under one predeclared roll rule, or a documented continuous-series mapping with level translation. Never cross a roll discontinuity silently.

Acceptance: every historical session maps to exactly one source contract; roll sessions and adjustment method are auditable.

## P1 — Strategy fidelity defects

### F11 Zone quality is too dependent on magic touch count
2-touch and 3-touch families diverge sharply. Count is acting as a brittle proxy for visual importance.

Repair: build a continuous, interpretable zone-quality vector from independent rejection events:
- rejection wick/body geometry,
- close-away quality,
- post-rejection displacement,
- independence/separation of events,
- recency decay rather than a hard cliff,
- cluster compactness,
- PDH/PDL/PWH/PWL overlap,
- relevant active-FVG overlap.
Touch count saturates rather than dominating. Minimum 2 may remain only because “repeated” is semantic, not because 2 won a backtest.

Acceptance: zone strength remains stable under nearby thresholds/weights and does not collapse solely at 2->3 touches.

### F12 Price clustering is brittle and can expand around outliers
Current cluster bounds use min/max rejection prices and dynamic centroid grouping.

Repair: deterministic ATR-normalized robust clustering using median/weighted center and robust dispersion (MAD/quantile bounds), with explicit merge rules for overlapping zones.

Acceptance: adding one outlier rejection cannot radically widen/move a high-confidence zone; input order cannot change the result.

### F13 Zone interaction is too coarse
A bar merely spanning a zone within tolerance can count as an interaction; penetration, approach side, prior invalidation, and close behavior are not fully modeled.

Repair: explicit zone-interaction states: APPROACH -> TOUCH/PENETRATION -> REJECTION or ACCEPTANCE. Track penetration depth, close location, first touch/retest, and approach direction.

Acceptance: giant bar that spans a zone without a valid rejection story cannot masquerade as a clean reversal touch.

### F14 Premarket engine collapses a plan into BULL/BEAR/NEUTRAL
Current engine uses 04:00–09:29 net direction, last-hour control, simple structure, PD range, prior close, and PW extremes. It does not represent conditional scenarios/invalidation.

Repair: output a PREMARKET PLAN object, not only a label:
- higher-timeframe 15m structure,
- prior RTH close and gap,
- PDH/PDL/PWH/PWL,
- overnight high/low/mid and inventory (architecture supports 18:00–09:29; exact user-used window must be frozen from fidelity evidence, not P&L),
- 04:00–09:29 premarket structure/control,
- primary direction,
- continuation condition,
- reversal permission condition,
- invalidation/neutral state.

Acceptance: two days with same net premarket direction but different key-level location can produce different plans.

### F15 Direction logic is overly mirror-symmetric
The same formulas are mirrored long/short, contributing to suspiciously balanced direction counts. Do NOT impose a desired long/short ratio.

Repair: keep equations direction-neutral but feed real asymmetric market state: location versus PD/PW/overnight levels, HTF structure, gap/inventory, active zone lifecycle, and control transition. Direction counts must be an emergent result.

Acceptance: no code path contains balancing/quotas; shuffled/mirrored market data behaves consistently while real data is free to produce any ratio.

### F16 Reversal classification is still a compressed approximation of the user’s candle story
Current structured reversal uses roughly four prior bars and binary weakening/compression/rejection/failed-push/takeover fields.

Repair: multi-bar state machine with geometry, not pattern names:
- approach direction and expansion/contraction,
- body trend,
- opposing wick pressure,
- doji/inside/compression geometry,
- failed push/sweep,
- reclaim/hold,
- engulf/control transfer,
- displacement/follow-through.
No rule is tuned from P&L; thresholds are calibrated on labeled user examples and rejected examples.

Acceptance: golden fixtures include both accepted trades and tempting NO-TRADE examples.

### F17 Strong/weak momentum thresholds contain untested hidden constants
Examples include body fraction, range expansion, close location, rejection fraction, touch tolerance, breakout clearance, weakening/compression thresholds and premarket thresholds.

Repair: create a declared parameter registry with semantic ranges. Run one-factor/local-neighborhood and Latin-hypercube perturbations after the base is frozen. Seek broad plateaus; do not select point maxima.

Acceptance: every numeric decision threshold has name, units, semantic reason, allowed perturbation range, and robustness result.

### F18 Hard absolute tolerances are not volatility-scaled
Examples include 2-point PD/PW pad, 6-point FVG overlap tolerance, and other fixed point buffers.

Repair: tick/ATR-normalize where the user’s concept is relative. Fixed points remain only where the user’s rule is genuinely fixed (e.g. current 17.25-point stop).

Acceptance: quiet/high-volatility regime behavior does not change merely because a fixed 6-point overlap became trivial/huge.

### F19 Target destination quality remains too shallow
Current BRK5 chooses nearest target marked `major`; REV/BRK15 choose nearest eligible target. “Major” can be produced by simple touch count/FVG overlap.

Repair: causal destination ranking vector:
- reaction strength and independent reactions,
- zone quality,
- PD/PW status,
- relevant FVG status and remaining unmitigated portion,
- distance and intervening blockers,
- momentum/pass-through state,
- recency/current relevance.
Choose the next MEANINGFUL destination, then apply safe-middle depth. Do not optimize for a desired dollar winner.

Acceptance: tiny shelf before a high-quality destination is either an explicit blocker or explicit pass-through candidate; it is never silently ignored.

### F20 FVG role remains too binary
Partial mitigation is fixed and entry confluence is capped, but overlapping FVGs can still create multiple target objects and any overlap can upgrade a target to “major.”

Repair: merge related overlapping FVGs, preserve remaining unmitigated intervals, and treat FVG primarily as contextual evidence. Standalone FVG destination is allowed only under a named logical-destination rule.

Acceptance: five overlapping gaps cannot become five independent votes/targets.

### F21 Key levels are underrepresented as entry locations
PDH/PDL/PWH/PWL currently act mainly as confluence/targets; entry zones are repeated-wick clusters. If the user actually takes candle-confirmed reactions directly at these marked levels, the bot misses them.

Repair: one unified `Location` interface for WICK_ZONE / PDH / PDL / PWH / PWL / approved FVG context. Same candle-control engine acts on locations; no source gets a special P&L-tuned rule.

Acceptance: fidelity fixtures decide whether each source can independently authorize an entry; this is frozen from user rules, not historical profitability.

### F22 A+ gate is not explicit enough
First qualifying setup is correctly executable, but current qualification can still spend the one daily trade too easily.

Repair: mandatory A+ gate = valid location + valid premarket scenario + valid control story + valid path/room + valid destination + no unresolved conflict. No weighted total may let one missing mandatory dimension be compensated by another.

Acceptance: first chronological setup only trades after every mandatory gate passes; otherwise keep waiting until 12:00.

## P2 — Execution realism defects

### F23 Entry fills are idealized at exact next 5m open
Repair: final engine uses tick/quote stream; signal becomes actionable only after bar close, then apply declared latency and marketable fill/slippage model. At minimum use next 1m open + adverse slippage stress before tick data is available.

### F24 Stop fill is optimistic on gap-through
Current 1m engine fills exact stop even if bar opens through it.

Repair: stop-market gap logic fills no better than first tradable price after crossing plus slippage. Tick engine is final authority.

### F25 Target touch assumes guaranteed fill
Repair: model limit fill conservatively (e.g. trade-through/queue rule) or use tick bid/ask evidence. Stress missed-touch targets.

### F26 Intrabar stop-vs-target ordering is unresolved on 1m
Current stop-first rule is conservative, which is good, but coarse.

Repair: use available MNQ tick history to quantify 1m ambiguity error; final certification uses tick ordering.

### F27 Fixed slippage model is too narrow
Current base deducts 0.5 MNQ point per round trip as cash rather than modeling entry/exit fill mechanics.

Repair: predeclare normal and stress profiles (latency + spread + stop slippage), including 0.5/1/2/4-point round-trip equivalents and event-volatility shocks. No parameter is selected by best P&L.

### F28 Drawdown ignores intratrade MAE
Trade-close equity max DD is not enough for Topstep-style trailing risk.

Repair: reconstruct mark-to-market P&L at tick/1m frequency for every open trade and compute MFE/MAE, intraday equity low, MLL breach, and slippage shock.

## P3 — Data quality / validation defects

### F29 1m and 5m feeds are downloaded separately without a parity gate
Repair: use one canonical lowest-granularity stream where possible and derive higher timeframes; otherwise verify 1m->5m and 5m->15m OHLC parity, timestamp alignment, DST and missing bars before every run.

### F30 Missing-data/data-integrity checks are not first-class gates
Repair: reject dataset on duplicate timestamps, non-monotonic time, OHLC invariant violations, impossible tick prices, unexpected RTH gaps, missing exit bars, or timezone ambiguity. Produce data-quality report before trading code runs.

### F31 Current sample is tiny and contaminated
61 sessions / 34 base trades are development evidence only.

Repair: after v2.2 semantics freeze, use multi-year unseen then-active MNQ. At current trade density, 1,000 independent trades likely requires many years, not a few months. Never modify v2.2 from final holdout P&L.

### F32 Current PBO-style number is only a diagnostic
Six folds and closely related variants cannot justify a literal “5% overfit probability” claim.

Repair: with much larger history run proper CSCV/PBO, Deflated Sharpe, walk-forward, embargo, regime stability, and multiple-testing accounting. Report trial registry including all failed variants.

### F33 Current Monte Carlo extrapolates 34 observed trades to 1,000
Repair: Monte Carlo remains stress-only. Use stationary/block bootstrap over daily chronology including no-trade days, regime-conditioned resampling, clustered losses, and execution shocks. Never call simulated trades historical trades.

### F34 No independent engine/data cross-check yet
Repair: implement a second minimal verifier for frozen entries/exits and compare trade ledger byte-for-byte/key-by-key. Verify sampled bars against an independent vendor/source when available.

### F35 No trader-fidelity gold set
Repair: create immutable labeled fixtures from the user’s actual screenshots/videos/replay examples:
- A+ accepted long/short,
- strong breakout,
- weak breakout requiring 15m,
- reversal/control flip,
- failed breakout,
- zone failure,
- NO TRADE examples.
Evaluate location, direction, setup family, entry eligibility and target destination separately from P&L.

## P4 — Live-bot engineering blockers

### F36 Daily one-trade lock is not crash/restart-safe
Repair: persist session state; on restart reconcile broker fills/positions and refuse a second entry after any executed trade that NY session.

### F37 No production-grade order lifecycle
Repair: idempotent client order IDs, partial-fill handling, server-side OCO/bracket where supported, cancel/replace audit, position reconciliation, rejected-order handling, and safe flatten logic.

### F38 Data/clock/reconnect safety is missing
Repair: stale-feed detector, exchange clock/timezone normalization, DST tests, heartbeat, disconnect/reconnect state reconciliation, and REFUSE mode when data completeness is uncertain.

### F39 Contract-roll automation is missing for live execution
Repair: resolve current tradable contract from broker API under the same roll policy used in research; refuse if contract identity is ambiguous.

### F40 Risk kill-switches are not yet productionized
Repair: max contracts, max realized+unrealized daily loss, one-trade lock, unexpected-position kill, slippage/latency circuit breaker, and manual emergency disable. Risk rules are independent of strategy signal code.

## Frozen v2.2 engineering order

1. Correct P0 bugs F01–F10.
2. Build fidelity fixtures before using P&L to judge F11–F22.
3. Implement P1 semantic repairs.
4. Run deterministic unit/property/mutation tests.
5. Run data-quality/parity gates.
6. Freeze v2.2 rule manifest + hashes.
7. Only then run development diagnostics on Jan–Apr 2026; do not optimize from them.
8. Run sealed multi-year OOS/walk-forward.
9. Run tick-level execution + Topstep risk simulator.
10. Shadow/paper trade before any live-money authorization.

## Promotion gates

v2.2 may NOT be called live-ready unless all are true:
- zero known P0 correctness defects;
- deterministic repeated runs byte-identical on pinned data;
- trader-fidelity gold set passes, including NO-TRADE cases;
- contract/roll provenance complete;
- all executable prices tick-valid;
- causal/no-lookahead audit passes;
- broad parameter neighborhoods remain stable;
- multiple chronological regimes profitable/acceptable without rescue tuning;
- sealed untouched OOS passes predeclared gates;
- tick-level execution stress passes;
- crash/restart/order-state safety tests pass;
- paper/shadow period passes without changing strategy rules.
