

<!-- BEGIN GENERATED: topology -->
## Current Enforced Pre-Production State

Updated automatically from the repo on `2026-05-20T06:46:44.965Z`.

- Platform lifecycle stage: `pre-production`
- Runtime-proven means `proven in pre-production`, not production released.
- Production runtime controls: `ready` (strict)

- TradingView deployment gate: `manual-only`
- Manual gates declared: `operator-halt-only, tradingview_deploy`
- API routes tracked: `62`
- Scheduler jobs tracked: `62`
- Current live Trading Forge n8n workflows tracked: `28`
- Canonical workflows tracked: `28`
- Duplicate workflow variants collapsed: `0`
- Engine subsystems tracked: `26`
- Database tables tracked: `92`

### Subsystem Runtime States
- `active`: `16`
- `experimental`: `5`

### Current Pre-Production States
- `active_preprod`: `16`
- `experimental_preprod`: `5`
- `inactive_preprod`: `0`
- `partially_active_preprod`: `0`

### Launch Target States
- `experimental_challenger`: `5`
- `runtime_proven_autonomous`: `14`
- `runtime_proven_manual_gate`: `2`

### Production Target States
- `production_autonomous`: `14`
- `production_experimental`: `5`
- `production_manual_gate`: `2`
- `production_not_intended`: `0`

### Subsystem Operating Classes
- `adaptive`: `5`
- `deterministic_instrumented`: `14`
- `manual_gated`: `2`

### Learning Modes
- `active_learning`: `5`
- `deterministic_instrumented`: `9`
- `manual_gate_only`: `2`
- `shadow_experimental`: `5`

### Registry Coverage
- Registry subsystems tracked: `21`
- Route coverage: `62/62`
- Scheduler coverage: `62/62`
- Engine coverage: `26/26`
- Database coverage: `92/92`
- Autonomous subsystems with audit coverage: `21/21`
- Autonomous subsystems with audit actions: `21/21`
- Autonomous subsystems with telemetry evidence: `21/21`
- Active-runtime subsystems with freshness signals: `21/21`
- Runtime/experimental subsystems with evidence queries: `21/21`
- Self-evolving subsystems with learning inputs: `7/7`
- Self-evolving subsystems with learning persistence: `7/7`
- Failure visibility complete: `21/21`

### Proof Status
- `runtime-proven`: `16`
- `partially-proven`: `0`
- `offline-by-design`: `0`
- `experimental`: `5`
- `drifted`: `0`

### Pre-Production Integrity
- Integrity status: `complete`
- Automation complete: `16/21`
- Data collection complete: `21/21`
- Auditability complete: `21/21`
- Failure visibility complete: `21/21`
- Authority correct: `21/21`
- Learning active: `6/7`
- Incomplete subsystems: `0`

### Production Convergence
- Convergence status: `blocked`
- Ready subsystem targets: `15`
- Blocked subsystem targets: `1`
- Experimental subsystem targets: `5`
- Shadow workflow candidates: `0`
- Inactive workflow candidates: `0`
- Broken workflow blockers: `0`
- Failing workflow blockers: `0`
- Source-missing workflow blockers: `3`
- Awaiting redeploy workflow blockers: `0`
- Stale workflow blockers: `0`
- Runtime control blockers: `0`

### Readiness Summary
- Launch ready: `false`
- Only TradingView manual at launch: `true`
- Launch-blocked subsystems: `6`
- Inactive by design: `0`
- Collecting only: `0`
- Learning blocked: `0`
- Runtime control blockers: `0`

### Closed-Loop Status
- `collecting_only`: `0`
- `learning_active`: `6`
- `learning_blocked`: `0`
- `not_collecting`: `10`
- `shadow_experimental`: `5`

### Workflow States
- `production-active`: `28`
- `built-inactive`: `0`
- `broken`: `0`
- `external-non-core`: `0`
- health `healthy`: `23`
- health `failing`: `0`
- health `stale`: `0`
- health `unknown`: `5`

### Subsystem Coverage Gaps
- `a_plus_market_auditor` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `backtest_qualification` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `broker_abstraction_layer` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `cloud_qmc_ising` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `compliance_governance` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `context_execution` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `critic_evolution` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `deepar_regime` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `frankenstein_randomization_gate` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `observability_reliability` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `operator_absent_autopilot` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `pine_export_preparation` class=`manual_gated` learningMode=`manual_gate_only` current=`active_preprod` target=`production_manual_gate` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `production_hardening` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`false` preprodBlockers=manual_gate:operator-halt-only productionBlockers=manual_gate:operator-halt-only gaps=none
- `prop_firm_survival_twin` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `quantum_adversarial_stress` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `quantum_experimental` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `research_orchestration` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `signal_correlation_gate` class=`deterministic_instrumented` learningMode=`deterministic_instrumented` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`not_applicable` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `strategy_lifecycle` class=`manual_gated` learningMode=`manual_gate_only` current=`active_preprod` target=`production_manual_gate` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none
- `synthetic_black_swan_survival` class=`deterministic_instrumented` learningMode=`shadow_experimental` current=`experimental_preprod` target=`production_experimental` automation=`experimental` data=`complete` audit=`complete` failureVisibility=`complete` learning=`experimental` authority=`correct` ready=`false` preprodBlockers=experimental_governance productionBlockers=experimental_governance gaps=none
- `workflow_orchestration` class=`adaptive` learningMode=`active_learning` current=`active_preprod` target=`production_autonomous` automation=`complete` data=`complete` audit=`complete` failureVisibility=`complete` learning=`active` authority=`correct` ready=`true` preprodBlockers=none productionBlockers=none gaps=none

### Engine Subsystem Deep Scan
- `anti_setups` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `archetypes` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `backtester` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `compiler` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `compliance` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `context` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `critic_optimizer` owner=`critic_evolution` status=`runtime-proven` state=`active` gaps=none
- `decay` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `deepar_forecaster` owner=`deepar_regime` status=`runtime-proven` state=`active` gaps=none
- `deepar_regime_classifier` owner=`deepar_regime` status=`runtime-proven` state=`active` gaps=none
- `exits` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `governor` owner=`compliance_governance` status=`runtime-proven` state=`active` gaps=none
- `graveyard` owner=`strategy_lifecycle` status=`runtime-proven` state=`active` gaps=none
- `invariant_harness` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `macro_data` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `monte_carlo` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `parameter_evolver` owner=`critic_evolution` status=`runtime-proven` state=`active` gaps=none
- `parity_engine` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `pine_compiler` owner=`pine_export_preparation` status=`runtime-proven` state=`active` gaps=none
- `quantum_mc` owner=`quantum_experimental` status=`runtime-proven` state=`active` gaps=none
- `skip_engine` owner=`context_execution` status=`runtime-proven` state=`active` gaps=none
- `strategy_memory` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `survival` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none
- `validation` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `validation_runner` owner=`research_orchestration` status=`runtime-proven` state=`active` gaps=none
- `walk_forward` owner=`backtest_qualification` status=`runtime-proven` state=`active` gaps=none

### API Routes
- `/api/admin`
- `/api/adversarial-stress`
- `/api/agent`
- `/api/agents`
- `/api/alerts`
- `/api/anti-setups`
- `/api/archetypes`
- `/api/auditor`
- `/api/backtests`
- `/api/bias-decisions`
- `/api/bias-state`
- `/api/cloud-qmc`
- `/api/compiler`
- `/api/compliance`
- `/api/context`
- `/api/critic-optimizer`
- `/api/data`
- `/api/decay`
- `/api/deepar`
- `/api/dlq`
- `/api/frankenstein`
- `/api/governor`
- `/api/graveyard`
- `/api/health`
- `/api/indicators`
- `/api/journal`
- `/api/library-diversity`
- `/api/macro`
- `/api/metrics`
- `/api/monte-carlo`
- `/api/n8n`
- `/api/nemo-scenarios`
- `/api/openai-proxy`
- `/api/openclaw/daily-report`
- `/api/paper`
- `/api/pine-export`
- `/api/pine-export/recipient`
- `/api/portfolio`
- `/api/prevalidate`
- `/api/production`
- `/api/prop-firm`
- `/api/quantum-mc`
- `/api/quantum/cost`
- `/api/quantum/pre-flight`
- `/api/risk`
- `/api/scout`
- `/api/search`
- `/api/shadow-rerun`
- `/api/signal-correlation`
- `/api/signals`
- `/api/skip`
- `/api/sse`
- `/api/strategies`
- `/api/strategy-assignments`
- `/api/strategy-names`
- `/api/survival`
- `/api/synthetic-black-swan`
- `/api/tournament`
- `/api/tradingview`
- `/api/validation`
- `/api/validation-cadence`
- `/api/volume-profile`

### Scheduler Jobs
- `a-plus-auditor-scan`
- `agent-health-sweep`
- `anti-setup-effectiveness`
- `anti-setup-mine`
- `archetype-daily-classify`
- `autonomous-scout-discovery`
- `bias-engine-refresh-10am-et`
- `bias-engine-session-start`
- `c11-bls-release`
- `c11-fred-daily`
- `c11-h41-weekly`
- `c11-treasury-auctions`
- `cloud-qmc-poll`
- `cme-status-poll`
- `compliance-rule-drift`
- `contract-roll-sweep`
- `critic-feedback`
- `data-integrity-suite`
- `databento-weekly-refresh`
- `decay-monitor`
- `deepar-predict`
- `deepar-train`
- `deepar-validate`
- `disabled-job-probe`
- `dlq-escalation`
- `dlq-retry`
- `drain-scouted-ideas-periodic`
- `funnel-snapshot`
- `graveyard-pattern-extraction`
- `harsh-regime-phase-activation-check`
- `idempotency-cleanup`
- `lifecycle-auto-check`
- `macro-data-sync`
- `meta-parameter-review`
- `metrics-collector`
- `metrics-heartbeat`
- `n8n-health-check`
- `n8n-workflow-sync`
- `nightly-critique`
- `paper-vs-backtest`
- `pipeline-resume-drain`
- `portfolio-correlation`
- `pre-market-prep`
- `pre-trading-day-health-check`
- `prompt-ab-resolution`
- `prop-firm-dashboard-snapshot`
- `prop-firm-health-check`
- `python-pool-saturation-check`
- `quantum-cost-prune`
- `regen-declining-sweep`
- `regret-score-fill`
- `resource-snapshot`
- `rolling-sharpe`
- `session-analytics-rollup`
- `stale-pending-sweeper`
- `stale-session-check`
- `system-map-drift`
- `tournament-staleness-check`
- `validation-cadence-monthly`
- `w19-definition-pull`
- `w19-imbalance-pull`
- `w19-statistics-pull`

### Engine Subsystems
- `anti_setups`
- `archetypes`
- `backtester`
- `compiler`
- `compliance`
- `context`
- `critic_optimizer`
- `decay`
- `deepar_forecaster`
- `deepar_regime_classifier`
- `exits`
- `governor`
- `graveyard`
- `invariant_harness`
- `macro_data`
- `monte_carlo`
- `parameter_evolver`
- `parity_engine`
- `pine_compiler`
- `quantum_mc`
- `skip_engine`
- `strategy_memory`
- `survival`
- `validation`
- `validation_runner`
- `walk_forward`

### Workflow Inventory
- `0A_health_monitor_66HEjQavpvirY6g5`
- `10A_master_orchestration_8HKXzNmo9KF59SBu`
- `11A_critic_optimization_pVT6svNTljjBoQbW`
- `3A_workflow_backup_J0p8oYkONmN7pYn6`
- `5A_weekly_tournament_2rVOEn4LnMAubTmW`
- `5G_brave_search_scout_z2c7zJmSx5dNle6P`
- `5H_reddit_scout_ZMgHYjcTq4YTRQXh`
- `5I_tavily_scout_TMT3g7HenJ5etiwv`
- `6D_compliance_gate_RumAJUp4iS1TYlNm`
- `7A_auto_evolution_MIIxmilbgZv3SUBh`
- `8A_idea_to_strategy_vlCaiWM7F0AH1RRY`
- `8B_source_quality_review_LQtqeWAcNOlkqROH`
- `9A_nightly_self_critique_26ruSYvIjqHGOhsd`
- `Anti_Setup_Refresh_PHcD2tFZpzr7kQGF`
- `Daily_Compliance_Check_WT9sVMzG83rg1L29`
- `Daily_Portfolio_Monitor_u0RcmfuClgRinXAX`
- `Daily_Scout_5E_7GCDtSCifGgdpeuq`
- `Macro_Data_Sync_X2IjKuYseGukxKDj`
- `Monthly_Robustness_Check_m6aD7X4ioWfhWaS9`
- `Nightly_Strategy_Research_Loop_Z4NcOCDbet8KzjDd`
- `Post_Session_Skip_Review_LayXj1mbHh4aGSM9`
- `Pre_Session_Compliance_Gate_gFwNlA3eCHbSb7en`
- `Pre_Session_Skip_Check_eaq72MwKwCjv7g7F`
- `Strategy_Generation_Loop_eCr7cyb0aPArFCZc`
- `Strategy_Tournament_hPXhUaSC3ScznZE9`
- `Weekly_Compliance_Re_Parse_YuDGQkuej7qybPAB`
- `Weekly_Deep_Research_5F_zmjj1mqjSbeVcWZg`
- `Weekly_Strategy_Hunt_sAIrnCVB4iOsodsy`

### Database Tables
- `a_plus_market_scans`
- `account_strategy_assignments`
- `adversarial_stress_runs`
- `agent_health_reports`
- `alerts`
- `audit_log`
- `backtest_matrix`
- `backtest_provenance`
- `backtest_trades`
- `backtests`
- `bias_ablation_results`
- `bias_calibration_curves`
- `bias_decisions`
- `bias_state`
- `broker_accounts`
- `cloud_qmc_runs`
- `compliance_drift_log`
- `compliance_reviews`
- `compliance_rulesets`
- `contract_rolls`
- `contract_specs_authoritative`
- `critic_candidates`
- `critic_optimization_runs`
- `daily_reconciliation`
- `daily_statistics`
- `daily_volume_profile_levels`
- `data_integrity_findings`
- `data_sync_jobs`
- `day_archetypes`
- `dead_letter_queue`
- `deepar_forecasts`
- `deepar_training_runs`
- `exchange_outages`
- `firm_adversarial_priors`
- `frankenstein_test_runs`
- `harsh_regime_phase`
- `idempotency_keys`
- `instance_config`
- `lifecycle_transitions`
- `llm_injection_attempts`
- `macro_features`
- `macro_regime_states`
- `macro_snapshots`
- `monte_carlo_runs`
- `mutation_outcomes`
- `n8n_execution_log`
- `nemo_scenario_bank`
- `opening_auction_imbalance`
- `paper_positions`
- `paper_session_feedback`
- `paper_sessions`
- `paper_signal_logs`
- `paper_trades`
- `pilot_sessions`
- `production_trades`
- `prompt_ab_tests`
- `prompt_versions`
- `prop_firm_health_checks`
- `quantum_mc_benchmarks`
- `quantum_mc_runs`
- `quantum_run_costs`
- `qubo_timing_runs`
- `rl_training_runs`
- `scout_drain_samples`
- `shadow_rerun_findings`
- `shadow_signals`
- `skip_decisions`
- `sqa_optimization_runs`
- `strategies`
- `strategy_dsl_features`
- `strategy_export_artifacts`
- `strategy_exports`
- `strategy_firm_eligibility`
- `strategy_graveyard`
- `strategy_lockouts`
- `strategy_names`
- `strategy_pending_buckets`
- `strategy_pending_mentions`
- `strategy_signal_vectors`
- `stress_test_runs`
- `subsystem_metrics`
- `synthetic_black_swan_runs`
- `system_journal`
- `system_parameter_history`
- `system_parameters`
- `system_state`
- `tensor_predictions`
- `tournament_results`
- `tradingview_markers`
- `transcript_fetch_outcomes`
- `walk_forward_windows`
- `weekly_drift_reports`
<!-- END GENERATED: topology -->

---

## §SSE Events Canonical Inventory

> Added Wave 4 (2026-05-16). Source of truth: `src/server/routes/sse.ts` (emitter registry) +
> `Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts` (type union) +
> `Trading_forge_frontend/amber-vision-main/src/hooks/useSSE.ts` (side-effect dispatch).
>
> Asymmetry policy: every emitted event is typed in the union. Emits without frontend
> UX (operator-dashboard panels not yet built) are marked "Future dashboard panel."

### lifecycle:gate_evaluated
- **Emitter:** `src/server/services/lifecycle-service.ts:640,688,730,760,789,1721,1759,2249,2303,2348,2417`
- **Payload shape:** `{ strategy_id: string, gate: "frankenstein"|"A7"|"pilot_auto_promotion", decision: "passed"|"failed"|"killed"|"promoted"|"deferred_*", ramp_up_mode?: boolean, correlation_id?: string|null }`
- **Listeners:** `useSSE.ts:dispatchSideEffects` — toast on FAIL/KILL/PROMOTED; distinct ramp-up toast on A7 PASS with `ramp_up_mode:true`; silent for routine PASS. `DeployReady.tsx` subscribes.
- **Purpose:** Every lifecycle gate evaluation (Frankenstein, A7 signal-correlation, PILOT auto-promotion sweep) emits this event so the operator has real-time visibility into gate decisions without polling.

### lifecycle:promoted
- **Emitter:** `src/server/services/lifecycle-service.ts:1141,1483,2262,2361,2430`
- **Payload shape:** `{ strategyId, from, to, name?, forgeScore?, tier?, survivalRate? }`
- **Listeners:** `useSSE.ts` → invalidates strategies + paper; toast `name from → to`
- **Purpose:** State machine transition succeeded; strategy moved to next lifecycle state.

### lifecycle:operator_absent_autopromoted
- **Emitter:** `src/server/services/operator-absent-mode-service.ts:248`
- **Payload shape:** `{ strategyId, from, to }`
- **Listeners:** `useSSE.ts` → toast (info). Future: operator-absent dashboard panel.
- **Purpose:** Tier-1 strategy auto-promoted while operator is in vacation mode.

### lifecycle:auto-check
- **Emitter:** `src/server/scheduler.ts:490`
- **Payload shape:** `{ ... }`
- **Listeners:** `useSSE.ts` → invalidates strategies.
- **Purpose:** Lifecycle auto-check scheduler job completed.

---

### paper:session_start / paper:session_stop
- **Emitter:** `src/server/routes/paper.ts:120,246`
- **Payload shape:** `{ sessionId, strategyId? }`
- **Listeners:** `useSSE.ts` → invalidates paper.
- **Purpose:** Paper session lifecycle boundaries.

### paper:trade / paper:pnl / paper:signal
- **Emitter:** `src/server/services/paper-execution-service.ts`, `paper-signal-service.ts`
- **Payload shape:** see interface definitions in `sse-events.ts`
- **Listeners:** `PaperTrading.tsx` + `useSSE.ts`
- **Purpose:** Intra-session trade fills, unrealized P&L ticks, and signal events.

### paper:kill-switch-tripped
- **Emitter:** `src/server/services/paper-execution-service.ts:981`
- **Payload shape:** `{ sessionId, symbol?, reason, force_close?, correlationId? }`
- **Listeners:** `KillSwitchBanner.tsx` (own EventSource) + `useSSE.ts` → invalidates paper+alerts.
- **Purpose:** Kill switch triggered; all positions force-closed or entries blocked. `correlationId` added Wave 8 for audit reconstruction.

### strategy:graveyard_burial
- **Emitter:** `src/server/services/lifecycle-service.ts` (`buryInGraveyard()` — Wave 8)
- **Payload shape:** `{ strategyId, name, failureModes: string[], deathReason, correlationId? }`
- **Listeners:** `useSSE.ts` → error toast (`duration: 10s`) + invalidates strategies.
- **Purpose:** Non-reversible terminal transition — strategy auto-buried due to gate failure or alpha decay. Error toast ensures operator sees graveyard burial regardless of active page.

### paper:kill-switch-threshold-tripped
- **Emitter:** `src/server/services/paper-execution-service.ts:993`
- **Payload shape:** `{ sessionId, threshold }`
- **Listeners:** `useSSE.ts` → warning toast + invalidates paper+alerts.
- **Purpose:** 67% DLL reached; new entries blocked, existing positions held.

### paper:exit:tp1_filled / paper:exit:tp2_filled / paper:exit:be_stop_moved / paper:exit:trail_tightened / paper:exit:time_stop_flattened / paper:exit:handler_error
- **Emitter:** `src/server/services/paper-execution-service.ts` (PAPER_EXIT_EVENTS constants)
- **Payload shape:** `{ position_id, strategy_id|null, decision_type, evidence, exit_style:"D"|"C", correlation_id }`
- **Listeners:** `useSSE.ts` → invalidates paper. Future: per-position exit timeline panel.
- **Purpose:** Style D/C exit handler milestones — TP fills, stop moves, trail tighten, time-stop flatten.

### paper:auto_stopped / paper:auto_recovered / paper:session-feedback-computed
- **Emitter:** `src/server/scheduler.ts:3879,3936,4029`
- **Payload shape:** `{ sessionId, ... }`
- **Listeners:** `useSSE.ts` → invalidates paper+alerts.
- **Purpose:** Automated session management decisions.

### paper:force-flatten-all
- **Emitter:** `src/server/services/paper-execution-service.ts:3014`
- **Payload shape:** `{ reason, count, errors }`
- **Listeners:** `useSSE.ts` → error toast + invalidates paper+alerts.
- **Purpose:** Production halt or DLL breach forced all positions closed.

### paper:entry-blocked-production-halt / paper:order-blocked-outage / paper:order-blocked-suspension
- **Emitter:** `src/server/services/paper-execution-service.ts:604,692,731`
- **Payload shape:** `{ sessionId? }`
- **Listeners:** `useSSE.ts` → invalidates paper+alerts. Future: real-time block indicator.
- **Purpose:** Entry or order blocked by production mode halt, exchange outage, or firm suspension.

---

### backtest:completed / backtest:failed
- **Emitter:** `src/server/services/backtest-service.ts`
- **Payload shape:** `{ backtestId?, strategyId?, error? }`
- **Listeners:** `Backtests.tsx` + `useSSE.ts`
- **Purpose:** Backtest lifecycle outcomes.

### backtest:scored
- **Emitter:** `src/server/services/backtest-service.ts` (CF-3 fix, Wave 13 Track B)
- **Payload shape:** `{ backtestId, strategyId, forgeScore, tier, gateRejected, correlationId? }`
- **Listeners:** `useSSE.ts` → can invalidate strategies list to refresh forgeScore display
- **Purpose:** Fired after every completed backtest, regardless of tier outcome.
  `gateRejected=true` means the strategy will NOT auto-promote (tier=REJECTED or null).
  Enables real-time dashboard update of `strategies.forgeScore` without waiting for lifecycle sweep.

### backtest:matrix-progress / backtest:matrix-tier / backtest:matrix-completed / backtest:matrix-failed
- **Emitter:** `src/server/services/matrix-backtest-service.ts`
- **Payload shape:** see `BacktestMatrix*Data` interfaces
- **Listeners:** `useSSE.ts` → invalidates backtests + toast on complete/fail.
- **Purpose:** Matrix backtest (symbol × timeframe sweep) progress milestones.

### mc:completed / mc:failed
- **Emitter:** `src/server/services/monte-carlo-service.ts`
- **Payload shape:** `{ mcRunId?, backtestId?, error? }`
- **Listeners:** `useSSE.ts` → invalidates monte-carlo + backtests.
- **Purpose:** Monte Carlo simulation outcomes.

### walkforward:window_complete (W9-3, 2026-05-17)
- **Emitter:** `src/server/services/backtest-service.ts:609` (post-commit, per OOS window).
- **Payload shape:** `{ backtestId, strategyId, windowIndex, windowStart, windowEnd, oosSharpe, oosNetPnl, passed, correlationId, timestamp }`
- **Listeners:** `useSSE.ts:788` → invalidates backtests + walkforward queries.
- **Purpose:** Lets the operator track multi-window walk-forward jobs in real time without polling. Each window's OOS Sharpe + pass/fail surfaces as the engine progresses.

---

### critic:started / critic:evidence_collected / critic:evaluation_complete / critic:candidates_ready / critic:completed / critic:child_created / critic:replay_started / critic:replay_complete / critic:run-completed / critic:run-failed / critic:replay-completed
- **Emitter:** `src/server/services/critic-optimizer-service.ts` (multiple)
- **Payload shape:** see `Critic*Data` interfaces in `sse-events.ts`
- **Listeners:** `useSSE.ts` → invalidates critic + strategies; toasts on key milestones.
- **Purpose:** Critic optimizer loop lifecycle — evidence collection, candidate generation, replay ranking, survivor selection, child creation.

---

### strategy:created / strategy:promoted / strategy:deployed / strategy:decay-warning / strategy:decay-demotion / strategy:drift-alert / strategy:drift-demotion / strategy:evolved
- **Emitter:** Various services (lifecycle, decay, drift, evolution)
- **Payload shape:** see `Strategy*Data` interfaces
- **Listeners:** `Strategies.tsx`, `Dashboard.tsx`, `DeployReady.tsx` + `useSSE.ts`
- **Purpose:** Strategy library state changes. Toasts on decay demotions and deploy-ready.

### strategy:deploy-ready
- **Emitter:** `src/server/services/lifecycle-service.ts:1879`
- **Payload shape:** `{ strategyId, name, symbol?, rollingSharpe?, tradingDays?, message? }`
- **Listeners:** `useSSE.ts` → 10-second sticky success toast. Future: promotion queue badge.
- **Purpose:** Strategy passed all promotion gates; awaiting operator approval to PILOT.

### strategy:compliance_blocked
- **Emitter:** `src/server/services/backtest-service.ts:1502`, `lifecycle-service.ts:1314,1345`
- **Payload shape:** `{ strategyId, firm?, reasons? }`
- **Listeners:** `useSSE.ts` → error toast + invalidates strategies+compliance.
- **Purpose:** Strategy blocked at compliance gate during promotion.

### strategy:exportability_blocked
- **Emitter:** `src/server/services/backtest-service.ts:1555`, `lifecycle-service.ts:1461`
- **Payload shape:** `{ strategyId, name?, fromState, toState, score?, band? }`
- **Listeners:** `useSSE.ts` → warning toast.
- **Purpose:** Pine exportability score below threshold — strategy blocked from PAPER promotion.

### strategy:assignment_collision / strategy:assigned / strategy:unassigned
- **Emitter:** `src/server/services/strategy-assignment-service.ts:291,391,447`
- **Payload shape:** `{ strategyId, accountId }`
- **Listeners:** `useSSE.ts` → error toast (collision); invalidates strategies+assignments.
- **Purpose:** Family member strategy assignment management.

---

### compliance:violation_detected
- **Emitter:** `src/server/routes/compliance.ts:560,636,722` (COMPLIANCE_EVENTS.VIOLATION_DETECTED)
- **Payload shape:** `{ rule, strategy_id?, position_id?, firm, details, correlation_id? }`
- **Listeners:** `Compliance.tsx` + `useSSE.ts` → invalidates compliance+alerts.
- **Purpose:** 2026 MFFU compliance rule violation detected pre-order.

### compliance:collaborative_trading_warning
- **Emitter:** `src/server/services/strategy-assignment-service.ts:328`
- **Payload shape:** `{ strategyId, accountIds }`
- **Listeners:** `useSSE.ts` → 12-second error toast + invalidates compliance+alerts.
- **Purpose:** MFFU collaborative-trading ban triggered — 2+ family members on same strategy.

### compliance:drift_detected (W9-3, 2026-05-17)
- **Emitter:** `src/server/services/compliance-refresh-service.ts:153` (after Discord notification).
- **Payload shape:** `{ affectedFirms: string[], oldHash: string|null, newHash: string, affectedStrategyCount: number, severity: "warning"|"critical", correlationId, timestamp }`
- **Listeners:** `useSSE.ts:798` → error toast (critical) / warning toast (warning) + invalidates compliance.
- **Purpose:** Real-time signal when canonical `prop-firm-rules-2026-*.md` hash changes. Operator must re-validate PAPER/DEPLOYED strategies; severity flips to "critical" when affected count > 0.

### compliance:cascade_revalidation
- **Emitter:** `src/server/services/drift-detection-service.ts:255`
- **Payload shape:** `{ firm, invalidatedReviews, pausedStrategies, affectedStrategyIds, severity, message, timestamp }`
- **Listeners:** `useSSE.ts` → 12-second error toast + invalidates all compliance caches.
- **Purpose:** Drift event requires all firm compliance reviews to be invalidated.

### migration:legacy_firm_cleanup_complete / firm_count_changed
- **Emitter:** `src/server/routes/compliance.ts` (COMPLIANCE_EVENTS constants)
- **Payload shape:** see interface definitions
- **Listeners:** `useSSE.ts` → invalidates compliance.
- **Purpose:** Firm registry migration and count change notifications.

---

### broker:order_routed
- **Emitter:** `src/server/services/broker-router.ts` (BROKER_ORDER_ROUTED_EVENT)
- **Payload shape:** `{ success, reason?, correlationId?, ...result }`
- **Listeners:** `useSSE.ts` → invalidates broker. Future: order audit trail panel.
- **Purpose:** Every order routed through broker-router emits this for audit trail visibility.

---

### pine:export-completed / pine:export-failed / pine:export_completed (legacy)
- **Emitter:** `src/server/services/pine-export-service.ts:543,614,812,868`
- **Payload shape:** see `PineExport*Data` interfaces
- **Listeners:** `useSSE.ts` → success/error toast + invalidates strategies+pine.
- **Purpose:** Pine script compilation and export outcomes.

### pine_export:hmac_persist_failed
- **Emitter:** `src/server/services/pine-export-recipient-service.ts:169`
- **Payload shape:** `{ assignmentId?, error? }`
- **Listeners:** `useSSE.ts` → error toast. Future: Pine delivery health panel.
- **Purpose:** HMAC secret DB write failed after Pine artifact generation (retry logic separate).

### pine_export:failed (W9-2, 2026-05-17)
- **Emitter:** `src/server/services/pine-export-recipient-service.ts:409,429,449,496` + `src/server/routes/pine-export.ts` catch.
- **Payload shape:** `{ exportId: string|null, strategyId, accountId?, firmId?, errorCode: "pipeline_paused"|"strategy_not_found"|"account_not_found"|"compilation_failed"|"hmac_persist_failed"|"internal_error", errorMessage, correlationId, timestamp }`
- **Listeners:** `useSSE.ts:775` → error toast + invalidates pine.
- **Purpose:** Server-side Pine export failure visibility — closes the asymmetry where the success path emitted but the failure paths only logged. Operator now sees compilation/pipeline-pause/lookup failures in real time.

### pine_export:recipient_generated / pine_export:delivered
- **Emitter:** `src/server/services/pine-export-recipient-service.ts:459`, `pine-delivery-service.ts:229`
- **Payload shape:** `{ assignmentId?, strategyId? }`
- **Listeners:** `useSSE.ts` → invalidates pine.
- **Purpose:** Per-recipient Pine generation and delivery milestones.

---

### alert:new / alert:triggered / alert:kill_switch_down / alert:compliance_gate_blocked / alert:compliance_guard_down / alert:calendar_guard_down / alert:ict_bridge_down
- **Emitter:** `alert-service.ts`, `paper-execution-service.ts`, `paper-signal-service.ts`
- **Payload shape:** see `Alert*Data` interfaces
- **Listeners:** `Compliance.tsx` + `useSSE.ts` → invalidates alerts.
- **Purpose:** System-wide alert bus; critical guard-down events surface as error toasts.

---

### n8n:health-alert / n8n:workflow-failed / n8n:tournament-stale
- **Emitter:** `src/server/scheduler.ts`
- **Payload shape:** see `N8n*Data` interfaces
- **Listeners:** `useSSE.ts` → warning/error toasts + invalidates n8n.
- **Purpose:** n8n workflow health surface — failing workflows and stale tournament results.

---

### scheduler:job-complete / scheduler:decay-sweep-complete / scheduler:pre-market-alert / scheduler:sharpe-updated / scheduler:regret-score-fill
- **Emitter:** `src/server/scheduler.ts`
- **Payload shape:** minimal job metadata
- **Listeners:** `useSSE.ts` → invalidates strategies/alerts. Future: scheduler health panel.
- **Purpose:** Scheduler job completion signals for housekeeping visibility.

---

### production:mode-changed / production:drift-detection-completed / production:reconciliation-completed
- **Emitter:** `src/server/production/kill-switch.ts`, `drift-detector.ts`, `reconciliation-service.ts`
- **Payload shape:** minimal mode/status data
- **Listeners:** `useSSE.ts` → invalidates production caches. Future: production status panel.
- **Purpose:** Production subsystem state transitions (kill-switch mode, drift, reconciliation).

### compute:failover-state-change / network:failover-state-change
- **Emitter:** `src/server/lib/compute-failover.ts`, `network-failover.ts`
- **Payload shape:** `{ state, ... }`
- **Listeners:** `useSSE.ts` → invalidates compute/network. Future: infra health panel.
- **Purpose:** Compute (Ollama primary/fallback) and network path failover transitions.

---

### system:shutdown
- **Emitter:** `src/server/index.ts:1302`
- **Payload shape:** `{ reason, signal? }`
- **Listeners:** `ServerStatusBanner.tsx` (connection-state hook) + `useSSE.ts` → warning toast.
- **Purpose:** Server going offline; clients reconnect with exponential backoff.

---

### pending_bucket.updated / pending_bucket.graduated / pending_bucket.expired
- **Emitter:** `src/server/routes/agent.ts`, `scheduler.ts`
- **Payload shape:** see `PendingBucket*Data` interfaces
- **Listeners:** `PendingValidationTab.tsx` + `useSSE.ts`
- **Purpose:** Scout pending-bucket cross-validation lifecycle.

---

### agent:health_sweep / prompt-ab-test:resolved / prompt-evolution:complete / meta:parameter_review
- **Emitter:** `agent-audit-service.ts`, `prompt-evolution-service.ts`, `meta-optimizer-service.ts`
- **Listeners:** `useSSE.ts` → invalidates agents.
- **Purpose:** Agent health and prompt evolution lifecycle events.

---

### deepar:training_complete / deepar:forecast_ready / deepar:weight_changed
- **Emitter:** `src/server/services/deepar-service.ts`
- **Listeners:** `useSSE.ts` → invalidates deepar; weight toast.
- **Purpose:** DeepAR ML model training and inference lifecycle.

---

### windows:health-check-failed / windows:health-check-ram-warning / windows:real-reboot-pending
- **Emitter:** `src/server/services/windows-health-check-service.ts`
- **Listeners:** `useSSE.ts` → invalidates health. Future: operator health banner.
- **Purpose:** Skytech tower Windows health — RAM pressure, reboot-pending state.

---

### prop-firm:suspension-detected / prop-firm:suspension-cleared / prop-firm:snapshot-captured
- **Emitter:** `src/server/services/prop-firm-health-service.ts`, `dashboard-snapshot-service.ts`
- **Listeners:** `useSSE.ts` → invalidates prop-firm.
- **Purpose:** Prop firm suspension state transitions and balance snapshot captures.

---

### vp:levels-computed
- **Emitter:** `src/server/services/volume-profile-service.ts:225`
- **Payload shape:** `{ symbol, sessionDate, shape? }`
- **Listeners:** `useSSE.ts` → invalidates volume-profile. Future: VP overlay panel.
- **Purpose:** Volume profile VPOC/VAH/VAL levels computed for the session.

---

### auction:imbalance-updated
- **Emitter:** `src/server/scheduler.ts:1320`
- **Payload shape:** `{ symbol?, imbalance? }`
- **Listeners:** `useSSE.ts` → invalidates auction. Future: pre-market imbalance widget.
- **Purpose:** CME opening auction order imbalance data updated.

---

### scout-health:reject-spike / scout-health:no-strategies-today
- **Emitter:** `src/server/services/agent-service.ts:86`, `strategy-production-check-service.ts:111`
- **Listeners:** `useSSE.ts` → invalidates scout+alerts.
- **Purpose:** Scout pipeline health — rejection rate spikes and zero-yield days.

---

### anti-setup:mined / anti-setup:blocked / anti-setup:effectiveness
- **Emitter:** `src/server/scheduler.ts:640`, `paper-signal-service.ts`, `anti-setup-effectiveness-service.ts`
- **Listeners:** `useSSE.ts` → invalidates anti-setup.
- **Purpose:** Anti-setup pattern mining, real-time blocks, and effectiveness analysis.

---

### archetype:predicted / regime:state_updated
- **Emitter:** `src/server/scheduler.ts`
- **Listeners:** `useSSE.ts` → invalidates archetype/regime.
- **Purpose:** ML archetype prediction and macro regime state transitions. (Wave 11 cleanup: `macro:regime-updated` removed — not present in SSEEvent union.)

---

### correlation:alert / portfolio:correlation_snapshot / drift:alert / strategy:drift-demotion
- **Emitter:** `correlation-service.ts`, `portfolio-optimizer-service.ts`, `drift-detection-service.ts`
- **Listeners:** `useSSE.ts` → invalidates portfolio/drift/alerts.
- **Purpose:** Signal correlation alerts, portfolio risk snapshots, and drift detection.

---

### metrics:snapshot / metrics:trade-close / metrics:warmed-up
- **Emitter:** `src/server/services/metrics-aggregator.ts`
- **Listeners:** `useSSE.ts` → invalidates metrics.
- **Purpose:** Rolling metrics updates, trade close costs, and post-boot warm-up completion.

---

### nemo:scenario-generated / nemo:scenario-error
- **Emitter:** `src/server/services/nemo-scenario-service.ts`
- **Listeners:** `useSSE.ts` → invalidates nemo.
- **Purpose:** NEMO synthetic scenario generation lifecycle.

---

### a-plus-auditor:scan-complete
- **Emitter:** `src/server/services/a-plus-auditor-service.ts:349`
- **Listeners:** `useSSE.ts` → invalidates agents. Future: A+ auditor results panel.
- **Purpose:** A+ signal noise auditor scan completed.

---

### pipeline:mode-change / pipeline:pause_snapshot / pipeline:resume_stale_positions / pipeline:drain-resume
- **Emitter:** `src/server/services/pipeline-control-service.ts`
- **Listeners:** `DataPipeline.tsx` + `useSSE.ts` → invalidates pipeline+paper.
- **Purpose:** Pipeline pause/resume state transitions.

---

### Wave 11 Batch Additions (2026-05-17)

> Added by Wave 11 SSE inventory drift checker (`buildSseInventoryDriftItems` in
> `src/server/lib/system-topology.ts`). These events were already typed in the
> SSEEvent union but missing from the inventory above. Each entry is condensed —
> for full payload shape, see the interface in `sse-events.ts`.

### backtest:complete
- **Emitter:** `src/server/services/backtest-service.ts`
- **Purpose:** Backtest run finished (success or failure).

### compliance:drift_detected
- **Emitter:** `src/server/services/compliance-refresh-service.ts` (Wave 9 W9-3)
- **Purpose:** Compliance rule document drift detected; severity=critical when PAPER/PILOT/DEPLOYED strategies exist.

### critic:evidence_collected_async
- **Emitter:** `src/server/services/critic-optimizer-service.ts` (async path)
- **Purpose:** Async critic evidence collection completed; mirrors `critic:evidence_collected`.

### critic:evidence_source
- **Emitter:** `src/server/services/critic-optimizer-service.ts`
- **Purpose:** Identifies which evidence source produced the critic finding.

### critic:started_async
- **Emitter:** `src/server/services/critic-optimizer-service.ts` (async path)
- **Purpose:** Async critic loop started; mirrors `critic:started`.

### evolution:abort
- **Emitter:** `src/server/services/evolution-service.ts`
- **Purpose:** Strategy evolution loop aborted due to budget/guard violation.

### nightly:review-complete
- **Emitter:** `src/server/scheduler.ts` (nightly self-critique cron)
- **Purpose:** Nightly review cycle finished writing critic findings.

### paper:consistency-warning
- **Emitter:** `src/server/services/paper-execution-service.ts`
- **Purpose:** Paper-trading consistency check flagged anomaly (account balance vs trade ledger).

### paper:decay-alert
- **Emitter:** `src/server/services/paper-execution-service.ts`
- **Purpose:** Strategy alpha decay detected at warning threshold during paper session.

### paper:decay-warning
- **Emitter:** `src/server/services/paper-execution-service.ts`
- **Purpose:** Early decay signal — operator should review strategy soon.

### paper:fill-miss
- **Emitter:** `src/server/services/paper-execution-service.ts`
- **Purpose:** Expected order fill did not arrive in window — broker or signal-routing issue.

### paper:position-opened
- **Emitter:** `src/server/services/paper-execution-service.ts`
- **Purpose:** New paper position opened; full position state included in payload.

### paper:roll-flatten / paper:roll-spread-applied / paper:roll-warning
- **Emitter:** `src/server/services/paper-execution-service.ts` (futures roll handling)
- **Purpose:** Futures contract roll lifecycle — flatten near expiry, spread cost applied, advance warning.

### pine:export_completed
- **Emitter:** `src/server/services/pine-export-service.ts`
- **Purpose:** Pine export pipeline finished successfully — artifact persisted.

### pine_export:failed
- **Emitter:** `src/server/services/pine-export-recipient-service.ts` + `src/server/routes/pine-export.ts` (Wave 9 W9-2)
- **Purpose:** Pine export failed; typed errorCode (pipeline_paused, strategy_not_found, account_not_found, compilation_failed, hmac_persist_failed, internal_error).

### strategy:analysis-error
- **Emitter:** `src/server/services/agent-service.ts`
- **Purpose:** Strategy deep-analysis pipeline raised an error during run.

### strategy:analyzed
- **Emitter:** `src/server/services/agent-service.ts`
- **Purpose:** Strategy deep-analysis pipeline completed; results persisted.

### strategy:paper-vs-backtest-alert
- **Emitter:** `src/server/scheduler.ts` (paper-vs-backtest cron)
- **Purpose:** Live paper P&L diverged from backtest expectation beyond threshold.

### walkforward:window_complete
- **Emitter:** `src/server/services/backtest-service.ts` (Wave 9 W9-3)
- **Purpose:** Walk-forward window finished; OOS Sharpe + net P&L per window; passed=true when OOS Sharpe ≥ 0.5.

### bias_engine:strategy_selected
- **Emitter:** `src/server/services/bias-state-service.ts` (Wave 23.C)
- **Payload shape:** `{ sessionDate, regimeLabel, playbook, activeStrategyId, computedAt }`
- **Purpose:** Daily bias engine decision persisted — regime + playbook + active strategy for the session.

### signal:a_plus_rejected
- **Emitter:** `src/server/services/paper-signal-service.ts` (Wave 23.C)
- **Payload shape:** `{ sessionId, symbol, strategyId, satisfiedCount, minRequired, factorResults, timestamp }`
- **Purpose:** A+ confluence gate blocked a signal entry; insufficient factors satisfied.

---

> **Coverage summary (Wave 4, 2026-05-16):**
> Backend emitters: ~120 unique broadcastSSE calls across 28 files.
> Distinct event names: 70+.
> All events typed in `src/types/sse-events.ts` discriminated union.
> All events handled in `useSSE.ts` dispatchSideEffects switch (exhaustiveness enforced by TypeScript).
> Frontend subscriptions: 7 pages + 2 banner components.
> Key Wire-up this wave: `lifecycle:gate_evaluated` subscribed on `DeployReady.tsx`; toasts on FAIL/KILL/A7-ramp-up.

---

## §2b Scout Architecture — Wave 23F Strategy Factory Upgrade (2026-05-19)

Companion to CLAUDE.md §2b. The factory pipeline now emits Wave-23-shaped strategies end-to-end. Win rate remains an OBSERVED output — never a design target.

### `strategies.symbols TEXT[]` column (migration 0111)
- New nullable column added by `src/server/db/migrations/0111_strategies_symbols_array.sql` (idempotent: `ADD COLUMN IF NOT EXISTS`, backfill from legacy `symbol`, GIN index `idx_strategies_symbols_gin`).
- Schema: `src/server/db/schema.ts` — `symbols: text("symbols").array()`.
- Semantics: per-symbol routing for multi-market strategies. Discovery layer may emit MES/MNQ/MCL variants of the same concept.
- Backward compat: legacy `symbol TEXT` column retained; drop scheduled W24 after 30-day soak.

### `entry_quality` JSONB block (graduator emission)
Emitted by `src/server/services/direct-bucket-graduator.ts:1460+` on every graduation. Fields:
- `confluence_factors: string[]` — ordered confluence cues extracted from source claim.
- `min_factors_satisfied: number` — A+ threshold count (default = `confluence_factors.length` when present).
- `source_claim_win_rate: number | null` — INFORMATIONAL only, never gated against.
- `source_claim_avg_r: number | null` — INFORMATIONAL only.
- `extraction_provenance: string` — `"scout_extract"` when confluence present; `"legacy_no_confluence"` fallback when `confluence_factors` is empty. The fallback is the legal bypass path for pre-W23F strategies through the consumer A+ gate in `paper-signal-service.ts:2392-2436`.
- Audit events: `graduation.entry_quality_attached`, `graduation.symbols_multi_market` (when `symbols.length > 1`).

### Concept fingerprint key change (W23F.C)
`src/server/services/strategy-fingerprint.ts::computeConceptFingerprintHash` now hashes `sha256(normalized_concept_name)` only — market argument dropped. Cross-symbol convergence: MES + MNQ + MCL instances of the same concept land in the same pending bucket. Pre-W23F.C buckets remain isolated by design; graveyard sweep handles legacy.

### MES/MNQ/MCL discovery rotation
`src/server/services/autonomous-scout-runner.ts` rotates 1/3 each per cycle. Cycle index = `audit_log` count of `autonomous_scout.cycle_started` rows (deterministic, persisted, restart-safe). Query templates: 83 MES + 23 MNQ + 22 MCL. Mentions tagged with `__scout_seeded_symbol` and surface on `extracted_idea.symbols`.

### New SSE events (Wave 23F.G)
- `factory:multi_market_bucket` — emitted when a pending bucket aggregates ≥2 distinct seeded symbols.
- `factory:graduation_entry_quality` — emitted alongside lifecycle promotion when `entry_quality` is attached.
- Trace helpers: `src/server/lib/wave23f-trace.ts` exports `traceWave23fCycle(correlationId)` and `summarizeWave23fCycle(correlationId)` for end-to-end cycle reconstruction across audit_log + SSE.

### Correlation_id end-to-end (W23F.G-hotfix)
`runAutonomousScoutCycle` → `postLayerMention` (sends `x-correlation-id` header at `autonomous-scout-runner.ts:539`) → `/scout-ideas/pending` (route reads via `getCorrelationId(req)`) → graduation audit rows. Verified by `wave23f-correlation-trace.test.ts`.

### Re-overlay script for legacy strategies
`scripts/wave23f-relegacy-overlay.ts` (idempotent) re-overlays the 2 pre-W23F strategies with `extraction_provenance: "legacy_no_confluence"`. Operator runs against live DB once consumer agent's Style C overlay flip lands.

---

## §2c Wave 23 Pass 1 — Spec Reset, Sizing Floor, Bias Engine, Promotion Gates (2026-05-19)

Companion to CLAUDE.md §4 + §12. Pass 1 closed four tracks GREEN; this is the cross-cutting registration record.

### Track 23.A — CLAUDE.md + AGENTS.md spec reset
- CLAUDE.md §1 / §4 / §12 / §13 + AGENTS.md rewritten to remove all hit-rate target / band language. Win rate is now declared an OBSERVED output only.
- Promotion gates documented as hit-rate-agnostic: `expectancy_per_trade >= 2.0R` (R-multiple) + `profit_factor >= 1.7` + `deflated_sharpe >= 1.5` + `regime_survival` across 4 harsh windows.
- Documentation-only track; no code, schema, or contract surface changes.

### Track 23.B — Pyramid floor 6/6/18 + HWM tracking (migration 0113)
- **Sizing math:** pyramid floor recalibrated to `MES base 6 / MNQ base 6 / MCL base 18` with `+3` per `+$3,000` cumulative profit (preserves divisibility by 3 so Style C 33/33/33 partials are clean at every tier). Equalizes per-trade dollar risk to ~$420-$480 across the three micros at the 14-pt-MES / 40-pt-MNQ / 25-tick-MCL ceiling.
- **Locked micro point values:** `MES = $5/pt`, `MNQ = $2/pt`, `MCL = $1/tick` in `firm-config.ts` + `firm_config.py` with `// Wave 23 LOCKED` comments.
- **`paper_sessions.high_water_balance NUMERIC` column** added by `src/server/db/migrations/0113_wave23_hwm_tracking.sql` (idempotent; back-fills from `max(balance, starting_balance)` on existing rows). The Topstep trailing-DD math now reads `buffer = (balance - trailing_floor)` where `trailing_floor` is derived from HWM, not the simple balance proxy.
- **`computeRiskDerivedContracts(input)`** signature extended additively in `src/server/lib/risk-sizing.ts` with optional `accountStartingFloor` + `hwm` params. Older callers continue to compile (additive-only change).
- **`paper_session.hwm_updated`** audit action written whenever the HWM advances.
- **Backfill:** `npm run db:migrate` applied 0113; backfill block touched 3 existing strategies (base 6 / tier_increment 3).

### Track 23.C — Bias engine + A+ gate wiring (migration 0112)
- **`bias_state` table** added by `src/server/db/migrations/0112_wave23_bias_state.sql`. One row per CME trading session (`UNIQUE(session_date)`); columns: `session_date DATE`, `regime_label TEXT`, `playbook TEXT`, `active_strategy_id UUID NULL FK->strategies`, `correlation_id TEXT`, `evidence JSONB`, `computed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`. Distinct from `bias_decisions` (per-call shadow-calibration sink, migration 0095). `bias_state` is the per-session promotion-gate input read at signal time.
- **Service:** `src/server/services/bias-state-service.ts` drives `compute_bias()` + `route_playbook()` at session-open (idempotent via `ON CONFLICT(session_date) DO UPDATE`). Failures are fail-open: a missed write does NOT block signal execution.
- **Routes:** `/api/bias-state/today` + `/api/bias-state/history` mounted at `src/server/routes/bias-state.ts`. Registered in `/api/bias-state` route inventory above (line 187).
- **A+ consumer gate:** `paper-signal-service.ts:2392-2436+` reads `entry_quality.{confluence_factors, min_factors_satisfied, source_claim_*, extraction_provenance}` from `strategies.config`. Behavior matrix:
  - `extraction_provenance == "legacy_no_confluence"` or missing `entry_quality` -> bypass (audit: `signal.a_plus_bypassed_legacy` / `signal.a_plus_bypassed_no_entry_quality`).
  - `satisfied_count < min_factors_satisfied` -> block (SSE: `signal:a_plus_rejected`, audit: `signal.a_plus_rejected`, paper_signal_logs row with `signalType: "a_plus_blocked"`).
  - `satisfied_count >= min_factors_satisfied` -> pass (audit: `signal.a_plus_passed`; audit-only by design, no SSE).
  - Strategy not selected for today's regime (`bias_state.active_strategy_id != strategyId`) -> block (audit: `signal.not_active_strategy_for_regime`; audit-only).
- **SSE events (new this track):** `bias_engine:strategy_selected` (one per session-open) + `signal:a_plus_rejected` (per blocked signal). Typed in `Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts` as `BiasEngineStrategySelectedData` + `SignalAPlusRejectedData`. The pass-through events (`signal.a_plus_passed`, `signal.not_active_strategy_for_regime`) are audit-log actions only — intentional asymmetry to avoid dashboard flood.

### Track 23.D — Promotion gates (R-multiple expectancy + harsh-regime survival)
- **`expectancy_per_trade >= 2.0R` HARD gate** at CANDIDATE -> TESTING in `lifecycle-service.ts` lines ~1151-1236 (W23-D.1 block). Replaces the legacy `$75/trade` dollar gate from `performance_gate.py:164-239`. Reads `backtests.gate_result.expectancy_r`. Permissive fallback for pre-W23 backtests missing `avg_trade_risk`.
- **Harsh-regime survival SOFT advisory** at TESTING -> PAPER in `lifecycle-service.ts` lines ~1580-1686 (W23-D.2 block). Calls `src/engine/regime_survival.py` via `runPythonModule`. Phase 0 (advisory): `lifecycle.harsh_regime_advisory` audit row + SSE `lifecycle:gate_evaluated` with `gate: "harsh_regime_survival_w23", severity: "soft"` + Discord warning on fail; promotion never blocked. Phase upgrade controlled by `REGIME_SURVIVAL_PHASE` env var (default `"advisory"`).
- **4 fixed harsh-regime windows:** `covid_2020`, `fed_pivot_2022`, `yen_carry_2024`, `apr_vol_spike_2025`. Per-regime stats are `expectancy_R` + `PF` + `Sharpe proxy` — fully hit-rate-agnostic.
- **`backtester.py:2505-2528`** injects `avg_trade_risk` (dollar terms) into `_gate_stats` so the consumer gate can compute `actual_R = avg_trade_pnl / avg_trade_risk`. Cross-service contract preserved: Track 23.B's sizing changes do NOT break this metric — `avg_trade_risk` is computed per-trade from actual stop distance × point value × size, independent of pyramid floor / HWM.

### Migrations applied (Pass 1)
- `0112_wave23_bias_state.sql` — APPLIED via `npm run db:migrate`.
- `0113_wave23_hwm_tracking.sql` — APPLIED via `npm run db:migrate`; backfill updated 3 strategies to base 6 / tier_increment 3.

### Audit log actions added (Pass 1)
- `bias_engine.strategy_selected` — `bias-state-service.ts` per session.
- `signal.a_plus_passed` / `signal.a_plus_rejected` / `signal.a_plus_bypassed_legacy` / `signal.a_plus_bypassed_no_entry_quality` — `paper-signal-service.ts`.
- `signal.not_active_strategy_for_regime` — `paper-signal-service.ts:2436`.
- `lifecycle.gate_eval` — `lifecycle-service.ts` (R-multiple HARD path).
- `lifecycle.harsh_regime_advisory` — `lifecycle-service.ts:1620+` (soft Phase 0 path).
- `paper_session.hwm_updated` — `paper-signal-service.ts` (HWM advance).
- `strategy.wave23_base_backfilled` — `0113_wave23_hwm_tracking.sql` backfill.
- `db_migration.applied` — written by `npm run db:migrate` on each successful apply.

### Cross-cutting contract verification (Pass 1, 2026-05-19)
1. **entry_quality factory->consumer:** factory emits in `direct-bucket-graduator.ts:1460+`; consumer reads in `paper-signal-service.ts:2409-2492`. Field set matches end-to-end.
2. **Sizing schema additive contract:** `computeRiskDerivedContracts()` extension is param-additive; no existing callers needed signature updates.
3. **bias_state table:** schema columns match service writes; `lifecycle.gate_evaluated` audit row schema does NOT conflict (separate `entityType`).
4. **R-multiple gate:** backtester injects `avg_trade_risk`; lifecycle reads `expectancy_r` from `backtests.gate_result`. Track 23.B sizing changes don't perturb this metric.
5. **Frontend SSE types:** `BiasEngineStrategySelectedData` + `SignalAPlusRejectedData` added to discriminated union; exhaustiveness preserved.
