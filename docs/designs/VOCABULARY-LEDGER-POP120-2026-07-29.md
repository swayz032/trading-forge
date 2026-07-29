# VOCABULARY LEDGER — `POP-120-LIVE`  ·  2026-07-29

> **Deliverable of R-424 item (1).** Frequency-ranked, every column the ruling named.
> **TREE:** measured in `wt-preflight-blockers-20260729` @ `83efd34e`, whose `spec_family_bindings.py`,
> `spec_condition_compiler.py` and `spec_execution_preflight.py` are **sha256-identical** to
> `runtime-production` @ `a6f92822` — the tree that RUNS. Hashes re-derived by the worker, AR-391 §0.
> **INSTRUMENT:** the real `from_compiled_spec(...)` → `preflight_binding_plan(...)` pair that
> `backtester.py:8493/8509` calls. No reimplementation.

## ★★★ THE DENOMINATOR, BEFORE ANY RANKING

`POP-120-LIVE` is **120 strategy rows over 40 DISTINCT VIDEOS** — every video appears exactly
**3×**, once per instrument (`_mes_` / `_mnq_` / `_mcl_`), and **[MEASURED] all 40 triples have
BYTE-IDENTICAL binding sets**. So every raw refusal count in this campaign is inflated exactly 3×.

| figure | raw (per strategy row) | **de-duplicated (per video)** |
|---|---|---|
| refusals | 1368 | **456** |
| `no_recognized_session_keyword` | 1305 | **435** |
| distinct rule texts (session class) | 339 | 339 |
| population refusing | 120 of 120 | **40 of 40** |

★ **This does not change the verdict — 40 of 40 still refuse — but every per-term frequency below is
reported on the DE-DUPLICATED basis, because a term repeated by the instrument fan-out is one term,
not three.** `strategies affected` = `videos affected` × 3.

## ★★★ WHAT THE BIGGEST BUCKET ACTUALLY CONTAINS

R-424 ordered: *do not treat 1305 `no_recognized_session_keyword` refusals as one defect.* Every one
of the 339 distinct texts was read — not sampled. **The bucket is not a session-vocabulary gap.**

| remediation class | refusals (per video) | share | videos | strategies |
|---|---:|---:|---:|---:|
| `C1_known_concept_missing_primitive` | 19 | 4.2% | 11 | 33 |
| `C2_recognized_session_missing_clock` | 94 | 20.6% | 28 | 84 |
| `C3_unrecognized_vocab_EXISTING_primitive` | 41 | 9.0% | 24 | 72 |
| `C4_new_vocab_ontology_work` | 18 | 3.9% | 11 | 33 |
| `C5_unsupported_temporal_or_control_flow` | 12 | 2.6% | 10 | 30 |
| `C6_unknown_requiredness` | 6 | 1.3% | 6 | 18 |
| `C7_malformed_extraction` | 30 | 6.6% | 15 | 45 |
| `C8_non_executable_annotation_mistyped` | 233 | 51.1% | 37 | 111 |
| `C9_RESIDUAL_none_of_these` | 3 | 0.7% | 3 | 9 |

## ★★★ THE UNLOCK ARITHMETIC — the number that decides sequencing

A strategy is preflight-clean only when **every** refusal it carries clears. Per-term unlock counts
are therefore misleading in isolation, and the honest form is cumulative:

| remediate | videos clean | strategies clean |
|---|---:|---:|
| `C1_known_concept_missing_primitive` ALONE | 0 | 0 |
| `C2_recognized_session_missing_clock` ALONE | 0 | 0 |
| `C3_unrecognized_vocab_EXISTING_primitive` ALONE | 0 | 0 |
| `C4_new_vocab_ontology_work` ALONE | 0 | 0 |
| `C5_unsupported_temporal_or_control_flow` ALONE | 0 | 0 |
| `C6_unknown_requiredness` ALONE | 0 | 0 |
| `C7_malformed_extraction` ALONE | 0 | 0 |
| `C8_non_executable_annotation_mistyped` ALONE | 2 | 6 |
| `C9_RESIDUAL_none_of_these` ALONE | 0 | 0 |

**Cumulative, greedy by marginal gain:**

| step | class added | videos clean | strategies clean |
|---|---|---:|---:|
| 1 | `C8_non_executable_annotation_mistyped` | 2 | 6 |
| 2 | `C3_unrecognized_vocab_EXISTING_primitive` | 5 | 15 |
| 3 | `C2_recognized_session_missing_clock` | 9 | 27 |
| 4 | `C7_malformed_extraction` | 13 | 39 |
| 5 | `C1_known_concept_missing_primitive` | 19 | 57 |
| 6 | `C4_new_vocab_ontology_work` | 25 | 75 |
| 7 | `C5_unsupported_temporal_or_control_flow` | 31 | 93 |
| 8 | `C6_unknown_requiredness` | 37 | 111 |
| 9 | `C9_RESIDUAL_none_of_these` | 40 | 120 |

★★★ **Seven of the nine classes unlock NOTHING on their own.** Only `C8` unlocks anything alone
(2 videos / 6 strategies), because 37 of 40 videos carry at least one C8 refusal.

## THE LEDGER

**Columns.** `n` = refusals on the de-duplicated per-video basis · `vid` = distinct videos ·
`strat` = vid × 3 · roles · class · confidence.

★★ **`SOURCE DEFINES THE TERM?` — one answer for every row in this ledger: NO, AND IT CANNOT BE
CHECKED FROM THE ARTIFACT.** [MEASURED] `transcript_chars` is **absent for 120 of 120 rows**;
the envelope carries `binding_plan_summary · graph_canonical_hash · ledger_d · spec · spec_hash ·
video` and no transcript. The `rule_text` quoted below is the extractor's **already-normalized**
phrase, **not the teacher's words** — so it is the deepest source available in-row, and it is not
the SOURCE. Grading this column anything other than `[UNANSWERABLE — NO TRANSCRIPT IN ROW]` would
be a fabricated provenance claim.

### `C1_known_concept_missing_primitive` — 19 refusals · 11 videos · 33 strategies

**Resolution path.** HTF bar-boundary events (candle open/close on a higher timeframe). Concept is unambiguous; no executable primitive binds it. `htf_bars` exists as an argument but is a known-inert detector.

**Default confidence for this class: MEDIUM.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 1 | 1 | 3 | confluence:1 | '4 hour candle' | — |
| 1 | 1 | 3 | confluence:1 | '4 hour candle period' | — |
| 1 | 1 | 3 | confluence:1 | '4 hour candle structure' | — |
| 1 | 1 | 3 | spine:1 | '4 hour time frame candlestick formation and closure' | — |
| 1 | 1 | 3 | spine:1 | '4hour candle structure open high low close' | — |
| 1 | 1 | 3 | spine:1 | '4hour order clock' | — |
| 1 | 1 | 3 | spine:1 | '930 candle' | — |
| 1 | 1 | 3 | confluence:1 | 'candle close larger time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'candle open times' | — |
| 1 | 1 | 3 | spine:1 | 'candle start' | — |
| 1 | 1 | 3 | confluence:1 | 'daily candle' | — |
| 1 | 1 | 3 | spine:1 | 'first 30 minutes high' | — |
| 1 | 1 | 3 | confluence:1 | 'fx candle open time adjustment' | — |
| 1 | 1 | 3 | spine:1 | 'hourly candle close' | — |
| 1 | 1 | 3 | confluence:1 | 'new 4 hour candle open' | — |
| 1 | 1 | 3 | spine:1 | 'new 4 hour candle opens' | — |
| 1 | 1 | 3 | spine:1 | 'new candle start time' | — |
| 1 | 1 | 3 | spine:1 | 'open next candle' | — |
| 1 | 1 | 3 | confluence:1 | 'specific candle open time futures' | — |

### `C2_recognized_session_missing_clock` — 94 refusals · 28 videos · 84 strategies

**Resolution path.** Session vocabulary. Either the phrase is absent from `SESSION_KEYWORDS` (5 zones today: london, ny_am, ny_pm, silver_bullet, macro_window) or it names a zone with no evaluable window (`REFUSED_SESSION_KEYWORDS`: overnight, lunch_blackout). Resolution = vocabulary + an evaluable window in `session_windows._ZONE_CHECKS`, and the timezone/calendar basis this ledger records as [UNENUMERATED].

**Default confidence for this class: HIGH.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 7 | 7 | 21 | confluence:6/spine:1 | 'market open' | — |
| 4 | 4 | 12 | confluence:4 | 'new york session' | — |
| 4 | 4 | 12 | confluence:3/spine:1 | 'time' | — |
| 4 | 4 | 12 | spine:2/confluence:2 | 'time window' | — |
| 3 | 3 | 9 | confluence:2/spine:1 | 'trading session' | — |
| 3 | 3 | 9 | confluence:3 | 'trading window' | — |
| 2 | 2 | 6 | confluence:2 | '9 30' | — |
| 2 | 2 | 6 | confluence:2 | 'session' | — |
| 2 | 2 | 6 | spine:1/confluence:1 | 'time day' | — |
| 2 | 2 | 6 | confluence:2 | 'trading hours' | — |
| 2 | 2 | 6 | confluence:1/spine:1 | 'trading time' | — |
| 1 | 1 | 3 | confluence:1 | '5 00 candle' | — |
| 1 | 1 | 3 | confluence:1 | '6 00 p m' | — |
| 1 | 1 | 3 | spine:1 | '6 00 to 10 00 candle' | — |
| 1 | 1 | 3 | confluence:1 | '9 30 open' | — |
| 1 | 1 | 3 | confluence:1 | 'asia session' | — |
| 1 | 1 | 3 | confluence:1 | 'asia session context' | — |
| 1 | 1 | 3 | confluence:1 | 'asia trading session' | — |
| 1 | 1 | 3 | spine:1 | 'asian session profitability' | — |
| 1 | 1 | 3 | confluence:1 | 'banks start trading' | — |
| 1 | 1 | 3 | confluence:1 | 'eastern standard time to 5 00 p m' | — |
| 1 | 1 | 3 | confluence:1 | 'extended hours' | — |
| 1 | 1 | 3 | confluence:1 | 'first 15 minutes open' | — |
| 1 | 1 | 3 | spine:1 | 'first hour' | — |
| 1 | 1 | 3 | confluence:1 | 'first hour trading' | — |
| 1 | 1 | 3 | confluence:1 | 'globex session' | — |
| 1 | 1 | 3 | confluence:1 | 'london trading session' | — |
| 1 | 1 | 3 | confluence:1 | 'lunch reversals' | — |
| 1 | 1 | 3 | confluence:1 | 'market close time day' | — |
| 1 | 1 | 3 | confluence:1 | 'market hours' | — |
| 1 | 1 | 3 | spine:1 | 'market hours availability' | — |
| 1 | 1 | 3 | spine:1 | 'market open duration' | — |
| 1 | 1 | 3 | confluence:1 | 'market open time' | — |
| 1 | 1 | 3 | spine:1 | 'market opening up' | — |
| 1 | 1 | 3 | spine:1 | 'nasdaq session' | — |
| 1 | 1 | 3 | spine:1 | 'new york market open or pre market' | — |
| 1 | 1 | 3 | confluence:1 | 'new york open' | — |
| 1 | 1 | 3 | spine:1 | 'new york open time zone' | — |
| 1 | 1 | 3 | spine:1 | 'new york session start' | — |
| 1 | 1 | 3 | confluence:1 | 'new york trading session' | — |
| 1 | 1 | 3 | confluence:1 | 'next session' | — |
| 1 | 1 | 3 | confluence:1 | 'other sessions' | — |
| 1 | 1 | 3 | spine:1 | 'outside regular trading hours' | — |
| 1 | 1 | 3 | confluence:1 | 'overnight unwind scenario three' | — |
| 1 | 1 | 3 | confluence:1 | 'pre market activity' | — |
| 1 | 1 | 3 | confluence:1 | 'pre market vwap analysis routine' | core.py:271/:379 VWAP + an `overnight`/premarket window that has no evaluable definition |
| 1 | 1 | 3 | spine:1 | 'pre new york open session' | — |
| 1 | 1 | 3 | confluence:1 | 'pre new york period' | — |
| 1 | 1 | 3 | confluence:1 | 'preparation time' | — |
| 1 | 1 | 3 | spine:1 | 'previous few sessions' | — |
| 1 | 1 | 3 | confluence:1 | 'search start time' | — |
| 1 | 1 | 3 | confluence:1 | 'session start' | — |
| 1 | 1 | 3 | confluence:1 | 'session start time' | — |
| 1 | 1 | 3 | confluence:1 | 'start trading session period' | — |
| 1 | 1 | 3 | spine:1 | 'stock market open' | — |
| 1 | 1 | 3 | confluence:1 | 'stock market opens at 9 30' | — |
| 1 | 1 | 3 | confluence:1 | 'time delay' | — |
| 1 | 1 | 3 | confluence:1 | 'time duration' | — |
| 1 | 1 | 3 | confluence:1 | 'time until 2 00' | — |
| 1 | 1 | 3 | confluence:1 | 'time zones' | — |
| 1 | 1 | 3 | confluence:1 | 'timezone' | — |
| 1 | 1 | 3 | confluence:1 | 'trading day start time' | — |
| 1 | 1 | 3 | spine:1 | 'trading duration' | — |
| 1 | 1 | 3 | confluence:1 | 'trading duration limit' | — |
| 1 | 1 | 3 | confluence:1 | 'trading session duration' | — |
| 1 | 1 | 3 | confluence:1 | 'trading session end' | — |
| 1 | 1 | 3 | confluence:1 | 'trading session start' | — |
| 1 | 1 | 3 | confluence:1 | 'trading session start time' | — |
| 1 | 1 | 3 | spine:1 | 'trading session time' | — |
| 1 | 1 | 3 | spine:1 | 'us session trading' | — |

### `C3_unrecognized_vocab_EXISTING_primitive` — 41 refusals · 24 videos · 72 strategies

**Resolution path.** Indicator / structure vocabulary whose primitive ALREADY EXISTS and is simply not routed from the binder. Resolution = a binding route, not a detector build.

**Default confidence for this class: HIGH.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 2 | 2 | 6 | confluence:1/spine:1 | 'moving averages' | indicators/core.py:22 `compute_sma` · :27 `compute_ema` — both exist; 0 refs from `spec_family_bindings.py` |
| 1 | 1 | 3 | spine:1 | '15 minute crt range' | — |
| 1 | 1 | 3 | confluence:1 | '20 ma intraday time frame' | indicators/core.py:22 `compute_sma` |
| 1 | 1 | 3 | confluence:1 | '200 ma daily time frame' | indicators/core.py:22 `compute_sma` + HTF basis (C1 dependency) |
| 1 | 1 | 3 | confluence:1 | 'alerts all trend lines' | — |
| 1 | 1 | 3 | confluence:1 | 'breakout' | — |
| 1 | 1 | 3 | confluence:1 | 'breakout trading' | — |
| 1 | 1 | 3 | spine:1 | 'candlestick count' | — |
| 1 | 1 | 3 | spine:1 | 'currency pairs and major levels structure' | — |
| 1 | 1 | 3 | confluence:1 | 'daily bias' | — |
| 1 | 1 | 3 | confluence:1 | 'daily bias development' | — |
| 1 | 1 | 3 | spine:1 | 'daily chart structure levels' | — |
| 1 | 1 | 3 | spine:1 | 'ema or exponential moving average' | indicators/core.py:27 `compute_ema` (4 refs in spec_condition_compiler.py — partially routed) |
| 1 | 1 | 3 | spine:1 | 'first crt day' | — |
| 1 | 1 | 3 | spine:1 | 'fractal' | — |
| 1 | 1 | 3 | confluence:1 | 'gap down little bit' | — |
| 1 | 1 | 3 | confluence:1 | 'go to indicators' | — |
| 1 | 1 | 3 | confluence:1 | 'higher time frame trend line' | — |
| 1 | 1 | 3 | confluence:1 | 'htf power 3 indicator' | — |
| 1 | 1 | 3 | spine:1 | 'indicators' | — |
| 1 | 1 | 3 | spine:1 | 'liquidity context' | context/structure_engine.py:261 `compute_structure_state` |
| 1 | 1 | 3 | confluence:1 | 'liquidity taken out' | context/structure_engine.py:261 `compute_structure_state` (liquidity sweep) |
| 1 | 1 | 3 | confluence:1 | 'market condition' | — |
| 1 | 1 | 3 | confluence:1 | 'market direction' | — |
| 1 | 1 | 3 | spine:1 | 'market structure' | context/structure_engine.py:261 `compute_structure_state` |
| 1 | 1 | 3 | confluence:1 | 'market trend' | — |
| 1 | 1 | 3 | spine:1 | 'mnq market trend' | — |
| 1 | 1 | 3 | confluence:1 | 'price open' | — |
| 1 | 1 | 3 | confluence:1 | 'price open 9 30 and move higher' | — |
| 1 | 1 | 3 | spine:1 | 'price to break' | — |
| 1 | 1 | 3 | confluence:1 | 'range activity' | — |
| 1 | 1 | 3 | confluence:1 | 'sma effectiveness' | indicators/core.py:22 `compute_sma` |
| 1 | 1 | 3 | confluence:1 | 'smas' | indicators/core.py:22 `compute_sma` — exists; 0 refs from the binder |
| 1 | 1 | 3 | confluence:1 | 'smt analysis' | — |
| 1 | 1 | 3 | confluence:1 | 'uptrend' | — |
| 1 | 1 | 3 | spine:1 | 'uptrend nasdaq' | — |
| 1 | 1 | 3 | confluence:1 | 'volatility' | — |
| 1 | 1 | 3 | spine:1 | 'volume indicator' | volume series exists on the bar frame; needs a binding route |
| 1 | 1 | 3 | spine:1 | 'vwap trading blueprint' | indicators/core.py:271 `compute_vwap_with_bands` · :379 `compute_anchored_vwap` — exist; 0 refs from either binder file |
| 1 | 1 | 3 | spine:1 | 'yesterday s price action' | — |

### `C4_new_vocab_ontology_work` — 18 refusals · 11 videos · 33 strategies

**Resolution path.** Genuinely new vocabulary (news-calendar events, participation/activity abstractions). Needs ontology work and in several cases an external data feed the engine does not have.

**Default confidence for this class: LOW.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 3 | 3 | 9 | confluence:2/spine:1 | 'market activity' | — |
| 2 | 2 | 6 | confluence:1/spine:1 | 'trading activity' | — |
| 1 | 1 | 3 | confluence:1 | 'acceptance window' | — |
| 1 | 1 | 3 | confluence:1 | 'alternative activation' | — |
| 1 | 1 | 3 | spine:1 | 'event occurrence' | — |
| 1 | 1 | 3 | spine:1 | 'immediate market action from current position' | — |
| 1 | 1 | 3 | confluence:1 | 'information events' | — |
| 1 | 1 | 3 | confluence:1 | 'institutional participation' | — |
| 1 | 1 | 3 | confluence:1 | 'irs components' | — |
| 1 | 1 | 3 | confluence:1 | 'major news drops' | — |
| 1 | 1 | 3 | confluence:1 | 'nonfarm payroll event' | — |
| 1 | 1 | 3 | confluence:1 | 'purge period' | — |
| 1 | 1 | 3 | confluence:1 | 'purge timing' | — |
| 1 | 1 | 3 | confluence:1 | 'similarity context' | — |
| 1 | 1 | 3 | confluence:1 | 'us retail sales report' | — |

### `C5_unsupported_temporal_or_control_flow` — 12 refusals · 10 videos · 30 strategies

**Resolution path.** RESET / EXCEPTION semantics — state-machine control flow the compiler does not support. Resolution is compiler work, not vocabulary.

**Default confidence for this class: MEDIUM.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 1 | 1 | 3 | invalidation:1 | 'all levels' | — |
| 1 | 1 | 3 | invalidation:1 | 'bias smas' | indicators/core.py:22 `compute_sma` |
| 1 | 1 | 3 | invalidation:1 | 'daily loss limit' | — |
| 1 | 1 | 3 | invalidation:1 | 'decision process' | — |
| 1 | 1 | 3 | invalidation:1 | 'mechanism applicability' | — |
| 1 | 1 | 3 | invalidation:1 | 'price action before one hour candlestick close outside zone' | — |
| 1 | 1 | 3 | invalidation:1 | 'so similarly we' | — |
| 1 | 1 | 3 | invalidation:1 | 'state' | — |
| 1 | 1 | 3 | invalidation:1 | 'stop placement' | — |
| 1 | 1 | 3 | invalidation:1 | 'stop placement relative to 21 ema closures' | — |
| 1 | 1 | 3 | invalidation:1 | 'trade outcome' | — |
| 1 | 1 | 3 | invalidation:1 | 'trailing stop adjustment' | — |

### `C6_unknown_requiredness` — 6 refusals · 6 videos · 18 strategies

**Resolution path.** role=`trigger`, class UNKNOWN_REQUIREDNESS. Blocked from promotion by R-423's four pinned conditions; frequency is explicitly disqualified as evidence.

**Default confidence for this class: HIGH.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 1 | 1 | 3 | trigger:1 | 'entry chart timeframe' | — |
| 1 | 1 | 3 | trigger:1 | 'entry refinement via lower time frames' | — |
| 1 | 1 | 3 | trigger:1 | 'hourly buy limit order refinement' | — |
| 1 | 1 | 3 | trigger:1 | 'market entry time' | — |
| 1 | 1 | 3 | trigger:1 | 'time and price entry exit logging' | — |
| 1 | 1 | 3 | trigger:1 | 'timeframe change or aggressive entry' | — |

### `C7_malformed_extraction` — 30 refusals · 15 videos · 45 strategies

**Resolution path.** Extraction damage: garbled tokens, raw transcript fragments, and — the recurring mechanical defect — clock strings whose AM/PM marker was destroyed by normalization. Resolution is extraction-side; no binder change can recover information the artifact no longer contains.

**Default confidence for this class: HIGH.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 2 | 2 | 6 | confluence:2 | 'fiveinut time frame' | — |
| 1 | 1 | 3 | confluence:1 | `''` (EMPTY STRING) | — |
| 1 | 1 | 3 | confluence:1 | '10 00 m candle' | — |
| 1 | 1 | 3 | confluence:1 | '10 00 m eastern' | — |
| 1 | 1 | 3 | confluence:1 | '15minut time frame' | — |
| 1 | 1 | 3 | spine:1 | '2' | — |
| 1 | 1 | 3 | confluence:1 | '4h hour time frame candle' | — |
| 1 | 1 | 3 | spine:1 | '4hour candle turtle' | — |
| 1 | 1 | 3 | spine:1 | '5m up' | — |
| 1 | 1 | 3 | spine:1 | '5minut time frame' | — |
| 1 | 1 | 3 | confluence:1 | '6' | — |
| 1 | 1 | 3 | confluence:1 | '9 30 m eastern standard time' | — |
| 1 | 1 | 3 | spine:1 | 'accuracy don t trade h forhead big news releases should be one cardinal rules anew york regardless what it is' | — |
| 1 | 1 | 3 | spine:1 | 'anew york time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'end' | — |
| 1 | 1 | 3 | confluence:1 | 'gpcat' | — |
| 1 | 1 | 3 | spine:1 | 'gu' | — |
| 1 | 1 | 3 | confluence:1 | 'htf bar three by 2' | — |
| 1 | 1 | 3 | spine:1 | 'm eastern standard time' | — |
| 1 | 1 | 3 | confluence:1 | 'm eastern standard time 15 minute time frame' | — |
| 1 | 1 | 3 | spine:1 | 'now just like with 1 minute i am looking to get triggered in fairly quickly with one' | — |
| 1 | 1 | 3 | confluence:1 | 'opening price at 10 00 m' | — |
| 1 | 1 | 3 | spine:1 | 'pd race 5m or 50m' | — |
| 1 | 1 | 3 | spine:1 | 'qq' | — |
| 1 | 1 | 3 | confluence:1 | 'start up' | — |
| 1 | 1 | 3 | spine:1 | 'time 10 00 m' | — |
| 1 | 1 | 3 | confluence:1 | 'trading euro dollar pound dollar dollan and q' | — |
| 1 | 1 | 3 | confluence:1 | 'two minut' | — |
| 1 | 1 | 3 | confluence:1 | 'vwop' | MALFORMED transcription of VWAP — same primitive, unreachable until extraction is repaired |

### `C8_non_executable_annotation_mistyped` — 233 refusals · 37 videos · 111 strategies

**Resolution path.** Not a market condition at all: chart-resolution declarations, instrument/symbol selection, platform-workflow commentary. Resolution = do not emit these as `entry_conditions`; they are strategy PARAMETERS or narration.

**Default confidence for this class: HIGH.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 28 | 28 | 84 | confluence:17/spine:11 | 'timeframe' | — |
| 15 | 15 | 45 | confluence:10/spine:5 | 'time frame' | — |
| 9 | 9 | 27 | confluence:7/spine:2 | 'timeframe selection' | — |
| 4 | 4 | 12 | spine:3/confluence:1 | 'daily time frame' | — |
| 3 | 3 | 9 | spine:2/confluence:1 | 'chart timeframe' | — |
| 3 | 3 | 9 | confluence:3 | 'timeframe hierarchy' | — |
| 2 | 2 | 6 | confluence:2 | '15 minute time frame' | — |
| 2 | 2 | 6 | confluence:2 | '4 hour time frame' | — |
| 2 | 2 | 6 | spine:1/confluence:1 | '4hour time frame' | — |
| 2 | 2 | 6 | confluence:1/spine:1 | '5 minute chart' | — |
| 2 | 2 | 6 | confluence:2 | 'es' | — |
| 2 | 2 | 6 | spine:1/confluence:1 | 'higher time frame' | — |
| 2 | 2 | 6 | confluence:1/spine:1 | 'lower time frame' | — |
| 2 | 2 | 6 | confluence:2 | 'nq' | — |
| 2 | 2 | 6 | spine:1/confluence:1 | 'time frame context' | — |
| 2 | 2 | 6 | confluence:1/spine:1 | 'time frame selection' | — |
| 2 | 2 | 6 | spine:1/confluence:1 | 'timeframe hierarchy check' | — |
| 1 | 1 | 3 | confluence:1 | '1 hour chart' | — |
| 1 | 1 | 3 | confluence:1 | '1 hour time frame' | — |
| 1 | 1 | 3 | confluence:1 | '15 minute time frame buying opportunities' | — |
| 1 | 1 | 3 | confluence:1 | '15 minute timeframe' | — |
| 1 | 1 | 3 | confluence:1 | '30 minute time frame' | — |
| 1 | 1 | 3 | spine:1 | '4 hour chart' | — |
| 1 | 1 | 3 | confluence:1 | '4 hour chart trading using 5 sma' | — |
| 1 | 1 | 3 | confluence:1 | '4 hour timeframe analysis' | — |
| 1 | 1 | 3 | confluence:1 | '4hour chart' | — |
| 1 | 1 | 3 | confluence:1 | '4hour time frame zone refinement' | — |
| 1 | 1 | 3 | spine:1 | '5 minute time frame' | — |
| 1 | 1 | 3 | confluence:1 | '50 minute time frame' | — |
| 1 | 1 | 3 | spine:1 | '<no executable spine predicate in this spec>' | — |
| 1 | 1 | 3 | confluence:1 | 'alert' | — |
| 1 | 1 | 3 | confluence:1 | 'alert trigger' | — |
| 1 | 1 | 3 | spine:1 | 'analysis' | — |
| 1 | 1 | 3 | confluence:1 | 'analysis direction' | — |
| 1 | 1 | 3 | spine:1 | 'application context change' | — |
| 1 | 1 | 3 | confluence:1 | 'april' | — |
| 1 | 1 | 3 | confluence:1 | 'asset' | — |
| 1 | 1 | 3 | confluence:1 | 'asset class' | — |
| 1 | 1 | 3 | confluence:1 | 'canada swiss trade continuation opportunity' | — |
| 1 | 1 | 3 | confluence:1 | 'capital amount' | — |
| 1 | 1 | 3 | confluence:1 | 'capital amount used simulation' | — |
| 1 | 1 | 3 | confluence:1 | 'chart' | — |
| 1 | 1 | 3 | confluence:1 | 'chart cleanliness range reduction' | — |
| 1 | 1 | 3 | confluence:1 | 'chart context' | — |
| 1 | 1 | 3 | confluence:1 | 'chart selection' | — |
| 1 | 1 | 3 | confluence:1 | 'charts' | — |
| 1 | 1 | 3 | confluence:1 | 'charts start here' | — |
| 1 | 1 | 3 | confluence:1 | 'choose time frame 4 hours' | — |
| 1 | 1 | 3 | confluence:1 | 'confluences' | — |
| 1 | 1 | 3 | confluence:1 | 'copper' | — |
| 1 | 1 | 3 | confluence:1 | 'crude oil' | — |
| 1 | 1 | 3 | spine:1 | 'crude oil trading context' | — |
| 1 | 1 | 3 | spine:1 | 'currency pair' | — |
| 1 | 1 | 3 | spine:1 | 'currency pairs' | — |
| 1 | 1 | 3 | confluence:1 | 'current chart time frame' | — |
| 1 | 1 | 3 | spine:1 | 'daily chart' | — |
| 1 | 1 | 3 | confluence:1 | 'daily time frame analysis' | — |
| 1 | 1 | 3 | confluence:1 | 'data collection' | — |
| 1 | 1 | 3 | confluence:1 | 'date selection' | — |
| 1 | 1 | 3 | confluence:1 | 'designated time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'es indices' | — |
| 1 | 1 | 3 | spine:1 | 'ethereum' | — |
| 1 | 1 | 3 | spine:1 | 'eur usd' | — |
| 1 | 1 | 3 | spine:1 | 'euro aussie daily chart' | — |
| 1 | 1 | 3 | spine:1 | 'execution four hour chart' | — |
| 1 | 1 | 3 | confluence:1 | 'execution mode' | — |
| 1 | 1 | 3 | confluence:1 | 'execution time frame' | — |
| 1 | 1 | 3 | spine:1 | 'five minute time frame' | — |
| 1 | 1 | 3 | spine:1 | 'fiveminute time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'focus' | — |
| 1 | 1 | 3 | confluence:1 | 'focus one thing' | — |
| 1 | 1 | 3 | spine:1 | 'focus scope' | — |
| 1 | 1 | 3 | spine:1 | 'four hour chart' | — |
| 1 | 1 | 3 | confluence:1 | 'gbp aud' | — |
| 1 | 1 | 3 | confluence:1 | 'higher time frame alignment' | — |
| 1 | 1 | 3 | spine:1 | 'higher time frames' | — |
| 1 | 1 | 3 | confluence:1 | 'indicator time frame setting' | — |
| 1 | 1 | 3 | confluence:1 | 'instrument' | — |
| 1 | 1 | 3 | confluence:1 | 'instrument selection' | — |
| 1 | 1 | 3 | confluence:1 | 'intraday time frame' | — |
| 1 | 1 | 3 | spine:1 | 'intraday time frames' | — |
| 1 | 1 | 3 | spine:1 | 'live account trading' | — |
| 1 | 1 | 3 | spine:1 | 'live trading access' | — |
| 1 | 1 | 3 | spine:1 | 'lower time frame entries' | — |
| 1 | 1 | 3 | spine:1 | 'lower time frame movement' | — |
| 1 | 1 | 3 | confluence:1 | 'm1 timeframe is not noise' | — |
| 1 | 1 | 3 | confluence:1 | 'market applicability' | — |
| 1 | 1 | 3 | confluence:1 | 'market open time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'may 5th 2026' | — |
| 1 | 1 | 3 | spine:1 | 'mnq' | — |
| 1 | 1 | 3 | confluence:1 | 'monthly timeframe' | — |
| 1 | 1 | 3 | confluence:1 | 'monthly timeframe analysis' | — |
| 1 | 1 | 3 | spine:1 | 'monthly timeframe chart' | — |
| 1 | 1 | 3 | confluence:1 | 'multi timeframe analysis' | — |
| 1 | 1 | 3 | confluence:1 | 'nasdaq' | — |
| 1 | 1 | 3 | confluence:1 | 'nasdaq chart' | — |
| 1 | 1 | 3 | confluence:1 | 'nasdaq futures markets' | — |
| 1 | 1 | 3 | confluence:1 | 'netflix' | — |
| 1 | 1 | 3 | confluence:1 | 'nq futures and gold futures' | — |
| 1 | 1 | 3 | confluence:1 | 'nq gold crude oil' | — |
| 1 | 1 | 3 | spine:1 | 'nq trading' | — |
| 1 | 1 | 3 | confluence:1 | 'nzdusd' | — |
| 1 | 1 | 3 | spine:1 | 'oil' | — |
| 1 | 1 | 3 | spine:1 | 'one day time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'platinum' | — |
| 1 | 1 | 3 | confluence:1 | 'pound dollar pair' | — |
| 1 | 1 | 3 | confluence:1 | 'price breaking down to fiveminut time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'primary chart timeframe' | — |
| 1 | 1 | 3 | spine:1 | 'process repetition' | — |
| 1 | 1 | 3 | spine:1 | 's p 500' | — |
| 1 | 1 | 3 | confluence:1 | 'scale down to low time frames' | — |
| 1 | 1 | 3 | confluence:1 | 'session creation' | — |
| 1 | 1 | 3 | confluence:1 | 'spy' | — |
| 1 | 1 | 3 | confluence:1 | 'symbol selection' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame applicability' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame offset' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame pairing' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame progression' | — |
| 1 | 1 | 3 | spine:1 | 'time frame requirement' | — |
| 1 | 1 | 3 | spine:1 | 'time frame scaling' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame size' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame structure' | — |
| 1 | 1 | 3 | spine:1 | 'time frame switch' | — |
| 1 | 1 | 3 | spine:1 | 'time frame transition' | — |
| 1 | 1 | 3 | confluence:1 | 'time frame usage' | — |
| 1 | 1 | 3 | spine:1 | 'time frame zoom' | — |
| 1 | 1 | 3 | confluence:1 | 'time frames' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe and date' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe applicability' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe clarity' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe context' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe dependency 5m' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe hierarchy 4h 1h or 30m' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe hierarchy daily 4h' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe hierarchy daily 4h 1h' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe interchangeability' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe observation' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe selection process' | — |
| 1 | 1 | 3 | spine:1 | 'timeframe set' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe step 1' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe step 2' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe step 3' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe structure' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframe transition' | — |
| 1 | 1 | 3 | confluence:1 | 'timeframes' | — |
| 1 | 1 | 3 | confluence:1 | 'top down analysis' | — |
| 1 | 1 | 3 | spine:1 | 'top or bottom tick account' | — |
| 1 | 1 | 3 | spine:1 | 'trade analysis session start' | — |
| 1 | 1 | 3 | spine:1 | 'trade execution context' | — |
| 1 | 1 | 3 | spine:1 | 'trading asset' | — |
| 1 | 1 | 3 | confluence:1 | 'trading candle selection' | — |
| 1 | 1 | 3 | confluence:1 | 'trading context' | — |
| 1 | 1 | 3 | confluence:1 | 'trading frequency' | — |
| 1 | 1 | 3 | spine:1 | 'trading instrument' | — |
| 1 | 1 | 3 | spine:1 | 'trading instrument and timeframe' | — |
| 1 | 1 | 3 | confluence:1 | 'trading location focus' | — |
| 1 | 1 | 3 | confluence:1 | 'trading market' | — |
| 1 | 1 | 3 | spine:1 | 'trading pair selection' | — |
| 1 | 1 | 3 | confluence:1 | 'trading panel selected' | — |
| 1 | 1 | 3 | confluence:1 | 'trading style' | — |
| 1 | 1 | 3 | confluence:1 | 'trading style timeframe' | — |
| 1 | 1 | 3 | spine:1 | 'trading timeframe' | — |
| 1 | 1 | 3 | confluence:1 | 'trading view location' | — |
| 1 | 1 | 3 | spine:1 | 'usd jpy' | — |
| 1 | 1 | 3 | confluence:1 | 'weekly time frame' | — |
| 1 | 1 | 3 | confluence:1 | 'when i was looking to take oil short' | — |

### `C9_RESIDUAL_none_of_these` — 3 refusals · 3 videos · 9 strategies

**Resolution path.** RESIDUAL — the mandatory none-of-these bucket. Each member is named individually below.

**Default confidence for this class: LOW.**

| n | vid | strat | roles | term (extractor-normalized; NOT the teacher's words) | specific resolution |
|---:|---:|---:|---|---|---|
| 1 | 1 | 3 | confluence:1 | 'market hours and fundamentals alignment' | — |
| 1 | 1 | 3 | confluence:1 | 'trading within range full day' | — |
| 1 | 1 | 3 | spine:1 | 'wait cleaner opportunity following day' | — |


---

## APPENDIX — THE CLASSIFIER, VERBATIM

The class assignment is JUDGMENT, not measurement. The mechanical pass below NOMINATED; every
bucket was then read and hand-corrected via `OVERRIDE`. It is published in full so the advisor can
re-execute it against the census and dispute any single assignment.

```python
"""Remediation classification over POP-120-LIVE refusals, per-video basis.

ORDERED RULES — mechanical layer NOMINATES; every bucket was then READ and
hand-corrected via OVERRIDE below. Published in full so the advisor can re-execute.
"""
import json, os, re
from collections import Counter, defaultdict

d = json.load(open(os.environ["CENSUS_OUT"], encoding="utf-8"))
S = d["strategies"]
byvid = defaultdict(list)
for s in S:
    byvid[s.get("video")].append(s)
reps = [rows[0] for rows in byvid.values()]

C1 = "C1_known_concept_missing_primitive"
C2 = "C2_recognized_session_missing_clock"
C3 = "C3_unrecognized_vocab_EXISTING_primitive"
C4 = "C4_new_vocab_ontology_work"
C5 = "C5_unsupported_temporal_or_control_flow"
C6 = "C6_unknown_requiredness"
C7 = "C7_malformed_extraction"
C8 = "C8_non_executable_annotation_mistyped"
C9 = "C9_RESIDUAL_none_of_these"

# --- hand overrides applied FIRST (exact text match) -------------------------
OVERRIDE = {
    # raw transcript fragments / garbled tokens / destroyed am-pm markers
    "": C7, "6": C7, "2": C7, "gpcat": C7, "vwop": C7, "gu": C7, "qq": C7,
    "fiveinut time frame": C7, "15minut time frame": C7, "5minut time frame": C7,
    "two minut": C7, "anew york time frame": C7, "4h hour time frame candle": C7,
    "pd race 5m or 50m": C7, "htf bar three by 2": C7, "4hour candle turtle": C7,
    "m eastern standard time": C7, "9 30 m eastern standard time": C7,
    "10 00 m eastern": C7, "opening price at 10 00 m": C7, "time 10 00 m": C7,
    "10 00 m candle": C7, "m eastern standard time 15 minute time frame": C7,
    "trading euro dollar pound dollar dollan and q": C7,
    "so similarly we": C7, "end": C7, "start up": C7, "5m up": C7,
    # genuine session vocabulary (intact), zone- or clock-shaped
    "market open": C2, "new york session": C2, "trading session": C2,
    "trading hours": C2, "session": C2, "9 30": C2, "9 30 open": C2,
    "new york open": C2, "new york open time zone": C2, "new york session start": C2,
    "market open time": C2, "market opening up": C2, "stock market open": C2,
    "stock market opens at 9 30": C2, "session start": C2, "session start time": C2,
    "trading session start": C2, "trading session end": C2, "trading session time": C2,
    "trading session start time": C2, "start trading session period": C2,
    "trading window": C2, "time window": C2, "trading time": C2, "time day": C2,
    "market hours": C2, "market hours availability": C2, "extended hours": C2,
    "outside regular trading hours": C2, "first hour": C2, "first hour trading": C2,
    "first 15 minutes open": C2, "asia trading session": C2, "london trading session": C2,
    "new york trading session": C2, "nasdaq session": C2, "us session trading": C2,
    "next session": C2, "other sessions": C2, "previous few sessions": C2,
    "pre new york period": C2, "pre new york open session": C2, "timezone": C2,
    "time zones": C2, "6 00 p m": C2, "eastern standard time to 5 00 p m": C2,
    "time until 2 00": C2, "6 00 to 10 00 candle": C2, "5 00 candle": C2,
    "trading day start time": C2, "market close time day": C2, "trading session duration": C2,
    "banks start trading": C2, "asian session profitability": C2, "search start time": C2,
    "preparation time": C2, "market open duration": C2, "time": C2, "time duration": C2,
    "trading duration": C2, "trading duration limit": C2, "time delay": C2,
    "first 30 minutes high": C1, "930 candle": C1, "930": C1,
    # existing-primitive vocabulary
    "moving averages": C3, "ema or exponential moving average": C3, "smas": C3,
    "sma effectiveness": C3, "bias smas": C3, "200 ma daily time frame": C3,
    "20 ma intraday time frame": C3, "volume indicator": C3, "indicators": C3,
    "go to indicators": C3, "vwap trading blueprint": C3, "pre market vwap analysis routine": C3,
    "market structure": C3, "liquidity taken out": C3, "liquidity context": C3,
    "uptrend": C3, "uptrend nasdaq": C3, "market trend": C3, "mnq market trend": C3,
    "breakout": C3, "breakout trading": C3, "fractal": C3, "daily bias": C3,
    "daily bias development": C3, "price to break": C3, "yesterday s price action": C3,
    "price open": C3, "price open 9 30 and move higher": C3, "gap down little bit": C3,
    "smt analysis": C3, "htf power 3 indicator": C3, "market direction": C3,
    "market condition": C3, "volatility": C3, "range activity": C3,
    "15 minute crt range": C3, "first crt day": C3, "candlestick count": C3,
    "daily chart structure levels": C3, "currency pairs and major levels structure": C3,
    "higher time frame trend line": C3, "alerts all trend lines": C3,
    # HTF bar-boundary events: concept clear, no executable primitive
    "4 hour candle": C1, "new 4 hour candle open": C1, "new 4 hour candle opens": C1,
    "4 hour candle structure": C1, "4 hour candle period": C1, "daily candle": C1,
    "hourly candle close": C1, "candle close larger time frame": C1,
    "candle open times": C1, "candle start": C1, "new candle start time": C1,
    "open next candle": C1, "4hour candle structure open high low close": C1,
    "4 hour time frame candlestick formation and closure": C1,
    "fx candle open time adjustment": C1, "specific candle open time futures": C1,
    "4hour order clock": C1, "price action before one hour candlestick close outside zone": C1,
    # news / event ontology
    "major news drops": C4, "nonfarm payroll event": C4, "us retail sales report": C4,
    "information events": C4, "institutional participation": C4, "event occurrence": C4,
    "market activity": C4, "trading activity": C4, "purge period": C4, "purge timing": C4,
    "acceptance window": C4, "alternative activation": C4, "irs components": C4,
    "immediate market action from current position": C4, "similarity context": C4,
}

INSTRUMENT = {
    "nq", "es", "mnq", "oil", "crude oil", "spy", "netflix", "ethereum", "copper",
    "platinum", "eur usd", "usd jpy", "gbp aud", "nzdusd", "currency pair",
    "currency pairs", "asset", "asset class", "instrument", "instrument selection",
    "symbol selection", "s p 500", "nasdaq", "nasdaq chart", "nasdaq futures markets",
    "es indices", "nq trading", "nq futures and gold futures", "nq gold crude oil",
    "trading pair selection", "trading instrument", "trading instrument and timeframe",
    "trading asset", "trading market", "trading location focus", "market applicability",
    "euro aussie daily chart", "pound dollar pair", "crude oil trading context",
    "when i was looking to take oil short", "canada swiss trade continuation opportunity",
}

TF_RE = re.compile(r"time ?frames?|timeframes?|\bchart\b|charts|\bhtf\b|hour chart|minute chart")
ANNOT_RE = re.compile(
    r"selection|context|focus|analysis|process|logging|collection|panel|location|"
    r"account|capital|style|frequency|applicability|hierarchy|step \d|progression|"
    r"scaling|zoom|offset|pairing|interchangeability|observation|clarity|usage|size|"
    r"requirement|dependency|set$|switch|transition|structure$|alert|date|april|may |"
    r"session creation|start here|live |execution mode|top or bottom|cleanliness|"
    r"data |repetition|duration$|scope|one thing|confluences|components|mode$"
)


def classify(rule_text: str, rule_class: str, reason: str, semantic_type: str) -> str:
    t = rule_text.strip().lower()
    if rule_class == "UNKNOWN_REQUIREDNESS":
        return C6
    if semantic_type in ("RESET", "EXCEPTION"):
        return C5
    if reason.startswith("session_zone_refused_uncomputable_window"):
        return C2
    if reason == "non_executable_empty_spine":
        return C8
    if t in OVERRIDE:
        return OVERRIDE[t]
    if t in INSTRUMENT:
        return C8
    if len(t) > 60:
        return C7
    if TF_RE.search(t):
        return C8
    if ANNOT_RE.search(t):
        return C8
    return C9


rows = []
for s in reps:
    for r in s["refusals"]:
        rows.append((s, r, classify(r["rule_text"], r["rule_class"], r["reason"], r["semantic_type"])))

print("=== PER-VIDEO refusals by remediation class (n=%d over 40 videos) ===" % len(rows))
cc = Counter(c for _, _, c in rows)
for c in [C1, C2, C3, C4, C5, C6, C7, C8, C9]:
    n = cc.get(c, 0)
    vids = len({s.get("video") for s, _, cl in rows if cl == c})
    print(f"{c:45s} {n:4d}  ({n*100.0/len(rows):4.1f}%)  videos={vids:2d}  strategies={vids*3}")

for c in [C9, C1, C4, C7, C2, C3]:
    mem = Counter(r["rule_text"] for _, r, cl in rows if cl == c)
    print(f"\n--- {c}  ({sum(mem.values())} refusals, {len(mem)} distinct) ---")
    for t, n in mem.most_common(200 if c == C9 else 60):
        print(f"   {n:3d} | {t!r}")

json.dump([{"video": s.get("video"), "strategy_id": s["strategy_id"], **r, "remediation_class": cl}
           for s, r, cl in rows], open(os.environ["CLASS_OUT"], "w", encoding="utf-8"), indent=1)
```
