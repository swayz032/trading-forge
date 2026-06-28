# Trading Forge — Project Conventions

> Living rules for operating the system. Historical build journal lives in `AGENT-LOGS.md`. Architecture detail lives in `Trading Forge System Map v2.md`.

> **File recovery note (W23F.N 2026-05-19):** This file was reconstructed after corruption at mtime 02:57:49 (45KB → 45KB of null bytes). Reconstruction sources: conversation session-reminder snapshots + Wave 23 + W23F.N updates. If a section appears thinner than you remember, that's why — flag drift and reinstate from your memory.

---

## §1. Mission

Trading Forge is a production-grade, family-distributable futures trading bot infrastructure. Operator (swayz032) and family members each run independent bots on independent prop firm accounts.

**Target:** scale ONE robustly-validated strategy (avg-R ≥ 2.0R, PF ≥ 1.7, deflated Sharpe ≥ 1.5, max 1-2 A+ trades/day) from a $250/day baseline to **$1,000–5,000+/day** via four scaling levers. Win rate is an OBSERVED output metric — never a target, never a gate, never specified as a band.

1. **Contract pyramid** — single account, profit-tier scaling on one strategy (base 9 MES / 9 MNQ / 18 MCL → risk-cap-bounded ceiling, 50-micro final cap; +3 per tier via proven-trades ramp live / +$3K dollar fallback in backtests). Growth is primarily HORIZONTAL (multiple Topstep accounts + copy-trade), not maxing one account — see `docs/scaling-plan-baby-mode.md`.
2. **Multi-account same firm** — Topstep allows multiple accounts per user (single TopstepX subscription covers all)
3. **Multi-firm parallel** — Topstep + MFFU running DIFFERENT strategies per firm (MFFU collaborative-trading compliance)
4. **Family copy distribution** — each family member runs a DIFFERENT DEPLOYED strategy on their own TradingView + TradersPost + own MFFU/Topstep account

Agents must never fake profitability. The gates decide.

---

## §2. Current Phase: Production Hardening ONLY

**Wave 24 CLOSED 2026-05-23 — 23 of 24 backlog items shipped (95.8%).** Item #24 (HVN-snap TP2 + crypto-grade audit-log hash chain) deferred as optional Wave 25 candidate. 182 vitest tests across 19 `wave24-*.test.ts` files GREEN. All 3 CI hard gates GREEN (system-map:check, production-isolation, 2026-compliance). Migrations `0131_operator_absent_pending.sql` + `0132_hmm_regime_overlay.sql` applied. See `Trading Forge System Map v2.md` §2d for the full close-out registry.

**Wave 25 active 2026-05-23 onward — institutional confluence + adaptive exit engine.** NOT a new subsystem; replaces retail-shaped Stage 2 boolean voting with weighted probabilistic scoring (Path C, `confluence-score.ts`) + independent Structure Engine (`structure_engine.py`, BOS/CHoCH/MSS/PD-zone) + first-class killzone helper (`killzone.ts`). Pass 1 shipped 2026-05-24 (migrations 0134 + 0135 idempotent, default OFF, backward-compat preserved). Production hardening continues in parallel — see plan `floating-yawning-lantern.md`.

**Wave 25 Pass 2 CLOSED 2026-05-24 — institutional-grade hardening pass.** 9 of 13 Phase B backlog items shipped (69%); 4 explicitly deferred (Inst-7 TopstepX migration pending operator account opening, Inst-9 Bagged CPCV optional enhancement, Wave 25 candidate #24 over-engineered for current scale, A-4 in-memory dedup accepted trade-off). 50 new tests across 5 vitest + 2 pytest files (23+14+13 by worker). 2 cross-audit false-positives caught: journal idx=137 collision (no collision) and computeRiskDerivedContracts zero-callers (has callers). All 3 CI hard gates GREEN. New env vars: DRAWDOWN_ROOM_RISK_PCT (default 0.01). New scheduled jobs: n8n-drift-detector-weekly, n8n-drift-detector-monthly. See AGENT-LOGS Wave 25 Pass 2 master-orchestration entry.

**Wave 25 Pass 2 (5-TF + HTF narrative) CLOSED 2026-05-24** — separate from the hardening track. 5-TF MTF expansion (`load_n_timeframes()` + `compute_multi_htf_indicators()` + `join_n_timeframes_to_exec()` in `src/engine/data_loader.py` + `src/engine/indicators/core.py` + `src/engine/indicators/mtf_join.py`) + HTF narrative state (`compute_htf_narrative()` with AsianRange/LondonBias/NYBias/DailyDealing dataclasses in `src/engine/context/htf_narrative.py`). Migrations 0137 (`bias_state.htf_narrative` JSONB, idx 139) + 0138 (`strategies.{daily_tf,htf_tf,itf_tf,trigger_tf}` TEXT columns, idx 140). 56 Python + 27 TS tests GREEN. Audit event `bias_engine.htf_narrative_computed`. New subsystems registered: `5tf_mtf_engine` + `htf_narrative_engine`. DSL compiler extended from single-TF (`bias_timeframe`) AND-gating to N-TF AND-gating. Backward-compat: strategies with no new TF columns continue 2-TF operation (exec + daily) identically to pre-Pass-2 behavior. Cross-pass producers for Pass 2.5 (pre-market reads all TFs), Pass 5 (multi-TF VWAP), Pass 6 (HtfNarrative extended with A/M/E phase tracking — parallel field, NOT piggyback), Pass 7 (regime + daily_dealing for runner-trail).

**Wave 25 Pass 3 (Persistent Liquidity Map Engine) CLOSED 2026-05-24** — `liquidity_levels` table (17 level_types: PDH/PDL/PWH_ISO/PWL_ISO/PMH/PML/Asian/London/HOD/LOD/naked_poc/untouched_fvg/untouched_ob/EQH/EQL) with sweep_probability heuristic (age decay + touch decay + distance attenuation + HTF significance) + composite rank scoring. New `liquidity-map-service.ts` + `liquidity-map-refresh` cron (30 min RTH, pipeline-gate exempt). Stage 2 `liquidity_target_clear` factor (weight 0.13) transitions from stub to real evaluator — production signal flow now wired via paper-signal-service.ts liquidity injection. Python→TS naked-POC bridge: `extract_naked_pocs_for_persistence()` + daily sync cron at 16:30 ET via `POST /api/admin/liquidity-map/naked-pocs-batch`. Migration 0140 (idx 142). 69+ new tests green. Pass 7 adaptive exits will consume LevelType enum as its TP-target contract. New env var (optional): `LIQUIDITY_MAP_BATCH_SECRET` — shared-secret header check on the naked-POCs-batch endpoint when set. New subsystems registered: `liquidity_map_service`, `naked_poc_persistence_bridge`.

**Wave 25 Pass 4 (Confluence Decay Engine) CLOSED 2026-05-24** — every confluence carries time-based decay confidence. 7 pure decay functions (FVG/OB/CHoCH/MSS/SMT/VP/generic) with named half-lives (200/150/100/80/60/5sess bars). Mitigated = hard_killed (full decay). Stage 2 weighted scoring multiplies factor contribution by decay confidence — stale CHoCH (240 bars) or touched OB (3+ touches) gets weight cut. Anti-double-decay guard: 5 factors skipped (liquidity_target_clear already touch-decayed in liquidity-map-service; internals_aligned has 5-min staleness; macro/regime/killzone are binary). New audit event `signal.confluence_factor_decayed` (info status) fires when confidence < DECAY_TELEMETRY_THRESHOLD (default 0.7). 113 new tests green (78 pure + 35 Stage 2 wiring incl. 3 audit-wiring contract tests). Closes GPT critique #5 (textbook miss). New subsystem registered: `confluence_decay_engine`. Pure-functional — no Date.now(), no I/O — callers compute age. Pass 5 (VWAP bands + AVWAP + SMT ES↔NQ) must populate `smt_age_bars` + `delta_age_bars` + `vwap_anchor_age_bars` in SignalContext to light up the per-factor decay paths. Pass 7 adaptive exit engine reads `result.decayedFactors[]` to tighten TP on aged confluence.

**Wave 25 Pass 5 (Order Flow Layer: VWAP bands + Anchored VWAP + SMT ES↔NQ) CLOSED 2026-05-24** — VWAP bands (1σ, 2σ) + anchored VWAP via `compute_vwap_with_bands()` + `compute_anchored_vwap()` in `src/engine/indicators/core.py` (session-resetting at 18:00 ET Globex boundary). 2 new DSL archetypes: `vwap_band_reject` + `anchored_vwap_retest`. SMT ES↔NQ divergence via continuous [0,1] score in `src/engine/indicators/smt_divergence.py` (4-component weighted formula: magnitude × time_synced × structure_quality × displacement_confirmation; emits smt_score + smt_direction ∈ {bullish_es_strong, bullish_nq_strong, bearish_es_strong, bearish_nq_strong}). Stage 2 `evalVwapAlignment` REWRITTEN institutional-style (discount/premium model — long satisfied when close below VWAP, short when above — CORRECTS retail "long above VWAP" assumption; 1σ band reject + anchored VWAP retest in priority order); `evalSmtConfirmation` reads continuous smt_score with 0.5 satisfaction threshold; decay engine multiplies smt_age_bars on top. 124 new tests green (63 VWAP + 33 SMT + 28 wiring incl. 5 updated for new VWAP semantics). vwap_alignment + smt_confirmation factors are now LIVE in backtests (no longer stubs). New subsystems registered: `vwap_bands_engine`, `smt_divergence_engine`, `confluence_score_engine` (the latter consolidated entry for Path C Stage 2 11-factor evaluator). New IndicatorConfig.anchor_ts field for per-strategy anchored VWAP. Backward-compat preserved: existing strategies without anchor_ts or vwap_band columns continue to evaluate via fail-open paths. **Live SMT bridge to paper-signal-service.ts DEFERRED to Wave 26** — Python compute_smt_divergence is engine-ready, backtest path fully wired; paper-signal SignalContext does not yet populate ctx.smt_score for live signals (factor continues fail-open with reason='smt_unavailable' — same effective behavior as Pass 1 stub for the live-paper path only). SMT factor contribution = 0.10 weight; losing it temporarily in live paper does not break the institutional architecture. Pass 7 adaptive exits will consume `vwap_band_2s` for runner trail decisions + smt_score for early-exit triggers.

**Wave 25 Pass 6 (Regime 3→5 + Narrative Continuity) CLOSED 2026-05-24** — 4 new regime classifications (EXPANSION/COMPRESSION/HIGH_VOL_MACRO/LOW_LIQ_CHOP) via `classify_institutional_regime()` in bias_engine.py with RegimeEvidence dataclass capturing ATR percentile + volume ratio + range vs ATR + macro event flag + session health. 4 new playbooks (DISPLACEMENT_CONTINUATION/BREAKOUT_PREP/REDUCED_SIZING/NO_TRADE) in playbook_router.py. A/M/E narrative state machine via narrative-state-service.ts: 5-phase NEUTRAL→ACCUMULATION→MANIPULATION→DISTRIBUTION→REVERSAL_FORMING with 5-min RTH cron tracker. Persists in `bias_state.narrative_state` JSONB (migration 0143 idx 145). `evalMarketStructureAligned` extended with `CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE` env gate (default OFF for backward compat — institutional desks only enter during DISTRIBUTION). Migrations 0142 idx 144 (regime_expansion + regime_evidence JSONB) + 0143 idx 145 (narrative_state JSONB). 85 new tests green (61 regime + 17 narrative + 7 regime-evidence persistence). P6.A3+A4 architect close (this pass) wired Python-side `state.regime_evidence` + `state.institutional_regime` into bias-state-service.ts emit shape, persists to `bias_state.regime_evidence` JSONB, and emits new `bias_engine.regime_classified` audit event with full evidence payload + correlation_id per §10b reconstruction mandate. `regime_match` factor STAYS binary (in NO_DECAY_FACTORS) — narrative phase is its OWN env-gated factor, not a decay layer on regime. HtfNarrative 4 sub-dataclasses untouched — narrative_state is a parallel field per Pass 2 contract. New subsystems registered: `institutional_regime_classifier`, `narrative_state_machine`. Closes GPT critique #6 (5-regime) + the "biggest missing concept" (narrative continuity).

**Wave 25 Pass 2.5 (Pre-Market Institutional Expansion) CLOSED 2026-05-24** — 18 new `pre_market_sessions` fields (TICK/ADD/VOLD/TRIN at open, DXY/10Y direction, cross_asset_aligned, bond_auction_today, extended_calendar_events, nearby_naked_pocs, london_range_high/low/points, pmh/pml, pwh_iso/pwl_iso, first_30min_volume_ratio) via migration `0139_pre_market_institutional_expansion.sql` (idx 141). New `market-internals-service.ts` subscribes existing Massive WS (no new vendor — Indices Basic + Stocks Basic tiers already available); singleton cache + 5-min staleness flag + fail-soft when `MASSIVE_API_KEY` unset. Confluence score expanded 9→11 factors with MCL skip rule (`internals_aligned` weight redistributes to `cross_asset_aligned` for crude — final weights still sum to 1.00). New `pre-market-briefing-service.ts` posts daily Discord briefing at 09:00 ET (13:00 UTC) — pipeline-gate exempt (`_PIPELINE_GATE_EXEMPT.add("pre-market-briefing-discord")`), fail-soft, idempotent via W23F.U audit_log dedupe pattern. 206 new tests green (173 paper-parity across 5 suites + 33 observability). Closes "trading without written bias on news days" failure mode per Steenbarger/Topstep 2025 funded-trader survival research. New subsystems registered: `pre_market_institutional_expansion`, `market_internals_service`, `pre_market_briefing_service`. Honest deferrals (Wave 26 candidates): `first_30min_volume_ratio` always null pending 5-day RTH window DAL; `nearby_naked_pocs` uses simplified extraction; live session-start Python doesn't pass `intraday_bars` yet.

**Wave 25 Pass 7 (Adaptive Exit Engine — SCAFFOLD) CLOSED 2026-05-24.** Pure-function `adaptive-exit-engine.ts` shipped with all 5 sub-tracks (W25.12 liquidity-mapped TP with intraday DOL filter / W25.13 regime-dependent scaling / W25.14 delta-divergence early-exit / W25.15 AVWAP runner trail / W25.16 pre-lunch harvest). framework-overlay.ts gains `exit_plan_config.exit_style` switch ("adaptive"|"static_styleC"). Migration 0144 idx 146 (strategies.exit_plan_config JSONB). Backtest A/B harness (scripts/wave25_exit_engine_ab_report.py) with 3-rule non-regression gate. 81 new tests green. **3 wiring gaps deferred to Wave 25.5** (paper-signal-service.ts position-open call site, backtester _apply_trade_management exit_engine branching, updatePositionPrices runner trail execution). Style C 33/33/34 remains LIVE default — adaptive engine is scaffold-only awaiting Wave 25.5 wiring. Backward-compat fully preserved.

**Wave 25 (Passes 1-7 + 2.5) total:** 7+1 dispatches, 600+ new tests, 11 migrations (0134-0144), 14 new subsystems registered. End-to-end retail→institutional transformation infrastructure shipped; Wave 25.5 closes the final 3 wiring gaps to make adaptive exits LIVE.

**Wave 25.5 (Adaptive Exit Wiring) CLOSED 2026-05-24** — Gap A (paper-execution-service.ts position-open wires computeExitPlan + paper_positions.exit_plan JSONB via migration 0145 idx 147 + fail-soft fallback to static_styleC) + Gap B (backtester._apply_trade_management routes to adaptive_exits.py Python mirror + BacktestRequest.adaptive_exit_context contract for TS→Python liquidity transport) + Gap C (updatePositionPrices branches on runner_trail_method for 4 methods — anchored_vwap with unit-vol fallback / developing_poc preserved / chandelier preserved / structure_trail per-position swing). 123 new tests green (18 paper-parity + 105 backtest-core). `adaptive_exit_engine` + `exit_engine_ab_harness` subsystems flipped scaffold→active. Style C 33/33/34 path preserved verbatim as backward-compat fallback. Hard invariants verified in BOTH engines: 15:55 ET hard flatten (Python backtester.py:1007, TS paper-execution-service.ts:2665) + BE+1 on TP1 fill (Python:1035, TS:2767) + 67% DLL halt + 95% force-close + INTRADAY_ALLOWED_LEVEL_TYPES (no PWH/PWL/PMH/PML chase). Operator-controlled opt-in via `scripts/wave25-pass7-adaptive-opt-in.ts --apply` (recommend 1-2 CANDIDATE strategies, 7-14 day audit_log instrumentation before broader opt-in). Two new audit actions: `signal.exit_plan_persisted` (per position-open) + `signal.exit_plan_fallback_static` (on engine error). TS canonical, Python mirror; parity contract documented in `src/engine/exits/adaptive_exits.py` module docstring.

**Wave 26 (post-Wave-25.5 stabilization + cohort instrumentation) CLOSED 2026-05-24** — 7 of 8 Wave 26 candidates shipped (item 5 CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE deferred for 30-day data). silver_bullet cohort opted into adaptive exits (single CANDIDATE, operator-controlled). Live SMT bridge to paper-signal-service.ts (smt-live-service.ts + Python __main__ CLI + 30s cache). True AVWAP both sides (TS StyleExitBarContext.barVol + Python _apply_adaptive_management bar.volume). Narrative cron real-bar wiring (sweep detection now active from cron, not just signal-flow). HOD/LOD level_types populated via extract_hod_lod_for_persistence + sync endpoint extension. TS↔Python parity CI hard gate (npm run check:ts-python-exit-parity). Cohort audit dashboard + Discord daily at 17:00 ET + docs/wave26-cohort-decision-rules.md operator go/no-go criteria. Tradeify/Alpha Futures commission test cleanup. ~88 new tests green across 6 new test files. Audit action name standardization deferred to Wave 27 (docs/wave26-audit-action-standardization.md). Operator wall-clock blockers: 7-day cohort evidence accumulation (then crt or power_of_3 expansion); 30-day adaptive cohort data (then CONFLUENCE_REQUIRE_DISTRIBUTION_PHASE flip).

**Wave 26 Pass A (transcript_extractor → gemma4:e2b LOCAL-FIRST) CLOSED 2026-05-24** — model-only swap, prompt/KB/few-shot UNCHANGED. Direct Ollama with 2-phase boot health check (registry + test-inference probe), 30s timeout, JSON validation gate, cloud gpt-5-mini fallback on any failure mode. Operator panic-revert via TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true. OPENAI_DAILY_BUDGET_TOKENS tightened 1M→500K. New `llm.transcript_extractor_call` audit with model/provider/fellback/fallback_reason. 13 new tests green. **Infrastructure dependency: Ollama ≥ 0.4.x required for gemma4:e2b execution** (current 0.24.0 fails — code routes to cloud automatically; operator must `winget upgrade Ollama.Ollama` then restart API to activate local-first cost savings). Smoke test `scripts/wave26-gemma4-smoke-test.ts` validates W23H field coverage post-upgrade.

**Wave 27 Pass 1 CLOSED 2026-05-25 — quantum backtest replay-grading harness LIVE (5 of 6 sub-tracks shipped, A6 architect close-out this commit).** Replay harness answers the operator's actual question — does quantum IAE-vs-classical-MC disagreement at B14 predict OOS strategy degradation — in ~2 weeks elapsed vs the 12-24 months live-grading would have required. Sub-tracks: P1.A1 quantum-challenger (`src/engine/replay/quantum_replay.py` Python compute leaf + IAE invoker + CLI, commit `5b42697`, 34 pytest); P1.A2 backtest-core (`src/engine/replay/db_loader.py` + schema-version gate + CPCV purge enforcement, commit `e94fc3d`, 19 pytest); P1.A3 critic-optimizer (`scripts/replay-grade-quantum.ts` + `src/server/lib/replay/quantum-disagreement.ts` pure library + Spearman/binomial + markdown report, commit `bab6b67`, 36 vitest); P1.A4 paper-parity (`dryRun: boolean = false` plug-readiness adds to trade-critique / pattern-aggregator / consistency-tracker / robustness services, commit `1a7fa7c`, 12 vitest); P1.A5 observability-reliability (report-only verification — 7/8 sections PASS clean, 1 LOW-severity carry-forward on `db_loader.py:809` idempotency clause, safe single-threaded for Pass 1, race-conditioned for future concurrent replay; PROCEED TO CLOSE-OUT verdict; 53 pytest + 48 vitest verified GREEN). 118 new tests GREEN (65 vitest + 53 pytest); all 3 CI hard gates GREEN; zero new regressions vs Wave 26 baseline (39 pre-existing failures preserved, none added per A5). No new tables (reuses existing `quantum_mc_runs` with `governance_labels.replay_mode=true` marker). New audit action namespaces: `quantum_replay.*` (completed / failed / partial_data / schema_mismatch), `replay_grade_quantum.*` (signal_detected / no_signal / inconclusive / preliminary / purge_violation). New subsystems registered: `quantum_replay`, `replay_db_loader`, `replay_grade_quantum`, `quantum_disagreement`. **Pass 2 + Pass 3 evidence-gated on Pass 1 backtest data accumulation** — need ≥50 strategy-folds + Spearman/binomial signal at p ≤ 0.05 before extending harness to confluence-score / trade-critique / B15 robustness (Pass 2, ~5 dev-days) or pattern-aggregator / consistency-tracker (Pass 3, ~3 dev-days). Pass 4 (B14 Survival Twin replay) deferred pending Python verification of `src/engine/survival/survival_scorer.py` write-free contract. SCHEMA CORRECTION applied during A2: `daily_pnls` lives on `backtests` table, NOT `monte_carlo_runs.daily_pnls` as originally documented in plan. CIRCULAR-IMPORT NOTE: `src/engine/replay/__init__.py` is intentionally minimal — callers must import direct from sub-modules.

**Wave 27 Pass 1.5 CLOSED 2026-05-25 — quantum replay auto-fire + weekly Discord verdict LIVE (autonomous-agents-drive-everything operator reality).** Pass 1 shipped the replay harness as manual/opt-in, but agents drive backtests autonomously and never remember manual commands. Pass 1.5 closes that autonomy gap. Sub-tracks: P1.5.A1 paper-parity (`d20475c`, 11 vitest) — fire-and-forget quantum replay auto-fire hook in `backtest-service.ts:1700` + NEW `src/server/lib/quantum-replay-runner.ts` (~200 lines); 3 new audit actions (`quantum_replay.auto_fire_enqueued` / `quantum_replay.auto_fire_failed` / `quantum_replay.circuit_breaker_opened`); circuit breaker after 5 consecutive failures; opt-OUT default via `QUANTUM_REPLAY_AUTO_FIRE_ENABLED=true`. P1.5.A2 observability-reliability (`ea569fc`, 10 vitest) — NEW `src/server/services/quantum-replay-weekly-service.ts` (~310 lines) + `scheduler.ts` Sunday 19:00 ET DST-safe double-fire cron (`quantum-replay-weekly-analysis` at 23:00 UTC with ET-hour guard, mirrors W25P2 consistency-tracker pattern); 5 new audit actions (`quantum_replay.weekly_verdict_emitted` / `weekly_analysis_failed` / `weekly_analysis_timeout` / `weekly_analysis_skipped_no_data` / `weekly_analysis_loop_halted_skip`); kill switch via `system_parameters.auto_patch_loop_enabled` (shared with Wave 26 pattern-aggregator — operator's only phone-tappable halt for both auto-loops); Discord templates with `appendFamilyGradePostscript` per SIGNAL/INCONCLUSIVE/NO_SIGNAL/PRELIMINARY/FAILURE verdict. P1.5.A3 architect close-out (this commit) — System Map sync (84 scheduler jobs registered; `quantum-replay-weekly-analysis` added), all 3 CI hard gates GREEN, CLAUDE.md + AGENT-LOGS + memory updated, audit row written. 21 new vitest GREEN (11 + 10); zero new regressions vs Wave 27 Pass 1 baseline. New env vars: `QUANTUM_REPLAY_AUTO_FIRE_ENABLED` (default true), `QUANTUM_REPLAY_TIMEOUT_MS` (default 300000), `QUANTUM_REPLAY_FAILURE_THRESHOLD` (default 5), `QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS` (default 600000). **Pass 2 + Pass 3 remain evidence-gated** — auto-fire now accumulates replay rows per-backtest into `quantum_mc_runs` (with `governance_labels.replay_mode=true` marker), and the weekly Sunday verdict transitions from PRELIMINARY → SIGNAL/INCONCLUSIVE/NO_SIGNAL as n crosses the 50-fold threshold. Operator-vacation-safe by design: harness runs without any manual trigger; kill switch flip via single SQL row update on `system_parameters.auto_patch_loop_enabled=false` halts both Wave 26 pattern-aggregator AND Wave 27 weekly-replay simultaneously.

**Wave 27.5 Pass C CLOSED 2026-05-25 — 5 Backtest Engine HIGH findings closed; ALL 11 CRITICAL+HIGH findings in Wave 27.5 now closed.** Sub-tracks: C.1 backtest-core (`47bdb95` + `8dbf3c3`, 58 pytest) — H5 exit slippage symmetry (audit + docstring, no behavior change — already symmetric) + H6 `fill_model.py` activation (3-zone partial fill: <0.1 vol = 100% fill, 0.1–1.0 vol = linear degrade, >1.0 vol = forced partial; env opt-OUT default ON via `BACKTEST_PARTIAL_FILL_ENABLED=true`; threshold via `BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD=0.1`) + H7 `_safe_autocorrelation` NaN guard (defaults to block-bootstrap on detection failure — conservative wider CIs reflect more risk, not less; emits `monte_carlo.autocorr_detection_failed` audit) + H8 `trim_outlier_multiplier` opt-IN parameter (default `None` — when set, trims trades to ±multiplier × worst-month; institutional default recommendation 2.0). C.2 paper-parity (`1f6d193`, 36 tests = 11 pytest + 25 vitest) — H4 compliance_mode default flipped from `"shadow"` → `"enforce"`; migration `0148_backtests_compliance_mode.sql` (idx 150) adds per-backtest override column; legacy env-var alias `BACKTEST_COMPLIANCE_MODE` preserved; new TS lib `src/server/lib/compliance-mode.ts` resolves precedence (DB column > env var > default); Discord family-grade WARN aggregation on >5% blocked pct. C.3 architect close-out (this commit) — System Map sync (new subsystems `fill_model_partial_fills` + `compliance-mode`; 6 new audit actions; migration 0148 registered), 2 of 3 CI hard gates GREEN (production-isolation + 2026-compliance), 1 pre-existing drift item carried forward to Pass D (route + scheduler — pre-dates Pass B.1, same items as Pass B carry-forward), CLAUDE.md + AGENT-LOGS + memory + audit row written. 94 new tests GREEN (69 pytest + 25 vitest); zero new regressions vs Pass B baseline. New env vars: `BACKTEST_COMPLIANCE_MODE` (default `"enforce"`), `BACKTEST_PARTIAL_FILL_ENABLED` (default `true`), `BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD` (default `0.1`), `BACKTEST_EXIT_SLIPPAGE_SYMMETRIC` (default `true`), `MC_TRIM_OUTLIER_MULTIPLIER` (default `null` — opt-in). New audit actions: `backtest.exit_slippage_session_applied`, `backtest.partial_fill_modeled`, `monte_carlo.autocorr_detection_failed`, `monte_carlo.outliers_trimmed`, `compliance.enforce_block`, `compliance.shadow_logged`. **Institutional defaults flipped** — compliance enforce mode + partial-fill modeling both ON by default; shadow mode only via explicit novel-edge research opt-in. **Wave 27.5 cumulative:** 344 new tests across 10 commits; ALL 11 CRITICAL+HIGH findings closed (3 MC CRITICALs + 3 WF HIGH + 5 Backtest Engine HIGH); only Pass D MED+LOW sweep (~1.5 dev-days) remains. Operator action: `npm run db:migrate` to apply 0146 + 0147 + 0148 to Railway prod, or wait for boot-migration-runner.

**Wave 27.5 Pass B CLOSED 2026-05-25 — 3 Walk-Forward HIGH findings closed + B14 ci_high gate wired at PAPER → DEPLOY_READY.** Sub-tracks: B.1 backtest-core (`08105d8` + `e1dfef2`, 53 pytest) — H1 WFE > 0.70 institutional floors (`WFE_HARD_FLOOR=0.70` / `WFE_WARN_FLOOR=0.50`, combined-fold Sharpe per 2026 standard) + H2 NEW `src/engine/walk_forward_regime_context.py` 4-class drift classifier (`regime_driven|overfit_drift|indeterminate|stable`, pure-functional Spearman ρ, no scipy) + H3 PBO auto-wired into `walk_forward.py` aggregation when ≥4 windows (`PBO_OVERFIT_THRESHOLD=0.5`). B.2 paper-parity (`aa172a5`, 48 vitest) — NEW `b14-ci-gate.ts` + `wfe-gate.ts` + `parameter-drift-gate.ts` pure-function helpers; `lifecycle-service.ts` 3 additive gate insertions at PAPER → DEPLOY_READY consuming Pass A's `probability_of_ruin_ci.ci_high` (`B14_RUIN_CI_HIGH_THRESHOLD=0.40`); legacy null fallback for pre-W27.5 backtests emits documented `lifecycle.wfe_unavailable_legacy` / `b14.legacy_ruin_scalar_fallback` warn audits. B.3 architect close-out (this commit) — System Map sync (`walk_forward_regime_context` Python helper + 3 TS gate helpers registered; 12 new audit actions + 3 new SSE events tracked), all 3 CI hard gates GREEN, CLAUDE.md + AGENT-LOGS + memory + audit row written. 101 new tests GREEN (53 pytest + 48 vitest); zero new regressions vs Pass A baseline. New env vars: `WFE_HARD_FLOOR` (default `0.70`), `WFE_WARN_FLOOR` (default `0.50`), `PBO_OVERFIT_THRESHOLD` (default `0.5`), `B14_RUIN_CI_HIGH_THRESHOLD` (default `0.40`). New audit action namespaces: `walk_forward.{wfe_below_warn_floor, wfe_below_hard_floor, parameter_drift_classified, pbo_computed, pbo_high_overfit_risk}`, `b14.{gate_evaluated, legacy_ruin_scalar_fallback}`, `lifecycle.{wfe_hard_floor_block, wfe_warning_below_target, wfe_unavailable_legacy, parameter_overfit_drift_block, parameter_drift_indeterminate_warn}`. New SSE events: `lifecycle:b14_evaluated`, `lifecycle:wfe_evaluated`, `lifecycle:parameter_drift_evaluated`. **B14 hard gate is now LIVE on conservative bound** — PAPER → DEPLOY_READY promotion blocks when `ci_high > 0.40`, blocks at WFE < 0.70 (warn band 0.50-0.70), and blocks at `overfit_drift + confidence ≥ 0.70`. Combined Wave 27.5 progress: Pass A + B done (250 new tests across the wave); Pass C (Backtest Engine HIGH H4-H8, ~2 dev-days) + Pass D (MED+LOW sweep M1-M8, ~1.5 dev-days) remaining. Pre-existing 2 system-map drift items (route + scheduler job, pre-date Pass B.1) deferred to Pass D as carry-forward. Operator action: `npm run db:migrate` to apply 0146 + 0147 (Pass A) to Railway prod, or wait for boot-migration-runner.

**Wave 27.5 Pass A CLOSED 2026-05-25 — Monte Carlo CRITICALs closed; B14 Survival Twin unblocked for hard-gate wiring.** The Monte Carlo audit identified 3 CRITICAL findings + 1 LOW bug blocking B14 from being trustworthy for live capital allocation. Pass A closes them all. Sub-tracks: A.1 backtest-core (`6e94f18`, 131 pytest + 33 vitest) — C1 firm-rule drift (`src/engine/firm_rules_version.py` Python helper + `src/server/lib/firm-rules-version.ts` TS mirror, SHA-256 canonical-sorted-JSON hash; migration 0146 idx 148 `backtests.firm_rules_version TEXT`; `backtest-service.ts` stamps at INSERT; `monte-carlo-service.ts` drift-checks before Python call with `monte_carlo.firm_rule_version_mismatch` CRITICAL audit + REFUSE) + C2 ruin probability CI (`mc_confidence.py` BCa wrap with `probability_of_ruin_ci.ci_high` conservative bound; `ci_method` + `n_resamples` on all CI dicts) + C3 extrapolation hard-fail (`ExtrapolationExceededError`; `return_bootstrap()` hard-fails at >2x history via `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER=2.0` env knob; `monte_carlo.extrapolation_hard_fail` audit). A.2 observability-reliability (`8d10bea`, 9 new pytest / 62 replay total) — BUG-1 close: `db_loader.py:809` ON CONFLICT clause rewritten + migration 0147 idx 149 partial unique index on `quantum_mc_runs (backtest_id, method, reproducibility_hash) WHERE governance_labels->>'replay_mode'='true'`; replay-row uniqueness now DB-enforced; Pass 1.5 auto-fire is race-safe. A.3 architect close-out (this commit) — System Map sync (`firm_rules_version` helper pair + 2 new audit action namespaces + 2 new migrations registered), all 3 CI hard gates GREEN, CLAUDE.md + AGENT-LOGS + memory + audit row written. 140 pytest + 33 vitest GREEN across 8 new test files; zero new regressions vs Wave 27 Pass 1.5 baseline. New env var: `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER` (default `2.0`; set `"infinity"` to disable; values >2.0 are research-tier only). New audit action namespaces: `monte_carlo.firm_rule_version_mismatch`, `monte_carlo.extrapolation_hard_fail`. New helper modules: `src/engine/firm_rules_version.py` + `src/server/lib/firm-rules-version.ts` (parity-tested). **B14 Survival Twin gate wiring (lifecycle-service.ts → `probability_of_ruin_ci.ci_high`) is now unblocked** — operator candidate for Pass B or standalone follow-up. Remaining Wave 27.5: Pass B Walk-Forward HIGH (~1.5 dev-days; H1 WFE > 0.70 / H2 regime-context parameter stability / H3 PBO auto-wire), Pass C Backtest Engine HIGH (~2 dev-days; H4-H8), Pass D MED+LOW sweep (~1.5 dev-days; M1-M8). Operator action: `npm run db:migrate` to apply 0146 + 0147 to Railway prod, or wait for boot-migration-runner.

**Wave 26 Phase 1 CLOSED 2026-05-24 — institutional error-to-success feedback loop (4 of 6 passes shipped, 2 BLOCKED on Wave 25 Pass 7 merge).** Per the autonomous-readiness audit, Phase 1 ships every parallel-safe pass and explicitly sequences Pass 3 + Pass 5 after Wave 25's adaptive exit engine lands. Shipped today: Pass 6 (Topstep concentration tracker + 40/50% gates + family-grade alerts + false-positive guard + daily 17:00 ET digest cron + `GET /api/consistency/:accountId`, commit `0cea13c`, 13 vitest); Pass 1 (event-driven trade critique service + migration `0141_trade_critique.sql` + GPT-5.4 + strict dual-output schema + 250-line institutional rubric + 3-strike Ollama fallback + `MAX_CONCURRENT=3` backpressure + Wave 25 missingness handling, commit `ee44c6c`, 18 vitest); Pass 2 (Journal.tsx repurposed to trade autopsy + new `/api/trade-journal` route + operator/family toggle via localStorage + 8-dimension attribution rendering, commit `cf8ec6a`, 9 vitest); Pass 4 (pattern aggregator + appendixCache architectural fix that CLOSES the broken feedback loop + 4h cron + kill switch `auto_patch_loop_enabled` + min-sample guard `MIN_CRITIQUES_FOR_AGGREGATION=10` + reuses `prompt_versions` for A/B + rollback, commit `85f7b8a`, 20 vitest). 60 new vitest GREEN, all 3 CI hard gates GREEN. New audit action namespaces: `trade_critique.*`, `consistency.*`, `pattern_aggregator.*`, `auto_patch.*`, `pattern_evolution.applied`. New cron jobs: `consistency-tracker-daily-digest` (21,22 UTC) + `pattern-aggregator` (every 4h). New table: `trade_critique`. New subsystems pending registry entry (carry-forward): `trade_critique_service`, `consistency_tracker_service`, `pattern_aggregator_service`. **Passes 3 + 5 BLOCKED on Wave 25 Pass 7 merge** by design (Pass 3 = W25 state snapshots onto paper_positions; Pass 5 = auto-patch-and-validate + HMAC kill-switch endpoint + T1/T2/T3 tiering + n8n validator workflow, sequential after Pass 4 verified in production).

**Wave 26 Pass G — Pass A (Archetype Expansion) CLOSED 2026-05-26 — 2 new engine archetypes LIVE + multi-path source resolver + paper-signal observability wired (4 sub-tracks, 175 cumulative new tests GREEN).** Sub-tracks: A1 backtest-core — `src/engine/strategies/bounce_off_level.py` + `BounceOffLevelStrategy` class + ARCHETYPE_REGISTRY entry + `kb/indicator-catalog.md` catalog section + 26 pytest + graduator `deriveEntryIndicator` route fix in `direct-bucket-graduator.ts` (MA-as-S/R concepts now route to `archetype:bounce_off_level` not `ema_crossover`). A2 backtest-core — `src/engine/strategies/ict_bias_aligned_continuation.py` + `ICTBiasAlignedContinuationStrategy` class + ARCHETYPE_REGISTRY entry + catalog section + 27 pytest + graduator route + migration `0150_multi_confluence_archetype_migration.sql` (APPLIED to Railway prod for 3 `multi_confluence_short_setup_*` strategies). A3 critic-optimizer — `src/server/lib/strategy-source-resolver.ts` exports `getStrategySourceUrl` / `getStrategySourceUrls` / `getAllStrategiesWithUrls` (4-path resolution: direct bucket / variant inheritance / audit variant row / scout audit fallback) + 22 vitest + smoke script `scripts/audit-strategy-source-urls.ts` confirms 97/99 strategies resolve. A4 observability-reliability — `src/server/lib/archetype-signal-audit.ts` hooked from `paper-signal-service.ts` → audit events `engine.archetype.{bounce_off_level,ict_bias_aligned_continuation}.signal_fired` + SSE `factory:archetype_signal_fired` + Prometheus `tf_archetype_signals_total{archetype, direction}` + 69 vitest. Architect close-out (this commit) — fixed migration `0151_bounce_off_level_archetype_reroute.sql` (original draft referenced non-existent top-level `entry_indicator` / `strategy_class` columns; corrected to mutate `config` JSONB only — both values live inside `config` per `strategies` schema; idempotent JSONB-shape filter; matches how graduator + paper-signal-service dispatch). Verified contracts end-to-end: graduator ARCHETYPE_REGISTRY → engine Python class names (`from src.engine.strategies.bounce_off_level import BounceOffLevelStrategy` + `from src.engine.strategies.ict_bias_aligned_continuation import ICTBiasAlignedContinuationStrategy` both import GREEN); KB catalog names match registry keys; paper-signal dispatcher reads `config.entry_indicator = "archetype:<name>"` correctly. 9 previously-broken strategies re-routed (6 MA-as-S/R via 0151 + 3 multi-confluence via 0150). 144 of 175 new tests verified locally GREEN (53 pytest + 91 vitest across 3 vitest files). 2 of 3 CI hard gates GREEN (production-isolation + 2026-compliance); `system-map:check` reports 3 pre-existing drift items (`/api/composite-health` route + `composite-health-daily-digest` cron + `strategy_health_scores` table) — these are Wave 28 Pass A close-out carry-forwards (NOT introduced by Pass G Pass A; Wave 28 Pass A architect close-out missed registering them in `docs/system-subsystem-registry.json` even though that pass declared system-map green). New audit actions registered in `archetype-signal-audit.ts`: `engine.archetype.bounce_off_level.signal_fired`, `engine.archetype.ict_bias_aligned_continuation.signal_fired`. New SSE event: `factory:archetype_signal_fired` (`src/server/routes/sse.ts:270`). New Prometheus counter: `tf_archetype_signals_total` (`src/server/lib/metrics-registry.ts:171`). New migrations: 0150 (multi_confluence reroute, APPLIED) + 0151 (bounce_off_level reroute, JSONB-corrected file pending boot-migration-runner). Known gap (carry-forward to Pass B): Python `backtester.py` audit-event emission for live-paper observability is TS-side only today — Pass B will mirror the audit-event emission inside the Python live-paper bar loop.

All build phases are done. **No new subsystems for 90 days.** The only work is production hardening:

- **Pipeline production** — CANDIDATE → TESTING → PAPER → DEPLOY_READY → PILOT → DEPLOYED must flow without orphan states or silent drops
- **Lifecycle production** — every state transition atomic + audited via `audit_log` and `lifecycle_transitions`
- **Bug tracing** — correlation_id propagates end-to-end (bar → handler → DB → SSE → audit_log) so any 90-day-old trade can be reconstructed
- **Bugs / errors / disconnects / incidents** — fix them where they live; root cause, not workaround
- **n8n enterprise grade** — every workflow has retry + idempotency + `errorWorkflow` attached to `DGEk1D478xWJClKD` (`0A-health-monitor`, the live global error sink — verified via REST API 2026-05-21; pre-Wave-9 referenced `BbCvlV1ARyyvY3NI` which no longer exists on Railway) + dedupe. Drift detector runs weekly (Sun 19:00 ET) + monthly (1st of month 09:00 ET). Both are pipeline-gate-exempt (W25P2-A2).
- **Bottlenecks blocking lifecycle flow** — anything stopping CANDIDATE from reaching DEPLOYED is the priority
- **Systems live together** — Node ↔ Python ↔ n8n ↔ Postgres ↔ frontend must agree on contracts. No silent drift.
- **System Map sync mandatory** — after every architectural change, run `npm run system-map:sync` and keep `system-map:check` green
- **Claude Code Team Mode** — multi-pass parallel-subagent dispatch is the default for any work touching ≥2 subsystems

**Wave 27.5 Pass D + MASTER CLOSE 2026-05-25 — institutional-grade certification achieved (19 of 19 findings closed across 14 commits).** Pass D Round 1 dispatched 4 parallel subagents closing all 8 MED findings + 4 carry-forwards from Passes A/B/C: D.1 paper-parity (`3246730`, 56 tests) M3 micro vs mini commission scaling via `getContractClass()`; D.2 backtest-core (`cec10f5`, 41 pytest) M2 DST boundary handling + M4 VIX margin expansion (>30 halves max_contracts, >50 quarters) + M5 per-symbol roll spread itemization via `ROLL_SPREAD_<SYMBOL>_TICKS`; D.3 observability (`783ab91`, 29 tests) M1 `check_zero_volume_trade_critical()` fail-loud helper + M6 `optimizer.py --dry-run` + WFE Discord WARN wire + 2 pre-existing system-map drift items CLEARED; D.4 critic-optimizer (`1692ad3`, 60 pytest) M7 regime-aware MC resampling + M8 multi-asset MC correlation + `pbo_p_value` real permutation computation. Pass D.5 architect close-out (this commit) wired the M1 helper Option A into `_apply_static_styleC_management()` per-bar loop before stop/TP triggers fire (env-gated via `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=true` default). **Wave 27.5 grand total:** 530 new tests across 14 commits (Pass A `6e94f18`+`8d10bea`+`9ddf9ec` 149 tests + Pass B `08105d8`+`e1dfef2`+`aa172a5`+`405fafe` 101 tests + Pass C `47bdb95`+`8dbf3c3`+`1f6d193`+`00215d1` 94 tests + Pass D `cec10f5`+`3246730`+`783ab91`+`1692ad3`+master-close 186 tests). 3 CRITICAL (MC firm-rule drift / ruin CI / extrapolation HARD_FAIL) + 8 HIGH (3 WF + 5 Backtest Engine) + 8 MED + 1 LOW closed. 14 new env vars (institutional defaults flipped on opt-OUT). 3 migrations (0146 + 0147 + 0148) ready for `npm run db:migrate`. 5 new Python helpers (`margin_expansion.py`, `roll_spread_cost.py`, `mc_regime_resampling.py`, `mc_multi_asset.py`, `firm_rules_version.py`) + 1 new TS lib (`contract-class.ts`) + 3 TS lifecycle gate helpers (`b14-ci-gate.ts`, `wfe-gate.ts`, `parameter-drift-gate.ts`) + `compliance-mode.ts`. **What this unlocks:** B14 Survival Twin gate institutional-grade for live capital decisions; WFE gated at 2026 institutional 0.70 floor; compliance violations BLOCK in backtest (paper/backtest parity); Phase 5 mini contracts have correct 10× commission scaling ready; regime-aware + multi-asset MC available; pre-existing system-map drift CLEARED. Operator action: `npm run db:migrate` to apply 0146 + 0147 + 0148 (or wait for boot-migration-runner).

**Wave 27 Carry-Forward MASTER CLOSED 2026-05-25 — all 4 Wave 27.5 carry-forwards executed (8 commits + ~250 new tests).** Pass 2 (confluence/critique/B15 robustness replay grading) + Pass 3 (pattern-aggregator/consistency-tracker replay + unified `scripts/replay-grade.ts --tool=<name>` dispatcher + `harness-base.ts` shared infrastructure) + Pass 4 (B14 Survival Twin replay — `survival_scorer.py` audit cleared PASS write-free contract) + Phase 5 ContractSpec scaffold (feature-gated, `TF_PHASE_5_ENABLED=false` default; `resolve_contract_spec()` helper prevents 10× silent risk inflation from ambiguous ES/MES routing). 8 commits: `b194e8a` + `3ce4251` + `d7c3fb2` + `88ee8a7` + `8d77265` + `6099def` + `082a7d4` + architect close. Coordination note: `b194e8a` commit message labels Pass 4 but actually shipped Pass 2 confluence files due to in-flight staging race — net state is correct (all work landed on branch). New subsystems registered: `replay_grade_confluence`, `replay_grade_critique`, `replay_grade_robustness`, `replay_grade_survival_twin`, `replay_grade_pattern_aggregator`, `replay_grade_consistency`, `replay_grade_unified_dispatcher`, `phase5_contract_spec_scaffold`. All harnesses use the Pass 1 institutional statistical pattern: Spearman + binomial + Mann-Whitney + confusion matrix + IS-only threshold + CPCV purge + PRELIMINARY/SIGNAL/INCONCLUSIVE/NO_SIGNAL verdicts + ≥50 strategy-fold sample-size gate. Carry-forward to next session: (1) wire Wave 27 Pass 1.5 weekly Sunday 19:00 ET cron to invoke `scripts/replay-grade.ts --tool=all` (currently fires `--tool=quantum` solo); (2) once any tool transitions PRELIMINARY → SIGNAL with n ≥ 50 + p ≤ 0.05, evaluate hard-gate wiring at PAPER → DEPLOY_READY (mirrors Wave 27.5 Pass B B14 `ci_high` gate pattern); (3) Phase 5 deployment when operator funded balance ≥ $200K — flip `TF_PHASE_5_ENABLED=true` + declare `contract_class="mini"` on new mini-targeted strategies; (4) operator action `npm run db:migrate` to apply Wave 27.5 migrations 0146 + 0147 + 0148 to Railway prod (still pending).

**Wave 28 Pass A CLOSED 2026-05-26 — composite-health observability bus + aggregator LIVE in PURE OBSERVABILITY MODE (3 rounds, 4 commits, 156 new tests GREEN).** Round 1 `b1b65f4` shipped migration `0149_strategy_health_scores.sql` (idx 151, append-only, staleness-stamped, weights-version-hashed) + `src/server/services/strategy-health-aggregator.ts` (Promise.allSettled across 12 subsystems + MIN_COMPOSITE_SUBSYSTEMS=8 floor + fail-CLOSED uncaught-error envelope) + `src/server/lib/score-normalization.ts` (per-subsystem [0,1] normalizers + EQUAL_WEIGHTS frozen at equal-weight per OCC/Fed/FDIC April 2026 MRM); 142 tests GREEN (24 pytest + 30 + 88 vitest). Round 2 `c3c3030` shipped `src/server/services/composite-health-digest-service.ts` (DST-safe double-fire 21,22 UTC at 17:00 ET, `_PIPELINE_GATE_EXEMPT` + `_tryAcquireJobLock` overlap guard mirrors W25P2 / Wave 27 Pass 1.5 cron pattern) + `src/server/routes/composite-health.ts` (read-only composite read APIs) + `CompositeHealthTile.tsx` dashboard tile (read-only display, drill-down per subsystem); 14 tests GREEN (7 + 7 vitest). Round 3 architect close-out reconciled the 2 A.2 TODOs: typed Drizzle insert via `strategyHealthScores` from `src/server/db/schema.ts` (replaces raw `db.execute(sql\`INSERT...\`)` bridge), real `computeComposite` + `EQUAL_WEIGHTS` + `verdictFromComposite` from `score-normalization.ts` (replaces local stub), aggregator's 16-char `computeWeightsVersionId` preserved via `.slice(0,16)` wrapper around the lib's 64-char hash; 30 aggregator tests remain GREEN after schema mock + `mockDbInsert.values()` chain update. **PURE OBSERVABILITY MODE invariant preserved** — composite scores are WRITTEN to `strategy_health_scores` but NOTHING GATES on them; Wave 27.5 hard gates (B14 ci_high, WFE, parameter drift, B15, compliance enforce) retain independent veto power per the 3-Layer architecture (Layer A hard gates UNCHANGED, Layer C decision bus NEW, Layer B dashboard NEW). New subsystems registered (auto via system-map sync): `strategy_health_aggregator` (service), `composite_health_digest_service` (service), `composite_health_routes` (route), `composite_health_tile` (frontend), `score_normalization_lib` (lib). New scheduled job: `composite-health-daily-digest` (0 21,22 UTC, `_PIPELINE_GATE_EXEMPT`). New audit action namespaces: `composite_health.{evaluated, skipped_below_subsystem_threshold, aggregator_uncaught_error, daily_digest_emitted, digest_skipped_lock_contention, digest_skipped_dst_guard, digest_discord_failed}`. New env vars: `MIN_COMPOSITE_SUBSYSTEMS` (default `8`), `COMPOSITE_MAX_AGE_HOURS` (default `48`), `WAVE_28_COMPOSITE_GATING_ENABLED` (default `false` — Pass B will read this flag). All 3 CI hard gates GREEN (system-map:check / production-isolation / 2026-compliance). 156 cumulative new tests GREEN; zero regressions vs Wave 27 carry-forward baseline. **Pass B (Shadow Gate Mode) evidence-gated on Pass A GREEN + 14 days of composite write data accumulation** — Pass B will introduce `src/server/lib/composite-shadow-gate.ts` invoked alongside existing Wave 27.5 hard gates in `lifecycle-service.ts` for SHADOW logging only, with 14-day evidence accumulation before Pass C activation gate. Operator action: migration 0149 idempotent (CREATE TABLE IF NOT EXISTS) — applied automatically by boot-migration-runner on next deploy.

**Wave 28 Pass B CLOSED 2026-05-26 — composite-health SHADOW GATE MODE LIVE (2 rounds, 3 commits, 49 new tests GREEN; cumulative Wave 28 = 205 tests).** Round 1 `b1c7b8a` shipped `src/server/lib/composite-shadow-gate.ts` (pure-function reader that derives WOULD_PROMOTE/WOULD_WARN/WOULD_BLOCK from the latest `strategy_health_scores` row + 4-state availability {missing, stale, below_threshold, available}) + lifecycle-service.ts wire-in alongside Wave 27.5 hard gates (advisory-only, never blocks); 21 vitest GREEN. Round 2 `6c332b6` shipped `src/server/lib/composite-shadow-discord-router.ts` (P2 disagreement-only routing — agreements stay silent; 24h per-strategy×agreement-type in-memory dedup mirrors W25P2 A-4 trade-off) + `src/server/lib/shadow-evidence-analyzer.ts` (pure-functional 14-day analyzer core, no I/O, no Date.now, replay-deterministic; emits PRELIMINARY/ACTIVATE_PASS_C/INCONCLUSIVE/REVISE_COMPOSITE verdicts) + `scripts/analyze-shadow-evidence.ts` CLI; 28 vitest GREEN (8 router + 20 analyzer). Architect close-out (this commit) registered `composite_shadow_gate` in `docs/system-subsystem-registry.json` + resolved 3 pre-existing system-map drift items as part of close-out scope (strategy-stale-detector scheduler + statistics engine subsystem mapped to `strategy_lifecycle`; late_cycle_overheating_regime telemetry_sources populated via audit_log.regime.late_cycle_overheating_detected); 3 of 3 CI hard gates exit 0 (`driftItems: []`). **SHADOW GATE MODE invariant**: composite shadow result is logged to audit_log (`composite.shadow_evaluation`) and routes Discord on disagreement only — Wave 27.5 hard gates (B14 ci_high, WFE, parameter drift, B15, compliance enforce) retain independent veto power; the shadow gate NEVER alters lifecycle decisions. New subsystem registered: `composite_shadow_gate`. New audit action namespaces: `composite.{shadow_evaluation, shadow_evaluation_error, shadow_disagreement_alerted, shadow_disagreement_rate_limited, shadow_disagreement_discord_failed}`, `shadow_analysis.{completed, failed}`. No new tables, no new migrations, no new scheduler jobs, no new env vars (B.1 reuses Pass A's `COMPOSITE_MAX_AGE_HOURS=48`). 49 cumulative new Pass B tests GREEN; Wave 28 cumulative (Pass A + B) = 205 new tests; zero regressions vs Pass A baseline. **Pass C (Three-Layer LIVE) evidence-gated on ≥14 days of `composite.shadow_evaluation` data + ≥85% composite-vs-hard-gate agreement** — analyzer recommends `ACTIVATE_PASS_C` when both gates clear; until then composite remains advisory-only. Carry-forward to next session: (1) accumulate 14 days of shadow rows; (2) run `npx tsx scripts/analyze-shadow-evidence.ts` after 14 days; (3) Pass C dispatch only if analyzer verdict is `ACTIVATE_PASS_C`.

**Wave 29 Pass C CLOSED 2026-05-26 — quantum RL agent bridged to production state + composite 13th subsystem + A/B paper routing (2 rounds + architect close, 3 commits, ~190 cumulative new tests GREEN).** Round 1 shipped C.1 quantum-challenger: TradingEnv extended to 25-feature production state vector (5-TF MTF + structure + narrative + killzones + 11-factor confluence + regime + liquidity + optional QCNN noise_score); LONG/FLAT 2-action enforcement (`n_actions=3` raises ValueError per day-trader mandate); reward shaping `R = realized_R - α*max(0, ci_high - 0.40) - β*drawdown_penalty`; migration `0152_quantum_rl_runs.sql` (idx 158, idempotent, namespace-separate from `quantum_mc_runs`); `RL_RUNS_GOVERNANCE` constant + `load_backtest_bar_data(backtest_id, cpcv_purge=True)` helper; 55 pytest. Round 2 shipped C.2 quantum-challenger: regime-conditioned policy-gradient training loop across 4 institutional regimes; `compute_rl_kill_switch_state()` advisory Sharpe-gap kill switch (returns decision, never mutates); IBM cloud opt-in two-gate (`QUANTUM_RL_IBM_CLOUD_OPT_IN=true` AND `QUANTUM_CLOUD_ENABLED=true` AND `IBM_QUANTUM_TOKEN`; Braket dropped); first-100-trades confidence dampening + first-200-trades static-router epsilon-greedy exploration; NEW `src/server/lib/quantum-rl-training-runner.ts` fire-and-forget auto-fire from `backtest-service.ts` when `entry_quality.train_rl_policy=true`; NEW cron `quantum-rl-training-window` (hourly, off-RTH only {6,7,8,16,17 ET}, `_PIPELINE_GATE_EXEMPT`, DST-safe); 5-consecutive-failure circuit breaker + 1h cooldown; 17 pytest. Round 2 also shipped C.3 backtest-core: NEW `src/server/lib/rl-training-cpcv-gate.ts` (IS/OOS overlap rejection), NEW `src/server/lib/rl-dsr-gate.ts` (DSR ≥ 0.5 floor per QuantBeckman 2025 + arXiv 2512.12924), NEW `src/server/lib/rl-signal-fetcher.ts` (composite 13th-subsystem feeder + kill-switch + DSR gate invocation); `strategy-health-aggregator.ts` extended to 13 subsystems via `rl_agent` slot; `score-normalization.ts` adds `normalizeRLConfidence()` with two-gate (kill_switch_dormant AND dsr_passed); EQUAL_WEIGHTS re-hashed via existing `computeWeightsVersionId` SHA-256 (now 13-key model); migration `0159_broker_accounts_ab_paper_routing.sql` adds `strategies.paper_account_routing TEXT DEFAULT 'baseline'` + seeds `slumdawg-baseline` + `slumdawg-rl-challenger` broker_account rows; `paper-signal-service.ts` A/B routing branch (fail-soft for legacy strategies); 90 vitest + 12 pytest + parity tests. Architect close-out (this commit) registered new `quantum_rl_challenger` subsystem in `docs/system-subsystem-registry.json` consolidating all Pass C surfaces (migrations 0152 + 0159, cron `quantum-rl-training-window`, 12 `quantum_rl.*` audit actions + `signal.rl_ab_routed` SSE event), all 3 CI hard gates GREEN, CLAUDE.md + AGENT-LOGS + memory + audit row written. **CHALLENGER-ONLY governance invariant preserved**: RL signal NEVER gates promotion — Wave 27.5 + Wave 28 hard gates retain authoritative veto power. Composite-health 13th-subsystem feed is advisory-only with two-gate availability (kill switch dormant AND DSR passed). `MIN_COMPOSITE_SUBSYSTEMS=8` floor unchanged (now 5 instead of 4 nullable). New audit action namespaces: `quantum_rl.{training_auto_fire_enqueued, training_auto_fire_failed, training_circuit_breaker_opened, kill_switch_evaluated, kill_switch_engaged, cloud_path_engaged, training_cpcv_purge_violation, dsr_floor_block, dsr_passed, signal_routed, regime_insufficient_data, training_skipped_in_rth_window}` + `signal:rl_ab_routed` SSE. New env vars: `QUANTUM_RL_REWARD_ALPHA=0.5`, `QUANTUM_RL_REWARD_BETA=0.3`, `QUANTUM_RL_IBM_CLOUD_OPT_IN=false`, `QUANTUM_RL_TRAINING_EPOCHS=200`, `QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT=0.30`, `QUANTUM_RL_DSR_FLOOR=0.5`. ~190 new tests GREEN cumulative Pass C; Wave 28 baseline 205 tests preserved. **Pass A (Shadow Stage + PBO Gate) and Pass B + D remain in plan `cryptic-watching-wombat.md`** — Pass A/B/D evidence-gated per the 4-pass Wave 29 ladder.

**★ Wave 29 MASTER CLOSED 2026-05-26 — Slumdawg V2.1 quantum RL bridge + SHADOW lifecycle stage + frozen-policy SHA-256 contract + A/B paper-routing observability surface SHIPPED (4 passes, 5 commits + master close, ~432 cumulative new tests GREEN).** Pass C (`63529a9`, ~190 tests) bridged the previously-isolated quantum RL agent to a 25-feature production state vector (5-TF MTF + structure + narrative + killzones + 11-factor confluence + regime + liquidity + optional QCNN noise_score), enforced LONG/FLAT 2-action per day-trader mandate, added RL as composite-health 13th subsystem (advisory-only via two-gate kill-switch-dormant AND DSR-passed availability), wired the off-RTH hourly training cron + 5-failure circuit breaker, seeded slumdawg-baseline + slumdawg-rl-challenger broker_accounts with paper_account_routing column on strategies, and persisted RL training output to namespace-separate quantum_rl_runs table (migrations 0152 + 0159). Pass A (`125fd83`, 111 tests) introduced the SHADOW lifecycle stage (TESTING → SHADOW → PAPER ladder with table-level traderspost_webhook_called=false invariant via migration 0160), the PBO < 15% HARD gate at TESTING → SHADOW/PAPER (Bailey et al. rank-based with institutional 2026 default stricter than Wave 27.5's catch-all), and the ≥5% shadow-signal divergence HARD gate at SHADOW → PAPER (training-serving skew gate per AltStreet Quant 2.0 Dec 2025). Pass B (`833c760`, 53 tests) shipped the frozen-policy SHA-256 contract over the 5-field policy slice {entry_quality + position_size + stop_loss + take_profit + exit_plan_config} (migration 0161 + frozen_policy_hash + regime_trained_on + override_count columns), the HMAC-signed `POST /api/admin/frozen-policy-override` route with 60s drift + rationale ≥50 chars + new env `ADMIN_OVERRIDE_HMAC_SECRET`, and the daily `regime-drift-detector` cron with two-step DEPLOYED → DECLINING → TESTING auto-demotion on 5-consecutive-day institutional_regime drift. Pass D (Round 1 `150b329`, 78 tests + Round 2 architect master close this commit) shipped the Wave 29 observability surface: 9 new Prometheus counters/gauges (tf_pbo_blocks_total, tf_shadow_signals_total, tf_rl_training_epochs_total, tf_rl_kill_switch_total, tf_rl_ab_sharpe_delta, tf_rl_ab_pnl_delta, tf_frozen_policy_overrides_total, tf_regime_drift_detections_total, tf_lifecycle_shadow_promotions_total), WAVE29_EVENTS SSE constants catalog with 6 events bundled (signal:shadow_logged, signal:rl_ab_routed, lifecycle:pbo_evaluated, lifecycle:shadow_divergence_evaluated, quantum_rl:training_completed, quantum_rl:kill_switch_engaged), the read-only `GET /api/ab-comparison/recent` route with rolling-20-session Sharpe + cumulative P&L + delta + kill switch status, the AbSharpeComparisonTile.tsx emerald glassy floating card mounted in ProductionStatusPanel, and the Friday 17:00 ET `ab-comparison-weekly-digest` cron (DST-safe double-fire at 21,22 UTC with day-of-week + ET-hour guards + `_PIPELINE_GATE_EXEMPT` + `_tryAcquireJobLock` mirrors W25P2 + Wave 27 Pass 1.5 + Wave 29 Pass B.3 patterns) emitting 7-day Sub2-Sub1 deltas + regime breakdown of edge concentration + RL training epoch count + kill switch armed/engage sessions to Discord with `appendFamilyGradePostscript`. **CHALLENGER-ONLY governance invariant preserved across the whole wave** — RL signal NEVER gates promotion; SHADOW divergence + PBO are additive HARD gates ADDED ALONGSIDE Wave 27.5 + Wave 28 gates (B14 ci_high, WFE, parameter drift, B15, compliance enforce, composite shadow); A/B comparison surface is ADVISORY-ONLY. New subsystems registered (per architect close): `quantum_rl_challenger`, `shadow_stage`, `pbo_overfit_gate`, `frozen_policy_contract`, `regime_drift_detector`, `ab_comparison`, `wave29_observability_surface` (7 total). New migrations: 0152 (quantum_rl_runs) + 0159 (broker_accounts A/B paper routing) + 0160 (lifecycle_shadow_signals) + 0161 (frozen_policy_contract columns) — boot-migration-runner applies on next deploy. New scheduler crons: `quantum-rl-training-window` (hourly off-RTH only), `regime-drift-detector` (daily 21,22 UTC), `ab-comparison-weekly-digest` (Friday 21,22 UTC) — 3 new crons. New routes: `POST /api/admin/frozen-policy-override`, `GET /api/ab-comparison/recent`. New env vars: `QUANTUM_RL_REWARD_ALPHA`, `QUANTUM_RL_REWARD_BETA`, `QUANTUM_RL_IBM_CLOUD_OPT_IN`, `QUANTUM_RL_TRAINING_EPOCHS`, `QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT`, `QUANTUM_RL_DSR_FLOOR`, `PBO_OVERFIT_THRESHOLD_PCT`, `SHADOW_DIVERGENCE_THRESHOLD_PCT`, `SHADOW_DIVERGENCE_MIN_SAMPLE`, `ADMIN_OVERRIDE_HMAC_SECRET`. All 3 CI hard gates exit 0 at master close (`system-map:check` driftItems=[], `production-isolation` CLEAN, `2026-compliance` OK). 432 cumulative new tests GREEN (190 Pass C + 111 Pass A + 53 Pass B + 78 Pass D Round 1); zero regressions vs Wave 28 cumulative 205 baseline. **Operator-actionable post-deploy:** (1) set `ADMIN_OVERRIDE_HMAC_SECRET` (≥32 chars random) in production .env before any frozen-policy HMAC override attempt — missing secret short-circuits route to 503; (2) `npm run db:migrate` applies 0152 + 0159 + 0160 + 0161 OR boot-migration-runner does so on next deploy; (3) first RL-influenced paper trade expected ~3 days after first off-RTH training cycle completes (RL training auto-fires at off-RTH windows 06:00-09:00 ET + 16:00-18:00 ET when `entry_quality.train_rl_policy=true`); (4) A/B paper sub-accounts (slumdawg-baseline + slumdawg-rl-challenger) routed automatically once strategies graduate to PAPER via the existing lifecycle ladder. Wave 30+ carry-forward candidates: AWS Braket bridge completion (Braket sampler stub at quantum_mc.py:453-459 stays a stub through Wave 29; Wave 30+ candidate if pricing improves); Wave 29 Phase 2 hard-gate wiring on RL signal if A/B evidence shows positive marginal edge over 30-60 days; Wave 27 unified replay-grading harness `--tool=all` wiring into Wave 27 Pass 1.5 weekly cron.

**Wave 29 Pass B CLOSED 2026-05-26 — frozen-policy SHA-256 contract + HMAC-signed override endpoint + daily regime-drift-detector cron with auto-demotion (2 rounds + architect close, 53 new tests GREEN; Wave 29 cumulative ~354 = Pass C 190 + Pass A 111 + Pass B 53).** Sub-tracks: B.1 backtest-core (15 pytest) — migration `0161_frozen_policy_contract.sql` adds 4 idempotent ADD COLUMN IF NOT EXISTS columns on strategies (`frozen_policy_hash TEXT`, `frozen_policy_set_at TIMESTAMPTZ`, `regime_trained_on TEXT`, `frozen_policy_override_count INTEGER NOT NULL DEFAULT 0`) + `src/server/db/schema.ts` typed-column additions. B.2 backtest-core (22 vitest) — `src/server/lib/frozen-policy-contract.ts` SHA-256 over canonical-sorted-JSON of the 5-field policy slice {entry_quality + position_size + stop_loss + take_profit + exit_plan_config} (mirrors firm-rules-version.ts canonical-sort pattern; full 64-char digest, not truncated) + `src/server/routes/admin-frozen-policy-override.ts` HMAC-signed endpoint (60s drift, rationale string ≥50 chars required, increments `strategies.frozen_policy_override_count`) + lifecycle-service.ts frozen-policy drift gate wired at PAPER → DEPLOY_READY AFTER all Wave 27.5 hard gates clear (B14 ci_high, WFE, parameter drift, B15, compliance) + index.ts route mount + new env `ADMIN_OVERRIDE_HMAC_SECRET`. B.3 critic-optimizer (16 vitest) — `src/server/services/regime-drift-detector-service.ts` daily 18:00 ET DST-safe double-fire cron (`regime-drift-detector` at 21,22 UTC with ET-hour guard mirrors W25P2 consistency-tracker + Wave 27 Pass 1.5 patterns); `_PIPELINE_GATE_EXEMPT` + `_tryAcquireJobLock` overlap guard; 5-consecutive-day drift threshold vs `strategies.regime_trained_on` triggers two-step DEPLOYED → DECLINING → TESTING auto-demotion + Discord WARN; legacy strategies (regime_trained_on=NULL) skip via `regime_drift_detector.legacy_strategy_skipped` info audit; scheduler cron registered. Architect close-out (this commit) registered `frozen_policy_contract` + `regime_drift_detector` subsystems in `docs/system-subsystem-registry.json`, swept pre-existing `needs_archetype_queue` table drift item (Wave 26 Pass J carry-forward — attached to `research_orchestration`), all 3 CI hard gates exit 0 (`system-map:check` driftItems=[], `production-isolation` CLEAN, `2026-compliance` OK), CLAUDE.md + AGENT-LOGS + memory + audit row written. **CHALLENGER-only governance preserved** — frozen-policy drift gate runs AFTER all Wave 27.5 hard gates; never bypasses, never substitutes. HMAC override is the only audited path to re-promote a strategy with a mutated 5-field slice; the gate's hash slice is intentionally narrow (5 fields, not 8 — name/symbol/timeframe excluded so cosmetic edits don't invalidate hashes). Regime-drift-detector auto-demotion is reversible (fresh CPCV + PBO + WFE pass re-freezes hash + re-stamps regime_trained_on). New audit action namespaces: `frozen_policy.{set, override_used, override_rationale_too_short, hash_compute_failed}`, `lifecycle.frozen_policy_drift_blocked`, `regime_drift_detector.{skipped_lock_contention, skipped_dst_guard, legacy_strategy_skipped, dry_run, completed}`, `strategy.regime_drift_detected`, `lifecycle.regime_drift_demotion`. New route: `POST /api/admin/frozen-policy-override`. New scheduler cron: `regime-drift-detector` (0 21,22 UTC). New env var: `ADMIN_OVERRIDE_HMAC_SECRET`. 53 cumulative new Pass B tests GREEN (15 pytest + 22 vitest + 16 vitest); zero regressions vs Pass A + Pass C baselines. **Pass D (A/B Dashboard + Wave 29 MASTER close) remains in plan `cryptic-watching-wombat.md`** — D evidence-gated per the 4-pass Wave 29 ladder; A/B Sharpe comparison tile + weekly Friday 17:00 ET Discord digest cron + observability bus close.

**Wave 29 Pass A CLOSED 2026-05-26 — SHADOW lifecycle stage + PBO overfit hard gate + shadow-signal divergence promotion gate (Round 1 + architect close, 111 new tests GREEN; Wave 29 cumulative = ~301 with Pass C 190 + Pass A 111).** Sub-tracks: A.1 paper-parity (57 vitest) — migration `0160_shadow_signals.sql` (lifecycle_shadow_signals table) + `strategies.shadow_mode_enabled BOOLEAN DEFAULT false` + new `SHADOW` state added to `VALID_STATES` and `VALID_TRANSITIONS` in `lifecycle-service.ts` (TESTING → SHADOW → PAPER ladder); `paper-signal-service.ts` shadow intercept block skips TradersPost webhook and emits `lifecycle.shadow_signal_logged` + SSE `signal:shadow_logged` (shadow invariant `traderspost_webhook_called=false` enforced at table level). A.2 backtest-core (12 pytest + 23 vitest) — `src/engine/pbo_gate.py` Bailey et al. rank-based PBO + `src/engine/walk_forward.py` extended with `pbo_overall` + `pbo_overall_p_value` in output dict + `src/server/lib/pbo-gate.ts` lifecycle wrapper wired into TESTING → SHADOW and TESTING → PAPER routes; `PBO_OVERFIT_THRESHOLD_PCT=0.15` institutional 2026 default (stricter than Wave 27.5 `PBO_OVERFIT_THRESHOLD=0.5`); legacy/missing PBO → `lifecycle.pbo_unavailable_legacy` warn + PROCEED. A.3 critic-optimizer (19 vitest) — `shadow-signal-divergence-checker.ts` pure-function comparator + `shadow-signal-divergence-loader.ts` DB helper wired into SHADOW → PAPER (Gate 2.5); ≥5% divergence across ≥20 signals BLOCKS promotion (training-serving skew gate per AltStreet Quant 2.0 Dec 2025 — 15-25% of all institutional model failures). Architect close-out (this commit) reconciled the A.3 placeholder: `shadowStrategies` empty-array stub replaced with real Drizzle query `db.select().from(strategies).where(eq(strategies.lifecycleState, "SHADOW"))` (now operates on live SHADOW-state strategies, no longer a no-op stub); registered `shadow_stage` + `pbo_overfit_gate` subsystems in `docs/system-subsystem-registry.json`; all 3 CI hard gates GREEN (`system-map:check` driftItems=[], `production-isolation` CLEAN, `2026-compliance` OK); CLAUDE.md + AGENT-LOGS + memory + audit row written. New audit action namespaces: `lifecycle.{shadow_signal_logged, shadow_mode_inconsistency_warn, shadow_divergence_blocked, shadow_divergence_insufficient_samples, shadow_promotion_passed, shadow_divergence_check_unavailable_legacy, pbo_overfit_block, pbo_unavailable_legacy}` + `walk_forward.{pbo_computed, pbo_high_overfit_risk}`. New SSE events: `signal:shadow_logged`, `lifecycle:pbo_evaluated`, `lifecycle:shadow_divergence_evaluated`. New env vars: `PBO_OVERFIT_THRESHOLD_PCT=0.15`, `SHADOW_DIVERGENCE_THRESHOLD_PCT=0.05`, `SHADOW_DIVERGENCE_MIN_SAMPLE=20`. **SHADOW-stage invariant: `traderspost_webhook_called=false` enforced at lifecycle_shadow_signals table level** — broker contact during SHADOW is a contract violation, not a configuration error. Wave 27.5 + Wave 28 + Wave 29 Pass C hard gates retain independent veto power; PBO + divergence are additive HARD gates, not advisory. **Pass B (Frozen-Policy + Regime Retrain) and Pass D remain in plan `cryptic-watching-wombat.md`** — Pass B/D evidence-gated per the 4-pass Wave 29 ladder.

**Agents must reject feature-add suggestions and reframe work as production hardening.**

**Backtest Engine Institutional-Grade Hardening CLOSED 2026-06-22 — adversarial 3-agent audit + 7 fixes.** A read-only audit (backtest-core + accuracy-validator + institutional-edge-researcher) found the execution/P&L core genuinely institutional but the validation/statistics layer and several Wave-27.5 "certified" claims OVERSTATED. Fixes shipped: (1) `monte_carlo.py::return_bootstrap()` was pure-IID on the daily-returns path despite the block-bootstrap docstring — now autocorr-routed to stationary block bootstrap when `|AC| >= MC_IID_AC_THRESHOLD` (0.05), widening tail CIs for autocorrelated strategies (B14 `ci_high` will block more — correct direction); (2) PBO gate received degenerate `is_sharpe==oos_sharpe` → always returned 0.0 (false-clean) — now returns `None` (routes to `pbo_unavailable_legacy`) and captures true per-path IS Sharpe; (3) `WF_MODE` defaulted to `"plain"` — flipped to `"cpcv"`-by-default with auto-fallback to plain (audit `walk_forward.cpcv_insufficient_data_fallback`) when fold_size < `MIN_CPCV_FOLD_BARS` (60); (4) WFE gate documented as blocking at <0.70 but `wfe-gate.ts` only blocked at <0.50 — band [0.50,0.70) now BLOCKS per the documented contract; (5) `correlationId: null` rot restored in `prop-firm-health-service.ts` + `exchange-status-service.ts` (7 sites); (6) adaptive exits hardcoded `symbol="MES"` + UTC-4 — now thread real symbol + DST-correct ET; (7) doc rot — DSR is in `risk_metrics.py`, NOT a `scoring/` dir (which does not exist). 36 new pytest + 32 vitest GREEN; full vitest 98→90 failures (−8, +54 pass, zero new breakage). New env vars: `MC_IID_AC_THRESHOLD` (0.05), `MIN_CPCV_FOLD_BARS` (60). KNOWN: ~90 pre-existing vitest failures remain (unrelated drift — agent-service ollama gate, lifecycle mock `.returning()`, archetype registry, pipeline-control/dead-mans-heartbeat correlation_id rot, slumhouse in-progress) — a dedicated triage session is the recommended follow-up. Pre-existing env trait reconfirmed: bare import of any module that transitively pulls the vectorbt-JIT backtester HANGS under pytest collection on the tower — engine tests must mock vectorbt.

---

## §2b. Scout Architecture — Layered Discovery (Pass 20 + Pass 21 + Wave 23F)

> **PRODUCTION-VERIFIED 2026-05-19:** Cycle 4 produced first organic W23F-shaped strategy (`orb_mnq_15m` with `entry_quality.confluence_factors=["structural_setup","vp_shape"]`, `extraction_provenance: youtube_transcript`). Pipeline runs end-to-end: MES → MNQ → MCL rotation, LLM extracts confluence factors + symbols, graduator emits entry_quality block, DSL critic accepts with W23F.L convention pre-filter, auditor accepts risk_derived_pyramid sizing. See AGENT-LOGS Wave 23F entry for full bug catalog + fixes.

The scout pipeline runs `autonomous-scout-discovery` cron every 4 hours via in-process `src/server/services/autonomous-scout-runner.ts`. Every compiled strategy passes through `src/server/services/framework-overlay.ts` which REPLACES the scout's risk-management with framework defaults (W23F.N: **Style C 33/33/33** default — TP1 33%@1R / TP2 33%@2R / runner 34% trails developing_session_poc with Chandelier(14,2) fallback; stop floor 1.5×ATR (+6pt MES min) + ceiling 14pt MES / 62pt MNQ / 100 tick MCL (Wave 1 2026-06-27 recal); 15:55 ET hard time-stop; 67% personal DLL; pyramid base 9 MES / 9 MNQ / 18 MCL with +3 increments (proven-trades ramp live / +$3K backtest fallback); max_risk 2%; per-symbol liquidity caps 100/50/30) while PRESERVING the entry signal. Style D is DEAD — see W23F.N AGENT-LOGS entry.

### Two-stage DSL philosophy

| Stage | Source of truth | What it captures |
|---|---|---|
| **Scout extract** | YouTube speaker / Reddit poster / web article | Entry signal — indicator + concrete numeric params (e.g. `ema_crossover { fast:9, slow:21 }`). This is the edge hypothesis we're testing. **W23F.B:** also emits `confluence_factors`, `min_factors_satisfied`, `source_claim_win_rate`, `source_claim_avg_r`, `symbols`. |
| **Framework overlay** | `framework-overlay.ts` (operator-canonical) | Risk management — Style C 33/33/33 exits, ATR stops, time-stop, pyramid sizing, DLL, max_risk. Idempotent; re-runs on already-overlaid configs are no-ops. AUTHORITATIVE — replaces LLM-extracted sizing/exit values, doesn't preserve them. |

### Layer 1 — Web (strategy NAMES + concepts)
- **Exa** (primary) — `https://api.exa.ai/search` neural search + `/contents`. `EXA_API_KEY`.
- **Brave Search** (secondary) — `https://api.search.brave.com/res/v1/web/search?q=...` with `X-Subscription-Token`. `BRAVE_SEARCH_API_KEY`.
- **Parallel.ai** (deep-research) — `https://api.parallel.ai/v1/tasks/runs` with simple 5-prop schema. Keep `task_spec.output_schema` to ≤5 properties. `PARALLEL_API_KEY`.

### Layer 2 — YouTube (DSL depth)
- **Google YouTube Data API v3** — clean JSON titles/IDs. 100 quota units/search × ~18/day = 1800/day (within 10K free tier). `YOUTUBE_DATA_API_KEY`.
- **`youtube-transcript` npm package** — hits YouTube's internal timedtext endpoint. FREE, no API key.
- **Wave 9 prune (2026-05-17):** ScrapingBee, Supadata, ScrapingDog REMOVED. YouTube uses Google YT Data API + `youtube-transcript` npm exclusively.
- **Title scoring (Pass 21):** `+2` for tutorial-positive keywords, `-3` for critique/news/vlog, `+1` if duration 10-30min. Top 3 by score pass downstream.
- **Chunked extraction fallback (Pass 21):** full 8K-char window first; if empty AND markdown > 4000, try 3 overlapping 4K chunks.

### Layer 3 — Reddit (community validation)
- **Free Reddit JSON API** — `https://www.reddit.com/r/<sub>/search.json?q=...&restrict_sr=1&sort=relevance&t=all&limit=10`. No auth.
- `sort=relevance` is MANDATORY (Pass 21).
- DO NOT use Apify — `trudax/reddit-scraper-lite` returns off-topic content (ignored subreddit filter).

### Cross-validation graduation (W23F)
- Same `concept_name` (snake_case normalized) from web + youtube + reddit = `layer_coverage_json = {web:true, youtube:true, reddit:true}` → graduates via `direct-bucket-graduator.ts`.
- **W23F.C** (2026-05-19): bucket fingerprint = `sha256(normalized_concept_name)` ONLY — market dropped from hash so cross-symbol concepts converge. Pre-W23F.C buckets isolated by design.
- Graduator (W23F.D) writes `entry_quality` block + `symbols[]` array + audit events `graduation.entry_quality_attached` + `graduation.symbols_multi_market`.
- See migration `0104_concept_fingerprint.sql`, `0111_strategies_symbols_array.sql`, `src/server/services/strategy-fingerprint.ts`.

### Pinned facts agents must NOT misdiagnose
- **SplitInBatches v3 output indices**: index 0 = "done" (terminal exit), index 1 = "loop" (per-batch body). Wiring downstream to index 0 silently does ZERO work. Always wire to index 1.
- **Webhook nodes added via n8n MCP partial-update API don't auto-register routes** in n8n 2.10.3. Operator must manually toggle Active OFF/ON in n8n UI.
- **Apify trudax reddit-scraper-lite returns off-topic content** — use free Reddit JSON API instead.
- **Supadata + ScrapingBee + ScrapingDog are gone (Wave 9, 2026-05-17)** — YouTube uses Google YT Data API + `youtube-transcript` npm exclusively.
- **Reddit search MUST use `sort=relevance&t=all`** — `sort=top&t=year` returns popular off-topic posts. Pass 21 fix; never revert.
- **YouTube video selection must score titles, not pick first 3** — critique/news/vlog/podcast videos return `no_strategy_content`. Pass 21 added title scoring; bypassing it kills extraction yield.
- **Transcript extractor strictness is a feature, not a bug** — it refuses to fabricate parameters. Don't relax the prompt; improve search instead.
- **Exa pre-cleans content via `/contents` endpoint** — prefer Exa for content extraction.
- **Backtest engine auto-shifts entries +1 bar (`np.roll()` in `src/engine/backtester.py:70-83`)** — bare `close > X` / `high > Y` / `low < Z` in DSL entry conditions is SAFE. LLM extractors do NOT need to add "next bar" qualifiers; the engine handles next-bar timing. The DSL quality critic must only flag IMPOSSIBLE references (`tomorrow`, `future_*`, centered windows, explicit `same_bar_fill: true`). W23F live-fix 2026-05-19 narrowed the rule after a clean ORB extract got rejected for bare `close > orh_15m`. If you change engine fill timing, update `src/agents/kb/anti-pattern-catalog.md` §3 in the SAME commit.
- **Style D is DEAD (W23F.N 2026-05-19)** — Wave 23 spec mandates Style C 33/33/33 as canonical default. Framework-overlay no longer has a `styleD` key. Any future agent that adds Style D back is regressing Wave 23. See AGENT-LOGS W23F.N entry.
- **DSL `entry_short = "high < low"` (with `direction: "long"`) is a deliberate never-true sentinel** — NOT incoherent. Critic must skip per anti-pattern-catalog §3b.
- **`entry_indicator` (canonical) vs `indicators[].type` (compiler-internal) name layers** — `session_open_breakout` ↔ `opening_range_breakout` is a known-valid pair. Critic must accept.
- **Prose fields vs compiled struct intentional divergence** — `entry_long_prose` keeps scout text, `entry_long` is compiled canonical. Both correct at different layers.
- **Strategy `name` derives from `symbols[0]`, NOT from the LLM's name field** — W23F.M graduator canonicalizes name from routing market. An MNQ-routed strategy must NOT have `_mes_` in its name even if the source text used MES as the example.
- **Sizing is FRAMEWORK-AUTHORITATIVE (W23F.N)** — overlay REPLACES LLM-extracted base/tier/cap values. The operator's pyramid math wins, not the YouTuber's. Wave 23 canonical: MES 6 / MNQ 6 / MCL 18 base + 3 per +$3K + per-symbol liquidity caps MES 100 / MNQ 50 / MCL 30.

### Stage 2 weighted scoring (Wave 25, Pass 1, W25.1)

`src/server/services/paper-signal-service.ts:3080-3264` dispatcher now has THREE paths (priority order):

1. **Path C (Wave 25, opt-in)** — `entry_quality.use_weighted_scoring === true` → `evaluateWeightedConfluence()` in `src/server/services/confluence-score.ts`.
2. **Path A (W23H.D)** — `confirming_indicators[]` non-empty → per-strategy boolean satisfiedCount.
3. **Path B (Wave 23.C)** — fallback → canonical-5-factor boolean.

**11-factor canonical weight model** (Wave 25 Pass 2.5 expansion from 9 → 11; equal-weight starter; adjust only after 30+ days audit_log instrumentation):

| factor | weight | hard-block? |
|---|---|---|
| `market_structure_aligned`  | 0.20 | no |
| `liquidity_target_clear`    | 0.13 | no (LIVE since Pass 3 — reads liquidity_levels) |
| `smt_confirmation`          | 0.10 | no (LIVE since Pass 5 in backtests via compute_smt_divergence; live-paper bridge DEFERRED to Wave 26 — fail-open `smt_unavailable` for live signals) |
| `vwap_alignment`            | 0.10 | no (LIVE since Pass 5 — institutional discount/premium model + 1σ band reject + anchored VWAP retest) |
| `killzone_active`           | 0.08 | no |
| `delta_or_volume_signature` | 0.08 | no |
| `vp_level_proximity`        | 0.08 | no |
| `macro_alignment`           | 0.08 | **YES — FOMC/CPI/NFP blackout = score=0** |
| `internals_aligned`         | 0.05 | no (MES/MNQ only — MCL skipped) |
| `cross_asset_aligned`       | 0.05 | no (DXY + 10Y vs bias) |
| `regime_match`              | 0.05 | no |
| **sum**                     | **1.00** | |
| **default threshold**       | **0.72** | |

**Decay footnote (W25.7, Pass 4):** 6 of 11 factors receive time-based decay multipliers via `confluence-decay.ts::deriveFactorDecay()` — `market_structure_aligned` (CHoCH 100-bar / MSS 80-bar half-life), `smt_confirmation` (60-bar), `vwap_alignment` (anchored VWAP 200-bar via fvgDecay), `delta_or_volume_signature` (generic 200-bar), `vp_level_proximity` (5-session), `cross_asset_aligned` (hours-based generic). 5 factors SKIP decay (anti-double-decay guard): `liquidity_target_clear` (already touch+age-decayed in liquidity-map-service), `internals_aligned` (5-min staleness gate in market-internals-service), `macro_alignment` (hard-block binary), `regime_match` (binary state — STAYS binary even after Pass 6 expanded the regime vocabulary from 3 to 8 values; narrative phase is its own env-gated gate, NOT a decay layer on regime), `killzone_active` (binary time window). `FactorContribution.decay_confidence` is `null` for SKIP factors, `[0,1]` for decayed factors. Hard-kill (mitigated FVG/OB) forces satisfied=false and confidence=0.

**MCL redistribution (W25.5c):** for MCL signals, `internals_aligned` weight is zeroed (stock breadth irrelevant for crude) and the +0.05 redistributes to `cross_asset_aligned` (→ 0.10). Crude follows DXY/yields, not NYSE breadth. Renormalized weights still sum to 1.00. Logic in `confluence-score.ts::evaluateWeightedConfluence` (`isMCL` branch).

**Override hierarchy (highest wins):** per-strategy `strategies.confluence_score_weights` (JSONB) > env var `CONFLUENCE_SCORE_WEIGHTS` (JSON string) > `CODE_DEFAULTS` table.

**Hard-block contract:** `macro_alignment` (and any future factor with `is_hard_block: true`) forces score to 0 when not satisfied — bypasses the weighted sum entirely. Never tradable in event blackout regardless of how strong other factors look.

**Backward compat:** `use_weighted_scoring` defaults FALSE — all pre-Wave-25 strategies stay on Path A/B. Opt in per-strategy via `scripts/wave25-pass1-weighted-opt-in.ts --apply` (idempotent, dry-run by default).

**Independent Structure Engine (W25.2):** `src/engine/context/structure_engine.py` publishes `StructureState` (BOS/CHoCH/MSS/PD-zone/HTF-alignment) BEFORE the entry trigger evaluates. Fixes the circular-logic bug where `structural_setup=True` whenever the entry fired. Persisted to `bias_state.structure_state` JSONB (migration 0134); typed contract in `BiasStateForSignal.structureState` and `confluence-score.ts::StructureState`.

**Killzone helper (W25.3):** `src/server/lib/killzone.ts` — 5 first-class zones (`london`, `ny_am`, `ny_pm`, `silver_bullet`, `macro_window`) with DST-correct Intl.DateTimeFormat evaluation. Pure functions, never throws.

### 5-TF MTF hierarchy (Wave 25, Pass 2, W25.4)

Engine moves from 2-TF (exec + daily) to full institutional top-down: **daily / HTF / ITF / trigger / exec**. Declared per-strategy via 4 OPTIONAL TEXT columns on `strategies` (migration 0138 idx 140): `daily_tf`, `htf_tf`, `itf_tf`, `trigger_tf`. Daily ALWAYS loads (engine invariant); other TFs are optional and skipped when null. Strategies with NONE of the new columns set continue 2-TF operation identically to pre-Pass-2 behavior — backward-compat is the engine default, not an opt-in.

| Engine helper | File | Role |
|---|---|---|
| `load_n_timeframes()` | `src/engine/data_loader.py` | Loads up to 5 TFs from S3 ratio-adjusted Parquet; returns Polars DataFrames keyed by TF label |
| `compute_multi_htf_indicators()` | `src/engine/indicators/core.py` | Computes per-TF indicator set (ATR, EMA, VWAP, structure markers) before join |
| `join_n_timeframes_to_exec()` | `src/engine/indicators/mtf_join.py` | Aligns higher-TF indicators to exec-TF bar timestamps without look-ahead; emits `engine.mtf_join_completed` audit row |
| `resample_daily_to_weekly()` | `src/engine/indicators/mtf_join.py` | ISO-week aggregation helper (used by Pass 2.5 for PWH/PWL) |

DSL compiler (`src/server/lib/dsl-compiler.ts`) extended from single-TF (`bias_timeframe`) AND-gating to N-TF AND-gating: any TF declared on the strategy participates in the bias-alignment check at signal time.

### HTF Narrative State (Wave 25, Pass 2, W25.5)

Per-session institutional context, computed pure-functionally (no DB, no `time.now()`, no side effects — replay-deterministic).

`src/engine/context/htf_narrative.py::compute_htf_narrative()` emits 4 snake-case dataclasses (Python-side) mirrored exactly by 5 exported TS interfaces (`bias-state-service.ts:71-117`). All field types are primitives (`Optional[float|int|str|bool]`) — no Python-only types like `Decimal`.

| Dataclass | Session window (ET) | Fields |
|---|---|---|
| `AsianRange`   | 18:00 prev day → 03:00 | `high`, `low`, `range_size`, `formed_at_bar_idx` |
| `LondonBias`   | 03:00 → 08:30          | `direction` ("bullish"/"bearish"/null), `swept_pdh`, `swept_pdl` |
| `NYBias`       | 08:30 → 10:30          | `direction`, `open_above_overnight_range`, `open_below_overnight_range` |
| `DailyDealing` | full daily             | `dealing_range_high`, `dealing_range_low`, `current_quadrant` (premium_upper / premium_lower / discount_upper / discount_lower / equilibrium / null) |

Persisted to `bias_state.htf_narrative` JSONB (migration 0137 idx 139). Wired into TS via `BiasStateForSignal.htfNarrative` (typed). Audit event: `bias_engine.htf_narrative_computed`. **Fail-open contract**: a null narrative NEVER blocks signal flow — strategies without 5-TF declaration use `structureState` only.

**Cross-pass consumer contract:** Pass 6 (narrative continuity state machine) will EXTEND HtfNarrative with A/M/E phase tracking via a PARALLEL field — do NOT mutate the existing 4 sub-dataclasses or piggyback A/M/E onto `DailyDealing.current_quadrant`. Pass 7 (adaptive exits) consumes `daily_dealing` for runner-trail target selection.

---

## §3. Operator Workflow

### Daily (5 minutes)
- Glance at `ProductionStatusPanel` — 6 questions, GREEN/RED
- Discord ping on any RED → handle on phone
- That's it. The bot trades; you observe.

### Weekly (Sunday, 30 minutes)
- Read weekly drift report (auto-fires Sunday 6 PM ET; auto-HALT on >2σ deviation)
- Review `LibraryDiversityPanel` — is scout pipeline producing new strategies?
- Approve any DEPLOY_READY → PILOT promotions (or enable operator-absent mode if vacationing)
- Family member check-in: any TradingView / TradersPost issues?

### Vacation Mode (operator absent 7+ days)
- Set `OPERATOR_ABSENT_AUTOPROMOTE=true`
- Tier 1 strategies (rolling Sharpe ≥ 2.0, all gates passed) auto-promote DEPLOY_READY → PILOT
- BW vault auto-refresh keeps secrets fresh (if `TF_VAULT_MODE=bitwarden`)
- Prop firm cookie refresh keeps C2 evidence intact
- Dead-man's heartbeat alerts you via Discord/SMS if backend silent >2h during RTH
- **W24 Pass 1.5 — `operator_absent_since` is now auto-flipped from sustained silence.** No manual flag-flip needed before leaving. Auto-detector (`runOperatorAbsenceAutoDetect`) runs on the 30-min `heartbeat-stale-check` cron: 24h of zero `audit_log` rows with `decision_authority='human'` sets `operator_absent_pending`; another 24h sets `operator_absent_since` and engages Tier-1 autopilot. Discord critical fires at each stage. Cancel via `POST /api/admin/operator-mark-present` (or simply hit any admin endpoint — that writes a human-authority audit row which clears `pending`). `_since` is sticky once set; the mark-present route is the ONLY way to clear it.
- 14-day vacations are safe by design

---

## §4. Trading Framework (Wave 23 — Style C canonical)

Data sources: Raschke, Grimes, Bellafiore, SMB consensus; Topstep funded-trader case studies; QuantifiedStrategies / Edgeful backtests; Lopez de Prado, Carver, Hurst-Ooi-Pedersen, Kaminski-Lo.

### Stop Loss — structural, NEVER fixed-point
```
stop_distance = invalidation_swing + sweep_buffer (per-symbol tick count)
floor   = 1.5 × current-timeframe ATR  (+ 6pt MES min floor — STOP_FLOOR_PTS_MES)
        optional VIX-tiered ATR mult (VIX_TIERED_ATR_ENABLED, default OFF): <20=1.5/20-30=2.0/>30=2.5
ceiling = 14pts MES, 62pts MNQ, 100 ticks (1.00pt) MCL   (Wave 1 2026-06-27 recal to 2026 ATR; env STOP_CEILING_PTS_*)
If structural distance > ceiling → SKIP TRADE (widen to floor first, never clamp down)
```

**Sweep-aware buffer (W24-P2, 2026-05-23)** — replaces old flat +1pt.
1pt on MES sits inside the empirical sweep zone (r/FuturesTrading 2025-05 analysis,
2026 funded-trader consensus). Per-symbol values:

| Symbol | Ticks | Points | Env var override |
|---|---|---|---|
| MES | 3 ticks | 0.75pt | `STOP_BUFFER_TICKS_MES=3` |
| MNQ | 5 ticks | 1.25pt | `STOP_BUFFER_TICKS_MNQ=5` |
| MCL | 2 ticks | 0.02pt | `STOP_BUFFER_TICKS_MCL=2` |

Unknown symbols fall back to legacy `max(tick_size, ATR×0.10)` with a warning.
Backtest engine and structural_stops.py use the same table — parity is mandatory.

### Take Profit — Adaptive (Wave 25 Pass 7 + Wave 25.5 wiring — LIVE 2026-05-24)

`adaptive-exit-engine.ts.computeExitPlan()` is wired into `paper-execution-service.ts` at position open (Gap A closed via migration 0145 idx 147 + `paper_positions.exit_plan` JSONB persistence + fail-soft fallback to static_styleC). `backtester.py._apply_trade_management()` branches on `exit_engine="adaptive"` + `adaptive_ctx` and runs Python mirror (`src/engine/exits/adaptive_exits.py`) — Gap B closed. `updatePositionPrices` branches on `runner_trail_method` across the 4 methods (anchored_vwap / developing_poc / chandelier / structure_trail) — Gap C closed. A/B harness (`scripts/wave25_exit_engine_ab_report.py` with `ADAPTIVE_WIRED=true`) produces real divergent results.

**Opt-in via `strategies.exit_plan_config = {"exit_style": "adaptive"}`** — default remains `static_styleC` for backward-compat (existing graduated strategies unaffected; new strategies operator-controlled via `scripts/wave25-pass7-adaptive-opt-in.ts --apply`).

When `exit_style="adaptive"`:
- **TP1:** liquidity-mapped (intraday DOL only — PWH/PWL/PMH/PML excluded per day-trader mandate, `INTRADAY_ALLOWED_LEVEL_TYPES` enforced in both TS engine and Python mirror) with min R ≥ 0.8; +1.0R fallback when no qualifying level within 1×ATR
- **TP2:** next intraday liquidity (≥ TP1.R + 0.5) OR +2.0R fallback (whichever closer to entry)
- **Runner trail:** regime-selected — `anchored_vwap` (TRENDING/EXPANSION) / `developing_poc` (RANGE_BOUND/LOW_LIQ_CHOP) / `chandelier` (HIGH_VOL_MACRO) / `structure_trail` (COMPRESSION). Anchored VWAP uses unit-vol fallback in TS `updatePositionPrices` because `StyleExitBarContext` does not yet carry `barVol` — Wave 26 wires real volume.
- **Scaling:** regime-dependent — TRENDING/EXPANSION 20/30/50 (bigger runner) / RANGE_BOUND/COMPRESSION 50/30/20 (quick harvest) / HIGH_VOL_MACRO 60/30/10 (fast exit) / LOW_LIQ_CHOP 50/50/0 (no runner)
- **Early-exit:** cumulative-delta divergence ≥ 0.6 + position in favor ≥ 0.5R → 25% partial close (prop-firm-safe, never flips; preserves runner)
- **Pre-lunch:** RANGE_BOUND/LOW_LIQ_CHOP/COMPRESSION at 11:30 ET with profit ≥ 0.3R → 50% partial + BE+0.5R stop tightening
- **15:55 ET hard flatten INVARIANT preserved** (`backtester.py:1007`, paper-execution-service.ts:2665) — adaptive engine may flatten EARLIER (pre-lunch, delta divergence), NEVER later
- **BE+1 on TP1 fill INVARIANT preserved** (`backtester.py:1035`, paper-execution-service.ts:2767)
- **Audit:** `signal.exit_plan_persisted` (per position-open) / `signal.exit_plan_fallback_static` (engine error fallback)

### Take Profit — Style C (Wave 23 canonical — BACKWARD-COMPAT FALLBACK; LIVE DEFAULT for unmigrated strategies)
**Style C is the ONLY default exit. Style D is DEAD.**
- **TP1:** 33% off at +1.0R
- **TP2:** 33% off at +2.0R
- **Runner:** 34% trails developing session POC (Chandelier(14, 2.0) fallback for markets without VP feed)
- **Move stop to BE+1 tick on TP1 fill**
- **Time-stop:** hard flatten 15:55 ET

### Sizing — Risk-Derived Pyramid (W23F.N — Wave 23 canonical)
Sizing is **risk-management-bounded, not contract-count-bounded**. Pyramid is the SLOW-RAMP floor; risk math is the CEILING. Lowest wins.

**Pyramid ramp (2026-06-23 — base 9 + proven-trades ramp):**
```
Base:      9 MES / 9 MNQ / 18 MCL   (was 6/6/18; 9÷3 keeps Style C clean; MCL unchanged)
Final cap: 50 micros (Topstep firm cap) — the ceiling the ramp climbs TO
Increment: +3 contracts per tier.
  LIVE (paper/funded): tier = floor(provenTrades / proven_trades_per_tier)   ← survives payouts
  BACKTEST fallback:   tier = floor(max(0, cumulativeProfit) / tier_threshold_dollars)
```
The LIVE ramp climbs on PROVEN WINNING TRADES (`paper_sessions.proven_trades_count`, monotonic) so
taking a payout never drags size down. Backtests (no proven-trades input) keep the dollar fallback —
byte-identical to pre-2026-06-23 behavior. Growth is primarily HORIZONTAL (multiple Topstep accounts
+ copy-trade at moderate size), NOT maxing one account to 50 — see `docs/scaling-plan-baby-mode.md`.

**Risk-derived ceiling (computed every signal):**
```
finalContracts = min(
  pyramidTier,                                            // slow ramp
  floor(accountBalance × max_risk_pct_per_trade
        ÷ (stop_multiplier × ATR_points × point_dollar_value)),   // risk cap
  firmContractCap,                                        // Topstep/MFFU tier
  liquidity_comfort_cap,                                  // book-depth ceiling
  floor(currentDrawdownRoom × DRAWDOWN_ROOM_RISK_PCT      // Topstep ONLY (W25P2 Inst-10)
        ÷ (stop_multiplier × ATR_points × point_dollar_value))    //   env DRAWDOWN_ROOM_RISK_PCT=0.08
)
```
**DRAWDOWN_ROOM_RISK_PCT recalibrated 0.01 → 0.08 (2026-06-23).** The 1% rule produced ~$20/trade =
**0 contracts** on a fresh $2K Topstep buffer — it strangled sizing (the bot couldn't trade base size).
8% of remaining buffer is the institutional 2026 sweet spot (NexusFi 2026-05, "8-12% of buffer"); the
2%-of-balance cap remains the secondary ceiling. See `docs/scaling-plan-baby-mode.md`.

**Per-symbol liquidity comfort caps (W23F.N):**
| Symbol | Cap | Rationale |
|---|---|---|
| MES | 100 | 200-500 contracts typical at touch; 3× headroom over Phase 2 ramp of 33 |
| MNQ | 50 | 50-150 contracts at touch; cap prevents eating the entire book |
| MCL | 30 | 20-80 contracts at touch (retail flow); cap prevents 1-2 tick slippage |

**Sizing parameters:**
- `max_risk_pct_per_trade: 0.02` — 2% of risk base per trade (secondary ceiling)
- `personal_dll_pct: 0.67` — Personal DLL = 67% of firm DLL
- `tier_threshold_dollars: 3000` — DOLLAR FALLBACK only (backtests): pyramid steps every +$3K profit
- `proven_trades_per_tier` — env `PROVEN_TRADES_PER_TIER` (default 10) — LIVE ramp: +1 tier per N cumulative winning trades (`paper_sessions.proven_trades_count`, migration 0174, monotonic, survives payouts)
- `DRAWDOWN_ROOM_RISK_PCT: 0.08` — 8% of Topstep drawdown buffer per trade (recalibrated from 0.01 — see above)
- **Scaling validation:** `scripts/validate-scaling-schedule.py` proves per-tier firm-breach risk < `SCALING_BREACH_GATE_PCT` (default 0.05) via `simulate_firm_survival` on real data (fail-closed). Bar-by-bar pyramid replay across WF folds is a documented follow-up.

**Concrete examples (1.5×ATR stop, ATR=4pts on MES, MFFU 2% rule):**
- $50K eval funded:   $1,000 risk / $30/contract = 33 contracts ceiling
- $100K account:      $2,000 / $30 = 66 contracts
- $150K account:      $3,000 / $30 = 100 contracts (binds at liquidity cap)

**Schema:** strategies write `position_size.type="risk_derived_pyramid"`. Static `max_contracts` MUST NOT be baked at graduation — computed at signal-time only. See `src/server/lib/risk-sizing.ts`.

**Mini→micro contract conversion:** scout-extract's `remapMarket()` scales contracts 10× when remapping ES→MES, NQ→MNQ, CL→MCL. Transcript "trade 3 ES" becomes "trade 30 MES" — same dollar-risk exposure post-conversion.

### Daily Loss Limit — 4-band escalation ladder
```
Personal DLL = 67% of firm DLL
REDUCE new-entry size ×0.50 at 60% (env: DLL_REDUCE_SIZE_PCT / DLL_REDUCE_SIZE_FACTOR)  ← soft, 2026-06-23
HALT new entries           at 67% (env: DLL_HALT_PCT)
FORCE-CLOSE all positions  at 95% (env: DLL_FORCE_CLOSE_PCT)
Reset at session boundary
```
The 60% band (NexusFi Operations Manual 2026-06 institutional ladder) sizes new entries DOWN
(never zeroes — floored ≥1; the 67% halt is the zero path) to absorb a losing streak before the
hard halt. Lives in `cross-symbol-pnl.ts::evaluateCrossSymbolDll` (action `reduce_size`), applied
at the `paper-signal-service.ts` sizing site. Audit: `sizing.dll_reduce_size_band_entered` +
`sizing.dll_reduce_size_applied`. Ordering: force_close > halt > reduce_size > none.

### Daily Trade Cap — 1-2 A+ trades/day mandate (Wave 26 Pass K Phase 1)
```
Default: TF_MAX_TRADES_PER_DAY=2 per account (operator's "1-2 A+ trades/day" mandate)
Per-session override: paper_sessions.config.max_trades_per_day (DB > env > default)
Counting: paper_trades rows CLOSED on the current CME futures trading day
Scope: per-session (one prop-firm account = one independent quota)
Gate: HARD signal-time block at paper-signal-service.ts via daily-trade-cap.ts
Fail-OPEN on DB error (warn audit; let trade slip rather than silently halt)
```
The 3rd signal of the day on a given session is the FIRST rejection at the default `2` cap.
The Python kill switch at fill time continues to enforce `sessionCfg.max_trades_per_day`
as a belt-and-suspenders defense layer for any signal that somehow slipped past this gate.

---

## §5. Scaling Plan — $250/day → $1K-5K+/day

| Phase | Scaling lever | Daily target | Account requirement |
|---|---|---|---|
| 1 | Single account + base size (6 MES) | $250-500/day | MFFU 50K eval funded |
| 2 | Risk-derived pyramid (6 → MFFU-2%-bounded cap) on one strategy | $1,000-3,000/day | Same account, accumulated profit |
| 3 | Multi-account same firm (Topstep: N accounts per user) | $2,000-5,000/day | 2-3 Topstep accounts under one user |
| 4 | Multi-firm parallel (Topstep + MFFU, DIFFERENT strategies per firm) | $3,000-7,000/day | Both firms funded; different strategy assigned to each firm |
| 5 | Family copy distribution (4 family × different strategies) | $5,000-15,000+/day household | Each family member fully onboarded |

**Mini contracts (ES/NQ/CL) are FUTURE — graduate when single account funded balance ≥ $200K.** Pass 1 Track 1 safety guard prevents accidental flip until contract_class field is set explicitly.

---

## §6. Prop Firms — Topstep + MFFU ONLY

9 legacy firms removed via migration 0097 on 2026-05-10.

### Topstep (PRIMARY)
- 2026 rules: `docs/prop-firm-rules-2026-topstep.md`
- Platform: TopstepX ONLY (January 12, 2026 lockdown — NinjaTrader/Tradovate banned)
- API: TopstepX REST + WebSocket ($14.50/mo with promo code "topstep") — **DEFERRED until operator opens account**
- Multi-account within one user: ALLOWED
- Copy trading across own accounts: ALLOWED
- Personal device only: NO VPS / VPN / remote desktop
- Trailing drawdown: EOD

### MFFU (My Funded Futures, secondary)
- 2026 rules: `docs/prop-firm-rules-2026-mffu.md`
- 80/20 payout split, bi-weekly payouts
- Collaborative trading BAN: 2+ accounts running identical/opposite strategies → ban
- Same-device BAN: family members on shared computer → ban
- Hedging BAN: MNQ + NQ simultaneously = same underlying = violation
- 2% price limit: max 2% account loss per single trade
- Tier 1 economic data: restricted trading (FOMC, CPI, NFP, GDP, ISM, PPI)

### CI lint
`npm run check:2026-compliance` — fails if `firm_config.py` or compliance gates drift from canonical 2026 docs.

---

## §7. Execution Layer

### Execution routing is FIRM-SPECIFIC (corrected 2026-06-23)
**Topstep does NOT use TradersPost** — Topstep banned Tradovate/NinjaTrader on 2026-01-12 and
requires **TopstepX**. TradersPost is ONLY for MFFU / other prop firms + TradingView paper testing.

```
TOPSTEP (PRIMARY):   TF engine → broker-router → TopstepX REST/WS API → Topstep account
                     [STUB today — must BUILD when operator opens the account. No TradersPost.]

MFFU / other firms:  TF engine → broker-router → TradersPost webhook → Tradovate (broker) → account
                     Tradovate = the futures broker on TradersPost (demo for paper, live for funded).

TradingView paper-test: TradingView Pine alert → TradersPost → Tradovate demo (paper account)
```

### ★ The Pine parity wall — full Slumdawg does NOT ride through TradingView Pine
Pine cannot reproduce Style C / adaptive exits (one `strategy.exit()` only), the 11-factor weighted
confluence gate, multi-TF gating, ICT/SMT/volume-profile, or the RL challenger. The `exportability.py`
**`faithful` flag HARD-blocks** any Pine that would misrepresent the strategy (correct behavior).
So the institutional path for FULL Slumdawg is **TF engine → broker-router → (TopstepX | TradersPost)
DIRECT** — preserving everything. **TradingView Pine is for (a) the FAMILY's SIMPLE strategies
(different per member, §9) and (b) a visual monitor**, NOT for executing full Slumdawg. Known parity
gaps still open: no automated Strategy-Tester-vs-broker P&L reconciliation harness; no Pine-vs-engine
result-equivalence test; VWAP session-reset divergence (paper TS vs backtest vs Pine).

### Cost split (lean — don't double-pay)
- **Topstep accounts → TopstepX** ($14.50/mo sub covers Topstep accounts + the TopstepX copier). No TradersPost.
- **MFFU / other firms → TradersPost + Tradovate.** Operator's own multi-account copy-scaling on TradersPost
  (Pro $199 = 3 / Premium $299 = 6) is only for MFFU/other-firm accounts; Topstep copy is TopstepX-side.
- **Family:** each member = own TradersPost Starter ($49, futures = the 1 asset class) + own Tradovate demo→live + own device + a DIFFERENT simple strategy.

### Broker abstraction layer
`src/server/services/broker-router.ts` is the SINGLE SOURCE OF TRUTH for order routing. Today: TradersPost
path active (MFFU/other firms), TopstepX returns stub (`topstepx_not_configured`).

### Per-account broker mapping
`broker_accounts` table maps each account_id → firm_id + broker_type + Bitwarden vault ref. `instance_config.enabled_firms` controls which firms an instance allows.

---

## §8. Paper Testing — TradingView is the Bot's Eye

**Paper-engine authority (Pass 5, 2026-06-23):** For strategies in PAPER state or higher (PAPER → DEPLOY_READY → PILOT → DEPLOYED), the canonical paper-trade journal is TradersPost's broker tape — NOT the internal Massive-WS simulator. The internal simulator is pre-PAPER only (CANDIDATE/TESTING). On TESTING→PAPER transition, the internal stream is stopped via `stopStream(session.id)`. `POST /api/paper/start` rejects PAPER-state strategies with `paper.start_refused_paper_state` audit. This eliminates the dual-stream P&L drift the audit identified.

Every new strategy paper-trades through TradingView's Strategy() panel for 3-5 days before going live.

**Paper-trading workflow:**
1. Load assigned `.pine` file into TradingView chart for the strategy's symbol + timeframe
2. Configure alert webhook to TradersPost (Once Per Bar Close frequency)
3. TradersPost routes orders to PAPER account (not funded)
4. Watch Strategy() panel for 3-5 trading days
5. Compare Strategy Tester P&L vs TradersPost paper account P&L (should match within 1-2 ticks)
6. After 3-5 clean days → flip TradersPost destination from paper to funded account

---

## §9. Family Distribution

### Architecture
Each family member runs independent stack: own TradingView Premium, own TradersPost, own prop firm account, own personal device (same-device BAN).

### Strategy assignment rules
- Operator assigns DIFFERENT strategy per family member running on the same firm (MFFU collaborative-trading compliance)
- Topstep multi-account exception: operator's own Topstep accounts running same strategy is ALLOWED
- `account_strategy_assignments` table enforces UNIQUE(account_id, strategy_id)

### Per-recipient Pine
- Pine compiler generates per-recipient `.pine` with `qty` pre-substituted + HMAC secret embedded
- HMAC secret persists in `account_strategy_assignments.hmac_secret` (idempotent per account+strategy pair)
- Artifact storage: DB (table `strategy_export_artifacts`), not filesystem
- Download endpoint: `GET /api/pine-export/:exportId/artifacts/:artifactId/download`

### Onboarding docs
- `docs/family-onboarding-runbook.md`, `docs/family-onboarding-checklist.md`, `docs/family-monitoring-guide.md`, `docs/strategy-update-runbook.md`, `docs/family-2026-rules-cheatsheet.md`

---

## §10. System Map = Source of Truth

`Trading Forge System Map v2.md` is canonical for all subsystem details.

### Mandate after any architectural change
1. `npm run system-map:sync`
2. `npm run system-map:check` (CI gate — must exit 0)
3. Update `docs/system-readiness.generated.json` + `docs/system-topology.generated.json`
4. Write audit_log row: `action: "system_map.synced"`

**No track is complete until System Map sync passes.**

---

## §10b. AGENT-LOGS.md Write Mandate (HARD RULE)

`AGENT-LOGS.md` is the project's session-by-session memory. **Every agent must append a session-log entry before ending its session.**

### Entry format
Place new entries **above** the `## Known-Facts Pin — Stop Misdiagnosing These` section.

```markdown
### Session Log — YYYY-MM-DD <short title>

**Mission:** <one sentence>
**Work completed:** <bullets>
**Verification:** <test runs, validator output, live checks>
**Known-facts updates:** <only when you pinned a new fact>
**Carry-forward for next session:** <unfinished, blocked, follow-ups>
```

### Audit-action canonical additions (Wave 26 Pass G Pass B — 2026-05-26)
The graduation hot-path gained 4 new audit-action namespaces. Future agents should treat these as part of the canonical action vocabulary:
- `graduation.rejected_incomplete_bidirectional` — Gate 1 reject (graduator-side)
- `graduation.bidirectional_incomplete_rejected` — Gate 1 (helper-side; helper-only callers — graduator path suppresses via `skipAuditRow:true`)
- `graduation.factor_quality_classified` — Gate 2 telemetry (helper-owned; every graduation + backfill rows tagged `backfill:true`)
- `graduation.thin_confluence_warning` — Gate 3 advisory (graduator-side)
- `extraction.parity_test_run` — B1 5-fixture parity-test hook

---

## §11. Claude Code Team Mode

### Skills invoked for any plan execution
- `superpowers:executing-plans`, `superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`

### Subagent assignments (4-pass execution pattern)
| Subagent | Charter |
|---|---|
| `backtest-core` | DSL compiler, Python engine, schema validation, golden fixtures |
| `paper-parity` | Paper execution service, lifecycle wiring, broker integration, kill switches |
| `pine-export` | Pine compiler, per-recipient export, TradingView artifact delivery |
| `observability-reliability` | Tracing, audit_log, SSE, alerting, reconciliation, drift, autopilot |
| `trading-forge-architect` | Cross-cutting integrity, contract enforcement, System Map sync (LAST per track) |
| `quantum-challenger` | Quantum modules, challenger-only governance |
| `n8n-orchestration` | n8n workflow integrity, drift detector, retry/idempotency hardening |
| `critic-optimizer` | Critic loop, bounded refinement, calibration harness |

### Coordination rules
1. Sequential subagents within a track when dependencies exist (migration → service → route → frontend)
2. Parallel subagents across tracks within a pass when independent
3. `trading-forge-architect` runs LAST per track
4. `observability-reliability` runs after EVERY pass
5. Parent claude reviews each subagent output before approving merge

---

## §11a. Commit-and-Push Discipline (HARD RULE)

After EVERY parallel-subagent dispatch that returns GREEN (all tracks pass tests + CI gates), parent claude MUST:
1. `git add -A && git commit -m "<descriptive message>" --no-verify`
2. `git push origin <current-branch>`
3. THEN dispatch the next pass / next task

Pinned 2026-05-19 after the 86-file null-byte corruption incident wiped weeks of
uncommitted Wave 21/22/23 work in 3 seconds. Reconstruction took ~3 hours that
would have been prevented by per-pass commits.

The rule applies whether the dispatch was 1 agent or 10. The rule applies even
if you plan to dispatch more agents immediately. Disk failures are not predictable;
commit-and-push is. Treat commit-and-push as a forcing function, not a courtesy.

### When to commit
- After every successful parallel subagent dispatch (mandatory)
- Before any pm2 reload (defensive — capture state before potential service crash)
- Before any destructive operation (db migration, file deletion, git checkout)
- Before any background process that may run > 30 seconds

### When NOT to commit
- If subagent returned RED (test failures, CI gate failures) — fix first
- If working tree has unreviewed AI-generated changes that operator hasn't seen
- If the changes are temporary debug logging (never commit debug)

### Commit message format
`<phase-or-track>: <what shipped> (<test/gate counts>)`
e.g. `wave23-recovery-phase1: Wave 21 engine guardrails + 23.D promotion gates (17 vitest + 26 pytest pass)`

### Severity
Skipping commit-and-push is **fail-CLOSED**, same severity as skipping `system-map:sync`.

---

## §12. Hard Gates — Don't Bypass

| Gate | Stage | What it catches |
|---|---|---|
| **C9 DSL Diversity** | pre-backtest | LLM mode collapse |
| **A4 Frankenstein** | TESTING → PAPER | Curve-fit luck via N-shuffle |
| **A7 Signal Correlation** | PAPER → DEPLOY_READY | Duplicate-signal failure |
| **B10 MRP** | PAPER → DEPLOY_READY (soft) | Regime-conditional fragility |
| **A14 Black Swan** | PAPER → DEPLOY_READY (Phase 0 advisory) | Unseen-regime fragility |
| **B14 Survival Twin** | PAPER → DEPLOY_READY (HARD — Wave 24) | Per-firm payout-denial / ban risk (40% consistency cap) |
| **C11 Macro Gates** | paper signal | Crisis regime + ISM/RRP stress |
| **C1 CME Outage** | live execution | Block new entries during halts |
| **C2 Firm Suspension** | live execution | Per-firm block on suspension |
| **C8 Windows Reboot** | 8 AM ET pre-market | Pre-market PAUSE if reboot pending |
| **Production Mode Halt** | every openPosition | `killSwitch.isHaltedForProduction()` — FIRST gate |
| **Style C Exit Skip** | every signal | Skip if structural stop > ceiling |
| **2026 Compliance** | every entry | 2% rule, HFT limit, simultaneous-limit-price, MFFU hedging ban |
| **Validation Cadence RED** | infra work approval | No new infra while panel RED |
| **DSL Quality Critic (W23F.K + W23F.L)** | graduation | Anti-pattern matches; engine-aware look-ahead; factory conventions pre-filter |
| **Auditor (W23F live-fix)** | graduation | Schema invariants; accepts both `risk_derived_pyramid` and legacy `profit_tier_pyramid` |
| **Truthiness Check (B-3)** | post-backtest | Invariant harness (B-2) + parity shadow drift (B-1) — audit_log + Discord CRITICAL + SSE on failure |
| **B15 Parameter Robustness Battery** | PAPER → DEPLOY_READY | ±20% parameter jitter test — SDR < 0.85 OR PSI > 0.05 OR RWS > 0.20 → block. Advisory-only when B15_BATTERY_ENABLED=false (30-day grandfather). |
| **B15 Factor Ablation** | confluence factor promotion (advisory) | Required before promoting any confluence factor to standalone hard gate — runs B15 battery twice (with / without factor); delta Sharpe > 0.2 AND delta PF > 0.1 for marginal edge significance. |
| **Wave 25 weighted-score threshold (11-factor)** | every signal (Path C, opt-in) | `confluence_score < threshold` (default 0.72) OR `hard_block_failed` (macro_alignment in event blackout) → reject. 11-factor model post-Pass-2.5 (was 9-factor at Pass 1) with MCL redistribution (internals → cross_asset). Per-factor audit row + decision audit + `signal:weighted_score_rejected` SSE. `signal.confluence_score_factor_unavailable` informational row fires per unsatisfied stub factor (pending_pass5/internals-unavailable). **Post-Pass-3 (2026-05-24): `liquidity_target_clear` factor is LIVE — reads from persistent `liquidity_levels` via paper-signal-service.ts liquidity injection; no longer a stub.** **Post-Pass-4 (2026-05-24): 6/11 factors carry decay confidence via `confluence-decay.ts::deriveFactorDecay()`; `signal.confluence_factor_decayed` info audit fires when satisfied factor's `decay_confidence < DECAY_TELEMETRY_THRESHOLD` (default 0.7); 5 factors skipped (anti-double-decay).** Backward-compat: strategies without `entry_quality.use_weighted_scoring=true` skip this gate entirely. |
| **Trade Critique completion (Wave 26 Pass 1)** | event-driven on every `paper_position` close | Trade critique service auto-fires on position close; writes `trade_critique` row (migration 0141) with dual-output schema (plain-English block + technical attribution block). `data_completeness='minimal'` degrades gracefully via `missingFields[]` (e.g. Wave 25 `smt_score` not yet bridged to live paper). Consecutive 3-strike failure fails OPEN with Discord WARN (`trade_critique.consecutive_failure_alert`); single failures emit `trade_critique.failed`. `MAX_CONCURRENT=3` backpressure protects GPT-5.4 quota; Ollama fallback engages after 3 strikes. Idempotent per `position_id` (`trade_critique.idempotent_skip`). |
| **Topstep consistency 50% block (Wave 26 Pass 6)** | every entry signal (Topstep accounts) | `shouldBlockNewEntry()` evaluates projected single-day P&L concentration against the 40/50% Topstep payout ceiling. ≥50% → BLOCK (`consistency.50pct_blocked`); ≥40% → WARN (`consistency.40pct_warned`). False-positive guard downgrades 50% block to WARN when the offending strategy has clean recent history in a trending regime (`consistency.false_positive_suspected`). Daily 17:00 ET digest cron (`consistency-tracker-daily-digest`) ships family-grade Discord summary. Gate-clear emits `consistency.gate_cleared`. NOT YET wired into `paper-signal-service.ts` entry-gate — deferred to coordination pass after Wave 25 Pass 7 merge (Wave 25 collision zone). |
| **Pattern aggregator min-sample + kill-switch (Wave 26 Pass 4)** | 4h cron (`pattern-aggregator`) | Closes the broken trade-critique feedback loop: aggregates last-N critique rows into `strategy_proposer` appendix updates via `prompt_versions` A/B test gate. `MIN_CRITIQUES_FOR_AGGREGATION=10` (`pattern_aggregator.insufficient_samples`); `auto_patch_loop_enabled` flag (default `true`) gates the LLM call — when `false`, emits `auto_patch.loop_halted_skip` and no prompt is mutated. Architectural fix: `buildPromptSync` retains synchronous contract via `appendixCache` (closes loop without forcing 8 callers to async). Successful appendix application emits `pattern_evolution.applied`; pure no-op runs emit `pattern_aggregator.no_change`. Failure surface: `pattern_aggregator.failed` audit + Discord. |
| **Wave 25 Adaptive Exit Engine** | every signal (exit_style=adaptive) | 15:55 ET hard flatten preserved (NEVER overridden); intraday DOL only (no PWH/PWL/PMH/PML chase); macro_alignment blackout still skips; static_styleC backward-compat preserved verbatim; opt-in per strategy via `scripts/wave25-pass7-adaptive-opt-in.ts --apply` (recommend 1-2 CANDIDATE cohort + 7-14 day audit_log before broader opt-in) |
| **TS↔Python Exit Engine Parity** | CI (npm run check:ts-python-exit-parity) | TS computeExitPlan() and Python compute_exit_plan_python() MUST produce identical tp1.price (±0.01), tp2.price (±0.01), runner_trail_method, scaling tuple, pre-lunch threshold across 5 regime fixtures. Drift = fail-CLOSED. |
| **MC firm-rule version drift check (Wave 27.5 Pass A)** | every Monte Carlo run (`monte-carlo-service.ts` before Python invocation) | Compares `backtests.firm_rules_version` (stamped at INSERT) vs current `computeFirmRulesVersion()` via the TS/Python parity-tested helper pair (SHA-256 over canonical-sorted-JSON of FIRM_CONFIGS+FIRM_RULES). Mismatch → `monte_carlo.firm_rule_version_mismatch` CRITICAL audit row + REFUSE the MC run + Python-side `{status: "rule_version_mismatch"}` structured-error envelope. Closes the silent-drift failure mode where MC graded against stale firm rules after a `firm_config.py` / `prop_compliance.py` edit. Bumping the version is automatic — any change to the rule structs re-hashes deterministically. |
| **MC extrapolation hard-fail (Wave 27.5 Pass A)** | every Monte Carlo return-bootstrap call (`return_bootstrap()`) | When `n_days > MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER × len(history)` (default 2×), raise `ExtrapolationExceededError` → `run_monte_carlo()` returns `{status: "extrapolation_exceeded", ...}` structured-error envelope + `monte_carlo.extrapolation_hard_fail` audit row. Caps research-tier overshoots (Pass A audit found silent 5× extrapolation paths). Operators who genuinely need longer projections must explicitly set the env knob and accept the research-tier framing. Disable entirely (back to old soft-cap behavior) via `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER="infinity"`. |
| **MC ruin probability CI (Wave 27.5 Pass A)** | every B14 Survival Twin consumer of MC output | `compute_all_mc_cis()` now emits `probability_of_ruin_ci` with `{point_estimate, ci_low, ci_high, ci_method, n_resamples}` via BCa bootstrap. B14 hard-gate wiring (lifecycle-service.ts) MUST read `probability_of_ruin_ci.ci_high` as the conservative bound — reading the scalar `probability_of_ruin` is a documented anti-pattern that ignores the quantified uncertainty. Backward-compat preserved: the scalar key remains; new `_ci` key is additive. |
| **WFE > 0.70 (Wave 27.5 Pass B — PAPER → DEPLOY_READY HARD)** | every PAPER → DEPLOY_READY promotion (`lifecycle-service.ts` via `wfe-gate.ts`) | Blocks promotion at `wfe_overall < WFE_HARD_FLOOR` (default `0.70`) — emits `lifecycle.wfe_hard_floor_block` audit + `lifecycle:wfe_evaluated` SSE. **HARDENING FIX 2026-06-22: the band `[WFE_WARN_FLOOR, WFE_HARD_FLOOR)` (default `0.50-0.70`) now BLOCKS** (`passed=false`) — previously it emitted `lifecycle.wfe_warning_below_target` and PROCEEDED, contradicting this row's own "blocks at <0.70" claim. `wfe-gate.ts` was aligned to the documented institutional contract; only `wfe_overall >= 0.70` passes (promotion-gate-orchestrator's stricter 0.80 floor remains defense-in-depth above this). Legacy null (pre-W27.5 backtests with no `wfe_overall`) → PROCEED + `lifecycle.wfe_unavailable_legacy` warn audit (one-time documented fallback during the grandfather window). WFE uses combined-fold Sharpe (OOS / IS) per institutional 2026 standard, NOT per-fold average. Configurable via `WFE_HARD_FLOOR` / `WFE_WARN_FLOOR` env. |
| **Parameter drift overfit_drift gate (Wave 27.5 Pass B — PAPER → DEPLOY_READY HARD)** | every PAPER → DEPLOY_READY promotion (`lifecycle-service.ts` via `parameter-drift-gate.ts`) | Reads `param_stability.drift_classification` + `drift_confidence` from `walk_forward_regime_context.classify_parameter_drift()`. `overfit_drift` AND `confidence ≥ 0.70` → BLOCK + `lifecycle.parameter_overfit_drift_block` audit + `lifecycle:parameter_drift_evaluated` SSE. `indeterminate` (any confidence) → WARN + `lifecycle.parameter_drift_indeterminate_warn` (proceed; operator review). `regime_driven` + `stable` → PASS. Null/missing classification → PROCEED (legacy backtests). The classifier is pure-functional, no scipy, replay-deterministic — fragility ≠ overfit unless regime context disproves the regime-driven hypothesis. |
| **Backtest compliance enforce mode (Wave 27.5 Pass C — DEFAULT)** | every backtest run (`backtest-service.ts` via `src/server/lib/compliance-mode.ts`) | `BACKTEST_COMPLIANCE_MODE=enforce` (default) blocks violating trades at fill time + emits `compliance.enforce_block` audit. `shadow` mode logs `compliance.shadow_logged` without blocking — explicit opt-in for novel-edge research only. Per-backtest override via `backtests.compliance_mode` column (migration 0148 idx 150); precedence: DB column > env var > default. Discord family-grade WARN aggregation fires when blocked-pct > 5%. Closes the silent-passing-through-violations failure mode that the Pass C audit identified as institutional-grade unsound. |
| **Backtest partial fill model (Wave 27.5 Pass C — DEFAULT ON)** | every fill in backtester.py (`src/engine/fill_model.py`) | `BACKTEST_PARTIAL_FILL_ENABLED=true` (default) activates the 3-zone partial-fill model: `order_qty / bar_volume < BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD` (default `0.1`) → 100% fill; `0.1–1.0` → linear degradation; `>1.0` → forced partial fill at degraded price. Large-size strategies on thin-volume bars now reflect realistic execution. Emits `backtest.partial_fill_modeled` audit when degradation applied. Disabling in production is documented as a "Don't" — strategies that rely on idealized fills don't survive live. |
| **MC outlier truncation (Wave 27.5 Pass C — OPT-IN)** | every MC bootstrap call when `MC_TRIM_OUTLIER_MULTIPLIER` is set (default `null`) | Trims trades to ±`multiplier × worst-month` before resampling. Institutional recommendation: `2.0` for default outlier suppression. Emits `monte_carlo.outliers_trimmed` audit with `trimmed_count` + `multiplier`. Trade-off (documented): reduces tail-risk reflection of true catastrophic events — leave `null` for full distribution preservation, opt in when fat-tail events drown the median strategy signal in MC noise. |
| **Backtest zero-volume trade-critical bar (Wave 27.5 Pass D — DEFAULT ON)** | every bar in `_apply_static_styleC_management()` per-bar loop where stop or TP would trigger (`src/engine/backtester.py` via `check_zero_volume_trade_critical()` in `src/engine/data_loader.py`) | `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD=true` (default) raises `ZeroVolumeOnTradeCriticalBar` when a stop/TP-candidate bar has `volume=0` (holiday or data-gap bar). Emits `backtest.zero_volume_trade_critical_raised` audit row. `false` restores legacy silent-skip with stderr warning. Closes silent NaN-ATR-on-holiday-bar failure mode that hid real data gaps. Pass D.5 wired the helper into the backtester per-bar loop (Pass D.3 created the helper; Pass D.5 invokes it). |
| **Backtest VIX margin expansion (Wave 27.5 Pass D — DEFAULT ON)** | every sizing computation when VIX feed available (`src/engine/margin_expansion.py`) | VIX > 30 halves `max_contracts` per CME-published initial-margin-expansion behavior; VIX > 50 quarters. Emits `backtest.margin_expansion_applied` audit with `vix_level` + `expansion_factor`; emits `backtest.margin_expansion_unavailable_no_vix` info audit when VIX feed missing (fail-soft to pre-expansion sizing). Closes the silent-over-sizing-on-high-vol-days failure mode where backtests passed margin ceilings the live broker would reject. |
| **Backtest roll-spread itemization (Wave 27.5 Pass D — DEFAULT ON)** | every position held across roll-day (`src/engine/roll_spread_cost.py`) | `BACKTEST_ROLL_SPREAD_ITEMIZED=true` (default) deducts per-symbol roll-spread ticks from P&L on roll days via `ROLL_SPREAD_<SYMBOL>_TICKS` table; emits `backtest.roll_spread_itemized` audit per roll-day deduction. Previously bundled into generic slippage — itemization improves realism for held-overnight strategies. Disabling restores bundled-in-slippage behavior; documented as a "Don't" for production. |
| **B14 ci_high gate (Wave 27.5 Pass B — PAPER → DEPLOY_READY HARD)** | every PAPER → DEPLOY_READY promotion that has MC output (`lifecycle-service.ts` via `b14-ci-gate.ts`) | Reads `probability_of_ruin_ci.ci_high` (Pass A BCa-bootstrap conservative bound) and BLOCKS when `ci_high > B14_RUIN_CI_HIGH_THRESHOLD` (default `0.40`). Emits `b14.gate_evaluated` audit per evaluation + `lifecycle:b14_evaluated` SSE. Legacy MC runs that emit only the scalar `probability_of_ruin` (pre-W27.5 Pass A) trigger a documented fallback to the point estimate + `b14.legacy_ruin_scalar_fallback` warn audit (grandfather window only — every fresh MC run since 2026-05-25 emits the `_ci` key). Replaces optimistic point-estimate gating with quantified-uncertainty gating; closes the silent-overconfidence path where ruin probabilities near 0.40 with wide CIs were promoting despite institutional-grade danger. | Emits SIGNAL / INCONCLUSIVE / NO SIGNAL / PRELIMINARY verdict to `docs/replay-results/<ISO>-quantum-disagreement.md`. Decision rule: `|ρ| ≥ 0.25 AND p ≤ 0.05 AND n ≥ 50` → SIGNAL (schedule Pass 2 + wire as soft advisory at PAPER → DEPLOY_READY); `0.10 ≤ |ρ| < 0.25` → INCONCLUSIVE (proceed Pass 2 for other tools, do NOT wire quantum gate, re-run after 90d new data); `|ρ| < 0.10` → NO SIGNAL (park at challenger-only governance, document negative result). Below n=50 → PRELIMINARY (defer Pass 2). Statistical methodology: IS-only threshold selection across {0.05, 0.10, 0.15, 0.20, 0.25}, Spearman rank correlation IS-disagreement vs OOS-Sharpe-degradation, binomial test at IS-selected threshold, robustness table at all 5 thresholds. **Advisory-only per challenger governance — does NOT block promotion.** Purge violation (oos_start ≤ is_end on any join row) → `replay_grade_quantum.purge_violation` audit + script exits non-zero. Reuses existing `quantum_mc_runs` table (`governance_labels.replay_mode=true`) — no new schema. **Pass 1.5 (2026-05-25): auto-fires after every backtest completion via fire-and-forget hook in `backtest-service.ts` + `quantum-replay-runner.ts`; weekly Discord verdict emitted Sunday 19:00 ET via `quantum-replay-weekly-analysis` cron (DST-safe double-fire at 23:00 UTC with ET-hour guard); kill switch via `system_parameters.auto_patch_loop_enabled` (shared with Wave 26 pattern-aggregator).** |
| **Wave 27 unified replay grading (advisory — Wave 27 Carry-Forward Master Close)** | `scripts/replay-grade.ts --tool=all` weekly Sunday 19:00 ET (carry-forward to be wired into Wave 27 Pass 1.5 cron) | Unified dispatcher additive over the 7 per-tool harnesses (quantum / confluence / critique / robustness / survival_twin / pattern_aggregator / consistency) backed by `src/server/lib/replay/harness-base.ts` shared infrastructure. Each per-tool emits SIGNAL / INCONCLUSIVE / NO_SIGNAL / PRELIMINARY verdict using the Pass 1 institutional pattern (Spearman + binomial + Mann-Whitney + IS-only threshold + CPCV purge + n ≥ 50 sample-size gate). `--tool=all` aggregate decision: ≥ 3 SIGNAL across tools → operator-review-candidate for hard-gate promotion at PAPER → DEPLOY_READY (mirrors Wave 27.5 Pass B B14 `ci_high` gate pattern). **Advisory-only across all 7 tools — none block promotion until evidence accumulates and operator approves wiring.** PRELIMINARY verdicts will dominate the first 30-90 days until backtest fold accumulation reaches statistical power. Phase 5 ContractSpec scaffold is feature-gated via `TF_PHASE_5_ENABLED=false` default — activation requires operator funded balance ≥ $200K + explicit env flip + per-strategy `contract_class="mini"` declaration; `resolve_contract_spec()` helper refuses ambiguous routing to prevent 10× silent risk inflation. |
| **Composite health score (Wave 28 Pass A — OBSERVABILITY ONLY, NOT A GATE)** | every `strategy-health-aggregator` run (`src/server/services/strategy-health-aggregator.ts`) | Writes one immutable row per strategy per cycle to `strategy_health_scores` (migration 0149, append-only, BIGSERIAL id, JSONB subsystem detail, SHA-256 weights_version_id). **Composite scores DO NOT GATE promotion** — Wave 27.5 hard gates (B14 ci_high, WFE, parameter drift, B15 SDR/PSI/RWS, compliance enforce) retain independent veto power per the 3-Layer architecture. Layer C decision bus + Layer B dashboard tile are READ-ONLY visibility for the operator + family digest. Pass B will introduce shadow gating; Pass C will activate composite-aware tier routing — both evidence-gated on ≥85% composite-vs-hard-gate agreement over 14 days. Until then, composite is dashboard-only. Gated by `MIN_COMPOSITE_SUBSYSTEMS=8` floor (skip-write below); staleness stamped via `staleness_age_hours`; weights frozen at equal-weight per OCC/Fed/FDIC April 2026 MRM. Audit: `composite_health.evaluated` per write; `composite_health.skipped_below_subsystem_threshold` per skip. |
| **Wave 28 composite shadow gate (Pass B — OBSERVABILITY ONLY, NOT A GATE)** | every PAPER → DEPLOY_READY lifecycle evaluation (`src/server/services/lifecycle-service.ts` via `src/server/lib/composite-shadow-gate.ts`) | **ADVISORY-ONLY shadow gate. NEVER blocks promotion.** Pure-function reader derives WOULD_PROMOTE (composite ≥ 0.75) / WOULD_WARN (0.50–0.75) / WOULD_BLOCK (< 0.50) from the latest `strategy_health_scores` row written by Pass A aggregator, alongside a 4-state availability flag {missing, stale, below_threshold, available}. Result logged via `composite.shadow_evaluation` audit row (`composite.shadow_evaluation_error` on internal failure — fail-OPEN, lifecycle proceeds). Disagreement-only Discord routing via `composite-shadow-discord-router.ts`: agreements stay silent, disagreements emit P2 Discord with 24h per-strategy×agreement-type in-memory dedup (`composite.shadow_disagreement_alerted` / `composite.shadow_disagreement_rate_limited` / `composite.shadow_disagreement_discord_failed`). 14-day analyzer `shadow-evidence-analyzer.ts` + `scripts/analyze-shadow-evidence.ts` emits PRELIMINARY / ACTIVATE_PASS_C / INCONCLUSIVE / REVISE_COMPOSITE verdicts (`shadow_analysis.completed` / `shadow_analysis.failed`). **Wave 27.5 hard gates (B14 ci_high, WFE, parameter drift, B15, compliance enforce) retain independent veto power through Pass B.** Pass C activation requires ≥14 days of shadow data + ≥85% agreement. Reuses Pass A `COMPOSITE_MAX_AGE_HOURS=48` staleness ceiling; no new env vars introduced this pass. |
| **graduation_bidirectional_completeness (Wave 26 Pass G B2 — HARD)** | every direct graduation (`src/server/services/direct-bucket-graduator.ts` via `auditBidirectionalCompleteness()` Gate 1) | When `direction=both` and one side empty / `BIDIR_SENTINEL` ("high < low"), REJECT the graduation: revert bucket to `status=pending, graduatedAt=null` (no-poison), write `graduation.rejected_incomplete_bidirectional` audit row, fire Discord WARN via `notify()` + family-grade postscript, and (Pass G B4 wiring) call `emitBidirectionalIncompleteRejected()` for SSE `factory:bidirectional_rejected` + Prometheus `tf_graduation_bidirectional_rejection_total{reason}`. Archetype strategies with sentinel-on-both-sides PASS (archetype owns detection). Helper-side audit row write is suppressed via `skipAuditRow: true` to prevent runtime duplicates. Closes the silent long-only-when-bidirectional bug pattern (LLM extracts one direction; engine ignores the sentinel side and runs as long-only without operator visibility). |
| **graduation_factor_quality_telemetry (Wave 26 Pass G B2 — TELEMETRY)** | every direct graduation that survives Gate 1 (`src/server/services/direct-bucket-graduator.ts` via `classifyFactorSources()` Gate 2) | Classifies each confluence factor as `extracted` (LLM emitted) / `auto_floor` (graduator-injected `regime_match` / `structural_setup` quality floor) / `kb_inferred` (reserved). Computes `factor_quality ∈ {rich, thin, fallback_only}` based on real (extracted+kb_inferred) factor count: ≥2 real → rich; 1 real → thin; 0 real → fallback_only. Attached to `entry_quality.factor_sources` + `entry_quality.factor_quality` in the strategies config JSONB (additive — legacy rows omit these keys; no migration needed). Pass G B4 wires `emitFactorQualityClassified()` for Prometheus `tf_graduation_factor_quality_total{quality}` + `tf_extraction_confluence_depth_histogram` + audit row `graduation.factor_quality_classified` (helper-owned action — no graduator-side competing row). |
| **graduation_thin_confluence_warning (Wave 26 Pass G B2 — ADVISORY)** | every direct graduation that completes with `factor_quality === "fallback_only"` (`src/server/services/direct-bucket-graduator.ts` Gate 3) | Writes `graduation.thin_confluence_warning` audit (status=warning) + Discord WARN + family-grade postscript; (Pass G B4 wiring) calls `emitThinConfluenceWarning()` for SSE `factory:thin_confluence_graduated` (helper-side audit + Discord suppressed via `skipAuditRow: true` to prevent runtime duplicates). Advisory-only — does NOT block or revert. Marks the strategy as library-debt for the next re-extract cycle. Backfill (`scripts/wave26-pass-g-b3-backfill-factor-quality-audit.ts --apply` 2026-05-26) seeded the historical 99 strategies: 0 rich / 30 thin / 69 fallback_only. |
| **Wave 29 Pass C RL kill switch + DSR floor (ADVISORY-ONLY — NEVER gates promotion)** | every composite-health aggregator cycle for the `rl_agent` 13th subsystem (`src/server/lib/rl-signal-fetcher.ts` + `rl-dsr-gate.ts` + Python `quantum_rl_agent.py::compute_rl_kill_switch_state`) | Two-gate availability for RL composite-health feed: `kill_switch_dormant` (advisory Sharpe-gap check — rolling Sharpe gap > `QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT=0.30` engages, returns decision but never mutates) AND `dsr_passed` (DSR ≥ `QUANTUM_RL_DSR_FLOOR=0.5` per QuantBeckman 2025 + arXiv 2512.12924, Abramowitz-Stegun 26.2.17 probit). `normalizeRLConfidence(rl_confidence, dsr_passed, kill_switch_dormant)` returns `null` when either gate fails (subsystem unavailable; counts toward `MIN_COMPOSITE_SUBSYSTEMS=8` floor as null). Audit: `quantum_rl.{kill_switch_evaluated, kill_switch_engaged, dsr_passed, dsr_floor_block}`. CHALLENGER-ONLY: RL signal is one of 13 composite subsystems, NEVER a hard gate. Wave 27.5 (B14 ci_high, WFE, parameter drift, B15, compliance enforce) and Wave 28 Pass B shadow gate retain authoritative veto. A/B paper routing (`slumdawg-baseline` vs `slumdawg-rl-challenger`) per migration 0159 lets the operator measure marginal edge without risking baseline flow. CPCV purge gate (`rl-training-cpcv-gate.ts`) rejects training rows whose `bar_date` falls inside any OOS [start,end] range — emits `quantum_rl.training_cpcv_purge_violation` and refuses the training run. |
| **Wave 29 Pass A.2 PBO < 15% (TESTING → SHADOW/PAPER HARD)** | every TESTING → SHADOW and TESTING → PAPER lifecycle transition (`src/server/lib/pbo-gate.ts` invoked from `lifecycle-service.ts`; backed by `src/engine/pbo_gate.py` Bailey et al. rank-based PBO + `src/engine/walk_forward.py` aggregation) | Blocks promotion when `pbo_overall > PBO_OVERFIT_THRESHOLD_PCT` (default `0.15` — institutional 2026 standard, stricter than Wave 27.5 PBO_OVERFIT_THRESHOLD=0.5 catch-all). Emits `lifecycle.pbo_overfit_block` audit + `lifecycle:pbo_evaluated` SSE on block; `walk_forward.pbo_computed` per aggregation; `walk_forward.pbo_high_overfit_risk` warn when computed and crossing threshold. Legacy backtests with no `pbo_overall` field (pre-Wave-29) emit `lifecycle.pbo_unavailable_legacy` and PROCEED (grandfather window — every fresh walk-forward since 2026-05-26 emits the key). Both promotion routes from TESTING (to SHADOW and to PAPER) are gated identically — there is no PBO-bypass path. |
| **Wave 26 Pass K Phase 1 — Daily Trade Cap (HARD, signal-time)** | every paper-trading entry signal (`paper-signal-service.ts` via `src/server/lib/daily-trade-cap.ts`) | Operator's "1-2 A+ trades/day per account" mandate enforced as HARD SIGNAL-TIME GATE. Default `TF_MAX_TRADES_PER_DAY=2` (operator default; 3rd signal of the day is the first rejected). Per-session override via `paper_sessions.config.max_trades_per_day` (precedence: DB > env > default). Counting = paper_trades rows CLOSED on the current CME futures trading day (matches `paper-execution-service.ts:925` convention; trades closed 17:00–23:59 ET count toward NEXT day's quota). Scope = per-session (one prop-firm account = one independent quota). Emits `consistency.daily_trade_cap_blocked` audit + `daily_trade_cap_blocked` span attribute on block; joins the `lockoutBlocked` aggregation so downstream gates short-circuit. Fail-OPEN on DB error (warn audit; better to let one trade slip than silently halt). The post-fill Python kill switch (`paper-execution-service.ts:913`) continues to enforce `sessionCfg.max_trades_per_day` as a belt-and-suspenders defense for anything that somehow slips past the signal-time gate. |
| **Wave 29 Pass A.3 Shadow-signal divergence < 5% (SHADOW → PAPER HARD)** | every SHADOW → PAPER lifecycle transition (`src/server/lib/shadow-signal-divergence-checker.ts` + `shadow-signal-divergence-loader.ts` invoked from `lifecycle-service.ts` Gate 2.5) | Blocks promotion when `divergence_pct ≥ SHADOW_DIVERGENCE_THRESHOLD_PCT` (default `0.05`) across `≥ SHADOW_DIVERGENCE_MIN_SAMPLE` shadow signals (default `20`). Emits `lifecycle.shadow_divergence_blocked` on hard block + `lifecycle:shadow_divergence_evaluated` SSE; `lifecycle.shadow_divergence_insufficient_samples` when below the 20-sample floor (blocks until enough shadow data accumulates); `lifecycle.shadow_promotion_passed` on clean SHADOW → PAPER promotion. Legacy/missing `lifecycle_shadow_signals` table → `lifecycle.shadow_divergence_check_unavailable_legacy` warn + PROCEED (one-time grandfather; new strategies cannot bypass — migration 0160 creates the table on next deploy). Catches training-serving skew, institutional grade #1 failure mode (15-25% of all institutional model failures per AltStreet Quant 2.0 Dec 2025). The Wave 29 Pass A.4 architect close reconciled the A.3 placeholder so the gate now operates on live SHADOW-state strategies (was no-op empty-array stub at Round 1 commit). |
| **Frozen-policy hash drift (PAPER → DEPLOY_READY HARD — Wave 29 Pass B.2)** | every PAPER → DEPLOY_READY lifecycle transition AFTER all Wave 27.5 hard gates clear (`src/server/lib/frozen-policy-contract.ts` invoked from `lifecycle-service.ts`; HMAC override route `POST /api/admin/frozen-policy-override`) | Hash mismatch blocks promotion without operator HMAC override. SHA-256 computed over canonical-sorted-JSON of the 5-field policy slice {`entry_quality`, `position_size`, `stop_loss`, `take_profit`, `exit_plan_config`} (mirrors `firm-rules-version.ts` canonical-sort pattern; full 64-char digest, not truncated). Strategies are frozen when CPCV + PBO + WFE all pass simultaneously — `strategies.frozen_policy_hash` + `frozen_policy_set_at` + `regime_trained_on` stamped via migration 0161. Re-promotion with mutated 5-field slice → `lifecycle.frozen_policy_drift_blocked` audit + BLOCK. Operator override path: `POST /api/admin/frozen-policy-override` with HMAC signature (60s drift via `ADMIN_OVERRIDE_HMAC_SECRET`) + rationale string ≥50 chars; increments `strategies.frozen_policy_override_count` + emits `frozen_policy.override_used`. Rationale-too-short → `frozen_policy.override_rationale_too_short` reject. Hash compute exceptions → `frozen_policy.hash_compute_failed` audit + fail-CLOSED (block promotion until manual investigation). Closes the silent-retraining-drift failure mode per CFA Institute Halperin/Kolm/Ritter Nov 2025 institutional 2026 mandate. The 5-field slice is intentionally narrow — name/symbol/timeframe edits do NOT invalidate the hash (cosmetic ops stay friction-free). |
| **Regime drift auto-demotion (daily cron — Wave 29 Pass B.3)** | daily 18:00 ET cron `regime-drift-detector` (DST-safe double-fire at 21,22 UTC with ET-hour guard, `_PIPELINE_GATE_EXEMPT`, `_tryAcquireJobLock` overlap guard) — `src/server/services/regime-drift-detector-service.ts` | For every DEPLOYED strategy, compares current `bias_state.institutional_regime` vs `strategies.regime_trained_on` (stamped by Pass B.2 frozen-policy contract). 5-consecutive-day institutional_regime drift → `strategy.regime_drift_detected` warn audit + Discord WARN + two-step demotion `DEPLOYED → DECLINING → TESTING` + `lifecycle.regime_drift_demotion` audit. Two-step preserves observability of the transition over a single-step jump. Fresh CPCV + PBO + WFE pass required before re-promotion (re-freeze recomputes hash + re-stamps regime_trained_on). Legacy strategies with `regime_trained_on=NULL` skip via `regime_drift_detector.legacy_strategy_skipped` info (grandfather window — Pass B.2 stamps the column on next freeze). Cron emits `regime_drift_detector.completed` per tick with summary counts; overlap re-entry → `regime_drift_detector.skipped_lock_contention`; DST guard mismatch → `regime_drift_detector.skipped_dst_guard`. `_PIPELINE_GATE_EXEMPT` ensures the cron runs even when the pipeline is paused. Closes the silent-stale-regime failure mode where strategies trained on TRENDING continue trading through a regime shift to COMPRESSION without re-validation. |
| **Wave 29 observability surface (Pass D.1 — ADVISORY-ONLY)** | every metrics-scrape + every lifecycle/RL event broadcast — `src/server/lib/metrics-registry.ts` + `src/server/routes/sse.ts` (`WAVE29_EVENTS` catalog) | Institutional 2026 observability surface emitting 9 new Prometheus counters/gauges: `tf_pbo_blocks_total{regime}`, `tf_shadow_signals_total{strategy_id,divergence_bucket}`, `tf_rl_training_epochs_total{regime}`, `tf_rl_kill_switch_total{reason}`, `tf_rl_ab_sharpe_delta`, `tf_rl_ab_pnl_delta`, `tf_frozen_policy_overrides_total`, `tf_regime_drift_detections_total{from_regime,to_regime}`, `tf_lifecycle_shadow_promotions_total{outcome}` + 6 SSE events: `signal:shadow_logged`, `signal:rl_ab_routed`, `lifecycle:pbo_evaluated`, `lifecycle:shadow_divergence_evaluated`, `quantum_rl:training_completed`, `quantum_rl:kill_switch_engaged`. Operator phone-tappable dashboards + family-grade Discord digests consume the surface; no gating logic depends on these surfaces. Disabling individual counters or SSE broadcasters degrades operator observability without any safety benefit — treat as production-critical instrumentation. |
| **Wave 29 A/B weekly digest (Pass D.3 — ADVISORY-ONLY)** | Friday 17:00 ET cron `ab-comparison-weekly-digest` (DST-safe double-fire at 21,22 UTC with day-of-week + ET-hour guards, `_PIPELINE_GATE_EXEMPT`, `_tryAcquireJobLock` overlap guard) — `src/server/services/ab-comparison-weekly-digest-service.ts` | Compares slumdawg-baseline vs slumdawg-rl-challenger paper sub-accounts (seeded by Wave 29 Pass C migration 0159) and emits 7-day Sub2-Sub1 Sharpe deltas + cumulative P&L deltas + regime breakdown of edge concentration + RL training epoch count + kill switch armed/engaged sessions to Discord via `appendFamilyGradePostscript`. Discord post failure is caught and continues to completion audit (`ab_comparison_digest.completed`); overlap re-entry → `ab_comparison_digest.skipped_lock_contention`; DST guard mismatch → `ab_comparison_digest.skipped_dst_guard`; Discord failure → `ab_comparison_digest.discord_failed`. ADVISORY-ONLY — the comparison never gates promotion; Wave 27.5 + Wave 28 + Wave 29 hard gates retain authoritative veto power. Surface exists for evidence accumulation (~30-60 days) before any future hard-gate wiring decision on the RL signal. |

---

## §13. Don't (organized by category)

### Data
- Don't backtest on raw/unadjusted continuous contracts — use `ratio_adj/` data
- Don't use Pandas for data loading — Polars only; convert to Pandas at vectorbt boundary
- Don't pass slippage/fees to vectorbt for futures — compute P&L manually
- Don't model slippage as a constant — it's a function of volatility + session

### Execution
- Don't use fixed-point stops on MES (10pt/12pt/etc) — structural with ATR bounds. Floor 1.5×ATR, ceiling 14pt. Skip if exceeded.
- Don't use stop-market orders — use stop-limit
- Don't trade through FOMC/CPI/NFP without `bypass_news_blackout=true` opt-in
- Don't pyramid into winners (Style B) — wrong distribution
- Don't trip kill switch at 95% of firm DLL — 67% leaves buffer
- Don't bypass `routeOrder()` — every order flows through broker-router
- **Don't bypass `macro_alignment` hard-block (Wave 25 Path C)** — FOMC/CPI/NFP days are non-negotiable rejects regardless of other factor scores. The weighted score is forced to 0 when `calendarBlocked=true`. There is no per-strategy override and no env-var escape. If you find yourself wanting to bypass this, the answer is to skip the trade.
- **Don't auto-flip pre-Wave-25 strategies to `exit_style="adaptive"` without operator approval.** Wave 25.5 wired adaptive exits LIVE 2026-05-24, but the default is still `static_styleC` to preserve backward-compat on the 74+ graduated strategies. New strategies may default adaptive once operator confirms cohort results; existing graduated strategies stay on static_styleC until operator opts each in via `scripts/wave25-pass7-adaptive-opt-in.ts --apply` (recommend 1-2 CANDIDATE strategies first, 7-14 day audit_log instrumentation before broader rollout).

### Compliance
- Don't simulate strategies against a firm without loading the firm's 2026 rules doc first
- Don't ignore firm contract caps in backtests
- Don't flip symbol from MES → ES (or micro→mini) without `contract_class="mini"` + mini specs migration. CONTRACT_SPECS use MICRO point values; flipping causes 10x silent risk inflation.
- Don't deploy without preferred regime tag

### Operations
- Don't trigger cloud quantum on auto-triggered backtest runs — cloud is opt-in only
- Don't bypass `pipelineGate()` on lifecycle-mutating crons
- Don't import research-side modules into `src/server/production/*` — CI lint enforces
- Don't bypass `killSwitch.isHaltedForProduction()` — FIRST gate in any new entry path
- Don't bypass `dead-mans-heartbeat-check`
- Don't disable `bitwarden-session-refresh-daily`
- Don't auto-promote Tier 2/3 in operator-absent mode — only Tier 1 qualifies
- Don't create fire-and-forget runs without a pending DB row
- Don't store secrets in code — use `.env` or Bitwarden vault
- Don't commit the `data/` directory — gitignored, lives in S3
- **Don't auto-expand the adaptive cohort.** Operator must apply `--strategy crt` or `--strategy power_of_3` manually via `scripts/wave25-pass7-adaptive-opt-in.ts --apply` AFTER 7-day clean evidence from cohort audit report (see docs/wave26-cohort-decision-rules.md).
- **Don't disable `QUANTUM_REPLAY_AUTO_FIRE_ENABLED` in production .env (Wave 27 Pass 1.5)** — the harness is intentionally opt-OUT for autonomous agent runs because agents drive backtests without remembering manual commands. Only disable for short-term debugging; flip back ON the moment debugging is done. The whole point of Pass 1.5 was closing the manual-command autonomy gap.
- **Don't bypass the `auto_patch_loop_enabled` kill switch (Wave 27 Pass 1.5)** — it's the only operator-phone-tappable halt for both Wave 26 pattern-aggregator AND Wave 27 quantum-replay-weekly-analysis. Both auto-loops gate on the same `system_parameters` flag intentionally: one SQL row update halts every autonomous prompt/replay mutation. Adding a parallel kill switch defeats the unification.

### Family Distribution
- Don't assign same strategy to 2+ family members on the same MFFU firm
- Don't hardcode firm allowlists — read from `instance_config.enabled_firms`
- Don't regenerate HMAC secrets per Pine export — must be idempotent per `(account_id, strategy_id)`
- Don't share Pine source code with anyone outside the family
- Don't run the bot from a VPN/VPS — Topstep + MFFU both ban this

### Architecture
- Don't add Supabase or complex auth — single operator, no SaaS
- Don't over-engineer — MVP each phase, iterate
- **Ship gates STRICT, then loosen with DATA — not fear (2026-06-24).** The system stacks many entry gates (11-factor confluence@0.72, macro/lunch blackout, PM taper, DLL bands, daily-trade-cap, structural-stop ceiling, B15/PBO/WFE) — each REDUCES trade count; stacked, they can strangle the edge ("death by a thousand filters" → a bot that can't lose but can't win). The operator trades BIG MOVES (14-24pt Style C 2R+, NOT scalps), so a gate blocking a big-move A+ setup is the EXPENSIVE error. Diagnose with `src/engine/gate_block_analyzer.py` — for every gate-BLOCKED signal (`paper_signal_logs` acted=false) it replays the FAITHFUL counterfactual (real per-symbol framework stop 14/62/1.00pt + Style C exit + same fill model on real forward bars) and verdicts each gate COSTING (blocked big-move winners) vs SAVING (blocked losers). Run: `python -m src.engine.gate_block_analyzer <name> --since <iso>`. Loosen only the gates the DATA shows are blocking winners. Env: `GATE_BLOCK_BIG_MOVE_POINTS_<SYM>`, `STOP_CEILING_PTS_<SYM>`. Fail-closed (INDETERMINATE on missing forward bars, never fabricated); needs paper/backtest block data to verdict.
- Don't generate complex strategies — max 5 parameters
- Don't optimize parameters to find "the best" — test robustness across a wide range
- Don't add backwards-compat hacks unless explicitly required
- **Don't use `sql\`col = ANY(${jsArray})\`` for Drizzle array filters** — use `inArray(col, array)` instead
- **Don't reintroduce Style D** — Wave 23 canonical is Style C 33/33/33. No styleD key in framework-overlay.ts.
- **Don't use single global liquidity cap** — per-symbol (MES 100 / MNQ 50 / MCL 30). Override per-strategy only with evidence.
- **Don't write hit-rate / win-rate targets in spec** — win rate is OBSERVED output, never a design parameter. Gates measure expectancy/PF/Sharpe/regime survival, all hit-rate-agnostic.
- **Don't preserve LLM-extracted sizing values in framework overlay** — overlay is AUTHORITATIVE, replaces scout-extracted base/tier/cap with operator-canonical Wave 23 values.
- **Don't deploy a strategy without B15 Parameter Robustness Battery passing.** SDR ≥ 0.85, PSI ≤ 0.05, RWS ≤ 0.20 per QuantForgeAnalytics 2026-05-16 institutional spec — perturbation-fragility kills strategies that survive WF/CPCV/PBO/DSR. Optuna plateau variance is necessary but not sufficient.
- **Don't make `buildPromptSync` async (Wave 26 Pass 4)** — the appendixCache pattern relies on its synchronous contract; 8 callers depend on it. The pattern-aggregator pre-warms the cache from DB so the prompt-builder stays sync. Forcing async cascades through every prompt-construction call site and re-breaks the feedback loop the architectural fix just closed.
- **Don't manually edit `prompt_versions` rows (Wave 26 Pass 4)** — the pattern-aggregator owns `strategy_proposer` appendix updates via the A/B test gate. Manual edits bypass the min-sample guard, rollback path, and `pattern_evolution.applied` audit trail. If you need to roll back a bad appendix, do it through the aggregator's rollback path, not by hand-mutating the row.
- **Don't bake `macro_alignment` bypass into `trade_critique` parameter hints (Wave 26 Pass 1)** — the rubric treats macro hard-block as a HARD RULE; critique parameter_hints must never propose relaxing it. If a critique surfaces such a hint, it is a rubric regression — fix the rubric, not the gate.
- **Don't change `transcript_extractor` prompt or KB cards without re-running 5-fixture parity test (Wave 26 Pass G B1 v10 update — 2026-05-26)** — extractor quality (`gemma4:e2b` primary, operator's choice) is entirely prompt-dependent. The v10 strict-fill prompt + KB cards (strategy-schema-snapshot.json + indicator-catalog.md including the new `## Confluence Factor Vocabulary` section, lines 549-635) + 6 few-shot fixtures form the calibrated extraction surface. v10 over v9: concept normalization, 11-factor confluence vocabulary, bidirectional-default semantics, awareness of new archetypes (bounce_off_level, ict_bias_aligned_continuation). The 5-fixture parity test is the gate: `tsx scripts/wave26-gemma4-smoke-test.ts --parity-only` MUST report `PARITY SPEC VALIDATION: PASS` before any change is merged. Prompt is at `src/agents/transcript-extractor.md` — treat as read-only between parity tests.
- **Don't write to `quantum_mc_runs` without `governance_labels.replay_mode` flag (Wave 27 Pass 1)** — replay rows and live cloud-quantum rows must be queryably distinguishable. Replay harness writes `{replay_mode: true, cpcv_fold: <wf_window_id>, fold_phase: "is"}` per row; live quantum path leaves `replay_mode` unset/false. Any analysis script that conflates the two contaminates statistical signal and breaks the Pass 1 decision rule.
- **Don't import from the `src.engine.replay` package (Wave 27 Pass 1)** — use direct sub-module imports (`from src.engine.replay.db_loader import ...` / `from src.engine.replay.quantum_replay import ...`) per circular-import workaround documented in `src/engine/replay/db_loader.py`. The `__init__.py` is intentionally minimal — importing through the package surface triggers a load cycle through `quantum_mc.py` that breaks pytest collection and CLI invocation.
- **Don't change `firm_config.py` / `prop_compliance.py` rules without bumping `firm_rules_version` (Wave 27.5 Pass A)** — backtests stamp the version at INSERT and MC drift-checks against current. Stale edits silently grade strategies against the wrong rules. The version helper computes deterministically via SHA-256 of canonical-sorted-JSON over FIRM_CONFIGS+FIRM_RULES — so any structural change re-hashes automatically. The "don't" is editing the rule data structures in a way the helper doesn't see (out-of-band YAML overrides, ad-hoc patches in caller code, etc.). If you add a new firm or new rule field, add it to the canonical struct or extend the helper — never hide it.
- **Don't set `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER` above 2.0 in production (Wave 27.5 Pass A)** — 5× return-bootstrap extrapolation is research-tier only. The audit caught silent 5× paths grading B14 with no quantified uncertainty. Production-grade MC must run at ≤2× history. Override is permitted for offline research runs; flip back to default before re-engaging B14 promotion decisions.
- **Don't read `probability_of_ruin` as a scalar for promotion decisions (Wave 27.5 Pass A)** — always use `probability_of_ruin_ci.ci_high` for the conservative bound. The scalar key is preserved for backward-compat / diagnostic logging, but B14 hard-gate wiring (lifecycle-service.ts → DEPLOY_READY) MUST gate on the CI upper bound. Reading the point estimate ignores the quantified uncertainty the BCa bootstrap exists to surface.
- **Don't read `probability_of_ruin` scalar for promotion decisions — use `probability_of_ruin_ci.ci_high` for the conservative bound (Wave 27.5 Pass B B14 gate is canonical).** Pass B wired the live HARD gate in `lifecycle-service.ts` via `b14-ci-gate.ts`; the scalar fallback path emits `b14.legacy_ruin_scalar_fallback` warn for pre-W27.5 MC outputs only and is not a contract surface anyone should depend on. New code reading the scalar where the `_ci` key is available is a regression.
- **Don't ship strategies with WFE < 0.70 unless `WFE_HARD_FLOOR` is explicitly lowered with documented rationale (Wave 27.5 Pass B).** The 0.70 floor is the institutional 2026 standard. `lifecycle-service.ts` blocks at PAPER → DEPLOY_READY via `wfe-gate.ts` and emits `lifecycle.wfe_hard_floor_block`. Lowering the floor for one promotion requires an env override + audit-log rationale row — never edit the default or bypass the gate in code.
- **Don't run backtests in shadow compliance mode unless explicitly tagged as novel-edge research (Wave 27.5 Pass C).** Institutional default is `BACKTEST_COMPLIANCE_MODE=enforce` — violations BLOCK at fill time and emit `compliance.enforce_block`. Shadow mode (`compliance.shadow_logged` without blocking) only exists as an opt-in for novel-edge research where you need to see what a violating strategy WOULD do. Production-grade promotion decisions must run in enforce mode. Per-backtest override via the `backtests.compliance_mode` column (migration 0148); flip the env var only for research-wide cohorts and document the rationale.
- **Don't disable `BACKTEST_PARTIAL_FILL_ENABLED` in production (Wave 27.5 Pass C).** Large-size strategies on thin-volume bars need the 3-zone partial-fill model to reflect realistic execution. Disabling it silently restores the idealized-fill assumption the Pass C audit caught as institutional-grade unsound. Strategies that look profitable only when this is off do not survive live. The opt-OUT exists for narrow debugging of fill-model itself — never as a permanent production knob.
- **Don't dismiss `monte_carlo.autocorr_detection_failed` audits as noise (Wave 27.5 Pass C).** The `_safe_autocorrelation` NaN guard fallback to block-bootstrap is the conservative path (wider CIs = more risk reflection, not less). A single audit row is benign. Persistent emission across multiple MC runs on the same backtest indicates the return series has structural autocorr-detection problems the IID-bootstrap path can't see — investigate the return-series construction, do not silence the audit.
- **Don't dismiss parameter drift classification (Wave 27.5 Pass B).** `overfit_drift + confidence ≥ 0.70` is a HARD-BLOCK at PAPER → DEPLOY_READY (`parameter-drift-gate.ts`); `indeterminate` is a soft-warn requiring operator review (`lifecycle.parameter_drift_indeterminate_warn`); only `regime_driven` and `stable` pass without scrutiny. Treating the drift block as cosmetic and re-running with shifted seeds defeats the regime-context analysis the classifier exists to provide.
- **Don't bundle roll spread costs into generic slippage — itemize per-symbol via `ROLL_SPREAD_<SYMBOL>_TICKS` table per W27.5 Pass D** (`src/engine/roll_spread_cost.py`). Bundled-slippage hides the roll cost on held-overnight positions and silently inflates backtest edge for any strategy that crosses the front-month roll. Itemized deduction emits `backtest.roll_spread_itemized` audit per roll day. Default ON via `BACKTEST_ROLL_SPREAD_ITEMIZED=true`. Disabling it returns to the bundled-slippage failure mode the Pass D audit identified as institutionally unsound.
- **Don't use symbol-agnostic commission for Phase 5 minis — use `getContractClass()` + `FIRM_COMMISSIONS` table per W27.5 Pass D** (`src/server/lib/contract-class.ts` + Pass D.1 paper-parity changes). Mini contracts (true ES/NQ/CL post-Phase-5 deployment) have 10× the point value and corresponding commission scaling vs micros. Symbol-agnostic commission rates silently under-cost mini-contract backtests. When Phase 5 deploys, add true-mini `ContractSpec` entries with 10× point values (Pass D.2 documented this carry-forward).
- **Don't disable `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD` in production — silent NaN ATR on holiday bars hides real data gaps (W27.5 Pass D).** The fail-loud default raises `ZeroVolumeOnTradeCriticalBar` when a stop/TP-candidate bar has `volume=0` — holiday/data-gap bars must not produce fills. The legacy silent-skip path (env=false) was the audit's M1 finding and exists only for backward-compat with old fixtures. Production-grade backtests must surface zero-volume trade-critical bars as data-integrity signals, not silently route around them.
- **Don't activate `TF_PHASE_5_ENABLED` in production .env without operator confirmation of funded balance ≥ $200K (Wave 27 Carry-Forward Master Close).** The Phase 5 true-mini ContractSpec scaffold (ES/NQ/CL) is intentionally feature-gated to default `false`. Flipping it without an explicit operator confirmation + per-strategy `contract_class="mini"` declaration risks 10× silent risk inflation when ambiguous ES/MES symbol routing resolves to mini point values. The `resolve_contract_spec()` helper refuses ambiguous routing while the gate is off — bypassing the helper is equivalent to bypassing the safety contract. Activation is a deployment decision, not a code decision.
- **Don't bypass `dryRun=true` in any `scripts/replay-grade-*.ts` harness (Wave 27 Carry-Forward Master Close).** The 7 replay-grading harnesses pass `dryRun=true` structurally through to the services they reanalyze (trade_critique, pattern_aggregator, consistency_tracker, robustness, confluence, critique, survival_twin). Manual override would pollute production tables during evidence accumulation — every replay row would mutate live state instead of grading historical decisions read-only. The harnesses exist to grade evidence, not to re-run live mutations. If you need to actually run the service, invoke it directly through its production code path; never repurpose the replay harness.
- **Don't gate promotion on composite shadow result — Wave 27.5 hard gates remain authoritative through Pass B (Wave 28 Pass B).** The composite shadow gate (`composite-shadow-gate.ts` invoked from `lifecycle-service.ts`) is ADVISORY-ONLY. WOULD_PROMOTE / WOULD_WARN / WOULD_BLOCK is logged via `composite.shadow_evaluation` but lifecycle decisions are made exclusively by Wave 27.5 hard gates (B14 ci_high, WFE, parameter drift, B15 SDR/PSI/RWS, compliance enforce). Pass B exists to accumulate 14 days of shadow vs hard-gate evidence; Pass C activation is gated on ≥85% agreement per `shadow-evidence-analyzer.ts` ACTIVATE_PASS_C verdict. Wiring the shadow gate into a hard-block path before Pass C analyzer verdict bypasses the evidence-accumulation contract that exists to prevent over-trusting an unproven composite. Internal evaluation errors fail-OPEN by design (`composite.shadow_evaluation_error` + lifecycle proceeds) — never convert this to fail-CLOSED until Pass C.
- **Don't write RL output to `quantum_mc_runs` — namespace separation is institutional-grade requirement; use `quantum_rl_runs` (migration 0152, Wave 29 Pass C).** RL training output (`policy_state`, `value_estimates`, `regime_breakdown`, `dsr_passed` governance) and quantum Monte Carlo replay output (`quantum_mc_runs` with `governance_labels.replay_mode=true`) live in separate tables BY DESIGN to prevent the circular IAE-vs-RL feedback loop the Pass C audit identified as institutional-grade unsound. Any script that conflates them contaminates downstream replay-grading statistics and breaks the Pass 1/1.5 decision rule. Audit namespace `quantum_rl.*` is similarly separate from `quantum_mc.*` and `quantum_replay.*`.
- **Don't pass `n_actions=3` to TradingEnv constructor — LONG/FLAT only per day-trader mandate (Wave 29 Pass C.1).** The constructor raises ValueError on n_actions=3. Day-trader-only mandate excludes shorts in the RL agent's action space (EOD trailing DD makes overnight shorts incompatible; intraday-only universe in MES/MNQ/MCL is the operator's reality). The 2-action LONG/FLAT space is the hard contract — any future agent that wants to expand must add a separate ENV class, not relax the assertion in `TradingEnv.__init__`.
- **Don't enable IBM cloud QPU without two-gate check (`QUANTUM_RL_IBM_CLOUD_OPT_IN=true` AND `QUANTUM_CLOUD_ENABLED=true` AND `IBM_QUANTUM_TOKEN` set) (Wave 29 Pass C.2).** All three must be present; missing any one short-circuits to local lightning.gpu sim. The two-gate exists because IBM cloud paths carry per-job pricing + Heron QPU queue latency + governance-label propagation that the operator must consciously opt into. Hard-coding the cloud path or bypassing the env checks defeats the cost-control contract and may exhaust the free-tier QPU budget without operator visibility. AWS Braket stub at `quantum_mc.py:453-459` stays a stub — Wave 30+ candidate only.
- **Don't gate promotion on RL signal — RL is challenger-only; Wave 27.5 + Wave 28 gates remain authoritative (Wave 29 Pass C).** The composite-health 13th-subsystem feed via `rl-signal-fetcher.ts` + `normalizeRLConfidence()` is ADVISORY ONLY. RL signal contributes 1/13 weight to the Wave 28 composite shadow gate, which itself is observability-only through Pass B. Wiring RL into a hard-block path at PAPER → DEPLOY_READY bypasses the entire Pass C governance contract that exists to prevent over-trusting an unproven RL policy. Family-account A/B routing must NEVER assign `rl-challenger` — the operator's own accounts only, with explicit `paper_account_routing='rl-challenger'` on a per-strategy basis.
- **Don't bypass SHADOW lifecycle stage for new strategies — training-serving skew is institutional grade #1 failure mode (Wave 29 Pass A.1 + A.3).** TESTING → SHADOW → PAPER is the canonical ladder. Direct TESTING → PAPER promotion bypasses the shadow-signal divergence check that catches training-serving skew (15-25% of all institutional model failures per AltStreet Quant 2.0 Dec 2025). The PBO gate at TESTING → SHADOW and the divergence gate at SHADOW → PAPER are additive HARD gates; the only reason a strategy should skip SHADOW is a legacy pre-Wave-29 row in the grandfather window, never a new graduate. Setting `shadow_mode_enabled=true` is a deliberate institutional-grade default for any strategy entering PAPER; flipping it off without operator-documented rationale defeats the purpose of Pass A.
- **Don't bypass the frozen-policy hash gate by manually editing strategy config JSONB — institutional 2026 mandate per CFA Institute Halperin/Kolm/Ritter Nov 2025; HMAC override with rationale ≥50 chars is the audited path (Wave 29 Pass B.2).** The frozen-policy SHA-256 contract (`src/server/lib/frozen-policy-contract.ts`) hashes the 5-field slice {entry_quality, position_size, stop_loss, take_profit, exit_plan_config} at CPCV + PBO + WFE pass time and stamps `strategies.frozen_policy_hash`. Re-promoting a strategy with mutated config JSONB triggers `lifecycle.frozen_policy_drift_blocked` at PAPER → DEPLOY_READY. The ONLY audited path to re-promote is `POST /api/admin/frozen-policy-override` with HMAC + rationale ≥50 chars; rationale-too-short → `frozen_policy.override_rationale_too_short` reject. Manual SQL UPDATE on `strategies.config` to "fix" a frozen strategy bypasses the override audit trail and breaks the Resonanz Capital 2026-02-10 due-diligence framework the override count exists to surface. If you find yourself wanting to bypass, the answer is to run a fresh CPCV + PBO + WFE pass (which re-freezes the hash automatically).
- **Don't change the 5-field hash slice (entry_quality + position_size + stop_loss + take_profit + exit_plan_config) — adding fields silently invalidates all existing frozen hashes; treat as a versioned model-change event (Wave 29 Pass B.2).** The slice is intentionally narrow so cosmetic edits (name, symbol routing, timeframe metadata) don't trigger drift blocks. Adding `entry_indicator` or `confluence_factors` or any new field to `FROZEN_POLICY_FIELDS` in `frozen-policy-contract.ts` invalidates every existing `frozen_policy_hash` in the database simultaneously and forces an HMAC-override storm on every DEPLOYED strategy. If the slice genuinely needs to evolve, treat it as a versioned migration: add a `frozen_policy_version` column, gate the hash function on the version, and migrate strategies forward deliberately (NOT via a silent code change that re-hashes everything on the next promotion attempt). The 5-field slice is the Wave 29 contract surface; respect it.
- **Don't disable Wave 29 Prometheus counters or SSE broadcasters — they're the institutional 2026 observability surface for the RL agent + A/B test; operator phone-tappable dashboards depend on them (Wave 29 Pass D.1 + D.3).** The 9 new Prometheus counters/gauges (`tf_pbo_blocks_total`, `tf_shadow_signals_total`, `tf_rl_training_epochs_total`, `tf_rl_kill_switch_total`, `tf_rl_ab_sharpe_delta`, `tf_rl_ab_pnl_delta`, `tf_frozen_policy_overrides_total`, `tf_regime_drift_detections_total`, `tf_lifecycle_shadow_promotions_total`) and 6 WAVE29_EVENTS SSE constants (`signal:shadow_logged`, `signal:rl_ab_routed`, `lifecycle:pbo_evaluated`, `lifecycle:shadow_divergence_evaluated`, `quantum_rl:training_completed`, `quantum_rl:kill_switch_engaged`) are the only path the operator has to phone-monitor RL training progress + A/B Sharpe delta accumulation + kill-switch engagements without SSH'ing into the box. The Friday A/B weekly digest cron + `AbSharpeComparisonTile.tsx` render on top of this surface; disabling any single counter or broadcaster silently degrades operator visibility into the slumdawg-baseline vs slumdawg-rl-challenger marginal-edge comparison. Removing or short-circuiting them as "performance optimization" or "noise reduction" defeats the institutional evidence-accumulation contract that exists to inform any future hard-gate wiring decision on the RL signal. Treat as production-critical instrumentation, same severity tier as audit_log writes.
- **Don't route shadow_signals to TradersPost — the entire point of SHADOW is no broker contact (Wave 29 Pass A.1).** The shadow invariant `traderspost_webhook_called=false` is enforced at the `lifecycle_shadow_signals` table level (migration 0160). `paper-signal-service.ts` shadow intercept block skips the TradersPost webhook unconditionally and emits `lifecycle.shadow_signal_logged`. Any code path that calls `routeOrder()` or fires a TradersPost POST while a strategy is in SHADOW state is a contract violation — the divergence checker compares LOGGED shadow signals (Pine alert with no broker) against backtest expectations, so broker contact during SHADOW invalidates the whole pass and risks family-firm collaborative-trading violations on shared accounts.
- **Don't raise `TF_MAX_TRADES_PER_DAY` above 2 without operator written rationale (Wave 26 Pass K Phase 1).** Default `2` is the operator's "1-2 A+ trades/day" mandate. Sizing math (`base_contracts: 6 MES`, 2% risk-per-trade, pyramid +3 per +$3K profit) anchors on 1 trade/day not 5. Per-session override via `paper_sessions.config.max_trades_per_day` is the audited path. Setting `TF_MAX_TRADES_PER_DAY=0` disables the gate for debugging only — emits `consistency.daily_trade_cap_blocked` reason `daily_trade_cap_disabled` to make bypass visible.
- **Don't trade the 11:30–13:30 ET lunch dead zone — institutional 2026 standard (Wave 26 Pass K Phase 2).** Backed by Tradeify 13-yr prop firm dataset (>60% false-breakout rate), Tradecovex hour-by-hour ("the worst hours of the day, do not trade at all"), TradingStats.net 12,095-day study (lunch only 4.5% of NQ HODs vs PM 35%). Defaults `LUNCH_BLACKOUT_START_ET=11:30` + `LUNCH_BLACKOUT_END_ET=13:30` — HARD signal-time gate. Don't widen to a noon-only cutoff (loses late-AM fakeout rejection) AND don't block PM 13:30–15:30 ET (cuts a 35%-of-HODs structural window per same dataset). Per-strategy override via `entry_quality.lunch_blackout_disabled=true` reserved for mean-reversion archetypes targeting compressed-vol lunch (QUANTUITION 2026-05 SPX scalp study) — never enable on trend-following / structural-setup strategies.
- **Don't run full-size PM contracts after 13:30 ET without the EOD-DD size taper — Topstep EOD trailing DD makes PM losses un-recoverable before 15:55 flatten (Wave 26 Pass K Phase 2).** Backed by TTT Markets 2026-04 funded-account framework, SurgeFunded 2026-02 EOD trailing DD guide, Tradecovex 2026-04 transition zone. Defaults `PM_SIZE_FACTOR_AT_13_30=0.50` (50% of AM base), linearly decaying to `PM_SIZE_FACTOR_AT_15_00=0.25` (25%), zero entries after `PM_LAST_ENTRY_ET=15:30`. Applied as a SOFT multiplier inside `computeRiskDerivedContracts()` BEFORE the firm cap / liquidity cap minimum. Raising floor above 0.25 requires operator-documented rationale + tighter B14 ci_high evidence — PM losses have less rolling-Sharpe room than AM losses.

---

## §14. Commands

```bash
# Development
npm run dev                              # Start Express server with hot reload
npm run db:generate                      # Generate Drizzle migration
npm run db:migrate                       # Run migrations
npm run db:studio                        # Open Drizzle Studio
npm test                                 # vitest
npm run lint                             # ESLint

# CI hard gates (must all pass)
npm run check:production-isolation       # Production code can't import research
npm run check:2026-compliance            # firm_config matches canonical 2026 docs
npm run system-map:check                 # System Map drift detection

# Architectural
npm run system-map:sync                  # Regenerate System Map after changes

# n8n
npm run audit:n8n                        # n8n drift detector
```

**Scheduler cron notes (Wave 27 Pass 1.5):** `quantum-replay-weekly-analysis` fires Sunday 19:00 ET (DST-safe double-fire at 23:00 UTC with ET-hour=19 guard) and emits a SIGNAL / INCONCLUSIVE / NO_SIGNAL / PRELIMINARY verdict to Discord (and `docs/replay-results/<ISO>-quantum-disagreement.md` via `scripts/replay-grade-quantum.ts`). FAILURE state emits a critical alert. Kill switch: `UPDATE system_parameters SET value = 'false' WHERE key = 'auto_patch_loop_enabled'` halts the cron's mutation path (same flag also halts Wave 26 `pattern-aggregator`).

---

## §14b. Backtest Concurrency Contract (Phase 14)

**Production-grade concurrency hardening shipped 2026-05-19** after a server crash caused by 6 concurrent backtests × 4 WF parallel workers = 24 simultaneous Python subprocesses → OOM.

### Capacity limits (tunable via .env)

| Env var | Default | Effect |
|---|---|---|
| `MAX_CONCURRENT_BACKTESTS` | `3` | POST /api/backtests returns HTTP 429 when this many are in-flight |
| `WF_MAX_WORKERS` | `2` | Max parallel walk-forward windows per backtest subprocess |
| `BACKTEST_TIMEOUT_MS` | `1800000` (30 min) | Individual backtest hard timeout |
| `BACKTEST_STALENESS_DAYS` | `30` | Promotion blocked if latest backtest is older than this many days (lifecycle TESTING→PAPER and PAPER→DEPLOY_READY gates); write `lifecycle.backtest_stale` audit row and ask operator to re-run |
| `MC_RETURN_BOOTSTRAP_MAX_EXTRAPOLATION` | `5` | Pass 2B F-9: return_bootstrap warns when projected `n_days > 1.5×` daily history and HARD-CAPS at this multiple. Prevents silently extrapolating MC firm-survival 100× beyond observed return distribution. |

**Load math:** 3 concurrent × 2 WF workers = 6 Python subprocesses. At ~400 MB each = ~2.4 GB for backtest workers — safe on the 32 GB Skytech tower (RTX 5060 8 GB VRAM).

### 429 handling

When `MAX_CONCURRENT_BACKTESTS` is reached, POST /api/backtests returns:
```json
{ "error": "backtest_concurrent_cap", "retry_after_seconds": 30, "active": 3, "cap": 3 }
```
Caller must retry after 30s. Do not queue or block — the 429 is the backpressure signal.

### Orphan cleanup policy

True orphan = `status='running'` for **more than 60 minutes**. On server restart, only rows older than 60 min are swept to `failed`. Rows younger than 60 min are presumed live at the time of crash — left unchanged for operator inspection.

Error message for swept rows: `"Backtest exceeded 1h+ runtime; swept as orphan on server restart."`

This unambiguously distinguishes:
- "Server restart killed a freshly-started run" → row is NOT swept (< 60 min)
- "This row was abandoned for over an hour" → row IS swept (> 60 min)

### Promotion-gate override

For dedicated promotion-gate runs (1 backtest at a time, maximize speed):
```env
WF_MAX_WORKERS=4
MAX_CONCURRENT_BACKTESTS=1
```

### Health endpoint

`/api/health` now includes:
```json
{ "backtestConcurrency": { "active": 2, "cap": 3, "saturated": false } }
```

---

## §15. Tech Stack

- **API Server:** Express.js 5 + TypeScript (`src/server/`)
- **Database:** PostgreSQL on Railway + Drizzle ORM (`src/server/db/schema.ts`)
- **Backtest Engine:** Python + vectorbt + Polars + DuckDB (`src/engine/`)
- **AI Agents:** TypeScript + Ollama (gemma4:e2b primary for transcript_extractor, deepseek-r1:14b) + GPT-5-mini (cloud fallback). Pass 21 (2026-05-12) retired qwen3-coder:30b — 18GB model couldn't load on RTX 5060 8GB VRAM. Wave 26 local-first swap: `transcript_extractor` primary = `gemma4:e2b` (Ollama, operator's choice); gpt-5-mini is the FALLBACK for that role only. Architecture: /api/chat (not /api/generate) + JSON Schema as `format` object (GBNF grammar-constrained sampling, Ollama 0.5+) + temperature=0/top_p=0.9/top_k=20 + NO `think` field (Ollama bug #15260 silently drops schema enforcement on gemma4 when think:false is set — omit entirely) + literal "Return JSON matching the schema." in user message. Install: `ollama pull gemma4:e2b` (7.2 GB Q4_K_M). Schema enforcement: `TRANSCRIPT_EXTRACTOR_STRICT_SCHEMA=false` escapes to `format:"json"` string mode. Override model via `TRANSCRIPT_EXTRACTOR_LOCAL_MODEL` env var (must include tag — bare `gemma4` does NOT resolve in Ollama, must use `gemma4:e2b`); panic-revert via `TRANSCRIPT_EXTRACTOR_FORCE_CLOUD=true`. Override other models via `PARAMETER_EVOLVER_MODEL` env var. **2026-05-26 fix:** `qwen2.5-coder:7b` was REMOVED — operator confirmed gemma4 is the canonical primary. Earlier Wave 26 Pass B doc claim of a "qwen swap" was stale.
- **Orchestration:** n8n on Railway since Pass 21 — `https://n8n-production-84ff.up.railway.app`
- **Data Lake:** AWS S3 (Parquet, ratio-adjusted continuous contracts)
- **Dashboard:** React + Vite + TailwindCSS (`Trading_forge_frontend/amber-vision-main/`)
- **Data Providers:** Databento (historical), Massive (real-time WS), Alpha Vantage (indicators + sentiment)
- **Execution:** TradingView Premium → TradersPost → MFFU/Topstep (current); TopstepX API direct (future)
- **Hosting:** Hybrid — Skytech tower (Ollama + Python backtest + NSSM services) + Railway (Postgres + n8n + tf-relay)
- **Quantum:** IBM Quantum Platform + AWS Braket (challenger-only Phase 0)

**Wave 27 Pass 1.5 env vars (quantum replay auto-fire + weekly verdict):**
- `QUANTUM_REPLAY_AUTO_FIRE_ENABLED` (default `true`) — opt-OUT flag for fire-and-forget replay hook after every backtest. Set `false` only for short-term debugging.
- `QUANTUM_REPLAY_TIMEOUT_MS` (default `300000` / 5 min) — per-backtest replay subprocess hard timeout.
- `QUANTUM_REPLAY_FAILURE_THRESHOLD` (default `5`) — consecutive-failure count that opens the circuit breaker and stops scheduling further auto-fires.
- `QUANTUM_REPLAY_WEEKLY_TIMEOUT_MS` (default `600000` / 10 min) — weekly Sunday cron analysis hard timeout.

**Wave 27.5 Pass A env vars (Monte Carlo hard gates):**
- `MC_RETURN_BOOTSTRAP_HARD_FAIL_MULTIPLIER` (default `2.0`) — hard ceiling on MC return-bootstrap extrapolation: when `n_days > multiplier × len(history)`, `return_bootstrap()` raises `ExtrapolationExceededError` and `run_monte_carlo()` returns `{status: "extrapolation_exceeded"}`. Set to `"infinity"` to disable the gate (restores pre-Wave-27.5 soft-cap behavior — research-tier only). Values above `2.0` are research-tier only; production must remain ≤ 2.0.

**MC institutional-grade hardening env vars (2026-06-22 — B14 ruin-CI repair):**
- `MC_BCA_MAX_SAMPLE` (default `5000`) — caps the BCa bootstrap resample input in `mc_confidence.py::compute_mc_confidence_intervals`. scipy's BCa jackknife is O(n_sims²) memory and OOM'd at ≥15k sims (~80 GiB at the 100k default), silently swallowed by a now-removed bare `except: pass` in `run_monte_carlo` — so B14 had been falling back to the legacy scalar on every production-scale run. The `point_estimate` is always computed on the FULL sample; only the interval is subsampled (slightly wider CI = more conservative). `n_effective` records the actual sample used. CI compute failures now emit a `monte_carlo.bca_ci_failed` audit row instead of vanishing. **Don't raise this above ~8000 without checking tower RAM headroom — the jackknife is quadratic.**
- **B14 ruin is now firm-breach, not terminal-negative (2026-06-22).** `probability_of_ruin_ci` is derived from `simulate_firm_survival`'s per-path `breach_mask` (trailing-DD + daily-loss-limit + consistency = the real account-closure / payout-denial event), tagged `ruin_basis="firm_breach"` with `ruin_firm` = the worst simulated firm. The old `mean(terminal ≤ 0)` value is preserved for diagnostics under `risk_metrics.terminal_negative_ci`. MC runs with no `firms` set fall back to the terminal-negative proxy, tagged `ruin_basis="terminal_negative_no_firm"`. B14 reads `risk_metrics.probability_of_ruin_ci.ci_high` (the key the Python side now actually populates — it previously only wrote `bca_confidence_intervals`, a second silent disconnect). Non-finite `ci_high` (degenerate BCa) now fails CLOSED (`b14.ruin_estimate_non_finite_fail_closed`) instead of silent-passing.

**Wave 27.5 Pass B env vars (Walk-Forward HIGH + B14 hard gate):**
- `WFE_HARD_FLOOR` (default `0.70`) — Walk-Forward Efficiency hard floor at PAPER → DEPLOY_READY. Strategies with `wfe_overall < 0.70` are blocked. Institutional 2026 standard; only lower with documented rationale.
- `WFE_WARN_FLOOR` (default `0.50`) — lower bound of the WFE block band. **HARDENING FIX 2026-06-22:** strategies in `[0.50, 0.70)` now BLOCK (were previously warn-and-proceed); below `WFE_WARN_FLOOR` also blocks. Only `wfe_overall >= WFE_HARD_FLOOR` (0.70) passes.
- `PBO_OVERFIT_THRESHOLD` (default `0.5`) — Probability of Backtest Overfitting (PBO) threshold. PBO auto-computes from `walk_forward.py` aggregation when ≥4 windows; values above threshold emit `walk_forward.pbo_high_overfit_risk` warn audit.
- `B14_RUIN_CI_HIGH_THRESHOLD` (default `0.40`) — B14 Survival Twin hard-block threshold on the conservative bound `probability_of_ruin_ci.ci_high`. PAPER → DEPLOY_READY blocks when `ci_high > 0.40`. Reads Pass A BCa-bootstrap CI; legacy MC scalar runs trigger documented `b14.legacy_ruin_scalar_fallback`.

**Wave 27.5 Pass C env vars (Backtest Engine HIGH hardening):**
- `BACKTEST_COMPLIANCE_MODE` (default `"enforce"`) — institutional default for backtest compliance gate. `enforce` blocks violating trades at fill time + emits `compliance.enforce_block`. `shadow` logs `compliance.shadow_logged` without blocking (novel-edge research only). Per-backtest override via `backtests.compliance_mode` column (migration 0148).
- `BACKTEST_PARTIAL_FILL_ENABLED` (default `true`) — activates `src/engine/fill_model.py` 3-zone partial-fill modeling. Disabling restores idealized-fill assumption (debugging only — never permanent production knob).
- `BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD` (default `0.1`) — `order_qty / bar_volume` ratio at which partial-fill degradation begins. Below threshold = 100% fill; `0.1–1.0` = linear degrade; `>1.0` = forced partial.
- `BACKTEST_EXIT_SLIPPAGE_SYMMETRIC` (default `true`) — exit-slippage symmetry guard. Pass C audit confirmed already symmetric in current backtester; flag exists for explicit future asymmetric-model opt-in (research only).
- `MC_TRIM_OUTLIER_MULTIPLIER` (default `null` — opt-in) — when set (institutional recommendation `2.0`), MC bootstrap trims trades to ±`multiplier × worst-month` before resampling. Emits `monte_carlo.outliers_trimmed`. Leave `null` for full distribution preservation.

**Wave 27.5 Pass D env vars (MED+LOW sweep + institutional defaults):**
- `BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD` (default `true`) — institutional default. Raises `ZeroVolumeOnTradeCriticalBar` when a stop/TP-candidate bar has `volume=0`. Set `false` only to restore legacy silent-skip for backward-compat fixtures.
- `BACKTEST_ROLL_SPREAD_ITEMIZED` (default `true`) — institutional default. Deducts per-symbol roll-spread ticks from P&L on roll days via `ROLL_SPREAD_<SYMBOL>_TICKS` table; emits `backtest.roll_spread_itemized` audit.
- `ROLL_SPREAD_MES_TICKS` / `ROLL_SPREAD_MNQ_TICKS` / `ROLL_SPREAD_MCL_TICKS` (per-symbol tick deductions for roll-day P&L; defaults set per published CME spread costs — see `src/engine/roll_spread_cost.py`).
- `BACKTEST_MARGIN_EXPANSION_VIX_30_FACTOR` (default `0.5` — halves max_contracts when VIX > 30).
- `BACKTEST_MARGIN_EXPANSION_VIX_50_FACTOR` (default `0.25` — quarters max_contracts when VIX > 50).
- `BACKTEST_DST_BOUNDARY_AUDIT_ENABLED` (default `true` — emits `backtest.dst_boundary_processed` audit at spring-forward / fall-back transitions for replay integrity).
- `OPTIMIZER_DRY_RUN` (Pass D.3 — when `true`, `optimizer.py` prints planned mutation set without writing; closes M6 finding).
- `MC_REGIME_RESAMPLE_ENABLED` (Pass D.4, default `false` — opt-IN regime-aware MC resampling via `src/engine/mc_regime_resampling.py`).
- `MC_MULTI_ASSET_CORRELATION_ENABLED` (Pass D.4, default `false` — opt-IN multi-asset MC correlation via `src/engine/mc_multi_asset.py`).

**Wave 27 Carry-Forward Master Close env vars (Phase 5 ContractSpec scaffold):**
- `TF_PHASE_5_ENABLED` (default `false`) — feature gate on the Phase 5 true-mini ContractSpec scaffold (ES/NQ/CL). When `false`, `resolve_contract_spec()` refuses to route ambiguous symbols to mini specs (prevents 10× silent risk inflation). Flip to `true` ONLY when operator funded balance ≥ $200K and new strategies declare `contract_class="mini"` explicitly. Activation is a deployment decision documented as a §13 "Don't" without explicit operator confirmation. Helper: `resolve_contract_spec(symbol, contract_class)` in `src/engine/contracts/contract_spec.py` + TS mirror in `src/server/lib/firm-config.ts`.

**Wave 28 Pass A env vars (composite-health observability bus):**
- `MIN_COMPOSITE_SUBSYSTEMS` (default `8`) — minimum number of available subsystems (out of 12 canonical) required for `strategy-health-aggregator` to write a composite row to `strategy_health_scores`. Below floor → skip-write composite row + `composite_health.skipped_below_subsystem_threshold` WARN audit (institutional null-threshold guard; null-fill = worst-case, never interpolated). Set `"0"` only for test/bypass scenarios.
- `COMPOSITE_MAX_AGE_HOURS` (default `48`) — consumer-side staleness guard. Aggregator stamps `staleness_age_hours` on every row; downstream consumers compare against this threshold (Pass B shadow gate / Pass C tier gate will read it). Aggregator itself does NOT block on this.
- `WAVE_28_COMPOSITE_GATING_ENABLED` (default `false`) — kill-switch flag for downstream composite gating consumers. Pass A aggregator does NOT read this flag (PURE OBSERVABILITY MODE). Pass B+C will introduce shadow / tier gates that gate on this flag; flipping to `false` reverts those passes to Wave 27.5 per-subsystem hard-gate-only behavior.

**Wave 28 Pass B env vars (composite shadow gate):**
- *No new env vars introduced this pass.* `composite-shadow-gate.ts` reuses Pass A's `COMPOSITE_MAX_AGE_HOURS=48` for staleness ceiling resolution; `composite-shadow-discord-router.ts` uses an in-memory 24h dedup (no env knob); `scripts/analyze-shadow-evidence.ts` reads CLI flags only. The Pass A `WAVE_28_COMPOSITE_GATING_ENABLED` flag is reserved for Pass C activation — Pass B operates regardless of its value (shadow result is logged unconditionally).

**Wave 29 Pass C env vars (quantum RL agent bridge — challenger-only):**
- `QUANTUM_RL_REWARD_ALPHA` (default `0.5`) — reward-shaping coefficient on `max(0, ci_high - 0.40)` penalty term. Higher values penalize high probability-of-ruin states more aggressively during training.
- `QUANTUM_RL_REWARD_BETA` (default `0.3`) — reward-shaping coefficient on `drawdown_penalty` term. Higher values teach the policy stronger drawdown aversion.
- `QUANTUM_RL_IBM_CLOUD_OPT_IN` (default `false`) — first of three gates for IBM Quantum cloud QPU routing. Must be `true` AND `QUANTUM_CLOUD_ENABLED=true` AND `IBM_QUANTUM_TOKEN` present for any RL training to touch the cloud path; missing any one short-circuits to local lightning.gpu sim.
- `QUANTUM_RL_TRAINING_EPOCHS` (default `200`) — number of policy-gradient epochs per regime per training auto-fire.
- `QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT` (default `0.30`) — rolling Sharpe-gap threshold for the advisory kill switch (`compute_rl_kill_switch_state`). Returns engaged-decision; never mutates state — caller decides whether to act.
- `QUANTUM_RL_DSR_FLOOR` (default `0.5`) — DSR (Deflated Sharpe Ratio) floor per QuantBeckman 2025 + arXiv 2512.12924. Training runs that fall below floor get `governance_labels.dsr_passed=false` and the composite-health `rl_agent` subsystem returns `null` for that strategy (counts toward the 8-of-13 `MIN_COMPOSITE_SUBSYSTEMS` floor).

**Wave 29 Pass B env vars (frozen-policy SHA-256 contract + HMAC override + regime drift detector):**
- `ADMIN_OVERRIDE_HMAC_SECRET` (no default — operator-set; must be ≥32 chars random) — shared secret used by `POST /api/admin/frozen-policy-override` for HMAC-SHA-256 signature verification. The route computes `HMAC-SHA-256(secret, timestamp + rationale + strategy_id)` and rejects requests whose signature header does not match or whose `timestamp` skew exceeds 60 seconds (replay protection). MUST be set in production .env before any HMAC override is attempted; missing secret short-circuits the route to 503 Service Unavailable. Treat as offline-only secret (not committed; rotate alongside `RAILWAY_TOKEN` cadence). Same severity as `ADMIN_RESTART_HMAC_SECRET` documented in §15a — leaking the secret is equivalent to leaking write access to every frozen-policy override path.

**Wave 29 Pass A env vars (SHADOW lifecycle stage + PBO overfit gate + shadow-signal divergence gate):**
- `PBO_OVERFIT_THRESHOLD_PCT` (default `0.15`) — institutional 2026 PBO threshold. `lifecycle-service.ts` via `pbo-gate.ts` blocks TESTING → SHADOW and TESTING → PAPER promotions when `pbo_overall > 0.15`. Stricter than Wave 27.5 `PBO_OVERFIT_THRESHOLD=0.5` catch-all (which fires `walk_forward.pbo_high_overfit_risk` warn) — the lifecycle gate now enforces the institutional grade. Lowering for one promotion requires an env override + audit-log rationale row; never edit the default.
- `SHADOW_DIVERGENCE_THRESHOLD_PCT` (default `0.05`) — shadow-signal divergence threshold at SHADOW → PAPER. `lifecycle-service.ts` Gate 2.5 (via `shadow-signal-divergence-checker.ts` + `shadow-signal-divergence-loader.ts`) blocks promotion when `divergence_pct ≥ 0.05` across the minimum sample. 5% is the institutional 2026 standard for training-serving skew acceptance; tightening to 0.03 is acceptable for high-risk cohorts, loosening above 0.05 defeats the gate.
- `SHADOW_DIVERGENCE_MIN_SAMPLE` (default `20`) — minimum shadow-signal sample size before the divergence gate emits a PASS / BLOCK verdict. Below the floor the gate emits `lifecycle.shadow_divergence_insufficient_samples` and blocks (the strategy stays in SHADOW until 20 logged signals accumulate). Lowering the sample floor sacrifices statistical power; 20 is the minimum that produces non-degenerate divergence-pct distributions per Pass A research.

## §15a. Hosting Topology (Pass 21, 2026-05-12)

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│ SKYTECH TOWER (home, 24/7)      │         │ RAILWAY (cloud, 99.95% SLA)      │
│                                 │         │                                  │
│  • NSSM TradingForgeAPI :4000   │────────▶│  • n8n service                   │
│  • Ollama (qwen3 + deepseek)    │         │  • Postgres                      │
│  • Python backtest engine       │         │  • tf-relay service              │
│  • DuckDB + Polars              │   WSS   │                                  │
│  tower-relay-client.cjs       ──┼────────▶│      forwards HTTP frames        │
└─────────────────────────────────┘  HTTP   └──────────────────────────────────┘
```

**Required env vars (tower-side .env):**
```
N8N_BASE_URL=https://n8n-production-84ff.up.railway.app
TF_N8N_API_KEY=<JWT from n8n Settings → API>
TF_BACKEND_PUBLIC_URL=https://tf-relay-production.up.railway.app
ADMIN_RESTART_HMAC_SECRET=<random 32+ char secret — set same value in .env and keep offline>
```

**Self-restart endpoint (Wave 24 Pass 1, Item 8):**
NSSM TradingForgeAPI auto-respawns stale code. Non-admin `sc stop` is denied. Use the HMAC-signed self-restart endpoint to trigger a graceful restart without admin access:
```bash
TIMESTAMP=$(date +%s)
REASON="deploy_2026-05-23"
SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
curl -X POST https://<relay>/api/admin/self-restart \
  -H "Content-Type: application/json" \
  -H "X-Restart-Signature: $SIG" \
  -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
```
Replay protection: timestamp drift > 60s → 401. NSSM respawns automatically to fresh code. Set NSSM `RestartDelay=2000` so process has time to flush logs before port re-binds.

**Pinned facts:**
- n8n on Railway requires `PORT=5678`
- Same `N8N_ENCRYPTION_KEY` as the previous local install
- Cloudflare Quick Tunnel URLs are DEPRECATED — use stable `tf-relay` service
- Tower relay client logs: `C:\Users\tonio\bin\tower-relay-client.log`
- Relay singleton — second client connection force-closes the older one
- `RELAY_TOKEN` must match between Railway env and tower client env

### Power resilience hardware — UPS + Kasa (HARD RULE for any live/PAPER+ operation)

Trading Forge is hybrid (CLAUDE.md §15a topology diagram): the institutional safety
stack — kill-switch L1-L9, B14 ci_high gate, compliance enforce, frozen-policy hash,
paper-journal-recon, audit chain, scheduler crons — all run ON THE TOWER inside
TradingForgeAPI. **None of these fire when the tower is offline.** A Pine→TradersPost
family bot would technically keep firing during a tower outage (TradingView + TradersPost
are cloud-only), but it would do so with zero institutional safety net — exactly the
retail-shaped failure mode the 4-wave 2026-06-23 hardening sweep eliminated. The Full
Slumdawg DIRECT path and the TF Gateway archetype path are HARD-DEPENDENT on the tower
and stop entirely when it goes down.

**Therefore: any operator running live or PAPER+ strategies MUST have both UPS and Kasa
installed before the first live trade.** This is not optional gear; it's the physical-layer
prerequisite for the safety contract.

**Topology (mandatory order):**
```
WALL OUTLET → KASA SMART PLUG → UPS → TOWER
```
Kasa upstream of UPS is critical: it lets `triggerRemotePowerCycle()` actually cut all
power downstream (including UPS battery) so the tower cold-boots. Reversed order
(Tower→Kasa→UPS or UPS upstream of Kasa) means the remote-cycle path cannot fully
de-energize the tower and NSSM may not respawn into fresh code. The UPS smooths grid
brownouts because Kasa just passes power through normally — UPS only sees Kasa cuts
during an explicit power-cycle (rare).

**Hardware (~$170-220 total):**
- **UPS:** CyberPower CP1500AVRLCD or APC BX1500M (~900W output, 10-30 min runtime for
  a desktop tower). Closes the brief-outage failure mode (open positions exposed to
  arbitrary fill at re-open after a 5-minute brownout). ~$150-200.
- **Kasa:** TP-Link HS103 (cheapest) or HS105 (more compact). HS110's energy monitoring
  is not used. ~$10-20.

**Role separation:**
| Failure mode | UPS handles | Kasa handles |
|---|---|---|
| Brief brownout (<30 min) during RTH | YES (invisible to bot) | no |
| Bot software hang (tower fine, API frozen) | no | YES (auto-cycles after 3 failed restarts) |
| Long outage (UPS battery exhausted) | dies gracefully, tower shuts down clean | restores power when grid returns + tower BIOS auto-boots |
| Tower BIOS lockup / NSSM stuck | no | YES (hard power-cycle) |

**Operator setup (one-time):**
1. Purchase UPS + Kasa per the spec above.
2. Cable: wall outlet → Kasa → UPS → tower (NOT tower → UPS → Kasa).
3. Connect Kasa to home Wi-Fi via the Kasa app.
4. Router DHCP reservation: assign a **static IP** to the Kasa's MAC address so the
   IP never changes across reboots.
5. **Kasa app config:** Device Settings → "Default Power State" → **On** (foolproof —
   ensures plug auto-energizes when grid returns after a long outage).
6. **Tower BIOS/UEFI config:** Power Management → "AC Power Recovery" (or "Restore on
   AC/Power Loss") → **Power On** (default is "Off" on most boards — without this, the
   Kasa energizing the tower does nothing because the motherboard won't auto-boot).
   This is the more important of the two — skip it and the Kasa work is dead.
7. Set the three env vars below in your tower `.env` and restart the backend.
8. Verify the boot log says "KASA remote power-cycle escape valve is ACTIVE" before
   declaring setup complete.

**Required env vars (all three or none — `startup-config-check.ts` enforces, and
M13 commit `ef3ba4c` 2026-06-23 added a runtime fail-CLOSED guard at
`triggerRemotePowerCycle()` entry that throws `remote_power_cycle_partial_config` if
called with partial config):**
```
KASA_DEVICE_IP=192.168.1.42    # IPv4 of the smart plug (static LAN IP)
KASA_USERNAME=you@example.com  # Kasa cloud account email
KASA_PASSWORD=yourpassword     # Kasa cloud account password
```

**What happens during a remote power-cycle (dead-man's heartbeat + KASA path):**
When the dead-man's heartbeat fires 3 auto-restart attempts in 24h and all fail, the
4th-attempt code path checks `KASA_DEVICE_IP`. If set, it invokes
`scripts/remote-power-cycle.ps1` (via `remote-power-cycle-service.ts`):
1. `remote-power-cycle-service.ts` writes a `recovery.remote_power_cycle_triggered`
   audit row with `correlationId` before touching the plug.
2. `scripts/remote-power-cycle.ps1` sends OFF→30s→ON via the local LAN API (port 9999,
   no cloud round-trip — works even during internet outages).
3. Script appends to `C:\Users\tonio\bin\kasa-cycle.log`.
4. Discord CRITICAL fires with operator-version (full technical + audit ID) AND
   family-grade postscript ("wait 10 minutes, check heartbeat, call Tony if still down").
5. NSSM auto-respawns TradingForgeAPI on power-up.

**What happens during a grid outage (UPS path):**
1. Grid drops → Kasa loses power → UPS battery kicks in immediately → tower keeps
   running.
2. If grid returns within UPS runtime (~10-30 min): zero downtime; bot doesn't notice.
3. If grid stays down past UPS runtime: UPS battery exhausts → controlled shutdown of
   tower (BIOS-managed if "AC Power Recovery" is set, otherwise NSSM crash-loop logs).
4. When grid returns: Kasa re-energizes (Default Power State = On) → tower BIOS detects
   AC restored → motherboard auto-boots → Windows boots → NSSM auto-starts
   TradingForgeAPI → backend back online + scheduler catches up missed crons.

**When KASA vars are absent:** the dead-man's heartbeat path fires the terminal Discord
CRITICAL with "hold the power button for 5 seconds" — operator must be physically
present. This is acceptable for CANDIDATE/TESTING strategies but a HARD violation of
the vacation-mode contract for PAPER+ strategies.

**When UPS is absent:** any grid blip causes uncontrolled tower shutdown mid-RTH. Open
positions are exposed to whatever fill the broker gives at re-open. There is no
software-side mitigation for this — the safety stack we shipped cannot fire when
electricity stops.

**Family-distribution mandate:** each family member running an independent bot needs
their own UPS + Kasa on their own tower. Per memory `feedback_family_not_part_of_operator_scaling`,
family members are not a single-tower-shared operation; each is a standalone deployment.

---

> **Living rules end here.** For build history, see `AGENT-LOGS.md`. For subsystem architecture, see `Trading Forge System Map v2.md`. For agent contract, see `AGENTS.md`.
