# Indicator Observability / Decision Ledger Schema

Purpose: make every displayed state explainable and every research result reproducible. No production-acceptable signal may exist only as a chart arrow.

## 1. Identity / provenance fields

Required per setup episode:
- `episode_id`
- `semantic_spec_version`
- `code_commit_sha`
- `config_version`
- `config_sha256`
- `dataset_provider`
- `dataset_fingerprint`
- `platform`
- `platform_version_if_available`
- `symbol_root`
- `contract_symbol`
- `runtime_mode`
- `feed_state`
- `chart_timeframe_minutes`
- `timezone_display`

## 2. Time fields

- `episode_started_event_time_utc`
- `episode_started_receive_time_utc` when available
- `reference_bar_open_utc`
- `reference_bar_close_utc`
- `last_update_event_time_utc`
- `last_update_receive_time_utc` when available

Event time and receive time must never be conflated.

## 3. Direction / context

- `overall_direction` = BULLISH / BEARISH / UNKNOWN
- `overall_direction_source` = user trendline/manual fixture/future approved model
- `trade_direction_candidate`
- `is_countertrend`
- `context_reason_codes[]`

Red trendline crossing itself is not an intraday flip reason code in V1.

## 4. Reference levels

- `pdh`
- `pdl`
- `pwh`
- `pwl`
- native platform provenance for each level
- `platform_level_mismatch` when comparison exists

## 5. Reaction zones

For every candidate:
- `zone_id`
- `timeframe`
- `lower_bound`
- `upper_bound`
- `near_edge`
- `far_extreme`
- `reaction_score`
- `reaction_count`
- `confluence_count`
- `age_bars`
- source swing/reaction IDs
- `zone_status` = candidate/qualified/rejected/merged/expired
- `zone_reason_codes[]`

## 6. Proof-level candidates

For every candidate:
- `candidate_id`
- raw structural price
- tradable tick-grid proof price
- normalized distance
- room to target
- structural score
- calibrated selection score
- originating zone/timeframe
- qualified boolean
- rejection reason code if rejected

Selected proof record:
- `selected_proof_candidate_id`
- `selected_proof_raw_price`
- `selected_proof_tradable_price`
- `proof_selection_reason`

## 7. Momentum event ledger

One row/event per accepted or rejected market update relevant to the active setup:
- `event_id`
- `bar_id`
- `event_time`
- `price`
- `state_before`
- `state_after`
- `transition_code`
- `reference_price`
- `anchor_price`
- `push_distance`
- `push_elapsed_seconds`
- `recoil_distance`
- `recoil_fraction`
- `body_fraction`
- `rejection_wick_fraction`
- `hold_near_favorable_extreme`
- `acceleration_ratio`
- `data_quality_codes[]`

If no transition occurs, retaining every raw tick is optional in live UI telemetry but the research/replay source stream must remain reproducible.

## 8. Runtime safety

- `signal_allowed`
- `display_allowed`
- `runtime_block_codes[]`
- `seconds_since_last_update`
- `gap_id` if applicable
- `contract_roll_detected`
- `off_grid_input_detected`

## 9. Target candidates

For every target candidate:
- `zone_id`
- distance normalized
- major/minor classification inputs
- selected boolean
- skip/reject reason

Selected target:
- `target_zone_id`
- `target_raw_price`
- `target_tradable_price`
- `target_penetration_fraction`
- `target_selection_reason`

## 10. Research outcome fields

These are written only after the forward outcome window is available and must not be accessible to decision-time feature code:
- `entry_event_time`
- `entry_price_research`
- `stop_price`
- `target_price`
- `first_hit` = STOP_FIRST/TARGET_FIRST/NEITHER
- `first_hit_event_time`
- `mae_to_exit_points/ticks`
- `mfe_to_exit_points/ticks`
- `horizon_mae_points/ticks`
- `horizon_mfe_points/ticks`
- `target_zone_penetration`
- `outcome_taxonomy`
- `cost_scenario_id`
- `net_result_after_costs`

## 11. Integrity rules

- Decision-time and outcome-time tables/fields must be separable to prevent leakage.
- Every enum/reason code has a versioned dictionary.
- Unknown reason is not accepted; use an explicit `UNCLASSIFIED_*` code and fail the release gate until resolved.
- Ledger writes must never alter trading state.
- Missing telemetry must be visible; do not substitute zeros for unknown values.
- A config/code change starts a new provenance version.
- Research joins use immutable `episode_id`/event identity, never fuzzy timestamp matching alone.

## 12. Audit queries the schema must answer

1. Why was this yellow line chosen over the nearer wick?
2. Why was a farther candidate rejected?
3. Which exact event created Push 1 and Push 2?
4. Did a recoil occur before entry?
5. Was the feed delayed/stale/gapped at signal time?
6. Which pool was skipped and why?
7. Was TP rounded toward or deeper into the pool?
8. Did the setup differ between Python/Pine/FXR?
9. Did a code/config/provider change explain a behavioral difference?
10. Did the real path hit the 69-tick stop before the conservative target?
